/**
 * Comms Desk replay simulation (READ-ONLY).
 *
 * "What would the proposed comms desk have done with the last 90 days of real conversations?"
 * Replays real inbound bursts through the proposed lane rules (drop / ben_flag / receptionist /
 * scoper) under two scenarios (LAUNCH = scoper drafts for Ben; MONTH2 = scoper sends) and
 * compares against what actually happened.
 *
 * Run:   npx tsx scripts/_comms-desk-replay.ts
 * Out:   $REPLAY_OUT_DIR/replay-results.json + replay-summary.md (defaults to the scratchpad dir below)
 *
 * Only SELECTs are issued. Never writes to the database.
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------- config
const WINDOW_START = new Date('2026-06-04T00:00:00Z');
const WINDOW_END = new Date('2026-09-03T00:00:00Z'); // exclusive (covers all of 2026-09-02)
const OUT_DIR = process.env.REPLAY_OUT_DIR
    || '/private/tmp/claude-501/-Users-courtneebonnick-v6-switchboard/37a4e54f-b19b-4fe0-9b20-f8149bffc412/scratchpad';

// WhatsApp inbound ingest was dead until 15 Aug 2026 (see memory: WhatsApp Ingest Incident). Per-day rates are
// reported for the full window AND for the period after the restore, which is the realistic run-rate.
const RUN_RATE_START = new Date('2026-08-17T00:00:00Z');
const BURST_GAP_MIN = 10;
const SILENCE_BREAKER_MIN = 20;
const RECEPTIONIST_DELAY_MIN = 1;
const SCOPER_SEND_DELAY_MIN = 2;
const FLAG_DUE_WORKING_MIN = 4 * 60;
const SAMPLE_REVIEW_RATE = 0.10;
const AUDITOR_RATE = 0.10;
const IN_HOURS_START = 8;   // 08:00 London
const IN_HOURS_END = 20;    // 20:00 London (exclusive)

// Lexicons (spec-given)
const RE_STOP = /^\s*(stop|unsubscribe)\b/i;
const RE_URL_ONLY = /^\s*(https?:\/\/\S+|www\.\S+)\s*$/i;
const RE_MONEY = /(how much|price|cost|£|cheap|expensive|budget|discount|deposit|invoice|pay)/i;
const RE_DATE = /(when can|what day|which day|available|availability|book|slot|next week|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
const RE_COMPLAINT = /(complain|unhappy|disappoint|refund|not happy|terrible|awful|rubbish|shocking|trading standards)/i;
const RE_CALLBACK = /(call me|ring me|give me a (call|ring)|phone me)/i;

// Test-data scrub signatures
const RE_TEST_NAME = /\b(test|qa)\b/i;
const RE_TEST_CONTENT = /(ofcom|test_q_|please ignore|channel test|fallback test)/i;
const TEST_PHONE_FRAGMENTS = ['7700900', '84357691573'];

// Outbound rows that are NOT Ben typing (automation that writes sender_name='Agent' without a draft row)
const RE_AUTOMATED_OUTBOUND = /^(final notice|overdue|friendly reminder|reminder)\b|invoice inv-|do you still need a quote|just a reminder|will be with you tomorrow|please ignore|channel test|fallback test/i;

// ---------------------------------------------------------------- time helpers (Europe/London)
const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
});
type LP = { y: number; m: number; d: number; h: number; mi: number; dow: number };
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function london(d: Date): LP {
    const p: any = {};
    for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, dow: DOW[p.weekday] };
}
function londonOffsetMin(d: Date): number {
    const l = london(d);
    const asUtc = Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi);
    return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}
/** Build a UTC Date for a London wall-clock time (y/m/d h:mi). */
function makeLondon(y: number, m: number, d: number, h: number, mi: number): Date {
    const guess = new Date(Date.UTC(y, m - 1, d, h, mi));
    return new Date(guess.getTime() - londonOffsetMin(guess) * 60000);
}
function londonStr(d: Date): string {
    const l = london(d);
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${names[l.dow]} ${String(l.d).padStart(2, '0')}/${String(l.m).padStart(2, '0')} ${String(l.h).padStart(2, '0')}:${String(l.mi).padStart(2, '0')}`;
}
function isWeekend(l: LP) { return l.dow === 0 || l.dow === 6; }
function isInHours(d: Date): boolean {
    const l = london(d);
    return !isWeekend(l) && l.h >= IN_HOURS_START && l.h < IN_HOURS_END;
}
function addDaysLondon(l: LP, n: number): LP {
    const t = new Date(Date.UTC(l.y, l.m - 1, l.d + n, 12));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: 0, mi: 0, dow: t.getUTCDay() };
}
/** Next working day (Mon-Fri) at hh:mm London, strictly after the calendar day of `d`. */
function nextWorkingMorning(d: Date, hh: number, mm: number): Date {
    let l = addDaysLondon(london(d), 1);
    while (l.dow === 0 || l.dow === 6) l = addDaysLondon(l, 1);
    return makeLondon(l.y, l.m, l.d, hh, mm);
}
/** Advance `minutes` of working time (Mon-Fri 08:00-20:00 London). */
function addWorkingMinutes(start: Date, minutes: number): Date {
    let cur = new Date(start);
    let remaining = minutes;
    for (let guard = 0; guard < 60; guard++) {
        const l = london(cur);
        if (isWeekend(l) || l.h >= IN_HOURS_END) {
            cur = nextWorkingMorning(cur, IN_HOURS_START, 0); continue;
        }
        if (l.h < IN_HOURS_START) { cur = makeLondon(l.y, l.m, l.d, IN_HOURS_START, 0); continue; }
        const dayEnd = makeLondon(l.y, l.m, l.d, IN_HOURS_END, 0);
        const avail = (dayEnd.getTime() - cur.getTime()) / 60000;
        if (remaining <= avail) return new Date(cur.getTime() + remaining * 60000);
        remaining -= avail;
        cur = nextWorkingMorning(cur, IN_HOURS_START, 0);
    }
    return cur;
}
function weekKey(d: Date): string {
    const l = london(d);
    const back = (l.dow + 6) % 7; // days since Monday
    const mon = addDaysLondon(l, -back);
    return `${mon.y}-${String(mon.m).padStart(2, '0')}-${String(mon.d).padStart(2, '0')}`;
}
function minutesBetween(a: Date, b: Date) { return (b.getTime() - a.getTime()) / 60000; }
function median(xs: number[]): number | null {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p90(xs: number[]): number | null {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)];
}
const r1 = (n: number | null) => n == null ? null : Math.round(n * 10) / 10;
const pct = (n: number, d: number) => d ? Math.round(1000 * n / d) / 10 : 0;

// ---------------------------------------------------------------- types
type Msg = {
    id: string; conversationId: string; direction: 'inbound' | 'outbound'; channel: string;
    content: string; type: string | null; mediaUrl: string | null; senderName: string | null;
    createdAt: Date; quarantined: boolean; viaDraftSource: string | null; benManual: boolean;
};
type Thread = { id: string; phone: string; contactName: string | null; msgs: Msg[]; scrubbed: boolean };
type Lane = 'dropped' | 'ben_flag' | 'ben_flag_urgent' | 'receptionist_send' | 'scoper';
type Burst = {
    threadId: string; phone: string; firstName: string; channel: string;
    start: Date; end: Date; msgCount: number; content: string; hasMedia: boolean;
    inHours: boolean; weekend: boolean; hourLondon: number; week: string;
    // actual
    actualFirstOutboundMin: number | null; // any non-quarantined outbound within 24h
    actualBenMin: number | null;           // Ben manual outbound within 24h
    actualFirstOutboundKind: string | null;
    // simulated
    lane: Lane; subTypes: string[]; dropReason?: string; firstContact: boolean; template?: string;
    sim: Record<'LAUNCH' | 'MONTH2', SimOutcome>;
};
type SimOutcome = {
    firstResponseMin: number | null;          // any response incl. holding lines
    firstSubstantiveMin: number | null;       // excluding holding lines
    responder: string;                        // who delivered the first response
    silenceBreaker: boolean; flagExpiryHolding: boolean;
    benTaps: number; autoSends: Record<string, number>; sends: { at: Date; kind: string }[];
};

// ---------------------------------------------------------------- main
async function main() {
    const failures: string[] = [];
    const caveats: string[] = [];
    const ws = WINDOW_START.toISOString(), we = WINDOW_END.toISOString();

    // --- conversations (customer lane only)
    let convRows: any[] = [];
    try {
        const r: any = await db.execute(sql.raw(`
            SELECT id, phone_number, contact_name, role_profile, created_at
            FROM conversations
            WHERE role_profile IS NULL OR role_profile = 'customer'`));
        convRows = r.rows;
    } catch (e: any) { failures.push(`conversations query: ${e.message}`); throw e; }

    const threads = new Map<string, Thread>();
    for (const c of convRows) {
        const phone = String(c.phone_number || '').replace(/@c\.us$/, '').replace(/^\+/, '');
        const scrubbed = TEST_PHONE_FRAGMENTS.some(f => phone.includes(f)) || RE_TEST_NAME.test(c.contact_name || '');
        threads.set(c.id, { id: c.id, phone, contactName: c.contact_name, msgs: [], scrubbed });
    }

    // --- messages: whole history for first-contact detection; outbound after window end for the 24h lookahead
    let msgRows: any[] = [];
    try {
        const r: any = await db.execute(sql.raw(`
            SELECT m.id, m.conversation_id, m.direction, m.channel, m.content, m.type, m.media_url,
                   m.sender_name, (m.created_at AT TIME ZONE 'UTC') AS created_at, m.quarantined_at, d.source AS draft_source
            FROM messages m
            LEFT JOIN message_drafts d ON d.sent_message_id = m.id
            WHERE m.created_at < '${new Date(WINDOW_END.getTime() + 36 * 3600 * 1000).toISOString()}'
            ORDER BY m.created_at ASC`));
        msgRows = r.rows;
    } catch (e: any) { failures.push(`messages query: ${e.message}`); throw e; }

    let scrubbedMsgs = 0;
    for (const m of msgRows) {
        const t = threads.get(m.conversation_id);
        if (!t) continue;
        const content = String(m.content || '');
        if (RE_TEST_NAME.test(m.sender_name || '') || RE_TEST_CONTENT.test(content)) { scrubbedMsgs++; continue; }
        const quarantined = !!m.quarantined_at;
        const viaDraftSource = m.draft_source || null;
        const benManual = m.direction === 'outbound' && !quarantined && !viaDraftSource
            && (m.channel === 'whatsapp' || m.channel === 'sms') && !RE_AUTOMATED_OUTBOUND.test(content);
        t.msgs.push({
            id: m.id, conversationId: m.conversation_id, direction: m.direction, channel: m.channel,
            content, type: m.type, mediaUrl: m.media_url, senderName: m.sender_name,
            createdAt: new Date(m.created_at), quarantined, viaDraftSource, benManual,
        });
    }

    // --- agent sends arrive as several bubbles but only ONE row carries message_drafts.sent_message_id.
    // Re-attribute undrafted outbound rows within +-BUBBLE_WINDOW_S of a draft-linked send on the same thread.
    const BUBBLE_WINDOW_S = 120;
    let bubbleReattributed = 0;
    for (const t of threads.values()) {
        const linked = t.msgs.filter(m => m.direction === 'outbound' && m.viaDraftSource);
        if (!linked.length) continue;
        for (const m of t.msgs) {
            if (m.direction !== 'outbound' || m.viaDraftSource || !m.benManual) continue;
            const near = linked.find(l => Math.abs(l.createdAt.getTime() - m.createdAt.getTime()) <= BUBBLE_WINDOW_S * 1000);
            if (near) { m.viaDraftSource = near.viaDraftSource + '_bubble'; m.benManual = false; bubbleReattributed++; }
        }
    }

    // --- build bursts
    const bursts: Burst[] = [];
    const isUkPhone = (p: string) => p.startsWith('44') || p.startsWith('0');
    for (const t of threads.values()) {
        if (t.scrubbed) continue;
        const inboundInWindow = t.msgs.filter(m => m.direction === 'inbound' && !m.quarantined
            && (m.channel === 'whatsapp' || m.channel === 'sms')
            && m.createdAt >= WINDOW_START && m.createdAt < WINDOW_END
            && (m.content.trim() !== '' || !!m.mediaUrl));
        const outbounds = t.msgs.filter(m => m.direction === 'outbound' && !m.quarantined);
        let group: Msg[] = [];
        const flush = () => {
            if (!group.length) return;
            const start = group[0].createdAt, end = group[group.length - 1].createdAt;
            const content = group.map(m => m.content.trim()).filter(Boolean).join(' | ');
            const hasMedia = group.some(m => !!m.mediaUrl || ['image', 'video', 'audio', 'document'].includes(m.type || ''));
            const l = london(start);
            const firstOut = outbounds.find(m => m.createdAt >= start && minutesBetween(start, m.createdAt) <= 1440);
            const firstBen = outbounds.find(m => m.benManual && m.createdAt >= start && minutesBetween(start, m.createdAt) <= 1440);
            const priorOutbound = outbounds.some(m => m.createdAt < start);
            const senderName = group.find(m => m.senderName && !/caller/i.test(m.senderName))?.senderName || t.contactName || '';
            const firstName = (senderName.trim().split(/\s+/)[0] || 'customer').replace(/[^A-Za-z'-]/g, '') || 'customer';
            bursts.push({
                threadId: t.id, phone: t.phone, firstName, channel: group[0].channel,
                start, end, msgCount: group.length, content, hasMedia,
                inHours: isInHours(start), weekend: isWeekend(l), hourLondon: l.h, week: weekKey(start),
                actualFirstOutboundMin: firstOut ? r1(minutesBetween(start, firstOut.createdAt)) : null,
                actualBenMin: firstBen ? r1(minutesBetween(start, firstBen.createdAt)) : null,
                actualFirstOutboundKind: firstOut ? (firstOut.benManual ? 'ben_manual' : (firstOut.viaDraftSource || 'automation')) : null,
                lane: 'scoper', subTypes: [], firstContact: !priorOutbound,
                sim: {} as any,
            });
            group = [];
        };
        for (const m of inboundInWindow) {
            if (group.length && minutesBetween(group[group.length - 1].createdAt, m.createdAt) >= BURST_GAP_MIN) flush();
            group.push(m);
        }
        flush();
    }
    bursts.sort((a, b) => a.start.getTime() - b.start.getTime());

    // --- Ben's median actual manual reply time (used for LAUNCH draft approval)
    const benReplyMins = bursts.map(b => b.actualBenMin).filter((x): x is number => x != null);
    const benMedianReplyMin = median(benReplyMins) ?? 60;
    caveats.push(`Ben's median manual reply (n=${benReplyMins.length}) = ${r1(benMedianReplyMin)} min = in-hours LAUNCH draft-approval delay.`);

    // --- classify + simulate
    const scoperBurstsPerThread = new Map<string, number>();
    for (const b of bursts) {
        // 1. DROP
        if (RE_STOP.test(b.content)) { b.lane = 'dropped'; b.dropReason = 'stop_unsubscribe'; }
        else if (!b.hasMedia && RE_URL_ONLY.test(b.content)) { b.lane = 'dropped'; b.dropReason = 'url_only'; }
        else if (!isUkPhone(b.phone)) { b.lane = 'dropped'; b.dropReason = 'non_uk_number'; }
        else {
            // 2. EXCEPTION
            const subs: string[] = [];
            if (RE_CALLBACK.test(b.content)) subs.push('callback');
            if (RE_COMPLAINT.test(b.content)) subs.push('complaint');
            if (RE_MONEY.test(b.content)) subs.push('money');
            if (RE_DATE.test(b.content)) subs.push('date');
            if (subs.length) { b.lane = subs[0] === 'callback' ? 'ben_flag_urgent' : 'ben_flag'; b.subTypes = subs; }
            // 3. FIRST CONTACT
            else if (b.firstContact) { b.lane = 'receptionist_send'; b.template = 'first_contact_ack'; }
            // 4. MEDIA
            else if (b.hasMedia) { b.lane = 'receptionist_send'; b.template = 'ack_photos'; }
            // 5. SCOPER
            else { b.lane = 'scoper'; scoperBurstsPerThread.set(b.threadId, (scoperBurstsPerThread.get(b.threadId) || 0) + 1); }
        }

        for (const scenario of ['LAUNCH', 'MONTH2'] as const) {
            const out: SimOutcome = { firstResponseMin: null, firstSubstantiveMin: null, responder: 'none', silenceBreaker: false, flagExpiryHolding: false, benTaps: 0, autoSends: {}, sends: [] };
            const addSend = (kind: string, at: Date) => { out.autoSends[kind] = (out.autoSends[kind] || 0) + 1; out.sends.push({ at, kind }); };
            const candidates: { min: number; who: string; substantive: boolean }[] = [];
            if (b.actualBenMin != null) candidates.push({ min: b.actualBenMin, who: 'ben_manual', substantive: true });

            if (b.lane === 'dropped') { b.sim[scenario] = out; continue; }

            if (b.lane === 'receptionist_send') {
                candidates.push({ min: RECEPTIONIST_DELAY_MIN, who: `receptionist:${b.template}`, substantive: true });
                addSend('receptionist', new Date(b.start.getTime() + RECEPTIONIST_DELAY_MIN * 60000));
            } else if (b.lane === 'scoper') {
                if (scenario === 'MONTH2') {
                    candidates.push({ min: SCOPER_SEND_DELAY_MIN, who: 'scoper_send', substantive: true });
                    addSend('scoper_send', new Date(b.start.getTime() + SCOPER_SEND_DELAY_MIN * 60000));
                } else {
                    out.benTaps += 1; // draft always lands in Ben's queue
                    const approveAt = b.inHours
                        ? new Date(b.start.getTime() + benMedianReplyMin * 60000)
                        : nextWorkingMorning(b.start, 8, 30);
                    candidates.push({ min: minutesBetween(b.start, approveAt), who: 'scoper_draft_approved', substantive: true });
                }
            } else { // ben_flag / ben_flag_urgent
                out.benTaps += 1;
                const dueAt = addWorkingMinutes(b.start, FLAG_DUE_WORKING_MIN);
                const dueMin = minutesBetween(b.start, dueAt);
                if (b.actualBenMin == null || b.actualBenMin > dueMin) {
                    out.flagExpiryHolding = true;
                    addSend('flag_expiry_holding', dueAt);
                    candidates.push({ min: dueMin, who: 'flag_expiry_holding', substantive: false });
                }
            }
            // 6. SILENCE-BREAKER
            const fastest = candidates.filter(c => c.min <= SILENCE_BREAKER_MIN);
            if (!fastest.length) {
                out.silenceBreaker = true;
                addSend('silence_breaker', new Date(b.start.getTime() + SILENCE_BREAKER_MIN * 60000));
                candidates.push({ min: SILENCE_BREAKER_MIN, who: 'silence_breaker', substantive: false });
            }
            candidates.sort((x, y) => x.min - y.min);
            const first = candidates[0];
            out.firstResponseMin = r1(first.min); out.responder = first.who;
            const sub = candidates.find(c => c.substantive);
            out.firstSubstantiveMin = sub && sub.min <= 1440 ? r1(sub.min) : null;
            b.sim[scenario] = out;
        }
    }

    // --- calls
    let callRows: any[] = [];
    try {
        const r: any = await db.execute(sql.raw(`
            SELECT call_id, phone_number, direction, status, (start_time AT TIME ZONE 'UTC') AS start_time, duration, ring_seconds,
                   (coalesce(transcription,'') <> '') AS has_tx, customer_name
            FROM calls
            WHERE direction = 'inbound' AND start_time >= '${ws}' AND start_time < '${we}'`));
        callRows = r.rows;
    } catch (e: any) { failures.push(`calls query: ${e.message}`); }
    const calls = callRows
        .filter(c => !TEST_PHONE_FRAGMENTS.some(f => String(c.phone_number || '').includes(f)) && !RE_TEST_NAME.test(c.customer_name || ''))
        .map(c => ({ ...c, start: new Date(c.start_time), answered: c.status === 'completed' && (c.duration ?? 0) > 10, week: weekKey(new Date(c.start_time)) }));
    caveats.push('Answered call = completed AND duration > 10s; 65 shorter completed calls count as missed.');

    // ---------------------------------------------------------------- aggregate
    const days = Math.round((WINDOW_END.getTime() - WINDOW_START.getTime()) / 86400000);
    let workingDays = 0;
    for (let i = 0; i < days; i++) { const l = london(new Date(WINDOW_START.getTime() + i * 86400000 + 12 * 3600000)); if (!isWeekend(l)) workingDays++; }
    const countBy = <T,>(xs: T[], f: (x: T) => string) => { const m: Record<string, number> = {}; for (const x of xs) { const k = f(x); m[k] = (m[k] || 0) + 1; } return m; };
    const sortedObj = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort());

    const nonDropped = bursts.filter(b => b.lane !== 'dropped');
    const A = {
        total: bursts.length, threads: new Set(bursts.map(b => b.threadId)).size, days, workingDays,
        perWeek: sortedObj(countBy(bursts, b => b.week)),
        perChannel: countBy(bursts, b => b.channel),
        outOfHours: bursts.filter(b => !b.inHours).length,
        outOfHoursPct: pct(bursts.filter(b => !b.inHours).length, bursts.length),
        weekend: bursts.filter(b => b.weekend).length,
        multiMessageBursts: bursts.filter(b => b.msgCount > 1).length,
        withMedia: bursts.filter(b => b.hasMedia).length,
        firstContact: bursts.filter(b => b.firstContact).length,
    };
    const laneCounts = countBy(bursts, b => b.lane);
    const B = {
        lanes: Object.fromEntries(Object.entries(laneCounts).map(([k, v]) => [k, { count: v, pct: pct(v, bursts.length) }])),
        dropReasons: countBy(bursts.filter(b => b.lane === 'dropped'), b => b.dropReason!),
        flagSubTypesPrimary: countBy(bursts.filter(b => b.lane.startsWith('ben_flag')), b => b.subTypes[0]),
        flagSubTypesAny: (() => { const m: Record<string, number> = {}; for (const b of bursts) for (const s of b.subTypes) m[s] = (m[s] || 0) + 1; return m; })(),
        receptionistTemplates: countBy(bursts.filter(b => b.lane === 'receptionist_send'), b => b.template!),
        droppedButBenReplied: bursts.filter(b => b.lane === 'dropped' && b.actualBenMin != null).length,
    };

    const silenceBlock = (xs: Burst[]) => {
        const act = xs.map(b => b.actualFirstOutboundMin).filter((x): x is number => x != null);
        const actBen = xs.map(b => b.actualBenMin).filter((x): x is number => x != null);
        const sc = (s: 'LAUNCH' | 'MONTH2', key: 'firstResponseMin' | 'firstSubstantiveMin') => xs.map(b => b.sim[s]?.[key] ?? null).filter((x): x is number => x != null);
        return {
            n: xs.length,
            actual: { silent24h: xs.length - act.length, silentPct: pct(xs.length - act.length, xs.length), medianMin: r1(median(act)), p90Min: r1(p90(act)), medianBenManualMin: r1(median(actBen)), benManualReplied: actBen.length },
            LAUNCH: { silent24h: xs.length - sc('LAUNCH', 'firstResponseMin').length, medianMin: r1(median(sc('LAUNCH', 'firstResponseMin'))), p90Min: r1(p90(sc('LAUNCH', 'firstResponseMin'))),
                      substantive: { silent24h: xs.length - sc('LAUNCH', 'firstSubstantiveMin').length, medianMin: r1(median(sc('LAUNCH', 'firstSubstantiveMin'))), p90Min: r1(p90(sc('LAUNCH', 'firstSubstantiveMin'))) } },
            MONTH2: { silent24h: xs.length - sc('MONTH2', 'firstResponseMin').length, medianMin: r1(median(sc('MONTH2', 'firstResponseMin'))), p90Min: r1(p90(sc('MONTH2', 'firstResponseMin'))),
                      substantive: { silent24h: xs.length - sc('MONTH2', 'firstSubstantiveMin').length, medianMin: r1(median(sc('MONTH2', 'firstSubstantiveMin'))), p90Min: r1(p90(sc('MONTH2', 'firstSubstantiveMin'))) } },
        };
    };
    const C = { all: silenceBlock(nonDropped), inHours: silenceBlock(nonDropped.filter(b => b.inHours)), outOfHours: silenceBlock(nonDropped.filter(b => !b.inHours)) };

    // D/E/G: sends, taps, model calls. Computed for the full window and for the post-ingest-restore run-rate window.
    const benManualOutboundsAll = [...threads.values()].filter(t => !t.scrubbed).flatMap(t => t.msgs)
        .filter(m => m.benManual && m.createdAt >= WINDOW_START && m.createdAt < WINDOW_END);
    const loadBlock = (since: Date) => {
        const bs = bursts.filter(b => b.start >= since);
        const nd = bs.filter(b => b.lane !== 'dropped');
        const cs = calls.filter(c => c.start >= since);
        const missed = cs.filter(c => !c.answered).length, answered = cs.filter(c => c.answered).length;
        const dCount = Math.round((WINDOW_END.getTime() - since.getTime()) / 86400000);
        let wd = 0;
        for (let i = 0; i < dCount; i++) { const l = london(new Date(since.getTime() + i * 86400000 + 12 * 3600000)); if (!isWeekend(l)) wd++; }
        const sumSends = (s: 'LAUNCH' | 'MONTH2') => {
            const m: Record<string, number> = {};
            for (const b of bs) for (const [k, v] of Object.entries(b.sim[s]?.autoSends || {})) m[k] = (m[k] || 0) + v;
            m.post_call_template = missed;
            return m;
        };
        const sends = { LAUNCH: sumSends('LAUNCH'), MONTH2: sumSends('MONTH2') };
        const total = (s: 'LAUNCH' | 'MONTH2') => Object.values(sends[s]).reduce((a, b) => a + b, 0);
        const ben = benManualOutboundsAll.filter(m => m.createdAt >= since);
        const taps = (s: 'LAUNCH' | 'MONTH2') => {
            const lane = bs.reduce((a, b) => a + (b.sim[s]?.benTaps || 0), 0);
            const flags = bs.filter(b => b.lane.startsWith('ben_flag')).length;
            const drafts = s === 'LAUNCH' ? bs.filter(b => b.lane === 'scoper').length : 0;
            const sample = Math.round(total(s) * SAMPLE_REVIEW_RATE);
            return { flags, scoperDrafts: drafts, sampleReviews: sample, total: lane + sample, perWorkingDay: r1((lane + sample) / wd) };
        };
        const perThread = new Map<string, number>();
        for (const b of bs) if (b.lane === 'scoper') perThread.set(b.threadId, (perThread.get(b.threadId) || 0) + 1);
        const threads2plus = [...perThread.values()].filter(n => n >= 2).length;
        const model = (s: 'LAUNCH' | 'MONTH2') => {
            const triage = nd.length, scoper = bs.filter(b => b.lane === 'scoper').length, clerk = answered + threads2plus, auditor = Math.round(total(s) * AUDITOR_RATE);
            const t = triage + scoper + clerk + auditor;
            return { triage_haiku: triage, scoper_sonnet: scoper, clerk_sonnet: clerk, auditor_opus: auditor, total: t,
                     perDay: { triage_haiku: r1(triage / dCount), scoper_sonnet: r1(scoper / dCount), clerk_sonnet: r1(clerk / dCount), auditor_opus: r1(auditor / dCount), total: r1(t / dCount) } };
        };
        return {
            since: since.toISOString().slice(0, 10), days: dCount, workingDays: wd, bursts: bs.length, burstsPerWeek: r1(bs.length / (dCount / 7)),
            D: { actual: { benManualOutbounds: ben.length, perWorkingDay: r1(ben.length / wd) }, LAUNCH: taps('LAUNCH'), MONTH2: taps('MONTH2') },
            E: { LAUNCH: { total: total('LAUNCH'), perDay: r1(total('LAUNCH') / dCount), byKind: sends.LAUNCH, byKindPerDay: Object.fromEntries(Object.entries(sends.LAUNCH).map(([k, v]) => [k, r1(v / dCount)])) },
                 MONTH2: { total: total('MONTH2'), perDay: r1(total('MONTH2') / dCount), byKind: sends.MONTH2, byKindPerDay: Object.fromEntries(Object.entries(sends.MONTH2).map(([k, v]) => [k, r1(v / dCount)])) } },
            G: { LAUNCH: model('LAUNCH'), MONTH2: model('MONTH2'), threadsWith2plusScoperBursts: threads2plus, answeredCalls: answered },
        };
    };
    const full = loadBlock(WINDOW_START), runRate = loadBlock(RUN_RATE_START);
    const D = { ...full.D, actualPerWeek: sortedObj(countBy(benManualOutboundsAll, m => weekKey(m.createdAt))), runRate: runRate.D };
    const E = { ...full.E, runRate: runRate.E };
    const G = { ...full.G, runRate: runRate.G };
    const benManualOutbounds = benManualOutboundsAll;
    const missedCalls = calls.filter(c => !c.answered), answeredCalls = calls.filter(c => c.answered);
    const F = {
        total: calls.length, answered: answeredCalls.length, missed: missedCalls.length,
        perWeek: (() => { const o: Record<string, { answered: number; missed: number; quote_clerk_prefill: number; post_call_template_send: number }> = {};
            for (const c of calls) { o[c.week] ||= { answered: 0, missed: 0, quote_clerk_prefill: 0, post_call_template_send: 0 }; if (c.answered) { o[c.week].answered++; o[c.week].quote_clerk_prefill++; } else { o[c.week].missed++; o[c.week].post_call_template_send++; } }
            return Object.fromEntries(Object.entries(o).sort()); })(),
    };
    const runRateInfo = { since: runRate.since, days: runRate.days, workingDays: runRate.workingDays, bursts: runRate.bursts, burstsPerWeek: runRate.burstsPerWeek };
    // H: examples
    const used = new Set<Burst>();
    const pick = (label: string, pred: (b: Burst) => boolean, prefer?: (a: Burst, b: Burst) => number) => {
        const cs = bursts.filter(b => !used.has(b) && pred(b)); if (prefer) cs.sort(prefer);
        const b = cs[0]; if (!b) return { label, found: false };
        used.add(b);
        const describeSend = (s: 'LAUNCH' | 'MONTH2') => b.sim[s].sends.map(x => `${x.kind} @ ${londonStr(x.at)}`).join('; ') || (b.lane === 'scoper' && s === 'LAUNCH' ? 'draft to Ben' : 'nothing');
        return {
            label, found: true, name: b.firstName, phoneLast3: b.phone.slice(-3), ukTime: londonStr(b.start), channel: b.channel,
            excerpt: (b.hasMedia && !b.content ? '[media only]' : b.content).slice(0, 80),
            actual: b.actualFirstOutboundMin == null ? 'silent (24h)' : `${b.actualFirstOutboundMin} min (${b.actualFirstOutboundKind})`,
            lane: b.lane, subTypes: b.subTypes, template: b.template,
            LAUNCH: { firstResponse: b.sim.LAUNCH.firstResponseMin, by: b.sim.LAUNCH.responder, sends: describeSend('LAUNCH') },
            MONTH2: { firstResponse: b.sim.MONTH2.firstResponseMin, by: b.sim.MONTH2.responder, sends: describeSend('MONTH2') },
        };
    };
    const H = [
        pick('Saturday-night first contact', b => b.firstContact && b.weekend && london(b.start).dow === 6 && b.hourLondon >= 18, (a, b) => b.hourLondon - a.hourLondon),
        pick('Photos', b => b.lane === 'receptionist_send' && b.template === 'ack_photos'),
        pick('Money question', b => b.subTypes[0] === 'money'),
        pick('Date question', b => b.subTypes[0] === 'date'),
        pick('Callback request', b => b.lane === 'ben_flag_urgent'),
        pick('Mid-scope reply', b => b.lane === 'scoper' && !b.firstContact && b.actualFirstOutboundMin != null),
        pick('Actually went silent', b => b.lane !== 'dropped' && b.actualFirstOutboundMin == null),
        pick('Out-of-area / spam', b => b.lane === 'dropped'),
        pick('Ben replied within 2 min', b => b.lane !== 'dropped' && b.actualBenMin != null && b.actualBenMin <= 2),
        pick('Holding line would fire', b => b.lane.startsWith('ben_flag') && b.sim.LAUNCH.silenceBreaker),
    ];

    caveats.push(
        `Ben's personal-number WhatsApp replies are NOT in the DB. "Ben manual" = business-sender outbound with no draft row, not matching dunning / job-reminder / nudge / test patterns, after re-attributing ${bubbleReattributed} sibling bubbles of agent sends (${benManualOutbounds.length} rows remain). Other undrafted automation would still be miscounted as Ben.`,
        'Existing comms-agent sends count in ACTUAL only; the desk replaces that agent.',
        'Media = media_url or type image/video/audio/document. Fixed regex lexicons: "pay", "book", "available" fire on ordinary sentences (ben_flag over-counted); nothing matched the callback lexicon.',
        'Working hours Mon-Fri 08:00-20:00 London; OOH LAUNCH drafts are approved next working day 08:30, so Saturday bursts wait until Monday (the large OOH substantive p90).',
        `Scrubbed: phones with 7700900 / 84357691573, Test/QA names, content mentioning Ofcom / test_q_ / "please ignore" (${scrubbedMsgs} rows). DB timestamps are UTC, converted explicitly.`,
    );

    const results = {
        generatedAt: new Date().toISOString(), window: { start: WINDOW_START.toISOString(), end: WINDOW_END.toISOString(), days, workingDays },
        params: { BURST_GAP_MIN, SILENCE_BREAKER_MIN, RECEPTIONIST_DELAY_MIN, SCOPER_SEND_DELAY_MIN, FLAG_DUE_WORKING_MIN, SAMPLE_REVIEW_RATE, AUDITOR_RATE, benMedianReplyMin: r1(benMedianReplyMin) },
        queryFailures: failures, A_bursts: A, B_lanes: B, C_silence: C, D_benLoad: D, E_autoSends: E, F_calls: F, G_modelCalls: G, runRate: runRateInfo, H_examples: H, I_caveats: caveats,
        bursts: bursts.map(b => ({ threadId: b.threadId, phoneLast3: b.phone.slice(-3), ukTime: londonStr(b.start), channel: b.channel, msgCount: b.msgCount, hasMedia: b.hasMedia, inHours: b.inHours, lane: b.lane, subTypes: b.subTypes, firstContact: b.firstContact,
            actualFirstOutboundMin: b.actualFirstOutboundMin, actualBenMin: b.actualBenMin, LAUNCH: { first: b.sim.LAUNCH.firstResponseMin, by: b.sim.LAUNCH.responder, sb: b.sim.LAUNCH.silenceBreaker, fx: b.sim.LAUNCH.flagExpiryHolding }, MONTH2: { first: b.sim.MONTH2.firstResponseMin, by: b.sim.MONTH2.responder, sb: b.sim.MONTH2.silenceBreaker, fx: b.sim.MONTH2.flagExpiryHolding } })),
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'replay-results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'replay-summary.md'), renderMarkdown(results));
    console.log(`Wrote ${path.join(OUT_DIR, 'replay-results.json')} and replay-summary.md`);
    console.log(`Bursts: ${A.total} across ${A.threads} threads; lanes:`, laneCounts, `; calls: ${F.answered} answered / ${F.missed} missed`);
    if (failures.length) console.log('Query failures:', failures);
}

