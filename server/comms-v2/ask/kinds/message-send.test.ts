/**
 * message.send, the captain's example end to end: "send a whatsapp message to sarah from tena
 * properties telling her that we will call her this afternoon". The ask agent writes the words,
 * proposes them, and nothing goes until Ben confirms; then they go once, as him, through the desk's
 * one sender. "this afternoon" passes the date guard only because Ben's own ask said it (answer A2),
 * and the preview says so. A shut WhatsApp window takes an approved template that is true for the
 * thread, else a text, and the preview says which (answer A3). A claim Ben did not give, and any
 * figure, are refused. Someone with no file open gets one when the message goes, not before.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, closeFile, open, recordSend, type ApproverSlot, type CaseFile } from '../../desk/case-file';
import { BEN } from '../../desk/guards';
import { Identity } from '../../desk/identity';
import { FakeModelClient } from '../../desk/models';
import type { TemplateStatusSource } from '../../desk/sender';
import type { BoardSource } from '../../api/store';
import { MemoryAskActionStore, confirmAction, proposeAction, type ActionDeps } from '../actions';
import { ACTION_KINDS, type ActionKinds } from '../action-kinds';
import { runAskTurn } from '../agent';
import { BEN_PERSON, memorySource, scriptedLoop } from '../ask-fixtures';
import { EMAIL_TARGET_REFUSAL, INSTRUCTION_FACT_KEY, messageSendKind, parseMessageSendArgs } from './message-send';

const ASK = 'send a whatsapp message to sarah from tena properties telling her that we will call her this afternoon';
const ASK_ID = 'msg_ask_1';
const INSTRUCTION = { person: BEN_PERSON, askMessageId: ASK_ID, quote: 'we will call her this afternoon' };
const WORDS = "Hi Sarah, we'll give you a call this afternoon.";
const SESSION = 'session-ben';
const BEN_APPROVER = `human:${BEN_PERSON}`;
const NOW = new Date('2026-09-17T11:00:00.000Z');
const clock = () => NOW;
const SARAH_WA = '+447700900555';

const quoteApproved: TemplateStatusSource = { async approved(name) { return name === 'quote_ready_link' ? { contentSid: 'HX_quote' } : null; } };
const nothingApproved: TemplateStatusSource = { async approved() { return null; } };

/** Sarah Ellis of Tena Properties, who last wrote on WhatsApp at `wroteAt`. */
function sarahFile(wroteAt: string, body = 'Hi, it is Sarah from Tena Properties. The flat 3 bathroom fan has stopped.'): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'person_sarah', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900555', propertyId: null, landlordId: null, name: 'Sarah Ellis' },
        channel: 'whatsapp', address: SARAH_WA,
        firstTurn: { at: wroteAt, channel: 'whatsapp', kind: 'text', body, media: [] },
    }, { now: () => new Date(wroteAt) });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

function setup(files: CaseFile[], templates: TemplateStatusSource = nothingApproved, identity?: Identity) {
    const { store: cases, source: bare } = memorySource(files);
    const source = async (): Promise<BoardSource> => ({ ...(await bare()), ...(identity ? { identity } : {}) });
    const kinds: ActionKinds = { ...ACTION_KINDS, 'message.send': messageSendKind({ templates }) };
    const store = new MemoryAskActionStore();
    const deps: ActionDeps = { store, source, kinds, now: clock };
    const propose = (args: unknown, approver: ApproverSlot | null = BEN) => proposeAction({ kind: 'message.send', args, sessionId: SESSION, askRunId: 'ask_1', person: BEN_PERSON, approver }, deps);
    const confirm = (id: string) => confirmAction({ id, person: BEN_PERSON, approver: BEN, ownsSession: async (s) => s === SESSION }, deps);
    return { cases, store, deps, source, kinds, propose, confirm };
}

