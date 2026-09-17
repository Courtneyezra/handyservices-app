/**
 * Contractor desk - the backend of Ben's Contractors page, reached from the Handy Desk.
 *
 * Mounted at /api/admin/contractor-desk behind requireAdmin (which also admits VAs).
 *   GET /contractors      every contractor, partner then core then ad-hoc
 *   GET /contractors/:id  one contractor, with a little more profile
 * Both answer with the explicit shapes in `roster.ts`: no login secret and no money field.
 *
 * Skills, a tick list plus proficiency (`skills.ts`); no per-skill rate is read or written:
 *   GET    /categories                       the fixed category list, { slug, label, trade }
 *   GET    /contractors/:id/skills           the contractor's ticked categories
 *   PUT    /contractors/:id/skills/:slug     { proficiency: 'basic' | 'competent' | 'expert' }, ticks or re-grades
 *   DELETE /contractors/:id/skills/:slug     unticks
 * An unknown slug or proficiency is a 400 and an unknown contractor a 404, before any write.
 */
import { Router, type Request, type Response } from 'express';
import { ukToday, ukWeekStartDay } from '../../shared/uk-time';
import { shapeContractor, shapeContractorDetail, sortRoster } from './roster';
import { dbRosterSource, type RosterSource } from './source';
import { dbSkillStore, deskCategories, isCategorySlug, isProficiency, shapeSkills, type SkillStore } from './skills';

export interface ContractorDeskClock {
  today(): string;
  weekStart(): string;
}

const ukClock: ContractorDeskClock = { today: ukToday, weekStart: () => ukWeekStartDay() };

export function createContractorDeskRouter(
  source: RosterSource = dbRosterSource,
  clock: ContractorDeskClock = ukClock,
  skills: SkillStore = dbSkillStore,
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

  router.get('/categories', (_req: Request, res: Response) => {
    res.json({ categories: deskCategories() });
  });

  router.get('/contractors/:id/skills', async (req: Request, res: Response) => {
    try {
      if (!(await skills.contractorExists(req.params.id))) return res.status(404).json({ error: 'Contractor not found' });
      res.json({ skills: shapeSkills(await skills.list(req.params.id)) });
    } catch (err) {
      console.error('[ContractorDesk] skills read failed:', err);
      res.status(500).json({ error: 'Failed to load skills' });
    }
  });

  router.put('/contractors/:id/skills/:slug', async (req: Request, res: Response) => {
    const { slug } = req.params;
    const proficiency = req.body?.proficiency;
    if (!isCategorySlug(slug)) return res.status(400).json({ error: 'Unknown category' });
    if (!isProficiency(proficiency)) return res.status(400).json({ error: 'proficiency must be basic, competent or expert' });
    try {
      if (!(await skills.contractorExists(req.params.id))) return res.status(404).json({ error: 'Contractor not found' });
      const { created } = await skills.upsert(req.params.id, slug, proficiency);
      const [skill] = shapeSkills([{ categorySlug: slug, proficiency }]);
      res.status(created ? 201 : 200).json({ skill, created });
    } catch (err) {
      console.error('[ContractorDesk] skill write failed:', err);
      res.status(500).json({ error: 'Failed to save skill' });
    }
  });

  router.delete('/contractors/:id/skills/:slug', async (req: Request, res: Response) => {
    const { slug } = req.params;
    if (!isCategorySlug(slug)) return res.status(400).json({ error: 'Unknown category' });
    try {
      if (!(await skills.contractorExists(req.params.id))) return res.status(404).json({ error: 'Contractor not found' });
      const { removed } = await skills.remove(req.params.id, slug);
      res.json({ removed });
    } catch (err) {
      console.error('[ContractorDesk] skill remove failed:', err);
      res.status(500).json({ error: 'Failed to remove skill' });
    }
  });

  return router;
}
