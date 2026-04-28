/**
 * Contractor Dispatch Router
 *
 * Tokenised contractor job-sheet flow.
 * - Broadcast a job to N contractors via per-contractor token URLs
 * - First contractor to Accept locks the job; others see "taken"
 * - Acknowledge each on-site warning before Accept
 * - Decline + reason / ask question / report variation / mark complete
 * - Privacy gating: postcode pre-accept, full address post-accept
 *
 * URL: /contractor-job/:token  (client React page)
 * API: /api/contractor-job/:token (this router)
 *      /api/admin/dispatch/* (admin endpoints)
 */

import { Router, json as expressJson } from 'express';
import { db } from './db';
import {
  jobDispatches,
  contractorJobLinks,
  dispatchVariations,
  dispatchCompletions,
  dispatchBonds,
  handymanProfiles,
  users,
  personalizedQuotes,
} from '../shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import crypto from 'crypto';
import Stripe from 'stripe';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { calculateMultiLineRevenueShare } from './revenue-share-tiers';
import type { JobCategory } from '../shared/contextual-pricing-types';

// ─── Stripe lazy init ───────────────────────────────────────────────────────
// In dev, prefer the test secret so it matches the test publishable key the
// client mounts. In prod, prefer the live secret. Either way, fall back to the
// other if only one is configured.
function getStripe(): Stripe | null {
  const isDev = process.env.NODE_ENV !== 'production';
  const live = (process.env.STRIPE_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
  const test = (process.env.STRIPE_TEST_SECRET_KEY || '').replace(/^["']|["']$/g, '').trim();
  const key = isDev ? (test || live) : (live || test);
  if (!key || !key.startsWith('sk_')) return null;
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

export const contractorDispatchRouter = Router();

// ─── S3 helper for photo uploads ────────────────────────────────────────────
// Use the SAME env vars as server/storage.ts so we hit the same bucket the
// rest of the app uploads to successfully. The previous AWS_S3_BUCKET default
// pointed at a non-existent bucket, hence the "Amazon S3 upload error".

const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_BUCKET = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || '';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'eu-west-2';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
const S3_PUBLIC_URL_BASE = process.env.S3_PUBLIC_URL_BASE;

let s3Client: S3Client | null = null;
function getS3() {
  if (!s3Client) {
    if (!S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
      throw new Error('S3 credentials not configured (need S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY)');
    }
    s3Client = new S3Client({
      region: S3_REGION,
      ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    });
  }
  return s3Client;
}

function publicUrlFor(key: string): string {
  if (S3_PUBLIC_URL_BASE) return `${S3_PUBLIC_URL_BASE}/${key}`;
  if (S3_ENDPOINT) return `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
}

async function uploadPhotoToS3(base64DataUrl: string, prefix: string): Promise<string> {
  const match = base64DataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data URL');
  const [, mime, b64] = match;
  const ext = mime.split('/')[1];
  const buf = Buffer.from(b64, 'base64');
  const key = `${prefix}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
  await getS3().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buf,
    ContentType: mime,
  }));
  return publicUrlFor(key);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function findLinkByToken(token: string) {
  const links = await db.select().from(contractorJobLinks).where(eq(contractorJobLinks.token, token)).limit(1);
  return links[0] || null;
}

async function findDispatch(id: string) {
  const rows = await db.select().from(jobDispatches).where(eq(jobDispatches.id, id)).limit(1);
  return rows[0] || null;
}

// Short, readable job ref derived from the dispatch UUID — first 4 hex chars
// uppercased ("315D"). Used in contractor-facing UI so they have something
// quotable in WhatsApp ("ref #315D — Lenton kitchen").
function shortRef(dispatchId: string): string {
  // disp_<uuid> → uppercase first 4 hex chars after the prefix
  const uuid = dispatchId.replace(/^disp_/, '');
  return uuid.replace(/-/g, '').slice(0, 4).toUpperCase();
}

// Strip private fields from the dispatch payload based on link status.
function privacyGated(dispatch: any, linkStatus: string) {
  const isPostAccept = linkStatus === 'accepted';
  return {
    id: dispatch.id,
    shortRef: shortRef(dispatch.id),
    title: dispatch.title,
    subtitle: dispatch.subtitle,
    postcode: dispatch.postcode,
    customerFirstName: dispatch.customerFirstName,
    // Unlock these only after this contractor has accepted:
    customerFullName: isPostAccept ? dispatch.customerFullName : null,
    customerPhone: isPostAccept ? dispatch.customerPhone : null,
    customerAddress: isPostAccept ? dispatch.customerAddress : null,
    tasks: dispatch.tasks,
    totalHours: dispatch.totalHours / 10, // stored ×10
    totalContractorPayPence: dispatch.totalContractorPayPence,
    status: dispatch.status,
    scheduledDate: dispatch.scheduledDate || null,
    bondRequired: dispatch.bondRequired || false,
    bondAmountPence: dispatch.bondAmountPence || null,
    mediaUrls: dispatch.mediaUrls || [],
    proposalSummary: dispatch.proposalSummary || null,
    preferredDates: dispatch.preferredDates || null,
    // Never expose customerRevenuePence / platformKeepsPence / etc.
  };
}

async function findActiveBondForLink(linkId: string) {
  const rows = await db.select().from(dispatchBonds)
    .where(and(eq(dispatchBonds.linkId, linkId)))
    .orderBy(desc(dispatchBonds.createdAt))
    .limit(1);
  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// OPEN DISPATCH LINK — single shareable URL per dispatch
// ═══════════════════════════════════════════════════════════════════════════
// Admin generates one link per dispatch; the URL can be broadcast (WhatsApp
// group, etc.). Contractors visit, pick themselves from the curated pool, and
// proceed to the existing per-contractor flow. First to pay the bond locks it.

async function findDispatchByPublicToken(token: string) {
  const rows = await db.select().from(jobDispatches).where(eq(jobDispatches.publicToken, token)).limit(1);
  return rows[0] || null;
}

/**
 * GET /api/dispatch-link/:token
 * Public-facing brief — privacy-gated, no contractor identity yet.
 */
contractorDispatchRouter.get('/api/dispatch-link/:token', async (req, res) => {
  try {
    const dispatch = await findDispatchByPublicToken(req.params.token);
    if (!dispatch) return res.status(404).json({ error: 'Link not found' });

    // Apply same privacy gating as the per-contractor brief, but always pre-accept
    // (no contractor has identified themselves yet on this URL)
    const isLocked = dispatch.status === 'locked' || dispatch.status === 'completed';

    // Bump scarcity counters — only count views while the dispatch is still live.
    if (!isLocked) {
      const now = new Date();
      await db.update(jobDispatches)
        .set({ viewCount: (dispatch.viewCount || 0) + 1, lastViewedAt: now })
        .where(eq(jobDispatches.id, dispatch.id));
    }

    res.json({
      dispatch: privacyGated(dispatch, 'pending'),
      isLocked,
      // Scarcity signals shown near the sticky CTA: total view count + last-view age.
      viewCount: (dispatch.viewCount || 0) + (isLocked ? 0 : 1),
      lastViewedAt: isLocked ? dispatch.lastViewedAt : new Date().toISOString(),
      lockedToContractorName: isLocked ? await (async () => {
        // Show only the locked contractor's name (not phone) — handy for
        // contractors who later open the link and want to know who got it.
        const links = await db.select().from(contractorJobLinks)
          .where(and(eq(contractorJobLinks.dispatchId, dispatch.id), eq(contractorJobLinks.status, 'accepted')))
          .limit(1);
        return links[0]?.contractorName || null;
      })() : null,
    });
  } catch (err) {
    console.error('[OpenDispatch] GET error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/dispatch-link/:token/contractors
 * Returns the curated contractor pool the visitor can pick themselves from.
 */
contractorDispatchRouter.get('/api/dispatch-link/:token/contractors', async (req, res) => {
  try {
    const dispatch = await findDispatchByPublicToken(req.params.token);
    if (!dispatch) return res.status(404).json({ error: 'Link not found' });

    const profileRows = await db.select({
      id: handymanProfiles.id,
      businessName: handymanProfiles.businessName,
      whatsappNumber: handymanProfiles.whatsappNumber,
      city: handymanProfiles.city,
      verificationStatus: handymanProfiles.verificationStatus,
      userFirst: users.firstName,
      userLast: users.lastName,
      userPhone: users.phone,
    })
      .from(handymanProfiles)
      .leftJoin(users, eq(handymanProfiles.userId, users.id))
      .limit(100);

    const contractors = profileRows.map((p) => ({
      id: p.id,
      name: (p.businessName || [p.userFirst, p.userLast].filter(Boolean).join(' ') || 'Contractor').trim(),
      city: p.city,
      // Mask phone for privacy on the public list — only show the last 4 digits
      phoneSuffix: ((p.whatsappNumber || p.userPhone || '').replace(/\D/g, '').slice(-4) || null),
    })).filter((c) => c.name && c.name !== 'Contractor');

    res.json({ contractors });
  } catch (err) {
    console.error('[OpenDispatch] contractors error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/dispatch-link/:token/claim
 * Body: { contractorId }
 * Issues a per-contractor link for this contractor on this dispatch (or returns
 * the existing one if they've already claimed). Returns the contractor token so
 * the client can redirect to /contractor-job/:contractorToken (existing flow).
 *
 * NOTE: this does NOT lock the dispatch. The lock happens at bond payment.
 */
contractorDispatchRouter.post('/api/dispatch-link/:token/claim', async (req, res) => {
  try {
    const dispatch = await findDispatchByPublicToken(req.params.token);
    if (!dispatch) return res.status(404).json({ error: 'Link not found' });
    if (dispatch.status !== 'pending') {
      return res.status(409).json({ error: `Job is already ${dispatch.status}` });
    }

    const { contractorId } = req.body;
    if (!contractorId) return res.status(400).json({ error: 'contractorId required' });

    // Verify the contractor exists in the pool
    const profileRows = await db.select({
      id: handymanProfiles.id,
      businessName: handymanProfiles.businessName,
      whatsappNumber: handymanProfiles.whatsappNumber,
      userFirst: users.firstName,
      userLast: users.lastName,
      userPhone: users.phone,
    })
      .from(handymanProfiles)
      .leftJoin(users, eq(handymanProfiles.userId, users.id))
      .where(eq(handymanProfiles.id, contractorId))
      .limit(1);
    const profile = profileRows[0];
    if (!profile) return res.status(404).json({ error: 'Contractor not in pool' });

    // Reuse existing link for this contractor on this dispatch if any
    const existing = await db.select().from(contractorJobLinks)
      .where(and(eq(contractorJobLinks.dispatchId, dispatch.id), eq(contractorJobLinks.contractorId, contractorId)))
      .limit(1);
    if (existing.length > 0) {
      return res.json({ token: existing[0].token, reused: true });
    }

    // Otherwise create a fresh per-contractor link
    const displayName = (profile.businessName || [profile.userFirst, profile.userLast].filter(Boolean).join(' ') || 'Contractor').trim();
    const phone = profile.whatsappNumber || profile.userPhone || null;
    const [link] = await db.insert(contractorJobLinks).values({
      dispatchId: dispatch.id,
      contractorId,
      contractorName: displayName,
      contractorPhone: phone,
    }).returning();

    console.log(`[OpenDispatch] 🪪 ${displayName} claimed dispatch ${dispatch.id} via public link`);
    res.json({ token: link.token, reused: false });
  } catch (err) {
    console.error('[OpenDispatch] claim error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACTOR-FACING ENDPOINTS — token-authenticated
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/contractor-job/:token
 * Fetch dispatch + link status. Privacy-gated.
 */
contractorDispatchRouter.get('/api/contractor-job/:token', async (req, res) => {
  try {
    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found or expired' });

    const dispatch = await findDispatch(link.dispatchId);
    if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' });

    // Mark "viewed" the first time we serve this link
    if (!link.viewedAt && link.status === 'pending') {
      await db.update(contractorJobLinks)
        .set({ viewedAt: new Date(), status: 'viewed', updatedAt: new Date() })
        .where(eq(contractorJobLinks.id, link.id));
      link.viewedAt = new Date();
      link.status = 'viewed';
    }

    // If the dispatch is locked to someone else, override link status display
    let displayStatus = link.status;
    if (dispatch.status === 'locked' && dispatch.lockedToContractorId !== link.contractorId) {
      displayStatus = 'locked_taken';
    }

    // Look up active bond if any
    const bond = await findActiveBondForLink(link.id);

    // Count how many contractors this dispatch was broadcast to — drives the
    // subtle "sent to a few of our pool" framing in the UI.
    const peerLinks = await db.select({ id: contractorJobLinks.id })
      .from(contractorJobLinks)
      .where(eq(contractorJobLinks.dispatchId, dispatch.id));
    const broadcastCount = peerLinks.length;

    res.json({
      link: {
        id: link.id,
        token: link.token,
        contractorName: link.contractorName,
        status: displayStatus,
        warningsAcknowledged: link.warningsAcknowledged,
        responseMessage: link.responseMessage,
        acceptedAt: link.acceptedAt,
        declinedAt: link.declinedAt,
      },
      dispatch: privacyGated(dispatch, displayStatus),
      bond: bond ? {
        id: bond.id,
        amountPence: bond.amountPence,
        status: bond.status,
        paidAt: bond.paidAt,
        refundedAt: bond.refundedAt,
        refundReason: bond.refundReason,
      } : null,
      broadcastCount,
    });
  } catch (err) {
    console.error('[ContractorDispatch] GET error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/contractor-job/:token/bond/intent
 * Create or reuse a Stripe Payment Intent for the security bond.
 * Returns { clientSecret, bondId, amountPence } for the client to confirm.
 */
contractorDispatchRouter.post('/api/contractor-job/:token/bond/intent', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Payments unavailable' });

    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const dispatch = await findDispatch(link.dispatchId);
    if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' });

    if (!dispatch.bondRequired || !dispatch.bondAmountPence) {
      return res.status(400).json({ error: 'No bond required for this dispatch' });
    }
    if (dispatch.status !== 'pending') {
      return res.status(409).json({ error: `Dispatch is ${dispatch.status} — cannot pay bond` });
    }
    if (link.status === 'accepted' || link.status === 'declined' || link.status === 'locked_taken') {
      return res.status(409).json({ error: `Link is ${link.status}` });
    }

    // Reuse existing bond if one exists in pending state, else create new
    let bond = await findActiveBondForLink(link.id);
    if (bond && (bond.status === 'held' || bond.status === 'refunded')) {
      return res.status(409).json({ error: `Bond already ${bond.status}` });
    }

    let paymentIntent;
    if (bond && bond.stripePaymentIntentId) {
      // Reuse existing
      paymentIntent = await stripe.paymentIntents.retrieve(bond.stripePaymentIntentId);
      // If it's already succeeded, mark held
      if (paymentIntent.status === 'succeeded') {
        await db.update(dispatchBonds)
          .set({ status: 'held', paidAt: new Date(), stripeChargeId: paymentIntent.latest_charge as string, updatedAt: new Date() })
          .where(eq(dispatchBonds.id, bond.id));
      }
    } else {
      // Create a fresh payment intent
      paymentIntent = await stripe.paymentIntents.create({
        amount: dispatch.bondAmountPence,
        currency: 'gbp',
        capture_method: 'automatic',
        description: `Security bond — ${dispatch.title} — ${link.contractorName}`,
        metadata: {
          dispatchId: dispatch.id,
          linkId: link.id,
          contractorId: link.contractorId,
          contractorName: link.contractorName || '',
          purpose: 'contractor_bond',
        },
        automatic_payment_methods: { enabled: true },
      });

      if (bond) {
        await db.update(dispatchBonds)
          .set({ stripePaymentIntentId: paymentIntent.id, updatedAt: new Date() })
          .where(eq(dispatchBonds.id, bond.id));
      } else {
        const [newBond] = await db.insert(dispatchBonds).values({
          linkId: link.id,
          dispatchId: dispatch.id,
          contractorId: link.contractorId,
          amountPence: dispatch.bondAmountPence,
          stripePaymentIntentId: paymentIntent.id,
          status: 'pending',
        }).returning();
        bond = newBond;
      }
    }

    res.json({
      clientSecret: paymentIntent.client_secret,
      bondId: bond!.id,
      amountPence: dispatch.bondAmountPence,
    });
  } catch (err) {
    console.error('[ContractorDispatch] bond/intent error:', err);
    res.status(500).json({ error: 'Could not create bond payment' });
  }
});

/**
 * POST /api/contractor-job/:token/bond/confirm
 * After the client confirms the payment intent, this verifies with Stripe and
 * transitions the bond to 'held'.
 */
contractorDispatchRouter.post('/api/contractor-job/:token/bond/confirm', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Payments unavailable' });

    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const bond = await findActiveBondForLink(link.id);
    if (!bond || !bond.stripePaymentIntentId) {
      return res.status(404).json({ error: 'No bond to confirm' });
    }

    const pi = await stripe.paymentIntents.retrieve(bond.stripePaymentIntentId);

    if (pi.status === 'succeeded') {
      const now = new Date();

      // Atomically lock the dispatch — first paid bond wins. If another contractor
      // already paid, we lost the race: refund this PI immediately and tell the
      // client the job is taken. (Race is rare but real with the open-link model.)
      const lockUpdate = await db.update(jobDispatches)
        .set({ status: 'locked', lockedToContractorId: link.contractorId, lockedAt: now, updatedAt: now })
        .where(and(eq(jobDispatches.id, link.dispatchId), eq(jobDispatches.status, 'pending')))
        .returning();

      if (lockUpdate.length === 0) {
        // Lost race — refund the bond automatically and mark this bond cancelled.
        try {
          await stripe.refunds.create({
            payment_intent: bond.stripePaymentIntentId,
            reason: 'requested_by_customer',
            metadata: { reason: 'lost_race_to_lock', bondId: bond.id },
          });
        } catch (refundErr) {
          console.error('[ContractorDispatch] race-loss refund failed:', refundErr);
        }
        await db.update(dispatchBonds)
          .set({ status: 'refunded', updatedAt: new Date() })
          .where(eq(dispatchBonds.id, bond.id));
        return res.status(409).json({ error: 'Another contractor locked the job first — your bond is being refunded.' });
      }

      // Won the race — bond is held + dispatch is locked + this contractor's link
      // moves to accepted in one go (the open-link flow doesn't require per-warning
      // ack pre-lock; warnings remain visible on the post-lock job sheet).
      await db.update(dispatchBonds)
        .set({
          status: 'held',
          paidAt: now,
          stripeChargeId: typeof pi.latest_charge === 'string' ? pi.latest_charge : null,
          updatedAt: now,
        })
        .where(eq(dispatchBonds.id, bond.id));
      await db.update(contractorJobLinks)
        .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
        .where(eq(contractorJobLinks.id, link.id));
      console.log(`[ContractorDispatch] 🔒 dispatch locked via bond payment: ${link.dispatchId} → ${link.contractorName} (bond ${bond.id})`);
      return res.json({ ok: true, status: 'held', locked: true });
    }
    if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
      await db.update(dispatchBonds)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(dispatchBonds.id, bond.id));
      return res.status(402).json({ error: 'Payment failed', stripeStatus: pi.status });
    }
    // Still processing
    return res.json({ ok: false, status: 'pending', stripeStatus: pi.status });
  } catch (err) {
    console.error('[ContractorDispatch] bond/confirm error:', err);
    res.status(500).json({ error: 'Could not confirm bond' });
  }
});

/**
 * POST /api/contractor-job/:token/acknowledge-warning
 * Body: { taskNum, warningText }
 * Records that this contractor read & acknowledged a specific on-site warning.
 */
contractorDispatchRouter.post('/api/contractor-job/:token/acknowledge-warning', async (req, res) => {
  try {
    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const { taskNum, warningText } = req.body;
    if (typeof taskNum !== 'number' || !warningText) {
      return res.status(400).json({ error: 'taskNum and warningText required' });
    }

    const acks = (link.warningsAcknowledged as any[]) || [];
    // De-dup
    const exists = acks.some((a) => a.taskNum === taskNum);
    if (!exists) {
      acks.push({ taskNum, warningText, ackedAt: new Date().toISOString() });
    }

    await db.update(contractorJobLinks)
      .set({ warningsAcknowledged: acks, updatedAt: new Date() })
      .where(eq(contractorJobLinks.id, link.id));

    res.json({ ok: true, acknowledged: acks });
  } catch (err) {
    console.error('[ContractorDispatch] ack-warning error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/contractor-job/:token/accept
 * First-acceptor-wins. Locks the dispatch and marks all other links as 'locked_taken'.
 */
contractorDispatchRouter.post('/api/contractor-job/:token/accept', async (req, res) => {
  try {
    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const dispatch = await findDispatch(link.dispatchId);
    if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' });

    if (dispatch.status === 'locked') {
      return res.status(409).json({ error: 'Job already taken', lockedTo: dispatch.lockedToContractorId });
    }
    if (dispatch.status !== 'pending') {
      return res.status(409).json({ error: `Dispatch is ${dispatch.status}` });
    }

    // Verify all warnings acknowledged
    const tasks = (dispatch.tasks as any[]) || [];
    const requiredWarnings = tasks.filter((t) => t.warning).length;
    const acks = (link.warningsAcknowledged as any[]) || [];
    if (acks.length < requiredWarnings) {
      return res.status(400).json({
        error: 'You must tick all on-site warnings before accepting',
        required: requiredWarnings,
        acknowledged: acks.length,
      });
    }

    // If bond required, ensure one is held
    if (dispatch.bondRequired) {
      const bond = await findActiveBondForLink(link.id);
      if (!bond || bond.status !== 'held') {
        return res.status(402).json({
          error: 'Pay the security bond before accepting',
          bondRequired: true,
          bondAmountPence: dispatch.bondAmountPence,
        });
      }
    }

    const now = new Date();

    // Atomic: lock the dispatch first (only if still pending)
    const lockUpdate = await db.update(jobDispatches)
      .set({ status: 'locked', lockedToContractorId: link.contractorId, lockedAt: now, updatedAt: now })
      .where(and(eq(jobDispatches.id, dispatch.id), eq(jobDispatches.status, 'pending')))
      .returning();

    if (lockUpdate.length === 0) {
      // Race: someone else accepted in between
      return res.status(409).json({ error: 'Job was just taken by another contractor' });
    }

    // Mark this link as accepted
    await db.update(contractorJobLinks)
      .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
      .where(eq(contractorJobLinks.id, link.id));

    // Mark all OTHER links as locked_taken
    const allLinks = await db.select().from(contractorJobLinks).where(eq(contractorJobLinks.dispatchId, dispatch.id));
    for (const l of allLinks) {
      if (l.id !== link.id && l.status !== 'declined') {
        await db.update(contractorJobLinks)
          .set({ status: 'locked_taken', updatedAt: now })
          .where(eq(contractorJobLinks.id, l.id));
      }
    }

    console.log(`[ContractorDispatch] ✅ ${link.contractorName} accepted dispatch ${dispatch.id}`);

    res.json({
      ok: true,
      acceptedAt: now,
      // Reveal post-accept fields
      customerFullName: dispatch.customerFullName,
      customerPhone: dispatch.customerPhone,
      customerAddress: dispatch.customerAddress,
    });
  } catch (err) {
    console.error('[ContractorDispatch] accept error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/contractor-job/:token/decline
 * Body: { reason: string }
 */
contractorDispatchRouter.post('/api/contractor-job/:token/decline', async (req, res) => {
  try {
    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const { reason } = req.body;
    const now = new Date();
    await db.update(contractorJobLinks)
      .set({
        status: 'declined',
        declinedAt: now,
        responseMessage: reason || null,
        updatedAt: now,
      })
      .where(eq(contractorJobLinks.id, link.id));

    console.log(`[ContractorDispatch] ❌ ${link.contractorName} declined dispatch ${link.dispatchId}: ${reason}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ContractorDispatch] decline error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/contractor-job/:token/question
 * Body: { question: string }
 */
contractorDispatchRouter.post('/api/contractor-job/:token/question', async (req, res) => {
  try {
    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found' });

    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question required' });
    }

    const now = new Date();
    await db.update(contractorJobLinks)
      .set({
        status: 'questioning',
        responseMessage: question,
        updatedAt: now,
      })
      .where(eq(contractorJobLinks.id, link.id));

    console.log(`[ContractorDispatch] ❓ ${link.contractorName} asked on dispatch ${link.dispatchId}: ${question}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ContractorDispatch] question error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/contractor-job/:token/variation
 * Body: { description, reason?, additionalPricePence?, additionalTimeMins?, photos?: dataURLs[], taskNum? }
 */
contractorDispatchRouter.post('/api/contractor-job/:token/variation', async (req, res) => {
  try {
    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.status !== 'accepted') {
      return res.status(403).json({ error: 'Only the accepted contractor can report a variation' });
    }

    const { description, reason, additionalPricePence, additionalTimeMins, photos, taskNum } = req.body;
    if (!description) return res.status(400).json({ error: 'description required' });

    // Upload photos (optional)
    const photoUrls: string[] = [];
    if (Array.isArray(photos)) {
      for (const p of photos) {
        if (typeof p === 'string' && p.startsWith('data:image/')) {
          try {
            const url = await uploadPhotoToS3(p, `dispatch/${link.dispatchId}/variations`);
            photoUrls.push(url);
          } catch (e) {
            console.error('[ContractorDispatch] variation photo upload failed:', e);
          }
        }
      }
    }

    const [variation] = await db.insert(dispatchVariations).values({
      dispatchId: link.dispatchId,
      contractorId: link.contractorId,
      taskNum: typeof taskNum === 'number' ? taskNum : null,
      description,
      reason: reason || null,
      additionalPricePence: additionalPricePence || 0,
      additionalTimeMins: additionalTimeMins || 0,
      photoUrls,
    }).returning();

    console.log(`[ContractorDispatch] 🛠 variation reported on ${link.dispatchId}: ${description}`);
    res.json({ ok: true, variation });
  } catch (err) {
    console.error('[ContractorDispatch] variation error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/contractor-job/:token/complete
 * Body: { photos: dataURLs[] (REQUIRED), notes? }
 */
contractorDispatchRouter.post('/api/contractor-job/:token/complete', async (req, res) => {
  try {
    const link = await findLinkByToken(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found' });
    if (link.status !== 'accepted') {
      return res.status(403).json({ error: 'Only the accepted contractor can complete this job' });
    }

    const { photos, notes } = req.body;
    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'At least one completion photo is required' });
    }

    const photoUrls: string[] = [];
    for (const p of photos) {
      if (typeof p === 'string' && p.startsWith('data:image/')) {
        try {
          const url = await uploadPhotoToS3(p, `dispatch/${link.dispatchId}/completion`);
          photoUrls.push(url);
        } catch (e) {
          console.error('[ContractorDispatch] completion photo upload failed:', e);
        }
      }
    }

    if (photoUrls.length === 0) {
      return res.status(400).json({ error: 'Failed to upload any photos' });
    }

    const now = new Date();
    const [completion] = await db.insert(dispatchCompletions).values({
      dispatchId: link.dispatchId,
      contractorId: link.contractorId,
      photoUrls,
      notes: notes || null,
      completedAt: now,
    }).returning();

    await db.update(jobDispatches)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(eq(jobDispatches.id, link.dispatchId));

    console.log(`[ContractorDispatch] ✅ ${link.contractorName} completed ${link.dispatchId}`);

    // Auto-refund the bond if held — runs in background, don't block response
    const bond = await findActiveBondForLink(link.id);
    let bondRefund: { ok: boolean; refundId?: string; error?: string } | null = null;
    if (bond && bond.status === 'held' && bond.stripePaymentIntentId) {
      const stripe = getStripe();
      if (stripe) {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: bond.stripePaymentIntentId,
            reason: 'requested_by_customer',
            metadata: {
              dispatchId: bond.dispatchId,
              bondId: bond.id,
              reason: 'job_completed',
            },
          });
          await db.update(dispatchBonds)
            .set({
              status: 'refunded',
              refundedAt: new Date(),
              refundReason: 'job_completed',
              stripeRefundId: refund.id,
              updatedAt: new Date(),
            })
            .where(eq(dispatchBonds.id, bond.id));
          bondRefund = { ok: true, refundId: refund.id };
          console.log(`[ContractorDispatch] 💸 bond refunded: ${bond.id} (£${(bond.amountPence / 100).toFixed(2)})`);
        } catch (err) {
          console.error('[ContractorDispatch] auto-refund failed (non-blocking):', err);
          bondRefund = { ok: false, error: err instanceof Error ? err.message : 'unknown' };
        }
      }
    }

    res.json({ ok: true, completion, bondRefund });
  } catch (err) {
    console.error('[ContractorDispatch] complete error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── ADMIN media endpoints ──────────────────────────────────────────────────

/**
 * POST /api/admin/dispatch/:id/media
 * Body: { dispatchPhotos?: dataUrls[], taskMedia?: { taskNum: number, dataUrls: string[] }[] }
 *
 * Uploads photos/videos for a dispatch. Splits into:
 * - dispatchPhotos → dispatch.mediaUrls (overview gallery)
 * - taskMedia[] → tasks[N].mediaUrls (per-task)
 *
 * Accepts data URLs (image/* or video/*) — server uploads to S3 and returns
 * the persisted URLs. Append-only (does not replace existing media).
 */
// Route-specific JSON parser with much higher limit because video data URLs
// can easily exceed the global 10MB cap. 200MB tolerates a ~150MB video after
// base64 inflation. (Long-term: replace with multipart upload via multer or
// pre-signed S3 URLs to avoid keeping the file in memory.)
contractorDispatchRouter.post('/api/admin/dispatch/:id/media',
  expressJson({ limit: '200mb' }),
  async (req, res) => {
  try {
    const dispatch = await findDispatch(req.params.id);
    if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' });

    const { dispatchPhotos, taskMedia } = req.body as {
      dispatchPhotos?: string[];
      taskMedia?: Array<{ taskNum: number; dataUrls: string[] }>;
    };

    // Helper: upload any data URL (image or video)
    async function uploadOne(dataUrl: string, prefix: string): Promise<string | null> {
      const m = dataUrl.match(/^data:(image\/\w+|video\/\w+);base64,(.+)$/);
      if (!m) return null;
      const [, mime, b64] = m;
      const ext = mime.split('/')[1];
      const buf = Buffer.from(b64, 'base64');
      const key = `${prefix}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
      await getS3().send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buf,
        ContentType: mime,
      }));
      return publicUrlFor(key);
    }

    const newDispatchUrls: string[] = [];
    if (Array.isArray(dispatchPhotos)) {
      for (const url of dispatchPhotos) {
        if (typeof url === 'string' && /^data:(image|video)\//.test(url)) {
          const uploaded = await uploadOne(url, `dispatch/${dispatch.id}/overview`);
          if (uploaded) newDispatchUrls.push(uploaded);
        } else if (typeof url === 'string' && url.startsWith('http')) {
          // Allow passing pre-uploaded URLs
          newDispatchUrls.push(url);
        }
      }
    }

    // Update dispatch.mediaUrls (append)
    const existingDispatchUrls = (dispatch.mediaUrls as string[]) || [];
    const allDispatchUrls = [...existingDispatchUrls, ...newDispatchUrls];

    // Per-task media — modify the tasks jsonb in place
    let updatedTasks = dispatch.tasks as any[];
    if (Array.isArray(taskMedia)) {
      updatedTasks = await Promise.all(updatedTasks.map(async (task: any) => {
        const matching = taskMedia.find((tm) => tm.taskNum === task.num);
        if (!matching) return task;
        const taskNewUrls: string[] = [];
        for (const url of matching.dataUrls) {
          if (typeof url === 'string' && /^data:(image|video)\//.test(url)) {
            const uploaded = await uploadOne(url, `dispatch/${dispatch.id}/task-${task.num}`);
            if (uploaded) taskNewUrls.push(uploaded);
          } else if (typeof url === 'string' && url.startsWith('http')) {
            taskNewUrls.push(url);
          }
        }
        return { ...task, mediaUrls: [...((task.mediaUrls as string[]) || []), ...taskNewUrls] };
      }));
    }

    await db.update(jobDispatches)
      .set({
        mediaUrls: allDispatchUrls,
        tasks: updatedTasks,
        updatedAt: new Date(),
      })
      .where(eq(jobDispatches.id, dispatch.id));

    console.log(`[ContractorDispatch] 📷 media added to ${dispatch.id}: ${newDispatchUrls.length} dispatch + ${(taskMedia || []).length} task uploads`);
    res.json({
      ok: true,
      dispatchMediaUrls: allDispatchUrls,
      tasks: updatedTasks,
    });
  } catch (err: any) {
    console.error('[ContractorDispatch] media upload error:', err);

    // Friendly error messages for common failure modes
    if (err?.type === 'entity.too.large' || err?.status === 413 || /payload too large/i.test(err?.message || '')) {
      return res.status(413).json({
        error: 'File too large. Please keep videos under 150MB or compress before uploading.',
      });
    }
    if (err?.name === 'CredentialsProviderError' || /access denied|signature|InvalidAccessKey/i.test(err?.message || '')) {
      return res.status(500).json({
        error: 'S3 upload failed (credentials). Photos saved locally — please retry shortly.',
      });
    }
    if (/EPIPE|ECONN|timeout/i.test(err?.message || '')) {
      return res.status(502).json({
        error: 'Upload timed out. Try a smaller file or check your connection.',
      });
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

// Express body-parser errors (e.g. PayloadTooLargeError) for the media route
contractorDispatchRouter.use('/api/admin/dispatch/:id/media', (err: any, _req: any, res: any, next: any) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      error: 'File too large for a single request. Please upload videos under ~150MB.',
    });
  }
  next(err);
});

// ─── ADMIN bond endpoints ───────────────────────────────────────────────────

/**
 * POST /api/admin/dispatch/:id/bond/forfeit
 * Body: { linkId, reason, forfeitedBy }
 * Marks a bond as forfeited (kept by platform) — typically when contractor
 * no-shows or cancels within 48hrs of the scheduled date.
 */
contractorDispatchRouter.post('/api/admin/dispatch/:id/bond/forfeit', async (req, res) => {
  try {
    const { linkId, reason, forfeitedBy } = req.body;
    if (!linkId || !reason) return res.status(400).json({ error: 'linkId + reason required' });

    const bond = await findActiveBondForLink(linkId);
    if (!bond) return res.status(404).json({ error: 'No bond for that link' });
    if (bond.status !== 'held') return res.status(409).json({ error: `Bond is ${bond.status}, cannot forfeit` });

    await db.update(dispatchBonds)
      .set({
        status: 'forfeited',
        forfeitedAt: new Date(),
        forfeitedBy: forfeitedBy || 'admin',
        forfeitReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(dispatchBonds.id, bond.id));

    console.log(`[ContractorDispatch] 🟥 bond forfeited: ${bond.id} reason="${reason}"`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ContractorDispatch] forfeit error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/admin/dispatch/:id/bond/refund
 * Body: { linkId, reason }
 * Manual refund (e.g. customer cancelled, admin discretion). Calls Stripe refund.
 */
contractorDispatchRouter.post('/api/admin/dispatch/:id/bond/refund', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Payments unavailable' });

    const { linkId, reason } = req.body;
    if (!linkId) return res.status(400).json({ error: 'linkId required' });

    const bond = await findActiveBondForLink(linkId);
    if (!bond) return res.status(404).json({ error: 'No bond for that link' });
    if (bond.status !== 'held') return res.status(409).json({ error: `Bond is ${bond.status}` });
    if (!bond.stripePaymentIntentId) return res.status(400).json({ error: 'No payment intent on bond' });

    const refund = await stripe.refunds.create({
      payment_intent: bond.stripePaymentIntentId,
      reason: 'requested_by_customer',
      metadata: { dispatchId: bond.dispatchId, bondId: bond.id, reason: reason || 'admin_refund' },
    });

    await db.update(dispatchBonds)
      .set({
        status: 'refunded',
        refundedAt: new Date(),
        refundReason: reason || 'admin_refund',
        stripeRefundId: refund.id,
        updatedAt: new Date(),
      })
      .where(eq(dispatchBonds.id, bond.id));

    console.log(`[ContractorDispatch] 💸 admin bond refund: ${bond.id} (${reason})`);
    res.json({ ok: true, refundId: refund.id });
  } catch (err) {
    console.error('[ContractorDispatch] admin refund error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS — internal use only (no auth wired here for v1; assume
// reverse-proxy / session middleware gates /api/admin/*)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/dispatch
 * Create a new job dispatch + tokenised links for N contractors.
 *
 * Body: {
 *   quoteId?, invoiceId?,
 *   title, subtitle?,
 *   postcode, customerFirstName, customerFullName?, customerPhone?, customerAddress?,
 *   tasks: [...],
 *   totalHours: number,
 *   totalContractorPayPence: number,
 *   customerRevenuePence?, platformKeepsPence?,
 *   contractorIds: string[]  (handyman_profiles.id)
 * }
 */
contractorDispatchRouter.post('/api/admin/dispatch', async (req, res) => {
  try {
    const {
      quoteId, invoiceId,
      title, subtitle,
      postcode, customerFirstName, customerFullName, customerPhone, customerAddress,
      tasks, totalHours, totalContractorPayPence,
      customerRevenuePence, platformKeepsPence,
      contractorIds,
      bondRequired, bondAmountPence,
      scheduledDate,
      createdBy,
    } = req.body;

    if (!title || !postcode || !customerFirstName || !Array.isArray(tasks)) {
      return res.status(400).json({ error: 'title, postcode, customerFirstName, tasks required' });
    }
    // contractorIds is now OPTIONAL — the open-link model lets contractors claim
    // themselves via /dispatch-link/:publicToken. Admins can still pre-broadcast
    // to a specific subset by passing contractorIds.
    const explicitContractorIds: string[] = Array.isArray(contractorIds) ? contractorIds : [];

    // Snapshot the customer's preferred dates + build a contractor-flavoured summary
    // from the quote at creation time. Keeps the dispatch self-contained (won't
    // drift if the quote is later edited).
    let proposalSummary: string | null = null;
    let preferredDates: any = null;
    if (quoteId) {
      const qRows = await db.select({
        dateTimePreferences: personalizedQuotes.dateTimePreferences,
      }).from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
      preferredDates = qRows[0]?.dateTimePreferences || null;
    }
    // Build a punchy contractor summary from the task titles
    if (Array.isArray(tasks) && tasks.length > 0) {
      const cleaned = tasks
        .map((t: any) => (t.title || '').replace(/^(Replace|Install|Remove|Supply and fit|Repaint|Re-?seal|Add|Refix)\s+/i, '').trim())
        .filter(Boolean)
        .map((s: string) => s.length > 30 ? s.slice(0, 28).trim() + '…' : s);
      const head = cleaned.slice(0, 3).join(', ');
      const remaining = cleaned.length - 3;
      proposalSummary = remaining > 0 ? `${head} + ${remaining} more` : head;
      proposalSummary = proposalSummary.charAt(0).toUpperCase() + proposalSummary.slice(1);
    }

    const [dispatch] = await db.insert(jobDispatches).values({
      quoteId: quoteId || null,
      invoiceId: invoiceId || null,
      title,
      subtitle: subtitle || null,
      postcode,
      customerFirstName,
      customerFullName: customerFullName || null,
      customerPhone: customerPhone || null,
      customerAddress: customerAddress || null,
      tasks,
      totalHours: Math.round((totalHours || 0) * 10),
      totalContractorPayPence: totalContractorPayPence || 0,
      customerRevenuePence: customerRevenuePence || null,
      platformKeepsPence: platformKeepsPence || null,
      bondRequired: !!bondRequired,
      bondAmountPence: bondRequired ? (bondAmountPence || 3000) : null,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      proposalSummary,
      preferredDates,
      createdBy: createdBy || null,
    }).returning();

    // Fetch contractor names + phones via handyman_profiles → users join
    const profileRows = await db.select({
      id: handymanProfiles.id,
      businessName: handymanProfiles.businessName,
      whatsappNumber: handymanProfiles.whatsappNumber,
      userFirst: users.firstName,
      userLast: users.lastName,
      userPhone: users.phone,
    }).from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id));
    const profileMap = new Map(profileRows.map((p) => [p.id, p]));

    const links = [];
    for (const cid of explicitContractorIds) {
      const profile = profileMap.get(cid);
      const displayName = profile?.businessName
        || [profile?.userFirst, profile?.userLast].filter(Boolean).join(' ')
        || 'Contractor';
      const phone = profile?.whatsappNumber || profile?.userPhone || null;
      const [link] = await db.insert(contractorJobLinks).values({
        dispatchId: dispatch.id,
        contractorId: cid,
        contractorName: displayName,
        contractorPhone: phone,
      }).returning();
      links.push(link);
    }

    res.json({
      ok: true,
      dispatch,
      // The shareable open-link URL — admin pastes this into WhatsApp / group chat
      publicUrl: `/dispatch-link/${dispatch.publicToken}`,
      links: links.map((l) => ({
        id: l.id,
        token: l.token,
        contractorId: l.contractorId,
        contractorName: l.contractorName,
        url: `/contractor-job/${l.token}`,
      })),
    });
  } catch (err) {
    console.error('[ContractorDispatch] admin create error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/admin/dispatch
 * List all dispatches (most recent first) with link summaries.
 */
contractorDispatchRouter.get('/api/admin/dispatch', async (req, res) => {
  try {
    const dispatches = await db.select().from(jobDispatches).orderBy(desc(jobDispatches.createdAt)).limit(50);
    const allLinks = await db.select().from(contractorJobLinks);
    const allVariations = await db.select().from(dispatchVariations);
    const allCompletions = await db.select().from(dispatchCompletions);
    const allBonds = await db.select().from(dispatchBonds);

    const linkMap = new Map<string, any[]>();
    for (const l of allLinks) {
      if (!linkMap.has(l.dispatchId)) linkMap.set(l.dispatchId, []);
      linkMap.get(l.dispatchId)!.push(l);
    }
    const varMap = new Map<string, any[]>();
    for (const v of allVariations) {
      if (!varMap.has(v.dispatchId)) varMap.set(v.dispatchId, []);
      varMap.get(v.dispatchId)!.push(v);
    }
    const completionMap = new Map<string, any>();
    for (const c of allCompletions) completionMap.set(c.dispatchId, c);
    const bondsByLink = new Map<string, any>();
    for (const b of allBonds) {
      // Latest bond per link wins
      const existing = bondsByLink.get(b.linkId);
      if (!existing || new Date(b.createdAt!) > new Date(existing.createdAt)) {
        bondsByLink.set(b.linkId, b);
      }
    }

    res.json({
      dispatches: dispatches.map((d) => ({
        ...d,
        totalHours: d.totalHours / 10,
        links: (linkMap.get(d.id) || []).map((l) => ({ ...l, bond: bondsByLink.get(l.id) || null })),
        variations: varMap.get(d.id) || [],
        completion: completionMap.get(d.id) || null,
      })),
    });
  } catch (err) {
    console.error('[ContractorDispatch] admin list error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/admin/dispatch/:id
 * Single dispatch with full detail.
 */
contractorDispatchRouter.get('/api/admin/dispatch/:id', async (req, res) => {
  try {
    const dispatch = await findDispatch(req.params.id);
    if (!dispatch) return res.status(404).json({ error: 'Not found' });

    const links = await db.select().from(contractorJobLinks).where(eq(contractorJobLinks.dispatchId, dispatch.id));
    const variations = await db.select().from(dispatchVariations).where(eq(dispatchVariations.dispatchId, dispatch.id));
    const completion = (await db.select().from(dispatchCompletions).where(eq(dispatchCompletions.dispatchId, dispatch.id)).limit(1))[0] || null;

    res.json({
      dispatch: { ...dispatch, totalHours: dispatch.totalHours / 10 },
      links,
      variations,
      completion,
    });
  } catch (err) {
    console.error('[ContractorDispatch] admin detail error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DRAFT-FROM-QUOTE — pre-fills the admin "Generate Dispatch" form by reading
// a booked quote and running it through the revenue-share engine.
// ═══════════════════════════════════════════════════════════════════════════

// Auto-derived warning per category (mirrors scripts/dispatch-from-quote.ts)
const WARNINGS_BY_CATEGORY: Partial<Record<JobCategory, string>> = {
  electrical_minor: 'Isolate at consumer unit before any wiring. If existing wiring is unsuitable (no isolator, undersized cable) STOP and call Ben — do not bodge.',
  plumbing_minor: 'Isolate water at the under-sink valve before disconnecting. Test for drips with the tap on full for 30 seconds before leaving.',
  bathroom_fitting: 'Isolate water + electrics before starting. Photograph existing pipework before removing anything in case of reinstate.',
  kitchen_fitting: 'Isolate water + gas + electrics before starting. Confirm which appliances are live with the homeowner.',
  guttering: 'Working at height — ladder must be footed or use a tower if conditions require. Photograph downpipe outflow after clearing as proof.',
  pressure_washing: 'Working at height with electric tools — keep the customer + pets clear of the work area. Test surface before full pressure to avoid damage.',
  silicone_sealant: 'For bath/shower work, fill the bath with water during application — empties later as silicone cures with the joint compressed.',
  flooring: 'Confirm subfloor moisture content before laying. Damaged floorboards must be flagged before any new flooring goes down.',
  fencing: 'Check property line + neighbour agreement before posting. Photograph existing alignment.',
  lock_change: 'Confirm with customer before drilling out an old lock — destruction is sometimes the only way and they should know.',
  plastering: 'Mist before applying. Don\'t over-trowel — leave the finish slightly proud and let it set before final pass.',
  tiling: 'Check tile orientation with customer before adhesive goes down. Cuts must be planned for visible edges, not the visible faces.',
  door_fitting: 'Confirm hinge orientation + lock side with customer before fitting. Check for square — old frames are often out by 5mm+.',
  tv_mounting: 'Use a proper stud finder before drilling. Concealed cable routing must be done in safe zones — no diagonal runs.',
};

// Auto-derived materials per category (mirrors scripts/dispatch-from-quote.ts)
const MATERIALS_BY_CATEGORY: Partial<Record<JobCategory, string[]>> = {
  electrical_minor: ['Cable clips, wire connectors / Wagos', 'Sealant for ducting if needed', 'Hole saw if cutting'],
  plumbing_minor: ['PTFE tape', 'Compression olives & nuts', 'Silicone for sink/bath rim'],
  bathroom_fitting: ['Sanitary silicone', 'Plumber\'s mait', 'Wall plugs + screws', 'Spirit level'],
  kitchen_fitting: ['Worktop sealant', 'Cabinet screws', 'Shims', 'Edging strips'],
  general_fixing: ['Wood screws / dowels', 'Wall plugs (mixed)', 'Mastic for gaps'],
  silicone_sealant: ['Sanitary silicone (white) ×1', 'Silicone remover gel', 'Smoothing tool / spatula', 'IPA & cloths'],
  guttering: ['Mastic / gutter sealant', 'Trash bags for debris', 'Hand scoop, hose'],
  pressure_washing: ['Detergent (surface-appropriate)', 'Gloss-finish sealer if requested'],
  painting: ['Trade emulsion (white)', 'Mist coat / primer where bare', 'Roller sleeves & frames', 'Brushes 2" + cutting-in', 'Dust sheets, masking tape'],
  tiling: ['Trade grout (white)', 'Bathroom silicone', 'Tile adhesive', 'Spacers'],
  plastering: ['Bag of multi-finish', 'Mixing paddle', 'Hawk + trowel cleaning kit'],
  flooring: ['Underlay if needed', 'Trim / scotia', 'Adhesive / clicklock spacers'],
  fencing: ['Postcrete', 'Galvanised post fixings', 'Treatment for cuts'],
  lock_change: ['Spare cylinders if customer asks', 'Lubricant for new mechanism'],
  door_fitting: ['Hinges + screws (matching customer hardware)', 'Plane / chisel for adjustments', 'Wood filler for old screw holes'],
  curtain_blinds: ['Wall plugs', 'Brackets if not supplied', 'Spirit level'],
  shelving: ['Wall plugs (mixed)', 'Brackets if not supplied', 'Stud finder'],
  tv_mounting: ['Stud finder', 'Wall plugs', 'Spirit level', 'Cable management clips'],
  flat_pack: ['Allen keys', 'Cordless screwdriver', 'Spare screws'],
  furniture_repair: ['Wood glue', 'Clamps', 'Sandpaper'],
  waste_removal: ['Heavy-duty bags', 'Trolley / dolly'],
  garden_maintenance: ['Sharp shears', 'Edging tool', 'Refuse bags'],
  other: ['Standard kit', 'Specifics confirmed on arrival'],
};

async function findQuote(quoteId: string) {
  // Allow lookup by id or short_slug
  const byId = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
  if (byId[0]) return byId[0];
  const bySlug = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, quoteId)).limit(1);
  return bySlug[0] || null;
}

/**
 * GET /api/admin/dispatch/draft-from-quote/:quoteId
 *
 * Reads a booked quote (by id or short_slug) and returns a pre-filled dispatch
 * draft the admin form can render and edit. Also returns the contractor pool
 * to choose from. Pure read — no DB writes.
 */
contractorDispatchRouter.get('/api/admin/dispatch/draft-from-quote/:quoteId', async (req, res) => {
  try {
    const quote = await findQuote(req.params.quoteId);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    const lineItems = (quote.pricingLineItems as Array<{
      category?: string;
      description?: string;
      guardedPricePence?: number;
      materialsWithMarginPence?: number;
      timeEstimateMinutes?: number;
    }>) || [];

    // Filter lines that have category + time (engine requires both)
    const validLines = lineItems.filter((l) => l.category && l.timeEstimateMinutes);
    const skippedLines = lineItems.length - validLines.length;

    // Run engine with batch-discount applied to labour (matches CLI script)
    const discountFactor = quote.batchDiscountPercent ? 1 - Number(quote.batchDiscountPercent) / 100 : 1;
    const engineLines = validLines.map((l) => ({
      categorySlug: l.category as JobCategory,
      pricePence: Math.round((l.guardedPricePence || 0) * discountFactor) + (l.materialsWithMarginPence || 0),
      timeEstimateMinutes: l.timeEstimateMinutes || 60,
    }));

    const revShare = engineLines.length > 0
      ? calculateMultiLineRevenueShare(engineLines)
      : { totalContractorPay: 0, totalPlatformKeeps: 0, totalCustomerPrice: 0, overallMarginPercent: 0, lines: [], flags: [] };

    // Build tasks
    const tasks = revShare.lines.map((line, i) => {
      const original = validLines[i];
      const cat = line.categorySlug as JobCategory;
      const titleRaw = (original.description || cat).split(/[—.,;]/)[0].slice(0, 70).trim();
      return {
        num: i + 1,
        title: titleRaw,
        description: original.description || `${cat} work as scoped`,
        category: cat,
        tier: line.tier,
        hours: Number(line.hours.toFixed(2)),
        payPence: line.contractorPayPence,
        payMethod: line.payMethod,
        ...(WARNINGS_BY_CATEGORY[cat] ? { warning: WARNINGS_BY_CATEGORY[cat] as string } : {}),
        materials: MATERIALS_BY_CATEGORY[cat] || ['Standard kit', 'Specifics confirmed on arrival'],
      };
    });

    const totalContractorPay = revShare.totalContractorPay;
    const totalCustomer = revShare.totalCustomerPrice;
    const totalHours = revShare.lines.reduce((s, l) => s + l.hours, 0);
    const platformKeeps = totalCustomer - totalContractorPay;

    // Bond: 5% of contractor pay, clamped £20-£40, rounded to nearest £5
    let bondPence = Math.round(totalContractorPay * 0.05);
    if (bondPence < 2000) bondPence = 2000;
    if (bondPence > 4000) bondPence = 4000;
    bondPence = Math.round(bondPence / 500) * 500;

    // Title + subtitle defaults
    const titleBase = (quote.contextualHeadline || `${tasks.length}-task job`).trim();
    const subtitle = quote.address?.split(',').slice(-2, -1)[0]?.trim() || quote.postcode?.split(' ')[0] || null;

    const customerName = (quote.customerName || '').trim();
    const customerFirstName = customerName.split(' ')[0] || 'Customer';

    // Contractor pool — handyman_profiles JOIN users
    const profileRows = await db.select({
      id: handymanProfiles.id,
      businessName: handymanProfiles.businessName,
      whatsappNumber: handymanProfiles.whatsappNumber,
      userFirst: users.firstName,
      userLast: users.lastName,
      userPhone: users.phone,
    })
      .from(handymanProfiles)
      .leftJoin(users, eq(handymanProfiles.userId, users.id))
      .limit(50);

    const contractors = profileRows.map((p) => ({
      id: p.id,
      name: p.businessName
        || [p.userFirst, p.userLast].filter(Boolean).join(' ')
        || 'Contractor',
      phone: p.whatsappNumber || p.userPhone || null,
    }));

    res.json({
      quote: {
        id: quote.id,
        shortSlug: quote.shortSlug,
        customerName,
        customerFirstName,
        customerPhone: quote.phone || null,
        customerEmail: quote.email || null,
        customerAddress: quote.address || null,
        postcode: quote.postcode || '',
        contextualHeadline: quote.contextualHeadline || null,
        selectedDate: quote.selectedDate ? new Date(quote.selectedDate).toISOString() : null,
        selectedTierPricePence: quote.selectedTierPricePence || 0,
        depositPaidAt: quote.depositPaidAt ? new Date(quote.depositPaidAt).toISOString() : null,
      },
      draft: {
        title: titleBase,
        subtitle,
        scheduledDate: quote.selectedDate ? new Date(quote.selectedDate).toISOString() : null,
        bondRequired: true,
        bondAmountPence: bondPence,
        totalHours: Number(totalHours.toFixed(2)),
        totalContractorPayPence: totalContractorPay,
        customerRevenuePence: quote.selectedTierPricePence || totalCustomer,
        platformKeepsPence: platformKeeps,
        tasks,
        skippedLines,
      },
      contractors,
    });
  } catch (err) {
    console.error('[ContractorDispatch] draft-from-quote error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

/**
 * POST /api/admin/dispatch/:id/notify-whatsapp
 *
 * Pings each contractor link via WhatsApp. Currently a STUB — logs each
 * intended send to the console. Real Meta WhatsApp wiring (server/meta-whatsapp.ts)
 * can be added later without changing the call shape.
 *
 * Response: { ok: true, sent: N, attempted: N }
 */
contractorDispatchRouter.post('/api/admin/dispatch/:id/notify-whatsapp', async (req, res) => {
  try {
    const dispatch = await findDispatch(req.params.id);
    if (!dispatch) return res.status(404).json({ error: 'Dispatch not found' });

    const links = await db.select().from(contractorJobLinks)
      .where(eq(contractorJobLinks.dispatchId, dispatch.id));

    const baseUrl = (process.env.PUBLIC_BASE_URL || 'https://handyservices.app').replace(/\/$/, '');
    const ref = shortRef(dispatch.id);

    let sent = 0;
    for (const link of links) {
      const url = `${baseUrl}/contractor-job/${link.token}`;
      const phone = link.contractorPhone || '(no phone)';
      // STUB: real send goes here. Until then, log loudly so we can see it in CI/dev.
      console.log(
        `[ContractorDispatch] 📲 WhatsApp STUB — would send to ${phone} (${link.contractorName}): ` +
        `"New job ref #${ref} — ${dispatch.title}. Tap to view: ${url}"`,
      );
      sent++;
    }

    res.json({ ok: true, sent, attempted: links.length, ref });
  } catch (err) {
    console.error('[ContractorDispatch] notify-whatsapp error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default contractorDispatchRouter;
