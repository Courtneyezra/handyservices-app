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
    type: 'assistant_text' | 'tool_call' | 'tool_result' | 'tool_error' | 'done' | 'turn_cap';
    detail: any;
}

export interface AgentRunResult {
    finalText: string;
    transcript: AgentTranscriptEvent[];
    turns: number;
}

export async function runAgent(opts: {
    name: string;
    system: string;
    goal: string;
    tools: AgentTool[];
    model?: string;
    maxTurns?: number;
    maxTokens?: number;
}): Promise<AgentRunResult> {
    const client = getAnthropic();
    const model = opts.model || 'claude-opus-5';
    const maxTurns = opts.maxTurns ?? 8;
    const transcript: AgentTranscriptEvent[] = [];
    const log = (type: AgentTranscriptEvent['type'], detail: any) => {
        transcript.push({ at: new Date().toISOString(), type, detail });
        const label = `[agent:${opts.name}]`;
        if (type === 'tool_call') console.log(`${label} → ${detail.tool}(${JSON.stringify(detail.input).slice(0, 160)})`);
        else if (type === 'tool_result') console.log(`${label} ← ${detail.tool}: ${JSON.stringify(detail.result).slice(0, 160)}…`);
        else if (type === 'assistant_text' && detail.text) console.log(`${label} 💬 ${String(detail.text).slice(0, 200)}`);
        else if (type !== 'assistant_text') console.log(`${label} ${type}`);
    };

    const toolSchemas: Anthropic.Tool[] = opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
    }));
    const toolByName = new Map(opts.tools.map((t) => [t.name, t]));

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.goal }];
    let finalText = '';
    let turns = 0;

    while (turns < maxTurns) {
        turns++;
        const response = await client.messages.create({
            model,
            max_tokens: opts.maxTokens ?? 8000,
            system: opts.system,
            tools: toolSchemas,
            messages,
        });

        // Narrate any text the model wrote this turn (its visible reasoning).
        for (const block of response.content) {
            if (block.type === 'text' && block.text.trim()) {
                log('assistant_text', { text: block.text });
                finalText = block.text;
            }
        }

        if (response.stop_reason !== 'tool_use') {
            log('done', { stop_reason: response.stop_reason });
            return { finalText, transcript, turns };
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
    return { finalText, transcript, turns };
}
