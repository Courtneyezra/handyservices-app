/**
 * Recovery Agent — session one. Watches unpaid quotes in the dead funnel
 * moments (never-opened / viewed-once / stalled / near-expiry), reads each
 * customer's case file, and DRAFTS WhatsApp nudges into nudge_queue for
 * human approval. It cannot send anything.
 *
 * Outcome contract (the reason this agent exists):
 *   METRIC     £ of stalled quotes recovered (nudge → deposit_paid within 7d)
 *   BASELINE   £0 recovered today — no follow-up route exists at all
 *   MECHANISM  zero → one personalised follow-up per stalled quote
 *   GATE COST  ~5 min/day of Ben approving drafts (wa.me prefill, he sends)
 *   KILL       4 weeks of approved nudges recovering £0 → stop, learn why
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { runAgent, type AgentTool } from './runner';

const SCRUB = `q.phone NOT LIKE '%7700900%' AND q.customer_name NOT ILIKE 'test%'`;

/** Digits-suffix phone matcher: quotes store "+447…", WhatsApp conversations
 *  store "447…@c.us" — the last 10 digits are the stable join key. */
const DIGITS10 = (col: string) => `right(regexp_replace(${col}, '\\D', '', 'g'), 10)`;

const tools: AgentTool[] = [
    {
        name: 'get_recovery_candidates',
        description:
            'The work list: unpaid real-customer quotes from the last 21 days that have had NO nudge in the last 5 days and fewer than 3 lifetime nudges. Each row carries its funnel state (never_opened | viewed_once | stalled), £, views, days since last view/creation, expiry, whether a free gift was claimed, and how many nudges it has already had. Call this FIRST, once.',
        input_schema: { type: 'object', properties: {} },
        run: async () => {
            const r = await db.execute(sql.raw(`
                SELECT q.short_slug, split_part(q.customer_name, ' ', 1) AS first_name,
                       q.phone, q.base_price, q.view_count,
                       CASE WHEN COALESCE(q.view_count, 0) = 0 THEN 'never_opened'
                            WHEN q.view_count >= 2 THEN 'stalled'
                            ELSE 'viewed_once' END AS state,
                       EXTRACT(day FROM now() - q.created_at)::int AS days_old,
                       EXTRACT(day FROM now() - COALESCE(q.last_viewed_at, q.created_at))::int AS days_quiet,
                       (q.expires_at IS NOT NULL AND q.expires_at < now() + interval '3 days' AND q.expires_at > now()) AS expiring_soon,
                       (q.expires_at IS NOT NULL AND q.expires_at < now()) AS expired,
                       q.claimed_gift_id IS NOT NULL AS gift_claimed,
                       COALESCE(n.total, 0)::int AS prior_nudges
                FROM personalized_quotes q
                LEFT JOIN (
                    SELECT quote_id, COUNT(*) AS total, MAX(created_at) AS last_at
                    FROM nudge_queue WHERE status <> 'dismissed' GROUP BY quote_id
                ) n ON n.quote_id = q.id
                WHERE q.created_at >= now() - interval '21 days'
                  AND q.deposit_paid_at IS NULL
                  AND ${SCRUB}
                  AND COALESCE(n.total, 0) < 3
                  AND (n.last_at IS NULL OR n.last_at < now() - interval '5 days')
                ORDER BY q.base_price DESC NULLS LAST
                LIMIT 12`));
            return r.rows;
        },
    },
    {
        name: 'get_case_file',
        description:
            'The customer\'s chronological thread for a phone number: recent calls (with transcript snippets when available), WhatsApp messages BOTH directions, and any prior nudges. USE THIS BEFORE EVERY NUDGE DECISION — if the customer sent an inbound message in the last 3 days they are already in conversation and you must skip, and recent outbound contact means do not pile on.',
        input_schema: {
            type: 'object',
            properties: { phone: { type: 'string', description: 'Customer phone in any format' } },
            required: ['phone'],
        },
        run: async (input) => {
            const digits = String(input?.phone || '').replace(/\D/g, '').slice(-10);
            if (digits.length < 7) return { error: 'phone too short to match' };
            const calls = await db.execute(sql.raw(`
                SELECT start_time, direction, left(COALESCE(transcription, '(no transcript)'), 400) AS transcript
                FROM calls WHERE ${DIGITS10('phone_number')} = '${digits}'
                ORDER BY start_time DESC LIMIT 3`));
            const msgs = await db.execute(sql.raw(`
                SELECT m.created_at, m.direction, m.type, left(COALESCE(m.content, '(' || m.type || ')'), 280) AS content
                FROM messages m JOIN conversations c ON c.id = m.conversation_id
                WHERE ${DIGITS10('c.phone_number')} = '${digits}'
                ORDER BY m.created_at DESC LIMIT 25`));
            const nudges = await db.execute(sql.raw(`
                SELECT created_at, status, lever, left(COALESCE(message, reason), 200) AS text
                FROM nudge_queue WHERE ${DIGITS10('phone')} = '${digits}'
                ORDER BY created_at DESC LIMIT 5`));
            return { calls: calls.rows, whatsapp: msgs.rows, priorNudges: nudges.rows };
        },
    },
    {
        name: 'get_quote_context',
        description:
            'Everything about one quote by slug: the line items with prices, agreed total, customer type, the offer system\'s stakes read and served play, expiry, and whether the split lever is available (2+ line items). Use it to pick the right lever and write a specific message.',
        input_schema: {
            type: 'object',
            properties: { slug: { type: 'string' } },
            required: ['slug'],
        },
        run: async (input) => {
            const slug = String(input?.slug || '').replace(/[^a-z0-9]/gi, '');
            const q = await db.execute(sql.raw(`
                SELECT q.short_slug, q.customer_name, q.base_price, q.customer_type,
                       q.expires_at, q.job_description, q.claimed_gift_id,
                       (SELECT jsonb_agg(jsonb_build_object(
                            'description', e->>'description',
                            'pricePence', COALESCE((e->>'guardedPricePence')::int, 0)))
                        FROM jsonb_array_elements(COALESCE(q.pricing_line_items, '[]'::jsonb)) e) AS lines,
                       d.served_play, d.inputs->>'stakes' AS stakes
                FROM personalized_quotes q
                LEFT JOIN LATERAL (
                    SELECT * FROM quote_offer_decisions
                    WHERE quote_id = q.id ORDER BY decided_at DESC LIMIT 1
                ) d ON true
                WHERE q.short_slug = '${slug}' LIMIT 1`));
            const row: any = q.rows[0];
            if (!row) return { error: 'quote not found' };
            const lineCount = Array.isArray(row.lines) ? row.lines.length : 0;
            return { ...row, splitAvailable: lineCount >= 2 };
        },
    },
    {
        name: 'queue_nudge',
        description:
            'Propose ONE follow-up for a quote. The message is a complete WhatsApp text, ready to send after human approval. It MUST include the quote link https://handyservices.app/quote/<slug>, MUST NOT mention discounts, price changes, or promised dates, and should be under 60 words. lever is one of: reminder | split | reassure | expiry | gift_unclaimed. reason is one sentence of why this angle for this customer.',
        input_schema: {
            type: 'object',
            properties: {
                slug: { type: 'string' },
                lever: { type: 'string', enum: ['reminder', 'split', 'reassure', 'expiry', 'gift_unclaimed'] },
                message: { type: 'string' },
                reason: { type: 'string' },
            },
            required: ['slug', 'lever', 'message', 'reason'],
        },
        run: async (input) => {
            const slug = String(input.slug).replace(/[^a-z0-9]/gi, '');
            const message = String(input.message).slice(0, 1000);
            if (!message.includes(`/quote/${slug}`)) {
                throw new Error(`Message must contain the quote link https://handyservices.app/quote/${slug}`);
            }
            if (/discount|% off|money off|reduce the price|knock off/i.test(message)) {
                throw new Error('Nudges must not offer discounts or price changes.');
            }
            const q = await db.execute(sql.raw(
                `SELECT id, phone FROM personalized_quotes WHERE short_slug = '${slug}' LIMIT 1`));
            const quote: any = q.rows[0];
            if (!quote) throw new Error('quote not found');
            await db.execute(sql`
                INSERT INTO nudge_queue (id, quote_id, slug, phone, status, lever, message, reason)
                VALUES (gen_random_uuid()::varchar, ${quote.id}, ${slug}, ${quote.phone}, 'proposed',
                        ${String(input.lever)}, ${message}, ${String(input.reason).slice(0, 500)})`);
            return { queued: true, slug };
        },
    },
    {
        name: 'skip',
        description:
            'Explicitly decline to nudge a quote, with a one-sentence reason (e.g. "customer replied yesterday — already in conversation", "declined on the call", "too soon since last contact"). Call this OR queue_nudge for every candidate — never leave one undecided.',
        input_schema: {
            type: 'object',
            properties: { slug: { type: 'string' }, reason: { type: 'string' } },
            required: ['slug', 'reason'],
        },
        run: async (input) => {
            const slug = String(input.slug).replace(/[^a-z0-9]/gi, '');
            const q = await db.execute(sql.raw(
                `SELECT id, phone FROM personalized_quotes WHERE short_slug = '${slug}' LIMIT 1`));
            const quote: any = q.rows[0];
            if (!quote) throw new Error('quote not found');
            await db.execute(sql`
                INSERT INTO nudge_queue (id, quote_id, slug, phone, status, reason)
                VALUES (gen_random_uuid()::varchar, ${quote.id}, ${slug}, ${quote.phone}, 'skipped',
                        ${String(input.reason).slice(0, 500)})`);
            return { skipped: true, slug };
        },
    },
];

