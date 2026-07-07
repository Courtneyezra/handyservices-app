/**
 * KEYWORD-ENRICHMENT PROPOSAL — mining + in-memory dry-run measurement.
 *
 * REVIEW ARTIFACT. Read-only against the DB: it LOADS the live catalog + the
 * historical corpus, MERGES the proposed keyword additions
 * (scripts/_proposed-keywords.json) IN MEMORY, and re-runs the SAME matcher
 * scoring logic to report the projected coverage lift and the projected
 * precision against the human-tagged lines. It NEVER writes to the DB and
 * NEVER edits the catalog or the matcher.
 *
 * Why re-implement scoreAll here instead of calling matchLineToSku?
 *   The production matcher loads the catalog from the DB and caches it; there
 *   is no public hook to swap in a mutated in-memory catalog. So we mirror its
 *   scoring EXACTLY (same WORD_WEIGHTS / CATEGORY_BONUS / MIN_SCORE / boundary
 *   logic, all imported from the matcher module) over two catalogs:
 *     (a) BASELINE  = live catalog as-is
 *     (b) PROPOSED  = live catalog + merged additions
 *   and diff the results. As a self-check it also runs the REAL matcher over
 *   the corpus and asserts the re-implemented baseline equals it.
 *
 * Run: npx tsx scripts/_propose-keywords.ts
 */
import { db } from '../server/db';
import { sql, eq } from 'drizzle-orm';
import { serviceCatalog } from '@shared/schema';
import type { ServiceCatalogRow } from '@shared/schema';
import {
    WORD_WEIGHTS,
    WORD_WEIGHT_4PLUS,
    CATEGORY_BONUS,
    MIN_SCORE,
    matchLineToSkuDebug,
} from '../server/contextual-pricing/sku-matcher';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Faithful re-implementation of the matcher's scoring (see sku-matcher.ts) ──
function weightForKeyword(kw: string): number {
    const words = kw.trim().split(/\s+/).length;
    if (words >= 4) return WORD_WEIGHT_4PLUS;
    return (WORD_WEIGHTS as Record<number, number>)[words] ?? WORD_WEIGHT_4PLUS;
}

function containsKeyword(text: string, kw: string): boolean {
    let from = 0;
    while (true) {
        const idx = text.indexOf(kw, from);
        if (idx === -1) return false;
        const before = idx === 0 ? '' : text[idx - 1];
        const after = idx + kw.length >= text.length ? '' : text[idx + kw.length];
        const boundaryBefore = before === '' || !/[a-z0-9]/.test(before);
        const boundaryAfter = after === '' || !/[a-z0-9]/.test(after);
        if (boundaryBefore && boundaryAfter) return true;
        from = idx + 1;
    }
}

interface PreppedSku {
    skuCode: string;
    name: string;
    category: string;
    keywords: Array<[string, number]>;
    negatives: string[];
}

function prep(skuCode: string, name: string, category: string, keywords: string[], negatives: string[]): PreppedSku {
    const kw = keywords
        .map((k) => (k ?? '').toLowerCase().trim())
        .filter(Boolean);
    // de-dupe (a merge may introduce a phrase that already existed)
    const uniqKw = [...new Set(kw)].map((k) => [k, weightForKeyword(k)] as [string, number]);
    const neg = [...new Set(negatives.map((k) => (k ?? '').toLowerCase().trim()).filter(Boolean))];
    return { skuCode, name, category, keywords: uniqKw, negatives: neg };
}

/** Returns winning skuCode (or null) using the matcher's MIN_SCORE gate. */
function matchAgainst(catalog: PreppedSku[], description: string, category: string | undefined): string | null {
    const text = ` ${description.toLowerCase().trim()} `;
    const cat = category?.toLowerCase().trim();
    let best: { skuCode: string; score: number } | null = null;
    for (const sku of catalog) {
        let excluded = false;
        for (const neg of sku.negatives) {
            if (containsKeyword(text, neg)) { excluded = true; break; }
        }
        if (excluded) continue;
        let score = 0;
        for (const [kw, weight] of sku.keywords) {
            if (containsKeyword(text, kw)) score += weight;
        }
        if (score === 0) continue;
        if (cat && sku.category === cat) score += CATEGORY_BONUS;
        if (!best || score > best.score) best = { skuCode: sku.skuCode, score };
    }
    if (!best || best.score < MIN_SCORE) return null;
    return best.skuCode;
}

// ── Load corpus + catalog ────────────────────────────────────────────────────
type Row = { description: string | null; category: string | null; sku_code: string | null };
const res: any = await db.execute(sql`
  SELECT li->>'description' AS description, li->>'category' AS category, li->>'skuCode' AS sku_code
  FROM personalized_quotes pq, jsonb_array_elements(pq.pricing_line_items) li
  WHERE pq.id NOT LIKE 'test_q_%' AND pq.created_at >= '2026-04-01'
`);
const rows = (res.rows ?? res) as Row[];

const catalogRows: ServiceCatalogRow[] = await db
    .select()
    .from(serviceCatalog)
    .where(eq(serviceCatalog.isActive, true));

