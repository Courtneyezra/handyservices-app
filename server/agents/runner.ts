/**
 * Minimal agent runner — the reusable harness for every HandyServices agent.
 *
 * WHAT AN AGENT IS (the whole trick, no magic):
 *   1. A SYSTEM PROMPT  — who the agent is, what "done" looks like, hard rules.
 *   2. A TOOL BELT      — typed functions Claude may call. Claude reads each
 *                         tool's `description` to decide when to use it, and
 *                         the `input_schema` to know what arguments to pass.
 *   3. A LOOP           — call Claude; if it asks to use tools, run them and
 *                         feed the results back; repeat until it answers in
 *                         plain text (or the turn cap trips).
 *
 * OBSERVABILITY: every step is pushed onto a transcript (and narrated to the
 * console) — assistant text, each tool call with its input, each tool result.
 * That trail is the whole point of the first project: you can watch the agent
 * decide, not just read its answer.
 */
import { getAnthropic } from '../anthropic';
import type Anthropic from '@anthropic-ai/sdk';
import { newRunId } from '../approver';
import { computeCostPence } from '../agent-cost';

export interface AgentTool {
    name: string;
    /** Claude READS this to decide when to call the tool — write it for the
     *  model: say when to use it, not just what it does. */
    description: string;
    input_schema: Anthropic.Tool.InputSchema;
    run: (input: any) => Promise<unknown>;
}

/**
 * A tool result that carries media the model should SEE, not just read about.
 * Return `{ data, mediaBlocks }` from a tool and the runner sends the data as
 * text plus the blocks (images, interleaved with caption text blocks) in the
 * same tool_result — this is how photos/video frames become real context.
 */
export interface MediaToolResult {
    data: unknown;
    mediaBlocks: Anthropic.ContentBlockParam[];
}

function isMediaToolResult(r: unknown): r is MediaToolResult {
    return !!r && typeof r === 'object' && Array.isArray((r as any).mediaBlocks);
}

export interface AgentTranscriptEvent {
    at: string;
    type: 'assistant_text' | 'tool_call' | 'tool_result' | 'tool_error' | 'done' | 'turn_cap' | 'truncated';
    detail: any;
}

export interface AgentRunResult {
    finalText: string;
    transcript: AgentTranscriptEvent[];
    turns: number;
    /** Exact token spend for the whole run, summed across turns, straight from the API. */
    usage: AgentRunUsage;
    /** The agent_runs.id this run was recorded under (Phase 1). Every write the run made carries it. */
    runId: string;
    model: string;
    /** Whole pence from usage × model price; null when the model is not in the price table. */
    costPence: number | null;
    durationMs: number;
}

/** What the runner persists about a run — see server/agent-runs.ts. Loaded lazily so this module needs no db. */
interface RunPersistence {
    startAgentRun: (input: {
        id?: string; agent: string; trigger?: string | null; conversationId?: string | null; phone?: string | null;
        model?: string | null; packId?: string | null; packVersion?: number | null; caseFileRef?: string | null;
        promptHash?: string | null; transcriptRef?: string | null; parentRunId?: string | null;
    }) => Promise<string>;
    finishAgentRun: (
        id: string,
        meta: { agent: string; conversationId?: string | null; phone?: string | null },
        patch: { usage?: AgentRunUsage | null; model?: string | null; error?: string | null; durationMs?: number | null; transcriptRef?: string | null; turns?: number | null },
    ) => Promise<{ costPence: number | null }>;
}

async function loadPersistence(): Promise<RunPersistence | null> {
    try {
        return await import('../agent-runs');
    } catch (error: any) {
        console.warn('[agent-runner] agent_runs persistence unavailable (run continues unrecorded):', error?.message ?? error);
        return null;
    }
}

export interface AgentRunUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}

