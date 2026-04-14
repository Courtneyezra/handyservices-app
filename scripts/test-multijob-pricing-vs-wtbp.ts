#!/usr/bin/env npx tsx
/**
 * Multi-Job Contextual Quote Generation Test
 * ============================================
 * Generates random multi-job quotes through the contextual pricing engine,
 * then compares customer-facing prices against contractor WTBP rates to
 * show per-line and total margins.
 *
 * Usage:
 *   npx tsx scripts/test-multijob-pricing-vs-wtbp.ts
 *   npx tsx scripts/test-multijob-pricing-vs-wtbp.ts --scenarios 5
 *   npx tsx scripts/test-multijob-pricing-vs-wtbp.ts --dry-run    # skip LLM, use reference × 1.3
 *
 * Requires: server running (npm run dev) OR --direct flag to import engines directly.
 * Default: calls engines directly (no server needed).
 */

import 'dotenv/config';
import { generateMultiLinePrice } from '../server/contextual-pricing/multi-line-engine';
import { calculateCostFromWTBP } from '../server/margin-engine';
import type {
  MultiLineRequest,
  JobLine,
  ContextualSignals,
  JobCategory,
  MultiLineResult,
} from '../shared/contextual-pricing-types';

// ─────────────────────────────────────────────────────────────────────────────
// CLI Args
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const scenarioCount = parseInt(args.find((_, i, a) => a[i - 1] === '--scenarios') || '8', 10);

