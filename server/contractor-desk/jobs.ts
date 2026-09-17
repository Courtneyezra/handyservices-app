/**
 * Contractor desk jobs - pure shaping (DB-free, unit-tested) for
 * `GET /contractors/:id/jobs?view=upcoming|flex|past&weeksBack=`.
 *
 * "Accepted jobs" is every booking booked to the contractor, upcoming and past: the rows the
 * contractor app's own loaders (`server/contractor-jobs.ts`) count as his, owned by
 * `assignedContractorId ?? contractorId` and booked (status accepted or completed, or assignment
 * accepted, in progress or completed). The page also sees his paid flex jobs that have no day yet.
 *
 * Every output field is named here, one by one, like `roster.ts`. Money is read-only:
 * `customerValuePence` is the customer's job value and is sent to admins only (this router is
 * behind requireAdmin); `payoutPence` is his snapshotted pay for a booking and
 * `estimatedPayoutPence` his pay estimate for a flex job.
 */
import type { loadFlexQuotes, loadJobsAndGrid, loadPastWeekDetail, shapeFlexJobs } from '../contractor-jobs';
import { expandSpanDates } from '../../shared/schedule-composition';

export const JOB_VIEWS = ['upcoming', 'flex', 'past'] as const;
export type JobView = (typeof JOB_VIEWS)[number];

/** The admin page lists every upcoming job, not just the app's four-week window. */
export const UPCOMING_HORIZON_DAYS = 366;
export const MAX_WEEKS_BACK = 52;

type GridLoad = Awaited<ReturnType<typeof loadJobsAndGrid>>;
type PastLoad = Awaited<ReturnType<typeof loadPastWeekDetail>>;
type FlexRow = Awaited<ReturnType<typeof loadFlexQuotes>>[number];
type FlexJob = ReturnType<typeof shapeFlexJobs>[number];

export interface UpcomingLoad { jobs: GridLoad['bookedOut']; bookings: GridLoad['bookings'] }
export interface FlexLoad { jobs: FlexJob[]; quotes: FlexRow[] }
export type { PastLoad };

export interface JobsProfile { id: string; deliveryTier: string | null }

export interface JobsSource {
  profile(id: string): Promise<JobsProfile | null>;
  upcoming(profile: JobsProfile): Promise<UpcomingLoad>;
  flex(profile: JobsProfile): Promise<FlexLoad>;
  past(profile: JobsProfile, weeksBack: number): Promise<PastLoad>;
}

type PayLine = NonNullable<GridLoad['bookedOut'][number]['payLines']>[number];

export interface DeskPayLine {
  category: string;
  description: string | null;
  tier: string;
  labourPence: number;
  materialsPence: number;
  payPence: number;
  method: string;
}

const payLines = (lines: PayLine[] | null | undefined): DeskPayLine[] | null =>
  lines
    ? lines.map((l) => ({
        category: l.category, description: l.description, tier: l.tier, labourPence: l.labourPence,
        materialsPence: l.materialsPence, payPence: l.payPence, method: l.method,
      }))
    : null;

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

type BookingRow = { id: string; scheduledDate: Date | string | null; durationDays: number | null; scheduledDates: unknown; slot: string | null; status: string | null; assignmentStatus: string | null };
const spanOf = (b: BookingRow): string[] => (b.scheduledDate ? expandSpanDates(b.scheduledDate as any, b.durationDays ?? 1, b.scheduledDates) : []);

export function shapeUpcoming(load: UpcomingLoad) {
  const byId = new Map(load.bookings.map((b) => [b.id, b]));
  return load.jobs.map((j) => {
    const b = byId.get(j.id);
    return {
      bookingId: j.id,
      quoteId: j.quoteId,
      date: j.date,
      spanDates: b ? spanOf(b) : [j.date],
      slot: j.slot,
      durationDays: j.durationDays,
      status: b?.status ?? null,
      assignmentStatus: b?.assignmentStatus ?? null,
      acceptedAt: iso(b?.acceptedAt),
      customerName: j.customerName,
      postcodeArea: j.postcodeArea,
      /** The full address, else the postcode. */
      address: j.mapQuery,
      jobDescription: j.jobDescription,
      fullDescription: j.fullDescription,
      photoUrls: j.photoUrls,
      materials: j.materials,
      minutes: j.minutes,
      customerValuePence: j.valuePence,
      payoutPence: j.payoutPence,
      materialsAllowancePence: j.materialsAllowancePence,
      payLines: payLines(j.payLines),
      jobPack: j.jobPack,
      packChip: j.packChip,
    };
  });
}

