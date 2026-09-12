/**
 * Return to automation (checklist 7.4): a thread comes back to automation when any human replies,
 * from any surface. There is one path for a human's reply, desk/human-reply.ts: the words go out
 * through the desk's one sender under a `human:<person>` approver, the ask ledger records what they
 * asked, and the hold is released with those words. Ben's board and the sandbox door's "Ben replies"
 * both call it. The kanban (Goal 2) can also release a hold directly (api/routes.ts): a board
 * release is Ben's words to the desk, not words to the customer, so it lands no outbound turn.
 * This module only reads where the thread is.
 */
import type { CaseFile } from '../desk/case-file';

/** Where the thread is, for a board or the door's state. */
export function automationState(file: CaseFile): { state: 'automated' | 'with_approver'; approver: string | null; reason: string | null; since: string | null; releases: number } {
    if (!file.hold) return { state: 'automated', approver: null, reason: null, since: null, releases: file.releases.length };
    return { state: 'with_approver', approver: file.hold.approver.kind === 'human' ? file.hold.approver.id : `rules:${file.hold.approver.id}`, reason: file.hold.reason, since: file.hold.since, releases: file.releases.length };
}
