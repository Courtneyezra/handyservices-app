/**
 * Seed DUMMY flexible-job test data into `personalized_quotes` so the
 * dispatcher / pool UI can be exercised WITHOUT touching the ~77 real
 * customer jobs in the flex pool.
 *
 * EVERY dummy quote id starts with the frozen prefix `test_q_flex_`.
 * That prefix is THE isolation predicate — a parallel agent's isolation
 * filter keys on it, and `cleanup-dummy-flex-jobs.ts` deletes exactly the
 * rows matching `test_q_flex_%` and nothing else.
 *
 * Usage:
 *   npx tsx scripts/seed-dummy-flex-jobs.ts            # 12 dummies
 *   npx tsx scripts/seed-dummy-flex-jobs.ts --count=20 # N dummies
 *
 * To remove them again:
 *   npx tsx scripts/cleanup-dummy-flex-jobs.ts
 */

import { db } from '../server/db';
import { sql } from 'drizzle-orm';

// ── Frozen test signature ─────────────────────────────────────────────
// DO NOT CHANGE. The cleanup script and the parallel isolation filter
// both depend on this exact prefix.
const ID_PREFIX = 'test_q_flex_';

// ── Assignable categories ─────────────────────────────────────────────
// Drawn from the real contractor skill set so dummies actually match a
// contractor. general_fixing / painting / flat_pack are held by the most
// contractors → "easily assignable"; the rest are narrower.
const EASY_CATS = ['general_fixing', 'painting', 'flat_pack'] as const;
const WIDE_CATS = ['garden_maintenance', 'pressure_washing', 'carpentry'] as const;
const NARROW_CATS = ['tv_mounting', 'shelving'] as const;

// Plausible single-line descriptions per category.
const DESCRIPTIONS: Record<string, string[]> = {
    general_fixing: ['Fix sticking internal door + re-hang', 'Re-seal kitchen worktop + adjust cupboard', 'Patch + fill cracked hallway wall'],
    painting: ['Repaint bedroom walls + skirting', 'Touch-up paint throughout flat between tenants', 'Paint hallway + ceiling (one coat)'],
    flat_pack: ['Assemble IKEA PAX wardrobe', 'Build flat-pack chest of drawers x2', 'Assemble office desk + shelving unit'],
    garden_maintenance: ['Tidy overgrown rear garden + hedge trim', 'Clear borders + mow front and back', 'Cut back ivy + general garden clear'],
    pressure_washing: ['Jet wash patio + side path', 'Pressure-wash driveway (~30m2)', 'Clean decking + rear paving'],
    carpentry: ['Fit new skirting board run in lounge', 'Repair + re-hang garden gate', 'Build fitted alcove shelving'],
    tv_mounting: ['Mount 55-inch TV above fireplace', 'Wall-mount 50-inch TV + conceal cables', 'Mount bedroom TV on bracket'],
    shelving: ['Hang 4 floating shelves in alcove', 'Fit 3 shelves in home office', 'Install bracket shelving in garage'],
};

const FIRST_NAMES = [
    'Ava', 'Ben', 'Cara', 'Dan', 'Ella', 'Finn', 'Gina', 'Hugo',
    'Isla', 'Jake', 'Kira', 'Liam', 'Mia', 'Noah', 'Orla', 'Paul',
    'Quinn', 'Ruby', 'Sam', 'Tara', 'Umar', 'Vera', 'Will', 'Xena',
];

// ── Location pools ────────────────────────────────────────────────────
// "near" cluster = within ~3mi of Nottingham centre (~52.95,-1.15) with
// ±0.03 jitter → these form dispatcher POOLS. "far" = 8-15mi out for
// solo / radius variety.
const NOTT_CENTRE = { lat: 52.95, lng: -1.15 };
const FAR_POINTS = [
    { lat: 52.99, lng: -1.30, postcodes: ['NG16 2AA', 'DE7 4BB', 'NG10 3GS'] }, // NW (Long Eaton / Ilkeston way)
    { lat: 52.86, lng: -1.05, postcodes: ['NG11 6AA', 'LE12 5BB', 'NG12 5DA'] }, // S (toward Loughborough)
];
const NEAR_POSTCODES = ['NG7 2BY', 'NG5 3FN', 'NG3 5QF', 'NG2 6EN', 'NG1 6DH', 'NG8 2NF', 'NG6 9DD', 'NG4 3DR', 'NG9 2JP'];

