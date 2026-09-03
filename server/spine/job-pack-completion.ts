/**
 * P15 part 4 — the close: what to photograph, what the materials should have cost, and where the
 * evidence goes once the customer has signed.
 *
 *   photoPlanFromPack      the pack's lines become the photo plan — one before and one after per
 *                          task, named by the line's title, so the contractor is told what to
 *                          photograph instead of guessing what "photos of the finished work" means
 *   expectedMaterialsPence what the pack said the materials for this job would cost
 *   completionFiling       pure: from the sign-off + leftover report, the access notes to file,
 *                          the thread note to write and the lines to append to the job
 *   fileCompletion         the writes: pack `job.accessNotes`, the property's access notes (the
 *                          customer record — it flows onto every future job sheet at that address),
 *                          a note on the thread, and the report on the booking
 *   recordMaterialsClaim   the claim: the receipt, the total, the variance, and Ben's push when it
 *                          matters. No claim, no flag.
 *
 * Pure at the top, the reads and writes at the bottom, same as the rest of the pack modules. Every
 * write here is best-effort by contract: a job that is finished, signed for and photographed must
 * close even if the property record, the thread or the push is having a bad day. Nothing in this
 * file can refuse a completion — the refusing is `completionGate`'s job, and it runs first.
 */
import {
    materialsVariance,
    type LeftoverReport,
    type PhotoTask,
    type SignOff,
    type VarianceResult,
} from '@shared/completion-gate';
import type { JobPack, PackLine } from './job-pack';

// ---------------------------------------------------------------- pure

/**
 * Pure: the photo plan. One entry per pack line, in the pack's order. A line with no title still
 * gets an entry (the lineId is the fallback) — the plan must never silently drop a task, or the
 * gate would let a job close with a room nobody photographed.
 */
export function photoPlanFromPack(pack: Pick<JobPack, 'lines'> | null | undefined): PhotoTask[] {
    return (pack?.lines ?? []).map((l, i) => ({ lineId: l.lineId, title: (l.title ?? '').trim() || `Task ${i + 1}` }));
}

/**
 * Pure: what the pack said the materials would cost.
 *
 * The baseline is the SUPPLIER COST the estimator and Ben put on the pack's material rows
 * (`unitPricePence × qty`) — dispatch calls the same figure `materialsCostPence` and describes it
 * as "the contractor's spend on our card", which is precisely what a receipt claim is measured
 * against. When a pack carries no priced material rows we fall back to the line's
 * `materialsPence`: materials AT MARGIN, the figure the customer was charged and the same
 * allowance the contractor already sees on My Week. It is the wrong side of the markup, so it is
 * only ever the fallback, and it is generous to the contractor rather than accusing.
 */
export function expectedMaterialsPence(pack: Pick<JobPack, 'lines'> | null | undefined): { pence: number; basis: 'cost' | 'margin' | 'none' } {
    const lines: PackLine[] = pack?.lines ?? [];
    let cost = 0;
    for (const l of lines) for (const m of l.materials) if (m.unitPricePence != null) cost += m.unitPricePence * Math.max(1, m.qty);
    if (cost > 0) return { pence: cost, basis: 'cost' };
    const margin = lines.reduce((s, l) => s + (l.materialsPence ?? 0), 0);
    if (margin > 0) return { pence: margin, basis: 'margin' };
    return { pence: 0, basis: 'none' };
}

/** Pure: the materials the contractor was told to buy, flat, for the claim screen. */
export function materialsListFromPack(pack: Pick<JobPack, 'lines'> | null | undefined): Array<{ lineId: string; name: string; qty: number; supplier: string | null; size: string | null; unitPricePence: number | null }> {
    return (pack?.lines ?? []).flatMap((l) => l.materials.map((m) => ({ lineId: l.lineId, name: m.name, qty: m.qty, supplier: m.supplier, size: m.size, unitPricePence: m.unitPricePence })));
}

