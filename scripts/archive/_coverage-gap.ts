import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NTc = sql`(phone_number IS NULL OR (phone_number NOT LIKE '%447700900%' AND phone_number NOT LIKE '%07700900%' AND phone_number NOT LIKE '%449900001%'))`;
const EHB = sql`CASE WHEN handled_by IS NOT NULL THEN handled_by WHEN missed_reason IN ('no_answer','busy_agent') OR outcome IN ('MISSED_CALL','NO_ANSWER','FAILED','DROPPED_EARLY') THEN 'missed' WHEN outcome IN ('VOICEMAIL','VOICEMAIL_LEFT') THEN 'voicemail' WHEN eleven_labs_conversation_id IS NOT NULL THEN 'ai_agent' WHEN coalesce(duration,0)>=15 AND length(coalesce(transcription,''))>=120 THEN 'va' ELSE 'missed' END`;
const dow = sql`to_char(start_time AT TIME ZONE 'Europe/London','Dy')`;
const down = sql`EXTRACT(DOW FROM start_time AT TIME ZONE 'Europe/London')`;
console.log('=== CALLS by day of week (UK), last 60 days ===');
const d = await db.execute(sql`
  SELECT ${dow} AS day, ${down} AS dn, count(*)::int AS calls,
    count(*) FILTER (WHERE ${EHB}='va')::int AS ben,
    count(*) FILTER (WHERE ${EHB}='ai_agent')::int AS ai,
    count(*) FILTER (WHERE ${EHB}='missed')::int AS missed
  FROM calls WHERE ${NTc} AND start_time >= now() - interval '60 days' GROUP BY 1,2 ORDER BY 2`);
for(const x of d.rows as any[]){ const ar=x.calls?(100*(x.ben+x.ai)/x.calls).toFixed(0):'-'; console.log(`${x.day}  calls ${String(x.calls).padStart(3)}  ben ${String(x.ben).padStart(3)}  ai ${String(x.ai).padStart(3)}  missed ${String(x.missed).padStart(3)}  answered ${ar}%`); }

console.log('\n=== CALLS by UK hour block, last 60 days ===');
const h = await db.execute(sql`
  SELECT CASE WHEN EXTRACT(HOUR FROM start_time AT TIME ZONE 'Europe/London')<9 THEN '00-09 (before open)'
              WHEN EXTRACT(HOUR FROM start_time AT TIME ZONE 'Europe/London')<17 THEN '09-17 (Ben hours)'
              ELSE '17-24 (after 5pm)' END AS block,
    count(*)::int AS calls,
    count(*) FILTER (WHERE ${EHB}='va')::int AS ben,
    count(*) FILTER (WHERE ${EHB}='missed')::int AS missed
  FROM calls WHERE ${NTc} AND start_time >= now() - interval '60 days' GROUP BY 1 ORDER BY 1`);
for(const x of h.rows as any[]){ console.log(`${x.block.padEnd(20)} calls ${String(x.calls).padStart(3)}  ben ${String(x.ben).padStart(3)}  missed ${String(x.missed).padStart(3)}`); }

console.log('\n=== The gap windows: Sunday + weekday after-5pm ===');
const g = await db.execute(sql`
  SELECT
    count(*) FILTER (WHERE ${down}=0)::int AS sunday_calls,
    count(*) FILTER (WHERE ${down}=0 AND ${EHB}='va')::int AS sunday_ben,
    count(*) FILTER (WHERE ${down} BETWEEN 1 AND 5 AND EXTRACT(HOUR FROM start_time AT TIME ZONE 'Europe/London')>=17)::int AS wkday_eve,
    count(*) FILTER (WHERE ${down} BETWEEN 1 AND 5 AND EXTRACT(HOUR FROM start_time AT TIME ZONE 'Europe/London')>=17 AND ${EHB}='va')::int AS wkday_eve_ben
  FROM calls WHERE ${NTc} AND start_time >= now() - interval '60 days'`);
const x = g.rows[0] as any;
console.log(`Sundays:            ${x.sunday_calls} calls, Ben answered ${x.sunday_ben}`);
console.log(`Weekday after-5pm:  ${x.wkday_eve} calls, Ben answered ${x.wkday_eve_ben}`);
process.exit(0);
