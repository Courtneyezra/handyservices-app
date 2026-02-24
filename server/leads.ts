import { Router } from "express";
import { db } from "./db";
import { leads, insertLeadSchema, personalizedQuotes, conversations, LeadStage, LeadStageValues, calls, messages, invoices, contractorJobs } from "@shared/schema";
import { eq, desc, or, inArray, isNotNull, isNull, gte, and } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";
import { v4 as uuidv4 } from "uuid";
import { getSetting, getTwilioSettings } from "./settings";
import { createCall, updateCall } from "./call-logger"; // Import call logger function
import {
    computeLeadStage,
    updateLeadStage,
    getSLAStatus,
    getStageDisplayName,
    getNextAction,
    STAGE_SLA_HOURS,
} from "./lead-stage-engine";
import { processWebFormLead } from "./services/webform-chase-service";

export const leadsRouter = Router();

// Create Lead (Quick Capture / Slot Reservation)
leadsRouter.post('/api/leads', async (req, res) => {
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
            // Store rich context in JSONB fields if available
            transcriptJson: {
                ...(inputData.analyzedJobData ? { analyzedData: inputData.analyzedJobData } : {}),
                ...(inputData.bookingRequest ? { bookingRequest: inputData.bookingRequest } : {})
            },
        };

        // Validate final object
        const newLead = insertLeadSchema.parse(leadData);

        // Insert into DB
        await db.insert(leads).values(newLead);

        // --- AGENTIC WORKFLOW: ONE-CLICK ACTION ---
        // Just like calls, we run the agent on the job description to get a plan
        if (newLead.jobDescription && newLead.jobDescription.length > 10) {
            (async () => {
                try {
                    const { analyzeLeadActionPlan } = await import("./services/agentic-service");
                    console.log(`[Agent-Reflexion] Analyzing Web Lead ${newLead.id}...`);

                    const plan = await analyzeLeadActionPlan(newLead.jobDescription || "", newLead.customerName);

                    // 1. Save Plan to Lead metadata (if we had a column, but we use conversation logic mainly)
                    // 2. IMPORTANT: Update the Conversation Metadata so it shows in Inbox

                    // Find or create the conversation to attach the plan
                    const { conversations } = await import("@shared/schema");
                    const [existingConv] = await db.select().from(conversations)
                        .where(eq(conversations.phoneNumber, newLead.phone))
                        .limit(1);

                    if (existingConv) {
                        await db.update(conversations)
                            .set({ metadata: plan })
                            .where(eq(conversations.id, existingConv.id));
                        console.log(`[Agent-Reflexion] Attached plan to existing conversation ${existingConv.id}`);
                    } else {
                        // If no conversation exists yet, the Inbox "GetThread" logic might miss it 
                        // unless we create a phantom one OR relying on the lead item itself.
                        // Ideally, we create a conversation record for the agent to "live" in.
                        await db.insert(conversations).values({
                            id: uuidv4(),
                            phoneNumber: newLead.phone,
                            contactName: newLead.customerName,
                            status: 'active',
                            unreadCount: 0,
                            lastMessageAt: new Date(),
                            lastMessagePreview: "New Web Inquiry",
                            metadata: plan
                        });
                        console.log(`[Agent-Reflexion] Created new conversation with plan for ${newLead.phone}`);
                    }

                } catch (err) {
                    console.error(`[Agent-Reflexion] Failed to analyze web lead:`, err);
                }
            })();
        }

        // --- WEB FORM AUTO-CHASE ---
        // If this is a web form lead, trigger immediate acknowledgment
        const isWebForm = ['web_quote', 'webform', 'website'].includes(newLead.source || '');
        if (isWebForm && newLead.phone) {
            // Run async to not block the response
            processWebFormLead(newLead.id).catch(err => {
                console.error(`[WebFormChase] Error processing new lead ${newLead.id}:`, err);
            });
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
leadsRouter.get('/api/leads', async (req, res) => {
    try {
        const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));
        res.json(allLeads);
    } catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({ error: "Failed to fetch leads" });
    }
});

// ==========================================
// LEAD FUNNEL KANBAN API
// ==========================================

/**
 * Helper: Format time in stage as human-readable string
 */
function formatTimeInStage(stageUpdatedAt: Date | null): string {
    if (!stageUpdatedAt) return 'Unknown';

    const now = Date.now();
    const updated = new Date(stageUpdatedAt).getTime();
    const diffMs = now - updated;

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return days === 1 ? '1 day' : `${days} days`;
    } else if (hours > 0) {
        const remainingMinutes = minutes % 60;
        if (remainingMinutes > 0) {
            return `${hours}h ${remainingMinutes}m`;
        }
        return `${hours}h`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    }
    return 'Just now';
}

/**
 * Helper: Check if phone has an active WhatsApp 24h window
 */
function hasWhatsAppWindow(lastInboundAt: Date | null): boolean {
    if (!lastInboundAt) return false;

    const windowMs = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    const inboundTime = new Date(lastInboundAt).getTime();

    return (now - inboundTime) < windowMs;
}

// Define columns configuration for the Kanban board
const FUNNEL_COLUMNS: { id: LeadStage; isActive: boolean }[] = [
    { id: 'new_lead', isActive: true },
    { id: 'contacted', isActive: true },
    { id: 'awaiting_video', isActive: true },
    { id: 'quote_sent', isActive: true },
    { id: 'quote_viewed', isActive: true },
    { id: 'awaiting_payment', isActive: true },
    { id: 'booked', isActive: true },
    { id: 'in_progress', isActive: true },
    { id: 'completed', isActive: false },
    { id: 'lost', isActive: false },
    { id: 'expired', isActive: false },
    { id: 'declined', isActive: false },
];

/**
 * GET /api/admin/lead-funnel
 * Returns structured data for the Lead Funnel Kanban board
 */
leadsRouter.get('/api/admin/lead-funnel', async (req, res) => {
    try {
        // 1. Fetch all leads with relevant fields
        const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));

        // 2. Fetch all quotes to enrich lead data
        const allQuotes = await db.select({
            id: personalizedQuotes.id,
            leadId: personalizedQuotes.leadId,
            phone: personalizedQuotes.phone,
            shortSlug: personalizedQuotes.shortSlug,
            viewedAt: personalizedQuotes.viewedAt,
            selectedAt: personalizedQuotes.selectedAt,
            bookedAt: personalizedQuotes.bookedAt,
        }).from(personalizedQuotes);

        // 3. Fetch all conversations for WhatsApp window tracking
        const allConversations = await db.select({
            phoneNumber: conversations.phoneNumber,
            lastInboundAt: conversations.lastInboundAt,
        }).from(conversations);

        // Build lookup maps for efficient access
        const quotesByLeadId = new Map<string, typeof allQuotes[number]>();
        const quotesByPhone = new Map<string, typeof allQuotes[number]>();
        for (const quote of allQuotes) {
            if (quote.leadId) {
                quotesByLeadId.set(quote.leadId, quote);
            }
            if (quote.phone) {
                quotesByPhone.set(quote.phone, quote);
            }
        }

        const conversationsByPhone = new Map<string, typeof allConversations[number]>();
        for (const conv of allConversations) {
            conversationsByPhone.set(conv.phoneNumber, conv);
        }

        // 4. Build columns with items
        const columns: {
            id: LeadStage;
            title: string;
            count: number;
            items: {
                id: string;
                customerName: string;
                phone: string;
                jobDescription: string | null;
                source: string | null;
                stage: LeadStage;
                stageUpdatedAt: Date | null;
                timeInStage: string;
                slaStatus: 'ok' | 'warning' | 'overdue';
                nextAction: string;
                hasWhatsAppWindow: boolean;
                quoteId?: string;
                quoteSlug?: string;
                createdAt: Date | null;
            }[];
        }[] = [];

        // Group leads by stage
        const leadsByStage = new Map<LeadStage, typeof allLeads>();
        for (const stage of LeadStageValues) {
            leadsByStage.set(stage, []);
        }

        for (const lead of allLeads) {
            const stage = (lead.stage as LeadStage) || 'new_lead';
            const stageLeads = leadsByStage.get(stage) || [];
            stageLeads.push(lead);
            leadsByStage.set(stage, stageLeads);
        }

        // Build column data
        let activeCount = 0;
        let completedCount = 0;
        let lostCount = 0;

        for (const columnConfig of FUNNEL_COLUMNS) {
            const stageLeads = leadsByStage.get(columnConfig.id) || [];

            const items = stageLeads.map(lead => {
                // Get quote for this lead
                const quote = quotesByLeadId.get(lead.id) || quotesByPhone.get(lead.phone);

                // Get conversation for WhatsApp window
                const conversation = conversationsByPhone.get(lead.phone);

                // Get SLA status
                const slaResult = getSLAStatus(columnConfig.id, lead.stageUpdatedAt);

                return {
                    id: lead.id,
                    customerName: lead.customerName,
                    phone: lead.phone,
                    jobDescription: lead.jobDescription,
                    source: lead.source,
                    stage: columnConfig.id,
                    stageUpdatedAt: lead.stageUpdatedAt,
                    timeInStage: formatTimeInStage(lead.stageUpdatedAt),
                    slaStatus: slaResult.status,
                    nextAction: getNextAction(columnConfig.id),
                    hasWhatsAppWindow: hasWhatsAppWindow(conversation?.lastInboundAt || null),
                    quoteId: quote?.id,
                    quoteSlug: quote?.shortSlug,
                    createdAt: lead.createdAt,
                };
            });

            columns.push({
                id: columnConfig.id,
                title: getStageDisplayName(columnConfig.id),
                count: items.length,
                items,
            });

            // Count totals
            if (columnConfig.isActive && columnConfig.id !== 'completed') {
                activeCount += items.length;
            } else if (columnConfig.id === 'completed') {
                completedCount += items.length;
            } else if (['lost', 'expired', 'declined'].includes(columnConfig.id)) {
                lostCount += items.length;
            }
        }

        res.json({
            columns,
            totals: {
                active: activeCount,
                completed: completedCount,
                lost: lostCount,
            },
        });

    } catch (error) {
        console.error('[LeadFunnel] Error fetching funnel data:', error);
        res.status(500).json({ error: 'Failed to fetch lead funnel data' });
    }
});

