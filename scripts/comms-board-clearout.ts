/**
 * BULK BOARD CLEAR-OUT — decide who is worth contacting, message them appropriately, clear the board.
 *
 * The board has accumulated years of history and is now unreadable as a work queue. This tool reads
 * every live card, sorts it into a segment, sends at most one message to the people worth
 * contacting, and archives everything so tomorrow's board is only tomorrow's work.
 *
 * ─── THE THREE RULES THAT MATTER ───────────────────────────────────────────────────────────────
 *
 * 1. NOTHING IS EVER DELETED. "Clear the board" is implemented as ARCHIVE: `archived_at` is set and
 *    the stage becomes 'closed'. The conversation and every message stay exactly where they are.
 *    Customer communication history is a business record (it is the evidence behind an invoice, a
 *    dispute, a complaint) and a bulk tool is the single worst place to destroy one. `--restore`
 *    puts back everything a run archived, so this is reversible in both directions.
 *
 * 2. DRY RUN IS THE DEFAULT. Sending requires the explicit `--send` flag. The dry run prints the
 *    exact words each segment would receive, because that summary is the thing a human actually
 *    reviews, and a plan you cannot read is a plan you cannot approve.
 *
 * 3. THE UNIT OF WORK IS A PERSON, NOT A CARD. The board carries the same human under several phone
 *    formats: "+44 7938 658185", "07938 658185" and "447938658185@c.us" are three cards and one
 *    customer. Every decision here is keyed on a normalized national number, so that customer gets
 *    one message and all three of their cards get archived. Deduping on conversation_id would have
 *    texted them three times.
 *
 * ─── SEGMENTS (the judgement this tool exists for) ─────────────────────────────────────────────
 *
 *   spam_dead        junk, vendors, test rows, non-UK, unusable numbers, already-closed threads.
 *                    ARCHIVED SILENTLY, never messaged. This is most of the mess.
 *   past_customer    a deposit was paid. Strongest relationship, warmest words, and the safest
 *                    ground legally (PECR soft opt-in covers marketing to your own customers).
 *   quoted_unpaid    a quote exists and was never paid. Highest value in the room: the message
 *                    points back at the quote that is still live.
 *   enquired         they wrote to us and never got a quote. Revival, with an opt-out.
 *   call_only        they only ever rang. Often not on WhatsApp at all, so SMS does the work.
 *
 * ─── CHANNEL ───────────────────────────────────────────────────────────────────────────────────
 *
 * Whatever actually reaches them. WhatsApp inside the 24h window is freeform and free; outside it,
 * only a Meta-APPROVED template may be sent, looked up BY NAME at runtime (never a hardcoded SID —
 * approval status is Meta's to change, and a template that was approved last week can be rejected
 * this week). UK landlines skip WhatsApp entirely, and a WhatsApp failure falls back to SMS. All of
 * that already exists in `sendCustomerMessage`, so this reuses it rather than reinventing it.
 *
 * Non-UK numbers are never messaged. Anyone who ever sent STOP is excluded entirely.
 *
 * ─── PACING ────────────────────────────────────────────────────────────────────────────────────
 *
 * This shares a WhatsApp sender with Ben's day job. Bulk templates to cold contacts are exactly what
 * earns blocks and reports, and those degrade the number's quality rating for everyone. Hence a
 * small default cap, a delay between sends, and a kill switch checked before every single message.
 *
 *   npx tsx scripts/comms-board-clearout.ts                          # dry run over the whole board
 *   npx tsx scripts/comms-board-clearout.ts --segment quoted_unpaid  # one segment
 *   npx tsx scripts/comms-board-clearout.ts --send --limit 25        # actually send, capped
 *   npx tsx scripts/comms-board-clearout.ts --archive-only --send    # clear the board, message nobody
 *   npx tsx scripts/comms-board-clearout.ts --restore                # undo the archiving
 *   npx tsx scripts/comms-board-clearout.ts --only-test-numbers --send   # rehearse: Ofcom/owner only
 *
 * Kill switch: `CLEAROUT_KILL=1` in the environment, or app_settings key `board_clearout`
 * = {"killSwitch": true}. Checked between sends, so it stops a run already in flight.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { sendCustomerMessage } from '../server/outbound';
import { findApprovedTemplate } from '../server/whatsapp-templates';
import { commsPhoneKey } from '../server/phone-utils';
import { loadOptOutIndex } from '../server/opt-out';

const CAMPAIGN = process.env.CLEAROUT_CAMPAIGN || 'board_clearout_2026_08';
const QUOTE_BASE = process.env.BASE_URL || 'https://handyservices.app';

type Segment = 'spam_dead' | 'past_customer' | 'quoted_unpaid' | 'enquired' | 'call_only';
const SEGMENTS: Segment[] = ['spam_dead', 'past_customer', 'quoted_unpaid', 'enquired', 'call_only'];

/** Numbers it is always safe to send to during testing: Ofcom's drama range, and the owner. */
const TEST_SAFE = [/^7700900\d{3}$/, /^84357691573$/];

