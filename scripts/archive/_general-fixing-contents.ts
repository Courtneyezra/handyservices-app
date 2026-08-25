/**
 * What is actually being filed under general_fixing (and 'other')?
 * Pull real line-item descriptions so category splits map to jobs customers
 * recognise — not invented distinctions.
 * Run: npx tsx scripts/_general-fixing-contents.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const isTest = (q: any) =>
  (q.id ?? '').startsWith('test_q_') ||
  /07700900|447700900|449900001/.test((q.phone ?? '').replace(/\D/g, '')) ||
  /@example\.com$/i.test(q.email ?? '') ||
  /\b(test|qa|phase|debug|preview|dummy|sample)\b/i.test(q.name ?? '');

async function main() {
  const res: any = await db.execute(sql`
    SELECT id, customer_name AS name, phone, email, pricing_line_items AS lines
    FROM personalized_quotes WHERE pricing_line_items IS NOT NULL
  `);
  const rows: any[] = res.rows ?? res;

  const buckets: Record<string, { desc: string; mins: number; pence: number }[]> = {};
  for (const q of rows) {
    if (isTest(q)) continue;
    let lines: any[] = [];
    try { lines = typeof q.lines === 'string' ? JSON.parse(q.lines) : q.lines; } catch { continue; }
    if (!Array.isArray(lines)) continue;
    for (const l of lines) {
      if (!l?.category) continue;
      (buckets[l.category] ??= []).push({
        desc: (l.description ?? '').trim(),
        mins: l.timeEstimateMinutes ?? l.scheduleMinutes ?? 0,
        pence: l.guardedPricePence ?? 0,
      });
    }
  }

  for (const cat of ['general_fixing', 'other']) {
    const items = buckets[cat] ?? [];
    console.log('\n' + '='.repeat(80));
    console.log(`${cat.toUpperCase()} — ${items.length} line items`);
    console.log('='.repeat(80));
    // keyword frequency to reveal real sub-jobs
    const kw: Record<string, number> = {};
    const KEYS = [
      'tv', 'mount', 'mirror', 'shelf', 'shelv', 'picture', 'frame', 'curtain', 'blind', 'pole', 'rail',
      'hang', 'hook', 'handle', 'hinge', 'door', 'lock', 'latch', 'drawer', 'cabinet', 'cupboard',
      'toilet', 'seat', 'tap', 'silicone', 'seal', 'leak', 'radiator', 'bleed', 'fill', 'crack', 'hole',
      'plaster', 'paint', 'skirting', 'flat pack', 'flatpack', 'assemble', 'assembly', 'wardrobe', 'bed',
      'socket', 'switch', 'light', 'bulb', 'fan', 'smoke', 'alarm', 'fence', 'gate', 'garden', 'gutter',
      'floor', 'laminate', 'tile', 'grout', 'bracket', 'wall', 'plasterboard', 'stud', 'masonry', 'brick',
      'fix', 'repair', 'replace', 'install', 'fit', 'adjust',
    ];
    for (const it of items) {
      const d = it.desc.toLowerCase();
      for (const k of KEYS) if (d.includes(k)) kw[k] = (kw[k] ?? 0) + 1;
    }
    console.log('Top keywords (job types actually inside this bucket):');
    Object.entries(kw).sort((a, b) => b[1] - a[1]).slice(0, 30)
      .forEach(([k, n]) => console.log(`  ${k.padEnd(14)} ${n}`));

    console.log('\nSample descriptions (first 40, deduped-ish):');
    const seen = new Set<string>();
    let shown = 0;
    for (const it of items) {
      const key = it.desc.toLowerCase().slice(0, 40);
      if (seen.has(key) || it.desc.length < 4) continue;
      seen.add(key);
      const hrs = (it.mins / 60).toFixed(1);
      console.log(`  [${hrs}h £${(it.pence/100).toFixed(0).padStart(4)}] ${it.desc.slice(0, 90)}`);
      if (++shown >= 40) break;
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