const SYSTEM = `You are the HandyServices recovery assistant. Unpaid quotes go quiet and nobody follows up — your job is to draft the follow-up WhatsApp message a thoughtful, unpushy tradesperson's assistant would send. A human (Ben) reviews and sends every message; you only propose.

Process, strictly:
1. get_recovery_candidates once.
2. For EVERY candidate: get_case_file (their phone) and get_quote_context (their slug) before deciding. You may fetch several candidates' data in parallel.
3. Decide: queue_nudge OR skip, for every candidate. Never leave one undecided.

Hard rules:
- SKIP if the case file shows an inbound message in the last 3 days (they're already talking to us), any sign they declined or asked us to stop, or anything that would make a follow-up feel pushy.
- One nudge per customer per run.
- Messages: warm, brief (under 60 words), first name, ONE clear action — open the quote link and pick a day in it. Never offer discounts or price changes. Never promise dates or availability. No guilt-tripping, no "just checking in" filler — give them a real reason to look again.
- Pick the lever from the data: split (see constraint below), reassure (high stakes — lead with the guarantee/fix-it-free), gift_unclaimed (gift claimed or available but never booked — remind them it's waiting), expiry (expiring within 3 days — honest heads-up, no pressure), reminder (everything else).
- SPLIT LEVER CONSTRAINT (learned 15 Aug, Sukhy case): split is ONLY valid when the line items are genuinely INDEPENDENT jobs a handyman could do on separate visits (e.g. "fix tap" + "paint fence" + "hang shelves"). It is WRONG for lines that are sequential parts of ONE build or deliverable (e.g. "build enclosure" + "fit its roof" + "apply its finish" — you cannot do the roof without the build). Test each line: "would doing ONLY this line make sense as a standalone visit?" If any doubt, use reminder instead.
- ASSUME THE CASE FILE MAY BE INCOMPLETE (learned 15 Aug): some WhatsApp conversations happen on channels our ingest doesn't capture, so an empty case file does NOT prove silence. When a customer shows HIGH engagement (many recent views) but the case file is empty, note in your reason that they may already be in conversation — the human reviewer will know. Never reference "you haven't been in touch" in a message.
- British tone, like texting a customer you respect. Sign off naturally as Ben.

Finish with a short summary: how many nudged, how many skipped, and anything odd you noticed in the data.`;

export async function runRecovery() {
    return runAgent({
        name: 'recovery',
        system: SYSTEM,
        goal: 'Review the current recovery candidates and queue follow-ups for approval.',
        tools,
        maxTurns: 14,
        maxTokens: 12000,
    });
}
