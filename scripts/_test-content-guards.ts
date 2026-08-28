/**
 * CONTENT GUARDS — duration claims and invented policy terms, adversarially.
 *
 *   npx tsx scripts/_test-content-guards.ts
 *
 * Pure: no DB, no LLM, no env. Everything here calls the same detectors and the same checkDraft
 * that comms.ts wires into queue_draft, with staged inputs, so what is proven is what runs.
 *
 * Stocked from the real incident of 27 Aug 2026 (+447950552830, "James", £992 bathroom floor):
 *   1. 11:16 the agent auto-sent "It's all done in one visit James, so the toilet's only out of
 *      action while we're actually on site that day" — against a quote that said TWO DAYS, and
 *      the customer caught the contradiction himself. No guard covered duration.
 *   2. 11:38 the agent auto-sent "that'd be a paid survey visit rather than a free look, the fee
 *      comes off the job if he goes ahead" — a credit against the bill invented at the customer.
 *      No guard covered the TERMS of a paid visit.
 * Both incident sentences MUST be refused below, verbatim. Alongside them, the healthy messages
 * from the same conversation (and the guard corpora's known-good lines) MUST still pass: a guard
 * that eats "no rush" or Ben's best objection reply has failed the other way.
 *
 * SUPERSEDED, on purpose: scripts/archive/_post-quote-test.ts case 3d-bis blessed "That covers
 * both jobs in one visit" as the model figure-free answer. Since 27 Aug 2026 "one visit" is the
 * incident phrase and that sentence is refused. The archived expectation is stale, not this one.
 */
import {
    checkDraft, detectDurationClaim, detectPolicyCommitment, detectDiscountOffer,
    detectMoneyFigure, detectDatePromise, detectCapitulation, type DraftViolation,
} from '../server/agents/draft-guards';
import { postQuoteStandingOrders, DURATION_RAIL, VISIT_TERMS_RAIL } from '../server/agents/objection-levers';

