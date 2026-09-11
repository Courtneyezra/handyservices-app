/**
 * The desk's three text models and the one way it calls them.
 *
 * "Fable 5.1 writes, Sonnet 5 reasons, Haiku 4.5 routes" (behaviour.md answer 30). Every call is
 * a structured-output call through the project's Anthropic client (server/anthropic.ts), so a
 * specialist or the router can never return prose by accident, and every call records its model,
 * input and output tokens and cost so cost per thread is a number from day one (agent-cost.ts is
 * the one price table).
 *
 * Effort: Sonnet 5 and Fable 5.1 take `output_config.effort`; thinking is adaptive by default on
 * both and is left unset. Haiku 4.5 has no effort control and no thinking here: "low" is recorded
 * as the intent, and the call is the cheapest one the model allows.
 *
 * The client is a dependency so every module above this line is testable with a scripted fake.
 */
import type { ZodType } from 'zod/v4';
import { computeCostPence } from '../../agent-cost';
import type { ModelCallRecord } from './case-file';

export const ROUTER_MODEL = 'claude-haiku-4-5';
export const SPECIALIST_MODEL = 'claude-sonnet-5';
export const COMPOSER_MODEL = 'claude-fable-5-1';

export type Effort = 'low' | 'medium' | 'high';

export interface StructuredCall<T> {
    role: ModelCallRecord['role'];
    model: string;
    effort: Effort;
    system: string;
    user: string;
    schema: ZodType<T>;
    maxTokens?: number;
}

export interface StructuredResult<T> {
    output: T | null;
    record: ModelCallRecord;
    /** The model declined (stop_reason refusal). The caller takes its fallback route. */
    refused: boolean;
    /** A transport or parse failure, in one line. */
    error: string | null;
}

export interface ModelClient {
    structured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>>;
}

/** Haiku 4.5 rejects `effort`; the two current-generation models take it. */
export function supportsEffort(model: string): boolean {
    return !/haiku/i.test(model);
}

export function emptyRecord(role: ModelCallRecord['role'], model: string, effort: Effort | null, durationMs = 0): ModelCallRecord {
    return { role, model, effort, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costPence: null, durationMs };
}

export function recordFromUsage(role: ModelCallRecord['role'], model: string, effort: Effort | null, usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined, durationMs: number): ModelCallRecord {
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;
    return { role, model, effort, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costPence: computeCostPence({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, model), durationMs };
}

/** The project's client, loaded on first use so a test run without a key never imports it. */
export class AnthropicModelClient implements ModelClient {
    private client: import('@anthropic-ai/sdk').default | null = null;

    private async get(): Promise<import('@anthropic-ai/sdk').default> {
        if (!this.client) {
            const { getAnthropic } = await import('../../anthropic');
            this.client = getAnthropic();
        }
        return this.client;
    }

    async structured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
        const t0 = Date.now();
        const effort = supportsEffort(call.model) ? call.effort : null;
        try {
            const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
            const client = await this.get();
            const res = await client.messages.parse({
                model: call.model,
                max_tokens: call.maxTokens ?? 4000,
                system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
                messages: [{ role: 'user', content: call.user }],
                // The helper is declared over zod v3's type and implemented over zod/v4's; the schema is v4.
                output_config: { format: zodOutputFormat(call.schema as unknown as Parameters<typeof zodOutputFormat>[0]), ...(effort ? { effort } : {}) },
            });
            const record = recordFromUsage(call.role, call.model, call.effort, res.usage, Date.now() - t0);
            if (res.stop_reason === 'refusal') return { output: null, record, refused: true, error: 'the model declined the request' };
            const output = (res.parsed_output ?? null) as T | null;
            if (output == null) return { output: null, record, refused: false, error: `no parseable output (stop_reason ${res.stop_reason ?? 'none'})` };
            return { output, record, refused: false, error: null };
        } catch (err: any) {
            return { output: null, record: emptyRecord(call.role, call.model, call.effort, Date.now() - t0), refused: false, error: err?.message ?? String(err) };
        }
    }
}

/** A scripted client for tests: one handler per role, or a queue of outputs. */
export class FakeModelClient implements ModelClient {
    readonly calls: Array<{ role: ModelCallRecord['role']; model: string; effort: Effort; system: string; user: string }> = [];
    constructor(private readonly handlers: Partial<Record<ModelCallRecord['role'], (call: { user: string; system: string; n: number }) => unknown | { refused: true } | { error: string }>>) {}
    async structured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
        this.calls.push({ role: call.role, model: call.model, effort: call.effort, system: call.system, user: call.user });
        const n = this.calls.filter((c) => c.role === call.role).length;
        const h = this.handlers[call.role];
        const record = { ...emptyRecord(call.role, call.model, call.effort, 1), inputTokens: 100, outputTokens: 50, costPence: computeCostPence({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }, call.model) };
        if (!h) return { output: null, record, refused: false, error: `no fake handler for ${call.role}` };
        const out = await h({ user: call.user, system: call.system, n });
        if (out && typeof out === 'object' && 'refused' in out) return { output: null, record, refused: true, error: 'the model declined the request' };
        if (out && typeof out === 'object' && 'error' in out && Object.keys(out).length === 1) return { output: null, record, refused: false, error: String((out as { error: string }).error) };
        const parsed = call.schema.safeParse(out);
        if (!parsed.success) return { output: null, record, refused: false, error: `fake output does not fit the schema: ${parsed.error.message}` };
        return { output: parsed.data, record, refused: false, error: null };
    }
}
