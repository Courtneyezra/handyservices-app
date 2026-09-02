/**
 * Phase 3 vitest: the promotion / demotion decision over fake evidence, every branch, no database.
 */
import { describe, it, expect } from 'vitest';
import { decideTier, evalFamilyFrom, evaluateAutonomy, GATE, type IntentEvidence } from './autonomy';
import { applyTierOverlay, getPack, assertPromotable, setTierOverlayForTests, resolvePack } from './packs';
import type { CaseFile, TriageResult } from './types';

const NOW = new Date('2026-09-20T07:30:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function ev(over: Partial<IntentEvidence> = {}): IntentEvidence {
    return {
        packId: 'customer.default', intent: 'clarify_scope', tier: 'DRAFT', tierSource: 'static', allowed: true,
        packVerdicts30: { human: 40, approve: 38, edit: 1, reject: 1, unsafe: 0, uneditedPct: 95, firstAt: ago(25) },
        intentVerdicts30: { human: 25, approve: 24, edit: 1, reject: 0, unsafe: 0, uneditedPct: 96, firstAt: ago(20) },
        unsafeEver: 0, escalations14: 0,
        samples30: { fine: 0, notFine: 0, notFineUnsafe: 0, total: 0, approvalPct: null },
        incidents30: 0,
        evalFamily: { status: 'pass', cases: 6, passed: 6 },
        lastChange: null,
        ...over,
    };
}

describe('decideTier — promotion', () => {
    it('promotes on the full gate', () => {
        const d = decideTier(ev(), NOW);
        expect(d).toMatchObject({ action: 'promote', to: 'SEND', rule: 'full_gate' });
    });
    it('holds when the eval family is missing, failing or skipped', () => {
        for (const status of ['missing', 'fail', 'skipped'] as const) {
            const d = decideTier(ev({ evalFamily: { status, cases: status === 'missing' ? 0 : 6, passed: status === 'fail' ? 5 : 0 } }), NOW);
            expect(d.action).toBe('hold'); expect(d.reasons.join(' ')).toMatch(/eval family/);
        }
    });
    it('holds under 30 pack verdicts or under 90% unedited', () => {
        expect(decideTier(ev({ packVerdicts30: { human: 29, approve: 28, edit: 1, reject: 0, unsafe: 0, uneditedPct: 96.6, firstAt: ago(20) } }), NOW).action).toBe('hold');
        expect(decideTier(ev({ packVerdicts30: { human: 40, approve: 35, edit: 5, reject: 0, unsafe: 0, uneditedPct: 87.5, firstAt: ago(20) } }), NOW).action).toBe('hold');
    });
    it('holds on any unsafe ever or any escalation in 14 days', () => {
        expect(decideTier(ev({ unsafeEver: 1 }), NOW)).toMatchObject({ action: 'hold' });
        expect(decideTier(ev({ escalations14: 1 }), NOW)).toMatchObject({ action: 'hold' });
    });
    it('a demotion signal still inside its window blocks re-promotion, fast track included', () => {
        expect(decideTier(ev({ incidents30: 1 }), NOW)).toMatchObject({ action: 'hold' });
        const ft = decideTier(ev({ intent: 'ask_gap', evalFamily: { status: 'missing', cases: 0, passed: 0 }, samples30: { fine: 2, notFine: 3, notFineUnsafe: 0, total: 5, approvalPct: 40 } }), NOW);
        expect(ft.action).toBe('hold'); expect(ft.reasons.join(' ')).toMatch(/demotion signal still in window/);
    });
    it('fast-tracks ask_gap and confirm_received without an eval family', () => {
        const d = decideTier(ev({ intent: 'ask_gap', evalFamily: { status: 'missing', cases: 0, passed: 0 }, packVerdicts30: { human: 12, approve: 12, edit: 0, reject: 0, unsafe: 0, uneditedPct: 100, firstAt: ago(15) } }), NOW);
        expect(d).toMatchObject({ action: 'promote', to: 'SEND', rule: 'fast_track' });
        expect(decideTier(ev({ intent: 'confirm_received', evalFamily: { status: 'missing', cases: 0, passed: 0 }, packVerdicts30: { human: 0, approve: 0, edit: 0, reject: 0, unsafe: 0, uneditedPct: null, firstAt: null } }), NOW).rule).toBe('fast_track');
    });
    it('fast track needs 14 days, 20 verdicts, zero rejects and 90% unedited', () => {
        const base = { intent: 'ask_gap', evalFamily: { status: 'missing' as const, cases: 0, passed: 0 }, packVerdicts30: { human: 0, approve: 0, edit: 0, reject: 0, unsafe: 0, uneditedPct: null, firstAt: null } };
        expect(decideTier(ev({ ...base, intentVerdicts30: { human: 25, approve: 24, edit: 1, reject: 0, unsafe: 0, uneditedPct: 96, firstAt: ago(10) } }), NOW).action).toBe('hold');
        expect(decideTier(ev({ ...base, intentVerdicts30: { human: 19, approve: 19, edit: 0, reject: 0, unsafe: 0, uneditedPct: 100, firstAt: ago(20) } }), NOW).action).toBe('hold');
        expect(decideTier(ev({ ...base, intentVerdicts30: { human: 25, approve: 24, edit: 0, reject: 1, unsafe: 0, uneditedPct: 96, firstAt: ago(20) } }), NOW).action).toBe('hold');
        expect(decideTier(ev({ ...base, intentVerdicts30: { human: 25, approve: 21, edit: 4, reject: 0, unsafe: 0, uneditedPct: 84, firstAt: ago(20) } }), NOW).action).toBe('hold');
        const hold = decideTier(ev({ ...base, intentVerdicts30: { human: 25, approve: 24, edit: 0, reject: 1, unsafe: 0, uneditedPct: 96, firstAt: ago(20) } }), NOW);
        expect(hold.reasons.join(' ')).toMatch(/fast track: 1 reject/);
    });
    it('does not fast-track any other intent', () => {
        expect(decideTier(ev({ intent: 'clarify_scope', evalFamily: { status: 'missing', cases: 0, passed: 0 } }), NOW).action).toBe('hold');
    });
    it('never promotes an intent the pack does not allow', () => {
        expect(decideTier(ev({ allowed: false }), NOW)).toMatchObject({ action: 'hold', rule: 'not_promotable' });
        expect(decideTier(ev({ allowed: false, tier: 'SEND' }), NOW)).toMatchObject({ action: 'demote', to: 'DRAFT', rule: 'not_promotable' });
    });
    it('asserts that money and date intents cannot exist on the ladder', () => {
        expect(() => decideTier(ev({ intent: 'quote_price' }), NOW)).toThrow(/money or dates/);
        expect(() => decideTier(ev({ intent: 'book_date' }), NOW)).toThrow(/money or dates/);
        expect(() => assertPromotable(getPack('customer.default'), 'discount_offer')).toThrow();
        expect(() => assertPromotable(getPack('customer.default'), 'job_brief')).toThrow(/not allowed/);
        expect(() => assertPromotable(getPack('customer.default'), 'ask_gap')).not.toThrow();
    });
    it('holds READ and PROPOSE tiers', () => {
        expect(decideTier(ev({ tier: 'PROPOSE' }), NOW)).toMatchObject({ action: 'hold', to: 'PROPOSE' });
        expect(decideTier(ev({ tier: 'READ' }), NOW)).toMatchObject({ action: 'hold', to: 'READ' });
    });
});

