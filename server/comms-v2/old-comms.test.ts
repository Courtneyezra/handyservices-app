/**
 * The old comms page retiring for customers while the new desk is the live desk: its sends refuse a
 * customer thread and its links open the new board, a contractor thread keeps both, and with any
 * switch off, or a switch read that fails, every answer is exactly what it was before.
 *
 * Stubbed switches and a stubbed thread role: no database.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, pool: {} }));

import {
    CONTRACTOR_LANE_PATH, NEW_BOARD_PATH, conversationKeyOf, oldCommsRetired, oldCommsSendRefusal, staffThreadPath, staffThreadPathFrom,
} from './old-comms';

const liveNow = async () => ({ live: true, off: [] as string[] });
const notLive = async () => ({ live: false, off: ["spine.commsDesk = 'comms_v2'"] });
const unreadable = async (): Promise<{ live: boolean; off: string[] }> => { throw new Error('unreadable'); };
const customer = async () => 'customer';
const noThread = async () => null;
const contractor = async () => 'contractor';
const roleUnreadable = async (): Promise<string | null> => { throw new Error('db down'); };

describe('oldCommsRetired', () => {
    it('is yes only while the new desk is live; an unreadable switch is no', async () => {
        expect(await oldCommsRetired({ liveState: liveNow })).toBe(true);
        expect(await oldCommsRetired({ liveState: notLive })).toBe(false);
        expect(await oldCommsRetired({ liveState: unreadable })).toBe(false);
    });
});

describe('an old-page send', () => {
    it('goes to anyone while the new desk is not live, and the thread is never looked up', async () => {
        const roleOf = vi.fn(customer);
        expect(await oldCommsSendRefusal({ phone: '+447700900123' }, { liveState: notLive, roleOf })).toBeNull();
        expect(await oldCommsSendRefusal({ conversationId: 'c1' }, { liveState: unreadable, roleOf })).toBeNull();
        expect(roleOf).not.toHaveBeenCalled();
    });

    it('is refused for a customer thread, a thread with no row and a thread whose role cannot be read while live, naming the new board', async () => {
        for (const roleOf of [customer, noThread, roleUnreadable]) {
            expect(await oldCommsSendRefusal({ conversationId: 'c1' }, { liveState: liveNow, roleOf })).toContain(NEW_BOARD_PATH);
        }
    });

    it('still goes to a contractor thread while live', async () => {
        expect(await oldCommsSendRefusal({ phone: '07700 900123' }, { liveState: liveNow, roleOf: contractor })).toBeNull();
    });
});

describe('a staff link to a thread', () => {
    it('is the old link exactly as it was while the new desk is not live', async () => {
        expect(await staffThreadPath({ conversationId: 'c1' }, { liveState: notLive, roleOf: customer })).toBe('/admin/comms?conversation=c1');
        expect(await staffThreadPath({}, { liveState: notLive })).toBe('/admin/comms');
        expect(await staffThreadPath({ phone: '+447700900123' }, { liveState: unreadable, roleOf: contractor })).toBe('/admin/comms');
    });

    it('opens the new board for a customer thread, the comms page at large and an unreadable role while live', async () => {
        expect(await staffThreadPath({ conversationId: 'c1' }, { liveState: liveNow, roleOf: customer })).toBe(NEW_BOARD_PATH);
        expect(await staffThreadPath({}, { liveState: liveNow, roleOf: contractor })).toBe(NEW_BOARD_PATH);
        expect(await staffThreadPath({ conversationId: 'c1' }, { liveState: liveNow, roleOf: roleUnreadable })).toBe(NEW_BOARD_PATH);
    });

    it('keeps a contractor thread on the old page\'s contractor lane while live', async () => {
        expect(await staffThreadPath({ conversationId: 'c9' }, { liveState: liveNow, roleOf: contractor })).toBe('/admin/comms?conversation=c9');
        expect(await staffThreadPath({ phone: '+447700900123' }, { liveState: liveNow, roleOf: contractor })).toBe(CONTRACTOR_LANE_PATH);
    });

    it('is pure for a caller that already read the switch and the role', () => {
        expect(staffThreadPathFrom(false, { conversationId: 'c1', contractor: false })).toBe('/admin/comms?conversation=c1');
        expect(staffThreadPathFrom(true, { conversationId: 'c1', contractor: false })).toBe(NEW_BOARD_PATH);
        expect(staffThreadPathFrom(true, { conversationId: null, contractor: true })).toBe(CONTRACTOR_LANE_PATH);
    });
});

describe('conversationKeyOf', () => {
    it('reads every shape the old routes carry as the conversations key', () => {
        for (const shape of ['+447700900123', '07700 900123', '447700900123@c.us']) expect(conversationKeyOf(shape)).toBe('447700900123@c.us');
        expect(conversationKeyOf(null)).toBeNull();
        expect(conversationKeyOf('')).toBeNull();
    });
});