/**
 * PATCH /api/admin/leads/:id/stage
 * Update a lead's stage manually
 */
leadsRouter.patch('/api/admin/leads/:id/stage', async (req, res) => {
    try {
        const { id } = req.params;
        const { stage, force, reason } = req.body;

        // Validate stage
        if (!stage || !LeadStageValues.includes(stage as LeadStage)) {
            return res.status(400).json({
                error: 'Invalid stage',
                validStages: LeadStageValues,
            });
        }

        // Update the stage using the stage engine
        const result = await updateLeadStage(id, stage as LeadStage, {
            force: force ?? false,
            reason: reason || 'Manual stage update via admin',
        });

        if (!result.success) {
            return res.status(400).json({
                error: 'Failed to update stage',
                previousStage: result.previousStage,
                message: 'Stage downgrade not allowed without force=true',
            });
        }

        // Fetch the updated lead
        const [updatedLead] = await db.select().from(leads).where(eq(leads.id, id));

        if (!updatedLead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        console.log(`[LeadFunnel] Admin updated lead ${id} stage: ${result.previousStage} -> ${stage}`);

        res.json({
            success: true,
            lead: updatedLead,
            previousStage: result.previousStage,
            newStage: stage,
            automationsTriggered: result.automationsTriggered,
        });

    } catch (error) {
        console.error('[LeadFunnel] Error updating lead stage:', error);
        res.status(500).json({ error: 'Failed to update lead stage' });
    }
});

/**
 * GET /api/admin/leads/by-stage
 * Returns leads filtered by stage for the pipeline cards view.
 * NOTE: This route MUST be defined BEFORE /api/admin/leads/:id to avoid route conflicts
 */
leadsRouter.get('/api/admin/leads/by-stage', async (req, res) => {
    try {
        const stage = req.query.stage as string;

        if (!stage || !LeadStageValues.includes(stage as LeadStage)) {
            return res.status(400).json({
                error: 'Invalid or missing stage parameter',
                validStages: LeadStageValues,
            });
        }

        // Fetch leads with the specified stage
        const stageLeads = await db.select()
            .from(leads)
            .where(eq(leads.stage, stage as LeadStage))
            .orderBy(desc(leads.stageUpdatedAt));

        // Fetch quotes for these leads
        const leadIds = stageLeads.map(l => l.id);
        const leadPhones = stageLeads.map(l => l.phone);

        const allQuotes = leadIds.length > 0 || leadPhones.length > 0 ? await db.select({
            id: personalizedQuotes.id,
            leadId: personalizedQuotes.leadId,
            phone: personalizedQuotes.phone,
            shortSlug: personalizedQuotes.shortSlug,
        }).from(personalizedQuotes)
        .where(or(
            leadIds.length > 0 ? inArray(personalizedQuotes.leadId, leadIds) : undefined,
            leadPhones.length > 0 ? inArray(personalizedQuotes.phone, leadPhones) : undefined
        )) : [];

        // Build lookup maps
        const quotesByLeadId = new Map<string, typeof allQuotes[number]>();
        const quotesByPhone = new Map<string, typeof allQuotes[number]>();
        for (const quote of allQuotes) {
            if (quote.leadId) quotesByLeadId.set(quote.leadId, quote);
            if (quote.phone) quotesByPhone.set(quote.phone, quote);
        }

        // Build lead items
        const leadsResult = stageLeads.map(lead => {
            const quote = quotesByLeadId.get(lead.id) || quotesByPhone.get(lead.phone);
            const timeInStage = formatTimeInStage(lead.stageUpdatedAt);
            const slaResult = getSLAStatus(stage as LeadStage, lead.stageUpdatedAt);

            return {
                id: lead.id,
                customerName: lead.customerName,
                phone: lead.phone,
                stage: lead.stage || 'new_lead',
                route: lead.route || 'instant',
                jobDescription: lead.jobDescription,
                timeInStage,
                slaStatus: slaResult.status,
                hasUnreadMessages: false,
                hasVideo: false,
                createdAt: lead.createdAt?.toISOString() || null,
                quoteId: quote?.id,
                quoteSlug: quote?.shortSlug,
            };
        });

        res.json({
            leads: leadsResult,
            count: leadsResult.length,
        });

    } catch (error) {
        console.error('[Pipeline] Error fetching leads by stage:', error);
        res.status(500).json({ error: 'Failed to fetch leads by stage' });
    }
});

/**
 * GET /api/admin/leads/:id
 * Get a single lead with enriched data
 */
leadsRouter.get('/api/admin/leads/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [lead] = await db.select().from(leads).where(eq(leads.id, id));

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Get related quote
        const [quote] = await db.select()
            .from(personalizedQuotes)
            .where(or(
                eq(personalizedQuotes.leadId, id),
                eq(personalizedQuotes.phone, lead.phone)
            ))
            .orderBy(desc(personalizedQuotes.createdAt))
            .limit(1);

        // Get conversation
        const [conversation] = await db.select()
            .from(conversations)
            .where(eq(conversations.phoneNumber, lead.phone))
            .limit(1);

        // Get SLA status
        const stage = (lead.stage as LeadStage) || 'new_lead';
        const slaResult = getSLAStatus(stage, lead.stageUpdatedAt);

        res.json({
            ...lead,
            enrichment: {
                quote: quote ? {
                    id: quote.id,
                    shortSlug: quote.shortSlug,
                    viewedAt: quote.viewedAt,
                    selectedAt: quote.selectedAt,
                    bookedAt: quote.bookedAt,
                } : null,
                hasWhatsAppWindow: hasWhatsAppWindow(conversation?.lastInboundAt || null),
                slaStatus: slaResult.status,
                slaHoursRemaining: slaResult.hoursRemaining,
                nextAction: getNextAction(stage),
                stageDisplayName: getStageDisplayName(stage),
            },
        });

    } catch (error) {
        console.error('[LeadFunnel] Error fetching lead:', error);
        res.status(500).json({ error: 'Failed to fetch lead' });
    }
});

// ==========================================
// LEAD PIPELINE VIEW (Vertical Swimlanes)
// ==========================================

// Quote path types for pipeline view
type QuotePath = 'instant' | 'tiered' | 'assessment' | 'no_quote';

// Stages for each path (different flows)
const PATH_STAGES: Record<QuotePath, LeadStage[]> = {
    'instant': ['new_lead', 'contacted', 'quote_sent', 'quote_viewed', 'awaiting_payment', 'booked', 'in_progress', 'completed'],
    'tiered': ['new_lead', 'contacted', 'quote_sent', 'quote_viewed', 'awaiting_payment', 'booked', 'in_progress', 'completed'],
    'assessment': ['new_lead', 'contacted', 'quote_sent', 'quote_viewed', 'awaiting_payment', 'booked', 'in_progress', 'completed'],
    'no_quote': ['new_lead', 'contacted', 'lost', 'expired', 'declined'],
};

const PATH_DISPLAY_NAMES: Record<QuotePath, string> = {
    'instant': 'Instant Quote',
    'tiered': 'Tiered (HHH)',
    'assessment': 'Assessment Visit',
    'no_quote': 'No Quote Yet',
};

/**
 * GET /api/admin/lead-pipeline
 * Returns leads grouped by quote type path (vertical swimlanes)
 */
