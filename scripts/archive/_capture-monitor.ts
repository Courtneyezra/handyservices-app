/**
 * Capture monitor — is the pipeline actually recording the work, week by week?
 *
 * Context: as of 19 Aug 2026 there is NO baseline for the comms channel. Twilio was disconnected
 * on that number, so historic inbound arrived unread and every historic outbound row is unattended
 * automation. Week one of comms going live IS the first measurement. Nothing before GO_LIVE
 * describes anyone's behaviour, and this script refuses to report on it — see
 * docs/PIPELINE_AUDIT_2026-08.md §1.
 *
 * Run weekly:
 *   npx tsx scripts/_capture-monitor.ts
 *   npx tsx scripts/_capture-monitor.ts --weeks 6
 *   COMMS_GO_LIVE=2026-08-20 npx tsx scripts/_capture-monitor.ts
 *
 * Every check states its own threshold and why it exists. A check that cannot be judged yet says
 * so rather than printing a reassuring green.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

/** The day comms went live and messaging data started meaning something. */
const GO_LIVE = process.env.COMMS_GO_LIVE || '2026-08-19';

const weeksArgIdx = process.argv.indexOf('--weeks');
const WEEKS = weeksArgIdx > -1 ? Math.max(1, parseInt(process.argv[weeksArgIdx + 1], 10) || 4) : 4;

type Verdict = 'OK' | 'WARN' | 'FAIL' | 'NO DATA YET';
const icon: Record<Verdict, string> = { OK: '  OK  ', WARN: ' WARN ', FAIL: ' FAIL ', 'NO DATA YET': ' ---- ' };

const checks: { name: string; verdict: Verdict; detail: string; why: string }[] = [];
function check(name: string, verdict: Verdict, detail: string, why: string) {
    checks.push({ name, verdict, detail, why });
}

