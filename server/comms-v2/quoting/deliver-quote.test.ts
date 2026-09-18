/**
 * Delivering a priced quote through the new desk's sender, and Ben's live price screen handing a
 * quote on a live case file to it:
 *
 *   on a shut WhatsApp window with `quote_ready_link` approved, the template carries the link (its
 *   second variable) under the person who licensed the send, and the quote leaves draft;
 *   with it not approved, the delivery holds for Ben and the quote stays a draft;
 *   live, the template reaches the deliverer with its content SID and the link;
 *   live on an open window, Ben's priced quote goes through the real live deliverer under his
 *   `human:*` approver and is gated on the desk's own switch, not refused for his row having none;
 *   the price screen hands a quote to the new desk only while the new desk is live and a case file
 *   carries the quote, and every other quote gets null back for the old path;
 *   with the thread held because the customer asked us to stop, nothing is composed and nothing goes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendTurn, open } from '../desk/case-file';
import { Desk } from '../desk/desk';
import { noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { noTemplateApproved, type Deliverer } from '../desk/sender';
import { MemoryCaseFileStore } from '../desk/store';
import { deliverPricedQuote } from './deliver-quote';
import { FakeDrafter } from './draft-quote';
import { sendPricedQuoteThroughDesk } from './price-screen-send';
import { MemoryQuoteStore } from './quote-store';
import { priceQuote } from './quoting-tools';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const now = () => NOW;
const SHUT = '2026-09-13T08:00:00.000Z';
const approved = { async approved(name: string) { return name === 'quote_ready_link' ? { contentSid: 'HX_quote_ready_link' } : null; } };
const client = new FakeModelClient({
    router: () => { throw new Error('no router on a delivery'); },
    specialist: () => { throw new Error('no specialist on a delivery'); },
    composer: () => { throw new Error('a shut window is never composed for'); },
});
const APPROVER = 'human:ben@example.com' as const;

async function pricedThread(lastWrote = SHUT) {
    const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam Jones' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: lastWrote, channel: 'whatsapp', kind: 'text', body: 'my kitchen tap is dripping, NG9 2AB', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    const file = r.value;
    const drafted = await new FakeDrafter(store).draft({ file, party: file.parties[0], intake: { customerName: 'Sam Jones', postcode: 'NG9 2AB', customerType: 'homeowner', lines: [{ title: 'Replace kitchen tap', category: null, qty: 1, detail: null, assumptions: [], notIncluded: [] }], missing: [] }, now: NOW });
    if (!drafted.ok) throw new Error(drafted.reason);
    file.job.quoteRef = drafted.slug;
    const priced = await priceQuote(file, {}, { store, now });
    if (!priced.ok) throw new Error(priced.reason);
    return { file, store, priced };
}

describe('deliverPricedQuote on a shut window', () => {
    it('sends the approved quote_ready_link template carrying the link, under the person who licensed it, and the quote leaves draft', async () => {
        const { file, store, priced } = await pricedThread();
        const out = await deliverPricedQuote({ file, priced, approver: APPROVER, mode: 'dry_run', now, deps: { client, templates: approved, fixedLines: noFixedLineSource, quoting: { store } } });
        expect(out).toMatchObject({ ok: true, sent: true });
        if (!out.ok) return;
        expect(out.result).toMatchObject({ decision: 'send', templateId: 'quote_ready_link', windowState: 'shut', approver: APPROVER, delivered: true, composerCalls: 0 });
        expect(out.result.bubbles).toHaveLength(1);
        expect(out.result.bubbles[0].text).toBe(`Hi Sam, your quote is ready. Everything is on the link, the itemised price and the booking: ${priced.quoteUrl}. Any questions, just reply here.`);
        expect(file.sends.at(-1)).toMatchObject({ templateId: 'quote_ready_link', windowState: 'shut', approver: APPROVER, mode: 'dry_run' });
        expect((await store.read(priced.record.slug))?.isDraft).toBe(false);
    });

    it('holds for Ben and leaves the quote a draft while no approved template carries a quote link', async () => {
        const { file, store, priced } = await pricedThread();
        const out = await deliverPricedQuote({ file, priced, approver: APPROVER, mode: 'dry_run', now, deps: { client, templates: noTemplateApproved, fixedLines: noFixedLineSource, quoting: { store } } });
        expect(out).toMatchObject({ ok: true, sent: false });
        if (!out.ok) return;
        expect(file.hold?.reason).toMatch(/window is shut.*no approved template carries a quote link/);
        expect(file.sends).toHaveLength(0);
        expect((await store.read(priced.record.slug))?.isDraft).toBe(true);
    });

    it('live, hands the template to the deliverer with its content SID and the link as its second variable', async () => {
        const { file, store, priced } = await pricedThread();
        const seen: Array<Parameters<Deliverer['deliver']>[0]> = [];
        const deliverer: Deliverer = { async deliver(i) { seen.push(i); return { ok: true, sid: 'SM1' }; } };
        const out = await deliverPricedQuote({ file, priced, approver: APPROVER, mode: 'live', now, deps: { client, templates: approved, fixedLines: noFixedLineSource, quoting: { store }, sender: { deliverer } } });
        expect(out).toMatchObject({ ok: true, sent: true });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ channel: 'whatsapp', to: '+447700900942', approver: APPROVER, purpose: 'service_reply', template: { name: 'quote_ready_link', contentSid: 'HX_quote_ready_link', variables: { '1': 'Sam', '2': priced.quoteUrl } } });
    });
});

describe('deliverPricedQuote on an open window', () => {
    const SENTENCE = 'Everything on the page is itemised line by line, so you can see exactly what the visit covers before you book.';
    const writing = (sentences: number) => new FakeModelClient({ composer: ({ user }) => ({ reply: `Your quote is ready: ${/https:\/\/test\.local\/\S+/.exec(user)?.[0] ?? ''}. ${Array.from({ length: sentences }, () => SENTENCE).join(' ')}`, factIds: [], kbIds: [] }) });
    const open = '2026-09-14T11:50:00.000Z';

    it('sends a message too long for three 160-character bubbles in at most three wider ones', async () => {
        const { file, store, priced } = await pricedThread(open);
        const out = await deliverPricedQuote({ file, priced, approver: APPROVER, mode: 'dry_run', now, deps: { client: writing(4), templates: approved, fixedLines: noFixedLineSource, quoting: { store } } });
        expect(out).toMatchObject({ ok: true, sent: true });
        if (!out.ok) return;
        expect(out.result.bubbles.length).toBeGreaterThan(0);
        expect(out.result.bubbles.length).toBeLessThanOrEqual(3);
        expect(out.result.bubbles.some((b) => b.text.length > 160)).toBe(true);
        expect(out.result.bubbles.map((b) => b.text).join(' ')).toContain(priced.quoteUrl);
    });

    it('holds rather than sending a fourth bubble when even wider ones cannot fit it', async () => {
        const { file, store, priced } = await pricedThread(open);
        const out = await deliverPricedQuote({ file, priced, approver: APPROVER, mode: 'dry_run', now, deps: { client: writing(12), templates: approved, fixedLines: noFixedLineSource, quoting: { store } } });
        expect(out).toMatchObject({ ok: true, sent: false });
        expect(file.hold?.reason).toMatch(/the delivery message could not be rendered \(ceiling\)/);
        expect(file.sends).toHaveLength(0);
    });
});

describe('deliverPricedQuote through the real live deliverer', () => {
    // An empty opt-out ledger: nobody on these threads has opted out.
    beforeEach(() => { vi.doMock('../../opt-out', () => ({ blockedByOptOut: async () => null, optOutRefusalMessage: () => '' })); });
    afterEach(() => { vi.doUnmock('../../spine/config'); vi.doUnmock('../../outbound'); vi.doUnmock('../../opt-out'); vi.resetModules(); });
    const composing = new FakeModelClient({ composer: ({ user }) => ({ reply: `Your quote is ready: ${/https:\/\/test\.local\/\S+/.exec(user)?.[0] ?? ''}\n\nAny questions, just reply here.`, factIds: [], kbIds: [] }) });
    const wire = (outbox: Array<{ approver: string; body: string }>) => vi.doMock('../../outbound', () => ({ sendCustomerMessage: async (i: { approver: string; body: string }) => { outbox.push(i); return { ok: true, sid: `SM${outbox.length}`, attempts: [], fellBack: false }; } }));

    // The live refusal of 16 Sep 2026 (quote d3yjctxm): with the desk's switch on, a quote Ben priced
    // was held with "spine.senders.null.enabled is not true", because the deliverer read the switch
    // of his `human:*` row, which has none. No other live test reached the real deliverer.
    it('sends a quote Ben priced on an open window under his human approver while the desk\'s switch is on', async () => {
        const outbox: Array<{ approver: string; body: string }> = [];
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        wire(outbox);
        const { file, store, priced } = await pricedThread('2026-09-14T11:50:00.000Z');
        const out = await deliverPricedQuote({ file, priced, approver: APPROVER, mode: 'live', now, deps: { client: composing, templates: approved, fixedLines: noFixedLineSource, quoting: { store } } });
        expect(file.hold?.reason ?? null).toBeNull();
        expect(out).toMatchObject({ ok: true, sent: true });
        expect(outbox.length).toBeGreaterThan(0);
        expect(new Set(outbox.map((o) => o.approver))).toEqual(new Set([APPROVER]));
        expect(outbox.map((o) => o.body).join('\n')).toContain(priced.quoteUrl);
        expect((await store.read(priced.record.slug))?.isDraft).toBe(false);
    });

    it('the live price screen\'s send gets a 200 back, not a 409 hold, through the same real deliverer', async () => {
        const outbox: Array<{ approver: string; body: string }> = [];
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        wire(outbox);
        const { file, store, priced } = await pricedThread('2026-09-14T11:50:00.000Z');
        const cases = new MemoryCaseFileStore();
        cases.put(file);
        const sent = await sendPricedQuoteThroughDesk(
            { slug: priced.record.slug, approver: APPROVER, quoteUrl: priced.quoteUrl, totals: priced.totals },
            { liveState: async () => ({ live: true, off: [] }), gateway: async () => ({ store: cases }), deskDeps: { client: composing, templates: approved, fixedLines: noFixedLineSource, quoting: { store } }, now },
        );
        expect(sent).toMatchObject({ status: 200, json: { ok: true, sent: true, desk: 'comms_v2', mode: 'freeform' } });
        expect(new Set(outbox.map((o) => o.approver))).toEqual(new Set([APPROVER]));
        expect(file.hold).toBeNull();
    });

    it('still holds it, naming the desk\'s own switch, while that switch is off', async () => {
        const outbox: Array<{ approver: string; body: string }> = [];
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: {} }) }));
        wire(outbox);
        const { file, store, priced } = await pricedThread('2026-09-14T11:50:00.000Z');
        const out = await deliverPricedQuote({ file, priced, approver: APPROVER, mode: 'live', now, deps: { client: composing, templates: approved, fixedLines: noFixedLineSource, quoting: { store } } });
        expect(out).toMatchObject({ ok: true, sent: false });
        expect(file.hold?.reason).toBe(`quote ${priced.record.slug} priced; the send was refused (spine.senders.comms_v2.enabled is not true; the new desk stays in the sandbox until it is)`);
        expect(outbox).toEqual([]);
        expect((await store.read(priced.record.slug))?.isDraft).toBe(true);
    });
});

describe('the live price screen hands a quote to the new desk', () => {
    it('only while the new desk is live and an open case file carries the quote; every other quote gets null for the old path', async () => {
        const { file, store, priced } = await pricedThread();
        const cases = new MemoryCaseFileStore();
        const input = { slug: priced.record.slug, approver: APPROVER, quoteUrl: priced.quoteUrl, totals: priced.totals };
        const deskDeps = { client, templates: approved, fixedLines: noFixedLineSource, quoting: { store }, sender: { deliverer: { async deliver() { return { ok: true as const, sid: 'SM1' }; } } } };

        expect(await sendPricedQuoteThroughDesk(input, { liveState: async () => ({ live: false, off: ["spine.commsDesk = 'comms_v2'"] }), gateway: async () => { throw new Error('never built while not live'); }, deskDeps, now })).toBeNull();
        expect(await sendPricedQuoteThroughDesk(input, { liveState: async () => ({ live: true, off: [] }), gateway: async () => ({ store: cases }), deskDeps, now })).toBeNull();

        let puts = 0;
        const put = cases.put.bind(cases);
        cases.put = (f) => { puts++; put(f); };
        cases.put(file);
        puts = 0;
        const sent = await sendPricedQuoteThroughDesk(input, { liveState: async () => ({ live: true, off: [] }), gateway: async () => ({ store: cases }), deskDeps, now });
        expect(sent).toMatchObject({ status: 200, json: { ok: true, sent: true, desk: 'comms_v2', caseId: file.id, mode: 'template', templateName: 'quote_ready_link' } });
        expect(file.sends.at(-1)).toMatchObject({ approver: APPROVER, mode: 'live' });
        expect(puts).toBe(1);
    });
});

describe('deliverPricedQuote while the customer has asked us to stop', () => {
    it('composes nothing, sends nothing and leaves the quote a draft, with the reason on the card the price screen shows', async () => {
        const { file, store, priced } = await pricedThread('2026-09-14T11:50:00.000Z');
        // The opt-out arrives by email, which the old inbound path does not record, so the desk holds the thread for Ben.
        const stop = appendTurn(file, { at: '2026-09-14T11:55:00.000Z', channel: 'email', kind: 'text', body: 'Subject: Unsubscribe\n\nPlease unsubscribe me', media: [], partyId: 'p1', direction: 'inbound', runId: null, approver: null });
        if (!stop.ok) throw new Error(stop.reason);
        const held = await new Desk({ client, templates: approved, fixedLines: noFixedLineSource, now, quoting: { store } }).handleTurn(file, stop.value);
        expect(held.decision).toBe('hold');
        expect(file.hold?.reason).toContain('customer may have asked to stop by email');

        const out = await deliverPricedQuote({ file, priced, approver: APPROVER, mode: 'dry_run', now, deps: { client, templates: approved, fixedLines: noFixedLineSource, quoting: { store } } });
        expect(out).toMatchObject({ ok: true, sent: false });
        if (!out.ok) return;
        expect(out.result).toMatchObject({ decision: 'hold', delivered: false, composerCalls: 0 });
        expect(out.result.bubbles).toEqual([]);
        expect(file.sends).toHaveLength(0);
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
        expect((await store.read(priced.record.slug))?.isDraft).toBe(true);
        // The card carries both: why the thread is held and why the quote did not go.
        expect(out.result.note).toMatch(/the customer asked us to stop and the thread is held for Ben on it/);
        expect(file.hold?.reason).toContain('customer may have asked to stop by email');
        expect(file.hold?.reason).toMatch(/the quote is not sent and stays a draft/);
    });
});