leadsRouter.get('/api/admin/lead-pipeline', async (req, res) => {
    try {
        // 1. Fetch all leads
        const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));

        // 2. Fetch all quotes with their mode
        const allQuotes = await db.select({
            id: personalizedQuotes.id,
            leadId: personalizedQuotes.leadId,
            phone: personalizedQuotes.phone,
            shortSlug: personalizedQuotes.shortSlug,
            quoteMode: personalizedQuotes.quoteMode,
            viewedAt: personalizedQuotes.viewedAt,
            selectedAt: personalizedQuotes.selectedAt,
            bookedAt: personalizedQuotes.bookedAt,
            segment: personalizedQuotes.segment,
            createdAt: personalizedQuotes.createdAt,
        }).from(personalizedQuotes);

        // 3. Fetch conversations for WhatsApp tracking
        const allConversations = await db.select({
            phoneNumber: conversations.phoneNumber,
            lastInboundAt: conversations.lastInboundAt,
        }).from(conversations);

        // Build lookup maps
        const quotesByLeadId = new Map<string, typeof allQuotes[number]>();
        const quotesByPhone = new Map<string, typeof allQuotes[number]>();
        for (const quote of allQuotes) {
            if (quote.leadId) quotesByLeadId.set(quote.leadId, quote);
            if (quote.phone) quotesByPhone.set(quote.phone, quote);
        }

        const conversationsByPhone = new Map<string, typeof allConversations[number]>();
        for (const conv of allConversations) {
            conversationsByPhone.set(conv.phoneNumber, conv);
        }

        // 4. Determine quote path for each lead
        function getQuotePath(lead: typeof allLeads[number]): QuotePath {
            const quote = quotesByLeadId.get(lead.id) || quotesByPhone.get(lead.phone);
            if (!quote) return 'no_quote';

            const mode = quote.quoteMode;
            if (mode === 'simple') return 'instant';
            if (mode === 'hhh' || mode === 'pick_and_mix') return 'tiered';
            if (mode === 'consultation') return 'assessment';
            return 'tiered'; // default
        }

        // 5. Group leads by path -> stage
        const pathData: Record<QuotePath, Record<LeadStage, typeof allLeads>> = {
            'instant': {} as Record<LeadStage, typeof allLeads>,
            'tiered': {} as Record<LeadStage, typeof allLeads>,
            'assessment': {} as Record<LeadStage, typeof allLeads>,
            'no_quote': {} as Record<LeadStage, typeof allLeads>,
        };

        // Initialize all stages for each path
        for (const path of Object.keys(pathData) as QuotePath[]) {
            for (const stage of PATH_STAGES[path]) {
                pathData[path][stage] = [];
            }
        }

        // Assign leads to paths and stages
        for (const lead of allLeads) {
            const path = getQuotePath(lead);
            const stage = (lead.stage as LeadStage) || 'new_lead';

            // Put in appropriate path, handle terminal states
            if (['lost', 'expired', 'declined'].includes(stage)) {
                // Terminal states go to no_quote path for visibility
                if (!pathData['no_quote'][stage]) pathData['no_quote'][stage] = [];
                pathData['no_quote'][stage].push(lead);
            } else if (pathData[path][stage]) {
                pathData[path][stage].push(lead);
            } else {
                // Fallback: put in no_quote new_lead
                pathData['no_quote']['new_lead'].push(lead);
            }
        }

        // 6. Build response structure for vertical swimlanes
        const swimlanes = (Object.keys(pathData) as QuotePath[]).map(path => {
            const stages = PATH_STAGES[path].map(stage => {
                const stageLeads = pathData[path][stage] || [];

                const items = stageLeads.map(lead => {
                    const quote = quotesByLeadId.get(lead.id) || quotesByPhone.get(lead.phone);
                    const conversation = conversationsByPhone.get(lead.phone);
                    const slaResult = getSLAStatus(stage, lead.stageUpdatedAt);

                    return {
                        id: lead.id,
                        customerName: lead.customerName,
                        phone: lead.phone,
                        jobDescription: lead.jobDescription,
                        source: lead.source,
                        segment: quote?.segment || null,
                        stage,
                        stageUpdatedAt: lead.stageUpdatedAt,
                        timeInStage: formatTimeInStage(lead.stageUpdatedAt),
                        slaStatus: slaResult.status,
                        nextAction: getNextAction(stage),
                        hasWhatsAppWindow: hasWhatsAppWindow(conversation?.lastInboundAt || null),
                        quoteId: quote?.id,
                        quoteSlug: quote?.shortSlug,
                        createdAt: lead.createdAt,
                    };
                });

                return {
                    stage,
                    title: getStageDisplayName(stage),
                    count: items.length,
                    items,
                };
            });

            // Calculate totals for this path
            const totalInPath = stages.reduce((sum, s) => sum + s.count, 0);
            const completedInPath = stages.find(s => s.stage === 'completed')?.count || 0;
            const activeInPath = totalInPath - completedInPath;

            // Calculate conversion rate (completed / total that reached quote_sent or further)
            const reachedQuote = stages
                .filter(s => !['new_lead', 'contacted', 'lost', 'expired', 'declined'].includes(s.stage))
                .reduce((sum, s) => sum + s.count, 0);
            const conversionRate = reachedQuote > 0
                ? Math.round((completedInPath / reachedQuote) * 100)
                : 0;

            return {
                path,
                title: PATH_DISPLAY_NAMES[path],
                stages,
                stats: {
                    total: totalInPath,
                    active: activeInPath,
                    completed: completedInPath,
                    conversionRate,
                },
            };
        });

        // 7. Calculate overall totals
        const totals = {
            active: swimlanes.reduce((sum, s) => sum + s.stats.active, 0),
            completed: swimlanes.reduce((sum, s) => sum + s.stats.completed, 0),
            lost: pathData['no_quote']['lost']?.length || 0,
            total: allLeads.length,
        };

        res.json({
            swimlanes,
            totals,
            stageOrder: ['new_lead', 'contacted', 'awaiting_video', 'quote_sent', 'quote_viewed', 'awaiting_payment', 'booked', 'in_progress', 'completed'],
        });

    } catch (error) {
        console.error('[LeadPipeline] Error fetching pipeline data:', error);
        res.status(500).json({ error: 'Failed to fetch pipeline data' });
    }
});

// ==========================================
// LEAD TUBE MAP API (London Underground Style)
// ==========================================

type TubeRouteType = 'video' | 'instant' | 'site_visit';
type SegmentType = 'BUSY_PRO' | 'PROP_MGR' | 'LANDLORD' | 'SMALL_BIZ' | 'DIY_DEFERRER' | 'BUDGET' | 'UNKNOWN';

/**
 * Determine the route type for a lead based on quote mode or call outcome
 */
function determineTubeRoute(
    quoteMode: string | null | undefined,
    callOutcome: string | null | undefined,
    awaitingVideo: boolean | null
): TubeRouteType {
    // If we have a quote, use its mode
    if (quoteMode) {
        if (quoteMode === 'simple') return 'instant';
        if (quoteMode === 'consultation') return 'site_visit';
        return 'video'; // hhh, pick_and_mix, etc. typically require video/assessment
    }

    // If no quote but call outcome suggests route
    if (callOutcome) {
        if (callOutcome === 'INSTANT_PRICE') return 'instant';
        if (callOutcome === 'SITE_VISIT') return 'site_visit';
        if (callOutcome === 'VIDEO_QUOTE') return 'video';
    }

    // If awaiting video, it's on the video route
    if (awaitingVideo) return 'video';

    // Default to instant (most common path)
    return 'instant';
}

/**
 * GET /api/admin/lead-tube-map
 * Returns data structured for the London Tube Map visualization
 */
