/**
 * Putting back the new desk's photos and videos that a deploy took (18 Sep 2026).
 *
 * What it repairs and what it does not: office threads (new-desk case-file media items) and quotes
 * (`personalized_quotes.customer_photo_urls` and `customer_video_urls`) are repaired. Contractor
 * briefs (`job_dispatches.media_urls` and the per-task media in `job_dispatches.tasks`) and the old
 * message records (`messages.media_url`) are NOT re-pointed: the plan and the apply both say so in
 * plain words, with how many rows of each still point at a lost url (`NotRepaired`), counted over the lost
 * items in scope and every url an item already put back records in `restored.from`. Follow-up:
 * re-point contractor briefs and the old message records in a separate change.
 *
 * The new desk wrote each inbound photo and video only to the container's local disk
 * (desk/whatsapp-adapter.ts `writeMedia`, channels/media.ts `writeInboundMedia`) and never mirrored
 * it to S3 the way the old desk does (server/media-store.ts). Production has no volume, so every
 * deploy took every file the new desk held: the case file kept `/api/media/v2_<uuid>.<ext>` and the
 * URL answers 404. The same Twilio webhook also reaches the old desk (server/whatsapp-api.ts), which
 * downloads the message's first attachment itself and mirrors it to `chat-media/<message sid>.<ext>`,
 * so for a WhatsApp photo or video the same bytes survive under the old desk's name.
 *
 * This puts them back by copying, and only by copying:
 *
 *   find     every media item on a case file whose `/api/media/v2_*` file is on neither the local
 *            disk nor under `chat-media/` in S3. Anything that still resolves is left alone.
 *   pair     each lost item with the old desk's row for the same inbound message (below).
 *   copy     the old desk's S3 object to a NEW key, `chat-media/<media id>-restored.<ext>`. Never
 *            over an existing object: a copy already there with the twin's size is used as it is,
 *            any other object at that name is a failure and nothing is written.
 *   re-link  the item's `url` and `path` to the new file, with `restored` recording what it
 *            replaced, and every quote row whose `customer_photo_urls` or `customer_video_urls`
 *            carries the lost url.
 *
 * Why a new URL, not the lost one put back: until 18 Sep the edge served /api/media 404s with
 * `max-age=31536000`, so a browser that already asked for a lost URL keeps its 404 for a year and
 * never asks again (the route's 404 now says `no-store`, which helps only browsers that have not
 * asked yet). An object restored at the old key would look repaired and show nothing there.
 *
 * Nothing is deleted, moved or overwritten: not the old desk's copy, not the lost key, not any object
 * at the new name. Running it again changes nothing already done: a re-linked item no longer counts
 * as lost, and the new name is fixed by the media id, so a second copy can never be made beside the
 * first.
 *
 * A turn that carries `providerMessageId` (every media turn since the 18 Sep fix) pairs exactly: its
 * twin is the old desk's row with that id, or it has none. The turns lost before then carry no id,
 * and for them pairing is a heuristic. Both desks stamp the message on receipt, the old desk its row's `created_at`
 * (conversation-engine.ts) and the new desk the turn's `at` (whatsapp-adapter.ts `fromTwilio`),
 * which put the two copies of one message 62 to 593 ms apart on 18 Sep. A burst of photos from one
 * customer arrives that close together too, so time alone could put photo A on photo B's item: the
 * wrong picture beside the wrong description, which is worse than a missing one. So an item pairs by
 * itself only when it is ISOLATED: exactly one old-desk row from the same customer (the WhatsApp
 * number on the turn's party), of the same kind, with the same text, `at` minus `created_at` inside
 * `PAIR_WINDOW_MS`, and no other photo or video of that kind from that customer on either desk
 * within `ISOLATION_MS`. Anything else is left for a person, with its candidates, and pairs only on a
 * choice that names one of its own candidates.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { CaseFile, TurnMedia } from './desk/case-file';
import type { CaseFileStore } from './desk/store';
import { DEFAULT_MEDIA_DIR } from './desk/whatsapp-adapter';

/** The S3 prefix the /api/media route restores from (server/media-store.ts). */
export const MEDIA_S3_PREFIX = 'chat-media/';
/** What a restored file's name carries after the media id, so a lost item and its new name are never confused. */
export const RESTORED_MARK = '-restored';
/** The new copy minus the old copy's receipt time: on 18 Sep every true pair fell between -62 and 593 ms. */
export const PAIR_WINDOW_MS = { from: -1_000, to: 2_000 } as const;
/** No other same-kind media from the same customer within this of an item, on either desk, or it waits for a person. */
export const ISOLATION_MS = 10_000;

