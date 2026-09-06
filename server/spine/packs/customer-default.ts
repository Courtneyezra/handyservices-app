import type { PolicyPack } from '../types';

/**
 * §3.4 `customer.default` — the Scoper's pack. Every intent DRAFT at launch; each earns SEND
 * on its own evidence (§4). Money is not an intent here and never will be: the quote page is the
 * numbers channel. Dates (PRD v3 §7, B3): not Ben's either — "dates come with your quote" before
 * a quote, the quote page's picker once one is live (point_to_picker, DRAFT like everything
 * else; the Scoper's tool refuses it without a live unpaid quote).
 */
export const CUSTOMER_DEFAULT: PolicyPack = {
    id: 'customer.default',
    version: 1,
    audience: 'customer',
    city: 'nottingham',
    // P8: offer_survey is the chain's DRAFT-tier paid-survey offer when the clerk says visit_first
    // (server/spine/survey-offer.ts); its fee is a setting cited as price_source=settings.
    allowedIntents: ['ask_gap', 'clarify_scope', 'confirm_received', 'holding', 'faq_from_kb', 'point_to_quote_page', 'closing', 'offer_survey', 'point_to_picker'],
    guardSet: ['money', 'date_promise', 'discount', 'duration_claim', 'capability_claim', 'liability', 'policy_commitment', 'capitulation', 'voice', 'unseen_implication', 'soft_commitment'],
    tierByIntent: {},
    defaultTier: 'DRAFT',
    hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 },
    // B3 / PRD §7: date_question retired as a Ben trigger. It reaches Ben only on the §13 interim
    // path (a booked job), where triage lanes `ben` and the exception pack takes it.
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'callback_requested'],
    voiceFile: 'brand-voice/whatsapp-comms.md',
    templates: { holding: 'holding_line' },
};
