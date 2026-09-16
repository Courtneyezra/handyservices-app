/**
 * The separate safeguard: an accepted email is kept, handed to the desk until the desk has it, with
 * backoff and a bounded count, and never lands twice however it is handed over again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendTurn, type CaseFile, type Turn } from '../desk/case-file';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import { DatabaseCaseFileStore, type CaseFileRows } from '../desk/database-store';
import { ChannelGateway } from './channel-gateway';
import { fromDoorEmail } from './email-adapter';
import type { InboundEnvelope } from './envelope';
import { CLAIM_MS, deliveryIdOf, inboundEmailQueue, MAX_ATTEMPTS, MemoryInboundEmailRows, RETRY_DELAYS_MS, type InboundEmailQueueDeps } from './inbound-email-store';
import { forwardNow, resetLiveChannelGateway } from './intake';

vi.mock('../../db', () => ({ db: {} }));

const EMAIL_ID = '56761188-7520-42d8-8898-ff6fc54ce618';
const envelope = (): InboundEnvelope => fromDoorEmail({ address: 'sam@example.invalid', name: 'Sam Jones', subject: 'Leaking tap', text: 'It drips.', at: '2026-09-16T09:12:42.000Z', messageId: '<e1@example.invalid>' });

function harness(over: Partial<InboundEmailQueueDeps> = {}) {
    let t = Date.parse('2026-09-16T09:13:00.000Z');
    const rows = new MemoryInboundEmailRows();
    const warn = vi.fn();
    const error = vi.fn();
    const notify = vi.fn(async () => {});
    const handOver = vi.fn(async (_id: string, _e: InboundEnvelope) => {});
    const deps: InboundEmailQueueDeps = { rows: async () => rows, handOver, now: () => new Date(t), log: { warn, error }, notify, pageable: true, ...over };
    return { rows, queue: inboundEmailQueue(deps), handOver: (over.handOver ?? handOver) as typeof handOver, warn, error, notify, advance: (ms: number) => { t += ms; }, row: () => rows.rows.get(EMAIL_ID)! };
}

describe('keeping an email', () => {
    it('writes one row per email id; a redelivery writes nothing more', async () => {
        const h = harness();
        expect(await h.queue.has(EMAIL_ID)).toBe(false);
        expect(await h.queue.store(EMAIL_ID, envelope())).toBe(true);
        expect(await h.queue.store(EMAIL_ID, { ...envelope(), text: 'changed' })).toBe(false);
        expect(await h.queue.has(EMAIL_ID)).toBe(true);
        expect(h.rows.rows.size).toBe(1);
        expect(h.row()).toMatchObject({ status: 'pending', attempts: 0 });
        expect(h.row().envelope.text).toBe(envelope().text);
    });
});

describe('handing it to the desk', () => {
    it('marks the row done once the desk has it, and never hands a done row over again', async () => {
        const h = harness();
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('handed');
        expect(h.handOver).toHaveBeenCalledWith(EMAIL_ID, envelope());
        expect(h.row()).toMatchObject({ status: 'done', attempts: 1, claimId: null });
        expect(await h.queue.attempt(EMAIL_ID)).toBe('not_due');
        h.advance(24 * 60 * 60_000);
        expect(await h.queue.retryDue()).toEqual({ due: 0, handed: 0, retrying: 0, failed: 0, errors: 0 });
        expect(h.handOver).toHaveBeenCalledTimes(1);
    });

    it('retries a failed hand-over after the backoff, and marks it done when the desk takes it', async () => {
        const handOver = vi.fn()
            .mockRejectedValueOnce(new Error('connection terminated unexpectedly'))
            .mockRejectedValueOnce(new Error('the gateway could not be built'))
            .mockResolvedValue(undefined);
        const h = harness({ handOver });
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('retrying');
        expect(h.row()).toMatchObject({ status: 'pending', attempts: 1, lastError: 'connection terminated unexpectedly', claimId: null });
        expect(h.warn).toHaveBeenCalledWith(expect.stringContaining(`received email ${EMAIL_ID} to the desk failed (attempt 1 of ${MAX_ATTEMPTS})`));
        // Not due until the first wait has passed.
        h.advance(RETRY_DELAYS_MS[0] - 1);
        expect((await h.queue.retryDue()).due).toBe(0);
        h.advance(1);
        expect(await h.queue.retryDue()).toEqual({ due: 1, handed: 0, retrying: 1, failed: 0, errors: 0 });
        // The second wait is longer than the first.
        h.advance(RETRY_DELAYS_MS[0]);
        expect((await h.queue.retryDue()).due).toBe(0);
        h.advance(RETRY_DELAYS_MS[1] - RETRY_DELAYS_MS[0]);
        expect(await h.queue.retryDue()).toEqual({ due: 1, handed: 1, retrying: 0, failed: 0, errors: 0 });
        expect(handOver).toHaveBeenCalledTimes(3);
        expect(h.row()).toMatchObject({ status: 'done', attempts: 3, lastError: null });
        expect(h.error).not.toHaveBeenCalled();
    });

    it('keeps an email that spends every attempt as failed, logs it at error level and pages; it is never dropped or tried again', async () => {
        const handOver = vi.fn(async () => { throw new Error('desk down'); });
        const h = harness({ handOver });
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('retrying');
        for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
            h.advance(RETRY_DELAYS_MS[i]);
            const pass = await h.queue.retryDue();
            expect(pass.due).toBe(1);
            expect(i < RETRY_DELAYS_MS.length - 1 ? pass.retrying : pass.failed).toBe(1);
        }
        expect(handOver).toHaveBeenCalledTimes(MAX_ATTEMPTS);
        expect(h.row()).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, lastError: 'desk down' });
        expect(h.row().envelope).toEqual(envelope());
        expect(h.error).toHaveBeenCalledTimes(1);
        expect(h.error.mock.calls[0][0]).toContain(`received email ${EMAIL_ID} could not be handed to the desk after ${MAX_ATTEMPTS} attempts; it is kept as failed`);
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(h.notify.mock.calls[0]).toEqual(['Inbound email not handed to the desk', expect.stringContaining(EMAIL_ID)]);
        h.advance(7 * 24 * 60 * 60_000);
        expect((await h.queue.retryDue()).due).toBe(0);
        expect(await h.queue.attempt(EMAIL_ID)).toBe('not_due');
        expect(handOver).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    it('does not page outside production, but still logs at error level', async () => {
        const h = harness({ handOver: async () => { throw new Error('desk down'); }, pageable: false });
        await h.queue.store(EMAIL_ID, envelope());
        for (let i = 0; i < MAX_ATTEMPTS; i++) { await h.queue.attempt(EMAIL_ID); h.advance(RETRY_DELAYS_MS[i] ?? 0); }
        expect(h.row().status).toBe('failed');
        expect(h.error).toHaveBeenCalledTimes(1);
        expect(h.notify).not.toHaveBeenCalled();
    });

    it('never runs two attempts on one row at once, and takes a row again once an attempt that died has let its hold run out', async () => {
        const releases: Array<() => void> = [];
        const handOver = vi.fn(() => new Promise<void>((r) => { releases.push(r); }));
        const h = harness({ handOver });
        await h.queue.store(EMAIL_ID, envelope());
        const first = h.queue.attempt(EMAIL_ID);
        await vi.waitFor(() => expect(handOver).toHaveBeenCalledTimes(1));
        expect(await h.queue.attempt(EMAIL_ID)).toBe('not_due');
        expect((await h.queue.retryDue()).due).toBe(0);
        // The first attempt's process is gone: its hold runs out and the row is taken again.
        h.advance(CLAIM_MS);
        const second = h.queue.attempt(EMAIL_ID);
        await vi.waitFor(() => expect(handOver).toHaveBeenCalledTimes(2));
        // The stale attempt finishing writes nothing over the live one's hold.
        await h.rows.handed(EMAIL_ID, 'a-claim-that-is-gone', new Date());
        expect(h.row().status).toBe('pending');
        releases[1]();
        expect(await second).toBe('handed');
        expect(h.row().status).toBe('done');
        releases[0]();
        expect(await first).toBe('handed');
        expect(h.row()).toMatchObject({ status: 'done', attempts: 2 });
    });

    it('a failure to mark the row done is logged, and the next attempt marks it', async () => {
        const h = harness();
        await h.queue.store(EMAIL_ID, envelope());
        const handed = vi.spyOn(h.rows, 'handed').mockRejectedValueOnce(new Error('write failed'));
        expect(await h.queue.attempt(EMAIL_ID)).toBe('handed');
        expect(h.error).toHaveBeenCalledWith(expect.stringContaining(`marking received email ${EMAIL_ID} handed failed`));
        expect(h.row().status).toBe('pending');
        h.advance(CLAIM_MS);
        expect(await h.queue.attempt(EMAIL_ID)).toBe('handed');
        expect(h.row().status).toBe('done');
        handed.mockRestore();
    });
});

/** The case file table in memory, whose writes can be made to fail. */
class CaseRows implements CaseFileRows {
    readonly files = new Map<string, CaseFile>();
    down = false;
    /** Files whose writes fail even when the table is up. */
    readonly stuck = new Set<string>();
    async loadAll() { return Array.from(this.files.values()).map((f) => JSON.parse(JSON.stringify(f)) as CaseFile); }
    async upsert(file: CaseFile) {
        if (this.down) throw new Error('connection terminated unexpectedly');
        if (this.stuck.has(file.id)) throw new Error('value too long for the row');
        this.files.set(file.id, JSON.parse(JSON.stringify(file)));
    }
    async deleteAll() { this.files.clear(); }
}

