/**
 * Offer decision router — the rules spine from docs/OFFER_DECISION_PLAYBOOK.md
 * (v1 LOCKED 12 Aug 2026). Decides, per quote at generation time, which offer
 * play the customer SHOULD get (targetPlay) and which they actually get today
 * (servedPlay — unbuilt plays fall back so the decision log measures demand
 * for missing plays before they exist).
 *
 * OBSERVATION MODE: nothing customer-facing reads this yet. The client's
 * pickQuoteOffer stays authoritative until the shadow week completes; this
 * module only logs decisions + shows them to the operator in the builder.
 *
 * The behaviour of this file is POLICY, owned by the playbook doc. Change the
 * doc first, then this file to match — never the other way round.
 */
import { db } from './db';
import { quoteOfferDecisions } from '../shared/schema';
import { desc, eq } from 'drizzle-orm';
import { isFirstTimeCustomer, welcomeGiftPool, type WelcomeGiftQuoteShape } from './welcome-gift';
import { getPricingSettings } from './pricing-settings';
import type { PricingSettings } from '../shared/pricing-settings';

// ── Play whitelist (playbook §2) ─────────────────────────────────────────────

export const OFFER_PLAYS = [
    'welcome_gift', 'bundle_up', 'risk_removal', 'visit_first', 'quote_split',
    'partner', 'forward_pack', 'loyalty', 'terms_compliance', 'nudge',
    'post_job_upsell', 'none',
] as const;
export type OfferPlay = (typeof OFFER_PLAYS)[number];

/** Plays that can actually be served to a customer today. Everything else
 * logs as unmet intent (targetPlay) and degrades via fallbackFor(). */
const BUILT_PLAYS: ReadonlySet<OfferPlay> = new Set(['welcome_gift', 'bundle_up', 'none']);

export type PriceBand = 'under_100' | '100_200' | '200_1000' | '1000_2500' | 'over_2500';
export type Stakes = 'low' | 'med' | 'high';

export interface OfferDecisionInputs {
    customerType: string | null;
    priceBand: PriceBand;
    totalPence: number;
    stakes: Stakes;
    stakesSource: 'proxy' | 'llm' | 'ben';
    firstTime: boolean;
    surveyRequired: boolean;
    marginOk: boolean;
    /** G3 precomputed: floor cleared AND gift pool non-empty (firstTime checked separately). */
    giftPoolOpen: boolean;
    vertical?: string | null;
}

export interface OfferDecision {
    ruleFired: string;
    goal: string;
    targetPlay: OfferPlay;
    servedPlay: OfferPlay;
    rationale: string;
    /** Set when the target play isn't built and we degraded. */
    unmetIntent: boolean;
}

// ── Input derivation ─────────────────────────────────────────────────────────

export function toPriceBand(totalPence: number): PriceBand {
    if (totalPence < 10000) return 'under_100';
    if (totalPence < 20000) return '100_200';
    if (totalPence < 100000) return '200_1000';
    if (totalPence < 250000) return '1000_2500';
    return 'over_2500';
}

/**
 * Stakes v0 proxy (playbook locked decision #4): HIGH when any line looks like
 * active leaks / major plumbing, electrical, structural, or roofing work.
 * Category slugs vary across the engine, so match patterns over category AND
 * description. Deliberately excludes plumbing_minor (a dripping tap is not an
 * anxiety job). MED when the job is ≥£500, else LOW.
 */
// `leak` carries a negative lookahead so tap leaks ("fix a leaking or dripping
// tap") stay low-stakes while real water ingress ("leak from bathroom above")
// reads high.
const HIGH_STAKES_PATTERN = /rewir|consumer unit|fuse ?(box|board)|\brcd\b|roof|structur|load.?bear|joist|burst|flood|damp|ceiling|water (damage|stain|coming|ingress)|leak(?![^]{0,24}tap)/i;
const MINOR_PATTERN = /minor/i;

export function deriveStakes(
    lines: Array<{ category?: string | null; description?: string | null }>,
    totalPence: number,
): Stakes {
    for (const line of lines) {
        const cat = String(line.category || '');
        const desc = String(line.description || '');
        // The description is checked for EVERY line — a minor category must not
        // hide an anxious job described on it. (Found live 12 Aug: plumbing_minor
        // + "leak from bathroom above" classified low; the Claude shadow flagged
        // it high on the router's first real disagreement.)
        if (HIGH_STAKES_PATTERN.test(desc)) return 'high';
        if (MINOR_PATTERN.test(cat)) continue;
        if (HIGH_STAKES_PATTERN.test(cat) || /plumbing|electric/i.test(cat)) return 'high';
    }
    return totalPence >= 50000 ? 'med' : 'low';
}

