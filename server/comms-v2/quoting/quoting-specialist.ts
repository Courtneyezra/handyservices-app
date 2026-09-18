/**
 * The Quoting specialist, on Sonnet 5 at medium effort. Subject: the quote. Drafts it for Ben the
 * moment the job and the location are known, photos optional (answer 3); after Ben has priced and
 * sent it, answers what is included, what is excluded, the prices already on it and what happens
 * on the day, from the quote itself (answer 7). Returns facts with their source and a proposal;
 * never a sentence for the customer.
 *
 * Two halves, like Scoping. The model does two structured jobs and sees no figure in either: before
 * the draft it turns the thread into the clerk's intake (lines, what matters for pricing, what is
 * not included, what Ben may want to request); after the quote it names which labels of the quote
 * a question concerns, whether the question is money beyond a line, whether the customer accepted
 * in chat, whether they are not ready. The tool server (quoting-tools.ts) does the rest
 * deterministically: the draft through the existing chain, one notification to Ben, the quote's
 * lines onto the file as facts cited to the line and to the penny, the holds. The composer writes;
 * the figure guard checks every amount against the cited line.
 *
 * Holds (design.md, "Who handles what"): any money question beyond a quote line, and acceptance,
 * which stays human permanently: a "yes" in chat is pointed at the quote page and held for Ben.
 *
 * An expired quote is reissued (reissue.ts): the turn is read as on a live quote, and when it asks
 * nothing Ben must answer the specialist offers the desk a reissue (`QuotingReturn.reissue`). The
 * desk claims it only once every other hold on the turn and the thread is known, and then asks
 * `afterReissue` for the brief the reply is written from. Revoked and superseded quotes, and an
 * expired one the desk does not reissue, hold for Ben as before.
 */
