/**
 * scripts/_track-rankings.ts
 *
 * Thin CLI runner for the SEO rank tracker. Iterates keywordTargets with
 * trackRankings=true, runs the Apify SERP scrape + (env-gated) AI-citation
 * checks, and writes rankSnapshots rows.
 *
 * Usage:
 *   npx tsx scripts/_track-rankings.ts [--city=nottingham] [--limit=20] \
 *                                      [--concurrency=2] [--delay=500]
 *
 * Env (see server/seo-rank-tracker.ts header):
 *   APIFY_TOKEN                required — Google SERP scraping
 *   OPENAI_API_KEY             optional — enables 'chatgpt'
 *   PERPLEXITY_API_KEY         optional — enables 'perplexity'
 *   GEMINI_API_KEY|GOOGLE_API_KEY  optional — enables 'gemini'
 *   SEO_ENABLE_AI_OVERVIEW=1   optional — enables 'ai_overview'
 */

import 'dotenv/config';
import { db } from '../server/db';
import { trackRankings, type TrackRankingsOptions } from '../server/seo-rank-tracker';

function parseArgs(argv: string[]): TrackRankingsOptions {
    const opts: TrackRankingsOptions = {};
    for (const raw of argv) {
        const [key, val] = raw.replace(/^--/, '').split('=');
        switch (key) {
            case 'city':
                if (val) opts.city = val;
                break;
            case 'limit':
                opts.limit = Number(val);
                break;
            case 'concurrency':
                opts.concurrency = Number(val);
                break;
            case 'delay':
            case 'delayMs':
                opts.delayMs = Number(val);
                break;
            default:
                console.warn(`[track-rankings] ignoring unknown arg: ${raw}`);
        }
    }
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    // Keep concurrency/rate limit conservative by default — SERP + AI calls are
    // billed per request and we don't want to hammer the providers.
    opts.concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 2;
    opts.delayMs = opts.delayMs ?? 500;

    if (!(process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN)) {
        console.error(
            '[track-rankings] APIFY_TOKEN (or APIFY_API_TOKEN) is not set — SERP scraping will fail.',
        );
    }

    console.log('[track-rankings] starting', JSON.stringify(opts));
    const started = Date.now();

    const summary = await trackRankings(opts);

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log('[track-rankings] finished in', secs + 's');
    console.log(
        `[track-rankings] processed=${summary.processed} ` +
        `snapshots=${summary.snapshotsWritten} errors=${summary.errors}`,
    );

    // Per-keyword one-line recap.
    for (const o of summary.outcomes) {
        const parts = o.engines.map((e) => {
            if (e.status === 'skipped') return `${e.engine}:skip`;
            if (e.status === 'error') return `${e.engine}:ERR`;
            const pos = e.position == null ? '-' : `#${e.position}`;
            const cited = e.cited ? '★' : '';
            return `${e.engine}:${pos}${cited}`;
        });
        console.log(`  • "${o.keyword}" (${o.city}) → ${parts.join('  ')}`);
    }
}

main()
    .then(async () => {
        // db pool may keep the event loop alive; exit explicitly.
        await db.$client.end?.().catch(() => {});
        process.exit(0);
    })
    .catch(async (err) => {
        console.error('[track-rankings] fatal:', err);
        await db.$client.end?.().catch(() => {});
        process.exit(1);
    });
