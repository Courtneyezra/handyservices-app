/**
 * Rewrite every identifying value on a target database to synthetic data.
 *
 *   npx tsx scripts/scrub-database.ts --dry-run
 *   npx tsx scripts/scrub-database.ts --confirm
 *   npx tsx scripts/scrub-database.ts --verify
 *   npx tsx scripts/scrub-database.ts --url-env COMMS_V2_DATABASE_URL --confirm --seed handy-2026
 *
 * The target comes from an environment variable, named with `--url-env` and DATABASE_URL by
 * default. A connection string is never accepted on the command line, because a command line ends
 * up in shell history and in process listings.
 *
 * What it will not do: run against the production database (server/worker-gate.ts recognises the
 * production host marker), run without `--confirm`, or run at all against a schema carrying a
 * column that server/scrub/plan.ts does not classify. It prints table names, column names and
 * counts, and never a value it read or wrote.
 *
 * See server/scrub/README.md for the design and for what "identifying" was taken to mean.
 */
import pg from 'pg';
import {
    scrubDatabase, refusalFor, ScrubRefusal, sumPatterns,
    type ScrubOptions, type ScrubReport,
} from '../server/scrub/scrub';
import { databaseHostOf } from '../server/worker-gate';

const DEFAULT_SEED = 'handyservices-scrub-v1';

interface Args {
    urlEnv: string;
    seed: string;
    confirm: boolean;
    dryRun: boolean;
    verify: boolean;
    help: boolean;
}

function parseArgs(argv: string[]): Args {
    const a: Args = {
        urlEnv: 'DATABASE_URL', seed: DEFAULT_SEED,
        confirm: false, dryRun: false, verify: false, help: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--confirm') a.confirm = true;
        else if (arg === '--dry-run') a.dryRun = true;
        else if (arg === '--verify') a.verify = true;
        else if (arg === '--help' || arg === '-h') a.help = true;
        else if (arg === '--url-env') a.urlEnv = argv[++i] ?? a.urlEnv;
        else if (arg === '--seed') a.seed = argv[++i] ?? a.seed;
        else if (arg.startsWith('--url-env=')) a.urlEnv = arg.slice('--url-env='.length);
        else if (arg.startsWith('--seed=')) a.seed = arg.slice('--seed='.length);
        else throw new Error(`unknown argument ${arg} (try --help)`);
    }
    return a;
}

const USAGE = `
scrub-database — replace every identifying value on a target database with synthetic data

  --url-env NAME   environment variable holding the target connection string (default DATABASE_URL)
  --seed TEXT      makes the result reproducible (default "${DEFAULT_SEED}")
  --dry-run        read and report what would change; write nothing
  --confirm        actually write. Required; without it the script refuses
  --verify         only scan the target and report what still looks identifying
  --help           this

The administrator account named by PIPELINE_ADMIN_EMAIL keeps its e-mail address and password
hash so the pipeline can still log in; everything else about it is scrubbed.
`.trim();

function printReport(report: ScrubReport): void {
    const lines: string[] = [];
    lines.push('');
    lines.push(`target host      ${report.databaseHost ?? 'unknown'}`);
    lines.push(`mode             ${report.dryRun ? 'dry run (nothing written)' : 'applied'}`);
    lines.push(`schema           ${report.tablesScanned} tables, ${report.textualColumns} textual columns, all classified`);
    lines.push(`telephone        ${report.phonesAllocated} distinct real number(s) mapped into ${report.phoneCapacity} reserved ones`);
    lines.push(`sweep            ${report.sweepTerms} literal term(s) hunted, ${report.sweepSkipped} too ambiguous to sweep`);
    lines.push(`admin login      ${report.preservedLogin ? 'preserved' : 'not preserved (PIPELINE_ADMIN_EMAIL unset)'}`);
    lines.push('');

    const changed = report.tables.filter((t) => t.rowsChanged > 0);
    if (!changed.length) {
        lines.push('no rows changed — the target was already scrubbed');
    } else {
        lines.push('rows changed, by table and column:');
        const width = Math.max(...changed.map((t) => t.table.length));
        for (const t of changed) {
            lines.push(`  ${t.table.padEnd(width)}  ${String(t.rowsChanged).padStart(7)} of ${t.rows} row(s)`);
            for (const c of t.columns) {
                lines.push(`      ${c.column} (${c.treatment}): ${c.changed}`);
            }
        }
    }
    lines.push('');

    if (!report.residuals.length) {
        lines.push('residual check   clean: no column holds a known real value or anything shaped like one');
    } else {
        const literal = report.residuals.filter((r) => r.literals > 0);
        lines.push(`residual check   ${report.residuals.length} column(s) still hold something worth looking at:`);
        for (const r of report.residuals) {
            const parts = [
                r.literals ? `${r.literals} known real value(s)` : null,
                r.patterns.phone ? `${r.patterns.phone} telephone-shaped` : null,
                r.patterns.email ? `${r.patterns.email} e-mail-shaped` : null,
                r.patterns.postcode ? `${r.patterns.postcode} postcode-shaped` : null,
            ].filter(Boolean);
            lines.push(`  ${r.column}: ${parts.join(', ')}`);
        }
        if (literal.length) {
            lines.push('');
            lines.push('  A known real value surviving the scrub is a defect: it means a column was');
            lines.push('  classified as safe to keep but was not, or the sweep declined the term as');
            lines.push('  ambiguous. Classify the column in server/scrub/plan.ts and run again.');
        }
    }
    lines.push('');
    console.log(lines.join('\n'));
}

(async () => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log(USAGE); return; }

    const connectionString = process.env[args.urlEnv];
    if (!connectionString) {
        console.error(`[scrub] ${args.urlEnv} is not set; nothing to connect to.`);
        process.exit(2);
    }

    const opts: ScrubOptions = {
        connectionString,
        seed: args.seed,
        // --verify and --dry-run both read only, so neither needs the operator's confirmation.
        confirmed: args.confirm || args.dryRun || args.verify,
        dryRun: args.dryRun || args.verify,
        // --verify writes nothing but exists precisely to run the residual scan.
        scanResiduals: args.verify ? true : !args.dryRun,
        preserveLoginEmail: process.env.PIPELINE_ADMIN_EMAIL ?? null,
        log: (line) => console.log(`[scrub] ${line}`),
    };

    const early = refusalFor({ ...opts, confirmed: args.confirm || args.dryRun || args.verify });
    if (early) {
        console.error(`[scrub] refusing: ${early}`);
        console.error(`[scrub] target host was ${databaseHostOf(connectionString) ?? 'unreadable'}`);
        process.exit(3);
    }

    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });
    await client.connect();
    try {
        console.log(`[scrub] connected to ${databaseHostOf(connectionString) ?? 'unknown host'}`
            + `${args.verify ? ' (verify only)' : args.dryRun ? ' (dry run)' : ''}`);
        const report = await scrubDatabase(client, opts);
        printReport(report);

        const leaked = report.residuals.reduce((n, r) => n + r.literals, 0);
        const shaped = report.residuals.reduce((n, r) => n + sumPatterns(r.patterns), 0);
        if (args.verify) {
            // As an audit, anything still shaped like a real identifier is a failure.
            process.exit(leaked + shaped > 0 ? 1 : 0);
        }
        process.exit(leaked > 0 ? 1 : 0);
    } catch (error) {
        if (error instanceof ScrubRefusal) {
            console.error(`[scrub] refusing: ${error.message}`);
            process.exit(3);
        }
        console.error(`[scrub] failed: ${(error as Error).message}`);
        process.exit(1);
    } finally {
        await client.end().catch(() => {});
    }
})();
