/**
 * The ask agent's turn: Haiku 4.5 routes, Sonnet 5 reasons over the comms-v2 board and case files,
 * the writing model writes the one draft it may hold, and the final message carries an OpsAnswer
 * whose data is read off the file. It reads nothing from the old system: no message_drafts, no
 * old inbox board, no old Ops Manager, no VA call sheet, no old comms agent.
 */
import { describe, expect, it, vi } from 'vitest';

const touched = vi.hoisted(() => ({ modules: [] as string[] }));
vi.mock('../../message-drafts', () => { touched.modules.push('message-drafts'); return {}; });
vi.mock('../../inbox-board', () => { touched.modules.push('inbox-board'); return {}; });
vi.mock('../../agents/ops-manager', () => { touched.modules.push('ops-manager'); return {}; });
vi.mock('../../agents/va-call-tasks', () => { touched.modules.push('va-call-tasks'); return {}; });
vi.mock('../../agents/comms', () => { touched.modules.push('agents/comms'); return {}; });

import type { LeanRunStep } from '@shared/ops-types';
import { hold as setHold } from '../desk/case-file';
import { BEN } from '../desk/guards';
import { COMPOSER_MODEL, FakeModelClient, ROUTER_MODEL, SPECIALIST_MODEL } from '../desk/models';
import { MONEY_REFUSAL, contextFile, historyToPriorMessages, runAskTurn, type RunAskTurnOptions } from './agent';
import { ASK_READ_TOOLS, ASK_TOOL_NAMES } from './tools';
import { CLIENT_TOOL_NAMES } from './client-tools';
import { MemoryAskActionStore } from './actions';
import { BEN_PERSON, memorySource, now, scriptedLoop, whatsappFile } from './ask-fixtures';

const route = (over: Record<string, unknown> = {}) => ({ intents: ['show'], domains: ['messages'], surface: 'thread', steps: ['Answer Ben'], moneyAction: false, wantsDraft: false, ...over });

function ask(over: Partial<RunAskTurnOptions> = {}): RunAskTurnOptions {
    return { sessionId: 'session-1', userMessage: 'Ask Sam for a photo of the tap', via: 'typed', context: null, history: [], person: BEN_PERSON, approver: BEN, ...over };
}

describe('the agent reads only the new desk', () => {
    it('offers exactly its read tools, the one draft tool and the answer', async () => {
        const { source } = memorySource([whatsappFile()]);
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const client = new FakeModelClient({ router: () => route({ surface: 'floor' }) });
        await runAskTurn(ask({ userMessage: 'what is waiting?' }), { source, assignments: async () => ({ ben: ['u1'] }), client, loop: scriptedLoop([], seen), now: now() });
        expect(seen.opts.tools.map((t: { name: string }) => t.name)).toEqual([...ASK_TOOL_NAMES]);
        expect(touched.modules).toEqual([]);
    });
});

