/**
 * Contract 3, the router: Haiku 4.5 at low effort, structured output, no prose. Reads the case
 * file and the new turn; returns the subjects the turn touches in order of primacy, a proposed
 * stage, the party addressed, and an exception if one applies. Never invents a subject: an
 * unclassifiable turn goes to Scoping before ready and to Service after. The router never sees a
 * tool. Two deterministic belts sit under it: the regulated matcher (a hold the model cannot
 * unsay) and the money-question matcher (2.7 cannot depend on one model reading). Money is handed on
 * only to a specialist that answers it from a row: Quoting for a live quote's line, Service for a
 * known customer's invoice; each raises the money hold itself when its reading does not answer. A belt adds its
 * exception to what the model read rather than replacing it, so a turn that asks a price and also
 * asks for a call raises both; `exceptions` is the ordered list and gravest is first. There is no
 * belt for a call request: in this trade "call round", "call in" and "call out" ask for a visit,
 * which no matcher separated from a phone call reliably, so the router reads it.
 */
import { z } from 'zod/v4';
import { isReady, type CaseFile, type Turn, type ModelCallRecord, STAGES, isTurnOf, mediaCountLabel, mediaFailedNote } from './case-file';
import { moneyQuestionMatch, regulatedMatch } from './lexicon';
import { ROUTER_MODEL, type ModelClient } from './models';
import { applyQuotingRoute } from '../quoting/quoting-specialist';
import { invoiceMoneyQuestion } from '../service/customer-record';

export const SUBJECTS = ['scoping', 'quoting', 'scheduling', 'service'] as const;
export type Subject = (typeof SUBJECTS)[number];
export const EXCEPTIONS = ['money', 'complaint', 'refund', 'trust_doubt', 'regulated', 'date_change', 'callback'] as const;
export type Exception = (typeof EXCEPTIONS)[number];
/** Everything a hold can be raised for: the router's exceptions plus the reasons a specialist's tools raise (Goal 6, server/comms-v2/service). */
export const HOLD_EXCEPTIONS = [...EXCEPTIONS, 'date_unconfirmed', 'no_source', 'not_converging', 'change_of_details'] as const;
export type HoldException = (typeof HOLD_EXCEPTIONS)[number];
export const TURN_KINDS = ['enquiry', 'answer', 'question', 'short_pause', 'promise_of_more', 'acknowledgement', 'decline', 'not_ready', 'other'] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

export const routerOutputSchema = z.object({
    subjects: z.array(z.string()).max(SUBJECTS.length + EXCEPTIONS.length),
    proposedStage: z.enum(STAGES),
    party: z.literal('customer'),
    exception: z.enum(EXCEPTIONS).nullable(),
    turnKind: z.enum(TURN_KINDS),
});
type RawRouterOutput = z.infer<typeof routerOutputSchema>;
export interface RouterOutput extends Omit<RawRouterOutput, 'subjects'> {
    subjects: Subject[];
}

/**
 * The model sometimes lists an exception (most often "callback") as if it were a subject too,
 * since the prompt names both in similar terms. That is a known mix-up, not evidence the whole
 * reading is unreliable, so the call does not fail closed on it; the exception is read as raised
 * rather than dropped, so a complaint or a refund written there still holds for Ben. Any other
 * unrecognized value still fails the call (desk.ts holds for Ben). Kept outside the zod schema
 * (rather than a `.transform()`) because the schema is also turned into a JSON Schema for the live
 * structured-output call, and a transform cannot be represented there.
 */
function cleanSubjects(raw: string[]): { subjects: Subject[]; exceptions: Exception[] } | null {
    const subjects: Subject[] = [];
    const exceptions: Exception[] = [];
    for (const s of raw) {
        if ((SUBJECTS as readonly string[]).includes(s)) { subjects.push(s as Subject); continue; }
        if ((EXCEPTIONS as readonly string[]).includes(s)) { exceptions.push(s as Exception); continue; }
        return null;
    }
    return { subjects, exceptions };
}

