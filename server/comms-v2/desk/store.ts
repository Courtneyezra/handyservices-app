/**
 * Where case files live. Goal 1 runs the desk in the sandbox, in process, so the store is a Map;
 * the interface is what a durable store (Goal 2's kanban needs one) implements later. The one
 * cross-file rule lives here: a person with an open file for a job that is not done has their
 * turn appended there, never a second file opened.
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

export class MemoryCaseFileStore implements CaseFileStore {
    private files = new Map<string, CaseFile>();
    get(id: string): CaseFile | null { return this.files.get(id) ?? null; }
    findOpenFor(personId: string): CaseFile | null {
        const open = Array.from(this.files.values()).filter((f) => f.stage !== 'done' && f.parties.some((p) => p.personId === personId));
        open.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
        return open[0] ?? null;
    }
    put(file: CaseFile): void { this.files.set(file.id, file); }
    all(): CaseFile[] { return Array.from(this.files.values()); }
    clear(): void { this.files.clear(); }
}
