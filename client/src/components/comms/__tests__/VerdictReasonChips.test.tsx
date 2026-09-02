/**
 * VerdictReasonChips — five reason chips, one tap submits (COMMS_AGENTS_V3_DESIGN §4).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerdictReasonChips, VERDICT_REASONS, REASON_LABELS } from '@/components/comms/VerdictReasonChips';

describe('VerdictReasonChips', () => {
    it('renders the prompt and exactly five reason chips with their labels', () => {
        render(<VerdictReasonChips prompt="Why reject?" onPick={() => {}} onCancel={() => {}} />);
        expect(screen.getByText('Why reject?')).toBeInTheDocument();
        const chips = screen.getAllByRole('button').filter((b) => b.textContent !== 'cancel');
        expect(chips).toHaveLength(5);
        expect(VERDICT_REASONS).toEqual(['fine', 'tone', 'wrong_move', 'unsafe', 'missing_info']);
        for (const r of VERDICT_REASONS) expect(screen.getByRole('button', { name: REASON_LABELS[r] })).toBeInTheDocument();
    });

    it('tapping a chip submits that reason once, with the underscore key not the label', async () => {
        const onPick = vi.fn();
        render(<VerdictReasonChips prompt="p" onPick={onPick} onCancel={() => {}} />);
        await userEvent.click(screen.getByRole('button', { name: 'wrong move' }));
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledWith('wrong_move');
    });

    it('cancel calls onCancel and never onPick', async () => {
        const onPick = vi.fn(); const onCancel = vi.fn();
        render(<VerdictReasonChips prompt="p" onPick={onPick} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onPick).not.toHaveBeenCalled();
    });

    it('busy disables every chip and cancel and shows the spinner', () => {
        render(<VerdictReasonChips prompt="p" onPick={() => {}} onCancel={() => {}} busy />);
        for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
        expect(document.querySelector('.animate-spin')).not.toBeNull();
    });

    it('the unsafe chip is styled red whatever the tone', () => {
        render(<VerdictReasonChips prompt="p" onPick={() => {}} onCancel={() => {}} tone="amber" />);
        expect(screen.getByRole('button', { name: 'unsafe' }).className).toMatch(/border-red-400/);
        expect(screen.getByRole('button', { name: 'tone' }).className).toMatch(/border-amber-400/);
    });
});
