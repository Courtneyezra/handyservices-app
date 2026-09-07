/**
 * describe_video (Phase 4, COMMS_AGENTS_V3_DESIGN §3.8): a customer's video or photo → a fixed,
 * validated description the case file can carry and an agent can read.
 *
 *   describeMedia({ path | url, kind }) → { whatIsShown, whatIsMissing[], defects[], textFound[], confidence } | null
 *
 * Calls Gemini 3.6 Flash DIRECTLY over HTTPS (`generateContent`, v1beta) with `GEMINI_API_KEY`
 * (already on Railway). No OpenRouter, nothing from server/llm/openrouter.ts. Video goes as native
 * bytes: inline base64 up to 20 MB, the Files API resumable upload above that. 60 s timeout, one
 * retry for a transient failure, then `null` with a logged reason: this tool NEVER throws into a
 * case file build.
 *
 * T14 (7 Sep 2026): `gemini-2.5-flash` answered 404 "no longer available to new users" on every
 * call for this account, and every description failed silently for 30 hours. The model is now the
 * one Google's own error named; `temperature` is gone (Google's Gemini 3 guide: keep it at the
 * default 1.0, low values loop); thinking tokens count as output for the cost; and a failure is
 * CLASSIFIED — `describeMediaDetailed` says whether it was a configuration failure (a retired
 * model, a bad key: permanent, not retried, worth telling a person) or a transient one — so the
 * vision row and the pages can carry the real reason instead of "see the log".
 *
 * Cached by the bytes' sha256 under server/storage/media/.descriptions/<hash>.json (gitignored):
 * a media item is described once, however many runs read it. The prompt and the extraction
 * shape are salvaged from server/workers/vision.ts (read, not imported: that worker is on the
 * Phase 5 deletion list along with the OpenRouter client it uses).
 *
 * Every dependency (fetch, key, cache dir, path resolver, clock, sleep) is injectable so the
 * behaviour is unit-tested with no network.
 */
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import type { TokenUsage } from '../../agent-cost';

/**
 * The model Google named as the replacement for gemini-2.5-flash in its 404 to this account
 * (docs/comms-build/BRIEF-T14-gemini-model.md). Stable, takes image and video, structured output.
 * Paid tier $0.75 / M input, $3.75 / M output to 31 Dec 2026 (server/agent-cost.ts).
 */
export const GEMINI_MODEL = 'gemini-3.6-flash';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
/** Above this the bytes go through the Files API instead of inline base64 (Gemini's inline cap). */
export const INLINE_LIMIT_BYTES = 20 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_RETRIES = 1;
export const DESCRIPTIONS_DIR = path.join(process.cwd(), 'server', 'storage', 'media', '.descriptions');

// ---------------------------------------------------------------- the fixed schema

export const MediaDescriptionSchema = z.object({
    whatIsShown: z.string().min(1).max(2000),
    whatIsMissing: z.array(z.string().min(1).max(300)).max(20).default([]),
    defects: z.array(z.object({
        item: z.string().min(1).max(200),
        severity: z.enum(['minor', 'moderate', 'severe']),
        note: z.string().min(1).max(500),
    })).max(30).default([]),
    textFound: z.array(z.string().min(1).max(200)).max(50).default([]),
    confidence: z.enum(['low', 'medium', 'high']),
});
export type MediaDescription = z.infer<typeof MediaDescriptionSchema>;

