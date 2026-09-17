/**
 * The diary routes over HTTP, as the page calls them: the week from its Monday, a month's weeks,
 * refusals for a bad range, the Today strip, and a diary that still shows (without thread links)
 * when the case file store cannot be opened.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseFile } from '../desk/case-file';
import type { ReadDiaryRows } from './reader';
import { createDiaryRouter } from './routes';
import type { DiaryRows } from './week';

const TODAY = '2026-09-22';

const ROWS: DiaryRows = {
    contractors: [{ id: 'hp_1', name: 'Craig Test', trades: [] }],
    patterns: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ contractorId: 'hp_1', dayOfWeek, startTime: '09:00', endTime: '18:00', isActive: true })),
    overrides: [],
    bookings: [{
        id: 'bk_1', contractorId: 'hp_1', quoteId: 'q_1', quoteSlug: 's1', customerName: 'Test Customer', description: 'tap',
        scheduledDate: TODAY, scheduledDates: null, durationDays: 1, scheduledSlot: 'am', scheduledStartTime: null,
        status: 'accepted', assignmentStatus: 'accepted', dayOfStatus: 'arrived',
    }],
    items: [],
};

const FILES = [{ id: 'case_1', openedAt: '2026-09-01T00:00:00.000Z', job: { type: null, location: null, quoteRef: 's1', bookingRef: null }, hold: null }] as unknown as CaseFile[];

let asked: { from: string; to: string }[] = [];
let filesFail = false;
let rowsFail = false;
let server: import('node:http').Server;
let base: string;

beforeAll(async () => {
    const rows: ReadDiaryRows = async (range) => {
        asked.push(range);
        if (rowsFail) throw new Error('database down');
        return ROWS;
    };
    const app = express();
    app.use('/diary', createDiaryRouter({
        rows,
        files: async () => { if (filesFail) throw new Error('store closed'); return FILES; },
        today: () => TODAY,
    }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/diary`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function get(route: string) {
    asked = [];
    const res = await fetch(`${base}${route}`);
    return { status: res.status, json: await res.json() as any };
}

describe('GET /diary/week', () => {
    it("reads this week from its Monday by default, with each job's case file", async () => {
        const r = await get('/week');
        expect(r.status).toBe(200);
        expect(asked).toEqual([{ from: '2026-09-21', to: '2026-09-27' }]);
        expect(r.json.start).toBe('2026-09-21');
        expect(r.json.today).toBe(TODAY);
        const tue = r.json.lanes[0].days[1];
        expect(tue.cells[0].jobs[0]).toMatchObject({ bookingId: 'bk_1', quoteId: 'q_1', caseFileId: 'case_1', onSite: 'on_site' });
    });

    it('reads the weeks a month spans', async () => {
        const r = await get('/week?start=2026-10-01&weeks=5');
        expect(r.status).toBe(200);
        expect(asked).toEqual([{ from: '2026-09-28', to: '2026-11-01' }]);
        expect(r.json.dates).toHaveLength(35);
    });

    it('refuses a bad start or week count without reading', async () => {
        for (const q of ['?start=next-week', '?start=2026-13-45', '?weeks=0', '?weeks=7', '?weeks=two']) {
            const r = await get(`/week${q}`);
            expect(r.status, q).toBe(400);
            expect(asked).toEqual([]);
        }
    });

    it('still shows the diary, without thread links, when the case file store cannot be opened', async () => {
        filesFail = true;
        try {
            const r = await get('/week');
            expect(r.status).toBe(200);
            expect(r.json.lanes[0].days[1].cells[0].jobs[0].caseFileId).toBeNull();
        } finally {
            filesFail = false;
        }
    });

    it('answers 500 when the diary cannot be read', async () => {
        rowsFail = true;
        try {
            const r = await get('/week');
            expect(r.status).toBe(500);
            expect(r.json.error).toBe('Could not read the diary');
        } finally {
            rowsFail = false;
        }
    });
});

describe('GET /diary/today', () => {
    it('reads today only and returns who is on today', async () => {
        const r = await get('/today');
        expect(r.status).toBe(200);
        expect(asked).toEqual([{ from: TODAY, to: TODAY }]);
        expect(r.json).toMatchObject({ date: TODAY, contractors: [{ name: 'Craig Test', offered: 'full', jobs: [{ customerName: 'Test Customer', slot: 'am', onSite: 'on_site', caseFileId: 'case_1' }] }] });
    });
});
