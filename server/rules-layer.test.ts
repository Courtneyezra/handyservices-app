import { describe, it, expect } from 'vitest';
import {
    HOLDING_COPY, ASK_COPY, RULES_APPROVER, HOLDING_SUPPRESS_WINDOW_MS,
    suppressReason, isTestNumber, templateNameSlot,
} from './rules-layer';
import { chatVoiceViolations } from '@shared/chat-voice';
import { isApprover } from './approver';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const min = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe('rules-layer copy is content-free and in Handy voice', () => {
    const all = { ...HOLDING_COPY, ...ASK_COPY };
    it.each(Object.entries(all))('%s passes the chat-voice guard', (_k, body) => {
        expect(chatVoiceViolations(body)).toEqual([]);
    });
    it.each(Object.entries(all))('%s has no em dash, no price, no date, no "I", no person', (_k, body) => {
        expect(body).not.toMatch(/[—–]/);
        expect(body).not.toMatch(/£|\d+ ?(am|pm)\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\btomorrow\b|\btoday\b/i);
        expect(body).not.toMatch(/\bI\b|\bI'm\b|\bI'll\b|\bmy\b/);
        expect(body).not.toMatch(/\bBen\b/);
    });
    it.each(Object.entries(all))('%s keeps each burst short and asks at most one question', (_k, body) => {
        for (const burst of body.split(/\n\s*---\s*\n/)) {
            expect(burst.split(/\s+/).length).toBeLessThanOrEqual(25);
        }
        expect((body.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    });
    it('uses rules.* approvers that the exit gate accepts', () => {
        for (const a of Object.values(RULES_APPROVER)) {
            expect(a.startsWith('rules.')).toBe(true);
            expect(isApprover(a)).toBe(true);
        }
    });
});

describe('suppressReason', () => {
    const base = {
        triggeringInboundAt: min(15), lastOutboundAt: min(60), lastRulesSendAt: null,
        optedOut: false, testNumber: false, archived: false, now: NOW,
    };
    it('sends when the customer is genuinely waiting', () => {
        expect(suppressReason(base)).toBeNull();
        expect(suppressReason({ ...base, lastOutboundAt: null })).toBeNull();
    });
    it('never sends if ANY outbound landed after the triggering inbound', () => {
        expect(suppressReason({ ...base, lastOutboundAt: min(5) })).toBe('answered');
        // Same instant is not "after".
        expect(suppressReason({ ...base, lastOutboundAt: min(15) })).toBeNull();
    });
    it('never sends to an opt-out, a test number or an archived thread', () => {
        expect(suppressReason({ ...base, optedOut: true })).toBe('opted_out');
        expect(suppressReason({ ...base, testNumber: true })).toBe('test_number');
        expect(suppressReason({ ...base, archived: true })).toBe('archived');
    });
    it('one holding line per two hours', () => {
        expect(suppressReason({ ...base, lastRulesSendAt: min(119) })).toBe('recent_holding');
        expect(suppressReason({ ...base, lastRulesSendAt: new Date(NOW.getTime() - HOLDING_SUPPRESS_WINDOW_MS) })).toBeNull();
    });
    it('opt-out and answered outrank the holding window (order of reasons is stable)', () => {
        expect(suppressReason({ ...base, optedOut: true, lastOutboundAt: min(1), lastRulesSendAt: min(1) })).toBe('opted_out');
        expect(suppressReason({ ...base, lastOutboundAt: min(1), lastRulesSendAt: min(1) })).toBe('answered');
    });
});

describe('helpers', () => {
    it('isTestNumber matches the 07700 900xxx range in any format', () => {
        expect(isTestNumber('+447700900123')).toBe(true);
        expect(isTestNumber('447700900123@c.us')).toBe(true);
        expect(isTestNumber('+447950552830')).toBe(false);
    });
    it('templateNameSlot never greets a system-stamped label', () => {
        expect(templateNameSlot('Website Visitor')).toBe('there');
        expect(templateNameSlot('Unknown Caller')).toBe('there');
        expect(templateNameSlot(null)).toBe('there');
        expect(templateNameSlot('Sarah Jones')).toBe('Sarah');
    });
});
