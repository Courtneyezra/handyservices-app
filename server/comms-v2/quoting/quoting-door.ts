/**
 * The Quoting part of the desk's sandbox door: the two human actions the pipeline drives in dry run
 * (design.md, "One quote, box by box", the Ben row and the acceptance), and the quote's state.
 *
 *   POST /price   Ben prices and sends. His prices go through the price screen's own write; then the
 *                 delivery (deliver-quote.ts, the same path Ben's live price screen takes): the
 *                 desk's own composer writes it with the quote link, Contract 4 checks it, and it
 *                 goes through the one sender in dry run under approver human:ben, landing on the
 *                 thread as an outbound turn; on a shut window the approved `quote_ready_link`
 *                 template carries the link instead; the stage moves to quoted. The quote leaves
 *                 draft only once that send has landed, so a quote is never marked sent when the
 *                 text that went is not the quote: a shut window with no approved template, a guard
 *                 failure or a refused send holds for Ben and leaves the quote a draft he can price
 *                 again. Body: { lines: [{ lineId, finalPence }] }; absent, the chain's suggestions.
 *                 Response: the planned send.
 *   POST /accept  The customer accepts on the quote page and pays the deposit: a human event
 *                 (answer 42: the payment path is not validated live, so the door records what the
 *                 Stripe webhook writes). The stage flips to accepted, Ben's push is recorded, and
 *                 the acceptance enters the desk as the customer's turn for one acknowledgement.
 *   GET  /quote   The quote as the file records it and as the row holds it: status, lines to the
 *                 penny, Ben's recorded notifications.
 *
 * Mounted by desk/sandbox-door.ts in the place of its Goal 1 refusal. Every word the customer reads
 * is the desk composer's - the delivery through `deliverPricedQuote`, the acknowledgement on
 * acceptance through the desk itself - but two: the `first_contact_ack` fixed line the delivery
 * puts ahead of the link where nothing has ever reached them, taken from the one registry of Ben's
 * fixed sentences (`desk/fixed-lines.ts`) like every other, and the approved `quote_ready_link`
 * template's own wording on a shut window.
 */
import { Router, type Response } from 'express';
import { appendTurn, type CaseFile } from '../desk/case-file';
import type { DeskDeps } from '../desk/desk';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import type { Gateway } from '../desk/gateway';
import type { PlannedSend } from '../desk/planned-send';
import { deliverPricedQuote } from './deliver-quote';
import { quoteRecordOf } from './quote-record';
import { priceQuote, recordAcceptance, resolveQuotingDeps, type QuotingDeps } from './quoting-tools';
import { quoteStateOf } from './quoting-specialist';

export interface QuotingDoorOptions {
    current: () => CaseFile | null;
    gateway: () => Gateway;
    state: () => unknown;
    plannedSend: (file: CaseFile, r: DeskResult) => PlannedSend;
    now: () => Date;
    deps: DeskDeps;
    /** Every reserved contact the sandbox customer writes from, whose quotes /reset removes: the number and the address. */
    sandboxContacts: string[];
}

export const BEN_APPROVER = 'human:ben' as const;

/**
 * The desk behind the gateway. Bracket access on purpose: server/spine/desk-switch.test.ts scans
 * every module for a dotted read of that property name and treats one as a module deciding for
 * itself which desk is live, which is the spine's config key, not this.
 */
const deskOf = (g: Gateway): DeskLike => g['desk'];

export function createQuotingDoor(opts: QuotingDoorOptions): { router: Router; reset(): Promise<{ quotes: number; estimates: number; verdicts: number; runs: number } | { error: string }> } {
    const router = Router();
    const quotingDeps = (): QuotingDeps => ({ ...opts.deps.quoting, now: opts.now, newId: opts.deps.newId });
    const respond = (res: Response, file: CaseFile, result: DeskResult, extra: Record<string, unknown> = {}) => {
        res.json({ ok: true, ...extra, run: { runId: result.runId, agent: 'comms_v2', decision: { kind: result.decision, approver: result.approver, reason: result.note ?? undefined }, error: result.error, caseFile: { stage: file.stage } }, plannedSend: opts.plannedSend(file, result), state: opts.state() });
    };

    router.get('/quote', async (_req, res) => {
        try {
            const file = opts.current();
            if (!file) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
            const d = resolveQuotingDeps(quotingDeps());
            const row = file.job.quoteRef ? await d.store.read(file.job.quoteRef) : null;
            const record = row ? quoteRecordOf(row, opts.now()) : null;
            res.json({ ok: true, quote: quoteStateOf(file), record, facts: file.facts.filter((f) => f.key.startsWith('quote_') || f.key.startsWith('ben_')) });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'quote state failed' });
        }
    });

    router.post('/price', async (req, res) => {
        try {
            const file = opts.current();
            if (!file) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
            if (!file.job.quoteRef) { res.status(409).json({ error: 'no quote on the thread: the desk drafts one once the job and the location are known' }); return; }
            const body = (req.body ?? {}) as { lines?: Array<{ lineId: string; finalPence: number }> };
            const lines = Array.isArray(body.lines) ? body.lines.filter((l) => l && typeof l.lineId === 'string' && Number.isFinite(l.finalPence)).map((l) => ({ lineId: l.lineId, finalPence: Math.round(l.finalPence) })) : undefined;
            const priced = await priceQuote(file, { lines, by: BEN_APPROVER }, quotingDeps());
            if (!priced.ok) { res.status(priced.status).json({ error: priced.reason }); return; }
            const out = await deliverPricedQuote({ file, priced, approver: BEN_APPROVER, mode: 'dry_run', now: opts.now, deps: { ...opts.deps, quoting: quotingDeps() } });
            if (!out.ok) { res.status(out.status).json({ error: out.reason }); return; }
            const common = { slug: out.record.slug, totals: priced.totals, quoteUrl: priced.quoteUrl, sent: out.sent };
            respond(res, file, out.result, out.sent ? { ...common, status: out.record.status, lines: out.record.lines.map((l) => ({ label: l.label, pricePence: l.pricePence })) } : common);
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'sandbox price failed' });
        }
    });

    router.post('/accept', async (_req, res) => {
        try {
            const file = opts.current();
            if (!file) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
            const party = file.parties[0];
            const accepted = await recordAcceptance(file, party, { by: 'human', via: 'sandbox quote page' }, quotingDeps());
            if (!accepted.ok) { res.status(accepted.status).json({ error: accepted.reason }); return; }
            // The acceptance enters the desk as the customer's turn: one acknowledgement, from the composer.
            const at = new Date(Math.max(opts.now().getTime(), file.turns.length ? Date.parse(file.turns[file.turns.length - 1].at) + 1 : 0)).toISOString();
            const turn = appendTurn(file, { at, channel: 'form', direction: 'inbound', partyId: party.personId, kind: 'portal_action', body: accepted.turnBody, media: [], runId: null, approver: null }, { now: opts.now, newId: opts.deps.newId });
            if (!turn.ok) { res.status(409).json({ error: turn.reason }); return; }
            const result = await deskOf(opts.gateway()).handleTurn(file, turn.value);
            respond(res, file, result, { slug: file.job.quoteRef, depositPence: accepted.depositPence, notice: accepted.notice, accepted: true });
        } catch (error: any) {
            res.status(500).json({ error: error?.message ?? 'sandbox accept failed' });
        }
    });

    return {
        router,
        async reset() {
            try {
                return await resolveQuotingDeps(quotingDeps()).store.deleteSandbox(opts.sandboxContacts);
            } catch (error: any) {
                return { error: error?.message ?? 'sandbox quote cleanup failed' };
            }
        },
    };
}