/** Gravest first: the order the desk takes an exception in, so one fixed-line-only reason outranks the rest. Keyed by every exception, so a new one cannot go unranked. */
const EXCEPTION_GRAVITY: Record<Exception, number> = { regulated: 0, complaint: 1, refund: 2, trust_doubt: 3, money: 4, date_change: 5, callback: 6 };

export interface Route extends Omit<RouterOutput, 'exception'> {
    /**
     * Every exception this turn raises, gravest first: the belts' and the model's, deduplicated.
     * A belt is never displaced by a model-named exception, and a turn can carry more than one.
     */
    exceptions: Exception[];
    /** What the deterministic belts found, beside the model's reading. */
    belts: { regulated: string | null; money: string | null };
    /**
     * The turn carried a money exception and Goal 4's hook handed it to Quoting instead (5.3): true
     * however the exception was raised, the belt or the model. Quoting raises the hold itself when
     * its own reading does not answer, so 2.7 never rests on one model reading.
     */
    moneyToQuoting: boolean;
    /**
     * The turn's money question is about an invoice or a payment on the record of a customer the CRM
     * knows, and nothing an invoice cannot settle (service/customer-record.ts invoiceMoneyQuestion),
     * so it went to Service instead of Ben: Service answers it from the invoice row or raises the
     * money hold itself. Absent is false.
     */
    moneyToService?: boolean;
    call: ModelCallRecord;
    error: string | null;
}

/** The text a belt matched for an exception, for the hold's record; the turn itself when no belt read it. */
export function matchFor(route: Route, exception: Exception, body: string): string {
    if (exception === 'regulated' && route.belts.regulated) return route.belts.regulated;
    if (exception === 'money' && route.belts.money) return route.belts.money;
    return body.slice(0, 80);
}

const SYSTEM = [
    'You route one customer WhatsApp turn for a small handyman business\'s desk. You classify; you never write to the customer and never see a tool.',
    'Subjects, in order of primacy for this turn: scoping (what the job is and where, access, photos, a call), quoting (price, what a quote includes), scheduling (dates, when we can come, lead time), service (facts about the business, changes of details, invoices, aftercare).',
    'A turn can touch two subjects ("how much, and when can you come?"): list both, primary first. A bare statement about the job, an answer to a question, a pause or a thanks is scoping while the job is being scoped.',
    'proposedStage: first_contact for the opening message; scoping once the conversation is under way; ready only when the job type and the location are both known; quoted, accepted, booked, done are later stages you do not propose unless the file already shows them.',
    'exception, or null: money (asks a price, a cost, a discount, anything beyond reading a quote line back), complaint (unhappy with us or our work), refund, trust_doubt (are you legit, a scam worry, doubting we are who we say), regulated (gas or asbestos work), date_change (changing a booked date), callback (asks us to call or ring them on the phone, or accepts a call we offered). "Can I get a quote for X" is an enquiry, not money; chasing progress on a quote already asked for ("any news on the quote?", "still waiting on that quote") is not money either, since it names no figure and asks for nothing about price. "Are you insured" is a factual question for service, not a trust doubt. In this trade "call round", "call in", "call out" and "call by" ask for a visit, not a phone call: they are scoping, not callback.',
    'turnKind: enquiry (a new job), answer (details in reply to a question), question (asks us something), short_pause ("one sec", "let me check", "hang on"), promise_of_more ("I\'ll send photos tomorrow", "I\'ll get back to you with the measurements"), acknowledgement ("ok thanks", "makes sense"), decline (declines a photo, a call or a suggestion), not_ready ("I\'ll get back to you next month"), other.',
    'Reply with the JSON object only.',
].join('\n');

function threadFor(file: CaseFile, turn: Turn): string {
    const lines = file.turns.slice(-12).map((t) => `${isTurnOf(t, turn) ? '>> ' : ''}${t.direction === 'inbound' ? 'customer' : 'desk'}: ${[t.body || (t.media.length ? `[${mediaCountLabel(t.media)}]` : ''), mediaFailedNote(t)].filter(Boolean).join(' ') || '[empty]'}`);
    return lines.join('\n');
}

