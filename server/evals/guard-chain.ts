/**
 * The guard chain as a measurable thing (Phase 2 / C, COMMS_AGENTS_V3_DESIGN §9).
 *
 * Production runs checkDraft() and stops at the FIRST violation. For evals we want every detector's
 * verdict on a body, so a broken detector shows up even when an earlier one would have caught the
 * text. Same detectors, same module (server/agents/draft-guards.ts) — what is measured is what runs.
 * Pure: no db, no network.
 */
import {
    checkDraft, detectDiscountOffer, detectPolicyCommitment, detectMoneyFigure, detectLiabilityAdmission,
    detectVoiceBreach, detectCapabilityClaim, detectUnseenImplication, detectCapitulation, detectDatePromise,
    detectDurationClaim, detectPriceObjection, type DraftViolation,
} from '../agents/draft-guards';
import type { GuardName } from '../spine/types';

export type GuardCode = DraftViolation['code'];

/** Detector code → spine GuardName (server/spine/types.ts). */
export const GUARD_CODE_TO_NAME: Record<GuardCode, GuardName> = {
    money_figure: 'money',
    discount_offer: 'discount',
    date_promise: 'date_promise',
    duration_claim: 'duration_claim',
    capability_claim: 'capability_claim',
    liability_admission: 'liability',
    policy_commitment: 'policy_commitment',
    capitulation: 'capitulation',
    voice_breach: 'voice',
    implies_unseen: 'unseen_implication',
};

/**
 * Mirror of ESCALATE_CODES inside runCommsAgent (server/agents/comms.ts): the families whose
 * refusal must reach Ben rather than just bounce the model. Kept in step by hand — the original
 * is a function-local const. A voice breach or an unseen implication is a rewrite, not a Ben item.
 */
export const ESCALATING_GUARD_CODES: readonly GuardCode[] = [
    'money_figure', 'discount_offer', 'date_promise', 'liability_admission', 'duration_claim', 'policy_commitment',
];

export interface GuardHit { code: GuardCode; guard: GuardName; match: string }

export interface GuardChainContext {
    /** The customer's own last message — arms the capitulation check (price objection). */
    customerText?: string | null;
    intent?: string | null;
    quoteSeen?: boolean;
    quoteViewCount?: number;
    offeredDates?: readonly string[];
    quoteTotalPence?: number | null;
}

export interface GuardChainResult {
    /** Every detector that fired, in production order. */
    hits: GuardHit[];
    /** What production's checkDraft would have returned (first violation) — the live verdict. */
    first: DraftViolation | null;
    /** At least one hit is in the Ben-only families. */
    escalating: boolean;
    escalatingCodes: GuardCode[];
}

export function runGuardChain(body: string, ctx: GuardChainContext = {}): GuardChainResult {
    const hits: GuardHit[] = [];
    const push = (code: GuardCode, match: string | null) => { if (match) hits.push({ code, guard: GUARD_CODE_TO_NAME[code], match }); };
    push('discount_offer', detectDiscountOffer(body));
    push('policy_commitment', detectPolicyCommitment(body));
    push('money_figure', detectMoneyFigure(body));
    push('liability_admission', detectLiabilityAdmission(body));
    push('voice_breach', detectVoiceBreach(body));
    push('capability_claim', detectCapabilityClaim(body));
    if (ctx.quoteSeen) push('implies_unseen', detectUnseenImplication(body));
    if (ctx.intent === 'price_objection' || detectPriceObjection(ctx.customerText)) push('capitulation', detectCapitulation(body));
    push('date_promise', detectDatePromise(body));
    push('duration_claim', detectDurationClaim(body));

    const first = checkDraft({
        body, intent: ctx.intent ?? 'unknown', quoteSeen: !!ctx.quoteSeen, quoteViewCount: ctx.quoteViewCount,
        offeredDates: ctx.offeredDates, quoteTotalPence: ctx.quoteTotalPence ?? null, customerText: ctx.customerText ?? null,
    });
    const escalatingCodes = hits.map((h) => h.code).filter((c) => ESCALATING_GUARD_CODES.includes(c));
    return { hits, first, escalating: escalatingCodes.length > 0, escalatingCodes };
}
