/**
 * What the desk says about what arrived and when, through the desk with a scripted model client. A
 * router that cannot read a turn holds for Ben and sends nothing, live as well as in dry run: the
 * held acknowledgement that named the photo or video ("leave it with me and I'll come back to you")
 * was removed by the captain's ruling of 18 Sep 2026. A video whose reply never went
 * (live, 15 Sep 2026: held for Ben at 20:07, the customer next wrote at 06:38) is thanked for as
 * late, after the reply to what the customer has just said. A video that came in a minute before
 * the text is still thanked for in the one covering reply, as PR #85 allowed.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, release, type CaseFile, type TurnMedia } from './case-file';
import { Desk, type DeskDeps } from './desk';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from './fixed-lines';
import { Gateway } from './gateway';
import { FakeModelClient } from './models';
import { emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import type { InboundTurn } from './whatsapp-adapter';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';

const routeScoping = (over: Record<string, unknown> = {}) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry', ...over });
const noFacts = () => ({ facts: [], jobUnknowns: [], answeredSubjects: [] });
const videoIn: InboundTurn['media'] = [{ id: 'video_1', kind: 'video', mime: 'video/mp4', path: '/tmp/tap.mp4', url: null }];
const photoIn: InboundTurn['media'] = [{ id: 'photo_1', kind: 'image', mime: 'image/jpeg', path: '/tmp/tap.jpg', url: null }];
const video: TurnMedia[] = [{ id: 'video_1', kind: 'video', mime: 'video/mp4', path: '/tmp/tap.mp4', url: null, description: null }];

function message(text: string, at: string, media: InboundTurn['media'] = []): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media, at, providerMessageId: null, via: 'door', mediaFailures: [] };
}

function desk(handlers: ConstructorParameters<typeof FakeModelClient>[0], start: string, extra: Partial<DeskDeps> = {}) {
    const clock = { t: Date.parse(start) };
    const client = new FakeModelClient(handlers);
    const now = () => new Date(clock.t += 1000);
    const store = new MemoryQuoteStore();
    const d = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store, drafter: new FakeDrafter(store), notifier: recordingNotifier }, ...extra });
    return { client, gateway: new Gateway({ desk: d, now }), clock };
}

/** A video on the file whose reply never went: the one-reply guard refused it, as on 15 Sep. */
function videoLeftUnanswered(file: CaseFile, at: string): void {
    const out = appendTurn(file, { at, channel: 'whatsapp', direction: 'inbound', partyId: file.parties[0].personId, kind: 'media', body: '', media: video, runId: null, approver: null });
    if (!out.ok) throw new Error(out.reason);
}

describe('a failed router call holds silently', () => {
    const routerDown = { router: () => ({ error: '400 Your credit balance is too low to access the Anthropic API.' }) };

    it('holds for Ben with the video the turn brought and sends nothing, live too: no promise to come back', async () => {
        let delivered: string[] | null = null;
        const deliverer = { async deliver(req: { bubbles: Array<{ text: string }> }) { delivered = req.bubbles.map((b) => b.text); return { ok: true as const, sid: null }; } };
        const { client, gateway } = desk(routerDown, '2026-09-16T04:41:07.000Z', { mode: 'live', sender: { deliverer: deliverer as any } });
        const out = await gateway.inbound(message("My toilet won't flush", '2026-09-16T04:41:07.000Z', videoIn));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.decision).toBe('hold');
        expect(out.result.delivered).toBe(false);
        expect(out.result.bubbles).toEqual([]);
        expect(delivered).toBeNull();
        expect(out.file.hold?.reason).toMatch(/^router_failed/);
        expect(out.file.sends).toEqual([]);
        expect(out.file.turns.filter((t) => t.direction === 'outbound')).toEqual([]);
        // No model saw the turn: the router was the only call.
        expect(client.calls.map((c) => c.role)).toEqual(['router']);
        // Nothing thanked for the video, so the thanks is still owed to a later reply.
        expect(out.file.ledger.find((l) => l.subject === 'media')?.thankedAt ?? null).toBeNull();
    });

    it('a second turn on the held file is silent too, and the card still stands', async () => {
        const { gateway } = desk(routerDown, '2026-09-16T04:41:07.000Z');
        const first = await gateway.inbound(message('here', '2026-09-16T04:41:07.000Z', photoIn));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const second = await gateway.inbound(message('Do you cover Nottingham?', '2026-09-16T04:45:07.000Z'));
        if (second.kind !== 'handled') throw new Error(second.kind);
        expect(second.result.decision).toBe('hold');
        expect(second.result.delivered).toBe(false);
        expect(second.result.bubbles).toEqual([]);
        expect(second.file.hold?.reason).toMatch(/^router_failed/);
        expect(second.file.turns.filter((t) => t.direction === 'outbound')).toEqual([]);
    });
});

