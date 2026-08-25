/**
 * Fetch wrapper with built-in timeout support.
 *
 * Prevents hanging requests from blocking the event loop indefinitely. All
 * external API calls should use this or implement their own AbortController
 * pattern. The default 30s timeout is generous enough for most APIs while
 * still catching genuinely stuck connections.
 *
 * Usage:
 *   const response = await fetchWithTimeout('https://api.example.com/data', {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *   }, 5000); // 5 second timeout
 *
 * Timeout errors throw with a recognizable message so callers can handle them
 * distinctly from network errors or non-2xx responses.
 */

export class FetchTimeoutError extends Error {
    constructor(
        message: string,
        readonly url: string,
        readonly timeoutMs: number,
    ) {
        super(message);
        this.name = 'FetchTimeoutError';
    }
}

/** Default timeout for external API calls (30 seconds). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Shorter timeout for lightweight endpoints (5 seconds). */
export const SHORT_TIMEOUT_MS = 5_000;

/** Longer timeout for heavyweight operations like file uploads (60 seconds). */
export const LONG_TIMEOUT_MS = 60_000;

/**
 * Fetch with automatic timeout. Aborts the request if it doesn't complete
 * within `timeoutMs` milliseconds.
 *
 * @param url - The URL to fetch
 * @param init - Standard RequestInit options (method, headers, body, etc.)
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns The Response object (same as native fetch)
 * @throws FetchTimeoutError if the request times out
 * @throws Other errors from the underlying fetch (network errors, etc.)
 */
export async function fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal,
        });
        return response;
    } catch (err) {
        // AbortController.abort() causes fetch to throw a DOMException with
        // name "AbortError". Convert to our typed error for easier handling.
        if (err instanceof Error && err.name === 'AbortError') {
            throw new FetchTimeoutError(
                `Request to ${url} timed out after ${timeoutMs}ms`,
                url,
                timeoutMs,
            );
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetch with timeout that returns null on failure instead of throwing.
 * Useful for best-effort calls where a failure is acceptable (geocoding,
 * analytics, non-critical enrichment).
 *
 * Logs warnings for failures so they're visible in monitoring without
 * crashing the calling code path.
 */
export async function fetchWithTimeoutSafe(
    url: string,
    init?: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    logTag: string = 'fetchWithTimeoutSafe',
): Promise<Response | null> {
    try {
        return await fetchWithTimeout(url, init, timeoutMs);
    } catch (err) {
        if (err instanceof FetchTimeoutError) {
            console.warn(`[${logTag}] Request timed out: ${url} (${timeoutMs}ms)`);
        } else {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[${logTag}] Request failed: ${url} - ${msg}`);
        }
        return null;
    }
}
