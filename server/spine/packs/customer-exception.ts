import type { PolicyPack } from '../types';

/**
 * §3.4 `customer.exception` — Ben only. No intents: nothing an agent may say. The rules layer
 * may send one holding line at flag expiry (server/rules-layer.ts), which is not this pack's
 * decision.
 */
export const CUSTOMER_EXCEPTION: PolicyPack = {
    id: 'customer.exception',
    version: 1,
    audience: 'customer',
    city: 'nottingham',
    allowedIntents: [],
    guardSet: [],
    tierByIntent: {},
    defaultTier: 'READ',
    hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 },
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'date_question', 'callback_requested', 'spam', 'opted_out'],
    voiceFile: 'brand-voice/whatsapp-comms.md',
    templates: {},
};
