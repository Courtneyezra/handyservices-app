/**
 * Contractor app — tokenised, no-login availability harvesting (solo v1).
 *
 * Entry is an unguessable per-contractor link (`handyman_profiles.app_token`),
 * same trust model as dispatch links: the token IS the credential. Texts over
 * WhatsApp; zero-friction is the point — availability discipline dies at a
 * password prompt.
 *
 *   GET  /api/contractor-app/:token           → provider + resolved weeks + pattern
 *   POST /api/contractor-app/:token/day       → { date, mode } day override
 *   POST /api/contractor-app/:token/pattern   → { days:[{dayOfWeek, mode}] } usual week
 *
 * Writes land in the SAME tables the quote day-picker reads
 * (`contractor_availability_dates` + `handyman_availability`) and bump
 * `lastAvailabilityRefresh` (the staleness signal). Teams variant follows —
 * the payload carries `provider.type: 'solo'` so the client can fork later.
 * See docs/contractor-platform/04-contractor-app.md.
 */
import { Router, Request, Response } from 'express';
import { and, eq, gte, lt, or } from 'drizzle-orm';
import { startOfWeek, addDays, format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import {
  users,
  handymanProfiles,
  handymanAvailability,
  contractorAvailabilityDates,
  contractorBookingRequests,
} from '../shared/schema';
import { timeRangeCoversSlot, type SlotType } from '../shared/slot-times';
import { resolveWeek } from './lib/contractor-week';
import { modeToWindow, isDayMode, isIsoDate, isEditableDate, type DayMode } from './lib/contractor-app';

const BOOKED_STATUSES = new Set(['accepted', 'completed']);
const BOOKED_ASSIGNMENT = new Set(['accepted', 'in_progress', 'completed']);
const WEEKS_SERVED = 3;

const router = Router();

async function findByAppToken(token: string) {
  if (!token || token.length < 16) return null;
  const rows = await db
    .select({
      id: handymanProfiles.id,
      userId: handymanProfiles.userId,
      profileImageUrl: handymanProfiles.profileImageUrl,
      heroImageUrl: handymanProfiles.heroImageUrl,
      lastAvailabilityRefresh: handymanProfiles.lastAvailabilityRefresh,
    })
    .from(handymanProfiles)
    .where(eq(handymanProfiles.appToken, token))
    .limit(1);
  return rows[0] ?? null;
}

// GET /:token → who + resolved AM/PM grid for the next weeks + usual-week pattern.
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
    const end = addDays(monday, WEEKS_SERVED * 7);
    const weekDates = Array.from({ length: WEEKS_SERVED * 7 }, (_, i) => {
      const d = addDays(monday, i);
      return { date: format(d, 'yyyy-MM-dd'), dayOfWeek: d.getDay() };
    });

    const [userRows, patternRows, overrideRows, bookingRows] = await Promise.all([
      db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, profile.userId)).limit(1),
      db.select({ dayOfWeek: handymanAvailability.dayOfWeek, startTime: handymanAvailability.startTime, endTime: handymanAvailability.endTime, isActive: handymanAvailability.isActive })
        .from(handymanAvailability).where(eq(handymanAvailability.handymanId, profile.id)),
      db.select({ date: contractorAvailabilityDates.date, isAvailable: contractorAvailabilityDates.isAvailable, startTime: contractorAvailabilityDates.startTime, endTime: contractorAvailabilityDates.endTime })
        .from(contractorAvailabilityDates).where(and(eq(contractorAvailabilityDates.contractorId, profile.id), gte(contractorAvailabilityDates.date, monday), lt(contractorAvailabilityDates.date, end))),
      db.select({ contractorId: contractorBookingRequests.contractorId, assignedContractorId: contractorBookingRequests.assignedContractorId, scheduledDate: contractorBookingRequests.scheduledDate, slot: contractorBookingRequests.scheduledSlot, status: contractorBookingRequests.status, assignmentStatus: contractorBookingRequests.assignmentStatus })
        .from(contractorBookingRequests).where(and(gte(contractorBookingRequests.scheduledDate, monday), lt(contractorBookingRequests.scheduledDate, end), or(eq(contractorBookingRequests.contractorId, profile.id), eq(contractorBookingRequests.assignedContractorId, profile.id)))),
    ]);

    const weeklyPatterns = patternRows.map((p) => ({ dayOfWeek: p.dayOfWeek ?? 0, startTime: p.startTime ?? null, endTime: p.endTime ?? null, isActive: !!p.isActive }));
    const overrides = overrideRows.map((o) => ({ date: format(new Date(o.date as any), 'yyyy-MM-dd'), isAvailable: !!o.isAvailable, startTime: o.startTime ?? null, endTime: o.endTime ?? null }));
    const bookings = bookingRows
      .filter((b) => ((b.status && BOOKED_STATUSES.has(b.status)) || (b.assignmentStatus && BOOKED_ASSIGNMENT.has(b.assignmentStatus))) && b.scheduledDate && (b.assignedContractorId ?? b.contractorId) === profile.id)
      .map((b) => ({ date: format(new Date(b.scheduledDate as any), 'yyyy-MM-dd'), slot: (b.slot ?? null) as SlotType | null }));

    const pattern = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
      const active = weeklyPatterns.filter((p) => p.dayOfWeek === dow && p.isActive);
      return {
        dayOfWeek: dow,
        am: active.some((p) => timeRangeCoversSlot(p.startTime, p.endTime, 'am')),
        pm: active.some((p) => timeRangeCoversSlot(p.startTime, p.endTime, 'pm')),
      };
    });

    const u = userRows[0];
    res.json({
      provider: {
        type: 'solo' as const,
        firstName: u?.firstName ?? 'there',
        name: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Contractor',
        imageUrl: profile.profileImageUrl ?? profile.heroImageUrl ?? null,
        lastAvailabilityRefresh: profile.lastAvailabilityRefresh,
      },
      today: format(new Date(), 'yyyy-MM-dd'),
      weekStart: format(monday, 'yyyy-MM-dd'),
      days: resolveWeek({ weekDates, weeklyPatterns, overrides, bookings }),
      pattern,
    });
  } catch (err: any) {
    console.error('[ContractorApp] load failed:', err?.message);
    res.status(500).json({ error: 'Failed to load your week' });
  }
});

