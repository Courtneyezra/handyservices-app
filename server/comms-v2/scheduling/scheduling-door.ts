/**
 * The scheduling side of the desk's sandbox door (Goal 5), mounted under /scheduling by
 * desk/sandbox-door.ts. Two calls, both about the fixture (fixture.ts):
 *
 *   POST /scheduling/fixture        { completed: N, quote: true, booked: true, diary: 'diary' | 'none', link: false }
 *                                   seeds N completed bookings, a sent quote and one booked job on the
 *                                   sandbox number; links the current sandbox thread to them (quote
 *                                   reference, booking reference) and walks its stage to quoted or
 *                                   booked, unless `link: false`, which seeds the rows alone so the
 *                                   booking is found by the customer's phone. `diary: 'none'` empties the
 *                                   completed bookings the door's diary reads (fixture.ts FixtureDiary),
 *                                   so the "dates come with your quote" path is drivable live;
 *                                   `diary: 'diary'` (the default) reads them again.
 *   POST /scheduling/fixture/reset  deletes every row the fixture wrote and reads the completed bookings again.
 *
 * Both posts answer with what they seeded and `diary`, whether the completed bookings are read or
 * emptied, which is everything the drives need.
 *
 * `withScheduling` gives the door its scheduling deps: the live diary and fixture on the branch
 * database, or whatever the caller passed (a memory diary in tests), the diary behind the one
 * FixtureDiary the door and the desk share.
 */
import { Router } from 'express';
import { setStage, STAGES, type CaseFile } from '../desk/case-file';
import type { Gateway } from '../desk/gateway';
import { liveDiary, MemoryDiary } from './diary';
import { FixtureDiary, liveFixture, MemoryFixture, validateFixtureInput, type FixtureResult, type FixtureWriter } from './fixture';
import type { SchedulingDeps } from './scheduling-tools';

export interface SchedulingDoorDeps extends SchedulingDeps {
    diary: FixtureDiary;
    fixture: FixtureWriter;
}

/** The door's scheduling deps: whatever the caller passed (memoryScheduling in tests), else the branch database. */
export function withScheduling<T extends { scheduling?: SchedulingDeps; now?: () => Date }>(deps: T): T & { scheduling: SchedulingDoorDeps } {
    // Whatever the caller passed wins, whichever half of it they passed, so a diary handed in is never
    // quietly swapped for the branch one. A memory diary can therefore sit beside the live writer, which
    // is safe: every write it makes refuses unless COMMS_V2_DATABASE_URL names the database actually open.
    const given = deps.scheduling ?? {};
    return { ...deps, scheduling: { fixture: liveFixture, ...given, diary: FixtureDiary.over(given.diary ?? liveDiary) } };
}

/**
 * A memory diary and fixture for tests, in one call. A quote store may stand beside it, and then
 * the diary answers for the quotes in it too: live there is one quotes table, so a quote Quoting
 * drafted is one this diary reads back, by its short slug as much as by its id.
 */
export function memoryScheduling(now?: () => Date, quotes?: { read(ref: string): Promise<unknown> }): SchedulingDoorDeps & { diary: FixtureDiary<MemoryDiary> } {
    const diary = new MemoryDiary();
    if (quotes) {
        diary.quoteFallback = async (ref) => {
            const row = (await quotes.read(ref)) as Record<string, any> | null;
            return row ? { id: String(row.id), slug: String(row.shortSlug), isDraft: row.isDraft !== false, supersededAt: row.supersededAt ?? null, revokedAt: row.revokedAt ?? null, expiresAt: row.expiresAt ?? null } : null;
        };
    }
    return { diary: new FixtureDiary(diary), fixture: new MemoryFixture(diary), now };
}

/** Whether the current sandbox thread can take the fixture's quote. Asked before anything is written, so a refusal leaves no rows behind. */
export function linkReady(file: CaseFile | null, wantsQuote: boolean): { ok: true } | { ok: false; reason: string } {
    if (!wantsQuote) return { ok: true };
    if (!file) return { ok: false, reason: 'no sandbox thread to link the quote to: start one, then seed again' };
    if (!(file.job.type && file.job.location)) return { ok: false, reason: 'the sandbox thread is not ready (job type and location); seed both on /start before the fixture' };
    if (file.stage === 'first_contact') return { ok: false, reason: 'the sandbox thread has not had its first turn routed yet' };
    return { ok: true };
}

