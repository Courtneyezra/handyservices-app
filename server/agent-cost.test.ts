/**
 * Phase 1 vitest: model price → pence arithmetic in server/agent-cost.ts.
 * Pure module, no database.
 */
import { describe, it, expect } from 'vitest';
import { computeCostPence, computeCostUsd, priceForModel, USD_TO_GBP, type TokenUsage } from './agent-cost';

const zero: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('computeCostPence', () => {
    it('prices a million Haiku 4.5 input tokens at $1 → 78p', () => {
        expect(computeCostPence({ ...zero, inputTokens: 1_000_000 }, 'claude-haiku-4-5')).toBe(78);
    });

    it('prices Sonnet 5 input and output at $2 / $10 per MTok', () => {
        // 500k in ($1) + 100k out ($1) = $2 → £1.56 → 156p
        expect(computeCostPence({ ...zero, inputTokens: 500_000, outputTokens: 100_000 }, 'claude-sonnet-5')).toBe(156);
    });

    it('prices Opus 5 at $5 / $25 per MTok', () => {
        // 200k in ($1) + 40k out ($1) = $2 → 156p
        expect(computeCostPence({ ...zero, inputTokens: 200_000, outputTokens: 40_000 }, 'claude-opus-5')).toBe(156);
    });

    it('bills cache reads at 10% of the input rate', () => {
        // 1M cache-read tokens on Sonnet: $2 × 0.10 = $0.20 → 15.6p → 16p
        expect(computeCostPence({ ...zero, cacheReadTokens: 1_000_000 }, 'claude-sonnet-5')).toBe(16);
        expect(computeCostUsd({ ...zero, cacheReadTokens: 1_000_000 }, 'claude-sonnet-5')).toBeCloseTo(0.2, 10);
    });

    it('bills cache writes at 125% of the input rate', () => {
        expect(computeCostUsd({ ...zero, cacheWriteTokens: 1_000_000 }, 'claude-haiku-4-5')).toBeCloseTo(1.25, 10);
    });

    it('returns 0 for an empty run and null for an unpriced model', () => {
        expect(computeCostPence(zero, 'claude-sonnet-5')).toBe(0);
        expect(computeCostPence({ ...zero, inputTokens: 1000 }, 'gpt-4o')).toBeNull();
        expect(computeCostPence({ ...zero, inputTokens: 1000 }, null)).toBeNull();
        expect(priceForModel('claude-opus-5')?.family).toBe('opus-5');
    });

    it('matches model ids by family regardless of date suffix', () => {
        expect(priceForModel('claude-haiku-4-5-20251001')?.family).toBe('haiku-4-5');
        expect(computeCostPence({ ...zero, inputTokens: 1_000_000 }, 'claude-haiku-4-5-20251001')).toBe(Math.round(1 * USD_TO_GBP * 100));
    });

    it('rounds to whole pence', () => {
        // 1 input token on Haiku: $0.000001 → ~0.0000078 £ → 0p
        expect(computeCostPence({ ...zero, inputTokens: 1 }, 'claude-haiku-4-5')).toBe(0);
    });
});