describe('the Sarah example, window open', () => {
    it('proposes the words with the window and the instruction named, sends nothing, then on confirm sends them once as Ben', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { propose, confirm, cases } = setup([file]);

        const out = await propose({ caseFileId: file.id, channel: 'whatsapp', words: WORDS, instruction: INSTRUCTION });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.label).toBe('Send this');
        expect(out.action.previewText).toBe(WORDS);
        expect(out.outgoing).toEqual([{
            to: SARAH_WA, channel: 'wa', text: WORDS, actionId: out.action.id,
            window: { state: 'open', until: '2026-09-18T09:30:00.000Z', reason: expect.stringMatching(/wrote on WhatsApp/) },
            guardNote: "'this afternoon' is from your instruction",
        }]);
        expect(cases.get(file.id)!.sends).toEqual([]);

        const done = await confirm(out.action.id);
        expect(done.ok).toBe(true);
        if (!done.ok) return;
        expect(done.action.result).toMatchObject({ approver: BEN_APPROVER, channel: 'whatsapp', how: 'reply', fallback: null, opened: false, caseFileId: file.id });
        const after = cases.get(file.id)!;
        expect(after.sends).toHaveLength(1);
        const sent = after.sends[0];
        expect(sent).toMatchObject({ approver: BEN_APPROVER, channel: 'whatsapp', templateId: null, windowState: 'open', runId: done.action.runId });
        expect(sent.bubbles.map((b) => b.text).join(' ')).toContain('this afternoon');
        // The instruction is on the file as its own fact, and the send cites it.
        const fact = after.facts.find((f) => f.key === INSTRUCTION_FACT_KEY)!;
        expect(fact.source).toEqual({ kind: 'instruction', ...INSTRUCTION });
        expect(sent.factIds).toEqual([fact.id]);
        expect(after.turns[after.turns.length - 1]).toMatchObject({ direction: 'outbound', approver: BEN_APPROVER });

        // A second confirm returns the first outcome and sends nothing more.
        const again = await confirm(out.action.id);
        expect(again).toMatchObject({ ok: true, repeat: true });
        expect(cases.get(file.id)!.sends).toHaveLength(1);
    });

    it('carries one message per proposal: one tile, one confirm (answer A6)', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { propose } = setup([file]);
        const out = await propose({ caseFileId: file.id, words: `${WORDS}\n\nThanks for your patience.`, instruction: INSTRUCTION });
        expect(out.ok && out.outgoing).toHaveLength(1);
    });
});

