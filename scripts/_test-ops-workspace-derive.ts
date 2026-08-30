/**
 * C-WP1 derivation unit-check: exercises deriveWorkspaceElements against
 * canned LeanRunStep arrays. Run: npx tsx scripts/_test-ops-workspace-derive.ts
 */
import assert from 'node:assert/strict';
import type { LeanRunStep } from '../shared/ops-types';
import { deriveWorkspaceElements } from '../client/src/components/ops/workspace/derive';

const at = new Date().toISOString();
const call = (tool: string, input?: unknown): LeanRunStep => ({ at, type: 'tool_call', tool, input });
const result = (tool: string, res: unknown): LeanRunStep => ({ at, type: 'tool_result', tool, result: res });

// 1. Empty session → no elements, workspace stays closed.
{
    const e = deriveWorkspaceElements([]);
    assert.equal(e.latest, null);
    assert.equal(e.signalCount, 0);
    assert.equal(e.board, false);
    assert.equal(e.pipeline, null);
    assert.equal(e.availability, null);
    assert.deepEqual(e.drafts, []);
}

// 2. Board signals: get_board_snapshot OR get_desk → Board tab.
{
    const e = deriveWorkspaceElements([call('get_board_snapshot')]);
    assert.equal(e.board, true);
    assert.equal(e.latest, 'board');
    assert.equal(e.signalCount, 1);
    const e2 = deriveWorkspaceElements([call('get_desk')]);
    assert.equal(e2.board, true);
    assert.equal(e2.latest, 'board');
}

// 3. Pipeline: input.tab passthrough, default 'all', last call wins.
{
    const e = deriveWorkspaceElements([call('get_pipeline_snapshot', { tab: 'quotes' })]);
    assert.deepEqual(e.pipeline, { tab: 'quotes' });
    assert.equal(e.latest, 'pipeline');
    const e2 = deriveWorkspaceElements([call('get_pipeline_snapshot')]);
    assert.deepEqual(e2.pipeline, { tab: 'all' });
    const e3 = deriveWorkspaceElements([
        call('get_pipeline_snapshot', { tab: 'quotes' }),
        call('get_pipeline_snapshot', { tab: 'jobs' }),
    ]);
    assert.deepEqual(e3.pipeline, { tab: 'jobs' });
    assert.equal(e3.signalCount, 2);
}

// 4. Availability: dates + contractorId from input (number coerced, junk dropped).
{
    const e = deriveWorkspaceElements([
        call('get_contractor_availability', { dates: ['2026-09-01', '2026-09-02', 42], contractorId: 7 }),
    ]);
    assert.deepEqual(e.availability, { dates: ['2026-09-01', '2026-09-02'], contractorId: '7' });
    assert.equal(e.latest, 'availability');
    const e2 = deriveWorkspaceElements([call('get_contractor_availability', {})]);
    assert.deepEqual(e2.availability, { dates: [] });
}

// 5. Drafts: queue_draft results (object AND JSON-string forms), pending first,
//    refused kept, duplicate draftId deduped; non-parsing results ignored.
{
    const e = deriveWorkspaceElements([
        result('queue_draft', { draftId: 'd1', status: 'suppressed', preview: 'suppressed one' }),
        result('queue_draft', JSON.stringify({ draftId: 'd2', status: 'pending', preview: 'pending one' })),
        result('queue_draft', { draftId: null, status: 'refused', preview: '', refusal: 'guard rails' }),
        result('queue_draft', { draftId: 'd2', status: 'pending', preview: 'replayed by transcript' }),
        result('queue_draft', 'truncated garbage…'),
        result('some_other_tool', { draftId: 'nope', status: 'pending', preview: 'wrong tool' }),
    ]);
    assert.equal(e.drafts.length, 3);
    assert.equal(e.drafts[0].draftId, 'd2'); // pending first
    assert.equal(e.drafts[0].status, 'pending');
    assert.equal(e.latest, 'drafts');
    assert.equal(e.signalCount, 3); // dedupe + garbage don't count
}

// 6. Most recent signal wins `latest` across a mixed session.
{
    const e = deriveWorkspaceElements([
        call('get_board_snapshot'),
        call('get_pipeline_snapshot', { tab: 'quotes' }),
        result('queue_draft', { draftId: 'd9', status: 'pending', preview: 'hi' }),
        call('get_desk'),
    ]);
    assert.equal(e.latest, 'board');
    assert.equal(e.signalCount, 4);
    assert.equal(e.board, true);
    assert.deepEqual(e.pipeline, { tab: 'quotes' });
    assert.equal(e.drafts.length, 1);
}

// 7. Non-signal steps are inert.
{
    const e = deriveWorkspaceElements([
        { at, type: 'assistant', detail: { text: 'thinking' } },
        call('get_thread', { conversationId: 'c1' }),
        { at, type: 'tool_result', tool: 'get_board_snapshot', result: 'huge truncated…' },
        { at, type: 'error', detail: { text: 'boom' } },
    ]);
    assert.equal(e.signalCount, 0);
    assert.equal(e.latest, null);
}

console.log('deriveWorkspaceElements: all 7 checks passed');
