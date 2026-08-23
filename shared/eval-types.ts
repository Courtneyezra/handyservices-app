/**
 * Comms eval case schema — tasks as data (docs/COMMS_EVALS_PLAN.md §2.1).
 *
 * One JSON file per case family under eval-cases/. The harness
 * (scripts/eval-comms.ts) seeds the fixture under the case's Ofcom drama
 * number, runs the trigger N times, applies the graders to what actually
 * happened (drafts + DB outcomes — never the tool-call path), and writes a
 * scoreboard with run-over-run deltas.
 */

export interface EvalThreadMessage {
    dir: 'in' | 'out';
    text: string;
    /** Minutes before "now" this message landed. */
    minsAgo: number;
    channel?: 'whatsapp' | 'sms' | 'webform';
    mediaUrl?: string;
}

export interface EvalQuoteFixture {
    slug: string;
    totalPence: number;
    lines: { description: string; pence: number }[];
    viewCount?: number;
    sentMinsAgo?: number;
}

export interface EvalFixture {
    /** Ofcom drama-range number, unique per case so cases can run in parallel. */
    phone: string;
    contactName?: string;
    stage?: string;
    thread: EvalThreadMessage[];
    quotes?: EvalQuoteFixture[];
    /** For ack-reply cases: a sent first_contact_ack draft this many minutes ago. */
    sentAckMinsAgo?: number;
}

export type EvalGrader =
    /** Draft text must match every regex (source strings, 'i' flag). */
    | { type: 'draft-must-match'; patterns: string[] }
    /** Draft text must match NONE of these. */
    | { type: 'draft-must-not-match'; patterns: string[] }
    /** At most this many question marks across the drafted reply. */
    | { type: 'question-count-max'; max: number }
    /** chatVoiceViolations(draft) must be empty. */
    | { type: 'chat-voice' }
    /** The run must have produced a customer-bound reply (queue_draft/send action). */
    | { type: 'replied' }
    /** The run must NOT have auto-sent anything (kill switch honoured). */
    | { type: 'no-autosend' }
    /** Conversation must (not) carry a tag afterwards. */
    | { type: 'tag'; tag: string; expect: boolean }
    /** Unit cases: named in-process check the harness implements. */
    | { type: 'unit'; name: 'ack-reply-consent'; text: string; expectTagged: null | string };

export interface EvalCase {
    id: string;
    family: 'incident' | 'adversarial' | 'post-quote' | 'voice' | 'backtest' | 'lifecycle' | 'first-contact';
    /** regression = must hold ~100% (pass^k); capability = improvement target (pass@k). */
    kind: 'regression' | 'capability';
    /** Agent trigger, or 'unit' for function-level cases (no agent run). */
    trigger: 'inbound' | 'sla_sweep' | 'window_closing' | 'quote_prep_gaps' | 'unit';
    fixture: EvalFixture;
    trials?: number;
    graders: EvalGrader[];
    /** Why this case exists — thread/incident it came from. */
    provenance: string;
    /** Written ideal or the human's actual reply — proves the task is solvable. */
    reference?: string;
}

export interface GraderResult {
    grader: string;
    pass: boolean;
    note?: string;
}

export interface TrialResult {
    trial: number;
    pass: boolean;
    graders: GraderResult[];
    draft: string | null;
    escalated: boolean;
    autosent: boolean;
    error?: string;
}

export interface CaseResult {
    id: string;
    family: string;
    kind: string;
    trials: TrialResult[];
    /** All trials passed. The headline for regression cases. */
    passAll: boolean;
    /** At least one trial passed. The headline for capability cases. */
    passAny: boolean;
}

export interface EvalRun {
    runId: string;
    startedAt: string;
    finishedAt: string;
    gitRef: string;
    trialsRequested: number;
    cases: CaseResult[];
}
