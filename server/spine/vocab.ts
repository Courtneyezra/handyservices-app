/**
 * Runtime twins of the type-level vocabularies in ./types. The types are erased at runtime; the
 * triage schema, the packs and the guards need the lists as values. `satisfies` keeps each list
 * honest against its union: add a name to types.ts and forget it here, or vice versa, and tsc
 * says so.
 */
import type { Audience, Stage, Tier, Trigger, AgentName, Lane, ExceptionKind, Intent, GuardName } from './types';

export const AUDIENCES = ['customer', 'contractor', 'supplier', 'internal'] as const satisfies readonly Audience[];
export const STAGES = ['enquiry', 'scoping', 'quote_sent', 'booked', 'closed', 'won'] as const satisfies readonly Stage[];
export const TIERS = ['READ', 'PROPOSE', 'DRAFT', 'SEND'] as const satisfies readonly Tier[];
export const TRIGGERS = ['inbound_message', 'media_received', 'call_ended', 'cadence', 'flag_expiry', 'manual'] as const satisfies readonly Trigger[];
export const AGENT_NAMES = ['triage', 'rules', 'scoper', 'quote_clerk', 'recovery', 'verifier', 'contractor_liaison', 'vision'] as const satisfies readonly AgentName[];
export const LANES = ['dropped', 'rules', 'scoper', 'post_quote', 'ben', 'quote_clerk', 'contractor'] as const satisfies readonly Lane[];
export const EXCEPTIONS = [
    'complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade',
    'money_question', 'date_question', 'callback_requested', 'spam', 'opted_out',
] as const satisfies readonly ExceptionKind[];

export const RULES_INTENTS = [
    'ack_enquiry', 'ack_photos', 'ack_returning', 'ask_media', 'ask_postcode', 'ask_name',
    'holding', 'quote_on_its_way', 'quote_unviewed', 'promise_overdue_holding', 'sla_chase',
] as const satisfies readonly Intent[];
export const SCOPER_INTENTS = ['ask_gap', 'clarify_scope', 'confirm_received', 'faq_from_kb', 'point_to_quote_page', 'closing'] as const satisfies readonly Intent[];
export const POST_QUOTE_INTENTS = ['answer_from_quote', 'point_to_picker'] as const satisfies readonly Intent[];
export const CONTRACTOR_INTENTS = ['job_brief', 'availability_ask', 'confirm_receipt', 'materials_list'] as const satisfies readonly Intent[];
export const INTENTS = [...RULES_INTENTS, ...SCOPER_INTENTS, ...POST_QUOTE_INTENTS, ...CONTRACTOR_INTENTS] as const satisfies readonly Intent[];

export const GUARD_NAMES = [
    'money', 'discount', 'date_promise', 'duration_claim', 'capability_claim', 'liability',
    'policy_commitment', 'capitulation', 'voice', 'unseen_implication', 'price_objection',
    'customer_pii', 'money_to_customer',
] as const satisfies readonly GuardName[];

export function isIntent(x: unknown): x is Intent { return typeof x === 'string' && (INTENTS as readonly string[]).includes(x); }
export function isLane(x: unknown): x is Lane { return typeof x === 'string' && (LANES as readonly string[]).includes(x); }
export function isException(x: unknown): x is ExceptionKind { return typeof x === 'string' && (EXCEPTIONS as readonly string[]).includes(x); }
export function isStage(x: unknown): x is Stage { return typeof x === 'string' && (STAGES as readonly string[]).includes(x); }
export function isTrigger(x: unknown): x is Trigger { return typeof x === 'string' && (TRIGGERS as readonly string[]).includes(x); }
export function isAgentName(x: unknown): x is AgentName { return typeof x === 'string' && (AGENT_NAMES as readonly string[]).includes(x); }
