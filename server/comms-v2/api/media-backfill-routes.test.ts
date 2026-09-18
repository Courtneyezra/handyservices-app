/**
 * The media backfill's two routes (media-backfill-routes.ts): the plan reads, the apply needs a
 * signed-in session the approvers row lists for a slot, the plan's digest and the expected count,
 * and a plan shows ids and counts, never a customer's words or number.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseFile } from '../desk/case-file';
import { MemoryCaseFileStore } from '../desk/store';
import { MEDIA_S3_PREFIX, type BackfillIo, type OldDeskCopy } from '../media-backfill';
import type { ApproverAssignments } from './approvers';
import { createMediaBackfillRouter } from './media-backfill-routes';

const NUMBER = '+447700900003';
const store = new MemoryCaseFileStore();
store.put({
    id: 'case_r',
    parties: [{ personId: 'person_r', channels: [{ kind: 'whatsapp', address: NUMBER, lastInboundAt: null }] }],
    turns: [{ id: 't1', at: '2026-09-16T10:00:00.300Z', channel: 'whatsapp', direction: 'inbound', partyId: 'person_r', kind: 'media', body: 'the leak', runId: null, approver: null,
        media: [{ id: 'v2_r', kind: 'video', mime: 'video/mp4', path: '/srv/media/v2_r.mp4', url: '/api/media/v2_r.mp4', description: null }] }],
} as unknown as CaseFile);

const twin: OldDeskCopy = { messageId: 'MMr', kind: 'video', at: '2026-09-16T10:00:00.100Z', text: 'the leak', customer: NUMBER.replace(/\D/g, ''), file: 'MMr.mp4' };
const objects = new Map<string, number>([[`${MEDIA_S3_PREFIX}MMr.mp4`, 2048]]);
const io: BackfillIo = {
    resolves: async (file) => objects.has(MEDIA_S3_PREFIX + file),
    oldDeskCopies: async () => [twin],
    objectSize: async (key) => objects.get(key) ?? null,
    copyObject: async (from, to) => { if (objects.has(to)) throw new Error('overwrite'); objects.set(to, objects.get(from)!); },
    quotesCarrying: async () => [],
    replaceQuoteUrls: async () => false,
    otherReferences: async () => ({ dispatches: 0, messages: 0 }),
};

const assignments: ApproverAssignments = { ben: ['user_ben@example.test'] };
let server: import('node:http').Server;
let base: string;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const email = req.header('x-test-user');
        if (email) (req as any).user = { id: `user_${email}`, email, role: 'admin' };
        next();
    });
    app.use('/api/comms-v2/media-backfill', createMediaBackfillRouter({ source: async () => ({ store, live: false, mode: 'dry_run' }), approvers: async () => assignments, io: () => io }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/comms-v2/media-backfill`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function post(route: string, body: unknown, as?: string) {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(as ? { 'x-test-user': as } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() as any };
}

describe('the media backfill routes', () => {
    it('plans: ids and counts, never the customer\'s words or number', async () => {
        const { status, json } = await post('/plan', {});
        expect(status).toBe(200);
        expect(json.counts).toMatchObject({ lost: 1, ready: 1, needsPerson: 0, noTwin: 0 });
        expect(json.ready).toEqual([{ mediaId: 'v2_r', fileId: 'case_r', kind: 'video', by: 'isolated', twinMessageId: 'MMr', twinUrl: '/api/media/MMr.mp4', newUrl: '/api/media/v2_r-restored.mp4' }]);
        const text = JSON.stringify(json);
        expect(text).not.toContain('the leak');
        expect(text).not.toContain(NUMBER.replace(/\D/g, ''));
    });

    it('applies only for a session with an approver slot, and only with the digest and the expected count', async () => {
        const { json: plan } = await post('/plan', {});
        expect((await post('/apply', { digest: plan.digest, expect: 1 })).status).toBe(401);
        expect((await post('/apply', { digest: plan.digest, expect: 1 }, 'someone@example.test')).status).toBe(403);
        expect((await post('/apply', { expect: 1 }, 'ben@example.test')).status).toBe(400);
        expect((await post('/apply', { digest: plan.digest, expect: 2 }, 'ben@example.test')).status).toBe(409);
        expect(objects.has(`${MEDIA_S3_PREFIX}v2_r-restored.mp4`)).toBe(false);

        const applied = await post('/apply', { digest: plan.digest, expect: 1 }, 'ben@example.test');
        expect(applied.status).toBe(200);
        expect(applied.json.result).toMatchObject({ restored: 1, failed: [], stillPointingAtLost: { caseFileItems: 0 } });
        expect(objects.get(`${MEDIA_S3_PREFIX}v2_r-restored.mp4`)).toBe(2048);
    });
});
