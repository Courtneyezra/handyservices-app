#!/usr/bin/env npx tsx
/**
 * CVS vs WTBP Comparison — Hourly Rate Model
 *
 * Shows CVS-proposed hourly rates per category, compared against
 * customer reference rates, to visualise the margin corridor.
 *
 * Contractor pay = WTBP hourly × actual job hours (calculated at quote time)
 * Platform margin = Customer price − Contractor pay
 *
 * Usage: npx tsx scripts/show-cvs-vs-wtbp.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { wtbpRateCard } from '../shared/schema';
import { isNull } from 'drizzle-orm';
import { getAllCVSResults, getCVSConfig, calculateContractorPay } from '../server/contractor-value-score';
import { CATEGORY_RATE_RANGES } from '../shared/categories';
import type { JobCategory } from '../shared/categories';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  grey: '\x1b[90m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
};

function fmtGBP(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function pad(str: string, len: number, align: 'left' | 'right' = 'left'): string {
  if (str.length >= len) return str.slice(0, len);
  const spaces = ' '.repeat(len - str.length);
  return align === 'right' ? spaces + str : str + spaces;
}

function bar(score: number, maxLen: number = 20): string {
  const filled = Math.round((score / 100) * maxLen);
  return '█'.repeat(filled) + '░'.repeat(maxLen - filled);
}

async function main() {
  // Fetch current WTBP rates from DB (flat per-job rates — legacy)
  const currentRates = await db
    .select()
    .from(wtbpRateCard)
    .where(isNull(wtbpRateCard.effectiveTo));

  const currentMap: Record<string, number> = {};
  for (const r of currentRates) {
    currentMap[r.categorySlug] = r.ratePence;
  }

  // Get CVS results
  const cvsResults = getAllCVSResults();
  const config = getCVSConfig();

  // ── Header ──
  console.log(`\n${c.bold}${c.cyan}═══════════════════════════════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}${c.cyan}  Contractor Value Score (CVS) — Hourly WTBP Rates${c.reset}`);
  console.log(`${c.bold}${c.cyan}═══════════════════════════════════════════════════════════════════════════════════════${c.reset}`);

  console.log(`\n${c.dim}  Model: Contractor pay = WTBP hourly rate × actual job hours${c.reset}`);
  console.log(`${c.dim}  WTBP hourly = Subbie rate × (1 - surplus discount 15-20%)${c.reset}`);

  // ── Factor Weights ──
  console.log(`\n${c.bold}  Factor Weights:${c.reset}`);
  console.log(`  ${c.dim}Skill: ${(config.weights.skillComplexity * 100).toFixed(0)}%  |  Tools: ${(config.weights.toolRequirement * 100).toFixed(0)}%  |  Scarcity: ${(config.weights.marketScarcity * 100).toFixed(0)}%  |  Physical: ${(config.weights.physicalDemand * 100).toFixed(0)}%  |  Compliance: ${(config.weights.complianceRisk * 100).toFixed(0)}%${c.reset}`);

  // ── Factor Scores Table ──
  console.log(`\n${c.bold}  CVS Factor Scores${c.reset}`);
  console.log(`  ${c.grey}${'─'.repeat(95)}${c.reset}`);
  console.log(`  ${c.bold}${pad('Category', 22)} ${pad('Skill', 6)} ${pad('Tools', 6)} ${pad('Scarce', 7)} ${pad('Phys', 5)} ${pad('Comply', 7)} ${pad('Score', 6)} ${pad('CVS Bar', 22)} ${pad('Discount', 8)}${c.reset}`);
  console.log(`  ${c.grey}${'─'.repeat(95)}${c.reset}`);

  for (const r of cvsResults) {
    const f = r.factors;
    const scoreColor = r.score >= 60 ? c.red : r.score >= 35 ? c.yellow : c.green;
    console.log(
      `  ${pad(r.label, 22)} ${pad(String(f.skillComplexity), 6)} ${pad(String(f.toolRequirement), 6)} ${pad(String(f.marketScarcity), 7)} ${pad(String(f.physicalDemand), 5)} ${pad(String(f.complianceRisk), 7)} ${scoreColor}${pad(String(r.score), 6)}${c.reset} ${c.cyan}${bar(r.score)}${c.reset} ${pad((r.surplusDiscount * 100).toFixed(0) + '%', 8)}`
    );
  }

  // ── Hourly Rate Comparison ──
  console.log(`\n${c.bold}  Hourly Rate Comparison${c.reset}`);
  console.log(`  ${c.grey}${'─'.repeat(90)}${c.reset}`);
  console.log(`  ${c.bold}${pad('Category', 22)} ${pad('Subbie/hr', 11)} ${pad('WTBP/hr', 10)} ${pad('Cust Ref/hr', 12)} ${pad('Margin/hr', 10)} ${pad('Margin%', 8)} ${pad('Old Flat', 10)}${c.reset}`);
  console.log(`  ${c.grey}${'─'.repeat(90)}${c.reset}`);

  const sorted = [...cvsResults].sort((a, b) => a.label.localeCompare(b.label));

  for (const r of sorted) {
    const custRef = CATEGORY_RATE_RANGES[r.category as JobCategory] || CATEGORY_RATE_RANGES.other;
    const marginPerHour = custRef.hourly - r.wtbpHourlyPence;
    const marginPct = custRef.hourly > 0 ? (marginPerHour / custRef.hourly) * 100 : 0;
    const marginColor = marginPct >= 40 ? c.green : marginPct >= 25 ? c.yellow : c.red;
    const oldFlat = currentMap[r.category] || 0;

    console.log(
      `  ${pad(r.label, 22)} ${pad(fmtGBP(r.subbieRatePence) + '/hr', 11)} ${pad(fmtGBP(r.wtbpHourlyPence) + '/hr', 10)} ${pad(fmtGBP(custRef.hourly) + '/hr', 12)} ${marginColor}${pad(fmtGBP(marginPerHour) + '/hr', 10)} ${pad(marginPct.toFixed(0) + '%', 8)}${c.reset} ${c.grey}${pad(oldFlat ? fmtGBP(oldFlat) + '/job' : 'N/A', 10)}${c.reset}`
    );
  }

  // ── Example Jobs ──
  console.log(`\n${c.bold}  Example Job Payouts (WTBP hourly × estimated time)${c.reset}`);
  console.log(`  ${c.grey}${'─'.repeat(90)}${c.reset}`);
  console.log(`  ${c.bold}${pad('Job', 40)} ${pad('Category', 18)} ${pad('Time', 7)} ${pad('Contr Pay', 10)} ${pad('Cust Ref', 10)} ${pad('Margin', 10)}${c.reset}`);
  console.log(`  ${c.grey}${'─'.repeat(90)}${c.reset}`);

  const examples: Array<{ desc: string; cat: JobCategory; mins: number }> = [
    { desc: 'Fix dripping tap', cat: 'plumbing_minor', mins: 45 },
    { desc: 'Hang internal door', cat: 'door_fitting', mins: 120 },
    { desc: 'Assemble IKEA wardrobe', cat: 'flat_pack', mins: 120 },
    { desc: 'Mount TV on wall', cat: 'tv_mounting', mins: 60 },
    { desc: 'Replace ceiling light', cat: 'electrical_minor', mins: 45 },
    { desc: 'Re-seal bath + shower', cat: 'silicone_sealant', mins: 45 },
    { desc: 'Paint bedroom (walls + ceiling)', cat: 'painting', mins: 240 },
    { desc: 'Tile kitchen backsplash', cat: 'tiling', mins: 120 },
    { desc: 'Change front door lock', cat: 'lock_change', mins: 45 },
    { desc: 'Pressure wash driveway', cat: 'pressure_washing', mins: 150 },
    { desc: 'Replace 2 fence panels', cat: 'fencing', mins: 120 },
    { desc: 'Full bathroom refit', cat: 'bathroom_fitting', mins: 480 },
    { desc: 'Lay laminate bedroom (12sqm)', cat: 'flooring', mins: 240 },
    { desc: 'Patch plaster ceiling crack', cat: 'plastering', mins: 90 },
  ];

  for (const ex of examples) {
    const pay = calculateContractorPay(ex.cat, ex.mins);
    const custRef = CATEGORY_RATE_RANGES[ex.cat] || CATEGORY_RATE_RANGES.other;
    const custPrice = Math.round(custRef.hourly * (ex.mins / 60));
    const margin = custPrice - pay.payPence;
    const marginPct = custPrice > 0 ? (margin / custPrice) * 100 : 0;
    const marginColor = marginPct >= 40 ? c.green : marginPct >= 25 ? c.yellow : c.red;

    console.log(
      `  ${pad(ex.desc, 40)} ${pad(ex.cat, 18)} ${pad((ex.mins / 60).toFixed(1) + 'hr', 7)} ${pad(fmtGBP(pay.payPence), 10)} ${pad(fmtGBP(custPrice), 10)} ${marginColor}${pad(fmtGBP(margin) + ' (' + marginPct.toFixed(0) + '%)', 10)}${c.reset}`
    );
  }

  // ── Tier Summary ──
  console.log(`\n${c.bold}  Rate Tiers${c.reset}`);
  console.log(`  ${c.grey}${'─'.repeat(60)}${c.reset}`);

  const tiers = [
    { label: 'Specialist (CVS 60+)', filter: (r: typeof cvsResults[0]) => r.score >= 60 },
    { label: 'Skilled (CVS 35-59)', filter: (r: typeof cvsResults[0]) => r.score >= 35 && r.score < 60 },
    { label: 'Commodity (CVS <35)', filter: (r: typeof cvsResults[0]) => r.score < 35 },
  ];

  for (const tier of tiers) {
    const cats = cvsResults.filter(tier.filter);
    if (cats.length === 0) continue;
    const avgHourly = Math.round(cats.reduce((s, r) => s + r.wtbpHourlyPence, 0) / cats.length);
    const range = {
      min: Math.min(...cats.map(r => r.wtbpHourlyPence)),
      max: Math.max(...cats.map(r => r.wtbpHourlyPence)),
    };
    console.log(`  ${c.bold}${tier.label}${c.reset} — ${cats.length} categories, avg ${fmtGBP(avgHourly)}/hr (${fmtGBP(range.min)}–${fmtGBP(range.max)}/hr)`);
    for (const cat of cats) {
      console.log(`    ${c.dim}${cat.label}: ${fmtGBP(cat.wtbpHourlyPence)}/hr${c.reset}`);
    }
  }

  console.log(`\n${c.grey}Done.${c.reset}\n`);
  process.exit(0);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
