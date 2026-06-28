import { Router } from 'express';
import { db } from './db';
import {
    leads,
    personalizedQuotes,
    contractorBookingRequests,
    invoices,
    contractorPayouts,
} from '../shared/schema';
import { inArray } from 'drizzle-orm';

// ==========================================
// CLIENT AGGREGATION (READ-ONLY)
// ==========================================
//
// Jobber-style "Client" view. There is NO clients/customers table — this
// router stitches the existing spine tables together at read time so the
// frontend can show one customer's entire engagement across every stage:
//
//   leads -> personalized_quotes -> contractor_booking_requests (jobs)
//         -> invoices -> contractor_payouts
//
// ZERO schema change. No INSERT/UPDATE/DELETE anywhere in this file.
//
// Client identity is a heuristic. Every spine table carries customer
// name/phone/email (under slightly different column names), so we derive a
// stable "client key" from the contact details:
//   - phone: strip all non-digit characters; empty => no phone key
//   - email: trim + lowercase; empty => no email key
//   - clientKey: prefer phone when present ("phone:<digits>"), else email
//     ("email:<lowercased>"). Rows with neither are skipped (cannot group).
//
// This is deliberately simple — it validates the concept before we invest
// in a real `clients` table with proper identity resolution.

export const clientAggregationRouter = Router();

// --- normalization helpers ---

function normPhone(raw?: string | null): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    return digits.length > 0 ? digits : null;
}

function normEmail(raw?: string | null): string | null {
    if (!raw) return null;
    const e = raw.trim().toLowerCase();
    return e.length > 0 ? e : null;
}

// Build the composite client key. Prefer phone, fall back to email.
function clientKeyFor(phone?: string | null, email?: string | null): string | null {
    const p = normPhone(phone);
    if (p) return `phone:${p}`;
    const e = normEmail(email);
    if (e) return `email:${e}`;
    return null;
}

// Compare a row to a target client key. A row matches if EITHER its phone OR
// its email resolves to the same key form. (A row keyed on phone won't match
// an email key and vice-versa — keeps grouping deterministic.)
function rowMatchesKey(
    targetKey: string,
    phone?: string | null,
    email?: string | null,
): boolean {
    const p = normPhone(phone);
    if (p && `phone:${p}` === targetKey) return true;
    const e = normEmail(email);
    if (e && `email:${e}` === targetKey) return true;
    return false;
}

// --- types for the aggregated summary ---

interface ClientSummary {
    clientKey: string;
    displayName: string | null;
    phone: string | null;
    email: string | null;
    counts: { leads: number; quotes: number; jobs: number; invoices: number };
    latestActivityAt: string | null;
    // internal: latest timestamp as Date for sorting / "most recent name" wins
    _latestTs: number;
    _nameTs: number;
}

function maxTs(a: number, current: Date | null | undefined): number {
    if (!current) return a;
    const t = new Date(current).getTime();
    return Number.isFinite(t) && t > a ? t : a;
}

