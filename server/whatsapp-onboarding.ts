/**
 * WhatsApp coexistence onboarding (Embedded Signup).
 *
 * Brings +447508744402 — a real SIM already running the WhatsApp Business app — onto the Cloud API
 * WITHOUT taking it off the handset. Meta calls this "Coexistence"; it is enabled by launching
 * Embedded Signup with extras.featureType = "whatsapp_business_app_onboarding".
 *
 * Why this exists rather than just registering the number: a number can normally only be on the
 * Business app OR the API, and switching means deleting the app account and losing history. The
 * coexistence flow keeps both, and syncs messages between them.
 *
 * Direction matters: coexistence only works app -> Cloud API. It cannot be applied to a number
 * that is already API-only, which is why +447449501762 (a Twilio number, no SIM) can never do this.
 *
 * Flow:
 *   1. Browser launches Embedded Signup -> user confirms on the handset -> returns an exchangeable
 *      code plus waba_id and phone_number_id.
 *   2. This module swaps the code for a business token server-to-server (the code is short-lived
 *      and single-use; the exchange MUST NOT happen in the browser because it needs the app secret).
 *   3. Registers the phone number for Cloud API and subscribes our app to the WABA's webhooks.
 */
import { Router } from 'express';
import { db } from './db';
import { appSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from './auth';

export const whatsappOnboardingRouter = Router();

const GRAPH = 'https://graph.facebook.com/v21.0';
const SETTING_KEY = 'whatsapp_coexistence_sender';

/** Public config the browser needs. The app secret is NEVER sent to the client. */
export function getOnboardingConfig() {
    return {
        appId: process.env.META_APP_ID || '',
        configId: process.env.META_ES_CONFIG_ID || '',
        hasSecret: !!process.env.META_APP_SECRET,
    };
}

export type CoexistenceSender = {
    phoneNumberId: string;
    wabaId: string;
    displayPhoneNumber?: string;
    /** Business token from the code exchange. Long-lived but revocable. */
    accessToken: string;
    onboardedAt: string;
};

export async function getCoexistenceSender(): Promise<CoexistenceSender | null> {
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY));
        return (row?.value as CoexistenceSender) ?? null;
    } catch {
        return null;
    }
}

async function saveCoexistenceSender(sender: CoexistenceSender) {
    await db.insert(appSettings)
        .values({
            id: SETTING_KEY,
            key: SETTING_KEY,
            value: sender,
            description: 'WhatsApp coexistence sender onboarded via Embedded Signup (see server/whatsapp-onboarding.ts)',
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: sender, updatedAt: new Date() } });
}

/** Redacts a token for logging — never log the whole thing. */
const redact = (t: string) => (t ? `${t.slice(0, 6)}…${t.slice(-4)} (${t.length} chars)` : '(empty)');

// GET /api/whatsapp/onboard/config — public bits the launcher page needs.
whatsappOnboardingRouter.get('/onboard/config', requireAdmin, (_req, res) => {
    const cfg = getOnboardingConfig();
    res.json({
        ...cfg,
        ready: !!cfg.appId && !!cfg.configId && cfg.hasSecret,
        missing: [
            !cfg.appId && 'META_APP_ID',
            !cfg.configId && 'META_ES_CONFIG_ID',
            !cfg.hasSecret && 'META_APP_SECRET',
        ].filter(Boolean),
    });
});

// GET /api/whatsapp/onboard/status — what is currently onboarded, if anything.
whatsappOnboardingRouter.get('/onboard/status', requireAdmin, async (_req, res) => {
    const sender = await getCoexistenceSender();
    if (!sender) return res.json({ onboarded: false });

    // Read the live state back from Meta rather than trusting what we stored at onboarding time.
    try {
        const r = await fetch(
            `${GRAPH}/${sender.phoneNumberId}?fields=display_phone_number,verified_name,platform_type,status,quality_rating,code_verification_status`,
            { headers: { Authorization: `Bearer ${sender.accessToken}` } }
        );
        const live = await r.json();
        res.json({ onboarded: true, stored: { ...sender, accessToken: redact(sender.accessToken) }, live });
    } catch (e: any) {
        res.json({ onboarded: true, stored: { ...sender, accessToken: redact(sender.accessToken) }, liveError: e?.message });
    }
});

