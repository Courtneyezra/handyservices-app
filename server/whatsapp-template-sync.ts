/**
 * WhatsApp template approval sync — because Twilio has no webhook for it.
 *
 * Meta approves (or rejects) a submitted template hours to days later. Twilio exposes that only
 * through the Content API, and pushes nothing, so the ONLY way to know is to ask. This module
 * polls hourly (see server/cron.ts), caches every template's status in `whatsapp_templates`,
 * records each transition in `whatsapp_template_events`, and fires a Pushover alert when a
 * template flips to approved or rejected — approvals unlock outreach, rejections need a rewrite,
 * and both used to be discovered by accident.
 *
 * The poll is two calls per template: the list endpoint carries name/body/variables, and
 * `/Content/{sid}/ApprovalRequests` carries the WhatsApp status and category. Read-only, no LLM,
 * no sends, so it runs ungated.
 *
 * Everything else in the app reads the CACHE, never Twilio: `findApprovedTemplate('quote_ready_link')`
 * is how a send path asks "can I use this yet?" without an API round trip on every request.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import {
    whatsappTemplates, whatsappTemplateEvents, conversations, personalizedQuotes,
} from '@shared/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { notifyTemplateStatus } from './pushover';
import { sendWhatsAppMessage, canSendFreeform } from './meta-whatsapp';
import { renderQuickReply } from './quick-replies';

export const whatsappTemplatesRouter = Router();

const CONTENT_API = 'https://content.twilio.com/v1';

/** Statuses Twilio/Meta can report. Anything unrecognised is stored verbatim. */
export type TemplateStatus = 'approved' | 'pending' | 'received' | 'rejected' | 'unsubmitted' | string;

export interface FetchedTemplate {
    contentSid: string;
    name: string;
    status: TemplateStatus;
    category: string | null;
    language: string | null;
    body: string | null;
    variables: Record<string, string> | null;
    rejectionReason: string | null;
}

