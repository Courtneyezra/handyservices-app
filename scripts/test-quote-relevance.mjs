/**
 * Quote Relevance Test Suite
 * Tests contextual quote generation across different contexts, VA context lengths, and job types.
 * Reports: headline relevance, message tone, jobTopLine accuracy, value bullet alignment.
 */

const BASE_URL = 'http://localhost:5001';
const RESULTS = [];

// ─── Test Scenarios ────────────────────────────────────────────────────────

const SCENARIOS = [

  // 1. MINIMAL INPUT — no vaContext, single simple job
  {
    label: 'T1: Minimal input — no vaContext, single tap repair',
    vaContextLength: 'none',
    body: {
      customerName: 'Test User A',
      phone: '07700000001',
      lines: [{
        id: 'l1', description: 'Dripping kitchen tap', category: 'plumbing_minor',
        estimatedMinutes: 45, materialsCostPence: 0
      }],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard',
        isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    }
  },

  // 2. SHORT vaContext — 1-2 sentences, landlord situation
  {
    label: 'T2: Short vaContext — landlord, tenant leaking tap',
    vaContextLength: 'short (42 words)',
    body: {
      customerName: 'David Chen',
      phone: '07700000002',
      vaContext: 'Landlord based in London. Tenant reported a dripping kitchen tap. He cannot be present on the day and wants photos sent after. Standard urgency, no rush.',
      lines: [{
        id: 'l1', description: 'Dripping kitchen tap — washer replacement', category: 'plumbing_minor',
        estimatedMinutes: 45, materialsCostPence: 0
      }],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard',
        isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    }
  },

  // 3. MEDIUM vaContext — ~80 words, emergency, homeowner present
  {
    label: 'T3: Medium vaContext — homeowner, emergency leak, ceiling damage',
    vaContextLength: 'medium (78 words)',
    body: {
      customerName: 'Sarah Mitchell',
      phone: '07700000003',
      vaContext: `Sarah called in a panic — water coming through the ceiling of her living room. She thinks it's a burst pipe from the bathroom above. She lives alone in a semi-detached in Arnold. Her partner is away. She needs someone today or tomorrow at the latest. Very stressed. Mentioned ceiling tiles are already starting to bubble. Happy to pay extra for fast response.`,
      lines: [{
        id: 'l1', description: 'Burst pipe — trace and repair, ceiling access may be needed', category: 'plumbing_minor',
        estimatedMinutes: 90, materialsCostPence: 0
      }],
      signals: { urgency: 'emergency', materialsSupply: 'we_supply', timeOfService: 'standard',
        isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    }
  },

  // 4. LONG vaContext — full call notes style, 3 job lines (multi-job batch)
  {
    label: 'T4: Long vaContext — property manager, 3 jobs, batch visit',
    vaContextLength: 'long (130 words)',
    body: {
      customerName: 'James Whitfield',
      phone: '07700000004',
      vaContext: `James manages a portfolio of 8 properties across Nottingham and Beeston. He's been meaning to book these jobs for weeks — just needs someone reliable. He's had bad experiences with no-shows before. For this visit: flat 2 at the Beeston property needs a new bathroom tap, the kitchen door hinge is broken and won't close properly, and there's a cracked tile in the shower that needs replacing and regrouting.

He will arrange access via his maintenance team. He does not need to be present. He wants a WhatsApp message to confirm the date once booked. He pays promptly, same-day invoice preferred. He mentioned he may have more work across his portfolio if this goes well.`,
      lines: [
        { id: 'l1', description: 'Replace bathroom tap (cold water only)', category: 'plumbing_minor',
          estimatedMinutes: 45, materialsCostPence: 0 },
        { id: 'l2', description: 'Repair broken kitchen door hinge — door not closing', category: 'carpentry',
          estimatedMinutes: 30, materialsCostPence: 0 },
        { id: 'l3', description: 'Replace cracked shower tile and regrout surrounding area', category: 'tiling',
          estimatedMinutes: 90, materialsCostPence: 0 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'we_supply', timeOfService: 'standard',
        isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    }
  },

  // 5. VERY LONG vaContext — messy raw call notes, lots of noise, 2 jobs
  {
    label: 'T5: Very long vaContext — noisy raw call notes, 2 jobs, price-conscious customer',
    vaContextLength: 'very long (195 words)',
    body: {
      customerName: 'Kevin Briggs',
      phone: '07700000005',
      vaContext: `Kevin called at 2:14pm. Spoke for about 6 minutes. He was quite chatty and went off on a tangent about his neighbour at one point. Main issue: his TV has been sitting on the floor for 3 months since he moved in — he wants it wall mounted in the living room (65 inch Samsung, he has the bracket). He also mentioned he's got 4 IKEA KALLAX shelving units in boxes that he's been dreading putting together. Says his back is bad and he can't do it himself. He lives in Clifton, ground floor flat, easy access. He's definitely price-conscious — asked twice how much it would be before I could get to explaining the process. He said his budget is "around £150" but I think he can stretch if we make the value clear. He's home most days, flexible on timing. He did say he preferred mornings. Not a business. Just a regular homeowner. Said he found us on Google. No urgency, happy to wait a week or two.`,
      lines: [
        { id: 'l1', description: 'Wall mount 65" Samsung TV — customer has bracket', category: 'tv_mounting',
          estimatedMinutes: 60, materialsCostPence: 0 },
        { id: 'l2', description: 'Assemble 4 x IKEA KALLAX shelving units', category: 'flat_pack',
          estimatedMinutes: 180, materialsCostPence: 0 },
      ],
      signals: { urgency: 'standard', materialsSupply: 'customer_supplied', timeOfService: 'standard',
        isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    }
  },

  // 6. RETURNING CUSTOMER — short context, repeat landlord
  {
    label: 'T6: Returning customer — repeat landlord, minor job',
    vaContextLength: 'short (35 words)',
    body: {
      customerName: 'Anna Kowalski',
      phone: '07700000006',
      vaContext: 'Returning customer — Anna has used us twice before, always pays on time. Bathroom silicone around bath is mouldy and cracking. She wants it replaced. Standard timing.',
      lines: [{
        id: 'l1', description: 'Remove old silicone around bath and re-apply fresh bead', category: 'silicone_sealant',
        estimatedMinutes: 45, materialsCostPence: 0
      }],
      signals: { urgency: 'standard', materialsSupply: 'labor_only', timeOfService: 'standard',
        isReturningCustomer: true, previousJobCount: 2, previousAvgPricePence: 8500 },
    }
  },

  // 7. WEEKEND / AFTER-HOURS — business, priority
  {
    label: 'T7: After-hours commercial — cafe owner, priority socket work',
    vaContextLength: 'medium (65 words)',
    body: {
      customerName: 'Marco Bianchi',
      phone: '07700000007',
      vaContext: `Marco runs a small cafe on Mansfield Road. He needs 2 new double sockets installed behind the counter — he's bought new espresso equipment and doesn't have enough power points. Can't be done during opening hours (8am–5pm Mon–Sat). He's asking for Saturday evening after 5pm or Sunday. Priority but not emergency. He'll be on site to let us in.`,
      lines: [{
        id: 'l1', description: 'Install 2 double sockets behind cafe counter', category: 'electrical_minor',
        estimatedMinutes: 90, materialsCostPence: 0
      }],
      signals: { urgency: 'priority', materialsSupply: 'we_supply', timeOfService: 'weekend',
        isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0 },
    }
  },

];

// ─── Runner ────────────────────────────────────────────────────────────────

async function runScenario(scenario) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/pricing/create-contextual-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scenario.body),
    });
    const elapsed = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text();
      return { label: scenario.label, error: `HTTP ${res.status}: ${errText}`, elapsed };
    }

    const data = await res.json();
    return {
      label: scenario.label,
      vaContextLength: scenario.vaContextLength,
      elapsed,
      quoteUrl: data.quoteUrl,
      quoteId: data.quoteId,
      totalFormatted: data.pricing?.totalFormatted,
      lineItemCount: data.pricing?.lineItems?.length,
      lineItems: (data.pricing?.lineItems || []).map(li => ({
        description: li.description,
        price: li.formattedPrice || li.pricePence ? `£${(li.pricePence/100).toFixed(0)}` : '?',
      })),
      batchDiscount: data.pricing?.batchDiscount,
      headline: data.messaging?.headline,
      jobTopLine: data.jobTopLine,                        // top-level, not in messaging
      contextualMessage: data.messaging?.message,         // API key is .message not .contextualMessage
      proposalSummary: data.messaging?.proposalSummary,
      valueBullets: data.messaging?.valueBullets,
      whatsappClosing: data.messaging?.whatsappClosing,
      layoutTier: data.messaging?.layoutTier,
      bookingModes: data.messaging?.bookingModes,
      confidence: data.confidence,
      requiresReview: data.messaging?.requiresHumanReview,
      reviewReason: data.messaging?.reviewReason,
    };
  } catch (err) {
    return { label: scenario.label, error: String(err), elapsed: Date.now() - start };
  }
}