leadsRouter.get('/api/admin/lead-tube-map', async (req, res) => {
    try {
        // 1. Fetch all active leads
        const allLeads = await db.select().from(leads).orderBy(desc(leads.createdAt));

        // 2. Fetch all quotes
        const allQuotes = await db.select({
            id: personalizedQuotes.id,
            leadId: personalizedQuotes.leadId,
            phone: personalizedQuotes.phone,
            shortSlug: personalizedQuotes.shortSlug,
            quoteMode: personalizedQuotes.quoteMode,
            viewedAt: personalizedQuotes.viewedAt,
            selectedAt: personalizedQuotes.selectedAt,
            bookedAt: personalizedQuotes.bookedAt,
            segment: personalizedQuotes.segment,
        }).from(personalizedQuotes);

        // 3. Fetch conversations for WhatsApp tracking
        const allConversations = await db.select({
            phoneNumber: conversations.phoneNumber,
            lastInboundAt: conversations.lastInboundAt,
        }).from(conversations);

        // 4. Fetch recent calls for outcome data
        const recentCalls = await db.select({
            phoneNumber: calls.phoneNumber,
            outcome: calls.outcome,
        }).from(calls).orderBy(desc(calls.startTime)).limit(500);

        // Build lookup maps
        const quotesByLeadId = new Map<string, typeof allQuotes[number]>();
        const quotesByPhone = new Map<string, typeof allQuotes[number]>();
        for (const quote of allQuotes) {
            if (quote.leadId) quotesByLeadId.set(quote.leadId, quote);
            if (quote.phone) quotesByPhone.set(quote.phone, quote);
        }

        const conversationsByPhone = new Map<string, typeof allConversations[number]>();
        for (const conv of allConversations) {
            conversationsByPhone.set(conv.phoneNumber, conv);
        }

        const callOutcomeByPhone = new Map<string, string>();
        for (const call of recentCalls) {
            if (call.outcome && !callOutcomeByPhone.has(call.phoneNumber)) {
                callOutcomeByPhone.set(call.phoneNumber, call.outcome);
            }
        }

        // 5. Define stations for each route
        const routeStations: Record<TubeRouteType, LeadStage[]> = {
            video: ['contacted', 'awaiting_video', 'quote_sent', 'quote_viewed', 'booked'],
            instant: ['contacted', 'quote_sent', 'quote_viewed', 'booked'],
            site_visit: ['contacted', 'awaiting_video', 'quote_sent', 'quote_viewed', 'booked'],
        };

        // 6. Build route data structures
        interface TubeMapLead {
            id: string;
            customerName: string;
            phone: string;
            jobDescription: string | null;
            source: string | null;
            segment: SegmentType | null;
            stage: LeadStage;
            route: TubeRouteType;
            stageUpdatedAt: string | null;
            timeInStage: string;
            slaStatus: 'ok' | 'warning' | 'overdue';
            nextAction: string;
            hasWhatsAppWindow: boolean;
            quoteId?: string;
            quoteSlug?: string;
            createdAt: string | null;
        }

        interface StationData {
            id: string;
            stage: LeadStage;
            name: string;
            count: number;
            leads: TubeMapLead[];
            segmentBreakdown: Record<SegmentType, number>;
            hasBottleneck: boolean;
        }

        interface RouteData {
            route: TubeRouteType;
            name: string;
            color: string;
            stations: StationData[];
            conversionRate: number;
            totalLeads: number;
        }

        const routeColors: Record<TubeRouteType, string> = {
            video: '#8B5CF6',     // purple
            instant: '#10B981',   // emerald
            site_visit: '#F97316', // orange
        };

        const routeNames: Record<TubeRouteType, string> = {
            video: 'Video Quote',
            instant: 'Instant Quote',
            site_visit: 'Site Visit',
        };

        // Initialize route data
        const routeData: Record<TubeRouteType, Map<LeadStage, TubeMapLead[]>> = {
            video: new Map(),
            instant: new Map(),
            site_visit: new Map(),
        };

        // Initialize all stations for each route
        for (const route of Object.keys(routeStations) as TubeRouteType[]) {
            for (const stage of routeStations[route]) {
                routeData[route].set(stage, []);
            }
        }

        // 7. Categorize leads by route and stage
        for (const lead of allLeads) {
            const quote = quotesByLeadId.get(lead.id) || quotesByPhone.get(lead.phone);
            const conversation = conversationsByPhone.get(lead.phone);
            const callOutcome = callOutcomeByPhone.get(lead.phone);

            // Determine route
            const route = determineTubeRoute(
                quote?.quoteMode,
                callOutcome,
                lead.awaitingVideo
            );

            // Get lead stage
            const stage = (lead.stage as LeadStage) || 'new_lead';

            // Skip terminal/inactive stages for the map
            if (['completed', 'lost', 'expired', 'declined', 'in_progress'].includes(stage)) {
                continue;
            }

            // Map to valid station on this route
            let mappedStage = stage;
            if (!routeStations[route].includes(stage)) {
                // Map to closest valid station
                if (stage === 'new_lead') mappedStage = 'contacted';
                else if (stage === 'awaiting_payment') mappedStage = 'quote_viewed';
                else mappedStage = 'contacted';
            }

            // Get SLA status
            const slaResult = getSLAStatus(mappedStage, lead.stageUpdatedAt);

            // Build tube map lead
            const tubeMapLead: TubeMapLead = {
                id: lead.id,
                customerName: lead.customerName,
                phone: lead.phone,
                jobDescription: lead.jobDescription,
                source: lead.source,
                segment: (quote?.segment as SegmentType) || 'UNKNOWN',
                stage: mappedStage,
                route,
                stageUpdatedAt: lead.stageUpdatedAt?.toISOString() || null,
                timeInStage: formatTimeInStage(lead.stageUpdatedAt),
                slaStatus: slaResult.status,
                nextAction: getNextAction(mappedStage),
                hasWhatsAppWindow: hasWhatsAppWindow(conversation?.lastInboundAt || null),
                quoteId: quote?.id,
                quoteSlug: quote?.shortSlug,
                createdAt: lead.createdAt?.toISOString() || null,
            };

            // Add to appropriate route/stage bucket
            const stageBucket = routeData[route].get(mappedStage);
            if (stageBucket) {
                stageBucket.push(tubeMapLead);
            }
        }

        // 8. Build final response structure
        const routes: RouteData[] = (Object.keys(routeData) as TubeRouteType[]).map(route => {
            const stations: StationData[] = routeStations[route].map(stage => {
                const stageLeads = routeData[route].get(stage) || [];

                // Build segment breakdown
                const segmentBreakdown: Record<SegmentType, number> = {
                    BUSY_PRO: 0,
                    PROP_MGR: 0,
                    LANDLORD: 0,
                    SMALL_BIZ: 0,
                    DIY_DEFERRER: 0,
                    BUDGET: 0,
                    UNKNOWN: 0,
                };

                stageLeads.forEach(l => {
                    if (l.segment) {
                        segmentBreakdown[l.segment]++;
                    }
                });

                return {
                    id: `${route}_${stage}`,
                    stage,
                    name: getStageDisplayName(stage),
                    count: stageLeads.length,
                    leads: stageLeads,
                    segmentBreakdown,
                    hasBottleneck: stageLeads.length > 10,
                };
            });

            const totalLeads = stations.reduce((sum, s) => sum + s.count, 0);
            const bookedCount = stations.find(s => s.stage === 'booked')?.count || 0;
            const conversionRate = totalLeads > 0 ? Math.round((bookedCount / totalLeads) * 100) : 0;

            return {
                route,
                name: routeNames[route],
                color: routeColors[route],
                stations,
                conversionRate,
                totalLeads,
            };
        });

        // 9. Calculate entry point stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayCalls = await db.select({ id: calls.id })
            .from(calls)
            .where(gte(calls.startTime, today))
            .limit(100);

        const todayLeads = allLeads.filter(l =>
            l.createdAt && new Date(l.createdAt) >= today
        );

        const webformLeads = todayLeads.filter(l => l.source === 'web' || l.source === 'webform');
        const whatsappLeads = todayLeads.filter(l => l.source === 'whatsapp');

        // Check for live call (simplified - could enhance with WebSocket state)
        const liveCallCheck = await db.select({ id: calls.id })
            .from(calls)
            .where(eq(calls.status, 'in-progress'))
            .limit(1);

        // Calculate needs chase (leads with no activity in last 2 hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const needsChaseCount = allLeads.filter(l =>
            l.stage === 'new_lead' &&
            l.source === 'web' &&
            l.createdAt &&
            new Date(l.createdAt) < twoHoursAgo
        ).length;

        // Unread WhatsApp count
        const unreadConversations = await db.select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.stage, 'new'))
            .limit(100);

        // 10. Calculate totals
        const activeLeads = allLeads.filter(l =>
            !['completed', 'lost', 'expired', 'declined'].includes(l.stage || 'new_lead')
        );
        const completedLeads = allLeads.filter(l => l.stage === 'completed');
        const lostLeads = allLeads.filter(l =>
            ['lost', 'expired', 'declined'].includes(l.stage || '')
        );

        res.json({
            routes,
            entryPoints: {
                calls: {
                    today: todayCalls.length,
                    live: liveCallCheck.length > 0,
                },
                whatsapp: {
                    today: whatsappLeads.length,
                    unread: unreadConversations.length,
                },
                webforms: {
                    today: webformLeads.length,
                    needsChase: needsChaseCount,
                },
            },
            totals: {
                active: activeLeads.length,
                completed: completedLeads.length,
                lost: lostLeads.length,
            },
        });

    } catch (error) {
        console.error('[LeadTubeMap] Error fetching tube map data:', error);
        res.status(500).json({ error: 'Failed to fetch tube map data' });
    }
});

/**
 * POST /api/admin/leads/:id/route
 * Assign a lead to a specific route (video/instant/site_visit)
 */
