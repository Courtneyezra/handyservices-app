/**
 * Availability Slots API
 *
 * Backend for managing availability slots for the Live Call HUD.
 * Allows admins to create slots and book them for leads.
 */

import { Router, Request, Response } from 'express';
import { db } from './db';
import { availabilitySlots, leads } from '../shared/schema';
import { eq, and, gte, lte, asc, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * GET /api/availability
 * List available slots within a date range
 *
 * Query params:
 * - startDate: YYYY-MM-DD (required)
 * - endDate: YYYY-MM-DD (required)
 * - includeBooked: boolean (optional, default false)
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, includeBooked } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate are required' });
        }

        // Validate date format
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }

        // Build query conditions
        const conditions = [
            gte(availabilitySlots.date, startDate as string),
            lte(availabilitySlots.date, endDate as string),
        ];

        // By default, only return unbooked slots
        if (includeBooked !== 'true') {
            conditions.push(eq(availabilitySlots.isBooked, false));
        }

        const slots = await db.select({
            id: availabilitySlots.id,
            date: availabilitySlots.date,
            startTime: availabilitySlots.startTime,
            endTime: availabilitySlots.endTime,
            slotType: availabilitySlots.slotType,
            isBooked: availabilitySlots.isBooked,
            bookedByLeadId: availabilitySlots.bookedByLeadId,
            createdAt: availabilitySlots.createdAt,
            updatedAt: availabilitySlots.updatedAt,
        })
            .from(availabilitySlots)
            .where(and(...conditions))
            .orderBy(asc(availabilitySlots.date), asc(availabilitySlots.startTime));

        res.json(slots);
    } catch (error) {
        console.error('[Availability] Failed to fetch slots:', error);
        res.status(500).json({ error: 'Failed to fetch availability slots' });
    }
});

/**
 * GET /api/availability/scarcity
 * Returns slot counts for scarcity banners on quote pages.
 * Segment-aware: returns the slot types most relevant to each segment.
 *
 * Query params:
 * - segment: string (optional, e.g. BUSY_PRO, LANDLORD)
 */