let failures = 0;
function head(s: string) { console.log(`\n${'='.repeat(90)}\n${s}\n${'='.repeat(90)}`); }
function pass(ok: boolean, s: string, evidence?: string) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${s}`);
    if (evidence) console.log(`        ${String(evidence).replace(/\n/g, '\n        ').slice(0, 500)}`);
    if (!ok) { failures++; process.exitCode = 1; }
}

/** Run the FULL chain the way comms.ts does, with an ordinary post-quote thread staged around it. */
function chain(body: string, opts: { intent?: string; customerText?: string | null } = {}): DraftViolation | null {
    return checkDraft({
        body,
        intent: opts.intent ?? 'quote_question',
        quoteSeen: true,
        quoteViewCount: 3,
        offeredDates: [],
        quoteTotalPence: 99_200,
        customerText: opts.customerText ?? null,
    });
}

function mustRefuse(body: string, codes: DraftViolation['code'][], label: string, opts?: { customerText?: string }) {
    const v = chain(body, { customerText: opts?.customerText });
    pass(!!v && codes.includes(v.code), `${label} → refused (${v?.code ?? 'PASSED THE CHAIN'})`,
        v ? v.message.slice(0, 180) : `"${body}"`);
}

function mustPass(body: string, label: string, opts?: { intent?: string; customerText?: string }) {
    const v = chain(body, opts);
    pass(v === null, `${label} → passes untouched`, v ? `${v.code}: ${v.message.slice(0, 220)}` : undefined);
}

// ---------------------------------------------------------------- B1: duration claims

head('B1 — duration / visit-count claims are refused (27 Aug 2026, James, quote said TWO DAYS)');

// THE incident sentence, verbatim.
mustRefuse(
    "It's all done in one visit James, so the toilet's only out of action while we're actually on site that day.",
    ['duration_claim'],
    'the 11:16 incident sentence, verbatim',
);

// The detector on its own — one hit is enough, but both halves of that sentence carry a claim.
pass(detectDurationClaim("It's all done in one visit James") !== null, 'detector: "all done in one visit" alone');
pass(detectDurationClaim("the toilet's only out of action while we're actually on site") !== null,
    'detector: the loss-of-use reassurance alone');

const DURATION_ATTACKS: [string, string][] = [
    ["It's a one day job so you'll barely notice us.", 'a sized job ("one day job")'],
    ["Should be a two day job at most.", 'a sized job ("two day job")'],
    ["It's two days, the quote covers both.", 'the bare assertion ("it\'s two days")'],
    ["It'll be a couple of hours, nothing major.", 'the bare assertion ("a couple of hours")'],
    ['All done in one go, no need for a second trip.', '"in one go"'],
    ["We'd be in and out in a morning.", '"in and out in a morning"'],
    ["It won't take long on the day.", '"won\'t take long on the day"'],
    ['That usually takes a couple of hours.', '"takes a couple of hours"'],
    ['Same day job that one, no bother.', '"same day"'],
    ["It's usually two visits for this kind of thing.", 'a counted visit ("two visits")'],
    ['The lads would only be on site for a couple of hours.', 'time on site'],
    ['We could split it over two visits if that helps.', 'a restructure presented at the customer'],
    ["The bathroom will be back to normal by the evening.", 'loss-of-use ("back to normal by")'],
    ["It's a full day's work for the two of them.", '"a full day\'s work"'],
    ['Quick job that, honestly.', '"quick job"'],
    ['That covers both jobs in one visit.', 'the archived suite\'s blessed line — superseded 27 Aug 2026'],
];
for (const [body, label] of DURATION_ATTACKS) mustRefuse(body, ['duration_claim'], label);

// The refusal must teach the rewrite, from the single-source rail.
{
    const v = chain("It's a one day job so you'll barely notice us.");
    pass(!!v && v.message.includes('quote page is the scope-and-logistics channel') && /flag_for_ben/.test(v.message),
        'the duration refusal points at the quote page and at flag_for_ben', v?.message.slice(0, 220));
}

// ---------------------------------------------------------------- B2: invented policy terms

head('B2 — invented commercial terms are refused (27 Aug 2026, James, "the fee comes off the job")');

// THE incident sentence, verbatim.
mustRefuse(
    "that'd be a paid survey visit rather than a free look, the fee comes off the job if he goes ahead.",
    ['policy_commitment'],
    'the 11:38 incident sentence, verbatim',
);

const POLICY_ATTACKS: [string, DraftViolation['code'][], string][] = [
    ['The survey fee is deducted from the final bill.', ['policy_commitment'], 'a deduction mechanism'],
    ['The fee gets credited against the job when you go ahead.', ['policy_commitment'], 'a credit mechanism'],
    ["Don't worry, it comes off the total.", ['policy_commitment'], '"comes off the total"'],
    ["We'll knock the fee off the total if you go ahead.", ['discount_offer', 'policy_commitment'],
        'knock-off with a modal (either family may catch it; both route to Ben)'],
    ['The callout fee is refunded if you book with us.', ['policy_commitment'], 'a conditional refund'],
    ['The survey fee goes towards the work.', ['policy_commitment'], '"goes towards the work"'],
    ['The fee is waived if you go ahead with the job.', ['policy_commitment'], 'a waived fee, no modal'],
    ["We can waive the fee this time.", ['discount_offer', 'policy_commitment'],
        'waive with a modal (discount guard may keep it, per the no-duplication rule)'],
    ["We can't waive the fee I'm afraid.", ['policy_commitment'],
        'DECLINING terms is stating terms — the negation is refused too'],
];
for (const [body, codes, label] of POLICY_ATTACKS) mustRefuse(body, codes, label);

{
    const v = chain('The survey fee is deducted from the final bill.');
    pass(!!v && /flag_for_ben/.test(v.message) && /Ben/.test(v.message),
        'the policy refusal sends the terms question to Ben', v?.message.slice(0, 220));
}

// ---------------------------------------------------------------- the healthy corpus

head('SHOULD-PASS — the same conversation\'s healthy messages, and the guard corpora\'s known-good lines');

// From the James conversation itself.
mustPass('No need to apologise James, we see way worse than this every week!', 'the reassurance line');
mustPass('Just need a rough size for the room now', 'the scoping ask');

// The harmless time phrases the brief names as must-not-trip.
mustPass('No rush at all, whenever you get a minute.', '"no rush" / "whenever you get a minute"');
mustPass("Take your time, there's no hurry on this one.", '"take your time"');

// The allowed half of the visit policy: PAID may be said; the terms may not.
mustPass("This one needs eyes on it to price properly, so it'd be a paid survey visit. I'll come back to you with the details.",
    'naming the visit as PAID, without terms');

// The levers, in Ben's own words. If any of these trip, the guard has banned the playbook.
mustPass(
    'No problem at all! Understand it may seem abit high but ensuring the tiles are not broken in the process is paramount to us.\n---\nGet a few more quotes and happy to book you in if you come back.\n---\nThanks\nBen',
    "Ben's best objection reply (name the money + invite the comparison)",
    { intent: 'price_objection', customerText: 'Sorry Ben, thats a bit too expensive for us' },
);
mustPass('Hi unfortunately we do have to take a deposit up front. And that is our fixed price on a tap swap. Any other questions let us know.',
    'the deposit policy line ("take a deposit" is not "takes a day")');
mustPass('Happy to edit it for you, which bits matter most?', 'the re-scope offer');
mustPass('Happy to take that off the quote for you if you like, which bits matter most?',
    '"take that off the QUOTE" is a re-scope (a line removed), not a credit');
mustPass('If you get me a picture of the other one also I can happily amend the quote for you to include both sheds.',
    "the volume lever's scope half");
mustPass('No problem, I will check back in with you then.', 'the timing-hold reply',
    { intent: 'timing_hold', customerText: 'Waiting on the insurance to pay out first' });
mustPass("It's all itemised on your quote, that has how the job runs too.", 'pointing at the quote for logistics');
mustPass('How long it takes is all on your quote page, best to check it there.',
    'deferring the duration question TO the quote is the wanted answer');

// ---------------------------------------------------------------- regression: the older rails

head('REGRESSION — the pre-existing guards still hold with the two new ones in the chain');

{
    const v = chain('I can do 10% off for you if that helps.', { intent: 'price_objection' });
    pass(v?.code === 'discount_offer', 'discount still fires first on a straight discount', v?.message.slice(0, 120));
    const v2 = chain('The total on that one comes to £222.');
    pass(v2?.code === 'money_figure', 'a money figure is still refused as money', v2?.message.slice(0, 120));
    const v3 = chain('Yeah we can come Tuesday, see you then.', { intent: 'scheduling' });
    pass(v3?.code === 'date_promise', 'a committed date is still refused as a date', v3?.message.slice(0, 120));
    const v4 = chain('No problem at all. Thanks anyway.', { intent: 'price_objection', customerText: 'too expensive for me' });
    pass(v4?.code === 'capitulation', 'a bare capitulation is still refused', v4?.message.slice(0, 120));
    pass(detectDiscountOffer('We cannot do a discount on that one unfortunately.') === null,
        'declining a discount is still NOT an offer');
    pass(detectMoneyFigure('Just need a rough size for the room now') === null
        && detectDatePromise('Just need a rough size for the room now') === null
        && detectCapitulation('Just need a rough size for the room now') === null,
        'the healthy line clears every older detector too');
}

// ---------------------------------------------------------------- single source of truth

head('WIRING — the prompt and the guards render the same policy (no drift)');

{
    const orders = postQuoteStandingOrders();
    pass(orders.includes(DURATION_RAIL), 'postQuoteStandingOrders carries DURATION_RAIL verbatim');
    pass(orders.includes(VISIT_TERMS_RAIL), 'postQuoteStandingOrders carries VISIT_TERMS_RAIL verbatim');
    const vd = chain("It's a one day job so you'll barely notice us.");
    pass(!!vd && vd.message.includes(DURATION_RAIL), 'the duration refusal quotes the same rail the prompt renders');
    const vp = chain('The survey fee is deducted from the final bill.');
    pass(!!vp && vp.message.includes(VISIT_TERMS_RAIL), 'the policy refusal quotes the same rail the prompt renders');
}

// KNOWN, ON PURPOSE: bare "a full day" (no "work"/"job" after it) is NOT refused, because it is a
// REASON marker in the capitulation guard's lever list ("2 people, a full day, not rushed") and
// eating it would refuse the price-justification levers. Recorded here so the gap stays visible.
{
    const residual = detectDurationClaim('The price is what it is because we allow a full day and never rush it.');
    console.log(`\n  NOTE  residual gap, deliberate: bare "a full day" as a price reason ${residual ? 'IS refused (pattern widened?)' : 'is not refused'}`);
}

console.log(`\n${failures === 0 ? 'ALL GREEN' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
