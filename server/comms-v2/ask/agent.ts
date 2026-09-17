/**
 * Handy Desk - the ask agent: Ben's ask bar over the new comms desk.
 *
 * One turn: Ben asks, in the context of the card in front of him; the agent reads the comms-v2
 * board and case files, may hold one drafted reply for him, and answers with an OpsAnswer
 * (shared/ops-types.ts) that the answer surface renders. It is not the old Ops Manager
 * (server/agents/ops-manager.ts) and shares nothing with it but the wire shapes.
 *
 * The desk's model rule (desk/models.ts): Haiku 4.5 routes, Sonnet 5 reasons, the strongest model
 * writes.
 *   route    ROUTER_MODEL, one structured call: which surface the ask wants, whether it asks for a
 *            money action (refused here, before any tool runs: no money actions yet), and whether
 *            it wants a draft. A failed route falls through to the reasoner with no hint.
 *   reason   SPECIALIST_MODEL, the tool loop (server/agents/runner.ts, the generic harness), with
 *            tools.ts: board and case-file reads, draft_reply, give_answer.
 *   write    COMPOSER_MODEL, inside draft_reply (composer.ts): the customer's words.
 *
 * The answer's data is read off the store after the loop (surface.ts), never taken from the model.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import type { AskContext, AskVia, LeanRunStep, OpsAnswer, OpsMessageDTO } from '@shared/ops-types';
import type { AgentRunResult, AgentTool, AgentTranscriptEvent } from '../../agents/runner';
import type { ApproverSlot, CaseFile, ModelCallRecord } from '../desk/case-file';
import { AnthropicModelClient, ROUTER_MODEL, SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import type { ApproverAssignments } from '../api/approvers';
import type { BoardSource } from '../api/store';
import { askTools, newRunState, type AskRunState } from './tools';
import { buildAnswer, customerOf, fileAnswersTo } from './surface';

export const ASK_AGENT_NAME = 'comms-v2-ask';
/** Most recent session messages fed to the reasoner as prior turns. */
export const HISTORY_CAP = 20;
export const MAX_TURNS = 10;

export const MONEY_REFUSAL = 'Money actions are not on the Handy Desk yet, so I have not touched any price, invoice or payment. Use the price screen or the invoice pages for that.';

const RouteSchema = z.object({
    surface: z.enum(['thread', 'floor', 'words', 'diary', 'map', 'quote', 'ledger']).describe('What the answer should show.'),
    moneyAction: z.boolean().describe('True only when the ask is to change, send, chase, pay, refund or discount money: a price, a quote figure, an invoice or a payment. Reading or asking about money is false.'),
    wantsDraft: z.boolean().describe('True when the ask is to write, draft, reply to or message a customer.'),
});
export type AskRoute = z.infer<typeof RouteSchema>;

export const ASK_ROUTER_SYSTEM = `You route one request Ben, the owner of a handyman business, typed or said into his ops desk. Pick what the answer should show:
- thread: one customer's conversation ("what did Rob say", "show me Gemma", "reply to Sam").
- floor: the whole board or the overall state ("what's waiting", "show the floor", "how many are held").
- diary: bookings, moving a job, a contractor's week.
- map: where jobs or contractors are.
- quote: a price or a quote's lines.
- ledger: who owes what, invoices, payments.
- words: anything else.
Set moneyAction only for a request to change or move money. Set wantsDraft when he wants a message written to a customer.`;

export const ASK_SYSTEM = `You are the Handy Desk: the ops desk Ben, the owner of Handy Services (a small handyman business), talks to. You answer in the context of the card he has selected. Ben decides; you look things up and prepare.

What you can do:
- Read the new comms desk: get_board (every case file as a card), find_case_files, get_case_file (one conversation in full).
- Hold ONE drafted reply for Ben with draft_reply. It never sends. Ben reads the draft and sends it himself with one tap. Only draft when he asks you to reply, message or answer a customer, or clearly wants one.
- End with give_answer, exactly once, then one short closing line.

Rules:
1. You never send anything to anyone. There is no send tool.
2. No money actions: never change, send or chase a price, quote, invoice or payment. You may report what a file says.
3. Drafts carry no price, date, time, commitment or business claim; the desk refuses them. If a reply needs one of those, tell Ben what to say himself instead of drafting.
4. Diary, map, quote and ledger views are not connected to this desk yet. If asked, answer in words with what the case files show and say so.
5. Never invent data: every name, count and quote from a customer must come from a tool result. If the selected card is named, start there.
6. If a draft is refused, say why in plain words; do not retry more than once with a different brief.
7. Earlier messages in this conversation describe the desk as it was then. What is held, waiting or drafted now comes only from this ask's fresh read and your tool results.

Answer surface: "thread" for one customer's conversation (always when you drafted or looked at one file), "floor" for the whole board, "words" otherwise. finalText is one to three short sentences, UK English, plain, no markdown.`;