describe('decideTier — demotion', () => {
    const send = (over: Partial<IntentEvidence> = {}) => ev({ tier: 'SEND', tierSource: 'db', ...over });
    it('holds a clean SEND intent', () => {
        expect(decideTier(send(), NOW)).toMatchObject({ action: 'hold', to: 'SEND' });
    });
    it('demotes on an unsafe verdict in 30 days', () => {
        expect(decideTier(send({ intentVerdicts30: { human: 10, approve: 9, edit: 0, reject: 1, unsafe: 1, uneditedPct: 90, firstAt: ago(5) } }), NOW)).toMatchObject({ action: 'demote', to: 'DRAFT', rule: 'unsafe_verdict' });
    });
    it('demotes on a sampled send marked not fine: unsafe', () => {
        expect(decideTier(send({ samples30: { fine: 9, notFine: 1, notFineUnsafe: 1, total: 10, approvalPct: 90 } }), NOW)).toMatchObject({ action: 'demote', rule: 'unsafe_sample' });
    });
    it('demotes on an incident tag', () => {
        expect(decideTier(send({ incidents30: 1 }), NOW)).toMatchObject({ action: 'demote', rule: 'incident' });
    });
    it('demotes when sampled approval < 80% once there are enough samples', () => {
        expect(decideTier(send({ samples30: { fine: 3, notFine: 2, notFineUnsafe: 0, total: 5, approvalPct: 60 } }), NOW)).toMatchObject({ action: 'demote', rule: 'sample_approval' });
        expect(decideTier(send({ samples30: { fine: 1, notFine: 1, notFineUnsafe: 0, total: 2, approvalPct: 50 } }), NOW)).toMatchObject({ action: 'hold' });
        expect(decideTier(send({ samples30: { fine: 8, notFine: 2, notFineUnsafe: 0, total: 10, approvalPct: 80 } }), NOW)).toMatchObject({ action: 'hold' });
        expect(GATE.minSamplesForRate).toBe(5);
    });
});

