/**
 * Ben's notifications from the Quoting tool server: one when a draft is ready to price (checklist
 * 4.3, with the price screen link), a chase while the customer is still without it (4.5), and one on acceptance
 * (6.1). Ben is the approver, not a party on the file, so a notice never goes through the customer
 * sender.
 *
 * Nothing is dispatched: the notice is recorded on the case file as a fact and shown as "the
 * recorded push" (answer 42: nothing leaves). Dispatching it to where Ben's notifications already
 * go lands at cutover, against the switch that makes it reachable. The wording here is the desk's
 * own; the message names what is missing so Ben can request it from the price screen (4.4).
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

export interface BenNotifier {
    /** Record that the notice would have gone. Never throws. */
    notify(notice: BenNotice): Promise<{ note: string }>;
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

export function acceptedNotice(input: { customerName: string | null; phone: string | null; jobSummary: string | null; depositPence: number; at: string }): BenNotice {
    const who = input.customerName?.trim() || 'A customer';
    const lines = [`${who} - ${input.phone ?? 'no number'}`];
    if (input.jobSummary?.trim()) lines.push(truncate(input.jobSummary.trim(), 140));
    if (input.depositPence > 0) lines.push(`£${(input.depositPence / 100).toFixed(2)} deposit paid`);
    return { kind: 'accepted', title: 'Quote accepted', message: lines.join('\n'), link: null, at: input.at };
}

/** Records only: the desk's one notifier while it is sandbox-only. */
export const recordingNotifier: BenNotifier = {
    async notify(notice) { return { note: `recorded, not sent: ${notice.title}` }; },
};
