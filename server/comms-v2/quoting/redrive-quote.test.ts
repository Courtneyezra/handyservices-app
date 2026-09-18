/**
 * The clock pass re-driving a priced quote whose delivery was refused (redrive-quote.ts):
 *
 *   once the refusal has cleared, the quote goes under the person who priced it, the delivery's own
 *   card clears in the desk's words, the quote leaves draft, and a later pass sends nothing more;
 *   a refusal that still applies is not driven into: the send gate, an opt-out hold, a customer
 *   message still waiting to be answered, a passed price lock and a shut window with no approved
 *   template (whose cards are rewritten to say so);
 *   a customer who has opted out never receives a re-driven quote, through the live sender's own gate;
 *   a quote no person priced, and a card someone else has written on, are left alone;
 *   the attempts are spaced and capped, and the card then says the desk will not try again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendTurn, hold as setHold, noteOnHold, open } from '../desk/case-file';
import { Desk, type DeskDeps } from '../desk/desk';
import { noFixedLineSource } from '../desk/fixed-lines';
import { BEN } from '../desk/guards';
import { FakeModelClient } from '../desk/models';
import { noTemplateApproved, type Deliverer } from '../desk/sender';
import { deliverPricedQuote, priceHold } from './deliver-quote';
import { FakeDrafter } from './draft-quote';
import { MemoryQuoteStore } from './quote-store';
import { priceQuote } from './quoting-tools';
import { MAX_REDRIVES, REDRIVE_FACT, REDRIVE_GAP_MS, redrivePricedQuote } from './redrive-quote';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const OPEN = '2026-09-14T11:50:00.000Z';
const SHUT = '2026-09-13T08:00:00.000Z';
/** Vitest sets BASE_URL to '/', so the quote link's base is named here as the live process's environment names it. */
const BASE = 'https://test.local';
const PRESSED_BY = 'human:ben@example.com' as const;
const approved = { async approved(name: string) { return name === 'quote_ready_link' ? { contentSid: 'HX_quote_ready_link' } : null; } };
const composing = new FakeModelClient({ composer: ({ user }) => ({ reply: `Your quote is ready: ${/https?:\/\/[^\s,]+\/quote\/[a-z0-9]+/.exec(user)?.[0] ?? ''}\n\nAny questions, just reply here.`, factIds: [], kbIds: [] }) });
const silent = new FakeModelClient({
    router: () => { throw new Error('no router on a clock pass'); },
    specialist: () => { throw new Error('no specialist on a clock pass'); },
    composer: () => { throw new Error('nothing is composed while a refusal still applies'); },
});
const SWITCH_REFUSAL = 'spine.senders.null.enabled is not true; the new desk stays in the sandbox until it is';

/** A deliverer that records each call and refuses while `refusing` is set. */
function deliverer(state: { refusing: boolean; calls: Array<{ approver: string; body: string }> }): Deliverer {
    return {
        async deliver(input) {
            state.calls.push({ approver: input.approver, body: input.bubbles.map((b) => b.text).join('\n') });
            return state.refusing ? { ok: false, reason: SWITCH_REFUSAL, delivered: [] } : { ok: true, sid: `SM${state.calls.length}` };
        },
    };
}

async function thread(lastWrote: string, opts: { price?: boolean } = {}) {
    const store = new MemoryQuoteStore({ baseUrl: BASE });
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
    if (opts.price === false) return { file, store, slug: drafted.slug };
    const priced = await priceQuote(file, {}, { store, now: () => NOW });
    if (!priced.ok) throw new Error(priced.reason);
    return { file, store, slug: drafted.slug, priced };
}

/** A priced quote on an open window whose first delivery the sender refused, as on 16 Sep 2026. */
async function refusedDelivery() {
    const t = await thread(OPEN);
    const wire = { refusing: true, calls: [] as Array<{ approver: string; body: string }> };
    const out = await deliverPricedQuote({ file: t.file, priced: t.priced!, approver: PRESSED_BY, mode: 'live', now: () => NOW, deps: { client: composing, templates: approved, fixedLines: noFixedLineSource, quoting: { store: t.store, baseUrl: BASE }, sender: { deliverer: deliverer(wire) } } });
    expect(out).toMatchObject({ ok: true, sent: false });
    expect(t.file.hold?.reason).toBe(`${priceHold(t.slug)} the send was refused (${SWITCH_REFUSAL})`);
    wire.calls.length = 0;
    return { ...t, wire };
}

