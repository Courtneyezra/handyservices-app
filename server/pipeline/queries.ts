/**
 * Pipeline read-only query helpers (D-WP1).
 *
 * Compact, agent-friendly views over jobs (contractor_booking_requests) and
 * money (invoices + unbilled completed jobs) for the ops-manager agent's
 * `get_jobs` / `get_money_state` tools. Answers Ben's questions: "who's
 * working where today? what's unassigned? who owes us money? what never got
 * billed?"
 *
 * STRICTLY read-only — no inserts/updates/deletes here, ever.
 *
 * Conventions:
 *  - money in pence, dates as 'YYYY-MM-DD' (Europe/London business day via
 *    shared/uk-time), lists capped at 40 rows, worst/newest first.
 *  - Booking occupancy reads the scheduledDates jsonb as AUTHORITATIVE via
 *    shared/schedule-composition.expandSpanDates (same pattern as
 *    server/availability-capacity.ts) — never the raw timestamp alone.
 */

import { db } from '../db';
import {
    contractorBookingRequests,
    personalizedQuotes,
    invoices,
    handymanProfiles,
    users,
} from '../../shared/schema';
import { and, eq, or, lt, gte, lte, isNull, isNotNull, desc, sql } from 'drizzle-orm';
import { expandSpanDates, maxSpanDays } from '../../shared/schedule-composition';
import { ukDay, ukToday, addDaysStr, ukDayStartUTC } from '../../shared/uk-time';

const ROW_CAP = 40;

/**
 * How many days BEFORE a target date a booking's scheduledDate can start while
 * its span still occupies the target date (mirrors availability-capacity:
 * durationDays capped at 14 + SPAN_SLACK_DAYS skips = 18).
 */
const SPAN_LOOKBACK_DAYS = maxSpanDays(14);

const DAY_MS = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// Contractor display names
// ─────────────────────────────────────────────────────────────────────────────

/**
 * id → display name for all contractors. Same resolution as the dispatch
 * sweep roster: "First Last" → businessName → 'Contractor'.
 */
async function contractorNamesById(): Promise<Map<string, string>> {
    const rows = await db.select({
        id: handymanProfiles.id,
        businessName: handymanProfiles.businessName,
        firstName: users.firstName,
        lastName: users.lastName,
    })
        .from(handymanProfiles)
        .leftJoin(users, eq(users.id, handymanProfiles.userId));

    const out = new Map<string, string>();
    for (const r of rows) {
        const full = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim();
        out.set(r.id, full || r.businessName || 'Contractor');
    }
    return out;
}

/**
 * The contractor roster: every handyman_profiles row with its display name
 * (resolution identical to contractorNamesById: "First Last" → businessName →
 * 'Contractor'). Read-only; the ids are what the agent's contractor-taking
 * tools (contractor_schedule, availability, assignment proposals) expect.
 */
