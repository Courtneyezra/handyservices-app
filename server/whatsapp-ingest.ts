/**
 * Shared inbound-ingest helpers — used by BOTH production message webhooks:
 *
 *   - Twilio (WhatsApp + SMS):  conversation-engine.ts handleInboundMessage
 *   - Meta Cloud API:           meta-whatsapp.ts handleIncomingMessage
 *
 * History (Switchboard Atlas step 3, 24 Aug 2026): this file used to hold a full
 * `ingestWhatsAppMessage` pipeline whose only caller was the Chrome-extension ingest
 * endpoint — which meant the extension path was the ONLY inbound surface doing
 * contractor role-forking and lead auto-creation, while the two production webhooks
 * did neither. The extension is deleted; the behaviours it pioneered were harvested
 * into these helpers and wired into both webhooks.
 *
 * Responsibilities:
 *   resolveInboundRole()        — which lane is this number (customer / contractor / …)?
 *                                 A contractor texting the business line must not become
 *                                 a customer lead or get the customer agent.
 *   linkOrCreateLeadForInbound() — first-time customer inbound creates (or links) a
 *                                 `leads` row and points conversations.leadId at it,
 *                                 so WhatsApp enquiries stop going missing from the Kanban.
 */

import { db } from './db';
import { conversations, leads } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhoneNumber } from './phone-utils';
import { broadcast } from './meta-whatsapp';
import { resolveRole, type RoleProfile } from './roles';

/**
 * Convert a raw phone to E.164 ("+447xxxxxxxxx") for the `leads.phone` column,
 * which is indexed/queried in that format.
 */
function toLeadPhone(raw: string): string {
    const stripped = raw.replace(/@[cg]\.us$/, '').trim();
    return normalizePhoneNumber(stripped) || stripped;
}

/**
 * Which lane is this number? Thin wrapper so webhook code has one import and the
 * role module stays swappable. Never throws — an unresolvable number is a customer
 * (the safe default: a contractor misfiled as a customer is visible on the board;
 * a customer misfiled as a contractor silently loses the lead machinery).
 */
export async function resolveInboundRole(rawPhone: string): Promise<RoleProfile> {
    try {
        return await resolveRole(rawPhone);
    } catch (e: any) {
        console.warn('[wa-ingest] resolveRole failed, defaulting to customer:', e?.message ?? e);
        return 'customer';
    }
}

/**
 * First-time CUSTOMER inbound → find-or-create the lead and link the thread to it.
 *
 * - No-op unless the conversation has no leadId yet (repeat customers keep their thread's
 *   current lead; repointing happens where a new job is actually opened, not here).
 * - Matches an existing lead by E.164 phone before creating, so a caller-then-texter
 *   doesn't get two leads.
 * - Never throws: lead bookkeeping must not take down message ingest.
 */
export async function linkOrCreateLeadForInbound(opts: {
    conversationId: string;
    currentLeadId?: string | null;
    rawPhone: string;
    contactName?: string | null;
    content?: string | null;
    /** for logging + leads.source */
    source: string;
}): Promise<{ leadId: string | null; leadWasCreated: boolean }> {
    const { conversationId, currentLeadId, rawPhone, contactName, content, source } = opts;
    if (currentLeadId) return { leadId: currentLeadId, leadWasCreated: false };

    try {
        const leadPhone = toLeadPhone(rawPhone);
        const now = new Date();

        let leadId: string;
        let leadWasCreated = false;

        const existingLead = await db.query.leads.findFirst({
            where: eq(leads.phone, leadPhone),
            columns: { id: true },
        });

        if (existingLead) {
            leadId = existingLead.id;
        } else {
            leadId = uuidv4();
            await db.insert(leads).values({
                id: leadId,
                customerName: contactName || 'WhatsApp Lead',
                phone: leadPhone,
                jobDescription: content ? content.substring(0, 500) : null,
                status: 'new',
                source: 'whatsapp',
                stage: 'new',
                stageUpdatedAt: now,
            } as any);
            leadWasCreated = true;
            console.log(`[wa-ingest:${source}] AUTO-CREATED LEAD ${leadId} for ${leadPhone} (${contactName || 'no name'})`);
        }

        await db.update(conversations).set({ leadId }).where(eq(conversations.id, conversationId));

        if (leadWasCreated) {
            try {
                broadcast('lead:created', { leadId, phone: leadPhone, source: 'whatsapp', stage: 'new' });
            } catch { /* broadcast is best-effort */ }
        }

        return { leadId, leadWasCreated };
    } catch (e: any) {
        console.error(`[wa-ingest:${source}] lead link/create failed (non-fatal):`, e?.message ?? e);
        return { leadId: currentLeadId ?? null, leadWasCreated: false };
    }
}