// ─── Relevance Checks ──────────────────────────────────────────────────────

function assessRelevance(result, scenario) {
  const issues = [];
  const ok = [];

  if (result.error) return { issues: [`API ERROR: ${result.error}`], ok: [] };

  const h = (result.headline || '').toLowerCase();
  const m = (result.contextualMessage || '').toLowerCase();
  const topLine = (result.jobTopLine || '').toLowerCase();
  const bullets = (result.valueBullets || []).map(b => b.toLowerCase());
  const vaCtx = (scenario.body.vaContext || '').toLowerCase();
  const lineDescs = scenario.body.lines.map(l => l.description.toLowerCase()).join(' ');

  // ── Generic / banned headline endings ──
  const genericHeadlines = ['your job, sorted', 'job done', 'jobs sorted', 'work done', 'quality work, fair price', 'all sorted'];
  if (genericHeadlines.some(g => h.includes(g))) {
    issues.push(`HEADLINE too generic: "${result.headline}"`);
  } else {
    ok.push(`Headline specific: "${result.headline}"`);
  }

  // ── jobTopLine covers actual job ──
  if (!result.jobTopLine || result.jobTopLine.length < 5) {
    issues.push('jobTopLine is missing or too short');
  } else if (topLine.includes('your job') || topLine.includes('job done')) {
    issues.push(`jobTopLine is generic: "${result.jobTopLine}"`);
  } else {
    ok.push(`jobTopLine: "${result.jobTopLine}"`);
  }

  // ── contextualMessage relevant to scenario ──
  if (scenario.body.signals?.urgency === 'emergency') {
    const hasUrgentTone = m.includes('today') || m.includes('asap') || m.includes('quick') ||
      m.includes('emergency') || m.includes('right away') || m.includes('urgent') || m.includes('fast');
    if (!hasUrgentTone) issues.push('Message lacks urgency tone for emergency job');
    else ok.push('Message has urgency tone (correct for emergency)');
  }

  if (scenario.body.signals?.isReturningCustomer) {
    const hasLoyaltyTone = m.includes('again') || m.includes('back') || m.includes('return') || m.includes('always');
    if (!hasLoyaltyTone) issues.push('Message does not acknowledge returning customer');
    else ok.push('Message acknowledges returning customer');
  }

  // ── vaContext signals reflected ──
  if (vaCtx.includes('landlord') || vaCtx.includes('tenant')) {
    const hasLandlordRelevance = h.includes('tenant') || h.includes('landlord') || h.includes('rental') ||
      m.includes('tenant') || m.includes('landlord') || m.includes("there") ||
      bullets.some(b => b.includes('tenant') || b.includes('photo') || b.includes('invoice'));
    if (!hasLandlordRelevance) issues.push('Landlord/tenant context not reflected in messaging');
    else ok.push('Landlord/tenant context reflected in messaging or bullets');
  }

  if (vaCtx.includes('price-conscious') || vaCtx.includes('budget') || vaCtx.includes('£150')) {
    const hasPriceReassurance = m.includes('fixed price') || m.includes('no surprise') ||
      bullets.some(b => b.includes('fixed price') || b.includes('surprise'));
    if (!hasPriceReassurance) issues.push('Price-conscious context not reflected (missing "fixed price" signal)');
    else ok.push('Price-conscious framing included');
  }

  if (vaCtx.includes('photo') || vaCtx.includes('cannot be present') || vaCtx.includes('cannot be there') || vaCtx.includes("can't be present")) {
    const hasPhotoMention = bullets.some(b => b.includes('photo')) ||
      m.includes('photo') || m.includes('send') || m.includes("won't need");
    if (!hasPhotoMention) issues.push('Customer requested photos but not reflected in bullets/message');
    else ok.push('Photo report bullet included (matches customer need)');
  }

  if (vaCtx.includes('invoice') || vaCtx.includes('tax-ready') || vaCtx.includes('pays promptly')) {
    const hasInvoiceBullet = bullets.some(b => b.includes('invoice') || b.includes('tax'));
    if (!hasInvoiceBullet) issues.push('Invoice/tax request in context but not in bullets');
    else ok.push('Tax-ready invoice bullet included (matches property manager need)');
  }

  // ── afterhours premium context ──
  if (scenario.body.signals?.timeOfService !== 'standard') {
    const hasTimingRef = m.includes('weekend') || m.includes('evening') || m.includes('saturday') ||
      m.includes('sunday') || m.includes('after hours') || m.includes('after 5') ||
      bullets.some(b => b.includes('evening') || b.includes('weekend'));
    if (!hasTimingRef) issues.push('After-hours/weekend context not reflected in messaging');
    else ok.push('After-hours/weekend timing reflected in messaging');
  }

  // ── Multi-line: all jobs covered in jobTopLine ──
  if (scenario.body.lines.length >= 3) {
    const jobKeywords = scenario.body.lines.map(l => {
      const words = l.description.toLowerCase().split(' ');
      // return the first meaningful noun/verb
      return words.find(w => w.length > 4 && !['with', 'from', 'that', 'have', 'been', 'will', 'needs'].includes(w)) || words[0];
    });
    const coveredCount = jobKeywords.filter(kw => topLine.includes(kw) || topLine.includes(kw.slice(0, -1))).length;
    if (coveredCount < scenario.body.lines.length - 1) {
      issues.push(`jobTopLine may not cover all ${scenario.body.lines.length} jobs (only ~${coveredCount} keywords matched): "${result.jobTopLine}"`);
    } else {
      ok.push(`jobTopLine covers multi-line jobs`);
    }
  }

  // ── Price sanity ──
  if (!result.totalFormatted) {
    issues.push('No price returned');
  } else {
    ok.push(`Price: ${result.totalFormatted}`);
  }

  return { issues, ok };
}

