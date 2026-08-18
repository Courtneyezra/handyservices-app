/**
 * The Comms Agent — triage officer and drafting clerk for /admin/comms. Never the sender.
 *
 * Its constitution is the platform's locked rule: nothing reaches a customer without approval.
 * The agent reads a thread (messages, calls, webforms — the merged timeline), then does at most
 * three kinds of work:
 *
 *   1. TRIAGE  — set stage/priority/tags on the board (reversible, internal → autonomous).
 *   2. DRAFT   — write the reply into message_drafts, where Ben approves/edits/rejects it.
 *   3. ASK     — when it cannot safely draft (dates we may not do, money not covered by a
 *                quote), it raises an agent_questions row with tappable options. Ben's answer
 *                feeds the next run. Asking is its ONLY alternative to drafting — it never
 *                guesses and never goes silent.
 *
 * Money guard: any draft containing a £ figure must cite the quote it came from, or the tool
 * refuses and tells the agent to ask instead. Prices come from quotes, never from the model.
 *
 * Phase 3 (auto-send) is a config-gated exception: intents on an explicit whitelist can be
 * auto-approved through the SAME approveAndSendDraft path a human uses — logged, visible in the
 * thread, and OFF by default.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { db } from '../db';
import { conversations, messages, calls, personalizedQuotes, quickReplies, appSettings, messageDrafts, agentQuestions } from '@shared/schema';
import { eq, ne, desc, and, inArray, sql } from 'drizzle-orm';
import { runAgent, type AgentTool, type AgentRunResult } from './runner';
import { buildMediaBlocks } from './media-context';
import { queueDraft, approveAndSendDraft } from '../message-drafts';
import { askBen, markQuestionResolved } from '../agent-questions';
import { canSendFreeform } from '../meta-whatsapp';
import { computeWaitState, DEFAULT_SLA_WORKING_HOURS } from '../comms-sla';
import { loadActivity } from '../inbox-board';
import {
    isFirstContact, FIRST_CONTACT_ACK_INTENTS, DEFAULT_FIRST_CONTACT_ACK,
    type FirstContactAckConfig, type FirstContactChannel,
} from '../first-contact-ack';

// ---------------------------------------------------------------- config

export interface CommsAgentConfig {
    /** Master switch for anything auto-triggered (sweeps + on-inbound). Scripts can still run it manually. */
    enabled: boolean;
    /** Max conversations one sweep will process — bounds cost per run. */
    sweepLimit: number;
    /** The instant lane: triage a thread shortly after a customer message arrives. */
    onInbound: boolean;
    /** How long after the LAST inbound to run — lets a burst of messages finish first. */
    inboundDebounceMinutes: number;
    autosend: {
        enabled: boolean;
        /** Intents allowed to skip human approval. Keep this to content-free acknowledgements. */
        intents: string[];
    };
    /**
     * The first-contact exception (server/first-contact-ack.ts): a number we have NEVER messaged
     * may be acknowledged without approval, 24/7. Everything else keeps the gate.
     */
    firstContactAutoAck: FirstContactAckConfig;
}

const SETTING_KEY = 'comms_agent';
const DEFAULT_CONFIG: CommsAgentConfig = {
    enabled: false,
    sweepLimit: 5,
    onInbound: true,
    inboundDebounceMinutes: 10,
    autosend: { enabled: false, intents: [] },
    firstContactAutoAck: DEFAULT_FIRST_CONTACT_ACK,
};

export async function getCommsAgentConfig(): Promise<CommsAgentConfig> {
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY));
        if (!row) return DEFAULT_CONFIG;
        const stored = row.value as Partial<CommsAgentConfig>;
        return {
            ...DEFAULT_CONFIG, ...stored,
            autosend: { ...DEFAULT_CONFIG.autosend, ...(stored.autosend ?? {}) },
            firstContactAutoAck: { ...DEFAULT_FIRST_CONTACT_ACK, ...(stored.firstContactAutoAck ?? {}) },
        };
    } catch (error) {
        console.error('[CommsAgent] Could not read config, treating as disabled:', error);
        return { ...DEFAULT_CONFIG, enabled: false }; // Fail closed.
    }
}

