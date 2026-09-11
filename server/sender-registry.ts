/**
 * THE SENDER REGISTRY — one table of everything that can message a customer (0.2, 8 Sep 2026).
 *
 * The architecture trace (S27 §3) found the shape this file fixes: there is ONE gate,
 * `sendCustomerMessage` (server/outbound.ts), and more than thirty callers of it. Eight of those
 * callers message a customer with no human tap and no switch at all; one route reached the wire
 * without the gate; and the booking confirmation passed no purpose, so the gate read it as
 * marketing and a paying customer who once wrote STOP never got their confirmation.
 *
 * `server/approver.ts` was already the NAME registry — a closed enum of who may license a send.
 * This file is the second half of it: for each of those names, what the send is FOR, whether it
 * can be switched off, and which class it belongs to. The gate consults it on every send, so:
 *
 *   1. An approver with no entry cannot send. The `Record<AutomatedApprover, …>` below makes that
 *      a COMPILE error rather than a runtime one: add a name to AUTOMATED_APPROVERS and this file
 *      stops building until you say what it is for.
 *   2. A caller that passes no `purpose` gets its REGISTERED purpose, not the blanket 'marketing'
 *      default that blocked the booking confirmation.
 *   3. An `operational` or `agent` sender can be switched off by key, in the spine's own settings
 *      namespace (`spine.senders.<key>.enabled`), so a later item can show them all on one strip.
 *
 * TRANSACTIONAL SENDERS CANNOT BE SWITCHED OFF. The booking confirmation, the job-lifecycle
 * notifications and the Twilio failure-recovery SMS are the messages a PAID job depends on;
 * a kill switch on them is a foot-gun, not a control (s29 finding 1.16). The invariant is
 * enforced at module load, below: a transactional entry with a switch key is a build error.
 *
 * Nothing here decides WHETHER a message is composed. It decides whether a composed message may
 * leave the building, and under whose name.
 */
import { AUTOMATED_APPROVERS, type AutomatedApprover } from './approver';
import type { OutboundPurpose } from './opt-out';

/**
 * What class of thing this sender is.
 *
 *   transactional  the job requires it. Never switchable: turning it off silently breaks a paid
 *                  job (a customer who paid a deposit and hears nothing).
 *   operational    deterministic policy or a system call site — a rules-layer line, an invoice
 *                  chase, a planner confirmation. Switchable.
 *   agent          an LLM-backed component releasing its own words. Switchable.
 */
export type SenderKind = 'transactional' | 'operational' | 'agent';

export interface SenderEntry {
    /** One line: what this sender sends, so the strip can name it without reading the code. */
    what: string;
    /**
     * The purpose the gate applies WHEN THE CALLER PASSES NONE. `null` means "no registered
     * default": the gate's own fail-closed 'marketing' still applies, which is right for the two
     * open classes (a person, a contractor) where the call site is the only thing that knows.
     */
    purpose: OutboundPurpose | null;
    /**
     * `spine.senders.<switchKey>.enabled`. MUST be null on a transactional sender and MUST be set
     * on every other one — checked at module load.
     */
    switchKey: string | null;
    kind: SenderKind;
}

/**
 * Every automated approver, exhaustively. The `Record` over the union is the point: a new approver
 * with no row here does not compile.
 */
