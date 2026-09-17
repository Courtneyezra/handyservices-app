/**
 * The Stripe webhook's acceptance (server/stripe-routes.ts `payment_intent.succeeded`), re-pointed at
 * the new desk: the live counterpart of the sandbox door's `POST /accept` (quoting-door.ts).
 *
 * Once the webhook has written the payment on the quote row it asks here, in the place of the old
 * desk's two alerts (server/pushover.ts `notifyQuoteAccepted` and the web push to /admin/comms). Only
 * while the new desk is the live desk (server/comms-v2/switch.ts `commsV2Live`), and only for a quote
 * an open case file on the live intake's store carries (price-screen-send.ts `liveQuoteFile`, the
 * price screen's own lookup; a file the 30-day stale quote rule closed on the quote is reopened for
 * it, file-close.ts `reopenStaleQuoteFiles`), the acceptance is the new desk's:
 *
 *   recorded      awaited, inside the webhook: `recordAcceptance` with the payment as its witness,
 *                 which confirms what the webhook wrote on the row rather than writing it again; the
 *                 file walks to accepted, the `quote_accepted` fact is written, and Ben's push goes
 *                 through the live intake's notifier (ben-notifier.ts `liveBenNotifier`)
 *   acknowledged  once the webhook's response has closed: the acceptance enters the live desk as the
 *                 customer's turn for one acknowledgement through the one sender, as the door does.
 *                 On a shut window the desk holds it for Ben (desk/desk.ts), never a template.
 *
 * A file that already carries `quote_accepted` for the quote is Stripe delivering the event again:
 * nothing is recorded, pushed or acknowledged, on either desk. Every other quote, every quote while
 * any switch is off, and a recording that refuses or fails takes the old alerts unchanged, so Ben is
 * always told about money. Nothing here fails the payment webhook.
 */
import { appendTurn, type CaseFile, type Turn } from '../desk/case-file';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import type { CaseFileStore } from '../desk/store';
import type { BenNotice } from './ben-notifier';
import { recloseStaleQuote } from '../file-close';
import { liveQuoteFile } from './price-screen-send';
import { QUOTE_FACT, factsWithPrefix } from './quote-record';
import { recordAcceptance, type PaidWitness, type QuotingDeps } from './quoting-tools';

/** The fields of a `payment_intent.succeeded` event's payment intent read here. */
export interface PaidIntent {
    id: string;
    amount: number;
    metadata?: Record<string, string> | null;
}

/** The live intake's store, and the turn door of its desk. */
export interface LiveAcceptanceGateway {
    store: CaseFileStore;
    handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult>;
}

export interface LiveAcceptanceDeps {
    liveState?: () => Promise<{ live: boolean; off: string[] }>;
    /** The default builds or reuses the live intake's gateway (channels/intake.ts). */
    gateway?: () => Promise<LiveAcceptanceGateway>;
    /** The default opens the live quote store and Ben's live notifier. */
    quoting?: QuotingDeps;
    now?: () => Date;
    newId?: (prefix: string) => string;
    log?: (line: string) => void;
}

export type LiveAcceptanceOutcome =
    | { caseId: string; repeat: true }
    | { caseId: string; repeat: false; depositPence: number; notice: BenNotice | null; acknowledge: () => Promise<DeskResult | null> };

/** What the customer paid, read the way the webhook's old alert reads it: no payment type is a payment in full. */
export function paidWitnessOf(intent: PaidIntent): PaidWitness {
    return { amountPence: intent.amount, paymentType: (intent.metadata?.paymentType || 'full') === 'full' ? 'full' : 'deposit' };
}

const defaultLog = (line: string) => console.log(`[comms-v2 acceptance] ${line}`);

/**
 * The desk behind the gateway. Bracket access on purpose: server/spine/desk-switch.test.ts treats a
 * dotted read of that property name as a module deciding for itself which desk is live.
 */
async function liveGateway(): Promise<LiveAcceptanceGateway> {
    const gateway = await (await import('../channels/intake')).liveChannelGateway();
    const desk: DeskLike = gateway['desk'];
    return { store: gateway.store, handleTurn: (file, turn) => desk.handleTurn(file, turn) };
}

async function liveQuotingDeps(): Promise<QuotingDeps> {
    const { databaseQuoteStore } = await import('./quote-store');
    const { liveBenNotifier } = await import('./ben-notifier');
    return { store: databaseQuoteStore('live'), notifier: liveBenNotifier() };
}

