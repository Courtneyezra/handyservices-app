/**
 * One-time Google Business Profile OAuth bootstrap.
 *
 * Turns an OAuth client (id + secret) into the four GOOGLE_GBP_* env values
 * the GMB systems need (metrics pull + automated posting), including
 * auto-discovering your accounts/locations for GOOGLE_GBP_LOCATIONS.
 *
 * Prerequisites (Google Cloud Console, console.cloud.google.com):
 *   1. A project with Business Profile API access APPROVED — Google gates
 *      these APIs behind a request form and default quota is ZERO:
 *      https://developers.google.com/my-business/content/prereqs
 *   2. APIs enabled on the project: "My Business Account Management API",
 *      "My Business Business Information API", and legacy
 *      "Google My Business API" (v4 — needed for posts).
 *   3. An OAuth client of type **Desktop app** (APIs & Services → Credentials
 *      → Create credentials → OAuth client ID → Desktop app).
 *
 * Run it YOURSELF in a terminal (it opens a browser consent screen for the
 * Google account that manages the Business Profile):
 *
 *   npx tsx scripts/_gbp-oauth-setup.ts <client_id> <client_secret>
 *
 * It prints the env lines to copy into .env and the production host.
 */
import http from 'node:http';
import { execSync } from 'node:child_process';

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
    console.error('Usage: npx tsx scripts/_gbp-oauth-setup.ts <client_id> <client_secret>');
    process.exit(1);
}

function waitForCode(): Promise<string> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? '/', REDIRECT_URI);
            const code = url.searchParams.get('code');
            const err = url.searchParams.get('error');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(code
                ? '<h2>Done — you can close this tab and go back to the terminal.</h2>'
                : `<h2>Authorization failed: ${err ?? 'no code returned'}</h2>`);
            server.close();
            if (code) resolve(code);
            else reject(new Error(`OAuth consent failed: ${err ?? 'no code returned'}`));
        });
        server.listen(PORT, '127.0.0.1');
    });
}

async function main() {
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',   // required for a refresh token
        prompt: 'consent',        // force refresh token even on re-consent
    });

    console.log('\nOpening Google consent screen (sign in with the account that MANAGES the Business Profile)...\n');
    console.log(`If the browser does not open, visit:\n${authUrl}\n`);
    try { execSync(`open "${authUrl}"`); } catch { /* non-macOS: use the printed URL */ }

    const code = await waitForCode();

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code, client_id: clientId, client_secret: clientSecret,
            redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
        }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
    const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string };
    if (!tokens.refresh_token) {
        throw new Error('No refresh_token returned — remove the app at myaccount.google.com/permissions and rerun.');
    }
    console.log('✓ Refresh token obtained.\n');

    const auth = { Authorization: `Bearer ${tokens.access_token}` };

    // Discover accounts → locations to build GOOGLE_GBP_LOCATIONS.
    const acctRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: auth });
    if (!acctRes.ok) {
        const body = await acctRes.text();
        if (acctRes.status === 403 || acctRes.status === 429) {
            console.error('\n⚠️  Google refused the Business Profile API call. This almost always means');
            console.error('the project does NOT yet have approved Business Profile API access (quota=0).');
            console.error('Apply here (usually approved in a few days):');
            console.error('https://developers.google.com/my-business/content/prereqs#request-access\n');
        }
        throw new Error(`accounts list failed (${acctRes.status}): ${body}`);
    }
    const accounts = ((await acctRes.json()).accounts ?? []) as { name: string; accountName?: string }[];

    const locations: Record<string, string> = {};
    for (const acct of accounts) {
        const locRes = await fetch(
            `https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations?readMask=name,title&pageSize=100`,
            { headers: auth },
        );
        if (!locRes.ok) { console.warn(`  (skipping ${acct.name}: ${locRes.status})`); continue; }
        for (const loc of ((await locRes.json()).locations ?? []) as { name: string; title?: string }[]) {
            const key = (loc.title ?? 'location').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const locationId = loc.name.split('locations/')[1];
            // v4 resource path style, as seo-gmb-connector expects.
            locations[key] = `${acct.name}/locations/${locationId}`;
            console.log(`✓ Found location: "${loc.title}" → ${locations[key]}`);
        }
    }
    if (Object.keys(locations).length === 0) {
        console.warn('\n⚠️  No locations found — is this Google account a manager of the Business Profile?');
    }

    console.log('\n──── Add these to .env AND the production host env ────\n');
    console.log(`GOOGLE_GBP_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_GBP_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_GBP_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GOOGLE_GBP_LOCATIONS=${JSON.stringify(locations)}`);
    console.log('\nThen verify with:  npx tsx scripts/_gbp-verify.ts\n');
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
