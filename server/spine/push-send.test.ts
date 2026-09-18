/**
 * B9: "Send at £X" on the ready-to-price push. Offered only when nothing is marked check this and
 * the customer has no opt-out of either scope; at the tap the price screen's own send runs a body
 * built here from the draft, and anything that changed since the push refuses it.
 */
import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import {
    PUSH_SEND_TTL_MS, pushSendBody, pushSendLines, pushSendOffer, queueLineOf, readPushSend, readyToPriceExtras, signPushSend, withReadyToPriceExtras,
    type PushSendScreen,
} from './push-send';

const KEY = 'a-test-session-secret-of-length';
const NOW = 1_800_000_000_000;
const SLUG = 'z4p6t9mw';

function screen(over: Partial<PushSendScreen> = {}): PushSendScreen {
    return {
        available: true, slug: SLUG, status: 'draft', version: 'v1',
        lines: [
            { lineId: 'card_1', suggestedPence: 2800, materialsPence: 600, checkThis: false, basis: { labourPence: 2200 } },
            { lineId: 'card_2', suggestedPence: 15500, materialsPence: 0, checkThis: false, basis: null },
        ],
        contradictions: [], estimate: { status: 'complete' }, message: { body: 'Hi Sam, your quote is below.\n\nhttps://handyservices.app/quote/z4p6t9mw' },
        ...over,
    };
}

function deps(over: { screen?: PushSendScreen; optOut?: () => Promise<{ scope: string } | null>; key?: string | null; now?: number } = {}) {
    return {
        key: over.key === undefined ? KEY : over.key,
        now: () => over.now ?? NOW,
        baseUrl: 'https://example.test',
        load: vi.fn(async () => over.screen ?? screen()),
        optOut: vi.fn(over.optOut ?? (async () => null)),
    };
}

const tokenOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get('push')!);

describe('the signed link', () => {
    it('reads back what it signed until it expires, and nothing tampered with', () => {
        const t = signPushSend({ slug: SLUG, version: 'v1', totalPence: 18300, exp: NOW + 1000 }, KEY);
        expect(readPushSend(t, KEY, NOW)).toEqual({ slug: SLUG, version: 'v1', totalPence: 18300, exp: NOW + 1000 });
        expect(readPushSend(t, KEY, NOW + 1000)).toBeNull();
        expect(readPushSend(t, 'another-secret-entirely-here', NOW)).toBeNull();
        const [payload, sig] = t.split('.');
        const forged = Buffer.from(JSON.stringify({ slug: SLUG, version: 'v1', totalPence: 1, exp: NOW + 1000 })).toString('base64url');
        expect(readPushSend(`${forged}.${sig}`, KEY, NOW)).toBeNull();
        expect(readPushSend(`${payload}.`, KEY, NOW)).toBeNull();
        expect(readPushSend(42, KEY, NOW)).toBeNull();
    });
});

describe('what the push may send', () => {
    it('is the figures the screen opens with: stored labour plus materials, else the suggestion', () => {
        expect(pushSendLines(screen())).toEqual({
            ok: true, totalPence: 18300,
            lines: [{ lineId: 'card_1', finalPence: 2800, labourPence: 2200, materialsPence: 600 }, { lineId: 'card_2', finalPence: 15500, labourPence: 15500, materialsPence: 0 }],
        });
    });
    it('is nothing when a line is marked check this, carries a contradiction, has no suggestion, the estimator failed or the quote is not a draft', () => {
        const [a, b] = screen().lines;
        expect(pushSendLines(screen({ lines: [{ ...a, checkThis: true }, b] }))).toMatchObject({ ok: false, reason: 'a line is marked check this' });
        expect(pushSendLines(screen({ contradictions: [{}] }))).toMatchObject({ ok: false });
        expect(pushSendLines(screen({ lines: [{ ...a, suggestedPence: null }, b] }))).toMatchObject({ ok: false, reason: 'a line has no suggested price' });
        expect(pushSendLines(screen({ estimate: { status: 'failed' } }))).toMatchObject({ ok: false });
        expect(pushSendLines(screen({ status: 'sent' }))).toMatchObject({ ok: false, reason: 'the quote is sent' });
    });
});

describe('the offer on the push', () => {
    it('is a link to the price screen carrying a token for this slug, version and total', async () => {
        const offer = await pushSendOffer(SLUG, deps());
        expect(offer).toMatchObject({ totalPence: 18300 });
        expect(offer!.url.startsWith(`https://example.test/admin/price/${SLUG}?push=`)).toBe(true);
        expect(readPushSend(tokenOf(offer!.url), KEY, NOW)).toEqual({ slug: SLUG, version: 'v1', totalPence: 18300, exp: NOW + PUSH_SEND_TTL_MS });
    });
    it('is not made when a line needs a check, the customer has any opt-out, the list cannot be read, or there is no secret', async () => {
        const [a, b] = screen().lines;
        expect(await pushSendOffer(SLUG, deps({ screen: screen({ lines: [{ ...a, checkThis: true }, b] }) }))).toBeNull();
        expect(await pushSendOffer(SLUG, deps({ optOut: async () => ({ scope: 'marketing' }) }))).toBeNull();
        expect(await pushSendOffer(SLUG, deps({ optOut: async () => ({ scope: 'all' }) }))).toBeNull();
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try { expect(await pushSendOffer(SLUG, deps({ optOut: async () => { throw new Error('db down'); } }))).toBeNull(); } finally { quiet.mockRestore(); }
        expect(await pushSendOffer(SLUG, deps({ key: null }))).toBeNull();
    });
});

