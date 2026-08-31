/**
 * Pricing Worker — Cost Calculation from Research
 *
 * Agent Framework V2, WS6: Research & Pricing Workers.
 *
 * Rules-based pricing engine that calculates quotes from research:
 * 1. Labour cost from time estimates
 * 2. Materials cost from research
 * 3. Minimum call-out enforcement
 * 4. VAT calculation
 *
 * No LLM call — pure business logic for speed and consistency.
 *
 * See docs/AGENT_FRAMEWORK_V2_PLAN.md WS6 for architecture details.
 */
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type {
  ConversationPricing,
  PricedLine,
  WorkerRun,
} from '../../shared/conversation-memory';

// ==========================================
// PRICING CONSTANTS
// ==========================================

/** Labour rate in pence per hour */
const LABOUR_RATE_PENCE_PER_HOUR = 4500;  // £45/hour

/** Minimum call-out charge in pence */
const MIN_CALL_OUT_PENCE = 7500;           // £75 minimum

/** VAT rate (20% in UK) */
const VAT_RATE = 0.2;

/** Target margin (for reporting, not calculation) */
const TARGET_MARGIN = 0.35;

// ==========================================
// TYPES
// ==========================================

export interface PricingWorkerOutput {
  pricing: ConversationPricing;
  workerRun: {
    id: string;
    durationMs: number;
  };
}

// ==========================================
// MAIN WORKER
// ==========================================

/**
 * Run the pricing worker to calculate costs from research.
 *
 * @param conversationId - The conversation to price
 * @returns Pricing breakdown with line items, totals, and margin
 * @throws Error if no research to price
 */
export async function runPricingWorker(conversationId: string): Promise<PricingWorkerOutput> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  const memory = await getOrCreateMemory(conversationId);

  if (!memory.research?.lines.length) {
    throw new Error('No research to price');
  }

  // Update readiness to pricing
  await updateMemory(conversationId, { readiness: 'pricing' }, memory.version);

  // Calculate pricing for each line
  const pricedLines: PricedLine[] = memory.research.lines.map(researchLine => {
    // Labour: time in minutes converted to hourly rate
    const labourPence = Math.round(
      (researchLine.timeEstimate.minutes / 60) * LABOUR_RATE_PENCE_PER_HOUR
    );

    // Materials: sum of (unit price × quantity) for all materials
    const materialsPence = researchLine.materials.reduce(
      (sum, m) => sum + (m.unitPricePence * m.quantity),
      0
    );

    return {
      lineId: researchLine.lineId,
      labourPence,
      materialsPence,
      totalPence: labourPence + materialsPence,
    };
  });

  // Calculate totals
  const labourPence = pricedLines.reduce((sum, l) => sum + l.labourPence, 0);
  const materialsPence = pricedLines.reduce((sum, l) => sum + l.materialsPence, 0);

  // Enforce minimum call-out
  const rawSubtotal = labourPence + materialsPence;
  const subtotalPence = Math.max(rawSubtotal, MIN_CALL_OUT_PENCE);

  // VAT on subtotal
  const vatPence = Math.round(subtotalPence * VAT_RATE);

  // Final total
  const totalPence = subtotalPence + vatPence;

  // Margin calculation (labour portion of subtotal)
  const margin = subtotalPence > 0 ? (labourPence / subtotalPence) : 0;

  const pricing: ConversationPricing = {
    lines: pricedLines,
    labourPence,
    materialsPence,
    subtotalPence,
    vatPence,
    totalPence,
    margin,
    lastPricedAt: new Date().toISOString(),
  };

  // Update memory with pricing
  const updatedMemory = await getOrCreateMemory(conversationId);
  await updateMemory(conversationId, {
    pricing,
    readiness: 'priced',
  }, updatedMemory.version);

  // Log worker run (no LLM, so no token usage)
  const durationMs = Date.now() - start;
  const workerRun: WorkerRun = {
    id: runId,
    worker: 'pricing',
    model: 'rules-based',
    trigger: 'research_complete',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs,
    changes: ['pricing', 'readiness'],
    error: null,
    tokenUsage: null,
  };

  await appendWorkerRun(conversationId, workerRun);

  return {
    pricing,
    workerRun: {
      id: runId,
      durationMs,
    },
  };
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Format pence as pounds string.
 */
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Calculate labour cost for given minutes.
 */
export function calculateLabour(minutes: number): number {
  return Math.round((minutes / 60) * LABOUR_RATE_PENCE_PER_HOUR);
}

/**
 * Check if pricing meets minimum call-out.
 */
export function meetsMinimum(subtotalPence: number): boolean {
  return subtotalPence >= MIN_CALL_OUT_PENCE;
}

/**
 * Get the current pricing constants (for UI display).
 */
export function getPricingConstants() {
  return {
    labourRatePencePerHour: LABOUR_RATE_PENCE_PER_HOUR,
    minCallOutPence: MIN_CALL_OUT_PENCE,
    vatRate: VAT_RATE,
    targetMargin: TARGET_MARGIN,
  };
}
