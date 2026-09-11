/**
 * The sandbox doors for the other four channels, mounted in front of the WhatsApp door's routes
 * (desk/sandbox-door.ts) so the pipeline's test step drives every channel the same way and the
 * same planned send comes back per turn.
 *
 *   POST /start    { door: 'sms' | 'form' | 'email' | 'call', text?, name?, seed? }
 *                  sms:   { text }                         the customer's opening SMS
 *                  form:  { text (the job), postcode?, email?, phone? }   a web form submission
 *                  email: { text, subject? }               an inbound email
 *                  call:  { outcome: 'missed' | 'answered_inbound' | 'ben_rang', transcript?, durationSeconds? }
 *                  seed adds `whatsapp: true | false`: the number is known to be on WhatsApp or not
 *                  (a form or a call cannot carry a reply, so this decides which channel the first
 *                  reply opens: WhatsApp, else SMS, else email).
 *   POST /message  { text, channel: 'sms' | 'email', subject? }   a later customer turn on that channel
 *                  (whatsapp goes to the WhatsApp door's own handler, which also takes media)
 *   POST /call     { transcript, outcome?, durationSeconds? }     Ben rings them on the current thread
 *                  (outcome defaults to ben_rang; missed and answered_inbound for the customer ringing us)
 *
 * The drama customer is one person on every door: the sandbox phone and the sandbox email are
 * linked before the first turn, so a form, an SMS, an email and a call land on one case file
 * (behaviour.md answer 25). Everything runs for real up to delivery; nothing leaves.
 */
import { Router, type Response } from 'express';
import multer from 'multer';
import type { CaseFile } from '../desk/case-file';
import type { DeskResult } from '../desk/desk-types';
import type { SeedInput } from '../desk/gateway';
import { canonical } from '../desk/identity';
import { fromDoorCall, validateDoorCall } from './call-adapter';
import type { ChannelGateway, ChannelSeed } from './channel-gateway';
import { emailThreadingFor, fromDoorEmail, type EmailThreading } from './email-adapter';
import { fromDoorForm } from './form-adapter';
import { fromDoorSms } from './sms-adapter';

export const CHANNEL_DOORS = ['sms', 'form', 'email', 'call'] as const;
export type ChannelDoor = (typeof CHANNEL_DOORS)[number];

/** The drama customer's email, on a reserved TLD (RFC 2606) so nothing here can be a real address. */
export const SANDBOX_EMAIL = 'sandbox-customer@example.invalid';

export interface ChannelDoorContext {
    gateway(): ChannelGateway;
    reset(): void;
    phone: string;
    now(): Date;
    mediaDir?: string;
    seedOf(raw: unknown): SeedInput;
    currentFile(): CaseFile | null;
    respond(res: Response, file: CaseFile, result: DeskResult, extra?: Record<string, unknown>): void;
    maxFileBytes: number;
    maxFiles: number;
}

export function channelSeedOf(raw: unknown, base: SeedInput): ChannelSeed {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { ...base, ...(typeof s.whatsapp === 'boolean' ? { whatsapp: s.whatsapp } : {}) };
}

/** One person on every door: the sandbox phone and email are the same customer. */
export function ensureSandboxIdentity(gateway: ChannelGateway, phone: string, email: string = SANDBOX_EMAIL): void {
    const p = canonical(phone);
    const e = canonical(email);
    if (!p || !e) return;
    gateway.identity.resolve('whatsapp', phone);
    gateway.identity.link(p, e, 'the sandbox drama customer: one person on every door');
}

function handled(res: Response, out: Awaited<ReturnType<ChannelGateway['inbound']>>): out is Extract<typeof out, { kind: 'handled' }> {
    if (out.kind === 'handled') return true;
    res.status(409).json({ error: out.kind === 'candidates' ? 'identity returned candidates' : out.reason });
    return false;
}

