/**
 * Daily Planner API — Dispatch Grouping View
 *
 * Provides endpoints for the dispatcher to:
 * 1. View confirmed/pending quotes grouped by date and postcode area
 * 2. Reassign contractors to optimise routing
 * 3. See contractor availability and current load
 */

import { Router, Request, Response } from 'express';
import { db } from './db';
import { personalizedQuotes, handymanProfiles, handymanSkills, users, contractorBookingRequests, leads } from '../shared/schema';
import { eq, and, gte, lte, isNotNull, isNull, sql, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { sendJobAssignmentEmail } from './email-service';
import { sendWhatsAppMessage } from './meta-whatsapp';
import {
  generateSmartGrouping,
  extractJobCategories,
  type PoolJob,
  type Contractor,
} from './smart-planner-engine';

const router = Router();

/**
 * GET /api/admin/daily-planner?from=2026-04-14&to=2026-04-20
 *
 * Returns quotes grouped by date, then by postcode prefix (NG1, NG2, etc.)
 * Includes contractor assignment info and job details.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const fromDate = req.query.from as string;
    const toDate = req.query.to as string;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
    }

    // Fetch quotes that are either:
    // 1. Booked (bookedAt is set) with selectedDate in range
    // 2. Have a selectedDate in range (pending acceptance)
    // 3. Recently created with no date yet (for "unscheduled" pool)
    const from = new Date(fromDate);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    // Get all quotes with a selectedDate in range, OR booked quotes in range
    const quotes = await db
      .select({
        id: personalizedQuotes.id,
        shortSlug: personalizedQuotes.shortSlug,
        customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        coordinates: personalizedQuotes.coordinates,
        jobDescription: personalizedQuotes.jobDescription,
        selectedDate: personalizedQuotes.selectedDate,
        timeSlotType: personalizedQuotes.timeSlotType,
        bookedAt: personalizedQuotes.bookedAt,
        depositPaidAt: personalizedQuotes.depositPaidAt,
        contractorId: personalizedQuotes.contractorId,
        matchedContractorName: personalizedQuotes.matchedContractorName,
        contextualHeadline: personalizedQuotes.contextualHeadline,
        pricingLineItems: personalizedQuotes.pricingLineItems,
        lineItemsJson: sql`${personalizedQuotes.pricingLineItems}`,
        layoutTier: personalizedQuotes.layoutTier,
        createdAt: personalizedQuotes.createdAt,
        availableDates: personalizedQuotes.availableDates,
        dateTimePreferences: personalizedQuotes.dateTimePreferences,
        deliveryStatus: personalizedQuotes.deliveryStatus,
        viewCount: personalizedQuotes.viewCount,
        revokedAt: personalizedQuotes.revokedAt,
      })
      .from(personalizedQuotes)
      .where(
        and(
          // Not revoked
          sql`${personalizedQuotes.revokedAt} IS NULL`,
          // Has a date in range OR was created in range and has no date
          sql`(
            (${personalizedQuotes.selectedDate} >= ${from} AND ${personalizedQuotes.selectedDate} <= ${to})
            OR (${personalizedQuotes.bookedAt} IS NOT NULL AND ${personalizedQuotes.createdAt} >= ${from} AND ${personalizedQuotes.createdAt} <= ${to})
            OR (${personalizedQuotes.availableDates} IS NOT NULL AND ${personalizedQuotes.createdAt} >= ${new Date(fromDate)} AND ${personalizedQuotes.createdAt} <= ${to})
          )`
        )
      )
      .orderBy(personalizedQuotes.selectedDate, personalizedQuotes.createdAt);

    // Get all contractors with their skills and home postcode
    const contractors = await db
      .select({
        id: handymanProfiles.id,
        userId: handymanProfiles.userId,
        businessName: handymanProfiles.businessName,
        profileImageUrl: handymanProfiles.profileImageUrl,
        availabilityStatus: handymanProfiles.availabilityStatus,
        city: handymanProfiles.city,
        postcode: handymanProfiles.postcode,
        radiusMiles: handymanProfiles.radiusMiles,
      })
      .from(handymanProfiles)
      .where(sql`${handymanProfiles.availabilityStatus} != 'inactive'`);

    // Get contractor names from users table
    const contractorUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(
        sql`${users.id} IN (${sql.join(
          contractors.map(c => sql`${c.userId}`),
          sql`, `
        )})`
      );

    const userNameMap = new Map(contractorUsers.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown']));

    // Get skills for each contractor
    const allSkills = await db
      .select({
        handymanId: handymanSkills.handymanId,
        categorySlug: handymanSkills.categorySlug,
      })
      .from(handymanSkills);

    const skillsByContractor = new Map<string, string[]>();
    for (const skill of allSkills) {
      const existing = skillsByContractor.get(skill.handymanId) || [];
      existing.push(skill.categorySlug);
      skillsByContractor.set(skill.handymanId, existing);
    }

    // Build contractor list with names and skills
    const contractorList = contractors.map(c => ({
      id: c.id,
      name: userNameMap.get(c.userId ?? '') || c.businessName || 'Unknown',
      profileImageUrl: c.profileImageUrl,
      availabilityStatus: c.availabilityStatus,
      homePostcode: c.postcode,
      city: c.city,
      radiusMiles: c.radiusMiles,
      skills: skillsByContractor.get(c.id) || [],
    }));

    // Extract postcode prefix (e.g., "NG9" from "NG9 2AB")
    const getPostcodePrefix = (postcode: string | null): string => {
      if (!postcode) return 'UNKNOWN';
      const match = postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d{1,2})/);
      return match ? match[1] : 'UNKNOWN';
    };

    // Parse line items to get total time and estimated value
    const parseLineItems = (lineItems: any): { totalMinutes: number; totalPence: number; categories: string[]; itemCount: number } => {
      if (!lineItems || !Array.isArray(lineItems)) return { totalMinutes: 60, totalPence: 0, categories: [], itemCount: 0 };
      let totalMinutes = 0;
      let totalPence = 0;
      const categories: string[] = [];
      for (const item of lineItems) {
        totalMinutes += item.timeEstimateMinutes || item.time_estimate_minutes || 60;
        totalPence += item.guardedPricePence || item.guarded_price_pence || item.pricePence || 0;
        if (item.category) categories.push(item.category);
      }
      return { totalMinutes, totalPence, categories, itemCount: lineItems.length };
    };

    // Group quotes by date
    const dateGroups = new Map<string, any[]>();

    for (const q of quotes) {
      const postcodePrefix = getPostcodePrefix(q.postcode);
      const lineItemData = parseLineItems(q.pricingLineItems);
      const status = q.depositPaidAt ? 'paid' : q.bookedAt ? 'booked' : q.viewCount && q.viewCount > 0 ? 'viewed' : q.deliveryStatus === 'delivered' ? 'sent' : 'pending';

      // Helper to get per-date time slot from dateTimePreferences
      const getTimeSlotForDate = (dateStr: string): string => {
        if (q.dateTimePreferences && Array.isArray(q.dateTimePreferences)) {
          const pref = (q.dateTimePreferences as { date: string; timeSlot: string }[])
            .find(p => p.date === dateStr);
          if (pref) return pref.timeSlot;
        }
        return q.timeSlotType || 'flexible';
      };

      const buildQuoteData = (dateKey: string) => ({
        id: q.id,
        shortSlug: q.shortSlug,
        customerName: q.customerName,
        phone: q.phone,
        postcode: q.postcode,
        postcodePrefix,
        address: q.address,
        coordinates: q.coordinates,
        jobDescription: q.jobDescription,
        headline: q.contextualHeadline,
        selectedDate: q.selectedDate,
        timeSlot: getTimeSlotForDate(dateKey),
        availableDates: q.availableDates,
        dateTimePreferences: q.dateTimePreferences,
        status,
        contractorId: q.contractorId,
        contractorName: q.matchedContractorName,
        totalMinutes: lineItemData.totalMinutes,
        totalPence: lineItemData.totalPence,
        categories: lineItemData.categories,
        itemCount: lineItemData.itemCount,
        createdAt: q.createdAt,
        isBufferDate: !q.selectedDate && q.availableDates && (q.availableDates as string[]).length > 1,
      });

      if (q.selectedDate) {
        // Confirmed single date
        const dateKey = new Date(q.selectedDate).toISOString().split('T')[0];
        if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, []);
        dateGroups.get(dateKey)!.push(buildQuoteData(dateKey));
      } else if (q.availableDates && Array.isArray(q.availableDates) && (q.availableDates as string[]).length > 0) {
        // 3-date buffer: show quote on ALL preferred dates for clustering
        for (const dateStr of q.availableDates as string[]) {
          if (!dateGroups.has(dateStr)) dateGroups.set(dateStr, []);
          dateGroups.get(dateStr)!.push(buildQuoteData(dateStr));
        }
      } else {
        if (!dateGroups.has('UNSCHEDULED')) dateGroups.set('UNSCHEDULED', []);
        dateGroups.get('UNSCHEDULED')!.push(buildQuoteData('UNSCHEDULED'));
      }
    }

    // For each date, group by postcode prefix
    const result: any[] = [];
    for (const [dateKey, dateQuotes] of dateGroups) {
      const postcodeGroups = new Map<string, any[]>();
      for (const q of dateQuotes) {
        if (!postcodeGroups.has(q.postcodePrefix)) {
          postcodeGroups.set(q.postcodePrefix, []);
        }
        postcodeGroups.get(q.postcodePrefix)!.push(q);
      }

      const clusters = Array.from(postcodeGroups.entries()).map(([prefix, jobs]) => ({
        postcodePrefix: prefix,
        jobCount: jobs.length,
        totalMinutes: jobs.reduce((sum: number, j: any) => sum + j.totalMinutes, 0),
        totalValuePence: jobs.reduce((sum: number, j: any) => sum + j.totalPence, 0),
        categories: [...new Set(jobs.flatMap((j: any) => j.categories))],
        assignedContractorId: jobs[0]?.contractorId || null, // Most common contractor in cluster
        jobs,
      }));

      // Sort clusters by job count descending (biggest clusters first)
      clusters.sort((a, b) => b.jobCount - a.jobCount);

      result.push({
        date: dateKey,
        totalJobs: dateQuotes.length,
        totalMinutes: dateQuotes.reduce((sum: number, j: any) => sum + j.totalMinutes, 0),
        totalValuePence: dateQuotes.reduce((sum: number, j: any) => sum + j.totalPence, 0),
        clusters,
      });
    }

    // Sort by date
    result.sort((a, b) => {
      if (a.date === 'UNSCHEDULED') return 1;
      if (b.date === 'UNSCHEDULED') return -1;
      return a.date.localeCompare(b.date);
    });

    res.json({
      from: fromDate,
      to: toDate,
      days: result,
      contractors: contractorList,
    });
  } catch (error: any) {
    console.error('Daily planner error:', error);
    res.status(500).json({ error: 'Failed to load daily planner data', details: error.message });
  }
});

/**
 * POST /api/admin/daily-planner/assign
 *
 * Reassign a contractor to a specific quote.
 */
router.post('/assign', async (req: Request, res: Response) => {
  try {
    const { quoteId, contractorId } = req.body;

    if (!quoteId) {
      return res.status(400).json({ error: 'quoteId required' });
    }

    // Get contractor name if assigning
    let contractorName = null;
    if (contractorId) {
      const contractor = await db
        .select({ userId: handymanProfiles.userId, businessName: handymanProfiles.businessName })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, contractorId))
        .limit(1);

      if (contractor.length > 0) {
        const user = await db
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, contractor[0].userId!))
          .limit(1);
        contractorName = [user[0]?.firstName, user[0]?.lastName].filter(Boolean).join(' ') || contractor[0].businessName;
      }
    }

    await db
      .update(personalizedQuotes)
      .set({
        contractorId: contractorId || null,
        matchedContractorName: contractorName,
      })
      .where(eq(personalizedQuotes.id, quoteId));

    res.json({ success: true, contractorId, contractorName });
  } catch (error: any) {
    console.error('Assignment error:', error);
    res.status(500).json({ error: 'Failed to assign contractor' });
  }
});

