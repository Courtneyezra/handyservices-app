/**
 * Customer slot-offer service — the confirmation handshake BEFORE a contractor is assigned
 * to a flexible job (see shared/slot-offer.ts for the lifecycle + safety rules).
 *
 * Read/writes the personalized_quotes.slot_offer JSONB blob. The dispatcher sends a set of
 * dispatch-approved dates (recommended = keeps the flex discount, others = forfeit it); the
 * customer self-selects on a tokenised page; on confirm we assignFromPool (firm booking).
 *
 * This module owns the STATE MACHINE + candidate generation + the FREE confirm path. The
 * PREMIUM (Stripe) path is split: pickSlot returns { requiresPayment, premiumPence } for a
 * deviation, the Stripe route creates a Checkout Session + calls setOfferStripeSession, and
 * the payment webhook calls confirmPaidPick to assign. Nothing here charges a card.
 */
import { db } from './db';
import { sql } from 'drizzle-orm';
import * as crypto from 'crypto';
import { computeFlexDiscountPence } from './lane-pricing';
import { assignFromPool } from './booking-engine';
import {
  loadDispatchContext, haversine, ymd, computeSlack, jobValuePence, type DispatchContext,
} from './dispatch-sweep';
import type { SlotType } from '../shared/slot-times';
import type {
  SlotOffer, SlotCandidate, OfferSlot, ActiveSlotOffer,
} from '../shared/slot-offer';

const rows = (r: any): any[] => r.rows ?? r;
const nowIso = () => new Date().toISOString();
/** How many premium alternative dates to offer alongside the recommended one. */
const MAX_ALTERNATIVES = 3;
/** Window we'll scan for alternative dates (caps the optimiser's window). */
const ALT_WINDOW_DAYS = 21;
/** Deviation surcharges layered ON TOP of the forfeited flex discount for genuinely costly
 *  alternative dates — mirrors the client BASE_SCHEDULING_RULES (SchedulingConfig.ts:
 *  weekendFee / nextDayFee, both £25). A plain alternative weekday is just the forfeit. */
const WEEKEND_FEE_PENCE = 2500;
const NEXT_DAY_FEE_PENCE = 2500;

// ── Quote row helper ───────────────────────────────────────────────────────────

interface QuoteForOffer {
  id: string;
  customerName: string;
  basePrice: number;
  valuePence: number;
  categories: string[];
  lat: number | null;
  lng: number | null;
  postcode: string | null;
  address: string | null;
  jobDescription: string | null;
  flexDeadline: string;
  slackDays: number;
  slotOffer: SlotOffer | null;
}

async function loadQuoteForOffer(quoteId: string, today: Date): Promise<QuoteForOffer | null> {
  const r = await db.execute(sql`
    SELECT id, customer_name, base_price, pricing_line_items, coordinates,
           postcode, address, job_description, deposit_paid_at, flex_booking_within_days, slot_offer
    FROM personalized_quotes WHERE id = ${quoteId} LIMIT 1;`);
  const q = rows(r)[0];
  if (!q) return null;
  const lineItems = (q.pricing_line_items || []) as Array<{ category?: string }>;
  const categories = [...new Set(lineItems.map((li) => li.category).filter(Boolean))] as string[];
  const coords = (q.coordinates || null) as { lat?: number; lng?: number } | null;
  const lat = coords?.lat != null && Number.isFinite(Number(coords.lat)) ? Number(coords.lat) : null;
  const lng = coords?.lng != null && Number.isFinite(Number(coords.lng)) ? Number(coords.lng) : null;
  const { flexDeadline, slackDays } = computeSlack(q, today);
  return {
    id: q.id,
    customerName: q.customer_name,
    basePrice: Number(q.base_price) || 0,
    valuePence: jobValuePence(q),
    categories,
    lat, lng,
    postcode: q.postcode ?? null,
    address: q.address ?? null,
    jobDescription: q.job_description ?? null,
    flexDeadline, slackDays,
    slotOffer: (q.slot_offer || null) as SlotOffer | null,
  };
}