/**
 * A desk that counts its runs. `throws` runs throw first; `reply` lands a reply answering the turn
 * (before the throw when `replyThenThrow`); `decision` is what a run that returns decided.
 */
function deskCounting(opts: { throwOnce?: boolean; throws?: number; reply?: boolean; replyThenThrow?: boolean; decision?: DeskResult['decision'] } = {}) {
    const runs: Turn[] = [];
    let throwsLeft = opts.throws ?? (opts.throwOnce ? 1 : 0);
    const desk: DeskLike = {
        async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> {
            runs.push(turn);
            const runId = `run_${runs.length}`;
            const reply = () => appendTurn(file, { at: turn.at, channel: turn.channel, kind: 'text', body: 'Thanks, we are on it.', media: [], partyId: turn.partyId, direction: 'outbound', runId, approver: 'agent.comms_v2', answers: [turn.id] });
            if (throwsLeft > 0) {
                throwsLeft--;
                if (opts.replyThenThrow) reply();
                throw new Error('the composer failed');
            }
            if (opts.reply) reply();
            return { runId, decision: opts.decision ?? (opts.reply ? 'send' : 'none'), partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 };
        },
        async clockPass(file: CaseFile): Promise<DeskResult> { return this.handleTurn(file, file.turns[0]); },
    };
    return { desk, runs };
}

