/**
 * Backfill the WhatsApp video-request phrase (mediaRequestPhrase) onto
 * already-scored calls, so the "send WhatsApp" button drops in real per-call
 * job context instantly. jobSummary is a useless generic placeholder for most
 * calls; the real context lives in the transcript, which we read here.
 *
 * Usage: npx tsx scripts/backfill-media-phrases.ts [--apply] [--days 60]
 *        (defaults to dry-run)
 */
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { extractMediaPhrase } from "../server/call-scoring";

async function main() {
    const argv = process.argv.slice(2);
    const apply = argv.includes("--apply");
    const daysIdx = argv.indexOf("--days");
    const days = daysIdx >= 0 ? parseInt(argv[daysIdx + 1], 10) : 60;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db.select({
        id: calls.id,
        customerName: calls.customerName,
        transcription: calls.transcription,
        aiScoreJson: calls.aiScoreJson,
    }).from(calls).where(and(
        gte(calls.startTime, since),
        isNotNull(calls.aiScoredAt),
        isNotNull(calls.transcription),
    ));

    // Only need those whose scorecard lacks a phrase already
    const candidates = rows.filter((r) => {
        const s = r.aiScoreJson as Record<string, unknown> | null;
        return !s || !s.mediaRequestPhrase;
    });

    console.log(`${apply ? "APPLY" : "DRY-RUN"} — ${rows.length} scored calls in ${days}d, ${candidates.length} missing a media phrase\n`);

    let found = 0, none = 0;
    const CONCURRENCY = 4;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        await Promise.all(candidates.slice(i, i + CONCURRENCY).map(async (row) => {
            let phrase = "";
            try {
                phrase = await extractMediaPhrase(row.transcription!);
            } catch (e: any) {
                console.warn(`  [error] ${row.id}: ${e?.message}`);
                return;
            }
            if (!phrase) { none++; console.log(`  ${row.customerName}: (too vague)`); return; }
            found++;
            console.log(`  ${row.customerName}: "showing us ${phrase}"`);
            if (apply) {
                const score = { ...(row.aiScoreJson as Record<string, unknown>), mediaRequestPhrase: phrase };
                await db.update(calls).set({ aiScoreJson: score }).where(eq(calls.id, row.id));
            }
        }));
    }

    console.log(`\nPhrases written: ${found} | too vague: ${none}`);
    if (!apply) console.log("Dry run — re-run with --apply to write.");
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
