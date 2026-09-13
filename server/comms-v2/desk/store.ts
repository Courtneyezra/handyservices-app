/**
 * Where case files live. The sandbox door runs the desk in process, so its store is a Map; the
 * live intake's store is the durable one over the database (database-store.ts), behind the same
 * interface (Ben's kanban reads the in-process one through its own sandbox door for now,
 * server/comms-v2/api/store.ts). The one cross-file rule lives here: a person with an open file
 * for a job that is not done has their turn appended there, never a second file opened.
 *
 * A file is changed in place, so whoever changes one puts it again afterwards: the gateway does
 * after every turn, clock pass and age. The memory store needs nothing from that; a durable store
 * writes what it is handed.
 */
import type { CaseFile } from './case-file';

export interface CaseFileStore {
    get(id: string): CaseFile | null;
    /** The open file (stage not done) a person is a party on, newest first. */
    findOpenFor(personId: string): CaseFile | null;
    put(file: CaseFile): void;
    all(): CaseFile[];
    clear(): void;
}

/** The one reading of `findOpenFor`, shared by every store: stage not done, the person a party, newest opened first. */
export function newestOpenFor(files: Iterable<CaseFile>, personId: string): CaseFile | null {
    const open = Array.from(files).filter((f) => f.stage !== 'done' && f.parties.some((p) => p.personId === personId));
    open.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
    return open[0] ?? null;
}

export class MemoryCaseFileStore implements CaseFileStore {
    private files = new Map<string, CaseFile>();
    get(id: string): CaseFile | null { return this.files.get(id) ?? null; }
    findOpenFor(personId: string): CaseFile | null { return newestOpenFor(this.files.values(), personId); }
    put(file: CaseFile): void { this.files.set(file.id, file); }
    all(): CaseFile[] { return Array.from(this.files.values()); }
    clear(): void { this.files.clear(); }
}
