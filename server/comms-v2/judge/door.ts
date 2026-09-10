/**
 * Contract 7, the doors: the only way a scenario turn enters the desk.
 *
 * Goal 1's door is WhatsApp. On the current desk that is the sandbox (/api/comms-sandbox,
 * server/spine/sandbox-routes.ts), used read-only: POST /start opens the thread with the
 * customer's first message, POST /message is every later customer turn, POST /run is a clock pass,
 * POST /age moves time, POST /call is Ben ringing them. Every call here goes over HTTP so the
 * runner never touches a specialist, a prompt or a model, and a door that cannot be reached is an
 * error, never a mocked pass.
 *
 * One way to reach it: the exported router is mounted on a loopback express server for the length
 * of the run. The router is the real one, so it needs the model keys, and it connects only to
 * COMMS_V2_JUDGE_DATABASE_URL (a Neon branch): the judge refuses to open without it, refuses a
 * value that names the production database, and never reads DATABASE_URL, so a production .env
 * cannot be driven by mistake. There is no door to a running server: the judge cannot see which
 * database a remote server is on, so it never drives one.
 *
 * The door reports no variable's value: a client carries its mode and host only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isProductionDatabaseUrl } from '../../worker-gate';
import type { Seed } from './scenario';
import type { SeedFeature } from './expectations';
import { FIXTURES_DIR } from './scenario';

export type DoorErrorKind = 'unreachable' | 'timeout' | 'http' | 'shape' | 'refused';

export class DoorError extends Error {
    constructor(public readonly kind: DoorErrorKind, message: string, public readonly status?: number, public readonly body?: unknown) {
        super(message);
        this.name = 'DoorError';
    }
}

export interface DoorMedia { file: string; mime: string; bytes: Buffer }

export interface DoorClient {
    readonly mode: 'in_process';
    /** Host and port of the door, the only thing about its address a log or a report carries. */
    readonly host: string;
    /** A clean thread with no message on it yet (for an opening turn that carries photos). */
    reset(): Promise<unknown>;
    /** The customer's opening WhatsApp message: resets the sandbox and opens the thread. */
    start(input: { text: string; name: string | null }): Promise<unknown>;
    /** A later customer WhatsApp message, with optional photos or videos. */
    message(input: { text: string; media?: DoorMedia[] }): Promise<unknown>;
    /** A clock pass with no new message. */
    clock(): Promise<unknown>;
    /** Move every timestamp back N hours. */
    age(hours: number): Promise<unknown>;
    /** Ben rings them; the call is answered. */
    call(transcript: string): Promise<unknown>;
    /** Ben prices the waiting draft and sends. */
    price(totalPence?: number): Promise<unknown>;
    /** The thread as it stands. */
    state(): Promise<unknown>;
    close(): Promise<void>;
}

export interface DoorOptions {
    timeoutMs?: number;
}

/**
 * Ten minutes. One pass on the current desk can run the quote clerk chain (intake, estimator,
 * material and web searches) and take several minutes; a door that is truly wedged still errors.
 */
export const DEFAULT_DOOR_TIMEOUT_MS = 600_000;

/** The one database variable the judge reads. The in-process door refuses to open without it. */
export const JUDGE_DATABASE_ENV = 'COMMS_V2_JUDGE_DATABASE_URL';

// ---------------------------------------------------------------- the seed, as the door can honour it

export interface SeedPlan {
    /** Features the current door honours, and how. */
    honoured: Partial<Record<SeedFeature, string>>;
    /** Features it cannot, and why. Expectations that depend on one fail with that reason. */
    unsupported: Partial<Record<SeedFeature, string>>;
    /** Door calls to make after /start, in order. */
    afterStart: Array<{ op: 'age'; hours: number }>;
}

/**
 * What the sandbox WhatsApp door can do with a seed today. Pure, so it is tested. The new desk's
 * gateway (Goal 1) is expected to honour every feature; the report records which ones this run did.
 */
export function seedPlan(seed: Seed): SeedPlan {
    const plan: SeedPlan = { honoured: {}, unsupported: {}, afterStart: [] };
    if (seed.customer === 'known') plan.unsupported.customer = 'the sandbox always opens a fresh thread on the drama number; no customer record can be seeded';
    if (seed.prefersText) plan.unsupported.prefersText = 'no seed field on the current door; the scenario states it in a customer turn ("text only please")';
    if (seed.alreadyRung) plan.unsupported.alreadyRung = 'the whatsapp door cannot seed an earlier inbound call; the post_call and missed-call doors are Goal 3';
    if (seed.facts.length) plan.unsupported.facts = 'the current desk has no case-file facts to seed';
    if (seed.ledger.length) plan.unsupported.ledger = 'the current desk derives its ask ledger from the thread; entries cannot be seeded';
    if (seed.window === 'shut') {
        plan.afterStart.push({ op: 'age', hours: 25 });
        plan.honoured.window = 'POST /age 25 hours after the opening message, then checked on the thread';
    }
    if (seed.name != null) plan.honoured.customer = plan.honoured.customer ?? `name "${seed.name}" passed to POST /start as the pushname`;
    return plan;
}