// ── Phone normalization ────────────────────────────────────────────────────────────────────────
//
// The board's phone_number column is a museum of formats: E.164, national, WhatsApp keys, and
// several wrapped in invisible Unicode direction marks (U+202A…U+202E) that came in with copied
// contact cards. Every one of those has to collapse to the same key or the same person gets
// messaged more than once.

type PhoneClass = 'uk_mobile' | 'uk_landline' | 'non_uk' | 'unusable';

// Lifted verbatim into server/phone-utils.ts as commsPhoneKey and imported back, so the suppression
// list and this tool key on EXACTLY the same identity. If they ever disagreed, someone who replied
// STOP from one number format would be messaged again under another.
const phoneKey = commsPhoneKey;

function classify(key: string | null): PhoneClass {
    if (!key) return 'unusable';
    if (key.length === 10 && key.startsWith('7')) return 'uk_mobile';
    if (key.length === 10 && /^[123]/.test(key)) return 'uk_landline';
    return 'non_uk';
}

/** UK numbers are stored nationally; everything else keeps whatever it had. */
function toE164(key: string, cls: PhoneClass): string {
    return cls === 'uk_mobile' || cls === 'uk_landline' ? `+44${key}` : `+${key}`;
}

const isTestSafe = (key: string) => TEST_SAFE.some((re) => re.test(key));

/**
 * A Postgres text[] literal. The driver binds a JS array as a lone parameter, which Postgres then
 * tries to read as an array literal and rejects ("malformed array literal"), so the literal has to
 * be built here and cast explicitly. Quotes and backslashes are escaped because these are ids from
 * the database, and building SQL by concatenation without escaping is how injection happens.
 */
const pgTextArray = (values: string[]) =>
    `{${values.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;

/**
 * Ofcom's drama range and the owner's own number are excluded as test data in a normal run, which
 * is right: nobody wants a bulk campaign firing at 07700 900xxx. But that same exclusion makes the
 * send path impossible to exercise without aiming at a real customer, which is far worse.
 *
 * So this flag inverts the run: it restricts it to ONLY those numbers. That is safer than merely
 * re-admitting them, because it cannot select a member of the public even by accident, and it is
 * the only way to rehearse a multi-message batch (pacing, the kill switch) before a real one.
 */
let onlyTestNumbers = false;

// ── Copy ───────────────────────────────────────────────────────────────────────────────────────
//
// Voice rules (brand-voice/whatsapp-comms.md): no em dashes, no hyphens as punctuation, never ask
// for a full address, no sign-offs, sounds like a person texting. Kept to one short paragraph
// deliberately: sendWhatsAppMessage does not split '---' bursts, so multi-burst copy would arrive
// with the separators showing.

/**
 * A placeholder is worse than no name at all, because it blocks the real one. 752 of these cards
 * are labelled "Unknown Caller" or "Website Visitor" by the ingest, and many of those people have a
 * perfectly good name sitting on their quote. Recognising a placeholder as empty is what lets the
 * quote name win, and it is the difference between "Hi there" and "Hi Steph" on 900 messages.
 */
const isPlaceholderName = (n: string): boolean =>
    !n || /@|^\+?\d[\d\s]*$/.test(n) || /unknown|website visitor|no name|caller|customer$/i.test(n);

const firstName = (name: string | null | undefined): string => {
    const n = (name ?? '').trim();
    if (isPlaceholderName(n)) return 'there';
    return n.split(/\s+/)[0];
};

/**
 * Past customers are the one segment with no template that fits. Every approved MARKETING template
 * is written for someone who never got an answer or never paid, and telling a paying customer "you
 * never heard anything back" is both false and insulting. So this segment gets freeform words
 * instead, which SMS carries with no template gate at all, and which PECR soft opt-in permits
 * precisely because they are an existing customer. The opt-out is included because the law wants it
 * in every marketing message, not only the ones where a template forced our hand.
 */
const pastCustomerCopy = (name: string | null) =>
    `Hi ${firstName(name)}, it's Handy Services. Thanks again for having us out. We are still here if anything else needs doing at yours, just reply and we will get you a fixed price. Reply STOP to opt out.`;