/** Salvaged from server/workers/vision.ts, tightened to the Phase 4 schema. */
export const VISION_SYSTEM_PROMPT = `You are a trade expert describing a customer's photo or video for a handyman quoting system in Nottingham, UK.

Describe ONLY what you actually see (and, for video, hear). Never assume, never price, never propose dates.

OUTPUT: one JSON object, no prose, no markdown, exactly these keys:
{
  "whatIsShown": "one or two sentences: what is in the media, where in the property, materials, access",
  "whatIsMissing": ["things the customer's words asked about that the media does NOT show, or angles/close-ups a quote would need"],
  "defects": [{ "item": "the thing", "severity": "minor | moderate | severe", "note": "specific: leak, crack, rot, corrosion, wobble, missing part, size, extent" }],
  "textFound": ["visible brand names, model numbers, labels, measurements"],
  "confidence": "low | medium | high"
}

RULES:
1. Brand names, model numbers and measurements are valuable: always extract them.
2. Note access issues (tight spaces, heights, obstructions, parking) in whatIsShown.
3. confidence is low when the media is blurry, dark, brief, or the item is partly hidden.
4. For VIDEO: cover the whole clip including motion (water flow, mechanical movement) and anything the customer says out loud.
5. If the media shows nothing relevant to a home repair, say so in whatIsShown and use confidence low.`;

// ---------------------------------------------------------------- types

export interface DescribeMediaInput {
    /** Absolute local path, or … */
    path?: string;
    /** … a stored `/api/media/<file>` url (restored from S3 when the disk copy is gone). */
    url?: string;
    kind: 'video' | 'image';
    /** messages.id of the media row; recorded in the cache file and the run row. */
    mediaId?: string;
    mimeType?: string;
    /** What the customer said with it, for the model's context. */
    customerContext?: string | null;
}

export interface DescribeMediaResult {
    description: MediaDescription;
    cached: boolean;
    /** sha256 of the bytes: the cache key. */
    hash: string;
    bytes: number;
    mimeType: string;
    /** Inline base64 or the Files API. */
    transport: 'inline' | 'files_api' | 'cache';
    usage: TokenUsage | null;
    model: string;
    durationMs: number;
    /** Two attempts at most; 0 on a cache hit. */
    attempts: number;
}

export interface DescribeDeps {
    fetch?: typeof fetch;
    apiKey?: string | null;
    cacheDir?: string;
    timeoutMs?: number;
    retries?: number;
    inlineLimitBytes?: number;
    resolvePath?: (input: DescribeMediaInput) => Promise<string | null>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    log?: (line: string) => void;
}

interface CacheFile {
    mediaIds: string[];
    hash: string;
    bytes: number;
    mimeType: string;
    model: string;
    describedAt: string;
    usage: TokenUsage | null;
    description: MediaDescription;
}

// ---------------------------------------------------------------- helpers (pure)

const MIME_BY_EXT: Record<string, string> = {
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.3gp': 'video/3gpp', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.gif': 'image/gif',
};

export function mimeTypeFor(filePath: string, kind: 'video' | 'image', explicit?: string | null): string {
    if (explicit && explicit.includes('/')) return explicit;
    return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
}

