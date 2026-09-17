/**
 * Ben's live price screen sending a quote the new desk drafted (server/spine/routes.ts
 * `POST /api/spine/price/:slug/send`): the surviving send path, re-pointed at the new desk's sender.
 *
 * After the price screen's own `confirmPrices` has written Ben's prices, the route asks here first.
 * Only while the new desk is the live desk (server/comms-v2/switch.ts `commsV2Live`), and only for a
 * quote an open case file on the live intake's store carries, the delivery is the new desk's own
 * (deliver-quote.ts): the composer's words with the link through the one sender under the person
 * who pressed send, `human:<their email or id>`, or the approved `quote_ready_link` template on a shut
 * window, and the case file records the send, the quote's figures and the stage. Every other quote,
 * and every quote while any switch is off, gets `null` back and takes the old path unchanged
 * (server/agent-staff.ts `deliverQuoteLink`).
 */
import type { Approver } from '../../approver';
import type { CaseFile } from '../desk/case-file';
import type { DeskDeps } from '../desk/desk';
import type { CaseFileStore } from '../desk/store';
import { reopenStaleQuoteFiles } from '../file-close';
import { deliverPricedQuote } from './deliver-quote';
import { pricedQuoteOf } from './quoting-tools';

export interface PriceScreenSendInput {
    slug: string;
    /** The signed-in person who pressed send, as the price screen names them. */
    approver: Approver;
    quoteUrl: string;
    totals: { totalPence: number; depositPence: number };
}

export interface PriceScreenSendDeps {
    liveState?: () => Promise<{ live: boolean; off: string[] }>;
    /** The live intake's store; the default builds or reuses the live gateway (channels/intake.ts). */
    gateway?: () => Promise<{ store: CaseFileStore }>;
    /** Overrides for the desk's dependencies; the default opens the live quote store. */
    deskDeps?: DeskDeps;
    now?: () => Date;
}

export interface PriceScreenSendResponse { status: number; json: Record<string, unknown> }

/**
 * The open live case file carrying this quote, while the new desk is the live desk; else null. With
 * `reopenStale`, the event's words, a file the stale quote rule closed on this quote is reopened and
 * returned when no open one carries it (file-close.ts `reopenStaleQuoteFiles`).
 */
export async function liveQuoteFile(slug: string, deps: PriceScreenSendDeps & { reopenStale?: string } = {}): Promise<{ file: CaseFile; store: CaseFileStore } | null> {
    const readState = deps.liveState ?? (async () => (await import('../switch')).commsV2LiveState());
    if (!(await readState()).live) return null;
    const gateway = await (deps.gateway ?? (async () => (await import('../channels/intake')).liveChannelGateway()))();
    const files = gateway.store.all();
    let file = files.find((f) => f.job.quoteRef === slug && f.stage !== 'done') ?? null;
    if (!file && deps.reopenStale) {
        file = reopenStaleQuoteFiles(files, [slug], deps.reopenStale, { now: deps.now })[0] ?? null;
        if (file) gateway.store.put(file);
    }
    return file ? { file, store: gateway.store } : null;
}

/** The new desk's delivery for a quote on a live case file, as the route's response; null for every other quote. */
export async function sendPricedQuoteThroughDesk(input: PriceScreenSendInput, deps: PriceScreenSendDeps = {}): Promise<PriceScreenSendResponse | null> {
    const found = await liveQuoteFile(input.slug, deps);
    if (!found) return null;
    const now = deps.now ?? (() => new Date());
    const { INTAKE_DESK_MODE } = await import('../channels/intake');
    const quoting = deps.deskDeps?.quoting ?? { store: (await import('./quote-store')).databaseQuoteStore('live') };
    const deskDeps: DeskDeps = { ...deps.deskDeps, quoting };
    const base = { priced: true, desk: 'comms_v2', caseId: found.file.id, quoteUrl: input.quoteUrl, totals: input.totals };
    try {
        const priced = await pricedQuoteOf(found.file, input.quoteUrl, input.totals, { ...quoting, now });
        if (!priced.ok) return { status: priced.status, json: { ok: false, ...base, errors: [`Prices are saved on the quote, but the new desk could not read it back to send: ${priced.reason}`] } };
        const out = await deliverPricedQuote({ file: found.file, priced, approver: input.approver, mode: INTAKE_DESK_MODE.live, now, deps: deskDeps });
        if (!out.ok) return { status: out.status, json: { ok: false, ...base, errors: [`Prices are saved on the quote, but it could not be sent: ${out.reason}`] } };
        if (!out.sent) return { status: 409, json: { ok: false, ...base, sent: false, runId: out.result.runId, errors: [`Prices are saved and the quote stays a draft, held for you on the board: ${out.result.note}`] } };
        return { status: 200, json: { ok: true, ...base, sent: true, mode: out.result.templateId ? 'template' : 'freeform', templateName: out.result.templateId, runId: out.result.runId, messageBody: out.result.bubbles.map((b) => b.text).join('\n\n') } };
    } finally {
        found.store.put(found.file);
    }
}
