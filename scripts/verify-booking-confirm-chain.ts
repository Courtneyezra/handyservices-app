/**
 * End-to-end verification of the Phase-2 booking-confirm chain.
 *
 *   1. Pick a fresh test quote (one of the seed-fit ones) — or create one
 *   2. Reserve a slot via /api/public/booking/reserve-slot   → lockId
 *   3. Synthesize a payment_intent.succeeded event with metadata.lockId
 *   4. Sign it with STRIPE_WEBHOOK_SECRET (real Stripe-style signature)
 *   5. POST to /api/stripe/webhook
 *   6. Assert: contractorBookingRequests row exists, quote.bookedAt is set,
 *      jobSheet was generated, lock is gone, matrix shows the booking.
 *
 * Usage:
 *   BASE_URL=http://localhost:61015 npx tsx scripts/verify-booking-confirm-chain.ts
 */

import crypto from 'crypto';
import { db } from '../server/db';
import {
  personalizedQuotes,
  bookingSlotLocks,
  contractorBookingRequests,
  jobSheets,
  contractorAvailabilityDates,
} from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

const BASE = process.env.BASE_URL || 'http://localhost:61015';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.error('STRIPE_WEBHOOK_SECRET not set');
  process.exit(1);
}

function signStripeEvent(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function ymd(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function ensureBezentAvailableTomorrow(): Promise<{ contractorId: string; date: string; slot: 'am' }> {
  const BEZENT_ID = 'hp_15b5249f-b433-4f7f-b1d0-a8d462c95aac';
  // Walk forward to find a date where Bezent isn't already booked (skip Sun)
  let offsetDays = parseInt(process.env.OFFSET_DAYS || '1', 10);
  let date = ymd(offsetDays);
  while (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) {
    offsetDays += 1;
    date = ymd(offsetDays);
  }
  const dateDate = new Date(`${date}T00:00:00.000Z`);

  // Wipe any existing override for this date, insert AM
  await db.delete(contractorAvailabilityDates).where(
    and(
      eq(contractorAvailabilityDates.contractorId, BEZENT_ID),
      gte(contractorAvailabilityDates.date, dateDate),
      lte(contractorAvailabilityDates.date, new Date(`${date}T23:59:59.999Z`)),
    ),
  );
  await db.insert(contractorAvailabilityDates).values({
    id: `cad_verify_${Date.now()}`,
    contractorId: BEZENT_ID,
    date: dateDate,
    isAvailable: true,
    startTime: '08:00',
    endTime: '13:00',
  });
  console.log(`✓ Bezent set AM for ${date}`);
  return { contractorId: BEZENT_ID, date, slot: 'am' };
}

async function createTestQuote(): Promise<{ quoteId: string; shortSlug: string }> {
  const body = {
    customerName: 'Phase 2 Verify',
    phone: '07700900999',
    address: '14 Lenton Boulevard',
    postcode: 'NG7 2BY',
    coordinates: { lat: 52.9389, lng: -1.1789 },
    vaContext: 'Test quote for booking-confirm chain verification.',
    lines: [
      {
        id: `verify-line-${Date.now()}`,
        description: 'Mount 55-inch TV above living-room fireplace',
        category: 'tv_mounting',
        estimatedMinutes: 90,
      },
    ],
    signals: {},
    availableDates: [ymd(1), ymd(2), ymd(3)],
    createdByName: 'Phase 2 Verify',
  };
  const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to create quote: ${res.status} ${JSON.stringify(j)}`);
  }
  console.log(`✓ Created quote ${j.shortSlug} (${j.quoteId})`);
  return { quoteId: j.quoteId, shortSlug: j.shortSlug };
}

async function reserveSlot(quoteId: string, date: string, slot: 'am' | 'pm' | 'full_day') {
  const r = await fetch(`${BASE}/api/public/booking/reserve-slot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteId, scheduledDate: date, scheduledSlot: slot }),
  });
  const j = await r.json();
  if (!r.ok) {
    throw new Error(`reserveSlot failed: ${r.status} ${JSON.stringify(j)}`);
  }
  console.log(`✓ Reserved slot — lockId=${j.lockId}, contractor=${j.contractorName}, expiresAt=${j.expiresAt}`);
  return j as { lockId: number; contractorId: string; contractorName: string; expiresAt: string };
}

