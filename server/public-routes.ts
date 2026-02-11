import { Router, Request, Response } from 'express';
import { db } from './db';
import { v4 as uuidv4 } from 'uuid';
import {
    handymanProfiles,
    users,
    contractorAvailabilityDates,
    handymanAvailability,
    contractorBookingRequests,
    masterAvailability,
    masterBlockedDates,
    handymanSkills,
    contractorJobs
} from '../shared/schema';
import { eq, and, gte, lte, or, isNull, inArray } from 'drizzle-orm';

const router = Router();

// ============================================================================
// SYSTEM-WIDE AVAILABILITY API (For Quote Page Date Pickers)
// ============================================================================

interface DateAvailability {
    date: string;
    isAvailable: boolean;
    reason?: 'master_blocked' | 'day_inactive' | 'no_contractors' | 'available';
    slots: ('am' | 'pm' | 'full')[];
    contractorCount?: number;
    isWeekend?: boolean;
}

/**
 * GET /api/public/availability
 * Returns available dates for quote page date pickers
 *
 * Logic:
 * 1. Check masterBlockedDates - if blocked, isAvailable: false
 * 2. Check masterAvailability - if day not active, isAvailable: false
 * 3. Query contractors with matching skills/location that have availability
 * 4. If ANY contractor available → isAvailable: true
 */