describe('the Sarah example, window shut', () => {
    it('with a quote link sent on the thread: offers the approved template instead of the words, and says so', async () => {
        const file = sarahFile('2026-09-15T09:30:00.000Z');
        file.job.quoteRef = 'q123';
        const r = recordSend(file, {
            runId: 'run_quote', approver: BEN_APPROVER, partyId: file.parties[0].personId, channel: 'whatsapp', windowState: 'open', templateId: null,
            bubbles: [{ text: 'Your quote: https://handyservices.app/quote/q123', gapMs: 0 }], factIds: [], kbIds: [], calls: [], at: '2026-09-15T10:00:00.000Z', mode: 'dry_run', partial: false, turnId: null,
        });
        expect(r.ok).toBe(true);
        const { propose, confirm, cases } = setup([file], quoteApproved);

        const out = await propose({ caseFileId: file.id, channel: 'whatsapp', words: WORDS, instruction: INSTRUCTION });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        const [tile] = out.outgoing;
        expect(tile.channel).toBe('wa');
        expect(tile.text).toContain('https://handyservices.app/quote/q123');
        expect(tile.text).not.toContain('this afternoon');
        expect(tile.window).toMatchObject({ state: 'shut' });
        expect(tile.guardNote).toMatch(/WhatsApp window is shut .*approved template quote_ready_link goes instead of these words/);

        const done = await confirm(out.action.id);
        expect(done.ok).toBe(true);
        const sent = cases.get(file.id)!.sends.at(-1)!;
        expect(sent).toMatchObject({ approver: BEN_APPROVER, channel: 'whatsapp', templateId: 'quote_ready_link', windowState: 'shut', runId: done.ok ? done.action.runId : '' });
        expect(done.ok && done.action.result).toMatchObject({ how: 'template', fallback: 'template' });
    });

    it('with no template true for the thread: texts the same number instead, and says so', async () => {
        const file = sarahFile('2026-09-15T09:30:00.000Z', 'Thanks, the fan is working again.');
        const { propose, confirm, cases } = setup([file], quoteApproved);

        const out = await propose({ caseFileId: file.id, channel: 'whatsapp', words: WORDS, instruction: INSTRUCTION });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.outgoing).toEqual([expect.objectContaining({
            to: SARAH_WA, channel: 'sms', text: WORDS,
            window: expect.objectContaining({ state: 'shut' }),
            guardNote: expect.stringMatching(/^'this afternoon' is from your instruction\. the WhatsApp window is shut .*no approved template is true for this thread.*, so this goes by SMS to \+447700900555 instead$/),
        })]);

        const done = await confirm(out.action.id);
        expect(done.ok).toBe(true);
        const after = cases.get(file.id)!;
        expect(after.sends.at(-1)).toMatchObject({ approver: BEN_APPROVER, channel: 'sms', templateId: null });
        expect(after.parties[0].channels).toEqual(expect.arrayContaining([{ kind: 'sms', address: SARAH_WA, lastInboundAt: null }]));
        expect(done.ok && done.action.result).toMatchObject({ how: 'freeform', fallback: 'sms' });
    });

    it('names the channel the customer wrote on when no template is true for it', async () => {
        const r = open({
            identity: { ok: true, personId: 'person_sarah', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900555', propertyId: null, landlordId: null, name: 'Sarah Ellis' },
            channel: 'sms', address: SARAH_WA,
            firstTurn: { at: '2026-09-17T09:30:00.000Z', channel: 'sms', kind: 'text', body: 'Hi, it is Sarah. The fan has stopped.', media: [] },
        }, { now: () => new Date('2026-09-17T09:30:00.000Z') });
        if (!r.ok) throw new Error(r.reason);
        r.value.parties[0].channels.push({ kind: 'whatsapp', address: SARAH_WA, lastInboundAt: '2026-09-01T09:00:00.000Z' });
        const { propose } = setup([r.value]);
        const out = await propose({ caseFileId: r.value.id, channel: 'whatsapp', words: WORDS, instruction: INSTRUCTION });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.outgoing[0]).toMatchObject({ channel: 'sms', to: SARAH_WA });
        expect(out.outgoing[0].guardNote).toMatch(/no approved template is true for a thread the customer wrote on by SMS, so this goes by SMS/);
        expect(out.outgoing[0].guardNote).not.toMatch(/has not written/);
    });
});

