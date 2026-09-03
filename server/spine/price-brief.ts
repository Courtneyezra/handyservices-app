/**
 * PRICE AND SEND v2 — the briefing (P12, docs/comms-build/BRIEF-P12-price-screen-v2.md).
 *
 * Route A scopes, estimates and prices before Ben has seen the thread, so the screen has to brief
 * him cold: her words first (the inbound messages each line came from, with the photos under the
 * line), the whole thread embedded, contradictions between what the estimator assumed and what it
 * listed surfaced as `check_this` (never a block), the customer message drafted by the desk for
 * him to edit, and the three exits that are not a send: ask her one question, call her, or offer
 * a visit instead of a price. Each of those HOLDS the quote (a note on the draft row's
 * pricing_suggestions, no migration) and lands in the ledger under the approver.
 *
 * Everything that decides is pure and unit-tested; the loaders at the bottom do the reads.
 * Nothing here prices, and nothing here sends to a customer: the ask and the visit offer are
 * pending drafts in Ben's queue, the call is his phone.
 */
import { toChatVoice, chatVoiceViolations } from '@shared/chat-voice';
import type { Approver } from '../approver';

// ---------------------------------------------------------------- shapes

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

export interface ThreadMessage {
    id: string;
    at: string;                       // ISO
    direction: 'in' | 'out';
    channel: string;
    body: string;
    media: { url: string; kind: MediaKind } | null;
    by: string | null;
}

export interface PriceScreenThread {
    messages: ThreadMessage[];
    /** Messages at or after this ISO are shown by default (the last 24 hours before the latest inbound). */
    recentSince: string | null;
    firstInboundAt: string | null;
    latestInboundId: string | null;
    count: number;
}

export interface LineEvidence {
    /** The inbound the line is based on: the strongest match, else the latest inbound. */
    basedOnInboundId: string | null;
    quotes: Array<{ messageId: string; at: string; text: string }>;
    media: Array<{ messageId: string; url: string; kind: MediaKind }>;
}

export interface Contradiction {
    id: string;
    lineId: string;
    kind: 'assumption_vs_materials';
    /** One sentence naming the clash. */
    sentence: string;
    assumption: string;
    assumptionIndex: number;
    /** Indexes into the line's materials list. */
    materialIndexes: number[];
    materialNames: string[];
    options: Array<{ id: 'drop_materials' | 'keep_materials'; label: string }>;
}

export type HoldReason = 'ask_first' | 'call' | 'visit';
export interface QuoteHold { reason: HoldReason; at: string; by: string; question?: string | null; draftId?: string | null }

export interface Resolution { contradictionId: string; choice: 'drop_materials' | 'keep_materials' }

// ---------------------------------------------------------------- words

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'has', 'are', 'was', 'were', 'you', 'your', 'our', 'can', 'will', 'just', 'all', 'any', 'new', 'one', 'two', 'per', 'into', 'onto', 'off', 'out', 'over', 'under', 'them', 'they', 'there', 'here', 'what', 'when', 'where', 'which', 'also', 'but', 'not', 'yes', 'please', 'thanks', 'thank', 'hi', 'hello', 'ok', 'okay', 'set', 'sets', 'job', 'jobs', 'work', 'like', 'need', 'needs', 'want', 'get', 'got', 'sent', 'send', 'photo', 'photos', 'picture', 'pictures', 'pic', 'pics']);

