/**
 * The diary's read routes, mounted at /api/comms-v2/diary by api/routes.ts, behind requireAdmin.
 * Both are reads; there is no write here.
 *
 * GET /diary/week?start=YYYY-MM-DD&weeks=1..6 - every contractor's lanes from the Monday on or
 *     before `start` (default: this week in London), the "Not jobs" row and the booked / open
 *     counts (week.ts diaryWeekOf). The page asks for one week, or the weeks a month spans.
 * GET /diary/today - the Today strip (week.ts diaryTodayOf) for today in London.
 *
 * A job chip names the case file for its job from the same store the board reads (api/store.ts), so
 * "Open thread" opens what the board would.
 */
import { Router } from 'express';
import type { CaseFile } from '../desk/case-file';
import { readDiaryRows, type ReadDiaryRows } from './reader';
import { ISO_DAY, MAX_WEEKS, addDays, diaryTodayOf, diaryWeekOf, londonToday, mondayOf } from './week';

export interface DiaryRouterDeps {
    rows?: ReadDiaryRows;
    /** The case files the board reads; throws when the live store cannot be opened. */
    files: () => Promise<CaseFile[]>;
    today?: () => string;
}

export function createDiaryRouter(deps: DiaryRouterDeps): Router {
    const router = Router();
    const rows = deps.rows ?? readDiaryRows;
    const today = deps.today ?? (() => londonToday());

    /** The case files, or none when the store cannot be opened: the diary still shows, without thread links. */
    const files = async (): Promise<CaseFile[]> => {
        try {
            return await deps.files();
        } catch (error: any) {
            console.error('[comms-v2/diary] case files unavailable, threads not linked:', error?.message ?? error);
            return [];
        }
    };

    router.get('/week', async (req, res) => {
        const startParam = typeof req.query.start === 'string' ? req.query.start : undefined;
        if (startParam !== undefined && (!ISO_DAY.test(startParam) || Number.isNaN(Date.parse(`${startParam}T00:00:00Z`)))) {
            res.status(400).json({ error: 'start must be a date, YYYY-MM-DD' });
            return;
        }
        const weeks = req.query.weeks === undefined ? 1 : Number(req.query.weeks);
        if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
            res.status(400).json({ error: `weeks must be a whole number from 1 to ${MAX_WEEKS}` });
            return;
        }
        const now = today();
        const start = mondayOf(startParam ?? now);
        try {
            const [r, f] = await Promise.all([rows({ from: start, to: addDays(start, weeks * 7 - 1) }), files()]);
            res.json(diaryWeekOf(r, f, { start, weeks, today: now }));
        } catch (error: any) {
            console.error('[comms-v2/diary] week read failed:', error?.message ?? error);
            res.status(500).json({ error: 'Could not read the diary' });
        }
    });

    router.get('/today', async (_req, res) => {
        const now = today();
        try {
            const [r, f] = await Promise.all([rows({ from: now, to: now }), files()]);
            res.json(diaryTodayOf(r, f, now));
        } catch (error: any) {
            console.error('[comms-v2/diary] today read failed:', error?.message ?? error);
            res.status(500).json({ error: 'Could not read today' });
        }
    });

    return router;
}