const clean = (v: unknown, max = 400): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export interface CompletionFiling {
    /** Lines to add to `job_packs.job.accessNotes` and the property record. Empty when he had none. */
    accessNotes: string[];
    /** The note that goes on the thread, in plain words. */
    threadNote: string;
    /** What is appended to the booking's completion notes — the durable copy. */
    jobNote: string;
    /** True when the customer said it is not right: Ben hears about this one. */
    unhappy: boolean;
}

/**
 * Pure: everything the close leaves behind. `dateWords` is passed in so this stays testable and
 * timezone-free.
 */
export function completionFiling(input: { signOff: SignOff; leftover: LeftoverReport | null | undefined; contractorName?: string | null; dateWords?: string | null }): CompletionFiling {
    const who = clean(input.contractorName, 40) || 'The contractor';
    const unhappy = input.signOff.verdict === 'not_happy';
    const reason = clean(input.signOff.reason);
    const signer = clean(input.signOff.name, 60);

    const verdictWords = unhappy
        ? `signed off as NOT happy${reason ? `: "${reason}"` : ''}`
        : 'signed off as happy with the work';
    const threadNote = `Job signed off on site${input.dateWords ? ` (${input.dateWords})` : ''}. ${signer ? `${signer} ` : 'The customer '}${verdictWords}.`;

    const snags = clean(input.leftover?.snags);
    const extras = clean(input.leftover?.extras);
    const access = clean(input.leftover?.accessNotes, 240);

    const jobLines = [`✍️ Sign-off: ${unhappy ? `NOT HAPPY${reason ? ` — ${reason}` : ''}` : 'happy'}${signer ? ` (${signer})` : ''}`];
    if (snags) jobLines.push(`🔧 Snags: ${snags}`);
    if (extras) jobLines.push(`👀 Spotted: ${extras}`);
    if (access) jobLines.push(`🔑 Access next time: ${access}`);
    if (!snags && !extras && !access) jobLines.push(`✅ Leftover report: nothing to report (${who})`);

    return { accessNotes: access ? [access] : [], threadNote, jobNote: jobLines.join('\n'), unhappy };
}

/** Pure: the property's access notes with this one appended, de-duplicated. Null = nothing to write. */
export function mergeAccessNotes(existing: string | null | undefined, additions: string[]): string | null {
    const add = additions.map((a) => clean(a, 240)).filter(Boolean);
    if (!add.length) return null;
    const current = String(existing ?? '').trim();
    const have = current.toLowerCase();
    const fresh = add.filter((a) => !have.includes(a.toLowerCase()));
    if (!fresh.length) return null;
    return current ? `${current}\n${fresh.join('\n')}` : fresh.join('\n');
}

// ---------------------------------------------------------------- the writes

/** Deps so every write above is testable without a database. */
export interface CompletionDeps {
    pack: (quoteId: string) => Promise<JobPack | null>;
    fileAccessNotes: (quoteId: string, notes: string[]) => Promise<void>;
    propertyAccessNotes: (quoteId: string, notes: string[]) => Promise<void>;
    threadNote: (quoteId: string, note: string) => Promise<void>;
    appendJobNote: (bookingId: string, note: string) => Promise<void>;
    alertUnhappy: (input: { quoteId: string; bookingId: string; note: string }) => Promise<void>;
    log: (e: { kind: 'other' | 'escalation'; summary: string; detail?: Record<string, unknown>; source: string }) => Promise<void>;
}

export interface FileCompletionInput {
    bookingId: string;
    quoteId: string | null;
    signOff: SignOff;
    leftover: LeftoverReport | null | undefined;
    contractorName?: string | null;
    dateWords?: string | null;
}

/**
 * File the sign-off and the leftover report. NEVER throws: the job is already done and the row is
 * already marked complete by the time this runs, so a failure here is a bookkeeping gap, not a
 * reason to tell a contractor standing in someone's hallway that his job did not close.
 */