describe('never by email (answer A3; outbound email stays in dry run, answer 113)', () => {
    function emailOnly(): CaseFile {
        const r = open({
            identity: { ok: true, personId: 'person_mail', customerId: null, role: 'homeowner', isNew: true, canonical: 'email:sarah@example.test', propertyId: null, landlordId: null, name: 'Sarah' },
            channel: 'email', address: 'sarah@example.test',
            firstTurn: { at: '2026-09-17T09:30:00.000Z', channel: 'email', kind: 'text', body: 'Thanks.', media: [] },
        });
        if (!r.ok) throw new Error(r.reason);
        return r.value;
    }

    it('refuses a customer the desk can reach only by email, whatever channel is asked for, and sends nothing', async () => {
        const file = emailOnly();
        const { propose, cases } = setup([file]);
        for (const channel of [undefined, 'whatsapp', 'sms']) {
            expect(await propose({ caseFileId: file.id, channel, words: WORDS, instruction: INSTRUCTION }))
                .toEqual({ ok: false, reason: 'a message from the Handy Desk goes by WhatsApp or SMS only, and there is no number on file for this customer' });
        }
        expect(cases.get(file.id)!.sends).toEqual([]);
    });

    it('does not take email as a channel', () => {
        expect(parseMessageSendArgs({ caseFileId: 'case_1', words: WORDS, channel: 'email' })).toBeNull();
    });

    it('refuses an email address as the target, even one identity knows, and opens no file', async () => {
        const identity = new Identity();
        identity.directory.upsert({ id: 'person_mail', role: 'homeowner', customerId: null, name: 'Sarah', keys: ['email:sarah@example.test'], propertyId: null, landlordId: null });
        const { propose, cases } = setup([], nothingApproved, identity);
        expect(await propose({ to: { address: 'sarah@example.test', name: 'Sarah' }, words: 'Hi Sarah.' }))
            .toEqual({ ok: false, reason: EMAIL_TARGET_REFUSAL });
        expect(cases.all()).toEqual([]);
    });

    it('answers a customer who wrote by email on their number instead', async () => {
        const file = emailOnly();
        file.parties[0].channels.push({ kind: 'sms', address: SARAH_WA, lastInboundAt: null });
        const { propose } = setup([file]);
        const out = await propose({ caseFileId: file.id, channel: 'sms', words: WORDS, instruction: INSTRUCTION });
        expect(out.ok && out.outgoing[0]).toMatchObject({ channel: 'sms', to: SARAH_WA });
    });
});

describe('a case file the desk counts as closed', () => {
    /** Sarah's job is booked, so her own next message would open a fresh file. */
    function bookedFile(): { file: CaseFile; identity: Identity } {
        const file = sarahFile('2026-09-15T09:30:00.000Z');
        file.job.type = 'extractor fan';
        file.job.location = 'Flat 3';
        const closed = closeFile(file, 'booked', { why: 'the job is booked', approver: BEN_APPROVER }, { now: () => new Date('2026-09-16T09:00:00.000Z') });
        if (!closed.ok) throw new Error(closed.reason);
        const identity = new Identity({ newId: () => 'person_new_1' });
        identity.directory.upsert({ id: 'person_sarah', role: 'homeowner', customerId: null, name: 'Sarah Ellis', keys: ['phone:07700900555'], propertyId: null, landlordId: null });
        return { file, identity };
    }

    it('starts a fresh file on the customer\'s number instead of writing on the booked one, and says so', async () => {
        const { file, identity } = bookedFile();
        const { propose, confirm, cases } = setup([file], nothingApproved, identity);

        const out = await propose({ caseFileId: file.id, words: WORDS, instruction: INSTRUCTION });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.outgoing[0].guardNote).toMatch(/starting a new conversation: their last case file is booked, so sending opens a new one/);
        expect(cases.all()).toHaveLength(1);

        const done = await confirm(out.action.id);
        expect(done.ok).toBe(true);
        expect(cases.get(file.id)!.turns).toHaveLength(1);
        expect(cases.get(file.id)!.sends).toEqual([]);

        // The customer's reply lands where the intake would put it: the one open file, carrying Ben's message.
        const open = cases.findOpenFor('person_sarah');
        expect(open).not.toBeNull();
        expect(open!.id).not.toBe(file.id);
        expect(open!.sends).toEqual([expect.objectContaining({ approver: BEN_APPROVER })]);
        const reply = appendTurn(open!, { at: '2026-09-17T11:05:00.000Z', channel: 'sms', direction: 'inbound', partyId: open!.parties[0].personId, kind: 'text', body: 'Yes please.', media: [], runId: null, approver: null });
        expect(reply.ok).toBe(true);
        expect(open!.turns.map((t) => t.direction)).toEqual(['outbound', 'inbound']);
    });

    it('refuses a closed file with no number on it to start on', async () => {
        const r = open({
            identity: { ok: true, personId: 'person_mail', customerId: null, role: 'homeowner', isNew: true, canonical: 'email:sarah@example.test', propertyId: null, landlordId: null, name: 'Sarah' },
            channel: 'email', address: 'sarah@example.test',
            firstTurn: { at: '2026-09-15T09:30:00.000Z', channel: 'email', kind: 'text', body: 'Thanks.', media: [] },
        });
        if (!r.ok) throw new Error(r.reason);
        const closed = closeFile(r.value, 'done', { why: 'finished', approver: BEN_APPROVER }, { now: () => new Date('2026-09-16T09:00:00.000Z') });
        if (!closed.ok) throw new Error(closed.reason);
        const { propose } = setup([r.value]);
        expect(await propose({ caseFileId: r.value.id, words: WORDS, instruction: INSTRUCTION }))
            .toEqual({ ok: false, reason: 'that case file is done, so it is closed, and it carries no number to start a new conversation on' });
    });
});

