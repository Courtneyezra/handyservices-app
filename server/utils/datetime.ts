/**
 * Date/time formatting utilities.
 *
 * Consolidates duplicated time formatting logic from:
 * - server/leads.ts (formatTimeInStage)
 * - server/lead-tube-map.ts (formatTimeInStage)
 * - server/call-thread.ts (formatDuration)
 * - server/inbox-board.ts (hours calculations)
 */

/**
 * Format a duration in seconds as a human-readable string.
 *
 * Examples:
 *   18 -> "18s"
 *   72 -> "1m 12s"
 *   3661 -> "61m 1s"
 *
 * From server/call-thread.ts
 */
export function formatDuration(seconds: number | null | undefined): string {
    const s = Math.max(0, Math.round(seconds ?? 0));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Format a timestamp as relative time (e.g., "5m", "2h 30m", "3 days").
 *
 * Examples:
 *   (now - 30 seconds) -> "Just now"
 *   (now - 5 minutes) -> "5m"
 *   (now - 2.5 hours) -> "2h 30m"
 *   (now - 1 day) -> "1 day"
 *   (now - 5 days) -> "5 days"
 *
 * From server/leads.ts and server/lead-tube-map.ts (formatTimeInStage)
 */
export function relativeTime(date: Date | string | number | null | undefined): string {
    if (!date) return 'Unknown';

    const now = Date.now();
    const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (isNaN(timestamp)) return 'Unknown';

    const diffMs = now - timestamp;
    if (diffMs < 0) return 'Just now'; // Future dates

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return days === 1 ? '1 day' : `${days} days`;
    } else if (hours > 0) {
        const remainingMinutes = minutes % 60;
        if (remainingMinutes > 0) {
            return `${hours}h ${remainingMinutes}m`;
        }
        return `${hours}h`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    }
    return 'Just now';
}

/**
 * Calculate hours since a given timestamp.
 *
 * From server/inbox-board.ts
 */
export function hoursSince(date: Date | string | number | null | undefined): number | null {
    if (!date) return null;
    const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (isNaN(timestamp)) return null;
    return Math.floor((Date.now() - timestamp) / 3600_000);
}

/**
 * Calculate milliseconds remaining until a given timestamp.
 * Returns 0 if the timestamp is in the past.
 */
export function msRemaining(expiresAt: Date | string | number | null | undefined): number {
    if (!expiresAt) return 0;
    const timestamp = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
    if (isNaN(timestamp)) return 0;
    return Math.max(0, timestamp - Date.now());
}

/**
 * Calculate whole hours remaining until a given timestamp.
 * Returns 0 if the timestamp is in the past.
 */
export function hoursRemaining(expiresAt: Date | string | number | null | undefined): number {
    return Math.floor(msRemaining(expiresAt) / 3600_000);
}
