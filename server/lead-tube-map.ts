/**
 * Lead Tube Map API
 *
 * London Tube-style lead pipeline visualization backend.
 * Provides endpoints for:
 * - Full tube map data with station counts and conversion rates
 * - Manual stage/route overrides
 * - Lead snoozing and merging
 * - Real-time broadcasting hooks
 */

import { Router } from "express";
import { db } from "./db";
import {
    leads,
    personalizedQuotes,
    conversations,
    calls,
    messages,
    LeadStage,
    LeadStageValues,
    LeadRoute,
    LeadRouteValues,
    segmentEnum
} from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, or, count, sql, gte, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { updateLeadStage, getSLAStatus, getStageDisplayName, getNextAction } from "./lead-stage-engine";
import { broadcastToClients } from "./index";

export const leadTubeMapRouter = Router();

// ==========================================
// TYPES
// ==========================================

interface StationData {
    id: LeadStage;
    name: string;
    count: number;
    leads: LeadItem[];
    segmentBreakdown: Record<string, number>;
}

interface LeadItem {
    id: string;
    customerName: string;
    phone: string;
    jobDescription: string | null;
    source: string | null;
    segment: string | null;
    stage: LeadStage;
    route: LeadRoute | null;
    stageUpdatedAt: Date | null;
    timeInStage: string;
    slaStatus: 'ok' | 'warning' | 'overdue';
    nextAction: string;
    hasWhatsAppWindow: boolean;
    quoteId?: string;
    quoteSlug?: string;
    snoozedUntil?: Date | null;
    createdAt: Date | null;
    qualificationScore: number | null;
    qualificationGrade: string | null;
}

interface RouteData {
    leads: LeadItem[];
    conversionRate: number;
    totalLeads: number;
    completedLeads: number;
}

interface EntryPointData {
    today: number;
    live?: number;
    unread?: number;
    needsChase?: number;
}

interface QualificationCounts {
    hot: number;
    warm: number;
    cold: number;
    unscored: number;
}

interface TodayStats {
    calls: number;
    whatsapp: number;
    webforms: number;
    quotesSent: number;
    quotesViewed: number;
    bookings: number;
}

interface ConversionRates {
    leadToQuote: number;      // % of leads that got a quote
    quoteToViewed: number;    // % of quotes that were viewed
    viewedToPaid: number;     // % of viewed quotes that converted
    overall: number;          // end-to-end conversion rate
}

interface TubeMapResponse {
    entryPoints: {
        calls: EntryPointData;
        whatsapp: EntryPointData;
        webForms: EntryPointData;
    };
    stations: StationData[];
    routes: {
        video: RouteData;
        instant_quote: RouteData;
        site_visit: RouteData;
    };
    conversions: Record<string, number>;
    qualificationCounts: QualificationCounts;
    today: TodayStats;
    conversionRates: ConversionRates;
}

// ==========================================
// HELPERS
// ==========================================

/**
 * Format time in stage as human-readable string
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
 * Check if phone has an active WhatsApp 24h window
 */
function hasWhatsAppWindow(lastInboundAt: Date | null): boolean {
    if (!lastInboundAt) return false;

    const windowMs = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    const inboundTime = new Date(lastInboundAt).getTime();

    return (now - inboundTime) < windowMs;
}

/**
 * Build lead item from raw data
 */
function buildLeadItem(
    lead: any,
    quote: any | null,
    conversation: any | null
): LeadItem {
    const stage = (lead.stage as LeadStage) || 'new_lead';
    const slaResult = getSLAStatus(stage, lead.stageUpdatedAt);

    return {
        id: lead.id,
        customerName: lead.customerName,
        phone: lead.phone,
        jobDescription: lead.jobDescription,
        source: lead.source,
        segment: quote?.segment || null,
        stage,
        route: lead.route as LeadRoute | null,
        stageUpdatedAt: lead.stageUpdatedAt,
        timeInStage: formatTimeInStage(lead.stageUpdatedAt),
        slaStatus: slaResult.status,
        nextAction: getNextAction(stage),
        hasWhatsAppWindow: hasWhatsAppWindow(conversation?.lastInboundAt || null),
        quoteId: quote?.id,
        quoteSlug: quote?.shortSlug,
        snoozedUntil: lead.snoozedUntil,
        createdAt: lead.createdAt,
        qualificationScore: lead.qualificationScore ?? null,
        qualificationGrade: lead.qualificationGrade ?? null,
    };
}

