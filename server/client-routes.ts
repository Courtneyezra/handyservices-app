import { Router } from 'express';
import { db } from './db';
import {
    serviceClients,
    serviceProperties,
    leads,
    personalizedQuotes,
    contractorBookingRequests,
    invoices,
} from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

// ============================================================================
// CLIENT EDIT ROUTES (Jobber's Client — WHO pays / is billed).
//
// A client's identity (`dedupe_key`) is DERIVED from the canonical contact and
// is the join key both the backfill and the live write paths resolve against
// (see server/clients.ts). Therefore admin edits here must NEVER recompute or
// touch `dedupe_key`:
//   - displayName / notes / billingAddress    → free-text, safe to edit
//   - primaryPhone / primaryEmail             → DISPLAY/primary-contact
//     corrections only; the value is also folded into the phones/emails arrays
//     so nothing is lost, but the dedupe_key stays put so history still
//     resolves to this client.
//   - dedupe_key                              → NOT editable here
//
// Merge folds a redundant client (a dupe from the old raw-digits heuristic, or
// two real records for the same person) into a canonical one: repoint
// leads/quotes/jobs/invoices/properties, enrich the winner, delete the loser.
// ============================================================================

export const clientRouter = Router();

// Fold a new value into a jsonb string-array column without duplicating.
function pushUnique(arr: unknown, value?: string | null): string[] {
    const list = Array.isArray(arr) ? (arr as string[]).filter((x) => typeof x === 'string') : [];
    if (value && !list.includes(value)) list.push(value);
    return list;
}

// GET /api/clients/by-id/:id — one client + its linked-work counts.
// (Distinct path from the aggregation router's GET /api/clients/:clientKey.)
clientRouter.get('/api/clients/by-id/:id', async (req, res) => {
    try {
        const [client] = await db.select().from(serviceClients)
            .where(eq(serviceClients.id, req.params.id)).limit(1);
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const countOf = async (tbl: any, col: any) => {
            const r = await db.select({ n: sql<number>`count(*)` }).from(tbl).where(eq(col, client.id));
            return Number(r[0]?.n ?? 0);
        };
        const [leadCount, quotes, jobs, invs, props] = await Promise.all([
            countOf(leads, leads.clientId),
            countOf(personalizedQuotes, personalizedQuotes.clientId),
            countOf(contractorBookingRequests, contractorBookingRequests.clientId),
            countOf(invoices, invoices.clientId),
            countOf(serviceProperties, serviceProperties.clientId),
        ]);
        res.json({ ...client, counts: { leads: leadCount, quotes, jobs, invoices: invs, properties: props } });
    } catch (error: any) {
        console.error('[Client] GET error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch client' });
    }
});

// PATCH /api/clients/:id — edit safe display/contact/notes fields only.
clientRouter.patch('/api/clients/:id', async (req, res) => {
    try {
        const { displayName, primaryPhone, primaryEmail, billingAddress, notes } = req.body ?? {};

        const [existing] = await db.select().from(serviceClients)
            .where(eq(serviceClients.id, req.params.id)).limit(1);
        if (!existing) return res.status(404).json({ error: 'Client not found' });

        const updates: Record<string, any> = { updatedAt: new Date() };
        if (displayName !== undefined) updates.displayName = displayName === '' ? null : displayName;
        if (notes !== undefined) updates.notes = notes === '' ? null : notes;
        if (billingAddress !== undefined) updates.billingAddress = billingAddress === '' ? null : billingAddress;

        // Primary phone/email are display/primary-contact corrections. We update
        // the primary field AND fold the value into the phones/emails arrays so no
        // contact is ever lost. dedupe_key is deliberately NOT recomputed so
        // history still resolves to this client.
        if (primaryPhone !== undefined) {
            const v = primaryPhone === '' ? null : String(primaryPhone).trim();
            updates.primaryPhone = v;
            updates.phones = pushUnique(existing.phones, v);
        }
        if (primaryEmail !== undefined) {
            const v = primaryEmail === '' ? null : String(primaryEmail).trim().toLowerCase();
            updates.primaryEmail = v;
            updates.emails = pushUnique(existing.emails, v);
        }

        if (Object.keys(updates).length === 1) {
            return res.status(400).json({ error: 'No editable fields supplied' });
        }

        const [updated] = await db.update(serviceClients)
            .set(updates)
            .where(eq(serviceClients.id, req.params.id))
            .returning();

        res.json(updated);
    } catch (error: any) {
        console.error('[Client] PATCH error:', error);
        res.status(500).json({ error: error.message || 'Failed to update client' });
    }
});