function authHeader(): string {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — cannot poll template status');
    return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

/**
 * Pull the template body out of Twilio's `types` map. Text templates are the common case here;
 * card/quick-reply types keep their body under the same key, so this covers those too.
 */
function extractBody(types: Record<string, any> | undefined): string | null {
    if (!types) return null;
    for (const value of Object.values(types)) {
        if (value && typeof value.body === 'string') return value.body;
    }
    return null;
}

/**
 * Fetch every template on the account with its live WhatsApp approval status.
 * Paginates the list endpoint, then asks for each template's approval record.
 */
export async function fetchTwilioTemplates(): Promise<FetchedTemplate[]> {
    const Authorization = authHeader();

    const contents: any[] = [];
    let url: string | null = `${CONTENT_API}/Content?PageSize=100`;
    while (url) {
        const res: Response = await fetch(url, { headers: { Authorization } });
        if (!res.ok) throw new Error(`Twilio Content list failed (${res.status}): ${await res.text().catch(() => '')}`);
        const page: any = await res.json();
        contents.push(...(page.contents ?? []));
        url = page.meta?.next_page_url ?? null;
    }

    // Approval status is a separate call per template. Sequential-ish batching keeps us well
    // inside Twilio's rate limits without making an hourly job take minutes.
    const out: FetchedTemplate[] = [];
    const BATCH = 8;
    for (let i = 0; i < contents.length; i += BATCH) {
        const batch = await Promise.all(contents.slice(i, i + BATCH).map(async (c: any): Promise<FetchedTemplate> => {
            let wa: any = {};
            try {
                const r = await fetch(`${CONTENT_API}/Content/${c.sid}/ApprovalRequests`, { headers: { Authorization } });
                if (r.ok) wa = ((await r.json()) as any).whatsapp ?? {};
            } catch (e) {
                // A single failed lookup must not lose the whole sync; it reads as unsubmitted
                // this round and self-corrects next hour.
                console.warn(`[TemplateSync] Approval lookup failed for ${c.sid}:`, e);
            }
            return {
                contentSid: c.sid,
                name: wa.name || c.friendly_name || c.sid,
                status: wa.status || 'unsubmitted',
                category: wa.category || null,
                language: c.language || null,
                body: extractBody(c.types),
                variables: c.variables && Object.keys(c.variables).length ? c.variables : null,
                rejectionReason: wa.rejection_reason || null,
            };
        }));
        out.push(...batch);
    }
    return out;
}

export interface TemplateTransition {
    contentSid: string;
    name: string;
    from: string | null;
    to: string;
    reason: string | null;
}

export interface SyncOutcome {
    checked: number;
    new: number;
    transitions: TemplateTransition[];
    counts: Record<string, number>;
    notified: number;
    error?: string;
}

/**
 * Poll Twilio, update the cache, record transitions, alert on approve/reject.
 *
 * First sight of a template is recorded as a transition from null, but never alerts: a fresh DB
 * would otherwise fire one push per already-approved template. Alerts are for genuine movement
 * out of a known previous status, which is the thing nobody can otherwise see.
 */
export async function syncWhatsAppTemplates(trigger: string = 'manual'): Promise<SyncOutcome> {
    const fetched = await fetchTwilioTemplates();
    const existing = await db.select().from(whatsappTemplates);
    const byId = new Map(existing.map((t) => [t.contentSid, t]));

    const transitions: TemplateTransition[] = [];
    const counts: Record<string, number> = {};
    let created = 0;
    let notified = 0;
    const now = new Date();

    for (const t of fetched) {
        counts[t.status] = (counts[t.status] ?? 0) + 1;
        const prior = byId.get(t.contentSid);
        const changed = !prior || prior.status !== t.status;

        if (!prior) {
            created++;
            await db.insert(whatsappTemplates).values({
                contentSid: t.contentSid,
                name: t.name,
                status: t.status,
                category: t.category,
                language: t.language,
                body: t.body,
                variables: t.variables,
                rejectionReason: t.rejectionReason,
                firstSeenAt: now,
                lastCheckedAt: now,
                statusChangedAt: now,
                approvedAt: t.status === 'approved' ? now : null,
            });
        } else {
            await db.update(whatsappTemplates).set({
                name: t.name,
                status: t.status,
                category: t.category,
                language: t.language,
                body: t.body,
                variables: t.variables,
                rejectionReason: t.rejectionReason,
                lastCheckedAt: now,
                ...(changed ? { statusChangedAt: now } : {}),
                ...(t.status === 'approved' && !prior.approvedAt ? { approvedAt: now } : {}),
            }).where(eq(whatsappTemplates.contentSid, t.contentSid));
        }

        if (!changed) continue;

        const transition: TemplateTransition = {
            contentSid: t.contentSid,
            name: t.name,
            from: prior?.status ?? null,
            to: t.status,
            reason: t.rejectionReason,
        };
        transitions.push(transition);

        // Alert only on real movement into a terminal state. A first-sight row (from === null)
        // is bookkeeping, not news — otherwise the first ever sync pushes ten notifications.
        const isNews = !!prior && (t.status === 'approved' || t.status === 'rejected');
        if (isNews) {
            try {
                await notifyTemplateStatus({
                    name: t.name,
                    status: t.status === 'approved' ? 'approved' : 'rejected',
                    category: t.category,
                    reason: t.rejectionReason,
                    body: t.body,
                });
                notified++;
            } catch (e) {
                console.warn('[TemplateSync] Pushover notify failed:', e);
            }
        }

        await db.insert(whatsappTemplateEvents).values({
            id: uuidv4(),
            contentSid: t.contentSid,
            name: t.name,
            fromStatus: prior?.status ?? null,
            toStatus: t.status,
            reason: t.rejectionReason,
            notified: isNews,
            createdAt: now,
        });

        console.log(`[TemplateSync] ${t.name}: ${prior?.status ?? 'new'} → ${t.status}${t.rejectionReason ? ` (${t.rejectionReason})` : ''}`);
    }

    console.log(`[TemplateSync] ${trigger}: checked ${fetched.length}, ${created} new, ${transitions.length} transitions, ${notified} alerts ` +
        `(${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`);

    return { checked: fetched.length, new: created, transitions, counts, notified };
}

// ---------------------------------------------------------------- reads

/** Every cached template, approved first, then pending, then the rest. */
export async function getCachedTemplates() {
    const rows = await db.select().from(whatsappTemplates);
    const rank: Record<string, number> = { approved: 0, received: 1, pending: 1, rejected: 2, unsubmitted: 3 };
    return rows.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name));
}

/** Templates Meta has approved — the only ones deliverable outside the 24h window. */
export async function getApprovedTemplates() {
    return db.select().from(whatsappTemplates)
        .where(eq(whatsappTemplates.status, 'approved'))
        .orderBy(asc(whatsappTemplates.name));
}

/**
 * Look up ONE approved template by name at runtime.
 *
 * Send paths call this rather than hardcoding a SID, because a template that is pending today is
 * approved tomorrow and rejected the day after. Returns null when it is not (yet) approved, which
 * is the caller's cue to take its fallback path.
 */
export async function findApprovedTemplate(name: string) {
    const [row] = await db.select().from(whatsappTemplates)
        .where(and(eq(whatsappTemplates.name, name), eq(whatsappTemplates.status, 'approved')))
        .limit(1);
    return row ?? null;
}

