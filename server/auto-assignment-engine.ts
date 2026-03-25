/**
 * Auto-Assignment Engine — Round-Robin with Margin Floor
 *
 * When a customer books a quote (selects date + slot), this engine:
 * 1. Builds a shortlist of contractors who:
 *    - Have the required category skills
 *    - Are available on the chosen date/slot
 *    - Have rates that produce a healthy margin
 * 2. Ranks them by round-robin (fewest recent jobs first)
 * 3. Auto-assigns the top-ranked contractor
 *
 * The contractor is GUARANTEED to accept because:
 * - Their skills match (they opted in to the category)
 * - They're available (they set the date)
 * - Their rate is covered (margin checked)
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
// Types
// ---------------------------------------------------------------------------

export interface AssignmentCandidate {
  contractorId: string;     // handymanProfiles.id
  userId: string;           // users.id
  name: string;             // contractor display name
  hourlyRatePence: number;  // their rate for the primary category
  recentJobCount: number;   // jobs in last 30 days (for round-robin)
  marginPercent: number;    // projected margin if assigned
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
 * @param categories  - Job categories (e.g. ['plumbing_minor', 'general_fixing'])
 * @param date        - Booked date (Date object)
 * @param slot        - Booked slot: 'am' | 'pm' | 'full'
 * @param pricePence  - Customer quote price in pence
 */
export async function findBestContractorForJob(
  categories: JobCategory[],
  date: Date,
  slot: 'am' | 'pm' | 'full',
  pricePence: number,
): Promise<AssignmentResult> {
  const primaryCategory = categories[0]; // Primary match only for Phase 1

  // 1. Find contractors with the primary category skill
  const matchingSkills = await db
    .select({
      handymanId: handymanSkills.handymanId,
      hourlyRate: handymanSkills.hourlyRate,
      categorySlug: handymanSkills.categorySlug,
    })
    .from(handymanSkills)
    .where(eq(handymanSkills.categorySlug, primaryCategory));

  if (matchingSkills.length === 0) {
    return {
      success: false,
      assignedContractor: null,
      shortlist: [],
      reason: `No contractors have category '${primaryCategory}' opted in`,
    };
  }

  const contractorIds = Array.from(new Set(matchingSkills.map((s) => s.handymanId)));

  // 2. Check availability for each contractor on the booked date/slot
  const dayOfWeek = date.getDay();
  const availableContractors: string[] = [];

  for (const contractorId of contractorIds) {
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

  // 3. Build candidate list with margin check + job count
  const candidates: AssignmentCandidate[] = [];
  const minMargin = CATEGORY_MIN_MARGINS[primaryCategory] ?? 20;

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

    // Get their rate for this category
    const skill = matchingSkills.find((s) => s.handymanId === contractorId);
    const hourlyRatePence = (skill?.hourlyRate || 0) * 100; // Convert pounds to pence

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
      score: recentJobCount, // Round-robin: fewer jobs = lower score = higher priority
    });
  }

  if (candidates.length === 0) {
    return {
      success: false,
      assignedContractor: null,
      shortlist: [],
      reason: `All available contractors have margin below ${minMargin}% floor for '${primaryCategory}'`,
    };
  }

  // 4. Sort by round-robin score (fewest jobs first, tiebreak by margin)
  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score; // Fewer jobs = priority
    return b.marginPercent - a.marginPercent; // Higher margin = tiebreaker
  });

  const winner = candidates[0];

  console.log(
    `[AutoAssign] Selected ${winner.name} (${winner.contractorId}): ` +
    `${winner.recentJobCount} recent jobs, ${winner.marginPercent}% margin, ` +
    `rate £${(winner.hourlyRatePence / 100).toFixed(2)}/hr`
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
    .select()
    .from(contractorBookingRequests)
    .where(
      and(
        eq(contractorBookingRequests.contractorId, contractorId),
        eq(contractorBookingRequests.requestedDate, date),
        eq(contractorBookingRequests.status, 'accepted')
      )
    );

  if (existingBookings.length === 0) return false;

  // If slot is 'full', any existing booking is a conflict
  if (slot === 'full') return true;

  // For AM/PM, check if the existing booking covers that slot
  // For now, assume any booking on the date for the same slot is a conflict
  // (we'd need requestedSlot field in bookings for precise checking)
  return existingBookings.length > 0;
}
