/**
 * Handy Desk T1 - the "Needs you" queue: every held case file on the new desk as one flat list,
 * longest working-hours wait first. It is the board's held cards (board.ts `cardOf`) with the two
 * things a queue card needs that a board card does not carry: the draft the desk held back, so the
 * card can offer "Send as is", and the hold's age on the office clock (server/working-hours.ts, the
 * same clock the old desk's `waitingWorkingHours` used), so the order and the badge agree.
 *
 * Read only. Every action a queue card takes goes through the board's own routes (routes.ts:
 * send-held-draft, answer, release), so the approver-slot check and the sender's refusals are the
 * same ones the board shows.
 */
import type { CaseFile } from '../desk/case-file';
import { workingHoursBetween } from '../../working-hours';
import type { ApproverAssignments } from './approvers';
import { cardOf, type BoardCard, type BoardMode } from './board';

export interface QueueItem extends BoardCard {
    /** The reply the desk held back, exactly as it stands; null when the hold carries none. */
    draft: string | null;
    /** Office working hours (Mon-Fri 08-18 Europe/London) since the hold was raised, to one decimal. */
    waitingWorkingHours: number;
}

export interface DeskQueue {
    items: QueueItem[];
}

export function queueOf(files: CaseFile[], filter: { mode?: BoardMode } = {}, assignments: ApproverAssignments = {}, now: Date = new Date()): DeskQueue {
    const items: QueueItem[] = [];
    for (const file of files) {
        if (!file.hold) continue;
        const card = cardOf(file, assignments);
        if (filter.mode && card.mode !== filter.mode) continue;
        items.push({
            ...card,
            draft: file.hold.draft,
            waitingWorkingHours: workingHoursBetween(new Date(file.hold.since), now),
        });
    }
    // Longest working-hours wait first; two equal waits (both raised out of hours) fall back to the older hold.
    items.sort((a, b) => b.waitingWorkingHours - a.waitingWorkingHours || Date.parse(a.holdSince!) - Date.parse(b.holdSince!));
    return { items };
}
