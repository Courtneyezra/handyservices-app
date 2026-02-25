import { Router } from "express";
import { db } from "./db";
import { tenantIssues, tenants, properties, leads, personalizedQuotes, landlordSettings, conversations, messages } from "@shared/schema";
import { eq, desc, sql, and, inArray, isNull, not, asc } from "drizzle-orm";
import { nanoid } from "nanoid";

const router = Router();

// Admin: Get all tenant issues with stats
router.get("/", async (req, res) => {
    console.log("[tenant-issues] GET / called");
    try {
        console.log("[tenant-issues] Fetching issues...");
        const issues = await db.query.tenantIssues.findMany({
            with: {
                tenant: true,
                property: true,
                landlord: true,
                quote: true,
            },
            orderBy: [desc(tenantIssues.createdAt)],
        });

        // Calculate stats
        const stats = {
            total: issues.length,
            new: issues.filter((i) => i.status === "new").length,
            aiHelping: issues.filter((i) => i.status === "ai_helping").length,
            awaitingDetails: issues.filter((i) => i.status === "awaiting_details").length,
            reported: issues.filter((i) => i.status === "reported").length,
            quoted: issues.filter((i) => i.status === "quoted").length,
            approved: issues.filter((i) => i.status === "approved").length,
            scheduled: issues.filter((i) => i.status === "scheduled").length,
            completed: issues.filter((i) => i.status === "completed").length,
            diyResolved: issues.filter((i) => i.status === "resolved_diy").length,
        };

        // Get unique landlords for filter dropdown
        const landlordIds = Array.from(new Set(issues.map((i) => i.landlordLeadId)));

        let landlordsList: { id: string; name: string }[] = [];
        if (landlordIds.length > 0) {
            const result = await db
                .select({ id: leads.id, name: leads.customerName })
                .from(leads)
                .where(inArray(leads.id, landlordIds));
            landlordsList = result.map((l) => ({ id: l.id, name: l.name }));
        }

        console.log("[tenant-issues] Returning", issues.length, "issues");
        res.json({
            issues,
            stats,
            landlords: landlordsList,
        });
    } catch (error) {
        console.error("[tenant-issues] Error fetching issues:", error);
        res.status(500).json({ error: "Failed to fetch issues" });
    }
});

// Admin: Get single issue detail
router.get("/:id", async (req, res) => {
    try {
        const issue = await db.query.tenantIssues.findFirst({
            where: eq(tenantIssues.id, req.params.id),
            with: {
                tenant: true,
                property: true,
                landlord: true,
                quote: true,
            },
        });

        if (!issue) {
            return res.status(404).json({ error: "Issue not found" });
        }

        res.json(issue);
    } catch (error) {
        console.error("[tenant-issues] Error fetching issue:", error);
        res.status(500).json({ error: "Failed to fetch issue" });
    }
});

// Admin: Convert issue to quote
router.post("/:id/convert", async (req, res) => {
    try {
        const issue = await db.query.tenantIssues.findFirst({
            where: eq(tenantIssues.id, req.params.id),
            with: {
                tenant: true,
                property: true,
                landlord: true,
            },
        });

        if (!issue) {
            return res.status(404).json({ error: "Issue not found" });
        }

        // Create a new personalized quote
        const shortSlug = nanoid(8);
        const [quote] = await db
            .insert(personalizedQuotes)
            .values({
                id: nanoid(),
                shortSlug,
                phone: issue.landlord?.phone || issue.tenant.phone,
                customerName: issue.landlord?.customerName || issue.tenant.name,
                address: issue.property.address,
                postcode: issue.property.postcode,
                jobDescription: issue.issueDescription || "Maintenance request",
                leadId: issue.landlordLeadId,
                segment: "LANDLORD",
                quoteMode: "simple",
            })
            .returning();

        // Link quote to issue
        await db
            .update(tenantIssues)
            .set({
                quoteId: quote.id,
                status: "quoted",
            })
            .where(eq(tenantIssues.id, issue.id));

        res.json({
            success: true,
            quoteId: quote.id,
            quoteSlug: quote.shortSlug,
        });
    } catch (error) {
        console.error("[tenant-issues] Error converting to quote:", error);
        res.status(500).json({ error: "Failed to convert to quote" });
    }
});