// ─── Report ────────────────────────────────────────────────────────────────

function printReport(results, scenarios) {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  QUOTE RELEVANCE TEST REPORT — ' + new Date().toISOString().slice(0, 16));
  console.log('═══════════════════════════════════════════════════════════════\n');

  let totalIssues = 0;
  let totalOk = 0;

  results.forEach((result, i) => {
    const scenario = scenarios[i];
    const { issues, ok } = assessRelevance(result, scenario);
    totalIssues += issues.length;
    totalOk += ok.length;

    const status = issues.length === 0 ? '✅ PASS' : issues.length <= 2 ? '⚠️  WARN' : '❌ FAIL';
    console.log(`─── ${result.label}`);
    console.log(`    Status: ${status}  |  vaContext: ${result.vaContextLength}  |  ${result.lineItemCount || '?'} line(s)  |  ${result.elapsed}ms`);
    if (result.error) {
      console.log(`    ERROR: ${result.error}`);
    } else {
      console.log(`    Price: ${result.totalFormatted || 'N/A'}  |  Confidence: ${result.confidence || 'N/A'}  |  Tier: ${result.layoutTier || 'N/A'}`);
      console.log(`    Headline: "${result.headline || 'N/A'}"`);
      console.log(`    jobTopLine: "${result.jobTopLine || 'N/A'}"`);
      console.log(`    Message: "${(result.contextualMessage || '').slice(0, 120)}${(result.contextualMessage || '').length > 120 ? '...' : ''}"`);
      console.log(`    Bullets: [${(result.valueBullets || []).join(' | ')}]`);
      console.log(`    WA Closing: "${result.whatsappClosing || 'N/A'}"`);
      if (result.batchDiscount?.percent > 0) {
        console.log(`    Batch Discount: ${result.batchDiscount.percent}% — ${result.batchDiscount.reasoning}`);
      }
    }
    if (ok.length > 0) {
      console.log(`    ✓ ${ok.join('\n    ✓ ')}`);
    }
    if (issues.length > 0) {
      console.log(`    ✗ ${issues.join('\n    ✗ ')}`);
    }
    console.log();
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  SUMMARY: ${totalOk} checks passed, ${totalIssues} issues found`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Issue summary
  if (totalIssues > 0) {
    console.log('ISSUES REQUIRING FIXES:');
    results.forEach((result, i) => {
      const scenario = scenarios[i];
      const { issues } = assessRelevance(result, scenario);
      if (issues.length > 0) {
        console.log(`\n  [${result.label}]`);
        issues.forEach(iss => console.log(`    → ${iss}`));
      }
    });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log(`Running ${SCENARIOS.length} quote tests in parallel...`);
const results = await Promise.all(SCENARIOS.map(runScenario));
printReport(results, SCENARIOS);

// Save raw results for analysis
import { writeFileSync } from 'fs';
writeFileSync('/tmp/quote-test-results.json', JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
console.log('Raw results saved to /tmp/quote-test-results.json');
