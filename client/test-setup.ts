/**
 * Client vitest setup (jsdom). Loaded before every client/src test file.
 *
 * - jest-dom matchers (toBeInTheDocument, toBeDisabled, ...)
 * - unmount after each test so one file's DOM never leaks into the next
 * - the browser APIs jsdom lacks that shadcn/Radix and framer-motion touch at mount
 * - no network: every test must stub `fetch` itself; an unstubbed call fails loudly
 * - no EventSource: useCommsEvents opens one at mount; tests drive it through the stub below
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
});

beforeEach(() => {
    // Any component that fetches without the test stubbing it fails here instead of hanging.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        throw new Error(`[client tests] unstubbed fetch: ${typeof input === 'string' ? input : (input as Request).url ?? String(input)}`);
    }));
});

// --- jsdom gaps ---------------------------------------------------------------------------

if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

if (!('ResizeObserver' in window)) {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}
// Radix pointer-capture helpers (jsdom has none)
for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(name in Element.prototype)) {
        (Element.prototype as unknown as Record<string, unknown>)[name] = name === 'hasPointerCapture' ? () => false : () => {};
    }
}

/**
 * EventSource stub. jsdom does not implement it; useCommsEvents (`@/hooks/useCommsEvents`) opens
 * one shared connection at mount. Tests reach the most recent instance through
 * `MockEventSource.last` and push events with `.emit(payload)`.
 */
export class MockEventSource {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    static instances: MockEventSource[] = [];
    static get last(): MockEventSource | undefined { return MockEventSource.instances[MockEventSource.instances.length - 1]; }
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
    readyState = 1;
    url: string;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    constructor(url: string) { this.url = url; MockEventSource.instances.push(this); }
    close() { this.readyState = 2; }
    addEventListener() {}
    removeEventListener() {}
    /** Deliver one server event as the stream would (a JSON line). */
    emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent); }
    open() { this.onopen?.(new Event('open')); }
}
vi.stubGlobal('EventSource', MockEventSource);
afterEach(() => { MockEventSource.instances.length = 0; });
