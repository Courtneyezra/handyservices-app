/**
 * The sandbox fixture for the customer record read (service/customer-record.ts), on the branch
 * database only: the door's drama customer made a known customer, with one enquiry and one invoice
 * sent and part paid, so a returning customer's invoice question can be driven end to end in dry
 * run. Opt-in and separate from the Goal 6 fixture (fixture.ts), because a known customer changes
 * what Service reads for every sandbox thread until the reset removes it.
 *
 * Every row carries a `sandbox-crm-` id and synthetic values: the drama number and a made-up name.
 * No email or postal address is written (the record read never selects one).
 * The client row is the drama number's own when one is already on the branch; only a client row the
 * fixture wrote is removed by the reset. A production database is refused before anything is
 * written, and so is any database that is not the branch COMMS_V2_DATABASE_URL names.
 */
import { branchInUse } from '../scheduling/diary';
import { pounds } from '../quoting/quote-record';

export const RECORD_FIXTURE = {
    clientId: 'sandbox-crm-client',
    leadId: 'sandbox-crm-lead',
    invoiceId: 'sandbox-crm-invoice',
    invoiceNumber: 'SANDBOX-INV-0001',
    name: 'Sam Sandbox',
    job: 'Hang two internal doors',
    totalPence: 12000,
    depositPence: 4000,
    balancePence: 8000,
} as const;

const DAY_MS = 86_400_000;

export interface RecordFixtureOutcome { clientId: string; clientAction: 'inserted' | 'kept existing'; leadId: string; invoiceNumber: string; balanceDue: string }

async function refuseUnlessBranch(): Promise<void> {
    const { isProductionDatabaseUrl } = await import('../../worker-gate');
    if (isProductionDatabaseUrl(process.env.DATABASE_URL)) throw new Error('the record fixture is refused on the production database');
    branchInUse();
}

/** Writes the fixture for a phone in its canonical national form; idempotent, and each run resets the invoice to sent and part paid. */
export async function applyRecordFixture(nationalPhone: string, now: Date = new Date()): Promise<RecordFixtureOutcome> {
    await refuseUnlessBranch();
    const { db } = await import('../../db');
    const { serviceClients: c, leads: l, invoices: i } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const key = `phone:${nationalPhone}`;
    const [existing] = await db.select({ id: c.id }).from(c).where(eq(c.dedupeKey, key)).limit(1);
    const clientId = existing?.id ?? RECORD_FIXTURE.clientId;
    if (!existing) await db.insert(c).values({ id: clientId, dedupeKey: key, displayName: RECORD_FIXTURE.name, primaryPhone: nationalPhone }).onConflictDoNothing();
    const lead = { customerName: RECORD_FIXTURE.name, phone: nationalPhone, jobDescription: RECORD_FIXTURE.job, jobSummary: RECORD_FIXTURE.job, status: 'converted', source: 'sandbox', clientId, createdAt: new Date(now.getTime() - 20 * DAY_MS) };
    await db.insert(l).values({ id: RECORD_FIXTURE.leadId, ...lead }).onConflictDoUpdate({ target: l.id, set: lead });
    const invoice = {
        invoiceNumber: RECORD_FIXTURE.invoiceNumber,
        customerName: RECORD_FIXTURE.name,
        customerPhone: nationalPhone,
        clientId,
        totalAmount: RECORD_FIXTURE.totalPence,
        depositPaid: RECORD_FIXTURE.depositPence,
        balanceDue: RECORD_FIXTURE.balancePence,
        lineItems: [{ description: RECORD_FIXTURE.job, quantity: 1, unitPrice: RECORD_FIXTURE.totalPence, total: RECORD_FIXTURE.totalPence }],
        status: 'sent',
        sentAt: new Date(now.getTime() - 3 * DAY_MS),
        dueDate: new Date(now.getTime() + 11 * DAY_MS),
        paidAt: null,
        updatedAt: now,
    };
    await db.insert(i).values({ id: RECORD_FIXTURE.invoiceId, ...invoice }).onConflictDoUpdate({ target: i.id, set: invoice });
    return { clientId, clientAction: existing ? 'kept existing' : 'inserted', leadId: RECORD_FIXTURE.leadId, invoiceNumber: RECORD_FIXTURE.invoiceNumber, balanceDue: pounds(RECORD_FIXTURE.balancePence) };
}

/** Removes the fixture's own rows: the invoice, the lead, and the client row only when the fixture wrote it and nothing else on the branch now points at it. */
export async function resetRecordFixture(): Promise<{ removed: string[]; kept: string[] }> {
    await refuseUnlessBranch();
    const { db } = await import('../../db');
    const { serviceClients: c, leads: l, invoices: i } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    await db.delete(i).where(eq(i.id, RECORD_FIXTURE.invoiceId));
    await db.delete(l).where(eq(l.id, RECORD_FIXTURE.leadId));
    try {
        await db.delete(c).where(eq(c.id, RECORD_FIXTURE.clientId));
    } catch {
        // A sandbox quote drafted since may carry the client: the row stays, and the drama number stays a known customer.
        return { removed: [RECORD_FIXTURE.invoiceId, RECORD_FIXTURE.leadId], kept: [RECORD_FIXTURE.clientId] };
    }
    return { removed: [RECORD_FIXTURE.invoiceId, RECORD_FIXTURE.leadId, RECORD_FIXTURE.clientId], kept: [] };
}
