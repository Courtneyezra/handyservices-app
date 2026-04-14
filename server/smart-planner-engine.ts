/**
 * Smart Planner Engine — Distance-Based Clustering for Daily Planner
 *
 * Pure logic module (no Express dependencies) that:
 * 1. Clusters pool jobs by geographic distance (haversine)
 * 2. Scores contractors for each cluster
 * 3. Suggests best-fit dates when a different day would group better
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolJob {
  id: string;
  customerName: string;
  phone: string;
  address: string | null;
  postcode: string | null;
  coordinates: { lat: number; lng: number } | null;
  availableDates: string[];
  basePrice: number;
  pricingLineItems: any;
  contextualHeadline: string | null;
  jobDescription: string;
}

export interface Contractor {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  postcode: string | null;
  radiusMiles: number;
  skills: string[];
  lastAssignedAt: Date | null;
}

export interface Cluster {
  jobs: PoolJob[];
  centroidLat: number;
  centroidLng: number;
  radiusMiles: number;
  areaLabel: string;
}

export interface ScoredContractor {
  id: string;
  name: string;
  score: number;
  reasons: string[];
  existingJobsOnDate: number;
  skills: string[];
  postcode: string | null;
  distanceMiles: number | null;
}

export interface BestFitDate {
  date: string;
  nearbyCount: number;
}

export interface SmartCluster {
  areaLabel: string;
  centroidLat: number;
  centroidLng: number;
  radiusMiles: number;
  jobs: Array<PoolJob & { bestFitDate: BestFitDate | null }>;
  totalValuePence: number;
  totalJobs: number;
  suggestedContractor: ScoredContractor | null;
  allContractors: Array<{ id: string; name: string; score: number; existingJobsOnDate: number }>;
}

export interface SmartGroupResponse {
  date: string;
  clusters: SmartCluster[];
  unlocated: SmartCluster | null;
}

// ---------------------------------------------------------------------------
// Haversine Distance (copied from auto-assignment-engine.ts)
// ---------------------------------------------------------------------------

function toRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

/**
 * Calculate distance between two coordinates in miles using Haversine formula.
 */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

// ---------------------------------------------------------------------------
// Job category extraction
// ---------------------------------------------------------------------------

export function extractJobCategories(lineItems: any): string[] {
  if (!lineItems || !Array.isArray(lineItems)) return [];
  return lineItems
    .map((item: any) => item.category)
    .filter(Boolean) as string[];
}

// ---------------------------------------------------------------------------
// Coordinate extraction from job
// ---------------------------------------------------------------------------

