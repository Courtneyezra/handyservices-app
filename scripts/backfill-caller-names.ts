/**
 * Backfill caller names from call transcripts where the live pipeline left a
 * generic placeholder ("Voice Caller" / "Unknown Caller" / null).
 *
 * The live name extraction (twilio-realtime.ts) only sees streaming partial
 * transcription and misses ~1/3 of names. This reads the FULL stored transcript
 * post-hoc. Only overwrites generic placeholders — never a real captured name.
 * The agent's own name ("Ben" / "Courtnee") is excluded by extractCallerName.
 *
 * Usage:
 *   npx tsx scripts/backfill-caller-names.ts [--dry-run] [--apply] [--days 60]
 *   (defaults to --dry-run)
 */
import { db } from "../server/db";
import { calls } from "../shared/schema";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { extractCallerName } from "../server/call-scoring";

const GENERIC = /^(voice caller|unknown caller|unknown|caller)?$/i;
const TEST_PHONE = /^(\+?447700900|07700900|\+?449900001)/;

function isGeneric(name: string | null): boolean {
    return GENERIC.test((name ?? "").trim());
}

async function main() {
    const argv = process.argv.slice(2);
    const apply = argv.includes("--apply");
    const daysIdx = argv.indexOf("--days");
    const days = daysIdx >= 0 ? parseInt(argv[daysIdx + 1], 10) : 60;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db.select({
        id: calls.id,
        customerName: calls.customerName,
        phoneNumber: calls.phoneNumber,
        transcription: calls.transcription,
        aiScoreJson: calls.aiScoreJson,
    }).from(calls).where(and(
        gte(calls.startTime, since),
        isNotNull(calls.transcription),
        inArray(calls.handledBy, ["va", "ai_agent"]),
    ));

    const candidates = rows.filter(r =>
        isGeneric(r.customerName) &&
        !TEST_PHONE.test((r.phoneNumber ?? "").replace(/\s/g, "")),
    );

    console.log(`${apply ? "APPLY" : "DRY-RUN"} — ${rows.length} answered calls in last ${days}d, ${candidates.length} with generic names\n`);

    let found = 0, none = 0;
    const CONCURRENCY = 4;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        const batch = candidates.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (row) => {
            let name = "";
            try {
                name = await extractCallerName(row.transcription!);
            } catch (e: any) {
                console.warn(`  [error] ${row.id}: ${e?.message}`);
                return;
            }
            if (!name) { none++; return; }
            found++;
            console.log(`  ${isGeneric(row.customerName) ? `"${row.customerName ?? "null"}"` : row.customerName} -> "${name}"`);
            if (apply) {
                // Patch customerName + the scorecard's callerName (if scored)
                const score = row.aiScoreJson && typeof row.aiScoreJson === "object"
                    ? { ...(row.aiScoreJson as Record<string, unknown>), callerName: name }
                    : row.aiScoreJson;
                await db.update(calls)
                    .set({ customerName: name, aiScoreJson: score })
                    .where(eq(calls.id, row.id));
            }
        }));
    }

    console.log(`\nNames recovered: ${found} | no name in transcript: ${none} | skipped (non-generic/test): ${rows.length - candidates.length}`);
    if (!apply) console.log("\nDry run — re-run with --apply to write.");
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
