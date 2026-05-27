import { Router, Request, Response } from 'express';
import { db } from './db';
import { contractorAvailabilityDates, handymanAvailability, handymanProfiles, masterAvailability, masterBlockedDates, contractorBookingRequests, personalizedQuotes } from '../shared/schema';
import { eq, and, gte, lte, sql, inArray, or } from 'drizzle-orm';
import { getTradeForCategory } from '../shared/categories';
import { findCandidateContractors } from './contractor-matcher';
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

        // 1. Fetch Master Blocked Dates (highest priority)
        const blockedDates = await db.select()
            .from(masterBlockedDates)
            .where(and(
                gte(masterBlockedDates.date, start.toISOString().split('T')[0]),
                lte(masterBlockedDates.date, end.toISOString().split('T')[0])
            ));

        // 2. Fetch Contractor Date Overrides
        const overrides = await db.select()
            .from(contractorAvailabilityDates)
            .where(and(
                eq(contractorAvailabilityDates.contractorId, contractorId),
                gte(contractorAvailabilityDates.date, start),
                lte(contractorAvailabilityDates.date, end)
            ));

        // 3. Fetch Contractor Weekly Pattern
        const patterns = await db.select()
            .from(handymanAvailability)
            .where(eq(handymanAvailability.handymanId, contractorId));

        // 4. Fetch Master Weekly Pattern (fallback defaults)
        const masterPatterns = await db.select()
            .from(masterAvailability)
            .where(eq(masterAvailability.isActive, true));

        // 5. Merge Logic (Priority: Master Blocked > Contractor Override > Contractor Pattern > Master Pattern)
        const result = [];
        for (let i = 0; i < days; i++) {
            const date = new Date(start);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            const dayOfWeek = date.getDay(); // 0-6

            // Check master blocked dates (highest priority)
            const blocked = blockedDates.find(b => b.date === dateStr);
            if (blocked) {
                result.push({
                    date: dateStr,
                    isAvailable: false,
                    source: 'master_blocked',
                    reason: blocked.reason
                });
                continue;
            }

            // Check contractor date override
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
                // Check contractor pattern
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
                    // Check master pattern (fallback default)
                    const masterPattern = masterPatterns.find(p => p.dayOfWeek === dayOfWeek);
                    if (masterPattern) {
                        result.push({
                            date: dateStr,
                            isAvailable: true,
                            source: 'master_pattern',
                            startTime: masterPattern.startTime,
                            endTime: masterPattern.endTime
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
            const { SLOT_TIMES } = await import('../shared/slot-times');
            switch (mode) {
                case 'am':
                    finalIsAvailable = true;
                    startTime = SLOT_TIMES.am.start;
                    endTime = SLOT_TIMES.am.end;
                    break;
                case 'pm':
                    finalIsAvailable = true;
                    startTime = SLOT_TIMES.pm.start;
                    endTime = SLOT_TIMES.pm.end;
                    break;
                case 'full':
                    finalIsAvailable = true;
                    startTime = SLOT_TIMES.full_day.start;
                    endTime = SLOT_TIMES.full_day.end;
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
            console.log(`[CONTRACTOR_WRITE_DBG] UPDATE cid=${contractorId} date=${targetDate.toISOString()} mode=${mode} isAvail=${finalIsAvailable} ${startTime ?? '—'}-${endTime ?? '—'} rowId=${existing[0].id}`);
            await db.update(contractorAvailabilityDates)
                .set({
                    isAvailable: finalIsAvailable,
                    startTime,
                    endTime
                })
                .where(eq(contractorAvailabilityDates.id, existing[0].id));
        } else {
            // Insert
            console.log(`[CONTRACTOR_WRITE_DBG] INSERT cid=${contractorId} date=${targetDate.toISOString()} mode=${mode} isAvail=${finalIsAvailable} ${startTime ?? '—'}-${endTime ?? '—'}`);
            await db.insert(contractorAvailabilityDates).values({
                id: uuidv4(),
                contractorId,
                date: targetDate,
                isAvailable: finalIsAvailable,
                startTime,
                endTime
            });
        }

        // Update availability freshness timestamp
        try {
            await db.update(handymanProfiles)
                .set({ lastAvailabilityRefresh: new Date() })
                .where(eq(handymanProfiles.id, contractorId));
        } catch (refreshErr) {
            console.warn('[Availability] Failed to update freshness timestamp:', refreshErr);
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

// ==========================================
// MASTER AVAILABILITY ADMIN ROUTES
// ==========================================

// Create a separate admin router for master availability
export const adminAvailabilityRouter = Router();

// GET /api/admin/availability/matrix?from=YYYY-MM-DD&days=14
// Manual ops dashboard: every contractor with skills (→ broad trades), their
// date-specific availability overrides, weekly patterns, and bookings
// (contractorJobs) within a date range. Read-only aggregation; saving reuses
// PUT /api/admin/contractors/:id/availability.
adminAvailabilityRouter.get('/matrix', async (req: Request, res: Response) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days as string) || 14, 1), 42);
        const fromStr = req.query.from as string | undefined;
        // Parse 'from' as UTC midnight so a YYYY-MM-DD query returns the SAME
        // calendar day everywhere (previously setHours() converted to local
        // midnight, which on UTC+1 viewers landed on the previous UTC day and
        // caused an off-by-one in the response's echoed `from`).
        const start = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : new Date();
        if (!fromStr) start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + days);
        end.setUTCHours(23, 59, 59, 999);
        // [MATRIX_DBG] Phase 22a boundary log — remove once availability divergence is fixed.
        console.log(`[MATRIX_DBG] window from=${start.toISOString()} to=${end.toISOString()} days=${days}`);

        const profiles = await db.query.handymanProfiles.findMany({
            with: { user: true, skills: true },
        });
        const ids = profiles.map(p => p.id);

        let overrides: any[] = [], jobs: any[] = [], patterns: any[] = [];
        if (ids.length) {
            [overrides, jobs, patterns] = await Promise.all([
                db.select().from(contractorAvailabilityDates).where(and(
                    inArray(contractorAvailabilityDates.contractorId, ids),
                    gte(contractorAvailabilityDates.date, start),
                    lte(contractorAvailabilityDates.date, end),
                )),
                db.select().from(contractorBookingRequests).where(and(
                    or(inArray(contractorBookingRequests.assignedContractorId, ids), inArray(contractorBookingRequests.contractorId, ids)),
                    gte(contractorBookingRequests.scheduledDate, start),
                    lte(contractorBookingRequests.scheduledDate, end),
                )),
                db.select().from(handymanAvailability).where(
                    inArray(handymanAvailability.handymanId, ids),
                ),
            ]);
        }

        const toDateStr = (d: Date | string) => new Date(d).toISOString().split('T')[0];
        const toMin = (t?: string | null): number | null => { if (!t) return null; const [h, m] = t.split(':').map(Number); return (h * 60) + (m || 0); };

        // Source per-job duration AND customer coords from the linked quote.
        // Coords either come from the quote row directly or get geocoded from
        // postcode (and backfilled to the row so we only pay the geocode cost
        // once per quote).
        const quoteIds = Array.from(new Set(jobs.map((j: any) => j.quoteId).filter(Boolean)));
        const quoteMinutes = new Map<string, number>();
        const quoteCoords = new Map<string, { lat: number; lng: number }>();
        if (quoteIds.length) {
            const quoteRows = await db.select({
                id: personalizedQuotes.id,
                lines: personalizedQuotes.pricingLineItems,
                coordinates: personalizedQuotes.coordinates,
                postcode: personalizedQuotes.postcode,
            }).from(personalizedQuotes).where(inArray(personalizedQuotes.id, quoteIds as string[]));

            const needsGeocoding: Array<{ id: string; postcode: string }> = [];
            const { sumLineItemsForScheduling } = await import('../shared/scheduling-caps');
            for (const q of quoteRows) {
                const lines: any[] = Array.isArray(q.lines) ? (q.lines as any[]) : [];
                const mins = sumLineItemsForScheduling(lines);
                if (mins > 0) quoteMinutes.set(q.id, mins);
                const c = q.coordinates as any;
                if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
                    quoteCoords.set(q.id, { lat: c.lat, lng: c.lng });
                } else if (q.postcode) {
                    needsGeocoding.push({ id: q.id, postcode: q.postcode });
                }
            }

            // Backfill missing coords by geocoding the postcode. Done in parallel
            // since each geocode hits an external API (postcodes.io is fast).
            if (needsGeocoding.length > 0) {
                const { geocodeAddress } = await import('./lib/geocoding');
                await Promise.all(needsGeocoding.map(async ({ id, postcode }) => {
                    try {
                        const geo = await geocodeAddress(postcode);
                        if (geo) {
                            quoteCoords.set(id, { lat: geo.lat, lng: geo.lng });
                            // Persist so we never have to geocode this quote again
                            await db.update(personalizedQuotes).set({ coordinates: { lat: geo.lat, lng: geo.lng } as any }).where(eq(personalizedQuotes.id, id));
                        }
                    } catch (e) {
                        console.warn(`[Matrix] backfill geocode failed for quote ${id}: ${e instanceof Error ? e.message : e}`);
                    }
                }));
            }
        }

        // Per-contractor travel-time lookups (bulk, one Routes API call per
        // contractor with non-zero jobs, falls back to haversine).
        const { getTravelTimesFromOrigin } = await import('./lib/travel-time');
        const travelByContractor = new Map<string, Map<string, { minutes: number; source: string }>>();
        await Promise.all(profiles.map(async (p) => {
            const cid = p.id;
            const myJobs = jobs.filter((j: any) => {
                const jc = j.assignedContractorId || j.contractorId;
                return jc === cid && j.quoteId && quoteCoords.has(j.quoteId);
            });
            if (myJobs.length === 0) return;
            const cLat = p.latitude ? parseFloat(p.latitude) : NaN;
            const cLng = p.longitude ? parseFloat(p.longitude) : NaN;
            if (isNaN(cLat) || isNaN(cLng)) return;
            const destinations = myJobs.map((j: any) => {
                const c = quoteCoords.get(j.quoteId)!;
                return { lat: c.lat, lng: c.lng, key: j.quoteId as string };
            });
            const lookup = await getTravelTimesFromOrigin(cLat, cLng, destinations);
            travelByContractor.set(cid, lookup);
        }));

        // [MATRIX_DBG] Per-contractor summary so we can diff against /fit
        for (const p of profiles) {
            const oCount = overrides.filter(o => o.contractorId === p.id).length;
            const jCount = jobs.filter((j: any) => (j.assignedContractorId || j.contractorId) === p.id).length;
            const pCount = patterns.filter(pat => pat.handymanId === p.id && pat.isActive).length;
            if (oCount + jCount + pCount > 0) {
                console.log(`[MATRIX_DBG] cid=${p.id} name="${[p.user?.firstName, p.user?.lastName].filter(Boolean).join(' ').trim() || p.businessName}" overrides=${oCount} jobs=${jCount} patterns=${pCount}`);
                if (oCount > 0) {
                    for (const o of overrides.filter(o => o.contractorId === p.id)) {
                        console.log(`[MATRIX_DBG]   ovr ${toDateStr(o.date)} avail=${o.isAvailable} ${o.startTime ?? '—'}-${o.endTime ?? '—'}`);
                    }
                }
                if (jCount > 0) {
                    for (const j of jobs.filter((j: any) => (j.assignedContractorId || j.contractorId) === p.id)) {
                        console.log(`[MATRIX_DBG]   job ${toDateStr(j.scheduledDate)} slot=${j.scheduledSlot} assignStatus=${j.assignmentStatus} status=${j.status}`);
                    }
                }
            }
        }

        const contractors = profiles.map(p => {
            const fullName = [p.user?.firstName, p.user?.lastName].filter(Boolean).join(' ').trim();
            const trades = Array.from(new Set(
                (p.skills || [])
                    .map(s => s.categorySlug ? getTradeForCategory(s.categorySlug as any) : null)
                    .filter((t): t is NonNullable<typeof t> => Boolean(t))
            ));

            return {
                id: p.id,
                name: fullName || p.businessName || p.user?.email || 'Unknown',
                postcode: p.postcode || null,
                availabilityStatus: p.availabilityStatus || 'available',
                trades,
                skillCount: (p.skills || []).length,
                weeklyPatterns: patterns
                    .filter(pat => pat.handymanId === p.id && pat.isActive && pat.dayOfWeek != null)
                    .map(pat => ({ dayOfWeek: pat.dayOfWeek as number, startTime: pat.startTime, endTime: pat.endTime })),
                overrides: overrides
                    .filter(o => o.contractorId === p.id)
                    .map(o => ({ date: toDateStr(o.date), isAvailable: o.isAvailable, startTime: o.startTime, endTime: o.endTime, notes: o.notes })),
                jobs: jobs
                    .filter((j: any) => {
                        const cid = j.assignedContractorId || j.contractorId;
                        if (cid !== p.id || !j.scheduledDate) return false;
                        return ['assigned', 'accepted', 'in_progress', 'completed'].includes(j.assignmentStatus) || ['accepted', 'completed'].includes(j.status);
                    })
                    .map((j: any) => {
                        const slot = j.scheduledSlot === 'full_day' ? 'full' : (j.scheduledSlot === 'am' || j.scheduledSlot === 'pm') ? j.scheduledSlot : (j.scheduledStartTime ? (j.scheduledStartTime >= '12:00' ? 'pm' : 'am') : 'full');
                        const sM = toMin(j.scheduledStartTime), eM = toMin(j.scheduledEndTime);
                        const durationMinutes = (sM != null && eM != null && eM > sM) ? (eM - sM)
                            : (j.quoteId && quoteMinutes.get(j.quoteId)) ? (quoteMinutes.get(j.quoteId) as number)
                                : (j.scheduledSlot === 'full_day' ? 480 : (j.scheduledSlot === 'am' || j.scheduledSlot === 'pm') ? 240 : 120);
                        const start = j.scheduledStartTime || (slot === 'pm' ? '14:00' : '09:00');
                        const tt = travelByContractor.get(p.id)?.get(j.quoteId);
                        return {
                            date: toDateStr(j.scheduledDate),
                            slot,
                            start,
                            durationMinutes,
                            status: j.assignmentStatus || j.status,
                            customerName: j.customerName,
                            jobDescription: j.description,
                            scheduledTime: j.scheduledStartTime || j.requestedSlot,
                            travelMinutes: tt?.minutes ?? null,
                            travelSource: tt?.source ?? null,
                        };
                    }),
            };
        });

        res.json({ from: toDateStr(start), days, contractors });
    } catch (error) {
        console.error('[AdminAvailability] matrix error:', error);
        res.status(500).json({ error: 'Failed to load availability matrix' });
    }
});

