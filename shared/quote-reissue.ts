/**
 * The customer's own refresh of a lapsed quote, in one place.
 *
 * Once a quote's price lock has passed the customer can refresh it on their own quote page
 * (POST /api/personalized-quotes/:slug/reissue): each refresh bumps the price by the surcharge,
 * compounding, and after REISSUE_MAX_SELF of them the page hands off to a human and only the
 * admin renew, which carries no surcharge, can move it.
 *
 * Read by the quote routes that apply it (server/quotes.ts) and by the comms desk, which tells the
 * customer about the refresh while one is left and puts the thread in front of Ben once none is
 * (server/comms-v2/quoting/). Pure numbers, so the desk's pure quote reader can have them.
 */
export const REISSUE_SURCHARGE = 1.05;
export const REISSUE_MAX_SELF = 3;

/**
 * The hard window after which the quote page itself is gone (HTTP 410 from the public quote GET,
 * server/quotes.ts `isQuoteGone`), measured from the quote's creation. Past it there is no page to
 * refresh on, whatever the refresh count says.
 */
export const QUOTE_HARD_EXPIRY_FALLBACK_MS = 30 * 24 * 60 * 60 * 1000;