export async function fileCompletion(input: FileCompletionInput, deps?: CompletionDeps): Promise<CompletionFiling> {
    const filing = completionFiling(input);
    const d = deps ?? liveCompletionDeps();
    const safely = async (what: string, run: () => Promise<void>) => {
        try { await run(); } catch (e: any) { console.warn(`[JobPackCompletion] ${what} failed:`, e?.message ?? e); }
    };

    await safely('append job note', () => d.appendJobNote(input.bookingId, filing.jobNote));
    if (input.quoteId) {
        if (filing.accessNotes.length) {
            await safely('file access notes onto the pack', () => d.fileAccessNotes(input.quoteId!, filing.accessNotes));
            await safely('file access notes onto the property', () => d.propertyAccessNotes(input.quoteId!, filing.accessNotes));
        }
        await safely('write the thread note', () => d.threadNote(input.quoteId!, filing.threadNote));
    }
    if (filing.unhappy) {
        await safely('alert Ben to an unhappy sign-off', () => d.alertUnhappy({ quoteId: input.quoteId ?? '', bookingId: input.bookingId, note: filing.jobNote }));
    }
    await safely('log', () => d.log({
        kind: filing.unhappy ? 'escalation' : 'other',
        source: 'job-pack-completion',
        summary: `job closed: ${filing.unhappy ? 'NOT HAPPY sign-off' : 'happy sign-off'}${filing.accessNotes.length ? ', access note filed' : ''}`,
        detail: { bookingId: input.bookingId, quoteId: input.quoteId, accessNotes: filing.accessNotes },
    }));
    return filing;
}

export interface ClaimDeps {
    pack: (quoteId: string) => Promise<JobPack | null>;
    saveExpense: (input: { quoteId: string | null; bookingId: string; contractorId: string; amountPence: number; receiptUrl: string | null; description: string }) => Promise<void>;
    appendJobNote: (bookingId: string, note: string) => Promise<void>;
    alertVariance: (input: { bookingId: string; quoteId: string | null; customerName: string | null; variance: VarianceResult; receiptUrls: string[] }) => Promise<void>;
    log: (e: { kind: 'other' | 'escalation'; summary: string; detail?: Record<string, unknown>; source: string }) => Promise<void>;
}

export interface ClaimResult {
    variance: VarianceResult;
    basis: 'cost' | 'margin' | 'none';
    flagged: boolean;
}

/**
 * Record a materials claim: the receipt and the total on the job, the variance computed against
 * the pack, Ben pushed only when it is material. Called on its own endpoint, not from the close —
 * a contractor with no receipts never sees this and nothing is flagged.
 */
export async function recordMaterialsClaim(input: {
    bookingId: string;
    quoteId: string | null;
    contractorId: string;
    customerName?: string | null;
    claimedPence: number;
    receiptUrls: string[];
    note?: string | null;
}, deps?: ClaimDeps): Promise<ClaimResult> {
    const d = deps ?? liveClaimDeps();
    const pack = input.quoteId ? await d.pack(input.quoteId).catch(() => null) : null;
    const expected = expectedMaterialsPence(pack);
    const variance = materialsVariance(input.claimedPence, expected.pence);

    const receipt = input.receiptUrls[0] ?? null;
    const note = clean(input.note, 200);
    const jobNote = [`🧾 Materials claimed: ${(input.claimedPence / 100).toFixed(2)} — ${variance.reason}`, note ? `   ${note}` : '', variance.flagged ? '   ⚠️ Flagged to the office' : '']
        .filter(Boolean).join('\n');

    const safely = async (what: string, run: () => Promise<void>) => {
        try { await run(); } catch (e: any) { console.warn(`[JobPackCompletion] ${what} failed:`, e?.message ?? e); }
    };

    await safely('save the expense row', () => d.saveExpense({
        quoteId: input.quoteId, bookingId: input.bookingId, contractorId: input.contractorId,
        amountPence: input.claimedPence, receiptUrl: receipt,
        description: `Materials claimed on site${note ? ` — ${note}` : ''}`,
    }));
    await safely('append the claim to the job', () => d.appendJobNote(input.bookingId, jobNote));
    if (variance.flagged) {
        await safely('push the variance to Ben', () => d.alertVariance({
            bookingId: input.bookingId, quoteId: input.quoteId, customerName: input.customerName ?? null,
            variance, receiptUrls: input.receiptUrls,
        }));
    }
    await safely('log', () => d.log({
        kind: variance.flagged ? 'escalation' : 'other',
        source: 'job-pack-completion',
        summary: `materials claim ${variance.flagged ? 'FLAGGED' : 'recorded'}: ${variance.reason}`,
        detail: { bookingId: input.bookingId, quoteId: input.quoteId, basis: expected.basis, ...variance },
    }));

    return { variance, basis: expected.basis, flagged: variance.flagged };
}

