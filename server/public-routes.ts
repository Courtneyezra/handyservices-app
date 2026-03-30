import { Router, Request, Response } from 'express';
import { db } from './db';
import { v4 as uuidv4 } from 'uuid';
import {
    handymanProfiles,
    contractorAvailabilityDates,
    handymanAvailability,
    contractorBookingRequests,
    availabilitySlots,
    masterAvailability,
    masterBlockedDates
} from '../shared/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { toZonedTime, format as formatTz } from 'date-fns-tz';
import { addDays, getDay, startOfDay } from 'date-fns';

const UK_TIMEZONE = 'Europe/London';

const router = Router();

// ============================================================================
// SYSTEM-WIDE AVAILABILITY API (For Quote Page Date Pickers)
// ============================================================================

interface DateAvailability {
    date: string;
    isAvailable: boolean;
    slots: ('am' | 'pm' | 'full')[];
    isWeekend?: boolean;
}

/**
 * GET /api/public/availability
 * Returns available dates for quote page date pickers
 *
 * Uses a layered approach:
 * 1. If explicit availabilitySlots exist for a date, use those
 * 2. Otherwise, fall back to masterAvailability weekly patterns
 * 3. masterBlockedDates always override to unavailable
 */
router.get('/availability', async (req: Request, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 28;

        // Anchor dates to UK timezone
        const ukNow = toZonedTime(new Date(), UK_TIMEZONE);
        const todayUk = startOfDay(ukNow);
        const todayStr = formatTz(todayUk, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE });
        const endDateUk = addDays(todayUk, days);
        const endDateStr = formatTz(endDateUk, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE });

        // Fetch all three data sources in parallel
        const [slots, masterPatterns, blockedDates] = await Promise.all([
            // Explicit slots (if any)
            db.select()
                .from(availabilitySlots)
                .where(and(
                    gte(availabilitySlots.date, todayStr),
                    lte(availabilitySlots.date, endDateStr),
                    eq(availabilitySlots.isBooked, false)
                )),
            // Master weekly patterns
            db.select()
                .from(masterAvailability)
                .where(eq(masterAvailability.isActive, true)),
            // Blocked dates
            db.select()
                .from(masterBlockedDates)
        ]);

        // Group explicit slots by date
        const slotsByDate = new Map<string, typeof slots>();
        for (const slot of slots) {
            if (!slotsByDate.has(slot.date)) {
                slotsByDate.set(slot.date, []);
            }
            slotsByDate.get(slot.date)!.push(slot);
        }

        // Index master patterns by day of week
        const patternsByDay = new Map<number, typeof masterPatterns>();
        for (const pattern of masterPatterns) {
            if (!patternsByDay.has(pattern.dayOfWeek)) {
                patternsByDay.set(pattern.dayOfWeek, []);
            }
            patternsByDay.get(pattern.dayOfWeek)!.push(pattern);
        }

        // Index blocked dates for fast lookup
        const blockedDateSet = new Set(
            blockedDates.map(bd => String(bd.date))
        );

        // Build response for each day
        const results: DateAvailability[] = [];

        for (let i = 0; i < days; i++) {
            const ukDate = addDays(todayUk, i);
            const dateStr = formatTz(ukDate, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE });
            const dayOfWeek = getDay(ukDate);
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            // 1. Blocked dates are always unavailable
            if (blockedDateSet.has(dateStr)) {
                results.push({
                    date: dateStr,
                    isAvailable: false,
                    slots: [],
                    isWeekend,
                });
                continue;
            }

            // 2. Check explicit slots first (if any exist for this date)
            const daySlots = slotsByDate.get(dateStr);
            if (daySlots && daySlots.length > 0) {
                const availableSlotTypes = new Set<'am' | 'pm' | 'full'>();
                for (const slot of daySlots) {
                    if (slot.slotType === 'morning') availableSlotTypes.add('am');
                    else if (slot.slotType === 'afternoon') availableSlotTypes.add('pm');
                    else if (slot.slotType === 'full_day') availableSlotTypes.add('full');
                }
                results.push({
                    date: dateStr,
                    isAvailable: true,
                    slots: Array.from(availableSlotTypes),
                    isWeekend,
                });
                continue;
            }

            // 3. Fall back to master weekly patterns
            const dayPatterns = patternsByDay.get(dayOfWeek);
            if (dayPatterns && dayPatterns.length > 0) {
                const availableSlotTypes = new Set<'am' | 'pm' | 'full'>();
                for (const pattern of dayPatterns) {
                    const start = pattern.startTime || '09:00';
                    const end = pattern.endTime || '17:00';
                    const startHour = parseInt(start.split(':')[0]);
                    const endHour = parseInt(end.split(':')[0]);

                    if (startHour < 12 && endHour > 13) {
                        availableSlotTypes.add('full');
                    } else if (startHour < 12) {
                        availableSlotTypes.add('am');
                    } else {
                        availableSlotTypes.add('pm');
                    }
                }
                results.push({
                    date: dateStr,
                    isAvailable: true,
                    slots: Array.from(availableSlotTypes),
                    isWeekend,
                });
                continue;
            }

            // 4. No master pattern for this day but other days have patterns:
            // treat as unavailable (e.g. Sunday not configured)
            if (masterPatterns.length > 0) {
                results.push({
                    date: dateStr,
                    isAvailable: false,
                    slots: [],
                    isWeekend,
                });
                continue;
            }

            // 5. No master patterns at all — default: weekdays available (am + pm), weekends unavailable
            results.push({
                date: dateStr,
                isAvailable: !isWeekend,
                slots: isWeekend ? [] : ['am', 'pm'],
                isWeekend,
            });
        }

        res.json({ dates: results });

    } catch (error: any) {
        console.error('[PublicAPI] Get system availability error:', error);
        console.error('[PublicAPI] Error stack:', error?.stack);
        res.status(500).json({ error: 'Failed to fetch availability', details: error?.message });
    }
});