export async function setCommsAgentConfig(patch: Partial<CommsAgentConfig>): Promise<CommsAgentConfig> {
    const current = await getCommsAgentConfig();
    const next: CommsAgentConfig = {
        ...current,
        ...patch,
        autosend: { ...current.autosend, ...(patch.autosend ?? {}) },
        firstContactAutoAck: { ...current.firstContactAutoAck, ...(patch.firstContactAutoAck ?? {}) },
    };
    await db.insert(appSettings)
        .values({
            id: SETTING_KEY, key: SETTING_KEY, value: next,
            description: 'Comms triage/drafting agent (see server/agents/comms.ts)',
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
    return next;
}

// ---------------------------------------------------------------- intents

/** Fixed vocabulary so the whitelist is checkable. 'other' is deliberately never whitelistable. */
export const DRAFT_INTENTS = [
    'ack_photos',       // "got your photos, quote coming"
    'ack_enquiry',      // "got your message, we'll come back to you"
    'ack_missed_call',  // "sorry we missed your call, we'll ring you back"
    'chase_response',   // we asked them something and they went quiet
    'scheduling',       // date/time coordination already agreed in the thread
    'quote_followup',   // nudging a sent quote, price already quoted
    'answer_question',  // answering a factual question about their job
    'other',
] as const;

const MONEY_RE = /£\s*\d|(?:\b\d+(?:\.\d+)?\s*(?:pounds|quid)\b)/i;

// ---------------------------------------------------------------- per-conversation run

export interface CommsAgentOutcome {
    conversationId: string;
    result: AgentRunResult;
    /** What actually got written, parsed from the transcript — the audit summary. */
    actions: { tool: string; input: any }[];
    autosent: boolean;
}

export async function runCommsAgent(conversationId: string, trigger: string): Promise<CommsAgentOutcome> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) throw new Error(`Conversation ${conversationId} not found`);

    const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
    if (!digits) throw new Error(`Conversation ${conversationId} has no usable phone number`);
    const e164 = `+${digits}`;

    const config = await getCommsAgentConfig();
    let autosent = false;
    // The model sometimes queues part 1 and then the full reply. Instead of punishing that with
    // a dedupe error (which strands the fragment), a repeat queue_draft in the SAME run
    // supersedes the earlier one — the final call always wins.
    let draftedThisRun: string | null = null;

    /** Which surface this customer last came in on — the first-contact config is per channel. */
    const inboundChannel = async (): Promise<FirstContactChannel> => {
        const [last] = await db.select({ channel: messages.channel }).from(messages)
            .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'inbound')))
            .orderBy(desc(messages.createdAt)).limit(1);
        // 'call' rows are written by server/call-thread.ts; the first-contact config calls that
        // surface 'post_call', so a caller is gated by the post_call switch, not the WhatsApp one.
        if (last?.channel === 'sms') return 'sms';
        if (last?.channel === 'call') return 'post_call';
        return 'whatsapp';
    };

    // ---- tools ----

    const tools: AgentTool[] = [
        {
            name: 'get_thread',
            description: 'Read the merged timeline for this conversation: WhatsApp/SMS/webform messages AND phone calls (with transcripts), newest last — including the customer\'s actual photos and video keyframes, which are part of the conversation and often say more than the text. Also returns board state, the 24h WhatsApp window, SLA wait state, and any answered ask-Ben questions you should act on. Call this FIRST, always.',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
            run: async () => {
                const recent = await db.select().from(messages)
                    .where(eq(messages.conversationId, conv.id))
                    .orderBy(desc(messages.createdAt)).limit(30);

                const callRows = await db.select().from(calls)
                    .where(sql`regexp_replace(${calls.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`)
                    .orderBy(desc(calls.startTime)).limit(10);

                const timeline = [
                    // Calls are on this thread twice by design: a summary row in `messages` (so the
                    // board can see them) and the full record below. Drop the summary and keep the
                    // record, which carries the transcript.
                    ...recent.filter((m) => m.channel !== 'call').map((m) => ({
                        kind: 'message', at: m.createdAt?.toISOString(), direction: m.direction,
                        channel: m.channel, content: (m.content ?? '').slice(0, 400),
                        hasMedia: !!m.mediaUrl, status: m.status,
                    })),
                    ...callRows.map((c) => ({
                        kind: 'call', at: c.startTime?.toISOString(), direction: c.direction,
                        durationSeconds: c.duration, outcome: c.outcome,
                        summary: c.jobSummary ?? null,
                        transcriptExcerpt: c.transcription ? c.transcription.slice(0, 800) : null,
                    })),
                ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

                const windowOpen = await canSendFreeform(e164).catch(() => false);
                const activity = await loadActivity([conv.id]);
                const act = activity.get(conv.id);
                const wait = computeWaitState(act?.lastInbound ?? null, act?.lastOutbound ?? null);

                const answered = await db.select().from(agentQuestions)
                    .where(and(eq(agentQuestions.conversationId, conv.id), eq(agentQuestions.status, 'answered')));

                const [pendingDraft] = await db.select({ id: messageDrafts.id, body: messageDrafts.body })
                    .from(messageDrafts)
                    .where(and(eq(messageDrafts.phone, e164), eq(messageDrafts.status, 'pending')))
                    .limit(1);

                const data = {
                    contactName: conv.contactName, phone: e164,
                    stage: conv.stage, priority: conv.priority, tags: conv.tags ?? [],
                    whatsappWindowOpen: windowOpen,
                    slaState: wait,
                    slaWorkingHours: DEFAULT_SLA_WORKING_HOURS,
                    answeredQuestions: answered.map((q) => ({
                        id: q.id, question: q.question, bensAnswer: q.answer,
                        note: 'Draft from this answer, then call resolve_question with this id.',
                    })),
                    existingPendingDraft: pendingDraft ?? null,
                    timeline,
                };

                // The customer's photos and videos ARE the conversation — embed them so the
                // agent reasons from what it can see, not from "hasMedia: true".
                const mediaBlocks = await buildMediaBlocks(
                    recent.filter((m) => m.mediaUrl).reverse().map((m) => ({
                        mediaUrl: m.mediaUrl!,
                        mediaType: m.mediaType,
                        direction: m.direction,
                        createdAt: m.createdAt as any,
                        content: m.content,
                    })),
                );
                return mediaBlocks.length ? { data, mediaBlocks } : data;
            },
        },
        {
            name: 'get_customer_context',
            description: 'Look up this customer across the CRM: their quotes (with REAL prices — the only prices you may ever reference), whether they viewed/paid, and expiry. Call before drafting anything that touches money, scope or job status.',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
            run: async () => {
                const quotes = await db.select({
                    slug: personalizedQuotes.shortSlug,
                    customerName: personalizedQuotes.customerName,
                    jobDescription: personalizedQuotes.jobDescription,
                    basePrice: personalizedQuotes.basePrice,
                    selectedTierPricePence: personalizedQuotes.selectedTierPricePence,
                    depositPaidAt: personalizedQuotes.depositPaidAt,
                    viewedAt: personalizedQuotes.viewedAt,
                    expiresAt: personalizedQuotes.expiresAt,
                    createdAt: personalizedQuotes.createdAt,
                }).from(personalizedQuotes)
                    .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${digits}`)
                    .orderBy(desc(personalizedQuotes.createdAt)).limit(5);

                return {
                    quotes: quotes.map((q) => ({
                        slug: q.slug,
                        job: (q.jobDescription ?? '').slice(0, 250),
                        priceGBP: q.selectedTierPricePence != null ? q.selectedTierPricePence / 100
                                : q.basePrice != null ? q.basePrice / 100 : null,
                        depositPaid: !!q.depositPaidAt,
                        viewed: !!q.viewedAt,
                        expiresAt: q.expiresAt, createdAt: q.createdAt,
                    })),
                    note: quotes.length === 0 ? 'No quotes for this number — do NOT mention any price.' : undefined,
                };
            },
        },
        {
            name: 'get_quick_replies',
            description: 'The approved canned replies. Prefer adapting one of these over free-writing — they carry the house voice.',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
            run: async () => {
                const rows = await db.select({ label: quickReplies.label, body: quickReplies.body })
                    .from(quickReplies).where(eq(quickReplies.isActive, true)).limit(20);
                return rows;
            },
        },
        {
            name: 'set_board_state',
            description: 'Triage: move the conversation on the FUNNEL board and/or tag it. Reversible and internal, so use it freely. Stages: enquiry (new and unanswered, SLA clock running), scoping (in conversation, gathering what a quote needs), quote_sent (a live quote is out — the system sets this on send; only set it yourself when the thread proves a quote went out), won (deposit paid — the payment webhook sets this, never set it on a hunch), closed (dead, spam or done).',
            input_schema: {
                type: 'object' as const,
                properties: {
                    stage: { type: 'string', enum: ['enquiry', 'scoping', 'quote_sent', 'won', 'closed'] },
                    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                    add_tags: { type: 'array', items: { type: 'string' }, description: 'Short lowercase labels, e.g. ["needs_quote","photos_received"]' },
                },
                required: [],
            },
            run: async (input: { stage?: string; priority?: string; add_tags?: string[] }) => {
                const patch: any = { updatedAt: new Date() };
                if (input.stage) patch.stage = input.stage;
                if (input.priority) patch.priority = input.priority;
                if (input.add_tags?.length) {
                    const merged = [...new Set([...(conv.tags ?? []), ...input.add_tags.map((t) => t.toLowerCase().slice(0, 30))])];
                    patch.tags = merged;
                }
                await db.update(conversations).set(patch).where(eq(conversations.id, conv.id));
                return { updated: Object.keys(patch).filter((k) => k !== 'updatedAt') };
            },
        },
        {
            name: 'queue_draft',
            description: 'Draft the COMPLETE reply — every bubble of it in this one body, parts separated by "---" lines. It goes to Ben\'s approval queue; it does NOT send. This is NOT a per-message send button: one call carries the whole reply. If you call it again, your new body REPLACES the previous draft entirely (the latest call wins), so a repeat call must also contain the complete reply. HARD RULE: if the body mentions any price or £ figure it must have a source: pass quote_slug for a quoted price, or price_source="ben_answer" when the figure comes from Ben\'s answer to an ask_ben question. If neither covers it, use ask_ben instead. Never invent prices, dates or promises.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    body: { type: 'string', description: 'The reply as it would be sent. Write like a person texts on WhatsApp: 2-3 SHORT messages, each on its own, separated by a line containing only "---". Each part lands as a separate bubble a moment apart. Warm, brief, UK English, no corporate filler.' },
                    reason: { type: 'string', description: 'One line for the approver: why this reply, why now.' },
                    intent: { type: 'string', enum: [...DRAFT_INTENTS] },
                    quote_slug: { type: 'string', description: 'Cite when a price in the body comes from a quote.' },
                    price_source: { type: 'string', enum: ['quote', 'ben_answer'], description: 'Where any £ figure comes from. "ben_answer" = Ben stated it in his answer to your question.' },
                },
                required: ['body', 'reason', 'intent'],
            },
            run: async (input: { body: string; reason: string; intent: string; quote_slug?: string; price_source?: string }) => {
                // Money guard: a £ in the body must trace to a source a human controls — a real
                // quote for this customer, or a figure Ben himself gave in an answered question.
                // The one thing that can never happen is the model inventing a number.
                if (MONEY_RE.test(input.body)) {
                    if (input.quote_slug) {
                        const [q] = await db.select({ slug: personalizedQuotes.shortSlug })
                            .from(personalizedQuotes)
                            .where(and(
                                eq(personalizedQuotes.shortSlug, input.quote_slug),
                                sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${digits}`,
                            ));
                        if (!q) {
                            throw new Error(`Quote ${input.quote_slug} does not exist for this customer. Use ask_ben instead of guessing.`);
                        }
                    } else if (input.price_source === 'ben_answer') {
                        const answered = await db.select({ answer: agentQuestions.answer })
                            .from(agentQuestions)
                            .where(and(
                                eq(agentQuestions.conversationId, conv.id),
                                inArray(agentQuestions.status, ['answered', 'resolved']),
                            ));
                        const benGaveMoney = answered.some((q) => q.answer && MONEY_RE.test(q.answer));
                        if (!benGaveMoney) {
                            throw new Error('price_source is "ben_answer" but no answered question from Ben contains a price for this conversation. Use ask_ben.');
                        }
                    } else {
                        throw new Error('Draft mentions money with no source. Cite quote_slug, or price_source="ben_answer" if Ben stated the figure, or use ask_ben — never invent a price.');
                    }
                }

                if (draftedThisRun) {
                    await db.update(messageDrafts)
                        .set({ status: 'rejected', approvedBy: 'comms_agent:superseded', approvedAt: new Date() })
                        .where(and(eq(messageDrafts.id, draftedThisRun), eq(messageDrafts.status, 'pending')));
                }
                const id = await queueDraft({
                    phone: e164,
                    body: input.body,
                    source: 'comms_agent',
                    reason: `[${input.intent}] ${input.reason}${input.quote_slug ? ` (quote ${input.quote_slug})` : ''}`,
                });
                if (!id) return { queued: false, note: 'A pending comms_agent draft already exists for this customer.' };
                const superseded = draftedThisRun;
                draftedThisRun = id;

                // Phase 3: whitelisted intents may auto-send — same claimed-row path a human uses.
                // Guarded by config (off by default), the intent whitelist, and UK daytime hours.
                const ukHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(new Date()));
                const whitelisted = config.autosend.enabled && input.intent !== 'other'
                    && config.autosend.intents.includes(input.intent) && ukHour >= 8 && ukHour < 20;

                // The first-contact exception: an acknowledgement to a number we have never
                // messaged may go out round the clock, so the 8-20 guard above is skipped — but
                // ONLY here, and only after the same hard server-side first-contact check the
                // deterministic responder uses. Normally the inbound lane has already acked and
                // this is false by the time the agent runs; this covers the case where it did not
                // (process restart, feature switched on mid-thread).
                const firstContactOk = config.firstContactAutoAck.enabled
                    && (FIRST_CONTACT_ACK_INTENTS as readonly string[]).includes(input.intent)
                    && config.firstContactAutoAck.channels.includes(await inboundChannel())
                    && await isFirstContact({ conversationId: conv.id, phone: e164 });

                if (whitelisted || firstContactOk) {
                    const by = firstContactOk && !whitelisted ? 'comms_agent:first_contact_ack' : 'comms_agent:autosend';
                    const sent = await approveAndSendDraft(id, by);
                    if (sent.ok) {
                        autosent = true;
                        return {
                            queued: true, draftId: id, autosent: true,
                            note: firstContactOk && !whitelisted
                                ? 'First contact with this number — acknowledged immediately.'
                                : 'Intent is whitelisted — sent immediately.',
                        };
                    }
                    return { queued: true, draftId: id, autosent: false, note: `Auto-send refused (${sent.code}); left for Ben to approve.` };
                }

                return {
                    queued: true, draftId: id, autosent: false,
                    ...(superseded ? { note: 'Replaced your earlier draft from this run — this complete version is the one Ben will see.' } : {}),
                };
            },
        },
        {
            name: 'ask_ben',
            description: 'Raise a decision to Ben when you cannot safely draft: pricing not covered by a quote, dates/availability you cannot verify, complaints, anything where a wrong guess costs money or trust. Give 2-4 short tappable options. One open question per conversation.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    question: { type: 'string', description: 'The decision, in one sentence.' },
                    context: { type: 'string', description: 'Why you are asking — what the customer said, what is at stake.' },
                    options: { type: 'array', items: { type: 'string' }, description: '2-4 short answers Ben can tap.' },
                },
                required: ['question'],
            },
            run: async (input: { question: string; context?: string; options?: string[] }) => {
                const id = await askBen({
                    conversationId: conv.id, phone: e164,
                    question: input.question, context: input.context,
                    options: input.options?.slice(0, 4),
                });
                if (!id) return { asked: false, note: 'An open question already exists for this conversation.' };
                return { asked: true, questionId: id };
            },
        },
        {
            name: 'resolve_question',
            description: 'Mark an answered ask-Ben question as consumed AFTER you have drafted from its answer.',
            input_schema: {
                type: 'object' as const,
                properties: { question_id: { type: 'string' } },
                required: ['question_id'],
            },
            run: async (input: { question_id: string }) => {
                await markQuestionResolved(input.question_id);
                return { resolved: input.question_id };
            },
        },
    ];

    const system = SYSTEM;

    const result = await runAgent({
        name: 'comms',
        system,
        goal: `Triage conversation ${conv.id} (customer: ${conv.contactName || e164}). Trigger: ${trigger}.`,
        tools,
        model: 'claude-sonnet-5',
        maxTurns: 10,
        maxTokens: 4000,
    });

    const actions = result.transcript
        .filter((e) => e.type === 'tool_call' && ['set_board_state', 'queue_draft', 'ask_ben', 'resolve_question'].includes(e.detail.tool))
        .map((e) => ({ tool: e.detail.tool, input: e.detail.input }));

    return { conversationId: conv.id, result, actions, autosent };
}

