/**
 * T5: the comms sandbox's identity and the predicates every other surface uses to keep it out.
 *
 * The sandbox is a place to type as a customer and watch the desk think — on a thread that can
 * never reach a real person. Its safety is STRUCTURAL, in three independent layers, and this
 * module owns the one they share: the number.
 *
 *   1. Dry run.    runOnce({ sandbox: true }) implies dryRun; the exit (the only sender) never runs.
 *   2. The number. +447700900942 — the Ofcom drama range (no subscriber, ever), one past the dev
 *                  board demo's …941 so the two tools can never wipe each other's thread. The route
 *                  looks the thread up by this number only and never accepts a conversation id.
 *   3. No trigger. The thread is created without metadata.nextTriageAt; requestRun refuses test
 *                  numbers; the sweeps skip them; the rules layer suppresses them.
 *
 * `isSandboxPhone` builds on the ONE `isTestNumber` (server/phone-utils.ts) rather than growing a
 * second predicate: a sandbox number is a test number first, then this exact one.
 *
 * Evidence hygiene: a sandbox pass writes an agent_runs row like any pass, stamped
 * `proposal.sandbox = true`. The sampler and the autonomy job exclude such rows with
 * `isSandboxRunProposal` / `NOT_SANDBOX_RUN_SQL`, so an hour of play can never become the numbers
 * the autonomy decision is made from.
 */
import { sql, type SQL } from 'drizzle-orm';
import { isTestNumber } from '../phone-utils';
import type { RouteADeps } from './route-a';

/** The sandbox thread's number, as the WhatsApp ingest stores it. */
export const SANDBOX_PHONE_WA = '447700900942@c.us';
/** The same number in E.164 — what drafts, quotes and the nudge queue key on. */
export const SANDBOX_PHONE_E164 = '+447700900942';
/** Digits only — the identity every format collapses to. */
export const SANDBOX_DIGITS = '447700900942';

/** A test number (the whole drama range), and exactly the sandbox one. */
export function isSandboxPhone(phone: string | null | undefined): boolean {
    if (!isTestNumber(phone)) return false;
    const digits = (phone ?? '').replace(/\D/g, '');
    // National format ("07700 900942") reads as the same subscriber as +44.
    const normalised = digits.startsWith('0') ? `44${digits.slice(1)}` : digits;
    return normalised === SANDBOX_DIGITS;
}

/** The mark a sandbox pass leaves on its agent_runs.proposal JSON. */
export function isSandboxRunProposal(proposal: unknown): boolean {
    return !!proposal && typeof proposal === 'object' && (proposal as { sandbox?: unknown }).sandbox === true;
}

/**
 * The SQL twin of `isSandboxRunProposal`, for the evidence queries that read agent_runs directly.
 * `alias` is the table alias the query uses for agent_runs ('ar', or none).
 */
export function notSandboxRunSql(alias?: string): SQL {
    const col = alias ? sql.raw(`${alias}.proposal`) : sql.raw('proposal');
    return sql`coalesce(${col}->>'sandbox', '') <> 'true'`;
}

/** Drizzle predicate keeping the sandbox thread off a conversations query (board, desk). */
export function notSandboxPhoneSql(phoneColumn: SQL | { name: string } | unknown): SQL {
    return sql`regexp_replace(coalesce(${phoneColumn as SQL}, ''), '[^0-9]', '', 'g') <> ${SANDBOX_DIGITS}`;
}

// ---------------------------------------------------------------- T16: Route A in the sandbox
//
// T5 skipped the whole chain because two of its steps leave the thread: the Pushover to Ben and
// the job pack. Everything else — the estimator, the pricing engine (read-only), the estimate row
// and the priced draft — is written against the sandbox conversation and the sandbox number, so
// it can run for real and Reset can delete it. The two outward steps are RECORDED on the run
// instead, in the exact words Ben's phone would have shown, so the page can say "Ben would have
// been pinged with this" without pinging him. The price queue excludes the sandbox number
// (WAITING_DRAFT_WHERE), and the price screen's send refuses it, so the draft can never be sent
// from the real screen.

