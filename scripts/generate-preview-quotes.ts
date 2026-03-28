/**
 * generate-preview-quotes.ts
 *
 * Generates 20+ real persisted quotes across all meaningful combinations:
 * - Layout tiers: quick / standard / complex
 * - Customer types: homeowner, landlord, remote landlord, property manager, commercial, OAP, busy pro
 * - Urgency: standard / priority / emergency
 * - Materials: labor_only / we_supply / customer_supplied
 * - Time of service: standard / after_hours / weekend
 * - VA context: none / thin / rich
 * - Returning customer: yes / no
 * - Dead zone band (£100-£200)
 * - Batch (multiple lines)
 *
 * Outputs: preview URLs, headline, price, managedTierAvailable, WA message snippet
 * for visual rating.
 */

const PORT = process.env.PORT || '49453';
const BASE = `http://localhost:${PORT}`;
const QUOTE_BASE = `http://localhost:${PORT}/quote`;

interface QuoteCase {
  label: string;
  tier: 'quick' | 'standard' | 'complex';
  body: Record<string, unknown>;
}

const CASES: QuoteCase[] = [
  // ── QUICK TIER (1 line, simple job) ─────────────────────────────────────
  {
    label: '1. Quick / Homeowner / No context / Shelf',
    tier: 'quick',
    body: {
      customerName: 'Sarah Mitchell',
      phone: '07700900001',
      email: 'sarah@test.com',
      postcode: 'NG1 1AA',
      lines: [{ id: 'l1', description: 'Fix a loose towel rail in bathroom', category: 'general_fixing', estimatedMinutes: 20 }],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: '',
      createdBy: 'va_test',
    },
  },
  {
    label: '2. Quick / Homeowner / Thin context / TV mount',
    tier: 'quick',
    body: {
      customerName: 'James Fletcher',
      phone: '07700900002',
      postcode: 'NG2 2BB',
      lines: [{ id: 'l1', description: 'Wall mount a 55" TV in living room', category: 'tv_mounting', estimatedMinutes: 45 }],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Homeowner. Just wants it done quickly.',
      createdBy: 'va_test',
    },
  },
  {
    label: '3. Quick / Busy pro / Rich context / Curtain pole',
    tier: 'quick',
    body: {
      customerName: 'Priya Sharma',
      phone: '07700900003',
      postcode: 'NG3 3CC',
      lines: [{ id: 'l1', description: 'Fit a curtain pole in the bedroom', category: 'curtain_blinds', estimatedMinutes: 25 }],
      signals: { urgency: 'priority', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 2, previousAvgPricePence: 6500 },
      vaContext: 'Priya is a returning customer — she used us last month for shelves. Very busy, works from home, just wants someone to sort it fast. She said she\'d be in all day Thursday.',
      createdBy: 'va_test',
    },
  },

  // ── STANDARD TIER (1-2 lines, mid complexity) ────────────────────────────
  {
    label: '4. Standard / Remote landlord / Rich context / Tap repair',
    tier: 'standard',
    body: {
      customerName: 'Michael Okafor',
      phone: '07700900004',
      postcode: 'NG4 4DD',
      lines: [{ id: 'l1', description: 'Dripping bathroom tap — washer replacement', category: 'plumbing_minor', estimatedMinutes: 45 }],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Michael is a landlord, lives about 90 minutes away. Tenant reported the tap. He can\'t be there — tenant will let us in. Wants photo proof sent after the job and a tax-ready invoice.',
      createdBy: 'va_test',
    },
  },
  {
    label: '5. Standard / Homeowner / Dead zone / Door fitting',
    tier: 'standard',
    body: {
      customerName: 'Carol Jennings',
      phone: '07700900005',
      postcode: 'NG5 5EE',
      lines: [{ id: 'l1', description: 'Hang an internal door — door supplied by customer', category: 'door_fitting', estimatedMinutes: 120 }],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Carol is a homeowner, the door has been sitting in her hallway for 3 weeks. She mentioned budget — said she\'s already spent a lot on the renovation.',
      createdBy: 'va_test',
    },
  },
  {
    label: '6. Standard / OAP / Trust-seeker / Shelf mounting',
    tier: 'standard',
    body: {
      customerName: 'Derek Hobson',
      phone: '07700900006',
      postcode: 'NG6 6FF',
      lines: [
        { id: 'l1', description: 'Mount 3 floating shelves in dining room', category: 'shelving', estimatedMinutes: 45 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Derek is in his 70s, lives alone. He was nervous on the call — asked a lot of questions about who would come. Mentioned his neighbour recommended us. He wants someone reliable and tidy.',
      createdBy: 'va_test',
    },
  },
  {
    label: '7. Standard / Commercial / After hours / Socket install',
    tier: 'standard',
    body: {
      customerName: 'Rosa Barbershop',
      phone: '07700900007',
      postcode: 'NG7 7GG',
      lines: [{ id: 'l1', description: 'Install 2 double sockets behind barber chairs', category: 'electrical_minor', estimatedMinutes: 90 }],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'after_hours', isReturningCustomer: false },
      vaContext: 'It\'s a barbershop. Rosa needs the work done after 7pm — shop closes then. She mentioned it\'s urgent because she\'s getting a new clipper station delivered Monday.',
      createdBy: 'va_test',
    },
  },
  {
    label: '8. Standard / Returning landlord / Loyalty / Silicone',
    tier: 'standard',
    body: {
      customerName: 'Fatima Hassan',
      phone: '07700900008',
      postcode: 'NG8 8HH',
      lines: [{ id: 'l1', description: 'Full bathroom silicone re-seal — bath and shower tray', category: 'silicone_sealant', estimatedMinutes: 60 }],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 4, previousAvgPricePence: 8500 },
      vaContext: 'Fatima is a returning landlord — been with us about 8 months. She has 3 properties, sends jobs our way regularly. This one is a rental in NG8, tenant is fine to give access. She always wants the invoice by email same day.',
      createdBy: 'va_test',
    },
  },
  {
    label: '9. Standard / Emergency / Burst pipe / No context',
    tier: 'standard',
    body: {
      customerName: 'Tom Briggs',
      phone: '07700900009',
      postcode: 'NG9 9II',
      lines: [{ id: 'l1', description: 'Burst pipe under kitchen sink — water leaking', category: 'plumbing_minor', estimatedMinutes: 45 }],
      signals: { urgency: 'emergency', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: '',
      createdBy: 'va_test',
    },
  },
  {
    label: '10. Standard / Weekend / Price-conscious / Lock change',
    tier: 'standard',
    body: {
      customerName: 'Diane Pearce',
      phone: '07700900010',
      postcode: 'NG10 1JJ',
      lines: [{ id: 'l1', description: 'Change front door lock — lost keys', category: 'lock_change', estimatedMinutes: 45 }],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'weekend', isReturningCustomer: false },
      vaContext: 'Diane lost her keys, wants it done this weekend. She asked about the price twice and mentioned she\'d got a quote from someone else for £60. She seemed price-sensitive.',
      createdBy: 'va_test',
    },
  },
  {
    label: '11. Standard / Property manager / Portfolio / Tiling',
    tier: 'standard',
    body: {
      customerName: 'Rohan Properties',
      phone: '07700900011',
      postcode: 'NG11 2KK',
      lines: [{ id: 'l1', description: 'Re-tile shower area in rental flat, approx 2sqm', category: 'tiling', estimatedMinutes: 180 }],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 7, previousAvgPricePence: 14000 },
      vaContext: 'This is Rohan — he manages a portfolio of about 15 rental properties in Nottingham. He\'s looking to consolidate to one supplier. His previous plumber let him down and he\'s frustrated. He needs photo reports and invoices to go to his accountant. Very professional, not price sensitive.',
      createdBy: 'va_test',
    },
  },

  // ── COMPLEX TIER (3+ lines) ──────────────────────────────────────────────
  {
    label: '12. Complex / Homeowner / Batch 3 / Kitchen list',
    tier: 'complex',
    body: {
      customerName: 'Alison Grant',
      phone: '07700900012',
      postcode: 'NG12 3LL',
      lines: [
        { id: 'l1', description: 'Replace 5 kitchen cabinet door handles', category: 'general_fixing', estimatedMinutes: 30 },
        { id: 'l2', description: 'Fix squeaky kitchen door hinge', category: 'general_fixing', estimatedMinutes: 20 },
        { id: 'l3', description: 'Assemble a flat pack kitchen island (IKEA)', category: 'flat_pack', estimatedMinutes: 90 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Alison has just moved in and has a long list of little jobs. She mentioned she\'s been putting it off for weeks. She\'s a homeowner, will be in all day Saturday.',
      createdBy: 'va_test',
    },
  },
  {
    label: '13. Complex / Remote landlord / Managed signals / 3 jobs',
    tier: 'complex',
    body: {
      customerName: 'Phil Dawson',
      phone: '07700900013',
      postcode: 'NG13 4MM',
      lines: [
        { id: 'l1', description: 'Replace dripping bathroom tap', category: 'plumbing_minor', estimatedMinutes: 45 },
        { id: 'l2', description: 'Fix a broken towel rail in bathroom', category: 'general_fixing', estimatedMinutes: 20 },
        { id: 'l3', description: 'Repair cracked bathroom silicone around bath', category: 'silicone_sealant', estimatedMinutes: 45 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Phil is a landlord — he doesn\'t live near the property. Tenant is in and happy to give access. He wants photo proof of all three jobs done. Needs to collect the key from the estate agent first.',
      createdBy: 'va_test',
    },
  },
  {
    label: '14. Complex / Commercial / After hours / 4 jobs',
    tier: 'complex',
    body: {
      customerName: 'Westside Cafe',
      phone: '07700900014',
      postcode: 'NG14 5NN',
      lines: [
        { id: 'l1', description: 'Replace faulty light switch behind counter', category: 'electrical_minor', estimatedMinutes: 30 },
        { id: 'l2', description: 'Fix broken cabinet door in kitchen', category: 'carpentry', estimatedMinutes: 30 },
        { id: 'l3', description: 'Repair loose floor tile near entrance', category: 'tiling', estimatedMinutes: 45 },
        { id: 'l4', description: 'Re-seal around commercial sink', category: 'silicone_sealant', estimatedMinutes: 30 },
      ],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'after_hours', isReturningCustomer: false },
      vaContext: 'It\'s a cafe in the city centre. They need everything done after closing — they close at 6pm. Owner said they had a health inspection last month and want everything sorted before the next one.',
      createdBy: 'va_test',
    },
  },
  {
    label: '15. Complex / Homeowner / Batch 3 / Painting + fixes',
    tier: 'complex',
    body: {
      customerName: 'Kevin Walsh',
      phone: '07700900015',
      postcode: 'NG15 6OO',
      lines: [
        { id: 'l1', description: 'Paint the hallway walls — customer supplying paint', category: 'painting', estimatedMinutes: 180 },
        { id: 'l2', description: 'Fix 2 sticking internal doors', category: 'door_fitting', estimatedMinutes: 60 },
        { id: 'l3', description: 'Mount a large mirror in hallway', category: 'shelving', estimatedMinutes: 30 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Kevin is selling the house — estate agents coming in 2 weeks. He wants it looking sharp. He\'s relaxed but mentioned he\'d like it done by end of next week if possible.',
      createdBy: 'va_test',
    },
  },

  // ── EDGE CASES ───────────────────────────────────────────────────────────
  {
    label: '16. Quick / Emergency / No context / Gutter',
    tier: 'quick',
    body: {
      customerName: 'Laura Simmons',
      phone: '07700900016',
      postcode: 'NG16 7PP',
      lines: [{ id: 'l1', description: 'Clear blocked gutter over front door — water pouring in', category: 'guttering', estimatedMinutes: 30 }],
      signals: { urgency: 'emergency', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: '',
      createdBy: 'va_test',
    },
  },
  {
    label: '17. Standard / Tenant / Price-conscious / Flat pack',
    tier: 'standard',
    body: {
      customerName: 'Zara Ahmed',
      phone: '07700900017',
      postcode: 'NG17 8QQ',
      lines: [{ id: 'l1', description: 'Assemble a 3-door IKEA wardrobe (PAX)', category: 'flat_pack', estimatedMinutes: 120 }],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'weekend', isReturningCustomer: false },
      vaContext: 'Zara is renting, she said she just moved in and IKEA delivered the wardrobe this morning. She mentioned she doesn\'t have much budget — asked if we could do it for £40.',
      createdBy: 'va_test',
    },
  },
  {
    label: '18. Standard / Airbnb host / Remote / Pressure wash',
    tier: 'standard',
    body: {
      customerName: 'Ben Carter',
      phone: '07700900018',
      postcode: 'NG18 9RR',
      lines: [{ id: 'l1', description: 'Pressure wash front driveway and patio', category: 'pressure_washing', estimatedMinutes: 120 }],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Ben runs an Airbnb — he won\'t be at the property. Guest checks out Friday so needs it done Saturday morning. He said he\'d leave the gate unlocked. Wants a photo sent after so he can see before the next guests arrive Saturday evening.',
      createdBy: 'va_test',
    },
  },
  {
    label: '19. Complex / Property manager / We supply / 5 lines',
    tier: 'complex',
    body: {
      customerName: 'City Lets Management',
      phone: '07700900019',
      postcode: 'NG19 1SS',
      lines: [
        { id: 'l1', description: 'Replace bathroom tap — dripping', category: 'plumbing_minor', estimatedMinutes: 45 },
        { id: 'l2', description: 'Fix toilet flush mechanism', category: 'plumbing_minor', estimatedMinutes: 30 },
        { id: 'l3', description: 'Repair hole in bedroom wall (plasterboard)', category: 'plastering', estimatedMinutes: 60 },
        { id: 'l4', description: 'Re-hang a cupboard door in kitchen', category: 'carpentry', estimatedMinutes: 30 },
        { id: 'l5', description: 'Replace broken towel rail in bathroom', category: 'general_fixing', estimatedMinutes: 20 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 12, previousAvgPricePence: 18000 },
      vaContext: 'City Lets manages a block of 8 flats. The property manager called — she has a list. She needs all this done before a new tenant moves in next Friday. Tenant currently out. She wants one invoice for the whole job, photo report of each task, and key pickup from their office on Mansfield Road.',
      createdBy: 'va_test',
    },
  },
  {
    label: '20. Standard / Emergency / Rich stress context / Boiler area leak',
    tier: 'standard',
    body: {
      customerName: 'Andy Morrison',
      phone: '07700900020',
      postcode: 'NG20 2TT',
      lines: [{ id: 'l1', description: 'Leaking pipe joint near boiler — water dripping on floor', category: 'plumbing_minor', estimatedMinutes: 60 }],
      signals: { urgency: 'emergency', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
      vaContext: 'Andy sounds stressed — he noticed water this morning. He\'s got young kids in the house and is worried about the electrics nearby. He said he\'s tried two other plumbers and can\'t get anyone. He\'s at home all day and just needs someone today.',
      createdBy: 'va_test',
    },
  },
  {
    label: '21. Quick / Returning pro / Thin context / Furniture repair',
    tier: 'quick',
    body: {
      customerName: 'Claire Booth',
      phone: '07700900021',
      postcode: 'NG21 3UU',
      lines: [{ id: 'l1', description: 'Repair a broken chair leg — wooden dining chair', category: 'furniture_repair', estimatedMinutes: 20 }],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 1, previousAvgPricePence: 5500 },
      vaContext: 'Returning customer. Chair leg broke.',
      createdBy: 'va_test',
    },
  },
  {
    label: '22. Complex / Pre-sale / Homeowner / 4 jobs / Weekend',
    tier: 'complex',
    body: {
      customerName: 'Gareth Evans',
      phone: '07700900022',
      postcode: 'NG22 4VV',
      lines: [
        { id: 'l1', description: 'Fill and repaint scuffed hallway walls', category: 'painting', estimatedMinutes: 120 },
        { id: 'l2', description: 'Fix sticking front door', category: 'door_fitting', estimatedMinutes: 45 },
        { id: 'l3', description: 'Re-seal around bath', category: 'silicone_sealant', estimatedMinutes: 45 },
        { id: 'l4', description: 'Replace broken fence panel at rear of garden', category: 'fencing', estimatedMinutes: 120 },
      ],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'weekend', isReturningCustomer: false },
      vaContext: 'Gareth is putting his house on the market in 3 weeks. Estate agent coming to value it. He wants it looking its best — keen to get multiple jobs done in one hit to keep cost down. Will be home all weekend.',
      createdBy: 'va_test',
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

// Lazy headline endings that signal the LLM didn't do outcome framing
const BANNED_HEADLINE_ENDINGS = ['Done', 'Sorted', 'Complete', 'Finished', 'Work Done', 'Job Done'];

interface SpecCheck {
  pass: boolean;
  label: string;
  detail?: string;
}

interface QuoteResult {
  label: string;
  slug: string;
  url: string;
  headline: string;
  pricePence: number;
  price: string;
  managedTierAvailable: boolean;
  layoutTier: string;
  waSnippet: string;
  guaranteePresent: boolean;
  directPricePresent: boolean;
  addOnPricingPresent: boolean;
  addOnBundleCorrect: boolean;
  specChecks: SpecCheck[];
  error?: string;
}

function checkSpec(c: QuoteCase, data: Record<string, unknown>, result: Omit<QuoteResult, 'specChecks'>): SpecCheck[] {
  const checks: SpecCheck[] = [];
  const pricePence = result.pricePence;
  const waMsg = (data.whatsappMessage as string) || '';
  const body = c.body as Record<string, unknown>;
  const signals = (body.signals || {}) as Record<string, unknown>;
  const vaCtx = ((body.vaContext as string) || '').toLowerCase();

  // 1. Guarantee: must fire on non-quick OR emergency OR price >= £75
  const shouldHaveGuarantee = result.layoutTier !== 'quick' || signals.urgency === 'emergency' || pricePence >= 7500;
  checks.push({
    pass: shouldHaveGuarantee ? result.guaranteePresent : true,
    label: 'Guarantee threshold',
    detail: shouldHaveGuarantee
      ? (result.guaranteePresent ? 'Present ✓' : `MISSING — tier:${result.layoutTier} price:£${(pricePence/100).toFixed(0)} urgency:${signals.urgency}`)
      : 'Not required at this price/tier',
  });

  // 2. Headline: no banned lazy endings
  const bannedEnding = BANNED_HEADLINE_ENDINGS.find(b => result.headline.endsWith(b));
  checks.push({
    pass: !bannedEnding,
    label: 'Headline outcome-first',
    detail: bannedEnding ? `BANNED ending "${bannedEnding}" in: "${result.headline}"` : `OK: "${result.headline}"`,
  });

  // 3. managedTierAvailable: must detect landlord/tenant/remote signals in vaContext
  const hasManagedSignal = ['remote', 'away', 'tenant', 'photo', 'key', 'landlord', 'not there', 'won\'t be', 'can\'t be', 'send me', 'rental', 'airbnb'].some(kw => vaCtx.includes(kw));
  if (hasManagedSignal) {
    checks.push({
      pass: result.managedTierAvailable,
      label: 'Managed tier detected from context',
      detail: result.managedTierAvailable ? 'Detected ✓' : 'MISSING — managed signals in vaContext but not flagged',
    });
  }

  // 4. addOnPricing: must always be present in response
  checks.push({
    pass: result.addOnPricingPresent,
    label: 'addOnPricing in response',
    detail: result.addOnPricingPresent ? 'Present ✓' : 'MISSING from API response',
  });

  // 5. addOnPricing bundle: £55, saving £20 (7500 - 5500 = 2000p)
  checks.push({
    pass: result.addOnBundleCorrect,
    label: 'Bundle pricing correct (£55, save £20)',
    detail: result.addOnBundleCorrect ? '£55 bundle ✓' : 'Bundle price/saving incorrect',
  });

  // 6. Quick tier must have directPriceMessage
  if (result.layoutTier === 'quick') {
    checks.push({
      pass: result.directPricePresent,
      label: 'Direct price message (quick tier)',
      detail: result.directPricePresent ? 'Present ✓' : 'MISSING — quick tier should have inline price message',
    });
  }

  // 7. WA message must not start a line with banned phrases
  const bannedInWA = ['money-back', 'certified', 'guaranteed same day', '24/7', '#1', 'award'];
  const waLower = waMsg.toLowerCase();
  const bannedFound = bannedInWA.find(b => waLower.includes(b));
  checks.push({
    pass: !bannedFound,
    label: 'No banned phrases in WA message',
    detail: bannedFound ? `BANNED phrase "${bannedFound}" in WA message` : 'Clean ✓',
  });

  return checks;
}

async function run() {
  console.log('\n🧪 Generating 22 test quotes — full spec validation...\n');
  const results: QuoteResult[] = [];

  for (const c of CASES) {
    try {
      const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      });

      if (!res.ok) {
        const err = await res.text();
        results.push({ label: c.label, slug: '?', url: '?', headline: 'ERROR', pricePence: 0, price: '?', managedTierAvailable: false, layoutTier: '?', waSnippet: err.slice(0, 80), guaranteePresent: false, directPricePresent: false, addOnPricingPresent: false, addOnBundleCorrect: false, specChecks: [], error: err });
        continue;
      }

      const data = await res.json() as Record<string, unknown>;
      const slug = data.shortSlug as string;
      const headline = (data.messaging as any)?.headline || '—';
      const pricePence = (data.pricing as any)?.totalPence || 0;
      const price = (data.pricing as any)?.totalFormatted || '?';
      const layoutTier = (data.messaging as any)?.layoutTier || '?';
      const managedTierAvailable = (data.managedTierAvailable as boolean) || false;
      const waMsg: string = (data.whatsappMessage as string) || '';
      const waSnippet = waMsg.split('\n').filter((l: string) => l.trim()).slice(1, 3).join(' | ').slice(0, 100);
      const guaranteePresent = waMsg.includes('Handy Services Promise');
      const directPricePresent = !!(data.directPriceMessage as string);
      const addOnPricing = data.addOnPricing as Record<string, unknown> | undefined;
      const addOnPricingPresent = !!addOnPricing;
      const addOnBundleCorrect = addOnPricingPresent
        && (addOnPricing as any).bundlePricePence === 5500
        && (addOnPricing as any).bundleSavingPence === 2000;

      const partial: Omit<QuoteResult, 'specChecks'> = {
        label: c.label, slug, url: `${QUOTE_BASE}/${slug}`, headline,
        pricePence, price, managedTierAvailable, layoutTier,
        waSnippet, guaranteePresent, directPricePresent,
        addOnPricingPresent, addOnBundleCorrect,
      };
      const specChecks = checkSpec(c, data, partial);
      const allPass = specChecks.every(s => s.pass);

      results.push({ ...partial, specChecks });

      const managed = managedTierAvailable ? '🏠' : '  ';
      const guar = guaranteePresent ? '🛡️' : '  ';
      const status = allPass ? '✅' : '⚠️';
      console.log(`${status}${managed}${guar} [${layoutTier.padEnd(8)}] ${price.padEnd(6)} | ${headline.padEnd(40)} | ${c.label}`);
    } catch (e) {
      results.push({ label: c.label, slug: '?', url: '?', headline: 'FETCH ERROR', pricePence: 0, price: '?', managedTierAvailable: false, layoutTier: '?', waSnippet: String(e), guaranteePresent: false, directPricePresent: false, addOnPricingPresent: false, addOnBundleCorrect: false, specChecks: [], error: String(e) });
      console.log(`❌ ${c.label} — ${e}`);
    }
  }

  // ── Summary report ────────────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════════');
  console.log('📊 FULL SPEC VALIDATION REPORT');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);
  const managedDetected = results.filter(r => r.managedTierAvailable);
  const guaranteeCount = results.filter(r => r.guaranteePresent);
  const addOnOk = results.filter(r => r.addOnPricingPresent);
  const bundleOk = results.filter(r => r.addOnBundleCorrect);

  // Count spec check failures across all quotes
  const allChecks = passed.flatMap(r => r.specChecks);
  const failedChecks = allChecks.filter(s => !s.pass);

  console.log(`✅ Generated: ${passed.length}/${results.length}`);
  console.log(`❌ API Failed: ${failed.length}`);
  console.log(`🏠 Managed tier detected: ${managedDetected.length} quotes`);
  console.log(`🛡️  Guarantee in WA: ${guaranteeCount.length} quotes`);
  console.log(`📦 addOnPricing present: ${addOnOk.length}/${passed.length}`);
  console.log(`💰 Bundle price correct: ${bundleOk.length}/${passed.length}`);
  console.log(`\n⚠️  Spec check failures: ${failedChecks.length}/${allChecks.length}`);

  if (failedChecks.length > 0) {
    console.log('\n── Failed Spec Checks ────────────────────────────────────────────────\n');
    for (const r of passed) {
      const bad = r.specChecks.filter(s => !s.pass);
      if (bad.length > 0) {
        console.log(`  ${r.label}`);
        for (const b of bad) {
          console.log(`    ⚠️  [${b.label}] ${b.detail}`);
        }
      }
    }
  }

  console.log('\n── Preview URLs ──────────────────────────────────────────────────────\n');
  for (const r of passed) {
    const allPass = r.specChecks.every(s => s.pass);
    console.log(`${allPass ? '✅' : '⚠️ '} ${r.label}`);
    console.log(`   🔗 ${r.url}`);
    console.log(`   💬 "${r.headline}" | ${r.price} | ${r.layoutTier}${r.managedTierAvailable ? ' | 🏠' : ''}${r.guaranteePresent ? ' | 🛡️' : ''}`);
    console.log(`   📱 ${r.waSnippet}`);
    console.log();
  }

  if (failed.length > 0) {
    console.log('\n── API Failures ──────────────────────────────────────────────────────\n');
    for (const r of failed) {
      console.log(`❌ ${r.label}: ${r.error?.slice(0, 120)}`);
    }
  }

  console.log('\n── All URLs ──────────────────────────────────────────────────────────\n');
  for (const r of passed) {
    console.log(r.url);
  }
}

run().catch(console.error);
