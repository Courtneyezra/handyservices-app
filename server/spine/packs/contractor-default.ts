import type { PolicyPack } from '../types';

/** §3.4 `contractor.default` — Phase 4 liaison. DRAFT. Guards: never leak customer PII, never talk money to the customer. */
export const CONTRACTOR_DEFAULT: PolicyPack = {
    id: 'contractor.default',
    version: 1,
    audience: 'contractor',
    city: 'nottingham',
    allowedIntents: ['job_brief', 'availability_ask', 'confirm_receipt', 'materials_list'],
    guardSet: ['customer_pii', 'money_to_customer', 'voice'],
    tierByIntent: {},
    defaultTier: 'DRAFT',
    hours: { reactiveAlways: true, proactiveFromHour: 7, proactiveToHour: 20 },
    exceptionsToBen: ['complaint', 'trust_concern', 'out_of_scope'],
    voiceFile: 'brand-voice/whatsapp-comms.md',
    templates: {},
};
