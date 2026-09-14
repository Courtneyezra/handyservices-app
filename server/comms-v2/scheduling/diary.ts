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
 * The database reader opens the database on first use through server/db.ts, which reads
 * DATABASE_URL. The sandbox's reader (`liveDiary`) reads the Neon branch and nothing else, so every
 * read refuses unless COMMS_V2_DATABASE_URL names the database actually open (the door host puts it
 * there, door-host.ts); mounted on the production server it refuses rather than read a real diary.
 * The live intake's reader reads the database in use only while the new desk is the live desk
 * (live-database.ts). A memory reader stands in for tests; nothing here prints a value.
 */
import { COMMS_V2_DATABASE_ENV, resolveCommsV2Database } from '../desk/door-host';
import { assertCommsV2DatabaseFor, type DatabasePurpose } from '../live-database';
import { canonical, type CanonicalKey } from '../desk/identity';
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
    /**
     * A quote reference on a case file is the quote's id when the scheduling fixture wrote it and
     * its short slug when Quoting drafted it (`quoting/quoting-tools.ts`), and both name the same
     * row: every read here takes either.
     */
    /** The booking row by its reference, or nothing. */
    booking(bookingRef: string): Promise<DiaryBooking | null>;
    /** The newest booking made from a quote that still stands on `today` (an ISO day), else the newest that does not, or nothing. */
    bookingForQuote(quoteRef: string, today: string): Promise<DiaryBooking | null>;
    /** The quote row by its reference, or nothing. */
    quote(quoteRef: string): Promise<DiaryQuote | null>;
    /**
     * The bookings made under a customer's own phone numbers and email addresses, as canonical keys
     * (desk/identity.ts), that the customer may still be expecting on `today` (`stillExpected`), newest
     * first. A booking matches on its own contact, or on the contact of the quote it was made from.
     */
    bookingsForContact(keys: CanonicalKey[], today: string): Promise<DiaryBooking[]>;
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
    // The reason is read out to the composer, so it names no count: how many jobs the business has finished is its own business, and `sample` carries it for the desk.
    if (leads.length < MIN_COMPLETED_BOOKINGS) return { ok: false, reason: 'too few completed bookings to say', sample: leads.length };
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
 * Why a booking is not one the customer is still waiting for on `today`, or null when it stands.
 * The readers and the tools share this one definition, so a finished job can never come back as
 * the standing booking. Two kinds, because they are not the same thing to the customer: a booking
 * `cancelled` off them is a visit they may still be expecting, and only Ben can put that right;
 * one that is `done` is a job that happened, so asking about it is a new job rather than a move.
 */