describe('one turn', () => {
    it('routes on Haiku 4.5, reasons on Sonnet 5, writes the draft on the writing model, and answers with an OpsAnswer read off the file', async () => {
        const file = whatsappFile({ name: 'Sam' });
        const { store, source } = memorySource([file]);
        const client = new FakeModelClient({
            router: () => route({ wantsDraft: true }),
            composer: () => ({ words: 'Thanks Sam, could you send us a photo of the tap?' }),
        });
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const steps: LeanRunStep[] = [];
        const actions = new MemoryAskActionStore();
        const out = await runAskTurn(ask({ context: { caseFileId: file.id }, askRunId: 'ask_run_1', onEvent: (s) => steps.push(s) }), {
            source, assignments: async () => ({ ben: ['u1'] }), client, now: now(), actions,
            loop: scriptedLoop([
                { tool: 'get_case_file', input: { caseFileId: file.id } },
                { tool: 'draft_reply', input: { caseFileId: file.id, brief: 'Ask for a photo of the tap' } },
                { tool: 'give_answer', input: { finalText: 'I have drafted a photo ask for Sam.', surface: 'thread', caseFileId: file.id } },
            ], seen),
        });

        expect(client.calls.map((c) => [c.role, c.model])).toEqual([['router', ROUTER_MODEL], ['composer', COMPOSER_MODEL]]);
        expect(ROUTER_MODEL).toBe('claude-haiku-4-5');
        expect(seen.opts.model).toBe(SPECIALIST_MODEL);
        expect(SPECIALIST_MODEL).toBe('claude-sonnet-5');
        expect(seen.opts.goal).toContain(`Selected card: case file ${file.id} (Sam`);

        expect(seen.results[1]).toMatchObject({ status: 'held', caseFileId: file.id });
        expect(store.get(file.id)?.hold?.draft).toBe('Thanks Sam, could you send us a photo of the tap?');
        expect(store.get(file.id)?.sends).toEqual([]);

        expect(out.answer).toEqual({
            finalText: 'I have drafted a photo ask for Sam.',
            surface: {
                type: 'thread', caseFileId: file.id, phone: file.parties[0].channels[0].address, customerName: 'Sam', stage: file.stage,
                turns: [expect.objectContaining({ who: 'customer', body: 'Hi, my kitchen tap is dripping. Can someone have a look?' })],
            },
            outgoing: [{ to: file.parties[0].channels[0].address, channel: 'wa', text: 'Thanks Sam, could you send us a photo of the tap?', actionId: expect.any(String) }],
            confirm: { label: 'Send as is', actionId: expect.any(String), kind: 'draft.release', action: { kind: 'draft.release', args: { caseFileId: file.id } } },
        });
        // The held draft was proposed for sending, and nothing ran.
        const [proposal] = Array.from(actions.rows.values());
        expect(out.answer.confirm?.actionId).toBe(proposal.id);
        expect(out.answer.outgoing?.[0].actionId).toBe(proposal.id);
        expect(proposal).toMatchObject({ kind: 'draft.release', caseFileId: file.id, sessionId: 'session-1', askRunId: 'ask_run_1', proposedBy: BEN_PERSON, status: 'proposed', previewText: 'Thanks Sam, could you send us a photo of the tap?' });
        expect(steps.map((s) => [s.type, s.tool])).toEqual([
            ['route', undefined],
            ['tool_call', 'get_case_file'], ['tool_result', 'get_case_file'],
            ['tool_call', 'get_case_file'], ['tool_result', 'get_case_file'],
            ['tool_call', 'draft_reply'], ['tool_result', 'draft_reply'],
            ['tool_call', 'give_answer'], ['tool_result', 'give_answer'],
        ]);
        expect(out.usage.calls).toHaveLength(2);
        expect(touched.modules).toEqual([]);
    });

    it('holds a draft written on a shut window but offers no confirm, and says why on the note', async () => {
        const file = whatsappFile({ name: 'Sam', at: '2026-09-15T09:00:00.000Z' });
        const { store, source } = memorySource([file]);
        const client = new FakeModelClient({ router: () => route({ wantsDraft: true }), composer: () => ({ words: 'Thanks Sam, could you send us a photo of the tap?' }) });
        const actions = new MemoryAskActionStore();
        const out = await runAskTurn(ask({ context: { caseFileId: file.id } }), {
            source, assignments: async () => ({ ben: ['u1'] }), client, now: now(), actions,
            loop: scriptedLoop([
                { tool: 'draft_reply', input: { caseFileId: file.id, brief: 'Ask for a photo of the tap' } },
                { tool: 'give_answer', input: { finalText: 'I have drafted a photo ask for Sam.', surface: 'thread', caseFileId: file.id } },
            ]),
        });
        expect(store.get(file.id)?.hold?.draft).toBe('Thanks Sam, could you send us a photo of the tap?');
        expect(store.get(file.id)?.sends).toEqual([]);
        expect(actions.rows.size).toBe(0);
        expect(out.answer.confirm).toBeUndefined();
        expect(out.answer.note).toMatch(/^The draft is held but could not be offered for sending: the whatsapp window is shut/);
    });

    it('tries the writer once more when the guards refuse, then holds nothing if it still fails', async () => {
        const file = whatsappFile();
        const { store, source } = memorySource([file]);
        const client = new FakeModelClient({ router: () => route(), composer: () => ({ words: 'It will be £85, see you Friday.' }) });
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const out = await runAskTurn(ask(), {
            source, assignments: async () => ({}), client, now: now(),
            loop: scriptedLoop([
                { tool: 'draft_reply', input: { caseFileId: file.id, brief: 'Tell him the price' } },
                { tool: 'give_answer', input: { finalText: 'I could not draft that: it carried a price.', surface: 'thread', caseFileId: file.id } },
            ], seen),
        });
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(2);
        expect(client.calls[2].user).toContain('Your previous draft was refused');
        expect(seen.results[0]).toMatchObject({ status: 'refused', reason: expect.stringMatching(/guards/) });
        expect(store.get(file.id)?.hold).toBeNull();
        expect(out.answer.outgoing).toBeUndefined();
        expect(out.answer.confirm).toBeUndefined();
    });

    it('drafts nothing for a session with no approver slot', async () => {
        const file = whatsappFile();
        const { store, source } = memorySource([file]);
        const client = new FakeModelClient({ router: () => route(), composer: () => ({ words: 'Could you send a photo?' }) });
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        await runAskTurn(ask({ approver: null }), { source, assignments: async () => ({}), client, now: now(), loop: scriptedLoop([{ tool: 'draft_reply', input: { caseFileId: file.id, brief: 'photo' } }], seen) });
        expect(seen.results[0]).toMatchObject({ status: 'refused', reason: expect.stringMatching(/no approver slot/) });
        expect(client.calls.some((c) => c.role === 'composer')).toBe(false);
        expect(store.get(file.id)?.hold).toBeNull();
    });

    it('refuses a money action before any tool runs', async () => {
        const file = whatsappFile();
        const { source } = memorySource([file]);
        const client = new FakeModelClient({ router: () => route({ surface: 'ledger', moneyAction: true }) });
        const loop = vi.fn();
        const out = await runAskTurn(ask({ userMessage: 'Chase Sam for the £85 he owes', context: { caseFileId: file.id } }), { source, assignments: async () => ({}), client, loop, now: now() });
        expect(loop).not.toHaveBeenCalled();
        expect(out.answer.finalText).toBe(MONEY_REFUSAL);
        expect(out.answer.note).toBe('No money actions yet.');
        expect(out.answer.surface).toMatchObject({ type: 'thread', caseFileId: file.id });
    });

    it('shows the floor from the board\'s own columns, the held card ringed and flagged with its draft', async () => {
        const held = whatsappFile({ name: 'Rob' });
        setHold(held, { approver: BEN, reason: 'money: how much', exception: 'money', draft: 'A draft.' }, { now: now() });
        const quiet = whatsappFile({ name: 'Gemma' });
        const { source } = memorySource([held, quiet]);
        const client = new FakeModelClient({ router: () => route({ surface: 'floor' }) });
        const out = await runAskTurn(ask({ userMessage: 'show me the floor' }), {
            source, assignments: async () => ({}), client, now: now(),
            loop: scriptedLoop([{ tool: 'give_answer', input: { finalText: 'Two files, one held.', surface: 'floor' } }]),
        });
        expect(out.answer.surface.type).toBe('floor');
        if (out.answer.surface.type !== 'floor') return;
        expect(out.answer.surface.bays.map((b) => b.stage)).toEqual(['first_contact', 'scoping', 'ready', 'quoted', 'accepted', 'booked', 'done']);
        const cards = out.answer.surface.bays.flatMap((b) => b.cards);
        expect(cards[0]).toMatchObject({ id: held.id, held: true, hasDraft: true, customerName: 'Rob' });
        expect(cards[1]).toMatchObject({ id: quiet.id, held: false, hasDraft: false });
        // A draft the desk held earlier is not this run's: no confirm is offered for it.
        expect(out.answer.confirm).toBeUndefined();
    });

    it('shows the floor the router asked for when the reasoner never answers', async () => {
        const file = whatsappFile();
        const { source } = memorySource([file]);
        const client = new FakeModelClient({ router: () => route({ surface: 'floor' }) });
        const out = await runAskTurn(ask({ userMessage: 'What is waiting for me on the desk right now?' }), { source, assignments: async () => ({}), client, now: now(), loop: scriptedLoop([]) });
        expect(out.answer.finalText).toBe('Done.');
        expect(out.answer.surface.type).toBe('floor');
        if (out.answer.surface.type !== 'floor') return;
        expect(out.answer.surface.bays.flatMap((b) => b.cards).map((c) => c.id)).toEqual([file.id]);
    });

    it('falls back to words, with the reason, when the thread it names is not on the desk; and to the selected card when it never answers', async () => {
        const file = whatsappFile();
        const { source } = memorySource([file]);
        const client = new FakeModelClient({ router: () => ({ error: 'overloaded' }) });
        const missing = await runAskTurn(ask(), { source, assignments: async () => ({}), client, now: now(), loop: scriptedLoop([{ tool: 'give_answer', input: { finalText: 'Here.', surface: 'thread', caseFileId: 'nope' } }]) });
        expect(missing.answer.surface).toEqual({ type: 'words' });
        expect(missing.answer.note).toMatch(/No case file nope/);

        const silent = await runAskTurn(ask({ context: { phone: file.parties[0].channels[0].address } }), { source, assignments: async () => ({}), client, now: now(), loop: scriptedLoop([]) });
        expect(silent.answer).toMatchObject({ finalText: 'Done.', surface: { type: 'thread', caseFileId: file.id } });
    });
});

describe('a stale session', () => {
    const staleHistory = [
        { role: 'user' as const, content: 'What needs me?' },
        { role: 'assistant' as const, content: "One item needs you: Sam's file (kitchen cupboard) is held with a drafted reply." },
    ];

    it('answers "What needs me?" from the board as it is now, not from an earlier answer', async () => {
        const sam = whatsappFile({ name: 'Sam', body: 'Can you fix my kitchen cupboard?' });
        const shelf = whatsappFile({ name: 'Priya', body: 'I need a shelf put up.' });
        setHold(shelf, { approver: BEN, reason: 'money: how much', exception: 'money' }, { now: now() });
        const { source } = memorySource([sam, shelf]);
        const client = new FakeModelClient({ router: () => route({ surface: 'floor' }) });
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const steps: LeanRunStep[] = [];
        // The reasoner calls no tool at all, as it did live: the fresh read must still be there.
        await runAskTurn(ask({ userMessage: 'What needs me?', via: 'tap', history: [...staleHistory, { role: 'user', content: 'What needs me?' }], onEvent: (s) => steps.push(s) }), {
            source, assignments: async () => ({ ben: ['u1'] }), client, now: now(), loop: scriptedLoop([], seen),
        });
        expect(steps.map((s) => [s.type, s.tool])).toEqual([['route', undefined], ['tool_call', 'get_board'], ['tool_result', 'get_board']]);
        expect(seen.opts.priorMessages).toEqual(staleHistory);
        const goal: string = seen.opts.goal;
        const read = JSON.parse(goal.slice(goal.indexOf('{', goal.indexOf('Fresh get_board read'))));
        expect(read).toMatchObject({ total: 2, held: 1 });
        expect(read.cards.map((c: { caseFileId: string; held: boolean }) => [c.caseFileId, c.held])).toEqual([[shelf.id, true], [sam.id, false]]);
    });

    it('answers a thread ask from the selected file\'s current hold', async () => {
        const sam = whatsappFile({ name: 'Sam' });
        setHold(sam, { approver: BEN, reason: 'callback: which door', exception: 'callback', draft: 'Which door should we use?' }, { now: now() });
        const { source } = memorySource([sam]);
        const client = new FakeModelClient({ router: () => route() });
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        await runAskTurn(ask({ userMessage: 'Is this one waiting on me?', context: { caseFileId: sam.id }, history: [...staleHistory, { role: 'user', content: 'Is this one waiting on me?' }] }), {
            source, assignments: async () => ({ ben: ['u1'] }), client, now: now(), loop: scriptedLoop([], seen),
        });
        const goal: string = seen.opts.goal;
        const read = JSON.parse(goal.slice(goal.indexOf('{', goal.indexOf('Fresh get_case_file read'))));
        expect(read).toMatchObject({ caseFileId: sam.id, hold: { reason: 'callback: which door', draft: 'Which door should we use?' } });
    });
});

