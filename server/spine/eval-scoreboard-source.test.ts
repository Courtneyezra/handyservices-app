/**
 * 0.7 (build plan v2): WHERE the autonomy job reads its eval evidence from.
 *
 * The rules the job applies are not touched by 0.7 and are tested in autonomy.test.ts. These tests
 * pin the three answers the evidence link must give: the table when there is a row, the file when
 * there is not, and `missing` when there is neither — never a false green.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evalFamilyFrom, readLatestScoreboard, readScoreboardFile } from './autonomy';
import { familyCountsOf, evalRunRecord } from '../evals/eval-run-store';
import type { CaseOutcome, EvalRunV2 } from '../evals/scoreboard';

function outcome(over: Partial<CaseOutcome> = {}): CaseOutcome {
    return { id: 'c1', family: 'ask_gap', kind: 'regression', adapter: 'spine', trials: [], passK: true, passAny: true, ...over };
}

function tmpBoardDir(board: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-board-'));
    fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(board));
    return dir;
}

const FILE_BOARD = {
    runId: 'file-run', finishedAt: '2026-09-19T00:00:00Z',
    cases: [
        { family: 'ask_gap', kind: 'regression', passK: true },
        { family: 'ask_gap', kind: 'regression', passK: true },
        { family: 'closing', kind: 'regression', passK: false },
        { family: 'holding', kind: 'regression', passK: null },
    ],
};

const ROW = {
    runId: 'db-run',
    promptHash: 'abc123',
    finishedAt: '2026-09-20T00:00:00Z',
    families: {
        ask_gap: { cases: 2, graded: 2, green: 2, red: 0 },
        closing: { cases: 2, graded: 2, green: 1, red: 1 },
        holding: { cases: 1, graded: 0, green: 0, red: 0 },
    },
};

describe('0.7 — the eval evidence link', () => {
    it('reads the eval_runs row when one is present', async () => {
        const dir = tmpBoardDir(FILE_BOARD);
        const board = await readLatestScoreboard({ dir, loadRow: async () => ROW });
        expect(board?.source).toBe('db');
        expect(board?.runId).toBe('db-run');
        expect(evalFamilyFrom(board, 'ask_gap')).toMatchObject({ status: 'pass', cases: 2, passed: 2, source: 'db', promptHash: 'abc123' });
        expect(evalFamilyFrom(board, 'closing')).toMatchObject({ status: 'fail' });
        expect(evalFamilyFrom(board, 'holding')).toMatchObject({ status: 'skipped' });
        expect(evalFamilyFrom(board, 'faq_from_kb')).toMatchObject({ status: 'missing' });
    });

    it('falls back to the file when there is no row', async () => {
        const dir = tmpBoardDir(FILE_BOARD);
        const board = await readLatestScoreboard({ dir, loadRow: async () => null });
        expect(board?.source).toBe('file');
        expect(board?.runId).toBe('file-run');
        expect(evalFamilyFrom(board, 'ask_gap')).toMatchObject({ status: 'pass', cases: 2, passed: 2, source: 'file' });
        expect(evalFamilyFrom(board, 'closing')).toMatchObject({ status: 'fail' });
    });

    it('falls back to the file when the row reader throws', async () => {
        const dir = tmpBoardDir(FILE_BOARD);
        const board = await readLatestScoreboard({ dir, loadRow: async () => { throw new Error('no such table: eval_runs'); } });
        expect(board?.source).toBe('file');
    });

    it('reports missing — never a green — when there is neither a row nor a file', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-board-empty-'));
        const board = await readLatestScoreboard({ dir, loadRow: async () => null });
        expect(board).toBeNull();
        for (const intent of ['ask_gap', 'closing', 'faq_from_kb']) {
            expect(evalFamilyFrom(board, intent)).toMatchObject({ status: 'missing', cases: 0, passed: 0, source: 'none' });
        }
    });

    it('reads the table and the file to the SAME verdict for the same run', async () => {
        // The counts the table stores must be a faithful substitute for the file's case list.
        const cases: CaseOutcome[] = [
            outcome({ id: 'a1', family: 'ask_gap', passK: true }),
            outcome({ id: 'a2', family: 'ask_gap', passK: true }),
            outcome({ id: 'c1', family: 'closing', passK: false }),
            outcome({ id: 'h1', family: 'holding', passK: null }),
            outcome({ id: 'k1', family: 'faq_from_kb', kind: 'capability', passK: null, passAny: true }),
        ];
        const dir = tmpBoardDir({ runId: 'same', finishedAt: '2026-09-19T00:00:00Z', cases: cases.map((c) => ({ family: c.family, kind: c.kind, passK: c.passK })) });
        const fromFile = await readLatestScoreboard({ dir, loadRow: async () => null });
        const fromDb = await readLatestScoreboard({ dir, loadRow: async () => ({ runId: 'same', promptHash: null, finishedAt: '2026-09-19T00:00:00Z', families: familyCountsOf(cases) }) });
        for (const intent of ['ask_gap', 'closing', 'holding', 'faq_from_kb', 'unknown_family']) {
            const f = evalFamilyFrom(fromFile, intent);
            const d = evalFamilyFrom(fromDb, intent);
            expect({ intent, ...{ status: d.status, cases: d.cases, passed: d.passed } }).toEqual({ intent, status: f.status, cases: f.cases, passed: f.passed });
        }
    });

    it('readScoreboardFile still reads the file directly and marks its source', () => {
        const dir = tmpBoardDir(FILE_BOARD);
        expect(readScoreboardFile(dir)).toMatchObject({ runId: 'file-run', source: 'file' });
        expect(readScoreboardFile(path.join(dir, 'nowhere'))).toBeNull();
    });
});

describe('0.7 — the row an eval run becomes', () => {
    const run: EvalRunV2 = {
        runId: '2026-09-20T00-00-00-000Z', startedAt: '2026-09-20T00:00:00Z', finishedAt: '2026-09-20T00:05:00Z',
        gitRef: 'abc1234', trialsRequested: 3, adapters: ['replay', 'triage'],
        promptHash: 'deadbeefdeadbeefdeadbeef', promptHashes: { 'customer.default': 'aaaa', 'customer.post_quote': 'bbbb' },
        cases: [
            outcome({ id: 'a1', family: 'ask_gap', passK: true }),
            outcome({ id: 'a2', family: 'ask_gap', passK: false }),
            outcome({ id: 'h1', family: 'holding', passK: null }),
            outcome({ id: 'k1', family: 'faq_from_kb', kind: 'capability', passK: null, passAny: false }),
        ],
    };

    it('counts regression cases per family and ignores capability cases', () => {
        expect(familyCountsOf(run.cases)).toEqual({
            ask_gap: { cases: 2, graded: 2, green: 1, red: 1 },
            holding: { cases: 1, graded: 0, green: 0, red: 0 },
        });
    });

    it('carries the commit, the prompt provenance and the red counts onto the row', () => {
        const r = evalRunRecord(run, { id: 'fixed-id' });
        expect(r).toMatchObject({
            id: 'fixed-id', runId: run.runId, gitRef: 'abc1234', promptHash: 'deadbeefdeadbeefdeadbeef',
            promptHashes: { 'customer.default': 'aaaa', 'customer.post_quote': 'bbbb' },
            adapters: ['replay', 'triage'], trialsRequested: 3, regressionRed: 1, capabilityRed: 1, caseCount: 4,
        });
        expect(r.finishedAt.toISOString()).toBe('2026-09-20T00:05:00.000Z');
    });

    it('leaves promptHashes null when the run recorded none', () => {
        expect(evalRunRecord({ ...run, promptHash: null, promptHashes: {} })).toMatchObject({ promptHash: null, promptHashes: null });
    });

    it('never throws when there is no database to write to', async () => {
        const { saveEvalRun } = await import('../evals/eval-run-store');
        const r = await saveEvalRun(run, { insert: async () => { throw new Error('relation "eval_runs" does not exist'); } });
        expect(r.saved).toBe(false);
        expect(r.reason).toMatch(/eval_runs/);
    });
});