export function notStandingReason(b: DiaryBooking, today: string): { kind: 'cancelled' | 'done'; reason: string } | null {
    if (b.status === 'declined') return { kind: 'cancelled', reason: 'the booking is declined; nothing stands in the diary' };
    if (b.status === 'cancelled' || b.dayOfStatus === 'cancelled_day_of') return { kind: 'cancelled', reason: 'the booking is cancelled; nothing stands in the diary' };
    if (b.status === 'completed' || b.dayOfStatus === 'completed') return { kind: 'done', reason: 'the booking is done; that visit has happened' };
    const last = lastBookedDay(b);
    return last && last < today ? { kind: 'done', reason: 'the booked date has passed' } : null;
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

/**
 * The booking a quote is answered by, from its bookings newest first: the newest that stands, else
 * the newest that does not. A cancelled visit the customer may still be expecting has to come back
 * for the tool to classify, or it reads as a quote nobody ever booked from.
 */
export function newestFromQuote(newestFirst: DiaryBooking[], today: string): DiaryBooking | null {
    return newestFirst.find((b) => !notStandingReason(b, today)) ?? newestFirst[0] ?? null;
}

/**
 * Whether a booking is one its customer may still be expecting on `today`: one that stands, whether or
 * not a contractor has taken it on, or one cancelled off them whose day has not come yet. A job done or
 * past is a new job's business rather than a change, and a cancelled booking with no day, or a day gone,
 * is not a visit anybody is waiting in for.
 */
export function stillExpected(b: DiaryBooking, today: string): boolean {
    const gone = notStandingReason(b, today);
    if (!gone) return true;
    if (gone.kind === 'done') return false;
    const last = lastBookedDay(b);
    return !!last && last >= today;
}

/** At most this many bookings are read for one customer's contact. */
export const CONTACT_BOOKINGS_LIMIT = 50;
/** A booking whose first day is further back than this cannot still be running, whatever its span. */
export const CONTACT_SPAN_MARGIN_DAYS = 60;

/**
 * The spellings a contact's phone and email are stored under, for a database match: every digit form a
 * UK number is written in (national, with 44, with 0044, without the leading 0), and the lowercase email.
 */
export function contactMatchValues(keys: CanonicalKey[]): { phones: string[]; emails: string[] } {
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const key of keys) {
        if (key.startsWith('email:')) { emails.add(key.slice('email:'.length)); continue; }
        const digits = key.slice('phone:'.length);
        phones.add(digits);
        const national = digits.startsWith('0') ? digits.slice(1) : digits.length === 10 ? digits : null;
        if (national) for (const v of [`0${national}`, `44${national}`, `0044${national}`, national]) phones.add(v);
    }
    return { phones: Array.from(phones), emails: Array.from(emails) };
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
        const id = (await this.quote(quoteRef))?.id ?? quoteRef;
        const mine = this.bookings.filter((b) => b.quoteRef === id);
        mine.sort((a, b) => Date.parse(b.createdAt ?? '0') - Date.parse(a.createdAt ?? '0'));
        return newestFromQuote(mine, today);
    }
    /** A quote store may stand behind the seeded rows: live there is one quotes table, so a quote Quoting drafted is one this diary reads back. */
    quoteFallback: ((quoteRef: string) => Promise<DiaryQuote | null>) | null = null;
    async quote(quoteRef: string): Promise<DiaryQuote | null> {
        return this.quotes.find((q) => q.id === quoteRef || q.slug === quoteRef) ?? (this.quoteFallback ? await this.quoteFallback(quoteRef) : null);
    }
    /** The phone and email a booking or a quote row carries, by its id: live they are columns on the row, which DiaryBooking does not carry. */
    readonly contacts: { ref: string; phone: string | null; email: string | null }[] = [];
    async bookingsForContact(keys: CanonicalKey[], today: string): Promise<DiaryBooking[]> {
        const wanted = new Set(keys);
        const matches = (ref: string | null) => !!ref && this.contacts.some((c) => c.ref === ref && [c.phone, c.email].some((v) => { const k = canonical(v); return !!k && wanted.has(k); }));
        return this.bookings
            .filter((b) => (matches(b.id) || matches(b.quoteRef)) && stillExpected(b, today))
            .sort((a, b) => Date.parse(b.createdAt ?? '0') - Date.parse(a.createdAt ?? '0'))
            .slice(0, CONTACT_BOOKINGS_LIMIT);
    }
}

/** The one database the desk may touch before the cutover: the branch COMMS_V2_DATABASE_URL names, and only while it is the one open. Reads and the fixture's writes both go through it. */
export function branchInUse(): void {
    const db = resolveCommsV2Database();
    if (!db.ok) throw new Error(db.message);
    if (process.env.DATABASE_URL !== db.url) throw new Error(`${COMMS_V2_DATABASE_ENV} is not the database in use. The desk touches only the Neon branch it names, never the database this process is open on.`);
}

/** The sandbox asks the branch check above; the live intake asks whether the new desk is the live desk (live-database.ts). */
async function diaryDatabase(purpose: DatabasePurpose): Promise<void> {
    if (purpose === 'sandbox') branchInUse();
    else await assertCommsV2DatabaseFor('the Scheduling diary', purpose);
}

