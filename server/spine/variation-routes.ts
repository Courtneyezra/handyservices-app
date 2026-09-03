/**
 * P15 part 3 routes. Its own router, mounted once from server/index.ts, so the three P15 panes never
 * touch the same file. Auth is applied per route inside (the contractor path is token-authed like
 * every other contractor-app route; the two admin paths take requireAdmin), which is why the mount
 * carries no middleware.
 *
 *   POST /api/contractor-app/:token/jobs/:bookingId/variation
 *        The contractor's "Customer wants something extra": title, notes, photos. Creates the
 *        dispatch_variations row, runs Route A for the one line, lands the Pushover for Ben.
 *        Never prices anything the customer can see and never messages the customer.
 *
 *   GET  /api/admin/variations/:id                  Ben's one-line price screen payload
 *   POST /api/admin/variations/:id/send  { finalPence }
 *        Ben's tap, in this order, so a failure never leaves a half-done extra:
 *          1. the quote gains the line          (customer-visible price, the accept path)
 *          2. the pack gains the line LOCKED    (the contractor's sheet)
 *          3. the contractor's pay moves        (the existing pay engine, snapshotted)
 *          4. the row is marked approved        (the record)
 *          5. the customer is messaged          (the ONE send, with the quote link)
 *          6. the contractor is told            (best effort; a failure never unsends)
 */
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { requireAdmin } from '../auth';
import { bookingAssignments, contractorBookingRequests, handymanProfiles, jobDispatches, personalizedQuotes, users } from '@shared/schema';
import { humanApprover, newRunId, type Approver } from '../approver';
import {
    appendVariationLine, clerkLineForExtra, contractorNoticeBody, extraMessage, getVariation, insertVariation,
    packLineForVariation, payDeltaFor, readBrief, updateVariation, validateExtra, validateSend, variationLineId,
    variationScreen, writeBrief, type ExtraRequest, type VariationRow,
} from './variation';
import { priceExtraLine } from './variation-route-a';

export const variationRouter = Router();

function sessionUser(req: any): { id?: string | null; email?: string | null } {
    const u = req?.user ?? {};
    return { id: u.id ?? null, email: u.email ?? null };
}

async function findByAppToken(token: string) {
    if (!token || token.length < 16) return null;
    const [row] = await db
        .select({ id: handymanProfiles.id, userId: handymanProfiles.userId, deliveryTier: handymanProfiles.deliveryTier })
        .from(handymanProfiles).where(eq(handymanProfiles.appToken, token)).limit(1);
    return row ?? null;
}

/**
 * The quote behind a job. personalized_quotes carries no conversation id, so the thread is resolved
 * the way the quote price screen resolves it (resolveConversationForQuote: the draft slug on a
 * conversation's metadata, else the number) rather than by a second rule invented here.
 */
async function loadQuote(quoteId: string) {
    const [q] = await db.select({
        id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone, jobDescription: personalizedQuotes.jobDescription,
        pricingLineItems: personalizedQuotes.pricingLineItems,
    }).from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
    if (!q) return null;
    let conversationId: string | null = null;
    try {
        const { resolveConversationForQuote } = await import('./price-screen');
        conversationId = await resolveConversationForQuote({ short_slug: q.slug, phone: q.phone } as any, null);
    } catch (e: any) {
        console.warn('[Variation] could not resolve the thread for the quote:', e?.message ?? e);
    }
    return { ...q, conversationId };
}

/** The job behind a booking, with the quote and the dispatch the variation hangs off. */
async function jobContext(bookingId: string) {
    const [booking] = await db
        .select({
            id: contractorBookingRequests.id, quoteId: contractorBookingRequests.quoteId,
            contractorId: contractorBookingRequests.contractorId, assignedContractorId: contractorBookingRequests.assignedContractorId,
            status: contractorBookingRequests.status, assignmentStatus: contractorBookingRequests.assignmentStatus,
            acceptedAt: contractorBookingRequests.acceptedAt,
        })
        .from(contractorBookingRequests).where(eq(contractorBookingRequests.id, bookingId)).limit(1);
    if (!booking) return null;
    const quote = booking.quoteId ? await loadQuote(booking.quoteId) : null;
    const dispatch = booking.quoteId
        ? (await db.select({ id: jobDispatches.id, title: jobDispatches.title })
            .from(jobDispatches).where(eq(jobDispatches.quoteId, booking.quoteId)).limit(1))[0] ?? null
        : null;
    return { booking, quote, dispatch };
}

// ---------------------------------------------------------------- the contractor reports an extra

