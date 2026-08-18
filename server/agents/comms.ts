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

// ---------------------------------------------------------------- config

export interface CommsAgentConfig {
    /** Master switch for anything cron-triggered. Scripts can still run it manually. */
    enabled: boolean;
    /** Max conversations one sweep will process — bounds cost per run. */
    sweepLimit: number;
    autosend: {
        enabled: boolean;
        /** Intents allowed to skip human approval. Keep this to content-free acknowledgements. */
        intents: string[];
    };
}

const SETTING_KEY = 'comms_agent';
const DEFAULT_CONFIG: CommsAgentConfig = {
    enabled: false,
    sweepLimit: 5,
    autosend: { enabled: false, intents: [] },
};

export async function getCommsAgentConfig(): Promise<CommsAgentConfig> {
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY));
        if (!row) return DEFAULT_CONFIG;
        const stored = row.value as Partial<CommsAgentConfig>;
        return { ...DEFAULT_CONFIG, ...stored, autosend: { ...DEFAULT_CONFIG.autosend, ...(stored.autosend ?? {}) } };
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
                    ...recent.map((m) => ({
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
            description: 'Triage: move the conversation on the Kanban board and/or tag it. Reversible and internal, so use it freely. Stages: new (untouched), active (in conversation), waiting (ball in customer\'s court), closed (done or dead).',
            input_schema: {
                type: 'object' as const,
                properties: {
                    stage: { type: 'string', enum: ['new', 'active', 'waiting', 'closed'] },
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
            description: 'Draft the reply. It goes to Ben\'s approval queue — it does NOT send. One draft per conversation. HARD RULE: if the body mentions any price or £ figure it must have a source: pass quote_slug for a quoted price, or price_source="ben_answer" when the figure comes from Ben\'s answer to an ask_ben question. If neither covers it, use ask_ben instead. Never invent prices, dates or promises.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    body: { type: 'string', description: 'The message exactly as it would be sent. Warm, brief, UK English, no corporate filler. Sign off as "Handy Services".' },
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

                const id = await queueDraft({
                    phone: e164,
                    body: input.body,
                    source: 'comms_agent',
                    reason: `[${input.intent}] ${input.reason}${input.quote_slug ? ` (quote ${input.quote_slug})` : ''}`,
                });
                if (!id) return { queued: false, note: 'A pending comms_agent draft already exists for this customer.' };

                // Phase 3: whitelisted intents may auto-send — same claimed-row path a human uses.
                // Guarded by config (off by default), the intent whitelist, and UK daytime hours.
                const ukHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(new Date()));
                if (config.autosend.enabled && config.autosend.intents.includes(input.intent)
                    && input.intent !== 'other' && ukHour >= 8 && ukHour < 20) {
                    const sent = await approveAndSendDraft(id, 'comms_agent:autosend');
                    if (sent.ok) {
                        autosent = true;
                        return { queued: true, draftId: id, autosent: true, note: 'Intent is whitelisted — sent immediately.' };
                    }
                    return { queued: true, draftId: id, autosent: false, note: `Auto-send refused (${sent.code}); left for Ben to approve.` };
                }

                return { queued: true, draftId: id, autosent: false };
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

export const SYSTEM = `You are the comms triage agent for Handy Services, a Nottingham handyman company.
Ben (the VA) works the /admin/comms board; your job is to make his 4-working-hour SLA achievable.

For the conversation you are given, do this and nothing more:
1. Read the thread (get_thread). Understand what the customer needs RIGHT NOW.
2. Triage: set stage/priority/tags to match reality (set_board_state).
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

HARD RULES — these are not preferences:
- You never send anything. Drafts go to approval. That is the design, not a limitation.
- Prices come ONLY from quotes (cite quote_slug) or from Ben's explicit answer to your question
  (price_source="ben_answer"). You never originate a number yourself. No source → ask_ben.
- Never promise dates, times or availability that the thread does not already confirm.
- Complaints and angry customers: triage to priority=urgent and ask_ben. Do not draft apologies with commitments.
- Tone when you do draft: warm, brief, first-name if known, UK English, no corporate filler, sign off "— Handy Services".

Finish with one line: what you did and why. Be terse.`;

/** Staff-directory card — lives beside the agent so the /admin/staff page can't drift from reality. */
export const STAFF = {
    id: 'comms',
    name: 'Comms',
    roleTitle: 'Triage Officer & Drafting Clerk',
    mission: 'Reads every thread (messages + call transcripts), keeps the Kanban board honest, and makes Ben\'s 4-working-hour SLA achievable: draft a reply, ask Ben a structured question, or justify doing nothing.',
    model: 'claude-sonnet-5',
    cadence: 'SLA sweep every 30 min in working hours (cron, gated) · manual via scripts/agent-comms.ts',
    autonomy: {
        freely: ['Move cards, set priority, add tags on the board', 'Read threads, quotes and call transcripts'],
        approval: ['Every reply — drafted into message_drafts for Ben', 'Whitelisted acks may auto-send ONLY when the autosend gate is on (ships off)'],
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
        const [draft] = await db.select({ id: messageDrafts.id }).from(messageDrafts)
            .where(and(eq(messageDrafts.phone, `+${digits}`), inArray(messageDrafts.status, ['pending', 'approved'])))
            .limit(1);
        if (draft) { skipped.push({ conversationId: conv.id, why: 'pending draft exists' }); continue; }

        const [question] = await db.select({ id: agentQuestions.id }).from(agentQuestions)
            .where(and(eq(agentQuestions.conversationId, conv.id), inArray(agentQuestions.status, ['open', 'answered'])))
            .limit(1);
        if (question) { skipped.push({ conversationId: conv.id, why: 'open question exists' }); continue; }

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
