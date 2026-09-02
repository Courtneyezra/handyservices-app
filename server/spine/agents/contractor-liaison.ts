/**
 * Contractor liaison (Phase 4 / C; design §3.4 `contractor.default`, §3.5, §7). Tier DRAFT.
 *
 * The one agent that talks to OUR tradespeople, never to a customer: job briefs, availability
 * asks, confirming receipt of their photos/notes, materials lists. It reads the contractor case
 * context (assigned bookings, reduced to postcode + first name + the work) and the thread, and
 * proposes at most one reply through the same belt shape as the Scoper: `propose_reply` refuses
 * customer PII (phone, email, full name + address) and voice breaches at the tool; `flag` hands
 * anything odd to Ben. Ships dark: it only runs when the spine runner lanes a contractor-audience
 * thread here, and the spine is behind app_settings `spine` (default off).
 *
 * Data precondition: the lane cannot light up until the 8 contractor users have real phones
 * (server/roles.ts resolves audience from the number).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runAgent as defaultRunAgent, type AgentRunResult, type AgentTool } from '../../agents/runner';
import { SCOPER_MODEL } from '../../llm';
import { chatVoiceViolations } from '@shared/chat-voice';
import { detectCustomerPii } from '../guards';
import { loadContractorContext, renderContractorContext, type ContractorContext, type ContractorContextLoader } from '../contractor-case';
import type { Approver } from '../../approver';
import type { CaseFile, ExceptionKind, Intent, PolicyPack, Proposal, SpineAgent, TriageResult, Trigger } from '../types';

export const LIAISON_NAME = 'contractor_liaison' as const;
export const LIAISON_APPROVER: Approver = 'agent.contractor_liaison' as Approver;
export const LIAISON_INTENTS: readonly Intent[] = ['job_brief', 'availability_ask', 'confirm_receipt', 'materials_list'];
export const LIAISON_EXCEPTIONS: readonly ExceptionKind[] = ['complaint', 'trust_concern', 'out_of_scope', 'callback_requested'];
const MAX_BUBBLES = 3;
const MAX_WORDS_PER_BUBBLE = 40;
const MAX_TIMELINE_ITEMS = 30;

export const LIAISON_CORE = `You are Handy Services' contractor liaison: the office texting one of OUR tradespeople on WhatsApp. You are not talking to a customer and you never will from this thread.

What you may do: send a job brief (what, where by POSTCODE only, when, what to bring), ask for their availability for a job we have to place, confirm you have their photos/notes/invoice, or send the materials list for a job. That is the whole vocabulary.

Hard rules, refused at the tool if you break them:
- NEVER put a customer's phone number, email, or full name with a street address in a message. Postcode only. A first name is fine. The full address travels on the job sheet after the deposit, not in chat.
- NEVER quote the customer's price. The contractor's payout is fine when the brief carries it.
- One question per message. Short bursts. UK English. No em dashes. Sign off "Thanks / Handy Services" or not at all — you are the office, not Ben.
- If they raise a complaint about a customer, a safety worry, money owed to them, or anything outside these four intents: flag it for Ben with a proper note and propose nothing, or propose only the neutral half.

Read the case file, decide, act with the tools, then stop.`;

function loadVoice(pack: PolicyPack): string {
    const file = pack.voiceFile || 'whatsapp-comms.md';
    try {
        return readFileSync(path.join(process.cwd(), 'brand-voice', path.basename(file)), 'utf8').trim();
    } catch {
        return 'VOICE: plain, warm, short. No em dashes. One question max.';
    }
}

export function buildLiaisonSystem(pack: PolicyPack, deps: { core?: string; voice?: string } = {}): string {
    return [
        deps.core ?? LIAISON_CORE,
        `INTENTS YOU MAY PROPOSE in this pack (${pack.id} v${pack.version}): ${pack.allowedIntents.join(', ')}. Any other intent is refused at the tool.`,
        `EXCEPTIONS THAT GO TO BEN: ${pack.exceptionsToBen.join(', ')}.`,
        `VOICE (the house style; you speak as the office, not as Ben):\n${deps.voice ?? loadVoice(pack)}`,
    ].join('\n\n');
}

export function promptHashOf(system: string): string {
    return createHash('sha256').update(system).digest('hex').slice(0, 24);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function renderLiaisonCaseFile(cf: CaseFile, triage: TriageResult, ctx: ContractorContext, trigger?: string): string {
    return [
        `CASE FILE for contractor thread ${cf.conversationId} (built ${cf.builtAt}, ref ${cf.hash.slice(0, 12)})`,
        `Trigger: ${trigger ?? 'inbound_message'}. Triage: lane ${triage.lane}, exceptions [${triage.exceptions.join(', ') || 'none'}].`,
        `Audience: ${cf.audience}. Channel: ${cf.window.channelLastUsed}. WhatsApp window: ${cf.window.canFreeform ? 'OPEN' : 'SHUT (template or SMS only)'}.`,
        renderContractorContext(ctx, cf),
        `Tags: [${cf.tags.join(', ') || 'none'}].`,
        cf.openFlags.length ? `Open flags for Ben: ${cf.openFlags.map((f) => `${f.exception}: ${clip(f.note, 120)}`).join('; ')}.` : 'Open flags: none.',
        '',
        `TIMELINE (oldest first, last ${Math.min(cf.timeline.length, MAX_TIMELINE_ITEMS)} of ${cf.timeline.length}):`,
        ...cf.timeline.slice(-MAX_TIMELINE_ITEMS).map((t) => `${t.at} ${t.kind}${t.by ? ` (${t.by})` : ''}: ${clip((t.body ?? t.transcript ?? '').replace(/\s+/g, ' '), 400)}`),
        '',
        'Decide, act with the tools, then stop.',
    ].join('\n');
}

export function normaliseBody(body: unknown): string[] {
    const raw: string[] = Array.isArray(body) ? body.map((b) => String(b ?? '')) : String(body ?? '').split(/\n\s*---\s*\n/);
    return raw.map((b) => b.trim()).filter(Boolean);
}

/** Every refusal the tool applies to a proposed contractor message. Pure. */
export function checkLiaisonBody(bubbles: string[]): string | null {
    if (!bubbles.length) return 'body is empty. Give 1 to 3 short bubbles.';
    if (bubbles.length > MAX_BUBBLES) return `body has ${bubbles.length} bubbles; the maximum is ${MAX_BUBBLES}.`;
    for (const b of bubbles) {
        const words = b.split(/\s+/).length;
        if (words > MAX_WORDS_PER_BUBBLE) return `a bubble runs to ${words} words ("${clip(b, 60)}"). Keep each under ${MAX_WORDS_PER_BUBBLE}.`;
    }
    const joined = bubbles.join('\n---\n');
    const pii = detectCustomerPii(joined);
    if (pii) return `customer_pii: this message carries the ${pii}. Postcode and first name only; the full address goes on the job sheet. Rewrite without it.`;
    const voice = chatVoiceViolations(joined);
    if (voice.length) return `chat voice: ${voice.join(', ')}. No em dashes, no hyphens as punctuation.`;
    if ((joined.match(/\?/g) ?? []).length > 1) return 'more than one question. One ask per message.';
    return null;
}