variationRouter.post('/api/contractor-app/:token/jobs/:bookingId/variation', async (req: Request, res: Response) => {
    try {
        const profile = await findByAppToken(req.params.token);
        if (!profile) return res.status(404).json({ error: 'Link not recognised' });

        const ctx = await jobContext(req.params.bookingId);
        if (!ctx) return res.status(404).json({ error: 'Job not found' });
        if ((ctx.booking.assignedContractorId ?? ctx.booking.contractorId) !== profile.id) {
            return res.status(403).json({ error: 'Not your job' });
        }
        // An extra belongs to work that is actually his to do. An unaccepted job has no door to
        // stand at, so there is nothing to have found.
        const accepted = !!ctx.booking.acceptedAt || ctx.booking.status === 'accepted'
            || ['accepted', 'in_progress', 'completed'].includes(String(ctx.booking.assignmentStatus ?? ''));
        if (!accepted) return res.status(409).json({ error: 'Accept the job first, then report an extra.' });

        const v = validateExtra(req.body);
        if (!v.ok) return res.status(400).json({ errors: v.errors });
        const extra: ExtraRequest = v.extra;

        // dispatch_variations.dispatch_id is NOT NULL with an FK. A booking with no dispatch row
        // (booked straight off the quote, the common path) has nowhere to hang the variation, so it
        // is refused in words rather than 500ing on the constraint.
        if (!ctx.dispatch) return res.status(422).json({ error: 'This job has no dispatch record, so an extra cannot be raised from here. Ring the office.' });

        const row = await insertVariation({
            dispatchId: ctx.dispatch.id, contractorId: profile.id, extra,
            adminNotes: writeBrief(null, { quoteId: ctx.quote?.id ?? null, bookingId: ctx.booking.id, lineId: 'pending' }),
        });

        // Route A for the one line. A pricing failure must not lose the contractor's report: the row
        // already exists, so the estimate is best-effort and Ben still gets the alert.
        const lineId = variationLineId(row.id);
        let priced: Awaited<ReturnType<typeof priceExtraLine>> | null = null;
        try {
            priced = await priceExtraLine({
                variationId: row.id, lineId, extra,
                conversationId: ctx.quote?.conversationId ?? null,
                phone: ctx.quote?.phone ?? null,
                customerName: ctx.quote?.customerName ?? null,
            });
        } catch (e: any) {
            console.error('[Variation] Route A failed (the report stands):', e?.message ?? e);
        }

        await updateVariation(row.id, {
            adminNotes: writeBrief(row.adminNotes, {
                quoteId: ctx.quote?.id ?? null, bookingId: ctx.booking.id, lineId,
                estimateId: priced?.estimateId ?? null,
                estimatorFailed: priced?.estimatorFailed ?? (priced ? null : 'pricing did not run'),
                suggestion: priced?.suggestion ?? null,
            }),
            additionalTimeMins: priced?.minutes ?? 0,
        }).catch((e: any) => console.warn('[Variation] brief write failed (the report stands):', e?.message ?? e));

        // Ben.
        try {
            const { notifyVariationToPrice } = await import('../pushover');
            await notifyVariationToPrice({
                variationId: row.id,
                contractorName: await contractorName(profile.id),
                customerName: ctx.quote?.customerName ?? null,
                jobTitle: ctx.dispatch.title ?? ctx.quote?.jobDescription ?? null,
                title: extra.title,
                notes: extra.notes,
                photos: extra.photoUrls.length,
                suggestedPence: priced?.suggestion?.suggestedPence ?? null,
                bandLowPence: priced?.suggestion?.bandLowPence ?? null,
                bandHighPence: priced?.suggestion?.bandHighPence ?? null,
                checkThis: !!priced?.suggestion?.checkThis,
                estimatorFailed: priced?.estimatorFailed ?? null,
            });
        } catch (e: any) {
            console.warn('[Variation] Pushover failed (the report stands):', e?.message ?? e);
        }

        try {
            const { logSystemEvent } = await import('../system-events');
            await logSystemEvent({
                kind: 'other', source: 'variation', conversationId: ctx.quote?.conversationId ?? null, phone: ctx.quote?.phone ?? null,
                summary: `Extra reported on ${ctx.booking.id}: ${extra.title}${priced?.suggestion ? ` (suggested £${(priced.suggestion.suggestedPence / 100).toFixed(0)})` : ' (not priced)'}`,
                detail: { variationId: row.id, bookingId: ctx.booking.id, quoteId: ctx.quote?.id ?? null, contractorId: profile.id, lineId, estimatorFailed: priced?.estimatorFailed ?? null },
            } as any);
        } catch { /* the log never blocks the report */ }

        res.json({
            ok: true, id: row.id,
            // Deliberately no price: he reports it, the office prices it, and he must not be able to
            // quote the number to her at the door.
            message: 'Sent to the office. They will price it and message the customer. Do not start it until she says yes.',
        });
    } catch (err: any) {
        console.error('[Variation] report failed:', err?.message, err?.stack);
        res.status(500).json({ error: 'Could not send that to the office' });
    }
});

