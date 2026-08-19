/**
 * THE OUTCOME LEDGER — closing the loop between what an agent proposed, what a human did with it,
 * and what the customer did next.
 *
 * WHY THIS EXISTS
 *
 * The trust ladder this fleet runs on says autonomy is earned per capability, and the measure is
 * "how often does a human approve this agent's draft without changing a word". That number existed
 * nowhere. It could not be computed after the fact either, because `message_drafts.body` is edited
 * IN PLACE by PATCH /api/drafts/:id — by approval time the agent's original wording is gone, and an
 * approval is indistinguishable from an approval-after-a-rewrite.
 *
 * So the proposal is frozen here the moment it is written, and the verdict is attached to it later.
 * The diff between what the agent wrote and what actually went out is the point: what Ben changed
 * is a far better training signal than any score he could be asked to give.
 *
 * THREE RULES THIS FILE OBEYS
 *
 * 1. NEVER BREAK A SEND. Every capture is fire-and-forget behind its own try/catch. A ledger row is
 *    a report line; a customer's reply is the business. If this file throws, nothing upstream may
 *    notice. `safely()` is the only way anything here is called from a send path.
 *
 * 2. CAPTURE AT CHOKE POINTS, NOT IN EVERY AGENT. queueDraft / approveAndSendDraft / the reject
 *    route / askBen / answer / dismiss. An agent author cannot forget to instrument something they
 *    never had to instrument. `reconcile()` is the safety net for the paths that bypass those hooks
 *    (the agent superseding its own draft, an opt-out refusal, a status changed by a script).
 *
 * 3. MACHINE APPROVAL IS NOT HUMAN APPROVAL. An auto-sent draft records verdict 'auto_sent' and is
 *    excluded from every trust metric. A capability cannot bootstrap its own graduation by sending
 *    itself and counting the result as a vote of confidence.
 *
 * FEEDBACK INJECTION IS DELIBERATELY BORING. Agents do not rewrite their own prompts here: that is
 * unauditable and drifts silently. Two safe channels instead — approved-unedited drafts exported as
 * few-shot examples (capped, recent, and behind a config flag that ships OFF), and a pattern report
 * written for a human to read, which changes nothing by itself.
 */
