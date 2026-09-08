/**
 * Build plan v2, item 3.4 — the access boundary, checked over the repository's own source.
 *
 * The store's safety is a single sentence: an unreviewed entry is invisible to anything that could
 * reach a customer. A predicate and an accessor say so today; this test is what keeps saying so
 * when someone in week three needs "just the drafts too, for the search tool".
 *
 * Three rails:
 *   1. only the module that defines it and the admin route may call
 *      adminListEveryEntryIncludingUnreviewed (the seed script writes; it never reads the drafts);
 *   2. nothing outside server/spine/knowledge-base*.ts touches the kbEntries table directly, so
 *      there is no second, unfiltered read;
 *   3. this item is the store, the page and the seed — the knowledge base is NOT wired into a
 *      reply path, prompt, guard or policy pack yet (that is item 3.1). If a later PR wires it in,
 *      this test fails and its author has to say so in the diff rather than by accident.
 *
 * Source-only: no database, no imports of the modules under test.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** Comments explain the rails and name the functions; only CODE can break them. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!/node_modules|dist|\.git|archive/.test(e.name)) walk(p, out); }
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
}

const SOURCES = [...walk('server'), ...walk('shared'), ...walk('client/src'), ...walk('scripts')]
    .filter((f) => !/\.test\.tsx?$/.test(f));

/** The module that defines the call, and the one route allowed to make it. */
const UNREVIEWED_CALLERS = [
    'server/spine/knowledge-base.ts',        // defines it
    'server/spine/routes.ts',                // GET /api/spine/kb — Ben's own review page
];

describe('3.4: only the admin page may see an unreviewed entry', () => {
    it('adminListEveryEntryIncludingUnreviewed has exactly the callers it is allowed', () => {
        const callers = SOURCES.filter((f) => /adminListEveryEntryIncludingUnreviewed/.test(code(f)));
        expect(callers.sort()).toEqual(UNREVIEWED_CALLERS.sort());
    });
    it('the accessor a reply path would reach for returns reviewed answers only, by SQL and in code', () => {
        const src = read('server/spine/knowledge-base.ts');
        const listing = src.slice(src.indexOf('export async function listReviewedEntries'), src.indexOf('export async function getReviewedEntry'));
        expect(listing).toMatch(/eq\(kbEntries\.status, 'reviewed'\)/);
        expect(listing).toMatch(/eq\(kbEntries\.kind, 'answer'\)/);
        expect(listing).toMatch(/sendableEntries\(/);
    });
    it('nothing outside the knowledge-base modules queries kb_entries directly', () => {
        const users = SOURCES.filter((f) => /\bkbEntries\b/.test(code(f)) || /\bkb_entries\b/.test(code(f)));
        expect(users.sort()).toEqual([
            'server/spine/knowledge-base.ts',
            'shared/schema.ts',
        ]);
    });
});

describe('3.4 is the store, the page and the seed — nothing is wired into a reply yet', () => {
    /** The files that decide, guard, prompt or pack a customer reply. Item 3.1 changes this list. */
    const REPLY_PATH = [
        'server/spine/decide.ts',
        'server/spine/guards.ts',
        'server/spine/send-preconditions.ts',
        'server/spine/packs.ts',
        'server/spine/case-file.ts',
        'server/spine/exit.ts',
        'server/spine/triage.ts',
        'server/spine/agents/scoper.ts',
    ];
    it('no reply-path module imports the knowledge base', () => {
        const wired = REPLY_PATH
            .filter((f) => fs.existsSync(path.join(ROOT, f)))
            .filter((f) => /from\s+['"][^'"]*knowledge-base['"]/.test(code(f)));
        expect(wired).toEqual([]);
    });
    it('no prompt mentions it either', () => {
        const prompts = fs.readdirSync(path.join(ROOT, 'server/spine/prompts')).filter((f) => f.endsWith('.md'));
        const mentions = prompts.filter((f) => /knowledge base|kb_entries|approved words/i.test(read(path.join('server/spine/prompts', f))));
        expect(mentions).toEqual([]);
    });
});