// POST /api/clients/:id/archive { archived?: boolean } — soft archive/unarchive.
clientRouter.post('/api/clients/:id/archive', async (req, res) => {
    try {
        const archived = req.body?.archived !== false; // default true
        const [updated] = await db.update(serviceClients)
            .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
            .where(eq(serviceClients.id, req.params.id))
            .returning();
        if (!updated) return res.status(404).json({ error: 'Client not found' });
        res.json(updated);
    } catch (error: any) {
        console.error('[Client] archive error:', error);
        res.status(500).json({ error: error.message || 'Failed to archive client' });
    }
});

// POST /api/clients/:id/merge { intoId } — fold this client INTO intoId.
// Repoints all linked leads/quotes/jobs/invoices/properties to the canonical
// client, copies any contact the canonical row is missing, then deletes the
// now-empty duplicate.
clientRouter.post('/api/clients/:id/merge', async (req, res) => {
    try {
        const loserId = req.params.id;
        const intoId = (req.body?.intoId ?? '').toString();
        if (!intoId) return res.status(400).json({ error: 'intoId is required' });
        if (intoId === loserId) return res.status(400).json({ error: 'Cannot merge a client into itself' });

        const result = await db.transaction(async (tx) => {
            const [loser] = await tx.select().from(serviceClients).where(eq(serviceClients.id, loserId)).limit(1);
            const [winner] = await tx.select().from(serviceClients).where(eq(serviceClients.id, intoId)).limit(1);
            if (!loser) return { error: 'Source client not found' as const };
            if (!winner) return { error: 'Target (intoId) client not found' as const };

            const repoint = async (tbl: any, col: any) => {
                const r: any = await tx.update(tbl).set({ clientId: intoId }).where(eq(col, loserId));
                return r.rowCount ?? 0;
            };
            const l = await repoint(leads, leads.clientId);
            const q = await repoint(personalizedQuotes, personalizedQuotes.clientId);
            const j = await repoint(contractorBookingRequests, contractorBookingRequests.clientId);
            const i = await repoint(invoices, invoices.clientId);
            const p = await repoint(serviceProperties, serviceProperties.clientId);

            // Enrich the winner with anything it's missing from the loser, and
            // union the phones/emails arrays so no contact is lost.
            const mergedPhones = Array.from(new Set([
                ...(Array.isArray(winner.phones) ? winner.phones as string[] : []),
                ...(Array.isArray(loser.phones) ? loser.phones as string[] : []),
            ]));
            const mergedEmails = Array.from(new Set([
                ...(Array.isArray(winner.emails) ? winner.emails as string[] : []),
                ...(Array.isArray(loser.emails) ? loser.emails as string[] : []),
            ]));
            await tx.update(serviceClients).set({
                displayName: winner.displayName ?? loser.displayName,
                primaryPhone: winner.primaryPhone ?? loser.primaryPhone,
                primaryEmail: winner.primaryEmail ?? loser.primaryEmail,
                billingAddress: winner.billingAddress ?? loser.billingAddress,
                notes: winner.notes ?? loser.notes,
                phones: mergedPhones,
                emails: mergedEmails,
                updatedAt: new Date(),
            }).where(eq(serviceClients.id, intoId));

            await tx.delete(serviceClients).where(eq(serviceClients.id, loserId));
            return { repointed: { leads: l, quotes: q, jobs: j, invoices: i, properties: p } };
        });

        if ('error' in result) return res.status(404).json({ error: result.error });
        res.json({ success: true, mergedInto: intoId, ...result });
    } catch (error: any) {
        console.error('[Client] merge error:', error);
        res.status(500).json({ error: error.message || 'Failed to merge client' });
    }
});

export default clientRouter;