export type MediaKind = TurnMedia['kind'];

/** One media item as the backfill reads it off a case file. */
export interface MediaRef {
    fileId: string;
    turnId: string;
    mediaId: string;
    kind: MediaKind;
    /** The turn's receipt time. */
    at: string;
    /** The turn's text, which the old desk kept on its row for the same message. */
    text: string;
    /** Digits of the WhatsApp numbers on the turn's party; empty when the turn's party has none. */
    customers: string[];
    /** The provider's message id the turn recorded, when it did: the exact key to the old desk's row. */
    providerMessageId: string | null;
    url: string | null;
    restored: boolean;
}

/** A lost item: its `/api/media/v2_*` file is on neither the disk nor S3. */
export interface LostMedia extends MediaRef {
    url: string;
    file: string;
}

/** The old desk's row for an inbound WhatsApp photo or video, with the file its URL names. */
export interface OldDeskCopy {
    messageId: string;
    kind: MediaKind;
    /** Receipt time, UTC. */
    at: string;
    text: string;
    /** Digits of the conversation's number. */
    customer: string;
    file: string;
}

export type Pairing =
    | { outcome: 'ready'; item: LostMedia; twin: OldDeskCopy; by: 'message_id' | 'isolated' | 'person' }
    | { outcome: 'needs_person'; item: LostMedia; candidates: OldDeskCopy[]; why: string }
    | { outcome: 'no_twin'; item: LostMedia; why: string };

export interface RefusedChoice { mediaId: string; reason: string }

const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');
const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
const ms = (iso: string) => Date.parse(iso);

