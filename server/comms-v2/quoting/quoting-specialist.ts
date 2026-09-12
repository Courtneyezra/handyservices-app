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
 */
import { z } from 'zod/v4';
import { isReady, type CaseFile, type ModelCallRecord, type Party, type Turn } from '../desk/case-file';
import type { Proposal, SpecialistReturn } from '../desk/desk-types';
import { SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import type { Route, RouterOutput } from '../desk/router';
import { CUSTOMER_TYPES, type DraftIntake } from './draft-quote';
import { DEPOSIT_LABEL, QUOTE_FACT, TOTAL_LABEL, factsWithPrefix, figureLabels, newestFact, quoteLiveForFigures, readQuoteLine, type QuoteRecord, type QuoteStatus } from './quote-record';
import { chase, draftQuote, loadQuote, quoteReadiness, recordQuoteFacts, resolveQuotingDeps, type QuotingDeps } from './quoting-tools';

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
        return `${t.id === turn.id ? '>> ' : ''}${t.direction === 'inbound' ? 'customer' : 'desk'}: ${t.body}${media}`;
    }).join('\n');
}

// ---------------------------------------------------------------- what the specialist proposes

export type QuotingPhase = 'draft' | 'with_ben' | 'sent' | 'accepted' | 'stale';

export interface QuotingProposal {
    phase: QuotingPhase;
    quoteRef: string | null;
    status: QuoteStatus | null;
    drafted: boolean;
    draftError: string | null;
    /** Fact ids the composer should answer from, by what they are. */
    answerFrom: { figures: Record<string, string>; scope: string[]; notIncluded: string[]; assumptions: string[]; link: string | null; status: string | null };
    concerns: QuestionOutput['concerns'];
    beyondQuoteLine: boolean;
    acceptanceInChat: boolean;
    notReady: boolean;
    acceptedNow: boolean;
}

