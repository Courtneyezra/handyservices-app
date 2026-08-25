/**
 * Phase 22b verification — call the actual /api/admin/availability/fit
 * endpoint logic (via fetch against the running dev server) and confirm
 * partials no longer appear in the response.
 */
import 'dotenv/config';

const BASE = process.env.PREVIEW_URL || 'http://localhost:58532';
const TOKEN = process.env.ADMIN_TOKEN; // optional — endpoint may be open in dev

const scenarios: { name: string; categories: string[] }[] = [
  { name: '2 cats — plumbing+tiling', categories: ['plumbing_minor', 'tiling'] },
  { name: '3 cats — plumbing+tiling+painting', categories: ['plumbing_minor', 'tiling', 'painting'] },
  { name: '4 cats — bathroom refurb', categories: ['plumbing_minor', 'tiling', 'painting', 'silicone_sealant'] },
];

async function main() {
  for (const s of scenarios) {
    const url = `${BASE}/api/admin/availability/fit?categories=${s.categories.join(',')}&days=14`;
    const res = await fetch(url, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
    if (!res.ok) {
      console.log(`\n${s.name}: HTTP ${res.status}`);
      continue;
    }
    const data: any = await res.json();
    console.log(`\n${s.name} — categories=[${s.categories.join(',')}]`);
    console.log(`  candidates returned: ${data.candidates.length}`);
    console.log(`  fullCoverageCandidates: ${data.fullCoverageCandidates}`);
    console.log(`  partialCoverageCandidates (informational): ${data.partialCoverageCandidates}`);
    console.log(`  uncoveredCategories: [${data.uncoveredCategories.join(', ')}]`);
    for (const c of data.candidates) {
      const ok = c.coveragePercent === 100 ? '✓' : '✗ LEAK';
      console.log(`    ${ok} ${c.name} ${c.coveragePercent}%`);
    }
    const leaked = data.candidates.filter((c: any) => c.coveragePercent !== 100).length;
    if (leaked > 0) console.log(`  ❌ ${leaked} partial leaked`);
    else console.log(`  ✓ no partials in response`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
