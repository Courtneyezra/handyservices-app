/**
 * THE SCOPER — the customer-conversation agent on the spine (Phase 2, design §3.5).
 *
 * It reads ONE thing (the CaseFile it is handed as its user turn), and it can do exactly five
 * things, each a typed tool on server/agents/runner.ts:
 *
 *   propose_reply(intent, body[], reasons[], citations?, tags?)   one call ends the run
 *   flag(exception, note)                                          hand the thread to Ben
 *   set_contact_name(name)                                         a name the customer stated
 *   schedule_recontact(date, note)                                 PROPOSE a follow-up (nudge_queue)
 *   get_quick_replies()                                            the house-voice canned replies
 *
 * No get_thread, no get_customer_context, no send, no price, no booking. Money, dates, discounts
 * and durations are not forbidden in prose only: the belt cannot express them (there is no
 * argument for a figure or a date anywhere), the intent vocabulary is the pack's `allowedIntents`
 * and nothing else, and every body is run through the draft-guard detectors at the tool boundary
 * before it can become a proposal. The spine (pane A) runs the pack guard set again and decides.
 *
 * Structural guarantees, independent of what the model does:
 *   - opted-out threads return null before any model call;
 *   - a triage exception the pack routes to Ben ALWAYS comes back as a flag on the proposal,
 *     even if the model forgot (and a run that produced nothing else becomes a flag-only proposal);
 *   - a date question with no live quote is a flag, never point_to_picker;
 *   - the model's own flag/name/recontact calls are carried on the Proposal, never written by
 *     this module — the one exception is schedule_recontact, which PROPOSES a nudge_queue row
 *     exactly as the legacy tool does (status 'proposed', Ben approves).
 *
 * Ships dark: server/spine/config.ts `spine.enabled` is false and nothing calls this on a live
 * thread until Phase 3. `runCommsAgent` (legacy) is untouched.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { runAgent as defaultRunAgent, type AgentTool, type AgentRunResult } from '../../agents/runner';
import { SCOPER_MODEL } from '../../llm';
import { checkDraft, detectPriceObjection } from '../../agents/draft-guards';
import { isPlaceholderName } from '../../first-contact-ack';
import * as levers from '../../agents/objection-levers';
import { isLikelyRealName } from '@shared/contact-name';
import { chatVoiceViolations } from '@shared/chat-voice';
import type { Approver } from '../../approver';
import type {
    CaseFile, ExceptionKind, Intent, PolicyPack, Proposal, SpineAgent, TriageResult, TimelineItem,
} from '../types';

export const SCOPER_APPROVER: Approver = 'agent.scoper';
export const SCOPER_NAME = 'scoper' as const;

/** Intents this agent may ever propose, before the pack narrows them further. */
export const SCOPER_INTENT_UNIVERSE: readonly Intent[] = [
    'ask_gap', 'clarify_scope', 'confirm_received', 'faq_from_kb', 'point_to_quote_page', 'closing',
    'holding', 'quote_on_its_way', 'answer_from_quote', 'point_to_picker',
];

export const EXCEPTION_KINDS: readonly ExceptionKind[] = [
    'complaint', 'trust_concern', 'refund', 'out_of_scope', 'regulated_trade',
    'money_question', 'date_question', 'callback_requested', 'spam', 'opted_out',
];

/** Tags the model may set through propose_reply. Everything else is the spine's. */
export const PROPOSABLE_TAGS = ['needs_quote', 'trust_concern'] as const;

const MAX_BUBBLES = 3;
const MAX_WORDS_PER_BUBBLE = 40; // the prompt says 25; this is the hard ceiling, not the target
const MAX_TIMELINE_ITEMS = 40;
const MAX_BODY_CHARS = 700;

// ---------------------------------------------------------------- prompts

const PROMPT_DIR = path.join(process.cwd(), 'server/spine/prompts');

function readPromptFile(name: string, fallback: string): string {
    try {
        return readFileSync(path.join(PROMPT_DIR, name), 'utf8').trim();
    } catch {
        return fallback;
    }
}

