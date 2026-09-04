/**
 * P8 architecture test (brief §7c): the retired paths stay retired and the estimator never prices.
 *   - nothing imports the deleted additive pricing module or calls the deleted /from-estimate route
 *   - estimate-routes.ts never imports a pricing engine
 *   - the pricing bridge imports the ONLY engine and never pricing-config
 *   - the legacy automatic quote-prep handoff is retired by a constant, not a flag
 * Reads source files only; no db.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!/node_modules|dist|\.git|archive/.test(e.name)) walk(p, out); }
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
}

describe('P8 architecture', () => {
    const sources = [...walk('server'), ...walk('shared'), ...walk('client/src'), ...(fs.existsSync(path.join(ROOT, 'scripts')) ? walk('scripts') : [])];

    it('server/pricing-config.ts is gone and nothing imports it', () => {
        expect(fs.existsSync(path.join(ROOT, 'server/pricing-config.ts'))).toBe(false);
        const importers = sources.filter((f) => /from\s+['"][^'"]*pricing-config['"]/.test(read(f)));
        expect(importers).toEqual([]);
    });
    it('nothing calls or defines /api/quotes/from-estimate', () => {
        const hits = sources.filter((f) => /['"`]\/api\/quotes\/from-estimate/.test(read(f)));
        expect(hits).toEqual([]);
    });
    it('estimate-routes.ts never prices: no engine, no reference rates, no additive functions', () => {
        const src = read('server/estimate-routes.ts');
        expect(src).not.toMatch(/multi-line-engine|reference-rates|calculateAdditiveJobPrice|pricing-config|generateMultiLinePrice|getReferencePrice|Pence\s*=/);
    });
    it('the pricing bridge uses the multi-line engine and the live settings, never pricing-config', () => {
        const src = read('server/spine/pricing-bridge.ts');
        expect(src).toMatch(/contextual-pricing\/multi-line-engine/);
        expect(src).toMatch(/getPricingSettings|materialsMarginPercent/);
        expect(src).not.toMatch(/from\s+['"][^'"]*pricing-config|calculateAdditiveJobPrice\(/);
        expect(src).not.toMatch(/0\.27|27\s*\/\s*100|MATERIALS_MARGIN/); // never the constant
    });
    it('the estimator has no price field to fill and the legacy handoff is retired by a constant', () => {
        const est = read('server/spine/agents/estimator.ts');
        expect(est).toMatch(/findPriceFields/);
        expect(est).not.toMatch(/suggestedPence|bandLowPence/);
        const comms = read('server/agents/comms.ts');
        expect(comms).toMatch(/RETIRE_LEGACY_QUOTE_PREP = true/);
        expect(comms).toMatch(/quotePrep: \{ enabled: false/);
    });
});

// ---------------------------------------------------------------- P19

describe('P19 architecture: the Ben lane still speaks for nobody', () => {
    const read2 = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

    it('agentForLane names no agent for ben or dropped', () => {
        const src = read2('server/spine/index.ts');
        const fn = src.slice(src.indexOf('export function agentForLane'), src.indexOf('// ------------------------------------------------- P19'));
        expect(fn).not.toMatch(/case 'ben'|case 'dropped'/);
        expect(fn).toMatch(/default: return null;/);
    });
    it("decide() settles the Ben lane before it looks at a proposal, so a clerk artifact cannot move it", () => {
        const src = read2('server/spine/decide.ts');
        const benBranch = src.indexOf("if (triage.lane === 'ben' || exception)");
        const firstProposalRead = src.indexOf('if (!proposal)');
        expect(benBranch).toBeGreaterThan(0);
        expect(firstProposalRead).toBeGreaterThan(benBranch);
    });
    it('triage is untouched: nothing hands the Ben lane to the clerk', () => {
        const src = read2('server/spine/triage.ts');
        expect(src).toMatch(/if \(exceptions\.length\) lane = 'ben';/);
        expect(src).not.toMatch(/benLaneClerk|artifactOnly/);
    });
});
