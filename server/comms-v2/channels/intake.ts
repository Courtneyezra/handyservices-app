/**
 * The old inputs connected to the new plumbing, behind one switch (behaviour.md answer 37).
 *
 * `COMMS_V2_INTAKE` is read the way `COMMS_WORKER` is (server/worker-gate.ts): exactly '1' is on,
 * anything else is off. Off: nothing here runs and nothing old changes. On: each old inbound entry
 * point (the Twilio webhook for WhatsApp and SMS, the Meta WhatsApp webhook, the web form, a
 * finished call, and Resend's inbound email webhook behind its own switch, email-inbound.ts) also forwards its raw event here, where the matching adapter builds the gateway's
 * envelope and the channel gateway hands the turn to the desk. The old handler still runs today.
 * The desk here runs in dry run: it does everything up to delivery, nothing leaves. The cutover
 * that turns the old handler off and this desk's delivery on is a later task.
 *
 * The switch alone does not start the intake: `INTAKE_REQUIREMENTS` below is what the intake must
 * have before it reads one live turn, and until every one of them is met the gateway refuses to be
 * built and every forward says so. Fail closed on purpose. The case files it opens are kept in the
 * durable store (desk/database-store.ts), read in full when the gateway is built, so a restart or a
 * redeploy loses no thread. Its identity is told which numbers are ours when it is built
 * (`seedInternalNumbers`), so Ben's handset, staff and the business's own lines resolve internal and
 * the gateway refuses them before a case file opens.
 *
 * A call is forwarded twice: `call_finished` at hang-up, before the batch transcription has run, and
 * `call_transcribed` once the transcript and job summary are on the row (twilio-realtime.ts). The
 * second only fills in the turn the first made (channel-gateway.ts `attachCall`): it never opens a
 * file, adds a turn or runs the desk.
 *
 * `forwardToCommsV2` never throws and never blocks: an old handler's response does not wait on
 * the new desk, and a failure here is one log line. No value from an event is logged, only the
 * case id and the decision.
 */
import type { InboundEnvelope } from './envelope';
import type { Identity } from '../desk/identity';
import type { RecordTurnDeps, TurnReport } from '../desk/model-health';
import type { NonCustomerReason } from '../../internal-numbers';

export const INTAKE_ENV = 'COMMS_V2_INTAKE';

export function intakeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return (env[INTAKE_ENV] ?? '').trim() === '1';
}

/**
 * What the intake must have before it may read a live turn, each outstanding. A line is deleted
 * here by the task that satisfies it, and the intake starts when the list is empty.
 */
export const INTAKE_REQUIREMENTS: readonly string[] = [];

export type IntakeEvent =
    | { kind: 'twilio_incoming'; body: Record<string, unknown> }
    | { kind: 'meta_webhook'; payload: unknown }
    | { kind: 'web_form'; lead: { customerName?: string | null; phone?: string | null; email?: string | null; jobDescription?: string | null; postcode?: string | null; address?: string | null; source?: string | null; leadId?: string | null; photos?: Array<{ contentBase64?: string | null; mime?: string | null }> } }
    | { kind: 'call_finished'; callRecordId: string }
    | { kind: 'call_transcribed'; callRecordId: string }
    /**
     * A received email, already read from Resend by the inbound email webhook (email-inbound.ts) and
     * kept until the desk has it (inbound-email-store.ts). `deliveryId` goes on the turn, so the same
     * email handed over again lands no second turn.
     */
    | { kind: 'email_received'; envelope: InboundEnvelope; deliveryId?: string };

/** `attached` is on a call's report only: the turns a call already had that this forward filled in. */
export interface IntakeReport { forwarded: number; attached?: number; skipped: string[] }

type Purpose = import('../live-database').DatabasePurpose;
type GatewayT = import('./channel-gateway').ChannelGateway;

/**
 * How the intake's desk delivers, by the purpose its store and tools were built for. The live desk
 * delivers: its sends go through the one outbound send under `agent.comms_v2`, and the old desk's
 * automatic senders are refused at that same moment (server/comms-v2/old-desk.ts), because both
 * follow `commsV2Live()`. The sandbox purpose never delivers.
 */
