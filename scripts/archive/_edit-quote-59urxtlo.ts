/**
 * One-off edit for Gaurav's quote 59urxtlo (15 Aug 2026).
 *
 * Six re-prices, all onto EXISTING lines (nothing added, nothing removed):
 *   c4whhc3j  Install cupboard base            £45   → £85    (+ mats cost £15 → £45)
 *   33hwdke7  Re-seal bath with silicone       £75   → £120
 *   5vsot2jl  Prepare walls in five rooms      £175  → £225
 *   ge5qk4tn  Paint all walls in five rooms    £1150 → £1295
 *   li6q79mo  Lay vinyl flooring lounge+kitch  £550  → £650
 *   c58dpf1d  Remove and dispose of waste      £160  → £190
 *
 * Same approach as dles0479: NOT using PATCH /api/pricing/quotes/:id, because
 * it clears the batch discount on any line edit. Owner call on the Harbans
 * quote was to keep it, so the 12% is retained here too.
 *
 * Run:  npx tsx scripts/_edit-quote-59urxtlo.ts          (dry run)
 *       npx tsx scripts/_edit-quote-59urxtlo.ts --apply  (writes)
 */
import { writeFileSync } from 'fs';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { calculateCostFromWTBP } from '../server/margin-engine';

const SLUG = '59urxtlo';
const APPLY = process.argv.includes('--apply');
const BACKUP = `/private/tmp/claude-501/-Users-courtneebonnick-v6-switchboard/ae274370-b89e-4f9e-a39b-5a94b8392b5b/scratchpad/59urxtlo-before.json`;

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

/** Materials markup used throughout this quote (cost → customer). */
const MATERIALS_MARKUP = 1.27;

/** lineId → new labour price in pence. Expected current price guards the write. */
const REPRICE: Record<string, { was: number; now: number; label: string }> = {
    c4whhc3j: { was: 4500, now: 8500, label: 'Install cupboard base' },
    '33hwdke7': { was: 7500, now: 12000, label: 'Re-seal bath with silicone' },
    '5vsot2jl': { was: 17500, now: 22500, label: 'Prepare walls in five rooms' },
    ge5qk4tn: { was: 115000, now: 129500, label: 'Paint all walls in five rooms' },
    li6q79mo: { was: 55000, now: 65000, label: 'Lay vinyl flooring' },
    c58dpf1d: { was: 16000, now: 19000, label: 'Remove and dispose of waste' },
};

/** Cupboard base also gets a materials bump: MDF cost £15 → £45. */
const CUPBOARD_MATS_COST = 4500;

