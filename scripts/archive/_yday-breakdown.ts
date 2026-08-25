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

// "Yesterday" in UK time
const rows = await db.execute(sql`
  SELECT
    to_char(start_time AT TIME ZONE 'Europe/London','HH24:MI') AS t,
    phone_number,
    handled_by AS stored,
    ${EFFECTIVE_HB} AS effective,
    outcome, missed_reason,
    ring_seconds AS ring, duration AS dur,
    length(coalesce(transcription,'')) AS tlen,
    (eleven_labs_conversation_id IS NOT NULL) AS is_ai
  FROM calls
  WHERE ${NOT_TEST}
    AND (start_time AT TIME ZONE 'Europe/London')::date = ((now() AT TIME ZONE 'Europe/London')::date - 1)
  ORDER BY start_time
`);
for (const r of rows.rows as any[]) {
  console.log(
    `${r.t}  ${String(r.phone_number||'—').padEnd(15)} eff=${String(r.effective).padEnd(9)} stored=${String(r.stored??'NULL').padEnd(8)} out=${String(r.outcome??'—').padEnd(14)} miss=${String(r.missed_reason??'—').padEnd(10)} ring=${r.ring??'—'} dur=${r.dur??'—'} tlen=${r.tlen} ai=${r.is_ai}`
  );
}
process.exit(0);
