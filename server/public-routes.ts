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
    masterBlockedDates,
    personalizedQuotes,
    bookingSlotLocks,
    handymanSkills,
} from '../shared/schema';
import { eq, and, gte, lte, or, inArray } from 'drizzle-orm';
import { toZonedTime, format as formatTz } from 'date-fns-tz';
import { addDays, getDay, startOfDay, startOfMonth, endOfMonth, parseISO, isBefore } from 'date-fns';
import { notifyWebformLead } from './pushover';

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

        // Phone push alert (Pushover) — fire-and-forget
        notifyWebformLead({
            name,
            phoneNumber: phone,
            details: `Booking request: ${date} ${slot}${description ? ` — ${description}` : ''}`,
            source: 'Booking request',
        }).catch((e) => console.warn('[PublicAPI] notifyWebformLead failed:', e));

        res.json({ success: true });

    } catch (error) {
        console.error('[PublicAPI] Booking request error:', error);
        res.status(500).json({ error: 'Failed to submit booking' });
    }
});

// ============================================================================
// QUOTE-SPECIFIC AVAILABILITY (Candidate Pool from Quote)
// ============================================================================

type SlotParam = 'am' | 'pm' | 'full_day';

/**
 * Determines which slot types conflict with the requested slot.
 * AM conflicts with AM and FULL_DAY.
 * PM conflicts with PM and FULL_DAY.
 * FULL_DAY conflicts with everything.
 */
function getConflictingSlots(slot: SlotParam): SlotParam[] {
    switch (slot) {
        case 'am': return ['am', 'full_day'];
        case 'pm': return ['pm', 'full_day'];
        case 'full_day': return ['am', 'pm', 'full_day'];
    }
}

/**
 * Checks whether a contractor's time range covers the requested slot.
 * Delegates to the shared canonical implementation in shared/slot-times.ts.
 */
import { timeRangeCoversSlot as _coversSlot } from '../shared/slot-times';
function timeRangeCoversSlot(startTime: string | null, endTime: string | null, slot: SlotParam): boolean {
    return _coversSlot(startTime, endTime, slot as any);
}

/**
 * GET /api/public/quote/:quoteId/availability
 *
 * Returns dates where at least one candidate contractor from the quote's pool
 * is available for the requested slot.
 *
 * Query params:
 *   - slot: 'am' | 'pm' | 'full_day' (required)
 *   - month: 'YYYY-MM' (optional, defaults to current month)
 *
 * Returns: Array<{ date: string, contractorCount: number, slot: string }>
 */
router.get('/quote/:quoteId/availability', async (req: Request, res: Response) => {
    try {
        const { quoteId } = req.params;
        const slot = (req.query.slot as string || '').toLowerCase() as SlotParam;
        const monthParam = req.query.month as string | undefined;

        // Validate slot
        if (!['am', 'pm', 'full_day'].includes(slot)) {
            return res.status(400).json({ error: 'slot parameter required: am, pm, or full_day' });
        }

        // 1. Fetch the quote by ID or shortSlug
        const quote = await db.query.personalizedQuotes.findFirst({
            where: or(
                eq(personalizedQuotes.id, quoteId),
                eq(personalizedQuotes.shortSlug, quoteId)
            ),
        });

        if (!quote) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        // Phase 22f — resolve the candidate pool through the SAME helper the
        // admin fit panel uses. This is the fix for the divergence where
        // a quote's customer-facing dates included contractors the admin
        // builder said couldn't do the job (out of range, or skill gaps).
        //
        // The stored `candidateContractorIds` on the quote row is ignored —
        // we resolve the pool fresh because contractor skills/radius/
        // verification status can change between quote creation and viewing.
        // `resolveQuoteCandidatePoolForQuote` is single-flight + 60s-TTL
        // cached (see quote-fit.ts): the banner + picker firing on one page
        // load share a single geocode + matcher pass, and slot/month/focus
        // refetches reuse it. Staleness is bounded to 60s.
        const { resolveQuoteCandidatePoolForQuote } = await import('./lib/quote-fit');
        const fit = await resolveQuoteCandidatePoolForQuote(quote);

        if (fit.candidates.length === 0) {
            console.log(`[PublicAPI] quote ${quote.id}: no eligible contractors (uncovered=[${fit.uncoveredCategories.join(',')}], partialDropped=${fit.partialCoverageDropped})`);
            return res.json([]);
        }

        // Phase 24d — derive requiredDays from the quote's line items so
        // multi-day jobs only surface valid start dates. Multi-day jobs are
        // always full_day regardless of the slot query param.
        const { computeBookingDurationDays } = await import('../shared/schedule-composition');
        const lineItems = (quote.pricingLineItems as any[]) || [];
        const requiredDays = computeBookingDurationDays(lineItems, {
            floorNumber: (quote as any).floorNumber ?? null,
            hasLift: (quote as any).hasLift ?? null,
            parkingDistanceCategory: (quote as any).parkingDistanceCategory ?? null,
            customerPresent: (quote as any).customerPresent ?? null,
        });
        const effectiveSlot: SlotParam = requiredDays > 1 ? 'full_day' : slot;
        if (requiredDays > 1) {
            console.log(`[PublicAPI] quote ${quote.id}: multi-day job (${requiredDays} days) — forcing slot=full_day`);
        }

        const candidateIds = fit.candidates.map((c) => c.contractorId);
        return await buildAvailabilityResponse(res, candidateIds, effectiveSlot, monthParam, requiredDays);

    } catch (error: any) {
        console.error('[PublicAPI] Quote availability error:', error);
        console.error('[PublicAPI] Error stack:', error?.stack);
        res.status(500).json({ error: 'Failed to fetch quote availability', details: error?.message });
    }
});