const deskFor = (t: { store: MemoryQuoteStore }, wire: { refusing: boolean; calls: Array<{ approver: string; body: string }> } | null, at: () => Date, extra: Partial<DeskDeps> = {}) =>
    new Desk({ client: composing, templates: approved, fixedLines: noFixedLineSource, quoting: { store: t.store, baseUrl: BASE }, mode: 'live', now: at, ...(wire ? { sender: { deliverer: deliverer(wire) } } : {}), ...extra });

describe('the clock pass re-drives a refused quote delivery once the refusal has cleared', () => {
    it('sends it under the person who priced it, clears the card in the desk\'s words, takes the quote out of draft, and sends nothing on the next pass', async () => {
        const t = await refusedDelivery();
        t.wire.refusing = false;
        const at = () => new Date(NOW.getTime() + 60_000);
        const result = await deskFor(t, t.wire, at).clockPass(t.file);

        expect(t.wire.calls).toHaveLength(1);
        // The licence is the price: the person who confirmed it on the price screen.
        expect(t.wire.calls[0].approver).toBe('human:ben');
        expect(t.wire.calls[0].body).toContain(`/quote/${t.slug}`);
        expect(t.file.hold).toBeNull();
        expect(t.file.releases.at(-1)?.words).toBe(`the desk sent quote ${t.slug} on this attempt, so the card raised when the earlier one did not send is done`);
        expect((await t.store.read(t.slug))?.isDraft).toBe(false);
        expect(result).toMatchObject({ decision: 'send', delivered: true, hold: null });
        expect(result.note).toContain(`quote ${t.slug} re-driven and sent under human:ben`);

        await deskFor(t, t.wire, () => new Date(NOW.getTime() + 2 * REDRIVE_GAP_MS)).clockPass(t.file);
        expect(t.wire.calls).toHaveLength(1);
        expect(t.file.sends).toHaveLength(1);
    });

    it('never touches the price: the row keeps the total the person set', async () => {
        const t = await refusedDelivery();
        const before = await t.store.read(t.slug);
        t.wire.refusing = false;
        await deskFor(t, t.wire, () => NOW).clockPass(t.file);
        const after = await t.store.read(t.slug);
        expect(after?.basePrice).toBe(before?.basePrice);
        expect(after?.pricingLineItems).toEqual(before?.pricingLineItems);
    });
});

