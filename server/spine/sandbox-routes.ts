/**
 * T5: /api/comms-sandbox — type as a customer, watch the desk think, nothing sent.
 *
 * Mounted in server/index.ts behind requireAdmin (NOT dev-only: the owner uses it in production
 * to reproduce the wrong-move shapes by hand and watch the spine handle them). The page is
 * client/src/pages/admin/SandboxPage.tsx; the live feed it watches is the spine's own
 * run_started / run_event / run_finished stream (server/spine/run-events.ts).
 *
 *   GET  /            the sandbox thread as it stands: messages, quote, recent runs
 *   POST /reset       delete everything on the sandbox number and start a clean thread
 *   POST /message     { text } → inbound message on the thread, then runOnce(..., { dryRun, sandbox })
 *                     returns the whole pass (triage, pack, proposal, guards, decision, exit note, cost).
 *                     T11: ALSO multipart/form-data with `text` and up to SANDBOX_MAX_FILES `media`
 *                     files (photos, videos). Each file becomes its own inbound row, written the
 *                     way server/conversation-engine.ts writes a real WhatsApp inbound: bytes in
 *                     MEDIA_DIR under a server-chosen name, mirrored to S3, `mediaUrl`
 *                     '/api/media/<file>', `mediaType` the MIME, `type` image|video, the typed text
 *                     as the caption on the first. The case file, the describer (Gemini) and the
 *                     Scoper then see exactly what they would see for a customer. The response adds
 *                     `media[]`: per item, the description the Scoper read or the one reason it did
 *                     not (off, images off, no key, over the per-pass bound, failed).
 *                     T6: when that pass was FIRST CONTACT (triage lane `rules`, the first-contact
 *                     pack), the rules layer — not the desk — answers it live, and its ack is the
 *                     outbound that makes the NEXT message the desk's. The sandbox has no rules layer
 *                     (inbounds are inserted, never ingested), so nothing ever wrote that outbound and
 *                     a clean thread stayed "first contact" forever: the Scoper was unreachable without
 *                     Seed quote. Now the ack the rules layer would have composed is MIRRORED onto the
 *                     thread as a synthetic outbound (composeFirstContactAck, pure; the ack module's
 *                     behaviour is untouched) and reported as `mirrored` so the page can say so.
 *   POST /quote       { totalPence?, title? } → a synthetic UNPAID quote on the thread plus the
 *                     "here's your quote" outbound that would have carried it, so the post-quote
 *                     pack and the four quote-dependent wrong-move shapes are reachable
 *
 * HARD SAFETY RULE (the dev board demo's rule, inherited): every read and write here is keyed on
 * the sandbox number (server/spine/sandbox.ts) and NEVER on a conversation id from the client.
 * There is no parameter that names a thread. The thread is created WITHOUT metadata.nextTriageAt,
 * so no scheduled pass can ever pick it up; runOnce itself refuses a sandbox pass on any other
 * number and never reaches the exit. Three layers, each independent — see the brief.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { agentOutcomes, agentQuestions, agentRuns, conversations, messageDrafts, messages, nudgeQueue, personalizedQuotes } from '@shared/schema';
import { MEDIA_DIR, mirrorMediaToS3 } from '../media-store';
import { DEFAULT_SPINE_CONFIG, getSpineConfig, type SpineConfig } from './config';
import { runOnce, type RunOnceResult } from './index';
import { explainMediaSelection } from './media-selection';
import { SANDBOX_DIGITS, SANDBOX_PHONE_E164, SANDBOX_PHONE_WA, isSandboxPhone } from './sandbox';
import type { MediaItem } from './types';

export const commsSandboxRouter = Router();

// ---------------------------------------------------------------- pure helpers (tested)

export const SANDBOX_CONTACT_NAME = 'Sandbox customer (not real)';
/** Sender name on the ordinary synthetic outbound (the "here's your quote" bubble). */
export const SANDBOX_SYNTHETIC_SENDER = 'Sandbox (synthetic, never sent)';
/** Sender name on a mirrored rules-layer ack — the page labels the bubble off this. */
export const SANDBOX_RULES_ACK_SENDER = 'Sandbox (rules layer ack, mirrored, never sent)';
export const SANDBOX_QUOTE_MARK = 'SANDBOX (synthetic quote, not a customer)';
export const SANDBOX_DEFAULT_TOTAL_PENCE = 48_000;
export const MAX_MESSAGE_CHARS = 2_000;

