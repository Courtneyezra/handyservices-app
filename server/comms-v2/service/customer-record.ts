/**
 * The customer's full record, read-only (captain's answer of 17 Sep, "Read-only full record"; answer
 * 11's "their own lead, quotes, jobs, dates, past visits, invoices"). Two reads over the CRM tables
 * the rest of the business already writes, and nothing else:
 *
 *   knownCustomer   the service_clients rows a canonical key names (desk/identity.ts asks it for a
 *                   key it has never seen, so a customer who is in the CRM but new to the desk is
 *                   recognised). The key convention is the client record's own (server/clients.ts
 *                   clientDedupeKey), so a key is matched on `dedupe_key` and on the primary phone or
 *                   email. Identity binds only when exactly one client answers.
 *   record          one client's leads, quotes, jobs (contractor_booking_requests, the diary's own
 *                   table) with their visit dates, and invoices, by `client_id`, newest first.
 *
 * What it never reads is as much the contract as what it does: no email, postal address, postcode,
 * access note or internal note column is selected, so the masked record of answers 46 and 47 holds
 * by construction; the free text it does read (a job description) is still passed through the
 * Service specialist's address and email mask before a model sees it. A quote carries no figure
 * here: a figure from a quote is only ever one line of the live quote, read by Quoting (answer 23).
 * An invoice is read only once it has gone to the customer (sent, paid or overdue): a draft is
 * Ben's and a void one is not a bill. Money is read and never written.
 *
 * The database reader opens the database the way the Scheduling diary does (scheduling/diary.ts):
 * the sandbox's reader only on the branch COMMS_V2_DATABASE_URL names, the live intake's only while
 * the new desk is the live desk. It calls server functions directly, never an admin route. A memory
 * reader stands in for tests; nothing here prints a value.
 */
import { assertCommsV2DatabaseFor, type DatabasePurpose } from '../live-database';
import { RECORD_READ_FIELD_PREFIX } from '../desk/case-file';
import type { CanonicalKey } from '../desk/identity';
import { bookingRowToDiary, branchInUse, formatDiaryDate, notStandingReason } from '../scheduling/diary';
import { pounds, statusOfRow, type QuoteStatus } from '../quoting/quote-record';

export interface KnownCustomer { customerId: string; name: string | null }

export interface RecordLead { id: string; status: string; summary: string | null; createdAt: string | null }
export interface RecordQuote { id: string; slug: string; status: QuoteStatus; summary: string | null; createdAt: string | null }
export interface RecordJob {
    id: string;
    quoteRef: string | null;
    /** 'pending' | 'accepted' | 'declined' | 'in_progress' | 'completed' | 'cancelled' */
    status: string;
    dayOfStatus: string | null;
    /** The days the visit occupies, ISO, through the diary's own span read. */
    scheduledDays: string[];
    completedAt: string | null;
    summary: string | null;
}
export interface RecordInvoiceLine { description: string; totalPence: number }
export interface RecordInvoice {
    id: string;
    number: string;
    /** 'sent' | 'paid' | 'overdue'; a draft or a void invoice is never read. */
    status: string;
    totalPence: number;
    depositPaidPence: number;
    balanceDuePence: number;
    lines: RecordInvoiceLine[];
    sentAt: string | null;
    dueAt: string | null;
    paidAt: string | null;
}

export interface CustomerRecord {
    customerId: string;
    name: string | null;
    leads: RecordLead[];
    quotes: RecordQuote[];
    jobs: RecordJob[];
    invoices: RecordInvoice[];
}

export interface CustomerRecordReader {
    /** Every client the key names; the caller binds only on exactly one. */
    knownCustomer(key: CanonicalKey): Promise<KnownCustomer[]>;
    /** One client's record, or null when there is no such client. */
    record(customerId: string): Promise<CustomerRecord | null>;
}

/** At most this many of each kind are read for one customer. */
export const RECORD_ROWS_LIMIT = 10;
/** At most this many lines of one invoice reach the model. */
export const INVOICE_LINES_LIMIT = 10;
/** The invoice statuses a customer has been sent; only these are read. */
export const INVOICE_STATUSES_READ: ReadonlySet<string> = new Set(['sent', 'paid', 'overdue']);

// ---------------------------------------------------------------- the record as items the model picks from

/** One fact an item carries: `attr` names it in the fact key and the source field. */
export interface ItemFact { attr: string; label: string; value: string }

/** One thing on the record the Service model can pick by `ref`, with the facts it would read back. */
export interface RecordItem { ref: string; kind: 'lead' | 'quote' | 'job' | 'invoice'; summary: string | null; facts: ItemFact[] }

