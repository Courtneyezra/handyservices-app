/**
 * The case file (design §3.2): ONE immutable object per run, the ONLY thing any agent reads.
 * Replaces get_thread / get_customer_context / conversation_memory. Persisted by content hash
 * under server/storage/case-files/<hash>.json (gitignored) so a run is replayable against exactly
 * what the agent saw; `agent_runs.case_file_ref` stores the hash.
 */
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '../db';
import { conversations, messages, calls, agentQuestions, agentRuns, messageDrafts, serviceClients } from '@shared/schema';
import { and, desc, eq, sql, isNull, inArray } from 'drizzle-orm';
import { notQuarantined } from '../message-quarantine';
import { getSpineConfig } from './config';
import { isException, isAgentName } from './vocab';
import type { CaseFile, TimelineItem, MediaItem, Audience, Stage, ExceptionKind } from './types';
import type { MediaBlock } from '../agents/media-context';

export const CASE_FILE_DIR = process.env.CASE_FILE_DIR || path.join(process.cwd(), 'server', 'storage', 'case-files');
const TIMELINE_LIMIT = 80;
const CALLS_LIMIT = 8;
const TRANSCRIPT_CHARS = 4000;

// ---------------------------------------------------------------- pure helpers

/** JSON with keys sorted at every level, so the same content always hashes the same. */
export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function hashCaseFile(file: Omit<CaseFile, 'hash' | 'builtAt'>): string {
    return createHash('sha256').update(stableStringify(file)).digest('hex');
}

export function audienceOf(roleProfile: string | null | undefined): Audience {
    switch ((roleProfile ?? '').toLowerCase()) {
        case 'contractor': return 'contractor';
        case 'supplier': return 'supplier';
        case 'internal': return 'internal';
        default: return 'customer';
    }
}

/** conversations.stage is a free-ish varchar from several eras; fold it onto the spine's Stage. */
export function stageOf(stage: string | null | undefined): Stage {
    switch ((stage ?? '').toLowerCase()) {
        case 'won': return 'won';
        case 'closed': case 'archived': case 'lost': return 'closed';
        case 'booked': case 'scheduled': return 'booked';
        case 'quote_sent': case 'quoted': return 'quote_sent';
        case 'scoping': case 'active': case 'waiting': return 'scoping';
        default: return 'enquiry';
    }
}

function channelOf(channel: string | null | undefined): TimelineItem['channel'] {
    switch ((channel ?? 'whatsapp').toLowerCase()) {
        case 'sms': return 'sms';
        case 'call': return 'call';
        case 'email': return 'email';
        case 'webform': case 'webchat': return 'webchat';
        case 'note': return 'note';
        default: return 'whatsapp';
    }
}

function mediaKind(mediaType: string | null | undefined, type?: string | null): MediaItem['kind'] {
    const t = (mediaType ?? type ?? '').toLowerCase();
    if (t.startsWith('image')) return 'image';
    if (t.startsWith('video')) return 'video';
    if (t.startsWith('audio')) return 'audio';
    return 'document';
}

/** A flag written by the spine carries `[exception] note`; a legacy flag is read from the thread's tags. */
export function parseFlagException(question: string | null | undefined, tags: readonly string[]): ExceptionKind {
    const m = /^\[([a-z_]+)\]/.exec(question ?? '');
    if (m && isException(m[1])) return m[1];
    if (tags.includes('trust_concern')) return 'trust_concern';
    if (tags.includes('callback_requested')) return 'callback_requested';
    return 'out_of_scope';
}

// ---------------------------------------------------------------- the assembler

export interface BuildCaseFileOpts {
    /** P6: the spine run building this file; stamped on any vision (describe_video) rows as parent_run_id. */
    parentRunId?: string | null;
}

