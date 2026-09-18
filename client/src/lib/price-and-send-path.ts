/**
 * B9 (F6): Price and Send (`/admin/price/:slug`) renders full screen, outside the admin shell, so
 * its own dark header is the only header on the route. Kept apart, like `handy-desk-path.ts`, so the
 * app entry can match it without loading the page. The queue (`/admin/price`) and the variation
 * screen (`/admin/price/variation/:id`) stay in the shell.
 */
export function isPriceAndSendPath(path: string): boolean {
    return /^\/admin\/price\/(?!variation(?:\/|$))[^/]+\/?$/.test(path);
}