/** The composer's brief from the proposal: the first line is the one-line evidence token, the rest instructions. Never a sentence for the customer. */
export function briefLines(p: QuotingProposal): string[] {
    const out: string[] = [];
    const ids = p.answerFrom;
    const figureList = Object.entries(ids.figures).map(([label, id]) => `${label} = fact ${id}`).join('; ');
    if (p.phase === 'draft') {
        if (p.drafted) {
            out.push(`quoting: drafted ${p.quoteRef} for Ben to price`);
            out.push('the quote is with Ben to price: nothing about a price exists yet, so no figure; if this turn is a wrap-up, Ben will put the quote together and send it over, no timing');
        } else {
            out.push(`quoting: draft failed (${p.draftError ?? 'unknown'})`);
            out.push('nothing has been built for this job and Ben has the thread now: promise nothing about a price, a document or when anything happens, and give no figure; acknowledge what they said in one line and say Ben will come back to them himself');
        }
    } else if (p.phase === 'with_ben') {
        out.push(`quoting: ${p.quoteRef} with Ben to price`);
        if (ids.scope.length && p.concerns.some((c) => c.kind === 'scope' || c.kind === 'not_included' || c.kind === 'on_the_day')) {
            out.push(`answer what is included from the draft's scope facts (${ids.scope.join(', ')})${ids.notIncluded.length ? ` and what is not included (${ids.notIncluded.join(', ')})` : ''}; no figure, the quote is not priced yet; Ben confirms it when he sends the quote`);
        } else out.push(`if they ask about the quote: it is with Ben and on its way (fact ${ids.status ?? 'none'}); no figure, no timing`);
    } else if (p.phase === 'stale') {
        out.push(`quoting: ${p.quoteRef} is ${p.status}`);
        out.push(`the quote is ${p.status} (fact ${ids.status ?? 'none'}): no figure may be read from it; say Ben will come back to them on the quote`);
    } else {
        out.push(`quoting: ${p.quoteRef} ${p.status}; ${Object.keys(ids.figures).length} figures on the file`);
        if (p.acceptedNow) {
            out.push(`they accepted the quote on the quote page (fact ${ids.status ?? 'none'}) and Ben has been told: thank them, say Ben has been told and will be in touch about the day; no date, no time, no other promise, no question`);
        } else if (p.acceptanceInChat) {
            out.push(`they said yes in chat: acceptance happens on the quote page, so point them to the quote link (fact ${ids.link ?? 'none'}) to accept and pick a date; Ben has been told; no date, no time`);
        } else if (p.beyondQuoteLine) {
            out.push(`their money question is beyond a line of the quote: give no figure and do not answer it, the fixed line covers it; answer anything else they asked from the quote's scope facts (${ids.scope.join(', ') || 'none'})`);
        } else {
            const asked = p.concerns.filter((c) => c.kind === 'line_amount' || c.kind === 'total' || c.kind === 'deposit').map((c) => c.label ?? c.kind);
            out.push(`answer from the quote only. Figures on it, each copied exactly as written on its fact and its fact id cited: ${figureList || 'none'}${asked.length ? `; they asked about: ${asked.join(', ')}` : ''}`);
            if (ids.scope.length) out.push(`what each line covers: facts ${ids.scope.join(', ')}${ids.notIncluded.length ? `; not included: ${ids.notIncluded.join(', ')}` : ''}${ids.assumptions.length ? `; what happens on the day (the quote's assumptions): ${ids.assumptions.join(', ')}` : ''}`);
            if (ids.link) out.push(`the quote link is fact ${ids.link}; dates are picked on it`);
            out.push('anything about money beyond these figures: say Ben will come back to them on it');
        }
    }
    if (p.beyondQuoteLine && p.phase !== 'sent' && p.phase !== 'accepted') out.push('their money question is beyond a line of the quote: do not answer it; the fixed line covers it');
    if (p.notReady) out.push('they are not ready: one short acknowledgement, no question, and the desk will not chase');
    return out;
}

// ---------------------------------------------------------------- the specialist

export interface QuotingSpecialistDeps extends QuotingDeps {}

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
 */
export function applyQuotingRoute(file: CaseFile, turn: Turn, out: RouterOutput, liveFigureRefs: ReadonlySet<string> = new Set()): { moneyToQuoting: boolean } {
    if (turn.kind === 'portal_action') {
        out.subjects = ['quoting'];
        out.exception = null;
        out.turnKind = 'acknowledgement';
        return { moneyToQuoting: false };
    }
    if (out.exception === 'money' && file.job.quoteRef && liveFigureRefs.has(file.job.quoteRef)) {
        out.exception = null;
        if (!out.subjects.includes('quoting')) out.subjects.unshift('quoting');
        // Said so, whichever raised it: the exception is gone and Quoting owes the hold if its own
        // reading of the turn does not answer it.
        return { moneyToQuoting: true };
    }
    return { moneyToQuoting: false };
}

function emptyProposal(): Proposal {
    return { nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null };
}

/** The intake the tools draft from when the model fails: one line from the job facts, so the draft still reaches Ben. */
export function fallbackIntake(file: CaseFile, party: Party, missing: string[]): DraftIntake {
    const details = file.facts.filter((f) => f.key === 'job_detail').map((f) => f.value);
    return {
        customerName: party.name, postcode: file.job.location, customerType: 'homeowner',
        lines: [{ title: file.job.type ?? 'the job as described', category: null, qty: 1, detail: details.join('; ') || null, assumptions: [], notIncluded: [] }],
        missing,
    };
}

export async function quote(file: CaseFile, turn: Turn, party: Party, route: Route, client: ModelClient, deps: QuotingSpecialistDeps = {}): Promise<SpecialistReturn | null> {
    const d = resolveQuotingDeps(deps);
    const calls: ModelCallRecord[] = [];
    const factIds: string[] = [];
    let error: string | null = null;
    const q: QuoteRecord | null = await loadQuote(file, deps).catch((e: any) => { error = `quote read failed: ${e?.message ?? e}`; return null; });
    const ready = isReady(file);
    if (!q && !ready) return null;
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

    const proposal: QuotingProposal = {
        phase: 'draft', quoteRef: q?.slug ?? file.job.quoteRef ?? null, status: q?.status ?? null, drafted: false, draftError: null,
        answerFrom: { figures: {}, scope: [], notIncluded: [], assumptions: [], link: null, status: null },
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
            return { specialist: 'quoting', factIds, proposal: stale, brief: briefLines(proposal), calls, error };
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
        let intake: DraftIntake;
        if (res.output) {
            const out = clampIntake(res.output);
            const missing = Array.from(new Set([...readiness.missing, ...out.missing]));
            intake = { customerName: party.name, postcode: file.job.location, customerType: out.customerType, missing, lines: out.lines.map((l) => ({ ...l })) };
        } else {
            error = res.error ?? 'the intake model returned nothing';
            intake = fallbackIntake(file, party, readiness.missing);
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
    proposal.answerFrom = { figures: ids.lines, scope: ids.scope, notIncluded: ids.notIncluded, assumptions: ids.assumptions, link: ids.link, status: ids.status };
    factIds.push(...[ids.status, ids.link, ...Object.values(ids.lines), ...ids.scope, ...ids.notIncluded, ...ids.assumptions].filter((x): x is string => !!x));
    proposal.phase = q.status === 'draft' ? 'with_ben' : q.status === 'accepted' ? 'accepted' : 'sent';
    if (q.status === 'draft' && turn.media.length) {
        await d.store.addPhotos(q.slug, turn.media.filter((m) => m.kind === 'image' && m.url).map((m) => m.url!)).catch(() => undefined);
    }
    if (proposal.acceptedNow) {
        return { specialist: 'quoting', factIds, proposal: emptyProposal(), brief: briefLines(proposal), calls, error };
    }
    const skipModel = route.turnKind === 'short_pause' || route.turnKind === 'acknowledgement' || route.turnKind === 'promise_of_more' || !turn.body.trim();
    let questionRead = false;
    if (!skipModel) {
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
        calls.push(res.record);
        if (res.output) {
            questionRead = true;
            const asked = res.output.concerns.slice(0, 6);
            // A figure is a line of the quote. A price the turn asks for under a label the quote does
            // not carry - the labour or materials half of a line, most often - is money beyond a
            // quote line: it goes to Ben rather than being answered with the line's own figure under
            // the wrong name, which would state an amount the customer's quote does not. Asked of the
            // label the model returned, never of a clamped copy: a line's label runs to 120
            // characters and the brief clamps at 60, so a truncated label would match no line and
            // turn a question the quote answers (5.3) into a hold.
            // A total and a deposit are named by their kind, so the label is the quote's own rather
            // than the customer's words for it: "the total price" asks about the same one figure.
            const named = asked.map((c) => ({ kind: c.kind, label: c.kind === 'total' ? TOTAL_LABEL : c.kind === 'deposit' ? DEPOSIT_LABEL : c.label }));
            // Any amount asked for under a name the live quote does not carry - a labour or materials
            // half, a deposit on a quote that has none, a label two lines share - is money beyond a
            // quote line and goes to Ben, rather than being answered with another line's figure.
            const offQuote = quoteLiveForFigures(q) ? named.filter((c) => FIGURE_KINDS.has(c.kind) && c.label && !readQuoteLine(q, c.label).ok) : [];
            proposal.concerns = named.filter((c) => !offQuote.includes(c)).map((c) => ({ kind: c.kind, label: c.label ? clamp(c.label, 60) : null }));
            proposal.beyondQuoteLine = res.output.beyondQuoteLine || offQuote.length > 0;
            proposal.acceptanceInChat = res.output.acceptanceInChat && q.status === 'sent';
            proposal.notReady = proposal.notReady || res.output.notReady;
        } else error = res.error ?? 'the question model returned nothing';
    }
    // A money exception is cleared for a live quote only because this reading replaces it (5.3 for a
    // figure on the quote, applyQuotingRoute). When the reading did not run or did not answer, it
    // stands again, whichever raised it: money beyond a quote line goes to Ben, never on one reading.
    if ((route.belts.money || route.moneyToQuoting) && !questionRead) proposal.beyondQuoteLine = true;
    const p = emptyProposal();
    p.ready = true;
    // Holds: money beyond a line, and acceptance in chat (acceptance stays human).
    if (proposal.beyondQuoteLine && (q.status === 'sent' || q.status === 'accepted')) p.hold = { reason: 'money', match: turn.body.slice(0, 80) };
    else if (proposal.acceptanceInChat) p.hold = { reason: 'acceptance', match: turn.body.slice(0, 80) };
    return { specialist: 'quoting', factIds, proposal: p, brief: briefLines(proposal), calls, error };
}

/** The clock: the unpriced draft is chased for Ben (4.5). Never a customer send. */
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
