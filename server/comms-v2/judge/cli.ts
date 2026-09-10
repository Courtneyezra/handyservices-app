/**
 * `npm run comms-v2:judge`: drive every Goal 1 scenario through the sandbox WhatsApp door,
 * twice, and write the two reports. Exit code is non-zero on any error; a fail is not an error.
 *
 *   npm run comms-v2:judge                      all scenarios, two runs, reports/<stamp>/
 *   npm run comms-v2:judge -- --only 2.3,2.7    a subset
 *   npm run comms-v2:judge -- --runs 1          one run (a line still needs every run to pass)
 *   npm run comms-v2:judge -- --out example     reports/example/ (the committed evidence)
 *   npm run comms-v2:judge -- --no-model-judge  skip the own-words model verdict on 2.3
 *
 * Environment: COMMS_V2_DOOR_URL and COMMS_V2_DOOR_TOKEN reach a running server's
 * /api/comms-sandbox; without them the exported router runs in-process and needs the server's
 * own environment (.env is loaded).
 */
import 'dotenv/config';
import path from 'node:path';
import { openDoor } from './door';
import { makeModelJudge } from './model-judge';
import { REPORTS_DIR, reportStamp, writeReports } from './report';
import { runAll } from './runner';
import { GOAL_1_LINES, loadScenarios, uncoveredGoal1Lines } from './scenario';

interface Args { runs: number; only: string[] | null; out: string; modelJudge: boolean }

export function parseArgs(argv: readonly string[]): Args {
    const a: Args = { runs: 2, only: null, out: reportStamp(), modelJudge: true };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
        if (k === '--runs') { a.runs = Number(v()); if (!Number.isInteger(a.runs) || a.runs < 1 || a.runs > 10) throw new Error('--runs must be 1 to 10'); }
        else if (k === '--only') a.only = v().split(',').map((s) => s.trim()).filter(Boolean);
        else if (k === '--out') a.out = v();
        else if (k === '--no-model-judge') a.modelJudge = false;
        else throw new Error(`unknown argument ${k}`);
    }
    return a;
}

export async function main(argv: readonly string[]): Promise<number> {
    const args = parseArgs(argv);
    const all = loadScenarios();
    const scenarios = args.only ? all.filter((s) => args.only!.some((o) => s.id === o || s.id.startsWith(`${o}-`) || s.lines.includes(o))) : all;
    if (!scenarios.length) { console.error('no scenarios matched'); return 2; }
    const uncovered = uncoveredGoal1Lines(all);
    if (uncovered.length) console.warn(`warning: no scenario covers Goal 1 line(s) ${uncovered.join(', ')}`);

    const log = (line: string) => console.log(line);
    let door;
    try {
        door = await openDoor();
    } catch (err: any) {
        console.error(`ERROR: the door could not be opened: ${err?.message ?? err}`);
        return 1;
    }
    log(`door: ${door.mode} at ${door.baseUrl}`);
    try {
        const result = await runAll(scenarios, { door, judge: args.modelJudge ? makeModelJudge() : null, runs: args.runs, log, requiredLines: args.only ? [] : GOAL_1_LINES });
        const dir = path.isAbsolute(args.out) ? args.out : path.join(REPORTS_DIR, args.out);
        const written = writeReports(result, dir);
        log('');
        for (const l of result.lines) log(`line ${l.line}: ${l.status.toUpperCase()}  (${l.perRun.map((p) => `run ${p.run} ${p.status}`).join(', ')})`);
        log(`summary: ${result.summary.pass} pass, ${result.summary.fail} fail, ${result.summary.error} error`);
        log(`reports: ${written.json}\n         ${written.markdown}`);
        return result.exitCode;
    } finally {
        await door.close();
    }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; setTimeout(() => process.exit(code), 100).unref(); }, (err) => {
        console.error(`ERROR: ${err?.stack ?? err}`);
        process.exit(1);
    });
}