describe('the router gates the tool groups', () => {
    const names = (seen: { opts?: any }) => seen.opts.tools.map((t: { name: string }) => t.name);

    it('offers only the routed domains\' tools on top of the board and case-file reads, and always the answer', async () => {
        const { source } = memorySource([whatsappFile()]);
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const client = new FakeModelClient({ router: () => route({ intents: ['show'], domains: ['quotes'], surface: 'quote' }) });
        const out = await runAskTurn(ask({ userMessage: 'show me the latest quote for Alan Smith' }), { source, assignments: async () => ({}), client, loop: scriptedLoop([], seen), now: now() });
        expect(names(seen)).toEqual(['get_board', 'find_case_files', 'get_case_file', 'give_answer']);
        expect(out.leanTranscript[0]).toMatchObject({ type: 'route', detail: { domains: ['quotes'], offered: ['quotes'] } });
    });

    it('still offers the reads to "show me Gemma" routed to clients only with no card selected, with the clients group', async () => {
        const { source } = memorySource([whatsappFile({ name: 'Gemma' })]);
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const client = new FakeModelClient({ router: () => route({ intents: ['show'], domains: ['clients'], surface: 'client' }) });
        await runAskTurn(ask({ userMessage: 'show me Gemma', context: null }), { source, assignments: async () => ({}), client, loop: scriptedLoop([], seen), now: now() });
        expect(names(seen)).toEqual(['get_board', 'find_case_files', 'get_case_file', ...CLIENT_TOOL_NAMES, 'give_answer']);
    });

    it('adds the messages group for a selected card or a route naming no domain, and offers every group when the route fails', async () => {
        const file = whatsappFile();
        const { source } = memorySource([file]);
        const run = async (router: () => unknown, context: RunAskTurnOptions['context']) => {
            const seen: { opts?: any; results: unknown[] } = { results: [] };
            const out = await runAskTurn(ask({ context }), { source, assignments: async () => ({}), client: new FakeModelClient({ router }), loop: scriptedLoop([], seen), now: now() });
            return { names: names(seen), offered: (out.leanTranscript[0].detail as { offered: string[] }).offered };
        };
        expect(await run(() => route({ domains: ['quotes'] }), { caseFileId: file.id })).toEqual({ names: [...ASK_TOOL_NAMES], offered: ['quotes', 'messages'] });
        expect(await run(() => route({ domains: [] }), null)).toEqual({ names: [...ASK_TOOL_NAMES], offered: ['messages'] });
        const [answer] = ASK_TOOL_NAMES.slice(-1);
        expect(await run(() => ({ error: 'overloaded' }), null)).toEqual({ names: [...ASK_READ_TOOLS, ...CLIENT_TOOL_NAMES, ...ASK_TOOL_NAMES.slice(ASK_READ_TOOLS.length, -1), answer], offered: ['clients', 'quotes', 'bookings', 'contractors', 'messages', 'calls', 'invoices'] });
    });

    it('passes the router\'s steps to the reasoner, and keeps the turn cap', async () => {
        const { source } = memorySource([whatsappFile()]);
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const client = new FakeModelClient({ router: () => route({ steps: ['Find Marcus', 'Move to Tue 23', 'Tell Marcus'] }) });
        await runAskTurn(ask({ userMessage: 'move Marcus to Tuesday and tell him' }), { source, assignments: async () => ({}), client, loop: scriptedLoop([], seen), now: now() });
        expect(seen.opts.goal).toContain('Steps: 1 Find Marcus · 2 Move to Tue 23 · 3 Tell Marcus.');
        expect(seen.opts.maxTurns).toBe(10);
    });
});

