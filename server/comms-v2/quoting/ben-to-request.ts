/**
 * What the draft is missing, for the one screen that may show it: Ben's price screen.
 *
 * The list is on no field of the quote row on purpose - every field of that row is served to
 * anyone holding the quote's slug (`GET /api/personalized-quotes/:slug`, `optionalAuth`) - so it
 * lives on the case file as the internal `ben_to_request` fact (`quoting-tools.ts`). The price
 * screen is admin-gated, so it is a surface the list may reach, and this is the one read that
 * takes it there: `server/spine/price-screen.ts` asks through a lazy import, so nothing in the
 * spine depends on the new desk at load time and the screen still renders when it answers nothing.
 *
 * Read from the board's own door, which is the desk instance the app process runs
 * (`server/comms-v2/api/store.ts`); a slug drafted in another process has no case file here and
 * the screen simply shows no list. Never opens a door that is not already open: a quote no comms-v2
 * thread drafted has nothing to find, so asking must cost nothing.
 */
import type { CaseFile } from '../desk/case-file';
import { QUOTE_FACT } from './quote-record';

/** The list as `draft_quote` wrote it, off the file that names this quote. Nothing there is nothing to show. */
export function benToRequestOn(files: readonly CaseFile[], slug: string): string[] {
    const file = files.find((f) => f.job.quoteRef === slug);
    if (!file) return [];
    const fact = [...file.facts].reverse().find((f) => f.key === QUOTE_FACT.benToRequest);
    return fact ? fact.value.split(';').map((s) => s.trim()).filter(Boolean) : [];
}

export async function benToRequestFor(slug: string): Promise<string[]> {
    const { commsV2BoardDoorIfOpen } = await import('../api/store');
    const door = commsV2BoardDoorIfOpen();
    return door ? benToRequestOn(door.gateway.store.all(), slug) : [];
}
