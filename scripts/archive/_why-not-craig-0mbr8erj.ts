import { db } from '../server/db';
import { personalizedQuotes, handymanProfiles, users, contractorBookingRequests, bookingAssignments } from '../shared/schema';
import { eq, or } from 'drizzle-orm';

async function main() {
  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, '0mbr8erj')).limit(1);
  if (!q) { console.log('Quote not found'); process.exit(1); }

  console.log('=== QUOTE ===');
  console.log(JSON.stringify({
    id: q.id,
    slug: q.shortSlug,
    customerName: q.customerName,
    postcode: q.postcode,
    jobDescription: (q.jobDescription || '').slice(0, 120),
    segment: (q as any).segment,
    status: (q as any).status,
    depositPaidAt: q.depositPaidAt,
    bookedAt: (q as any).bookedAt,
    flexBookingWithinDays: (q as any).flexBookingWithinDays,
    leadContractorId: (q as any).leadContractorId,
    assignedContractorId: (q as any).assignedContractorId,
    createdAt: q.createdAt,
  }, null, 2));

  // Craig's profile
  const craigProfiles = await db.select({ id: handymanProfiles.id, userId: handymanProfiles.userId, deliveryTier: handymanProfiles.deliveryTier, appToken: handymanProfiles.appToken })
    .from(handymanProfiles);
  const craigUsers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users);
  const userById = new Map(craigUsers.map(u => [u.id, u]));
  const craig = craigProfiles.map(p => ({ ...p, name: `${userById.get(p.userId)?.firstName ?? ''} ${userById.get(p.userId)?.lastName ?? ''}`.trim() }))
    .filter(p => /craig/i.test(p.name));
  console.log('\n=== CRAIG PROFILE(S) ===');
  console.log(JSON.stringify(craig, null, 2));

  // Booking requests for this quote
  const brs = await db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.quoteId, q.id));
  console.log('\n=== BOOKING REQUESTS for this quote ===');
  console.log(JSON.stringify(brs.map(b => ({
    id: b.id, contractorId: b.contractorId, assignedContractorId: b.assignedContractorId,
    status: b.status, assignmentStatus: b.assignmentStatus,
    scheduledDate: b.scheduledDate, scheduledSlot: b.scheduledSlot, durationDays: b.durationDays,
  })), null, 2));

  // Assignments
  const asgs = await db.select().from(bookingAssignments).where(eq(bookingAssignments.quoteId, q.id as any)).catch(() => []);
  console.log('\n=== BOOKING ASSIGNMENTS (by quoteId) ===');
  console.log(JSON.stringify(asgs, null, 2));

  // Flex eligibility check
  const craigIds = new Set(craig.map(c => c.id));
  console.log('\n=== DIAGNOSIS ===');
  console.log('Flex-queue conditions (all must be true to show in flex list):');
  console.log('  leadContractorId === a Craig profile:', craigIds.has((q as any).leadContractorId), `(is ${(q as any).leadContractorId})`);
  console.log('  depositPaidAt IS NOT NULL:', q.depositPaidAt != null, `(${q.depositPaidAt})`);
  console.log('  flexBookingWithinDays IS NOT NULL:', (q as any).flexBookingWithinDays != null, `(${(q as any).flexBookingWithinDays})`);
  console.log('  bookedAt IS NULL:', (q as any).bookedAt == null, `(${(q as any).bookedAt})`);
  console.log('\nBooked-jobs conditions (a booking row assigned to Craig, status accepted/completed or assignmentStatus accepted/in_progress/completed):');
  for (const b of brs) {
    const assignedToCraig = craigIds.has(b.assignedContractorId as any) || craigIds.has(b.contractorId as any);
    console.log(`  BR ${b.id}: assignedToCraig=${assignedToCraig} status=${b.status} assignmentStatus=${b.assignmentStatus}`);
  }
  if (brs.length === 0) console.log('  (no booking rows exist for this quote)');

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
