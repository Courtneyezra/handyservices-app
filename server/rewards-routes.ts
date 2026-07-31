/**
 * Prize-wheel rewards — claim + redeem. A customer enters their email on the
 * post-payment reveal; we mint a code, record the reward (customer_rewards), and
 * email it with a book-now link. The record is the redemption source of truth:
 * ops / the quote builder look up unredeemed rewards by email.
 */
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { customerRewards } from '../shared/schema';
import { sendPrizeEmail } from './email-service';
import { getWhatsAppNumber } from './invoice-upsells';

const REWARD_TTL_DAYS = 60;
const rewardsRouter = Router();

function genCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `HANDY-${s}`;
}

// POST /api/rewards/claim — customer submits their email on the reveal to claim
// their prize; we record it and email it. Idempotent per (sourceType, sourceId).
rewardsRouter.post('/api/rewards/claim', async (req: Request, res: Response) => {
  try {
    const { prizeId, prizeTitle, prizeMessage, prizeTerms, customerName, email, customerPhone, sourceType, sourceId } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Please enter a valid email' });
    if (!prizeTitle || typeof prizeTitle !== 'string') return res.status(400).json({ error: 'prizeTitle required' });

    // One reward per source (invoice/job) — reuse if already claimed.
    let reward: any = null;
    if (sourceType && sourceId) {
      const [existing] = await db.select().from(customerRewards)
        .where(and(eq(customerRewards.sourceType, String(sourceType)), eq(customerRewards.sourceId, String(sourceId)))).limit(1);
      reward = existing ?? null;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + REWARD_TTL_DAYS * 86400000);

    if (!reward) {
      [reward] = await db.insert(customerRewards).values({
        id: uuidv4(), code: genCode(), prizeId: prizeId ?? null, prizeTitle: String(prizeTitle).slice(0, 160),
        customerName: customerName ?? null, customerEmail: cleanEmail, customerPhone: customerPhone ?? null,
        sourceType: sourceType ?? null, sourceId: sourceId ?? null, status: 'unredeemed', wonAt: now, expiresAt,
      }).returning();
    } else {
      await db.update(customerRewards).set({ customerEmail: cleanEmail }).where(eq(customerRewards.id, reward.id));
      reward.customerEmail = cleanEmail;
    }

    // Email the prize (best-effort — never block the claim on email).
    const num = getWhatsAppNumber();
    const bookText = encodeURIComponent(`Hi Handy — I'd like to book a job. My reward code is ${reward.code} (${reward.prizeTitle}).`);
    const bookUrl = `https://wa.me/${num}?text=${bookText}`;
    const emailRes = await sendPrizeEmail({
      customerName: reward.customerName || customerName || '',
      customerEmail: cleanEmail,
      prizeTitle: reward.prizeTitle,
      prizeMessage: typeof prizeMessage === 'string' ? prizeMessage : '',
      prizeTerms: typeof prizeTerms === 'string' ? prizeTerms : '',
      code: reward.code,
      expiresAt: reward.expiresAt ?? expiresAt,
      bookUrl,
    });
    if (emailRes.success) {
      await db.update(customerRewards).set({ emailedAt: new Date() }).where(eq(customerRewards.id, reward.id));
    }

    res.json({ success: true, code: reward.code, expiresAt: reward.expiresAt ?? expiresAt, bookUrl, emailed: emailRes.success });
  } catch (err: any) {
    console.error('[Rewards] claim failed:', err?.message);
    res.status(500).json({ error: 'Failed to claim reward' });
  }
});

export default rewardsRouter;
