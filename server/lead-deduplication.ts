// B1: Phone Number Normalization & Duplicate Detection
// B6: Duplicate Lead Detection Service

import { db } from './db';
import { leads, type Lead } from '../shared/schema';
import { eq, and, or, like, sql } from 'drizzle-orm';
import { normalizePhoneNumber } from './phone-utils';

// Fuzzy string matching library
// Note: Install with `npm install fuzzball`
import * as fuzzball from 'fuzzball';

export interface DuplicateDetectionResult {
    isDuplicate: boolean;
    confidence: number; // 0-100
    existingLead?: Lead;
    matchReason?: string;
}

/**
 * B1: Find existing lead by phone number (exact match)
 * Returns the most recent lead if multiple exist
 */
export async function findLeadByPhone(phoneNumber: string): Promise<Lead | null> {
    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) return null;

    try {
        const results = await db
            .select()
            .from(leads)
            .where(eq(leads.phone, normalized))
            .orderBy(sql`${leads.createdAt} DESC`)
            .limit(1);

        return results[0] || null;
    } catch (error) {
        console.error('[findLeadByPhone] Error:', error);
        return null;
    }
}

/**
 * B6: Multi-signal duplicate detection
 * Uses tiered matching strategy:
 * - Tier 1 (100%): Exact phone number match
 * - Tier 2 (85%): Same place_id + similar name
 * - Tier 3 (75%): Same postcode + exact name match
 * - Tier 4 (60%): Same postcode + fuzzy name match (>80% similarity)
 */
export async function findDuplicateLead(
    phoneNumber: string,
    metadata?: {
        customerName?: string | null;
        placeId?: string | null;
        postcode?: string | null;
    }
): Promise<DuplicateDetectionResult> {
    // Tier 1: Exact phone match (highest confidence)
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (normalizedPhone) {
        const phoneMatch = await findLeadByPhone(normalizedPhone);
        if (phoneMatch) {
            return {
                isDuplicate: true,
                confidence: 100,
                existingLead: phoneMatch,
                matchReason: 'Exact phone number match'
            };
        }
    }

    // If no metadata provided, can't do further matching
    if (!metadata) {
        return { isDuplicate: false, confidence: 0 };
    }

    // Tier 2: Place ID + Name similarity (high confidence)
    if (metadata.placeId && metadata.customerName) {
        try {
            const placeMatches = await db
                .select()
                .from(leads)
                .where(eq(leads.placeId, metadata.placeId))
                .limit(10); // Limit to prevent excessive processing

            for (const lead of placeMatches) {
                const nameSimilarity = fuzzball.ratio(
                    metadata.customerName.toLowerCase(),
                    lead.customerName.toLowerCase()
                );

                if (nameSimilarity > 70) {
                    return {
                        isDuplicate: true,
                        confidence: 85,
                        existingLead: lead,
                        matchReason: `Same address (place_id) with ${nameSimilarity}% name match`
                    };
                }
            }
        } catch (error) {
            console.error('[findDuplicateLead] Place ID match error:', error);
        }
    }

    // Tier 3: Postcode + Exact name match (medium-high confidence)
    if (metadata.postcode && metadata.customerName) {
        try {
            const postcodeMatches = await db
                .select()
                .from(leads)
                .where(
                    and(
                        eq(leads.postcode, metadata.postcode),
                        eq(leads.customerName, metadata.customerName)
                    )
                )
                .limit(1);

            if (postcodeMatches.length > 0) {
                return {
                    isDuplicate: true,
                    confidence: 75,
                    existingLead: postcodeMatches[0],
                    matchReason: 'Same postcode and exact name match'
                };
            }
        } catch (error) {
            console.error('[findDuplicateLead] Postcode exact match error:', error);
        }
    }

    // Tier 4: Postcode + Fuzzy name match (medium confidence)
    if (metadata.postcode && metadata.customerName) {
        try {
            const postcodeMatches = await db
                .select()
                .from(leads)
                .where(eq(leads.postcode, metadata.postcode))
                .limit(20); // Limit to prevent excessive processing

            for (const lead of postcodeMatches) {
                const nameSimilarity = fuzzball.ratio(
                    metadata.customerName.toLowerCase(),
                    lead.customerName.toLowerCase()
                );

                if (nameSimilarity > 80) {
                    return {
                        isDuplicate: true,
                        confidence: 60,
                        existingLead: lead,
                        matchReason: `Same postcode with ${nameSimilarity}% name similarity`
                    };
                }
            }
        } catch (error) {
            console.error('[findDuplicateLead] Postcode fuzzy match error:', error);
        }
    }

    // No duplicate found
    return { isDuplicate: false, confidence: 0 };
}

/**
 * Update an existing lead with new call information
 * Appends transcript and updates metadata if more complete
 */
export async function updateExistingLead(
    leadId: string,
    newData: {
        transcription?: string;
        metadata?: any;
        jobDescription?: string;
    }
): Promise<void> {
    try {
        const existing = await db
            .select()
            .from(leads)
            .where(eq(leads.id, leadId))
            .limit(1);

        if (existing.length === 0) {
            console.error('[updateExistingLead] Lead not found:', leadId);
            return;
        }

        const lead = existing[0];

        // Merge job descriptions
        let updatedJobDescription = lead.jobDescription || '';
        if (newData.jobDescription) {
            updatedJobDescription += `\n\n[${new Date().toISOString()}] ${newData.jobDescription}`;
        }

        // Merge transcripts
        let updatedTranscript: any[] = Array.isArray(lead.transcriptJson) ? lead.transcriptJson : [];
        if (newData.transcription) {
            updatedTranscript.push({
                timestamp: new Date().toISOString(),
                text: newData.transcription
            });
        }

        // Update metadata (prefer new values if they're more complete)
        const updates: any = {
            jobDescription: updatedJobDescription,
            transcriptJson: updatedTranscript,
            updatedAt: new Date()
        };

        // Only update address fields if new data is more complete
        if (newData.metadata) {
            if (newData.metadata.addressCanonical && !lead.addressCanonical) {
                updates.addressCanonical = newData.metadata.addressCanonical;
            }
            if (newData.metadata.placeId && !lead.placeId) {
                updates.placeId = newData.metadata.placeId;
            }
            if (newData.metadata.postcode && !lead.postcode) {
                updates.postcode = newData.metadata.postcode;
            }
            if (newData.metadata.coordinates && !lead.coordinates) {
                updates.coordinates = newData.metadata.coordinates;
            }
        }

        await db
            .update(leads)
            .set(updates)
            .where(eq(leads.id, leadId));

        console.log(`[updateExistingLead] Updated lead ${leadId} with new call data`);
    } catch (error) {
        console.error('[updateExistingLead] Error:', error);
    }
}
