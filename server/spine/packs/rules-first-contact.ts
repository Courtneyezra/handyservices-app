import type { PolicyPack } from '../types';

/**
 * §3.4 `rules.first_contact` — content-free by construction (today's first-contact-ack.ts and the
 * rules layer's asks). Template only; SEND at launch. Template names mirror
 * FIRST_CONTACT_TEMPLATE_PREFERENCE / ASK_TEMPLATE_PREFERENCE (kept as strings so this file stays
 * dependency-free).
 */
export const RULES_FIRST_CONTACT: PolicyPack = {
    id: 'rules.first_contact',
    version: 1,
    audience: 'customer',
    city: 'nottingham',
    allowedIntents: ['ack_enquiry', 'ack_photos', 'ack_returning', 'ask_media', 'ask_postcode', 'ask_name', 'holding', 'quote_on_its_way'],
    guardSet: ['voice'],
    tierByIntent: {},
    defaultTier: 'SEND',
    hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 },
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'date_question', 'callback_requested'],
    voiceFile: 'brand-voice/whatsapp-comms.md',
    templates: {
        ack_enquiry: 'web_enquiry_ack_context',
        ack_photos: 'video_request',
        ack_returning: '1_contact_generic',
        ask_media: 'video_request',
        ask_postcode: 'postcode_request',
        holding: 'holding_line',
    },
};
