/**
 * Keeping the new desk's inbound media past a redeploy. The adapters write each photo or video to
 * local disk (whatsapp-adapter.ts, channels/media.ts), and Railway's disk is wiped on every deploy,
 * so a file only on disk is lost with the next one. Before this, nothing mirrored the new desk's
 * files anywhere: the turn kept its `/api/media/<file>` url and the file 404'd after a deploy.
 *
 * This uses the old desk's durable path, not a second one: server/media-store.ts `mirrorMediaToS3`
 * puts the file under `chat-media/<file>`, and the `/api/media/:file` route (server/index.ts) and
 * `ensureLocalMedia` restore it from there when the disk copy is gone. The file name is the one in
 * the turn's url, so the url the thread renders is the key the route restores.
 *
 * The gateway calls `keepDurably` before a turn lands on the file, so every channel's media is
 * mirrored on arrival. A file that could not be mirrored still lands (the customer's words and the
 * desk's run never wait on S3) but is recorded `stored: 'local_only'` and logged at error level, so
 * the thread shows it as a failure rather than a photo that silently vanishes on the next deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { TurnMedia } from './case-file';
import type { InboundMedia } from './whatsapp-adapter';

/** Puts one media file somewhere durable; true only once it is stored. Never throws. */
export type MirrorMedia = (fileName: string, body: Buffer, contentType: string) => Promise<boolean>;

/** The old desk's mirror (server/media-store.ts), loaded on first use. */
export const mirrorToMediaStore: MirrorMedia = async (fileName, body, contentType) => {
    const { mirrorMediaToS3 } = await import('../../media-store');
    return mirrorMediaToS3(fileName, body, contentType);
};

/** How many times one file is offered to the mirror before it is recorded as local only. */
export const MIRROR_ATTEMPTS = 2;

/** The file name the thread's url serves, which is the key the media route restores. */
export function mediaFileName(m: { url?: string | null; path?: string | null }): string | null {
    const from = m.url || m.path;
    return from ? path.basename(from) : null;
}

/**
 * Each inbound photo or video as the turn records it, mirrored to durable storage first. Media
 * that could not be mirrored is kept `local_only` and logged; it is never dropped.
 */
export async function keepDurably(media: readonly InboundMedia[], mirror: MirrorMedia, log: (line: string) => void): Promise<TurnMedia[]> {
    return Promise.all(media.map(async (m) => {
        const file = mediaFileName(m);
        let stored: TurnMedia['stored'] = 'local_only';
        let reason = 'the durable store refused it';
        try {
            if (!file || !m.path) throw new Error('no local file');
            const bytes = fs.readFileSync(m.path);
            for (let i = 0; i < MIRROR_ATTEMPTS && stored !== 'durable'; i++) {
                if (await mirror(file, bytes, m.mime).catch(() => false)) stored = 'durable';
            }
        } catch (err: any) {
            reason = `the local file could not be read (${err?.code ?? err?.message ?? String(err)})`;
        }
        if (stored !== 'durable') {
            const line = `[desk] media ${m.id} (${m.kind}) is on local disk only: ${reason}; it will be lost on the next deploy`;
            console.error(line);
            log(line);
        }
        return { id: m.id, kind: m.kind, mime: m.mime, path: m.path, url: m.url, description: null, stored };
    }));
}