export function shapeFlex(load: FlexLoad) {
  const quoteById = new Map(load.quotes.map((q) => [q.id, q]));
  return load.jobs.map((j) => {
    const q = quoteById.get(j.quoteId);
    return {
      quoteId: j.quoteId,
      slug: q?.slug ?? null,
      customerName: q?.customerName ?? null,
      postcodeArea: j.postcodeArea,
      address: j.mapQuery,
      jobDescription: j.jobDescription,
      fullDescription: j.fullDescription,
      photoUrls: j.photoUrls,
      materials: j.materials,
      depositPaidAt: iso(q?.depositPaidAt),
      withinDays: q?.withinDays ?? null,
      deadline: j.deadline,
      multiDay: j.multiDay,
      requiredDays: j.requiredDays,
      needsFullDay: j.needsFullDay,
      suggestions: j.suggestions.map((s) => ({ date: s.date, slot: s.slot, reasons: s.reasons, packed: !!s.packed })),
      blockStarts: j.blockStarts.map((b) => ({ startDate: b.startDate, endDate: b.endDate, reasons: b.reasons })),
      customerValuePence: j.valuePence,
      estimatedPayoutPence: j.payoutPence,
      materialsAllowancePence: j.materialsAllowancePence,
      payLines: payLines(j.payLines),
    };
  });
}

export function shapePast(load: PastLoad) {
  const byId = new Map(load.bookings.map((b) => [b.id, b]));
  const { week } = load;
  return {
    weeksBack: week.weeksBack,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    label: week.label,
    earnedPence: week.earnedPence,
    jobs: week.jobs.map((j) => {
      const b = byId.get(j.id);
      return {
        bookingId: j.id,
        quoteId: b?.quoteId ?? null,
        date: j.date,
        spanDates: b ? spanOf(b) : [j.date],
        slot: b?.slot ?? null,
        durationDays: j.durationDays,
        status: b?.status ?? null,
        assignmentStatus: b?.assignmentStatus ?? null,
        customerName: j.customerName,
        postcodeArea: j.postcodeArea,
        address: j.mapQuery,
        jobDescription: j.jobDescription,
        fullDescription: j.fullDescription,
        photoUrls: j.photoUrls,
        customerValuePence: j.valuePence,
        payoutPence: j.payoutPence,
        materialsAllowancePence: j.materialsAllowancePence,
        payLines: payLines(j.payLines),
        completed: j.completed,
        completedAt: j.completedAt,
        evidenceUrls: j.evidenceUrls,
        signatureDataUrl: j.signatureDataUrl,
        completionNotes: j.completionNotes,
      };
    }),
  };
}

export type JobsQuery = { ok: true; view: JobView; weeksBack: number } | { ok: false; error: string };

/** Validate `?view=` (default upcoming) and `?weeksBack=` (past only, 1 to 52, default 1). */
export function parseJobsQuery(query: Record<string, unknown>): JobsQuery {
  const rawView = query.view ?? 'upcoming';
  if (typeof rawView !== 'string' || !(JOB_VIEWS as readonly string[]).includes(rawView)) {
    return { ok: false, error: 'view must be upcoming, flex or past' };
  }
  const view = rawView as JobView;
  if (query.weeksBack === undefined) return { ok: true, view, weeksBack: 1 };
  if (view !== 'past') return { ok: false, error: 'weeksBack applies to view=past only' };
  const raw = query.weeksBack;
  const weeksBack = typeof raw === 'string' && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (!(weeksBack >= 1 && weeksBack <= MAX_WEEKS_BACK)) {
    return { ok: false, error: `weeksBack must be a whole number from 1 to ${MAX_WEEKS_BACK}` };
  }
  return { ok: true, view, weeksBack };
}