/**
 * POST /api/admin/daily-planner/assign-cluster
 *
 * Assign a contractor to all quotes in a postcode cluster for a given date.
 */
router.post('/assign-cluster', async (req: Request, res: Response) => {
  try {
    const { quoteIds, contractorId } = req.body;

    if (!quoteIds || !Array.isArray(quoteIds) || quoteIds.length === 0) {
      return res.status(400).json({ error: 'quoteIds array required' });
    }

    // Get contractor name
    let contractorName = null;
    if (contractorId) {
      const contractor = await db
        .select({ userId: handymanProfiles.userId, businessName: handymanProfiles.businessName })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, contractorId))
        .limit(1);

      if (contractor.length > 0) {
        const user = await db
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, contractor[0].userId!))
          .limit(1);
        contractorName = [user[0]?.firstName, user[0]?.lastName].filter(Boolean).join(' ') || contractor[0].businessName;
      }
    }

    // Update all quotes in the cluster
    for (const quoteId of quoteIds) {
      await db
        .update(personalizedQuotes)
        .set({
          contractorId: contractorId || null,
          matchedContractorName: contractorName,
        })
        .where(eq(personalizedQuotes.id, quoteId));
    }

    res.json({ success: true, updated: quoteIds.length, contractorId, contractorName });
  } catch (error: any) {
    console.error('Cluster assignment error:', error);
    res.status(500).json({ error: 'Failed to assign cluster' });
  }
});

