/**
 * Verify the GOOGLE_GBP_* credentials end-to-end WITHOUT posting anything:
 *   1. env vars present and GOOGLE_GBP_LOCATIONS parses
 *   2. refresh token still exchanges for an access token
 *   3. each configured location is readable via the v4 API (same surface the
 *      posting client uses — if this works, localPosts will too)
 *
 *   npx tsx scripts/_gbp-verify.ts
 */
import 'dotenv/config';
import { readGbpEnv, getGbpAccessToken } from '../server/seo-gmb-connector';

async function main() {
    const env = readGbpEnv();
    if (!env) process.exit(1); // readGbpEnv already logged what's missing

    console.log(`✓ Env configured — ${env.locations.length} location(s): ${env.locations.map((l) => l.key).join(', ')}`);

    const token = await getGbpAccessToken(env);
    console.log('✓ OAuth refresh works — access token obtained.');

    for (const loc of env.locations) {
        const res = await fetch(
            `https://mybusiness.googleapis.com/v4/${loc.resourceName}/localPosts?pageSize=1`,
            { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
            const count = ((await res.json()).localPosts ?? []).length;
            console.log(`✓ ${loc.key}: v4 localPosts readable (${count === 0 ? 'no posts yet' : 'has existing posts'}).`);
        } else {
            console.error(`✗ ${loc.key}: localPosts read failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
            if (res.status === 403 || res.status === 429) {
                console.error('  → Project likely lacks approved Business Profile API access, or the');
                console.error('    legacy "Google My Business API" (v4) is not enabled on the project.');
            }
            process.exitCode = 1;
        }
    }

    if (process.exitCode !== 1) {
        console.log('\nAll good. Posting will self-activate: cron Mon/Wed/Fri 10:05 once deployed,');
        console.log('or trigger one now with:  npx tsx scripts/_gmb-post-once.ts');
    }
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
