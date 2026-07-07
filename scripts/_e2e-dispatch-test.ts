/**
 * REAL END-TO-END dispatch test (fenced test_q_flex_ data, no Stripe).
 * Flow: seed flex quotes → optimiser sweep → slot offers → customer picks/declines →
 * contractor assignment. Covers happy path + decline + pick-an-alternative edge cases.
 *   npx tsx scripts/_e2e-dispatch-test.ts
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { runDispatchSweep } from '../server/dispatch-sweep';
import { createSlotOffer, pickSlot, declineAll, confirmPaidPick, abandonOffer } from '../server/slot-offers';

const PREFIX = 'test_q_flex_';
const rid = (n = 10) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
const J = (x: any) => JSON.stringify(x);
const rows = (r: any) => r.rows ?? r;

async function cleanTest() {
  await db.execute(sql`DELETE FROM contractor_booking_requests WHERE quote_id LIKE ${PREFIX + '%'}`);
  await db.execute(sql`DELETE FROM personalized_quotes WHERE id LIKE ${PREFIX + '%'}`);
}

(async () => {
  // 0. controlled run — clear prior test dummies
  await cleanTest();

  // 1. seed 3 clustered, assignable flex quotes
  const C = { lat: 52.95, lng: -1.15 };
  const NEAR = ['NG7 2BY', 'NG5 3FN', 'NG3 5QF'];
  const mkLine = (cat: string, mins: number, price: number) => ({ lineId: rid(8), source: 'custom', category: cat, description: `${cat} job`, scheduleMinutes: mins, timeEstimateMinutes: mins, guardedPricePence: price, referencePricePence: price, llmSuggestedPricePence: price, materialsCostPence: 0 });
  const seed = [
    { name: 'Anna', cat: 'general_fixing', mins: 90, price: 9000 },
    { name: 'Bob', cat: 'general_fixing', mins: 120, price: 11000 },
    { name: 'Carol', cat: 'painting', mins: 150, price: 13000 },
  ];
  const ids: string[] = [];
  for (let i = 0; i < seed.length; i++) {
    const s = seed[i]; const id = `${PREFIX}${rid(10)}`; ids.push(id);
    await db.execute(sql`
      INSERT INTO personalized_quotes (id, short_slug, customer_name, phone, email, job_description, segment, postcode, coordinates, flex_booking_within_days, base_price, pricing_line_items, deposit_paid_at, created_at)
      VALUES (${id}, ${'tf' + rid(6)}, ${'TEST ' + s.name}, ${'07700900' + (10 + i)}, ${'teste2e' + i + '@example.com'}, ${s.cat + ' job'}, ${'CONTEXTUAL'}, ${NEAR[i]},
        ${J({ lat: C.lat + (Math.random() - 0.5) * 0.01, lng: C.lng + (Math.random() - 0.5) * 0.01 })}::jsonb, ${7}, ${s.price},
        ${J([mkLine(s.cat, s.mins, s.price)])}::jsonb, NOW(), NOW())`);
  }
  console.log(`SEED · ${ids.length} flex quotes: ${seed.map((s) => 'TEST ' + s.name).join(', ')}`);

  // 2. optimiser sweep (test-only)
  const sweep = await runDispatchSweep({ testOnly: true, dryRun: true });
  console.log(`\nSWEEP · pool ${sweep.poolSize} · assigned ${sweep.assigned.length} · unassignable ${sweep.unassignable.length} · groups ${sweep.groups.length}`);
  for (const g of sweep.groups) console.log(`  OPTIMISED DAY → ${g.contractorName} ${g.date}: ${g.members.length} job(s) [${g.members.map((m) => m.customerName).join(', ')}] · ${g.rationale}`);
  const byQ = new Map(sweep.assigned.map((p) => [p.quoteId, p]));
  const props = ids.map((id) => byQ.get(id)).filter(Boolean) as any[];
  if (props.length < 3) { console.log(`  ⚠ only ${props.length}/3 quotes placed (contractor availability/skills limited) — continuing with what placed`); }
  if (props.length === 0) { console.log('NO PROPOSALS — cannot continue (no contractor availability for test jobs).'); await cleanTest(); process.exit(0); }

  // 3. slot offers per proposal
  const offer: Record<string, any> = {};
  for (const p of props) {
    offer[p.quoteId] = await createSlotOffer({ quoteId: p.quoteId, recommended: { date: p.date, slot: p.slot, contractorId: p.contractorId, contractorName: p.contractorName } });
    console.log(`  OFFER → ${p.customerName}: rec ${p.date} ${p.slot} w/ ${p.contractorName} (+${offer[p.quoteId].candidates.length - 1} alt)`);
  }

  // 4. customer scenarios
  const [pA, pB, pC] = props;
  console.log(`\n── SCENARIOS ──`);

  // A — happy: pick recommended (free) → assigned
  const rA = await pickSlot(offer[pA.quoteId].token, pA.date, pA.slot);
  console.log(`A ${pA.customerName} → picks RECOMMENDED → ${J(rA)}`);

  // B — declines all (edge: customer doesn't agree) → re-offer → picks
  let rB: any = { skipped: true };
  if (pB) {
    console.log(`B ${pB.customerName} → DECLINES ALL → ${J(await declineAll(offer[pB.quoteId].token, 'none of these work'))}`);
    await abandonOffer(pB.quoteId);                       // dispatcher re-pools for a fresh proposal
    const sweep2 = await runDispatchSweep({ testOnly: true, dryRun: true });
    const pB2 = sweep2.assigned.find((p) => p.quoteId === pB.quoteId);
    if (pB2) {
      const o2 = await createSlotOffer({ quoteId: pB.quoteId, recommended: { date: pB2.date, slot: pB2.slot, contractorId: pB2.contractorId, contractorName: pB2.contractorName } });
      console.log(`  re-offer → rec ${pB2.date} ${pB2.slot} w/ ${pB2.contractorName}`);
      rB = await pickSlot(o2.token, pB2.date, pB2.slot);
    } else rB = { note: 'no re-proposal (availability)' };
    console.log(`B → picks RECOMMENDED on re-offer → ${J(rB)}`);
  }

  // C — picks an ALTERNATIVE slot (edge: doesn't take the proposed day, books another)
  let rC: any = { skipped: true };
  if (pC) {
    const alt = offer[pC.quoteId].candidates.find((c: any) => !c.recommended);
    if (alt) {
      const pick = await pickSlot(offer[pC.quoteId].token, alt.date, alt.slot);
      console.log(`C ${pC.customerName} → picks ALTERNATIVE ${alt.date} ${alt.slot} (premium £${(alt.premiumPence / 100).toFixed(0)}) → ${J(pick)}`);
      rC = (pick as any).requiresPayment ? await confirmPaidPick(pC.quoteId) : pick;  // test-bypass Stripe
      if ((pick as any).requiresPayment) console.log(`  (test) confirmPaidPick → ${J(rC)}`);
    } else { rC = { note: 'no alternative slot available' }; console.log(`C → ${J(rC)}`); }
  }

  // 5. verify final state
  console.log(`\n── FINAL STATE ──`);
  for (const q of rows(await db.execute(sql`SELECT customer_name, slot_offer->>'status' AS status, slot_offer->'picked' AS picked FROM personalized_quotes WHERE id LIKE ${PREFIX + '%'} ORDER BY customer_name`)))
    console.log(`  ${q.customer_name}: offer=${q.status ?? '—'} picked=${q.picked ? J(q.picked) : '—'}`);
  const books = rows(await db.execute(sql`SELECT pq.customer_name, cbr.scheduled_date::date AS d, cbr.scheduled_slot AS slot, cbr.contractor_id, cbr.status FROM contractor_booking_requests cbr JOIN personalized_quotes pq ON pq.id = cbr.quote_id WHERE cbr.quote_id LIKE ${PREFIX + '%'} ORDER BY d, slot`));
  console.log(`\n  CONTRACTOR ASSIGNMENTS (${books.length}):`);
  for (const b of books) console.log(`    ${b.customer_name} → contractor ${b.contractor_id} · ${b.d} ${b.slot} [${b.status}]`);
  console.log(`\n(test data left in place for inspection — run scripts/cleanup-dummy-flex-jobs.ts to remove)`);
  process.exit(0);
})().catch((e) => { console.error('E2E ERR', e?.message || e); process.exit(1); });
