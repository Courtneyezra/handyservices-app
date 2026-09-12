/**
 * The desk with the Scheduling specialist on it, scripted models: the replacement of checklist
 * 2.6 (a date question during scoping is answered with the typical lead time from the diary when
 * one exists and "dates come with your quote" when it does not, never a guess), 5.4 (availability
 * after the quote points at the picker), 5.5 (changing a booked date goes to Ben and the reply
 * still answers the rest), and the date guard refusing a day the composer invented.
 */
import { describe, expect, it } from 'vitest';
import { Desk, type DeskDeps } from '../desk/desk';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from '../desk/fixed-lines';
import { Gateway } from '../desk/gateway';
import { FakeModelClient } from '../desk/models';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import type { InboundTurn } from '../desk/whatsapp-adapter';
import { MemoryDiary } from './diary';
import { linkFixture } from './scheduling-door';
import { MemoryFixture } from './fixture';

const NOW = Date.parse('2026-09-11T10:00:00.000Z');

function turn(text: string, at: string): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media: [], at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

const scoping = (over: Record<string, unknown> = {}) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry', ...over });
const scheduling = (over: Record<string, unknown> = {}) => ({ subjects: ['scheduling'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'question', ...over });

/** The scripted specialists: Scoping on the first call of a turn, Scheduling when the router sent the turn there. */
function specialists(schedulingAsks: string[], requestedChange: string | null = null) {
    return ({ system }: { system: string }) => system.includes('Scheduling specialist') ? { asks: schedulingAsks, requestedChange } : { facts: [{ key: 'job_type', value: 'leaking kitchen tap' }, { key: 'location', value: 'NG9 2AB' }], jobUnknowns: [], answeredSubjects: ['job', 'postcode'] };
}

function desk(handlers: ConstructorParameters<typeof FakeModelClient>[0], diary: MemoryDiary, extra: Partial<DeskDeps> = {}, mode: 'diary' | 'none' = 'diary') {
    const client = new FakeModelClient(handlers);
    const clock = { t: NOW };
    const now = () => new Date(clock.t += 1000);
    const d = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, scheduling: { diary, diaryMode: { completed: mode }, baseUrl: 'https://example.test' }, ...extra });
    return { client, gateway: new Gateway({ desk: d, now }), now };
}

async function seededDiary(completed: number, opts: { quote?: boolean; booked?: boolean } = {}) {
    const diary = new MemoryDiary();
    const fixture = new MemoryFixture(diary);
    const seeded = await fixture.seed({ completed, quote: !!opts.quote || !!opts.booked, booked: !!opts.booked }, new Date(NOW));
    return { diary, seeded };
}

