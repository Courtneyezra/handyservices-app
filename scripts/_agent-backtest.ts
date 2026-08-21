/**
 * _agent-backtest.ts — does the comms agent make the moves that actually won work?
 *
 *   npx tsx scripts/_agent-backtest.ts                  15 decision points, the default budget
 *   npx tsx scripts/_agent-backtest.ts --limit 30       spend more
 *   npx tsx scripts/_agent-backtest.ts --extract-only   no model spend: inventory the corpus
 *   npx tsx scripts/_agent-backtest.ts --refresh        re-pull outcomes and re-cut the fixtures
 *   npx tsx scripts/_agent-backtest.ts --kind price_objection
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * scripts/_post-quote-test.ts and scripts/_pipeline-e2e-test.ts prove the agent does what we
 * intended: the guards refuse what they claim to refuse, the ledger records what it claims to
 * record. Neither can tell us whether what we intended WINS WORK. This can, approximately, because
 * for 10,267 real messages we know two things the agent does not — what a human said next, and
 * whether the thread ended in money.
 *
 * THE METHOD
 *   1. Cut a real conversation at the moment a decision was made (scripts/_backtest-corpus.ts).
 *   2. Rebuild that thread state as a SCRATCH conversation on the Ofcom reserved range, with a
 *      copy of the real quote under a synthetic slug.
 *   3. Run the real agent (runCommsAgent) against it. Nothing is sent; drafts go to the queue and
 *      are deleted with everything else.
 *   4. Score the draft three ways and tear the fixture down.
 *
 * THE THREE SCORES ARE PROXIES AND ARE LABELLED AS PROXIES
 *   (a) LEVER AGREEMENT — did it reach for the same class of move Ben did (re-scope /
 *       hold-with-reason / capitulate / escalate)? Agreement with a human whose commonest move is
 *       his WORST move is not the goal, which is why (c) exists.
 *   (b) GUARDS — did it write a figure not on the quote, promise a date, imply they had not seen
 *       the quote, offer a discount, or break a voice rule? These are objective.
 *   (c) BEAT-OR-MATCH — where the corpus tells us which class converted, did it pick a class at
 *       least as good? Ranked on the n=19 objection table, which the analysis explicitly labels
 *       DIRECTIONAL. It is the only score pointing at revenue, and it is the weakest evidence in
 *       the file. Both facts are true at once.
 *
 * OVER-ESCALATION IS A REAL COST and is counted on its own. An agent that hands every objection to
 * Ben has not automated anything; it has made him the bottleneck with extra steps.
 *
 * SAFETY, absolute:
 *   · Every fixture lives on +447700900930, inside the Ofcom reserved drama range. No real customer
 *     can be reached, and no real thread is read or written.
 *   · The database ends as it started: each case tears down its own rows in a finally block, and a
 *     final sweep removes anything the agent created that this script did not learn the id of.
 *   · autosend and firstContactAutoAck are forced OFF for the run and firstContactAutoAck is forced
 *     OFF at the end whatever it was before, then READ BACK FROM THE DATABASE and printed.
 *   · Customers are first names only. Postcodes, phone numbers and real quote slugs never leave
 *     the extractor.
 *
 * COST: one agent run per decision point (claude-sonnet-5, <=10 turns). The API balance has run out
 * mid-session before, so every failure mode is caught: the run stops, keeps the completed scores,
 * and says how far it got.
 */
import 'dotenv/config';
import fs from 'fs';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, personalizedQuotes } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';

import {
    getCommsAgentConfig, setCommsAgentConfig, runCommsAgent, type CommsAgentOutcome,
} from '../server/agents/comms';
import { loadQuoteContexts } from '../server/agents/quote-context';
import { checkDraft, type DraftViolation } from '../server/agents/draft-guards';
import { priceBandFor } from '../server/agents/objection-levers';
import {
    DUMP_PATH, loadOutcomes, assemble, extractDecisionPoints, interleaveForSpend, readCache,
    writeCache, classifyLever, classifyOpening, checkVoice, LEVER_RANK, isRanked,
    type DecisionPoint, type LeverClass, type OpeningClass, type VoiceFinding, type DecisionKind,
} from './_backtest-corpus';

// ─────────────────────────────────────────────────────────────────────── args

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
    const inline = argv.find((a) => a.startsWith(`--${name}=`));
    return inline ? inline.split('=').slice(1).join('=') : fallback;
};

const LIMIT = Math.max(1, Number(value('limit', '15')) || 15);
const REFRESH = flag('refresh');
const EXTRACT_ONLY = flag('extract-only');
/** Re-print the report from the last run's cached scores. No model calls, no database. */
const REPORT_ONLY = flag('report-only');
const KIND_FILTER = value('kind', '') as DecisionKind | '';
/**
 * Re-run named decision points and nothing else, e.g. --only po_92128055_11,th_15681836_57.
 *
 * This is how a behaviour fix gets evidence rather than a claim: run the two cases the last full
 * pass got wrong and show they now come out differently. A filtered run deliberately does NOT
 * overwrite the cached scores, because those 15 cases are the baseline the fix is measured against
 * and a two-case run would silently replace them.
 */
