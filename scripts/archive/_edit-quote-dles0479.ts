/**
 * One-off edit for Harbans' quote dles0479 (15 Aug 2026).
 *
 *   1. Install laminate flooring   £550 → £670  (+£120, as instructed)
 *   2. Supply and fit garden gate  £150 → £180  (set, not delta)
 *   3. NEW line: waste removal     £120
 *
 * Deliberately NOT using PATCH /api/pricing/quotes/:id — that endpoint clears
 * the batch discount on any line edit ("edited prices are final"). Owner call
 * was to KEEP the 12% multi-job discount, so we replicate the endpoint's
 * recalculation here with the discount preserved.
 *
 * Also resets viewedAt so the next customer open re-fires the Pushover
 * "quote viewed" alert (that alert is first-view-only, and Harbans has
 * already opened this quote twice).
 *
 * Run:  npx tsx scripts/_edit-quote-dles0479.ts          (dry run)
 *       npx tsx scripts/_edit-quote-dles0479.ts --apply  (writes)
 */
import { writeFileSync } from 'fs';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { calculateCostFromWTBP } from '../server/margin-engine';

const SLUG = 'dles0479';
const APPLY = process.argv.includes('--apply');
const BACKUP = `/private/tmp/claude-501/-Users-courtneebonnick-v6-switchboard/ae274370-b89e-4f9e-a39b-5a94b8392b5b/scratchpad/dles0479-before.json`;

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

// New line item — waste removal. Category `waste_removal` maps to the
// "outdoor" revenue-share tier (45% share, £16/hr floor). 120 min is the
// honest schedule time (load + tip run); at that time the 45% share (£47.52
// of the post-discount £105.60) clears the £32 floor, so no reprice flag.
const WASTE_LINE = {
    lineId: 'wst4hb21',
    source: 'custom',
    category: 'waste_removal',
    scopeSteps: [
        'Loaded up — old flooring, gate and offcuts cleared into the van',
        'Taken away — everything removed from site the same day',
        'Disposed responsibly — licensed tip, waste transfer note on request',
        'Left clean — no bags or debris behind',
    ],
    description: 'Waste removal and disposal',
    scheduleMinutes: 120,
    adjustmentFactors: [
        {
            factor: 'materialsSupply_we_supply',
            direction: 'up',
            magnitude: 'small',
            reasoning: 'Tip fees and vehicle cost included. Labour-only line, no materials markup.',
        },
    ],
    guardedPricePence: 12000,
    materialsCostPence: 0,
    priceOverridePence: 12000,
    referencePricePence: 5500,
    timeEstimateMinutes: 120,
    llmSuggestedPricePence: 12000,
    materialsWithMarginPence: 0,
    requiresMaterialCollection: false,
};

