/**
 * B9 (the captain's design, "Say £183, send"): the second action on Ben's ready-to-price push, which
 * sends the quote at the figures on the screen in one tap, without opening it to edit.
 *
 * It is not a side path. The tap opens /admin/price/<slug>?push=<token> signed in as Ben; the page
 * posts the price screen's own send (`POST /api/spine/price/:slug/send`, server/spine/routes.ts)
 * with `{ via: 'push', token }`, and that route asks `pushSendBody` here for the body instead of
 * trusting one from the page. From there it is the screen's send exactly: confirmPrices under
 * human:<Ben>, the same sender, the same window and template rules, the same outbound opt-out gate.
 *
 * What the push can send is narrower than what the screen can, and is checked twice, when the push
 * is built (`pushSendOffer`: no action is offered otherwise) and again at the tap (`pushSendBody`):
 *   - the draft is still a draft, at the version the push was built from (a new scope refuses it);
 *   - no line is marked check this, none carries an open contradiction, every line has a
 *     suggestion, and the estimator did not fail;
 *   - the figures are the ones the screen opens with (each line's seeded labour plus its materials,
 *     the page's own `suggestedHalves`), and they add up to the total the push named;
 *   - the customer has NO opt-out on record, of either scope. The screen's send is a service reply
 *     that a plain STOP does not block; a tap on a notification is not Ben reading the thread, so it
 *     refuses anyone who has asked us to stop at all, and a failed read of the list refuses too.
 * The token is an HMAC over the slug, version and total with SESSION_SECRET, valid for 12 hours;
 * with no secret, no action is offered.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const PUSH_SEND_TTL_MS = 12 * 60 * 60 * 1000;

export interface PushSendClaim { slug: string; version: string; totalPence: number; exp: number }

/** The slice of the price screen payload this module reads. */
export interface PushSendScreen {
    available: true;
    slug: string;
    status: string;
    version: string;
    lines: Array<{ lineId: string; suggestedPence: number | null; materialsPence: number; checkThis: boolean; basis?: { labourPence?: number | null } | null }>;
    contradictions?: unknown[];
    estimate?: { status: string | null } | null;
    message?: { body: string } | null;
}

export interface PushSendDeps {
    load?: (slug: string) => Promise<PushSendScreen | { available: false; reason: string }>;
    /** The customer's opt-out, either scope; throws when the list cannot be read. */
    optOut?: (slug: string) => Promise<{ scope: string } | null>;
    key?: string | null;
    now?: () => number;
    baseUrl?: string;
}

function keyOf(deps: PushSendDeps): string | null {
    const k = deps.key !== undefined ? deps.key : process.env.SESSION_SECRET ?? null;
    return k && k.length >= 16 ? k : null;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const mac = (key: string, payload: string) => createHmac('sha256', `push-send:${key}`).update(payload).digest('base64url');

export function signPushSend(claim: PushSendClaim, key: string): string {
    const payload = b64(JSON.stringify(claim));
    return `${payload}.${mac(key, payload)}`;
}

export function readPushSend(token: unknown, key: string, now: number): PushSendClaim | null {
    if (typeof token !== 'string' || token.length > 2000) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const want = Buffer.from(mac(key, payload));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
        const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PushSendClaim;
        if (typeof c.slug !== 'string' || typeof c.version !== 'string' || !Number.isInteger(c.totalPence) || typeof c.exp !== 'number') return null;
        return c.exp > now ? c : null;
    } catch { return null; }
}