// ─── GET /pool — All deposit-paid quotes (awaiting dispatch + dispatched) ───

router.get('/pool', async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: personalizedQuotes.id,
        customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        email: personalizedQuotes.email,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        coordinates: personalizedQuotes.coordinates,
        jobDescription: personalizedQuotes.jobDescription,
        basePrice: personalizedQuotes.basePrice,
        depositPaidAt: personalizedQuotes.depositPaidAt,
        bookedAt: personalizedQuotes.bookedAt,
        selectedDate: personalizedQuotes.selectedDate,
        timeSlotType: personalizedQuotes.timeSlotType,
        availableDates: personalizedQuotes.availableDates,
        dateTimePreferences: personalizedQuotes.dateTimePreferences,
        contextualHeadline: personalizedQuotes.contextualHeadline,
        segment: personalizedQuotes.segment,
        matchedContractorId: personalizedQuotes.matchedContractorId,
        createdAt: personalizedQuotes.createdAt,
      })
      .from(personalizedQuotes)
      .where(isNotNull(personalizedQuotes.depositPaidAt))
      .orderBy(desc(personalizedQuotes.depositPaidAt));

    res.json(rows);
  } catch (error: any) {
    console.error('[Daily Planner] Failed to fetch pool:', error);
    res.status(500).json({ error: 'Failed to fetch pool jobs' });
  }
});

// ─── POST /confirm-dispatch — Pick date, assign contractor, notify customer ───

