/**
 * Generate Test Quotes — Pairwise Combinatorial Testing
 *
 * Creates ~18 quotes covering every pair of signal combinations.
 * Run: npx tsx scripts/generate-test-quotes.ts
 *
 * Output: table of quote slugs with direct URLs to view each one.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5001';

interface TestScenario {
  name: string;
  customerName: string;
  jobDescription: string;
  lines: Array<{
    id: string;
    description: string;
    category: string;
    estimatedMinutes: number;
  }>;
  signals: {
    urgency: 'standard' | 'priority' | 'emergency';
    materialsSupply: 'customer_supplied' | 'we_supply' | 'labor_only';
    timeOfService: 'standard' | 'after_hours' | 'weekend';
    isReturningCustomer: boolean;
    previousJobCount?: number;
    previousAvgPricePence?: number;
  };
}

const scenarios: TestScenario[] = [
  // ── SINGLE JOBS (QUICK layout) ──
  {
    name: '1. Quick — Standard tap fix',
    customerName: 'Alice Standard',
    jobDescription: 'Leaking kitchen tap needs fixing',
    lines: [
      { id: '1', description: 'Fix leaking kitchen tap', category: 'plumbing_minor', estimatedMinutes: 45 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false },
  },
  {
    name: '2. Quick — Emergency tap (we supply)',
    customerName: 'Bob Emergency',
    jobDescription: 'Tap is flooding the kitchen, need someone ASAP with parts',
    lines: [
      { id: '1', description: 'Emergency kitchen tap repair', category: 'plumbing_minor', estimatedMinutes: 45 },
    ],
    signals: { urgency: 'emergency', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
  },
  {
    name: '3. Quick — Priority electrical (weekend)',
    customerName: 'Carol Priority',
    jobDescription: 'Socket stopped working in the kitchen, need it sorted this weekend',
    lines: [
      { id: '1', description: 'Replace faulty kitchen socket', category: 'electrical_minor', estimatedMinutes: 60 },
    ],
    signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'weekend', isReturningCustomer: false },
  },
  {
    name: '4. Quick — Returning customer flat pack',
    customerName: 'Dave Returning',
    jobDescription: 'Got another IKEA wardrobe to build, same as last time',
    lines: [
      { id: '1', description: 'Assemble IKEA PAX wardrobe', category: 'flat_pack', estimatedMinutes: 120 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 5, previousAvgPricePence: 7500 },
  },
  {
    name: '5. Quick — Evening lock change',
    customerName: 'Eve Lockout',
    jobDescription: 'Need front door lock changed, can only do evening',
    lines: [
      { id: '1', description: 'Replace front door lock', category: 'lock_change', estimatedMinutes: 45 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'after_hours', isReturningCustomer: false },
  },
  {
    name: '6. Quick — TV mounting (customer supplies)',
    customerName: 'Frank TVMount',
    jobDescription: 'Mount my 65 inch TV, I have the bracket already',
    lines: [
      { id: '1', description: 'Mount 65 inch TV on brick wall', category: 'tv_mounting', estimatedMinutes: 60 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false },
  },

  // ── 2-3 JOBS (STANDARD layout) ──
  {
    name: '7. Standard — Shelves + flat pack',
    customerName: 'Grace Standard2',
    jobDescription: 'Put up 3 floating shelves in living room and assemble a bookcase',
    lines: [
      { id: '1', description: 'Install 3 floating shelves', category: 'shelving', estimatedMinutes: 60 },
      { id: '2', description: 'Assemble IKEA Billy bookcase', category: 'flat_pack', estimatedMinutes: 60 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false },
  },
  {
    name: '8. Standard — Painting + silicone (weekend)',
    customerName: 'Harry Weekend',
    jobDescription: 'Paint the bathroom ceiling and reseal the bath, Saturday preferred',
    lines: [
      { id: '1', description: 'Paint bathroom ceiling', category: 'painting', estimatedMinutes: 90 },
      { id: '2', description: 'Reseal bath surround', category: 'silicone_sealant', estimatedMinutes: 45 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'weekend', isReturningCustomer: false },
  },
  {
    name: '9. Standard — Door + curtains (returning)',
    customerName: 'Iris Returning',
    jobDescription: 'Hang a new bedroom door and put up curtain rails in 2 rooms',
    lines: [
      { id: '1', description: 'Hang new internal bedroom door', category: 'door_fitting', estimatedMinutes: 120 },
      { id: '2', description: 'Install curtain rails in 2 rooms', category: 'curtain_blinds', estimatedMinutes: 60 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 3, previousAvgPricePence: 9000 },
  },
  {
    name: '10. Standard — Emergency plumbing + electrical',
    customerName: 'Jack Emergency2',
    jobDescription: 'Bathroom tap leaking AND the extractor fan stopped working, urgent',
    lines: [
      { id: '1', description: 'Fix bathroom tap leak', category: 'plumbing_minor', estimatedMinutes: 45 },
      { id: '2', description: 'Replace bathroom extractor fan', category: 'electrical_minor', estimatedMinutes: 60 },
    ],
    signals: { urgency: 'emergency', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: false },
  },
  {
    name: '11. Standard — 3 mixed jobs (priority evening)',
    customerName: 'Karen Priority3',
    jobDescription: 'Need shelves, TV mount, and furniture fix done urgently, evening only',
    lines: [
      { id: '1', description: 'Install floating shelf', category: 'shelving', estimatedMinutes: 30 },
      { id: '2', description: 'Mount TV on plasterboard', category: 'tv_mounting', estimatedMinutes: 60 },
      { id: '3', description: 'Fix broken drawer runners', category: 'furniture_repair', estimatedMinutes: 30 },
    ],
    signals: { urgency: 'priority', materialsSupply: 'labor_only', timeOfService: 'after_hours', isReturningCustomer: false },
  },

  // ── 4+ JOBS (COMPLEX layout) ──
  {
    name: '12. Complex — Full house standard',
    customerName: 'Leo BigJob',
    jobDescription: 'Moving into new house. Need tap fixed, shelves up, wardrobe assembled, door hung, and bathroom resealed',
    lines: [
      { id: '1', description: 'Fix dripping tap', category: 'plumbing_minor', estimatedMinutes: 45 },
      { id: '2', description: 'Install 4 floating shelves', category: 'shelving', estimatedMinutes: 90 },
      { id: '3', description: 'Assemble IKEA wardrobe', category: 'flat_pack', estimatedMinutes: 120 },
      { id: '4', description: 'Hang internal door', category: 'door_fitting', estimatedMinutes: 120 },
      { id: '5', description: 'Reseal bath and shower', category: 'silicone_sealant', estimatedMinutes: 60 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false },
  },
  {
    name: '13. Complex — Weekend full house (we supply)',
    customerName: 'Mia Weekend5',
    jobDescription: 'Big Saturday job. Paint hallway, lay laminate in bedroom, replace kitchen socket, hang blinds, fix fence panel. Bring all materials.',
    lines: [
      { id: '1', description: 'Paint hallway walls and ceiling', category: 'painting', estimatedMinutes: 180 },
      { id: '2', description: 'Lay laminate flooring in bedroom', category: 'flooring', estimatedMinutes: 180 },
      { id: '3', description: 'Replace kitchen double socket', category: 'electrical_minor', estimatedMinutes: 45 },
      { id: '4', description: 'Install roller blinds in 3 windows', category: 'curtain_blinds', estimatedMinutes: 60 },
      { id: '5', description: 'Replace broken fence panel', category: 'fencing', estimatedMinutes: 90 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'weekend', isReturningCustomer: false },
  },
  {
    name: '14. Complex — Returning loyal customer',
    customerName: 'Nate Loyal',
    jobDescription: 'Back again! Tile the kitchen splashback, plaster patch in hallway, hang new front door, pressure wash the patio',
    lines: [
      { id: '1', description: 'Tile kitchen splashback', category: 'tiling', estimatedMinutes: 180 },
      { id: '2', description: 'Patch plaster in hallway', category: 'plastering', estimatedMinutes: 90 },
      { id: '3', description: 'Hang new front door', category: 'door_fitting', estimatedMinutes: 180 },
      { id: '4', description: 'Pressure wash patio', category: 'pressure_washing', estimatedMinutes: 120 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard', isReturningCustomer: true, previousJobCount: 12, previousAvgPricePence: 11000 },
  },

  // ── EDGE CASES ──
  {
    name: '15. Edge — "Other" category (human review)',
    customerName: 'Olivia Other',
    jobDescription: 'Need help moving heavy furniture around the house and general tidying',
    lines: [
      { id: '1', description: 'Heavy furniture moving and rearrangement', category: 'other', estimatedMinutes: 120 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard', isReturningCustomer: false },
  },
  {
    name: '16. Edge — Maximum urgency + evening + we supply',
    customerName: 'Pete MaxUrgent',
    jobDescription: 'Emergency! Pipe burst under kitchen sink, water everywhere, need someone tonight with parts',
    lines: [
      { id: '1', description: 'Emergency pipe repair under kitchen sink', category: 'plumbing_minor', estimatedMinutes: 60 },
    ],
    signals: { urgency: 'emergency', materialsSupply: 'we_supply', timeOfService: 'after_hours', isReturningCustomer: false },
  },
  {
    name: '17. Edge — Budget single job (customer supplies)',
    customerName: 'Quinn Budget',
    jobDescription: 'Just need someone to put up a single shelf, I have the shelf and brackets',
    lines: [
      { id: '1', description: 'Install single floating shelf', category: 'shelving', estimatedMinutes: 20 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard', isReturningCustomer: false },
  },
  {
    name: '18. Edge — Waste removal + garden (weekend returning)',
    customerName: 'Rosa GardenClear',
    jobDescription: 'Clear the garden shed, take away old furniture, tidy the garden. Used you before.',
    lines: [
      { id: '1', description: 'Clear out garden shed', category: 'waste_removal', estimatedMinutes: 120 },
      { id: '2', description: 'Remove old furniture (sofa + table)', category: 'waste_removal', estimatedMinutes: 60 },
      { id: '3', description: 'Garden tidying and hedge trim', category: 'garden_maintenance', estimatedMinutes: 120 },
    ],
    signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'weekend', isReturningCustomer: true, previousJobCount: 2, previousAvgPricePence: 8500 },
  },
];

async function generateQuote(scenario: TestScenario) {
  const body = {
    customerName: scenario.customerName,
    phone: `0770090${String(Math.floor(Math.random() * 9000) + 1000)}`,
    jobDescription: scenario.jobDescription,
    lines: scenario.lines,
    signals: scenario.signals,
  };

  const res = await fetch(`${BASE_URL}/api/pricing/create-contextual-quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    return { error: err };
  }

  return res.json();
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║          CONTEXTUAL QUOTE TEST GENERATOR                    ║');
  console.log('║          Generating 18 pairwise test quotes...              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results: Array<{
    name: string;
    slug: string;
    url: string;
    price: string;
    layout: string;
    bookingModes: string[];
    headline: string;
    humanReview: boolean;
    error?: string;
  }> = [];

  for (const scenario of scenarios) {
    process.stdout.write(`  Generating: ${scenario.name}...`);
    try {
      const data = await generateQuote(scenario);

      if (data.error) {
        console.log(` ❌ ${data.error}`);
        results.push({
          name: scenario.name,
          slug: '-',
          url: '-',
          price: '-',
          layout: '-',
          bookingModes: [],
          headline: '-',
          humanReview: false,
          error: data.error,
        });
        continue;
      }

      const localUrl = `http://localhost:5001/quote/${data.shortSlug}`;
      console.log(` ✅ ${data.pricing.totalFormatted}`);
      results.push({
        name: scenario.name,
        slug: data.shortSlug,
        url: localUrl,
        price: data.pricing.totalFormatted,
        layout: data.messaging.layoutTier,
        bookingModes: data.messaging.bookingModes || [],
        headline: data.messaging.headline,
        humanReview: data.messaging.requiresHumanReview || false,
      });
    } catch (err: any) {
      console.log(` ❌ ${err.message}`);
      results.push({
        name: scenario.name,
        slug: '-',
        url: '-',
        price: '-',
        layout: '-',
        bookingModes: [],
        headline: '-',
        humanReview: false,
        error: err.message,
      });
    }
  }

  // Print results table
  console.log('\n\n' + '═'.repeat(120));
  console.log('  RESULTS');
  console.log('═'.repeat(120));

  console.log(
    '\n  ' +
    padRight('#', 4) +
    padRight('Scenario', 42) +
    padRight('Price', 10) +
    padRight('Layout', 10) +
    padRight('Booking Modes', 35) +
    'Review'
  );
  console.log('  ' + '─'.repeat(110));

  for (const r of results) {
    if (r.error) {
      console.log(`  ${padRight(r.name, 46)} ❌ ERROR: ${r.error.substring(0, 60)}`);
      continue;
    }
    const num = r.name.split('.')[0];
    const scenarioName = r.name.split('— ')[1] || r.name;
    const modes = r.bookingModes.map(m => {
      if (m === 'standard_date') return '📅';
      if (m === 'flexible_discount') return '💰-10%';
      if (m === 'urgent_premium') return '⚡urgent';
      if (m === 'deposit_split') return '💳split';
      return m;
    }).join(' ');

    console.log(
      '  ' +
      padRight(num, 4) +
      padRight(scenarioName, 42) +
      padRight(r.price, 10) +
      padRight(r.layout.toUpperCase(), 10) +
      padRight(modes, 35) +
      (r.humanReview ? '⚠️  YES' : '✅')
    );
  }

  // Print headlines
  console.log('\n\n' + '═'.repeat(120));
  console.log('  HEADLINES & URLS');
  console.log('═'.repeat(120) + '\n');

  for (const r of results) {
    if (r.error) continue;
    const num = r.name.split('.')[0];
    console.log(`  ${padRight(num, 4)} "${r.headline}"`);
    console.log(`       ${r.url}`);
    console.log('');
  }

  // Summary
  const total = results.filter(r => !r.error).length;
  const errors = results.filter(r => r.error).length;
  const quick = results.filter(r => r.layout === 'quick').length;
  const standard = results.filter(r => r.layout === 'standard').length;
  const complex = results.filter(r => r.layout === 'complex').length;
  const withFlexible = results.filter(r => r.bookingModes.includes('flexible_discount')).length;
  const withUrgent = results.filter(r => r.bookingModes.includes('urgent_premium')).length;
  const withDeposit = results.filter(r => r.bookingModes.includes('deposit_split')).length;
  const needsReview = results.filter(r => r.humanReview).length;

  console.log('═'.repeat(120));
  console.log('  COVERAGE SUMMARY');
  console.log('═'.repeat(120));
  console.log(`\n  Total generated: ${total} / ${scenarios.length}  (${errors} errors)`);
  console.log(`  Layout tiers:    Quick=${quick}  Standard=${standard}  Complex=${complex}`);
  console.log(`  Booking modes:   📅 date=ALL  💰 flexible=${withFlexible}  ⚡ urgent=${withUrgent}  💳 deposit=${withDeposit}`);
  console.log(`  Human review:    ${needsReview} quotes flagged`);
  console.log(`\n  Open any URL above to view the customer-facing quote page.\n`);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}

main().catch(console.error);
