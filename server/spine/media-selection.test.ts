/**
 * T11 vitest: the one selection rule both buildCaseFile and the sandbox report read.
 */
import { describe, it, expect } from 'vitest';
import { selectMediaToDescribe, explainMediaSelection, isDescribableKind } from './media-selection';
import type { MediaItem } from './types';

const item = (id: string, kind: MediaItem['kind'], url: string | null = `/api/media/${id}.jpg`): MediaItem => ({ id, kind, ...(url ? { url } : {}) });

describe('selectMediaToDescribe — the last maxPerRun eligible items', () => {
    it('takes the LAST N eligible items in timeline order, so an earlier photo in a burst is dropped', () => {
        const media = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => item(id, 'image'));
        expect(selectMediaToDescribe(media, { images: true, maxPerRun: 6 }).map((m) => m.id)).toEqual(['b', 'c', 'd', 'e', 'f', 'g']);
        expect(selectMediaToDescribe(media, { images: true, maxPerRun: 2 }).map((m) => m.id)).toEqual(['f', 'g']);
    });
    it('videos always; images only with images on; audio and documents never; no url never', () => {
        const media = [item('v', 'video'), item('i', 'image'), item('a', 'audio'), item('d', 'document'), item('n', 'image', null)];
        expect(selectMediaToDescribe(media, { images: true, maxPerRun: 6 }).map((m) => m.id)).toEqual(['v', 'i']);
        expect(selectMediaToDescribe(media, { images: false, maxPerRun: 6 }).map((m) => m.id)).toEqual(['v']);
    });
    it('a bound below 1 still describes one', () => {
        expect(selectMediaToDescribe([item('a', 'video'), item('b', 'video')], { images: true, maxPerRun: 0 }).map((m) => m.id)).toEqual(['b']);
    });
    it('isDescribableKind is the same predicate', () => {
        expect(isDescribableKind('video', false)).toBe(true);
        expect(isDescribableKind('image', false)).toBe(false);
        expect(isDescribableKind('image', true)).toBe(true);
        expect(isDescribableKind('audio', true)).toBe(false);
    });
});

describe('explainMediaSelection — one reason per item, agreeing with the selection', () => {
    it('names selected, over_bound, images_off, unsupported, no_url', () => {
        const media = [item('old', 'image'), item('a', 'audio'), item('n', 'video', null), item('v', 'video'), item('i', 'image')];
        const why = explainMediaSelection(media, { images: true, maxPerRun: 2 });
        expect(why.get('old')).toBe('over_bound');
        expect(why.get('a')).toBe('unsupported');
        expect(why.get('n')).toBe('no_url');
        expect(why.get('v')).toBe('selected');
        expect(why.get('i')).toBe('selected');
        const off = explainMediaSelection(media, { images: false, maxPerRun: 2 });
        expect(off.get('old')).toBe('images_off');
        expect(off.get('i')).toBe('images_off');
        expect(off.get('v')).toBe('selected');
    });
    it('every selected item is exactly the set selectMediaToDescribe returns', () => {
        const media = Array.from({ length: 10 }, (_, i) => item(`m${i}`, i % 3 === 0 ? 'video' : 'image'));
        for (const cfg of [{ images: true, maxPerRun: 6 }, { images: false, maxPerRun: 6 }, { images: true, maxPerRun: 1 }]) {
            const selected = [...explainMediaSelection(media, cfg).entries()].filter(([, r]) => r === 'selected').map(([id]) => id);
            expect(selected).toEqual(selectMediaToDescribe(media, cfg).map((m) => m.id));
        }
    });
});