/** How many {{n}} placeholders the body actually uses, ignoring the sample map. */
export function placeholderIndexes(body: string | null | undefined): string[] {
    if (!body) return [];
    const found = new Set<string>();
    for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(m[1]);
    return [...found].sort((a, b) => Number(a) - Number(b));
}

export type VariableHint = 'name' | 'link' | 'text';

/**
 * Guess what each variable is for, so the UI and the quote send path can prefill instead of
 * making a human retype a name and paste a link. Twilio's stored sample value is the strongest
 * signal (it is what the template author submitted), the surrounding body text is the fallback.
 */
export function variableHints(body: string | null, variables: Record<string, string> | null): Record<string, VariableHint> {
    const hints: Record<string, VariableHint> = {};
    const indexes = placeholderIndexes(body);
    const keys = indexes.length ? indexes : Object.keys(variables ?? {});
    for (const key of keys) {
        const sample = String(variables?.[key] ?? '');
        if (/^https?:\/\//i.test(sample) || /\bhandyservices\.app\b/i.test(sample)) { hints[key] = 'link'; continue; }
        // "Hi {{1}}," — a placeholder sitting right after a greeting is the customer's name.
        const greeted = body && new RegExp(`\\b(hi|hey|hello|morning|afternoon)[,!]?\\s*\\{\\{\\s*${key}\\s*\\}\\}`, 'i').test(body);
        if (greeted || key === '1') { hints[key] = 'name'; continue; }
        hints[key] = 'text';
    }
    return hints;
}

/** Render a template body with a positional variable map, for previews and thread records. */
export function renderTemplateBody(body: string | null, vars: Record<string, string>): string {
    if (!body) return '';
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, k) => vars[k] ?? `{{${k}}}`);
}

/**
 * Build the positional variable map for a template from what we know about the customer.
 * Hint-driven rather than position-driven, so a template whose author put the link first still
 * gets the link, not the name.
 */
export function buildTemplateVariables(
    template: { body: string | null; variables: unknown },
    known: { firstName?: string | null; quoteUrl?: string | null }
): Record<string, string> {
    const vars = (template.variables as Record<string, string> | null) ?? null;
    const hints = variableHints(template.body, vars);
    const out: Record<string, string> = {};
    for (const [key, hint] of Object.entries(hints)) {
        // Placeholder names ("Website Visitor", "Unknown") degrade to 'there' — "Hi Website,
        // thanks for getting in touch" reached a real customer on 21 Aug 2026. Regex kept in
        // sync with isPlaceholderName in first-contact-ack.ts (inlined: import would cycle).
        if (hint === 'name') {
            const first = known.firstName?.trim().split(/\s+/)[0] || '';
            const placeholder = !first || /^\+?\d/.test(first) || /^(unknown|customer|caller|test|website|web$|visitor|lead|enquiry)/i.test(first);
            out[key] = placeholder ? 'there' : first;
        }
        else if (hint === 'link') out[key] = known.quoteUrl || String(vars?.[key] ?? '');
        else out[key] = String(vars?.[key] ?? '');
    }
    return out;
}

// ---------------------------------------------------------------- routes
// Mounted at /api/whatsapp-templates behind requireAdmin (see server/index.ts).

const digitsOf = (value: string) => value.replace('@c.us', '').replace(/\D/g, '');

/** GET / — the full cached picture, for the status panel. */
whatsappTemplatesRouter.get('/', async (_req, res) => {
    try {
        const templates = await getCachedTemplates();
        const events = await db.select().from(whatsappTemplateEvents)
            .orderBy(desc(whatsappTemplateEvents.createdAt)).limit(20);
        const counts: Record<string, number> = {};
        for (const t of templates) counts[t.status] = (counts[t.status] ?? 0) + 1;
        const lastCheckedAt = templates.reduce<Date | null>((latest, t) => {
            const at = t.lastCheckedAt ? new Date(t.lastCheckedAt) : null;
            return at && (!latest || at > latest) ? at : latest;
        }, null);
        res.json({
            templates: templates.map((t) => ({ ...t, hints: variableHints(t.body, t.variables as any) })),
            counts,
            events,
            lastCheckedAt,
        });
    } catch (error: any) {
        console.error('[TemplateSync] List failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to load templates' });
    }
});

/** POST /sync — poll Twilio now. Read-only against Twilio; safe to hammer. */
whatsappTemplatesRouter.post('/sync', async (_req, res) => {
    try {
        const outcome = await syncWhatsAppTemplates('manual');
        res.json(outcome);
    } catch (error: any) {
        console.error('[TemplateSync] Manual sync failed:', error);
        res.status(502).json({ error: error?.message || 'Template sync failed' });
    }
});

