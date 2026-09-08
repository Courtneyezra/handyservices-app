/**
 * /privacy — the public notice (plan v2 item 0.8, from review finding s30 F7).
 *
 * The page is static, so the only thing worth testing is that the disclosures the notice exists
 * to make are actually on it: every processor that reads customer content is named with a
 * purpose, the automated assistant is described, and retention is stated for messages, media and
 * transcripts. These are compliance statements, not copy — a silent deletion is the failure this
 * file is here to catch.
 *
 * The one thing asserted by ABSENCE is the bot-disclosure line: the owner decided on 7 Sep, and
 * restated it as answer 24 on 8 Sep, that customers get no "you are talking to a bot" line in
 * chat. The transparency lives here instead, so this page must carry it and the chat must not.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PrivacyPolicyPage from '@/pages/PrivacyPolicyPage';

/** The section whose <h2> is `title`, as the reader sees it. */
function section(title: string): HTMLElement {
    const heading = screen.getByRole('heading', { name: title, level: 2 });
    const el = heading.closest('section');
    if (!el) throw new Error(`no <section> around the "${title}" heading`);
    return el as HTMLElement;
}

describe('the privacy notice renders', () => {
    it('has its heading and an updated date', () => {
        render(<PrivacyPolicyPage />);
        expect(screen.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeInTheDocument();
        expect(screen.getByText(/Last updated 8 September 2026/)).toBeInTheDocument();
    });

    it('keeps the sections a reader needs', () => {
        render(<PrivacyPolicyPage />);
        for (const title of [
            'Who we are',
            'What we collect',
            'Why we hold it',
            'WhatsApp and SMS',
            'Who we share it with',
            'Our automated assistant',
            'How long we keep it',
            'Your rights',
            'Changes to this policy',
        ]) {
            expect(screen.getByRole('heading', { name: title, level: 2 })).toBeInTheDocument();
        }
    });
});

describe('every processor that receives customer data is named, with a purpose', () => {
    // name → a word from the purpose the notice gives it, so a bare name with no reason fails.
    const RECIPIENTS: [string, RegExp][] = [
        ['Twilio and Meta', /deliver WhatsApp, SMS and calls/i],
        ['Anthropic', /drafts replies|Claude models/i],
        ['Google', /Gemini|describ/i],
        ['Deepgram', /transcript/i],
        ['OpenAI', /transcribe|draft/i],
        ['Amazon Web Services', /stores call recordings/i],
        ['Neon and Railway', /host our database and our servers/i],
        ['Resend', /email/i],
        ['Stripe', /card payments/i],
        ['Pushover', /alerts/i],
        ['PostHog', /how our quote and booking pages are used/i],
        ['Our tradespeople', /carry out your work/i],
        ['Our accountants and HMRC', /tax and accounting/i],
    ];

    it.each(RECIPIENTS)('names %s and says why', (name, purpose) => {
        render(<PrivacyPolicyPage />);
        const item = within(section('Who we share it with')).getByText(name).closest('li');
        expect(item, `no bullet for ${name}`).not.toBeNull();
        expect(item!.textContent).toMatch(purpose);
    });

    it('says that photos and video go to a model that describes them', () => {
        render(<PrivacyPolicyPage />);
        expect(within(section('Who we share it with')).getByText(/photos and videos you send are sent to Google/i)).toBeInTheDocument();
    });

    it('says information leaves the UK and on what footing', () => {
        render(<PrivacyPolicyPage />);
        expect(within(section('Who we share it with')).getByText(/outside the UK/i)).toBeInTheDocument();
    });
});

describe('the automated assistant is described', () => {
    it('says it may draft and send replies, that a person reviews the exceptions, and that a person can be asked for', () => {
        render(<PrivacyPolicyPage />);
        const text = section('Our automated assistant').textContent ?? '';
        expect(text).toMatch(/draft and send a reply/i);
        expect(text).toMatch(/held for\s+a person/i);
        expect(text).toMatch(/ask for a person at any time/i);
        expect(text).toMatch(/legal or similarly significant effect/i);
    });

    it('the reason for holding it is also given where we say why we hold the data', () => {
        render(<PrivacyPolicyPage />);
        expect(within(section('Why we hold it')).getByText(/automated assistant read the conversation/i)).toBeInTheDocument();
    });

    it('carries no bot-disclosure line for chat — that decision was "no" (answer 24)', () => {
        render(<PrivacyPolicyPage />);
        // The page describes the assistant; it must not invent a chat greeting for it.
        expect(document.body.textContent).not.toMatch(/this is Handy Services'? (assistant|bot)/i);
    });
});

describe('retention is stated for each category', () => {
    it.each([
        [/Job, quote and invoice records/, /six years/i],
        [/WhatsApp and SMS conversations/, /two years/i],
        [/Photos and videos you send/, /two years/i],
        [/Call recordings and their written transcripts/, /two years/i],
    ])('%s has a period', (label, period) => {
        render(<PrivacyPolicyPage />);
        const item = within(section('How long we keep it')).getByText(label).closest('li');
        expect(item, `no retention bullet matching ${label}`).not.toBeNull();
        expect(item!.textContent).toMatch(period);
    });

    it('says the providers hold their own copies under their own terms', () => {
        render(<PrivacyPolicyPage />);
        expect(within(section('How long we keep it')).getByText(/their own short-lived copies/i)).toBeInTheDocument();
    });
});