// Admin: Chase landlord (re-send notification)
router.post("/:id/chase", async (req, res) => {
    try {
        const issue = await db.query.tenantIssues.findFirst({
            where: eq(tenantIssues.id, req.params.id),
            with: {
                tenant: true,
                property: true,
                landlord: true,
            },
        });

        if (!issue) {
            return res.status(404).json({ error: "Issue not found" });
        }

        // TODO: Send WhatsApp reminder to landlord
        // For now, just log it
        console.log(`[tenant-issues] Chase reminder for issue ${issue.id} to landlord ${issue.landlord?.customerName}`);

        // In a real implementation, you would call sendWhatsAppMessage here
        // await sendWhatsAppMessage(issue.landlord.phone, `Reminder: You have a pending maintenance request...`);

        res.json({ success: true, message: "Chase reminder sent" });
    } catch (error) {
        console.error("[tenant-issues] Error chasing landlord:", error);
        res.status(500).json({ error: "Failed to chase landlord" });
    }
});

// Admin: Update issue status
router.patch("/:id/status", async (req, res) => {
    try {
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: "Status is required" });
        }

        const updateData: Partial<typeof tenantIssues.$inferInsert> = {
            status,
        };

        // Set resolvedAt for completion statuses
        if (["completed", "resolved_diy", "cancelled"].includes(status)) {
            updateData.resolvedAt = new Date();
        }

        await db
            .update(tenantIssues)
            .set(updateData)
            .where(eq(tenantIssues.id, req.params.id));

        res.json({ success: true });
    } catch (error) {
        console.error("[tenant-issues] Error updating status:", error);
        res.status(500).json({ error: "Failed to update status" });
    }
});

// Admin: Assign contractor to issue
router.post("/:id/assign", async (req, res) => {
    try {
        const { contractorId, scheduledDate } = req.body;

        const issue = await db.query.tenantIssues.findFirst({
            where: eq(tenantIssues.id, req.params.id),
        });

        if (!issue) {
            return res.status(404).json({ error: "Issue not found" });
        }

        // Update issue status to scheduled
        await db
            .update(tenantIssues)
            .set({
                status: "scheduled",
                // You could add contractorId and scheduledDate fields to tenantIssues if needed
            })
            .where(eq(tenantIssues.id, req.params.id));

        // TODO: Create job entry and link to issue
        // TODO: Notify tenant and landlord

        res.json({ success: true });
    } catch (error) {
        console.error("[tenant-issues] Error assigning contractor:", error);
        res.status(500).json({ error: "Failed to assign contractor" });
    }
});

// Admin: Get chat messages for an issue
router.get("/:id/messages", async (req, res) => {
    try {
        const issue = await db.query.tenantIssues.findFirst({
            where: eq(tenantIssues.id, req.params.id),
        });

        if (!issue) {
            return res.status(404).json({ error: "Issue not found" });
        }

        if (!issue.conversationId) {
            return res.json({ messages: [] });
        }

        // Fetch messages for this conversation
        const chatMessages = await db.query.messages.findMany({
            where: eq(messages.conversationId, issue.conversationId),
            orderBy: [asc(messages.createdAt)],
        });

        res.json({
            messages: chatMessages.map(m => ({
                id: m.id,
                direction: m.direction,
                content: m.content,
                type: m.type || 'text',
                mediaUrl: m.mediaUrl,
                mediaType: m.mediaType,
                createdAt: m.createdAt,
                senderName: m.senderName,
            })),
            conversationId: issue.conversationId,
        });
    } catch (error) {
        console.error("[tenant-issues] Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
});

// Admin: Get dashboard stats
router.get("/stats/summary", async (req, res) => {
    try {
        const [result] = await db
            .select({
                total: sql<number>`count(*)`,
                open: sql<number>`count(*) filter (where status in ('new', 'ai_helping', 'awaiting_details', 'reported', 'quoted', 'approved', 'scheduled'))`,
                completed: sql<number>`count(*) filter (where status = 'completed')`,
                diyResolved: sql<number>`count(*) filter (where status = 'resolved_diy')`,
                emergency: sql<number>`count(*) filter (where urgency = 'emergency' and status not in ('completed', 'cancelled', 'resolved_diy'))`,
            })
            .from(tenantIssues);

        res.json(result);
    } catch (error) {
        console.error("[tenant-issues] Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

export default router;
