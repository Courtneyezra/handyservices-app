/**
 * Auto-Assignment Engine — Round-Robin with Margin Floor + Radius Filtering
 *
 * When a customer books a quote (selects date + slot), this engine:
 * 1. Builds a shortlist of contractors who:
 *    - Have the required category skills
 *    - Are within service radius of the customer (Haversine distance)
 *    - Are available on the chosen date/slot
 *    - Have rates that produce a healthy margin
 * 2. Ranks them by round-robin (fewest recent jobs first)
 * 3. Auto-assigns the top-ranked contractor
 * 4. If a contractor rejects, re-assigns to the next candidate in the shortlist
 *
 * The contractor is GUARANTEED to accept because:
 * - Their skills match (they opted in to the category)
 * - They're available (they set the date)
 * - Their rate is covered (margin checked)
 * - They're within their stated service radius
 */

import { db } from './db';
import {
  handymanSkills,
  handymanProfiles,
  contractorBookingRequests,
  contractorJobs,
  contractorAvailabilityDates,
  handymanAvailability,
  users,
} from '../shared/schema';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import { CATEGORY_MIN_MARGINS } from './contextual-pricing/reference-rates';
import type { JobCategory } from '../shared/contextual-pricing-types';

// ---------------------------------------------------------------------------
// Haversine Distance (mirrors contractor-matcher.ts)
// ---------------------------------------------------------------------------

/**
 * Calculate distance between two coordinates in miles using Haversine formula.
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssignmentCandidate {
  contractorId: string;     // handymanProfiles.id
  userId: string;           // users.id
  name: string;             // contractor display name
  hourlyRatePence: number;  // their rate for the primary category
  recentJobCount: number;   // jobs in last 30 days (for round-robin)
  marginPercent: number;    // projected margin if assigned
  distanceMiles: number | null; // distance to customer (null if no location data)
  score: number;            // final ranking score (lower = better pick)
}

export interface AssignmentResult {
  success: boolean;
  assignedContractor: AssignmentCandidate | null;
  shortlist: AssignmentCandidate[];
  reason: string;
}

// ---------------------------------------------------------------------------
// Main Function
// ---------------------------------------------------------------------------

/**
 * Find and rank contractors for a booked job.
 *
 * @param categories    - Job categories (e.g. ['plumbing_minor', 'general_fixing'])
 * @param date          - Booked date (Date object)
 * @param slot          - Booked slot: 'am' | 'pm' | 'full'
 * @param pricePence    - Customer quote price in pence
 * @param customerLat   - Customer latitude (optional — skips radius filter if missing)
 * @param customerLng   - Customer longitude (optional — skips radius filter if missing)
 * @param excludeContractorIds - Contractor IDs to skip (e.g. those who already rejected)
 */