export const INTAKE_DESK_MODE: Record<Purpose, 'dry_run' | 'live'> = { sandbox: 'dry_run', live: 'live' };

/** Said once per process: every switch is on but this is not the comms worker, so nothing here is the live desk. */
let warnedNotWorker = false;

/** The gateway in use: the purpose it was built for (`any` is a scripted one from a test), and the gateway once built. */
let live: { purpose: Purpose | 'any'; gateway: Promise<GatewayT>; ready: GatewayT | null } | null = null;

export interface IntakeGatewayDeps {
    /** The switches, read now (switch.ts). */
    liveState?: () => Promise<{ live: boolean; off: string[] }>;
    /** Builds a gateway for a purpose; the default is the durable one below. */
    build?: (purpose: Purpose) => Promise<GatewayT>;
    /** What must land before the intake reads a live turn; `INTAKE_REQUIREMENTS` unless a test says otherwise. */
    requirements?: readonly string[];
}

/**
 * The one intake gateway, built on first use for the purpose the switches give now: `live` while the
 * new desk is the live desk (switch.ts `commsV2Live`), its store and tools on the database in use,
 * and `sandbox` otherwise, on the branch COMMS_V2_DATABASE_URL names as before (live-database.ts).
 * The switches are read on every call, and a gateway built for the other purpose is set aside for a
 * new one, so flipping a switch back is felt on the next forward; the store it had keeps retrying
 * its unwritten files and lands them if the switches come back.
 *
 * Refuses while any of `INTAKE_REQUIREMENTS` is outstanding, so a switch flipped before they land
 * forwards nothing and says what is missing. Its case files are the durable store's, read in full
 * before the first turn, and its identity is rebuilt from the parties on them. A build that fails is
 * forgotten, so the next forward tries again rather than repeating a passing failure for the life
 * of the process.
 */
export async function liveChannelGateway(deps: IntakeGatewayDeps = {}): Promise<GatewayT> {
    return (await intakeGateway(deps)).gateway;
}

/** The intake gateway with the purpose of the entry that supplied it, so a caller never pairs one gateway with another's purpose. */
async function intakeGateway(deps: IntakeGatewayDeps): Promise<{ purpose: Purpose | 'any'; gateway: GatewayT }> {
    const readState = deps.liveState ?? (async () => (await import('../switch')).commsV2LiveState());
    const state = await readState();
    const purpose: Purpose = state.live ? 'live' : 'sandbox';
    if (!state.live && state.off.length === 1 && /COMMS_WORKER/.test(state.off[0]) && !warnedNotWorker) {
        warnedNotWorker = true;
        console.warn('[comms-v2 intake] every switch for the live desk is on, but this process is not the comms worker (COMMS_WORKER=1), where the desk\'s clock runs: the live gateway is not built here and nothing is delivered from this process');
    }
    // Checked and set with no await between them, so two forwards arriving together share one build.
    if (live && (live.purpose === 'any' || live.purpose === purpose)) { const shared = live; return { purpose: shared.purpose, gateway: await shared.gateway }; }
    if (live) console.log(`[comms-v2 intake] the switches changed: the ${live.purpose} gateway is set aside and a ${purpose} one is built${state.live ? '' : ` (off: ${state.off.join('; ')})`}`);
    const build = deps.build ?? buildIntakeGateway;
    const requirements = deps.requirements ?? INTAKE_REQUIREMENTS;
    const building = (async () => {
        if (requirements.length) throw new Error(`${INTAKE_ENV} is on but the intake refuses to start until it has: ${requirements.join('; ')}`);
        return build(purpose);
    })();
    const entry: NonNullable<typeof live> = { purpose, gateway: building, ready: null };
    live = entry;
    building.then((g) => { entry.ready = g; }, () => { if (live === entry) live = null; });
    return { purpose, gateway: await building };
}

