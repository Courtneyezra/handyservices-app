/**
 * Verify the offer router spine: pure rules matrix + live decision-log
 * round-trip (test row is deleted afterwards).
 */
import { decideQuoteOffer, deriveStakes, toPriceBand, recordOfferDecision, latestOfferDecision, type OfferDecisionInputs } from '../server/offer-router';
import { db } from '../server/db';
import { quoteOfferDecisions } from '../shared/schema';
import { eq } from 'drizzle-orm';

const base: OfferDecisionInputs = {
    customerType: 'homeowner', priceBand: '200_1000', totalPence: 45000,
    stakes: 'low', stakesSource: 'proxy', firstTime: true, surveyRequired: false,
    marginOk: true, giftPoolOpen: true, vertical: 'handyman',
};

const cases: Array<{ name: string; inputs: OfferDecisionInputs; rule: string; served: string; target?: string }> = [
    { name: 'survey gate wins', inputs: { ...base, surveyRequired: true }, rule: 'G1', served: 'none', target: 'visit_first' },
    { name: 'over £2.5k → phone first', inputs: { ...base, priceBand: 'over_2500', totalPence: 300000 }, rule: 'R3', served: 'none', target: 'visit_first' },
    { name: '£1k-2.5k → visit', inputs: { ...base, priceBand: '1000_2500', totalPence: 150000 }, rule: 'R4', served: 'none', target: 'visit_first' },
    { name: 'high stakes → risk removal', inputs: { ...base, stakes: 'high' }, rule: 'R5', served: 'none', target: 'risk_removal' },
    { name: 'property manager → partner', inputs: { ...base, customerType: 'property_manager' }, rule: 'R6', served: 'none', target: 'partner' },
    { name: 'tenant → forward pack', inputs: { ...base, customerType: 'tenant' }, rule: 'R7', served: 'none', target: 'forward_pack' },
    { name: 'business → terms', inputs: { ...base, customerType: 'business' }, rule: 'R8', served: 'none', target: 'terms_compliance' },
    { name: 'repeat → bundle_up interim', inputs: { ...base, firstTime: false }, rule: 'R1', served: 'bundle_up', target: 'loyalty' },
    { name: 'repeat + bad margin → none', inputs: { ...base, firstTime: false, marginOk: false }, rule: 'R1', served: 'none' },
    { name: 'sub-£100 → bundle_up', inputs: { ...base, priceBand: 'under_100', totalPence: 8000 }, rule: 'R2', served: 'bundle_up' },
    { name: 'sweet spot → welcome gift', inputs: base, rule: 'R9', served: 'welcome_gift' },
    { name: 'sweet spot, empty pool → none', inputs: { ...base, giftPoolOpen: false }, rule: 'G3', served: 'none' },
    { name: 'sweet spot, bad margin → none', inputs: { ...base, marginOk: false }, rule: 'R9', served: 'none' },
    { name: '£100-200 → bundle_up', inputs: { ...base, priceBand: '100_200', totalPence: 15000 }, rule: 'R10', served: 'bundle_up' },
    { name: 'oap sweet spot → gift', inputs: { ...base, customerType: 'oap_homeowner' }, rule: 'R9', served: 'welcome_gift' },
    { name: 'landlord sweet spot → gift (locked #5)', inputs: { ...base, customerType: 'landlord' }, rule: 'R9', served: 'welcome_gift' },
    { name: '£3k repeat → phone first beats bundle', inputs: { ...base, firstTime: false, priceBand: 'over_2500', totalPence: 300000 }, rule: 'R3', served: 'none' },
];

let failed = 0;
for (const c of cases) {
    const d = decideQuoteOffer(c.inputs);
    const ok = d.ruleFired === c.rule && d.servedPlay === c.served && (!c.target || d.targetPlay === c.target);
    if (!ok) {
        failed++;
        console.error(`FAIL ${c.name}: got ${d.ruleFired}/${d.targetPlay}→${d.servedPlay}, want ${c.rule}/${c.target ?? '*'}→${c.served}`);
    } else {
        console.log(`ok   ${c.name} → ${d.ruleFired} ${d.targetPlay}${d.targetPlay !== d.servedPlay ? ` (serving ${d.servedPlay})` : ''}`);
    }
}

// Derivation spot checks
const bandChecks: Array<[number, string]> = [[8000, 'under_100'], [15000, '100_200'], [45000, '200_1000'], [150000, '1000_2500'], [300000, 'over_2500']];
for (const [pence, want] of bandChecks) {
    if (toPriceBand(pence) !== want) { failed++; console.error(`FAIL band ${pence} → ${toPriceBand(pence)}, want ${want}`); }
}
const s1 = deriveStakes([{ category: 'electrical_minor', description: 'replace socket' }], 30000);
const s2 = deriveStakes([{ category: 'painting', description: 'repaint hallway' }], 30000);
const s3 = deriveStakes([{ category: 'plumbing_minor', description: 'fix a leaking or dripping tap' }], 30000);
const s4 = deriveStakes([{ category: 'general_fixing', description: 'roof tile slipped, leak into bedroom' }], 30000);
const s5 = deriveStakes([{ category: 'plumbing_minor', description: 'investigate and repair leak from bathroom above, make good ceiling below' }], 30000);
console.log(`stakes: electrical_minor=${s1} painting=${s2} tap-leak=${s3} roof-leak-desc=${s4} minor-cat-real-leak=${s5}`);
if (s4 !== 'high') { failed++; console.error('FAIL: roof/leak description should be high stakes'); }
if (s3 === 'high') { failed++; console.error('FAIL: tap leak must not be high stakes'); }
if (s5 !== 'high') { failed++; console.error('FAIL: minor category must not hide a real leak in the description'); }
const s6 = deriveStakes([{ category: 'painting', description: 'Paint the hallway, stairs and landing - walls, ceilings and woodwork' }], 33000);
if (s6 === 'high') { failed++; console.error('FAIL: painting ceilings is cosmetic, not high stakes'); }

// Live round-trip on the decision log (cleaned up after)
async function liveRoundTrip() {
    const testQuote = {
        id: 'test_q_offer_spine_verify', shortSlug: 'testofr1', phone: '07700900999',
        email: null, basePrice: 45000, pricingLineItems: [],
        customerType: 'homeowner', surveyRequired: false, vertical: 'handyman', marginPercent: 30,
    };
    const rec = await recordOfferDecision(testQuote, 45000, [{ category: 'painting', description: 'repaint hallway' }]);
    if (!rec) throw new Error('recordOfferDecision returned null');
    const fetched = await latestOfferDecision(testQuote.id);
    if (!fetched || fetched.id !== rec.decisionId) throw new Error('latestOfferDecision mismatch');
    console.log(`live: logged ${fetched.ruleFired} ${fetched.targetPlay}→${fetched.servedPlay} (${fetched.id})`);
    await db.delete(quoteOfferDecisions).where(eq(quoteOfferDecisions.quoteId, testQuote.id));
    console.log('live: test row cleaned up');
}

liveRoundTrip()
    .then(() => {
        console.log(failed === 0 ? `\nALL PASS (${cases.length} rule cases + derivations + live round-trip)` : `\n${failed} FAILURES`);
        process.exit(failed === 0 ? 0 : 1);
    })
    .catch((err) => { console.error('LIVE ROUND-TRIP FAILED:', err); process.exit(1); });
