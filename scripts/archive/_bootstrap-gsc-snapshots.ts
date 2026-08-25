/**
 * One-off bootstrap: load real GSC data (pulled via the GSC MCP and saved to
 * tool-result JSON files) into rank_snapshots via the SAME ingest path the cron
 * uses (server/seo-gsc-connector.ts → ingestGscRows). Proves the wiring and gives
 * /admin/seo real GSC data immediately, before the server refresh-token is set.
 *
 *   npx tsx scripts/_bootstrap-gsc-snapshots.ts <perQuery.json> <perQueryPage.json>
 *
 * Each file is the raw MCP tool result: {"result": "<json string with .rows>"}.
 */
import { readFileSync } from 'fs';
import { ingestGscRows, type GscQueryRow, type GscQueryPageRow } from '../server/seo-gsc-connector';

function loadRows(path: string): any[] {
    const outer = JSON.parse(readFileSync(path, 'utf8'));
    const inner = typeof outer.result === 'string' ? JSON.parse(outer.result) : outer;
    return inner.rows ?? [];
}

async function main() {
    const [qPath, qpPath] = process.argv.slice(2);
    if (!qPath || !qpPath) {
        console.error('Usage: tsx scripts/_bootstrap-gsc-snapshots.ts <perQuery.json> <perQueryPage.json>');
        process.exit(1);
    }
    const perQuery: GscQueryRow[] = loadRows(qPath).map((r) => ({
        query: r.query, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }));
    const perQueryPage: GscQueryPageRow[] = loadRows(qpPath).map((r) => ({
        query: r.query, page: r.page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }));
    console.log(`Loaded ${perQuery.length} per-query rows, ${perQueryPage.length} per-(query,page) rows.`);

    const res = await ingestGscRows(perQuery, perQueryPage);
    console.log(`\nIngest complete:`);
    console.log(`  matched (tracked keywords):  ${res.matched}`);
    console.log(`  discovered (new demand):     ${res.discovered}`);
    console.log(`  snapshots written:           ${res.snapshotsWritten}`);
    console.log(`\nTop untracked opportunities (high impressions, page 2+):`);
    for (const o of res.topOpportunities) {
        console.log(`  ${String(o.impressions).padStart(4)} impr · pos ${String(o.position).padStart(4)} · ${o.query}`);
    }
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
