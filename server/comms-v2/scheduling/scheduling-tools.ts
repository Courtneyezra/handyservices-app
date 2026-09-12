/**
 * The Scheduling tool server (Goal 5). The specialist's shelf, on the Scoping pattern
 * (contracts.md, Contract 6): every call is read-only against the world and writes only to the
 * case file through its calls. It confirms and estimates; it never offers a slot and never books.
 *
 *   typical_lead_time   the median days from booking to visit over recent completed bookings in
 *                       the diary (diary.ts); returns nothing below the minimum sample, and the
 *                       specialist then proposes "dates come with your quote".
 *   confirm_booked_date the one authoritative booked date for the file's job, from the booking
 *                       the file references, else the live booking made from its quote. The diary
 *                       is the only source: the five quote-side date columns on the quote are
 *                       preferences, never bookings, and are never read. Refuses a cancelled or
 *                       declined booking, a booking with no date, and a booking no contractor has
 *                       taken on, whose date nobody has agreed to work. A cancelled or declined
 *                       booking is still something the customer thinks they have, so a request to
 *                       move it reaches Ben; a finished one is a new job, not a change.
 *   picker_link         the quote's picker, for a quote that has been sent: refuses no quote on
 *                       the file, a draft, a superseded, revoked or expired quote.
 *   date_change         the deterministic belt under the model: a request to move a booked job
 *                       is a hold for Ben whatever the router or the specialist read.
 *
 * Every date fact these return carries a diary source (`{ kind: 'diary', rowId }`), which the
 * date guard (desk/guards.ts checkDate) already recognises; nothing in the guard changes.
 */
import { getBaseUrlFromEnv } from '../../url-utils';
import type { CaseFile } from '../desk/case-file';
import { formatDiaryDate, isoDayOf, LEAD_TIME_SAMPLE_LIMIT, LEAD_TIME_WINDOW_DAYS, notStandingReason, typicalLeadTimeOf, unacceptedReason, type DiaryBooking, type DiaryReader, type LeadTime } from './diary';

// ---------------------------------------------------------------- the deps every tool reads

export interface SchedulingDeps {
    diary?: DiaryReader;
    /** The door's fixture can tell the diary to hold no completed bookings, so the "dates come with your quote" path is drivable live. Visible in every result. */
    diaryMode?: { completed: 'diary' | 'none' };
    /** The origin the picker link is built on; defaults to BASE_URL, else the production domain (server/url-utils.ts). */
    baseUrl?: string;
    now?: () => Date;
}

// ---------------------------------------------------------------- typical_lead_time

export type LeadTimeResult = LeadTime & { mode: 'diary' | 'none'; detail?: string | null };

/** Over recent completed bookings; nothing below the minimum sample, nothing when the fixture emptied the diary. Never a guess. */
export async function typicalLeadTime(deps: SchedulingDeps = {}): Promise<LeadTimeResult> {
    const mode = deps.diaryMode?.completed ?? 'diary';
    if (mode === 'none') return { ok: false, reason: 'the diary holds no completed bookings', sample: 0, mode };
    if (!deps.diary) return { ok: false, reason: 'no diary to read', sample: 0, mode };
    const now = deps.now ?? (() => new Date());
    const since = new Date(now().getTime() - LEAD_TIME_WINDOW_DAYS * 86_400_000);
    let rows: DiaryBooking[];
    try {
        rows = await deps.diary.completedBookings({ since, limit: LEAD_TIME_SAMPLE_LIMIT });
    } catch (err: any) {
        return { ok: false, reason: 'the diary could not be read', detail: String(err?.message ?? err), sample: 0, mode };
    }
    return { ...typicalLeadTimeOf(rows), mode };
}

// ---------------------------------------------------------------- confirm_booked_date

/**
 * The booked date, or why there is none and what the customer still has. `state` is the one
 * reading of the file's booking the desk works from, so the confirmation and the date-change belt
 * can never disagree: `none` is nothing to move, and every other state is something the customer
 * has, so a request to move it goes to Ben. `unknown` is the fail-closed answer, `unaccepted` a
 * booking sitting in the dispatch pool nobody has taken on, `cancelled` one taken off them, which
 * they may still be expecting. `none` is the diary never having had a booking to move, and a job
 * that is done or past, which is a new job rather than a change. `reason` is said to the composer,
 * so it is always a stable category; `detail` carries the machine text for the log and the run
 * summary, and never reaches a prompt.
 */
export type BookedDate =
    | { ok: true; state: 'standing'; bookingRef: string; date: string; words: string; rowId: string }
    | { ok: false; state: 'unaccepted' | 'cancelled' | 'none' | 'unknown'; reason: string; detail?: string | null; bookingRef: string | null };

/**
 * The one authoritative booked date for the file's job, and the one entry point to it. Reads the
 * booking the file references, else the booking made from its quote; the diary is the only source.
 * A declined, cancelled, done or past booking is not one the customer is waiting for, so a visit
 * that has happened is never confirmed as if it stands, and a booking no contractor has taken on
 * gives no date either: nobody has agreed to work that day. Every refusal gives no date at all.
 */
