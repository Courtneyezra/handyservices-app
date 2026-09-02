/**
 * /admin/staff cards for the spine roles (Phase 5 / C). Same shape as the legacy `STAFF` exports
 * in server/agents/*.ts so AgentStaffPage renders them unchanged: mission, the autonomy ladder
 * (freely / approval / never), the tool belt, model, cadence. Live numbers are added by
 * server/agent-staff.ts from agent_runs; the switches come from app_settings.spine.
 *
 * Everything here is text about code that exists; nothing runs. When a role is deleted (Phase 5
 * "Delete"), delete its card here.
 */
import type { AgentName } from './types';

export interface StaffTool { name: string; blurb: string; kind: 'read' | 'write' | 'gated' }
export interface StaffCard {
    id: string;
    /** The agent_runs.agent value this card counts, when it has one. */
    agent?: AgentName | 'rules' | 'vision';
    name: string;
    roleTitle: string;
    mission: string;
    model: string;
    cadence: string;
    tier: 'READ' | 'PROPOSE' | 'DRAFT' | 'SEND' | 'RULES';
    accent: 'emerald' | 'amber' | 'sky';
    autonomy: { freely: string[]; approval: string[]; never: string[] };
    tools: StaffTool[];
    /** Where the standing orders live, for the dossier. */
    ordersFile?: string;
}

