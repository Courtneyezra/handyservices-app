import { Router } from "express";
import { db } from "./db";
import { leads, insertLeadSchema } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSetting, getTwilioSettings } from "./settings";

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
        const validatedLead = insertLeadSchema.parse(leadData);
        await db.insert(leads).values(validatedLead);

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

            if (lead) {
                const updateData: any = {
                    elevenLabsConversationId: conversation_id,
                    updatedAt: new Date()
                };

                if (analysis?.transcript_summary) {
                    updateData.elevenLabsSummary = analysis.transcript_summary;
                    // Also update the main jobSummary if it's currently empty
                    if (!lead.jobSummary || lead.jobSummary === "Pending...") {
                        updateData.jobSummary = analysis.transcript_summary;
                    }
                }

                if (analysis?.call_successful !== undefined) {
                    // Map success to a score or just store it
                    updateData.elevenLabsSuccessScore = analysis.call_successful ? 100 : 0;
                }

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
                                updateData.elevenLabsRecordingUrl = convData.audio_url;
                            }
                        }
                    } catch (convErr) {
                        console.error(`[ElevenLabs] Failed to fetch recording URL:`, convErr);
                    }
                }

                await db.update(leads).set(updateData).where(eq(leads.id, lead.id));
                console.log(`[ElevenLabs] Updated lead ${lead.id} with post-call analysis.`);
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
