/**
 * Contract 3, the router: Haiku 4.5 at low effort, structured output, no prose. Reads the case
 * file and the new turn; returns the subjects the turn touches in order of primacy, a proposed
 * stage, the party addressed, and an exception if one applies. Never invents a subject: an
 * unclassifiable turn goes to Scoping before ready and to Service after. The router never sees a
 * tool. Two deterministic belts sit under it: the regulated matcher (a hold the model cannot
 * unsay) and the money-question matcher (2.7 cannot depend on one model reading).
 */
import { z } from 'zod/v4';
import { isReady, type CaseFile, type Turn, type ModelCallRecord, STAGES } from './case-file';
import { moneyQuestionMatch, regulatedMatch } from './lexicon';
import { ROUTER_MODEL, type ModelClient } from './models';
import { applyQuotingRoute } from '../quoting/quoting-specialist';

export const SUBJECTS = ['scoping', 'quoting', 'scheduling', 'service'] as const;
export type Subject = (typeof SUBJECTS)[number];
export const EXCEPTIONS = ['money', 'complaint', 'refund', 'trust_doubt', 'regulated', 'date_change'] as const;
export type Exception = (typeof EXCEPTIONS)[number];
export const TURN_KINDS = ['enquiry', 'answer', 'question', 'short_pause', 'promise_of_more', 'acknowledgement', 'decline', 'not_ready', 'other'] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

export const routerOutputSchema = z.object({
    subjects: z.array(z.enum(SUBJECTS)).max(4),
    proposedStage: z.enum(STAGES),
    party: z.literal('customer'),
    exception: z.enum(EXCEPTIONS).nullable(),
    turnKind: z.enum(TURN_KINDS),
});
export type RouterOutput = z.infer<typeof routerOutputSchema>;

export interface Route extends RouterOutput {
    /** What the deterministic belts found, beside the model's reading. */
    belts: { regulated: string | null; money: string | null };
    /**
     * The turn carried a money exception and Goal 4's hook handed it to Quoting instead (5.3): true
     * however the exception was raised, the belt or the model. Quoting raises the hold itself when
     * its own reading does not answer, so 2.7 never rests on one model reading.
     */
    moneyToQuoting: boolean;
    call: ModelCallRecord;
    error: string | null;
}

const SYSTEM = [
    'You route one customer WhatsApp turn for a small handyman business\'s desk. You classify; you never write to the customer and never see a tool.',
    'Subjects, in order of primacy for this turn: scoping (what the job is and where, access, photos, a call), quoting (price, what a quote includes), scheduling (dates, when we can come, lead time), service (facts about the business, changes of details, invoices, aftercare).',
    'A turn can touch two subjects ("how much, and when can you come?"): list both, primary first. A bare statement about the job, an answer to a question, a pause or a thanks is scoping while the job is being scoped.',
    'proposedStage: first_contact for the opening message; scoping once the conversation is under way; ready only when the job type and the location are both known; quoted, accepted, booked, done are later stages you do not propose unless the file already shows them.',
    'exception, or null: money (asks a price, a cost, a discount, anything beyond reading a quote line back), complaint (unhappy with us or our work), refund, trust_doubt (are you legit, are you insured, a scam worry), regulated (gas or asbestos work), date_change (changing a booked date). "Can I get a quote for X" is an enquiry, not money.',
    'turnKind: enquiry (a new job), answer (details in reply to a question), question (asks us something), short_pause ("one sec", "let me check", "hang on"), promise_of_more ("I\'ll send photos tomorrow", "I\'ll get back to you with the measurements"), acknowledgement ("ok thanks", "makes sense"), decline (declines a photo, a call or a suggestion), not_ready ("I\'ll get back to you next month"), other.',
    'Reply with the JSON object only.',
].join('\n');

function threadFor(file: CaseFile, turn: Turn): string {
    const lines = file.turns.slice(-12).map((t) => `${t.id === turn.id ? '>> ' : ''}${t.direction === 'inbound' ? 'customer' : 'desk'}: ${t.body || (t.media.length ? `[${t.media.length} ${t.media[0].kind}${t.media.length > 1 ? 's' : ''}]` : '[empty]')}`);
    return lines.join('\n');
}

export async function route(file: CaseFile, turn: Turn, client: ModelClient, liveFigureRefs: ReadonlySet<string> = new Set()): Promise<Route> {
    const belts = { regulated: regulatedMatch(turn.body), money: moneyQuestionMatch(turn.body) };
    const user = [
        `Stage now: ${file.stage}. Job type known: ${file.job.type ? 'yes' : 'no'}. Location known: ${file.job.location ? 'yes' : 'no'}.`,
        `Thread (the turn to route is marked >>):`,
        threadFor(file, turn),
        turn.media.length ? `The marked turn carries ${turn.media.length} ${turn.media[0].kind}${turn.media.length > 1 ? 's' : ''}.` : '',
    ].filter(Boolean).join('\n');
    const res = await client.structured({ role: 'router', model: ROUTER_MODEL, effort: 'low', system: SYSTEM, user, schema: routerOutputSchema, maxTokens: 400 });
    const fallback: RouterOutput = { subjects: [isReady(file) && file.stage !== 'scoping' && file.stage !== 'first_contact' ? 'service' : 'scoping'], proposedStage: file.stage === 'first_contact' ? 'scoping' : file.stage, party: 'customer', exception: null, turnKind: 'other' };
    const out = res.output ?? fallback;
    // Never invents a subject: an empty list is unclassifiable.
    if (!out.subjects.length) out.subjects = [...fallback.subjects];
    // The belts: regulated and money are holds the model cannot unsay.
    if (belts.regulated) out.exception = 'regulated';
    else if (belts.money && !out.exception) out.exception = 'money';
    // Goal 4: a quote that is live for figures answers its own (checklist 5.3 replaces 2.7); an acceptance is Quoting's turn.
    const quoting = applyQuotingRoute(file, turn, out, liveFigureRefs);
    // A stage the router proposes that the file cannot take stays where it is; the desk applies it through set_stage.
    return { ...out, belts, moneyToQuoting: quoting.moneyToQuoting, call: res.record, error: res.error };
}
