/**
 * The two acknowledgements that say what arrived and when, through the desk with a scripted model
 * client. A router that cannot read a turn holds for Ben, and the held acknowledgement names the
 * photo or video the turn brought, live as well as in dry run. A video whose reply never went
 * (live, 15 Sep 2026: held for Ben at 20:07, the customer next wrote at 06:38) is thanked for as
 * late, after the reply to what the customer has just said. A video that came in a minute before
 * the text is still thanked for in the one covering reply, as PR #85 allowed.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, type CaseFile, type TurnMedia } from './case-file';
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

describe('the held acknowledgement after a failed router call', () => {
    const routerDown = { router: () => ({ error: '400 Your credit balance is too low to access the Anthropic API.' }) };

    it('names the video the turn brought, holds for Ben, and sends live because it is not a line Ben reviews', async () => {
        let delivered: string[] = [];
        const deliverer = { async deliver(req: { bubbles: Array<{ text: string }> }) { delivered = req.bubbles.map((b) => b.text); return { ok: true as const, sid: null }; } };
        const { client, gateway } = desk(routerDown, '2026-09-16T04:41:07.000Z', { mode: 'live', sender: { deliverer: deliverer as any } });
        const out = await gateway.inbound(message("My toilet won't flush", '2026-09-16T04:41:07.000Z', videoIn));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.decision).toBe('hold');
        expect(out.result.delivered).toBe(true);
        expect(out.result.bubbles.map((b) => b.text)).toEqual(["Thanks for the video, leave it with me and I'll come back to you."]);
        expect(delivered).toEqual(["Thanks for the video, leave it with me and I'll come back to you."]);
        expect(out.file.hold?.reason).toMatch(/^router_failed/);
        expect(out.file.sends[0].mode).toBe('live');
        // No model saw the turn: the router was the only call.
        expect(client.calls.map((c) => c.role)).toEqual(['router']);
        // The thanks went, so a later reply does not thank for the video again.
        expect(out.file.ledger.find((l) => l.subject === 'media')?.thankedAt).toBeTruthy();
    });

    it('names a photo', async () => {
        const { gateway } = desk(routerDown, '2026-09-16T04:41:07.000Z');
        const out = await gateway.inbound(message('here', '2026-09-16T04:41:07.000Z', photoIn));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.bubbles.map((b) => b.text)).toEqual(["Thanks for the photo, leave it with me and I'll come back to you."]);
    });

    it('falls back to the plain line for a turn with no media, and leaves the thanks owed', async () => {
        const { gateway } = desk(routerDown, '2026-09-16T04:41:07.000Z');
        const out = await gateway.inbound(message('Do you cover Nottingham?', '2026-09-16T04:41:07.000Z'));
        if (out.kind !== 'handled') throw new Error(out.kind);
        expect(out.result.bubbles.map((b) => b.text)).toEqual([DEFAULT_FIXED_LINES.held_ack]);
        expect(out.file.ledger.find((l) => l.subject === 'media')?.thankedAt ?? null).toBeNull();
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
