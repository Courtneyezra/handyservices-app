/**
 * The channel gateway: the desk's one gateway (desk/gateway.ts) taking every channel's envelope,
 * not only WhatsApp's. Identity resolves the person on the channel's address with the turn's
 * hints, links a phone and an email the same turn proves belong together (the web form is the
 * join, Contract 1), opens or appends to the person's one open file, puts the addresses the turn
 * proves on the party's channels (a form's phone as SMS, its email; WhatsApp when the number is
 * known to be on it), records the adapter's facts with the turn as their source, keeps the email
 * thread on the email channel, then hands the turn to the desk. Nothing below the gateway changes.
 *
 * Whether a number is on WhatsApp comes from a `WhatsAppPresence` source. The sandbox door's is
 * the scenario seed alone; the live intake's reads the messages the business already holds.
 */
import { appendTurn, open, partyOf, recordFact, type CaseFile, type Turn } from '../desk/case-file';
import { Gateway, type GatewayDeps, type InboundOutcome, type SeedInput } from '../desk/gateway';
import { canonical, e164Of, type ResolveResult } from '../desk/identity';
import type { InboundEnvelope } from './envelope';

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

export class ChannelGateway extends Gateway {
    private readonly presence: WhatsAppPresence;

    constructor(deps: ChannelGatewayDeps) {
        super(deps);
        this.presence = deps.presence ?? unknownPresence;
    }

    /** Any channel's turn: identity, the one file, the party's reach, the adapter's facts, then the desk. */
    async inbound(env: InboundEnvelope, seed: ChannelSeed = {}): Promise<InboundOutcome> {
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
        const turnBody = { at: env.at, channel: env.channel, kind, body: env.text, media: env.media.map((m) => ({ id: m.id, kind: m.kind, mime: m.mime, path: m.path, url: m.url, description: null })) };
        let file: CaseFile | null = this.store.findOpenFor(resolved.personId);
        let landed: Turn;
        if (!file) {
            const opened = open({ identity: resolved, channel: env.channel, address, firstTurn: turnBody }, this.fileDeps());
            if (!opened.ok) return { kind: 'refused', reason: opened.reason };
            file = opened.value;
            landed = file.turns[0];
            this.applySeed(file, seed);
            this.store.put(file);
        } else {
            const party = partyOf(file, resolved.personId)!;
            if (!party.name && resolved.name) party.name = resolved.name;
            const appended = appendTurn(file, { ...turnBody, partyId: resolved.personId, direction: 'inbound', runId: null, approver: null }, this.fileDeps());
            if (!appended.ok) return { kind: 'refused', reason: appended.reason };
            landed = appended.value;
        }
        const party = partyOf(file, resolved.personId)!;

        // The party's reach: every address this turn proves, once each. A phone channel's own address counts as SMS reach.
        const reach = [...(env.reach ?? [])];
        if (env.channel === 'call' || env.channel === 'form') { const phone = e164Of(resolved.canonical); if (phone) reach.push({ kind: 'sms', address: phone }); }
        if (env.channel === 'sms') reach.push({ kind: 'sms', address });
        for (const r of reach) if (!party.channels.some((c) => c.kind === r.kind && c.address === r.address)) party.channels.push({ kind: r.kind, address: r.address, lastInboundAt: null });
        const phone = e164Of(resolved.canonical) ?? party.channels.find((c) => c.kind === 'sms')?.address ?? null;
        if (phone && !party.channels.some((c) => c.kind === 'whatsapp')) {
            const on = seed.whatsapp !== undefined ? seed.whatsapp : env.channel === 'whatsapp' ? true : await this.presence.knownOnWhatsApp(phone);
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

        // What the adapter established, with this turn as the source.
        for (const f of env.facts ?? []) {
            const rec = recordFact(file, { key: f.key, value: f.value, source: { kind: 'thread', turnId: landed.id }, by: `${env.channel}_adapter` }, this.fileDeps());
            if (!rec.ok) this.log(`intake fact ${f.key} refused: ${rec.reason}`);
        }

        const result = await this.desk.handleTurn(file, landed);
        return { kind: 'handled', file, turn: landed, result };
    }
}
