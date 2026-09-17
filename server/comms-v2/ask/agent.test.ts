/**
 * The ask agent's turn: Haiku 4.5 routes, Sonnet 5 reasons over the comms-v2 board and case files,
 * the writing model writes the one draft it may hold, and the final message carries an OpsAnswer
 * whose data is read off the file. It reads nothing from the old system: no message_drafts, no
 * old inbox board, no old Ops Manager, no VA call sheet, no old comms agent.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { ASK_TOOL_NAMES } from './tools';
import { BEN_PERSON, memorySource, now, scriptedLoop, whatsappFile } from './ask-fixtures';

const route = (over: Record<string, unknown> = {}) => ({ surface: 'thread', moneyAction: false, wantsDraft: false, ...over });

function ask(over: Partial<RunAskTurnOptions> = {}): RunAskTurnOptions {
    return { sessionId: 'session-1', userMessage: 'Ask Sam for a photo of the tap', via: 'typed', context: null, history: [], person: BEN_PERSON, approver: BEN, ...over };
}

describe('the agent reads only the new desk', () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'ask-fixtures.ts');
    const importsOf = (file: string) => Array.from(readFileSync(join(dir, file), 'utf8').matchAll(/(?:from\s+|import\()\s*'([^']+)'/g)).map((m) => m[1]);

    it('imports nothing from the old desk, the old drafts, the old board or the old Ops Manager', () => {
        const forbidden = /message-drafts|inbox-board|ops-manager|va-call-tasks|agents\/comms|draft-guards|desk-routes|server\/spine|\.\.\/\.\.\/spine/;
        for (const file of sources) expect(importsOf(file).filter((s) => forbidden.test(s)), file).toEqual([]);
    });

    it('reaches outside server/comms-v2 only for the wire types, the generic runner, the event bus and its own tables', () => {
        const allowed = new Set(['@shared/ops-types', '@shared/schema', '../../agents/runner', '../../agents/transcript-lean', '../../comms-events', '../../db', '@anthropic-ai/sdk', 'drizzle-orm', 'express', 'node:crypto', 'zod/v4']);
        for (const file of sources) {
            for (const spec of importsOf(file)) {
                const inside = spec.startsWith('./') || (spec.startsWith('../') && !spec.startsWith('../../'));
                if (!inside) expect(allowed.has(spec), `${file} imports ${spec}`).toBe(true);
            }
        }
    });

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
        const out = await runAskTurn(ask({ context: { caseFileId: file.id }, onEvent: (s) => steps.push(s) }), {
            source, assignments: async () => ({ ben: ['u1'] }), client, now: now(),
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
            outgoing: [{ to: file.parties[0].channels[0].address, channel: 'wa', text: 'Thanks Sam, could you send us a photo of the tap?' }],
            confirm: { label: 'Send as is', action: { kind: 'draft.release', args: { caseFileId: file.id } } },
        });
        expect(steps.map((s) => [s.type, s.tool])).toEqual([
            ['route', undefined],
            ['tool_call', 'get_case_file'], ['tool_result', 'get_case_file'],
            ['tool_call', 'draft_reply'], ['tool_result', 'draft_reply'],
            ['tool_call', 'give_answer'], ['tool_result', 'give_answer'],
        ]);
        expect(out.usage.calls).toHaveLength(2);
        expect(touched.modules).toEqual([]);
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