export async function buildCaseFile(conversationId: string, opts: BuildCaseFileOpts = {}): Promise<CaseFile> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) throw new Error(`[Spine] conversation ${conversationId} not found`);
    const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
    if (!digits) throw new Error(`[Spine] conversation ${conversationId} has no usable phone`);
    const phone = `+${digits}`;
    const tags = ((conv.tags as string[] | null) ?? []).slice();
    const cfg = await getSpineConfig();

    // ---- timeline: messages (quarantined excluded) + calls, oldest first ----
    const msgRows = (await db.select({
        id: messages.id, direction: messages.direction, content: messages.content, channel: messages.channel,
        type: messages.type, mediaUrl: messages.mediaUrl, mediaType: messages.mediaType, createdAt: messages.createdAt,
    }).from(messages)
        .where(and(eq(messages.conversationId, conv.id), notQuarantined))
        .orderBy(desc(messages.createdAt)).limit(TIMELINE_LIMIT)).reverse();

    const callRows = await db.select({
        id: calls.id, direction: calls.direction, startTime: calls.startTime, transcription: calls.transcription,
        jobSummary: calls.jobSummary, duration: calls.duration,
    }).from(calls)
        .where(sql`regexp_replace(${calls.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`)
        .orderBy(desc(calls.startTime)).limit(CALLS_LIMIT);

    const pendingDrafts = await db.select({ id: messageDrafts.id, body: messageDrafts.body, createdAt: messageDrafts.createdAt, dueAt: messageDrafts.dueAt })
        .from(messageDrafts)
        .where(and(eq(messageDrafts.phone, phone), inArray(messageDrafts.status, ['pending', 'approved'])))
        .orderBy(desc(messageDrafts.createdAt)).limit(5);

    const flagRows = await db.select({ id: agentQuestions.id, question: agentQuestions.question, createdAt: agentQuestions.createdAt, dueAt: agentQuestions.dueAt })
        .from(agentQuestions)
        .where(and(eq(agentQuestions.conversationId, conv.id), eq(agentQuestions.status, 'flagged'), isNull(agentQuestions.expiredAt)))
        .orderBy(desc(agentQuestions.createdAt)).limit(5);

    const media: MediaItem[] = [];
    const timeline: TimelineItem[] = [];
    for (const m of msgRows) {
        const at = (m.createdAt ?? new Date()).toISOString();
        const inbound = m.direction === 'inbound';
        const item: TimelineItem = {
            at, kind: inbound ? 'message_in' : 'message_out', channel: channelOf(m.channel),
            body: m.content ?? undefined, by: inbound ? 'customer' : undefined,
        };
        if (m.mediaUrl) {
            media.push({ id: m.id, kind: mediaKind(m.mediaType, m.type), url: m.mediaUrl, description: undefined });
            item.mediaIds = [m.id];
        }
        timeline.push(item);
    }
    for (const c of callRows) {
        const outbound = (c.direction ?? '').toLowerCase().startsWith('out');
        timeline.push({
            at: c.startTime.toISOString(), kind: outbound ? 'call_out' : 'call_in', channel: 'call',
            body: c.jobSummary ?? undefined, by: outbound ? undefined : 'customer',
            transcript: c.transcription ? c.transcription.slice(0, TRANSCRIPT_CHARS) : undefined,
        });
    }
    for (const d of pendingDrafts) {
        timeline.push({ at: d.createdAt.toISOString(), kind: 'draft_pending', body: d.body });
    }
    for (const f of flagRows) {
        timeline.push({ at: f.createdAt.toISOString(), kind: 'flag', body: f.question });
    }
    timeline.sort((a, b) => a.at.localeCompare(b.at));

    // Phase 4: video descriptions (Gemini, direct) on the media items — only when switched on,
    // bounded per run, cached by bytes, and never able to fail the build.
    if (cfg.video?.enabled) {
        await describeCaseFileMedia(media, msgRows, { conversationId: conv.id, phone, images: !!cfg.video.images, maxPerRun: cfg.video.maxPerRun ?? 3, parentRunId: opts.parentRunId ?? null });
    }

    // ---- window + channel ----
    const lastIn = [...msgRows].reverse().find((m) => m.direction === 'inbound');
    const lastInboundAt = lastIn?.createdAt?.toISOString() ?? conv.lastInboundAt?.toISOString() ?? null;
    const lastInChannel = lastIn ? channelOf(lastIn.channel) : 'whatsapp';
    const channelLastUsed: CaseFile['window']['channelLastUsed'] =
        lastInChannel === 'sms' ? 'sms' : lastInChannel === 'email' ? 'email' : lastInChannel === 'webchat' ? 'webchat' : 'whatsapp';
    let canFreeform = false;
    try {
        const { canSendFreeform } = await import('../meta-whatsapp');
        canFreeform = await canSendFreeform(phone);
    } catch (error: any) {
        console.warn('[Spine] window check failed (assuming shut):', error?.message ?? error);
    }

    // ---- client ----
    let client: CaseFile['client'] = null;
    if (conv.clientId) {
        const [c] = await db.select({ id: serviceClients.id, displayName: serviceClients.displayName })
            .from(serviceClients).where(eq(serviceClients.id, conv.clientId));
        if (c) client = { id: c.id, name: c.displayName ?? null };
    }

    // ---- quote ----
    let quote: CaseFile['quote'] = null;
    try {
        const { loadQuoteContexts } = await import('../agents/quote-context');
        const all = await loadQuoteContexts({ digits, conversationId: conv.id });
        const q = all.find((x) => x.isLive) ?? all[0] ?? null;
        if (q) {
            quote = {
                slug: q.slug, total: q.totalGBP, lines: q.lineItems.length + (q.lineItemsTruncated ?? 0),
                viewedAt: q.lastViewedAt, expiresAt: q.expiresAt, paid: q.depositPaid,
            };
        }
    } catch (error: any) {
        console.warn('[Spine] quote context failed (case file has no quote):', error?.message ?? error);
    }

    // ---- promises, flags, last run ----
    const meta = (conv.metadata ?? {}) as Record<string, any>;
    const oc = meta.openCommitment as { summary?: string; dueAt?: string } | undefined;
    const openPromises = oc?.summary && oc.dueAt ? [{ text: String(oc.summary), dueAt: String(oc.dueAt) }] : [];
    const openFlags = flagRows.map((f) => ({
        exception: parseFlagException(f.question, tags),
        note: (f.question ?? '').replace(/^\[[a-z_]+\]\s*/, '').slice(0, 500),
        dueAt: f.dueAt?.toISOString() ?? '',
    }));
    const [last] = await db.select({ id: agentRuns.id, agent: agentRuns.agent, decision: agentRuns.decision, startedAt: agentRuns.startedAt, finishedAt: agentRuns.finishedAt })
        .from(agentRuns).where(eq(agentRuns.conversationId, conv.id)).orderBy(desc(agentRuns.startedAt)).limit(1);
    const lastRun = last && isAgentName(last.agent)
        ? { runId: last.id, agent: last.agent, decision: last.decision ?? (last.finishedAt ? 'finished' : 'running'), at: last.startedAt.toISOString() }
        : null;

    const body: Omit<CaseFile, 'hash' | 'builtAt'> = {
        conversationId: conv.id,
        phone,
        audience: audienceOf(conv.roleProfile),
        stage: stageOf(conv.stage),
        city: cfg.city,
        contactName: conv.contactName ?? null,
        timeline,
        media,
        window: { canFreeform, templateRequired: !canFreeform, lastInboundAt, channelLastUsed },
        client,
        quote,
        openPromises,
        openFlags,
        tags,
        lastRun,
    };
    const file: CaseFile = { ...body, hash: hashCaseFile(body), builtAt: new Date().toISOString() };
    await persistCaseFile(file);
    return file;
}

