/**
 * Quote follow-up alerts — internal Pushover nudge to chase unaccepted quotes.
 *
 * A quote qualifies when the customer has VIEWED it but the deposit still
 * isn't paid FOLLOW_UP_AFTER_MS after it was sent. One alert per quote
 * (dedup via personalizedQuotes.followupAlertSentAt).
 *
 * Deliberately independent of the lead-automations master toggle: that gate
 * protects against accidental CUSTOMER messaging, whereas this only pushes
 * to our own phones. Turn it on/off via the Notifications tab ("Chase" event).
 */

import { db } from './db';
import { personalizedQuotes } from '@shared/schema';
import { and, eq, gt, isNull, isNotNull, lt, notIlike, notLike } from 'drizzle-orm';
import { notifyQuoteFollowup, summarizeLineItems } from './pushover';

export const FOLLOW_UP_AFTER_MS = 24 * 60 * 60 * 1000; // alert 24h after quote sent
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // ignore quotes older than 7 days (stale, not a chase)
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_ALERTS_PER_SWEEP = 10;

export async function sweepQuoteFollowups(): Promise<number> {
    const now = Date.now();
    const cutoff = new Date(now - FOLLOW_UP_AFTER_MS);
    const lookback = new Date(now - LOOKBACK_MS);

    const stale = await db
        .select({
            id: personalizedQuotes.id,
            customerName: personalizedQuotes.customerName,
            phone: personalizedQuotes.phone,
            jobDescription: personalizedQuotes.jobDescription,
            pricingLineItems: personalizedQuotes.pricingLineItems,
            basePrice: personalizedQuotes.basePrice,
            createdAt: personalizedQuotes.createdAt,
            viewedAt: personalizedQuotes.viewedAt,
        })
        .from(personalizedQuotes)
        .where(
            and(
                isNotNull(personalizedQuotes.viewedAt), // customer engaged
                isNull(personalizedQuotes.depositPaidAt), // not accepted
                isNull(personalizedQuotes.bookedAt),
                isNull(personalizedQuotes.revokedAt),
                isNull(personalizedQuotes.followupAlertSentAt), // dedup: once per quote
                lt(personalizedQuotes.createdAt, cutoff),
                gt(personalizedQuotes.createdAt, lookback),
                isNotNull(personalizedQuotes.phone),
                // Keep synthetic/test quotes out of ops alerts
                notLike(personalizedQuotes.id, 'test_q_%'),
                notLike(personalizedQuotes.phone, '%7700900%'),
                notIlike(personalizedQuotes.customerName, 'test%'),
            ),
        )
        .limit(MAX_ALERTS_PER_SWEEP);

    let alerted = 0;
    for (const q of stale) {
        try {
            await notifyQuoteFollowup({
                customerName: q.customerName,
                phoneNumber: q.phone,
                jobSummary: summarizeLineItems(q.pricingLineItems) || q.jobDescription,
                valuePence: q.basePrice,
                hoursSinceSent: q.createdAt ? (now - q.createdAt.getTime()) / 3_600_000 : null,
                viewedAt: q.viewedAt,
            });
            await db.update(personalizedQuotes)
                .set({ followupAlertSentAt: new Date() })
                .where(eq(personalizedQuotes.id, q.id));
            alerted++;
        } catch (e) {
            console.warn(`[QuoteFollowup] alert failed for quote ${q.id}:`, e);
        }
    }
    if (alerted) console.log(`[QuoteFollowup] Sent ${alerted} follow-up alert(s)`);
    return alerted;
}

let sweepInterval: NodeJS.Timeout | null = null;

export function startQuoteFollowupSweep(): void {
    if (sweepInterval) return;
    sweepInterval = setInterval(() => {
        sweepQuoteFollowups().catch((e) => console.error('[QuoteFollowup] sweep error:', e));
    }, SWEEP_INTERVAL_MS);
    // First pass shortly after boot (let DB warm up)
    setTimeout(() => {
        sweepQuoteFollowups().catch((e) => console.error('[QuoteFollowup] initial sweep error:', e));
    }, 30_000);
    console.log('[QuoteFollowup] Sweep scheduled (every 15 min, alert after 24h unaccepted)');
}
