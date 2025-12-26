
import { Router } from "express";
import { db } from "./db";
import { leads, insertLeadSchema, personalizedQuotes } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";

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