/**
 * The brand voice for 1:1 chat, loaded from brand-voice/whatsapp-comms.md so the voice is
 * editable without touching code (and visible verbatim on the staff page). The fallback keeps
 * the agent safe-sounding if the file is ever missing in a deploy.
 */
function loadVoice(): string {
    try {
        return readFileSync(path.join(process.cwd(), 'brand-voice/whatsapp-comms.md'), 'utf8');
    } catch {
        return 'VOICE: friendly Nottingham tradesperson texting back. Short, plain, warm. No em dashes. No sign-offs. One question max. Never ask for a full address, postcode only when needed for pricing.';
    }
}

export const SYSTEM = `You are the comms triage agent for Handy Services, a Nottingham handyman company.
Ben (the VA) works the /admin/comms board; your job is to make his 4-working-hour SLA achievable.

For the conversation you are given, do this and nothing more:
1. Read the thread (get_thread). Understand what the customer needs RIGHT NOW.
2. Triage: set stage/priority/tags to match reality (set_board_state).

The board is a SALES FUNNEL, worked left to right. Its stages mean exactly this:
- enquiry: new and unanswered. The SLA clock is running; still worth winning.
- scoping: we are in conversation, gathering what a quote needs (job, photos, postcode).
- quote_sent: a live quote is out and being chased. The system sets this when a quote
  sends; move a thread here yourself only when the thread proves a quote went out.
- won: deposit paid. The payment webhook sets this. Never set won on a hunch.
- closed: dead, spam, or done.
An enquiry stays an enquiry until WE reply; our first reply moves it to scoping.
Never demote quote_sent or won just because messages are flowing.
3. Then exactly ONE of:
   a. queue_draft — when a good reply is safely writable from what you know.
   b. ask_ben    — when drafting would require guessing about money, dates, scope or a complaint.
   c. Nothing    — when no response is needed (we already replied and the ball is with the customer,
      or the thread is spam/dead). Say NO_ACTION and why.

If get_thread shows answeredQuestions, that is Ben instructing you: draft from his answer now,
then resolve_question. If it shows an existingPendingDraft, do NOT draft again — triage only.

get_thread includes the customer's actual photos and video keyframes. LOOK at them — they are
part of the conversation and usually say more than the text. Use what you can see to triage
accurately, and reference specifics in drafts ("the D-shape seat in your photo") — concrete
detail is how a customer knows they're dealing with people who do this every day. Never claim
to see something you can't, and never diagnose beyond what a photo can actually show.

Your trigger tells you why you were called, and it changes the emphasis:
- inbound_message: the customer just wrote. Respond to what they actually need right now.
- sla_sweep / window_closing: they've been waiting (window_closing = the 24h freeform window
  shuts within hours — if a reply is warranted at all, draft it NOW, before we're template-only).
- backlog_revival: a long-dead thread. Be decisive: obviously dead or spam → stage=closed with a
  tag saying why; genuinely worth reviving → tag revive_candidate and ask_ben how to approach it;
  draft only if the window is somehow open. Do not draft into a shut window.

HARD RULES — these are not preferences:
- You never send anything. Drafts go to approval. That is the design, not a limitation.
- Prices come ONLY from quotes (cite quote_slug) or from Ben's explicit answer to your question
  (price_source="ben_answer"). You never originate a number yourself. No source → ask_ben.
- Never promise dates, times or availability that the thread does not already confirm.
- Complaints and angry customers: triage to priority=urgent and ask_ben. Do not draft apologies with commitments.
- NEVER ask for a full address. Postcode only, and only when needed to price or route. The full
  address is collected at booking, not at enquiry.
- NO em dashes or hyphens-as-punctuation in anything the customer will read. Comma, full stop,
  or a new message part instead.
- FORMAT mechanics: split the reply into 2-3 short message parts separated by a line containing
  only "---" (each part lands as its own WhatsApp bubble). queue_draft carries the WHOLE reply in
  one body — it is not a per-message send button. If you realise the draft is incomplete or
  wrong, call queue_draft again with the full corrected reply; the latest call replaces it.

VOICE — how everything customer-facing must sound (follow this to the letter):
${loadVoice()}

Finish with one line: what you did and why. Be terse.`;

