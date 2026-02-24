/**
 * Lead Scorer Service
 *
 * Updates leads with qualification data from call analysis or webform submissions.
 * Provides consistent scoring and grading across all lead sources.
 */

import { CallAnalysis } from "./call-analyzer";
import { db } from "../db";
import { leads, LeadSegment, QualificationGrade } from "@shared/schema";
import { eq } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

export interface WebformData {
    timing: 'emergency' | 'within_2_3_days' | 'this_week' | 'flexible';
    propertyType: 'own_home' | 'rental_owned' | 'property_managed' | 'business' | 'tenant';
    jobType?: string;
    jobDescription?: string;
    multipleJobs?: boolean;
}

// ============================================================================
// GRADE CALCULATION
// ============================================================================

/**
 * Calculates qualification grade based on score
 *
 * @param score - Qualification score (0-100)
 * @returns 'HOT' | 'WARM' | 'COLD'
 */
export function calculateGrade(score: number): QualificationGrade {
    if (score >= 70) return 'HOT';
    if (score >= 40) return 'WARM';
    return 'COLD';
}

// ============================================================================
// SCORE FROM CALL ANALYSIS
// ============================================================================

/**
 * Updates a lead record with qualification data from AI call analysis
 *
 * @param leadId - The lead ID to update
 * @param analysis - The CallAnalysis result from call-analyzer
 */
export async function scoreLeadFromCallAnalysis(
    leadId: number | string,
    analysis: CallAnalysis
): Promise<void> {
    try {
        const leadIdStr = typeof leadId === 'number' ? String(leadId) : leadId;

        await db.update(leads)
            .set({
                qualificationScore: analysis.qualificationScore,
                qualificationGrade: analysis.qualificationGrade,
                segment: analysis.segment as LeadSegment,
                segmentConfidence: analysis.segmentConfidence,
                segmentSignals: analysis.segmentSignals,
                redFlags: analysis.redFlags,
                scoredAt: new Date(),
                scoredBy: 'ai_call_parser',
                updatedAt: new Date()
            })
            .where(eq(leads.id, leadIdStr));

        console.log(`[LeadScorer] Scored lead ${leadIdStr} from call analysis: ${analysis.qualificationGrade} (${analysis.qualificationScore})`);

    } catch (error) {
        console.error(`[LeadScorer] Error scoring lead ${leadId} from call analysis:`, error);
        throw error;
    }
}

// ============================================================================
// SCORE FROM WEBFORM
// ============================================================================

/**
 * Calculates and updates lead qualification data from webform answers
 *
 * Scoring rules:
 * - timing: emergency (+25), within_2_3_days (+15), this_week (+10), flexible (-10)
 * - propertyType: own_home (+10), rental_owned (+15), property_managed (+15), business (+10), tenant (-10)
 * - jobType: multiple_jobs (+10)
 *
 * @param leadId - The lead ID to update
 * @param formData - The webform submission data
 */
export async function scoreLeadFromWebform(
    leadId: number | string,
    formData: WebformData
): Promise<void> {
    try {
        const leadIdStr = typeof leadId === 'number' ? String(leadId) : leadId;

        // Start with base score of 50
        let score = 50;
        const signals: string[] = [];

        // Timing scoring
        switch (formData.timing) {
            case 'emergency':
                score += 25;
                signals.push('emergency timing');
                break;
            case 'within_2_3_days':
                score += 15;
                signals.push('wants service within 2-3 days');
                break;
            case 'this_week':
                score += 10;
                signals.push('wants service this week');
                break;
            case 'flexible':
                score -= 10;
                signals.push('flexible timing');
                break;
        }

        // Property type scoring and segment detection
        let segment: LeadSegment = 'DEFAULT';

        switch (formData.propertyType) {
            case 'own_home':
                score += 10;
                signals.push('homeowner');
                segment = formData.timing === 'emergency' ? 'EMERGENCY' : 'DIY_DEFERRER';
                break;
            case 'rental_owned':
                score += 15;
                signals.push('landlord - owns rental property');
                segment = 'LANDLORD';
                break;
            case 'property_managed':
                score += 15;
                signals.push('property manager');
                segment = 'PROP_MGR';
                break;
            case 'business':
                score += 10;
                signals.push('business property');
                segment = 'SMALL_BIZ';
                break;
            case 'tenant':
                score -= 10;
                signals.push('tenant - may need landlord approval');
                segment = 'RENTER';
                break;
        }

        // Multiple jobs bonus
        if (formData.multipleJobs || formData.jobType === 'multiple_jobs') {
            score += 10;
            signals.push('multiple jobs mentioned');
        }

        // Clamp score to 0-100
        score = Math.max(0, Math.min(100, score));

        // Calculate grade
        const grade = calculateGrade(score);

        // Update the lead
        await db.update(leads)
            .set({
                qualificationScore: score,
                qualificationGrade: grade,
                segment: segment,
                segmentConfidence: 70, // Webform data is moderately reliable
                segmentSignals: signals,
                redFlags: formData.propertyType === 'tenant' ? ['may need landlord approval'] : [],
                scoredAt: new Date(),
                scoredBy: 'webform',
                updatedAt: new Date()
            })
            .where(eq(leads.id, leadIdStr));

        console.log(`[LeadScorer] Scored lead ${leadIdStr} from webform: ${grade} (${score})`);

    } catch (error) {
        console.error(`[LeadScorer] Error scoring lead ${leadId} from webform:`, error);
        throw error;
    }
}
