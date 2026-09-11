/**
 * The Quoting specialist: never prose and never a figure in front of the model; drafts the quote
 * through the tools the moment the job and location are known, from the model's intake or from
 * the facts when the model fails; after the quote is sent answers from the quote's facts, holds on
 * money beyond a line and on acceptance in chat, acknowledges a not-ready customer, and treats an
 * acceptance on the quote page as the customer's turn without a model call. The router hook and
 * the clock's chase.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, open, recordFact, type CaseFile, type Turn } from '../desk/case-file';
import { FakeModelClient } from '../desk/models';
import type { Route } from '../desk/router';
import { recordingNotifier } from './ben-notifier';
import { FakeDrafter } from './draft-quote';
import { QUOTE_FACT } from './quote-record';
import { MemoryQuoteStore } from './quote-store';
import { emptyPriceBook, markQuoteSent, priceQuote, type QuotingDeps } from './quoting-tools';
import { applyQuotingRoute, clampIntake, intakeOutputSchema, questionOutputSchema, quote, quotingClock, quotingOwnsThread, quoteStateOf } from './quoting-specialist';

function fixture(text = 'Hi, my kitchen tap is leaking, NG9 2AB'): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    const file = r.value;
    recordFact(file, { key: 'job_type', value: 'leaking kitchen tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    recordFact(file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    return file;
}

const routeOf = (over: Partial<Route> = {}): Route => ({ subjects: ['quoting'], proposedStage: 'ready', party: 'customer', exception: null, turnKind: 'question', belts: { regulated: null, money: null }, call: {} as any, error: null, ...over });

function later(file: CaseFile, body: string, kind: Turn['kind'] = 'text', channel: Turn['channel'] = 'whatsapp'): Turn {
    const last = file.turns[file.turns.length - 1];
    const at = new Date(Date.parse(last.at) + 60_000).toISOString();
    const r = appendTurn(file, { at, channel, direction: 'inbound', partyId: 'p1', kind, body, media: [], runId: null, approver: null });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

const intakeOutput = { lines: [{ title: 'Replace kitchen tap', category: 'plumbing', qty: 1, detail: 'mixer tap, dripping at the base', assumptions: ['You supply the new tap'], notIncluded: ['A new tap'] }], customerType: 'homeowner', missing: ['which tap'] };

function deps(clock = { t: Date.parse('2026-09-11T10:00:00.000Z') }) {
    const store = new MemoryQuoteStore();
    const drafter = new FakeDrafter(store, { materialsPence: 2000 });
    const d: QuotingDeps = { store, drafter, notifier: recordingNotifier, priceBook: emptyPriceBook, mode: 'dry_run', baseUrl: 'https://test.local', now: () => new Date(clock.t) };
    return { d, store, drafter, clock };
}

/** A sent quote on the file, priced at £120.00 (labour £100.00, materials £20.00). */
async function sentQuote(client = new FakeModelClient({ specialist: () => intakeOutput })) {
    const { d, store, drafter, clock } = deps();
    const file = fixture();
    const first = await quote(file, file.turns[0], file.parties[0], routeOf({ turnKind: 'enquiry' }), client, d);
    if (!first || !file.job.quoteRef) throw new Error('no draft');
    const priced = await priceQuote(file, {}, d);
    if (!priced.ok) throw new Error(priced.reason);
    const marked = await markQuoteSent(file, d);
    if (!marked.ok) throw new Error(marked.reason);
    return { file, d, store, drafter, clock, client };
}