// GET /api/admin/availability/master
// Get master weekly pattern settings
// GET /api/admin/availability/fit?categories=a,b&lat=..&lng=..&days=14
// Quote-builder INFORM panel: which contractors FIT (skill coverage + within
// service radius of the customer) for these job categories, and their available
// days. Read-only — reuses findCandidateContractors; does NOT drive customer dates.
adminAvailabilityRouter.get('/fit', async (req: Request, res: Response) => {
    try {
        const categorySlugs = ((req.query.categories as string) || '')
            .split(',').map(c => c.trim()).filter(Boolean);
        const latRaw = req.query.lat ? parseFloat(req.query.lat as string) : NaN;
        const lngRaw = req.query.lng ? parseFloat(req.query.lng as string) : NaN;
        const days = Math.min(Math.max(parseInt(req.query.days as string) || 14, 1), 42);

        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + days);
        const dateKey = (d: Date | string) => new Date(d).toISOString().split('T')[0];

        // [FIT_DBG] Phase 22a boundary log
        console.log(`[FIT_DBG] window from=${start.toISOString()} to=${end.toISOString()} days=${days} categories=${categorySlugs.join(',')} lat=${latRaw} lng=${lngRaw}`);

        if (categorySlugs.length === 0) {
            console.log('[FIT_DBG] no categories — short-circuit empty');
            return res.json({ candidates: [], fullCoverageCandidates: 0, partialCoverageCandidates: 0, uncoveredCategories: [], from: dateKey(start), days });
        }

        const match = await findCandidateContractors({
            categorySlugs,
            customerLat: !isNaN(latRaw) ? latRaw : undefined,
            customerLng: !isNaN(lngRaw) ? lngRaw : undefined,
        });

        // Phase 22b — the fit panel must only show contractors who cover EVERY
        // requested category. Partial-coverage candidates can't complete the
        // full job, so leaking them through would let the admin assign work
        // that can't be delivered. Partial counts + uncoveredCategories are
        // still returned so the UI can surface "no one covers X, split the
        // quote" guidance.
        const fullCoverageOnly = match.candidates.filter((c) => c.coveragePercent === 100);
        const droppedPartials = match.candidates.length - fullCoverageOnly.length;
        if (droppedPartials > 0) {
            console.log(`[FIT_DBG] dropping ${droppedPartials} partial-coverage candidates — keeping ${fullCoverageOnly.length} full-coverage`);
        }
        match.candidates = fullCoverageOnly;

        const ids = match.candidates.map(c => c.contractorId);
        let overrides: any[] = [], jobs: any[] = [], patterns: any[] = [];
        if (ids.length) {
            [overrides, jobs, patterns] = await Promise.all([
                db.select().from(contractorAvailabilityDates).where(and(
                    inArray(contractorAvailabilityDates.contractorId, ids),
                    gte(contractorAvailabilityDates.date, start),
                    lte(contractorAvailabilityDates.date, end),
                )),
                db.select().from(contractorBookingRequests).where(and(
                    or(inArray(contractorBookingRequests.assignedContractorId, ids), inArray(contractorBookingRequests.contractorId, ids)),
                    gte(contractorBookingRequests.scheduledDate, start),
                    lte(contractorBookingRequests.scheduledDate, end),
                )),
                db.select().from(handymanAvailability).where(inArray(handymanAvailability.handymanId, ids)),
            ]);
        }

        const { slotFromWindow } = await import('../shared/slot-times');
        const slotOf = (o: any): string => {
            const s = slotFromWindow(o.startTime, o.endTime);
            return s === 'full_day' ? 'full' : s === 'other' ? 'full' : s;
        };

        const candidates = match.candidates.map(cand => {
            const id = cand.contractorId;
            const cOverrides = overrides.filter(o => o.contractorId === id);
            const booked = new Set(jobs
                .filter((j: any) => {
                    const cid = j.assignedContractorId || j.contractorId;
                    if (cid !== id || !j.scheduledDate) return false;
                    return ['assigned', 'accepted', 'in_progress', 'completed'].includes(j.assignmentStatus) || ['accepted', 'completed'].includes(j.status);
                })
                .map((j: any) => dateKey(j.scheduledDate)));
            const cPatterns = patterns.filter(p => p.handymanId === id && p.isActive && p.dayOfWeek != null);

            // [FIT_DBG] Per-candidate inputs
            console.log(`[FIT_DBG] cand=${id} name="${cand.contractorName}" overrides=${cOverrides.length} bookedDates=${[...booked].join(',') || '—'} patterns=${cPatterns.length}`);
            for (const o of cOverrides) {
                console.log(`[FIT_DBG]   ovr ${dateKey(o.date)} avail=${o.isAvailable} ${o.startTime ?? '—'}-${o.endTime ?? '—'}`);
            }

            const availableDays: { date: string; slot: string }[] = [];
            for (let i = 0; i < days; i++) {
                const d = new Date(start);
                d.setUTCDate(start.getUTCDate() + i);
                const ds = dateKey(d);
                if (booked.has(ds)) { console.log(`[FIT_DBG]   skip ${ds} reason=booked`); continue; }
                const ov = cOverrides.find(o => dateKey(o.date) === ds);
                if (ov) {
                    if (ov.isAvailable) {
                        availableDays.push({ date: ds, slot: slotOf(ov) });
                        console.log(`[FIT_DBG]   keep ${ds} reason=override slot=${slotOf(ov)}`);
                    } else {
                        console.log(`[FIT_DBG]   skip ${ds} reason=override-off`);
                    }
                } else {
                    const pat = cPatterns.find(p => p.dayOfWeek === d.getUTCDay());
                    if (pat) {
                        availableDays.push({ date: ds, slot: 'full' });
                        console.log(`[FIT_DBG]   keep ${ds} reason=pattern dow=${d.getUTCDay()}`);
                    }
                    // else: silently skip (no override, no pattern) — too noisy to log every empty day
                }
            }
            console.log(`[FIT_DBG] cand=${id} final availableDays=${availableDays.map(a => a.date + '/' + a.slot).join(',') || '∅'}`);

            return {
                contractorId: id,
                name: cand.contractorName,
                distanceMiles: cand.distanceMiles != null ? Math.round(cand.distanceMiles * 10) / 10 : null,
                coveragePercent: cand.coveragePercent,
                coveredCategories: cand.coveredCategories,
                availableDays,
            };
        });

        res.json({
            candidates,
            fullCoverageCandidates: match.fullCoverageCandidates,
            partialCoverageCandidates: match.partialCoverageCandidates,
            uncoveredCategories: match.uncoveredCategories,
            from: dateKey(start),
            days,
        });
    } catch (error) {
        console.error('[AdminAvailability] fit error:', error);
        res.status(500).json({ error: 'Failed to compute contractor fit' });
    }
});

