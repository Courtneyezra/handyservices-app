import { describe, it, expect } from 'vitest';
import {
    intakeToDraftQuote, validateDraftInput, intakeFromArtifact, pickLatestIntakeRun, missingFields,
    normaliseCustomerType, inferCustomerType, mediaKindOf, QUOTE_CUSTOMER_TYPE, type ThreadMediaItem,
} from './quote-intake';

const media: ThreadMediaItem[] = [
    { id: 'm1', url: 'https://x/1.jpg', mimeType: 'image/jpeg', kind: 'image', at: null },
    { id: 'm2', url: 'https://x/2.mp4', mimeType: 'video/mp4', kind: 'video', at: null },
    { id: 'm3', url: 'https://x/3.jpg', mimeType: 'image/jpeg', kind: 'image', at: null },
];

describe('intakeToDraftQuote (intake → unsent draft row)', () => {
    const draft = validateDraftInput({
        lines: [{ title: 'Replace kitchen mixer tap', category: 'plumbing', qty: 1 }, { title: 'Refix fence panels', category: 'fencing', qty: 3, notes: 'concrete posts intact' }],
        customerType: 'landlord', name: 'Mike', postcode: 'ng5 2ab', mediaIds: ['m1', 'm2'],
    });
    if (!draft.ok) throw new Error(draft.errors.join());
    const row = intakeToDraftQuote({ draft: draft.input, phone: '+447700123456', media, assumptions: ['Access on the day'], createdBy: 'ben@handy', createdByName: 'Ben', now: new Date('2026-09-03T10:00:00Z') });

    it('is a DRAFT with every price null, by construction', () => {
        expect(row.isDraft).toBe(true);
        for (const l of row.pricingLineItems) {
            expect(l.pricePence).toBeNull();
            expect(l.labourPence).toBeNull();
            expect(l.materialsPence).toBeNull();
        }
        expect(JSON.stringify(row)).not.toMatch(/"pricePence":\d/);
    });
    it('carries the customer, the lines and the ticked media split by kind', () => {
        expect(row.customerName).toBe('Mike');
        expect(row.postcode).toBe('NG5 2AB');
        expect(row.customerType).toBe(QUOTE_CUSTOMER_TYPE.landlord);
        expect(row.pricingLineItems.map((l) => [l.label, l.category, l.qty])).toEqual([['Replace kitchen mixer tap', 'plumbing', 1], ['Refix fence panels', 'fencing', 3]]);
        expect(row.jobDescription).toBe('Replace kitchen mixer tap; 3× Refix fence panels');
        expect(row.customerPhotoUrls).toEqual(['https://x/1.jpg']); // m3 unticked
        expect(row.customerVideoUrls).toEqual(['https://x/2.mp4']);
        expect(row.quoteAssumptions).toEqual(['Access on the day']);
        expect(row.quoteMode).toBe('simple');
        expect(row.sourceChannel).toBe('comms_quote_card');
        expect(row.expiresAt.toISOString()).toBe('2026-10-03T10:00:00.000Z');
    });
    it('falls back to "Customer" and nulls when nothing is known', () => {
        const v = validateDraftInput({ lines: [{ title: 'Hang a door' }], customerType: 'homeowner', name: '', postcode: '', mediaIds: [] });
        if (!v.ok) throw new Error(v.errors.join());
        const r = intakeToDraftQuote({ draft: v.input, phone: '+447700123456', media });
        expect(r.customerName).toBe('Customer');
        expect(r.postcode).toBeNull();
        expect(r.customerPhotoUrls).toBeNull();
        expect(r.customerVideoUrls).toBeNull();
        expect(r.customerType).toBe('homeowner');
        expect(r.pricingLineItems[0].qty).toBe(1);
    });
});

