/**
 * Build plan v2, 4.1: the five window-shut Meta templates. Pure — no DB, no network, nothing sent.
 *
 * What this proves is what a submission would otherwise only discover from Meta days later, or a
 * customer would discover on receipt: every definition is the shape Twilio's Content API and the
 * repo's own lookup accept, every one carries a category and a named trigger, the marketing one is
 * marked as marketing by a FIELD (so a send path can branch on it without reading its name), and
 * every body passes the house voice rules and the draft guards with its sample values filled in.
 */
import { describe, it, expect } from 'vitest';
import {
    WINDOW_TEMPLATES, windowTemplateFor, templatePlaceholders, renderSample,
    expectedFromWindowTemplates, type WindowTemplate,
} from './window-templates';
import { chatVoiceViolations } from '@shared/chat-voice';
import { checkDraft } from './agents/draft-guards';
import { EXPECTED_TEMPLATES, shapeTemplateStatus } from './template-status';

// Deliberately NOT importing server/whatsapp-template-sync.ts: it opens the DB pool at import time,
// and this file, like template-status.test.ts, must stay pure. Its readers are asserted here by the
// PROPERTY each one keys off, named in the comment beside it, rather than by calling them.

const byTrigger = (id: WindowTemplate['trigger']['id']) => {
    const t = windowTemplateFor(id);
    if (!t) throw new Error(`no window template for trigger ${id}`);
    return t;
};

describe('the window-shut templates', () => {
    it('is exactly the plan\'s five triggers and the clean-sheet desk\'s two, once each', () => {
        expect(WINDOW_TEMPLATES).toHaveLength(7);
        expect(WINDOW_TEMPLATES.map((t) => t.trigger.id)).toEqual([
            'quote_ready', 'question_unanswered', 'webform_first_contact', 'post_call_followup',
            'webform_first_contact_no_call', 'missed_call', 'enquiry_chase',
        ]);
    });

    it('every definition carries a category and a named trigger with its source', () => {
        for (const t of WINDOW_TEMPLATES) {
            expect(['UTILITY', 'MARKETING']).toContain(t.category);
            expect(t.trigger.id).toBeTruthy();
            expect(t.trigger.when.length).toBeGreaterThan(20);
            expect(t.trigger.source).toMatch(/\.ts|4\.2/);
            expect(typeof t.trigger.wired).toBe('boolean');
            expect(t.notes.length).toBeGreaterThan(40);
        }
    });

    it('the marketing one is distinguishable by a field, not by its name', () => {
        const marketing = WINDOW_TEMPLATES.filter((t) => t.category === 'MARKETING');
        expect(marketing).toHaveLength(1);
        expect(marketing[0].trigger.id).toBe('enquiry_chase');
        // purpose is the field a send path branches on: a plain STOP blocks 'marketing' only.
        expect(marketing[0].purpose).toBe('marketing');
        for (const t of WINDOW_TEMPLATES.filter((x) => x.category === 'UTILITY')) {
            expect(t.purpose).toBe('service_reply');
        }
        // Naming is not the discriminator: strip the names and the categories still separate.
        const withoutNames = WINDOW_TEMPLATES.map(({ purpose, category }) => ({ purpose, category }));
        expect(withoutNames.filter((t) => t.purpose === 'marketing')).toEqual([{ purpose: 'marketing', category: 'MARKETING' }]);
    });

    it('the marketing one carries a way to stop, and no utility one does', () => {
        const chase = byTrigger('enquiry_chase');
        expect(chase.body).toMatch(/\bSTOP\b/);
        for (const t of WINDOW_TEMPLATES.filter((x) => x.category === 'UTILITY')) {
            expect(t.body).not.toMatch(/\bSTOP\b/);
        }
    });

    it('the question template is a re-open nudge and says so, never the answer itself', () => {
        const t = byTrigger('question_unanswered');
        expect(t.notes).toMatch(/re-?open nudge/i);
        expect(t.notes).toMatch(/freeform|after the customer replies/i);
        expect(t.body).toMatch(/repl(y|ies)/i);
    });

    it('the post-call one sends unattended, so it commits to nothing a person would have to check', () => {
        const t = byTrigger('post_call_followup');
        expect(t.notes).toMatch(/unattended/i);
        // A second rung, because Meta may read it as a near-duplicate of post_call_continuation.
        expect(t.names).toHaveLength(2);
        expect(t.names[1]).toBe('post_call_continuation_generic');
    });
});