/** The reasoner loop: the generic runner, or a fake in tests. */
export type AskLoop = (opts: {
    name: string;
    system: string;
    goal: string;
    tools: AgentTool[];
    model: string;
    maxTurns: number;
    priorMessages: Anthropic.MessageParam[];
    trigger: string;
    onEvent: (evt: AgentTranscriptEvent) => void;
}) => Promise<Pick<AgentRunResult, 'finalText' | 'usage'> & Partial<Pick<AgentRunResult, 'runId'>>>;

const defaultLoop: AskLoop = async (opts) => {
    const { runAgent } = await import('../../agents/runner');
    return runAgent(opts);
};

export interface RunAskTurnOptions {
    sessionId: string;
    userMessage: string;
    via: AskVia;
    context: AskContext | null;
    /** Prior session messages, oldest first, including this ask. */
    history: Pick<OpsMessageDTO, 'role' | 'content'>[];
    /** The signed-in person: their email or user id. */
    person: string;
    approver: ApproverSlot | null;
    onEvent?: (step: LeanRunStep) => void;
}

export interface RunAskTurnResult {
    answer: OpsAnswer;
    leanTranscript: LeanRunStep[];
    usage: { loop: unknown; calls: ModelCallRecord[] };
}

export interface AskTurnDeps {
    source: () => Promise<BoardSource>;
    assignments: () => Promise<ApproverAssignments>;
    client?: ModelClient;
    loop?: AskLoop;
    /** Shapes a runner event for the wire (server/agents/transcript-lean.ts by default). */
    lean?: (evt: AgentTranscriptEvent) => LeanRunStep;
    now?: () => Date;
}

/** The session history as runner prior messages: recent, non-empty, strictly alternating, user first, and not ending on a user turn (the ask follows). */
export function historyToPriorMessages(history: Pick<OpsMessageDTO, 'role' | 'content'>[]): Anthropic.MessageParam[] {
    const recent = history.slice(-HISTORY_CAP).filter((m) => (m.content ?? '').trim().length > 0);
    const merged: Anthropic.MessageParam[] = [];
    for (const m of recent) {
        const last = merged[merged.length - 1];
        if (last && last.role === m.role && typeof last.content === 'string') last.content = `${last.content}\n\n${m.content}`;
        else merged.push({ role: m.role, content: m.content });
    }
    while (merged.length && merged[0].role === 'assistant') merged.shift();
    while (merged.length && merged[merged.length - 1].role === 'user') merged.pop();
    return merged;
}

/** The file the ask is about: by id, else by the customer's address. */
export function contextFile(files: CaseFile[], context: AskContext | null): CaseFile | null {
    const id = context?.caseFileId?.trim();
    if (id) return files.find((f) => f.id === id) ?? null;
    const phone = context?.phone?.trim();
    if (!phone) return null;
    const hits = files.filter((f) => fileAnswersTo(f, phone));
    hits.sort((a, b) => (a.stage === 'done' ? 1 : 0) - (b.stage === 'done' ? 1 : 0) || Date.parse(b.openedAt) - Date.parse(a.openedAt));
    return hits[0] ?? null;
}

/** Characters of a fresh read the goal carries. */
const FRESH_READ_CAP = 12000;

function goalFor(opts: RunAskTurnOptions, selected: CaseFile | null, route: AskRoute | null, fresh: { tool: string; result: unknown } | null): string {
    const lines = [`Ben ${opts.via === 'voice' ? 'said' : opts.via === 'tap' ? 'tapped' : 'typed'}: ${opts.userMessage}`];
    if (selected) {
        const party = customerOf(selected);
        lines.push(`Selected card: case file ${selected.id} (${party?.name ?? 'no name'}, ${selected.stage}${selected.hold ? ', held' : ''}).`);
    } else if (opts.context?.caseFileId || opts.context?.phone) {
        lines.push('The selected card is not on the desk any more.');
    } else {
        lines.push('No card is selected.');
    }
    if (route) lines.push(`Router hint: surface ${route.surface}${route.wantsDraft ? ', wants a draft' : ''}.`);
    if (fresh) {
        const json = JSON.stringify(fresh.result);
        lines.push(`Fresh ${fresh.tool} read, taken for this ask (the current state; answer from this, not from earlier messages):\n${json.length > FRESH_READ_CAP ? `${json.slice(0, FRESH_READ_CAP)}...` : json}`);
    }
    return lines.join('\n');
}

