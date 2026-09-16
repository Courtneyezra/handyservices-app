/**
 * The channel gateway: the desk's one gateway (desk/gateway.ts) taking every channel's envelope,
 * not only WhatsApp's. Identity resolves the person on the channel's address with the turn's
 * hints, links a phone and an email the same turn proves belong together (the web form is the
 * join, Contract 1), opens or appends to the person's one open file, puts the addresses the turn
 * proves on the party's channels (a form's phone as SMS, its email; WhatsApp when the number is
 * known to be on it), records the adapter's facts with the turn as their source, keeps the email
 * thread on the email channel, then hands the turn to the desk. Nothing below the gateway changes.
 *
 * A call is passed once at hang-up and again once its transcript and summary land (intake.ts
 * `call_transcribed`). The second pass, and any repeat of the first, finds the turn the call
 * already made by its call id and fills it in (`attachCall`): no second turn, and the desk does not
 * reply, so nothing goes to the customer because a transcript arrived. A transcript that lands on a
 * call read at hang-up with nothing to read is read then, for facts and Ben's asks only.
 *
 * Whether a number is on WhatsApp comes from a `WhatsAppPresence` source. The sandbox door's is
 * the scenario seed alone; the live intake's reads the messages the business already holds.
 */
import { appendTurn, failedMediaFields, open, partyOf, recordFact, type CaseFile, type Turn } from '../desk/case-file';
import { Gateway, type GatewayDeps, type InboundOutcome, type SeedInput } from '../desk/gateway';
import { canonical, e164Of, type ResolveResult } from '../desk/identity';
import type { InboundEnvelope } from './envelope';
import { CALL_OUTCOME_KEY, CALL_SUMMARY_KEY, callOutcomeOnFile, hasTranscript } from './call-adapter';

export interface WhatsAppPresence {
    /** True when the number is known to be on WhatsApp, false when known not to be, null when nothing says. */
    knownOnWhatsApp(e164: string): Promise<boolean | null>;
}

export const unknownPresence: WhatsAppPresence = { async knownOnWhatsApp() { return null; } };

export interface ChannelSeed extends SeedInput {
    /** The number is known to be on WhatsApp (a channel with the window shut goes on the file). */
    whatsapp?: boolean;
}

export interface ChannelGatewayDeps extends GatewayDeps {
    presence?: WhatsAppPresence;
}

export interface InboundOptions {
    /** Only fill in a call turn already on a file; never open a file, add a turn or run the desk. */
    attachOnly?: boolean;
    /**
     * The delivery this turn comes from, recorded on the turn. A delivery already on any file adds
     * no second turn: its turn goes to the desk again only while the desk has not handled it
     * (`handAgain`), and is otherwise answered `duplicate`. One still being landed in this process
     * throws, so the caller keeps it and tries again later.
     */
    deliveryId?: string;
}

export class ChannelGateway extends Gateway {
    private readonly presence: WhatsAppPresence;
    /** Deliveries being landed in this process, so a second hand-over racing the first adds nothing. */
    private readonly landing = new Set<string>();

    constructor(deps: ChannelGatewayDeps) {
        super(deps);
        this.presence = deps.presence ?? unknownPresence;
    }

    /** Any channel's turn: identity, the one file, the party's reach, the adapter's facts, then the desk. */
    async inbound(env: InboundEnvelope, seed: ChannelSeed = {}, opts: InboundOptions = {}): Promise<InboundOutcome> {
        const deliveryId = opts.deliveryId;
        if (!deliveryId) return this.land(env, seed, opts);
        const held = this.deliveryTurn(deliveryId);
        if (held) {
            const result = await this.handAgain(held.file, held.turn);
            return result ? { kind: 'handled', ...held, result, burst: [held.turn.id] } : { kind: 'duplicate', ...held };
        }
        if (this.landing.has(deliveryId)) throw new Error('this delivery is being handed to the desk already');
        this.landing.add(deliveryId);
        try {
            return await this.land(env, seed, opts);
        } finally {
            this.landing.delete(deliveryId);
        }
    }