describe('a thanks for media that is late', () => {
    it('reads as late and goes after the reply to the message that prompted the turn', async () => {
        const users: string[] = [];
        const { client, gateway, clock } = desk({
            router: () => routeScoping({ turnKind: 'answer' }),
            specialist: noFacts,
            composer: ({ user, n }) => {
                users.push(user);
                return n === 1
                    ? { reply: 'Hi Sam, a dripping kitchen tap, no problem.', factIds: [], kbIds: [] }
                    : { reply: "Yes, that's absolutely fine, no problem at all.\n\nWhat's the extra work you've got in mind?", factIds: [], kbIds: [] };
            },
        }, '2026-09-15T19:00:00.000Z');
        const first = await gateway.inbound(message('My kitchen tap drips. NG3 3EG', '2026-09-15T19:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const file = first.file;
        videoLeftUnanswered(file, '2026-09-15T19:06:09.000Z');

        clock.t = Date.parse('2026-09-16T04:38:49.000Z');
        const next = await gateway.inbound(message('I have more work, can I send a video?', '2026-09-16T04:38:49.000Z'));
        if (next.kind !== 'handled') throw new Error(next.kind);
        expect(next.result.decision).toBe('send');
        expect(next.result.guards.one_reply.result).toBe('pass');
        expect(next.result.bubbles.map((b) => b.text)).toEqual([
            "Yes, that's absolutely fine, no problem at all.",
            "What's the extra work you've got in mind?",
            "Thanks for the video you sent yesterday, sorry I'm only getting back to you on it now.",
        ]);
        // The composer was told to leave the video to that line and not to thank for it itself.
        expect(users[1]).toContain('thank for media: no');
        expect(users[1]).toContain('came in earlier and this reply is late for it');
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(2);
        expect(file.ledger.find((l) => l.subject === 'media')?.thankedAt).toBeTruthy();
    });

    it('adds no late thanks for a video a person has already replied to from the board', async () => {
        let user = '';
        const { gateway, clock } = desk({
            router: () => routeScoping({ turnKind: 'answer' }),
            specialist: noFacts,
            composer: (call) => {
                user = call.user;
                return call.n === 1
                    ? { reply: 'Hi Sam, a dripping kitchen tap, no problem.', factIds: [], kbIds: [] }
                    : { reply: "Yes, that's fine.", factIds: [], kbIds: [] };
            },
        }, '2026-09-15T19:00:00.000Z');
        const first = await gateway.inbound(message('My kitchen tap drips. NG3 3EG', '2026-09-15T19:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const file = first.file;
        videoLeftUnanswered(file, '2026-09-15T19:06:09.000Z');
        const reply = appendTurn(file, { at: '2026-09-15T19:30:00.000Z', channel: 'whatsapp', direction: 'outbound', partyId: file.parties[0].personId, kind: 'text', body: 'Thanks for the video, I can come Tuesday.', media: [], runId: 'run_ben', approver: 'human:ben@handyservices.app' });
        if (!reply.ok) throw new Error(reply.reason);

        clock.t = Date.parse('2026-09-16T04:38:49.000Z');
        const next = await gateway.inbound(message('I have more work, can I send a video?', '2026-09-16T04:38:49.000Z'));
        if (next.kind !== 'handled') throw new Error(next.kind);
        expect(user).not.toContain('came in earlier');
        expect(user).toContain('thank for media: no');
        expect(next.result.bubbles.map((b) => b.text)).toEqual(["Yes, that's fine."]);
    });

    /** A composer that thanks for the video whenever it is asked to, as the model did on 16 Sep. */
    const thanksWhenAsked = (users: string[]) => ({ user }: { user: string }) => {
        users.push(user);
        return user.includes('thank for media: yes')
            ? { reply: "Thanks for the video, that's really helpful.\n\nYes, that's fine.", factIds: [], kbIds: [] }
            : { reply: "Yes, that's fine.", factIds: [], kbIds: [] };
    };
    const ben = { kind: 'human' as const, id: 'ben' };

    it('does not thank for a video a complaint line already followed, once the hold is released and the customer writes the next day', async () => {
        const users: string[] = [];
        const { gateway, clock } = desk({
            router: ({ n }) => (n === 1 ? routeScoping({ exception: 'complaint', turnKind: 'other' }) : routeScoping({ turnKind: 'answer' })),
            specialist: noFacts,
            composer: thanksWhenAsked(users),
        }, '2026-09-15T19:00:00.000Z');
        const first = await gateway.inbound(message('The tap you fitted is leaking again, look. NG3 3EG', '2026-09-15T19:00:00.000Z', videoIn));
        if (first.kind !== 'handled') throw new Error(first.kind);
        expect(first.result.bubbles.map((b) => b.text).join('\n\n')).toBe(DEFAULT_FIXED_LINES.complaint);
        const file = first.file;
        expect(file.ledger.find((l) => l.subject === 'media')?.thankedAt ?? null).toBeNull();
        if (!release(file, ben, 'carry on').ok) throw new Error('release refused');

        clock.t = Date.parse('2026-09-16T04:38:49.000Z');
        const next = await gateway.inbound(message('Can you come this week?', '2026-09-16T04:38:49.000Z'));
        if (next.kind !== 'handled') throw new Error(next.kind);
        expect(users.at(-1)).toContain('thank for media: no');
        expect(next.result.bubbles.map((b) => b.text)).toEqual(["Yes, that's fine."]);
    });

    it('a composer failure holds silently, so an earlier video nothing followed is still thanked for, as late, once the hold is released', async () => {
        const users: string[] = [];
        const { gateway, clock } = desk({
            router: () => routeScoping({ turnKind: 'answer' }),
            specialist: noFacts,
            composer: (call) => {
                if (call.n === 1) return { reply: 'Hi Sam, a dripping kitchen tap, no problem.', factIds: [], kbIds: [] };
                if (call.n === 2) return { error: '529 overloaded' };
                return thanksWhenAsked(users)(call);
            },
        }, '2026-09-15T19:00:00.000Z');
        const first = await gateway.inbound(message('My kitchen tap drips. NG3 3EG', '2026-09-15T19:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        const file = first.file;
        videoLeftUnanswered(file, '2026-09-15T19:06:09.000Z');

        clock.t = Date.parse('2026-09-15T20:07:00.000Z');
        const held = await gateway.inbound(message('any update?', '2026-09-15T20:07:00.000Z'));
        if (held.kind !== 'handled') throw new Error(held.kind);
        expect(held.result.decision).toBe('hold');
        expect(held.result.delivered).toBe(false);
        expect(held.result.bubbles).toEqual([]);
        if (!release(file, ben, 'carry on').ok) throw new Error('release refused');

        clock.t = Date.parse('2026-09-16T04:38:49.000Z');
        const next = await gateway.inbound(message('Can you come this week?', '2026-09-16T04:38:49.000Z'));
        if (next.kind !== 'handled') throw new Error(next.kind);
        expect(users.at(-1)).toContain('thank for media: no');
        expect(next.result.bubbles.map((b) => b.text)).toEqual(["Yes, that's fine.", "Thanks for the video you sent yesterday, sorry I'm only getting back to you on it now."]);
    });

    it('sends the composer back once when it thanks for the late video itself', async () => {
        let retryUser = '';
        const { gateway, clock } = desk({
            router: () => routeScoping({ turnKind: 'answer' }),
            specialist: noFacts,
            composer: ({ user, n }) => {
                if (n === 1) return { reply: 'Hi Sam, a dripping kitchen tap, no problem.', factIds: [], kbIds: [] };
                if (n === 2) return { reply: "Thanks for the video, that's really helpful.\n\nYes, that's fine.", factIds: [], kbIds: [] };
                retryUser = user;
                return { reply: "Yes, that's fine.", factIds: [], kbIds: [] };
            },
        }, '2026-09-15T19:00:00.000Z');
        const first = await gateway.inbound(message('My kitchen tap drips. NG3 3EG', '2026-09-15T19:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        videoLeftUnanswered(first.file, '2026-09-15T19:06:09.000Z');

        clock.t = Date.parse('2026-09-16T04:38:49.000Z');
        const next = await gateway.inbound(message('can I send a video?', '2026-09-16T04:38:49.000Z'));
        if (next.kind !== 'handled') throw new Error(next.kind);
        expect(retryUser).toContain('do not thank for it yourself');
        expect(next.result.composerCalls).toBe(2);
        expect(next.result.bubbles.map((b) => b.text)).toEqual(["Yes, that's fine.", "Thanks for the video you sent yesterday, sorry I'm only getting back to you on it now."]);
    });

    it('leaves an on-time covering follow-up as it was: a video a minute before the text is thanked for in the one reply, with no late line', async () => {
        let user = '';
        const { gateway, clock } = desk({
            router: () => routeScoping({ turnKind: 'answer' }),
            specialist: noFacts,
            composer: (call) => {
                user = call.user;
                return call.n === 1
                    ? { reply: 'Hi Sam, a dripping kitchen tap, no problem.', factIds: [], kbIds: [] }
                    : { reply: "Thanks for the video, that's really helpful.\n\nYes, that's fine.", factIds: [], kbIds: [] };
            },
        }, '2026-09-15T19:00:00.000Z');
        const first = await gateway.inbound(message('My kitchen tap drips. NG3 3EG', '2026-09-15T19:00:00.000Z'));
        if (first.kind !== 'handled') throw new Error(first.kind);
        videoLeftUnanswered(first.file, '2026-09-15T19:06:09.000Z');

        clock.t = Date.parse('2026-09-15T19:07:09.000Z');
        const next = await gateway.inbound(message('that is the tap', '2026-09-15T19:07:09.000Z'));
        if (next.kind !== 'handled') throw new Error(next.kind);
        expect(user).toContain('thank for media: yes');
        expect(user).not.toContain('came in earlier');
        expect(next.result.guards.one_reply.result).toBe('pass');
        expect(next.result.bubbles.map((b) => b.text)).toEqual(["Thanks for the video, that's really helpful.", "Yes, that's fine."]);
    });
});
