import 'dotenv/config';
import { db } from '../server/db';
import { contractorAvailabilityDates, contractorBookingRequests } from '../shared/schema';
import { eq, and, gte, or } from 'drizzle-orm';

const CRAIG = 'hp_aa21264a-9143-4116-bda2-2da998255929';
const today = new Date(); today.setUTCHours(0,0,0,0);
const end = new Date(today); end.setUTCDate(today.getUTCDate() + 14);
const ovs = await db.select().from(contractorAvailabilityDates).where(and(eq(contractorAvailabilityDates.contractorId, CRAIG), gte(contractorAvailabilityDates.date, today)));
console.log('Craig overrides from today (14d):');
ovs.forEach(o => console.log('  ', new Date(o.date).toISOString().slice(0,10), 'isAvail=', o.isAvailable, o.startTime, '-', o.endTime));
const js = await db.select().from(contractorBookingRequests).where(and(or(eq(contractorBookingRequests.assignedContractorId, CRAIG), eq(contractorBookingRequests.contractorId, CRAIG)), gte(contractorBookingRequests.scheduledDate, today)));
console.log('Craig bookings:');
js.forEach(j => console.log('  ', new Date(j.scheduledDate!).toISOString().slice(0,10), 'slot=', j.scheduledSlot, 'status=', j.status, 'assignStatus=', j.assignmentStatus, 'durationDays=', j.durationDays));
process.exit(0);
