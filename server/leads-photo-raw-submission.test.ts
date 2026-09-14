/**
 * The web form now carries photos as base64 bytes (comms-v2 photo upload). Those bytes are
 * already durably captured on disk via the comms-v2 intake path's writeVerifiedPhoto — storing
 * them a second time in `leads.transcriptJson.rawSubmission` would duplicate multi-megabyte
 * blobs across every admin lead-list/dashboard read of this table. This exercises the real
 * POST /api/leads handler and asserts the row it inserts never carries photo base64 content.
 */
import { describe, it, expect, vi } from 'vitest';
import express, { type Router } from 'express';
import http from 'http';

const insertedValues: any[] = [];

vi.mock('./db', () => {
    const chain = (): any => {
        const p: any = Promise.resolve([]);
        for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'set', 'returning',
            'innerJoin', 'leftJoin', 'groupBy', 'onConflictDoUpdate', 'onConflictDoNothing']) {
            p[m] = () => chain();
        }
        p.values = (v: any) => { insertedValues.push(v); return chain(); };
        return p;
    };
    return {
        db: {
            select: () => chain(),
            insert: () => chain(),
            update: () => chain(),
            delete: () => chain(),
            execute: () => Promise.resolve({ rows: [] }),
        },
    };
});

import { leadsRouter } from './leads';

async function requestThrough(router: Router, method: string, path: string, body?: unknown) {
    const app = express();
    app.use(express.json({ limit: '40mb' }));
    app.use(router);
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json() as any };
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

describe('POST /api/leads — rawSubmission never carries photo base64 content', () => {
    it('replaces each photo\'s contentBase64 with a byte count before storing rawSubmission', async () => {
        const contentBase64 = Buffer.alloc(1024, 'a').toString('base64'); // ~1368 chars
        const { status, body } = await requestThrough(leadsRouter, 'POST', '/api/leads', {
            customerName: 'Jane Doe',
            phone: '07700900000',
            jobDescription: 'Leaky tap',
            source: 'web_quote',
            stripePaymentId: 'pi_test_skip_side_effects',
            photos: [{ contentBase64, mime: 'image/jpeg' }],
        });

        expect(status).toBe(201);
        expect(body.success).toBe(true);

        expect(insertedValues.length).toBeGreaterThan(0);
        const inserted = insertedValues[0];
        const storedPhotos = inserted.transcriptJson.rawSubmission.photos;

        expect(storedPhotos).toHaveLength(1);
        expect(storedPhotos[0]).not.toHaveProperty('contentBase64');
        expect(storedPhotos[0].mime).toBe('image/jpeg');
        expect(storedPhotos[0].bytes).toBe(1024);

        // The rest of the raw submission (non-photo fields) is still preserved.
        expect(inserted.transcriptJson.rawSubmission.customerName).toBe('Jane Doe');
    });

    it('leaves rawSubmission untouched when no photos are submitted', async () => {
        insertedValues.length = 0;
        const { status } = await requestThrough(leadsRouter, 'POST', '/api/leads', {
            customerName: 'No Photos',
            phone: '07700900001',
            source: 'web_quote',
            stripePaymentId: 'pi_test_skip_side_effects',
        });

        expect(status).toBe(201);
        const inserted = insertedValues[0];
        expect(inserted.transcriptJson.rawSubmission.photos).toBeUndefined();
    });
});
