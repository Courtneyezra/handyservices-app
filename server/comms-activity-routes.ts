/**
 * /activity — expose the comms ledger to the frontend.
 *
 * The ledger (comms_events table) is the single source of truth for all comms activity:
 * messages in/out, calls, drafts created/sent/rejected. This route surfaces that data
 * for activity feeds, timelines, and change detection.
 */
import { Router } from "express";
import { db } from "./db";
import { commsEvents } from "@shared/schema";
import { desc, eq, and, gte, or, like, sql, inArray } from "drizzle-orm";
import { successResponse, sendSuccess, sendError, sendBadRequest } from "./lib/api-response";

export const commsActivityRouter = Router();

/** Digits-only normalisation for phone matching. */
function digitsOf(phone: string | null | undefined): string {
    return (phone ?? '').replace('@c.us', '').replace(/\D/g, '');
}

/**
 * GET /activity
 *
 * Returns recent activity across all conversations.
 * Query params:
 *   - limit (default 50, max 500)
 *   - offset (default 0)
 *   - eventType (comma-separated: message_in,message_out,call_in,etc.)
 *   - channel (comma-separated: whatsapp,sms,call,etc.)
 *   - since (ISO timestamp — only events after this time)
 *   - roleProfile (customer|contractor|internal)
 */
commsActivityRouter.get('/activity', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const eventTypes = (req.query.eventType as string)?.split(',').filter(Boolean);
        const channels = (req.query.channel as string)?.split(',').filter(Boolean);
        const since = req.query.since as string;
        const roleProfile = req.query.roleProfile as string;

        const conditions = [];

        if (eventTypes?.length) {
            conditions.push(inArray(commsEvents.eventType, eventTypes));
        }
        if (channels?.length) {
            conditions.push(inArray(commsEvents.channel, channels));
        }
        if (since) {
            const sinceDate = new Date(since);
            if (!isNaN(sinceDate.getTime())) {
                conditions.push(gte(commsEvents.occurredAt, sinceDate));
            }
        }
        if (roleProfile) {
            conditions.push(eq(commsEvents.roleProfile, roleProfile));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [events, countResult] = await Promise.all([
            db.select()
                .from(commsEvents)
                .where(whereClause)
                .orderBy(desc(commsEvents.occurredAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: sql<number>`count(*)::int` })
                .from(commsEvents)
                .where(whereClause),
        ]);

        sendSuccess(res, {
            events,
            pagination: {
                limit,
                offset,
                total: countResult[0]?.count ?? 0,
                hasMore: offset + events.length < (countResult[0]?.count ?? 0),
            },
        });
    } catch (err) {
        console.error('[comms-activity] Failed to fetch activity:', err);
        sendError(res, 'Failed to fetch activity', 500);
    }
});

/**
 * GET /activity/:phoneOrConversationId
 *
 * Returns activity for a specific thread (by phone number or conversation ID).
 * Query params same as above.
 */
commsActivityRouter.get('/activity/:phoneOrConversationId', async (req, res) => {
    try {
        const { phoneOrConversationId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const eventTypes = (req.query.eventType as string)?.split(',').filter(Boolean);
        const since = req.query.since as string;

        // Determine if this is a phone number (digits) or conversation ID
        const digits = digitsOf(phoneOrConversationId);
        const isPhone = digits.length >= 10;

        const conditions = [];

        if (isPhone) {
            // Match by phone (with or without + prefix)
            conditions.push(
                or(
                    eq(commsEvents.phone, `+${digits}`),
                    like(commsEvents.phone, `%${digits}`)
                )
            );
        } else {
            // Match by conversation ID
            conditions.push(eq(commsEvents.conversationId, phoneOrConversationId));
        }

        if (eventTypes?.length) {
            conditions.push(inArray(commsEvents.eventType, eventTypes));
        }
        if (since) {
            const sinceDate = new Date(since);
            if (!isNaN(sinceDate.getTime())) {
                conditions.push(gte(commsEvents.occurredAt, sinceDate));
            }
        }

        const whereClause = and(...conditions);

        const events = await db.select()
            .from(commsEvents)
            .where(whereClause)
            .orderBy(desc(commsEvents.occurredAt))
            .limit(limit)
            .offset(offset);

        sendSuccess(res, {
            events,
            phone: isPhone ? `+${digits}` : null,
            conversationId: isPhone ? null : phoneOrConversationId,
        });
    } catch (err) {
        console.error('[comms-activity] Failed to fetch thread activity:', err);
        sendError(res, 'Failed to fetch thread activity', 500);
    }
});

/**
 * GET /activity-since/:timestamp
 *
 * Lightweight poll endpoint: returns count of new events since timestamp.
 * Used for change detection without fetching full payloads.
 */
commsActivityRouter.get('/activity-since/:timestamp', async (req, res) => {
    try {
        const since = new Date(req.params.timestamp);
        if (isNaN(since.getTime())) {
            return sendBadRequest(res, 'Invalid timestamp');
        }

        const result = await db.select({
            eventType: commsEvents.eventType,
            count: sql<number>`count(*)::int`,
        })
            .from(commsEvents)
            .where(gte(commsEvents.occurredAt, since))
            .groupBy(commsEvents.eventType);

        const total = result.reduce((sum, r) => sum + r.count, 0);

        sendSuccess(res, {
            since: since.toISOString(),
            total,
            byType: Object.fromEntries(result.map(r => [r.eventType, r.count])),
        });
    } catch (err) {
        console.error('[comms-activity] Failed to check activity-since:', err);
        sendError(res, 'Failed to check activity', 500);
    }
});