async function main() {
    const since = `${WEEKS} weeks`;
    console.log(`\n=== CAPTURE MONITOR — last ${WEEKS} week(s) ===`);
    console.log(`Comms go-live: ${GO_LIVE}. Messaging checks ignore anything before it.\n`);

    // ── Telephony ────────────────────────────────────────────────────────────
    const calls = (await db.execute(sql`
        SELECT COALESCE(direction, 'unknown')                                     AS direction,
               COUNT(*)                                                           AS total,
               COUNT(*) FILTER (WHERE transcription IS NOT NULL
                                  AND LENGTH(TRIM(transcription)) > 40)           AS with_transcript
        FROM calls
        WHERE created_at >= NOW() - ${since}::interval
        GROUP BY 1
    `)).rows as any[];

    const inbound = calls.find((r) => String(r.direction).startsWith('in'));
    const outbound = calls.find((r) => String(r.direction).startsWith('out'));
    const inCount = Number(inbound?.total || 0);
    const outCount = Number(outbound?.total || 0);

    // The whole point of the 19 Aug telephony change. Zero means Ben is not dialling through
    // Groundwire, or the SIP webhook is not reaching us — either way the corpus is not growing.
    check(
        'Outbound calls captured',
        outCount > 0 ? 'OK' : 'FAIL',
        `${outCount} outbound call(s) in ${WEEKS}w`,
        'Was 0 for all of 2026 before the sip-outbound fix. Zero here means Ben is dialling outside Groundwire, or the SIP domain webhook is misrouted.',
    );

    const totalCalls = inCount + outCount;
    const transcribed = Number(inbound?.with_transcript || 0) + Number(outbound?.with_transcript || 0);
    const transcriptPct = totalCalls ? Math.round((transcribed / totalCalls) * 100) : 0;
    check(
        'Call transcript rate',
        !totalCalls ? 'NO DATA YET' : transcriptPct >= 80 ? 'OK' : transcriptPct >= 60 ? 'WARN' : 'FAIL',
        `${transcriptPct}% (${transcribed}/${totalCalls})`,
        'Inbound ran at 84% historically. A sustained drop means the media stream or the transcription provider is failing, and it fails silently.',
    );

    // Speaker-label sanity: outbound legs must transcribe Ben as "Agent". If legRole never reaches
    // the handler the labels invert, which corrupts every downstream reader without erroring.
    if (outCount > 0) {
        const inverted = (await db.execute(sql`
            SELECT COUNT(*) AS n
            FROM calls
            WHERE created_at >= NOW() - ${since}::interval
              AND direction LIKE 'out%'
              AND transcription IS NOT NULL
              AND transcription NOT ILIKE '%Agent%'
              AND transcription ILIKE '%Caller%'
        `)).rows as any[];
        const n = Number(inverted[0]?.n || 0);
        check(
            'Outbound speaker labels',
            n === 0 ? 'OK' : 'WARN',
            n === 0 ? 'no inversion detected' : `${n} outbound transcript(s) with no "Agent" speaker`,
            'On a leg Ben dialled, HE is the originator. If legRole is missing the labels swap and Ben reads as "Caller" — wrong, and silent.',
        );
    }

    // ── Messaging (post-go-live only) ────────────────────────────────────────
    const msgs = (await db.execute(sql`
        SELECT COALESCE(direction, 'unknown') AS direction, COUNT(*) AS n
        FROM messages
        WHERE created_at >= GREATEST(NOW() - ${since}::interval, ${GO_LIVE}::timestamp)
        GROUP BY 1
    `)).rows as any[];
    const msgIn = Number(msgs.find((r) => r.direction === 'inbound')?.n || 0);
    const msgOut = Number(msgs.find((r) => r.direction === 'outbound')?.n || 0);

    if (msgIn + msgOut === 0) {
        check('Message capture', 'NO DATA YET', `nothing since ${GO_LIVE}`,
            'Comms has not produced traffic yet. Do not substitute pre-go-live rows — they are a dead channel.');
    } else {
        // A real two-way conversation trends toward 1:1. Heavily inbound-skewed means replies are
        // happening somewhere we cannot see (i.e. Ben went back to his own phone).
        const ratio = msgIn > 0 ? msgOut / msgIn : 0;
        check(
            'Reply capture (outbound:inbound)',
            ratio >= 0.6 ? 'OK' : ratio >= 0.3 ? 'WARN' : 'FAIL',
            `${msgOut}:${msgIn} (${ratio.toFixed(2)})`,
            'A two-way thread trends to 1:1. A heavy inbound skew means Ben is replying off-system.',
        );

        // Window pressure — the friction most likely to push him back to his handset. THIS is the
        // number that was previously computed off automation rows and was meaningless.
        const lat = (await db.execute(sql`
            WITH pairs AS (
                SELECT m.created_at AS in_at,
                       (SELECT MIN(o.created_at) FROM messages o
                         WHERE o.conversation_id = m.conversation_id
                           AND o.direction = 'outbound'
                           AND o.created_at > m.created_at) AS reply_at
                FROM messages m
                WHERE m.direction = 'inbound'
                  AND m.created_at >= GREATEST(NOW() - ${since}::interval, ${GO_LIVE}::timestamp)
            )
            SELECT COUNT(*) FILTER (WHERE reply_at IS NOT NULL
                                      AND reply_at - in_at <= interval '24 hours') AS in_window,
                   COUNT(*) FILTER (WHERE reply_at IS NOT NULL
                                      AND reply_at - in_at >  interval '24 hours') AS out_window,
                   COUNT(*) FILTER (WHERE reply_at IS NULL)                        AS unanswered
            FROM pairs
        `)).rows as any[];
        const inW = Number(lat[0]?.in_window || 0);
        const outW = Number(lat[0]?.out_window || 0);
        const unans = Number(lat[0]?.unanswered || 0);
        const replied = inW + outW;
        const shutPct = replied ? Math.round((outW / replied) * 100) : 0;
        // Minimum sample before this is allowed to render a verdict. A percentage off 4 pairs is
        // noise, and printing a green "OK" from it is precisely how the pre-go-live message table
        // produced a confident, wrong conclusion in the first place.
        const MIN_PAIRS = 15;
        check(
            'Freeform window pressure',
            replied < MIN_PAIRS ? 'NO DATA YET' : shutPct <= 25 ? 'OK' : shutPct <= 50 ? 'WARN' : 'FAIL',
            replied < MIN_PAIRS
                ? `only ${replied} reply pair(s) so far — need ${MIN_PAIRS} before this means anything (${unans} unanswered)`
                : `${shutPct}% of replies landed after the 24h window (${outW}/${replied}); ${unans} unanswered`,
            'Outside 24h, freeform is blocked and only approved templates can send. High pressure here predicts Ben reverting to his personal phone. Meta template approval has lead time — react early.',
        );
    }

    // ── Elicitation (the contractor-facing half) ─────────────────────────────
    // Capture is not elicitation. A perfectly recorded call that never asked about parking still
    // tells the contractor nothing about parking.
    const q = ((await db.execute(sql`
        SELECT COUNT(*) AS quotes,
               COUNT(*) FILTER (WHERE customer_photo_urls IS NOT NULL
                                  AND jsonb_array_length(customer_photo_urls) > 0) AS with_photos,
               COUNT(*) FILTER (WHERE quote_assumptions IS NOT NULL
                                  AND jsonb_array_length(quote_assumptions) > 0)   AS with_assumptions
        FROM personalized_quotes
        WHERE created_at >= NOW() - ${since}::interval
    `)).rows as any[])[0] || {};
    const qn = Number(q.quotes || 0);
    const photoPct = qn ? Math.round((Number(q.with_photos || 0) / qn) * 100) : 0;
    const assumePct = qn ? Math.round((Number(q.with_assumptions || 0) / qn) * 100) : 0;

    check('Quotes carrying customer photos', !qn ? 'NO DATA YET' : photoPct >= 50 ? 'OK' : photoPct >= 30 ? 'WARN' : 'FAIL',
        `${photoPct}% (${Number(q.with_photos || 0)}/${qn})`,
        'Baseline 20% (Jun-Aug 2026). No agent can show a contractor a photo that was never taken.');
    check('Quotes carrying assumptions', !qn ? 'NO DATA YET' : assumePct >= 50 ? 'OK' : assumePct >= 20 ? 'WARN' : 'FAIL',
        `${assumePct}% (${Number(q.with_assumptions || 0)}/${qn})`,
        'Baseline 2.6%. Assumptions are the caveats the price rests on, and the contractor is the only person who discovers they are false.');

    // ── Report ───────────────────────────────────────────────────────────────
    for (const c of checks) {
        console.log(`[${icon[c.verdict]}] ${c.name}`);
        console.log(`          ${c.detail}`);
        console.log(`          why: ${c.why}\n`);
    }

    const fails = checks.filter((c) => c.verdict === 'FAIL').length;
    const warns = checks.filter((c) => c.verdict === 'WARN').length;
    const pending = checks.filter((c) => c.verdict === 'NO DATA YET').length;
    console.log('='.repeat(72));
    console.log(`${checks.length - fails - warns - pending} ok · ${warns} warn · ${fails} fail · ${pending} awaiting data`);
    console.log('='.repeat(72) + '\n');

    process.exit(0);
}

main().catch((e) => {
    console.error('capture monitor failed:', e?.message || e);
    process.exit(1);
});