/**
 * Phase 4: put a Gemini description on each recent video (and photo, if configured). One child
 * agent_runs row (agent 'vision') per model call with token usage and cost; a cache hit costs
 * nothing and writes no row. Never throws: a failed description is a missing description.
 */
async function describeCaseFileMedia(
    media: MediaItem[],
    rows: { id: string; content: string | null; mediaType: string | null }[],
    ctx: { conversationId: string; phone: string; images: boolean; maxPerRun: number; parentRunId?: string | null },
): Promise<void> {
    const targets = media
        .filter((m) => !!m.url && (m.kind === 'video' || (ctx.images && m.kind === 'image')))
        .slice(-Math.max(1, ctx.maxPerRun));
    if (!targets.length) return;
    let tools: typeof import('./tools/describe-video');
    try {
        tools = await import('./tools/describe-video');
    } catch (error: any) {
        console.warn('[Spine] describe_video unavailable:', error?.message ?? error);
        return;
    }
    for (const m of targets) {
        const row = rows.find((r) => r.id === m.id);
        const startedAt = Date.now();
        let result: Awaited<ReturnType<typeof tools.describeMedia>> = null;
        try {
            result = await tools.describeMedia({
                url: m.url, kind: m.kind === 'image' ? 'image' : 'video', mediaId: m.id,
                mimeType: row?.mediaType ?? undefined, customerContext: row?.content ?? null,
            });
        } catch (error: any) {
            console.warn(`[Spine] describe_video threw for ${m.id} (ignored):`, error?.message ?? error);
        }
        if (result) m.description = tools.formatDescription(result.description);
        if (result?.cached) continue; // no call, no cost, no row
        try {
            const { startAgentRun, finishAgentRun } = await import('../agent-runs');
            const runId = await startAgentRun({
                agent: 'vision', trigger: 'describe_media', conversationId: ctx.conversationId, phone: ctx.phone,
                model: tools.GEMINI_MODEL, transcriptRef: `media:${m.id}`, parentRunId: ctx.parentRunId ?? null,
            });
            await finishAgentRun(runId, { agent: 'vision', conversationId: ctx.conversationId, phone: ctx.phone }, {
                usage: result?.usage ?? null, model: tools.GEMINI_MODEL,
                error: result ? null : 'no description (see describe_video log)',
                durationMs: result?.durationMs ?? Date.now() - startedAt,
                decision: result ? 'described' : 'failed',
                proposal: {
                    mediaId: m.id, kind: m.kind, bytes: result?.bytes ?? null, hash: result?.hash ?? null,
                    transport: result?.transport ?? null, attempts: result?.attempts ?? null, description: result?.description ?? null,
                },
            });
        } catch (error: any) {
            console.warn(`[Spine] vision run row not recorded for ${m.id}:`, error?.message ?? error);
        }
    }
}

