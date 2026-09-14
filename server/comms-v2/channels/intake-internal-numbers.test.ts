/**
 * The live intake's identity knows which numbers are ours: the business's own lines, the staff and
 * contractor numbers in the database, and the numbers placed in INTERNAL_PHONE_NUMBERS, all read
 * through server/internal-numbers.ts. Every number here is in an Ofcom drama range (07700 900xxx,
 * 0115 496 0xxx); the database is a scripted stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseFile, Turn } from '../desk/case-file';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import { Identity } from '../desk/identity';
import { ChannelGateway } from './channel-gateway';
import { forwardNow, resetLiveChannelGateway, seedInternalNumbers } from './intake';
import { classifyNonCustomerNumber, INTERNAL_NUMBERS_ENV } from '../../internal-numbers';

const rows = vi.hoisted(() => ({ users: [] as unknown[], profiles: [] as unknown[], links: [] as unknown[], fail: false }));

vi.mock('../../db', async () => {
    const schema = await import('@shared/schema');
    const from = (table: unknown) => ({
        where: async () => {
            if (rows.fail) throw new Error('database unreachable');
            return table === schema.users ? rows.users : table === schema.handymanProfiles ? rows.profiles : rows.links;
        },
    });
    return { db: { select: () => ({ from }), selectDistinct: () => ({ from }) } };
});

const turns: Turn[] = [];
const fakeDesk: DeskLike = {
    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> { turns.push(turn); return { runId: 'r', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 }; },
    async clockPass(file: CaseFile): Promise<DeskResult> { return this.handleTurn(file, file.turns[0]); },
};

async function seeded(): Promise<Identity> {
    const identity = new Identity();
    await seedInternalNumbers(identity);
    return identity;
}

function roleOf(identity: Identity, channel: 'whatsapp' | 'sms' | 'form', address: string) {
    const r = identity.resolve(channel, address);
    return r.ok ? { role: r.role, isNew: r.isNew } : r.reason;
}

describe('the live intake identity is seeded with the numbers that are ours', () => {
    beforeEach(() => {
        rows.users = []; rows.profiles = []; rows.links = []; rows.fail = false;
        vi.stubEnv('TWILIO_PHONE_NUMBER', '');
        vi.stubEnv('TWILIO_SMS_NUMBER', '');
        vi.stubEnv('TWILIO_WHATSAPP_NUMBER', '');
        vi.stubEnv(INTERNAL_NUMBERS_ENV, '');
    });
    afterEach(() => { vi.unstubAllEnvs(); resetLiveChannelGateway(); });

    it('resolves one of the business\'s own numbers as internal', async () => {
        vi.stubEnv('TWILIO_WHATSAPP_NUMBER', 'whatsapp:+447700900101');
        const identity = await seeded();
        expect(roleOf(identity, 'whatsapp', 'whatsapp:+447700900101')).toEqual({ role: 'internal', isNew: false });
    });

    it('resolves a staff number and a contractor number from the database as internal, a landline under either spelling', async () => {
        rows.users = [{ phone: '07700 900202', role: 'admin', first: 'Test', last: 'Staff' }];
        rows.profiles = [{ phone: '+447700900303', id: 'hp_1' }];
        rows.links = [{ phone: '0115 496 0404' }];
        const identity = await seeded();
        expect(roleOf(identity, 'sms', '+447700900202')).toEqual({ role: 'internal', isNew: false });
        expect(roleOf(identity, 'whatsapp', 'whatsapp:+447700900303')).toEqual({ role: 'internal', isNew: false });
        expect(roleOf(identity, 'sms', '+441154960404')).toEqual({ role: 'internal', isNew: false });
        expect(roleOf(identity, 'form', '01154960404')).toEqual({ role: 'internal', isNew: false });
    });

    it('resolves a number placed in INTERNAL_PHONE_NUMBERS as internal, in either written form, and the outbound check agrees', async () => {
        vi.stubEnv(INTERNAL_NUMBERS_ENV, '+447700900505, 07700900606');
        const identity = await seeded();
        expect(roleOf(identity, 'whatsapp', 'whatsapp:+447700900505')).toEqual({ role: 'internal', isNew: false });
        expect(roleOf(identity, 'sms', '+447700900606')).toEqual({ role: 'internal', isNew: false });
        expect(await classifyNonCustomerNumber('+447700900606')).toEqual({ code: 'INTERNAL_STAFF', detail: INTERNAL_NUMBERS_ENV });
    });

    it('resolves an international number placed in INTERNAL_PHONE_NUMBERS in +<country code> form as internal when a WhatsApp arrives from it, and the outbound check agrees', async () => {
        // +84 then 0 is never allocated: Vietnam's national numbers do not begin with the trunk 0.
        vi.stubEnv(INTERNAL_NUMBERS_ENV, '+84000000042');
        const identity = await seeded();
        expect(roleOf(identity, 'whatsapp', 'whatsapp:+84000000042')).toEqual({ role: 'internal', isNew: false });
        expect(roleOf(identity, 'whatsapp', '84000000042')).toEqual({ role: 'internal', isNew: false });
        expect(await classifyNonCustomerNumber('whatsapp:+84000000042')).toEqual({ code: 'INTERNAL_STAFF', detail: INTERNAL_NUMBERS_ENV });
        const gateway = new ChannelGateway({ desk: fakeDesk, identity });
        resetLiveChannelGateway(gateway);
        expect(await forwardNow({ kind: 'twilio_incoming', body: { From: 'whatsapp:+84000000042', Body: 'hi', NumMedia: '0' } })).toEqual({ forwarded: 0, skipped: ['an internal number is not a customer; nothing to scope'] });
        expect(gateway.store.all()).toEqual([]);
    });

    it('still resolves a number that is not ours as a new homeowner', async () => {
        vi.stubEnv('TWILIO_WHATSAPP_NUMBER', 'whatsapp:+447700900101');
        vi.stubEnv(INTERNAL_NUMBERS_ENV, '+447700900505');
        rows.users = [{ phone: '07700900202', role: 'admin', first: null, last: null }];
        const identity = await seeded();
        expect(roleOf(identity, 'whatsapp', 'whatsapp:+447700900999')).toEqual({ role: 'homeowner', isNew: true });
    });

    it('refuses to seed when the database cannot be read, so the build fails rather than starting on a partial list', async () => {
        rows.fail = true;
        await expect(seedInternalNumbers(new Identity())).rejects.toThrow(/database unreachable/);
    });

    it('counts a number a case file already holds as a customer as refused, rather than rewriting that person', async () => {
        vi.stubEnv(INTERNAL_NUMBERS_ENV, '+447700900505');
        const identity = new Identity();
        identity.resolve('sms', '+447700900505');
        expect((await seedInternalNumbers(identity)).refused).toBe(1);
        expect(roleOf(identity, 'sms', '+447700900505')).toEqual({ role: 'homeowner', isNew: false });
    });

    it('opens no case file for a message from a number that is ours, and opens one for a stranger', async () => {
        vi.stubEnv(INTERNAL_NUMBERS_ENV, '+447700900505');
        const gateway = new ChannelGateway({ desk: fakeDesk, identity: await seeded() });
        resetLiveChannelGateway(gateway);
        const before = turns.length;
        expect(await forwardNow({ kind: 'twilio_incoming', body: { From: '+447700900505', Body: 'on my way to the job' } })).toEqual({ forwarded: 0, skipped: ['an internal number is not a customer; nothing to scope'] });
        expect(gateway.store.all()).toEqual([]);
        expect(turns.length).toBe(before);
        expect(await forwardNow({ kind: 'twilio_incoming', body: { From: '+447700900999', Body: 'my gate has dropped' } })).toEqual({ forwarded: 1, skipped: [] });
        expect(gateway.store.all()).toHaveLength(1);
    });
});
