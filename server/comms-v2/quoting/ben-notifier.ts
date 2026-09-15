/**
 * Ben's notifications from the Quoting tool server: one when a draft is ready to price (checklist
 * 4.3, with the price screen link), a chase while the customer is still without it (4.5), and one on acceptance
 * (6.1). Ben is the approver, not a party on the file, so a notice never goes through the customer
 * sender.
 *
 * Every notice is recorded on the case file as a fact (quoting-tools.ts `notifyBen`), whatever
 * happens to the push, and that fact carries what the notifier did. The sandbox door's notifier only
 * records ("the recorded push", answer 42: nothing leaves). The live intake's notifier
 * (`liveBenNotifier`) dispatches the same notice to Ben's phone through server/pushover.ts, and only
 * while the new desk is the live desk (server/comms-v2/switch.ts `commsV2Live`, asked at every
 * notice, so a switch flipped back stops the next push). The wording here is the desk's own; the
 * message names what is missing so Ben can request it from the price screen (4.4).
 */
import { priceScreenUrlFor } from './quote-record';

/** Every kind of notice Ben can be sent, and so every fact key the notifier writes for his eyes only. */
export const BEN_NOTICE_KINDS = ['ready_to_price', 'chase', 'accepted'] as const;
export type BenNoticeKind = typeof BEN_NOTICE_KINDS[number];

export interface BenNotice {
    kind: BenNoticeKind;
    title: string;
    message: string;
    link: string | null;
    at: string;
}

/** Which file and quote a notice is about, for a push whose one tap should land on the work. */
export interface BenNoticeContext {
    caseId: string;
    slug: string;
    customerName: string | null;
    phone: string | null;
}

export interface BenNotifier {
    /** Deliver the notice, or record that it would have gone, and say which in the note. Never throws. */
    notify(notice: BenNotice, ctx?: BenNoticeContext): Promise<{ note: string }>;
}

const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

export function readyToPriceNotice(input: {
    customerName: string | null; postcode: string | null; slug: string; lines: string[]; checkThis: number;
    suggestedTotalPence: number | null; estimatorFailed: string | null; missing: string[]; at: string; baseUrl?: string;
}): BenNotice {
    const who = input.customerName?.trim() || 'A customer';
    const lines = [`${who}${input.postcode ? ` · ${input.postcode}` : ''}`];
    if (input.lines.length) {
        lines.push(input.lines.slice(0, 5).map((t) => `- ${truncate(t, 60)}`).join('\n'));
        if (input.lines.length > 5) lines.push(`+${input.lines.length - 5} more`);
    }
    if (input.suggestedTotalPence != null) lines.push(`Suggested total £${(input.suggestedTotalPence / 100).toFixed(0)} (yours to change).`);
    if (input.estimatorFailed) lines.push(`Priced from reference rates, estimator failed (${truncate(input.estimatorFailed, 120)}). Every line needs a check.`);
    else if (input.checkThis > 0) lines.push(`${input.checkThis} line${input.checkThis === 1 ? '' : 's'} marked check this.`);
    if (input.missing.length) lines.push(`Missing, yours to request: ${input.missing.join('; ')}.`);
    lines.push('Nothing has been sent. Open, check, price, send.');
    return { kind: 'ready_to_price', title: `Quote ready to price: ${who}`, message: lines.join('\n'), link: priceScreenUrlFor(input.slug, input.baseUrl), at: input.at };
}

/**
 * The chase for a draft the customer has not received. Two shapes, because two different things
 * can be waiting: a draft with no prices on it is waiting for Ben to price it, while a draft he
 * has already priced is waiting on a delivery that was held, and telling him that one is unpriced
 * would be untrue. `heardFromUs` is whether anything at all has reached the customer on this
 * thread, because the acknowledgement their enquiry was owed can itself be held for Ben: a notice
 * that tells him they have been promised a quote when nobody has written to them is one he learns
 * to distrust, so it says which it is.
 */