/** The diary through the database, opened on first use, for a purpose. Every call is a read, and every call asks again. */
export const databaseDiary = (purpose: DatabasePurpose): DiaryReader => ({
    async completedBookings({ since, limit }) {
        await diaryDatabase(purpose);
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
        await diaryDatabase(purpose);
        const { db } = await import('../../db');
        const { contractorBookingRequests: t } = await import('../../../shared/schema');
        const { eq } = await import('drizzle-orm');
        const rows = await db.select({ id: t.id, quoteId: t.quoteId, scheduledDate: t.scheduledDate, scheduledDates: t.scheduledDates, durationDays: t.durationDays, status: t.status, assignmentStatus: t.assignmentStatus, dayOfStatus: t.dayOfStatus, createdAt: t.createdAt, completedAt: t.completedAt })
            .from(t).where(eq(t.id, bookingRef)).limit(1);
        return rows[0] ? bookingRowToDiary(rows[0]) : null;
    },
    async bookingForQuote(quoteRef, today) {
        await diaryDatabase(purpose);
        const { db } = await import('../../db');
        const { contractorBookingRequests: t } = await import('../../../shared/schema');
        const { desc, eq } = await import('drizzle-orm');
        // A booking row carries the quote's id, so a file naming its slug is resolved to one first.
        const id = (await databaseDiary(purpose).quote(quoteRef))?.id ?? quoteRef;
        const rows = await db.select({ id: t.id, quoteId: t.quoteId, scheduledDate: t.scheduledDate, scheduledDates: t.scheduledDates, durationDays: t.durationDays, status: t.status, assignmentStatus: t.assignmentStatus, dayOfStatus: t.dayOfStatus, createdAt: t.createdAt, completedAt: t.completedAt })
            .from(t).where(eq(t.quoteId, id)).orderBy(desc(t.createdAt)).limit(10);
        return newestFromQuote(rows.map(bookingRowToDiary), today);
    },
    async quote(quoteRef) {
        await diaryDatabase(purpose);
        const { db } = await import('../../db');
        const { personalizedQuotes: q } = await import('../../../shared/schema');
        const { eq, or } = await import('drizzle-orm');
        const rows = await db.select({ id: q.id, slug: q.shortSlug, isDraft: q.isDraft, supersededAt: q.supersededAt, revokedAt: q.revokedAt, expiresAt: q.expiresAt })
            .from(q).where(or(eq(q.id, quoteRef), eq(q.shortSlug, quoteRef))).limit(1);
        const r = rows[0];
        if (!r) return null;
        const iso = (v: Date | string | null | undefined): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
        return { id: r.id, slug: r.slug, isDraft: r.isDraft !== false, supersededAt: iso(r.supersededAt), revokedAt: iso(r.revokedAt), expiresAt: iso(r.expiresAt) };
    },
    async bookingsForContact(keys, today) {
        await diaryDatabase(purpose);
        const { phones, emails } = contactMatchValues(keys);
        if (!phones.length && !emails.length) return [];
        const { db } = await import('../../db');
        const { contractorBookingRequests: t, personalizedQuotes: q } = await import('../../../shared/schema');
        const { and, desc, eq, gte, inArray, isNull, ne, or, sql } = await import('drizzle-orm');
        // A phone is stored however it was typed, so both sides are compared as bare digits; an email in lowercase.
        const matches = (phone: typeof t.customerPhone | typeof q.phone, email: typeof t.customerEmail | typeof q.email) => or(
            ...(phones.length ? [inArray(sql`regexp_replace(coalesce(${phone}, ''), '[^0-9]', '', 'g')`, phones)] : []),
            ...(emails.length ? [inArray(sql`lower(trim(coalesce(${email}, '')))`, emails)] : []),
        );
        const since = new Date(Date.parse(`${today}T00:00:00.000Z`) - CONTACT_SPAN_MARGIN_DAYS * DAY_MS);
        const rows = await db.select({ id: t.id, quoteId: t.quoteId, scheduledDate: t.scheduledDate, scheduledDates: t.scheduledDates, durationDays: t.durationDays, status: t.status, assignmentStatus: t.assignmentStatus, dayOfStatus: t.dayOfStatus, createdAt: t.createdAt, completedAt: t.completedAt })
            .from(t).leftJoin(q, eq(q.id, t.quoteId))
            .where(and(
                or(matches(t.customerPhone, t.customerEmail), matches(q.phone, q.email)),
                ne(t.status, 'completed'),
                or(isNull(t.dayOfStatus), ne(t.dayOfStatus, 'completed')),
                or(isNull(t.scheduledDate), gte(t.scheduledDate, since)),
            ))
            .orderBy(desc(t.createdAt)).limit(CONTACT_BOOKINGS_LIMIT);
        return rows.map(bookingRowToDiary).filter((b) => stillExpected(b, today));
    },
});

/** The sandbox door's diary: every read refuses anything but the branch COMMS_V2_DATABASE_URL names. */
export const liveDiary: DiaryReader = databaseDiary('sandbox');
