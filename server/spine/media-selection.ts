/**
 * T11: which media items on a case file get a description on this pass.
 *
 * ONE rule, in one place, read by both sides: `buildCaseFile` (server/spine/case-file.ts) uses it
 * to choose what `describeMedia` is called on, and the sandbox report (server/spine/sandbox-routes.ts)
 * uses it to say, per item, why the Scoper saw a description or did not. If the two ever read
 * different rules the sandbox would teach the owner a fiction, so they cannot.
 *
 * The rule (Phase 4, unchanged here): an item is ELIGIBLE when it has a url and is a video, or an
 * image while `images` is on. Of the eligible items, the LAST `maxPerRun` (newest, in timeline
 * order) are described; an earlier one in a burst is silently dropped. Audio and documents are
 * never described.
 */
import type { MediaItem } from './types';

export interface MediaSelectionConfig {
    images: boolean;
    maxPerRun: number;
}

export function isDescribableKind(kind: MediaItem['kind'], images: boolean): boolean {
    return kind === 'video' || (images && kind === 'image');
}

/** The items `describeMedia` runs on, in order. Pure. */
export function selectMediaToDescribe<T extends Pick<MediaItem, 'kind' | 'url'>>(media: readonly T[], cfg: MediaSelectionConfig): T[] {
    return media
        .filter((m) => !!m.url && isDescribableKind(m.kind, cfg.images))
        .slice(-Math.max(1, cfg.maxPerRun));
}

export type MediaSelectionReason = 'selected' | 'over_bound' | 'images_off' | 'unsupported' | 'no_url';

/** Per item: selected, or the one reason it was not. Pure. */
export function explainMediaSelection<T extends Pick<MediaItem, 'id' | 'kind' | 'url'>>(media: readonly T[], cfg: MediaSelectionConfig): Map<string, MediaSelectionReason> {
    const chosen = new Set(selectMediaToDescribe(media, cfg).map((m) => m.id));
    const out = new Map<string, MediaSelectionReason>();
    for (const m of media) {
        if (chosen.has(m.id)) out.set(m.id, 'selected');
        else if (!m.url) out.set(m.id, 'no_url');
        else if (m.kind === 'image' && !cfg.images) out.set(m.id, 'images_off');
        else if (!isDescribableKind(m.kind, cfg.images)) out.set(m.id, 'unsupported');
        else out.set(m.id, 'over_bound');
    }
    return out;
}