export async function findBestContractorForJob(
  categories: JobCategory[],
  date: Date,
  slot: 'am' | 'pm' | 'full',
  pricePence: number,
  customerLat?: number,
  customerLng?: number,
  excludeContractorIds: string[] = [],
): Promise<AssignmentResult> {
  // 1. Find contractors with ALL required category skills
  const matchingSkills = await db
    .select({
      handymanId: handymanSkills.handymanId,
      hourlyRate: handymanSkills.hourlyRate,
      categorySlug: handymanSkills.categorySlug,
    })
    .from(handymanSkills)
    .where(sql`${handymanSkills.categorySlug} IN ${categories}`);

  if (matchingSkills.length === 0) {
    return {
      success: false,
      assignedContractor: null,
      shortlist: [],
      reason: `No contractors have any of categories [${categories.join(', ')}] opted in`,
    };
  }

  // Group skills by contractor and only keep contractors who cover ALL categories
  const skillsByContractor = new Map<string, typeof matchingSkills>();
  for (const skill of matchingSkills) {
    const existing = skillsByContractor.get(skill.handymanId) || [];
    existing.push(skill);
    skillsByContractor.set(skill.handymanId, existing);
  }

  const contractorIds: string[] = [];
  for (const [contractorId, skills] of skillsByContractor) {
    // Skip excluded contractors (e.g. those who already rejected this job)
    if (excludeContractorIds.includes(contractorId)) continue;

    const coveredCategories = new Set(skills.map((s) => s.categorySlug));
    if (categories.every((cat) => coveredCategories.has(cat))) {
      contractorIds.push(contractorId);
    }
  }

  if (contractorIds.length === 0) {
    return {
      success: false,
      assignedContractor: null,
      shortlist: [],
      reason: `No contractors cover ALL required categories [${categories.join(', ')}]`,
    };
  }

  // 2. Radius/location filtering — only contractors whose service area covers the customer
  const hasCustomerLocation = customerLat != null && customerLng != null;
  const distanceMap = new Map<string, number | null>(); // contractorId -> distanceMiles

  let locationFilteredIds = contractorIds;

  if (hasCustomerLocation) {
    // Fetch profiles with location data for all skill-matched contractors
    const profiles = await db
      .select({
        id: handymanProfiles.id,
        latitude: handymanProfiles.latitude,
        longitude: handymanProfiles.longitude,
        radiusMiles: handymanProfiles.radiusMiles,
      })
      .from(handymanProfiles)
      .where(sql`${handymanProfiles.id} IN ${contractorIds}`);

    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    locationFilteredIds = [];

    for (const contractorId of contractorIds) {
      const profile = profileMap.get(contractorId);

      if (!profile || !profile.latitude || !profile.longitude) {
        // No location data on profile — include them (graceful fallback)
        distanceMap.set(contractorId, null);
        locationFilteredIds.push(contractorId);
        continue;
      }

      const cLat = parseFloat(profile.latitude);
      const cLng = parseFloat(profile.longitude);

      if (isNaN(cLat) || isNaN(cLng)) {
        distanceMap.set(contractorId, null);
        locationFilteredIds.push(contractorId);
        continue;
      }

      const distance = haversineDistance(customerLat!, customerLng!, cLat, cLng);
      const radiusMiles = profile.radiusMiles ?? 10; // default 10 miles

      if (distance <= radiusMiles) {
        distanceMap.set(contractorId, Math.round(distance * 10) / 10);
        locationFilteredIds.push(contractorId);
      } else {
        console.log(
          `[AutoAssign] Skipping ${contractorId}: ${distance.toFixed(1)}mi exceeds ${radiusMiles}mi radius`,
        );
      }
    }

    if (locationFilteredIds.length === 0) {
      return {
        success: false,
        assignedContractor: null,
        shortlist: [],
        reason: `No contractors within service radius for customer location (${contractorIds.length} had skills but were too far)`,
      };
    }
  }

  // 3. Check availability for each contractor on the booked date/slot
  const dayOfWeek = date.getDay();
  const availableContractors: string[] = [];

  for (const contractorId of locationFilteredIds) {
    const isAvail = await checkSlotAvailability(contractorId, date, dayOfWeek, slot);
    if (isAvail) {
      // Also check for booking conflicts
      const hasConflict = await checkBookingConflict(contractorId, date, slot);
      if (!hasConflict) {
        availableContractors.push(contractorId);
      }
    }
  }

  if (availableContractors.length === 0) {
    return {
      success: false,
      assignedContractor: null,
      shortlist: [],
      reason: `No contractors available on ${date.toISOString().split('T')[0]} (${slot})`,
    };
  }

  // 4. Build candidate list with margin check + job count
  const candidates: AssignmentCandidate[] = [];
  const minMargin = Math.max(...categories.map((cat) => CATEGORY_MIN_MARGINS[cat] ?? 20));

  for (const contractorId of availableContractors) {
    // Get contractor details
    const profile = await db
      .select({
        id: handymanProfiles.id,
        userId: handymanProfiles.userId,
      })
      .from(handymanProfiles)
      .where(eq(handymanProfiles.id, contractorId))
      .limit(1);

    if (profile.length === 0) continue;

    const user = await db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, profile[0].userId))
      .limit(1);

    const name = user.length > 0
      ? `${user[0].firstName || ''} ${user[0].lastName || ''}`.trim()
      : 'Unknown';

    // Get their highest rate across all required categories (worst case for margin)
    const contractorSkills = matchingSkills.filter((s) => s.handymanId === contractorId);
    const hourlyRatePence = Math.max(...contractorSkills.map((s) => (s.hourlyRate || 0) * 100));

    // Calculate projected margin
    // Simple estimate: assume the full quote price vs their hourly rate
    const marginPercent = pricePence > 0
      ? Math.round(((pricePence - hourlyRatePence) / pricePence) * 100)
      : 0;

    // Skip if margin is below floor
    if (marginPercent < minMargin) continue;

    // Count recent jobs (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const jobCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(contractorJobs)
      .where(
        and(
          eq(contractorJobs.contractorId, contractorId),
          sql`${contractorJobs.createdAt} >= ${thirtyDaysAgo}`
        )
      );

    const recentJobCount = Number(jobCountResult[0]?.count || 0);

    candidates.push({
      contractorId,
      userId: profile[0].userId,
      name,
      hourlyRatePence,
      recentJobCount,
      marginPercent,
      distanceMiles: distanceMap.get(contractorId) ?? null,
      score: recentJobCount, // Round-robin: fewer jobs = lower score = higher priority
    });
  }

  if (candidates.length === 0) {
    return {
      success: false,
      assignedContractor: null,
      shortlist: [],
      reason: `All available contractors have margin below ${minMargin}% floor for [${categories.join(', ')}]`,
    };
  }

  // 5. Sort by round-robin score (fewest jobs first, tiebreak by margin)
  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score; // Fewer jobs = priority
    return b.marginPercent - a.marginPercent; // Higher margin = tiebreaker
  });

  const winner = candidates[0];

  console.log(
    `[AutoAssign] Selected ${winner.name} (${winner.contractorId}): ` +
    `${winner.recentJobCount} recent jobs, ${winner.marginPercent}% margin, ` +
    `rate £${(winner.hourlyRatePence / 100).toFixed(2)}/hr` +
    (winner.distanceMiles != null ? `, ${winner.distanceMiles}mi away` : '')
  );

  return {
    success: true,
    assignedContractor: winner,
    shortlist: candidates,
    reason: `Assigned to ${winner.name} via round-robin (${candidates.length} candidates)`,
  };
}