router.get('/scarcity', async (req: Request, res: Response) => {
    try {
        const segment = (req.query.segment as string) || 'UNKNOWN';

        // Use date-only strings to avoid timezone drift on UTC servers
        const now = new Date();
        const today = now.toISOString().split('T')[0]; // "YYYY-MM-DD"

        // End of this week (Saturday)
        const dayOfWeek = now.getDay();
        const daysUntilSaturday = dayOfWeek === 0 ? 6 : 6 - dayOfWeek;
        const endOfWeek = new Date(now);
        endOfWeek.setDate(now.getDate() + daysUntilSaturday);
        const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

        // End of month for after-hours (SMALL_BIZ)
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const endOfMonthStr = endOfMonth.toISOString().split('T')[0];

        // Use raw SQL for date comparisons — Drizzle string-to-DATE casting can be unreliable
        const weekSlots = await db.execute(sql`
            SELECT date::text as date, slot_type as "slotType", start_time as "startTime"
            FROM availability_slots
            WHERE date >= ${today}::date
              AND date <= ${endOfWeekStr}::date
              AND is_booked = false
            ORDER BY date ASC
        `);

        const rows = weekSlots.rows as Array<{ date: string; slotType: string; startTime: string }>;

        const morningSlots = rows.filter(s => s.slotType === 'morning').length;
        const afternoonSlots = rows.filter(s => s.slotType === 'afternoon').length;
        const totalWeekSlots = rows.length;
        const nextAvailableDate = rows.length > 0 ? rows[0].date : null;

        // Minimum floors per segment — never show 0, that kills urgency
        const SEGMENT_MINIMUMS: Record<string, number> = {
            BUSY_PRO: 2,
            PROP_MGR: 2,
            LANDLORD: 3,
            SMALL_BIZ: 2,
            DIY_DEFERRER: 3,
            BUDGET: 3,
        };
        const minFloor = SEGMENT_MINIMUMS[segment] || 2;

        const scarcityData: Record<string, any> = {
            segment,
            totalSlotsThisWeek: Math.max(totalWeekSlots, minFloor),
            morningSlots: Math.max(morningSlots, 1),
            afternoonSlots: Math.max(afternoonSlots, 1),
            nextAvailableDate,
        };

        // Helper: days between today and a slot date (both as "YYYY-MM-DD" strings)
        const daysBetween = (dateStr: string): number => {
            const slot = new Date(dateStr + 'T00:00:00Z');
            const todayDate = new Date(today + 'T00:00:00Z');
            return Math.round((slot.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
        };

        switch (segment) {
            case 'BUSY_PRO': {
                const expressDays = rows.filter(s => daysBetween(s.date) <= 3);
                scarcityData.expressSlots = Math.max(expressDays.length, minFloor);
                scarcityData.focusMetric = 'expressSlots';
                break;
            }
            case 'PROP_MGR':
                scarcityData.focusMetric = 'morningSlots';
                break;

            case 'LANDLORD':
                scarcityData.focusMetric = 'totalSlotsThisWeek';
                break;

            case 'SMALL_BIZ': {
                const monthRows = await db.execute(sql`
                    SELECT date::text as date, slot_type as "slotType", start_time as "startTime"
                    FROM availability_slots
                    WHERE date >= ${today}::date
                      AND date <= ${endOfMonthStr}::date
                      AND is_booked = false
                `);
                const mRows = monthRows.rows as Array<{ date: string; slotType: string; startTime: string }>;
                const afterHoursSlots = mRows.filter(s =>
                    s.startTime && s.startTime >= '17:00'
                ).length;
                scarcityData.afterHoursSlots = Math.max(afterHoursSlots, minFloor);
                scarcityData.focusMetric = 'afterHoursSlots';
                break;
            }
            case 'DIY_DEFERRER': {
                const month = now.getMonth();
                scarcityData.isBusySeason = month >= 2 && month <= 8;
                scarcityData.focusMetric = 'totalSlotsThisWeek';
                break;
            }
            case 'BUDGET': {
                const standardSlots = rows.filter(s => daysBetween(s.date) > 3);
                scarcityData.standardSlots = Math.max(standardSlots.length, minFloor);
                scarcityData.focusMetric = 'standardSlots';
                break;
            }
            default:
                scarcityData.focusMetric = 'totalSlotsThisWeek';
        }

        console.log(`[Scarcity] ${segment}: ${JSON.stringify(scarcityData)}`);
        res.json(scarcityData);
    } catch (error) {
        console.error('[Availability] Scarcity check failed:', error);
        // Graceful fallback — don't break the quote page
        res.json({
            totalSlotsThisWeek: 3,
            morningSlots: 1,
            afternoonSlots: 2,
            nextAvailableDate: null,
            focusMetric: 'totalSlotsThisWeek',
        });
    }
});

/**
 * POST /api/availability
 * Create a new availability slot (admin only)
 *
 * Body:
 * - date: YYYY-MM-DD (required)
 * - startTime: HH:mm (required)
 * - endTime: HH:mm (required)
 * - slotType: 'morning' | 'afternoon' | 'full_day' (required)
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const { date, startTime, endTime, slotType } = req.body;

        // Validation
        if (!date || !startTime || !endTime || !slotType) {
            return res.status(400).json({
                error: 'date, startTime, endTime, and slotType are required'
            });
        }

        // Validate slotType
        const validSlotTypes = ['morning', 'afternoon', 'full_day'];
        if (!validSlotTypes.includes(slotType)) {
            return res.status(400).json({
                error: `Invalid slotType. Must be one of: ${validSlotTypes.join(', ')}`
            });
        }

        // Validate time format (HH:mm)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
            return res.status(400).json({ error: 'Invalid time format. Use HH:mm' });
        }

        // Validate date format
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }

        const newSlot = {
            id: uuidv4(),
            date,
            startTime,
            endTime,
            slotType,
            isBooked: false,
            bookedByLeadId: null,
        };

        const [inserted] = await db.insert(availabilitySlots)
            .values(newSlot)
            .returning();

        console.log(`[Availability] Created slot: ${inserted.id} on ${date} (${slotType})`);
        res.status(201).json(inserted);
    } catch (error) {
        console.error('[Availability] Failed to create slot:', error);
        res.status(500).json({ error: 'Failed to create availability slot' });
    }
});

/**
 * PATCH /api/availability/:id
 * Update an availability slot (book/unbook)
 *
 * Body (all optional):
 * - isBooked: boolean
 * - bookedByLeadId: string | null
 * - date: YYYY-MM-DD
 * - startTime: HH:mm
 * - endTime: HH:mm
 * - slotType: 'morning' | 'afternoon' | 'full_day'
 */
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { isBooked, bookedByLeadId, date, startTime, endTime, slotType } = req.body;

        // Check if slot exists
        const [existing] = await db.select()
            .from(availabilitySlots)
            .where(eq(availabilitySlots.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ error: 'Slot not found' });
        }

        // Build update object
        const updates: Record<string, any> = {
            updatedAt: new Date(),
        };

        // Handle booking/unbooking
        if (typeof isBooked === 'boolean') {
            updates.isBooked = isBooked;

            // If booking, validate lead exists
            if (isBooked && bookedByLeadId) {
                const [lead] = await db.select({ id: leads.id })
                    .from(leads)
                    .where(eq(leads.id, bookedByLeadId))
                    .limit(1);

                if (!lead) {
                    return res.status(400).json({ error: 'Lead not found' });
                }
                updates.bookedByLeadId = bookedByLeadId;
            }

            // If unbooking, clear the lead reference
            if (!isBooked) {
                updates.bookedByLeadId = null;
            }
        }

        // Handle other field updates
        if (date) {
            const dateObj = new Date(date);
            if (isNaN(dateObj.getTime())) {
                return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
            }
            updates.date = date;
        }

        if (startTime) {
            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (!timeRegex.test(startTime)) {
                return res.status(400).json({ error: 'Invalid startTime format. Use HH:mm' });
            }
            updates.startTime = startTime;
        }

        if (endTime) {
            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (!timeRegex.test(endTime)) {
                return res.status(400).json({ error: 'Invalid endTime format. Use HH:mm' });
            }
            updates.endTime = endTime;
        }

        if (slotType) {
            const validSlotTypes = ['morning', 'afternoon', 'full_day'];
            if (!validSlotTypes.includes(slotType)) {
                return res.status(400).json({
                    error: `Invalid slotType. Must be one of: ${validSlotTypes.join(', ')}`
                });
            }
            updates.slotType = slotType;
        }

        const [updated] = await db.update(availabilitySlots)
            .set(updates)
            .where(eq(availabilitySlots.id, id))
            .returning();

        console.log(`[Availability] Updated slot: ${id}`, updates);
        res.json(updated);
    } catch (error) {
        console.error('[Availability] Failed to update slot:', error);
        res.status(500).json({ error: 'Failed to update availability slot' });
    }
});

