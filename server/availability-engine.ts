import { db } from "./db";
import { handymanProfiles, handymanSkills, handymanAvailability, contractorAvailabilityDates, contractorBookingRequests, masterAvailability, masterBlockedDates, users, productizedServices } from "@shared/schema";
import { eq, and, lte, gte, inArray } from "drizzle-orm";

interface Coordinates {
    lat: number;
    lng: number;
}

export interface RankedContractor {
    profile: typeof handymanProfiles.$inferSelect;
    distanceMiles: number;
    score: number;
    skillMatch?: number; // 0-100 skill match percentage
    isAvailableOnDate?: boolean;
    availableSlots?: ('am' | 'pm' | 'full')[];
    user?: {
        firstName: string | null;
        lastName: string | null;
        email: string;
        phone: string | null;
    };
}

export interface ContractorRecommendation {
    contractorId: string;
    contractorName: string;
    email: string;
    phone: string | null;
    distanceMiles: number;
    skillMatchScore: number;
    availabilityScore: number;
    overallScore: number;
    availableSlots: ('am' | 'pm' | 'full')[];
    reasons: string[];
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

    if (contractors.length === 0) {
        for (const date of dates) {
            availabilityMap[date.toISOString().split('T')[0]] = false;
        }
        return availabilityMap;
    }

    const contractorIds = contractors.map(c => c.profile.id);

    // Fetch master blocked dates
    const blockedDates = await db.select()
        .from(masterBlockedDates);
    const blockedDateSet = new Set(blockedDates.map(b => b.date));

    // Fetch master weekly patterns
    const masterPatterns = await db.select()
        .from(masterAvailability)
        .where(eq(masterAvailability.isActive, true));

    // Fetch contractor overrides
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    const overrides = await db.select()
        .from(contractorAvailabilityDates)
        .where(and(
            inArray(contractorAvailabilityDates.contractorId, contractorIds),
            gte(contractorAvailabilityDates.date, startDate),
            lte(contractorAvailabilityDates.date, endDate)
        ));

    // Fetch contractor weekly patterns
    const patterns = await db.select()
        .from(handymanAvailability)
        .where(inArray(handymanAvailability.handymanId, contractorIds));

    // Fetch existing job assignments to check for conflicts
    const existingJobs = await db.select()
        .from(contractorBookingRequests)
        .where(and(
            inArray(contractorBookingRequests.assignedContractorId, contractorIds),
            gte(contractorBookingRequests.scheduledDate, startDate),
            lte(contractorBookingRequests.scheduledDate, endDate),
            eq(contractorBookingRequests.assignmentStatus, 'accepted')
        ));

    // Build lookup maps
    const jobsByDate = new Map<string, Set<string>>();
    for (const job of existingJobs) {
        if (job.scheduledDate && job.assignedContractorId) {
            const dateStr = job.scheduledDate.toISOString().split('T')[0];
            if (!jobsByDate.has(dateStr)) {
                jobsByDate.set(dateStr, new Set());
            }
            jobsByDate.get(dateStr)!.add(job.assignedContractorId);
        }
    }

    for (const date of dates) {
        const dateStr = date.toISOString().split('T')[0];
        const dayOfWeek = date.getDay();

        // Check master blocked dates
        if (blockedDateSet.has(dateStr)) {
            availabilityMap[dateStr] = false;
            continue;
        }

        // Check if master pattern allows this day
        const masterPattern = masterPatterns.find(p => p.dayOfWeek === dayOfWeek);
        if (!masterPattern) {
            availabilityMap[dateStr] = false;
            continue;
        }

        // Check if any contractor is available
        let hasAvailableContractor = false;

        for (const contractor of contractors) {
            const contractorId = contractor.profile.id;

            // Check if contractor already has a job on this date
            if (jobsByDate.get(dateStr)?.has(contractorId)) {
                continue;
            }

            // Check contractor override for this date
            const override = overrides.find(o =>
                o.contractorId === contractorId &&
                o.date.toISOString().split('T')[0] === dateStr
            );

            if (override) {
                if (override.isAvailable) {
                    hasAvailableContractor = true;
                    break;
                }
                continue; // Override says not available
            }

            // Check contractor weekly pattern
            const contractorPattern = patterns.find(p =>
                p.handymanId === contractorId &&
                p.dayOfWeek === dayOfWeek &&
                p.isActive
            );

            if (contractorPattern || masterPattern) {
                hasAvailableContractor = true;
                break;
            }
        }

        availabilityMap[dateStr] = hasAvailableContractor;
    }

    return availabilityMap;
}

/**
 * B5: Finds and ranks contractors for a job based on:
 * - Location (proximity to job)
 * - Skills (matching job requirements)
 * - Availability (on requested date)
 *
 * Returns sorted list of best-fit contractors with detailed scoring.
 */
