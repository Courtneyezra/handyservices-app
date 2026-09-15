/**
 * The old comms page (/admin/comms) retiring for customers while the new desk is the live desk (the
 * captain, 15 Sep 2026: "the old comms to be removed"). Live, that page would show a customer's
 * inbound messages without the desk's replies, and a send from it would reach the customer past the
 * case file, so while switch.ts `commsV2Live()` says yes:
 *
 *   - a customer thread is sent from Ben's board (/admin/comms-v2) and nowhere else: the old page's
 *     own sends (the composer, templates, quick replies, voice notes and draft approval) are refused
 *     for any thread that is not a contractor's (`oldCommsSendRefusal`);
 *   - a staff link or notification that would open a customer thread on the old page opens the new
 *     board instead (`staffThreadPath`), asked at the moment the link is built;
 *   - the contractor lane stays: the new desk never takes contractors, so the old page is still the
 *     only place staff message them, and a contractor thread keeps its old link and its sends.
 *
 * Nothing is written and nothing is deleted: with any switch off the answer is no and the old page,
 * its links and its sends are exactly as they were (docs/comms-v2/cutover.md, roll-back).
 *
 * Fail direction: an unreadable switch is not live (old-desk.ts `oldDeskStandsDown`), so the old page
 * answers, as the old desk does on the same read. Live, a thread whose role cannot be read is treated
 * as a customer's: a send is refused and a link opens the board.
 */
import { eq } from 'drizzle-orm';
import { conversations } from '@shared/schema';
import { normalizePhoneNumber } from '../phone-utils';
import { oldDeskStandsDown } from './old-desk';
import type { LiveState } from './switch';

export const NEW_BOARD_PATH = '/admin/comms-v2';
export const OLD_COMMS_PATH = '/admin/comms';
/** The old page with only its contractor lane, the part that stays while the new desk is live. */
export const CONTRACTOR_LANE_PATH = '/admin/comms?lane=contractor';
/** The error code a refused old-page send answers with. */
export const OLD_COMMS_RETIRED = 'OLD_COMMS_RETIRED';

/** A thread as the old routes know it: by conversation id, or by the number they send to. */
export interface ThreadRef {
    conversationId?: string | null;
    phone?: string | null;
}

export interface OldCommsDeps {
    liveState?: () => Promise<LiveState>;
    /** conversations.role_profile of the thread, null when there is no such thread. */
    roleOf?: (ref: ThreadRef) => Promise<string | null>;
}

/** The conversations.phone_number key (`447…@c.us`) for any shape of number the old routes carry. */
export function conversationKeyOf(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const bare = String(phone).replace('@c.us', '');
    const digits = (normalizePhoneNumber(bare) ?? bare).replace(/\D/g, '');
    return digits ? `${digits}@c.us` : null;
}

async function roleOfThread(ref: ThreadRef): Promise<string | null> {
    const { db } = await import('../db');
    const where = ref.conversationId
        ? eq(conversations.id, ref.conversationId)
        : (() => { const key = conversationKeyOf(ref.phone); return key ? eq(conversations.phoneNumber, key) : null; })();
    if (!where) return null;
    const [row] = await db.select({ role: conversations.roleProfile }).from(conversations).where(where).limit(1);
    return row?.role ?? null;
}

/** Is the old page retired for customers now? Never throws: an unreadable answer is no. */
export async function oldCommsRetired(deps: OldCommsDeps = {}): Promise<boolean> {
    return oldDeskStandsDown(deps.liveState);
}

/** True only for a thread read as a contractor's; a failed read is a customer's. */
async function isContractorThread(ref: ThreadRef, deps: OldCommsDeps): Promise<boolean> {
    try {
        return (await (deps.roleOf ?? roleOfThread)(ref)) === 'contractor';
    } catch {
        return false;
    }
}

/** Why an old-page send to this thread is refused now, or null when it may go. */
export async function oldCommsSendRefusal(ref: ThreadRef, deps: OldCommsDeps = {}): Promise<string | null> {
    if (!(await oldCommsRetired(deps))) return null;
    if (await isContractorThread(ref, deps)) return null;
    return `The new desk is the live desk, so customer replies go from Comms Desk v2 (${NEW_BOARD_PATH}), where they land on the case file. Only contractor threads still send from the old comms page.`;
}

/**
 * Pure: where a staff link to a thread lands. Not retired, the old link exactly as it was built
 * before; retired, the new board, except a contractor thread, which keeps the old page's contractor lane.
 */
export function staffThreadPathFrom(retired: boolean, ref: { conversationId?: string | null; contractor: boolean }): string {
    const old = ref.conversationId ? `${OLD_COMMS_PATH}?conversation=${ref.conversationId}` : OLD_COMMS_PATH;
    if (!retired) return old;
    if (!ref.contractor) return NEW_BOARD_PATH;
    return ref.conversationId ? old : CONTRACTOR_LANE_PATH;
}

/** Where a staff link or notification to this thread (or to the comms page at large) lands now. Never throws. */
export async function staffThreadPath(ref: ThreadRef = {}, deps: OldCommsDeps = {}): Promise<string> {
    const retired = await oldCommsRetired(deps);
    const contractor = retired && (ref.conversationId || ref.phone) ? await isContractorThread(ref, deps) : false;
    return staffThreadPathFrom(retired, { conversationId: ref.conversationId, contractor });
}