async function fireWebhook(quoteId: string, lockId: number, contractorId: string, date: string, slot: string) {
  const piId = `pi_test_verify_${Date.now()}`;
  const event = {
    id: `evt_test_${Date.now()}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'payment_intent.succeeded',
    livemode: false,
    data: {
      object: {
        id: piId,
        object: 'payment_intent',
        amount: 7500,
        amount_received: 7500,
        currency: 'gbp',
        status: 'succeeded',
        metadata: {
          quoteId,
          customerName: 'Phase 2 Verify',
          customerEmail: 'verify@phase2.test',
          paymentType: 'full',
          totalJobPrice: '7500',
          depositAmount: '7500',
          selectedExtras: '',
          lockId: String(lockId),
          contractorId,
          scheduledDate: date,
          scheduledSlot: slot,
        },
      },
    },
  };
  const payload = JSON.stringify(event);
  const sig = signStripeEvent(payload, WEBHOOK_SECRET!);

  const res = await fetch(`${BASE}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: payload,
  });
  const text = await res.text();
  console.log(`✓ Webhook returned ${res.status}: ${text.slice(0, 200)}`);
  return { status: res.status, body: text, piId };
}

async function assertDownstream(quoteId: string, lockId: number, contractorId: string, dateStr: string) {
  const issues: string[] = [];

  // 1. Lock should be gone
  const [lockRow] = await db.select().from(bookingSlotLocks).where(eq(bookingSlotLocks.id, lockId)).limit(1);
  if (lockRow) issues.push(`Lock ${lockId} still present (should be deleted by confirmBooking)`);
  else console.log('✓ Slot lock removed');

  // 2. contractorBookingRequests row should exist
  const dateDate = new Date(`${dateStr}T00:00:00.000Z`);
  const bookings = await db
    .select()
    .from(contractorBookingRequests)
    .where(
      and(
        eq(contractorBookingRequests.quoteId, quoteId),
        eq(contractorBookingRequests.scheduledDate, dateDate),
      ),
    );
  if (bookings.length === 0) issues.push('No contractorBookingRequests row created');
  else {
    const b = bookings[0];
    console.log(`✓ Booking row: id=${b.id}, status=${b.status}, assignmentStatus=${b.assignmentStatus}, slot=${b.scheduledSlot}, contractor=${b.assignedContractorId}`);
    if (b.assignmentStatus !== 'accepted') issues.push(`Booking assignmentStatus=${b.assignmentStatus} (expected accepted)`);
    if (b.assignedContractorId !== contractorId) issues.push(`Booking contractor=${b.assignedContractorId} (expected ${contractorId})`);
  }

  // 3. Quote should be marked booked
  const [quote] = await db
    .select({ bookedAt: personalizedQuotes.bookedAt, contractorId: personalizedQuotes.contractorId, selectedDate: personalizedQuotes.selectedDate, depositPaidAt: personalizedQuotes.depositPaidAt })
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.id, quoteId))
    .limit(1);
  if (!quote?.bookedAt) issues.push('quote.bookedAt is null');
  if (!quote?.contractorId) issues.push('quote.contractorId is null');
  if (!quote?.depositPaidAt) issues.push('quote.depositPaidAt is null');
  if (!issues.length) console.log(`✓ Quote marked booked: contractorId=${quote?.contractorId}, selectedDate=${quote?.selectedDate?.toISOString().slice(0, 10)}`);

  // 4. jobSheet should be generated
  const sheets = await db.select().from(jobSheets).where(eq(jobSheets.quoteId, quoteId));
  if (sheets.length === 0) issues.push('No jobSheet generated');
  else console.log(`✓ Job sheet generated: id=${sheets[0].id}, lineItems=${(sheets[0].lineItems as any[])?.length || 0}`);

  return issues;
}

async function main() {
  console.log('═══ Phase 2 booking-confirm chain verification ═══\n');

  const { contractorId, date, slot } = await ensureBezentAvailableTomorrow();
  const { quoteId, shortSlug } = await createTestQuote();
  const reservation = await reserveSlot(quoteId, date, slot);
  console.log(`(reservation contractor=${reservation.contractorId} expected=${contractorId})`);

  const webhookResp = await fireWebhook(quoteId, reservation.lockId, reservation.contractorId, date, slot);
  if (webhookResp.status !== 200) {
    console.error('❌ Webhook returned non-200 — aborting assertions');
    process.exit(1);
  }

  // Tiny wait for any async work
  await new Promise((r) => setTimeout(r, 800));

  const issues = await assertDownstream(quoteId, reservation.lockId, reservation.contractorId, date);

  console.log('\n═══ Summary ═══');
  console.log(`Quote URL: ${BASE.replace(/:\d+$/, ':5000')}/quote/${shortSlug}`);
  console.log(`(or local: ${BASE}/quote/${shortSlug})`);
  if (issues.length === 0) {
    console.log('✅ ALL ASSERTIONS PASSED');
    process.exit(0);
  } else {
    console.log('❌ FAILURES:');
    for (const i of issues) console.log('  - ' + i);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