/**
 * Core availability builder for a set of contractor IDs, a slot, and a date range.
 *
 * Phase 24d — `requiredDays` is the number of consecutive working days the
 * quote needs from one contractor. Defaults to 1 (legacy single-day flow,
 * unchanged). For N >= 2 the response only includes dates where at least
 * one contractor has all N consecutive days free.
 */
async function buildAvailabilityResponse(
    res: Response,
    contractorIds: string[],
    slot: SlotParam,
    monthParam?: string,
    requiredDays: number = 1,
) {
    const ukNow = toZonedTime(new Date(), UK_TIMEZONE);
    const ukToday = startOfDay(ukNow);
    const currentHour = ukNow.getHours();

    // Determine date range from month param or default to next 30 days
    let rangeStart: Date;
    let rangeEnd: Date;

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
        const monthDate = parseISO(`${monthParam}-01`);
        rangeStart = startOfMonth(monthDate);
        rangeEnd = endOfMonth(monthDate);
        // Don't go before today
        if (isBefore(rangeStart, ukToday)) {
            rangeStart = ukToday;
        }
    } else {
        rangeStart = ukToday;
        rangeEnd = addDays(ukToday, 30);
    }

    // If range end is before today, return empty
    if (isBefore(rangeEnd, ukToday)) {
        return res.json([]);
    }

    const totalDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const conflictingSlots = getConflictingSlots(slot);

    // Batch-fetch all data we need
    const rangeStartStr = formatTz(rangeStart, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE });
    const rangeEndStr = formatTz(rangeEnd, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE });

    const [dateOverrides, weeklyPatterns, bookingConflicts, slotLocks, masterBlocked] = await Promise.all([
        // Date-specific availability overrides
        db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                inArray(contractorAvailabilityDates.contractorId, contractorIds),
                gte(contractorAvailabilityDates.date, rangeStart),
                lte(contractorAvailabilityDates.date, rangeEnd)
            )),

        // Weekly patterns for all candidates
        db.select()
            .from(handymanAvailability)
            .where(and(
                inArray(handymanAvailability.handymanId, contractorIds),
                eq(handymanAvailability.isActive, true)
            )),

        // Existing bookings that could conflict
        db.select()
            .from(contractorBookingRequests)
            .where(and(
                inArray(contractorBookingRequests.assignedContractorId, contractorIds),
                gte(contractorBookingRequests.scheduledDate, rangeStart),
                lte(contractorBookingRequests.scheduledDate, rangeEnd),
                eq(contractorBookingRequests.assignmentStatus, 'accepted')
            )),

        // Active slot locks (not expired)
        db.select()
            .from(bookingSlotLocks)
            .where(and(
                gte(bookingSlotLocks.scheduledDate, rangeStart),
                lte(bookingSlotLocks.scheduledDate, rangeEnd),
                gte(bookingSlotLocks.expiresAt, new Date()) // not expired
            )),

        // Master blocked dates — hard override: always unavailable regardless of contractor pool
        db.select()
            .from(masterBlockedDates)
            .where(and(
                gte(masterBlockedDates.date, rangeStartStr),
                lte(masterBlockedDates.date, rangeEndStr)
            )),
    ]);

    // Index master blocked dates for O(1) lookup
    const blockedDateSet = new Set(masterBlocked.map(b => String(b.date)));

    // Index date overrides: Map<contractorId-dateStr, override>
    const overrideMap = new Map<string, typeof dateOverrides[0]>();
    for (const o of dateOverrides) {
        const dateStr = new Date(o.date).toISOString().split('T')[0];
        overrideMap.set(`${o.contractorId}-${dateStr}`, o);
    }

    // Index weekly patterns: Map<contractorId-dayOfWeek, pattern>
    const patternMap = new Map<string, typeof weeklyPatterns[0]>();
    for (const p of weeklyPatterns) {
        patternMap.set(`${p.handymanId}-${p.dayOfWeek}`, p);
    }

    // Index booking conflicts: Map<contractorId-dateStr, Set<slot>>
    // Phase 24c — a multi-day booking (durationDays>1) occupies every day in
    // the span, so expand each booking row into one map entry per day.
    const bookingMap = new Map<string, Set<string>>();
    for (const b of bookingConflicts) {
        if (!b.scheduledDate || !b.assignedContractorId) continue;
        const dur = (b as any).durationDays ?? 1;
        const bookedSlot = b.scheduledSlot || 'full_day';
        for (let i = 0; i < dur; i++) {
            const day = new Date(b.scheduledDate);
            day.setUTCDate(day.getUTCDate() + i);
            const dateStr = day.toISOString().split('T')[0];
            const key = `${b.assignedContractorId}-${dateStr}`;
            if (!bookingMap.has(key)) bookingMap.set(key, new Set());
            bookingMap.get(key)!.add(bookedSlot);
        }
    }

    // Index slot locks: Map<contractorId-dateStr, Set<slot>>
    // Same multi-day expansion as bookings.
    const lockMap = new Map<string, Set<string>>();
    for (const lock of slotLocks) {
        const dur = (lock as any).durationDays ?? 1;
        for (let i = 0; i < dur; i++) {
            const day = new Date(lock.scheduledDate);
            day.setUTCDate(day.getUTCDate() + i);
            const dateStr = day.toISOString().split('T')[0];
            const key = `${lock.contractorId}-${dateStr}`;
            if (!lockMap.has(key)) lockMap.set(key, new Set());
            lockMap.get(key)!.add(lock.scheduledSlot);
        }
    }

    // Phase 24d — compute per-(contractor, date) availability first, then
    // either return per-day counts (requiredDays=1, legacy) or slide an N-day
    // window per contractor to find valid START dates (requiredDays>=2).

    // Per-contractor free-day set within the window
    const freePerContractor = new Map<string, Set<string>>();
    const todayStr = formatTz(ukToday, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE });

    function isContractorFreeOnDate(contractorId: string, checkDate: Date, dateStr: string, dayOfWeek: number): boolean {
        // Same-day time-of-day cutoffs
        if (dateStr === todayStr) {
            if (slot === 'am' && currentHour >= 12) return false;
            if (slot === 'pm' && currentHour >= 15) return false;
            if (slot === 'full_day' && currentHour >= 12) return false;
        }
        if (blockedDateSet.has(dateStr)) return false;

        const override = overrideMap.get(`${contractorId}-${dateStr}`);
        let isBaseAvailable = false;
        if (override) {
            if (override.isAvailable) {
                isBaseAvailable = timeRangeCoversSlot(override.startTime, override.endTime, slot);
            }
        } else {
            const pattern = patternMap.get(`${contractorId}-${dayOfWeek}`);
            if (pattern) {
                isBaseAvailable = timeRangeCoversSlot(pattern.startTime, pattern.endTime, slot);
            }
        }
        if (!isBaseAvailable) return false;

        const bookedSlots = bookingMap.get(`${contractorId}-${dateStr}`);
        if (bookedSlots && conflictingSlots.some(cs => bookedSlots.has(cs))) return false;

        const lockedSlots = lockMap.get(`${contractorId}-${dateStr}`);
        if (lockedSlots && conflictingSlots.some(cs => lockedSlots.has(cs))) return false;

        return true;
    }

    for (const contractorId of contractorIds) {
        const free = new Set<string>();
        for (let i = 0; i < totalDays; i++) {
            const checkDate = addDays(rangeStart, i);
            if (isBefore(checkDate, ukToday)) continue;
            const dateStr = formatTz(checkDate, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE });
            const dayOfWeek = getDay(checkDate);
            if (isContractorFreeOnDate(contractorId, checkDate, dateStr, dayOfWeek)) {
                free.add(dateStr);
            }
        }
        freePerContractor.set(contractorId, free);
    }

    // Build results
    const results: Array<{ date: string; contractorCount: number; slot: string; durationDays?: number }> = [];

    for (let i = 0; i < totalDays; i++) {
        const checkDate = addDays(rangeStart, i);
        if (isBefore(checkDate, ukToday)) continue;
        const dateStr = formatTz(checkDate, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE });

        let availableCount = 0;
        if (requiredDays === 1) {
            for (const contractorId of contractorIds) {
                if (freePerContractor.get(contractorId)?.has(dateStr)) availableCount++;
            }
        } else {
            // Multi-day: contractor must have all N consecutive days free
            // starting at this date.
            const spanDates: string[] = [];
            for (let j = 0; j < requiredDays; j++) {
                const d = addDays(checkDate, j);
                spanDates.push(formatTz(d, 'yyyy-MM-dd', { timeZone: UK_TIMEZONE }));
            }
            for (const contractorId of contractorIds) {
                const free = freePerContractor.get(contractorId);
                if (!free) continue;
                if (spanDates.every(ds => free.has(ds))) availableCount++;
            }
        }

        if (availableCount > 0) {
            results.push({
                date: dateStr,
                contractorCount: availableCount,
                slot,
                ...(requiredDays > 1 ? { durationDays: requiredDays } : {}),
            });
        }
    }

    results.sort((a, b) => a.date.localeCompare(b.date));

    return res.json(results);
}

