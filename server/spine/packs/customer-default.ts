import type { PolicyPack } from '../types';

/**
 * §3.4 `customer.default` — the Scoper's pack. Every intent DRAFT at launch; each earns SEND
 * on its own evidence (§4). Money and dates are not intents here and never will be: the quote
 * page is the numbers channel, Ben is the dates channel.
 */
export const CUSTOMER_DEFAULT: PolicyPack = {
    id: 'customer.default',
    version: 1,
    audience: 'customer',
    city: 'nottingham',
    allowedIntents: ['ask_gap', 'clarify_scope', 'confirm_received', 'holding', 'faq_from_kb', 'point_to_quote_page', 'closing'],
    guardSet: ['money', 'date_promise', 'discount', 'duration_claim', 'capability_claim', 'liability', 'policy_commitment', 'capitulation', 'voice', 'unseen_implication'],
    tierByIntent: {},
    defaultTier: 'DRAFT',
    hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 },
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'date_question', 'callback_requested'],
    voiceFile: 'brand-voice/whatsapp-comms.md',
    templates: { holding: 'holding_line' },
};