export interface RecommendContractorsOptions {
    jobLocation?: Coordinates;
    jobCategories?: string[]; // e.g., ['plumbing', 'electrical']
    scheduledDate?: Date;
    includeUnavailable?: boolean; // Include contractors not available on date
}

export async function recommendContractorsForJob(
    options: RecommendContractorsOptions
): Promise<ContractorRecommendation[]> {
    const { jobLocation, jobCategories = [], scheduledDate, includeUnavailable = false } = options;

    // 1. Fetch all contractors with their skills and user info
    const allContractors = await db.query.handymanProfiles.findMany({
        with: {
            user: true,
            skills: {
                with: {
                    service: true
                }
            },
            availability: true
        }
    });

    // 2. Fetch master patterns for availability check
    const masterPatterns = await db.select()
        .from(masterAvailability)
        .where(eq(masterAvailability.isActive, true));

    // 3. Fetch blocked dates
    const blockedDates = await db.select()
        .from(masterBlockedDates);
    const blockedDateSet = new Set(blockedDates.map(b => b.date));

    // 4. If date specified, fetch overrides and existing jobs
    let overrides: any[] = [];
    let existingJobs: any[] = [];

    if (scheduledDate) {
        const dateStr = scheduledDate.toISOString().split('T')[0];

        // Check if date is blocked
        if (blockedDateSet.has(dateStr)) {
            return []; // No one available on blocked date
        }

        overrides = await db.select()
            .from(contractorAvailabilityDates)
            .where(eq(contractorAvailabilityDates.date, scheduledDate));

        existingJobs = await db.select()
            .from(contractorBookingRequests)
            .where(and(
                eq(contractorBookingRequests.scheduledDate, scheduledDate),
                eq(contractorBookingRequests.assignmentStatus, 'accepted')
            ));
    }

    const busyContractorIds = new Set(existingJobs.map(j => j.assignedContractorId).filter(Boolean));

    const recommendations: ContractorRecommendation[] = [];

    for (const contractor of allContractors) {
        if (!contractor.user) continue;

        const reasons: string[] = [];
        let locationScore = 50; // Default neutral score if no location
        let skillScore = 0;
        let availabilityScore = 0;
        let distanceMiles = 0;

        // === LOCATION SCORING ===
        if (jobLocation && contractor.latitude && contractor.longitude) {
            const contractorLocation = {
                lat: parseFloat(contractor.latitude),
                lng: parseFloat(contractor.longitude)
            };

            distanceMiles = calculateDistanceMiles(jobLocation, contractorLocation);

            if (distanceMiles <= contractor.radiusMiles) {
                // Within service area
                locationScore = Math.round((1 - (distanceMiles / contractor.radiusMiles)) * 100);
                reasons.push(`${distanceMiles.toFixed(1)} miles away`);
            } else {
                // Outside service area
                locationScore = 0;
                if (!includeUnavailable) continue;
                reasons.push(`Outside service area (${distanceMiles.toFixed(1)} mi)`);
            }
        } else if (jobLocation) {
            // Job has location but contractor doesn't
            locationScore = 25;
            reasons.push('Location not set');
        }

        // === SKILL SCORING ===
        if (jobCategories.length > 0) {
            const contractorCategories = contractor.skills
                .map(s => s.service?.category?.toLowerCase())
                .filter(Boolean) as string[];

            const matchedCategories = jobCategories.filter(cat =>
                contractorCategories.includes(cat.toLowerCase())
            );

            if (matchedCategories.length > 0) {
                skillScore = Math.round((matchedCategories.length / jobCategories.length) * 100);
                reasons.push(`Skilled in: ${matchedCategories.join(', ')}`);
            } else {
                skillScore = 0;
                if (!includeUnavailable) continue;
                reasons.push('No matching skills');
            }
        } else {
            // No specific skills required - neutral score
            skillScore = 50;
        }

        // === AVAILABILITY SCORING ===
        const availableSlots: ('am' | 'pm' | 'full')[] = [];

        if (scheduledDate) {
            const dateStr = scheduledDate.toISOString().split('T')[0];
            const dayOfWeek = scheduledDate.getDay();

            // Check if already has job
            if (busyContractorIds.has(contractor.id)) {
                availabilityScore = 0;
                if (!includeUnavailable) continue;
                reasons.push('Already booked on this date');
            } else {
                // Check override
                const override = overrides.find(o => o.contractorId === contractor.id);

                if (override) {
                    if (override.isAvailable) {
                        availabilityScore = 100;
                        availableSlots.push(...determineSlots(override.startTime, override.endTime));
                        reasons.push('Available (confirmed)');
                    } else {
                        availabilityScore = 0;
                        if (!includeUnavailable) continue;
                        reasons.push('Marked unavailable');
                    }
                } else {
                    // Check weekly pattern
                    const pattern = contractor.availability.find(a =>
                        a.dayOfWeek === dayOfWeek && a.isActive
                    );
                    const masterPattern = masterPatterns.find(p => p.dayOfWeek === dayOfWeek);

                    if (pattern) {
                        availabilityScore = 80;
                        availableSlots.push(...determineSlots(pattern.startTime, pattern.endTime));
                        reasons.push('Available (pattern)');
                    } else if (masterPattern) {
                        availabilityScore = 60;
                        availableSlots.push(...determineSlots(masterPattern.startTime, masterPattern.endTime));
                        reasons.push('Available (default hours)');
                    } else {
                        availabilityScore = 0;
                        if (!includeUnavailable) continue;
                        reasons.push('Not available on this day');
                    }
                }
            }
        } else {
            // No specific date - neutral score
            availabilityScore = 50;
        }

        // === OVERALL SCORE ===
        // Weights: Availability (40%), Skills (35%), Location (25%)
        const overallScore = Math.round(
            (availabilityScore * 0.40) +
            (skillScore * 0.35) +
            (locationScore * 0.25)
        );

        const contractorName = [contractor.user.firstName, contractor.user.lastName]
            .filter(Boolean)
            .join(' ') || contractor.user.email;

        recommendations.push({
            contractorId: contractor.id,
            contractorName,
            email: contractor.user.email,
            phone: contractor.user.phone,
            distanceMiles,
            skillMatchScore: skillScore,
            availabilityScore,
            overallScore,
            availableSlots,
            reasons
        });
    }

    // Sort by overall score descending
    return recommendations.sort((a, b) => b.overallScore - a.overallScore);
}