/** The one line the customer types, checked. Returns the clean text or the refusal. */
export function validateCustomerText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
    if (typeof raw !== 'string') return { ok: false, error: 'text must be a string' };
    const text = raw.replace(/\r\n/g, '\n').trim();
    if (!text) return { ok: false, error: 'text is empty' };
    if (text.length > MAX_MESSAGE_CHARS) return { ok: false, error: `text is over ${MAX_MESSAGE_CHARS} characters` };
    return { ok: true, text };
}

/**
 * T11: the message with its attachments. With files, the text is the caption and may be empty
 * (a customer often sends the photo alone); without files it is the message and may not be.
 */
export function validateCustomerMessage(raw: unknown, fileCount: number): { ok: true; text: string } | { ok: false; error: string } {
    if (fileCount > SANDBOX_MAX_FILES) return { ok: false, error: `at most ${SANDBOX_MAX_FILES} files per message` };
    if (fileCount > 0 && (raw === undefined || raw === null || raw === '')) return { ok: true, text: '' };
    const v = validateCustomerText(raw);
    if (!v.ok && fileCount > 0 && v.error === 'text is empty') return { ok: true, text: '' };
    return v;
}

// ---------------------------------------------------------------- T11: media bounds (pure, tested)

/** Files per sandbox message. Above `spine.video.maxPerRun` (6) on purpose: the over-bound case must be reachable. */
export const SANDBOX_MAX_FILES = 8;
/** WhatsApp's own media cap, the same limit server/voice-notes.ts uses. */
export const SANDBOX_MAX_FILE_BYTES = 16 * 1024 * 1024;
/** Declared MIME → stored extension. Anything else is refused before a byte is written. */
export const SANDBOX_MEDIA_TYPES: Readonly<Record<string, string>> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
};
/** The stored file is named after its message id, as a real inbound is (`<MessageSid>.<ext>`). */
export const SANDBOX_MEDIA_ID_PREFIX = 'msg_sbx_';

export function validateSandboxMediaType(mime: unknown): { ok: true; ext: string; kind: 'image' | 'video' } | { ok: false; error: string } {
    const m = typeof mime === 'string' ? mime.toLowerCase().trim() : '';
    const ext = SANDBOX_MEDIA_TYPES[m];
    if (!ext) return { ok: false, error: `${m || 'unknown type'} is not accepted: photos (jpeg, png, webp, gif, heic) or videos (mp4, mov, webm, 3gp) only` };
    return { ok: true, ext, kind: m.startsWith('video/') ? 'video' : 'image' };
}

export function sandboxMediaId(): string {
    return `${SANDBOX_MEDIA_ID_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 13)}`;
}

/** `<message id>.<ext>` — never the browser's filename, never a path. */
export function sandboxMediaFileName(id: string, mime: string): string {
    const t = validateSandboxMediaType(mime);
    if (!t.ok) throw new Error(t.error);
    if (!/^[a-z0-9_]+$/i.test(id)) throw new Error('bad media id');
    return `${id}.${t.ext}`;
}

/** The message id a stored sandbox file belongs to, or null when the name is not ours. */
export function sandboxMediaIdOf(fileName: string): string | null {
    const base = path.basename(fileName);
    if (base !== fileName) return null;
    const m = /^(msg_sbx_[a-f0-9]{13})\.[a-z0-9]{1,5}$/i.exec(base);
    return m ? m[1] : null;
}

