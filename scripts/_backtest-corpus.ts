/**
 * _backtest-corpus.ts — turning the real WhatsApp corpus into scored decision points.
 *
 * The analysis module behind scripts/_agent-backtest.ts. Everything here is PURE and READ-ONLY:
 * it parses whatsapp-export/wa-dump.json, joins it to quote outcomes, cuts each conversation at
 * the moment a decision was actually made, and classifies the move Ben made next. It runs no
 * agent, writes nothing to the database and sends nothing.
 *
 * WHY DECISION POINTS AND NOT WHOLE THREADS
 * A unit test proves the agent does what we intended. It cannot tell us whether what we intended
 * wins work. The corpus can, because for every one of these moments we already know two things
 * the agent does not: what a human actually said next, and whether that thread ended in money.
 *
 * THE THREE MOMENTS, and why these three (docs/WHATSAPP-CONVERSATION-ANALYSIS.md):
 *   price_objection — the highest-value one. 142 pushback moments in the corpus; where a thread
 *                     had both a quote and an objection (n=19) the move decided the outcome:
 *                     amended/re-quoted 67% paid, held-with-a-reason 33%, politely capitulated 13%.
 *                     Capitulating is his commonest move and his worst, so the agent can beat him.
 *   first_reply     — the opening move. He asks for a photo and nothing else in 69% of threads,
 *                     at message index 1. Our designed flow front-loads qualification instead.
 *   timing_hold     — "not right now" is a scheduling state, not a rejection. One such thread went
 *                     on to pay £984. An agent that reads these as losses destroys value.
 *
 * THE JOIN TRAP, inherited from the corpus work and worth repeating: the `phone` field in the
 * dump is a WhatsApp @lid, a privacy id that joins to NOTHING. The real number lives in
 * `chatName` for unsaved contacts, which is exactly the customer population. Everything here
 * keys on the last 10 digits of chatName, plus the quote short_slug Ben pastes into the thread.
 *
 * ANONYMISATION is done at extraction, not at print time, so a leak has to be deliberate:
 * customers are reduced to a first name, phone numbers and postcodes are scrubbed from every
 * body, and the real quote slug is replaced by a synthetic one before anything is replayed.
 */
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import net from 'net';
import pg from 'pg';
import { detectCapitulation } from '../server/agents/draft-guards';

// Neon from this machine flaps between IPv4 and IPv6 reachability; mirror server/db.ts.
dns.setDefaultResultOrder('ipv4first');
if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(true);
if ((net as any).setDefaultAutoSelectFamilyAttemptTimeout) {
    (net as any).setDefaultAutoSelectFamilyAttemptTimeout(5000);
}

export const DUMP_PATH = path.resolve('whatsapp-export/wa-dump.json');
export const CACHE_PATH = path.resolve('.agent-backtest-cache.json');

export type Msg = { chatName: string; phone: string; ts: string; fromMe: boolean; type: string; body: string };

/** Digits-suffix matcher, same convention as DIGITS10 in server/agents/recovery.ts. */
export const D10 = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-10);

// ─────────────────────────────────────────────────────────────────────────── db

const QUOTES_SQL = `
    SELECT id, short_slug, customer_name, phone, base_price, selected_tier_price_pence,
           deposit_amount_pence, deposit_paid_at, view_count, viewed_at, last_viewed_at,
           created_at, expires_at, revoked_at, job_description, pricing_line_items,
           optional_extras, available_dates, survey_required, is_draft, segment
    FROM personalized_quotes WHERE created_at > '2026-01-01'`;
const INVOICES_SQL = `SELECT customer_phone, paid_at FROM invoices`;

/** Neon times out often from this machine. Retry patiently; cache so a drop is cheap. */
async function pull(url: string, name: string, q: string): Promise<any[]> {
    let last: any;
    for (let attempt = 1; attempt <= 8; attempt++) {
        const c = new pg.Client({
            connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000,
        });
        try {
            await c.connect();
            const rows = (await c.query(q)).rows;
            console.error(`[db] ${name}: ${rows.length} rows`);
            await c.end();
            return rows;
        } catch (e: any) {
            last = e;
            console.error(`[db] ${name} attempt ${attempt} failed: ${e.code || e.message}`);
            try { await c.end(); } catch { /* already gone */ }
            if (/column|relation|syntax/i.test(String(e.message))) throw e;
            await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
    }
    throw last;
}

interface CacheShape {
    quotes?: any[];
    invoices?: any[];
    decisionPoints?: DecisionPoint[];
    extractedAt?: string;
    /** Scored cases from the last run, so --report-only can re-print without spending anything. */
    results?: unknown[];
    ranAt?: string;
}

export function readCache(): CacheShape {
    try {
        return fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};
    } catch {
        return {};
    }
}
export function writeCache(patch: CacheShape): void {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ ...readCache(), ...patch }));
}

