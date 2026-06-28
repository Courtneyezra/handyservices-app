/**
 * LIVE END-TO-END SPINE PROOF — the never-fired back half.
 *
 * Proves the full pipeline fires and stays linked, exercising REAL production
 * code (no re-implementation), against fenced test data (test_q_spine_ /
 * test_lead_spine_). It deliberately stops BEFORE the real Stripe disbursement
 * (link 6 = processPayouts → Stripe Transfer) — it asserts the payout *record*
 * is created correctly, which is the part our code owns. No real money moves.
 *
 * Chain proven:
 *   lead + paid quote  →  assignFromPool        (link 2: deposit → CBR + jobSheet)
 *                      →  lifecycle transitions (link 3: scheduled → in_progress)
 *                      →  finalizeJobCompletion (link 3 complete + 4 invoice + 5 payout + Gap-A rollup)
 *
 *   npx tsx scripts/_e2e-spine-proof.ts
 *   npx tsx scripts/_e2e-spine-proof.ts --clean   (remove test rows and exit)
 */
import { db } from '../server/db';
import { sql, eq } from 'drizzle-orm';
import { contractorBookingRequests } from '../shared/schema';
import { assignFromPool } from '../server/booking-engine';
import { finalizeJobCompletion } from '../server/job-lifecycle';

const QP = 'test_q_spine_';
const LP = 'test_lead_spine_';
const rid = (n = 10) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
const rows = (r: any) => r.rows ?? r;
const J = (x: any) => JSON.stringify(x);

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function cleanTest() {
  // FK-safe order: CBR.invoice_id references invoices, so CBR must go before
  // invoices. payouts/jobSheets reference the CBR by job_id → clear those first.
  await db.execute(sql`DELETE FROM contractor_payouts WHERE quote_id LIKE ${QP + '%'}`);
  await db.execute(sql`DELETE FROM job_sheets WHERE quote_id LIKE ${QP + '%'}`);
  await db.execute(sql`DELETE FROM contractor_booking_requests WHERE quote_id LIKE ${QP + '%'}`);
  await db.execute(sql`DELETE FROM invoices WHERE quote_id LIKE ${QP + '%'}`);
  await db.execute(sql`DELETE FROM personalized_quotes WHERE id LIKE ${QP + '%'}`);
  await db.execute(sql`DELETE FROM leads WHERE id LIKE ${LP + '%'}`);
}