export function hashBytes(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Pull the JSON object out of a model reply that may be fenced or padded. */
export function extractJson(text: string): unknown {
    const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { return JSON.parse(raw); } catch { /* fall through */ }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('no JSON object in model reply');
}

/** One line for MediaItem.description — what the Scoper's case-file summary shows. */
export function formatDescription(d: MediaDescription): string {
    const parts = [d.whatIsShown.trim()];
    if (d.defects.length) parts.push(`Defects: ${d.defects.map((x) => `${x.item} (${x.severity}: ${x.note})`).join('; ')}.`);
    if (d.textFound.length) parts.push(`Text seen: ${d.textFound.join(', ')}.`);
    if (d.whatIsMissing.length) parts.push(`Not shown: ${d.whatIsMissing.join('; ')}.`);
    parts.push(`(confidence ${d.confidence})`);
    return parts.join(' ');
}

// ---------------------------------------------------------------- failures (T14, pure)

export type DescribeFailureKind = 'config' | 'input' | 'transient' | 'reply';

/**
 * Why a description did not happen, classified so a caller can tell a retired model (`config`:
 * the same on every item until a person changes a constant or a key) from a slow night
 * (`transient`), a bad file (`input`) or a model that answered off-schema (`reply`).
 */
export interface DescribeFailure {
    kind: DescribeFailureKind;
    /** The same call will fail the same way until someone changes something. Not retried. */
    permanent: boolean;
    /** One line for a person: the HTTP status and Google's own message when there is one. */
    reason: string;
    status: number | null;
    attempts: number;
}

export type DescribeOutcome = { ok: true; result: DescribeMediaResult } | { ok: false; failure: DescribeFailure };

export class GeminiHttpError extends Error {
    constructor(public readonly status: number, public readonly where: string, detail: string) {
        super(`${where} ${status}: ${detail}`);
        this.name = 'GeminiHttpError';
    }
}

/** Google's error bodies are `{ "error": { "code", "message", "status" } }`; the message is the line worth keeping. */
export function geminiErrorDetail(body: string): string {
    const raw = body.trim();
    try {
        const parsed: any = JSON.parse(raw);
        const msg = parsed?.error?.message ?? parsed?.message;
        if (typeof msg === 'string' && msg.trim()) return msg.replace(/\s+/g, ' ').trim().slice(0, 300);
    } catch { /* not JSON: keep the raw text */ }
    return raw.replace(/\s+/g, ' ').slice(0, 300);
}

async function httpError(where: string, res: Response): Promise<GeminiHttpError> {
    const body = await res.text().catch(() => '');
    return new GeminiHttpError(res.status, where, geminiErrorDetail(body));
}

/** 400 the request itself, 401/403 the key, 404 the model: none of these change between two attempts. */
const PERMANENT_HTTP = new Set([400, 401, 403, 404]);

/** One attempt's error → its class. Exported so the rule is tested on its own. */
export function classifyFailure(error: unknown, timeoutMs: number): Omit<DescribeFailure, 'attempts'> {
    const e = error as any;
    if (e?.name === 'AbortError') return { kind: 'transient', permanent: false, reason: `timed out after ${timeoutMs} ms`, status: null };
    if (e instanceof GeminiHttpError) {
        const permanent = PERMANENT_HTTP.has(e.status);
        return { kind: permanent ? 'config' : 'transient', permanent, reason: e.message, status: e.status };
    }
    const message = String(e?.message ?? e ?? 'unknown');
    if (/^(reply failed schema|gemini returned no text|no JSON object)/.test(message)) return { kind: 'reply', permanent: false, reason: message, status: null };
    return { kind: 'transient', permanent: false, reason: message, status: null };
}

/** The vision row's `error` column: the class first, so a query can tell a retired model from a timeout. */
export function failureLabel(f: DescribeFailure): string {
    return `${f.kind}: ${f.reason}`.slice(0, 400);
}

// ---------------------------------------------------------------- Gemini over HTTPS

interface GeminiUsage { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number }

async function fetchWithTimeout(f: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await f(url, { ...init, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

/** Files API resumable upload → { uri, name }. Polls until ACTIVE (video needs processing). */
async function uploadToFilesApi(
    f: typeof fetch, apiKey: string, bytes: Buffer, mimeType: string, displayName: string, timeoutMs: number, sleep: (ms: number) => Promise<void>, now: () => number,
): Promise<{ uri: string; name: string }> {
    const start = await fetchWithTimeout(f, `${GEMINI_BASE_URL}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(bytes.length),
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: displayName } }),
    }, timeoutMs);
    if (!start.ok) throw await httpError('files api start', start);
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('files api start returned no upload url');

    const up = await fetchWithTimeout(f, uploadUrl, {
        method: 'POST',
        headers: { 'Content-Length': String(bytes.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
        body: new Uint8Array(bytes),
    }, timeoutMs);
    if (!up.ok) throw await httpError('files api upload', up);
    const uploaded: any = await up.json();
    const file = uploaded?.file ?? uploaded;
    if (!file?.uri || !file?.name) throw new Error('files api upload returned no file uri');

    const deadline = now() + timeoutMs;
    let state: string = file.state ?? 'PROCESSING';
    while (state !== 'ACTIVE') {
        if (state === 'FAILED') throw new Error('files api processing failed');
        if (now() > deadline) throw new Error('files api processing timed out');
        await sleep(2000);
        const poll = await fetchWithTimeout(f, `${GEMINI_BASE_URL}/v1beta/${file.name}?key=${encodeURIComponent(apiKey)}`, { method: 'GET' }, timeoutMs);
        if (!poll.ok) throw await httpError('files api poll', poll);
        state = ((await poll.json()) as any)?.state ?? 'PROCESSING';
    }
    return { uri: file.uri, name: file.name };
}

async function callGemini(
    f: typeof fetch, apiKey: string, mediaPart: Record<string, unknown>, userPrompt: string, timeoutMs: number,
): Promise<{ text: string; usage: TokenUsage | null }> {
    const res = await fetchWithTimeout(f, `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: VISION_SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [mediaPart, { text: userPrompt }] }],
            // T14: no `temperature`. Google's Gemini 3 guide: keep the default (1.0); values below it can
            // loop or degrade. The JSON shape is held by responseMimeType and the zod schema, not by it.
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024 },
        }),
    }, timeoutMs);
    if (!res.ok) throw await httpError('gemini', res);
    const json: any = await res.json();
    const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    if (!text.trim()) throw new Error(`gemini returned no text (finishReason ${json?.candidates?.[0]?.finishReason ?? 'unknown'})`);
    const u: GeminiUsage = json?.usageMetadata ?? {};
    // T14: Gemini 3 Flash thinks on every call and cannot be told not to; Google bills thinking
    // tokens at the output rate ("output price includes thinking tokens"), so they are output here.
    const usage: TokenUsage | null = u.promptTokenCount != null
        ? { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheReadTokens: 0, cacheWriteTokens: 0 }
        : null;
    return { text, usage };
}