const dayOf = (iso: string | null): string | null => (iso ? formatDiaryDate(iso.slice(0, 10)) : null);

const JOB_STATUS: Record<string, string> = {
    pending: 'booked, waiting for a tradesperson to take it on',
    accepted: 'booked',
    in_progress: 'in progress',
    completed: 'done',
    declined: 'cancelled',
    cancelled: 'cancelled',
};
const INVOICE_STATUS: Record<string, string> = { sent: 'sent, not yet paid', paid: 'paid', overdue: 'overdue, not yet paid' };
const QUOTE_STATUS: Record<QuoteStatus, string> = { draft: 'being prepared', sent: 'sent', accepted: 'accepted', revoked: 'withdrawn', superseded: 'replaced by a newer quote', expired: 'expired' };

function jobStatus(j: RecordJob): string {
    if (j.dayOfStatus === 'completed') return JOB_STATUS.completed;
    if (j.dayOfStatus === 'cancelled_day_of') return JOB_STATUS.cancelled;
    return JOB_STATUS[j.status] ?? j.status.replace(/_/g, ' ');
}

/**
 * The record as items, newest first within each kind: invoices, jobs, quotes, leads. Every value is
 * the row's own, formatted the way the guards read it (a figure as pounds and pence to the penny, a
 * date as the diary writes one); nothing is added up or worked out.
 */
export function recordItems(record: CustomerRecord, today: string): RecordItem[] {
    const items: RecordItem[] = [];
    for (const inv of record.invoices) {
        if (!INVOICE_STATUSES_READ.has(inv.status)) continue;
        const facts: ItemFact[] = [
            { attr: 'status', label: 'status', value: INVOICE_STATUS[inv.status] ?? inv.status },
            { attr: 'total', label: 'total', value: pounds(inv.totalPence) },
        ];
        if (inv.depositPaidPence > 0) facts.push({ attr: 'deposit_paid', label: 'deposit paid', value: pounds(inv.depositPaidPence) });
        // A paid invoice owes nothing; its stored balance is not read back beside "paid".
        if (inv.status !== 'paid') facts.push({ attr: 'balance_due', label: 'balance due', value: pounds(inv.balanceDuePence) });
        const sent = dayOf(inv.sentAt);
        if (sent) facts.push({ attr: 'sent_on', label: 'sent on', value: sent });
        const due = dayOf(inv.dueAt);
        if (due && inv.status !== 'paid') facts.push({ attr: 'due_on', label: 'due on', value: due });
        const paid = dayOf(inv.paidAt);
        if (paid && inv.status === 'paid') facts.push({ attr: 'paid_on', label: 'paid on', value: paid });
        inv.lines.slice(0, INVOICE_LINES_LIMIT).forEach((l, i) => facts.push({ attr: `line_${i + 1}`, label: `line "${l.description}"`, value: pounds(l.totalPence) }));
        items.push({ ref: `invoice:${inv.number}`, kind: 'invoice', summary: `invoice ${inv.number}`, facts });
    }
    for (const j of record.jobs) {
        const facts: ItemFact[] = [{ attr: 'status', label: 'status', value: jobStatus(j) }];
        const gone = notStandingReason({ id: j.id, quoteRef: j.quoteRef, scheduledDate: j.scheduledDays[0] ?? null, scheduledDays: j.scheduledDays, durationDays: Math.max(1, j.scheduledDays.length), status: j.status, assignmentStatus: null, dayOfStatus: j.dayOfStatus, createdAt: null, completedAt: j.completedAt }, today);
        // A cancelled visit's day is not a visit date: nobody is coming.
        if (j.scheduledDays.length && gone?.kind !== 'cancelled') facts.push({ attr: 'visit', label: j.scheduledDays.length > 1 ? 'visit days' : 'visit day', value: j.scheduledDays.map((d) => formatDiaryDate(d)).join(', ') });
        const done = dayOf(j.completedAt);
        if (done) facts.push({ attr: 'completed_on', label: 'completed on', value: done });
        items.push({ ref: `job:${j.id}`, kind: 'job', summary: j.summary, facts });
    }
    for (const q of record.quotes) {
        if (q.status === 'draft') continue;
        const facts: ItemFact[] = [{ attr: 'status', label: 'status', value: QUOTE_STATUS[q.status] }];
        const made = dayOf(q.createdAt);
        if (made) facts.push({ attr: 'made_on', label: 'made on', value: made });
        items.push({ ref: `quote:${q.slug}`, kind: 'quote', summary: q.summary, facts });
    }
    for (const l of record.leads) {
        const facts: ItemFact[] = [];
        const made = dayOf(l.createdAt);
        if (made) facts.push({ attr: 'enquired_on', label: 'enquired on', value: made });
        items.push({ ref: `lead:${l.id}`, kind: 'lead', summary: l.summary, facts });
    }
    return items;
}