// flex window variety: a couple urgent (2), several 7/14, a few 21.
const FLEX_DAYS_CYCLE = [2, 7, 14, 21, 7, 14, 2, 21, 7, 14, 21, 7];

function rid(len = 8): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
}

function pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** Round to 5 decimal places (keeps coords tidy without losing precision). */
function round5(n: number): number {
    return Math.round(n * 1e5) / 1e5;
}

function jitter(base: number, amp: number): number {
    return round5(base + (Math.random() * 2 - 1) * amp);
}

/** Build one pricing line item mirroring the real engine shape. */
function makeLineItem(category: string) {
    const minutes = pick([90, 120, 180, 240, 300]);
    // ~£35/45 per hour-ish, rounded; keep guarded ≈ llmSuggested, ref a touch lower.
    const guarded = Math.round((minutes / 60) * pick([3500, 4000, 4500]) / 100) * 100;
    const reference = Math.max(5000, guarded - pick([1000, 2000, 3000]));
    return {
        lineId: rid(8),
        source: 'custom',
        category,
        description: pick(DESCRIPTIONS[category] ?? ['General handyman work']),
        scheduleMinutes: minutes,
        guardedPricePence: guarded,
        referencePricePence: reference,
        timeEstimateMinutes: minutes,
        llmSuggestedPricePence: guarded,
        materialsCostPence: pick([0, 0, 0, 1500, 3000]),
    };
}

type Dummy = {
    id: string;
    customerName: string;
    phone: string;
    email: string;
    shortSlug: string;
    jobDescription: string;
    segment: string;
    postcode: string;
    coordinates: { lat: number; lng: number };
    flexBookingWithinDays: number;
    basePrice: number;
    lineItems: ReturnType<typeof makeLineItem>[];
    categories: string[];
    placement: 'near' | 'far';
};

function buildDummy(i: number, isMulti: boolean, placement: 'near' | 'far'): Dummy {
    const nn = String(i + 1).padStart(2, '0');
    const name = FIRST_NAMES[i % FIRST_NAMES.length];

    // Category selection — bias toward easily-assignable cats.
    const pool = [...EASY_CATS, ...EASY_CATS, ...WIDE_CATS, ...NARROW_CATS];
    const cat1 = pick(pool);
    const lineItems = [makeLineItem(cat1)];
    if (isMulti) {
        // second, distinct category to exercise the covers-all rule.
        let cat2 = pick(pool);
        let guard = 0;
        while (cat2 === cat1 && guard++ < 10) cat2 = pick(pool);
        lineItems.push(makeLineItem(cat2));
    }
    const categories = Array.from(new Set(lineItems.map((l) => l.category)));

    // base_price ≈ sum of line item prices, clamped to the 8000–50000 band.
    const sum = lineItems.reduce((acc, l) => acc + l.guardedPricePence, 0);
    const basePrice = Math.min(50000, Math.max(8000, sum));

    let coordinates: { lat: number; lng: number };
    let postcode: string;
    if (placement === 'near') {
        coordinates = { lat: jitter(NOTT_CENTRE.lat, 0.03), lng: jitter(NOTT_CENTRE.lng, 0.03) };
        postcode = NEAR_POSTCODES[i % NEAR_POSTCODES.length];
    } else {
        const fp = FAR_POINTS[i % FAR_POINTS.length];
        coordinates = { lat: jitter(fp.lat, 0.02), lng: jitter(fp.lng, 0.02) };
        postcode = fp.postcodes[i % fp.postcodes.length];
    }

    return {
        id: `${ID_PREFIX}${rid(10)}`,
        customerName: `TEST ${name}`,
        phone: `0770090000${nn.slice(-2)}`,
        email: `testflex${nn}@example.com`,
        // short_slug is varchar(8) UNIQUE NOT NULL → must stay <= 8 chars.
        // "tf" + 6 random chars keeps it test-tagged, unique, and in-bounds.
        shortSlug: `tf${rid(6)}`,
        jobDescription: lineItems.map((l) => l.description).join('; '),
        segment: 'CONTEXTUAL',
        postcode,
        coordinates,
        flexBookingWithinDays: FLEX_DAYS_CYCLE[i % FLEX_DAYS_CYCLE.length],
        basePrice,
        lineItems,
        categories,
        placement,
    };
}