/** multer's refusals, in words the page can show. */
export function describeUploadError(err: unknown): string {
    const e = err as { code?: string; message?: string; field?: string } | null;
    switch (e?.code) {
        case 'LIMIT_FILE_SIZE': return `a file is over ${SANDBOX_MAX_FILE_BYTES / (1024 * 1024)} MB (WhatsApp's own cap)`;
        case 'LIMIT_FILE_COUNT': case 'LIMIT_UNEXPECTED_FILE': return `at most ${SANDBOX_MAX_FILES} files per message, in the 'media' field`;
        default: return e?.message ?? 'upload refused';
    }
}

// ---------------------------------------------------------------- T11: what the desk saw (pure, tested)

export type SandboxMediaStatus = 'described' | 'cached' | 'failed' | 'over_bound' | 'off' | 'images_off' | 'no_key' | 'unsupported' | 'missing';

export interface SandboxMediaReport {
    id: string;
    kind: MediaItem['kind'];
    url: string | null;
    /** What the Scoper read, verbatim from the case file; null is the whole finding. */
    description: string | null;
    status: SandboxMediaStatus;
    /** One line for the page: why there is a description, or why not. */
    note: string;
    /** The vision row for THIS pass, when one was written (a cache hit writes none). */
    vision: { runId: string; costPence: number | null; error: string | null } | null;
}

export interface SandboxVideoStatus extends SpineConfig['video'] {
    /** GEMINI_API_KEY (or GOOGLE_API_KEY) is set on THIS server — the one running the sandbox. */
    keyPresent: boolean;
}

export const MEDIA_STATUS_NOTE: Record<SandboxMediaStatus, string> = {
    described: 'Described on this pass by Gemini. This text is exactly what the Scoper read.',
    cached: 'Description came from the cache (identical bytes were described on an earlier pass). No model call, no cost. This text is exactly what the Scoper read.',
    failed: 'Description FAILED on this pass: the Scoper saw this item as bare media with no description. The vision row records the error; the server log has the describe_video line.',
    over_bound: 'NOT described: outside the per-pass bound. Only the last maxPerRun eligible items on the thread are described; this earlier one was dropped. The Scoper saw bare media.',
    off: 'NOT described: spine.video.enabled is off on this server, so no media is described. The Scoper saw bare media.',
    images_off: 'NOT described: spine.video.images is off, so photos are skipped (videos are still described). The Scoper saw bare media.',
    no_key: 'NOT described: GEMINI_API_KEY is not set on this server, so the describer has nothing to call. The Scoper saw bare media.',
    unsupported: 'NOT described: only photos and videos are described. The Scoper saw bare media.',
    missing: 'NOT described and no vision row was written: the describer threw or was unavailable before it could record anything. Check the server log for [describe_video] / [Spine] describe_video. The Scoper saw bare media.',
};

/**
 * Per media item on the case file: the description the Scoper read, or the one reason there is
 * none. Reads the SAME selection rule buildCaseFile used (media-selection.ts), so the report
 * cannot say "described" of something that was dropped, or "dropped" of something described.
 */
export function mediaReportFor(
    media: readonly MediaItem[],
    video: SandboxVideoStatus,
    visionRows: readonly { id: string; mediaId: string | null; decision: string | null; error: string | null; costPence: number | null }[],
): SandboxMediaReport[] {
    const selection = explainMediaSelection(media, { images: !!video.images, maxPerRun: video.maxPerRun ?? DEFAULT_SPINE_CONFIG.video.maxPerRun });
    return media.map((m) => {
        const row = visionRows.find((r) => r.mediaId === m.id) ?? null;
        const vision = row ? { runId: row.id, costPence: row.costPence ?? null, error: row.error ?? null } : null;
        const description = m.description ?? null;
        let status: SandboxMediaStatus;
        if (description) status = row ? 'described' : 'cached';
        else if (!video.enabled) status = 'off';
        else {
            const why = selection.get(m.id) ?? 'unsupported';
            if (why === 'images_off') status = 'images_off';
            else if (why === 'unsupported' || why === 'no_url') status = 'unsupported';
            else if (why === 'over_bound') status = 'over_bound';
            else if (!video.keyPresent) status = 'no_key';
            else if (row && (row.decision === 'failed' || row.error)) status = 'failed';
            else status = 'missing';
        }
        const note = status === 'failed' && vision?.error ? `${MEDIA_STATUS_NOTE.failed} Error: ${vision.error}` : MEDIA_STATUS_NOTE[status];
        return { id: m.id, kind: m.kind, url: m.url ?? null, description, status, note, vision };
    });
}

