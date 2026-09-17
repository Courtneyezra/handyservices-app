/**
 * The diary's rows, read from the database in use (server/db.ts), the same tables Ben's
 * availability matrix reads (server/availability-routes.ts): contractor profiles and their skills,
 * weekly patterns, date overrides, booking rows and diary items. Selects only what week.ts shows -
 * no customer phone, email or address - and writes nothing: unlike the matrix it geocodes nothing
 * and backfills nothing.
 */
import type { DiaryRows } from './week';
import { SPAN_LOOKBACK_DAYS, addDays } from './week';

export type ReadDiaryRows = (range: { from: string; to: string }) => Promise<DiaryRows>;

const dayOf = (v: Date | string | null): string | null => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

export const readDiaryRows: ReadDiaryRows = async ({ from, to }) => {
    const { db } = await import('../../db');
    const s = await import('../../../shared/schema');
    const { and, eq, gte, inArray, lt, or } = await import('drizzle-orm');
    const { getTradeForCategory } = await import('../../../shared/categories');
    const end = utc(addDays(to, 1));

    const profiles = await db.query.handymanProfiles.findMany({
        columns: { id: true, businessName: true },
        with: { user: { columns: { firstName: true, lastName: true } }, skills: { columns: { categorySlug: true } } },
    });
    const ids = profiles.map((p) => p.id);
    if (!ids.length) return { contractors: [], patterns: [], overrides: [], bookings: [], items: [] };

    const b = s.contractorBookingRequests;
    const [patterns, overrides, bookings, items] = await Promise.all([
        db.select({ contractorId: s.handymanAvailability.handymanId, dayOfWeek: s.handymanAvailability.dayOfWeek, startTime: s.handymanAvailability.startTime, endTime: s.handymanAvailability.endTime, isActive: s.handymanAvailability.isActive })
            .from(s.handymanAvailability).where(inArray(s.handymanAvailability.handymanId, ids)),
        db.select({ contractorId: s.contractorAvailabilityDates.contractorId, date: s.contractorAvailabilityDates.date, isAvailable: s.contractorAvailabilityDates.isAvailable, startTime: s.contractorAvailabilityDates.startTime, endTime: s.contractorAvailabilityDates.endTime })
            .from(s.contractorAvailabilityDates)
            .where(and(inArray(s.contractorAvailabilityDates.contractorId, ids), gte(s.contractorAvailabilityDates.date, utc(from)), lt(s.contractorAvailabilityDates.date, end))),
        db.select({ id: b.id, contractorId: b.contractorId, assignedContractorId: b.assignedContractorId, quoteId: b.quoteId, quoteSlug: s.personalizedQuotes.shortSlug, customerName: b.customerName, description: b.description, scheduledDate: b.scheduledDate, scheduledDates: b.scheduledDates, durationDays: b.durationDays, scheduledSlot: b.scheduledSlot, scheduledStartTime: b.scheduledStartTime, status: b.status, assignmentStatus: b.assignmentStatus, dayOfStatus: b.dayOfStatus })
            .from(b)
            .leftJoin(s.personalizedQuotes, eq(s.personalizedQuotes.id, b.quoteId))
            // A multi-day span is one row on its first day, so the read reaches back for spans still running.
            .where(and(or(inArray(b.assignedContractorId, ids), inArray(b.contractorId, ids)), gte(b.scheduledDate, utc(addDays(from, -SPAN_LOOKBACK_DAYS))), lt(b.scheduledDate, end))),
        db.select({ id: s.contractorDiaryItems.id, contractorId: s.contractorDiaryItems.contractorId, date: s.contractorDiaryItems.date, slot: s.contractorDiaryItems.slot, startTime: s.contractorDiaryItems.startTime, kind: s.contractorDiaryItems.kind, customerName: s.contractorDiaryItems.customerName, status: s.contractorDiaryItems.status })
            .from(s.contractorDiaryItems)
            .where(and(gte(s.contractorDiaryItems.date, utc(from)), lt(s.contractorDiaryItems.date, end))),
    ]);

    return {
        contractors: profiles.map((p) => ({
            id: p.id,
            name: [p.user?.firstName, p.user?.lastName].filter(Boolean).join(' ').trim() || p.businessName || 'Unnamed contractor',
            trades: Array.from(new Set((p.skills ?? []).map((k) => (k.categorySlug ? getTradeForCategory(k.categorySlug as any) : null)).filter((t): t is NonNullable<typeof t> => !!t))),
        })),
        patterns: patterns.filter((p) => p.dayOfWeek != null).map((p) => ({ contractorId: p.contractorId, dayOfWeek: p.dayOfWeek as number, startTime: p.startTime, endTime: p.endTime, isActive: !!p.isActive })),
        overrides: overrides.map((o) => ({ contractorId: o.contractorId, date: dayOf(o.date)!, isAvailable: !!o.isAvailable, startTime: o.startTime, endTime: o.endTime })),
        bookings: bookings.map((r) => ({
            id: r.id, contractorId: r.assignedContractorId ?? r.contractorId, quoteId: r.quoteId, quoteSlug: r.quoteSlug ?? null,
            customerName: r.customerName, description: r.description, scheduledDate: dayOf(r.scheduledDate), scheduledDates: r.scheduledDates,
            durationDays: r.durationDays, scheduledSlot: r.scheduledSlot, scheduledStartTime: r.scheduledStartTime,
            status: r.status, assignmentStatus: r.assignmentStatus, dayOfStatus: r.dayOfStatus,
        })),
        items: items.map((i) => ({ id: i.id, contractorId: i.contractorId, date: dayOf(i.date)!, slot: i.slot, startTime: i.startTime, kind: i.kind, customerName: i.customerName, status: i.status })),
    };
};
