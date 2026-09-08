import type { PolicyPack } from '../types';

/**
 * §3.4 `customer.default` — the Scoper's pack. Every intent was DRAFT at launch and each earns
 * SEND on its own evidence (§4); T35 (8 Sep 2026) sets the four §5.1 intents to SEND as their
 * starting position, and the ladder still moves them from there.
 *
 * Money is not an intent here and never will be: the quote page is the numbers channel. Dates
 * (PRD v3 §7, B3): not Ben's either — "dates come with your quote" before a quote, the quote
 * page's picker once one is live (point_to_picker; the Scoper's tool refuses it without a live
 * unpaid quote, and the send preconditions refuse it again unless the body names the slug).
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
    // T35 (8 Sep 2026), the captain: "we need this comms to be autonomous … and reply quick".
    // The four intents B7a's comment below already names as PRD v3 §5.1's send-tier set start at
    // SEND. Nothing else moves: `defaultTier` is still DRAFT, so any intent added later still
    // starts in Ben's queue, and every one of these four still has to pass, in order,
    // `guardSet` (money above all — a price, a discount, a date, a duration or fee terms refuses
    // the proposal outright), `exceptionsToBen`, an open flag on the thread, the hours, the
    // channel, `neverSend`, and finally server/spine/send-preconditions.ts, which is where the
    // per-intent structural rule lives. This is a STARTING POSITION, not a bypass: the earned
    // ladder (server/spine/autonomy.ts) still overlays pack_intent_tiers over these values and
    // can still demote any of them back to DRAFT on Ben's verdicts or the sampler.
    tierByIntent: {
        ask_gap: 'SEND',
        confirm_received: 'SEND',
        point_to_quote_page: 'SEND',
        point_to_picker: 'SEND',
    },
    // B7a: what may NEVER hold a SEND tier here, whatever the ladder or a person says — the
    // empty-body holding path (BACKLOG D4), scope statements, KB answers, closings, the survey
    // offer. What is left (ask_gap, confirm_received, point_to_quote_page, point_to_picker) is PRD
    // v3 §5.1, and each of those still has to pass server/spine/send-preconditions.ts at SEND.
    neverSend: ['holding', 'clarify_scope', 'faq_from_kb', 'closing', 'offer_survey'],
    defaultTier: 'DRAFT',
    hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 },
    // B3 / PRD §7: date_question retired as a Ben trigger. It reaches Ben only on the §13 interim
    // path (a booked job), where triage lanes `ben` and the exception pack takes it.
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'callback_requested'],
    voiceFile: 'brand-voice/whatsapp-comms.md',
    templates: { holding: 'holding_line' },
};