/**
 * Calculate conversion rate between stages
 */
function calculateConversionRate(fromCount: number, toCount: number): number {
    if (fromCount === 0) return 0;
    return Math.round((toCount / fromCount) * 100) / 100;
}

/**
 * Broadcast a lead event via WebSocket
 */
function broadcastLeadEvent(type: string, data: any) {
    try {
        broadcastToClients({
            type,
            data,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[LeadTubeMap] Failed to broadcast:', error);
    }
}

// ==========================================
// ENDPOINTS
// ==========================================

/**
 * GET /api/admin/lead-tube-map
 * Returns full tube map data with station counts, conversion rates, and leads
 */
leadTubeMapRouter.get('/api/admin/lead-tube-map', async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. Fetch all leads (non-merged)
        const allLeads = await db.select()
            .from(leads)
            .where(isNull(leads.mergedIntoId))
            .orderBy(desc(leads.createdAt));

        // 2. Fetch all quotes
        const allQuotes = await db.select({
            id: personalizedQuotes.id,
            leadId: personalizedQuotes.leadId,
            phone: personalizedQuotes.phone,
            shortSlug: personalizedQuotes.shortSlug,
            segment: personalizedQuotes.segment,
            viewedAt: personalizedQuotes.viewedAt,
            selectedAt: personalizedQuotes.selectedAt,
            bookedAt: personalizedQuotes.bookedAt,
        }).from(personalizedQuotes);

        // 3. Fetch conversations for WhatsApp window tracking
        const allConversations = await db.select({
            phoneNumber: conversations.phoneNumber,
            lastInboundAt: conversations.lastInboundAt,
            unreadCount: conversations.unreadCount,
        }).from(conversations);

        // 4. Fetch today's calls
        const todayCalls = await db.select({
            id: calls.id,
            status: calls.status,
        })
            .from(calls)
            .where(gte(calls.startTime, today));

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

        // 5. Calculate entry points
        const todayLeads = allLeads.filter(l => l.createdAt && new Date(l.createdAt) >= today);
        const callLeads = todayLeads.filter(l => l.source === 'call' || l.source === 'eleven_labs_agent');
        const whatsappLeads = todayLeads.filter(l => l.source === 'whatsapp');
        const webLeads = todayLeads.filter(l => l.source === 'web_quote' || l.source === 'webform');

        // Calculate unread WhatsApp messages
        const totalUnread = allConversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

        // Calculate web forms needing chase (no response for 2+ hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const webNeedsChase = allLeads.filter(l =>
            (l.source === 'web_quote' || l.source === 'webform') &&
            l.stage === 'new_lead' &&
            l.createdAt && new Date(l.createdAt) < twoHoursAgo
        ).length;

        const entryPoints = {
            calls: {
                today: callLeads.length,
                live: todayCalls.filter(c => c.status === 'in-progress' || c.status === 'ringing').length,
            },
            whatsapp: {
                today: whatsappLeads.length,
                unread: totalUnread,
            },
            webForms: {
                today: webLeads.length,
                needsChase: webNeedsChase,
            },
        };

        // 6. Build stations (stages)
        const stations: StationData[] = [];
        const stageCounts: Record<string, number> = {};

        // Initialize stage counts
        for (const stage of LeadStageValues) {
            stageCounts[stage] = 0;
        }

        // Group leads by stage and build station data
        const leadsByStage = new Map<LeadStage, any[]>();
        for (const stage of LeadStageValues) {
            leadsByStage.set(stage, []);
        }

        for (const lead of allLeads) {
            const stage = (lead.stage as LeadStage) || 'new_lead';
            const stageLeads = leadsByStage.get(stage) || [];
            stageLeads.push(lead);
            leadsByStage.set(stage, stageLeads);
            stageCounts[stage] = (stageCounts[stage] || 0) + 1;
        }

        for (const stage of LeadStageValues) {
            const stageLeads = leadsByStage.get(stage) || [];

            // Build segment breakdown
            const segmentBreakdown: Record<string, number> = {};
            for (const lead of stageLeads) {
                const quote = quotesByLeadId.get(lead.id) || quotesByPhone.get(lead.phone);
                const segment = quote?.segment || 'UNKNOWN';
                segmentBreakdown[segment] = (segmentBreakdown[segment] || 0) + 1;
            }

            // Build lead items
            const leadItems: LeadItem[] = stageLeads.map(lead => {
                const quote = quotesByLeadId.get(lead.id) || quotesByPhone.get(lead.phone);
                const conversation = conversationsByPhone.get(lead.phone);
                return buildLeadItem(lead, quote, conversation);
            });

            stations.push({
                id: stage,
                name: getStageDisplayName(stage),
                count: stageLeads.length,
                leads: leadItems,
                segmentBreakdown,
            });
        }

        // 7. Build routes data
        const routeLeads: Record<LeadRoute, any[]> = {
            'video': [],
            'instant_quote': [],
            'site_visit': [],
        };

        for (const lead of allLeads) {
            if (lead.route && LeadRouteValues.includes(lead.route as LeadRoute)) {
                routeLeads[lead.route as LeadRoute].push(lead);
            }
        }

        const buildRouteData = (route: LeadRoute): RouteData => {
            const routeLeadsList = routeLeads[route];
            const completedLeads = routeLeadsList.filter(l => l.stage === 'completed' || l.stage === 'booked').length;

            const leadItems = routeLeadsList.map(lead => {
                const quote = quotesByLeadId.get(lead.id) || quotesByPhone.get(lead.phone);
                const conversation = conversationsByPhone.get(lead.phone);
                return buildLeadItem(lead, quote, conversation);
            });

            return {
                leads: leadItems,
                totalLeads: routeLeadsList.length,
                completedLeads,
                conversionRate: calculateConversionRate(routeLeadsList.length, completedLeads),
            };
        };

        const routes = {
            video: buildRouteData('video'),
            instant_quote: buildRouteData('instant_quote'),
            site_visit: buildRouteData('site_visit'),
        };

        // 8. Calculate stage-to-stage conversion rates
        const conversions: Record<string, number> = {
            'new_lead->contacted': calculateConversionRate(
                stageCounts['new_lead'] + stageCounts['contacted'],
                stageCounts['contacted']
            ),
            'contacted->quote_sent': calculateConversionRate(
                stageCounts['contacted'] + stageCounts['quote_sent'],
                stageCounts['quote_sent']
            ),
            'quote_sent->quote_viewed': calculateConversionRate(
                stageCounts['quote_sent'] + stageCounts['quote_viewed'],
                stageCounts['quote_viewed']
            ),
            'quote_viewed->booked': calculateConversionRate(
                stageCounts['quote_viewed'] + stageCounts['awaiting_payment'] + stageCounts['booked'],
                stageCounts['booked']
            ),
            'booked->completed': calculateConversionRate(
                stageCounts['booked'] + stageCounts['in_progress'] + stageCounts['completed'],
                stageCounts['completed']
            ),
        };

        // 9. Calculate qualification counts
        const qualificationCounts: QualificationCounts = {
            hot: 0,
            warm: 0,
            cold: 0,
            unscored: 0,
        };

        for (const lead of allLeads) {
            const grade = lead.qualificationGrade;
            if (grade === 'HOT') {
                qualificationCounts.hot++;
            } else if (grade === 'WARM') {
                qualificationCounts.warm++;
            } else if (grade === 'COLD') {
                qualificationCounts.cold++;
            } else {
                qualificationCounts.unscored++;
            }
        }

        // 10. Calculate today's stats
        const todayWhatsAppMessages = await db.select({ id: messages.id })
            .from(messages)
            .where(gte(messages.createdAt, today));

        const todayWebforms = allLeads.filter(l =>
            (l.source === 'webform' || l.source === 'web_quote') &&
            l.createdAt && new Date(l.createdAt) >= today
        ).length;

        // Query quotes created today
        const quotesCreatedToday = await db.select({
            id: personalizedQuotes.id,
            viewedAt: personalizedQuotes.viewedAt,
            bookedAt: personalizedQuotes.bookedAt,
        })
            .from(personalizedQuotes)
            .where(gte(personalizedQuotes.createdAt, today));

        const todayStats: TodayStats = {
            calls: todayCalls.length,
            whatsapp: todayWhatsAppMessages.length,
            webforms: todayWebforms,
            quotesSent: quotesCreatedToday.length,
            quotesViewed: quotesCreatedToday.filter(q => q.viewedAt !== null).length,
            bookings: quotesCreatedToday.filter(q => q.bookedAt !== null).length,
        };

        // 11. Calculate overall conversion rates
        const totalLeadsCount = allLeads.length;
        const leadsWithQuote = allLeads.filter(lead => {
            return quotesByLeadId.has(lead.id) || quotesByPhone.has(lead.phone);
        }).length;

        const totalQuotes = allQuotes.length;
        const viewedQuotes = allQuotes.filter(q => q.viewedAt !== null).length;
        const paidQuotes = allQuotes.filter(q => q.bookedAt !== null).length;

        const conversionRates: ConversionRates = {
            leadToQuote: totalLeadsCount > 0
                ? Math.round((leadsWithQuote / totalLeadsCount) * 100)
                : 0,
            quoteToViewed: totalQuotes > 0
                ? Math.round((viewedQuotes / totalQuotes) * 100)
                : 0,
            viewedToPaid: viewedQuotes > 0
                ? Math.round((paidQuotes / viewedQuotes) * 100)
                : 0,
            overall: totalLeadsCount > 0
                ? Math.round((paidQuotes / totalLeadsCount) * 100)
                : 0,
        };

        const response: TubeMapResponse = {
            entryPoints,
            stations,
            routes,
            conversions,
            qualificationCounts,
            today: todayStats,
            conversionRates,
        };

        res.json(response);

    } catch (error) {
        console.error('[LeadTubeMap] Error fetching tube map data:', error);
        res.status(500).json({ error: 'Failed to fetch tube map data' });
    }
});

