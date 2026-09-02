/**
 * WhatsApp template status for /admin/staff (P6 close-out / A2). Pure: the route in
 * whatsapp-template-sync.ts reads the cache and hands the rows here.
 *
 * Two lists in one payload: every cached template (what Twilio knows), and the names the code
 * EXPECTS — the rules layer's holding line and asks (server/rules-layer.ts), the first-contact ack
 * ladder (server/first-contact-ack.ts) and the spine packs (server/spine/packs/*.ts) — each marked
 * approved / present-but-not-approved / missing. CUTOVER §0 lists these as go-live preconditions;
 * this is the page that answers them. Read-only; nothing here submits anything.
 */

export interface CachedTemplateRow {
    contentSid: string;
    name: string;
    status: string;
    category?: string | null;
    language?: string | null;
    lastCheckedAt?: Date | string | null;
    approvedAt?: Date | string | null;
    rejectionReason?: string | null;
}

/** One purpose the code needs a template for, and the names it will accept (best first). */
export interface ExpectedTemplate {
    purpose: string;
    /** Where the preference list lives. */
    usedBy: string;
    names: string[];
    /** A go-live precondition (CUTOVER §0)? Missing → NO-GO; otherwise a warning only. */
    required: boolean;
}

/**
 * The names the code reads, by purpose. Kept as data so the staff page and the go-live check
 * share one list; the source preference arrays stay where they are (they carry the copy).
 */
export const EXPECTED_TEMPLATES: ExpectedTemplate[] = [
    { purpose: 'holding line (silence / flag / draft expiry)', usedBy: 'server/rules-layer.ts HOLDING_TEMPLATE_PREFERENCE', names: ['holding_line_v1', 'holding_line'], required: true },
    { purpose: 'missed-call ack', usedBy: 'server/first-contact-ack.ts MISSED_CALL_TEMPLATE_PREFERENCE', names: ['missed_call_ack'], required: true },
    { purpose: 'ask for a photo / video', usedBy: 'server/rules-layer.ts ASK_TEMPLATE_PREFERENCE', names: ['video_request', 'job_video_request'], required: true },
    { purpose: 'ask for a postcode', usedBy: 'server/rules-layer.ts ASK_TEMPLATE_PREFERENCE', names: ['postcode_request'], required: true },
    { purpose: 'ask permission to call', usedBy: 'server/first-contact-ack.ts (call_request)', names: ['call_request'], required: true },
    { purpose: 'web enquiry ack (with context)', usedBy: 'server/spine/packs/rules-first-contact.ts', names: ['web_enquiry_ack_context'], required: false },
    { purpose: 'returning-customer ack', usedBy: 'server/spine/packs/rules-first-contact.ts', names: ['1_contact_generic'], required: false },
];

export type ExpectedState = 'approved' | 'present' | 'missing';

export interface ExpectedTemplateStatus extends ExpectedTemplate {
    state: ExpectedState;
    /** The name that satisfied it (first approved, else first present), or null. */
    resolvedName: string | null;
    /** Status per name, so the table can show "holding_line_v1 pending, holding_line missing". */
    byName: Record<string, string | 'missing'>;
}

export interface TemplateStatusPayload {
    templates: Array<{ contentSid: string; name: string; status: string; category: string | null; language: string | null; lastCheckedAt: string | null; approvedAt: string | null; rejectionReason: string | null }>;
    counts: Record<string, number>;
    lastSyncedAt: string | null;
    expected: ExpectedTemplateStatus[];
    /** Every required purpose has an approved template. */
    requiredApproved: boolean;
}

function iso(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    const t = new Date(d);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

export function shapeTemplateStatus(rows: CachedTemplateRow[], expected: ExpectedTemplate[] = EXPECTED_TEMPLATES): TemplateStatusPayload {
    const byName = new Map<string, CachedTemplateRow>();
    for (const r of rows) {
        // Prefer an approved row when a name exists twice (a resubmission next to the old one).
        const prior = byName.get(r.name);
        if (!prior || (prior.status !== 'approved' && r.status === 'approved')) byName.set(r.name, r);
    }
    const counts: Record<string, number> = {};
    let lastSynced: Date | null = null;
    for (const r of rows) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
        const at = r.lastCheckedAt ? new Date(r.lastCheckedAt) : null;
        if (at && !Number.isNaN(at.getTime()) && (!lastSynced || at > lastSynced)) lastSynced = at;
    }
    const expectedOut: ExpectedTemplateStatus[] = expected.map((e) => {
        const statuses: Record<string, string | 'missing'> = {};
        for (const n of e.names) statuses[n] = byName.get(n)?.status ?? 'missing';
        const approved = e.names.find((n) => statuses[n] === 'approved') ?? null;
        const present = e.names.find((n) => statuses[n] !== 'missing') ?? null;
        return {
            ...e,
            state: approved ? 'approved' : present ? 'present' : 'missing',
            resolvedName: approved ?? present,
            byName: statuses,
        };
    });
    const rank: Record<string, number> = { approved: 0, received: 1, pending: 1, rejected: 2, unsubmitted: 3 };
    return {
        templates: rows
            .slice()
            .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name))
            .map((r) => ({
                contentSid: r.contentSid, name: r.name, status: r.status, category: r.category ?? null, language: r.language ?? null,
                lastCheckedAt: iso(r.lastCheckedAt), approvedAt: iso(r.approvedAt), rejectionReason: r.rejectionReason ?? null,
            })),
        counts,
        lastSyncedAt: lastSynced ? lastSynced.toISOString() : null,
        expected: expectedOut,
        requiredApproved: expectedOut.every((e) => !e.required || e.state === 'approved'),
    };
}
