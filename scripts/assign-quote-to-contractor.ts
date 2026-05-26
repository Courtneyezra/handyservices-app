/**
 * Manually tag an accepted quote to a contractor — for testing that
 * jobs flow correctly to a contractor's calendar and that already-booked
 * slots are excluded from new contextual quotes.
 *
 * Mirrors what confirmBooking() does in the booking engine, minus the
 * slot-lock step (since these quotes predate the soft-hold flow).
 *
 * Usage:
 *   # Show all accepted-but-unassigned quotes
 *   npx tsx scripts/assign-quote-to-contractor.ts --list
 *
 *   # Show all contractors with their IDs
 *   npx tsx scripts/assign-quote-to-contractor.ts --contractors
 *
 *   # Tag a quote
 *   npx tsx scripts/assign-quote-to-contractor.ts \
 *     --quote=q2zotp1l \
 *     --contractor=hp_15b5249f-b433-4f7f-b1d0-a8d462c95aac \
 *     --date=2026-05-28 \
 *     --slot=am
 *
 *   # Tag + verify (show what the contractor's calendar API + matrix returns)
 *   npx tsx scripts/assign-quote-to-contractor.ts \
 *     --quote=q2zotp1l --contractor=Bezent --date=2026-05-28 --slot=am --verify
 *
 * Production use:
 *   DATABASE_URL='postgresql://...' npx tsx scripts/assign-quote-to-contractor.ts ...
 *
 * --contractor accepts EITHER a profile id (hp_...) or a name fragment (case-insensitive).
 * --slot must be one of: am | pm | full_day
 */

import { db } from '../server/db';
import {
  personalizedQuotes,
  contractorBookingRequests,
  jobSheets,
  handymanProfiles,
  users,
  contractorAvailabilityDates,
} from '../shared/schema';
import { eq, and, or, isNotNull, isNull, desc, inArray, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// ─── arg parsing ─────────────────────────────────────────────────
const args: Record<string, string | true> = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const [k, v] = a.slice(2).split('=');
  args[k] = v === undefined ? true : v;
}

const MODE_LIST = !!args.list;
const MODE_CONTRACTORS = !!args.contractors;
const VERIFY = !!args.verify;
const FORCE = !!args.force;

// ─── helpers ─────────────────────────────────────────────────────
async function listUnassignedAccepted() {
  const rows = await db
    .select({
      id: personalizedQuotes.id,
      shortSlug: personalizedQuotes.shortSlug,
      customerName: personalizedQuotes.customerName,
      postcode: personalizedQuotes.postcode,
      selectedDate: personalizedQuotes.selectedDate,
      timeSlotType: personalizedQuotes.timeSlotType,
      basePrice: personalizedQuotes.basePrice,
      depositPaidAt: personalizedQuotes.depositPaidAt,
      bookedAt: personalizedQuotes.bookedAt,
      contractorId: personalizedQuotes.contractorId,
      pricingLineItems: personalizedQuotes.pricingLineItems,
    })
    .from(personalizedQuotes)
    .where(
      and(
        isNotNull(personalizedQuotes.depositPaidAt),
        isNull(personalizedQuotes.contractorId),
      ),
    )
    .orderBy(desc(personalizedQuotes.depositPaidAt))
    .limit(40);

  console.log(`\n${rows.length} accepted-but-unassigned quote(s):\n`);
  console.log('  slug      date        slot     price   customer                lines');
  console.log('  ────────  ──────────  ───────  ──────  ──────────────────────  ─────');
  for (const q of rows) {
    const date = q.selectedDate?.toISOString().slice(0, 10) || '—';
    const slot = q.timeSlotType || '—';
    const price = q.basePrice ? `£${(q.basePrice / 100).toFixed(0)}` : '—';
    const lineCount = Array.isArray(q.pricingLineItems) ? q.pricingLineItems.length : 0;
    console.log(`  ${q.shortSlug.padEnd(8)}  ${date.padEnd(10)}  ${slot.padEnd(7)}  ${price.padStart(6)}  ${(q.customerName || '?').slice(0, 22).padEnd(22)}  ${lineCount}`);
  }
}

