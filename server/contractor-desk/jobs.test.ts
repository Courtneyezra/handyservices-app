/**
 * The contractor desk jobs read with a stand-in source: which load each view asks for, and what a
 * failed load answers. The database path is covered in `server/contractor-jobs.test.ts`.
 */
import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createContractorDeskRouter } from './routes';
import type { JobsSource } from './jobs';
import type { RosterSource } from './source';

const roster: RosterSource = { load: async () => ({ profiles: [], bookings: [], skills: [] }) };
const clock = { today: () => '2026-09-17', weekStart: () => '2026-09-14' };
const week = { weeksBack: 3, weekStart: '2026-08-31', weekEnd: '2026-09-06', label: 'Week of 31 Aug', earnedPence: 0, jobs: [], hasMore: true };

const jobs = {
  profile: vi.fn(async (id: string) => (id === 'c1' ? { id: 'c1', deliveryTier: 'partner' } : null)),
  upcoming: vi.fn(async () => ({ jobs: [], bookings: [] })),
  flex: vi.fn(async () => ({ jobs: [], quotes: [] })),
  past: vi.fn(async () => ({ week, bookings: [] })),
} satisfies JobsSource;

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use('/desk', createContractorDeskRouter(roster, clock, jobs));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: await res.json() };
}

describe('GET /contractors/:id/jobs with a stand-in source', () => {
  it('reads one past week at the tier on his profile', async () => {
    const res = await get('/desk/contractors/c1/jobs?view=past&weeksBack=3');
    expect(res).toEqual({
      status: 200,
      json: { contractorId: 'c1', view: 'past', today: '2026-09-17', weeksBack: 3, weekStart: '2026-08-31', weekEnd: '2026-09-06', label: 'Week of 31 Aug', earnedPence: 0, jobs: [] },
    });
    expect(jobs.past).toHaveBeenCalledWith({ id: 'c1', deliveryTier: 'partner' }, 3);
  });

  it('does not load jobs for a request it refuses', async () => {
    jobs.profile.mockClear();
    expect((await get('/desk/contractors/c1/jobs?view=diary')).status).toBe(400);
    expect(jobs.profile).not.toHaveBeenCalled();
  });

  it('answers 500 when a load fails', async () => {
    jobs.flex.mockRejectedValueOnce(new Error('connection reset'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await get('/desk/contractors/c1/jobs?view=flex')).toEqual({ status: 500, json: { error: 'Failed to load jobs' } });
    spy.mockRestore();
  });
});
