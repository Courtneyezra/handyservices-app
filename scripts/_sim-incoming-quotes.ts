/**
 * Incoming-quote simulation — seed/scrub an ISOLATED test contractor + a mixed
 * pool of accepted flex quotes, to exercise the weekly optimizer end-to-end:
 * blocks claim consecutive days, minors pack into day-packs, skills gaps and
 * out-of-radius jobs surface honestly.
 *
 *   npx tsx scripts/_sim-incoming-quotes.ts seed
 *   npx tsx scripts/_sim-incoming-quotes.ts scrub
 *
 * Isolation: contractor based in NEWCASTLE (NE postcodes, 8mi radius) so no
 * real Nottingham quote can match him and no real contractor matches these
 * quotes. Quote ids use the dispatch test fence prefix (test_q_flex_*) so the
 * real console/cron never see them; the contractor-app day-plans endpoint
 * auto-detects an all-dummy lead pool and runs the optimiser in test mode.
 */
import { inArray, eq, like, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/db';
import {
  users, handymanProfiles, handymanSkills, contractorAvailabilityDates,
  personalizedQuotes, contractorBookingRequests, bookingAssignments, bookingSlotLocks,
} from '../shared/schema';

const USER_ID = 'test_user_sim_solo';
const PROFILE_ID = 'hp_test_sim_solo';
export const SIM_TOKEN = 'test-sim-solo-token-1234567890abcdef';
const SIM_PREFIX = 'test_q_flex_sim_';

// Newcastle base (NE6) — 8mi radius. Hexham (NE47) is ~20mi out: the outlier.
const BASE = { lat: 54.975, lng: -1.58 };
const NE6 = { lat: 54.977, lng: -1.565 };
const NE13 = { lat: 55.05, lng: -1.65 };
const NE47 = { lat: 54.97, lng: -2.10 };

const SKILLS = ['carpentry', 'painting', 'plumbing_minor', 'door_fitting', 'shelving', 'silicone_sealant', 'flat_pack', 'general_fixing'];

const line = (category: string, mins: number, description: string) => ({ description, category, timeEstimateMinutes: mins });

const QUOTES = [
  {
    id: SIM_PREFIX + 'block', slug: 'tqsm01', name: 'Test Sim Block', phone: '07700900021',
    postcode: 'NE6 5XA', coords: NE6, price: 240000, within: 14,
    desc: 'Garden room refit: strip out, reboard and insulate, then repaint over three days',
    lines: [line('carpentry', 240, 'Strip out'), line('carpentry', 240, 'Reboard + insulate'), line('painting', 240, 'First fix + mist coat'), line('painting', 180, 'Finish coats')],
  },
  {
    id: SIM_PREFIX + 'skill_ok', slug: 'tqsm02', name: 'Test Sim MultiSkill', phone: '07700900022',
    postcode: 'NE6 5DL', coords: NE6, price: 68000, within: 10,
    desc: 'Kitchen refresh: refit two units, replace tap, repaint walls',
    lines: [line('carpentry', 100, 'Refit units'), line('plumbing_minor', 90, 'Replace tap'), line('painting', 110, 'Repaint walls')],
  },
  {
    id: SIM_PREFIX + 'skill_gap', slug: 'tqsm03', name: 'Test Sim SkillGap', phone: '07700900023',
    postcode: 'NE13 6PL', coords: NE13, price: 45000, within: 10,
    desc: 'Repair roof flashing and rehang loose guttering',
    lines: [line('roofing', 120, 'Flashing repair'), line('carpentry', 60, 'Rehang gutter')],
  },
  {
    id: SIM_PREFIX + 'm1', slug: 'tqsm04', name: 'Test Sim MinorA', phone: '07700900024',
    postcode: 'NE6 5QB', coords: NE6, price: 14000, within: 7,
    desc: 'Hang two internal doors', lines: [line('door_fitting', 90, 'Hang doors')],
  },
  {
    id: SIM_PREFIX + 'm2', slug: 'tqsm05', name: 'Test Sim MinorB', phone: '07700900025',
    postcode: 'NE6 5TR', coords: NE6, price: 11000, within: 7,
    desc: 'Fit alcove shelving unit', lines: [line('shelving', 75, 'Fit shelving')],
  },
  {
    id: SIM_PREFIX + 'm3', slug: 'tqsm06', name: 'Test Sim MinorC', phone: '07700900026',
    postcode: 'NE6 5HD', coords: NE6, price: 9000, within: 7,
    desc: 'Reseal shower enclosure', lines: [line('silicone_sealant', 60, 'Reseal shower')],
  },
  {
    id: SIM_PREFIX + 'm4', slug: 'tqsm07', name: 'Test Sim MinorD', phone: '07700900027',
    postcode: 'NE13 7AB', coords: NE13, price: 12000, within: 7,
    desc: 'Build flat-pack wardrobe and desk', lines: [line('flat_pack', 100, 'Flat-pack build')],
  },
  {
    id: SIM_PREFIX + 'outlier', slug: 'tqsm08', name: 'Test Sim Outlier', phone: '07700900028',
    postcode: 'NE47 6BQ', coords: NE47, price: 8000, within: 7,
    desc: 'Assemble garden bench and planter (Hexham)', lines: [line('flat_pack', 60, 'Assemble bench')],
  },
];

// Mon–Fri of the next two full weeks, opened full-day.
function openDays(): Date[] {
  const out: Date[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7)); // next Monday
  for (const weekOffset of [0, 1]) {
    for (let d = 0; d < 5; d++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + weekOffset * 7 + d);
      out.push(day);
    }
  }
  return out;
}