/**
 * DELETE /api/availability/:id
 * Delete an availability slot (admin only)
 */
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Check if slot exists
        const [existing] = await db.select()
            .from(availabilitySlots)
            .where(eq(availabilitySlots.id, id))
            .limit(1);

        if (!existing) {
            return res.status(404).json({ error: 'Slot not found' });
        }

        await db.delete(availabilitySlots)
            .where(eq(availabilitySlots.id, id));

        console.log(`[Availability] Deleted slot: ${id}`);
        res.json({ success: true, id });
    } catch (error) {
        console.error('[Availability] Failed to delete slot:', error);
        res.status(500).json({ error: 'Failed to delete availability slot' });
    }
});

/**
 * POST /api/availability/bulk
 * Create multiple slots at once (admin helper)
 *
 * Body:
 * - slots: Array of { date, startTime, endTime, slotType }
 */
router.post('/bulk', async (req: Request, res: Response) => {
    try {
        const { slots } = req.body;

        if (!Array.isArray(slots) || slots.length === 0) {
            return res.status(400).json({ error: 'slots array is required' });
        }

        const validSlotTypes = ['morning', 'afternoon', 'full_day'];
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

        const slotsToInsert = [];
        for (const slot of slots) {
            const { date, startTime, endTime, slotType } = slot;

            // Validate each slot
            if (!date || !startTime || !endTime || !slotType) {
                return res.status(400).json({
                    error: 'Each slot requires date, startTime, endTime, and slotType'
                });
            }

            if (!validSlotTypes.includes(slotType)) {
                return res.status(400).json({
                    error: `Invalid slotType: ${slotType}. Must be one of: ${validSlotTypes.join(', ')}`
                });
            }

            if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
                return res.status(400).json({
                    error: `Invalid time format for slot on ${date}. Use HH:mm`
                });
            }

            slotsToInsert.push({
                id: uuidv4(),
                date,
                startTime,
                endTime,
                slotType,
                isBooked: false,
                bookedByLeadId: null,
            });
        }

        const inserted = await db.insert(availabilitySlots)
            .values(slotsToInsert)
            .returning();

        console.log(`[Availability] Bulk created ${inserted.length} slots`);
        res.status(201).json({ success: true, count: inserted.length, slots: inserted });
    } catch (error) {
        console.error('[Availability] Failed to bulk create slots:', error);
        res.status(500).json({ error: 'Failed to create availability slots' });
    }
});

export default router;
