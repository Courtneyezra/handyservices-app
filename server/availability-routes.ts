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

        const { date, isAvailable } = req.body;
        if (!date) return res.status(400).json({ error: 'Date required' });

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
                    isAvailable: isAvailable,
                    // Reset times to default 9-5 if becoming available, or null if unavailable?
                    // For simple toggle, keeping it simple. 
                    startTime: isAvailable ? '09:00' : null,
                    endTime: isAvailable ? '17:00' : null
                })
                .where(eq(contractorAvailabilityDates.id, existing[0].id));
        } else {
            // Insert
            await db.insert(contractorAvailabilityDates).values({
                id: uuidv4(),
                contractorId,
                date: targetDate,
                isAvailable: isAvailable,
                startTime: isAvailable ? '09:00' : null,
                endTime: isAvailable ? '17:00' : null
            });
        }

        res.json({ success: true, date, isAvailable });

    } catch (error) {
        console.error('Failed to toggle availability:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;
