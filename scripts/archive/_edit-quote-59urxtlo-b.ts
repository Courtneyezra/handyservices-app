/**
 * Second pass on Gaurav's quote 59urxtlo (15 Aug 2026) — margin-flag cleanup.
 *
 *   k5eqydbl  Hang internal door           240min → 120min  (price held at £106)
 *   5vsot2jl  Prepare walls in five rooms   £225  → £230
 *
 * Both changes exist to clear `reprice_needed` flags, where the contractor
 * hourly floor was eating the line:
 *   - Door: 4hr × £22 floor = £88 against a £106 line, leaving Handy £5. At
 *     2hr the floor drops to £44 and the 50% share (£46.51) takes over.
 *   - Prep walls: 5hr × £18 floor = £90 vs a £88.83 share — short by £1.17.
 *     £230 lifts the share to £90.82 and it wins.
 *
 * Run:  npx tsx scripts/_edit-quote-59urxtlo-b.ts          (dry run)
 *       npx tsx scripts/_edit-quote-59urxtlo-b.ts --apply  (writes)
 */
import { writeFileSync } from 'fs';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { calculateCostFromWTBP } from '../server/margin-engine';

const SLUG = '59urxtlo';
const APPLY = process.argv.includes('--apply');
const BACKUP = `/private/tmp/claude-501/-Users-courtneebonnick-v6-switchboard/ae274370-b89e-4f9e-a39b-5a94b8392b5b/scratchpad/59urxtlo-before-b.json`;

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