const ONLY = value('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const FILTERED = ONLY.length > 0 || !!KIND_FILTER;

// ───────────────────────────────────────────────────────────────── the fixture
//
// 930 is chosen because nothing else in this repo uses it: _pipeline-e2e on 920/921,
// _outcome-loop and _call-thread on 9009xx/91x, _post-quote on 900997. Two suites sharing a test
// number is how a green run starts depending on run order.
const PHONE = '+447700900930';
const PHONE_DIGITS = '447700900930';
const PHONE_KEY10 = '7700900930';
const CONV_KEY = '447700900930@c.us';
const CONV_ID = 'backtest_conv';

/** Ids this run created, so teardown never guesses and never deletes by pattern alone. */
const created = { quotes: [] as string[], messages: [] as string[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Neon drops connections under load from this machine. A timeout is not a finding. */
async function retry<T>(label: string, fn: () => Promise<T>, tries = 6): Promise<T> {
    let last: any;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); } catch (e: any) {
            last = e;
            if (!/ETIMEDOUT|ECONNRESET|timeout|terminating connection|fetch failed|socket hang up/i.test(String(e?.message))) throw e;
            console.log(`      (${label} timed out, retry ${i + 1}/${tries})`);
            await sleep(1500 * (i + 1));
        }
    }
    throw last;
}

/** A model failure we cannot spend our way past. Stop the run, keep the scores, say where we got to. */
function isFatalApiError(e: any): string | null {
    const m = `${e?.message ?? ''} ${e?.error?.message ?? ''} ${e?.status ?? ''}`;
    if (/credit balance|insufficient (?:credit|funds|quota)|billing|payment required|402/i.test(m)) return 'API credit exhausted';
    if (/invalid[_ ]api[_ ]key|authentication|401|permission/i.test(m)) return 'API key rejected';
    if (/rate[_ ]?limit|429/i.test(m)) return 'rate limited';
    if (/overloaded|529/i.test(m)) return 'model overloaded';
    return null;
}

async function tearDown(): Promise<void> {
    const del = async (label: string, stmt: any) => {
        try { await db.execute(stmt); } catch (e: any) { console.warn(`  teardown ${label}: ${e.message}`); }
    };
    // The ledger first: its rows reference the drafts and questions below.
    await del('outcomes', sql`DELETE FROM agent_outcomes WHERE phone_key = ${PHONE_KEY10}`);
    await del('drafts', sql`DELETE FROM message_drafts WHERE phone = ${PHONE}`);
    await del('questions', sql`DELETE FROM agent_questions WHERE phone = ${PHONE}`);
    await del('messages', sql`DELETE FROM messages WHERE conversation_id = ${CONV_ID}`);
    await del('conversation', sql`DELETE FROM conversations WHERE id = ${CONV_ID}`);
    // Quotes are keyed by the fixture phone, so this cannot reach a real one.
    await del('quotes', sql`DELETE FROM personalized_quotes WHERE phone = ${PHONE}`);
    created.quotes.length = 0;
    created.messages.length = 0;
}

/**
 * Rebuild the thread as it stood at the decision moment.
 *
 * The whole prefix is rebased onto now, keeping the real gaps between messages, so that the
 * trigger landed three minutes ago. That is not cosmetic: the 24h WhatsApp window, the SLA wait
 * state and the quote's own "hours since sent" are all computed from wall-clock time, and a
 * fixture stamped in April would be judged by an agent that correctly refuses to draft into a
 * window that shut four months ago.
 */
