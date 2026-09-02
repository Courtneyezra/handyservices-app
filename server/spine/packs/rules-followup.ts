import type { PolicyPack } from '../types';

/** §3.4 `rules.followup` — content-free follow-up templates (quote unviewed, promise overdue, SLA chase). SEND. */
export const RULES_FOLLOWUP: PolicyPack = {
    id: 'rules.followup',
    version: 1,
    audience: 'customer',
    city: 'nottingham',
    allowedIntents: ['quote_unviewed', 'promise_overdue_holding', 'sla_chase'],
    guardSet: ['voice'],
    tierByIntent: {},
    defaultTier: 'SEND',
    // Follow-ups are proactive by nature: never outside 08–20 UK.
    hours: { reactiveAlways: false, proactiveFromHour: 8, proactiveToHour: 20 },
    exceptionsToBen: ['complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade', 'money_question', 'date_question', 'callback_requested'],
    voiceFile: 'brand-voice/whatsapp-comms.md',
    templates: {
        promise_overdue_holding: 'holding_line',
        sla_chase: 'holding_line',
    },
};
