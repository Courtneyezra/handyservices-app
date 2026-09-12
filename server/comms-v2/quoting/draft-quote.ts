/**
 * draft_quote: the thin wrapper that makes the existing clerk chain callable from the new desk.
 *
 * The chain (server/spine/route-a.ts runRouteAChain: estimator -> the one pricing engine -> a
 * personalized_quotes draft with suggestions and every customer price null -> Ben's notification)
 * runs inside a spine pass and is not callable outside one (design.md, "What the code can answer
 * today"): it wants the old case file, a policy pack, a triage result and the clerk's artifact,
 * and its default draft writer wants a row in the old conversations table. Nothing in it is
 * edited. This file supplies what a pass would: the intake the Quoting specialist produced as the
 * clerk's artifact, a case-file shape carrying the v2 case id and the party's number, and the
 * chain's own injection points for the two steps that assume the old desk: the draft write (done
 * here from the chain's pure row builder, keyed to the party, not a conversation) and Ben's
 * notification (returned to the tool server, which notifies once and records it on the file).
 *
 * The re-run defect the design records (a re-asserted ready tag treated as already seen,
 * server/spine/request-run.ts) lives in the old desk's scheduler, which the new desk never calls;
 * it is out of scope here and noted in the PR.
 */
import { randomUUID } from 'node:crypto';
import type { CaseFile, ModelCallRecord, Party } from '../desk/case-file';
import { assertCommsV2Database } from '../live-database';
import { CREATED_BY, CREATED_BY_NAME, SOURCE_CHANNEL, type DraftInsert, type QuoteStore } from './quote-store';

