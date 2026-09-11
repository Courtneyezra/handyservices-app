import { describe, expect, it } from 'vitest';
import {
    CONTRACT_GUARDS, UNAVAILABLE, allGuardsUnavailable, guardsFrom, plannedSendFrom, plannedSendFromDoorResponse, plannedSendSchema, splitAckBubbles,
} from './planned-send';

/** A door response shaped like POST /message on the current sandbox, with the desk sending. */
function doorSend(over: Record<string, unknown> = {}) {
    return {
        ok: true,
        messageId: 'msg_sbx_1',
        run: {
            runId: 'run_1', agent: 'scoper', trigger: 'inbound_message', pack: { id: 'customer.default', version: 3 },
            triage: { lane: 'scoper', intent: 'ask_gap', stage: 'scoping' },
            proposal: { intent: 'ask_gap', body: ['Thanks, that helps.', 'Whereabouts are you?'], reasons: [], citations: [] },
            guards: { ok: true, guardsHit: [], escalate: false, notes: ['money: none'] },
            decision: { kind: 'send', approver: { kind: 'agent', id: 'scoper' } },
            exitNote: 'dry run: would send 2 bubbles',
            caseFile: { stage: 'scoping', tags: [], window: { canFreeform: true, templateRequired: false } },
            ...over,
        },
        mirrored: null,
        state: {
            phone: { e164: '+447700900942', wa: 'whatsapp:+447700900942' },
            conversation: { id: 'conv_1', stage: 'scoping', tags: ['sandbox'], contactName: 'Sam' },
            window: { canFreeform: true, summary: 'OPEN' },
            messages: [],
        },
    };
}

describe('plannedSendSchema', () => {
    it('accepts a complete object and refuses a missing field', () => {
        const { plannedSend } = plannedSendFromDoorResponse(doorSend());
        expect(plannedSendSchema.safeParse(plannedSend).success).toBe(true);
        const { runId: _drop, ...without } = plannedSend;
        expect(plannedSendSchema.safeParse(without).success).toBe(false);
    });

    it('names every Contract 7 field', () => {
        const keys = Object.keys(plannedSendSchema.shape);
        for (const k of ['caseId', 'party', 'channel', 'windowState', 'templateId', 'bubbles', 'factIds', 'kbIds', 'guards', 'approver', 'runId', 'hold']) expect(keys).toContain(k);
    });

    it('records every Contract 4 guard by name', () => {
        const g = allGuardsUnavailable('x');
        expect(Object.keys(g).sort()).toEqual([...CONTRACT_GUARDS].sort());
    });
});

describe('guardsFrom', () => {
    it('is all unavailable when no guard ran', () => {
        const g = guardsFrom(null);
        for (const k of CONTRACT_GUARDS) expect(g[k].result).toBe(UNAVAILABLE);
    });
    it('maps the old names onto the contract guards and leaves the rest unavailable', () => {
        const g = guardsFrom({ ok: false, guardsHit: ['money', 'soft_commitment'] });
        expect(g.figure.result).toBe('fail');
        expect(g.figure.note).toContain('money');
        expect(g.commitment_fault.result).toBe('fail');
        expect(g.date_time_duration.result).toBe('pass');
        expect(g.business_claim.result).toBe('pass');
        expect(g.disclosure.result).toBe(UNAVAILABLE);
        expect(g.one_reply.result).toBe(UNAVAILABLE);
        expect(g.ask_ledger.result).toBe(UNAVAILABLE);
        expect(g.regulated.result).toBe(UNAVAILABLE);
    });
});

