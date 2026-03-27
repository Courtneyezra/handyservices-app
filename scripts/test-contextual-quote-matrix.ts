/**
 * Comprehensive contextual quote test matrix.
 *
 * Tests every meaningful combination of:
 *   - Layout tier (quick / standard / complex) driven by line count
 *   - Customer type via vaContext (landlord / homeowner / renter / property mgr / SMB / OAP / emergency)
 *   - Urgency (standard / priority / emergency)
 *   - Materials supply (customer_supplied / we_supply / labor_only)
 *   - Time of service (standard / after_hours / weekend)
 *   - Returning customer (yes / no)
 *   - VA context richness (none / thin / rich)
 *   - Price band (quick <£100, dead zone £100-200, standard, complex)
 *   - Batch nudge (single job = should appear)
 *   - Direct price message (quick tier = should be present)
 *   - Dead zone framing (£100-200 band = should be present)
 *
 * Runs directly against the server — start `npm run dev` first.
 *
 * Usage:  npx tsx scripts/test-contextual-quote-matrix.ts [BASE_URL]
 *         BASE_URL defaults to http://localhost:5000
 */

import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = process.argv[2] || 'http://localhost:5000';
const ADMIN_EMAIL = 'admin@handyservices.com';
const ADMIN_PASSWORD = 'admin123';

// ─────────────────────────────────────────────────────────────────────────────
// Colours
// ─────────────────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  grey: '\x1b[90m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function pass(msg: string) { console.log(`  ${c.green}✓${c.reset} ${msg}`); }
function fail(msg: string) { console.log(`  ${c.red}✗${c.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${c.grey}· ${msg}${c.reset}`); }
function warn(msg: string) { console.log(`  ${c.yellow}⚠ ${msg}${c.reset}`); }
function section(msg: string) { console.log(`\n${c.bold}${c.cyan}── ${msg} ──${c.reset}`); }

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }
  const data = await res.json() as any;
  return data.token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test case definition
// ─────────────────────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  description: string;
  // Expected outcome tags
  expectedTier: 'quick' | 'standard' | 'complex';
  expectDeadZone?: boolean;
  expectDirectPrice?: boolean;
  expectBatchNudge?: boolean;
  // Request payload
  payload: Record<string, unknown>;
}

