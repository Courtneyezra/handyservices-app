import { db } from '../server/db';
import { personalizedQuotes, leads, contractorBookingRequests } from '../shared/schema';
import { or, eq } from 'drizzle-orm';

async function main() {
  const q = await db.query.personalizedQuotes.findFirst({
    where: or(eq(personalizedQuotes.shortSlug, 'vqb49nhc'), eq(personalizedQuotes.id, 'vqb49nhc'))
  });
  
  console.log('=== Quote ===');
  console.log('ID:', q?.id);
  console.log('Customer:', q?.customerName);
  console.log('Phone:', q?.phone);
  console.log('Email:', q?.email);
  console.log('Postcode:', q?.postcode);
  console.log('Address:', q?.address);
  console.log('deposit_paid_at:', (q as any)?.depositPaidAt);
  console.log('Selected date:', (q as any)?.selectedDate);
  console.log('Selected slot:', (q as any)?.selectedSlot);
  console.log('Lead ID:', q?.leadId);
  
  // Check lead
  if (q?.leadId) {
    const lead = await db.query.leads.findFirst({ where: eq(leads.id, q.leadId) });
    console.log('\n=== Linked Lead ===');
    console.log('Lead ID:', lead?.id);
    console.log('Address raw:', lead?.addressRaw);
    console.log('Postcode:', lead?.postcode);
    console.log('Status:', lead?.status);
  }

  // Check booking requests
  const bookings = await db.select().from(contractorBookingRequests)
    .where(eq(contractorBookingRequests.quoteId, q?.id || ''));
  console.log('\n=== Booking Requests ===');
  bookings.forEach(b => console.log(JSON.stringify({
    id: b.id,
    status: b.assignmentStatus,
    date: b.scheduledDate,
    slot: b.scheduledSlot,
    address: (b as any).customerAddress,
    contractor: b.assignedContractorId,
  }, null, 2)));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