// ── The rules (playbook §3–§4) ───────────────────────────────────────────────

/** Unbuilt targets degrade here. bundle_up is the locked repeat-customer
 * interim; everything else falls to none (straight to price). */
function fallbackFor(target: OfferPlay, inputs: OfferDecisionInputs): OfferPlay {
    if (BUILT_PLAYS.has(target)) return target;
    if (target === 'loyalty') return inputs.marginOk ? 'bundle_up' : 'none'; // owner call 12 Aug + G7
    return 'none';
}

/** G7: giveaway plays need healthy margin. */
function marginGate(play: OfferPlay, inputs: OfferDecisionInputs): OfferPlay {
    if (!inputs.marginOk && (play === 'welcome_gift' || play === 'bundle_up')) return 'none';
    return play;
}

/**
 * Pure decision function. Evaluation order within tier 1 (documented in the
 * playbook): job-shape overrides (R3, R4, R5) before identity rules (R6, R7,
 * R8) before status rules (R1, R2) — a £3k repeat customer needs the
 * phone-first route, not a bundle menu.
 */
export function decideQuoteOffer(inputs: OfferDecisionInputs): OfferDecision {
    const make = (
        ruleFired: string, goal: string, targetPlay: OfferPlay, rationale: string,
    ): OfferDecision => {
        const served = marginGate(fallbackFor(targetPlay, inputs), inputs);
        return {
            ruleFired, goal, targetPlay, servedPlay: served, rationale,
            unmetIntent: served !== targetPlay,
        };
    };

    // ── Guardrails ──
    if (inputs.surveyRequired) {
        return make('G1', 'visit booked', 'visit_first',
            'Survey gate is on — job money paths are refused, so no booking play belongs on this quote.');
    }

    // ── Tier 1: job-shape overrides ──
    if (inputs.priceBand === 'over_2500') {
        return make('R3', 'phone first', 'visit_first',
            'Over £2.5k self-serve close rate is ~0% — this quote should be a phone call and a visit, not a web checkout.');
    }
    if (inputs.priceBand === '1000_2500') {
        return make('R4', 'visit booked', 'visit_first',
            '£1k–2.5k closes at ~14%; the lever is decision-process help (visit / split), not offer theatre.');
    }
    if (inputs.stakes === 'high' && inputs.totalPence >= 25000) {
        return make('R5', 'build trust', 'risk_removal',
            'High-stakes trade detected — the customer is anxious about it going wrong; sell risk-removal, not a free gift.');
    }

    // ── Tier 1: identity rules ──
    const ct = inputs.customerType || '';
    if (ct === 'property_manager' || ct === 'letting_agent') {
        return make('R6', 'relationship', 'partner',
            'Portfolio professional — wants response times and account terms, not gift theatre.');
    }
    if (ct === 'tenant') {
        return make('R7', 'owner approval', 'forward_pack',
            'Tenant is not the payer — the conversion is getting this in front of the landlord.');
    }
    if (ct === 'business') {
        return make('R8', 'account terms', 'terms_compliance',
            'Business customer — invoiced terms and compliance docs close this, not consumer offers.');
    }

    // ── Tier 1: status rules ──
    if (!inputs.firstTime) {
        return make('R1', 'deposit now', 'loyalty',
            'Repeat customer — "welcome" reads as nonsense; loyalty play when built, bundle-up meanwhile.');
    }
    if (inputs.priceBand === 'under_100') {
        return make('R2', 'raise basket', 'bundle_up',
            'Sub-£100 job — a gift costs more than the margin; the play is making the visit worth more.');
    }

    // ── Tier 2: sweet-spot defaults ──
    if (
        (ct === 'homeowner' || ct === 'oap_homeowner' || ct === 'landlord' || ct === '') &&
        inputs.priceBand === '200_1000' && inputs.stakes !== 'high'
    ) {
        if (inputs.giftPoolOpen) {
            return make('R9', 'deposit now', 'welcome_gift',
                'First-time customer in the gift sweet spot — the welcome gift is built for exactly this quote.');
        }
        return make('G3', 'deposit now', 'none',
            'R9 matched but the gift pool is empty for this quote (floor/pool exclusions) — no gift to give.');
    }
    if (inputs.priceBand === '100_200') {
        return make('R10', 'raise basket', 'bundle_up',
            'First-timer below the £200 gift floor — bundle-up raises the visit value instead.');
    }

    // ── Tier 3: fallback ──
    return make('R11', 'deposit now', 'none',
        'No rule matched — straight to price. Always legal, never an error.');
}