export function geminiKeyPresent(env: NodeJS.ProcessEnv = process.env): boolean {
    return !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
}

/** A synthetic quote's numbers, checked: a whole number of pence between £1 and £20,000. */
export function validateQuoteSeed(body: unknown): { ok: true; totalPence: number; title: string } | { ok: false; error: string } {
    const b = (body && typeof body === 'object' ? body : {}) as { totalPence?: unknown; title?: unknown };
    const totalPence = b.totalPence === undefined ? SANDBOX_DEFAULT_TOTAL_PENCE : Number(b.totalPence);
    if (!Number.isInteger(totalPence) || totalPence < 100 || totalPence > 2_000_000) return { ok: false, error: 'totalPence must be a whole number of pence between 100 and 2000000' };
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 120) : 'Replace bathroom extractor fan';
    return { ok: true, totalPence, title };
}

/**
 * T6: did this pass land on the rules layer's first-contact answer? If so the sandbox must do what
 * the rules layer does live — put the ack on the thread — or the desk never gets a turn. Pure:
 * reads the pass alone. Only the two intents the ack can carry on a message; a missed call or a
 * returning customer cannot arise from typing into the sandbox.
 */
export function firstContactMirrorFor(run: Pick<RunOnceResult, 'triage' | 'pack' | 'decision'>): { intent: 'ack_enquiry' | 'ack_photos' } | null {
    if (run.triage.lane !== 'rules') return null;
    if (run.pack.id !== 'rules.first_contact') return null;
    if (run.decision.kind !== 'none') return null;
    const intent = run.triage.intent;
    if (intent !== 'ack_enquiry' && intent !== 'ack_photos') return null;
    return { intent };
}

export interface SandboxMirror {
    kind: 'first_contact_ack';
    intent: 'ack_enquiry' | 'ack_photos';
    body: string;
    messageId: string;
    note: string;
}

export const MIRROR_NOTE = 'First contact is answered by the rules layer (the first-contact ack), not by the desk. Live, the customer would have received the line below. The sandbox has placed it on the thread so your next message reaches the desk, as it would live.';

/** The slug is 8 chars max on the column; `sbx` marks it at a glance. */
export function sandboxSlug(): string {
    return `sbx${randomUUID().replace(/-/g, '').slice(0, 5)}`;
}

/** What the page shows of a pass: everything the spine decided, none of the case file's bulk. */
export function summariseRun(run: RunOnceResult, cost: { costPence: number | null; model: string | null; turns: number | null } | null) {
    return {
        runId: run.runId,
        agent: run.agent,
        trigger: run.trigger,
        pack: run.pack,
        triage: run.triage,
        proposal: run.proposal ?? null,
        guards: run.guards ?? null,
        decision: run.decision,
        dryRun: run.dryRun ?? true,
        sandbox: run.sandbox ?? true,
        exitNote: run.exitNote ?? null,
        skipped: run.skipped ?? [],
        error: run.error ?? null,
        durationMs: run.durationMs ?? null,
        costPence: cost?.costPence ?? null,
        model: cost?.model ?? null,
        turns: cost?.turns ?? null,
        caseFile: {
            stage: run.caseFile.stage, tags: run.caseFile.tags, quote: run.caseFile.quote ?? null,
            window: run.caseFile.window, openFlags: run.caseFile.openFlags, openPromises: run.caseFile.openPromises,
            timelineItems: run.caseFile.timeline.length,
        },
        benLaneClerk: run.benLaneClerk ?? null,
        routeA: run.routeA ?? null,
    };
}