// ── Planning ───────────────────────────────────────────────────────────────────────────────────

interface Person {
    key: string;
    cls: PhoneClass;
    e164: string;
    name: string | null;
    conversationIds: string[];
    phoneFormats: string[];
    stages: string[];
    tags: string[];
    msgs: number;
    calls: number;
    windowOpen: boolean;
    lastContact: Date | null;
    paidQuote: any | null;
    openQuote: any | null;
    optedOut: boolean;
}

interface Plan {
    person: Person;
    segment: Segment;
    /** null = archive only, never message. */
    channel: 'whatsapp' | 'sms' | null;
    templateName: string | null;
    body: string | null;
    /** Why this person is not being messaged, when they are not. */
    hold: string | null;
}

const DEAD_TAGS = new Set([
    'spam', 'spam_or_misdial', 'test_data', 'not_a_customer', 'vendor_outreach', 'vendor_pitch',
    'domain_offer_not_customer', 'no_genuine_enquiry', 'not_a_job_enquiry', 'dead_thread',
    'unqualified_lead', 'no_service_request', 'job_already_completed', 'job_completed',
]);

function segmentOf(p: Person): { segment: Segment; deadReason?: string } {
    // Dead first, and generously: a false positive here costs a card on the board, a false negative
    // costs a marketing message sent to a stranger or a bot.
    if (p.optedOut) return { segment: 'spam_dead', deadReason: 'opted out' };
    if (p.cls === 'non_uk') return { segment: 'spam_dead', deadReason: 'non-UK number' };
    if (p.cls === 'unusable') return { segment: 'spam_dead', deadReason: 'unusable number' };
    if (isTestSafe(p.key) && !onlyTestNumbers) return { segment: 'spam_dead', deadReason: 'test data' };
    if (!isTestSafe(p.key) && /\b(test|qa|dummy|demo|phase|smoke)\b/i.test(p.name ?? '')) {
        return { segment: 'spam_dead', deadReason: 'test data' };
    }
    if (p.tags.some((t) => DEAD_TAGS.has(t))) return { segment: 'spam_dead', deadReason: 'tagged dead/spam' };

    // A paid deposit outranks everything else: they are a customer, whatever else the thread says.
    if (p.paidQuote) return { segment: 'past_customer' };
    if (p.openQuote) return { segment: 'quoted_unpaid' };

    // Closed threads with no commercial history are backlog the agent already judged dead.
    if (p.stages.every((s) => s === 'closed')) return { segment: 'spam_dead', deadReason: 'already closed' };
    // Nothing ever happened on this card at all.
    if (p.msgs === 0) return { segment: 'spam_dead', deadReason: 'no messages or calls' };

    if (p.calls === p.msgs) return { segment: 'call_only' };
    return { segment: 'enquired' };
}

async function planFor(p: Person): Promise<Plan> {
    const { segment, deadReason } = segmentOf(p);
    const base = { person: p, segment };

    if (segment === 'spam_dead') {
        return { ...base, channel: null, templateName: null, body: null, hold: deadReason ?? 'dead' };
    }

    // A landline cannot hold WhatsApp, so it is SMS from the outset. `prefers_text` is the
    // customer telling us the same thing.
    const forceSms = p.cls === 'uk_landline' || p.tags.includes('prefers_text');

    if (segment === 'past_customer') {
        // Freeform both ways: inside the window WhatsApp carries it free, outside it SMS does,
        // because SMS has no window and no template requirement.
        const channel = !forceSms && p.windowOpen ? 'whatsapp' : 'sms';
        return { ...base, channel, templateName: null, body: pastCustomerCopy(p.name), hold: null };
    }

    if (segment === 'quoted_unpaid') {
        const q = p.openQuote;
        const link = `${QUOTE_BASE}/q/${q.short_slug}`;
        const job = String(q.job_top_line || q.job_description || 'your job').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!forceSms && p.windowOpen) {
            return {
                ...base, channel: 'whatsapp', templateName: null,
                body: `Hi ${firstName(p.name)}, your quote for ${job} is still live. Everything is on the link, itemised price and booking: ${link}. Any questions, just reply here.`,
                hold: null,
            };
        }
        // Outside the window only an approved template may go. Resolved by name at runtime.
        const t = await findApprovedTemplate(['quote_followup_link'], [firstName(p.name), job, link]);
        if (!t) return { ...base, channel: null, templateName: null, body: null, hold: 'no approved template for quote_followup_link' };
        return { ...base, channel: forceSms ? 'sms' : 'whatsapp', templateName: t.template.name, body: t.body, hold: null };
    }

    // enquired / call_only: both are revival, but which words are TRUE depends on how old the
    // thread is. 'missed_call_ack' ends "we will try you again shortly", which is a real promise.
    // It is honest for a call from last week and a lie for one from ten months ago, and most of
    // these threads are months old. So a recent missed call gets the apology it deserves, and an
    // old one gets the revival template, whose "a while back" framing is the actual truth.
    const ageDays = p.lastContact ? (Date.now() - p.lastContact.getTime()) / 86400000 : Infinity;
    const preferred = segment === 'call_only' && ageDays <= 30
        ? ['missed_call_ack', 'missed_enquiry_revival']
        : ['missed_enquiry_revival'];

    if (!forceSms && p.windowOpen) {
        return {
            ...base, channel: 'whatsapp', templateName: null,
            body: `Hi ${firstName(p.name)}, you got in touch about a job a while back and never heard anything back. Sorry about that. Still need it doing? Reply here and we will sort you a fixed price. Reply STOP to opt out.`,
            hold: null,
        };
    }
    const t = await findApprovedTemplate(preferred, [firstName(p.name)]);
    if (!t) return { ...base, channel: null, templateName: null, body: null, hold: `no approved template among ${preferred.join(', ')}` };
    return { ...base, channel: forceSms ? 'sms' : 'whatsapp', templateName: t.template.name, body: t.body, hold: null };
}

