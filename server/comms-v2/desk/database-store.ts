/**
 * The durable case file store: every file, turn, media path and model call the desk records, kept
 * in the `comms_v2_case_files` table (migrations/20260913_comms_v2_case_files.sql) so a restart or a
 * redeploy of a server that runs for weeks loses no thread. The live intake builds its gateway on
 * it (channels/intake.ts); the sandbox door keeps the memory store.
 *
 * The store interface is synchronous (store.ts), and the gateway and the desk change a file in place
 * between puts, so this is a write-through store over the table:
 *
 *   open    reads every row once, before the gateway takes a turn, and holds the files in memory
 *   read    `get`, `findOpenFor` and `all` answer from those files, exactly as the memory store does
 *   put     takes the file at once and writes it whole, in the background, as it stands when the
 *           write starts; puts of one file coalesce, so the row always ends at its latest state
 *   clear   forgets every file and deletes every row, after any write already under way and before
 *           any put that follows it
 *
 * Writes run one at a time in the order they were asked for. A write that fails is logged and kept,
 * and that file waits for the retry (`retryMs`) so it cannot hold up another file's; `flush` retries
 * at once, waits for every pending write and rejects while any is still failing. Nothing here throws
 * out of `put`.
 *
 * Reading every row at open is the right size for one small business's threads: files number in
 * the thousands at most, and the rows carry `stage` and `person_ids` for any later SQL read. One
 * process holds the store for the table: the intake runs where the webhooks land.
 *
 * The identity directory is in memory too, and a person's id is minted fresh by it, so a store that
 * came back without it would have every returning customer resolve as a new person and open a
 * second file beside their open one. `identityFromCaseFiles` rebuilds it from the parties on the
 * loaded files.
 *
 * The live rows open nothing unless the database in use is the Neon branch COMMS_V2_DATABASE_URL
 * names (live-database.ts), the same refusal every live writer in the new desk makes, so a missing
 * or production value is refused before a connection is made. A memory rows source stands in for
 * tests. No log line carries a value from a file.
 */
import { newestOpenFor, type CaseFileStore } from './store';
import type { CaseFile } from './case-file';
import { Identity, canonical, type CanonicalKey, type IdentityOptions, type Person } from './identity';
import { commsV2Db } from '../live-database';

/** The table under the store: every row read, one file written whole, every row deleted. */
export interface CaseFileRows {
    loadAll(): Promise<CaseFile[]>;
    upsert(file: CaseFile): Promise<void>;
    deleteAll(): Promise<void>;
}

export interface DatabaseStoreOptions {
    log?: (line: string) => void;
    /** How long a failed write waits before it is tried again. */
    retryMs?: number;
}

export const DEFAULT_RETRY_MS = 5_000;

const NUL = String.fromCharCode(0);

/**
 * The file as a row holds it: a deep copy taken now, with any NUL character dropped from its strings
 * (Postgres refuses one in jsonb, and one customer's stray byte must not leave the file unwritable).
 */
export function recordOf(file: CaseFile): CaseFile {
    return JSON.parse(JSON.stringify(file, (_key, value) => (typeof value === 'string' && value.includes(NUL) ? value.split(NUL).join('') : value))) as CaseFile;
}

export class DatabaseCaseFileStore implements CaseFileStore {
    private readonly files = new Map<string, CaseFile>();
    private readonly dirty = new Set<string>();
    /** Files whose last write failed, waiting for the retry. */
    private readonly waiting = new Set<string>();
    /** Clears asked for and not yet written; while one is outstanding no file is written, so a put after a clear never lands before it. */
    private clears = 0;
    private clearWaiting = false;
    private writing: Promise<void> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private lastError: Error | null = null;
    private readonly log: (line: string) => void;
    private readonly retryMs: number;

    constructor(private readonly rows: CaseFileRows, opts: DatabaseStoreOptions = {}) {
        this.log = opts.log ?? (() => undefined);
        this.retryMs = opts.retryMs ?? DEFAULT_RETRY_MS;
    }

    /** Read every row into the store. Call once, before the store is used. */
    async load(): Promise<this> {
        const files = await this.rows.loadAll();
        for (const file of files) this.files.set(file.id, file);
        this.log(`case file store: ${files.length} file(s) loaded`);
        return this;
    }

    get(id: string): CaseFile | null { return this.files.get(id) ?? null; }
    findOpenFor(personId: string): CaseFile | null { return newestOpenFor(this.files.values(), personId); }
    all(): CaseFile[] { return Array.from(this.files.values()); }

    put(file: CaseFile): void {
        this.files.set(file.id, file);
        this.dirty.add(file.id);
        this.schedule();
    }

    clear(): void {
        this.files.clear();
        this.dirty.clear();
        this.waiting.clear();
        this.clears++;
        this.schedule();
    }

    /** Writes not yet landed: files waiting to be written, and a clear waiting to be. */
    pending(): number { return this.dirty.size + (this.clears > 0 ? 1 : 0); }

