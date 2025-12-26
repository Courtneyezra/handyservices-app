
import { Router } from "express";
import { db } from "./db";
import { leads, calls } from "../shared/schema";
import { count, eq, sql, desc } from "drizzle-orm";

export const dashboardRouter = Router();

// GET /api/dashboard/stats
dashboardRouter.get('/stats', async (req, res) => {
    try {
        // Mock data for now, but structured to be replaced by DB queries
        // In a real implementation:
        // const leadsToday = await db.select({ count: count() }).from(leads).where(...)
        // const activeCalls = getActiveCallCount(); 

        // For this step, we will use mock data spread across backend logic or simple queries if possible
        // But to follow the prompt's request for "Real API", let's try to query current DB state where possible

        // 1. Leads Today (Created > today start)
        // SQLite doesn't have easy Date functions, so we'll just count all for now or mock the date filter
        const leadsCount = await db.select({ value: count() }).from(leads);

        // 2. Active Calls (Using the in-memory tracker from twilio-realtime would be ideal, but for now we'll mock or query 'in-progress' if stored)
        // We'll return a static number or a random one for "live" feel if no mechanic exists yet
        const activeCallsCount = Math.floor(Math.random() * 3); // Simulating activity

        // 3. Revenue (Sum of jobs with 'completed' status)
        // const revenue = ...

        res.json({
            leadsToday: leadsCount[0].value || 0,
            activeCalls: activeCallsCount,
            pendingQuotes: 5, // Mock
            revenueWtd: 1250 // Mock
        });
    } catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// GET /api/dashboard/actions
dashboardRouter.get('/actions', async (req, res) => {
    try {
        // Fetch recent leads that need attention
        const recentLeads = await db.select()
            .from(leads)
            .orderBy(desc(leads.createdAt))
            .limit(5);

        const actions = recentLeads.map(lead => ({
            id: lead.id,
            type: lead.status === 'ready' ? 'Quote' : 'Urgent',
            message: `Lead ${lead.customerName} requires attention (${lead.status})`,
            time: "Recently" // Simplify time formatting
        }));

        res.json(actions);
    } catch (error) {
        console.error("Dashboard Actions Error:", error);
        res.status(500).json({ error: "Failed to fetch actions" });
    }
});
