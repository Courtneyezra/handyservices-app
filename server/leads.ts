import { Router } from "express";
import { db } from "./db";
import { leads, insertLeadSchema } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSetting, getTwilioSettings } from "./settings";
import { createCall, updateCall } from "./call-logger"; // Import call logger function
import { calls } from "@shared/schema"; // Import calls schema

export const leadsRouter = Router();

// Create Lead (Quick Capture / Slot Reservation)
leadsRouter.post('/leads', async (req, res) => {
    try {
        // Validate input against schema
        // Note: We perform loose validation first to handle diverse frontend payloads
        const inputData = req.body;

        const leadData = {
            id: `lead_${nanoid()}`,
            customerName: inputData.customerName,
            phone: inputData.phone,
            email: inputData.email || null,
            jobDescription: inputData.jobDescription || "No description provided",
            source: inputData.source || "web_quote",
            status: "new",
            // Store rich context in JSONB fields if available
            transcriptJson: inputData.analyzedJobData ? { analyzedData: inputData.analyzedJobData } : null,
        };

        // Validate final object
        const newLead = insertLeadSchema.parse(leadData);

        // Insert into DB
        await db.insert(leads).values(newLead);

        // If this lead came from a quote reservation, update the quote
        // The frontend sends outcome='whatsapp_video' and eeePackage for reservations
        if (inputData.quoteAmount || inputData.eeePackage) {
            // We might want to link this to a quote if we had the quote shortSlug or ID.
            // For now, the primary goal is capturing the lead.
        }

        res.status(201).json({
            success: true,
            leadId: newLead.id,
            message: "Lead captured successfully"
        });

    } catch (error: any) {
        console.error('Error creating lead:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Invalid input', errors: error.errors });
        }
        res.status(500).json({ message: `Failed to create lead: ${error.message || 'Unknown error'}` });
    }
});