/** Write <hash>.json once; a second run over identical content is a no-op. Never throws. */
export async function persistCaseFile(file: CaseFile, dir: string = CASE_FILE_DIR): Promise<string | null> {
    const target = path.join(dir, `${file.hash}.json`);
    try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(target, JSON.stringify(file, null, 2), { flag: 'wx' });
        return target;
    } catch (error: any) {
        if (error?.code === 'EEXIST') return target;
        console.warn('[Spine] case file not persisted:', error?.message ?? error);
        return null;
    }
}

/** Read a persisted case file back by hash (replay). */
export async function loadCaseFile(hash: string, dir: string = CASE_FILE_DIR): Promise<CaseFile | null> {
    try {
        return JSON.parse(await fs.readFile(path.join(dir, `${hash}.json`), 'utf8')) as CaseFile;
    } catch {
        return null;
    }
}

/** Image blocks for a model call (reuses media-context: EXIF-rotated JPEGs, video keyframes). Video descriptions arrive in Phase 4. */
export async function loadCaseFileImageBlocks(file: CaseFile): Promise<MediaBlock[]> {
    const atById = new Map<string, string>();
    for (const t of file.timeline) for (const id of t.mediaIds ?? []) atById.set(id, t.at);
    const items = file.media
        .filter((m) => (m.kind === 'image' || m.kind === 'video') && m.url)
        .map((m) => ({ mediaUrl: m.url!, mediaType: m.kind === 'image' ? 'image/jpeg' : 'video/mp4', direction: 'inbound', createdAt: atById.get(m.id) ?? null }));
    if (!items.length) return [];
    const { buildMediaBlocks } = await import('../agents/media-context');
    return buildMediaBlocks(items);
}
