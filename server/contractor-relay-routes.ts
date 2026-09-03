/**
 * P15 part 2 — the routes behind "Message the customer" on the contractor's job.
 *
 *   POST /api/contractor-app/:token/jobs/:bookingId/message   his words → her thread
 *   GET  /api/contractor-app/:token/jobs/:bookingId/messages  the exchange, for the drawer
 *
 * Mounted on the same base path as the contractor app and BEFORE it, so these two paths are served
 * here and everything else falls through to server/contractor-app-routes.ts untouched (one mount
 * line each, no edit to the other pane's file).
 *
 * Same trust model as the rest of the app: the token IS the credential, and the job must be his and
 * accepted. Nothing in either response carries the customer's number, address or surname.
 */
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { contractorBookingRequests, handymanProfiles, users } from '@shared/schema';
import {
    RELAY_PRESETS, RELAY_DAILY_LIMIT, presetBody, relayToCustomer, liveRelayDeps, conversationForBooking,
    countRelaysToday, relayThreadForBooking, type RelayPresetId,
} from './contractor-relay';

const router = Router();

/** The contractor behind the token, with the display name the customer will see. */
async function contractorFor(token: string): Promise<{ id: string; name: string | null } | null> {
    if (!token || token.length < 16) return null;
    const [row] = await db.select({ id: handymanProfiles.id, firstName: users.firstName, lastName: users.lastName })
        .from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id))
        .where(eq(handymanProfiles.appToken, token)).limit(1);
    return row ? { id: row.id, name: [row.firstName, row.lastName].filter(Boolean).join(' ') || null } : null;
}

type JobGate = { error: { status: number; msg: string }; booking?: undefined } | { error?: undefined; booking: { id: string } };

/** His job, and only if it is his and he has accepted it: an unaccepted job has no customer to talk to. */
async function acceptedJobFor(profileId: string, bookingId: string): Promise<JobGate> {
    const [b] = await db.select({
        id: contractorBookingRequests.id,
        contractorId: contractorBookingRequests.contractorId,
        assignedContractorId: contractorBookingRequests.assignedContractorId,
        status: contractorBookingRequests.status,
        assignmentStatus: contractorBookingRequests.assignmentStatus,
        acceptedAt: contractorBookingRequests.acceptedAt,
    }).from(contractorBookingRequests).where(eq(contractorBookingRequests.id, bookingId)).limit(1);
    if (!b) return { error: { status: 404, msg: 'Job not found' } as const };
    if ((b.assignedContractorId ?? b.contractorId) !== profileId) return { error: { status: 403, msg: 'Not your job' } as const };
    const accepted = !!b.acceptedAt || b.status === 'accepted' || ['accepted', 'in_progress', 'completed'].includes(String(b.assignmentStatus ?? ''));
    if (!accepted) return { error: { status: 409, msg: 'Accept the job first, then you can message the customer' } as const };
    if (b.status === 'completed' || b.assignmentStatus === 'completed') return { error: { status: 409, msg: "That job is closed. Anything else goes through the office." } as const };
    return { booking: b };
}

// POST /:token/jobs/:bookingId/message — one message from him to her, through the business number.
router.post('/:token/jobs/:bookingId/message', async (req: Request, res: Response) => {
    try {
        const contractor = await contractorFor(req.params.token);
        if (!contractor) return res.status(404).json({ error: 'Link not recognised' });
        const job = await acceptedJobFor(contractor.id, req.params.bookingId);
        if (job.error) return res.status(job.error.status).json({ error: job.error.msg });

        const presetId = typeof req.body?.preset === 'string' ? (req.body.preset as RelayPresetId) : null;
        const minutes = typeof req.body?.minutes === 'number' ? req.body.minutes : undefined;
        const text = presetId ? presetBody(presetId, minutes) : String(req.body?.text ?? '');
        if (!text) return res.status(400).json({ error: presetId ? 'That is not one of the quick messages.' : 'Type a message first.' });

        const { conversationId, phone, customerName } = await conversationForBooking(req.params.bookingId);
        if (!phone) return res.status(409).json({ error: 'No number on this job. Ring the office.' });

        const outcome = await relayToCustomer(
            { bookingId: req.params.bookingId, contractorId: contractor.id, contractorName: contractor.name, customerPhone: phone, customerName, conversationId },
            text,
            await liveRelayDeps(),
        );
        if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.reason });
        if (!outcome.sent) return res.json({ ok: true, sent: false, held: true, body: outcome.body, message: outcome.reason });
        return res.json({ ok: true, sent: true, body: outcome.body, remaining: outcome.remaining });
    } catch (err: any) {
        console.error('[ContractorRelay] message failed:', err?.message);
        res.status(500).json({ error: 'Could not send that. Try again, or ring the office.' });
    }
});

// GET /:token/jobs/:bookingId/messages — the exchange for the drawer, plus what he has left today.
router.get('/:token/jobs/:bookingId/messages', async (req: Request, res: Response) => {
    try {
        const contractor = await contractorFor(req.params.token);
        if (!contractor) return res.status(404).json({ error: 'Link not recognised' });
        const job = await acceptedJobFor(contractor.id, req.params.bookingId);
        if (job.error) return res.status(job.error.status).json({ error: job.error.msg, messages: [], presets: RELAY_PRESETS.map((p) => ({ id: p.id, label: p.label })) });

        const [messages, usedToday] = await Promise.all([
            relayThreadForBooking(req.params.bookingId).catch(() => []),
            countRelaysToday(req.params.bookingId).catch(() => 0),
        ]);
        res.json({
            messages,
            presets: RELAY_PRESETS.map((p) => ({ id: p.id, label: p.label })),
            remaining: Math.max(0, RELAY_DAILY_LIMIT - usedToday),
            dailyLimit: RELAY_DAILY_LIMIT,
        });
    } catch (err: any) {
        console.error('[ContractorRelay] thread read failed:', err?.message);
        res.status(500).json({ error: 'Could not load the messages' });
    }
});

export default router;
