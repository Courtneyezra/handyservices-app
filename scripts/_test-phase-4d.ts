import 'dotenv/config';

const BASE = process.env.BASE_URL || 'http://localhost:53879';

async function tryTier(tier: 'small' | 'medium' | 'full') {
  const r = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerName: `Phase 4d Test ${tier}`,
      phone: '07700900222',
      email: 'phase4d@test.com',
      address: '14 Lenton Boulevard', postcode: 'NG7 2BY',
      coordinates: { lat: 52.9389, lng: -1.1789 },
      vaContext: `Van-load ${tier}.`,
      lines: [
        { id: 'waste-1', description: 'House clearance — ' + tier + ' van load', category: 'waste_removal', estimatedMinutes: 60, fixedTier: tier },
      ],
      signals: {},
      availableDates: ['2026-05-30'],
      createdByName: 'Phase 4d',
    }),
  });
  const j = await r.json();
  const line = j.pricing?.lineItems?.[0];
  return { tier, total: j.pricing?.totalFormatted, lineMin: line?.timeEstimateMinutes, linePrice: line?.guardedPricePence };
}

async function main() {
  for (const tier of ['small', 'medium', 'full'] as const) {
    const r = await tryTier(tier);
    console.log(`Tier=${r.tier.padEnd(7)}  → £${((r.linePrice||0)/100).toFixed(0).padStart(3)}  ·  schedule=${r.lineMin}min  ·  total ${r.total}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