/** Staff-directory card — lives beside the agent so the /admin/staff page can't drift from reality. */
export const STAFF = {
    id: 'comms',
    name: 'Comms',
    roleTitle: 'Triage Officer & Drafting Clerk',
    mission: 'Reads every thread (messages + call transcripts), keeps the Kanban board honest, and makes Ben\'s 4-working-hour SLA achievable: draft a reply, ask Ben a structured question, or justify doing nothing.',
    model: 'claude-sonnet-5',
    cadence: 'On new inbound (debounced ~10 min) · SLA sweep every 30 min working hours · window-closing sweep hourly · all gated on one switch',
    autonomy: {
        freely: ['Move cards, set priority, add tags on the board', 'Read threads, quotes and call transcripts'],
        approval: [
            'Every reply — drafted into message_drafts for Ben',
            'Whitelisted acks may auto-send ONLY when the autosend gate is on (ships off), UK 8-20',
            'FIRST contact only (a number we have never messaged) may be acknowledged automatically, 24/7, content-free — the one sanctioned exception (ships off)',
        ],
        never: ['Originate a price — £ figures must cite a quote or Ben\'s own answer', 'Promise unconfirmed dates or availability', 'Draft apology commitments on complaints (urgent + ask Ben instead)'],
    },
    tools: [
        { name: 'get_thread', blurb: 'Merged timeline incl. the customer\'s actual photos + video keyframes, calls w/ transcripts, window + SLA state', kind: 'read' },
        { name: 'get_customer_context', blurb: 'The customer\'s quotes with real prices — the only allowed price source', kind: 'read' },
        { name: 'get_quick_replies', blurb: 'House-voice canned replies to adapt', kind: 'read' },
        { name: 'set_board_state', blurb: 'Stage / priority / tags — the autonomous tier', kind: 'write' },
        { name: 'queue_draft', blurb: 'Draft to approval queue (money guard + gated auto-send live here)', kind: 'gated' },
        { name: 'ask_ben', blurb: 'Structured question with tappable options', kind: 'write' },
        { name: 'resolve_question', blurb: 'Marks Ben\'s answer consumed after drafting from it', kind: 'write' },
    ],
} as const;

