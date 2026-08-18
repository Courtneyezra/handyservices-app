/**
 * The approved-template registry, read from Twilio at runtime.
 *
 * Templates are the ONLY thing we can send once WhatsApp's 24-hour window has shut, and whether
 * a given template may be sent is Meta's decision, not ours — a SID that is pending review today
 * is approved next week and rejected the week after. So nothing here hardcodes a SID: callers ask
 * for a template BY NAME, and get it back only if Twilio currently reports it approved.
 *
 * Twilio has no push webhook for approval status, so this polls `ContentAndApprovals` (one call
 * returns content, variables, body and WhatsApp status together) and caches for a few minutes.
 * Every failure path returns "no template", because the caller's fallback is to queue a draft for
 * a human — the one outcome we never want is sending against a status we could not verify.
 */

export interface WhatsAppTemplate {
    sid: string;
    name: string;
    /** Twilio's WhatsApp approval status: approved | pending | received | rejected | unknown. */
    status: string;
    category: string;
    /** Ordered placeholder names, index 1..n as Twilio reports them. */
    variableCount: number;
    /** The approved body, with {{1}}-style placeholders still in it. */
    body: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; templates: WhatsAppTemplate[] } | null = null;

/** Substitute {{1}}, {{2}}… so the thread and the draft record what the customer actually saw. */
export function renderTemplateBody(body: string, variables: Record<string, string>): string {
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, idx) => variables[String(idx)] ?? m);
}

/**
 * Every content template on the account with its current WhatsApp approval status.
 * Returns [] rather than throwing — see the file header: unverifiable means unusable.
 */
export async function listWhatsAppTemplates(opts: { force?: boolean } = {}): Promise<WhatsAppTemplate[]> {
    if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.templates;

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
        console.warn('[Templates] No Twilio credentials — treating every template as unavailable.');
        return [];
    }

    try {
        const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
        const res = await fetch('https://content.twilio.com/v1/ContentAndApprovals?PageSize=100', {
            headers: { Authorization: auth },
        });
        if (!res.ok) {
            console.warn(`[Templates] Twilio returned ${res.status} — treating every template as unavailable.`);
            return [];
        }
        const contents: any[] = ((await res.json()) as any).contents ?? [];
        const templates: WhatsAppTemplate[] = contents.map((c) => ({
            sid: c.sid,
            name: c.friendly_name,
            status: c.approval_requests?.status ?? 'unknown',
            category: c.approval_requests?.category ?? '',
            variableCount: Object.keys(c.variables ?? {}).length,
            body: c.types?.['twilio/text']?.body ?? '',
        }));
        cache = { at: Date.now(), templates };
        return templates;
    } catch (error: any) {
        console.warn('[Templates] Lookup failed, treating every template as unavailable:', error?.message);
        return [];
    }
}

/**
 * The first template from `preferredNames` that is approved RIGHT NOW and that we can fill from
 * `values` (supplied in order; a template needing more variables than we have is skipped rather
 * than sent with a hole in it).
 *
 * Preference order is the caller's editorial judgement; approval status is Meta's. Both have to
 * agree before anything sends.
 */
export async function findApprovedTemplate(
    preferredNames: string[],
    values: string[] = [],
): Promise<{ template: WhatsAppTemplate; variables: Record<string, string>; body: string } | null> {
    const templates = await listWhatsAppTemplates();
    if (!templates.length) return null;

    for (const name of preferredNames) {
        const t = templates.find((x) => x.name === name && x.status === 'approved');
        if (!t) continue;
        if (t.variableCount > values.length) {
            console.warn(`[Templates] '${name}' needs ${t.variableCount} variables, we have ${values.length} — skipping.`);
            continue;
        }
        const variables: Record<string, string> = {};
        for (let i = 0; i < t.variableCount; i++) variables[String(i + 1)] = values[i];
        return { template: t, variables, body: renderTemplateBody(t.body, variables) };
    }
    return null;
}