/** The durable gateway for a purpose: the case file store, the quote store, the draft chain and the diary all open the database that purpose allows. */
async function buildIntakeGateway(purpose: Purpose): Promise<GatewayT> {
    const { ChannelGateway } = await import('./channel-gateway');
    const { ChannelDesk } = await import('./channel-desk');
    const { Desk } = await import('../desk/desk');
    const { caseFileRowsFor, identityFromCaseFiles, openCaseFileStore } = await import('../desk/database-store');
    const { databaseQuoteStore } = await import('../quoting/quote-store');
    const { chainDrafter } = await import('../quoting/draft-quote');
    const { databaseDiary } = await import('../scheduling/diary');
    const { chaseStateFromEnv } = await import('../service/chase');
    const log = (line: string) => console.log(`[comms-v2 intake] ${line}`);
    const store = await openCaseFileStore({ log }, caseFileRowsFor(purpose));
    const identity = identityFromCaseFiles(store.all());
    const seeded = await seedInternalNumbers(identity);
    log(`identity: ${seeded.registered} internal keys registered${seeded.refused ? `; ${seeded.refused} refused because a case file already holds them as a customer` : ''}`);
    const quotes = databaseQuoteStore(purpose);
    const mode = INTAKE_DESK_MODE[purpose];
    // Ben's quote notifications go to his phone only from the live desk, and only while it is live (quoting/ben-notifier.ts).
    const notifier = purpose === 'live' ? (await import('../quoting/ben-notifier')).liveBenNotifier() : undefined;
    const modelHealth = await intakeModelHealth(purpose);
    // The quote is drafted off the reply path, and the store is where a finished draft is put (quoting/background-draft.ts).
    const desk = new Desk({ mode, log, persist: (file) => { store.put(file); return store.flush(); }, ...(modelHealth ? { modelHealth } : {}), quoting: { store: quotes, drafter: chainDrafter(quotes, purpose), ...(notifier ? { notifier } : {}) }, scheduling: { diary: databaseDiary(purpose) }, service: { chase: chaseStateFromEnv() } });
    log(`gateway built for the ${purpose} desk (${mode === 'live' ? 'live delivery' : 'dry run'})`);
    const { CUSTOMER_TURN_QUIET_MS } = await import('../desk/turn-window');
    return new ChannelGateway({ desk: new ChannelDesk(desk, { mode, log }), identity, store, presence: messagesPresence, log, quietMs: CUSTOMER_TURN_QUIET_MS });
}

/**
 * What the intake's desk does with each customer turn's model verdict (desk/model-health.ts): only the
 * live desk records it, pages and moves the health read, since only it answers customers; a sandbox
 * desk answers none and never writes production (live-database.ts).
 */
export async function intakeModelHealth(purpose: Purpose, deps: RecordTurnDeps = {}): Promise<((report: TurnReport) => Promise<unknown>) | undefined> {
    if (purpose !== 'live') return undefined;
    const { recordTurnModelHealth } = await import('../desk/model-health');
    return (report) => recordTurnModelHealth(report, deps);
}

/** The intake gateway where one is already built, with the purpose it was built for; never builds one. */
export function builtIntakeGateway(): { purpose: Purpose | 'any'; gateway: GatewayT } | null {
    return live?.ready ? { purpose: live.purpose, gateway: live.ready } : null;
}

/** A number that is ours, keyed the way server/internal-numbers.ts keys it (commsPhoneKey: national digits, no leading 0), with why. */
export type InternalNumbers = Map<string, NonCustomerReason>;

/**
 * Every number that is ours, from server/internal-numbers.ts, the one list: the business's own
 * lines, the numbers placed in the INTERNAL_PHONE_NUMBERS environment variable (Ben's handset and
 * any staff number the database does not hold; never committed), and the staff and contractor
 * numbers in the database. Throws when the database cannot be read, so the build refuses rather
 * than starting on a partial list.
 */
export async function readInternalNumbers(): Promise<InternalNumbers> {
    const { internalNumberKeys } = await import('../../internal-numbers');
    return internalNumberKeys();
}