/**
 * POST /api/admin/leads/:id/move
 * Manual stage override
 */
leadTubeMapRouter.post('/api/admin/leads/:id/move', async (req, res) => {
    try {
        const { id } = req.params;
        const schema = z.object({
            stage: z.enum(LeadStageValues as [string, ...string[]]),
            force: z.boolean().optional(),
            reason: z.string().optional(),
        });

        const { stage, force, reason } = schema.parse(req.body);

        // Get current lead state
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        const previousStage = lead.stage;

        // Update stage
        const result = await updateLeadStage(id, stage as LeadStage, {
            force: force ?? true, // Allow manual moves
            reason: reason || 'Manual stage move via Tube Map',
        });

        if (!result.success) {
            return res.status(400).json({
                error: 'Failed to update stage',
                previousStage: result.previousStage,
            });
        }

        // Broadcast the change
        broadcastLeadEvent('lead:stage_change', {
            leadId: id,
            from: previousStage,
            to: stage,
            route: lead.route,
        });

        console.log(`[LeadTubeMap] Lead ${id} moved: ${previousStage} -> ${stage}`);

        res.json({
            success: true,
            previousStage,
            newStage: stage,
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        console.error('[LeadTubeMap] Error moving lead:', error);
        res.status(500).json({ error: 'Failed to move lead' });
    }
});

/**
 * POST /api/admin/leads/:id/route
 * Assign route to lead
 */
leadTubeMapRouter.post('/api/admin/leads/:id/route', async (req, res) => {
    try {
        const { id } = req.params;
        const schema = z.object({
            route: z.enum(LeadRouteValues as [string, ...string[]]),
        });

        const { route } = schema.parse(req.body);

        // Get current lead state
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        const previousRoute = lead.route;

        // Update route
        await db.update(leads)
            .set({
                route: route as LeadRoute,
                routeAssignedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        // Broadcast the change
        broadcastLeadEvent('lead:route_change', {
            leadId: id,
            from: previousRoute,
            to: route,
        });

        console.log(`[LeadTubeMap] Lead ${id} route assigned: ${previousRoute || 'none'} -> ${route}`);

        res.json({
            success: true,
            previousRoute,
            newRoute: route,
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        console.error('[LeadTubeMap] Error assigning route:', error);
        res.status(500).json({ error: 'Failed to assign route' });
    }
});

/**
 * POST /api/admin/leads/:id/segment
 * Change lead segment
 */
leadTubeMapRouter.post('/api/admin/leads/:id/segment', async (req, res) => {
    try {
        const { id } = req.params;
        const validSegments = ['BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'DIY_DEFERRER', 'BUDGET', 'OLDER_WOMAN', 'UNKNOWN'] as const;

        const schema = z.object({
            segment: z.enum(validSegments),
        });

        const { segment } = schema.parse(req.body);

        // Get lead to find associated quote
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Find and update the associated quote
        const [quote] = await db.select()
            .from(personalizedQuotes)
            .where(or(
                eq(personalizedQuotes.leadId, id),
                eq(personalizedQuotes.phone, lead.phone)
            ))
            .orderBy(desc(personalizedQuotes.createdAt))
            .limit(1);

        if (quote) {
            const previousSegment = quote.segment;

            await db.update(personalizedQuotes)
                .set({ segment })
                .where(eq(personalizedQuotes.id, quote.id));

            console.log(`[LeadTubeMap] Lead ${id} segment changed: ${previousSegment} -> ${segment}`);

            res.json({
                success: true,
                previousSegment,
                newSegment: segment,
                quoteId: quote.id,
            });
        } else {
            // No quote found - just acknowledge
            res.json({
                success: true,
                message: 'No quote found for this lead',
                newSegment: segment,
            });
        }

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        console.error('[LeadTubeMap] Error changing segment:', error);
        res.status(500).json({ error: 'Failed to change segment' });
    }
});

/**
 * POST /api/admin/leads/:id/snooze
 * Snooze a lead until specified time
 */
leadTubeMapRouter.post('/api/admin/leads/:id/snooze', async (req, res) => {
    try {
        const { id } = req.params;
        const schema = z.object({
            until: z.string().datetime(),
        });

        const { until } = schema.parse(req.body);
        const snoozedUntil = new Date(until);

        // Validate snooze time is in the future
        if (snoozedUntil <= new Date()) {
            return res.status(400).json({ error: 'Snooze time must be in the future' });
        }

        // Get current lead state
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Update snooze
        await db.update(leads)
            .set({
                snoozedUntil,
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        // Broadcast the change
        broadcastLeadEvent('lead:snoozed', {
            leadId: id,
            until: snoozedUntil.toISOString(),
        });

        console.log(`[LeadTubeMap] Lead ${id} snoozed until ${snoozedUntil.toISOString()}`);

        res.json({
            success: true,
            snoozedUntil: snoozedUntil.toISOString(),
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        console.error('[LeadTubeMap] Error snoozing lead:', error);
        res.status(500).json({ error: 'Failed to snooze lead' });
    }
});

/**
 * POST /api/admin/leads/:id/unsnooze
 * Remove snooze from a lead
 */
leadTubeMapRouter.post('/api/admin/leads/:id/unsnooze', async (req, res) => {
    try {
        const { id } = req.params;

        // Get current lead state
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Remove snooze
        await db.update(leads)
            .set({
                snoozedUntil: null,
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        // Broadcast the change
        broadcastLeadEvent('lead:unsnoozed', {
            leadId: id,
        });

        console.log(`[LeadTubeMap] Lead ${id} unsnoozed`);

        res.json({
            success: true,
        });

    } catch (error) {
        console.error('[LeadTubeMap] Error unsnoozing lead:', error);
        res.status(500).json({ error: 'Failed to unsnooze lead' });
    }
});

/**
 * POST /api/admin/leads/:id/merge
 * Merge duplicate lead into another
 */
leadTubeMapRouter.post('/api/admin/leads/:id/merge', async (req, res) => {
    try {
        const { id } = req.params;
        const schema = z.object({
            mergeIntoId: z.string().min(1),
        });

        const { mergeIntoId } = schema.parse(req.body);

        if (id === mergeIntoId) {
            return res.status(400).json({ error: 'Cannot merge lead into itself' });
        }

        // Get both leads
        const [sourceLead] = await db.select().from(leads).where(eq(leads.id, id));
        const [targetLead] = await db.select().from(leads).where(eq(leads.id, mergeIntoId));

        if (!sourceLead) {
            return res.status(404).json({ error: 'Source lead not found' });
        }
        if (!targetLead) {
            return res.status(404).json({ error: 'Target lead not found' });
        }

        // Check if source is already merged
        if (sourceLead.mergedIntoId) {
            return res.status(400).json({ error: 'Source lead is already merged' });
        }

        // Mark source as merged
        await db.update(leads)
            .set({
                mergedIntoId: mergeIntoId,
                stage: 'declined' as LeadStage, // Mark as terminal
                updatedAt: new Date(),
            })
            .where(eq(leads.id, id));

        // Update any quotes to point to the target lead
        await db.update(personalizedQuotes)
            .set({ leadId: mergeIntoId })
            .where(eq(personalizedQuotes.leadId, id));

        // Broadcast the change
        broadcastLeadEvent('lead:merged', {
            sourceLeadId: id,
            targetLeadId: mergeIntoId,
        });

        console.log(`[LeadTubeMap] Lead ${id} merged into ${mergeIntoId}`);

        res.json({
            success: true,
            sourceLeadId: id,
            targetLeadId: mergeIntoId,
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Invalid input', details: error.errors });
        }
        console.error('[LeadTubeMap] Error merging leads:', error);
        res.status(500).json({ error: 'Failed to merge leads' });
    }
});

/**
 * GET /api/admin/leads/:id/duplicates
 * Find potential duplicate leads by phone number
 */
leadTubeMapRouter.get('/api/admin/leads/:id/duplicates', async (req, res) => {
    try {
        const { id } = req.params;

        // Get the lead
        const [lead] = await db.select().from(leads).where(eq(leads.id, id));
        if (!lead) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Find other leads with the same phone number
        const duplicates = await db.select()
            .from(leads)
            .where(and(
                eq(leads.phone, lead.phone),
                ne(leads.id, id),
                isNull(leads.mergedIntoId)
            ))
            .orderBy(desc(leads.createdAt));

        res.json({
            lead: {
                id: lead.id,
                customerName: lead.customerName,
                phone: lead.phone,
            },
            duplicates: duplicates.map(d => ({
                id: d.id,
                customerName: d.customerName,
                phone: d.phone,
                stage: d.stage,
                createdAt: d.createdAt,
                jobDescription: d.jobDescription,
            })),
            count: duplicates.length,
        });

    } catch (error) {
        console.error('[LeadTubeMap] Error finding duplicates:', error);
        res.status(500).json({ error: 'Failed to find duplicates' });
    }
});

/**
 * GET /api/admin/leads/snoozed
 * Get all snoozed leads
 */
leadTubeMapRouter.get('/api/admin/leads/snoozed', async (req, res) => {
    try {
        const snoozedLeads = await db.select()
            .from(leads)
            .where(and(
                isNotNull(leads.snoozedUntil),
                isNull(leads.mergedIntoId)
            ))
            .orderBy(leads.snoozedUntil);

        res.json({
            leads: snoozedLeads.map(lead => ({
                id: lead.id,
                customerName: lead.customerName,
                phone: lead.phone,
                stage: lead.stage,
                route: lead.route,
                snoozedUntil: lead.snoozedUntil,
                jobDescription: lead.jobDescription,
            })),
            count: snoozedLeads.length,
        });

    } catch (error) {
        console.error('[LeadTubeMap] Error fetching snoozed leads:', error);
        res.status(500).json({ error: 'Failed to fetch snoozed leads' });
    }
});

/**
 * POST /api/admin/leads/wake-snoozed
 * Wake up leads that have passed their snooze time
 * (This should be called by a cron job)
 */
leadTubeMapRouter.post('/api/admin/leads/wake-snoozed', async (req, res) => {
    try {
        const now = new Date();

        // Find snoozed leads that should be woken
        const leadsToWake = await db.select()
            .from(leads)
            .where(and(
                isNotNull(leads.snoozedUntil),
                lte(leads.snoozedUntil, now),
                isNull(leads.mergedIntoId)
            ));

        // Wake them up
        let wokenCount = 0;
        for (const lead of leadsToWake) {
            await db.update(leads)
                .set({
                    snoozedUntil: null,
                    updatedAt: new Date(),
                })
                .where(eq(leads.id, lead.id));

            // Broadcast the wake-up
            broadcastLeadEvent('lead:unsnoozed', {
                leadId: lead.id,
                automatic: true,
            });

            wokenCount++;
        }

        console.log(`[LeadTubeMap] Woke ${wokenCount} snoozed leads`);

        res.json({
            success: true,
            wokenCount,
        });

    } catch (error) {
        console.error('[LeadTubeMap] Error waking snoozed leads:', error);
        res.status(500).json({ error: 'Failed to wake snoozed leads' });
    }
});

// ==========================================
// MINI-TIMELINE: RECENT LEAD MOVEMENTS
// ==========================================

/**
 * GET /api/admin/lead-movements/recent
 * Returns the last 5-10 lead stage changes for the mini-timeline feature
 *
 * Query params:
 * - limit: number (default 10, max 20)
 *
 * Response:
 * - movements: array of recent lead stage changes
 */
leadTubeMapRouter.get('/api/admin/lead-movements/recent', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 20);
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Fetch leads with recent stage updates
        const recentLeads = await db.select({
            id: leads.id,
            customerName: leads.customerName,
            stage: leads.stage,
            route: leads.route,
            stageUpdatedAt: leads.stageUpdatedAt,
        })
            .from(leads)
            .where(and(
                isNotNull(leads.stageUpdatedAt),
                gte(leads.stageUpdatedAt, twentyFourHoursAgo),
                isNull(leads.mergedIntoId)
            ))
            .orderBy(desc(leads.stageUpdatedAt))
            .limit(limit);

        // Build movement data
        // Note: Since we don't store previousStage in the DB, we infer it based on
        // the standard funnel progression. For accurate tracking, consider adding
        // a lead_stage_history table in the future.
        const stageProgression: LeadStage[] = [
            'new_lead',
            'contacted',
            'awaiting_video',
            'video_received',
            'visit_scheduled',
            'visit_done',
            'quote_sent',
            'quote_viewed',
            'awaiting_payment',
            'booked',
            'in_progress',
            'completed',
        ];

        const movements = recentLeads.map(lead => {
            const currentStage = lead.stage as LeadStage;
            const currentIndex = stageProgression.indexOf(currentStage);

            // Infer previous stage (one step back in progression)
            // For terminal stages (lost, expired, declined), previous could be any active stage
            let previousStage: LeadStage | null = null;
            if (['lost', 'expired', 'declined'].includes(currentStage)) {
                previousStage = 'quote_viewed'; // Common case for terminal states
            } else if (currentIndex > 0) {
                previousStage = stageProgression[currentIndex - 1];
            }

            // Extract first name for privacy
            const firstName = lead.customerName?.split(' ')[0] || 'Unknown';

            // Map route to the expected format
            let routeType: 'video' | 'instant' | 'site_visit' = 'instant';
            if (lead.route === 'video') {
                routeType = 'video';
            } else if (lead.route === 'site_visit') {
                routeType = 'site_visit';
            } else if (lead.route === 'instant_quote') {
                routeType = 'instant';
            }

            return {
                leadId: lead.id,
                customerName: firstName,
                previousStage,
                newStage: currentStage,
                timestamp: lead.stageUpdatedAt?.toISOString() || new Date().toISOString(),
                route: routeType,
            };
        });

        res.json({
            movements,
            count: movements.length,
            since: twentyFourHoursAgo.toISOString(),
        });

    } catch (error) {
        console.error('[LeadTubeMap] Error fetching recent movements:', error);
        res.status(500).json({ error: 'Failed to fetch recent lead movements' });
    }
});