// ============================================================================
// CATEGORY-FILTERED AVAILABILITY (For Contractor-Linked Quotes)
// ============================================================================

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

        // Find contractors who have ALL required categories (intersection, not union)
        const allMatchingSkills = [];
        for (const cat of categories) {
            const skills = await db.select({
                handymanId: handymanSkills.handymanId,
                categorySlug: handymanSkills.categorySlug,
            })
                .from(handymanSkills)
                .where(eq(handymanSkills.categorySlug, cat));
            allMatchingSkills.push(...skills);
        }

        // Count how many distinct required categories each contractor matches
        const contractorCategoryCounts = new Map<string, Set<string>>();
        for (const skill of allMatchingSkills) {
            if (!contractorCategoryCounts.has(skill.handymanId)) {
                contractorCategoryCounts.set(skill.handymanId, new Set());
            }
            contractorCategoryCounts.get(skill.handymanId)!.add(skill.categorySlug);
        }

        // Only include contractors who match ALL required categories
        const contractorIds = Array.from(contractorCategoryCounts.entries())
            .filter(([_, matchedCategories]) => matchedCategories.size === categories.length)
            .map(([id]) => id);

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
                        if (_coversSlot(o.startTime, o.endTime, 'am')) slotsAvailable.add('am');
                        if (_coversSlot(o.startTime, o.endTime, 'pm')) slotsAvailable.add('pm');
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
                    if (_coversSlot(pattern[0].startTime, pattern[0].endTime, 'am')) slotsAvailable.add('am');
                    if (_coversSlot(pattern[0].startTime, pattern[0].endTime, 'pm')) slotsAvailable.add('pm');
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

        // Return results (empty array if no dates available — frontend handles the empty state)
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
                const slotKey = (slot === 'full' ? 'full_day' : slot) as any;
                isAvailableForSlot = _coversSlot(override[0].startTime, override[0].endTime, slotKey);
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
                    const slotKey = (slot === 'full' ? 'full_day' : slot) as any;
                    isAvailableForSlot = _coversSlot(pattern[0].startTime, pattern[0].endTime, slotKey);
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

