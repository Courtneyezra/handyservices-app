/**
 * B9: a figure Ben says on the Price and Send screen ("tap's one-sixty-one") goes through the ask
 * agent's existing proposal-and-confirm path as quote.set_line. It only proposes; the confirm writes
 * nothing anywhere and returns the line and the figure for the page to put in front of him; he sends.
 */
import { describe, expect, it } from 'vitest';
import { BEN } from '../desk/guards';
import { FakeModelClient } from '../desk/models';
import { MemoryAskActionStore, PREVIEW_CHANGED, confirmAction, proposeAction } from './actions';
import { ACTION_KINDS } from './action-kinds';
import { MONEY_REFUSAL, runAskTurn } from './agent';
import { MAX_LINE_PENCE, quoteSetLineKind, type PriceScreenLoad, type PriceScreenRead } from './kinds/quote-set-line';
import { BEN_PERSON, memorySource, now, scriptedLoop } from './ask-fixtures';

const SLUG = 'z4p6t9mw';
function screen(over: Partial<PriceScreenRead> = {}): PriceScreenRead {
    return {
        available: true, status: 'draft', customer: { firstName: 'Sam' },
        lines: [
            { lineId: 'card_1', title: 'Fit isolation valves', qty: 1, suggestedPence: 2800, materialsPence: 600 },
            { lineId: 'card_2', title: 'Replace kitchen mixer tap', qty: 1, suggestedPence: 15500, materialsPence: 0 },
        ],
        ...over,
    };
}

function setup(read: () => PriceScreenRead | { available: false; reason: string } = () => screen()) {
    const reads: string[] = [];
    const load: PriceScreenLoad = async (slug) => { reads.push(slug); return read(); };
    const kinds = { 'quote.set_line': quoteSetLineKind(load) };
    const store = new MemoryAskActionStore();
    const { source } = memorySource([]);
    const deps = { store, source, kinds, now: () => new Date() };
    const propose = (args: unknown) => proposeAction({ kind: 'quote.set_line', args, sessionId: 's1', askRunId: 'r1', person: BEN_PERSON, approver: BEN }, deps);
    const confirm = (id: string) => confirmAction({ id, person: BEN_PERSON, approver: BEN, ownsSession: async (s) => s === 's1' }, deps);
    return { load, kinds, store, deps, propose, confirm, reads };
}

describe('quote.set_line', () => {
    it('is registered, sends nothing and answers to no case file', () => {
        expect(ACTION_KINDS['quote.set_line']).toMatchObject({ kind: 'quote.set_line', sends: false, label: 'Change the line' });
        expect(ACTION_KINDS['quote.set_line']!.caseFileOf({ slug: SLUG, lineId: 'card_2', linePence: 16100 })).toBeNull();
    });

    it('proposes with a preview naming the line, the figure and who sends, and on confirm returns the line for the screen', async () => {
        const { propose, confirm } = setup();
        const p = await propose({ slug: SLUG, lineId: 'card_2', linePence: 16100 });
        if (!p.ok) throw new Error(p.reason);
        expect(p.action.previewText).toBe("On Sam's price screen: Replace kitchen mixer tap to £161, suggested £155. Labour takes the change. Nothing is saved or sent: you press Send.");
        expect(p.label).toBe('Change the line');
        expect(p.outgoing).toEqual([]);
        const c = await confirm(p.action.id);
        expect(c).toMatchObject({ ok: true, action: { status: 'executed', confirmedBy: `human:${BEN_PERSON}`, result: { slug: SLUG, lineId: 'card_2', linePence: 16100, title: 'Replace kitchen mixer tap' } } });
    });

    it('refuses a figure over the ceiling, below the line\'s materials, a line that has gone and a quote already sent', async () => {
        expect(await setup().propose({ slug: SLUG, lineId: 'card_2', linePence: MAX_LINE_PENCE + 1 })).toMatchObject({ ok: false, reason: expect.stringContaining('more than one line can be set to') });
        expect(await setup().propose({ slug: SLUG, lineId: 'card_1', linePence: 500 })).toMatchObject({ ok: false, reason: expect.stringContaining("below that line's materials (£6)") });
        expect(await setup().propose({ slug: SLUG, lineId: 'card_9', linePence: 1000 })).toMatchObject({ ok: false, reason: 'that line is not on the quote any more' });
        expect(await setup(() => screen({ status: 'sent' })).propose({ slug: SLUG, lineId: 'card_2', linePence: 16100 })).toMatchObject({ ok: false, reason: expect.stringContaining('is sent') });
        expect(await setup().propose({ slug: SLUG, lineId: 'card_2', linePence: 0 })).toMatchObject({ ok: false, reason: 'a line price must be more than £0' });
    });

    it('a new estimate before the confirm changes the preview, and the confirm is refused rather than landing on a line Ben has not seen', async () => {
        let current = screen();
        const { propose, confirm } = setup(() => current);
        const p = await propose({ slug: SLUG, lineId: 'card_2', linePence: 16100 });
        if (!p.ok) throw new Error(p.reason);
        current = screen({ lines: [{ lineId: 'card_2', title: 'Replace kitchen mixer tap', qty: 1, suggestedPence: 17000, materialsPence: 0 }] });
        expect(await confirm(p.action.id)).toMatchObject({ ok: false, code: 'refused', reason: PREVIEW_CHANGED });
    });
});