describe('what the guards still refuse', () => {
    it('a claim the instruction does not give: another time, or a promise to fix', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { propose } = setup([file]);
        expect(await propose({ caseFileId: file.id, words: "Hi Sarah, we'll call you tomorrow morning.", instruction: INSTRUCTION }))
            .toEqual({ ok: false, reason: expect.stringMatching(/date_time_duration: .*"tomorrow"/) });
        expect(await propose({ caseFileId: file.id, words: "Hi Sarah, we'll call you this afternoon and we'll fix the fan.", instruction: INSTRUCTION }))
            .toEqual({ ok: false, reason: expect.stringMatching(/commitment_fault: .*we'll fix/) });
    });

    it('a time with no instruction at all', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { propose } = setup([file]);
        expect(await propose({ caseFileId: file.id, words: WORDS, instruction: null }))
            .toEqual({ ok: false, reason: expect.stringMatching(/date_time_duration: .*"this afternoon"/) });
    });

    it('a figure in the instruction itself: refused on the preview, before any confirm', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { propose, store } = setup([file]);
        const instruction = { ...INSTRUCTION, quote: 'we will call her this afternoon about the £240 quote' };
        expect(await propose({ caseFileId: file.id, words: WORDS, instruction }))
            .toEqual({ ok: false, reason: 'the instruction could not be recorded as a source: a figure may only come from a live quote line or a customer record' });
        expect(store.rows.size).toBe(0);
    });

    it('a figure in the words, even beside an instruction: figures need a quote line (answer 23)', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { propose } = setup([file]);
        expect(await propose({ caseFileId: file.id, words: "Hi Sarah, it's £140 and we'll call you this afternoon.", instruction: INSTRUCTION }))
            .toEqual({ ok: false, reason: expect.stringMatching(/figure: .*£140/) });
    });

    it('an instruction someone else gave', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { propose } = setup([file]);
        expect(await propose({ caseFileId: file.id, words: WORDS, instruction: { ...INSTRUCTION, person: 'someone.else@handyservices.app' } }))
            .toEqual({ ok: false, reason: 'the instruction was given by someone else, so it cannot license this message' });
    });

    it('a session with no slot, and a slot the file does not answer to', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { propose } = setup([file]);
        const args = { caseFileId: file.id, words: WORDS, instruction: INSTRUCTION };
        expect(await propose(args, null)).toEqual({ ok: false, reason: expect.stringMatching(/no approver slot/) });
        expect(await propose(args, { kind: 'human', id: 'office' })).toEqual({ ok: false, reason: 'only ben may act on this file' });
    });

    it('arguments that name no one, or both a file and an address', () => {
        expect(parseMessageSendArgs({ words: WORDS })).toBeNull();
        expect(parseMessageSendArgs({ caseFileId: 'case_1', to: { address: SARAH_WA }, words: WORDS })).toBeNull();
        expect(parseMessageSendArgs({ caseFileId: 'case_1', words: '  ' })).toBeNull();
        expect(parseMessageSendArgs({ caseFileId: 'case_1', words: WORDS, channel: 'fax' })).toBeNull();
    });
});

