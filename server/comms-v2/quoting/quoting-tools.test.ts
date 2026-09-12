/**
 * Contract 7, the Quoting tool server: readiness is job type and location with photos optional;
 * draft_quote once per job and refused before ready or beside a live quote; notify_ben once with
 * the price screen link; the chase on the clock, first after four hours then daily, three times;
 * read_quote_line's refusal set (draft, revoked, superseded, expired, an unknown label) and its
 * citation to the penny, which the figure guard verifies; scope readable from a draft; the price
 * screen write and the stage moves; acceptance refused for any witness but a human; the price book
 * never a fact.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, ask, customerVisibleFacts, isInternalFact, open, recordFact, type CaseFile } from '../desk/case-file';
import { DEFAULT_FIXED_LINES } from '../desk/fixed-lines';
import { GUARD_NAMES, runGuards } from '../desk/guards';
import { smsSegmentCount } from '../channels/sms-adapter';
import { recordingNotifier } from './ben-notifier';
import { FakeDrafter, type DraftIntake } from './draft-quote';
import { QUOTE_FACT, pounds, quoteRecordOf, readQuoteLine, readQuoteScope, type QuoteRowLike, type QuoteStatus } from './quote-record';
import { MemoryQuoteStore, QUOTE_READ_COLUMNS } from './quote-store';
import { CHASE_MAX, chase, draftQuote, liveFigureQuotes, loadQuote, notifyBen, priceQuote, quoteReadiness, recordAcceptance, markQuoteSent, recordQuoteFacts, type QuotingDeps } from './quoting-tools';

/** The one registry of Ben's fixed sentences is where the delivery's first contact comes from. */
const FIRST_CONTACT_ACK_WORDS = DEFAULT_FIXED_LINES.first_contact_ack;