export type SandboxRunSummary = ReturnType<typeof summariseRun>;

// ---------------------------------------------------------------- the thread, by number only

async function findSandboxConversation() {
    const [row] = await db.select({
        id: conversations.id, phoneNumber: conversations.phoneNumber, stage: conversations.stage, tags: conversations.tags,
        contactName: conversations.contactName, createdAt: conversations.createdAt, metadata: conversations.metadata,
    }).from(conversations).where(eq(conversations.phoneNumber, SANDBOX_PHONE_WA)).orderBy(desc(conversations.createdAt)).limit(1);
    // Belt: the row we found by number IS on the sandbox number. It cannot not be; this is the
    // check that would fire if the constants above ever drifted apart.
    if (row && !isSandboxPhone(row.phoneNumber)) throw new Error('sandbox conversation is not on the sandbox number');
    return row ?? null;
}

async function loadState() {
    const conv = await findSandboxConversation();
    const msgs = conv ? await db.select({
        id: messages.id, direction: messages.direction, content: messages.content, createdAt: messages.createdAt,
        senderName: messages.senderName, channel: messages.channel,
        type: messages.type, mediaUrl: messages.mediaUrl, mediaType: messages.mediaType,
    }).from(messages).where(eq(messages.conversationId, conv.id)).orderBy(messages.createdAt).limit(200) : [];
    const quotes = await db.select({
        id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, jobDescription: personalizedQuotes.jobDescription,
        basePrice: personalizedQuotes.basePrice, expiresAt: personalizedQuotes.expiresAt, createdAt: personalizedQuotes.createdAt,
        depositPaidAt: personalizedQuotes.depositPaidAt, revokedAt: personalizedQuotes.revokedAt,
    }).from(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`)
        .orderBy(desc(personalizedQuotes.createdAt)).limit(5);
    const runs = conv ? await db.select({
        id: agentRuns.id, agent: agentRuns.agent, trigger: agentRuns.trigger, decision: agentRuns.decision, lane: agentRuns.lane,
        costPence: agentRuns.costPence, model: agentRuns.model, durationMs: agentRuns.durationMs, error: agentRuns.error,
        startedAt: agentRuns.startedAt, finishedAt: agentRuns.finishedAt, proposal: agentRuns.proposal, parentRunId: agentRuns.parentRunId,
    }).from(agentRuns).where(and(eq(agentRuns.conversationId, conv.id), sql`${agentRuns.parentRunId} IS NULL`))
        .orderBy(desc(agentRuns.startedAt)).limit(20) : [];
    return {
        phone: { e164: SANDBOX_PHONE_E164, wa: SANDBOX_PHONE_WA },
        video: await videoStatus(),
        conversation: conv ? { id: conv.id, stage: conv.stage, tags: conv.tags ?? [], contactName: conv.contactName, createdAt: conv.createdAt, hasTrigger: !!(conv.metadata as any)?.nextTriageAt } : null,
        messages: msgs,
        quote: quotes[0] ?? null,
        runs: runs.map((r) => {
            const p = (r.proposal ?? {}) as any;
            return {
                id: r.id, agent: r.agent, trigger: r.trigger, decision: r.decision, lane: r.lane, costPence: r.costPence, model: r.model,
                durationMs: r.durationMs, error: r.error, startedAt: r.startedAt, finishedAt: r.finishedAt,
                sandbox: p?.sandbox === true, intent: p?.proposal?.intent ?? null, bubbles: Array.isArray(p?.proposal?.body) ? p.proposal.body : [],
            };
        }),
    };
}

/** T11: the sandbox's read of this server's description switch and key — read-only, never changed here. */
async function videoStatus(): Promise<SandboxVideoStatus> {
    const cfg = await getSpineConfig().catch(() => DEFAULT_SPINE_CONFIG);
    const video = { ...DEFAULT_SPINE_CONFIG.video, ...(cfg.video ?? {}) };
    return { ...video, keyPresent: geminiKeyPresent() };
}

interface InboundMedia { id: string; url: string; mimeType: string; kind: 'image' | 'video' }

/**
 * One inbound row. With `media`, the row is shaped exactly as server/conversation-engine.ts
 * shapes a real WhatsApp media inbound (id = the file's stem, type image|video, mediaUrl
 * '/api/media/<file>', mediaType the MIME, content the caption or '').
 */
async function insertInbound(conversationId: string, content: string, media?: InboundMedia): Promise<string> {
    const id = media?.id ?? `msg_sbx_${randomUUID().slice(0, 13)}`;
    const now = new Date();
    await db.insert(messages).values({
        id, conversationId, direction: 'inbound', channel: 'whatsapp', content, status: 'received',
        senderName: SANDBOX_CONTACT_NAME, createdAt: now,
        type: media ? media.kind : 'text',
        mediaUrl: media?.url ?? null,
        mediaType: media?.mimeType ?? null,
    });
    await db.update(conversations).set({
        lastMessageAt: now, lastMessagePreview: (content || (media ? 'Media received' : '')).slice(0, 200), lastCustomerContactAt: now,
        lastInboundAt: now, // channel IS whatsapp, so the 24h window reads as open — as it would live
        unreadCount: sql`coalesce(${conversations.unreadCount}, 0) + 1`, updatedAt: now,
    }).where(eq(conversations.id, conversationId));
    return id;
}

async function insertOutbound(conversationId: string, content: string, senderName: string = SANDBOX_SYNTHETIC_SENDER): Promise<string> {
    const id = `msg_sbx_${randomUUID().slice(0, 13)}`;
    const now = new Date();
    await db.insert(messages).values({
        id, conversationId, direction: 'outbound', channel: 'whatsapp', content, status: 'sent',
        senderName, createdAt: now,
    });
    await db.update(conversations).set({ lastMessageAt: now, lastMessagePreview: content.slice(0, 200), updatedAt: now })
        .where(eq(conversations.id, conversationId));
    return id;
}

/** Everything on the sandbox number, gone. The dev board demo's cleanup, on the sandbox number. */
async function cleanupSandbox(): Promise<{ conversations: number; quotes: number; files: number }> {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.phoneNumber, SANDBOX_PHONE_WA));
    const ids = convs.map((c) => c.id);
    let files = 0;
    if (ids.length) {
        // T11: the uploaded bytes go too — only files named as ours (msg_sbx_<id>.<ext>), only from
        // MEDIA_DIR, so a row that somehow pointed elsewhere could never delete a customer's photo.
        const mediaRows = await db.select({ mediaUrl: messages.mediaUrl }).from(messages)
            .where(and(inArray(messages.conversationId, ids), sql`${messages.mediaUrl} IS NOT NULL`));
        for (const r of mediaRows) {
            const file = path.basename(r.mediaUrl ?? '');
            if (!sandboxMediaIdOf(file)) continue;
            try { fs.unlinkSync(path.join(MEDIA_DIR, file)); files++; } catch { /* already gone */ }
        }
        await db.delete(messages).where(inArray(messages.conversationId, ids));
        await db.delete(agentQuestions).where(inArray(agentQuestions.conversationId, ids));
        await db.delete(agentOutcomes).where(inArray(agentOutcomes.conversationId, ids));
        await db.delete(agentRuns).where(inArray(agentRuns.conversationId, ids));
        await db.delete(conversations).where(inArray(conversations.id, ids));
    }
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, SANDBOX_PHONE_E164));
    await db.delete(nudgeQueue).where(eq(nudgeQueue.phone, SANDBOX_PHONE_E164));
    const quotes = await db.delete(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`)
        .returning({ id: personalizedQuotes.id });
    return { conversations: ids.length, quotes: quotes.length, files };
}

