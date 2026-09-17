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
 *   route    ROUTER_MODEL, one structured call: the ask's intents, the domains it touches, the
 *            surface it wants, the steps it takes, whether it asks for a money action (refused
 *            here, before any tool runs: no money actions yet), and whether it wants a draft. A
 *            failed route falls through to the reasoner with no hint and every tool group.
 *   reason   SPECIALIST_MODEL, the tool loop (server/agents/runner.ts, the generic harness), over
 *            the tool groups the route names (tool-groups.ts): reads, draft_reply, proposals,
 *            give_answer. At most MAX_TURNS turns.
 *   write    COMPOSER_MODEL, inside draft_reply (composer.ts): the customer's words.
 *
 * No tool changes anything a customer sees: a change is a proposal (actions.ts) that Ben confirms on
 * the answer. A draft the run held is proposed for sending automatically. The answer's data is read
 * off the store after the loop (surface.ts), never taken from the model, and so is where each step
 * of the plan strip stands (plan.ts).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import type { AskContext, AskVia, LeanRunStep, OpsAnswer, OpsMessageDTO } from '@shared/ops-types';
import type { AgentRunResult, AgentTool, AgentTranscriptEvent } from '../../agents/runner';
import type { ApproverSlot, CaseFile, ModelCallRecord } from '../desk/case-file';
import { AnthropicModelClient, ROUTER_MODEL, SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import type { ApproverAssignments } from '../api/approvers';
import type { BoardSource } from '../api/store';
import { newRunState, proposeInRun, type AskRunState, type AskToolDeps } from './tools';
import { buildAnswer, customerOf, fileAnswersTo } from './surface';
import { ASK_DOMAINS, offeredDomains, toolsFor, type AskDomain } from './tool-groups';
import type { AskActionStore } from './actions';
import type { ActionKinds } from './action-kinds';
import { buildPlan, cleanSteps } from './plan';

export const ASK_AGENT_NAME = 'comms-v2-ask';
/** Most recent session messages fed to the reasoner as prior turns. */
export const HISTORY_CAP = 20;
export const MAX_TURNS = 10;

export const MONEY_REFUSAL = 'Money actions are not on the Handy Desk yet, so I have not touched any price, invoice or payment. Use the price screen or the invoice pages for that.';

export const ASK_INTENTS = ['find', 'show', 'message', 'book', 'call', 'note'] as const;

export const RouteSchema = z.object({
    intents: z.array(z.enum(ASK_INTENTS)).describe('What Ben wants done, every one that applies.'),
    domains: z.array(z.enum(ASK_DOMAINS)).describe('The parts of the business the ask touches, every one that applies.'),
    surface: z.enum(['thread', 'floor', 'words', 'diary', 'map', 'quote', 'ledger', 'pick', 'client', 'booking', 'contractor']).describe('What the answer should show.'),
    steps: z.array(z.string()).describe('The steps the ask takes, in order, each a few words. One step for a simple ask.'),
    moneyAction: z.boolean().describe('True only when the ask is to change, send, chase, pay, refund or discount money: a price, a quote figure, an invoice or a payment. Reading or asking about money is false.'),
    wantsDraft: z.boolean().describe('True when the ask is to write, draft, reply to or message a customer.'),
});
export type AskRoute = z.infer<typeof RouteSchema>;

export const ASK_ROUTER_SYSTEM = `You route one request Ben, the owner of a handyman business, typed or said into his ops desk.
Intents, every one that applies: find (look someone or something up), show (bring up a record), message (write to a customer), book (a booking or the diary), call (ring someone), note (write something on a file).
Domains, every one the ask touches: clients (customers, landlords, tenants, companies), quotes, bookings (bookings and the diary), contractors, messages (conversations, held drafts, the board), calls, invoices.
Pick what the answer should show:
- thread: one customer's conversation ("what did Rob say", "show me Gemma", "reply to Sam").
- floor: the whole board or the overall state ("what's waiting", "show the floor", "how many are held").
- client: one customer's record.
- pick: when the ask names someone who may be several people.
- quote: a price or a quote's lines.
- booking: one booking.
- diary: the week's bookings, moving a job, a contractor's week.
- contractor: one contractor.
- map: where jobs or contractors are.
- ledger: who owes what, invoices, payments.
- words: anything else.
Steps: the ask broken into its steps in order, a few words each ("Find Marcus", "Move to Tue 23", "Tell Marcus"); one step for a simple ask.
Set moneyAction only for a request to change or move money. Set wantsDraft when he wants a message written to a customer.`;

export const ASK_SYSTEM = `You are the Handy Desk: the ops desk Ben, the owner of Handy Services (a small handyman business), talks to. You answer in the context of the card he has selected. Ben decides; you look things up and prepare.

What you can do:
- Read with the tools you are given. Every tool reads; none changes anything a customer sees.
- Hold ONE drafted reply for Ben with draft_reply. It never sends. A draft you hold is proposed for sending: Ben reads it and confirms. Only draft when he asks you to reply, message or answer a customer, or clearly wants one.
- Propose ONE change per turn with a propose_ tool (for example propose_send_held_draft). Nothing runs until Ben confirms it on your answer. After proposing, stop and answer: the next step is proposed after he confirms, on a fresh read.
- End with give_answer, exactly once, then one short closing line. For an ask with more than one step, give its plan, marking the steps you finished.

Rules:
1. You never send or change anything yourself. Every change is a proposal Ben confirms, one at a time. If a proposal is refused, stop: tell Ben why in plain words and propose nothing more.
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
    /** The ask run: the proposals it saves carry it, so its answer message can be named on them. */
    askRunId?: string | null;
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
    /** Where proposals are saved; without one, nothing is proposed. */
    actions?: AskActionStore;
    kinds?: ActionKinds;
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
    if (route) {
        lines.push(`Router hint: surface ${route.surface}${route.wantsDraft ? ', wants a draft' : ''}.`);
        if (route.steps.length > 1) lines.push(`Steps: ${route.steps.map((s, i) => `${i + 1} ${s}`).join(' · ')}.`);
    }
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
    const domains: readonly AskDomain[] | null = routed.route ? routed.route.domains : null;
    const offered = offeredDomains({ domains, cardSelected: !!selected });
    push({ at: now().toISOString(), type: 'route', detail: routed.route ? { ...routed.route, offered } : { error: routed.error, offered } });

    const toolDeps: AskToolDeps = {
        source: deps.source, assignments, approver: opts.approver, person: opts.person, client, now,
        actions: deps.actions, kinds: deps.kinds, sessionId: opts.sessionId, askRunId: opts.askRunId ?? null,
    };

    let autoRefusal: string | null = null;
    const answerFrom = async (fallbackText: string): Promise<OpsAnswer> => {
        // A draft this run held is offered for sending, as a proposal like any other change.
        const drafted = Array.from(new Set(state.drafted));
        if (drafted.length === 1 && !state.proposal && !state.refusal && deps.actions) {
            const out = await proposeInRun(toolDeps, state, 'draft.release', { caseFileId: drafted[0] });
            if (out.status === 'refused') autoRefusal = `The draft is held but could not be offered for sending: ${out.reason}.`;
        }
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
        const notes = [chosen?.note ?? null, drafted.length > 1 ? `${drafted.length} drafts are held; send each from its own card.` : null, autoRefusal].filter(Boolean).join(' ');
        // Router steps say nothing of what is done, so they stand in only while nothing waits or was refused.
        const steps = chosen?.plan.length ? chosen.plan
            : state.proposal || state.refusal ? [] : cleanSteps(routed.route?.steps ?? []);
        const plan = buildPlan({ steps, proposal: state.proposal, refusal: state.refusal });
        return buildAnswer({ finalText: chosen?.finalText ?? fallbackText, choice, files, assignments, drafted, proposal: state.proposal, plan, note: notes || null, now: now() });
    };

    if (routed.route?.moneyAction) {
        const { plan: _noPlan, ...answer } = await answerFrom(MONEY_REFUSAL);
        return { answer: { ...answer, note: 'No money actions yet.' }, leanTranscript, usage: { loop: null, calls: state.calls } };
    }

    const tools = toolsFor({ domains, cardSelected: !!selected }, toolDeps, state);

    // The session carries earlier runs' answers, which go stale: a floor ask reads the board and a
    // thread ask reads the selected file before the reasoner starts, whatever the history says.
    const freshRead = routed.route?.surface === 'floor' ? { tool: 'get_board', input: {} }
        : selected && (!routed.route || routed.route.surface === 'thread') ? { tool: 'get_case_file', input: { caseFileId: selected.id } }
        : null;
    let fresh: { tool: string; result: unknown } | null = null;
    const freshTool = freshRead ? tools.find((t) => t.name === freshRead.tool) : undefined;
    if (freshRead && freshTool) {
        push(lean({ at: now().toISOString(), type: 'tool_call', detail: freshRead }));
        const result = await freshTool.run(freshRead.input);
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