(async () => {
  if (process.argv.includes('--clean')) { await cleanTest(); console.log('Cleaned test spine rows.'); process.exit(0); }

  await cleanTest();
  console.log('=== LIVE END-TO-END SPINE PROOF ===\n');

  // ---- pick a real contractor to assign to (read-only) ----
  const cRow = rows(await db.execute(sql`SELECT id FROM handyman_profiles WHERE id LIKE 'hp_%' ORDER BY created_at LIMIT 1`))[0];
  if (!cRow) { console.log('No handyman_profiles found — cannot run proof.'); await cleanTest(); process.exit(1); }
  const contractorId: string = cRow.id;

  // ---- seed lead + dated, deposit-paid quote ----
  const leadId = `${LP}${rid(8)}`;
  const quoteId = `${QP}${rid(10)}`;
  const TOTAL = 12000;       // £120 customer price (line item)
  const DEPOSIT = 3600;      // £36 paid (30%) → £84 balance remains
  const CAT = 'general_fixing', MINS = 90; // rate-card general_fixing=1600/hr → contractorRate = 2400p

  await db.execute(sql`INSERT INTO leads (id, customer_name, phone, email, status, stage)
    VALUES (${leadId}, ${'TEST Spine'}, ${'07700900055'}, ${'spine@example.com'}, ${'active'}, ${'booked'})`);

  const line = {
    lineId: rid(8), source: 'custom', category: CAT, description: 'General fixing job',
    scheduleMinutes: MINS, timeEstimateMinutes: MINS, pricePence: TOTAL,
    guardedPricePence: TOTAL, referencePricePence: TOTAL, llmSuggestedPricePence: TOTAL, materialsCostPence: 0,
  };
  await db.execute(sql`INSERT INTO personalized_quotes
    (id, short_slug, customer_name, phone, email, job_description, segment, coordinates, base_price,
     pricing_line_items, deposit_paid_at, deposit_amount_pence, lead_id, created_at)
    VALUES (${quoteId}, ${'ts' + rid(6)}, ${'TEST Spine'}, ${'07700900055'}, ${'spine@example.com'},
      ${'General fixing job'}, ${'CONTEXTUAL'}, ${J({ lat: 52.955, lng: -1.141 })}::jsonb, ${TOTAL},
      ${J([line])}::jsonb, NOW(), ${DEPOSIT}, ${leadId}, NOW())`);
  console.log(`SEED · lead ${leadId} (stage=booked) + paid quote ${quoteId} (total £${TOTAL/100}, deposit £${DEPOSIT/100})`);
  console.log(`       contractor ${contractorId}\n`);

  // ===== LINK 2: deposit → CBR + jobSheet (real assignFromPool) =====
  const d = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  console.log(`LINK 2 · assignFromPool → ${d} am`);
  const r2 = await assignFromPool({ quoteId, contractorId, date: d, slot: 'am' });
  check('assignFromPool succeeded', !!r2.success, r2.error || `bookingId=${r2.bookingId}`);
  if (!r2.success) { console.log('\nHALT — cannot continue without a CBR row.'); process.exit(1); }
  const jobId = r2.bookingId!;

  const cbr0 = rows(await db.execute(sql`SELECT quote_id, assigned_contractor_id, contractor_id, day_of_status, status FROM contractor_booking_requests WHERE id = ${jobId}`))[0];
  check('CBR linked to quote', cbr0?.quote_id === quoteId, `quote_id=${cbr0?.quote_id}`);
  check('CBR carries assigned_contractor_id', cbr0?.assigned_contractor_id === contractorId, `=${cbr0?.assigned_contractor_id}`);
  check('CBR day_of_status defaults scheduled', cbr0?.day_of_status === 'scheduled', `=${cbr0?.day_of_status}`);

  const sheet = rows(await db.execute(sql`SELECT line_items FROM job_sheets WHERE job_id = ${jobId} LIMIT 1`))[0];
  const sheetLines = (sheet?.line_items as any[]) || [];
  const rate0 = sheetLines[0]?.contractorRatePence;
  check('jobSheet created with line items', sheetLines.length > 0, `${sheetLines.length} line(s)`);
  check('Gap-B: contractorRatePence populated (not 0)', !!rate0 && rate0 > 0, `=${rate0}p (expected 2400p)`);

  // ===== LINK 3: lifecycle scheduled → in_progress (mirror handler transitions) =====
  console.log(`\nLINK 3 · drive lifecycle to in_progress`);
  await db.execute(sql`UPDATE contractor_booking_requests SET day_of_status='en_route', en_route_at=NOW() WHERE id=${jobId}`);
  await db.execute(sql`UPDATE contractor_booking_requests SET day_of_status='arrived', arrived_at=NOW() WHERE id=${jobId}`);
  await db.execute(sql`UPDATE contractor_booking_requests SET day_of_status='in_progress', timer_started_at=NOW() - INTERVAL '30 minutes' WHERE id=${jobId}`);
  const cbr1 = rows(await db.execute(sql`SELECT day_of_status FROM contractor_booking_requests WHERE id=${jobId}`))[0];
  check('lifecycle reached in_progress', cbr1?.day_of_status === 'in_progress', `=${cbr1?.day_of_status}`);

  // ===== LINK 3-complete + 4 + 5: finalizeJobCompletion (REAL production code) =====
  console.log(`\nLINK 3/4/5 · finalizeJobCompletion (real handler core)`);
  const [jobRow] = await db.select().from(contractorBookingRequests).where(eq(contractorBookingRequests.id, jobId));
  const result = await finalizeJobCompletion(jobRow, contractorId, { completionType: 'full' });
  check('completion returned a summary', !!result.summary, `gross=${result.summary?.grossAmountPence}p`);

  // CBR completed
  const cbr2 = rows(await db.execute(sql`SELECT day_of_status, status, completed_at, invoice_id FROM contractor_booking_requests WHERE id=${jobId}`))[0];
  check('CBR marked completed', cbr2?.day_of_status === 'completed' && cbr2?.completed_at != null);

  // Gap-A rollup: quote + lead
  const qx = rows(await db.execute(sql`SELECT completed_at FROM personalized_quotes WHERE id=${quoteId}`))[0];
  check('Gap-A: quote.completed_at stamped', qx?.completed_at != null, `=${qx?.completed_at}`);
  const lx = rows(await db.execute(sql`SELECT stage FROM leads WHERE id=${leadId}`))[0];
  check('Gap-A: lead.stage advanced to completed', lx?.stage === 'completed', `=${lx?.stage} (was booked)`);

  // Link 5: payout record + fee math
  const pay = rows(await db.execute(sql`SELECT gross_amount_pence g, platform_fee_pence f, net_payout_pence n, status, quote_id, job_id FROM contractor_payouts WHERE job_id=${jobId}`))[0];
  check('payout record created', !!pay, pay ? `gross=${pay.g} fee=${pay.f} net=${pay.n} [${pay.status}]` : 'none');
  if (pay) {
    check('payout linked to quote + job', pay.quote_id === quoteId && pay.job_id === jobId);
    check('payout fee = 20% of gross', pay.f === Math.round(pay.g * 0.20), `fee=${pay.f}, 20%=${Math.round(pay.g*0.20)}`);
    check('payout net = gross - fee', pay.n === pay.g - pay.f);
    check('payout base = jobSheet contractor rate (2400p)', pay.g === 2400, `gross=${pay.g}`);
  }

  // Link 4: balance invoice (generated fire-and-forget inside finalize — poll briefly)
  console.log(`\nLINK 4 · poll for balance invoice (async fire-and-forget)…`);
  let inv: any = null;
  for (let i = 0; i < 15 && !inv; i++) {
    inv = rows(await db.execute(sql`SELECT id, invoice_number, total_amount t, deposit_paid dp, balance_due bd, status FROM invoices WHERE quote_id=${quoteId} LIMIT 1`))[0] || null;
    if (!inv) await new Promise((res) => setTimeout(res, 700));
  }
  check('balance invoice generated', !!inv, inv ? `${inv.invoice_number} total=£${inv.t/100} deposit=£${inv.dp/100} balance=£${inv.bd/100}` : 'not found after ~10s');
  if (inv) {
    check('invoice balance = total - deposit', inv.bd === inv.t - inv.dp, `${inv.bd} = ${inv.t} - ${inv.dp}`);
    const cbr3 = rows(await db.execute(sql`SELECT invoice_id FROM contractor_booking_requests WHERE id=${jobId}`))[0];
    check('invoice linked back onto CBR', cbr3?.invoice_id === inv.id, `cbr.invoice_id=${cbr3?.invoice_id}`);
  }

  // ---- verdict ----
  console.log(`\n=== VERDICT: ${pass} passed, ${fail} failed ===`);
  console.log(fail === 0
    ? '🟢 SPINE PROVEN END-TO-END — every handoff fired and stayed linked.'
    : '🔴 One or more links broke — see ❌ above.');
  console.log(`\n(test data left for inspection — re-run with --clean to remove. NOTE: real Stripe disbursement [link 6] intentionally NOT executed.)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('PROOF ERR', e?.stack || e?.message || e); process.exit(1); });
