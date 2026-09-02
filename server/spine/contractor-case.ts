/**
 * Contractor case context (Phase 4 / C, design §7 "Contractor lane").
 *
 * A contractor's thread is about the jobs they hold, so the liaison reads those alongside the
 * timeline: which bookings are assigned to them (contractor_booking_requests, the dispatch source
 * of truth, plus the legacy contractor_jobs rows), each reduced to what a brief may carry —
 * postcode, slot, the work, materials if the quote listed any — and never the customer's phone,
 * email or full address (guards.ts customer_pii enforces the same rule on the reply).
 *
 * The lookup is phone → users.role='contractor' → handyman_profiles. Until the 8 contractor users
 * have real phones (empty strings on 2 Sep 2026) every lookup returns `contractor: null` and the
 * liaison briefs from the thread alone.
 */
import type { CaseFile } from './types';

export interface ContractorJobBrief {
    ref: string;
    source: 'booking_request' | 'contractor_job';
    status: string;
    scheduledDate: string | null;
    slot: string | null;
    postcode: string | null;
    customerFirstName: string | null;
    work: string;
    payoutPence: number | null;
    materials: string[];
    quoteSlug: string | null;
}

export interface ContractorContext {
    contractor: { profileId: string; userId: string; name: string } | null;
    jobs: ContractorJobBrief[];
}

export const CONTRACTOR_JOB_WINDOW_DAYS = 14;
export const CONTRACTOR_LIVE_STATUSES = ['assigned', 'accepted', 'in_progress', 'pending'] as const;

export function digitsOf(phone: string | null | undefined): string {
    return (phone ?? '').replace('@c.us', '').replace(/\D/g, '');
}

export function firstNameOf(full: string | null | undefined): string | null {
    const n = (full ?? '').trim();
    if (!n) return null;
    return n.split(/\s+/)[0] || null;
}

/** Materials the quote's lines carry, whatever field the picker used. Never prices. */
export function materialsFromLines(lines: unknown): string[] {
    if (!Array.isArray(lines)) return [];
    const out: string[] = [];
    for (const l of lines) {
        const m = (l as any)?.materials ?? (l as any)?.shoppingList ?? (l as any)?.materialsList;
        if (Array.isArray(m)) for (const item of m) out.push(typeof item === 'string' ? item : String(item?.name ?? item?.title ?? item?.description ?? '')).filter(Boolean);
    }
    return Array.from(new Set(out.filter(Boolean))).slice(0, 30);
}

export type ContractorContextLoader = (phone: string) => Promise<ContractorContext>;