import { z } from 'zod/v4';
import { isReady, type CaseFile, type ModelCallRecord, type Party, type Turn, isTurnOf } from '../desk/case-file';
import type { Proposal, SpecialistReturn } from '../desk/desk-types';
import { plainPriceAsk } from '../desk/lexicon';
import { SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import type { Route, RouterOutput } from '../desk/router';
import { CUSTOMER_TYPES, type DraftIntake } from './draft-quote';
import { DEPOSIT_LABEL, QUOTE_FACT, TOTAL_LABEL, factsWithPrefix, figureLabels, lastIssue, newestFact, pounds, quoteLiveForFigures, readQuoteLine, type QuoteRecord, type QuoteStatus } from './quote-record';
import { chase, draftQuote, loadQuote, quoteReadiness, recordQuoteFacts, recordReissue, reissueRecorded, resolveQuotingDeps, type QuotingDeps } from './quoting-tools';
import { draftPending, startBackgroundDraft, type BackgroundDraftHooks } from './background-draft';

// ---------------------------------------------------------------- the two structured outputs

export const LINE_CATEGORIES = ['mounting', 'carpentry', 'plaster', 'painting', 'plumbing', 'electrical_minor', 'general_fixing', 'garden', 'flooring', 'tiling', 'other'] as const;

/**
 * Before the draft: the clerk's intake. Short labels only; never a figure of money.
 *
 * Every cap here is deliberately generous and the real limits are applied by `clampIntake` after
 * the parse. A structured-output call constrains the SHAPE, not a string's length: a model that
 * writes a 41-character label where the schema said 40 fails the parse and the whole intake is
 * lost, which cost a live run. The prompt asks for short; the clamp enforces it.
 */
export const intakeOutputSchema = z.object({
    lines: z.array(z.object({
        title: z.string().min(1).max(400),
        category: z.enum(LINE_CATEGORIES).nullable(),
        qty: z.number().int().min(1).max(99),
        /** What matters for pricing, in the customer's words where possible. Never a figure. */
        detail: z.string().max(1000).nullable(),
        assumptions: z.array(z.string().min(1).max(400)).max(12),
        notIncluded: z.array(z.string().min(1).max(400)).max(12),
    })).min(1).max(16),
    customerType: z.enum(CUSTOMER_TYPES),
    /** What Ben may want to request before pricing, as short labels ("which tap", "wall material"). */
    missing: z.array(z.string().min(1).max(300)).max(12),
});
export type IntakeOutput = z.infer<typeof intakeOutputSchema>;

const clamp = (s: string, n: number): string => { const t = s.trim(); return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`; };

/** The lengths the prompt asks for, applied after the parse so a long answer is trimmed, never lost. */
export function clampIntake(out: IntakeOutput): IntakeOutput {
    return {
        customerType: out.customerType,
        missing: out.missing.map((m) => clamp(m, 40)).slice(0, 6),
        lines: out.lines.slice(0, 8).map((l) => ({
            title: clamp(l.title, 120),
            category: l.category,
            qty: l.qty,
            detail: l.detail ? clamp(l.detail, 160) : null,
            assumptions: l.assumptions.map((a) => clamp(a, 120)).slice(0, 4),
            notIncluded: l.notIncluded.map((n) => clamp(n, 80)).slice(0, 4),
        })),
    };
}

export const CONCERN_KINDS = ['line_amount', 'total', 'deposit', 'scope', 'not_included', 'on_the_day', 'link', 'status'] as const;

/** The concerns that ask for an amount: each must name a figure the live quote actually carries. */
const FIGURE_KINDS: ReadonlySet<string> = new Set(['line_amount', 'total', 'deposit']);

/** After the draft: what the question concerns, named by label; no amount, no sentence. */
export const questionOutputSchema = z.object({
    concerns: z.array(z.object({ kind: z.enum(CONCERN_KINDS), label: z.string().max(300).nullable() })).max(12),
    /** Money beyond reading a line back: a discount, a haggle, a total the quote does not show, a payment plan. */
    beyondQuoteLine: z.boolean(),
    /** The customer says yes to the quote in chat. */
    acceptanceInChat: z.boolean(),
    /** The customer is not ready ("next month"). */
    notReady: z.boolean(),
});
export type QuestionOutput = z.infer<typeof questionOutputSchema>;

const INTAKE_SYSTEM = [
    'You are the Quoting specialist for a small handyman business\'s desk. You never write to the customer. You turn the thread into the lines of a quote for Ben to price, with no prose and never a figure of money.',
    'lines: one per piece of work, title in plain words ("Replace one 6ft fence panel"), a category, qty, detail (what matters for pricing: size, material, access, what the customer supplies), assumptions the quote will state to the customer, and what is not included. Only what the thread supports; never invent.',
    'Only work the customer asked for is a line. A defect, damage or wear seen only in a photo description is never a line; if Ben may want to ask about it, name it in missing instead.',
    'Gas work (a boiler, a combi, a gas hob, fire or appliance) and asbestos or artex work are never a line: we do not take them on. Quote only the other work they asked for.',
    'customerType: homeowner unless they say landlord, letting agent or business.',
    'missing: up to six short labels of what Ben may want to request before pricing (e.g. "which tap", "wall material", "photo of the panel"). Photos are optional: name them only when they would change the price.',
    'Reply with the JSON object only.',
].join('\n');

const QUESTION_SYSTEM = [
    'You are the Quoting specialist for a small handyman business\'s desk. You never write to the customer and you never see or state a figure. You read the newest customer turn against the quote\'s labels and say what it concerns.',
    'concerns: which labels of the quote the turn asks about. kind line_amount with the label of a line, spelled exactly as the quote spells it and never in the customer\'s own words, total for the quote total, deposit for the deposit, scope for what a line covers, not_included for what is excluded, on_the_day for what happens on the day (the quote\'s assumptions), link when they want the quote link again, status when they ask whether it has been sent or what happens next. Empty when the turn asks nothing about the quote.',
    'beyondQuoteLine: true when the turn asks for money that is not a line already on the quote: a discount, "can you do it for less", a different total, a payment plan, a price for extra work, a comparison with another trader, or how a line splits into labour and materials, which the quote does not state as a line.',
    'acceptanceInChat: true when the turn says yes to the quote, go ahead, book it, or asks how to accept.',
    'notReady: true when the turn defers ("I\'ll get back to you next month", "leave it with me for now").',
    'Reply with the JSON object only.',
].join('\n');

function threadFor(file: CaseFile, turn: Turn): string {
    return file.turns.slice(-14).map((t) => {
        const media = t.media.length ? ` [${t.media.map((m) => m.description ? `${m.kind}: ${m.description.description}` : m.kind).join('; ')}]` : '';
        return `${isTurnOf(t, turn) ? '>> ' : ''}${t.direction === 'inbound' ? 'customer' : 'desk'}: ${t.body}${media}`;
    }).join('\n');
}

// ---------------------------------------------------------------- what the specialist proposes

export type QuotingPhase = 'draft' | 'with_ben' | 'sent' | 'accepted' | 'stale';

export interface QuotingProposal {
    phase: QuotingPhase;
    quoteRef: string | null;
    status: QuoteStatus | null;
    drafted: boolean;
    /** The draft is running off the reply path (background-draft.ts): it is on its way to Ben, not built yet. */
    drafting?: boolean;
    draftError: string | null;
    /**
     * Fact ids the composer should answer from, by what they are. A figure is named by the quote's
     * own label, never the citation its fact is keyed by, and marked when another line shares it.
     */
    answerFrom: { figures: Array<{ label: string; factId: string; shared: boolean }>; scope: string[]; notIncluded: string[]; assumptions: string[]; link: string | null; status: string | null };
    concerns: QuestionOutput['concerns'];
    beyondQuoteLine: boolean;
    acceptanceInChat: boolean;
    notReady: boolean;
    acceptedNow: boolean;
    /** The desk reissued the expired quote this turn: the new total, its fact, and the link the reply opens with. */
    reissued?: { amount: string; factId: string; link: string } | null;
}

/** The composer's brief from the proposal: the first line is the one-line evidence token, the rest instructions. Never a sentence for the customer. */
export function briefLines(p: QuotingProposal): string[] {
    const out: string[] = [];
    const ids = p.answerFrom;
    // Each figure under the quote's own label: a citation's "(line 1)" is the desk's key, not words the
    // customer's quote carries. A title two lines share names no one line, so it lists no figure.
    const figureList = ids.figures.filter((f) => !f.shared).map((f) => `${f.label} = fact ${f.factId}`).join('; ');
    const sharedTitles = Array.from(new Set(ids.figures.filter((f) => f.shared).map((f) => f.label)));
    if (p.phase === 'draft') {
        if (p.drafting) {
            out.push('quoting: drafting the quote for Ben to price');
            out.push('the quote is being put together for Ben to price: nothing about a price exists yet, so no figure; if this turn is a wrap-up, you will put the quote together and send it over, no timing');
        } else if (p.drafted) {
            out.push(`quoting: drafted ${p.quoteRef} for Ben to price`);
            out.push('the quote is with Ben to price: nothing about a price exists yet, so no figure; if this turn is a wrap-up, you will put the quote together and send it over, no timing');
        } else {
            out.push(`quoting: draft failed (${p.draftError ?? 'unknown'})`);
            out.push('nothing has been built for this job and Ben has the thread now: promise nothing about a price, a document or when anything happens, and give no figure; answer anything else they asked from the facts, and say nothing about the quote: it is held for Ben');
        }
    } else if (p.phase === 'with_ben') {
        out.push(`quoting: ${p.quoteRef} with Ben to price`);
        if (ids.scope.length && p.concerns.some((c) => c.kind === 'scope' || c.kind === 'not_included' || c.kind === 'on_the_day')) {
            out.push(`answer what is included from the draft's scope facts (${ids.scope.join(', ')})${ids.notIncluded.length ? ` and what is not included (${ids.notIncluded.join(', ')})` : ''}; no figure, the quote is not priced yet, and no promise about when it comes`);
        } else out.push(`if they ask about the quote: it is with Ben and on its way (fact ${ids.status ?? 'none'}); no figure, no timing`);
    } else if (p.phase === 'stale') {
        out.push(`quoting: ${p.quoteRef} is ${p.status}`);
        out.push(`the quote is ${p.status} (fact ${ids.status ?? 'none'}): no figure may be read from it; it is held for Ben, so say nothing about the quote or its price`);
    } else {
        out.push(p.reissued
            ? `quoting: ${p.quoteRef} expired and was reissued at ${p.reissued.amount} (fact ${p.reissued.factId}); ${ids.figures.length} figures on the file`
            : `quoting: ${p.quoteRef} ${p.status}; ${ids.figures.length} figures on the file`);
        if (p.reissued) {
            out.push(`the reply already opens with a fixed line saying their previous quote expired, that the new price is ${p.reissued.amount} and giving the link ${p.reissued.link}: do not repeat the expiry, the price or the link, and do not apologise for it; answer anything else they asked from the facts below, and if they asked nothing else, one short line saying to reply here with any questions`);
        }
        if (p.acceptedNow) {
            out.push(`they accepted the quote on the quote page (fact ${ids.status ?? 'none'}) and Ben has been told: thank them and say you have it; no date, no time, no promise, no question`);
        } else if (p.acceptanceInChat || p.beyondQuoteLine) {
            // One turn can do both - "yes, go ahead, any chance of a discount for cash?" - and each
            // is owed its own instruction: the card carries the money question to Ben, and the yes
            // is still answered by pointing them at the quote page, where acceptance happens.
            if (p.acceptanceInChat) out.push(`they said yes in chat: acceptance happens on the quote page, so point them to the quote link (fact ${ids.link ?? 'none'}) to accept and pick a date; Ben has been told; no date, no time`);
            if (p.beyondQuoteLine) out.push(`their money question is beyond a line of the quote: give no figure and do not answer it or mention it, it is held for Ben; answer anything else they asked from the quote's scope facts (${ids.scope.join(', ') || 'none'})`);
        } else {
            const asked = p.concerns.filter((c) => c.kind === 'line_amount' || c.kind === 'total' || c.kind === 'deposit').map((c) => c.label ?? c.kind);
            out.push(`answer from the quote only. Figures on it, each copied exactly as written on its fact and its fact id cited: ${figureList || 'none'}${asked.length ? `; they asked about: ${asked.join(', ')}` : ''}`);
            for (const title of sharedTitles) {
                const facts = ids.figures.filter((f) => f.shared && f.label === title).map((f) => `fact ${f.factId}`);
                out.push(`"${title}" is the title of ${facts.length} lines on the quote: the title is shared, so no figure may be read for it; give none of ${facts.join(', ')} and say nothing about its price, it is held for Ben`);
            }
            if (ids.scope.length) out.push(`what each line covers: facts ${ids.scope.join(', ')}${ids.notIncluded.length ? `; not included: ${ids.notIncluded.join(', ')}` : ''}${ids.assumptions.length ? `; what happens on the day (the quote's assumptions): ${ids.assumptions.join(', ')}` : ''}`);
            if (ids.link) out.push(`the quote link is fact ${ids.link}; dates are picked on it`);
            out.push('anything about money beyond these figures: say nothing about it, it is held for Ben');
        }
    }
    if (p.beyondQuoteLine && p.phase !== 'sent' && p.phase !== 'accepted') out.push('their money question is beyond a line of the quote: give no figure and do not answer it or mention it, it is held for Ben');
    if (p.notReady) out.push('they are not ready: one short acknowledgement, no question, and the desk will not chase');
    return out;
}

// ---------------------------------------------------------------- the specialist

export interface QuotingSpecialistDeps extends QuotingDeps {
    /**
     * Drafts off the reply path (background-draft.ts): the pass starts the draft and goes on to its
     * reply. Unset, the draft is awaited inside the pass, as the sandbox door and the tests run it.
     */
    background?: BackgroundDraftHooks;
    /** A draft a restart lost is being started again, from when it was first started (background-draft.ts `draftToRecover`). */
    recoverSince?: string | null;
}

/** The quote is sent or accepted: Scoping is done and the thread is Quoting's. */
export function quotingOwnsThread(file: CaseFile): boolean {
    return file.stage === 'quoted' || file.stage === 'accepted' || file.stage === 'booked';
}

/**
 * The router's post-processing for this specialist, applied to the model's reading before the desk
 * sees it: a portal action (acceptance) is Quoting's turn; while the file's quote is live for
 * figures, a money question goes to Quoting first (checklist 5.3 replaces 2.7) and Quoting holds it
 * when it is beyond a line.
 *
 * The exemption is keyed on that liveness, not on the stage: the stage stays `quoted` after the
 * quote expires, is revoked or is superseded, and there is then no line to answer a figure from, so
 * the ordinary rule that money goes to Ben (2.7) applies again. An empty set is no exemption.
 *
 * One exception to that (the captain's ruling, "reissue for plain asks"): on an expired quote, a
 * message that is nothing but a plain ask of the quote's own price (`plainPriceAsk`, any figure in
 * it one the file recorded as the quote's total) is Quoting's too, so the reissue answers it; any
 * other money-shaped turn stays Ben's with no reissue, and the Quoting reading still blocks the
 * reissue on anything beyond the quote's own lines.
 */
export function applyQuotingRoute(file: CaseFile, turn: Turn, out: RouterOutput, liveFigureRefs: ReadonlySet<string> = new Set(), expiredRefs: ReadonlySet<string> = new Set()): { moneyToQuoting: boolean } {
    if (turn.kind === 'portal_action') {
        out.subjects = ['quoting'];
        out.exception = null;
        out.turnKind = 'acknowledgement';
        return { moneyToQuoting: false };
    }
    const ref = file.job.quoteRef;
    if (out.exception === 'money' && ref && (liveFigureRefs.has(ref) || (expiredRefs.has(ref) && plainPriceAsk(turn.body, quotedTotals(file))))) {
        out.exception = null;
        if (!out.subjects.includes('quoting')) out.subjects.unshift('quoting');
        // Said so, whichever raised it: the exception is gone and Quoting owes the hold if its own
        // reading of the turn does not answer it.
        return { moneyToQuoting: true };
    }
    return { moneyToQuoting: false };
}

function quotedTotals(file: CaseFile): number[] {
    return file.facts.filter((f) => f.key === `${QUOTE_FACT.line}:${TOTAL_LABEL}`).map((f) => Math.round(Number(f.value.replace(/[£,\s]/g, '')) * 100));
}

function emptyProposal(): Proposal {
    return { nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null };
}

/**
 * An expired quote the desk may reissue this turn. `blockers` are what the specialist's own reading
 * of the turn found for Ben (money beyond a line, acceptance in chat, a reading that failed); the
 * desk adds the rest (every other hold, the window, the opt-out ledger) and claims it only when
 * none is left. `concerns` and `notReady` are the reading, kept for the brief after the reissue.
 */
export interface ReissueCandidate {
    slug: string;
    blockers: string[];
    concerns: QuestionOutput['concerns'];
    notReady: boolean;
}

/** Quoting's return: a specialist return, plus the reissue it offers when the file's quote has expired. */
export type QuotingReturn = SpecialistReturn & {
    reissue?: ReissueCandidate;
    /** A reissue on the row this file has no record of telling the customer about, for Ben's card (`unannouncedReissue`). */
    unannounced?: string;
};

/** The hold reason the desk writes for a quote that is no longer live, and the one it reads back to clear its own card once the quote is reissued. */
export const STALE_HOLD = 'the quote is no longer live';

interface TurnReading { output: QuestionOutput | null; error: string | null; record: ModelCallRecord | null }

/** The question model over the newest turn, against the quote's own labels. Skipped (no call) for a pause, an acknowledgement, a promise of more or an empty turn. */
async function readTurn(file: CaseFile, turn: Turn, route: Route, q: QuoteRecord, client: ModelClient): Promise<TurnReading> {
    const skipModel = route.turnKind === 'short_pause' || route.turnKind === 'acknowledgement' || route.turnKind === 'promise_of_more' || !turn.body.trim();
    if (skipModel) return { output: null, error: null, record: null };
    // The quote's own labels, each once. Never the citations the facts are keyed by: those carry
    // a line's position, which the model has no way to map onto the customer's words, so it
    // would pick one. Named by a title two lines share, the read refuses and the turn is Ben's.
    const labels = Array.from(new Set(figureLabels(q).map((f) => f.label)));
    const user = [
        `Quote ${q.slug}, status ${q.status}. Labels on it: ${labels.join('; ') || 'none'}. Not included: ${q.lines.flatMap((l) => l.notIncluded).join('; ') || 'nothing listed'}. Assumptions: ${q.lines.flatMap((l) => l.assumptions).join('; ') || 'none'}.`,
        'Thread, oldest first (the newest turn is marked >>):',
        threadFor(file, turn),
    ].join('\n');
    const res = await client.structured({ role: 'specialist', model: SPECIALIST_MODEL, effort: 'medium', system: QUESTION_SYSTEM, user, schema: questionOutputSchema, maxTokens: 600 });
    return { output: res.output, error: res.output ? null : (res.error ?? 'the question model returned nothing'), record: res.record };
}

/**
 * The reading, applied to a quote as the customer holds it: the concerns it names by the quote's own
 * labels, and whether it asks money beyond a line. On a quote live for figures, any amount asked for
 * under a name the quote does not carry (a labour or materials half, a deposit on a quote with none,
 * a label two lines share) is money beyond a quote line and goes to Ben, rather than being answered
 * with another line's figure. Asked of the label the model returned, never of a clamped copy: a
 * line's label runs to 120 characters and the brief clamps at 60. A total and a deposit are named by
 * their kind, so "the total price" asks about the same one figure.
 */
function applyReading(q: QuoteRecord, out: QuestionOutput): { concerns: QuestionOutput['concerns']; beyondQuoteLine: boolean } {
    const asked = out.concerns.slice(0, 6);
    const named = asked.map((c) => ({ kind: c.kind, label: c.kind === 'total' ? TOTAL_LABEL : c.kind === 'deposit' ? DEPOSIT_LABEL : c.label }));
    const offQuote = quoteLiveForFigures(q) ? named.filter((c) => FIGURE_KINDS.has(c.kind) && c.label && !readQuoteLine(q, c.label).ok) : [];
    return {
        concerns: named.filter((c) => !offQuote.includes(c)).map((c) => ({ kind: c.kind, label: c.label ? clamp(c.label, 60) : null })),
        beyondQuoteLine: out.beyondQuoteLine || offQuote.length > 0,
    };
}

export async function quote(file: CaseFile, turn: Turn, party: Party, route: Route, client: ModelClient, deps: QuotingSpecialistDeps = {}): Promise<QuotingReturn | null> {
    const d = resolveQuotingDeps(deps);
    const calls: ModelCallRecord[] = [];
    const factIds: string[] = [];
    let error: string | null = null;
    const q: QuoteRecord | null = await loadQuote(file, deps).catch((e: any) => { error = `quote read failed: ${e?.message ?? e}`; return null; });
    const ready = isReady(file);
    if (!q && !ready) return null;
    // A file naming a quote the shelf cannot read is not a file with no quote: one job has one
    // draft and a change to it is Ben's, so a read that came back empty is treated as a read that
    // failed rather than drafting a second quote over the one the reference names.
    if (!q && file.job.quoteRef && !error) error = `quote ${file.job.quoteRef} is on the file but no row came back for it`;
    if (!q && file.job.quoteRef && error) {
        // The router cleared the money belt on the read that succeeded at the top of the turn
        // (desk.ts), so this read failing must not lose the hold with it: money beyond a quote line
        // goes to Ben, and a read that failed can answer nothing about a figure.
        const failed = emptyProposal();
        if (route.belts.money || route.moneyToQuoting) failed.hold = { reason: 'money', match: turn.body.slice(0, 80) };
        const readBrief = [
            'quoting: the quote could not be read',
            'the quote could not be read this turn, so nothing about it is known: give no figure at all and answer nothing about a price, whatever amounts stand on the file; if they asked about money the fixed line covers it',
        ];
        return { specialist: 'quoting', factIds, proposal: failed, brief: readBrief, calls, error };
    }

    // A draft already running for this job: it is on its way to Ben, and a second one is never started.
    if (!q && !file.job.quoteRef && draftPending(file.id)) {
        const drafting: QuotingProposal = {
            phase: 'draft', quoteRef: null, status: null, drafted: false, drafting: true, draftError: null,
            answerFrom: { figures: [], scope: [], notIncluded: [], assumptions: [], link: null, status: null },
            concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: route.turnKind === 'not_ready', acceptedNow: false,
        };
        const p = emptyProposal();
        p.ready = true;
        return { specialist: 'quoting', factIds, proposal: p, brief: briefLines(drafting), calls, error };
    }

    const proposal: QuotingProposal = {
        phase: 'draft', quoteRef: q?.slug ?? file.job.quoteRef ?? null, status: q?.status ?? null, drafted: false, draftError: null,
        answerFrom: { figures: [], scope: [], notIncluded: [], assumptions: [], link: null, status: null },
        concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: route.turnKind === 'not_ready', acceptedNow: turn.kind === 'portal_action',
    };

    // 1. No quote yet and the job and location are known: the clerk's intake, then the draft.
    if (!q || q.status === 'revoked' || q.status === 'superseded' || q.status === 'expired') {
        if (q) {
            proposal.phase = 'stale';
            const ids = recordQuoteFacts(file, q, deps);
            proposal.answerFrom.status = ids.status;
            if (ids.status) factIds.push(ids.status);
            const stale = emptyProposal();
            stale.hold = { reason: 'stale_quote', match: `${q.slug} is ${q.status}` };
            if (q.status !== 'expired') return { specialist: 'quoting', factIds, proposal: stale, brief: briefLines(proposal), calls, error };
            // Expired: read the turn as it would be read on the quote live again, so whatever Ben
            // must answer (money beyond a line, a yes in chat) still reaches him and blocks the reissue.
            const live: QuoteRecord = { ...q, status: 'sent' };
            const reading = await readTurn(file, turn, route, live, client);
            if (reading.record) calls.push(reading.record);
            const blockers: string[] = [];
            let concerns: QuestionOutput['concerns'] = [];
            let notReady = proposal.notReady;
            if (reading.error) { error = reading.error; blockers.push(`the turn could not be read (${reading.error})`); }
            if (reading.output) {
                const applied = applyReading(live, reading.output);
                concerns = applied.concerns;
                notReady = notReady || reading.output.notReady;
                if (applied.beyondQuoteLine) blockers.push('money beyond a quote line');
                if (reading.output.acceptanceInChat) blockers.push('acceptance in chat');
            }
            if (route.moneyToQuoting) {
                if (!concerns.length && !blockers.length) blockers.push('a money question the quote does not answer');
            } else if (route.belts.money) blockers.push('a money question');
            return { specialist: 'quoting', factIds, proposal: stale, brief: briefLines(proposal), calls, error, reissue: { slug: q.slug, blockers, concerns, notReady } };
        }
        const readiness = quoteReadiness(file);
        const user = [
            `Customer: ${party.name ?? 'unknown name'}. Job type: ${file.job.type ?? 'unknown'}. Location: ${file.job.location ?? 'unknown'}.`,
            'Facts on the file (key = value):',
            file.facts.filter((f) => !f.key.startsWith('quote_') && !f.key.startsWith('ben_')).map((f) => `${f.key} = ${f.value}`).join('\n') || '(none)',
            `Not on the file yet: ${readiness.missing.join('; ') || 'nothing'}.`,
            'Thread, oldest first (the newest turn is marked >>):',
            threadFor(file, turn),
        ].join('\n');
        const res = await client.structured({ role: 'specialist', model: SPECIALIST_MODEL, effort: 'medium', system: INTAKE_SYSTEM, user, schema: intakeOutputSchema, maxTokens: 1500 });
        calls.push(res.record);
        // The intake is the quote's own words: what each line covers, what it assumes, what it does
        // not include. With none of it there is a title and nothing else to draft, and the next
        // thing done to a draft is that Ben prices it and sends it, so the customer would hold a
        // quote that states none of that. A quote that cannot be built has one shape, whichever half
        // failed: it holds for Ben, promises the customer nothing and carries his acknowledgement.
        if (!res.output) {
            error = res.error ?? 'the intake model returned nothing';
            proposal.draftError = error;
            const failed = emptyProposal();
            failed.ready = true;
            failed.hold = { reason: 'draft_failed', match: error };
            return { specialist: 'quoting', factIds, proposal: failed, brief: briefLines(proposal), calls, error };
        }
        const out = clampIntake(res.output);
        const missing = Array.from(new Set([...readiness.missing, ...out.missing]));
        const intake: DraftIntake = { customerName: party.name, postcode: file.job.location, customerType: out.customerType, missing, lines: out.lines.map((l) => ({ ...l })) };
        if (deps.background) {
            // Off the reply path: the draft notifies Ben when it is ready, and a failure holds for him then.
            startBackgroundDraft(file, turn.id, (saved) => draftQuote(file, party, intake, deps, { since: deps.recoverSince, beforeNotify: saved }), deps.background, { now: deps.now, newId: deps.newId });
            proposal.drafting = true;
            const p = emptyProposal();
            p.ready = true;
            return { specialist: 'quoting', factIds, proposal: p, brief: briefLines(proposal), calls, error };
        }
        const drafted = await draftQuote(file, party, intake, deps);
        if (drafted.ok) { proposal.drafted = true; proposal.quoteRef = drafted.slug; proposal.status = 'draft'; factIds.push(...drafted.factIds); calls.push(...drafted.calls); }
        else { proposal.draftError = drafted.reason; error = error ? `${error}; ${drafted.reason}` : drafted.reason; }
        const p = emptyProposal();
        p.ready = true;
        if (!drafted.ok) p.hold = { reason: 'draft_failed', match: drafted.reason };
        return { specialist: 'quoting', factIds, proposal: p, brief: briefLines(proposal), calls, error };
    }

    // 2. A quote stands. Its facts onto the file, once; then what this turn concerns.
    const ids = recordQuoteFacts(file, q, deps);
    const figures = figureLabels(q).flatMap((f) => (ids.lines[f.citation] ? [{ label: f.label, factId: ids.lines[f.citation], shared: f.shared }] : []));
    proposal.answerFrom = { figures, scope: ids.scope, notIncluded: ids.notIncluded, assumptions: ids.assumptions, link: ids.link, status: ids.status };
    factIds.push(...[ids.status, ids.link, ...Object.values(ids.lines), ...ids.scope, ...ids.notIncluded, ...ids.assumptions].filter((x): x is string => !!x));
    proposal.phase = q.status === 'draft' ? 'with_ben' : q.status === 'accepted' ? 'accepted' : 'sent';
    if (q.status === 'draft' && turn.media.length) {
        await d.store.addPhotos(q.slug, turn.media.filter((m) => m.kind === 'image' && m.url).map((m) => m.url!)).catch(() => undefined);
    }
    if (proposal.acceptedNow) {
        return { specialist: 'quoting', factIds, proposal: emptyProposal(), brief: briefLines(proposal), calls, error };
    }
    let questionAnswered = false;
    const reading = await readTurn(file, turn, route, q, client);
    if (reading.record) calls.push(reading.record);
    if (reading.output) {
        const applied = applyReading(q, reading.output);
        proposal.concerns = applied.concerns;
        proposal.beyondQuoteLine = applied.beyondQuoteLine;
        proposal.acceptanceInChat = reading.output.acceptanceInChat && q.status === 'sent';
        proposal.notReady = proposal.notReady || reading.output.notReady;
        questionAnswered = proposal.concerns.length > 0 || proposal.beyondQuoteLine;
    } else if (reading.error) error = reading.error;
    // A money exception is cleared for a live quote only because this reading replaces it (5.3 for a
    // figure on the quote, applyQuotingRoute). When the reading did not run or did not answer, it
    // stands again, whichever raised it: money beyond a quote line goes to Ben, never on one reading.
    // A reading that named no concern at all has not answered: "can you do it any cheaper?" is a
    // discount, which no line of the quote states, so it is Ben's. A reading that named one - "does
    // that price include the tap?" is a scope concern - is answered from the quote under 5.3.
    if ((route.belts.money || route.moneyToQuoting) && !questionAnswered) proposal.beyondQuoteLine = true;
    const p = emptyProposal();
    p.ready = true;
    // Holds: money beyond a line, whatever the quote's status, and acceptance in chat (acceptance
    // stays human). 5.3's exemption is a figure already on the sent quote; a quote still with Ben has
    // no figure to answer from at all, so that is the one state money must certainly reach him in.
    if (proposal.beyondQuoteLine) p.hold = { reason: 'money', match: turn.body.slice(0, 80), acceptedInChat: proposal.acceptanceInChat };
    else if (proposal.acceptanceInChat) p.hold = { reason: 'acceptance', match: turn.body.slice(0, 80), acceptedInChat: true };
    const unannounced = unannouncedReissue(file, q, deps);
    return { specialist: 'quoting', factIds, proposal: p, brief: briefLines(proposal), calls, error, ...(unannounced ? { unannounced } : {}) };
}

/**
 * A reissue on the row that this file has no record of: the run that claimed it did not live to
 * send (a restart between the write and the reply) or another process claimed it. The customer may
 * be holding a link whose price moved without a word, so Ben is told, once: the note is recorded on
 * the file as not sent, which is also what stops a second card for the same reissue. Nothing is sent
 * about it again, because the run that claimed it may yet have told them.
 */
function unannouncedReissue(file: CaseFile, q: QuoteRecord, deps: QuotingSpecialistDeps): string | null {
    const last = lastIssue(q.reissue);
    if (!last || q.status !== 'sent' || reissueRecorded(file, q.slug, last.runId)) return null;
    const previous = q.reissue!.issues.length > 1 ? q.reissue!.issues[q.reissue!.issues.length - 2].totalPence : q.reissue!.original.totalPence;
    const why = 'this file has no record of the message telling the customer';
    recordReissue(file, { slug: q.slug, issue: last, previousTotalPence: previous, sentAt: null, notSent: why }, deps);
    return `quote ${q.slug} was reissued automatically at ${pounds(last.totalPence)} (run ${last.runId}) and ${why}: check they have the new price and link`;
}

/**
 * The return for the turn the desk reissued the expired quote on: the quote is live again, so the
 * reply answers from it like any sent quote, opening with the fixed line the desk puts ahead of the
 * composer's words (reissue.ts `reissueLine`). No model call: the turn was read before the reissue.
 */
export function afterReissue(file: CaseFile, q: QuoteRecord, candidate: ReissueCandidate, reissued: { totalFactId: string; link: string; factIds: string[] }, deps: QuotingSpecialistDeps = {}): QuotingReturn {
    const ids = recordQuoteFacts(file, q, deps);
    const figures = figureLabels(q).flatMap((f) => (ids.lines[f.citation] ? [{ label: f.label, factId: ids.lines[f.citation], shared: f.shared }] : []));
    const proposal: QuotingProposal = {
        phase: 'sent', quoteRef: q.slug, status: q.status, drafted: false, draftError: null,
        answerFrom: { figures, scope: ids.scope, notIncluded: ids.notIncluded, assumptions: ids.assumptions, link: ids.link, status: ids.status },
        concerns: candidate.concerns, beyondQuoteLine: false, acceptanceInChat: false, notReady: candidate.notReady, acceptedNow: false,
        reissued: { amount: pounds(q.totalPence!), factId: reissued.totalFactId, link: reissued.link },
    };
    const p = emptyProposal();
    p.ready = true;
    return { specialist: 'quoting', factIds: Array.from(new Set(reissued.factIds)), proposal: p, brief: briefLines(proposal), calls: [], error: null };
}

/** The clock: a draft the customer has not received is chased for Ben (4.5). Never a customer send. */
export async function quotingClock(file: CaseFile, deps: QuotingSpecialistDeps = {}): Promise<{ note: string; chased: boolean }> {
    const party = file.parties[0];
    if (!file.job.quoteRef || !party) return { note: 'no quote on the file; nothing to chase', chased: false };
    const r = await chase(file, party, deps).catch((e: any) => ({ chased: false, n: 0, reason: `chase failed: ${e?.message ?? e}`, notice: null }));
    return { note: r.chased ? `chase ${r.n} recorded for Ben: ${r.notice?.link ?? ''}` : `no chase: ${r.reason}`, chased: r.chased };
}

/** One line of evidence for the desk's summary. */
export function quotingSummary(r: SpecialistReturn | null | undefined): string | null {
    return r?.brief?.[0] ?? null;
}

/** For the door's state: the quote as the file records it, from facts only. */
export function quoteStateOf(file: CaseFile): { slug: string | null; status: string | null; link: string | null; priceScreen: string | null; notifications: Array<{ kind: 'ready_to_price' | 'chase' | 'accepted'; at: string; title: string; link: string | null }> } | null {
    const slug = file.job.quoteRef;
    if (!slug) return null;
    const parse = (kind: 'ready_to_price' | 'chase' | 'accepted') => (f: { at: string; value: string }) => {
        const [title, ...rest] = f.value.split(' | ');
        const link = rest.find((x) => /^https?:\/\//.test(x)) ?? null;
        return { kind, at: f.at, title, link };
    };
    const notifications = [
        ...factsWithPrefix(file, QUOTE_FACT.benNotified).map(parse('ready_to_price')),
        ...factsWithPrefix(file, QUOTE_FACT.benChased).map(parse('chase')),
        ...factsWithPrefix(file, QUOTE_FACT.accepted).map(parse('accepted')),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const link = newestFact(file, QUOTE_FACT.link)?.value ?? null;
    return { slug, status: newestFact(file, QUOTE_FACT.status)?.value ?? null, link, priceScreen: notifications.find((n) => n.kind === 'ready_to_price')?.link ?? null, notifications };
}
