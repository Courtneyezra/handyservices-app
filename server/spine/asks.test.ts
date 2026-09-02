import { describe, it, expect, vi } from 'vitest';
import { decideAsk, hasMedia, hasRecentPostcode, maybeAskFromExit, ASK_COOLDOWN_MS, type AskDeps } from './asks';
import type { CaseFile, SpineRun, TriageResult, Decision } from './types';
import { DEFAULT_SPINE_CONFIG } from './config';

const NOW = new Date('2026-09-02T10:00:00Z');
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();

function cf(over: Partial<CaseFile> = {}): CaseFile {
    return {
        conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'enquiry', contactName: 'Sam',
        timeline: [{ at: ago(12), kind: 'message_in', body: 'Hi, need a tap fitting' }], media: [],
        window: { canFreeform: true, templateRequired: false, lastInboundAt: ago(12), channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: NOW.toISOString(),
        ...over,
    };
}
const triage = (over: Partial<TriageResult> = {}): TriageResult => ({ audience: 'customer', intent: 'ack_enquiry', lane: 'rules', exceptions: [], stage: 'enquiry', tags: [], reasons: ['first contact'], source: 'rules', ...over });
const none: Decision = { kind: 'none', reason: 'no proposal' };

describe('decideAsk', () => {
    it('first contact, no media → ask_media', () => {
        expect(decideAsk({ caseFile: cf(), triage: triage(), decision: none, now: NOW, lastAsk: null })).toMatchObject({ kind: 'ask_media' });
    });
    it('media present, no postcode → ask_postcode; both present → nothing', () => {
        const withMedia = cf({ media: [{ id: 'm1', kind: 'image' }] });
        expect(decideAsk({ caseFile: withMedia, triage: triage(), decision: none, now: NOW, lastAsk: null })).toMatchObject({ kind: 'ask_postcode' });
        const both = cf({ media: [{ id: 'm1', kind: 'image' }], timeline: [{ at: ago(5), kind: 'message_in', body: 'Ng37eg' }] });
        expect(decideAsk({ caseFile: both, triage: triage(), decision: none, now: NOW, lastAsk: null }).kind).toBeNull();
    });
    it('media first, never both in one tick', () => {
        const neither = cf();
        expect(decideAsk({ caseFile: neither, triage: triage(), decision: none, now: NOW, lastAsk: null }).kind).toBe('ask_media');
    });
    it('a postcode older than 30 days does not count', () => {
        const old = cf({ media: [{ id: 'm1', kind: 'image' }], timeline: [{ at: new Date(NOW.getTime() - 31 * 86_400_000).toISOString(), kind: 'message_in', body: 'NG3 7EG' }] });
        expect(decideAsk({ caseFile: old, triage: triage(), decision: none, now: NOW, lastAsk: null }).kind).toBe('ask_postcode');
    });
    it('one ask per thread per 24h', () => {
        const recent = { kind: 'ask_media' as const, at: new Date(NOW.getTime() - ASK_COOLDOWN_MS + 60_000) };
        expect(decideAsk({ caseFile: cf(), triage: triage(), decision: none, now: NOW, lastAsk: recent }).kind).toBeNull();
        const stale = { kind: 'ask_media' as const, at: new Date(NOW.getTime() - ASK_COOLDOWN_MS - 60_000) };
        expect(decideAsk({ caseFile: cf(), triage: triage(), decision: none, now: NOW, lastAsk: stale }).kind).toBe('ask_media');
    });
    it('only on the rules lane, only after a none decision, never with an exception or an open flag', () => {
        expect(decideAsk({ caseFile: cf(), triage: triage({ lane: 'scoper' }), decision: none, now: NOW, lastAsk: null }).kind).toBeNull();
        expect(decideAsk({ caseFile: cf(), triage: triage(), decision: { kind: 'send', approver: 'rules.first_contact' }, now: NOW, lastAsk: null }).kind).toBeNull();
        expect(decideAsk({ caseFile: cf(), triage: triage({ exceptions: ['money_question'] }), decision: none, now: NOW, lastAsk: null }).kind).toBeNull();
        expect(decideAsk({ caseFile: cf({ tags: ['needs_ben'] }), triage: triage(), decision: none, now: NOW, lastAsk: null }).kind).toBeNull();
        expect(decideAsk({ caseFile: cf({ audience: 'contractor' }), triage: triage(), decision: none, now: NOW, lastAsk: null }).kind).toBeNull();
    });
    it('helpers read the timeline', () => {
        expect(hasMedia(cf({ timeline: [{ at: ago(1), kind: 'message_in', body: '', mediaIds: ['x'] }] }))).toBe(true);
        expect(hasRecentPostcode(cf({ timeline: [{ at: ago(1), kind: 'message_in', body: 'we are at ng12 5fd thanks' }] }), NOW)).toBe(true);
        expect(hasRecentPostcode(cf({ timeline: [{ at: ago(1), kind: 'message_out', body: 'NG1 1AA' }] }), NOW)).toBe(false);
    });
});

describe('maybeAskFromExit', () => {
    const run = (over: Partial<SpineRun> = {}): SpineRun => ({
        runId: 'run_1', agent: 'rules', trigger: 'inbound_message', pack: { id: 'rules.first_contact', version: 1 },
        caseFile: cf(), triage: triage(), proposal: null, decision: none, ...over,
    });
    function deps(config: Partial<typeof DEFAULT_SPINE_CONFIG>, sent = true): AskDeps & { calls: string[] } {
        const calls: string[] = [];
        return {
            calls,
            getConfig: async () => ({ ...DEFAULT_SPINE_CONFIG, ...config, asks: { enabled: true, ...(config.asks ?? {}) } }),
            lastAsk: async () => null,
            sendAsk: vi.fn(async (_id, kind) => { calls.push(`send:${kind}`); return { sent, kind, reason: sent ? 'SENT' : 'SUPPRESSED', suppressedBy: sent ? undefined : 'answered', mode: 'freeform' } as any; }),
            log: vi.fn(async (s) => { calls.push(`log:${s}`); }),
            now: () => NOW,
        };
    }
    it('returns null for non-first-contact runs without reading config', async () => {
        const d = deps({ enabled: true });
        expect(await maybeAskFromExit(run({ triage: triage({ lane: 'scoper' }) }), d)).toBeNull();
        expect(d.calls).toEqual([]);
    });
    it('spine off → skipped; asks.enabled false → skipped', async () => {
        expect(await maybeAskFromExit(run(), deps({ enabled: false }))).toMatchObject({ action: 'skipped', mode: 'off' });
        const d = deps({ enabled: true }); d.getConfig = async () => ({ ...DEFAULT_SPINE_CONFIG, enabled: true, asks: { enabled: false } });
        expect(await maybeAskFromExit(run(), d)).toMatchObject({ action: 'skipped', reason: 'spine.asks.enabled is false' });
    });
    it('shadow → logs, never sends', async () => {
        const d = deps({ enabled: true, shadow: true });
        const out = await maybeAskFromExit(run(), d);
        expect(out).toMatchObject({ kind: 'ask_media', action: 'shadow', mode: 'shadow' });
        expect(d.calls).toEqual(['log:shadow: would ask ask_media (no photo or video on the thread)']);
    });
    it('live → sendAsk with the run id; suppression is reported not retried', async () => {
        const d = deps({ enabled: true });
        expect(await maybeAskFromExit(run(), d)).toMatchObject({ kind: 'ask_media', action: 'sent', detail: 'freeform' });
        expect((d.sendAsk as any).mock.calls[0]).toEqual(['c1', 'ask_media', 'run_1']);
        const s = deps({ enabled: true }, false);
        expect(await maybeAskFromExit(run(), s)).toMatchObject({ kind: 'ask_media', action: 'suppressed', detail: 'answered' });
    });
    it('live with a recent ask → skipped by the 24h rule', async () => {
        const d = deps({ enabled: true });
        d.lastAsk = async () => ({ kind: 'ask_postcode', at: new Date(NOW.getTime() - 3600_000) });
        expect(await maybeAskFromExit(run(), d)).toMatchObject({ action: 'skipped' });
        expect(d.calls).toEqual([]);
    });
});
