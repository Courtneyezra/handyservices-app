/**
 * Rank where Anthropic tokens are going, from the usage ledger.
 *
 *   npx tsx scripts/_llm-usage-report.ts            # last 24h
 *   npx tsx scripts/_llm-usage-report.ts --hours 72
 *
 * Rows come from system_events (source 'llm-usage'), written by the
 * getAnthropic() wrapper on every successful call: model, tokens, ~USD and
 * the calling function. Costs are approximations for RANKING, not billing.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const hoursArg = process.argv.indexOf('--hours');
const HOURS = hoursArg >= 0 ? Math.max(1, Number(process.argv[hoursArg + 1]) || 24) : 24;

(async () => {
    const bySrc: any = await db.execute(sql`
        SELECT detail->>'src' AS src, detail->>'model' AS model,
               count(*)::int AS calls,
               sum((detail->>'inTok')::numeric)::bigint AS in_tok,
               sum((detail->>'cacheWrite')::numeric)::bigint AS cache_write,
               sum((detail->>'cacheRead')::numeric)::bigint AS cache_read,
               sum((detail->>'outTok')::numeric)::bigint AS out_tok,
               round(sum((detail->>'usd')::numeric), 3) AS usd
        FROM system_events
        WHERE source = 'llm-usage' AND at > now() - (${HOURS} || ' hours')::interval
        GROUP BY 1, 2 ORDER BY usd DESC NULLS LAST LIMIT 25
    `);
    const total: any = await db.execute(sql`
        SELECT count(*)::int AS calls, round(sum((detail->>'usd')::numeric), 2) AS usd
        FROM system_events
        WHERE source = 'llm-usage' AND at > now() - (${HOURS} || ' hours')::interval
    `);

    console.log(`LLM usage, last ${HOURS}h — ${total.rows[0].calls} calls, ~$${total.rows[0].usd ?? 0} total\n`);
    console.log('src'.padEnd(42), 'model'.padEnd(22), 'calls'.padStart(6), 'in'.padStart(9), 'cW'.padStart(9), 'cR'.padStart(10), 'out'.padStart(8), 'usd'.padStart(8));
    for (const r of bySrc.rows) {
        console.log(
            String(r.src ?? '?').slice(0, 41).padEnd(42),
            String(r.model ?? '').replace('claude-', '').slice(0, 21).padEnd(22),
            String(r.calls).padStart(6), String(r.in_tok).padStart(9), String(r.cache_write).padStart(9),
            String(r.cache_read).padStart(10), String(r.out_tok).padStart(8), ('$' + (r.usd ?? 0)).padStart(8),
        );
    }
    process.exit(0);
})();