router.post('/confirm-dispatch', async (req: Request, res: Response) => {
  try {
    const { quoteId, confirmedDate, confirmedSlot, contractorId } = req.body;

    // 1. Validate inputs
    if (!quoteId || !confirmedDate || !confirmedSlot || !contractorId) {
      return res.status(400).json({
        error: 'Missing required fields: quoteId, confirmedDate, confirmedSlot, contractorId',
      });
    }

    if (!['am', 'pm', 'full_day'].includes(confirmedSlot)) {
      return res.status(400).json({
        error: 'confirmedSlot must be one of: am, pm, full_day',
      });
    }

    const parsedDate = new Date(confirmedDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'confirmedDate is not a valid date' });
    }

    // Fetch quote
    const quoteResults = await db.select()
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, quoteId))
      .limit(1);

    if (quoteResults.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    const quote = quoteResults[0];

    // Fetch contractor (join handymanProfiles → users for name/email)
    const contractorResults = await db.select({
      profileId: handymanProfiles.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
      .from(handymanProfiles)
      .innerJoin(users, eq(handymanProfiles.userId, users.id))
      .where(eq(handymanProfiles.id, contractorId))
      .limit(1);

    if (contractorResults.length === 0) {
      return res.status(404).json({ error: 'Contractor not found' });
    }
    const contractor = contractorResults[0];
    const contractorName = [contractor.firstName, contractor.lastName].filter(Boolean).join(' ') || 'Contractor';

    // 2. Check deposit paid
    if (!quote.depositPaidAt) {
      return res.status(400).json({ error: 'Cannot dispatch — deposit has not been paid' });
    }

    // 3. Check not already dispatched
    if (quote.bookedAt) {
      return res.status(400).json({ error: 'Quote has already been dispatched' });
    }

    // 4–6. Transaction: update quote + create booking request + update lead
    const jobId = uuidv4();
    const now = new Date();

    const slotMap: Record<string, string> = {
      am: 'AM',
      pm: 'PM',
      full_day: 'FULL_DAY',
    };
    const scheduledSlotEnum = slotMap[confirmedSlot];

    await db.transaction(async (tx) => {
      // Update the quote
      await tx.update(personalizedQuotes)
        .set({
          selectedDate: parsedDate,
          timeSlotType: confirmedSlot,
          bookedAt: now,
          matchedContractorId: contractorId,
        })
        .where(eq(personalizedQuotes.id, quoteId));

      // Create contractor booking request
      await tx.insert(contractorBookingRequests)
        .values({
          id: jobId,
          contractorId: contractorId,
          assignedContractorId: contractorId,
          customerName: quote.customerName,
          customerEmail: quote.email || undefined,
          customerPhone: quote.phone,
          quoteId: quoteId,
          scheduledDate: parsedDate,
          requestedSlot: scheduledSlotEnum,
          status: 'pending',
          assignmentStatus: 'assigned',
          assignedAt: now,
          description: quote.jobDescription,
          createdAt: now,
          updatedAt: now,
        });

      // Update lead stage to 'booked' if lead exists
      if (quote.leadId) {
        await tx.update(leads)
          .set({
            stage: 'booked',
            stageUpdatedAt: now,
          })
          .where(eq(leads.id, quote.leadId));
      }
    });

    // 7. Send customer WhatsApp (best-effort, non-blocking)
    const slotLabel: Record<string, string> = {
      am: 'morning (AM)',
      pm: 'afternoon (PM)',
      full_day: 'full day',
    };
    const formattedDate = parsedDate.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    try {
      const whatsappMessage =
        `Great news, ${quote.customerName}! Your booking is confirmed. ` +
        `${contractorName} will visit on ${formattedDate}, ${slotLabel[confirmedSlot]}. ` +
        `We'll send a reminder the day before. If you need anything, just reply here.`;

      await sendWhatsAppMessage(quote.phone, whatsappMessage);
      console.log(`[Daily Planner] WhatsApp sent to ${quote.phone} for job ${jobId}`);
    } catch (whatsappError) {
      console.error('[Daily Planner] WhatsApp notification failed (non-blocking):', whatsappError);
    }

    // 8. Send contractor email (best-effort, non-blocking)
    try {
      if (contractor.email) {
        await sendJobAssignmentEmail({
          contractorName,
          contractorEmail: contractor.email,
          customerName: quote.customerName,
          address: quote.address || '',
          jobDescription: quote.jobDescription,
          scheduledDate: confirmedDate,
          jobId,
        });
        console.log(`[Daily Planner] Assignment email sent to ${contractor.email} for job ${jobId}`);
      }
    } catch (emailError) {
      console.error('[Daily Planner] Email notification failed (non-blocking):', emailError);
    }

    // Response
    console.log(`[Daily Planner] Job ${jobId} dispatched — quote ${quoteId}, contractor ${contractorName}, date ${confirmedDate}`);

    res.json({
      success: true,
      jobId,
      confirmedDate,
      contractorName,
      message: 'Job dispatched and customer notified',
    });

  } catch (error: any) {
    console.error('[Daily Planner] Confirm & Dispatch error:', error);
    res.status(500).json({ error: error.message || 'Failed to dispatch job' });
  }
});

// ─── GET /contractor-workload — Job counts per contractor per date ──────────

router.get('/contractor-workload', async (req: Request, res: Response) => {
  try {
    const datesParam = req.query.dates as string;
    if (!datesParam) {
      return res.status(400).json({ error: 'dates query param required (comma-separated YYYY-MM-DD)' });
    }

    const dateStrs = datesParam.split(',').map(d => d.trim()).filter(Boolean);
    if (dateStrs.length === 0) {
      return res.status(400).json({ error: 'No valid dates provided' });
    }

    // Parse dates into start/end of day pairs
    const datePairs = dateStrs.map(d => {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      return { dateStr: d, start, end };
    });

    // Query booking requests for all dates in one go
    const minDate = datePairs.reduce((min, p) => p.start < min ? p.start : min, datePairs[0].start);
    const maxDate = datePairs.reduce((max, p) => p.end > max ? p.end : max, datePairs[0].end);

    const bookings = await db
      .select({
        assignedContractorId: contractorBookingRequests.assignedContractorId,
        scheduledDate: contractorBookingRequests.scheduledDate,
      })
      .from(contractorBookingRequests)
      .where(
        and(
          isNotNull(contractorBookingRequests.assignedContractorId),
          isNotNull(contractorBookingRequests.scheduledDate),
          gte(contractorBookingRequests.scheduledDate, minDate),
          lte(contractorBookingRequests.scheduledDate, maxDate),
          sql`${contractorBookingRequests.status} NOT IN ('declined', 'cancelled')`
        )
      );

    // Build result: { [contractorId]: { [dateStr]: count } }
    const result: Record<string, Record<string, number>> = {};

    for (const booking of bookings) {
      if (!booking.assignedContractorId || !booking.scheduledDate) continue;
      const bookingDate = new Date(booking.scheduledDate).toISOString().split('T')[0];

      // Only count if the booking date matches one of the requested dates
      if (!dateStrs.includes(bookingDate)) continue;

      if (!result[booking.assignedContractorId]) {
        result[booking.assignedContractorId] = {};
      }
      result[booking.assignedContractorId][bookingDate] =
        (result[booking.assignedContractorId][bookingDate] || 0) + 1;
    }

    res.json(result);
  } catch (error: any) {
    console.error('[Daily Planner] Contractor workload error:', error);
    res.status(500).json({ error: 'Failed to fetch contractor workload' });
  }
});