/** Read a fixture for a customer turn's media. */
export function loadFixture(file: string, mime: string): DoorMedia {
    const p = path.join(FIXTURES_DIR, path.basename(file));
    if (!fs.existsSync(p)) throw new DoorError('shape', `fixture not found: ${file}`);
    return { file: path.basename(file), mime, bytes: fs.readFileSync(p) };
}

// ---------------------------------------------------------------- the loopback client

class LoopbackDoor implements DoorClient {
    readonly mode = 'in_process' as const;
    readonly host: string;
    constructor(private readonly baseUrl: string, private readonly timeoutMs: number, private readonly onClose: () => Promise<void>) {
        this.host = new URL(baseUrl).host;
    }

    private async request(method: 'GET' | 'POST', route: string, body?: unknown, form?: FormData): Promise<unknown> {
        const url = `${this.baseUrl.replace(/\/$/, '')}${route}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        const headers: Record<string, string> = { accept: 'application/json' };
        if (body !== undefined) headers['content-type'] = 'application/json';
        let res: Response;
        try {
            res = await fetch(url, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: ctrl.signal });
        } catch (err: any) {
            clearTimeout(timer);
            if (err?.name === 'AbortError') throw new DoorError('timeout', `${method} ${route} timed out after ${this.timeoutMs} ms`);
            throw new DoorError('unreachable', `${method} ${route} could not be reached: ${err?.cause?.message ?? err?.message ?? err}`);
        }
        clearTimeout(timer);
        const text = await res.text();
        let json: unknown = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = text; }
        if (!res.ok) {
            const msg = (json && typeof json === 'object' && 'error' in json) ? String((json as { error: unknown }).error) : text.slice(0, 200);
            throw new DoorError(res.status === 400 || res.status === 409 ? 'refused' : 'http', `${method} ${route} -> ${res.status}: ${msg}`, res.status, json);
        }
        return json;
    }

    reset() { return this.request('POST', '/reset', {}); }
    start(input: { text: string; name: string | null }) {
        return this.request('POST', '/start', { door: 'whatsapp', text: input.text, name: input.name ?? '' });
    }
    message(input: { text: string; media?: DoorMedia[] }) {
        if (!input.media?.length) return this.request('POST', '/message', { text: input.text, channel: 'whatsapp' });
        const form = new FormData();
        form.set('text', input.text);
        form.set('channel', 'whatsapp');
        for (const m of input.media) form.append('media', new Blob([new Uint8Array(m.bytes)], { type: m.mime }), m.file);
        return this.request('POST', '/message', undefined, form);
    }
    clock() { return this.request('POST', '/run', { trigger: 'manual' }); }
    age(hours: number) { return this.request('POST', '/age', { hours }); }
    call(transcript: string) { return this.request('POST', '/call', { transcript }); }
    price(totalPence?: number) { return this.request('POST', '/price', totalPence ? { totalPence } : {}); }
    state() { return this.request('GET', '/'); }
    close() { return this.onClose(); }
}

/** Open the door: the exported sandbox router in-process, on the judge's own database. */
export async function openDoor(opts: DoorOptions = {}): Promise<DoorClient> {
    const timeoutMs = opts.timeoutMs ?? Number(process.env.COMMS_V2_DOOR_TIMEOUT_MS ?? DEFAULT_DOOR_TIMEOUT_MS);
    // The router's database module reads DATABASE_URL at import, so the branch is put there first;
    // whatever .env held is never consulted.
    const judgeDatabase = process.env[JUDGE_DATABASE_ENV];
    if (!judgeDatabase) {
        throw new DoorError('refused', `${JUDGE_DATABASE_ENV} is not set. The door connects only to the Neon branch it names, never to DATABASE_URL.`);
    }
    if (isProductionDatabaseUrl(judgeDatabase)) {
        throw new DoorError('refused', `${JUDGE_DATABASE_ENV} points at the production database. The judge runs only against a Neon branch; put the branch's connection string there.`);
    }
    process.env.DATABASE_URL = judgeDatabase;
    let router: unknown;
    try {
        ({ commsSandboxRouter: router } = await import('../../spine/sandbox-routes'));
    } catch (err: any) {
        throw new DoorError('unreachable', `the sandbox router could not be loaded in-process: ${err?.message ?? err}. This process needs ${JUDGE_DATABASE_ENV} and the model keys.`);
    }
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/comms-sandbox', router as any);
    const server = await new Promise<import('node:http').Server>((resolve, reject) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
        s.on('error', reject);
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return new LoopbackDoor(`http://127.0.0.1:${port}/api/comms-sandbox`, timeoutMs, () => new Promise((resolve) => server.close(() => resolve())));
}
