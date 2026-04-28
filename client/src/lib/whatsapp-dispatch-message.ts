/**
 * Builds the WhatsApp broadcast message for a contractor dispatch link.
 *
 * Two flavours:
 *   - `full`: explains the system + bond — used the FIRST time a contractor sees
 *     a dispatch link from us, or when sending to a fresh group. Verbose.
 *   - `short`: assumes the contractor already knows how the system works. Used
 *     for repeat broadcasts to existing pool. Just the brief + link.
 *
 * Default is `full` because: (a) the system is new and most contractors
 * haven't seen it yet, and (b) the bond explanation reduces "what's this £20
 * for?" support questions and bond-payment drop-off.
 *
 * Convention: emojis allowed (this lives in WhatsApp, not in code/docs).
 */

export interface DispatchMessageParams {
    publicUrl: string;
    postcode: string | null;
    contractorPayPence: number;
    bondAmountPence: number | null;
    taskCount: number;
    proposalSummary?: string | null;
    /** Optional first preferred date — e.g. "Thu 30 Apr · AM". */
    firstPreferredDate?: string | null;
    /** "full" (default) or "short". */
    flavour?: 'full' | 'short';
}

const fmtPounds = (p: number) => `£${Math.round(p / 100)}`;

export function buildDispatchWhatsAppMessage(params: DispatchMessageParams): string {
    const {
        publicUrl,
        postcode,
        contractorPayPence,
        bondAmountPence,
        taskCount,
        proposalSummary,
        firstPreferredDate,
        flavour = 'full',
    } = params;

    const headline = `🛠️ *New Handy job — ${postcode || 'TBC'}*`;
    const payLine = `💷 *${fmtPounds(contractorPayPence)} labour* · ${taskCount} task${taskCount !== 1 ? 's' : ''}`;
    const summaryLine = proposalSummary ? `📋 ${proposalSummary}` : null;
    const dateLine = firstPreferredDate ? `📅 ${firstPreferredDate}` : null;
    const bondLine = bondAmountPence ? `🛡️ *${fmtPounds(bondAmountPence)} refundable bond* — first to pay locks the job` : null;
    const linkLine = `🔗 ${publicUrl}`;

    if (flavour === 'short') {
        return [headline, payLine, summaryLine, dateLine, bondLine, '', linkLine]
            .filter((l) => l !== null && l !== undefined)
            .join('\n');
    }

    // Full flavour — system explainer
    const intro = `Hi crew 👋 New job up for grabs from Handy Services.`;
    const explainer = [
        '',
        `*How it works:*`,
        `1. Tap the link, see the brief (scope, photos, customer's preferred dates)`,
        `2. Pick yourself from the contractor list`,
        bondAmountPence
            ? `3. Pay the *${fmtPounds(bondAmountPence)} refundable bond* with a card — *first to pay locks the job*`
            : `3. Hit "I'm taking this" — *first to claim wins*`,
        `4. Full address + customer phone unlock once locked`,
        `5. Bond auto-refunds the same day you mark complete with photos`,
        bondAmountPence
            ? ''
            : null,
        bondAmountPence ? `*Why the bond?* Stops no-shows and time-wasters — the £20 protects the customer's slot. It's _your_ money, held by Stripe (not us), back in your account when you finish the job.` : null,
        `*Bonus:* Earn an extra *£10* if the customer leaves a 5★ Google review.`,
    ].filter((l) => l !== null && l !== undefined).join('\n');

    return [
        intro,
        '',
        headline,
        payLine,
        summaryLine,
        dateLine,
        bondLine,
        '',
        linkLine,
        explainer,
    ].filter((l) => l !== null && l !== undefined).join('\n');
}