// Quick Capture (for Video Review page - reusing same logic but specific endpoint to match frontend)
leadsRouter.post('/api/leads/quick-capture', async (req, res) => {
    try {
        const { name, phone, sessionId, videoAnalysis } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ error: 'ValidationError', message: 'Name and phone are required' });
        }

        const leadId = `lead_${nanoid()}`;

        await db.insert(leads).values({
            id: leadId,
            customerName: name,
            phone: phone,
            source: 'video_review',
            jobDescription: videoAnalysis?.summary || 'Video Review Lead',
            transcriptJson: videoAnalysis || {},
            status: 'new'
        });

        res.json({ success: true, leadId });

    } catch (error: any) {
        console.error('Error in quick capture:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Eleven Labs Tool Webhook: Capture Lead
// Note: Path includes /api prefix to match Eleven Labs webhook configuration
leadsRouter.post('/api/eleven-labs/lead', async (req, res) => {
    try {
        console.log('[ElevenLabs] Capture Lead webhook received:', JSON.stringify(req.body));

        // Note: Eleven Labs webhooks don't send authentication headers
        // Security is handled by the webhook URL being a secret

        const { name, phone, job_description, urgency } = req.body;

        if (!name || !job_description) {
            return res.status(400).json({ error: 'Missing required fields: name and job_description' });
        }

        const leadId = `lead_${nanoid()}`;
        const leadData = {
            id: leadId,
            customerName: name,
            phone: phone || "Unknown",
            jobDescription: job_description,
            status: "new",
            source: "eleven_labs_agent",
            // Store urgency in transcriptJson or a separate field if we had one
            transcriptJson: { urgency: urgency || "Standard" },
        };

        // Validate and insert
        console.log('[ElevenLabs] Validating lead data:', JSON.stringify(leadData));
        const validatedLead = insertLeadSchema.parse(leadData);
        console.log('[ElevenLabs] Validated object keys:', Object.keys(validatedLead));

        try {
            await db.insert(leads).values(validatedLead);
        } catch (dbError: any) {
            console.error('[ElevenLabs] DB Insert Failed!');
            console.error('[ElevenLabs] Error details:', dbError.message);
            if (dbError.detail) console.error('[ElevenLabs] Detail:', dbError.detail);
            throw dbError;
        }

        console.log(`[ElevenLabs] Lead captured: ${leadId} (${name})`);

        // Eleven Labs expects a success response, often just a message
        res.status(200).json({
            success: true,
            message: "Lead information saved successfully. Tell the customer that someone will follow up shortly.",
            leadId
        });

    } catch (error: any) {
        console.error('[ElevenLabs] Error capturing lead:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Eleven Labs Post-Call Webhook: Get summary and recording
// Note: Path includes /api prefix to match Eleven Labs webhook configuration
leadsRouter.post('/api/eleven-labs/post-call', async (req, res) => {
    try {
        console.log('[ElevenLabs] Post-call webhook received:', JSON.stringify(req.body).substring(0, 200));

        const settings = await getTwilioSettings();

        const { conversation_id, analysis, metadata } = req.body;
        const callerNumber = metadata?.caller_id || metadata?.phone_number;

        console.log(`[ElevenLabs] Post-call analysis received for conversation: ${conversation_id} (Caller: ${callerNumber})`);

        if (callerNumber) {
            // Find the most recent lead from this number
            const [lead] = await db.select().from(leads).where(eq(leads.phone, callerNumber)).orderBy(desc(leads.createdAt)).limit(1);

            // Find the most recent Call record (Action Center Integration)
            // We search for calls from this number in the last hour to link this analysis to
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const [recentCall] = await db.select()
                .from(calls)
                .where(eq(calls.phoneNumber, callerNumber)) // Note: Ensure number format matches (e.g. +44 vs 07)
                .orderBy(desc(calls.startTime))
                .limit(1);

            // Data to update on the call record
            const callUpdates: any = {
                recordingUrl: undefined,
                transcription: undefined,
                lastEditedAt: new Date()
            };

            // Fetch recording URL from Eleven Labs API
            if (settings.elevenLabsApiKey) {
                try {
                    const convRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversation_id}`, {
                        method: 'GET',
                        headers: { 'xi-api-key': settings.elevenLabsApiKey }
                    });
                    if (convRes.ok) {
                        const convData = await convRes.json();
                        if (convData.audio_url) {
                            callUpdates.recordingUrl = convData.audio_url;
                        }
                    }
                } catch (convErr) {
                    console.error(`[ElevenLabs] Failed to fetch recording URL:`, convErr);
                }
            }

            if (analysis?.transcript_summary) {
                callUpdates.transcription = analysis.transcript_summary; // Use summary as main transcript for now
                callUpdates.jobSummary = analysis.transcript_summary;
            }


            if (lead) {
                // Scenario A: Lead Captured - Update Lead & Link Call
                const updateData: any = {
                    elevenLabsConversationId: conversation_id,
                    updatedAt: new Date()
                };

                if (analysis?.transcript_summary) {
                    updateData.elevenLabsSummary = analysis.transcript_summary;
                    if (!lead.jobSummary || lead.jobSummary === "Pending...") {
                        updateData.jobSummary = analysis.transcript_summary;
                    }
                }

                if (analysis?.call_successful !== undefined) {
                    updateData.elevenLabsSuccessScore = analysis.call_successful ? 100 : 0;
                }

                // If we fetched recording for call, also save to lead
                if (callUpdates.recordingUrl) {
                    updateData.elevenLabsRecordingUrl = callUpdates.recordingUrl;
                }

                await db.update(leads).set(updateData).where(eq(leads.id, lead.id));
                console.log(`[ElevenLabs] Updated lead ${lead.id} with post-call analysis.`);

                // Update Call to reflect success
                if (recentCall) {
                    await updateCall(recentCall.id, {
                        ...callUpdates,
                        outcome: 'LEAD_CAPTURED',
                        actionStatus: 'pending',
                        actionUrgency: 3, // Normal urgency
                        tags: ['lead_captured', 'eleven_labs'],
                        leadId: lead.id
                    });
                }

            } else {
                // Scenario B: No Lead Found (AI Incomplete/Missed Opportunity)
                console.log(`[ElevenLabs] No lead found for ${callerNumber}. Flagging as AI_INCOMPLETE.`);

                if (recentCall) {
                    await updateCall(recentCall.id, {
                        ...callUpdates,
                        outcome: 'AI_INCOMPLETE', // New critical status
                        actionStatus: 'pending',
                        actionUrgency: 1, // Critical!
                        missedReason: 'user_hangup', // Assumption: User hung up on AI or AI failed to convert
                        tags: ['ai_incomplete', 'needs_callback', 'no_lead_info'],
                        notes: 'AI spoke to caller but NO lead captured. Verify recording.'
                    });
                    console.log(`[ActionCenter] Call ${recentCall.id} flagged as CRITICAL (AI_INCOMPLETE).`);
                } else {
                    console.warn(`[ElevenLabs] Could not find recent call to flag for ${callerNumber}`);
                }
            }
        }

        res.status(200).json({ success: true });
    } catch (error: any) {
        console.error('[ElevenLabs] Error in post-call webhook:', error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// List Leads (Admin)
leadsRouter.get('/leads', async (req, res) => {
    try {
        const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));
        res.json(allLeads);
    } catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({ error: "Failed to fetch leads" });
    }
});
