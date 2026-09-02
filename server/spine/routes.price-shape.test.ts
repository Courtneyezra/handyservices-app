import { describe, it, expect } from 'vitest';
import fs from 'fs'; import path from 'path';
describe('spine routes: one handler per path', () => {
    it('registers GET /price/:slug exactly once and it serves the price-screen payload', () => {
        const src = fs.readFileSync(path.join(__dirname, 'routes.ts'), 'utf8');
        const handlers = src.match(/spineRouter\.get\('\/price\/:slug'/g) ?? [];
        expect(handlers).toHaveLength(1);
        const idx = src.indexOf("spineRouter.get('/price/:slug'");
        expect(src.slice(idx, idx + 400)).toMatch(/import\('\.\/price-screen'\)/);
    });
    it('no path is registered twice on the spine router', () => {
        const src = fs.readFileSync(path.join(__dirname, 'routes.ts'), 'utf8');
        const seen = new Map<string, number>();
        for (const m of src.matchAll(/spineRouter\.(get|post|patch|delete)\('([^']+)'/g)) { const k = `${m[1]} ${m[2]}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
        expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
    });
});
