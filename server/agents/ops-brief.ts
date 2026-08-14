/**
 * Morning Ops Brief — the FIRST HandyServices agent, built deliberately small
 * as the learning project: four READ-ONLY tools (it cannot change anything),
 * one clear goal, full transcript observability via the runner.
 *
 * Anatomy on show here:
 *   - Each tool's `description` is written FOR CLAUDE — it's how the agent
 *     decides which tool fits the moment. Vague descriptions = bad tool choice.
 *   - The system prompt sets role, output shape, and hard rules (no invented
 *     numbers — every figure must come from a tool result).
 *   - All queries scrub test data by the house convention (07700900xxx phones,
 *     names starting "Test").
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { runAgent, type AgentTool } from './runner';

const SCRUB = `q.phone NOT LIKE '%7700900%' AND q.customer_name NOT ILIKE 'test%'`;

const tools: AgentTool[] = [
    {
        name: 'get_quote_funnel',
        description:
            'Funnel counts for a recent window: quotes generated, viewed, and deposits paid, with £ totals. Call this first to anchor the brief. hours_back defaults to 24.',
        input_schema: {
            type: 'object',
            properties: { hours_back: { type: 'number', description: 'Window size in hours (default 24, max 168)' } },
        },
        run: async (input) => {
            const hours = Math.min(Math.max(Number(input?.hours_back) || 24, 1), 168);
            const r = await db.execute(sql.raw(`
                SELECT COUNT(*)::int AS generated,
                       COUNT(*) FILTER (WHERE q.viewed_at IS NOT NULL OR q.view_count > 0)::int AS viewed,
                       COUNT(*) FILTER (WHERE q.deposit_paid_at IS NOT NULL)::int AS paid,
                       COALESCE(SUM(q.base_price) FILTER (WHERE q.deposit_paid_at IS NOT NULL), 0)::bigint AS paid_value_pence,
                       COALESCE(SUM(q.base_price), 0)::bigint AS generated_value_pence
                FROM personalized_quotes q
                WHERE q.created_at >= now() - interval '${hours} hours' AND ${SCRUB}`));
            return { hours_back: hours, ...(r.rows[0] as object) };
        },
    },
    {
        name: 'get_offer_decisions',
        description:
            'What the offer router served in a recent window: counts per served play, plus any rules-vs-Claude-shadow disagreements (with the shadow rationale). Use for the "offer system" section of the brief.',
        input_schema: {
            type: 'object',
            properties: { hours_back: { type: 'number', description: 'Window size in hours (default 24, max 168)' } },
        },
        run: async (input) => {
            const hours = Math.min(Math.max(Number(input?.hours_back) || 24, 1), 168);
            const mix = await db.execute(sql.raw(`
                SELECT d.served_play, COUNT(*)::int AS n
                FROM quote_offer_decisions d JOIN personalized_quotes q ON q.id = d.quote_id
                WHERE d.decided_at >= now() - interval '${hours} hours' AND ${SCRUB}
                GROUP BY d.served_play ORDER BY n DESC`));
            const disagreements = await db.execute(sql.raw(`
                SELECT d.slug, d.rule_fired, d.target_play, d.shadow_play, left(d.shadow_rationale, 160) AS shadow_rationale
                FROM quote_offer_decisions d JOIN personalized_quotes q ON q.id = d.quote_id
                WHERE d.decided_at >= now() - interval '${hours} hours'
                  AND d.shadow_play IS NOT NULL AND d.shadow_play <> d.target_play AND ${SCRUB}
                LIMIT 10`));
            return { hours_back: hours, servedPlays: mix.rows, disagreements: disagreements.rows };
        },
    },
    {
        name: 'get_stalled_quotes',
        description:
            'Live quotes that look STALLED: viewed at least twice, no deposit, created in the last 14 days. Returns the most valuable first (slug, first name, £, views, last viewed). Use for the "needs a nudge" section.',
        input_schema: {
            type: 'object',
            properties: { limit: { type: 'number', description: 'Max rows (default 5)' } },
        },
        run: async (input) => {
            const limit = Math.min(Math.max(Number(input?.limit) || 5, 1), 20);
            const r = await db.execute(sql.raw(`
                SELECT q.short_slug, split_part(q.customer_name, ' ', 1) AS first_name,
                       q.base_price, q.view_count, q.last_viewed_at::date AS last_viewed
                FROM personalized_quotes q
                WHERE q.created_at >= now() - interval '14 days'
                  AND q.deposit_paid_at IS NULL AND q.view_count >= 2 AND ${SCRUB}
                ORDER BY q.base_price DESC NULLS LAST LIMIT ${limit}`));
            return r.rows;
        },
    },
    {
        name: 'get_recent_payments',
        description:
            'Deposits paid in a recent window: slug, first name, quote £, when. Use for the "won" section of the brief. hours_back defaults to 24.',
        input_schema: {
            type: 'object',
            properties: { hours_back: { type: 'number', description: 'Window size in hours (default 24, max 168)' } },
        },
        run: async (input) => {
            const hours = Math.min(Math.max(Number(input?.hours_back) || 24, 1), 168);
            const r = await db.execute(sql.raw(`
                SELECT q.short_slug, split_part(q.customer_name, ' ', 1) AS first_name,
                       q.base_price, q.deposit_paid_at
                FROM personalized_quotes q
                WHERE q.deposit_paid_at >= now() - interval '${hours} hours' AND ${SCRUB}
                ORDER BY q.deposit_paid_at DESC`));
            return r.rows;
        },
    },
];

const SYSTEM = `You are the HandyServices morning ops brief writer — a sharp, terse operations manager reporting to the owner (Courtnee).

Rules:
- EVERY number in your brief must come from a tool result. Never estimate or invent figures. If a tool returns nothing, say so plainly ("no deposits yesterday") rather than padding.
- Look at the last 24 hours by default; widen a window only if the day looks empty and context would help (say so when you do).
- Output: a WhatsApp-friendly brief under 200 words. Sections, in order, skipping any that are empty: WON (payments), FUNNEL (generated/viewed/paid + £), NEEDS A NUDGE (top stalled quotes, one line each with slug + first name + £), OFFER SYSTEM (play mix in one line; call out any rules-vs-shadow disagreement as it may need review).
- End with ONE recommended action for today — the single highest-value thing in the data. No filler, no pleasantries.`;

export async function runOpsBrief() {
    return runAgent({
        name: 'ops-brief',
        system: SYSTEM,
        goal: 'Write this morning\'s ops brief.',
        tools,
        maxTurns: 6,
    });
}