describe('at the tap', () => {
    async function token(d = deps()) { return tokenOf((await pushSendOffer(SLUG, d))!.url); }

    it('builds the send body from the draft: the figures, the desk\'s message unedited, no resolutions', async () => {
        const out = await pushSendBody(SLUG, await token(), deps());
        expect(out).toEqual({
            ok: true, totalPence: 18300,
            body: {
                version: 'v1',
                lines: [{ lineId: 'card_1', finalPence: 2800, labourPence: 2200, materialsPence: 600 }, { lineId: 'card_2', finalPence: 15500, labourPence: 15500, materialsPence: 0 }],
                message: 'Hi Sam, your quote is below.\n\nhttps://handyservices.app/quote/z4p6t9mw', messageEdited: false, resolutions: [],
            },
        });
    });
    it('refuses a new version, a line now marked check this, a different total, an opt-out since the push, an expired or foreign token', async () => {
        const t = await token();
        const [a, b] = screen().lines;
        expect(await pushSendBody(SLUG, t, deps({ screen: screen({ version: 'v2' }) }))).toMatchObject({ ok: false, status: 409, reason: expect.stringContaining('changed since the notification') });
        expect(await pushSendBody(SLUG, t, deps({ screen: screen({ lines: [{ ...a, checkThis: true }, b] }) }))).toMatchObject({ ok: false, status: 409, reason: expect.stringContaining('check this') });
        expect(await pushSendBody(SLUG, t, deps({ screen: screen({ lines: [{ ...a, basis: { labourPence: 2300 } }, b] }) }))).toMatchObject({ ok: false, status: 409, reason: expect.stringContaining('total') });
        expect(await pushSendBody(SLUG, t, deps({ optOut: async () => ({ scope: 'marketing' }) }))).toMatchObject({ ok: false, status: 409, reason: expect.stringContaining('asked us to stop') });
        expect(await pushSendBody(SLUG, t, deps({ now: NOW + PUSH_SEND_TTL_MS }))).toMatchObject({ ok: false, status: 403 });
        expect(await pushSendBody('other123', t, deps())).toMatchObject({ ok: false, status: 403 });
        expect(await pushSendBody(SLUG, t, deps({ key: null }))).toMatchObject({ ok: false, status: 403 });
    });
});

describe('the push message', () => {
    it('F7: says how many others wait and the oldest age, never counting this quote', () => {
        const H = 3_600_000;
        expect(queueLineOf({ count: 3, items: [{ slug: SLUG, waitingMs: 0 }, { slug: 'a', waitingMs: 30 * H }, { slug: 'b', waitingMs: 2 * H }] }, SLUG)).toBe('+2 more waiting to price · oldest 1 day.');
        expect(queueLineOf({ count: 1, items: [{ slug: SLUG, waitingMs: 0 }] }, SLUG)).toBe('Nothing else waiting to price.');
    });
    it('a queue read that fails drops the line rather than guessing a count', async () => {
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const out = await readyToPriceExtras(SLUG, { ...deps(), queue: async () => { throw new Error('down'); } });
            expect(out.queueLine).toBeNull();
            expect(out.send).not.toBeNull();
        } finally { quiet.mockRestore(); }
    });
    it('is plain text with no extras, and escaped HTML with the send link when there are', () => {
        expect(withReadyToPriceExtras('Sam <b>', { queueLine: null, send: null })).toEqual({ message: 'Sam <b>', html: false });
        const out = withReadyToPriceExtras('Sam & Co <b>', { queueLine: '+2 more waiting to price.', send: { url: 'https://example.test/admin/price/x?push=a.b', totalPence: 18300 } });
        expect(out.html).toBe(true);
        expect(out.message).toContain('Sam &amp; Co &lt;b&gt;');
        expect(out.message).toContain('<a href="https://example.test/admin/price/x?push=a.b">Send at £183</a>');
    });
});

describe('the price screen send route', () => {
    it('builds a push send\'s body before confirmPrices, after the sandbox refusal, and returns its refusal unsent', () => {
        const src = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
        const handler = src.slice(src.indexOf("spineRouter.post('/price/:slug/send'"));
        const sandbox = handler.indexOf('isSandboxQuoteSlug(slug)');
        const push = handler.indexOf('pushSendBody(slug');
        const confirm = handler.indexOf('confirmPrices(slug, sendBody');
        expect(sandbox).toBeGreaterThan(-1);
        expect(push).toBeGreaterThan(sandbox);
        expect(confirm).toBeGreaterThan(push);
        expect(handler.slice(push, confirm)).toContain('if (!built.ok) return res.status(built.status)');
    });
});
