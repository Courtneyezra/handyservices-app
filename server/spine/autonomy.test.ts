/**
 * Phase 3 vitest: the promotion / demotion decision over fake evidence, every branch, no database.
 */
import { describe, it, expect, vi } from 'vitest';
import { decideTier, evalFamilyFrom, evaluateAutonomy, GATE, validateHumanTierRequest, setTierByHuman, evidenceFloorMs, foldWindow, demoteOnUnsafeVerdict, renderAutonomyTable, FAST_TRACK_INTENTS, INCIDENT_TAGS, type IntentEvidence, type VerdictEventRow, type IncidentEventRow } from './autonomy';
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

// ---------------------------------------------------------------- P6: a person moves the ladder

describe('validateHumanTierRequest', () => {
    it('accepts a DRAFT → SEND for an intent in the pack with a reason', () => {
        const v = validateHumanTierRequest({ packId: 'customer.default', intent: 'ask_gap', tier: 'send', reason: 'two clean weeks' });
        expect(v).toEqual({ ok: true, request: { packId: 'customer.default', intent: 'ask_gap', tier: 'SEND', reason: 'two clean weeks' } });
    });
    it('refuses an intent outside the pack at any tier', () => {
        const v = validateHumanTierRequest({ packId: 'customer.default', intent: 'job_brief', tier: 'DRAFT', reason: 'x' });
        expect(v.ok).toBe(false);
        expect((v as any).errors.join(' ')).toMatch(/job_brief is not an intent of pack customer.default/);
    });
    it('refuses SEND for a money / date name even if someone tries to smuggle it in', () => {
        const packs = { 'customer.default': { ...getPack('customer.default'), allowedIntents: [...getPack('customer.default').allowedIntents, 'price_confirm' as any] } };
        const v = validateHumanTierRequest({ packId: 'customer.default', intent: 'price_confirm', tier: 'SEND', reason: 'x' }, packs as any);
        expect(v.ok).toBe(false);
        expect((v as any).errors.join(' ')).toMatch(/not an intent|money or dates/); // isIntent fires first for a name outside the vocabulary; either way it is refused
    });
    it('refuses an unknown pack, a bad tier, a rules pack and an empty reason', () => {
        expect((validateHumanTierRequest({ packId: 'nope', intent: 'ask_gap', tier: 'SEND', reason: 'x' }) as any).errors.join(' ')).toMatch(/unknown pack/);
        expect((validateHumanTierRequest({ packId: 'customer.default', intent: 'ask_gap', tier: 'AUTO', reason: 'x' }) as any).errors.join(' ')).toMatch(/tier must be one of/);
        expect((validateHumanTierRequest({ packId: 'rules.first_contact', intent: 'holding', tier: 'DRAFT', reason: 'x' }) as any).errors.join(' ')).toMatch(/not on the DRAFT → SEND ladder/);
        expect((validateHumanTierRequest({ packId: 'customer.default', intent: 'ask_gap', tier: 'SEND', reason: '  ' }) as any).errors.join(' ')).toMatch(/reason is required/);
    });
});

