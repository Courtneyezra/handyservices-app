/**
 * Backfill AI call scores for a month of calls (VA performance dashboard).
 *
 * Usage:
 *   npx tsx scripts/backfill-call-scores.ts [--limit N] [--month 2026-06]
 *
 * Steps:
 *   1. Backfill `handled_by` for the month's calls where null (inference from
 *      missedReason / outcome / elevenLabsConversationId / transcription).
 *   2. Score unscored calls (transcription > 100 chars) with concurrency 4,
 *      one retry on failure; persist aiScoreJson + aiScoredAt.
 *
 * Test calls (07700900* / 447700900* / 449900001*) are excluded.
 */
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { scoreCall, isSubstantiveCallTranscript } from "../server/call-scoring";

function parseArgs(): { limit: number | null; month: string } {
    const argv = process.argv.slice(2);
    let limit: number | null = null;
    let month = "2026-06";
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--limit") limit = parseInt(argv[++i], 10);
        else if (argv[i] === "--month") month = argv[++i];
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
        console.error(`Invalid --month "${month}" (expected YYYY-MM)`);
        process.exit(1);
    }
    if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
        console.error(`Invalid --limit`);
        process.exit(1);
    }
    return { limit, month };
}

function monthRange(month: string): { start: Date; end: Date } {
    const [y, m] = month.split("-").map(Number);
    return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

const TEST_PHONE_RE = /^(\+?447700900|07700900|\+?449900001)/;

function isTestPhone(phone: string | null): boolean {
    if (!phone) return false;
    return TEST_PHONE_RE.test(phone.replace(/\s/g, ""));
}

// The Eleven Labs busy-agent's script signature. Fallback-AI calls after a VA
// no-answer often have missedReason set but NO elevenLabsConversationId, so
// the transcript itself is the most reliable signal that the AI handled it.
const AI_AGENT_SIGNATURE = /just on another call|right person to call you back|can't give prices or book jobs/i;

function inferHandledBy(call: {
    missedReason: string | null;
    outcome: string | null;
    elevenLabsConversationId: string | null;
    transcription: string | null;
}): string | null {
    // A substantive two-way conversation means SOMEONE handled the call —
    // even when missedReason='no_answer' (the VA missed it, the AI caught it).
    if (call.transcription && isSubstantiveCallTranscript(call.transcription)) {
        return AI_AGENT_SIGNATURE.test(call.transcription) || call.elevenLabsConversationId
            ? "ai_agent"
            : "va";
    }
    if (
        (call.missedReason && ["no_answer", "busy_agent"].includes(call.missedReason)) ||
        (call.outcome && ["MISSED_CALL", "NO_ANSWER"].includes(call.outcome))
    ) return "missed";
    if (call.outcome && ["VOICEMAIL", "VOICEMAIL_LEFT"].includes(call.outcome)) return "voicemail";
    if (call.elevenLabsConversationId || call.outcome === "ELEVEN_LABS") return "ai_agent";
    if (call.transcription) {
        // Transcript exists but no real conversation: IVR-only recording,
        // voicemail greeting, or a failed "Hello?" connection.
        return /voice ?mail/i.test(call.transcription) ? "voicemail" : "missed";
    }
    return null;
}

/**
 * Reconciliation pass: recompute handledBy from the transcript for every
 * non-test call in the month and correct rows the earlier rules misbucketed
 * (AI-handled calls marked 'missed', IVR-only recordings marked 'va', ...).
 * Rows with ringSeconds set were live-captured by the dial-status webhook —
 * trust those and skip. Clears the scorecard when a row leaves the scoreable
 * buckets. Idempotent — safe to re-run.
 */
async function reconcileHandledBy(start: Date, end: Date): Promise<void> {
    const rows = await db.select({
        id: calls.id,
        customerName: calls.customerName,
        phoneNumber: calls.phoneNumber,
        handledBy: calls.handledBy,
        ringSeconds: calls.ringSeconds,
        missedReason: calls.missedReason,
        outcome: calls.outcome,
        elevenLabsConversationId: calls.elevenLabsConversationId,
        transcription: calls.transcription,
    }).from(calls)
        .where(and(gte(calls.startTime, start), lt(calls.startTime, end)));

    let fixed = 0;
    const counts: Record<string, number> = {};
    for (const row of rows) {
        if (isTestPhone(row.phoneNumber)) continue;
        if (row.ringSeconds != null) continue; // live-captured attribution wins
        const inferred = inferHandledBy(row);
        if (!inferred || inferred === row.handledBy) continue;
        const scoreable = inferred === "va" || inferred === "ai_agent";
        await db.update(calls)
            .set({ handledBy: inferred, ...(scoreable ? {} : { aiScoreJson: null, aiScoredAt: null }) })
            .where(eq(calls.id, row.id));
        counts[`${row.handledBy ?? "null"} -> ${inferred}`] = (counts[`${row.handledBy ?? "null"} -> ${inferred}`] ?? 0) + 1;
        fixed++;
    }
    console.log(`[reconcile pass] ${rows.length} calls checked, ${fixed} corrected:`);
    Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

async function backfillHandledBy(start: Date, end: Date): Promise<void> {
    const rows = await db.select({
        id: calls.id,
        phoneNumber: calls.phoneNumber,
        missedReason: calls.missedReason,
        outcome: calls.outcome,
        elevenLabsConversationId: calls.elevenLabsConversationId,
        transcription: calls.transcription,
    }).from(calls)
        .where(and(isNull(calls.handledBy), gte(calls.startTime, start), lt(calls.startTime, end)));

    const counts: Record<string, number> = { va: 0, ai_agent: 0, missed: 0, voicemail: 0, unresolved: 0, test_skipped: 0 };
    for (const row of rows) {
        if (isTestPhone(row.phoneNumber)) { counts.test_skipped++; continue; }
        const handledBy = inferHandledBy(row);
        if (!handledBy) { counts.unresolved++; continue; }
        await db.update(calls).set({ handledBy }).where(eq(calls.id, row.id));
        counts[handledBy]++;
    }
    console.log(`\n[handledBy backfill] ${rows.length} calls with null handled_by:`);
    console.log(`  va:           ${counts.va}`);
    console.log(`  ai_agent:     ${counts.ai_agent}`);
    console.log(`  missed:       ${counts.missed}`);
    console.log(`  voicemail:    ${counts.voicemail}`);
    console.log(`  unresolved:   ${counts.unresolved}`);
    console.log(`  test_skipped: ${counts.test_skipped}`);
}

async function scoreOne(row: typeof calls.$inferSelect, n: number, total: number): Promise<void> {
    const label = `${n}/${total} ${row.customerName || row.phoneNumber}`;
    const attempt = () => scoreCall({
        transcription: row.transcription,
        duration: row.duration,
        ringSeconds: row.ringSeconds,
        handledBy: row.handledBy,
        outcome: row.outcome,
        jobSummary: row.jobSummary,
        detectedSkusJson: row.detectedSkusJson,
    });

    let scorecard;
    try {
        scorecard = await attempt();
    } catch (err) {
        console.warn(`[score] ${label} — retrying after error: ${(err as Error).message}`);
        scorecard = await attempt();
    }

    if (!scorecard) {
        console.log(`[score] ${label} — skipped (unscoreable)`);
        return;
    }
    await db.update(calls)
        .set({ aiScoreJson: scorecard, aiScoredAt: new Date() })
        .where(eq(calls.id, row.id));
    console.log(`[score] ${label} — overall ${scorecard.overall}`);
    console.log(JSON.stringify(scorecard, null, 2));
}

async function main() {
    const { limit, month } = parseArgs();
    const { start, end } = monthRange(month);
    console.log(`Backfilling call scores for ${month}${limit ? ` (limit ${limit})` : ""}`);

    // Step 1: handledBy backfill
    await backfillHandledBy(start, end);
    await reconcileHandledBy(start, end);

    // Step 2: score unscored calls with usable transcripts
    let candidates = await db.select().from(calls)
        .where(and(
            isNull(calls.aiScoredAt),
            gte(calls.startTime, start),
            lt(calls.startTime, end),
            sql`length(${calls.transcription}) > 100`,
            // missed/voicemail calls can still carry an IVR-only transcript — not scoreable
            inArray(calls.handledBy, ["va", "ai_agent"]),
        ))
        .orderBy(calls.startTime);

    candidates = candidates.filter((c) => !isTestPhone(c.phoneNumber));
    if (limit !== null) candidates = candidates.slice(0, limit);

    const total = candidates.length;
    console.log(`\n[scoring] ${total} calls to score`);

    const CONCURRENCY = 4;
    let next = 0;
    let failed = 0;
    async function worker() {
        while (next < total) {
            const idx = next++;
            try {
                await scoreOne(candidates[idx], idx + 1, total);
            } catch (err) {
                failed++;
                console.error(`[score] ${idx + 1}/${total} ${candidates[idx].customerName || candidates[idx].phoneNumber} — FAILED: ${(err as Error).message}`);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

    console.log(`\nDone. Scored ${total - failed}/${total}${failed ? ` (${failed} failed)` : ""}.`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