adminAvailabilityRouter.get('/master', async (req: Request, res: Response) => {
    try {
        const patterns = await db.select()
            .from(masterAvailability)
            .orderBy(masterAvailability.dayOfWeek);

        res.json(patterns);
    } catch (error) {
        console.error('Failed to fetch master availability:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/availability/master
// Update master weekly pattern
adminAvailabilityRouter.post('/master', async (req: Request, res: Response) => {
    try {
        const { patterns } = req.body;
        // patterns: [{ dayOfWeek: 0-6, startTime: 'HH:mm', endTime: 'HH:mm', isActive: boolean }]

        if (!Array.isArray(patterns)) {
            return res.status(400).json({ error: 'patterns array required' });
        }

        await db.transaction(async (tx) => {
            // Delete existing patterns
            await tx.delete(masterAvailability);

            // Insert new patterns
            for (const pattern of patterns) {
                if (pattern.dayOfWeek >= 0 && pattern.dayOfWeek <= 6) {
                    await tx.insert(masterAvailability).values({
                        dayOfWeek: pattern.dayOfWeek,
                        startTime: pattern.startTime || '09:00',
                        endTime: pattern.endTime || '17:00',
                        isActive: pattern.isActive !== false,
                    });
                }
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to update master availability:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/availability/blocked-dates
// List all master blocked dates
adminAvailabilityRouter.get('/blocked-dates', async (req: Request, res: Response) => {
    try {
        const blocked = await db.select()
            .from(masterBlockedDates)
            .orderBy(masterBlockedDates.date);

        res.json(blocked);
    } catch (error) {
        console.error('Failed to fetch blocked dates:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/availability/blocked-dates
// Add a new blocked date
adminAvailabilityRouter.post('/blocked-dates', async (req: Request, res: Response) => {
    try {
        const { date, reason } = req.body;

        if (!date) {
            return res.status(400).json({ error: 'date required' });
        }

        const [inserted] = await db.insert(masterBlockedDates)
            .values({
                date,
                reason: reason || null,
            })
            .returning();

        res.json(inserted);
    } catch (error) {
        console.error('Failed to add blocked date:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/availability/blocked-dates/toggle
// Toggle a date's blocked status (block if unblocked, unblock if blocked)
adminAvailabilityRouter.post('/blocked-dates/toggle', async (req: Request, res: Response) => {
    try {
        const { date } = req.body;

        if (!date) {
            return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
        }

        // Check if date is already blocked
        const existing = await db.select()
            .from(masterBlockedDates)
            .where(eq(masterBlockedDates.date, date))
            .limit(1);

        if (existing.length > 0) {
            // Date is blocked -> unblock it (delete)
            await db.delete(masterBlockedDates)
                .where(eq(masterBlockedDates.id, existing[0].id));

            return res.json({
                action: 'unblocked',
                date,
            });
        } else {
            // Date is not blocked -> block it (insert)
            const [inserted] = await db.insert(masterBlockedDates)
                .values({
                    date,
                    reason: null,
                })
                .returning();

            return res.json({
                action: 'blocked',
                date,
                id: inserted.id,
            });
        }
    } catch (error) {
        console.error('Failed to toggle blocked date:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/admin/availability/blocked-dates/:id
// Remove a blocked date
adminAvailabilityRouter.delete('/blocked-dates/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const numId = parseInt(id);

        if (isNaN(numId)) {
            return res.status(400).json({ error: 'Invalid id' });
        }

        await db.delete(masterBlockedDates)
            .where(eq(masterBlockedDates.id, numId));

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete blocked date:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;
