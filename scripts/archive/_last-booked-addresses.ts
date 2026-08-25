import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { desc, isNotNull } from 'drizzle-orm';

// "Booked" = deposit paid (conversion signal). Pull extra so we can drop test
// rows and still surface the last 10 real bookings. Read-only.
const rows = await db
  .select({
    id: personalizedQuotes.id,
    slug: personalizedQuotes.shortSlug,
    name: personalizedQuotes.customerName,
    phone: personalizedQuotes.phone,
    email: personalizedQuotes.email,
    postcode: personalizedQuotes.postcode,
    address: personalizedQuotes.address,
    coordinates: personalizedQuotes.coordinates,
    job: personalizedQuotes.jobDescription,
    depositPaidAt: personalizedQuotes.depositPaidAt,
    bookedAt: personalizedQuotes.bookedAt,
  })
  .from(personalizedQuotes)
  .where(isNotNull(personalizedQuotes.depositPaidAt))
  .orderBy(desc(personalizedQuotes.depositPaidAt))
  .limit(30);

const isTest = (r: typeof rows[number]) =>
  /^test_q_/i.test(r.id) ||
  /^0770090\d{4}$/.test((r.phone || '').replace(/\s/g, '')) ||
  /\b(test|qa|phase|dummy|demo)\b/i.test(r.name || '') ||
  /@example\.com$/i.test(r.email || '');

const real = rows.filter((r) => !isTest(r));
const testCount = rows.length - real.length;

const bucket = (r: typeof rows[number]) => {
  const hasAddr = !!(r.address && r.address.trim());
  const c = r.coordinates as { lat?: number; lng?: number } | null;
  const hasCoords = !!(c && typeof c.lat === 'number' && typeof c.lng === 'number');
  if (hasAddr && hasCoords) return 'FULL (addr+geo)';
  if (hasAddr) return 'TEXT-ONLY (no geo)';
  return 'POSTCODE-ONLY';
};

console.log(`\nLast 10 booked quotes (deposit paid) — ${testCount} test row(s) skipped\n`);
real.slice(0, 10).forEach((r, i) => {
  const paid = r.depositPaidAt ? new Date(r.depositPaidAt).toISOString().slice(0, 16).replace('T', ' ') : '—';
  console.log(`${String(i + 1).padStart(2)}. ${paid}  ${(r.name || '—').padEnd(20)} ${r.slug}`);
  console.log(`    bucket : ${bucket(r)}`);
  console.log(`    address: ${r.address ? r.address.trim() : '(none)'}`);
  console.log(`    postcode: ${r.postcode || '(none)'}   phone: ${r.phone || '(none)'}`);
  const c = r.coordinates as { lat?: number; lng?: number } | null;
  console.log(`    coords : ${c && c.lat != null ? `${c.lat}, ${c.lng}` : '(none)'}`);
  console.log(`    job    : ${(r.job || '').replace(/\s+/g, ' ').slice(0, 70)}`);
  console.log('');
});

process.exit(0);