async function stage(point: DecisionPoint): Promise<void> {
    await tearDown();

    const anchor = Date.now() - 3 * 60_000;
    const boardStage = point.quote ? 'quote_sent' : 'enquiry';

    await retry('insert conversation', () => db.insert(conversations).values({
        id: CONV_ID,
        phoneNumber: CONV_KEY,
        contactName: `${point.firstName} (backtest, reserved number)`,
        status: 'active', stage: boardStage, priority: 'normal', tags: ['backtest'],
    }).then(() => undefined));

    let i = 0;
    for (const m of point.prefix) {
        const id = `bt_msg_${point.id}_${i++}`;
        const at = new Date(anchor - m.msBefore);
        await retry('insert message', () => db.insert(messages).values({
            id,
            conversationId: CONV_ID,
            direction: m.fromMe ? 'outbound' : 'inbound',
            channel: 'whatsapp',
            content: m.body,
            type: 'text',
            status: 'delivered',
            senderName: m.fromMe ? 'Ben' : `${point.firstName} (backtest)`,
            createdAt: at,
        }).then(() => undefined));
        created.messages.push(id);
    }

    await retry('update conversation activity', () => db.update(conversations).set({
        lastInboundAt: new Date(anchor),
        lastCustomerContactAt: new Date(anchor),
        lastMessageAt: new Date(anchor),
        lastMessagePreview: point.triggerText.slice(0, 50),
        canSendFreeform: true,
    }).where(eq(conversations.id, CONV_ID)).then(() => undefined));

    if (point.quote) {
        const q = point.quote;
        const id = `bt_quote_${q.slug}`;
        const createdAt = new Date(anchor - q.sentMsBefore);
        await retry('insert quote', () => db.insert(personalizedQuotes).values({
            id,
            shortSlug: q.slug,
            customerName: point.firstName,
            phone: PHONE,
            jobDescription: q.jobDescription || 'Backtest fixture',
            basePrice: q.totalPence,
            selectedTierPricePence: q.totalPence,
            depositAmountPence: q.depositPence,
            pricingLineItems: q.lines.map((l, n) => ({
                lineId: `${q.slug}_${n}`,
                description: l.description,
                guardedPricePence: l.pence,
                materialsWithMarginPence: 0,
            })),
            optionalExtras: q.optionalExtras.map((e) => ({ label: e.label, priceInPence: e.pricePence })),
            availableDates: q.availableDates,
            surveyRequired: q.surveyRequired,
            viewCount: q.viewCount,
            viewedAt: q.viewCount > 0 ? new Date(createdAt.getTime() + 3600_000) : null,
            lastViewedAt: q.viewCount > 0 ? new Date(anchor - 4 * 3600_000) : null,
            // Deliberately not expired: whether the agent handles an expired quote is a different
            // experiment, and letting it vary here would confound every lever score.
            expiresAt: new Date(Date.now() + 5 * 86_400_000),
            isDraft: false,
            createdAt, updatedAt: createdAt,
        }).then(() => undefined));
        created.quotes.push(id);
    }
}

// ──────────────────────────────────────────────────────────────────── scoring

interface CaseResult {
    point: DecisionPoint;
    ok: boolean;
    error?: string;
    /** The complete drafted reply, exactly as Ben would have seen it in the queue. */
    draftBody: string | null;
    draftIntent: string | null;
    askedBen: { question: string; options: string[] } | null;
    boardState: any | null;
    agentClass: LeverClass;
    agentOpening: OpeningClass;
    /** Guard refusals the agent hit DURING the run — the guards doing their job, and a prompt smell. */
    guardRefusals: string[];
    /** Violations still present in the final draft. Anything here is a hole in the tool boundary. */
    residualViolations: DraftViolation[];
    voice: VoiceFinding[];
    turns: number;
    finalText: string;
}

/**
 * The drafts that actually LANDED in the queue.
 *
 * `outcome.actions` is built from tool_CALLS, so it includes attempts the guard threw out. Scoring
 * those as the agent's answer is how a run where the capitulation guard fired and the agent then
 * correctly went to Ben gets recorded as "the agent capitulated" — the exact opposite of what
 * happened. Calls and their outcomes appear in the transcript in the same order, so the nth
 * queue_draft call is settled by the nth queue_draft result.
 */
function draftsFrom(outcome: CommsAgentOutcome): { body: string; intent: string; quote_slug?: string }[] {
    const calls = outcome.result.transcript
        .filter((e) => e.type === 'tool_call' && e.detail?.tool === 'queue_draft')
        .map((e) => e.detail.input ?? {});
    const settled = outcome.result.transcript
        .filter((e) => (e.type === 'tool_result' || e.type === 'tool_error') && e.detail?.tool === 'queue_draft')
        .map((e) => e.type === 'tool_result' && e.detail?.result?.queued !== false);
    return calls
        .filter((_c, i) => settled[i] === true)
        .map((c) => ({ body: String(c.body ?? ''), intent: String(c.intent ?? 'other'), quote_slug: c.quote_slug }));
}

