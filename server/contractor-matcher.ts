/**
 * Contractor Matcher — Skill + Location Matching at Quote Creation Time
 *
 * Finds contractors who can fulfil the categories in a quote and are within
 * service radius of the customer's postcode. Builds a "candidate pool" that
 * is stored on the quote and used later by the availability engine.
 *
 * Called at quote creation time (non-blocking) so the quote page only shows
 * availability for contractors who can actually do the work.
 */

import { db } from './db';
import { handymanSkills, handymanProfiles, users } from '../shared/schema';
import { inArray } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CandidateContractor {
  contractorId: string;
  contractorName: string;
  coveragePercent: number;     // what % of required categories they cover
  coveredCategories: string[];
  distanceMiles: number | null;
}

export interface ContractorMatchResult {
  candidates: CandidateContractor[];
  fullCoverageCandidates: number;
  partialCoverageCandidates: number;
  uncoveredCategories: string[];
}

// ---------------------------------------------------------------------------
// Haversine Distance
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
// Main Function
// ---------------------------------------------------------------------------

/**
 * Find contractors who can service a quote based on category skills and location.
 *
 * Steps:
 *   1. Query handymanSkills for contractors with ANY of the required categories
 *   2. Group by contractor, calculating which categories each covers
 *   3. Filter to only verified/active contractors
 *   4. If customer coordinates available, filter by service radius (Haversine)
 *   5. Sort: full coverage first, then by distance
 */
export async function findCandidateContractors(params: {
  categorySlugs: string[];
  customerPostcode?: string;
  customerLat?: number;
  customerLng?: number;
}): Promise<ContractorMatchResult> {
  const { categorySlugs, customerLat, customerLng } = params;

  if (categorySlugs.length === 0) {
    return {
      candidates: [],
      fullCoverageCandidates: 0,
      partialCoverageCandidates: 0,
      uncoveredCategories: [],
    };
  }

  // 1. Find all skills matching any of the required categories
  const matchingSkills = await db
    .select({
      handymanId: handymanSkills.handymanId,
      categorySlug: handymanSkills.categorySlug,
      proficiency: handymanSkills.proficiency,
    })
    .from(handymanSkills)
    .where(inArray(handymanSkills.categorySlug, categorySlugs));

  if (matchingSkills.length === 0) {
    return {
      candidates: [],
      fullCoverageCandidates: 0,
      partialCoverageCandidates: 0,
      uncoveredCategories: [...categorySlugs],
    };
  }

  // 2. Group skills by contractor
  const skillsByContractor = new Map<string, Set<string>>();
  for (const skill of matchingSkills) {
    if (!skill.categorySlug) continue;
    const existing = skillsByContractor.get(skill.handymanId) || new Set();
    existing.add(skill.categorySlug);
    skillsByContractor.set(skill.handymanId, existing);
  }

  const contractorIds = Array.from(skillsByContractor.keys());
  if (contractorIds.length === 0) {
    return {
      candidates: [],
      fullCoverageCandidates: 0,
      partialCoverageCandidates: 0,
      uncoveredCategories: [...categorySlugs],
    };
  }

  // 3. Fetch profiles for these contractors — filter to verified/active
  const profiles = await db
    .select({
      id: handymanProfiles.id,
      userId: handymanProfiles.userId,
      latitude: handymanProfiles.latitude,
      longitude: handymanProfiles.longitude,
      radiusMiles: handymanProfiles.radiusMiles,
      verificationStatus: handymanProfiles.verificationStatus,
      publicProfileEnabled: handymanProfiles.publicProfileEnabled,
    })
    .from(handymanProfiles)
    .where(inArray(handymanProfiles.id, contractorIds));

  // Filter to verified or active contractors (verified status, or public profile enabled as fallback)
  const activeProfiles = profiles.filter(
    (p) => p.verificationStatus === 'verified' || p.publicProfileEnabled === true,
  );

  if (activeProfiles.length === 0) {
    return {
      candidates: [],
      fullCoverageCandidates: 0,
      partialCoverageCandidates: 0,
      uncoveredCategories: [...categorySlugs],
    };
  }

  // 4. Fetch user names for active contractors
  const activeUserIds = activeProfiles.map((p) => p.userId);
  const userRecords = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(inArray(users.id, activeUserIds));

  const userNameMap = new Map<string, string>();
  for (const u of userRecords) {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown';
    userNameMap.set(u.id, name);
  }

  // 5. Build candidate list with coverage + distance
  const hasCustomerLocation = customerLat != null && customerLng != null;
  const candidates: CandidateContractor[] = [];

  // Track which categories are covered by at least one contractor
  const allCoveredCategories = new Set<string>();

  for (const profile of activeProfiles) {
    const coveredSet = skillsByContractor.get(profile.id);
    if (!coveredSet) continue;

    const coveredCategories = Array.from(coveredSet);
    const coveragePercent = Math.round((coveredCategories.length / categorySlugs.length) * 100);
    const contractorName = userNameMap.get(profile.userId) || 'Unknown';

    // Distance filtering
    let distanceMiles: number | null = null;

    if (hasCustomerLocation && profile.latitude && profile.longitude) {
      const cLat = parseFloat(profile.latitude);
      const cLng = parseFloat(profile.longitude);

      if (!isNaN(cLat) && !isNaN(cLng)) {
        distanceMiles = haversineDistance(customerLat!, customerLng!, cLat, cLng);

        // Filter out contractors beyond their service radius
        if (distanceMiles > profile.radiusMiles) {
          continue;
        }
      }
    }

    // Track globally covered categories
    for (const cat of coveredCategories) {
      allCoveredCategories.add(cat);
    }

    candidates.push({
      contractorId: profile.id,
      contractorName,
      coveragePercent,
      coveredCategories,
      distanceMiles,
    });
  }

  // 6. Sort: full coverage first, then by distance (closest first), then by coverage %
  candidates.sort((a, b) => {
    // Full coverage comes first
    if (a.coveragePercent === 100 && b.coveragePercent !== 100) return -1;
    if (b.coveragePercent === 100 && a.coveragePercent !== 100) return 1;

    // Within same coverage tier, sort by distance (nulls last)
    if (a.distanceMiles != null && b.distanceMiles != null) {
      return a.distanceMiles - b.distanceMiles;
    }
    if (a.distanceMiles != null) return -1;
    if (b.distanceMiles != null) return 1;

    // Fallback: higher coverage %
    return b.coveragePercent - a.coveragePercent;
  });

  // 7. Calculate summary stats
  const fullCoverage = candidates.filter((c) => c.coveragePercent === 100).length;
  const partialCoverage = candidates.filter((c) => c.coveragePercent < 100).length;
  const uncoveredCategories = categorySlugs.filter((cat) => !allCoveredCategories.has(cat));

  console.log(
    `[ContractorMatcher] Found ${candidates.length} candidates ` +
    `(${fullCoverage} full, ${partialCoverage} partial) ` +
    `for categories [${categorySlugs.join(', ')}]` +
    (uncoveredCategories.length > 0 ? ` — uncovered: [${uncoveredCategories.join(', ')}]` : ''),
  );

  return {
    candidates,
    fullCoverageCandidates: fullCoverage,
    partialCoverageCandidates: partialCoverage,
    uncoveredCategories,
  };
}