// ---------------------------------------------------------------------------
// Helper: Check if contractor has a slot available
// ---------------------------------------------------------------------------

async function checkSlotAvailability(
  contractorId: string,
  date: Date,
  dayOfWeek: number,
  slot: 'am' | 'pm' | 'full',
): Promise<boolean> {
  // Check date-specific override first
  const override = await db
    .select()
    .from(contractorAvailabilityDates)
    .where(
      and(
        eq(contractorAvailabilityDates.contractorId, contractorId),
        eq(contractorAvailabilityDates.date, date)
      )
    )
    .limit(1);

  if (override.length > 0) {
    if (!override[0].isAvailable) return false;
    const start = override[0].startTime || '08:00';
    const end = override[0].endTime || '17:00';
    return isSlotCovered(start, end, slot);
  }

  // Fall back to weekly pattern
  const pattern = await db
    .select()
    .from(handymanAvailability)
    .where(
      and(
        eq(handymanAvailability.handymanId, contractorId),
        eq(handymanAvailability.dayOfWeek, dayOfWeek),
        eq(handymanAvailability.isActive, true)
      )
    )
    .limit(1);

  if (pattern.length === 0) return false;

  const start = pattern[0].startTime || '08:00';
  const end = pattern[0].endTime || '17:00';
  return isSlotCovered(start, end, slot);
}

function isSlotCovered(start: string, end: string, slot: 'am' | 'pm' | 'full'): boolean {
  if (slot === 'am') return start <= '08:00' && end >= '12:00';
  if (slot === 'pm') return start <= '13:00' && end >= '17:00';
  if (slot === 'full') return start <= '08:00' && end >= '17:00';
  return false;
}

// ---------------------------------------------------------------------------
// Helper: Check for booking conflicts on same date/slot
// ---------------------------------------------------------------------------

async function checkBookingConflict(
  contractorId: string,
  date: Date,
  slot: 'am' | 'pm' | 'full',
): Promise<boolean> {
  const existingBookings = await db
    .select({
      scheduledStartTime: contractorBookingRequests.scheduledStartTime,
      scheduledEndTime: contractorBookingRequests.scheduledEndTime,
      requestedSlot: contractorBookingRequests.requestedSlot,
    })
    .from(contractorBookingRequests)
    .where(
      and(
        eq(contractorBookingRequests.contractorId, contractorId),
        eq(contractorBookingRequests.requestedDate, date),
        eq(contractorBookingRequests.status, 'accepted')
      )
    );

  if (existingBookings.length === 0) return false;

  for (const booking of existingBookings) {
    const existingSlot = inferBookingSlot(booking.scheduledStartTime, booking.scheduledEndTime, booking.requestedSlot);

    if (slotsConflict(slot, existingSlot)) {
      return true;
    }
  }

  return false;
}