const baselineCatalog: PreppedSku[] = catalogRows.map((r) =>
    prep(r.skuCode, r.name, r.category, r.keywords ?? [], r.negativeKeywords ?? []),
);

// ── Merge the proposal IN MEMORY ─────────────────────────────────────────────
interface Addition {
    skuCode: string;
    addKeywords?: string[];
    addNegativeKeywords?: string[];
}
const proposal = JSON.parse(readFileSync(join(__dirname, '_proposed-keywords.json'), 'utf8')) as {
    additions: Array<Addition & { note?: string; category?: string; exampleDescriptions?: string[] }>;
};
const bySku = new Map<string, ServiceCatalogRow>();
for (const r of catalogRows) bySku.set(r.skuCode, r);

const unknownSkus: string[] = [];
const noteOnlyEntries: string[] = []; // entries with empty addKeywords (gap flags / pointers)
const addKwMap = new Map<string, Set<string>>();
const addNegMap = new Map<string, Set<string>>();
for (const a of proposal.additions) {
    const addKw = (a.addKeywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
    const addNeg = (a.addNegativeKeywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
    if (addKw.length === 0 && addNeg.length === 0) { noteOnlyEntries.push(a.skuCode); continue; }
    if (!bySku.has(a.skuCode)) { unknownSkus.push(a.skuCode); continue; } // gap-flag pseudo-SKUs
    if (!addKwMap.has(a.skuCode)) addKwMap.set(a.skuCode, new Set());
    if (!addNegMap.has(a.skuCode)) addNegMap.set(a.skuCode, new Set());
    addKw.forEach((k) => addKwMap.get(a.skuCode)!.add(k));
    addNeg.forEach((k) => addNegMap.get(a.skuCode)!.add(k));
}

const proposedCatalog: PreppedSku[] = catalogRows.map((r) => {
    const extraKw = [...(addKwMap.get(r.skuCode) ?? [])];
    const extraNeg = [...(addNegMap.get(r.skuCode) ?? [])];
    return prep(
        r.skuCode,
        r.name,
        r.category,
        [...(r.keywords ?? []), ...extraKw],
        [...(r.negativeKeywords ?? []), ...extraNeg],
    );
});

// keyword/SKU touch counts
const skusTouched = new Set([...addKwMap.keys(), ...addNegMap.keys()]);
let totalKwAdded = 0;
for (const s of addKwMap.values()) totalKwAdded += s.size;
let totalNegAdded = 0;
for (const s of addNegMap.values()) totalNegAdded += s.size;

// ── Self-check: re-implemented baseline must equal the REAL matcher ──────────
let selfCheckMismatch = 0;
const baseResults: Array<{ row: Row; desc: string; baseReimpl: string | null; baseReal: string | null; proposed: string | null }> = [];
for (const row of rows) {
    const desc = (row.description ?? '').trim();
    if (!desc) continue;
    const baseReimpl = matchAgainst(baselineCatalog, desc, row.category ?? undefined);
    const real = await matchLineToSkuDebug({ description: desc, category: row.category ?? undefined });
    const baseReal = real?.skuCode ?? null;
    if (baseReimpl !== baseReal) selfCheckMismatch++;
    const proposed = matchAgainst(proposedCatalog, desc, row.category ?? undefined);
    baseResults.push({ row, desc, baseReimpl, baseReal, proposed });
}

const total = baseResults.length;
const baseMatched = baseResults.filter((r) => r.baseReal).length;
const propMatched = baseResults.filter((r) => r.proposed).length;
const newlyMatched = baseResults.filter((r) => !r.baseReal && r.proposed);
const flippedAway = baseResults.filter((r) => r.baseReal && !r.proposed); // should be ~0 (we only add)
const changedSku = baseResults.filter((r) => r.baseReal && r.proposed && r.baseReal !== r.proposed);

// ── Precision vs human-tagged anchors ────────────────────────────────────────
function precision(pick: (r: typeof baseResults[number]) => string | null) {
    const manual = baseResults.filter((r) => r.row.sku_code);
    let matched = 0, agree = 0;
    const wrong: Array<{ desc: string; want: string; got: string }> = [];
    for (const r of manual) {
        const got = pick(r);
        if (got) {
            matched++;
            if (got === r.row.sku_code) agree++;
            else wrong.push({ desc: r.desc, want: r.row.sku_code!, got });
        }
    }
    return { count: manual.length, matched, agree, wrong };
}
const basePrec = precision((r) => r.baseReal);
const propPrec = precision((r) => r.proposed);

// ── Which proposed additions actually fired (and which didn't) ───────────────
const firedSkus = new Map<string, number>();
for (const r of newlyMatched) firedSkus.set(r.proposed!, (firedSkus.get(r.proposed!) ?? 0) + 1);

// ── Remaining unmatched, clustered by category ───────────────────────────────
const stillUnmatched = baseResults.filter((r) => !r.proposed);
const remByCat = new Map<string, string[]>();
for (const r of stillUnmatched) {
    const c = r.row.category ?? '(none)';
    const arr = remByCat.get(c) ?? [];
    arr.push(r.desc);
    remByCat.set(c, arr);
}

// ── Report ───────────────────────────────────────────────────────────────────
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');
const line = (s = '') => console.log(s);
line('\n' + '═'.repeat(90));
line('KEYWORD-ENRICHMENT PROPOSAL — IN-MEMORY DRY-RUN (no DB writes)');
line('═'.repeat(90));
line(`Self-check (re-impl baseline vs real matcher): ${selfCheckMismatch === 0 ? 'OK — identical' : 'MISMATCH on ' + selfCheckMismatch + ' lines (scoring drift!)'}`);
line('');
line('── PROPOSAL SIZE ──────────────────────────────────────────────────────────────');
line(`  SKUs with keyword additions: ${skusTouched.size}`);
line(`  Keywords added (total):      ${totalKwAdded}`);
line(`  Negative keywords added:     ${totalNegAdded}`);
line(`  Note-only / gap-flag entries: ${noteOnlyEntries.length}  ${noteOnlyEntries.length ? '(' + noteOnlyEntries.join(', ') + ')' : ''}`);
if (unknownSkus.length) line(`  ⚠ Additions referencing unknown skuCodes (ignored in dry-run): ${unknownSkus.join(', ')}`);
line('');
line('── COVERAGE ───────────────────────────────────────────────────────────────────');
line(`  Lines analysed:        ${total}`);
line(`  Baseline matched:      ${baseMatched}  (${pct(baseMatched, total)})`);
line(`  Proposed matched:      ${propMatched}  (${pct(propMatched, total)})`);
line(`  Newly matched:         +${newlyMatched.length}`);
line(`  Lost (add-only, want 0): ${flippedAway.length}`);
line(`  Re-routed to diff SKU:   ${changedSku.length}  ${changedSku.length ? '(' + changedSku.map((r) => r.baseReal + '→' + r.proposed).slice(0, 6).join(', ') + (changedSku.length > 6 ? ' …' : '') + ')' : ''}`);
line('');
line('── PRECISION vs HUMAN-TAGGED ANCHORS ──────────────────────────────────────────');
line(`  Anchors:                 ${basePrec.count}`);
line(`  Baseline: produced ${basePrec.matched}, correct ${basePrec.agree}  (precision ${pct(basePrec.agree, basePrec.matched)}, recall ${pct(basePrec.agree, basePrec.count)})`);
line(`  Proposed: produced ${propPrec.matched}, correct ${propPrec.agree}  (precision ${pct(propPrec.agree, propPrec.matched)}, recall ${pct(propPrec.agree, propPrec.count)})`);
if (propPrec.wrong.length) {
    line('  Proposed WRONG picks on anchors:');
    for (const w of propPrec.wrong) line(`    want ${w.want} got ${w.got}  ::  ${w.desc}`);
} else {
    line('  Proposed wrong picks on anchors: NONE');
}
line('');
line('── PROPOSED ADDITIONS THAT FIRED (newly-matched count by SKU) ──────────────────');
for (const [sku, n] of [...firedSkus.entries()].sort((a, b) => b[1] - a[1])) {
    line(`  ${String(n).padStart(3)}  ${sku}`);
}
const proposedSkusThatNeverFired = [...skusTouched].filter((s) => !firedSkus.has(s));
line('');
line(`  Proposed SKUs whose additions did NOT newly fire (already-matched lines, or phrasing still off): ${proposedSkusThatNeverFired.length}`);
if (proposedSkusThatNeverFired.length) line(`    ${proposedSkusThatNeverFired.join(', ')}`);
line('');
line('── REMAINING UNMATCHED, by category (worst clusters) ───────────────────────────');
const remSorted = [...remByCat.entries()].sort((a, b) => b[1].length - a[1].length);
line(`  still unmatched: ${stillUnmatched.length}`);
for (const [c, arr] of remSorted) {
    line(`  ${c.padEnd(20)} ${String(arr.length).padStart(3)}`);
}
line('');
line('── SAMPLE OF NEWLY-MATCHED (sanity eyeball) ────────────────────────────────────');
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const sampleStride = Math.max(1, Math.floor(newlyMatched.length / 30));
for (let i = 0; i < newlyMatched.length; i += sampleStride) {
    const r = newlyMatched[i];
    line(`  ${trunc(r.desc, 52).padEnd(53)} [${(r.row.category ?? '').padEnd(16)}] → ${r.proposed}`);
}
line('');
line('── SAMPLE OF STILL-UNMATCHED (genuinely bespoke vs still-missing) ──────────────');
const usStride = Math.max(1, Math.floor(stillUnmatched.length / 30));
for (let i = 0; i < stillUnmatched.length; i += usStride) {
    const r = stillUnmatched[i];
    line(`  ${trunc(r.desc, 52).padEnd(53)} [${r.row.category ?? ''}]`);
}
line('');
line('═'.repeat(90) + '\n');
process.exit(0);
