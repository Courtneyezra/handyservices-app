/**
 * The old desk standing down while the new desk is the live desk (behaviour.md answer 37: the old
 * desk stays as roll-back, and a customer never gets two answers).
 *
 * The one question is switch.ts `commsV2Live()`. While it is yes:
 *
 *   - every automatic customer sender of the old desk is refused at the one exit
 *     (server/outbound.ts), whatever composed the message and whenever it was queued;
 *   - the spine reads as off (server/spine/switch.ts `spineMode`, server/spine/config.ts
 *     `isSpineEnabled`), so it runs no pass, drafts nothing and asks nothing;
 *   - the legacy comms agent reads as disabled with its inbound lane off
 *     (server/agents/comms.ts `getCommsAgentConfig`), so it drafts nothing for Ben's old queue.
 *
 * None of the three writes anything: the rows keep what they hold, so flipping any switch back
 * off (docs/comms-v2/cutover.md) is the whole roll-back, felt on the next read.
 *
 * Fail direction: a switch read that fails is not live, so the old desk answers; the new desk's
 * delivery reads the same row fail closed (desk/sender.ts), so on a bad read exactly one desk speaks.
 */
import type { AutomatedApprover } from '../approver';
import type { SpineConfig } from '../spine/config';
import { commsV2LiveFrom, commsV2LiveState, type LiveState } from './switch';

/**
 * Every automatic sender of the old desk that messages a customer, refused while the new desk is
 * live (the captain's list, 14 Sep: every old automatic customer message stops with the old desk,
 * and the new desk's own follow-ups are later work):
 *
 *   the legacy comms agent and its autosend lane; the spine's lane agents; the SLA sweep's chase;
 *   the rules layer's replies (first contact, the morning release, post-call, the holding line,
 *   the asks, the follow-up pack); the webform chase; the lead automations (video request, quote
 *   reminders, viewed follow-ups, lost-lead recovery).
 *
 * Not on it, and why: `agent.comms_v2` is the new desk; `rules.job_pack` is the job-pack asks after
 * a paid deposit and the contractor pack, the job's own lifecycle rather than an answer to an
 * enquiry; every other `system.*` sender is transactional or a person's own send from a screen
 * (invoices, the price screen and quote routes, the planner, quick replies, voice notes, reminders,
 * the landlord portal, the live call, template test sends); and a `human:*` send is a person.
 */
export const OLD_DESK_SENDERS = [
    'agent.comms', 'agent.comms.autosend',
    'agent.scoper', 'agent.quote_clerk', 'agent.recovery', 'agent.contractor_liaison',
    'agent.sla_chase',
    'rules.first_contact', 'rules.hours_gate', 'rules.post_call', 'rules.holding', 'rules.ask', 'rules.followup',
    'system.webform_chase', 'system.lead_automation',
] as const satisfies readonly AutomatedApprover[];

export function isOldDeskSender(approver: string): boolean {
    return (OLD_DESK_SENDERS as readonly string[]).includes(approver);
}

/** Pure, for a config the caller already read: does the old desk stand down? */
export function oldDeskStandsDownFrom(cfg: Pick<SpineConfig, 'commsDesk' | 'senders'> | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
    return commsV2LiveFrom(cfg, env).live;
}

/** The same, read now. Never throws: an unreadable answer is not live. */
export async function oldDeskStandsDown(read: () => Promise<LiveState> = () => commsV2LiveState()): Promise<boolean> {
    try {
        return (await read()).live;
    } catch {
        return false;
    }
}

/** Why the one exit refuses this approver now, or null when it does not. */
export async function oldDeskRefusal(approver: string, read?: () => Promise<LiveState>): Promise<string | null> {
    if (!isOldDeskSender(approver)) return null;
    if (!(await oldDeskStandsDown(read))) return null;
    return `${approver} is one of the old desk's automatic senders, which stand down while the new desk is the live desk (server/comms-v2/old-desk.ts); roll back with spine.commsDesk = 'spine'`;
}
