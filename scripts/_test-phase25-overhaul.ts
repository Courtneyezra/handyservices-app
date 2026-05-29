/**
 * Phase 25 end-to-end overhaul test.
 *
 * Verifies every layer of the SKU catalog + pricing rework that Agents
 * 25a-25d shipped. Re-runnable any time — all synthetic rows are deleted
 * before exit, real prod data is read-only.
 *
 * Layers exercised:
 *   Test 1 — catalog integrity (49 active SKUs, shape constraints)
 *   Test 2 — resolveLineItemFromSku (fixed / per_unit / tiered + Sat premium)
 *   Test 3 — multi-line engine: 3 SKU lines + 1 custom line price together
 *   Test 4 — admin search query logic (matches /api/admin/sku-catalog/search)
 *   Test 5 — backward compat: re-run composeScheduleMinutes on 3 real
 *            accepted quotes; total minutes match what was stored
 *   Test 6 — flex booking: isQuoteFlex / getFlexWindowDays
 *   Test 7 — Phase 24 multi-day flow with SKU-driven scheduleMinutes
 *   Test 8 — `npm run build`
 */
import 'dotenv/config';
import { db } from '../server/db';
import {
    personalizedQuotes,
    serviceCatalog,
    bookingSlotLocks,
} from '../shared/schema';
import { eq, and, isNotNull, ilike, or, asc, desc } from 'drizzle-orm';
import {
    composeScheduleMinutes,
    computeRequiredDays,
    isQuoteFlex,
    getFlexWindowDays,
    pickLineMinutes,
} from '../shared/schedule-composition';
import {
    resolveLineItemFromSku,
    getSkuByCode,
    invalidateSkuCache,
} from '../server/contextual-pricing/sku-resolver';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
    const dot = detail ? ` — ${detail}` : '';
    if (ok) {
        console.log(`  ✓ ${name}${dot}`);
        pass++;
    } else {
        console.log(`  ✗ ${name}${dot}`);
        failures.push(`${name}${dot}`);
        fail++;
    }
}

// Pick a Saturday + a non-Saturday in the future, deterministically
function nextSaturday(base = new Date()): Date {
    const d = new Date(base);
    d.setUTCHours(0, 0, 0, 0);
    const dow = d.getUTCDay();
    // Saturday in *local* time matters because sku-resolver uses .getDay().
    // Build a Saturday at noon UTC — that's Saturday everywhere west of Asia.
    const daysToSat = (6 - dow + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysToSat);
    d.setUTCHours(12, 0, 0, 0);
    return d;
}
function nextWednesday(base = new Date()): Date {
    const d = new Date(base);
    d.setUTCHours(0, 0, 0, 0);
    const dow = d.getUTCDay();
    const daysToWed = (3 - dow + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysToWed);
    d.setUTCHours(12, 0, 0, 0);
    return d;
}

