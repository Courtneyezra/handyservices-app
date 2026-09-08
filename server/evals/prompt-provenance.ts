/**
 * 0.7 (8 Sep 2026), part C: prompt provenance on an eval run.
 *
 * A family's green is only worth something while the prompt it graded is the prompt that ships.
 * The Scoper already stamps `agent_runs.prompt_hash` with `promptHashOf(buildScoperSystem(pack))`
 * on every live run; nothing tied an eval result to a prompt at all, so a scoreboard could keep
 * reporting green for standing orders that had since been rewritten.
 *
 * Two hashes, both recorded on the run (file and table alike):
 *   - `promptsDigest()` — one digest over every file under server/spine/prompts/. Cheap, needs no
 *     pack and no model, so every run records it. ANY prompt edit moves it, which is what makes a
 *     stale green visible: compare the run's digest with the digest of the tree you are reading.
 *   - `scoperPromptHashes()` — the Scoper's OWN per-pack hash, the identical value
 *     `promptHashOf(buildScoperSystem(pack))` that lands on the run row, so an eval result and a
 *     production run can be matched exactly.
 *
 * Pure and side-effect free apart from reading the prompt files. Nothing here decides anything:
 * the autonomy job's promotion and demotion rules are untouched by 0.7.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const PROMPTS_DIR = path.join(process.cwd(), 'server/spine/prompts');

/** Digest length matches the Scoper's own `promptHashOf` (sha256, first 24 hex). */
const DIGEST_CHARS = 24;

/** Every prompt file under `dir`, by name, sorted. Missing directory → empty list, never a throw. */
export function promptFiles(dir: string = PROMPTS_DIR): string[] {
    try {
        return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    } catch {
        return [];
    }
}

/**
 * One digest over the prompt tree: `name\0content` per file, in name order. Returns null when
 * there are no prompt files to hash — an absent digest is honest; a digest of nothing is not.
 */
export function promptsDigest(dir: string = PROMPTS_DIR): string | null {
    const files = promptFiles(dir);
    if (!files.length) return null;
    const h = createHash('sha256');
    for (const f of files) {
        h.update(f);
        h.update('\0');
        try { h.update(fs.readFileSync(path.join(dir, f))); } catch { h.update('\0missing'); }
        h.update('\0');
    }
    return h.digest('hex').slice(0, DIGEST_CHARS);
}

/**
 * The Scoper's own prompt hash per pack it can serve — the same number `agent_runs.prompt_hash`
 * carries. Loads the real pack table and the real system builder; any failure (a pack module that
 * cannot import here, say) yields an empty map rather than breaking an eval run.
 */
export async function scoperPromptHashes(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
        const { PACKS } = await import('../spine/packs');
        const { buildScoperSystem, promptHashOf } = await import('../spine/agents/scoper');
        for (const pack of Object.values(PACKS)) {
            if (pack.audience !== 'customer' || !pack.allowedIntents.length) continue;
            out[pack.id] = promptHashOf(buildScoperSystem(pack));
        }
    } catch {
        return {};
    }
    return out;
}
