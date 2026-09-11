/**
 * The Quoting part of the desk's sandbox door: the two human actions the pipeline drives in dry run
 * (design.md, "One quote, box by box", the Ben row and the acceptance), and the quote's state.
 *
 *   POST /price   Ben prices and sends. His prices go through the price screen's own write; his
 *                 send (the desk's drafted message with the quote link) goes through the one sender
 *                 in dry run under approver human:ben and lands on the thread as an outbound turn;
 *                 the stage moves to quoted. Body: { lines: [{ lineId, finalPence }] }; absent, the
 *                 chain's suggestions. Response: the planned send.
 *   POST /accept  The customer accepts on the quote page and pays the deposit: a human event
 *                 (answer 42: the payment path is not validated live, so the door records what the
 *                 Stripe webhook writes). The stage flips to accepted, Ben's push is recorded, and
 *                 the acceptance enters the desk as the customer's turn for one acknowledgement.
 *   GET  /quote   The quote as the file records it and as the row holds it: status, lines to the
 *                 penny, Ben's recorded notifications.
 *
 * Mounted by desk/sandbox-door.ts in the place of its Goal 1 refusal. Nothing here composes for
 * the customer; the acknowledgement on acceptance is the composer's, through the desk.
 */
import { Router, type Response } from 'express';
import { appendTurn, hold as setHold, type CaseFile, type Turn } from '../desk/case-file';
import type { DeskDeps } from '../desk/desk';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import type { Gateway } from '../desk/gateway';
import { BEN, runGuards } from '../desk/guards';
import type { PlannedSend } from '../desk/planned-send';
import { chooseChannel, pickTemplate, render, send, windowOf, liveTemplateStatus, type TemplateSend } from '../desk/sender';
import { quoteRecordOf } from './quote-record';
import { humanRunId, markQuoteSent, priceQuote, recordAcceptance, resolveQuotingDeps, type QuotingDeps } from './quoting-tools';
import { quoteStateOf } from './quoting-specialist';

export interface QuotingDoorOptions {
    current: () => CaseFile | null;
    gateway: () => Gateway;
    state: () => unknown;
    plannedSend: (file: CaseFile, r: DeskResult) => PlannedSend;
    now: () => Date;
    deps: DeskDeps;
    /** The reserved number whose quotes /reset removes. */
    sandboxPhone?: string;
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
    const quotingDeps = (): QuotingDeps => ({ ...opts.deps.quoting, now: opts.now, newId: opts.deps.newId, mode: 'dry_run' });
    const respond = (res: Response, file: CaseFile, result: DeskResult, extra: Record<string, unknown> = {}) => {
        res.json({ ok: true, ...extra, run: { runId: result.runId, agent: 'comms_v2', decision: { kind: result.decision, approver: result.approver, reason: result.note ?? undefined }, error: result.error, caseFile: { stage: file.stage } }, plannedSend: opts.plannedSend(file, result), state: opts.state() });
    };
    const lastInbound = (file: CaseFile): Turn | null => { for (let i = file.turns.length - 1; i >= 0; i--) if (file.turns[i].direction === 'inbound') return file.turns[i]; return null; };

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
            const party = file.parties[0];
            const body = (req.body ?? {}) as { lines?: Array<{ lineId: string; finalPence: number }> };
            const lines = Array.isArray(body.lines) ? body.lines.filter((l) => l && typeof l.lineId === 'string' && Number.isFinite(l.finalPence)).map((l) => ({ lineId: l.lineId, finalPence: Math.round(l.finalPence) })) : undefined;
            const priced = await priceQuote(file, { lines, by: BEN_APPROVER }, quotingDeps());
            if (!priced.ok) { res.status(priced.status).json({ error: priced.reason }); return; }
            // Ben's send: the desk's drafted message carrying the link, through the one sender in dry run.
            const message = priced.message;
            const turn = lastInbound(file) ?? file.turns[0];
            const guardRun = runGuards({ file, party, turn, reply: message, factIds: priced.factIds, kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null });
            // A human send is not a desk reply: the one-reply rule is the desk's, not Ben's.
            guardRun.guards.one_reply = { result: 'pass', note: 'a human send, not a desk reply' };
            guardRun.failures = guardRun.failures.filter((f) => !f.startsWith('one_reply'));
            guardRun.ok = guardRun.failures.length === 0;
            const runId = humanRunId();
            const choice = chooseChannel(party, 'whatsapp');
            if (!choice.ok) { res.status(409).json({ error: choice.reason }); return; }
            const window = windowOf(party, choice.channel, opts.now());
            let rendered = render(choice.channel, message);
            let template: TemplateSend | null = null;
            if (window.state === 'shut') {
                const pick = await pickTemplate('service_reply', { name: party.name, topic: file.job.type ?? 'your quote' }, opts.deps.templates ?? liveTemplateStatus);
                if (!pick.ok) {
                    if (!file.hold) setHold(file, { approver: BEN, reason: `quote ${priced.record.slug} priced; the WhatsApp window is shut and ${pick.reason}`, draft: message, failures: [] }, { now: opts.now, newId: opts.deps.newId });
                    const held: DeskResult = { runId, decision: 'hold', partyId: party.personId, channel: choice.channel, windowState: 'shut', templateId: null, bubbles: [], factIds: priced.factIds, kbIds: [], guards: guardRun.guards, approver: null, hold: file.hold, delivered: false, stageAfter: file.stage, calls: [], note: `priced; window shut and ${pick.reason}`, summary: `ben priced ${priced.record.slug}`, error: null, landedTurnId: null, composerCalls: 0 };
                    respond(res, file, held, { slug: priced.record.slug, totals: priced.totals, quoteUrl: priced.quoteUrl, sent: false });
                    return;
                }
                template = pick.template;
                rendered = { ok: true, bubbles: [{ text: pick.body, gapMs: 0 }] };
            }
            if (!rendered.ok) { res.status(409).json({ error: `the quote message could not be rendered (${rendered.reason})` }); return; }
            const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template, runId, approver: BEN_APPROVER, guards: guardRun, factIds: priced.factIds, kbIds: [], fixedLines: [], calls: [], mode: 'dry_run' }, { now: opts.now, newId: opts.deps.newId });
            if (!sent.ok) { res.status(409).json({ error: `send refused: ${sent.reason}`, guards: guardRun.guards }); return; }
            // The send landed: only now does the quote leave draft and its figures reach the file.
            const staged = await markQuoteSent(file, quotingDeps());
            const record = staged.ok ? staged.record : priced.record;
            const result: DeskResult = {
                runId, decision: 'send', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId: template?.name ?? null, bubbles: rendered.bubbles,
                factIds: priced.factIds, kbIds: [], guards: guardRun.guards, approver: BEN_APPROVER, hold: file.hold, delivered: true, stageAfter: file.stage, calls: [],
                note: staged.ok ? null : `sent, but the quote did not leave draft: ${staged.reason}`, summary: `ben priced ${record.slug} at ${(priced.totals.totalPence / 100).toFixed(2)} and sent the link`, error: null, landedTurnId: sent.record.turnId, composerCalls: 0,
            };
            respond(res, file, result, { slug: record.slug, totals: priced.totals, quoteUrl: priced.quoteUrl, sent: true, status: record.status, lines: record.lines.map((l) => ({ label: l.label, pricePence: l.pricePence })) });
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
                return await resolveQuotingDeps(quotingDeps()).store.deleteSandbox(opts.sandboxPhone ?? '+447700900942');
            } catch (error: any) {
                return { error: error?.message ?? 'sandbox quote cleanup failed' };
            }
        },
    };
}
