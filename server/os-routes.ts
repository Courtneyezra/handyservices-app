/**
 * Admin OS — Pipeline + Send workspaces data.
 *   GET /api/admin/os/pipeline → lead → quote → job → invoice buckets
 *   GET /api/admin/os/send     → quotes ready to send + conversations to progress
 * Behind requireAdmin (mounted in index.ts). Shaping is pure + unit-tested
 * (server/lib/os-summary.ts); this file is the DB glue only.
 */
import { Router, Request, Response } from 'express';
import { and, desc, eq, isNull, isNotNull, ne, sql, inArray } from 'drizzle-orm';
import { db } from './db';
import { leads, personalizedQuotes, contractorBookingRequests } from '../shared/schema';
import { buildPipeline, buildSend, type OsItem, type StageInput } from './lib/os-summary';

const LIMIT = 6;
const count = sql<number>`count(*)::int`;
const snippet = (s: string | null | undefined, n = 40) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : '');

const router = Router();

router.get('/pipeline', async (_req: Request, res: Response) => {
  try {
    const [leadCount, leadRows, quoteCount, quoteRows, jobCount, jobRows, invCount, invRows] = await Promise.all([
      db.select({ c: count }).from(leads).where(ne(leads.status, 'lost')),
      db.select({ id: leads.id, name: leads.customerName, desc: leads.jobDescription, postcode: leads.postcode }).from(leads).where(ne(leads.status, 'lost')).orderBy(desc(leads.createdAt)).limit(LIMIT),
      db.select({ c: count }).from(personalizedQuotes).where(and(isNull(personalizedQuotes.depositPaidAt), isNull(personalizedQuotes.bookedAt))),
      db.select({ id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName }).from(personalizedQuotes).where(and(isNull(personalizedQuotes.depositPaidAt), isNull(personalizedQuotes.bookedAt))).orderBy(desc(personalizedQuotes.createdAt)).limit(LIMIT),
      db.select({ c: count }).from(contractorBookingRequests).where(inArray(contractorBookingRequests.status, ['pending', 'accepted'])),
      db.select({ id: contractorBookingRequests.id, name: contractorBookingRequests.customerName, date: contractorBookingRequests.scheduledDate, slot: contractorBookingRequests.scheduledSlot }).from(contractorBookingRequests).where(inArray(contractorBookingRequests.status, ['pending', 'accepted'])).orderBy(desc(contractorBookingRequests.scheduledDate)).limit(LIMIT),
      db.select({ c: count }).from(personalizedQuotes).where(isNotNull(personalizedQuotes.depositPaidAt)),
      db.select({ id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName }).from(personalizedQuotes).where(isNotNull(personalizedQuotes.depositPaidAt)).orderBy(desc(personalizedQuotes.depositPaidAt)).limit(LIMIT),
    ]);

    const buckets: Record<'leads' | 'quotes' | 'jobs' | 'invoiced', StageInput> = {
      leads: { count: Number(leadCount[0]?.c ?? 0), items: leadRows.map((r): OsItem => ({ id: r.id, title: r.name || 'Lead', subtitle: [snippet(r.desc), r.postcode].filter(Boolean).join(' · ') })) },
      quotes: { count: Number(quoteCount[0]?.c ?? 0), items: quoteRows.map((r): OsItem => ({ id: r.id, title: r.name || 'Quote', subtitle: r.slug || '' })) },
      jobs: { count: Number(jobCount[0]?.c ?? 0), items: jobRows.map((r): OsItem => ({ id: r.id, title: r.name || 'Job', subtitle: [r.date ? new Date(r.date).toLocaleDateString('en-GB') : '', r.slot].filter(Boolean).join(' · ') })) },
      invoiced: { count: Number(invCount[0]?.c ?? 0), items: invRows.map((r): OsItem => ({ id: r.id, title: r.name || 'Invoice', subtitle: r.slug || 'paid' })) },
    };

    return res.json(buildPipeline(buckets));
  } catch (err: any) {
    console.error('[OS/pipeline] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load pipeline', details: err?.message });
  }
});

router.get('/send', async (_req: Request, res: Response) => {
  try {
    const [readyRows, threadRows] = await Promise.all([
      db.select({ id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, name: personalizedQuotes.customerName, status: personalizedQuotes.status })
        .from(personalizedQuotes).where(and(isNull(personalizedQuotes.depositPaidAt), isNull(personalizedQuotes.bookedAt)))
        .orderBy(desc(personalizedQuotes.createdAt)).limit(8),
      db.select({ id: leads.id, name: leads.customerName, desc: leads.jobDescription, status: leads.status })
        .from(leads).where(inArray(leads.status, ['new', 'contacted', 'awaiting_video', 'quote_sent']))
        .orderBy(desc(leads.createdAt)).limit(8),
    ]);

    const readyToSend: OsItem[] = readyRows.map((r) => ({ id: r.id, title: r.name || 'Quote', subtitle: [r.slug, r.status].filter(Boolean).join(' · ') }));
    const threads: OsItem[] = threadRows.map((r) => ({ id: r.id, title: r.name || 'Lead', subtitle: [snippet(r.desc), r.status].filter(Boolean).join(' · ') }));

    return res.json(buildSend(readyToSend, threads));
  } catch (err: any) {
    console.error('[OS/send] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load send', details: err?.message });
  }
});

export default router;