export function chaseNotice(input: { customerName: string | null; slug: string; n: number; waitingSince: string; at: string; heardFromUs: boolean; baseUrl?: string; priced?: boolean }): BenNotice {
    const who = input.customerName?.trim() || 'A customer';
    const hours = Math.max(1, Math.round((Date.parse(input.at) - Date.parse(input.waitingSince)) / 3_600_000));
    const waited = `${hours} hour${hours === 1 ? '' : 's'}`;
    const told = input.heardFromUs ? 'The customer has been told the quote is on its way.' : `${who} has not heard from us at all yet.`;
    if (input.priced) {
        return {
            kind: 'chase',
            title: `Chase ${input.n}: ${who}'s quote is priced but not sent`,
            message: `The quote for ${who} is priced and has not gone out: the delivery was held, ${waited} after the draft was ready. ${told} Open, check the hold, send.`,
            link: priceScreenUrlFor(input.slug, input.baseUrl),
            at: input.at,
        };
    }
    return {
        kind: 'chase',
        title: `Chase ${input.n}: ${who}'s quote is still unpriced`,
        message: `The draft for ${who} has waited ${waited} for a price. ${told} Open, check, price, send.`,
        link: priceScreenUrlFor(input.slug, input.baseUrl),
        at: input.at,
    };
}

/** `paymentType` full: the customer paid for the whole job, said so as the old alert says it. */
export function acceptedNotice(input: { customerName: string | null; phone: string | null; jobSummary: string | null; depositPence: number; paymentType?: 'deposit' | 'full'; at: string }): BenNotice {
    const who = input.customerName?.trim() || 'A customer';
    const lines = [`${who} - ${input.phone ?? 'no number'}`];
    if (input.jobSummary?.trim()) lines.push(truncate(input.jobSummary.trim(), 140));
    if (input.depositPence > 0) lines.push(`£${(input.depositPence / 100).toFixed(2)} ${input.paymentType === 'full' ? 'paid in full' : 'deposit paid'}`);
    return { kind: 'accepted', title: 'Quote accepted', message: lines.join('\n'), link: null, at: input.at };
}

/** Records only: the sandbox door's notifier, and what the live one does while the new desk is not live. */
export const recordingNotifier: BenNotifier = {
    async notify(notice) { return { note: `recorded, not sent: ${notice.title}` }; },
};

/** The Pushover event each kind of notice goes under: the key the old desk's alert of the same kind uses, so it reaches the same people. */
export const PUSHOVER_EVENT_FOR = { ready_to_price: 'quote_prep_ready', chase: 'chase', accepted: 'quote_accepted' } as const satisfies Record<BenNoticeKind, string>;

const LINK_TITLE: Record<BenNoticeKind, string> = { ready_to_price: 'Price and send', chase: 'Open it', accepted: 'Open it' };

export interface PushoverSink {
    send(input: { event: (typeof PUSHOVER_EVENT_FOR)[BenNoticeKind]; title: string; message: string; linkUrl: string | null; linkUrlTitle: string; linkPhone: string | null }): Promise<{ sent: number; skipped: string | null }>;
}

/** server/pushover.ts, loaded on first use: it opens the notification settings. */
export const pushoverSink: PushoverSink = {
    async send(input) { return (await import('../../pushover')).notifyDeskNotice(input); },
};

export interface LiveNotifierDeps {
    /** The switches, read at every notice (switch.ts). */
    liveState?: () => Promise<{ live: boolean; off: string[] }>;
    pushover?: PushoverSink;
}

/**
 * The live intake's notifier: while the new desk is the live desk, each notice goes to Ben's phone
 * under its event key with the desk's own title, message and link; otherwise it records only, exactly
 * as `recordingNotifier` does. A switch read that fails is not live. A push Pushover skipped (no token,
 * no recipient, quiet hours) or that failed is said so in the note, which the fact on the file carries.
 */
export function liveBenNotifier(deps: LiveNotifierDeps = {}): BenNotifier {
    const readState = deps.liveState ?? (async () => (await import('../switch')).commsV2LiveState());
    const sink = deps.pushover ?? pushoverSink;
    return {
        async notify(notice, ctx) {
            const live = await readState().then((s) => s.live, () => false);
            if (!live) return recordingNotifier.notify(notice, ctx);
            try {
                const r = await sink.send({ event: PUSHOVER_EVENT_FOR[notice.kind], title: notice.title, message: notice.message, linkUrl: notice.link, linkUrlTitle: LINK_TITLE[notice.kind], linkPhone: notice.kind === 'accepted' ? ctx?.phone ?? null : null });
                if (r.sent > 0) return { note: `sent to Ben's phone: ${notice.title}` };
                return { note: `recorded, not sent (Pushover skipped: ${r.skipped ?? 'no recipient'}): ${notice.title}` };
            } catch (err: any) {
                return { note: `recorded, not sent (Pushover failed: ${err?.message ?? err}): ${notice.title}` };
            }
        },
    };
}