/**
 * Tells the identity which numbers are ours, once per gateway build. An internal key resolves
 * internal ahead of every other role, and the gateway refuses an internal turn before a case file
 * opens. The list's keys are commsPhoneKey digits; the identity's are `canonical` keys, which spell
 * a UK landline differently when it arrives as +44 and as 0, so each number is registered under
 * both spellings. A key a loaded case file already holds as a customer is refused by
 * `registerInternal` and counted; no value is logged.
 */
export async function seedInternalNumbers(identity: Identity, read: () => Promise<InternalNumbers> = readInternalNumbers): Promise<{ registered: number; refused: number }> {
    const { e164FromCommsKey } = await import('../../phone-utils');
    const { canonical } = await import('../desk/identity');
    let registered = 0;
    let refused = 0;
    for (const [key, reason] of Array.from(await read())) {
        const spellings = new Set([canonical(e164FromCommsKey(key)), /^[1237]\d{9}$/.test(key) ? canonical(`0${key}`) : null]);
        for (const spelling of Array.from(spellings)) {
            if (!spelling) continue;
            if (identity.registerInternal(spelling, reason.detail).ok) registered++;
            else refused++;
        }
    }
    return { registered, refused };
}

/** Whether a number is on WhatsApp, from the messages the business already holds: an inbound WhatsApp message from it. */
export const messagesPresence: import('./channel-gateway').WhatsAppPresence = {
    async knownOnWhatsApp(e164) {
        try {
            const { db } = await import('../../db');
            const { conversations, messages } = await import('@shared/schema');
            const { and, eq, sql } = await import('drizzle-orm');
            const digits = e164.replace(/\D/g, '');
            const rows = await db.select({ id: messages.id }).from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
                .where(and(eq(messages.direction, 'inbound'), eq(messages.channel, 'whatsapp'), sql`${conversations.phoneNumber} like ${`${digits}%`}`)).limit(1);
            return rows.length > 0 ? true : null;
        } catch {
            return null;
        }
    },
};

/** Every envelope an event yields; the adapters do the work. Exported so the switch-off and the shapes are testable without a desk. */
export async function envelopesOf(event: IntakeEvent, deps: { fetch?: typeof fetch; mediaDir?: string } = {}): Promise<{ envelopes: InboundEnvelope[]; skipped: string[] }> {
    const skipped: string[] = [];
    switch (event.kind) {
        case 'twilio_incoming': {
            const { isTwilioSms, fromTwilioSms } = await import('./sms-adapter');
            if (isTwilioSms(event.body)) return { envelopes: [fromTwilioSms(event.body as any)], skipped };
            const { fromTwilio } = await import('../desk/whatsapp-adapter');
            return { envelopes: [await fromTwilio(event.body as any, { fetch: deps.fetch, mediaDir: deps.mediaDir })], skipped };
        }
        case 'meta_webhook': {
            const { fromMeta } = await import('../desk/whatsapp-adapter');
            return { envelopes: await fromMeta(event.payload as any, { fetch: deps.fetch, mediaDir: deps.mediaDir }), skipped };
        }
        case 'web_form': {
            const { fromWebForm } = await import('./form-adapter');
            return { envelopes: [await fromWebForm(event.lead, { mediaDir: deps.mediaDir })], skipped };
        }
        case 'call_finished':
        case 'call_transcribed': {
            const { db } = await import('../../db');
            const { calls } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');
            const [call] = await db.select().from(calls).where(eq(calls.id, event.callRecordId)).limit(1);
            if (!call) { skipped.push('no call record'); return { envelopes: [], skipped }; }
            const { describeCall, nonFillerSummary } = await import('../../call-thread');
            const info = describeCall(call as any);
            const { fromFinishedCall } = await import('./call-adapter');
            const env = fromFinishedCall({ phone: call.phoneNumber, name: call.customerName, direction: info.direction, missed: info.missed, transcript: call.transcription, durationSeconds: call.duration, at: (call.endTime ?? call.startTime)?.toISOString() ?? null, jobSummary: nonFillerSummary(call.jobSummary), callId: call.id });
            if (!env) skipped.push('an unanswered outbound call is recorded on the call row only');
            return { envelopes: env ? [env] : [], skipped };
        }
        case 'email_received':
            return { envelopes: [event.envelope], skipped };
    }
}