// ---------------------------------------------------------------- live deps

/** The pack for a quote, or null when there is no pack / no table (the pack is optional). */
export async function packOrNull(quoteId: string): Promise<JobPack | null> {
    try {
        const { getPackForQuote } = await import('./job-pack');
        return await getPackForQuote(quoteId);
    } catch (error: any) {
        const { isMissingTable } = await import('./job-pack');
        if (isMissingTable(error)) return null;
        throw error;
    }
}

/** The thread for a quote: its conversation if the pack knows one, else the quote's phone. */
async function conversationForQuote(quoteId: string): Promise<string | null> {
    const pack = await packOrNull(quoteId).catch(() => null);
    if (pack?.conversationId) return pack.conversationId;
    const { db } = await import('../db');
    const { personalizedQuotes } = await import('@shared/schema');
    const { eq, sql } = await import('drizzle-orm');
    const [q] = await db.select({ phone: personalizedQuotes.phone }).from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
    const digits = String(q?.phone ?? '').replace(/\D/g, '');
    if (!digits) return null;
    const rows: any = await db.execute(sql`select id from conversations where regexp_replace(phone_number, '\\D', '', 'g') = ${digits} order by updated_at desc nulls last limit 1`);
    const list: any[] = Array.isArray(rows) ? rows : (rows?.rows ?? []);
    return list[0]?.id ? String(list[0].id) : null;
}

export function liveCompletionDeps(): CompletionDeps {
    return {
        pack: packOrNull,
        fileAccessNotes: async (quoteId, notes) => {
            const { getPackForQuote, fileAnswer, savePack } = await import('./job-pack');
            const pack = await getPackForQuote(quoteId);
            if (!pack) return;
            const merged = Array.from(new Set([...pack.job.accessNotes, ...notes])).slice(0, 12);
            // `job.*` stays live after the lock by design, and accessNotes is a job field — the
            // leftover report is exactly the "what the next person needs to know" this field is for.
            await savePack(fileAnswer(pack, { field: 'job.accessNotes', value: merged, by: 'contractor', source: 'system' }));
        },
        propertyAccessNotes: async (quoteId, notes) => {
            const { db } = await import('../db');
            const { personalizedQuotes, serviceProperties } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');
            const [q] = await db.select({ propertyId: personalizedQuotes.propertyId }).from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
            if (!q?.propertyId) return;
            const [p] = await db.select({ accessNotes: serviceProperties.accessNotes }).from(serviceProperties).where(eq(serviceProperties.id, q.propertyId)).limit(1);
            const next = mergeAccessNotes(p?.accessNotes, notes);
            if (!next) return;
            await db.update(serviceProperties).set({ accessNotes: next, updatedAt: new Date() }).where(eq(serviceProperties.id, q.propertyId));
        },
        threadNote: async (quoteId, note) => {
            const conversationId = await conversationForQuote(quoteId);
            if (!conversationId) return;
            const { db } = await import('../db');
            const { messages } = await import('@shared/schema');
            const crypto = await import('crypto');
            // An internal note, NOT a message to the customer: channel 'note' (the ledger's own
            // vocabulary) and the conversation's clocks are deliberately left alone. Advancing
            // lastMessageAt here would make the board read this thread as answered when nobody has
            // replied to the customer at all.
            await db.insert(messages).values({
                id: `note_${crypto.randomBytes(12).toString('hex')}`,
                conversationId, direction: 'outbound', content: note, type: 'text', channel: 'note',
                status: 'delivered', senderName: 'Job sheet', createdAt: new Date(),
            }).onConflictDoNothing();
        },
        appendJobNote: liveAppendJobNote,
        alertUnhappy: async ({ quoteId, bookingId, note }) => {
            const { notifyEscalation } = await import('../pushover');
            const conversationId = quoteId ? await conversationForQuote(quoteId).catch(() => null) : null;
            await notifyEscalation({
                conversationId: conversationId ?? '',
                note: `The customer did NOT sign off happy on a job that just closed.\n${note}\nBooking ${bookingId}.`,
            } as any);
        },
        log: async (e) => { const { logSystemEvent } = await import('../system-events'); await logSystemEvent(e as any); },
    };
}