// ---------------------------------------------------------------- cache

async function readCache(dir: string, hash: string): Promise<CacheFile | null> {
    try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, `${hash}.json`), 'utf8')) as CacheFile;
        const parsed = MediaDescriptionSchema.safeParse(raw?.description);
        if (!parsed.success) return null;
        return { ...raw, description: parsed.data };
    } catch {
        return null;
    }
}

async function writeCache(dir: string, entry: CacheFile): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${entry.hash}.json`), JSON.stringify(entry, null, 2));
}

async function defaultResolvePath(input: DescribeMediaInput): Promise<string | null> {
    if (input.path) return input.path;
    if (!input.url) return null;
    if (!input.url.startsWith('/api/media/')) return null;
    const { ensureLocalMedia } = await import('../../media-store');
    return ensureLocalMedia(path.basename(input.url));
}

// ---------------------------------------------------------------- the tool

/** The Phase 4 contract: a description, or `null` for any failure. Never throws. */
export async function describeMedia(input: DescribeMediaInput, deps: DescribeDeps = {}): Promise<DescribeMediaResult | null> {
    const outcome = await describeMediaDetailed(input, deps);
    return outcome.ok ? outcome.result : null;
}

/**
 * T14: the same call, with the failure when there is one. A configuration failure (HTTP 400 / 401 /
 * 403 / 404: the model, the key, the request) is not retried — a retired model answers the same
 * 404 twice and costs a second timeout's wait — and is marked `permanent` so the row and the pages
 * can say so. Transient failures (429, 5xx, network, timeout) and off-schema replies keep the one
 * retry. Never throws.
 */
export async function describeMediaDetailed(input: DescribeMediaInput, deps: DescribeDeps = {}): Promise<DescribeOutcome> {
    const log = deps.log ?? ((line: string) => console.warn(`[describe_video] ${line}`));
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const startedAt = now();
    const cacheDir = deps.cacheDir ?? DESCRIPTIONS_DIR;
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = deps.retries ?? DEFAULT_RETRIES;
    const inlineLimit = deps.inlineLimitBytes ?? INLINE_LIMIT_BYTES;
    const label = input.mediaId ?? input.path ?? input.url ?? 'media';
    const fail = (kind: DescribeFailureKind, permanent: boolean, reason: string, attempts = 0, status: number | null = null): DescribeOutcome => {
        log(`${label}: ${reason}`);
        return { ok: false, failure: { kind, permanent, reason, status, attempts } };
    };

    let filePath: string | null;
    try {
        filePath = await (deps.resolvePath ?? defaultResolvePath)(input);
    } catch (error: any) {
        return fail('input', false, `could not resolve media path: ${error?.message ?? error}`);
    }
    if (!filePath) return fail('input', true, 'media file not found locally or in S3');

    let bytes: Buffer;
    try {
        bytes = await fs.readFile(filePath);
    } catch (error: any) {
        return fail('input', true, `could not read ${filePath}: ${error?.message ?? error}`);
    }
    if (!bytes.length) return fail('input', true, 'empty file');
    const hash = hashBytes(bytes);
    const mimeType = mimeTypeFor(filePath, input.kind, input.mimeType);

    const cached = await readCache(cacheDir, hash);
    if (cached) {
        if (input.mediaId && !cached.mediaIds.includes(input.mediaId)) {
            cached.mediaIds.push(input.mediaId);
            await writeCache(cacheDir, cached).catch(() => undefined);
        }
        return { ok: true, result: { description: cached.description, cached: true, hash, bytes: bytes.length, mimeType, transport: 'cache', usage: null, model: cached.model, durationMs: now() - startedAt, attempts: 0 } };
    }

    const apiKey = deps.apiKey === undefined ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null) : deps.apiKey;
    if (!apiKey) return fail('config', true, 'GEMINI_API_KEY is not set; no description');
    const f = deps.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') return fail('config', true, 'no fetch available');

    const userPrompt = (input.customerContext ? `Customer said: "${input.customerContext.slice(0, 500)}"\n\n` : '')
        + `Describe this ${input.kind} for a handyman quote. Reply with the JSON object only.`;
    const transport: 'inline' | 'files_api' = bytes.length <= inlineLimit ? 'inline' : 'files_api';

    let last: Omit<DescribeFailure, 'attempts'> = { kind: 'transient', permanent: false, reason: 'unknown', status: null };
    let attempts = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
        attempts++;
        try {
            let mediaPart: Record<string, unknown>;
            if (transport === 'inline') {
                mediaPart = { inline_data: { mime_type: mimeType, data: bytes.toString('base64') } };
            } else {
                const uploaded = await uploadToFilesApi(f, apiKey, bytes, mimeType, label, timeoutMs, sleep, now);
                mediaPart = { file_data: { mime_type: mimeType, file_uri: uploaded.uri } };
            }
            const { text, usage } = await callGemini(f, apiKey, mediaPart, userPrompt, timeoutMs);
            const parsed = MediaDescriptionSchema.safeParse(extractJson(text));
            if (!parsed.success) {
                throw new Error(`reply failed schema: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ').slice(0, 300)}`);
            }
            const entry: CacheFile = {
                mediaIds: input.mediaId ? [input.mediaId] : [], hash, bytes: bytes.length, mimeType, model: GEMINI_MODEL,
                describedAt: new Date(now()).toISOString(), usage, description: parsed.data,
            };
            await writeCache(cacheDir, entry).catch((e: any) => log(`${label}: cache write failed (description still returned): ${e?.message ?? e}`));
            return { ok: true, result: { description: parsed.data, cached: false, hash, bytes: bytes.length, mimeType, transport, usage, model: GEMINI_MODEL, durationMs: now() - startedAt, attempts } };
        } catch (error: any) {
            last = classifyFailure(error, timeoutMs);
            if (last.permanent) { log(`${label}: attempt ${attempts} failed (${last.reason}); ${last.kind} failure, not retried`); break; }
            if (attempt < retries) log(`${label}: attempt ${attempt + 1} failed (${last.reason}); retrying once`);
        }
    }
    log(`${label}: no description after ${attempts} attempt(s): ${last.reason}`);
    return { ok: false, failure: { ...last, attempts } };
}
