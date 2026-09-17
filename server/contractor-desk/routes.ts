/**
 * Contractor desk - the backend of Ben's Contractors page, reached from the Handy Desk.
 *
 * Mounted at /api/admin/contractor-desk behind requireAdmin (which also admits VAs).
 *   GET  /contractors                  every contractor, partner then core then ad-hoc
 *   GET  /contractors/:id              one contractor, with a little more profile
 *   POST /contractors                  add a contractor (activated, since an admin added them)
 *   POST /contractors/:id/activate     let a contractor in (self-signups start inactive)
 *   POST /contractors/:id/deactivate   take them out: no code login, no quote matching
 *   POST /contractors/:id/access-code  issue or reset the /partner/login code, shown once
 *   POST /contractors/:id/app-link     issue the field-app link (the existing one if there is one)
 * The reads and the add answer with the explicit shapes in `roster.ts`: no login secret and no
 * money field. No route here takes a password or a money field.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ukToday, ukWeekStartDay } from '../../shared/uk-time';
import { isValidUKPhone, normalizePhoneNumber } from '../phone-utils';
import { generateAccessCode, hashAccessCode, storedAccessCodeCandidates } from '../lib/contractor-access';
import { dbContractorDeskStore, type ContractorDeskStore } from './access-store';
import { shapeContractor, shapeContractorDetail, sortRoster } from './roster';
import { dbRosterSource, type RosterSource } from './source';

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

/**
 * The add form. Strict, so a password or a money field (hourlyRate, dayRate, rates on skills) is
 * refused by name rather than dropped silently.
 */
export const addContractorSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  phone: z.string().trim().min(1, 'Phone is required')
    .refine(isValidUKPhone, 'Phone must be a UK number'),
  vertical: z.enum(['handyman', 'cleaning']),
  deliveryTier: z.enum(['partner', 'core', 'adhoc']),
  deliveryPriority: z.number().int().min(1).max(999).optional().nullable(),
  email: z.string().trim().toLowerCase().email('Email is not valid').optional().nullable()
    .or(z.literal('').transform(() => null)),
  businessName: optionalText(200),
  postcode: optionalText(20),
  city: optionalText(100),
}).strict();

/** How many fresh codes to try before giving up on finding one nobody holds. */
const ACCESS_CODE_ATTEMPTS = 5;

export interface ContractorDeskClock {
  today(): string;
  weekStart(): string;
}

const ukClock: ContractorDeskClock = { today: ukToday, weekStart: () => ukWeekStartDay() };

const adminId = (req: Request): string | null => (req as any).user?.id ?? null;

export function createContractorDeskRouter(
  source: RosterSource = dbRosterSource,
  clock: ContractorDeskClock = ukClock,
  store: ContractorDeskStore = dbContractorDeskStore,
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

  const detail = async (id: string) => {
    const { today, weekStart, from } = window();
    const data = await source.load([id], from);
    const profile = data.profiles.find((p) => p.id === id);
    if (!profile) return null;
    return shapeContractorDetail(profile, { bookings: data.bookings, skills: data.skills, today, weekStart });
  };

  router.get('/contractors/:id', async (req: Request, res: Response) => {
    try {
      const contractor = await detail(req.params.id);
      if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
      res.json({ contractor });
    } catch (err) {
      console.error('[ContractorDesk] detail failed:', err);
      res.status(500).json({ error: 'Failed to load contractor' });
    }
  });

  router.post('/contractors', async (req: Request, res: Response) => {
    const parsed = addContractorSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const input = parsed.data;
    try {
      const phone = normalizePhoneNumber(input.phone)!;
      const email = input.email ?? null;
      const taken = await store.contactInUse(email, phone);
      if (taken.email) return res.status(409).json({ error: 'That email is already registered' });
      if (taken.phone) return res.status(409).json({ error: 'A contractor with that phone already exists' });

      const id = await store.create({
        firstName: input.firstName,
        lastName: input.lastName,
        phone,
        email,
        vertical: input.vertical,
        deliveryTier: input.deliveryTier,
        deliveryPriority: input.deliveryPriority ?? null,
        businessName: input.businessName,
        postcode: input.postcode,
        city: input.city,
        activatedBy: adminId(req),
      });
      const contractor = await detail(id);
      if (!contractor) throw new Error(`added contractor ${id} could not be read back`);
      res.status(201).json({ contractor });
    } catch (err) {
      console.error('[ContractorDesk] add failed:', err);
      res.status(500).json({ error: 'Failed to add contractor' });
    }
  });

  const setActivation = (activate: boolean) => async (req: Request, res: Response) => {
    try {
      const current = await store.find(req.params.id);
      if (!current) return res.status(404).json({ error: 'Contractor not found' });
      // Activating twice keeps the first activation; deactivating twice changes nothing.
      const already = activate ? current.activatedAt != null : current.activatedAt == null;
      if (!already) {
        const found = await store.setActivation(req.params.id, activate ? { at: new Date(), by: adminId(req) } : null);
        if (!found) return res.status(404).json({ error: 'Contractor not found' });
        console.log(`[ContractorDesk] contractor ${req.params.id} ${activate ? 'activated' : 'deactivated'} by ${adminId(req) ?? 'unknown'}`);
      }
      const contractor = await detail(req.params.id);
      if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
      res.json({ contractor });
    } catch (err) {
      console.error(`[ContractorDesk] ${activate ? 'activate' : 'deactivate'} failed:`, err);
      res.status(500).json({ error: `Failed to ${activate ? 'activate' : 'deactivate'} contractor` });
    }
  };
  router.post('/contractors/:id/activate', setActivation(true));
  router.post('/contractors/:id/deactivate', setActivation(false));

  router.post('/contractors/:id/access-code', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!(await store.find(id))) return res.status(404).json({ error: 'Contractor not found' });
      for (let attempt = 0; attempt < ACCESS_CODE_ATTEMPTS; attempt++) {
        const code = generateAccessCode();
        // Another contractor holding this code, hashed or from before hashing, means try again.
        if (await store.accessCodeInUse(storedAccessCodeCandidates(code), id)) continue;
        try {
          await store.setAccessCode(id, hashAccessCode(code));
        } catch (err) {
          if (isUniqueViolation(err)) continue; // issued to someone else a moment ago
          throw err;
        }
        console.log(`[ContractorDesk] access code issued for contractor ${id} by ${adminId(req) ?? 'unknown'}`);
        res.setHeader('Cache-Control', 'no-store');
        // The code is shown this once; only its hash is kept.
        return res.status(201).json({ contractorId: id, code, loginPath: '/partner/login' });
      }
      console.error(`[ContractorDesk] access code: no free code after ${ACCESS_CODE_ATTEMPTS} attempts for ${id}`);
      res.status(503).json({ error: 'Could not find a free code, try again' });
    } catch (err) {
      console.error('[ContractorDesk] access code failed:', err);
      res.status(500).json({ error: 'Failed to issue access code' });
    }
  });

  router.post('/contractors/:id/app-link', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!(await store.find(id))) return res.status(404).json({ error: 'Contractor not found' });
      const token = await store.ensureAppToken(id);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ contractorId: id, path: `/my-week/${token}` });
    } catch (err) {
      console.error('[ContractorDesk] app link failed:', err);
      res.status(500).json({ error: 'Failed to issue app link' });
    }
  });

  return router;
}

/** Postgres unique_violation, as the driver reports it (possibly wrapped by drizzle). */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
