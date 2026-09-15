/**
 * purposeForDraft: a draft is gated under its source's purpose, except that one carrying a template
 * the registry records as marketing is marketing whichever lane queued it. missed_call_ack is a
 * first-contact acknowledgement by source, but Meta approved it as MARKETING, so a plain STOP must
 * block it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {} }));

const { purposeForDraft } = await import('./message-drafts');

const names: Record<string, string> = { HX_missed: 'missed_call_ack', HX_ack: 'web_enquiry_ack_context' };
const lookup = async (sid: string) => names[sid] ?? null;

describe('purposeForDraft', () => {
    it('a first-contact draft carrying missed_call_ack is marketing, so a plain STOP blocks it', async () => {
        expect(await purposeForDraft({ source: 'first_contact_ack', contentSid: 'HX_missed' }, lookup)).toBe('marketing');
    });
    it('keeps the source purpose for freeform, a utility template, or a template the cache does not know', async () => {
        expect(await purposeForDraft({ source: 'first_contact_ack', contentSid: null }, lookup)).toBe('service_reply');
        expect(await purposeForDraft({ source: 'first_contact_ack', contentSid: 'HX_ack' }, lookup)).toBe('service_reply');
        expect(await purposeForDraft({ source: 'first_contact_ack', contentSid: 'HX_unknown' }, lookup)).toBe('service_reply');
        expect(await purposeForDraft({ source: 'recovery', contentSid: 'HX_ack' }, lookup)).toBe('marketing');
    });
    it('fails closed to marketing when a carried template cannot be looked up', async () => {
        const broken = async () => { throw new Error('cache unreachable'); };
        expect(await purposeForDraft({ source: 'first_contact_ack', contentSid: 'HX_missed' }, broken)).toBe('marketing');
    });
});