async function main() {
    const [quote] = await db.select().from(personalizedQuotes)
        .where(eq(personalizedQuotes.shortSlug, SLUG));
    if (!quote) throw new Error(`Quote ${SLUG} not found`);

    writeFileSync(BACKUP, JSON.stringify(quote, null, 2));
    console.log(`Backup written → ${BACKUP}\n`);

    // ── Guards: refuse to run against unexpected state ──────────────────────
    const lines = [...((quote.pricingLineItems as any[]) || [])];
    if (quote.depositPaidAt) throw new Error('ABORT: deposit already paid — do not re-price.');
    if (quote.bookedAt) throw new Error('ABORT: quote already booked.');
    if (lines.length !== 5) throw new Error(`ABORT: expected 5 line items, found ${lines.length} (already edited?)`);
    if (quote.basePrice !== 223200) throw new Error(`ABORT: expected basePrice 223200, found ${quote.basePrice}`);
    if (lines.some((l) => l.category === 'waste_removal')) throw new Error('ABORT: waste removal line already present.');

    const floor = lines.find((l) => l.lineId === 'mn3hs7gk');
    const gate = lines.find((l) => l.lineId === 'hicjsjtu');
    if (!floor || floor.guardedPricePence !== 55000) throw new Error('ABORT: floor install line not at expected £550.');
    if (!gate || gate.guardedPricePence !== 15000) throw new Error('ABORT: garden gate line not at expected £150.');

    // ── Apply the three edits ───────────────────────────────────────────────
    floor.guardedPricePence = 67000;
    floor.priceOverridePence = 67000;
    floor.llmSuggestedPricePence = 67000;

    gate.guardedPricePence = 18000;
    gate.priceOverridePence = 18000;
    gate.llmSuggestedPricePence = 18000;

    lines.push(WASTE_LINE);

    // ── Recalculate totals (mirrors the PATCH endpoint, discount retained) ──
    const labourTotal = lines.reduce((s, l) => s + (Number(l.guardedPricePence) || 0), 0);
    const materialsTotal = lines.reduce((s, l) => s + (Number(l.materialsWithMarginPence) || 0), 0);

    const breakdown = { ...((quote.pricingLayerBreakdown as Record<string, any>) || {}) };
    const bucketsTotal = Number(breakdown?.priceBuckets?.totalBucketsPence) || 0;

    const discountPercent = Number(quote.batchDiscountPercent) || 0;
    const savingsPence = Math.round(labourTotal * discountPercent / 100);
    const finalPrice = labourTotal - savingsPence + materialsTotal + bucketsTotal;

    // ── Recompute per-line margin exactly as generation does (labour only,
    //    batch discount applied pro-rata before the share calc) ─────────────
    const discountFactor = 1 - discountPercent / 100;
    const wtbp = await calculateCostFromWTBP(lines.map((l) => ({
        categorySlug: l.category,
        pricePence: Math.round((l.guardedPricePence || 0) * discountFactor),
        timeEstimateMinutes: l.timeEstimateMinutes || 60,
    })));

    const totalCustomer = wtbp.perLineMargin.reduce((s, l) => s + l.customerPricePence, 0);
    const totalCost = wtbp.perLineMargin.reduce((s, l) => s + l.contractorCostPence, 0);
    const totalMarginPct = totalCustomer > 0
        ? Math.round(((totalCustomer - totalCost) / totalCustomer) * 100) : 0;

    const flags: string[] = [...wtbp.flags];
    if (totalMarginPct < 0) flags.push('Negative margin: contractor cost exceeds quote price');
    else if (totalMarginPct < 20) flags.push(`Critical: overall margin only ${totalMarginPct}%`);
    else if (totalMarginPct < 30) flags.push(`Thin margin: overall ${totalMarginPct}%`);
    for (const pl of wtbp.perLineMargin) {
        if (pl.marginPercent < 20) flags.push(`${pl.categorySlug}: margin ${pl.marginPercent}%`);
    }

    // ── Messaging: the job list must name the waste removal we now charge for ─
    const jobDescription =
        'Remove old laminate flooring, Install laminate flooring, Install skirting board, '
        + 'Supply and fit new garden gate , Sand plaster and paint wall, Waste removal and disposal';
    const jobTopLine =
        'Old flooring removed, new laminate laid, skirting fitted, garden gate installed, '
        + 'wall sanded and painted, all waste taken away';
    const proposalSummary =
        "We'll remove your old laminate flooring and install the new laminate throughout, fit skirting "
        + 'boards, supply and install your new garden gate, and sand and paint the wall. All waste is '
        + 'loaded and taken away — everything done in one visit with full cleanup included.';
    const contextualMessage =
        "We'll strip out your old laminate, lay the new flooring, fit the skirting, sort your garden gate, "
        + 'and freshen up that wall — then take every bit of waste away with us. Fixed price, no surprises.';

    const reasoning = [
        (breakdown.reasoning || '').trim(),
        '',
        `--- EDIT ${new Date().toISOString().slice(0, 10)} (owner instruction) ---`,
        '[mn3hs7gk] Install laminate flooring: £550.00 → £670.00 (+£120.00 manual increase).',
        '[hicjsjtu] Supply and fit new garden gate: £150.00 → £180.00 (set to instructed price; '
        + 'also clears the reprice_needed floor flag on garden_maintenance).',
        '[wst4hb21] NEW — Waste removal and disposal @ £120.00 (120min, outdoor tier).',
        `Labour subtotal: ${gbp(labourTotal)}. Batch discount retained at ${discountPercent}% = -${gbp(savingsPence)}.`,
        `Materials (unchanged): ${gbp(materialsTotal)}.`,
        `Final: ${gbp(finalPrice)} (was ${gbp(quote.basePrice || 0)}).`,
    ].join('\n');

    const updates: Record<string, any> = {
        pricingLineItems: lines,
        basePrice: finalPrice,
        materialsCostWithMarkupPence: materialsTotal,
        batchDiscountPercent: discountPercent,
        jobDescription,
        jobTopLine,
        proposalSummary,
        contextualMessage,
        perLineMargin: wtbp.perLineMargin,
        matchFlags: flags.length > 0 ? flags : null,
        marginPence: finalPrice, // mirrors generation (costPence stays 0 here)
        pricingLayerBreakdown: {
            ...breakdown,
            lineItems: lines,
            subtotalPence: labourTotal,
            finalPricePence: finalPrice,
            totalMaterialsWithMarginPence: materialsTotal,
            jobTopLine,
            contextualMessage,
            reasoning,
            batchDiscount: {
                ...(breakdown.batchDiscount || {}),
                applied: discountPercent > 0,
                discountPercent,
                savingsPence,
                reasoning: 'Six jobs in one visit (flooring removal + installation, skirting, gate, wall '
                    + 'prep and paint, waste removal) — one site visit, coordinated scheduling, shared setup '
                    + 'and cleanup. 12% discount retained on the amended quote.',
            },
            messaging: {
                ...(breakdown.messaging || {}),
                jobTopLine,
                proposalSummary,
                contextualMessage,
            },
            layerBreakdown: {
                ...(breakdown.layerBreakdown || {}),
                layer4FinalPence: finalPrice,
            },
            guardrails: {
                ...(breakdown.guardrails || {}),
                adjustedPricePence: finalPrice,
                originalPricePence: labourTotal,
                adjustments: [
                    '[1jdn3q8h] manual price override → £120.00',
                    '[mn3hs7gk] manual price override → £670.00',
                    '[mn3hs7gk] manual time override → 480min',
                    '[hicjsjtu] manual price override → £180.00',
                    '[kaqqli7d] manual price override → £155.00',
                    '[wst4hb21] manual price override → £120.00',
                    `Batch discount: ${discountPercent}% off subtotal ${gbp(labourTotal)} = -${gbp(savingsPence)}`,
                ],
            },
        },
        // Re-arm the first-view Pushover alert so the amended quote pings the phone.
        viewedAt: null,
    };

    // ── Report ──────────────────────────────────────────────────────────────
    console.log('LINE ITEMS (labour):');
    for (const l of lines) {
        console.log(`  ${l.lineId}  ${String(l.description).padEnd(34)} ${gbp(l.guardedPricePence).padStart(9)}`
            + `   mats ${gbp(l.materialsWithMarginPence || 0).padStart(9)}`);
    }
    console.log(`\n  Labour subtotal          ${gbp(labourTotal).padStart(9)}`);
    console.log(`  Batch discount (${discountPercent}%)      ${('-' + gbp(savingsPence)).padStart(9)}`);
    console.log(`  Materials (with margin)  ${gbp(materialsTotal).padStart(9)}`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  TOTAL                    ${gbp(finalPrice).padStart(9)}   (was ${gbp(quote.basePrice || 0)}, +${gbp(finalPrice - (quote.basePrice || 0))})`);

    console.log(`\nMARGIN (post-discount labour ${gbp(totalCustomer)}):`);
    for (const pl of wtbp.perLineMargin) {
        console.log(`  ${String(pl.categorySlug).padEnd(20)} ${String(pl.hours).padStart(5)}h  `
            + `cust ${gbp(pl.customerPricePence).padStart(9)}  pay ${gbp(pl.contractorCostPence).padStart(9)}  `
            + `${String(pl.marginPercent).padStart(3)}%  ${pl.payMethod}`);
    }
    console.log(`  overall margin: ${totalMarginPct}%`);
    console.log(`\nFLAGS: ${flags.length ? '\n  - ' + flags.join('\n  - ') : 'none'}`);
    console.log(`\nviewedAt: ${quote.viewedAt?.toISOString() ?? 'null'} → null  (re-arms first-view push)`);

    if (!APPLY) {
        console.log('\nDRY RUN — nothing written. Re-run with --apply.');
        process.exit(0);
    }

    await db.update(personalizedQuotes).set(updates).where(eq(personalizedQuotes.id, quote.id));
    console.log(`\n✅ APPLIED to ${quote.id} (${SLUG}).`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
