/**
 * _wa-corpus-analyse.ts — read-only analysis of the real 1:1 WhatsApp corpus.
 *
 * WHY THIS EXISTS
 * The `messages` / `conversations` tables are an automation log: 81% empty shells and a
 * 99.9%-phantom outbound side (see memory: project-messages-table-trap). The only honest
 * record of how this business actually talks to customers is Ben's personal WhatsApp,
 * exported to whatsapp-export/wa-dump.json. This script profiles that corpus, joins it to
 * business outcomes, and prints the numbers that back docs/WHATSAPP-CONVERSATION-ANALYSIS.md.
 *
 * TWO JOIN KEYS, AND WHY BOTH
 * 1. `phone` in the dump is a WhatsApp @lid (a privacy id), NOT a number. It joins to nothing.
 *    The real number lives in `chatName` for UNSAVED contacts, which is exactly the customer
 *    population (saved contacts are contractors and suppliers). We match its last 10 digits,
 *    the same DIGITS10 convention as server/agents/recovery.ts.
 * 2. Ben's quote-send message pastes the quote URL, so `short_slug` is a second, stronger key.
 *    It recovers conversations where the customer texted from a different number than the one
 *    on the quote. Where both keys fire they agree 144/155 of the time.
 *
 * USAGE
 *   npx tsx scripts/_wa-corpus-analyse.ts            # uses cache if present
 *   npx tsx scripts/_wa-corpus-analyse.ts --refresh  # re-pull from the DB
 *   npx tsx scripts/_wa-corpus-analyse.ts --dump-objections > /tmp/objections.txt
 *
 * READ-ONLY. It runs SELECTs and writes one JSON cache. It never writes to the database and
 * never sends anything.
 */
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import net from 'net';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Neon from this machine flaps between IPv4 and IPv6 reachability; mirror server/db.ts.
dns.setDefaultResultOrder('ipv4first');
if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(true);
if ((net as any).setDefaultAutoSelectFamilyAttemptTimeout) {
    (net as any).setDefaultAutoSelectFamilyAttemptTimeout(5000);
}

const DUMP = path.resolve('whatsapp-export/wa-dump.json');
const CACHE = path.resolve('.wa-corpus-cache.json'); // gitignored scratch; safe to delete
const REFRESH = process.argv.includes('--refresh');
const DUMP_OBJECTIONS = process.argv.includes('--dump-objections');

type Msg = { chatName: string; phone: string; ts: string; fromMe: boolean; type: string; body: string };

/** Digits-suffix matcher, same convention as DIGITS10 in server/agents/recovery.ts. */
const D10 = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-10);

const QUERIES: Record<string, string> = {
    quotes: `SELECT id, short_slug, customer_name, phone, base_price, selected_tier_price_pence,
                    deposit_paid_at, booked_at, viewed_at, view_count, last_viewed_at, created_at,
                    segment, job_description, created_by_name, deposit_amount_pence, is_draft
             FROM personalized_quotes WHERE created_at > '2026-01-01'`,
    invoices: `SELECT id, invoice_number, customer_phone, customer_name, total_amount, status,
                      paid_at, sent_at, created_at FROM invoices`,
    leads: `SELECT id, phone, customer_name, created_at, source, status, stage, job_description
            FROM leads WHERE created_at > '2026-01-01'`,
    bookings: `SELECT id, customer_phone, customer_name, created_at, status FROM contractor_booking_requests`,
};