// POST /:token/day { date: 'YYYY-MM-DD', mode: am|pm|full|off } → day override.
router.post('/:token/day', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const { date, mode } = req.body || {};
    if (!isIsoDate(date) || !isDayMode(mode)) return res.status(400).json({ error: 'date (YYYY-MM-DD) and mode (am|pm|full|off) required' });
    if (!isEditableDate(date, format(new Date(), 'yyyy-MM-dd'))) return res.status(400).json({ error: 'That day is in the past' });

    const window = modeToWindow(mode as DayMode);
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    await db.transaction(async (tx) => {
      // One override row per calendar day (same semantics as Ben's mobile tool).
      await tx.delete(contractorAvailabilityDates).where(and(
        eq(contractorAvailabilityDates.contractorId, profile.id),
        gte(contractorAvailabilityDates.date, dayStart),
        lt(contractorAvailabilityDates.date, dayEnd),
      ));
      await tx.insert(contractorAvailabilityDates).values({
        id: uuidv4(),
        contractorId: profile.id,
        date: dayStart,
        isAvailable: window.isAvailable,
        startTime: window.startTime,
        endTime: window.endTime,
        notes: 'contractor-app',
      });
      await tx.update(handymanProfiles).set({ lastAvailabilityRefresh: new Date(), updatedAt: new Date() }).where(eq(handymanProfiles.id, profile.id));
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[ContractorApp] day write failed:', err?.message);
    res.status(500).json({ error: 'Could not save that day' });
  }
});

// POST /:token/pattern { days: [{dayOfWeek, mode}] } → the usual week.
router.post('/:token/pattern', async (req: Request, res: Response) => {
  try {
    const profile = await findByAppToken(req.params.token);
    if (!profile) return res.status(404).json({ error: 'Link not recognised' });

    const days = req.body?.days;
    if (!Array.isArray(days) || days.some((d: any) => typeof d?.dayOfWeek !== 'number' || d.dayOfWeek < 0 || d.dayOfWeek > 6 || !isDayMode(d?.mode))) {
      return res.status(400).json({ error: 'days: [{dayOfWeek 0-6, mode am|pm|full|off}] required' });
    }

    await db.transaction(async (tx) => {
      for (const d of days as Array<{ dayOfWeek: number; mode: DayMode }>) {
        const window = modeToWindow(d.mode);
        const existing = await tx.select({ id: handymanAvailability.id }).from(handymanAvailability)
          .where(and(eq(handymanAvailability.handymanId, profile.id), eq(handymanAvailability.dayOfWeek, d.dayOfWeek))).limit(1);
        if (d.mode === 'off') {
          if (existing.length) {
            await tx.update(handymanAvailability).set({ isActive: false }).where(eq(handymanAvailability.id, existing[0].id));
          }
        } else if (existing.length) {
          await tx.update(handymanAvailability).set({ startTime: window.startTime, endTime: window.endTime, isActive: true }).where(eq(handymanAvailability.id, existing[0].id));
        } else {
          await tx.insert(handymanAvailability).values({ id: uuidv4(), handymanId: profile.id, dayOfWeek: d.dayOfWeek, startTime: window.startTime, endTime: window.endTime, isActive: true });
        }
      }
      await tx.update(handymanProfiles).set({ lastAvailabilityRefresh: new Date(), updatedAt: new Date() }).where(eq(handymanProfiles.id, profile.id));
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[ContractorApp] pattern write failed:', err?.message);
    res.status(500).json({ error: 'Could not save your usual week' });
  }
});

export default router;