// ─── GET /week-overview — Summary per day for the week strip ─────────────────

router.get('/week-overview', async (req: Request, res: Response) => {
  try {
    const fromDate = req.query.from as string;
    const toDate = req.query.to as string;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
    }

    // Get all pool jobs (deposit paid, not booked, not revoked)
    const poolJobs = await db
      .select({
        id: personalizedQuotes.id,
        postcode: personalizedQuotes.postcode,
        basePrice: personalizedQuotes.basePrice,
        availableDates: personalizedQuotes.availableDates,
      })
      .from(personalizedQuotes)
      .where(
        and(
          isNotNull(personalizedQuotes.depositPaidAt),
          isNull(personalizedQuotes.bookedAt),
          sql`${personalizedQuotes.revokedAt} IS NULL`
        )
      );

    // Get dispatched jobs in date range
    const from = new Date(fromDate);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);

    const dispatchedJobs = await db
      .select({
        id: personalizedQuotes.id,
        postcode: personalizedQuotes.postcode,
        basePrice: personalizedQuotes.basePrice,
        selectedDate: personalizedQuotes.selectedDate,
      })
      .from(personalizedQuotes)
      .where(
        and(
          isNotNull(personalizedQuotes.bookedAt),
          sql`${personalizedQuotes.revokedAt} IS NULL`,
          gte(personalizedQuotes.selectedDate, from),
          lte(personalizedQuotes.selectedDate, to)
        )
      );

    // Build day summaries
    const days: { date: string; poolCount: number; dispatchedCount: number; totalValuePence: number; postcodeAreas: number }[] = [];

    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];

      // Pool jobs where this date appears in availableDates
      const poolForDate = poolJobs.filter(j => {
        if (!j.availableDates || !Array.isArray(j.availableDates)) return false;
        return (j.availableDates as string[]).some(ad => {
          try { return ad.split('T')[0] === dateStr; } catch { return ad === dateStr; }
        });
      });

      // Dispatched jobs for this date
      const dispatchedForDate = dispatchedJobs.filter(j => {
        if (!j.selectedDate) return false;
        return new Date(j.selectedDate).toISOString().split('T')[0] === dateStr;
      });

      // Distinct postcode areas
      const postcodeSet = new Set<string>();
      for (const j of poolForDate) {
        if (j.postcode) {
          const match = j.postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d{1,2})/);
          if (match) postcodeSet.add(match[1]);
        }
      }

      days.push({
        date: dateStr,
        poolCount: poolForDate.length,
        dispatchedCount: dispatchedForDate.length,
        totalValuePence: poolForDate.reduce((sum, j) => sum + (j.basePrice || 0), 0),
        postcodeAreas: postcodeSet.size,
      });
    }

    res.json({ days });
  } catch (error: any) {
    console.error('[Daily Planner] Week overview error:', error);
    res.status(500).json({ error: 'Failed to load week overview', details: error.message });
  }
});

// ─── GET /auto-group — Distance-based smart clusters for a date ─────────────