const CORE_FALLBACK = 'You are Handy Services\' reply on WhatsApp. Never write a money figure, a date, a duration or a discount. Flag money, dates, complaints and refunds to Ben. Ask for a photo or video first. Short bubbles, plain UK English, no em dashes. One propose_reply call ends your run.';

export function loadScoperCore(): string {
    return readPromptFile('scoper.core.md', CORE_FALLBACK);
}

export function loadScoperPostQuote(): string {
    return readPromptFile('scoper.post_quote.md', 'POST-QUOTE: never write a figure, never confirm a date, never take the graceful exit; flag money to Ben and draft the content-free half.');
}

/** The lever vocabulary, rendered from its single source of truth (server/agents/objection-levers.ts). */
export function renderLeverVocabulary(): string {
    const bands = levers.PRICE_BANDS.map((b) => `  - ${b.label}: ${b.posture}`).join('\n');
    const rows = levers.OBJECTION_LEVERS.map((l) => {
        const authority = l.authority === 'agent' ? 'yours' : l.agentMayAlone ? `figure is Ben's; your half: ${l.agentMayAlone}` : "Ben's, always";
        return `  - ${l.name} [${authority}] when: ${l.whenItApplies} bands: ${l.bands.join(', ')}\n    his words: ${l.bensWords.slice(0, 2).map((w) => `"${w}"`).join(' / ')}`;
    }).join('\n');
    return [
        'PRICE BANDS (posture by the quote\'s band; the case file names the band, never the figure):',
        bands,
        'THE LEVERS, in Ben\'s words (riff, do not recite):',
        rows,
        `NEVER: ${levers.BANNED_MOVE.why}`,
        `DURATION: ${levers.DURATION_RAIL}`,
        `VISIT TERMS: ${levers.VISIT_TERMS_RAIL}`,
    ].join('\n');
}

function loadVoice(pack: PolicyPack): string {
    const file = pack.voiceFile || 'whatsapp-comms.md';
    try {
        return readFileSync(path.join(process.cwd(), 'brand-voice', path.basename(file)), 'utf8').trim();
    } catch {
        return 'VOICE: friendly Nottingham tradesperson texting back. Short, plain, warm. No em dashes. One question max. Postcode only before the deposit.';
    }
}

export function isPostQuotePack(pack: PolicyPack): boolean {
    return pack.id === 'customer.post_quote' || pack.stage === 'quote_sent'
        || pack.allowedIntents.includes('answer_from_quote') || pack.allowedIntents.includes('point_to_picker');
}

/**
 * The SYSTEM block: core standing orders, the post-quote fragment when the pack selects it, the
 * pack's allowed intents, and the pack's voice file. Stable across runs of the same pack, so the
 * runner's cache_control on the system block pays for itself.
 */
export function buildScoperSystem(pack: PolicyPack, deps: { core?: string; postQuote?: string; voice?: string; levers?: string } = {}): string {
    const parts = [deps.core ?? loadScoperCore()];
    if (isPostQuotePack(pack)) {
        parts.push(deps.postQuote ?? loadScoperPostQuote());
        parts.push(deps.levers ?? renderLeverVocabulary());
    }
    parts.push(`INTENTS YOU MAY PROPOSE in this pack (${pack.id} v${pack.version}): ${pack.allowedIntents.join(', ')}. Any other intent is refused at the tool.`);
    parts.push(`EXCEPTIONS THAT GO TO BEN in this pack: ${pack.exceptionsToBen.join(', ')}.`);
    parts.push(`VOICE, follow to the letter:\n${deps.voice ?? loadVoice(pack)}`);
    return parts.join('\n\n');
}

export function promptHashOf(system: string): string {
    return createHash('sha256').update(system).digest('hex').slice(0, 24);
}

// ---------------------------------------------------------------- case file → user turn

