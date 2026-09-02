/**
 * PROMISE TRACKER — follow-up commitments get a timer, and a stalled promise becomes Ben's
 * problem instead of the customer's.
 *
 * Written after 27 Aug 2026, conversation b57b6790401ff28a3db04d58ff1e366f (+447950552830,
 * "James", £992 bathroom floor quote), which exposed the failure this file closes:
 *
 *   26 Aug 17:11  agent auto-sends "I'll get this priced up properly and sent over to you as
 *                 soon as it's ready." — a promise with no timer.
 *   27 Aug 11:0x  ~18 hours later the CUSTOMER has to chase ("How long does it usually take
 *                 to price up"), and the agent answers its own SLA breach with the SAME
 *                 holding reply again. Two more open promises follow at 11:38 and 11:45
 *                 (patch-only quote, survey visit terms), also untimed.
 *
 * Three exports carry the fix:
 *   detectFollowUpPromise / detectHoldingReply — the shared detection family. A follow-up
 *       promise is "I'll come back to you with X" in any of its house phrasings; a HOLDING
 *       REPLY is a promise with nothing else in it (no question, no link, no new substance).
 *   recordOutboundCommitment — called from the comms agent's post-send path: a sent promise
 *       writes conversations.metadata.openCommitment with a dueAt 4 WORKING hours later
 *       (08:00-20:00 UK), so the debt exists somewhere a sweep can read it.
 *   flagOverdueCommitments — the sweep (wired into comms-sweep.ts's fast tick, imitating the
 *       callback_due fallback): a commitment past dueAt with no fulfilment since is flagged to
 *       Ben once and cleared, so it cannot re-flag every pass.
 *
 * assessRepeatHolding also lives here (same detection family): it decides whether a NEW holding
 * draft would be the second holding reply in a row — the stall loop — which comms.ts uses to
 * refuse the auto-send and flag instead.
 */
import { newRunId } from '../approver';
import { db } from '../db';
import { conversations, messages, messageDrafts, personalizedQuotes } from '@shared/schema';
import { and, eq, desc, inArray, isNull, sql } from 'drizzle-orm';

// ---------------------------------------------------------------- detection family

/**
 * The house phrasings of "I'll do something and come back to you". Deliberately a list of
 * NARROW patterns rather than one broad "I'll + verb" net: a false positive here starts a
 * 4-hour timer and can end in a needless ping on Ben's phone, so each pattern earns its place
 * by matching a phrasing the agent has actually sent. The James conversation supplied the
 * first four verbatim.
 */
