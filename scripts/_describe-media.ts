/**
 * Try describe_video (Phase 4) on a local file.
 *
 *   npx tsx scripts/_describe-media.ts <file>            # dry: size, mime, transport, cache status; no network
 *   npx tsx scripts/_describe-media.ts <file> --live     # calls Gemini 2.5 Flash with GEMINI_API_KEY, prints the JSON + cost
 *   options: --kind image|video (default from extension) · --context "what the customer said" · --cache-dir <dir>
 *
 * Writes nothing to the database. Costs money only with --live.
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { describeMedia, hashBytes, mimeTypeFor, formatDescription, INLINE_LIMIT_BYTES, DESCRIPTIONS_DIR, GEMINI_MODEL } from '../server/spine/tools/describe-video';
import { computeCostPence, computeCostUsd } from '../server/agent-cost';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const opt = (name: string): string | null => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] ?? null) : null; };
const live = argv.includes('--live');

(async () => {
    if (!file) { console.error('usage: npx tsx scripts/_describe-media.ts <file> [--live] [--kind image|video] [--context "..."] [--cache-dir <dir>]'); process.exit(2); }
    const abs = path.resolve(file);
    const bytes = await fs.readFile(abs);
    const kindOpt = opt('kind');
    const kind: 'image' | 'video' = kindOpt === 'image' || kindOpt === 'video' ? kindOpt : (/\.(jpe?g|png|webp|heic|gif)$/i.test(abs) ? 'image' : 'video');
    const cacheDir = opt('cache-dir') ?? DESCRIPTIONS_DIR;
    const hash = hashBytes(bytes);
    let cached = false;
    try { await fs.access(path.join(cacheDir, `${hash}.json`)); cached = true; } catch { /* miss */ }
    console.log(`${abs}\n  kind ${kind} · mime ${mimeTypeFor(abs, kind)} · ${(bytes.length / 1024 / 1024).toFixed(2)} MB · transport ${bytes.length <= INLINE_LIMIT_BYTES ? 'inline' : 'files api'} · sha256 ${hash.slice(0, 16)}… · cache ${cached ? 'HIT' : 'miss'}`);
    if (!live) { console.log('  (dry run: add --live to call Gemini)'); return; }
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) { console.error('GEMINI_API_KEY is not set'); process.exit(2); }
    const r = await describeMedia({ path: abs, kind, customerContext: opt('context'), mediaId: `local:${path.basename(abs)}` }, { cacheDir, log: (l) => console.warn('  ' + l) });
    if (!r) { console.error('  no description (see log above)'); process.exit(1); }
    console.log(JSON.stringify(r.description, null, 2));
    console.log(`\n  ${formatDescription(r.description)}`);
    const usd = r.usage ? computeCostUsd(r.usage, GEMINI_MODEL) : null;
    console.log(`\n  ${r.cached ? 'cache hit' : `${r.transport}, ${r.attempts} attempt(s)`} · ${r.durationMs} ms · tokens in=${r.usage?.inputTokens ?? '–'} out=${r.usage?.outputTokens ?? '–'} · cost ${usd != null ? `$${usd.toFixed(4)} ≈ ${computeCostPence(r.usage!, GEMINI_MODEL)}p` : 'n/a'}`);
})().catch((e) => { console.error(e); process.exit(1); });
