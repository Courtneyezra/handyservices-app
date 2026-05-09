/**
 * adminFetch — drop-in replacement for fetch() in admin/v2 surfaces.
 *
 * The server's `requireAdmin` middleware (server/auth.ts:15) authenticates via
 * `Authorization: Bearer <token>` where the token was returned by
 * `POST /api/auth/login` and stored in localStorage as `adminToken`.
 *
 * Module 03/07/08 surfaces originally used `credentials: 'include'` (cookies),
 * which doesn't match the bearer-token auth — so every admin API call from
 * v2 pages returned 401. This helper centralises the right pattern.
 *
 * Usage:
 *   const res = await adminFetch('/api/admin/dispatch/inbound');
 *   const res = await adminFetch('/api/admin/units', { method: 'POST', body: JSON.stringify(payload) });
 */

export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const token = (typeof window !== 'undefined' ? window.localStorage.getItem('adminToken') : null) ?? '';
    const headers = new Headers(init.headers ?? {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    return fetch(input, { ...init, headers });
}