describe('proposals in a run', () => {
    function heldOn(name: string) {
        const file = whatsappFile({ name });
        setHold(file, { approver: BEN, reason: 'guards', exception: null, draft: `Hello ${name}.` }, { now: now() });
        return file;
    }

    it('proposes one change, shows its preview and confirm, and puts it on the plan strip as the current step', async () => {
        const rob = heldOn('Rob');
        const { source, store } = memorySource([rob]);
        const actions = new MemoryAskActionStore();
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const out = await runAskTurn(ask({ userMessage: 'send Rob his draft and note it', context: { caseFileId: rob.id } }), {
            source, assignments: async () => ({ ben: ['u1'] }), client: new FakeModelClient({ router: () => route() }), now: now(), actions,
            loop: scriptedLoop([
                { tool: 'propose_send_held_draft', input: { caseFileId: rob.id } },
                { tool: 'give_answer', input: { finalText: 'Ready to send Rob his draft.', surface: 'thread', caseFileId: rob.id, plan: [{ label: 'Find Rob', done: true }, { label: 'Send the draft', done: false }, { label: 'Note the file', done: false }] } },
            ], seen),
        });
        expect(seen.results[0]).toMatchObject({ status: 'proposed', kind: 'draft.release', preview: 'Hello Rob.' });
        const id = (seen.results[0] as { actionId: string }).actionId;
        expect(out.answer.confirm).toEqual({ label: 'Send as is', actionId: id, kind: 'draft.release', action: { kind: 'draft.release', args: { caseFileId: rob.id } } });
        expect(out.answer.outgoing).toEqual([expect.objectContaining({ text: 'Hello Rob.', actionId: id })]);
        expect(out.answer.plan).toEqual([
            { label: 'Find Rob', state: 'done' },
            { label: 'Send the draft', state: 'current', actionId: id },
            { label: 'Note the file', state: 'waiting' },
        ]);
        expect(store.get(rob.id)?.sends).toEqual([]);
    });

    it('allows one new proposal per run: the next step waits for the confirm', async () => {
        const rob = heldOn('Rob');
        const gemma = heldOn('Gemma');
        const { source } = memorySource([rob, gemma]);
        const actions = new MemoryAskActionStore();
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const out = await runAskTurn(ask({ userMessage: 'send both drafts' }), {
            source, assignments: async () => ({ ben: ['u1'] }), client: new FakeModelClient({ router: () => route() }), now: now(), actions,
            loop: scriptedLoop([
                { tool: 'propose_send_held_draft', input: { caseFileId: rob.id } },
                { tool: 'propose_send_held_draft', input: { caseFileId: gemma.id } },
            ], seen),
        });
        expect(seen.results[1]).toEqual({ status: 'refused', reason: 'one change at a time: draft.release is waiting for Ben\'s confirm, and the next step is proposed after it' });
        expect(actions.rows.size).toBe(1);
        expect(out.answer.confirm?.actionId).toBe((seen.results[0] as { actionId: string }).actionId);
    });

    it('stops the chain at the first refusal and drops the steps after it', async () => {
        const bare = whatsappFile({ name: 'Rob' });
        const gemma = heldOn('Gemma');
        const { source } = memorySource([bare, gemma]);
        const actions = new MemoryAskActionStore();
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const out = await runAskTurn(ask({ userMessage: 'send Rob then Gemma their drafts' }), {
            source, assignments: async () => ({ ben: ['u1'] }), client: new FakeModelClient({ router: () => route({ steps: ['Send Rob his draft', 'Send Gemma hers'] }) }), now: now(), actions,
            loop: scriptedLoop([
                { tool: 'propose_send_held_draft', input: { caseFileId: bare.id } },
                { tool: 'propose_send_held_draft', input: { caseFileId: gemma.id } },
                { tool: 'give_answer', input: { finalText: 'Rob has no draft.', surface: 'words', plan: [{ label: 'Send Rob his draft', done: false }, { label: 'Send Gemma hers', done: false }] } },
            ], seen),
        });
        expect(seen.results[0]).toEqual({ status: 'refused', reason: 'there is no held draft to send' });
        expect(seen.results[1]).toEqual({ status: 'refused', reason: expect.stringMatching(/^the plan stopped at a refusal \(there is no held draft to send\)/) });
        expect(actions.rows.size).toBe(0);
        expect(out.answer.confirm).toBeUndefined();
        expect(out.answer.plan).toEqual([
            { label: 'Send Rob his draft', state: 'refused', reason: 'there is no held draft to send' },
            { label: 'Send Gemma hers', state: 'dropped' },
        ]);
    });

    it('never places a proposal on the router\'s steps: with no plan from the reasoner, they show only while nothing waits', async () => {
        const rob = heldOn('Rob');
        const bare = whatsappFile({ name: 'Gemma' });
        const { source } = memorySource([rob, bare]);
        const actions = new MemoryAskActionStore();
        const client = new FakeModelClient({ router: () => route({ steps: ['Find Rob', 'Draft reply', 'Send reply'] }) });
        const deps = { source, assignments: async () => ({ ben: ['u1'] }), client, now: now(), actions };

        const proposed = await runAskTurn(ask({ context: { caseFileId: rob.id } }), { ...deps, loop: scriptedLoop([{ tool: 'propose_send_held_draft', input: { caseFileId: rob.id } }]) });
        expect(proposed.answer.confirm).toBeDefined();
        expect(proposed.answer.plan).toBeUndefined();

        const refused = await runAskTurn(ask(), { ...deps, loop: scriptedLoop([{ tool: 'propose_send_held_draft', input: { caseFileId: bare.id } }]) });
        expect(refused.answer.plan).toBeUndefined();

        const reading = await runAskTurn(ask(), { ...deps, loop: scriptedLoop([]) });
        expect(reading.answer.plan).toEqual([
            { label: 'Find Rob', state: 'waiting' },
            { label: 'Draft reply', state: 'waiting' },
            { label: 'Send reply', state: 'waiting' },
        ]);
    });

    it('proposes nothing without a slot, and shows no plan for a money refusal', async () => {
        const rob = heldOn('Rob');
        const { source } = memorySource([rob]);
        const actions = new MemoryAskActionStore();
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        await runAskTurn(ask({ approver: null }), {
            source, assignments: async () => ({}), client: new FakeModelClient({ router: () => route() }), now: now(), actions,
            loop: scriptedLoop([{ tool: 'propose_send_held_draft', input: { caseFileId: rob.id } }], seen),
        });
        expect(seen.results[0]).toEqual({ status: 'refused', reason: expect.stringMatching(/no approver slot/) });
        expect(actions.rows.size).toBe(0);

        const money = await runAskTurn(ask({ userMessage: 'refund Rob and tell him' }), {
            source, assignments: async () => ({}), now: now(), actions, loop: vi.fn(),
            client: new FakeModelClient({ router: () => route({ moneyAction: true, steps: ['Refund Rob', 'Tell Rob'] }) }),
        });
        expect(money.answer.plan).toBeUndefined();
        expect(money.answer.confirm).toBeUndefined();
    });
});

describe('helpers', () => {
    it('finds the selected file by id or by any form of its number', () => {
        const file = whatsappFile();
        const e164 = file.parties[0].channels[0].address;
        expect(contextFile([file], { caseFileId: file.id })?.id).toBe(file.id);
        expect(contextFile([file], { phone: e164 })?.id).toBe(file.id);
        expect(contextFile([file], { phone: `0${e164.slice(3)}` })?.id).toBe(file.id);
        expect(contextFile([file], { phone: '+447700900999' })).toBeNull();
        expect(contextFile([file], null)).toBeNull();
    });

    it('feeds the reasoner an alternating history that starts with Ben and leaves the new ask to the goal', () => {
        expect(historyToPriorMessages([
            { role: 'assistant', content: 'stray' },
            { role: 'user', content: 'one' },
            { role: 'user', content: 'two' },
            { role: 'assistant', content: 'answer' },
            { role: 'user', content: 'the new ask' },
        ])).toEqual([{ role: 'user', content: 'one\n\ntwo' }, { role: 'assistant', content: 'answer' }]);
    });
});