export const SPINE_STAFF: StaffCard[] = [
    {
        id: 'rules-layer', agent: 'rules', name: 'Rules layer', roleTitle: 'The Receptionist — content-free sends',
        tier: 'SEND', accent: 'emerald', model: 'none (templates and fixed copy)',
        cadence: 'First contact on ingest · silence-breaker at 10 min · holding line at flag/draft expiry · asks from the spine exit',
        mission: 'Never lets a customer sit in silence. Acknowledges a first touch, asks for a photo or a postcode, and holds the line when a reply is late — from fixed copy or an approved Meta template, so nothing it sends can carry a price, a date or a promise. It is the only SEND-tier component at launch.',
        autonomy: {
            freely: ['Send the first-contact ack (webform, WhatsApp, SMS, missed call) 24/7', 'Send the 10-minute silence-breaker and the flag/draft-expiry holding line', 'Ask for a photo/video, then a postcode, once per thread per 24h (spine.asks)'],
            approval: ['Nothing: it composes nothing. When it has no channel (window shut, no template, no SMS) it queues for Ben instead'],
            never: ['Write a reply of its own', 'Send twice in two hours on one thread', 'Send to an opted-out, archived or test number', 'Send once a person or an agent has already replied'],
        },
        tools: [
            { name: 'first-contact-ack', blurb: 'server/first-contact-ack.ts — the ack ladder (WhatsApp → template → SMS)', kind: 'gated' },
            { name: 'sendHoldingLine', blurb: 'server/rules-layer.ts — silence / flag_expiry / draft_expiry copy, approver rules.holding', kind: 'gated' },
            { name: 'sendAsk', blurb: 'ask_media / ask_postcode / ask_name, approver rules.ask', kind: 'gated' },
        ],
        ordersFile: 'server/rules-layer.ts (HOLDING_COPY, ASK_COPY)',
    },
    {
        id: 'triage', agent: 'triage', name: 'Triage', roleTitle: 'The Sorter — lanes and exceptions',
        tier: 'READ', accent: 'sky', model: 'rules first, then claude-haiku-4-5',
        cadence: 'Every spine run, before any agent',
        mission: 'Reads the case file and decides the lane: dropped (opt-out, spam), rules (first contact), scoper, post-quote, quote clerk, contractor, or Ben. Any exception the customer raises — money, a date, a complaint, a refund, a callback, regulated work — goes to Ben before an agent runs. Deterministic lexicons fire first; the model only widens what the rules could not read.',
        autonomy: {
            freely: ['Choose the lane and the exception list', 'Write tags and stage on the thread'],
            approval: ['Nothing to approve: it sends nothing and drafts nothing'],
            never: ['Reply to a customer', 'Override an exception the rules found (the model can add, not remove)'],
        },
        tools: [
            { name: 'triageRules', blurb: 'server/spine/triage.ts — opt-out, spam, money/date/complaint/refund/callback/regulated lexicons, first-contact and needs_quote routing', kind: 'read' },
            { name: 'triage (model)', blurb: 'One schema-validated Haiku call over the case file, merged over the rules', kind: 'read' },
        ],
        ordersFile: 'server/spine/triage.ts (TRIAGE_SYSTEM)',
    },
    {
        id: 'scoper', agent: 'scoper', name: 'Scoper', roleTitle: 'The Correspondent — customer conversation on the spine',
        tier: 'DRAFT', accent: 'emerald', model: 'claude-sonnet-5',
        cadence: 'On inbound (debounced ~10 min) via requestRun; shadow or live per the spine mode',
        mission: 'The legacy comms agent\'s replacement on the customer thread. Reads one immutable case file and proposes one reply with a named intent (ask a gap, clarify scope, confirm received, FAQ, point to the quote page, closing; after a quote: answer from the quote, point to the picker). Every intent starts at DRAFT and earns SEND from Ben\'s verdicts and the eval family; money and dates are not in its vocabulary at all.',
        autonomy: {
            freely: ['Propose one reply per run (1–3 short bubbles, one question)', 'Flag a thread for Ben with a briefing note', 'Save the customer\'s real name when they state it', 'Propose a dated re-contact into the nudge queue'],
            approval: ['Every reply while its intent is at DRAFT (all of them at launch)', 'Anything the guard chain refuses — refused proposals become a flag, never silence', 'Proactive sends outside 08–20 wait for the morning'],
            never: ['Write a money figure, a discount, a date, a duration or fee terms — refused at the tool', 'Send: the exit sends, and only at SEND tier with an approver and a run id', 'Reply on a thread with an open flag for Ben'],
        },
        tools: [
            { name: 'propose_reply', blurb: 'The one proposal; intent must be in the pack; guard chain + voice at the tool', kind: 'gated' },
            { name: 'flag', blurb: 'Hand to Ben: exception + the briefing note he reads on his phone', kind: 'write' },
            { name: 'set_contact_name', blurb: 'Only a name the customer stated', kind: 'write' },
            { name: 'schedule_recontact', blurb: 'Proposes a nudge; sends nothing', kind: 'gated' },
            { name: 'get_quick_replies', blurb: 'House-voice canned replies to adapt', kind: 'read' },
        ],
        ordersFile: 'server/spine/prompts/scoper.core.md (+ scoper.post_quote.md)',
    },
    {
        id: 'quote-clerk', agent: 'quote_clerk', name: 'Quote clerk', roleTitle: 'The Clerk — scope, never price',
        tier: 'PROPOSE', accent: 'sky', model: 'claude-sonnet-5 (wraps Quote Prep)',
        cadence: 'needs_quote tag · quote_clerk lane · call_ended with a transcript',
        mission: 'Turns a thread or a call transcript into a quote-ready intake for Ben: lines with a category, gaps, media ticked on, name and postcode. The product is a quote Ben can send in under a minute, never a price (design §6). Its artifact feeds the in-chat quote card.',
        autonomy: {
            freely: ['Read the thread, photos and transcripts', 'Propose an intake with a category on every line', 'Flag a polite-no (out of scope trade)'],
            approval: ['Everything: Ben prices and sends'],
            never: ['Write a price', 'Message the customer', 'Book anything'],
        },
        tools: [
            { name: 'get_thread', blurb: 'Messages, calls with transcripts, media', kind: 'read' },
            { name: 'get_prior_quotes', blurb: 'What we quoted this customer before', kind: 'read' },
            { name: 'submit_intake', blurb: 'The structured intake (validated: titles ≤ 60 chars, no prices)', kind: 'write' },
        ],
        ordersFile: 'server/agents/quote-prep.ts (SYSTEM)',
    },
    {
        id: 'recovery-spine', agent: 'recovery', name: 'Recovery (spine)', roleTitle: 'The Chaser — unpaid quotes, proposed only',
        tier: 'PROPOSE', accent: 'amber', model: 'claude-opus-5 (wraps the recovery sweep)',
        cadence: 'Cadence / manual trigger on the spine; the legacy sweep still runs its own clock',
        mission: 'Reviews quotes that went quiet and proposes one follow-up each into the nudge queue with a lever (reminder, split, reassure, expiry, unclaimed gift). Ben sends from the queue with a tap; nothing leaves by itself.',
        autonomy: {
            freely: ['Read candidates, threads and quote context', 'Propose a nudge or an explicit skip per candidate'],
            approval: ['Every nudge'],
            never: ['Send', 'Offer a discount or a price change', 'Promise a date'],
        },
        tools: [
            { name: 'get_recovery_candidates', blurb: 'Unpaid real-customer quotes, last 21 days, no nudge in 5', kind: 'read' },
            { name: 'queue_nudge', blurb: 'Into nudge_queue, status proposed', kind: 'write' },
            { name: 'skip', blurb: 'Decline with a reason', kind: 'write' },
        ],
        ordersFile: 'server/agents/recovery.ts (SYSTEM)',
    },
    {
        id: 'verifier', agent: 'verifier', name: 'Verifier', roleTitle: 'The Auditor — the morning sample',
        tier: 'READ', accent: 'sky', model: 'claude-opus-5',
        cadence: '08:30 Europe/London sampler (spine.sampler); judges yesterday\'s automatic sends',
        mission: 'Keeps autonomy honest once an intent is at SEND and Ben stops seeing it. Samples 10% of automatic sends (and every flagged one) into a one-tap strip on /admin/comms and scores each with the move-quality rubric. Any unsafe verdict demotes the intent to DRAFT.',
        autonomy: {
            freely: ['Pick the sample', 'Score a send (moveRight / voiceRight / unsafe)'],
            approval: ['Its scores are advisory until calibrated ≥ 85% against Ben (scripts/_judge-agreement.ts)'],
            never: ['Propose or send anything', 'Change a tier itself — the autonomy job does that from its verdicts'],
        },
        tools: [
            { name: 'selectSamples', blurb: 'server/spine/sampler.ts — random 10%, clamped, plus flagged', kind: 'read' },
            { name: 'judgeSend', blurb: 'move-quality-v1 on Opus 5, zod-validated', kind: 'read' },
            { name: 'voice-v1', blurb: 'server/spine/judge.ts — does it read like Ben (advisory)', kind: 'read' },
        ],
    },
    {
        id: 'contractor-liaison', agent: 'contractor_liaison', name: 'Contractor liaison', roleTitle: 'The Office — talks to our tradespeople',
        tier: 'DRAFT', accent: 'amber', model: 'claude-sonnet-5',
        cadence: 'On inbound from a contractor-profile number (needs real phones on the 8 contractor users)',
        mission: 'Job briefs, availability asks, confirming receipt of photos and notes, materials lists — to OUR contractors, never to a customer. Reads their assigned bookings reduced to postcode, first name and the work. Speaks as the office, not as Ben.',
        autonomy: {
            freely: ['Propose one message per run in the four intents', 'Flag a complaint, a safety worry or money owed to Ben'],
            approval: ['Every message (DRAFT)'],
            never: ['Put a customer\'s phone, email, or full name with a street address in a message — refused at the tool', 'Quote the customer\'s price', 'Talk to a customer'],
        },
        tools: [
            { name: 'propose_reply', blurb: 'job_brief / availability_ask / confirm_receipt / materials_list; customer_pii + voice at the tool', kind: 'gated' },
            { name: 'flag', blurb: 'Hand to Ben with a note', kind: 'write' },
        ],
        ordersFile: 'server/spine/agents/contractor-liaison.ts (LIAISON_CORE)',
    },
    {
        id: 'vision', agent: 'vision', name: 'Vision', roleTitle: 'The Eyes — describe_video',
        tier: 'READ', accent: 'sky', model: 'gemini-2.5-flash (direct)',
        cadence: 'While a case file is built, newest videos first (spine.video, max per run)',
        mission: 'Turns a customer\'s video into a fixed-schema description on the case file — what is shown, what is missing, defects with severity, any text seen — so the Scoper and the clerk can read a clip. Cached by file hash; a clip is described once.',
        autonomy: {
            freely: ['Describe a video or (if enabled) a photo on the case file'],
            approval: ['Nothing to approve: it writes descriptions, not messages'],
            never: ['Message anyone', 'Guess: an off-schema answer is retried once, then dropped'],
        },
        tools: [
            { name: 'describeMedia', blurb: 'server/spine/tools/describe-video.ts — Gemini 2.5 Flash, native bytes, zod schema, cache', kind: 'read' },
        ],
    },
];

export function spineStaffById(id: string): StaffCard | undefined {
    return SPINE_STAFF.find((s) => s.id === id);
}
