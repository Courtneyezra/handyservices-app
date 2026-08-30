// ==========================================
// CUSTOMER DOSSIER (READ-ONLY)
// ==========================================
//
// getCustomerDossier(phone) — ONE compact aggregation of everything we know
// about a single customer, keyed on their phone number. Built for the
// ops-manager agent's `get_customer_dossier` tool: the agent gets ids for
// deep links, names, pence amounts, ISO dates and stage/status facts in a
// single blob, with a tiny `summary` head so it can answer "does she owe us
// money / is there a live quote?" without digging.
//
// ZERO writes. No INSERT/UPDATE/DELETE anywhere in this file.
//
// Phone identity follows the codebase's established heuristics:
//   - client-aggregation.ts groups on raw stripped digits;
//   - desk-routes.ts joins on the LAST 10 DIGITS (digits10) because the same
//     person appears as "+447936816338", "447936816338@c.us" and "07936816338"
//     depending on which table wrote the row.
// We use the last-10-digits key here (SQL-side: right(regexp_replace(...)))
// so all three storage forms match. Keys shorter than 7 digits fall back to
// exact-digits equality to avoid suffix false-positives.

import { desc, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import {
    leads,
    personalizedQuotes,
    contractorBookingRequests,
    invoices,
    conversations,
    calls,
} from '../shared/schema';
import { effectiveExpiryMs, isQuoteExpiredStrict } from './quotes';

// --- constants ---

const CAP = 10; // each list: ~10 newest rows

// --- phone key ---

/** Normalize any stored/user phone form (+44…, 07…, 447…@c.us, spaced) to the
 *  last-10-digits join key used across the desk/inbox code. */
export function phoneKey(raw: string): string {
    return (raw ?? '').replace('@c.us', '').replace(/\D/g, '').slice(-10);
}

/** SQL predicate: does this column's digits end with the key?
 *  Non-sargable (regexp per row) — same cost class as the existing
 *  client-aggregation full-table pulls, but filtered DB-side. */
function phoneMatch(col: unknown, key: string): SQL {
    const digits = sql`regexp_replace(coalesce(${col as SQL}, ''), '[^0-9]', '', 'g')`;
    if (key.length >= 7) return sql`right(${digits}, ${key.length}) = ${key}`;
    return sql`${digits} = ${key}`;
}

// --- shapes ---

function iso(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    const t = new Date(d);
    return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

function clip(s: string | null | undefined, max = 140): string | null {
    if (!s) return null;
    const t = s.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export interface DossierLead {
    id: string;
    name: string;
    stage: string | null;
    status: string;
    source: string | null;
    job: string | null; // jobSummary ?? clipped jobDescription
    createdAt: string | null;
}

export type DossierQuoteStatus = 'booked' | 'deposit_paid' | 'expired' | 'price_lock_lapsed' | 'live';

export interface DossierQuote {
    id: string;
    shortSlug: string;
    name: string;
    job: string | null;
    pricePence: number | null; // basePrice
    status: DossierQuoteStatus;
    expiresAt: string | null; // effectiveExpiryMs (price-lock expiry incl. legacy fallback)
    viewedAt: string | null;
    bookedAt: string | null;
    depositPaidAt: string | null;
    createdAt: string | null;
}

export interface DossierJob {
    id: string;
    quoteId: string | null;
    invoiceId: string | null;
    name: string;
    description: string | null;
    status: string;
    assignmentStatus: string | null;
    dayOfStatus: string | null;
    scheduledDate: string | null;
    completedAt: string | null;
    createdAt: string | null;
}

export interface DossierInvoice {
    id: string;
    invoiceNumber: string;
    quoteId: string | null;
    name: string;
    totalPence: number;
    balanceDuePence: number;
    status: string;
    dueDate: string | null;
    paidAt: string | null;
    createdAt: string | null;
}

export interface DossierConversation {
    id: string;
    contactName: string | null;
    stage: string | null;
    status: string;
    unreadCount: number;
    tags: string[];
    lastMessageAt: string | null;
}

export interface DossierCall {
    id: string;
    direction: string;
    status: string;
    outcome: string | null;
    durationSec: number | null;
    jobSummary: string | null;
    startTime: string | null;
}

export interface CustomerDossier {
    phoneKey: string;
    name: string | null; // best-known display name (quotes > invoices > jobs > leads > conversations)
    summary: {
        jobs: number;               // total matching jobs (uncapped)
        openBalancePence: number;   // sum of balance_due on unpaid, non-void invoices (uncapped)
        liveQuotes: number;         // not booked/deposit-paid and not strict-expired (uncapped)
        counts: {
            leads: number;
            quotes: number;
            jobs: number;
            invoices: number;
            conversations: number;
            calls: number;
        };
    };
    leads: DossierLead[];
    quotes: DossierQuote[];
    jobs: DossierJob[];
    invoices: DossierInvoice[];
    conversations: DossierConversation[];
    calls: DossierCall[];
}

// --- the aggregation ---

export async function getCustomerDossier(phone: string): Promise<CustomerDossier> {
    const key = phoneKey(phone);

    const empty: CustomerDossier = {
        phoneKey: key,
        name: null,
        summary: {
            jobs: 0,
            openBalancePence: 0,
            liveQuotes: 0,
            counts: { leads: 0, quotes: 0, jobs: 0, invoices: 0, conversations: 0, calls: 0 },
        },
        leads: [],
        quotes: [],
        jobs: [],
        invoices: [],
        conversations: [],
        calls: [],
    };
    if (!key) return empty; // no digits at all — well-formed empty dossier

    const count = sql<number>`count(*)::int`;

    // Phase 1 — everything keyed directly on the phone. Quote FACTS are pulled
    // for ALL matching quotes (4 cheap columns) so FK-linking of jobs/invoices
    // and the liveQuotes total are accurate beyond the 10-row display cap.
    const [
        leadRows,
        quoteRows,
        quoteFacts,
        convRows,
        callRows,
        [leadCount],
        [quoteCount],
        [convCount],
        [callCount],
    ] = await Promise.all([
        db.select({
            id: leads.id,
            customerName: leads.customerName,
            stage: leads.stage,
            status: leads.status,
            source: leads.source,
            jobSummary: leads.jobSummary,
            jobDescription: leads.jobDescription,
            createdAt: leads.createdAt,
        }).from(leads).where(phoneMatch(leads.phone, key))
            .orderBy(desc(leads.createdAt)).limit(CAP),
        db.select({
            id: personalizedQuotes.id,
            shortSlug: personalizedQuotes.shortSlug,
            customerName: personalizedQuotes.customerName,
            jobDescription: personalizedQuotes.jobDescription,
            basePrice: personalizedQuotes.basePrice,
            viewedAt: personalizedQuotes.viewedAt,
            bookedAt: personalizedQuotes.bookedAt,
            depositPaidAt: personalizedQuotes.depositPaidAt,
            expiresAt: personalizedQuotes.expiresAt,
            createdAt: personalizedQuotes.createdAt,
        }).from(personalizedQuotes).where(phoneMatch(personalizedQuotes.phone, key))
            .orderBy(desc(personalizedQuotes.createdAt)).limit(CAP),
        db.select({
            id: personalizedQuotes.id,
            bookedAt: personalizedQuotes.bookedAt,
            depositPaidAt: personalizedQuotes.depositPaidAt,
            expiresAt: personalizedQuotes.expiresAt,
            createdAt: personalizedQuotes.createdAt,
        }).from(personalizedQuotes).where(phoneMatch(personalizedQuotes.phone, key)),
        db.select({
            id: conversations.id,
            contactName: conversations.contactName,
            stage: conversations.stage,
            status: conversations.status,
            unreadCount: conversations.unreadCount,
            tags: conversations.tags,
            lastMessageAt: conversations.lastMessageAt,
        }).from(conversations).where(phoneMatch(conversations.phoneNumber, key))
            .orderBy(desc(conversations.lastMessageAt)).limit(CAP),
        db.select({
            id: calls.id,
            direction: calls.direction,
            status: calls.status,
            outcome: calls.outcome,
            duration: calls.duration,
            jobSummary: calls.jobSummary,
            startTime: calls.startTime,
        }).from(calls).where(phoneMatch(calls.phoneNumber, key))
            .orderBy(desc(calls.startTime)).limit(CAP),
        db.select({ n: count }).from(leads).where(phoneMatch(leads.phone, key)),
        db.select({ n: count }).from(personalizedQuotes).where(phoneMatch(personalizedQuotes.phone, key)),
        db.select({ n: count }).from(conversations).where(phoneMatch(conversations.phoneNumber, key)),
        db.select({ n: count }).from(calls).where(phoneMatch(calls.phoneNumber, key)),
    ]);

    // Phase 2 — jobs + invoices: direct phone match OR linked via any of this
    // customer's quote ids (denormalized contact details can drift downstream).
    const allQuoteIds = quoteFacts.map((q) => q.id);
    const jobCond = allQuoteIds.length > 0
        ? or(phoneMatch(contractorBookingRequests.customerPhone, key), inArray(contractorBookingRequests.quoteId, allQuoteIds))!
        : phoneMatch(contractorBookingRequests.customerPhone, key);
    const invCond = allQuoteIds.length > 0
        ? or(phoneMatch(invoices.customerPhone, key), inArray(invoices.quoteId, allQuoteIds))!
        : phoneMatch(invoices.customerPhone, key);

    const [jobRows, invRows, [jobCount], [invCount], [openBalance]] = await Promise.all([
        db.select({
            id: contractorBookingRequests.id,
            quoteId: contractorBookingRequests.quoteId,
            invoiceId: contractorBookingRequests.invoiceId,
            customerName: contractorBookingRequests.customerName,
            description: contractorBookingRequests.description,
            status: contractorBookingRequests.status,
            assignmentStatus: contractorBookingRequests.assignmentStatus,
            dayOfStatus: contractorBookingRequests.dayOfStatus,
            scheduledDate: contractorBookingRequests.scheduledDate,
            completedAt: contractorBookingRequests.completedAt,
            createdAt: contractorBookingRequests.createdAt,
        }).from(contractorBookingRequests).where(jobCond)
            .orderBy(desc(contractorBookingRequests.createdAt)).limit(CAP),
        db.select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            quoteId: invoices.quoteId,
            customerName: invoices.customerName,
            totalAmount: invoices.totalAmount,
            balanceDue: invoices.balanceDue,
            status: invoices.status,
            dueDate: invoices.dueDate,
            paidAt: invoices.paidAt,
            createdAt: invoices.createdAt,
        }).from(invoices).where(invCond)
            .orderBy(desc(invoices.createdAt)).limit(CAP),
        db.select({ n: count }).from(contractorBookingRequests).where(jobCond),
        db.select({ n: count }).from(invoices).where(invCond),
        db.select({ pence: sql<number>`coalesce(sum(${invoices.balanceDue}), 0)::int` })
            .from(invoices)
            .where(sql`${invCond} and ${notInArray(invoices.status, ['paid', 'void'])} and ${invoices.balanceDue} > 0`),
    ]);

    // Quote status facts (price-lock + strict expiry from server/quotes.ts).
    function quoteStatus(q: { bookedAt: Date | null; depositPaidAt: Date | null; expiresAt: Date | null; createdAt: Date | null }): DossierQuoteStatus {
        if (q.depositPaidAt) return 'deposit_paid';
        if (q.bookedAt) return 'booked';
        if (isQuoteExpiredStrict(q)) return 'expired';
        if (effectiveExpiryMs(q) < Date.now()) return 'price_lock_lapsed'; // reissuable, not hard-dead
        return 'live';
    }

    const liveQuotes = quoteFacts.filter((q) =>
        !q.bookedAt && !q.depositPaidAt && !isQuoteExpiredStrict(q)
    ).length;

    // Best-known display name: newest quote > invoice > job > lead > conversation.
    const name =
        quoteRows[0]?.customerName?.trim() ||
        invRows[0]?.customerName?.trim() ||
        jobRows[0]?.customerName?.trim() ||
        leadRows[0]?.customerName?.trim() ||
        convRows[0]?.contactName?.trim() ||
        null;

    return {
        phoneKey: key,
        name,
        summary: {
            jobs: jobCount?.n ?? 0,
            openBalancePence: openBalance?.pence ?? 0,
            liveQuotes,
            counts: {
                leads: leadCount?.n ?? 0,
                quotes: quoteCount?.n ?? 0,
                jobs: jobCount?.n ?? 0,
                invoices: invCount?.n ?? 0,
                conversations: convCount?.n ?? 0,
                calls: callCount?.n ?? 0,
            },
        },
        leads: leadRows.map((r) => ({
            id: r.id,
            name: r.customerName,
            stage: r.stage,
            status: r.status,
            source: r.source,
            job: r.jobSummary?.trim() || clip(r.jobDescription),
            createdAt: iso(r.createdAt),
        })),
        quotes: quoteRows.map((r) => ({
            id: r.id,
            shortSlug: r.shortSlug,
            name: r.customerName,
            job: clip(r.jobDescription),
            pricePence: r.basePrice,
            status: quoteStatus(r),
            expiresAt: iso(new Date(effectiveExpiryMs(r))),
            viewedAt: iso(r.viewedAt),
            bookedAt: iso(r.bookedAt),
            depositPaidAt: iso(r.depositPaidAt),
            createdAt: iso(r.createdAt),
        })),
        jobs: jobRows.map((r) => ({
            id: r.id,
            quoteId: r.quoteId,
            invoiceId: r.invoiceId,
            name: r.customerName,
            description: clip(r.description),
            status: r.status,
            assignmentStatus: r.assignmentStatus,
            dayOfStatus: r.dayOfStatus,
            scheduledDate: iso(r.scheduledDate),
            completedAt: iso(r.completedAt),
            createdAt: iso(r.createdAt),
        })),
        invoices: invRows.map((r) => ({
            id: r.id,
            invoiceNumber: r.invoiceNumber,
            quoteId: r.quoteId,
            name: r.customerName,
            totalPence: r.totalAmount,
            balanceDuePence: r.balanceDue,
            status: r.status,
            dueDate: iso(r.dueDate),
            paidAt: iso(r.paidAt),
            createdAt: iso(r.createdAt),
        })),
        conversations: convRows.map((r) => ({
            id: r.id,
            contactName: r.contactName,
            stage: r.stage,
            status: r.status,
            unreadCount: r.unreadCount ?? 0,
            tags: r.tags ?? [],
            lastMessageAt: iso(r.lastMessageAt),
        })),
        calls: callRows.map((r) => ({
            id: r.id,
            direction: r.direction,
            status: r.status,
            outcome: r.outcome,
            durationSec: r.duration,
            jobSummary: r.jobSummary?.trim() || null,
            startTime: iso(r.startTime),
        })),
    };
}