/** The fact key and the customer-record source field an item's fact is written under. */
export function recordFactKey(item: RecordItem, fact: ItemFact): string {
    return `record:${item.ref}:${fact.attr}`;
}
export function recordSourceField(item: RecordItem, fact: ItemFact): string {
    return `${RECORD_READ_FIELD_PREFIX}${item.ref}:${fact.attr}`;
}

// ---------------------------------------------------------------- the invoice or receipt question

/**
 * A plain match for a question about an invoice, a receipt or a payment on the customer's own
 * record. The desk runs the Service specialist on such a turn for a customer the CRM knows, and a
 * money question of this shape is Service's to answer from the invoice row (desk/router.ts).
 */
export const RE_INVOICE_QUESTION = /\b(?:invoices?|receipts?|balance|owe|owing|outstanding|paid|payments?)\b/i;
/** Money words an invoice row cannot answer: a price to agree, a refund, a dispute. Those stay Ben's. */
export const RE_NOT_A_RECORD_READ = /\b(?:discount\w*|cheap\w*|deals?|refund\w*|knock\w*|reduc\w*|lower|less|wrong|overcharg\w*|dispute\w*|negotia\w*|budget|instal\w*|plan|quotes?|quoted)\b/i;

export function asksAboutInvoice(text: string): boolean {
    return RE_INVOICE_QUESTION.test(text);
}

/** A money question the invoice row may answer: it asks about an invoice or payment and nothing an invoice cannot settle. */
export function invoiceMoneyQuestion(text: string): boolean {
    return RE_INVOICE_QUESTION.test(text) && !RE_NOT_A_RECORD_READ.test(text);
}

// ---------------------------------------------------------------- readers

/** An in-memory record for tests and the door's memory fixture. */
export class MemoryCustomerRecords implements CustomerRecordReader {
    readonly clients: Array<{ customerId: string; name: string | null; keys: CanonicalKey[] }> = [];
    readonly records = new Map<string, Omit<CustomerRecord, 'customerId' | 'name'>>();
    /** Every read, for a test to assert on. */
    readonly reads: string[] = [];
    add(client: { customerId: string; name: string | null; keys: CanonicalKey[] }, record: Partial<Omit<CustomerRecord, 'customerId' | 'name'>> = {}): void {
        this.clients.push(client);
        this.records.set(client.customerId, { leads: [], quotes: [], jobs: [], invoices: [], ...record });
    }
    async knownCustomer(key: CanonicalKey): Promise<KnownCustomer[]> {
        this.reads.push(`known ${key}`);
        return this.clients.filter((c) => c.keys.includes(key)).map((c) => ({ customerId: c.customerId, name: c.name }));
    }
    async record(customerId: string): Promise<CustomerRecord | null> {
        this.reads.push(`record ${customerId}`);
        const client = this.clients.find((c) => c.customerId === customerId);
        const rec = this.records.get(customerId);
        return client && rec ? { customerId, name: client.name, ...rec } : null;
    }
}

const iso = (v: Date | string | null | undefined): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const pence = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/**
 * An invoice's stored line items, `{ description, total }` in pence (server/invoices.ts), into the
 * record's shape. A line with no description or no whole total is left out, and so is a property
 * header (a multi-property invoice's heading line), which names the address.
 */
export function invoiceLinesOf(raw: unknown): RecordInvoiceLine[] {
    if (!Array.isArray(raw)) return [];
    const out: RecordInvoiceLine[] = [];
    for (const item of raw) {
        if ((item as any)?.isPropertyHeader) continue;
        const description = text((item as any)?.description);
        const total = Number((item as any)?.total);
        if (description && Number.isInteger(total)) out.push({ description, totalPence: total });
    }
    return out;
}

const READER = 'the customer record read';

async function recordDatabase(purpose: DatabasePurpose): Promise<void> {
    if (purpose === 'sandbox') branchInUse();
    else await assertCommsV2DatabaseFor(READER, purpose);
}