// GET /api/whatsapp/onboard/diagnose — ask Meta directly why the flow won't launch.
//
// FB.login() fails silently when the app is misconfigured: no popup, no callback, no error. The
// browser cannot see why. The server can, because it holds the app secret and can mint an app
// access token to inspect the app's own configuration.
whatsappOnboardingRouter.get('/onboard/diagnose', requireAdmin, async (_req, res) => {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const configId = process.env.META_ES_CONFIG_ID;

    if (!appId || !appSecret) return res.status(500).json({ error: 'META_APP_ID / META_APP_SECRET not set' });

    const appToken = `${appId}|${appSecret}`;
    const checks: Record<string, any> = {};

    const get = async (path: string, label: string) => {
        try {
            const r = await fetch(`${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(appToken)}`);
            const body = await r.json();
            checks[label] = { ok: r.ok, status: r.status, body };
        } catch (e: any) {
            checks[label] = { ok: false, error: e?.message };
        }
    };

    // Does the app exist and what is it called?
    await get(`${appId}?fields=id,name,category,link,app_domains,auth_dialog_data_help_url`, 'app');
    // Is the Embedded Signup login configuration real, and what type is it?
    if (configId) await get(`${configId}`, 'login_configuration');
    // Which products are enabled — Facebook Login for Business must be one of them.
    await get(`${appId}/subscribed_domains`, 'subscribed_domains');

    res.json({
        appId,
        configId: configId || null,
        checks,
        hint:
            'login_configuration must resolve. If it 404s, the config_id belongs to a different app ' +
            'or was deleted. app_domains must contain the exact hostname serving the page ' +
            '(www counts separately), and Allowed Domains for the JavaScript SDK is a SEPARATE ' +
            'setting under Facebook Login for Business > Settings.',
    });
});

// POST /api/whatsapp/onboard/exchange — the server-to-server half of Embedded Signup.
whatsappOnboardingRouter.post('/onboard/exchange', requireAdmin, async (req, res) => {
    const { code, wabaId, phoneNumberId, pin } = req.body || {};
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
        return res.status(500).json({ error: 'META_APP_ID / META_APP_SECRET not configured on the server' });
    }
    if (!code) return res.status(400).json({ error: "Missing 'code' from Embedded Signup" });
    if (!wabaId || !phoneNumberId) {
        return res.status(400).json({ error: "Missing 'wabaId' or 'phoneNumberId' — the signup event did not return them" });
    }

    const steps: Array<{ step: string; ok: boolean; detail?: any }> = [];

    try {
        // 1. Exchange the single-use code for a business token.
        const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
        tokenUrl.searchParams.set('client_id', appId);
        tokenUrl.searchParams.set('client_secret', appSecret);
        tokenUrl.searchParams.set('code', code);
        const tokenRes = await fetch(tokenUrl.toString());
        const tokenBody: any = await tokenRes.json();

        if (!tokenRes.ok || !tokenBody.access_token) {
            steps.push({ step: 'exchange_code', ok: false, detail: tokenBody });
            return res.status(400).json({ error: 'Code exchange failed', steps });
        }
        const accessToken: string = tokenBody.access_token;
        steps.push({ step: 'exchange_code', ok: true, detail: { token: redact(accessToken) } });
        console.log('[WA Onboard] Exchanged code for business token:', redact(accessToken));

        // 2. Register the number for Cloud API. Harmless if already registered — Meta returns an
        //    error we treat as non-fatal so a retry doesn't strand a half-finished onboarding.
        const regRes = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', pin: String(pin || '000000') }),
        });
        const regBody = await regRes.json();
        steps.push({ step: 'register_number', ok: regRes.ok, detail: regBody });

        // 3. Subscribe our app to this WABA's webhooks, so inbound messages reach us.
        const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const subBody = await subRes.json();
        steps.push({ step: 'subscribe_webhooks', ok: subRes.ok, detail: subBody });

        // 4. Read back what we just onboarded, so we store the real display number.
        let displayPhoneNumber: string | undefined;
        try {
            const infoRes = await fetch(`${GRAPH}/${phoneNumberId}?fields=display_phone_number`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            displayPhoneNumber = (await infoRes.json())?.display_phone_number;
        } catch { /* non-fatal */ }

        await saveCoexistenceSender({
            phoneNumberId, wabaId, displayPhoneNumber, accessToken,
            onboardedAt: new Date().toISOString(),
        });
        steps.push({ step: 'persist', ok: true });

        res.json({
            success: true,
            phoneNumberId,
            wabaId,
            displayPhoneNumber,
            // Webhook subscription is what makes inbound work; surface it plainly.
            webhooksSubscribed: subRes.ok,
            registered: regRes.ok,
            steps,
        });
    } catch (error: any) {
        console.error('[WA Onboard] Failed:', error);
        res.status(500).json({ error: error?.message || 'Onboarding failed', steps });
    }
});
