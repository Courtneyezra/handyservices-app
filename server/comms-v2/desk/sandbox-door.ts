/**
 * The new desk's sandbox door: start, message, run, age, reset, state, and the planned send, for
 * the desk under server/comms-v2/desk. The surface the pipeline's end-to-end test step and Ben's
 * sandbox drive.
 *
 * Everything up to delivery runs for real: identity, the case file, the router, the Scoping
 * specialist and its tools (Gemini for a photo), the composer, the guards, the render, the
 * window. Nothing leaves: the sender runs in dry run and lands the planned reply on the case
 * file's thread as an outbound turn, so the next turn sees it. Every response carries the
 * planned send (planned-send.ts) the desk emits itself, and the thread's state.
 *
 * Case files live in memory for the length of the process; /start clears them. The door is
 * mounted only by the door host (door-host.ts, in-process on COMMS_V2_DATABASE_URL) and by
 * whoever wires /admin/sandbox to it later; it is never on the production server's routes in
 * Goal 1.
 */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { snapshot, type CaseFile } from './case-file';
import { Desk, type DeskDeps } from './desk';
import type { DeskResult } from './desk-types';
import { Gateway, type SeedInput } from './gateway';
import { windowOf } from './sender';
import { fromDoor } from './whatsapp-adapter';
import type { PlannedSend } from './planned-send';

/** The drama number, the same one the old sandbox uses, so nothing here can be a real customer. */
export const SANDBOX_PHONE_E164 = '+447700900942';
export const SANDBOX_PHONE_WA = '447700900942@c.us';
export const SANDBOX_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const SANDBOX_MAX_FILES = 8;

export interface DoorDeps extends DeskDeps {
    mediaDir?: string;
}

// ---------------------------------------------------------------- the planned send the desk emits

export function plannedSendOf(file: CaseFile, r: DeskResult): PlannedSend {
    const party = file.parties.find((p) => p.personId === r.partyId) ?? file.parties[0];
    const address = party.channels.find((c) => c.kind === 'whatsapp')?.address ?? party.channels[0]?.address ?? '';
    const guards = {} as PlannedSend['guards'];
    for (const [name, v] of Object.entries(r.guards)) guards[name as keyof PlannedSend['guards']] = { result: v.result, note: v.note };
    return {
        caseId: file.id,
        party: { role: party.role, address, name: party.name },
        channel: r.channel ?? 'whatsapp',
        windowState: r.windowState,
        templateId: r.templateId,
        bubbles: r.bubbles.map((b) => b.text),
        factIds: r.factIds,
        kbIds: r.kbIds,
        guards,
        approver: r.approver,
        runId: r.runId,
        hold: r.hold ? { approver: r.hold.approver.kind === 'human' ? r.hold.approver.id : `rules:${r.hold.approver.id}`, reason: r.hold.reason, since: r.hold.since } : null,
        delivered: r.delivered,
        evidence: { decision: r.decision, summary: r.summary, stageAfter: r.stageAfter, note: r.note, error: r.error },
    };
}

// ---------------------------------------------------------------- the door

export interface SandboxDoor {
    router: Router;
    /** The live gateway: /start and /reset replace it, so read it each time rather than holding one. */
    readonly gateway: Gateway;
    reset(): void;
}