export const SENDER_REGISTRY: Record<AutomatedApprover, SenderEntry> = {
    // ---- agents: an LLM-backed component released its own words -----------------------------
    'agent.comms': { what: 'the legacy comms agent releasing its own first-contact draft', purpose: 'service_reply', switchKey: 'legacy_comms', kind: 'agent' },
    'agent.comms.autosend': { what: 'the legacy comms agent\'s whitelist autosend lane', purpose: 'service_reply', switchKey: 'legacy_comms_autosend', kind: 'agent' },
    'agent.scoper': { what: 'the spine\'s Scoper at SEND tier', purpose: 'service_reply', switchKey: 'scoper', kind: 'agent' },
    'agent.quote_clerk': { what: 'the spine\'s Quote clerk', purpose: 'service_reply', switchKey: 'quote_clerk', kind: 'agent' },
    'agent.recovery': { what: 'the spine\'s Recovery agent', purpose: 'service_reply', switchKey: 'recovery', kind: 'agent' },
    'agent.contractor_liaison': { what: 'the spine\'s contractor pack', purpose: 'service_reply', switchKey: 'contractor_liaison', kind: 'agent' },
    'agent.sla_chase': { what: 'the SLA sweep\'s customer chase on a needs_info breach', purpose: 'marketing', switchKey: 'sla_chase', kind: 'agent' },
    'agent.comms_v2': { what: 'the new comms desk (server/comms-v2) releasing its own words', purpose: 'service_reply', switchKey: 'comms_v2', kind: 'agent' },

    // ---- rules: deterministic policy, no model ----------------------------------------------
    'rules.first_contact': { what: 'the first-contact acknowledgement (WhatsApp, SMS, webform, missed call)', purpose: 'service_reply', switchKey: 'first_contact_ack', kind: 'operational' },
    'rules.hours_gate': { what: 'the morning release of a draft held overnight for the hour', purpose: 'service_reply', switchKey: 'hours_gate', kind: 'operational' },
    'rules.post_call': { what: 'the post-call follow-up rule', purpose: 'service_reply', switchKey: 'post_call', kind: 'operational' },
    'rules.holding': { what: 'the content-free holding line (the one silence clock: silence, flag expiry, draft expiry)', purpose: 'service_reply', switchKey: 'holding_line', kind: 'operational' },
    'rules.ask': { what: 'the content-free asks (photo, postcode, name)', purpose: 'service_reply', switchKey: 'rules_ask', kind: 'operational' },
    'rules.followup': { what: 'the rules.followup pack (quote unviewed, promise overdue, SLA chase)', purpose: 'service_reply', switchKey: 'rules_followup', kind: 'operational' },
    'rules.job_pack': { what: 'the job-pack delivery asks after the deposit, and the contractor pack notifications', purpose: 'service_reply', switchKey: 'job_pack_ask', kind: 'operational' },

    // ---- system: a direct caller whose job needs the message ---------------------------------
    //
    // `system.notification` is the one TRANSACTIONAL name, and it carries all three of the senders
    // s29 finding 1.16 said must never gain a kill switch: the booking confirmation on a paid
    // deposit (server/email-service.ts → conversation-engine), the job-lifecycle notifications
    // (server/customer-notifications.ts) and the Twilio failure-recovery SMS
    // (server/whatsapp-api.ts). Its registered purpose is what fixes the blocked confirmation.
    'system.notification': { what: 'booking confirmation, job-lifecycle notifications, the Twilio failure-recovery SMS', purpose: 'service_reply', switchKey: null, kind: 'transactional' },

    'system.invoice': { what: 'an invoice link and the dunning chases', purpose: 'service_reply', switchKey: 'invoice', kind: 'operational' },
    'system.webform_chase': { what: 'the webform chase sequence', purpose: 'marketing', switchKey: 'webform_chase', kind: 'operational' },
    'system.quick_reply': { what: 'a saved quick reply sent from the desk', purpose: 'service_reply', switchKey: 'quick_reply', kind: 'operational' },
    'system.voice_note': { what: 'a voice note recorded in the desk', purpose: 'service_reply', switchKey: 'voice_note', kind: 'operational' },
    'system.template_sync': { what: 'a template test send from the template sync page', purpose: 'marketing', switchKey: 'template_sync', kind: 'operational' },
    'system.cron': { what: 'the day-before reminder', purpose: 'service_reply', switchKey: 'cron_reminders', kind: 'operational' },
    'system.landlord_portal': { what: 'the welcome a landlord\'s portal sends a tenant they added', purpose: 'service_reply', switchKey: 'landlord_portal', kind: 'operational' },
    'system.quotes': { what: 'the instant-quote and site-visit routes', purpose: 'service_reply', switchKey: 'quote_routes', kind: 'operational' },
    'system.daily_planner': { what: 'a dispatch confirmation sent from the planner', purpose: 'service_reply', switchKey: 'daily_planner', kind: 'operational' },
    'system.lead_automation': { what: 'the lead automations (video request, quote reminders, viewed follow-ups, lost-lead recovery)', purpose: 'marketing', switchKey: 'lead_automations', kind: 'operational' },
    'system.live_call': { what: 'a quote sent from the live-call screen', purpose: 'service_reply', switchKey: 'live_call', kind: 'operational' },
    'system.staff': { what: 'the price screen\'s send and the staff page\'s quote-link delivery', purpose: 'service_reply', switchKey: 'staff_sends', kind: 'operational' },
};