/** The record through the database, for a purpose. Every call is a read, and every call asks again. */
export const databaseCustomerRecords = (purpose: DatabasePurpose): CustomerRecordReader => ({
    async knownCustomer(key) {
        await recordDatabase(purpose);
        const value = key.slice(key.indexOf(':') + 1);
        if (!value) return [];
        const { db } = await import('../../db');
        const { serviceClients: c } = await import('../../../shared/schema');
        const { and, eq, isNull, or, sql } = await import('drizzle-orm');
        const byContact = key.startsWith('phone:') ? eq(c.primaryPhone, value) : eq(sql`lower(trim(coalesce(${c.primaryEmail}, '')))`, value);
        const rows = await db.select({ id: c.id, name: c.displayName }).from(c)
            .where(and(isNull(c.archivedAt), or(eq(c.dedupeKey, key), byContact)))
            .limit(5);
        return rows.map((r) => ({ customerId: r.id, name: text(r.name) }));
    },
    async record(customerId) {
        await recordDatabase(purpose);
        const { db } = await import('../../db');
        const { serviceClients: c, leads: l, personalizedQuotes: q, contractorBookingRequests: b, invoices: i } = await import('../../../shared/schema');
        const { and, desc, eq, inArray, isNull } = await import('drizzle-orm');
        const [client] = await db.select({ id: c.id, name: c.displayName }).from(c).where(eq(c.id, customerId)).limit(1);
        if (!client) return null;
        const [leadRows, quoteRows, jobRows, invoiceRows] = await Promise.all([
            db.select({ id: l.id, status: l.status, jobSummary: l.jobSummary, jobDescription: l.jobDescription, createdAt: l.createdAt })
                .from(l).where(and(eq(l.clientId, customerId), isNull(l.mergedIntoId))).orderBy(desc(l.createdAt)).limit(RECORD_ROWS_LIMIT),
            db.select({ id: q.id, shortSlug: q.shortSlug, isDraft: q.isDraft, revokedAt: q.revokedAt, supersededAt: q.supersededAt, depositPaidAt: q.depositPaidAt, expiresAt: q.expiresAt, pricingSuggestions: q.pricingSuggestions, jobDescription: q.jobDescription, createdAt: q.createdAt })
                .from(q).where(eq(q.clientId, customerId)).orderBy(desc(q.createdAt)).limit(RECORD_ROWS_LIMIT),
            db.select({ id: b.id, quoteId: b.quoteId, scheduledDate: b.scheduledDate, scheduledDates: b.scheduledDates, durationDays: b.durationDays, status: b.status, assignmentStatus: b.assignmentStatus, dayOfStatus: b.dayOfStatus, createdAt: b.createdAt, completedAt: b.completedAt, description: b.description })
                .from(b).where(eq(b.clientId, customerId)).orderBy(desc(b.createdAt)).limit(RECORD_ROWS_LIMIT),
            db.select({ id: i.id, number: i.invoiceNumber, status: i.status, totalAmount: i.totalAmount, depositPaid: i.depositPaid, balanceDue: i.balanceDue, lineItems: i.lineItems, sentAt: i.sentAt, dueDate: i.dueDate, paidAt: i.paidAt })
                .from(i).where(and(eq(i.clientId, customerId), inArray(i.status, Array.from(INVOICE_STATUSES_READ)))).orderBy(desc(i.createdAt)).limit(RECORD_ROWS_LIMIT),
        ]);
        const now = new Date();
        return {
            customerId: client.id,
            name: text(client.name),
            leads: leadRows.map((r) => ({ id: r.id, status: r.status, summary: text(r.jobSummary) ?? text(r.jobDescription), createdAt: iso(r.createdAt) })),
            quotes: quoteRows.map((r) => ({ id: r.id, slug: r.shortSlug, status: statusOfRow(r, now), summary: text(r.jobDescription), createdAt: iso(r.createdAt) })),
            jobs: jobRows.map((r) => {
                const d = bookingRowToDiary(r);
                return { id: d.id, quoteRef: d.quoteRef, status: d.status, dayOfStatus: d.dayOfStatus, scheduledDays: d.scheduledDays, completedAt: d.completedAt, summary: text(r.description) };
            }),
            invoices: invoiceRows.map((r) => ({ id: r.id, number: r.number, status: r.status, totalPence: pence(r.totalAmount), depositPaidPence: pence(r.depositPaid), balanceDuePence: pence(r.balanceDue), lines: invoiceLinesOf(r.lineItems), sentAt: iso(r.sentAt), dueAt: iso(r.dueDate), paidAt: iso(r.paidAt) })),
        };
    },
});

/** The sandbox door's record: every read refuses anything but the branch COMMS_V2_DATABASE_URL names. */
export const liveCustomerRecords: CustomerRecordReader = databaseCustomerRecords('sandbox');