async function routeAsk(client: ModelClient, opts: RunAskTurnOptions, selected: CaseFile | null): Promise<{ route: AskRoute | null; record: ModelCallRecord; error: string | null }> {
    const user = `${selected ? `A card is selected (${customerOf(selected)?.name ?? 'a customer'}).` : 'No card is selected.'}\nBen: ${opts.userMessage}`;
    const res = await client.structured({ role: 'router', model: ROUTER_MODEL, effort: 'low', system: ASK_ROUTER_SYSTEM, user, schema: RouteSchema, maxTokens: 300 });
    return { route: res.output, record: res.record, error: res.refused ? 'the routing model declined' : res.error };
}

export async function runAskTurn(opts: RunAskTurnOptions, deps: AskTurnDeps): Promise<RunAskTurnResult> {
    const client = deps.client ?? new AnthropicModelClient();
    const loop = deps.loop ?? defaultLoop;
    const lean = deps.lean ?? (await import('../../agents/transcript-lean')).leanTranscriptEvent;
    const now = deps.now ?? (() => new Date());
    const leanTranscript: LeanRunStep[] = [];
    const push = (step: LeanRunStep) => {
        leanTranscript.push(step);
        if (opts.onEvent) {
            try { opts.onEvent(step); } catch (err) {
                console.warn('[AskAgent] onEvent listener failed (run continues):', err instanceof Error ? err.message : err);
            }
        }
    };
    const state: AskRunState = newRunState();
    const assignments = await deps.assignments();

    const initial = await deps.source();
    const selected = contextFile(initial.store.all(), opts.context);

    const routed = await routeAsk(client, opts, selected);
    state.calls.push(routed.record);
    push({ at: now().toISOString(), type: 'route', detail: routed.route ?? { error: routed.error } });

    const answerFrom = async (fallbackText: string): Promise<OpsAnswer> => {
        const src = await deps.source();
        const chosen = state.answer;
        const files = src.store.all();
        const selectedNow = selected ? files.find((f) => f.id === selected.id) ?? null : null;
        // The reasoner often closes without give_answer: fall back to what it drafted, then the
        // router's floor, then the selected card.
        const choice = chosen?.surface
            ?? (state.drafted.length ? { type: 'thread' as const, caseFileId: state.drafted[state.drafted.length - 1] }
                : routed.route?.surface === 'floor' ? { type: 'floor' as const }
                : selectedNow ? { type: 'thread' as const, caseFileId: selectedNow.id } : { type: 'words' as const });
        const drafted = Array.from(new Set(state.drafted));
        const notes = [chosen?.note ?? null, drafted.length > 1 ? `${drafted.length} drafts are held; send each from its own card.` : null].filter(Boolean).join(' ');
        return buildAnswer({ finalText: chosen?.finalText ?? fallbackText, choice, files, assignments, drafted, note: notes || null });
    };

    if (routed.route?.moneyAction) {
        const answer = await answerFrom(MONEY_REFUSAL);
        return { answer: { ...answer, note: 'No money actions yet.' }, leanTranscript, usage: { loop: null, calls: state.calls } };
    }

    const tools = askTools({ source: deps.source, assignments, approver: opts.approver, person: opts.person, client, now }, state);

    // The session carries earlier runs' answers, which go stale: a floor ask reads the board and a
    // thread ask reads the selected file before the reasoner starts, whatever the history says.
    const freshRead = routed.route?.surface === 'floor' ? { tool: 'get_board', input: {} }
        : selected && (!routed.route || routed.route.surface === 'thread') ? { tool: 'get_case_file', input: { caseFileId: selected.id } }
        : null;
    let fresh: { tool: string; result: unknown } | null = null;
    if (freshRead) {
        const tool = tools.find((t) => t.name === freshRead.tool)!;
        push(lean({ at: now().toISOString(), type: 'tool_call', detail: freshRead }));
        const result = await tool.run(freshRead.input);
        push(lean({ at: now().toISOString(), type: 'tool_result', detail: { tool: freshRead.tool, result } }));
        fresh = { tool: freshRead.tool, result };
    }

    const result = await loop({
        name: `${ASK_AGENT_NAME}:${opts.sessionId.slice(0, 8)}`,
        system: ASK_SYSTEM,
        goal: goalFor(opts, selected, routed.route, fresh),
        tools,
        model: SPECIALIST_MODEL,
        maxTurns: MAX_TURNS,
        priorMessages: historyToPriorMessages(opts.history),
        trigger: 'comms_v2_ask_turn',
        onEvent: (evt) => push(lean(evt)),
    });

    const answer = await answerFrom(result.finalText?.trim() || 'I could not finish that.');
    return { answer, leanTranscript, usage: { loop: result.usage ?? null, calls: state.calls } };
}
