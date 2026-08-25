/**
 * Mint a long-lived GSC refresh token for the SERVER-SIDE automated pull
 * (server/seo-gsc-connector.ts). This is separate from the GSC MCP's token —
 * the MCP is for interactive/Claude use; the cron needs its own server creds.
 *
 * Reuses the SAME OAuth client you already created (Desktop type). Run once:
 *
 *   npx tsx scripts/_gsc-mint-refresh-token.ts /Users/courtneebonnick/Documents/gsc_client_secrets.json
 *
 * It prints an auth URL → open it, approve (Advanced → Go to <app> if prompted),
 * and the loopback catches the code and prints the env block to paste into .env:
 *   GSC_GOOGLE_CLIENT_ID=...
 *   GSC_GOOGLE_CLIENT_SECRET=...
 *   GSC_GOOGLE_REFRESH_TOKEN=...
 *
 * Scope: webmasters.readonly (read-only Search Analytics). Then restart the
 * server — cron.ts self-activates the daily 06:00 GSC pull.
 */
import { readFileSync } from 'fs';
import http from 'http';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function main() {
    const credsPath = process.argv[2];
    if (!credsPath) {
        console.error('Usage: tsx scripts/_gsc-mint-refresh-token.ts <client_secrets.json>');
        process.exit(1);
    }
    const creds = JSON.parse(readFileSync(credsPath, 'utf8'));
    const conf = creds.installed || creds.web;
    if (!conf?.client_id || !conf?.client_secret) {
        console.error('client_secrets.json missing installed/web.client_id/client_secret');
        process.exit(1);
    }
    const { client_id, client_secret } = conf;

    // Loopback server on an ephemeral port (Desktop OAuth allows any localhost port).
    const server = http.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as any).port;
    const redirectUri = `http://127.0.0.1:${port}`;

    const authUrl =
        `${AUTH_URL}?client_id=${encodeURIComponent(client_id)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code&access_type=offline&prompt=consent` +
        `&scope=${encodeURIComponent(SCOPE)}`;

    console.log('\n1) Open this URL in your browser and approve:\n');
    console.log('   ' + authUrl + '\n');
    console.log('   (waiting for the redirect…)\n');

    const code = await new Promise<string>((resolve, reject) => {
        server.on('request', (req, res) => {
            const u = new URL(req.url || '', redirectUri);
            const c = u.searchParams.get('code');
            const err = u.searchParams.get('error');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h2>Done — you can close this tab and return to the terminal.</h2>');
            if (err) return reject(new Error(err));
            if (c) return resolve(c);
        });
        setTimeout(() => reject(new Error('timed out waiting for OAuth redirect')), 300_000);
    });

    const body = new URLSearchParams({
        code, client_id, client_secret, redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
    const res = await fetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const json = (await res.json()) as { refresh_token?: string; error?: string; error_description?: string };
    server.close();

    if (!json.refresh_token) {
        console.error('No refresh_token returned:', json.error, json.error_description || '');
        console.error('Tip: revoke prior access at myaccount.google.com/permissions then retry (prompt=consent forces it).');
        process.exit(1);
    }

    console.log('\n✅ Success. Add these to your .env, then restart the server:\n');
    console.log(`GSC_GOOGLE_CLIENT_ID=${client_id}`);
    console.log(`GSC_GOOGLE_CLIENT_SECRET=${client_secret}`);
    console.log(`GSC_GOOGLE_REFRESH_TOKEN=${json.refresh_token}`);
    console.log('');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
