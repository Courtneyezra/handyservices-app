/**
 * Phase 4 vitest: describe_video — schema validation, cache hit/miss, null-on-failure, the
 * Files API path — all with a fake fetch and a temp cache dir. No network, no database.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describeMedia, MediaDescriptionSchema, formatDescription, extractJson, mimeTypeFor, type DescribeDeps } from './describe-video';

const GOOD = {
    whatIsShown: 'A chrome mixer tap over a white ceramic kitchen sink; the base is green with limescale.',
    whatIsMissing: ['the pipework under the sink'],
    defects: [{ item: 'mixer tap', severity: 'moderate', note: 'drips from the spout when closed' }],
    textFound: ['Bristan'],
    confidence: 'high',
};

async function tmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'describe-video-'));
}
async function tmpFile(dir: string, name: string, bytes: number): Promise<string> {
    const p = path.join(dir, name);
    await fs.writeFile(p, Buffer.alloc(bytes, 7));
    return p;
}
function geminiReply(obj: unknown, usage = { promptTokenCount: 1200, candidatesTokenCount: 180 }) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }], usageMetadata: usage }), { status: 200, headers: { 'content-type': 'application/json' } });
}
function deps(over: Partial<DescribeDeps> & { cacheDir: string }): DescribeDeps {
    return { apiKey: 'test-key', timeoutMs: 1000, sleep: async () => undefined, log: () => undefined, ...over };
}

describe('MediaDescriptionSchema', () => {
    it('accepts the fixed shape and fills defaults', () => {
        const r = MediaDescriptionSchema.parse({ whatIsShown: 'a fence', confidence: 'low' });
        expect(r).toEqual({ whatIsShown: 'a fence', whatIsMissing: [], defects: [], textFound: [], confidence: 'low' });
    });
    it('rejects bad severities, missing fields and prose', () => {
        expect(MediaDescriptionSchema.safeParse({ ...GOOD, defects: [{ item: 'x', severity: 'major', note: 'y' }] }).success).toBe(false);
        expect(MediaDescriptionSchema.safeParse({ confidence: 'high' }).success).toBe(false);
        expect(MediaDescriptionSchema.safeParse({ ...GOOD, confidence: 'certain' }).success).toBe(false);
    });
    it('extractJson tolerates fences and padding; formatDescription is one line', () => {
        expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
        expect(extractJson('Sure: {"a":1} done')).toEqual({ a: 1 });
        expect(() => extractJson('nothing here')).toThrow();
        const line = formatDescription(MediaDescriptionSchema.parse(GOOD));
        expect(line).toMatch(/^A chrome mixer tap/); expect(line).toMatch(/Defects: mixer tap \(moderate/); expect(line).toMatch(/Text seen: Bristan/); expect(line).toMatch(/Not shown: the pipework/); expect(line).toMatch(/\(confidence high\)$/);
        expect(mimeTypeFor('/x/clip.MOV', 'video')).toBe('video/quicktime'); expect(mimeTypeFor('/x/noext', 'video')).toBe('video/mp4'); expect(mimeTypeFor('/x/a.bin', 'image', 'image/png')).toBe('image/png');
    });
});

describe('describeMedia', () => {
    it('cache miss calls Gemini inline, validates, caches; the second call is a cache hit', async () => {
        const dir = await tmpDir();
        const file = await tmpFile(dir, 'clip.mp4', 1024);
        const fetch = vi.fn(async (_url: string, init: any) => {
            const body = JSON.parse(init.body);
            expect(body.contents[0].parts[0].inline_data.mime_type).toBe('video/mp4');
            expect(body.generationConfig.responseMimeType).toBe('application/json');
            expect(String(_url)).toContain('/v1beta/models/gemini-2.5-flash:generateContent?key=test-key');
            return geminiReply(GOOD);
        });
        const first = await describeMedia({ path: file, kind: 'video', mediaId: 'm1' }, deps({ cacheDir: dir, fetch: fetch as any }));
        expect(first).toMatchObject({ cached: false, transport: 'inline', attempts: 1, model: 'gemini-2.5-flash', usage: { inputTokens: 1200, outputTokens: 180 } });
        expect(first!.description).toEqual(GOOD);
        expect(fetch).toHaveBeenCalledTimes(1);
        const cachedFile = JSON.parse(await fs.readFile(path.join(dir, `${first!.hash}.json`), 'utf8'));
        expect(cachedFile.mediaIds).toEqual(['m1']);

        const second = await describeMedia({ path: file, kind: 'video', mediaId: 'm2' }, deps({ cacheDir: dir, fetch: fetch as any }));
        expect(second).toMatchObject({ cached: true, transport: 'cache', attempts: 0 });
        expect(second!.description).toEqual(GOOD);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(await fs.readFile(path.join(dir, `${first!.hash}.json`), 'utf8')).mediaIds).toEqual(['m1', 'm2']);
    });

    it('same bytes under another name hit the cache; different bytes miss', async () => {
        const dir = await tmpDir();
        const a = await tmpFile(dir, 'a.mp4', 500);
        const b = await tmpFile(dir, 'b.mp4', 500);
        const c = await tmpFile(dir, 'c.mp4', 501);
        const fetch = vi.fn(async () => geminiReply(GOOD));
        await describeMedia({ path: a, kind: 'video' }, deps({ cacheDir: dir, fetch: fetch as any }));
        await describeMedia({ path: b, kind: 'video' }, deps({ cacheDir: dir, fetch: fetch as any }));
        await describeMedia({ path: c, kind: 'video' }, deps({ cacheDir: dir, fetch: fetch as any }));
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('retries once then returns null when the model keeps failing or replies off-schema', async () => {
        const dir = await tmpDir();
        const file = await tmpFile(dir, 'clip.mp4', 100);
        const logs: string[] = [];
        const boom = vi.fn(async () => { throw new Error('ECONNRESET'); });
        expect(await describeMedia({ path: file, kind: 'video', mediaId: 'm9' }, deps({ cacheDir: dir, fetch: boom as any, log: (l) => logs.push(l) }))).toBeNull();
        expect(boom).toHaveBeenCalledTimes(2);
        expect(logs.at(-1)).toMatch(/m9: no description after 2 attempt\(s\): ECONNRESET/);
        const off = vi.fn(async () => geminiReply({ whatIsShown: 'x', confidence: 'certain' }));
        expect(await describeMedia({ path: file, kind: 'video' }, deps({ cacheDir: dir, fetch: off as any }))).toBeNull();
        expect(off).toHaveBeenCalledTimes(2);
        const http = vi.fn(async () => new Response('quota', { status: 429 }));
        expect(await describeMedia({ path: file, kind: 'video' }, deps({ cacheDir: dir, fetch: http as any }))).toBeNull();
        expect(await fs.readdir(dir)).not.toContain(expect.stringMatching(/\.json$/));
    });

    it('returns null without calling anything when the key is missing or the file is not there', async () => {
        const dir = await tmpDir();
        const file = await tmpFile(dir, 'clip.mp4', 100);
        const fetch = vi.fn();
        expect(await describeMedia({ path: file, kind: 'video' }, deps({ cacheDir: dir, fetch, apiKey: null }))).toBeNull();
        expect(await describeMedia({ path: path.join(dir, 'missing.mp4'), kind: 'video' }, deps({ cacheDir: dir, fetch }))).toBeNull();
        expect(await describeMedia({ url: '/api/media/x.mp4', kind: 'video' }, deps({ cacheDir: dir, fetch, resolvePath: async () => null }))).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('a timeout is retried once and then reported as such', async () => {
        const dir = await tmpDir();
        const file = await tmpFile(dir, 'clip.mp4', 100);
        const logs: string[] = [];
        const hang = vi.fn((_url: string, init: any) => new Promise<Response>((_, reject) => {
            init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
        }));
        expect(await describeMedia({ path: file, kind: 'video' }, deps({ cacheDir: dir, fetch: hang as any, timeoutMs: 20, log: (l) => logs.push(l) }))).toBeNull();
        expect(hang).toHaveBeenCalledTimes(2);
        expect(logs.at(-1)).toMatch(/timed out after 20 ms/);
    });

    it('uses the Files API above the inline limit: start, upload+finalize, poll to ACTIVE, then generate', async () => {
        const dir = await tmpDir();
        const file = await tmpFile(dir, 'big.mp4', 5000);
        const calls: string[] = [];
        const fetch = vi.fn(async (url: string, init: any) => {
            const u = String(url);
            if (u.includes('/upload/v1beta/files')) {
                calls.push('start'); expect(init.headers['X-Goog-Upload-Protocol']).toBe('resumable'); expect(init.headers['X-Goog-Upload-Header-Content-Type']).toBe('video/mp4');
                return new Response('', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/session-1' } });
            }
            if (u === 'https://upload.example/session-1') {
                calls.push('upload'); expect(init.headers['X-Goog-Upload-Command']).toBe('upload, finalize');
                return new Response(JSON.stringify({ file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', state: 'PROCESSING' } }), { status: 200 });
            }
            if (u.includes('/v1beta/files/abc?')) { calls.push('poll'); return new Response(JSON.stringify({ state: 'ACTIVE' }), { status: 200 }); }
            if (u.includes(':generateContent')) {
                calls.push('generate');
                const body = JSON.parse(init.body);
                expect(body.contents[0].parts[0].file_data.file_uri).toMatch(/files\/abc$/);
                return geminiReply(GOOD);
            }
            throw new Error(`unexpected url ${u}`);
        });
        const r = await describeMedia({ path: file, kind: 'video', mediaId: 'big' }, deps({ cacheDir: dir, fetch: fetch as any, inlineLimitBytes: 1000 }));
        expect(calls).toEqual(['start', 'upload', 'poll', 'generate']);
        expect(r).toMatchObject({ transport: 'files_api', cached: false });
    });
});
