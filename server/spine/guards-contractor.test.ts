import { describe, it, expect } from 'vitest';
import { detectCustomerPii, checkProposal } from './guards';
import { CONTRACTOR_DEFAULT } from './packs/contractor-default';
import type { CaseFile } from './types';

const cf = (over: Partial<CaseFile> = {}): CaseFile => ({
    conversationId: 'c', phone: '+447700900001', audience: 'contractor', stage: 'booked', contactName: 'Craig', timeline: [], media: [],
    window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' },
    client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: 't', ...over,
});

describe('detectCustomerPii', () => {
    it('allows postcode only, a first name, a street with no name', () => {
        expect(detectCustomerPii('Job tomorrow at NG3 7EG, Sarah will let you in. Bring the 10mm bit.')).toBeNull();
        expect(detectCustomerPii('Address is 20 Nottingham Road, postcode NG12 5FD')).toBeNull();
        expect(detectCustomerPii('Customer is Sarah, postcode ng3 7eg')).toBeNull();
    });
    it('bans a phone number or an email', () => {
        expect(detectCustomerPii('Ring her on 07950 552 830 when you are near')).toBe('customer phone number');
        expect(detectCustomerPii('Customer is on +44 7950 552830')).toBe('customer phone number');
        expect(detectCustomerPii('Send the invoice to sarah.hughes@example.com')).toBe('customer email address');
    });
    it('bans a full name with a street address', () => {
        expect(detectCustomerPii('Mrs Sarah Hughes, 20 Nottingham Road, NG12 5FD')).toBe('customer full name with street address');
        expect(detectCustomerPii('Sarah Hughes at Flat 3, 12 Mill Lane')).toBe('customer full name with street address');
    });
    it('the office sign-off and the road name are not a customer name', () => {
        expect(detectCustomerPii('Brief for 20 Nottingham Road, NG12 5FD. Thanks\nHandy Services')).toBeNull();
    });
});

describe('checkProposal on contractor.default', () => {
    it('customer_pii hits and does not escalate; payout figures to a contractor are fine', () => {
        const v = checkProposal({ intent: 'job_brief', body: ['Sarah Hughes, 20 Nottingham Road, NG12 5FD. Payout £120.'], reasons: ['brief'] }, CONTRACTOR_DEFAULT, cf());
        expect(v.ok).toBe(false);
        expect(v.guardsHit).toEqual(['customer_pii']);
        expect(v.escalate).toBe(false);
        const ok = checkProposal({ intent: 'job_brief', body: ['Tomorrow 9am at NG12 5FD, gutter leak at the downpipe. Payout £120. Bring ladders.'], reasons: ['brief'] }, CONTRACTOR_DEFAULT, cf());
        expect(ok.ok).toBe(true);
        expect(ok.guardsHit).toEqual([]);
    });
    it('voice still applies to contractor messages', () => {
        const v = checkProposal({ intent: 'confirm_receipt', body: ['Got the photos — cheers'], reasons: ['r'] }, CONTRACTOR_DEFAULT, cf());
        expect(v.guardsHit).toEqual(['voice']);
    });
});
