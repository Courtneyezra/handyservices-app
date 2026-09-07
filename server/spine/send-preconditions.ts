/**
 * Send preconditions (B7a, PRD v3 §5.1–§5.3): the deterministic gate on the MOVE of a SEND-tier
 * customer reply. Pure: no model, no database, no clock of its own.
 *
 * The words of a Scoper reply are generated and the content rail (guards.ts, checkProposedBody)
 * checks them. What the rail cannot see is whether the move is right for where the thread is:
 * the five incident sends the text guards do not hold are clean sentences that carry on scoping
 * past a price objection, a price question or a callback request (eval-cases/guards/
 * incident-v2-unguarded.json). Every one of them is a money or post-quote situation. These rules
 * fence that boundary off the CASE FILE and the TRIAGE RESULT, never off the reply's wording:
 *
 *   every intent        reactive (the customer wrote within REACTIVE_WINDOW_MINUTES);
 *                       the newest conversation item is the customer's, not ours;
 *                       the body is not empty (BACKLOG D4)
 *   ask_gap             no quote on the case file (paid or not); no date asked; no question mark
 *                       in the customer's last message
 *   confirm_received    the last inbound carries media or a UK postcode — something arrived
 *   point_to_quote_page a quote exists and the body names its slug
 *   point_to_picker     a live (unpaid) quote exists and the body names its slug
 *   anything else       refused — an intent with no rule does not send
 *
 * `decide` calls `sendPrecondition` as the LAST check before a send, only when the resolved tier
 * is SEND on an agent-facing customer pack (customer.*; the rules packs are content-free and SEND
 * by construction, and never come here). A refusal becomes a pending draft for Ben with
 * `precondition: <code>` as the reason. DRAFT-tier behaviour never reaches this file, so nothing
 * changes until a person sets a tier.
 *
 * The seam for the deferred second-model move check (the owner's "secondary llm to reflect") is
 * AFTER this function returns null and BEFORE the exit sends: in runOnce, between decide and exit.
 * Nothing here anticipates it.
 */
import { UK_POSTCODE_RE } from './asks';
import type { CaseFile, Proposal, TimelineItem, TriageResult } from './types';

/** How recently the customer must have written for a reply to count as reactive (mirrors comms.ts). */
export const REACTIVE_WINDOW_MINUTES = 45;

export function isReactive(caseFile: CaseFile, now: Date): boolean {
    const at = caseFile.window.lastInboundAt ? new Date(caseFile.window.lastInboundAt).getTime() : NaN;
    return Number.isFinite(at) && now.getTime() - at <= REACTIVE_WINDOW_MINUTES * 60_000 && now.getTime() >= at;
}

/** The refusal codes, closed. `decide` prefixes them with `precondition: `. */
export const PRECONDITION = {
    notReactive: 'not_reactive',
    oursIsNewest: 'ours_is_newest',
    emptyBody: 'empty_body',
    askGapQuoteOnCase: 'ask_gap:quote_on_case',
    askGapDateAsked: 'ask_gap:date_asked',
    askGapCustomerQuestion: 'ask_gap:customer_question',
    confirmNothingArrived: 'confirm_received:nothing_arrived',
    quotePageNoQuote: 'point_to_quote_page:no_quote',
    quotePageSlugNotInBody: 'point_to_quote_page:slug_not_in_body',
    pickerNoLiveQuote: 'point_to_picker:no_live_quote',
    pickerSlugNotInBody: 'point_to_picker:slug_not_in_body',
} as const;
export type PreconditionCode = (typeof PRECONDITION)[keyof typeof PRECONDITION] | `no_rule:${string}`;

export const PRECONDITION_REASON_PREFIX = 'precondition: ';

/** The intents the preconditions have a rule for. Everything else refuses with no_rule. */
export const PRECONDITIONED_INTENTS = ['ask_gap', 'confirm_received', 'point_to_quote_page', 'point_to_picker'] as const;

export interface SendPreconditionInput {
    intent: string;
    caseFile: CaseFile;
    triage: TriageResult;
    proposal: Proposal;
    now: Date;
}

const CONVERSATION_KINDS: ReadonlySet<TimelineItem['kind']> = new Set<TimelineItem['kind']>(['message_in', 'message_out', 'call_in', 'call_out', 'draft_pending']);
const OUR_KINDS: ReadonlySet<TimelineItem['kind']> = new Set<TimelineItem['kind']>(['message_out', 'call_out', 'draft_pending']);

function at(t: TimelineItem): number {
    const n = new Date(t.at).getTime();
    return Number.isFinite(n) ? n : 0;
}

/** The newest item that is a turn in the conversation (notes and flags are not turns). Pure. */
export function newestConversationItem(caseFile: CaseFile): TimelineItem | null {
    let best: TimelineItem | null = null;
    for (const t of caseFile.timeline) {
        if (!CONVERSATION_KINDS.has(t.kind)) continue;
        if (!best || at(t) >= at(best)) best = t;
    }
    return best;
}

/** The customer's newest message. Pure. */
export function lastInboundItem(caseFile: CaseFile): TimelineItem | null {
    let best: TimelineItem | null = null;
    for (const t of caseFile.timeline) {
        if (t.kind !== 'message_in') continue;
        if (!best || at(t) >= at(best)) best = t;
    }
    return best;
}

/** Something arrived on the customer's last message: media, or a UK postcode in the body. */
export function lastInboundBroughtSomething(caseFile: CaseFile): boolean {
    const last = lastInboundItem(caseFile);
    if (!last) return false;
    if (last.mediaIds?.length) return true;
    return UK_POSTCODE_RE.test(last.body ?? '');
}

function bodyText(proposal: Proposal): string {
    return proposal.body.map((b) => b ?? '').join('\n');
}

/**
 * The refusal reason, or null when the move may send. Reads the case file, the triage result and
 * the proposal's intent and slug; never judges the wording.
 */
export function sendPrecondition(input: SendPreconditionInput): PreconditionCode | null {
    const { intent, caseFile, triage, proposal, now } = input;

    if (!isReactive(caseFile, now)) return PRECONDITION.notReactive;
    const newest = newestConversationItem(caseFile);
    if (newest && OUR_KINDS.has(newest.kind)) return PRECONDITION.oursIsNewest;
    if (!bodyText(proposal).trim()) return PRECONDITION.emptyBody;

    const quote = caseFile.quote ?? null;
    const body = bodyText(proposal);

    switch (intent) {
        case 'ask_gap': {
            if (quote) return PRECONDITION.askGapQuoteOnCase;
            if (triage.dateAsked) return PRECONDITION.askGapDateAsked;
            const last = lastInboundItem(caseFile);
            if ((last?.body ?? '').includes('?')) return PRECONDITION.askGapCustomerQuestion;
            return null;
        }
        case 'confirm_received':
            return lastInboundBroughtSomething(caseFile) ? null : PRECONDITION.confirmNothingArrived;
        case 'point_to_quote_page':
            if (!quote) return PRECONDITION.quotePageNoQuote;
            return body.includes(quote.slug) ? null : PRECONDITION.quotePageSlugNotInBody;
        case 'point_to_picker':
            if (!quote || quote.paid) return PRECONDITION.pickerNoLiveQuote;
            return body.includes(quote.slug) ? null : PRECONDITION.pickerSlugNotInBody;
        default:
            return `no_rule:${intent}`;
    }
}
