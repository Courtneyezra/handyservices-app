/**
 * End-to-end test of the bond payment flow.
 * 1. Find the latest pending dispatch_bond + the per-contractor token
 * 2. Confirm its PaymentIntent via Stripe test API with pm_card_visa
 * 3. Hit /api/contractor-job/:token/bond/confirm to flip bond → held + lock dispatch
 * 4. Verify the dispatch row is locked
 */
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const testKey = env.match(/^STRIPE_TEST_SECRET_KEY=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const APP_BASE = 'http://localhost:5001';

// 1. Find the latest pending bond + the contractor token
const rows = await sql`
  SELECT b.id AS bond_id, b.dispatch_id, b.stripe_payment_intent_id, b.status,
         l.token AS contractor_token, hp.business_name
  FROM dispatch_bonds b
  JOIN contractor_job_links l
    ON l.dispatch_id = b.dispatch_id AND l.contractor_id = b.contractor_id
  JOIN handyman_profiles hp ON hp.id = b.contractor_id
  WHERE b.status = 'pending'
  ORDER BY b.created_at DESC LIMIT 1
`;
if (!rows.length) { console.log('No pending bonds. Click a contractor first.'); process.exit(0); }
const { bond_id, dispatch_id, stripe_payment_intent_id, contractor_token, business_name } = rows[0];
console.log(`Found pending bond ${bond_id} for ${business_name} → token ${contractor_token}`);
console.log(`PaymentIntent: ${stripe_payment_intent_id}`);

// 2. Confirm the PaymentIntent on the test account with pm_card_visa
console.log('\nStep A — confirm PaymentIntent via Stripe test API with pm_card_visa');
const confirmRes = await fetch(
  `https://api.stripe.com/v1/payment_intents/${stripe_payment_intent_id}/confirm`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${testKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ payment_method: 'pm_card_visa', return_url: 'http://localhost:5001/' }),
  },
);
const confirmBody = await confirmRes.json();
console.log(`  Stripe says: status=${confirmBody.status} latest_charge=${confirmBody.latest_charge}`);

// 3. Tell our server to flip the bond → held + lock the dispatch
console.log('\nStep B — POST /api/contractor-job/:token/bond/confirm');
const r = await fetch(`${APP_BASE}/api/contractor-job/${contractor_token}/bond/confirm`, { method: 'POST' });
const body = await r.json();
console.log(`  ${r.status} ${JSON.stringify(body)}`);

// 4. Verify the dispatch row + bond row
console.log('\nStep C — verify state in DB');
const finalDispatch = await sql`SELECT id, status, locked_to_contractor_id FROM job_dispatches WHERE id = ${dispatch_id}`;
const finalBond = await sql`SELECT status, paid_at FROM dispatch_bonds WHERE id = ${bond_id}`;
console.log('  dispatch:', finalDispatch[0]);
console.log('  bond    :', finalBond[0]);

// 5. Test that another contractor trying to claim gets the locked-out splash
console.log('\nStep D — try to GET /api/dispatch-link/:public_token after lock');
const dispatch = (await sql`SELECT public_token FROM job_dispatches WHERE id = ${dispatch_id}`)[0];
const lockCheck = await fetch(`${APP_BASE}/api/dispatch-link/${dispatch.public_token}`);
const lockBody = await lockCheck.json();
console.log(`  isLocked: ${lockBody.isLocked} lockedTo: ${lockBody.lockedToContractorName}`);
