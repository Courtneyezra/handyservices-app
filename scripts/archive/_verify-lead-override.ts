/**
 * E2E verify — lead contractor override ("auto-suggest, Ben confirms").
 *
 * Creates two REAL quotes through the running dev server's
 * POST /api/pricing/create-contextual-quote (test-data conventions:
 * Test name + 07700900xxx phone; rows deleted at the end):
 *   1. auto      → engine picks the lead (leadContractorSource='auto')
 *   2. forced    → forcedLeadContractorId=<other contractor> must win the lead
 *                  (leadContractorSource='manual')
 * Then asserts the two customer-facing surfaces react:
 *   • skin  — GET /api/personalized-quotes/:slug returns leadContractor = forced
 *   • dates — computeQuoteCandidatePoolForQuote(stored row) anchors
 *             availabilityContractorIds on the forced lead alone
 *             (this is exactly what /api/public/quote/:id/availability reads)
 */
import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../server/db';
import { handymanProfiles, handymanSkills, personalizedQuotes, leads, users } from '../shared/schema';

const BASE = 'http://localhost:5001';
const TEST_PHONE = '07700900123';

function fail(msg: string): never {
  console.error(`✗ FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string) {
  console.log(`✓ ${msg}`);
}

async function main() {
  // ── 1. Pick a category two contractors share; forced = not the auto pick ──
  const profiles = await db
    .select({ id: handymanProfiles.id, userId: handymanProfiles.userId, tier: handymanProfiles.deliveryTier, priority: handymanProfiles.deliveryPriority, verification: handymanProfiles.verificationStatus, publicEnabled: handymanProfiles.publicProfileEnabled })
    .from(handymanProfiles);
  const visible = profiles.filter((p) => p.verification === 'verified' || p.publicEnabled === true || (p.tier && p.tier !== 'adhoc'));
  const skills = await db.select({ handymanId: handymanSkills.handymanId, categorySlug: handymanSkills.categorySlug }).from(handymanSkills)
    .where(inArray(handymanSkills.handymanId, visible.map((p) => p.id)));
  const userRows = await db.select({ id: users.id, firstName: users.firstName }).from(users).where(inArray(users.id, visible.map((p) => p.userId)));
  const nameByProfile = new Map(visible.map((p) => [p.id, userRows.find((u) => u.id === p.userId)?.firstName ?? p.id]));

  const byCat = new Map<string, string[]>();
  for (const s of skills) {
    if (!s.categorySlug) continue;
    const list = byCat.get(s.categorySlug) ?? [];
    if (!list.includes(s.handymanId)) list.push(s.handymanId);
    byCat.set(s.categorySlug, list);
  }
  const shared = [...byCat.entries()].find(([, ids]) => ids.length >= 2);
  if (!shared) fail('no category covered by 2+ visible contractors — cannot test override');
  const [category, coverers] = shared;
  console.log(`Category under test: ${category}, covered by: ${coverers.map((id) => nameByProfile.get(id)).join(', ')}`);

  const mkBody = (name: string, forced?: string) => ({
    customerName: name,
    phone: TEST_PHONE,
    jobDescription: 'TEST lead-override verification',
    lines: [{ id: 'test-line-1', description: 'Test override line', category, estimatedMinutes: 60, materialsCostPence: 0 }],
    ...(forced ? { forcedLeadContractorId: forced } : {}),
  });

  const post = async (body: any) => {
    const res = await fetch(`${BASE}/api/pricing/create-contextual-quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) fail(`create-contextual-quote → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ quoteId: string; shortSlug: string }>;
  };

  const cleanupIds: string[] = [];
  try {
    // ── 2. AUTO quote — the engine's own pick ──
    const auto = await post(mkBody('Test AutoLead'));
    cleanupIds.push(auto.quoteId);
    const [autoRow] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.id, auto.quoteId));
    if (!autoRow?.leadContractorId) fail('auto quote has no leadContractorId');
    if ((autoRow as any).leadContractorSource !== 'auto') fail(`auto quote source = ${(autoRow as any).leadContractorSource}, expected 'auto'`);
    ok(`auto quote ${auto.shortSlug}: lead=${nameByProfile.get(autoRow.leadContractorId)} source=auto`);

    // Forced = a coverer that is NOT the auto pick.
    const forcedId = coverers.find((id) => id !== autoRow.leadContractorId);
    if (!forcedId) fail('only one coverer — cannot pick a different forced lead');

    // ── 3. FORCED quote — Ben's override must win ──
    const forced = await post(mkBody('Test ForcedLead', forcedId));
    cleanupIds.push(forced.quoteId);
    const [forcedRow] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.id, forced.quoteId));
    if (forcedRow?.leadContractorId !== forcedId) fail(`forced quote lead=${forcedRow?.leadContractorId}, expected ${forcedId}`);
    if ((forcedRow as any).leadContractorSource !== 'manual') fail(`forced quote source = ${(forcedRow as any).leadContractorSource}, expected 'manual'`);
    const plan = forcedRow.teamPlan as any;
    if (plan?.leadContractorId !== forcedId) fail(`teamPlan lead=${plan?.leadContractorId}, expected ${forcedId}`);
    ok(`forced quote ${forced.shortSlug}: lead=${nameByProfile.get(forcedId)} source=manual teamPlan.kind=${plan?.kind}`);

    // ── 4. Customer-facing SKIN reacts ──
    const skinRes = await fetch(`${BASE}/api/personalized-quotes/${forced.shortSlug}`);
    if (!skinRes.ok) fail(`quote view → ${skinRes.status}`);
    const skin = await skinRes.json();
    if (skin.leadContractor?.id !== forcedId) fail(`customer skin leadContractor.id=${skin.leadContractor?.id}, expected ${forcedId}`);
    ok(`customer skin shows forced lead: ${skin.leadContractor?.name}`);

    // ── 5. Customer DATE PICKER anchors on the forced lead ──
    // Same function the public availability route calls on the stored row.
    const { computeQuoteCandidatePoolForQuote } = await import('../server/lib/quote-fit');
    const fit = await computeQuoteCandidatePoolForQuote(forcedRow as any);
    if (fit.availabilityContractorIds.length !== 1 || fit.availabilityContractorIds[0] !== forcedId) {
      fail(`availability drivers = [${fit.availabilityContractorIds.join(', ')}], expected [${forcedId}] alone`);
    }
    ok(`live fit recompute anchors availability on forced lead alone`);
    const autoFit = await computeQuoteCandidatePoolForQuote(autoRow as any);
    console.log(`  (auto quote availability drivers for contrast: [${autoFit.availabilityContractorIds.map((id) => nameByProfile.get(id) ?? id).join(', ')}])`);

    // HTTP smoke of the public picker route (route-level wiring).
    const availRes = await fetch(`${BASE}/api/public/quote/${forced.quoteId}/availability?slot=full_day`);
    if (!availRes.ok) fail(`public availability → ${availRes.status}`);
    ok(`public availability route responds (${(await availRes.json()).length} dates)`);

    console.log('\nALL CHECKS PASSED');
  } finally {
    // ── 6. Scrub test data (quotes + any lead rows auto-created for the phone) ──
    if (cleanupIds.length) await db.delete(personalizedQuotes).where(inArray(personalizedQuotes.id, cleanupIds));
    await db.delete(leads).where(and(eq(leads.phone, TEST_PHONE)));
    console.log(`Scrubbed ${cleanupIds.length} test quotes + leads for ${TEST_PHONE}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
