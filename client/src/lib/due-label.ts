/**
 * "due in 2h" / "overdue by 40m" for the due_at column Phase 1 / B adds to drafts and flags.
 * Null when there is no due time — callers render nothing, so a payload without the column
 * (this branch before merge) looks exactly as it did.
 */
export function dueLabel(dueAt: string | null | undefined, now: number = Date.now()): { text: string; overdue: boolean } | null {
    if (!dueAt) return null;
    const due = new Date(dueAt).getTime();
    if (!Number.isFinite(due)) return null;
    const diff = due - now;
    const span = fmtSpan(Math.abs(diff));
    return diff < 0
        ? { text: `overdue by ${span}`, overdue: true }
        : { text: `due in ${span}`, overdue: false };
}

function fmtSpan(ms: number): string {
    const m = Math.round(ms / 60_000);
    if (m < 1) return 'under a minute';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.round(h / 24)}d`;
}
