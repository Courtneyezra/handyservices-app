/**
 * Availability Slots API
 *
 * Backend for managing availability slots for the Live Call HUD.
 * Allows admins to create slots and book them for leads.
 */

import { Router, Request, Response } from 'express';
import { db } from './db';
import { availabilitySlots, leads } from '../shared/schema';
import { eq, and, gte, lte, asc } from 'drizzle-orm';
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
