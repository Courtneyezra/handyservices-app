/**
 * Shared helpers for the client vitest project (alias `@test-utils`, vitest.config.ts).
 *
 * - renderWithQuery: mount inside a fresh React Query client (no retries, no interval refetch)
 * - mockFetch: a routed `fetch` stub that records every call (url, method, parsed JSON body)
 *   and answers from the routes you declare; unmatched calls throw (or 404 with fallback: 'notFound')
 */
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

export function renderWithQuery(ui: ReactElement) {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: 0 },
            mutations: { retry: false },
        },
    });
    const utils = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
    return { client, ...utils };
}

export interface RecordedCall { url: string; method: string; body: any; headers: Record<string, string> }
export interface Route {
    method?: string;
    /** string = exact match or prefix; RegExp = test */
    url: string | RegExp;
    reply: (call: RecordedCall) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>;
}

function fakeResponse(json: unknown, status: number) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => json,
        text: async () => JSON.stringify(json),
    } as unknown as Response;
}

export function mockFetch(routes: Route[], opts: { fallback?: 'throw' | 'notFound' } = {}) {
    const calls: RecordedCall[] = [];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
        const method = (init?.method ?? 'GET').toUpperCase();
        let body: any = null;
        if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
        const call: RecordedCall = { url, method, body, headers: (init?.headers as Record<string, string>) ?? {} };
        calls.push(call);
        const route = routes.find((r) => (r.method ?? 'GET').toUpperCase() === method
            && (typeof r.url === 'string' ? url === r.url || url.startsWith(r.url) : r.url.test(url)));
        if (!route) {
            if (opts.fallback === 'notFound') return fakeResponse({ error: `not mocked: ${method} ${url}` }, 404);
            throw new Error(`[mockFetch] unstubbed ${method} ${url}`);
        }
        const out = await route.reply(call);
        return fakeResponse(out.json ?? {}, out.status ?? 200);
    });
    vi.stubGlobal('fetch', fn);
    return {
        fn,
        calls,
        /** Calls whose method matches and whose url contains `part`. */
        of: (method: string, part: string) => calls.filter((c) => c.method === method.toUpperCase() && c.url.includes(part)),
    };
}