// ── Kill switch ────────────────────────────────────────────────────────────────────────────────

async function killed(): Promise<string | null> {
    if (process.env.CLEAROUT_KILL === '1') return 'CLEAROUT_KILL=1 in the environment';
    try {
        const r: any = await db.execute(sql`SELECT value FROM app_settings WHERE key = 'board_clearout' LIMIT 1`);
        if (r.rows[0]?.value?.killSwitch === true) return "app_settings 'board_clearout'.killSwitch = true";
    } catch { /* the switch must never be the thing that breaks a run */ }
    return null;
}

// ── Load ───────────────────────────────────────────────────────────────────────────────────────

async function loadBoard(): Promise<Person[]> {
    const convs: any = await db.execute(sql`
        SELECT c.id, c.phone_number, c.contact_name, c.tags, c.stage, c.last_inbound_at,
               c.last_customer_contact_at,
               -- Quarantined rows are excluded from both counts. They were written but never
               -- reached anyone (server/message-quarantine.ts), and this tool uses the counts to
               -- decide whether anything ever happened on a card ('no messages or calls') and
               -- whether the only thing that ever happened was a phone call ('call_only'). Counting
               -- 380 undelivered automation notices as conversation gets both answers wrong.
               (SELECT count(*) FROM messages m
                 WHERE m.conversation_id = c.id AND m.quarantined_at IS NULL) msgs,
               (SELECT count(*) FROM messages m
                 WHERE m.conversation_id = c.id AND m.channel = 'call' AND m.quarantined_at IS NULL) calls
        FROM conversations c
        WHERE c.archived_at IS NULL
    `);

    // Opt-outs. The authoritative source is now the suppression table (server/opt-out.ts), which
    // the inbound lane writes to the moment somebody says STOP and which the backfill populated
    // from history. The raw message scan below is kept as a second belt: if a keyword ever slips
    // past the detector, or the backfill has not been re-run since a new phrase was added, a bulk
    // campaign is the worst possible place to discover it. The two are unioned, never intersected.
    const optedOut = new Set<string>();
    for (const key of (await loadOptOutIndex()).keys()) optedOut.add(key);
    const suppressedFromTable = optedOut.size;

    const stops: any = await db.execute(sql`
        SELECT DISTINCT c.phone_number
        FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.direction = 'inbound' AND m.content IS NOT NULL
          AND (upper(trim(m.content)) IN ('STOP','STOPALL','UNSUBSCRIBE','END','QUIT','OPTOUT','OPT OUT','REMOVE','CANCEL')
               OR upper(m.content) LIKE '%UNSUBSCRIBE%'
               OR upper(m.content) LIKE '%OPT OUT%' OR upper(m.content) LIKE '%OPT-OUT%'
               OR upper(m.content) LIKE '%DO NOT CONTACT%' OR upper(m.content) LIKE '%TAKE ME OFF%'
               OR upper(m.content) LIKE '%STOP MESSAGING%' OR upper(m.content) LIKE '%STOP TEXTING%')
    `);
    for (const r of stops.rows) { const k = phoneKey(r.phone_number); if (k) optedOut.add(k); }
    if (optedOut.size) {
        console.log(`[Clearout] ${optedOut.size} people excluded as opted out ` +
            `(${suppressedFromTable} from comms_opt_outs, ${optedOut.size - suppressedFromTable} from a raw message scan)`);
    }

    const quotes: any = await db.execute(sql`
        SELECT phone, customer_name, deposit_paid_at, viewed_at, short_slug, job_top_line,
               job_description, created_at, is_draft, revoked_at,
               coalesce(selected_tier_price_pence, base_price, 0) pence
        FROM personalized_quotes
        WHERE phone IS NOT NULL AND coalesce(is_draft, false) = false AND revoked_at IS NULL
    `);
    const paidBy = new Map<string, any>();
    const openBy = new Map<string, any>();
    for (const q of quotes.rows) {
        const k = phoneKey(q.phone);
        if (!k) continue;
        if (q.deposit_paid_at) {
            const prev = paidBy.get(k);
            if (!prev || new Date(q.deposit_paid_at) > new Date(prev.deposit_paid_at)) paidBy.set(k, q);
        } else if (q.short_slug) {
            // The most valuable live quote is the one worth pointing back at.
            const prev = openBy.get(k);
            if (!prev || Number(q.pence) > Number(prev.pence)) openBy.set(k, q);
        }
    }

    const byKey = new Map<string, Person>();
    for (const c of convs.rows) {
        const key = phoneKey(c.phone_number);
        const cls = classify(key);
        const k = key ?? `unusable:${c.id}`;
        let p = byKey.get(k);
        if (!p) {
            p = {
                key: k, cls, e164: key ? toE164(key, cls) : '',
                name: null, conversationIds: [], phoneFormats: [], stages: [], tags: [],
                msgs: 0, calls: 0, windowOpen: false, lastContact: null,
                paidQuote: key ? paidBy.get(key) ?? null : null,
                openQuote: key ? openBy.get(key) ?? null : null,
                optedOut: key ? optedOut.has(key) : false,
            };
            byKey.set(k, p);
        }
        p.conversationIds.push(c.id);
        p.phoneFormats.push(c.phone_number);
        p.stages.push(c.stage ?? 'new');
        for (const t of (c.tags ?? [])) if (!p.tags.includes(t)) p.tags.push(t);
        p.msgs += Number(c.msgs); p.calls += Number(c.calls);
        // A real name beats a phone number echoed into the name field.
        const nm = (c.contact_name ?? '').trim();
        if (!isPlaceholderName(nm) && (!p.name || p.name.length < nm.length)) p.name = nm;
        if (c.last_inbound_at && Date.now() - new Date(c.last_inbound_at).getTime() < 24 * 3600 * 1000) p.windowOpen = true;
        const lc = c.last_customer_contact_at ?? c.last_inbound_at;
        if (lc && (!p.lastContact || new Date(lc) > p.lastContact)) p.lastContact = new Date(lc);
    }

    // Quote names are better than nothing when the thread never learned one.
    for (const p of byKey.values()) if (!p.name) p.name = p.paidQuote?.customer_name ?? p.openQuote?.customer_name ?? null;
    return [...byKey.values()];
}