// ── Derivation + persistence orchestration ───────────────────────────────────

export interface QuoteForDecision extends WelcomeGiftQuoteShape {
    shortSlug?: string | null;
    customerType?: string | null;
    surveyRequired?: boolean | null;
    vertical?: string | null;
    marginPercent?: number | null;
}

export async function deriveOfferInputs(
    quote: QuoteForDecision,
    totalPence: number,
    lines: Array<{ category?: string | null; description?: string | null }>,
    settings?: PricingSettings,
): Promise<OfferDecisionInputs> {
    const s = settings ?? await getPricingSettings();
    const minQuotePence = s.welcomeGiftMinQuotePence ?? 20000;
    // fail-open on firstTime derivation errors: a DB hiccup should log a
    // decision with the common case, not lose the row. (Gift SERVING still
    // fails closed inside welcome-gift.ts — this only affects the log.)
    let firstTime = true;
    try {
        firstTime = await isFirstTimeCustomer(quote);
    } catch { /* keep default */ }
    return {
        customerType: quote.customerType || null,
        priceBand: toPriceBand(totalPence),
        totalPence,
        stakes: deriveStakes(lines, totalPence),
        stakesSource: 'proxy',
        firstTime,
        surveyRequired: !!quote.surveyRequired,
        // v0 margin gate: only trips on a known-negative margin (null = unknown = ok)
        marginOk: quote.marginPercent == null || quote.marginPercent >= 0,
        giftPoolOpen: totalPence >= minQuotePence && welcomeGiftPool(s, quote).length > 0,
        vertical: quote.vertical || null,
    };
}

/**
 * Run the router for a quote and append a decision row. NEVER throws and never
 * blocks the caller's response — generation must not fail because logging did.
 * Returns the decision (or null on failure) so the generate endpoint can echo
 * it to the builder UI.
 */
export async function recordOfferDecision(
    quote: QuoteForDecision,
    totalPence: number,
    lines: Array<{ category?: string | null; description?: string | null }>,
    moment: 'first_view' = 'first_view',
): Promise<(OfferDecision & { inputs: OfferDecisionInputs; decisionId: string }) | null> {
    try {
        const inputs = await deriveOfferInputs(quote, totalPence, lines);
        const decision = decideQuoteOffer(inputs);
        const [row] = await db.insert(quoteOfferDecisions).values({
            quoteId: quote.id,
            slug: quote.shortSlug || null,
            moment,
            inputs,
            ruleFired: decision.ruleFired,
            goal: decision.goal,
            targetPlay: decision.targetPlay,
            servedPlay: decision.servedPlay,
            rationale: decision.rationale,
            decidedBy: 'rules',
        }).returning({ id: quoteOfferDecisions.id });
        return { ...decision, inputs, decisionId: row.id };
    } catch (err) {
        console.warn('[OfferRouter] decision logging failed (non-blocking):',
            err instanceof Error ? err.message : err);
        return null;
    }
}

/** Latest decision for a quote (builder display + future page reads). */
export async function latestOfferDecision(quoteId: string) {
    const [row] = await db.select().from(quoteOfferDecisions)
        .where(eq(quoteOfferDecisions.quoteId, quoteId))
        .orderBy(desc(quoteOfferDecisions.decidedAt))
        .limit(1);
    return row || null;
}

/**
 * Ben's override — appends a NEW row (append-only log; the original rules row
 * stays for the disagreement review). Carries the latest inputs snapshot
 * forward so evidence joins keep their context.
 */
export async function recordBenOverride(quoteId: string, play: OfferPlay, byName?: string | null) {
    const latest = await latestOfferDecision(quoteId);
    const [row] = await db.insert(quoteOfferDecisions).values({
        quoteId,
        slug: latest?.slug || null,
        moment: latest?.moment || 'first_view',
        inputs: latest?.inputs ?? null,
        ruleFired: 'ben_override',
        goal: latest?.goal || null,
        targetPlay: play,
        servedPlay: BUILT_PLAYS.has(play) ? play : 'none',
        rationale: byName ? `Operator override by ${byName}` : 'Operator override',
        decidedBy: 'ben_override',
    }).returning();
    return row;
}