router.get('/availability', async (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 28;
        const postcode = req.query.postcode as string | undefined;
        const serviceIds = req.query.serviceIds
            ? (req.query.serviceIds as string).split(',')
            : undefined;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);

        // 1. Fetch master blocked dates
        const blockedDates = await db.select()
            .from(masterBlockedDates)
            .where(and(
                gte(masterBlockedDates.date, today.toISOString().split('T')[0]),
                lte(masterBlockedDates.date, endDate.toISOString().split('T')[0])
            ));

        const blockedDateSet = new Set(blockedDates.map(b => b.date));
        const blockedReasonMap = new Map(blockedDates.map(b => [b.date, b.reason]));

        // 2. Fetch master weekly patterns
        const masterPatterns = await db.select()
            .from(masterAvailability);

        const masterPatternMap = new Map(masterPatterns.map(p => [p.dayOfWeek, p]));

        // 3. Fetch all active contractors
        let contractors = await db.select({
            id: handymanProfiles.id,
            postcode: handymanProfiles.postcode,
            radiusMiles: handymanProfiles.radiusMiles,
            availabilityStatus: handymanProfiles.availabilityStatus,
        })
        .from(handymanProfiles)
        .where(
            or(
                eq(handymanProfiles.availabilityStatus, 'available'),
                isNull(handymanProfiles.availabilityStatus)
            )
        );

        // Filter by skills if serviceIds provided
        if (serviceIds && serviceIds.length > 0) {
            const contractorsWithSkills = await db.select({ handymanId: handymanSkills.handymanId })
                .from(handymanSkills)
                .where(inArray(handymanSkills.serviceId, serviceIds));

            const skillContractorIds = new Set(contractorsWithSkills.map(c => c.handymanId));
            contractors = contractors.filter(c => skillContractorIds.has(c.id));
        }

        // 4. Fetch contractor availability patterns and overrides
        const contractorIds = contractors.map(c => c.id);

        const contractorPatterns = contractorIds.length > 0
            ? await db.select()
                .from(handymanAvailability)
                .where(inArray(handymanAvailability.handymanId, contractorIds))
            : [];

        const contractorOverrides = contractorIds.length > 0
            ? await db.select()
                .from(contractorAvailabilityDates)
                .where(and(
                    inArray(contractorAvailabilityDates.contractorId, contractorIds),
                    gte(contractorAvailabilityDates.date, today),
                    lte(contractorAvailabilityDates.date, endDate)
                ))
            : [];

        // 5. Fetch booked jobs to exclude busy slots
        const bookedJobs = contractorIds.length > 0
            ? await db.select({
                contractorId: contractorJobs.contractorId,
                scheduledDate: contractorJobs.scheduledDate,
                scheduledTime: contractorJobs.scheduledTime,
            })
            .from(contractorJobs)
            .where(and(
                inArray(contractorJobs.contractorId, contractorIds),
                gte(contractorJobs.scheduledDate, today),
                lte(contractorJobs.scheduledDate, endDate),
                inArray(contractorJobs.status, ['pending', 'accepted', 'in_progress'])
            ))
            : [];

        // Build job lookup by date and contractor
        const jobsByDateContractor = new Map<string, Set<string>>();
        for (const job of bookedJobs) {
            if (!job.scheduledDate) continue;
            const dateStr = new Date(job.scheduledDate).toISOString().split('T')[0];
            const key = `${dateStr}:${job.contractorId}`;
            if (!jobsByDateContractor.has(key)) {
                jobsByDateContractor.set(key, new Set());
            }
            // Determine which slot is booked
            if (job.scheduledTime) {
                const hour = parseInt(job.scheduledTime.split(':')[0]);
                jobsByDateContractor.get(key)!.add(hour < 12 ? 'am' : 'pm');
            } else {
                jobsByDateContractor.get(key)!.add('full');
            }
        }

        // 6. Build availability for each day
        const results: DateAvailability[] = [];

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            // Check master blocked
            if (blockedDateSet.has(dateStr)) {
                results.push({
                    date: dateStr,
                    isAvailable: false,
                    reason: 'master_blocked',
                    slots: [],
                    isWeekend,
                });
                continue;
            }

            // Check master pattern for this day
            const masterPattern = masterPatternMap.get(dayOfWeek);
            if (!masterPattern || !masterPattern.isActive) {
                results.push({
                    date: dateStr,
                    isAvailable: false,
                    reason: 'day_inactive',
                    slots: [],
                    isWeekend,
                });
                continue;
            }

            // Count available contractors for this date
            let availableContractorCount = 0;
            const availableSlots = new Set<'am' | 'pm' | 'full'>();

            for (const contractor of contractors) {
                // Check for date override
                const override = contractorOverrides.find(o =>
                    o.contractorId === contractor.id &&
                    new Date(o.date).toISOString().split('T')[0] === dateStr
                );

                let isContractorAvailable = false;
                let contractorSlots: ('am' | 'pm' | 'full')[] = [];

                if (override) {
                    if (override.isAvailable) {
                        isContractorAvailable = true;
                        contractorSlots = determineSlots(override.startTime, override.endTime);
                    }
                } else {
                    // Check weekly pattern
                    const pattern = contractorPatterns.find(p =>
                        p.handymanId === contractor.id &&
                        p.dayOfWeek === dayOfWeek &&
                        p.isActive
                    );

                    if (pattern) {
                        isContractorAvailable = true;
                        contractorSlots = determineSlots(pattern.startTime, pattern.endTime);
                    } else if (masterPattern) {
                        // Fall back to master pattern
                        isContractorAvailable = true;
                        contractorSlots = determineSlots(masterPattern.startTime, masterPattern.endTime);
                    }
                }

                if (isContractorAvailable) {
                    // Filter out booked slots
                    const bookedSlots = jobsByDateContractor.get(`${dateStr}:${contractor.id}`);
                    if (bookedSlots) {
                        if (bookedSlots.has('full')) {
                            contractorSlots = [];
                        } else {
                            contractorSlots = contractorSlots.filter(s => {
                                if (s === 'full') return !bookedSlots.has('am') && !bookedSlots.has('pm');
                                return !bookedSlots.has(s);
                            });
                        }
                    }

                    if (contractorSlots.length > 0) {
                        availableContractorCount++;
                        contractorSlots.forEach(s => availableSlots.add(s));
                    }
                }
            }

            if (availableContractorCount === 0) {
                results.push({
                    date: dateStr,
                    isAvailable: false,
                    reason: 'no_contractors',
                    slots: [],
                    contractorCount: 0,
                    isWeekend,
                });
            } else {
                results.push({
                    date: dateStr,
                    isAvailable: true,
                    reason: 'available',
                    slots: Array.from(availableSlots),
                    contractorCount: availableContractorCount,
                    isWeekend,
                });
            }
        }

        res.json({ dates: results });

    } catch (error: any) {
        console.error('[PublicAPI] Get system availability error:', error);
        console.error('[PublicAPI] Error stack:', error?.stack);
        res.status(500).json({ error: 'Failed to fetch availability', details: error?.message });
    }
});

/**
 * Determine time slots from start/end times
 */
function determineSlots(startTime?: string | null, endTime?: string | null): ('am' | 'pm' | 'full')[] {
    if (!startTime || !endTime) return ['full', 'am', 'pm'];

    const startHour = parseInt(startTime.split(':')[0]);
    const endHour = parseInt(endTime.split(':')[0]);

    if (startHour < 12 && endHour > 12) {
        return ['full', 'am', 'pm'];
    }
    if (startHour < 12 && endHour <= 13) {
        return ['am'];
    }
    if (startHour >= 12) {
        return ['pm'];
    }

    return ['full', 'am', 'pm'];
}

// ============================================================================
// CONTRACTOR PUBLIC PROFILE ROUTES
// ============================================================================