/** Neon times out often from this machine. Retry patiently, cache per-table so a drop is cheap. */
async function loadDb(): Promise<Record<string, any[]>> {
    const cache: Record<string, any[]> = !REFRESH && fs.existsSync(CACHE)
        ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
    const url = process.env.DATABASE_URL!.replace('-pooler', '');
    for (const [name, q] of Object.entries(QUERIES)) {
        if (cache[name]) continue;
        for (let attempt = 1; attempt <= 8; attempt++) {
            const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });
            try {
                await c.connect();
                cache[name] = (await c.query(q)).rows;
                fs.writeFileSync(CACHE, JSON.stringify(cache));
                console.error(`[db] ${name}: ${cache[name].length} rows`);
                await c.end();
                break;
            } catch (e: any) {
                console.error(`[db] ${name} attempt ${attempt} failed: ${e.code || e.message}`);
                try { await c.end(); } catch { }
                if (/column|relation|syntax/i.test(e.message)) throw e;
                await new Promise(r => setTimeout(r, 3000 * attempt));
            }
        }
    }
    return cache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation assembly
// ─────────────────────────────────────────────────────────────────────────────

export type Conv = {
    id: string;              // the @lid
    name: string;            // chatName: a real number for unsaved contacts, a label for saved ones
    digits: string;          // 10-digit join key, '' when chatName is a saved label
    msgs: Msg[];
    slugs: string[];         // quote slugs pasted into the thread
    quotes: any[];
    leads: any[];
    invoices: any[];
    kind: 'customer' | 'internal';
    bucket: string;
    paidPence: number;
};

const CONTRACTOR_HINTS = /👷|handyman|plasterer|roofer|removals|guttering|electric|plumb|cleaner|klean|painter|scaffold|skip|supplier|outpost|cuz|joiner|locksmith|gardener|tiler/i;

