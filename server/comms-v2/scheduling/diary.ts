/**
 * The diary read for the Scheduling specialist (Goal 5). Read-only against the world.
 *
 * The one authoritative booked date on the contractor side is `contractor_booking_requests.
 * scheduled_date` (with `scheduled_dates` for a multi-day span, read through shared/
 * schedule-composition.expandSpanDates). The five quote-side date columns on `personalized_quotes`
 * (selected_date, available_dates, date_time_preferences, flex_booking_within_days, slot_offer)
 * are preferences, never bookings, and are never read here.
 *
 * Lead time does not exist anywhere yet: it is a new computation over completed bookings, the
 * days between a booking being made and the visit it booked, taken as the median of the recent
 * completed ones. The read is allowed to return nothing: too few completed bookings and the
 * specialist says nothing about timing beyond "dates come with your quote".
 *
 * The live reader opens the database on first use through server/db.ts, which reads DATABASE_URL.
 * Before the cutover the desk reads the Neon branch and nothing else, so every live read refuses
 * unless COMMS_V2_DATABASE_URL names the database actually open (the door host puts it there,
 * door-host.ts). Mounted on the production server the reads therefore refuse rather than read a
 * real diary. A memory reader stands in for tests; nothing here prints a value.
 */
import { COMMS_V2_DATABASE_ENV, resolveCommsV2Database } from '../desk/door-host';
import { expandSpanDates } from '../../../shared/schedule-composition';

export interface DiaryBooking {
    id: string;
    quoteRef: string | null;
    /** ISO date, YYYY-MM-DD, of the first booked day; null when the row carries no date. */
    scheduledDate: string | null;
    /** The actual days the span occupies, through expandSpanDates. Empty when no date. */
    scheduledDays: string[];
    durationDays: number;
    /** 'pending' | 'accepted' | 'declined' | 'in_progress' | 'completed' | 'cancelled' */
    status: string;
    /** 'unassigned' | 'assigned' | 'accepted' | 'rejected' | 'in_progress' | 'completed'; the dispatch board's own column. */
    assignmentStatus: string | null;
    dayOfStatus: string | null;
    /** ISO timestamps. */
    createdAt: string | null;
    completedAt: string | null;
}

export interface DiaryQuote {
    id: string;
    slug: string;
    isDraft: boolean;
    supersededAt: string | null;
    revokedAt: string | null;
    expiresAt: string | null;
}

export interface DiaryReader {
    /** Completed bookings with a scheduled date, newest completion first, at most `limit`, completed on or after `since`. */
    completedBookings(opts: { since: Date; limit: number }): Promise<DiaryBooking[]>;
    /** The booking row by its reference, or nothing. */
    booking(bookingRef: string): Promise<DiaryBooking | null>;
    /** The newest booking made from a quote that still stands on `today` (an ISO day), or nothing. */
    bookingForQuote(quoteRef: string, today: string): Promise<DiaryBooking | null>;
    /** The quote row by its reference, or nothing. */
    quote(quoteRef: string): Promise<DiaryQuote | null>;
}

// ---------------------------------------------------------------- lead time, the computation

/** Fewer completed bookings than this and the diary says nothing about lead time. */
export const MIN_COMPLETED_BOOKINGS = 5;
/** Typical means recent: completed bookings from the last 180 days. */
export const LEAD_TIME_WINDOW_DAYS = 180;
export const LEAD_TIME_SAMPLE_LIMIT = 100;

const DAY_MS = 86_400_000;

/** Whole calendar days from the day a booking was made to its first booked day; null when either side is missing or the order is wrong. A same-day booking is 0, not a fraction of a day. */
export function leadDaysOf(b: DiaryBooking): number | null {
    if (!b.createdAt || !b.scheduledDate) return null;
    const made = Date.parse(b.createdAt);
    const visit = Date.parse(`${b.scheduledDate}T00:00:00.000Z`);
    if (!Number.isFinite(made) || !Number.isFinite(visit)) return null;
    const days = (visit - Math.floor(made / DAY_MS) * DAY_MS) / DAY_MS;
    if (days < 0) return null;
    return Math.round(days);
}

