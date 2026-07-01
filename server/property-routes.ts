import { Router } from 'express';
import { db } from './db';
import {
    serviceProperties,
    personalizedQuotes,
    contractorBookingRequests,
    invoices,
} from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

// ============================================================================
// PROPERTY EDIT ROUTES (Jobber's Property — WHERE the work happens).
//
// The property identity (`dedupe_key`) is DERIVED and is the join key both the
// backfill and the live write paths resolve against (see server/properties.ts).
// Therefore admin edits here must NEVER recompute or touch `dedupe_key`:
//   - nickname / notes / accessNotes      → free-text, safe to edit
//   - address / postcode                  → DISPLAY corrections only; we set
//     `address_manual=true` so the resolve-enrich COALESCE never drifts it back
//   - coordinates / dedupe_key / client_key → NOT editable here
//
// Merge folds a redundant property (dupe from the heuristic key) into a
// canonical one: repoint quotes/jobs/invoices, then delete the loser.
// ============================================================================

export const propertyRouter = Router();

// GET /api/properties/:id — one property + its linked-work counts.
propertyRouter.get('/api/properties/:id', async (req, res) => {
    try {
        const [prop] = await db.select().from(serviceProperties)
            .where(eq(serviceProperties.id, req.params.id)).limit(1);
        if (!prop) return res.status(404).json({ error: 'Property not found' });

        const countOf = async (tbl: any, col: any) => {
            const r = await db.select({ n: sql<number>`count(*)` }).from(tbl).where(eq(col, prop.id));
            return Number(r[0]?.n ?? 0);
        };
        const [quotes, jobs, invs] = await Promise.all([
            countOf(personalizedQuotes, personalizedQuotes.propertyId),
            countOf(contractorBookingRequests, contractorBookingRequests.propertyId),
            countOf(invoices, invoices.propertyId),
        ]);
        res.json({ ...prop, counts: { quotes, jobs, invoices: invs } });
    } catch (error: any) {
        console.error('[Property] GET error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch property' });
    }
});

// PATCH /api/properties/:id — edit safe display/notes fields only.
propertyRouter.patch('/api/properties/:id', async (req, res) => {
    try {
        const { nickname, notes, accessNotes, address, postcode } = req.body ?? {};

        const updates: Record<string, any> = { updatedAt: new Date() };
        if (nickname !== undefined) updates.nickname = nickname === '' ? null : nickname;
        if (notes !== undefined) updates.notes = notes === '' ? null : notes;
        if (accessNotes !== undefined) updates.accessNotes = accessNotes === '' ? null : accessNotes;

        // Address/postcode are display corrections — flag manual so resolve-enrich
        // (COALESCE on null) can't later overwrite the human-entered value, and the
        // dedupe_key is deliberately left untouched so history still resolves here.
        if (address !== undefined) {
            updates.address = address === '' ? null : address;
            updates.addressManual = true;
        }
        if (postcode !== undefined) {
            const pc = (postcode ?? '').toString().trim().slice(0, 10);
            updates.postcode = pc === '' ? null : pc;
            updates.addressManual = true;
        }

        if (Object.keys(updates).length === 1) {
            return res.status(400).json({ error: 'No editable fields supplied' });
        }

        const [updated] = await db.update(serviceProperties)
            .set(updates)
            .where(eq(serviceProperties.id, req.params.id))
            .returning();

        if (!updated) return res.status(404).json({ error: 'Property not found' });
        res.json(updated);
    } catch (error: any) {
        console.error('[Property] PATCH error:', error);
        res.status(500).json({ error: error.message || 'Failed to update property' });
    }
});

// POST /api/properties/:id/merge { intoId } — fold this property INTO intoId.
// Repoints all linked quotes/jobs/invoices to the canonical property, copies any
// notes the canonical row is missing, then deletes the now-empty duplicate.
propertyRouter.post('/api/properties/:id/merge', async (req, res) => {
    try {
        const loserId = req.params.id;
        const intoId = (req.body?.intoId ?? '').toString();
        if (!intoId) return res.status(400).json({ error: 'intoId is required' });
        if (intoId === loserId) return res.status(400).json({ error: 'Cannot merge a property into itself' });

        const result = await db.transaction(async (tx) => {
            const [loser] = await tx.select().from(serviceProperties).where(eq(serviceProperties.id, loserId)).limit(1);
            const [winner] = await tx.select().from(serviceProperties).where(eq(serviceProperties.id, intoId)).limit(1);
            if (!loser) return { error: 'Source property not found' as const };
            if (!winner) return { error: 'Target (intoId) property not found' as const };

            const repoint = async (tbl: any, col: any) => {
                const r: any = await tx.update(tbl).set({ propertyId: intoId }).where(eq(col, loserId));
                return r.rowCount ?? 0;
            };
            const q = await repoint(personalizedQuotes, personalizedQuotes.propertyId);
            const j = await repoint(contractorBookingRequests, contractorBookingRequests.propertyId);
            const i = await repoint(invoices, invoices.propertyId);

            // Enrich the winner with anything it's missing from the loser.
            await tx.update(serviceProperties).set({
                address: winner.address ?? loser.address,
                postcode: winner.postcode ?? loser.postcode,
                coordinates: winner.coordinates ?? loser.coordinates,
                clientKey: winner.clientKey ?? loser.clientKey,
                nickname: winner.nickname ?? loser.nickname,
                notes: winner.notes ?? loser.notes,
                accessNotes: winner.accessNotes ?? loser.accessNotes,
                updatedAt: new Date(),
            }).where(eq(serviceProperties.id, intoId));

            await tx.delete(serviceProperties).where(eq(serviceProperties.id, loserId));
            return { repointed: { quotes: q, jobs: j, invoices: i } };
        });

        if ('error' in result) return res.status(404).json({ error: result.error });
        res.json({ success: true, mergedInto: intoId, ...result });
    } catch (error: any) {
        console.error('[Property] merge error:', error);
        res.status(500).json({ error: error.message || 'Failed to merge property' });
    }
});

export default propertyRouter;
