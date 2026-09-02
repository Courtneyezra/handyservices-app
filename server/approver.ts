/**
 * Approver identity — who (or what) is licensing a customer-facing send.
 *
 * Phase 0 of the comms rebuild (docs/COMMS_AGENTS_V3_DESIGN.md §1.2, §3.6). The 31 Aug–2 Sep
 * incident taught two things this module encodes: an approver is an ENUM, not a free string,
 * and the guard lives at the exit (`sendCustomerMessage`) which refuses any call that cannot name
 * both its approver and its run. Every send therefore answers "who said this could go?" and
 * "which run of what produced it?" — and a new call site that forgets either does not compile.
 *
 * Humans are `human:<id>` (email or user id). Everything else is code and is automated by
 * construction: the near-duplicate, malformed-reason and stall holds in message-drafts.ts apply to
 * every non-human approver without anyone remembering to add a prefix to a regex.
 */
import { randomUUID } from 'crypto';

/** Automated approvers: agents (LLM-backed), rules (deterministic policy) and system call sites. */
export const AUTOMATED_APPROVERS = [
    // Agents — an LLM-backed component released this.
    'agent.comms',            // the legacy comms agent releasing its own draft under the first-contact allowance
    'agent.scoper',           // Phase 2: the spine's Scoper (server/spine/agents/scoper.ts) at SEND tier
    'agent.comms.autosend',   // the comms agent's whitelist autosend lane
    'agent.sla_chase',        // the SLA sweep's chase
    // Rules — deterministic policy, no model involved.
    'rules.first_contact',    // first-contact acknowledgement (immediate or held-then-released)
    'rules.hours_gate',       // the morning release of a draft held overnight for the hour
    'rules.post_call',        // post-call follow-up rule
    'rules.holding',          // rules layer: content-free holding line (silence-breaker, flag/draft expiry)
    'rules.ask',              // rules layer: content-free ask (media, postcode)
    // System — a direct caller that is neither agent nor rule: the job itself needs the message.
    'system.invoice',
    'system.notification',
    'system.webform_chase',
    'system.quick_reply',
    'system.voice_note',
    'system.template_sync',
    'system.cron',
    'system.landlord_portal',
    'system.quotes',
    'system.daily_planner',
    'system.lead_automation',
    'system.live_call',
    'system.staff',
] as const;

export type AutomatedApprover = (typeof AUTOMATED_APPROVERS)[number];
/** A person. `<id>` is their email or user id — whatever the request carried. */
export type HumanApprover = `human:${string}`;
export type Approver = AutomatedApprover | HumanApprover;

const HUMAN_PREFIX = 'human:';

/**
 * Prefixes the pre-Phase-0 code stamped on `message_drafts.approved_by`. Rows written before
 * 2 Sep 2026 still carry them, and every "was this machine-sent?" read must keep treating them as
 * automated, or the audit views quietly reclassify history.
 */
const LEGACY_AUTOMATED_PREFIXES = ['comms_agent:', 'hours_gate:', 'first_contact_ack:', 'v2_pipeline:'] as const;

const AUTOMATED_SET: ReadonlySet<string> = new Set(AUTOMATED_APPROVERS);

/** True for a valid, current `Approver` value — the runtime twin of the type, for the exit gate. */
export function isApprover(value: unknown): value is Approver {
    if (typeof value !== 'string') return false;
    if (AUTOMATED_SET.has(value)) return true;
    return value.startsWith(HUMAN_PREFIX) && value.length > HUMAN_PREFIX.length;
}

/**
 * Is this approver code rather than a person? Accepts the current enum AND the legacy stored
 * prefixes so old rows keep behaving. A legacy human approval was a bare email (or 'admin') and
 * is still read as human here.
 */
export function isAutomatedApprover(approver: string): boolean {
    if (approver.startsWith(HUMAN_PREFIX)) return false;
    if (AUTOMATED_SET.has(approver)) return true;
    if (approver.startsWith('agent.') || approver.startsWith('rules.') || approver.startsWith('system.')) return true;
    return LEGACY_AUTOMATED_PREFIXES.some((p) => approver.startsWith(p));
}

/**
 * An AGENT approver specifically (as opposed to a rule or a system call site). The comms agent
 * reports its own sends (beta ping, promise timer) from inside its run, so message-drafts.ts must
 * not report them a second time. Legacy `comms_agent:` rows included.
 */
export function isAgentApprover(approver: string): boolean {
    return approver.startsWith('agent.') || approver.startsWith('comms_agent:');
}

/** Build the human approver value from whatever identifies the person (email or user id). */
export function humanApprover(id: string): HumanApprover {
    const clean = (id ?? '').trim();
    const bare = clean.startsWith(HUMAN_PREFIX) ? clean.slice(HUMAN_PREFIX.length) : clean;
    return `${HUMAN_PREFIX}${bare || 'admin'}`;
}

/** Short display form: 'ben' for `human:ben@handyservices.app`, the enum string otherwise. */
export function approverLabel(approver: string): string {
    if (approver.startsWith(HUMAN_PREFIX)) return approver.slice(HUMAN_PREFIX.length).split('@')[0] || 'human';
    return approver;
}

/** A fresh run id, e.g. `run_2f1c…`. Prefix names the producer: 'sys' for a direct caller, 'draft' for a draft release. */
export function newRunId(prefix: string = 'run'): string {
    return `${prefix}_${randomUUID()}`;
}
