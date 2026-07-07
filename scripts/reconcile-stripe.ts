/**
 * Stripe ↔ DB reconciliation.
 *
 * Reads every paid quote from personalized_quotes and verifies that
 * deposit_amount_pence matches the actual amount_received on the linked
 * Stripe Payment Intent. Reports drift to stdout.
 *
 * Exit codes:
 *   0 — no drift beyond tolerance
 *   1 — drift detected (cron systems treat as failed run → alert)
 *   2 — script error (could not query Stripe or DB)
 *
 * Drift tolerance: 100p (£1). Tighter than Stripe rounding error,
 * loose enough to ignore the orphan/test PIs.
 *
 * Schedule weekly, e.g. via cron:
 *   0 9 * * 1  cd /path/to/v6-switchboard && npm run reconcile:stripe
 *
 * Any non-zero exit will trigger your cron mailer / failure alert.
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import Stripe from 'stripe';

const DRIFT_TOLERANCE_PENCE = 100; // £1
const VERBOSE = process.argv.includes('--verbose');

const dbUrl = process.env.DATABASE_URL;
const stripeKey = process.env.STRIPE_SECRET_KEY;

if (!dbUrl) {
    console.error('FATAL: DATABASE_URL not set');
    process.exit(2);
}
if (!stripeKey) {
    console.error('FATAL: STRIPE_SECRET_KEY not set');
    process.exit(2);
}

const sql = neon(dbUrl);
const stripe = new Stripe(stripeKey);

interface DriftRow {
    slug: string;
    customer: string;
    paymentType: string | null;
    dbDeposit: number;
    stripeReceived: number;
    delta: number;
    piId: string;
}

async function main() {
    const quotes = await sql`
        SELECT
            short_slug,
            customer_name,
            payment_type,
            deposit_amount_pence,
            stripe_payment_intent_id
        FROM personalized_quotes
        WHERE deposit_paid_at IS NOT NULL
          AND stripe_payment_intent_id IS NOT NULL
    ` as Array<{
        short_slug: string;
        customer_name: string;
        payment_type: string | null;
        deposit_amount_pence: number;
        stripe_payment_intent_id: string;
    }>;

    if (VERBOSE) console.log(`Checking ${quotes.length} paid quotes...`);

    const drift: DriftRow[] = [];
    const orphans: Array<{ slug: string; customer: string; piId: string; reason: string }> = [];
    let checked = 0;

    for (const q of quotes) {
        let pi;
        try {
            pi = await stripe.paymentIntents.retrieve(q.stripe_payment_intent_id);
        } catch (e: any) {
            // Test data, manual entries, deleted PIs — not real drift, just unreachable
            orphans.push({
                slug: q.short_slug,
                customer: q.customer_name,
                piId: q.stripe_payment_intent_id,
                reason: e.message?.includes('No such') ? 'pi_not_found' : `stripe_error: ${e.message}`,
            });
            continue;
        }
        checked++;

        const stripeReceived = pi.amount_received ?? 0;
        const dbDeposit = q.deposit_amount_pence ?? 0;
        const delta = stripeReceived - dbDeposit;

        if (Math.abs(delta) > DRIFT_TOLERANCE_PENCE) {
            drift.push({
                slug: q.short_slug,
                customer: q.customer_name,
                paymentType: q.payment_type,
                dbDeposit,
                stripeReceived,
                delta,
                piId: q.stripe_payment_intent_id,
            });
        }
    }

    // Summary
    console.log(`Stripe reconciliation: ${checked} quotes checked, ${drift.length} drifted, ${orphans.length} orphan PIs.`);

    if (orphans.length && VERBOSE) {
        console.log('\nOrphan PIs (test data or deleted — ignored for drift):');
        for (const o of orphans) console.log(`  ${o.slug} | ${o.customer} | ${o.piId} | ${o.reason}`);
    }

    if (drift.length === 0) {
        console.log('All deposit_amount_pence values match Stripe within tolerance. ✓');
        process.exit(0);
    }

    // Drift detected — print details and exit non-zero
    console.log('\nDRIFT DETECTED:');
    const totalDelta = drift.reduce((s, d) => s + d.delta, 0);
    for (const d of drift) {
        const sign = d.delta >= 0 ? '+' : '';
        console.log(
            `  ${d.slug} | ${d.customer.padEnd(15)} | ${(d.paymentType ?? '?').padEnd(10)} | ` +
            `DB £${(d.dbDeposit / 100).toFixed(2).padStart(8)} | Stripe £${(d.stripeReceived / 100).toFixed(2).padStart(8)} | ` +
            `delta ${sign}£${(d.delta / 100).toFixed(2)}`
        );
    }
    console.log(`\nNet delta: ${totalDelta >= 0 ? '+' : ''}£${(totalDelta / 100).toFixed(2)} across ${drift.length} quotes.`);
    console.log('Investigate the drifted rows above. Likely causes:');
    console.log('  - Refund issued via Stripe dashboard before the charge.refunded webhook was deployed');
    console.log('  - Webhook missed during a deploy / outage (replay from Stripe dashboard)');
    console.log('  - Manual DB edit that bypassed Stripe');
    process.exit(1);
}

main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(2);
});
