/**
 * Live, 15 Sep 2026: a customer wrote "I can send a picture of the tap" and sent the video nine
 * seconds later, eight-second window, while the desk was still writing the reply to the text and a
 * minute clock tick came in between. The desk, its router, composer and eight guards, run for real
 * here with a scripted model client; the window and the gaps are scaled down. The text and the
 * video draw one reply each, both sent, nothing recovered as lost to a restart and nothing held;
 * answering the text a second time is still refused.
 */
import { describe, expect, it } from 'vitest';
import { messagesOf } from './case-file';
import { Desk } from './desk';
import { noFixedLineSource } from './fixed-lines';
import { Gateway } from './gateway';
import { FakeModelClient } from './models';
import { emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import type { InboundTurn } from './whatsapp-adapter';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const QUIET_MS = 80;
/** Nine seconds against an eight-second window, scaled. */
const MEDIA_AFTER_MS = (QUIET_MS * 9) / 8;

function message(text: string, media: InboundTurn['media'] = []): InboundTurn {
    return { channel: 'whatsapp', address: '+447700900942', name: 'Sam', text, media, at: new Date().toISOString(), providerMessageId: null, via: 'door', mediaFailures: [] };
}

describe('a customer who says a video is coming and sends it while the reply is being written', () => {
    it('gets the text answered and the video answered as an allowed follow-up across a clock tick: never a hold, never a recovery, never a third reply', async () => {
        const client = new FakeModelClient({
            router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'answer' }),
            specialist: () => ({ facts: [], jobUnknowns: [], answeredSubjects: [] }),
            // The first reply takes longer to write than the gap before the video.
            composer: async ({ n }) => {
                if (n === 1) await sleep(QUIET_MS * 3);
                return { reply: n === 1 ? 'Thanks Sam, that is all noted.' : 'Thanks Sam, I can see the tap now.', factIds: [], kbIds: [] };
            },
        });
        const quotes = new MemoryQuoteStore();
        const desk = new Desk({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: true, description: 'a dripping kitchen mixer tap', confidence: 'high', model: 'fake', usage: null, durationMs: 1 }) }, quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier } });
        const lines: string[] = [];
        const gateway = new Gateway({ desk, quietMs: QUIET_MS, log: (l) => lines.push(l) });

        const text = gateway.inbound(message('I can send a picture of the tap. NG3 3EG'));
        const file = gateway.store.all()[0];
        // The minute tick lands after the text's window has closed and before the video.
        await sleep(QUIET_MS + (MEDIA_AFTER_MS - QUIET_MS) / 2);
        const tick = gateway.clock(file.id);
        await sleep(MEDIA_AFTER_MS - (QUIET_MS + (MEDIA_AFTER_MS - QUIET_MS) / 2));
        const video = gateway.inbound(message('', [{ id: 'video_1', kind: 'video', mime: 'video/mp4', path: '/tmp/tap.mp4', url: null }]));
        const [textOut, , videoOut] = await Promise.all([text, tick, video]);
        if (textOut.kind !== 'handled' || videoOut.kind !== 'handled') throw new Error('not handled');

        expect(lines.filter((l) => /lost to a restart/.test(l))).toEqual([]);
        expect(file.hold).toBeNull();
        expect([textOut.result.decision, videoOut.result.decision]).toEqual(['send', 'send']);
        expect(videoOut.result.guards.one_reply.result).toBe('pass');
        const replies = file.turns.filter((t) => t.direction === 'outbound');
        expect(replies).toHaveLength(2);
        expect(replies.map((r) => r.answers)).toEqual([[textOut.turn.id], [videoOut.turn.id]]);
        expect(client.calls.filter((c) => c.role === 'composer')).toHaveLength(2);
        expect(file.waits).toBeUndefined();

        // A true double reply: the desk answering the text again is refused, and nothing more is sent.
        const again = await desk.handleTurn(file, textOut.turn);
        expect(messagesOf(textOut.turn)).toEqual([textOut.turn.id]);
        expect(again.delivered).toBe(false);
        expect(again.guards.one_reply.result).toBe('fail');
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(2);
    });
});