export async function loadOutcomes(refresh: boolean): Promise<{ quotes: any[]; invoices: any[] }> {
    const cache = readCache();
    if (!refresh && cache.quotes && cache.invoices) {
        return { quotes: cache.quotes, invoices: cache.invoices };
    }
    const url = process.env.DATABASE_URL!.replace('-pooler', '');
    const quotes = cache.quotes && !refresh ? cache.quotes : await pull(url, 'quotes', QUOTES_SQL);
    const invoices = cache.invoices && !refresh ? cache.invoices : await pull(url, 'invoices', INVOICES_SQL);
    writeCache({ quotes, invoices });
    return { quotes, invoices };
}

// ─────────────────────────────────────────────────────────────── anonymisation

const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;
const LONG_DIGITS = /\b(?:\+?\d[\d ()-]{8,})\b/g;
const QUOTE_URL = /https?:\/\/\S*?\/quote\/([a-z0-9]+)/gi;

/**
 * Everything that leaves this module has been through here. Postcodes and phone numbers are
 * removed rather than truncated: the agent does not need them to make the decision under test,
 * and a backtest report is a document that gets pasted around.
 */
export function scrub(body: string, slugMap: Map<string, string> = new Map()): string {
    return (body || '')
        .replace(QUOTE_URL, (_m, slug: string) => `https://handyservices.app/quote/${slugMap.get(slug) ?? 'xxxxxxxx'}`)
        .replace(UK_POSTCODE, '[postcode]')
        .replace(LONG_DIGITS, '[number]')
        .trim();
}