leadsRouter.post('/api/admin/leads/:id/route', async (req, res) => {
    try {
        const { id } = req.params;
        const { route } = req.body;

        const validRoutes = ['video', 'instant', 'site_visit'];
        if (!route || !validRoutes.includes(route)) {
            return res.status(400).json({
                error: 'Invalid route',
                validRoutes,
            });
        }

        // For now, we'll store route preference in transcriptJson
        // In future, we could add a dedicated column
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        const existingData = (lead.transcriptJson as Record<string, any>) || {};
        const updatedData = { ...existingData, assignedRoute: route };

        await db.update(leads)
            .set({
                transcriptJson: updatedData,
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        console.log(`[LeadTubeMap] Lead ${id} assigned to route: ${route}`);

        res.json({
            success: true,
            leadId: id,
            route,
        });

    } catch (error) {
        console.error('[LeadTubeMap] Error updating lead route:', error);
        res.status(500).json({ error: 'Failed to update lead route' });
    }
});

/**
 * POST /api/admin/leads/:id/segment
 * Change a lead's segment
 */
leadsRouter.post('/api/admin/leads/:id/segment', async (req, res) => {
    try {
        const { id } = req.params;
        const { segment } = req.body;

        const validSegments = ['BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'DIY_DEFERRER', 'BUDGET', 'UNKNOWN'];
        if (!segment || !validSegments.includes(segment)) {
            return res.status(400).json({
                error: 'Invalid segment',
                validSegments,
            });
        }

        // Find the lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Update associated quote's segment if one exists
        const [quote] = await db.select()
            .from(personalizedQuotes)
            .where(or(
                eq(personalizedQuotes.leadId, id),
                eq(personalizedQuotes.phone, lead.phone)
            ))
            .orderBy(desc(personalizedQuotes.createdAt))
            .limit(1);

        if (quote) {
            await db.update(personalizedQuotes)
                .set({ segment })
                .where(eq(personalizedQuotes.id, quote.id));
        }

        // Also store in lead's transcriptJson for reference
        const existingData = (lead.transcriptJson as Record<string, any>) || {};
        const updatedData = { ...existingData, assignedSegment: segment };

        await db.update(leads)
            .set({
                transcriptJson: updatedData,
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        console.log(`[LeadTubeMap] Lead ${id} segment changed to: ${segment}`);

        res.json({
            success: true,
            leadId: id,
            segment,
            quoteUpdated: !!quote,
        });

    } catch (error) {
        console.error('[LeadTubeMap] Error updating lead segment:', error);
        res.status(500).json({ error: 'Failed to update lead segment' });
    }
});

// ==========================================
// LIVE ACTIVITY STREAM API
// ==========================================

/**
 * GET /api/admin/activity-stream
 * Returns recent activity for the live stream component
 * Includes: calls, WhatsApp messages, video requests
 */
leadsRouter.get('/api/admin/activity-stream', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        // Fetch recent calls
        const recentCalls = await db.select({
            id: calls.id,
            phoneNumber: calls.phoneNumber,
            customerName: calls.customerName,
            startTime: calls.startTime,
            endTime: calls.endTime,
            status: calls.status,
            outcome: calls.outcome,
            jobSummary: calls.jobSummary,
            leadId: calls.leadId,
            videoRequestSentAt: calls.videoRequestSentAt,
        })
            .from(calls)
            .orderBy(desc(calls.startTime))
            .limit(limit);

        // Fetch recent WhatsApp messages (inbound)
        const recentMessages = await db.select({
            id: messages.id,
            conversationId: messages.conversationId,
            direction: messages.direction,
            content: messages.content,
            type: messages.type,
            senderName: messages.senderName,
            createdAt: messages.createdAt,
        })
            .from(messages)
            .where(eq(messages.direction, 'inbound'))
            .orderBy(desc(messages.createdAt))
            .limit(limit);

        // Get conversation details for messages
        const conversationIds = [...new Set(recentMessages.map(m => m.conversationId))];
        const conversationDetails = conversationIds.length > 0
            ? await db.select({
                id: conversations.id,
                contactName: conversations.contactName,
                phoneNumber: conversations.phoneNumber,
                leadId: conversations.leadId,
            })
                .from(conversations)
                .where(inArray(conversations.id, conversationIds))
            : [];

        const conversationMap = new Map(conversationDetails.map(c => [c.id, c]));

        // Build activity items
        type ActivityItem = {
            id: string;
            type: 'call_incoming' | 'call_ended' | 'whatsapp_received' | 'video_requested' | 'video_received';
            timestamp: Date;
            customerName: string;
            customerPhone: string;
            summary: string;
            leadId?: string;
        };

        const activities: ActivityItem[] = [];

        // Add call activities
        for (const call of recentCalls) {
            // Call ended activity
            if (call.endTime) {
                activities.push({
                    id: `call-${call.id}`,
                    type: 'call_ended',
                    timestamp: new Date(call.endTime),
                    customerName: call.customerName || 'Unknown',
                    customerPhone: call.phoneNumber,
                    summary: call.jobSummary || call.outcome || 'Call completed',
                    leadId: call.leadId || undefined,
                });
            }

            // Call incoming activity
            if (call.startTime) {
                activities.push({
                    id: `call-start-${call.id}`,
                    type: 'call_incoming',
                    timestamp: new Date(call.startTime),
                    customerName: call.customerName || 'Unknown',
                    customerPhone: call.phoneNumber,
                    summary: 'Incoming call',
                    leadId: call.leadId || undefined,
                });
            }

            // Video request activity
            if (call.videoRequestSentAt) {
                activities.push({
                    id: `video-req-${call.id}`,
                    type: 'video_requested',
                    timestamp: new Date(call.videoRequestSentAt),
                    customerName: call.customerName || 'Unknown',
                    customerPhone: call.phoneNumber,
                    summary: 'Video request sent',
                    leadId: call.leadId || undefined,
                });
            }
        }

        // Add WhatsApp message activities
        for (const msg of recentMessages) {
            const conv = conversationMap.get(msg.conversationId);
            const isVideo = msg.type === 'video' || msg.type === 'image';

            activities.push({
                id: `wa-${msg.id}`,
                type: isVideo ? 'video_received' : 'whatsapp_received',
                timestamp: msg.createdAt ? new Date(msg.createdAt) : new Date(),
                customerName: conv?.contactName || msg.senderName || 'Unknown',
                customerPhone: conv?.phoneNumber || '',
                summary: isVideo
                    ? 'Video/image received'
                    : msg.content?.substring(0, 50) || 'Message received',
                leadId: conv?.leadId || undefined,
            });
        }

        // Sort by timestamp descending
        activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        // Return limited results
        res.json({
            activities: activities.slice(0, limit),
            total: activities.length,
        });

    } catch (error) {
        console.error('[ActivityStream] Error fetching activity:', error);
        res.status(500).json({ error: 'Failed to fetch activity stream' });
    }
});

// ==========================================
// TEST ENDPOINTS (for development)
// ==========================================

/**
 * POST /api/admin/test/auto-video
 * Manually trigger auto-video analysis on a transcript
 *
 * Body:
 * - transcript: string (required) - The call transcript to analyze
 * - phone: string (required) - Phone number to send message to
 * - customerName: string (optional) - Customer name
 * - sendMessage: boolean (optional) - Actually send the message (default: false for dry run)
 * - preferredChannel: 'whatsapp' | 'sms' | 'auto' (optional)
 */
leadsRouter.post('/api/admin/test/auto-video', async (req, res) => {
    try {
        const { transcript, phone, customerName, sendMessage, preferredChannel } = req.body;

        if (!transcript || transcript.length < 20) {
            return res.status(400).json({ error: 'Transcript is required (min 20 chars)' });
        }

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Import services
        const { analyzeCallForVideoRequest, generateVideoRequestMessage } = await import('./services/video-context-extractor');

        // Step 1: Analyze the transcript
        console.log('[TestAutoVideo] Analyzing transcript...');
        const analysis = await analyzeCallForVideoRequest(transcript);

        const result: any = {
            step1_analysis: {
                shouldRequestVideo: analysis.shouldRequestVideo,
                confidence: analysis.confidence,
                videoContext: analysis.videoContext,
                jobType: analysis.jobType,
                customerFirstName: analysis.customerFirstName,
                reasoning: analysis.reasoning,
            },
            wouldSend: analysis.shouldRequestVideo && analysis.confidence >= 80,
        };

        // Step 2: Generate message if would send
        if (result.wouldSend) {
            const message = generateVideoRequestMessage(analysis);
            result.step2_generatedMessage = message;

            // Step 3: Actually send if requested
            if (sendMessage === true) {
                const { processCallForAutoVideo } = await import('./services/auto-video-service');

                // Create a test lead if needed
                const testLeadId = `test_lead_${Date.now()}`;
                const testCallId = `test_call_${Date.now()}`;

                await db.insert(leads).values({
                    id: testLeadId,
                    customerName: customerName || analysis.customerFirstName || 'Test Customer',
                    phone: phone,
                    source: 'test_auto_video',
                    jobDescription: `Test: ${analysis.jobType}`,
                    status: 'new',
                });

                const sendResult = await processCallForAutoVideo(
                    testCallId,
                    testLeadId,
                    transcript,
                    phone,
                    customerName || analysis.customerFirstName || 'there',
                    {
                        delayMs: 0, // No delay for testing
                        preferredChannel: preferredChannel || 'auto',
                    }
                );

                result.step3_sendResult = sendResult;
                result.testLeadId = testLeadId;
            } else {
                result.step3_sendResult = { skipped: true, reason: 'sendMessage=false (dry run)' };
            }
        }

        res.json(result);

    } catch (error) {
        console.error('[TestAutoVideo] Error:', error);
        res.status(500).json({
            error: 'Test failed',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/admin/test/video-analysis
 * Analyze a transcript without sending (quick test)
 */
leadsRouter.post('/api/admin/test/video-analysis', async (req, res) => {
    try {
        const { transcript } = req.body;

        if (!transcript) {
            return res.status(400).json({ error: 'Transcript is required' });
        }

        const { analyzeCallForVideoRequest, generateVideoRequestMessage } = await import('./services/video-context-extractor');

        const analysis = await analyzeCallForVideoRequest(transcript);
        const message = analysis.shouldRequestVideo ? generateVideoRequestMessage(analysis) : null;

        res.json({
            analysis,
            generatedMessage: message,
            wouldAutoSend: analysis.shouldRequestVideo && analysis.confidence >= 80,
        });

    } catch (error) {
        console.error('[TestVideoAnalysis] Error:', error);
        res.status(500).json({ error: 'Analysis failed' });
    }
});

// ==========================================
// PIPELINE UI ENDPOINTS
// ==========================================

/**
 * GET /api/admin/leads/:id/timeline
 * Returns the full timeline of a lead's journey including all interactions.
 */
leadsRouter.get('/api/admin/leads/:id/timeline', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch the lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Determine the route based on quote mode or lead data
        const [quote] = await db.select()
            .from(personalizedQuotes)
            .where(or(
                eq(personalizedQuotes.leadId, id),
                eq(personalizedQuotes.phone, lead.phone)
            ))
            .orderBy(desc(personalizedQuotes.createdAt))
            .limit(1);

        let route: 'video' | 'instant' | 'site_visit' = 'instant';
        if (lead.route === 'video') {
            route = 'video';
        } else if (lead.route === 'site_visit') {
            route = 'site_visit';
        } else if (quote?.quoteMode === 'simple') {
            route = 'instant';
        } else if (quote?.quoteMode === 'consultation') {
            route = 'site_visit';
        } else if (lead.awaitingVideo) {
            route = 'video';
        }

        // 2. Build timeline items from various sources
        interface TimelineItem {
            id: string;
            type: 'call' | 'whatsapp_sent' | 'whatsapp_received' | 'video_received' | 'quote_sent' | 'quote_viewed' | 'stage_change' | 'note';
            timestamp: Date;
            summary: string;
            details: Record<string, any>;
        }

        const timelineItems: TimelineItem[] = [];

        // 2a. Fetch calls matching the lead's phone number
        const leadCalls = await db.select()
            .from(calls)
            .where(eq(calls.phoneNumber, lead.phone))
            .orderBy(desc(calls.startTime));

        for (const call of leadCalls) {
            const duration = call.duration || 0;
            const durationStr = duration > 0 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : 'Unknown';

            timelineItems.push({
                id: `call_${call.id}`,
                type: 'call',
                timestamp: call.startTime,
                summary: call.outcome
                    ? `${call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call - ${call.outcome} (${durationStr})`
                    : `${call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call (${durationStr})`,
                details: {
                    duration: call.duration,
                    recordingUrl: call.recordingUrl,
                    transcript: call.transcription,
                    outcome: call.outcome,
                    jobSummary: call.jobSummary,
                },
            });
        }

        // 2b. Fetch WhatsApp messages
        // First, find the conversation for this phone number
        const phoneForConversation = lead.phone.includes('@') ? lead.phone : `${lead.phone}@c.us`;
        const [conversation] = await db.select()
            .from(conversations)
            .where(eq(conversations.phoneNumber, phoneForConversation))
            .limit(1);

        if (conversation) {
            const conversationMessages = await db.select()
                .from(messages)
                .where(eq(messages.conversationId, conversation.id))
                .orderBy(desc(messages.createdAt));

            for (const msg of conversationMessages) {
                const isVideo = msg.type === 'video' || msg.type === 'image';
                const isInbound = msg.direction === 'inbound';

                if (isVideo && isInbound) {
                    timelineItems.push({
                        id: `video_${msg.id}`,
                        type: 'video_received',
                        timestamp: msg.createdAt || new Date(),
                        summary: 'Customer sent video/image',
                        details: {
                            mediaUrl: msg.mediaUrl,
                            thumbnailUrl: msg.mediaUrl, // Same as mediaUrl for now
                            caption: msg.content,
                        },
                    });
                } else {
                    timelineItems.push({
                        id: `wa_${msg.id}`,
                        type: isInbound ? 'whatsapp_received' : 'whatsapp_sent',
                        timestamp: msg.createdAt || new Date(),
                        summary: msg.content?.substring(0, 100) || (isInbound ? 'Message received' : 'Message sent'),
                        details: {
                            message: msg.content,
                            direction: isInbound ? 'in' : 'out',
                            mediaUrl: msg.mediaUrl,
                            mediaType: msg.mediaType,
                        },
                    });
                }
            }
        }

        // 2c. Fetch quotes and add quote-related timeline items
        const leadQuotes = await db.select()
            .from(personalizedQuotes)
            .where(or(
                eq(personalizedQuotes.leadId, id),
                eq(personalizedQuotes.phone, lead.phone)
            ))
            .orderBy(desc(personalizedQuotes.createdAt));

        for (const q of leadQuotes) {
            // Quote sent
            if (q.createdAt) {
                const selectedPrice = q.selectedPackage === 'essential' ? q.essentialPrice :
                                      q.selectedPackage === 'enhanced' ? q.enhancedPrice :
                                      q.selectedPackage === 'elite' ? q.elitePrice :
                                      q.basePrice;

                timelineItems.push({
                    id: `quote_sent_${q.id}`,
                    type: 'quote_sent',
                    timestamp: q.createdAt,
                    summary: `Quote sent - ${q.quoteMode === 'hhh' ? 'HHH package' : 'Simple quote'}`,
                    details: {
                        quoteId: q.id,
                        slug: q.shortSlug,
                        amount: selectedPrice || q.essentialPrice || q.basePrice,
                        quoteMode: q.quoteMode,
                    },
                });
            }

            // Quote viewed
            if (q.viewedAt) {
                timelineItems.push({
                    id: `quote_viewed_${q.id}`,
                    type: 'quote_viewed',
                    timestamp: q.viewedAt,
                    summary: `Quote viewed${q.viewCount && q.viewCount > 1 ? ` (${q.viewCount} times)` : ''}`,
                    details: {
                        quoteId: q.id,
                        slug: q.shortSlug,
                        viewCount: q.viewCount,
                    },
                });
            }

            // Quote selected (stage change)
            if (q.selectedAt) {
                timelineItems.push({
                    id: `quote_selected_${q.id}`,
                    type: 'stage_change',
                    timestamp: q.selectedAt,
                    summary: `Selected ${q.selectedPackage || 'package'}`,
                    details: {
                        from: 'quote_viewed',
                        to: 'awaiting_payment',
                        reason: `Customer selected ${q.selectedPackage} package`,
                    },
                });
            }

            // Quote booked
            if (q.bookedAt) {
                timelineItems.push({
                    id: `quote_booked_${q.id}`,
                    type: 'stage_change',
                    timestamp: q.bookedAt,
                    summary: 'Booking confirmed',
                    details: {
                        from: 'awaiting_payment',
                        to: 'booked',
                        reason: 'Payment received and booking confirmed',
                    },
                });
            }
        }

        // 2d. Add lead creation and stage changes
        if (lead.createdAt) {
            timelineItems.push({
                id: `lead_created_${lead.id}`,
                type: 'stage_change',
                timestamp: lead.createdAt,
                summary: `Lead created from ${lead.source || 'unknown source'}`,
                details: {
                    from: null,
                    to: 'new_lead',
                    reason: `Lead captured via ${lead.source}`,
                },
            });
        }

        // Sort timeline by timestamp descending
        timelineItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        // 3. Build response
        res.json({
            lead: {
                id: lead.id,
                customerName: lead.customerName,
                phone: lead.phone,
                stage: lead.stage || 'new_lead',
                route,
                jobDescription: lead.jobDescription,
                createdAt: lead.createdAt?.toISOString() || null,
                stageUpdatedAt: lead.stageUpdatedAt?.toISOString() || null,
            },
            timeline: timelineItems.map(item => ({
                id: item.id,
                type: item.type,
                timestamp: item.timestamp instanceof Date ? item.timestamp.toISOString() : item.timestamp,
                summary: item.summary,
                details: item.details,
            })),
        });

    } catch (error) {
        console.error('[Pipeline] Error fetching lead timeline:', error);
        res.status(500).json({ error: 'Failed to fetch lead timeline' });
    }
});

/**
 * GET /api/admin/leads/:id/video
 * Returns video attachment info for a lead (if they sent one via WhatsApp).
 */
leadsRouter.get('/api/admin/leads/:id/video', async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch the lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));

        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Find the conversation for this phone number
        const phoneForConversation = lead.phone.includes('@') ? lead.phone : `${lead.phone}@c.us`;
        const [conversation] = await db.select()
            .from(conversations)
            .where(eq(conversations.phoneNumber, phoneForConversation))
            .limit(1);

        if (!conversation) {
            return res.json({
                hasVideo: false,
                videos: [],
            });
        }

        // Find video/image messages in this conversation
        const videoMessages = await db.select()
            .from(messages)
            .where(and(
                eq(messages.conversationId, conversation.id),
                or(
                    eq(messages.type, 'video'),
                    eq(messages.type, 'image')
                ),
                eq(messages.direction, 'inbound')
            ))
            .orderBy(desc(messages.createdAt));

        if (videoMessages.length === 0) {
            return res.json({
                hasVideo: false,
                videos: [],
            });
        }

        const videos = videoMessages.map(msg => ({
            id: msg.id,
            type: msg.type,
            mediaUrl: msg.mediaUrl,
            thumbnailUrl: msg.mediaUrl, // Use same URL for thumbnail
            caption: msg.content,
            receivedAt: msg.createdAt?.toISOString() || null,
            mediaType: msg.mediaType,
        }));

        res.json({
            hasVideo: true,
            videos,
            latestVideo: videos[0],
        });

    } catch (error) {
        console.error('[Pipeline] Error fetching lead video:', error);
        res.status(500).json({ error: 'Failed to fetch lead video' });
    }
});

// ==========================================
// PIPELINE HOME DASHBOARD API
// ==========================================

// Types for Pipeline Home
type AlertType = 'sla_breach' | 'customer_reply' | 'payment_issue';
type AlertSeverity = 'high' | 'medium' | 'low';
type ActivityEventType = 'call_started' | 'call_ended' | 'automation_sent' | 'quote_sent' | 'quote_viewed' | 'quote_selected' | 'payment_received' | 'payment_failed' | 'stage_change';

interface PipelineAlert {
    id: string;
    type: AlertType;
    severity: AlertSeverity;
    leadId: string;
    customerName: string;
    message: string;
    createdAt: string;
    data: Record<string, any>;
}

interface ActivityEvent {
    id: string;
    type: ActivityEventType;
    leadId: string | null;
    customerName: string;
    summary: string;
    icon: string;
    timestamp: string;
    data: Record<string, any>;
}

/**
 * GET /api/admin/pipeline/alerts
 * Returns exceptions needing human attention:
 * - SLA breaches (leads stuck too long in a stage)
 * - Customer replies needing judgment (complaints, complex questions)
 * - Payment issues (failed payments, refund requests)
 */
leadsRouter.get('/api/admin/pipeline/alerts', async (req, res) => {
    try {
        const alerts: PipelineAlert[] = [];
        const now = Date.now();

        // 1. SLA Breaches - Check all active leads for SLA violations
        const activeLeads = await db.select()
            .from(leads)
            .where(and(
                isNotNull(leads.stage),
                isNotNull(leads.stageUpdatedAt)
            ));

        for (const lead of activeLeads) {
            const stage = lead.stage as LeadStage;
            const slaHours = STAGE_SLA_HOURS[stage];

            // Skip stages without SLA or terminal stages
            if (!slaHours || ['completed', 'lost', 'expired', 'declined'].includes(stage)) {
                continue;
            }

            if (!lead.stageUpdatedAt) continue;

            const hoursInStage = (now - new Date(lead.stageUpdatedAt).getTime()) / (1000 * 60 * 60);

            if (hoursInStage > slaHours) {
                // SLA breach!
                const overBy = Math.round((hoursInStage - slaHours) * 10) / 10;
                const severity: AlertSeverity = overBy > slaHours ? 'high' : overBy > slaHours / 2 ? 'medium' : 'low';

                alerts.push({
                    id: `sla_${lead.id}`,
                    type: 'sla_breach',
                    severity,
                    leadId: lead.id,
                    customerName: lead.customerName,
                    message: `Stuck in ${getStageDisplayName(stage)} for ${formatTimeInStage(lead.stageUpdatedAt)} (SLA: ${slaHours}h)`,
                    createdAt: lead.stageUpdatedAt.toISOString(),
                    data: {
                        stage,
                        slaHours,
                        hoursInStage: Math.round(hoursInStage * 10) / 10,
                        overBy,
                        nextAction: getNextAction(stage),
                    },
                });
            }
        }

        // 2. Customer Replies Needing Attention
        // Look for conversations with unread messages that might need judgment
        const unreadConversations = await db.select({
            id: conversations.id,
            phoneNumber: conversations.phoneNumber,
            contactName: conversations.contactName,
            unreadCount: conversations.unreadCount,
            lastMessagePreview: conversations.lastMessagePreview,
            lastMessageAt: conversations.lastMessageAt,
            leadId: conversations.leadId,
        })
            .from(conversations)
            .where(gte(conversations.unreadCount, 1))
            .orderBy(desc(conversations.lastMessageAt))
            .limit(20);

        // Check message content for keywords that suggest need for human judgment
        const needsJudgmentKeywords = ['complaint', 'unhappy', 'refund', 'problem', 'issue', 'cancel', 'wrong', 'bad', 'terrible', 'angry', 'disappointed'];

        for (const conv of unreadConversations) {
            const preview = (conv.lastMessagePreview || '').toLowerCase();
            const needsJudgment = needsJudgmentKeywords.some(keyword => preview.includes(keyword));

            if (needsJudgment || (conv.unreadCount || 0) > 3) {
                const severity: AlertSeverity = needsJudgment ? 'high' : (conv.unreadCount || 0) > 5 ? 'medium' : 'low';

                alerts.push({
                    id: `reply_${conv.id}`,
                    type: 'customer_reply',
                    severity,
                    leadId: conv.leadId || '',
                    customerName: conv.contactName || 'Unknown',
                    message: needsJudgment
                        ? `Customer message may need attention: "${(conv.lastMessagePreview || '').substring(0, 50)}..."`
                        : `${conv.unreadCount} unread messages waiting`,
                    createdAt: conv.lastMessageAt?.toISOString() || new Date().toISOString(),
                    data: {
                        conversationId: conv.id,
                        phoneNumber: conv.phoneNumber,
                        unreadCount: conv.unreadCount,
                        lastMessagePreview: conv.lastMessagePreview,
                        needsJudgment,
                    },
                });
            }
        }

        // 3. Payment Issues
        // Check for overdue invoices
        const overdueInvoices = await db.select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            customerName: invoices.customerName,
            balanceDue: invoices.balanceDue,
            dueDate: invoices.dueDate,
            quoteId: invoices.quoteId,
        })
            .from(invoices)
            .where(and(
                eq(invoices.status, 'sent'),
                isNotNull(invoices.dueDate)
            ))
            .limit(50);

        for (const invoice of overdueInvoices) {
            if (!invoice.dueDate) continue;

            const dueDate = new Date(invoice.dueDate);
            const daysOverdue = Math.floor((now - dueDate.getTime()) / (1000 * 60 * 60 * 24));

            if (daysOverdue > 0) {
                const severity: AlertSeverity = daysOverdue > 7 ? 'high' : daysOverdue > 3 ? 'medium' : 'low';

                // Get associated lead
                let leadId = '';
                if (invoice.quoteId) {
                    const [quote] = await db.select({ leadId: personalizedQuotes.leadId })
                        .from(personalizedQuotes)
                        .where(eq(personalizedQuotes.id, invoice.quoteId))
                        .limit(1);
                    leadId = quote?.leadId || '';
                }

                alerts.push({
                    id: `payment_${invoice.id}`,
                    type: 'payment_issue',
                    severity,
                    leadId,
                    customerName: invoice.customerName,
                    message: `Invoice ${invoice.invoiceNumber} is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue (${((invoice.balanceDue || 0) / 100).toFixed(2)} due)`,
                    createdAt: invoice.dueDate.toISOString(),
                    data: {
                        invoiceId: invoice.id,
                        invoiceNumber: invoice.invoiceNumber,
                        balanceDuePence: invoice.balanceDue,
                        daysOverdue,
                        dueDate: invoice.dueDate.toISOString(),
                    },
                });
            }
        }

        // Check for quotes with awaiting_payment stage for too long
        const awaitingPaymentLeads = await db.select()
            .from(leads)
            .where(eq(leads.stage, 'awaiting_payment'));

        for (const lead of awaitingPaymentLeads) {
            if (!lead.stageUpdatedAt) continue;

            const hoursWaiting = (now - new Date(lead.stageUpdatedAt).getTime()) / (1000 * 60 * 60);

            // Alert if waiting for payment for more than 12 hours
            if (hoursWaiting > 12) {
                const severity: AlertSeverity = hoursWaiting > 48 ? 'high' : hoursWaiting > 24 ? 'medium' : 'low';

                alerts.push({
                    id: `payment_waiting_${lead.id}`,
                    type: 'payment_issue',
                    severity,
                    leadId: lead.id,
                    customerName: lead.customerName,
                    message: `Awaiting payment for ${formatTimeInStage(lead.stageUpdatedAt)}`,
                    createdAt: lead.stageUpdatedAt.toISOString(),
                    data: {
                        stage: 'awaiting_payment',
                        hoursWaiting: Math.round(hoursWaiting),
                    },
                });
            }
        }

        // Sort alerts by severity (high first) then by createdAt (most recent first)
        const severityOrder: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };
        alerts.sort((a, b) => {
            if (severityOrder[a.severity] !== severityOrder[b.severity]) {
                return severityOrder[a.severity] - severityOrder[b.severity];
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        res.json({
            alerts,
            count: alerts.length,
        });

    } catch (error) {
        console.error('[Pipeline] Error fetching alerts:', error);
        res.status(500).json({ error: 'Failed to fetch pipeline alerts' });
    }
});

/**
 * GET /api/admin/pipeline/live-feed
 * Returns recent activity across the system
 */
leadsRouter.get('/api/admin/pipeline/live-feed', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const sinceParam = req.query.since as string;
        const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);

        const events: ActivityEvent[] = [];

        // 1. Call events
        const recentCalls = await db.select({
            id: calls.id,
            phoneNumber: calls.phoneNumber,
            customerName: calls.customerName,
            startTime: calls.startTime,
            endTime: calls.endTime,
            status: calls.status,
            outcome: calls.outcome,
            jobSummary: calls.jobSummary,
            leadId: calls.leadId,
            videoRequestSentAt: calls.videoRequestSentAt,
        })
            .from(calls)
            .where(gte(calls.startTime, since))
            .orderBy(desc(calls.startTime))
            .limit(limit);

        for (const call of recentCalls) {
            // Call ended event
            if (call.endTime) {
                events.push({
                    id: `call_ended_${call.id}`,
                    type: 'call_ended',
                    leadId: call.leadId,
                    customerName: call.customerName || 'Unknown',
                    summary: call.jobSummary
                        ? `Call ended - ${call.jobSummary.substring(0, 50)}${call.jobSummary.length > 50 ? '...' : ''}`
                        : `Call ended (${call.outcome || 'Unknown outcome'})`,
                    icon: '📞',
                    timestamp: call.endTime.toISOString(),
                    data: {
                        callId: call.id,
                        outcome: call.outcome,
                        phoneNumber: call.phoneNumber,
                    },
                });
            }

            // Call started event (for recent calls that haven't ended)
            if (!call.endTime && call.status === 'in-progress') {
                events.push({
                    id: `call_started_${call.id}`,
                    type: 'call_started',
                    leadId: call.leadId,
                    customerName: call.customerName || 'Unknown',
                    summary: 'Call in progress',
                    icon: '🔔',
                    timestamp: call.startTime.toISOString(),
                    data: {
                        callId: call.id,
                        phoneNumber: call.phoneNumber,
                    },
                });
            }

            // Video request sent event
            if (call.videoRequestSentAt) {
                events.push({
                    id: `video_req_${call.id}`,
                    type: 'automation_sent',
                    leadId: call.leadId,
                    customerName: call.customerName || 'Unknown',
                    summary: 'Video request sent via WhatsApp',
                    icon: '📹',
                    timestamp: call.videoRequestSentAt.toISOString(),
                    data: {
                        callId: call.id,
                        automationType: 'video_request',
                    },
                });
            }
        }

        // 2. Quote events
        const recentQuotes = await db.select({
            id: personalizedQuotes.id,
            customerName: personalizedQuotes.customerName,
            leadId: personalizedQuotes.leadId,
            createdAt: personalizedQuotes.createdAt,
            viewedAt: personalizedQuotes.viewedAt,
            selectedAt: personalizedQuotes.selectedAt,
            selectedPackage: personalizedQuotes.selectedPackage,
            bookedAt: personalizedQuotes.bookedAt,
            shortSlug: personalizedQuotes.shortSlug,
        })
            .from(personalizedQuotes)
            .where(gte(personalizedQuotes.createdAt, since))
            .orderBy(desc(personalizedQuotes.createdAt))
            .limit(limit);

        for (const quote of recentQuotes) {
            // Quote sent
            if (quote.createdAt) {
                events.push({
                    id: `quote_sent_${quote.id}`,
                    type: 'quote_sent',
                    leadId: quote.leadId,
                    customerName: quote.customerName,
                    summary: `Quote created (${quote.shortSlug})`,
                    icon: '📝',
                    timestamp: quote.createdAt.toISOString(),
                    data: {
                        quoteId: quote.id,
                        shortSlug: quote.shortSlug,
                    },
                });
            }

            // Quote viewed
            if (quote.viewedAt) {
                events.push({
                    id: `quote_viewed_${quote.id}`,
                    type: 'quote_viewed',
                    leadId: quote.leadId,
                    customerName: quote.customerName,
                    summary: 'Quote viewed by customer',
                    icon: '👁️',
                    timestamp: quote.viewedAt.toISOString(),
                    data: {
                        quoteId: quote.id,
                        shortSlug: quote.shortSlug,
                    },
                });
            }

            // Quote selected
            if (quote.selectedAt && quote.selectedPackage) {
                events.push({
                    id: `quote_selected_${quote.id}`,
                    type: 'quote_selected',
                    leadId: quote.leadId,
                    customerName: quote.customerName,
                    summary: `Selected ${quote.selectedPackage} package`,
                    icon: '✅',
                    timestamp: quote.selectedAt.toISOString(),
                    data: {
                        quoteId: quote.id,
                        selectedPackage: quote.selectedPackage,
                    },
                });
            }

            // Payment received (booked)
            if (quote.bookedAt) {
                events.push({
                    id: `payment_${quote.id}`,
                    type: 'payment_received',
                    leadId: quote.leadId,
                    customerName: quote.customerName,
                    summary: 'Payment received - Booking confirmed',
                    icon: '💳',
                    timestamp: quote.bookedAt.toISOString(),
                    data: {
                        quoteId: quote.id,
                    },
                });
            }
        }

        // 3. Stage change events (from leads with recent stageUpdatedAt)
        const recentStageChanges = await db.select({
            id: leads.id,
            customerName: leads.customerName,
            stage: leads.stage,
            stageUpdatedAt: leads.stageUpdatedAt,
            route: leads.route,
        })
            .from(leads)
            .where(and(
                gte(leads.stageUpdatedAt, since),
                isNotNull(leads.stageUpdatedAt)
            ))
            .orderBy(desc(leads.stageUpdatedAt))
            .limit(limit);

        for (const lead of recentStageChanges) {
            const stage = lead.stage as LeadStage;
            // Only add stage change events for significant stages
            if (['booked', 'in_progress', 'completed', 'lost'].includes(stage)) {
                const icons: Record<string, string> = {
                    booked: '📅',
                    in_progress: '🔧',
                    completed: '✨',
                    lost: '❌',
                };

                events.push({
                    id: `stage_${lead.id}_${stage}`,
                    type: 'stage_change',
                    leadId: lead.id,
                    customerName: lead.customerName,
                    summary: `Stage changed to ${getStageDisplayName(stage)}`,
                    icon: icons[stage] || '🔄',
                    timestamp: lead.stageUpdatedAt!.toISOString(),
                    data: {
                        stage,
                        route: lead.route,
                    },
                });
            }
        }

        // Sort all events by timestamp (most recent first)
        events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        // Limit results
        const limitedEvents = events.slice(0, limit);

        res.json({
            events: limitedEvents,
            hasMore: events.length > limit,
        });

    } catch (error) {
        console.error('[Pipeline] Error fetching live feed:', error);
        res.status(500).json({ error: 'Failed to fetch live feed' });
    }
});