export interface LiaisonDeps {
    runAgent?: typeof defaultRunAgent;
    loadContext?: ContractorContextLoader;
    persist?: boolean;
    model?: string;
    now?: () => Date;
}

interface BeltState { proposal: Proposal | null; flag: Proposal['flag']; ended: boolean }

export function buildLiaisonTools(input: { pack: PolicyPack; state: BeltState }): AgentTool[] {
    const { pack, state } = input;
    const ensureOpen = () => { if (state.ended) throw new Error('This run has ended: propose_reply was already called. Reply with one line and stop.'); };
    return [
        {
            name: 'propose_reply',
            description: `The message to the contractor, as a proposal. ONE call ends your run. body is 1 to 3 short bubbles. intent must be one of: ${pack.allowedIntents.join(', ')}. Postcode only, first name only, never a customer phone/email/full address: the tool refuses them. reasons: one or two lines for the human who reviews it.`,
            input_schema: {
                type: 'object' as const,
                properties: {
                    intent: { type: 'string', enum: [...pack.allowedIntents] },
                    body: { type: 'array', items: { type: 'string' } },
                    reasons: { type: 'array', items: { type: 'string' } },
                    citations: { type: 'array', items: { type: 'string' } },
                },
                required: ['intent', 'body', 'reasons'],
            },
            run: async (i: { intent: string; body: unknown; reasons?: unknown; citations?: unknown }) => {
                ensureOpen();
                const intent = String(i.intent ?? '') as Intent;
                if (!pack.allowedIntents.includes(intent)) throw new Error(`intent "${intent}" is not in this pack. Allowed: ${pack.allowedIntents.join(', ')}.`);
                const bubbles = normaliseBody(i.body);
                const refusal = checkLiaisonBody(bubbles);
                if (refusal) throw new Error(`Refused: ${refusal} Rewrite and call propose_reply again.`);
                const reasons = Array.isArray(i.reasons) ? i.reasons.map(String).filter(Boolean) : [];
                if (!reasons.length) throw new Error('reasons is required: one line on why this message, why now.');
                const citations = Array.isArray(i.citations) ? i.citations.map(String).filter(Boolean) : undefined;
                state.proposal = { intent, body: bubbles, reasons, ...(citations?.length ? { citations } : {}) };
                state.ended = true;
                return { recorded: true, note: 'Proposal recorded; the spine decides. Reply with one line and stop.' };
            },
        },
        {
            name: 'flag',
            description: `Hand this thread to Ben. exception is one of: ${LIAISON_EXCEPTIONS.join(', ')}. Use it for a complaint about a customer or a job, a safety worry, money the contractor says they are owed, or anything outside the four intents. note is the whole briefing Ben reads on his phone.`,
            input_schema: { type: 'object' as const, properties: { exception: { type: 'string', enum: [...LIAISON_EXCEPTIONS] }, note: { type: 'string' } }, required: ['exception', 'note'] },
            run: async (i: { exception: string; note: string }) => {
                const exception = String(i.exception ?? '') as ExceptionKind;
                if (!LIAISON_EXCEPTIONS.includes(exception)) throw new Error(`exception must be one of ${LIAISON_EXCEPTIONS.join(', ')}.`);
                const note = clip(String(i.note ?? ''), 1200);
                if (note.length < 10) throw new Error('note is too short to brief Ben. Two or three sentences.');
                state.flag = { exception, note };
                return { flagged: true, note: 'Flag recorded. Propose the neutral half of a reply, or stop if silence is right.' };
            },
        },
    ];
}

