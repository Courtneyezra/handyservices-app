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
 * Read from the live intake's store while the new desk is the live desk and its gateway is already
 * built (`server/comms-v2/channels/intake.ts`), then from the board's own door, which is the sandbox
 * desk instance the app process runs (`server/comms-v2/api/store.ts`); a slug drafted in another
 * process has no case file here and the screen simply shows no list. Never opens a door or builds a
 * gateway that is not already there: a quote no comms-v2 thread drafted has nothing to find, so
 * asking must cost nothing.
 */
import type { CaseFile } from '../desk/case-file';
import { QUOTE_FACT } from './quote-record';
import { READINESS_WORDINGS, quoteReadiness } from './quoting-tools';

/**
 * What the draft is still missing, asked at the moment Ben looks. The stored fact is what was
 * missing when the draft was built, and a thread moves on: the customer sends the photo two turns
 * later, or gives access, and a card still asking for it sends Ben to request something he already
 * has. So a stored entry `quote_readiness` wrote is answered again here and dropped once it is no
 * longer missing, in its current wording rather than the wording of the day the draft was built.
 *
 * One of its wordings is recognised word for word, never by the word it opens with: the intake
 * model is asked for short labels and "photo of the panel" is one of the examples it is given, so a
 * first-word match would take that for the readiness photo and drop a photo Ben still needs the
 * moment any other photo arrives. The model's own labels ("which tap", "wall material") cannot be
 * recomputed from the file, so they stand as written until Ben clears them himself. Two stored
 * entries about one subject resolve to the one current wording, which is shown once. Nothing is
 * rewritten: the fact records what the draft was built without.
 */
export function benToRequest(file: CaseFile): string[] {
    const fact = [...file.facts].reverse().find((f) => f.key === QUOTE_FACT.benToRequest);
    if (!fact) return [];
    const stored = fact.value.split(';').map((s) => s.trim()).filter(Boolean);
    const still = new Map(quoteReadiness(file).missing.map((m) => [READINESS_WORDINGS.get(m)!, m]));
    const out: string[] = [];
    for (const entry of stored) {
        const subject = READINESS_WORDINGS.get(entry);
        const current = subject === undefined ? entry : still.get(subject);
        if (current && !out.includes(current)) out.push(current);
    }
    return out;
}

/** The case file carrying this quote, the one the price screen reads for it. */
export function quoteFileOn(files: readonly CaseFile[], slug: string): CaseFile | null {
    return files.find((f) => f.job.quoteRef === slug) ?? null;
}

export function benToRequestOn(files: readonly CaseFile[], slug: string): string[] {
    const file = quoteFileOn(files, slug);
    return file ? benToRequest(file) : [];
}

/** Every case file the price screen may read in this process: the live intake's while the new desk is live, then the board's door. */
export async function priceScreenCaseFiles(): Promise<CaseFile[]> {
    const files: CaseFile[] = [];
    const { builtIntakeGateway } = await import('../channels/intake');
    const built = builtIntakeGateway();
    if (built?.purpose === 'live' && await (await import('../switch')).commsV2Live()) files.push(...built.gateway.store.all());
    const { commsV2BoardDoorIfOpen } = await import('../api/store');
    const door = commsV2BoardDoorIfOpen();
    if (door) files.push(...door.gateway.store.all());
    return files;
}

export async function benToRequestFor(slug: string): Promise<string[]> {
    return benToRequestOn(await priceScreenCaseFiles(), slug);
}