// GET /api/clients
// List of distinct clients with summary counts + latest activity.
// Optional ?search= filters on name/phone/email (case-insensitive substring).
clientAggregationRouter.get('/api/clients', async (req, res) => {
    try {
        const search = typeof req.query.search === 'string'
            ? req.query.search.trim().toLowerCase()
            : '';

        // Pull the minimal columns we need from each spine table.
        const [leadRows, quoteRows, jobRows, invoiceRows] = await Promise.all([
            db.select({
                customerName: leads.customerName,
                phone: leads.phone,
                email: leads.email,
                createdAt: leads.createdAt,
                stageUpdatedAt: leads.stageUpdatedAt,
            }).from(leads),
            db.select({
                customerName: personalizedQuotes.customerName,
                phone: personalizedQuotes.phone,
                email: personalizedQuotes.email,
                createdAt: personalizedQuotes.createdAt,
                depositPaidAt: personalizedQuotes.depositPaidAt,
                completedAt: personalizedQuotes.completedAt,
            }).from(personalizedQuotes),
            db.select({
                customerName: contractorBookingRequests.customerName,
                customerPhone: contractorBookingRequests.customerPhone,
                customerEmail: contractorBookingRequests.customerEmail,
                createdAt: contractorBookingRequests.createdAt,
                scheduledDate: contractorBookingRequests.scheduledDate,
                completedAt: contractorBookingRequests.completedAt,
            }).from(contractorBookingRequests),
            db.select({
                customerName: invoices.customerName,
                customerPhone: invoices.customerPhone,
                customerEmail: invoices.customerEmail,
                createdAt: invoices.createdAt,
                paidAt: invoices.paidAt,
            }).from(invoices),
        ]);

        const byKey = new Map<string, ClientSummary>();

        function ensure(key: string): ClientSummary {
            let c = byKey.get(key);
            if (!c) {
                c = {
                    clientKey: key,
                    displayName: null,
                    phone: null,
                    email: null,
                    counts: { leads: 0, quotes: 0, jobs: 0, invoices: 0 },
                    latestActivityAt: null,
                    _latestTs: 0,
                    _nameTs: -1,
                };
                byKey.set(key, c);
            }
            return c;
        }

        // Record a contact's name/phone/email, keeping the most recent non-empty
        // name (by the supplied activity timestamp).
        function record(
            c: ClientSummary,
            name: string | null | undefined,
            phone: string | null | undefined,
            email: string | null | undefined,
            activityTs: number,
        ): void {
            const p = normPhone(phone);
            const e = normEmail(email);
            if (p && !c.phone) c.phone = p;
            if (e && !c.email) c.email = e;
            const trimmedName = name?.trim();
            if (trimmedName && activityTs >= c._nameTs) {
                c.displayName = trimmedName;
                c._nameTs = activityTs;
            }
            c._latestTs = Math.max(c._latestTs, activityTs);
        }

        for (const r of leadRows) {
            const key = clientKeyFor(r.phone, r.email);
            if (!key) continue;
            const c = ensure(key);
            c.counts.leads += 1;
            let ts = maxTs(0, r.createdAt);
            ts = maxTs(ts, r.stageUpdatedAt);
            record(c, r.customerName, r.phone, r.email, ts);
        }

        for (const r of quoteRows) {
            const key = clientKeyFor(r.phone, r.email);
            if (!key) continue;
            const c = ensure(key);
            c.counts.quotes += 1;
            let ts = maxTs(0, r.createdAt);
            ts = maxTs(ts, r.depositPaidAt);
            ts = maxTs(ts, r.completedAt);
            record(c, r.customerName, r.phone, r.email, ts);
        }

        for (const r of jobRows) {
            const key = clientKeyFor(r.customerPhone, r.customerEmail);
            if (!key) continue;
            const c = ensure(key);
            c.counts.jobs += 1;
            let ts = maxTs(0, r.createdAt);
            ts = maxTs(ts, r.scheduledDate);
            ts = maxTs(ts, r.completedAt);
            record(c, r.customerName, r.customerPhone, r.customerEmail, ts);
        }

        for (const r of invoiceRows) {
            const key = clientKeyFor(r.customerPhone, r.customerEmail);
            if (!key) continue;
            const c = ensure(key);
            c.counts.invoices += 1;
            let ts = maxTs(0, r.createdAt);
            ts = maxTs(ts, r.paidAt);
            record(c, r.customerName, r.customerPhone, r.customerEmail, ts);
        }

        let clients = Array.from(byKey.values());

        if (search) {
            clients = clients.filter((c) =>
                (c.displayName?.toLowerCase().includes(search) ?? false) ||
                (c.phone?.toLowerCase().includes(search) ?? false) ||
                (c.email?.toLowerCase().includes(search) ?? false) ||
                c.clientKey.toLowerCase().includes(search)
            );
        }

        // Most recently active first.
        clients.sort((a, b) => b._latestTs - a._latestTs);

        const payload = clients.map((c) => ({
            clientKey: c.clientKey,
            displayName: c.displayName,
            phone: c.phone,
            email: c.email,
            counts: c.counts,
            latestActivityAt: c._latestTs > 0 ? new Date(c._latestTs).toISOString() : null,
        }));

        res.json({ clients: payload, total: payload.length });
    } catch (error: any) {
        console.error('[Client Aggregation] Error listing clients:', error);
        res.status(500).json({ error: error.message || 'Failed to list clients' });
    }
});

