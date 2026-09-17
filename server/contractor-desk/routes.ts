/**
 * Contractor desk - the backend of Ben's Contractors page, reached from the Handy Desk.
 *
 * Mounted at /api/admin/contractor-desk behind requireAdmin (which also admits VAs). Read-only:
 *   GET /contractors      every contractor, partner then core then ad-hoc
 *   GET /contractors/:id  one contractor, with a little more profile
 *   GET /contractors/:id/jobs?view=upcoming|flex|past&weeksBack=1..52
 *                         the jobs booked to him (upcoming, or one past week) or his unplaced flex jobs
 * The first two answer with the explicit shapes in `roster.ts`: no login secret and no money field.
 * The jobs read answers with the shapes in `jobs.ts`, whose money fields are read-only.
 */
import { Router, type Request, type Response } from 'express';
import { ukToday, ukWeekStartDay } from '../../shared/uk-time';
import { shapeContractor, shapeContractorDetail, sortRoster } from './roster';
import { dbRosterSource, type RosterSource } from './source';
import { parseJobsQuery, shapeFlex, shapePast, shapeUpcoming, type JobsSource } from './jobs';
import { dbJobsSource } from './jobs-source';

export interface ContractorDeskClock {
  today(): string;
  weekStart(): string;
}

const ukClock: ContractorDeskClock = { today: ukToday, weekStart: () => ukWeekStartDay() };

export function createContractorDeskRouter(
  source: RosterSource = dbRosterSource,
  clock: ContractorDeskClock = ukClock,
  jobs: JobsSource = dbJobsSource,
): Router {
  const router = Router();

  const window = () => {
    const today = clock.today();
    const weekStart = clock.weekStart();
    return { today, weekStart, from: weekStart < today ? weekStart : today };
  };

  router.get('/contractors', async (_req: Request, res: Response) => {
    try {
      const { today, weekStart, from } = window();
      const data = await source.load(null, from);
      const ctx = { bookings: data.bookings, skills: data.skills, today, weekStart };
      res.json({ contractors: sortRoster(data.profiles.map((p) => shapeContractor(p, ctx))) });
    } catch (err) {
      console.error('[ContractorDesk] list failed:', err);
      res.status(500).json({ error: 'Failed to load contractors' });
    }
  });

  router.get('/contractors/:id', async (req: Request, res: Response) => {
    try {
      const { today, weekStart, from } = window();
      const data = await source.load([req.params.id], from);
      const profile = data.profiles.find((p) => p.id === req.params.id);
      if (!profile) return res.status(404).json({ error: 'Contractor not found' });
      const ctx = { bookings: data.bookings, skills: data.skills, today, weekStart };
      res.json({ contractor: shapeContractorDetail(profile, ctx) });
    } catch (err) {
      console.error('[ContractorDesk] detail failed:', err);
      res.status(500).json({ error: 'Failed to load contractor' });
    }
  });

  router.get('/contractors/:id/jobs', async (req: Request, res: Response) => {
    const query = parseJobsQuery(req.query);
    if (!query.ok) return res.status(400).json({ error: query.error });
    try {
      const profile = await jobs.profile(req.params.id);
      if (!profile) return res.status(404).json({ error: 'Contractor not found' });
      const head = { contractorId: profile.id, view: query.view, today: clock.today() };
      if (query.view === 'upcoming') return res.json({ ...head, jobs: shapeUpcoming(await jobs.upcoming(profile)) });
      if (query.view === 'flex') return res.json({ ...head, jobs: shapeFlex(await jobs.flex(profile)) });
      return res.json({ ...head, ...shapePast(await jobs.past(profile, query.weeksBack)) });
    } catch (err) {
      console.error('[ContractorDesk] jobs failed:', err);
      res.status(500).json({ error: 'Failed to load jobs' });
    }
  });

  return router;
}
