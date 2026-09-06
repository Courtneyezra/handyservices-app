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