/**
 * GET /api/admin/pipeline/station-counts
 * Returns lead counts per pipeline stage for tube map display
 */
leadsRouter.get('/api/admin/pipeline/station-counts', async (req, res) => {
    try {
        // Get all leads and count by stage
        const allLeads = await db.select({
            stage: leads.stage,
        }).from(leads);

        // Initialize counts for all stages
        const counts: Record<LeadStage, number> = {
            new_lead: 0,
            contacted: 0,
            awaiting_video: 0,
            video_received: 0,
            visit_scheduled: 0,
            visit_done: 0,
            quote_sent: 0,
            quote_viewed: 0,
            awaiting_payment: 0,
            booked: 0,
            in_progress: 0,
            completed: 0,
            lost: 0,
            expired: 0,
            declined: 0,
        };

        // Count leads by stage
        for (const lead of allLeads) {
            const stage = (lead.stage as LeadStage) || 'new_lead';
            if (counts.hasOwnProperty(stage)) {
                counts[stage]++;
            }
        }

        // Calculate total
        const total = allLeads.length;

        res.json({
            counts,
            total,
        });

    } catch (error) {
        console.error('[Pipeline] Error fetching station counts:', error);
        res.status(500).json({ error: 'Failed to fetch station counts' });
    }
});

// ==========================================
// SEGMENT REVIEW QUEUE API
// ==========================================

