import { Router, Request, Response } from 'express';
import { db } from './db';
import { contractorAvailabilityDates, handymanProfiles, handymanAvailability } from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { requireContractorAuth } from './contractor-auth';

const router = Router();

// GET /api/contractor/availability/month/:year/:month
// Get availability for a specific month (date-specific + weekly patterns)
router.get('/month/:year/:month', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { year, month } = req.params;

        const yearNum = parseInt(year);
        const monthNum = parseInt(month) - 1; // JS months are 0-indexed

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Calculate month date range
        const startDate = new Date(yearNum, monthNum, 1);
        const endDate = new Date(yearNum, monthNum + 1, 0, 23, 59, 59);

        // Get date-specific availability
        const dateAvailability = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                gte(contractorAvailabilityDates.date, startDate),
                lte(contractorAvailabilityDates.date, endDate)
            ));

        // Get weekly patterns
        const weeklyPatterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, contractorId));

        res.json({
            year: yearNum,
            month: monthNum + 1,
            dateAvailability: dateAvailability.map(d => ({
                id: d.id,
                date: d.date,
                isAvailable: d.isAvailable,
                startTime: d.startTime,
                endTime: d.endTime,
                notes: d.notes,
            })),
            weeklyPatterns: weeklyPatterns.map(w => ({
                id: w.id,
                dayOfWeek: w.dayOfWeek,
                startTime: w.startTime,
                endTime: w.endTime,
                isActive: w.isActive,
            })),
        });
    } catch (error) {
        console.error('[ContractorAvailability] Get month error:', error);
        res.status(500).json({ error: 'Failed to get availability' });
    }
});

// POST /api/contractor/availability/date
// Set availability for a specific date
router.post('/date', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { date, isAvailable, startTime, endTime, notes } = req.body;

        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;
        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

        // Check for existing entry on this date
        const startOfDay = new Date(targetDate);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const existing = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                gte(contractorAvailabilityDates.date, startOfDay),
                lte(contractorAvailabilityDates.date, endOfDay)
            ))
            .limit(1);

        if (existing.length > 0) {
            // Update existing
            await db.update(contractorAvailabilityDates)
                .set({
                    isAvailable: isAvailable ?? true,
                    startTime: startTime || null,
                    endTime: endTime || null,
                    notes: notes || null,
                })
                .where(eq(contractorAvailabilityDates.id, existing[0].id));

            res.json({ success: true, id: existing[0].id, updated: true });
        } else {
            // Create new
            const id = uuidv4();
            await db.insert(contractorAvailabilityDates).values({
                id,
                contractorId,
                date: targetDate,
                isAvailable: isAvailable ?? true,
                startTime: startTime || null,
                endTime: endTime || null,
                notes: notes || null,
            });

            res.json({ success: true, id, created: true });
        }
    } catch (error) {
        console.error('[ContractorAvailability] Set date error:', error);
        res.status(500).json({ error: 'Failed to set availability' });
    }
});

// POST /api/contractor/availability/dates/bulk
// Set availability for multiple dates at once
router.post('/dates/bulk', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { dates, isAvailable, startTime, endTime } = req.body;

        if (!dates || !Array.isArray(dates) || dates.length === 0) {
            return res.status(400).json({ error: 'Dates array is required' });
        }

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;
        let created = 0;
        let updated = 0;

        for (const dateStr of dates) {
            const targetDate = new Date(dateStr);
            targetDate.setHours(0, 0, 0, 0);

            const startOfDay = new Date(targetDate);
            const endOfDay = new Date(targetDate);
            endOfDay.setHours(23, 59, 59, 999);

            const existing = await db.select()
                .from(contractorAvailabilityDates)
                .where(and(
                    eq(contractorAvailabilityDates.contractorId, contractorId),
                    gte(contractorAvailabilityDates.date, startOfDay),
                    lte(contractorAvailabilityDates.date, endOfDay)
                ))
                .limit(1);

            if (existing.length > 0) {
                await db.update(contractorAvailabilityDates)
                    .set({
                        isAvailable: isAvailable ?? true,
                        startTime: startTime || null,
                        endTime: endTime || null,
                    })
                    .where(eq(contractorAvailabilityDates.id, existing[0].id));
                updated++;
            } else {
                await db.insert(contractorAvailabilityDates).values({
                    id: uuidv4(),
                    contractorId,
                    date: targetDate,
                    isAvailable: isAvailable ?? true,
                    startTime: startTime || null,
                    endTime: endTime || null,
                });
                created++;
            }
        }

        res.json({ success: true, created, updated });
    } catch (error) {
        console.error('[ContractorAvailability] Bulk set error:', error);
        res.status(500).json({ error: 'Failed to set availability' });
    }
});