router.get('/auto-group', async (req: Request, res: Response) => {
  try {
    const date = req.query.date as string;
    if (!date) {
      return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });
    }

    // 1. Get ALL pool jobs (deposit paid, not booked, not revoked) — needed for best-fit-date calc
    const allPoolJobRows = await db
      .select({
        id: personalizedQuotes.id,
        customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        coordinates: personalizedQuotes.coordinates,
        jobDescription: personalizedQuotes.jobDescription,
        contextualHeadline: personalizedQuotes.contextualHeadline,
        basePrice: personalizedQuotes.basePrice,
        availableDates: personalizedQuotes.availableDates,
        pricingLineItems: personalizedQuotes.pricingLineItems,
      })
      .from(personalizedQuotes)
      .where(
        and(
          isNotNull(personalizedQuotes.depositPaidAt),
          isNull(personalizedQuotes.bookedAt),
          sql`${personalizedQuotes.revokedAt} IS NULL`,
          isNotNull(personalizedQuotes.availableDates)
        )
      );

    // Map DB rows to PoolJob[]
    const allPoolJobs: PoolJob[] = allPoolJobRows.map(j => ({
      id: j.id,
      customerName: j.customerName,
      phone: j.phone,
      address: j.address,
      postcode: j.postcode,
      coordinates: j.coordinates as { lat: number; lng: number } | null,
      availableDates: (j.availableDates as string[]) || [],
      basePrice: j.basePrice || 0,
      pricingLineItems: j.pricingLineItems,
      contextualHeadline: j.contextualHeadline,
      jobDescription: j.jobDescription,
    }));

    // 2. Get contractors
    const contractorRows = await db
      .select({
        id: handymanProfiles.id,
        userId: handymanProfiles.userId,
        businessName: handymanProfiles.businessName,
        postcode: handymanProfiles.postcode,
        latitude: handymanProfiles.latitude,
        longitude: handymanProfiles.longitude,
        radiusMiles: handymanProfiles.radiusMiles,
        lastAssignedAt: handymanProfiles.lastAssignedAt,
        availabilityStatus: handymanProfiles.availabilityStatus,
      })
      .from(handymanProfiles)
      .where(sql`${handymanProfiles.availabilityStatus} != 'inactive'`);

    // Get contractor names
    const contractorUserIds = contractorRows.map(c => c.userId).filter(Boolean) as string[];
    let contractorUsers: { id: string; firstName: string | null; lastName: string | null }[] = [];
    if (contractorUserIds.length > 0) {
      contractorUsers = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(contractorUserIds.map(id => sql`${id}`), sql`, `)})`);
    }
    const userMap = new Map(contractorUsers.map(u => [u.id, u]));

    // Get skills
    const allSkills = await db
      .select({ handymanId: handymanSkills.handymanId, categorySlug: handymanSkills.categorySlug })
      .from(handymanSkills);

    const skillsByContractor = new Map<string, string[]>();
    for (const skill of allSkills) {
      const existing = skillsByContractor.get(skill.handymanId) || [];
      if (skill.categorySlug) existing.push(skill.categorySlug);
      skillsByContractor.set(skill.handymanId, existing);
    }

    const getContractorName = (c: typeof contractorRows[0]): string => {
      const user = userMap.get(c.userId ?? '');
      if (user) {
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
        if (fullName) return fullName;
      }
      return c.businessName || 'Unknown';
    };

    // Map to Contractor[]
    const contractorList: Contractor[] = contractorRows.map(c => ({
      id: c.id,
      name: getContractorName(c),
      latitude: c.latitude ? parseFloat(c.latitude) : null,
      longitude: c.longitude ? parseFloat(c.longitude) : null,
      postcode: c.postcode,
      radiusMiles: c.radiusMiles ?? 10,
      skills: skillsByContractor.get(c.id) || [],
      lastAssignedAt: c.lastAssignedAt,
    }));

    // 3. Get contractor workload (existing commitments) for this date
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(date);
    dateEnd.setHours(23, 59, 59, 999);

    const bookings = await db
      .select({
        assignedContractorId: contractorBookingRequests.assignedContractorId,
      })
      .from(contractorBookingRequests)
      .where(
        and(
          isNotNull(contractorBookingRequests.assignedContractorId),
          isNotNull(contractorBookingRequests.scheduledDate),
          gte(contractorBookingRequests.scheduledDate, dateStart),
          lte(contractorBookingRequests.scheduledDate, dateEnd),
          sql`${contractorBookingRequests.status} NOT IN ('declined', 'cancelled')`
        )
      );

    const commitmentsByContractor = new Map<string, number>();
    for (const b of bookings) {
      if (b.assignedContractorId) {
        commitmentsByContractor.set(
          b.assignedContractorId,
          (commitmentsByContractor.get(b.assignedContractorId) || 0) + 1,
        );
      }
    }

    // 4. Run smart grouping engine
    const smartResult = generateSmartGrouping(allPoolJobs, contractorList, date, commitmentsByContractor);

    // 5. Also get dispatched jobs for this date (for the "already dispatched" section)
    const dispatchedJobs = await db
      .select({
        id: personalizedQuotes.id,
        customerName: personalizedQuotes.customerName,
        postcode: personalizedQuotes.postcode,
        address: personalizedQuotes.address,
        coordinates: personalizedQuotes.coordinates,
        jobDescription: personalizedQuotes.jobDescription,
        contextualHeadline: personalizedQuotes.contextualHeadline,
        basePrice: personalizedQuotes.basePrice,
        timeSlotType: personalizedQuotes.timeSlotType,
        matchedContractorId: personalizedQuotes.matchedContractorId,
        matchedContractorName: personalizedQuotes.matchedContractorName,
      })
      .from(personalizedQuotes)
      .where(
        and(
          isNotNull(personalizedQuotes.bookedAt),
          sql`${personalizedQuotes.revokedAt} IS NULL`,
          gte(personalizedQuotes.selectedDate, dateStart),
          lte(personalizedQuotes.selectedDate, dateEnd)
        )
      );

    // 6. Build contractor list for the frontend (with raw lat/lng for map display)
    const contractorListForResponse = contractorRows.map(c => ({
      id: c.id,
      name: getContractorName(c),
      postcode: c.postcode,
      skills: skillsByContractor.get(c.id) || [],
      latitude: c.latitude,
      longitude: c.longitude,
    }));

    // Merge unlocated cluster into the clusters array (at the end)
    const allClusters = [...smartResult.clusters];
    if (smartResult.unlocated) {
      allClusters.push(smartResult.unlocated);
    }

    res.json({
      date,
      clusters: allClusters,
      dispatched: dispatchedJobs,
      contractors: contractorListForResponse,
    });
  } catch (error: any) {
    console.error('[Daily Planner] Auto-group error:', error);
    res.status(500).json({ error: 'Failed to auto-group jobs', details: error.message });
  }
});

// ─── POST /dispatch-all — Batch dispatch all clusters for a day ─────────────

router.post('/dispatch-all', async (req: Request, res: Response) => {
  try {
    const { date, clusters: clusterInputs } = req.body as {
      date: string;
      clusters: Array<{ jobIds: string[]; contractorId: string; slot: string }>;
    };

    if (!date || !clusterInputs || !Array.isArray(clusterInputs)) {
      return res.status(400).json({
        error: 'Missing required fields: date, clusters[]',
      });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'date is not valid' });
    }

    let totalDispatched = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    const now = new Date();

    for (const cluster of clusterInputs) {
      const { jobIds, contractorId, slot } = cluster;

      if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
        errors.push('Cluster missing jobIds');
        continue;
      }
      if (!contractorId) {
        errors.push(`Cluster with ${jobIds.length} jobs missing contractorId`);
        continue;
      }
      if (!['am', 'pm', 'full_day'].includes(slot)) {
        errors.push(`Invalid slot "${slot}" for contractor ${contractorId}`);
        continue;
      }

      // Fetch contractor info
      const contractorResults = await db.select({
        profileId: handymanProfiles.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .where(eq(handymanProfiles.id, contractorId))
        .limit(1);

      if (contractorResults.length === 0) {
        errors.push(`Contractor ${contractorId} not found`);
        continue;
      }
      const contractor = contractorResults[0];
      const contractorName = [contractor.firstName, contractor.lastName].filter(Boolean).join(' ') || 'Contractor';

      // Fetch all quotes for this cluster
      const quotes = await db.select()
        .from(personalizedQuotes)
        .where(sql`${personalizedQuotes.id} IN (${sql.join(jobIds.map((id: string) => sql`${id}`), sql`, `)})`);

      const slotMap: Record<string, string> = { am: 'AM', pm: 'PM', full_day: 'FULL_DAY' };
      const scheduledSlotEnum = slotMap[slot];

      const dispatched: string[] = [];
      const skipped: string[] = [];
      const jobSummaries: { customerName: string; address: string; description: string; jobId: string }[] = [];

      // Dispatch in a transaction
      await db.transaction(async (tx) => {
        for (const quote of quotes) {
          // Ghost job check: skip already booked or deposit not paid
          if (quote.bookedAt) {
            skipped.push(quote.id);
            continue;
          }
          if (!quote.depositPaidAt) {
            skipped.push(quote.id);
            continue;
          }

          const jobId = uuidv4();

          await tx.update(personalizedQuotes)
            .set({
              selectedDate: parsedDate,
              timeSlotType: slot,
              bookedAt: now,
              matchedContractorId: contractorId,
              matchedContractorName: contractorName,
            })
            .where(eq(personalizedQuotes.id, quote.id));

          await tx.insert(contractorBookingRequests)
            .values({
              id: jobId,
              contractorId: contractorId,
              assignedContractorId: contractorId,
              customerName: quote.customerName,
              customerEmail: quote.email || undefined,
              customerPhone: quote.phone,
              quoteId: quote.id,
              scheduledDate: parsedDate,
              requestedSlot: scheduledSlotEnum,
              status: 'pending',
              assignmentStatus: 'assigned',
              assignedAt: now,
              description: quote.jobDescription,
              createdAt: now,
              updatedAt: now,
            });

          if (quote.leadId) {
            await tx.update(leads)
              .set({ stage: 'booked', stageUpdatedAt: now })
              .where(eq(leads.id, quote.leadId));
          }

          dispatched.push(quote.id);
          jobSummaries.push({
            customerName: quote.customerName,
            address: quote.address || quote.postcode || '',
            description: quote.jobDescription,
            jobId,
          });
        }
      });

      // Update lastAssignedAt
      if (dispatched.length > 0) {
        await db.update(handymanProfiles)
          .set({ lastAssignedAt: now })
          .where(eq(handymanProfiles.id, contractorId));
      }

      // Send customer WhatsApp notifications (best-effort)
      const slotLabel: Record<string, string> = {
        am: 'morning (AM)',
        pm: 'afternoon (PM)',
        full_day: 'full day',
      };
      const formattedDate = parsedDate.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });

      for (const quote of quotes) {
        if (skipped.includes(quote.id)) continue;
        try {
          const whatsappMessage =
            `Great news, ${quote.customerName}! Your booking is confirmed. ` +
            `${contractorName} will visit on ${formattedDate}, ${slotLabel[slot]}. ` +
            `We'll send a reminder the day before. If you need anything, just reply here.`;
          await sendWhatsAppMessage(quote.phone, whatsappMessage);
        } catch (whatsappError) {
          // Non-blocking
        }
      }

      // Send ONE contractor email per cluster
      if (contractor.email && jobSummaries.length > 0) {
        try {
          const jobLines = jobSummaries.map((j, i) => `${i + 1}. ${j.customerName} — ${j.address}\n   ${j.description}`).join('\n\n');
          const combinedDescription = `You have ${jobSummaries.length} job(s) scheduled:\n\n${jobLines}`;
          await sendJobAssignmentEmail({
            contractorName,
            contractorEmail: contractor.email,
            customerName: `${jobSummaries.length} customers`,
            address: `${jobSummaries.length} locations`,
            jobDescription: combinedDescription,
            scheduledDate: date,
            jobId: jobSummaries[0].jobId,
          });
        } catch (emailError) {
          // Non-blocking
        }
      }

      totalDispatched += dispatched.length;
      totalSkipped += skipped.length;

      if (skipped.length > 0) {
        errors.push(`${skipped.length} job(s) skipped for ${contractorName} (already booked or no deposit)`);
      }
    }

    console.log(`[Daily Planner] Dispatch-all: ${totalDispatched} dispatched, ${totalSkipped} skipped, ${errors.length} errors`);

    res.json({
      dispatched: totalDispatched,
      skipped: totalSkipped,
      errors,
    });
  } catch (error: any) {
    console.error('[Daily Planner] Dispatch-all error:', error);
    res.status(500).json({ error: error.message || 'Failed to batch dispatch' });
  }
});

