/**
 * Ben's diary, read-only (Handy Desk B6; design export "Handy Diary.dc.html"): one read for every
 * contractor's weeks, and the Today strip over the same shape. Pure, so the whole mapping is tested
 * without a database; the rows come from reader.ts.
 *
 * A contractor's day is resolved the way their own week is (server/lib/contractor-week.ts
 * `resolveWeek`: a date override wins, else the weekly pattern, else off, and a booking occupies its
 * slot even on an off half), then shown as the export's cells, never hours: one Full cell for a
 * whole-day or multi-day job, one Off cell for a day with nothing offered and nothing booked, else an
 * AM and a PM cell, each booked, open or off. A multi-day booking is one row and fills every day of
 * its span (shared/schedule-composition.ts `expandSpanDates`), whole days each, as the contractor
 * hub reads it.
 *
 * A job chip carries its booking id, its quote id and the case file on the new desk whose job names
 * that quote (by id or short slug) or that booking, so a tap can open the thread; `held` is that
 * file's hold, shown in amber. Nothing here writes, and there is no pool, no "waiting for a seat"
 * and no nearest-open hint (captain's answer Q9).
 */
import { resolveWeek, type BookingRow, type DayAvailability, type SlotState } from '../../lib/contractor-week';
import { expandSpanDates } from '../../../shared/schedule-composition';
import type { SlotType } from '../../../shared/slot-times';
import type { CaseFile } from '../desk/case-file';

// ---------------------------------------------------------------- rows in

export interface DiaryContractorRow {
    id: string;
    name: string;
    trades: string[];
}

export interface DiaryPatternRow {
    contractorId: string;
    dayOfWeek: number;
    startTime: string | null;
    endTime: string | null;
    isActive: boolean;
}

export interface DiaryOverrideRow {
    contractorId: string;
    /** YYYY-MM-DD. */
    date: string;
    isAvailable: boolean;
    startTime: string | null;
    endTime: string | null;
}

export interface DiaryBookingRow {
    id: string;
    contractorId: string;
    quoteId: string | null;
    quoteSlug: string | null;
    customerName: string;
    description: string | null;
    /** YYYY-MM-DD of the first booked day. */
    scheduledDate: string | null;
    scheduledDates: unknown;
    durationDays: number | null;
    scheduledSlot: string | null;
    scheduledStartTime: string | null;
    status: string;
    assignmentStatus: string | null;
    dayOfStatus: string | null;
}

export interface DiaryItemRow {
    id: string;
    contractorId: string;
    /** YYYY-MM-DD. */
    date: string;
    slot: string;
    startTime: string | null;
    kind: string;
    customerName: string;
    status: string;
}

export interface DiaryRows {
    contractors: DiaryContractorRow[];
    patterns: DiaryPatternRow[];
    overrides: DiaryOverrideRow[];
    bookings: DiaryBookingRow[];
    items: DiaryItemRow[];
}

// ---------------------------------------------------------------- shape out

export type DiarySlot = 'am' | 'pm' | 'full';
/** What the contractor is offered for on a day, whatever is booked: AM, PM, Full or Off. */
export type DiaryOffered = 'am' | 'pm' | 'full' | 'off';

export interface DiaryJob {
    bookingId: string;
    quoteId: string | null;
    /** The newest case file on the new desk for this job, or null when none names it. */
    caseFileId: string | null;
    /** That case file is on hold for a person. */
    held: boolean;
    customerName: string;
    description: string | null;
    slot: DiarySlot;
    startTime: string | null;
    /** 1-based day of a multi-day span, and the span's length. */
    spanDay: number;
    spanDays: number;
    /** 'on_site' when the contractor has arrived or started, 'en_route' when on the way, else null. */
    onSite: 'on_site' | 'en_route' | null;
    /** The dispatch column, so an assigned-but-not-accepted job reads as such. */
    accepted: boolean;
}

export interface DiaryCell {
    slot: DiarySlot;
    state: SlotState;
    jobs: DiaryJob[];
}

export interface DiaryDay {
    date: string;
    offered: DiaryOffered;
    cells: DiaryCell[];
}

export interface DiaryLane {
    contractorId: string;
    name: string;
    initials: string;
    trades: string[];
    days: DiaryDay[];
}

export interface DiaryNotJob {
    id: string;
    date: string;
    contractorId: string;
    contractorName: string;
    slot: string;
    startTime: string | null;
    kind: string;
    label: string;
    done: boolean;
}