/**
 * GET /for-conversation/:id — approved templates, prefilled for THIS thread.
 *
 * Prefill is the whole point: the composer should offer "Hi Marc, your quote is ready … <link>"
 * ready to send, not an empty form. Name comes from the conversation, the link from the newest
 * quote on that phone number.
 */
whatsappTemplatesRouter.get('/for-conversation/:id', async (req, res) => {
    try {
        const [conv] = await db.select().from(conversations).where(eq(conversations.id, req.params.id));
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const convDigits = digitsOf(conv.phoneNumber);
        const firstName = renderQuickReply('{{first_name}}', conv.contactName);

        // Newest non-draft quote on this number — a draft quote has no customer-facing link yet.
        let quoteUrl: string | null = null;
        let quoteSlug: string | null = null;
        if (convDigits) {
            const quotes = await db.select({
                slug: personalizedQuotes.shortSlug,
                phone: personalizedQuotes.phone,
                isDraft: personalizedQuotes.isDraft,
                createdAt: personalizedQuotes.createdAt,
            })
                .from(personalizedQuotes)
                .orderBy(desc(personalizedQuotes.createdAt))
                .limit(400);
            const match = quotes.find((q) => q.slug && !q.isDraft && digitsOf(q.phone || '') === convDigits);
            if (match?.slug) {
                quoteSlug = match.slug;
                quoteUrl = `${process.env.BASE_URL || 'https://handyservices.app'}/quote/${match.slug}`;
            }
        }

        const approved = await getApprovedTemplates();
        res.json({
            windowOpen: await canSendFreeform(conv.phoneNumber).catch(() => false),
            contactName: conv.contactName,
            firstName,
            quoteSlug,
            quoteUrl,
            templates: approved.map((t) => {
                const prefill = buildTemplateVariables(t, { firstName, quoteUrl });
                return {
                    contentSid: t.contentSid,
                    name: t.name,
                    category: t.category,
                    body: t.body,
                    hints: variableHints(t.body, t.variables as any),
                    prefill,
                    preview: renderTemplateBody(t.body, prefill),
                    // A link template with no quote on this thread would send a dead placeholder.
                    missing: Object.entries(prefill).filter(([, v]) => !v.trim()).map(([k]) => k),
                };
            }),
        });
    } catch (error: any) {
        console.error('[TemplateSync] Conversation templates failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to load templates for this conversation' });
    }
});

/**
 * POST /send — send one APPROVED template.
 *
 * Status is re-checked against the cache here rather than trusted from the client: the picker's
 * list may be minutes old, and sending an unapproved template is a Meta violation, not a 400.
 */
whatsappTemplatesRouter.post('/send', async (req, res) => {
    try {
        const { conversationId, contentSid, variables, via } = req.body || {};
        if (!contentSid) return res.status(400).json({ error: "Missing 'contentSid'" });

        let phone: string | null = req.body?.phone ? String(req.body.phone) : null;
        let contactName: string | null = null;
        if (conversationId) {
            const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
            if (!conv) return res.status(404).json({ error: 'Conversation not found' });
            phone = conv.phoneNumber;
            contactName = conv.contactName;
        }
        if (!phone) return res.status(400).json({ error: "Missing 'conversationId' or 'phone'" });

        const [template] = await db.select().from(whatsappTemplates)
            .where(eq(whatsappTemplates.contentSid, String(contentSid)));
        if (!template) return res.status(404).json({ error: 'Template not in the cache — run a sync first' });
        if (template.status !== 'approved') {
            return res.status(409).json({
                error: 'NOT_APPROVED',
                message: `"${template.name}" is ${template.status} with Meta, so it cannot be sent yet.`,
            });
        }

        const vars: Record<string, string> = variables && typeof variables === 'object'
            ? Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, String(v ?? '')]))
            : buildTemplateVariables(template, { firstName: renderQuickReply('{{first_name}}', contactName) });

        const empty = Object.entries(vars).filter(([, v]) => !v.trim()).map(([k]) => k);
        if (empty.length) {
            return res.status(400).json({
                error: 'MISSING_VARIABLES',
                message: `Fill in variable${empty.length > 1 ? 's' : ''} ${empty.join(', ')} before sending.`,
            });
        }

        // The rendered text is passed as the body so the thread records what the customer will
        // actually read, rather than an opaque template SID.
        const rendered = renderTemplateBody(template.body, vars);
        const result: any = await sendWhatsAppMessage(phone, rendered, {
            contentSid: template.contentSid,
            contentVariables: vars,
            via: via === 'meta' ? 'meta' : 'twilio',
        });

        res.json({ success: true, mode: 'template', rendered, sid: result?.sid, status: result?.status });
    } catch (error: any) {
        console.error('[TemplateSync] Template send failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to send template' });
    }
});
