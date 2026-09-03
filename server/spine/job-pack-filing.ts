/**
 * P13 part 2 — live filing: a customer message after the quote answers a pack field, or it is a
 * rescope, or it is neither.
 *
 *   1. deterministic pass   key safe / code, someone home, an on-site contact with a number, pets,
 *                           parking, delivery, prep; and "the answer to the question we just asked"
 *                           when the message is short and we asked one within a day
 *   2. rescope guard        anything touching lines, sizes, spec or supply (P9 looksLikeRescope,
 *                           plus measurements and "instead / different / another") is NEVER filed:
 *                           it is tagged `rescope` by triage and the Scoper lanes it to Ben
 *   3. the clerk decides    when the rules found nothing and the message is short, one small model
 *                           call returns {field, value} or null — restricted to the customer-fileable
 *                           delivery fields; injectable; skipped when the model is not configured
 *
 * Delivery fields file SILENTLY with a change-log row (source `customer`). The pass runs inside the
 * spine's inbound pass (server/spine/index.ts) after triage, in every mode: it never sends.
 */
import { CUSTOMER_FILEABLE, fileAnswerForQuote, getPackForConversation, isMissingTable, type JobPack } from './job-pack';
import { looksLikeRescope } from './triage';

export type FiledAnswer = { field: string; value: unknown; how: 'rule' | 'asked' | 'clerk' };
export type FilingVerdict = { kind: 'filed'; answer: FiledAnswer } | { kind: 'rescope'; why: string } | { kind: 'none'; why: string };

const RESCOPE_WORDS = /\b(\d+\s?(mm|cm|m|inch|inches|ft)\b|instead|different|another|add(?:ing)? (?:a|an|one|two|the)|also (?:do|need|want)|as well as|change (?:the|it) to|swap (?:the|it)|bigger|smaller|extra (?:door|unit|panel|line|job)|more of them)/i;
const UK_MOBILE = /(?:\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}/;

/** Pure: measurements, "instead", "another" … touch scope; never file, never edit the pack. */
export function isRescopeText(text: string): boolean {
    return looksLikeRescope(text) || RESCOPE_WORDS.test(text);
}