export interface SandboxBenNotice { event: string; title: string; message: string; link: string | null }

export interface SandboxRouteARecord {
    /** The Pushover Ben would have received, verbatim (pushover.notifyQuoteReadyToPrice's lines). */
    benNotice: SandboxBenNotice | null;
    /** What the job pack write would have held. */
    jobPack: { lines: number; estimateLines: number; quoteId: string } | null;
    /** The system_events lines Route A would have written. */
    logs: string[];
}

export function newSandboxRouteARecord(): SandboxRouteARecord {
    return { benNotice: null, jobPack: null, logs: [] };
}

function truncate(s: string, n: number): string { return s.length <= n ? s : `${s.slice(0, n - 1)}…`; }

/** Mirror of pushover.notifyQuoteReadyToPrice: the lines Ben would have read. Pure; never dispatched. */
export function quoteReadyNotice(alert: { customerName?: string | null; postcode?: string | null; slug: string; lines: string[]; checkThis: number; suggestedTotalPence?: number | null; estimatorFailed?: string | null }, baseUrl: string = process.env.BASE_URL || 'https://handyservices.app'): SandboxBenNotice {
    const who = alert.customerName?.trim() || 'A customer';
    const lines = [`${who}${alert.postcode ? ` · ${alert.postcode}` : ''}`];
    if (alert.lines.length) {
        lines.push(alert.lines.slice(0, 5).map((t) => `• ${truncate(t, 60)}`).join('\n'));
        if (alert.lines.length > 5) lines.push(`…+${alert.lines.length - 5} more`);
    }
    if (alert.suggestedTotalPence != null) lines.push(`Suggested total £${(alert.suggestedTotalPence / 100).toFixed(0)} (yours to change).`);
    if (alert.estimatorFailed) lines.push(`⚠️ Priced from reference rates, estimator failed (${truncate(alert.estimatorFailed, 120)}). Every line needs a check.`);
    else if (alert.checkThis > 0) lines.push(`⚠️ ${alert.checkThis} line${alert.checkThis === 1 ? '' : 's'} marked check this.`);
    lines.push('Nothing has been sent. Open, check, price, send.');
    return { event: 'quote_prep_ready', title: `💷 Quote ready to price: ${who}`, message: lines.join('\n'), link: `${baseUrl}/admin/price/${alert.slug}` };
}

/** Mirror of pushover.notifyQuoteAccepted. Pure; never dispatched. */
export function quoteAcceptedNotice(alert: { customerName?: string | null; phoneNumber?: string | null; jobSummary?: string | null; amountPaidPence?: number | null; paymentType?: 'full' | 'deposit' | null }): SandboxBenNotice {
    const name = alert.customerName?.trim() || 'A customer';
    const number = alert.phoneNumber?.trim() || 'no number';
    const lines = [`${name} — ${number}`];
    if (alert.jobSummary?.trim()) lines.push(truncate(alert.jobSummary.trim(), 140));
    if (alert.amountPaidPence != null && alert.amountPaidPence > 0) lines.push(`💷 £${(alert.amountPaidPence / 100).toFixed(2)} paid${alert.paymentType === 'full' ? ' in full' : alert.paymentType === 'deposit' ? ' (deposit)' : ''}`);
    return { event: 'quote_accepted', title: '🎉 Quote accepted', message: lines.join('\n'), link: null };
}

/**
 * The chain's injectable deps for a sandbox pass: the estimator, the pricing engine, the estimate
 * row, the draft and the supersede all default to the live functions (they write only against
 * this conversation / this number); `notify`, `writePack` and `log` record into `record`.
 */
export function sandboxRouteADeps(record: SandboxRouteARecord): RouteADeps {
    return {
        notify: async (alert) => { record.benNotice = quoteReadyNotice(alert); },
        writePack: async (input) => {
            record.jobPack = { lines: input.intake.lines.length, estimateLines: input.estimate.lines.length, quoteId: input.quoteId };
            return null;
        },
        log: async (e) => { record.logs.push(e.summary); },
    };
}
