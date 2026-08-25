import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const NOT_TEST = sql`(phone_number IS NULL OR (phone_number NOT LIKE '%447700900%' AND phone_number NOT LIKE '%07700900%' AND phone_number NOT LIKE '%449900001%'))`;
const EFFECTIVE_HB = sql`
  CASE
    WHEN handled_by IS NOT NULL THEN handled_by
    WHEN missed_reason IN ('no_answer','busy_agent') OR outcome IN ('MISSED_CALL','NO_ANSWER','FAILED','DROPPED_EARLY') THEN 'missed'
    WHEN outcome IN ('VOICEMAIL','VOICEMAIL_LEFT') THEN 'voicemail'
    WHEN eleven_labs_conversation_id IS NOT NULL THEN 'ai_agent'
    WHEN coalesce(duration,0) >= 15 AND length(coalesce(transcription,'')) >= 120 THEN 'va'
    ELSE 'missed'
  END`;
const MISSED_KIND = sql`
  CASE
    WHEN NOT (${EFFECTIVE_HB} = 'missed') THEN NULL
    WHEN missed_reason IN ('no_answer','busy_agent') OR outcome IN ('MISSED_CALL','NO_ANSWER','FAILED') THEN 'no_answer'
    WHEN coalesce(duration,0) < 10 THEN 'abandoned'
    ELSE 'no_answer'
  END`;
const IS_ABANDONED = sql`${MISSED_KIND} = 'abandoned'`;

// Last 30 days of abandoned (<10s hang-up) calls
const ab = await db.execute(sql`
  SELECT id, phone_number, start_time, duration, outcome
  FROM calls
  WHERE ${NOT_TEST} AND ${IS_ABANDONED}
    AND start_time >= now() - interval '30 days'
  ORDER BY start_time DESC`);
const rows = ab.rows as any[];
console.log(`\n=== Abandoned (<10s hang-up) calls, last 30 days: ${rows.length} ===\n`);

const nums = rows.map(r => (r.phone_number||'').replace(/\s/g,'')).filter(Boolean);
const uniq = new Set(nums);
console.log(`Unique numbers: ${uniq.size} (of ${nums.length} calls)`);

// For each abandoned number: did they call again (any call) and get answered? did they become a lead/quote?
let selfRecovered = 0, becameQuote = 0, neverSeenAgain = 0, existingCustomer = 0;
const detail: string[] = [];
for (const num of uniq) {
  const digits = num.replace(/^\+?44/,'0').replace(/\D/g,'');
  const last9 = digits.slice(-9);
  // any later ANSWERED call from same number
  const other = await db.execute(sql`
    SELECT count(*) FILTER (WHERE ${EFFECTIVE_HB} IN ('va','ai_agent'))::int AS answered,
           count(*)::int AS total
    FROM calls WHERE ${NOT_TEST}
      AND regexp_replace(coalesce(phone_number,''),'\D','','g') LIKE ${'%'+last9}`);
  const o = other.rows[0] as any;
  // matching quote by phone
  const q = await db.execute(sql`
    SELECT count(*)::int AS n FROM personalized_quotes
    WHERE regexp_replace(coalesce(phone,''),'\D','','g') LIKE ${'%'+last9}`);
  const quotes = Number((q.rows[0] as any).n);
  const answered = Number(o.answered);
  if (quotes > 0) becameQuote++;
  if (answered > 0) selfRecovered++;
  if (answered === 0 && quotes === 0) neverSeenAgain++;
  detail.push(`${num.padEnd(15)} calls=${o.total} answeredEver=${answered} quotes=${quotes}`);
}
console.log(`\nOf ${uniq.size} unique hang-up numbers:`);
console.log(`  ${selfRecovered} later had an ANSWERED call (self-recovered / reached us another way)`);
console.log(`  ${becameQuote} have a quote on file (real customers)`);
console.log(`  ${neverSeenAgain} never answered AND no quote (truly lost / possible callback targets)`);
console.log(`\nPer-number:`);
detail.forEach(d => console.log('  '+d));
process.exit(0);