function sentence(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** Pure: the deterministic pass. First match wins; the field is one of CUSTOMER_FILEABLE. */
export function parseDeliveryAnswer(raw: string, ctx: { lastAskedField?: string | null } = {}): FiledAnswer | null {
    const text = sentence(raw);
    if (!text) return null;
    const lower = text.toLowerCase();

    // Key safe / lockbox / code → how we get in (+ the code itself, contractor-visible only after acceptance)
    if (/\b(key ?safe|lock ?box|key box|combination|the code|code is|code for)\b/.test(lower)) {
        const code = /\b(\d{4,6})\b/.exec(text)?.[1] ?? null;
        return { field: code ? 'job.accessCodes' : 'job.accessMethod', value: code ? `${text}` : text, how: 'rule' };
    }
    if (/\b(key (?:is )?(?:with|under|at)|neighbour (?:has|will)|next door (?:has|will)|leave (?:a|the) key|spare key)\b/.test(lower)) return { field: 'job.accessMethod', value: text, how: 'rule' };
    // Someone home / letting you in
    if (/\b(i(?:'ll| will) be (?:in|home|there|here)|i(?:'m| am) (?:in|home|here) all day|someone (?:will be|is) (?:in|home|there)|will let you in|let (?:him|them|you) in|working from home|we(?:'ll| will) be (?:in|home))\b/.test(lower)) {
        const who = /\b(my (?:husband|wife|partner|son|daughter|mum|dad|mother|father|tenant|neighbour|flatmate)|the tenant|the agent)\b/i.exec(text)?.[1];
        return who ? { field: 'job.onSiteContact', value: { name: who, phone: null, role: who.replace(/^my /i, '') }, how: 'rule' } : { field: 'job.accessMethod', value: text, how: 'rule' };
    }
    // A named contact with a mobile number
    const phone = UK_MOBILE.exec(text)?.[0] ?? null;
    if (phone) {
        const name = /\b(?:ask for|contact|speak to|call|ring|it's|its|this is|my (?:name is)?)\s+([A-Z][a-z]+)/.exec(text)?.[1] ?? /\b([A-Z][a-z]+)\b(?= (?:on|is on|will|can)\b)/.exec(text)?.[1] ?? null;
        return { field: 'job.onSiteContact', value: { name, phone: phone.replace(/[\s()]/g, ''), role: null }, how: 'rule' };
    }
    // Pets
    if (/\b(no pets|pets?|dogs?|cats?|puppy|kitten|rabbit)\b/.test(lower)) return { field: 'job.pets', value: text, how: 'rule' };
    // Parking
    if (/\b(park(?:ing)?|driveway|on the drive|permit|double yellow|car park)\b/.test(lower)) {
        if (/\bpermit\b/.test(lower)) return { field: 'job.parkingPermit', value: text, how: 'rule' };
        const cat = /\b(drive|driveway)\b/.test(lower) ? 'on_drive'
            : /\b(outside|out front|in front|on the road|on the street|street outside)\b/.test(lower) ? 'street_outside'
                : /\b(round the corner|down the road|nearby|few doors|couple of doors|side street|next street)\b/.test(lower) ? 'street_within_50m'
                    : /\b(car park|walk|bit of a walk|no parking|nowhere to park)\b/.test(lower) ? '50m_plus' : null;
        return cat ? { field: 'job.parkingDistance', value: cat, how: 'rule' } : { field: 'job.parkingPermit', value: text, how: 'rule' };
    }
    // Delivery
    if (/\b(deliver(?:y|ed|ies)?|drop (?:it|them|off)|leave (?:it|them) (?:with|at|in|by|round)|delivery slot|when can (?:it|they) come)\b/.test(lower)) return { field: 'job.deliverySlot', value: text, how: 'rule' };
    // Prep
    if (/\b(i(?:'ll| will) (?:clear|move|empty|take down|take (?:the|everything) out)|we(?:'ll| will) (?:clear|move|empty)|cleared|emptied|moved the)\b/.test(lower)) return { field: 'job.prep', value: text, how: 'rule' };
    // Floor / lift / occupied
    if (/\b(\d+)(?:st|nd|rd|th) floor\b/.test(lower) || /\bground floor\b/.test(lower)) {
        const n = /\bground floor\b/.test(lower) ? 0 : Number(/\b(\d+)(?:st|nd|rd|th) floor\b/.exec(lower)?.[1]);
        return { field: 'job.floor', value: n, how: 'rule' };
    }
    if (/\b(there is a lift|there's a lift|lift works|has a lift)\b/.test(lower)) return { field: 'job.hasLift', value: true, how: 'rule' };
    if (/\b(no lift|lift is broken|stairs only)\b/.test(lower)) return { field: 'job.hasLift', value: false, how: 'rule' };

    // The answer to the question we asked yesterday, when it is short and plain.
    if (ctx.lastAskedField && CUSTOMER_FILEABLE.has(ctx.lastAskedField) && text.length <= 160 && !/\?/.test(text)) {
        if (ctx.lastAskedField === 'job.onSiteContact') return { field: 'job.onSiteContact', value: { name: text, phone: null, role: null }, how: 'asked' };
        if (ctx.lastAskedField === 'job.parkingDistance') return { field: 'job.parkingPermit', value: text, how: 'asked' };
        return { field: ctx.lastAskedField, value: text, how: 'asked' };
    }
    return null;
}

/** Pure: the whole decision for one inbound, given the deterministic result. */
export function decideFiling(text: string, rule: FiledAnswer | null): FilingVerdict {
    if (isRescopeText(text)) return { kind: 'rescope', why: 'touches scope, sizes, spec or supply' };
    if (rule) return { kind: 'filed', answer: rule };
    return { kind: 'none', why: 'no delivery answer found' };
}

export interface ClerkClassifier {
    (input: { text: string; missing: string[]; lastAskedField: string | null }): Promise<{ field: string; value: string } | null>;
}

/** The clerk's decision: one small model call, JSON only, restricted to the fileable fields. */
export async function clerkClassifier(input: { text: string; missing: string[]; lastAskedField: string | null }): Promise<{ field: string; value: string } | null> {
    const { claudeText, FAST_MODEL } = await import('../llm');
    const fields = Array.from(CUSTOMER_FILEABLE);
    const raw = await claudeText({
        model: FAST_MODEL, maxTokens: 120,
        system: `You file a customer's WhatsApp message into a job pack. Answer ONLY with JSON: {"field": <one of ${JSON.stringify(fields)}>, "value": <the customer's words, short>} when the message plainly answers one of those delivery questions (how we get in, who is on site, parking, pets, prep before we arrive, materials delivery, floor, lift, occupied, water/power). Otherwise answer null. Never invent. Anything about the WORK itself (what to do, sizes, finish, who supplies what) is NOT a delivery answer: answer null.`,
        user: `Fields still missing: ${input.missing.join(', ') || 'none'}. Last question we asked: ${input.lastAskedField ?? 'none'}.\nMessage: ${input.text.slice(0, 400)}`,
    } as any);
    const m = /\{[\s\S]*\}/.exec(raw ?? '');
    if (!m) return null;
    try {
        const j = JSON.parse(m[0]);
        if (j && typeof j.field === 'string' && CUSTOMER_FILEABLE.has(j.field) && typeof j.value === 'string' && j.value.trim()) return { field: j.field, value: j.value.trim().slice(0, 240) };
    } catch { /* not JSON */ }
    return null;
}

export interface FilingDeps {
    pack: (conversationId: string) => Promise<JobPack | null>;
    lastAsk: (conversationId: string) => Promise<{ field: string; at: Date } | null>;
    file: (quoteId: string, answer: FiledAnswer) => Promise<JobPack | null>;
    clerk: ClerkClassifier | null;
    log: (e: { kind: 'other' | 'hold'; summary: string; detail?: Record<string, unknown>; conversationId: string; source: string }) => Promise<void>;
}

export type FilingOutcome = { conversationId: string; verdict: FilingVerdict; quoteId?: string; missingAfter?: string[] } | null;

/**
 * File one inbound into the thread's pack. Null when the thread has no pack. Never throws and
 * never sends; a rescope is reported for the log only (triage already tagged it).
 */
export async function fileInboundIntoPack(input: { conversationId: string; text: string | null | undefined }, deps: FilingDeps): Promise<FilingOutcome> {
    const text = String(input.text ?? '').trim();
    if (!text) return null;
    let pack: JobPack | null;
    try { pack = await deps.pack(input.conversationId); } catch (e: any) { if (isMissingTable(e)) return null; throw e; }
    if (!pack) return null;
    const lastAsk = await deps.lastAsk(input.conversationId).catch(() => null);
    let verdict = decideFiling(text, parseDeliveryAnswer(text, { lastAskedField: lastAsk?.field ?? null }));
    if (verdict.kind === 'none' && deps.clerk && text.length <= 400) {
        try {
            const c = await deps.clerk({ text, missing: pack.missing, lastAskedField: lastAsk?.field ?? null });
            if (c) verdict = { kind: 'filed', answer: { field: c.field, value: c.value, how: 'clerk' } };
        } catch (e: any) {
            console.warn('[JobPackFiling] clerk classifier failed:', e?.message ?? e);
        }
    }
    if (verdict.kind !== 'filed') {
        if (verdict.kind === 'rescope') await deps.log({ kind: 'hold', conversationId: input.conversationId, source: 'job-pack-filing', summary: `job pack: inbound is a rescope, not filed (${verdict.why})`, detail: { quoteId: pack.quoteId, text: text.slice(0, 200) } }).catch(() => undefined);
        return { conversationId: input.conversationId, verdict, quoteId: pack.quoteId };
    }
    const after = await deps.file(pack.quoteId, verdict.answer);
    await deps.log({ kind: 'other', conversationId: input.conversationId, source: 'job-pack-filing', summary: `job pack: filed ${verdict.answer.field} from the customer (${verdict.answer.how})`, detail: { quoteId: pack.quoteId, field: verdict.answer.field, value: verdict.answer.value, missingAfter: after?.missing ?? null } }).catch(() => undefined);
    return { conversationId: input.conversationId, verdict, quoteId: pack.quoteId, missingAfter: after?.missing };
}

export async function liveFilingDeps(): Promise<FilingDeps> {
    const modelConfigured = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);
    return {
        pack: (conversationId) => getPackForConversation(conversationId),
        lastAsk: async (conversationId) => (await import('../rules-layer')).lastJobPackAsk(conversationId),
        file: (quoteId, answer) => fileAnswerForQuote({ quoteId, field: answer.field, value: answer.value, by: 'customer', source: 'customer' }),
        clerk: modelConfigured ? clerkClassifier : null,
        log: async (e) => { const { logSystemEvent } = await import('../system-events'); await logSystemEvent(e as any); },
    };
}
