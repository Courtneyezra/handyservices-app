/**
 * The desk's result for one turn, and the shape the gateway calls. Kept apart from desk.ts so the
 * gateway and its tests do not import the models.
 */
import type { CaseFile, Turn, ModelCallRecord, RenderedBubble, Hold } from './case-file';

export type GuardName = 'figure' | 'date_time_duration' | 'commitment_fault' | 'business_claim' | 'disclosure' | 'one_reply' | 'ask_ledger' | 'regulated';

export interface GuardVerdict {
    result: 'pass' | 'fail';
    note: string | null;
}

/** What the desk did with one turn: the planned send (planned-send.ts), in the desk's own terms. */
export interface DeskResult {
    runId: string;
    /** send: a reply goes (or went, in dry run). none: nothing goes. hold: held with or without an acknowledgement. */
    decision: 'send' | 'none' | 'hold';
    partyId: string;
    channel: 'whatsapp' | 'sms' | 'email' | null;
    windowState: 'open' | 'shut';
    templateId: string | null;
    bubbles: RenderedBubble[];
    factIds: string[];
    kbIds: string[];
    guards: Record<GuardName, GuardVerdict>;
    approver: string | null;
    hold: Hold | null;
    delivered: boolean;
    stageAfter: string;
    calls: ModelCallRecord[];
    /** Why nothing went, or what went wrong, in one line. */
    note: string | null;
    /** The route and the proposal in one line, so a report shows why the reply is what it is. */
    summary: string | null;
    error: string | null;
    /** The outbound turn id the reply landed as, when it did. */
    landedTurnId: string | null;
    composerCalls: number;
}

export interface DeskLike {
    handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult>;
    clockPass(file: CaseFile): Promise<DeskResult>;
}

// ---------------------------------------------------------------- what a specialist returns

/** Contract 3 gather: facts with sources, and a proposal. Never prose. */
export interface Proposal {
    /** The one subject to ask next, with short labels of what is unknown about it; null when nothing to ask. */
    nextQuestion: { subject: 'job' | 'postcode' | 'access' | 'media'; unknowns: string[] } | null;
    offerCall: boolean;
    /** Say once, on the first reply of a job that arrived without a photo, that one would help if easy. Not a question. */
    mentionPhotos: boolean;
    thankForMedia: boolean;
    ready: boolean;
    /** regulated from Scoping; money beyond a quote line and acceptance in chat from Quoting. */
    hold: { reason: 'regulated' | 'money' | 'acceptance'; match: string } | null;
}

export interface SpecialistReturn {
    specialist: 'scoping' | 'quoting';
    /** Ids of the facts this pass recorded on the file. */
    factIds: string[];
    proposal: Proposal;
    /** A specialist other than Scoping briefs the composer here: fact ids and what to do this turn. Never a sentence for the customer. */
    brief?: string[];
    calls: ModelCallRecord[];
    error: string | null;
}