/**
 * Infer the slot type (am/pm/full) from booking time fields.
 * Falls back to 'full' for backwards compatibility when no slot info exists.
 */
function inferBookingSlot(
  startTime: string | null,
  endTime: string | null,
  requestedSlot: string | null,
): 'am' | 'pm' | 'full' {
  // Try to infer from scheduled start/end times
  if (startTime && endTime) {
    const startHour = parseInt(startTime.split(':')[0], 10);
    const endHour = parseInt(endTime.split(':')[0], 10);
    if (endHour <= 12) return 'am';
    if (startHour >= 12) return 'pm';
    return 'full';
  }

  // Try to infer from requestedSlot string (e.g., "09:00 - 11:00")
  if (requestedSlot) {
    const lower = requestedSlot.toLowerCase();
    if (lower === 'am' || lower === 'pm' || lower === 'full') {
      return lower as 'am' | 'pm' | 'full';
    }
    // Parse time range like "09:00 - 11:00"
    const match = requestedSlot.match(/(\d{1,2}):?\d{0,2}\s*-\s*(\d{1,2}):?\d{0,2}/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (end <= 12) return 'am';
      if (start >= 12) return 'pm';
      return 'full';
    }
  }

  // No slot info — treat as full day for safety (backwards compatibility)
  return 'full';
}

/**
 * Check if two slots conflict with each other.
 * AM conflicts with: AM, FULL_DAY
 * PM conflicts with: PM, FULL_DAY
 * FULL_DAY conflicts with: AM, PM, FULL_DAY
 */
function slotsConflict(
  newSlot: 'am' | 'pm' | 'full',
  existingSlot: 'am' | 'pm' | 'full',
): boolean {
  if (newSlot === 'full' || existingSlot === 'full') return true;
  return newSlot === existingSlot;
}

// ---------------------------------------------------------------------------
// Rejection Re-Assignment
// ---------------------------------------------------------------------------

/**
 * Handle a contractor rejecting a job assignment.
 *
 * Marks the current assignment as rejected and attempts to re-assign to
 * the next best candidate by re-running the matching engine with the
 * rejecting contractor excluded.
 *
 * @param jobId            - The contractor_jobs.id or booking request id
 * @param rejectedById     - The handymanProfiles.id of the contractor who rejected
 * @param categories       - Job categories for re-matching
 * @param date             - Scheduled date
 * @param slot             - Booked slot
 * @param pricePence       - Customer quote price in pence
 * @param customerLat      - Customer latitude (optional)
 * @param customerLng      - Customer longitude (optional)
 * @param previouslyRejectedIds - IDs of contractors who already rejected this job
 */
export async function handleContractorRejection(params: {
  jobId: string;
  rejectedById: string;
  categories: JobCategory[];
  date: Date;
  slot: 'am' | 'pm' | 'full';
  pricePence: number;
  customerLat?: number;
  customerLng?: number;
  previouslyRejectedIds?: string[];
}): Promise<AssignmentResult> {
  const {
    jobId,
    rejectedById,
    categories,
    date,
    slot,
    pricePence,
    customerLat,
    customerLng,
    previouslyRejectedIds = [],
  } = params;

  // Build full exclusion list: all previous rejecters + current one
  const excludeIds = [...new Set([...previouslyRejectedIds, rejectedById])];

  console.log(
    `[AutoAssign] Contractor ${rejectedById} rejected job ${jobId}. ` +
    `Re-assigning (excluding ${excludeIds.length} contractor(s))...`,
  );

  // Mark the current assignment as rejected
  await db
    .update(contractorJobs)
    .set({
      status: 'declined',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contractorJobs.id, jobId),
        eq(contractorJobs.contractorId, rejectedById),
      ),
    );

  // Re-run matching with excluded contractors
  const result = await findBestContractorForJob(
    categories,
    date,
    slot,
    pricePence,
    customerLat,
    customerLng,
    excludeIds,
  );

  if (result.success && result.assignedContractor) {
    console.log(
      `[AutoAssign] Re-assigned job ${jobId} to ${result.assignedContractor.name} ` +
      `(${result.assignedContractor.contractorId}) after rejection`,
    );
  } else {
    console.log(
      `[AutoAssign] No more candidates for job ${jobId} after rejection: ${result.reason}`,
    );
  }

  return result;
}