/**
 * GET /api/admin/leads/needs-review
 * Returns leads with status "needs_review" for VA segment approval
 */
leadsRouter.get('/api/admin/leads/needs-review', async (req, res) => {
    try {
        // Fetch all leads with needs_review status
        const reviewLeads = await db.select()
            .from(leads)
            .where(eq(leads.status, 'needs_review'))
            .orderBy(desc(leads.createdAt));

        // Get related calls for transcript snippets
        const phones = reviewLeads.map(l => l.phone);
        const relatedCalls = phones.length > 0 ? await db.select({
            phoneNumber: calls.phoneNumber,
            transcription: calls.transcription,
            jobSummary: calls.jobSummary,
        }).from(calls)
        .where(inArray(calls.phoneNumber, phones))
        .orderBy(desc(calls.startTime)) : [];

        // Build call lookup by phone
        const callsByPhone = new Map<string, typeof relatedCalls[number]>();
        for (const call of relatedCalls) {
            if (!callsByPhone.has(call.phoneNumber)) {
                callsByPhone.set(call.phoneNumber, call);
            }
        }

        // Build response
        const results = reviewLeads.map(lead => {
            const call = callsByPhone.get(lead.phone);
            return {
                id: lead.id,
                customerName: lead.customerName,
                phone: lead.phone,
                email: lead.email,
                segment: lead.segment,
                segmentConfidence: lead.segmentConfidence,
                segmentSignals: lead.segmentSignals as string[] || [],
                jobDescription: lead.jobDescription,
                jobSummary: lead.jobSummary || call?.jobSummary,
                transcriptSnippet: call?.transcription?.substring(0, 300) || null,
                source: lead.source,
                createdAt: lead.createdAt,
            };
        });

        res.json({
            leads: results,
            count: results.length,
        });

    } catch (error) {
        console.error('[SegmentReview] Error fetching leads:', error);
        res.status(500).json({ error: 'Failed to fetch leads needing review' });
    }
});