function getCoords(job: PoolJob): { lat: number; lng: number } | null {
  if (!job.coordinates) return null;
  const coords = typeof job.coordinates === 'string'
    ? JSON.parse(job.coordinates)
    : job.coordinates;
  if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
    return coords;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Postcode prefix extraction
// ---------------------------------------------------------------------------

function getPostcodePrefix(postcode: string | null): string {
  if (!postcode) return 'UNKNOWN';
  const match = postcode.trim().toUpperCase().match(/^([A-Z]{1,2}\d{1,2})/);
  return match ? match[1] : 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// clusterJobsByDistance — Greedy geographic clustering
// ---------------------------------------------------------------------------

export function clusterJobsByDistance(jobs: PoolJob[], radiusMiles: number = 2.5): Cluster[] {
  const located: Array<{ job: PoolJob; lat: number; lng: number }> = [];
  const unlocated: PoolJob[] = [];

  for (const job of jobs) {
    const coords = getCoords(job);
    if (coords) {
      located.push({ job, lat: coords.lat, lng: coords.lng });
    } else {
      unlocated.push(job);
    }
  }

  const visited = new Set<number>();
  const clusters: Cluster[] = [];

  for (let i = 0; i < located.length; i++) {
    if (visited.has(i)) continue;

    // Step 1: Pick seed
    visited.add(i);
    const clusterMembers: number[] = [i];

    // Step 2: Pull in all unvisited jobs within radiusMiles of seed
    for (let j = 0; j < located.length; j++) {
      if (visited.has(j)) continue;
      const dist = haversineDistance(located[i].lat, located[i].lng, located[j].lat, located[j].lng);
      if (dist <= radiusMiles) {
        visited.add(j);
        clusterMembers.push(j);
      }
    }

    // Step 3: Compute centroid
    let centroidLat = 0;
    let centroidLng = 0;
    for (const idx of clusterMembers) {
      centroidLat += located[idx].lat;
      centroidLng += located[idx].lng;
    }
    centroidLat /= clusterMembers.length;
    centroidLng /= clusterMembers.length;

    // Step 4: Re-scan — pull in remaining jobs within radiusMiles of centroid
    for (let j = 0; j < located.length; j++) {
      if (visited.has(j)) continue;
      const dist = haversineDistance(centroidLat, centroidLng, located[j].lat, located[j].lng);
      if (dist <= radiusMiles) {
        visited.add(j);
        clusterMembers.push(j);
      }
    }

    // Recompute centroid after re-scan
    centroidLat = 0;
    centroidLng = 0;
    for (const idx of clusterMembers) {
      centroidLat += located[idx].lat;
      centroidLng += located[idx].lng;
    }
    centroidLat /= clusterMembers.length;
    centroidLng /= clusterMembers.length;

    // Compute max distance from centroid to any member (actual cluster radius)
    let maxDist = 0;
    for (const idx of clusterMembers) {
      const dist = haversineDistance(centroidLat, centroidLng, located[idx].lat, located[idx].lng);
      if (dist > maxDist) maxDist = dist;
    }

    // Derive area label from postcodes
    const postcodes = clusterMembers
      .map(idx => getPostcodePrefix(located[idx].job.postcode))
      .filter(p => p !== 'UNKNOWN');
    const uniquePostcodes = [...new Set(postcodes)];
    const areaLabel = uniquePostcodes.length > 0
      ? uniquePostcodes.join(' / ') + ' area'
      : 'Unknown area';

    clusters.push({
      jobs: clusterMembers.map(idx => located[idx].job),
      centroidLat: Math.round(centroidLat * 1e6) / 1e6,
      centroidLng: Math.round(centroidLng * 1e6) / 1e6,
      radiusMiles: Math.round(maxDist * 10) / 10,
      areaLabel,
    });
  }

  // Add unlocated bucket if any
  if (unlocated.length > 0) {
    clusters.push({
      jobs: unlocated,
      centroidLat: 0,
      centroidLng: 0,
      radiusMiles: 0,
      areaLabel: 'Unlocated jobs',
    });
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// computeContractorScore — Score a contractor for a cluster
// ---------------------------------------------------------------------------

const MAX_JOBS_PER_DAY = 5;

export function computeContractorScore(
  contractor: Contractor,
  cluster: Cluster,
  date: string,
  existingCommitments: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  // Collect all job categories in the cluster
  const jobCategories = new Set<string>();
  for (const job of cluster.jobs) {
    for (const cat of extractJobCategories(job.pricingLineItems)) {
      jobCategories.add(cat);
    }
  }

  // --- Skill coverage: +30 points (% of cluster categories the contractor can do) ---
  // Return -1 if coverage < 100%
  const totalCategories = jobCategories.size;
  if (totalCategories > 0) {
    const covered = [...jobCategories].filter(cat => contractor.skills.includes(cat)).length;
    const coveragePct = covered / totalCategories;

    if (coveragePct < 1) {
      return { score: -1, reasons: [`Missing skills: covers ${covered}/${totalCategories} categories`] };
    }
    const skillScore = Math.round(30 * coveragePct);
    reasons.push(`${covered}/${totalCategories} skills matched`);
  } else {
    // No categories extracted — don't penalize
    reasons.push('No categories to match');
  }

  let score = 0;

  // --- Proximity: +30 points (inverse of distance, capped at contractor's radiusMiles) ---
  if (contractor.latitude != null && contractor.longitude != null && cluster.centroidLat !== 0) {
    const dist = haversineDistance(
      contractor.latitude, contractor.longitude,
      cluster.centroidLat, cluster.centroidLng,
    );

    if (dist > contractor.radiusMiles) {
      return { score: -1, reasons: [`Too far: ${dist.toFixed(1)}mi exceeds ${contractor.radiusMiles}mi radius`] };
    }

    // Inverse linear: closer = higher score, max 30 at distance 0
    const proximityScore = Math.round(30 * Math.max(0, 1 - dist / contractor.radiusMiles));
    score += proximityScore;
    reasons.push(`${dist.toFixed(1)}mi from cluster (+${proximityScore})`);

    // --- Bonus: +10 if within 1 mile of centroid ---
    if (dist <= 1) {
      score += 10;
      reasons.push('Within 1mi bonus (+10)');
    }
  } else {
    reasons.push('No location data');
  }

  // Skill coverage score (always 30 if we got here — coverage is 100%)
  score += 30;

  // --- Capacity remaining: +20 points (MAX_JOBS_PER_DAY minus existing commitments) ---
  const remaining = Math.max(0, MAX_JOBS_PER_DAY - existingCommitments);
  const capacityScore = Math.round(20 * (remaining / MAX_JOBS_PER_DAY));
  score += capacityScore;
  reasons.push(`${existingCommitments} jobs on date, ${remaining} capacity (+${capacityScore})`);

  // --- Workload balance: +10 points (fewer recent jobs = higher) ---
  // Use lastAssignedAt as a proxy — longer ago = higher score
  if (!contractor.lastAssignedAt) {
    score += 10;
    reasons.push('Never assigned (+10)');
  } else {
    const daysSinceAssigned = Math.floor(
      (Date.now() - contractor.lastAssignedAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    const balanceScore = Math.min(10, daysSinceAssigned);
    score += balanceScore;
    reasons.push(`${daysSinceAssigned}d since last job (+${balanceScore})`);
  }

  return { score, reasons };
}

// ---------------------------------------------------------------------------
// computeBestFitDate — Find which available date has the most nearby pool jobs
// ---------------------------------------------------------------------------

export function computeBestFitDate(
  job: PoolJob,
  allPoolJobs: PoolJob[],
): BestFitDate | null {
  const coords = getCoords(job);
  if (!coords) return null;

  const availDates = job.availableDates;
  if (!availDates || availDates.length <= 1) return null;

  // Normalize first available date
  const firstDate = availDates[0].split('T')[0];

  let bestDate = firstDate;
  let bestCount = 0;

  for (const dateStr of availDates) {
    const normalizedDate = dateStr.split('T')[0];

    // Count other pool jobs available on this date that are within 3 miles
    let nearbyCount = 0;
    for (const other of allPoolJobs) {
      if (other.id === job.id) continue;

      const otherCoords = getCoords(other);
      if (!otherCoords) continue;

      const otherAvail = other.availableDates;
      if (!otherAvail || !Array.isArray(otherAvail)) continue;

      const availOnDate = otherAvail.some(d => d.split('T')[0] === normalizedDate);
      if (!availOnDate) continue;

      const dist = haversineDistance(coords.lat, coords.lng, otherCoords.lat, otherCoords.lng);
      if (dist <= 3) {
        nearbyCount++;
      }
    }

    if (nearbyCount > bestCount) {
      bestCount = nearbyCount;
      bestDate = normalizedDate;
    }
  }

  // Only suggest if a different date is better than the first available
  if (bestDate !== firstDate && bestCount > 0) {
    return { date: bestDate, nearbyCount: bestCount };
  }

  return null;
}

// ---------------------------------------------------------------------------
// generateSmartGrouping — Main entry point
// ---------------------------------------------------------------------------

export function generateSmartGrouping(
  poolJobs: PoolJob[],
  contractors: Contractor[],
  date: string,
  commitmentsByContractor: Map<string, number>,
): SmartGroupResponse {
  // 1. Filter pool jobs available on `date` that aren't yet booked
  const jobsForDate = poolJobs.filter(j => {
    if (!j.availableDates || !Array.isArray(j.availableDates)) return false;
    return j.availableDates.some(d => d.split('T')[0] === date);
  });

  // 2. Cluster by distance
  const rawClusters = clusterJobsByDistance(jobsForDate);

  // Separate unlocated cluster
  let unlocatedCluster: Cluster | null = null;
  const locatedClusters = rawClusters.filter(c => {
    if (c.areaLabel === 'Unlocated jobs') {
      unlocatedCluster = c;
      return false;
    }
    return true;
  });

  // 3. Score contractors for each cluster
  const smartClusters: SmartCluster[] = [];

  for (const cluster of locatedClusters) {
    const contractorScores: ScoredContractor[] = [];

    for (const contractor of contractors) {
      const existing = commitmentsByContractor.get(contractor.id) || 0;
      const { score, reasons } = computeContractorScore(contractor, cluster, date, existing);

      if (score < 0) continue; // Disqualified (missing skills or too far)

      let distanceMiles: number | null = null;
      if (contractor.latitude != null && contractor.longitude != null && cluster.centroidLat !== 0) {
        distanceMiles = Math.round(
          haversineDistance(contractor.latitude, contractor.longitude, cluster.centroidLat, cluster.centroidLng) * 10,
        ) / 10;
      }

      contractorScores.push({
        id: contractor.id,
        name: contractor.name,
        score,
        reasons,
        existingJobsOnDate: existing,
        skills: contractor.skills,
        postcode: contractor.postcode,
        distanceMiles,
      });
    }

    // Sort by score descending
    contractorScores.sort((a, b) => b.score - a.score);

    const suggestedContractor = contractorScores.length > 0 ? contractorScores[0] : null;

    // 4. Compute best-fit date for each job
    const jobsWithHints = cluster.jobs.map(job => ({
      ...job,
      bestFitDate: computeBestFitDate(job, poolJobs),
    }));

    const radiusLabel = cluster.radiusMiles > 0
      ? ` \u2014 ${cluster.radiusMiles}mi radius`
      : '';

    smartClusters.push({
      areaLabel: `${cluster.areaLabel}${radiusLabel}`,
      centroidLat: cluster.centroidLat,
      centroidLng: cluster.centroidLng,
      radiusMiles: cluster.radiusMiles,
      jobs: jobsWithHints,
      totalValuePence: cluster.jobs.reduce((sum, j) => sum + (j.basePrice || 0), 0),
      totalJobs: cluster.jobs.length,
      suggestedContractor,
      allContractors: contractorScores.map(c => ({
        id: c.id,
        name: c.name,
        score: c.score,
        existingJobsOnDate: c.existingJobsOnDate,
      })),
    });
  }

  // Sort clusters by job count descending
  smartClusters.sort((a, b) => b.totalJobs - a.totalJobs);

  // Build unlocated smart cluster if needed
  let unlocatedSmart: SmartCluster | null = null;
  if (unlocatedCluster) {
    const uc = unlocatedCluster as Cluster;
    unlocatedSmart = {
      areaLabel: 'Unlocated jobs',
      centroidLat: 0,
      centroidLng: 0,
      radiusMiles: 0,
      jobs: uc.jobs.map(job => ({ ...job, bestFitDate: null })),
      totalValuePence: uc.jobs.reduce((sum, j) => sum + (j.basePrice || 0), 0),
      totalJobs: uc.jobs.length,
      suggestedContractor: null,
      allContractors: [],
    };
  }

  return {
    date,
    clusters: smartClusters,
    unlocated: unlocatedSmart,
  };
}
