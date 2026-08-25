// Audit /uploads/ customerPhotoUrls across ALL personalized_quotes:
//  - liveness-check each URL against prod
//  - download any surviving files to recovered-quote-photos/ (they die on next deploy)
//  - write a full JSON report for the backfill step
// Read-only against the DB.
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROD = 'https://www.handyservices.app';
const OUT_DIR = path.resolve(__dirname, '../recovered-quote-photos');
const REPORT = path.resolve(__dirname, '../recovered-quote-photos/audit-report.json');

async function checkUrl(url: string): Promise<{ status: number; contentType: string; body?: Buffer }> {
  const res = await fetch(PROD + url, { redirect: 'follow' });
  const contentType = res.headers.get('content-type') || '';
  if (res.ok && contentType.startsWith('image/')) {
    return { status: res.status, contentType, body: Buffer.from(await res.arrayBuffer()) };
  }
  return { status: res.status, contentType };
}

async function main() {
  const rows = await db
    .select({
      id: personalizedQuotes.id,
      shortSlug: personalizedQuotes.shortSlug,
      customerName: personalizedQuotes.customerName,
      phone: personalizedQuotes.phone,
      viewedAt: personalizedQuotes.viewedAt,
      expiresAt: personalizedQuotes.expiresAt,
      createdAt: personalizedQuotes.createdAt,
      depositPaidAt: personalizedQuotes.depositPaidAt,
      customerPhotoUrls: personalizedQuotes.customerPhotoUrls,
    })
    .from(personalizedQuotes)
    .where(sql`${personalizedQuotes.customerPhotoUrls}::text LIKE '%/uploads/%'`)
    .orderBy(sql`${personalizedQuotes.createdAt} ASC`);

  console.log(`${rows.length} quotes have /uploads/ photo URLs`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const report: any[] = [];
  let alive = 0, dead = 0;

  for (const row of rows) {
    const urls = (row.customerPhotoUrls || []).filter((u) => u.startsWith('/uploads/'));
    const otherUrls = (row.customerPhotoUrls || []).filter((u) => !u.startsWith('/uploads/'));
    const results: any[] = [];
    for (const u of urls) {
      try {
        const r = await checkUrl(u);
        if (r.body) {
          const file = path.join(OUT_DIR, path.basename(u));
          fs.writeFileSync(file, r.body);
          results.push({ url: u, alive: true, contentType: r.contentType, savedTo: file, bytes: r.body.length });
          alive++;
          console.log(`  ALIVE ${u} (${r.body.length}b) — saved`);
        } else {
          results.push({ url: u, alive: false, status: r.status, contentType: r.contentType });
          dead++;
        }
      } catch (e: any) {
        results.push({ url: u, alive: false, error: e.message });
        dead++;
      }
    }
    report.push({
      id: row.id,
      shortSlug: row.shortSlug,
      customerName: row.customerName,
      phone: row.phone,
      viewedAt: row.viewedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      depositPaidAt: row.depositPaidAt,
      uploadsUrls: results,
      otherUrls,
    });
    console.log(`${row.shortSlug} ${String(row.createdAt).slice(0, 10)} ${row.customerName} [paid:${row.depositPaidAt ? 'Y' : 'n'}] — ${results.filter(r => r.alive).length}/${urls.length} alive`);
  }

  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: '2026-07-22', prodBase: PROD, totals: { quotes: rows.length, aliveUrls: alive, deadUrls: dead }, quotes: report }, null, 2));
  console.log(`\nTOTAL: ${rows.length} quotes | ${alive} URLs alive (recovered) | ${dead} dead`);
  console.log(`Report: ${REPORT}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