    private async land(env: InboundEnvelope, seed: ChannelSeed, opts: InboundOptions): Promise<InboundOutcome> {
        const callId = env.channel === 'call' && env.kind === 'call_transcript' ? env.providerMessageId : null;
        if (callId) {
            const held = this.callTurn(callId);
            if (held) return this.attachCall(held.file, held.turn, env);
        }
        if (opts.attachOnly) return { kind: 'refused', reason: 'no call turn on any file to attach this call to' };
        const resolved: ResolveResult = this.identity.resolve(env.channel, env.address, { name: env.name, email: env.hints?.email ?? null, phone: env.hints?.phone ?? null, postcode: env.hints?.postcode ?? null });
        if (!resolved.ok) {
            if (resolved.reason === 'candidates') { this.log(`identity: ${resolved.candidates.length} candidates for a ${env.channel} address; no reply`); return { kind: 'candidates', candidates: resolved.candidates.length, address: env.address }; }
            return { kind: 'refused', reason: resolved.detail };
        }
        if (resolved.role === 'internal') return { kind: 'refused', reason: 'an internal number is not a customer; nothing to scope' };

        // The join: a turn that gives a second key links it to the same person, with the turn as evidence.
        for (const raw of [env.hints?.email, env.hints?.phone]) {
            const key = canonical(raw);
            if (key && key !== resolved.canonical) {
                const linked = this.identity.link(resolved.canonical, key, `${env.channel} turn gave ${key.split(':')[0]} and ${resolved.canonical.split(':')[0]} together`);
                if (!linked.ok) this.log(`identity: link refused: ${linked.reason}`);
            }
        }

        const address = env.channel === 'email' ? resolved.canonical.replace(/^email:/, '') : (e164Of(resolved.canonical) ?? env.address);
        const kind: Turn['kind'] = env.kind ?? (env.media.length ? 'media' : 'text');
        const turnBody = { at: env.at, channel: env.channel, kind, body: env.text, media: env.media.map((m) => ({ id: m.id, kind: m.kind, mime: m.mime, path: m.path, url: m.url, description: null })), ...(callId ? { callId } : {}), ...(opts.deliveryId ? { deliveryId: opts.deliveryId } : {}), ...failedMediaFields(env.mediaFailures) };
        let file: CaseFile | null = this.store.findOpenFor(resolved.personId);
        let landed: Turn;
        if (!file) {
            const opened = open({ identity: resolved, channel: env.channel, address, firstTurn: turnBody }, this.fileDeps());
            if (!opened.ok) return { kind: 'refused', reason: opened.reason };
            file = opened.value;
            landed = file.turns[0];
            this.applySeed(file, seed);
            await this.reach(file, resolved, env, address, seed);
        } else {
            const party = partyOf(file, resolved.personId)!;
            if (!party.name && resolved.name) party.name = resolved.name;
            await this.reach(file, resolved, env, address, seed);
            const appended = appendTurn(file, { ...turnBody, partyId: resolved.personId, direction: 'inbound', runId: null, approver: null }, this.fileDeps());
            if (!appended.ok) return { kind: 'refused', reason: appended.reason };
            landed = appended.value;
        }

        // What the adapter established, with this turn as the source.
        for (const f of env.facts ?? []) {
            const rec = recordFact(file, { key: f.key, value: f.value, source: { kind: 'thread', turnId: landed.id }, by: `${env.channel}_adapter` }, this.fileDeps());
            if (!rec.ok) this.log(`intake fact ${f.key} refused: ${rec.reason}`);
        }

        const { result, burst } = await this.handTurn(file, landed);
        return { kind: 'handled', file, turn: landed, result, burst };
    }

    /** The turn a delivery already landed, on whichever file holds it, done files included. */
    private deliveryTurn(deliveryId: string): { file: CaseFile; turn: Turn } | null {
        for (const file of this.store.all()) {
            const turn = file.turns.find((t) => t.deliveryId === deliveryId);
            if (turn) return { file, turn };
        }
        return null;
    }

    /** The turn a call already made, on whichever file holds it, done files included. */
    private callTurn(callId: string): { file: CaseFile; turn: Turn } | null {
        for (const file of this.store.all()) {
            const turn = file.turns.find((t) => t.callId === callId);
            if (turn) return { file, turn };
        }
        return null;
    }

