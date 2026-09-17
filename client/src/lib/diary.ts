/**
 * Ben's diary (B6) on the client: the shapes GET /api/comms-v2/diary/week and /today return
 * (server/comms-v2/diary/week.ts), and the pure mapping from them to what the page and the Today
 * strip show - range labels, cell copy, month bars. Read-only: nothing here writes.
 */
export type DiarySlot = 'am' | 'pm' | 'full';
export type DiaryOffered = 'am' | 'pm' | 'full' | 'off';
export type SlotState = 'off' | 'open' | 'booked';

export interface DiaryJob {
    bookingId: string;
    quoteId: string | null;
    caseFileId: string | null;
    held: boolean;
    customerName: string;
    description: string | null;
    slot: DiarySlot;
    startTime: string | null;
    spanDay: number;
    spanDays: number;
    onSite: 'on_site' | 'en_route' | null;
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
    start: string;
    dates: string[];
    today: string;
    lanes: DiaryLane[];
    notJobs: DiaryNotJob[];
}

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

export type DiaryView = 'week' | 'month';

export const DIARY_PATH = '/admin/diary';
export const BOARD_PATH = '/admin/comms-v2';

// ---------------------------------------------------------------- dates

const DAY_MS = 86_400_000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parts = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });

export function addDays(iso: string, n: number): string {
    return new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function dayOfWeekOf(iso: string): number {
    return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

export function mondayOf(iso: string): string {
    return addDays(iso, -((dayOfWeekOf(iso) + 6) % 7));
}

export function isWeekend(iso: string): boolean {
    const d = dayOfWeekOf(iso);
    return d === 0 || d === 6;
}

/** "Tue" */
export function dowOf(iso: string): string {
    return DOW[dayOfWeekOf(iso)];
}

/** "Tue 22 Sep" */
export function shortDate(iso: string): string {
    const { m, d } = parts(iso);
    return `${dowOf(iso)} ${d} ${MONTH[m - 1]}`;
}

export function dayNumber(iso: string): number {
    return parts(iso).d;
}

/** Today in London, the business's diary day. */
export function londonToday(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The first of the month a day falls in. */
export function monthOf(iso: string): string {
    return `${iso.slice(0, 7)}-01`;
}

export function addMonths(firstOfMonth: string, n: number): string {
    const { y, m } = parts(firstOfMonth);
    const idx = y * 12 + (m - 1) + n;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/** The Monday a month's grid starts on: the week of the 1st, or the week after when the 1st is a weekend. */
export function monthStart(firstOfMonth: string): string {
    const monday = mondayOf(firstOfMonth);
    return isWeekend(firstOfMonth) ? addDays(monday, 7) : monday;
}

/** How many Monday-first weeks a month's weekdays span (4 to 5). */
export function weeksInMonth(firstOfMonth: string): number {
    const start = monthStart(firstOfMonth);
    const nextMonth = addMonths(firstOfMonth, 1);
    const days = (Date.parse(`${nextMonth}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS;
    return Math.ceil(days / 7);
}

/** "21–25 Sep 2026", or across a month "28 Sep – 2 Oct 2026", for the Monday-to-Friday of a week. */
export function weekLabel(monday: string): string {
    const friday = addDays(monday, 4);
    const a = parts(monday);
    const b = parts(friday);
    if (a.m === b.m) return `${a.d}–${b.d} ${MONTH[b.m - 1]} ${b.y}`;
    if (a.y === b.y) return `${a.d} ${MONTH[a.m - 1]} – ${b.d} ${MONTH[b.m - 1]} ${b.y}`;
    return `${a.d} ${MONTH[a.m - 1]} ${a.y} – ${b.d} ${MONTH[b.m - 1]} ${b.y}`;
}

/** "September 2026" */
export function monthLabel(firstOfMonth: string): string {
    const { y, m } = parts(firstOfMonth);
    return `${MONTH_LONG[m - 1]} ${y}`;
}

export function weekQuery(start: string, weeks = 1): string {
    return `/api/comms-v2/diary/week?start=${encodeURIComponent(start)}&weeks=${weeks}`;
}

export const TODAY_QUERY = '/api/comms-v2/diary/today';

/** Where "Open thread" goes: the comms board, with the case file open. */
export function threadPath(caseFileId: string): string {
    return `${BOARD_PATH}?file=${encodeURIComponent(caseFileId)}`;
}

// ---------------------------------------------------------------- the week

/** The days a week view shows: Monday to Friday, plus a weekend day only when someone has a job on it. */
export function visibleDates(week: Pick<DiaryWeek, 'dates' | 'lanes'>): string[] {
    return week.dates.filter((date) => !isWeekend(date) || week.lanes.some((l) => l.days.some((d) => d.date === date && d.cells.some((c) => c.jobs.length > 0))));
}

/** The days a month view shows: every weekday of the range, whatever is on it. */
export function weekdayDates(week: Pick<DiaryWeek, 'dates'>): string[] {
    return week.dates.filter((date) => !isWeekend(date));
}

export const SLOT_LABEL: Record<DiarySlot, string> = { am: 'AM', pm: 'PM', full: 'Full' };
export const OFFERED_LABEL: Record<DiaryOffered, string> = { am: 'AM', pm: 'PM', full: 'Full', off: 'Off' };

export type CellKind = 'booked' | 'held' | 'open' | 'off';

export interface CellCopy {
    kind: CellKind;
    slot: string;
    tag: string;
    label: string;
    sub: string;
}

function jobSub(job: DiaryJob): string {
    const bits = [job.description?.trim() || null, job.spanDays > 1 ? `day ${job.spanDay}/${job.spanDays}` : null].filter(Boolean);
    return bits.join(' · ');
}

/** What a cell says. A cell whose job is held on the desk is amber. */
export function cellCopy(cell: DiaryCell): CellCopy {
    const slot = cell.state === 'off' && cell.slot === 'full' ? 'Off' : SLOT_LABEL[cell.slot];
    if (cell.state === 'booked') {
        const [first, ...rest] = cell.jobs;
        const held = cell.jobs.some((j) => j.held);
        const tag = held ? 'held' : first?.onSite === 'on_site' ? 'on site' : first?.onSite === 'en_route' ? 'on the way' : first && !first.accepted ? 'not accepted' : '';
        return {
            kind: held ? 'held' : 'booked',
            slot,
            tag,
            label: first ? first.customerName + (rest.length ? ` +${rest.length}` : '') : 'Booked',
            sub: first ? jobSub(first) : '',
        };
    }
    if (cell.state === 'open') return { kind: 'open', slot, tag: '', label: 'Open', sub: '' };
    return { kind: 'off', slot, tag: '', label: 'Off', sub: '' };
}

// ---------------------------------------------------------------- the month

export type BarKind = 'booked' | 'open' | 'off';

export interface MonthDay {
    date: string;
    inMonth: boolean;
    bars: BarKind[];
    booked: number;
    total: number;
    note: string;
}

/** One bar per contractor half-day on a day, booked first: a Full cell is two halves. The diary's one unit. */
export function halfDayBars(week: Pick<DiaryWeek, 'lanes'>, date: string): BarKind[] {
    const bars: BarKind[] = [];
    for (const lane of week.lanes) {
        const day = lane.days.find((d) => d.date === date);
        if (!day) continue;
        for (const cell of day.cells) for (let i = 0; i < (cell.slot === 'full' ? 2 : 1); i += 1) bars.push(cell.state);
    }
    const order: Record<BarKind, number> = { booked: 0, open: 1, off: 2 };
    return bars.sort((a, b) => order[a] - order[b]);
}

/** One bar per contractor half-day, booked first; fill is booked over the half-days offered or booked. */
export function monthDays(week: DiaryWeek, firstOfMonth: string): MonthDay[] {
    const month = firstOfMonth.slice(0, 7);
    return weekdayDates(week).map((date) => {
        const bars = halfDayBars(week, date);
        const names: string[] = [];
        for (const lane of week.lanes) {
            const day = lane.days.find((d) => d.date === date);
            for (const cell of day?.cells ?? []) {
                if (cell.state === 'booked') for (const j of cell.jobs) if (j.spanDays > 1 && j.spanDay === 1) names.push(`${j.customerName} · ${j.spanDays}-day block`);
            }
        }
        const booked = bars.filter((b) => b === 'booked').length;
        const total = bars.filter((b) => b !== 'off').length;
        const note = names[0] ?? (total > 0 && booked === 0 ? 'Nothing booked' : '');
        return { date, inMonth: date.slice(0, 7) === month, bars, booked, total, note };
    });
}

// ---------------------------------------------------------------- the header's figures

/**
 * The header's figures, in contractor half-days - the unit the month's bars draw - over exactly the
 * days the view on screen shows, so a Saturday no view draws never counts.
 */
export function halfDayCounts(week: Pick<DiaryWeek, 'lanes'>, dates: string[]): { booked: number; open: number } {
    let booked = 0;
    let open = 0;
    for (const date of dates) {
        for (const bar of halfDayBars(week, date)) {
            if (bar === 'booked') booked += 1;
            else if (bar === 'open') open += 1;
        }
    }
    return { booked, open };
}

// ---------------------------------------------------------------- today

export interface TodayPill {
    key: string;
    label: string;
    tone: 'on_site' | 'held' | 'plain' | 'open';
}

/** The Today strip's pills for one contractor: one per job ("AM · J. Pike · on site", "Full · H. Bright · day 2/3"), else what they are offered for. */
export function todayPills(c: TodayContractor): TodayPill[] {
    if (!c.jobs.length) return [{ key: 'open', label: `${OFFERED_LABEL[c.offered]} · open`, tone: 'open' }];
    return c.jobs.map((j) => {
        const extra = j.onSite === 'on_site' ? 'on site' : j.onSite === 'en_route' ? 'on the way' : j.spanDays > 1 ? `day ${j.spanDay}/${j.spanDays}` : null;
        return {
            key: j.bookingId,
            label: [SLOT_LABEL[j.slot], j.customerName, extra].filter(Boolean).join(' · '),
            tone: j.held ? 'held' : j.onSite === 'on_site' ? 'on_site' : 'plain',
        };
    });
}