describe('the specialist never returns prose and never sees a figure', () => {
    it('the two structured outputs carry labels only: a reply field is dropped', () => {
        const parsed = intakeOutputSchema.safeParse({ ...intakeOutput, reply: 'Hi Sam, the tap will be £80.' });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(Object.keys(parsed.data)).toEqual(['lines', 'customerType', 'missing']);
        // A detail over the length the prompt asks for is trimmed by clampIntake, never refused.
        expect(intakeOutputSchema.safeParse({ ...intakeOutput, lines: [{ ...intakeOutput.lines[0], detail: 'x'.repeat(161) }] }).success).toBe(true);
        const q = questionOutputSchema.safeParse({ concerns: [{ kind: 'line_amount', label: 'Labour' }], beyondQuoteLine: false, acceptanceInChat: false, notReady: false, message: 'It is £100.' });
        expect(q.success).toBe(true);
        if (q.success) expect(Object.keys(q.data)).toEqual(['concerns', 'beyondQuoteLine', 'acceptanceInChat', 'notReady']);
    });

    it('takes an over-long answer and trims it rather than losing the whole intake', async () => {
        // A structured-output call constrains the shape, not a string's length: a 41-character
        // label where the schema said 40 failed the parse live and threw the intake away.
        const long = { lines: [{ title: 'x'.repeat(300), category: 'plumbing', qty: 1, detail: 'y'.repeat(800), assumptions: ['a'.repeat(300), 'b', 'c', 'd', 'e'], notIncluded: ['n'.repeat(300)] }], customerType: 'homeowner', missing: ['confirm whether the customer supplies the replacement tap', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] };
        const parsed = intakeOutputSchema.safeParse(long);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        const c = clampIntake(parsed.data);
        expect(c.lines[0].title).toHaveLength(120);
        expect(c.lines[0].detail).toHaveLength(160);
        expect(c.lines[0].assumptions).toHaveLength(4);
        expect(c.lines[0].assumptions[0]).toHaveLength(120);
        expect(c.lines[0].notIncluded[0]).toHaveLength(80);
        expect(c.missing).toHaveLength(6);
        expect(c.missing[0]).toHaveLength(40);

        const { d, drafter } = deps();
        const file = fixture();
        const ret = await quote(file, file.turns[0], file.parties[0], routeOf({ turnKind: 'enquiry' }), new FakeModelClient({ specialist: () => long }), d);
        expect(ret?.error).toBeNull();
        expect(drafter.drafts[0].lines[0].title).toHaveLength(120);
        expect(drafter.drafts[0].missing.every((m) => m.length <= 40)).toBe(true);
    });

    it('drafts on the ready turn: facts with quote sources, a brief for the composer, no sentence, and no pound sign in what the model saw', async () => {
        const { d, drafter } = deps();
        const client = new FakeModelClient({ specialist: ({ system }) => { expect(system).toMatch(/never a figure of money/); return intakeOutput; } });
        const file = fixture();
        const ret = await quote(file, file.turns[0], file.parties[0], routeOf({ turnKind: 'enquiry' }), client, d);
        expect(ret).not.toBeNull();
        if (!ret) return;
        expect(Object.keys(ret).sort()).toEqual(['brief', 'calls', 'error', 'factIds', 'proposal', 'specialist']);
        expect(ret.specialist).toBe('quoting');
        expect(ret.brief?.[0]).toMatch(/^quoting: drafted /);
        expect(ret.brief?.join(' ')).not.toMatch(/\bHi\b|£/);
        expect(file.job.quoteRef).toBeTruthy();
        expect(drafter.drafts[0].lines[0].title).toBe('Replace kitchen tap');
        expect(drafter.drafts[0].missing).toEqual(['photo (not asked)', 'access (parking, someone in)', 'which tap']);
        expect(ret.factIds.length).toBeGreaterThan(0);
        for (const id of ret.factIds) expect(file.facts.find((f) => f.id === id)?.source.kind).toBe('quote_line');
        expect(client.calls.every((c) => !c.user.includes('£'))).toBe(true);
        expect(client.calls[0].model).toBe('claude-sonnet-5');
        expect(quoteStateOf(file)?.notifications[0]).toMatchObject({ kind: 'ready_to_price', link: `https://test.local/admin/price/${file.job.quoteRef}` });
    });

    it('does nothing before the job and location are known', async () => {
        const { d } = deps();
        const r = open({ identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' }, channel: 'whatsapp', address: '+447700900942', firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: 'hi', media: [] } });
        if (!r.ok) throw new Error(r.reason);
        const client = new FakeModelClient({ specialist: () => { throw new Error('no model call before ready'); } });
        expect(await quote(r.value, r.value.turns[0], r.value.parties[0], routeOf(), client, d)).toBeNull();
    });

    it('still drafts from the facts when the intake model fails, and records the error', async () => {
        const { d, drafter } = deps();
        const client = new FakeModelClient({ specialist: () => ({ error: 'boom' }) });
        const file = fixture();
        const ret = await quote(file, file.turns[0], file.parties[0], routeOf(), client, d);
        expect(ret?.error).toMatch(/boom/);
        expect(file.job.quoteRef).toBeTruthy();
        expect(drafter.drafts[0].lines[0].title).toBe('leaking kitchen tap');
    });
});

describe('after the quote', () => {
    it('answers a price question from the quote: the line facts are on the file to the penny, the brief names them, the model saw labels only', async () => {
        const { file, d } = await sentQuote();
        expect(quotingOwnsThread(file)).toBe(true);
        const client = new FakeModelClient({ specialist: ({ user, system }) => { expect(system).toMatch(/never see or state a figure/); expect(user).not.toContain('£'); return { concerns: [{ kind: 'line_amount', label: 'Replace kitchen tap labour' }], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }; } });
        const turn = later(file, 'What does that include, and how much is the labour?');
        const ret = await quote(file, turn, file.parties[0], routeOf(), client, d);
        expect(ret?.proposal.hold).toBeNull();
        const labour = file.facts.find((f) => f.key === 'quote_line:Replace kitchen tap labour');
        expect(labour).toMatchObject({ value: '£100.00', source: { kind: 'quote_line', line: 'Replace kitchen tap labour' } });
        expect(ret?.factIds).toContain(labour!.id);
        expect(ret?.brief?.join('\n')).toContain(`Replace kitchen tap labour = fact ${labour!.id}`);
        expect(ret?.brief?.join('\n')).toMatch(/they asked about: Replace kitchen tap labour/);
        expect(ret?.brief?.join('\n')).toMatch(/quote link is fact/);
        expect(ret?.brief?.join('\n')).toMatch(/Ben will come back to them on it/);
    });

    it('holds money beyond a quote line for Ben, and acceptance in chat', async () => {
        const { file, d } = await sentQuote();
        const cheaper = new FakeModelClient({ specialist: () => ({ concerns: [], beyondQuoteLine: true, acceptanceInChat: false, notReady: false }) });
        const r1 = await quote(file, later(file, 'Can you do it for less?'), file.parties[0], routeOf(), cheaper, d);
        expect(r1?.proposal.hold).toMatchObject({ reason: 'money' });
        expect(r1?.brief?.join('\n')).toMatch(/beyond a line of the quote/);
        const yes = new FakeModelClient({ specialist: () => ({ concerns: [], beyondQuoteLine: false, acceptanceInChat: true, notReady: false }) });
        const r2 = await quote(file, later(file, 'Yes please, go ahead'), file.parties[0], routeOf(), yes, d);
        expect(r2?.proposal.hold).toMatchObject({ reason: 'acceptance' });
        expect(r2?.brief?.join('\n')).toMatch(/acceptance happens on the quote page/);
        expect(file.stage).toBe('quoted');
    });

    it('a not-ready customer gets an acknowledgement brief and no chase', async () => {
        const { file, d } = await sentQuote();
        const client = new FakeModelClient({ specialist: () => ({ concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: true }) });
        const ret = await quote(file, later(file, "I'll get back to you next month"), file.parties[0], routeOf({ turnKind: 'not_ready' }), client, d);
        expect(ret?.brief?.join('\n')).toMatch(/not ready: one short acknowledgement, no question, and the desk will not chase/);
        expect((await quotingClock(file, d)).chased).toBe(false);
    });

    it('an acceptance on the quote page is the customer\'s turn: no model call, the accepted brief', async () => {
        const { file, d } = await sentQuote();
        const client = new FakeModelClient({ specialist: () => { throw new Error('no model call on acceptance'); } });
        const turn = later(file, 'Accepted quote on the quote page.', 'portal_action', 'form');
        const ret = await quote(file, turn, file.parties[0], routeOf({ turnKind: 'acknowledgement' }), client, d);
        expect(ret?.brief?.join('\n')).toMatch(/Ben has been told and will be in touch about the day/);
        expect(ret?.calls).toHaveLength(0);
    });

    it('an expired quote gives no figure: the status fact only, and Ben comes back', async () => {
        const { file, d, store } = await sentQuote();
        const row = store.rows.get(file.job.quoteRef!)!;
        row.expiresAt = '2026-09-01T00:00:00.000Z';
        const before = file.facts.filter((f) => f.key.startsWith('quote_line:')).length;
        const client = new FakeModelClient({ specialist: () => { throw new Error('no model call on a stale quote'); } });
        const ret = await quote(file, later(file, 'How much was the total again?'), file.parties[0], routeOf(), client, d);
        expect(ret?.brief?.[0]).toMatch(/is expired/);
        expect(file.facts.filter((f) => f.key.startsWith('quote_line:')).length).toBe(before);
        expect(file.facts.find((f) => f.key === QUOTE_FACT.status && /expired/.test(f.value))).toBeTruthy();
    });

    it('while the draft is with Ben, a scope question is answered from the draft with no figure', async () => {
        const { d } = deps();
        const file = fixture();
        await quote(file, file.turns[0], file.parties[0], routeOf({ turnKind: 'enquiry' }), new FakeModelClient({ specialist: () => intakeOutput }), d);
        const client = new FakeModelClient({ specialist: () => ({ concerns: [{ kind: 'not_included', label: null }], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }) });
        const ret = await quote(file, later(file, 'Does that include a new tap?'), file.parties[0], routeOf(), client, d);
        expect(ret?.brief?.join('\n')).toMatch(/answer what is included from the draft's scope facts/);
        expect(file.facts.some((f) => f.key.startsWith('quote_line:'))).toBe(false);
        expect(file.facts.find((f) => f.key === 'quote_not_included:Replace kitchen tap')?.value).toBe('A new tap');
    });
});

describe('the router hook and the clock', () => {
    it('clears a money exception once the quote is sent and routes it to Quoting; forces a portal action to Quoting', async () => {
        const { file } = await sentQuote();
        const out = { subjects: ['scoping' as const], proposedStage: 'quoted' as const, party: 'customer' as const, exception: 'money' as const, turnKind: 'question' as const };
        applyQuotingRoute(file, later(file, 'how much is the labour?'), out as any);
        expect(out.exception).toBeNull();
        expect(out.subjects[0]).toBe('quoting');
        const fresh = fixture();
        const early = { subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: 'money', turnKind: 'question' } as any;
        applyQuotingRoute(fresh, fresh.turns[0], early);
        expect(early.exception).toBe('money');
        const portal = { subjects: ['scoping'], proposedStage: 'quoted', party: 'customer', exception: 'money', turnKind: 'question' } as any;
        applyQuotingRoute(file, later(file, 'Accepted quote', 'portal_action', 'form'), portal);
        expect(portal).toMatchObject({ subjects: ['quoting'], exception: null, turnKind: 'acknowledgement' });
    });

    it('the clock chases an unpriced draft once it is due, and reports why not otherwise', async () => {
        const { d, clock } = deps();
        const file = fixture();
        await quote(file, file.turns[0], file.parties[0], routeOf(), new FakeModelClient({ specialist: () => intakeOutput }), d);
        expect((await quotingClock(file, d)).note).toMatch(/not due/);
        clock.t += 5 * 3_600_000;
        const due = await quotingClock(file, d);
        expect(due.chased).toBe(true);
        expect(due.note).toMatch(/chase 1 recorded for Ben/);
        expect(quoteStateOf(file)?.notifications.map((n) => n.kind)).toEqual(['ready_to_price', 'chase']);
    });
});