function scoreCase(point: DecisionPoint, outcome: CommsAgentOutcome, quoteCtx: any | null): CaseResult {
    const drafts = draftsFrom(outcome);
    const last = drafts[drafts.length - 1] ?? null;
    // 21 Aug 2026: ask_ben became flag_for_ben ({ note }). The old shape is kept for replaying
    // transcripts recorded before the change.
    const ask = outcome.actions.find((a) => a.tool === 'flag_for_ben' || a.tool === 'ask_ben') ?? null;
    const board = outcome.actions.find((a) => a.tool === 'set_board_state') ?? null;

    const guardRefusals = outcome.result.transcript
        .filter((e) => e.type === 'tool_error' && e.detail?.tool === 'queue_draft')
        .map((e) => String(e.detail?.error ?? '').slice(0, 300));

    const body = last?.body ?? null;

    // An agent that drafts nothing and asks Ben has escalated. One that does neither did nothing.
    //
    // A run that DRAFTS AND ASKS is classified on its draft, because that is what the customer
    // receives. Note that classifyLever may still call that draft 'escalate' on its own wording
    // ("let me check with the team and come back to you") — correctly, since that is the class Ben's
    // own taxonomy gives the same sentence. What matters for the over-escalation count is not the
    // class but whether a reply exists at all, which is why that metric keys on draftBody below.
    const agentClass: LeverClass = body
        ? classifyLever(body)
        : ask ? 'escalate' : 'no_reply';
    const agentOpening: OpeningClass = body
        ? classifyOpening(body)
        : ask ? 'escalate' : 'no_reply';

    // Re-run the shipped guard chain against the final body. The tool already enforced this, so a
    // hit here means something got past the boundary. (No allowed-figure set any more: since
    // 21 Aug 2026 ANY money figure is a violation, whatever quote it came from.)
    let residual: DraftViolation[] = [];
    if (body) {
        const v = checkDraft({
            body,
            intent: last!.intent,
            quoteSeen: !!quoteCtx && (quoteCtx.viewCount > 0 || !!quoteCtx.firstViewedAt),
            quoteViewCount: quoteCtx?.viewCount,
            offeredDates: quoteCtx?.offeredDates ?? [],
            quoteTotalPence: quoteCtx?.totalPence ?? null,
        });
        if (v) residual = [v];
    }

    return {
        point,
        ok: true,
        draftBody: body,
        draftIntent: last?.intent ?? null,
        askedBen: ask ? { question: String(ask.input?.note ?? ask.input?.question ?? ''), options: (ask.input?.options ?? []) as string[] } : null,
        boardState: board?.input ?? null,
        agentClass,
        agentOpening,
        guardRefusals,
        residualViolations: residual,
        voice: body ? checkVoice(body) : [],
        turns: outcome.result.turns,
        finalText: outcome.result.finalText.slice(0, 400),
    };
}

/** The axis this decision point is graded on. A first reply is not a negotiation. */
function axisFor(r: CaseResult): { ben: string; agent: string; comparable: boolean } {
    if (r.point.kind === 'first_reply') {
        return {
            ben: r.point.bensOpening,
            agent: r.agentOpening,
            comparable: r.point.bensOpening !== 'no_reply',
        };
    }
    return {
        ben: r.point.bensClass,
        agent: r.agentClass,
        // Silence IS a comparable move: it is a row in the objection table and it lost. A voice
        // note is not — it is a channel a text agent cannot use, and grading against it would be
        // arithmetic rather than evidence.
        comparable: isRanked(r.point.bensClass),
    };
}

/**
 * Is this a point where the lever RANKING may be applied at all?
 *
 * Only price objections. The rank order (re-scope > hold > capitulate) comes from one table of 19
 * post-quote objections and nothing else. Applying it to a "waiting on my partner" message would
 * say the agent doing nothing scored WORSE than a human saying "ok no problem", which is not a
 * finding, it is the rank being used outside the population it was measured on.
 */
const rankable = (r: CaseResult) => r.point.kind === 'price_objection';

/**
 * The escalation that actually costs money: handed to Ben AND the customer left with silence.
 *
 * Asking Ben is not the failure. A turn is now allowed to draft the half the agent owns and ask him
 * the half he owns, which is the shape of the reply that won the £984 shed thread. What cost that
 * job was the version with no draft in it, where the customer heard nothing until a human got to
 * the queue. So this keys on the absence of a reply, not on the presence of a question — and not on
 * the lever class either, since "let me check with the team and I'll come back to you" classifies
 * as 'escalate' while being a perfectly good thing for a customer to receive.
 */
const overEscalation = (r: CaseResult) => !r.draftBody && !!r.askedBen;

/** Both moves ranked, on a point where ranking is meaningful. */
function rankPair(r: CaseResult): { ben: number; agent: number } | null {
    if (!rankable(r)) return null;
    const ben = LEVER_RANK[r.point.bensClass], agent = LEVER_RANK[r.agentClass];
    return ben >= 0 && agent >= 0 ? { ben, agent } : null;
}

/**
 * How interesting a disagreement is, for the verbatim list. Weighted towards the failures that
 * cost money (capitulating where he held, escalating where he coped) and the wins that make money
 * (beating a move that is known to have lost), because that list is the artefact people actually
 * use to tune the prompt.
 */