// ---------------------------------------------------------------- markdown
function renderMarkdown(R: any): string {
    const A = R.A_bursts, B = R.B_lanes, C = R.C_silence, D = R.D_benLoad, E = R.E_autoSends, F = R.F_calls, G = R.G_modelCalls, RR = R.runRate;
    const n = (x: any) => x == null ? '–' : String(x);
    const kv = (o: any) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    const L: string[] = [];
    L.push(`# Comms desk replay, ${R.window.start.slice(0, 10)} to 2026-09-02`);
    L.push('', `Real customer WhatsApp/SMS bursts (${R.window.days} days, ${R.window.workingDays} working days) replayed through the desk rules. LAUNCH = scoper drafts for Ben; MONTH2 = scoper sends. ${R.queryFailures.length ? 'QUERY FAILURES: ' + R.queryFailures.join('; ') : ''} **Read first:** WhatsApp inbound capture was dead until 15 Aug, so ${RR.bursts} of ${A.total} bursts fall in the last ${RR.days} days; per-day rates "since ${RR.since}" are the honest run-rate. Calls were captured all window.`);

    L.push('', '## A. Bursts', '', '| Metric | Value |', '|---|---|',
        `| Bursts | ${A.total} across ${A.threads} threads (${kv(A.perChannel)}) |`,
        `| Per week since ${RR.since} | ${RR.burstsPerWeek} |`,
        `| Out-of-hours (pre-08:00, post-20:00, weekend) | ${A.outOfHours} (${A.outOfHoursPct}%), weekend ${A.weekend} |`,
        `| First-contact / with media | ${A.firstContact} / ${A.withMedia} |`);
    const wk = Object.keys(A.perWeek);
    L.push('', '| Week of | ' + wk.map(k => k.slice(5)).join(' | ') + ' |', '|' + '---|'.repeat(wk.length + 1), '| Bursts | ' + Object.values(A.perWeek).join(' | ') + ' |');

    L.push('', '## B. Lanes', '', '| Lane | Count | % |', '|---|---|---|');
    for (const [k, v] of Object.entries(B.lanes) as any) L.push(`| ${k} | ${v.count} | ${v.pct}% |`);
    L.push('', `Flags: ${kv(B.flagSubTypesPrimary)}. Drops: ${kv(B.dropReasons)}, of which Ben actually replied to ${B.droppedButBenReplied} (real customers on foreign numbers). Receptionist: ${kv(B.receptionistTemplates)}.`);

    const row = (label: string, s: any) => `| ${label} | ${s.n} | ${s.actual.silent24h} (${s.actual.silentPct}%) | ${n(s.actual.medianMin)} / ${n(s.actual.p90Min)} | 0 (${s.LAUNCH.substantive.silent24h}) | ${n(s.LAUNCH.medianMin)} / ${n(s.LAUNCH.p90Min)} (${n(s.LAUNCH.substantive.p90Min)}) | 0 (${s.MONTH2.substantive.silent24h}) | ${n(s.MONTH2.medianMin)} / ${n(s.MONTH2.p90Min)} (${n(s.MONTH2.substantive.p90Min)}) |`;
    L.push('', '## C. Silence and speed (non-dropped bursts, minutes to first outbound)', '',
        '| Split | n | Actual silent | Actual med/p90 | LAUNCH silent (subst.) | LAUNCH med/p90 (subst. p90) | MONTH2 silent (subst.) | MONTH2 med/p90 (subst. p90) |', '|---|---|---|---|---|---|---|---|',
        row('All', C.all), row('In-hours', C.inHours), row('Out-of-hours', C.outOfHours));
    L.push('', `Silent = no reply in 24h. Simulated silence is zero by construction (holding line at 20 min); brackets = no substantive (non-holding) reply in 24h. Actual counts any delivered outbound; Ben alone answered ${C.all.actual.benManualReplied}/${C.all.n}, median ${n(C.all.actual.medianBenManualMin)} min.`);

    L.push('', '## D. Ben\'s taps', '', `| Scenario | Flags | Drafts | Sample reviews | Total | /working day | /working day since ${RR.since} |`, '|---|---|---|---|---|---|---|',
        `| Actual manual outbounds | – | – | – | ${D.actual.benManualOutbounds} | ${D.actual.perWorkingDay} | ${D.runRate.actual.perWorkingDay} |`,
        `| LAUNCH | ${D.LAUNCH.flags} | ${D.LAUNCH.scoperDrafts} | ${D.LAUNCH.sampleReviews} | ${D.LAUNCH.total} | ${D.LAUNCH.perWorkingDay} | ${D.runRate.LAUNCH.perWorkingDay} |`,
        `| MONTH2 | ${D.MONTH2.flags} | 0 | ${D.MONTH2.sampleReviews} | ${D.MONTH2.total} | ${D.MONTH2.perWorkingDay} | ${D.runRate.MONTH2.perWorkingDay} |`);

    const kinds = Array.from(new Set([...Object.keys(E.LAUNCH.byKind), ...Object.keys(E.MONTH2.byKind)]));
    L.push('', '## E. Automatic sends', '', `| Kind | LAUNCH | /day since ${RR.since} | MONTH2 | /day since ${RR.since} |`, '|---|---|---|---|---|');
    for (const k of kinds) L.push(`| ${k} | ${E.LAUNCH.byKind[k] || 0} | ${E.runRate.LAUNCH.byKindPerDay[k] || 0} | ${E.MONTH2.byKind[k] || 0} | ${E.runRate.MONTH2.byKindPerDay[k] || 0} |`);
    L.push(`| **All** | ${E.LAUNCH.total} | ${E.runRate.LAUNCH.perDay} | ${E.MONTH2.total} | ${E.runRate.MONTH2.perDay} |`);

    const cw = Object.keys(F.perWeek);
    L.push('', `## F. Inbound calls per week (${F.total}: ${F.answered} answered, ${F.missed} missed)`, '',
        '| Week of | ' + cw.map(k => k.slice(5)).join(' | ') + ' |', '|' + '---|'.repeat(cw.length + 1),
        '| Answered = clerk prefill | ' + cw.map(k => F.perWeek[k].answered).join(' | ') + ' |',
        '| Missed = post-call template | ' + cw.map(k => F.perWeek[k].missed).join(' | ') + ' |');

    L.push('', '## G. Model calls (counts)', '', `| Model | LAUNCH | /day since ${RR.since} | MONTH2 | /day since ${RR.since} |`, '|---|---|---|---|---|');
    for (const k of ['triage_haiku', 'scoper_sonnet', 'clerk_sonnet', 'auditor_opus', 'total']) L.push(`| ${k} | ${G.LAUNCH[k]} | ${G.runRate.LAUNCH.perDay[k]} | ${G.MONTH2[k]} | ${G.runRate.MONTH2.perDay[k]} |`);
    L.push(`Clerk = ${F.answered} answered calls + ${G.threadsWith2plusScoperBursts} threads with 2+ scoper bursts.`);

    const code = (s: string) => ({ ben_manual: 'Ben', silence_breaker: 'hold', flag_expiry_holding: 'flag-hold', scoper_draft_approved: 'draft ok', scoper_send: 'scoper', none: '–' } as any)[s] || (s.startsWith('receptionist') ? 'ack' : s);
    L.push('', '## H. Ten example bursts', '', 'Desk = what fires, then minutes to first reply LAUNCH / MONTH2.', '', '| Case | Who | UK time | Excerpt | Actual | Lane | Desk |', '|---|---|---|---|---|---|---|');
    for (const e of R.H_examples) {
        if (!e.found) { L.push(`| ${e.label} | – | – | none in window | | | |`); continue; }
        const fires = e.LAUNCH.sends.replace(/ @ \w{3} /g, ' @ ').replace(/receptionist/g, 'ack').replace(/silence_breaker/g, 'hold').replace(/flag_expiry_holding/g, 'flag-hold');
        const desk = e.lane === 'dropped' ? 'nothing' : `${fires} → ${n(e.LAUNCH.firstResponse)} (${code(e.LAUNCH.by)}) / ${n(e.MONTH2.firstResponse)} (${code(e.MONTH2.by)})`;
        L.push(`| ${e.label} | ${e.name} …${e.phoneLast3} | ${e.ukTime} | ${e.excerpt.slice(0, 48).replace(/\|/g, '/').replace(/\n+/g, ' ')} | ${e.actual.replace('ben_manual', 'Ben')} | ${e.lane.replace('receptionist_send', 'receptionist')}${e.subTypes.length ? ' (' + e.subTypes[0] + ')' : ''}${e.template === 'ack_photos' ? ' (photos)' : ''} | ${desk} |`);
    }

    L.push('', '## I. Caveats', '');
    for (const c of R.I_caveats) L.push(`- ${c}`);
    return L.join('\n') + '\n';
}
main().then(() => process.exit(0)).catch(e => { console.error('replay failed:', e); process.exit(1); });