const PROMISE_RES: RegExp[] = [
    // "I'll/we'll come (straight) back to you", "get back to you", "be in touch"
    /\b(?:i|we)(?:['’]ll| will)\s+(?:come\s+(?:straight\s+)?back(?:\s+to\s+you)?|get\s+back\s+to\s+you|be\s+(?:back\s+)?in\s+touch)\b/i,
    // "I'll get X sorted / sent (over) / priced (up) / arranged / set up / over to you"
    /\b(?:i|we)(?:['’]ll| will)\s+get\b[^.?!\n]{0,60}\b(?:sorted|sent(?:\s+over)?|priced(?:\s+up)?|arranged|set\s+up|over\s+to\s+you)\b/i,
    // "let me check / I'll check ... and come back / get back / let you know"
    /\b(?:let\s+me|i(?:['’]ll| will)|we(?:['’]ll| will))\s+(?:check|chase|find\s+out|look\s+into|dig\s+out)\b[^.?!\n]{0,80}\b(?:come\s+(?:straight\s+)?back|get\s+back|let\s+you\s+know)\b/i,
    // "... as soon as it's ready / I've got them / they're done"
    /\bas\s+soon\s+as\s+(?:it(?:['’]s)?|they(?:['’]re)?|i(?:['’]ve)?|we(?:['’]ve)?)\b[^.?!\n]{0,40}\b(?:ready|got|done|back|sorted)\b/i,
    // "sorting it now", "getting that sorted", "on it now"
    /\b(?:sorting|getting)\s+(?:it|this|that|one)\b[^.?!\n]{0,30}\b(?:now|sorted)\b/i,
    /\bon\s+it\s+now\b/i,
    // "leave it with me", "bear with me/us"
    /\bleave\s+(?:it|this|that)\s+with\s+(?:me|us)\b/i,
    /\bbear\s+with\s+(?:me|us)\b/i,
    // "I'll update you / let you know / keep you posted"
    /\b(?:i|we)(?:['’]ll| will)\s+(?:update\s+you|let\s+you\s+know|keep\s+you\s+posted)\b/i,
];

/**
 * Clause-shaped chunks: split on terminal punctuation, bubble/line breaks, AND commas. The
 * comma matters for the residue analysis in detectHoldingReply: "I'll get the fitting arranged,
 * and just so you know, the seat needs the hinge kit replacing too" is ONE sentence whose
 * promise clause would otherwise swallow the genuinely new information riding after the comma —
 * a substantive reply misread as a stall. Clause-level, the promise chunk is skipped and the
 * information chunks count as the residue they are.
 */
function sentencesOf(body: string): string[] {
    return body
        .replace(/\n\s*---\s*\n/g, '\n') // "---" bubble separators are line breaks for analysis
        .split(/(?<=[.!?])\s+|\n+|,\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Does this outbound text promise future action ("I'll come back to you with X")? Returns the
 * matched phrase, or null. This is the COMMITMENT detector: a promise can legitimately share a
 * message with a question or a link — it still starts the 4-hour clock.
 */
export function detectFollowUpPromise(body: string): string | null {
    const text = body.replace(/\n\s*---\s*\n/g, '\n');
    for (const re of PROMISE_RES) {
        const m = re.exec(text);
        if (m) return m[0];
    }
    return null;
}

/** The sentence carrying the promise — a better summary for Ben than the bare matched phrase. */
export function promiseSummary(body: string): string | null {
    for (const s of sentencesOf(body)) {
        if (PROMISE_RES.some((re) => re.test(s))) return s.slice(0, 200);
    }
    const phrase = detectFollowUpPromise(body);
    return phrase ? phrase.slice(0, 200) : null;
}

/** Openers that carry warmth but no information — they don't count as substance. */
const COURTESY_RE = /^(?:hi|hiya|hey|hello|morning|afternoon|evening|thanks|thank\s+you|no\s+problem|no\s+worries|sorry|apologies|cheers|appreciate)\b/i;

/**
 * Is this draft a HOLDING REPLY — a promise of future action with no new substance?
 *
 * The definition (from the 27 Aug 2026 incident brief): promises future action, AND contains no
 * quote link, no question to the customer, and no new information. The first three are exact
 * checks; "no new information" is necessarily a heuristic — after removing the promise
 * sentence(s) and pure-courtesy sentences, at most a few words may remain. 8 words of residue
 * is the line: "That's the labour side, you'd supply the tap yourself" (10 words) is substance
 * and passes through; "Sorry for the delay" is courtesy and does not.
 *
 * Returns the promise phrase when the text IS a holding reply, else null. Pure, so the test
 * suite attacks it directly.
 */
export function detectHoldingReply(body: string): string | null {
    const text = body.replace(/\n\s*---\s*\n/g, '\n');
    if (/\?/.test(text)) return null;                                  // a question moves the conversation
    if (/https?:\/\/|wa\.me\/|\/quote\//i.test(text)) return null;     // a link (esp. the quote) is substance
    const phrase = detectFollowUpPromise(text);
    if (!phrase) return null;
    let residueWords = 0;
    for (const s of sentencesOf(text)) {
        if (PROMISE_RES.some((re) => re.test(s))) continue;
        if (COURTESY_RE.test(s)) continue;
        residueWords += s.split(/\s+/).length;
    }
    return residueWords <= 8 ? phrase : null;
}

// ---------------------------------------------------------------- working-hours arithmetic

const UK_DAY_START = 8;  // matches the proactive-send window in comms.ts
const UK_DAY_END = 20;

function ukHourMinute(d: Date): { hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric', minute: 'numeric', hour12: false, timeZone: 'Europe/London',
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { hour: get('hour') % 24, minute: get('minute') };
}

/**
 * `from` + `hours` counted only inside the 08:00-20:00 UK window, rolling into the next morning
 * when the clock runs past close. A promise made at 18:30 is due 10:30 the next day, not 22:30
 * tonight — the point of the timer is a HUMAN acting on it, and 22:30 is not when Ben works.
 * Iterative over wall-clock ms so DST transitions come out right via Intl. Pure, tested.
 */
export function addWorkingHours(from: Date, hours: number): Date {
    let t = from.getTime();
    let remaining = hours * 3_600_000;
    for (let guard = 0; guard < 100 && remaining > 0; guard++) {
        const { hour, minute } = ukHourMinute(new Date(t));
        if (hour < UK_DAY_START) { t += ((UK_DAY_START - hour) * 60 - minute) * 60_000; continue; }
        if (hour >= UK_DAY_END) { t += ((24 - hour + UK_DAY_START) * 60 - minute) * 60_000; continue; }
        const toClose = ((UK_DAY_END - hour) * 60 - minute) * 60_000;
        const step = Math.min(remaining, toClose);
        t += step;
        remaining -= step;
    }
    // Landed exactly on 20:00: roll to next morning so dueAt is always an hour someone works.
    const { hour } = ukHourMinute(new Date(t));
    if (hour >= UK_DAY_END || hour < UK_DAY_START) {
        const d = new Date(t);
        const { hour: h, minute: m } = ukHourMinute(d);
        t += (h >= UK_DAY_END ? ((24 - h + UK_DAY_START) * 60 - m) : ((UK_DAY_START - h) * 60 - m)) * 60_000;
    }
    return new Date(t);
}

// ---------------------------------------------------------------- the open commitment

/** How long a promise may sit before it becomes Ben's problem. */
export const COMMITMENT_DUE_WORKING_HOURS = 4;

export interface OpenCommitment {
    madeAt: string;   // ISO — when the promise left for the customer
    dueAt: string;    // ISO — madeAt + 4 working hours (08-20 UK)
    summary: string;  // the promise sentence, as Ben should read it
}

/** Which text an agent draft actually put on the customer's phone — same matching as get_thread. */
async function agentSentParts(phone: string): Promise<Set<string>> {
    const rows = await db.select({ body: messageDrafts.body }).from(messageDrafts)
        .where(and(
            eq(messageDrafts.phone, phone),
            eq(messageDrafts.source, 'comms_agent'),
            inArray(messageDrafts.status, ['sent', 'approved']),
        ));
    return new Set(
        rows.flatMap((d) => d.body.split(/\n\s*---\s*\n/)).map((p) => p.trim()).filter(Boolean),
    );
}

/**
 * Record a follow-up commitment off a JUST-SENT outbound. Called from the comms agent's
 * post-send path (comms.ts) — after approveAndSendDraft succeeded, never before, because a
 * promise that never reached the customer is not a debt.
 *
 * An EXISTING open commitment is kept, not overwritten: re-promising while the first promise is
 * unfulfilled is exactly the stall this system exists to catch, and letting the re-promise reset
 * the clock would let the agent stall forever four hours at a time. The first madeAt stands
 * until fulfilment or the overdue flag clears it.
 */
export async function recordOutboundCommitment(opts: {
    conversationId: string;
    body: string;
    /** When the outbound left; defaults to now. */
    at?: Date;
}): Promise<OpenCommitment | null> {
    const summary = promiseSummary(opts.body);
    if (!summary) return null;

    // Fresh read (the CAS habit from comms.ts tags): another writer may have touched metadata
    // mid-run, and the existing-commitment check must see the truth, not the run-start snapshot.
    const [conv] = await db.select({ metadata: conversations.metadata })
        .from(conversations).where(eq(conversations.id, opts.conversationId));
    if (!conv) return null;
    const existing = (conv.metadata as any)?.openCommitment as OpenCommitment | undefined;
    if (existing?.dueAt) return existing;

    const madeAt = opts.at ?? new Date();
    const commitment: OpenCommitment = {
        madeAt: madeAt.toISOString(),
        dueAt: addWorkingHours(madeAt, COMMITMENT_DUE_WORKING_HOURS).toISOString(),
        summary,
    };
    // jsonb merge, not a full-object write: concurrent metadata writers (quotePrepAuto,
    // nextTriageAt leases) must not be clobbered by a stale read.
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('openCommitment', ${JSON.stringify(commitment)}::jsonb)`,
        updatedAt: new Date(),
    }).where(eq(conversations.id, opts.conversationId));
    console.log(`[PromiseTracker] Commitment recorded on ${opts.conversationId}: "${summary.slice(0, 80)}" due ${commitment.dueAt}`);
    return commitment;
}

/** Remove the open commitment (fulfilled, or consumed by an overdue flag). */
export async function clearOpenCommitment(conversationId: string): Promise<void> {
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) - 'openCommitment'`,
        updatedAt: new Date(),
    }).where(eq(conversations.id, conversationId));
}

// ---------------------------------------------------------------- repeat-holding assessment (C2)

export interface RepeatHoldingAssessment {
    /** True = the last thing the customer heard from us was ALREADY a holding reply, nothing
     *  material has changed since, and a new holding reply would be the stall loop. */
    repeat: boolean;
    /** When the previous holding reply went out (or the open commitment was made). */
    since: Date | null;
    /** What the customer is still waiting on, best available wording. */
    waitingOn: string | null;
}

/**
 * Would a new holding draft be the SECOND consecutive holding reply?
 *
 * Reads the thread's trailing outbound burst (the consecutive outbound bubbles most recently
 * sent, skipping any newer inbound — usually the customer's chase) and answers: was that burst
 * itself a holding reply, sent by the agent, with nothing material since?
 *
 * "Material" is exactly the brief's list: a quote sent since (the burst carrying the link is
 * caught by detectHoldingReply; a quote ROW created since is checked directly as the belt), or
 * a manual/human outbound since (an outbound in the burst the agent's drafts never carried is
 * Ben typing, and Ben's words are substance whatever they say — his holding reply is his call).
 * Quarantined (never-sent) rows are excluded throughout: a holding reply the customer never
 * received did not stall anybody.
 */
export async function assessRepeatHolding(opts: {
    conversationId: string;
    /** E.164, for the agent-draft matching. */
    phone: string;
    /** Bare digits, for the quote-row lookup. */
    digits: string;
}): Promise<RepeatHoldingAssessment> {
    const none: RepeatHoldingAssessment = { repeat: false, since: null, waitingOn: null };

    const recent = await db.select({
        direction: messages.direction,
        content: messages.content,
        createdAt: messages.createdAt,
        channel: messages.channel,
        quarantinedAt: messages.quarantinedAt,
    }).from(messages)
        .where(eq(messages.conversationId, opts.conversationId))
        .orderBy(desc(messages.createdAt)).limit(30);

    // 'call' rows are call summaries, 'note' rows are internal — neither is a customer message.
    const rows = recent.filter((m) => !m.quarantinedAt && m.channel !== 'call' && m.channel !== 'note');

    // Newest-first walk: skip the customer's latest inbound(s), then collect the consecutive
    // outbound burst (one reply = several bubbles = several rows), stopping at the inbound
    // before it.
    const burst: typeof rows = [];
    for (const m of rows) {
        if (m.direction === 'outbound') { burst.push(m); continue; }
        if (burst.length) break;
    }
    if (!burst.length) return none;
    burst.reverse(); // chronological

    const joined = burst.map((m) => (m.content ?? '').trim()).filter(Boolean).join('\n');
    const phrase = detectHoldingReply(joined);
    if (!phrase) return none;

    // Ben spoke inside the burst → substance, not a stall (and never ours to overrule).
    const parts = await agentSentParts(opts.phone);
    const benSpoke = burst.some((m) => {
        const t = (m.content ?? '').trim();
        return !!t && !parts.has(t);
    });
    if (benSpoke) return none;

    const since = burst[0].createdAt ? new Date(burst[0].createdAt) : null;

    // A quote created since the holding reply is the thing the promise was FOR arriving — even
    // if its link went out by a channel this thread doesn't show (e-mail, Ben's phone).
    if (since) {
        const [q] = await db.select({ id: personalizedQuotes.id }).from(personalizedQuotes)
            .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${opts.digits}
                AND ${personalizedQuotes.createdAt} > ${since.toISOString()}::timestamptz`)
            .limit(1);
        if (q) return none;
    }

    // Prefer the recorded commitment's wording and clock — it is the older, truer debt.
    const [conv] = await db.select({ metadata: conversations.metadata })
        .from(conversations).where(eq(conversations.id, opts.conversationId));
    const oc = (conv?.metadata as any)?.openCommitment as OpenCommitment | undefined;
    return {
        repeat: true,
        since: oc?.madeAt ? new Date(oc.madeAt) : since,
        waitingOn: oc?.summary ?? phrase,
    };
}

// ---------------------------------------------------------------- the overdue sweep (C3)

/**
 * Fulfilment since the promise: an outbound carrying a quote link, or a manual/human outbound
 * (Ben in the thread). An AGENT outbound that is neither does NOT fulfil — another "nearly
 * there!" from the machine is exactly what must not settle the debt. Returns the reason, for
 * the log, or null.
 */
async function fulfilmentSince(conversationId: string, phone: string, madeAt: Date): Promise<string | null> {
    const outbound = await db.select({
        content: messages.content,
        channel: messages.channel,
        quarantinedAt: messages.quarantinedAt,
    }).from(messages)
        .where(and(
            eq(messages.conversationId, conversationId),
            eq(messages.direction, 'outbound'),
            sql`${messages.createdAt} > ${madeAt.toISOString()}::timestamptz`,
        ))
        .orderBy(desc(messages.createdAt)).limit(20);
    const real = outbound.filter((m) => !m.quarantinedAt && m.channel !== 'call' && m.channel !== 'note');
    if (!real.length) return null;
    if (real.some((m) => /\/quote\//i.test(m.content ?? ''))) return 'a quote link went out';
    const parts = await agentSentParts(phone);
    if (real.some((m) => {
        const t = (m.content ?? '').trim();
        return !!t && !parts.has(t);
    })) return 'a human replied in the thread';
    return null;
}

/**
 * THE SWEEP. Finds conversations whose openCommitment.dueAt has passed, checks for fulfilment
 * since madeAt, and either clears quietly (fulfilled) or flags Ben with the promise's own words
 * and clears the commitment so it cannot re-flag every pass — the same settle-the-debt-either-way
 * shape as the callback_due fallback (comms-sweep.ts:261-317), which this deliberately imitates.
 * A thrown error leaves the commitment standing, so a transient DB failure retries next pass.
 *
 * No 08-20 hours gate, on purpose: dueAt is computed INSIDE working hours by construction, so in
 * practice this fires in the day; and flagThreadForBen itself has no hours gate anywhere else —
 * an internal ping is not a customer message. Capped at 3 actions per pass like the callback
 * fallback: the queue drains across passes, never in one burst.
 */
export async function flagOverdueCommitments(): Promise<{ scanned: number; flagged: number; cleared: number }> {
    const nowIso = new Date().toISOString();
    // Phase 1: one run id per pass; every flag it raises carries it.
    const runId = newRunId('sweep');
    const due = await db.select({
        id: conversations.id,
        phoneNumber: conversations.phoneNumber,
        metadata: conversations.metadata,
    }).from(conversations).where(and(
        isNull(conversations.archivedAt),
        // ISO-8601 strings compare correctly as text; the ->> guard doubles as "has a commitment".
        sql`${conversations.metadata}->'openCommitment'->>'dueAt' <= ${nowIso}`,
    )).limit(20);

    let flagged = 0;
    let cleared = 0;
    let acted = 0;
    for (const c of due) {
        if (acted >= 3) break;
        const oc = (c.metadata as any)?.openCommitment as OpenCommitment | undefined;
        if (!oc?.madeAt || !oc.summary) {
            // Malformed — clear rather than re-scan it forever.
            await clearOpenCommitment(c.id).catch(() => {});
            cleared++;
            continue;
        }
        acted++;
        try {
            const digits = (c.phoneNumber ?? '').replace('@c.us', '').replace(/\D/g, '');
            const phone = `+${digits}`;
            const madeAt = new Date(oc.madeAt);

            const fulfilled = await fulfilmentSince(c.id, phone, madeAt);
            if (fulfilled) {
                await clearOpenCommitment(c.id);
                cleared++;
                console.log(`[PromiseTracker] Commitment on ${c.id} fulfilled (${fulfilled}) — cleared, no flag.`);
                continue;
            }

            const madeStr = new Intl.DateTimeFormat('en-GB', {
                dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London',
            }).format(madeAt);
            // Dynamic import breaks the comms.ts ↔ promise-tracker static cycle, same as the
            // pushover/system-events imports elsewhere in the agent.
            const { flagThreadForBen } = await import('./comms');
            await flagThreadForBen({
                conversationId: c.id,
                phone,
                runId,
                source: 'promise_tracker',
                note: `Open promise overdue: we told the customer "${oc.summary}" at ${madeStr} and nothing has gone out since — no quote link, no message from you. The ${COMMITMENT_DUE_WORKING_HOURS}-working-hour follow-up window has passed, so they are waiting on your move. Reply in the thread or send the quote.`,
            });

            // Settle the debt: clear the live commitment and keep the record on the side, so
            // this cannot ping again every 15 seconds while Ben gets to his phone.
            await db.update(conversations).set({
                metadata: sql`(coalesce(${conversations.metadata}, '{}'::jsonb) - 'openCommitment') || jsonb_build_object('lastCommitmentFlagged', ${JSON.stringify({ ...oc, flaggedAt: nowIso })}::jsonb)`,
                updatedAt: new Date(),
            }).where(eq(conversations.id, c.id));
            flagged++;
            console.log(`[PromiseTracker] Overdue commitment on ${c.id} (due ${oc.dueAt}) — flagged for Ben and cleared.`);
        } catch (error: any) {
            console.error(`[PromiseTracker] Overdue-commitment pass failed for ${c.id} (commitment stands, will retry):`, error?.message);
        }
    }
    return { scanned: due.length, flagged, cleared };
}
