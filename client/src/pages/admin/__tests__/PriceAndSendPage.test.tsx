/**
 * /admin/price/:slug — Ben's price-and-send screen v2 (P12, "Ben arrives cold"), built to Sarah's
 * nine-door case: doubt-first ordering, her words and photos under each line, the handles
 * contradiction resolved with a tap, materials swap / remove and assumptions drop reaching the
 * send body, the desk's message edited and sent, the four exits posting the right calls, the
 * confirm screen with the next quote waiting, and the phone (tabs) versus desktop (side by side)
 * layout. Plus the P8 behaviours that must survive: 409 reload, sent / superseded lock, 404.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import {
    PriceAndSend, gbp, poundsToPence, penceToPoundsText, bandText, totalsOf, orderByDoubt, doubtScore, visibleMessages, messageWarnings, materialsAtMargin,
    materialsCostOf, lineMaterialsAtMargin, refusalTitle, hasQuoteLink, insertAt,
    type PricePayload, type PriceLine, type Contradiction,
} from '@/pages/admin/PriceAndSendPage';

const T = (h: number, m = 0, d = 4) => `2026-09-0${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

const doors: PriceLine = {
    lineId: 'card_1', title: 'Oak panelled doors, hung and finished', category: 'joinery', qty: 8, minutes: { point: 880, low: 640, high: 1120 }, timeSource: 'history',
    materialsCount: 2, materialsPence: 137922, materialsCostPence: 108600, suggestedPence: 180000, bandLowPence: 160000, bandHighPence: 205000, confidence: 'medium', checkThis: false, checkReason: null, flags: [],
    assumptions: ['Existing handles reused on all doors', 'Frames are sound'],
    basis: { minutes: 910, ratePencePerHour: 3000, marginPct: 27, rules: ['batch discount 10% (engine)'] },
    materials: [
        { lineId: 'card_1', index: 0, name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' },
        { lineId: 'card_1', index: 1, name: 'Handle set, brushed', qty: 7, unitCostPence: 1800, source: 'screwfix' },
    ],
    evidence: { basedOnInboundId: 's1', quotes: [{ messageId: 's1', at: T(17, 40), text: 'Can you do all 9 doors now, oak to match the ones you did?' }], media: [{ messageId: 's2', url: '/api/media/p1', kind: 'image' }, { messageId: 's3', url: '/api/media/p2', kind: 'image' }] },
};
const cupboard: PriceLine = {
    lineId: 'card_2', title: 'Airing cupboard door', category: 'joinery', qty: 1, minutes: { point: 120, low: 90, high: 180 }, timeSource: 'model',
    materialsCount: 1, materialsPence: 19050, materialsCostPence: 15000, suggestedPence: 30000, bandLowPence: 27000, bandHighPence: 34000, confidence: 'low', checkThis: true, checkReason: 'low confidence: unusual size', flags: [],
    assumptions: [], basis: null,
    materials: [{ lineId: 'card_2', index: 0, name: 'Oak door, cut to size', qty: 1, unitCostPence: 15000, source: 'web' }],
    evidence: { basedOnInboundId: 's4', quotes: [{ messageId: 's4', at: T(17, 55), text: 'The airing cupboard door is a different size, photo attached' }], media: [{ messageId: 's4', url: '/api/media/p3', kind: 'image' }] },
};
const handles: Contradiction = {
    id: 'card_1:a0', lineId: 'card_1', kind: 'assumption_vs_materials', assumption: 'Existing handles reused on all doors', assumptionIndex: 0, materialIndexes: [1], materialNames: ['7× Handle set, brushed'],
    sentence: 'The estimate assumes "Existing handles reused on all doors" but lists 7× Handle set, brushed as materials.',
    options: [{ id: 'drop_materials', label: 'Drop it from the quote' }, { id: 'keep_materials', label: 'Keep it, drop the assumption' }],
};
// P16: the desk's draft now carries the link on its own last line, exactly as she receives it.
const QUOTE_URL = 'https://handyservices.app/quote/z4p6t9mw';
const DESK = `Hi Sarah, thanks for the photos and the details.\nYour quote for 8 oak panelled doors, hung and finished and airing cupboard door is ready, link below.\nAny questions, just reply here.\n\n${QUOTE_URL}`;

const payload = (over: Partial<PricePayload> = {}): PricePayload => ({
    available: true, slug: 'z4p6t9mw', quoteId: 'quote_s', conversationId: 'conv_s', version: 'est_s|2026-09-04T19:26:00Z|-|draft|card_1,card_2', status: 'draft',
    customer: { firstName: 'Sarah', name: 'Sarah Bell', postcode: 'NG2 7QP', customerType: 'homeowner', readiness: 'quote_ready', phone: '+447811346936' },
    lines: [doors, cupboard],
    job: { setupMinutes: 15, cleanupMinutes: 15, accessNotes: null },
    settings: { materialsMarginPercent: 27, depositPercent: 30 },
    materials: [...doors.materials!, ...cupboard.materials!],
    photos: ['/api/media/p1', '/api/media/p2', '/api/media/p3'], videos: [],
    builderUrl: '/admin/quotes/z4p6t9mw/edit',
    estimate: { id: 'est_s', status: 'complete', confidence: 'medium', at: T(19, 26) },
    quoteUrl: 'https://handyservices.app/quote/z4p6t9mw',
    thread: {
        messages: [
            { id: 'r1', at: '2026-05-12T09:00:00.000Z', direction: 'out', channel: 'whatsapp', body: 'Reminder: invoice INV-0142 is due.', media: null, by: 'system' },
            { id: 's1', at: T(17, 40), direction: 'in', channel: 'whatsapp', body: 'Can you do all 9 doors now, oak to match the ones you did?', media: null, by: null },
            { id: 's2', at: T(17, 53), direction: 'in', channel: 'whatsapp', body: '', media: { url: '/api/media/p1', kind: 'image' }, by: null },
            { id: 's4', at: T(17, 55), direction: 'in', channel: 'whatsapp', body: 'The airing cupboard door is a different size, photo attached', media: { url: '/api/media/p3', kind: 'image' }, by: null },
            { id: 'o1', at: T(18, 19), direction: 'out', channel: 'whatsapp', body: 'Got it, back to you shortly.', media: null, by: 'rules' },
        ],
        recentSince: T(17, 54), firstInboundAt: T(17, 40), latestInboundId: 's4', count: 5,
    },
    contradictions: [handles],
    message: { body: DESK, source: 'desk' },
    hold: null,
    nextWaiting: { slug: 'c1u0wkt8', firstName: 'Gemma' },
    call: { customerPhone: '+447811346936', businessNumber: '+441150000000' },
    followUpDays: 2,
    ...over,
});

function screenFetch(json: PricePayload, replies: Partial<Record<'send' | 'ask' | 'call' | 'visit', (call: { body: any }) => { status?: number; json?: unknown }>> = {}) {
    const ok = (extra: Record<string, unknown>) => ({ json: { ok: true, ...extra } });
    return mockFetch([
        { url: '/api/spine/price/z4p6t9mw/send', method: 'POST', reply: (c) => replies.send ? replies.send(c) : ok({ sent: true, mode: 'freeform', priced: true, verdicts: 2, quoteUrl: json.quoteUrl, totals: { labourPence: 81000, materialsPence: 129000, totalPence: 210000, depositPence: 63000 }, nextSteps: 'Sent to Sarah. Deposit £630. Follow-up in 2 days if unviewed.', nextWaiting: json.nextWaiting }) },
        { url: '/api/spine/price/z4p6t9mw/ask', method: 'POST', reply: (c) => replies.ask ? replies.ask(c) : ok({ hold: { reason: 'ask_first', at: T(20), by: 'human:ben', question: c.body.question }, draftId: 'd1' }) },
        { url: '/api/spine/price/z4p6t9mw/call', method: 'POST', reply: (c) => replies.call ? replies.call(c) : ok({ hold: { reason: 'call', at: T(20), by: 'human:ben' }, tel: '+447811346936' }) },
        { url: '/api/spine/price/z4p6t9mw/visit', method: 'POST', reply: (c) => replies.visit ? replies.visit(c) : ok({ hold: { reason: 'visit', at: T(20), by: 'human:ben' }, draftId: 'd2' }) },
        { url: '/api/spine/price/z4p6t9mw', reply: () => ({ json }) },
    ]);
}

function stubViewport(desktop: boolean) {
    const mq = (query: string) => ({ matches: desktop && query.includes('min-width'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false });
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn(mq) });
}

afterEach(() => {
    // jsdom has no matchMedia; tests that stub it put it back.
    delete (window as any).matchMedia;
});

describe('helpers', () => {
    it('gbp / poundsToPence / penceToPoundsText / bandText', () => {
        expect(gbp(24900)).toBe('£249');
        expect(gbp(24950)).toBe('£249.50');
        expect(gbp(null)).toBe('—');
        expect(poundsToPence('£1,249.5')).toBe(124950);
        expect(poundsToPence('0')).toBeNull();
        expect(penceToPoundsText(24950)).toBe('249.50');
        expect(bandText(21000, 27000)).toBe('£210–£270');
        expect(bandText(15900, 15900)).toBe('£159');
    });
    it('totalsOf mirrors the server rule and takes edited materials', () => {
        const p = payload();
        // P16 item 2: deposit = materials in full plus 30 % of labour, to the pound — the rule the card already charges.
        expect(totalsOf(p.lines, { card_1: 180000, card_2: 30000 }, 30)).toEqual({ totalPence: 210000, materialsPence: 137922 + 19050, labourPence: 210000 - 137922 - 19050, depositPence: 172900, missing: 0 });
        expect(totalsOf(p.lines, { card_1: 180000, card_2: null }, 30).missing).toBe(1);
        expect(totalsOf(p.lines, { card_1: 180000, card_2: 30000 }, 30, { card_1: 121920, card_2: 19050 }).materialsPence).toBe(121920 + 19050);
        expect(materialsAtMargin([{ qty: 8, unitCostPence: 12000 }], 27)).toBe(121920);
    });
    // P16b (Gemma c1u0wkt8, 3 Sep 2026): the owner's complaint was that the summary did not add up
    // from the line items. It did not: the page recomputed every line's materials from the item list
    // instead of using the figure the engine priced with, so labour and materials each drifted by
    // 60p against the six lines they are supposed to total. This is that invariant, permanently.
    it('the summary equals the sum of the lines: labour and materials both add up', () => {
        const p = payload();
        const finals = Object.fromEntries(p.lines.map((l) => [l.lineId, l.suggestedPence])) as Record<string, number>;
        const perLine = Object.fromEntries(p.lines.map((l) => [l.lineId, lineMaterialsAtMargin(l, undefined, 27)]));
        const t = totalsOf(p.lines, finals, 30, perLine);

        const sumTotals = p.lines.reduce((s, l) => s + (l.suggestedPence ?? 0), 0);
        const sumMaterials = p.lines.reduce((s, l) => s + lineMaterialsAtMargin(l, undefined, 27), 0);
        const sumLabour = p.lines.reduce((s, l) => s + ((l.suggestedPence ?? 0) - lineMaterialsAtMargin(l, undefined, 27)), 0);

        expect(t.totalPence).toBe(sumTotals);
        expect(t.materialsPence).toBe(sumMaterials);
        expect(t.labourPence).toBe(sumLabour);
        expect(t.labourPence + t.materialsPence).toBe(t.totalPence);
    });

    // An untouched materials list must NOT be recomputed: the engine's figure is the one it priced with.
    it('lineMaterialsAtMargin keeps the engine figure until Ben actually changes the list', () => {
        const line = { ...doors, materialsPence: 35_200, materials: [{ index: 0, name: 'Board', qty: 2, unitCostPence: 1000, source: null }] } as PriceLine;
        expect(lineMaterialsAtMargin(line, undefined, 27)).toBe(35_200);
        expect(lineMaterialsAtMargin(line, [{ qty: 2, unitCostPence: 1000 }], 27)).toBe(35_200);   // same list, untouched
        expect(lineMaterialsAtMargin(line, [{ qty: 3, unitCostPence: 1000 }], 27)).toBe(3_810);    // quantity changed → recompute
        expect(lineMaterialsAtMargin(line, [{ qty: 2, unitCostPence: 1500 }], 27)).toBe(3_810);    // cost changed → recompute
        expect(lineMaterialsAtMargin(line, [], 27)).toBe(0);                                        // all removed
    });

    it('orderByDoubt: check_this and low confidence first, then a contradiction, stable otherwise', () => {
        const a = { ...doors, lineId: 'a', checkThis: false, confidence: 'high' as const };
        const b = { ...doors, lineId: 'b', checkThis: false, confidence: 'medium' as const };
        const c = { ...doors, lineId: 'c', checkThis: true, confidence: 'low' as const };
        const d = { ...doors, lineId: 'd', checkThis: false, confidence: 'high' as const, suggestedPence: null };
        expect(orderByDoubt([a, b, c, d], [{ ...handles, lineId: 'a' }]).map((l) => l.lineId)).toEqual(['c', 'd', 'a', 'b']);
        expect(doubtScore(c, [])).toBe(6);
        expect(doubtScore(a, [])).toBe(0);
    });
    it('visibleMessages windows to the last 24 h and expands to all; never empty', () => {
        const t = payload().thread!;
        expect(visibleMessages(t, false).map((m) => m.id)).toEqual(['s4', 'o1']);
        expect(visibleMessages(t, true)).toHaveLength(5);
        expect(visibleMessages({ ...t, recentSince: '2026-12-01T00:00:00.000Z' }, false)).toHaveLength(5);
    });
    it('messageWarnings warns on money, dates, dashes; never on the desk draft', () => {
        expect(messageWarnings(DESK)).toEqual([]);
        expect(messageWarnings('£100 on Monday — ok?')).toHaveLength(3);
    });
});

describe('PriceAndSend (phone)', () => {
    it('renders her words and photos under each line, doubt first, with the contradiction chip and the desk message', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const root = await screen.findByTestId('price-and-send');
        expect(root).toHaveAttribute('data-layout', 'phone');
        expect(screen.getByTestId('customer-first-name')).toHaveTextContent('Sarah');
        expect(screen.getByTestId('contradiction-count')).toHaveTextContent('1 to check');

        // doubt first: the cupboard (check_this, low) above the doors
        const cards = screen.getAllByTestId(/^price-line-/);
        expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['price-line-card_2', 'price-line-card_1']);

        const l1 = screen.getByTestId('price-line-card_1');
        expect(within(l1).getByTestId('evidence-card_1')).toHaveTextContent('Can you do all 9 doors now, oak to match the ones you did?');
        expect(within(l1).getByTestId('evidence-card_1').querySelectorAll('img')).toHaveLength(2);
        expect(within(l1).getByTestId('contradiction-card_1:a0')).toHaveTextContent('assumes "Existing handles reused on all doors" but lists 7× Handle set, brushed');
        expect(within(l1).getByTestId('price-input-card_1')).toHaveValue(1800);
        expect(within(l1).getByTestId('band')).toHaveTextContent('Band £1,600–£2,050');
        expect(within(l1).getByTestId('materials-pence-card_1')).toHaveTextContent('£1,379.22');
        // P16b: the line shows its own split so the parts can be checked against the price.
        expect(within(l1).getByTestId('split-card_1')).toHaveTextContent('labour £420.78 + materials £1,379.22');

        const l2 = screen.getByTestId('price-line-card_2');
        expect(within(l2).getByTestId('check-this')).toHaveTextContent('low confidence: unusual size');
        expect(within(l2).getByTestId('evidence-card_2')).toHaveTextContent('different size');

        expect(screen.getByTestId('message-body')).toHaveValue(DESK);
        expect(screen.getByTestId('send-quote')).toHaveTextContent('Send now · £2,100');
        expect(screen.getByTestId('total')).toHaveTextContent('£2,100');
        expect(screen.getByTestId('open-builder')).toHaveAttribute('href', '/admin/quotes/z4p6t9mw/edit');
        // the basis is a tap away
        await userEvent.click(within(l1).getByTestId('basis-toggle-card_1'));
        expect(within(l1).getByTestId('basis-card_1')).toHaveTextContent('Reference rate £30/hr');
        expect(within(l1).getByTestId('basis-card_1')).toHaveTextContent('batch discount 10%');
    });

    it('resolving the contradiction by dropping the handles removes them from the line, lowers the materials and reaches the send body', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const l1 = await screen.findByTestId('price-line-card_1');
        await userEvent.click(within(l1).getByTestId('resolve-card_1:a0-drop_materials'));
        expect(within(l1).getByTestId('contradiction-card_1:a0')).toHaveTextContent('Dropped 7× Handle set, brushed.');
        expect(within(l1).queryByTestId('resolve-card_1:a0-drop_materials')).toBeNull();
        expect(within(l1).getByTestId('materials-pence-card_1')).toHaveTextContent('£1,219.20');
        expect(within(l1).getByText('1 material')).toBeInTheDocument();
        // the assumption stays (it is now true)
        expect(within(l1).getByTestId('assumption-card_1-0')).toHaveValue('Existing handles reused on all doors');

        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        const body = f.of('POST', '/send')[0].body;
        expect(body.resolutions).toEqual([{ contradictionId: 'card_1:a0', choice: 'drop_materials' }]);
        expect(body.lines[0]).toEqual({ lineId: 'card_1', finalPence: 180000, materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' }] });
        expect(body.lines[1]).toEqual({ lineId: 'card_2', finalPence: 30000 });
        expect(body.messageEdited).toBe(false);
        expect(body.message).toBe(DESK);
    });

    it('keeping the handles drops the assumption instead', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const l1 = await screen.findByTestId('price-line-card_1');
        await userEvent.click(within(l1).getByTestId('resolve-card_1:a0-keep_materials'));
        expect(within(l1).getByTestId('contradiction-card_1:a0')).toHaveTextContent('Kept 7× Handle set, brushed, assumption dropped.');
        expect(within(l1).getByTestId('assumption-card_1-0')).toHaveValue('Frames are sound');
        expect(within(l1).getByText('2 materials')).toBeInTheDocument();
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        const body = f.of('POST', '/send')[0].body;
        expect(body.lines[0].assumptions).toEqual(['Frames are sound']);
        expect(body.lines[0].materials).toBeUndefined();
    });

    it('materials swap / remove per line and an assumption dropped by hand reach the send body; the message edit does too', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const l1 = await screen.findByTestId('price-line-card_1');
        await userEvent.click(within(l1).getByTestId('materials-toggle-card_1'));
        // swap the handle set for a cheaper one, remove nothing yet
        const name = within(l1).getByTestId('material-name-card_1-1');
        await userEvent.clear(name); await userEvent.type(name, 'Handle set, black');
        const cost = within(l1).getByTestId('material-cost-card_1-1');
        fireEvent.change(cost, { target: { value: '12' } });
        // remove the doors (she is supplying them)
        await userEvent.click(within(l1).getByTestId('material-remove-card_1-0'));
        expect(within(l1).getByTestId('materials-pence-card_1')).toHaveTextContent(gbp(Math.round(7 * 1200 * 1.27)));
        // drop the second assumption
        await userEvent.click(within(l1).getByTestId('assumption-drop-card_1-1'));
        expect(within(l1).queryByTestId('assumption-card_1-1')).toBeNull();
        // edit the message
        const msg = screen.getByTestId('message-body');
        await userEvent.clear(msg); await userEvent.type(msg, 'Hi Sarah, here is the quote for the doors.');
        expect(screen.getByTestId('message-reset')).toBeInTheDocument();

        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        const body = f.of('POST', '/send')[0].body;
        expect(body.lines[0].materials).toEqual([{ name: 'Handle set, black', qty: 7, unitCostPence: 1200, source: 'screwfix' }]);
        expect(body.lines[0].assumptions).toEqual(['Existing handles reused on all doors']);
        expect(body.message).toBe('Hi Sarah, here is the quote for the doors.');
        expect(body.messageEdited).toBe(true);
        expect(body.version).toBe('est_s|2026-09-04T19:26:00Z|-|draft|card_1,card_2');
    });

    it('Send shows the confirm screen with what happens next and the next quote waiting', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await userEvent.click(await screen.findByTestId('send-quote'));
        expect(await screen.findByTestId('confirm-screen')).toHaveTextContent('Sent on WhatsApp');
        expect(screen.getByTestId('next-steps')).toHaveTextContent('Sent to Sarah. Deposit £630. Follow-up in 2 days if unviewed.');
        expect(screen.getByTestId('next-waiting')).toHaveTextContent('Next quote waiting: Gemma');
        expect(screen.getByTestId('next-waiting')).toHaveAttribute('href', '/admin/price/c1u0wkt8');
    });

    it('Ask her first queues ONE question and holds the quote without leaving the screen', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await userEvent.click(await screen.findByTestId('ask-first'));
        expect(screen.getByTestId('ask-sheet')).toBeInTheDocument();
        expect(screen.getByTestId('ask-submit')).toBeDisabled();
        await userEvent.type(screen.getByTestId('ask-question'), 'Are the handles staying, or do you want new ones?');
        await userEvent.click(screen.getByTestId('ask-submit'));
        await waitFor(() => expect(f.of('POST', '/ask')).toHaveLength(1));
        expect(f.of('POST', '/ask')[0].body).toEqual({ question: 'Are the handles staying, or do you want new ones?' });
        expect(await screen.findByTestId('hold-banner')).toHaveTextContent('Held: you asked her first');
        expect(screen.getByTestId('hold-banner')).toHaveTextContent('Are the handles staying');
        expect(screen.queryByTestId('ask-sheet')).toBeNull();
        expect(screen.getByTestId('price-and-send')).toBeInTheDocument(); // still here
        expect(screen.getByTestId('send-quote')).toBeEnabled();           // Ben can still override
        expect(f.of('POST', '/send')).toHaveLength(0);
    });

    it('Call her records the call, holds the quote and dials the customer from the phone', async () => {
        const f = screenFetch(payload());
        const loc = { href: '' };
        const original = window.location;
        Object.defineProperty(window, 'location', { configurable: true, value: loc });
        try {
            renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
            await userEvent.click(await screen.findByTestId('call-her'));
            await waitFor(() => expect(f.of('POST', '/call')).toHaveLength(1));
            expect(await screen.findByTestId('hold-banner')).toHaveTextContent('Held: you are calling her');
            expect(loc.href).toBe('tel:+447811346936');
        } finally {
            Object.defineProperty(window, 'location', { configurable: true, value: original });
        }
    });

    it('Needs a visit drafts the survey offer and holds the quote', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await userEvent.click(await screen.findByTestId('needs-visit'));
        await userEvent.type(screen.getByTestId('visit-why'), 'the cupboard door size');
        await userEvent.click(screen.getByTestId('visit-submit'));
        await waitFor(() => expect(f.of('POST', '/visit')).toHaveLength(1));
        expect(f.of('POST', '/visit')[0].body).toEqual({ why: 'the cupboard door size' });
        expect(await screen.findByTestId('hold-banner')).toHaveTextContent('Held: visit first');
        expect(f.of('POST', '/send')).toHaveLength(0);
    });

    it('an exit that fails says so and keeps the screen', async () => {
        screenFetch(payload(), { visit: () => ({ status: 422, json: { ok: false, errors: ['No survey fee is set, so the offer cannot be drafted.'] } }) });
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await userEvent.click(await screen.findByTestId('needs-visit'));
        await userEvent.click(screen.getByTestId('visit-submit'));
        expect(await screen.findByTestId('action-error')).toHaveTextContent('No survey fee is set');
        expect(screen.queryByTestId('hold-banner')).toBeNull();
    });

    it('the thread tab shows the last 24 h with the photos inline and expands to the whole thread', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await userEvent.click(await screen.findByTestId('tab-thread'));
        const pane = screen.getByTestId('thread-pane');
        expect(within(pane).getByTestId('thread-message-s4')).toHaveTextContent('different size');
        expect(within(pane).getByTestId('thread-message-s4').querySelector('img')).toHaveAttribute('src', '/api/media/p3');
        expect(within(pane).queryByTestId('thread-message-r1')).toBeNull();
        expect(within(pane).getByTestId('thread-expand')).toHaveTextContent('3 earlier messages');
        await userEvent.click(within(pane).getByTestId('thread-expand'));
        expect(within(pane).getByTestId('thread-message-r1')).toHaveTextContent('invoice INV-0142');
        expect(within(pane).queryByTestId('thread-expand')).toBeNull();
        expect(screen.queryByTestId('price-pane')).toBeNull();
        await userEvent.click(screen.getByTestId('tab-price'));
        expect(screen.getByTestId('price-pane')).toBeInTheDocument();
    });

    it('accept is one tap and folds the line; editing the price reopens it; empty price blocks the send', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const l1 = await screen.findByTestId('price-line-card_1');
        await userEvent.click(within(l1).getByTestId('accept-card_1'));
        expect(within(l1).getByTestId('accepted-card_1')).toHaveTextContent('£1,800');
        expect(within(l1).queryByTestId('price-input-card_1')).toBeNull();
        await userEvent.click(within(l1).getByTestId('accepted-card_1'));
        const input = within(l1).getByTestId('price-input-card_1');
        await userEvent.clear(input); await userEvent.type(input, '2500');
        expect(within(l1).getByTestId('out-of-band')).toBeInTheDocument();
        await userEvent.click(within(l1).getByTestId('reset-card_1'));
        expect(input).toHaveValue(1800);
        await userEvent.clear(input);
        expect(screen.getByTestId('missing-prices')).toHaveTextContent('1 line still needs a price');
        expect(screen.getByTestId('send-quote')).toBeDisabled();
    });

    it('409 (a new scope arrived) shows the supersede banner and reload refetches the draft', async () => {
        let calls = 0;
        const fresh = payload({ version: 'est_2|x|-|draft|card_1,card_2,card_3', lines: [doors, cupboard, { ...cupboard, lineId: 'card_3', title: 'Paint the doors', suggestedPence: 9900, checkThis: false, confidence: 'high', materials: [], evidence: undefined }], contradictions: [] });
        const f = mockFetch([
            { url: '/api/spine/price/z4p6t9mw/send', method: 'POST', reply: () => ({ status: 409, json: { ok: false, errors: ['The draft changed since this screen loaded (a new scope or estimate arrived). Reload and check the prices again.'] } }) },
            { url: '/api/spine/price/z4p6t9mw', reply: () => ({ json: calls++ === 0 ? payload() : fresh }) },
        ]);
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await userEvent.click(await screen.findByTestId('send-quote'));
        expect(await screen.findByTestId('superseded-banner')).toHaveTextContent('A new scope arrived');
        expect(screen.getByTestId('send-quote')).toBeDisabled();
        await userEvent.click(screen.getByTestId('reload'));
        await waitFor(() => expect(f.of('GET', '/api/spine/price/z4p6t9mw')).toHaveLength(2));
        expect(await screen.findByTestId('price-line-card_3')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByTestId('superseded-banner')).toBeNull());
        expect(screen.getByTestId('send-quote')).toBeEnabled();
    });

    it('a send that saved prices but failed to deliver says so', async () => {
        screenFetch(payload(), { send: () => ({ status: 502, json: { ok: false, priced: true, errors: ['WhatsApp send failed before the quote link went out'] } }) });
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await userEvent.click(await screen.findByTestId('send-quote'));
        expect(await screen.findByTestId('send-error')).toHaveTextContent('Prices saved, but the send did not go through');
    });

    it('an already-sent draft is locked: no send, no exits, no edits', async () => {
        screenFetch(payload({ status: 'sent' }));
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        expect(await screen.findByTestId('status-banner')).toHaveTextContent('already been sent');
        expect(screen.getByTestId('send-quote')).toBeDisabled();
        expect(screen.getByTestId('ask-first')).toBeDisabled();
        expect(screen.getByTestId('call-her')).toBeDisabled();
        expect(screen.getByTestId('needs-visit')).toBeDisabled();
        expect(screen.getByTestId('price-input-card_1')).toBeDisabled();
        expect(screen.getByTestId('message-body')).toBeDisabled();
    });

    it('a held quote shows the hold on load', async () => {
        screenFetch(payload({ hold: { reason: 'visit', at: T(20), by: 'human:ben' } }));
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        expect(await screen.findByTestId('hold-banner')).toHaveTextContent('Held: visit first');
    });

    it('404 says there is no such quote', async () => {
        mockFetch([{ url: '/api/spine/price/nope', reply: () => ({ status: 404, json: { available: false } }) }]);
        renderWithQuery(<PriceAndSend slug="nope" />);
        expect(await screen.findByTestId('not-found')).toHaveTextContent('No quote with the slug');
    });

    it('an older payload without the briefing fields still renders and sends', async () => {
        const old = payload({ thread: undefined, contradictions: undefined, message: undefined, hold: undefined, nextWaiting: undefined, call: undefined, lines: [{ ...doors, materials: undefined, evidence: undefined, basis: undefined }] });
        const f = screenFetch(old);
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        expect(await screen.findByTestId('price-line-card_1')).toBeInTheDocument();
        expect(screen.getByTestId('call-her')).toBeDisabled();
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        expect(f.of('POST', '/send')[0].body.lines).toEqual([{ lineId: 'card_1', finalPence: 180000 }]);
    });
});

describe('PriceAndSend (desktop)', () => {
    it('side by side: the thread beside the price pane, no tabs', async () => {
        stubViewport(true);
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const root = await screen.findByTestId('price-and-send');
        expect(root).toHaveAttribute('data-layout', 'desktop');
        expect(screen.getByTestId('side-by-side')).toBeInTheDocument();
        expect(screen.queryByTestId('tabs')).toBeNull();
        expect(screen.getByTestId('thread-pane')).toBeInTheDocument();
        expect(screen.getByTestId('price-pane')).toBeInTheDocument();
    });
    it('a narrow viewport with matchMedia present is the phone layout', async () => {
        stubViewport(false);
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        expect(await screen.findByTestId('price-and-send')).toHaveAttribute('data-layout', 'phone');
        expect(screen.getByTestId('tabs')).toBeInTheDocument();
    });
});

describe('P15 part 1: "Not included" on the price screen', () => {
    it('shows the list per line, lets Ben edit, add and drop, and only a changed list reaches the send body', async () => {
        const f = screenFetch(payload({ lines: [{ ...doors, notIncluded: ['frames reused'] }, cupboard] }));
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const l1 = await screen.findByTestId('price-line-card_1');
        expect(within(l1).getByTestId('not-included-card_1-0')).toHaveValue('frames reused');
        await userEvent.click(within(l1).getByTestId('not-included-add-card_1'));
        await userEvent.type(within(l1).getByTestId('not-included-card_1-1'), '  decorating the frames not included ');
        const l2 = screen.getByTestId('price-line-card_2');
        expect(within(l2).queryByTestId('not-included-card_2-0')).toBeNull();
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        const body = f.of('POST', '/send')[0].body;
        expect(body.lines[0].notIncluded).toEqual(['frames reused', 'decorating the frames not included']);
        expect(body.lines[1].notIncluded).toBeUndefined();
    });
    it('dropping the only item sends an empty list (Ben cleared it on purpose)', async () => {
        const f = screenFetch(payload({ lines: [{ ...doors, notIncluded: ['frames reused'] }, cupboard] }));
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const l1 = await screen.findByTestId('price-line-card_1');
        await userEvent.click(within(l1).getByTestId('not-included-drop-card_1-0'));
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        expect(f.of('POST', '/send')[0].body.lines[0].notIncluded).toEqual([]);
    });
});

describe('P16 items 1 + 2: the money on the screen', () => {
    it('a line with no itemised list still shows the materials it was priced with', () => {
        const bare: PriceLine = { ...cupboard, materials: [], materialsCount: 0, materialsPence: 19050, materialsCostPence: 15000 };
        expect(lineMaterialsAtMargin(bare, [], 27)).toBe(19050);
        expect(lineMaterialsAtMargin(bare, undefined, 27)).toBe(19050);
    });
    it('an edited list is costed at the live margin, and clearing a list that had items means zero', () => {
        expect(lineMaterialsAtMargin(doors, [{ qty: 8, unitCostPence: 12000 }], 27)).toBe(121920);
        expect(lineMaterialsAtMargin(doors, [], 27)).toBe(0);
        expect(materialsCostOf([{ qty: 8, unitCostPence: 12000 }])).toBe(96000);
    });
    it('the summary reads labour and materials at margin, and the deposit the card charges', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await screen.findByTestId('price-line-card_1');
        const summary = screen.getByTestId('totals');
        expect(summary).toHaveTextContent(gbp(210000));
        expect(summary).toHaveTextContent(gbp(172900));   // materials £1,569.72 in full + 30 % of £530.28 labour
        expect(summary).not.toHaveTextContent(gbp(63000)); // never a flat 30 % of the total: the card does not charge that
    });
    it('the materials editor shows the cost beside what she pays', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const l1 = await screen.findByTestId('price-line-card_1');
        await userEvent.click(within(l1).getByTestId('materials-toggle-card_1'));
        const cost = within(l1).getByTestId('materials-cost-card_1');
        expect(cost).toHaveTextContent(`Cost ${gbp(108600)}`);
        expect(cost).toHaveTextContent(`she pays ${gbp(137922)} at 27%`);
    });
});

describe('P16 item 3: add and delete a line on the screen', () => {
    it('delete strikes the line out, takes it out of the totals, and Undo puts it back', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await screen.findByTestId('price-line-card_1');
        expect(screen.getByTestId('total')).toHaveTextContent(gbp(210000));

        await userEvent.click(screen.getByTestId('line-delete-card_1'));
        expect(screen.getByTestId('line-deleted-card_1')).toHaveTextContent('Oak panelled doors, hung and finished');
        expect(screen.getByTestId('total')).toHaveTextContent(gbp(30000));
        expect(screen.getByTestId('deposit')).toHaveTextContent(gbp(22300));

        await userEvent.click(screen.getByTestId('line-undo-card_1'));
        expect(screen.queryByTestId('line-deleted-card_1')).toBeNull();
        expect(screen.getByTestId('total')).toHaveTextContent(gbp(210000));
    });

    it('a deleted line is sent as deleted and carries nothing else', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await screen.findByTestId('price-line-card_1');
        await userEvent.click(screen.getByTestId('line-delete-card_1'));
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        const body = f.of('POST', '/send')[0].body;
        expect(body.lines[0]).toEqual({ lineId: 'card_1', deleted: true });
        expect(body.lines[1].lineId).toBe('card_2');
    });

    it('Add a line opens an empty card that blocks Send until it has a title and a price, then reaches the send body', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await screen.findByTestId('price-line-card_1');
        await userEvent.click(screen.getByTestId('add-line'));

        const card = screen.getByTestId('missing-title').closest('[data-testid="totals"]');
        expect(card).toBeInTheDocument();
        expect(screen.getByTestId('send-quote')).toBeDisabled();

        const added = screen.getAllByTestId(/^price-line-ben_/)[0];
        const id = added.getAttribute('data-testid')!.replace('price-line-', '');
        await userEvent.type(within(added).getByTestId(`added-title-${id}`), 'Refit the loft hatch');
        await userEvent.selectOptions(within(added).getByTestId(`added-category-${id}`), 'carpentry');
        fireEvent.change(within(added).getByTestId(`added-minutes-${id}`), { target: { value: '90' } });
        fireEvent.change(within(added).getByTestId(`price-input-${id}`), { target: { value: '80' } });

        expect(screen.queryByTestId('missing-title')).toBeNull();
        expect(screen.getByTestId('total')).toHaveTextContent(gbp(218000));
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        const sent = f.of('POST', '/send')[0].body.lines.find((l: any) => l.lineId === id);
        expect(sent).toMatchObject({ finalPence: 8000, added: { title: 'Refit the loft hatch', category: 'carpentry', minutesPoint: 90 } });
    });

    it('an added card wears check_this with the reason and offers no band', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await screen.findByTestId('price-line-card_1');
        await userEvent.click(screen.getByTestId('add-line'));
        const added = screen.getAllByTestId(/^price-line-ben_/)[0];
        expect(within(added).getByTestId('check-this')).toHaveTextContent('added by Ben, not estimated');
        expect(within(added).getByTestId('band')).toHaveTextContent('No band');
    });

    it('the send refusal from a locked pack is shown to Ben', async () => {
        const f = screenFetch(payload(), { send: () => ({ status: 409, json: { ok: false, errors: ['That job is already dispatched, so its lines are locked (Oak panelled doors, hung and finished). Raise a variation instead of changing the quote.'] } }) });
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await screen.findByTestId('price-line-card_1');
        await userEvent.click(screen.getByTestId('line-delete-card_1'));
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        const banner = await screen.findByTestId('superseded-banner');
        expect(banner).toHaveTextContent('That job is already dispatched');
        expect(banner).toHaveTextContent('Raise a variation');
        expect(refusalTitle('A new scope arrived and this draft was superseded.')).toBe('A new scope arrived');
    });
});

describe('P16 item 4: the quote link is in the message Ben reads', () => {
    it('the editor shows the link the desk put there, and says nothing about it going on later', async () => {
        screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const box = await screen.findByTestId('message-body');
        expect((box as HTMLTextAreaElement).value).toContain(QUOTE_URL);
        expect(screen.queryByTestId('no-link-warning')).toBeNull();
        expect(screen.queryByTestId('insert-link')).toBeNull();
    });

    it('an edited body keeps exactly one link, and it reaches the send body unchanged', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const box = await screen.findByTestId('message-body');
        fireEvent.change(box, { target: { value: `Hi Sarah, all priced up.\n\n${QUOTE_URL}` } });
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        const sent = f.of('POST', '/send')[0].body.message as string;
        expect(sent.match(new RegExp(QUOTE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
        expect(sent).toBe(`Hi Sarah, all priced up.\n\n${QUOTE_URL}`);
    });

    it('a link mid-text is left where he put it', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const mid = `Hi Sarah, here it is ${QUOTE_URL} and any questions just reply.`;
        fireEvent.change(await screen.findByTestId('message-body'), { target: { value: mid } });
        expect(screen.queryByTestId('no-link-warning')).toBeNull();
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        expect(f.of('POST', '/send')[0].body.message).toBe(mid);
    });

    it('deleting the link warns without blocking, and the chip puts it back', async () => {
        const f = screenFetch(payload());
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const box = await screen.findByTestId('message-body');
        fireEvent.change(box, { target: { value: 'Hi Sarah, all priced up.' } });
        expect(screen.getByTestId('no-link-warning')).toHaveTextContent('no way to open the quote');
        expect(screen.getByTestId('send-quote')).toBeEnabled();

        await userEvent.click(screen.getByTestId('insert-link'));
        await waitFor(() => expect(screen.queryByTestId('no-link-warning')).toBeNull());
        expect((box as HTMLTextAreaElement).value).toContain(QUOTE_URL);
        await userEvent.click(screen.getByTestId('send-quote'));
        await waitFor(() => expect(f.of('POST', '/send')).toHaveLength(1));
        expect(f.of('POST', '/send')[0].body.message).toContain(QUOTE_URL);
    });
});

describe('P16 item 4: the link helpers', () => {
    it('hasQuoteLink finds it anywhere, and nowhere when it is gone', () => {
        expect(hasQuoteLink(`a ${QUOTE_URL} b`, QUOTE_URL)).toBe(true);
        expect(hasQuoteLink('no link here', QUOTE_URL)).toBe(false);
        expect(hasQuoteLink('anything', '')).toBe(false);
    });
    it('insertAt puts the link on its own line and never glues it to a word', () => {
        expect(insertAt('Hello', 'L', 5)).toBe('Hello\nL');
        expect(insertAt('Hello\n', 'L', 6)).toBe('Hello\nL');
        expect(insertAt('a\nb', 'L', 2)).toBe('a\nL\nb');
        expect(insertAt('', 'L', 0)).toBe('L');
        expect(insertAt('abc', 'L', 99)).toBe('abc\nL');
    });
});

describe('P16 item 5: the line cards read as cards', () => {
    it('the page has a ground and the cards sit on it in white, with the status borders kept', async () => {
        // No contradictions, so card_1 is an ordinary line and card_2 is the check_this one.
        screenFetch(payload({ contradictions: [] }));
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await screen.findByTestId('price-line-card_1');
        expect(screen.getByTestId('price-and-send').className).toContain('bg-slate-100');

        // card_2 is check_this: amber. card_1 is ordinary: white on a slate border, with a shadow.
        const plain = screen.getByTestId('price-line-card_1').className;
        expect(plain).toContain('bg-white');
        expect(plain).toContain('border-slate-300');
        expect(plain).toContain('shadow-md');
        expect(screen.getByTestId('price-line-card_2').className).toContain('border-amber-300');
    });

    it('an accepted line keeps its green edge', async () => {
        screenFetch(payload({ contradictions: [] }));
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        const l1 = await screen.findByTestId('price-line-card_1');
        await userEvent.click(within(l1).getByTestId('accept-card_1'));
        expect(screen.getByTestId('price-line-card_1').className).toContain('border-emerald-300');
    });

    it('the layout still switches between phone and desktop', async () => {
        stubViewport(true);
        screenFetch(payload({ contradictions: [] }));
        renderWithQuery(<PriceAndSend slug="z4p6t9mw" />);
        await screen.findByTestId('price-line-card_1');
        expect(screen.getByTestId('price-and-send')).toHaveAttribute('data-layout', 'desktop');
        expect(screen.getByTestId('price-and-send').className).toContain('bg-slate-100');
    });
});
