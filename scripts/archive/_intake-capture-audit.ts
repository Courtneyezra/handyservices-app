/**
 * Intake-capture audit — how much of Ben's actual customer contact survives as data?
 *
 * Everything downstream (quote quality, the contractor's job brief, any agent) is capped by
 * what we captured at first contact. This measures the ceiling, per channel:
 *   - calls: inbound vs outbound, and how many carry a usable transcript
 *   - whatsapp: which sender numbers we actually see traffic on
 *   - conversations: how many are real threads vs empty shells
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const DAYS_BACK = 70;

async function main() {
    console.log(`\n=== INTAKE-CAPTURE AUDIT — last ${DAYS_BACK} days ===\n`);

    // 1. Calls by direction, and whether any usable content survived.
    const calls = await db.execute(sql`
        SELECT COALESCE(direction, 'unknown')                                   AS direction,
               COUNT(*)                                                         AS total,
               COUNT(*) FILTER (WHERE transcription IS NOT NULL
                                  AND LENGTH(TRIM(transcription)) > 40)         AS with_transcript,
               COUNT(*) FILTER (WHERE recording_url IS NOT NULL)                AS with_recording,
               ROUND(AVG(NULLIF(duration, 0)))                                  AS avg_secs
        FROM calls
        WHERE created_at >= NOW() - (${DAYS_BACK} || ' days')::interval
        GROUP BY 1
        ORDER BY total DESC
    `);
    console.log('--- Calls by direction ---');
    console.table((calls.rows as any[]).map((r) => ({
        direction: r.direction,
        calls: Number(r.total),
        withTranscript: Number(r.with_transcript),
        withRecording: Number(r.with_recording),
        transcriptPct: Number(r.total) ? Math.round((Number(r.with_transcript) / Number(r.total)) * 100) + '%' : '—',
        avgSecs: r.avg_secs ? Number(r.avg_secs) : 0,
    })));

    // 2. WhatsApp traffic by the number on our side — is Ben's personal line captured?
    const wa = await db.execute(sql`
        SELECT COALESCE(direction, 'unknown') AS direction,
               COUNT(*)                       AS msgs,
               COUNT(DISTINCT conversation_id) AS threads,
               MIN(created_at)::date          AS first_seen,
               MAX(created_at)::date          AS last_seen
        FROM messages
        WHERE created_at >= NOW() - (${DAYS_BACK} || ' days')::interval
        GROUP BY 1
        ORDER BY msgs DESC
    `);
    console.log('\n--- Messages by direction ---');
    console.table((wa.rows as any[]).map((r) => ({
        direction: r.direction,
        msgs: Number(r.msgs),
        threads: Number(r.threads),
        firstSeen: r.first_seen ? new Date(r.first_seen).toISOString().slice(0, 10) : '—',
        lastSeen: r.last_seen ? new Date(r.last_seen).toISOString().slice(0, 10) : '—',
    })));

    // 3. Conversations: real threads vs empty shells (the known trap).
    const convs = await db.execute(sql`
        SELECT COUNT(*)                                        AS total,
               COUNT(*) FILTER (WHERE m.msg_count = 0)         AS empty_shells,
               COUNT(*) FILTER (WHERE m.msg_count BETWEEN 1 AND 2) AS thin,
               COUNT(*) FILTER (WHERE m.msg_count >= 3)        AS real_threads
        FROM conversations c
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS msg_count FROM messages WHERE conversation_id = c.id
        ) m ON TRUE
        WHERE c.created_at >= NOW() - (${DAYS_BACK} || ' days')::interval
    `);
    const cv = (convs.rows as any[])[0] || {};
    console.log('\n--- Conversations ---');
    console.log(`  total: ${Number(cv.total || 0)}`);
    console.log(`  empty shells (0 msgs): ${Number(cv.empty_shells || 0)}`);
    console.log(`  thin (1-2 msgs):       ${Number(cv.thin || 0)}`);
    console.log(`  real threads (3+):     ${Number(cv.real_threads || 0)}`);

    // 4. Quotes created in the window vs how many have any linked intake at all.
    const quotes = await db.execute(sql`
        SELECT COUNT(*) AS quotes,
               COUNT(*) FILTER (WHERE customer_photo_urls IS NOT NULL
                                  AND jsonb_array_length(customer_photo_urls) > 0) AS with_photos,
               COUNT(*) FILTER (WHERE quote_assumptions IS NOT NULL
                                  AND jsonb_array_length(quote_assumptions) > 0)   AS with_assumptions
        FROM personalized_quotes
        WHERE created_at >= NOW() - (${DAYS_BACK} || ' days')::interval
    `);
    const q = (quotes.rows as any[])[0] || {};
    console.log('\n--- Quotes ---');
    console.log(`  created:            ${Number(q.quotes || 0)}`);
    console.log(`  with customer photos: ${Number(q.with_photos || 0)}`);
    console.log(`  with assumptions:     ${Number(q.with_assumptions || 0)}`);

    console.log('');
    process.exit(0);
}

main().catch((e) => {
    console.error('audit failed:', e?.message || e);
    process.exit(1);
});