import { db } from './db';
import { sql } from 'drizzle-orm';
import { commsPhoneKey } from './phone-utils';
import { appSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------------- vocabulary

/** Human judgements. Only these three count toward the trust ladder. */
export const HUMAN_VERDICTS = ['approved_unedited', 'approved_edited', 'rejected'] as const;
/** Approvals whose pre-edit text was never captured (backfilled history). Counted, never faked. */
export const UNKNOWN_EDIT_VERDICT = 'approved_unknown';
export type Verdict =
    | 'pending' | 'approved_unedited' | 'approved_edited' | 'approved_unknown'
    | 'rejected' | 'auto_sent' | 'superseded' | 'blocked' | 'expired'
    | 'answered' | 'dismissed';

/** A pending proposal older than this that nobody has touched is recorded as expired. */
const EXPIRY_DAYS = 7;
/** How long after a send an inbound message still counts as a reply to it. */
const REPLY_WINDOW_DAYS = 14;
/** How long after a send a deposit still counts as attributable to that thread. */
const CONVERSION_WINDOW_DAYS = 30;

/** Draft sources that are really the comms agent wearing a different hat. */
const AGENT_BY_SOURCE: Record<string, string> = {
    comms_agent: 'comms',
    first_contact_ack: 'comms',
    recovery: 'recovery',
    post_call_video: 'system',
    webform_ack: 'system',
    manual: 'human',
};

/**
 * The comms agent stamps its intent into the draft reason as "[intent] why…" (see queue_draft in
 * server/agents/comms.ts). That prefix is the capability the trust ladder gates on, so it is parsed
 * back out here rather than asking every agent to pass it twice.
 */
function parseCapability(reason: string | null | undefined, fallback: string): { capability: string; reason: string } {
    const raw = (reason ?? '').trim();
    const m = raw.match(/^\[([a-z0-9_]{2,40})\]\s*/i);
    if (m) return { capability: m[1].toLowerCase(), reason: raw.slice(m[0].length) };
    return { capability: fallback, reason: raw };
}

// ---------------------------------------------------------------------------------- edit distance

/**
 * Levenshtein distance, two-row DP. Inputs are clamped because a pathological pair of 4k-character
 * bodies would be 16M cell updates on a request path for a number nobody reads to that precision.
 *
 * Not done in SQL on purpose: fuzzystrmatch's levenshtein() caps at 255 characters, which is
 * shorter than most drafts, and the extension may not be installed on the Neon instance.
 */
export function editDistance(a: string, b: string, cap = 4000): number {
    const s = a.slice(0, cap);
    const t = b.slice(0, cap);
    if (s === t) return 0;
    if (!s.length) return t.length;
    if (!t.length) return s.length;

    let prev = new Array<number>(t.length + 1);
    let curr = new Array<number>(t.length + 1);
    for (let j = 0; j <= t.length; j++) prev[j] = j;

    for (let i = 1; i <= s.length; i++) {
        curr[0] = i;
        const si = s.charCodeAt(i - 1);
        for (let j = 1; j <= t.length; j++) {
            const cost = si === t.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[t.length];
}

/**
 * The verdict for an approved draft: did the human change the words?
 *
 * Compared trimmed, because trailing whitespace is not an edit anyone means. Everything else is —
 * a single swapped word is a real signal about the agent's voice, and rounding it away to "close
 * enough" is exactly how a trust metric starts lying.
 */
export function diffProposal(proposed: string, final: string): {
    verdict: 'approved_unedited' | 'approved_edited'; distance: number; ratio: number;
} {
    const p = (proposed ?? '').trim();
    const f = (final ?? '').trim();
    const distance = editDistance(p, f);
    const ratio = distance === 0 ? 0 : distance / Math.max(p.length, f.length, 1);
    return { verdict: distance === 0 ? 'approved_unedited' : 'approved_edited', distance, ratio };
}

// ---------------------------------------------------------------------------------- fire-and-forget

/**
 * The ONLY way this module is called from a send path. Swallows everything, logs once.
 *
 * A ledger write failing must never surface to the caller: the alternative is a customer whose
 * reply was blocked by a bookkeeping error, which is the failure mode this whole system was built
 * to remove.
 */
export function safely(label: string, fn: () => Promise<unknown>): void {
    void (async () => {
        try {
            await fn();
        } catch (error: any) {
            console.warn(`[Outcomes] ${label} failed (ignored):`, error?.message);
        }
    })();
}

/**
 * Test traffic is CAPTURED but never COUNTED.
 *
 * Every agent test in this repo fires at the Ofcom drama range (+447700900xxx) — see the test-data
 * signatures in the analytics notes, and scripts/_outcome-loop-test.ts here. Those sends are real
 * rows: a draft was queued and approved through the real code path. Left in the aggregate they
 * would make the trust-ladder number a measure of how much testing happened, and testing always
 * "approves unedited", so the pollution runs in the flattering direction.
 *
 * They stay in the table (the audit trail should show what the machinery did) and are filtered out
 * of every number a human reads, plus the few-shot exporter — a test message must never be taught
 * back to an agent as an example of good writing.
 */
const SCRUB_TEST = sql`AND COALESCE(phone_key, '') NOT LIKE '7700900%'`;

/**
 * A person approving their own words is not evidence about an agent.
 *
 * `manual` drafts (source = 'manual') are composed by a human and pass through the same queue, so
 * they are captured for the audit trail — but they would score a permanent 100% unedited and sit in
 * the trust table next to the agents, which makes the one number that matters look better the more
 * hand-written messages go out. They stay readable in the decisions feed and out of every rate.
 */
const SCRUB_HUMAN = sql`AND agent <> 'human'`;

const newId = () => `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
/** Last 10 digits — the DIGITS10 join convention used across recovery.ts and the corpus analysis. */
const key10 = (key: string | null) => (key ? key.slice(-10) : null);

// ---------------------------------------------------------------------------------- capture

/**
 * Capture a drafted message the moment it is queued. Called from queueDraft.
 *
 * `proposedBody` is the agent's text BEFORE anyone can touch it — that is the entire reason this
 * runs at queue time and not at approval time.
 */
export async function recordDraftProposal(input: {
    draftId: string;
    conversationId?: string | null;
    phone: string;
    body: string;
    source: string;
    reason?: string | null;
}): Promise<void> {
    const { capability, reason } = parseCapability(input.reason, input.source === 'recovery' ? 'nudge' : 'other');
    const phoneKey = commsPhoneKey(input.phone);
    const slug = input.body.match(/\/quote\/([a-z0-9]{6,12})\b/i)?.[1] ?? null;

    await db.execute(sql`
        INSERT INTO agent_outcomes (
            id, agent, capability, kind, source, ref_id, conversation_id, phone, phone_key,
            quote_slug, proposed_body, reason, proposed_at, verdict
        ) VALUES (
            ${newId()}, ${AGENT_BY_SOURCE[input.source] ?? 'system'}, ${capability}, 'draft',
            ${input.source}, ${input.draftId}, ${input.conversationId ?? null}, ${input.phone},
            ${phoneKey}, ${slug}, ${input.body}, ${reason || null}, now(), 'pending'
        )
        ON CONFLICT (kind, ref_id) DO NOTHING
    `);
}

/** Capture an ask-Ben question when it is raised. Called from askBen. */
export async function recordQuestionProposal(input: {
    questionId: string;
    conversationId: string;
    phone: string;
    question: string;
    context?: string | null;
    options?: string[] | null;
    source?: string;
}): Promise<void> {
    await db.execute(sql`
        INSERT INTO agent_outcomes (
            id, agent, capability, kind, source, ref_id, conversation_id, phone, phone_key,
            proposed_body, reason, proposed_at, verdict, meta
        ) VALUES (
            ${newId()}, ${AGENT_BY_SOURCE[input.source ?? 'comms_agent'] ?? 'comms'}, 'ask_ben', 'question',
            ${input.source ?? 'comms_agent'}, ${input.questionId}, ${input.conversationId}, ${input.phone},
            ${commsPhoneKey(input.phone)}, ${input.question}, ${input.context ?? null}, now(), 'pending',
            ${JSON.stringify({ options: input.options ?? [] })}::jsonb
        )
        ON CONFLICT (kind, ref_id) DO NOTHING
    `);
}

/**
 * The verdict on a draft. Called from approveAndSendDraft (both the human and the auto-send path)
 * and from the reject route.
 *
 * `finalBody` is the draft body as it stands at decision time — already carrying any edit the
 * approver made through PATCH. Comparing it with the frozen proposal is the whole measurement.
 */
export async function recordDraftVerdict(input: {
    draftId: string;
    outcome: 'approved' | 'rejected' | 'blocked';
    decidedBy: string | null;
    finalBody?: string;
    sendStatus?: 'sent' | 'failed' | null;
    sentAt?: Date | null;
    sentMessageId?: string | null;
}): Promise<void> {
    const rows: any = await db.execute(sql`
        SELECT id, proposed_body, proposed_at FROM agent_outcomes
        WHERE kind = 'draft' AND ref_id = ${input.draftId} LIMIT 1
    `);
    const row = (rows.rows ?? rows)[0];
    if (!row) return;                       // proposal was never captured (pre-ledger draft)

    const by = input.decidedBy ?? null;
    // Machine approval is not a human signal, and the agent replacing its own draft is not a
    // rejection. Both are recorded truthfully and excluded from the trust ladder.
    const byMachine = !!by && /^comms_agent:/.test(by);
    const superseded = !!by && /superseded/i.test(by);

    let verdict: Verdict;
    let distance: number | null = null;
    let ratio: number | null = null;
    let finalBody: string | null = null;

    if (input.outcome === 'rejected') {
        verdict = superseded ? 'superseded' : byMachine ? 'superseded' : 'rejected';
    } else if (input.outcome === 'blocked') {
        verdict = 'blocked';
    } else if (byMachine) {
        verdict = 'auto_sent';
        finalBody = input.finalBody ?? null;
    } else {
        const diff = diffProposal(row.proposed_body ?? '', input.finalBody ?? '');
        verdict = diff.verdict;
        distance = diff.distance;
        ratio = diff.ratio;
        // Only stored when it differs: an identical copy of the proposal in every row is noise,
        // and "final_body IS NOT NULL" then means "here is what he changed it to".
        finalBody = diff.verdict === 'approved_edited' ? (input.finalBody ?? null) : null;
    }

    await db.execute(sql`
        UPDATE agent_outcomes SET
            verdict = ${verdict},
            decided_by = ${by},
            decided_at = now(),
            time_to_action_seconds = GREATEST(0, EXTRACT(epoch FROM (now() - proposed_at))::int),
            final_body = ${finalBody},
            edit_distance = ${distance},
            edit_ratio = ${ratio},
            send_status = ${input.sendStatus ?? null},
            sent_at = ${input.sentAt ?? null},
            sent_message_id = ${input.sentMessageId ?? null},
            updated_at = now()
        WHERE id = ${row.id}
    `);
}

/**
 * The verdict on an ask-Ben question.
 *
 * There is no "unedited" for a question, so the analogue is recorded instead: did Ben tap one of
 * the options the agent offered, or type his own answer? An agent whose options are never used is
 * asking the wrong question, and that is worth seeing.
 */
export async function recordQuestionVerdict(input: {
    questionId: string;
    outcome: 'answered' | 'dismissed';
    answer?: string | null;
    decidedBy: string | null;
}): Promise<void> {
    const rows: any = await db.execute(sql`
        SELECT id, meta FROM agent_outcomes WHERE kind = 'question' AND ref_id = ${input.questionId} LIMIT 1
    `);
    const row = (rows.rows ?? rows)[0];
    if (!row) return;

    const options: string[] = Array.isArray(row.meta?.options) ? row.meta.options : [];
    const answer = (input.answer ?? '').trim();
    const tappedOption = !!answer && options.some((o) => String(o).trim() === answer);

    await db.execute(sql`
        UPDATE agent_outcomes SET
            verdict = ${input.outcome},
            decided_by = ${input.decidedBy ?? null},
            decided_at = now(),
            time_to_action_seconds = GREATEST(0, EXTRACT(epoch FROM (now() - proposed_at))::int),
            final_body = ${answer || null},
            meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ tappedOption })}::jsonb,
            updated_at = now()
        WHERE id = ${row.id}
    `);
}

// ---------------------------------------------------------------------------------- reconcile

/**
 * The safety net. Re-reads the source tables for anything the hooks could have missed and ages out
 * proposals nobody ever actioned.
 *
 * Hooks cover the paths a human clicks. This covers the rest: the comms agent rejecting its own
 * superseded draft inside its run, the opt-out refusal inside approveAndSendDraft, a status changed
 * by a maintenance script, a process that died between the send and the ledger write. Without it
 * the ledger would slowly drift into optimism — pending rows that were really rejected weeks ago.
 *
 * Verdicts are recomputed from scratch, so a row that was expired and is later approved corrects
 * itself on the next pass.
 */
export async function reconcileOutcomes(opts: { limit?: number } = {}): Promise<{
    draftsSynced: number; questionsSynced: number; nudgesMirrored: number; expired: number;
}> {
    const limit = opts.limit ?? 500;

    // ---- drafts whose ledger row disagrees with the draft table
    const drafts: any = await db.execute(sql`
        SELECT o.id, o.proposed_body, d.status, d.body, d.approved_by, d.approved_at,
               d.sent_at, d.sent_message_id, d.error
        FROM agent_outcomes o
        JOIN message_drafts d ON d.id = o.ref_id
        WHERE o.kind = 'draft'
          AND o.verdict IN ('pending', 'expired')
          AND d.status <> 'pending'
        LIMIT ${limit}
    `);

    let draftsSynced = 0;
    for (const r of (drafts.rows ?? drafts)) {
        const by: string | null = r.approved_by ?? null;
        const byMachine = !!by && /^comms_agent:/.test(by);
        let verdict: Verdict;
        let distance: number | null = null;
        let ratio: number | null = null;
        let finalBody: string | null = null;

        if (r.status === 'rejected') {
            verdict = byMachine || /superseded|replaced/i.test(by ?? '') ? 'superseded' : 'rejected';
        } else if (byMachine) {
            verdict = 'auto_sent';
        } else {
            const diff = diffProposal(r.proposed_body ?? '', r.body ?? '');
            verdict = diff.verdict;
            distance = diff.distance;
            ratio = diff.ratio;
            finalBody = diff.verdict === 'approved_edited' ? r.body : null;
        }

        const sendStatus = r.status === 'sent' ? 'sent' : r.status === 'failed' ? 'failed' : null;
        await db.execute(sql`
            UPDATE agent_outcomes SET
                verdict = ${verdict},
                decided_by = ${by},
                decided_at = COALESCE(${r.approved_at ?? null}, decided_at, now()),
                time_to_action_seconds = GREATEST(0, EXTRACT(epoch FROM (
                    COALESCE(${r.approved_at ?? null}::timestamp, now()) - proposed_at))::int),
                final_body = ${finalBody},
                edit_distance = ${distance},
                edit_ratio = ${ratio},
                send_status = ${sendStatus},
                sent_at = ${r.sent_at ?? null},
                sent_message_id = ${r.sent_message_id ?? null},
                updated_at = now()
            WHERE id = ${r.id}
        `);
        draftsSynced++;
    }

    // ---- questions closed outside the hooks
    const questions: any = await db.execute(sql`
        UPDATE agent_outcomes o SET
            verdict = CASE WHEN q.status = 'dismissed' THEN 'dismissed' ELSE 'answered' END,
            decided_by = q.answered_by,
            decided_at = COALESCE(q.answered_at, now()),
            time_to_action_seconds = GREATEST(0, EXTRACT(epoch FROM (COALESCE(q.answered_at, now()) - o.proposed_at))::int),
            final_body = q.answer,
            updated_at = now()
        FROM agent_questions q
        WHERE q.id = o.ref_id AND o.kind = 'question'
          AND o.verdict IN ('pending', 'expired')
          AND q.status IN ('answered', 'resolved', 'dismissed')
        RETURNING o.id
    `);

    // ---- recovery nudges. The recovery agent writes to nudge_queue directly and is not hooked
    // (its module is owned elsewhere), so its proposals are mirrored in rather than captured.
    const nudges: any = await db.execute(sql`
        INSERT INTO agent_outcomes (
            id, agent, capability, kind, source, ref_id, phone, phone_key, quote_slug,
            proposed_body, reason, proposed_at, verdict, decided_at, sent_at, send_status
        )
        SELECT 'out_nudge_' || n.id, 'recovery', COALESCE(n.lever, 'skip'), 'nudge', 'recovery',
               n.id, n.phone, right(regexp_replace(COALESCE(n.phone, ''), '[^0-9]', '', 'g'), 10),
               n.slug, COALESCE(n.message, '(skipped: ' || COALESCE(n.reason, 'no reason') || ')'),
               n.reason, n.created_at,
               CASE n.status
                   WHEN 'proposed'  THEN 'pending'
                   WHEN 'approved'  THEN 'approved_unknown'
                   WHEN 'sent'      THEN 'approved_unknown'
                   WHEN 'dismissed' THEN 'rejected'
                   WHEN 'skipped'   THEN 'superseded'
                   ELSE 'pending' END,
               n.approved_at, n.sent_at,
               CASE WHEN n.sent_at IS NOT NULL THEN 'sent' ELSE NULL END
        FROM nudge_queue n
        ON CONFLICT (kind, ref_id) DO UPDATE SET
            verdict = EXCLUDED.verdict,
            decided_at = EXCLUDED.decided_at,
            sent_at = EXCLUDED.sent_at,
            send_status = EXCLUDED.send_status,
            updated_at = now()
        RETURNING id
    `);

    // ---- age out what nobody ever touched
    const expired: any = await db.execute(sql`
        UPDATE agent_outcomes SET verdict = 'expired', updated_at = now()
        WHERE verdict = 'pending'
          AND proposed_at < now() - ${sql.raw(`interval '${EXPIRY_DAYS} days'`)}
        RETURNING id
    `);

    return {
        draftsSynced,
        questionsSynced: (questions.rows ?? questions).length,
        nudgesMirrored: (nudges.rows ?? nudges).length,
        expired: (expired.rows ?? expired).length,
    };
}

// ---------------------------------------------------------------------------------- downstream

/**
 * Attribute what happened AFTER the send: did the customer reply, how fast, and did the thread
 * reach a paid deposit.
 *
 * Both joins go through the last 10 digits of the number — the DIGITS10 convention in
 * server/agents/recovery.ts — because `conversations.phone_number` is "447…@c.us",
 * `personalized_quotes.phone` is "+447…", and drafts are E.164. Anything keyed on the raw string
 * joins nothing. Set-based rather than row-by-row: this DB times out often enough that N round
 * trips is a real risk.
 */
export async function refreshOutcomes(opts: { limit?: number } = {}): Promise<{
    repliesFound: number; conversionsFound: number; rowsChecked: number;
}> {
    const limit = opts.limit ?? 500;

    const replies: any = await db.execute(sql`
        WITH tgt AS (
            SELECT id, sent_at, right(COALESCE(phone_key, ''), 10) AS k
            FROM agent_outcomes
            WHERE send_status = 'sent' AND sent_at IS NOT NULL AND customer_replied_at IS NULL
              AND (outcome_checked_at IS NULL OR outcome_checked_at < now() - interval '1 hour')
            ORDER BY sent_at DESC
            LIMIT ${limit}
        ), found AS (
            SELECT t.id, t.sent_at, (
                SELECT min(m.created_at) FROM messages m
                JOIN conversations c ON c.id = m.conversation_id
                WHERE right(regexp_replace(c.phone_number, '[^0-9]', '', 'g'), 10) = t.k
                  AND m.direction = 'inbound'
                  AND m.quarantined_at IS NULL
                  AND m.created_at > t.sent_at
                  AND m.created_at <= t.sent_at + ${sql.raw(`interval '${REPLY_WINDOW_DAYS} days'`)}
            ) AS replied_at
            FROM tgt t WHERE length(t.k) >= 7
        )
        UPDATE agent_outcomes o SET
            customer_replied_at = f.replied_at,
            reply_latency_seconds = CASE WHEN f.replied_at IS NULL THEN NULL
                ELSE GREATEST(0, EXTRACT(epoch FROM (f.replied_at - f.sent_at))::int) END,
            outcome_checked_at = now(),
            updated_at = now()
        FROM found f WHERE f.id = o.id
        RETURNING o.id, f.replied_at
    `);
    const replyRows = (replies.rows ?? replies) as any[];

    const conversions: any = await db.execute(sql`
        WITH tgt AS (
            SELECT id, sent_at, right(COALESCE(phone_key, ''), 10) AS k
            FROM agent_outcomes
            WHERE send_status = 'sent' AND sent_at IS NOT NULL AND converted_quote_id IS NULL
            ORDER BY sent_at DESC
            LIMIT ${limit}
        ), found AS (
            SELECT t.id, q.quote_id, q.paid_at, q.price
            FROM tgt t
            LEFT JOIN LATERAL (
                SELECT pq.id AS quote_id, pq.deposit_paid_at AS paid_at, pq.base_price AS price
                FROM personalized_quotes pq
                WHERE right(regexp_replace(COALESCE(pq.phone, ''), '[^0-9]', '', 'g'), 10) = t.k
                  AND pq.deposit_paid_at IS NOT NULL
                  AND pq.deposit_paid_at > t.sent_at
                  AND pq.deposit_paid_at <= t.sent_at + ${sql.raw(`interval '${CONVERSION_WINDOW_DAYS} days'`)}
                ORDER BY pq.deposit_paid_at ASC LIMIT 1
            ) q ON true
            WHERE length(t.k) >= 7 AND q.quote_id IS NOT NULL
        )
        UPDATE agent_outcomes o SET
            converted_quote_id = f.quote_id,
            converted_at = f.paid_at,
            conversion_value_pence = f.price,
            updated_at = now()
        FROM found f WHERE f.id = o.id
        RETURNING o.id
    `);

    return {
        rowsChecked: replyRows.length,
        repliesFound: replyRows.filter((r) => r.replied_at).length,
        conversionsFound: (conversions.rows ?? conversions).length,
    };
}

// ---------------------------------------------------------------------------------- backfill

/**
 * Reconstruct the ledger from history so the view is not empty on day one.
 *
 * THE HONEST LIMIT: for drafts already approved before this table existed, the pre-edit text is
 * gone — `body` was overwritten in place. Those rows are recorded as 'approved_unknown', NOT as
 * approved_unedited. Assuming the historical approvals were verbatim would invent exactly the
 * number this whole exercise exists to measure honestly, in the flattering direction.
 */
export async function backfillOutcomes(): Promise<{
    drafts: number; questions: number; nudges: number; reconciled: Awaited<ReturnType<typeof reconcileOutcomes>>;
}> {
    // Drafts. Verdict is derived from the row's own status; the intent prefix is parsed out of the
    // reason exactly as the live hook does.
    const draftRows: any = await db.execute(sql`
        SELECT id, conversation_id, phone, body, source, reason, status, approved_by, approved_at,
               created_at, sent_at, sent_message_id
        FROM message_drafts
        WHERE id NOT IN (SELECT ref_id FROM agent_outcomes WHERE kind = 'draft')
        ORDER BY created_at
    `);

    let drafts = 0;
    for (const d of (draftRows.rows ?? draftRows)) {
        const { capability, reason } = parseCapability(d.reason, d.source === 'recovery' ? 'nudge' : 'other');
        const by: string | null = d.approved_by ?? null;
        const byMachine = !!by && /^(comms_agent|first_contact_ack):/.test(by);

        let verdict: Verdict = 'pending';
        if (d.status === 'rejected') {
            verdict = byMachine || /superseded|replaced/i.test(by ?? '') ? 'superseded' : 'rejected';
        } else if (d.status === 'sent' || d.status === 'approved') {
            verdict = byMachine ? 'auto_sent' : UNKNOWN_EDIT_VERDICT;
        } else if (d.status === 'failed') {
            verdict = byMachine ? 'auto_sent' : UNKNOWN_EDIT_VERDICT;
        } else if (new Date(d.created_at).getTime() < Date.now() - EXPIRY_DAYS * 864e5) {
            verdict = 'expired';
        }

        const slug = String(d.body || '').match(/\/quote\/([a-z0-9]{6,12})\b/i)?.[1] ?? null;
        const sendStatus = d.status === 'sent' ? 'sent' : d.status === 'failed' ? 'failed' : null;

        await db.execute(sql`
            INSERT INTO agent_outcomes (
                id, agent, capability, kind, source, ref_id, conversation_id, phone, phone_key,
                quote_slug, proposed_body, reason, proposed_at, verdict, decided_by, decided_at,
                time_to_action_seconds, send_status, sent_at, sent_message_id, backfilled, meta
            ) VALUES (
                ${'out_bf_' + d.id}, ${AGENT_BY_SOURCE[d.source] ?? 'system'}, ${capability}, 'draft',
                ${d.source}, ${d.id}, ${d.conversation_id ?? null}, ${d.phone},
                ${commsPhoneKey(d.phone)}, ${slug}, ${d.body}, ${reason || null}, ${d.created_at},
                ${verdict}, ${by}, ${d.approved_at ?? null},
                ${d.approved_at ? Math.max(0, Math.round((new Date(d.approved_at).getTime() - new Date(d.created_at).getTime()) / 1000)) : null},
                ${sendStatus}, ${d.sent_at ?? null}, ${d.sent_message_id ?? null}, true,
                ${JSON.stringify({ note: 'backfilled: pre-edit text was never captured, so an approval cannot be scored as unedited' })}::jsonb
            )
            ON CONFLICT (kind, ref_id) DO NOTHING
        `);
        drafts++;
    }

    const questions: any = await db.execute(sql`
        INSERT INTO agent_outcomes (
            id, agent, capability, kind, source, ref_id, conversation_id, phone, phone_key,
            proposed_body, reason, proposed_at, verdict, decided_by, decided_at,
            time_to_action_seconds, final_body, backfilled, meta
        )
        SELECT 'out_bf_' || q.id, 'comms', 'ask_ben', 'question', q.source, q.id, q.conversation_id,
               q.phone, right(regexp_replace(COALESCE(q.phone, ''), '[^0-9]', '', 'g'), 10),
               q.question, q.context, q.created_at,
               CASE q.status
                   WHEN 'open'      THEN CASE WHEN q.created_at < now() - ${sql.raw(`interval '${EXPIRY_DAYS} days'`)}
                                              THEN 'expired' ELSE 'pending' END
                   WHEN 'dismissed' THEN 'dismissed'
                   ELSE 'answered' END,
               q.answered_by, q.answered_at,
               CASE WHEN q.answered_at IS NULL THEN NULL
                    ELSE GREATEST(0, EXTRACT(epoch FROM (q.answered_at - q.created_at))::int) END,
               q.answer, true,
               jsonb_build_object('options', COALESCE(q.options, '[]'::jsonb))
        FROM agent_questions q
        WHERE q.id NOT IN (SELECT ref_id FROM agent_outcomes WHERE kind = 'question')
        ON CONFLICT (kind, ref_id) DO NOTHING
        RETURNING id
    `);

    // Nudges are mirrored by the same statement reconcile uses, so there is one definition of
    // how a nudge_queue row maps onto a ledger row.
    const reconciled = await reconcileOutcomes({ limit: 2000 });

    return {
        drafts,
        questions: (questions.rows ?? questions).length,
        nudges: reconciled.nudgesMirrored,
        reconciled,
    };
}

// ---------------------------------------------------------------------------------- metrics

export interface CapabilityMetrics {
    agent: string;
    capability: string;
    proposals: number;
    /** approved_unedited + approved_edited + rejected — the only rows a human actually judged. */
    humanDecided: number;
    approvedUnedited: number;
    approvedEdited: number;
    rejected: number;
    /** Approvals from before the ledger existed: real, but not scoreable for edits. */
    approvedUnknown: number;
    autoSent: number;
    pending: number;
    expired: number;
    approvalRate: number | null;
    /** THE trust-ladder number: of everything a human judged, how much went out untouched. */
    uneditedRate: number | null;
    rejectionRate: number | null;
    medianEditRatio: number | null;
    medianTimeToActionSeconds: number | null;
    sent: number;
    replies: number;
    replyRate: number | null;
    medianReplyLatencySeconds: number | null;
    conversions: number;
    conversionValuePence: number;
}

const median = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/**
 * Aggregate the ledger, by agent and by capability.
 *
 * Rates are null rather than 0 when the denominator is empty, so the UI can say "no data yet"
 * instead of showing a confident 0% that reads as failure.
 */
export async function outcomeMetrics(opts: { days?: number; agent?: string; includeTest?: boolean } = {}): Promise<{
    byAgent: CapabilityMetrics[];
    byCapability: CapabilityMetrics[];
    windowDays: number;
}> {
    const days = opts.days ?? 90;
    const rows: any = await db.execute(sql`
        SELECT agent, capability, verdict, send_status, edit_ratio, time_to_action_seconds,
               customer_replied_at, reply_latency_seconds, converted_quote_id,
               COALESCE(conversion_value_pence, 0) AS conversion_value_pence
        FROM agent_outcomes
        WHERE proposed_at >= now() - ${sql.raw(`interval '${Math.max(1, Math.min(3650, days))} days'`)}
          ${opts.includeTest ? sql`` : SCRUB_TEST}
          ${opts.agent ? sql`AND agent = ${opts.agent}` : SCRUB_HUMAN}
    `);

    const build = (list: any[], agent: string, capability: string): CapabilityMetrics => {
        const count = (v: string) => list.filter((r) => r.verdict === v).length;
        // median() works in whole numbers (it averages the middle pair), so ratios are carried in
        // per-mille and converted back — otherwise every edit ratio would round to 0.
        const editPerMille = median(list
            .filter((r) => r.verdict === 'approved_edited' && r.edit_ratio != null)
            .map((r) => Math.round(Number(r.edit_ratio) * 1000)));
        const approvedUnedited = count('approved_unedited');
        const approvedEdited = count('approved_edited');
        const rejected = count('rejected');
        const humanDecided = approvedUnedited + approvedEdited + rejected;
        const sentRows = list.filter((r) => r.send_status === 'sent');
        const replied = sentRows.filter((r) => r.customer_replied_at);
        const converted = sentRows.filter((r) => r.converted_quote_id);

        return {
            agent,
            capability,
            proposals: list.length,
            humanDecided,
            approvedUnedited,
            approvedEdited,
            rejected,
            approvedUnknown: count(UNKNOWN_EDIT_VERDICT),
            autoSent: count('auto_sent'),
            pending: count('pending'),
            expired: count('expired'),
            approvalRate: rate(approvedUnedited + approvedEdited, humanDecided),
            uneditedRate: rate(approvedUnedited, humanDecided),
            rejectionRate: rate(rejected, humanDecided),
            medianEditRatio: editPerMille === null ? null : editPerMille / 1000,
            medianTimeToActionSeconds: median(list
                .filter((r) => (HUMAN_VERDICTS as readonly string[]).includes(r.verdict) && r.time_to_action_seconds != null)
                .map((r) => Number(r.time_to_action_seconds))),
            sent: sentRows.length,
            replies: replied.length,
            replyRate: rate(replied.length, sentRows.length),
            medianReplyLatencySeconds: median(replied.filter((r) => r.reply_latency_seconds != null)
                .map((r) => Number(r.reply_latency_seconds))),
            conversions: converted.length,
            conversionValuePence: converted.reduce((s, r) => s + Number(r.conversion_value_pence || 0), 0),
        };
    };

    const all = (rows.rows ?? rows) as any[];
    const agents = Array.from(new Set(all.map((r) => r.agent)));
    const byAgent = agents.map((a) => build(all.filter((r) => r.agent === a), a, '(all)'))
        .sort((a, b) => b.proposals - a.proposals);

    const pairs = Array.from(new Set(all.map((r) => `${r.agent} ${r.capability}`)));
    const byCapability = pairs.map((p) => {
        const [a, c] = p.split(' ');
        return build(all.filter((r) => r.agent === a && r.capability === c), a, c);
    }).sort((x, y) => y.proposals - x.proposals);

    return { byAgent, byCapability, windowDays: days };
}

/** The read-side of the loop: proposal, edit and outcome side by side for a human to read. */
export async function recentDecisions(opts: {
    limit?: number; agent?: string; verdict?: string; includeTest?: boolean;
} = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
    const rows: any = await db.execute(sql`
        SELECT id, agent, capability, kind, source, ref_id, conversation_id, phone, quote_slug,
               proposed_body, final_body, reason, verdict, decided_by, decided_at, proposed_at,
               time_to_action_seconds, edit_distance, edit_ratio, send_status, sent_at,
               customer_replied_at, reply_latency_seconds, converted_quote_id, converted_at,
               conversion_value_pence, backfilled
        FROM agent_outcomes
        WHERE 1 = 1
          ${opts.includeTest ? sql`` : SCRUB_TEST}
          ${opts.agent ? sql`AND agent = ${opts.agent}` : sql``}
          ${opts.verdict ? sql`AND verdict = ${opts.verdict}` : sql``}
        ORDER BY COALESCE(decided_at, proposed_at) DESC
        LIMIT ${limit}
    `);
    return (rows.rows ?? rows) as any[];
}

// ---------------------------------------------------------------------------------- feedback

/**
 * Config for the feedback channels. Stored in app_settings, read fresh every time, SHIPS OFF.
 *
 * `fewShot.enabled` is the only switch that can change agent behaviour, and flipping it back off
 * fully reverses the change — nothing is written into a prompt file, nothing persists in a model.
 */
export interface OutcomeLoopConfig {
    fewShot: {
        /** OFF by default. When false, exportApprovedExamples() returns [] to agent callers. */
        enabled: boolean;
        /** Hard cap on examples handed to an agent, so context cannot be flooded by history. */
        limit: number;
        /** Only examples approved within this many days — the voice moves, old ones mislead. */
        maxAgeDays: number;
    };
}

const DEFAULT_LOOP_CONFIG: OutcomeLoopConfig = {
    fewShot: { enabled: false, limit: 6, maxAgeDays: 90 },
};

const LOOP_CONFIG_KEY = 'agent_outcomes';

export async function getOutcomeLoopConfig(): Promise<OutcomeLoopConfig> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, LOOP_CONFIG_KEY));
    const stored = (row?.value as Partial<OutcomeLoopConfig>) ?? {};
    return { fewShot: { ...DEFAULT_LOOP_CONFIG.fewShot, ...(stored.fewShot ?? {}) } };
}

export async function setOutcomeLoopConfig(patch: Partial<OutcomeLoopConfig>): Promise<OutcomeLoopConfig> {
    const current = await getOutcomeLoopConfig();
    const next: OutcomeLoopConfig = { fewShot: { ...current.fewShot, ...(patch.fewShot ?? {}) } };
    await db.insert(appSettings)
        .values({
            id: LOOP_CONFIG_KEY,
            key: LOOP_CONFIG_KEY,
            value: next,
            description: 'Outcome ledger feedback loop (server/agent-outcomes.ts). fewShot.enabled ships OFF.',
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
    return next;
}

export interface FewShotExample {
    capability: string;
    body: string;
    reason: string | null;
    approvedAt: string | null;
    /** True when the customer wrote back after it went out — the strongest example of all. */
    gotReply: boolean;
}

/**
 * The safe half of "self-improving": messages a human approved WITHOUT changing a word, offered
 * back to the agents as examples of what lands.
 *
 * This is the only automatic feedback path, and it is deliberately the weakest one available.
 * The agent does not rewrite its own prompt — an unauditable change that drifts silently and
 * cannot be diffed. It is handed a short, capped, dated list of texts a human already blessed, and
 * a run either used them or did not. Turning `fewShot.enabled` off restores the previous behaviour
 * exactly, with nothing to unwind.
 *
 * Guards, all of them deliberate:
 *   - ONLY verdict = 'approved_unedited'. Never an edited draft (Ben disagreed with the wording),
 *     never an auto-sent one (no human ever looked at it), never a backfilled 'approved_unknown'.
 *   - Never a test send. The Ofcom range is scrubbed, or the agents would be taught their own
 *     test fixtures back as examples of what a human liked.
 *   - Capped by config, hard-limited to 20 whatever the config says.
 *   - Age-bounded, because a voice that changed six months ago should not be taught back.
 *   - Returns [] unless the flag is on, so wiring a caller in is inert until someone switches it.
 *
 * `ignoreFlag` exists for the admin preview only: showing a human what WOULD be injected is not
 * injecting it, and being unable to see it before switching it on is how flags get switched on
 * blind.
 */
export async function exportApprovedExamples(opts: {
    agent?: string; capability?: string; limit?: number; ignoreFlag?: boolean;
    /** Tests only — lets the suite verify the filtering and the cap on rows it created itself. */
    includeTest?: boolean;
} = {}): Promise<FewShotExample[]> {
    const config = await getOutcomeLoopConfig();
    if (!config.fewShot.enabled && !opts.ignoreFlag) return [];

    const limit = Math.min(opts.limit ?? config.fewShot.limit, 20);
    const days = Math.max(1, Math.min(3650, config.fewShot.maxAgeDays));

    const rows: any = await db.execute(sql`
        SELECT capability, proposed_body, reason, decided_at, customer_replied_at
        FROM agent_outcomes
        WHERE verdict = 'approved_unedited'
          AND backfilled = false
          ${SCRUB_HUMAN}
          ${opts.includeTest ? sql`` : SCRUB_TEST}
          AND decided_at >= now() - ${sql.raw(`interval '${days} days'`)}
          ${opts.agent ? sql`AND agent = ${opts.agent}` : sql``}
          ${opts.capability ? sql`AND capability = ${opts.capability}` : sql``}
        ORDER BY decided_at DESC
        LIMIT ${limit}
    `);

    return (rows.rows ?? rows).map((r: any) => ({
        capability: r.capability,
        body: r.proposed_body,
        reason: r.reason ?? null,
        approvedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
        gotReply: !!r.customer_replied_at,
    }));
}

export interface OutcomePattern {
    agent: string;
    capability: string;
    severity: 'watch' | 'act';
    headline: string;
    detail: string;
    n: number;
}

/**
 * The other half: patterns surfaced to a human as a report. Nothing here changes any behaviour —
 * it is a list of sentences someone reads and decides about.
 *
 * Thresholds are conservative on purpose (minimum sample sizes, no ranking by significance) because
 * this system has already been burned by levers that looked real and dissolved under a confound
 * check — see docs/WHATSAPP-CONVERSATION-ANALYSIS.md, where three plausible conversion drivers
 * turned out to be artefacts of thread length. A pattern here is a prompt to go and look, never a
 * finding.
 */
export async function outcomePatterns(opts: { days?: number } = {}): Promise<OutcomePattern[]> {
    const { byCapability } = await outcomeMetrics({ days: opts.days ?? 90 });
    const patterns: OutcomePattern[] = [];

    for (const c of byCapability) {
        if (c.humanDecided >= 4 && c.uneditedRate !== null && c.uneditedRate <= 0.25) {
            patterns.push({
                agent: c.agent, capability: c.capability, severity: 'act', n: c.humanDecided,
                headline: `"${c.capability}" is rewritten or refused ${Math.round((1 - c.uneditedRate) * 100)}% of the time`,
                detail: `${c.approvedUnedited} of ${c.humanDecided} human decisions went out untouched. Read the edits below before letting this capability anywhere near auto-send.`,
            });
        } else if (c.humanDecided >= 4 && c.uneditedRate !== null && c.uneditedRate >= 0.8) {
            patterns.push({
                agent: c.agent, capability: c.capability, severity: 'watch', n: c.humanDecided,
                headline: `"${c.capability}" goes out unedited ${Math.round(c.uneditedRate * 100)}% of the time`,
                detail: `${c.approvedUnedited} of ${c.humanDecided} approved verbatim. This is the shape of a capability that could earn more autonomy — the decision is still a human's.`,
            });
        }

        if (c.humanDecided >= 4 && c.rejectionRate !== null && c.rejectionRate >= 0.5) {
            patterns.push({
                agent: c.agent, capability: c.capability, severity: 'act', n: c.humanDecided,
                headline: `"${c.capability}" is rejected ${Math.round(c.rejectionRate * 100)}% of the time`,
                detail: `${c.rejected} of ${c.humanDecided}. Either the agent is misreading when this applies, or the capability itself is wrong.`,
            });
        }

        if (c.sent >= 8 && c.conversions === 0) {
            patterns.push({
                agent: c.agent, capability: c.capability, severity: 'watch', n: c.sent,
                headline: `"${c.capability}" has never been followed by a deposit`,
                detail: `${c.sent} sent, ${c.replies} replies, 0 deposits within ${CONVERSION_WINDOW_DAYS} days. Not proof it does not work — attribution is thread-level and cash jobs are invisible — but worth asking what it is for.`,
            });
        }

        if (c.sent >= 8 && c.replyRate !== null && c.replyRate <= 0.15) {
            patterns.push({
                agent: c.agent, capability: c.capability, severity: 'watch', n: c.sent,
                headline: `"${c.capability}" gets a reply only ${Math.round(c.replyRate * 100)}% of the time`,
                detail: `${c.replies} of ${c.sent} sends were answered within ${REPLY_WINDOW_DAYS} days.`,
            });
        }
    }

    return patterns.sort((a, b) => (a.severity === b.severity ? b.n - a.n : a.severity === 'act' ? -1 : 1));
}