/** Lowercase content words, crudely singularised, no stopwords, at least three letters. */
export function keywordsOf(text: string | null | undefined): string[] {
    const out = new Set<string>();
    for (const raw of String(text ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
        out.add(singular(raw));
    }
    return Array.from(out);
}

function singular(w: string): string {
    if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
    if (w.endsWith('ses') || w.endsWith('shes') || w.endsWith('ches') || w.endsWith('xes')) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
    return w;
}

/** The sentence (or clause) of `body` that carries any of `words`, trimmed to `max` characters. */
export function sentenceWith(body: string, words: string[], max = 180): string {
    const parts = body.split(/(?<=[.!?])\s+|\n+/).map((p) => p.trim()).filter(Boolean);
    let hit = parts[0] ?? body.trim();
    let best = 0;
    for (const p of parts) {
        const n = keywordsOf(p).filter((k) => words.includes(k)).length;
        if (n > best) { best = n; hit = p; }
    }
    return hit.length > max ? `${hit.slice(0, max - 1).trimEnd()}…` : hit;
}

// ---------------------------------------------------------------- thread

const DAY_MS = 24 * 60 * 60_000;

/**
 * Pure: the thread the screen embeds. EVERYTHING on the thread, in time order: Sarah's opens with
 * three invoice reminders from May and June before her September message, and that is part of the
 * picture (owner decision 2). The screen windows to the last 24 hours; nothing is cut here.
 */
export function buildThread(messages: ThreadMessage[]): PriceScreenThread {
    const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const firstIn = sorted.findIndex((m) => m.direction === 'in');
    const kept = sorted;
    const latestIn = [...kept].reverse().find((m) => m.direction === 'in') ?? null;
    const anchor = latestIn ? new Date(latestIn.at).getTime() : kept.length ? new Date(kept[kept.length - 1].at).getTime() : null;
    return {
        messages: kept,
        recentSince: anchor != null ? new Date(anchor - DAY_MS).toISOString() : null,
        firstInboundAt: firstIn >= 0 ? sorted[firstIn].at : null,
        latestInboundId: latestIn?.id ?? null,
        count: kept.length,
    };
}

// ---------------------------------------------------------------- evidence

const NEAR_MS = 15 * 60_000;

/**
 * Pure: which of her messages a line came from. Keyword overlap between the line's title (and
 * notes) and each inbound text; the best three carry a quote, and any inbound photo or video sent
 * within fifteen minutes of a matched message (or captioned with the words) sits under the line.
 * A line nothing matches is based on the latest inbound and carries no quotes.
 */
export function evidenceForLine(line: { title: string; notes?: string | null; category?: string | null }, thread: Pick<PriceScreenThread, 'messages' | 'latestInboundId'>): LineEvidence {
    const words = keywordsOf(`${line.title} ${line.notes ?? ''}`);
    const inbound = thread.messages.filter((m) => m.direction === 'in');
    const all = inbound
        .map((m) => ({ m, score: words.length ? keywordsOf(m.body).filter((k) => words.includes(k)).length : 0 }))
        .filter((x) => x.score > 0 && x.m.body.trim())
        .sort((a, b) => b.score - a.score || b.m.at.localeCompare(a.m.at));
    // Keep the messages that match about as well as the best one: a one-word overlap beside a
    // three-word match is noise ("door" in every message on a doors job).
    const floor = all.length ? Math.max(1, Math.ceil(all[0].score / 2)) : 1;
    const scored = all.filter((x) => x.score >= floor).slice(0, 3);
    const matched = scored.map((x) => x.m);
    const mediaIds = new Set<string>();
    const media: LineEvidence['media'] = [];
    for (const m of inbound) {
        if (!m.media) continue;
        const captioned = words.length > 0 && keywordsOf(m.body).some((k) => words.includes(k));
        const near = matched.some((t) => Math.abs(new Date(t.at).getTime() - new Date(m.at).getTime()) <= NEAR_MS);
        if ((captioned || near) && !mediaIds.has(m.id)) { mediaIds.add(m.id); media.push({ messageId: m.id, url: m.media.url, kind: m.media.kind }); }
    }
    return {
        basedOnInboundId: matched[0]?.id ?? thread.latestInboundId ?? null,
        quotes: matched.map((m) => ({ messageId: m.id, at: m.at, text: sentenceWith(m.body, words) })),
        media,
    };
}

// ---------------------------------------------------------------- contradictions

const REUSE = /\b(re-?use[ds]?|re-?using|existing|keep(?:ing|s)?|kept|retain(?:ed|ing|s)?|no new|not new|customer(?:'s)? own|supplied by the customer)\b/i;
const PREP = new Set(['on', 'by', 'to', 'for', 'in', 'at', 'with', 'from', 'of', 'as', 'onto', 'into']);
const PAST_FORMS = new Set(['reused', 'kept', 'retained', 'supplied']);
const REUSE_WORDS = new Set(['reuse', 'reused', 'reusing', 'existing', 'keep', 'keeping', 'kept', 'retain', 'retained', 'retaining', 'own', 'supplied', 'customer']);

/** The thing said to be reused: the content word directly beside each reuse word ("handles reused", "existing handles"). */
export function reusedNouns(assumption: string): string[] {
    const tokens = assumption.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const out = new Set<string>();
    const content = (w: string | undefined) => (w && w.length >= 3 && !STOP.has(w) && !REUSE_WORDS.has(w) && !/^\d+$/.test(w) ? singular(w) : null);
    const seek = (from: number, step: 1 | -1): string | null => {
        for (let k = 1; k <= 3; k++) {
            const w = tokens[from + k * step];
            if (w === undefined || PREP.has(w)) return null;   // "reused ON all doors": the doors are not the thing reused
            if (STOP.has(w) || w.length < 3) continue;          // "keep THE handles"
            return content(w);
        }
        return null;
    };
    tokens.forEach((t, i) => {
        const base = REUSE_WORDS.has(t) ? t : REUSE_WORDS.has(singular(t)) ? singular(t) : null;
        if (!base) return;
        // A past participle names the thing before it ("handles reused", "handles kept"); the
        // adjective / verb forms name the thing after ("existing handles", "keep the handles").
        const noun = PAST_FORMS.has(base) ? seek(i, -1) : seek(i, 1) ?? seek(i, -1);
        if (noun) out.add(noun);
    });
    return Array.from(out);
}

/**
 * Pure: an assumption that says something is reused or existing, on a line whose materials list
 * carries that same thing (Sarah: "handles reused" beside seven new handle sets). One sentence,
 * two taps: drop the materials or keep them. Never blocks.
 */
export function findContradictions(lines: Array<{ lineId: string; title: string; assumptions: string[]; materials: Array<{ name: string; qty: number }> }>): Contradiction[] {
    const out: Contradiction[] = [];
    for (const line of lines) {
        line.assumptions.forEach((assumption, ai) => {
            if (!REUSE.test(assumption)) return;
            const nouns = reusedNouns(assumption);
            if (!nouns.length) return;
            const idx: number[] = [];
            line.materials.forEach((m, mi) => { if (keywordsOf(m.name).some((k) => nouns.includes(k))) idx.push(mi); });
            if (!idx.length) return;
            const names = idx.map((i) => `${line.materials[i].qty > 1 ? `${line.materials[i].qty}× ` : ''}${line.materials[i].name}`);
            out.push({
                id: `${line.lineId}:a${ai}`, lineId: line.lineId, kind: 'assumption_vs_materials',
                sentence: `The estimate assumes "${assumption.replace(/[.]+$/, '')}" but lists ${names.join(' and ')} as materials.`,
                assumption, assumptionIndex: ai, materialIndexes: idx, materialNames: names,
                options: [
                    { id: 'drop_materials', label: `Drop ${idx.length === 1 ? 'it' : 'them'} from the quote` },
                    { id: 'keep_materials', label: `Keep ${idx.length === 1 ? 'it' : 'them'}, drop the assumption` },
                ],
            });
        });
    }
    return out;
}

// ---------------------------------------------------------------- the message

const MONEY = /£|\bpounds?\b|\bquid\b|\bdeposit\b|\bdiscount\b/i;
const DATES = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b\.?\s*\d|\btomorrow\b|\bnext week\b|\bthis week\b|\b\d{1,2}(st|nd|rd|th)\b|\b\d{1,2}[/.]\d{1,2}\b/i;

/** What the drafted message must never carry (the price screen's own guard, beside the voice guard). */
export function messageViolations(body: string): string[] {
    const out = chatVoiceViolations(body);
    if (MONEY.test(body)) out.push('money: the quote link carries the price, the message never does');
    if (DATES.test(body)) out.push('date: dates are Ben\'s alone');
    return out;
}

/** "all 9 doors, oak to match" from the lines: what she asked for, in the words the clerk kept. */
export function jobPhrase(lines: Array<{ title: string; qty?: number | null }>): string {
    const items = lines.map((l) => {
        const t = l.title.trim().replace(/[.]+$/, '');
        const lower = t.charAt(0).toLowerCase() + t.slice(1);
        return l.qty && l.qty > 1 && !/^\d/.test(lower) ? `${l.qty} ${lower}` : lower;
    }).filter(Boolean);
    if (!items.length) return 'the work';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Pure: the message Sarah reads, drafted by the desk, edited by Ben on the screen. House voice
 * (short bursts, no dashes, no prices, no dates, no address). The quote link is added at send,
 * as its own line, so the words here never have to carry it.
 */
export function draftCustomerMessage(input: { firstName: string | null; lines: Array<{ title: string; qty?: number | null }>; sentPhotos: boolean; sentVideo?: boolean }): string {
    const hi = input.firstName ? `Hi ${input.firstName}, ` : '';
    const thanks = input.sentVideo ? 'thanks for the video and the details.' : input.sentPhotos ? 'thanks for the photos and the details.' : 'thanks for the details.';
    const job = jobPhrase(input.lines);
    const lines = [
        `${hi}${thanks}`,
        `Your quote for ${job} is ready, link below.`,
        'It is itemised so you can see exactly what is included, and you can pick a date that suits you on the same page.',
        'Any questions, just reply here.',
    ];
    return toChatVoice(lines.join('\n'));
}

/** The link goes on at send, once, as the last line, so Ben's words never have to carry it. */
export function withQuoteLink(body: string, quoteUrl: string): string {
    const b = body.trim();
    return b.includes(quoteUrl) ? b : `${b}\n\n${quoteUrl}`;
}

// ---------------------------------------------------------------- after send

/** The desk chases an unopened quote after this many days (rules.followup, quote_unviewed). */
export const FOLLOW_UP_DAYS = 2;

export function nextStepsAfterSend(input: { firstName: string; depositPence: number; mode: 'sent' | 'queued' | 'template'; followUpDays?: number }): string {
    const pounds = (p: number) => (Number.isInteger(p / 100) ? `£${(p / 100).toLocaleString('en-GB')}` : `£${(p / 100).toFixed(2)}`);
    const days = input.followUpDays ?? FOLLOW_UP_DAYS;
    const head = input.mode === 'queued' ? `Queued for ${input.firstName}, it goes when the window reopens.` : `Sent to ${input.firstName}.`;
    return `${head} Deposit ${pounds(input.depositPence)}. Follow-up in ${days} day${days === 1 ? '' : 's'} if unviewed.`;
}

// ---------------------------------------------------------------- hold

export function holdOf(suggestions: { hold?: unknown } | null | undefined): QuoteHold | null {
    const h = suggestions?.hold as any;
    if (!h || typeof h !== 'object') return null;
    const reason = h.reason;
    if (reason !== 'ask_first' && reason !== 'call' && reason !== 'visit') return null;
    return { reason, at: String(h.at ?? ''), by: String(h.by ?? ''), question: typeof h.question === 'string' ? h.question : null, draftId: typeof h.draftId === 'string' ? h.draftId : null };
}

/** Ben's one question, cleaned for the queue: one sentence, house voice, at most 240 characters. */
export function cleanQuestion(raw: unknown): { ok: true; question: string } | { ok: false; error: string } {
    const q = toChatVoice(String(raw ?? '').replace(/\s+/g, ' ').trim());
    if (!q) return { ok: false, error: 'Type the one question you want to ask first.' };
    if (q.length > 240) return { ok: false, error: 'Keep it to one question (240 characters).' };
    if (MONEY.test(q)) return { ok: false, error: 'No prices in the question: the quote link carries the price.' };
    return { ok: true, question: q };
}

// ---------------------------------------------------------------- db: reads

function kindOf(mediaType: string | null | undefined, type: string | null | undefined): MediaKind {
    const t = String(mediaType ?? type ?? '').toLowerCase();
    if (t.startsWith('video')) return 'video';
    if (t.startsWith('audio')) return 'audio';
    if (t.startsWith('image')) return 'image';
    return 'document';
}

export async function loadThread(conversationId: string | null): Promise<PriceScreenThread> {
    if (!conversationId) return buildThread([]);
    const { db } = await import('../db');
    const { messages } = await import('@shared/schema');
    const { and, asc, eq } = await import('drizzle-orm');
    const { notQuarantined } = await import('../message-quarantine');
    const rows = await db.select({
        id: messages.id, createdAt: messages.createdAt, direction: messages.direction, channel: messages.channel,
        content: messages.content, mediaUrl: messages.mediaUrl, mediaType: messages.mediaType, type: messages.type, senderName: messages.senderName,
    }).from(messages).where(and(eq(messages.conversationId, conversationId), notQuarantined)).orderBy(asc(messages.createdAt)).limit(400);
    return buildThread(rows.map((r) => ({
        id: String(r.id), at: (r.createdAt ? new Date(r.createdAt) : new Date(0)).toISOString(),
        direction: r.direction === 'inbound' ? 'in' : 'out', channel: String(r.channel ?? 'whatsapp'),
        body: String(r.content ?? ''), media: r.mediaUrl ? { url: r.mediaUrl, kind: kindOf(r.mediaType, r.type) } : null,
        by: r.senderName ?? null,
    })));
}

/** The next Route A draft waiting for Ben, oldest first, never this one. */
export async function loadNextWaiting(excludeQuoteId: string): Promise<{ slug: string; firstName: string } | null> {
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const r: any = await db.execute(sql`select short_slug, customer_name from personalized_quotes
        where is_draft = true and superseded_at is null and revoked_at is null and pricing_suggestions is not null and id <> ${excludeQuoteId}
          and coalesce(pricing_suggestions->'hold', 'null'::jsonb) = 'null'::jsonb
        order by created_at asc limit 1`);
    const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
    if (!rows[0]?.short_slug) return null;
    const name = String(rows[0].customer_name ?? '').trim();
    return { slug: String(rows[0].short_slug), firstName: name ? name.split(/\s+/)[0] : 'Customer' };
}

/** The number Ben dials from: the business voice number Groundwire presents (settings, else env). */
export async function businessNumber(): Promise<string | null> {
    try {
        const { getTwilioSettings } = await import('../settings');
        const s = await getTwilioSettings();
        return s.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER || null;
    } catch { return process.env.TWILIO_PHONE_NUMBER ?? null; }
}

// ---------------------------------------------------------------- db: writes (the three exits)

async function setHold(quoteId: string, hold: QuoteHold | null): Promise<void> {
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`update personalized_quotes
        set pricing_suggestions = coalesce(pricing_suggestions, '{}'::jsonb) || jsonb_build_object('hold', ${JSON.stringify(hold)}::jsonb)
        where id = ${quoteId}`);
}

export interface ExitContext { quoteId: string; slug: string; conversationId: string | null; phone: string | null; firstName: string; user: { id?: string | null; email?: string | null } }
export type ExitResult = { ok: true; hold: QuoteHold; draftId?: string | null; runId: string; approver: Approver; tel?: string | null } | { ok: false; status: number; errors: string[] };

async function approverFor(user: ExitContext['user']): Promise<{ approver: Approver; runId: string }> {
    const { humanApprover, newRunId } = await import('../approver');
    return { approver: humanApprover(user.email ?? user.id ?? 'admin'), runId: newRunId('human') };
}

async function ledger(e: { eventType: 'quote_held' | 'call_requested'; ctx: ExitContext; approver: Approver; runId: string; body?: string | null; meta: Record<string, unknown> }): Promise<void> {
    try {
        const { appendEvent } = await import('../ledger');
        await appendEvent({
            eventType: e.eventType, channel: e.eventType === 'call_requested' ? 'call' : 'system', phone: e.ctx.phone ?? '', conversationId: e.ctx.conversationId,
            actor: e.approver, body: e.body ?? null, refTable: 'personalized_quotes', refId: e.ctx.quoteId, runId: e.runId, meta: { slug: e.ctx.slug, ...e.meta },
        });
    } catch { /* the ledger never blocks an action */ }
}

/**
 * Ask her first: ONE question, queued as a pending draft in Ben's queue through the existing draft
 * path (approval, freshness guard, window handling all apply), the quote held until she answers.
 */
export async function askFirst(ctx: ExitContext, rawQuestion: unknown): Promise<ExitResult> {
    const q = cleanQuestion(rawQuestion);
    if (!q.ok) return { ok: false, status: 400, errors: [q.error] };
    if (!ctx.phone) return { ok: false, status: 422, errors: ['No phone on this quote, so the question cannot be queued from here.'] };
    const { approver, runId } = await approverFor(ctx.user);
    const { queueDraft } = await import('../message-drafts');
    const draftId = await queueDraft({ phone: ctx.phone, body: q.question, source: 'manual', reason: `Price screen: asked before quoting ${ctx.slug}`, runId, dedupe: false });
    if (!draftId) return { ok: false, status: 409, errors: ['The question could not be queued (opted out, or an unparseable number).'] };
    const hold: QuoteHold = { reason: 'ask_first', at: new Date().toISOString(), by: approver, question: q.question, draftId };
    await setHold(ctx.quoteId, hold);
    await ledger({ eventType: 'quote_held', ctx, approver, runId, body: q.question, meta: { reason: 'ask_first', draftId } });
    return { ok: true, hold, draftId, runId, approver };
}

/** Call her: the ledger records the intent under Ben, the quote is held, the phone does the call. */
export async function callRequested(ctx: ExitContext): Promise<ExitResult> {
    if (!ctx.phone) return { ok: false, status: 422, errors: ['No phone on this quote.'] };
    const { approver, runId } = await approverFor(ctx.user);
    const hold: QuoteHold = { reason: 'call', at: new Date().toISOString(), by: approver };
    await setHold(ctx.quoteId, hold);
    await ledger({ eventType: 'call_requested', ctx, approver, runId, meta: { reason: 'call', from: await businessNumber() } });
    return { ok: true, hold, runId, approver, tel: ctx.phone };
}

/** Needs a visit: the survey offer (fee from settings, no link) drafted for Ben's queue instead of a price. */
export async function needsVisit(ctx: ExitContext, why: string | null): Promise<ExitResult> {
    if (!ctx.phone) return { ok: false, status: 422, errors: ['No phone on this quote.'] };
    const { getPricingSettings } = await import('../pricing-settings');
    const fee = Number((await getPricingSettings() as any).surveyFeePence);
    if (!Number.isFinite(fee) || fee <= 0) return { ok: false, status: 422, errors: ['No survey fee is set, so the offer cannot be drafted. Set it on the pricing settings page.'] };
    const { surveyOfferBody } = await import('./survey-offer');
    const body = surveyOfferBody({ firstName: ctx.firstName, feePence: fee, why: why?.trim() ? toChatVoice(why.trim()).slice(0, 120) : null }).join('\n---\n');
    const { approver, runId } = await approverFor(ctx.user);
    const { queueDraft } = await import('../message-drafts');
    const draftId = await queueDraft({ phone: ctx.phone, body, source: 'manual', reason: `Price screen: visit first instead of a price for ${ctx.slug}`, runId, dedupe: false });
    if (!draftId) return { ok: false, status: 409, errors: ['The survey offer could not be queued (opted out, or an unparseable number).'] };
    const hold: QuoteHold = { reason: 'visit', at: new Date().toISOString(), by: approver, draftId };
    await setHold(ctx.quoteId, hold);
    await ledger({ eventType: 'quote_held', ctx, approver, runId, body, meta: { reason: 'visit', draftId, surveyFeePence: fee } });
    return { ok: true, hold, draftId, runId, approver };
}

/** Sending clears any hold (Ben decided). */
export async function clearHold(quoteId: string): Promise<void> {
    await setHold(quoteId, null);
}

export const __test = { REUSE, MONEY, DATES };
