/**
 * The spine contract (Phase 2, docs/COMMS_AGENTS_V3_DESIGN.md §3).
 *
 * Every comms run flows: ingest → claim → case file → triage → policy pack → agent proposal → guards
 * → decision → exit. This file is the shared vocabulary all three Phase 2 streams build against.
 * Keep it dependency-free (types only) so any module can import it without cycles.
 */
import type { Approver } from '../approver';

export type Audience = 'customer' | 'contractor' | 'supplier' | 'internal';
export type Stage = 'enquiry' | 'scoping' | 'quote_sent' | 'booked' | 'closed' | 'won';
export type Tier = 'READ' | 'PROPOSE' | 'DRAFT' | 'SEND';
export type Trigger = 'inbound_message' | 'media_received' | 'call_ended' | 'cadence' | 'flag_expiry' | 'manual';
export type AgentName = 'triage' | 'rules' | 'scoper' | 'quote_clerk' | 'recovery' | 'verifier' | 'contractor_liaison';

/** Fixed vocabularies. Routing is by lane and exception, never by a confidence score (§2.3). */
export type Lane = 'dropped' | 'rules' | 'scoper' | 'post_quote' | 'ben' | 'quote_clerk' | 'contractor';
export type ExceptionKind =
    | 'complaint' | 'trust_concern' | 'refund' | 'out_of_scope' | 'regulated_trade'
    | 'money_question' | 'date_question' | 'callback_requested' | 'spam' | 'opted_out';

export type Intent =
    // rules layer (content-free, template only)
    | 'ack_enquiry' | 'ack_photos' | 'ack_returning' | 'ask_media' | 'ask_postcode' | 'ask_name'
    | 'holding' | 'quote_on_its_way' | 'quote_unviewed' | 'promise_overdue_holding' | 'sla_chase'
    // scoper (customer.default)
    | 'ask_gap' | 'clarify_scope' | 'confirm_received' | 'faq_from_kb' | 'point_to_quote_page' | 'closing'
    // scoper (customer.post_quote)
    | 'answer_from_quote' | 'point_to_picker'
    // contractor.default
    | 'job_brief' | 'availability_ask' | 'confirm_receipt' | 'materials_list';

/** Names of detectors in server/agents/draft-guards.ts plus the contractor-pack pair. */
export type GuardName =
    | 'money' | 'discount' | 'date_promise' | 'duration_claim' | 'capability_claim' | 'liability'
    | 'policy_commitment' | 'capitulation' | 'voice' | 'unseen_implication' | 'price_objection'
    | 'customer_pii' | 'money_to_customer';

export interface PolicyPack {
    id: string;                 // e.g. 'customer.default'
    version: number;
    audience: Audience;
    stage?: Stage;
    city?: string;              // pack-level city key so the second city is config (§3.4)
    allowedIntents: Intent[];
    guardSet: GuardName[];
    /** Tier per intent; anything not listed uses defaultTier. Promotion/demotion edits this (Phase 3). */
    tierByIntent: Partial<Record<Intent, Tier>>;
    defaultTier: Tier;
    hours: { reactiveAlways: boolean; proactiveFromHour: number; proactiveToHour: number };
    exceptionsToBen: ExceptionKind[];
    voiceFile: string;          // path under brand-voice/
    templates: Partial<Record<Intent, string>>; // approved Meta template names by intent
}

export interface TimelineItem {
    at: string;                 // ISO
    kind: 'message_in' | 'message_out' | 'call_in' | 'call_out' | 'note' | 'draft_pending' | 'flag';
    channel?: 'whatsapp' | 'sms' | 'call' | 'email' | 'webchat' | 'note';
    body?: string;
    by?: string;                // Approver string or 'customer'
    mediaIds?: string[];
    transcript?: string;
}
export interface MediaItem { id: string; kind: 'image' | 'video' | 'audio' | 'document'; url?: string; description?: string }

/** One immutable object per run; the ONLY thing an agent reads (§3.2). */
export interface CaseFile {
    conversationId: string;
    phone: string;              // E.164
    audience: Audience;
    stage: Stage;
    city?: string;
    contactName?: string | null;
    timeline: TimelineItem[];   // quarantined rows excluded
    media: MediaItem[];
    window: { canFreeform: boolean; templateRequired: boolean; lastInboundAt?: string | null; channelLastUsed: 'whatsapp' | 'sms' | 'email' | 'webchat' };
    client?: { id: string; name?: string | null; properties?: number } | null;
    quote?: { slug: string; total?: number | null; lines: number; viewedAt?: string | null; expiresAt?: string | null; paid: boolean } | null;
    openPromises: { text: string; dueAt: string }[];
    openFlags: { exception: ExceptionKind; note: string; dueAt: string }[];
    tags: string[];
    lastRun?: { runId: string; agent: AgentName; decision: string; at: string } | null;
    hash: string;               // sha256 of the serialised file, stored as agent_runs.case_file_ref
    builtAt: string;
}

export interface TriageResult {
    audience: Audience;
    intent: Intent | 'unknown';
    lane: Lane;
    exceptions: ExceptionKind[];
    stage: Stage;
    tags: string[];
    reasons: string[];
    source: 'rules' | 'model';
    model?: string;
}

/** What an agent returns. It never sends (§3.6). */
export interface Proposal {
    intent: Intent;
    body: string[];             // one entry per WhatsApp bubble
    reasons: string[];
    citations?: string[];       // quote slug, template name, KB entry…
    flag?: { exception: ExceptionKind; note: string } | null;
    contactName?: string | null;
    recontactAt?: string | null;
}

export type Decision =
    | { kind: 'send'; approver: Approver }
    | { kind: 'pending'; dueAt: string; reason: string }
    | { kind: 'flag'; exception: ExceptionKind; dueAt: string; note: string }
    | { kind: 'drop'; reason: string }
    | { kind: 'none'; reason: string };

export interface GuardVerdict { ok: boolean; guardsHit: GuardName[]; escalate: boolean; notes: string[] }

export interface SpineRun {
    runId: string;
    agent: AgentName;
    trigger: Trigger;
    pack: Pick<PolicyPack, 'id' | 'version'>;
    caseFile: CaseFile;
    triage: TriageResult;
    proposal?: Proposal | null;
    guards?: GuardVerdict;
    decision: Decision;
    model?: string;
    usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
    costPence?: number;
    durationMs?: number;
}

export interface SpineAgent {
    name: AgentName;
    tier: Tier;
    /** Return null when there is nothing to propose. Must not send, price, or book. */
    run(input: { caseFile: CaseFile; pack: PolicyPack; triage: TriageResult; runId: string }): Promise<Proposal | null>;
}

/** Function contracts implemented in Phase 2 (server/spine/*.ts). */
export interface SpineApi {
    requestRun(conversationId: string, trigger: Trigger, opts?: { delayMs?: number; runId?: string }): Promise<{ queued: boolean; reason?: string }>;
    runDue(limit?: number): Promise<SpineRun[]>;
    buildCaseFile(conversationId: string): Promise<CaseFile>;
    triage(caseFile: CaseFile): Promise<TriageResult>;
    resolvePack(caseFile: CaseFile, triage: TriageResult): PolicyPack;
    checkProposal(proposal: Proposal, pack: PolicyPack, caseFile: CaseFile): GuardVerdict;
    decide(input: { proposal: Proposal | null; guards: GuardVerdict | null; pack: PolicyPack; triage: TriageResult; caseFile: CaseFile }): Decision;
    exit(run: SpineRun): Promise<void>;
}