export async function route(file: CaseFile, turn: Turn, client: ModelClient, liveFigureRefs: ReadonlySet<string> = new Set(), expiredRefs: ReadonlySet<string> = new Set()): Promise<Route> {
    const belts = { regulated: regulatedMatch(turn.body), money: moneyQuestionMatch(turn.body) };
    const user = [
        `Stage now: ${file.stage}. Job type known: ${file.job.type ? 'yes' : 'no'}. Location known: ${file.job.location ? 'yes' : 'no'}.`,
        `Thread (the turn to route is marked >>):`,
        threadFor(file, turn),
        turn.media.length ? `The marked turn carries ${mediaCountLabel(turn.media)}.` : '',
    ].filter(Boolean).join('\n');
    const res = await client.structured({ role: 'router', model: ROUTER_MODEL, effort: 'low', system: SYSTEM, user, schema: routerOutputSchema, maxTokens: 400 });
    const fallback: RouterOutput = { subjects: [isReady(file) && file.stage !== 'scoping' && file.stage !== 'first_contact' ? 'service' : 'scoping'], proposedStage: file.stage === 'first_contact' ? 'scoping' : file.stage, party: 'customer', exception: null, turnKind: 'other' };
    const cleaned = res.output ? cleanSubjects(res.output.subjects) : null;
    const out: RouterOutput = res.output && cleaned ? { ...res.output, subjects: cleaned.subjects } : fallback;
    const error = res.output && !cleaned ? `not a recognized subject: ${JSON.stringify(res.output.subjects)}` : res.error;
    // Exceptions the model wrote among the subjects are raised like the one it named.
    const listedExceptions: Exception[] = cleaned?.exceptions ?? [];
    // Never invents a subject: an empty list is unclassifiable.
    if (!out.subjects.length) out.subjects = [...fallback.subjects];
    // Goal 4: a quote that is live for figures answers its own (checklist 5.3 replaces 2.7), and an
    // acceptance is Quoting's turn. Its hook reads one money exception, so it is handed money whichever
    // raised it, the belt or the model, beside anything else the model read.
    const moneyRaised = !!belts.money || out.exception === 'money' || listedExceptions.includes('money');
    const handed: RouterOutput = { ...out, exception: moneyRaised ? 'money' : out.exception };
    const quoting = applyQuotingRoute(file, turn, handed, liveFigureRefs, expiredRefs);
    out.subjects = handed.subjects;
    out.turnKind = handed.turnKind;
    // The same hook for Service: money on a known customer's invoice is read from the invoice row, never guessed.
    const known = !!turn.customerId;
    const moneyToService = moneyRaised && !quoting.moneyToQuoting && turn.kind !== 'portal_action' && known && invoiceMoneyQuestion(turn.body);
    if (moneyToService && !out.subjects.includes('service')) out.subjects.unshift('service');
    // The belts: regulated and money are holds the model cannot unsay. Each adds to what the model
    // read; neither displaces it, so a price question that also asks for a call carries both. Money
    // Quoting took is Quoting's to hold; a portal action raises nothing, as the hook clears it.
    const raised = new Set<Exception>();
    if (turn.kind !== 'portal_action') {
        if (belts.regulated) raised.add('regulated');
        if (moneyRaised && !quoting.moneyToQuoting && !moneyToService) raised.add('money');
        if (out.exception && out.exception !== 'money') raised.add(out.exception);
        for (const e of listedExceptions) if (e !== 'money') raised.add(e);
    }
    const exceptions = Array.from(raised).sort((a, b) => EXCEPTION_GRAVITY[a] - EXCEPTION_GRAVITY[b]);
    // A stage the router proposes that the file cannot take stays where it is; the desk applies it through set_stage.
    const { exception: _modelException, ...rest } = out;
    return { ...rest, exceptions, belts, moneyToQuoting: quoting.moneyToQuoting, moneyToService, call: res.record, error };
}
