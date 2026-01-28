import { Router } from "express";
import { classifyLead, determineQuoteStrategy } from "./openai";

const router = Router();

// Route Analysis & Recommendation Endpoint
router.post("/api/quotes/analyze-route", async (req, res) => {
    try {
        const { jobDescription } = req.body;

        if (!jobDescription) {
            return res.status(400).json({ error: "Job description is required" });
        }

        // 1. Get AI Classification Signals
        const classification = await classifyLead(jobDescription);

        // 2. Determine Optimal Route based on Signals
        // "The Matrix" Logic
        let recommendedRoute: 'instant' | 'tiers' | 'assessment' = 'tiers';
        let reasoning = "Standard job profile.";

        // ==========================================
        // B5: "TRIAGE FIRST" ROUTING LOGIC
        // ==========================================
        // Priority Order:
        // 1. Emergency Override (always instant)
        // 2. Simple/Clear Tasks (instant)
        // 3. Commercial Segmentation (varies by type)
        // 4. Residential Complex (Brain Bias -> Video)
        // 5. Vague/Diagnostic (Visit)

        // STEP 1: Emergency Override
        if (classification.urgency === 'asap' || classification.jobType === 'fault') {
            recommendedRoute = 'instant';
            reasoning = "Emergency/urgent job requires immediate response via phone.";
        }
        // STEP 2: Simple/Clear Tasks
        else if (classification.jobType === 'commodity' && classification.jobClarity === 'known') {
            recommendedRoute = 'instant';
            reasoning = "Clear, standard task suitable for fixed pricing.";
        }
        // STEP 3: Commercial Segmentation
        else if (classification.clientType === 'commercial') {
            // Commercial clients follow same hierarchy but default to Visit for complex jobs
            if (classification.jobClarity === 'known' && classification.jobType === 'commodity') {
                recommendedRoute = 'instant';
                reasoning = "Simple commercial job with clear scope.";
            } else {
                // Complex commercial -> Paid Visit (professional protocol)
                recommendedRoute = 'assessment';
                reasoning = "Commercial clients typically require professional site assessment.";
            }
        }
        // STEP 4: Residential Complex (THE BRAIN BIAS)
        else if (classification.jobType === 'project' || classification.jobType === 'subjective') {
            // This is where the "Video Bias" kicks in for residential
            recommendedRoute = 'tiers'; // Note: 'tiers' maps to the Video/Package flow
            reasoning = "Complex residential job - WhatsApp video recommended for accuracy and customer commitment.";
        }
        // STEP 5: Vague/Diagnostic Fallback
        else if (classification.jobClarity === 'vague') {
            recommendedRoute = 'assessment';
            reasoning = "Job description too vague - physical assessment required.";
        }
        // STEP 6: Default Fallback
        else {
            recommendedRoute = 'tiers';
            reasoning = "Standard job profile - tiered pricing recommended.";
        }

        // 3. Fallback to "Strategy Director" for legacy compatibility logic if needed
        // (Optional: we could mix in determineQuoteStrategy results here if we wanted more nuance)

        res.json({
            classification: {
                clientType: classification.clientType === 'homeowner' ? 'residential' :
                    classification.clientType === 'landlord' ? 'residential' :
                        classification.clientType === 'tenant' ? 'residential' :
                            classification.clientType === 'commercial' ? 'commercial' : 'residential',
                jobClarity: classification.jobClarity === 'known' ? 'clear' : classification.jobClarity,
                jobType: classification.jobType === 'fault' ? 'emergency' : // Mapping 'fault' to 'emergency' roughly, or 'standard'
                    classification.jobType === 'project' ? 'complex' :
                        classification.jobType === 'subjective' ? 'standard' : 'standard',
                urgency: classification.urgency === 'asap' ? 'high' :
                    classification.urgency === 'normal' ? 'medium' : 'low',
                reasoning: classification.reasoning
            },
            recommendedRoute,
            reasoning,
            confidence: 'high'
        });

    } catch (error) {
        console.error("Error in route analysis:", error);
        res.status(500).json({ error: "Failed to analyze route" });
    }
});

export default router;
