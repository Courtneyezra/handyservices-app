import type { PolicyPack } from '../types';
import { CUSTOMER_DEFAULT } from './customer-default';

/** §3.4 `customer.post_quote` — default + answer_from_quote / point_to_picker; price_objection → Ben. DRAFT. */
export const CUSTOMER_POST_QUOTE: PolicyPack = {
    ...CUSTOMER_DEFAULT,
    id: 'customer.post_quote',
    version: 1,
    stage: 'quote_sent',
    // B3: point_to_picker now lives on customer.default too (PRD §7); the set keeps it once.
    allowedIntents: Array.from(new Set([...CUSTOMER_DEFAULT.allowedIntents, 'answer_from_quote', 'point_to_picker'] as const)),
    guardSet: [...CUSTOMER_DEFAULT.guardSet, 'price_objection'],
    tierByIntent: {},
    templates: { ...CUSTOMER_DEFAULT.templates },
};