// ============================================================================
// ATOMIC SLOT RESERVATION (Booking Engine)
// ============================================================================

import { reserveSlot, releaseSlot } from './booking-engine';

/**
 * POST /api/public/booking/reserve-slot
 *
 * Atomically reserves a contractor+date+slot before payment.
 * Returns a lockId to pass to the payment flow.
 * Lock expires after 5 minutes if payment is not completed.
 */
router.post('/booking/reserve-slot', async (req: Request, res: Response) => {
    try {
        const { quoteId, scheduledDate, scheduledSlot, candidateContractorIds } = req.body;

        if (!quoteId || !scheduledDate || !scheduledSlot) {
            return res.status(400).json({ error: 'quoteId, scheduledDate, and scheduledSlot are required' });
        }

        if (!['am', 'pm', 'full_day'].includes(scheduledSlot)) {
            return res.status(400).json({ error: 'scheduledSlot must be am, pm, or full_day' });
        }

        // If candidateContractorIds not provided, look them up from the quote
        let candidates: (number | string)[] = candidateContractorIds || [];
        let resolvedQuoteId = quoteId; // May be slug or full ID — resolve to full ID

        if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
            const { personalizedQuotes } = await import('../shared/schema');
            const [quote] = await db.select({
                candidateContractorIds: personalizedQuotes.candidateContractorIds,
                contractorId: personalizedQuotes.contractorId,
                quoteIdFull: personalizedQuotes.id,
                quoteMode: personalizedQuotes.quoteMode,
            })
                .from(personalizedQuotes)
                .where(or(eq(personalizedQuotes.id, quoteId), eq(personalizedQuotes.shortSlug, quoteId)))
                .limit(1);

            if (!quote) {
                return res.status(404).json({ error: 'Quote not found' });
            }

            // Always use the full quote ID for the booking engine
            resolvedQuoteId = quote.quoteIdFull;

            // Use candidateContractorIds from quote, or fall back to the single matched contractor
            const quoteCandidates = (quote.candidateContractorIds as string[]) || [];
            if (quoteCandidates.length > 0) {
                candidates = quoteCandidates.filter(id => typeof id === 'string' && id.length > 0);
            } else if (quote.contractorId) {
                candidates = [quote.contractorId];
            }

            // Fallback: find candidates by skill matching (for pre-matcher quotes)
            if (!candidates.length) {
                try {
                    const { findCandidateContractors } = await import('./contractor-matcher');
                    // Get category slugs from the quote's line items
                    const fullQuote = await db.select().from(personalizedQuotes)
                        .where(eq(personalizedQuotes.id, resolvedQuoteId)).limit(1);
                    if (fullQuote[0]) {
                        const lineItems = (fullQuote[0].pricingLineItems as any[]) || [];
                        const categorySlugs = [...new Set(lineItems.map((li: any) => li.categorySlug || li.category).filter(Boolean))];
                        if (categorySlugs.length > 0) {
                            const matchResult = await findCandidateContractors({ categorySlugs });
                            candidates = matchResult.candidates.map(c => c.contractorId) as any[];
                        }
                    }
                } catch (e) {
                    console.error('[PublicAPI] Fallback contractor matching failed:', e);
                }
            }

            // Diagnostic-visit fallback: a consultation quote has no line items or
            // candidate pool — it's a short assessment any active contractor can do.
            // Offer the full active roster so the booking engine can pick the nearest
            // available one. Scoped to consultation mode so regular quotes still 400.
            if (!candidates.length && quote.quoteMode === 'consultation') {
                try {
                    const { handymanProfiles } = await import('../shared/schema');
                    const activeProfiles = await db.select({ id: handymanProfiles.id })
                        .from(handymanProfiles)
                        .where(eq(handymanProfiles.availabilityStatus, 'available'));
                    candidates = activeProfiles.map(p => p.id);
                    console.log(`[PublicAPI] Visit reserve-slot: using ${candidates.length} active contractors as candidate pool`);
                } catch (e) {
                    console.error('[PublicAPI] Visit contractor fallback failed:', e);
                }
            }

            if (!candidates.length) {
                return res.status(400).json({ error: 'No candidate contractors available for this quote' });
            }
        }

        const result = await reserveSlot({
            quoteId: resolvedQuoteId,
            scheduledDate: new Date(scheduledDate),
            scheduledSlot,
            candidateContractorIds: candidates,
        });

        if (result.success) {
            res.json({
                success: true,
                lockId: result.lockId,
                contractorId: result.contractorId,
                contractorName: result.contractorName,
                expiresAt: result.expiresAt?.toISOString(),
            });
        } else {
            res.status(409).json({
                success: false,
                error: result.error,
            });
        }
    } catch (error: any) {
        console.error('[PublicAPI] Reserve slot error:', error);
        res.status(500).json({ error: 'Failed to reserve slot' });
    }
});