// ============================================================================
// AVAILABILITY CONFIG (Master Switch)
// ============================================================================

/**
 * GET /api/public/availability/config
 * Returns availability configuration for the quote page.
 * When use_master_switch is true, the client should use master availability
 * instead of contractor-filtered availability.
 */
router.get('/availability/config', async (req: Request, res: Response) => {
    try {
        const { getSetting } = await import('./settings');
        const useMasterSwitch = await getSetting('availability.use_master_switch');
        res.json({ useMasterSwitch: useMasterSwitch ?? true });
    } catch (error: any) {
        console.error('[PublicAPI] Get availability config error:', error);
        // Default to master switch ON (safe fallback)
        res.json({ useMasterSwitch: true });
    }
});

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

// ============================================================================
// CATEGORY-FILTERED AVAILABILITY (For Contractor-Linked Quotes)
// ============================================================================

import { handymanSkills } from '../shared/schema';

interface FilteredDateAvailability {
    date: string;
    isAvailable: boolean;
    slots: ('am' | 'pm' | 'full')[];
    contractorCount: number;
    isWeekend?: boolean;
    isFallback?: boolean;
}

/**
 * GET /api/public/availability/filtered
 *
 * Returns dates where a contractor with matching categories is available.
 * Query params:
 *   - categories: comma-separated category slugs (e.g. 'plumbing_minor,tiling')
 *   - postcode: customer postcode (optional, for radius filtering)
 *   - timeEstimateMinutes: if >240, only full-day slots returned
 *   - days: number of days to look ahead (default 14)
 */