async function listContractors() {
  const rows = await db
    .select({
      id: handymanProfiles.id,
      firstName: users.firstName,
      lastName: users.lastName,
      postcode: handymanProfiles.postcode,
    })
    .from(handymanProfiles)
    .innerJoin(users, eq(handymanProfiles.userId, users.id))
    .orderBy(users.firstName);

  console.log(`\n${rows.length} contractor(s):\n`);
  for (const c of rows) {
    const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
    console.log(`  ${c.id.padEnd(40)}  ${name.padEnd(22)}  ${c.postcode || '—'}`);
  }
}

async function resolveContractor(needle: string): Promise<{ id: string; name: string } | null> {
  // Try as ID first
  const byId = await db
    .select({ id: handymanProfiles.id, firstName: users.firstName, lastName: users.lastName })
    .from(handymanProfiles)
    .innerJoin(users, eq(handymanProfiles.userId, users.id))
    .where(eq(handymanProfiles.id, needle))
    .limit(1);
  if (byId.length) {
    return { id: byId[0].id, name: `${byId[0].firstName || ''} ${byId[0].lastName || ''}`.trim() };
  }
  // Otherwise match against first name (case-insensitive contains)
  const all = await db
    .select({ id: handymanProfiles.id, firstName: users.firstName, lastName: users.lastName })
    .from(handymanProfiles)
    .innerJoin(users, eq(handymanProfiles.userId, users.id));
  const lower = needle.toLowerCase();
  const matches = all.filter((c) => `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase().includes(lower));
  if (matches.length === 1) {
    return { id: matches[0].id, name: `${matches[0].firstName || ''} ${matches[0].lastName || ''}`.trim() };
  }
  if (matches.length > 1) {
    console.error(`Multiple contractors match "${needle}":`, matches.map((m) => `${m.firstName} ${m.lastName} (${m.id})`));
  }
  return null;
}

async function assign(quoteSlug: string, contractorId: string, contractorName: string, dateStr: string, slot: 'am' | 'pm' | 'full_day', force: boolean = false) {
  // Fetch quote
  const [quote] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, quoteSlug))
    .limit(1);
  if (!quote) {
    console.error(`❌ Quote ${quoteSlug} not found`);
    process.exit(1);
  }
  if (quote.contractorId) {
    console.error(`❌ Quote ${quoteSlug} is already assigned to contractor ${quote.contractorId}`);
    process.exit(1);
  }

  const scheduledDate = new Date(`${dateStr}T00:00:00.000Z`);

  // Conflict check: does this contractor already have a booking on this date that conflicts?
  const conflictingSlots = slot === 'am' ? ['am', 'full_day'] : slot === 'pm' ? ['pm', 'full_day'] : ['am', 'pm', 'full_day'];
  const existing = await db
    .select({ id: contractorBookingRequests.id, scheduledSlot: contractorBookingRequests.scheduledSlot, customerName: contractorBookingRequests.customerName })
    .from(contractorBookingRequests)
    .where(
      and(
        or(eq(contractorBookingRequests.contractorId, contractorId), eq(contractorBookingRequests.assignedContractorId, contractorId)),
        eq(contractorBookingRequests.scheduledDate, scheduledDate),
        eq(contractorBookingRequests.status, 'accepted'),
      ),
    );
  const conflict = existing.find((b) => conflictingSlots.includes(b.scheduledSlot || ''));
  if (conflict) {
    console.error(`❌ Contractor already has a booking on ${dateStr} ${conflict.scheduledSlot} (${conflict.customerName})`);
    process.exit(1);
  }

  // Build jobSheet line items from the quote
  const quoteLineItems = (quote.pricingLineItems as any[]) || [];
  const jobSheetLineItems = quoteLineItems.map((item: any) => ({
    description: item.description || item.label || 'Task',
    categorySlug: item.categorySlug || item.category || null,
    estimatedMinutes: item.estimatedMinutes || item.durationMins || item.timeEstimateMinutes || null,
    pricePence: item.pricePence || item.customerPricePence || 0,
    contractorRatePence: item.contractorRatePence || 0,
    materialsRequired: item.materialsRequired || [],
    status: 'pending',
  }));

  // Travel-aware capacity check (matches what reserveSlot enforces for
  // customer flow). --force bypasses this; useful when dispatch knows the
  // contractor can absorb the overrun (e.g. they live in the postcode area).
  // Uses per-category caps from shared/scheduling-caps.ts so an inflated
  // line item (e.g. waste_removal at 240min "for pricing") doesn't unfairly
  // block scheduling.
  const { sumLineItemsForScheduling } = await import('../shared/scheduling-caps');
  const jobDurationMinutes = sumLineItemsForScheduling(quoteLineItems);
  if (jobDurationMinutes > 0) {
    const { SLOT_CAPACITY_MIN } = await import('../shared/slot-times');
    const { getTravelTimeMinutes } = await import('../server/lib/travel-time');
    const { geocodeAddress } = await import('../server/lib/geocoding');
    let customerCoords = (quote.coordinates as any) || null;
    if (!customerCoords && quote.postcode) {
      try {
        const geo = await geocodeAddress(quote.postcode);
        if (geo) customerCoords = { lat: geo.lat, lng: geo.lng };
      } catch { /* ignore */ }
    }
    const [profile] = await db
      .select({ lat: handymanProfiles.latitude, lng: handymanProfiles.longitude })
      .from(handymanProfiles)
      .where(eq(handymanProfiles.id, contractorId))
      .limit(1);
    if (customerCoords && profile?.lat && profile?.lng) {
      const cLat = parseFloat(profile.lat);
      const cLng = parseFloat(profile.lng);
      const travel = await getTravelTimeMinutes(cLat, cLng, customerCoords.lat, customerCoords.lng);
      const slotCap = SLOT_CAPACITY_MIN[slot];
      const required = jobDurationMinutes + travel.minutes;
      console.log(`   Travel: ${travel.minutes}min (${travel.source}) · job: ${jobDurationMinutes}min · total: ${required}min · slot cap: ${slotCap}min`);
      if (required > slotCap) {
        if (force) {
          console.warn(`   ⚠ Total (${required}min) exceeds ${slot} cap (${slotCap}min) — proceeding because --force`);
        } else {
          console.error(`   ❌ Total (${required}min) exceeds ${slot} cap (${slotCap}min). Re-run with --force to override, or pick full_day.`);
          process.exit(1);
        }
      }
    }
  }

  // Transaction: create booking + jobSheet + update quote
  await db.transaction(async (tx) => {
    const bookingId = uuidv4();
    await tx.insert(contractorBookingRequests).values({
      id: bookingId,
      contractorId,
      assignedContractorId: contractorId,
      customerName: quote.customerName,
      customerEmail: quote.email || undefined,
      customerPhone: quote.phone,
      quoteId: quote.id,
      requestedDate: scheduledDate,
      requestedSlot: slot,
      description: quote.jobDescription || '',
      status: 'accepted',
      scheduledDate,
      scheduledSlot: slot,
      assignmentStatus: 'accepted',
      assignedAt: new Date(),
      acceptedAt: new Date(),
    });

    await tx.insert(jobSheets).values({
      jobId: bookingId,
      quoteId: quote.id,
      lineItems: jobSheetLineItems as any,
      accessInstructions: (quote as any).customerAccessNotes || null,
      generatedAt: new Date(),
    });

    await tx
      .update(personalizedQuotes)
      .set({
        bookedAt: quote.bookedAt || new Date(),
        contractorId,
        bookingLockedAt: new Date(),
        selectedDate: scheduledDate,
        timeSlotType: slot === 'full_day' ? 'full_day' : slot,
      })
      .where(eq(personalizedQuotes.id, quote.id));
  });

  console.log(`✅ Assigned quote ${quoteSlug} (${quote.customerName}) → ${contractorName} on ${dateStr} ${slot}`);
  console.log(`   - jobSheet with ${jobSheetLineItems.length} line item(s) generated`);
  console.log(`   - quote.contractorId, bookedAt, selectedDate, timeSlotType set`);

  return { contractorId, scheduledDate, slot };
}

async function verify(contractorId: string, contractorName: string, scheduledDate: Date, slot: 'am' | 'pm' | 'full_day') {
  console.log(`\n─── Verification ───`);

  // 1. Booking row exists & is the only one for this contractor+date+slot
  const bookings = await db
    .select()
    .from(contractorBookingRequests)
    .where(
      and(
        or(eq(contractorBookingRequests.contractorId, contractorId), eq(contractorBookingRequests.assignedContractorId, contractorId)),
        eq(contractorBookingRequests.scheduledDate, scheduledDate),
      ),
    );
  console.log(`  ▸ Bookings for ${contractorName} on ${scheduledDate.toISOString().slice(0, 10)}: ${bookings.length}`);
  for (const b of bookings) console.log(`      slot=${b.scheduledSlot}  status=${b.status}  assignmentStatus=${b.assignmentStatus}  customer=${b.customerName}`);

  // 2. Contractor's "quotes" feed (what CalendarTab sees)
  const ourQuotes = await db
    .select({ shortSlug: personalizedQuotes.shortSlug, customerName: personalizedQuotes.customerName, bookedAt: personalizedQuotes.bookedAt, selectedDate: personalizedQuotes.selectedDate })
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.contractorId, contractorId))
    .orderBy(desc(personalizedQuotes.bookedAt));
  console.log(`  ▸ Quotes tied to ${contractorName}: ${ourQuotes.length}`);
  for (const q of ourQuotes.slice(0, 5)) console.log(`      ${q.shortSlug}  ${q.selectedDate?.toISOString().slice(0, 10)}  ${q.customerName}`);

  // 3. Confirm a new contextual quote attempting to reserve the SAME slot is rejected
  //    by checking isContractorAvailableForSlot's view of the world: any active
  //    booking on this date+slot blocks the slot.
  const blocker = bookings.find((b) => {
    if (b.scheduledSlot === 'full_day') return true;
    if (b.scheduledSlot === slot) return true;
    return false;
  });
  console.log(`  ▸ Slot ${scheduledDate.toISOString().slice(0, 10)} ${slot} would be excluded from new contextual quote pool: ${blocker ? 'YES ✓' : 'NO ✗'}`);

  // 4. Sister-slot still free? (if slot=am, pm should still be bookable; vice versa)
  if (slot !== 'full_day') {
    const sister = slot === 'am' ? 'pm' : 'am';
    const sisterBlocked = bookings.some((b) => b.scheduledSlot === sister || b.scheduledSlot === 'full_day');
    console.log(`  ▸ Sister slot ${sister} on same day still available: ${sisterBlocked ? 'NO (also booked)' : 'YES ✓'}`);
  }
}

// ─── main ─────────────────────────────────────────────────────────
async function main() {
  if (MODE_LIST) {
    await listUnassignedAccepted();
    process.exit(0);
  }
  if (MODE_CONTRACTORS) {
    await listContractors();
    process.exit(0);
  }

  const quoteSlug = args.quote as string | undefined;
  const contractorArg = args.contractor as string | undefined;
  const dateArg = args.date as string | undefined;
  const slotArg = args.slot as string | undefined;

  if (!quoteSlug || !contractorArg || !dateArg || !slotArg) {
    console.error('Missing args. Run with --list to see candidate quotes, or --contractors to see ids.');
    console.error('Required: --quote=<slug> --contractor=<id|name> --date=YYYY-MM-DD --slot=am|pm|full_day');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    console.error('--date must be YYYY-MM-DD');
    process.exit(1);
  }
  if (!['am', 'pm', 'full_day'].includes(slotArg)) {
    console.error('--slot must be am | pm | full_day');
    process.exit(1);
  }

  const contractor = await resolveContractor(contractorArg);
  if (!contractor) {
    console.error(`❌ Could not resolve contractor "${contractorArg}". Use --contractors to list available IDs.`);
    process.exit(1);
  }

  const result = await assign(quoteSlug, contractor.id, contractor.name, dateArg, slotArg as any, FORCE);

  if (VERIFY) {
    await verify(result.contractorId, contractor.name, result.scheduledDate, result.slot);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
