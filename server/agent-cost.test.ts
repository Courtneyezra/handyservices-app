/**
 * Phase 1 vitest: model price → pence arithmetic in server/agent-cost.ts.
 * Pure module, no database.
 */
import { describe, it, expect } from 'vitest';
import {
    computeCostPence, computeCostUsd, priceForModel, USD_TO_GBP,
    MODEL_PRICES_USD_PER_MTOK, CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER,
    type TokenUsage,
} from './agent-cost';

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

// ---------------------------------------------------------------------------------------------
// 0.4 (8 Sep 2026): the published rates, as a FIXTURE.
//
// The audit (S12) found two price tables that disagreed, and the wrong one was the one the
// activity page showed. There is now one table, and this is its contract: the rate for every
// model the codebase actually calls, written out by hand from the provider's published pricing on
// the day the table was last read. A model change, a re-tier, or a hand-edit of the table fails
// HERE, loudly, instead of quietly re-pricing months of run rows.
//
// Sources, read 8 Sep 2026:
//   Anthropic's published per-million rates — Haiku 4.5 $1 / $5, Sonnet 5 $2 / $10,
//     Opus 5 $5 / $25; prompt caching bills reads at 10% of input and writes at 125%.
//     Sonnet 4.5 is off the current-models list; $3 / $15 is the Sonnet 4.x rate (the same as
//     Sonnet 4.6, which is still listed), and it is the ONE dated model this repo still calls.
//   Gemini 3.6 Flash $0.75 / $3.75 per million "through December 31, 2026", then $1.50 / $7.50
//     — carried over from T14 (7 Sep 2026), which read Google's paid-tier pricing page; not
//     re-read here. RAISE THE TABLE AND THIS FIXTURE ON 1 JANUARY 2027.
// ---------------------------------------------------------------------------------------------

/** model id actually called in this repo → its published USD-per-million rate. */
const PUBLISHED_USD_PER_MTOK: ReadonlyArray<readonly [string, { input: number; output: number; family: string }]> = [
    // The spine and the agents (server/llm.ts FAST_MODEL / SCOPER_MODEL / VERIFIER_MODEL).
    ['claude-haiku-4-5', { input: 1, output: 5, family: 'haiku-4-5' }],
    ['claude-haiku-4-5-20251001', { input: 1, output: 5, family: 'haiku-4-5' }],
    ['claude-sonnet-5', { input: 2, output: 10, family: 'sonnet-5' }],
    ['claude-opus-5', { input: 5, output: 25, family: 'opus-5' }],
    // The comms-v2 composer (server/comms-v2/desk/models.ts).
    ['claude-fable-5-1', { input: 10, output: 50, family: 'fable-5-1' }],
    // The one dated model left: /api/pricing/parse-job (server/job-parser.ts).
    ['claude-sonnet-4-5-20250929', { input: 3, output: 15, family: 'sonnet-4-5' }],
    // The describer (server/spine/tools/describe-video.ts, T14).
    ['gemini-3.6-flash', { input: 0.75, output: 3.75, family: 'gemini-3.6-flash' }],
];

describe('the price table matches the provider\'s published rates (0.4)', () => {
    it.each(PUBLISHED_USD_PER_MTOK)('%s is priced at the published rate', (model, published) => {
        const price = priceForModel(model);
        expect(price, `${model} is called in this repo but is not in the price table`).not.toBeNull();
        expect(price!.family).toBe(published.family);
        expect(price!.input).toBe(published.input);
        expect(price!.output).toBe(published.output);
    });

    it('the cache multipliers are the published prompt-caching terms', () => {
        expect(CACHE_READ_MULTIPLIER).toBe(0.10);
        expect(CACHE_WRITE_MULTIPLIER).toBe(1.25);
    });

    it('Sonnet 4.5 is NOT priced as Sonnet 5 — the dated row must win on order', () => {
        expect(priceForModel('claude-sonnet-4-5-20250929')?.family).toBe('sonnet-4-5');
        expect(priceForModel('claude-sonnet-5')?.family).toBe('sonnet-5');
    });

    it('every row in the table is covered by the fixture, so a new model cannot be added unpinned', () => {
        const pinned = new Set(PUBLISHED_USD_PER_MTOK.map(([, p]) => p.family));
        for (const row of MODEL_PRICES_USD_PER_MTOK) {
            expect(pinned, `price table row '${row.family}' has no published-rate fixture`).toContain(row.family);
        }
    });
});
