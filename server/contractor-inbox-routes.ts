/**
 * The follow-up inbox: a unified feed of calls, leads and hot quotes that need a follow-up, read by
 * the admin sidebar badge and /admin/follow-ups. The path says "contractor" for history only: the
 * feed is business-wide customer data, so every route needs an admin session (requireAdmin, which
 * admits VAs). No contractor page has an inbox route.
 */
import { Router } from 'express';
import { desc, eq, and, or, isNull, lt, gte } from 'drizzle-orm';
import { db } from './db';
import { calls, leads, personalizedQuotes } from '../shared/schema';
import { updateCall } from './call-logger';
import { requireAdmin } from './auth';

export const contractorInboxRouter = Router();
const router = contractorInboxRouter;

router.get('/api/contractor/inbox', requireAdmin, async (req, res) => {
    try {
        // 1. Fetch all calls needing follow-up (missed, routed to AI, etc.)
        const pendingCalls = await db.select()
            .from(calls)
            .where(
                or(
                    eq(calls.actionStatus, 'pending'),
                    eq(calls.actionStatus, 'attempting')
                )
            )
            .orderBy(desc(calls.startTime));

        // 2. Fetch action-pending leads — only ElevenLabs AI agent and webform entries (no duplicates from backfills/system sources)
        const pendingLeads = await db.select()
            .from(leads)
            .where(
                and(
                    eq(leads.actionStatus, 'pending'),
                    or(
                        eq(leads.source, 'eleven_labs_agent'),
                        eq(leads.source, 'eleven_labs_tool'),
                        eq(leads.source, 'desktop_hero_flow'),
                        eq(leads.source, 'web_quote')
                    )
                )
            )
            .orderBy(desc(leads.createdAt));

        // 3. Fetch most recent quotes with 3+ views needing follow-up (last 20 to work through)
        //    Exclude booked quotes — no need to follow up on someone who already converted
        const hotQuotes = await db.select()
            .from(personalizedQuotes)
            .where(
                and(
                    gte(personalizedQuotes.viewCount, 3),
                    isNull(personalizedQuotes.bookedAt),
                    isNull(personalizedQuotes.viewNudgeSentAt)
                )
            )
            .orderBy(desc(personalizedQuotes.lastViewedAt))
            .limit(20);

        // 4. Normalize into unified shape
        const items = [
            ...pendingCalls.map(call => ({
                id: call.id,
                itemType: 'call' as const,
                customerName: call.customerName || 'Unknown Caller',
                phone: call.phoneNumber,
                summary: call.jobSummary || call.transcription?.substring(0, 500) || null,
                source: call.missedReason === 'out_of_hours' ? 'Out-of-Hours Call'
                    : call.missedReason === 'busy_agent' ? 'Missed Call (Busy)'
                    : call.missedReason === 'no_answer' ? 'Missed Call'
                    : call.missedReason === 'user_hangup' ? 'Missed Call (Hung Up)'
                    : call.outcome === 'MISSED_CALL' ? 'Missed Call'
                    : 'AI Agent Call',
                sourceType: call.missedReason || 'call',
                urgency: call.actionUrgency || 3,
                actionStatus: call.actionStatus,
                address: call.address,
                recordingUrl: call.recordingUrl,
                transcription: call.transcription,
                timestamp: call.startTime?.toISOString(),
                tags: call.tags,
                outcome: call.outcome,
            })),
            ...pendingLeads.map(lead => ({
                id: lead.id,
                itemType: 'lead' as const,
                customerName: lead.customerName || 'Unknown',
                phone: lead.phone,
                summary: lead.jobDescription || lead.jobSummary || null,
                source: (lead.source === 'eleven_labs_agent' || lead.source === 'eleven_labs_tool')
                    ? 'AI Agent Lead'
                    : 'Web Form',
                sourceType: lead.source || 'webform',
                urgency: lead.actionUrgency || 3,
                actionStatus: lead.actionStatus,
                address: lead.address,
                recordingUrl: null,
                transcription: null,
                timestamp: lead.createdAt?.toISOString(),
                tags: null,
                outcome: null,
            })),
            ...hotQuotes.map(quote => ({
                id: `quote-${quote.id}`,
                itemType: 'quote_views' as const,
                customerName: quote.customerName || 'Unknown',
                phone: quote.phone || '',
                summary: `Viewed quote ${quote.viewCount} times without booking`,
                source: `${quote.viewCount} Quote Views`,
                sourceType: 'quote_views',
                urgency: quote.viewCount! >= 5 ? 1 : 2,
                actionStatus: 'pending',
                address: null,
                recordingUrl: null,
                transcription: null,
                timestamp: quote.lastViewedAt?.toISOString() || quote.viewedAt?.toISOString() || null,
                tags: null,
                outcome: null,
            })),
        ];

        // Sort unified list: newest first
        items.sort((a, b) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return bTime - aTime;
        });

        // Return all pending items (no cap — count must reflect reality)
        res.json(items);
    } catch (error) {
        console.error('Failed to fetch contractor inbox:', error);
        res.status(500).json({ error: 'Failed to fetch inbox items' });
    }
});

// Contractor Inbox: Mark item as resolved/dismissed
router.patch('/api/contractor/inbox/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { actionStatus } = req.body; // 'resolved' | 'dismissed'

    if (!actionStatus || !['resolved', 'dismissed'].includes(actionStatus)) {
        return res.status(400).json({ error: 'actionStatus must be "resolved" or "dismissed"' });
    }

    try {
        // Quote view items use "quote-{id}" prefix, lead IDs start with "lead_", call IDs are hex strings
        if (id.startsWith('quote-')) {
            const quoteId = id.replace('quote-', '');
            await db.update(personalizedQuotes)
                .set({ viewNudgeSentAt: new Date() })
                .where(eq(personalizedQuotes.id, quoteId));
        } else if (id.startsWith('lead_')) {
            await db.update(leads)
                .set({ actionStatus, updatedAt: new Date() })
                .where(eq(leads.id, id));
        } else {
            await updateCall(id, { actionStatus });
        }

        // Broadcast resolution so other clients can update
        const { broadcastToClients } = await import('./index');
        broadcastToClients({
            type: 'inbox:item_resolved',
            data: { id, actionStatus }
        });

        res.json({ success: true });
    } catch (error) {
        console.error(`Failed to update inbox item ${id}:`, error);
        res.status(500).json({ error: 'Failed to update' });
    }
});

// Bulk resolve old inbox items
router.post('/api/contractor/inbox/bulk-resolve', requireAdmin, async (req, res) => {
    const { before } = req.body; // ISO date string
    const cutoff = before ? new Date(before) : new Date();

    try {
        await db.update(calls)
            .set({ actionStatus: 'resolved' })
            .where(and(
                or(eq(calls.actionStatus, 'pending'), eq(calls.actionStatus, 'attempting')),
                lt(calls.startTime, cutoff)
            ));
        await db.update(leads)
            .set({ actionStatus: 'resolved', updatedAt: new Date() })
            .where(and(
                eq(leads.actionStatus, 'pending'),
                lt(leads.createdAt, cutoff)
            ));

        const { broadcastToClients } = await import('./index');
        broadcastToClients({ type: 'inbox:item_resolved', data: { bulk: true } });
        res.json({ success: true });
    } catch (error) {
        console.error('Bulk resolve failed:', error);
        res.status(500).json({ error: 'Failed to bulk resolve' });
    }
});