/**
 * POST /api/public/booking/release-slot
 *
 * Releases a previously reserved slot (e.g. customer abandons checkout).
 */
router.post('/booking/release-slot', async (req: Request, res: Response) => {
    try {
        const { lockId } = req.body;

        if (!lockId || typeof lockId !== 'number') {
            return res.status(400).json({ error: 'lockId (number) is required' });
        }

        await releaseSlot(lockId);
        res.json({ success: true });
    } catch (error: any) {
        console.error('[PublicAPI] Release slot error:', error);
        res.status(500).json({ error: 'Failed to release slot' });
    }
});

// ============================================================================
// CUSTOMER BOOKING MANAGEMENT (Reschedule, Cancel, Access Notes)
// ============================================================================

/**
 * POST /api/public/booking/:quoteId/reschedule
 * Customer reschedules their booking. Free if >48hr before scheduled date.
 */
router.post('/booking/:quoteId/reschedule', async (req: Request, res: Response) => {
    try {
        const { quoteId } = req.params;
        const { newDate, newSlot, reason } = req.body;

        if (!newDate || !newSlot) {
            return res.status(400).json({ error: 'newDate and newSlot are required' });
        }

        // Find the booking by quoteId
        const jobs = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.quoteId, quoteId))
            .limit(1);

        if (jobs.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const job = jobs[0];

        if (job.dayOfStatus === 'completed' || job.dayOfStatus === 'cancelled_day_of') {
            return res.status(400).json({ error: 'Cannot reschedule a completed or cancelled booking' });
        }

        // Check 48hr policy for free reschedule
        const scheduledDate = job.scheduledDate || job.requestedDate;
        let rescheduleFeePence = 0;
        if (scheduledDate) {
            const hoursUntilJob = (new Date(scheduledDate).getTime() - Date.now()) / (1000 * 60 * 60);
            if (hoursUntilJob < 48) {
                rescheduleFeePence = 1500; // £15 late reschedule fee
            }
        }

        // Update booking with new date/slot
        const parsedNewDate = new Date(newDate);
        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                scheduledDate: parsedNewDate,
                requestedDate: parsedNewDate,
                scheduledSlot: newSlot,
                requestedSlot: newSlot,
                dayOfStatus: 'scheduled',
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, job.id))
            .returning();

        console.log(`[PublicAPI] Booking ${job.id} rescheduled to ${newDate} (${newSlot}). Fee: ${rescheduleFeePence}p. Reason: ${reason || 'not provided'}`);

        // Notify customer (async, non-blocking)
        const { notifyCustomer } = await import('./customer-notifications');
        notifyCustomer({
            jobId: job.id,
            event: 'reschedule_confirmed',
            data: { newDate, newSlot },
        }).catch(console.error);

        res.json({
            success: true,
            job: updatedJob,
            rescheduleFeePence,
            message: rescheduleFeePence > 0
                ? `Booking rescheduled. A late reschedule fee of £${(rescheduleFeePence / 100).toFixed(2)} applies.`
                : 'Booking rescheduled successfully.',
        });
    } catch (error: any) {
        console.error('[PublicAPI] Reschedule error:', error);
        res.status(500).json({ error: error.message || 'Failed to reschedule booking' });
    }
});