describe('the desk with Scheduling (Goal 5)', () => {
    it('2.6 replaced: a date question during scoping is answered with the typical lead time read from the diary, cited, and the date guard passes', async () => {
        const { diary } = await seededDiary(6);
        let leadFactId = '';
        const { client, gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : scheduling({ subjects: ['scoping', 'scheduling'] }),
            specialist: specialists(['lead_time']),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, a leaking kitchen tap in NG9, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                expect(user).toContain('Notes from scheduling');
                expect(user).toMatch(/say exactly "about 3 days"/);
                leadFactId = /cite fact (fact_[\w-]+)/.exec(user)![1];
                return { reply: "We're usually booking in about 3 days, and Ben will confirm the day with your quote.", factIds: [leadFactId], kbIds: [] };
            },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const second = await gateway.inbound(turn('When can you come?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        const r = second.result;
        expect(r.decision).toBe('send');
        expect(r.delivered).toBe(true);
        expect(r.guards.date_time_duration.result).toBe('pass');
        expect(r.factIds).toEqual([leadFactId]);
        expect(r.bubbles.map((b) => b.text).join(' ')).toContain('about 3 days');
        expect(r.bubbles.map((b) => b.text).join(' ')).not.toContain(DEFAULT_FIXED_LINES.dates_with_quote);
        expect(r.summary).toMatch(/scheduling: Typical lead time from the diary/);
        expect(second.file.facts.find((f) => f.id === leadFactId)?.source).toMatchObject({ kind: 'diary' });
        expect(second.file.hold).toBeNull();
        expect(client.calls.filter((c) => c.role === 'specialist').map((c) => c.model)).toEqual(['claude-sonnet-5', 'claude-sonnet-5', 'claude-sonnet-5']);
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(2);
    });

    it('2.6 replaced: with no lead time in the diary the reply says dates come with your quote and scoping continues; a guessed lead time is refused', async () => {
        const { diary } = await seededDiary(0);
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : scheduling({ subjects: ['scoping', 'scheduling'] }),
            specialist: specialists(['lead_time']),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, a leaking kitchen tap in NG9, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                expect(user).toContain(DEFAULT_FIXED_LINES.dates_with_quote);
                if (n === 2) return { reply: 'Usually within a couple of weeks. Dates come with your quote.', factIds: [], kbIds: [] };
                expect(user).toContain('date_time_duration:');
                return { reply: 'Dates come with your quote, so the day gets picked then.', factIds: [], kbIds: [] };
            },
        }, diary);
        await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        const second = await gateway.inbound(turn('When can you come?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        const r = second.result;
        expect(r.composerCalls).toBe(2);
        expect(r.decision).toBe('send');
        expect(r.bubbles.map((b) => b.text).join(' ')).toContain('Dates come with your quote');
        expect(r.bubbles.map((b) => b.text).join(' ')).not.toMatch(/couple of weeks/);
        expect(r.summary).toMatch(/no typical lead time/);
        expect(second.file.facts.filter((f) => f.key === 'lead_time')).toHaveLength(0);
    });

    it('the fixture can empty the diary: the same fixed line even when completed bookings exist', async () => {
        const { diary } = await seededDiary(6);
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : scheduling(),
            specialist: specialists(['lead_time']),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                expect(user).toContain(DEFAULT_FIXED_LINES.dates_with_quote);
                expect(user).not.toMatch(/say exactly "about/);
                return { reply: 'Dates come with your quote.', factIds: [], kbIds: [] };
            },
        }, diary, {}, 'none');
        await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        const second = await gateway.inbound(turn('When can you come?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.bubbles[0].text).toBe('Dates come with your quote.');
    });

    it('5.4: after the quote an availability question points at the picker, with the lead time', async () => {
        const { diary, seeded } = await seededDiary(6, { quote: true });
        let ids: string[] = [];
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : scheduling({ proposedStage: 'quoted' }),
            specialist: specialists(['availability']),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                ids = Array.from(user.matchAll(/\(fact (fact_[\w-]+)\)|cite fact (fact_[\w-]+)/g)).map((m) => m[1] ?? m[2]);
                return { reply: `You pick the day on your quote page: https://example.test/quote/${seeded.quoteSlug}\n\nWe're usually booking in about 3 days.`, factIds: ids, kbIds: [] };
            },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.stage).toBe('ready');
        const linked = linkFixture(first.file, seeded);
        expect(linked).toEqual({ ok: true, stage: 'quoted' });
        const second = await gateway.inbound(turn('What dates do you have?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        const r = second.result;
        expect(r.decision).toBe('send');
        expect(r.guards.date_time_duration.result).toBe('pass');
        expect(r.guards.figure.result).toBe('pass');
        expect(r.bubbles.map((b) => b.text).join(' ')).toContain(`/quote/${seeded.quoteSlug}`);
        expect(second.file.facts.find((f) => f.key === 'picker_link')?.source).toMatchObject({ kind: 'quote_line', quoteRef: seeded.quoteRef });
        expect(second.file.stage).toBe('quoted');
        expect(second.file.hold).toBeNull();
        expect(second.file.ledger.find((l) => l.subject === 'access')?.askCount).toBe(1);
    });

    it('5.5: changing a booked date goes to Ben; the reply carries the fixed line, confirms what stands, answers the rest, and offers no new day', async () => {
        const { diary, seeded } = await seededDiary(6, { booked: true });
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : scheduling({ proposedStage: 'booked', exception: 'date_change' }),
            specialist: specialists(['date_change'], 'the week after'),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                expect(user).toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
                const date = /say exactly "([^"]+)" and cite fact (fact_[\w-]+)/.exec(user)!;
                return { reply: `No problem. Right now you're booked in for ${date[1]}.\n\nBen will come back to you on the date.\n\nAnd yes, bring the old tap out if you can.`, factIds: [date[2]], kbIds: [] };
            },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(linkFixture(first.file, seeded)).toEqual({ ok: true, stage: 'booked' });
        expect(first.file.job.bookingRef).toBe(seeded.bookingRef);
        const second = await gateway.inbound(turn('Can we move it to the week after? Also should I take the old tap out?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        const r = second.result;
        expect(r.decision).toBe('send');
        expect(r.delivered).toBe(true);
        expect(r.hold).toMatchObject({ approver: { kind: 'human', id: 'ben' }, exception: 'date_change' });
        expect(r.hold?.reason).toMatch(/^date_change: move it/);
        expect(r.guards.date_time_duration.result).toBe('pass');
        expect(r.bubbles.map((b) => b.text).join(' ')).toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
        expect(r.bubbles.map((b) => b.text).join(' ')).toContain('25 September 2026');
        expect(second.file.facts.find((f) => f.key === 'booked_date')?.source).toEqual({ kind: 'diary', rowId: `booking:${seeded.bookingRef}` });
        expect(second.file.facts.find((f) => f.key === 'date_change_requested')?.value).toBe('the week after');
        expect(second.file.stage).toBe('booked');
        expect(second.file.stageHistory.map((s) => s.to)).toEqual(['first_contact', 'scoping', 'ready', 'quoted', 'accepted', 'booked']);
        // The next turn still gets the desk, not a bare acknowledgement: a date change is not a fixed-line hold.
        const third = await gateway.inbound(turn('Thanks', '2026-09-11T10:10:00.000Z'));
        if (third.kind !== 'handled') throw new Error(third.kind);
        expect(third.result.decision).toBe('send');
    });

    it('5.5: the router\'s date_change exception holds for Ben even when the desk can see no booking, and the reply still answers the rest', async () => {
        const { diary } = await seededDiary(6);
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : scheduling({ exception: 'date_change' }),
            specialist: specialists(['date_change'], 'the week after'),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                expect(user).toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
                expect(user).not.toMatch(/about 3 days|usually booking|quote page/);
                expect(user).not.toContain(DEFAULT_FIXED_LINES.dates_with_quote);
                return { reply: 'Ben will come back to you on the date.\n\nAnd yes, bring the old tap out if you can.', factIds: [], kbIds: [] };
            },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.file.job.bookingRef).toBeNull();
        expect(first.file.stage).not.toBe('booked');
        const second = await gateway.inbound(turn('Can we move the appointment to the week after? Also should I take the old tap out?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        const r = second.result;
        expect(r.decision).toBe('send');
        expect(r.delivered).toBe(true);
        expect(r.hold).toMatchObject({ approver: { kind: 'human', id: 'ben' }, exception: 'date_change' });
        expect(r.hold?.reason).toMatch(/^date_change: move the appointment/);
        expect(r.guards.date_time_duration.result).toBe('pass');
        const said = r.bubbles.map((b) => b.text).join(' ');
        expect(said).toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
        expect(said).toContain('bring the old tap out');
        // The diary holds a lead time, and a job the customer is asking to move is not a job to quote a lead time about.
        expect(second.file.facts.filter((f) => f.key === 'lead_time' || f.key === 'picker_link')).toEqual([]);
        expect(r.summary).not.toMatch(/Typical lead time from the diary/);
    });

    it('a reply that fails the guards twice on a thread already held for Ben still puts the draft and the failures on his card', async () => {
        const { diary, seeded } = await seededDiary(6, { booked: true });
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : scheduling({ proposedStage: 'booked', exception: 'date_change' }),
            specialist: specialists(['date_change'], 'the week after'),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                const date = /say exactly "([^"]+)" and cite fact (fact_[\w-]+)/.exec(user)!;
                return { reply: `No problem. You're booked in for next Friday, ${date[1]}.`, factIds: [date[2]], kbIds: [] };
            },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        linkFixture(first.file, seeded);
        const second = await gateway.inbound(turn('Can we move it to the week after?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.decision).toBe('hold');
        expect(second.result.composerCalls).toBe(2);
        const hold = second.file.hold!;
        // The hold was raised before the composer ran, and what the desk nearly sent is added to it rather than lost.
        expect(hold.reason).toMatch(/^date_change: move it/);
        expect(hold.reason).toMatch(/guards failed twice/);
        expect(hold.draft).toContain('next Friday');
        expect(hold.failures.join(' ')).toMatch(/date, time or duration/);
        expect(second.result.bubbles.map((b) => b.text).join(' ')).toContain(DEFAULT_FIXED_LINES.held_ack);
    });

    it('a diary date from an earlier turn is not one this turn looked up: the guard refuses it and the thread holds', async () => {
        const { diary, seeded } = await seededDiary(6, { booked: true });
        let dateFact = '';
        const { client, gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : n === 2 ? scheduling({ proposedStage: 'booked' }) : scoping({ turnKind: 'question', subjects: ['service'], proposedStage: 'booked' }),
            specialist: specialists(['booked_date']),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                if (n === 2) {
                    const date = /say exactly "([^"]+)" and cite fact (fact_[\w-]+)/.exec(user)!;
                    dateFact = date[2];
                    return { reply: `You're booked in for ${date[1]}.`, factIds: [dateFact], kbIds: [] };
                }
                return { reply: 'Yes, Ben brings the parts with him. See you on 25 September 2026.', factIds: [dateFact], kbIds: [] };
            },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        linkFixture(first.file, seeded);
        const second = await gateway.inbound(turn('What day are you coming?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.bubbles[0].text).toContain('25 September 2026');
        // The third turn is nobody's date question, so Scheduling never runs and nothing reads the diary.
        const third = await gateway.inbound(turn('Does he bring the parts with him?', '2026-09-11T10:10:00.000Z'));
        if (third.kind !== 'handled') throw new Error(third.kind);
        expect(client.calls.filter((c) => c.role === 'specialist' && c.system.includes('Scheduling specialist'))).toHaveLength(1);
        expect(third.result.decision).toBe('hold');
        expect(third.result.note).toMatch(/guards failed twice/);
        expect(third.file.hold?.failures.join(' ')).toContain('did not look up');
        expect(third.result.bubbles.map((b) => b.text).join(' ')).toContain(DEFAULT_FIXED_LINES.held_ack);
        expect(third.result.bubbles.map((b) => b.text).join(' ')).not.toContain('25 September 2026');
        expect(third.file.hold?.draft).toContain('25 September 2026');
    });

    it('a booked date the composer paraphrased with a weekday fails the date guard once and is written again from the diary', async () => {
        const { diary, seeded } = await seededDiary(6, { booked: true });
        const { gateway } = desk({
            router: ({ n }) => n === 1 ? scoping() : scheduling({ proposedStage: 'booked' }),
            specialist: specialists(['booked_date']),
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
                const date = /say exactly "([^"]+)" and cite fact (fact_[\w-]+)/.exec(user)!;
                if (n === 2) return { reply: `You're booked in for next Friday, ${date[1]}.`, factIds: [date[2]], kbIds: [] };
                expect(user).toContain('date_time_duration:');
                return { reply: `You're booked in for ${date[1]}.`, factIds: [date[2]], kbIds: [] };
            },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        linkFixture(first.file, seeded);
        const second = await gateway.inbound(turn('What day are you coming?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.composerCalls).toBe(2);
        expect(second.result.decision).toBe('send');
        expect(second.result.bubbles[0].text).not.toMatch(/next Friday/);
        expect(second.result.bubbles[0].text).toContain('25 September 2026');
        expect(second.file.hold).toBeNull();
    });

    it('5.5: a date change the router missed still holds for Ben, through the belt at the gate', async () => {
        const { diary, seeded } = await seededDiary(6, { booked: true });
        const { gateway } = desk({
            router: () => scoping({ turnKind: 'question', subjects: ['service'] }),
            specialist: specialists([]),
            composer: ({ n }) => n === 1 ? { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] } : { reply: 'Ben will come back to you on the date.', factIds: [], kbIds: [] },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        linkFixture(first.file, seeded);
        const second = await gateway.inbound(turn('Could we push it back a week?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.hold).toMatchObject({ approver: { kind: 'human', id: 'ben' }, exception: 'date_change' });
        expect(second.result.bubbles.map((b) => b.text).join(' ')).toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
    });

    it('on a booked thread an ordinary question about the job is not a date change: no hold, and Ben is not told the date is moving', async () => {
        const { diary, seeded } = await seededDiary(6, { booked: true });
        const { client, gateway } = desk({
            router: () => scoping({ turnKind: 'question', subjects: ['service'] }),
            specialist: specialists([]),
            composer: ({ n }) => n === 1 ? { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] } : { reply: 'Yes, Ben brings the parts with him.', factIds: [], kbIds: [] },
        }, diary);
        const first = await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        linkFixture(first.file, seeded);
        const second = await gateway.inbound(turn('Could you bring it with you?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(client.calls.filter((c) => c.role === 'specialist' && c.system.includes('Scheduling specialist'))).toHaveLength(0);
        expect(second.result.hold).toBeNull();
        expect(second.result.bubbles.map((b) => b.text).join(' ')).not.toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
        expect(second.file.hold).toBeNull();
    });

    it('the date-change belt at the gate is silent on a thread with no quote and nothing booked, where it could never hold', async () => {
        const { diary } = await seededDiary(6);
        const { client, gateway } = desk({
            router: () => scoping(),
            specialist: specialists([]),
            composer: ({ n }) => n === 1 ? { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] } : { reply: 'Yes, Ben brings the parts with him.', factIds: [], kbIds: [] },
        }, diary);
        await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        const second = await gateway.inbound(turn('Could you bring it with you?', '2026-09-11T10:05:00.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(client.calls.filter((c) => c.role === 'specialist' && c.system.includes('Scheduling specialist'))).toHaveLength(0);
        expect(second.result.hold).toBeNull();
        expect(second.result.summary).not.toMatch(/scheduling/);
    });

    it('a date question the router missed still reaches Scheduling through the belt', async () => {
        const { diary } = await seededDiary(6);
        const { client, gateway } = desk({
            router: () => scoping(),
            specialist: specialists(['lead_time']),
            composer: ({ n }) => n === 1 ? { reply: 'Hi Sam, got it.\n\nWill someone be in?', factIds: [], kbIds: [] } : { reply: 'Dates come with your quote.', factIds: [], kbIds: [] },
        }, diary, {}, 'none');
        await gateway.inbound(turn('Hi, my kitchen tap is leaking, NG9 2AB', '2026-09-11T10:00:00.000Z'));
        await gateway.inbound(turn('When could you come out?', '2026-09-11T10:05:00.000Z'));
        expect(client.calls.filter((c) => c.role === 'specialist' && c.system.includes('Scheduling specialist'))).toHaveLength(1);
    });
});
