import { Router, Request, Response } from 'express';
import { db } from './db';
import { contractorAvailabilityDates, handymanAvailability, handymanProfiles } from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { requireContractorAuth } from './contractor-auth';



const router = Router();

// Helper to get ContractorID from UserID
async function getContractorId(userId: string): Promise<string | null> {
    const profile = await db.query.handymanProfiles.findFirst({
        where: eq(handymanProfiles.userId, userId),
        columns: { id: true }
    });
    return profile ? profile.id : null;
}

// GET /api/contractor/availability/upcoming
// Fetch merged availability for next X days (Pattern + Overrides)
router.get('/upcoming', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).contractor?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const contractorId = await getContractorId(userId);
        if (!contractorId) return res.status(404).json({ error: 'Contractor profile not found' });

        const days = parseInt(req.query.days as string) || 28;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + days);

        // 1. Fetch Date Overrides
        const overrides = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                gte(contractorAvailabilityDates.date, start),
                lte(contractorAvailabilityDates.date, end)
            ));

        // 2. Fetch Weekly Pattern
        const patterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, contractorId));

        // 3. Merge Logic (Date Override wins)
        const result = [];
        for (let i = 0; i < days; i++) {
            const date = new Date(start);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            const dayOfWeek = date.getDay(); // 0-6

            // Check override
            const override = overrides.find(o =>
                new Date(o.date).toISOString().split('T')[0] === dateStr
            );

            if (override) {
                result.push({
                    date: dateStr,
                    isAvailable: override.isAvailable,
                    source: 'override',
                    startTime: override.startTime,
                    endTime: override.endTime,
                    notes: override.notes
                });
            } else {
                // Check pattern
                const pattern = patterns.find(p => p.dayOfWeek === dayOfWeek && p.isActive);
                if (pattern) {
                    result.push({
                        date: dateStr,
                        isAvailable: true,
                        source: 'pattern',
                        startTime: pattern.startTime,
                        endTime: pattern.endTime
                    });
                } else {
                    result.push({
                        date: dateStr,
                        isAvailable: false,
                        source: 'default_off'
                    });
                }
            }
        }

        res.json(result);

    } catch (error) {
        console.error('Failed to fetch availability:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/contractor/availability/toggle
// Quickly toggle a specific date ON or OFF (The "Harvest" action)
router.post('/toggle', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).contractor?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const contractorId = await getContractorId(userId);
        if (!contractorId) return res.status(404).json({ error: 'Contractor profile not found' });

        const { date, isAvailable, mode } = req.body;
        if (!date) return res.status(400).json({ error: 'Date required' });

        // Determine Start/End times based on mode
        let finalIsAvailable = isAvailable; // Fallback to old boolean if mode not sent
        let startTime: string | null = null;
        let endTime: string | null = null;

        if (mode) {
            switch (mode) {
                case 'am':
                    finalIsAvailable = true;
                    startTime = '08:00';
                    endTime = '12:00';
                    break;
                case 'pm':
                    finalIsAvailable = true;
                    startTime = '13:00';
                    endTime = '17:00';
                    break;
                case 'full':
                    finalIsAvailable = true;
                    startTime = '08:00';
                    endTime = '17:00';
                    break;
                case 'off':
                    finalIsAvailable = false;
                    startTime = null;
                    endTime = null;
                    break;
            }
        } else {
            // Legacy handling (simple on/off defaults to full day)
            if (isAvailable) {
                startTime = '09:00';
                endTime = '17:00';
            }
        }

        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0); // Normalize

        // Upsert Logic: Check if override exists
        const existing = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                eq(contractorAvailabilityDates.date, targetDate)
            ))
            .limit(1);

        if (existing.length > 0) {
            // Update
            await db.update(contractorAvailabilityDates)
                .set({
                    isAvailable: finalIsAvailable,
                    startTime,
                    endTime
                })
                .where(eq(contractorAvailabilityDates.id, existing[0].id));
        } else {
            // Insert
            await db.insert(contractorAvailabilityDates).values({
                id: uuidv4(),
                contractorId,
                date: targetDate,
                isAvailable: finalIsAvailable,
                startTime,
                endTime
            });
        }

        res.json({ success: true, date, isAvailable: finalIsAvailable, mode });

    } catch (error) {
        console.error('Failed to toggle availability:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/contractor/availability/:year/:month
// Fetch availability for a specific month
router.get('/:year/:month', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).contractor?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const contractorId = await getContractorId(userId);
        if (!contractorId) return res.status(404).json({ error: 'Contractor profile not found' });

        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month); // 1-12

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0); // Last day of month

        // 1. Fetch Date Overrides
        const overrides = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                gte(contractorAvailabilityDates.date, start),
                lte(contractorAvailabilityDates.date, end)
            ));

        // 2. Fetch Weekly Pattern
        const patterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, contractorId));

        res.json({
            dates: overrides.map(o => ({
                id: o.id,
                date: o.date.toISOString().split('T')[0],
                isAvailable: o.isAvailable,
                startTime: o.startTime,
                endTime: o.endTime,
                notes: o.notes
            })),
            weeklyPatterns: patterns
        });

    } catch (error) {
        console.error('Failed to fetch monthly availability:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/contractor/availability/dates
// Bulk save specific dates
router.post('/dates', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).contractor?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const contractorId = await getContractorId(userId);
        if (!contractorId) return res.status(404).json({ error: 'Contractor profile not found' });

        const { dates, isAvailable } = req.body;
        // dates is array of "YYYY-MM-DD"

        if (!Array.isArray(dates)) return res.status(400).json({ error: 'Invalid dates' });

        // Upsert each date
        // Note: Drizzle upsert is better but loop is fine for small batches
        const startTime = isAvailable ? '09:00' : null;
        const endTime = isAvailable ? '17:00' : null;

        await db.transaction(async (tx) => {
            for (const dateStr of dates) {
                const date = new Date(dateStr);

                // Check existing
                const existing = await tx.select()
                    .from(contractorAvailabilityDates)
                    .where(and(
                        eq(contractorAvailabilityDates.contractorId, contractorId),
                        eq(contractorAvailabilityDates.date, date)
                    ))
                    .limit(1);

                if (existing.length > 0) {
                    await tx.update(contractorAvailabilityDates)
                        .set({ isAvailable, startTime, endTime })
                        .where(eq(contractorAvailabilityDates.id, existing[0].id));
                } else {
                    await tx.insert(contractorAvailabilityDates).values({
                        id: uuidv4(),
                        contractorId,
                        date,
                        isAvailable,
                        startTime,
                        endTime
                    });
                }
            }
        });

        res.json({ success: true, count: dates.length });

    } catch (error) {
        console.error('Failed to save dates:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/contractor/availability/weekly
// Save weekly patterns
router.post('/weekly', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).contractor?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const contractorId = await getContractorId(userId);
        if (!contractorId) return res.status(404).json({ error: 'Contractor profile not found' });

        const { patterns } = req.body; // Array of { dayOfWeek, startTime, endTime, isActive }

        if (!Array.isArray(patterns)) return res.status(400).json({ error: 'Invalid patterns' });

        await db.transaction(async (tx) => {
            // First delete existing patterns? Or upsert?
            // Safer to delete all and insert active ones, OR upsert logic.
            // Let's go with upsert logic based on dayOfWeek.

            for (const p of patterns) {
                const dayOfWeek = p.dayOfWeek;

                const existing = await tx.select()
                    .from(handymanAvailability)
                    .where(and(
                        eq(handymanAvailability.handymanId, contractorId),
                        eq(handymanAvailability.dayOfWeek, dayOfWeek)
                    ))
                    .limit(1);

                if (existing.length > 0) {
                    await tx.update(handymanAvailability)
                        .set({
                            startTime: p.startTime,
                            endTime: p.endTime,
                            isActive: true // Explicitly active if sent in this list?
                            // Frontend sends `localPatterns.filter(p => p.isActive)`?
                            // No, frontend sends `localPatterns.filter(p => p.isActive)` in handleSave.
                            // So if it's in the list, it's active.
                            // But what about inactive ones?
                            // If we want to disable a day, we might need to handle it.
                            // Frontend logic: `saveWeeklyMutation.mutate(localPatterns.filter(p => p.isActive))`
                            // This means only ACTIVE patterns are sent.
                            // We should probably mark others as inactive or delete them.
                        })
                        .where(eq(handymanAvailability.id, existing[0].id));
                } else {
                    await tx.insert(handymanAvailability).values({
                        id: uuidv4(),
                        handymanId: contractorId,
                        dayOfWeek,
                        startTime: p.startTime,
                        endTime: p.endTime,
                        isActive: true
                    });
                }
            }

            // Handle disabled days: If a day is NOT in the list, set isActive = false
            const sentDays = patterns.map((p: any) => p.dayOfWeek);
            const allDays = [0, 1, 2, 3, 4, 5, 6];
            const disabledDays = allDays.filter(d => !sentDays.includes(d));

            for (const day of disabledDays) {
                await tx.update(handymanAvailability)
                    .set({ isActive: false })
                    .where(and(
                        eq(handymanAvailability.handymanId, contractorId),
                        eq(handymanAvailability.dayOfWeek, day)
                    ));
            }
        });

        res.json({ success: true });

    } catch (error) {
        console.error('Failed to save weekly pattern:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;
