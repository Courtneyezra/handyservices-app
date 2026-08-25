/**
 * One-off edit for heetan mayer's quote m44nd9z0 (24 Aug 2026).
 *
 * ADD one line (owner instruction, confirmed):
 *   Re-align and stabilise bath — labour £120, materials cost £35
 *   (customer sees £44.45 at the quote's standard ×1.27 materials markup).
 *
 * Placed FIRST in the line order — it's prep before the panels go on.
 * Scheduling: fits inside the existing single visit (owner call). New line
 * carries 60min estimate with explicit 0 setup/cleanup so no phantom buffer
 * is added (see line-buffer-inflation lesson); plumbing_minor clamps keep
 * this a one-day booking regardless.
 *
 * Same approach as 59urxtlo/dles0479: direct DB patch, NOT the PATCH API.
 *
 * Run:  npx tsx scripts/_edit-quote-m44nd9z0.ts          (dry run)
 *       npx tsx scripts/_edit-quote-m44nd9z0.ts --apply  (writes)
 */
import { writeFileSync } from 'fs';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { calculateCostFromWTBP } from '../server/margin-engine';

const SLUG = 'm44nd9z0';
const APPLY = process.argv.includes('--apply');
const BACKUP = `/private/tmp/claude-501/-Users-courtneebonnick-v6-switchboard/60753473-c6a6-4396-a49f-2c2e88767846/scratchpad/m44nd9z0-before.json`;

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

const MATERIALS_MARKUP = 1.27;
const NEW_LABOUR = 12000;         // £120
const NEW_MATS_COST = 3500;       // £35 cost
const NEW_MATS_CUSTOMER = Math.round(NEW_MATS_COST * MATERIALS_MARKUP); // 4445 = £44.45

const NEW_LINE = {
    lineId: 'bathrlgn',
    source: 'custom',
    category: 'plumbing_minor',
    description: 'Re-align and stabilise bath',
    scopeSteps: [
        'Bath checked — movement and alignment assessed against the walls',
        'Re-aligned — bath levelled and set square to the walls',
        'Stabilised — feet and supports adjusted and secured so it can\'t rock',
        'Ready for panels — solid, stable base before panels are fitted and sealed',
    ],
    scheduleMinutes: 60,
    setupMinutes: 0,
    cleanupMinutes: 0,
    adjustmentFactors: [],
    guardedPricePence: NEW_LABOUR,
    materialsCostPence: NEW_MATS_COST,
    priceOverridePence: NEW_LABOUR,
    referencePricePence: NEW_LABOUR,
    timeEstimateMinutes: 60,
    timeOverrideMinutes: 60,
    llmSuggestedPricePence: NEW_LABOUR,
    materialsWithMarginPence: NEW_MATS_CUSTOMER,
    requiresMaterialCollection: false,
};

