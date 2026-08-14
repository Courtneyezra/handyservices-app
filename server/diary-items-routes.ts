/**
 * Contractor diary items — admin CRUD.
 *
 * Diary items are non-job entries in a contractor's day (first kind:
 * quote_visit — Craig visits a prospect to survey/quote). They occupy real
 * time so they must consume capacity everywhere jobs do, but they have NO
 * payout/deposit/completion ceremony.
 *
 * Mounted at /api/admin/diary-items behind requireAdmin (server/index.ts).
 *   POST   /                → create (contractorId defaults to Craig)
 *   GET    /?contractorId&from&to → list
 *   PATCH  /:id/status      → { status: 'open' | 'done' }
 *   DELETE /:id             → remove
 */
import { Router, Request, Response } from 'express';
import { and, eq, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { contractorDiaryItems } from '../shared/schema';

const router = Router();

// Craig — the first (and for now only) core contractor with an app.
const DEFAULT_CONTRACTOR_ID = 'hp_aa21264a-9143-4116-bda2-2da998255929';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;
const KINDS = new Set(['quote_visit']);
const SLOTS = new Set(['am', 'pm']);
const STATUSES = new Set(['open', 'done']);

// Pure-day column (pg `date`, drizzle mode:'date'): write UTC-midnight Dates,
// read back YYYY-MM-DD — same convention as contractor availability days.
const dayToDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
const dateToDay = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

export function diaryItemOut(row: typeof contractorDiaryItems.$inferSelect) {
  return {
    id: row.id,
    contractorId: row.contractorId,
    date: dateToDay(row.date as any),
    slot: row.slot,
    startTime: row.startTime ?? null,
    minutes: row.minutes,
    kind: row.kind,
    customerName: row.customerName,
    customerPhone: row.customerPhone ?? null,
    address: row.address ?? null,
    postcode: row.postcode ?? null,
    notes: row.notes ?? null,
    status: row.status,
  };
}

// POST / — create a diary item.
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const contractorId = typeof b.contractorId === 'string' && b.contractorId.trim()
      ? b.contractorId.trim() : DEFAULT_CONTRACTOR_ID;
    const date = typeof b.date === 'string' ? b.date : '';
    if (!ISO_DAY.test(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
    const slot = b.slot ?? 'am';
    if (!SLOTS.has(slot)) return res.status(400).json({ error: "slot must be 'am' or 'pm'" });
    const kind = b.kind ?? 'quote_visit';
    if (!KINDS.has(kind)) return res.status(400).json({ error: `Unknown kind '${kind}'` });
    const customerName = typeof b.customerName === 'string' ? b.customerName.trim() : '';
    if (!customerName) return res.status(400).json({ error: 'customerName required' });
    const minutes = b.minutes === undefined ? 45 : Number(b.minutes);
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 600) {
      return res.status(400).json({ error: 'minutes must be a positive integer (≤600)' });
    }
    const startTime = b.startTime ?? null;
    if (startTime !== null && !HHMM.test(startTime)) {
      return res.status(400).json({ error: "startTime must be 'HH:MM'" });
    }

    const [row] = await db.insert(contractorDiaryItems).values({
      id: `di_${uuidv4()}`,
      contractorId,
      date: dayToDate(date),
      slot,
      startTime,
      minutes,
      kind,
      customerName,
      customerPhone: b.customerPhone ?? null,
      address: b.address ?? null,
      postcode: b.postcode ?? null,
      notes: b.notes ?? null,
      status: 'open',
    }).returning();

    res.json({ item: diaryItemOut(row) });
  } catch (err: any) {
    console.error('[DiaryItems] create failed:', err?.message);
    res.status(500).json({ error: 'Failed to create diary item' });
  }
});

// GET / — list, optionally filtered by contractor and day range.
router.get('/', async (req: Request, res: Response) => {
  try {
    const { contractorId, from, to } = req.query as Record<string, string | undefined>;
    if (from && !ISO_DAY.test(from)) return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
    if (to && !ISO_DAY.test(to)) return res.status(400).json({ error: 'to must be YYYY-MM-DD' });

    const conds = [];
    if (contractorId) conds.push(eq(contractorDiaryItems.contractorId, contractorId));
    if (from) conds.push(gte(contractorDiaryItems.date, dayToDate(from)));
    if (to) conds.push(lte(contractorDiaryItems.date, dayToDate(to)));

    const rows = await db.select().from(contractorDiaryItems)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(contractorDiaryItems.date);
    res.json({ items: rows.map(diaryItemOut) });
  } catch (err: any) {
    console.error('[DiaryItems] list failed:', err?.message);
    res.status(500).json({ error: 'Failed to list diary items' });
  }
});

// PATCH /:id/status — { status: 'open' | 'done' }.
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const status = req.body?.status;
    if (!STATUSES.has(status)) return res.status(400).json({ error: "status must be 'open' or 'done'" });
    const [row] = await db.update(contractorDiaryItems)
      .set({ status, updatedAt: new Date() })
      .where(eq(contractorDiaryItems.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ error: 'Diary item not found' });
    res.json({ item: diaryItemOut(row) });
  } catch (err: any) {
    console.error('[DiaryItems] status failed:', err?.message);
    res.status(500).json({ error: 'Failed to update diary item' });
  }
});

// DELETE /:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [row] = await db.delete(contractorDiaryItems)
      .where(eq(contractorDiaryItems.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ error: 'Diary item not found' });
    res.json({ ok: true, id: row.id });
  } catch (err: any) {
    console.error('[DiaryItems] delete failed:', err?.message);
    res.status(500).json({ error: 'Failed to delete diary item' });
  }
});

export default router;