// ─────────────────────────────────────────────────────────────────────────────
// Colours & Formatting
// ─────────────────────────────────────────────────────────────────────────────

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
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function fmtGBP(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function marginColor(marginPercent: number): string {
  if (marginPercent >= 40) return c.green;
  if (marginPercent >= 30) return c.yellow;
  if (marginPercent >= 20) return c.red;
  return c.bgRed + c.white;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

// ─────────────────────────────────────────────────────────────────────────────
// Random Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─────────────────────────────────────────────────────────────────────────────
// Realistic Job Templates
// ─────────────────────────────────────────────────────────────────────────────

interface JobTemplate {
  description: string;
  category: JobCategory;
  timeRange: [number, number]; // min/max minutes
  materialsCostRange?: [number, number]; // pence
}

const JOB_TEMPLATES: JobTemplate[] = [
  // General fixing
  { description: 'Fix wobbly banister rail', category: 'general_fixing', timeRange: [30, 60] },
  { description: 'Tighten loose door handles throughout house', category: 'general_fixing', timeRange: [30, 60] },
  { description: 'Repair cracked skirting board in hallway', category: 'general_fixing', timeRange: [45, 90] },
  { description: 'Fix squeaky floorboard in bedroom', category: 'general_fixing', timeRange: [30, 60] },

  // Flat pack
  { description: 'Assemble IKEA PAX wardrobe', category: 'flat_pack', timeRange: [90, 180] },
  { description: 'Build IKEA KALLAX shelving unit', category: 'flat_pack', timeRange: [45, 90] },
  { description: 'Assemble office desk and chair', category: 'flat_pack', timeRange: [60, 120] },

  // TV mounting
  { description: 'Mount 55" TV on plasterboard wall with cable tidy', category: 'tv_mounting', timeRange: [60, 90] },
  { description: 'Wall mount TV above fireplace', category: 'tv_mounting', timeRange: [60, 120] },

  // Carpentry
  { description: 'Fit new skirting boards in living room', category: 'carpentry', timeRange: [120, 240], materialsCostRange: [2000, 5000] },
  { description: 'Build floating shelves in alcove', category: 'carpentry', timeRange: [90, 180], materialsCostRange: [3000, 6000] },
  { description: 'Replace broken stair spindle', category: 'carpentry', timeRange: [60, 120], materialsCostRange: [1500, 3000] },

  // Plumbing
  { description: 'Replace dripping kitchen tap', category: 'plumbing_minor', timeRange: [45, 90], materialsCostRange: [2000, 5000] },
  { description: 'Fix leaking toilet cistern', category: 'plumbing_minor', timeRange: [30, 60], materialsCostRange: [500, 2000] },
  { description: 'Replace bathroom basin taps', category: 'plumbing_minor', timeRange: [45, 90], materialsCostRange: [3000, 6000] },
  { description: 'Bleed all radiators and check pressure', category: 'plumbing_minor', timeRange: [30, 60] },

  // Electrical
  { description: 'Install new double socket in kitchen', category: 'electrical_minor', timeRange: [60, 120], materialsCostRange: [1000, 2000] },
  { description: 'Replace ceiling light fitting in bedroom', category: 'electrical_minor', timeRange: [30, 60], materialsCostRange: [500, 1500] },
  { description: 'Fit extractor fan in bathroom', category: 'electrical_minor', timeRange: [90, 150], materialsCostRange: [3000, 6000] },

  // Painting
  { description: 'Touch up paint in hallway and stairs', category: 'painting', timeRange: [120, 240], materialsCostRange: [1500, 3000] },
  { description: 'Paint single bedroom walls and ceiling', category: 'painting', timeRange: [180, 360], materialsCostRange: [2000, 4000] },
  { description: 'Paint front door and frame', category: 'painting', timeRange: [60, 120], materialsCostRange: [1000, 2000] },

  // Tiling
  { description: 'Re-grout kitchen backsplash tiles', category: 'tiling', timeRange: [60, 120], materialsCostRange: [500, 1500] },
  { description: 'Tile small bathroom floor (2sqm)', category: 'tiling', timeRange: [120, 240], materialsCostRange: [3000, 6000] },

  // Plastering
  { description: 'Patch plaster crack in ceiling', category: 'plastering', timeRange: [60, 120], materialsCostRange: [500, 1500] },
  { description: 'Skim coat small wall section after damp repair', category: 'plastering', timeRange: [90, 180], materialsCostRange: [1000, 3000] },

  // Lock change
  { description: 'Change front door lock and supply 3 keys', category: 'lock_change', timeRange: [30, 60], materialsCostRange: [2000, 5000] },
  { description: 'Replace back door lock mechanism', category: 'lock_change', timeRange: [30, 60], materialsCostRange: [1500, 3500] },

  // Guttering
  { description: 'Clear gutters front and back of house', category: 'guttering', timeRange: [60, 120] },
  { description: 'Repair leaking downpipe joint', category: 'guttering', timeRange: [30, 60], materialsCostRange: [500, 1500] },

  // Pressure washing
  { description: 'Pressure wash front driveway', category: 'pressure_washing', timeRange: [120, 180] },
  { description: 'Clean patio slabs and path', category: 'pressure_washing', timeRange: [90, 150] },

  // Shelving
  { description: 'Mount 3 floating shelves in living room', category: 'shelving', timeRange: [60, 120], materialsCostRange: [2000, 4000] },
  { description: 'Install garage shelving unit', category: 'shelving', timeRange: [60, 90], materialsCostRange: [3000, 5000] },

  // Silicone / sealant
  { description: 'Re-seal bath and shower tray', category: 'silicone_sealant', timeRange: [30, 60], materialsCostRange: [300, 800] },
  { description: 'Re-seal kitchen worktop edges and sink', category: 'silicone_sealant', timeRange: [30, 45], materialsCostRange: [200, 500] },

  // Fencing
  { description: 'Replace 2 blown fence panels', category: 'fencing', timeRange: [90, 180], materialsCostRange: [4000, 8000] },
  { description: 'Repair garden gate hinges and latch', category: 'fencing', timeRange: [30, 60], materialsCostRange: [500, 1500] },

  // Flooring
  { description: 'Lay laminate flooring in bedroom (12sqm)', category: 'flooring', timeRange: [180, 300], materialsCostRange: [5000, 10000] },
  { description: 'Replace damaged vinyl in kitchen', category: 'flooring', timeRange: [120, 240], materialsCostRange: [3000, 7000] },

  // Curtain / blinds
  { description: 'Fit curtain pole in bay window', category: 'curtain_blinds', timeRange: [45, 90], materialsCostRange: [1000, 3000] },
  { description: 'Install roller blinds in 3 bedrooms', category: 'curtain_blinds', timeRange: [60, 120], materialsCostRange: [2000, 5000] },

  // Door fitting
  { description: 'Hang new internal door', category: 'door_fitting', timeRange: [90, 150], materialsCostRange: [3000, 8000] },
  { description: 'Plane and re-hang sticky door', category: 'door_fitting', timeRange: [30, 60] },

  // Furniture repair
  { description: 'Fix broken drawer runners in chest of drawers', category: 'furniture_repair', timeRange: [30, 60], materialsCostRange: [500, 1500] },
  { description: 'Re-glue wobbly dining chair legs', category: 'furniture_repair', timeRange: [30, 60], materialsCostRange: [200, 500] },

  // Waste removal
  { description: 'Remove old sofa and take to tip', category: 'waste_removal', timeRange: [30, 60] },
  { description: 'Clear garage of junk and old furniture', category: 'waste_removal', timeRange: [90, 180] },

  // Garden
  { description: 'Assemble garden shed (8x6)', category: 'garden_maintenance', timeRange: [180, 300], materialsCostRange: [0, 0] },
  { description: 'General garden tidy and hedge trim', category: 'garden_maintenance', timeRange: [120, 240] },
];

// ─────────────────────────────────────────────────────────────────────────────
// VA Context Templates (realistic customer backgrounds)
// ─────────────────────────────────────────────────────────────────────────────

const VA_CONTEXTS: Array<{ text: string; label: string }> = [
  { text: "Landlord with a rental in Beeston. Tenant reported several issues. Can't be there, needs photos sent after.", label: 'Landlord (absent)' },
  { text: "Young professional, just moved in, works 9-5 so needs evening or weekend slot. Wants everything sorted in one go.", label: 'Busy pro (after-hours)' },
  { text: "Property manager, manages 12 units across Nottingham. Needs invoice for accounting. Regular maintenance visit.", label: 'Property mgr (portfolio)' },
  { text: "Retired couple in West Bridgford. Been meaning to get a few things sorted for months. No rush.", label: 'DIY deferrer (retired)' },
  { text: "Mum getting the house ready to sell. Estate agent said these things need doing before viewings start next week.", label: 'Homeowner (selling, priority)' },
  { text: "Small cafe owner on Mansfield Road. Needs work done before opening, ideally 7am start.", label: 'Small biz (early start)' },
  { text: "Student house, landlord asked us to sort a few things. Tenant will be in to let us in.", label: 'Student rental' },
  { text: "Returning customer — had us out 3 months ago for a bathroom job, was really happy. Now wants kitchen sorted.", label: 'Returning customer' },
  { text: "Emergency call — pipe burst under kitchen sink, water everywhere. Needs someone today.", label: 'Emergency (water)' },
  { text: "Airbnb host, needs turnover maintenance between guests. Next guest arrives Friday.", label: 'Airbnb (time-sensitive)' },
  { text: "", label: 'No context' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Generator
// ─────────────────────────────────────────────────────────────────────────────

interface TestScenario {
  name: string;
  request: MultiLineRequest;
  vaLabel: string;
}

function generateScenario(index: number): TestScenario {
  // Pick 2-5 random jobs (weighted toward 2-3)
  const jobCount = pick([2, 2, 2, 3, 3, 3, 4, 4, 5]);
  const jobs = pickN(JOB_TEMPLATES, jobCount);

  // Build job lines
  const lines: JobLine[] = jobs.map((job, i) => {
    const time = randInt(job.timeRange[0], job.timeRange[1]);
    const materials = job.materialsCostRange
      ? randInt(job.materialsCostRange[0], job.materialsCostRange[1])
      : 0;
    return {
      id: `line_${i + 1}`,
      description: job.description,
      category: job.category,
      timeEstimateMinutes: time,
      materialsCostPence: materials > 0 ? materials : undefined,
    };
  });

  // Pick VA context
  const va = pick(VA_CONTEXTS);

  // Build signals based on VA context
  const isReturning = va.label.includes('Returning');
  const isEmergency = va.label.includes('Emergency');
  const isPriority = va.label.includes('priority') || va.label.includes('time-sensitive');
  const isAfterHours = va.label.includes('after-hours') || va.label.includes('early start');
  const isWeekend = va.label.includes('weekend');

  const signals: ContextualSignals = {
    urgency: isEmergency ? 'emergency' : isPriority ? 'priority' : 'standard',
    materialsSupply: pick(['customer_supplied', 'we_supply', 'labor_only']),
    timeOfService: isAfterHours ? 'after_hours' : isWeekend ? 'weekend' : 'standard',
    isReturningCustomer: isReturning,
    previousJobCount: isReturning ? randInt(1, 5) : 0,
    previousAvgPricePence: isReturning ? randInt(7000, 15000) : 0,
  };

  const categories = [...new Set(lines.map(l => l.category))];
  const name = `#${index + 1} — ${jobCount} jobs (${categories.join(', ')})`;

  return {
    name,
    request: {
      lines,
      signals,
      vaContext: va.text || undefined,
    },
    vaLabel: va.label,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Results Aggregation
// ─────────────────────────────────────────────────────────────────────────────

interface ScenarioResult {
  scenario: TestScenario;
  quoteResult: MultiLineResult;
  wtbpResult: Awaited<ReturnType<typeof calculateCostFromWTBP>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold}${c.cyan}═══════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}${c.cyan}  Multi-Job Quote Test — Customer Price vs Contractor WTBP${c.reset}`);
  console.log(`${c.bold}${c.cyan}═══════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.grey}  Generating ${scenarioCount} random multi-job scenarios...${c.reset}\n`);

  const scenarios: TestScenario[] = [];
  for (let i = 0; i < scenarioCount; i++) {
    scenarios.push(generateScenario(i));
  }

  const results: ScenarioResult[] = [];
  let totalCustomerRevenue = 0;
  let totalContractorCost = 0;
  let totalMargin = 0;
  let lowMarginCount = 0;
  let negativeMarginCount = 0;
  let uncoveredCount = 0;

  for (const scenario of scenarios) {
    console.log(`${c.bold}${c.blue}┌──────────────────────────────────────────────────────────────${c.reset}`);
    console.log(`${c.bold}${c.blue}│ ${scenario.name}${c.reset}`);
    console.log(`${c.bold}${c.blue}│ ${c.grey}Context: ${scenario.vaLabel}${c.reset}`);
    console.log(`${c.bold}${c.blue}│ ${c.grey}Signals: urgency=${scenario.request.signals.urgency}, materials=${scenario.request.signals.materialsSupply}, time=${scenario.request.signals.timeOfService}${scenario.request.signals.isReturningCustomer ? ', returning=yes' : ''}${c.reset}`);
    console.log(`${c.bold}${c.blue}└──────────────────────────────────────────────────────────────${c.reset}`);

    // Print job lines
    for (const line of scenario.request.lines) {
      const matStr = line.materialsCostPence ? ` + ${fmtGBP(line.materialsCostPence)} materials` : '';
      console.log(`  ${c.grey}${padRight(line.id, 8)}${c.reset} ${padRight(line.description, 50)} ${c.dim}${line.category} · ${line.timeEstimateMinutes}min${matStr}${c.reset}`);
    }
    console.log();

    // ── Generate quote ──
    let quoteResult: MultiLineResult;
    try {
      quoteResult = await generateMultiLinePrice(scenario.request);
    } catch (err: any) {
      console.log(`  ${c.red}ERROR generating quote: ${err.message}${c.reset}\n`);
      continue;
    }

    // ── Get WTBP costs ──
    const wtbpInput = quoteResult.lineItems.map(li => ({
      categorySlug: li.category,
      pricePence: li.guardedPricePence,
      timeEstimateMinutes: li.timeEstimateMinutes || 60,
    }));

    let wtbpResult: Awaited<ReturnType<typeof calculateCostFromWTBP>>;
    try {
      wtbpResult = await calculateCostFromWTBP(wtbpInput);
    } catch (err: any) {
      console.log(`  ${c.red}ERROR fetching WTBP: ${err.message}${c.reset}\n`);
      continue;
    }

    results.push({ scenario, quoteResult, wtbpResult });

    // ── Per-line breakdown table ──
    console.log(`  ${c.bold}${padRight('Line', 8)} ${padRight('Category', 20)} ${padLeft('Reference', 10)} ${padLeft('LLM Price', 10)} ${padLeft('Final', 10)} ${padLeft('WTBP Cost', 10)} ${padLeft('Margin', 10)} ${padLeft('Margin%', 8)}${c.reset}`);
    console.log(`  ${c.grey}${'─'.repeat(88)}${c.reset}`);

    for (const li of quoteResult.lineItems) {
      const wtbpLine = wtbpResult.perLineMargin.find(w => w.categorySlug === li.category);
      const wtbpCost = wtbpLine?.contractorCostPence || 0;
      const margin = li.guardedPricePence - wtbpCost;
      const marginPct = li.guardedPricePence > 0 ? (margin / li.guardedPricePence) * 100 : 0;
      const isUncovered = wtbpResult.uncoveredCategories.includes(li.category);
      const mColor = isUncovered ? c.grey : marginColor(marginPct);

      console.log(
        `  ${padRight(li.lineId, 8)} ${padRight(li.category, 20)} ${padLeft(fmtGBP(li.referencePricePence), 10)} ${padLeft(fmtGBP(li.llmSuggestedPricePence), 10)} ${padLeft(fmtGBP(li.guardedPricePence), 10)} ${isUncovered ? padLeft('N/A', 10) : padLeft(fmtGBP(wtbpCost), 10)} ${mColor}${padLeft(isUncovered ? 'N/A' : fmtGBP(margin), 10)} ${padLeft(isUncovered ? 'N/A' : pct(marginPct), 8)}${c.reset}`
      );
    }

    // Materials line if any
    if (quoteResult.totalMaterialsWithMarginPence > 0) {
      console.log(`  ${c.grey}${'─'.repeat(88)}${c.reset}`);
      console.log(`  ${padRight('', 8)} ${padRight('Materials (with margin)', 20)} ${padLeft('', 10)} ${padLeft('', 10)} ${padLeft(fmtGBP(quoteResult.totalMaterialsWithMarginPence), 10)} ${padLeft('—', 10)} ${c.green}${padLeft(fmtGBP(quoteResult.totalMaterialsWithMarginPence), 10)}${padLeft('100%', 8)}${c.reset}`);
    }

    // Batch discount
    if (quoteResult.batchDiscount.applied) {
      console.log(`  ${c.yellow}  Batch discount: -${pct(quoteResult.batchDiscount.discountPercent)} (${fmtGBP(quoteResult.batchDiscount.savingsPence)} off) — ${quoteResult.batchDiscount.reasoning}${c.reset}`);
    }

    // Totals
    console.log(`  ${c.grey}${'─'.repeat(88)}${c.reset}`);
    const totalMColor = marginColor(wtbpResult.totalMarginPercent);
    console.log(
      `  ${c.bold}${padRight('TOTAL', 8)} ${padRight('', 20)} ${padLeft('', 10)} ${padLeft('', 10)} ${padLeft(fmtGBP(quoteResult.finalPricePence), 10)} ${padLeft(fmtGBP(wtbpResult.totalCostPence), 10)} ${totalMColor}${c.bold}${padLeft(fmtGBP(wtbpResult.totalMarginPence), 10)} ${padLeft(pct(wtbpResult.totalMarginPercent), 8)}${c.reset}`
    );

    // Messaging preview
    console.log(`\n  ${c.magenta}Headline:${c.reset} ${quoteResult.contextualHeadline}`);
    console.log(`  ${c.magenta}Message:${c.reset}  ${quoteResult.contextualMessage}`);
    console.log(`  ${c.magenta}TopLine:${c.reset}  ${quoteResult.jobTopLine}`);
    if (quoteResult.messaging) {
      console.log(`  ${c.magenta}Summary:${c.reset}  ${quoteResult.messaging.proposalSummary}`);
      console.log(`  ${c.magenta}Bullets:${c.reset}  ${(quoteResult.messaging.valueBullets || []).join(' · ')}`);
    }
    console.log(`  ${c.magenta}Confidence:${c.reset} ${quoteResult.confidence}`);

    // Flags
    if (wtbpResult.flags.length > 0) {
      console.log(`  ${c.yellow}Flags:${c.reset}`);
      for (const flag of wtbpResult.flags) {
        console.log(`    ${c.yellow}⚠ ${flag}${c.reset}`);
      }
    }

    // Guardrail adjustments
    if (quoteResult.guardrails.adjustments.length > 0) {
      console.log(`  ${c.cyan}Guardrails:${c.reset}`);
      for (const adj of quoteResult.guardrails.adjustments) {
        console.log(`    ${c.cyan}↳ ${adj}${c.reset}`);
      }
    }

    // Accumulate
    totalCustomerRevenue += quoteResult.finalPricePence;
    totalContractorCost += wtbpResult.totalCostPence;
    totalMargin += wtbpResult.totalMarginPence;
    if (wtbpResult.totalMarginPercent < 30 && wtbpResult.totalMarginPercent >= 0) lowMarginCount++;
    if (wtbpResult.totalMarginPercent < 0) negativeMarginCount++;
    if (wtbpResult.uncoveredCategories.length > 0) uncoveredCount++;

    console.log();
  }

  // ─── Summary Report ───
  console.log(`${c.bold}${c.cyan}═══════════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}${c.cyan}  AGGREGATE SUMMARY — ${results.length} Scenarios${c.reset}`);
  console.log(`${c.bold}${c.cyan}═══════════════════════════════════════════════════════════════${c.reset}\n`);

  const avgMarginPct = totalCustomerRevenue > 0 ? (totalMargin / totalCustomerRevenue) * 100 : 0;

  console.log(`  ${c.bold}Total Customer Revenue:${c.reset}  ${fmtGBP(totalCustomerRevenue)}`);
  console.log(`  ${c.bold}Total Contractor Cost:${c.reset}   ${fmtGBP(totalContractorCost)}`);
  console.log(`  ${c.bold}Total Gross Margin:${c.reset}      ${marginColor(avgMarginPct)}${fmtGBP(totalMargin)} (${pct(avgMarginPct)})${c.reset}`);
  console.log();
  console.log(`  ${c.bold}Scenarios run:${c.reset}           ${results.length}`);
  console.log(`  ${c.bold}Low margin (<30%):${c.reset}       ${lowMarginCount > 0 ? c.yellow : c.green}${lowMarginCount}${c.reset}`);
  console.log(`  ${c.bold}Negative margin:${c.reset}         ${negativeMarginCount > 0 ? c.red : c.green}${negativeMarginCount}${c.reset}`);
  console.log(`  ${c.bold}Uncovered categories:${c.reset}    ${uncoveredCount > 0 ? c.yellow : c.green}${uncoveredCount} scenarios${c.reset}`);

  // Per-category margin summary
  const categoryStats: Record<string, { revenue: number; cost: number; count: number }> = {};
  for (const r of results) {
    for (const line of r.wtbpResult.perLineMargin) {
      if (!categoryStats[line.categorySlug]) {
        categoryStats[line.categorySlug] = { revenue: 0, cost: 0, count: 0 };
      }
      categoryStats[line.categorySlug].revenue += line.customerPricePence;
      categoryStats[line.categorySlug].cost += line.contractorCostPence;
      categoryStats[line.categorySlug].count++;
    }
  }

  console.log(`\n  ${c.bold}${padRight('Category', 22)} ${padLeft('Quotes', 7)} ${padLeft('Avg Price', 10)} ${padLeft('WTBP Rate', 10)} ${padLeft('Avg Margin', 10)} ${padLeft('Margin%', 8)}${c.reset}`);
  console.log(`  ${c.grey}${'─'.repeat(70)}${c.reset}`);

  const sortedCategories = Object.entries(categoryStats)
    .sort(([, a], [, b]) => b.count - a.count);

  for (const [cat, stats] of sortedCategories) {
    const avgPrice = Math.round(stats.revenue / stats.count);
    const avgCost = Math.round(stats.cost / stats.count);
    const avgMargin = avgPrice - avgCost;
    const marginPctCat = avgPrice > 0 ? (avgMargin / avgPrice) * 100 : 0;
    const mColor = stats.cost === 0 ? c.grey : marginColor(marginPctCat);

    console.log(
      `  ${padRight(cat, 22)} ${padLeft(String(stats.count), 7)} ${padLeft(fmtGBP(avgPrice), 10)} ${padLeft(stats.cost === 0 ? 'N/A' : fmtGBP(avgCost), 10)} ${mColor}${padLeft(stats.cost === 0 ? 'N/A' : fmtGBP(avgMargin), 10)} ${padLeft(stats.cost === 0 ? 'N/A' : pct(marginPctCat), 8)}${c.reset}`
    );
  }

  console.log(`\n${c.grey}Done. ${results.length} scenarios tested.${c.reset}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${c.red}Fatal error: ${err.message}${c.reset}`);
  console.error(err.stack);
  process.exit(1);
});
