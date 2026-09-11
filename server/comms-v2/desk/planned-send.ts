/**
 * The planned send: what the desk's sandbox door emits for every turn instead of a sentence, so
 * the pipeline's end-to-end test step and Ben's sandbox can check a turn without reading prose.
 *
 * Case id, party, channel, window state, the template id if any, the rendered bubbles, the fact
 * ids and knowledge-base ids cited, every guard's result, the approver, the run id, the hold if
 * one was raised, and whether anything would reach the customer. Everything up to delivery runs
 * for real, including the guards; nothing leaves in dry run.
 *
 * The schema is the contract for whoever reads the door: a response whose planned send does not
 * fit it is a desk defect, never something a reader should guess around.
 */
import { z } from 'zod';

/** The eight guards of Contract 4, by name. */
export const CONTRACT_GUARDS = [
    'figure', 'date_time_duration', 'commitment_fault', 'business_claim',
    'disclosure', 'one_reply', 'ask_ledger', 'regulated',
] as const;
export type ContractGuard = (typeof CONTRACT_GUARDS)[number];

export const guardResultSchema = z.object({
    /** not_applied: a person wrote the words, so Contract 4 never ran over them (behaviour.md answer 43). */
    result: z.enum(['pass', 'fail', 'not_applied']),
    note: z.string().nullable().default(null),
});
export type GuardResult = z.infer<typeof guardResultSchema>;

export const holdSchema = z.object({
    /** `ben` for a homeowner; `rules:<id>` for a rule-based approver. */
    approver: z.string(),
    reason: z.string(),
    since: z.string().nullable().default(null),
});
export type Hold = z.infer<typeof holdSchema>;

export const plannedSendSchema = z.object({
    /** Contract 2 case id. */
    caseId: z.string().min(1),
    party: z.object({
        role: z.enum(['homeowner', 'tenant', 'landlord', 'contractor', 'internal']),
        /** The canonical address the reply goes to. */
        address: z.string().min(1),
        name: z.string().nullable(),
    }),
    channel: z.enum(['whatsapp', 'sms', 'email']),
    windowState: z.enum(['open', 'shut']),
    /** Null when the reply is freeform inside the window; a name when a template carries it. */
    templateId: z.string().nullable(),
    /** The rendered bubbles. Empty when nothing would go to the customer on this turn. */
    bubbles: z.array(z.string()),
    factIds: z.array(z.string()),
    kbIds: z.array(z.string()),
    guards: z.record(z.enum(CONTRACT_GUARDS), guardResultSchema),
    approver: z.string().nullable(),
    /** Who wrote the words: the desk's composer, or a person answering from Ben's board (approver `human:<slot>`). */
    author: z.enum(['desk', 'human']).default('desk'),
    runId: z.string().min(1),
    hold: holdSchema.nullable(),
    /** True when a reply would reach the customer on this turn (bubbles non-empty and the desk decided to send). */
    delivered: z.boolean(),
    /** The desk's own words about what it decided, kept beside the structured fields. */
    evidence: z.object({
        /** send, none or hold. */
        decision: z.string().nullable(),
        /** The route and the proposal in one line. */
        summary: z.string().nullable(),
        stageAfter: z.string().nullable(),
        /** Why nothing went, or what went wrong, in one line. */
        note: z.string().nullable(),
        error: z.string().nullable(),
    }),
});
export type PlannedSend = z.infer<typeof plannedSendSchema>;

/**
 * Read the planned send off a door response, or throw with the schema's reason. The one way a
 * reader should take it.
 */
export function plannedSendOfResponse(raw: unknown): PlannedSend {
    const own = (raw as { plannedSend?: unknown } | null)?.plannedSend;
    if (own === undefined || own === null) throw new Error('door response carries no planned send');
    const parsed = plannedSendSchema.safeParse(own);
    if (!parsed.success) throw new Error(`the door's planned send does not fit the schema: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return parsed.data;
}

/**
 * Whether the door put this turn's planned reply on the thread, read from the door's own state:
 * an outbound message carrying the first bubble. A reply that did not land is a door defect: the
 * next turn would run as if the desk had never spoken.
 */
export function sendLanded(ps: PlannedSend, state: unknown): boolean {
    const first = ps.bubbles[0]?.trim();
    if (!first) return false;
    const messages = (state as { messages?: unknown } | null)?.messages;
    if (!Array.isArray(messages)) return false;
    return messages.some((m) => m && typeof m === 'object' && (m as { direction?: unknown }).direction === 'outbound' && typeof (m as { content?: unknown }).content === 'string' && ((m as { content: string }).content).includes(first));
}