/** Append a line to the booking's completion notes — the durable copy of everything on this page. */
async function liveAppendJobNote(bookingId: string, note: string): Promise<void> {
    const { db } = await import('../db');
    const { contractorBookingRequests } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select({ completionNotes: contractorBookingRequests.completionNotes }).from(contractorBookingRequests).where(eq(contractorBookingRequests.id, bookingId)).limit(1);
    const next = row?.completionNotes ? `${row.completionNotes}\n${note}` : note;
    await db.update(contractorBookingRequests).set({ completionNotes: next, updatedAt: new Date() }).where(eq(contractorBookingRequests.id, bookingId));
}

export function liveClaimDeps(): ClaimDeps {
    return {
        pack: packOrNull,
        saveExpense: async (input) => {
            const { db } = await import('../db');
            const { jobMaterialExpenses } = await import('@shared/schema');
            const crypto = await import('crypto');
            try {
                await db.insert(jobMaterialExpenses).values({
                    id: `jme_${crypto.randomBytes(10).toString('hex')}`,
                    quoteId: input.quoteId, bookingRequestId: input.bookingId, contractorId: input.contractorId,
                    amountPence: input.amountPence, vendor: null, description: input.description,
                    spendDate: new Date().toISOString().slice(0, 10),
                    source: 'manual', receiptUrl: input.receiptUrl, enteredBy: input.contractorId, enteredByName: 'Contractor app',
                } as any);
            } catch (error: any) {
                // job_material_expenses has no migration in this repo yet: the claim's durable home
                // is the note on the booking, which is written either way. Never let this throw.
                if (String(error?.code) === '42P01' || /job_material_expenses/.test(String(error?.message ?? ''))) {
                    console.warn('[JobPackCompletion] job_material_expenses absent; claim kept on the booking only');
                    return;
                }
                throw error;
            }
        },
        appendJobNote: liveAppendJobNote,
        alertVariance: async ({ bookingId, quoteId, customerName, variance, receiptUrls }) => {
            const { notifyEscalation } = await import('../pushover');
            const conversationId = quoteId ? await conversationForQuote(quoteId).catch(() => null) : null;
            const lines = [
                `Materials claim off the pack${customerName ? ` on ${customerName}'s job` : ''}.`,
                variance.reason,
                receiptUrls.length ? `${receiptUrls.length} receipt photo${receiptUrls.length === 1 ? '' : 's'} on the job.` : 'No receipt photo.',
                `Booking ${bookingId}.`,
            ];
            await notifyEscalation({ conversationId: conversationId ?? '', note: lines.join('\n') } as any);
        },
        log: async (e) => { const { logSystemEvent } = await import('../system-events'); await logSystemEvent(e as any); },
    };
}