export async function confirmBookedDate(file: CaseFile, deps: SchedulingDeps = {}): Promise<BookedDate> {
    const ref = file.job.bookingRef;
    const today = isoDayOf((deps.now ?? (() => new Date()))());
    if (!deps.diary) return ref || file.stage === 'booked' ? { ok: false, state: 'unknown', reason: 'no diary to read', bookingRef: ref } : { ok: false, state: 'none', reason: 'nothing is booked on this file', bookingRef: null };
    let booking: DiaryBooking | null = null;
    try {
        if (ref) booking = await deps.diary.booking(ref);
        else if (file.job.quoteRef) booking = await deps.diary.bookingForQuote(file.job.quoteRef, today);
    } catch (err: any) {
        return { ok: false, state: 'unknown', reason: 'the diary could not be read', detail: String(err?.message ?? err), bookingRef: ref };
    }
    if (!booking) {
        if (ref) return { ok: false, state: 'unknown', reason: 'the booking the file references is not in the diary', bookingRef: ref };
        if (file.job.quoteRef) return { ok: false, state: 'none', reason: 'nothing is booked from this quote yet', bookingRef: null };
        return file.stage === 'booked' ? { ok: false, state: 'unknown', reason: 'the file is booked but references no booking or quote', bookingRef: null } : { ok: false, state: 'none', reason: 'nothing is booked on this file', bookingRef: null };
    }
    const gone = notStandingReason(booking, today);
    if (gone) return { ok: false, state: gone.kind === 'cancelled' ? 'cancelled' : 'none', reason: gone.reason, bookingRef: booking.id };
    const unaccepted = unacceptedReason(booking);
    if (unaccepted) return { ok: false, state: 'unaccepted', reason: unaccepted, bookingRef: booking.id };
    if (!booking.scheduledDate) return { ok: false, state: 'unknown', reason: 'the booking carries no date yet', bookingRef: booking.id };
    return { ok: true, state: 'standing', bookingRef: booking.id, date: booking.scheduledDate, words: formatDiaryDate(booking.scheduledDate), rowId: `booking:${booking.id}` };
}

// ---------------------------------------------------------------- picker_link

export type PickerLink =
    | { ok: true; quoteRef: string; slug: string; url: string }
    | { ok: false; reason: string; detail?: string | null; quoteRef: string | null };

function baseUrlOf(deps: SchedulingDeps): string {
    if (deps.baseUrl) return deps.baseUrl.replace(/\/$/, '');
    return getBaseUrlFromEnv();
}

/** The quote's picker, for a quote that has been sent. Booking stays there; the desk never books. */
export async function pickerLink(file: CaseFile, deps: SchedulingDeps = {}): Promise<PickerLink> {
    if (!file.job.quoteRef) return { ok: false, reason: 'no quote on the file yet; dates come with the quote', quoteRef: null };
    if (!deps.diary) return { ok: false, reason: 'no diary to read', quoteRef: file.job.quoteRef };
    let quote;
    try {
        quote = await deps.diary.quote(file.job.quoteRef);
    } catch (err: any) {
        return { ok: false, reason: 'the quote could not be read', detail: String(err?.message ?? err), quoteRef: file.job.quoteRef };
    }
    if (!quote) return { ok: false, reason: 'the quote the file references does not exist', quoteRef: file.job.quoteRef };
    if (quote.isDraft) return { ok: false, reason: 'the quote is a draft, not sent; dates come with the quote', quoteRef: quote.id };
    if (quote.supersededAt) return { ok: false, reason: 'the quote is superseded', quoteRef: quote.id };
    if (quote.revokedAt) return { ok: false, reason: 'the quote is revoked', quoteRef: quote.id };
    const now = deps.now ?? (() => new Date());
    if (quote.expiresAt && Date.parse(quote.expiresAt) < now().getTime()) return { ok: false, reason: 'the quote has expired', quoteRef: quote.id };
    return { ok: true, quoteRef: quote.id, slug: quote.slug, url: `${baseUrlOf(deps)}/quote/${quote.slug}` };
}

// ---------------------------------------------------------------- date_change, the belt

/** A request to move, change or push a date. Only `move` takes a bare it, that or this; every other verb needs a date, day, booking, appointment, visit, job or slot as its object. The belt under the router's date_change exception. */
export const RE_DATE_CHANGE = /\b(?:(?:move\s+(?:it|that|this)|(?:move|change|shift|push|swap|switch|bring|put)\s+(?:the (?:date|day|booking|appointment|visit|job|slot)|my (?:date|day|booking|appointment|visit|slot)))\b|(?:re-?schedule|re-?arrange|re-?book|postpone|push (?:it |that )?back|bring (?:it |that )?forward|different (?:day|date|time)|another (?:day|date|time)|a (?:later|earlier|different) (?:day|date|time|slot))\b|\b(?:can|could) (?:we|you|i) (?:do|make) (?:it|that) (?:a )?(?:different|another|later|earlier)\b)/i;

export function dateChangeMatch(text: string): string | null {
    const m = RE_DATE_CHANGE.exec(text);
    return m ? m[0] : null;
}

/** A question about dates or timing, so the scheduling specialist runs even when the router missed the subject. */
export const RE_DATE_QUESTION = /\b(?:when (?:can|could|will|would|are|do|is|were) (?:you|ben|someone|we|it|the)|how (?:soon|quickly)|how long (?:until|before)|what (?:dates?|days?)|which (?:dates?|days?)|any (?:dates?|days?|availability|slots?)|lead[- ]?time|what (?:day|date) (?:is|are|was|were))\b/i;

/** Only a question counts: a question mark, or an opening question word. A statement about their own availability is scoping. */
export function dateQuestionMatch(text: string): string | null {
    if (!/\?/.test(text) && !/^\s*(?:when|how soon|what dates?|which dates?)\b/i.test(text)) return null;
    const m = RE_DATE_QUESTION.exec(text);
    return m ? m[0] : null;
}