export interface DiaryWeek {
    /** The Monday the range starts on, and every day in it, Monday first. */
    start: string;
    dates: string[];
    today: string;
    lanes: DiaryLane[];
    notJobs: DiaryNotJob[];
    counts: { booked: number; open: number };
}

// ---------------------------------------------------------------- dates

const DAY_MS = 86_400_000;

export function addDays(iso: string, n: number): string {
    return new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, of a YYYY-MM-DD day. */
export function dayOfWeekOf(iso: string): number {
    return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

/** The Monday on or before a day. */
export function mondayOf(iso: string): string {
    return addDays(iso, -((dayOfWeekOf(iso) + 6) % 7));
}

/** Today's date in London, where the business keeps its diary. */
export function londonToday(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_WEEKS = 6;
/** A span starting further back than this cannot still be running in the range. */
export const SPAN_LOOKBACK_DAYS = 60;

// ---------------------------------------------------------------- the build

/** A booking a contractor has on their diary: assigned or taken on, and not cancelled or declined. The availability matrix's rule, less a cancellation on the day. */
export function onDiary(b: DiaryBookingRow): boolean {
    if (b.status === 'cancelled' || b.status === 'declined' || b.dayOfStatus === 'cancelled_day_of') return false;
    return ['assigned', 'accepted', 'in_progress', 'completed'].includes(b.assignmentStatus ?? '') || ['accepted', 'completed'].includes(b.status);
}

function isAccepted(b: DiaryBookingRow): boolean {
    return ['accepted', 'in_progress', 'completed'].includes(b.assignmentStatus ?? '') || ['accepted', 'in_progress', 'completed'].includes(b.status);
}

function slotOf(b: DiaryBookingRow, spanDays: number): DiarySlot {
    if (spanDays > 1) return 'full';
    if (b.scheduledSlot === 'am' || b.scheduledSlot === 'pm') return b.scheduledSlot;
    if (b.scheduledSlot === 'full_day') return 'full';
    if (b.scheduledStartTime) return b.scheduledStartTime >= '12:00' ? 'pm' : 'am';
    return 'full';
}

export function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** The newest case file whose job names this booking or its quote. */
export function caseFileFor(files: CaseFile[], b: { id: string; quoteId: string | null; quoteSlug: string | null }): CaseFile | null {
    const refs = new Set([b.quoteId, b.quoteSlug].filter((r): r is string => !!r));
    const mine = files.filter((f) => f.job?.bookingRef === b.id || (!!f.job?.quoteRef && refs.has(f.job.quoteRef)));
    mine.sort((x, y) => Date.parse(y.openedAt) - Date.parse(x.openedAt));
    return mine[0] ?? null;
}

const KIND_LABEL: Record<string, string> = { quote_visit: 'Quote visit' };

function notJobLabel(item: DiaryItemRow, contractor: string): string {
    const kind = KIND_LABEL[item.kind] ?? item.kind.replace(/_/g, ' ');
    const when = item.startTime ?? item.slot.toUpperCase();
    return `${kind} · ${item.customerName} · ${contractor} ${when}`;
}

function offeredOf(day: Pick<DayAvailability, 'am' | 'pm'>): DiaryOffered {
    const am = day.am !== 'off';
    const pm = day.pm !== 'off';
    return am && pm ? 'full' : am ? 'am' : pm ? 'pm' : 'off';
}

/**
 * Every contractor with something on the diary in the range (an active weekly pattern, an override,
 * a booking), as lanes of days of cells, plus the non-job row and the counts. `start` is snapped to
 * its Monday; `weeks` is clamped to 1..MAX_WEEKS.
 */
export function diaryWeekOf(rows: DiaryRows, files: CaseFile[], opts: { start: string; weeks: number; today: string }): DiaryWeek {
    const start = mondayOf(opts.start);
    const weeks = Math.min(Math.max(Math.trunc(opts.weeks) || 1, 1), MAX_WEEKS);
    const dates = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
    const inRange = new Set(dates);
    const weekDates = dates.map((date) => ({ date, dayOfWeek: dayOfWeekOf(date) }));

    const jobsByContractor = new Map<string, { date: string; job: DiaryJob }[]>();
    for (const b of rows.bookings) {
        if (!b.scheduledDate || !onDiary(b)) continue;
        const days = expandSpanDates(b.scheduledDate, b.durationDays, b.scheduledDates);
        const file = caseFileFor(files, b);
        const slot = slotOf(b, days.length);
        const onSite = b.dayOfStatus === 'arrived' || b.dayOfStatus === 'in_progress' ? 'on_site' : b.dayOfStatus === 'en_route' ? 'en_route' : null;
        days.forEach((date, i) => {
            if (!inRange.has(date)) return;
            const list = jobsByContractor.get(b.contractorId) ?? [];
            list.push({
                date,
                job: {
                    bookingId: b.id, quoteId: b.quoteId, caseFileId: file?.id ?? null, held: !!file?.hold,
                    customerName: b.customerName, description: b.description, slot, startTime: b.scheduledStartTime,
                    spanDay: i + 1, spanDays: days.length,
                    // Day-of status is the booking's, so it only speaks for the day it is about.
                    onSite: date === opts.today ? onSite : null,
                    accepted: isAccepted(b),
                },
            });
            jobsByContractor.set(b.contractorId, list);
        });
    }

    let booked = 0;
    let open = 0;
    const lanes: DiaryLane[] = [];
    for (const c of rows.contractors) {
        const patterns = rows.patterns.filter((p) => p.contractorId === c.id);
        const overrides = rows.overrides.filter((o) => o.contractorId === c.id && inRange.has(o.date));
        const jobs = jobsByContractor.get(c.id) ?? [];
        if (!patterns.some((p) => p.isActive) && !overrides.length && !jobs.length) continue;

        const resolve = (bookings: BookingRow[]) => resolveWeek({ weekDates, weeklyPatterns: patterns, overrides, bookings });
        const offeredDays = resolve([]);
        const bookedDays = resolve(jobs.map(({ date, job }) => ({ date, slot: (job.slot === 'full' ? 'full_day' : job.slot) as SlotType })));

        const days: DiaryDay[] = bookedDays.map((day, i) => {
            const dayJobs = jobs.filter((j) => j.date === day.date).map((j) => j.job);
            const whole = dayJobs.filter((j) => j.slot === 'full');
            const offered = offeredOf(offeredDays[i]);
            let cells: DiaryCell[];
            if (whole.length) {
                cells = [{ slot: 'full', state: 'booked', jobs: dayJobs }];
            } else if (day.am === 'off' && day.pm === 'off') {
                cells = [{ slot: 'full', state: 'off', jobs: [] }];
            } else {
                cells = (['am', 'pm'] as const).map((s) => ({ slot: s, state: day[s], jobs: dayJobs.filter((j) => j.slot === s) }));
            }
            for (const cell of cells) {
                if (cell.state === 'booked') booked += 1;
                if (cell.state === 'open') open += 1;
            }
            return { date: day.date, offered, cells };
        });
        lanes.push({ contractorId: c.id, name: c.name, initials: initialsOf(c.name), trades: c.trades, days });
    }
    lanes.sort((a, b) => a.name.localeCompare(b.name));

    const names = new Map(rows.contractors.map((c) => [c.id, c.name]));
    const notJobs: DiaryNotJob[] = rows.items
        .filter((it) => inRange.has(it.date))
        .map((it) => {
            const contractorName = names.get(it.contractorId) ?? 'Unknown';
            const first = contractorName.split(/\s+/)[0] ?? contractorName;
            return { id: it.id, date: it.date, contractorId: it.contractorId, contractorName, slot: it.slot, startTime: it.startTime, kind: it.kind, label: notJobLabel(it, first), done: it.status === 'done' };
        })
        .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? a.slot).localeCompare(b.startTime ?? b.slot));

    return { start, dates, today: opts.today, lanes, notJobs, counts: { booked, open } };
}

// ---------------------------------------------------------------- today

export interface TodayContractor {
    contractorId: string;
    name: string;
    initials: string;
    offered: DiaryOffered;
    jobs: DiaryJob[];
}

export interface DiaryToday {
    date: string;
    contractors: TodayContractor[];
}

/** The Today strip (G8): every lane's day for `today`, with who is offered, what is booked and who is on site. A contractor off with nothing booked is left out. */
export function diaryTodayOf(rows: DiaryRows, files: CaseFile[], today: string): DiaryToday {
    const week = diaryWeekOf(rows, files, { start: today, weeks: 1, today });
    const contractors = week.lanes.flatMap((lane) => {
        const day = lane.days.find((d) => d.date === today);
        if (!day) return [];
        const jobs = day.cells.flatMap((c) => c.jobs);
        if (day.offered === 'off' && !jobs.length) return [];
        return [{ contractorId: lane.contractorId, name: lane.name, initials: lane.initials, offered: day.offered, jobs }];
    });
    return { date: today, contractors };
}
