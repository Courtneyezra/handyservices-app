/**
 * The guard chain at the spine (design §3.6): a bridge from a pack's `guardSet` (GuardName) to
 * the detectors in server/agents/draft-guards.ts, which stay the single source of truth for what
 * a customer may not be told. `escalate` mirrors ESCALATE_CODES in server/agents/comms.ts: a hit
 * in a Ben-only family (money, discount, date, liability, duration, fee terms, price objection)
 * becomes a flag, never silence.
 */
import {
    detectMoneyFigure, detectDiscountOffer, detectDatePromise, detectDurationClaim, detectCapabilityClaim,
    detectLiabilityAdmission, detectPolicyCommitment, detectCapitulation, detectVoiceBreach,
    detectUnseenImplication, detectPriceObjection,
} from '../agents/draft-guards';
import type { CaseFile, GuardName, GuardVerdict, PolicyPack, Proposal } from './types';
import { lastInbound } from './triage';

/** Mirrors ESCALATE_CODES (comms.ts): Ben-only families. */
export const ESCALATE_GUARDS: readonly GuardName[] = ['money', 'discount', 'date_promise', 'liability', 'duration_claim', 'policy_commitment', 'price_objection', 'money_to_customer'];

/** UK mobile / email / postcode — what a contractor brief must never carry about a customer. */
const PII_RE = /(\+?44\s?7\d{3}\s?\d{3}\s?\d{3}|\b07\d{3}\s?\d{3}\s?\d{3}\b|[\w.+-]+@[\w-]+\.[\w.-]+|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b)/;

type Detector = (ctx: { body: string; customerText: string | null; caseFile: CaseFile }) => string | null;

const DETECTORS: Record<GuardName, Detector> = {
    money: ({ body }) => detectMoneyFigure(body),
    discount: ({ body }) => detectDiscountOffer(body),
    date_promise: ({ body }) => detectDatePromise(body),
    duration_claim: ({ body }) => detectDurationClaim(body),
    capability_claim: ({ body }) => detectCapabilityClaim(body),
    liability: ({ body }) => detectLiabilityAdmission(body),
    policy_commitment: ({ body }) => detectPolicyCommitment(body),
    // Only meaningful when the customer has just pushed back on price (same rule as checkDraft).
    capitulation: ({ body, customerText }) => (detectPriceObjection(customerText) ? detectCapitulation(body) : null),
    voice: ({ body }) => detectVoiceBreach(body),
    // A draft may not imply the quote is unseen once it has been opened.
    unseen_implication: ({ body, caseFile }) => (caseFile.quote?.viewedAt ? detectUnseenImplication(body) : null),
    // The customer objected to the price: Ben's, whatever the agent wrote.
    price_objection: ({ customerText }) => detectPriceObjection(customerText),
    customer_pii: ({ body }) => (PII_RE.test(body) ? 'customer contact details in a contractor message' : null),
    money_to_customer: ({ body }) => detectMoneyFigure(body),
};

export function checkProposal(proposal: Proposal, pack: PolicyPack, caseFile: CaseFile): GuardVerdict {
    const body = proposal.body.join('\n');
    const last = lastInbound(caseFile);
    const customerText = last?.body ?? last?.transcript ?? null;
    const guardsHit: GuardName[] = [];
    const notes: string[] = [];
    for (const name of pack.guardSet) {
        const detector = DETECTORS[name];
        if (!detector) continue;
        let hit: string | null = null;
        try { hit = detector({ body, customerText, caseFile }); } catch (e: any) { hit = `guard ${name} threw: ${e?.message ?? e}`; }
        if (hit) { guardsHit.push(name); notes.push(`${name}: ${hit.slice(0, 200)}`); }
    }
    if (!(pack.allowedIntents as string[]).includes(proposal.intent)) {
        notes.push(`intent ${proposal.intent} is not allowed in pack ${pack.id}`);
    }
    const escalate = guardsHit.some((g) => ESCALATE_GUARDS.includes(g));
    return { ok: guardsHit.length === 0, guardsHit, escalate, notes };
}