// DELETE /api/contractor/availability/date/:id
// Remove a specific date availability entry
router.delete('/date/:id', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { id } = req.params;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Verify ownership before deleting
        const entry = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.id, id),
                eq(contractorAvailabilityDates.contractorId, contractorId)
            ))
            .limit(1);

        if (entry.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        await db.delete(contractorAvailabilityDates)
            .where(eq(contractorAvailabilityDates.id, id));

        res.json({ success: true });
    } catch (error) {
        console.error('[ContractorAvailability] Delete date error:', error);
        res.status(500).json({ error: 'Failed to delete availability' });
    }
});

// POST /api/contractor/availability/weekly
// Set recurring weekly availability pattern
router.post('/weekly', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const { patterns } = req.body; // Array of { dayOfWeek, startTime, endTime, isActive }

        if (!patterns || !Array.isArray(patterns)) {
            return res.status(400).json({ error: 'Patterns array is required' });
        }

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Delete existing patterns and insert new ones
        await db.delete(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, contractorId));

        if (patterns.length > 0) {
            const entries = patterns.map((p: any) => ({
                id: uuidv4(),
                handymanId: contractorId,
                dayOfWeek: p.dayOfWeek,
                startTime: p.startTime || '09:00',
                endTime: p.endTime || '17:00',
                isActive: p.isActive ?? true,
            }));

            await db.insert(handymanAvailability).values(entries);
        }

        res.json({ success: true, count: patterns.length });
    } catch (error) {
        console.error('[ContractorAvailability] Set weekly error:', error);
        res.status(500).json({ error: 'Failed to set weekly pattern' });
    }
});

// GET /api/contractor/availability/upcoming
// Get upcoming availability for the next 14 days (useful for job matching)
router.get('/upcoming', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;

        // Get contractor profile
        const profileResult = await db.select().from(handymanProfiles)
            .where(eq(handymanProfiles.userId, contractor.id))
            .limit(1);

        if (profileResult.length === 0) {
            return res.status(404).json({ error: 'Contractor profile not found' });
        }

        const contractorId = profileResult[0].id;

        // Get date-specific availability for next 14 days
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksOut = new Date(today);
        twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

        const dateAvailability = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                gte(contractorAvailabilityDates.date, today),
                lte(contractorAvailabilityDates.date, twoWeeksOut)
            ));

        // Get weekly patterns
        const weeklyPatterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, contractorId));

        // Build 14-day availability map
        const availability: Array<{
            date: string;
            dayOfWeek: number;
            isAvailable: boolean;
            startTime: string | null;
            endTime: string | null;
            source: 'date' | 'weekly' | 'default';
        }> = [];

        for (let i = 0; i < 14; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() + i);
            const dayOfWeek = date.getDay();
            const dateStr = date.toISOString().split('T')[0];

            // Check for date-specific override
            const dateOverride = dateAvailability.find(d => {
                const overrideDate = new Date(d.date);
                return overrideDate.toISOString().split('T')[0] === dateStr;
            });

            if (dateOverride) {
                availability.push({
                    date: dateStr,
                    dayOfWeek,
                    isAvailable: dateOverride.isAvailable,
                    startTime: dateOverride.startTime,
                    endTime: dateOverride.endTime,
                    source: 'date',
                });
            } else {
                // Check weekly pattern
                const weeklyMatch = weeklyPatterns.find(w => w.dayOfWeek === dayOfWeek && w.isActive);
                if (weeklyMatch) {
                    availability.push({
                        date: dateStr,
                        dayOfWeek,
                        isAvailable: true,
                        startTime: weeklyMatch.startTime,
                        endTime: weeklyMatch.endTime,
                        source: 'weekly',
                    });
                } else {
                    // Default to unavailable (no pattern set)
                    availability.push({
                        date: dateStr,
                        dayOfWeek,
                        isAvailable: false,
                        startTime: null,
                        endTime: null,
                        source: 'default',
                    });
                }
            }
        }

        res.json({ availability });
    } catch (error) {
        console.error('[ContractorAvailability] Get upcoming error:', error);
        res.status(500).json({ error: 'Failed to get upcoming availability' });
    }
});

export default router;