describe('setTierByHuman', () => {
    it('writes the change with changed_by human:<id> and pings the owner', async () => {
        const writes: any[] = []; const pings: any[] = [];
        const change = await setTierByHuman({ packId: 'customer.default', intent: 'confirm_received', tier: 'SEND', reason: 'earned it' }, {
            by: 'human:ben', currentTier: async () => 'DRAFT',
            write: async (c, ev) => { writes.push([c, ev]); }, notify: async (a) => { pings.push(a); },
        });
        expect(change).toMatchObject({ packId: 'customer.default', intent: 'confirm_received', from: 'DRAFT', to: 'SEND', by: 'human:ben', changed: true });
        expect(writes).toHaveLength(1);
        expect(writes[0][1]).toMatchObject({ rule: 'human', by: 'human:ben', from: 'DRAFT', to: 'SEND' });
        expect(pings[0]).toMatchObject({ packId: 'customer.default', intent: 'confirm_received', fromTier: 'DRAFT', toTier: 'SEND', reason: 'human: earned it' });
    });
    it('is idempotent: the tier already held writes nothing and pings nobody', async () => {
        const writes: any[] = []; const pings: any[] = [];
        const change = await setTierByHuman({ packId: 'customer.default', intent: 'ask_gap', tier: 'DRAFT', reason: 'demote' }, {
            by: 'human:ben', currentTier: async () => 'DRAFT', write: async (c) => { writes.push(c); }, notify: async (a) => { pings.push(a); },
        });
        expect(change.changed).toBe(false);
        expect(writes).toHaveLength(0); expect(pings).toHaveLength(0);
    });
    it('refuses a non-human approver and an invalid request before touching anything', async () => {
        const write = vi.fn(async () => undefined);
        await expect(setTierByHuman({ packId: 'customer.default', intent: 'ask_gap', tier: 'SEND', reason: 'x' }, { by: 'system:autonomy', write, currentTier: async () => 'DRAFT' })).rejects.toThrow(/human:<id>/);
        await expect(setTierByHuman({ packId: 'customer.default', intent: 'job_brief', tier: 'SEND', reason: 'x' }, { by: 'human:ben', write, currentTier: async () => 'DRAFT' })).rejects.toThrow(/not an intent of pack/);
        expect(write).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------- B6: demotion while the autonomy flag is off

describe('B6 evaluateAutonomy in demote-only mode', () => {
    const promotable = ev();                                                       // DRAFT, full gate passes
    const incident = ev({ intent: 'ask_gap', tier: 'SEND', tierSource: 'db', incidents30: 1 }); // SEND with an incident
    const clean = ev({ intent: 'confirm_received', tier: 'SEND', tierSource: 'db' });        // SEND, nothing wrong

    it('applies exactly the demotion, holds the promotion, and shows both in the table', async () => {
        const applied: string[] = [];
        const r = await evaluateAutonomy({ dryRun: false, mode: 'demote_only', now: NOW, evidence: [promotable, incident, clean], apply: async (d) => { applied.push(`${d.intent}:${d.action}:${d.to}`); } });
        expect(applied).toEqual(['ask_gap:demote:DRAFT']);
        expect(r.applied.map((d) => d.intent)).toEqual(['ask_gap']);
        expect(r.held).toHaveLength(1);
        expect(r.held[0]).toMatchObject({ intent: 'clarify_scope', action: 'promote', to: 'SEND', rule: 'full_gate' });
        // decideTier ran as in full mode: the promotion is still a decision, not an error.
        expect(r.decisions.map((d) => d.action)).toEqual(['promote', 'demote', 'hold']);
        expect(r.errors).toEqual([]);
        expect(r.mode).toBe('demote_only');
        expect(r.table).toMatch(/demote-only/);
        expect(r.table).toMatch(/promote → SEND \(full_gate\) \[held: demote-only\]/);
        expect(r.table).toMatch(/held \(demote-only\): clarify_scope → SEND \(full_gate\)/);
        expect(r.table).toMatch(/applied: ask_gap → DRAFT/);
    });
    it('never promotes, whatever the evidence says', async () => {
        const applied: any[] = [];
        const promotables = [ev(), ev({ intent: 'ask_gap', evalFamily: { status: 'missing', cases: 0, passed: 0 }, packVerdicts30: { human: 12, approve: 12, edit: 0, reject: 0, unsafe: 0, uneditedPct: 100, firstAt: ago(15) } })];
        const r = await evaluateAutonomy({ dryRun: false, mode: 'demote_only', now: NOW, evidence: promotables, apply: async (d) => { applied.push(d); } });
        expect(r.decisions.every((d) => d.action === 'promote')).toBe(true);
        expect(applied).toEqual([]);
        expect(r.applied).toEqual([]);
        expect(r.held).toHaveLength(2);
    });
    it('a run that changes nothing applies nothing (so it pings nobody)', async () => {
        const applied: any[] = [];
        const r = await evaluateAutonomy({ dryRun: false, mode: 'demote_only', now: NOW, evidence: [clean, ev({ intent: 'closing', evalFamily: { status: 'missing', cases: 0, passed: 0 } })], apply: async (d) => { applied.push(d); } });
        expect(applied).toEqual([]); expect(r.applied).toEqual([]); expect(r.held).toEqual([]);
    });
    it('the default mode is full: the same evidence promotes and demotes as before', async () => {
        const applied: string[] = [];
        const r = await evaluateAutonomy({ dryRun: false, now: NOW, evidence: [promotable, incident, clean], apply: async (d) => { applied.push(`${d.intent}:${d.to}`); } });
        expect(r.mode).toBe('full');
        expect(applied).toEqual(['clarify_scope:SEND', 'ask_gap:DRAFT']);
        expect(r.held).toEqual([]);
        expect(r.table).not.toMatch(/demote-only/);
    });
    it('dry run in demote-only mode writes nothing and still prints the table', async () => {
        const applied: any[] = [];
        const r = await evaluateAutonomy({ dryRun: true, mode: 'demote_only', now: NOW, evidence: [promotable, incident], apply: async (d) => { applied.push(d); } });
        expect(applied).toEqual([]);
        expect(r.table).toMatch(/DRY RUN \(demote-only/);
        expect(r.table).toMatch(/demote → DRAFT \(incident\)/);
        expect(renderAutonomyTable(r).split('\n').length).toBeGreaterThan(3);
    });
    it('the numbers and the signal list are what they were', () => {
        expect(GATE).toEqual({ verdictWindowDays: 30, minPackVerdicts: 30, minUneditedPct: 90, escalationWindowDays: 14, fastTrackMinDays: 14, fastTrackMinVerdicts: 20, sampleWindowDays: 30, minSamplesForRate: 5, minSampleApprovalPct: 80 });
        expect(FAST_TRACK_INTENTS).toEqual(['ask_gap', 'confirm_received']);
        expect(INCIDENT_TAGS).toEqual(['incident', 'trust_concern', 'complaint']);
    });
});

describe('B6 evidence floor: a human SEND counts demotion signals from the moment it was set', () => {
    const T0 = NOW.getTime();
    const day = 86_400_000;
    const unsafeAt = (ms: number): VerdictEventRow => ({ pack_id: 'customer.default', intent: 'ask_gap', verdict: 'reject', reason: 'unsafe', at_ms: ms });
    const humanSend = { tier: 'SEND' as const, at: new Date(T0).toISOString(), by: 'human:ben', reason: 'day one' };

    it('floors only a human SEND', () => {
        expect(evidenceFloorMs(humanSend)).toBe(T0);
        expect(evidenceFloorMs({ ...humanSend, atMs: T0 + 5, at: 'garbage' })).toBe(T0 + 5); // the row's epoch wins over the text
        expect(evidenceFloorMs({ ...humanSend, by: 'system:autonomy' })).toBeNull();
        expect(evidenceFloorMs({ ...humanSend, by: 'system:verdict' })).toBeNull();
        expect(evidenceFloorMs({ ...humanSend, tier: 'DRAFT' })).toBeNull();
        expect(evidenceFloorMs(null)).toBeNull();
        expect(evidenceFloorMs({ ...humanSend, at: 'not a date' })).toBeNull();
    });
    it('an unsafe verdict the day BEFORE the human SEND holds; the same verdict the day AFTER demotes', () => {
        const floor = evidenceFloorMs(humanSend);
        const before = foldWindow([unsafeAt(T0 - day)], [], floor);
        const dBefore = decideTier(ev({ intent: 'ask_gap', tier: 'SEND', tierSource: 'db', intentVerdicts30: before.verdicts, samples30: before.samples, incidents30: before.incidents30, lastChange: humanSend }), NOW);
        expect(before.verdicts.unsafe).toBe(0);
        expect(before.verdicts.reject).toBe(1); // the human count still spans the whole window
        expect(dBefore).toMatchObject({ action: 'hold', to: 'SEND' });

        const after = foldWindow([unsafeAt(T0 + day)], [], floor);
        const dAfter = decideTier(ev({ intent: 'ask_gap', tier: 'SEND', tierSource: 'db', intentVerdicts30: after.verdicts, samples30: after.samples, incidents30: after.incidents30, lastChange: humanSend }), NOW);
        expect(after.verdicts.unsafe).toBe(1);
        expect(dAfter).toMatchObject({ action: 'demote', to: 'DRAFT', rule: 'unsafe_verdict' });
    });
    it('a system:autonomy SEND is not floored: the earlier verdict still demotes', () => {
        const floor = evidenceFloorMs({ ...humanSend, by: 'system:autonomy' });
        const folded = foldWindow([unsafeAt(T0 - day)], [], floor);
        expect(folded.verdicts.unsafe).toBe(1);
        expect(decideTier(ev({ intent: 'ask_gap', tier: 'SEND', tierSource: 'db', intentVerdicts30: folded.verdicts }), NOW)).toMatchObject({ action: 'demote', rule: 'unsafe_verdict' });
    });
    it('floors incidents and the sampled set too, and leaves the promotion counts alone', () => {
        const incidents: IncidentEventRow[] = [{ pack_id: 'customer.default', intent: 'ask_gap', at_ms: T0 - day }, { pack_id: 'customer.default', intent: 'ask_gap', at_ms: T0 + day }];
        const samples: VerdictEventRow[] = [
            { pack_id: 'customer.default', intent: 'ask_gap', verdict: 'sample_not_fine', reason: 'unsafe', at_ms: T0 - day },
            { pack_id: 'customer.default', intent: 'ask_gap', verdict: 'sample_not_fine', reason: 'wrong_move', at_ms: T0 - day },
            { pack_id: 'customer.default', intent: 'ask_gap', verdict: 'sample_fine', reason: 'fine', at_ms: T0 + day },
            { pack_id: 'customer.default', intent: 'ask_gap', verdict: 'approve', reason: 'fine', at_ms: T0 - 2 * day },
            { pack_id: 'customer.default', intent: 'ask_gap', verdict: 'edit', reason: 'tone', at_ms: T0 + 2 * day },
        ];
        const floored = foldWindow(samples, incidents, T0);
        expect(floored.incidents30).toBe(1);
        expect(floored.samples).toEqual({ fine: 1, notFine: 0, notFineUnsafe: 0, total: 1, approvalPct: 100 });
        expect(floored.verdicts).toMatchObject({ human: 2, approve: 1, edit: 1, reject: 0, unsafe: 0, uneditedPct: 50 });
        expect(floored.verdicts.firstAt).toBe(new Date(T0 - 2 * day).toISOString());
        const whole = foldWindow(samples, incidents, null);
        expect(whole.incidents30).toBe(2);
        expect(whole.samples).toEqual({ fine: 1, notFine: 2, notFineUnsafe: 1, total: 3, approvalPct: 33.3 });
        expect(whole.verdicts.unsafe).toBe(1);
    });
});

describe('B6 demoteOnUnsafeVerdict with injected dependencies', () => {
    const verdict = { draftId: 'd1', runId: 'run1', verdict: 'reject', reason: 'unsafe', by: 'human:ben', verdictId: 'v1' };
    const onLadder = async () => ({ packId: 'customer.default', intent: 'ask_gap' });

    it('SEND → one demote write with by system:verdict', async () => {
        const writes: any[] = [];
        const r = await demoteOnUnsafeVerdict(verdict, { resolve: onLadder, currentTier: async () => 'SEND', now: NOW, apply: async (d, evd, deps) => { writes.push({ d, evd, deps }); } });
        expect(r.demoted).toBe(true);
        expect(writes).toHaveLength(1);
        expect(writes[0].d).toMatchObject({ packId: 'customer.default', intent: 'ask_gap', from: 'SEND', to: 'DRAFT', action: 'demote', rule: 'unsafe_verdict' });
        expect(writes[0].d.reasons[0]).toMatch(/unsafe verdict \(reject\) by human:ben on draft d1/);
        expect(writes[0].deps.by).toBe('system:verdict');
        expect(writes[0].evd).toMatchObject({ tier: 'SEND', intentVerdicts30: { unsafe: 1 }, trigger: { draftId: 'd1', runId: 'run1', verdictBy: 'human:ben', verdictId: 'v1', verdict: 'reject' } });
    });
    it('DRAFT → no write (idempotent: a second unsafe on a demoted intent does nothing)', async () => {
        const apply = vi.fn(async () => undefined);
        const r = await demoteOnUnsafeVerdict(verdict, { resolve: onLadder, currentTier: async () => 'DRAFT', apply });
        expect(r.demoted).toBe(false); expect(r.why).toMatch(/at DRAFT/);
        expect(apply).not.toHaveBeenCalled();
    });
    it('an unknown run, a pack off the ladder, or an intent outside the pack → no write', async () => {
        const apply = vi.fn(async () => undefined);
        const tier = vi.fn(async () => 'SEND' as const);
        expect((await demoteOnUnsafeVerdict(verdict, { resolve: async () => null, currentTier: tier, apply })).demoted).toBe(false);
        expect((await demoteOnUnsafeVerdict(verdict, { resolve: async () => ({ packId: 'customer.default', intent: null }), currentTier: tier, apply })).demoted).toBe(false);
        expect((await demoteOnUnsafeVerdict(verdict, { resolve: async () => ({ packId: 'rules.first_contact', intent: 'holding' }), currentTier: tier, apply })).demoted).toBe(false);
        expect((await demoteOnUnsafeVerdict(verdict, { resolve: async () => ({ packId: 'customer.default', intent: 'job_brief' }), currentTier: tier, apply })).demoted).toBe(false);
        expect(apply).not.toHaveBeenCalled(); expect(tier).not.toHaveBeenCalled();
    });
    it('a non-unsafe verdict, and sample_fine even with reason unsafe, never reach the resolver', async () => {
        const resolve = vi.fn(onLadder);
        expect((await demoteOnUnsafeVerdict({ ...verdict, reason: 'wrong_move' }, { resolve })).demoted).toBe(false);
        expect((await demoteOnUnsafeVerdict({ ...verdict, verdict: 'sample_fine' }, { resolve })).demoted).toBe(false);
        expect(resolve).not.toHaveBeenCalled();
    });
    it('the judge\'s sampled unsafe demotes too (parity with the job: no author filter)', async () => {
        const writes: any[] = [];
        const r = await demoteOnUnsafeVerdict({ ...verdict, verdict: 'sample_not_fine', by: 'agent.verifier' }, { resolve: onLadder, currentTier: async () => 'SEND', apply: async (d) => { writes.push(d); } });
        expect(r.demoted).toBe(true); expect(writes).toHaveLength(1);
    });
    it('a throwing write, resolver or tier read does not throw out', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            await expect(demoteOnUnsafeVerdict(verdict, { resolve: onLadder, currentTier: async () => 'SEND', apply: async () => { throw new Error('db down'); } })).resolves.toMatchObject({ demoted: false, why: /db down/ });
            await expect(demoteOnUnsafeVerdict(verdict, { resolve: async () => { throw new Error('no db'); } })).resolves.toMatchObject({ demoted: false });
            await expect(demoteOnUnsafeVerdict(verdict, { resolve: onLadder, currentTier: async () => { throw new Error('overlay'); } })).resolves.toMatchObject({ demoted: false });
            expect(warn).toHaveBeenCalledTimes(3);
        } finally {
            warn.mockRestore();
        }
    });
});