async function main() {
    const countArg = process.argv.find((a) => a.startsWith('--count='));
    const count = countArg ? Math.max(1, parseInt(countArg.split('=')[1], 10) || 12) : 12;

    // Decide placement: ~6-7 near (pools), the rest far (solo/radius).
    const nearTarget = Math.min(count, Math.max(6, Math.round(count * 0.55)));
    // Make 2-3 dummies multi-category.
    const multiTarget = Math.min(count, count >= 12 ? 3 : 2);

    const dummies: Dummy[] = [];
    for (let i = 0; i < count; i++) {
        const placement: 'near' | 'far' = i < nearTarget ? 'near' : 'far';
        const isMulti = i < multiTarget;
        dummies.push(buildDummy(i, isMulti, placement));
    }

    console.log(`\nSeeding ${count} DUMMY flex jobs (id prefix "${ID_PREFIX}")...\n`);

    let inserted = 0;
    try {
        for (const d of dummies) {
            // Each insert wrapped so one bad row logs clearly without
            // aborting the whole run with a cryptic message.
            try {
                await db.execute(sql`
                    INSERT INTO personalized_quotes (
                        id, short_slug, customer_name, phone, email,
                        job_description, segment, postcode, coordinates,
                        flex_booking_within_days, base_price, pricing_line_items,
                        deposit_paid_at, created_at
                    ) VALUES (
                        ${d.id}, ${d.shortSlug}, ${d.customerName}, ${d.phone}, ${d.email},
                        ${d.jobDescription}, ${d.segment}, ${d.postcode}, ${JSON.stringify(d.coordinates)}::jsonb,
                        ${d.flexBookingWithinDays}, ${d.basePrice}, ${JSON.stringify(d.lineItems)}::jsonb,
                        NOW(), NOW()
                    )
                `);
                inserted++;
            } catch (rowErr: any) {
                console.error(`  ✗ FAILED to insert ${d.id} (${d.customerName}): ${rowErr.message}`);
                throw rowErr; // re-throw so the outer catch reports overall failure
            }
        }
    } catch (err: any) {
        console.error(`\n✗ Seeding aborted after ${inserted}/${count} inserts: ${err.message}`);
        console.error(`  Run "npx tsx scripts/cleanup-dummy-flex-jobs.ts" to remove any partial dummies.`);
        process.exit(1);
    }

    // ── Summary table ─────────────────────────────────────────────────
    console.log('  id                          name        categories                          flex  coords (lat,lng)        loc');
    console.log('  ' + '─'.repeat(116));
    for (const d of dummies) {
        const id = d.id.padEnd(26);
        const name = d.customerName.padEnd(11);
        const cats = d.categories.join('+').padEnd(34);
        const flex = `${d.flexBookingWithinDays}d`.padStart(4);
        const coords = `${d.coordinates.lat.toFixed(4)},${d.coordinates.lng.toFixed(4)}`.padEnd(22);
        console.log(`  ${id}  ${name} ${cats} ${flex}  ${coords}  ${d.placement}`);
    }

    const nearCount = dummies.filter((d) => d.placement === 'near').length;
    const farCount = dummies.filter((d) => d.placement === 'far').length;
    const multiCount = dummies.filter((d) => d.categories.length > 1).length;
    const flexHist = dummies.reduce<Record<number, number>>((acc, d) => {
        acc[d.flexBookingWithinDays] = (acc[d.flexBookingWithinDays] ?? 0) + 1;
        return acc;
    }, {});

    console.log('\n  ' + '─'.repeat(116));
    console.log(`  Inserted: ${inserted}/${count}  |  near-pool: ${nearCount}  far/solo: ${farCount}  |  multi-category: ${multiCount}`);
    console.log(`  flex-day mix: ${Object.entries(flexHist).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}d×${v}`).join('  ')}`);
    console.log(`\n✓ Done. Remove with: npx tsx scripts/cleanup-dummy-flex-jobs.ts\n`);

    process.exit(0);
}

main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
});
