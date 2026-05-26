/**
 * Seed 10 random contextual test quotes spanning categories / locations /
 * situations, then print a "Who fits this job" summary for each.
 *
 * Usage:
 *   BASE_URL=http://localhost:57717 npx tsx scripts/seed-fit-test-quotes.ts
 *   (defaults to http://localhost:57717)
 */

import { findCandidateContractors } from '../server/contractor-matcher';
import type { JobCategory } from '../shared/contextual-pricing-types';

type Scenario = {
  label: string;
  customerName: string;
  phone: string;
  address: string;
  postcode: string;
  coords: { lat: number; lng: number };
  vaContext: string;
  signals?: {
    urgency?: 'standard' | 'priority' | 'emergency';
    materialsSupply?: 'customer_supplied' | 'we_supply' | 'labor_only';
    timeOfService?: 'standard' | 'after_hours' | 'weekend';
    isReturningCustomer?: boolean;
    previousJobCount?: number;
    previousAvgPricePence?: number;
  };
  lines: Array<{
    description: string;
    category: JobCategory;
    estimatedMinutes: number;
  }>;
};

const today = new Date();
const ymd = (offset: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const SCENARIOS: Scenario[] = [
  {
    label: '1. Single TV mount (common · Lenton NG7)',
    customerName: 'Amir Patel',
    phone: '07700900111',
    address: '14 Lenton Boulevard',
    postcode: 'NG7 2BY',
    coords: { lat: 52.9389, lng: -1.1789 },
    vaContext: 'New 55-inch TV needs mounting above the fireplace, no rush.',
    lines: [
      { description: 'Mount 55-inch TV above living-room fireplace', category: 'tv_mounting', estimatedMinutes: 90 },
    ],
  },
  {
    label: '2. Emergency leak (Sherwood NG5)',
    customerName: 'Helen Wright',
    phone: '07700900112',
    address: '22 Mansfield Road',
    postcode: 'NG5 3FN',
    coords: { lat: 52.9844, lng: -1.1532 },
    vaContext: 'Kitchen tap is dripping fast, water pooling under the sink. Needs sorting today.',
    signals: { urgency: 'emergency' },
    lines: [
      { description: 'Fix dripping kitchen tap, check seal under sink', category: 'plumbing_minor', estimatedMinutes: 75 },
    ],
  },
  {
    label: '3. Multi-line move-in (Beeston NG9)',
    customerName: 'Sarah Mitchell',
    phone: '07700900113',
    address: '8 High Road',
    postcode: 'NG9 2JP',
    coords: { lat: 52.9268, lng: -1.2156 },
    vaContext: 'Just moved in — IKEA wardrobe to assemble, 3 floating shelves, and TV to mount in bedroom.',
    lines: [
      { description: 'Assemble IKEA PAX wardrobe', category: 'flat_pack', estimatedMinutes: 180 },
      { description: 'Hang 3 floating shelves in living room', category: 'shelving', estimatedMinutes: 60 },
      { description: 'Mount 50-inch TV on bedroom wall', category: 'tv_mounting', estimatedMinutes: 75 },
    ],
  },
  {
    label: '4. Plaster + tile (Mapperley NG3)',
    customerName: 'Jamie Foster',
    phone: '07700900114',
    address: '45 Woodborough Road',
    postcode: 'NG3 5QF',
    coords: { lat: 52.9683, lng: -1.1234 },
    vaContext: 'Bathroom wall — patch up plaster damage after old tiles came off, then retile the splashback.',
    lines: [
      { description: 'Patch-plaster bathroom wall after old tiles removed', category: 'plastering', estimatedMinutes: 120 },
      { description: 'Retile 2m² splashback area above sink', category: 'tiling', estimatedMinutes: 240 },
    ],
  },
  {
    label: '5. External jobs (Wollaton NG8)',
    customerName: 'Marcus Lee',
    phone: '07700900115',
    address: '12 Bramcote Lane',
    postcode: 'NG8 2NF',
    coords: { lat: 52.9633, lng: -1.2222 },
    vaContext: 'Two storm-damaged fence panels need replacing, and the driveway needs a jet-wash before summer.',
    lines: [
      { description: 'Replace 2 fence panels + 1 post', category: 'fencing', estimatedMinutes: 180 },
      { description: 'Pressure-wash front driveway (~30m²)', category: 'pressure_washing', estimatedMinutes: 120 },
    ],
  },
  {
    label: '6. Urgent lock (NG1, evening)',
    customerName: 'Priya Shah',
    phone: '07700900116',
    address: '3 Friar Lane',
    postcode: 'NG1 6DH',
    coords: { lat: 52.954, lng: -1.1496 },
    vaContext: "Tenant lost keys, lock needs changing tonight before she gets home from work.",
    signals: { urgency: 'emergency', timeOfService: 'after_hours' },
    lines: [
      { description: 'Replace front-door cylinder lock + supply 3 keys', category: 'lock_change', estimatedMinutes: 60 },
    ],
  },
  {
    label: '7. Painting + flooring (West Bridgford NG2)',
    customerName: 'Olivia Bennett',
    phone: '07700900117',
    address: '27 Melton Road',
    postcode: 'NG2 6EN',
    coords: { lat: 52.9329, lng: -1.128 },
    vaContext: 'Hallway needs repaint + new laminate before the buyer moves in next month. We can supply paint.',
    signals: { materialsSupply: 'we_supply' },
    lines: [
      { description: 'Repaint hallway walls + skirting (white + magnolia)', category: 'painting', estimatedMinutes: 360 },
      { description: 'Lay 12m² laminate flooring in hallway', category: 'flooring', estimatedMinutes: 240 },
    ],
  },
  {
    label: '8. Bathroom combo (Carlton NG4)',
    customerName: "Daniel O'Connor",
    phone: '07700900118',
    address: '18 Burton Road',
    postcode: 'NG4 3DR',
    coords: { lat: 52.976, lng: -1.084 },
    vaContext: 'En-suite — basin needs swapping, mouldy silicone all round the bath and shower tray needs redoing.',
    lines: [
      { description: 'Swap basin + waste connection in en-suite', category: 'bathroom_fitting', estimatedMinutes: 180 },
      { description: 'Re-seal around bath + shower tray (strip + reapply)', category: 'silicone_sealant', estimatedMinutes: 90 },
      { description: 'Reconnect plumbing to new basin', category: 'plumbing_minor', estimatedMinutes: 45 },
    ],
  },
  {
    label: '9. Landlord turnaround (Bulwell NG6)',
    customerName: 'Roger Whitfield',
    phone: '07700900119',
    address: '6 Highbury Road',
    postcode: 'NG6 9DD',
    coords: { lat: 53.0023, lng: -1.1958 },
    vaContext: "Landlord, between tenants. Touch-up paint, fix a tripping kitchen socket, change locks, front-room radiator won't heat. He won't be there, tax-ready invoice needed. Used us before.",
    signals: { isReturningCustomer: true, previousJobCount: 4, previousAvgPricePence: 28000 },
    lines: [
      { description: 'Touch-up paint marks in hallway + living room', category: 'painting', estimatedMinutes: 120 },
      { description: 'Investigate + fix tripping kitchen socket', category: 'electrical_minor', estimatedMinutes: 90 },
      { description: 'Change front door lock + supply 3 keys', category: 'lock_change', estimatedMinutes: 60 },
      { description: 'Bleed front-room radiator, check valves', category: 'plumbing_minor', estimatedMinutes: 45 },
    ],
  },
  {
    label: '10. Niche / probable gap (Long Eaton NG10)',
    customerName: 'Catherine Hughes',
    phone: '07700900120',
    address: '32 Tamworth Road',
    postcode: 'NG10 3GS',
    coords: { lat: 52.898, lng: -1.2719 },
    vaContext: 'Gutters overflowing front and back, plus old garden waste and a broken shed to clear.',
    lines: [
      { description: 'Clear front + rear gutters, check downpipes', category: 'guttering', estimatedMinutes: 150 },
      { description: 'Dismantle broken shed + haul away garden waste', category: 'waste_removal', estimatedMinutes: 240 },
    ],
  },
];

async function createQuote(baseUrl: string, scenario: Scenario) {
  const body = {
    customerName: scenario.customerName,
    phone: scenario.phone,
    address: scenario.address,
    postcode: scenario.postcode,
    coordinates: scenario.coords,
    vaContext: scenario.vaContext,
    lines: scenario.lines.map((l, i) => ({
      id: `line-${i}-${Date.now()}`,
      description: l.description,
      category: l.category,
      estimatedMinutes: l.estimatedMinutes,
    })),
    signals: scenario.signals || {},
    availableDates: [ymd(2), ymd(3), ymd(4), ymd(5), ymd(8)],
    createdByName: 'Fit Test Seed',
  };
  const res = await fetch(`${baseUrl}/api/pricing/create-contextual-quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as { shortSlug: string; quoteUrl: string; quoteId: string; pricing?: { totalFormatted?: string } };
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:57717';
  type Row = { label: string; categories: string; fits: string; uncovered: string; url: string; total: string };
  const rows: Row[] = [];

  for (const sc of SCENARIOS) {
    const categories = Array.from(new Set(sc.lines.map((l) => l.category)));
    console.log(`\n${'═'.repeat(78)}`);
    console.log(sc.label);
    console.log('  Address:    ', `${sc.address} · ${sc.postcode}`);
    console.log('  Categories: ', categories.join(', '));
    if (sc.signals && Object.keys(sc.signals).length > 0) {
      console.log('  Signals:    ', JSON.stringify(sc.signals));
    }

    // 1. Fit query (direct DB call — same as the panel uses)
    const fit = await findCandidateContractors({
      categorySlugs: categories,
      customerLat: sc.coords.lat,
      customerLng: sc.coords.lng,
    });
    console.log(
      `  Fit:         ${fit.candidates.length} candidate(s)   full=${fit.fullCoverageCandidates}   partial=${fit.partialCoverageCandidates}`,
    );
    for (const c of fit.candidates) {
      const badge = c.coveragePercent === 100 ? 'FULL ' : `${String(c.coveragePercent).padStart(3)}% `;
      const dist = c.distanceMiles != null ? `${c.distanceMiles}mi` : '   —';
      console.log(`     • ${c.contractorName.padEnd(22)} [${badge}]  ${dist.padStart(6)}   covers: ${c.coveredCategories.join(', ')}`);
    }
    if (fit.uncoveredCategories.length) {
      console.log(`  Uncovered:   ${fit.uncoveredCategories.join(', ')}`);
    }

    // 2. Create the quote via the API (LLM-driven)
    let url = '—';
    let total = '—';
    try {
      const r = await createQuote(baseUrl, sc);
      url = r.quoteUrl;
      total = r.pricing?.totalFormatted || '—';
      console.log(`  Quote:       ${url}   ${total}`);
    } catch (e: any) {
      console.error('  ⚠ create failed:', e.message);
    }

    rows.push({
      label: sc.label,
      categories: categories.join(', '),
      fits:
        fit.candidates.length === 0
          ? '(none)'
          : fit.candidates
              .map((c) => `${c.contractorName}${c.coveragePercent === 100 ? '✓' : `(${c.coveragePercent}%)`}`)
              .join(', '),
      uncovered: fit.uncoveredCategories.join(', ') || '—',
      url,
      total,
    });
  }

  console.log(`\n${'═'.repeat(78)}\nSUMMARY\n`);
  for (const r of rows) {
    console.log(r.label);
    console.log(`  Cats:      ${r.categories}`);
    console.log(`  Fits:      ${r.fits}`);
    console.log(`  Uncovered: ${r.uncovered}`);
    console.log(`  Total:     ${r.total}`);
    console.log(`  URL:       ${r.url}\n`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