/**
 * Helper to determine time slots from start/end times
 */
function determineSlots(startTime: string | null, endTime: string | null): ('am' | 'pm' | 'full')[] {
    if (!startTime || !endTime) return ['full'];

    const startHour = parseInt(startTime.split(':')[0]);
    const endHour = parseInt(endTime.split(':')[0]);

    const slots: ('am' | 'pm' | 'full')[] = [];

    // AM: before 12
    // PM: 12 and after
    // Full: spans both

    if (startHour < 12 && endHour > 12) {
        slots.push('full');
    } else {
        if (startHour < 12) slots.push('am');
        if (endHour >= 12) slots.push('pm');
    }

    return slots.length > 0 ? slots : ['full'];
}

/**
 * B5: Check if a specific contractor is available on a specific date
 */
export async function checkContractorAvailability(
    contractorId: string,
    date: Date
): Promise<{ isAvailable: boolean; slots: ('am' | 'pm' | 'full')[]; reason: string }> {
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();

    // Check master blocked dates
    const blockedDates = await db.select()
        .from(masterBlockedDates)
        .where(eq(masterBlockedDates.date, dateStr));

    if (blockedDates.length > 0) {
        return {
            isAvailable: false,
            slots: [],
            reason: blockedDates[0].reason || 'System blocked date'
        };
    }

    // Check existing jobs
    const existingJobs = await db.select()
        .from(contractorBookingRequests)
        .where(and(
            eq(contractorBookingRequests.assignedContractorId, contractorId),
            eq(contractorBookingRequests.scheduledDate, date),
            eq(contractorBookingRequests.assignmentStatus, 'accepted')
        ));

    if (existingJobs.length > 0) {
        return {
            isAvailable: false,
            slots: [],
            reason: 'Already has a job scheduled'
        };
    }

    // Check override
    const override = await db.select()
        .from(contractorAvailabilityDates)
        .where(and(
            eq(contractorAvailabilityDates.contractorId, contractorId),
            eq(contractorAvailabilityDates.date, date)
        ))
        .limit(1);

    if (override.length > 0) {
        if (override[0].isAvailable) {
            return {
                isAvailable: true,
                slots: determineSlots(override[0].startTime, override[0].endTime),
                reason: 'Available (override set)'
            };
        } else {
            return {
                isAvailable: false,
                slots: [],
                reason: override[0].notes || 'Marked as unavailable'
            };
        }
    }

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
        return {
            isAvailable: true,
            slots: determineSlots(pattern[0].startTime, pattern[0].endTime),
            reason: 'Available (weekly pattern)'
        };
    }

    // Check master pattern as fallback
    const masterPattern = await db.select()
        .from(masterAvailability)
        .where(and(
            eq(masterAvailability.dayOfWeek, dayOfWeek),
            eq(masterAvailability.isActive, true)
        ))
        .limit(1);

    if (masterPattern.length > 0) {
        return {
            isAvailable: true,
            slots: determineSlots(masterPattern[0].startTime, masterPattern[0].endTime),
            reason: 'Available (default hours)'
        };
    }

    return {
        isAvailable: false,
        slots: [],
        reason: 'No availability set for this day'
    };
}
