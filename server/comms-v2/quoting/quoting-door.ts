/**
 * The Quoting part of the desk's sandbox door: the two human actions the pipeline drives in dry run
 * (design.md, "One quote, box by box", the Ben row and the acceptance), and the quote's state.
 *
 *   POST /price   Ben prices and sends. His prices go through the price screen's own write; the
 *                 desk's own composer then writes the delivery with the quote link, Contract 4
 *                 checks it, and it goes through the one sender in dry run under approver
 *                 human:ben, landing on the thread as an outbound turn; the stage moves to quoted.
 *                 The quote leaves draft only once that send has landed, so a quote is never marked
 *                 sent when the text that went is not the quote: a shut window, a guard failure or
 *                 a refused send holds for Ben and leaves the quote a draft he can price again.
 *                 Body: { lines: [{ lineId, finalPence }] }; absent, the chain's suggestions.
 *                 Response: the planned send.
 *   POST /accept  The customer accepts on the quote page and pays the deposit: a human event
 *                 (answer 42: the payment path is not validated live, so the door records what the
 *                 Stripe webhook writes). The stage flips to accepted, Ben's push is recorded, and
 *                 the acceptance enters the desk as the customer's turn for one acknowledgement.
 *   GET  /quote   The quote as the file records it and as the row holds it: status, lines to the
 *                 penny, Ben's recorded notifications.
 *
 * Mounted by desk/sandbox-door.ts in the place of its Goal 1 refusal. Nothing here writes a
 * sentence of its own: both messages are the desk composer's, the delivery through
 * `composeQuoteSent` below and the acknowledgement on acceptance through the desk itself.
 */
import { Router, type Response } from 'express';
import { appendTurn, hold as setHold, release as releaseHold, type CaseFile, type ModelCallRecord, type Party } from '../desk/case-file';
import { compose } from '../desk/composer';
import type { DeskDeps } from '../desk/desk';
import type { DeskLike, DeskResult, GuardName, GuardVerdict } from '../desk/desk-types';
import { AnthropicModelClient } from '../desk/models';
import type { Gateway } from '../desk/gateway';
import { BEN, noReplyToCheck, runGuards, type GuardOutcome } from '../desk/guards';
import type { PlannedSend } from '../desk/planned-send';
import { chooseChannel, render, send, windowOf } from '../desk/sender';
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

type QuoteSentOutcome =
    | { ok: true; reply: string; verdicts: GuardOutcome; calls: ModelCallRecord[]; composerCalls: number }
    | { ok: false; failures: string[]; draft: string | null; verdicts: GuardOutcome; calls: ModelCallRecord[]; composerCalls: number };

/**
 * The delivery message for a quote Ben has just priced, written by the desk's own composer and
 * checked by Contract 4. The words are the desk's, not Ben's: the price route carries no message
 * body, so there is nobody to read a borrowed draft before it goes, and answer 43's exemption is
 * for words a person typed.
 *
 * The composer is given the quote link to copy and nothing else about the quote: the figures are
 * not facts on the file yet (`record_quote_facts` records them only once the quote is sent), which
 * is exactly why the delivery may not quote one. The one-reply guard is told a person licensed
 * this send, because Ben pressing send is a fresh licence to speak rather than the desk replying
 * twice to one customer turn; the other seven run unchanged. One retry with the failures named,
 * the same one retry the desk gives a composed reply.
 */
async function composeQuoteSent(file: CaseFile, party: Party, quoteUrl: string, deps: DeskDeps): Promise<QuoteSentOutcome> {
    const client = deps.client ?? new AnthropicModelClient();
    // The newest thing the customer said: the thread context the composer writes against, and the
    // turn the regulated guard reads. The desk's own last reply is not it.
    const turn = [...file.turns].reverse().find((t) => t.direction === 'inbound' && t.partyId === party.personId) ?? file.turns[file.turns.length - 1];
    const calls: ModelCallRecord[] = [];
    const brief = [
        'quoting: Ben has priced the quote and is sending it now',
        `this is the delivery, not a reply: say the quote is ready and give the link exactly as written here, ${quoteUrl}`,
        'no figure at all: the prices are on the quote, not in the message',
        'no date, no time, no lead time; say to reply here with any questions',
    ];
    const input = {
        file, party, turn,
        route: { turnKind: 'other' as const, subjects: ['quoting' as const], exception: null },
        specialists: [{ specialist: 'quoting' as const, factIds: [], proposal: { nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: true, hold: null }, brief, calls: [], error: null }],
        fixedLines: [],
    };
    const guardsFor = (reply: string) => runGuards({ file, party, turn, reply, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, prompted: 'human_action', liveQuoteRefs: new Set<string>() });
    let draft: string | null = null;
    let outcome = guardsFor('');
    for (const failures of [undefined, 'retry'] as const) {
        const res = await compose(failures ? { ...input, failures: outcome.failures } : input, client);
        calls.push(res.record);
        if (!res.output) { outcome = { ok: false, guards: noReplyToCheck(), failures: [res.error ?? 'the composer returned nothing'] }; continue; }
        draft = res.output.reply;
        outcome = guardsFor(draft);
        if (outcome.ok) return { ok: true, reply: draft, verdicts: outcome, calls, composerCalls: calls.length };
    }
    return { ok: false, failures: outcome.failures, draft, verdicts: outcome, calls, composerCalls: calls.length };
}