describe('the re-drive does not drive into a refusal that still applies', () => {
    it('asks the send gate first and composes nothing while it still refuses', async () => {
        const t = await refusedDelivery();
        const r = await redrivePricedQuote(t.file, { desk: { client: silent, templates: approved, fixedLines: noFixedLineSource, quoting: { store: t.store, baseUrl: BASE } }, mode: 'live', now: () => NOW, sendRefusal: async () => SWITCH_REFUSAL });
        expect(r).toEqual({ note: `quote ${t.slug} not re-driven: ${SWITCH_REFUSAL}`, result: null });
        expect(t.file.facts.filter((f) => f.key === REDRIVE_FACT)).toHaveLength(0);
        expect((await t.store.read(t.slug))?.isDraft).toBe(true);
    });

    it('sends nothing while a customer message is still waiting to be answered', async () => {
        const t = await refusedDelivery();
        t.wire.refusing = false;
        const waiting = appendTurn(t.file, { at: '2026-09-14T11:59:00.000Z', channel: 'whatsapp', kind: 'text', body: "actually I've found someone else, don't bother", media: [], partyId: 'p1', direction: 'inbound', runId: null, approver: null });
        if (!waiting.ok) throw new Error(waiting.reason);
        t.file.waits = [{ partyId: 'p1', channel: 'whatsapp', turnIds: [waiting.value.id], dueAt: '2026-09-14T12:01:30.000Z', holder: 'gw1', handedAt: null }];
        const result = await deskFor(t, t.wire, () => NOW, { client: silent }).clockPass(t.file);
        expect(t.wire.calls).toHaveLength(0);
        expect(t.file.sends).toHaveLength(0);
        expect(t.file.facts.filter((f) => f.key === REDRIVE_FACT)).toHaveLength(0);
        expect(result.note).not.toContain('re-driven');
        expect((await t.store.read(t.slug))?.isDraft).toBe(true);
    });

    it('sends nothing once the customer has written since the card was raised, even after the desk answered them', async () => {
        const t = await refusedDelivery();
        t.wire.refusing = false;
        const declined = appendTurn(t.file, { at: '2026-09-14T12:05:00.000Z', channel: 'whatsapp', kind: 'text', body: "actually I have found someone else, don't bother", media: [], partyId: 'p1', direction: 'inbound', runId: null, approver: null });
        if (!declined.ok) throw new Error(declined.reason);
        const answered = appendTurn(t.file, { at: '2026-09-14T12:05:30.000Z', channel: 'whatsapp', kind: 'text', body: 'No problem at all Sam, thanks for letting us know.', media: [], partyId: 'p1', direction: 'outbound', runId: 'run-answer', approver: 'comms_v2' });
        if (!answered.ok) throw new Error(answered.reason);
        expect(t.file.hold?.notedOn).toBe(false);
        const result = await deskFor(t, t.wire, () => new Date(NOW.getTime() + 10 * 60_000), { client: silent }).clockPass(t.file);
        expect(t.wire.calls).toHaveLength(0);
        expect(t.file.facts.filter((f) => f.key === REDRIVE_FACT)).toHaveLength(0);
        expect(result.note).toContain(`quote ${t.slug} not re-driven: the customer has written since it was held`);
        expect((await t.store.read(t.slug))?.isDraft).toBe(true);
    });

    it('on a passed price lock tries nothing and rewrites the card to say it needs pricing again', async () => {
        const t = await refusedDelivery();
        t.wire.refusing = false;
        const lapsed = '2026-09-14T11:00:00.000Z';
        t.store.rows.get(t.slug)!.expiresAt = lapsed;
        await deskFor(t, t.wire, () => NOW, { client: silent }).clockPass(t.file);
        expect(t.wire.calls).toHaveLength(0);
        expect(t.file.hold?.reason).toBe(`${priceHold(t.slug)} the price lock passed at ${lapsed}, so the quote is not sent: re-price it from the price screen`);
        expect(t.file.hold?.notedOn).toBe(false);
        expect(t.file.facts.filter((f) => f.key === REDRIVE_FACT)).toHaveLength(0);
    });

    it('leaves a thread held because the customer asked us to stop alone', async () => {
        const t = await refusedDelivery();
        t.wire.refusing = false;
        const stop = appendTurn(t.file, { at: '2026-09-14T11:55:00.000Z', channel: 'email', kind: 'text', body: 'Subject: Unsubscribe\n\nPlease unsubscribe me', media: [], partyId: 'p1', direction: 'inbound', runId: null, approver: null });
        if (!stop.ok) throw new Error(stop.reason);
        noteOnHold(t.file, { reason: 'customer may have asked to stop by email; check and record the opt-out' });
        await deskFor(t, t.wire, () => NOW, { client: silent }).clockPass(t.file);
        expect(t.wire.calls).toHaveLength(0);
        expect(t.file.hold?.reason).toContain('customer may have asked to stop');
    });

    it('on a shut window with no approved template tries nothing and rewrites the card to name the window, not a refusal since fixed', async () => {
        const t = await thread(SHUT);
        setHold(t.file, { approver: BEN, reason: `${priceHold(t.slug)} the send was refused (${SWITCH_REFUSAL})` });
        const wire = { refusing: false, calls: [] as Array<{ approver: string; body: string }> };
        await deskFor(t, wire, () => NOW, { client: silent, templates: noTemplateApproved }).clockPass(t.file);
        expect(wire.calls).toHaveLength(0);
        expect(t.file.hold?.reason).toMatch(new RegExp(`^quote ${t.slug} priced; the WhatsApp window is shut \\(.*\\) and no approved template carries a quote link, so the quote is not sent and stays a draft$`));
        expect(t.file.hold?.reason).not.toContain('sandbox');
        expect(t.file.facts.filter((f) => f.key === REDRIVE_FACT)).toHaveLength(0);
    });

    it('on a shut window with quote_ready_link approved, sends the template', async () => {
        const t = await thread(SHUT);
        setHold(t.file, { approver: BEN, reason: `${priceHold(t.slug)} the send was refused (${SWITCH_REFUSAL})` });
        const wire = { refusing: false, calls: [] as Array<{ approver: string; body: string }> };
        const result = await deskFor(t, wire, () => NOW, { client: silent }).clockPass(t.file);
        expect(wire.calls).toHaveLength(1);
        expect(result.templateId).toBe('quote_ready_link');
        expect(t.file.hold).toBeNull();
    });
});