// ─── POST /confirm-cluster — Dispatch all jobs in a cluster at once ──────────

router.post('/confirm-cluster', async (req: Request, res: Response) => {
  try {
    const { date, slot, contractorId, jobIds } = req.body;

    if (!date || !slot || !contractorId || !jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: date, slot, contractorId, jobIds[]',
      });
    }

    if (!['am', 'pm', 'full_day'].includes(slot)) {
      return res.status(400).json({ error: 'slot must be one of: am, pm, full_day' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'date is not valid' });
    }

    // Fetch contractor info
    const contractorResults = await db.select({
      profileId: handymanProfiles.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
      .from(handymanProfiles)
      .innerJoin(users, eq(handymanProfiles.userId, users.id))
      .where(eq(handymanProfiles.id, contractorId))
      .limit(1);

    if (contractorResults.length === 0) {
      return res.status(404).json({ error: 'Contractor not found' });
    }
    const contractor = contractorResults[0];
    const contractorName = [contractor.firstName, contractor.lastName].filter(Boolean).join(' ') || 'Contractor';

    // Fetch all quotes
    const quotes = await db.select()
      .from(personalizedQuotes)
      .where(sql`${personalizedQuotes.id} IN (${sql.join(jobIds.map((id: string) => sql`${id}`), sql`, `)})`);

    const now = new Date();
    const slotMap: Record<string, string> = { am: 'AM', pm: 'PM', full_day: 'FULL_DAY' };
    const scheduledSlotEnum = slotMap[slot];

    const dispatched: string[] = [];
    const skipped: string[] = [];
    const jobSummaries: { customerName: string; address: string; description: string; jobId: string }[] = [];

    // Transaction: dispatch all valid jobs
    await db.transaction(async (tx) => {
      for (const quote of quotes) {
        // Skip already dispatched
        if (quote.bookedAt) {
          skipped.push(quote.id);
          continue;
        }

        // Skip if deposit not paid
        if (!quote.depositPaidAt) {
          skipped.push(quote.id);
          continue;
        }

        const jobId = uuidv4();

        // Update the quote
        await tx.update(personalizedQuotes)
          .set({
            selectedDate: parsedDate,
            timeSlotType: slot,
            bookedAt: now,
            matchedContractorId: contractorId,
            matchedContractorName: contractorName,
          })
          .where(eq(personalizedQuotes.id, quote.id));

        // Create contractor booking request
        await tx.insert(contractorBookingRequests)
          .values({
            id: jobId,
            contractorId: contractorId,
            assignedContractorId: contractorId,
            customerName: quote.customerName,
            customerEmail: quote.email || undefined,
            customerPhone: quote.phone,
            quoteId: quote.id,
            scheduledDate: parsedDate,
            requestedSlot: scheduledSlotEnum,
            status: 'pending',
            assignmentStatus: 'assigned',
            assignedAt: now,
            description: quote.jobDescription,
            createdAt: now,
            updatedAt: now,
          });

        // Update lead stage
        if (quote.leadId) {
          await tx.update(leads)
            .set({
              stage: 'booked',
              stageUpdatedAt: now,
            })
            .where(eq(leads.id, quote.leadId));
        }

        dispatched.push(quote.id);
        jobSummaries.push({
          customerName: quote.customerName,
          address: quote.address || quote.postcode || '',
          description: quote.jobDescription,
          jobId,
        });
      }
    });

    // Update contractor's lastAssignedAt
    if (dispatched.length > 0) {
      await db.update(handymanProfiles)
        .set({ lastAssignedAt: now })
        .where(eq(handymanProfiles.id, contractorId));
    }

    // Send customer WhatsApp notifications (best-effort, after transaction)
    const slotLabel: Record<string, string> = {
      am: 'morning (AM)',
      pm: 'afternoon (PM)',
      full_day: 'full day',
    };
    const formattedDate = parsedDate.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    for (const quote of quotes) {
      if (skipped.includes(quote.id)) continue;
      try {
        const whatsappMessage =
          `Great news, ${quote.customerName}! Your booking is confirmed. ` +
          `${contractorName} will visit on ${formattedDate}, ${slotLabel[slot]}. ` +
          `We'll send a reminder the day before. If you need anything, just reply here.`;
        await sendWhatsAppMessage(quote.phone, whatsappMessage);
      } catch (whatsappError) {
        console.error('[Daily Planner] WhatsApp notification failed (non-blocking):', whatsappError);
      }
    }

    // Send ONE contractor email summarizing all jobs
    if (contractor.email && jobSummaries.length > 0) {
      try {
        const jobLines = jobSummaries.map((j, i) => `${i + 1}. ${j.customerName} — ${j.address}\n   ${j.description}`).join('\n\n');
        const combinedDescription = `You have ${jobSummaries.length} job(s) scheduled:\n\n${jobLines}`;

        await sendJobAssignmentEmail({
          contractorName,
          contractorEmail: contractor.email,
          customerName: `${jobSummaries.length} customers`,
          address: `${jobSummaries.length} locations`,
          jobDescription: combinedDescription,
          scheduledDate: date,
          jobId: jobSummaries[0].jobId,
        });
        console.log(`[Daily Planner] Cluster email sent to ${contractor.email} for ${jobSummaries.length} jobs`);
      } catch (emailError) {
        console.error('[Daily Planner] Cluster email failed (non-blocking):', emailError);
      }
    }

    console.log(`[Daily Planner] Cluster dispatch: ${dispatched.length} dispatched, ${skipped.length} skipped, contractor ${contractorName}`);

    res.json({
      success: true,
      dispatched: dispatched.length,
      skipped: skipped.length,
      contractorName,
      jobIds: dispatched,
    });
  } catch (error: any) {
    console.error('[Daily Planner] Confirm cluster error:', error);
    res.status(500).json({ error: error.message || 'Failed to dispatch cluster' });
  }
});

export default router;
