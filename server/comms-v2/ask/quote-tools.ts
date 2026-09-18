/**
 * Handy Desk - the ask agent's `quotes` group, offered only when the ask comes from the Price and
 * Send screen (`context.priceSlug`, B9). One read, the quote's lines as that screen loads them, and
 * one proposal, `quote.set_line` (kinds/quote-set-line.ts): a new figure for one line, which on
 * Ben's confirm changes that line on his screen and nothing else. The quote goes out only when he
 * presses Send.
 */
import type { AgentTool } from '../../agents/runner';
import { proposeInRun, type AskRunState, type AskToolDeps } from './tools';
import type { PriceScreenLoad, PriceScreenRead } from './kinds/quote-set-line';

export const QUOTE_TOOL_NAMES = ['get_price_screen', 'propose_set_quote_line'] as const;

const defaultLoad: PriceScreenLoad = async (slug) => {
    const { loadPriceScreen } = await import('../../spine/price-screen');
    return loadPriceScreen(slug) as Promise<PriceScreenRead | { available: false; reason: string }>;
};

const pounds = (p: number | null) => (p == null ? null : Math.round(p) / 100);

export function quoteTools(deps: AskToolDeps, state: AskRunState): AgentTool[] {
    const slug = deps.priceSlug?.trim();
    if (!slug) return [];
    const load = deps.loadPriceScreen ?? defaultLoad;
    return [
        {
            name: 'get_price_screen',
            description: 'The quote on Ben\'s Price and Send screen: the customer\'s first name, whether it is still a draft, and every line with its id, title, quantity, suggested price and materials, in pounds. Read it to find the line Ben means ("the tap", "the valves").',
            input_schema: { type: 'object', properties: {} },
            run: async () => {
                const screen = await load(slug);
                if (!screen.available) return { error: screen.reason };
                return {
                    slug,
                    customer: screen.customer.firstName,
                    status: screen.status,
                    lines: screen.lines.map((l) => ({ lineId: l.lineId, title: l.title, qty: l.qty, suggestedPounds: pounds(l.suggestedPence), materialsPounds: pounds(l.materialsPence) })),
                };
            },
        },
        {
            name: 'propose_set_quote_line',
            description: 'Propose a new price for ONE line of the quote on Ben\'s screen, in pounds: what the customer pays for that line. Labour takes the change; materials stand. It does not save or send anything: on Ben\'s confirm the line changes on his screen and he presses Send himself. Use it when Ben names a line and a figure ("tap\'s one-sixty-one" is the tap line at 161). One line per turn.',
            input_schema: {
                type: 'object',
                properties: {
                    lineId: { type: 'string', description: 'The line\'s id from get_price_screen.' },
                    pounds: { type: 'number', description: 'The line\'s new price in pounds, e.g. 161 or 161.50.' },
                },
                required: ['lineId', 'pounds'],
            },
            run: async (input: { lineId?: string; pounds?: number }) => {
                const lineId = typeof input?.lineId === 'string' ? input.lineId.trim() : '';
                const p = typeof input?.pounds === 'number' && Number.isFinite(input.pounds) ? Math.round(input.pounds * 100) : NaN;
                if (!lineId || !Number.isFinite(p)) return { status: 'refused', reason: 'name the line id and the figure in pounds' };
                return proposeInRun(deps, state, 'quote.set_line', { slug, lineId, linePence: p });
            },
        },
    ];
}