export function createSandboxDoor(deps: DoorDeps = {}): SandboxDoor {
    const now = deps.now ?? (() => new Date());
    let gateway = new Gateway({ desk: new Desk({ ...deps, mode: 'dry_run' }), now, newId: deps.newId });
    const reset = () => { gateway = new Gateway({ desk: new Desk({ ...deps, mode: 'dry_run' }), now, newId: deps.newId }); };
    const router = Router();
    router.use((req, _res, next) => { (req as any).v2Gateway = gateway; next(); });

    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SANDBOX_MAX_FILE_BYTES, files: SANDBOX_MAX_FILES, fields: 5 } });

    const currentFile = (): CaseFile | null => {
        const r = gateway.identity.resolve('whatsapp', SANDBOX_PHONE_E164);
        if (!r.ok) return null;
        return gateway.store.findOpenFor(r.personId);
    };

    const stateOf = () => {
        const file = currentFile();
        const party = file?.parties[0] ?? null;
        const window = party ? windowOf(party, 'whatsapp', now()) : null;
        return {
            desk: 'comms_v2',
            phone: { e164: SANDBOX_PHONE_E164, wa: SANDBOX_PHONE_WA },
            conversation: file ? { id: file.id, stage: file.stage, tags: [] as string[], contactName: party?.name ?? null, createdAt: file.openedAt } : null,
            messages: file ? file.turns.map((t) => ({ id: t.id, direction: t.direction, content: t.body, createdAt: t.at, senderName: t.direction === 'inbound' ? (party?.name ?? null) : (t.approver ?? 'desk'), channel: t.channel, type: t.kind, mediaUrl: t.media[0]?.url ?? null, mediaType: t.media[0]?.mime ?? null })) : [],
            window: window ? { canFreeform: window.state === 'open', summary: window.reason } : null,
            quote: null,
            lastCall: null,
            caseFile: file ? snapshot(file) : null,
        };
    };

    const respond = (res: Response, file: CaseFile, result: DeskResult, extra: Record<string, unknown> = {}) => {
        const plannedSend = plannedSendOf(file, result);
        res.json({ ok: true, ...extra, run: { runId: result.runId, agent: 'comms_v2', decision: { kind: result.decision, approver: result.approver, reason: result.note ?? undefined }, guards: null, proposal: null, error: result.error, caseFile: { stage: file.stage } }, plannedSend, mirrored: null, state: stateOf() });
    };

    router.get('/', (_req, res) => { res.json(stateOf()); });

    router.post('/reset', (_req, res) => { reset(); res.json({ ok: true, deleted: 1, state: stateOf() }); });

    router.post('/start', async (req, res) => {
        try {
            const text = String(req.body?.text ?? '').trim();
            if (!text) { res.status(400).json({ error: 'text is required' }); return; }
            if (req.body?.door && req.body.door !== 'whatsapp') { res.status(400).json({ error: `door ${req.body.door} is not open on the new desk in Goal 1; whatsapp only` }); return; }
            reset();
            const seed = seedOf(req.body?.seed);
            const name = String(req.body?.name ?? '').trim() || null;
            if (seed.known) gateway.identity.seedCustomer('phone:07700900942', { name });
            const turn = fromDoor({ address: SANDBOX_PHONE_E164, name, text, at: now().toISOString() }, { mediaDir: deps.mediaDir });
            const out = await gateway.inbound(turn, seed);
            if (out.kind !== 'handled') { res.status(409).json({ error: out.kind === 'candidates' ? 'identity returned candidates' : out.reason }); return; }
            respond(res, out.file, out.result, { door: 'whatsapp', entry: { kind: 'whatsapp', text } });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'sandbox start failed' });
        }
    });

    const parseUpload = (req: Request, res: Response, next: () => void) => {
        if (!req.is('multipart/form-data')) { next(); return; }
        upload.array('media', SANDBOX_MAX_FILES)(req, res, (err: unknown) => {
            if (err) { res.status(400).json({ error: (err as Error)?.message ?? 'upload failed' }); return; }
            next();
        });
    };

    router.post('/message', parseUpload, async (req, res) => {
        try {
            const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({ bytes: f.buffer, mime: f.mimetype }));
            const text = String(req.body?.text ?? '').trim();
            if (!text && !files.length) { res.status(400).json({ error: 'text or media is required' }); return; }
            if (req.body?.channel && req.body.channel !== 'whatsapp') { res.status(400).json({ error: 'the new desk carries whatsapp only in Goal 1' }); return; }
            const existing = currentFile();
            const turn = fromDoor({ address: SANDBOX_PHONE_E164, name: existing?.parties[0]?.name ?? null, text, media: files, at: now().toISOString() }, { mediaDir: deps.mediaDir });
            const out = await gateway.inbound(turn);
            if (out.kind !== 'handled') { res.status(409).json({ error: out.kind === 'candidates' ? 'identity returned candidates' : out.reason }); return; }
            respond(res, out.file, out.result, { messageId: out.turn.id, channel: 'whatsapp', media: turn.media.map((m) => ({ id: m.id, kind: m.kind })) });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'sandbox message failed' });
        }
    });

    router.post('/run', async (req, res) => {
        try {
            const file = currentFile();
            if (!file) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
            const result = await gateway.clock(file.id);
            if (!result) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
            respond(res, file, result, { trigger: req.body?.trigger ?? 'manual' });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'sandbox run failed' });
        }
    });

    router.post('/age', (req, res) => {
        const hours = Number(req.body?.hours);
        if (!Number.isFinite(hours) || hours <= 0 || hours > 720) { res.status(400).json({ error: 'hours must be a number between 0 and 720' }); return; }
        const file = currentFile();
        if (!file) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
        gateway.age(file.id, hours);
        const st = stateOf();
        res.json({ ok: true, hours, window: st.window, state: st });
    });

    router.post('/call', (_req, res) => { res.status(409).json({ error: 'the call door is Goal 3; the new desk carries whatsapp only in Goal 1' }); });
    router.post('/price', (_req, res) => { res.status(409).json({ error: 'pricing is Goal 4; the new desk has no quote yet' }); });

    return { router, get gateway() { return gateway; }, reset };
}

function seedOf(raw: unknown): SeedInput {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
        prefersText: s.prefersText === true,
        alreadyRung: s.alreadyRung === true,
        known: s.customer === 'known' || s.known === true,
        facts: Array.isArray(s.facts) ? (s.facts as any[]).filter((f) => f && typeof f.key === 'string' && typeof f.value === 'string').map((f) => ({ key: f.key, value: f.value, source: String(f.source ?? 'seed') })) : [],
        ledger: Array.isArray(s.ledger) ? (s.ledger as any[]).filter((l) => l && typeof l.subject === 'string' && ['asked', 'answered', 'thanked'].includes(l.state)).map((l) => ({ subject: l.subject, state: l.state })) : [],
    };
}

/** The router the door host mounts in-process. Built on first use so importing this module opens nothing. */
let shared: SandboxDoor | null = null;
export function commsV2SandboxRouter(): Router {
    if (!shared) shared = createSandboxDoor();
    return shared.router;
}