async function contractorName(contractorId: string): Promise<string | null> {
    const [row] = await db
        .select({ business: handymanProfiles.businessName, first: users.firstName, last: users.lastName })
        .from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id))
        .where(eq(handymanProfiles.id, contractorId)).limit(1);
    if (!row) return null;
    const person = [row.first, row.last].filter(Boolean).join(' ').trim();
    return person || row.business || null;
}

// ---------------------------------------------------------------- Ben's one-line price screen

async function screenFor(id: string) {
    const row = await getVariation(id);
    if (!row) return null;
    const brief = readBrief(row.adminNotes);
    const quote = brief.quoteId ? await loadQuote(brief.quoteId) : null;
    const base = process.env.BASE_URL || 'https://www.handyservices.app';
    return {
        row, brief, quote,
        screen: variationScreen(row, {
            contractorName: await contractorName(row.contractorId),
            customerFirstName: quote?.customerName ?? null,
            customerPhone: quote?.phone ?? null,
            jobTitle: quote?.jobDescription ?? null,
            quoteUrl: quote?.slug ? `${base}/quote/${quote.slug}` : null,
        }),
    };
}

variationRouter.get('/api/admin/variations/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
        const found = await screenFor(String(req.params.id || '').trim());
        if (!found) return res.status(404).json({ available: false, error: 'No such extra.' });
        res.json(found.screen);
    } catch (error: any) {
        console.error('[Variation] screen read failed:', error?.message ?? error);
        res.status(500).json({ available: false, error: 'Could not load the extra' });
    }
});

