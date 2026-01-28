import { Router } from "express";
import OpenAI from "openai";
import { db } from "./db";
import { calls } from "../shared/schema";
import { eq } from "drizzle-orm";

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * B4: Extraction Agent API
 * Accepts a callId or raw transcript and extracts structured data
 * for pre-filling the Quote Generator form.
 */
router.post("/api/extract-call-data", async (req, res) => {
    try {
        const { callId, transcript: rawTranscript } = req.body;

        let transcript = rawTranscript;
        let customerName = "";
        let customerPhone = "";

        // If callId provided, fetch from database
        if (callId && !rawTranscript) {
            const call = await db.query.calls.findFirst({
                where: eq(calls.id, callId)
            });

            if (!call) {
                return res.status(404).json({ error: "Call not found" });
            }

            transcript = call.transcription || "";
            customerName = call.customerName || "";
            customerPhone = call.phoneNumber || "";
        }

        if (!transcript || transcript.trim().length < 10) {
            return res.status(400).json({
                error: "Transcript too short or missing",
                message: "Please provide a valid transcript or callId"
            });
        }

        // AI Extraction Prompt
        const extractionPrompt = `You are an expert at analyzing handyman service call transcripts.

Extract the following information from this call transcript:

1. **clientType**: Determine if this is:
   - "residential" (homeowner, tenant, personal property)
   - "shop_manager" (retail shop, cafe, restaurant manager)
   - "property_manager" (managing multiple properties, landlord with portfolio)

2. **jobSummary**: A clean, concise 1-2 sentence description of what needs to be done.

3. **urgency**: Classify as:
   - "high" (emergency, ASAP, urgent language, water damage, safety issue)
   - "medium" (soon, within a week, moderate priority)
   - "low" (flexible, no rush, can wait)

4. **postcode**: Extract the UK postcode if mentioned (e.g., "SW1A 1AA")

5. **address**: Extract the full address if mentioned

6. **suggestedRoute**: Based on the job description, suggest:
   - "instant" (simple, clear task like "mount TV", "change lightbulb")
   - "video" (complex but visual, like "bathroom leak", "install shelving")
   - "visit" (vague, diagnostic needed, like "strange smell", "damp patch")

Return ONLY a JSON object with these fields. No markdown, no explanation.

TRANSCRIPT:
${transcript}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a data extraction assistant. Return only valid JSON."
                },
                {
                    role: "user",
                    content: extractionPrompt
                }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
        });

        const extractedData = JSON.parse(completion.choices[0].message.content || "{}");

        // Merge with call metadata if available
        const result = {
            clientType: extractedData.clientType || "residential",
            jobSummary: extractedData.jobSummary || "",
            urgency: extractedData.urgency || "medium",
            postcode: extractedData.postcode || "",
            address: extractedData.address || "",
            suggestedRoute: extractedData.suggestedRoute || "video",
            // Include original call data if from database
            customerName: customerName || extractedData.customerName || "",
            customerPhone: customerPhone || extractedData.customerPhone || "",
            rawTranscript: transcript
        };

        res.json(result);

    } catch (error: any) {
        console.error("Error in extract-call-data:", error);
        res.status(500).json({
            error: "Extraction failed",
            message: error.message || "Unknown error"
        });
    }
});

export default router;
