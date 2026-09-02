/**
 * IN-CHAT QUOTE CARD — server side (Phase 4 / B, design §3.5 "Quote clerk", §10 Phase 4 row;
 * locked spec 18 Aug 2026: compact review card in the thread panel, Save = UNSENT draft, missing
 * name/postcode → the rules layer asks, media = tickable thumbnails all ticked by default).
 *
 * Reads the latest Quote clerk artifact (`Proposal.artifact.kind === 'quote_intake'`) off
 * agent_runs for a thread, lists the thread's media, and saves a DRAFT personalized_quotes row
 * (`is_draft = true`, every price null). The draft mechanism already existed in the schema
 * (`isDraft`: customer-facing automations skip it; a builder save clears it), so no migration.
 *
 * The mapping intake → draft row is pure (`intakeToDraftQuote`) and tested; nothing here prices.
 */
import type { ProposalArtifact } from './types';
import { normaliseReadiness, type IntakeReadiness } from '@shared/intake-readiness';
import type { EstimateStatus, IntakeOverride, IntakeRecord } from '../intake';

export type CardCustomerType = 'homeowner' | 'landlord' | 'letting_agent' | 'business';
export const CARD_CUSTOMER_TYPES: readonly CardCustomerType[] = ['homeowner', 'landlord', 'letting_agent', 'business'];

/** The quote row's customer_type vocabulary (shared/schema.ts) for each card value. */
export const QUOTE_CUSTOMER_TYPE: Record<CardCustomerType, string> = {
    homeowner: 'homeowner',
    landlord: 'landlord',
    letting_agent: 'property_manager',
    business: 'business',
};

export interface CardLine {
    title: string;
    category?: string | null;
    qty?: number | null;
    notes?: string | null;
    assumptions?: string[];
}

export interface ThreadMediaItem {
    id: string;
    url: string;
    mimeType: string | null;
    kind: 'image' | 'video' | 'other';
    at: string | null;
}

export interface QuoteIntakeCardPayload {
    available: true;
    /** The spine run that produced the intake; null when the card is showing a pre-spine legacy blob. */
    runId: string | null;
    at: string;
    summary: string;
    intake: {
        customerName: string | null;
        postcode: string | null;
        customerType: CardCustomerType;
        /** EFFECTIVE readiness — one vocabulary (shared/intake-readiness.ts), override applied. */
        readiness: IntakeReadiness | null;
        lines: CardLine[];
        assumptions: string[];
        gaps: Array<{ question: string; audience: string; lineIndex: number | null }>;
        declineReason: string | null;
    };
    missing: Array<'name' | 'postcode'>;
    media: ThreadMediaItem[];
    /** P8: where the intake came from, the clerk's own verdict, any human override, the estimate state. */
    source: 'spine' | 'legacy';
    clerkReadiness: IntakeReadiness;
    override: IntakeOverride | null;
    overrideApplied: boolean;
    estimate: EstimateStatus | null;
}

// ---------------------------------------------------------------- pure

export function mediaKindOf(mimeType: string | null | undefined, type?: string | null): ThreadMediaItem['kind'] {
    const m = (mimeType ?? '').toLowerCase();
    if (m.startsWith('image/') || type === 'image') return 'image';
    if (m.startsWith('video/') || type === 'video') return 'video';
    return 'other';
}

export function normaliseCustomerType(raw: unknown): CardCustomerType {
    const v = String(raw ?? '').toLowerCase().replace(/[\s-]+/g, '_');
    if (v === 'letting_agent' || v === 'property_manager' || v === 'agent') return 'letting_agent';
    if (v === 'landlord') return 'landlord';
    if (v === 'business' || v === 'small_biz' || v === 'commercial') return 'business';
    return 'homeowner';
}

