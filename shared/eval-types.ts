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
    channel?: 'whatsapp' | 'sms' | 'webform' | 'call';
    mediaUrl?: string;
}

/**
 * A call on record for the fixture's phone (quote-prep reads calls alongside messages).
 * Self-contained: the transcript text lives in the case JSON, never in live DB rows.
 */
export interface EvalCallFixture {
    /** Minutes before "now" the call started. */
    minsAgo: number;
    direction?: 'inbound' | 'outbound';
    durationSecs?: number;
    /** AI-style short summary, as the calls table would carry. */
    jobSummary?: string;
    /** Full transcript text the clerk gets via get_thread. */
    transcription?: string;
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
    /** Quote-prep cases: calls (with transcripts) on record for this phone. */
    calls?: EvalCallFixture[];
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

// ---------------------------------------------------------------------------
// Quote-prep readiness eval (scripts/eval-quote-prep.ts) — additive extension.
// Grades runQuotePrep's readiness verdicts (quote_ready | needs_info |
// visit_first) plus gap and line quality, so readiness/escalation rule changes
// can be regression-checked before they touch production.
// ---------------------------------------------------------------------------

export type EvalReadiness = 'quote_ready' | 'needs_info' | 'visit_first' | 'decline';

/** The four polite-no reason codes (docs/DECLINE_CRITERIA.md). */
export type EvalDeclineReason = 'gas_work' | 'roofing_height' | 'structural' | 'major_electrical';
export type EvalGapImpact = 'none' | 'small' | 'large' | 'forks_job';

/** One expected open question: the intake must contain a gap matching it. */
export interface EvalGapSpec {
    /** Regex (i flag) matched against gap.question. */
    pattern: string;
    /** When set, the matching gap must be addressed to this audience. */
    audience?: 'customer' | 'ben';
    /** When set, the matching gap's impact label must be one of these. */
    impacts?: EvalGapImpact[];
}

export type EvalQuotePrepGrader =
    /** intake.readiness must equal the case's expectedReadiness. */
    | { type: 'readiness-verdict' }
    /** Expected questions present (right audience, sane impact), banned ones absent. */
    | {
        type: 'gap-alignment';
        mustInclude?: EvalGapSpec[];
        /** Regexes no gap question may match (e.g. re-asking an answered question). */
        mustNotInclude?: string[];
        /** Cap on customer-audience gaps (0 = may not ask the customer anything). */
        maxCustomerGaps?: number;
    }
    /** Mirror of the validator rules: titles <= 60 chars, no prices anywhere. */
    | { type: 'line-quality' }
    /** Deterministic checks on the rest of the intake (lines coverage, postcode, type). */
    | {
        type: 'intake-fields';
        minLines?: number;
        maxLines?: number;
        /** Each regex (i flag) must match at least one line's title+detail. */
        lineMustMatch?: string[];
        /** No line TITLE may match any of these (mixed jobs: no-go work must not be quoted as a
         *  line — detail may still mention it as context, so titles only). */
        lineMustNotMatch?: string[];
        postcode?: string | null;
        customerType?: 'homeowner' | 'landlord' | 'letting_agent' | 'business';
        /** Each entry must match one intake.excluded[] item: right reason, work matches pattern. */
        excludedMustInclude?: { reason: EvalDeclineReason; workPattern: string }[];
    };

export interface EvalQuotePrepCase {
    id: string;
    /** incident | quote-ready | needs-info | visit-first | near-miss | decline */
    family: string;
    /** regression = must hold ~100% (pass^k); capability = improvement target (pass@k). */
    kind: 'regression' | 'capability';
    /** The lane the clerk must land in for this conversation. */
    expectedReadiness: EvalReadiness;
    /** Required when expectedReadiness is 'decline': the reason code the clerk must give. */
    expectedDeclineReason?: EvalDeclineReason;
    fixture: EvalFixture;
    trials?: number;
    graders: EvalQuotePrepGrader[];
    /** Why this case exists — thread/incident it came from. */
    provenance: string;
    /** The real intake's verdict or a written ideal — proves the task is solvable. */
    reference?: string;
}

export interface EvalUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Estimated cost in GBP from published per-token prices; an estimate, not a bill. */
    estimatedGbp: number;
}

/** Shadow verifier output recorded as an advisory column — it gates nothing. */
export interface EvalVerifierAdvisory {
    priceable: boolean;
    blocker: string | null;
    suggestedAsk: string | null;
}

export interface QuotePrepTrialResult {
    trial: number;
    pass: boolean;
    graders: GraderResult[];
    /** What the clerk verdicted, null when it never submitted a valid intake. */
    readiness: EvalReadiness | null;
    /** The full submitted intake (QuoteIntake shape), for transcript reading. */
    intake: unknown;
    /** Advisory only: the shadow verifier's view of the submitted intake. */
    verifier: EvalVerifierAdvisory | null;
    /** Captured runner narration for this trial (tool calls, tokens, text). */
    transcript: string[];
    turns: number;
    usage: EvalUsage | null;
    error?: string;
}

export interface QuotePrepCaseResult {
    id: string;
    family: string;
    kind: string;
    expectedReadiness: EvalReadiness;
    trials: QuotePrepTrialResult[];
    /** All trials passed — the headline for regression cases (pass^k). */
    passAll: boolean;
    /** At least one trial passed — the headline for capability cases (pass@k). */
    passAny: boolean;
}

export interface QuotePrepEvalRun {
    runId: string;
    startedAt: string;
    finishedAt: string;
    gitRef: string;
    trialsRequested: number;
    totalUsage: EvalUsage;
    cases: QuotePrepCaseResult[];
}
