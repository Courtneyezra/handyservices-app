/**
 * 0.7 part C: the eval result records the prompt it graded.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promptsDigest, promptFiles, scoperPromptHashes, PROMPTS_DIR } from './prompt-provenance';

// The Scoper's module graph reaches server/db.ts, which throws at import time without a
// DATABASE_URL. Point it at nothing (as scripts/eval-comms.ts does) and import it only inside the
// test that needs it, so this file grades the prompt hashing without a database.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://eval:none@127.0.0.1:1/no-db';

function tmpPrompts(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-'));
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return dir;
}

describe('prompt provenance', () => {
    it('digests the prompt tree, and a changed prompt is a different digest', () => {
        const a = tmpPrompts({ 'scoper.core.md': 'standing orders', 'scoper.post_quote.md': 'after the quote' });
        const b = tmpPrompts({ 'scoper.core.md': 'standing orders, revised', 'scoper.post_quote.md': 'after the quote' });
        const same = tmpPrompts({ 'scoper.core.md': 'standing orders', 'scoper.post_quote.md': 'after the quote' });
        expect(promptsDigest(a)).toHaveLength(24);
        expect(promptsDigest(a)).toBe(promptsDigest(same));
        expect(promptsDigest(a)).not.toBe(promptsDigest(b));
    });

    it('a NEW prompt file changes the digest too', () => {
        const a = tmpPrompts({ 'scoper.core.md': 'x' });
        const b = tmpPrompts({ 'scoper.core.md': 'x', 'clerk.core.md': 'y' });
        expect(promptsDigest(a)).not.toBe(promptsDigest(b));
    });

    it('returns null rather than a digest of nothing when there are no prompts', () => {
        expect(promptsDigest(fs.mkdtempSync(path.join(os.tmpdir(), 'no-prompts-')))).toBeNull();
        expect(promptsDigest(path.join(os.tmpdir(), 'does-not-exist-at-all'))).toBeNull();
        expect(promptFiles(path.join(os.tmpdir(), 'does-not-exist-at-all'))).toEqual([]);
    });

    it('reads the repository\'s own prompts', () => {
        expect(promptFiles(PROMPTS_DIR)).toContain('scoper.core.md');
        expect(promptsDigest()).toMatch(/^[0-9a-f]{24}$/);
    });

    it('records the SAME per-pack hash the Scoper stamps on a run', async () => {
        const { promptHashOf, buildScoperSystem } = await import('../spine/agents/scoper');
        const { getPack } = await import('../spine/packs');
        const hashes = await scoperPromptHashes();
        expect(Object.keys(hashes)).toContain('customer.default');
        expect(hashes['customer.default']).toBe(promptHashOf(buildScoperSystem(getPack('customer.default'))));
        // The post-quote pack builds a different system block, so it must hash differently.
        expect(hashes['customer.post_quote']).toBe(promptHashOf(buildScoperSystem(getPack('customer.post_quote'))));
        expect(hashes['customer.post_quote']).not.toBe(hashes['customer.default']);
    });
});
