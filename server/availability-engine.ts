import { db } from "./db";
import { handymanProfiles, handymanSkills, handymanAvailability, contractorAvailabilityDates, contractorJobs } from "@shared/schema";
import { eq, and, lte, gte, inArray } from "drizzle-orm";

interface Coordinates {
    lat: number;
    lng: number;
}

export interface RankedContractor {
    profile: typeof handymanProfiles.$inferSelect;
    distanceMiles: number;
    score: number;
}

/**
 * Calculates distance between two coordinates in miles using Haversine formula
 */
function calculateDistanceMiles(coord1: Coordinates, coord2: Coordinates): number {
    const R = 3959; // Earth radius in miles
    const dLat = toRad(coord2.lat - coord1.lat);
    const dLon = toRad(coord2.lng - coord1.lng);
    const lat1 = toRad(coord1.lat);
    const lat2 = toRad(coord2.lat);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(degrees: number): number {
    return degrees * Math.PI / 180;
}

/**
 * Finds the best contractors for a job based on location.
 * Filters by radius and ranks by proximity.
 */
export async function findBestContractors(
    jobLocation: Coordinates
): Promise<RankedContractor[]> {
    // 1. Fetch all active contractors (verified or public)
    // For V1 Beta, we assume all contractors in DB are candidates if they have location set
    const allContractors = await db.query.handymanProfiles.findMany({
        where: eq(handymanProfiles.publicProfileEnabled, true),
        // We could also check verificationStatus here
    });

    const ranked: RankedContractor[] = [];

    for (const contractor of allContractors) {
        if (!contractor.latitude || !contractor.longitude) continue;

        const contractorLocation = {
            lat: parseFloat(contractor.latitude),
            lng: parseFloat(contractor.longitude)
        };

        const distance = calculateDistanceMiles(jobLocation, contractorLocation);

        // Check if within service radius
        if (distance <= contractor.radiusMiles) {
            // Scoring: Closer is better. 
            // 0 distance = 100 score. Max radius distance = 0 score.
            const score = Math.max(0, (1 - (distance / contractor.radiusMiles)) * 100);

            ranked.push({
                profile: contractor,
                distanceMiles: distance,
                score
            });
        }
    }

    // Sort by score descending (best match first)
    return ranked.sort((a, b) => b.score - a.score);
}

/**
 * Checks availability for multiple dates for a set of contractors.
 * Returns true if ANY contractor is available on that date.
 */
export async function checkNetworkAvailability(
    contractors: RankedContractor[],
    dates: Date[]
): Promise<Record<string, boolean>> {
    const availabilityMap: Record<string, boolean> = {};

    // For V1, simplified check:
    // If we have contractors, we say "Yes" for now, or check generic availability.
    // Real implementation requires checking their calendars.

    // Placeholder: Return true for all dates if we have any contractors
    const hasContractors = contractors.length > 0;

    for (const date of dates) {
        availabilityMap[date.toISOString().split('T')[0]] = hasContractors;
    }

    return availabilityMap;
}