// GET /api/public/contractor/:slug
// Get contractor public profile by slug
router.get('/contractor/:slug', async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;

        // Find profile by slug
        const profileWithUser = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.slug, slug),
            with: {
                user: true, // Join with users table
                skills: {
                    with: {
                        service: true // Join with productizedServices to get skill names
                    }
                }
            }
        });

        if (!profileWithUser) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        // Check if public profile is enabled
        if (!profileWithUser.publicProfileEnabled) {
            return res.status(403).json({ error: 'Profile is not public' });
        }

        // Construct safe public response
        const response = {
            id: profileWithUser.id,
            firstName: profileWithUser.user.firstName,
            lastName: profileWithUser.user.lastName ? profileWithUser.user.lastName[0] + '.' : '',
            fullName: `${profileWithUser.user.firstName} ${profileWithUser.user.lastName}`,
            bio: profileWithUser.bio,
            city: profileWithUser.city,
            postcode: profileWithUser.postcode,
            phone: profileWithUser.user.phone, // Expose phone for WhatsApp
            heroImageUrl: profileWithUser.heroImageUrl,
            mediaGallery: profileWithUser.mediaGallery, // ARRAY of {type, url, caption}
            socialLinks: profileWithUser.socialLinks,
            skills: profileWithUser.skills.map(s => s.service.name),
            services: profileWithUser.skills.map(s => ({
                id: s.service.id,
                name: s.service.name,
                description: s.service.description,
                pricePence: s.hourlyRate ? (s.hourlyRate * 100) : s.service.pricePence, // Use override (pounds -> pence) or default
                category: s.service.category
            })),
            radiusMiles: profileWithUser.radiusMiles,
            trustBadges: profileWithUser.trustBadges, // Added
            availabilityStatus: profileWithUser.availabilityStatus, // Added
            beforeAfterGallery: profileWithUser.beforeAfterGallery, // Added
        };

        res.json(response);
    } catch (error) {
        console.error('[PublicAPI] Get contractor error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// GET /api/public/contractor/:slug/availability
// Get upcoming availability for public calendar
router.get('/contractor/:slug/availability', async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;

        // 1. Get Contractor ID from Slug
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.slug, slug),
            columns: { id: true, publicProfileEnabled: true }
        });

        if (!profile || !profile.publicProfileEnabled) {
            return res.status(404).json({ error: 'Profile not found or private' });
        }

        const contractorId = profile.id;

        // 2. Fetch Availability (Next 14 Days)
        // Similar logic to internal /upcoming route
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twoWeeksOut = new Date(today);
        twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

        // Date Overrides
        const dateAvailability = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                gte(contractorAvailabilityDates.date, today),
                lte(contractorAvailabilityDates.date, twoWeeksOut)
            ));

        // Weekly Patterns
        const weeklyPatterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, contractorId));

        // Build result
        const availability: Array<any> = [];

        for (let i = 0; i < 14; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() + i);
            const dayOfWeek = date.getDay();
            const dateStr = date.toISOString().split('T')[0];

            // Check override first
            const override = dateAvailability.find(d =>
                new Date(d.date).toISOString().split('T')[0] === dateStr
            );

            if (override) {
                if (override.isAvailable) {
                    availability.push({
                        date: dateStr,
                        startTime: override.startTime,
                        endTime: override.endTime
                    });
                }
                // If isAvailable=false, we just don't push it
            } else {
                // Check pattern
                const pattern = weeklyPatterns.find(w => w.dayOfWeek === dayOfWeek && w.isActive);
                if (pattern) {
                    availability.push({
                        date: dateStr,
                        startTime: pattern.startTime,
                        endTime: pattern.endTime
                    });
                }
            }
        }

        res.json({ availability });
    } catch (error) {
        console.error('[PublicAPI] Get availability error:', error);
        res.status(500).json({ error: 'Failed to fetch availability' });
    }
});

// POST /api/public/contractor/:slug/book
// Submit a booking request
router.post('/contractor/:slug/book', async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        const { name, email, phone, date, slot, description } = req.body;

        if (!name || !phone || !date || !slot) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Get Contractor
        const profile = await db.query.handymanProfiles.findFirst({
            where: eq(handymanProfiles.slug, slug),
            columns: { id: true }
        });

        if (!profile) {
            return res.status(404).json({ error: 'Contractor not found' });
        }

        // 2. Create Booking Request
        await db.insert(contractorBookingRequests).values({
            id: uuidv4(),
            contractorId: profile.id,
            customerName: name,
            customerEmail: email,
            customerPhone: phone,
            requestedDate: new Date(date),
            requestedSlot: slot,
            description: description || '',
            status: 'pending'
        });

        res.json({ success: true });

    } catch (error) {
        console.error('[PublicAPI] Booking request error:', error);
        res.status(500).json({ error: 'Failed to submit booking' });
    }
});

export default router;