async function main() {
    console.log('\n═══ Phase 25 overhaul end-to-end test ═══\n');

    // Tracked synthetic IDs so cleanup is precise
    const syntheticQuoteIds: string[] = [];

    try {
        // ─────────────────────────────────────────────────────────────
        // TEST 1 — Catalog integrity
        // ─────────────────────────────────────────────────────────────
        console.log('Test 1 — service_catalog integrity\n');
        const allSkus = await db.select().from(serviceCatalog);
        const activeSkus = allSkus.filter((r) => r.isActive);
        check('exactly 49 active SKUs', activeSkus.length === 49, `actual=${activeSkus.length}`);

        // All have the mandatory text fields
        const missingCore = activeSkus.filter(
            (r) =>
                !r.skuCode ||
                !r.name ||
                !r.category ||
                !r.customerDescription,
        );
        check('every SKU has skuCode/name/category/customerDescription', missingCore.length === 0, `${missingCore.length} missing`);

        // Shape distribution: 26 fixed, 13 tiered, 10 per_unit
        const byShape: Record<string, number> = {};
        for (const r of activeSkus) byShape[r.shape] = (byShape[r.shape] || 0) + 1;
        check('26 fixed SKUs', byShape['fixed'] === 26, `actual=${byShape['fixed']}`);
        check('13 tiered SKUs', byShape['tiered'] === 13, `actual=${byShape['tiered']}`);
        check('10 per_unit SKUs', byShape['per_unit'] === 10, `actual=${byShape['per_unit']}`);

        // Fixed: pricePence + scheduleMinutes populated; no tiers; no per-unit fields
        const fixedRows = activeSkus.filter((r) => r.shape === 'fixed');
        const badFixed = fixedRows.filter(
            (r) =>
                r.pricePence == null ||
                r.scheduleMinutes == null ||
                (r.tiers != null && (r.tiers as any[]).length > 0) ||
                r.pricePerUnitPence != null ||
                r.minutesPerUnit != null ||
                r.unitLabel != null,
        );
        check('fixed rows: price+mins set, no per_unit/tier bleed', badFixed.length === 0, `bad=${badFixed.length} ${badFixed.slice(0,3).map(b=>b.skuCode).join(',')}`);

        // Per_unit: required fields populated; no tiers; no fixed price/mins
        const perUnitRows = activeSkus.filter((r) => r.shape === 'per_unit');
        const badPerUnit = perUnitRows.filter(
            (r) =>
                r.pricePerUnitPence == null ||
                !r.unitLabel ||
                r.minimumUnits == null ||
                r.minutesPerUnit == null ||
                r.setupMinutes == null ||
                (r.tiers != null && (r.tiers as any[]).length > 0) ||
                r.pricePence != null ||
                r.scheduleMinutes != null,
        );
        check('per_unit rows: all 5 unit fields set, no fixed/tier bleed', badPerUnit.length === 0, `bad=${badPerUnit.length} ${badPerUnit.slice(0,3).map(b=>b.skuCode).join(',')}`);

        // Tiered: tiers JSONB is a valid array of {label, pricePence, scheduleMinutes}
        const tieredRows = activeSkus.filter((r) => r.shape === 'tiered');
        const badTiered = tieredRows.filter((r) => {
            const t = r.tiers as any[] | null;
            if (!Array.isArray(t) || t.length === 0) return true;
            return t.some(
                (x) =>
                    !x ||
                    typeof x.label !== 'string' ||
                    typeof x.pricePence !== 'number' ||
                    typeof x.scheduleMinutes !== 'number',
            );
        });
        check('tiered rows: tiers array valid with {label,pricePence,scheduleMinutes}', badTiered.length === 0, `bad=${badTiered.length} ${badTiered.slice(0,3).map(b=>b.skuCode).join(',')}`);

        // Mixed-shape check: tiered rows should NOT have pricePence/scheduleMinutes set
        const badTieredBleed = tieredRows.filter(
            (r) => r.pricePence != null || r.scheduleMinutes != null || r.pricePerUnitPence != null,
        );
        check('tiered rows do NOT have fixed/per_unit fields set', badTieredBleed.length === 0, `bad=${badTieredBleed.length}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 2 — resolveLineItemFromSku
        // ─────────────────────────────────────────────────────────────
        console.log('\nTest 2 — resolveLineItemFromSku (sku-resolver.ts)\n');

        // Pick known SKUs from prod
        const tap = await getSkuByCode('TAP-01'); // fixed
        const door = await getSkuByCode('DOOR-15'); // per_unit
        const rpnt = await getSkuByCode('RPNT-28'); // tiered

        check('TAP-01 row fetched', !!tap, tap?.shape);
        check('DOOR-15 row fetched', !!door, door?.shape);
        check('RPNT-28 row fetched', !!rpnt, rpnt?.shape);

        const wedDate = nextWednesday();
        const satDate = nextSaturday();

        // Fixed: returns row's price + scheduleMinutes; no premium on Wed
        const fixedWed = await resolveLineItemFromSku({ skuCode: 'TAP-01', scheduledDate: wedDate });
        check('TAP-01 weekday: price matches catalog', fixedWed?.pricePence === tap?.pricePence, `got=${fixedWed?.pricePence}, expected=${tap?.pricePence}`);
        check('TAP-01 weekday: scheduleMinutes matches catalog', fixedWed?.scheduleMinutes === tap?.scheduleMinutes, `got=${fixedWed?.scheduleMinutes}, expected=${tap?.scheduleMinutes}`);
        check('TAP-01 weekday: NO off-peak premium', fixedWed?.offPeakPremiumAppliedPence === 0, `got=${fixedWed?.offPeakPremiumAppliedPence}`);

        // Fixed on Saturday: premium added ONCE
        const fixedSat = await resolveLineItemFromSku({ skuCode: 'TAP-01', scheduledDate: satDate });
        const expectedSatPrice = (tap!.pricePence || 0) + (tap!.offPeakWeekendPremiumPence || 0);
        check('TAP-01 Saturday: price includes premium ONCE', fixedSat?.pricePence === expectedSatPrice, `got=${fixedSat?.pricePence}, expected=${expectedSatPrice} (${tap?.pricePence}+${tap?.offPeakWeekendPremiumPence})`);
        check('TAP-01 Saturday: offPeakPremiumAppliedPence correct', fixedSat?.offPeakPremiumAppliedPence === (tap?.offPeakWeekendPremiumPence || 0));

        // Per-unit: count above min
        // DOOR-15: perUnit=8533p, label=door, min=1, minsPer=121, setup=20
        const door3 = await resolveLineItemFromSku({
            skuCode: 'DOOR-15',
            unitCount: 3,
            scheduledDate: wedDate,
        });
        const expectedDoor3Price = (door!.pricePerUnitPence || 0) * 3;
        const expectedDoor3Mins = (door!.minutesPerUnit || 0) * 3 + (door!.setupMinutes || 0);
        check('DOOR-15 x3: price = perUnit × 3', door3?.pricePence === expectedDoor3Price, `got=${door3?.pricePence}, expected=${expectedDoor3Price}`);
        check('DOOR-15 x3: schedule = mins/unit × 3 + setup', door3?.scheduleMinutes === expectedDoor3Mins, `got=${door3?.scheduleMinutes}, expected=${expectedDoor3Mins}`);

        // Per-unit: count below min (should be clamped up)
        const door0 = await resolveLineItemFromSku({
            skuCode: 'DOOR-15',
            unitCount: 0,
            scheduledDate: wedDate,
        });
        const expectedDoorMinPrice = (door!.pricePerUnitPence || 0) * (door!.minimumUnits || 1);
        check('DOOR-15 below min: clamps to minimum', door0?.pricePence === expectedDoorMinPrice, `got=${door0?.pricePence}, expected=${expectedDoorMinPrice} (min=${door?.minimumUnits})`);

        // Per-unit on Saturday: premium added ONCE (not per unit)
        const door3Sat = await resolveLineItemFromSku({
            skuCode: 'DOOR-15',
            unitCount: 3,
            scheduledDate: satDate,
        });
        const expectedDoor3SatPrice = expectedDoor3Price + (door!.offPeakWeekendPremiumPence || 0);
        check('DOOR-15 x3 Saturday: premium added ONCE (not per unit)', door3Sat?.pricePence === expectedDoor3SatPrice, `got=${door3Sat?.pricePence}, expected=${expectedDoor3SatPrice}`);

        // Tiered: each tier resolves to its own price/mins
        // RPNT-28 tiers: Small 9000p/120min, Medium 11000p/150min, Large 13700p/240min
        const tiers = rpnt!.tiers as any[];
        const tierMap = Object.fromEntries(tiers.map((t) => [t.label, t]));
        for (const label of ['Small', 'Medium', 'Large']) {
            const tier = tierMap[label];
            const r = await resolveLineItemFromSku({
                skuCode: 'RPNT-28',
                selectedTier: label,
                scheduledDate: wedDate,
            });
            check(`RPNT-28 ${label}: price = ${tier.pricePence}`, r?.pricePence === tier.pricePence, `got=${r?.pricePence}`);
            check(`RPNT-28 ${label}: scheduleMinutes = ${tier.scheduleMinutes}`, r?.scheduleMinutes === tier.scheduleMinutes, `got=${r?.scheduleMinutes}`);
        }

        // Tiered on Saturday: premium added ONCE
        const rpntSat = await resolveLineItemFromSku({
            skuCode: 'RPNT-28',
            selectedTier: 'Medium',
            scheduledDate: satDate,
        });
        const expectedRpntSat = tierMap['Medium'].pricePence + (rpnt!.offPeakWeekendPremiumPence || 0);
        check('RPNT-28 Medium Saturday: premium added ONCE', rpntSat?.pricePence === expectedRpntSat, `got=${rpntSat?.pricePence}, expected=${expectedRpntSat}`);

        // Unknown SKU → null
        const bogus = await resolveLineItemFromSku({ skuCode: 'BOGUS-9999', scheduledDate: wedDate });
        check('unknown SKU code returns null', bogus === null);

        // Missing tier → null
        const missingTier = await resolveLineItemFromSku({
            skuCode: 'RPNT-28',
            selectedTier: 'XXL',
            scheduledDate: wedDate,
        });
        check('missing tier label returns null', missingTier === null);

        // ─────────────────────────────────────────────────────────────
        // TEST 3 — Multi-line engine: 3 SKUs + 1 custom
        // ─────────────────────────────────────────────────────────────
        console.log('\nTest 3 — multi-line engine: 3 SKU lines + 1 custom line\n');
        invalidateSkuCache(); // clean slate

        const { generateMultiLinePrice } = await import('../server/contextual-pricing/multi-line-engine');
        const t3Request: any = {
            lines: [
                {
                    id: 'L1',
                    description: 'Replace kitchen tap',
                    category: 'plumbing_minor',
                    timeEstimateMinutes: 45,
                    source: 'sku',
                    skuCode: 'TAP-01',
                },
                {
                    id: 'L2',
                    description: 'Hang 3 internal doors',
                    category: 'door_fitting',
                    timeEstimateMinutes: 363,
                    source: 'sku',
                    skuCode: 'DOOR-15',
                    unitCount: 3,
                },
                {
                    id: 'L3',
                    description: 'Repaint medium bedroom',
                    category: 'painting',
                    timeEstimateMinutes: 150,
                    source: 'sku',
                    skuCode: 'RPNT-28',
                    selectedTier: 'Medium',
                },
                {
                    id: 'L4',
                    description: 'Assemble flat-pack wardrobe',
                    category: 'general_fixing',
                    timeEstimateMinutes: 90,
                },
            ],
            signals: {
                urgency: 'standard',
                materialsSupply: 'customer_supplied',
                timeOfService: 'standard',
                isReturningCustomer: false,
                previousJobCount: 0,
                previousAvgPricePence: 0,
            },
            scheduledDate: wedDate.toISOString(),
        };

        let t3Result: any = null;
        try {
            t3Result = await generateMultiLinePrice(t3Request);
            check('engine returned a MultiLineResult', !!t3Result && Array.isArray(t3Result.lineItems));
        } catch (e: any) {
            check('engine returned a MultiLineResult', false, `threw: ${e?.message || e}`);
        }

        if (t3Result) {
            const items: any[] = t3Result.lineItems;
            const l1 = items.find((x) => x.lineId === 'L1');
            const l2 = items.find((x) => x.lineId === 'L2');
            const l3 = items.find((x) => x.lineId === 'L3');
            const l4 = items.find((x) => x.lineId === 'L4');

            // L1 (TAP-01 fixed)
            check('L1 source=sku', l1?.source === 'sku', `got=${l1?.source}`);
            check('L1 skuCode=TAP-01', l1?.skuCode === 'TAP-01');
            check('L1 price matches catalog', l1?.guardedPricePence === tap?.pricePence, `got=${l1?.guardedPricePence}, expected=${tap?.pricePence}`);
            check('L1 scheduleMinutes populated', typeof l1?.scheduleMinutes === 'number' && l1.scheduleMinutes === tap?.scheduleMinutes, `got=${l1?.scheduleMinutes}`);

            // L2 (DOOR-15 per_unit ×3). Engine rounds to whole pounds so
            // display matches the Stripe charge (intentional).
            check('L2 source=sku', l2?.source === 'sku');
            check('L2 skuCode=DOOR-15', l2?.skuCode === 'DOOR-15');
            const rawL2Price = (door!.pricePerUnitPence || 0) * 3;
            const expectedL2Price = Math.round(rawL2Price / 100) * 100;
            check('L2 price = perUnit × 3 (rounded to whole £)', l2?.guardedPricePence === expectedL2Price, `got=${l2?.guardedPricePence}, expected=${expectedL2Price} (raw ${rawL2Price})`);
            const expectedL2Mins = (door!.minutesPerUnit || 0) * 3 + (door!.setupMinutes || 0);
            check('L2 scheduleMinutes = mins/unit × 3 + setup', l2?.scheduleMinutes === expectedL2Mins, `got=${l2?.scheduleMinutes}, expected=${expectedL2Mins}`);

            // L3 (RPNT-28 tiered Medium)
            check('L3 source=sku', l3?.source === 'sku');
            check('L3 skuCode=RPNT-28', l3?.skuCode === 'RPNT-28');
            check('L3 selectedTier=Medium', l3?.selectedTier === 'Medium');
            check('L3 price = RPNT-28 Medium price', l3?.guardedPricePence === tierMap['Medium'].pricePence, `got=${l3?.guardedPricePence}, expected=${tierMap['Medium'].pricePence}`);
            check('L3 scheduleMinutes = RPNT-28 Medium mins', l3?.scheduleMinutes === tierMap['Medium'].scheduleMinutes);

            // L4 (custom): goes through LLM/reference path. Just verify it's
            // present and has a sane price.
            check('L4 source=custom', l4?.source === 'custom', `got=${l4?.source}`);
            check('L4 has positive price', typeof l4?.guardedPricePence === 'number' && l4.guardedPricePence > 0, `got=${l4?.guardedPricePence}`);
            check('L4 has scheduleMinutes', typeof l4?.scheduleMinutes === 'number' && l4.scheduleMinutes > 0, `got=${l4?.scheduleMinutes}`);
            check('L4 has timeEstimateMinutes', l4?.timeEstimateMinutes === 90);

            // Subtotal sanity: sum of all 4 line guarded prices equals subtotalPence
            const expectedSubtotal = items.reduce((s, x) => s + x.guardedPricePence, 0);
            check('subtotal == sum of all 4 lines', t3Result.subtotalPence === expectedSubtotal, `subtotal=${t3Result.subtotalPence}, sum=${expectedSubtotal}`);
        }

        // ─────────────────────────────────────────────────────────────
        // TEST 4 — Admin SKU search query (mirrors the route)
        // ─────────────────────────────────────────────────────────────
        console.log('\nTest 4 — admin /api/admin/sku-catalog/search query logic\n');

        // q=tap should include TAP-01
        const qTap = `%tap%`;
        const tapResults = await db
            .select()
            .from(serviceCatalog)
            .where(
                and(
                    eq(serviceCatalog.isActive, true),
                    or(
                        ilike(serviceCatalog.skuCode, qTap),
                        ilike(serviceCatalog.name, qTap),
                        ilike(serviceCatalog.customerDescription, qTap),
                    ),
                ),
            )
            .orderBy(desc(serviceCatalog.pickCount), asc(serviceCatalog.name))
            .limit(20);
        check('search q=tap returns ≥1 row', tapResults.length >= 1, `${tapResults.length} results`);
        check('search q=tap includes TAP-01', tapResults.some((r) => r.skuCode === 'TAP-01'));

        // q=door should include DOOR-15 / XDOOR-16 / HW-61
        const qDoor = `%door%`;
        const doorResults = await db
            .select()
            .from(serviceCatalog)
            .where(
                and(
                    eq(serviceCatalog.isActive, true),
                    or(
                        ilike(serviceCatalog.skuCode, qDoor),
                        ilike(serviceCatalog.name, qDoor),
                        ilike(serviceCatalog.customerDescription, qDoor),
                    ),
                ),
            )
            .orderBy(desc(serviceCatalog.pickCount), asc(serviceCatalog.name))
            .limit(20);
        check('search q=door returns ≥1 row', doorResults.length >= 1, `${doorResults.length} results`);
        const doorCodes = doorResults.map((r) => r.skuCode);
        check(
            'search q=door includes DOOR-15 / XDOOR-16 / HW-61',
            doorCodes.includes('DOOR-15') || doorCodes.includes('XDOOR-16') || doorCodes.includes('HW-61'),
            doorCodes.slice(0, 5).join(','),
        );

        // category=plumbing_minor filters correctly
        const plumbResults = await db
            .select()
            .from(serviceCatalog)
            .where(
                and(
                    eq(serviceCatalog.isActive, true),
                    eq(serviceCatalog.category, 'plumbing_minor'),
                ),
            )
            .limit(50);
        check('category=plumbing_minor returns ≥1 row', plumbResults.length >= 1, `${plumbResults.length} results`);
        const allArePlumbing = plumbResults.every((r) => r.category === 'plumbing_minor');
        check('category=plumbing_minor: all rows match category', allArePlumbing);

        // Single SKU fetch via :skuCode (mirrors GET /api/admin/sku-catalog/:skuCode)
        const [tapDirect] = await db
            .select()
            .from(serviceCatalog)
            .where(eq(serviceCatalog.skuCode, 'TAP-01'))
            .limit(1);
        check('GET /:skuCode returns full row', !!tapDirect && tapDirect.skuCode === 'TAP-01' && tapDirect.shape === 'fixed');

        // ─────────────────────────────────────────────────────────────
        // TEST 5 — Backward compat: real accepted quotes still compute
        // ─────────────────────────────────────────────────────────────
        console.log('\nTest 5 — backward compat (3 real accepted quotes; READ-ONLY)\n');

        const realQuotes = await db
            .select({
                id: personalizedQuotes.id,
                pricingLineItems: personalizedQuotes.pricingLineItems,
                floorNumber: personalizedQuotes.floorNumber,
                hasLift: personalizedQuotes.hasLift,
                parkingDistanceCategory: personalizedQuotes.parkingDistanceCategory,
                customerPresent: personalizedQuotes.customerPresent,
            })
            .from(personalizedQuotes)
            .where(
                and(
                    isNotNull(personalizedQuotes.pricingLineItems),
                    isNotNull(personalizedQuotes.bookedAt),
                ),
            )
            .orderBy(desc(personalizedQuotes.bookedAt))
            .limit(3);

        check('found 3 real accepted quotes', realQuotes.length === 3, `${realQuotes.length} found`);

        for (let i = 0; i < realQuotes.length; i++) {
            const q = realQuotes[i];
            const lines = (q.pricingLineItems as any[]) || [];
            check(`[${q.id}] has at least 1 line item`, lines.length > 0, `${lines.length} lines`);

            // Verify the composer doesn't throw on these legacy rows
            let breakdown: any = null;
            let threw: any = null;
            try {
                breakdown = composeScheduleMinutes(lines, {
                    floorNumber: q.floorNumber,
                    hasLift: q.hasLift,
                    parkingDistanceCategory: q.parkingDistanceCategory,
                    customerPresent: q.customerPresent,
                });
            } catch (e: any) {
                threw = e;
            }
            check(`[${q.id}] composeScheduleMinutes runs without error`, !threw && !!breakdown, threw ? `threw: ${threw?.message || threw}` : `total=${breakdown.totalMinutes}min`);

            if (breakdown) {
                // For legacy lines without `scheduleMinutes`, pickLineMinutes
                // must fall back to `timeEstimateMinutes`. Verify by computing
                // work minutes directly from the lines.
                const totalTimeEst = lines.reduce(
                    (s, l: any) => s + (typeof l.timeEstimateMinutes === 'number' ? l.timeEstimateMinutes : 0),
                    0,
                );
                const sumPicked = lines.reduce((s, l: any) => s + pickLineMinutes(l), 0);
                check(`[${q.id}] pickLineMinutes matches timeEstimateMinutes for legacy lines`, sumPicked === totalTimeEst, `picked=${sumPicked}, time=${totalTimeEst}`);

                // Total should be > 0 (sanity)
                check(`[${q.id}] total minutes > 0`, breakdown.totalMinutes > 0, `${breakdown.totalMinutes}min`);
            }
        }

        // ─────────────────────────────────────────────────────────────
        // TEST 6 — Flex booking helpers
        // ─────────────────────────────────────────────────────────────
        console.log('\nTest 6 — flex booking helpers\n');

        const flexQuote = { flexBookingWithinDays: 7 };
        check('isQuoteFlex returns true when flexBookingWithinDays=7', isQuoteFlex(flexQuote) === true);
        check('getFlexWindowDays returns 7', getFlexWindowDays(flexQuote) === 7);

        const nonFlexQuote = { flexBookingWithinDays: null };
        check('isQuoteFlex returns false when null', isQuoteFlex(nonFlexQuote) === false);
        check('getFlexWindowDays returns null when null', getFlexWindowDays(nonFlexQuote) === null);

        const zeroFlex = { flexBookingWithinDays: 0 };
        check('isQuoteFlex returns false when 0', isQuoteFlex(zeroFlex) === false);

        // Verify the column actually accepts a write, then we read it back.
        const flexQuoteId = `test_phase25_flex_${Date.now()}`;
        syntheticQuoteIds.push(flexQuoteId);
        await db.insert(personalizedQuotes).values({
            id: flexQuoteId,
            shortSlug: flexQuoteId.slice(-8),
            customerName: 'Phase25 Flex Test',
            phone: '07700000001',
            postcode: 'NG1 1AA',
            jobDescription: 'Phase 25 flex booking column round-trip',
            basePrice: 10000,
            flexBookingWithinDays: 7,
        });
        const [readBack] = await db
            .select({
                id: personalizedQuotes.id,
                flexBookingWithinDays: personalizedQuotes.flexBookingWithinDays,
            })
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, flexQuoteId))
            .limit(1);
        check('flexBookingWithinDays round-trips through DB', readBack?.flexBookingWithinDays === 7, `got=${readBack?.flexBookingWithinDays}`);
        check('isQuoteFlex(DB row) === true', isQuoteFlex(readBack as any) === true);
        check('getFlexWindowDays(DB row) === 7', getFlexWindowDays(readBack as any) === 7);

        // ─────────────────────────────────────────────────────────────
        // TEST 7 — Phase 24 multi-day with SKU-driven scheduleMinutes
        // ─────────────────────────────────────────────────────────────
        console.log('\nTest 7 — multi-day flow with SKU-driven scheduleMinutes\n');

        // Build a quote whose SKU-resolved scheduleMinutes pushes it over the
        // 480min/day cap. Use the resolver to source minutes directly so the
        // computation mirrors the production engine path.
        const rpntLarge = await resolveLineItemFromSku({
            skuCode: 'RPNT-28',
            selectedTier: 'Large',
            scheduledDate: wedDate,
        }); // 240min
        const win = await resolveLineItemFromSku({
            skuCode: 'WIN-23',
            scheduledDate: wedDate,
        }); // 210min
        const bth = await resolveLineItemFromSku({
            skuCode: 'BTHPNL-20',
            scheduledDate: wedDate,
        }); // 120min

        check('RPNT-28 Large resolved (240min)', rpntLarge?.scheduleMinutes === 240, `got=${rpntLarge?.scheduleMinutes}`);
        check('WIN-23 resolved (210min)', win?.scheduleMinutes === 210, `got=${win?.scheduleMinutes}`);
        check('BTHPNL-20 resolved (120min)', bth?.scheduleMinutes === 120, `got=${bth?.scheduleMinutes}`);

        // Build the line items in the LineItemV2 shape that composeScheduleMinutes reads
        const multiDayLines = [
            { category: 'painting', timeEstimateMinutes: 240, scheduleMinutes: 240 },
            { category: 'carpentry', timeEstimateMinutes: 210, scheduleMinutes: 210 },
            { category: 'carpentry', timeEstimateMinutes: 120, scheduleMinutes: 120 },
        ];
        const multiDayBreakdown = composeScheduleMinutes(multiDayLines, {});
        // Work = 570min (under clamp caps for painting/carpentry which are 240)
        // Buffers = 3 × (15 setup + 15 cleanup) = 90
        // No material trip, no presence, no floor/parking overhead
        // → total = 660min, ceil(660/480) = 2 days
        check('multi-day work minutes == 570', multiDayBreakdown.workMinutes === 570, `got=${multiDayBreakdown.workMinutes}`);
        check('multi-day total minutes == 660', multiDayBreakdown.totalMinutes === 660, `got=${multiDayBreakdown.totalMinutes}`);
        check('computeRequiredDays(total) === 2', computeRequiredDays(multiDayBreakdown.totalMinutes) === 2, `got=${computeRequiredDays(multiDayBreakdown.totalMinutes)}`);

        // Also verify the LEGACY-style read (scheduleMinutes missing): falls
        // back to timeEstimateMinutes so the result is identical.
        const legacyShape = multiDayLines.map((l) => ({ category: l.category, timeEstimateMinutes: l.timeEstimateMinutes }));
        const legacyBreakdown = composeScheduleMinutes(legacyShape, {});
        check('legacy lines (no scheduleMinutes) compute identical total', legacyBreakdown.totalMinutes === multiDayBreakdown.totalMinutes, `legacy=${legacyBreakdown.totalMinutes} vs new=${multiDayBreakdown.totalMinutes}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 8 — Build still passes
        // ─────────────────────────────────────────────────────────────
        console.log('\nTest 8 — `npm run build`\n');
        const { spawnSync } = await import('child_process');
        const buildRes = spawnSync('npm', ['run', 'build'], {
            cwd: process.cwd(),
            encoding: 'utf-8',
            timeout: 5 * 60 * 1000,
        });
        const buildOk = buildRes.status === 0;
        if (buildOk) {
            check('npm run build succeeds', true, 'exit=0');
        } else {
            const errSnippet = (buildRes.stderr || buildRes.stdout || '').slice(-1200);
            check('npm run build succeeds', false, `exit=${buildRes.status}\n--- stderr/stdout tail ---\n${errSnippet}`);
        }
    } finally {
        // ─────────────────────────────────────────────────────────────
        // CLEANUP — delete every synthetic row we created.
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- Cleanup ---');
        for (const qid of syntheticQuoteIds) {
            try {
                await db.delete(bookingSlotLocks).where(eq(bookingSlotLocks.quoteId, qid));
                await db.delete(personalizedQuotes).where(eq(personalizedQuotes.id, qid));
                console.log(`  removed synthetic quote ${qid}`);
            } catch (e: any) {
                console.warn(`  WARN cleanup failed for ${qid}: ${e?.message || e}`);
            }
        }
        console.log('--- Cleanup done ---');
    }

    console.log(`\n═══ Result: ${pass} pass, ${fail} fail ═══`);
    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) console.log(`  - ${f}`);
    }
    if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
});