router.get('/availability/filtered', async (req: Request, res: Response) => {
    try {
        const categoriesParam = req.query.categories as string;
        const timeEstimate = parseInt(req.query.timeEstimateMinutes as string) || 0;
        const daysAhead = Math.min(parseInt(req.query.days as string) || 14, 30);
        const requireFullDay = timeEstimate > 240;

        if (!categoriesParam) {
            return res.status(400).json({ error: 'categories parameter required' });
        }

        const categories = categoriesParam.split(',').map(c => c.trim()).filter(Boolean);

        // 1. Find contractors matching these categories (not stale)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const matchingSkills = await db.select({
            handymanId: handymanSkills.handymanId,
            categorySlug: handymanSkills.categorySlug,
        })
            .from(handymanSkills)
            .where(
                // Match any of the requested categories
                // Using raw SQL for IN clause since drizzle's inArray needs the exact import
                eq(handymanSkills.categorySlug, categories[0]) // Start with first category
            );

        // Also get skills for other categories
        const allMatchingSkills = [];
        for (const cat of categories) {
            const skills = await db.select({
                handymanId: handymanSkills.handymanId,
            })
                .from(handymanSkills)
                .where(eq(handymanSkills.categorySlug, cat));
            allMatchingSkills.push(...skills);
        }

        // Unique contractor IDs
        const contractorIds = Array.from(new Set(allMatchingSkills.map(s => s.handymanId)));

        // Filter out stale contractors
        const freshContractors: string[] = [];
        for (const cId of contractorIds) {
            const profile = await db.select({
                id: handymanProfiles.id,
                lastAvailabilityRefresh: handymanProfiles.lastAvailabilityRefresh,
            })
                .from(handymanProfiles)
                .where(eq(handymanProfiles.id, cId))
                .limit(1);

            if (profile.length > 0) {
                const lastRefresh = profile[0].lastAvailabilityRefresh;
                // Include if refreshed within 7 days, or if never refreshed (new contractor, give benefit of doubt)
                if (!lastRefresh || lastRefresh > sevenDaysAgo) {
                    freshContractors.push(cId);
                }
            }
        }

        // 2. Check availability for each date in the window
        const results: FilteredDateAvailability[] = [];
        const today = startOfDay(new Date());

        for (let i = 1; i <= daysAhead; i++) {
            const checkDate = addDays(today, i);
            const dateStr = checkDate.toISOString().split('T')[0];
            const dayOfWeek = getDay(checkDate);
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            const slotsAvailable = new Set<'am' | 'pm'>();
            let availableContractorCount = 0;

            for (let ci = 0; ci < freshContractors.length; ci++) {
            const contractorId = freshContractors[ci];
                // Check date-specific override first
                const override = await db.select()
                    .from(contractorAvailabilityDates)
                    .where(and(
                        eq(contractorAvailabilityDates.contractorId, contractorId),
                        eq(contractorAvailabilityDates.date, checkDate)
                    ))
                    .limit(1);

                if (override.length > 0) {
                    const o = override[0];
                    if (o.isAvailable) {
                        availableContractorCount++;
                        const start = o.startTime || '08:00';
                        const end = o.endTime || '17:00';
                        if (start <= '08:00' && end >= '12:00') slotsAvailable.add('am');
                        if (start <= '13:00' && end >= '17:00') slotsAvailable.add('pm');
                    }
                    continue; // Override takes precedence
                }

                // Fall back to weekly pattern
                const pattern = await db.select()
                    .from(handymanAvailability)
                    .where(and(
                        eq(handymanAvailability.handymanId, contractorId),
                        eq(handymanAvailability.dayOfWeek, dayOfWeek),
                        eq(handymanAvailability.isActive, true)
                    ))
                    .limit(1);

                if (pattern.length > 0) {
                    availableContractorCount++;
                    const start = pattern[0].startTime || '08:00';
                    const end = pattern[0].endTime || '17:00';
                    if (start <= '08:00' && end >= '12:00') slotsAvailable.add('am');
                    if (start <= '13:00' && end >= '17:00') slotsAvailable.add('pm');
                }
            }

            // Build slots array
            const slots: ('am' | 'pm' | 'full')[] = [];
            const hasAm = slotsAvailable.has('am');
            const hasPm = slotsAvailable.has('pm');

            if (hasAm && hasPm) {
                slots.push('full');
                if (!requireFullDay) {
                    slots.push('am', 'pm');
                }
            } else if (!requireFullDay) {
                if (hasAm) slots.push('am');
                if (hasPm) slots.push('pm');
            }
            // If requireFullDay and no 'full', skip this date

            if (slots.length > 0) {
                results.push({
                    date: dateStr,
                    isAvailable: true,
                    slots,
                    contractorCount: availableContractorCount,
                    isWeekend,
                });
            }
        }

        // 3. Fallback: if no dates available, inject synthetic date at day 10
        if (results.length === 0) {
            const fallbackDate = addDays(today, 10);
            results.push({
                date: fallbackDate.toISOString().split('T')[0],
                isAvailable: true,
                slots: requireFullDay ? ['full'] : ['am', 'pm', 'full'],
                contractorCount: 0,
                isWeekend: getDay(fallbackDate) === 0 || getDay(fallbackDate) === 6,
                isFallback: true,
            });
        }

        res.json(results);
    } catch (error) {
        console.error('[PublicAPI] Filtered availability error:', error);
        res.status(500).json({ error: 'Failed to fetch filtered availability' });
    }
});