    /**
     * The call's turn filled in from a later pass. The body takes the new transcript only when the
     * pass has one and reads the call the same way the turn does (a missed call keeps its line); the
     * summary goes on as a fact sourced to the turn when it is new. A pass with nothing more leaves
     * the turn as it was. The desk does not reply; a transcript filling in a turn that had none is
     * read for facts (`readLateTranscript`), in its turn with any desk pass on the file, so the
     * job, the location and what Ben asked for on the phone reach the file as they would have had the
     * transcript been there at hang-up.
     */
    private async attachCall(file: CaseFile, turn: Turn, env: InboundEnvelope): Promise<InboundOutcome> {
        let changed = false;
        const outcome = callOutcomeOnFile(file, turn);
        const passOutcome = env.facts?.find((f) => f.key === CALL_OUTCOME_KEY)?.value;
        let transcribed = false;
        if (outcome !== 'missed' && passOutcome === outcome && hasTranscript({ ...turn, body: env.text }) && env.text !== turn.body) {
            transcribed = !hasTranscript(turn);
            turn.body = env.text;
            changed = true;
        }
        const summary = env.facts?.find((f) => f.key === CALL_SUMMARY_KEY)?.value.trim();
        if (summary) {
            const had = [...file.facts].reverse().find((f) => f.key === CALL_SUMMARY_KEY && f.source.kind === 'thread' && f.source.turnId === turn.id);
            if (had?.value !== summary) {
                const rec = recordFact(file, { key: CALL_SUMMARY_KEY, value: summary, source: { kind: 'thread', turnId: turn.id }, by: `${env.channel}_adapter` }, this.fileDeps());
                if (rec.ok) changed = true;
                else this.log(`call summary refused: ${rec.reason}`);
            }
        }
        if (changed) this.store.put(file);
        // The call was read at hang-up with nothing to read: its transcript is read now, for facts only.
        const read = transcribed && this.desk.readLateTranscript
            ? await this.deskPass(file, (f) => this.desk.readLateTranscript!(f, turn)).catch((err) => { this.log(`late call read on case ${file.id} failed: ${err?.message ?? err}`); return []; })
            : [];
        this.log(`call turn ${turn.id} on case ${file.id}: ${changed ? 'filled in' : 'nothing new'}${transcribed ? `; transcript read, ${read.length} facts` : ''}; no reply`);
        return { kind: 'attached', file, turn, changed };
    }

    /**
     * The party's reach: every address this turn proves, once each. A phone channel's own address
     * counts as SMS reach, and a WhatsApp turn proves the number it came from, so the WhatsApp
     * channel carries that number and not whichever address the party already had. It runs before
     * the turn lands, so the window the turn opens is recorded on a channel that is already right.
     */
    private async reach(file: CaseFile, resolved: Extract<ResolveResult, { ok: true }>, env: InboundEnvelope, address: string, seed: ChannelSeed): Promise<void> {
        const party = partyOf(file, resolved.personId)!;
        const reach = [...(env.reach ?? [])];
        if (env.channel === 'call' || env.channel === 'form') { const p = e164Of(resolved.canonical); if (p) reach.push({ kind: 'sms', address: p }); }
        if (env.channel === 'sms') reach.push({ kind: 'sms', address });
        if (env.channel === 'whatsapp') reach.push({ kind: 'whatsapp', address });
        if (env.channel === 'email') reach.push({ kind: 'email', address });
        for (const r of reach) if (!party.channels.some((c) => c.kind === r.kind && c.address === r.address)) party.channels.push({ kind: r.kind, address: r.address, lastInboundAt: null });
        const phone = e164Of(resolved.canonical) ?? party.channels.find((c) => c.kind === 'sms')?.address ?? null;
        if (phone && !party.channels.some((c) => c.kind === 'whatsapp')) {
            const on = seed.whatsapp !== undefined ? seed.whatsapp : await this.presence.knownOnWhatsApp(phone);
            if (on) party.channels.push({ kind: 'whatsapp', address: phone, lastInboundAt: null });
        }
        if (env.channel === 'whatsapp' && (env.via === 'twilio' || env.via === 'meta')) {
            const ch = party.channels.find((c) => c.kind === 'whatsapp');
            if (ch) ch.transport = env.via;
        }
        if (env.channel === 'email') {
            const ch = party.channels.find((c) => c.kind === 'email');
            if (ch && env.email) {
                const prev = ch.thread ?? null;
                ch.thread = { subject: prev?.subject ?? env.email.subject, messageId: env.email.messageId ?? prev?.messageId ?? null, references: Array.from(new Set([...(prev?.references ?? []), ...env.email.references])) };
            }
        }
    }
}