variationRouter.post('/api/admin/variations/:id/send', requireAdmin, async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '').trim();
        const found = await screenFor(id);
        if (!found) return res.status(404).json({ ok: false, errors: ['No such extra.'] });
        const { row, brief, quote, screen } = found;

        const v = validateSend(req.body, screen);
        if (!v.ok) return res.status(v.status).json({ ok: false, errors: v.errors });
        const finalPence = v.finalPence;
        if (!quote) return res.status(422).json({ ok: false, errors: ['This extra has no quote, so there is nothing for the customer to accept. Ring her.'] });

        const u = sessionUser(req);
        const approver: Approver = humanApprover(u.email ?? u.id ?? 'admin');
        const runId = newRunId('human');
        const lineId = brief.lineId && brief.lineId !== 'pending' ? brief.lineId : variationLineId(row.id);
        const extra: ExtraRequest = { title: row.description, notes: row.reason, photoUrls: row.photoUrls };
        const packLine = packLineForVariation({ variationId: row.id, extra, suggestion: brief.suggestion, finalPence });

        // 1. The quote gains the line. This is the accept path: the link she already has now shows
        //    the extra, priced, alongside the work she booked.
        const existing = Array.isArray(quote.pricingLineItems) ? (quote.pricingLineItems as any[]) : [];
        if (!existing.some((l: any) => String(l?.lineId ?? '') === lineId)) {
            const materials = Math.min(brief.suggestion?.materialsWithMarginPence ?? 0, finalPence);
            await db.update(personalizedQuotes).set({
                pricingLineItems: [...existing, {
                    lineId, label: row.description, title: row.description, description: row.description,
                    category: brief.suggestion?.category ?? 'general_fixing',
                    timeEstimateMinutes: brief.suggestion?.minutes ?? null,
                    materials: [], assumptions: packLine.assumptions, exclusions: [],
                    pricePence: finalPence, materialsPence: materials, materialsWithMarginPence: materials,
                    labourPence: Math.max(0, finalPence - materials), guardedPricePence: Math.max(0, finalPence - materials),
                    confirmedBy: 'human', source: 'variation', variationId: row.id,
                }],
                updatedAt: new Date(),
            } as any).where(eq(personalizedQuotes.id, quote.id));
        }

        // 2. The pack gains the line, LOCKED. This is the sanctioned way a locked pack grows.
        try {
            const { getPackForQuote, savePack } = await import('./job-pack');
            const pack = await getPackForQuote(quote.id);
            if (pack) await savePack(appendVariationLine(pack, packLine, approver));
        } catch (e: any) {
            const { isMissingTable } = await import('./job-pack');
            if (!isMissingTable(e)) console.warn('[Variation] pack line write failed (the extra stands):', e?.message ?? e);
        }

        // 3. The contractor's pay, through the existing engine, added to his snapshotted booking pay.
        let payDeltaPence = 0;
        try {
            const [p] = await db.select({ tier: handymanProfiles.deliveryTier }).from(handymanProfiles).where(eq(handymanProfiles.id, row.contractorId)).limit(1);
            payDeltaPence = payDeltaFor({ finalPence, suggestion: brief.suggestion, deliveryTier: p?.tier ?? null });
            if (payDeltaPence > 0 && brief.bookingId) {
                const [assignment] = await db.select({ id: bookingAssignments.id, payoutPence: bookingAssignments.payoutPence })
                    .from(bookingAssignments)
                    .where(and(eq(bookingAssignments.bookingId, brief.bookingId), eq(bookingAssignments.contractorId, row.contractorId)))
                    .limit(1);
                if (assignment) {
                    await db.update(bookingAssignments)
                        .set({ payoutPence: (assignment.payoutPence ?? 0) + payDeltaPence, updatedAt: new Date() } as any)
                        .where(eq(bookingAssignments.id, assignment.id));
                }
            }
        } catch (e: any) {
            console.warn('[Variation] pay update failed (the extra stands):', e?.message ?? e);
        }

        // 4. The record: the price Ben set, approved, under his name.
        const sentAt = new Date();
        await updateVariation(row.id, {
            additionalPricePence: finalPence,
            status: 'approved',
            resolvedBy: u.id ?? u.email ?? 'admin',
            resolvedAt: sentAt,
            adminNotes: writeBrief(row.adminNotes, { lineId, sentAt: sentAt.toISOString(), sentBy: approver, sentPricePence: finalPence, payDeltaPence, runId }),
        });

        // 5. The customer: the ONE send, through the exit, with the quote link.
        const base = process.env.BASE_URL || 'https://www.handyservices.app';
        const quoteUrl = quote.slug ? `${base}/quote/${quote.slug}` : null;
        const body = extraMessage({ firstName: screen.customer.firstName, title: row.description, pricePence: finalPence });
        const messageBody = quoteUrl ? `${body}\n\n${quoteUrl}` : body;
        let sendOutcome: { ok: boolean; reason?: string } = { ok: false, reason: 'no phone on the quote' };
        if (quote.phone) {
            const { sendCustomerMessage } = await import('../outbound');
            const sent = await sendCustomerMessage({
                to: quote.phone, body: messageBody, channel: 'whatsapp',
                approver, runId, purpose: 'service_reply',
                context: `variation:${row.id}`, contactName: quote.customerName ?? null,
            } as any);
            sendOutcome = { ok: !!sent.ok, reason: sent.ok ? undefined : (sent.error ?? sent.reason ?? 'send failed') };
        }

        // 6. The contractor. Best effort: a notice that does not land never unsends the customer's.
        try {
            const { liveNotifyDeps, sendToContractor, CHANGED_TEMPLATE_NAMES, changedVariables } = await import('./job-pack-notify');
            const first = (screen.contractor.name ?? '').trim().split(/\s+/)[0] || null;
            const notice = contractorNoticeBody({ firstName: first, title: row.description, pricePence: finalPence, payDeltaPence });
            const [prof] = await db.select({ phone: handymanProfiles.whatsappNumber }).from(handymanProfiles).where(eq(handymanProfiles.id, row.contractorId)).limit(1);
            const link = `${base}/contractor/my-week`;
            if (prof?.phone) {
                await sendToContractor('job_pack_changed',
                    { contractorId: row.contractorId, name: screen.contractor.name, phone: prof.phone, link },
                    notice, CHANGED_TEMPLATE_NAMES,
                    changedVariables({ title: row.description, date: null, fields: ['an extra was priced'], link }),
                    `variation:${row.id}`, await liveNotifyDeps());
            }
        } catch (e: any) {
            console.warn('[Variation] contractor notice failed (the extra stands):', e?.message ?? e);
        }

        try {
            const { logSystemEvent } = await import('../system-events');
            await logSystemEvent({
                kind: 'other', source: 'variation', conversationId: quote.conversationId ?? null, phone: quote.phone ?? null,
                summary: `Extra priced and sent: ${row.description} at £${(finalPence / 100).toFixed(2)}${payDeltaPence ? `, contractor +£${(payDeltaPence / 100).toFixed(2)}` : ''}`,
                detail: { variationId: row.id, quoteId: quote.id, lineId, finalPence, payDeltaPence, approver, runId, sent: sendOutcome.ok },
            } as any);
        } catch { /* the log never blocks the send */ }

        res.json({
            ok: true, id: row.id, finalPence, payDeltaPence, lineId, quoteUrl, messageBody, runId,
            sent: sendOutcome.ok,
            errors: sendOutcome.ok ? undefined : [`The extra is priced and on the quote, but the message did not go: ${sendOutcome.reason}. Send her the link yourself.`],
        });
    } catch (error: any) {
        console.error('[Variation] send failed:', error?.message ?? error, error?.stack);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not send the extra'] });
    }
});

export default variationRouter;
