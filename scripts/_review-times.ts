/**
 * REVIEW PRINTER for scripts/_proposed-times.json
 * ------------------------------------------------------------------------
 * Reads the hand-authored realistic-time proposals and prints a red-pen
 * review table for the business owner. READ-ONLY: does not touch the DB and
 * does not write any file. It re-queries the live catalog ONLY to show
 * current-vs-suggested side by side and to flag any SKU the proposals missed.
 *
 * Run: npx tsx scripts/_review-times.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const __dir = dirname(fileURLToPath(import.meta.url));

type PerUnit = { setupMinutes: number; minutesPerUnit: number };
type Proposal = {
  skuCode: string;
  name: string;
  shape: 'fixed' | 'per_unit' | 'tiered';
  currentMinutes: number | PerUnit | number[];
  suggestedMinutes: number | PerUnit | number[];
  confidence: 'high' | 'needs-owner-call';
  reasoning: string;
};

const proposals: Proposal[] = JSON.parse(
  readFileSync(join(__dir, '_proposed-times.json'), 'utf8'),
);

// ── helpers ─────────────────────────────────────────────────────────────────
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function isPerUnit(x: unknown): x is PerUnit {
  return !!x && typeof x === 'object' && !Array.isArray(x) && 'minutesPerUnit' in (x as any);
}

// A single "headline minutes @ 1 unit" so fixed/per_unit/tiered are comparable.
function headline(v: number | PerUnit | number[]): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v[Math.floor(v.length / 2)]; // median tier
  if (isPerUnit(v)) return v.setupMinutes + v.minutesPerUnit; // @ 1 unit
  return 0;
}

function fmt(v: number | PerUnit | number[]): string {
  if (typeof v === 'number') return `${v}m`;
  if (Array.isArray(v)) return `[${v.join('/')}]`;
  if (isPerUnit(v)) return `${v.setupMinutes}+${v.minutesPerUnit}/u`;
  return '—';
}

// ── cross-check against the live catalog ────────────────────────────────────
const res: any = await db.execute(sql`
  SELECT sku_code, shape, schedule_minutes, setup_minutes, minutes_per_unit, tiers
  FROM service_catalog WHERE is_active = true
`);
const live = new Map<string, any>();
for (const r of (res.rows ?? res)) live.set(r.sku_code, r);

const proposedCodes = new Set(proposals.map((p) => p.skuCode));
const missing = [...live.keys()].filter((c) => !proposedCodes.has(c)).sort();
const unknown = proposals.filter((p) => !live.has(p.skuCode)).map((p) => p.skuCode);

// ── classify each proposal ──────────────────────────────────────────────────
type Row = Proposal & { delta: number; changed: boolean; impact: number };
const rows: Row[] = proposals.map((p) => {
  const cur = headline(p.currentMinutes);
  const sug = headline(p.suggestedMinutes);
  const delta = sug - cur; // negative = reduction
  return { ...p, delta, changed: delta !== 0, impact: Math.abs(delta) };
});

const changed = rows.filter((r) => r.changed);
const unchanged = rows.filter((r) => !r.changed);
const highConf = changed.filter((r) => r.confidence === 'high');
const ownerCall = rows.filter((r) => r.confidence === 'needs-owner-call');

// ── full table (sorted by biggest reduction first) ──────────────────────────
const byReduction = [...rows].sort((a, b) => a.delta - b.delta);

console.log(`\n${'═'.repeat(120)}`);
console.log(`PROPOSED REALISTIC TIMES — ${proposals.length} SKUs reviewed  ·  hand-authored from trade norms (NOT the rough audit benchmark)`);
console.log(`Headline minutes shown @ 1 unit for comparability. per_unit = "setup+perUnit/u"; tiered = "[small/med/large]".`);
console.log(`${'═'.repeat(120)}\n`);

console.log(
  '  ' + pad('SKU', 20) + pad('NAME', 30) + pad('SHAPE', 9) +
  padL('CURRENT', 11) + padL('SUGGEST', 11) + padL('Δ@1u', 8) + '  CONF',
);
console.log('  ' + '─'.repeat(112));
for (const r of byReduction) {
  const conf = r.confidence === 'high' ? 'high' : 'OWNER-CALL';
  const flag = r.changed ? '' : '  (no change)';
  console.log(
    '  ' + pad(trunc(r.skuCode, 19), 20) + pad(trunc(r.name, 29), 30) + pad(r.shape, 9) +
    padL(fmt(r.currentMinutes), 11) + padL(fmt(r.suggestedMinutes), 11) +
    padL(r.delta === 0 ? '·' : (r.delta > 0 ? '+' : '') + r.delta, 8) +
    '  ' + conf + flag,
  );
}

// ── top reductions on common tasks ──────────────────────────────────────────
console.log(`\n${'═'.repeat(120)}`);
console.log('TOP 15 HIGHEST-IMPACT REDUCTIONS (biggest realistic minute cut)');
console.log('─'.repeat(120));
console.log('  ' + pad('SKU', 20) + pad('NAME', 32) + padL('CUR', 8) + padL('SUG', 8) + padL('SAVE', 8) + '  CONF');
console.log('  ' + '─'.repeat(96));
for (const r of [...changed].sort((a, b) => a.delta - b.delta).slice(0, 15)) {
  console.log(
    '  ' + pad(trunc(r.skuCode, 19), 20) + pad(trunc(r.name, 31), 32) +
    padL(headline(r.currentMinutes), 8) + padL(headline(r.suggestedMinutes), 8) +
    padL(r.delta, 8) + '  ' + (r.confidence === 'high' ? 'high' : 'OWNER-CALL'),
  );
}

// ── needs-owner-call list ───────────────────────────────────────────────────
console.log(`\n${'═'.repeat(120)}`);
console.log(`NEEDS-OWNER-CALL — ${ownerCall.length} SKUs where the realistic time depends on YOUR crew / scope`);
console.log('─'.repeat(120));
for (const r of ownerCall.sort((a, b) => a.skuCode.localeCompare(b.skuCode))) {
  const verdict = r.changed ? `${fmt(r.currentMinutes)} → ${fmt(r.suggestedMinutes)}` : `keep ${fmt(r.currentMinutes)}`;
  console.log(`  • ${pad(r.skuCode, 20)} ${pad(verdict, 26)} ${r.reasoning}`);
}

// ── summary ─────────────────────────────────────────────────────────────────
const totalSaved = changed.reduce((s, r) => s + Math.max(0, -r.delta), 0);
console.log(`\n${'═'.repeat(120)}`);
console.log('SUMMARY');
console.log('─'.repeat(120));
console.log(`  Reviewed:            ${proposals.length}`);
console.log(`  Would CHANGE:        ${changed.length}   ·   would LEAVE: ${unchanged.length}`);
console.log(`  └ high confidence:   ${highConf.length} (changed)`);
console.log(`  └ needs-owner-call:  ${ownerCall.length} (incl. some "leave as-is, just confirm")`);
console.log(`  Σ headline minutes shaved @1u across changed SKUs: ~${totalSaved} min`);
if (missing.length) {
  console.log(`\n  ⚠ ${missing.length} live SKU(s) NOT in proposals (need authoring): ${missing.join(', ')}`);
} else {
  console.log(`\n  ✓ All live catalog SKUs are covered by the proposals.`);
}
if (unknown.length) {
  console.log(`  ⚠ ${unknown.length} proposal SKU(s) not found live (typo?): ${unknown.join(', ')}`);
}
console.log(`\n  DATA ONLY — no DB writes, no catalog edits. Apply scripts/_proposed-times.json after red-pen.`);
console.log(`${'═'.repeat(120)}\n`);

process.exit(0);