describe('every definition is the shape the existing template code accepts', () => {
    it('names are valid Meta template names, unique across the registry', () => {
        const seen = new Set<string>();
        for (const t of WINDOW_TEMPLATES) {
            for (const n of t.names) {
                expect(n).toMatch(/^[a-z0-9_]{1,512}$/);
                expect(seen.has(n)).toBe(false);
                seen.add(n);
            }
        }
    });

    it('placeholders are 1..n with no gaps and every one has a sample value and a meaning', () => {
        for (const t of WINDOW_TEMPLATES) {
            const idx = templatePlaceholders(t.body);
            expect(idx.length).toBeGreaterThan(0);
            expect(idx).toEqual(idx.map((_, i) => String(i + 1)));
            expect(Object.keys(t.variables).sort()).toEqual(idx);
            expect(Object.keys(t.variableMeanings).sort()).toEqual(idx);
            for (const k of idx) expect(String(t.variables[k]).trim()).not.toBe('');
        }
    });

    it('renders with its sample values and leaves no placeholder behind', () => {
        for (const t of WINDOW_TEMPLATES) {
            const rendered = renderSample(t);
            expect(rendered).not.toMatch(/\{\{\s*\d+\s*\}\}/);
            expect(rendered).toContain(t.variables['1']);
        }
    });

    it('the name slot is greeted, which is what variableHints keys off to prefill it', () => {
        // variableHints (server/whatsapp-template-sync.ts) calls a placeholder 'name' when it sits
        // right after a greeting; buildTemplateVariables then fills it from the contact, degrading a
        // placeholder contact name to 'there'. Every body must present {{1}} in that shape.
        for (const t of WINDOW_TEMPLATES) {
            expect(t.body).toMatch(/^(Hi|Hey|Hello|Morning|Afternoon)[,!]?\s*\{\{\s*1\s*\}\}/);
        }
    });

    it('the quote template\'s link slot is a URL sample, which is what marks it a link slot', () => {
        // variableHints calls a placeholder 'link' when its SAMPLE value is a URL, and
        // buildTemplateVariables then replaces it with the thread's own quote URL.
        const t = byTrigger('quote_ready');
        expect(t.variables['2']).toMatch(/^https:\/\/handyservices\.app\/quote\//);
        expect(t.variableMeanings['2']).toMatch(/quote link/i);
        // No other definition carries a link slot: nothing else has a URL to put in one.
        for (const other of WINDOW_TEMPLATES.filter((x) => x !== t)) {
            expect(Object.values(other.variables).some((v) => /^https?:\/\//i.test(v))).toBe(false);
        }
    });
});

describe('every body is safe to send as written', () => {
    it('passes the house chat-voice rules', () => {
        for (const t of WINDOW_TEMPLATES) {
            expect({ name: t.names[0], issues: chatVoiceViolations(t.body) }).toEqual({ name: t.names[0], issues: [] });
            expect(chatVoiceViolations(renderSample(t))).toEqual([]);
        }
    });

    it('passes the draft guards with its sample values filled in', () => {
        for (const t of WINDOW_TEMPLATES) {
            const violation = checkDraft({ body: renderSample(t), intent: 'ack_enquiry', quoteSeen: false, customerText: null });
            expect({ name: t.names[0], violation: violation?.code ?? null }).toEqual({ name: t.names[0], violation: null });
        }
    });

    it('no body states a price, a date or a duration, whatever the variables are filled with', () => {
        for (const t of WINDOW_TEMPLATES) {
            expect(t.body).not.toMatch(/£|\bgbp\b|\bpounds?\b/i);
            expect(t.body).not.toMatch(/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i);
            expect(t.body).not.toMatch(/\b\d+\s*(hours?|days?|weeks?|visits?)\b/i);
        }
    });
});

describe('the one registry', () => {
    it('each window template reaches EXPECTED_TEMPLATES exactly once, by first name', () => {
        for (const t of WINDOW_TEMPLATES) {
            const rows = EXPECTED_TEMPLATES.filter((e) => e.names.includes(t.names[0]));
            expect({ name: t.names[0], rows: rows.length }).toEqual({ name: t.names[0], rows: 1 });
        }
    });

    it('no name appears in two expected rows, so the staff page never shows one template twice', () => {
        const all = EXPECTED_TEMPLATES.flatMap((e) => e.names);
        expect(all).toEqual([...new Set(all)]);
    });

    it('a window template already covered by a live row is folded into it, not duplicated', () => {
        // web_enquiry_ack_context is both the first-contact ack and 4.1's webform carrier.
        const row = EXPECTED_TEMPLATES.find((e) => e.names[0] === 'web_enquiry_ack_context');
        expect(row?.usedBy).toContain('rules-first-contact');
        expect(expectedFromWindowTemplates().some((r) => r.names[0] === 'web_enquiry_ack_context')).toBe(true);
    });

    it('no 4.1 definition is required, so a template still in Meta\'s queue cannot fail the go-live check', () => {
        for (const t of WINDOW_TEMPLATES) {
            const row = EXPECTED_TEMPLATES.find((e) => e.names.includes(t.names[0]))!;
            if (row.usedBy.startsWith('4.1 definition only')) expect(row.required).toBe(false);
        }
        const approvedToday = ['holding_line_v1', 'missed_call_ack', 'video_request', 'postcode_request', 'call_request'];
        const shaped = shapeTemplateStatus(approvedToday.map((name) => ({ contentSid: `HX_${name}`, name, status: 'approved' })));
        expect(shaped.requiredApproved).toBe(true);
    });
});