async function main() {
    const [quote] = await db.select().from(personalizedQuotes)
        .where(eq(personalizedQuotes.shortSlug, SLUG));
    if (!quote) throw new Error(`Quote ${SLUG} not found`);

    writeFileSync(BACKUP, JSON.stringify(quote, null, 2));
    console.log(`Backup written → ${BACKUP}\n`);

    const lines = [...((quote.pricingLineItems as any[]) || [])];

    // ── Guards ──────────────────────────────────────────────────────────────
    if (quote.depositPaidAt) throw new Error('ABORT: deposit already paid — do not re-price.');
    if (quote.bookedAt) throw new Error('ABORT: quote already booked.');
    if (quote.basePrice !== 399500) throw new Error(`ABORT: expected basePrice 399500, found ${quote.basePrice}`);
    if (lines.length !== 12) throw new Error(`ABORT: expected 12 line items, found ${lines.length}`);

    for (const [lineId, spec] of Object.entries(REPRICE)) {
        const l = lines.find((x) => x.lineId === lineId);
        if (!l) throw new Error(`ABORT: line ${lineId} (${spec.label}) not found`);
        if (l.guardedPricePence !== spec.was) {
            throw new Error(`ABORT: ${lineId} (${spec.label}) expected ${gbp(spec.was)}, found ${gbp(l.guardedPricePence)} — already edited?`);
        }
    }

    // ── Apply labour re-prices ──────────────────────────────────────────────
    for (const [lineId, spec] of Object.entries(REPRICE)) {
        const l = lines.find((x) => x.lineId === lineId)!;
        l.guardedPricePence = spec.now;
        l.priceOverridePence = spec.now;
        l.llmSuggestedPricePence = spec.now;
    }

    // ── Cupboard base materials: £15 cost → £45 cost (customer sees ×1.27) ──
    const cupboard = lines.find((x) => x.lineId === 'c4whhc3j')!;
    if (Array.isArray(cupboard.materials) && cupboard.materials.length === 1) {
        cupboard.materials[0].unitPricePence = CUPBOARD_MATS_COST;
    } else {
        throw new Error('ABORT: cupboard base materials array not the expected single entry.');
    }
    cupboard.materialsCostPence = CUPBOARD_MATS_COST;
    // Whole pounds, as every other materials figure on this quote already is
    // (£40→£51, £120→£152, £700→£889 …). £45 × 1.27 = £57.15 → £57.
    cupboard.materialsWithMarginPence = Math.round(CUPBOARD_MATS_COST * MATERIALS_MARKUP / 100) * 100;

    // ── Recalculate totals, keeping the batch discount ──────────────────────
    const labourTotal = lines.reduce((s, l) => s + (Number(l.guardedPricePence) || 0), 0);
    const materialsTotal = lines.reduce((s, l) => s + (Number(l.materialsWithMarginPence) || 0), 0);

    const breakdown = { ...((quote.pricingLayerBreakdown as Record<string, any>) || {}) };
    const bucketsTotal = Number(breakdown?.priceBuckets?.totalBucketsPence) || 0;
    const discountPercent = Number(quote.batchDiscountPercent) || 0;

    // Raw 12% lands the total on £4,393.84. The engine itself rounds the
    // discount to land a clean total (it nudged £351.96 → £352.00 to hit
    // £3,995.00 at generation), so do the same: round the saving UP to the
    // nearest £10 in the customer's favour, giving a whole-pound total.
    const rawSaving = Math.round(labourTotal * discountPercent / 100);
    const savingsPence = Math.ceil(rawSaving / 1000) * 1000;
    const finalPrice = labourTotal - savingsPence + materialsTotal + bucketsTotal;

    // ── Recompute per-line margin the way generation does ───────────────────
    const discountFactor = 1 - savingsPence / labourTotal;
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

    // Scope is unchanged (no lines added or removed), so jobDescription and all
    // customer-facing messaging stay exactly as generated. Only prices moved.
    const reasoning = [
        (breakdown.reasoning || '').trim(),
        '',
        `--- EDIT ${new Date().toISOString().slice(0, 10)} (owner instruction) ---`,
        ...Object.entries(REPRICE).map(([id, s]) =>
            `[${id}] ${s.label}: ${gbp(s.was)} → ${gbp(s.now)}.`),
        `[c4whhc3j] materials (MDF cupboard base) cost £15.00 → £45.00 `
        + `(customer ${gbp(cupboard.materialsWithMarginPence)} at the ×1.27 markup used across this quote).`,
        `Labour subtotal: ${gbp(labourTotal)}. Batch discount retained at ${discountPercent}% = -${gbp(savingsPence)} `
        + `(rounded up from ${gbp(rawSaving)} to land a whole-pound total).`,
        `Materials: ${gbp(materialsTotal)}.`,
        `Final: ${gbp(finalPrice)} (was ${gbp(quote.basePrice || 0)}).`,
    ].join('\n');

    const updates: Record<string, any> = {
        pricingLineItems: lines,
        basePrice: finalPrice,
        materialsCostWithMarkupPence: materialsTotal,
        batchDiscountPercent: discountPercent,
        perLineMargin: wtbp.perLineMargin,
        matchFlags: flags.length > 0 ? flags : null,
        marginPence: finalPrice, // mirrors generation (costPence stays 0)
        pricingLayerBreakdown: {
            ...breakdown,
            lineItems: lines,
            subtotalPence: labourTotal,
            finalPricePence: finalPrice,
            totalMaterialsWithMarginPence: materialsTotal,
            reasoning,
            batchDiscount: {
                ...(breakdown.batchDiscount || {}),
                applied: discountPercent > 0,
                discountPercent,
                savingsPence,
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
                    ...Object.entries(REPRICE).map(([id, s]) =>
                        `[${id}] manual price override → ${gbp(s.now)}`),
                    `[c4whhc3j] manual materials cost → ${gbp(CUPBOARD_MATS_COST)}`,
                    `Batch discount: ${discountPercent}% off subtotal ${gbp(labourTotal)} = -${gbp(savingsPence)}`,
                ],
            },
        },
        // Re-arm the first-view Pushover alert for the amended quote.
        viewedAt: null,
    };

    // ── Report ──────────────────────────────────────────────────────────────
    console.log('LINE ITEMS (labour · materials to customer):');
    for (const l of lines) {
        const changed = !!REPRICE[l.lineId];
        console.log(`  ${changed ? '→' : ' '} ${String(l.description).slice(0, 44).padEnd(45)}`
            + `${gbp(l.guardedPricePence).padStart(9)}  ${gbp(l.materialsWithMarginPence || 0).padStart(9)}`
            + `${changed ? `   (was ${gbp(REPRICE[l.lineId].was)})` : ''}`);
    }
    console.log(`\n  Labour subtotal          ${gbp(labourTotal).padStart(9)}   (was £2933.00)`);
    console.log(`  Batch discount (${discountPercent}%)      ${('-' + gbp(savingsPence)).padStart(9)}   (raw ${gbp(rawSaving)})`);
    console.log(`  Materials (with margin)  ${gbp(materialsTotal).padStart(9)}   (was £1414.00)`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  TOTAL                    ${gbp(finalPrice).padStart(9)}   (was ${gbp(quote.basePrice || 0)}, +${gbp(finalPrice - (quote.basePrice || 0))})`);

    console.log(`\nMARGIN (post-discount labour ${gbp(totalCustomer)}):`);
    for (const pl of wtbp.perLineMargin) {
        console.log(`  ${String(pl.categorySlug).padEnd(18)} ${String(pl.hours).padStart(5)}h  `
            + `cust ${gbp(pl.customerPricePence).padStart(9)}  pay ${gbp(pl.contractorCostPence).padStart(9)}  `
            + `${String(pl.marginPercent).padStart(3)}%  ${pl.payMethod}`);
    }
    console.log(`  overall margin: ${totalMarginPct}%`);
    console.log(`\nFLAGS:${flags.length ? '\n  - ' + flags.join('\n  - ') : ' none'}`);
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