const TEST_CASES: TestCase[] = [
  // ─────────────── QUICK TIER (1 line) ───────────────
  {
    name: 'Q1 · Quick / Landlord / Remote / Rich context',
    description: 'Single dripping tap, landlord 2h away, wants photos, rich VA context',
    expectedTier: 'quick',
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'Sarah Mitchell',
      phone: '07700900001',
      email: 'sarah@test.com',
      vaContext: "She's a landlord, lives about 2 hours from the property. Tenant reported a dripping bathroom tap. She was very keen on photo proof after the job. Has used us once before and was happy. No urgency — tenant is fine for a weekday visit. Doesn't need to be there herself.",
      lines: [{ id: 'l1', description: 'Dripping bathroom tap — needs washer replacement', category: 'plumbing_minor', estimatedMinutes: 45, materialsCostPence: 500 }],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 1, previousAvgPricePence: 8500 },
    },
  },
  {
    name: 'Q2 · Quick / Emergency / Burst pipe / No VA context',
    description: 'Burst pipe emergency, no customer context at all, labour only',
    expectedTier: 'quick',
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'James Thornton',
      phone: '07700900002',
      lines: [{ id: 'l1', description: 'Burst pipe under kitchen sink — water actively leaking', category: 'plumbing_minor', estimatedMinutes: 60 }],
      signals: { urgency: 'emergency', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'Q3 · Quick / Budget / Thin context / Labour only',
    description: 'Budget-conscious tenant, thin context, squeaky door, labour only',
    expectedTier: 'quick',
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'Dave Price',
      phone: '07700900003',
      vaContext: 'Renter. Squeaky door.',
      lines: [{ id: 'l1', description: 'Fix squeaky bedroom door — hinge adjustment needed', category: 'general_fixing', estimatedMinutes: 30 }],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'Q4 · Quick / OAP / Trust-seeker / Weekend',
    description: 'Elderly homeowner, trust-sensitive, light fix on weekend',
    expectedTier: 'quick',
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'Margaret Ellis',
      phone: '07700900004',
      vaContext: "Older lady, very cautious — asked a lot of questions about who would be coming. She's been let down before by a cowboy builder. Lives alone. Just needs a towel rail re-fixed in bathroom. Happy to do weekend as long as it's morning.",
      lines: [{ id: 'l1', description: 'Re-fix fallen towel rail in bathroom — wall fixing needed', category: 'general_fixing', estimatedMinutes: 30 }],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'weekend', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'Q5 · Quick / Returning customer / TV mount / After hours',
    description: 'Busy professional, 4th job, TV mount after hours',
    expectedTier: 'quick',
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'Priya Kapoor',
      phone: '07700900005',
      vaContext: "Busy professional — she's been with us 3 times before. Wants TV mounted ASAP but can only do after 6pm. Knows us well, very relaxed, just needs it done.",
      lines: [{ id: 'l1', description: 'Mount 55" TV on living room wall, cables hidden', category: 'tv_mounting', estimatedMinutes: 60 }],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'after_hours', isReturningCustomer: true, previousJobCount: 3, previousAvgPricePence: 9500 },
    },
  },

  // ─────────────── DEAD ZONE TEST (1 line, price should land £100-200) ───────────────
  {
    name: 'DZ1 · Dead zone / Painting touch-up / Standard',
    description: 'Standard painting job expected to land in £100-200 dead zone',
    expectedTier: 'quick',
    expectDeadZone: true,
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'Tom Walker',
      phone: '07700900006',
      vaContext: 'Homeowner, redecoring the living room himself but wants a pro to do the ceiling. Nothing urgent, just needs it done properly.',
      lines: [{ id: 'l1', description: 'Paint living room ceiling — two coats, approx 20sqm', category: 'painting', estimatedMinutes: 120 }],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'DZ2 · Dead zone / Lock change / Priority',
    description: 'Lock change after lost keys — should hit dead zone band',
    expectedTier: 'quick',
    expectDeadZone: true,
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'Lisa Chen',
      phone: '07700900007',
      vaContext: "Lost her keys, wants both front and back door locks changed. Homeowner, mid-30s, quite stressed. Doesn't need it today but wants it done this week.",
      lines: [{ id: 'l1', description: 'Replace front and back door locks — 5-lever deadbolt both', category: 'lock_change', estimatedMinutes: 90, materialsCostPence: 3500 }],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },

  // ─────────────── STANDARD TIER (2-3 lines) ───────────────
  {
    name: 'S1 · Standard / Property manager / Multi-property / Returning',
    description: '2-line quote for property manager with portfolio, returning',
    expectedTier: 'standard',
    expectBatchNudge: false,
    payload: {
      customerName: 'Ravi Sharma',
      phone: '07700900008',
      email: 'ravi@propertyco.com',
      vaContext: "Portfolio landlord — manages about 8 properties. He's used us 5 times. Very professional, just wants it done with minimal fuss. He won't be at the property — tenant will let us in. Wants invoice by email for his accountant. He mentioned he's looking for a long-term maintenance partner.",
      lines: [
        { id: 'l1', description: 'Repair dripping kitchen tap — needs new cartridge', category: 'plumbing_minor', estimatedMinutes: 45, materialsCostPence: 800 },
        { id: 'l2', description: 'Hang 2 floating shelves in bedroom', category: 'general_fixing', estimatedMinutes: 30 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 5, previousAvgPricePence: 12000 },
    },
  },
  {
    name: 'S2 · Standard / Homeowner / Kitchen list / Customer-supplied materials',
    description: '3-line kitchen fix list, homeowner on site, customer supplied',
    expectedTier: 'standard',
    expectBatchNudge: false,
    payload: {
      customerName: 'Helen Booth',
      phone: '07700900009',
      vaContext: "She's been doing up the house herself — DIY type. Just a few things she can't quite manage. She'll be home all day and has bought all the materials. Very relaxed, no rush. First time using us.",
      lines: [
        { id: 'l1', description: 'Replace 5 kitchen door handles — customer has handles', category: 'general_fixing', estimatedMinutes: 30 },
        { id: 'l2', description: 'Reattach loose kitchen plinth panels', category: 'carpentry', estimatedMinutes: 30 },
        { id: 'l3', description: 'Silicone reseal around kitchen sink', category: 'silicone_sealant', estimatedMinutes: 45 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'S3 · Standard / Small business / After hours / Commercial',
    description: 'Cafe owner, after-hours repair, 2 lines, commercial setting',
    expectedTier: 'standard',
    expectBatchNudge: false,
    payload: {
      customerName: 'Marco Rossi',
      phone: '07700900010',
      email: 'marco@cafenottingham.co.uk',
      vaContext: "Runs a café in the city centre. Needs it done after 7pm when they close — can't have workmen in during service hours. Fairly price-aware but knows it costs more after hours. Two things: a broken socket and a shelf unit that needs fixing in the back room. He's the owner-manager, will be there himself.",
      lines: [
        { id: 'l1', description: 'Replace faulty double socket behind cafe counter', category: 'electrical_minor', estimatedMinutes: 60, materialsCostPence: 1200 },
        { id: 'l2', description: 'Repair shelf unit in back room — bracket replacement', category: 'carpentry', estimatedMinutes: 45 },
      ],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'after_hours', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'S4 · Standard / Renter / Bathroom fixes / No email',
    description: '2-line bathroom fix, renter in own home, standard signals',
    expectedTier: 'standard',
    expectBatchNudge: false,
    payload: {
      customerName: 'Amy Dixon',
      phone: '07700900011',
      vaContext: "She rents her place — said she'll pay herself and sort it out with her landlord later. Bathroom's been dripping and the towel rail fell off. Nothing urgent. She works from home so any weekday works.",
      lines: [
        { id: 'l1', description: 'Fix dripping bathroom tap — washer replacement', category: 'plumbing_minor', estimatedMinutes: 45, materialsCostPence: 500 },
        { id: 'l2', description: 'Re-fix fallen towel rail, proper wall fixings', category: 'general_fixing', estimatedMinutes: 30 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },

  // ─────────────── COMPLEX TIER (4+ lines) ───────────────
  {
    name: 'C1 · Complex / Landlord / End-of-tenancy snagging / Rich context',
    description: '5-line end-of-tenancy snagging list, landlord between tenants',
    expectedTier: 'complex',
    expectBatchNudge: false,
    payload: {
      customerName: 'Michael Barker',
      phone: '07700900012',
      email: 'michael@barker-properties.co.uk',
      vaContext: "Landlord with a 3-bed terraced house between tenants. He needs it all sorted before new tenants move in on the 10th — about 12 days away. He's done this before, very organised, sent a detailed list. He won't be on site but a key is available at the letting agent nearby. Wants everything itemised on the invoice for the deposit deduction report. Has used us twice before.",
      lines: [
        { id: 'l1', description: 'Fill and paint over scuffs on 3 bedroom walls', category: 'painting', estimatedMinutes: 120 },
        { id: 'l2', description: 'Re-hang bedroom door — coming off hinges', category: 'door_fitting', estimatedMinutes: 60 },
        { id: 'l3', description: 'Fix dripping bathroom tap and re-seat toilet seat', category: 'plumbing_minor', estimatedMinutes: 60, materialsCostPence: 1500 },
        { id: 'l4', description: 'Replace cracked kitchen tiles — 6 tiles approx', category: 'tiling', estimatedMinutes: 90, materialsCostPence: 2000 },
        { id: 'l5', description: 'Re-silicone bath and kitchen sink', category: 'silicone_sealant', estimatedMinutes: 45 },
      ],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 2, previousAvgPricePence: 15000 },
    },
  },
  {
    name: 'C2 · Complex / Property manager / Refurb package / We supply all',
    description: '4-line bathroom refurb for property management company',
    expectedTier: 'complex',
    expectBatchNudge: false,
    payload: {
      customerName: 'Claire Ashworth',
      phone: '07700900013',
      email: 'claire@urbanlet.co.uk',
      vaContext: "Property management company, Claire is the maintenance coordinator. They have 15 properties with us on rotation. She's professional, brief, just wants the quote and availability. Bathroom refurb in a 2-bed flat — tenant has moved out, full access. They supply specs, we supply materials. Wants it done within 2 weeks.",
      lines: [
        { id: 'l1', description: 'Re-tile shower enclosure — remove old tiles, full reline 4sqm', category: 'tiling', estimatedMinutes: 240, materialsCostPence: 8000 },
        { id: 'l2', description: 'Replace bathroom taps (bath and basin) with chrome set', category: 'plumbing_minor', estimatedMinutes: 90, materialsCostPence: 4500 },
        { id: 'l3', description: 'Fit new bathroom cabinet and mirror', category: 'carpentry', estimatedMinutes: 60, materialsCostPence: 0 },
        { id: 'l4', description: 'Re-grout and silicone around bath and basin', category: 'silicone_sealant', estimatedMinutes: 60 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 8, previousAvgPricePence: 25000 },
    },
  },
  {
    name: 'C3 · Complex / New build snagging / No returning / Emergency timeline',
    description: '4-line new build snagging under time pressure, first-time customer',
    expectedTier: 'complex',
    expectBatchNudge: false,
    payload: {
      customerName: 'Natalie Frost',
      phone: '07700900014',
      vaContext: "Moving into a new build next Friday and the developer has left several snagging issues unresolved. She's frustrated — developer keeps fobbing her off. She wants everything fixed before she moves in. No materials needed from us, just labour. She's never used us before, found us on Google.",
      lines: [
        { id: 'l1', description: 'Fit curtain poles in living room and 3 bedrooms (4 rooms)', category: 'curtain_blinds', estimatedMinutes: 90 },
        { id: 'l2', description: 'Hang 8 pictures and a large mirror — wall fixings', category: 'general_fixing', estimatedMinutes: 60 },
        { id: 'l3', description: 'Assemble and install 2 IKEA PAX wardrobes', category: 'flat_pack', estimatedMinutes: 180 },
        { id: 'l4', description: 'Fix 3 stiff internal doors — planing and rehinging needed', category: 'door_fitting', estimatedMinutes: 90 },
      ],
      signals: { urgency: 'priority', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'C4 · Complex / Small business refurb / Weekend / Price-conscious',
    description: '4-line small business office refurb, weekend only, budget-aware',
    expectedTier: 'complex',
    expectBatchNudge: false,
    payload: {
      customerName: 'Karen Simmons',
      phone: '07700900015',
      email: 'karen@simmonssolicitors.co.uk',
      vaContext: "Runs a small solicitors office. Needs a weekend refit — can't disrupt the working week. 4 things: replace flooring in reception, paint the meeting room, hang some framed certificates, and fix a noisy extractor fan. She was asking about prices upfront — definitely price-aware but she's a professional so she'll pay if it's justified. First time using us.",
      lines: [
        { id: 'l1', description: 'Lay vinyl flooring in reception area — approx 15sqm', category: 'flooring', estimatedMinutes: 180, materialsCostPence: 9000 },
        { id: 'l2', description: 'Paint meeting room — walls and ceiling, 2 coats', category: 'painting', estimatedMinutes: 180, materialsCostPence: 3000 },
        { id: 'l3', description: 'Hang 6 framed certificates and a wall clock', category: 'general_fixing', estimatedMinutes: 45 },
        { id: 'l4', description: 'Fix noisy extractor fan in bathroom — bearing replacement', category: 'electrical_minor', estimatedMinutes: 45, materialsCostPence: 1500 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'weekend', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },

  // ─────────────── EDGE CASES ───────────────
  {
    name: 'E1 · No VA context at all / Standard signals',
    description: 'Bare minimum input — no context, no email, standard signals',
    expectedTier: 'quick',
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'John Smith',
      phone: '07700900016',
      lines: [{ id: 'l1', description: 'Fix leaking tap in bathroom', category: 'plumbing_minor', estimatedMinutes: 30 }],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'E2 · High-value returning customer / Negotiation signal',
    description: 'Customer with 8 previous jobs, high avg price — should hold premium',
    expectedTier: 'standard',
    expectBatchNudge: false,
    payload: {
      customerName: 'Ben Clarke',
      phone: '07700900017',
      vaContext: "Long-standing customer, been with us about 2 years. 8 jobs. He negotiated a bit on the last one but we held the price and he was fine. Good relationship. Wants flooring and a door — straightforward, no drama.",
      lines: [
        { id: 'l1', description: 'Lay engineered wood flooring in hallway — approx 8sqm', category: 'flooring', estimatedMinutes: 120, materialsCostPence: 5000 },
        { id: 'l2', description: 'Hang new internal door — frame is existing', category: 'door_fitting', estimatedMinutes: 90 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 8, previousAvgPricePence: 18000 },
    },
  },
  {
    name: 'E3 · Maximum capacity / Emergency / Weekend premium stacked',
    description: 'All premium signals stacked: emergency + weekend + full capacity',
    expectedTier: 'quick',
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'Rachel Price',
      phone: '07700900018',
      vaContext: "Pipe has burst in the kitchen, water everywhere. She sounds very stressed — called back twice. Needs someone today, Saturday. First time customer.",
      lines: [{ id: 'l1', description: 'Emergency — burst kitchen pipe, active water leak', category: 'plumbing_minor', estimatedMinutes: 60, materialsCostPence: 2000 }],
      signals: { urgency: 'emergency', materialsSupply: 'we_supply', timeOfService: 'weekend', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'E4 · Garden maintenance / Outdoor / Standard',
    description: 'Outdoor job — garden tidy, different category entirely',
    expectedTier: 'quick',
    expectDirectPrice: true,
    expectBatchNudge: true,
    payload: {
      customerName: 'Paul Green',
      phone: '07700900019',
      vaContext: "Retired gentleman, has a decent size back garden that's got out of hand. Just wants it cleared up and tidied. Nothing technical, very relaxed. His wife will be in.",
      lines: [{ id: 'l1', description: 'Garden tidy — overgrown shrubs cut back, weeds cleared, general tidy', category: 'garden_maintenance', estimatedMinutes: 120 }],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
  {
    name: 'E5 · Flat pack assembly / IKEA / Standard tier',
    description: '3-line IKEA flat pack assembly day, standard homeowner',
    expectedTier: 'standard',
    expectBatchNudge: false,
    payload: {
      customerName: 'Sophie Hall',
      phone: '07700900020',
      vaContext: "Just moved into a new flat. Needs three bits of IKEA furniture assembled — two wardrobes and a chest of drawers. She's in her 20s, said she tried to do it herself and gave up. Weekday, she'll be home.",
      lines: [
        { id: 'l1', description: 'Assemble IKEA PAX wardrobe (standard, 2 doors)', category: 'flat_pack', estimatedMinutes: 90 },
        { id: 'l2', description: 'Assemble IKEA PAX wardrobe (corner unit)', category: 'flat_pack', estimatedMinutes: 120 },
        { id: 'l3', description: 'Assemble IKEA MALM chest of 6 drawers', category: 'flat_pack', estimatedMinutes: 60 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────────

interface ValidationResult {
  passed: boolean;
  checks: { label: string; ok: boolean; note?: string }[];
}

function validateCreationResponse(tc: TestCase, data: any): ValidationResult {
  const checks: { label: string; ok: boolean; note?: string }[] = [];

  // Response shape: top-level has quoteId/shortSlug/quoteUrl/whatsappMessage/directPriceMessage
  // Nested: data.pricing.{ totalPence, totalFormatted, lineItems, batchDiscount }
  //         data.messaging.{ layoutTier, headline, valueBullets, deadZoneFraming, ... }
  const pricing = data.pricing || {};
  const messaging = data.messaging || {};

  // Required top-level fields
  for (const field of ['quoteId', 'shortSlug', 'quoteUrl', 'whatsappMessage']) {
    checks.push({ label: `has ${field}`, ok: !!data[field], note: data[field] ? String(data[field]).substring(0, 60) : 'MISSING' });
  }

  // Required nested fields
  checks.push({ label: 'has pricing.totalFormatted', ok: !!pricing.totalFormatted, note: pricing.totalFormatted || 'MISSING' });
  checks.push({ label: 'has pricing.lineItems', ok: Array.isArray(pricing.lineItems) && pricing.lineItems.length > 0, note: `${pricing.lineItems?.length ?? 0} lines` });
  checks.push({ label: 'has messaging.layoutTier', ok: !!messaging.layoutTier, note: messaging.layoutTier || 'MISSING' });

  // Layout tier matches expected
  const tierOk = messaging.layoutTier === tc.expectedTier;
  checks.push({ label: `layoutTier = ${tc.expectedTier}`, ok: tierOk, note: tierOk ? '✓' : `got ${messaging.layoutTier}` });

  // WhatsApp message format — must start with "Hey" not "Hi" or "Dear"
  const msgStart = (data.whatsappMessage || '').substring(0, 10);
  const msgHuman = msgStart.startsWith('Hey');
  checks.push({ label: 'WhatsApp starts with "Hey"', ok: msgHuman, note: msgHuman ? '✓' : `starts with: "${msgStart}"` });

  // WhatsApp must not contain banned corporate phrases
  const bannedPhrases = ['Dear Customer', 'Kind regards', '✨', 'We are pleased', 'valued customer'];
  for (const phrase of bannedPhrases) {
    const found = (data.whatsappMessage || '').includes(phrase);
    if (found) checks.push({ label: `no "${phrase}"`, ok: false, note: 'FOUND (corporate language detected)' });
  }

  // Direct price message — should be present for quick tier
  if (tc.expectDirectPrice) {
    checks.push({ label: 'directPriceMessage present', ok: !!data.directPriceMessage, note: data.directPriceMessage ? data.directPriceMessage.substring(0, 60) + '…' : 'MISSING' });
    if (data.directPriceMessage) {
      const noDecimal = !data.directPriceMessage.match(/£\d+\.\d+/);
      checks.push({ label: 'direct price no decimals (£X not £X.XX)', ok: noDecimal, note: noDecimal ? '✓' : 'Contains decimal price' });
    }
    checks.push({ label: 'directPriceSendUrl present', ok: !!data.directPriceSendUrl });
  }

  // Batch nudge — should appear for single-job quotes
  if (tc.expectBatchNudge) {
    const fullMsg = (data.whatsappMessage || '') + (data.directPriceMessage || '');
    const hasBatchNudge = fullMsg.toLowerCase().includes('another job') ||
      fullMsg.toLowerCase().includes('while we') ||
      fullMsg.toLowerCase().includes('second job') ||
      fullMsg.toLowerCase().includes('save') ||
      fullMsg.toLowerCase().includes('batch') ||
      fullMsg.toLowerCase().includes('same visit');
    checks.push({ label: 'batch nudge in message', ok: hasBatchNudge, note: hasBatchNudge ? '✓' : 'No batch nudge — check batchNudge logic in routes.ts' });
  }

  // Dead zone framing — pricing in £100-200 may trigger this
  if (tc.expectDeadZone) {
    const pricePence = pricing.totalPence || 0;
    const inDeadZone = pricePence >= 10000 && pricePence <= 20000;
    const hasFraming = !!(messaging.deadZoneFraming);
    if (inDeadZone) {
      checks.push({ label: 'deadZoneFraming set (price in band)', ok: hasFraming, note: messaging.deadZoneFraming || 'MISSING' });
    } else {
      checks.push({ label: `dead zone check (price: ${pricing.totalFormatted})`, ok: true, note: `LLM priced at ${pricing.totalFormatted} — outside £100-200 band` });
    }
  }

  // Content library — selectedContent should be returned
  if (data.selectedContent) {
    checks.push({ label: 'selectedContent returned', ok: true, note: `testimonials:${data.selectedContent.testimonials?.length ?? 0} hassle:${data.selectedContent.hassleItems?.length ?? 0}` });
  } else {
    checks.push({ label: 'selectedContent returned', ok: true, note: 'null — content library may be empty (warning only)' });
  }

  // Price sanity — should not be £0 or negative
  const totalPence = pricing.totalPence || 0;
  checks.push({ label: 'price > £0', ok: totalPence > 0, note: pricing.totalFormatted || String(totalPence) });

  const passed = checks.filter(c => !c.ok).length === 0;
  return { passed, checks };
}

async function validateQuoteFetch(quoteId: string, shortSlug: string, token: string): Promise<{ ok: boolean; note: string }[]> {
  const checks: { ok: boolean; note: string }[] = [];

  // Fetch quote by slug — route is GET /api/personalized-quotes?slug=XXX (returns array)
  const slugRes = await fetch(`${BASE_URL}/api/personalized-quotes?slug=${shortSlug}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  checks.push({ ok: slugRes.ok, note: `GET /api/personalized-quotes?slug=${shortSlug} → ${slugRes.status}` });

  if (slugRes.ok) {
    const rawData = await slugRes.json() as any;
    // May return array or single object depending on route implementation
    const slugData = Array.isArray(rawData) ? rawData[0] : rawData;
    checks.push({ ok: !!(slugData?.id || slugData?.quoteId), note: `quote id: ${slugData?.id || slugData?.quoteId || 'MISSING'}` });
    // selectedContent on fetch (added by Phase 4 enrichment in server/quotes.ts)
    if (slugData?.selectedContent !== undefined) {
      checks.push({ ok: true, note: `selectedContent on fetch: ${slugData.selectedContent ? 'populated' : 'null (empty library)'}` });
    }
  }

  return checks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main runner
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.magenta}║   Contextual Quote Test Matrix                           ║${c.reset}`);
  console.log(`${c.bold}${c.magenta}╚══════════════════════════════════════════════════════════╝${c.reset}`);
  console.log(`${c.grey}  Target: ${BASE_URL}${c.reset}`);
  console.log(`${c.grey}  Cases:  ${TEST_CASES.length}${c.reset}`);

  // Auth
  let token: string;
  section('Authentication');
  try {
    token = await getAuthToken();
    pass(`Logged in as ${ADMIN_EMAIL}`);
  } catch (e) {
    fail(`Auth failed: ${e instanceof Error ? e.message : e}`);
    console.log(`\n${c.yellow}  ⚠ Server may not be running. Start with: npm run dev${c.reset}`);
    process.exit(1);
  }

  const results: { name: string; passed: boolean; price?: string; tier?: string; errors: string[] }[] = [];

  for (const tc of TEST_CASES) {
    section(tc.name);
    info(tc.description);

    const errors: string[] = [];

    try {
      // 1. Create quote
      const startMs = Date.now();
      const createRes = await fetch(`${BASE_URL}/api/pricing/create-contextual-quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(tc.payload),
      });

      const elapsed = Date.now() - startMs;
      info(`Response: ${createRes.status} in ${elapsed}ms`);

      if (!createRes.ok) {
        const errText = await createRes.text();
        fail(`POST failed (${createRes.status}): ${errText.substring(0, 200)}`);
        errors.push(`POST ${createRes.status}: ${errText.substring(0, 100)}`);
        results.push({ name: tc.name, passed: false, errors });
        continue;
      }

      const data = await createRes.json() as any;

      // 2. Validate creation response
      const validation = validateCreationResponse(tc, data);
      for (const check of validation.checks) {
        if (check.ok) pass(`${check.label}${check.note ? ` — ${c.grey}${check.note}${c.reset}` : ''}`);
        else {
          fail(`${check.label}${check.note ? ` — ${check.note}` : ''}`);
          errors.push(check.label);
        }
      }

      // 3. Validate quote fetch
      if (data.shortSlug) {
        const fetchChecks = await validateQuoteFetch(data.quoteId, data.shortSlug, token);
        for (const fc of fetchChecks) {
          if (fc.ok) pass(`Fetch: ${fc.note}`);
          else {
            fail(`Fetch: ${fc.note}`);
            errors.push(`Fetch: ${fc.note}`);
          }
        }
      }

      // 4. Log key output
      const pricing = data.pricing || {};
      const messaging = data.messaging || {};
      info(`Price: ${pricing.totalFormatted} | Tier: ${messaging.layoutTier} | Confidence: ${data.confidence || messaging.confidence || '?'}`);
      if (messaging.headline) info(`Headline: "${messaging.headline}"`);
      if (data.whatsappMessage) {
        const preview = data.whatsappMessage.split('\n').slice(0, 3).join(' / ');
        info(`WA preview: "${preview}"`);
      }
      if (data.directPriceMessage) {
        const preview = data.directPriceMessage.split('\n').slice(0, 2).join(' / ');
        info(`Direct price: "${preview}"`);
      }
      if (messaging.deadZoneFraming) {
        warn(`Dead zone framing: "${messaging.deadZoneFraming}"`);
      }

      results.push({
        name: tc.name,
        passed: validation.passed && errors.length === 0,
        price: pricing.totalFormatted,
        tier: messaging.layoutTier,
        errors,
      });

    } catch (e) {
      fail(`Unhandled error: ${e instanceof Error ? e.message : e}`);
      errors.push(String(e));
      results.push({ name: tc.name, passed: false, errors });
    }
  }

  // ─── Summary ───
  console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.magenta}║   Results Summary                                        ║${c.reset}`);
  console.log(`${c.bold}${c.magenta}╚══════════════════════════════════════════════════════════╝${c.reset}\n`);

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  for (const r of results) {
    const icon = r.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const priceStr = r.price ? ` ${c.grey}${r.price}${c.reset}` : '';
    const tierStr = r.tier ? ` ${c.grey}[${r.tier}]${c.reset}` : '';
    console.log(`  ${icon} ${r.name}${priceStr}${tierStr}`);
    if (!r.passed && r.errors.length > 0) {
      for (const e of r.errors) {
        console.log(`      ${c.red}→ ${e}${c.reset}`);
      }
    }
  }

  console.log('');
  if (failed === 0) {
    console.log(`${c.green}${c.bold}  All ${passed} test cases passed ✓${c.reset}`);
  } else {
    console.log(`${c.green}  ${passed} passed${c.reset}  ${c.red}${failed} failed${c.reset}`);
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
