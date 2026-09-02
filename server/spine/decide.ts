/**
 * The tier decision (design §3.6), pure:
 *
 *   SEND     iff the intent is at SEND tier in this pack
 *            AND no open exception on the thread
 *            AND hours allow (reactive 24/7 within 45 min of an inbound; proactive only inside
 *                the pack's proactive window, UK time — server/working-hours.ts)
 *            AND the channel can deliver (window open, or an approved template, or SMS thread)
 *   PENDING  with due_at otherwise (a person decides)
 *   FLAG     with due_at for exceptions and Ben-only guard hits
 *   DROP     opted out / spam
 *   NONE     nothing to say (no proposal, READ/PROPOSE tier)
 */
import type { Approver } from '../approver';
import { dueAtFor, nextWorkingSlot, ukHour, type WorkingClock } from '../working-hours';
import { tierFor } from './packs';
import type { CaseFile, Decision, ExceptionKind, GuardName, GuardVerdict, PolicyPack, Proposal, TriageResult } from './types';

/** How recently the customer must have written for a reply to count as reactive (mirrors comms.ts). */
export const REACTIVE_WINDOW_MINUTES = 45;

export interface DecideInput {
    proposal: Proposal | null;
    guards: GuardVerdict | null;
    pack: PolicyPack;
    triage: TriageResult;
    caseFile: CaseFile;
    now?: Date;
}

/** Which Approver a SEND from this pack carries (the exit refuses without one). */
export function approverFor(pack: PolicyPack, intent: string): Approver {
    if (pack.id === 'rules.first_contact') {
        if (intent.startsWith('ask_')) return 'rules.ask';
        if (intent === 'holding') return 'rules.holding';
        return 'rules.first_contact';
    }
    if (pack.id === 'rules.followup') return 'rules.followup';
    if (pack.audience === 'contractor') return 'agent.contractor_liaison';
    if (pack.audience === 'internal') return 'human:internal';
    return 'agent.scoper';
}

export function exceptionForGuard(guard: GuardName): ExceptionKind {
    switch (guard) {
        case 'money': case 'discount': case 'price_objection': case 'money_to_customer': return 'money_question';
        case 'date_promise': return 'date_question';
        default: return 'trust_concern';
    }
}

export function isReactive(caseFile: CaseFile, now: Date): boolean {
    const at = caseFile.window.lastInboundAt ? new Date(caseFile.window.lastInboundAt).getTime() : NaN;
    return Number.isFinite(at) && now.getTime() - at <= REACTIVE_WINDOW_MINUTES * 60_000 && now.getTime() >= at;
}

export function hoursAllow(pack: PolicyPack, caseFile: CaseFile, now: Date): { ok: boolean; nextAt?: Date; reason?: string } {
    if (pack.hours.reactiveAlways && isReactive(caseFile, now)) return { ok: true };
    const hour = ukHour(now);
    if (hour >= pack.hours.proactiveFromHour && hour < pack.hours.proactiveToHour) return { ok: true };
    const clock: WorkingClock = { startHour: pack.hours.proactiveFromHour, endHour: pack.hours.proactiveToHour, days: [0, 1, 2, 3, 4, 5, 6] };
    return { ok: false, nextAt: nextWorkingSlot(now, clock), reason: `outside proactive hours ${pack.hours.proactiveFromHour}-${pack.hours.proactiveToHour} UK (hour ${hour}) and not reactive` };
}

export function deliverable(pack: PolicyPack, caseFile: CaseFile, intent: string): { ok: boolean; how?: 'freeform' | 'template' | 'sms'; reason?: string } {
    if (caseFile.window.channelLastUsed === 'sms') return { ok: true, how: 'sms' };
    if (caseFile.window.canFreeform) return { ok: true, how: 'freeform' };
    if ((pack.templates as Record<string, string | undefined>)[intent]) return { ok: true, how: 'template' };
    return { ok: false, reason: 'WhatsApp window shut and the pack has no approved template for this intent' };
}

export function decide(input: DecideInput): Decision {
    const { proposal, guards, pack, triage, caseFile } = input;
    const now = input.now ?? new Date();
    const urgent = triage.exceptions.includes('callback_requested') || caseFile.tags.includes('callback_requested');
    const flagDue = () => dueAtFor(urgent ? 'flag_urgent' : 'flag', now).toISOString();
    const draftDue = () => dueAtFor('draft', now).toISOString();

    // 1. Nobody gets a message.
    if (triage.exceptions.includes('opted_out')) return { kind: 'drop', reason: 'customer opted out' };
    if (triage.exceptions.includes('spam')) return { kind: 'drop', reason: 'spam' };

    // 2. Exceptions → Ben, before anything an agent may have proposed.
    const exception = triage.exceptions.find((e) => e !== 'spam' && e !== 'opted_out');
    if (triage.lane === 'ben' || exception) {
        return { kind: 'flag', exception: exception ?? 'out_of_scope', dueAt: flagDue(), note: triage.reasons.join('; ') || 'triage routed this thread to Ben' };
    }

    // 3. Nothing proposed.
    if (!proposal) return { kind: 'none', reason: 'no proposal' };
    if (proposal.flag) return { kind: 'flag', exception: proposal.flag.exception, dueAt: flagDue(), note: proposal.flag.note };

    // 4. The pack's vocabulary and guards.
    if (!(pack.allowedIntents as string[]).includes(proposal.intent)) {
        return { kind: 'pending', dueAt: draftDue(), reason: `intent ${proposal.intent} is not in pack ${pack.id}` };
    }
    if (guards && !guards.ok) {
        if (guards.escalate) {
            const g = guards.guardsHit.find((x) => ['money', 'discount', 'date_promise', 'liability', 'duration_claim', 'policy_commitment', 'price_objection', 'money_to_customer'].includes(x)) ?? guards.guardsHit[0];
            return { kind: 'flag', exception: exceptionForGuard(g), dueAt: flagDue(), note: `guard ${g} refused the proposal: ${guards.notes.join('; ').slice(0, 400)}` };
        }
        return { kind: 'pending', dueAt: draftDue(), reason: `guard hit: ${guards.guardsHit.join(', ')}` };
    }

    // 5. Tier.
    const tier = tierFor(pack, proposal.intent);
    if (tier === 'READ') return { kind: 'none', reason: `pack ${pack.id} is read-only` };
    if (tier === 'PROPOSE') return { kind: 'none', reason: `proposal recorded (tier PROPOSE); nothing goes to the customer` };

    // 6. An open exception on the thread means a person is already on it.
    if (caseFile.openFlags.length || caseFile.tags.includes('needs_ben') || caseFile.tags.includes('trust_concern')) {
        return { kind: 'pending', dueAt: draftDue(), reason: 'open exception on the thread (needs_ben / trust_concern / open flag)' };
    }

    // 7. Hours.
    const hours = hoursAllow(pack, caseFile, now);
    if (!hours.ok) return { kind: 'pending', dueAt: (hours.nextAt ?? new Date(draftDue())).toISOString(), reason: hours.reason ?? 'outside hours' };

    // 8. Deliverability.
    const d = deliverable(pack, caseFile, proposal.intent);
    if (!d.ok) return { kind: 'pending', dueAt: draftDue(), reason: d.reason ?? 'not deliverable' };

    if (tier === 'SEND') return { kind: 'send', approver: approverFor(pack, proposal.intent) };
    return { kind: 'pending', dueAt: draftDue(), reason: `intent ${proposal.intent} is at tier ${tier} in pack ${pack.id}` };
}
