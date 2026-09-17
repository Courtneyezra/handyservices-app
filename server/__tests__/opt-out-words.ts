/**
 * The opt-out words as server/opt-out-detect.ts holds them, read from its source so a test can walk
 * every one without the detector exporting its lists. Comment lines are dropped first: they quote
 * words that are deliberately absent.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

const SOURCE = path.resolve(__dirname, '../opt-out-detect.ts');

export type OptOutList = 'EXACT_MARKETING' | 'EXACT_ALL' | 'PHRASE_ALL' | 'PHRASE_MARKETING';

export function optOutWords(list: OptOutList): string[] {
    const src = readFileSync(SOURCE, 'utf8');
    const body = new RegExp(`const ${list} = \\[([\\s\\S]*?)\\];`).exec(src)?.[1];
    if (body === undefined) throw new Error(`${list} is not in server/opt-out-detect.ts`);
    const code = body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    return Array.from(code.matchAll(/'([^']*)'/g), (m) => m[1]);
}

/** SHA-256 of the detection rules: from the politeness wrappers to the end of detectOptOut. */
export function detectionRulesHash(): string {
    const src = readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('const LEADING_NOISE');
    const fn = src.indexOf('export function detectOptOut');
    const end = src.indexOf('\n}\n', fn) + 3;
    if (start < 0 || fn < 0 || end < 3) throw new Error('the detection rules are not where this test expects them');
    return createHash('sha256').update(src.slice(start, end)).digest('hex');
}