// ---------------------------------------------------------------- Phase 2: SLA sweep

export interface SweepOutcome {
    scanned: number;
    eligible: number;
    processed: CommsAgentOutcome[];
    skipped: { conversationId: string; why: string }[];
}

/** A thread with a pending draft or open question is already on Ben's desk — leave it alone. */
async function hasPendingAgentWork(conversationId: string, digits: string): Promise<string | null> {
    const [draft] = await db.select({ id: messageDrafts.id }).from(messageDrafts)
        .where(and(eq(messageDrafts.phone, `+${digits}`), inArray(messageDrafts.status, ['pending', 'approved'])))
        .limit(1);
    if (draft) return 'pending draft exists';
    const [question] = await db.select({ id: agentQuestions.id }).from(agentQuestions)
        .where(and(eq(agentQuestions.conversationId, conversationId), inArray(agentQuestions.status, ['open', 'answered'])))
        .limit(1);
    if (question) return 'open question exists';
    return null;
}

/**
 * The safety net for "nothing gets missed": every conversation whose SLA clock is running
 * (due or breached) ends the sweep with either a pending draft or an open question for Ben.
 *
 * Guardrail ladder per conversation, cheapest checks first; the LLM only runs on survivors.
 */
export async function sweepCommsAgent(opts: { limit?: number; dryRun?: boolean } = {}): Promise<SweepOutcome> {
    const config = await getCommsAgentConfig();
    const limit = opts.limit ?? config.sweepLimit;

    // Candidate pool: open conversations, most recently active first. 300 mirrors the board.
    const convs = await db.select().from(conversations)
        .where(ne(conversations.status, 'blocked'))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(300);

    const activity = await loadActivity(convs.map((c) => c.id));
    const skipped: SweepOutcome['skipped'] = [];
    const eligible: typeof convs = [];

    for (const conv of convs) {
        const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        if (!digits) { skipped.push({ conversationId: conv.id, why: 'no usable phone' }); continue; }
        if (conv.stage === 'closed') { skipped.push({ conversationId: conv.id, why: 'closed' }); continue; }

        const act = activity.get(conv.id);
        const wait = computeWaitState(act?.lastInbound ?? null, act?.lastOutbound ?? null);
        if (!wait.awaitingReply || (wait.severity !== 'due' && wait.severity !== 'breached')) continue;

        // Already has agent work parked on it → the human is the bottleneck, not us.
        const parked = await hasPendingAgentWork(conv.id, digits);
        if (parked) { skipped.push({ conversationId: conv.id, why: parked }); continue; }

        eligible.push(conv);
    }

    const toProcess = eligible.slice(0, limit);
    const processed: CommsAgentOutcome[] = [];

    if (!opts.dryRun) {
        // Sequential on purpose: bounded cost, readable logs, no racing tool writes.
        for (const conv of toProcess) {
            try {
                processed.push(await runCommsAgent(conv.id, 'sla_sweep'));
            } catch (error: any) {
                console.error(`[CommsAgent] Sweep run failed for ${conv.id}:`, error?.message);
                skipped.push({ conversationId: conv.id, why: `run failed: ${error?.message}` });
            }
        }
    }

    return { scanned: convs.length, eligible: eligible.length, processed, skipped };
}

