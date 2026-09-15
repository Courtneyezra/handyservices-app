/**
 * Checklist 5.1: the price screen's thread pane for a draft the new desk wrote reads the case file,
 * every channel's turns and their photos, and a draft the old desk wrote is told apart by its row.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, open, type CaseFile } from '../desk/case-file';
import { buildThread } from '../../spine/price-brief';
import { buildPricePayload, isCommsV2Draft } from '../../spine/price-screen';
import { priceScreenCaseFiles, quoteFileOn } from './ben-to-request';
import { threadMessagesOf } from './price-screen-thread';
import { SOURCE_CHANNEL } from './quote-store';

function file(): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'form', address: '+447700900942',
        firstTurn: { at: '2026-09-11T09:00:00.000Z', channel: 'form', kind: 'form', body: 'Kitchen tap leaking, NG9 2AB', media: [{ id: 'm_form', kind: 'image', mime: 'image/jpeg', path: '/tmp/f.jpg', url: '/api/media/v2_form.jpg', description: null }] },
    });
    if (!r.ok) throw new Error(r.reason);
    const f = r.value;
    const turn = (t: Parameters<typeof appendTurn>[1]) => { const out = appendTurn(f, t); if (!out.ok) throw new Error(out.reason); };
    turn({ at: '2026-09-11T09:05:00.000Z', channel: 'call', direction: 'inbound', partyId: 'p1', kind: 'call_transcript', body: 'Caller: it drips at the base', media: [], runId: null, approver: null });
    turn({ at: '2026-09-11T09:10:00.000Z', channel: 'sms', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'Could you send a photo of the tap?', media: [], runId: 'run_1', approver: 'agent:comms_v2' });
    turn({
        at: '2026-09-11T09:20:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'media', body: 'here it is', runId: null, approver: null,
        media: [
            { id: 'm1', kind: 'image', mime: 'image/jpeg', path: '/tmp/a.jpg', url: '/api/media/v2_a.jpg', description: null },
            { id: 'm2', kind: 'video', mime: 'video/mp4', path: '/tmp/b.mp4', url: '/api/media/v2_b.mp4', description: null },
            { id: 'm3', kind: 'image', mime: 'image/jpeg', path: '/tmp/c.jpg', url: null, description: null },
        ],
    });
    turn({ at: '2026-09-11T09:30:00.000Z', channel: 'email', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'Parking is on the drive', media: [], runId: null, approver: null });
    f.job.quoteRef = 'v2slug01';
    return f;
}

describe('threadMessagesOf', () => {
    it('puts every turn on the pane, whatever channel it came in on, with who wrote it', () => {
        const messages = threadMessagesOf(file());
        expect(messages.map((m) => [m.channel, m.direction, m.body, m.by])).toEqual([
            ['form', 'in', 'Kitchen tap leaking, NG9 2AB', 'Sam'],
            ['call', 'in', 'Caller: it drips at the base', 'Sam'],
            ['sms', 'out', 'Could you send a photo of the tap?', 'agent:comms_v2'],
            ['whatsapp', 'in', 'here it is', 'Sam'],
            ['whatsapp', 'in', '', 'Sam'],
            ['email', 'in', 'Parking is on the drive', 'Sam'],
        ]);
    });

    it('shows each served photo or video as a message of its own, under an id of its own, and leaves off one with no url', () => {
        const f = file();
        const messages = threadMessagesOf(f);
        const withMedia = messages.filter((m) => m.media);
        expect(withMedia.map((m) => m.media)).toEqual([
            { url: '/api/media/v2_form.jpg', kind: 'image' },
            { url: '/api/media/v2_a.jpg', kind: 'image' },
            { url: '/api/media/v2_b.mp4', kind: 'video' },
        ]);
        const photoTurn = f.turns[3];
        expect(messages.filter((m) => m.at === photoTurn.at).map((m) => m.id)).toEqual([photoTurn.id, `${photoTurn.id}:m2`]);
        expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length);
    });

    it('feeds the screen: the pane counts every message, and the photo pill reads the same thread', () => {
        const thread = buildThread(threadMessagesOf(file()));
        expect(thread.count).toBe(6);
        expect(thread.firstInboundAt).toBe('2026-09-11T09:00:00.000Z');
        const p = buildPricePayload({
            row: { id: 'q1', short_slug: 'v2slug01', customer_name: 'Sam', phone: '+447700900942', postcode: 'NG9 2AB', customer_type: 'homeowner', is_draft: true, revoked_at: null, superseded_at: null, pricing_line_items: [], pricing_suggestions: null, customer_photo_urls: null, customer_video_urls: null, source_channel: SOURCE_CHANNEL },
            estimate: null, conversationId: null, readiness: null, settings: { materialsMarginPercent: 27, depositPercent: 30 }, thread,
        });
        expect(p.thread.messages.map((m) => m.channel)).toEqual(['form', 'call', 'sms', 'whatsapp', 'whatsapp', 'email']);
        expect(p.customerMedia).toMatchObject({ sentPhotos: true, sentVideo: true });
    });
});

describe('which drafts read the case file', () => {
    it('is the row the new desk wrote, by its own source channel; an old-desk draft keeps the old tables', () => {
        expect(isCommsV2Draft({ source_channel: SOURCE_CHANNEL })).toBe(true);
        expect(isCommsV2Draft({ source_channel: 'spine_route_a' })).toBe(false);
        expect(isCommsV2Draft({ source_channel: null })).toBe(false);
    });

    it('finds the file carrying the quote, and none for another slug', () => {
        const f = file();
        expect(quoteFileOn([f], 'v2slug01')).toBe(f);
        expect(quoteFileOn([f], 'other')).toBeNull();
    });

    it('asks nothing it would have to build: with no live gateway and no board door open there are no files', async () => {
        expect(await priceScreenCaseFiles()).toEqual([]);
    });
});