// GET /api/clients/:clientKey
// Full engagement for one client: leads, quotes, jobs, invoices, payouts.
// Matching strategy:
//   - leads/quotes/jobs/invoices: matched directly on normalized contact key
//   - jobs/invoices/payouts are ALSO pulled by following FKs from the matched
//     quotes (quote_id / quoteId) so the chain is visible even if a downstream
//     row's denormalized contact details drifted.
clientAggregationRouter.get('/api/clients/:clientKey', async (req, res) => {
    try {
        const targetKey = req.params.clientKey;
        if (!targetKey || (!targetKey.startsWith('phone:') && !targetKey.startsWith('email:'))) {
            return res.status(400).json({
                error: "Invalid clientKey. Expected 'phone:<digits>' or 'email:<lowercased>'.",
            });
        }

        // Pull full rows from the four denormalized-contact tables, filter in JS.
        const [allLeads, allQuotes, allJobs, allInvoices] = await Promise.all([
            db.select().from(leads),
            db.select().from(personalizedQuotes),
            db.select().from(contractorBookingRequests),
            db.select().from(invoices),
        ]);

        const clientLeads = allLeads.filter((r) => rowMatchesKey(targetKey, r.phone, r.email));
        const clientQuotes = allQuotes.filter((r) => rowMatchesKey(targetKey, r.phone, r.email));

        const quoteIds = clientQuotes.map((q) => q.id);
        const quoteIdSet = new Set(quoteIds);

        // Jobs: direct contact match OR linked via quote_id.
        const clientJobs = allJobs.filter((r) =>
            rowMatchesKey(targetKey, r.customerPhone, r.customerEmail) ||
            (r.quoteId != null && quoteIdSet.has(r.quoteId))
        );

        // Invoices: direct contact match OR linked via quoteId.
        const clientInvoices = allInvoices.filter((r) =>
            rowMatchesKey(targetKey, r.customerPhone, r.customerEmail) ||
            (r.quoteId != null && quoteIdSet.has(r.quoteId))
        );

        // Payouts have no customer contact fields — reach them via FK only:
        // quote_id (from this client's quotes) or job_id (from this client's jobs).
        const jobIds = clientJobs.map((j) => j.id);
        const fkValues = Array.from(new Set([...quoteIds, ...jobIds]));

        let clientPayouts: typeof contractorPayouts.$inferSelect[] = [];
        if (fkValues.length > 0) {
            const jobIdSet = new Set(jobIds);
            const payoutRows = await db.select().from(contractorPayouts).where(
                quoteIds.length > 0
                    ? inArray(contractorPayouts.quoteId, quoteIds)
                    : inArray(contractorPayouts.jobId, jobIds)
            );
            // The where above covers quote-linked payouts (or job-linked when no
            // quotes). Fold in any remaining job-linked payouts for completeness.
            const seen = new Set(payoutRows.map((p) => p.id));
            clientPayouts = [...payoutRows];
            if (quoteIds.length > 0 && jobIds.length > 0) {
                const extra = await db.select().from(contractorPayouts)
                    .where(inArray(contractorPayouts.jobId, jobIds));
                for (const p of extra) {
                    if (!seen.has(p.id) && (p.jobId != null && jobIdSet.has(p.jobId))) {
                        seen.add(p.id);
                        clientPayouts.push(p);
                    }
                }
            }
        }

        if (
            clientLeads.length === 0 &&
            clientQuotes.length === 0 &&
            clientJobs.length === 0 &&
            clientInvoices.length === 0 &&
            clientPayouts.length === 0
        ) {
            return res.status(404).json({ error: 'No engagement found for this client key' });
        }

        // Derive a display name (most recent non-empty across all sources).
        let displayName: string | null = null;
        let displayPhone: string | null = null;
        let displayEmail: string | null = null;
        if (clientQuotes[0]) {
            displayName = clientQuotes[0].customerName ?? null;
            displayPhone = normPhone(clientQuotes[0].phone);
            displayEmail = normEmail(clientQuotes[0].email);
        } else if (clientLeads[0]) {
            displayName = clientLeads[0].customerName ?? null;
            displayPhone = normPhone(clientLeads[0].phone);
            displayEmail = normEmail(clientLeads[0].email);
        } else if (clientJobs[0]) {
            displayName = clientJobs[0].customerName ?? null;
            displayPhone = normPhone(clientJobs[0].customerPhone);
            displayEmail = normEmail(clientJobs[0].customerEmail);
        } else if (clientInvoices[0]) {
            displayName = clientInvoices[0].customerName ?? null;
            displayPhone = normPhone(clientInvoices[0].customerPhone);
            displayEmail = normEmail(clientInvoices[0].customerEmail);
        }

        res.json({
            clientKey: targetKey,
            displayName,
            phone: displayPhone,
            email: displayEmail,
            counts: {
                leads: clientLeads.length,
                quotes: clientQuotes.length,
                jobs: clientJobs.length,
                invoices: clientInvoices.length,
                payouts: clientPayouts.length,
            },
            // Linking ids surfaced so the frontend can render the chain/timeline.
            leads: clientLeads,
            quotes: clientQuotes,
            jobs: clientJobs,       // each carries quoteId + invoiceId
            invoices: clientInvoices, // each carries quoteId
            payouts: clientPayouts,   // each carries quoteId + jobId + invoiceId
        });
    } catch (error: any) {
        console.error('[Client Aggregation] Error fetching client engagement:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch client engagement' });
    }
});

export default clientAggregationRouter;