const DOOR_ID = 'k5eqydbl';
const PREP_ID = '5vsot2jl';
const DOOR_NEW_MINUTES = 120;
const PREP_NEW_PRICE = 23000;

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
    if (quote.basePrice !== 438500) throw new Error(`ABORT: expected basePrice 438500, found ${quote.basePrice}`);

    const door = lines.find((l) => l.lineId === DOOR_ID);
    const prep = lines.find((l) => l.lineId === PREP_ID);
    if (!door) throw new Error('ABORT: door line not found');
    if (!prep) throw new Error('ABORT: prep-walls line not found');
    if (door.scheduleMinutes !== 240) throw new Error(`ABORT: door expected 240min, found ${door.scheduleMinutes}`);
    if (prep.guardedPricePence !== 22500) throw new Error(`ABORT: prep expected £225.00, found ${gbp(prep.guardedPricePence)}`);

    // ── Apply ───────────────────────────────────────────────────────────────
    // Door: time only. timeOverrideMinutes marks it as a deliberate manual
    // call so a later re-price doesn't quietly restore the LLM's 4hr estimate.
    door.scheduleMinutes = DOOR_NEW_MINUTES;
    door.timeEstimateMinutes = DOOR_NEW_MINUTES;
    door.timeOverrideMinutes = DOOR_NEW_MINUTES;

    prep.guardedPricePence = PREP_NEW_PRICE;
    prep.priceOverridePence = PREP_NEW_PRICE;
    prep.llmSuggestedPricePence = PREP_NEW_PRICE;

    // ── Recalculate, keeping the batch discount ─────────────────────────────
    const labourTotal = lines.reduce((s, l) => s + (Number(l.guardedPricePence) || 0), 0);
    const materialsTotal = lines.reduce((s, l) => s + (Number(l.materialsWithMarginPence) || 0), 0);

    const breakdown = { ...((quote.pricingLayerBreakdown as Record<string, any>) || {}) };
    const bucketsTotal = Number(breakdown?.priceBuckets?.totalBucketsPence) || 0;
    const discountPercent = Number(quote.batchDiscountPercent) || 0;

    const rawSaving = Math.round(labourTotal * discountPercent / 100);
    const savingsPence = Math.ceil(rawSaving / 1000) * 1000; // whole-pound total
    const finalPrice = labourTotal - savingsPence + materialsTotal + bucketsTotal;

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

    const reasoning = [
        (breakdown.reasoning || '').trim(),
        '',
        `--- EDIT ${new Date().toISOString().slice(0, 10)} b (margin-flag cleanup) ---`,
        `[${DOOR_ID}] Hang internal door: 240min → 120min, price held at £106.00. `
        + 'The 4hr estimate put the £22/hr floor (£88) above the 50% share, leaving Handy £5. '
        + 'At 2hr the share (£46.51) clears the £44 floor.',
        `[${PREP_ID}] Prepare walls in five rooms: £225.00 → £230.00 — lifts the 45% share above the `
        + '5hr × £18 floor (£90), which it previously missed by £1.17.',
        `Labour subtotal: ${gbp(labourTotal)}. Batch discount retained at ${discountPercent}% = -${gbp(savingsPence)}.`,
        `Final: ${gbp(finalPrice)} (was ${gbp(quote.basePrice || 0)}).`,
    ].join('\n');

    const updates: Record<string, any> = {
        pricingLineItems: lines,
        basePrice: finalPrice,
        materialsCostWithMarkupPence: materialsTotal,
        perLineMargin: wtbp.perLineMargin,
        matchFlags: flags.length > 0 ? flags : null,
        marginPence: finalPrice,
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
            layerBreakdown: { ...(breakdown.layerBreakdown || {}), layer4FinalPence: finalPrice },
            guardrails: {
                ...(breakdown.guardrails || {}),
                adjustedPricePence: finalPrice,
                originalPricePence: labourTotal,
                adjustments: [
                    ...((breakdown.guardrails?.adjustments as string[]) || [])
                        .filter((a) => !a.startsWith(`[${PREP_ID}]`) && !a.startsWith('Batch discount:')),
                    `[${PREP_ID}] manual price override → ${gbp(PREP_NEW_PRICE)}`,
                    `[${DOOR_ID}] manual time override → ${DOOR_NEW_MINUTES}min`,
                    `Batch discount: ${discountPercent}% off subtotal ${gbp(labourTotal)} = -${gbp(savingsPence)}`,
                ],
            },
        },
    };

    // ── Report ──────────────────────────────────────────────────────────────
    const totalMinutes = lines.reduce((s, l) => s + (Number(l.scheduleMinutes) || 0), 0);
    console.log(`Door   : 240min → ${DOOR_NEW_MINUTES}min, price held at ${gbp(door.guardedPricePence)}`);
    console.log(`Prep   : £225.00 → ${gbp(prep.guardedPricePence)}`);
    console.log(`\n  Labour subtotal          ${gbp(labourTotal).padStart(9)}   (was £3343.00)`);
    console.log(`  Batch discount (${discountPercent}%)      ${('-' + gbp(savingsPence)).padStart(9)}   (raw ${gbp(rawSaving)})`);
    console.log(`  Materials                ${gbp(materialsTotal).padStart(9)}`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  TOTAL                    ${gbp(finalPrice).padStart(9)}   (was ${gbp(quote.basePrice || 0)}, +${gbp(finalPrice - (quote.basePrice || 0))})`);
    console.log(`  scheduled time           ${(totalMinutes / 60).toFixed(1)}h   (was ${((totalMinutes + 120) / 60).toFixed(1)}h)`);

    console.log('\nPREVIOUSLY FLAGGED LINES:');
    for (const pl of wtbp.perLineMargin) {
        if (pl.categorySlug === 'door_fitting' || (pl.categorySlug === 'painting' && pl.hours === 5)) {
            console.log(`  ${String(pl.categorySlug).padEnd(14)} ${String(pl.hours).padStart(4)}h  cust ${gbp(pl.customerPricePence).padStart(9)}`
                + `  pay ${gbp(pl.contractorCostPence).padStart(8)}  ${String(pl.marginPercent).padStart(3)}%  ${pl.payMethod}`);
        }
    }
    console.log(`  overall margin: ${totalMarginPct}%`);
    console.log(`\nFLAGS:${flags.length ? '\n  - ' + flags.join('\n  - ') : ' none ✅'}`);

    if (!APPLY) {
        console.log('\nDRY RUN — nothing written. Re-run with --apply.');
        process.exit(0);
    }

    await db.update(personalizedQuotes).set(updates).where(eq(personalizedQuotes.id, quote.id));
    console.log(`\n✅ APPLIED to ${quote.id} (${SLUG}).`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
