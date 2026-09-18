/**
 * The new desk's inbound media survives a redeploy. A redeploy wipes local disk; before this, the
 * gateway landed a turn whose photo or video existed only there, so the thread's `/api/media/<file>`
 * url 404'd after the next deploy. Here the S3 client behind the old desk's media store
 * (server/media-store.ts) is an in-memory bucket, the adapter's media directory is wiped to stand in
 * for the deploy, and the file is read back through `ensureLocalMedia`, which is what the
 * `/api/media/:file` route serves from.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bucket = new Map<string, { body: Buffer; contentType?: string }>();
vi.mock('../../s3-media', () => ({
    isS3Configured: () => true,
    s3Bucket: () => 'test-bucket',
    getS3Client: () => ({
        async send(cmd: any) {
            const input = cmd.input as { Bucket: string; Key: string; Body?: Buffer; ContentType?: string };
            if (cmd.constructor.name === 'PutObjectCommand') { bucket.set(input.Key, { body: Buffer.from(input.Body!), contentType: input.ContentType }); return {}; }
            if (cmd.constructor.name === 'GetObjectCommand') {
                const hit = bucket.get(input.Key);
                if (!hit) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
                return { Body: { transformToByteArray: async () => new Uint8Array(hit.body) } };
            }
            throw new Error(`unexpected command ${cmd.constructor.name}`);
        },
    }),
}));

import { ensureLocalMedia, MEDIA_DIR } from '../../media-store';
import { ChannelGateway } from '../channels/channel-gateway';
import { fromDoorEmail } from '../channels/email-adapter';
import type { CaseFile, Turn } from './case-file';
import type { DeskLike, DeskResult } from './desk-types';
import { Gateway } from './gateway';
import { keepDurably, mediaFileName, MIRROR_ATTEMPTS } from './media-durability';
import { fromDoor, fromTwilio } from './whatsapp-adapter';

const fakeDesk: DeskLike = {
    async handleTurn(file: CaseFile): Promise<DeskResult> { return result(file); },
    async clockPass(file: CaseFile): Promise<DeskResult> { return result(file); },
};
function result(file: CaseFile): DeskResult {
    return { runId: 'run_x', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 };
}

const PHOTO = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);
const VIDEO = Buffer.from('synthetic video bytes');

let diskDir: string;
const restored: string[] = [];

beforeEach(() => {
    bucket.clear();
    diskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-media-'));
});
afterEach(() => {
    fs.rmSync(diskDir, { recursive: true, force: true });
    for (const f of restored.splice(0)) fs.rmSync(path.join(MEDIA_DIR, f), { force: true });
});

/** What a deploy does to the box: the media directory is gone. */
function redeploy(): void { fs.rmSync(diskDir, { recursive: true, force: true }); }

async function servedAfterRedeploy(url: string): Promise<Buffer | null> {
    const file = path.basename(url);
    restored.push(file);
    const p = await ensureLocalMedia(file);
    return p ? fs.readFileSync(p) : null;
}

function landedMedia(out: Awaited<ReturnType<Gateway['inbound']>>): Turn['media'] {
    if (out.kind !== 'handled') throw new Error(out.kind);
    return out.turn.media;
}

describe('new-desk media survives a redeploy', () => {
    it('a WhatsApp photo and video from the Twilio webhook are mirrored on arrival and served after the disk is wiped', async () => {
        const fetch = (async (url: string) => new Response(url.endsWith('/0') ? PHOTO : VIDEO, { status: 200 })) as unknown as typeof globalThis.fetch;
        const turn = await fromTwilio({ From: 'whatsapp:+447700900942', Body: 'the leak', NumMedia: '2', MediaUrl0: 'https://api.twilio.test/Media/0', MediaContentType0: 'image/jpeg', MediaUrl1: 'https://api.twilio.test/Media/1', MediaContentType1: 'video/mp4' }, { fetch, mediaDir: diskDir, twilio: null });
        const media = landedMedia(await new Gateway({ desk: fakeDesk }).inbound(turn));
        expect(media.map((m) => [m.kind, m.stored])).toEqual([['image', 'durable'], ['video', 'durable']]);
        expect([...bucket.keys()].sort()).toEqual(media.map((m) => `chat-media/${path.basename(m.url!)}`).sort());

        redeploy();
        expect(fs.existsSync(media[0].path!)).toBe(false);
        expect(await servedAfterRedeploy(media[0].url!)).toEqual(PHOTO);
        expect(await servedAfterRedeploy(media[1].url!)).toEqual(VIDEO);
    });

    it('an emailed photo through the channel gateway is mirrored the same way', async () => {
        const env = fromDoorEmail({ address: 'sam@example.invalid', subject: 'Leak', text: 'photo attached', at: '2026-09-18T10:00:00.000Z', media: [{ bytes: PHOTO, mime: 'image/jpeg' }] }, { mediaDir: diskDir });
        const media = landedMedia(await new ChannelGateway({ desk: fakeDesk }).inbound(env));
        expect(media[0].stored).toBe('durable');
        redeploy();
        expect(await servedAfterRedeploy(media[0].url!)).toEqual(PHOTO);
    });

    it('media the mirror refuses still lands, recorded local only and logged as a failure; the deploy then loses it', async () => {
        const log: string[] = [];
        const mirror = vi.fn(async () => false);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const turn = fromDoor({ address: '+447700900942', text: 'here', media: [{ bytes: PHOTO, mime: 'image/jpeg' }] }, { mediaDir: diskDir });
        const out = await new Gateway({ desk: fakeDesk, mirrorMedia: mirror, log: (l) => log.push(l) }).inbound(turn);
        const media = landedMedia(out);
        expect(media).toHaveLength(1);
        expect(media[0].stored).toBe('local_only');
        expect(mirror).toHaveBeenCalledTimes(MIRROR_ATTEMPTS);
        expect(log.join('\n')).toMatch(/is on local disk only.*lost on the next deploy/);
        expect(errors).toHaveBeenCalled();
        errors.mockRestore();

        redeploy();
        expect(await servedAfterRedeploy(media[0].url!)).toBeNull();
    });

    it('a text turn does not touch the mirror', async () => {
        const mirror = vi.fn(async () => true);
        const out = await new Gateway({ desk: fakeDesk, mirrorMedia: mirror }).inbound(fromDoor({ address: '+447700900942', text: 'just words' }, { mediaDir: diskDir }));
        expect(landedMedia(out)).toEqual([]);
        expect(mirror).not.toHaveBeenCalled();
    });
});

describe('keepDurably', () => {
    it('retries a failed mirror once before calling it local only, and mirrors under the name the url serves', async () => {
        const turn = fromDoor({ address: '+447700900942', text: '', media: [{ bytes: VIDEO, mime: 'video/mp4' }] }, { mediaDir: diskDir });
        const names: string[] = [];
        let n = 0;
        const kept = await keepDurably(turn.media, async (name) => { names.push(name); return ++n > 1; }, () => undefined);
        expect(kept[0].stored).toBe('durable');
        expect(names).toEqual([mediaFileName(turn.media[0]), mediaFileName(turn.media[0])]);
        expect(`/api/media/${names[0]}`).toBe(turn.media[0].url);
    });

    it('a file already gone from disk is recorded local only, never thrown', async () => {
        const turn = fromDoor({ address: '+447700900942', text: '', media: [{ bytes: PHOTO, mime: 'image/jpeg' }] }, { mediaDir: diskDir });
        redeploy();
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const kept = await keepDurably(turn.media, async () => true, () => undefined);
        errors.mockRestore();
        expect(kept[0].stored).toBe('local_only');
    });
});
