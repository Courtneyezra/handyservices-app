import { describe, it, expect } from 'vitest';
import { jobSheetPayFromQuote } from './job-sheet-pay';
import { renderJobSheetHtml } from './document-templates';

// £400 labour, 4h specialist → share 55% = £220. £300 labour, 3h skilled → 50% = £150.
const kitchen = { lineId: 'a', category: 'kitchen_fitting', description: 'Fit base units', guardedPricePence: 40000, scheduleMinutes: 240, materialsWithMarginPence: 90000 };
const shelves = { lineId: 'b', category: 'carpentry', description: 'Build alcove shelves', guardedPricePence: 30000, timeEstimateMinutes: 180, materialsWithMarginPence: 12345 };
const quote = { pricingLineItems: [kitchen, shelves], basePrice: 172345 };

describe('jobSheetPayFromQuote', () => {
  it('pays the base share per line and in total, from the revenue-share engine', () => {
    const r = jobSheetPayFromQuote(quote);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pay.lines.map((l) => l.payPence)).toEqual([22000, 15000]);
    expect(r.pay.totalPayPence).toBe(37000);
    expect(r.pay.lines[0].description).toBe('Fit base units');
  });

  it('applies no delivery-tier or lead uplift', () => {
    const r = jobSheetPayFromQuote({ pricingLineItems: [kitchen], basePrice: 130000 });
    expect(r.ok && r.pay.totalPayPence).toBe(22000); // 55%, not Core's 60% or a +15% lead uplift
  });

  it('leaves deferred lines off the sheet', () => {
    const r = jobSheetPayFromQuote({ ...quote, deferredLineItems: [{ lineId: 'b' }] });
    expect(r.ok && r.pay.lines.length).toBe(1);
    expect(r.ok && r.pay.totalPayPence).toBe(22000);
  });

  it('carries no customer figure', () => {
    const r = jobSheetPayFromQuote(quote);
    expect(JSON.stringify(r)).not.toMatch(/40000|30000|172345|90000|12345/);
  });

  it('refuses a line with no category rather than assuming a tier', () => {
    const r = jobSheetPayFromQuote({ pricingLineItems: [kitchen, { ...shelves, category: undefined }], basePrice: 172345 });
    expect(r).toEqual({ ok: false, problems: [expect.stringContaining('line 2: no category')] });
  });

  it('refuses a category the engine does not know', () => {
    const r = jobSheetPayFromQuote({ pricingLineItems: [{ ...kitchen, category: 'roofing' }], basePrice: 130000 });
    expect(r.ok).toBe(false);
  });

  it('refuses a line with no hours', () => {
    const r = jobSheetPayFromQuote({ pricingLineItems: [{ ...shelves, timeEstimateMinutes: 0 }], basePrice: 50000 });
    expect(r).toEqual({ ok: false, problems: ['line 1: no hours'] });
  });

  it('refuses when pay comes out at or above the customer price', () => {
    const r = jobSheetPayFromQuote({ pricingLineItems: [kitchen], basePrice: 22000 });
    expect(r.ok).toBe(false);
  });

  it('refuses a quote with no lines', () => {
    expect(jobSheetPayFromQuote({ pricingLineItems: [] }).ok).toBe(false);
  });
});

describe('renderJobSheetHtml with pay', () => {
  const job = { id: 'job-1', customerName: 'Sam Example', description: 'Kitchen' };

  it('shows each line\'s pay and the total, never the customer price', () => {
    const r = jobSheetPayFromQuote(quote);
    if (!r.ok) throw new Error('expected pay');
    const html = renderJobSheetHtml(job, { quote: { ...quote, address: '1 Test Road' }, pay: r.pay });
    expect(html).toContain('Fit base units');
    expect(html).toContain('Your pay £220.00');
    expect(html).toContain('Your pay £150.00');
    expect(html).toContain('Your pay for this job');
    expect(html).toContain('£370.00');
    for (const customerFigure of ['1,723.45', '400.00', '300.00', '900.00']) {
      expect(html).not.toContain(customerFigure);
    }
  });

  it('shows no money at all without pay, even when the job sheet lines carry prices', () => {
    const sheet = { lineItems: [{ description: 'Fit base units', pricePence: 40000, contractorRatePence: 22000 }] };
    const html = renderJobSheetHtml(job, { sheet, quote });
    expect(html).toContain('Fit base units');
    expect(html).not.toContain('£');
  });
});