function clip(s: string | undefined | null, n: number): string {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function isAgentOrRules(by?: string): boolean {
    return !!by && (by.startsWith('agent.') || by.startsWith('rules.') || by.startsWith('system.') || by.startsWith('comms_agent:') || by.startsWith('hours_gate:') || by.startsWith('first_contact_ack:'));
}

function renderTimelineItem(t: TimelineItem): string {
    const who = t.kind === 'message_in' || t.kind === 'call_in' ? 'CUSTOMER'
        : t.kind === 'message_out' || t.kind === 'call_out' ? (isAgentOrRules(t.by) ? `US (${t.by})` : 'US (BEN, manual)')
            : t.kind.toUpperCase();
    const media = t.mediaIds?.length ? ` [media: ${t.mediaIds.join(', ')}]` : '';
    const body = t.transcript ? `transcript: ${clip(t.transcript, MAX_BODY_CHARS)}` : clip(t.body, MAX_BODY_CHARS);
    return `- ${t.at} ${who}${t.channel ? ` via ${t.channel}` : ''}${media}: ${body}`;
}

/** The whole case file as the user turn. Numbers the belt cannot say are left out on purpose. */
export function renderCaseFile(cf: CaseFile, triage: TriageResult, trigger?: string): string {
    const placeholder = isPlaceholderName(cf.contactName);
    const q = cf.quote;
    const lines: string[] = [
        `CASE FILE for conversation ${cf.conversationId} (built ${cf.builtAt}, ref ${cf.hash.slice(0, 12)})`,
        `Trigger: ${trigger ?? 'inbound_message'}. Triage: lane ${triage.lane}, intent ${triage.intent}, exceptions [${triage.exceptions.join(', ') || 'none'}], stage ${triage.stage}.`,
        `Audience: ${cf.audience}. Stage: ${cf.stage}. City: ${cf.city ?? 'unknown'}.`,
        `Contact name: ${cf.contactName ? `"${cf.contactName}"` : 'none'}${placeholder ? ' (PLACEHOLDER: do not use it)' : ''}.`,
        `Channel last used: ${cf.window.channelLastUsed}. WhatsApp window: ${cf.window.canFreeform ? 'OPEN (freeform ok)' : 'SHUT (template or SMS only)'}. Last inbound: ${cf.window.lastInboundAt ?? 'never'}.`,
        cf.client ? `Client account: ${cf.client.name ?? cf.client.id}${cf.client.properties ? ` (${cf.client.properties} properties)` : ''}.` : 'Client account: none.',
        q ? `Live quote: /quote/${q.slug}, ${q.lines} line${q.lines === 1 ? '' : 's'}, ${q.viewedAt ? `viewed (last ${q.viewedAt})` : 'NOT yet viewed'}, ${q.paid ? 'PAID' : 'unpaid'}${q.expiresAt ? `, expires ${q.expiresAt}` : ''}. Figures live on the page, not here.`
            : 'Live quote: none.',
        `Tags: [${cf.tags.join(', ') || 'none'}].`,
        cf.openPromises.length ? `Open promises we made: ${cf.openPromises.map((p) => `"${clip(p.text, 120)}" (due ${p.dueAt})`).join('; ')}.` : 'Open promises: none.',
        cf.openFlags.length ? `Open flags for Ben: ${cf.openFlags.map((f) => `${f.exception}: ${clip(f.note, 120)} (due ${f.dueAt})`).join('; ')}.` : 'Open flags: none.',
        cf.lastRun ? `Last agent run: ${cf.lastRun.agent} ${cf.lastRun.decision} at ${cf.lastRun.at}.` : 'Last agent run: none.',
        cf.media.length ? `Media on file: ${cf.media.map((m) => `${m.id} (${m.kind}${m.description ? `: ${clip(m.description, 160)}` : ''})`).join('; ')}.` : 'Media on file: none.',
        '',
        `TIMELINE (oldest first, last ${Math.min(cf.timeline.length, MAX_TIMELINE_ITEMS)} of ${cf.timeline.length}):`,
        ...cf.timeline.slice(-MAX_TIMELINE_ITEMS).map(renderTimelineItem),
        '',
        'Decide, act with the tools, then stop.',
    ];
    return lines.join('\n');
}

function lastInboundText(cf: CaseFile): string | null {
    for (let i = cf.timeline.length - 1; i >= 0; i--) {
        const t = cf.timeline[i];
        if (t.kind === 'message_in' && t.body) return t.body;
    }
    return null;
}

// ---------------------------------------------------------------- the belt

export interface ScoperDeps {
    /** The model loop. Tests inject a stub; production uses server/agents/runner.ts. */
    runAgent?: typeof defaultRunAgent;
    loadQuickReplies?: () => Promise<Array<{ label: string; body: string }>>;
    /** PROPOSE a follow-up into nudge_queue (never sends). Default writes the row like the legacy tool. */
    proposeRecontact?: (input: { caseFile: CaseFile; runId: string; date: string; note: string; message: string }) => Promise<{ proposed: boolean; note: string }>;
    /** false = do not persist agent_runs rows (tests). */
    persist?: boolean;
    now?: () => Date;
    model?: string;
}

interface BeltState {
    proposal: Proposal | null;
    flag: Proposal['flag'];
    contactName: string | null;
    recontactAt: string | null;
    tags: Set<string>;
    ended: boolean;
}

export interface BeltContext {
    caseFile: CaseFile;
    pack: PolicyPack;
    triage: TriageResult;
    runId: string;
    deps: ScoperDeps;
}

export function normaliseBody(body: unknown): string[] {
    const raw: string[] = Array.isArray(body)
        ? body.map((b) => String(b ?? ''))
        : String(body ?? '').split(/\n\s*---\s*\n/);
    return raw.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Every rule a body must pass before it can be a proposal. Returns the refusal, or null. */
export function checkProposedBody(input: { bubbles: string[]; intent: string; caseFile: CaseFile }): string | null {
    const { bubbles, intent, caseFile } = input;
    if (!bubbles.length) return 'body is empty. Give 1 to 3 short bubbles.';
    if (bubbles.length > MAX_BUBBLES) return `body has ${bubbles.length} bubbles; the maximum is ${MAX_BUBBLES}. Say less.`;
    for (const b of bubbles) {
        const words = b.split(/\s+/).length;
        if (words > MAX_WORDS_PER_BUBBLE) return `a bubble runs to ${words} words ("${clip(b, 60)}"). Keep each under 25.`;
    }
    const joined = bubbles.join('\n---\n');
    const customerText = lastInboundText(caseFile);
    const objection = detectPriceObjection(customerText);
    const violation = checkDraft({
        body: joined,
        // Only 'price_objection' arms the capitulation check in checkDraft; derive it from the
        // customer's own words, never from the model's declared intent.
        intent: objection ? 'price_objection' : intent,
        quoteSeen: !!caseFile.quote?.viewedAt,
        quoteTotalPence: caseFile.quote?.total ?? null,
        customerText,
    });
    if (violation) return `${violation.code}: ${violation.message}`;
    const voice = chatVoiceViolations(joined);
    if (voice.length) return `chat voice: ${voice.join(', ')}. No em dashes, no hyphens as punctuation, no "let me know when suits".`;
    if ((joined.match(/\?/g) ?? []).length > 1) return 'more than one question. One ask per reply.';
    return null;
}

function benExceptions(triage: TriageResult, pack: PolicyPack): ExceptionKind[] {
    return triage.exceptions.filter((e) => pack.exceptionsToBen.includes(e));
}

/** A date question is Ben's unless a live quote exists AND the pack can point at its picker. */
export function dateQuestionNeedsBen(caseFile: CaseFile, pack: PolicyPack): boolean {
    return !(caseFile.quote && !caseFile.quote.paid && pack.allowedIntents.includes('point_to_picker'));
}

export function buildScoperTools(ctx: BeltContext, state: BeltState): AgentTool[] {
    const { caseFile, pack, triage, runId, deps } = ctx;
    const now = deps.now ?? (() => new Date());

    const ensureOpen = () => {
        if (state.ended) throw new Error('This run has ended: propose_reply was already called. Reply with one line and stop.');
    };

    return [
        {
            name: 'propose_reply',
            description: `The reply, as a proposal. ONE call ends your run; make it the whole reply. body is 1 to 3 short bubbles (each its own WhatsApp message). intent must be one of: ${pack.allowedIntents.join(', ')}. Never a money figure, discount, date, time, duration or fee terms: the tool refuses them. If money or a date is the answer, call flag first and propose the content-free half here. reasons: one or two lines for the human who may review it. citations: quote slug, template or quick-reply label you leaned on. tags: 'needs_quote' when the thread now has what a quote needs (use intent quote_on_its_way), 'trust_concern' when they doubt the channel.`,
            input_schema: {
                type: 'object' as const,
                properties: {
                    intent: { type: 'string', enum: [...pack.allowedIntents] },
                    body: { type: 'array', items: { type: 'string' }, description: '1 to 3 bubbles, each under 25 words, UK English, no em dashes, at most one question in total.' },
                    reasons: { type: 'array', items: { type: 'string' } },
                    citations: { type: 'array', items: { type: 'string' } },
                    tags: { type: 'array', items: { type: 'string', enum: [...PROPOSABLE_TAGS] } },
                },
                required: ['intent', 'body', 'reasons'],
            },
            run: async (input: { intent: string; body: unknown; reasons?: unknown; citations?: unknown; tags?: unknown }) => {
                ensureOpen();
                const intent = String(input.intent ?? '') as Intent;
                if (!pack.allowedIntents.includes(intent)) {
                    throw new Error(`intent "${intent}" is not in this pack. Allowed: ${pack.allowedIntents.join(', ')}.`);
                }
                if (intent === 'point_to_picker' && dateQuestionNeedsBen(caseFile, pack)) {
                    throw new Error('point_to_picker needs a live, unpaid quote with a date picker. There is none: flag("date_question", …) and propose a holding reply without a date.');
                }
                if (intent === 'quote_on_its_way' && caseFile.quote && !caseFile.quote.paid) {
                    throw new Error('A live quote is already out; quote_on_its_way would promise a second one. Answer from the quote or flag.');
                }
                const bubbles = normaliseBody(input.body);
                const refusal = checkProposedBody({ bubbles, intent, caseFile });
                if (refusal) throw new Error(`Refused: ${refusal} Rewrite and call propose_reply again.`);
                const reasons = Array.isArray(input.reasons) ? input.reasons.map(String).filter(Boolean) : [];
                if (!reasons.length) throw new Error('reasons is required: one line on why this reply, why now.');
                const citations = Array.isArray(input.citations) ? input.citations.map(String).filter(Boolean) : undefined;
                const tags = Array.isArray(input.tags) ? input.tags.map(String).filter((t) => (PROPOSABLE_TAGS as readonly string[]).includes(t)) : [];
                for (const t of tags) state.tags.add(t);
                if (intent === 'quote_on_its_way') state.tags.add('needs_quote');
                state.proposal = { intent, body: bubbles, reasons, ...(citations?.length ? { citations } : {}) };
                state.ended = true;
                return { recorded: true, note: 'Proposal recorded; the spine decides whether it sends now, waits, or holds. Reply with one line and stop.' };
            },
        },
        {
            name: 'flag',
            description: `Hand this thread to Ben. exception is one of: ${EXCEPTION_KINDS.join(', ')}. Use it for money decisions, dates, complaints or liability, refunds, trust concerns, out-of-scope or regulated work, or a callback request. NOT for scoping judgement or material questions. note is the whole briefing he reads on his phone: why he is needed, what the customer wants, what you already told them. Ben replies in the thread himself. Then still propose_reply the content-free half unless silence is genuinely right.`,
            input_schema: {
                type: 'object' as const,
                properties: {
                    exception: { type: 'string', enum: [...EXCEPTION_KINDS] },
                    note: { type: 'string' },
                },
                required: ['exception', 'note'],
            },
            run: async (input: { exception: string; note: string }) => {
                const exception = String(input.exception ?? '') as ExceptionKind;
                if (!EXCEPTION_KINDS.includes(exception)) throw new Error(`exception must be one of ${EXCEPTION_KINDS.join(', ')}.`);
                const note = clip(input.note, 1200);
                if (note.length < 10) throw new Error('note is too short to brief Ben. Two or three sentences.');
                state.flag = { exception, note };
                return { flagged: true, note: 'Flag recorded on the proposal. Ben will be pinged by the spine. Now propose the content-free half of the reply, or stop if silence is right.' };
            },
        },
        {
            name: 'set_contact_name',
            description: 'Save the customer\'s REAL name, ONLY when they stated it in this thread (answering you, or signing off "Cheers, Sarah"). A first name is fine. Never a guess, never the WhatsApp pushname. Placeholder-shaped names are rejected.',
            input_schema: {
                type: 'object' as const,
                properties: { name: { type: 'string' } },
                required: ['name'],
            },
            run: async (input: { name: string }) => {
                const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
                if (isPlaceholderName(name) || !isLikelyRealName(name)) {
                    throw new Error(`"${name}" does not pass the real-name check (numbers, emoji, placeholders like "Just Me", system labels and business names are all rejected). Save only a personal name the customer actually stated. If they have not, ask for it in your reply instead.`);
                }
                state.contactName = name;
                return { saved: name, note: 'Carried on the proposal; the spine stores it.' };
            },
        },
        {
            name: 'schedule_recontact',
            description: 'The customer put the job on hold ("after Christmas", "when I\'m back from holiday"). Record the day to come back to them. This PROPOSES a follow-up into the nudge queue for Ben to approve and send that day: it sends nothing, books nothing, promises nothing. Use it WITH a reply that says you will check back. Needs a live quote.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    date: { type: 'string', description: 'YYYY-MM-DD. If you cannot work one out, ask them when to check back.' },
                    note: { type: 'string', description: 'One line: what they are waiting on and why this date.' },
                },
                required: ['date', 'note'],
            },
            run: async (input: { date: string; note: string }) => {
                const q = caseFile.quote;
                if (!q || q.paid) throw new Error('There is no live quote to follow up. Reply that you will check back, and flag if the timing needs a decision.');
                const date = String(input.date ?? '').trim();
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Give the date as YYYY-MM-DD.');
                const today = now().toISOString().slice(0, 10);
                if (date <= today) throw new Error(`${date} is not in the future. If they are ready now, reply now.`);
                const daysOut = Math.round((Date.parse(`${date}T12:00:00Z`) - now().getTime()) / 86_400_000);
                if (daysOut > 180) throw new Error(`${date} is ${daysOut} days away; nothing in the queue survives six months. Pick a date inside six months or flag.`);
                const note = clip(input.note, 400);
                const first = !isPlaceholderName(caseFile.contactName) ? ` ${String(caseFile.contactName).split(/\s+/)[0]}` : '';
                // Fixed, content-free follow-up: no figure, no date promise, one action (the link).
                const message = `Hi${first}, just checking back in as promised. Your quote is still here whenever you are ready: https://handyservices.app/quote/${q.slug}`;
                const propose = deps.proposeRecontact ?? defaultProposeRecontact;
                const result = await propose({ caseFile, runId, date, note, message });
                if (!result.proposed) throw new Error(result.note);
                state.recontactAt = date;
                return { scheduled: true, date, note: 'Proposed only. Ben approves and sends it on the day. Now propose the reply that tells them you will check back.' };
            },
        },
        {
            name: 'get_quick_replies',
            description: 'The approved canned replies in the house voice. Prefer adapting one over free-writing.',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
            run: async () => {
                const load = deps.loadQuickReplies ?? defaultLoadQuickReplies;
                return load();
            },
        },
    ];
}