/** Forward one old-input event into the new desk. Fire and forget: returns at once, never throws. */
export function forwardToCommsV2(event: IntakeEvent, env: NodeJS.ProcessEnv = process.env): void {
    if (!intakeEnabled(env)) return;
    void forwardNow(event).catch((err) => console.error(`[comms-v2 intake] ${event.kind} failed: ${err?.message ?? err}`));
}

/** The label for a decision log line, from the purpose the gateway now in use was built for: never a fixed word, so a mode change is felt here too. */
export function deliveryLabelFor(purpose: Purpose | 'any' | undefined): string {
    return purpose && purpose !== 'any' && INTAKE_DESK_MODE[purpose] === 'live' ? 'live delivery' : 'dry run';
}

/** Each call's forwards, one after another, so a transcript read after hang-up never lands before the hang-up's own turn. */
const callForwards = new Map<string, Promise<unknown>>();

/**
 * The same forward, awaited: it throws when the desk did not take the event. The inbound email
 * store hands its rows over through this, and an event carrying a delivery id resolves only once the
 * case file store has written the file.
 */
export function forwardNow(event: IntakeEvent, deps: IntakeGatewayDeps = {}): Promise<IntakeReport> {
    if (event.kind !== 'call_finished' && event.kind !== 'call_transcribed') return forwardOne(event, deps);
    const key = event.callRecordId;
    const next = (callForwards.get(key) ?? Promise.resolve()).then(() => forwardOne(event, deps));
    const tail = next.catch(() => undefined);
    callForwards.set(key, tail);
    void tail.then(() => { if (callForwards.get(key) === tail) callForwards.delete(key); });
    return next;
}

async function forwardOne(event: IntakeEvent, deps: IntakeGatewayDeps): Promise<IntakeReport> {
    const { purpose, gateway } = await intakeGateway(deps);
    const deliveryLabel = deliveryLabelFor(purpose);
    const { envelopes, skipped } = await envelopesOf(event);
    const deliveryId = event.kind === 'email_received' ? event.deliveryId : undefined;
    let forwarded = 0;
    let attached = 0;
    for (const envelope of envelopes) {
        const out = await gateway.inbound(envelope, {}, { attachOnly: event.kind === 'call_transcribed', deliveryId });
        if (out.kind === 'attached') { attached++; console.log(`[comms-v2 intake] ${event.kind} -> case ${out.file.id}: call turn ${out.changed ? 'filled in' : 'unchanged'}, no desk run`); }
        else if (out.kind === 'handled') { forwarded++; console.log(`[comms-v2 intake] ${event.kind} -> case ${out.file.id}: ${out.result.decision}${out.result.channel ? ` on ${out.result.channel}` : ''} (${deliveryLabel})`); }
        else if (out.kind === 'duplicate') { skipped.push('already on a case file'); console.log(`[comms-v2 intake] ${event.kind} -> case ${out.file.id}: already on the file, not handed again`); }
        else skipped.push(out.kind === 'candidates' ? 'identity returned candidates' : out.reason);
    }
    // A durable hand-over is done only once the file is written; the durable store says when (desk/database-store.ts).
    if (deliveryId) await (gateway.store as { flush?: () => Promise<void> }).flush?.();
    return event.kind === 'call_finished' || event.kind === 'call_transcribed' ? { forwarded, attached, skipped } : { forwarded, skipped };
}

/** For tests: forget the live gateway, or put a scripted one in its place. */
export function resetLiveChannelGateway(gateway?: GatewayT, purpose: Purpose | 'any' = 'any'): void { live = gateway ? { purpose, gateway: Promise.resolve(gateway), ready: gateway } : null; }