async function createSandboxConversation(): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    // Same shape as the dev board demo's new-card, WITHOUT metadata.nextTriageAt: nothing must
    // ever arm the triage ticker on this row.
    await db.insert(conversations).values({
        id, phoneNumber: SANDBOX_PHONE_WA, contactName: SANDBOX_CONTACT_NAME, stage: 'enquiry',
        tags: ['sandbox'], lastMessageAt: now, lastCustomerContactAt: now,
        notes: 'COMMS SANDBOX — a play thread on the Ofcom drama number. Not a customer. Nothing here is ever sent.',
    });
    return id;
}

async function ensureSandboxConversation(): Promise<string> {
    const conv = await findSandboxConversation();
    return conv?.id ?? createSandboxConversation();
}

/** The row's own cost (B2 records it; turns live on the ledger only, so they are not read here). */
async function costOf(runId: string) {
    const [row] = await db.select({ costPence: agentRuns.costPence, model: agentRuns.model })
        .from(agentRuns).where(eq(agentRuns.id, runId));
    return row ? { costPence: row.costPence ?? null, model: row.model ?? null, turns: null } : null;
}

// ---------------------------------------------------------------- routes

commsSandboxRouter.get('/', async (_req, res) => {
    try {
        res.json(await loadState());
    } catch (error: any) {
        console.error('[Sandbox] state failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox state failed' });
    }
});

