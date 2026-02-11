import { Router, Request, Response } from 'express';
import { db } from './db';
import {
    users,
    handymanProfiles,
    handymanSkills,
    handymanAvailability,
    contractorAvailabilityDates,
    contractorJobs,
    productizedServices
} from '../shared/schema';
import { eq, desc, count, and, gte, inArray } from 'drizzle-orm';

const router = Router();

// GET /api/admin/contractors
// List all contractors with summary data
router.get('/', async (req: Request, res: Response) => {
    try {
        // Get all contractor profiles with user info
        const contractors = await db.select({
            id: handymanProfiles.id,
            userId: handymanProfiles.userId,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone,
            postcode: handymanProfiles.postcode,
            city: handymanProfiles.city,
            radiusMiles: handymanProfiles.radiusMiles,
            bio: handymanProfiles.bio,
            availabilityStatus: handymanProfiles.availabilityStatus,
            publicProfileEnabled: handymanProfiles.publicProfileEnabled,
            slug: handymanProfiles.slug,
            createdAt: handymanProfiles.createdAt,
        })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .orderBy(desc(handymanProfiles.createdAt));

        // Get skills for all contractors
        const allSkills = await db.select({
            handymanId: handymanSkills.handymanId,
            serviceId: handymanSkills.serviceId,
            serviceName: productizedServices.name,
            hourlyRate: handymanSkills.hourlyRate,
        })
        .from(handymanSkills)
        .leftJoin(productizedServices, eq(handymanSkills.serviceId, productizedServices.id));

        // Get job counts for all contractors
        const jobCounts = await db.select({
            contractorId: contractorJobs.contractorId,
            totalJobs: count(),
        })
        .from(contractorJobs)
        .groupBy(contractorJobs.contractorId);

        // Get weekly patterns
        const weeklyPatterns = await db.select()
            .from(handymanAvailability);

        // Build response with aggregated data
        const contractorIds = contractors.map(c => c.id);

        // Get upcoming availability overrides
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksOut = new Date(today);
        twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

        const dateOverrides = contractorIds.length > 0
            ? await db.select()
                .from(contractorAvailabilityDates)
                .where(and(
                    inArray(contractorAvailabilityDates.contractorId, contractorIds),
                    gte(contractorAvailabilityDates.date, today)
                ))
            : [];

        // Map data to contractors
        const result = contractors.map(contractor => {
            const skills = allSkills
                .filter(s => s.handymanId === contractor.id)
                .map(s => ({
                    serviceId: s.serviceId,
                    serviceName: s.serviceName,
                    hourlyRate: s.hourlyRate,
                }));

            const jobs = jobCounts.find(j => j.contractorId === contractor.id);

            const patterns = weeklyPatterns
                .filter(p => p.handymanId === contractor.id)
                .map(p => ({
                    dayOfWeek: p.dayOfWeek,
                    startTime: p.startTime,
                    endTime: p.endTime,
                    isActive: p.isActive,
                }));

            const overrides = dateOverrides
                .filter(o => o.contractorId === contractor.id)
                .map(o => ({
                    date: o.date,
                    isAvailable: o.isAvailable,
                    startTime: o.startTime,
                    endTime: o.endTime,
                }));

            return {
                ...contractor,
                skills,
                totalJobs: jobs?.totalJobs || 0,
                weeklyPatterns: patterns,
                upcomingOverrides: overrides,
            };
        });

        res.json(result);
    } catch (error) {
        console.error('[AdminContractors] Error fetching contractors:', error);
        res.status(500).json({ error: 'Failed to fetch contractors' });
    }
});

// GET /api/admin/contractors/:id
// Get single contractor with full details
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const contractor = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.id, id),
            with: {
                user: true,
                skills: {
                    with: {
                        service: true
                    }
                }
            }
        });

        if (!contractor) {
            return res.status(404).json({ error: 'Contractor not found' });
        }

        // Get jobs
        const jobs = await db.select()
            .from(contractorJobs)
            .where(eq(contractorJobs.contractorId, id))
            .orderBy(desc(contractorJobs.createdAt))
            .limit(20);

        // Get weekly patterns
        const patterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, id));

        // Get date overrides
        const overrides = await db.select()
            .from(contractorAvailabilityDates)
            .where(eq(contractorAvailabilityDates.contractorId, id))
            .orderBy(desc(contractorAvailabilityDates.date))
            .limit(30);

        res.json({
            ...contractor,
            recentJobs: jobs,
            weeklyPatterns: patterns,
            dateOverrides: overrides,
        });
    } catch (error) {
        console.error('[AdminContractors] Error fetching contractor:', error);
        res.status(500).json({ error: 'Failed to fetch contractor' });
    }
});

export default router;
