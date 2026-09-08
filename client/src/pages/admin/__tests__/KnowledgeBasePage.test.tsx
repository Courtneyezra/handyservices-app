/**
 * /admin/knowledge — the knowledge base page (build plan v2, item 3.4).
 *
 * What the page has to get right, because Ben is the only rail: the status is unmissable, an
 * unreviewed entry says so in plain English, a question for Ben cannot be reviewed as an answer,
 * reviewing is one tap that hits the review route, and the four website contradictions read as
 * questions rather than facts.
 */
import { describe, it, expect } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { mockFetch, renderWithQuery } from '@test-utils';
import KnowledgeBasePage from '@/pages/admin/KnowledgeBasePage';
import { reviewOrder, reviewedLabel, whyNotReviewable, type KbEntry, type KbPayload } from '@/hooks/useKnowledgeBase';

const entry = (over: Partial<KbEntry> & { id: string; topic: string }): KbEntry => ({
    kind: 'answer', approvedWords: 'We are Nottingham based.', bannedWords: [], status: 'unreviewed',
    reviewedBy: null, reviewedAt: null, benNote: null, sourceNote: null,
    createdAt: '2026-09-08T08:00:00.000Z', updatedAt: '2026-09-08T08:00:00.000Z',
    ...over,
});

const live = entry({ id: 'deposit-and-payment', topic: 'How do I pay, and when?', approvedWords: 'You pay a deposit to book it in, then the rest once the work is done.', status: 'reviewed', reviewedBy: 'human:ben@handyservices.app', reviewedAt: '2026-09-08T09:00:00.000Z', updatedAt: '2026-09-08T09:00:00.000Z' });
const draft = entry({ id: 'areas-covered', topic: 'Which areas do you cover?', bannedWords: ['nationwide'], updatedAt: '2026-09-08T08:30:00.000Z' });
const blank = entry({ id: 'how-soon-can-you-come', topic: 'How soon can you come?', approvedWords: '', benNote: 'YOUR WORDS NEEDED.', updatedAt: '2026-09-08T08:40:00.000Z' });
const question = entry({ id: 'question-is-the-quote-free', topic: 'Is the quote free?', kind: 'question', approvedWords: '', benNote: 'THE WEBSITE SAYS: "Quotes are free with no obligation." THE DESK\'S RULES SAY: visits are never free.', updatedAt: '2026-09-08T08:10:00.000Z' });
const retired = entry({ id: 'old-thing', topic: 'Something we stopped saying', status: 'retired', updatedAt: '2026-09-08T07:00:00.000Z' });

const payload = (entries: KbEntry[]): KbPayload => ({
    entries,
    counts: {
        unreviewed: entries.filter((e) => e.status === 'unreviewed').length,
        reviewed: entries.filter((e) => e.status === 'reviewed').length,
        retired: entries.filter((e) => e.status === 'retired').length,
        questions: entries.filter((e) => e.kind === 'question' && e.status !== 'retired').length,
    },
});

const ALL = [live, draft, blank, question, retired];

describe('the page\'s pure rules', () => {
    it('reviewOrder: his questions first, then what is waiting, then what is live, then retired', () => {
        expect(reviewOrder(ALL).map((e) => e.id)).toEqual([
            'question-is-the-quote-free',
            'areas-covered',
            'how-soon-can-you-come',
            'deposit-and-payment',
            'old-thing',
        ]);
    });
    it('reviewedLabel says when, in his language, and says plainly when it has never been reviewed', () => {
        const now = new Date('2026-09-08T12:00:00Z');
        expect(reviewedLabel(live, now)).toBe('You reviewed this today');
        expect(reviewedLabel({ status: 'reviewed', reviewedAt: '2026-09-07T09:00:00Z' }, now)).toBe('You reviewed this yesterday');
        expect(reviewedLabel({ status: 'reviewed', reviewedAt: '2026-09-01T09:00:00Z' }, now)).toBe('You reviewed this 7 days ago');
        expect(reviewedLabel({ status: 'reviewed', reviewedAt: '2026-06-01T09:00:00Z' }, now)).toMatch(/^You reviewed this on 1 Jun 2026$/);
        expect(reviewedLabel(draft, now)).toBe('Not reviewed yet');
        expect(reviewedLabel(retired, now)).toBe('Not reviewed yet');
    });
    it('whyNotReviewable: a question is not an answer, and there must be words', () => {
        expect(whyNotReviewable(question)).toMatch(/question for you, not an answer/);
        expect(whyNotReviewable(blank)).toMatch(/nothing to approve yet/);
        expect(whyNotReviewable(draft)).toBeNull();
    });
});

