/**
 * The desk's result for one turn, and the shape the gateway calls. Kept apart from desk.ts so the
 * gateway and its tests do not import the models.
 */
import type { CaseFile, Turn, ModelCallRecord, RenderedBubble, Hold } from './case-file';
import type { HoldException } from './router';

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
    /** A clock pass only: what the desk did about an approver who has not acted (server/comms-v2/service/chase.ts). */
    chase?: import('../service/chase').ChaseOutcome | null;
}

export interface DeskLike {
    handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult>;
    clockPass(file: CaseFile): Promise<DeskResult>;
    /**
     * A call turn's transcript landed after the desk had already read the call at hang-up: read it
     * for facts only, never a send (channels/channel-desk.ts). Returns the fact ids it recorded.
     */
    readLateTranscript?(file: CaseFile, turn: Turn): Promise<string[]>;
}

// ---------------------------------------------------------------- what a specialist returns

/** Contract 3 gather: facts with sources, and a proposal. Never prose. */
export interface Proposal {
    /** The one subject to ask next, with short labels of what is unknown about it; null when nothing to ask. */
    nextQuestion: { subject: 'job' | 'postcode' | 'access' | 'media'; unknowns: string[] } | null;
    offerCall: boolean;
    /** Say once, on the first reply of a job that arrived without a photo, that one would help if easy. Not a question. */
    mentionPhotos: boolean;
    /** A photo has arrived on the thread and has not been thanked for yet, whichever turn brought it: the ledger's one thanks is still owed (checklist 1.7). */
    thankForMedia: boolean;
    ready: boolean;
    /**
     * regulated from Scoping; Service's reasons (service/hold-reasons.ts); money beyond a quote line, acceptance in chat,
     * a failed draft and a stale quote from Quoting; a date change or an unconfirmed date from Scheduling.
     * `acceptedInChat`: the same turn also said yes to the quote, whatever the reason.
     * `rest`: on a regulated hold, the work we do the same message also asked for, which is still scoped (scoping-tools.ts workBesideRegulated).
     */
    hold: { reason: HoldException | 'acceptance' | 'draft_failed' | 'stale_quote'; match: string; acceptedInChat?: boolean; rest?: string } | null;
}

export interface SpecialistReturn {
    specialist: 'scoping' | 'quoting' | 'scheduling' | 'service';
    /** Ids of the facts this pass recorded on the file. */
    factIds: string[];
    proposal: Proposal;
    calls: ModelCallRecord[];
    error: string | null;
    /** A specialist other than Scoping briefs the composer here: which fact to copy verbatim, what to do this turn, what not to say. Never a sentence for the customer. */
    brief?: string[];
    /** One line of evidence for the run summary. */
    note?: string | null;
}