export function medianOf(values: number[]): number | null {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The phrase the composer copies verbatim. The date guard finds "3 days" or "2 weeks" inside it. */
export function leadTimePhrase(days: number): string {
    const d = Math.max(0, Math.round(days));
    if (d <= 1) return 'about a day';
    if (d < 14) return `about ${d} days`;
    return `about ${Math.round(d / 7)} weeks`;
}

export type LeadTime =
    | { ok: true; days: number; phrase: string; sample: number; rowId: string }
    | { ok: false; reason: string; sample: number };

/** The computation over completed bookings, pure. Returns nothing below the minimum sample. */
export function typicalLeadTimeOf(bookings: DiaryBooking[]): LeadTime {
    const leads = bookings.filter((b) => b.completedAt).map(leadDaysOf).filter((d): d is number => d !== null);
    if (leads.length < MIN_COMPLETED_BOOKINGS) return { ok: false, reason: `too few completed bookings to say: ${leads.length} of the ${MIN_COMPLETED_BOOKINGS} needed`, sample: leads.length };
    const median = medianOf(leads)!;
    return { ok: true, days: median, phrase: leadTimePhrase(median), sample: leads.length, rowId: `lead-time:completed-bookings:${leads.length}:${Math.round(median * 10)}` };
}

// ---------------------------------------------------------------- dates as the customer reads them

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "22 September 2026" from "2026-09-22". No weekday, so the date guard's first match is the date itself. */
export function formatDiaryDate(isoDate: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
    if (!m) return isoDate;
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** The last day a booking occupies, or null when it carries no date. */
export function lastBookedDay(b: DiaryBooking): string | null {
    return b.scheduledDays[b.scheduledDays.length - 1] ?? b.scheduledDate;
}

/**
 * Why a booking is not one the customer is still waiting for on `today`, or null when it stands:
 * declined, cancelled, done, or a visit that has already happened. The readers and the tools share
 * this one definition, so a finished job can never come back as the standing booking.
 */
export function notStandingReason(b: DiaryBooking, today: string): string | null {
    if (b.status === 'declined') return 'the booking is declined; nothing stands in the diary';
    if (b.status === 'cancelled' || b.dayOfStatus === 'cancelled_day_of') return 'the booking is cancelled; nothing stands in the diary';
    if (b.status === 'completed' || b.dayOfStatus === 'completed') return 'the booking is done; that visit has happened';
    const last = lastBookedDay(b);
    return last && last < today ? 'the booked date has passed' : null;
}

const TAKEN_STATUS = new Set(['accepted', 'in_progress']);
const TAKEN_ASSIGNMENT = new Set(['accepted', 'in_progress', 'completed']);

/**
 * Why no contractor has taken this booking on, or null when one has. A row sitting in the dispatch
 * pool (`status: 'pending'`, `assignment_status: 'unassigned'`) carries a date nobody has agreed to
 * work, so it is never a date to confirm to a customer: somebody would wait in for a visit no one
 * is making. Fail-closed, so 'assigned' but not yet accepted counts as not taken.
 */
export function unacceptedReason(b: DiaryBooking): string | null {
    return TAKEN_STATUS.has(b.status) || TAKEN_ASSIGNMENT.has(b.assignmentStatus ?? '') ? null : 'no contractor has taken the booking on yet, so there is no date to confirm';
}

/** The ISO day a date falls on, the form every diary date is compared in. */
export function isoDayOf(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** A row from the database into the diary's shape. */
export function bookingRowToDiary(row: { id: string; quoteId: string | null; scheduledDate: Date | string | null; scheduledDates: unknown; durationDays: number | null; status: string; assignmentStatus: string | null; dayOfStatus: string | null; createdAt: Date | string | null; completedAt: Date | string | null }): DiaryBooking {
    const iso = (v: Date | string | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
    const days = row.scheduledDate ? expandSpanDates(row.scheduledDate instanceof Date ? row.scheduledDate : String(row.scheduledDate), row.durationDays, row.scheduledDates) : [];
    return { id: row.id, quoteRef: row.quoteId, scheduledDate: days[0] ?? null, scheduledDays: days, durationDays: Math.max(1, row.durationDays ?? 1), status: row.status, assignmentStatus: row.assignmentStatus, dayOfStatus: row.dayOfStatus, createdAt: iso(row.createdAt), completedAt: iso(row.completedAt) };
}

// ---------------------------------------------------------------- readers

/** An in-memory diary for tests and for the door's memory fixture. */
export class MemoryDiary implements DiaryReader {
    readonly bookings: DiaryBooking[] = [];
    readonly quotes: DiaryQuote[] = [];
    async completedBookings({ since, limit }: { since: Date; limit: number }): Promise<DiaryBooking[]> {
        return this.bookings
            .filter((b) => b.completedAt && b.scheduledDate && Date.parse(b.completedAt) >= since.getTime())
            .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))
            .slice(0, limit);
    }
    async booking(bookingRef: string): Promise<DiaryBooking | null> { return this.bookings.find((b) => b.id === bookingRef) ?? null; }
    async bookingForQuote(quoteRef: string, today: string): Promise<DiaryBooking | null> {
        const live = this.bookings.filter((b) => b.quoteRef === quoteRef && !notStandingReason(b, today));
        live.sort((a, b) => Date.parse(b.createdAt ?? '0') - Date.parse(a.createdAt ?? '0'));
        return live[0] ?? null;
    }
    async quote(quoteRef: string): Promise<DiaryQuote | null> { return this.quotes.find((q) => q.id === quoteRef) ?? null; }
}

/** The one database the desk may touch before the cutover: the branch COMMS_V2_DATABASE_URL names, and only while it is the one open. Reads and the fixture's writes both go through it. */
export function branchInUse(): void {
    const db = resolveCommsV2Database();
    if (!db.ok) throw new Error(db.message);
    if (process.env.DATABASE_URL !== db.url) throw new Error(`${COMMS_V2_DATABASE_ENV} is not the database in use. The desk touches only the Neon branch it names, never the database this process is open on.`);
}

/** The branch database, opened on first use. Every call is a read, and every call refuses anything but the branch. */
export const liveDiary: DiaryReader = {
    async completedBookings({ since, limit }) {
        branchInUse();
        const { db } = await import('../../db');
        const { contractorBookingRequests: t } = await import('../../../shared/schema');
        const { and, desc, gte, isNotNull } = await import('drizzle-orm');
        const rows = await db.select({ id: t.id, quoteId: t.quoteId, scheduledDate: t.scheduledDate, scheduledDates: t.scheduledDates, durationDays: t.durationDays, status: t.status, assignmentStatus: t.assignmentStatus, dayOfStatus: t.dayOfStatus, createdAt: t.createdAt, completedAt: t.completedAt })
            .from(t)
            .where(and(isNotNull(t.completedAt), isNotNull(t.scheduledDate), gte(t.completedAt, since)))
            .orderBy(desc(t.completedAt))
            .limit(limit);
        return rows.map(bookingRowToDiary);
    },
    async booking(bookingRef) {
        branchInUse();
        const { db } = await import('../../db');
        const { contractorBookingRequests: t } = await import('../../../shared/schema');
        const { eq } = await import('drizzle-orm');
        const rows = await db.select({ id: t.id, quoteId: t.quoteId, scheduledDate: t.scheduledDate, scheduledDates: t.scheduledDates, durationDays: t.durationDays, status: t.status, assignmentStatus: t.assignmentStatus, dayOfStatus: t.dayOfStatus, createdAt: t.createdAt, completedAt: t.completedAt })
            .from(t).where(eq(t.id, bookingRef)).limit(1);
        return rows[0] ? bookingRowToDiary(rows[0]) : null;
    },
    async bookingForQuote(quoteRef, today) {
        branchInUse();
        const { db } = await import('../../db');
        const { contractorBookingRequests: t } = await import('../../../shared/schema');
        const { desc, eq } = await import('drizzle-orm');
        const rows = await db.select({ id: t.id, quoteId: t.quoteId, scheduledDate: t.scheduledDate, scheduledDates: t.scheduledDates, durationDays: t.durationDays, status: t.status, assignmentStatus: t.assignmentStatus, dayOfStatus: t.dayOfStatus, createdAt: t.createdAt, completedAt: t.completedAt })
            .from(t).where(eq(t.quoteId, quoteRef)).orderBy(desc(t.createdAt)).limit(10);
        return rows.map(bookingRowToDiary).find((b) => !notStandingReason(b, today)) ?? null;
    },
    async quote(quoteRef) {
        branchInUse();
        const { db } = await import('../../db');
        const { personalizedQuotes: q } = await import('../../../shared/schema');
        const { eq } = await import('drizzle-orm');
        const rows = await db.select({ id: q.id, slug: q.shortSlug, isDraft: q.isDraft, supersededAt: q.supersededAt, revokedAt: q.revokedAt, expiresAt: q.expiresAt })
            .from(q).where(eq(q.id, quoteRef)).limit(1);
        const r = rows[0];
        if (!r) return null;
        const iso = (v: Date | string | null | undefined): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
        return { id: r.id, slug: r.slug, isDraft: r.isDraft !== false, supersededAt: iso(r.supersededAt), revokedAt: iso(r.revokedAt), expiresAt: iso(r.expiresAt) };
    },
};
