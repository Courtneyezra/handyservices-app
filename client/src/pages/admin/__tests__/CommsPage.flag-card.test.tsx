/**
 * T17: a flagged row gets its note and a due chip back on the desk — the pill on the board card
 * (FlagPill) and the one-line note above the composer (FlagNoteCard), only while needs_ben stands.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FlagPill, FlagNoteCard, flagExceptionLabel, flagNotesFor, type AgentQuestion } from '@/pages/admin/CommsPage';

const q = (over: Partial<AgentQuestion> = {}): AgentQuestion => ({
    id: 'aq_1', conversationId: 'c1', question: '[money_question] Customer does not want to pay for a quote', context: null,
    options: null, answer: null, status: 'flagged', createdAt: '2026-09-07T07:42:00.000Z', dueAt: null, ...over,
});

describe('flagExceptionLabel', () => {
    it('reads the exception off the note; a note without one is just "Flagged"', () => {
        expect(flagExceptionLabel('[money_question] pay for a quote')).toBe('money question');
        expect(flagExceptionLabel('[out_of_scope] roofing')).toBe('out of scope');
        expect(flagExceptionLabel('legacy note with no bracket')).toBe('Flagged');
        expect(flagExceptionLabel(null)).toBe('Flagged');
    });
});

describe('FlagPill (board card)', () => {
    it('draws the exception, the overdue chip and the full note as the title', () => {
        render(<FlagPill card={{ flagNote: '[money_question] does not want to pay', flagDueAt: new Date(Date.now() - 12 * 3600_000).toISOString() }} />);
        const pill = screen.getByTestId('flag-pill');
        expect(pill).toHaveTextContent('🚩 money question');
        expect(pill).toHaveAttribute('title', '[money_question] does not want to pay');
        expect(screen.getByText('overdue by 12h')).toBeInTheDocument();
    });

    it('a flag still inside its clock shows "due in"; a legacy flag with no clock shows no chip', () => {
        render(<FlagPill card={{ flagNote: '[complaint] unhappy', flagDueAt: new Date(Date.now() + 2 * 3600_000).toISOString() }} />);
        expect(screen.getByText('due in 2h')).toBeInTheDocument();
        const { container } = render(<FlagPill card={{ flagNote: 'legacy', flagDueAt: null }} />);
        expect(within(container).getByTestId('flag-pill')).toHaveTextContent('🚩 Flagged');
        expect(within(container).queryByText(/due in|overdue/)).toBeNull();
    });

    it('draws nothing when the card carries no flag (an older payload, or the tag is off)', () => {
        const { container } = render(<FlagPill card={{ flagNote: null, flagDueAt: null }} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('flagNotesFor + FlagNoteCard (thread panel)', () => {
    it('passes the NEWEST flagged row only while needs_ben stands, plus every answered row', () => {
        const older = q({ id: 'aq_old', createdAt: '2026-09-06T07:00:00.000Z', question: '[out_of_scope] roofing' });
        const newer = q({ id: 'aq_new' });
        const answered = q({ id: 'aq_ans', status: 'answered', answer: 'Saturday is fine' });
        expect(flagNotesFor([older, answered, newer], ['needs_ben']).map((x) => x.id)).toEqual(['aq_new', 'aq_ans']);
        expect(flagNotesFor([older, answered, newer], []).map((x) => x.id)).toEqual(['aq_ans']);
    });

    it('a flagged row renders as one line: the exception, the due chip, the note without its bracket, and how it clears', () => {
        render(<FlagNoteCard q={q({ dueAt: new Date(Date.now() - 40 * 60_000).toISOString() })} />);
        const line = screen.getByTestId('flag-note');
        expect(line).toHaveTextContent('Flagged for you · money question');
        expect(line).toHaveTextContent('overdue by 40m');
        expect(line).toHaveTextContent('Customer does not want to pay for a quote');
        expect(line).not.toHaveTextContent('[money_question]');
        expect(line).toHaveTextContent('Reply in the thread and it clears.');
    });

    it('an open (retired relay) row still renders nothing; an answered row renders the answer', () => {
        const { container } = render(<FlagNoteCard q={q({ status: 'open' })} />);
        expect(container).toBeEmptyDOMElement();
        render(<FlagNoteCard q={q({ status: 'answered', answer: 'Saturday is fine' })} />);
        expect(screen.getByText(/Saturday is fine/)).toBeInTheDocument();
    });
});
