/**
 * T17: a rules-layer holding line is a machine receipt, like a first-contact ack — it must not
 * stop the customer-waiting clock (server/inbox-board.ts loadActivity). Pure twin of the SQL
 * predicate; no database.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));

import {
    isMachineReceipt, insideAnyAutoAckSpan,
    AUTO_ACK_SOURCE, AUTO_ACK_APPROVER, AUTO_ACK_APPROVER_PREFIX, HOLDING_LINE_SOURCE, HOLDING_LINE_APPROVER,
} from './auto-ack-window';

describe('isMachineReceipt', () => {
    it('a first-contact ack sent by the machine (either approver spelling) is a receipt', () => {
        expect(isMachineReceipt({ source: AUTO_ACK_SOURCE, approvedBy: AUTO_ACK_APPROVER })).toBe(true);
        expect(isMachineReceipt({ source: AUTO_ACK_SOURCE, approvedBy: `${AUTO_ACK_APPROVER_PREFIX}whatsapp` })).toBe(true);
    });

    it('T17: a rules-layer holding line is a receipt too', () => {
        expect(HOLDING_LINE_SOURCE).toBe('rules_layer');
        expect(HOLDING_LINE_APPROVER).toBe('rules.holding');
        expect(isMachineReceipt({ source: 'rules_layer', approvedBy: 'rules.holding' })).toBe(true);
    });

    it('a rules-layer ASK is not: after a photo or postcode ask the ball is with the customer', () => {
        expect(isMachineReceipt({ source: 'rules_layer', approvedBy: 'rules.ask' })).toBe(false);
        expect(isMachineReceipt({ source: 'rules_layer', approvedBy: 'rules.job_pack' })).toBe(false);
    });

    it('a human approving either kind by hand IS a reply and stops the clock', () => {
        expect(isMachineReceipt({ source: 'rules_layer', approvedBy: 'human:ben@x' })).toBe(false);
        expect(isMachineReceipt({ source: AUTO_ACK_SOURCE, approvedBy: 'human:ben@x' })).toBe(false);
    });

    it('an agent draft, a quote send, a template send: never a receipt', () => {
        expect(isMachineReceipt({ source: 'spine', approvedBy: 'agent.scoper' })).toBe(false);
        expect(isMachineReceipt({ source: 'comms_agent', approvedBy: 'human:ben@x' })).toBe(false);
        expect(isMachineReceipt({ source: null, approvedBy: null })).toBe(false);
    });
});

describe('insideAnyAutoAckSpan', () => {
    it('the span check is unchanged: inside any [from, to] is a receipt window', () => {
        const spans = [{ from: new Date('2026-09-07T08:43:00Z'), to: new Date('2026-09-07T08:43:10Z') }];
        expect(insideAnyAutoAckSpan(new Date('2026-09-07T08:43:05Z'), spans)).toBe(true);
        expect(insideAnyAutoAckSpan(new Date('2026-09-07T09:00:00Z'), spans)).toBe(false);
    });
});