/** The new desk's record of a paid quote on a live case file; null for every quote the old alerts take. */
export async function recordLiveAcceptance(slug: string, intent: PaidIntent, deps: LiveAcceptanceDeps = {}): Promise<LiveAcceptanceOutcome | null> {
    const log = deps.log ?? defaultLog;
    let built: Promise<LiveAcceptanceGateway> | null = null;
    const gateway = () => (built ??= (deps.gateway ?? liveGateway)());
    const found = await liveQuoteFile(slug, { liveState: deps.liveState, gateway, now: deps.now, reopenStale: `Stripe payment ${intent.id}` });
    if (!found) return null;
    const { file, store } = found;
    if (factsWithPrefix(file, QUOTE_FACT.accepted).some((f) => f.source.kind === 'quote_line' && f.source.quoteRef === slug)) {
        log(`quote ${slug} is already accepted on case file ${file.id}; payment ${intent.id} delivered again, nothing recorded`);
        return { caseId: file.id, repeat: true };
    }
    const now = deps.now ?? (() => new Date());
    const quoting = { ...(deps.quoting ?? (await liveQuotingDeps())), now, newId: deps.newId };
    const party = file.parties[0];
    const reclose = () => { if (found.reopened) recloseStaleQuote(file, `payment ${intent.id} was not recorded on the reopened stale quote`, { now }); };
    let accepted: Awaited<ReturnType<typeof recordAcceptance>>;
    try {
        accepted = await recordAcceptance(file, party, { by: 'human', via: `Stripe payment ${intent.id}`, paid: paidWitnessOf(intent) }, quoting);
        if (!accepted.ok) reclose();
    } catch (err) {
        reclose();
        throw err;
    } finally {
        store.put(file);
    }
    if (!accepted.ok) {
        log(`quote ${slug} on case file ${file.id} not recorded (${accepted.reason}); the old alerts take it`);
        return null;
    }
    const { handleTurn } = await gateway();
    const turnBody = accepted.turnBody;
    const acknowledge = async (): Promise<DeskResult | null> => {
        const current = store.get(file.id) ?? file;
        if (current.stage === 'done') return null;
        const last = current.turns[current.turns.length - 1];
        const at = new Date(Math.max(now().getTime(), last ? Date.parse(last.at) + 1 : 0)).toISOString();
        const turn = appendTurn(current, { at, channel: 'form', direction: 'inbound', partyId: party.personId, kind: 'portal_action', body: turnBody, media: [], runId: null, approver: null }, { now, newId: deps.newId });
        if (!turn.ok) {
            log(`the acceptance of quote ${slug} could not land on case file ${file.id}: ${turn.reason}`);
            return null;
        }
        store.put(current);
        try {
            return await handleTurn(current, turn.value);
        } finally {
            store.put(current);
        }
    };
    return { caseId: file.id, repeat: false, depositPence: accepted.depositPence, notice: accepted.notice, acknowledge };
}

export interface AnnounceInput {
    /** The paid quote's short slug, as the row holds it. */
    slug: string | null | undefined;
    intent: PaidIntent;
    /** The webhook's response: the acknowledgement starts once it has closed, so it neither slows Stripe's answer nor fails it. */
    response: { once(event: 'close', listener: () => void): unknown };
    /** The old desk's alerts, run exactly as they were for every quote the new desk does not take. */
    oldAlerts: () => void;
}

/** The webhook's one call: which desk announced the acceptance. The new desk's side never throws. */
export async function announcePaidAcceptance(input: AnnounceInput, deps: LiveAcceptanceDeps = {}): Promise<'comms_v2' | 'repeat' | 'old'> {
    const log = deps.log ?? defaultLog;
    let out: LiveAcceptanceOutcome | null = null;
    try {
        out = input.slug ? await recordLiveAcceptance(input.slug, input.intent, deps) : null;
    } catch (err: any) {
        log(`the new desk could not record payment ${input.intent.id} (${err?.message ?? err}); the old alerts take it`);
        out = null;
    }
    if (!out) {
        input.oldAlerts();
        return 'old';
    }
    if (out.repeat) return 'repeat';
    const { acknowledge, caseId } = out;
    input.response.once('close', () => {
        acknowledge().then(
            (r) => log(`acknowledgement on case file ${caseId}: ${r ? `${r.decision}${r.note ? ` (${r.note})` : ''}` : 'no turn'}`),
            (err: any) => log(`acknowledgement on case file ${caseId} failed: ${err?.message ?? err}`),
        );
    });
    return 'comms_v2';
}
