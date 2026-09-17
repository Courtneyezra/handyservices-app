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
import { ukParts, workingHoursBetween } from '../../working-hours';
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
    /** Turns answered today (since local midnight, Europe/London): one per outbound run, by the desk or a person. */
    handledToday: number;
}

function ukDay(d: Date): string {
    const p = ukParts(d);
    return `${p.year}-${p.month}-${p.day}`;
}

export function queueOf(files: CaseFile[], filter: { mode?: BoardMode } = {}, assignments: ApproverAssignments = {}, now: Date = new Date()): DeskQueue {
    const items: QueueItem[] = [];
    const today = ukDay(now);
    const handledRuns = new Set<string>();
    for (const file of files) {
        const card = cardOf(file, assignments);
        if (filter.mode && card.mode !== filter.mode) continue;
        for (const t of file.turns) {
            if (t.direction === 'outbound' && t.runId && ukDay(new Date(t.at)) === today) handledRuns.add(`${file.id}:${t.runId}`);
        }
        if (!file.hold) continue;
        items.push({
            ...card,
            draft: file.hold.draft,
            waitingWorkingHours: workingHoursBetween(new Date(file.hold.since), now),
        });
    }
    // Longest working-hours wait first; two equal waits (both raised out of hours) fall back to the older hold.
    items.sort((a, b) => b.waitingWorkingHours - a.waitingWorkingHours || Date.parse(a.holdSince!) - Date.parse(b.holdSince!));
    return { items, handledToday: handledRuns.size };
}