describe('evaluateAutonomy over injected evidence', () => {
    it('is idempotent and dry-run writes nothing', async () => {
        const applied: string[] = [];
        const evidence = [ev(), ev({ intent: 'closing', evalFamily: { status: 'missing', cases: 0, passed: 0 } }), ev({ intent: 'ask_gap', tier: 'SEND', incidents30: 1 })];
        const dry = await evaluateAutonomy({ dryRun: true, evidence, now: NOW, apply: async (d) => { applied.push(d.intent); } });
        expect(applied).toEqual([]);
        expect(dry.decisions.map((d) => d.action)).toEqual(['promote', 'hold', 'demote']);
        expect(dry.table).toMatch(/DRY RUN/);
        const live = await evaluateAutonomy({ dryRun: false, evidence, now: NOW, apply: async (d) => { applied.push(`${d.intent}:${d.to}`); } });
        expect(applied).toEqual(['clarify_scope:SEND', 'ask_gap:DRAFT']);
        expect(live.applied).toHaveLength(2);
        // Same evidence with the tiers now flipped: nothing to do.
        const after = await evaluateAutonomy({ dryRun: false, now: NOW, apply: async (d) => { applied.push('again'); },
            evidence: [ev({ tier: 'SEND' }), ev({ intent: 'closing', evalFamily: { status: 'missing', cases: 0, passed: 0 } }), ev({ intent: 'ask_gap', tier: 'DRAFT', incidents30: 1, evalFamily: { status: 'missing', cases: 0, passed: 0 } })] });
        expect(after.applied).toEqual([]);
        expect(applied.includes('again')).toBe(false);
    });
    it('records an assertion failure as an error instead of stopping the run', async () => {
        const r = await evaluateAutonomy({ dryRun: true, now: NOW, evidence: [ev({ intent: 'quote_price' }), ev()] });
        expect(r.errors).toHaveLength(1); expect(r.decisions).toHaveLength(1);
    });
});

describe('scoreboard → eval family', () => {
    const board = { runId: 'r1', finishedAt: '2026-09-19T00:00:00Z', cases: [
        { family: 'ask_gap', kind: 'regression' as const, passK: true }, { family: 'ask_gap', kind: 'regression' as const, passK: true },
        { family: 'closing', kind: 'regression' as const, passK: false }, { family: 'holding', kind: 'regression' as const, passK: null },
        { family: 'faq_from_kb', kind: 'capability' as const, passK: true },
    ] };
    it('passes only when every regression case passes pass^3', () => {
        expect(evalFamilyFrom(board, 'ask_gap')).toMatchObject({ status: 'pass', cases: 2, passed: 2 });
        expect(evalFamilyFrom(board, 'closing')).toMatchObject({ status: 'fail' });
        expect(evalFamilyFrom(board, 'holding')).toMatchObject({ status: 'skipped' });
        expect(evalFamilyFrom(board, 'faq_from_kb')).toMatchObject({ status: 'missing' });
        expect(evalFamilyFrom(null, 'ask_gap')).toMatchObject({ status: 'missing' });
    });
});

describe('pack tier overlay', () => {
    const pack = getPack('customer.default');
    it('overlays earned tiers on the static pack and ignores rows it must never honour', () => {
        const merged = applyTierOverlay(pack, { ask_gap: 'SEND', job_brief: 'SEND', clarify_scope: 'BOGUS' });
        expect(merged.tierByIntent.ask_gap).toBe('SEND');
        expect((merged.tierByIntent as any).job_brief).toBeUndefined();
        expect(merged.tierByIntent.clarify_scope).toBeUndefined();
        expect(pack.tierByIntent.ask_gap).toBeUndefined(); // the static pack is untouched
    });
    it('resolvePack applies the in-process overlay', () => {
        const cf = { conversationId: 'c', phone: '+447700123456', audience: 'customer', stage: 'scoping', timeline: [], media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' }, client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: '' } as CaseFile;
        const tri = { audience: 'customer', intent: 'unknown', lane: 'scoper', exceptions: [], stage: 'scoping', tags: [], reasons: [], source: 'rules' } as TriageResult;
        setTierOverlayForTests(new Map([['customer.default', { confirm_received: 'SEND' }]]));
        try {
            expect(resolvePack(cf, tri).tierByIntent.confirm_received).toBe('SEND');
        } finally {
            setTierOverlayForTests(null);
        }
        expect(resolvePack(cf, tri).tierByIntent.confirm_received).toBeUndefined();
    });
});