function fixture(text = 'Hi, my kitchen tap is leaking, NG9 2AB', ready = true): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    const file = r.value;
    if (ready) {
        recordFact(file, { key: 'job_type', value: 'leaking kitchen tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
        recordFact(file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    }
    return file;
}

const intake: DraftIntake = { customerName: 'Sam', postcode: 'NG9 2AB', customerType: 'homeowner', missing: ['photo (asked once, none sent)'], lines: [{ title: 'Replace kitchen tap', category: 'plumbing', qty: 1, detail: 'mixer tap, dripping at the base', assumptions: ['You supply the new tap'], notIncluded: ['A new tap'] }] };

function deps(clock = { t: Date.parse('2026-09-11T10:00:00.000Z') }, opts: { materialsPence?: number } = {}): QuotingDeps & { store: MemoryQuoteStore; drafter: FakeDrafter; clock: typeof clock } {
    const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
    const drafter = new FakeDrafter(store, { materialsPence: opts.materialsPence ?? 2000 });
    return { store, drafter, notifier: recordingNotifier, baseUrl: 'https://test.local', now: () => new Date(clock.t), clock };
}

describe('quote_readiness', () => {
    it('is job type and location, photos optional, and names what Ben may want to request', () => {
        const notReady = fixture('hi', false);
        expect(quoteReadiness(notReady).ready).toBe(false);
        const file = fixture();
        expect(quoteReadiness(file)).toEqual({ ready: true, missing: ['photo (not asked)', 'access (parking, someone in)'] });
        ask(file, 'media');
        expect(quoteReadiness(file).missing[0]).toBe('photo (asked once, none sent)');
        recordFact(file, { key: 'media_declined', value: 'true', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
        recordFact(file, { key: 'access', value: 'parking outside', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
        expect(quoteReadiness(file).missing).toEqual(['photo (declined)']);
    });
});

describe('draft_quote and notify_ben', () => {
    it('refuses before ready, drafts once with facts cited to the quote, notifies Ben once with the price screen link, and refuses a second draft', async () => {
        const d = deps();
        const notReady = fixture('hi', false);
        const refused = await draftQuote(notReady, notReady.parties[0], intake, d);
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.reason).toMatch(/not ready/);

        const file = fixture();
        const out = await draftQuote(file, file.parties[0], intake, d);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(file.job.quoteRef).toBe(out.slug);
        expect(out.notified).toBe(true);
        expect(out.notice?.link).toBe(`https://test.local/admin/price/${out.slug}`);
        expect(out.notice?.message).toMatch(/Missing, yours to request: photo \(asked once, none sent\)/);
        const keys = file.facts.map((f) => f.key);
        expect(keys).toContain(QUOTE_FACT.ref);
        expect(keys).toContain(QUOTE_FACT.status);
        expect(keys).toContain(`${QUOTE_FACT.scope}:Replace kitchen tap`);
        expect(keys).toContain(`${QUOTE_FACT.notIncluded}:Replace kitchen tap`);
        expect(keys).toContain(QUOTE_FACT.benNotified);
        for (const f of file.facts.filter((x) => x.key.startsWith('quote_') || x.key.startsWith('ben_'))) expect(f.source).toMatchObject({ kind: 'quote_line', quoteRef: out.slug });
        expect(file.facts.find((f) => f.key === QUOTE_FACT.benNotified)?.value).toContain(`/admin/price/${out.slug}`);
        expect(d.drafter.drafts).toHaveLength(1);

        const again = await draftQuote(file, file.parties[0], intake, d);
        expect(again.ok).toBe(false);
        if (!again.ok) expect(again.reason).toMatch(/one draft per job/);
        expect(d.drafter.drafts).toHaveLength(1);

        const twice = await notifyBen(file, out.notice!, d);
        expect(twice.ok).toBe(false);
        if (!twice.ok) expect(twice.reason).toMatch(/already been notified/);
        expect(file.facts.filter((f) => f.key === QUOTE_FACT.benNotified)).toHaveLength(1);
    });

    it('keeps Ben\'s missing list off the quote row in every field, and records it on the file as his own fact', async () => {
        const d = deps();
        const file = fixture();
        const out = await draftQuote(file, file.parties[0], intake, d);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        const row = (await d.store.read(out.slug))!;
        // The row is public: /api/personalized-quotes/:slug serves every line-item field but the
        // materials array verbatim to anyone holding the slug, so nothing internal may be on it.
        expect(JSON.stringify(row)).not.toMatch(/photo \(asked once, none sent\)|yours to request/i);
        const line = (row.pricingLineItems as any[])[0];
        expect(line.description).toBe('mixer tap, dripping at the base');
        expect(line.notes).toBe('mixer tap, dripping at the base');
        const scope = readQuoteScope(quoteRecordOf(row, d.now!()));
        expect(scope.ok).toBe(true);
        if (!scope.ok) return;
        expect(scope.value.lines[0].notes).toBe('mixer tap, dripping at the base');
        // It lives on the file instead, under a key the composer boundary keeps out of a reply.
        const missing = file.facts.find((f) => f.key === QUOTE_FACT.benToRequest)!;
        expect(missing.value).toBe('photo (asked once, none sent)');
        expect(isInternalFact(missing)).toBe(true);
        expect(customerVisibleFacts(file).map((f) => f.id)).not.toContain(missing.id);
    });

    it('records the drafter\'s failure as a refusal, with nothing on the file and no notification', async () => {
        const store = new MemoryQuoteStore();
        const d: QuotingDeps = { store, drafter: new FakeDrafter(store, { fail: 'estimator down' }), notifier: recordingNotifier, now: () => new Date('2026-09-11T10:00:00.000Z') };
        const file = fixture();
        const out = await draftQuote(file, file.parties[0], intake, d);
        expect(out.ok).toBe(false);
        expect(file.job.quoteRef).toBeNull();
        expect(file.facts.some((f) => f.key.startsWith('quote_'))).toBe(false);
    });
});

describe('the first-contact acknowledgement the delivery sends of its own', () => {
    it('passes all eight guards, so its wording can never hold a delivery in front of a customer', () => {
        // The door prepends this line to the delivery it sends on a first contact and the guards
        // read what goes, so a wording change that trips one of them must fail here rather than
        // become a hold the composer's retry has no power to clear.
        const file = fixture();
        const out = runGuards({
            file, party: file.parties[0], turn: file.turns[0], reply: FIRST_CONTACT_ACK_WORDS,
            factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, prompted: 'human_action', liveQuoteRefs: new Set<string>(),
        });
        expect(Object.keys(out.guards).sort()).toEqual([...GUARD_NAMES].sort());
        expect(Object.entries(out.guards).filter(([, v]) => v.result !== 'pass')).toEqual([]);
        expect(out.ok).toBe(true);
        // Short enough to sit ahead of a quote message in one text of two segments.
        expect(smsSegmentCount(FIRST_CONTACT_ACK_WORDS)).toBe(1);
    });
});

describe('chase', () => {
    it('chases an unpriced draft after four hours, then daily, three times at most; never once the quote is priced', async () => {
        const d = deps();
        const file = fixture();
        await draftQuote(file, file.parties[0], intake, d);
        const party = file.parties[0];
        expect((await chase(file, party, d)).chased).toBe(false);
        d.clock.t += 4 * 3_600_000 + 1;
        const first = await chase(file, party, d);
        expect(first).toMatchObject({ chased: true, n: 1 });
        expect(first.notice?.link).toContain('/admin/price/');
        expect(first.notice?.title).toMatch(/still unpriced/);
        expect(file.facts.filter((f) => f.key === QUOTE_FACT.benChased)).toHaveLength(1);
        d.clock.t += 3_600_000;
        expect((await chase(file, party, d)).reason).toMatch(/not due/);
        d.clock.t += 24 * 3_600_000;
        expect((await chase(file, party, d)).n).toBe(2);
        d.clock.t += 24 * 3_600_000;
        expect((await chase(file, party, d)).n).toBe(3);
        d.clock.t += 24 * 3_600_000;
        const capped = await chase(file, party, d);
        expect(capped.chased).toBe(false);
        expect(capped.reason).toMatch(new RegExp(`${CHASE_MAX}`));
        // Priced but never sent is still Ben's to finish, so it is still chased; sent is not.
        const other = deps();
        const f2 = fixture();
        await draftQuote(f2, f2.parties[0], intake, other);
        await priceQuote(f2, {}, other);
        other.clock.t += 5 * 3_600_000;
        // What it waits on decides the words: this one is priced, so it is not called unpriced.
        const pricedChase = await chase(f2, f2.parties[0], other);
        expect(pricedChase.chased).toBe(true);
        expect(pricedChase.notice?.title).toMatch(/priced but not sent/);
        expect(pricedChase.notice?.title).not.toMatch(/unpriced/);
        expect(pricedChase.notice?.message).toMatch(/the delivery was held/);
        expect(pricedChase.notice?.message).not.toMatch(/waited .* for a price/);
        const marked = await markQuoteSent(f2, other);
        expect(marked.ok).toBe(true);
        other.clock.t += 48 * 3_600_000;
        expect((await chase(f2, f2.parties[0], other)).reason).toMatch(/nothing to chase/);
    });
});

describe('what the chase tells Ben about the customer', () => {
    it('says they have not heard from us at all while nothing has gone out, and only then that they were told', async () => {
        // Their acknowledgement can be held for Ben too (a shut window with no approved template),
        // so a notice promising them a quote would be telling him something nobody has said.
        const d = deps();
        const file = fixture();
        await draftQuote(file, file.parties[0], intake, d);
        d.clock.t += 5 * 3_600_000;
        const quiet = await chase(file, file.parties[0], d);
        expect(quiet.chased).toBe(true);
        expect(quiet.notice?.message).toContain('has not heard from us at all yet');
        expect(quiet.notice?.message).not.toContain('has been told the quote is on its way');

        const landed = appendTurn(file, {
            at: new Date(d.clock.t).toISOString(), channel: 'whatsapp', direction: 'outbound', partyId: file.parties[0].personId,
            kind: 'text', body: 'Ben will put the quote together and send it over.', media: [], runId: 'run_ack', approver: 'agent.comms_v2',
        });
        expect(landed.ok).toBe(true);
        d.clock.t += 24 * 3_600_000;
        const after = await chase(file, file.parties[0], d);
        expect(after.chased).toBe(true);
        expect(after.notice?.message).toContain('has been told the quote is on its way');
        expect(after.notice?.message).not.toContain('has not heard from us');
    });
});

describe('read_quote_line and read_quote_scope', () => {
    it('refuses a draft, a revoked, a superseded and an expired quote and an unknown label; reads a live line to the penny with its citation', async () => {
        const d = deps();
        const file = fixture();
        const drafted = await draftQuote(file, file.parties[0], intake, d);
        if (!drafted.ok) throw new Error(drafted.reason);
        const draft = (await loadQuote(file, d))!;
        expect(draft.status).toBe('draft');
        expect(readQuoteLine(draft, 'Replace kitchen tap')).toMatchObject({ ok: false, status: 'draft' });
        expect(readQuoteScope(draft)).toMatchObject({ ok: true });
        const priced = await priceQuote(file, { lines: [{ lineId: 'card_1', finalPence: 12000 }] }, d);
        expect(priced.ok).toBe(true);
        // Priced is not sent: no figure may be read until Ben's send has landed.
        expect(readQuoteLine((await loadQuote(file, d))!, 'Replace kitchen tap')).toMatchObject({ ok: false, status: 'draft' });
        expect((await markQuoteSent(file, d)).ok).toBe(true);
        const live = (await loadQuote(file, d))!;
        expect(live.status).toBe('sent');
        const line = readQuoteLine(live, 'replace kitchen tap');
        expect(line).toMatchObject({ ok: true, value: { label: 'Replace kitchen tap', amountPence: 12000, amount: '£120.00', citation: { quoteRef: live.slug, line: 'Replace kitchen tap' } } });
        // A line's labour and materials halves are not labels a figure may be read under: they are a
        // breakdown of a line, and the quote page prints them in whole pounds.
        expect(readQuoteLine(live, 'Replace kitchen tap labour')).toMatchObject({ ok: false });
        expect(readQuoteLine(live, 'Replace kitchen tap materials')).toMatchObject({ ok: false });
        expect(readQuoteLine(live, 'Total')).toMatchObject({ ok: true, value: { amount: '£120.00' } });
        expect(readQuoteLine(live, 'Deposit')).toMatchObject({ ok: true, value: { amount: '£45.00' } });
        expect(readQuoteLine(live, 'call-out fee')).toMatchObject({ ok: false });
        const row = d.store.rows.get(live.slug)!;
        expect(readQuoteLine(quoteRecordOf({ ...row, expiresAt: '2026-09-01T00:00:00.000Z' }, d.now()), 'Total')).toMatchObject({ ok: false, status: 'expired' });
        expect(readQuoteLine(quoteRecordOf({ ...row, revokedAt: '2026-09-11T11:00:00.000Z' }), 'Total')).toMatchObject({ ok: false, status: 'revoked' });
        expect(readQuoteLine(quoteRecordOf({ ...row, supersededAt: '2026-09-11T11:00:00.000Z' }), 'Total')).toMatchObject({ ok: false, status: 'superseded' });
        expect(readQuoteScope(quoteRecordOf({ ...row, revokedAt: '2026-09-11T11:00:00.000Z' }))).toMatchObject({ ok: false });
        expect(pounds(1999)).toBe('£19.99');
    });

    it('records the quote onto the file once, each figure cited to its line; the figure guard passes the cited figure and fails a rounded or uncited one', async () => {
        const d = deps();
        const file = fixture();
        await draftQuote(file, file.parties[0], intake, d);
        const beforePrice = recordQuoteFacts(file, (await loadQuote(file, d))!, d);
        expect(Object.keys(beforePrice.lines)).toEqual([]);
        expect(beforePrice.scope.length).toBe(1);
        await priceQuote(file, {}, d);
        expect((await markQuoteSent(file, d)).ok).toBe(true);
        const live = (await loadQuote(file, d))!;
        const ids = recordQuoteFacts(file, live, d);
        expect(Object.keys(ids.lines).sort()).toEqual(['Deposit', 'Replace kitchen tap', 'Total']);
        const again = recordQuoteFacts(file, live, d);
        expect(again.lines).toEqual(ids.lines);
        const tap = file.facts.find((f) => f.id === ids.lines['Replace kitchen tap'])!;
        expect(tap).toMatchObject({ key: 'quote_line:Replace kitchen tap', value: '£120.00', source: { kind: 'quote_line', quoteRef: live.slug, line: 'Replace kitchen tap' } });
        expect(file.facts.some((f) => /labour|materials/i.test(f.key))).toBe(false);
        const party = file.parties[0]; const turn = file.turns[0];
        const liveQuoteRefs = await liveFigureQuotes(file, d);
        const base = { file, party, turn, kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, liveQuoteRefs };
        expect(runGuards({ ...base, reply: 'That line on your quote is £120.00.', factIds: [tap.id] }).guards.figure.result).toBe('pass');
        expect(runGuards({ ...base, reply: 'That line on your quote is £120.', factIds: [tap.id] }).guards.figure.result).toBe('fail');
        expect(runGuards({ ...base, reply: 'That line on your quote is £120.00.', factIds: [] }).guards.figure.result).toBe('fail');
        expect(runGuards({ ...base, reply: 'The labour on it is £100.00.', factIds: [tap.id] }).guards.figure.result).toBe('fail');
    });

    it('two lines the quote titles the same keep their own figures, and neither is given as the other', async () => {
        const d = deps();
        const file = fixture();
        const panels: DraftIntake = { ...intake, lines: [
            { title: 'Replace a fence panel', category: 'garden', qty: 1, detail: 'the front one, 6ft', assumptions: [], notIncluded: [] },
            { title: 'Replace a fence panel', category: 'garden', qty: 1, detail: 'the rear one, 3ft', assumptions: [], notIncluded: [] },
        ] };
        await draftQuote(file, file.parties[0], panels, d);
        expect((await priceQuote(file, { lines: [{ lineId: 'card_1', finalPence: 12000 }, { lineId: 'card_2', finalPence: 8000 }] }, d)).ok).toBe(true);
        expect((await markQuoteSent(file, d)).ok).toBe(true);
        const live = (await loadQuote(file, d))!;
        const ids = recordQuoteFacts(file, live, d);

        // One fact per line, each carrying its own line's amount.
        expect(Object.keys(ids.lines).sort()).toEqual(['Deposit', 'Replace a fence panel (line 1)', 'Replace a fence panel (line 2)', 'Total']);
        const front = file.facts.find((f) => f.id === ids.lines['Replace a fence panel (line 1)'])!;
        const rear = file.facts.find((f) => f.id === ids.lines['Replace a fence panel (line 2)'])!;
        expect(front.value).toBe('£120.00');
        expect(rear.value).toBe('£80.00');
        // Neither hides the other from the composer: they are different lines, not one line re-priced.
        const visible = customerVisibleFacts(file).map((f) => f.id);
        expect(visible).toContain(front.id);
        expect(visible).toContain(rear.id);

        // Asked for under the title they share, neither line is meant, so no figure is read at all.
        expect(readQuoteLine(live, 'Replace a fence panel')).toMatchObject({ ok: false });
        expect(readQuoteLine(live, 'Replace a fence panel (line 2)')).toMatchObject({ ok: true, value: { amount: '£80.00', citation: { quoteRef: live.slug, line: 'Replace a fence panel (line 2)' } } });
    });

    it('refuses a cited figure once the quote is no longer live, status by status, though the fact stays on the file', async () => {
        const d = deps();
        const file = fixture();
        await draftQuote(file, file.parties[0], intake, d);
        await priceQuote(file, {}, d);
        expect((await markQuoteSent(file, d)).ok).toBe(true);
        const live = (await loadQuote(file, d))!;
        const ids = recordQuoteFacts(file, live, d);
        const total = file.facts.find((f) => f.id === ids.lines.Total)!;
        expect(total.value).toBe('£120.00');
        const base = { file, party: file.parties[0], turn: file.turns[0], reply: 'The total on your quote is £120.00.', factIds: [total.id], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null };
        const figure = async () => runGuards({ ...base, liveQuoteRefs: await liveFigureQuotes(file, d) }).guards.figure;
        const row = d.store.rows.get(live.slug)!;
        const statuses: Array<{ status: QuoteStatus; patch: Record<string, unknown>; live: boolean }> = [
            { status: 'sent', patch: {}, live: true },
            { status: 'accepted', patch: { depositPaidAt: '2026-09-11T12:00:00.000Z' }, live: true },
            { status: 'revoked', patch: { revokedAt: '2026-09-11T12:00:00.000Z' }, live: false },
            { status: 'superseded', patch: { supersededAt: '2026-09-11T12:00:00.000Z' }, live: false },
            { status: 'expired', patch: { expiresAt: '2026-09-01T00:00:00.000Z' }, live: false },
        ];
        for (const { status, patch, live: isLive } of statuses) {
            const before: Record<string, unknown> = {};
            for (const k of Object.keys(patch)) before[k] = (row as any)[k];
            Object.assign(row, patch);
            expect((await loadQuote(file, d))!.status).toBe(status);
            expect(Array.from(await liveFigureQuotes(file, d))).toEqual(isLive ? [live.slug] : []);
            const verdict = await figure();
            expect(verdict.result).toBe(isLive ? 'pass' : 'fail');
            if (!isLive) expect(verdict.note).toMatch(/live quote/);
            // The fact is never retracted: it is the citation that stops being readable.
            expect(file.facts.some((f) => f.id === total.id)).toBe(true);
            Object.assign(row, before);
        }
    });
});

describe('price_quote, the stage, and acceptance', () => {
    it('prices through the store, moves ready to quoted when the send lands, and accepts only as a human event', async () => {
        const d = deps();
        const file = fixture();
        const noQuote = await priceQuote(file, {}, d);
        expect(noQuote).toMatchObject({ ok: false, status: 409 });
        await draftQuote(file, file.parties[0], intake, d);
        const early = await recordAcceptance(file, file.parties[0], { by: 'human', via: 'test' }, d);
        expect(early).toMatchObject({ ok: false, status: 409 });
        const priced = await priceQuote(file, { lines: [{ lineId: 'card_1', finalPence: 15000 }] }, d);
        expect(priced.ok).toBe(true);
        if (!priced.ok) return;
        expect(priced.totals.totalPence).toBe(15000);
        expect(priced.quoteUrl).toBe(`https://test.local/quote/${priced.record.slug}`);
        expect(priced.factIds.length).toBeGreaterThan(0);
        expect(file.stage).toBe('first_contact');
        // The price screen's write leaves the row a draft, exactly as confirmPrices does live:
        // no figure is on the file and no figure may be read until the send has landed.
        expect((await loadQuote(file, d))!.status).toBe('draft');
        expect(file.facts.some((f) => f.key.startsWith('quote_line:'))).toBe(false);
        const marked = await markQuoteSent(file, d);
        expect(marked.ok).toBe(true);
        if (!marked.ok) return;
        expect(marked.record.status).toBe('sent');
        expect(marked.factIds.length).toBeGreaterThan(0);
        expect(file.facts.find((f) => f.key === 'quote_line:Total')?.value).toBe('£150.00');
        expect(file.facts.find((f) => f.key === QUOTE_FACT.link)?.value).toBe(`https://test.local/quote/${priced.record.slug}`);
        expect(file.stage).toBe('quoted');
        expect(file.stageHistory.map((s) => s.to)).toEqual(['first_contact', 'scoping', 'ready', 'quoted']);
        const twice = await priceQuote(file, {}, d);
        expect(twice).toMatchObject({ ok: false, status: 409 });

        const notHuman = await recordAcceptance(file, file.parties[0], { by: 'specialist' }, d);
        expect(notHuman).toMatchObject({ ok: false, status: 403 });
        expect(file.stage).toBe('quoted');
        const accepted = await recordAcceptance(file, file.parties[0], { by: 'human', via: 'quote page' }, d);
        expect(accepted.ok).toBe(true);
        if (!accepted.ok) return;
        expect(file.stage).toBe('accepted');
        expect(accepted.notice?.title).toBe('Quote accepted');
        expect(accepted.turnBody).toMatch(/Accepted quote/);
        expect(file.facts.some((f) => f.key === QUOTE_FACT.accepted)).toBe(true);
        expect((await loadQuote(file, d))!.status).toBe('accepted');
        const again = await recordAcceptance(file, file.parties[0], { by: 'human', via: 'quote page' }, d);
        expect(again).toMatchObject({ ok: false, status: 409 });
    });

    it('tells Ben the number the file carries when the thread ran by text, not "no number"', async () => {
        const d = deps();
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'sms', address: '+447700900942',
            firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'sms', kind: 'text', body: 'Hi, my kitchen tap is leaking, NG9 2AB', media: [] },
        });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        recordFact(file, { key: 'job_type', value: 'leaking kitchen tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
        recordFact(file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
        expect(file.parties[0].channels.map((c) => c.kind)).toEqual(['sms']);

        await draftQuote(file, file.parties[0], intake, d);
        expect((await priceQuote(file, {}, d)).ok).toBe(true);
        expect((await markQuoteSent(file, d)).ok).toBe(true);
        const accepted = await recordAcceptance(file, file.parties[0], { by: 'human', via: 'quote page' }, d);
        expect(accepted.ok).toBe(true);
        if (!accepted.ok) return;
        expect(accepted.notice?.message).toContain('Sam - +447700900942');
        expect(accepted.notice?.message).not.toContain('no number');
    });

    it('refuses an expired quote, so one that could not be quoted a turn earlier cannot read back as accepted', async () => {
        const d = deps();
        const file = fixture();
        await draftQuote(file, file.parties[0], intake, d);
        expect((await priceQuote(file, {}, d)).ok).toBe(true);
        expect((await markQuoteSent(file, d)).ok).toBe(true);
        const row = d.store.rows.get(file.job.quoteRef!)!;
        row.expiresAt = '2026-09-01T00:00:00.000Z';
        expect((await loadQuote(file, d))!.status).toBe('expired');

        const refused = await recordAcceptance(file, file.parties[0], { by: 'human', via: 'quote page' }, d);
        expect(refused).toMatchObject({ ok: false, status: 409 });
        if (!refused.ok) expect(refused.reason).toMatch(/no longer live/);
        // No deposit was written, so the row cannot read accepted and no figure becomes readable.
        expect(row.depositPaidAt).toBeUndefined();
        expect((await loadQuote(file, d))!.status).toBe('expired');
        expect(Array.from(await liveFigureQuotes(file, d))).toEqual([]);
        expect(file.stage).toBe('quoted');
    });
});

describe('the live read', () => {
    const now = new Date('2026-09-11T10:00:00.000Z');
    const sent: QuoteRowLike = {
        id: 'quote_1', shortSlug: 'abcd1234', customerName: 'Sam', phone: '+447700900942', postcode: 'NG9 2AB',
        isDraft: false, revokedAt: null, supersededAt: null, depositPaidAt: null, expiresAt: '2026-09-01T00:00:00.000Z',
        createdAt: '2026-08-30T10:00:00.000Z', basePrice: 12000, depositAmountPence: 4000,
        pricingLineItems: [{ lineId: 'card_1', label: 'Replace kitchen tap', qty: 1, pricePence: 12000, materialsPence: 2000, description: 'mixer tap' }],
        pricingSuggestions: { totals: { suggestedPence: 11000 }, lines: [{ lineId: 'card_1', checkThis: true }] },
        customerPhotoUrls: ['https://example.test/a.jpg'],
    };
    /** What the row must say for the column under test to change anything the record shows. */
    const observable: Partial<Record<string, Partial<QuoteRowLike>>> = {
        revokedAt: { revokedAt: '2026-09-05T09:00:00.000Z' },
        supersededAt: { supersededAt: '2026-09-05T09:00:00.000Z' },
        depositPaidAt: { depositPaidAt: '2026-09-05T09:00:00.000Z' },
    };
    /** What `liveQuoteStore.read` hands back: the row narrowed to the columns it asked the database for. */
    const asRead = (row: QuoteRowLike, columns: string[]): QuoteRowLike =>
        Object.fromEntries(columns.map((k) => [k, (row as any)[k]])) as QuoteRowLike;

    it.each(Object.keys(QUOTE_READ_COLUMNS))('reads %s: dropping that column from the live select changes the record', (column) => {
        const row = { ...sent, ...(observable[column] ?? {}) };
        const whole = quoteRecordOf(row, now);
        const short = Object.keys(QUOTE_READ_COLUMNS).filter((k) => k !== column);
        expect(quoteRecordOf(asRead(row, short), now)).not.toEqual(whole);
    });

    it('asks for nothing the record does not need: columns outside the list change nothing when the read drops them', () => {
        const withExtras = { ...sent, status: 'sent', conversationId: 'conv_1', updatedAt: '2026-09-02T10:00:00.000Z', internalNotes: 'no photo yet' } as QuoteRowLike;
        expect(quoteRecordOf(asRead(withExtras, Object.keys(QUOTE_READ_COLUMNS)), now)).toEqual(quoteRecordOf(withExtras, now));
        expect(quoteRecordOf(asRead(withExtras, Object.keys(QUOTE_READ_COLUMNS)), now).totalPence).toBe(12000);
    });
});
