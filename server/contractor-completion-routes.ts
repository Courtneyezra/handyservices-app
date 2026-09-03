/**
 * P15 part 4 — the close, on its own router so the three P15 panes never touch the same file.
 *
 *   GET  /api/contractor-completion/:token/jobs/:bookingId/plan
 *        What the pack says to photograph (one before + one after per task, named by the line's
 *        title), the materials he was told to buy, and what they were expected to cost. The
 *        completion sheet asks for this the moment it opens; a job with no pack gets an empty
 *        plan and the old "at least one photo" rule still applies.
 *
 *   POST /api/contractor-completion/:token/jobs/:bookingId/materials
 *        The materials claim: receipt photo URLs + the total actually spent. Compares against the
 *        pack, writes the claim to the job (and to job_material_expenses where that table exists),
 *        and pushes Ben only when the variance is material. NOT a gate — no claim, no flag.
 *
 *   POST /api/contractor-completion/:token/jobs/:bookingId/receipt
 *        A receipt photo, same shape as the completion photo endpoint (base64 data URL in, public
 *        URL out), stored under `receipts/` rather than `completion/`.
 *
 * The gate itself lives on the existing completion endpoint (`/api/contractor-app/:token/jobs/
 * :bookingId/complete`) because that is where a job actually closes; this router owns everything
 * around it. The token is the credential, exactly as the rest of the contractor app.
 */
import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { contractorBookingRequests, handymanProfiles, personalizedQuotes } from '../shared/schema';
import { storageService } from './storage';
import { completionGate, type CompletionInput } from '../shared/completion-gate';
import {
    expectedMaterialsPence,
    materialsListFromPack,
    packOrNull,
    photoPlanFromPack,
    recordMaterialsClaim,
} from './spine/job-pack-completion';

const router = Router();

/** The contractor behind the token, or null. Same rule as the contractor app's own router. */
async function contractorForToken(token: string) {
    if (!token || token.length < 16) return null;
    const [row] = await db
        .select({ id: handymanProfiles.id, userId: handymanProfiles.userId })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.appToken, token))
        .limit(1);
    return row ?? null;
}

interface OwnedBooking {
    profile: { id: string; userId: string };
    booking: { id: string; quoteId: string | null };
}
type OwnedResult = { error: 404 | 403; message: string } | OwnedBooking;

/** The booking, only when it belongs to this contractor. The token is the credential. */
async function ownedBooking(token: string, bookingId: string): Promise<OwnedResult> {
    const profile = await contractorForToken(token);
    if (!profile) return { error: 404, message: 'Link not recognised' };
    const [booking] = await db
        .select({
            id: contractorBookingRequests.id,
            quoteId: contractorBookingRequests.quoteId,
            contractorId: contractorBookingRequests.contractorId,
            assignedContractorId: contractorBookingRequests.assignedContractorId,
        })
        .from(contractorBookingRequests)
        .where(eq(contractorBookingRequests.id, bookingId))
        .limit(1);
    if (!booking || (booking.assignedContractorId ?? booking.contractorId) !== profile.id) return { error: 403, message: 'Not your job' };
    return { profile: { id: profile.id, userId: profile.userId }, booking: { id: booking.id, quoteId: booking.quoteId ?? null } };
}

// GET /:token/jobs/:bookingId/plan — what to photograph, what to buy, what it should cost.
router.get('/:token/jobs/:bookingId/plan', async (req: Request, res: Response) => {
    try {
        const owned = await ownedBooking(req.params.token, req.params.bookingId);
        if ('error' in owned) return res.status(owned.error).json({ error: owned.message });

        const pack = owned.booking.quoteId ? await packOrNull(owned.booking.quoteId).catch(() => null) : null;
        const expected = expectedMaterialsPence(pack);
        res.json({
            tasks: photoPlanFromPack(pack),
            materials: materialsListFromPack(pack),
            expectedMaterialsPence: expected.pence,
            expectedBasis: expected.basis,
            hasPack: !!pack,
        });
    } catch (err: any) {
        console.error('[ContractorCompletion] plan failed:', err?.message);
        res.status(500).json({ error: 'Could not load the job pack' });
    }
});

// POST /:token/jobs/:bookingId/receipt — a receipt photo (base64 data URL in, public URL out).
router.post('/:token/jobs/:bookingId/receipt', async (req: Request, res: Response) => {
    try {
        const owned = await ownedBooking(req.params.token, req.params.bookingId);
        if ('error' in owned) return res.status(owned.error).json({ error: owned.message });

        const m = String(req.body?.dataUrl ?? '').match(/^data:(image\/\w+);base64,(.+)$/);
        if (!m) return res.status(400).json({ error: 'Invalid image' });
        const buffer = Buffer.from(m[2], 'base64');
        if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image too large' });
        const key = `receipts/${req.params.bookingId}/${uuidv4()}.${(m[1].split('/')[1] || 'jpg')}`;
        const url = await storageService.uploadPublicImage(buffer, key, m[1]);
        res.json({ url });
    } catch (err: any) {
        console.error('[ContractorCompletion] receipt upload failed:', err?.message);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// POST /:token/jobs/:bookingId/materials — the claim. { claimedPence, receiptUrls[], note? }
router.post('/:token/jobs/:bookingId/materials', async (req: Request, res: Response) => {
    try {
        const owned = await ownedBooking(req.params.token, req.params.bookingId);
        if ('error' in owned) return res.status(owned.error).json({ error: owned.message });

        const claimedPence = Math.round(Number(req.body?.claimedPence));
        if (!Number.isFinite(claimedPence) || claimedPence <= 0) return res.status(400).json({ error: 'Enter what you spent' });
        if (claimedPence > 500_000) return res.status(400).json({ error: 'That total looks wrong — ring the office' });
        const receiptUrls: string[] = Array.isArray(req.body?.receiptUrls) ? req.body.receiptUrls.filter((u: any) => typeof u === 'string').slice(0, 8) : [];
        const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : null;

        let customerName: string | null = null;
        if (owned.booking.quoteId) {
            const [q] = await db.select({ customerName: personalizedQuotes.customerName }).from(personalizedQuotes).where(eq(personalizedQuotes.id, owned.booking.quoteId)).limit(1);
            customerName = q?.customerName ?? null;
        }

        const result = await recordMaterialsClaim({
            bookingId: owned.booking.id,
            quoteId: owned.booking.quoteId,
            contractorId: owned.profile.id,
            customerName,
            claimedPence,
            receiptUrls,
            note,
        });

        res.json({
            success: true,
            claimedPence: result.variance.claimedPence,
            expectedPence: result.variance.expectedPence,
            variancePence: result.variance.variancePence,
            flagged: result.flagged,
            // The contractor is told plainly that the office will look — never a silent report.
            message: result.flagged ? 'Logged. The office will check this one against the quote.' : 'Logged against the job.',
        });
    } catch (err: any) {
        console.error('[ContractorCompletion] materials claim failed:', err?.message);
        res.status(500).json({ error: 'Could not record the claim' });
    }
});

/**
 * The gate, for the existing completion endpoint to call. Exported here (rather than inlined
 * there) so the whole of P15 part 4 stays in files this pane owns: the edit at the call site is
 * two lines.
 */
export async function gateCompletion(input: { quoteId: string | null | undefined; body: CompletionInput }) {
    const pack = input.quoteId ? await packOrNull(input.quoteId).catch(() => null) : null;
    return completionGate(photoPlanFromPack(pack), input.body);
}

export default router;