describe('the page', () => {
    it('shows how many are live and how many are still waiting for him', async () => {
        mockFetch([{ url: '/api/spine/kb', reply: () => ({ json: payload(ALL) }) }]);
        renderWithQuery(<KnowledgeBasePage />);
        expect(await screen.findByTestId('kb-count')).toHaveTextContent('1 in use · 3 waiting for you');
    });

    it('an unreviewed entry says so in words, and a reviewed one says who and when', async () => {
        mockFetch([{ url: '/api/spine/kb', reply: () => ({ json: payload(ALL) }) }]);
        renderWithQuery(<KnowledgeBasePage />);
        const waiting = await screen.findByTestId('kb-card-areas-covered');
        expect(within(waiting).getByTestId('kb-status')).toHaveTextContent('Not in use yet');
        expect(within(waiting).getByTestId('kb-reviewed-label')).toHaveTextContent('Not reviewed yet');

        const inUse = screen.getByTestId('kb-card-deposit-and-payment');
        expect(within(inUse).getByTestId('kb-status')).toHaveTextContent('In use');
        expect(within(inUse).getByTestId('kb-reviewed-label')).toHaveTextContent('ben@handyservices.app');
    });

    it('a question for Ben reads as a question, shows the conflict, and offers no review button', async () => {
        mockFetch([{ url: '/api/spine/kb', reply: () => ({ json: payload(ALL) }) }]);
        renderWithQuery(<KnowledgeBasePage />);
        const card = await screen.findByTestId('kb-card-question-is-the-quote-free');
        expect(within(card).getByTestId('kb-question-chip')).toHaveTextContent('A question for you');
        expect(within(card).getByTestId('kb-ben-note')).toHaveTextContent('THE WEBSITE SAYS');
        expect(within(card).getByTestId('kb-reviewed-label')).toHaveTextContent('Nothing is sent from a question');
        // the review button exists but is refused, with the reason on the card
        expect(within(card).getByTestId('kb-review')).toBeDisabled();
        expect(within(card).getByTestId('kb-blocked')).toHaveTextContent(/not an answer/);
    });

    it('an entry with no words yet cannot be reviewed', async () => {
        mockFetch([{ url: '/api/spine/kb', reply: () => ({ json: payload(ALL) }) }]);
        renderWithQuery(<KnowledgeBasePage />);
        const card = await screen.findByTestId('kb-card-how-soon-can-you-come');
        expect(within(card).getByTestId('kb-words-empty')).toBeInTheDocument();
        expect(within(card).getByTestId('kb-review')).toBeDisabled();
    });

    it('reviewing is one tap, and it posts to the review route', async () => {
        const f = mockFetch([
            { url: '/api/spine/kb', reply: () => ({ json: payload(ALL) }) },
            { method: 'POST', url: '/api/spine/kb/areas-covered/review', reply: () => ({ json: { ok: true, entry: { ...draft, status: 'reviewed' } } }) },
        ]);
        renderWithQuery(<KnowledgeBasePage />);
        const card = await screen.findByTestId('kb-card-areas-covered');
        fireEvent.click(within(card).getByTestId('kb-review'));
        await waitFor(() => expect(f.calls.some((c) => c.method === 'POST' && c.url === '/api/spine/kb/areas-covered/review')).toBe(true));
    });

    it('the banned phrases are shown, so he can see what the desk must never say on that topic', async () => {
        mockFetch([{ url: '/api/spine/kb', reply: () => ({ json: payload(ALL) }) }]);
        renderWithQuery(<KnowledgeBasePage />);
        const card = await screen.findByTestId('kb-card-areas-covered');
        expect(within(card).getByTestId('kb-banned')).toHaveTextContent('nationwide');
    });

    it('editing a reviewed entry warns that the change takes it back off', async () => {
        mockFetch([{ url: '/api/spine/kb', reply: () => ({ json: payload(ALL) }) }]);
        renderWithQuery(<KnowledgeBasePage />);
        const card = await screen.findByTestId('kb-card-deposit-and-payment');
        fireEvent.click(within(card).getByTestId('kb-edit'));
        fireEvent.change(within(card).getByTestId('kb-editor-words'), { target: { value: 'Something different.' } });
        expect(within(card).getByTestId('kb-editor-unmake')).toHaveTextContent(/takes this back off/);
    });

    it('an expired session sends him to log in, not to a blank page', async () => {
        mockFetch([{ url: '/api/spine/kb', reply: () => ({ status: 401, json: {} }) }]);
        renderWithQuery(<KnowledgeBasePage />);
        expect(await screen.findByTestId('kb-auth')).toHaveTextContent('session has expired');
    });
});
