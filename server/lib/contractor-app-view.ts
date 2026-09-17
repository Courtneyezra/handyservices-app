/**
 * Contractor app — what money and day-of status the app may carry (pure, DB-free).
 *
 * Money in the app is "per-job estimate only" and the job value is "hide it everywhere":
 *
 *   - a job carries HIS estimated pay for that job, labelled as an estimate, never a guarantee;
 *   - no response carries the customer's price for the job (the quote's basePrice, a kept-scope
 *     gross, a line's customer labour price, a balance the customer owes);
 *   - no response carries a total, a scorecard sum or a ledger of his pay.
 *
 * The routes shape every money field through here, and the tests walk whole responses with
 * `forbiddenMoneyKeys` so a field added later cannot slip a customer price or a total back in.
 */
import type { ContractorPaySnapshot } from './contractor-pay';
import { expandSpanDates } from '../../shared/schedule-composition';
import type { DayOfStep } from './day-of-transitions';

/** The one label the app shows beside a job's pay. */
export const PAY_ESTIMATE_LABEL = 'Estimated pay for this job';

/** One task's share of his estimated pay, without the customer's labour price or a floor marker. */
export interface AppPayLine {
  category: string;
  description: string | null;
  tier: string;
  payPence: number;
  /** Materials at cost: what goes on the Handy card, an allowance, not income. */
  materialsPence: number;
}

/**
 * Pure: the pay breakdown the app may show. `labourPence` is the customer's labour price, and
 * `method: 'floor'` reads as "minimum pay", which is a guarantee the business does not give.
 */
export function appPayLines(lines: ContractorPaySnapshot['lines'] | null | undefined): AppPayLine[] | null {
  if (!lines) return null;
  return lines.map((l) => ({
    category: l.category,
    description: l.description,
    tier: l.tier,
    payPence: l.payPence,
    materialsPence: l.materialsPence,
  }));
}

/** Pure: the money fields one job carries in the app. */
export function jobPayFields(input: {
  estimatedPayPence: number | null | undefined;
  pay: ContractorPaySnapshot | null | undefined;
}): { payoutPence: number | null; payoutLabel: string; materialsAllowancePence: number | null; payLines: AppPayLine[] | null } {
  return {
    payoutPence: input.estimatedPayPence ?? null,
    payoutLabel: PAY_ESTIMATE_LABEL,
    materialsAllowancePence: input.pay ? input.pay.totalMaterialsPence : null,
    payLines: appPayLines(input.pay?.lines),
  };
}

/**
 * Keys no contractor-app response may carry at any depth: the customer's job value and every
 * pay total. Materials run totals (`totalIncVatPence`, `lineCostPence`) are the shopping list's
 * card spend, not pay or job value, so they are not listed.
 */
export const FORBIDDEN_APP_MONEY_KEYS: ReadonlySet<string> = new Set([
  'valuePence', 'basePrice', 'labourPence', 'totalLabourPence', 'balanceDuePence',
  'allTimePence', 'monthPence', 'weekPence', 'completedPence', 'bookedPence',
  'earnedPence', 'totalPence', 'totalPayPence',
]);

/** Pure: every path in `payload` whose key is forbidden, for tests and for a belt in the routes. */
export function forbiddenMoneyKeys(payload: unknown, path = ''): string[] {
  if (Array.isArray(payload)) return payload.flatMap((v, i) => forbiddenMoneyKeys(v, `${path}[${i}]`));
  if (!payload || typeof payload !== 'object') return [];
  return Object.entries(payload as Record<string, unknown>).flatMap(([k, v]) => [
    ...(FORBIDDEN_APP_MONEY_KEYS.has(k) ? [`${path}${path ? '.' : ''}${k}`] : []),
    ...forbiddenMoneyKeys(v, `${path}${path ? '.' : ''}${k}`),
  ]);
}

// ---------------------------------------------------------------- day-of status

/** What the contractor can tell the office from the app. Neither sends the customer anything. */
export type AppJobStatus = 'on_my_way' | 'arrived';

export const APP_JOB_STATUSES: readonly AppJobStatus[] = ['on_my_way', 'arrived'];

export function isAppJobStatus(v: unknown): v is AppJobStatus {
  return typeof v === 'string' && (APP_JOB_STATUSES as readonly string[]).includes(v);
}

/** The day-of step each app status takes on server/lib/day-of-transitions.ts's ladder. */
export const APP_STATUS_STEP = { on_my_way: 'en_route', arrived: 'arrived' } as const satisfies Record<AppJobStatus, DayOfStep>;

export interface StatusBooking {
  contractorId: string | null;
  assignedContractorId: string | null;
  status: string | null;
  assignmentStatus: string | null;
  acceptedAt: Date | string | null;
  scheduledDate: Date | string | null;
  durationDays: number | null;
  scheduledDates: unknown;
}

/**
 * Pure: may this contractor record day-of progress on this booking today? His job, accepted, not
 * closed, and one of its days is today. Which step he may take is the day-of ladder's question.
 */
export function appStatusRefusal(b: StatusBooking | null | undefined, profileId: string, today: string): { status: number; error: string } | null {
  if (!b) return { status: 404, error: 'Job not found' };
  if ((b.assignedContractorId ?? b.contractorId) !== profileId) return { status: 403, error: 'Not your job' };
  const accepted = !!b.acceptedAt || b.status === 'accepted' || ['accepted', 'in_progress', 'completed'].includes(String(b.assignmentStatus ?? ''));
  if (!accepted) return { status: 409, error: 'Accept the job first' };
  if (b.status === 'completed' || b.assignmentStatus === 'completed' || b.status === 'declined' || b.status === 'cancelled') {
    return { status: 409, error: 'That job is closed. Anything else goes through the office.' };
  }
  if (!b.scheduledDate) return { status: 409, error: 'That job has no day yet' };
  const days = expandSpanDates(b.scheduledDate, b.durationDays ?? 1, b.scheduledDates);
  if (!days.includes(today)) return { status: 409, error: 'That job is not today' };
  return null;
}
