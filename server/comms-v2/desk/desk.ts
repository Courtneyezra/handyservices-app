/**
 * The desk: one pipeline, one exit, for one customer turn.
 *
 *   route (Haiku) -> gather (the Scoping specialist and its tool server) -> compose (Fable 5.1)
 *   -> guards -> render -> window and template -> the one sender -> the send recorded on the file.
 *
 * Exceptions (Contract 3): money, callbacks and date changes hold for Ben and the reply still
 * answers the rest, saying Ben will come back on that. Complaints, refunds, trust doubts and gas:
 * one fixed line in Ben's words, no composer, then nothing until Ben. A guard failure goes back to
 * the composer once, then holds with the fixed acknowledgement. A composer refusal or failure
 * takes the fixed acknowledgement, never a silent empty reply. Never silent otherwise; a clock
 * pass never sends ("no chasing", "one acknowledgement, then quiet").
 */
import { randomUUID } from 'node:crypto';
import { ask as ledgerAsk, answered as ledgerAnswered, thanked as ledgerThanked, hold as setHold, partyOf, setStage, isReady, type CaseFile, type ModelCallRecord, type Turn, type CaseFileDeps, type RenderedBubble } from './case-file';
import { compose, type ComposeInput } from './composer';
import type { DeskLike, DeskResult, GuardName, GuardVerdict, SpecialistReturn } from './desk-types';
import { fixedLine, knowledgeBaseFixedLines, type FixedLine, type FixedLineKind, type FixedLineSource } from './fixed-lines';
import { approverFor, runGuards, type GuardOutcome, type KbRow } from './guards';
import { offersCall, textAsks } from './lexicon';
import { AnthropicModelClient, type ModelClient } from './models';
import type { Exception, Route } from './router';
import { route as routeTurn } from './router';
import { scope, type ScopingDeps } from './scoping-specialist';
import { BUBBLE_CEILING, DESK_APPROVER, chooseChannel, liveTemplateStatus, pickTemplate, render, send, windowOf, type SenderDeps, type TemplateStatusSource, type WindowState } from './sender';
import { reviewedKb, type KbReader } from './scoping-tools';

export interface DeskDeps extends CaseFileDeps {
    client?: ModelClient;
    fixedLines?: FixedLineSource;
    templates?: TemplateStatusSource;
    kb?: KbReader;
    scoping?: ScopingDeps;
    sender?: SenderDeps;
    mode?: 'dry_run' | 'live';
    log?: (line: string) => void;
}

const FIXED_LINE_ONLY: ReadonlySet<Exception> = new Set<Exception>(['complaint', 'refund', 'trust_doubt', 'regulated']);
const ANSWER_THE_REST: ReadonlySet<Exception> = new Set<Exception>(['money', 'date_change']);

function passGuards(): Record<GuardName, GuardVerdict> {
    const v = (): GuardVerdict => ({ result: 'pass', note: null });
    return { figure: v(), date_time_duration: v(), commitment_fault: v(), business_claim: v(), disclosure: v(), one_reply: v(), ask_ledger: v(), regulated: v() };
}

export class Desk implements DeskLike {
    private readonly client: ModelClient;
    private readonly deps: DeskDeps;
    private readonly now: () => Date;

    constructor(deps: DeskDeps = {}) {
        this.deps = deps;
        this.client = deps.client ?? new AnthropicModelClient();
        this.now = deps.now ?? (() => new Date());
    }

    private fileDeps(): CaseFileDeps { return { now: this.now, newId: this.deps.newId }; }

    /** A clock pass with no new message: the desk never chases, so nothing goes. */
    async clockPass(file: CaseFile): Promise<DeskResult> {
        const party = file.parties[0];
        return this.nothing(file, party.personId, `run_${randomUUID()}`, [], 'clock pass: no customer turn, nothing to reply to; the desk never chases');
    }