describe('plannedSendFrom (adapter over the sandbox dry run)', () => {
    it('a send decision: the proposal bubbles go, approver from the decision, fact and kb ids unavailable', () => {
        const { plannedSend: ps } = plannedSendFromDoorResponse(doorSend());
        expect(ps.delivered).toBe(true);
        expect(ps.origin).toBe('desk');
        expect(ps.bubbles).toEqual(['Thanks, that helps.', 'Whereabouts are you?']);
        expect(ps.caseId).toBe('conv_1');
        expect(ps.party).toEqual({ role: 'homeowner', address: '+447700900942', name: 'Sam' });
        expect(ps.channel).toBe('whatsapp');
        expect(ps.windowState).toBe('open');
        expect(ps.templateId).toBeNull();
        expect(ps.factIds).toBe(UNAVAILABLE);
        expect(ps.kbIds).toBe(UNAVAILABLE);
        expect(ps.approver).toBe('scoper');
        expect(ps.runId).toBe('run_1');
        expect(ps.hold).toBeNull();
        expect(ps.guards.figure.result).toBe('pass');
        expect(ps.evidence.decision).toBe('send');
        expect(ps.evidence.intent).toBe('ask_gap');
    });

    it('a flag decision: nothing goes and a hold for Ben carries the exception', () => {
        const { plannedSend: ps } = plannedSendFromDoorResponse(doorSend({ decision: { kind: 'flag', exception: 'money_question', dueAt: '2026-09-11T10:00:00Z', note: 'price asked' }, proposal: null, guards: null }));
        expect(ps.delivered).toBe(false);
        expect(ps.bubbles).toEqual([]);
        expect(ps.hold).toEqual({ approver: 'ben', reason: 'money_question', since: '2026-09-11T10:00:00Z' });
        expect(ps.approver).toBeNull();
        expect(ps.guards.figure.result).toBe(UNAVAILABLE);
    });

    it('a pending decision: nothing goes, no hold', () => {
        const { plannedSend: ps } = plannedSendFromDoorResponse(doorSend({ decision: { kind: 'pending', dueAt: '2026-09-11T10:00:00Z', reason: 'draft for Ben' } }));
        expect(ps.delivered).toBe(false);
        expect(ps.hold).toBeNull();
        expect(ps.evidence.decision).toBe('pending');
    });

    it('first contact: the mirrored rules-layer ack is the planned send when the desk decided none', () => {
        const raw = doorSend({ triage: { lane: 'rules', intent: 'ack_enquiry', stage: 'enquiry' }, pack: { id: 'rules.first_contact' }, proposal: null, guards: null, decision: { kind: 'none', reason: 'rules layer answers first contact' } });
        raw.mirrored = { kind: 'first_contact_ack', intent: 'ack_enquiry', body: 'Hi Sam, thanks for the message about the tap. Happy to give you a quick call?', messageId: 'msg_sbx_2', plan: { mode: 'freeform', channel: 'whatsapp', templateName: null, gate: { liveWouldSend: true } } } as any;
        const { plannedSend: ps } = plannedSendFromDoorResponse(raw);
        expect(ps.delivered).toBe(true);
        expect(ps.origin).toBe('rules_layer_mirror');
        expect(ps.bubbles).toHaveLength(1);
        expect(ps.templateId).toBeNull();
        expect(ps.approver).toBe('rules_layer');
        expect(ps.evidence.mirrorLiveWouldSend).toBe(true);
    });

    it('a mirrored ack is split into bubbles on the rules layer\'s --- line', () => {
        const raw = doorSend({ decision: { kind: 'none', reason: 'first contact' }, proposal: null, guards: null });
        raw.mirrored = { intent: 'ack_enquiry', body: 'Hi Sam, thanks for getting in touch.\n---\nIs it OK if we give you a quick call?', messageId: 'm', plan: { mode: 'freeform', channel: 'whatsapp', templateName: null } } as any;
        const { plannedSend: ps } = plannedSendFromDoorResponse(raw);
        expect(ps.bubbles).toEqual(['Hi Sam, thanks for getting in touch.', 'Is it OK if we give you a quick call?']);
        expect(splitAckBubbles('one')).toEqual(['one']);
    });

    it('a mirrored template ack names the template', () => {
        const raw = doorSend({ decision: { kind: 'none', reason: 'first contact' }, proposal: null, guards: null });
        raw.mirrored = { intent: 'ack_enquiry', body: 'Thanks for getting in touch about the tap', messageId: 'm', plan: { mode: 'template', channel: 'whatsapp', templateName: 'web_enquiry_ack_context' } } as any;
        const { plannedSend: ps } = plannedSendFromDoorResponse(raw);
        expect(ps.templateId).toBe('web_enquiry_ack_context');
    });

    it('a shut window with a desk send leaves the template unavailable rather than guessed', () => {
        const raw = doorSend();
        raw.state.window = { canFreeform: false, summary: 'SHUT' };
        const { plannedSend: ps } = plannedSendFromDoorResponse(raw);
        expect(ps.windowState).toBe('shut');
        expect(ps.templateId).toBe(UNAVAILABLE);
    });

    it('no pass and no mirror: nothing goes, run id unavailable', () => {
        const raw = doorSend();
        (raw as any).run = null;
        const { plannedSend: ps } = plannedSendFromDoorResponse(raw);
        expect(ps.delivered).toBe(false);
        expect(ps.runId).toBe(UNAVAILABLE);
        expect(ps.origin).toBe('none');
    });

    it('refuses a door response that is not a pass', () => {
        expect(() => plannedSendFromDoorResponse({ ok: true })).toThrow(/not a pass/);
    });

    it('is deterministic: the same response gives the same object', () => {
        const a = plannedSendFrom({ pass: plannedSendFromDoorResponse(doorSend()).pass, windowOpen: true });
        const b = plannedSendFrom({ pass: plannedSendFromDoorResponse(doorSend()).pass, windowOpen: true });
        expect(a).toEqual(b);
    });
});

describe('one planned send per customer turn (recorded door responses)', () => {
    it('every recorded customer turn yields exactly one planned send, whatever the decision', () => {
        const turns = [
            doorSend(),
            doorSend({ decision: { kind: 'flag', exception: 'money_question', dueAt: 'x' }, proposal: null }),
            doorSend({ decision: { kind: 'pending', dueAt: 'x', reason: 'wait' } }),
            doorSend({ decision: { kind: 'drop', reason: 'spam' }, proposal: null }),
        ];
        const sends = turns.map((t) => plannedSendFromDoorResponse(t).plannedSend);
        expect(sends).toHaveLength(turns.length);
        for (const s of sends) expect(plannedSendSchema.safeParse(s).success).toBe(true);
        expect(sends.map((s) => s.delivered)).toEqual([true, false, false, false]);
    });
});
