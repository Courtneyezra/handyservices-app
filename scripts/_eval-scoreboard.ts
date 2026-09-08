/**
 * The eval scoreboard on the server (build plan v2, 0.7).
 *
 *   npx tsx scripts/_eval-scoreboard.ts --status            # what the autonomy job would read, and from where
 *   npx tsx scripts/_eval-scoreboard.ts --publish           # push eval-results/latest.json into eval_runs
 *   npx tsx scripts/_eval-scoreboard.ts --publish <file>
 *
 * Why this exists: the daily promotion job reads its eval evidence from `eval-results/latest.json`.
 * That directory is gitignored and the container build has no eval step, so on the Railway worker
 * the file has never existed — every intent's eval family read `missing` and only the two
 * fast-tracked intents could ever be promoted. 0.7 puts the scoreboard in `eval_runs`; this script
 * is how the table gets its FIRST row on a server that has never run the harness:
 *
 *   1. locally, with the production DATABASE_URL in the environment:
 *        DATABASE_URL=<prod> npx tsx scripts/eval-comms.ts
 *      the harness grades (no model key needed for the replay and triage adapters) and writes both
 *      the file and the row.
 *   2. or, from an eval-results/latest.json you already have:
 *        DATABASE_URL=<prod> npx tsx scripts/_eval-scoreboard.ts --publish
 *
 * Apply migrations/20260908_eval_runs.sql first. Read-only without --publish.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { saveEvalRun, familyCountsOf } from '../server/evals/eval-run-store';
import { promptsDigest } from '../server/evals/prompt-provenance';
import { readLatestScoreboard } from '../server/spine/autonomy';
import type { EvalRunV2 } from '../server/evals/scoreboard';

const ARGS = process.argv.slice(2);
const DEFAULT_FILE = path.resolve(process.cwd(), 'eval-results', 'latest.json');

async function status() {
    const board = await readLatestScoreboard();
    const current = promptsDigest();
    if (!board) {
        console.log('eval evidence: NONE — no eval_runs row and no eval-results/latest.json.');
        console.log('Every intent reads evalFamily "missing"; the full promotion gate cannot pass. This is safe, not green.');
        console.log(`Current prompt digest: ${current ?? 'none'}`);
        return;
    }
    console.log(`eval evidence: ${board.source === 'db' ? 'the eval_runs TABLE' : 'the eval-results/latest.json FILE'}`);
    console.log(`  run ${board.runId ?? 'unknown'} finished ${board.finishedAt ?? 'unknown'}`);
    const graded = board.familyCounts ?? (board.cases ? familyCountsFromCases(board.cases) : {});
    const names = Object.keys(graded).sort();
    console.log(`  families: ${names.length}`);
    for (const n of names) {
        const f = graded[n];
        console.log(`    ${n.padEnd(22)} ${f.green}/${f.cases} green · ${f.red} red · ${f.cases - f.graded} not graded`);
    }
    const was = board.promptHash ?? null;
    console.log(`  prompt digest graded: ${was ?? 'not recorded'}`);
    console.log(`  prompt digest here:   ${current ?? 'none'}`);
    if (was && current && was !== current) console.log('  STALE: the prompts have changed since this scoreboard was measured. Re-run the affected families.');
}

function familyCountsFromCases(cases: Array<{ family: string; kind: string; passK: boolean | null }>) {
    return familyCountsOf(cases.map((c) => ({ id: '', family: c.family, kind: c.kind as 'regression' | 'capability', adapter: '', trials: [], passK: c.passK, passAny: null })));
}

async function publish(file: string) {
    if (!fs.existsSync(file)) {
        console.error(`No scoreboard at ${file}. Run \`npx tsx scripts/eval-comms.ts\` first.`);
        process.exit(2);
    }
    const run = JSON.parse(fs.readFileSync(file, 'utf8')) as EvalRunV2;
    if (!run.runId || !Array.isArray(run.cases)) {
        console.error(`${file} is not an eval run (no runId / cases).`);
        process.exit(2);
    }
    if (!process.env.DATABASE_URL) {
        console.error('No DATABASE_URL. Publishing needs the database this server reads.');
        process.exit(2);
    }
    const r = await saveEvalRun(run);
    if (!r.saved) {
        console.error(`NOT written: ${r.reason}`);
        console.error('Apply migrations/20260908_eval_runs.sql first (npx tsx scripts/_apply-migration.ts migrations/20260908_eval_runs.sql).');
        process.exit(1);
    }
    const families = familyCountsOf(run.cases);
    console.log(`eval_runs row ${r.id} written for run ${run.runId} (${Object.keys(families).length} families, prompt digest ${run.promptHash ?? 'not recorded'}).`);
}

async function main() {
    const i = ARGS.indexOf('--publish');
    if (i >= 0) {
        const next = ARGS[i + 1];
        await publish(next && !next.startsWith('--') ? path.resolve(next) : DEFAULT_FILE);
        return;
    }
    await status();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });
