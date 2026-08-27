/**
 * Outbound voice notes for /admin/comms — voice makes it personal.
 *
 * Flow: the browser records with MediaRecorder (webm/opus on Chrome, mp4/aac on Safari) and
 * posts it here. WhatsApp does not accept webm, so ffmpeg transcodes to OGG/Opus — the format
 * WhatsApp treats as a proper voice message. The file lands in the same served media directory
 * as inbound media, and goes out via the normal sendWhatsAppMessage path (Twilio fetches the
 * public URL itself).
 *
 * Constraints that matter:
 * - Freeform-only: a voice note cannot ride a template, so the 24h window must be open (409
 *   OUTSIDE_WINDOW otherwise, same contract the quick-replies send uses).
 * - Twilio must be able to FETCH the file, so PUBLIC_BASE_URL has to be a real https origin.
 *   On localhost the send is refused up front with a clear error instead of failing silently
 *   in Twilio's queue.
 */
import { Router } from 'express';
import multer from 'multer';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, readFileSync } from 'fs';
import path from 'path';
import { canSendFreeform } from './meta-whatsapp';
import { sendCustomerMessage } from './outbound';
import { normalizePhoneNumber } from './phone-utils';
import { mirrorMediaToS3 } from './media-store';

export const voiceNotesRouter = Router();

const MEDIA_DIR = path.join(process.cwd(), 'server/storage/media');
const TMP_DIR = path.join(MEDIA_DIR, '.voice-tmp');

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            mkdirSync(TMP_DIR, { recursive: true });
            cb(null, TMP_DIR);
        },
        filename: (_req, file, cb) => cb(null, `rec_${Date.now()}${path.extname(file.originalname || '.webm') || '.webm'}`),
    }),
    limits: { fileSize: 16 * 1024 * 1024 }, // WhatsApp's own media cap
    fileFilter: (_req, file, cb) => cb(null, (file.mimetype || '').startsWith('audio/') || (file.mimetype || '').startsWith('video/')),
});

function publicBase(): string | null {
    const base = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').replace(/\/$/, '');
    return base.startsWith('https://') ? base : null;
}

// POST /api/whatsapp/voice-note  (multipart: audio=<blob>, to=<phone>)
voiceNotesRouter.post('/voice-note', upload.single('audio'), async (req, res) => {
    const tmpPath = req.file?.path;
    try {
        const to = String(req.body?.to || '');
        const phone = normalizePhoneNumber(to.replace('@c.us', ''));
        if (!req.file || !tmpPath) return res.status(400).json({ error: "Missing 'audio' file" });
        if (!phone) return res.status(400).json({ error: `Unparseable phone: ${to}` });

        // A voice note is a human speaking to this person, so it is a service reply and a plain
        // STOP does not block it. "Do not contact me" does. The sendCustomerMessage choke point
        // now handles opt-out enforcement, but we keep this early check to return a clean error
        // before attempting transcoding work.
        const { blockedByOptOut, optOutRefusalMessage } = await import('./opt-out');
        const suppression = await blockedByOptOut(phone, 'service_reply');
        if (suppression) {
            return res.status(409).json({ error: 'OPTED_OUT', message: optOutRefusalMessage(suppression) });
        }

        // Voice is freeform-only — no template can carry it, so the window is a hard gate.
        const windowOpen = await canSendFreeform(phone).catch(() => false);
        if (!windowOpen) {
            return res.status(409).json({
                error: 'OUTSIDE_WINDOW',
                message: 'The 24-hour window is shut — voice notes cannot be sent as templates. Wait for the customer to message again.',
            });
        }

        const base = publicBase();
        if (!base) {
            return res.status(503).json({
                error: 'NO_PUBLIC_URL',
                message: 'PUBLIC_BASE_URL is not an https origin, so Twilio cannot fetch the audio. Voice notes work on the deployed server.',
            });
        }

        // Transcode whatever the browser produced into OGG/Opus — WhatsApp's voice-note format.
        const fileName = `vn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ogg`;
        const outPath = path.join(MEDIA_DIR, fileName);
        execFileSync('ffmpeg', [
            '-y', '-i', tmpPath,
            '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1',
            outPath,
        ], { stdio: 'pipe', timeout: 60_000 });

        // Local disk is ephemeral on Railway — mirror to S3 so the voice note survives
        // redeploys. Must complete before the send: Twilio fetches the URL asynchronously.
        await mirrorMediaToS3(fileName, readFileSync(outPath), 'audio/ogg');

        const sendResult = await sendCustomerMessage({
            to: phone,
            body: '',  // Voice notes have no text body
            purpose: 'service_reply',  // Human-initiated voice note
            context: 'voice_note',
            allowSmsFallback: false,  // Voice notes cannot fall back to SMS
            mediaUrl: `${base}/api/media/${fileName}`,
            mediaType: 'audio/ogg',
        });

        if (!sendResult.ok) {
            return res.status(500).json({ error: sendResult.error || sendResult.reason || 'Voice note send failed' });
        }

        res.json({ success: true, mediaUrl: `/api/media/${fileName}` });
    } catch (error: any) {
        console.error('[VoiceNotes] Send failed:', error);
        res.status(500).json({ error: error?.message || 'Voice note failed' });
    } finally {
        if (tmpPath && existsSync(tmpPath)) { try { unlinkSync(tmpPath); } catch {} }
    }
});