function interestScore(r: CaseResult): number {
    const axis = axisFor(r);
    let s = 0;
    if (axis.comparable && axis.ben !== axis.agent) s += 2;
    if (r.point.kind !== 'first_reply') {
        if (r.agentClass === 'capitulate' && (r.point.bensClass === 'hold_with_reason' || r.point.bensClass === 'rescope')) s += 4;
        if (overEscalation(r) && isRanked(r.point.bensClass)) s += 3;
        const rank = rankPair(r);
        if (rank && rank.agent > rank.ben && !r.point.converted) s += 4;   // beat a move that lost
        if (rank && rank.agent < rank.ben && r.point.converted) s += 4;    // undercut a move that won
    } else if (r.point.bensOpening === 'ask_photo' && r.agentOpening !== 'ask_photo') {
        s += 3;
    }
    s += r.residualViolations.length * 5;
    s += r.guardRefusals.length * 2;
    s += r.voice.length;
    if (r.point.kind === 'price_objection') s += 1;
    return s;
}

// ───────────────────────────────────────────────────────────────── reporting

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : '  -');
const box = (title: string) => console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
const indent = (s: string, pad = '      ') => s.split('\n').map((l) => pad + l).join('\n');

function report(results: CaseResult[], halted: string | null, inventory: DecisionPoint[]): number {
    const done = results.filter((r) => r.ok);

    box('AGGREGATE');
    if (!done.length) {
        console.log('  No decision points completed.');
        return 1;
    }

    const rows: any[] = [];
    for (const kind of ['price_objection', 'first_reply', 'timing_hold'] as DecisionKind[]) {
        const g = done.filter((r) => r.point.kind === kind);
        if (!g.length) continue;
        const comparable = g.filter((r) => axisFor(r).comparable);
        const agree = comparable.filter((r) => axisFor(r).ben === axisFor(r).agent);
        const capitulatedWhereHeHeld = g.filter((r) => r.agentClass === 'capitulate'
            && (r.point.bensClass === 'hold_with_reason' || r.point.bensClass === 'rescope'));
        const escalatedWhereHeCoped = g.filter((r) => overEscalation(r) && isRanked(r.point.bensClass));
        const better = g.filter((r) => { const k = rankPair(r); return !!k && k.agent > k.ben; });
        const worse = g.filter((r) => { const k = rankPair(r); return !!k && k.agent < k.ben; });
        rows.push({
            decision_point: kind,
            n: g.length,
            gradable: comparable.length,
            agreed: `${agree.length} (${pct(agree.length, comparable.length)})`,
            capitulated_where_he_held: capitulatedWhereHeHeld.length,
            escalated_where_he_coped: `${escalatedWhereHeCoped.length} (${pct(escalatedWhereHeCoped.length, g.length)})`,
            better_class: kind === 'price_objection' ? better.length : 'n/a',
            worse_class: kind === 'price_objection' ? worse.length : 'n/a',
            drafted: g.filter((r) => r.draftBody).length,
            guard_refusals: g.reduce((s, r) => s + r.guardRefusals.length, 0),
            residual_violations: g.reduce((s, r) => s + r.residualViolations.length, 0),
            voice_findings: g.reduce((s, r) => s + r.voice.length, 0),
        });
    }
    console.table(rows);

    const comparable = done.filter((r) => axisFor(r).comparable);
    const agreed = comparable.filter((r) => axisFor(r).ben === axisFor(r).agent);
    const escalated = done.filter((r) => !!r.askedBen);
    const draftedAndAsked = escalated.filter((r) => !!r.draftBody);
    const overEscalated = done.filter((r) => overEscalation(r) && isRanked(r.point.bensClass));
    const silent = done.filter((r) => !r.draftBody && !r.askedBen);
    const capit = done.filter((r) => r.agentClass === 'capitulate');
    const better = done.filter((r) => { const k = rankPair(r); return !!k && k.agent > k.ben; });
    const betterOnLosers = better.filter((r) => !r.point.converted);
    const worseOnWinners = done.filter((r) => { const k = rankPair(r); return !!k && k.agent < k.ben && r.point.converted; });
    const templated = done.filter((r) => r.point.bensReplyWasTemplate);
    const residual = done.flatMap((r) => r.residualViolations.map((v) => ({ id: r.point.id, ...v })));
    const refusals = done.flatMap((r) => r.guardRefusals.map((g) => ({ id: r.point.id, refusal: g })));
    const voiceHits = done.flatMap((r) => r.voice.map((v) => ({ id: r.point.id, ...v })));

    console.log(`
  decision points scored ......... ${done.length} of ${results.length} attempted (${inventory.length} available in the corpus)
  gradable against Ben .......... ${comparable.length}   (the rest: he answered by voice note, a channel this agent has not got)
  AGREEMENT with Ben ............ ${agreed.length}/${comparable.length} (${pct(agreed.length, comparable.length)})
  drafted a reply ............... ${done.filter((r) => r.draftBody).length}
  asked Ben ..................... ${escalated.length}   of which ALSO drafted (the intended shape): ${draftedAndAsked.length}
  OVER-escalation ............... ${overEscalated.length} (${pct(overEscalated.length, done.length)})   asked Ben, drafted NOTHING, and he had coped alone
  said nothing at all ........... ${silent.length}   (no draft, no question)
  capitulated ................... ${capit.length}   of which where he held or re-scoped: ${capit.filter((r) => r.point.bensClass === 'hold_with_reason' || r.point.bensClass === 'rescope').length}
  BETTER class than Ben ......... ${better.length}   of which on threads that did NOT convert: ${betterOnLosers.length}
  WORSE class than Ben .......... ${worseOnWinners.length} (on threads that DID convert)
      (better/worse are PRICE OBJECTIONS ONLY — the rank order comes from one table of 19 of them)
  "his" reply was really OUR copy ${templated.length}   (auto-ack or quote-send template, not a human choosing)
  guard refusals during runs .... ${refusals.length}
  violations left in the draft .. ${residual.length}   ${residual.length ? '*** a hole in the tool boundary ***' : '(the boundary held)'}
  voice-rule findings ........... ${voiceHits.length}`);

    if (residual.length) {
        box('VIOLATIONS THAT SURVIVED THE TOOL BOUNDARY');
        for (const v of residual) console.log(`  ${v.id}  [${v.code}] ${v.message.slice(0, 200)}`);
    }
    if (refusals.length) {
        box('GUARD REFUSALS DURING RUNS (the guard working, and a prompt that keeps trying it)');
        const byCode: Record<string, number> = {};
        for (const r of refusals) {
            const code = /discount/i.test(r.refusal) ? 'discount_offer'
                : /contains a money figure|not on quote|only figures/i.test(r.refusal) ? 'money_figure'
                    : /capitulat/i.test(r.refusal) ? 'capitulation'
                        : /commits to a date/i.test(r.refusal) ? 'date_promise'
                            : /implies they have not seen/i.test(r.refusal) ? 'implies_unseen'
                                : /24-hour window/i.test(r.refusal) ? 'window_shut'
                                    : 'other';
            byCode[code] = (byCode[code] ?? 0) + 1;
        }
        console.table(Object.entries(byCode).map(([code, n]) => ({ refusal: code, n })));
        for (const r of refusals.slice(0, 8)) console.log(`  ${r.id}: ${r.refusal.slice(0, 180)}`);
    }
    if (voiceHits.length) {
        box('VOICE FINDINGS (style, not safety — the guards do not check these)');
        const byRule: Record<string, number> = {};
        for (const v of voiceHits) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
        console.table(Object.entries(byRule).map(([rule, n]) => ({ rule, n })));
        for (const v of voiceHits.slice(0, 10)) console.log(`  ${v.id} [${v.rule}] ${v.detail}`);
    }

    // ---- the artefact that is actually worth reading ----
    box('THE 10 MOST INTERESTING DISAGREEMENTS — Ben on the left, the agent on the right');
    const interesting = [...done].sort((a, b) => interestScore(b) - interestScore(a)).slice(0, 10);
    let n = 0;
    for (const r of interesting) {
        const axis = axisFor(r);
        const p = r.point;
        n++;
        console.log(`\n${'-'.repeat(78)}`);
        console.log(`${n}. ${p.kind}  ·  ${p.firstName}  ·  ${p.bucket}${p.quote ? `  ·  £${(p.quote.totalPence / 100).toFixed(2)} (${priceBandFor(p.quote.totalPence).label})` : ''}`);
        console.log(`   Ben: ${axis.ben}    Agent: ${axis.agent}${axis.ben === axis.agent ? '  (agreed)' : ''}   intent=${r.draftIntent ?? '-'}   turns=${r.turns}`);
        console.log(`\n   CUSTOMER SAID:\n${indent(p.triggerText)}`);
        console.log(`\n   ${p.bensReplyWasTemplate ? 'WHAT THEY ACTUALLY GOT (our own template, not Ben typing)' : 'BEN ACTUALLY SAID'}${p.converted ? '  (and this thread PAID)' : '  (and this thread did not convert)'}:`);
        console.log(p.bensReply.length ? indent(p.bensReply.join('\n---\n')) : indent(p.bensClass === 'voice_note' ? '[voice note — no text]' : '[nothing at all]'));
        console.log(`\n   THE AGENT DRAFTED:`);
        console.log(r.draftBody ? indent(r.draftBody) : indent(r.askedBen ? '[no draft]' : `[no draft, no question] ${r.finalText.slice(0, 200)}`));
        // A draft AND an ask in the same turn is the intended shape, not a contradiction: the
        // customer gets the half the agent owns while Ben decides the half he owns. Printing only
        // one of them hid exactly the behaviour the draft-and-ask change was made to produce.
        if (r.askedBen) {
            console.log(`\n   AND ASKED BEN${r.draftBody ? ' (in the same turn as that draft)' : ' INSTEAD OF REPLYING'}:`);
            console.log(indent(`${r.askedBen.question}\n  options: ${r.askedBen.options.join(' | ')}`));
        }
        if (r.guardRefusals.length) console.log(`\n   GUARD REFUSED FIRST:\n${indent(r.guardRefusals[0].slice(0, 220))}`);
        if (r.residualViolations.length) console.log(`\n   *** VIOLATION IN THE FINAL DRAFT: ${r.residualViolations.map((v) => v.code).join(', ')}`);
        if (r.voice.length) console.log(`\n   voice: ${r.voice.map((v) => v.rule).join(', ')}`);
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
        box('CASES THAT DID NOT RUN');
        for (const f of failed) console.log(`  ${f.point.id} (${f.point.kind}): ${f.error}`);
    }
    if (halted) {
        box('RUN HALTED EARLY');
        console.log(`  ${halted}`);
        console.log(`  Scored ${done.length} of the ${LIMIT} requested. Re-run when it clears; fixtures are cached, so`);
        console.log(`  only the model calls are repeated.`);
    }
    return 0;
}