/**
 * POST /api/public/booking/:quoteId/cancel
 * Customer cancels their booking. Refund depends on cancellation window:
 *   >72hr  = full refund minus £10 admin fee
 *   24-72hr = 50% refund
 *   <24hr  = no refund
 */
router.post('/booking/:quoteId/cancel', async (req: Request, res: Response) => {
    try {
        const { quoteId } = req.params;
        const { reason } = req.body;

        // Find the booking
        const jobs = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.quoteId, quoteId))
            .limit(1);

        if (jobs.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const job = jobs[0];

        if (job.dayOfStatus === 'completed') {
            return res.status(400).json({ error: 'Cannot cancel a completed booking' });
        }

        if (job.status === 'cancelled' || job.dayOfStatus === 'cancelled_day_of') {
            return res.status(400).json({ error: 'Booking is already cancelled' });
        }

        // Calculate refund based on cancellation window
        const scheduledDate = job.scheduledDate || job.requestedDate;
        let refundAmountPence = 0;
        let refundPolicy = '';
        const adminFeePence = 1000; // £10 admin fee

        // Get deposit amount from linked quote if available
        let depositPaidPence = 0;
        if (job.quoteId) {
            const quotes = await db.select({
                depositAmountPence: personalizedQuotes.depositAmountPence,
            })
                .from(personalizedQuotes)
                .where(eq(personalizedQuotes.id, job.quoteId))
                .limit(1);
            if (quotes[0]?.depositAmountPence) {
                depositPaidPence = quotes[0].depositAmountPence;
            }
        }

        if (scheduledDate) {
            const hoursUntilJob = (new Date(scheduledDate).getTime() - Date.now()) / (1000 * 60 * 60);

            if (hoursUntilJob > 72) {
                refundAmountPence = Math.max(0, depositPaidPence - adminFeePence);
                refundPolicy = 'Full refund minus £10 admin fee (cancelled >72hr before appointment)';
            } else if (hoursUntilJob > 24) {
                refundAmountPence = Math.round(depositPaidPence * 0.5);
                refundPolicy = '50% refund (cancelled 24-72hr before appointment)';
            } else {
                refundAmountPence = 0;
                refundPolicy = 'No refund (cancelled <24hr before appointment)';
            }
        } else {
            // No scheduled date — full refund minus admin fee
            refundAmountPence = Math.max(0, depositPaidPence - adminFeePence);
            refundPolicy = 'Full refund minus £10 admin fee (no scheduled date)';
        }

        // Update booking status
        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                status: 'cancelled',
                dayOfStatus: 'cancelled_day_of',
                completionNotes: `Cancelled by customer. Reason: ${reason || 'Not provided'}. Policy: ${refundPolicy}`,
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, job.id))
            .returning();

        console.log(`[PublicAPI] Booking ${job.id} cancelled. Refund: ${refundAmountPence}p. Policy: ${refundPolicy}`);

        // Notify customer (async, non-blocking)
        const { notifyCustomer } = await import('./customer-notifications');
        notifyCustomer({
            jobId: job.id,
            event: 'cancellation_confirmed',
            data: { refundAmountPence },
        }).catch(console.error);

        res.json({
            success: true,
            refundAmountPence,
            refundPolicy,
            depositPaidPence,
            message: refundAmountPence > 0
                ? `Booking cancelled. Refund of £${(refundAmountPence / 100).toFixed(2)} will be processed.`
                : 'Booking cancelled. No refund applies under our cancellation policy.',
        });
    } catch (error: any) {
        console.error('[PublicAPI] Cancel error:', error);
        res.status(500).json({ error: error.message || 'Failed to cancel booking' });
    }
});