/** The file an `/api/media/<file>` URL names, or null. */
export function mediaFileOf(url: string | null | undefined): string | null {
    const m = /^\/api\/media\/([^/?#]+)$/.exec(String(url ?? ''));
    return m ? m[1] : null;
}

/** A new-desk file that has not been put back: `v2_...` and not already a restored name. */
export function isNewDeskFile(file: string | null): file is string {
    return !!file && file.startsWith('v2_') && !file.includes(RESTORED_MARK);
}

/** The new file's name: fixed by the media id, with the old desk's extension, so running twice can never make two copies. */
export function restoredFileName(mediaId: string, twinFile: string): string {
    const ext = path.extname(twinFile);
    return `${mediaId}${RESTORED_MARK}${ext}`;
}

/** Every photo and video on these files, with the customer numbers of the party each turn is from. */
export function mediaRefsOf(files: readonly CaseFile[]): MediaRef[] {
    const out: MediaRef[] = [];
    for (const file of files) {
        for (const turn of file.turns) {
            if (!turn.media?.length) continue;
            const party = file.parties.find((p) => p.personId === turn.partyId);
            const customers = turn.direction === 'inbound' && turn.channel === 'whatsapp'
                ? Array.from(new Set((party?.channels ?? []).filter((c) => c.kind === 'whatsapp').map((c) => digits(c.address)).filter(Boolean)))
                : [];
            for (const m of turn.media) {
                out.push({ fileId: file.id, turnId: turn.id, mediaId: m.id, kind: m.kind, at: turn.at, text: turn.body ?? '', customers, providerMessageId: turn.providerMessageId ?? null, url: m.url, restored: !!m.restored });
            }
        }
    }
    return out;
}

/**
 * Pairs each lost item with the old desk's copy of the same message, by the isolated rule or by a
 * person's choice; see the header. `everyItem` is every media item on every file, lost or not, so a
 * sibling that still resolves still makes an item not isolated.
 */
export function pairLost(
    lost: readonly LostMedia[],
    everyItem: readonly MediaRef[],
    old: readonly OldDeskCopy[],
    choices: Readonly<Record<string, string>> = {},
): { pairings: Pairing[]; refusedChoices: RefusedChoice[] } {
    const pairings: Pairing[] = lost.map((item) => {
        if (!item.customers.length) return { outcome: 'no_twin', item, why: 'not an inbound WhatsApp turn, so the old desk kept no copy' };
        if (item.providerMessageId) {
            const twin = old.find((o) => o.messageId === item.providerMessageId && o.kind === item.kind && item.customers.includes(o.customer));
            return twin ? { outcome: 'ready', item, twin, by: 'message_id' } : { outcome: 'no_twin', item, why: 'the old desk has no row with this message id' };
        }
        const near = old.filter((o) => o.kind === item.kind && item.customers.includes(o.customer) && Math.abs(ms(item.at) - ms(o.at)) <= ISOLATION_MS);
        if (!near.length) return { outcome: 'no_twin', item, why: 'the old desk has no row for this message' };
        const inWindow = near.filter((o) => {
            const gap = ms(item.at) - ms(o.at);
            return gap >= PAIR_WINDOW_MS.from && gap <= PAIR_WINDOW_MS.to && sameText(o.text, item.text);
        });
        const siblings = everyItem.filter((x) => x.mediaId !== item.mediaId && x.kind === item.kind
            && x.customers.some((c) => item.customers.includes(c)) && Math.abs(ms(x.at) - ms(item.at)) <= ISOLATION_MS);
        if (near.length === 1 && inWindow.length === 1 && !siblings.length) return { outcome: 'ready', item, twin: inWindow[0], by: 'isolated' };
        const why = siblings.length ? `sent with ${siblings.length} other ${item.kind === 'video' ? 'video' : 'photo'}${siblings.length === 1 ? '' : 's'} within ${ISOLATION_MS / 1000} s`
            : near.length > 1 ? `${near.length} old-desk rows within ${ISOLATION_MS / 1000} s`
            : 'the only old-desk row is outside the pairing window or its text differs';
        return { outcome: 'needs_person', item, candidates: near, why };
    });

    const refusedChoices: RefusedChoice[] = [];
    for (const [mediaId, messageId] of Object.entries(choices)) {
        const i = pairings.findIndex((p) => p.item.mediaId === mediaId);
        const p = pairings[i];
        if (!p) { refusedChoices.push({ mediaId, reason: 'not a lost item in scope' }); continue; }
        if (p.outcome !== 'needs_person') { refusedChoices.push({ mediaId, reason: p.outcome === 'ready' ? 'already pairs without a person' : 'has no candidate to choose' }); continue; }
        const twin = p.candidates.find((o) => o.messageId === messageId);
        if (!twin) { refusedChoices.push({ mediaId, reason: 'the choice is not one of this item\'s candidates' }); continue; }
        pairings[i] = { outcome: 'ready', item: p.item, twin, by: 'person' };
    }

    // One old-desk copy is the twin of one item at most: two items on the same copy both go back to a person.
    const uses = new Map<string, number>();
    for (const p of pairings) if (p.outcome === 'ready') uses.set(p.twin.messageId, (uses.get(p.twin.messageId) ?? 0) + 1);
    for (let i = 0; i < pairings.length; i++) {
        const p = pairings[i];
        if (p.outcome !== 'ready' || (uses.get(p.twin.messageId) ?? 0) < 2) continue;
        if (p.by === 'person') refusedChoices.push({ mediaId: p.item.mediaId, reason: 'another item is paired with the same old-desk copy' });
        const candidates = old.filter((o) => o.kind === p.item.kind && p.item.customers.includes(o.customer) && Math.abs(ms(p.item.at) - ms(o.at)) <= ISOLATION_MS);
        pairings[i] = { outcome: 'needs_person', item: p.item, candidates, why: 'another item is paired with the same old-desk copy' };
    }
    return { pairings, refusedChoices };
}

/** What the backfill reads and writes outside the case file store. Nothing here deletes, moves or overwrites. */
export interface BackfillIo {
    /** Is this /api/media file still served: on the local disk, or under `chat-media/` in S3. */
    resolves(file: string): Promise<boolean>;
    /** The old desk's inbound WhatsApp photo and video rows from these customers, received between these instants. */
    oldDeskCopies(customers: string[], from: Date, to: Date): Promise<OldDeskCopy[]>;
    /** The object's size in bytes, or null when there is none. Reads metadata only, never the bytes. */
    objectSize(key: string): Promise<number | null>;
    /** A server-side copy inside the bucket; the bytes never pass through this process. */
    copyObject(fromKey: string, toKey: string): Promise<void>;
    /** Quote rows whose `customer_photo_urls` or `customer_video_urls` carry any of these urls. */
    quotesCarrying(urls: string[]): Promise<QuoteMediaRow[]>;
    /** Replaces both of the row's url lists, only if both are still as in `before`; false when the row changed since it was read. */
    replaceQuoteUrls(before: QuoteMediaRow, after: QuoteMediaRow): Promise<boolean>;
    /** How many rows this backfill never re-points still carry any of these urls; read only. */
    otherReferences(urls: string[]): Promise<Omit<NotRepaired, 'statement'>>;
}

/** A quote row's two customer media lists; null where the column holds no array. */
export interface QuoteMediaRow { id: string; photos: string[] | null; videos: string[] | null }

/** The places this backfill counts but never re-points, and the plain-words statement of that gap. */
export interface NotRepaired {
    /** `job_dispatches` rows whose `media_urls` carry a lost url. */
    dispatches: number;
    /** `job_dispatches` rows whose per-task media in `tasks` carry a lost url. */
    dispatchTasks: number;
    /** `messages` rows whose `media_url` is a lost url. */
    messages: number;
    statement: string;
}

export function notRepaired(counts: Omit<NotRepaired, 'statement'>): NotRepaired {
    const statement = 'Office threads and quotes are repaired. Contractor briefs and the old message records are NOT re-pointed: '
        + `${counts.dispatches} contractor brief row(s) (job_dispatches.media_urls) and ${counts.dispatchTasks} contractor brief row(s) with per-task media (job_dispatches.tasks) `
        + `and ${counts.messages} old message record(s) (messages.media_url) still point at a lost url. `
        + 'Follow-up: re-point contractor briefs and the old message records in a separate change.';
    return { ...counts, statement };
}

/**
 * Counted over every lost url the backfill knows of: `lostUrls` and the url each item already put back
 * recorded in `restored.from`, so a plan or run after a successful one still counts what points at it.
 */
async function notRepairedFor(io: BackfillIo, files: readonly CaseFile[], lostUrls: string[]): Promise<NotRepaired> {
    const restoredFrom = files.flatMap((f) => f.turns.flatMap((t) => (t.media ?? []).map((m) => m.restored?.from))).filter((u): u is string => !!u);
    const urls = Array.from(new Set([...lostUrls, ...restoredFrom]));
    return notRepaired(urls.length ? await io.otherReferences(urls) : { dispatches: 0, dispatchTasks: 0, messages: 0 });
}

export interface BackfillOptions {
    /** Only items received before this instant are in scope; later lost items are counted and left. */
    arrivedBefore?: string | null;
    /** A person's pairing for an item left for a person: media id to old-desk message id. */
    choices?: Record<string, string>;
    mediaDir?: string;
}

export interface BackfillPlan {
    /** Lost items in scope. The number `expect` must equal before anything is written. */
    lost: number;
    /** Lost items received at or after `arrivedBefore`, left alone. */
    outOfScope: number;
    /** New-desk items whose file still resolves. */
    alive: number;
    /** Items already put back by an earlier run. */
    alreadyRestored: number;
    pairings: Pairing[];
    refusedChoices: RefusedChoice[];
    /** Fixes the plan: an apply runs only on the plan it names. */
    digest: string;
    /** The size of each ready item's old-desk copy, by media id. */
    twinBytes: Record<string, number>;
    /** What this backfill will not re-point, counted over the lost urls in scope and those already put back. */
    notRepaired: NotRepaired;
}

/** Finds and pairs the lost items. Reads only: the store, the old desk's rows and S3 object metadata. */
export async function planBackfill(store: CaseFileStore, io: BackfillIo, opts: BackfillOptions = {}): Promise<BackfillPlan> {
    const everyItem = mediaRefsOf(store.all());
    const alreadyRestored = everyItem.filter((m) => m.restored).length;
    const lost: LostMedia[] = [];
    let alive = 0;
    for (const m of everyItem) {
        const file = mediaFileOf(m.url);
        if (m.restored || !isNewDeskFile(file)) continue;
        if (await io.resolves(file)) { alive++; continue; }
        lost.push({ ...m, url: m.url as string, file });
    }
    const cutoff = opts.arrivedBefore ? ms(opts.arrivedBefore) : null;
    if (cutoff !== null && Number.isNaN(cutoff)) throw new Error('arrivedBefore is not a date');
    const inScope = cutoff === null ? lost : lost.filter((m) => ms(m.at) < cutoff);

    const customers = Array.from(new Set(inScope.flatMap((m) => m.customers)));
    let old: OldDeskCopy[] = [];
    if (customers.length) {
        const times = inScope.map((m) => ms(m.at));
        old = await io.oldDeskCopies(customers, new Date(Math.min(...times) - 2 * ISOLATION_MS), new Date(Math.max(...times) + 2 * ISOLATION_MS));
    }
    const { pairings, refusedChoices } = pairLost(inScope, everyItem, old, opts.choices ?? {});

    // A pair is ready only while the old desk's copy is really in S3.
    const twinBytes: Record<string, number> = {};
    for (let i = 0; i < pairings.length; i++) {
        const p = pairings[i];
        if (p.outcome !== 'ready') continue;
        const size = await io.objectSize(MEDIA_S3_PREFIX + p.twin.file);
        if (size === null) pairings[i] = { outcome: 'no_twin', item: p.item, why: 'the old desk\'s copy is not in S3' };
        else twinBytes[p.item.mediaId] = size;
    }

    const summary = pairings.map((p) => [p.item.mediaId, p.outcome, p.outcome === 'ready' ? `${p.twin.messageId}:${p.by}` : '']).sort((a, b) => a[0].localeCompare(b[0]));
    const digest = createHash('sha256').update(JSON.stringify({ lost: inScope.length, summary })).digest('hex').slice(0, 16);
    const notRepairedNow = await notRepairedFor(io, store.all(), inScope.map((m) => m.url));
    return { lost: inScope.length, outOfScope: lost.length - inScope.length, alive, alreadyRestored, pairings, refusedChoices, digest, twinBytes, notRepaired: notRepairedNow };
}

export interface ApplyRequest extends BackfillOptions {
    /** The digest of the plan the person read. */
    digest: string;
    /** How many lost items the person expects in scope; any other number stops the run before it writes. */
    expect: number;
}

export interface ApplyResult {
    restored: number;
    /** Of those, how many found their copy already at the new name (an earlier run stopped after copying). */
    copiesReused: number;
    failed: Array<{ mediaId: string; reason: string }>;
    needsPerson: Array<{ mediaId: string; why: string }>;
    noTwin: Array<{ mediaId: string; why: string }>;
    alreadyRestored: number;
    outOfScope: number;
    quoteRowsUpdated: number;
    /** After the run: how many places still carry a lost url (items left for a person, or failed, carry theirs; dispatches and messages as in `notRepaired`). */
    stillPointingAtLost: { caseFileItems: number; quoteRows: number; dispatches: number; dispatchTasks: number; messages: number };
    /** What this backfill never re-points, counted after the run, with the plain-words statement. */
    notRepaired: NotRepaired;
}

export type ApplyOutcome = { ok: true; plan: BackfillPlan; result: ApplyResult } | { ok: false; status: number; error: string; plan: BackfillPlan };

/**
 * Plans again and, only when the plan is the one the person read (`digest`) and holds the number of
 * lost items they expect (`expect`), copies and re-links each ready pair. Stops before any write
 * otherwise.
 */
export async function applyBackfill(store: CaseFileStore, io: BackfillIo, req: ApplyRequest, now: () => Date = () => new Date()): Promise<ApplyOutcome> {
    const plan = await planBackfill(store, io, req);
    if (req.expect !== plan.lost) return { ok: false, status: 409, plan, error: `expected ${req.expect} lost items in scope, found ${plan.lost}: nothing was done` };
    if (req.digest !== plan.digest) return { ok: false, status: 409, plan, error: 'the plan has changed since it was read: plan again; nothing was done' };

    const mediaDir = req.mediaDir ?? DEFAULT_MEDIA_DIR;
    const result: ApplyResult = {
        restored: 0, copiesReused: 0, failed: [], needsPerson: [], noTwin: [], alreadyRestored: plan.alreadyRestored, outOfScope: plan.outOfScope, quoteRowsUpdated: 0,
        stillPointingAtLost: { caseFileItems: 0, quoteRows: 0, dispatches: 0, dispatchTasks: 0, messages: 0 },
        notRepaired: notRepaired({ dispatches: 0, dispatchTasks: 0, messages: 0 }),
    };
    const relinked = new Map<string, string>();
    const touched = new Set<string>();
    for (const p of plan.pairings) {
        if (p.outcome === 'needs_person') { result.needsPerson.push({ mediaId: p.item.mediaId, why: p.why }); continue; }
        if (p.outcome === 'no_twin') { result.noTwin.push({ mediaId: p.item.mediaId, why: p.why }); continue; }
        const { item, twin, by } = p;
        const fail = (reason: string) => { result.failed.push({ mediaId: item.mediaId, reason }); };
        try {
            const newFile = restoredFileName(item.mediaId, twin.file);
            const twinKey = MEDIA_S3_PREFIX + twin.file;
            const newKey = MEDIA_S3_PREFIX + newFile;
            const twinSize = await io.objectSize(twinKey);
            if (twinSize === null) { fail('the old desk\'s copy is not in S3'); continue; }
            const already = await io.objectSize(newKey);
            if (already === null) {
                await io.copyObject(twinKey, newKey);
                const copied = await io.objectSize(newKey);
                if (copied !== twinSize) { fail('the copy did not verify: its size differs from the old desk\'s copy (left in place, nothing deleted)'); continue; }
            } else if (already !== twinSize) {
                fail('a different object already sits at the new name; nothing was overwritten');
                continue;
            } else {
                result.copiesReused++;
            }
            const file = store.get(item.fileId);
            const media = file?.turns.find((t) => t.id === item.turnId)?.media.find((m) => m.id === item.mediaId);
            if (!file || !media || media.url !== item.url || media.restored) { fail('the item changed since the plan was made'); continue; }
            media.url = `/api/media/${newFile}`;
            media.path = path.join(mediaDir, newFile);
            media.stored = 'durable';
            media.restored = { from: item.url, at: now().toISOString(), by };
            store.put(file);
            touched.add(file.id);
            relinked.set(item.url, media.url);
            result.restored++;
        } catch (error: any) {
            fail(`${error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 200)}`);
        }
    }

    // A durable store writes in the background: wait for each touched file's write, so a restored count is a written one.
    for (const id of Array.from(touched)) {
        const flushFile = (store as { flushFile?: (id: string) => Promise<void> }).flushFile;
        if (!flushFile) continue;
        try { await flushFile.call(store, id); } catch (error: any) { result.failed.push({ mediaId: `(case file ${id})`, reason: `the case file write has not landed yet and will be retried: ${String(error?.message ?? error).slice(0, 200)}` }); }
    }

    if (relinked.size) {
        const relink = (urls: string[] | null) => urls && urls.map((u) => relinked.get(u) ?? u);
        for (const row of await io.quotesCarrying(Array.from(relinked.keys()))) {
            const after = { id: row.id, photos: relink(row.photos), videos: relink(row.videos) };
            if (await io.replaceQuoteUrls(row, after)) result.quoteRowsUpdated++;
            else result.failed.push({ mediaId: `(quote ${row.id})`, reason: 'the quote row changed while it was being updated; run again' });
        }
    }

    const lostUrls = plan.pairings.map((p) => p.item.url);
    const lostSet = new Set(lostUrls);
    result.stillPointingAtLost.caseFileItems = mediaRefsOf(store.all()).filter((m) => m.url && lostSet.has(m.url)).length;
    if (lostUrls.length) result.stillPointingAtLost.quoteRows = (await io.quotesCarrying(lostUrls)).length;
    result.notRepaired = await notRepairedFor(io, store.all(), lostUrls);
    result.stillPointingAtLost.dispatches = result.notRepaired.dispatches;
    result.stillPointingAtLost.dispatchTasks = result.notRepaired.dispatchTasks;
    result.stillPointingAtLost.messages = result.notRepaired.messages;
    return { ok: true, plan, result };
}