/** The figures the screen opens with, or why the push may not send them. */
export function pushSendLines(screen: PushSendScreen): { ok: true; lines: Array<{ lineId: string; finalPence: number; labourPence: number; materialsPence: number }>; totalPence: number } | { ok: false; reason: string } {
    if (screen.status !== 'draft') return { ok: false, reason: `the quote is ${screen.status}` };
    if (!screen.lines.length) return { ok: false, reason: 'the quote has no lines' };
    if (/fail|error/i.test(screen.estimate?.status ?? '')) return { ok: false, reason: 'the estimator failed, so every line needs a check' };
    if (screen.lines.some((l) => l.checkThis)) return { ok: false, reason: 'a line is marked check this' };
    if ((screen.contradictions ?? []).length) return { ok: false, reason: 'a line has something to check' };
    const lines = [];
    let totalPence = 0;
    for (const l of screen.lines) {
        if (l.suggestedPence == null) return { ok: false, reason: 'a line has no suggested price' };
        // The page's suggestedHalves: the stored labour, else the suggestion less the materials.
        const labourPence = l.basis?.labourPence ?? Math.max(0, l.suggestedPence - l.materialsPence);
        const finalPence = labourPence + l.materialsPence;
        if (finalPence <= 0) return { ok: false, reason: 'a line is at £0' };
        lines.push({ lineId: l.lineId, finalPence, labourPence, materialsPence: l.materialsPence });
        totalPence += finalPence;
    }
    return { ok: true, lines, totalPence };
}

const defaultLoad: NonNullable<PushSendDeps['load']> = async (slug) => {
    const { loadPriceScreen } = await import('./price-screen');
    return loadPriceScreen(slug) as Promise<PushSendScreen | { available: false; reason: string }>;
};

const defaultOptOut: NonNullable<PushSendDeps['optOut']> = async (slug) => {
    const { db } = await import('../db');
    const { personalizedQuotes } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const { getOptOut } = await import('../opt-out');
    const [q] = await db.select({ phone: personalizedQuotes.phone, email: personalizedQuotes.email }).from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug)).limit(1);
    if (!q) throw new Error('no quote row to read the customer from');
    return getOptOut({ phones: [q.phone], emails: [q.email] });
};

async function optOutRefusal(slug: string, deps: PushSendDeps): Promise<string | null> {
    try {
        const record = await (deps.optOut ?? defaultOptOut)(slug);
        return record ? 'the customer has asked us to stop, so a notification cannot send to them; open the quote to decide' : null;
    } catch (error: any) {
        console.error(`[PushSend] opt-out read failed for ${slug}, refusing:`, error?.message ?? error);
        return 'the opt-out list could not be read, so nothing was sent';
    }
}

/** The "Send at £X" link for the push, or null with no action offered. Never throws. */
export async function pushSendOffer(slug: string, deps: PushSendDeps = {}): Promise<{ url: string; totalPence: number } | null> {
    try {
        const key = keyOf(deps);
        if (!key) return null;
        const screen = await (deps.load ?? defaultLoad)(slug);
        if (!screen.available) return null;
        const lines = pushSendLines(screen);
        if (!lines.ok) return null;
        if (await optOutRefusal(slug, deps)) return null;
        const now = (deps.now ?? Date.now)();
        const token = signPushSend({ slug, version: screen.version, totalPence: lines.totalPence, exp: now + PUSH_SEND_TTL_MS }, key);
        const base = deps.baseUrl ?? process.env.BASE_URL ?? 'https://handyservices.app';
        return { url: `${base}/admin/price/${encodeURIComponent(slug)}?push=${encodeURIComponent(token)}`, totalPence: lines.totalPence };
    } catch (error: any) {
        console.error(`[PushSend] could not build the send action for ${slug}; none offered:`, error?.message ?? error);
        return null;
    }
}

/**
 * At the tap: the send body the price screen's route runs, built here from the draft rather than
 * taken from the page, or why nothing may be sent. 409 for anything that changed since the push
 * (the page then shows the screen for Ben to decide), 403 for a token that is not ours or expired.
 */
