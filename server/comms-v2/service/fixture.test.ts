/**
 * The fixture's template approvals, without a database: every row carries the registry's own
 * wording under a sandbox content SID, and with only those rows approved the post-call follow-up
 * (1.3) and the no-call web acknowledgement (1.5) take their approved first rungs.
 */
import { describe, expect, it } from 'vitest';
import { pickTemplate, type TemplateStatusSource } from '../desk/sender';
import { FIXTURE_APPROVED_ON_META, fixtureTemplateRows } from './fixture';

const fixtureCache: TemplateStatusSource = {
    async approved(name) {
        const row = fixtureTemplateRows().find((r) => r.name === name);
        return row ? { contentSid: row.contentSid } : null;
    },
};

describe('the sandbox fixture\'s template approvals', () => {
    it('mirrors the two channel templates Meta approved, each with a sandbox content SID of its own', () => {
        const rows = fixtureTemplateRows();
        for (const name of FIXTURE_APPROVED_ON_META) {
            const row = rows.find((r) => r.name === name);
            expect(row?.contentSid).toMatch(/^HXsandbox/);
            expect(row?.body).toContain('{{1}}');
        }
        expect(new Set(rows.map((r) => r.contentSid)).size).toBe(rows.length);
        expect(rows.every((r) => r.contentSid.startsWith('HXsandbox'))).toBe(true);
    });

    it('with only the fixture approved, 1.3 and 1.5 take their approved first rungs, and the no-call row offers no call', async () => {
        const at = new Date('2026-09-15T10:00:00.000Z');
        const post = await pickTemplate('post_call_followup', { name: 'Sam Drama', topic: 'the bathroom fan', at }, fixtureCache);
        expect(post).toMatchObject({ ok: true, template: { name: 'post_call_followup_v1', contentSid: 'HXsandbox0000000000000000postcall01' } });
        if (post.ok) expect(post.body).toContain('Hi Sam, good to speak just now about the bathroom fan.');
        const ack = await pickTemplate('web_form_ack_no_call', { name: 'Sam Drama', topic: 'Bathroom fan has died', at }, fixtureCache);
        expect(ack).toMatchObject({ ok: true, template: { name: 'web_enquiry_ack_no_call_v1' } });
        if (ack.ok) {
            expect(ack.body).toContain('"Bathroom fan has died"');
            expect(ack.body).not.toMatch(/call|ring|phone/i);
        }
    });
});
