/**
 * Results artifact + scoreboard with run-over-run deltas (Phase 2 / C; COMMS_EVALS_PLAN §2.2).
 * Pure: shapes in, markdown out. The harness persists eval-results/<timestamp>.json and latest.md.
 */
import type { GraderResult } from './graders';

export interface TrialOutcome { trial: number; pass: boolean; graders: GraderResult[]; body?: string | null; error?: string; skipped?: string }

export interface CaseOutcome {
    id: string;
    family: string;
    kind: 'regression' | 'capability';
    adapter: string;
    trials: TrialOutcome[];
    /** null when every trial was skipped (adapter unavailable). */
    passK: boolean | null;
    passAny: boolean | null;
    skipped?: string;
}

export interface GuardFalseNegativeReport {
    /** Sends on the incident corpus that should have been held (by label or by lexicon). */
    shouldHold: number;
    caughtByTextGuard: number;
    caughtByLexiconOnly: number;
    missed: number;
    /** missed / shouldHold — the text guards alone. */
    textGuardFalseNegativeRate: number | null;
    /** missed / shouldHold after the lexicon pre-checks as well. */
    combinedFalseNegativeRate: number | null;
    missedIds: string[];
    labels: Record<string, number>;
}

export interface EvalRunV2 {
    runId: string;
    startedAt: string;
    finishedAt: string;
    gitRef: string;
    trialsRequested: number;
    adapters: string[];
    cases: CaseOutcome[];
    guardFalseNegative?: GuardFalseNegativeReport | null;
}

export type Delta = 'new' | 'same' | 'fixed' | 'regressed' | 'skipped' | 'unskipped';

export function headline(c: CaseOutcome): boolean | null {
    return c.kind === 'regression' ? c.passK : c.passAny;
}

export function deltaFor(current: CaseOutcome, previous: CaseOutcome | undefined): Delta {
    if (!previous) return 'new';
    const now = headline(current);
    const then = headline(previous);
    if (now === null && then === null) return 'skipped';
    if (now === null) return 'skipped';
    if (then === null) return 'unskipped';
    if (now === then) return 'same';
    return now ? 'fixed' : 'regressed';
}

export interface Summary {
    total: number; green: number; red: number; skipped: number;
    byFamily: Record<string, { total: number; green: number; red: number; skipped: number }>;
}

export function summarise(cases: CaseOutcome[]): Summary {
    const s: Summary = { total: 0, green: 0, red: 0, skipped: 0, byFamily: {} };
    for (const c of cases) {
        const h = headline(c);
        const fam = (s.byFamily[c.family] ??= { total: 0, green: 0, red: 0, skipped: 0 });
        s.total += 1; fam.total += 1;
        if (h === null) { s.skipped += 1; fam.skipped += 1; }
        else if (h) { s.green += 1; fam.green += 1; }
        else { s.red += 1; fam.red += 1; }
    }
    return s;
}

const pct = (n: number | null) => (n == null ? 'n/a' : `${Math.round(n * 1000) / 10}%`);

export function scoreboardMarkdown(run: EvalRunV2, prev: EvalRunV2 | null): string {
    const prevBy = new Map((prev?.cases ?? []).map((c) => [`${c.adapter}:${c.id}`, c]));
    const sum = summarise(run.cases);
    const lines: string[] = [
        `# Comms eval scoreboard`,
        ``,
        `Run \`${run.runId}\` at ${run.startedAt} on \`${run.gitRef}\` — ${run.trialsRequested} trial(s)/case, adapters: ${run.adapters.join(', ')}.`,
        prev ? `Compared against \`${prev.runId}\`.` : `No previous run to compare against.`,
        ``,
        `**${sum.green} green · ${sum.red} red · ${sum.skipped} skipped** of ${sum.total}.`,
        ``,
        `| family | green | red | skipped |`,
        `| --- | --- | --- | --- |`,
    ];
    for (const [fam, f] of Object.entries(sum.byFamily).sort()) lines.push(`| ${fam} | ${f.green} | ${f.red} | ${f.skipped} |`);

    if (run.guardFalseNegative) {
        const g = run.guardFalseNegative;
        lines.push(``, `## Guard chain on the incident corpus (design §9)`, ``,
            `Should have been held: **${g.shouldHold}** · caught by a text guard: ${g.caughtByTextGuard} · caught only by the triage lexicon: ${g.caughtByLexiconOnly} · missed by both: **${g.missed}**`,
            ``,
            `Text-guard false-negative rate: **${pct(g.textGuardFalseNegativeRate)}** · with lexicon pre-checks: **${pct(g.combinedFalseNegativeRate)}**`,
            ``,
            `Labels: ${Object.entries(g.labels).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
            g.missedIds.length ? `Missed: ${g.missedIds.join(', ')}` : `Missed: none`);
    }

    lines.push(``, `## Cases`, ``, `| case | family | adapter | result | vs last | failing graders |`, `| --- | --- | --- | --- | --- | --- |`);
    const rows = [...run.cases].sort((a, b) => {
        const ha = headline(a), hb = headline(b);
        const rank = (h: boolean | null) => (h === false ? 0 : h === null ? 2 : 1);
        return rank(ha) - rank(hb) || a.family.localeCompare(b.family) || a.id.localeCompare(b.id);
    });
    for (const c of rows) {
        const h = headline(c);
        const label = c.kind === 'regression' ? `pass^${c.trials.length}` : `pass@${c.trials.length}`;
        const delta = deltaFor(c, prevBy.get(`${c.adapter}:${c.id}`));
        const deltaLabel = { new: 'new', same: '=', fixed: '🔺 fixed', regressed: '🔻 REGRESSED', skipped: 'skipped', unskipped: 'now runs' }[delta];
        const failing = Array.from(new Set(c.trials.flatMap((t) => t.graders.filter((g) => !g.pass).map((g) => g.grader)))).join(', ');
        const result = h === null ? `⏭ ${c.skipped ?? 'skipped'}` : `${h ? '✅' : '❌'} ${label}`;
        lines.push(`| ${c.id} | ${c.family} | ${c.adapter} | ${result} | ${deltaLabel} | ${failing || '—'} |`);
    }
    return lines.join('\n');
}
