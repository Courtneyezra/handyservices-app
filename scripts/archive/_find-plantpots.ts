import { db } from '../server/db';
import { personalizedQuotes, contractorBookingRequests, bookingAssignments, handymanProfiles, users } from '../shared/schema';
import { ilike, eq } from 'drizzle-orm';

async function main() {
  const rows = await db.select().from(personalizedQuotes).where(ilike(personalizedQuotes.jobDescription, '%plant pot%'));
  for (const q of rows) {
    console.log('=== QUOTE ===');
    console.log(JSON.stringify({
      id: q.id, slug: q.shortSlug, customer: q.customerName, postcode: q.postcode,
      desc: (q.jobDescription||'').slice(0,80),
      basePrice: q.basePrice,
      depositPaidAt: q.depositPaidAt, bookedAt: (q as any).bookedAt,
      leadContractorId: (q as any).leadContractorId, leadContractorSource: (q as any).leadContractorSource,
      contractorId: (q as any).contractorId,
      flexBookingWithinDays: (q as any).flexBookingWithinDays,
    }, null, 2));

    const brs = await db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.quoteId, q.id));
    console.log('  booking requests:', brs.length, brs.map(b=>({id:b.id,status:b.status,assignmentStatus:b.assignmentStatus,assigned:b.assignedContractorId,contractor:b.contractorId})));
    const asgs = await db.select().from(bookingAssignments).where(eq(bookingAssignments.quoteId, q.id as any)).catch(()=>[]);
    console.log('  assignments:', asgs.length);

    const lead = (q as any).leadContractorId;
    if (lead) {
      const [p] = await db.select({ userId: handymanProfiles.userId }).from(handymanProfiles).where(eq(handymanProfiles.id, lead)).limit(1);
      if (p) { const [u] = await db.select({ f: users.firstName, l: users.lastName }).from(users).where(eq(users.id, p.userId)).limit(1); console.log('  lead =', u?.f, u?.l); }
    }
  }
  if (!rows.length) console.log('No plant-pot quote found');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