/**
 * The two OPEN classes. They are registered — a person and a contractor may always send — but they
 * carry no registered purpose, because only the call site knows whether a person is answering a
 * question (`service_reply`) or starting something (`marketing`). The gate's fail-closed
 * 'marketing' default therefore still applies to a human call site that says nothing, exactly as
 * it did before this file existed.
 *
 * Neither is switchable: a switch that stops a PERSON from replying is not a control anyone wants.
 */
export const HUMAN_SENDER: SenderEntry = { what: 'a person\'s own typed words (composer, quick reply, an approved draft)', purpose: null, switchKey: null, kind: 'transactional' };
export const CONTRACTOR_SENDER: SenderEntry = { what: 'a contractor\'s own words relayed from his job screen', purpose: null, switchKey: null, kind: 'transactional' };

const HUMAN_PREFIX = 'human:';
const CONTRACTOR_PREFIX = 'contractor:';

/** The registry row for an approver, or null when nothing may send under that name. */
export function registryEntryFor(approver: unknown): SenderEntry | null {
    if (typeof approver !== 'string') return null;
    const named = (SENDER_REGISTRY as Record<string, SenderEntry | undefined>)[approver];
    if (named) return named;
    if (approver.startsWith(HUMAN_PREFIX) && approver.length > HUMAN_PREFIX.length) return HUMAN_SENDER;
    if (approver.startsWith(CONTRACTOR_PREFIX) && approver.length > CONTRACTOR_PREFIX.length) return CONTRACTOR_SENDER;
    return null;
}

/** Every switch key in the registry, for the settings validator and the (later) switch strip. */
export function senderSwitchKeys(): string[] {
    return Object.values(SENDER_REGISTRY)
        .map((e) => e.switchKey)
        .filter((k): k is string => !!k)
        .sort();
}

/**
 * Is this sender switched on? `spine.senders.<key>.enabled`, in the same settings row as every
 * other spine switch.
 *
 * FAILS OPEN, deliberately, and this is the one place in the comms code that does. Every other
 * spine read fails closed because the question there is "may this agent START?" and silence means
 * no. Here the question is "may a message someone already composed leave?", and an unreadable
 * settings row is not a reason to drop a customer's invoice on the floor. Absent = on; a row
 * that says `{ enabled: false }` is the only thing that stops a send.
 */
export async function isSenderEnabled(switchKey: string | null): Promise<boolean> {
    if (!switchKey) return true;   // transactional: nothing to read, nothing to turn off
    try {
        const { getSpineConfig } = await import('./spine/config');
        const cfg = await getSpineConfig();
        return cfg.senders?.[switchKey]?.enabled !== false;
    } catch (error: any) {
        console.warn(`[SenderRegistry] Could not read the sender switches (treating ${switchKey} as ON):`, error?.message ?? error);
        return true;
    }
}

// ---------------------------------------------------------------- load-time invariants
//
// Same idiom as rules-layer.ts's chat-voice guard: a registry that contradicts itself is a build
// bug, not a runtime surprise. Three rules:
//
//   · a transactional sender has NO switch key (s29 finding 1.16)
//   · every operational and agent sender HAS one (item 0.2: they all reach the strip)
//   · switch keys are unique (two senders sharing a key is one switch pretending to be two)
{
    const seen = new Set<string>();
    for (const [approver, entry] of Object.entries(SENDER_REGISTRY)) {
        if (entry.kind === 'transactional' && entry.switchKey !== null) {
            throw new Error(`[SenderRegistry] ${approver} is transactional and may not carry a switch key (${entry.switchKey}): turning it off would silently break a paid job`);
        }
        if (entry.kind !== 'transactional' && !entry.switchKey) {
            throw new Error(`[SenderRegistry] ${approver} is ${entry.kind} and must carry a switch key`);
        }
        if (entry.switchKey) {
            if (seen.has(entry.switchKey)) throw new Error(`[SenderRegistry] switch key ${entry.switchKey} is used by more than one sender`);
            seen.add(entry.switchKey);
        }
    }
    const missing = AUTOMATED_APPROVERS.filter((a) => !(a in SENDER_REGISTRY));
    if (missing.length) throw new Error(`[SenderRegistry] no entry for ${missing.join(', ')}`);
}
