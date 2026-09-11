/**
 * The adapter normalises both webhook shapes to one turn and downloads media on arrival on both
 * paths; a failed download is recorded on the turn, never dropped silently.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { e164FromWhatsApp, fromDoor, fromMeta, fromTwilio, mediaKindOf } from './whatsapp-adapter';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-adapter-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function fakeFetch(routes: Record<string, { status?: number; body?: Buffer | object; type?: string }>): typeof fetch {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const f = (async (url: any, init?: any) => {
        seen.push({ url: String(url), headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])) });
        const r = routes[String(url)];
        if (!r) return new Response('not found', { status: 404 });
        const body = r.body instanceof Buffer ? new Uint8Array(r.body) : JSON.stringify(r.body ?? {});
        return new Response(body, { status: r.status ?? 200, headers: { 'content-type': r.type ?? (r.body instanceof Buffer ? 'image/png' : 'application/json') } });
    }) as unknown as typeof fetch;
    (f as any).seen = seen;
    return f;
}

describe('e164FromWhatsApp', () => {
    it('reads the Twilio, Meta and c.us spellings', () => {
        expect(e164FromWhatsApp('whatsapp:+447700900942')).toBe('+447700900942');
        expect(e164FromWhatsApp('447700900942')).toBe('+447700900942');
        expect(e164FromWhatsApp('447700900942@c.us')).toBe('+447700900942');
        expect(e164FromWhatsApp('07700 900942')).toBe('+447700900942');
        expect(e164FromWhatsApp('nope')).toBeNull();
    });
    it('names image and video and nothing else', () => {
        expect(mediaKindOf('image/jpeg')).toBe('image');
        expect(mediaKindOf('video/mp4; codecs=x')).toBe('video');
        expect(mediaKindOf('audio/ogg')).toBeNull();
    });
});

describe('fromTwilio', () => {
    it('normalises the form and downloads every MediaUrlN with basic auth on arrival', async () => {
        const f = fakeFetch({ 'https://api.twilio.com/m/1': { body: PNG }, 'https://api.twilio.com/m/2': { status: 500 } });
        const turn = await fromTwilio({ From: 'whatsapp:+447700900942', Body: ' this is the tap ', ProfileName: 'Priya', MessageSid: 'SM1', NumMedia: '3', MediaUrl0: 'https://api.twilio.com/m/1', MediaContentType0: 'image/png', MediaUrl1: 'https://api.twilio.com/m/2', MediaContentType1: 'image/jpeg', MediaUrl2: 'https://api.twilio.com/m/3', MediaContentType2: 'audio/ogg' },
            { fetch: f, mediaDir: dir, twilio: { accountSid: 'AC1', authToken: 'tok' }, now: () => new Date('2026-09-11T10:00:00Z') });
        expect(turn.address).toBe('+447700900942');
        expect(turn.name).toBe('Priya');
        expect(turn.text).toBe('this is the tap');
        expect(turn.via).toBe('twilio');
        expect(turn.media).toHaveLength(1);
        expect(turn.media[0].kind).toBe('image');
        expect(fs.readFileSync(turn.media[0].path)).toEqual(PNG);
        expect(turn.media[0].url).toMatch(/^\/api\/media\/v2_.*\.png$/);
        expect(turn.mediaFailures).toHaveLength(2);
        expect(turn.mediaFailures.map((m) => m.reason)).toEqual(['download failed: HTTP 500', 'unsupported media type audio/ogg']);
        expect((f as any).seen[0].headers.authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`);
    });
});

describe('fromMeta', () => {
    it('normalises every message, looks a media id up on the Graph API and downloads it with the bearer token', async () => {
        const f = fakeFetch({ 'https://graph.test/v21.0/MEDIA1': { body: { url: 'https://lookaside.test/1', mime_type: 'image/png' } }, 'https://lookaside.test/1': { body: PNG } });
        const turns = await fromMeta({
            object: 'whatsapp_business_account',
            entry: [{ changes: [{ field: 'messages', value: { contacts: [{ profile: { name: 'Sam' } }], messages: [
                { from: '447700900942', id: 'wamid.1', timestamp: '1789120800', type: 'text', text: { body: 'hi' } },
                { from: '447700900942', id: 'wamid.2', timestamp: '1789120801', type: 'image', image: { id: 'MEDIA1', mime_type: 'image/png', caption: 'the tap' } },
            ] } }] }],
        }, { fetch: f, mediaDir: dir, meta: { accessToken: 'bearer-x', graphUrl: 'https://graph.test/v21.0' } });
        expect(turns).toHaveLength(2);
        expect(turns[0]).toMatchObject({ address: '+447700900942', name: 'Sam', text: 'hi', via: 'meta', providerMessageId: 'wamid.1', at: '2026-09-11T10:00:00.000Z' });
        expect(turns[1].text).toBe('the tap');
        expect(turns[1].media).toHaveLength(1);
        expect(fs.readFileSync(turns[1].media[0].path)).toEqual(PNG);
        expect((f as any).seen.every((s: any) => s.headers.authorization === 'Bearer bearer-x')).toBe(true);
    });
    it('records a media failure when there is no token, and ignores a payload that is not WhatsApp', async () => {
        const turns = await fromMeta({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from: '447700900942', type: 'image', image: { id: 'M' } }] } }] }] }, { mediaDir: dir, meta: null });
        expect(turns[0].media).toEqual([]);
        expect(turns[0].mediaFailures[0].reason).toMatch(/WHATSAPP_ACCESS_TOKEN/);
        expect(await fromMeta({ object: 'page' })).toEqual([]);
    });
});

describe('fromDoor', () => {
    it('writes the bytes where a real inbound would land', () => {
        const turn = fromDoor({ address: '+447700900942', name: 'Priya', text: 'tap', media: [{ bytes: PNG, mime: 'image/png' }] }, { mediaDir: dir });
        expect(turn.via).toBe('door');
        expect(turn.media[0].bytes).toBe(PNG.length);
        expect(fs.existsSync(turn.media[0].path)).toBe(true);
    });
});