/**
 * PUT /api/admin/leads/:id/approve-segment
 * Approve the AI-detected segment and change status to ready
 */
leadsRouter.put('/api/admin/leads/:id/approve-segment', async (req, res) => {
    try {
        const { id } = req.params;

        // Get current lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        if (lead.status !== 'needs_review') {
            return res.status(400).json({ error: 'Lead is not in needs_review status' });
        }

        // Approve the segment - change status to ready
        await db.update(leads)
            .set({
                status: 'ready',
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        console.log(`[SegmentReview] Approved segment ${lead.segment} for lead ${id}`);

        res.json({
            success: true,
            leadId: id,
            segment: lead.segment,
            newStatus: 'ready',
        });

    } catch (error) {
        console.error('[SegmentReview] Error approving segment:', error);
        res.status(500).json({ error: 'Failed to approve segment' });
    }
});

/**
 * PUT /api/admin/leads/:id/segment
 * Change the segment and approve (change status to ready)
 */
leadsRouter.put('/api/admin/leads/:id/segment', async (req, res) => {
    try {
        const { id } = req.params;
        const { segment } = req.body;

        // Validate segment
        const validSegments = ['EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'TRUST_SEEKER', 'RENTER', 'DIY_DEFERRER', 'BUDGET', 'DEFAULT'];
        if (!segment || !validSegments.includes(segment)) {
            return res.status(400).json({
                error: 'Invalid segment',
                validSegments,
            });
        }

        // Get current lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        const previousSegment = lead.segment;

        // Update segment and change status to ready
        await db.update(leads)
            .set({
                segment: segment,
                segmentConfidence: 100, // Manual override = 100% confidence
                status: 'ready',
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        console.log(`[SegmentReview] Changed segment for lead ${id}: ${previousSegment} -> ${segment}`);

        res.json({
            success: true,
            leadId: id,
            previousSegment,
            newSegment: segment,
            newStatus: 'ready',
        });

    } catch (error) {
        console.error('[SegmentReview] Error changing segment:', error);
        res.status(500).json({ error: 'Failed to change segment' });
    }
});

/**
 * PUT /api/admin/leads/:id/mark-junk
 * Mark a lead as junk/spam
 */
leadsRouter.put('/api/admin/leads/:id/mark-junk', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        // Get current lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Mark as junk
        await db.update(leads)
            .set({
                status: 'junk',
                segment: null,
                segmentConfidence: null,
                jobDescription: reason ? `[JUNK] ${reason} | Original: ${lead.jobDescription}` : lead.jobDescription,
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        console.log(`[SegmentReview] Marked lead ${id} as junk. Reason: ${reason || 'none'}`);

        res.json({
            success: true,
            leadId: id,
            newStatus: 'junk',
        });

    } catch (error) {
        console.error('[SegmentReview] Error marking lead as junk:', error);
        res.status(500).json({ error: 'Failed to mark lead as junk' });
    }
});

/**
 * POST /api/admin/leads/bulk-approve
 * Bulk approve multiple leads with their detected segments
 */
leadsRouter.post('/api/admin/leads/bulk-approve', async (req, res) => {
    try {
        const { leadIds } = req.body;

        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ error: 'leadIds must be a non-empty array' });
        }

        // Update all specified leads
        const result = await db.update(leads)
            .set({
                status: 'ready',
                updatedAt: new Date(),
            })
            .where(and(
                inArray(leads.id, leadIds),
                eq(leads.status, 'needs_review')
            ));

        console.log(`[SegmentReview] Bulk approved ${leadIds.length} leads`);

        res.json({
            success: true,
            approvedCount: leadIds.length,
        });

    } catch (error) {
        console.error('[SegmentReview] Error bulk approving:', error);
        res.status(500).json({ error: 'Failed to bulk approve leads' });
    }
});

/**
 * POST /api/admin/leads/bulk-junk
 * Bulk mark multiple leads as junk
 */
leadsRouter.post('/api/admin/leads/bulk-junk', async (req, res) => {
    try {
        const { leadIds, reason } = req.body;

        if (!Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ error: 'leadIds must be a non-empty array' });
        }

        // Update all specified leads to junk status
        await db.update(leads)
            .set({
                status: 'junk',
                segment: null,
                segmentConfidence: null,
                updatedAt: new Date(),
            })
            .where(inArray(leads.id, leadIds));

        console.log(`[SegmentReview] Bulk marked ${leadIds.length} leads as junk. Reason: ${reason || 'none'}`);

        res.json({
            success: true,
            junkedCount: leadIds.length,
        });

    } catch (error) {
        console.error('[SegmentReview] Error bulk junking:', error);
        res.status(500).json({ error: 'Failed to bulk mark leads as junk' });
    }
});