/** A first name, or a neutral label. Never a surname, never a phone number. */
export function firstNameOf(quoteName: string | null | undefined, fallbackIndex: number): string {
    const raw = String(quoteName ?? '').trim();
    const first = raw.split(/[\s,]+/)[0] ?? '';
    // A "name" that is really a number, an email or a company is no use and may be identifying.
    if (!first || /\d|@/.test(first) || first.length > 14) return `Customer ${fallbackIndex}`;
    return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────── conversation model

export interface CorpusConv {
    lid: string;
    digits: string;
    msgs: Msg[];
    slugs: string[];
    quotes: any[];
    kind: 'customer' | 'internal';
    bucket: 'PAID' | 'QUOTED-THEN-QUIET' | 'NO-QUOTE-BUT-ENGAGED' | 'DIED-BEFORE-QUOTE';
}

const CONTRACTOR_HINTS = /👷|handyman|plasterer|roofer|removals|guttering|electric|plumb|cleaner|klean|painter|scaffold|skip|supplier|outpost|cuz|joiner|locksmith|gardener|tiler/i;
const NOISE_TYPES = new Set(['e2e_notification', 'protocol', 'gp2', 'notification_template']);

export function assemble(dump: Msg[], quotes: any[], invoices: any[]): CorpusConv[] {
    const by: Record<string, Msg[]> = {};
    for (const m of dump) (by[m.phone] = by[m.phone] || []).push(m);
    for (const k in by) by[k].sort((a, b) => a.ts.localeCompare(b.ts));

    const qByPhone: Record<string, any[]> = {};
    const qBySlug: Record<string, any> = {};
    for (const q of quotes) {
        const k = D10(q.phone);
        if (k.length === 10) (qByPhone[k] = qByPhone[k] || []).push(q);
        if (q.short_slug) qBySlug[q.short_slug] = q;
    }
    const invByPhone: Record<string, any[]> = {};
    for (const i of invoices) {
        const k = D10(i.customer_phone);
        if (k.length === 10) (invByPhone[k] = invByPhone[k] || []).push(i);
    }

    return Object.entries(by).map(([lid, msgs]) => {
        const name = msgs[0].chatName || '';
        const looksNumeric = /^\+?[\d ()-]{9,}$/.test(name.trim());
        const digits = looksNumeric ? D10(name) : '';
        const slugs = [...new Set(msgs.flatMap((m) =>
            ((m.body || '').match(/quote\/([a-z0-9]+)/gi) || []).map((x) => x.split('/').pop()!)))];

        const quoteRows = [...new Map([
            ...(digits ? qByPhone[digits] || [] : []),
            ...slugs.map((s) => qBySlug[s]).filter(Boolean),
        ].map((q) => [q.id, q])).values()];
        const invs = digits ? invByPhone[digits] || [] : [];

        const internal = (!looksNumeric && !quoteRows.length) || CONTRACTOR_HINTS.test(name);
        const sent = quoteRows.filter((q) => !q.is_draft);
        const paid = sent.some((q) => q.deposit_paid_at) || invs.some((i) => i.paid_at);

        const bucket: CorpusConv['bucket'] = paid ? 'PAID'
            : sent.length ? 'QUOTED-THEN-QUIET'
                : msgs.length >= 6 ? 'NO-QUOTE-BUT-ENGAGED' : 'DIED-BEFORE-QUOTE';

        return { lid, digits, msgs, slugs, quotes: quoteRows, kind: internal ? 'internal' : 'customer', bucket };
    });
}

// ────────────────────────────────────────────────────────────── lever classes

/**
 * The four moves the analysis measured, plus the two non-moves. Ben's text and the agent's draft
 * go through the SAME classifier — a backtest that grades the machine on a different rubric than
 * the human is not a comparison.
 */
export type LeverClass = 'rescope' | 'hold_with_reason' | 'capitulate' | 'escalate' | 'voice_note' | 'no_reply' | 'other';

/**
 * Observed conversion, from the n=19 objection table. Directional, and labelled as such
 * everywhere it is used: it is what lets the backtest say "the agent did something BETTER than he
 * did", which is the only interesting direction given his commonest move is his worst.
 */
export const LEVER_RANK: Record<LeverClass, number> = {
    rescope: 3,          // 2 of 3 paid (67%)
    hold_with_reason: 2, // 2 of 6 paid (33%)
    capitulate: 1,       // 1 of 8 paid (13%)
    no_reply: 0,         // 0 of 1
    escalate: -1,        // no corpus analogue — counted separately, never ranked
    voice_note: -1,      // he answered by voice: a channel a text agent cannot use, so not graded
    other: -1,
};

/** Ranked classes only. Anything at -1 is a move the backtest refuses to pretend it can score. */
export const isRanked = (c: LeverClass) => LEVER_RANK[c] >= 0;

const RESCOPE = /\b(?:edit|amend|adjust|revise|re-?quote|change (?:it|the quote)|take (?:it|that|some|the|those) (?:out|off)|leave (?:that|it|those) (?:out|off)|remove (?:the|that|some)|split (?:it|the)|drop (?:the|that) (?:line|job|bit)|which (?:bits|parts|jobs|lines)|do (?:just|only) the|cut (?:it|the) (?:back|down))\b/i;
const INVITE = /\b(?:a few more quotes|other quotes|shop(?:ping)? around|happy to book you in|if you (?:do )?(?:choose to )?come back)\b/i;
const REASON = /\b(?:because|so that|which means|ensur\w+|2 people|two people|a full day|two days|not rushed|paramount|includes?|covers?|labour|materials|that is (?:our|the) price|this is the price|as low as we can go|we do have to|unfortunately|policy|up ?front|deposit)\b/i;
const ESCALATE = /\b(?:ask(?:ing)? ben|check(?:ing)? with (?:ben|the (?:team|office|boss)|my)|speak to (?:ben|the team)|get (?:ben|someone) to|i'?ll (?:find out|check)[^.?!\n]{0,20}(?:and )?(?:get|come) back|come back to you (?:on|about) (?:that|this|price)|give you a (?:quick )?(?:call|ring|bell)|ring you|call you|jump on a call)\b/i;
const RECONTACT = /\b(?:check back|come back to you|drop you a line|give you a shout|touch base|closer to the time|when (?:you'?re|things are) ready|let (?:us|me) know (?:when|once|how)|nearer the time)\b/i;
/**
 * The expiry lever (`expiry_is_not_a_weapon` in server/agents/objection-levers.ts): offering to
 * refresh a stale quote. It is a real move that keeps the offer alive, and a classifier blind to
 * it grades "no problem at all, I can get that refreshed for you whenever you're ready" as a
 * capitulation. The rule this file follows: every lever the agent is ISSUED must be recognisable
 * here, or the backtest punishes it for using the playbook we gave it.
 */
const REFRESH_OFFER = /\b(?:refresh(?:ed)?|re-?issue|update (?:the|your) quote|get (?:that|it) (?:refreshed|updated))\b/i;

/**
 * Classify a reply into the four levers. Order matters and is deliberate:
 *   1. re-scope wins over everything, because offering to change the quote IS the move whatever
 *      else the message says.
 *   2. escalate next: handing it to a human is a distinct decision, not a flavour of holding.
 *   3. hold-with-reason: a price restated with a justification, an invitation to compare, or a
 *      dated re-contact — anything that keeps the offer alive.
 *   4. capitulate LAST and only via the shipped guard (server/agents/draft-guards.ts), so the
 *      backtest and the tool agree on what the losing move is. Ben's best line in the whole
 *      corpus opens "No problem at all!", so a bare phrase match would misgrade it.
 */
export function classifyLever(text: string | null | undefined): LeverClass {
    const body = String(text ?? '').trim();
    if (!body) return 'no_reply';
    if (RESCOPE.test(body)) return 'rescope';
    if (ESCALATE.test(body)) return 'escalate';
    if (INVITE.test(body) || REASON.test(body) || RECONTACT.test(body) || REFRESH_OFFER.test(body)) return 'hold_with_reason';
    if (detectCapitulation(body)) return 'capitulate';
    return 'other';
}

/** The opening-move axis. A first reply is not a negotiation, so it is not scored like one. */
export type OpeningClass = 'ask_photo' | 'ask_postcode' | 'ask_other' | 'offer_call' | 'answer_direct' | 'escalate' | 'no_reply';

const ASK_PHOTO = /\b(?:photo|photos|picture|pictures|pic|pics|image|video|snap)\b/i;
const ASK_POSTCODE = /\bpost ?code\b/i;
const OFFER_CALL = /\b(?:give you a (?:quick )?(?:call|ring|bell)|call you|ring you|jump on a call|best number|phone you)\b/i;

export function classifyOpening(text: string | null | undefined): OpeningClass {
    const body = String(text ?? '').trim();
    if (!body) return 'no_reply';
    if (ASK_PHOTO.test(body)) return 'ask_photo';
    if (OFFER_CALL.test(body)) return 'offer_call';
    if (ASK_POSTCODE.test(body)) return 'ask_postcode';
    if (ESCALATE.test(body)) return 'escalate';
    if (/\?/.test(body)) return 'ask_other';
    return 'answer_direct';
}

// ────────────────────────────────────────────────────────── decision points

export type DecisionKind = 'price_objection' | 'first_reply' | 'timing_hold';

export interface ReplayMsg {
    fromMe: boolean;
    /** Milliseconds BEFORE the decision moment. 0 is the trigger message itself. */
    msBefore: number;
    body: string;
    type: string;
}

export interface DecisionQuote {
    /** Synthetic 8-char slug. The real one never leaves this module. */
    slug: string;
    totalPence: number;
    depositPence: number | null;
    jobDescription: string;
    lines: { description: string; pence: number }[];
    optionalExtras: { label: string; pricePence: number }[];
    availableDates: string[];
    viewCount: number;
    surveyRequired: boolean;
    /** How long before the decision moment the link went out, from the thread itself. */
    sentMsBefore: number;
}

export interface DecisionPoint {
    id: string;
    kind: DecisionKind;
    firstName: string;
    /** The thread as the agent will see it, oldest first, ending on the customer's trigger. */
    prefix: ReplayMsg[];
    triggerText: string;
    /** What Ben actually said next: his consecutive messages, up to three. */
    bensReply: string[];
    bensClass: LeverClass;
    bensOpening: OpeningClass;
    /**
     * TRUE when the "human" reply was really our own auto-composed copy — the first-contact
     * auto-ack or the quote-send template. It is still what the customer received, so it stays in
     * the ground truth, but it is NOT evidence of what a person chose to do, and the corpus work
     * is emphatic that the two must be scored apart: mixed together the human looks far more
     * corporate than he is. Every voice violation on record belongs to this side of the split.
     */
    bensReplyWasTemplate: boolean;
    /** Did this thread end in money? The only outcome we actually know. */
    converted: boolean;
    bucket: CorpusConv['bucket'];
    quote: DecisionQuote | null;
    /** Kept so a reader can find the thread again in the dump without it being in the report. */
    lid: string;
}

/** Post-quote pushback. Deliberately narrower than the corpus miner: this is money, not admin. */
const PRICE_OBJECTION = /\b(?:too (?:expensive|much|pricey|dear|high)|bit (?:much|steep|pricey|expensive|high)|quite (?:expensive|pricey|steep)|out of (?:my|our) (?:budget|price)|can'?t afford|more than (?:i|we) (?:thought|expected|wanted|hoped)|cheaper|discount|best price|knock (?:.{0,12})?(?:off|down)|budget is|any movement|come down|another quote|other quotes|shop around|someone else (?:quoted|said))\b/i;

/** "Not right now" — a scheduling state that an agent must not read as a rejection. */
const TIMING_HOLD = /\b(?:not (?:right now|until|for a (?:few|couple))|next month|next year|after (?:christmas|easter|the holidays|payday|pay day)|later in the|hold off|put(?:ting)? (?:it|this) off|postpone|too soon|wait(?:ing)? (?:until|for|till)|leave it (?:until|till|for)|come back to (?:you|this) (?:in|when|next)|on hold|park (?:it|this)|when we'?re back|away (?:until|till|next))\b/i;

/** Ben's own quote-send message pastes the link. This is what "a quote is out" means in a thread. */
const QUOTE_LINK = /\/quote\/([a-z0-9]+)/i;

const realOnly = (msgs: Msg[]) => msgs.filter((m) => !NOISE_TYPES.has(m.type));
const at = (m: Msg) => new Date(m.ts).getTime();

/**
 * His consecutive messages immediately after index i, capped so a whole day of logistics is not
 * "the reply".
 *
 * `voice` matters more than it looks. 65% of substantial threads carry a voice note from Ben, and
 * the corpus found they cluster at exactly these moments: objections, scoping, awkward news. A
 * text agent cannot reproduce that and should not be graded as though the human said nothing —
 * so a voice answer is recorded as its own class and left OUT of the agreement denominator.
 */
function nextBenBurst(msgs: Msg[], i: number, maxGapMs = 6 * 3600_000): { texts: string[]; voice: boolean } {
    const texts: string[] = [];
    let voice = false;
    let last = at(msgs[i]);
    for (let j = i + 1; j < msgs.length && texts.length < 3; j++) {
        const m = msgs[j];
        if (!m.fromMe) break;                 // the customer spoke again: his move is over
        if (at(m) - last > maxGapMs) break;   // a day later is a follow-up, not this decision
        if (m.type === 'ptt' || m.type === 'audio') voice = true;
        if (m.body && m.body.trim()) texts.push(m.body.trim());
        last = at(m);
    }
    return { texts, voice };
}

/** The class of a reply, honouring the channel: silence and a voice note are not the same event. */
function classifyReply(burst: { texts: string[]; voice: boolean }): LeverClass {
    if (burst.texts.length) return classifyLever(burst.texts.join('\n'));
    return burst.voice ? 'voice_note' : 'no_reply';
}

/**
 * Auto-composed copy, not typing: the contextual quote-send, the first-contact auto-ack, dispatch
 * and invoice links. Same test as `TEMPLATED` in scripts/_wa-corpus-analyse.ts, deliberately, so
 * the two analyses draw the human/machine line in exactly the same place.
 */
const TEMPLATED = /app\/quote\/|app\/dispatch|app\/invoice|Here'?s the link|Thanks for reaching out to Handy Services/i;
const wasTemplate = (texts: string[]) => texts.some((t) => TEMPLATED.test(t));

/** A slug we can safely put in a database that already holds the real one. Stable per point. */
function syntheticSlug(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return `bt${h.toString(36).padStart(6, '0').slice(-6)}`;
}

function quoteFor(conv: CorpusConv, slugInThread: string | null, decisionMs: number, sentMs: number): DecisionQuote | null {
    const candidates = conv.quotes.filter((q) => !q.is_draft && !q.revoked_at);
    const row = (slugInThread && candidates.find((q) => q.short_slug === slugInThread))
        // Fall back to the newest quote created before the decision — the one being argued about.
        ?? candidates
            .filter((q) => q.created_at && new Date(q.created_at).getTime() <= decisionMs + 3600_000)
            .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
    if (!row) return null;

    const totalPence = Number(row.selected_tier_price_pence || row.base_price || 0);
    if (!totalPence) return null;

    const rawLines: any[] = Array.isArray(row.pricing_line_items) ? row.pricing_line_items : [];
    const lines = rawLines.slice(0, 12).map((l) => {
        const pence = [l?.guardedPricePence, l?.materialsWithMarginPence, l?.structuralSharePence]
            .map(Number).filter((n) => Number.isFinite(n) && n !== 0).reduce((a, b) => a + b, 0)
            || Number(l?.pricePence ?? l?.llmSuggestedPricePence ?? 0);
        return {
            description: scrub(String(l?.description ?? l?.label ?? 'Line item')).slice(0, 160),
            pence: Math.round(pence) || 0,
        };
    }).filter((l) => l.description);

    const extrasRaw: any[] = Array.isArray(row.optional_extras) ? row.optional_extras : [];

    return {
        slug: syntheticSlug(`${conv.lid}:${row.short_slug}`),
        totalPence,
        depositPence: row.deposit_amount_pence ? Number(row.deposit_amount_pence) : null,
        jobDescription: scrub(String(row.job_description ?? '')).slice(0, 300),
        lines,
        optionalExtras: extrasRaw.slice(0, 6).map((e) => ({
            label: scrub(String(e?.label ?? '')).slice(0, 120),
            pricePence: Math.round(Number(e?.priceInPence ?? e?.pricePence ?? 0)) || 0,
        })).filter((e) => e.label),
        availableDates: (Array.isArray(row.available_dates) ? row.available_dates : []).slice(0, 6),
        viewCount: Number(row.view_count ?? 0),
        surveyRequired: !!row.survey_required,
        sentMsBefore: Math.max(0, decisionMs - sentMs),
    };
}

/**
 * How much thread to replay. Enough for the agent to know what the job is and what was said, not
 * so much that a 200-message thread blows the context and the budget on logistics it will never
 * see in production (get_thread itself reads the last 30).
 */
const MAX_PREFIX = 24;

function buildPrefix(msgs: Msg[], endIdx: number, slugMap: Map<string, string>): ReplayMsg[] {
    const start = Math.max(0, endIdx - (MAX_PREFIX - 1));
    const decisionMs = at(msgs[endIdx]);
    return msgs.slice(start, endIdx + 1)
        .map((m) => ({
            fromMe: m.fromMe,
            msBefore: Math.max(0, decisionMs - at(m)),
            body: scrub(m.body || '', slugMap) || (m.type === 'ptt' ? '[voice note]' : m.type === 'image' || m.type === 'album' ? '[photo]' : m.type === 'video' ? '[video]' : ''),
            type: m.type,
        }))
        .filter((m) => m.body);
}

export function extractDecisionPoints(convs: CorpusConv[]): DecisionPoint[] {
    const out: DecisionPoint[] = [];
    let anon = 0;

    for (const conv of convs) {
        if (conv.kind !== 'customer') continue;
        const msgs = realOnly(conv.msgs);
        if (msgs.length < 4) continue;

        anon++;
        const quoteName = conv.quotes.find((q) => q.customer_name)?.customer_name ?? null;
        const firstName = firstNameOf(quoteName, anon);

        // Map every real slug in this thread to its synthetic twin, once, so the URL the agent
        // reads and the quote row it loads agree.
        const slugMap = new Map<string, string>();
        for (const s of conv.slugs) slugMap.set(s, syntheticSlug(`${conv.lid}:${s}`));

        const qIdx = msgs.findIndex((m) => m.fromMe && QUOTE_LINK.test(m.body || ''));
        const slugInThread = qIdx >= 0 ? (msgs[qIdx].body.match(QUOTE_LINK)?.[1] ?? null) : null;

        for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            if (m.fromMe) continue;
            const body = (m.body || '').trim();

            // ---- 1. price objection, strictly after a quote link went out ----
            if (qIdx >= 0 && i > qIdx && body.length >= 8 && PRICE_OBJECTION.test(body)) {
                const reply = nextBenBurst(msgs, i);
                const q = quoteFor(conv, slugInThread, at(m), at(msgs[qIdx]));
                if (q) {
                    out.push({
                        id: `po_${conv.lid.slice(0, 8)}_${i}`,
                        kind: 'price_objection',
                        firstName,
                        prefix: buildPrefix(msgs, i, slugMap),
                        triggerText: scrub(body, slugMap),
                        bensReply: reply.texts.map((r) => scrub(r, slugMap)),
                        bensClass: classifyReply(reply),
                        bensOpening: classifyOpening(reply.texts.join('\n')),
                        bensReplyWasTemplate: wasTemplate(reply.texts),
                        converted: conv.bucket === 'PAID',
                        bucket: conv.bucket,
                        quote: { ...q, slug: slugMap.get(slugInThread ?? '') ?? q.slug },
                        lid: conv.lid,
                    });
                    // One objection per thread: the second is usually the same argument continuing.
                    break;
                }
            }
        }

        // ---- 2. timing hold: prefer the post-quote one, else any ----
        for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            if (m.fromMe) continue;
            const body = (m.body || '').trim();
            if (body.length < 12 || !TIMING_HOLD.test(body)) continue;
            if (PRICE_OBJECTION.test(body)) continue; // that is a price objection wearing a hat
            const reply = nextBenBurst(msgs, i);
            out.push({
                id: `th_${conv.lid.slice(0, 8)}_${i}`,
                kind: 'timing_hold',
                firstName,
                prefix: buildPrefix(msgs, i, slugMap),
                triggerText: scrub(body, slugMap),
                bensReply: reply.texts.map((r) => scrub(r, slugMap)),
                bensClass: classifyReply(reply),
                bensOpening: classifyOpening(reply.texts.join('\n')),
                bensReplyWasTemplate: wasTemplate(reply.texts),
                converted: conv.bucket === 'PAID',
                bucket: conv.bucket,
                quote: qIdx >= 0 && i > qIdx ? quoteFor(conv, slugInThread, at(m), at(msgs[qIdx])) : null,
                lid: conv.lid,
            });
            break;
        }

        // ---- 3. first reply to a new enquiry (customer opened the thread) ----
        // Ben initiates half of all threads; those are missed-call recovery, a different move.
        if (!msgs[0].fromMe) {
            // The customer's opening burst, which may be several messages before he answers.
            let i = 0;
            while (i + 1 < msgs.length && !msgs[i + 1].fromMe && i < 4) i++;
            const reply = nextBenBurst(msgs, i);
            const opening = (msgs[0].body || '').trim();
            if (reply.texts.length && opening.length >= 8) {
                out.push({
                    id: `fr_${conv.lid.slice(0, 8)}_${i}`,
                    kind: 'first_reply',
                    firstName,
                    prefix: buildPrefix(msgs, i, slugMap),
                    triggerText: scrub(opening, slugMap),
                    bensReply: reply.texts.map((r) => scrub(r, slugMap)),
                    bensClass: classifyReply(reply),
                    bensOpening: classifyOpening(reply.texts.join('\n')),
                    bensReplyWasTemplate: wasTemplate(reply.texts),
                    converted: conv.bucket === 'PAID',
                    bucket: conv.bucket,
                    quote: null,
                    lid: conv.lid,
                });
            }
        }
    }

    return out;
}

/**
 * Which points are worth spending a model call on, in order.
 *
 * Price objections first and always: they are the highest-value moment and the one where the
 * corpus says we can beat him.
 *
 * Then GRADABILITY before outcome, which is the one ordering decision worth arguing about. A
 * thread where he answered by voice note or said nothing is still a real moment — 43 of the 104
 * quiet quotes got no follow-up at all, and that silence is the follow-up agent's entire market —
 * but it cannot produce an agreement number, and agreement is the primary score. Spending the
 * budget on ungradable cases buys a report with one column full of dashes.
 */
export function rankForSpend(points: DecisionPoint[]): DecisionPoint[] {
    const kindRank: Record<DecisionKind, number> = { price_objection: 0, first_reply: 1, timing_hold: 2 };
    /**
     * Did he TYPE something? Silence is a gradable class (it is in the objection table, 1 thread,
     * 0 sales) and those cases stay in the run, but a point with his actual words in it is worth
     * more per model call: the side-by-side verbatim list is the artefact people tune the prompt
     * from, and half of it is blank without them.
     */
    const gradable = (p: DecisionPoint) => (p.bensReply.length ? 0 : 1);
    const known = (p: DecisionPoint) => (p.bucket === 'PAID' ? 0 : p.bucket === 'QUOTED-THEN-QUIET' ? 1 : 2);
    return [...points].sort((a, b) => {
        if (kindRank[a.kind] !== kindRank[b.kind]) return kindRank[a.kind] - kindRank[b.kind];
        if (gradable(a) !== gradable(b)) return gradable(a) - gradable(b);
        if (known(a) !== known(b)) return known(a) - known(b);
        return a.id.localeCompare(b.id);
    });
}

/**
 * A round-robin over the kinds so a --limit of 15 does not spend every call on price objections
 * and leave the other two moments unmeasured. Price objections still get the largest share.
 */
export function interleaveForSpend(points: DecisionPoint[], limit: number): DecisionPoint[] {
    const ranked = rankForSpend(points);
    const byKind: Record<DecisionKind, DecisionPoint[]> = { price_objection: [], first_reply: [], timing_hold: [] };
    for (const p of ranked) byKind[p.kind].push(p);
    // 3 price objections for every first reply and every timing hold.
    const pattern: DecisionKind[] = ['price_objection', 'price_objection', 'price_objection', 'first_reply', 'timing_hold'];
    const out: DecisionPoint[] = [];
    let i = 0;
    while (out.length < limit && (byKind.price_objection.length || byKind.first_reply.length || byKind.timing_hold.length)) {
        const kind = pattern[i++ % pattern.length];
        const next = byKind[kind].shift();
        if (next) out.push(next);
        else if (!byKind.price_objection.length && !byKind.first_reply.length && !byKind.timing_hold.length) break;
    }
    return out;
}

// ─────────────────────────────────────────────────────────────── voice checks

/**
 * Voice rules the shipped guards do NOT enforce, because they are style rather than safety. They
 * are checked here because the corpus measured every one of them on Ben's own typing, so we know
 * what "sounds like him" actually means rather than what we assumed it meant.
 */
export interface VoiceFinding { rule: string; detail: string }

const DEAD_LINES: [RegExp, string][] = [
    [/we'?ll price it up/i, '"We\'ll price it up" appears 0 times in 10,267 real messages'],
    [/not right\?? we come back and fix it free/i, 'a marketing line, 2 occurrences ever'],
    [/the price we quote is the price/i, '0 occurrences in the corpus'],
    [/\b(?:let me know when suits|ready when you are|shout when you'?re ready|whenever suits)\b/i, 'scheduling ping-pong, banned house rule (our templates broke it 64 times, he never did)'],
    [/\b(?:24\/7|same day guaranteed|unbeatable|100% )/i, 'availability lie or puffery'],
    [/\b(?:certified|gas safe|fully qualified)\b/i, 'a credential we do not hold'],
    [/\b(?:solutions|utilise|endeavour)\b/i, 'corporate filler'],
];

export function checkVoice(body: string): VoiceFinding[] {
    const out: VoiceFinding[] = [];
    const parts = body.split(/^\s*---\s*$/m).map((p) => p.trim()).filter(Boolean);

    if (/—|–/.test(body)) out.push({ rule: 'em_dash', detail: 'Ben typed 3 em dashes in 1,532 messages. Every violation on record is ours.' });
    if (/ - /.test(body)) out.push({ rule: 'hyphen_as_punctuation', detail: 'hyphen used as punctuation' });

    const questionMarks = (body.match(/\?/g) || []).length;
    if (questionMarks >= 2) out.push({ rule: 'two_questions', detail: `${questionMarks} question marks; 1% of his messages have two` });

    const longest = Math.max(0, ...parts.map((p) => p.length));
    if (longest > 400) out.push({ rule: 'wall_of_text', detail: `longest burst ${longest} chars; 2% of his messages exceed 400` });

    const emoji = (body.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
    if (emoji > 1) out.push({ rule: 'emoji_spam', detail: `${emoji} emoji; his pattern is at most one, at the end` });

    const bangs = (body.match(/!/g) || []).length;
    if (bangs > 1) out.push({ rule: 'exclamation_spam', detail: `${bangs} exclamation marks; at most one` });

    for (const [re, why] of DEAD_LINES) {
        const m = body.match(re);
        if (m) out.push({ rule: 'dead_line', detail: `"${m[0]}" — ${why}` });
    }
    return out;
}
