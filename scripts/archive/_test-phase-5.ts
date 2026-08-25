import 'dotenv/config';
import { computeDayItinerary } from '../server/lib/day-itinerary';

async function main() {
  // Craig has Edward Wed 27 May (Derby) per current state
  console.log('═══ Craig — Wed 27 May (existing: Edward full_day, Derby) ═══');
  const r1 = await computeDayItinerary({
    contractorId: 'hp_aa21264a-9143-4116-bda2-2da998255929',
    date: new Date('2026-05-27'),
  });
  console.log('Stops:');
  for (const s of r1.stops) {
    console.log(`  ${s.scheduledSlot.padEnd(8)} ${s.workAndBufferMinutes}min work · ${s.travelInMinutes}min travelIn (${s.travelInSource || '—'}) · ${s.customerName}`);
  }
  console.log('Totals:', r1.totals);
  console.log('Fits cap (' + r1.capCapacityMinutes + 'min):', r1.fitsCapacity ? '✅' : '❌');
  if (r1.notes.length) console.log('Notes:', r1.notes);

  console.log('\n═══ Bezent (NG3) — Tue 26 May, simulate adding an NG7 customer AM ═══');
  const r2 = await computeDayItinerary({
    contractorId: 'hp_15b5249f-b433-4f7f-b1d0-a8d462c95aac',
    date: new Date('2026-05-26'),
    candidate: {
      quoteId: 'CANDIDATE',
      customerName: 'New Customer NG7',
      scheduledSlot: 'am',
      customerCoords: { lat: 52.9389, lng: -1.1789 },
      durationMinutes: 90,
    },
  });
  console.log('Stops:');
  for (const s of r2.stops) {
    console.log(`  ${s.scheduledSlot.padEnd(8)} ${s.workAndBufferMinutes}min work · ${s.travelInMinutes}min travelIn (${s.travelInSource || '—'}) · ${s.customerName}`);
  }
  console.log('Totals:', r2.totals);
  console.log('Fits cap:', r2.fitsCapacity ? '✅' : '❌');

  // Simulate: Craig has existing job in Derby, candidate AM in NG2 — intra-day travel should fire
  console.log('\n═══ Craig — Wed 27, adding AM NG2 candidate (existing Edward Derby full_day) ═══');
  const r3 = await computeDayItinerary({
    contractorId: 'hp_aa21264a-9143-4116-bda2-2da998255929',
    date: new Date('2026-05-27'),
    candidate: {
      quoteId: 'CANDIDATE-NG2',
      customerName: 'AM NG2',
      scheduledSlot: 'am',
      customerCoords: { lat: 52.9329, lng: -1.128 },
      durationMinutes: 120,
    },
  });
  console.log('Stops:');
  for (const s of r3.stops) {
    console.log(`  ${s.scheduledSlot.padEnd(8)} ${s.workAndBufferMinutes}min work · ${s.travelInMinutes}min travelIn (${s.travelInSource || '—'}) · ${s.customerName}`);
  }
  console.log('Totals:', r3.totals);
  console.log('Fits cap:', r3.fitsCapacity ? '✅' : '❌');

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