/** Cheap signal read over the customer's own words, for when the clerk left the default. */
export function inferCustomerType(text: string | null | undefined, fallback: CardCustomerType = 'homeowner'): CardCustomerType {
    const t = (text ?? '').toLowerCase();
    if (!t) return fallback;
    if (/\b(letting agent|lettings|property manag|managing agent|on behalf of (the|my) landlord|our tenant)\b/.test(t)) return 'letting_agent';
    if (/\b(my tenant|my rental|buy to let|btl|i'?m (a|the) landlord|landlord)\b/.test(t)) return 'landlord';
    if (/\b(our (shop|office|premises|store|salon|restaurant|cafe|warehouse)|the business|our staff|invoice to the company|ltd\b|limited\b)\b/.test(t)) return 'business';
    return fallback;
}

/** Pull the card-shaped intake out of a clerk artifact (defensive: the jsonb is untyped). */
export function intakeFromArtifact(artifact: ProposalArtifact | null | undefined): QuoteIntakeCardPayload['intake'] | null {
    if (!artifact || artifact.kind !== 'quote_intake' || !artifact.data || typeof artifact.data !== 'object') return null;
    const d = artifact.data as Record<string, any>;
    const lines: CardLine[] = Array.isArray(d.lines)
        ? d.lines.map((l: any) => ({
            title: String(l?.title ?? '').trim(),
            category: l?.category ?? null,
            qty: typeof l?.qty === 'number' ? l.qty : null,
            notes: typeof l?.detail === 'string' && l.detail.trim() ? l.detail.trim() : null,
            assumptions: Array.isArray(l?.assumptions) ? l.assumptions.map(String) : [],
        })).filter((l: CardLine) => l.title)
        : [];
    return {
        customerName: typeof d.customerName === 'string' && d.customerName.trim() ? d.customerName.trim() : null,
        postcode: typeof d.postcode === 'string' && d.postcode.trim() ? d.postcode.trim().toUpperCase() : null,
        customerType: normaliseCustomerType(d.customerType),
        readiness: typeof d.readiness === 'string' ? normaliseReadiness(d.readiness) : null,
        declineReason: typeof d.declineReason === 'string' && d.declineReason ? d.declineReason : null,
        lines,
        assumptions: Array.isArray(d.assumptions) ? d.assumptions.map(String) : [],
        gaps: Array.isArray(d.gaps) ? d.gaps.map((g: any) => ({ question: String(g?.question ?? ''), audience: String(g?.audience ?? 'customer'), lineIndex: typeof g?.lineIndex === 'number' ? g.lineIndex : null })) : [],
    };
}

export function missingFields(intake: { customerName: string | null; postcode: string | null }): Array<'name' | 'postcode'> {
    const out: Array<'name' | 'postcode'> = [];
    if (!intake.customerName) out.push('name');
    if (!intake.postcode) out.push('postcode');
    return out;
}

/** From a list of runs (newest first or not), the newest quote_intake artifact. Pure. */
export function pickLatestIntakeRun<T extends { id: string; finishedAt: Date | string | null; startedAt: Date | string; proposal: unknown }>(runs: T[]): { run: T; artifact: ProposalArtifact } | null {
    const withArtifact = runs
        .map((r) => ({ r, artifact: ((r.proposal as any)?.artifact ?? (r.proposal as any)?.proposal?.artifact ?? null) as ProposalArtifact | null }))
        .filter((x): x is { r: T; artifact: ProposalArtifact } => !!x.artifact && x.artifact.kind === 'quote_intake');
    if (!withArtifact.length) return null;
    withArtifact.sort((a, b) => new Date(b.r.finishedAt ?? b.r.startedAt).getTime() - new Date(a.r.finishedAt ?? a.r.startedAt).getTime());
    return { run: withArtifact[0].r, artifact: withArtifact[0].artifact };
}

export interface SaveDraftInput {
    lines: CardLine[];
    customerType: CardCustomerType;
    name: string;
    postcode: string;
    mediaIds: string[];
}

export function validateDraftInput(body: unknown): { ok: true; input: SaveDraftInput } | { ok: false; errors: string[] } {
    const b = (body ?? {}) as Record<string, any>;
    const errors: string[] = [];
    const lines: CardLine[] = Array.isArray(b.lines)
        ? b.lines.map((l: any) => ({
            title: String(l?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
            category: l?.category ? String(l.category).slice(0, 40) : null,
            qty: l?.qty == null || l?.qty === '' ? null : Number(l.qty),
            notes: l?.notes ? String(l.notes).trim().slice(0, 600) : null,
            assumptions: Array.isArray(l?.assumptions) ? l.assumptions.map(String).slice(0, 10) : [],
        })).filter((l: CardLine) => l.title)
        : [];
    if (!lines.length) errors.push('At least one job line with a title is required.');
    for (const l of lines) if (l.qty != null && (!Number.isFinite(l.qty) || l.qty <= 0 || l.qty > 999)) errors.push(`Quantity for "${l.title}" must be a positive number.`);
    const name = String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const postcode = String(b.postcode ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 12);
    if (postcode && !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(postcode)) errors.push('Postcode does not look like a UK postcode.');
    const customerType = normaliseCustomerType(b.customerType);
    const mediaIds = Array.isArray(b.mediaIds) ? b.mediaIds.map(String).filter(Boolean).slice(0, 40) : [];
    if (errors.length) return { ok: false, errors };
    return { ok: true, input: { lines, customerType, name, postcode, mediaIds } };
}

export interface DraftQuoteRow {
    customerName: string;
    phone: string;
    postcode: string | null;
    jobDescription: string;
    quoteMode: 'simple';
    segment: string;
    customerType: string;
    isDraft: true;
    pricingLineItems: Array<{
        lineId: string; label: string; title: string; description: string | null; category: string | null; qty: number;
        pricePence: null; labourPence: null; materialsPence: null; assumptions: string[]; source: 'quote_intake';
    }>;
    quoteAssumptions: string[] | null;
    customerPhotoUrls: string[] | null;
    customerVideoUrls: string[] | null;
    sourceChannel: string;
    createdBy: string | null;
    createdByName: string | null;
    expiresAt: Date;
}

/**
 * The draft row. Every price is null by construction: the type does not admit a number there.
 * Media is split by kind onto the quote's photo/video columns, ticked ids only.
 */
export function intakeToDraftQuote(input: {
    draft: SaveDraftInput;
    phone: string;
    media: ThreadMediaItem[];
    assumptions?: string[];
    createdBy?: string | null;
    createdByName?: string | null;
    now?: Date;
}): DraftQuoteRow {
    const now = input.now ?? new Date();
    const ticked = new Set(input.draft.mediaIds);
    const chosen = input.media.filter((m) => ticked.has(m.id));
    const photos = chosen.filter((m) => m.kind === 'image').map((m) => m.url);
    const videos = chosen.filter((m) => m.kind === 'video').map((m) => m.url);
    return {
        customerName: input.draft.name || 'Customer',
        phone: input.phone,
        postcode: input.draft.postcode || null,
        jobDescription: input.draft.lines.map((l) => (l.qty && l.qty > 1 ? `${l.qty}× ${l.title}` : l.title)).join('; ').slice(0, 2000),
        quoteMode: 'simple',
        segment: 'CONTEXTUAL',
        customerType: QUOTE_CUSTOMER_TYPE[input.draft.customerType],
        isDraft: true,
        pricingLineItems: input.draft.lines.map((l, i) => ({
            lineId: `card_${i + 1}`, label: l.title, title: l.title, description: l.notes ?? null, category: l.category ?? null,
            qty: l.qty && l.qty > 0 ? l.qty : 1,
            pricePence: null, labourPence: null, materialsPence: null,
            assumptions: l.assumptions ?? [], source: 'quote_intake',
        })),
        quoteAssumptions: input.assumptions?.length ? input.assumptions : null,
        customerPhotoUrls: photos.length ? photos : null,
        customerVideoUrls: videos.length ? videos : null,
        sourceChannel: 'comms_quote_card',
        createdBy: input.createdBy ?? null,
        createdByName: input.createdByName ?? null,
        expiresAt: new Date(now.getTime() + 30 * 24 * 3_600_000),
    };
}

// ---------------------------------------------------------------- db

export async function loadThreadMedia(conversationId: string): Promise<ThreadMediaItem[]> {
    const { db } = await import('../db');
    const { messages } = await import('@shared/schema');
    const { and, eq, isNotNull, desc } = await import('drizzle-orm');
    const { notQuarantined } = await import('../message-quarantine');
    const rows = await db.select({ id: messages.id, mediaUrl: messages.mediaUrl, mediaType: messages.mediaType, type: messages.type, createdAt: messages.createdAt })
        .from(messages).where(and(eq(messages.conversationId, conversationId), isNotNull(messages.mediaUrl), notQuarantined))
        .orderBy(desc(messages.createdAt)).limit(60);
    const seen = new Set<string>();
    const out: ThreadMediaItem[] = [];
    for (const r of rows) {
        if (!r.mediaUrl || seen.has(r.mediaUrl)) continue;
        const kind = mediaKindOf(r.mediaType, r.type);
        if (kind === 'other') continue;
        seen.add(r.mediaUrl);
        out.push({ id: r.id, url: r.mediaUrl, mimeType: r.mediaType ?? null, kind, at: r.createdAt ? new Date(r.createdAt).toISOString() : null });
    }
    return out.reverse();
}

/** The card payload from a resolved intake record (pure; the loader below adds media). */
export function cardFromIntakeRecord(record: IntakeRecord, media: ThreadMediaItem[]): QuoteIntakeCardPayload {
    const v = record.intake;
    const intake: QuoteIntakeCardPayload['intake'] = {
        customerName: v.customerName,
        postcode: v.postcode,
        customerType: normaliseCustomerType(v.customerType),
        readiness: record.readiness,
        lines: v.lines.map((l) => ({ title: l.title, category: l.category, qty: l.qty, notes: l.detail, assumptions: l.assumptions })),
        assumptions: v.assumptions,
        gaps: v.gaps.map((g) => ({ question: g.question, audience: g.audience, lineIndex: g.lineIndex })),
        declineReason: v.declineReason,
    };
    return {
        available: true,
        runId: record.runId,
        at: record.at,
        summary: record.summary ?? `${v.lines.length} line(s), readiness ${record.readiness}, ${v.gaps.length} gap(s)`,
        intake,
        missing: missingFields(intake),
        media,
        source: record.source,
        clerkReadiness: record.clerkReadiness,
        override: record.override,
        overrideApplied: record.overrideApplied,
        estimate: record.estimate,
    };
}

/**
 * P8 / C: the card reads THE intake (server/intake.ts getIntake — spine artifact → human override
 * → legacy fallback) so the comms thread and the portal show one and the same thing.
 */
export async function loadQuoteIntakeCard(conversationId: string): Promise<QuoteIntakeCardPayload | { available: false; reason: string }> {
    const { getIntake } = await import('../intake');
    const record = await getIntake(conversationId);
    if (!record) return { available: false, reason: 'no quote intake for this thread' };
    const media = await loadThreadMedia(conversationId);
    return cardFromIntakeRecord(record, media);
}

export async function saveDraftQuote(conversationId: string, body: unknown, user: { id?: string | null; email?: string | null; name?: string | null } = {}):
    Promise<{ ok: true; id: string; slug: string; editUrl: string } | { ok: false; status: number; errors: string[] }> {
    const v = validateDraftInput(body);
    if (!v.ok) return { ok: false, status: 400, errors: v.errors };
    const { db } = await import('../db');
    const { conversations, personalizedQuotes } = await import('@shared/schema');
    const { eq, sql } = await import('drizzle-orm');
    const { nanoid } = await import('nanoid');
    const [conv] = await db.select({ id: conversations.id, phoneNumber: conversations.phoneNumber, contactName: conversations.contactName })
        .from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conv) return { ok: false, status: 404, errors: ['Conversation not found'] };
    const digits = (conv.phoneNumber ?? '').replace('@c.us', '').replace(/\D/g, '');
    if (!digits) return { ok: false, status: 422, errors: ['Conversation has no usable phone'] };
    const media = await loadThreadMedia(conversationId);
    if (!v.input.name && conv.contactName) v.input.name = conv.contactName;
    const row = intakeToDraftQuote({
        draft: v.input, phone: `+${digits}`, media,
        createdBy: user.id ?? user.email ?? null, createdByName: user.name ?? user.email ?? null,
    });
    // Same slug discipline as the builder (contextual-pricing/routes.ts generateUniqueSlug).
    let shortSlug = '';
    for (let i = 0; i < 5 && !shortSlug; i++) {
        const candidate = Math.random().toString(36).substring(2, 10);
        const [hit] = await db.select({ id: personalizedQuotes.id }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, candidate)).limit(1);
        if (!hit) shortSlug = candidate;
    }
    if (!shortSlug) shortSlug = nanoid(8);
    const id = `quote_${nanoid()}`;
    await db.insert(personalizedQuotes).values({ id, shortSlug, ...row, createdAt: new Date() } as any);
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('quoteDraft', jsonb_build_object('slug', ${shortSlug}::text, 'quoteId', ${id}::text, 'at', ${new Date().toISOString()}::text))`,
        updatedAt: new Date(),
    }).where(eq(conversations.id, conversationId));
    try {
        const { emitCommsEvent } = await import('../comms-events');
        emitCommsEvent({ type: 'board_delta', conversationId, reason: 'other', at: new Date().toISOString() });
    } catch { /* bookkeeping */ }
    return { ok: true, id, slug: shortSlug, editUrl: `/admin/quotes/${shortSlug}/edit` };
}

// ---------------------------------------------------------------- P8 Route A: the automatic priced draft

import type { PricingSuggestions } from './pricing-bridge';
import type { QuoteEstimate } from './estimate-store';

export const ROUTE_A_SOURCE_CHANNEL = 'spine_route_a';

/**
 * Pure: which unsent drafts on this number a new intake supersedes (never the one being kept).
 * "Unsent" = still a draft: personalized_quotes has no sent-at column; Ben's send (pane B, or a
 * builder save) clears is_draft, which is exactly "the customer can now see it".
 */
export function selectSupersededDrafts<T extends { id: string; isDraft: boolean | null; supersededAt?: Date | string | null }>(rows: T[], keepId?: string | null): T[] {
    return rows.filter((r) => r.isDraft && !r.supersededAt && r.id !== keepId);
}

/** Pure: the draft row for the chain — every customer-visible price null; the suggestions ride in pricing_suggestions. */
export function pricedDraftRow(input: {
    intake: QuoteIntakeCardPayload['intake'];
    estimate: QuoteEstimate;
    suggestions: PricingSuggestions;
    phone: string;
    contactName?: string | null;
    media: ThreadMediaItem[];
    now?: Date;
}): DraftQuoteRow & { pricingSuggestions: PricingSuggestions; estimateId: string } {
    const draft: SaveDraftInput = {
        lines: input.intake.lines, customerType: input.intake.customerType,
        name: input.intake.customerName ?? input.contactName ?? '', postcode: input.intake.postcode ?? '',
        mediaIds: input.media.map((m) => m.id), // all ticked by default (locked spec 18 Aug)
    };
    const base = intakeToDraftQuote({ draft, phone: input.phone, media: input.media, assumptions: input.intake.assumptions, createdBy: 'spine:route_a', createdByName: 'Spine (Route A)', now: input.now });
    const byId = new Map(input.estimate.lines.map((l) => [l.lineId, l]));
    return {
        ...base,
        sourceChannel: ROUTE_A_SOURCE_CHANNEL,
        pricingLineItems: base.pricingLineItems.map((li) => {
            const est = byId.get(li.lineId);
            return {
                ...li,
                category: est?.category ?? li.category,
                // Time and materials are the estimator's; prices stay null until Ben confirms.
                ...(est ? { timeEstimateMinutes: est.minutesPoint, materials: est.materials.map((m) => ({ name: m.name, qty: m.qty, unitPricePence: m.unitCostPence, supplier: m.source })) } : {}),
            } as typeof li;
        }),
        pricingSuggestions: input.suggestions,
        estimateId: input.estimate.id,
    };
}

/**
 * Create the chain's draft: one per intake run; earlier unsent drafts on the number are marked
 * superseded (never deleted). Returns the slug for the Pushover deep link (/admin/price/<slug>).
 */
export async function createPricedDraft(input: {
    conversationId: string;
    intake: QuoteIntakeCardPayload['intake'];
    estimate: QuoteEstimate;
    suggestions: PricingSuggestions;
}): Promise<{ ok: true; id: string; slug: string; superseded: string[] } | { ok: false; status: number; errors: string[] }> {
    const { db } = await import('../db');
    const { conversations, personalizedQuotes } = await import('@shared/schema');
    const { and, eq, isNull, sql, inArray } = await import('drizzle-orm');
    const { nanoid } = await import('nanoid');
    const [conv] = await db.select({ id: conversations.id, phoneNumber: conversations.phoneNumber, contactName: conversations.contactName })
        .from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
    if (!conv) return { ok: false, status: 404, errors: ['Conversation not found'] };
    const digits = (conv.phoneNumber ?? '').replace('@c.us', '').replace(/\D/g, '');
    if (!digits) return { ok: false, status: 422, errors: ['Conversation has no usable phone'] };
    const media = await loadThreadMedia(input.conversationId);
    const row = pricedDraftRow({ intake: input.intake, estimate: input.estimate, suggestions: input.suggestions, phone: `+${digits}`, contactName: conv.contactName, media });

    let shortSlug = '';
    for (let i = 0; i < 5 && !shortSlug; i++) {
        const candidate = Math.random().toString(36).substring(2, 10);
        const [hit] = await db.select({ id: personalizedQuotes.id }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, candidate)).limit(1);
        if (!hit) shortSlug = candidate;
    }
    if (!shortSlug) shortSlug = nanoid(8);
    const id = `quote_${nanoid()}`;

    // Supersede earlier unsent drafts on this number (a new intake replaces them; nothing is deleted).
    const prior = await db.select({ id: personalizedQuotes.id, isDraft: personalizedQuotes.isDraft, supersededAt: personalizedQuotes.supersededAt })
        .from(personalizedQuotes)
        .where(and(eq(personalizedQuotes.isDraft, true), isNull(personalizedQuotes.supersededAt), sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${digits}`));
    const superseded = selectSupersededDrafts(prior, id).map((r) => r.id);
    if (superseded.length) await db.update(personalizedQuotes).set({ supersededAt: new Date(), supersededBy: id }).where(inArray(personalizedQuotes.id, superseded));

    await db.insert(personalizedQuotes).values({ id, shortSlug, ...row, createdAt: new Date() } as any);
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('quoteDraft', jsonb_build_object('slug', ${shortSlug}::text, 'quoteId', ${id}::text, 'at', ${new Date().toISOString()}::text, 'source', ${ROUTE_A_SOURCE_CHANNEL}::text, 'estimateId', ${input.estimate.id}::text))`,
        updatedAt: new Date(),
    }).where(eq(conversations.id, input.conversationId));
    try {
        const { emitCommsEvent } = await import('../comms-events');
        emitCommsEvent({ type: 'board_delta', conversationId: input.conversationId, reason: 'other', at: new Date().toISOString() });
    } catch { /* bookkeeping */ }
    return { ok: true, id, slug: shortSlug, superseded };
}

/** For GET /api/spine/price/:slug (pane B): the draft + its estimate + suggestions, or why not. */
export async function loadPriceScreen(slug: string): Promise<
    | { available: true; quote: Record<string, unknown>; estimate: QuoteEstimate | null; suggestions: PricingSuggestions | null; superseded: boolean; sent: boolean }
    | { available: false; reason: string }
> {
    const { db } = await import('../db');
    const { personalizedQuotes } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug)).limit(1);
    if (!q) return { available: false, reason: 'no quote with that slug' };
    const { getEstimate } = await import('./estimate-store');
    const estimate = q.estimateId ? await getEstimate(q.estimateId) : null;
    return {
        available: true,
        quote: {
            id: q.id, slug: q.shortSlug, customerName: q.customerName, phone: q.phone, postcode: q.postcode, customerType: q.customerType,
            jobDescription: q.jobDescription, isDraft: q.isDraft, createdAt: q.createdAt, sourceChannel: q.sourceChannel,
            pricingLineItems: q.pricingLineItems, quoteAssumptions: q.quoteAssumptions, customerPhotoUrls: q.customerPhotoUrls, customerVideoUrls: q.customerVideoUrls,
            supersededAt: q.supersededAt ?? null, supersededBy: q.supersededBy ?? null,
        },
        estimate, suggestions: (q.pricingSuggestions as PricingSuggestions | null) ?? null,
        // A chain draft is is_draft until Ben sends (pane B clears it): "sent" = no longer a draft.
        superseded: !!q.supersededAt, sent: !q.isDraft,
    };
}