// ────────────────────────────────────────────────────────────────────── main

async function main(): Promise<void> {
    // ---- re-print the last run for free. Scoring is cheap; the model calls are not, and after a
    // halted run this is how you read what did complete without paying for it twice. ----
    if (REPORT_ONLY) {
        const cached = readCache();
        const results = (cached.results ?? []) as CaseResult[];
        if (!results.length) {
            console.error('No cached results. Run the backtest once first.');
            process.exit(1);
        }
        console.log(`\n  Re-reporting ${results.length} cached case(s) from ${cached.ranAt ?? 'an earlier run'}. No model calls.`);
        report(results, null, cached.decisionPoints ?? []);
        process.exit(0);
    }

    // ---- fixtures (cached: re-running does not re-parse 10,267 messages) ----
    let points: DecisionPoint[] = readCache().decisionPoints ?? [];
    if (REFRESH || !points.length) {
        if (!fs.existsSync(DUMP_PATH)) {
            console.error(`Corpus not found at ${DUMP_PATH}. It is gitignored (customer PII) — restore the export first.`);
            process.exit(1);
        }
        console.error('[extract] parsing the corpus…');
        const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8'));
        const { quotes, invoices } = await loadOutcomes(REFRESH);
        points = extractDecisionPoints(assemble(dump, quotes, invoices));
        writeCache({ decisionPoints: points, extractedAt: new Date().toISOString() });
    }
    if (KIND_FILTER) points = points.filter((p) => p.kind === KIND_FILTER);
    if (ONLY.length) {
        points = points.filter((p) => ONLY.includes(p.id));
        const missing = ONLY.filter((id) => !points.some((p) => p.id === id));
        if (missing.length) {
            console.error(`--only: no such decision point(s): ${missing.join(', ')}. Re-cut with --refresh?`);
            if (!points.length) process.exit(1);
        }
    }

    box('DECISION POINTS AVAILABLE IN THE CORPUS');
    const inv: any[] = [];
    for (const kind of ['price_objection', 'first_reply', 'timing_hold'] as DecisionKind[]) {
        const g = points.filter((p) => p.kind === kind);
        if (!g.length) continue;
        const classes: Record<string, number> = {};
        for (const p of g) classes[kind === 'first_reply' ? p.bensOpening : p.bensClass] = (classes[kind === 'first_reply' ? p.bensOpening : p.bensClass] ?? 0) + 1;
        inv.push({
            decision_point: kind, n: g.length,
            paid: g.filter((p) => p.converted).length,
            with_quote: g.filter((p) => p.quote).length,
            bens_moves: Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '),
        });
    }
    console.table(inv);

    const selected = interleaveForSpend(points, LIMIT);
    console.log(`\n  Selected ${selected.length} for this run (--limit ${LIMIT}). Price objections are ranked first:`);
    for (const p of selected) {
        console.log(`    ${p.kind.padEnd(16)} ${p.id.padEnd(18)} ${p.firstName.padEnd(12)} ${p.bucket.padEnd(20)} ben=${p.kind === 'first_reply' ? p.bensOpening : p.bensClass}${p.quote ? ` £${(p.quote.totalPence / 100).toFixed(0)}` : ''}`);
    }

    if (EXTRACT_ONLY) {
        console.log('\n  --extract-only: no model calls, no database writes. Done.\n');
        process.exit(0);
    }

    // ---- config: force the dangerous switches off for the duration ----
    const saved = await retry('read config', getCommsAgentConfig);
    if (saved.firstContactAutoAck.enabled) {
        console.warn('\n*** firstContactAutoAck was ENABLED before this run. It will be left DISABLED. ***');
    }
    await retry('disable autosend', () => setCommsAgentConfig({
        autosend: { ...saved.autosend, enabled: false },
        firstContactAutoAck: { ...saved.firstContactAutoAck, enabled: false },
    }));

    const results: CaseResult[] = [];
    let halted: string | null = null;

    try {
        for (const point of selected) {
            box(`${results.length + 1}/${selected.length}  ${point.kind}  ${point.firstName}  ${point.id}`);
            console.log(`  customer: ${point.triggerText.slice(0, 160).replace(/\n/g, ' ')}`);
            try {
                await stage(point);
                // The real agent, the real tools, the real guards. Nothing is stubbed.
                const outcome = await runCommsAgent(CONV_ID, 'inbound_message');
                const ctx = point.quote
                    ? (await loadQuoteContexts({ digits: PHONE_DIGITS, conversationId: CONV_ID }).catch(() => []))[0] ?? null
                    : null;
                const scored = scoreCase(point, outcome, ctx);
                results.push(scored);
                console.log(`  → ben=${point.kind === 'first_reply' ? point.bensOpening : point.bensClass}  agent=${point.kind === 'first_reply' ? scored.agentOpening : scored.agentClass}  refusals=${scored.guardRefusals.length}  voice=${scored.voice.length}`);
            } catch (e: any) {
                const fatal = isFatalApiError(e);
                results.push({
                    point, ok: false, error: String(e?.message ?? e).slice(0, 300),
                    draftBody: null, draftIntent: null, askedBen: null, boardState: null,
                    agentClass: 'no_reply', agentOpening: 'no_reply',
                    guardRefusals: [], residualViolations: [], voice: [], turns: 0, finalText: '',
                });
                console.error(`  FAILED: ${String(e?.message ?? e).slice(0, 200)}`);
                if (fatal) { halted = `${fatal} — ${String(e?.message ?? e).slice(0, 160)}`; break; }
            } finally {
                await tearDown();
            }
        }
    } finally {
        // Scores are saved BEFORE anything else in this block, so a halted run (an exhausted
        // balance, a dropped connection) still leaves everything it managed to buy on disk.
        // A FILTERED run never overwrites them: --only exists to re-test two cases against the
        // 15-case baseline, and replacing the baseline with the two would erase what it is measured
        // against (and break --report-only for everyone else).
        if (!FILTERED) {
            try { writeCache({ results, ranAt: new Date().toISOString() }); } catch { /* report still prints */ }
        } else {
            console.log(`\n  (filtered run: the cached ${readCache().results?.length ?? 0}-case baseline is left untouched)`);
        }

        // ---- teardown, then prove the database is as we found it ----
        await tearDown();
        const leftovers: Record<string, number> = {};
        for (const [label, stmt] of [
            ['conversations', sql`SELECT count(*)::int n FROM conversations WHERE id = ${CONV_ID}`],
            ['messages', sql`SELECT count(*)::int n FROM messages WHERE conversation_id = ${CONV_ID}`],
            ['drafts', sql`SELECT count(*)::int n FROM message_drafts WHERE phone = ${PHONE}`],
            ['questions', sql`SELECT count(*)::int n FROM agent_questions WHERE phone = ${PHONE}`],
            ['quotes', sql`SELECT count(*)::int n FROM personalized_quotes WHERE phone = ${PHONE}`],
        ] as const) {
            try {
                const r: any = await db.execute(stmt as any);
                leftovers[label] = Number((r.rows ?? r)[0]?.n ?? 0);
            } catch { leftovers[label] = -1; }
        }
        const clean = Object.values(leftovers).every((n) => n === 0);

        // ---- config restore. firstContactAutoAck ends DISABLED whatever it was. ----
        let readBack: any = null;
        try {
            await retry('restore config', () => setCommsAgentConfig({
                autosend: saved.autosend,
                firstContactAutoAck: { ...saved.firstContactAutoAck, enabled: false },
            }));
            readBack = await retry('read back config', getCommsAgentConfig);
        } catch (e: any) {
            console.error(`\n*** CONFIG RESTORE FAILED: ${e?.message} — CHECK firstContactAutoAck BY HAND ***`);
        }

        report(results, halted, points);

        box('THE DATABASE IS AS WE FOUND IT');
        console.table(Object.entries(leftovers).map(([table, n]) => ({ table, rows_left: n })));
        console.log(`  ${clean ? 'clean' : '*** ROWS LEFT BEHIND — clean them by hand ***'}`);
        if (readBack) {
            console.log(`\n  CONFIG READ BACK FROM THE DATABASE:`);
            console.log(`    firstContactAutoAck.enabled = ${readBack.firstContactAutoAck.enabled}`);
            console.log(`    autosend.enabled            = ${readBack.autosend.enabled}`);
            if (readBack.firstContactAutoAck.enabled) {
                console.error('\n*** WARNING: firstContactAutoAck IS STILL ENABLED. Disable it before leaving. ***');
            }
        } else {
            console.error('\n*** CONFIG NOT READ BACK — verify firstContactAutoAck by hand. ***');
        }
        console.log('');
        process.exit(clean && readBack && !readBack.firstContactAutoAck.enabled ? 0 : 1);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
