/**
 * What /admin/comms serves: the whole old page while the new desk is not live; live, only the
 * contractor lane, reached by its own address or a thread link, and the new board for the rest.
 */
import { describe, expect, it } from 'vitest';
import { oldCommsEntry } from '@/hooks/useOldComms';

describe('oldCommsEntry', () => {
    it('is the old page for every address while not retired', () => {
        for (const search of ['', '?conversation=c1', '?lane=contractor', '?prep=1']) expect(oldCommsEntry(false, search)).toBe('old');
    });

    it('retired, keeps the contractor lane for its own address and for a thread link', () => {
        expect(oldCommsEntry(true, '?lane=contractor')).toBe('contractors');
        expect(oldCommsEntry(true, '?conversation=c1')).toBe('contractors');
    });

    it('retired, sends the bare page and any other address to the new board', () => {
        expect(oldCommsEntry(true, '')).toBe('board');
        expect(oldCommsEntry(true, '?lane=customer')).toBe('board');
        expect(oldCommsEntry(true, '?prep=1')).toBe('board');
    });
});