// ---------------------------------------------------------------- default deps (db-backed, lazy)

async function defaultLoadQuickReplies(): Promise<Array<{ label: string; body: string }>> {
    const { db } = await import('../../db');
    const { quickReplies } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    return db.select({ label: quickReplies.label, body: quickReplies.body }).from(quickReplies).where(eq(quickReplies.isActive, true)).limit(20);
}

/** The legacy schedule_recontact write, unchanged in shape: a PROPOSED nudge_queue row. */
async function defaultProposeRecontact(input: { caseFile: CaseFile; runId: string; date: string; note: string; message: string }): Promise<{ proposed: boolean; note: string }> {
    const { db } = await import('../../db');
    const { nudgeQueue, personalizedQuotes } = await import('@shared/schema');
    const { and, eq, ne, sql } = await import('drizzle-orm');
    const slug = input.caseFile.quote!.slug;
    const [quoteRow] = await db.select({ id: personalizedQuotes.id }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug)).limit(1);
    if (!quoteRow) return { proposed: false, note: `Quote ${slug} could not be loaded. Flag instead.` };
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(nudgeQueue)
        .where(and(eq(nudgeQueue.quoteId, quoteRow.id), ne(nudgeQueue.status, 'dismissed')));
    if (Number(n) >= 3) return { proposed: false, note: `Quote ${slug} already has ${n} follow-ups on record, the lifetime limit. Reply, and leave the chasing alone.` };
    await db.insert(nudgeQueue).values({
        quoteId: quoteRow.id, slug, phone: input.caseFile.phone, status: 'proposed', lever: 'recontact',
        message: input.message.slice(0, 1000),
        reason: `[scoper, agreed re-contact ${input.date}] ${input.note}`,
        sendAfter: new Date(`${input.date}T09:00:00Z`),
        agentRun: 'scoper', runId: input.runId,
    });
    return { proposed: true, note: 'proposed' };
}

