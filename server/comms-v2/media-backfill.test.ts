/**
 * The media backfill (media-backfill.ts), on the conditions it was authorised under on 18 Sep 2026:
 * copy only, to new urls; nothing deleted, moved or overwritten; stop before writing when the number
 * of lost items is not the number expected; an item with more than one plausible twin is never
 * guessed; and a second run changes nothing and makes no second copy.
 */
import { describe, expect, it } from 'vitest';
import type { CaseFile } from './desk/case-file';
import { MemoryCaseFileStore } from './desk/store';
import { applyBackfill, ISOLATION_MS, MEDIA_S3_PREFIX, pairLost, planBackfill, restoredFileName, type BackfillIo, type LostMedia, type MediaRef, type OldDeskCopy, type QuoteMediaRow } from './media-backfill';

const T0 = Date.parse('2026-09-16T10:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const CUSTOMER_A = '+447700900001';
const CUSTOMER_B = '+447700900002';
const digitsOf = (n: string) => n.replace(/\D/g, '');

interface TurnSpec { id: string; atS: number; body?: string; media: Array<{ id: string; kind: 'image' | 'video'; url: string }>; channel?: 'whatsapp' | 'email' }

function caseFile(id: string, number: string, turns: TurnSpec[]): CaseFile {
    const personId = `person_${id}`;
    return {
        id,
        parties: [{ personId, channels: [{ kind: 'whatsapp', address: number, lastInboundAt: null }] }],
        turns: turns.map((t) => ({
            id: t.id, at: at(t.atS), channel: t.channel ?? 'whatsapp', direction: 'inbound', partyId: personId, kind: 'media', body: t.body ?? '',
            media: t.media.map((m) => ({ id: m.id, kind: m.kind, mime: m.kind === 'video' ? 'video/mp4' : 'image/jpeg', path: `/srv/media/${m.url.split('/').pop()}`, url: m.url, description: null })),
            runId: null, approver: null,
        })),
    } as unknown as CaseFile;
}

const oldCopy = (messageId: string, number: string, kind: 'image' | 'video', atS: number, text = ''): OldDeskCopy =>
    ({ messageId, kind, at: at(atS), text, customer: digitsOf(number), file: `${messageId}.${kind === 'video' ? 'mp4' : 'jpeg'}` });

/** S3, the disk, the old desk's rows and the quotes table, in memory. It has no delete, and a copy onto an existing key throws. */
class FakeIo implements BackfillIo {
    local = new Set<string>();
    objects = new Map<string, number>();
    old: OldDeskCopy[] = [];
    quotes = new Map<string, string[]>();
    quoteVideos = new Map<string, string[]>();
    dispatchMedia: string[][] = [];
    dispatchTaskMedia: string[][][] = [];
    messageMedia: string[] = [];
    copies: Array<[string, string]> = [];
    async resolves(file: string) { return this.local.has(file) || this.objects.has(MEDIA_S3_PREFIX + file); }
    async oldDeskCopies(customers: string[], from: Date, to: Date) {
        return this.old.filter((o) => customers.includes(o.customer) && Date.parse(o.at) >= from.getTime() && Date.parse(o.at) <= to.getTime());
    }
    async objectSize(key: string) { return this.objects.get(key) ?? null; }
    async copyObject(fromKey: string, toKey: string) {
        if (this.objects.has(toKey)) throw new Error('a copy onto an existing object');
        const size = this.objects.get(fromKey);
        if (size === undefined) throw new Error('no such source object');
        this.objects.set(toKey, size);
        this.copies.push([fromKey, toKey]);
    }
    async quotesCarrying(urls: string[]): Promise<QuoteMediaRow[]> {
        const ids = new Set([...this.quotes.keys(), ...this.quoteVideos.keys()]);
        const carries = (u: string[] | undefined) => !!u?.some((x) => urls.includes(x));
        return Array.from(ids).filter((id) => carries(this.quotes.get(id)) || carries(this.quoteVideos.get(id)))
            .map((id) => ({ id, photos: this.quotes.has(id) ? [...this.quotes.get(id)!] : null, videos: this.quoteVideos.has(id) ? [...this.quoteVideos.get(id)!] : null }));
    }
    async replaceQuoteUrls(before: QuoteMediaRow, after: QuoteMediaRow) {
        const same = (a: string[] | undefined, b: string[] | null) => JSON.stringify(a ?? null) === JSON.stringify(b);
        if (!same(this.quotes.get(before.id), before.photos) || !same(this.quoteVideos.get(before.id), before.videos)) return false;
        if (after.photos) this.quotes.set(before.id, [...after.photos]);
        if (after.videos) this.quoteVideos.set(before.id, [...after.videos]);
        return true;
    }
    async otherReferences(urls: string[]) {
        const hit = (u: string[]) => u.some((x) => urls.includes(x));
        return {
            dispatches: this.dispatchMedia.filter(hit).length,
            dispatchTasks: this.dispatchTaskMedia.filter((tasks) => tasks.some(hit)).length,
            messages: this.messageMedia.filter((u) => urls.includes(u)).length,
        };
    }
}

/**
 * Customer A sent one photo on its own (isolated) and, a minute later, a burst of two photos 400 ms
 * apart; customer B sent a video that still resolves. All three of A's lost; the old desk kept each.
 */
function scene() {
    const store = new MemoryCaseFileStore();
    store.put(caseFile('case_a', CUSTOMER_A, [
        { id: 't1', atS: 0.2, body: 'the tap', media: [{ id: 'v2_single', kind: 'image', url: '/api/media/v2_single.jpg' }] },
        { id: 't2', atS: 60.1, media: [{ id: 'v2_burst1', kind: 'image', url: '/api/media/v2_burst1.jpg' }] },
        { id: 't3', atS: 60.5, media: [{ id: 'v2_burst2', kind: 'image', url: '/api/media/v2_burst2.jpg' }] },
    ]));
    store.put(caseFile('case_b', CUSTOMER_B, [
        { id: 't4', atS: 0.3, media: [{ id: 'v2_alive', kind: 'video', url: '/api/media/v2_alive.mp4' }] },
    ]));
    const io = new FakeIo();
    io.old = [
        oldCopy('MMsingle', CUSTOMER_A, 'image', 0, 'the tap'),
        oldCopy('MMburst1', CUSTOMER_A, 'image', 60),
        oldCopy('MMburst2', CUSTOMER_A, 'image', 60.4),
        oldCopy('MMalive', CUSTOMER_B, 'video', 0.1),
    ];
    for (const o of io.old) io.objects.set(MEDIA_S3_PREFIX + o.file, 1000 + o.messageId.length);
    io.local.add('v2_alive.mp4');
    io.quotes.set('quote_a', ['/api/media/v2_single.jpg', '/api/media/v2_burst1.jpg']);
    return { store, io };
}

const mediaOf = (store: MemoryCaseFileStore, fileId: string, mediaId: string) =>
    store.get(fileId)!.turns.flatMap((t) => t.media).find((m) => m.id === mediaId)!;

describe('pairing a lost item with the old desk\'s copy', () => {
    const lostOf = (m: Partial<LostMedia> & { mediaId: string; atS: number; customer?: string }): LostMedia => ({
        fileId: 'f', turnId: 't', kind: 'image', text: '', url: `/api/media/${m.mediaId}.jpg`, file: `${m.mediaId}.jpg`, restored: false, providerMessageId: null,
        customers: [digitsOf(m.customer ?? CUSTOMER_A)], ...m, at: at(m.atS),
    });
    const refOf = (l: LostMedia): MediaRef => l;

    it('pairs an isolated item with the one copy from the same customer, of the same kind and text, inside the window', () => {
        const item = lostOf({ mediaId: 'v2_x', atS: 0.3, text: 'hi' });
        const { pairings } = pairLost([item], [refOf(item)], [oldCopy('MM1', CUSTOMER_A, 'image', 0, 'hi')]);
        expect(pairings[0]).toMatchObject({ outcome: 'ready', by: 'isolated', twin: { messageId: 'MM1' } });
    });

    it('never guesses inside a burst: two photos 400 ms apart both go to a person, each with both candidates', () => {
        const a = lostOf({ mediaId: 'v2_a', atS: 0.1 });
        const b = lostOf({ mediaId: 'v2_b', atS: 0.5 });
        const { pairings } = pairLost([a, b], [a, b], [oldCopy('MM1', CUSTOMER_A, 'image', 0), oldCopy('MM2', CUSTOMER_A, 'image', 0.4)]);
        expect(pairings.map((p) => p.outcome)).toEqual(['needs_person', 'needs_person']);
        for (const p of pairings) if (p.outcome === 'needs_person') expect(p.candidates.map((c) => c.messageId).sort()).toEqual(['MM1', 'MM2']);
    });

    it('never pairs across customers, however close in time', () => {
        const mine = lostOf({ mediaId: 'v2_mine', atS: 0.1 });
        const { pairings } = pairLost([mine], [mine], [oldCopy('MMother', CUSTOMER_B, 'image', 0)]);
        expect(pairings[0]).toMatchObject({ outcome: 'no_twin' });
    });

    it('does not pair on a copy whose text differs or that falls outside the window: a person decides', () => {
        const worded = lostOf({ mediaId: 'v2_w', atS: 0.1, text: 'the boiler' });
        expect(pairLost([worded], [worded], [oldCopy('MM1', CUSTOMER_A, 'image', 0, 'the tap')]).pairings[0]).toMatchObject({ outcome: 'needs_person' });
        const late = lostOf({ mediaId: 'v2_l', atS: 3 });
        expect(pairLost([late], [late], [oldCopy('MM1', CUSTOMER_A, 'image', 0)]).pairings[0]).toMatchObject({ outcome: 'needs_person' });
    });

    it('a sibling that still resolves still makes an item not isolated', () => {
        const item = lostOf({ mediaId: 'v2_x', atS: 0.1 });
        const alive: MediaRef = { ...item, mediaId: 'v2_alive_sibling', at: at(5) };
        expect(pairLost([item], [item, alive], [oldCopy('MM1', CUSTOMER_A, 'image', 0)]).pairings[0]).toMatchObject({ outcome: 'needs_person' });
        const far: MediaRef = { ...item, mediaId: 'v2_far', at: at(ISOLATION_MS / 1000 + 5) };
        expect(pairLost([item], [item, far], [oldCopy('MM1', CUSTOMER_A, 'image', 0)]).pairings[0]).toMatchObject({ outcome: 'ready' });
    });

    it('a turn that kept its provider message id pairs exactly on it, even inside a burst, and never by time', () => {
        const a = { ...lostOf({ mediaId: 'v2_a', atS: 0.1 }), providerMessageId: 'MM2' };
        const b = { ...lostOf({ mediaId: 'v2_b', atS: 0.5 }), providerMessageId: 'MM1' };
        const old = [oldCopy('MM1', CUSTOMER_A, 'image', 0), oldCopy('MM2', CUSTOMER_A, 'image', 0.4)];
        const { pairings } = pairLost([a, b], [a, b], old);
        expect(pairings.map((p) => p.outcome === 'ready' && `${p.twin.messageId}:${p.by}`)).toEqual(['MM2:message_id', 'MM1:message_id']);
        const unmatched = { ...lostOf({ mediaId: 'v2_c', atS: 0.1 }), providerMessageId: 'MMgone' };
        expect(pairLost([unmatched], [unmatched], old).pairings[0]).toMatchObject({ outcome: 'no_twin', why: expect.stringContaining('message id') });
    });

    it('a turn that is not inbound WhatsApp has no twin', () => {
        const item = { ...lostOf({ mediaId: 'v2_e', atS: 0 }), customers: [] };
        expect(pairLost([item], [item], [oldCopy('MM1', CUSTOMER_A, 'image', 0)]).pairings[0]).toMatchObject({ outcome: 'no_twin' });
    });

    it('a person\'s choice pairs only an item left for a person, only to one of its own candidates, and never two items to one copy', () => {
        const a = lostOf({ mediaId: 'v2_a', atS: 0.1 });
        const b = lostOf({ mediaId: 'v2_b', atS: 0.5 });
        const old = [oldCopy('MM1', CUSTOMER_A, 'image', 0), oldCopy('MM2', CUSTOMER_A, 'image', 0.4), oldCopy('MMother', CUSTOMER_B, 'image', 0.2)];
        const chosen = pairLost([a, b], [a, b], old, { v2_a: 'MM1', v2_b: 'MM2' });
        expect(chosen.pairings.map((p) => p.outcome === 'ready' && `${p.twin.messageId}:${p.by}`)).toEqual(['MM1:person', 'MM2:person']);
        const wrongCustomer = pairLost([a, b], [a, b], old, { v2_a: 'MMother' });
        expect(wrongCustomer.pairings[0].outcome).toBe('needs_person');
        expect(wrongCustomer.refusedChoices).toEqual([{ mediaId: 'v2_a', reason: expect.stringContaining('not one of this item') }]);
        const same = pairLost([a, b], [a, b], old, { v2_a: 'MM1', v2_b: 'MM1' });
        expect(same.pairings.map((p) => p.outcome)).toEqual(['needs_person', 'needs_person']);
        expect(same.refusedChoices.map((r) => r.mediaId).sort()).toEqual(['v2_a', 'v2_b']);
    });
});

describe('the backfill run', () => {
    it('plans without writing anything', async () => {
        const { store, io } = scene();
        const before = JSON.stringify(store.all());
        const objects = new Map(io.objects);
        const plan = await planBackfill(store, io);
        expect({ lost: plan.lost, alive: plan.alive, restored: plan.alreadyRestored }).toEqual({ lost: 3, alive: 1, restored: 0 });
        expect(plan.pairings.map((p) => `${p.item.mediaId}:${p.outcome}`)).toEqual(['v2_single:ready', 'v2_burst1:needs_person', 'v2_burst2:needs_person']);
        expect(JSON.stringify(store.all())).toBe(before);
        expect(io.objects).toEqual(objects);
        expect(io.copies).toEqual([]);
    });

    it('stops before writing when the lost count is not the one expected, or the plan changed', async () => {
        const { store, io } = scene();
        const plan = await planBackfill(store, io);
        const tooFew = await applyBackfill(store, io, { digest: plan.digest, expect: 2 });
        expect(tooFew).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('expected 2 lost items in scope, found 3') });
        const stale = await applyBackfill(store, io, { digest: 'not-the-plan', expect: 3 });
        expect(stale).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('plan has changed') });
        expect(io.copies).toEqual([]);
        expect(mediaOf(store, 'case_a', 'v2_single').url).toBe('/api/media/v2_single.jpg');
    });

    it('copies the old desk\'s copy to a new name, re-links the item and its quote under the new url, and deletes or overwrites nothing', async () => {
        const { store, io } = scene();
        const objectsBefore = new Map(io.objects);
        const plan = await planBackfill(store, io);
        const out = await applyBackfill(store, io, { digest: plan.digest, expect: plan.lost, mediaDir: '/srv/media' }, () => new Date('2026-09-18T14:00:00.000Z'));
        if (!out.ok) throw new Error(out.error);
        expect(out.result).toMatchObject({ restored: 1, copiesReused: 0, failed: [], quoteRowsUpdated: 1 });
        expect(out.result.needsPerson.map((n) => n.mediaId)).toEqual(['v2_burst1', 'v2_burst2']);

        const newFile = restoredFileName('v2_single', 'MMsingle.jpeg');
        expect(newFile).toBe('v2_single-restored.jpeg');
        expect(io.copies).toEqual([[`${MEDIA_S3_PREFIX}MMsingle.jpeg`, `${MEDIA_S3_PREFIX}${newFile}`]]);
        // Every object that was there is still there, the same size; the only change is the one new object.
        for (const [key, size] of objectsBefore) expect(io.objects.get(key)).toBe(size);
        expect(io.objects.size).toBe(objectsBefore.size + 1);
        expect(io.objects.get(`${MEDIA_S3_PREFIX}${newFile}`)).toBe(objectsBefore.get(`${MEDIA_S3_PREFIX}MMsingle.jpeg`));

        const media = mediaOf(store, 'case_a', 'v2_single');
        expect(media.url).toBe(`/api/media/${newFile}`);
        expect(media.url).not.toBe('/api/media/v2_single.jpg'); // the lost url's 404 is cached for a year: it is never reused
        expect(media.path).toBe(`/srv/media/${newFile}`);
        expect(media.stored).toBe('durable');
        expect(media.restored).toEqual({ from: '/api/media/v2_single.jpg', at: '2026-09-18T14:00:00.000Z', by: 'isolated' });
        expect(mediaOf(store, 'case_a', 'v2_burst1').url).toBe('/api/media/v2_burst1.jpg');
        expect(io.quotes.get('quote_a')).toEqual([`/api/media/${newFile}`, '/api/media/v2_burst1.jpg']);
        // What still points at a lost url is exactly what was left for a person.
        expect(out.result.stillPointingAtLost).toEqual({ caseFileItems: 2, quoteRows: 1, dispatches: 0, dispatchTasks: 0, messages: 0 });
    });

    it('re-links a quote\'s customer_video_urls exactly as its customer_photo_urls, and leaves a changed row alone', async () => {
        const { store, io } = scene();
        store.put(caseFile('case_v', CUSTOMER_B, [{ id: 't5', atS: 120.2, body: 'the leak', media: [{ id: 'v2_video', kind: 'video', url: '/api/media/v2_video.mp4' }] }]));
        io.old.push(oldCopy('MMvideo', CUSTOMER_B, 'video', 120, 'the leak'));
        io.objects.set(`${MEDIA_S3_PREFIX}MMvideo.mp4`, 4096);
        io.quoteVideos.set('quote_a', ['/api/media/v2_video.mp4', '/api/media/other.mp4']);
        io.quoteVideos.set('quote_v', ['/api/media/v2_video.mp4']);
        const plan = await planBackfill(store, io);
        const out = await applyBackfill(store, io, { digest: plan.digest, expect: plan.lost });
        if (!out.ok) throw new Error(out.error);
        expect(out.result).toMatchObject({ restored: 2, failed: [], quoteRowsUpdated: 2 });
        expect(io.quotes.get('quote_a')).toEqual(['/api/media/v2_single-restored.jpeg', '/api/media/v2_burst1.jpg']);
        expect(io.quoteVideos.get('quote_a')).toEqual(['/api/media/v2_video-restored.mp4', '/api/media/other.mp4']);
        expect(io.quoteVideos.get('quote_v')).toEqual(['/api/media/v2_video-restored.mp4']);
        expect(io.quotes.has('quote_v')).toBe(false);
        expect(out.result.stillPointingAtLost.quoteRows).toBe(1);

        const { store: s2, io: io2 } = scene();
        s2.put(caseFile('case_v', CUSTOMER_B, [{ id: 't5', atS: 120.2, body: 'the leak', media: [{ id: 'v2_video', kind: 'video', url: '/api/media/v2_video.mp4' }] }]));
        io2.old.push(oldCopy('MMvideo', CUSTOMER_B, 'video', 120, 'the leak'));
        io2.objects.set(`${MEDIA_S3_PREFIX}MMvideo.mp4`, 4096);
        io2.quoteVideos.set('quote_v', ['/api/media/v2_video.mp4']);
        const replace = io2.replaceQuoteUrls.bind(io2);
        io2.replaceQuoteUrls = async (before, after) => { io2.quoteVideos.set('quote_v', ['/api/media/v2_video.mp4', '/api/media/added.mp4']); return replace(before, after); };
        const plan2 = await planBackfill(s2, io2);
        const out2 = await applyBackfill(s2, io2, { digest: plan2.digest, expect: plan2.lost });
        expect(out2.ok && out2.result.failed).toContainEqual({ mediaId: '(quote quote_v)', reason: expect.stringContaining('changed') });
        expect(io2.quoteVideos.get('quote_v')).toEqual(['/api/media/v2_video.mp4', '/api/media/added.mp4']);
        expect(out2.ok && out2.result.stillPointingAtLost.quoteRows).toBe(2);
    });

    it('counts, never re-points, contractor briefs and old message records, and says so in the plan and the apply', async () => {
        const { store, io } = scene();
        io.dispatchMedia = [['/api/media/v2_single.jpg'], ['/api/media/unrelated.jpg']];
        io.dispatchTaskMedia = [[['/api/media/v2_burst1.jpg'], []], [['/api/media/v2_single.jpg']], [['/api/media/unrelated.jpg']]];
        io.messageMedia = ['/api/media/v2_burst2.jpg', '/api/media/unrelated.jpg'];
        const briefsBefore = JSON.stringify([io.dispatchMedia, io.dispatchTaskMedia, io.messageMedia]);

        const plan = await planBackfill(store, io);
        expect(plan.notRepaired).toMatchObject({ dispatches: 1, dispatchTasks: 2, messages: 1 });
        for (const words of ['Office threads and quotes are repaired', 'Contractor briefs and the old message records are NOT re-pointed',
            '1 contractor brief row(s) (job_dispatches.media_urls)', '2 contractor brief row(s) with per-task media (job_dispatches.tasks)',
            '1 old message record(s) (messages.media_url)', 'Follow-up: re-point contractor briefs and the old message records in a separate change']) {
            expect(plan.notRepaired.statement).toContain(words);
        }

        const out = await applyBackfill(store, io, { digest: plan.digest, expect: plan.lost });
        if (!out.ok) throw new Error(out.error);
        expect(out.result.restored).toBe(1);
        expect(out.result.notRepaired).toEqual(plan.notRepaired);
        expect(out.result.stillPointingAtLost).toMatchObject({ dispatches: 1, dispatchTasks: 2, messages: 1 });
        expect(JSON.stringify([io.dispatchMedia, io.dispatchTaskMedia, io.messageMedia])).toBe(briefsBefore);
    });

    it('after a run, a second plan and apply still count the contractor briefs and old message records that point at a restored item\'s lost url', async () => {
        const { store, io } = scene();
        io.dispatchMedia = [['/api/media/v2_single.jpg']];
        io.dispatchTaskMedia = [[['/api/media/v2_single.jpg']]];
        io.messageMedia = ['/api/media/v2_single.jpg'];
        const first = await planBackfill(store, io);
        const done = await applyBackfill(store, io, { digest: first.digest, expect: first.lost });
        if (!done.ok) throw new Error(done.error);
        expect(done.result.notRepaired).toMatchObject({ dispatches: 1, dispatchTasks: 1, messages: 1 });

        const second = await planBackfill(store, io);
        expect(second.pairings.map((p) => p.item.mediaId)).not.toContain('v2_single');
        expect(second.notRepaired).toMatchObject({ dispatches: 1, dispatchTasks: 1, messages: 1 });
        expect(second.notRepaired.statement).toContain('1 contractor brief row(s) (job_dispatches.media_urls)');
        const again = await applyBackfill(store, io, { digest: second.digest, expect: second.lost });
        if (!again.ok) throw new Error(again.error);
        expect(again.result.restored).toBe(0);
        expect(again.result.notRepaired).toMatchObject({ dispatches: 1, dispatchTasks: 1, messages: 1 });
        expect(again.result.stillPointingAtLost).toMatchObject({ dispatches: 1, dispatchTasks: 1, messages: 1 });
        expect(io.dispatchMedia).toEqual([['/api/media/v2_single.jpg']]);
        expect(io.messageMedia).toEqual(['/api/media/v2_single.jpg']);
    });

    it('run twice: the second run copies nothing, changes nothing and makes no duplicate', async () => {
        const { store, io } = scene();
        const first = await planBackfill(store, io);
        const done = await applyBackfill(store, io, { digest: first.digest, expect: first.lost });
        expect(done.ok && done.result.restored).toBe(1);
        const filesAfterFirst = JSON.stringify(store.all());
        const objectsAfterFirst = new Map(io.objects);
        const quotesAfterFirst = new Map(io.quotes);
        const copiesAfterFirst = io.copies.length;

        // The same request replayed is refused: the plan it named no longer exists.
        const replay = await applyBackfill(store, io, { digest: first.digest, expect: first.lost });
        expect(replay).toMatchObject({ ok: false, status: 409 });

        // A fresh plan and apply: only the items left for a person remain, and nothing is written.
        const second = await planBackfill(store, io);
        expect({ lost: second.lost, restored: second.alreadyRestored, ready: second.pairings.filter((p) => p.outcome === 'ready').length }).toEqual({ lost: 2, restored: 1, ready: 0 });
        const again = await applyBackfill(store, io, { digest: second.digest, expect: second.lost });
        if (!again.ok) throw new Error(again.error);
        expect(again.result).toMatchObject({ restored: 0, copiesReused: 0, failed: [], alreadyRestored: 1, quoteRowsUpdated: 0 });
        expect(io.copies.length).toBe(copiesAfterFirst);
        expect(io.objects).toEqual(objectsAfterFirst);
        expect(io.quotes).toEqual(quotesAfterFirst);
        expect(JSON.stringify(store.all())).toBe(filesAfterFirst);
    });

    it('an earlier run that copied but did not re-link is finished without a second copy', async () => {
        const { store, io } = scene();
        io.objects.set(`${MEDIA_S3_PREFIX}v2_single-restored.jpeg`, io.objects.get(`${MEDIA_S3_PREFIX}MMsingle.jpeg`)!);
        const plan = await planBackfill(store, io);
        const out = await applyBackfill(store, io, { digest: plan.digest, expect: plan.lost });
        expect(out.ok && out.result).toMatchObject({ restored: 1, copiesReused: 1 });
        expect(io.copies).toEqual([]);
    });

    it('never overwrites a different object that sits at the new name', async () => {
        const { store, io } = scene();
        io.objects.set(`${MEDIA_S3_PREFIX}v2_single-restored.jpeg`, 7);
        const plan = await planBackfill(store, io);
        const out = await applyBackfill(store, io, { digest: plan.digest, expect: plan.lost });
        expect(out.ok && out.result.failed).toEqual([{ mediaId: 'v2_single', reason: expect.stringContaining('nothing was overwritten') }]);
        expect(io.objects.get(`${MEDIA_S3_PREFIX}v2_single-restored.jpeg`)).toBe(7);
        expect(mediaOf(store, 'case_a', 'v2_single').url).toBe('/api/media/v2_single.jpg');
    });

    it('an item whose old-desk copy is not in S3 has no twin and is left as it is', async () => {
        const { store, io } = scene();
        io.objects.delete(`${MEDIA_S3_PREFIX}MMsingle.jpeg`);
        const plan = await planBackfill(store, io);
        expect(plan.pairings[0]).toMatchObject({ outcome: 'no_twin', why: expect.stringContaining('not in S3') });
    });

    it('a lost item past arrivedBefore is counted and left; one more lost item than expected stops the run', async () => {
        const { store, io } = scene();
        const scoped = await planBackfill(store, io, { arrivedBefore: at(30) });
        expect({ lost: scoped.lost, outOfScope: scoped.outOfScope }).toEqual({ lost: 1, outOfScope: 2 });
        const everything = await planBackfill(store, io);
        const out = await applyBackfill(store, io, { digest: scoped.digest, expect: scoped.lost });
        expect(out).toMatchObject({ ok: false, error: expect.stringContaining(`found ${everything.lost}`) });
        expect(io.copies).toEqual([]);
    });

    it('a person\'s choices put back a burst, each photo on the copy the person named', async () => {
        const { store, io } = scene();
        const choices = { v2_burst1: 'MMburst1', v2_burst2: 'MMburst2' };
        const plan = await planBackfill(store, io, { choices });
        const out = await applyBackfill(store, io, { digest: plan.digest, expect: plan.lost, choices });
        expect(out.ok && out.result).toMatchObject({ restored: 3, needsPerson: [], stillPointingAtLost: { caseFileItems: 0, quoteRows: 0 } });
        expect(mediaOf(store, 'case_a', 'v2_burst2').restored?.by).toBe('person');
        expect(io.copies.map(([from]) => from).sort()).toEqual([`${MEDIA_S3_PREFIX}MMburst1.jpeg`, `${MEDIA_S3_PREFIX}MMburst2.jpeg`, `${MEDIA_S3_PREFIX}MMsingle.jpeg`]);
    });
});
