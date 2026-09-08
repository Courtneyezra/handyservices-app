/**
 * The prompt gate (build plan v2, 0.7 part B): no prompt change without its test.
 *
 *   npx tsx scripts/check-prompt-gate.ts                 # this branch vs origin/main
 *   npm run gate:prompts                                 # the same
 *   npx tsx scripts/check-prompt-gate.ts --base main
 *   npx tsx scripts/check-prompt-gate.ts --files a.md b.json   # an explicit list
 *
 * Exit 0 when the gate passes, 1 when it fails, 2 when it could not work out what changed (which
 * is NOT a failure of the rule — it is reported and the caller decides).
 *
 * The rule lives in server/evals/prompt-gate.ts and is pure; this script only works out the list
 * of changed paths. In CI the same script runs against the pull request's merge base
 * (.github/workflows/prompt-gate.yml), so an author sees locally exactly what the check will say.
 */
import { execFileSync } from 'node:child_process';
import { promptGateVerdict } from '../server/evals/prompt-gate';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | null => { const i = ARGS.indexOf(`--${name}`); return i >= 0 ? (ARGS[i + 1] ?? null) : null; };

function git(...args: string[]): string {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/** The base to diff against: --base, else GITHUB_BASE_REF, else origin/main, else main. */
function resolveBase(): string {
    const explicit = arg('base') ?? process.env.PROMPT_GATE_BASE ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null);
    const candidates = explicit ? [explicit] : ['origin/main', 'main', 'origin/master', 'master'];
    for (const c of candidates) {
        try { git('rev-parse', '--verify', '--quiet', `${c}^{commit}`); return c; } catch { /* try the next */ }
    }
    throw new Error(`no base ref found (tried ${candidates.join(', ')}); pass --base <ref>`);
}

function changedFiles(): { files: string[]; how: string } {
    const explicit = ARGS.indexOf('--files');
    if (explicit >= 0) return { files: ARGS.slice(explicit + 1).filter((a) => !a.startsWith('--')), how: 'the --files list' };
    const base = resolveBase();
    // ...  = against the merge base, so a busy main branch never drags unrelated files in.
    const committed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    // Uncommitted work counts too, so a local run answers before the commit as well as after it.
    const working = git('diff', '--name-only', 'HEAD').split('\n').filter(Boolean);
    const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
    return { files: Array.from(new Set([...committed, ...working, ...untracked])), how: `${base}...HEAD plus the working tree` };
}

function main() {
    let files: string[];
    let how: string;
    try {
        ({ files, how } = changedFiles());
    } catch (e: any) {
        console.error(`prompt gate: could not work out what changed — ${e?.message ?? e}`);
        process.exit(2);
    }
    const verdict = promptGateVerdict(files);
    console.log(`prompt gate: ${files.length} changed path(s) from ${how}`);
    console.log(verdict.message);
    process.exit(verdict.pass ? 0 : 1);
}

main();
