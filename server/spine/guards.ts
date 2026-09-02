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

// ---------------------------------------------------------------- contractor guards (Phase 4 / C)
//
// A contractor brief may carry the POSTCODE (routing) and a first name. It may never carry the
// customer's phone number or email, and never a full street address alongside a full name — that
// is the customer's identity handed to a third party over WhatsApp. Postcode-only is allowed by
// design (§3.4 contractor.default): the full address goes through the job sheet after the deposit.
const PHONE_RE = /(\+?44\s?7\d{3}\s?\d{3}\s?\d{3}|\b07\d{3}\s?\d{3}\s?\d{3}\b|\b0\d{3}\s?\d{3}\s?\d{4}\b)/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
/** A house number + street word: "12 Nottingham Road", "Flat 3, 20 Mill Lane". */
const STREET_RE = /\b(?:flat\s*\d+[a-z]?,?\s*)?\d{1,4}[a-z]?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Close|Cl|Drive|Dr|Crescent|Cres|Way|Grove|Place|Pl|Court|Ct|Terrace|Gardens|Square|Hill|Park|Row|Walk)\b\.?/;
/** Two capitalised words that read as a person's full name, e.g. "Mrs Sarah Hughes", "Sarah Hughes". */
const FULL_NAME_RE = /\b(?:(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+)?[A-Z][a-z]{1,}\s+[A-Z][a-z]{2,}\b/;
const NOT_NAMES = /\b(?:Handy Services|Job Sheet|Quote Page|Good Morning|Kind Regards|Thanks Ben|Gas Safe)\b|\b\d{1,4}[a-z]?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Close|Cl|Drive|Dr|Crescent|Cres|Way|Grove|Place|Pl|Court|Ct|Terrace|Gardens|Square|Hill|Park|Row|Walk)\b/g;

/**
 * What a contractor message must not carry about a customer. Returns the reason, or null.
 * Allowed: postcode alone, a first name alone, a street with no name.
 */
export function detectCustomerPii(body: string): string | null {
    if (PHONE_RE.test(body)) return 'customer phone number';
    if (EMAIL_RE.test(body)) return 'customer email address';
    const street = STREET_RE.test(body);
    const name = FULL_NAME_RE.test(body.replace(NOT_NAMES, ''));
    if (street && name) return 'customer full name with street address';
    if (street && POSTCODE_RE.test(body) && name) return 'customer full name with full address';
    return null;
}

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
    customer_pii: ({ body }) => detectCustomerPii(body),
    // Contractor audience: figures TO a contractor (their payout, materials budget) are the whole
    // point of a job brief, so this guard is a deliberate no-op there. Its name is the rule for
    // the CUSTOMER side, which the money guard already enforces in every customer pack.
    money_to_customer: ({ caseFile }) => (caseFile.audience === 'contractor' ? null : null),
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