/**
 * POST /api/public/booking/check-availability
 *
 * Real-time availability check at booking time.
 * Verifies the selected date/slot is still available before confirming.
 */
router.post('/booking/check-availability', async (req: Request, res: Response) => {
    try {
        const { date, slot, categories } = req.body;

        if (!date || !slot || !categories?.length) {
            return res.status(400).json({ error: 'date, slot, and categories required' });
        }

        // Re-run filtered availability for just this one date
        const checkDate = new Date(date);
        const dayOfWeek = getDay(checkDate);

        // Find matching contractors
        const contractorIds = new Set<string>();
        for (const cat of categories) {
            const skills = await db.select({ handymanId: handymanSkills.handymanId })
                .from(handymanSkills)
                .where(eq(handymanSkills.categorySlug, cat));
            skills.forEach(s => contractorIds.add(s.handymanId));
        }

        let availableCount = 0;
        const availableContractorIds: string[] = [];

        const contractorIdArray = Array.from(contractorIds);
        for (let ci = 0; ci < contractorIdArray.length; ci++) {
            const contractorId = contractorIdArray[ci];
            // Check override
            const override = await db.select()
                .from(contractorAvailabilityDates)
                .where(and(
                    eq(contractorAvailabilityDates.contractorId, contractorId),
                    eq(contractorAvailabilityDates.date, checkDate)
                ))
                .limit(1);

            let isAvailableForSlot = false;

            if (override.length > 0 && override[0].isAvailable) {
                const start = override[0].startTime || '08:00';
                const end = override[0].endTime || '17:00';
                if (slot === 'am' && start <= '08:00' && end >= '12:00') isAvailableForSlot = true;
                if (slot === 'pm' && start <= '13:00' && end >= '17:00') isAvailableForSlot = true;
                if (slot === 'full' && start <= '08:00' && end >= '17:00') isAvailableForSlot = true;
            } else if (override.length === 0) {
                // Check weekly pattern
                const pattern = await db.select()
                    .from(handymanAvailability)
                    .where(and(
                        eq(handymanAvailability.handymanId, contractorId),
                        eq(handymanAvailability.dayOfWeek, dayOfWeek),
                        eq(handymanAvailability.isActive, true)
                    ))
                    .limit(1);

                if (pattern.length > 0) {
                    const start = pattern[0].startTime || '08:00';
                    const end = pattern[0].endTime || '17:00';
                    if (slot === 'am' && start <= '08:00' && end >= '12:00') isAvailableForSlot = true;
                    if (slot === 'pm' && start <= '13:00' && end >= '17:00') isAvailableForSlot = true;
                    if (slot === 'full' && start <= '08:00' && end >= '17:00') isAvailableForSlot = true;
                }
            }

            // Check for booking conflicts
            if (isAvailableForSlot) {
                const existingBookings = await db.select()
                    .from(contractorBookingRequests)
                    .where(and(
                        eq(contractorBookingRequests.contractorId, contractorId),
                        eq(contractorBookingRequests.requestedDate, checkDate),
                        eq(contractorBookingRequests.status, 'accepted')
                    ));

                if (existingBookings.length === 0) {
                    availableCount++;
                    availableContractorIds.push(contractorId);
                }
            }
        }

        res.json({
            available: availableCount > 0,
            contractorCount: availableCount,
            contractorIds: availableContractorIds,
        });
    } catch (error) {
        console.error('[PublicAPI] Booking check error:', error);
        res.status(500).json({ error: 'Failed to check availability' });
    }
});

export default router;