async function seed() {
  await db.insert(users).values({ id: USER_ID, email: 'sim-solo@example.com', firstName: 'Test', lastName: 'SimSolo', role: 'contractor' }).onConflictDoNothing();
  await db.insert(handymanProfiles).values({
    id: PROFILE_ID, userId: USER_ID, businessName: 'Test Sim Solo',
    latitude: String(BASE.lat), longitude: String(BASE.lng), radiusMiles: 8,
    deliveryTier: 'adhoc', verificationStatus: 'unverified', publicProfileEnabled: false,
    appToken: SIM_TOKEN,
  } as any).onConflictDoNothing();
  for (const slug of SKILLS) {
    await db.insert(handymanSkills).values({ id: uuidv4(), handymanId: PROFILE_ID, categorySlug: slug, proficiency: 'competent' } as any).onConflictDoNothing();
  }
  for (const day of openDays()) {
    await db.insert(contractorAvailabilityDates).values({
      id: uuidv4(), contractorId: PROFILE_ID, date: day, isAvailable: true,
      startTime: '09:00', endTime: '18:00', notes: 'sim',
    } as any);
  }
  await db.insert(personalizedQuotes).values(QUOTES.map((q) => ({
    id: q.id, shortSlug: q.slug, customerName: q.name, phone: q.phone,
    postcode: q.postcode, coordinates: q.coords, jobDescription: q.desc,
    basePrice: q.price, depositPaidAt: new Date(), flexBookingWithinDays: q.within,
    pricingLineItems: q.lines, leadContractorId: PROFILE_ID,
  })) as any);
  console.log(`seeded: contractor ${PROFILE_ID} (8mi radius, Newcastle), ${SKILLS.length} skills, ${openDays().length} open days, ${QUOTES.length} quotes`);
  console.log(`app link: /my-week/${SIM_TOKEN}`);
}

async function scrub() {
  const bookings = await db.select({ id: contractorBookingRequests.id }).from(contractorBookingRequests).where(like(contractorBookingRequests.quoteId, SIM_PREFIX + '%'));
  const ids = bookings.map((b) => b.id);
  if (ids.length) {
    await db.delete(bookingAssignments).where(inArray(bookingAssignments.bookingId, ids));
    await db.delete(contractorBookingRequests).where(inArray(contractorBookingRequests.id, ids));
  }
  await db.delete(bookingSlotLocks).where(like(bookingSlotLocks.quoteId, SIM_PREFIX + '%'));
  await db.delete(personalizedQuotes).where(like(personalizedQuotes.id, SIM_PREFIX + '%'));
  await db.delete(contractorAvailabilityDates).where(eq(contractorAvailabilityDates.contractorId, PROFILE_ID));
  await db.delete(handymanSkills).where(eq(handymanSkills.handymanId, PROFILE_ID));
  await db.delete(handymanProfiles).where(eq(handymanProfiles.id, PROFILE_ID));
  await db.delete(users).where(eq(users.id, USER_ID));
  console.log(`scrubbed: ${ids.length} bookings + quotes + availability + skills + profile + user`);
}

(async () => {
  const mode = process.argv[2];
  if (mode === 'seed') await seed();
  else if (mode === 'scrub') await scrub();
  else { console.error('usage: _sim-incoming-quotes.ts seed|scrub'); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
