/**
 * /admin/staff — the worker heartbeat strip, the spine switch strip and the autonomy ladder
 * (Phase 0 / 3 / 5), rendered both on the page and in isolation.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import AgentStaffPage, {
    WorkerHeartbeatStrip, SpineSwitchStrip, PackTiersBlock,
    type WorkerHeartbeat, type SpineSwitches, type LegacySwitches, type PackTierRow,
} from '@/pages/admin/AgentStaffPage';

const spine: SpineSwitches = {
    mode: 'shadow', enabled: true, shadow: true, explicitMode: null,
    agents: { scoper: { enabled: true }, quote_clerk: { enabled: true }, recovery: { enabled: false } },
    asks: { enabled: false }, autonomy: { enabled: false },
    sampler: { enabled: true, rate: 0.1, min: 3, max: 20 },
    video: { enabled: false, images: false, maxPerRun: 3 },
    sweepLimit: 10, debounceMinutes: 2, triageModel: 'claude-haiku-4-5', city: 'Nottingham',
};
const legacy: LegacySwitches = { enabled: true, onInbound: true, autosend: false, firstContactAck: true, quotePrep: false };
const alive: WorkerHeartbeat = { ok: true, ageSeconds: 12, stale: false, at: '2026-09-03T10:00:00Z', host: 'railway-abc', pid: 42, version: 'dfa65aa', staleAfterSeconds: 180, thisProcess: { role: 'passive', pid: 1, host: 'laptop', version: null } };
const tiers: PackTierRow[] = [
    { packId: 'customer.default', intent: 'ask_gap', tier: 'DRAFT', tierSource: 'static', verdicts30: 14, uneditedPct: 86, rejects30: 1, unsafeEver: 0, escalations14: 0, samples30: 0, sampleApprovalPct: null, evalFamily: 'missing', evalCases: 0, evalPassed: 0, packVerdicts30: 41, packUneditedPct: 88, lastChange: null },
    { packId: 'customer.default', intent: 'confirm_received', tier: 'SEND', tierSource: 'db', verdicts30: 27, uneditedPct: 96, rejects30: 0, unsafeEver: 0, escalations14: 0, samples30: 4, sampleApprovalPct: 100, evalFamily: 'pass', evalCases: 12, evalPassed: 12, packVerdicts30: 41, packUneditedPct: 88, lastChange: { tier: 'SEND', at: '2026-09-03T07:30:00Z', by: 'system:autonomy', reason: 'fast-track' } },
    { packId: 'customer.default', intent: 'money_question', tier: 'DRAFT', tierSource: 'db', verdicts30: 6, uneditedPct: 50, rejects30: 2, unsafeEver: 1, escalations14: 1, samples30: 0, sampleApprovalPct: null, evalFamily: 'fail', evalCases: 9, evalPassed: 7, packVerdicts30: 41, packUneditedPct: 88, lastChange: { tier: 'DRAFT', at: '2026-09-02T07:30:00Z', by: 'system:autonomy', reason: 'unsafe verdict' } },
];
const staff = {
    staff: [{
        id: 'scoper', name: 'Scoper', roleTitle: 'Customer replies on the spine', mission: 'Scope the job, never price it.', model: 'claude-sonnet-5', cadence: 'on every inbound',
        accent: 'emerald', autonomy: { freely: ['ask for a photo'], approval: ['every reply while DRAFT'], never: ['quote a price'] },
        tools: [], stats: [{ label: 'drafts today', value: 4 }], statusChips: [{ label: 'shadow', on: true }], system: 'SYSTEM PROMPT',
        verdicts: null, packTiers: tiers,
    }],
    workerHeartbeat: alive, spine, legacy,
};

const chip = (label: string) => screen.getByText(label, { selector: 'span' });

describe('WorkerHeartbeatStrip', () => {
    it('alive', () => {
        render(<WorkerHeartbeatStrip hb={alive} />);
        const el = screen.getByTestId('worker-heartbeat');
        expect(el).toHaveTextContent('Comms worker alive');
        expect(el).toHaveTextContent('last beat 12s ago on railway-abc · build dfa65aa');
        expect(el).toHaveTextContent('this page is served by a passive process');
        expect(el.className).toMatch(/emerald/);
        expect(el).not.toHaveTextContent('STALE');
    });
    it('stale', () => {
        render(<WorkerHeartbeatStrip hb={{ ok: false, ageSeconds: 900, stale: true, staleAfterSeconds: 180, host: 'railway-abc' }} />);
        const el = screen.getByTestId('worker-heartbeat');
        expect(el).toHaveTextContent('Comms worker STALE');
        expect(el).toHaveTextContent('last beat 15 min ago on railway-abc');
        expect(el).toHaveTextContent('(stale after 3 min — sweeps, ticks and releases are OFF)');
        expect(el.className).toMatch(/red/);
    });
    it('no heartbeat ever, and a server that does not report one', () => {
        const { unmount } = render(<WorkerHeartbeatStrip hb={{ ok: false, ageSeconds: null, stale: true, error: 'no comms_worker_heartbeat row' }} />);
        const el = screen.getByTestId('worker-heartbeat');
        expect(el).toHaveTextContent('Comms worker: no heartbeat');
        expect(el).toHaveTextContent('last beat never');
        expect(el).toHaveTextContent('no comms_worker_heartbeat row');
        unmount();
        render(<WorkerHeartbeatStrip hb={undefined} />);
        expect(screen.getByText('Worker heartbeat not reported by this server.')).toBeInTheDocument();
        expect(screen.queryByTestId('worker-heartbeat')).toBeNull();
    });
});

describe('SpineSwitchStrip', () => {
    it('shadow: mode pill, every switch chip on/off, agent chips, legacy row', () => {
        render(<SpineSwitchStrip spine={spine} legacy={legacy} />);
        const strip = screen.getByTestId('spine-switches');
        expect(within(strip).getByText('spine shadow').className).toMatch(/bg-amber-500/);
        expect(strip).toHaveTextContent('SHADOW — the spine runs dry and records; legacy still drafts');
        const on = (label: string) => expect(chip(label).className).toMatch(/bg-slate-900/);
        const off = (label: string) => expect(chip(label).className).toMatch(/bg-slate-100/);
        on('enabled'); on('shadow'); off('asks off'); off('autonomy off'); on('sampler on · 10%'); off('video off');
        on('scoper on'); on('quote_clerk on'); off('recovery off');
        expect(strip).toHaveTextContent('debounce 2 min · sweep 10/tick · triage claude-haiku-4-5 · Nottingham');
        on('sweep on'); on('on inbound on'); off('autosend off'); on('first-contact ack on'); off('auto quote-prep off');
    });
    it('live and off pills; missing spine says so', () => {
        const { unmount } = render(<SpineSwitchStrip spine={{ ...spine, mode: 'live', shadow: false }} legacy={null} />);
        expect(screen.getByText('spine live').className).toMatch(/bg-emerald-600/);
        expect(screen.getByTestId('spine-switches')).toHaveTextContent('LIVE — the spine answers customers; legacy off');
        expect(screen.queryByText('legacy comms_agent')).toBeNull();
        unmount();
        render(<SpineSwitchStrip spine={{ ...spine, mode: 'off', enabled: false, shadow: false }} legacy={legacy} />);
        expect(screen.getByText('spine off').className).toMatch(/bg-slate-700/);
        expect(screen.getByTestId('spine-switches')).toHaveTextContent('OFF — legacy only');
        unmount();
        render(<SpineSwitchStrip spine={null} legacy={legacy} />);
        expect(screen.getByText('Spine switches not reported by this server.')).toBeInTheDocument();
    });
});

describe('PackTiersBlock', () => {
    it('one table per pack: intent, tier, verdicts, unedited, unsafe, eval family, last change', () => {
        renderWithQuery(<PackTiersBlock rows={tiers} />);
        const block = screen.getByTestId('pack-tiers');
        expect(block).toHaveTextContent('Autonomy ladder (earned per intent)');
        expect(block).toHaveTextContent('customer.default');
        expect(block).toHaveTextContent('41 pack verdicts / 30d · 88% unedited');
        const rows = within(block).getAllByRole('row').slice(1); // skip header
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveTextContent('ask_gap');
        expect(within(rows[0]).getByText('DRAFT').className).toMatch(/amber/);
        expect(rows[0]).not.toHaveTextContent('earned');
        expect(rows[0]).toHaveTextContent('14 (1 rej)');
        expect(rows[0]).toHaveTextContent('86%');
        expect(rows[0]).toHaveTextContent('missing');
        expect(rows[0]).toHaveTextContent('launch default');
        expect(rows[1]).toHaveTextContent('confirm_received');
        expect(within(rows[1]).getByText('SEND').className).toMatch(/emerald/);
        expect(rows[1]).toHaveTextContent('earned');
        expect(rows[1]).toHaveTextContent('pass 12/12');
        expect(rows[1]).toHaveTextContent('SEND · 3 Sept · autonomy');
        expect(rows[2]).toHaveTextContent('money_question');
        expect(rows[2]).toHaveTextContent('fail 7/9');
        expect(rows[2]).toHaveTextContent('1 · 1 esc');
        expect(rows[2]).toHaveTextContent('6 (2 rej)');
    });
});

describe('AgentStaffPage', () => {
    it('renders heartbeat + switch strips from /api/agents/staff and opens the ladder in the dossier', async () => {
        mockFetch([{ url: '/api/agents/staff', reply: () => ({ json: staff }) }], { fallback: 'notFound' });
        renderWithQuery(<AgentStaffPage />);
        expect(await screen.findByText('AI Staff')).toBeInTheDocument();
        expect(screen.getByTestId('worker-heartbeat')).toHaveTextContent('Comms worker alive');
        expect(screen.getByTestId('spine-switches')).toHaveTextContent('spine shadow');
        expect(screen.queryByTestId('pack-tiers')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: /Scoper/ }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Customer replies on the spine')).toBeInTheDocument();
        expect(within(dialog).getByTestId('pack-tiers')).toHaveTextContent('confirm_received');
        expect(within(dialog).getAllByRole('row')).toHaveLength(4);
    });

    it('shows the "not reported" fallbacks when an older server omits the fields', async () => {
        mockFetch([{ url: '/api/agents/staff', reply: () => ({ json: { staff: [] } }) }], { fallback: 'notFound' });
        renderWithQuery(<AgentStaffPage />);
        expect(await screen.findByText('Worker heartbeat not reported by this server.')).toBeInTheDocument();
        expect(screen.getByText('Spine switches not reported by this server.')).toBeInTheDocument();
    });

    it('an expired session shows the log-in prompt', async () => {
        mockFetch([{ url: '/api/agents/staff', reply: () => ({ status: 401, json: {} }) }], { fallback: 'notFound' });
        renderWithQuery(<AgentStaffPage />);
        expect(await screen.findByText(/Your admin session has expired/)).toBeInTheDocument();
    });
});