describe('the ask agent on the Price and Send screen', () => {
    const route = (over: Record<string, unknown> = {}) => ({ intents: ['note'], domains: ['quotes'], surface: 'quote', steps: ['Change the tap'], moneyAction: true, wantsDraft: false, ...over });

    it('offers the quote read and the line proposal, reads the screen first, and answers with a confirm that has run nothing', async () => {
        const { load, kinds, store, reads } = setup();
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const out = await runAskTurn(
            { sessionId: 's1', userMessage: "tap's one-sixty-one", via: 'voice', context: { priceSlug: SLUG }, history: [], person: BEN_PERSON, approver: BEN, askRunId: 'r1' },
            {
                source: memorySource([]).source, assignments: async () => ({ ben: ['u1'] }), client: new FakeModelClient({ router: () => route() }), now: now(),
                actions: store, kinds, loadPriceScreen: load,
                loop: scriptedLoop([
                    { tool: 'propose_set_quote_line', input: { lineId: 'card_2', pounds: 161 } },
                    { tool: 'give_answer', input: { finalText: 'Tap to £161. Confirm and it changes on your screen.', surface: 'words' } },
                ], seen),
            },
        );
        const names = seen.opts.tools.map((t: { name: string }) => t.name);
        expect(names).toEqual(expect.arrayContaining(['get_price_screen', 'propose_set_quote_line', 'give_answer']));
        expect(names).not.toContain('propose_send_held_draft');
        expect(seen.opts.goal).toContain("Ben said: tap's one-sixty-one");
        expect(seen.opts.goal).toContain(`Price and Send screen for quote ${SLUG}`);
        expect(seen.opts.goal).toContain('Fresh get_price_screen read');
        expect(out.answer.finalText).not.toBe(MONEY_REFUSAL);
        expect(out.answer.confirm).toMatchObject({ kind: 'quote.set_line', label: 'Change the line' });
        const [row] = Array.from(store.rows.values());
        expect(row).toMatchObject({ kind: 'quote.set_line', status: 'proposed', args: { slug: SLUG, lineId: 'card_2', linePence: 16100 } });
        expect(reads.every((s) => s === SLUG)).toBe(true);
    });

    it('without the price screen a money ask is still refused before any tool runs', async () => {
        const seen: { opts?: any; results: unknown[] } = { results: [] };
        const out = await runAskTurn(
            { sessionId: 's1', userMessage: "tap's one-sixty-one", via: 'voice', context: null, history: [], person: BEN_PERSON, approver: BEN },
            { source: memorySource([]).source, assignments: async () => ({ ben: ['u1'] }), client: new FakeModelClient({ router: () => route() }), now: now(), loop: scriptedLoop([], seen) },
        );
        expect(out.answer.finalText).toBe(MONEY_REFUSAL);
        expect(seen.opts).toBeUndefined();
    });
});
