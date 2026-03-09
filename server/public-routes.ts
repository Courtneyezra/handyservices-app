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