export async function runAgent(opts: {
    name: string;
    system: string;
    goal: string;
    tools: AgentTool[];
    model?: string;
    maxTurns?: number;
    maxTokens?: number;
    /** Live observer: called with each transcript event as it is appended (assistant text,
     *  tool calls/results, done, …). Purely additive — a listener error never breaks a run. */
    onEvent?: (evt: AgentTranscriptEvent) => void;
    /** Prior conversation turns (already role-shaped), injected verbatim BEFORE the current
     *  goal message — how a chat-session agent (ops manager) carries its history into a run.
     *  Purely additive: omitted means exactly the old single-goal behaviour. */
    priorMessages?: Anthropic.MessageParam[];
    // ---- Phase 1 (2 Sep 2026): run identity, persisted to agent_runs by the runner ----
    /** Use the caller's run id (minted up front so its tools can stamp drafts/flags before the run ends); else newRunId('run'). */
    runId?: string;
    /** What started the run: inbound_message | sla_sweep | ops_manager | manual | … */
    trigger?: string;
    conversationId?: string | null;
    /** E.164 of the customer the run is about, for the ledger's run rows. */
    phone?: string | null;
    packId?: string;
    packVersion?: number;
    caseFileRef?: string;
    promptHash?: string;
    transcriptRef?: string;
    /** P6: the spine run this run is a child of (agent_runs.parent_run_id), when a spine agent wraps this runner. */
    parentRunId?: string | null;
    /** false = do not write agent_runs / ledger rows (dry runs, tests). Default true. */
    persist?: boolean;
}): Promise<AgentRunResult> {
    const client = getAnthropic();
    const model = opts.model || 'claude-opus-5';
    const maxTurns = opts.maxTurns ?? 8;
    const transcript: AgentTranscriptEvent[] = [];

    // ---- Phase 1: the run exists as a row before the first model call, and is completed whatever
    // happens after — success, turn cap, truncation or a thrown tool. Never lets bookkeeping fail a run.
    const runId = opts.runId ?? newRunId('run');
    const startedAt = Date.now();
    const agentName = opts.name.split(':')[0];
    const persistence = opts.persist === false ? null : await loadPersistence();
    if (persistence) {
        await persistence.startAgentRun({
            id: runId, agent: agentName, trigger: opts.trigger ?? null, conversationId: opts.conversationId ?? null,
            phone: opts.phone ?? null, model, packId: opts.packId ?? null, packVersion: opts.packVersion ?? null,
            caseFileRef: opts.caseFileRef ?? null, promptHash: opts.promptHash ?? null, transcriptRef: opts.transcriptRef ?? null,
            parentRunId: opts.parentRunId ?? null,
        }).catch(() => undefined);
    }
    const log = (type: AgentTranscriptEvent['type'], detail: any) => {
        const evt: AgentTranscriptEvent = { at: new Date().toISOString(), type, detail };
        transcript.push(evt);
        if (opts.onEvent) {
            try { opts.onEvent(evt); } catch (err) {
                console.warn(`[agent:${opts.name}] onEvent listener failed (run continues):`, err instanceof Error ? err.message : err);
            }
        }
        const label = `[agent:${opts.name}]`;
        if (type === 'tool_call') console.log(`${label} → ${detail.tool}(${JSON.stringify(detail.input).slice(0, 160)})`);
        else if (type === 'tool_result') console.log(`${label} ← ${detail.tool}: ${JSON.stringify(detail.result).slice(0, 160)}…`);
        else if (type === 'assistant_text' && detail.text) console.log(`${label} 💬 ${String(detail.text).slice(0, 200)}`);
        // stop_reason on the console, not just in the transcript. A turn that ended because it ran
        // out of output tokens looks exactly like a turn that finished its work, and an agent whose
        // whole job is "never go silent" must not be able to go silent invisibly.
        else if (type !== 'assistant_text') console.log(`${label} ${type}${detail?.stop_reason ? ` (stop_reason=${detail.stop_reason})` : ''}`);
    };

    const toolSchemas: Anthropic.Tool[] = opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
    }));
    const toolByName = new Map(opts.tools.map((t) => [t.name, t]));

    const messages: Anthropic.MessageParam[] = [...(opts.priorMessages ?? []), { role: 'user', content: opts.goal }];
    let finalText = '';
    let turns = 0;
    const usage: AgentRunUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    /** Completes the agent_runs row. Called exactly once, from the finally below. */
    const finish = async (error: string | null): Promise<number | null> => {
        const durationMs = Date.now() - startedAt;
        if (!persistence) return computeCostPence(usage, model);
        const { costPence } = await persistence.finishAgentRun(
            runId, { agent: agentName, conversationId: opts.conversationId ?? null, phone: opts.phone ?? null },
            { usage, model, error, durationMs, transcriptRef: opts.transcriptRef ?? null, turns },
        ).catch(() => ({ costPence: computeCostPence(usage, model) }));
        return costPence;
    };
    const finished = (): Pick<AgentRunResult, 'runId' | 'model' | 'durationMs'> => ({ runId, model, durationMs: Date.now() - startedAt });

    let runError: string | null = null;
    try {

    // PROMPT CACHING — the single biggest cost lever on an agent loop. Without it, every turn
    // re-bills the full system prompt, tool schemas, thread history and images at full price, so
    // a 5-turn run pays for its context five times over (19 Aug 2026: ~$20 burned in a day, almost
    // all of it exactly this). One marker on the system block caches the tools+system prefix; a
    // moving marker on the latest message makes each turn a cache READ (~10% price) of everything
    // before it. Markers must move, not accumulate — the API allows at most 4.
    const stripCacheMarkers = (msgs: Anthropic.MessageParam[]) => {
        for (const m of msgs) {
            if (!Array.isArray(m.content)) continue;
            for (const block of m.content) delete (block as any).cache_control;
        }
    };
    const markLastBlock = (msgs: Anthropic.MessageParam[]) => {
        const last = msgs[msgs.length - 1];
        if (!last) return;
        if (typeof last.content === 'string') {
            last.content = [{ type: 'text', text: last.content }];
        }
        const blocks = last.content as any[];
        if (blocks.length) blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
    };

    while (turns < maxTurns) {
        turns++;
        stripCacheMarkers(messages);
        markLastBlock(messages);
        const response = await client.messages.create({
            model,
            max_tokens: opts.maxTokens ?? 8000,
            system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
            tools: toolSchemas,
            messages,
        });

        // What this turn actually cost, straight from the API — the answer to "what is eating
        // credits" must be readable off a run's console output, not reconstructed from a bill.
        usage.inputTokens += response.usage.input_tokens;
        usage.outputTokens += response.usage.output_tokens;
        usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
        usage.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;
        console.log(
            `[agent:${opts.name}] turn ${turns} tokens: in=${response.usage.input_tokens} `
            + `out=${response.usage.output_tokens} cache_read=${response.usage.cache_read_input_tokens ?? 0} `
            + `cache_write=${response.usage.cache_creation_input_tokens ?? 0}`,
        );

        // Narrate any text the model wrote this turn (its visible reasoning).
        for (const block of response.content) {
            if (block.type === 'text' && block.text.trim()) {
                log('assistant_text', { text: block.text });
                finalText = block.text;
            }
        }

        // A turn that ran out of output tokens did not finish deciding, and until 19 Aug 2026 it was
        // indistinguishable from one that did: stop_reason was recorded but never acted on, so a
        // truncated first turn returned an empty, successful-looking run. The comms agent's whole
        // contract is that it drafts, asks, or explains itself — "silently did nothing, reported
        // success" is the one outcome it must not have. Any truncation is a failed run, including a
        // truncated tool_use, whose arguments may be cut off mid-JSON and must never be executed.
        if (response.stop_reason === 'max_tokens') {
            log('truncated', { stop_reason: response.stop_reason, turns, textSoFar: finalText.slice(0, 200) });
            throw new Error(
                `Agent "${opts.name}" hit max_tokens (${opts.maxTokens ?? 8000}) on turn ${turns} and produced no usable action. `
                + 'The run is failed rather than reported as done, because a truncated turn that decided nothing '
                + 'must not look like a turn that decided to do nothing. Raise maxTokens or shorten the context.',
            );
        }

        if (response.stop_reason !== 'tool_use') {
            log('done', { stop_reason: response.stop_reason });
            return { finalText, transcript, turns, usage, costPence: computeCostPence(usage, model), ...finished() };
        }

        // The model asked for tools: run every requested call (in parallel),
        // then hand ALL results back in a single user message — that's the
        // wire contract for parallel tool use.
        const toolUses = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        messages.push({ role: 'assistant', content: response.content });

        const results = await Promise.all(toolUses.map(async (tu) => {
            const tool = toolByName.get(tu.name);
            log('tool_call', { tool: tu.name, input: tu.input });
            try {
                if (!tool) throw new Error(`Unknown tool: ${tu.name}`);
                const result = await tool.run(tu.input);
                if (isMediaToolResult(result)) {
                    // Log the data and the block count — never the base64 payloads.
                    log('tool_result', { tool: tu.name, result: result.data, mediaBlocks: result.mediaBlocks.length });
                    return {
                        type: 'tool_result' as const,
                        tool_use_id: tu.id,
                        content: [
                            { type: 'text' as const, text: JSON.stringify(result.data) },
                            ...result.mediaBlocks,
                        ],
                    };
                }
                log('tool_result', { tool: tu.name, result });
                return {
                    type: 'tool_result' as const,
                    tool_use_id: tu.id,
                    content: JSON.stringify(result),
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log('tool_error', { tool: tu.name, error: message });
                // is_error tells the model the call failed so it can adapt.
                return {
                    type: 'tool_result' as const,
                    tool_use_id: tu.id,
                    content: `Error: ${message}`,
                    is_error: true,
                };
            }
        }));
        messages.push({ role: 'user', content: results });
    }

    log('turn_cap', { maxTurns });
    return { finalText, transcript, turns, usage, costPence: computeCostPence(usage, model), ...finished() };
    } catch (error: any) {
        runError = error?.message ?? String(error);
        throw error;
    } finally {
        await finish(runError);
    }
}
