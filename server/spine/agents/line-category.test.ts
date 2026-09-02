import { describe, it, expect } from 'vitest';
import { categoriseLine, withLineCategories } from './line-category';

describe('categoriseLine', () => {
    it('maps common handyman lines to the pricing vocabulary', () => {
        expect(categoriseLine('Mount 55" TV on plasterboard wall')).toBe('tv_mounting');
        expect(categoriseLine('Assemble IKEA PAX wardrobe')).toBe('flat_pack');
        expect(categoriseLine('Replace front door lock cylinder')).toBe('lock_change');
        expect(categoriseLine('Re-seal bath with silicone')).toBe('silicone_sealant');
        expect(categoriseLine('Fix leaking bath waste')).toBe('plumbing_minor');
        expect(categoriseLine('Repair gutter leak at downpipe joint')).toBe('guttering');
        expect(categoriseLine('Fit new skirting in 3 bedrooms')).toBe('flooring');
        expect(categoriseLine('Strip wallpaper and repaint bedroom')).toBe('painting');
        expect(categoriseLine('Fix recliner handle')).toBe('furniture_repair');
        expect(categoriseLine('Attach shed base to concrete floor')).toBe('garden_maintenance');
        expect(categoriseLine('Something unusual')).toBe('other');
    });
    it('withLineCategories adds category and nothing else changes', () => {
        const out = withLineCategories({ readiness: 'quote_ready', lines: [{ title: 'Hang 3 pictures', detail: 'hallway' }] } as any);
        expect(out.readiness).toBe('quote_ready');
        expect(out.lines[0]).toMatchObject({ title: 'Hang 3 pictures', category: 'general_fixing' });
    });
});
