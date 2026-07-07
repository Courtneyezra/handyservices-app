import 'dotenv/config';
import Stripe from 'stripe';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNotNull, desc } from 'drizzle-orm';

// READ-ONLY. Reverse-calculate what each paid booker ELECTED (flex vs pick-a-date)
// for a given London calendar day. `flexBookingWithinDays` was never written
// server-side before the Phase-25 durability fix, so flex must be INFERRED from
// the date-side signals that ARE persisted, then corroborated against the PI's
// Stripe metadata (which likewise never carried flex pre-fix, so it mainly tells
// us whether a specific slot/lock was reserved — i.e. a date pick).
const TARGET = process.argv[2] || '2026-06-01'; // yyyy-mm-dd, London calendar day
const FETCH = parseInt(process.argv[3] || '120', 10);

const stripeKey = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
const stripe = stripeKey.startsWith('sk_') ? new Stripe(stripeKey) : null;

function londonDate(d?: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }); // dd/mm/yyyy
}
function londonDateTime(d?: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false });
}
function gbp(p?: number | null) { return p == null ? '—' : '£' + (p / 100).toFixed(2); }
function toUkDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

async function main() {
  const rows = await db.select().from(personalizedQuotes)
    .where(isNotNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(FETCH);

  const targetUk = toUkDay(TARGET);
  const yday = rows.filter((q) => londonDate(q.depositPaidAt) === targetUk);

  console.log(`\nFetched ${rows.length} most-recent PAID quotes.`);
  if (rows.length) {
    console.log(`Data range (London): ${londonDateTime(rows[rows.length - 1].depositPaidAt)}  →  ${londonDateTime(rows[0].depositPaidAt)}`);
  }
  console.log(`Stripe cross-check: ${stripe ? 'ENABLED' : 'DISABLED (no STRIPE_SECRET_KEY)'}`);
  console.log(`Target day: ${TARGET} (UK ${targetUk}) → ${yday.length} paid booking(s)\n`);

  if (!yday.length) {
    console.log('No paid bookings on the target day. Adjacent days present in the fetched set:');
    const days = Array.from(new Set(rows.map((q) => londonDate(q.depositPaidAt)))).slice(0, 10);
    days.forEach((d) => console.log(`   ${d}  (${rows.filter((q) => londonDate(q.depositPaidAt) === d).length})`));
    console.log('\nRe-run for another day, e.g.:  npx tsx scripts/_yesterday-elections.ts 2026-05-31');
    process.exit(0);
  }

  let nFlex = 0, nPick = 0, nUncertain = 0;

  for (const [i, q] of yday.entries()) {
    const cs = (q as any).contextSignals || {};
    const customerType = cs.customerType || q.segment || 'unknown';
    const isHomeowner = customerType === 'homeowner';

    const hasDate = q.selectedDate != null;
    const avail = Array.isArray(q.availableDates) ? (q.availableDates as any[]) : [];
    const hasAvail = avail.length > 0;
    const hasTimeSlot = q.timeSlotType != null;
    const hasSchedTier = q.schedulingTier != null;
    const flexPersisted = q.flexBookingWithinDays != null; // post-fix only

    // ── DB-signal verdict ────────────────────────────────────────────────
    let verdict: string, confidence: string, why: string;
    if (flexPersisted) {
      verdict = 'FLEX'; confidence = 'CERTAIN'; why = `flexBookingWithinDays=${q.flexBookingWithinDays} persisted (post-fix)`;
      nFlex++;
    } else if (hasDate) {
      verdict = 'PICK-DATE'; confidence = 'CERTAIN';
      why = `selectedDate=${londonDate(q.selectedDate)}${hasTimeSlot ? `, slot=${q.timeSlotType}` : ''}`;
      nPick++;
    } else if (isHomeowner && !hasAvail && !hasTimeSlot && !hasSchedTier) {
      verdict = 'FLEX'; confidence = 'INFERRED-HIGH';
      why = 'homeowner (flex default-ON) + no date / availableDates / slot / tier persisted';
      nFlex++;
    } else if (!hasAvail && !hasTimeSlot && !hasSchedTier) {
      verdict = 'FLEX?'; confidence = 'INFERRED-LOW';
      why = `${customerType} (flex NOT default-on) but zero date signals — likely flex opt-in or abandoned date`;
      nUncertain++;
    } else {
      verdict = 'UNCERTAIN'; confidence = 'LOW';
      why = `mixed: date=${hasDate} avail=${avail.length} slot=${hasTimeSlot} tier=${hasSchedTier}`;
      nUncertain++;
    }

    // ── Stripe cross-check ───────────────────────────────────────────────
    let stripeNote = q.stripePaymentIntentId ? '(unfetched)' : 'no PI id on quote';
    if (stripe && q.stripePaymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(q.stripePaymentIntentId);
        const m = pi.metadata || {};
        const hasSchedMeta = !!(m.scheduledDate || m.scheduledSlot);
        const hasLockMeta = !!m.lockId;
        const hasFlexMeta = m.flexBookingWithinDays != null;
        const parts: string[] = [`charged ${gbp(pi.amount_received ?? pi.amount)}`];
        if (hasFlexMeta) parts.push(`meta.flex=${m.flexBookingWithinDays}`);
        if (hasSchedMeta) parts.push(`meta.sched=${m.scheduledDate || '-'}/${m.scheduledSlot || '-'}`);
        if (hasLockMeta) parts.push(`meta.lockId=${m.lockId}`);
        if (!hasSchedMeta && !hasLockMeta && !hasFlexMeta) parts.push('no slot/lock/flex in metadata → consistent w/ FLEX');
        stripeNote = parts.join(', ');
        if (!hasDate && hasSchedMeta) stripeNote += '  ⚠️ DB has NO date but Stripe metadata DOES (conflict)';
        if (hasDate && !hasSchedMeta && !hasLockMeta) stripeNote += '  ⚠️ DB has date but Stripe metadata has no slot/lock';
      } catch (e: any) {
        stripeNote = `PI fetch failed: ${e.message}`;
      }
    }

    console.log(`${String(i + 1).padStart(2)}. ${q.shortSlug}  ${londonDateTime(q.depositPaidAt)}`);
    console.log(`    customer : ${q.customerName}  type=${customerType}  seg=${q.segment}  pay=${q.paymentType || '?'}  base=${gbp(q.basePrice)} dep=${gbp(q.depositAmountPence)}`);
    console.log(`    signals  : date=${hasDate} avail=${avail.length} slot=${q.timeSlotType ?? '-'} tier=${q.schedulingTier ?? '-'} bookedAt=${!!q.bookedAt} matchedCtr=${!!q.matchedContractorId} flexCol=${q.flexBookingWithinDays ?? '-'}`);
    console.log(`    VERDICT  : ${verdict} (${confidence}) — ${why}`);
    console.log(`    Stripe   : ${stripeNote}`);
    console.log('');
  }

  console.log('─'.repeat(72));
  console.log(`TOTALS for ${TARGET}: FLEX=${nFlex}  PICK-DATE=${nPick}  UNCERTAIN=${nUncertain}  (of ${yday.length})`);
  console.log('\nLegend: CERTAIN=read from DB/Stripe directly · INFERRED-HIGH=homeowner flex-default + zero date signals · INFERRED-LOW/UNCERTAIN=needs eyeballing');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