/** Default: read the database. Injectable so the agent tests never touch one. */
export async function loadContractorContext(phone: string): Promise<ContractorContext> {
    const digits = digitsOf(phone);
    if (!digits) return { contractor: null, jobs: [] };
    const { db } = await import('../db');
    const { users, handymanProfiles, contractorBookingRequests, contractorJobs, personalizedQuotes } = await import('@shared/schema');
    const { eq, or, sql, inArray, gte, lte, and } = await import('drizzle-orm');

    const [u] = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, phone: users.phone })
        .from(users)
        .where(and(eq(users.role, 'contractor'), sql`right(regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g'), 10) = ${digits.slice(-10)}`))
        .limit(1);
    if (!u) return { contractor: null, jobs: [] };
    const [profile] = await db.select({ id: handymanProfiles.id }).from(handymanProfiles).where(eq(handymanProfiles.userId, u.id)).limit(1);
    if (!profile) return { contractor: { profileId: '', userId: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() }, jobs: [] };

    const since = new Date(Date.now() - CONTRACTOR_JOB_WINDOW_DAYS * 86_400_000);
    const until = new Date(Date.now() + CONTRACTOR_JOB_WINDOW_DAYS * 86_400_000);
    const jobs: ContractorJobBrief[] = [];

    const bookings = await db.select({
        id: contractorBookingRequests.id, status: contractorBookingRequests.status, assignmentStatus: contractorBookingRequests.assignmentStatus,
        scheduledDate: contractorBookingRequests.scheduledDate, start: contractorBookingRequests.scheduledStartTime, end: contractorBookingRequests.scheduledEndTime,
        slot: contractorBookingRequests.requestedSlot, description: contractorBookingRequests.description, customerName: contractorBookingRequests.customerName,
        quoteId: contractorBookingRequests.quoteId,
    }).from(contractorBookingRequests)
        .where(and(
            or(eq(contractorBookingRequests.assignedContractorId, profile.id), eq(contractorBookingRequests.contractorId, profile.id)),
            inArray(contractorBookingRequests.status, [...CONTRACTOR_LIVE_STATUSES]),
            or(sql`${contractorBookingRequests.scheduledDate} IS NULL`, and(gte(contractorBookingRequests.scheduledDate, since), lte(contractorBookingRequests.scheduledDate, until))),
        )).limit(10);
    const quoteIds = bookings.map((b) => b.quoteId).filter((x): x is string => !!x);
    const quotes = quoteIds.length
        ? await db.select({ id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, postcode: personalizedQuotes.postcode, lines: personalizedQuotes.pricingLineItems, job: personalizedQuotes.jobDescription })
            .from(personalizedQuotes).where(inArray(personalizedQuotes.id, quoteIds))
        : [];
    const quoteById = new Map(quotes.map((q) => [q.id, q]));
    for (const b of bookings) {
        const q = b.quoteId ? quoteById.get(b.quoteId) : undefined;
        jobs.push({
            ref: b.id, source: 'booking_request', status: b.assignmentStatus ?? b.status,
            scheduledDate: b.scheduledDate ? new Date(b.scheduledDate).toISOString().slice(0, 10) : null,
            slot: b.start && b.end ? `${b.start}-${b.end}` : (b.slot ?? null),
            postcode: q?.postcode ?? null,
            customerFirstName: firstNameOf(b.customerName),
            work: (b.description ?? q?.job ?? '').slice(0, 600),
            payoutPence: null,
            materials: materialsFromLines(q?.lines),
            quoteSlug: q?.slug ?? null,
        });
    }

    const legacy = await db.select({
        id: contractorJobs.id, status: contractorJobs.status, scheduledDate: contractorJobs.scheduledDate, time: contractorJobs.scheduledTime,
        postcode: contractorJobs.postcode, customerName: contractorJobs.customerName, description: contractorJobs.jobDescription, payout: contractorJobs.payoutPence,
    }).from(contractorJobs)
        .where(and(eq(contractorJobs.contractorId, profile.id), inArray(contractorJobs.status, ['pending', 'accepted', 'in_progress'])))
        .limit(10);
    for (const j of legacy) {
        jobs.push({
            ref: j.id, source: 'contractor_job', status: j.status,
            scheduledDate: j.scheduledDate ? new Date(j.scheduledDate).toISOString().slice(0, 10) : null,
            slot: j.time ?? null, postcode: j.postcode ?? null, customerFirstName: firstNameOf(j.customerName),
            work: (j.description ?? '').slice(0, 600), payoutPence: j.payout ?? null, materials: [], quoteSlug: null,
        });
    }
    return { contractor: { profileId: profile.id, userId: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() }, jobs };
}

/** The brief as the liaison reads it. Postcode and first name only — by construction. */
export function renderContractorContext(ctx: ContractorContext, cf: CaseFile): string {
    const lines: string[] = [];
    lines.push(ctx.contractor ? `Contractor: ${ctx.contractor.name || 'unnamed'} (profile ${ctx.contractor.profileId || 'none'}).` : 'Contractor: NOT MATCHED to a contractor user (no phone on record) — brief from the thread only.');
    if (!ctx.jobs.length) lines.push('Assigned jobs on record: none in the last/next 14 days.');
    else {
        lines.push(`Assigned jobs (${ctx.jobs.length}):`);
        for (const j of ctx.jobs) {
            lines.push(`- ${j.ref} [${j.source}] ${j.status}: ${j.scheduledDate ?? 'date TBC'}${j.slot ? ` ${j.slot}` : ''} · postcode ${j.postcode ?? 'unknown'}${j.customerFirstName ? ` · customer first name ${j.customerFirstName}` : ''}${j.quoteSlug ? ` · quote ${j.quoteSlug}` : ''}`);
            if (j.work) lines.push(`  work: ${j.work}`);
            if (j.materials.length) lines.push(`  materials: ${j.materials.join('; ')}`);
            if (j.payoutPence != null) lines.push(`  payout: £${(j.payoutPence / 100).toFixed(2)} (to the contractor; never the customer's price)`);
        }
    }
    lines.push(`Thread contact name: ${cf.contactName ?? 'none'}.`);
    return lines.join('\n');
}