describe('validateDraftInput', () => {
    it('requires a titled line and a sane quantity, and checks the postcode shape', () => {
        expect(validateDraftInput({ lines: [], name: 'x' })).toMatchObject({ ok: false });
        expect(validateDraftInput({ lines: [{ title: '   ' }] })).toMatchObject({ ok: false });
        expect(validateDraftInput({ lines: [{ title: 'a', qty: -1 }] })).toMatchObject({ ok: false });
        expect(validateDraftInput({ lines: [{ title: 'a' }], postcode: '12345' })).toMatchObject({ ok: false });
        const ok = validateDraftInput({ lines: [{ title: '  Fix  the   tap ' }], postcode: 'ng12ab', customerType: 'Letting Agent', mediaIds: ['a', 'a'] });
        expect(ok.ok).toBe(true);
        if (ok.ok) {
            expect(ok.input.lines[0].title).toBe('Fix the tap');
            expect(ok.input.postcode).toBe('NG12AB');
            expect(ok.input.customerType).toBe('letting_agent');
        }
    });
});

describe('artifact reading', () => {
    const artifact = {
        kind: 'quote_intake' as const, summary: '2 line(s), readiness quote_ready, 0 gap(s)',
        data: { customerName: ' Sarah ', postcode: 'ng1 1aa', customerType: 'homeowner', readiness: 'quote_ready', lines: [{ title: 'Tap', detail: 'mixer, corroded base', assumptions: ['standard tap'], category: 'plumbing' }, { title: '' }], assumptions: [], gaps: [{ question: 'Which colour?', audience: 'customer', lineIndex: 1 }] },
    };
    it('maps the clerk artifact to the card shape and drops empty lines', () => {
        const i = intakeFromArtifact(artifact)!;
        expect(i.customerName).toBe('Sarah');
        expect(i.postcode).toBe('NG1 1AA');
        expect(i.lines).toEqual([{ title: 'Tap', category: 'plumbing', qty: null, notes: 'mixer, corroded base', assumptions: ['standard tap'] }]);
        expect(i.gaps[0]).toMatchObject({ question: 'Which colour?', lineIndex: 1 });
        expect(intakeFromArtifact({ kind: 'nudge_batch', summary: '', data: {} })).toBeNull();
        expect(intakeFromArtifact(null)).toBeNull();
    });
    it('missingFields names what the ask chips should show', () => {
        expect(missingFields({ customerName: null, postcode: 'NG1 1AA' })).toEqual(['name']);
        expect(missingFields({ customerName: 'Sam', postcode: null })).toEqual(['postcode']);
        expect(missingFields({ customerName: null, postcode: null })).toEqual(['name', 'postcode']);
        expect(missingFields({ customerName: 'Sam', postcode: 'NG1 1AA' })).toEqual([]);
    });
    it('pickLatestIntakeRun takes the newest quote_intake artifact wherever the jsonb put it', () => {
        const runs = [
            { id: 'old', startedAt: '2026-09-01T10:00:00Z', finishedAt: '2026-09-01T10:01:00Z', proposal: { artifact } },
            { id: 'none', startedAt: '2026-09-02T10:00:00Z', finishedAt: null, proposal: { intent: 'x' } },
            { id: 'new', startedAt: '2026-09-02T11:00:00Z', finishedAt: '2026-09-02T11:01:00Z', proposal: { proposal: { artifact } } },
        ];
        expect(pickLatestIntakeRun(runs)?.run.id).toBe('new');
        expect(pickLatestIntakeRun([runs[1]])).toBeNull();
    });
});

describe('customer type and media kind', () => {
    it('normalises the vocabularies both ways', () => {
        expect(normaliseCustomerType('property_manager')).toBe('letting_agent');
        expect(normaliseCustomerType('Landlord')).toBe('landlord');
        expect(normaliseCustomerType('small-biz')).toBe('business');
        expect(normaliseCustomerType(undefined)).toBe('homeowner');
    });
    it('infers from the customer\'s words, defaulting to homeowner', () => {
        expect(inferCustomerType('my tenant says the boiler is leaking')).toBe('landlord');
        expect(inferCustomerType('we are the letting agent for the property')).toBe('letting_agent');
        expect(inferCustomerType('please invoice to the company, Acme Ltd')).toBe('business');
        expect(inferCustomerType('hi, my kitchen tap is leaking')).toBe('homeowner');
        expect(inferCustomerType('')).toBe('homeowner');
    });
    it('mediaKindOf', () => {
        expect(mediaKindOf('image/png')).toBe('image');
        expect(mediaKindOf(null, 'video')).toBe('video');
        expect(mediaKindOf('audio/ogg', 'audio')).toBe('other');
    });
});
