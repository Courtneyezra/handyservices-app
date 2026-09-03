/**
 * P15 part 2 vitest: the contractor's message to the customer. The send path with his first name
 * and the house voice, the money and date guards holding it for Ben, the five-a-day limit, the
 * reply notice back to his phone, and the rule that no contractor-facing payload ever carries her
 * number. No database: every dep is injected.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    RELAY_DAILY_LIMIT, RELAY_PRESETS, RELAY_TAG, presetBody, firstNameOf, composeRelayBody, checkRelayBody, rateLimited,
    contractorApprover, replyNoticeBody, relayView, relayToCustomer, notifyContractorOfReply,
    type RelayDeps, type NotifyReplyDeps, type RelayTarget,
} from './contractor-relay';
import { isApprover, isAutomatedApprover, isContractorApprover, approverLabel } from './approver';

const craig: RelayTarget = {
    bookingId: '2d21da09-6fc4-42b6-b036-ea013bb654c6',
    contractorId: 'hp_aa21264a',
    contractorName: 'Craig Smith',
    customerPhone: '+447811346936',
    customerName: 'Sarah Bell',
    conversationId: 'conv_mj',
};

function deps(over: Partial<RelayDeps> = {}): RelayDeps & { send: any; queueForBen: any; log: any; markRelayOpen: any } {
    const d = {
        countToday: vi.fn(async () => 0),
        send: vi.fn(async () => ({ ok: true })),
        queueForBen: vi.fn(async () => 'draft_1'),
        markRelayOpen: vi.fn(async () => undefined),
        log: vi.fn(async () => undefined),
        now: () => new Date('2026-09-05T09:00:00Z'),
        ...over,
    };
    return d as any;
}

describe('the presets are the three phone calls', () => {
    it('fixed wording, and the late one clamps the minutes rather than trusting the box', () => {
        expect(RELAY_PRESETS.map((p) => p.id)).toEqual(['arrived', 'running_late', 'access']);
        expect(presetBody('arrived')).toBe("I'm outside now.");
        expect(presetBody('access')).toBe('Which door should I use, and where is best to park?');
        expect(presetBody('running_late', 20)).toBe("I'm running about 20 minutes behind. On my way.");
        expect(presetBody('running_late', 2)).toContain('5 minutes');
        expect(presetBody('running_late', 9999)).toContain('120 minutes');
        expect(presetBody('running_late')).toContain('15 minutes');
        expect(presetBody('not_a_preset' as any)).toBeNull();
    });
});

describe('his words, as she reads them', () => {
    it('prefixes his first name and applies the house voice: the dash becomes a full stop', () => {
        expect(composeRelayBody('Craig Smith', "I'm outside — which door?")).toBe("Craig here, I'm outside. Which door?");
        expect(firstNameOf('Craig Smith')).toBe('Craig');
        expect(firstNameOf(null)).toBe('Your tradesperson');
    });
    it('does not introduce him twice when he has already said his name', () => {
        expect(composeRelayBody('Craig', 'Craig here, running a bit behind.')).toBe('Craig here, running a bit behind.');
    });
    it('an empty message composes to nothing', () => {
        expect(composeRelayBody('Craig', '   ')).toBe('');
    });
});

describe('what a contractor may not say', () => {
    it('money HOLDS: prices belong to the office', () => {
        const v = checkRelayBody("Craig here, i can do that extra bit for £40 cash.");
        expect(v.ok).toBe(false);
        if (!v.ok && v.hold) { expect(v.guard).toBe('money'); expect(v.reason).toMatch(/gone to Ben/); }
        else throw new Error('expected a money hold');
    });
    it('a date promise HOLDS: dates are booked by the office', () => {
        const v = checkRelayBody('Craig here, i will come back on Tuesday to finish it.');
        expect(v.ok).toBe(false);
        if (!v.ok && v.hold) expect(v.guard).toBe('date_promise');
        else throw new Error('expected a date hold');
    });
    it('an ordinary message passes; an empty or over-long one is his own mistake to fix', () => {
        expect(checkRelayBody("Craig here, i'm outside now.").ok).toBe(true);
        const empty = checkRelayBody('   ');
        expect(empty.ok).toBe(false);
        if (!empty.ok) { expect(empty.hold).toBe(false); expect(empty.guard).toBe('empty'); }
        const long = checkRelayBody('x'.repeat(481));
        expect(long.ok).toBe(false);
        if (!long.ok) { expect(long.hold).toBe(false); expect(long.guard).toBe('too_long'); }
    });
});

describe('relayToCustomer', () => {
    it('sends on the business number with a contractor approver and a run id, and marks the thread mid-relay', async () => {
        const d = deps();
        const out = await relayToCustomer(craig, "I'm outside, which door?", d);
        expect(out).toMatchObject({ ok: true, sent: true, remaining: RELAY_DAILY_LIMIT - 1 });
        const sent = d.send.mock.calls[0][0];
        expect(sent.to).toBe('+447811346936');
        expect(sent.body).toBe("Craig here, I'm outside, which door?");
        expect(sent.approver).toBe('contractor:hp_aa21264a');
        expect(sent.runId).toMatch(/^relay_/);
        expect(d.markRelayOpen).toHaveBeenCalledWith('conv_mj');
        expect(d.queueForBen).not.toHaveBeenCalled();
        expect(d.log.mock.calls[0][0]).toMatchObject({ kind: 'send', source: 'contractor-relay' });
    });

    it('a money message never reaches her: it is queued for Ben and he is told so', async () => {
        const d = deps();
        const out = await relayToCustomer(craig, 'that extra socket would be £40', d);
        expect(d.send).not.toHaveBeenCalled();
        expect(out).toMatchObject({ ok: true, sent: false, held: true, draftId: 'draft_1' });
        if (out.ok && !out.sent) expect(out.reason).toMatch(/gone to Ben/);
        const queued = d.queueForBen.mock.calls[0][0];
        expect(queued.phone).toBe('+447811346936');
        expect(queued.reason).toContain('[contractor_relay:2d21da09-6fc4-42b6-b036-ea013bb654c6]');
        expect(queued.reason).toContain('money guard');
        expect(d.log.mock.calls[0][0]).toMatchObject({ kind: 'hold' });
    });

    it('five a day, then the office: the sixth is refused before anything is composed', async () => {
        const d = deps({ countToday: vi.fn(async () => RELAY_DAILY_LIMIT) });
        const out = await relayToCustomer(craig, "I'm outside", d);
        expect(out).toMatchObject({ ok: false, status: 429 });
        if (!out.ok) expect(out.reason).toMatch(/ring/i);
        expect(d.send).not.toHaveBeenCalled();
        expect(d.queueForBen).not.toHaveBeenCalled();
        expect(rateLimited(4)).toBe(false);
        expect(rateLimited(5)).toBe(true);
    });

    it('a failed send is reported, not swallowed, and the thread is not marked mid-relay', async () => {
        const d = deps({ send: vi.fn(async () => ({ ok: false, error: 'WhatsApp and SMS both failed' })) });
        const out = await relayToCustomer(craig, "I'm outside", d);
        expect(out).toMatchObject({ ok: false, status: 502 });
        expect(d.markRelayOpen).not.toHaveBeenCalled();
    });

    it('an empty message is refused with words he can act on', async () => {
        const d = deps();
        const out = await relayToCustomer(craig, '   ', d);
        expect(out).toMatchObject({ ok: false, status: 400 });
        expect(d.send).not.toHaveBeenCalled();
    });
});

describe('her reply, back to his phone', () => {
    function notifyDeps(over: Partial<NotifyReplyDeps> = {}): NotifyReplyDeps & { send: any; log: any } {
        return {
            contractor: vi.fn(async () => ({ contractorId: 'hp_aa21264a', name: 'Craig', phone: '+447507255282', link: 'https://handyservices.app/my-week/tok', bookingId: 'b1' })),
            send: vi.fn(async () => ({ ok: true })),
            log: vi.fn(async () => undefined),
            ...over,
        } as any;
    }

    it('pushes her words and his own portal link, and never her number', async () => {
        const d = notifyDeps();
        const out = await notifyContractorOfReply('conv_mj', 'Side door, the blue one. Park on the drive', d);
        expect(out.sent).toBe(true);
        const sent = d.send.mock.calls[0][0];
        expect(sent.to).toBe('+447507255282');
        expect(sent.body).toBe('The customer replied: "Side door, the blue one. Park on the drive" https://handyservices.app/my-week/tok');
        expect(sent.body).not.toContain('447811346936');
    });

    it('a reply carrying a phone number or a price is dropped, not sanitised: he opens the app instead', async () => {
        const d = notifyDeps();
        const out = await notifyContractorOfReply('conv_mj', 'ring me on 07811 346936', d);
        expect(out.sent).toBe(false);
        expect(out.reason).toContain('phone number');
        expect(d.send).not.toHaveBeenCalled();
        expect(d.log.mock.calls[0][0]).toMatchObject({ kind: 'hold' });
    });

    it('no active job, or no number for him, is a quiet no-op', async () => {
        expect((await notifyContractorOfReply('conv_x', 'hello', notifyDeps({ contractor: vi.fn(async () => null) }))).sent).toBe(false);
        const noPhone = notifyDeps({ contractor: vi.fn(async () => ({ contractorId: 'c', name: 'Craig', phone: null, link: 'l', bookingId: 'b' })) });
        expect((await notifyContractorOfReply('conv_mj', 'hello', noPhone)).sent).toBe(false);
        expect(noPhone.send).not.toHaveBeenCalled();
    });

    it('long replies are trimmed to a notice, not a transcript', () => {
        const body = replyNoticeBody({ firstName: 'The customer', text: 'x'.repeat(400), link: 'L' });
        expect(body.length).toBeLessThan(220);
        expect(body).toContain('...');
    });
});

describe('the drawer view carries no customer identity', () => {
    it('orders by time, keeps the words, drops the empties, and exposes nothing but body and direction', () => {
        const rows = relayView([
            { id: 'm2', at: '2026-09-05T09:05:00Z', direction: 'inbound', body: 'Side door please' },
            { id: 'm1', at: '2026-09-05T09:00:00Z', direction: 'outbound', body: "Craig here, i'm outside. Which door?" },
            { id: 'm3', at: '2026-09-05T09:06:00Z', direction: 'outbound', body: '   ' },
        ]);
        expect(rows.map((r) => r.id)).toEqual(['m1', 'm2']);
        expect(rows[0]).toEqual({ id: 'm1', at: '2026-09-05T09:00:00.000Z', direction: 'out', body: "Craig here, i'm outside. Which door?" });
        expect(Object.keys(rows[1]).sort()).toEqual(['at', 'body', 'direction', 'id']);
    });
});

describe('the contractor approver', () => {
    it('is a valid approver the exit accepts, is not automated, and reads as a contractor', () => {
        const a = contractorApprover('hp_aa21264a');
        expect(a).toBe('contractor:hp_aa21264a');
        expect(isApprover(a)).toBe(true);
        expect(isAutomatedApprover(a)).toBe(false);
        expect(isContractorApprover(a)).toBe(true);
        expect(isContractorApprover('human:ben')).toBe(false);
        expect(approverLabel(a)).toBe('contractor hp_aa212');
        expect(isApprover('contractor:')).toBe(false);
    });
    it('the relay tag is the thread marker triage reads', () => {
        expect(RELAY_TAG).toBe('contractor_relay_open');
    });
});
