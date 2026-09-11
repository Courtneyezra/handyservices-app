/**
 * The channel desk: the same desk (desk/desk.ts) with the call turns handled in front of it.
 * Every other turn, from every channel, goes to the desk unchanged: route, gather, compose,
 * guards, render, window, the one sender. A call is different because the desk never speaks on
 * it and the follow-up is a template, never the composer's words (design.md, "The desk never
 * speaks on a call"; behaviour.md answer 20).
 *
 *   missed            one text back (checklist 3.5): the missed-call template on WhatsApp if the
 *                     number is on it, else the same words as one SMS, else email. Never a second.
 *                     On WhatsApp with the window open (they wrote within the day) the template's
 *                     words go as a plain message; a shut window needs the approved template, and
 *                     none approved holds the follow-up for Ben with the words as the draft.
 *   answered_inbound  the transcript is read for facts; no acknowledgement (3.5). They rang us,
 *                     so the call is never offered again (1.5).
 *   ben_rang          the transcript is read for what Ben asked for (3.3); the post-call template
 *                     goes out with the name and the job (1.3), or its words on SMS; the thread
 *                     continues from the file (3.2) and nothing is held for Ben (3.4).
 *
 * A template's words were approved at registration (server/window-templates.ts,
 * window-templates.test.ts checks every body), so the eight guards are recorded as passed with
 * that note rather than run on words the composer did not write; the same is true of the desk's
 * own shut-window path. Facts from the call carry the call turn as their source.
 */
import { randomUUID } from 'node:crypto';
import { hold as setHold, isReady, partyOf, setStage, type CaseFile, type CaseFileDeps, type ModelCallRecord, type Turn } from '../desk/case-file';
import type { DeskLike, DeskResult, GuardName, GuardVerdict } from '../desk/desk-types';
import { BEN } from '../desk/guards';
import { AnthropicModelClient, type ModelClient } from '../desk/models';
import { DESK_APPROVER, chooseChannel, liveTemplateStatus, pickTemplate, render, send, templateBodyFor, windowOf, type ReplyPurpose, type SenderDeps, type TemplateSend, type TemplateStatusSource, type WindowState } from '../desk/sender';
import { callOutcomeOnFile, type CallOutcome } from './call-adapter';
import { benAskedSubjects, ledgerAfterCall, readCall, recordCallFacts } from './call-reader';

export interface ChannelDeskDeps extends CaseFileDeps {
    client?: ModelClient;
    templates?: TemplateStatusSource;
    sender?: SenderDeps;
    mode?: 'dry_run' | 'live';
    log?: (line: string) => void;
}

const TEMPLATE_NOTE = 'template: words approved at registration; the guards run on composed replies';

function templateGuards(): Record<GuardName, GuardVerdict> {
    const v = (): GuardVerdict => ({ result: 'pass', note: TEMPLATE_NOTE });
    return { figure: v(), date_time_duration: v(), commitment_fault: v(), business_claim: v(), disclosure: v(), one_reply: v(), ask_ledger: v(), regulated: v() };
}

function passGuards(): Record<GuardName, GuardVerdict> {
    const v = (): GuardVerdict => ({ result: 'pass', note: null });
    return { figure: v(), date_time_duration: v(), commitment_fault: v(), business_claim: v(), disclosure: v(), one_reply: v(), ask_ledger: v(), regulated: v() };
}

export class ChannelDesk implements DeskLike {
    private readonly client: ModelClient;
    private readonly now: () => Date;

    constructor(private readonly inner: DeskLike, private readonly deps: ChannelDeskDeps = {}) {
        this.client = deps.client ?? new AnthropicModelClient();
        this.now = deps.now ?? (() => new Date());
    }

    clockPass(file: CaseFile): Promise<DeskResult> { return this.inner.clockPass(file); }

    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> {
        if (turn.direction === 'inbound' && turn.kind === 'call_transcript') return this.handleCall(file, turn, callOutcomeOnFile(file, turn) ?? 'answered_inbound');
        return this.inner.handleTurn(file, turn);
    }

    private fileDeps(): CaseFileDeps { return { now: this.now, newId: this.deps.newId }; }

    private result(file: CaseFile, partyId: string, runId: string, calls: ModelCallRecord[], over: Partial<DeskResult> & { decision: DeskResult['decision']; note: string | null }): DeskResult {
        const party = partyOf(file, partyId)!;
        const window = windowOf(party, 'whatsapp', this.now());
        return { runId, partyId, channel: null, windowState: window.state, templateId: null, bubbles: [], factIds: [], kbIds: [], guards: passGuards(), approver: null, hold: file.hold, delivered: false, stageAfter: file.stage, calls, summary: null, error: null, landedTurnId: null, composerCalls: 0, ...over };
    }

