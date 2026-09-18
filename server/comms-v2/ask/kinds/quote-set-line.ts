/**
 * quote.set_line: Ben, on the Price and Send screen, says or types a new figure for one line ("tap's
 * one-sixty-one"). The ask agent proposes it here; on his confirm the line changes ON HIS SCREEN and
 * nowhere else. The executor writes nothing: no price onto the draft, no verdict, no message. It
 * returns the line and the figure, the page puts them in the line's boxes, and the quote only goes
 * out when Ben presses Send, through the price screen's own send (server/spine/routes.ts), exactly as
 * if he had typed the figure himself.
 *
 * The figure is the line's price, what the customer pays for it: labour takes the change and the
 * materials stand, so a figure below the line's materials is refused. The preview names the line and
 * the draft's own suggestion, so a new estimate arriving before the confirm changes the preview and
 * the confirm is refused (`PREVIEW_CHANGED`) rather than landing on a line Ben has not seen.
 */
import type { ActionKindDef } from '../action-kinds';

/** The most a spoken figure may set one line to: £20,000. A slip of the tongue, not a quote. */
export const MAX_LINE_PENCE = 2_000_000;

export interface QuoteSetLineArgs { slug: string; lineId: string; linePence: number }

/** The slice of the price screen this kind reads. */
export interface PriceScreenRead {
    available: true;
    status: string;
    customer: { firstName: string };
    lines: Array<{ lineId: string; title: string; qty: number; suggestedPence: number | null; materialsPence: number }>;
}
export type PriceScreenLoad = (slug: string) => Promise<PriceScreenRead | { available: false; reason: string }>;

const defaultLoad: PriceScreenLoad = async (slug) => {
    const { loadPriceScreen } = await import('../../../spine/price-screen');
    return loadPriceScreen(slug) as Promise<PriceScreenRead | { available: false; reason: string }>;
};

const pounds = (p: number) => `£${Number.isInteger(p / 100) ? (p / 100).toLocaleString('en-GB') : (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function lineOf(load: PriceScreenLoad, args: QuoteSetLineArgs) {
    const screen = await load(args.slug);
    if (!screen.available) return { error: `that quote cannot be read (${screen.reason})` } as const;
    if (screen.status !== 'draft') return { error: `that quote is ${screen.status}, so its lines can no longer be changed here` } as const;
    const line = screen.lines.find((l) => l.lineId === args.lineId);
    if (!line) return { error: 'that line is not on the quote any more' } as const;
    return { screen, line } as const;
}

export function quoteSetLineKind(load: PriceScreenLoad = defaultLoad): ActionKindDef<QuoteSetLineArgs> {
    return {
        kind: 'quote.set_line',
        label: 'Change the line',
        sends: false,
        parseArgs(raw) {
            const r = raw as { slug?: unknown; lineId?: unknown; linePence?: unknown } | null;
            const slug = typeof r?.slug === 'string' ? r.slug.trim() : '';
            const lineId = typeof r?.lineId === 'string' ? r.lineId.trim() : '';
            const linePence = typeof r?.linePence === 'number' && Number.isInteger(r.linePence) ? r.linePence : NaN;
            if (!slug || !lineId || !Number.isFinite(linePence)) return null;
            return { slug, lineId, linePence };
        },
        caseFileOf: () => null,
        async preconditions(_ctx, args) {
            if (args.linePence <= 0) return 'a line price must be more than £0';
            if (args.linePence > MAX_LINE_PENCE) return `${pounds(args.linePence)} is more than one line can be set to by ask (${pounds(MAX_LINE_PENCE)}); type it on the screen if it is right`;
            const found = await lineOf(load, args);
            if ('error' in found) return found.error ?? 'that line cannot be changed';
            if (args.linePence < found.line.materialsPence) return `${pounds(args.linePence)} is below that line's materials (${pounds(found.line.materialsPence)}); change the materials on the screen first`;
            return null;
        },
        async preview(_ctx, args) {
            const found = await lineOf(load, args);
            if ('error' in found) return { ok: false, reason: found.error ?? 'that line cannot be changed' };
            const { screen, line } = found;
            const title = `${line.qty > 1 ? `${line.qty}× ` : ''}${line.title}`;
            const was = line.suggestedPence != null ? `, suggested ${pounds(line.suggestedPence)}` : '';
            return { ok: true, text: `On ${screen.customer.firstName}'s price screen: ${title} to ${pounds(args.linePence)}${was}. Labour takes the change. Nothing is saved or sent: you press Send.` };
        },
        async execute(_ctx, args) {
            const found = await lineOf(load, args);
            if ('error' in found) return { ok: false, reason: found.error ?? 'that line cannot be changed' };
            return { ok: true, result: { slug: args.slug, lineId: args.lineId, linePence: args.linePence, title: found.line.title } };
        },
    };
}

export const quoteSetLine = quoteSetLineKind();