export function channelDoors(ctx: ChannelDoorContext): Router {
    const router = Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ctx.maxFileBytes, files: ctx.maxFiles, fields: 8 } });
    const parseUpload = (req: any, res: Response, next: () => void) => {
        if (!req.is('multipart/form-data')) { next(); return; }
        upload.array('media', ctx.maxFiles)(req, res, (err: unknown) => { if (err) { res.status(400).json({ error: (err as Error)?.message ?? 'upload failed' }); return; } next(); });
    };
    const filesOf = (req: any) => ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({ bytes: f.buffer, mime: f.mimetype }));
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

    router.post('/start', parseUpload, async (req, res, next) => {
        const door = str(req.body?.door);
        if (!(CHANNEL_DOORS as readonly string[]).includes(door)) { next(); return; }
        try {
            ctx.reset();
            const gateway = ctx.gateway();
            ensureSandboxIdentity(gateway, ctx.phone);
            const seed = channelSeedOf(req.body?.seed, ctx.seedOf(req.body?.seed));
            const name = str(req.body?.name) || null;
            if (seed.known) gateway.identity.seedCustomer(canonical(ctx.phone)!, { name });
            const at = ctx.now().toISOString();
            const text = str(req.body?.text);
            if (door === 'sms') {
                if (!text) { res.status(400).json({ error: 'text is required' }); return; }
                const out = await gateway.inbound(fromDoorSms({ address: ctx.phone, name, text, at }), seed);
                if (!handled(res, out)) return;
                ctx.respond(res, out.file, out.result, { door, entry: { kind: 'sms', text } });
            } else if (door === 'form') {
                if (!text) { res.status(400).json({ error: 'text (the job) is required' }); return; }
                const email = str(req.body?.email) || SANDBOX_EMAIL;
                const env = await fromDoorForm({ name, phone: ctx.phone, email, job: text, postcode: str(req.body?.postcode) || null, at, media: filesOf(req) }, { mediaDir: ctx.mediaDir });
                const out = await gateway.inbound(env, seed);
                if (!handled(res, out)) return;
                ctx.respond(res, out.file, out.result, { door, entry: { kind: 'form', text, postcode: str(req.body?.postcode) || null, email }, media: env.media.map((m) => ({ id: m.id, kind: m.kind })) });
            } else if (door === 'email') {
                if (!text) { res.status(400).json({ error: 'text is required' }); return; }
                const env = fromDoorEmail({ address: SANDBOX_EMAIL, name, subject: str(req.body?.subject) || null, text, at, media: filesOf(req) }, { mediaDir: ctx.mediaDir });
                const out = await gateway.inbound(env, seed);
                if (!handled(res, out)) return;
                ctx.respond(res, out.file, out.result, { door, entry: { kind: 'email', subject: env.email?.subject ?? null, text }, email: emailOf(out.file) });
            } else {
                const v = validateDoorCall(req.body, { address: ctx.phone, name });
                if (!v.ok) { res.status(400).json({ error: v.error }); return; }
                const out = await gateway.inbound(fromDoorCall({ ...v.input, at }), seed);
                if (!handled(res, out)) return;
                ctx.respond(res, out.file, out.result, { door, entry: { kind: 'call', outcome: v.input.outcome, durationSeconds: v.input.durationSeconds, transcriptChars: (v.input.transcript ?? '').length } });
            }
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'sandbox start failed' });
        }
    });

    router.post('/message', parseUpload, async (req, res, next) => {
        const channel = str(req.body?.channel);
        if (channel !== 'sms' && channel !== 'email') { next(); return; }
        try {
            const gateway = ctx.gateway();
            ensureSandboxIdentity(gateway, ctx.phone);
            const existing = ctx.currentFile();
            const name = existing?.parties[0]?.name ?? null;
            const text = str(req.body?.text);
            const at = ctx.now().toISOString();
            if (channel === 'sms') {
                if (!text) { res.status(400).json({ error: 'text is required' }); return; }
                if (filesOf(req).length) { res.status(400).json({ error: 'an SMS cannot carry media (a UK long code cannot receive MMS)' }); return; }
                const out = await gateway.inbound(fromDoorSms({ address: ctx.phone, name, text, at }));
                if (!handled(res, out)) return;
                ctx.respond(res, out.file, out.result, { messageId: out.turn.id, channel });
            } else {
                const files = filesOf(req);
                if (!text && !files.length) { res.status(400).json({ error: 'text or media is required' }); return; }
                const env = fromDoorEmail({ address: SANDBOX_EMAIL, name, subject: str(req.body?.subject) || null, text, at, media: files }, { mediaDir: ctx.mediaDir });
                const out = await gateway.inbound(env);
                if (!handled(res, out)) return;
                ctx.respond(res, out.file, out.result, { messageId: out.turn.id, channel, media: env.media.map((m) => ({ id: m.id, kind: m.kind })), email: emailOf(out.file) });
            }
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'sandbox message failed' });
        }
    });

    router.post('/call', async (req, res) => {
        try {
            const gateway = ctx.gateway();
            const existing = ctx.currentFile();
            if (!existing) { res.status(409).json({ error: 'no sandbox thread: start one first (or start on the call door)' }); return; }
            const v = validateDoorCall(req.body, { address: ctx.phone, name: existing.parties[0]?.name ?? null });
            if (!v.ok) { res.status(400).json({ error: v.error }); return; }
            const out = await gateway.inbound(fromDoorCall({ ...v.input, at: ctx.now().toISOString() }));
            if (!handled(res, out)) return;
            ctx.respond(res, out.file, out.result, { call: { outcome: v.input.outcome, durationSeconds: v.input.durationSeconds, transcriptChars: (v.input.transcript ?? '').length } });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'sandbox call failed' });
        }
    });

    return router;
}

/** The email thread on the file, for the door's evidence: the subject and headers the reply itself would carry. */
function emailOf(file: CaseFile): EmailThreading | null {
    const ch = file.parties[0]?.channels.find((c) => c.kind === 'email');
    if (!ch?.thread) return null;
    return emailThreadingFor(ch);
}
