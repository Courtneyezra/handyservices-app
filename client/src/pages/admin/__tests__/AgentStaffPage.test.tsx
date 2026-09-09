/**
 * /admin/staff — the worker heartbeat strip, the spine switch strip and the autonomy ladder
 * (Phase 0 / 3 / 5), rendered both on the page and in isolation.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import AgentStaffPage, {
    WorkerHeartbeatStrip, SpineSwitchStrip, PackTiersBlock, CategoryGraduationTable,
    VIDEO_MAX_PER_RUN, DESK_CODE_DEFAULT, DESK_WORDING, type WorkerHeartbeat, type SpineSwitches, type LegacySwitches, type PackTierRow,
} from '@/pages/admin/AgentStaffPage';

const spine: SpineSwitches = {
    mode: 'shadow', enabled: true, shadow: true, explicitMode: null,
    agents: { scoper: { enabled: true }, quote_clerk: { enabled: true }, recovery: { enabled: false } },
    asks: { enabled: false }, autonomy: { enabled: false },
    sampler: { enabled: true, rate: 0.1, min: 3, max: 20 },
    video: { enabled: false, images: false, maxPerRun: 3 },
    sweepLimit: 10, debounceSeconds: 8, triageModel: 'claude-haiku-4-5', city: 'Nottingham',
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
    const captions = { off: 'OFF — legacy only', shadow: 'SHADOW — the spine runs dry and records; legacy still drafts', live: 'LIVE — the spine answers customers; legacy off' };
    const controls = (sp: any, lg: any) => ({ spine: sp, legacy: lg, lastChanges: {}, viewer: { isOwner: true, email: 'owner@x', role: 'admin' }, captions, confirmWord: 'LIVE' });

    it('shadow: mode pill, switch chips, agent chips, legacy row (from /api/spine/controls)', async () => {
        mockFetch([{ url: '/api/spine/controls', reply: () => ({ json: controls(spine, legacy) }) }], { fallback: 'notFound' });
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const strip = await screen.findByTestId('spine-switches', {}, { timeout: 3000 });
        const pill = within(strip).getByTestId('spine-mode');
        expect(pill).toHaveTextContent(/spine shadow/);
        expect(pill.className).toMatch(/bg-amber-500/);
        expect(strip).toHaveTextContent('SHADOW');
        expect(strip).toHaveTextContent('asks');
        expect(strip).toHaveTextContent('sampler');
        expect(strip).toHaveTextContent('legacy comms_agent');
    });

    it('falls back to the props when the controls endpoint is unavailable; missing spine says so', async () => {
        mockFetch([], { fallback: 'notFound' });
        const { unmount } = renderWithQuery(<SpineSwitchStrip fallbackSpine={{ ...spine, mode: 'live', shadow: false }} fallbackLegacy={null} />);
        expect(await screen.findByTestId('spine-mode')).toHaveTextContent(/spine live/);
        expect(screen.getByTestId('spine-mode').className).toMatch(/bg-emerald-600/);
        expect(screen.queryByText('legacy comms_agent')).toBeNull();
        unmount();
        renderWithQuery(<SpineSwitchStrip fallbackSpine={{ ...spine, mode: 'off', enabled: false, shadow: false }} fallbackLegacy={legacy} />);
        expect(await screen.findByTestId('spine-mode')).toHaveTextContent(/spine off/);
        expect(screen.getByTestId('spine-mode').className).toMatch(/bg-slate-700/);
        unmount();
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={legacy} />);
        expect(await screen.findByText(/Spine switches not reported by this server/)).toBeInTheDocument();
    });
});

describe('SpineSwitchStrip — 0.5 the desk behaviour switch', () => {
    const captions = { off: 'OFF', shadow: 'SHADOW', live: 'LIVE' };
    const controls = (sp: SpineSwitches, isOwner = true) => ({ spine: sp, legacy: null, lastChanges: {}, viewer: { isOwner, email: 'owner@x', role: 'admin' }, captions, confirmWord: 'LIVE' });
    const okReply = () => ({ json: { ok: true } });

    it('v3: the chip, the plain wording and the code default, and a click posts desk v4', async () => {
        const fetches = mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls({ ...spine, desk: 'v3' }) }) },
            { url: '/api/spine/config', method: 'POST', reply: okReply },
        ], { fallback: 'notFound' });
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const row = await screen.findByTestId('desk-behaviour', {}, { timeout: 3000 });
        const chip = within(row).getByTestId('switch-desk');
        expect(chip).toHaveTextContent(/^desk v3$/);
        expect(chip.className).not.toMatch(/bg-slate-900/); // v3 is the resting state
        expect(row).toHaveTextContent(`Desk behaviour: ${DESK_WORDING.v3}`);
        expect(row).toHaveTextContent('v3, replies wait for Ben, today');
        expect(row).toHaveTextContent(`code default: ${DESK_CODE_DEFAULT}`);
        expect(chip.title).toMatch(/replies send by default/);
        await userEvent.click(chip);
        const posts = fetches.of('POST', '/api/spine/config');
        expect(posts).toHaveLength(1);
        expect(posts[0].body).toEqual({ desk: 'v4' });
    });

    it('v4: the chip is lit, the wording changes, and a click posts the rollback to v3', async () => {
        const fetches = mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls({ ...spine, desk: 'v4' }) }) },
            { url: '/api/spine/config', method: 'POST', reply: okReply },
        ], { fallback: 'notFound' });
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const row = await screen.findByTestId('desk-behaviour', {}, { timeout: 3000 });
        const chip = within(row).getByTestId('switch-desk');
        expect(chip).toHaveTextContent(/^desk v4$/);
        expect(chip.className).toMatch(/bg-slate-900/);
        expect(row).toHaveTextContent(`Desk behaviour: ${DESK_WORDING.v4}`);
        expect(row).toHaveTextContent(`code default: ${DESK_CODE_DEFAULT}`); // still v3 — the row moved, the code did not
        await userEvent.click(chip);
        expect(fetches.of('POST', '/api/spine/config')[0].body).toEqual({ desk: 'v3' });
    });

    it('owner-only, and a server that does not report the key reads as the code default', async () => {
        const { desk: _drop, ...withoutDesk } = { ...spine, desk: 'v4' as const };
        const fetches = mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls(withoutDesk as SpineSwitches, false) }) },
        ], { fallback: 'notFound' });
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const row = await screen.findByTestId('desk-behaviour', {}, { timeout: 3000 });
        const chip = within(row).getByTestId('switch-desk');
        expect(chip).toHaveTextContent(`desk ${DESK_CODE_DEFAULT}`);
        expect(chip).toBeDisabled();
        expect(chip.title).toMatch(/owner-only/);
        await userEvent.click(chip);
        expect(fetches.of('POST', '/api/spine/config')).toHaveLength(0);
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

describe('CategoryGraduationTable (P8 / B)', () => {
    it('one row per category with the design §6 gates and met / not met', () => {
        render(<CategoryGraduationTable data={{
            days: 90, since: '2026-06-06T00:00:00Z',
            thresholds: { minQuotes: 30, maxVariance: 0.2, minUneditedInBandPct: 80, recentDays: 30 },
            totals: { quotes: 33, lines: 40 },
            categories: [
                { category: 'plumbing', quotes: 32, lines: 36, uneditedPct: 88.9, inBandPct: 94.4, checkThisPct: 0, medianRelDeviation: 0.05, uneditedInBandPct30: 85, lines30: 20, graduation: { quotesOk: true, varianceOk: true, uneditedOk: true, met: true } },
                { category: 'fencing', quotes: 1, lines: 4, uneditedPct: 0, inBandPct: 25, checkThisPct: 100, medianRelDeviation: null, uneditedInBandPct30: 0, lines30: 4, graduation: { quotesOk: false, varianceOk: false, uneditedOk: false, met: false } },
            ],
        }} />);
        const p = screen.getByTestId('graduation-plumbing');
        expect(p).toHaveTextContent('plumbing');
        expect(p).toHaveTextContent('32 / 30');
        expect(p).toHaveTextContent('88.9%');
        expect(p).toHaveTextContent('5% ≤ 20%');
        expect(p).toHaveTextContent('85% ≥ 80% (20)');
        expect(p).toHaveTextContent('met');
        const f = screen.getByTestId('graduation-fencing');
        expect(f).toHaveTextContent('100% check_this');
        expect(f).toHaveTextContent('— ≤ 20%');
        expect(f).toHaveTextContent('not met');
    });
    it('empty window', () => {
        render(<CategoryGraduationTable data={{ days: 30, since: '', thresholds: { minQuotes: 30, maxVariance: 0.2, minUneditedInBandPct: 80, recentDays: 30 }, totals: { quotes: 0, lines: 0 }, categories: [] }} />);
        expect(screen.getByTestId('category-graduation')).toHaveTextContent('No priced quotes on /admin/price in the last 30 days yet.');
    });
});

describe('SpineSwitchStrip — T7 photos chip and media/run stepper', () => {
    const captions = { off: 'OFF', shadow: 'SHADOW', live: 'LIVE' };
    const controls = (sp: SpineSwitches) => ({ spine: sp, legacy: null, lastChanges: {}, viewer: { isOwner: false, email: 'ben@x', role: 'va' }, captions, confirmWord: 'LIVE' });
    const okReply = () => ({ json: { ok: true } });

    it('video off: the photos chip says it needs video, is never lit, and still posts video.images', async () => {
        const fetches = mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls({ ...spine, video: { enabled: false, images: true, maxPerRun: 3 } }) }) },
            { url: '/api/spine/config', method: 'POST', reply: okReply },
        ], { fallback: 'notFound' });
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const chip = await screen.findByTestId('switch-video.images', {}, { timeout: 3000 });
        expect(chip).toHaveTextContent('photos on · needs video on');
        expect(chip.className).not.toMatch(/bg-slate-900/); // stored on, but not lit: nothing is described while video is off
        expect(chip).not.toBeDisabled(); // a VA can flip it (same footing as video)
        expect(chip.title).toMatch(/turn video on first/);
        await userEvent.click(chip);
        const posts = fetches.of('POST', '/api/spine/config');
        expect(posts).toHaveLength(1);
        expect(posts[0].body).toEqual({ video: { images: false } });
    });

    it('video on + photos on: the chip is lit and a click posts images:false', async () => {
        const fetches = mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls({ ...spine, video: { enabled: true, images: true, maxPerRun: 6 } }) }) },
            { url: '/api/spine/config', method: 'POST', reply: okReply },
        ], { fallback: 'notFound' });
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const chip = await screen.findByTestId('switch-video.images', {}, { timeout: 3000 });
        expect(chip).toHaveTextContent(/^photos on$/);
        expect(chip.className).toMatch(/bg-slate-900/);
        expect(screen.getByTestId('switch-video')).toHaveTextContent(/^video on$/);
        await userEvent.click(chip);
        expect(fetches.of('POST', '/api/spine/config')[0].body).toEqual({ video: { images: false } });
    });

    it('the stepper shows the count, posts ±1, and cannot step past the bound', async () => {
        const fetches = mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls({ ...spine, video: { enabled: true, images: false, maxPerRun: 3 } }) }) },
            { url: '/api/spine/config', method: 'POST', reply: okReply },
        ], { fallback: 'notFound' });
        const { unmount } = renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const step = await screen.findByTestId('stepper-video.maxPerRun', {}, { timeout: 3000 });
        expect(step).toHaveTextContent('media/run 3');
        expect(step.title).toMatch(/NEWEST/);
        await userEvent.click(within(step).getByRole('button', { name: 'media/run up' }));
        expect(fetches.of('POST', '/api/spine/config')[0].body).toEqual({ video: { maxPerRun: 4 } });
        await userEvent.click(within(step).getByRole('button', { name: 'media/run down' }));
        expect(fetches.of('POST', '/api/spine/config')[1].body).toEqual({ video: { maxPerRun: 2 } });
        unmount();

        // At the ceiling the + is disabled; at the floor the − is; nothing is posted either way.
        const atMax = mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls({ ...spine, video: { enabled: true, images: false, maxPerRun: VIDEO_MAX_PER_RUN.max } }) }) },
        ], { fallback: 'notFound' });
        const { unmount: unmount2 } = renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const top = await screen.findByTestId('stepper-video.maxPerRun', {}, { timeout: 3000 });
        expect(top).toHaveTextContent(`media/run ${VIDEO_MAX_PER_RUN.max}`);
        expect(within(top).getByRole('button', { name: 'media/run up' })).toBeDisabled();
        expect(within(top).getByRole('button', { name: 'media/run down' })).not.toBeDisabled();
        expect(atMax.of('POST', '/api/spine/config')).toHaveLength(0);
        unmount2();

        mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls({ ...spine, video: { enabled: true, images: false, maxPerRun: VIDEO_MAX_PER_RUN.min } }) }) },
        ], { fallback: 'notFound' });
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const bottom = await screen.findByTestId('stepper-video.maxPerRun', {}, { timeout: 3000 });
        expect(within(bottom).getByRole('button', { name: 'media/run down' })).toBeDisabled();
    });

    it('a refused count from the server lands in the strip error line', async () => {
        mockFetch([
            { url: '/api/spine/controls', reply: () => ({ json: controls({ ...spine, video: { enabled: true, images: false, maxPerRun: 3 } }) }) },
            { url: '/api/spine/config', method: 'POST', reply: () => ({ status: 400, json: { ok: false, errors: ['video.maxPerRun must be a whole number from 1 to 12'] } }) },
        ], { fallback: 'notFound' });
        renderWithQuery(<SpineSwitchStrip fallbackSpine={null} fallbackLegacy={null} />);
        const step = await screen.findByTestId('stepper-video.maxPerRun', {}, { timeout: 3000 });
        await userEvent.click(within(step).getByRole('button', { name: 'media/run up' }));
        expect(await screen.findByTestId('switch-error')).toHaveTextContent('video.maxPerRun must be a whole number from 1 to 12');
    });
});
