/**
 * P13 part 2 — the pack's writers on the chain side (route-a.ts) and Ben's side (price-screen.ts).
 *
 *   writePackFromChain   after Route A creates the draft: the clerk's lines (evidence, media,
 *                        sizes, spec, supply-by, exclusions, hazards, disposal, lead time) then the
 *                        estimator's judgement (procedure, category, minutes, materials, access)
 *   packEditsFromSend    Ben's price-screen send body → the pack's line edits
 *
 * Both are pure at the top and touch the store at the bottom. A missing job_packs table (migration
 * not applied) is logged and skipped: the pack is optional everywhere it is read.
 */
import type { QuoteIntakeCardPayload } from './quote-intake';
import type { QuoteEstimate } from './estimate-store';
import type { IntakeLineForEstimate } from './agents/estimator';
import { upsertFromClerk, upsertFromEstimate, isMissingTable, type ClerkLineInput, type EstimateLineInput, type BenLineEdit, type JobPack } from './job-pack';

export interface ChainPackInput {
    quoteId: string;
    conversationId: string | null;
    intakeRunId: string | null;
    intake: QuoteIntakeCardPayload['intake'];
    estimate: QuoteEstimate;
    /** The estimator's view of the intake lines: the source of the lineIds (card_1…). */
    intakeLines: IntakeLineForEstimate[];
    now?: Date;
}

/** Pure: the clerk's lines for the pack, ids from the estimator's intake lines (position-matched). */
export function clerkLinesFor(intake: QuoteIntakeCardPayload['intake'], intakeLines: IntakeLineForEstimate[]): ClerkLineInput[] {
    return intake.lines.map((l, i) => ({
        lineId: intakeLines[i]?.lineId ?? `card_${i + 1}`,
        title: l.title, detail: l.notes ?? null, assumptions: l.assumptions ?? [], category: l.category ?? null,
        evidence: l.evidence ?? null, mediaIds: l.mediaIds ?? null, exclusions: l.exclusions ?? null,
        sizes: l.sizes, spec: l.spec, supplyBy: l.supplyBy, hazards: l.hazards ?? null, disposal: l.disposal, leadTime: l.leadTime,
        // P15: a card may carry the list outright; absent, the pack derives it from exclusions + assumptions.
        notIncluded: l.notIncluded ?? null,
    }));
}

/** Pure: the estimator's lines for the pack. */
export function estimateLinesFor(estimate: QuoteEstimate): EstimateLineInput[] {
    return estimate.lines.map((l) => ({
        lineId: l.lineId, category: l.category, minutesLow: l.minutesLow, minutesPoint: l.minutesPoint, minutesHigh: l.minutesHigh,
        procedure: l.procedure ?? [], assumptions: l.assumptions ?? [], flags: l.flags,
        materials: l.materials.map((m) => ({ name: m.name, qty: m.qty, unitCostPence: m.unitCostPence, source: m.source, supplierItemNumber: m.supplierItemNumber ?? null, catalogId: m.catalogId ?? null, size: m.size ?? null })),
    }));
}

export async function writePackFromChain(input: ChainPackInput): Promise<JobPack | null> {
    try {
        await upsertFromClerk({ quoteId: input.quoteId, conversationId: input.conversationId, intakeRunId: input.intakeRunId, lines: clerkLinesFor(input.intake, input.intakeLines), job: { accessNotes: [] }, now: input.now });
        return await upsertFromEstimate({ quoteId: input.quoteId, conversationId: input.conversationId, estimateId: input.estimate.id, lines: estimateLinesFor(input.estimate), job: { accessNotes: input.estimate.job?.accessNotes ?? [] }, now: input.now });
    } catch (error: any) {
        if (isMissingTable(error)) { console.warn('[JobPack] job_packs table absent (migration 20260906_job_packs not applied); pack skipped'); return null; }
        throw error;
    }
}

/** Pure: Ben's send body (price-screen validateSendBody) → pack edits. */
export function packEditsFromSend(lines: Array<{ lineId: string; finalPence: number; materials?: Array<{ name: string; qty: number; unitCostPence: number; source: string | null }>; assumptions?: string[]; notIncluded?: string[] }>, materialsPenceFor: (lineId: string) => number): BenLineEdit[] {
    return lines.map((l) => ({
        lineId: l.lineId, finalPence: l.finalPence, materialsPence: materialsPenceFor(l.lineId),
        ...(l.materials ? { materials: l.materials } : {}), ...(l.assumptions ? { assumptions: l.assumptions } : {}),
        ...(l.notIncluded ? { notIncluded: l.notIncluded } : {}),
    }));
}