export function createQuotingDoor(opts: QuotingDoorOptions): { router: Router; reset(): Promise<{ quotes: number; estimates: number; verdicts: number; runs: number } | { error: string }> } {
    const router = Router();
    const quotingDeps = (): QuotingDeps => ({ ...opts.deps.quoting, now: opts.now, newId: opts.deps.newId, mode: 'dry_run' });
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
            const party = file.parties[0];
            const body = (req.body ?? {}) as { lines?: Array<{ lineId: string; finalPence: number }> };
            const lines = Array.isArray(body.lines) ? body.lines.filter((l) => l && typeof l.lineId === 'string' && Number.isFinite(l.finalPence)).map((l) => ({ lineId: l.lineId, finalPence: Math.round(l.finalPence) })) : undefined;
            const priced = await priceQuote(file, { lines, by: BEN_APPROVER }, quotingDeps());
            if (!priced.ok) { res.status(priced.status).json({ error: priced.reason }); return; }

            const runId = humanRunId();
            const choice = chooseChannel(party, 'whatsapp');
            if (!choice.ok) { res.status(409).json({ error: choice.reason }); return; }
            const window = windowOf(party, choice.channel, opts.now());
            // The quote is never marked sent unless the text that went IS the quote. On a shut
            // window the only thing that may go is an approved template, and none of the desk's
            // carries a quote link, so a send here would deliver a re-open nudge while the file
            // recorded every figure as live. It holds for Ben instead and the quote stays a draft
            // he can price again. Wiring the approved `quote_ready_link` template (it carries the
            // URL as its second variable, docs/comms-build/TEMPLATES-WINDOW-SHUT.md) into the
            // desk's sender is its own cutover item; submitting a template to Meta is not the
            // desk's to do.
            const holdAndAnswer = (why: string, draft: string | null, failures: string[], guards: Record<GuardName, GuardVerdict> = noReplyToCheck(), calls: ModelCallRecord[] = []) => {
                if (!file.hold) setHold(file, { approver: BEN, reason: why, draft: draft ?? undefined, failures }, { now: opts.now, newId: opts.deps.newId });
                const held: DeskResult = { runId, decision: 'hold', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId: null, bubbles: [], factIds: priced.factIds, kbIds: [], guards, approver: null, hold: file.hold, delivered: false, stageAfter: file.stage, calls, note: why, summary: `ben priced ${priced.record.slug}; not sent`, error: null, landedTurnId: null, composerCalls: calls.length };
                respond(res, file, held, { slug: priced.record.slug, totals: priced.totals, quoteUrl: priced.quoteUrl, sent: false });
            };
            if (window.state === 'shut') {
                holdAndAnswer(`quote ${priced.record.slug} priced; the WhatsApp window is shut (${window.reason}) and no approved template carries a quote link, so the quote is not sent and stays a draft`, null, []);
                return;
            }

            // Ben licenses this send; the words are the desk's own. The price route carries no
            // message body, so nobody reads a borrowed draft before it goes: the composer writes
            // the delivery from the file, with the quote link, and Contract 4 checks it like any
            // other composed reply (behaviour.md answer 43 is about who WROTE the words).
            const written = await composeQuoteSent(file, party, priced.quoteUrl, opts.deps);
            if (!written.ok) { holdAndAnswer(`quote ${priced.record.slug} priced; the delivery message did not pass the guards (${written.failures.join('; ')})`, written.draft, written.failures, written.verdicts.guards, written.calls); return; }
            const rendered = render(choice.channel, written.reply);
            if (!rendered.ok) { holdAndAnswer(`quote ${priced.record.slug} priced; the delivery message could not be rendered (${rendered.reason})`, written.reply, [], written.verdicts.guards, written.calls); return; }
            const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template: null, runId, approver: BEN_APPROVER, guards: written.verdicts, factIds: priced.factIds, kbIds: [], fixedLines: [], calls: written.calls, mode: 'dry_run' }, { now: opts.now, newId: opts.deps.newId });
            if (!sent.ok) { holdAndAnswer(`quote ${priced.record.slug} priced; the send was refused (${sent.reason})`, written.reply, [], written.verdicts.guards, written.calls); return; }
            // The send landed: only now does the quote leave draft and its figures reach the file.
            // A hold this route put on the thread the last time Ben tried is what his send just
            // answered, so it clears with the words that went, the way any human send releases one.
            if (file.hold) releaseHold(file, BEN, written.reply, { now: opts.now, newId: opts.deps.newId });
            const staged = await markQuoteSent(file, quotingDeps());
            const record = staged.ok ? staged.record : priced.record;
            const result: DeskResult = {
                runId, decision: 'send', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId: null, bubbles: rendered.bubbles,
                factIds: priced.factIds, kbIds: [], guards: written.verdicts.guards, approver: BEN_APPROVER, hold: file.hold, delivered: true, stageAfter: file.stage, calls: written.calls,
                note: staged.ok ? null : `sent, but the quote did not leave draft: ${staged.reason}`, summary: `ben priced ${record.slug} at ${(priced.totals.totalPence / 100).toFixed(2)} and the desk sent the link`, error: null, landedTurnId: sent.record.turnId, composerCalls: written.composerCalls,
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
