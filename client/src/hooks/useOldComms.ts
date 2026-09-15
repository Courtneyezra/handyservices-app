/**
 * useOldComms — is the old comms page (/admin/comms) retired for customers, because the new desk is
 * the live desk? While it is, the sidebar drops its Comms item and the page keeps only its contractor
 * lane; customers are answered on Comms Desk v2. The server refuses the old page's customer sends on
 * the same read, so this only decides what staff are shown.
 *
 * A read that fails is not retired: the page stays exactly as it was, as the old desk does on an
 * unreadable switch.
 *
 * Data: GET /api/comms-v2/old-comms (server/comms-v2/old-comms.ts). Read-only.
 */
import { useQuery } from '@tanstack/react-query';
import { adminAuthHeaders } from './usePriceQueue';

export const OLD_COMMS_KEY = ['comms-v2-old-comms'] as const;
export const OLD_COMMS_URL = '/api/comms-v2/old-comms';
export const NEW_BOARD_PATH = '/admin/comms-v2';
export const CONTRACTOR_LANE_PATH = '/admin/comms?lane=contractor';

export interface OldCommsPayload {
    retired: boolean;
}

export async function fetchOldComms(): Promise<OldCommsPayload> {
    const res = await fetch(OLD_COMMS_URL, { headers: adminAuthHeaders() });
    if (!res.ok) throw new Error(`old comms ${res.status}`);
    return res.json();
}

export function useOldComms(opts: { enabled?: boolean } = {}) {
    return useQuery<OldCommsPayload>({
        queryKey: OLD_COMMS_KEY,
        queryFn: fetchOldComms,
        enabled: opts.enabled ?? true,
        staleTime: 30_000,
        refetchInterval: 60_000,
        refetchOnWindowFocus: true,
        retry: false,
    });
}

/**
 * What /admin/comms serves for this address: the whole old page while it is not retired; retired,
 * the contractor lane for a contractor-lane address or a thread link (a thread that turns out not to
 * be a contractor's then goes to the board), and the new board for anything else.
 */
export type OldCommsEntry = 'old' | 'contractors' | 'board';

export function oldCommsEntry(retired: boolean, search: string): OldCommsEntry {
    if (!retired) return 'old';
    const params = new URLSearchParams(search);
    return params.get('lane') === 'contractor' || params.has('conversation') ? 'contractors' : 'board';
}
