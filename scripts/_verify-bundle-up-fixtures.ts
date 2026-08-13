import 'dotenv/config';

/**
 * _verify-bundle-up-fixtures.ts
 *
 * Proves the offer router (server/offer-router.ts) serves `bundle_up` where it
 * should, and does NOT serve it where it shouldn't, against a live dev server.
 *
 *   npx tsx scripts/_verify-bundle-up-fixtures.ts
 *
 * Fixtures created (test-data conventions: 07700900xxx phones + "Test" names,
 * so analytics scrubbing ignores them):
 *   1. Sub-£200 first-timer  → R10 (100_200 band) → servedPlay 'bundle_up'
 *   2. Big first-timer job   → R9  (200_1000 band) → servedPlay 'welcome_gift'
 *      (control: proves the router isn't just serving bundle_up to everyone)
 *
 * Each fixture is asserted twice: on the create response's offerDecision AND
 * on the public payload's offerServedPlay (GET /api/personalized-quotes/:slug),
 * so the whole pipe — decision → persistence → public serve — is covered.
 *
 * R1 (repeat customer → bundle_up) is deliberately NOT fixtured here.
 * R1 fires when the phone/email matches a prior quote with deposit_paid_at
 * set. Test scripts must NOT fake deposit_paid_at — synthetic paid quotes are
 * a known analytics hazard in this repo (conversion = deposit_paid_at; see
 * memory/project-quote-test-data.md). To exercise R1 manually: take a REAL
 * customer phone that already has a deposit-paid quote in the DB (query:
 * SELECT phone FROM personalized_quotes WHERE deposit_paid_at IS NOT NULL
 * LIMIT 5), create a new quote for that phone via the admin builder, and
 * check the offerDecision card shows ruleFired R1 / servedPlay bundle_up.
 * Delete the throwaway quote afterwards.
 */

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:53100';

interface OfferDecision {
    decisionId: string;
    ruleFired: string;
    goal: string;
    targetPlay: string;
    servedPlay: string;
    rationale: string;
    unmetIntent: boolean;
    stakes: string;
    priceBand: string;
    firstTime: boolean;
}

interface CreateResponse {
    success: boolean;
    quoteId: string;
    shortSlug: string;
    offerDecision: OfferDecision | null;
    pricing: { totalPence: number; totalFormatted: string };
}

interface Line {
    id: string;
    description: string;
    category: string;
    estimatedMinutes: number;
}

async function createQuote(
    customerName: string, phone: string, vaContext: string, lines: Line[],
): Promise<CreateResponse> {
    const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            customerName,
            phone,
            customerType: 'homeowner',
            vaContext,
            postcode: 'NG1 5FS',
            lines,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`create-contextual-quote ${res.status}: ${body.slice(0, 500)}`);
    }
    return res.json() as Promise<CreateResponse>;
}

async function fetchPublicPayload(slug: string): Promise<{ offerServedPlay: string | null }> {
    const res = await fetch(`${BASE}/api/personalized-quotes/${slug}`);
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GET /api/personalized-quotes/${slug} ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
}

const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown) {
    if (actual !== expected) {
        failures.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        return false;
    }
    return true;
}

function summaryLine(label: string, r: CreateResponse) {
    const d = r.offerDecision;
    console.log(
        `${label}: ${r.shortSlug} | ${d?.ruleFired ?? 'no-decision'} | ${d?.servedPlay ?? '—'} | ${r.pricing.totalFormatted} (band ${d?.priceBand ?? '—'})`,
    );
}

async function main() {
    console.log(`Verifying offer router against ${BASE}\n`);

    // ---- Fixture 1: sub-£200 first-timer → R10 → bundle_up -----------------
    // Pricing is engine-driven, so minutes→price isn't exact; retry with
    // adjusted minutes until we land in the 100_200 band (up to 3 attempts).
    let minutes = 90;
    let bundleQuote: CreateResponse | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const r = await createQuote(
            'Test BundleUp Fixture',
            '07700900131',
            'Customer wants two mirrors and a floating shelf put up in the hallway.',
            [{
                id: 'line1',
                description: 'Hang two mirrors and a shelf',
                category: 'general_fixing',
                estimatedMinutes: minutes,
            }],
        );
        const band = r.offerDecision?.priceBand;
        console.log(`  [attempt ${attempt}] minutes=${minutes} → ${r.pricing.totalFormatted}, band=${band}, served=${r.offerDecision?.servedPlay}`);
        bundleQuote = r; // keep last for assertion/diagnostics
        // We specifically want the R10 path (100_200 band), not R2 (under_100
        // also serves bundle_up) — keep steering until we land in-band.
        if (band === '100_200' && r.offerDecision?.servedPlay === 'bundle_up') break;
        if (band === '100_200') break; // right band but wrong play — retrying won't change the rule
        // Steer proportionally toward a mid-band £150 total. The engine's LLM
        // layer anchors on the description, so small minute nudges don't move
        // the price — scale minutes by target/actual instead.
        const TARGET_PENCE = 15000;
        minutes = Math.max(30, Math.round(minutes * (TARGET_PENCE / r.pricing.totalPence) / 15) * 15);
    }

    if (!bundleQuote) throw new Error('No quote created for bundle_up fixture');
    console.log('');
    summaryLine('BUNDLE-UP ', bundleQuote);
    const d1 = bundleQuote.offerDecision;
    check('bundle_up offerDecision present', d1 !== null, true);
    if (d1) {
        const okBand = check('bundle_up priceBand (R10 path)', d1.priceBand, '100_200');
        const okPlay = check('bundle_up servedPlay', d1.servedPlay, 'bundle_up');
        if (!okBand || !okPlay) {
            console.log(`  actual decision: ${JSON.stringify(d1, null, 2)}`);
        }
        const pub1 = await fetchPublicPayload(bundleQuote.shortSlug);
        check('bundle_up public offerServedPlay', pub1.offerServedPlay, 'bundle_up');
    }

    // ---- Fixture 2 (control): big first-timer job → R9 → welcome_gift ------
    const controlQuote = await createQuote(
        'Test WelcomeGift Control',
        '07700900132',
        'Full redecoration of hallway, stairs and landing — walls and all woodwork.',
        [{
            id: 'line1',
            description: 'Paint the hallway, stairs and landing walls and woodwork',
            category: 'painting',
            estimatedMinutes: 660,
        }],
    );
    summaryLine('CONTROL   ', controlQuote);
    const d2 = controlQuote.offerDecision;
    check('control offerDecision present', d2 !== null, true);
    if (d2) {
        if (!check('control servedPlay', d2.servedPlay, 'welcome_gift')) {
            console.log(`  actual decision: ${JSON.stringify(d2, null, 2)}`);
        }
        const pub2 = await fetchPublicPayload(controlQuote.shortSlug);
        check('control public offerServedPlay', pub2.offerServedPlay, 'welcome_gift');
    }

    // ---- Verdict -----------------------------------------------------------
    console.log('');
    if (failures.length === 0) {
        console.log('ALL PASS — offer router serves bundle_up in-band and welcome_gift out-of-band.');
        process.exit(0);
    } else {
        for (const f of failures) console.log(f);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('FAIL (script error):', err.message ?? err);
    process.exit(1);
});