export async function listContractors(): Promise<Array<{ id: string; name: string; businessName: string | null; city: string | null }>> {
    const rows = await db.select({
        id: handymanProfiles.id,
        businessName: handymanProfiles.businessName,
        city: handymanProfiles.city,
        firstName: users.firstName,
        lastName: users.lastName,
    })
        .from(handymanProfiles)
        .leftJoin(users, eq(users.id, handymanProfiles.userId));

    const out = rows.map((r) => {
        const full = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim();
        return {
            id: r.id,
            name: full || r.businessName || 'Contractor',
            businessName: r.businessName ?? null,
            city: r.city ?? null,
        };
    });
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

/**
 * Effective contractor for a booking. assignedContractorId wins; the base
 * contractorId only counts once the job has actually been assigned —
 * unassigned pool rows carry a placeholder contractorId (see
 * pipeline/actions.bookQuoteAsJob) which must NOT be shown as "assigned".
 */
function effectiveContractorId(job: {
    assignedContractorId: string | null;
    contractorId: string;
    assignmentStatus: string | null;
}): string | null {
    if (job.assignedContractorId) return job.assignedContractorId;
    if (job.assignmentStatus === 'unassigned' || job.assignmentStatus == null) return null;
    return job.contractorId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Jobs
// ─────────────────────────────────────────────────────────────────────────────

export interface JobSummary {
    id: string;
    customerName: string;
    status: string;
    assignmentStatus: string | null;
    dayOfStatus: string | null;
    scheduledSlot: string | null;
    /** Actual YYYY-MM-DD dates the booking span occupies (scheduledDates jsonb authoritative). */
    dates: string[];
    contractorId: string | null;
    contractorName: string | null;
    /** Postcode from the linked quote when present. */
    postcode: string | null;
}

/** Bookings (non-declined) whose span could touch [dayStr window]; raw rows + quote postcode. */
async function fetchSpanCandidates(fromDayStr: string, toDayStr: string) {
    return db.select({
        id: contractorBookingRequests.id,
        customerName: contractorBookingRequests.customerName,
        status: contractorBookingRequests.status,
        assignmentStatus: contractorBookingRequests.assignmentStatus,
        dayOfStatus: contractorBookingRequests.dayOfStatus,
        scheduledSlot: contractorBookingRequests.scheduledSlot,
        scheduledDate: contractorBookingRequests.scheduledDate,
        scheduledDates: contractorBookingRequests.scheduledDates,
        durationDays: contractorBookingRequests.durationDays,
        contractorId: contractorBookingRequests.contractorId,
        assignedContractorId: contractorBookingRequests.assignedContractorId,
        postcode: personalizedQuotes.postcode,
    })
        .from(contractorBookingRequests)
        .leftJoin(personalizedQuotes, eq(personalizedQuotes.id, contractorBookingRequests.quoteId))
        .where(and(
            isNotNull(contractorBookingRequests.scheduledDate),
            gte(contractorBookingRequests.scheduledDate, new Date(ukDayStartUTC(fromDayStr).getTime() - SPAN_LOOKBACK_DAYS * DAY_MS)),
            lte(contractorBookingRequests.scheduledDate, new Date(ukDayStartUTC(toDayStr).getTime() + DAY_MS)),
            sql`${contractorBookingRequests.status} <> 'declined'`,
        ));
}

/**
 * Jobs occupying TODAY (Europe/London): who's working where today.
 * Includes completed-today rows (status shows it) but not declined ones.
 */
export async function listTodaysJobs(): Promise<JobSummary[]> {
    const today = ukToday();
    const [rows, names] = await Promise.all([
        fetchSpanCandidates(today, today),
        contractorNamesById(),
    ]);

    const out: JobSummary[] = [];
    for (const j of rows) {
        if (!j.scheduledDate) continue;
        const dates = expandSpanDates(j.scheduledDate, j.durationDays, j.scheduledDates);
        if (!dates.includes(today)) continue;
        const cid = effectiveContractorId(j);
        out.push({
            id: j.id,
            customerName: j.customerName,
            status: j.status,
            assignmentStatus: j.assignmentStatus,
            dayOfStatus: j.dayOfStatus,
            scheduledSlot: j.scheduledSlot,
            dates,
            contractorId: cid,
            contractorName: cid ? (names.get(cid) ?? 'Contractor') : null,
            postcode: j.postcode ?? null,
        });
    }
    // Grouped reading order: by contractor name, unassigned-for-today last.
    out.sort((a, b) => (a.contractorName ?? '~').localeCompare(b.contractorName ?? '~'));
    return out.slice(0, ROW_CAP);
}

export interface UnassignedJob {
    id: string;
    customerName: string;
    postcode: string | null;
    /** Customer-chosen dates, when a date was picked at booking. */
    dates: string[];
    scheduledSlot: string | null;
    /** Whole days since the row entered the pool. */
    ageDays: number;
    quoteId: string | null;
    /** Quote basePrice (pence) — rough job value for triage. */
    valuePence: number | null;
    createdAt: string | null;
}

/**
 * The dispatch pool: assignmentStatus 'unassigned' (what the dispatch board
 * keys on — see pipeline/actions.bookQuoteAsJob) and not terminal. Oldest
 * (worst) first.
 */
export async function listUnassignedJobs(): Promise<UnassignedJob[]> {
    const now = Date.now();
    const rows = await db.select({
        id: contractorBookingRequests.id,
        customerName: contractorBookingRequests.customerName,
        scheduledDate: contractorBookingRequests.scheduledDate,
        scheduledDates: contractorBookingRequests.scheduledDates,
        durationDays: contractorBookingRequests.durationDays,
        scheduledSlot: contractorBookingRequests.scheduledSlot,
        createdAt: contractorBookingRequests.createdAt,
        quoteId: contractorBookingRequests.quoteId,
        postcode: personalizedQuotes.postcode,
        basePrice: personalizedQuotes.basePrice,
    })
        .from(contractorBookingRequests)
        .leftJoin(personalizedQuotes, eq(personalizedQuotes.id, contractorBookingRequests.quoteId))
        .where(and(
            eq(contractorBookingRequests.assignmentStatus, 'unassigned'),
            sql`${contractorBookingRequests.status} not in ('completed', 'declined', 'cancelled')`,
        ))
        .orderBy(contractorBookingRequests.createdAt)
        .limit(ROW_CAP);

    return rows.map((j) => ({
        id: j.id,
        customerName: j.customerName,
        postcode: j.postcode ?? null,
        dates: j.scheduledDate ? expandSpanDates(j.scheduledDate, j.durationDays, j.scheduledDates) : [],
        scheduledSlot: j.scheduledSlot,
        ageDays: j.createdAt ? Math.floor((now - j.createdAt.getTime()) / DAY_MS) : 0,
        quoteId: j.quoteId,
        valuePence: j.basePrice ?? null,
        createdAt: j.createdAt ? ukDay(j.createdAt) : null,
    }));
}

/**
 * One contractor's jobs across a date window (default: today + 7 days,
 * Europe/London). A job is included when its occupied span (scheduledDates
 * jsonb authoritative) intersects the window; `dates` is the FULL span.
 */
export async function getContractorSchedule(
    contractorId: string,
    fromDate?: string,
    days = 7,
): Promise<JobSummary[]> {
    const from = fromDate ?? ukToday();
    const to = addDaysStr(from, Math.max(0, days - 1));
    const [rows, names] = await Promise.all([
        fetchSpanCandidates(from, to),
        contractorNamesById(),
    ]);
    const name = names.get(contractorId) ?? 'Contractor';

    const out: JobSummary[] = [];
    for (const j of rows) {
        if (!j.scheduledDate) continue;
        if (effectiveContractorId(j) !== contractorId) continue;
        const dates = expandSpanDates(j.scheduledDate, j.durationDays, j.scheduledDates);
        if (!dates.some((d) => d >= from && d <= to)) continue;
        out.push({
            id: j.id,
            customerName: j.customerName,
            status: j.status,
            assignmentStatus: j.assignmentStatus,
            dayOfStatus: j.dayOfStatus,
            scheduledSlot: j.scheduledSlot,
            dates,
            contractorId,
            contractorName: name,
            postcode: j.postcode ?? null,
        });
    }
    out.sort((a, b) => (a.dates[0] ?? '').localeCompare(b.dates[0] ?? ''));
    return out.slice(0, ROW_CAP);
}

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────

export interface OverdueInvoice {
    id: string;
    invoiceNumber: string;
    customerName: string;
    phone: string | null;
    balanceDuePence: number;
    dueDate: string | null;
    /** Whole days past dueDate (null when no dueDate is set). */
    daysOverdue: number | null;
    /**
     * Was this invoice ever actually sent (sentAt)? Dunning only chases
     * sent invoices — a large legacy cohort is status 'overdue' with
     * sentAt NULL (never reached the customer), so the agent must not treat
     * those as customer debts to chase without checking.
     */
    everSent: boolean;
    status: string;
}

/** Predicate shared by the overdue list + summary: 'overdue' OR 'sent' past due (mirrors checkOverdueInvoices). */
function overdueWhere(now: Date) {
    return or(
        eq(invoices.status, 'overdue'),
        and(eq(invoices.status, 'sent'), lt(invoices.dueDate, now)),
    );
}

/** Who owes us money — worst (most days overdue, then biggest balance) first. */
export async function listOverdueInvoices(): Promise<OverdueInvoice[]> {
    const now = new Date();
    const rows = await db.select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        customerName: invoices.customerName,
        customerPhone: invoices.customerPhone,
        balanceDue: invoices.balanceDue,
        dueDate: invoices.dueDate,
        sentAt: invoices.sentAt,
        status: invoices.status,
    })
        .from(invoices)
        .where(overdueWhere(now));

    const out: OverdueInvoice[] = rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        customerName: r.customerName,
        phone: r.customerPhone ?? null,
        balanceDuePence: r.balanceDue,
        dueDate: r.dueDate ? ukDay(r.dueDate) : null,
        daysOverdue: r.dueDate ? Math.max(0, Math.floor((now.getTime() - r.dueDate.getTime()) / DAY_MS)) : null,
        everSent: r.sentAt != null,
        status: r.status,
    }));
    out.sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) || b.balanceDuePence - a.balanceDuePence);
    return out.slice(0, ROW_CAP);
}

