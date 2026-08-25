import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const NOT_TEST = sql`(phone_number IS NULL OR (phone_number NOT LIKE '%447700900%' AND phone_number NOT LIKE '%07700900%' AND phone_number NOT LIKE '%449900001%'))`;
const rows = await db.execute(sql`
  SELECT
    to_char(start_time AT TIME ZONE 'Europe/London','HH24:MI:SS') AS t,
    phone_number, handled_by, outcome, missed_reason,
    ring_seconds AS ring, duration AS dur,
    (eleven_labs_conversation_id IS NOT NULL) AS is_ai,
    length(coalesce(transcription,'')) AS tlen
  FROM calls
  WHERE ${NOT_TEST}
    AND (start_time AT TIME ZONE 'Europe/London')::date = (now() AT TIME ZONE 'Europe/London')::date
  ORDER BY start_time`);
console.log(`Today (UK): ${rows.rows.length} calls`);
for (const r of rows.rows as any[]) {
  console.log(`${r.t}  ${String(r.phone_number||'—').padEnd(15)} hb=${String(r.handled_by??'NULL').padEnd(9)} out=${String(r.outcome??'—').padEnd(14)} miss=${String(r.missed_reason??'—').padEnd(10)} ring=${r.ring??'—'} dur=${r.dur??'—'} ai=${r.is_ai} tlen=${r.tlen}`);
}
console.log(`\nUK time now: ${(await db.execute(sql`SELECT to_char(now() AT TIME ZONE 'Europe/London','Dy HH24:MI') AS n`)).rows[0].n}`);
process.exit(0);