    private nothing(file: CaseFile, partyId: string, runId: string, calls: ModelCallRecord[], note: string, decision: 'none' | 'hold' = 'none'): DeskResult {
        const party = partyOf(file, partyId)!;
        const window = windowOf(party, 'whatsapp', this.now());
        return { runId, decision, partyId, channel: null, windowState: window.state, templateId: null, bubbles: [], factIds: [], kbIds: [], guards: passGuards(), approver: null, hold: file.hold, delivered: false, stageAfter: file.stage, calls, note, error: null, landedTurnId: null, composerCalls: 0 };
    }

    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> {
        const runId = `run_${randomUUID()}`;
        const calls: ModelCallRecord[] = [];
        const party = partyOf(file, turn.partyId);
        if (!party) return this.nothing(file, file.parties[0].personId, runId, calls, 'the turn\'s party is not on the file');
        if (turn.direction !== 'inbound') return this.nothing(file, party.personId, runId, calls, 'not a customer turn');
        const log = this.deps.log ?? (() => undefined);

        // 1. Route.
        const route: Route = await routeTurn(file, turn, this.client);
        calls.push(route.call);
        if (route.error) log(`router: ${route.error} (fallback route used)`);
        if (file.stage === 'first_contact') setStage(file, 'scoping', 'first customer turn routed', this.fileDeps());

        // 2. Exceptions that the Scoper does not scope: one fixed line, a hold, no composer.
        const fixedLines: FixedLine[] = [];
        const kbIds: string[] = [];
        const exception = route.exception;
        let composerCalls = 0;
        let reply: string | null = null;
        let factIds: string[] = [];
        const specialists: SpecialistReturn[] = [];

        if (exception && FIXED_LINE_ONLY.has(exception)) {
            const kind: FixedLineKind = exception === 'regulated' ? 'gas' : exception === 'trust_doubt' ? 'trust' : exception === 'refund' ? 'refund' : 'complaint';
            const line = await fixedLine(kind, this.deps.fixedLines ?? knowledgeBaseFixedLines);
            fixedLines.push(line);
            if (line.kbId) kbIds.push(line.kbId);
            this.holdFor(file, exception, `${exception}: ${route.belts.regulated ?? turn.body.slice(0, 80)}`);
            reply = line.text;
        } else {
            // 3. Gather: the Scoping specialist and its tool server.
            const scoping = await scope(file, turn, party, this.client, { ...this.deps.scoping, now: this.now });
            calls.push(...scoping.calls);
            specialists.push(scoping);
            if (scoping.error) log(`scoping: ${scoping.error}`);
            if (scoping.proposal.hold) {
                const line = await fixedLine('gas', this.deps.fixedLines ?? knowledgeBaseFixedLines);
                fixedLines.push(line);
                if (line.kbId) kbIds.push(line.kbId);
                this.holdFor(file, 'regulated', `regulated: ${scoping.proposal.hold.match}`);
                reply = line.text;
            } else {
                if (exception && ANSWER_THE_REST.has(exception)) {
                    const line = await fixedLine('money_to_ben', this.deps.fixedLines ?? knowledgeBaseFixedLines);
                    fixedLines.push(line);
                    this.holdFor(file, exception, `${exception}: ${route.belts.money ?? turn.body.slice(0, 80)}`);
                }
                if (route.subjects.includes('scheduling')) fixedLines.push(await fixedLine('dates_with_quote', this.deps.fixedLines ?? knowledgeBaseFixedLines));
                // Pauses, promises and a not-ready customer get an acknowledgement and no question.
                if (route.turnKind === 'short_pause' || route.turnKind === 'promise_of_more' || route.turnKind === 'not_ready') {
                    scoping.proposal.nextQuestion = null;
                    scoping.proposal.mentionPhotos = false;
                    if (route.turnKind === 'not_ready') scoping.proposal.offerCall = false;
                }
                // 4. Compose, once; a guard failure sends it back once; the ceiling sends it back once.
                const input: ComposeInput = { file, party, turn, route, specialists, fixedLines };
                const first = await compose(input, this.client);
                calls.push(first.record);
                composerCalls++;
                if (first.output) { reply = first.output.reply; factIds = first.output.factIds; kbIds.push(...first.output.kbIds); }
                else {
                    log(`composer: ${first.refused ? 'refused' : first.error}`);
                    return this.heldAck(file, party.personId, turn, runId, calls, `composer ${first.refused ? 'declined' : 'failed'}: ${first.error}`, null, composerCalls, specialists);
                }
            }
        }

        // 5. Guards, with one retry to the composer.
        const kbRows = await this.kbRows(kbIds);
        const proposedSubject = specialists[0]?.proposal.nextQuestion?.subject ?? null;
        const guardInput = (text: string, ids: string[]) => ({ file, party, turn, reply: text, factIds: ids, kbIds, kbRows, fixedLines, proposedSubject });
        let guards: GuardOutcome = runGuards(guardInput(reply!, factIds));
        if (!guards.ok && !(exception && FIXED_LINE_ONLY.has(exception)) && !specialists[0]?.proposal.hold) {
            const again = await compose({ file, party, turn, route, specialists, fixedLines, failures: guards.failures }, this.client);
            calls.push(again.record);
            composerCalls++;
            if (again.output) {
                const g2 = runGuards(guardInput(again.output.reply, again.output.factIds));
                if (g2.ok) { reply = again.output.reply; factIds = again.output.factIds; kbIds.push(...again.output.kbIds); guards = g2; }
                else return this.heldAck(file, party.personId, turn, runId, calls, `guards failed twice: ${g2.failures.join('; ')}`, again.output.reply, composerCalls, specialists, g2);
            } else return this.heldAck(file, party.personId, turn, runId, calls, `guards failed and the composer ${again.refused ? 'declined' : 'failed'} the retry`, reply, composerCalls, specialists, guards);
        }
        if (!guards.ok) {
            // A fixed line that fails a guard is a contract failure in the line itself: hold with it named, send the acknowledgement.
            return this.heldAck(file, party.personId, turn, runId, calls, `the fixed line failed the guards: ${guards.failures.join('; ')}`, reply, composerCalls, specialists, guards);
        }

        // 6. Channel, window, render, template.
        const choice = chooseChannel(party, turn.channel);
        if (!choice.ok) return this.nothing(file, party.personId, runId, calls, choice.reason, 'hold');
        let rendered = render(choice.channel, reply!, party);
        if (!rendered.ok && rendered.reason === 'ceiling' && !(exception && FIXED_LINE_ONLY.has(exception))) {
            const shorter = await compose({ file, party, turn, route, specialists, fixedLines, shorten: { previous: reply!, bubbles: rendered.bubbles.length, ceiling: BUBBLE_CEILING } }, this.client);
            calls.push(shorter.record);
            composerCalls++;
            if (shorter.output) {
                const g3 = runGuards(guardInput(shorter.output.reply, shorter.output.factIds));
                const r3 = render(choice.channel, shorter.output.reply, party);
                if (g3.ok && r3.ok) { reply = shorter.output.reply; factIds = shorter.output.factIds; guards = g3; rendered = r3; }
            }
        }
        if (!rendered.ok) return this.heldAck(file, party.personId, turn, runId, calls, rendered.reason === 'ceiling' ? `the reply stayed over the ceiling of ${BUBBLE_CEILING} bubbles after one shorten` : 'the reply rendered to nothing', reply, composerCalls, specialists, guards);
        const window = windowOf(party, choice.channel, this.now());
        let templateId: string | null = null;
        if (window.state === 'shut') {
            const pick = await pickTemplate('service_reply', { name: party.name, topic: file.job.type ?? turn.body.slice(0, 60) }, this.deps.templates ?? liveTemplateStatus);
            if (!pick.ok) {
                setHold(file, { approver: approverFor(file, exception), reason: `window shut and ${pick.reason}`, draft: reply, failures: [] }, this.fileDeps());
                return { ...this.nothing(file, party.personId, runId, calls, pick.reason, 'hold'), factIds, kbIds, guards: guards.guards, composerCalls, windowState: 'shut', channel: choice.channel };
            }
            templateId = pick.templateId;
            rendered = { ok: true, bubbles: [{ text: pick.body, gapMs: 0 }] };
        }

        // 7. The one sender.
        const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, templateId, runId, approver: DESK_APPROVER, guards, factIds, kbIds: Array.from(new Set(kbIds)), calls, mode: this.deps.mode ?? 'dry_run' }, { ...this.deps.sender, now: this.now, newId: this.deps.newId });
        if (!sent.ok) return { ...this.nothing(file, party.personId, runId, calls, `send refused: ${sent.reason}`, 'hold'), guards: guards.guards, composerCalls };

        // 8. The ledger and the stage, from what actually went.
        this.afterSend(file, party.personId, reply!, specialists);
        return {
            runId, decision: 'send', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId, bubbles: rendered.bubbles,
            factIds, kbIds: Array.from(new Set(kbIds)), guards: guards.guards, approver: DESK_APPROVER, hold: file.hold, delivered: true, stageAfter: file.stage,
            calls, note: null, error: null, landedTurnId: sent.record.turnId, composerCalls,
        };
    }

    private holdFor(file: CaseFile, exception: Exception, reason: string): void {
        if (file.hold) return;
        setHold(file, { approver: approverFor(file, exception), reason }, this.fileDeps());
    }

    /** Contract 4's second failure and the composer's fallback route: hold with the draft, and the customer still hears the fixed acknowledgement. */
    private async heldAck(file: CaseFile, partyId: string, turn: Turn, runId: string, calls: ModelCallRecord[], why: string, draft: string | null, composerCalls: number, specialists: SpecialistReturn[], failed?: GuardOutcome): Promise<DeskResult> {
        const party = partyOf(file, partyId)!;
        if (!file.hold) setHold(file, { approver: approverFor(file, null), reason: why, draft, failures: failed?.failures ?? [] }, this.fileDeps());
        const line = await fixedLine('held_ack', this.deps.fixedLines ?? knowledgeBaseFixedLines);
        const guards = runGuards({ file, party, turn, reply: line.text, factIds: [], kbIds: [], kbRows: [], fixedLines: [line], proposedSubject: null });
        const choice = chooseChannel(party, turn.channel);
        const window = choice.ok ? windowOf(party, choice.channel, this.now()) : null;
        const base = this.nothing(file, partyId, runId, calls, why, 'hold');
        if (!choice.ok || !window || !guards.ok || window.state === 'shut') return { ...base, guards: guards.guards, composerCalls, note: `${why}; acknowledgement not sent: ${!choice.ok ? choice.reason : !guards.ok ? guards.failures.join('; ') : 'window shut'}` };
        const bubbles: RenderedBubble[] = [{ text: line.text, gapMs: 1000 }];
        const sent = await send({ file, partyId, channel: choice.channel, window, bubbles, templateId: null, runId, approver: DESK_APPROVER, guards, factIds: [], kbIds: [], calls, mode: this.deps.mode ?? 'dry_run' }, { ...this.deps.sender, now: this.now, newId: this.deps.newId });
        if (!sent.ok) return { ...base, guards: guards.guards, composerCalls, note: `${why}; acknowledgement refused: ${sent.reason}` };
        this.afterSend(file, partyId, line.text, specialists);
        return { ...base, decision: 'hold', channel: choice.channel, windowState: window.state, bubbles, guards: guards.guards, approver: DESK_APPROVER, hold: file.hold, delivered: true, stageAfter: file.stage, landedTurnId: sent.record.turnId, composerCalls, note: why };
    }

    /** The ledger records what the reply actually asked and thanked for; the stage moves to ready when the file is. */
    private afterSend(file: CaseFile, partyId: string, reply: string, specialists: SpecialistReturn[]): void {
        const deps = this.fileDeps();
        const party = partyOf(file, partyId)!;
        const proposal = specialists[0]?.proposal ?? null;
        for (const subject of ['media', 'postcode', 'access'] as const) if (textAsks(reply, subject)) ledgerAsk(file, subject, deps);
        if (proposal?.nextQuestion && reply.includes('?')) ledgerAsk(file, proposal.nextQuestion.subject, deps);
        if (proposal?.mentionPhotos && /\b(?:photo|photos|picture|pictures|pic|pics|video|snap|image)s?\b/i.test(reply)) ledgerAsk(file, 'media', deps);
        if (proposal?.thankForMedia && /\b(?:thank|cheers|ta)\b/i.test(reply)) { ledgerAnswered(file, 'media', deps); ledgerThanked(file, 'media', deps); }
        if (offersCall(reply)) party.callOffered = true;
        if (isReady(file) && file.stage === 'scoping') setStage(file, 'ready', 'job type and location both on the file', deps);
    }

    private async kbRows(ids: string[]): Promise<KbRow[]> {
        if (!ids.length) return [];
        const rows = await (this.deps.kb ?? reviewedKb).list();
        return rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, approvedWords: r.approvedWords, reviewed: true }));
    }
}