export interface UnbilledCompletedJob {
    jobId: string;
    customerName: string;
    completedOn: string | null;
    quoteId: string;
    /** Quote basePrice (pence). */
    quoteTotalPence: number | null;
    depositPaidPence: number;
    /** Approximate uninvoiced balance = basePrice − deposit (pence, floor 0). */
    estBalancePence: number;
    /** Track-A generation state ('pending'|'generated'|'skipped'|'failed'|null legacy). */
    balanceInvoiceStatus: string | null;
}

/**
 * Conditions for "completed, took a deposit, never got billed" — mirrors the
 * invoice-generator reconciliation `not exists` sweep, minus its recency
 * cutoff and balanceInvoiceStatus exclusions (Ben wants ALL never-billed
 * jobs; the status is reported instead of filtered on).
 */
function unbilledWhere() {
    return and(
        eq(contractorBookingRequests.status, 'completed'),
        isNotNull(contractorBookingRequests.completedAt),
        isNotNull(personalizedQuotes.depositPaidAt),
        sql`coalesce(${personalizedQuotes.depositAmountPence}, 0) > 0`,
        isNull(contractorBookingRequests.invoiceId),
        sql`not exists (select 1 from invoices where invoices.quote_id = ${contractorBookingRequests.quoteId})`,
    );
}

