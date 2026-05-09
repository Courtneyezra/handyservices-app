// server/notifications/recipients.ts
//
// Module 10 — Notifications: recipient resolution helpers.
//
// These helpers convert a domain id (quoteId, packId, unitId) into the
// `Recipient` shape the orchestrator expects. Modules call them from inside
// state-transition handlers so emit points stay one-liner-ish:
//
//     const { customer, contractor } = await recipientsForQuote(quoteId);
//     await notifyOnTransition(quoteId, fromState, toState, {
//         recipients: [customer, contractor].filter(isRecipient),
//         payload: { ... },
//     });
//
// A missing phone/email returns a Recipient with that field undefined —
// callers can still pass it to the orchestrator; the channel adapters will
// record a `failed` audit row (no_address) rather than throwing.
//
// Refs: docs/architecture/modules/10-notifications.md §recipient-defaults

import { db } from '../db';
import { eq, inArray } from 'drizzle-orm';
import {
    personalizedQuotes,
    handymanProfiles,
    users,
    dayPacks,
} from '../../shared/schema';
import type { Recipient } from './types';

/** Filter helper for use after a recipient lookup that may return null. */
export function isRecipient(r: Recipient | null | undefined): r is Recipient {
    return r !== null && r !== undefined;
}

// ---------------------------------------------------------------------------
// Quote-level recipients
// ---------------------------------------------------------------------------

export interface QuoteRecipients {
    customer: Recipient | null;
    contractor: Recipient | null;
}

/**
 * Resolve customer + (currently-assigned) contractor for a given quote.
 *
 * Customer comes from `personalized_quotes` directly. Contractor is the
 * unit currently routed to this booking — we look at the latest pending /
 * accepted routing_offer or, failing that, the locked job_dispatches row.
 * Callers that already know the unitId should prefer `recipientForUnit` to
 * skip the JOIN.
 */
export async function recipientsForQuote(quoteId: string): Promise<QuoteRecipients> {
    const [quote] = await db
        .select({
            id: personalizedQuotes.id,
            customerName: personalizedQuotes.customerName,
            phone: personalizedQuotes.phone,
            email: personalizedQuotes.email,
        })
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, quoteId))
        .limit(1);

    if (!quote) {
        return { customer: null, contractor: null };
    }

    const customer: Recipient = {
        type: 'customer',
        id: quote.id,
        name: quote.customerName ?? undefined,
        phone: quote.phone ?? undefined,
        email: quote.email ?? undefined,
    };

    return { customer, contractor: null };
}

// ---------------------------------------------------------------------------
// Pack-level recipients
// ---------------------------------------------------------------------------

export interface PackRecipients {
    contractor: Recipient | null;
    customers: Recipient[];
}

/**
 * Resolve the assigned Builder + every customer whose quote sits inside
 * the pack. Used for pack_offered / pack_accepted / pack_released fan-out.
 */
export async function recipientsForPack(packId: string): Promise<PackRecipients> {
    const [pack] = await db
        .select({
            id: dayPacks.id,
            unitId: dayPacks.unitId,
            jobIds: dayPacks.jobIds,
        })
        .from(dayPacks)
        .where(eq(dayPacks.id, packId))
        .limit(1);

    if (!pack) {
        return { contractor: null, customers: [] };
    }

    const contractor = await recipientForUnit(pack.unitId);

    const jobIds = Array.isArray(pack.jobIds) ? (pack.jobIds as string[]) : [];
    if (jobIds.length === 0) {
        return { contractor, customers: [] };
    }

    const quoteRows = await db
        .select({
            id: personalizedQuotes.id,
            customerName: personalizedQuotes.customerName,
            phone: personalizedQuotes.phone,
            email: personalizedQuotes.email,
        })
        .from(personalizedQuotes)
        .where(inArray(personalizedQuotes.id, jobIds));

    const customers: Recipient[] = quoteRows.map((q) => ({
        type: 'customer',
        id: q.id,
        name: q.customerName ?? undefined,
        phone: q.phone ?? undefined,
        email: q.email ?? undefined,
    }));

    return { contractor, customers };
}

// ---------------------------------------------------------------------------
// Unit (contractor) recipient
// ---------------------------------------------------------------------------

/**
 * Resolve a contractor `Recipient` from `handyman_profiles.id`. Phone /
 * email come from the linked `users` row (handyman_profiles.userId →
 * users.id). The whatsappNumber column on the profile takes precedence
 * over users.phone when set.
 */
export async function recipientForUnit(unitId: string): Promise<Recipient | null> {
    const [row] = await db
        .select({
            unitId: handymanProfiles.id,
            userId: handymanProfiles.userId,
            businessName: handymanProfiles.businessName,
            whatsappNumber: handymanProfiles.whatsappNumber,
            userFirstName: users.firstName,
            userPhone: users.phone,
            userEmail: users.email,
        })
        .from(handymanProfiles)
        .leftJoin(users, eq(users.id, handymanProfiles.userId))
        .where(eq(handymanProfiles.id, unitId))
        .limit(1);

    if (!row) return null;

    const phone = row.whatsappNumber ?? row.userPhone ?? undefined;
    // Prefer first name (warmer "Hi Mark," salutation); fall back to business name.
    const name = row.userFirstName ?? row.businessName ?? undefined;
    return {
        type: 'contractor',
        id: row.unitId,
        name: name ?? undefined,
        phone: phone ?? undefined,
        email: row.userEmail ?? undefined,
    };
}

// ---------------------------------------------------------------------------
// Admin recipient
// ---------------------------------------------------------------------------

/**
 * Static admin recipient for events that need an ops alert (pack_released,
 * check_in_no_show, pack_accepted ack, etc.). Email comes from the env var
 * `ADMIN_NOTIFICATION_EMAIL` falling back to `ops@handy.services`.
 */
export function adminRecipient(): Recipient {
    const email = process.env.ADMIN_NOTIFICATION_EMAIL ?? 'ops@handy.services';
    return {
        type: 'admin',
        id: 'admin',
        email,
    };
}