// ---------------------------------------------------------------- the agent

function autoFlagNote(triage: TriageResult, exceptions: ExceptionKind[]): string {
    const why = triage.reasons.length ? triage.reasons.join('; ') : 'triage found an exception';
    return `Triage exception (${exceptions.join(', ')}): ${clip(why, 400)}. The agent did not add its own note; open the thread.`;
}

export function createScoperAgent(deps: ScoperDeps = {}): SpineAgent & { deps: ScoperDeps } {
    const run = deps.runAgent ?? defaultRunAgent;
    return {
        name: SCOPER_NAME,
        tier: 'DRAFT',
        deps,
        async run({ caseFile, pack, triage, runId }): Promise<Proposal | null> {
            // ---- structural pre-checks, no model call
            if (triage.exceptions.includes('opted_out') || caseFile.tags.includes('opted_out') || caseFile.tags.includes('do_not_contact')) return null;
            if (!pack.allowedIntents.length) return null; // an exception pack: Ben only
            if (caseFile.audience !== 'customer') return null;

            const state: BeltState = { proposal: null, flag: null, contactName: null, recontactAt: null, tags: new Set(), ended: false };
            const system = buildScoperSystem(pack);
            const tools = buildScoperTools({ caseFile, pack, triage, runId, deps }, state);
            const goal = renderCaseFile(caseFile, triage);

            let result: AgentRunResult | null = null;
            try {
                result = await run({
                    name: SCOPER_NAME,
                    system,
                    goal,
                    tools,
                    model: deps.model ?? SCOPER_MODEL,
                    maxTurns: 6,
                    maxTokens: 4000,
                    runId,
                    trigger: 'spine',
                    conversationId: caseFile.conversationId,
                    phone: caseFile.phone,
                    packId: pack.id,
                    packVersion: pack.version,
                    caseFileRef: caseFile.hash,
                    promptHash: promptHashOf(system),
                    persist: deps.persist ?? true,
                });
            } catch (error: any) {
                console.error(`[Scoper] run ${runId} failed on ${caseFile.conversationId}:`, error?.message ?? error);
            }

            // ---- structural post-conditions: a Ben exception is ALWAYS a flag on the proposal
            const forBen = benExceptions(triage, pack).filter((e) => !(e === 'date_question' && !dateQuestionNeedsBen(caseFile, pack)));
            if (forBen.length && !state.flag) state.flag = { exception: forBen[0], note: autoFlagNote(triage, forBen) };

            const extras: Partial<Proposal> = {
                ...(state.flag ? { flag: state.flag } : {}),
                ...(state.contactName ? { contactName: state.contactName } : {}),
                ...(state.recontactAt ? { recontactAt: state.recontactAt } : {}),
                ...(state.tags.size ? { tags: Array.from(state.tags) } : {}),
            };

            if (state.proposal) return { ...state.proposal, ...extras };
            if (state.flag) {
                // Flag-only: the spine raises the flag; the rules layer holds the line at expiry.
                return { intent: 'holding', body: [], reasons: [`flag only: ${state.flag.exception}`, ...(result ? [clip(result.finalText, 200)] : [])], ...extras };
            }
            if (state.contactName || state.recontactAt || state.tags.size) {
                return { intent: 'holding', body: [], reasons: ['no reply proposed; carrying side effects only'], ...extras };
            }
            return null;
        },
    };
}

/** The production instance. */
export const scoperAgent = createScoperAgent();