describe('a customer who has opted out never receives a re-driven quote', () => {
    afterEach(() => { vi.doUnmock('../../spine/config'); vi.doUnmock('../../outbound'); vi.doUnmock('../../opt-out'); vi.resetModules(); });

    it('through the real live deliverer, whose own opt-out gate refuses the re-drive exactly as it refuses a first send', async () => {
        const outbox: Array<{ approver: string; body: string }> = [];
        const asked: string[][] = [];
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: { comms_v2: { enabled: true } } }) }));
        vi.doMock('../../outbound', () => ({ sendCustomerMessage: async (i: { approver: string; body: string }) => { outbox.push(i); return { ok: true, sid: 'SM1', attempts: [], fellBack: false }; } }));
        // The ledger holds an opt-out the desk's own store cannot see (recorded against the email the
        // customer also wrote from), so only the sender's gate, the same one a first send meets, stops it.
        vi.doMock('../../opt-out', () => ({
            blockedByOptOut: async (who: { phones: string[]; emails: string[] }) => { asked.push([...who.phones, ...who.emails]); return { scope: 'all' }; },
            optOutRefusalMessage: () => 'the customer has opted out of all messages',
        }));
        const t = await refusedDelivery();
        const result = await deskFor(t, null, () => NOW).clockPass(t.file);

        expect(asked.length).toBeGreaterThan(0);
        expect(outbox).toEqual([]);
        expect(t.file.sends).toHaveLength(0);
        expect(t.file.turns.filter((x) => x.direction === 'outbound')).toHaveLength(0);
        expect((await t.store.read(t.slug))?.isDraft).toBe(true);
        expect(t.file.hold?.reason).toBe(`${priceHold(t.slug)} the send was refused (the customer has opted out of all messages)`);
        expect(result.delivered).toBe(false);
    });
});

describe('the re-drive leaves alone what is not its own', () => {
    it('a quote no person priced, even under a card that looks like the delivery\'s', async () => {
        const t = await thread(OPEN, { price: false });
        setHold(t.file, { approver: BEN, reason: `${priceHold(t.slug)} the send was refused (${SWITCH_REFUSAL})` });
        const wire = { refusing: false, calls: [] as Array<{ approver: string; body: string }> };
        const result = await deskFor(t, wire, () => NOW, { client: silent }).clockPass(t.file);
        expect(wire.calls).toHaveLength(0);
        expect(result.note).toContain(`quote ${t.slug} not re-driven: no person has confirmed its prices`);
        expect(t.file.hold?.reason).toBe(`${priceHold(t.slug)} the send was refused (${SWITCH_REFUSAL})`);
    });

    it('a card someone else has written on since', async () => {
        const t = await refusedDelivery();
        t.wire.refusing = false;
        noteOnHold(t.file, { reason: 'the customer asked: do you charge a call-out fee?' });
        await deskFor(t, t.wire, () => NOW, { client: silent }).clockPass(t.file);
        expect(t.wire.calls).toHaveLength(0);
        expect(t.file.hold?.notedOn).toBe(true);
    });

    it('a quote that is no longer a draft', async () => {
        const t = await refusedDelivery();
        t.wire.refusing = false;
        await t.store.markSent(t.slug);
        await deskFor(t, t.wire, () => NOW, { client: silent }).clockPass(t.file);
        expect(t.wire.calls).toHaveLength(0);
    });
});

describe('the attempts are spaced and capped', () => {
    it(`tries at most ${MAX_REDRIVES} times, ${REDRIVE_GAP_MS / 60_000} minutes apart, then the card says the desk will not try again`, async () => {
        const t = await refusedDelivery();
        let at = NOW.getTime();
        const pass = () => deskFor(t, t.wire, () => new Date(at)).clockPass(t.file);

        await pass();
        expect(t.wire.calls).toHaveLength(1);
        at += 60_000;
        await pass();
        expect(t.wire.calls).toHaveLength(1);
        for (let i = 1; i < MAX_REDRIVES + 2; i++) { at += REDRIVE_GAP_MS; await pass(); }
        expect(t.wire.calls).toHaveLength(MAX_REDRIVES);
        expect(t.file.facts.filter((f) => f.key === REDRIVE_FACT)).toHaveLength(MAX_REDRIVES);
        expect(t.file.hold?.reason).toMatch(/^quote \S+ priced; the send was refused \(.*\); tried again 3 times, the desk will not try again: price and send it from the price screen$/);
        expect(t.file.hold?.notedOn).toBe(false);
        expect((await t.store.read(t.slug))?.isDraft).toBe(true);
    });
});