export function liaisonAccepts(input: { caseFile: CaseFile; triage: TriageResult; trigger: Trigger }): boolean {
    return input.triage.audience === 'contractor';
}

export function createContractorLiaisonAgent(deps: LiaisonDeps = {}): SpineAgent & { deps: LiaisonDeps } {
    const run = deps.runAgent ?? defaultRunAgent;
    const loadContext = deps.loadContext ?? loadContractorContext;
    return {
        name: LIAISON_NAME,
        tier: 'DRAFT',
        deps,
        accepts: liaisonAccepts,
        async run({ caseFile, pack, triage, runId }): Promise<Proposal | null> {
            if (triage.audience !== 'contractor' || caseFile.audience !== 'contractor') return null;
            if (pack.audience !== 'contractor' || !pack.allowedIntents.length) return null;
            if (caseFile.tags.includes('opted_out') || caseFile.tags.includes('do_not_contact')) return null;

            let ctx: ContractorContext = { contractor: null, jobs: [] };
            try { ctx = await loadContext(caseFile.phone); } catch (e: any) { console.warn('[Liaison] contractor context failed (thread only):', e?.message ?? e); }

            const state: BeltState = { proposal: null, flag: null, ended: false };
            const system = buildLiaisonSystem(pack);
            const tools = buildLiaisonTools({ pack, state });
            const goal = renderLiaisonCaseFile(caseFile, triage, ctx);

            let result: AgentRunResult | null = null;
            try {
                result = await run({
                    name: LIAISON_NAME, system, goal, tools,
                    model: deps.model ?? SCOPER_MODEL, maxTurns: 5, maxTokens: 3000,
                    runId, trigger: 'spine', conversationId: caseFile.conversationId, phone: caseFile.phone,
                    packId: pack.id, packVersion: pack.version, caseFileRef: caseFile.hash, promptHash: promptHashOf(system),
                    persist: deps.persist ?? true,
                });
            } catch (error: any) {
                console.error(`[Liaison] run ${runId} failed on ${caseFile.conversationId}:`, error?.message ?? error);
            }

            const forBen = triage.exceptions.filter((e) => pack.exceptionsToBen.includes(e));
            if (forBen.length && !state.flag) state.flag = { exception: forBen[0], note: `Triage: ${triage.reasons.join('; ') || forBen.join(', ')}` };

            if (state.proposal) return { ...state.proposal, ...(state.flag ? { flag: state.flag } : {}) };
            if (state.flag) return { intent: 'confirm_receipt', body: [], reasons: [`flag only: ${state.flag.exception}`, ...(result ? [clip(result.finalText, 200)] : [])], flag: state.flag };
            return null;
        },
    };
}

export const contractorLiaisonAgent = createContractorLiaisonAgent();