function assemble(dump: Msg[], db: Record<string, any[]>): Conv[] {
    const by: Record<string, Msg[]> = {};
    for (const m of dump) (by[m.phone] = by[m.phone] || []).push(m);
    for (const k in by) by[k].sort((a, b) => a.ts.localeCompare(b.ts));

    const qByPhone: Record<string, any[]> = {}, qBySlug: Record<string, any> = {};
    for (const q of db.quotes) {
        const k = D10(q.phone);
        if (k.length === 10) (qByPhone[k] = qByPhone[k] || []).push(q);
        if (q.short_slug) qBySlug[q.short_slug] = q;
    }
    const idx = (rows: any[], col: string) => rows.reduce((a: Record<string, any[]>, r) => {
        const k = D10(r[col]); if (k.length === 10) (a[k] = a[k] || []).push(r); return a;
    }, {});
    const lByPhone = idx(db.leads, 'phone');
    const iByPhone = idx(db.invoices, 'customer_phone');

    return Object.entries(by).map(([id, msgs]) => {
        const name = msgs[0].chatName || '';
        const looksNumeric = /^\+?[\d ()-]{9,}$/.test(name.trim());
        const digits = looksNumeric ? D10(name) : '';
        const slugs = [...new Set(msgs.flatMap(m =>
            ((m.body || '').match(/quote\/([a-z0-9]+)/gi) || []).map(x => x.split('/').pop()!)))];

        const quotes = [...new Map([
            ...(digits ? qByPhone[digits] || [] : []),
            ...slugs.map(s => qBySlug[s]).filter(Boolean),
        ].map(q => [q.id, q])).values()];
        const leads = digits ? lByPhone[digits] || [] : [];
        const invoices = digits ? iByPhone[digits] || [] : [];

        // Internal = a saved contact that never appears as a lead/quote, or an obvious trade label.
        const internal = (!looksNumeric && !quotes.length && !leads.length) || CONTRACTOR_HINTS.test(name);

        const paidQuotes = quotes.filter(q => q.deposit_paid_at);
        const paidInv = invoices.filter(i => i.paid_at);
        const paidPence = paidQuotes.reduce((s, q) => s + (q.selected_tier_price_pence || q.base_price || 0), 0);

        let bucket: string;
        if (paidQuotes.length || paidInv.length) bucket = 'PAID';
        else if (quotes.filter(q => !q.is_draft).length) bucket = 'QUOTED-THEN-QUIET';
        else if (msgs.length >= 6) bucket = 'NO-QUOTE-BUT-ENGAGED';
        else bucket = 'DIED-BEFORE-QUOTE';

        return { id, name, digits, msgs, slugs, quotes, leads, invoices, kind: internal ? 'internal' : 'customer', bucket, paidPence } as Conv;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow profiling
// ─────────────────────────────────────────────────────────────────────────────

const MIN = 60000;
const t = (m: Msg) => new Date(m.ts).getTime();
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pct = (n: number, d: number) => d ? `${((n / d) * 100).toFixed(0)}%` : '-';

/** Ben's stock re-engagement opener after a missed inbound phone call. */
const MISSED_CALL_OPENER = /missed your call|still interested in a quote/i;
const ASKS = {
    photo: /photo|picture|pic\b|image|send.*(photo|pic)|video/i,
    postcode: /post ?code|postcode/i,
    name: /your name|forgot to get your name|who am i speaking/i,
    access: /access|key|keys|be in|at home|parking/i,
    measurements: /measure|size|dimensions|how (big|wide|tall|many)/i,
};

export function profile(convs: Conv[]) {
    const deep = convs.filter(c => c.kind === 'customer' && c.msgs.length >= 6);
    const out: any = { nDeep: deep.length };

    let benFirst = 0, missedCall = 0;
    const benFirstReply: number[] = [], custFirstReply: number[] = [];
    const turnsToQuote: number[] = [], minsToQuote: number[] = [];
    const askTurn: Record<string, number[]> = { photo: [], postcode: [], name: [], access: [], measurements: [] };
    const askAny: Record<string, number> = { photo: 0, postcode: 0, name: 0, access: 0, measurements: 0 };
    let hasVoiceNote = 0, hasCustomerPhoto = 0;

    for (const c of deep) {
        const real = c.msgs.filter(m => m.type !== 'e2e_notification' && m.type !== 'protocol');
        if (!real.length) continue;
        if (real[0].fromMe) benFirst++;
        if (real[0].fromMe && MISSED_CALL_OPENER.test(real[0].body || '')) missedCall++;

        // first response latency in each direction
        for (let i = 1; i < real.length; i++) {
            if (real[i].fromMe !== real[i - 1].fromMe) {
                const gap = (t(real[i]) - t(real[i - 1])) / MIN;
                (real[i].fromMe ? benFirstReply : custFirstReply).push(gap);
                break;
            }
        }
        const qIdx = real.findIndex(m => /handyservices\.app\/quote\//i.test(m.body || ''));
        if (qIdx > 0) {
            let turns = 0;
            for (let i = 1; i <= qIdx; i++) if (real[i].fromMe !== real[i - 1].fromMe) turns++;
            turnsToQuote.push(turns);
            minsToQuote.push((t(real[qIdx]) - t(real[0])) / MIN);
        }
        for (const [k, re] of Object.entries(ASKS)) {
            const i = real.findIndex(m => m.fromMe && re.test(m.body || ''));
            if (i >= 0) { askAny[k]++; askTurn[k].push(i); }
        }
        if (real.some(m => m.fromMe && m.type === 'ptt')) hasVoiceNote++;
        if (real.some(m => !m.fromMe && (m.type === 'image' || m.type === 'album' || m.type === 'video'))) hasCustomerPhoto++;
    }

    out.benSpeaksFirst = `${benFirst}/${deep.length} (${pct(benFirst, deep.length)})`;
    out.missedCallOpener = `${missedCall}/${deep.length} (${pct(missedCall, deep.length)})`;
    out.benMedianReplyMins = median(benFirstReply).toFixed(0);
    out.custMedianReplyMins = median(custFirstReply).toFixed(0);
    out.medianTurnsToQuote = median(turnsToQuote);
    out.medianMinsFirstMsgToQuote = median(minsToQuote).toFixed(0);
    out.quotesSentInThread = turnsToQuote.length;
    out.asks = Object.fromEntries(Object.entries(askAny).map(([k, v]) => [k, `${v}/${deep.length} (${pct(v, deep.length)}), median msg-index ${median(askTurn[k])}`]));
    out.benSentVoiceNote = `${hasVoiceNote}/${deep.length} (${pct(hasVoiceNote, deep.length)})`;
    out.customerSentMedia = `${hasCustomerPhoto}/${deep.length} (${pct(hasCustomerPhoto, deep.length)})`;
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome comparison: PAID vs QUOTED-THEN-QUIET
// ─────────────────────────────────────────────────────────────────────────────

const real = (c: Conv) => c.msgs.filter(m => m.type !== 'e2e_notification' && m.type !== 'protocol');
const quoteIdx = (r: Msg[]) => r.findIndex(m => /app\/quote\//i.test(m.body || ''));

/**
 * PRE-QUOTE PHASE ONLY.
 * Comparing whole threads is worthless: a PAID thread keeps going for days of ETAs, addresses
 * and completion photos, so every "PAID does more of X" is really "paying generates logistics".
 * Everything here is measured strictly before the quote link, where the two groups are still
 * comparable and where a triage agent would actually be operating.
 */
export function compare(convs: Conv[]) {
    const pick = (b: string) => convs.filter(c => c.kind === 'customer' && c.bucket === b && c.slugs.length > 0);
    const groups = { PAID: pick('PAID'), QUIET: pick('QUOTED-THEN-QUIET') };
    const rows: any[] = [];
    for (const [label, cs] of Object.entries(groups)) {
        const benLat: number[] = [], custLat: number[] = [], preMsgs: number[] = [], hrs: number[] = [], custWords: number[] = [];
        let voice = 0, media = 0, calls = 0;
        for (const c of cs) {
            const r = real(c);
            const qi = quoteIdx(r);
            if (qi < 0) continue;
            const A = r.slice(0, qi + 1);
            preMsgs.push(A.length);
            hrs.push((t(r[qi]) - t(r[0])) / MIN / 60);
            for (let i = 1; i < A.length; i++) {
                if (A[i].fromMe !== A[i - 1].fromMe) (A[i].fromMe ? benLat : custLat).push((t(A[i]) - t(A[i - 1])) / MIN);
            }
            if (A.some(m => m.fromMe && m.type === 'ptt')) voice++;
            if (A.some(m => !m.fromMe && ['image', 'album', 'video'].includes(m.type))) media++;
            if (A.some(m => m.fromMe && CALL_OFFER.test(m.body || ''))) calls++;
            custWords.push(A.filter(m => !m.fromMe && m.body).reduce((s, m) => s + m.body.split(/\s+/).length, 0));
        }
        rows.push({
            group: label, n: preMsgs.length,
            preQuoteMsgs: median(preMsgs),
            medBenReplyMins: +median(benLat).toFixed(1),
            medCustReplyMins: +median(custLat).toFixed(1),
            medHrsToQuote: +median(hrs).toFixed(1),
            custWordsPreQuote: median(custWords),
            benVoiceNotePre: `${voice}/${preMsgs.length}`,
            custSentMediaPre: `${media}/${preMsgs.length}`,
            benOfferedCallPre: `${calls}/${preMsgs.length}`,
        });
    }
    return rows;
}

const CALL_OFFER = /quick call|give you a (quick )?call|call you|ring you|free for a call|call me|phone you/i;

/**
 * CONFOUND GUARD. Voice notes and "shall I give you a call" both look like huge conversion
 * levers on raw counts (47% vs 26%, 79% vs 32%). Both effects are almost entirely thread
 * length: long threads accumulate every behaviour AND are long because the job went ahead.
 * Stratifying by message count, and restricting to the pre-quote phase, collapses both.
 * Any future "lever" should be run through this before anyone builds on it.
 */
export function stratify(convs: Conv[], label: string, has: (c: Conv) => boolean) {
    const cs = convs.filter(c => c.kind === 'customer' && c.slugs.length > 0);
    const bands: [number, number, string][] = [[0, 20, '<20 msgs'], [20, 40, '20-39'], [40, 1e9, '40+']];
    const rows = bands.map(([lo, hi, name]) => {
        const inBand = cs.filter(c => c.msgs.length >= lo && c.msgs.length < hi);
        const withF = inBand.filter(has), without = inBand.filter(c => !has(c));
        const rate = (g: Conv[]) => g.length ? `${g.filter(c => c.bucket === 'PAID').length}/${g.length} (${pct(g.filter(c => c.bucket === 'PAID').length, g.length)})` : '-';
        return { lever: label, band: name, with: rate(withF), without: rate(without) };
    });
    return rows;
}

/** Conversion by quote value. The one discriminator that survives every control. */
export function priceBands(convs: Conv[]) {
    const bands: [number, number, string][] = [
        [0, 10000, '<£100'], [10000, 20000, '£100-200'], [20000, 35000, '£200-350'],
        [35000, 60000, '£350-600'], [60000, 100000, '£600-1000'], [100000, 1e9, '£1000+'],
    ];
    const tally = bands.map(([, , label]) => ({ band: label, paid: 0, unpaid: 0 }));
    for (const c of convs.filter(c => c.kind === 'customer' && ['PAID', 'QUOTED-THEN-QUIET'].includes(c.bucket))) {
        for (const q of c.quotes.filter(q => !q.is_draft)) {
            const v = q.selected_tier_price_pence || q.base_price || 0;
            if (!v) continue;
            const i = bands.findIndex(([lo, hi]) => v >= lo && v < hi);
            if (i >= 0) tally[i][q.deposit_paid_at ? 'paid' : 'unpaid']++;
        }
    }
    return tally.map(r => ({ ...r, rate: pct(r.paid, r.paid + r.unpaid) }));
}

/** What the follow-up agent is actually for: quotes read repeatedly and never bought. */
export function quietQuoteEngagement(convs: Conv[]) {
    const quiet = convs.filter(c => c.kind === 'customer' && c.bucket === 'QUOTED-THEN-QUIET');
    let neverOpened = 0, viewed3plus = 0, benSilentAfterLink = 0, pence = 0;
    for (const c of quiet) {
        const qs = c.quotes.filter(q => !q.is_draft);
        if (!qs.length) continue;
        const q = qs.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
        pence += q.selected_tier_price_pence || q.base_price || 0;
        if (!q.viewed_at && !q.view_count) neverOpened++;
        if ((q.view_count || 0) >= 3) viewed3plus++;
        const r = real(c);
        const qi = quoteIdx(r);
        if (qi >= 0 && !r.slice(qi + 1).some(m => m.fromMe)) benSilentAfterLink++;
    }
    return { n: quiet.length, neverOpened, viewed3plus, benSilentAfterLink, unrealisedGBP: (pence / 100).toFixed(0) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Objection mining
// ─────────────────────────────────────────────────────────────────────────────

export const OBJECTION_PATTERNS: Record<string, RegExp> = {
    price_too_high: /too (expensive|much|pricey)|bit (much|steep|pricey)|dear|out of (my|our) (budget|price)|can'?t afford|more than (i|we) (thought|expected|wanted)|pricey|expensive/i,
    ask_discount: /do it (for|cheaper)|any (discount|better price|movement)|best price|cheaper|knock.*(off|down)|meet.*half|budget is|reduce the price|£\d+ ?\?/i,
    shop_around: /shop around|other quotes|another quote|someone else|compare|cheaper elsewhere|got a quote from/i,
    think_about_it: /think about it|have a think|get back to you|discuss (it )?with|speak to my (husband|wife|partner)|let you know|sleep on it/i,
    timing: /not (right now|urgent|until)|next month|later in the|hold off|postpone|too soon|wait(ing)? (until|for)/i,
    scope_confusion: /hourly rate|per hour|how long will it take|why (is it|so much)|what does that (include|cover)|does that include|breakdown/i,
    payment_terms: /pay (cash|on the day|when|after)|deposit|up front|upfront|invoice/i,
};

export function mineObjections(convs: Conv[]) {
    const found: any[] = [];
    for (const c of convs.filter(c => c.kind === 'customer')) {
        const r = c.msgs.filter(m => m.type !== 'e2e_notification');
        const qi = r.findIndex(m => /app\/quote\//i.test(m.body || ''));
        for (let i = 0; i < r.length; i++) {
            const m = r[i];
            if (m.fromMe || !m.body || m.body.length < 4) continue;
            for (const [kind, re] of Object.entries(OBJECTION_PATTERNS)) {
                if (!re.test(m.body)) continue;
                const replies = r.slice(i + 1).filter(x => x.fromMe && x.body).slice(0, 3).map(x => x.body);
                found.push({
                    conv: c.id, name: c.name, kind, bucket: c.bucket,
                    afterQuote: qi >= 0 && i > qi,
                    customer: m.body, benReplies: replies,
                    converted: c.bucket === 'PAID',
                });
                break;
            }
        }
    }
    return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice metrics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-composed messages: the contextual quote-send, the first-contact auto-ack, dispatch and
 * invoice links. These must be scored SEPARATELY from Ben's own typing — they are generated
 * copy, and mixing them in makes the human voice look far more corporate than it is.
 */
const TEMPLATED = /app\/quote\/|app\/dispatch|app\/invoice|Here'?s the link|Thanks for reaching out to Handy Services/i;

export function voice(convs: Conv[], mode: 'hand' | 'template' = 'hand') {
    const ben = convs.filter(c => c.kind === 'customer').flatMap(c => c.msgs)
        .filter(m => m.fromMe && m.type === 'chat' && m.body)
        .filter(m => mode === 'hand' ? !TEMPLATED.test(m.body) : TEMPLATED.test(m.body));
    const n = ben.length;
    const has = (re: RegExp) => ben.filter(m => re.test(m.body)).length;
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const lens = ben.map(m => m.body.length);
    const words = ben.map(m => m.body.trim().split(/\s+/).length);
    return {
        mode, benChatMessages: n,
        medianChars: median(lens), meanChars: +(lens.reduce((a, b) => a + b, 0) / n).toFixed(0),
        medianWords: median(words),
        over400chars: `${lens.filter(l => l > 400).length} (${pct(lens.filter(l => l > 400).length, n)})`,
        emDash: `${has(/—/)} (${pct(has(/—/), n)})`,
        hyphenAsPunct: `${has(/ - /)} (${pct(has(/ - /), n)})`,
        signOffThanksBen: `${has(/Thanks\s*\n?\s*Ben\s*$/i)} (${pct(has(/Thanks\s*\n?\s*Ben\s*$/i), n)})`,
        anySignOff: `${has(/\n\s*(Thanks|Cheers|Regards|Ben)\s*$/i)} (${pct(has(/\n\s*(Thanks|Cheers|Regards|Ben)\s*$/i), n)})`,
        greetingHi: `${has(/^(hi|hey|hello)\b/i)} (${pct(has(/^(hi|hey|hello)\b/i), n)})`,
        exclamation: `${has(/!/)} (${pct(has(/!/), n)})`,
        emoji: `${has(emoji)} (${pct(has(emoji), n)})`,
        multiQuestion: `${ben.filter(m => (m.body.match(/\?/g) || []).length >= 2).length} (${pct(ben.filter(m => (m.body.match(/\?/g) || []).length >= 2).length, n)})`,
        blankLineBlocks: `${has(/\n\s*\n/)} (${pct(has(/\n\s*\n/), n)})`,
        contractions: `${has(/\b(i'?ll|we'?ll|it'?s|that'?s|don'?t|can'?t|you'?re|we'?ve|i'?ve)\b/i)} (${pct(has(/\b(i'?ll|we'?ll|it'?s|that'?s|don'?t|can'?t|you'?re|we'?ve|i'?ve)\b/i), n)})`,
        bannedWordHits: Object.fromEntries(['sorted', 'proper', 'price it up', 'pop round', 'fixed price', 'no worries', 'no problem', 'perfect']
            .map(w => [w, has(new RegExp(w.replace(/ /g, '\\s+'), 'i'))])),
        askedForFullAddress: `${has(/full address|what'?s the address|address please/i)}`,
    };
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const dump: Msg[] = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
    const db = await loadDb();
    const convs = assemble(dump, db);
    const cust = convs.filter(c => c.kind === 'customer');

    if (DUMP_OBJECTIONS) {
        for (const o of mineObjections(convs)) {
            console.log(`\n### ${o.kind} | ${o.bucket} | afterQuote=${o.afterQuote} | ${o.name}`);
            console.log(`CUST: ${o.customer}`);
            o.benReplies.forEach((r: string, i: number) => console.log(`BEN${i}: ${r}`));
        }
        return;
    }

    const buckets: Record<string, { n: number; pence: number }> = {};
    for (const c of cust) {
        const b = (buckets[c.bucket] = buckets[c.bucket] || { n: 0, pence: 0 });
        b.n++; b.pence += c.paidPence;
    }

    console.log('=== CORPUS ===');
    console.log({ messages: dump.length, conversations: convs.length, customer: cust.length, internal: convs.length - cust.length,
        window: [dump.reduce((a, m) => m.ts < a ? m.ts : a, dump[0].ts), dump.reduce((a, m) => m.ts > a ? m.ts : a, dump[0].ts)] });
    console.log('\n=== OUTCOME BUCKETS (customer conversations) ===');
    console.table(Object.entries(buckets).map(([k, v]) => ({ bucket: k, n: v.n, gbp: (v.pence / 100).toFixed(2) })));
    console.log('\n=== FLOW PROFILE (customer, 6+ messages) ===');
    console.log(profile(convs));
    console.log('\n=== QUOTED-THEN-QUIET: what the follow-up agent is for ===');
    console.log(quietQuoteEngagement(convs));
    console.log('\n=== PAID vs QUOTED-THEN-QUIET (pre-quote phase only) ===');
    console.table(compare(convs));
    console.log('\n=== CONVERSION BY QUOTE VALUE ===');
    console.table(priceBands(convs));
    console.log('\n=== CONFOUND GUARD: candidate levers, stratified by thread length ===');
    console.table([
        ...stratify(convs, 'Ben sent a voice note', c => c.msgs.some(m => m.fromMe && m.type === 'ptt')),
        ...stratify(convs, 'Ben offered a call', c => c.msgs.some(m => m.fromMe && CALL_OFFER.test(m.body || ''))),
        ...stratify(convs, 'quote amended (2+ versions)', c => c.slugs.length > 1),
    ]);
    console.log('\n=== OBJECTIONS ===');
    const obj = mineObjections(convs);
    const byKind: Record<string, { n: number; converted: number }> = {};
    for (const o of obj) { const k = (byKind[o.kind] = byKind[o.kind] || { n: 0, converted: 0 }); k.n++; if (o.converted) k.converted++; }
    console.table(Object.entries(byKind).map(([k, v]) => ({ objection: k, instances: v.n, inPaidConvs: v.converted })));
    console.log('\n=== VOICE (Ben, customer threads only) ===');
    console.log(voice(convs, 'hand'));
    console.log(voice(convs, 'template'));
}

if (process.argv[1] && process.argv[1].endsWith('_wa-corpus-analyse.ts')) {
    main().catch(e => { console.error(e); process.exit(1); });
}
