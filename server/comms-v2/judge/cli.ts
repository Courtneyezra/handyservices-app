/**
 * `npm run comms-v2:judge`: drive every Goal 1 scenario through the sandbox WhatsApp door,
 * twice, and write the two reports. Exit code is non-zero on any error; a fail is not an error.
 *
 *   npm run comms-v2:judge                      all scenarios, two runs, reports/<stamp>/
 *   npm run comms-v2:judge -- --only 2.3,2.7    a subset
 *   npm run comms-v2:judge -- --out example     reports/example/ (the committed evidence)
 *   npm run comms-v2:judge -- --desk current    the old desk (the default is v2, the new desk)
 *
 * Environment: the exported sandbox router runs in-process against COMMS_V2_JUDGE_DATABASE_URL
 * (a Neon branch; DATABASE_URL is never read) with the model keys from .env. No variable's value
 * is printed or written to a report: only the door's mode and host.
 */
import 'dotenv/config';
import path from 'node:path';
import { openDoor, type DeskTarget } from './door';
import { makeModelJudge } from './model-judge';
import { REPORTS_DIR, reportStamp, writeReports } from './report';
import { runAll } from './runner';
import { GOAL_1_LINES, loadScenarios, uncoveredGoal1Lines } from './scenario';

interface Args { only: string[] | null; out: string; desk: DeskTarget }

export function parseArgs(argv: readonly string[]): Args {
    const a: Args = { only: null, out: reportStamp(), desk: 'v2' };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
        if (k === '--only') a.only = v().split(',').map((s) => s.trim()).filter(Boolean);
        else if (k === '--out') a.out = v();
        else if (k === '--desk') { const d = v(); if (d !== 'v2' && d !== 'current') throw new Error(`--desk must be v2 or current, not ${d}`); a.desk = d; }
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
        door = await openDoor({ desk: args.desk });
    } catch (err: any) {
        console.error(`ERROR: the door could not be opened: ${err?.message ?? err}`);
        return 1;
    }
    log(`door: ${door.mode} at ${door.host} (desk: ${door.desk})`);
    try {
        const result = await runAll(scenarios, { door, judge: makeModelJudge(), log, requiredLines: args.only ? [] : GOAL_1_LINES });
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