commsSandboxRouter.post('/reset', async (_req, res) => {
    try {
        const deleted = await cleanupSandbox();
        const conversationId = await createSandboxConversation();
        res.json({ ok: true, deleted, conversationId, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] reset failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox reset failed' });
    }
});

commsSandboxRouter.post('/quote', async (req, res) => {
    try {
        const seed = validateQuoteSeed(req.body);
        if (!seed.ok) { res.status(400).json({ error: seed.error }); return; }
        const conversationId = await ensureSandboxConversation();
        const slug = sandboxSlug();
        const now = new Date();
        await db.insert(personalizedQuotes).values({
            id: `sbx_${randomUUID()}`,
            shortSlug: slug,
            customerName: SANDBOX_CONTACT_NAME,
            phone: SANDBOX_PHONE_E164,
            jobDescription: `${SANDBOX_QUOTE_MARK}: ${seed.title}`,
            basePrice: seed.totalPence,
            pricingLineItems: [{ description: seed.title, pricePence: seed.totalPence, sandbox: true }],
            expiresAt: new Date(now.getTime() + 48 * 3_600_000),
            isDraft: false,
            createdAt: now,
        } as any);
        // The message that would have carried the link (quote-context dates the quote from it).
        const outboundId = await insertOutbound(conversationId, `Hi! Here's your quote for £${(seed.totalPence / 100).toFixed(2)}. Click to view and book: https://www.handyservices.app/q/${slug}`);
        await db.update(conversations).set({ stage: 'quote_sent', updatedAt: new Date() }).where(eq(conversations.id, conversationId));
        res.json({ ok: true, slug, outboundId, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] quote seed failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox quote seed failed' });
    }
});

// ---------------------------------------------------------------- T11: the upload

/**
 * multer, bounded: the declared type must be in SANDBOX_MEDIA_TYPES (checked in fileFilter before
 * a byte is written), SANDBOX_MAX_FILE_BYTES per file, SANDBOX_MAX_FILES per message. The bytes
 * land in MEDIA_DIR — the same directory a real inbound is written to and /api/media serves — under
 * a name this server chose (sandboxMediaFileName); the browser's filename is never used. A JSON
 * body passes straight through: multer only parses multipart.
 */
const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); cb(null, MEDIA_DIR); } catch (e) { cb(e as Error, MEDIA_DIR); }
        },
        filename: (_req, file, cb) => {
            try { cb(null, sandboxMediaFileName(sandboxMediaId(), file.mimetype)); } catch (e) { cb(e as Error, ''); }
        },
    }),
    limits: { fileSize: SANDBOX_MAX_FILE_BYTES, files: SANDBOX_MAX_FILES, fields: 5 },
    fileFilter: (_req, file, cb) => {
        const t = validateSandboxMediaType(file.mimetype);
        if (t.ok) cb(null, true); else cb(new Error(t.error));
    },
});

function removeUploaded(files: readonly { path: string }[] | undefined): void {
    for (const f of files ?? []) { try { fs.unlinkSync(f.path); } catch { /* already gone */ } }
}

function parseSandboxUpload(req: Request, res: Response, next: NextFunction): void {
    if (!req.is('multipart/form-data')) { next(); return; }
    upload.array('media', SANDBOX_MAX_FILES)(req, res, (err: unknown) => {
        if (err) {
            removeUploaded(req.files as Express.Multer.File[] | undefined);
            res.status(400).json({ error: describeUploadError(err) });
            return;
        }
        next();
    });
}

/** The vision rows this pass wrote (one per model call; a cache hit writes none). */
async function visionRowsOf(runId: string) {
    const rows = await db.select({ id: agentRuns.id, decision: agentRuns.decision, error: agentRuns.error, costPence: agentRuns.costPence, proposal: agentRuns.proposal })
        .from(agentRuns).where(and(eq(agentRuns.parentRunId, runId), eq(agentRuns.agent, 'vision')));
    return rows.map((r) => ({ id: r.id, decision: r.decision ?? null, error: r.error ?? null, costPence: r.costPence ?? null, mediaId: ((r.proposal ?? {}) as { mediaId?: string }).mediaId ?? null }));
}

commsSandboxRouter.post('/message', parseSandboxUpload, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
        const v = validateCustomerMessage(req.body?.text, files.length);
        if (!v.ok) { removeUploaded(files); res.status(400).json({ error: v.error }); return; }
        const conversationId = await ensureSandboxConversation();
        const messageIds: string[] = [];
        if (!files.length) {
            messageIds.push(await insertInbound(conversationId, v.text));
        } else {
            // One row per file, in the order attached, the text as the first one's caption — the
            // Twilio shape (Body + MediaUrl0). Mirrored to S3 like a real inbound: never throws.
            for (const [i, f] of files.entries()) {
                const id = sandboxMediaIdOf(f.filename);
                const t = validateSandboxMediaType(f.mimetype);
                if (!id || !t.ok) throw new Error(`stored file ${f.filename} is not a sandbox media file`);
                await mirrorMediaToS3(f.filename, fs.readFileSync(f.path), f.mimetype);
                messageIds.push(await insertInbound(conversationId, i === 0 ? v.text : '', { id, url: `/api/media/${f.filename}`, mimeType: f.mimetype, kind: t.kind }));
            }
        }
        const messageId = messageIds[0];
        // Layer 1 at the call site AND inside runOnce (sandbox implies dryRun): the exit never runs.
        const run = await runOnce(conversationId, 'inbound_message', undefined, { dryRun: true, sandbox: true });
        const summary = summariseRun(run, await costOf(run.runId));
        // T11: what the desk saw of each photo or video — the description, or why there is none.
        const video = await videoStatus();
        const media = mediaReportFor(run.caseFile.media, video, await visionRowsOf(run.runId).catch(() => []));
        // T6: first contact — mirror the rules layer's ack so the thread can leave the rules lane.
        let mirrored: SandboxMirror | null = null;
        const mirror = firstContactMirrorFor(run);
        if (mirror) {
            const { composeFirstContactAck } = await import('../first-contact-ack');
            const ack = composeFirstContactAck({ intent: mirror.intent, contactName: null });
            const ackId = await insertOutbound(conversationId, ack.body, SANDBOX_RULES_ACK_SENDER);
            mirrored = { kind: 'first_contact_ack', intent: mirror.intent, body: ack.body, messageId: ackId, note: MIRROR_NOTE };
        }
        res.json({ ok: true, messageId, messageIds, run: summary, mirrored, media, video, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] message failed:', error);
        removeUploaded(files);
        res.status(500).json({ error: error?.message ?? 'sandbox message failed' });
    }
});