    /** Retry now and wait for every pending write. Rejects with the last failure while anything is still unwritten. */
    async flush(): Promise<void> {
        this.retryNow();
        while (this.writing) await this.writing;
        if (this.pending() && this.lastError) throw this.lastError;
    }

    private retryNow(): void {
        if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
        this.waiting.clear();
        this.clearWaiting = false;
        this.schedule();
    }

    /** Whether a write can go now: an outstanding clear first, else any file not waiting for the retry. */
    private ready(): boolean {
        if (this.clears > 0) return !this.clearWaiting;
        return Array.from(this.dirty).some((id) => !this.waiting.has(id));
    }

    private schedule(): void {
        if (this.writing || !this.ready()) return;
        // A put that lands between the round's last look and its end starts the next round here.
        const run: Promise<void> = this.drain().finally(() => { if (this.writing === run) { this.writing = null; this.schedule(); } });
        this.writing = run;
    }

    private async drain(): Promise<void> {
        let failed: Error | null = null;
        while (true) {
            if (this.clears > 0) {
                if (this.clearWaiting) break;
                const asked = this.clears;
                try {
                    await this.rows.deleteAll();
                    this.clears -= asked;
                } catch (err) {
                    failed = asError(err);
                    this.clearWaiting = true;
                    this.log(`case file store: clearing the rows failed, will retry: ${failed.message}`);
                }
                continue;
            }
            const id = Array.from(this.dirty).find((d) => !this.waiting.has(d));
            if (id === undefined) break;
            this.dirty.delete(id);
            const file = this.files.get(id);
            if (!file) continue;
            try {
                await this.rows.upsert(recordOf(file));
            } catch (err) {
                failed = asError(err);
                this.dirty.add(id);
                this.waiting.add(id);
                this.log(`case file store: writing case ${id} failed, will retry: ${failed.message}`);
            }
        }
        if (failed) this.lastError = failed;
        else if (!this.waiting.size && !this.clearWaiting) this.lastError = null;
        if ((this.waiting.size || this.clearWaiting) && !this.retryTimer) {
            const timer = setTimeout(() => { this.retryTimer = null; this.retryNow(); }, this.retryMs);
            timer.unref?.();
            this.retryTimer = timer;
        }
    }
}

function asError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
}

/**
 * The identity a restart would otherwise forget: each party on the loaded files as the person it
 * was, under the same person id, with the key it resolved on and the addresses on its channels. A
 * returning customer then resolves to the person their open file names. A key the parties of two
 * different people both carry is put on both, so it resolves as candidates for Ben, never a guess.
 */
export function identityFromCaseFiles(files: CaseFile[], opts: IdentityOptions = {}): Identity {
    const people = new Map<string, Person>();
    for (const file of files) {
        for (const party of file.parties) {
            const keys = [party.canonical, ...party.channels.map((c) => canonical(c.address))].filter((k): k is CanonicalKey => !!k);
            const known = people.get(party.personId);
            people.set(party.personId, known
                ? { ...known, name: known.name ?? party.name, keys: Array.from(new Set([...known.keys, ...keys])) }
                : { id: party.personId, role: party.role, customerId: null, name: party.name, keys: Array.from(new Set(keys)), propertyId: null, landlordId: null });
        }
    }
    const identity = new Identity(opts);
    for (const person of Array.from(people.values())) identity.directory.upsert(person);
    return identity;
}

/** Who the database refusal names when this store is the one that asked (live-database.ts). */
const READER = 'the case file store';

/** The `comms_v2_case_files` table on the branch database. Every call refuses anything but the branch before it opens a connection. */
export const liveCaseFileRows: CaseFileRows = {
    async loadAll() {
        const db = await commsV2Db(READER);
        const { commsV2CaseFiles: t } = await import('@shared/schema');
        const { asc } = await import('drizzle-orm');
        const rows = await db.select({ file: t.file }).from(t).orderBy(asc(t.openedAt), asc(t.id));
        return rows.map((r) => r.file as CaseFile);
    },

    async upsert(file) {
        const db = await commsV2Db(READER);
        const { commsV2CaseFiles: t } = await import('@shared/schema');
        const columns = {
            stage: file.stage,
            openedAt: new Date(file.openedAt),
            personIds: Array.from(new Set(file.parties.map((p) => p.personId))),
            file,
            updatedAt: new Date(),
        };
        await db.insert(t).values({ id: file.id, ...columns }).onConflictDoUpdate({ target: t.id, set: columns });
    },

    async deleteAll() {
        const db = await commsV2Db(READER);
        const { commsV2CaseFiles: t } = await import('@shared/schema');
        await db.delete(t);
    },
};

/** The live intake's store: the branch table, read in full before it is handed back. Refuses before opening anything unless the branch is the database in use. */
export async function openCaseFileStore(opts: DatabaseStoreOptions = {}, rows: CaseFileRows = liveCaseFileRows): Promise<DatabaseCaseFileStore> {
    return new DatabaseCaseFileStore(rows, opts).load();
}