// ---------------------------------------------------------------- window-closing lane

/**
 * The perishable-asset lane: WhatsApp's 24h freeform window is the only time we can reply
 * without a template, and it shuts silently. This sweep finds windows closing within
 * `hoursLeft` where the customer is still waiting on us and nothing is parked with Ben,
 * and runs the worker so a draft exists BEFORE the window dies.
 */
export async function windowClosingSweep(opts: { hoursLeft?: number; dryRun?: boolean } = {}): Promise<SweepOutcome> {
    const config = await getCommsAgentConfig();
    const hoursLeft = opts.hoursLeft ?? 4;

    // Window = lastInboundAt + 24h (WhatsApp inbound only — the column is WhatsApp-semantics).
    const convs = await db.select().from(conversations)
        .where(and(
            ne(conversations.status, 'blocked'),
            ne(conversations.stage, 'closed'),
            sql`${conversations.lastInboundAt} > now() - interval '24 hours'`,
            sql`${conversations.lastInboundAt} <= now() - (interval '24 hours' - ${`${hoursLeft} hours`}::interval)`,
        ))
        .orderBy(desc(conversations.lastInboundAt))
        .limit(50);

    const activity = await loadActivity(convs.map((c) => c.id));
    const skipped: SweepOutcome['skipped'] = [];
    const eligible: typeof convs = [];

    for (const conv of convs) {
        const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        if (!digits) { skipped.push({ conversationId: conv.id, why: 'no usable phone' }); continue; }
        if (digits.includes('7700900')) { skipped.push({ conversationId: conv.id, why: 'test number' }); continue; }

        const act = activity.get(conv.id);
        const wait = computeWaitState(act?.lastInbound ?? null, act?.lastOutbound ?? null);
        if (!wait.awaitingReply) continue; // we've already replied inside the window

        const parked = await hasPendingAgentWork(conv.id, digits);
        if (parked) { skipped.push({ conversationId: conv.id, why: parked }); continue; }

        eligible.push(conv);
    }

    const toProcess = eligible.slice(0, config.sweepLimit);
    const processed: CommsAgentOutcome[] = [];
    if (!opts.dryRun) {
        for (const conv of toProcess) {
            try {
                processed.push(await runCommsAgent(conv.id, 'window_closing'));
            } catch (error: any) {
                console.error(`[CommsAgent] Window sweep failed for ${conv.id}:`, error?.message);
                skipped.push({ conversationId: conv.id, why: `run failed: ${error?.message}` });
            }
        }
    }
    return { scanned: convs.length, eligible: eligible.length, processed, skipped };
}