/**
 * POST /api/public/booking/:quoteId/access-notes
 * Customer adds access instructions for the contractor.
 */
router.post('/booking/:quoteId/access-notes', async (req: Request, res: Response) => {
    try {
        const { quoteId } = req.params;
        const { accessNotes } = req.body;

        if (!accessNotes || typeof accessNotes !== 'string') {
            return res.status(400).json({ error: 'accessNotes is required' });
        }

        // Find the booking
        const jobs = await db.select()
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.quoteId, quoteId))
            .limit(1);

        if (jobs.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const job = jobs[0];

        // Update access notes on the booking
        const [updatedJob] = await db.update(contractorBookingRequests)
            .set({
                customerAccessNotes: accessNotes,
                updatedAt: new Date(),
            })
            .where(eq(contractorBookingRequests.id, job.id))
            .returning();

        // Also sync to job sheet if one exists
        try {
            const { jobSheets } = await import('../shared/schema');
            const sheets = await db.select()
                .from(jobSheets)
                .where(eq(jobSheets.jobId, job.id))
                .limit(1);

            if (sheets.length > 0) {
                await db.update(jobSheets)
                    .set({
                        accessInstructions: accessNotes,
                        updatedAt: new Date(),
                    })
                    .where(eq(jobSheets.id, sheets[0].id));
                console.log(`[PublicAPI] Access notes synced to job sheet for job ${job.id}`);
            }
        } catch (syncErr) {
            // Non-critical — job sheet sync is best-effort
            console.warn('[PublicAPI] Failed to sync access notes to job sheet:', syncErr);
        }

        console.log(`[PublicAPI] Access notes updated for booking ${job.id}`);

        res.json({
            success: true,
            message: 'Access instructions saved. Your contractor will receive them.',
        });
    } catch (error: any) {
        console.error('[PublicAPI] Access notes error:', error);
        res.status(500).json({ error: error.message || 'Failed to save access notes' });
    }
});

export default router;
