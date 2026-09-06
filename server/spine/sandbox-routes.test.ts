/**
 * T5 vitest: the sandbox route's pure parts and its shape. No database (mocked at import).
 *
 * The refusal that matters most is structural, so it is pinned structurally: the router has NO
 * route with a parameter and NO route that reads a conversation id — every action is "the sandbox
 * thread", found by number. An arbitrary conversation id cannot be named, so it cannot be mutated.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, pool: {} }));
vi.mock('./index', () => ({ runOnce: vi.fn() }));

import {
    commsSandboxRouter, validateCustomerText, validateQuoteSeed, sandboxSlug, summariseRun,
    MAX_MESSAGE_CHARS, SANDBOX_DEFAULT_TOTAL_PENCE, SANDBOX_QUOTE_MARK, firstContactMirrorFor, SANDBOX_RULES_ACK_SENDER, MIRROR_NOTE } from './sandbox-routes';
import type { RunOnceResult } from './index';

describe('router shape', () => {
    const routes = (commsSandboxRouter as any).stack
        .filter((l: any) => l.route)
        .map((l: any) => ({ path: l.route.path as string, methods: Object.keys(l.route.methods) }));

    it('exposes exactly the four sandbox actions', () => {
        expect(routes.map((r: any) => `${r.methods.join(',')} ${r.path}`).sort()).toEqual([
            'get /', 'post /message', 'post /quote', 'post /reset',
        ]);
    });
    it('no route takes a parameter — nothing can name a conversation id', () => {
        for (const r of routes) expect(r.path).not.toMatch(/:/);
    });
});

describe('validateCustomerText', () => {
    it('trims, normalises line endings, refuses empty and over-long', () => {
        expect(validateCustomerText('  hi\r\nthere  ')).toEqual({ ok: true, text: 'hi\nthere' });
        expect(validateCustomerText('   ')).toMatchObject({ ok: false });
        expect(validateCustomerText(42)).toMatchObject({ ok: false });
        expect(validateCustomerText('x'.repeat(MAX_MESSAGE_CHARS + 1))).toMatchObject({ ok: false });
        expect(validateCustomerText('x'.repeat(MAX_MESSAGE_CHARS))).toMatchObject({ ok: true });
    });
});

describe('validateQuoteSeed', () => {
    it('defaults to the house amount and a title; refuses non-integers and silly amounts', () => {
        expect(validateQuoteSeed(undefined)).toMatchObject({ ok: true, totalPence: SANDBOX_DEFAULT_TOTAL_PENCE });
        expect(validateQuoteSeed({ totalPence: 12345, title: '  Fix the gate ' })).toEqual({ ok: true, totalPence: 12345, title: 'Fix the gate' });
        expect(validateQuoteSeed({ totalPence: 12.5 })).toMatchObject({ ok: false });
        expect(validateQuoteSeed({ totalPence: 0 })).toMatchObject({ ok: false });
        expect(validateQuoteSeed({ totalPence: 5_000_000 })).toMatchObject({ ok: false });
        expect(validateQuoteSeed({ totalPence: '480' })).toMatchObject({ ok: true, totalPence: 480 });
    });
    it('the seeded quote is marked SANDBOX in words', () => {
        expect(SANDBOX_QUOTE_MARK).toMatch(/SANDBOX/);
    });
});

describe('T6: firstContactMirrorFor — the rules layer answers first contact, the sandbox mirrors it', () => {
    const tri = (over: Record<string, unknown> = {}) => ({ audience: 'customer', intent: 'ack_enquiry', lane: 'rules', exceptions: [], stage: 'enquiry', tags: [], reasons: [], source: 'rules', ...over }) as any;
    const none = { kind: 'none', reason: 'no proposal' } as any;
    const firstContact = { id: 'rules.first_contact', version: 1 };
    it('a rules-lane first-contact none mirrors the ack, with the intent triage chose', () => {
        expect(firstContactMirrorFor({ triage: tri(), pack: firstContact, decision: none })).toEqual({ intent: 'ack_enquiry' });
        expect(firstContactMirrorFor({ triage: tri({ intent: 'ack_photos' }), pack: firstContact, decision: none })).toEqual({ intent: 'ack_photos' });
    });
    it('anything the desk (or Ben) handles is never mirrored', () => {
        expect(firstContactMirrorFor({ triage: tri({ lane: 'scoper', intent: 'unknown' }), pack: { id: 'customer.pre_quote', version: 1 }, decision: none })).toBeNull();
        expect(firstContactMirrorFor({ triage: tri({ lane: 'post_quote', intent: 'unknown' }), pack: { id: 'customer.post_quote', version: 1 }, decision: none })).toBeNull();
        expect(firstContactMirrorFor({ triage: tri({ lane: 'ben', intent: 'unknown', exceptions: ['money_question'] }), pack: { id: 'customer.exception', version: 1 }, decision: { kind: 'flag', exception: 'money_question' } as any })).toBeNull();
        // Rules lane but not the first-contact pack, or not a quiet decision: leave it alone.
        expect(firstContactMirrorFor({ triage: tri(), pack: { id: 'rules.followup', version: 1 }, decision: none })).toBeNull();
        expect(firstContactMirrorFor({ triage: tri(), pack: firstContact, decision: { kind: 'drop', reason: 'spam' } as any })).toBeNull();
        expect(firstContactMirrorFor({ triage: tri({ intent: 'holding' }), pack: firstContact, decision: none })).toBeNull();
    });
    it('the mirrored bubble is named so the page can label it, and the note says who answers', () => {
        expect(SANDBOX_RULES_ACK_SENDER.toLowerCase()).toContain('rules layer ack');
        expect(SANDBOX_RULES_ACK_SENDER.toLowerCase()).toContain('never sent');
        expect(MIRROR_NOTE).toMatch(/rules layer/);
        expect(MIRROR_NOTE).toMatch(/next message reaches the desk/);
    });
});

describe('sandboxSlug', () => {
    it('fits the 8-char column and is recognisable', () => {
        for (let i = 0; i < 20; i++) {
            const s = sandboxSlug();
            expect(s.length).toBeLessThanOrEqual(8);
            expect(s.startsWith('sbx')).toBe(true);
        }
    });
});

describe('summariseRun', () => {
    it('keeps the decisions, drops the case file bulk, carries the cost', () => {
        const run = {
            runId: 'run_1', agent: 'scoper', trigger: 'inbound_message', pack: { id: 'customer.post_quote', version: 3 },
            caseFile: {
                conversationId: 'c', phone: '+447700900942', audience: 'customer', stage: 'quote_sent', timeline: [{}, {}, {}], media: [],
                window: { canFreeform: true, templateRequired: false, channelLastUsed: 'whatsapp' }, quote: { slug: 'sbx1', paid: false, lines: 1 },
                openPromises: [], openFlags: [], tags: ['sandbox'], hash: 'h', builtAt: 'b',
            },
            triage: { audience: 'customer', intent: 'unknown', lane: 'post_quote', exceptions: [], stage: 'quote_sent', tags: [], reasons: ['r'], source: 'rules' },
            proposal: { intent: 'ask_gap', body: ['?'], reasons: ['still scoping'] },
            guards: { ok: true, guardsHit: [], escalate: false, notes: [] },
            decision: { kind: 'pending', dueAt: 'd', reason: 'tier DRAFT' },
            durationMs: 1200, dryRun: true, sandbox: true, exitNote: 'DRY RUN — …', skipped: ['job pack filing'], error: null,
        } as unknown as RunOnceResult;
        const s = summariseRun(run, { costPence: 3, model: 'claude-sonnet-5', turns: null });
        expect(s).toMatchObject({ runId: 'run_1', dryRun: true, sandbox: true, costPence: 3, model: 'claude-sonnet-5', exitNote: 'DRY RUN — …' });
        expect(s.caseFile).toEqual({
            stage: 'quote_sent', tags: ['sandbox'], quote: { slug: 'sbx1', paid: false, lines: 1 },
            window: { canFreeform: true, templateRequired: false, channelLastUsed: 'whatsapp' }, openFlags: [], openPromises: [], timelineItems: 3,
        });
        expect((s as any).caseFile.timeline).toBeUndefined();
        expect(s.proposal?.body).toEqual(['?']);
    });
    it('a run with no cost row reads as not recorded, and dry-run defaults to true', () => {
        const s = summariseRun({ runId: 'r', agent: 'scoper', trigger: 'manual', pack: { id: 'p', version: 1 }, caseFile: { stage: 'enquiry', tags: [], timeline: [], window: {}, openFlags: [], openPromises: [] }, triage: {}, decision: { kind: 'none', reason: 'x' } } as any, null);
        expect(s.costPence).toBeNull();
        expect(s.dryRun).toBe(true);
        expect(s.skipped).toEqual([]);
    });
});