/** Links the current sandbox thread to the seeded quote and booking and walks its stage there. Refuses a file that is not ready. */
export function linkFixture(file: CaseFile, seeded: FixtureResult, deps: { now?: () => Date } = {}): { ok: true; stage: CaseFile['stage'] } | { ok: false; reason: string } {
    const ready = linkReady(file, !!seeded.quoteRef);
    if (!ready.ok) return ready;
    if (!seeded.quoteRef) return { ok: true, stage: file.stage };
    file.job.quoteRef = seeded.quoteSlug ?? seeded.quoteRef;
    const bookingRef = seeded.bookingRef ?? file.job.bookingRef ?? null;
    file.job.bookingRef = bookingRef;
    const target: CaseFile['stage'] = bookingRef ? 'booked' : 'quoted';
    if (STAGES.indexOf(file.stage) >= STAGES.indexOf(target)) return { ok: true, stage: file.stage };
    const path: CaseFile['stage'][] = ['ready', 'quoted', 'accepted', 'booked'];
    for (const stage of path) {
        if (STAGES.indexOf(stage) <= STAGES.indexOf(file.stage)) continue;
        const moved = setStage(file, stage, `scheduling fixture: ${stage === 'ready' ? 'job type and location on the file' : stage === 'quoted' ? `quote ${seeded.quoteRef} sent` : stage === 'accepted' ? 'the quote was accepted on the picker' : `booked as ${bookingRef}`}`, deps);
        if (!moved.ok) return { ok: false, reason: moved.reason };
        if (stage === target) break;
    }
    return { ok: true, stage: file.stage };
}

export function schedulingDoor(deps: SchedulingDoorDeps): Router {
    const now = deps.now ?? (() => new Date());
    const router = Router();

    const currentFile = (req: any): CaseFile | null => {
        const gateway = req.v2Gateway as Gateway | undefined;
        if (!gateway) return null;
        const open = gateway.store.all().filter((f) => f.stage !== 'done');
        open.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
        return open[0] ?? null;
    };

    const stateOf = () => ({ diary: deps.diary.emptied ? 'none' : 'diary' });

    router.post('/fixture', async (req, res) => {
        try {
            const v = validateFixtureInput(req.body);
            if (!v.ok) { res.status(400).json({ error: v.error }); return; }
            const diary = req.body?.diary;
            if (diary !== undefined && diary !== 'diary' && diary !== 'none') { res.status(400).json({ error: 'diary must be "diary" (read its completed bookings) or "none" (read them as empty)' }); return; }
            const link = req.body?.link;
            if (link !== undefined && typeof link !== 'boolean') { res.status(400).json({ error: 'link must be true (link the current thread) or false (seed only)' }); return; }
            // `link: false` seeds the rows on the drama number and leaves the thread naming nothing, so the
            // specialist has to find the booking by the customer's own phone, as it would on a real thread.
            const file = link === false ? null : currentFile(req);
            const ready = link === false ? { ok: true as const } : linkReady(file, v.input.quote);
            if (!ready.ok) { res.status(409).json({ error: ready.reason, ...stateOf() }); return; }
            const seeded = await deps.fixture.seed(v.input, now());
            deps.diary.emptied = diary === 'none';
            const linked = file ? linkFixture(file, seeded, { now }) : null;
            if (linked && !linked.ok) { res.status(409).json({ error: linked.reason, seeded, ...stateOf() }); return; }
            res.json({ ok: true, seeded, linked: linked ? { caseId: file!.id, stage: linked.stage, quoteRef: file!.job.quoteRef, bookingRef: file!.job.bookingRef } : null, ...stateOf() });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'scheduling fixture failed' });
        }
    });

    router.post('/fixture/reset', async (_req, res) => {
        try {
            const deleted = await deps.fixture.reset();
            deps.diary.emptied = false;
            res.json({ ok: true, deleted, ...stateOf() });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'scheduling fixture reset failed' });
        }
    });

    return router;
}