describe('a message Ben starts to someone with no file open (N6)', () => {
    it('opens a file only when the message goes, on the person identity knows, and texts because their WhatsApp window is shut', async () => {
        const identity = new Identity({ newId: () => 'person_new_1' });
        const { propose, confirm, cases } = setup([], nothingApproved, identity);

        const out = await propose({ to: { address: '07700 900777', name: 'Priya Shah' }, words: WORDS, instruction: INSTRUCTION });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.action.caseFileId).toBeNull();
        expect(out.outgoing[0]).toMatchObject({ to: '+447700900777', channel: 'sms', text: WORDS });
        expect(out.outgoing[0].guardNote).toMatch(/no approved template is true for a thread the customer has not written on.*Priya Shah has no case file open, so sending opens one/);
        expect(cases.all()).toEqual([]);
        expect(identity.directory.all()).toEqual([]);

        const done = await confirm(out.action.id);
        expect(done.ok).toBe(true);
        const [file] = cases.all();
        expect(file).toMatchObject({ stage: 'first_contact', parties: [expect.objectContaining({ personId: 'person_new_1', name: 'Priya Shah' })] });
        expect(file.stageHistory[0].why).toBe(`opened by ${BEN_APPROVER} to write first`);
        expect(file.sends).toEqual([expect.objectContaining({ approver: BEN_APPROVER, channel: 'sms' })]);
        expect(file.turns).toEqual([expect.objectContaining({ direction: 'outbound', approver: BEN_APPROVER })]);
        expect(done.ok && done.action.result).toMatchObject({ opened: true, caseFileId: file.id });
    });

    it('lands on the open file of a person identity already knows by that address', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const identity = new Identity();
        identity.directory.upsert({ id: 'person_sarah', role: 'homeowner', customerId: null, name: 'Sarah Ellis', keys: ['phone:07700900555'], propertyId: null, landlordId: null });
        const { propose, confirm, cases } = setup([file], nothingApproved, identity);

        const out = await propose({ to: { address: SARAH_WA, name: 'Sarah Ellis' }, channel: 'whatsapp', words: WORDS, instruction: INSTRUCTION });
        expect(out.ok && out.outgoing[0]).toMatchObject({ channel: 'wa', window: { state: 'open' } });
        if (!out.ok) return;
        await confirm(out.action.id);
        expect(cases.all()).toHaveLength(1);
        expect(cases.get(file.id)!.sends).toHaveLength(1);
    });

    it('refuses an address two people share, one of ours, and a desk that cannot look people up', async () => {
        const identity = new Identity();
        identity.directory.upsert({ id: 'a', role: 'homeowner', customerId: null, name: 'A', keys: ['phone:07700900111'], propertyId: null, landlordId: null });
        identity.directory.upsert({ id: 'b', role: 'homeowner', customerId: null, name: 'B', keys: ['phone:07700900111'], propertyId: null, landlordId: null });
        identity.registerInternal('phone:07700900999', 'Office');
        const { propose } = setup([], nothingApproved, identity);
        expect(await propose({ to: { address: '07700900111', name: null }, words: 'Hi there.' })).toEqual({ ok: false, reason: expect.stringMatching(/belongs to 2 people/) });
        expect(await propose({ to: { address: '07700900999', name: null }, words: 'Hi there.' })).toEqual({ ok: false, reason: expect.stringMatching(/business's own numbers/) });
        const bare = setup([]);
        expect(await bare.propose({ to: { address: '07700900111', name: null }, words: 'Hi there.' })).toEqual({ ok: false, reason: expect.stringMatching(/cannot look people up/) });
    });
});

describe('the ask agent proposes it (propose_message)', () => {
    const route = { intents: ['find', 'message'], domains: ['clients', 'messages'], surface: 'thread', steps: ['Find Sarah', 'Message Sarah'], moneyAction: false, wantsDraft: true };

    async function ask(file: CaseFile, input: Record<string, unknown>, composed: string[] = [WORDS], instructions = [{ id: ASK_ID, text: ASK }], identity?: Identity, actions?: MemoryAskActionStore) {
        const made = setup([file], nothingApproved, identity);
        const { source, kinds, cases } = made;
        const store = actions ?? made.store;
        const words = [...composed];
        const client = new FakeModelClient({ router: () => route, composer: () => ({ words: words.shift() ?? composed[composed.length - 1] }) });
        const seen: { results: unknown[] } = { results: [] };
        const out = await runAskTurn(
            { sessionId: SESSION, userMessage: ASK, via: 'typed', context: null, history: [{ role: 'user', content: ASK }], person: BEN_PERSON, approver: BEN, askRunId: 'ask_1', instructions },
            { source, assignments: async () => ({}), client, loop: scriptedLoop([{ tool: 'find_case_files', input: { query: 'Sarah' } }, { tool: 'propose_message', input }, { tool: 'give_answer', input: { finalText: 'Here is the message for Sarah.', surface: 'thread', caseFileId: file.id } }], seen), now: clock, actions: store, kinds },
        );
        return { out, seen, store, cases, client };
    }

    it('writes the words on the writing model, cites the instruction from Ben\'s ask, and offers one confirm', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { out, seen, store, cases, client } = await ask(file, { caseFileId: file.id, channel: 'whatsapp', brief: 'Tell Sarah we will call her this afternoon', instruction: 'we will call her this afternoon' });
        expect(seen.results[1]).toMatchObject({ status: 'proposed', kind: 'message.send', words: WORDS });
        const [action] = Array.from(store.rows.values());
        expect(action.args).toMatchObject({ caseFileId: file.id, channel: 'whatsapp', words: WORDS, instruction: INSTRUCTION });
        expect(out.answer.confirm).toEqual({ label: 'Send this', actionId: action.id, kind: 'message.send' });
        expect(out.answer.outgoing).toEqual([expect.objectContaining({ actionId: action.id, channel: 'wa', guardNote: "'this afternoon' is from your instruction" })]);
        expect(out.answer.surface).toMatchObject({ type: 'thread', caseFileId: file.id });
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(1);
        expect(cases.get(file.id)!.sends).toEqual([]);
    });

    it('writes again once when the guards refuse, then proposes what passes', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { seen, client } = await ask(file, { caseFileId: file.id, brief: 'Tell Sarah we will call her this afternoon', instruction: 'we will call her this afternoon' }, ["We'll call you tomorrow.", WORDS]);
        expect(seen.results[1]).toMatchObject({ status: 'proposed', words: WORDS });
        const composerCalls = client.calls.filter((c) => c.role === 'composer');
        expect(composerCalls).toHaveLength(2);
        expect(composerCalls[1].user).toMatch(/was refused[\s\S]*tomorrow/);
    });

    it('stops at a refusal when the second attempt still invents a claim, proposing nothing', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const { out, seen, store } = await ask(file, { caseFileId: file.id, brief: 'Tell Sarah we will call her', instruction: 'we will call her this afternoon' }, ["We'll call you tomorrow."]);
        expect(seen.results[1]).toMatchObject({ status: 'refused', reason: expect.stringMatching(/date_time_duration/) });
        expect(store.rows.size).toBe(0);
        expect(out.answer.confirm).toBeUndefined();
    });

    it('refuses an instruction that is not Ben\'s own words, and an address nobody gave', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const made = await ask(file, { caseFileId: file.id, brief: 'Tell Sarah we will fix it today', instruction: 'we will fix it today' });
        expect(made.seen.results[1]).toEqual({ status: 'refused', reason: expect.stringMatching(/must be Ben's own words/) });
        const guessed = await ask(file, { address: '07700900123', name: 'Sarah', brief: 'Tell Sarah we will call her this afternoon' });
        expect(guessed.seen.results[1]).toEqual({ status: 'refused', reason: expect.stringMatching(/never guess a number/) });
        expect(made.store.rows.size + guessed.store.rows.size).toBe(0);
    });

    it('takes an address Ben typed himself', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const typed = 'text 07700 900 321 and tell him we will call him this afternoon';
        const { seen } = await ask(file, { address: '07700900321', name: 'Tom', brief: 'We will call this afternoon', instruction: 'we will call him this afternoon' }, [WORDS.replace('Sarah', 'Tom')], [{ id: ASK_ID, text: typed }]);
        // The desk in this test cannot look people up, so the proposal itself is refused: but not as a guess.
        expect(seen.results[1]).toEqual({ status: 'refused', reason: expect.stringMatching(/cannot look people up/) });
    });

    it('cites an instruction Ben typed with a contraction, given back spelled out', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const typed = "tell sarah from tena properties we'll call her this afternoon.";
        const { seen, store } = await ask(file, { caseFileId: file.id, brief: 'Tell Sarah we will call her this afternoon', instruction: 'we will call her this afternoon' }, [WORDS], [{ id: ASK_ID, text: typed }]);
        expect(seen.results[1]).toMatchObject({ status: 'proposed', words: WORDS });
        expect(Array.from(store.rows.values())[0].args).toMatchObject({ instruction: INSTRUCTION });
    });

    it('refuses an email address or an email channel before writing anything', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const byAddress = await ask(file, { address: 'sarah@example.test', name: 'Sarah', brief: 'Say hello' }, [WORDS], [{ id: ASK_ID, text: 'email sarah@example.test and say hello' }]);
        expect(byAddress.seen.results[1]).toEqual({ status: 'refused', reason: EMAIL_TARGET_REFUSAL });
        const byChannel = await ask(file, { caseFileId: file.id, channel: 'email', brief: 'Say hello' });
        expect(byChannel.seen.results[1]).toEqual({ status: 'refused', reason: expect.stringMatching(/WhatsApp or SMS only/) });
        expect(byAddress.client.calls.filter((c) => c.role === 'composer').length + byChannel.client.calls.filter((c) => c.role === 'composer').length).toBe(0);
    });

    it('proposes on the open file of the person a number belongs to, so a second message to that number waits for the first', async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const identity = new Identity();
        identity.directory.upsert({ id: 'person_sarah', role: 'homeowner', customerId: null, name: 'Sarah Ellis', keys: ['phone:07700900555'], propertyId: null, landlordId: null });
        const input = { address: SARAH_WA, name: 'Sarah Ellis', brief: 'Tell Sarah we will call her this afternoon', instruction: 'we will call her this afternoon' };
        const first = await ask(file, input, [WORDS], undefined, identity);
        expect(first.seen.results[1]).toMatchObject({ status: 'proposed' });
        const [action] = Array.from(first.store.rows.values());
        expect(action.caseFileId).toBe(file.id);
        expect(action.args).toMatchObject({ caseFileId: file.id, to: null });

        const second = await ask(file, input, [WORDS.replace('Hi Sarah', 'Hello Sarah')], undefined, identity, first.store);
        expect(second.seen.results[1]).toEqual({ status: 'refused', reason: expect.stringMatching(/already waiting for a confirm/) });
        expect(first.store.rows.size).toBe(1);
    });

    it("takes Ben's curly apostrophes: the time he typed passes the date guard", async () => {
        const file = sarahFile('2026-09-17T09:30:00.000Z');
        const typed = 'tell sarah from tena properties we\u2019ll call her at 3 o\u2019clock';
        const words = "Hi Sarah, we'll give you a call at 3 o'clock.";
        const { seen, store } = await ask(file, { caseFileId: file.id, brief: 'Tell Sarah we will call her at 3 o\u2019clock', instruction: 'call her at 3 o\u2019clock' }, [words], [{ id: ASK_ID, text: typed }]);
        expect(seen.results[1]).toMatchObject({ status: 'proposed', words });
        expect(Array.from(store.rows.values())[0].args).toMatchObject({ instruction: { person: BEN_PERSON, askMessageId: ASK_ID, quote: 'call her at 3 o\u2019clock' } });
    });
});
