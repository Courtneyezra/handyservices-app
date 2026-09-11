/**
 * Ben's notifications from the Quoting tool server: one when a draft is ready to price (checklist
 * 4.3, with the price screen link), a chase while it sits unpriced (4.5), and one on acceptance
 * (6.1). Ben is the approver, not a party on the file, so these go where his notifications already
 * go (Pushover, server/pushover.ts) and never through the customer sender.
 *
 * In dry run (the sandbox door) nothing is dispatched: the notice is recorded on the case file as
 * a fact and shown as "the recorded push" (answer 42: nothing leaves). Live, the same notice is
 * dispatched through the surviving Pushover functions. The wording here is the desk's own; the
 * message names what is missing so Ben can request it from the price screen (4.4).
 */
import { priceScreenUrlFor } from './quote-record';

export type BenNoticeKind = 'ready_to_price' | 'chase' | 'accepted';

export interface BenNotice {
    kind: BenNoticeKind;
    title: string;
    message: string;
    link: string | null;
    at: string;
}

export interface NotifyContext {
    mode: 'dry_run' | 'live';
    slug: string;
    caseId: string;
    customerName: string | null;
    phone: string | null;
}

export interface BenNotifier {
    /** Deliver the notice, or record that it would have gone. Never throws. */
    notify(notice: BenNotice, ctx: NotifyContext): Promise<{ dispatched: boolean; note: string }>;
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

export function chaseNotice(input: { customerName: string | null; slug: string; n: number; waitingSince: string; at: string; baseUrl?: string }): BenNotice {
    const who = input.customerName?.trim() || 'A customer';
    const hours = Math.max(1, Math.round((Date.parse(input.at) - Date.parse(input.waitingSince)) / 3_600_000));
    return {
        kind: 'chase',
        title: `Chase ${input.n}: ${who}'s quote is still unpriced`,
        message: `The draft for ${who} has waited ${hours} hour${hours === 1 ? '' : 's'} for a price. The customer has been told the quote is on its way. Open, check, price, send.`,
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

/** Records only. The sandbox's notifier, and what every notifier does in dry run. */
export const recordingNotifier: BenNotifier = {
    async notify(notice) { return { dispatched: false, note: `recorded, not sent: ${notice.title}` }; },
};

/** Dry run records; live dispatches through the surviving Pushover functions. Never throws. */
export const liveNotifier: BenNotifier = {
    async notify(notice, ctx) {
        if (ctx.mode !== 'live') return recordingNotifier.notify(notice, ctx);
        try {
            const pushover = await import('../../pushover');
            if (notice.kind === 'accepted') {
                await pushover.notifyQuoteAccepted({ customerName: ctx.customerName, phoneNumber: ctx.phone, jobSummary: notice.message, amountPaidPence: null, paymentType: 'deposit' });
            } else if (notice.kind === 'chase') {
                await pushover.notifyChase({ conversationId: ctx.caseId, customerName: ctx.customerName, phoneNumber: ctx.phone, title: notice.title, note: notice.message, escalated: false, linkUrl: notice.link ?? undefined, linkUrlTitle: 'Price and send' } as any);
            } else {
                await pushover.notifyQuoteReadyToPrice({ conversationId: ctx.caseId, customerName: ctx.customerName, postcode: null, slug: ctx.slug, lines: notice.message.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)), checkThis: 0, suggestedTotalPence: null, estimatorFailed: null });
            }
            return { dispatched: true, note: `sent: ${notice.title}` };
        } catch (err: any) {
            return { dispatched: false, note: `pushover failed (${err?.message ?? err}); the draft stands` };
        }
    },
};