export const CUSTOMER_TYPES = ['homeowner', 'landlord', 'letting_agent', 'business'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface IntakeLineInput {
    title: string;
    category: string | null;
    qty: number;
    /** What matters for pricing, in the customer's words where possible. Never a figure. */
    detail: string | null;
    /** Customer-facing assumptions the quote will carry. */
    assumptions: string[];
    /** Customer-facing "not included". */
    notIncluded: string[];
}

export interface DraftIntake {
    customerName: string | null;
    postcode: string | null;
    customerType: CustomerType;
    lines: IntakeLineInput[];
    /**
     * What Ben may want to request before pricing: short labels ("photo (asked once, none sent)",
     * "access"). It never goes on the quote row, in any field: `GET /api/personalized-quotes/:slug`
     * is reachable by slug with no session and returns every line-item field but the materials
     * array verbatim, so anything written there reaches the customer. It goes to Ben on his
     * notification and onto the case file as the internal `ben_to_request` fact (quoting-tools.ts).
     */
    missing: string[];
}

export type DraftOutcome =
    | { ok: true; quoteId: string; slug: string; lines: string[]; checkThis: number; suggestedTotalPence: number | null; estimatorFailed: string | null; estimateId: string | null; log: string[]; calls: ModelCallRecord[] }
    | { ok: false; reason: string; log: string[]; calls: ModelCallRecord[] };

export interface Drafter {
    draft(input: { file: CaseFile; party: Party; intake: DraftIntake; now: Date; baseUrl?: string }): Promise<DraftOutcome>;
}

/** The clerk's artifact as the chain reads it (server/spine/quote-intake.ts intakeFromArtifact). Customer-facing words only. */
export function artifactFor(intake: DraftIntake): { kind: 'quote_intake'; summary: string; data: Record<string, unknown>; childRunId: null } {
    const lines = intake.lines.map((l) => ({
        title: l.title,
        category: l.category,
        qty: l.qty,
        detail: l.detail,
        assumptions: l.assumptions,
        notIncluded: l.notIncluded,
        exclusions: l.notIncluded,
    }));
    return {
        kind: 'quote_intake',
        summary: `${lines.length} line${lines.length === 1 ? '' : 's'} from the new desk`,
        data: { customerName: intake.customerName, postcode: intake.postcode, customerType: intake.customerType, readiness: 'quote_ready', lines, assumptions: [], gaps: [], declineReason: null },
        childRunId: null,
    };
}

/** A unique eight-character slug, the column's width. */
export async function newSlug(store: QuoteStore): Promise<string> {
    for (let i = 0; i < 5; i++) {
        const candidate = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
        if (!(await store.read(candidate))) return candidate;
    }
    return randomUUID().replace(/-/g, '').slice(0, 8);
}

/** The media on the file as the chain's row builder wants it: every photo and video the customer sent. */
export function threadMediaOf(file: CaseFile): Array<{ id: string; url: string; mimeType: string | null; kind: 'image' | 'video' | 'other'; at: string | null }> {
    const out: Array<{ id: string; url: string; mimeType: string | null; kind: 'image' | 'video' | 'other'; at: string | null }> = [];
    for (const t of file.turns) if (t.direction === 'inbound') for (const m of t.media) if (m.url) out.push({ id: m.id, url: m.url, mimeType: m.mime, kind: m.kind, at: t.at });
    return out;
}

/**
 * The chain, called with the injection points it offers. The estimator, the pricing engine and the
 * live settings run for real against the branch database; the draft is written here; Ben's
 * notification is captured for the tool server; the job pack (keyed to the old conversation) is
 * skipped and said so; the system-events log is captured.
 */
export function chainDrafter(store: QuoteStore): Drafter {
    return {
        async draft({ file, party, intake, now }) {
            // Outside the catch below: the chain runs the estimator and the pricing engine against
            // the database, so a wrong database is refused loudly rather than becoming a reason.
            assertCommsV2Database('the Quoting tool server\'s draft chain');
            const log: string[] = [];
            const calls: ModelCallRecord[] = [];
            try {
                const { runRouteAChain } = await import('../../spine/route-a');
                const { pricedDraftRow } = await import('../../spine/quote-intake');
                const address = party.channels.find((c) => c.kind === 'whatsapp')?.address ?? party.channels[0]?.address ?? '';
                const caseFile = {
                    conversationId: file.id, phone: address, audience: 'customer', stage: 'scoping', contactName: party.name,
                    timeline: [], media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' },
                    openPromises: [], openFlags: [], tags: [], hash: `comms_v2:${file.id}`, builtAt: now.toISOString(),
                };
                const pack = { id: 'comms_v2.quoting', version: 1, audience: 'customer', allowedIntents: [], guardSet: [], tierByIntent: {}, defaultTier: 'PROPOSE', hours: { reactiveAlways: true, proactiveFromHour: 8, proactiveToHour: 20 }, exceptionsToBen: [], voiceFile: '', templates: {} };
                const triage = { audience: 'customer', intent: 'unknown', lane: 'quote_clerk', exceptions: [], stage: 'scoping', tags: [], reasons: ['comms_v2 quoting: job and location known'], source: 'rules' };
                const artifact = artifactFor(intake);
                let captured: { checkThis: number; suggestedTotalPence: number | null; estimatorFailed: string | null } | null = null;
                const media = threadMediaOf(file);
                const outcome = await runRouteAChain({ caseFile: caseFile as any, pack: pack as any, triage: triage as any, clerkRunId: `comms_v2_${randomUUID()}`, artifact: artifact as any }, {
                    createDraft: async (input) => {
                        const built = pricedDraftRow({ intake: input.intake, estimate: input.estimate, suggestions: input.suggestions, phone: address, contactName: party.name, media, now });
                        // `notes` is the field the price screen reads for the line's words
                        // (server/spine/price-screen.ts buildScreenLine) and the chain's row builder
                        // leaves it unset, so the line's own customer-facing words are copied into
                        // it. Nothing internal joins them: every field on this row can be read by
                        // anyone holding the quote's slug.
                        const row = { ...built, pricingLineItems: (built.pricingLineItems as any[]).map((li) => ({ ...li, notes: li.notes ?? li.description ?? null })) };
                        const shortSlug = await newSlug(store);
                        const id = `quote_${randomUUID().replace(/-/g, '').slice(0, 21)}`;
                        const insert: DraftInsert = { ...(row as any), id, shortSlug, sourceChannel: SOURCE_CHANNEL, createdBy: CREATED_BY, createdByName: CREATED_BY_NAME };
                        await store.insertDraft(insert);
                        return { ok: true as const, id, slug: shortSlug, superseded: [] };
                    },
                    notify: async (alert) => { captured = { checkThis: alert.checkThis, suggestedTotalPence: alert.suggestedTotalPence ?? null, estimatorFailed: alert.estimatorFailed ?? null }; },
                    writePack: async () => { log.push('job pack skipped: the pack is keyed to the old conversation; the price screen prices from the draft'); return null; },
                    log: async (e) => { log.push(e.summary); },
                });
                if (!outcome.ran || !outcome.draftSlug) return { ok: false, reason: outcome.reason ?? 'the chain produced no draft', log, calls };
                const row = await store.read(outcome.draftSlug);
                const estimateModel = (row as any)?.pricingSuggestions?.engine ?? null;
                if (outcome.estimateId) {
                    try {
                        const { getEstimate } = await import('../../spine/estimate-store');
                        const est = await getEstimate(outcome.estimateId);
                        if (est) calls.push({ role: 'specialist', model: est.model ?? 'estimator', effort: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costPence: est.costPence ?? null, durationMs: 0 });
                    } catch { /* the estimate row is bookkeeping */ }
                }
                if (estimateModel) log.push(`engine: ${estimateModel}`);
                const c = captured as { checkThis: number; suggestedTotalPence: number | null; estimatorFailed: string | null } | null;
                return {
                    ok: true, quoteId: (row as any)?.id ?? outcome.draftSlug, slug: outcome.draftSlug, lines: intake.lines.map((l) => l.title),
                    checkThis: c?.checkThis ?? outcome.checkThis ?? 0, suggestedTotalPence: c?.suggestedTotalPence ?? null,
                    estimatorFailed: c?.estimatorFailed ?? (outcome.fallback ? outcome.reason ?? 'estimator failed' : null), estimateId: outcome.estimateId ?? null, log, calls,
                };
            } catch (err: any) {
                return { ok: false, reason: err?.message ?? String(err), log, calls };
            }
        },
    };
}

/** A drafter for tests: the row the chain would write, with a suggestion per line, into the given store. No model, no engine. */
export class FakeDrafter implements Drafter {
    readonly drafts: DraftIntake[] = [];
    constructor(private readonly store: QuoteStore, private readonly opts: { suggestedPence?: (title: string) => number | null; materialsPence?: number; fail?: string } = {}) {}
    async draft({ file, party, intake, now }: { file: CaseFile; party: Party; intake: DraftIntake; now: Date }): Promise<DraftOutcome> {
        this.drafts.push(intake);
        if (this.opts.fail) return { ok: false, reason: this.opts.fail, log: [], calls: [] };
        const address = party.channels[0]?.address ?? '';
        const shortSlug = await newSlug(this.store);
        const id = `quote_${randomUUID().replace(/-/g, '').slice(0, 21)}`;
        const suggestions = intake.lines.map((l, i) => ({ lineId: `card_${i + 1}`, title: l.title, suggestedPence: this.opts.suggestedPence ? this.opts.suggestedPence(l.title) : 12000, checkThis: false }));
        const artifact = artifactFor(intake);
        const lines = (artifact.data.lines as Array<{ title: string; category: string | null; qty: number; detail: string | null; assumptions: string[]; notIncluded: string[] }>);
        const row: DraftInsert = {
            id, shortSlug, customerName: intake.customerName ?? party.name ?? 'Customer', phone: address, postcode: intake.postcode, customerType: intake.customerType,
            jobDescription: intake.lines.map((l) => l.title).join('; '), isDraft: true, sourceChannel: SOURCE_CHANNEL, createdBy: CREATED_BY, createdByName: CREATED_BY_NAME,
            pricingLineItems: lines.map((l, i) => ({ lineId: `card_${i + 1}`, label: l.title, title: l.title, description: l.detail, notes: l.detail, category: l.category, qty: l.qty, pricePence: null, labourPence: null, materialsPence: this.opts.materialsPence ?? 0, assumptions: l.assumptions, notIncluded: l.notIncluded, source: 'quote_intake' })),
            pricingSuggestions: { estimateId: 'est_fake', at: now.toISOString(), lines: suggestions, totals: { suggestedPence: suggestions.reduce((a, s) => a + (s.suggestedPence ?? 0), 0) }, engine: 'fake' },
            customerPhotoUrls: threadMediaOf(file).filter((m) => m.kind === 'image').map((m) => m.url),
            expiresAt: new Date(now.getTime() + 30 * 24 * 3_600_000).toISOString(),
        };
        await this.store.insertDraft(row);
        return { ok: true, quoteId: id, slug: shortSlug, lines: intake.lines.map((l) => l.title), checkThis: 0, suggestedTotalPence: (row.pricingSuggestions as any).totals.suggestedPence, estimatorFailed: null, estimateId: 'est_fake', log: ['fake drafter'], calls: [] };
    }
}