    private async handleCall(file: CaseFile, turn: Turn, outcome: CallOutcome): Promise<DeskResult> {
        const runId = `run_${randomUUID()}`;
        const calls: ModelCallRecord[] = [];
        const log = this.deps.log ?? (() => undefined);
        const party = partyOf(file, turn.partyId);
        if (!party) return this.result(file, file.parties[0].personId, runId, calls, { decision: 'none', note: 'the call\'s party is not on the file' });
        const deps = this.fileDeps();
        if (file.stage === 'first_contact') setStage(file, 'scoping', 'first customer turn: a call', deps);

        // They rang us, or Ben rang them: a call is never offered again on this file.
        if (outcome === 'ben_rang') party.callOffered = true;
        else party.alreadyRung = true;

        // The transcript, read for facts. Never for words.
        const factIds: string[] = [];
        let asked: Array<'media' | 'postcode' | 'access'> = [];
        let summary = `call ${outcome}`;
        if (outcome !== 'missed') {
            const read = await readCall(file, turn, this.client);
            calls.push(read.record);
            if (read.output) {
                factIds.push(...recordCallFacts(file, turn, read.output, deps));
                if (isReady(file) && file.stage === 'scoping') setStage(file, 'ready', 'job type and location both on the file, from the call', deps);
                asked = benAskedSubjects(file, read.output);
                summary += `; job ${read.output.jobPhrase ?? read.output.jobType ?? 'unknown'}; asked for ${read.output.benAskedFor.map((a) => a.subject).join(', ') || 'nothing'}; callback ${read.output.callbackAgreed ? 'agreed' : 'no'}`;
            } else {
                log(`call reader: ${read.error}`);
                summary += `; reader error: ${read.error}`;
            }
        }

        if (outcome === 'answered_inbound') {
            ledgerAfterCall(file, asked, deps);
            return this.result(file, party.personId, runId, calls, { decision: 'none', factIds, summary, note: 'answered inbound call: no acknowledgement (checklist 3.5); the transcript and its facts are on the file' });
        }

        // A thread held for Ben stays with him; a call is his, not the desk's, to follow up.
        if (file.hold) return this.result(file, party.personId, runId, calls, { decision: 'hold', factIds, summary, note: `held for ${file.hold.approver.id} (${file.hold.reason}); no follow-up from the desk` });

        // The follow-up: a template, on WhatsApp if the number is on it, else its words on SMS, else email.
        const purpose: ReplyPurpose = outcome === 'missed' ? 'missed_call' : 'post_call_followup';
        const choice = chooseChannel(party, 'call', this.now());
        if (!choice.ok) {
            setHold(file, { approver: BEN, reason: `${purpose}: ${choice.reason}` }, deps);
            return this.result(file, party.personId, runId, calls, { decision: 'hold', factIds, summary, note: choice.reason });
        }
        const topic = (file.facts.slice().reverse().find((f) => f.key === 'job_phrase')?.value) ?? file.job.type ?? 'your job';
        let template: TemplateSend | null = null;
        let body: string;
        let window: WindowState;
        if (choice.channel === 'whatsapp') {
            window = windowOf(party, 'whatsapp', this.now());
            const pick = await pickTemplate(purpose, { name: party.name, topic }, this.deps.templates ?? liveTemplateStatus);
            const words = pick.ok ? null : await templateBodyFor(purpose, { name: party.name, topic });
            if (pick.ok) { template = pick.template; body = pick.body; }
            else if (window.state === 'open' && words) {
                // The customer wrote on WhatsApp within the day, so the window is open and the same words go as a plain message; the template is only needed on a shut window.
                body = words.body;
            } else {
                setHold(file, { approver: BEN, reason: `${purpose}: ${pick.ok ? '' : pick.reason}`, draft: words?.body ?? null }, deps);
                return this.result(file, party.personId, runId, calls, { decision: 'hold', channel: 'whatsapp', windowState: window.state, factIds, summary, note: `${pick.ok ? '' : pick.reason}; a call never opens the window, so nothing freeform can go` });
            }
        } else {
            window = { state: 'open', reason: `${choice.channel} has no window`, opensUntil: null };
            const words = await templateBodyFor(purpose, { name: party.name, topic });
            if (!words) {
                setHold(file, { approver: BEN, reason: `${purpose}: no template row for the purpose` }, deps);
                return this.result(file, party.personId, runId, calls, { decision: 'hold', channel: choice.channel, factIds, summary, note: 'no template row for the purpose' });
            }
            body = words.body;
        }
        const rendered = choice.channel === 'whatsapp' ? { ok: true as const, bubbles: [{ text: body, gapMs: 0 }] } : render(choice.channel, body, { name: party.name });
        if (!rendered.ok) return this.result(file, party.personId, runId, calls, { decision: 'none', channel: choice.channel, factIds, summary, note: `the template did not render for ${choice.channel}: ${rendered.reason}` });
        const guards = templateGuards();
        const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template, runId, approver: DESK_APPROVER, guards: { ok: true, guards, failures: [] }, factIds, kbIds: [], fixedLines: [], calls, mode: this.deps.mode ?? 'dry_run' }, { ...this.deps.sender, now: this.now, newId: this.deps.newId });
        if (!sent.ok) {
            setHold(file, { approver: BEN, reason: `${purpose}: send refused: ${sent.reason}`, draft: body }, deps);
            return this.result(file, party.personId, runId, calls, { decision: 'hold', channel: choice.channel, windowState: window.state, factIds, summary, note: `send refused: ${sent.reason}` });
        }
        ledgerAfterCall(file, asked, deps);
        return this.result(file, party.personId, runId, calls, {
            decision: 'send', channel: choice.channel, windowState: window.state, templateId: template?.name ?? null, bubbles: rendered.bubbles, factIds, guards, approver: DESK_APPROVER,
            delivered: true, landedTurnId: sent.record.turnId, summary: `${summary}; follow-up ${purpose} on ${choice.channel}${template ? ` (template ${template.name})` : ' (the template\'s words)'}`, note: null,
        });
    }
}