// ── Reporting ──────────────────────────────────────────────────────────────────────────────────

const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);

function printDryRun(plans: Plan[], done: Map<string, string>, opts: { archiveOnly: boolean }) {
    const threads = plans.reduce((a, p) => a + p.person.conversationIds.length, 0);
    console.log(`\n${'='.repeat(96)}`);
    console.log(`BOARD CLEAR-OUT — DRY RUN   campaign=${CAMPAIGN}`);
    console.log(`${threads} live cards on the board, ${plans.length} distinct people behind them`);
    console.log(`${'='.repeat(96)}`);

    console.log(`\n── SEGMENTS ${'─'.repeat(84)}`);
    console.log(`${pad('segment', 16)}${pad('people', 8)}${pad('cards', 7)}${pad('would msg', 11)}${pad('whatsapp', 10)}${pad('sms', 6)}${pad('held', 6)}${pad('done', 6)}`);
    for (const seg of SEGMENTS) {
        const g = plans.filter((p) => p.segment === seg);
        if (!g.length) continue;
        const cards = g.reduce((a, p) => a + p.person.conversationIds.length, 0);
        const alreadyDone = g.filter((p) => done.has(p.person.key)).length;
        const live = g.filter((p) => !done.has(p.person.key));
        const wa = live.filter((p) => p.channel === 'whatsapp').length;
        const sms = live.filter((p) => p.channel === 'sms').length;
        const held = live.filter((p) => p.channel === null).length;
        console.log(`${pad(seg, 16)}${pad(String(g.length), 8)}${pad(String(cards), 7)}${pad(String(opts.archiveOnly ? 0 : wa + sms), 11)}${pad(String(wa), 10)}${pad(String(sms), 6)}${pad(String(held), 6)}${pad(String(alreadyDone), 6)}`);
    }
    const totalSend = opts.archiveOnly ? 0 : plans.filter((p) => p.channel && !done.has(p.person.key)).length;
    console.log(`${'─'.repeat(96)}`);
    console.log(`TOTAL to message: ${totalSend}   TOTAL cards to archive: ${threads}`);

    console.log(`\n── EXACT COPY PER SEGMENT ${'─'.repeat(70)}`);
    for (const seg of SEGMENTS) {
        const g = plans.filter((p) => p.segment === seg && p.channel && !done.has(p.person.key));
        if (!g.length) {
            const anyHeld = plans.filter((p) => p.segment === seg && p.channel === null && !done.has(p.person.key));
            if (anyHeld.length && seg !== 'spam_dead') {
                console.log(`\n[${seg}] nothing sendable. ${anyHeld.length} held: ${[...new Set(anyHeld.map((p) => p.hold))].join('; ')}`);
            } else if (seg === 'spam_dead') {
                const reasons = new Map<string, number>();
                for (const p of plans.filter((x) => x.segment === 'spam_dead')) reasons.set(p.hold ?? '?', (reasons.get(p.hold ?? '?') ?? 0) + 1);
                console.log(`\n[spam_dead] NEVER MESSAGED, archived silently. Why:`);
                for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${pad(r, 28)} ${n}`);
            }
            continue;
        }
        // Group by the template (or freeform) actually chosen, so every distinct wording shows.
        const variants = new Map<string, Plan[]>();
        for (const p of g) variants.set(`${p.channel}|${p.templateName ?? 'freeform'}`, [...(variants.get(`${p.channel}|${p.templateName ?? 'freeform'}`) ?? []), p]);
        for (const [v, group] of variants) {
            const [channel, tmpl] = v.split('|');
            console.log(`\n[${seg}] ${group.length} people via ${channel.toUpperCase()}${tmpl === 'freeform' ? ' (freeform)' : ` template '${tmpl}'`}`);
            console.log(`    "${group[0].body}"`);
            if (group.length > 1) console.log(`    e.g. ${group.slice(0, 3).map((p) => `${p.person.e164} (${firstName(p.person.name)})`).join(', ')}`);
        }
    }

    const held = plans.filter((p) => p.channel === null && p.segment !== 'spam_dead' && !done.has(p.person.key));
    if (held.length) {
        console.log(`\n── HELD (worth contacting, no legal pipe today) ${'─'.repeat(49)}`);
        for (const p of held.slice(0, 20)) console.log(`    ${pad(p.segment, 16)}${pad(p.person.e164, 16)}${pad(firstName(p.person.name), 14)}${p.hold}`);
        if (held.length > 20) console.log(`    … and ${held.length - 20} more`);
    }

    console.log(`\n── ARCHIVE PLAN ${'─'.repeat(80)}`);
    console.log(`    Every one of the ${threads} cards above gets archived_at = now() and stage = 'closed'.`);
    console.log(`    NOTHING IS DELETED. Conversations and messages stay in the database untouched.`);
    console.log(`    Reversible: npx tsx scripts/comms-board-clearout.ts --restore`);
    console.log(`\nThis was a DRY RUN. No message was sent and no card was archived.`);
    console.log(`To send:    npx tsx scripts/comms-board-clearout.ts --send --limit 25`);
    console.log(`${'='.repeat(96)}\n`);
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────

async function main() {
    const argv = process.argv.slice(2);
    const has = (f: string) => argv.includes(f);
    const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

    const send = has('--send');
    const archiveOnly = has('--archive-only');
    const restore = has('--restore');
    const limit = Math.max(1, Number(val('--limit')) || 25);
    const delayRaw = val('--delay-ms');
    const delayMs = delayRaw !== undefined && Number.isFinite(Number(delayRaw)) ? Math.max(0, Number(delayRaw)) : 4000;
    const only = val('--segment') as Segment | undefined;
    const onlyPhone = val('--phone');
    onlyTestNumbers = has('--only-test-numbers');

    if (only && !SEGMENTS.includes(only)) {
        console.error(`Unknown --segment '${only}'. One of: ${SEGMENTS.join(', ')}`);
        process.exit(1);
    }

    if (restore) return doRestore(send);

    // Everything already done in this campaign, so a rerun never repeats itself.
    const prior: any = await db.execute(sql`
        SELECT phone_key, outcome FROM bulk_campaign_sends WHERE campaign = ${CAMPAIGN} AND outcome = 'sent'
    `);
    const done = new Map<string, string>(prior.rows.map((r: any) => [r.phone_key, r.outcome]));

    console.log(`Loading the board ...`);
    let people = await loadBoard();
    if (onlyTestNumbers) {
        people = people.filter((p) => isTestSafe(p.key));
        console.log(`--only-test-numbers → ${people.length} test recipient(s); no real customer can be selected.`);
    }
    if (onlyPhone) {
        const k = phoneKey(onlyPhone);
        people = people.filter((p) => p.key === k);
        console.log(`--phone ${onlyPhone} → key ${k} → ${people.length} person(s)`);
    }

    const plans: Plan[] = [];
    for (const p of people) plans.push(await planFor(p));
    const scoped = only ? plans.filter((p) => p.segment === only) : plans;

    if (!send) {
        printDryRun(scoped, done, { archiveOnly });
        process.exit(0);
    }

    // ── Live run ───────────────────────────────────────────────────────────────────────────────
    const stop = await killed();
    if (stop) { console.error(`KILL SWITCH ENGAGED (${stop}). Nothing sent.`); process.exit(1); }

    const sendable = archiveOnly ? [] : scoped.filter((p) => p.channel && p.body && !done.has(p.person.key)).slice(0, limit);
    console.log(`\nLIVE RUN campaign=${CAMPAIGN}: ${sendable.length} message(s), cap ${limit}, ${delayMs}ms apart.`);

    let sent = 0, failed = 0;
    // Only these people are safe to take off the board at the end of the run.
    const sentKeys: string[] = [];
    for (const [i, plan] of sendable.entries()) {
        const stopNow = await killed();
        if (stopNow) { console.error(`\nKILL SWITCH ENGAGED (${stopNow}) after ${sent} sent. Stopping.`); break; }

        const p = plan.person;
        let contentSid: string | undefined, contentVariables: Record<string, string> | undefined;
        if (plan.templateName && plan.channel === 'whatsapp') {
            // Re-resolved immediately before sending: approval can change between plan and send.
            const vals = plan.segment === 'quoted_unpaid'
                ? [firstName(p.name), String(p.openQuote?.job_top_line || p.openQuote?.job_description || 'your job').replace(/\s+/g, ' ').trim().slice(0, 60), `${QUOTE_BASE}/q/${p.openQuote?.short_slug}`]
                : [firstName(p.name)];
            const t = await findApprovedTemplate([plan.templateName], vals);
            if (!t) {
                console.log(`  [${i + 1}/${sendable.length}] ${p.e164} SKIP template '${plan.templateName}' no longer approved`);
                await logSend(plan, 'skipped', `template ${plan.templateName} not approved at send time`, null, null);
                continue;
            }
            contentSid = t.template.sid; contentVariables = t.variables;
        }

        const result = await sendCustomerMessage({
            to: p.e164,
            body: plan.body!,
            channel: plan.channel === 'sms' ? 'sms' : undefined,
            contentSid, contentVariables,
            context: `board_clearout:${plan.segment}`,
            contactName: p.name,
            // Every message this tool sends is outreach we chose to start, including the warm ones
            // to past customers. Declaring it explicitly means the choke point refuses anyone who
            // has opted out even if the segmenting above somehow let them through.
            purpose: 'marketing',
        });

        const outcome = result.ok ? 'sent' : 'failed';
        const detail = result.ok
            ? `${result.channel}${result.fellBack ? ' (fell back from whatsapp)' : ''}${result.reason ? ` reason=${result.reason}` : ''}`
            : (result.error ?? 'unknown failure');
        console.log(`  [${i + 1}/${sendable.length}] ${pad(p.e164, 16)}${pad(plan.segment, 16)}${pad(plan.channel!, 10)}${pad(plan.templateName ?? 'freeform', 24)}${outcome} ${detail}`);
        await logSend(plan, outcome, detail, result.channel ?? plan.channel, result.sid ?? null);
        if (result.ok) { sent++; sentKeys.push(p.key); } else failed++;

        if (i < sendable.length - 1) await new Promise((r) => setTimeout(r, delayMs));
    }

    console.log(`\nsent=${sent} failed=${failed}`);

    // Archiving is the point of the exercise, so it runs even when nothing was sent. But a card is
    // only cleared once this run has actually SETTLED that person: junk, an explicit archive-only
    // pass, someone a previous run already messaged, or a message that went out just now.
    //
    // A FAILED send deliberately does not qualify. Archiving a card whose message never arrived
    // would hide the one case a human most needs to see, and the retry on the next run would have
    // nothing left on the board to point at.
    const settled = new Set(sentKeys);
    const toArchive = scoped.filter((p) =>
        p.segment === 'spam_dead' || archiveOnly || done.has(p.person.key) || settled.has(p.person.key));
    let cards = 0;
    for (const plan of toArchive) {
        const ids = plan.person.conversationIds;
        const r: any = await db.execute(sql`
            UPDATE conversations SET archived_at = now(), stage = 'closed',
                   tags = (SELECT array_agg(DISTINCT t) FROM unnest(coalesce(tags, '{}') || ARRAY[${CAMPAIGN}]) t),
                   updated_at = now()
            WHERE id = ANY(${pgTextArray(ids)}::text[]) AND archived_at IS NULL
            RETURNING id`);
        if (!r.rows.length) continue;
        cards += r.rows.length;

        // Whatever else happens, the ids MUST be recorded, because --restore is the only way back
        // and it can only restore what it can find. Update an existing row for this person if there
        // is one; otherwise write a standalone archive record.
        const archivedIds = pgTextArray(r.rows.map((x: any) => x.id));
        const upd: any = await db.execute(sql`
            UPDATE bulk_campaign_sends SET archived_conversation_ids = ${archivedIds}::text[]
            WHERE campaign = ${CAMPAIGN} AND phone_key = ${plan.person.key}
            RETURNING id`);
        if (!upd.rows.length) await logArchiveOnly(plan, r.rows.map((x: any) => x.id));
    }
    console.log(`archived ${cards} card(s). Nothing was deleted; --restore puts them back.`);
    process.exit(0);
}

async function logSend(plan: Plan, outcome: string, detail: string, channel: string | null, sid: string | null) {
    await db.execute(sql`
        INSERT INTO bulk_campaign_sends
            (id, campaign, phone_key, e164, contact_name, conversation_id, segment, channel,
             template_name, body, outcome, detail, twilio_sid)
        VALUES (${randomUUID()}, ${CAMPAIGN}, ${plan.person.key}, ${plan.person.e164}, ${plan.person.name},
                ${plan.person.conversationIds[0]}, ${plan.segment}, ${channel}, ${plan.templateName},
                ${plan.body}, ${outcome}, ${detail}, ${sid})
        ON CONFLICT DO NOTHING`);
}

async function logArchiveOnly(plan: Plan, ids: string[]) {
    await db.execute(sql`
        INSERT INTO bulk_campaign_sends
            (id, campaign, phone_key, e164, contact_name, conversation_id, archived_conversation_ids,
             segment, outcome, detail)
        VALUES (${randomUUID()}, ${CAMPAIGN}, ${plan.person.key}, ${plan.person.e164}, ${plan.person.name},
                ${plan.person.conversationIds[0]}, ${pgTextArray(ids)}::text[], ${plan.segment}, 'archived_only', ${plan.hold})
        ON CONFLICT DO NOTHING`);
}

/**
 * Put the board back. This is what makes archiving an acceptable substitute for deletion: it is a
 * decision that can be unmade, whereas a DELETE never can.
 */
async function doRestore(confirm: boolean) {
    const rows: any = await db.execute(sql`
        SELECT archived_conversation_ids ids FROM bulk_campaign_sends
        WHERE campaign = ${CAMPAIGN} AND archived_conversation_ids IS NOT NULL`);
    const ids = [...new Set(rows.rows.flatMap((r: any) => r.ids ?? []))] as string[];
    console.log(`campaign ${CAMPAIGN} archived ${ids.length} card(s).`);
    if (!confirm) {
        console.log(`Dry run. Add --send to actually un-archive them.`);
        process.exit(0);
    }
    const r: any = await db.execute(sql`
        UPDATE conversations SET archived_at = NULL, stage = 'enquiry',
               tags = array_remove(coalesce(tags, '{}'), ${CAMPAIGN}), updated_at = now()
        WHERE id = ANY(${pgTextArray(ids)}::text[]) RETURNING id`);
    console.log(`restored ${r.rows.length} card(s) to the board.`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
