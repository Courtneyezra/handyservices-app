/**
 * Verifies that call records actually join to comms conversations.
 *
 * The join is by digits-only phone number, because calls store E.164 and conversations store
 * WhatsApp `@c.us` keys. This checks the join lands on real rows rather than silently matching
 * nothing — the failure mode that would make calls-in-thread look "built" but be empty.
 *
 *   npx tsx scripts/_comms-calls-verify.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
    const [{ conversations, calls: callCount }] = await db.execute(sql`
        SELECT (SELECT count(*) FROM conversations) AS conversations,
               (SELECT count(*) FROM calls) AS calls
    `).then((r: any) => r.rows ?? r);
    console.log(`conversations=${conversations}  calls=${callCount}`);

    const matched: any = await db.execute(sql`
        SELECT count(DISTINCT c.id) AS convos_with_calls,
               count(*)             AS matched_calls
        FROM conversations c
        JOIN calls k
          ON regexp_replace(k.phone_number, '[^0-9]', '', 'g')
           = regexp_replace(c.phone_number, '[^0-9]', '', 'g')
    `).then((r: any) => (r.rows ?? r)[0]);
    console.log(`conversations with >=1 call: ${matched.convos_with_calls}`);
    console.log(`calls that land in a thread: ${matched.matched_calls} of ${callCount}`);

    const sample: any = await db.execute(sql`
        SELECT c.phone_number, count(*) AS n,
               count(k.transcription) FILTER (WHERE k.transcription IS NOT NULL AND k.transcription <> '') AS with_transcript
        FROM conversations c
        JOIN calls k
          ON regexp_replace(k.phone_number, '[^0-9]', '', 'g')
           = regexp_replace(c.phone_number, '[^0-9]', '', 'g')
        GROUP BY c.phone_number
        ORDER BY n DESC
        LIMIT 5
    `).then((r: any) => r.rows ?? r);
    console.log('\ntop threads by call count:');
    for (const row of sample) {
        console.log(`  ${row.phone_number}  calls=${row.n}  transcripts=${row.with_transcript}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