async function main() {
    const [quote] = await db.select().from(personalizedQuotes)
        .where(eq(personalizedQuotes.shortSlug, SLUG));
    if (!quote) throw new Error(`Quote ${SLUG} not found`);

    writeFileSync(BACKUP, JSON.stringify(quote, null, 2));
    console.log(`Backup written → ${BACKUP}\n`);

    const existing = [...((quote.pricingLineItems as any[]) || [])];

    // ── Guards ──────────────────────────────────────────────────────────────
    if (quote.depositPaidAt) throw new Error('ABORT: deposit already paid — do not re-price.');
    if (quote.bookedAt) throw new Error('ABORT: quote already booked.');
    if (quote.basePrice !== 100590) throw new Error(`ABORT: expected basePrice 100590, found ${quote.basePrice}`);
    if (existing.length !== 1 || existing[0].lineId !== 'wgiuwu2z') {
        throw new Error(`ABORT: expected the single panels line wgiuwu2z, found ${existing.map((l) => l.lineId).join(',')}`);
    }
    if (existing.some((l) => l.lineId === NEW_LINE.lineId)) {
        throw new Error('ABORT: bathrlgn already present — already edited?');
    }

    // Prep first, panels second.
    const lines = [NEW_LINE, ...existing];

    // ── Totals (no batch discount on this quote) ────────────────────────────
    const labourTotal = lines.reduce((s, l) => s + (Number(l.guardedPricePence) || 0), 0);
    const materialsTotal = lines.reduce((s, l) => s + (Number(l.materialsWithMarginPence) || 0), 0);
    const finalPrice = labourTotal + materialsTotal;

    // ── Per-line margin, same as generation ─────────────────────────────────
    const wtbp = await calculateCostFromWTBP(lines.map((l) => ({
        categorySlug: l.category,
        pricePence: l.guardedPricePence || 0,
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

    const breakdown = { ...((quote.pricingLayerBreakdown as Record<string, any>) || {}) };

    // Scope CHANGED (line added) — update the job description and summary so
    // the copy matches what the customer sees in the line items.
    const jobDescription = 'Re-align and stabilise bath + install shower panels around bath';
    const proposalSummary = "We'll first re-align and stabilise your bath so it's solid and level, then install shower panels around it, sourcing all materials and ensuring a watertight finish. Everything done in one visit with full cleanup included.";
    const contextualMessage = "We'll get your bath re-aligned and stabilised, then the shower panels fitted properly — no leaks, no surprises on price. Everything sourced and fitted in one visit.";

    const reasoning = [
        (breakdown.reasoning || '').trim(),
        '',
        `--- EDIT ${new Date().toISOString().slice(0, 10)} (owner instruction) ---`,
        `[bathrlgn] ADDED: Re-align and stabilise bath — labour ${gbp(NEW_LABOUR)}, `
        + `materials cost ${gbp(NEW_MATS_COST)} → customer ${gbp(NEW_MATS_CUSTOMER)} at the ×1.27 markup used on this quote.`,
        `Placed first in line order (prep before panels). 60min estimate, 0 setup/cleanup — fits inside the existing single visit.`,
        `Labour subtotal: ${gbp(labourTotal)}. Materials: ${gbp(materialsTotal)}.`,
        `Final: ${gbp(finalPrice)} (was ${gbp(quote.basePrice || 0)}).`,
    ].join('\n');

    const updates: Record<string, any> = {
        pricingLineItems: lines,
        basePrice: finalPrice,
        materialsCostWithMarkupPence: materialsTotal,
        perLineMargin: wtbp.perLineMargin,
        matchFlags: flags.length > 0 ? flags : null,
        marginPence: finalPrice, // mirrors generation (costPence stays 0)
        jobDescription,
        proposalSummary,
        contextualMessage,
        pricingLayerBreakdown: {
            ...breakdown,
            lineItems: lines,
            subtotalPence: labourTotal,
            finalPricePence: finalPrice,
            totalMaterialsWithMarginPence: materialsTotal,
            reasoning,
            contextualMessage,
            messaging: {
                ...(breakdown.messaging || {}),
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
                    ...((breakdown.guardrails?.adjustments as string[]) || []),
                    `[bathrlgn] line added → labour ${gbp(NEW_LABOUR)}, materials ${gbp(NEW_MATS_CUSTOMER)}`,
                ],
            },
        },
        // Re-arm the first-view Pushover alert for the amended quote.
        viewedAt: null,
    };

    // ── Report ──────────────────────────────────────────────────────────────
    console.log('LINE ITEMS (labour · materials to customer):');
    for (const l of lines) {
        const added = l.lineId === NEW_LINE.lineId;
        console.log(`  ${added ? '+' : ' '} ${String(l.description).slice(0, 44).padEnd(45)}`
            + `${gbp(l.guardedPricePence).padStart(9)}  ${gbp(l.materialsWithMarginPence || 0).padStart(9)}`);
    }
    console.log(`\n  Labour subtotal          ${gbp(labourTotal).padStart(9)}   (was £472.50)`);
    console.log(`  Materials (with margin)  ${gbp(materialsTotal).padStart(9)}   (was £533.40)`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  TOTAL                    ${gbp(finalPrice).padStart(9)}   (was ${gbp(quote.basePrice || 0)}, +${gbp(finalPrice - (quote.basePrice || 0))})`);

    console.log(`\nMARGIN:`);
    for (const pl of wtbp.perLineMargin) {
        console.log(`  ${String(pl.categorySlug).padEnd(18)} ${String(pl.hours).padStart(5)}h  `
            + `cust ${gbp(pl.customerPricePence).padStart(9)}  pay ${gbp(pl.contractorCostPence).padStart(9)}  `
            + `${String(pl.marginPercent).padStart(3)}%  ${pl.payMethod}`);
    }
    console.log(`  overall margin: ${totalMarginPct}%`);
    console.log(`\nFLAGS:${flags.length ? '\n  - ' + flags.join('\n  - ') : ' none'}`);
    console.log(`\nviewedAt: ${quote.viewedAt?.toISOString() ?? 'null'} → null  (re-arms first-view push)`);
    console.log(`expiresAt: ${quote.expiresAt?.toISOString() ?? 'null'} (unchanged)`);

    if (!APPLY) {
        console.log('\nDRY RUN — nothing written. Re-run with --apply.');
        process.exit(0);
    }

    await db.update(personalizedQuotes).set(updates).where(eq(personalizedQuotes.id, quote.id));
    console.log(`\n✅ APPLIED to ${quote.id} (${SLUG}).`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