async function writeSlotOffer(quoteId: string, offer: SlotOffer | null): Promise<void> {
  await db.execute(sql`
    UPDATE personalized_quotes SET slot_offer = ${offer ? JSON.stringify(offer) : null}::jsonb
    WHERE id = ${quoteId};`);
}

// ── Alternative-slot generation ──────────────────────────────────────────────────

/**
 * Feasible alternative (date, slot, contractor) options for a job, EXCLUDING the
 * recommended date and anything the customer already declined. Reuses the canonical
 * dispatch context (same skills/availability/booking model as the optimiser) so an offered
 * date is one we can actually deliver. Earliest-first, one per date, capped at MAX.
 */
async function computeAlternativeSlots(
  q: QuoteForOffer,
  ctx: DispatchContext,
  excludeDates: Set<string>,
): Promise<Array<{ date: string; slot: OfferSlot; contractorId: string; contractorName: string }>> {
  if (!q.categories.length) return [];
  const { today, contractors, skillsByCon, isAvailable, bookedSlots } = ctx;

  // Qualified (covers ALL categories) + in service radius — same gate as the optimiser.
  const skilled = contractors.filter((c) => {
    const sk = skillsByCon.get(c.id);
    return sk && q.categories.every((cat) => sk.has(cat));
  });
  const inRange = skilled.filter((c) =>
    (q.lat == null || q.lng == null || c.lat == null || c.lng == null)
      ? true
      : haversine(q.lat, q.lng, c.lat, c.lng) <= c.radius,
  );
  if (!inRange.length) return [];

  const out: Array<{ date: string; slot: OfferSlot; contractorId: string; contractorName: string }> = [];
  const usedDates = new Set<string>(excludeDates);
  for (let i = 1; i <= ALT_WINDOW_DAYS && out.length < MAX_ALTERNATIVES; i++) {
    const dt = new Date(today); dt.setUTCDate(dt.getUTCDate() + i);
    const d = ymd(dt);
    if (usedDates.has(d)) continue;
    const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay();
    let picked: { contractorId: string; contractorName: string; slot: OfferSlot } | null = null;
    for (const slot of ['am', 'pm'] as const) {
      const free = inRange.find((c) => isAvailable(c.id, d, dow, slot as SlotType) && !bookedSlots.has(`${c.id}|${d}|${slot}`));
      if (free) { picked = { contractorId: free.id, contractorName: free.name, slot }; break; }
    }
    if (picked) {
      out.push({ date: d, slot: picked.slot, contractorId: picked.contractorId, contractorName: picked.contractorName });
      usedDates.add(d);
    }
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────────

export interface CreateOfferInput {
  quoteId: string;
  /** The optimiser's pick (from the console proposal the dispatcher is sending). */
  recommended: { date: string; slot: OfferSlot; contractorId: string; contractorName: string };
}

/**
 * Build + persist a fresh slot offer for a quote: recommended slot (free, keeps the flex
 * discount) + up to MAX_ALTERNATIVES feasible alternative dates (each forfeits the discount,
 * premium = computeFlexDiscountPence(basePrice)). Mints a token and sets status 'sent'.
 * Re-sending after a decline carries the prior declines forward so they're not re-offered.
 */
export async function createSlotOffer(input: CreateOfferInput): Promise<SlotOffer> {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const q = await loadQuoteForOffer(input.quoteId, today);
  if (!q) throw new Error('Quote not found');

  const ctx = await loadDispatchContext(ALT_WINDOW_DAYS + 1);
  // Don't re-offer the recommended date or anything previously declined.
  const declinedDates = new Set<string>((q.slotOffer?.declines ?? []).flatMap((d) => d.shownDates));
  const excludeDates = new Set<string>([input.recommended.date, ...declinedDates]);
  const alts = await computeAlternativeSlots(q, ctx, excludeDates);

  // Hybrid premium: the flat forfeited flex discount (the discount they'd lose by deviating)
  // PLUS weekend / next-day surcharges for costly dates. Recommended slot stays free.
  const forfeitPence = computeFlexDiscountPence(q.basePrice);
  const tomorrow = new Date(today); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = ymd(tomorrow);
  const candidates: SlotCandidate[] = [
    { ...input.recommended, premiumPence: 0, recommended: true, note: null },
    ...alts.map((a): SlotCandidate => {
      const dow = new Date(`${a.date}T12:00:00.000Z`).getUTCDay();
      const isWeekend = dow === 0 || dow === 6;
      const isNextDay = a.date === tomorrowStr;
      const premiumPence = forfeitPence
        + (isWeekend ? WEEKEND_FEE_PENCE : 0)
        + (isNextDay ? NEXT_DAY_FEE_PENCE : 0);
      // Note explains the surcharge (display-only; the page CSS-capitalises it).
      const note = isWeekend ? 'weekend' : isNextDay ? 'next day' : (a.date < input.recommended.date ? 'sooner' : null);
      return { ...a, premiumPence, recommended: false, note };
    }),
  ];

  const prior = q.slotOffer;
  const offer: SlotOffer = {
    status: 'sent',
    token: crypto.randomBytes(24).toString('base64url'),
    candidates,
    picked: null,
    premiumPence: null,
    stripeSessionId: null,
    paidAt: null,
    declines: prior?.declines ?? [],
    sentAt: prior?.sentAt ?? nowIso(),
    updatedAt: nowIso(),
    confirmedAt: null,
  };
  await writeSlotOffer(input.quoteId, offer);
  return offer;
}

/** Customer-page payload: the offer + quote display fields, by token. Null if not found. */
export async function getOfferByToken(token: string): Promise<{
  quoteId: string; customerName: string; jobDescription: string | null;
  postcode: string | null; address: string | null; categories: string[]; offer: SlotOffer;
} | null> {
  const r = await db.execute(sql`
    SELECT id, customer_name, job_description, postcode, address, pricing_line_items, slot_offer
    FROM personalized_quotes WHERE slot_offer->>'token' = ${token} LIMIT 1;`);
  const q = rows(r)[0];
  if (!q || !q.slot_offer) return null;
  const lineItems = (q.pricing_line_items || []) as Array<{ category?: string }>;
  const categories = [...new Set(lineItems.map((li) => li.category).filter(Boolean))] as string[];
  return {
    quoteId: q.id, customerName: q.customer_name, jobDescription: q.job_description ?? null,
    postcode: q.postcode ?? null, address: q.address ?? null, categories,
    offer: q.slot_offer as SlotOffer,
  };
}

export type PickResult =
  | { ok: true; confirmed: true; bookingId?: string }                       // free slot → assigned
  | { ok: true; requiresPayment: true; premiumPence: number; quoteId: string } // premium → Stripe
  | { ok: false; error: string };

/**
 * Customer picks a candidate slot (by token + date + slot).
 *  - recommended (premium 0) → assignFromPool immediately → status 'confirmed'.
 *  - premium → record the pick (pending payment), return requiresPayment so the Stripe route
 *    can open a Checkout Session for premiumPence. Assignment happens in confirmPaidPick.
 */
export async function pickSlot(token: string, date: string, slot: OfferSlot): Promise<PickResult> {
  const found = await getOfferByToken(token);
  if (!found) return { ok: false, error: 'Offer not found or expired' };
  const { quoteId, offer } = found;
  if (offer.status === 'confirmed') return { ok: false, error: 'This booking is already confirmed' };
  const cand = offer.candidates.find((c) => c.date === date && c.slot === slot);
  if (!cand) return { ok: false, error: 'That slot is not on the offer' };

  if (cand.premiumPence === 0) {
    const res = await assignFromPool({ quoteId, contractorId: cand.contractorId, date, slot });
    if (!res.success) return { ok: false, error: res.error || 'Could not book that slot — it may have just been taken' };
    const confirmed: SlotOffer = {
      ...offer, status: 'confirmed',
      picked: { date, slot, contractorId: cand.contractorId, contractorName: cand.contractorName },
      premiumPence: 0, paidAt: null, updatedAt: nowIso(), confirmedAt: nowIso(),
    };
    await writeSlotOffer(quoteId, confirmed);
    return { ok: true, confirmed: true, bookingId: res.bookingId };
  }

  // Premium: stage the pick, await payment.
  const staged: SlotOffer = {
    ...offer,
    picked: { date, slot, contractorId: cand.contractorId, contractorName: cand.contractorName },
    premiumPence: cand.premiumPence, updatedAt: nowIso(),
  };
  await writeSlotOffer(quoteId, staged);
  return { ok: true, requiresPayment: true, premiumPence: cand.premiumPence, quoteId };
}

/** Record the Stripe Checkout Session id for a staged premium pick (called by the route). */
export async function setOfferStripeSession(quoteId: string, sessionId: string): Promise<void> {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const q = await loadQuoteForOffer(quoteId, today);
  if (!q?.slotOffer) return;
  await writeSlotOffer(quoteId, { ...q.slotOffer, stripeSessionId: sessionId, updatedAt: nowIso() });
}

/**
 * Finalise a PAID premium pick (called by the Stripe webhook on checkout success): assign the
 * staged contractor + mark the offer confirmed. Idempotent (no-op if already confirmed).
 */
export async function confirmPaidPick(quoteId: string): Promise<{ ok: boolean; bookingId?: string; error?: string }> {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const q = await loadQuoteForOffer(quoteId, today);
  const offer = q?.slotOffer;
  if (!offer) return { ok: false, error: 'No active offer' };
  if (offer.status === 'confirmed') return { ok: true }; // already done
  if (!offer.picked) return { ok: false, error: 'No staged pick to confirm' };
  const { date, slot, contractorId } = offer.picked;
  const res = await assignFromPool({ quoteId, contractorId, date, slot: slot as OfferSlot });
  if (!res.success) return { ok: false, error: res.error || 'Assignment failed after payment' };
  await writeSlotOffer(quoteId, { ...offer, status: 'confirmed', paidAt: nowIso(), updatedAt: nowIso(), confirmedAt: nowIso() });
  return { ok: true, bookingId: res.bookingId };
}

/** Customer says "none of these work" → record the decline (so those dates aren't re-offered)
 *  and flag for the dispatcher to send a fresh set. */
export async function declineAll(token: string, reason: string | null): Promise<{ ok: boolean; error?: string }> {
  const found = await getOfferByToken(token);
  if (!found) return { ok: false, error: 'Offer not found' };
  const { quoteId, offer } = found;
  if (offer.status === 'confirmed') return { ok: false, error: 'Already confirmed' };
  const declined: SlotOffer = {
    ...offer, status: 'declined_all', updatedAt: nowIso(),
    declines: [...offer.declines, { at: nowIso(), reason, shownDates: offer.candidates.map((c) => c.date) }],
  };
  await writeSlotOffer(quoteId, declined);
  return { ok: true };
}

/** Clear a quote's offer entirely (abandon → back to the fresh dispatch pool). */
export async function abandonOffer(quoteId: string): Promise<void> {
  await writeSlotOffer(quoteId, null);
}

/** Active offers (sent / declined_all) for the console "Awaiting customer" section, newest
 *  update first, each enriched with display fields + SLA slack. */
export async function getActiveSlotOffers(): Promise<ActiveSlotOffer[]> {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const r = await db.execute(sql`
    SELECT id, customer_name, base_price, pricing_line_items, coordinates, postcode, address,
           job_description, deposit_paid_at, flex_booking_within_days, slot_offer
    FROM personalized_quotes
    WHERE slot_offer IS NOT NULL AND slot_offer->>'status' IN ('sent','declined_all')
    ORDER BY (slot_offer->>'updatedAt') DESC NULLS LAST LIMIT 200;`);
  return rows(r).map((q: any): ActiveSlotOffer => {
    const lineItems = (q.pricing_line_items || []) as Array<{ category?: string }>;
    const categories = [...new Set(lineItems.map((li) => li.category).filter(Boolean))] as string[];
    const { flexDeadline, slackDays } = computeSlack(q, today);
    return {
      quoteId: q.id,
      customerName: q.customer_name,
      valuePence: jobValuePence(q),
      postcode: q.postcode ?? null,
      address: q.address ?? null,
      jobDescription: q.job_description ?? null,
      categories,
      flexDeadline, slackDays,
      offer: q.slot_offer as SlotOffer,
    };
  });
}
