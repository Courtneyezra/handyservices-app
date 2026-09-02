import type { PolicyPack } from '../types';
import { CUSTOMER_DEFAULT } from './customer-default';

/** §3.4 `customer.post_quote` — default + answer_from_quote / point_to_picker; price_objection → Ben. DRAFT. */
export const CUSTOMER_POST_QUOTE: PolicyPack = {
    ...CUSTOMER_DEFAULT,
    id: 'customer.post_quote',
    version: 1,
    stage: 'quote_sent',
    allowedIntents: [...CUSTOMER_DEFAULT.allowedIntents, 'answer_from_quote', 'point_to_picker'],
    guardSet: [...CUSTOMER_DEFAULT.guardSet, 'price_objection'],
    tierByIntent: {},
    templates: { ...CUSTOMER_DEFAULT.templates },
};