// ---------------------------------------------------------------- backlog / ageing lane

export interface BacklogSweepOutcome extends SweepOutcome {
    /** Action tallies parsed from the runs — the "what happened" line for logs. */
    tallies: { closed: number; reviveCandidates: number; drafts: number; questions: number };
    /** The eligible conversations, for --dry-run listings. */
    eligibleConversations: { id: string; phoneNumber: string; lastCustomerContactAt: Date | null; preview: string }[];
}

/**
 * The ageing lane: enquiries nobody answered for `olderThanDays` get auto-triaged with the
 * backlog_revival trigger — obviously dead/spam threads are closed with a reason tag, genuine
 * leads get tagged revive_candidate plus an ask-Ben on how to approach them. The SLA sweep owns
 * anything fresher. Runs weekly from cron (same comms_agent.enabled gate) and manually via
 * scripts/comms-backlog-pass.ts.
 */
export async function backlogSweep(opts: { olderThanDays?: number; limit?: number; dryRun?: boolean } = {}): Promise<BacklogSweepOutcome> {
    const olderThanDays = opts.olderThanDays ?? 21;
    const limit = opts.limit ?? 10;

    const convs = await db.select().from(conversations)
        .where(and(
            ne(conversations.status, 'blocked'),
            ne(conversations.stage, 'closed'),
            // Won threads age off the board via the auto-archive lane, not revival triage.
            ne(conversations.stage, 'won'),
            sql`${conversations.lastCustomerContactAt} < now() - make_interval(days => ${olderThanDays})`,
        ))
        .orderBy(desc(conversations.lastCustomerContactAt))
        .limit(300);

    const activity = await loadActivity(convs.map((c) => c.id));
    const skipped: SweepOutcome['skipped'] = [];
    const eligible: typeof convs = [];

    for (const conv of convs) {
        const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
        if (!digits || digits.includes('7700900')) continue; // unusable or Ofcom test range

        const act = activity.get(conv.id);
        const wait = computeWaitState(act?.lastInbound ?? null, act?.lastOutbound ?? null);
        if (!wait.awaitingReply) continue;

        const parked = await hasPendingAgentWork(conv.id, digits);
        if (parked) { skipped.push({ conversationId: conv.id, why: parked }); continue; }

        eligible.push(conv);
    }

    const processed: CommsAgentOutcome[] = [];
    const tallies = { closed: 0, reviveCandidates: 0, drafts: 0, questions: 0 };

    if (!opts.dryRun) {
        for (const conv of eligible.slice(0, limit)) {
            try {
                const outcome = await runCommsAgent(conv.id, 'backlog_revival');
                processed.push(outcome);
                for (const a of outcome.actions) {
                    if (a.tool === 'set_board_state' && a.input?.stage === 'closed') tallies.closed++;
                    if (a.tool === 'set_board_state' && (a.input?.add_tags ?? []).includes('revive_candidate')) tallies.reviveCandidates++;
                    if (a.tool === 'queue_draft') tallies.drafts++;
                    if (a.tool === 'ask_ben') tallies.questions++;
                }
            } catch (error: any) {
                console.error(`[CommsAgent] Backlog run failed for ${conv.id}:`, error?.message);
                skipped.push({ conversationId: conv.id, why: `run failed: ${error?.message}` });
            }
        }
    }

    return {
        scanned: convs.length,
        eligible: eligible.length,
        processed,
        skipped,
        tallies,
        eligibleConversations: eligible.map((c) => ({
            id: c.id,
            phoneNumber: c.phoneNumber,
            lastCustomerContactAt: c.lastCustomerContactAt,
            preview: (c.lastMessagePreview || '').slice(0, 50),
        })),
    };
}