export async function pushSendBody(slug: string, token: unknown, deps: PushSendDeps = {}): Promise<{ ok: true; body: Record<string, unknown>; totalPence: number } | { ok: false; status: number; reason: string }> {
    const key = keyOf(deps);
    if (!key) return { ok: false, status: 403, reason: 'Sending from a notification is not set up here. Open the quote and press Send.' };
    const claim = readPushSend(token, key, (deps.now ?? Date.now)());
    if (!claim || claim.slug !== slug) return { ok: false, status: 403, reason: 'That notification link has expired or is not for this quote, so nothing was sent. Check the quote and press Send.' };
    const screen = await (deps.load ?? defaultLoad)(slug);
    if (!screen.available) return { ok: false, status: 404, reason: screen.reason };
    if (screen.version !== claim.version) return { ok: false, status: 409, reason: 'The quote changed since the notification, so nothing was sent. Check it and press Send.' };
    const lines = pushSendLines(screen);
    if (!lines.ok) return { ok: false, status: 409, reason: `Nothing was sent: ${lines.reason}. Check it and press Send.` };
    if (lines.totalPence !== claim.totalPence) return { ok: false, status: 409, reason: 'The total is not the one the notification named, so nothing was sent. Check it and press Send.' };
    const blocked = await optOutRefusal(slug, deps);
    if (blocked) return { ok: false, status: 409, reason: `Nothing was sent: ${blocked}.` };
    return {
        ok: true,
        totalPence: lines.totalPence,
        body: {
            version: screen.version,
            lines: lines.lines,
            ...(screen.message?.body ? { message: screen.message.body } : {}),
            messageEdited: false,
            resolutions: [],
        },
    };
}

// ---------------------------------------------------------------- the ready-to-price push's extras

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** The price queue's own age words (client/src/hooks/usePriceQueue.ts `ageLabel`). */
export function ageWords(ms: number): string {
    if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
    if (ms < HOUR) return `${Math.floor(ms / 60_000)} min`;
    if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
    const days = Math.floor(ms / DAY);
    return days === 1 ? '1 day' : `${days} days`;
}

/** F7: how many OTHER quotes wait to be priced and how long the oldest has, from the price queue's one query. */
export function queueLineOf(queue: { count: number; items: Array<{ slug: string; waitingMs: number }> }, slug: string): string {
    const others = queue.items.filter((i) => i.slug !== slug);
    const count = Math.max(others.length, queue.count - (others.length < queue.items.length ? 1 : 0));
    if (count <= 0) return 'Nothing else waiting to price.';
    const oldest = others.reduce((m, i) => Math.max(m, i.waitingMs), 0);
    return `+${count} more waiting to price${others.length ? ` · oldest ${ageWords(oldest)}` : ''}.`;
}

export interface ReadyToPriceExtras {
    /** F7's line, or null when the queue could not be read (the push never guesses a count). */
    queueLine: string | null;
    /** The one-tap send, or null when it is not offered. */
    send: { url: string; totalPence: number } | null;
}

/** What B9 adds to the ready-to-price push. Never throws; each part is dropped on its own failure. */
export async function readyToPriceExtras(slug: string, deps: PushSendDeps & { queue?: () => Promise<{ count: number; items: Array<{ slug: string; waitingMs: number }> }> } = {}): Promise<ReadyToPriceExtras> {
    let queueLine: string | null = null;
    try {
        const queue = await (deps.queue ?? (async () => (await import('./price-queue')).loadPriceQueue()))();
        queueLine = queueLineOf(queue, slug);
    } catch (error: any) {
        console.error(`[PushSend] price queue read failed for the push on ${slug}; no queue line:`, error?.message ?? error);
    }
    return { queueLine, send: await pushSendOffer(slug, deps) };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The push message with B9's extras, as Pushover HTML (the one way to put a second action on a push:
 * Pushover has a single URL button, which stays "Price and send"). Every line of the original is
 * escaped; the send action is a link, offered only when `extras.send` is.
 */
export function withReadyToPriceExtras(message: string, extras: ReadyToPriceExtras): { message: string; html: boolean } {
    if (!extras.queueLine && !extras.send) return { message, html: false };
    const parts = [escapeHtml(message)];
    if (extras.queueLine) parts.push(escapeHtml(extras.queueLine));
    if (extras.send) {
        const pounds = `£${(extras.send.totalPence / 100).toLocaleString('en-GB', { minimumFractionDigits: extras.send.totalPence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
        parts.push(`<a href="${escapeHtml(extras.send.url)}">Send at ${pounds}</a> (one tap sends it as priced; nothing is marked check this)`);
    }
    return { message: parts.join('\n'), html: true };
}
