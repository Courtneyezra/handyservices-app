/**
 * Turns a thread's media messages into vision blocks for an agent's context.
 *
 * The principle: photos and videos ARE the conversation — a customer who sends a picture of a
 * broken hinge has told us more than any sentence. So the agent doesn't get "hasMedia: true",
 * it gets the actual pixels, captioned with when they arrived and from whom.
 *
 * Images are resized to fit MAX_DIM (tokens cost real money; a 4000px photo tells the model
 * nothing a 1024px one doesn't). Videos become up to FRAMES_PER_VIDEO evenly-spaced keyframes
 * via ffmpeg, cached on disk next to the media so extraction happens once per video ever.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { ensureLocalMedia } from '../media-store';

const MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');
const FRAMES_DIR = path.join(MEDIA_DIR, '.frames');
const MAX_DIM = 1024;
const FRAMES_PER_VIDEO = 4;
/** Most media a single get_thread will embed — enough for any real enquiry, bounded for cost. */
export const MAX_MEDIA_ITEMS = 12;

type ImageBlock = {
    type: 'image';
    source: { type: 'base64'; media_type: 'image/jpeg'; data: string };
};
type TextBlock = { type: 'text'; text: string };
export type MediaBlock = ImageBlock | TextBlock;

async function toJpegBlock(filePath: string): Promise<ImageBlock | null> {
    try {
        const buf = await sharp(filePath)
            .rotate() // honour EXIF orientation — phone photos are usually sideways without it
            .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 72 })
            .toBuffer();
        return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
    } catch (e: any) {
        console.warn(`[MediaContext] Could not process ${path.basename(filePath)}: ${e?.message}`);
        return null;
    }
}

/** Extracts (or reuses cached) evenly-spaced keyframes for a video file. */
function extractFrames(videoPath: string): string[] {
    const cacheDir = path.join(FRAMES_DIR, path.basename(videoPath));
    if (existsSync(cacheDir)) {
        const cached = readdirSync(cacheDir).filter((f) => f.endsWith('.jpg')).sort();
        if (cached.length > 0) return cached.map((f) => path.join(cacheDir, f));
    }
    mkdirSync(cacheDir, { recursive: true });
    try {
        // One pass, no duration probe needed: sample 1 fps, keep the first N frames spread out
        // by thumbnail selection. -vf thumbnail picks representative frames; simpler and robust.
        execFileSync('ffmpeg', [
            '-y', '-i', videoPath,
            '-vf', `thumbnail=25,scale='min(${MAX_DIM},iw)':-2`,
            '-frames:v', String(FRAMES_PER_VIDEO),
            '-vsync', 'vfr',
            path.join(cacheDir, 'f%02d.jpg'),
        ], { stdio: 'pipe', timeout: 60_000 });
    } catch (e: any) {
        console.warn(`[MediaContext] ffmpeg failed for ${path.basename(videoPath)}: ${e?.message}`);
        return [];
    }
    return readdirSync(cacheDir).filter((f) => f.endsWith('.jpg')).sort()
        .map((f) => path.join(cacheDir, f));
}

export interface ThreadMediaItem {
    /** '/api/media/<file>' as stored on the message row. */
    mediaUrl: string;
    mediaType: string | null;
    direction: string;
    createdAt: string | Date | null;
    content?: string | null;
}

/**
 * Builds caption+image blocks for a thread's media, oldest first, capped at MAX_MEDIA_ITEMS
 * (most recent kept). Returns [] when nothing is loadable — callers need no special casing.
 */
export async function buildMediaBlocks(items: ThreadMediaItem[]): Promise<MediaBlock[]> {
    const usable = items
        .filter((m) => m.mediaUrl?.startsWith('/api/media/'))
        .slice(-MAX_MEDIA_ITEMS);
    if (usable.length === 0) return [];

    const blocks: MediaBlock[] = [{
        type: 'text',
        text: `THREAD MEDIA (${usable.length} item(s), chronological — these are part of the conversation):`,
    }];

    for (const m of usable) {
        // Restores from S3 when the local copy was wiped by a redeploy.
        const filePath = await ensureLocalMedia(path.basename(m.mediaUrl));
        if (!filePath) continue;
        const when = m.createdAt ? new Date(m.createdAt).toISOString().slice(0, 16).replace('T', ' ') : 'unknown time';
        const who = m.direction === 'inbound' ? 'customer' : 'us';
        const mime = m.mediaType ?? '';

        if (mime.startsWith('video/')) {
            const frames = extractFrames(filePath);
            if (!frames.length) continue;
            blocks.push({ type: 'text', text: `[${when}] video from ${who}${m.content ? ` — "${m.content}"` : ''} (${frames.length} keyframes):` });
            for (const f of frames) {
                const b = await toJpegBlock(f);
                if (b) blocks.push(b);
            }
        } else if (mime.startsWith('image/') || mime === '') {
            const b = await toJpegBlock(filePath);
            if (!b) continue;
            blocks.push({ type: 'text', text: `[${when}] photo from ${who}${m.content ? ` — "${m.content}"` : ''}:` });
            blocks.push(b);
        }
        // audio and documents can't be shown; the timeline JSON already flags them
    }

    // The evidence check travels WITH the pixels, because the failure it prevents happened with
    // the rule sitting in the system prompt: 20 Aug 2026, an under-the-sink photo (tap not in
    // frame) got the reply "looks like a straightforward tap swap" — same model, same image the
    // quote clerk described honestly as "the tap itself is not shown". The eyes were fine; the
    // reply skipped the comparison between what was asked for and what actually arrived.
    if (blocks.length > 1) {
        blocks.push({
            type: 'text',
            text: 'EVIDENCE CHECK before replying about this media: (1) name to yourself what is '
                + 'ACTUALLY in frame; (2) compare that against what was asked for; (3) if the thing '
                + 'you need is not in frame (you asked for the tap, this shows under the sink), the '
                + 'reply is: thank them, say what the photo DOES show, and ask for the one specific '
                + 'missing shot. Never name a fix or a scope the pixels do not support — a customer '
                + 'will quote "you said it was a straightforward swap" back at the quote. "Hard to '
                + 'say exactly from the photo" is a professional answer, and asking for a second '
                + 'shot is what a real tradesperson does all day.',
        });
    }

    return blocks.length > 1 ? blocks : [];
}