/** What never got billed — newest completion first. */
export async function listUnbilledCompletedJobs(): Promise<UnbilledCompletedJob[]> {
    const rows = await db.select({
        jobId: contractorBookingRequests.id,
        customerName: contractorBookingRequests.customerName,
        completedAt: contractorBookingRequests.completedAt,
        quoteId: contractorBookingRequests.quoteId,
        basePrice: personalizedQuotes.basePrice,
        depositAmountPence: personalizedQuotes.depositAmountPence,
        balanceInvoiceStatus: contractorBookingRequests.balanceInvoiceStatus,
    })
        .from(contractorBookingRequests)
        .innerJoin(personalizedQuotes, eq(personalizedQuotes.id, contractorBookingRequests.quoteId))
        .where(unbilledWhere())
        .orderBy(desc(contractorBookingRequests.completedAt))
        .limit(ROW_CAP);

    return rows.map((r) => ({
        jobId: r.jobId,
        customerName: r.customerName,
        completedOn: r.completedAt ? ukDay(r.completedAt) : null,
        quoteId: r.quoteId!,
        quoteTotalPence: r.basePrice ?? null,
        depositPaidPence: r.depositAmountPence ?? 0,
        estBalancePence: Math.max(0, (r.basePrice ?? 0) - (r.depositAmountPence ?? 0)),
        balanceInvoiceStatus: r.balanceInvoiceStatus,
    }));
}

export interface MoneySummary {
    overdue: {
        count: number;
        totalBalanceDuePence: number;
        /** Subset that was actually sent to a customer (chaseable). */
        sentCount: number;
        sentBalanceDuePence: number;
    };
    unbilled: {
        count: number;
        totalEstBalancePence: number;
    };
}

/** Aggregate money state — counts/totals over the FULL sets (not the 40-row caps). */
export async function getMoneySummary(): Promise<MoneySummary> {
    const now = new Date();

    const [overdueAgg, unbilledAgg] = await Promise.all([
        db.select({
            count: sql<number>`count(*)::int`,
            total: sql<number>`coalesce(sum(${invoices.balanceDue}), 0)::int`,
            sentCount: sql<number>`count(*) filter (where ${invoices.sentAt} is not null)::int`,
            sentTotal: sql<number>`coalesce(sum(${invoices.balanceDue}) filter (where ${invoices.sentAt} is not null), 0)::int`,
        })
            .from(invoices)
            .where(overdueWhere(now)),
        db.select({
            count: sql<number>`count(*)::int`,
            total: sql<number>`coalesce(sum(greatest(coalesce(${personalizedQuotes.basePrice}, 0) - coalesce(${personalizedQuotes.depositAmountPence}, 0), 0)), 0)::int`,
        })
            .from(contractorBookingRequests)
            .innerJoin(personalizedQuotes, eq(personalizedQuotes.id, contractorBookingRequests.quoteId))
            .where(unbilledWhere()),
    ]);

    return {
        overdue: {
            count: overdueAgg[0].count,
            totalBalanceDuePence: overdueAgg[0].total,
            sentCount: overdueAgg[0].sentCount,
            sentBalanceDuePence: overdueAgg[0].sentTotal,
        },
        unbilled: {
            count: unbilledAgg[0].count,
            totalEstBalancePence: unbilledAgg[0].total,
        },
    };
}
