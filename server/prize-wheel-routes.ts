/**
 * Prize-wheel odds config — admin-editable weights per customer-type group,
 * stored DDL-free in app_settings under `prize_wheel.weights`.
 * Shape: { homeowner: { sliceId: weight }, landlord: {...}, business: {...} }.
 * The slice sets themselves live in the client config; only the odds are stored.
 */
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { appSettings } from '../shared/schema';
import { requireAdmin } from './auth';

const KEY = 'prize_wheel.weights';
const prizeWheelRouter = Router();

// Public read — consumed by the invoice pay page + contractor completion wheel.
prizeWheelRouter.get('/api/prize-wheel-weights', async (_req: Request, res: Response) => {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    res.json({ weights: row?.value ?? {} });
  } catch (err: any) {
    console.error('[PrizeWheel] read weights failed:', err?.message);
    res.json({ weights: {} }); // never break the wheel — fall back to defaults client-side
  }
});

// Admin write — save the edited odds.
prizeWheelRouter.post('/api/admin/prize-wheel-weights', requireAdmin, async (req: Request, res: Response) => {
  try {
    const weights = req.body?.weights;
    if (!weights || typeof weights !== 'object') return res.status(400).json({ error: 'weights object required' });
    // sanitise: only non-negative finite numbers survive
    const clean: Record<string, Record<string, number>> = {};
    for (const [group, slices] of Object.entries(weights)) {
      if (!slices || typeof slices !== 'object') continue;
      clean[group] = {};
      for (const [sliceId, w] of Object.entries(slices as Record<string, unknown>)) {
        const n = Number(w);
        if (Number.isFinite(n) && n >= 0) clean[group][sliceId] = Math.round(n);
      }
    }
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    if (existing) {
      await db.update(appSettings).set({ value: clean, updatedAt: new Date() }).where(eq(appSettings.key, KEY));
    } else {
      await db.insert(appSettings).values({ id: uuidv4(), key: KEY, value: clean, description: 'Prize-wheel odds per customer-type group' });
    }
    res.json({ success: true, weights: clean });
  } catch (err: any) {
    console.error('[PrizeWheel] save weights failed:', err?.message);
    res.status(500).json({ error: 'Failed to save weights' });
  }
});

export default prizeWheelRouter;
