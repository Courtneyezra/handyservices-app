/**
 * Ben's live notifications: the live intake's notifier sends a notice to his phone only while the
 * new desk is the live desk, under the old desk's event key for that kind, with the desk's own
 * words; with any switch off, or a switch read that fails, it records only and nothing reaches a
 * phone. Every notice is still a fact on the file, carrying what happened to the push.
 *
 * The Pushover call is a stub throughout: no test here can reach a phone.
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile } from '../desk/case-file';
import { acceptedNotice, chaseNotice, liveBenNotifier, readyToPriceNotice, recordingNotifier, type BenNoticeContext, type BenNotifier, type PushoverSink } from './ben-notifier';
import { notifyBen } from './quoting-tools';

const AT = '2026-09-14T12:00:00.000Z';
const ready = readyToPriceNotice({ customerName: 'Sam', postcode: 'NG9 2AB', slug: 'abc12345', lines: ['Replace kitchen tap'], checkThis: 0, suggestedTotalPence: 12000, estimatorFailed: null, missing: ['photo (asked once, none sent)'], at: AT, baseUrl: 'https://test.local' });
const chased = chaseNotice({ customerName: 'Sam', slug: 'abc12345', n: 1, waitingSince: '2026-09-14T07:00:00.000Z', at: AT, heardFromUs: true, baseUrl: 'https://test.local' });
const accepted = acceptedNotice({ customerName: 'Sam', phone: '+447700900942', jobSummary: 'Replace kitchen tap', depositPence: 3000, at: AT });
const ctx: BenNoticeContext = { caseId: 'case_1', slug: 'abc12345', customerName: 'Sam', phone: '+447700900942' };

function stub(result: { sent: number; skipped: string | null } | Error = { sent: 1, skipped: null }) {
    const calls: Array<Parameters<PushoverSink['send']>[0]> = [];
    const sink: PushoverSink = { async send(input) { calls.push(input); if (result instanceof Error) throw result; return result; } };
    return { calls, sink };
}

describe('the live notifier', () => {
    it('with any switch off sends nothing to a phone and records exactly as the sandbox does', async () => {
        const { calls, sink } = stub();
        const off = liveBenNotifier({ liveState: async () => ({ live: false, off: ["spine.commsDesk = 'comms_v2'"] }), pushover: sink });
        for (const n of [ready, chased, accepted]) expect(await off.notify(n, ctx)).toEqual(await recordingNotifier.notify(n, ctx));
        expect(calls).toEqual([]);
    });

    it('treats switches it cannot read as off', async () => {
        const { calls, sink } = stub();
        const unreadable = liveBenNotifier({ liveState: async () => { throw new Error('connection refused'); }, pushover: sink });
        expect((await unreadable.notify(ready, ctx)).note).toMatch(/^recorded, not sent/);
        expect(calls).toEqual([]);
    });

    it('while live sends each notice under the old desk\'s event key for its kind, in the desk\'s own words', async () => {
        const { calls, sink } = stub();
        const live = liveBenNotifier({ liveState: async () => ({ live: true, off: [] }), pushover: sink });
        const notes = [];
        for (const n of [ready, chased, accepted]) notes.push((await live.notify(n, ctx)).note);
        expect(calls.map((c) => c.event)).toEqual(['quote_prep_ready', 'chase', 'quote_accepted']);
        expect(calls[0]).toMatchObject({ title: ready.title, message: ready.message, linkUrl: 'https://test.local/admin/price/abc12345', linkPhone: null });
        expect(calls[0].message).toMatch(/Missing, yours to request: photo/);
        expect(calls[2]).toMatchObject({ title: 'Quote accepted', linkPhone: '+447700900942' });
        expect(notes).toEqual([ready, chased, accepted].map((n) => `sent to Ben's phone: ${n.title}`));
    });

    it('says so when Pushover skips or fails, and never throws', async () => {
        const skipped = liveBenNotifier({ liveState: async () => ({ live: true, off: [] }), pushover: stub({ sent: 0, skipped: 'no-token' }).sink });
        expect((await skipped.notify(ready, ctx)).note).toBe(`recorded, not sent (Pushover skipped: no-token): ${ready.title}`);
        const failing = liveBenNotifier({ liveState: async () => ({ live: true, off: [] }), pushover: stub(new Error('timeout')).sink });
        expect((await failing.notify(ready, ctx)).note).toBe(`recorded, not sent (Pushover failed: timeout): ${ready.title}`);
    });
});

describe('notifyBen', () => {
    function quotedFile(): CaseFile {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'whatsapp', address: '+447700900942',
            firstTurn: { at: AT, channel: 'whatsapp', kind: 'text', body: 'my kitchen tap is dripping, NG9 2AB', media: [] },
        });
        if (!r.ok) throw new Error(r.reason);
        r.value.job.quoteRef = 'abc12345';
        return r.value;
    }

    it('hands the notifier the file and quote, and records the notice as a fact carrying what the notifier did', async () => {
        const file = quotedFile();
        const seen: Array<BenNoticeContext | undefined> = [];
        const capturing: BenNotifier = { async notify(notice, c) { seen.push(c); return { note: `sent to Ben's phone: ${notice.title}` }; } };
        const out = await notifyBen(file, ready, { notifier: capturing });
        expect(out).toMatchObject({ ok: true, note: `sent to Ben's phone: ${ready.title}` });
        expect(seen).toEqual([{ caseId: file.id, slug: 'abc12345', customerName: 'Sam', phone: '+447700900942' }]);
        expect(file.facts.find((f) => f.id === (out as any).factId)?.value).toContain(`sent to Ben's phone: ${ready.title}`);
    });

    it('with the switches off the fact still lands, recorded and not sent, and nothing reaches a phone', async () => {
        const file = quotedFile();
        const { calls, sink } = stub();
        const out = await notifyBen(file, ready, { notifier: liveBenNotifier({ liveState: async () => ({ live: false, off: ['COMMS_V2_INTAKE=1'] }), pushover: sink }) });
        expect(out.ok).toBe(true);
        expect(file.facts.find((f) => f.id === (out as any).factId)?.value).toContain('recorded, not sent');
        expect(calls).toEqual([]);
    });
});