async function gatewayOn(rows: CaseRows, desk: DeskLike): Promise<ChannelGateway> {
    const store = await new DatabaseCaseFileStore(rows, { retryMs: 60_000 }).load();
    const g = new ChannelGateway({ desk, store });
    resetLiveChannelGateway(g);
    return g;
}

const emailTurns = (rows: CaseRows) => Array.from(rows.files.values()).flatMap((f) => f.turns).filter((t) => t.channel === 'email');
const inboundEmails = (rows: CaseRows) => emailTurns(rows).filter((t) => t.direction === 'inbound');
const replies = (rows: CaseRows) => emailTurns(rows).filter((t) => t.direction === 'outbound');
const throughIntake = { handOver: async (id: string, env: InboundEnvelope) => { await forwardNow({ kind: 'email_received', envelope: env, deliveryId: deliveryIdOf(id) }); } };

describe('through the intake: one turn and one desk run per email', () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    afterEach(() => { resetLiveChannelGateway(); });

    it('the same email handed over twice lands one turn, carrying its delivery id, and runs the desk once', async () => {
        const cases = new CaseRows();
        const { desk, runs } = deskCounting();
        await gatewayOn(cases, desk);
        const first = await forwardNow({ kind: 'email_received', envelope: envelope(), deliveryId: deliveryIdOf(EMAIL_ID) });
        expect(first).toEqual({ forwarded: 1, skipped: [] });
        const again = await forwardNow({ kind: 'email_received', envelope: envelope(), deliveryId: deliveryIdOf(EMAIL_ID) });
        expect(again).toEqual({ forwarded: 0, skipped: ['already on a case file'] });
        expect(runs).toHaveLength(1);
        expect(emailTurns(cases)).toHaveLength(1);
        expect(emailTurns(cases)[0].deliveryId).toBe(`resend:${EMAIL_ID}`);
        // A different email from the same sender is its own turn.
        await forwardNow({ kind: 'email_received', envelope: { ...envelope(), at: '2026-09-16T09:20:00.000Z' }, deliveryId: deliveryIdOf('another-email') });
        expect(emailTurns(cases)).toHaveLength(2);
    });

    it('a hand-over racing one still at the desk waits for that run and finds its turn handled: one turn, one desk run', async () => {
        const cases = new CaseRows();
        let release!: () => void;
        const { desk: inner, runs } = deskCounting();
        const desk: DeskLike = { ...inner, handleTurn: async (f, t) => { await new Promise<void>((r) => { release = r; }); return inner.handleTurn(f, t); } };
        const g = await gatewayOn(cases, desk);
        const event = { kind: 'email_received' as const, envelope: envelope(), deliveryId: deliveryIdOf(EMAIL_ID) };
        const first = forwardNow(event);
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const racing = g.inbound(envelope(), {}, { deliveryId: deliveryIdOf(EMAIL_ID) });
        release();
        await first;
        await expect(racing).resolves.toMatchObject({ kind: 'duplicate' });
        expect(runs).toHaveLength(1);
        expect(emailTurns(cases)).toHaveLength(1);
    });

    it('a database blip: the file is not written, so the row stays pending; the retry writes it with no second turn', async () => {
        const cases = new CaseRows();
        const { desk, runs } = deskCounting();
        await gatewayOn(cases, desk);
        cases.down = true;
        const h = harness({ handOver: async (id, env) => { await forwardNow({ kind: 'email_received', envelope: env, deliveryId: deliveryIdOf(id) }); } });
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('retrying');
        expect(h.row().lastError).toBe('connection terminated unexpectedly');
        expect(cases.files.size).toBe(0);
        cases.down = false;
        h.advance(RETRY_DELAYS_MS[0]);
        expect((await h.queue.retryDue()).handed).toBe(1);
        expect(h.row().status).toBe('done');
        expect(emailTurns(cases)).toHaveLength(1);
        expect(runs).toHaveLength(1);
    });

    it('the gateway failing to build: nothing lands, and the retry hands the email over once the gateway is back', async () => {
        const cases = new CaseRows();
        const { desk, runs } = deskCounting();
        const h = harness({
            handOver: async (id, env) => { await forwardNow({ kind: 'email_received', envelope: env, deliveryId: deliveryIdOf(id) }); },
        });
        resetLiveChannelGateway();
        vi.stubEnv('COMMS_V2_DATABASE_URL', '');
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('retrying');
        expect(h.row().lastError).toMatch(/COMMS_V2_DATABASE_URL/);
        vi.unstubAllEnvs();
        await gatewayOn(cases, desk);
        h.advance(RETRY_DELAYS_MS[0]);
        expect((await h.queue.retryDue()).handed).toBe(1);
        expect(emailTurns(cases)).toHaveLength(1);
        expect(runs).toHaveLength(1);
    });

    it('a desk run that throws after the turn landed: the retry runs the desk on that turn again, and the email gets exactly one reply', async () => {
        const cases = new CaseRows();
        const { desk, runs } = deskCounting({ throwOnce: true, reply: true });
        await gatewayOn(cases, desk);
        const h = harness(throughIntake);
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('retrying');
        expect(h.row().status).toBe('pending');
        expect(replies(cases)).toHaveLength(0);
        h.advance(RETRY_DELAYS_MS[0]);
        expect((await h.queue.retryDue()).handed).toBe(1);
        expect(h.row().status).toBe('done');
        expect(runs).toHaveLength(2);
        expect(runs[1].id).toBe(runs[0].id);
        expect(inboundEmails(cases)).toHaveLength(1);
        expect(replies(cases)).toHaveLength(1);
        expect(replies(cases)[0].answers).toEqual([inboundEmails(cases)[0].id]);
        // Handed over once more, the answered turn runs nothing.
        await forwardNow({ kind: 'email_received', envelope: envelope(), deliveryId: deliveryIdOf(EMAIL_ID) });
        expect(runs).toHaveLength(2);
        expect(replies(cases)).toHaveLength(1);
    });

    it('a desk run that replied and then threw: the retry finds the turn answered, sends nothing more and marks the row done', async () => {
        const cases = new CaseRows();
        const { desk, runs } = deskCounting({ throwOnce: true, replyThenThrow: true });
        await gatewayOn(cases, desk);
        const h = harness(throughIntake);
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('retrying');
        expect(replies(cases)).toHaveLength(1);
        h.advance(RETRY_DELAYS_MS[0]);
        expect((await h.queue.retryDue()).handed).toBe(1);
        expect(h.row().status).toBe('done');
        expect(runs).toHaveLength(1);
        expect(replies(cases)).toHaveLength(1);
    });

    it('a held turn is handled: the row is done with no reply, and a later hand-over reads the recorded result and runs nothing', async () => {
        const cases = new CaseRows();
        const { desk, runs } = deskCounting({ decision: 'hold' });
        await gatewayOn(cases, desk);
        const h = harness(throughIntake);
        await h.queue.store(EMAIL_ID, envelope());
        vi.spyOn(h.rows, 'handed').mockRejectedValueOnce(new Error('process killed'));
        expect(await h.queue.attempt(EMAIL_ID)).toBe('handed');
        expect(h.row().status).toBe('pending');
        expect(inboundEmails(cases)[0].handledBy).toBe('run_1');
        // A restart reads the file back, the hold runs out, and the next attempt marks the row.
        const after = deskCounting();
        await gatewayOn(cases, after.desk);
        h.advance(CLAIM_MS);
        expect((await h.queue.retryDue()).handed).toBe(1);
        expect(h.row().status).toBe('done');
        expect(runs).toHaveLength(1);
        expect(after.runs).toHaveLength(0);
        expect(replies(cases)).toHaveLength(0);
    });

    it('a desk that throws on every attempt: the email is kept as failed, logged at error level and paged, with one turn on the file', async () => {
        const cases = new CaseRows();
        const { desk, runs } = deskCounting({ throws: Infinity });
        await gatewayOn(cases, desk);
        const h = harness(throughIntake);
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('retrying');
        for (const wait of RETRY_DELAYS_MS) { h.advance(wait); await h.queue.retryDue(); }
        expect(h.row()).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, lastError: 'the composer failed' });
        expect(runs).toHaveLength(MAX_ATTEMPTS);
        expect(inboundEmails(cases)).toHaveLength(1);
        expect(h.error).toHaveBeenCalledWith(expect.stringContaining(`received email ${EMAIL_ID} could not be handed to the desk after ${MAX_ATTEMPTS} attempts`));
        expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it('another case file whose writes keep failing does not hold this email', async () => {
        const cases = new CaseRows();
        const { desk } = deskCounting();
        const g = await gatewayOn(cases, desk);
        await g.inbound(fromDoorEmail({ address: 'alex@example.invalid', name: 'Alex Stone', subject: 'Shelves', text: 'Two shelves.', at: '2026-09-16T09:00:00.000Z', messageId: '<a1@example.invalid>' }));
        const other = Array.from(cases.files.keys())[0];
        cases.stuck.add(other);
        g.store.put(g.store.get(other)!);
        const h = harness(throughIntake);
        await h.queue.store(EMAIL_ID, envelope());
        expect(await h.queue.attempt(EMAIL_ID)).toBe('handed');
        expect(h.row().status).toBe('done');
        expect(inboundEmails(cases).filter((t) => t.deliveryId === deliveryIdOf(EMAIL_ID))).toHaveLength(1);
    });

    it('a restart after the desk took the email but before the row was marked: the new process marks it with no second turn or run', async () => {
        const cases = new CaseRows();
        const before = deskCounting();
        await gatewayOn(cases, before.desk);
        const h = harness({ handOver: async (id, env) => { await forwardNow({ kind: 'email_received', envelope: env, deliveryId: deliveryIdOf(id) }); } });
        await h.queue.store(EMAIL_ID, envelope());
        vi.spyOn(h.rows, 'handed').mockRejectedValueOnce(new Error('process killed'));
        expect(await h.queue.attempt(EMAIL_ID)).toBe('handed');
        expect(h.row().status).toBe('pending');
        // The process restarts: a new gateway reads the case files back, and the hold runs out.
        const after = deskCounting();
        await gatewayOn(cases, after.desk);
        h.advance(CLAIM_MS);
        expect((await h.queue.retryDue()).handed).toBe(1);
        expect(h.row().status).toBe('done');
        expect(before.runs).toHaveLength(1);
        expect(after.runs).toHaveLength(0);
        expect(emailTurns(cases)).toHaveLength(1);
        logs.mockClear();
    });
});
