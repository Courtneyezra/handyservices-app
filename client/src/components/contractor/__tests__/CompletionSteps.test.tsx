/**
 * P15 part 4 jsdom — the completion sheet's new blocks: the per-task before/after cards, the
 * materials claim, the sign-off (with her reason when she is not happy) and the leftover report
 * with its "nothing to report" answer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskPhotoCards, MaterialsClaimStep, SignOffStep, LeftoverStep } from '@/components/contractor/CompletionSteps';
import type { SignOff } from '@shared/completion-gate';

const TITLE = 'Supply and fit bespoke portable AC window kit to TWO sash windows';
const TASKS = [{ lineId: 'card_1', title: TITLE }];

describe('TaskPhotoCards: the pack tells him what to photograph', () => {
    it('names each task and asks for a before and an after', () => {
        render(<TaskPhotoCards tasks={TASKS} photos={{}} uploading={null} onAdd={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByText(TITLE)).toBeInTheDocument();
        expect(screen.getByLabelText('Add before photo')).toBeInTheDocument();
        expect(screen.getByLabelText('Add after photo')).toBeInTheDocument();
        expect(screen.getAllByText('needed')).toHaveLength(2);
    });

    it('marks a half done once it has a photo, and still asks for the other', () => {
        render(<TaskPhotoCards tasks={TASKS} photos={{ card_1: { before: ['/b.jpg'] } }} uploading={null} onAdd={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByAltText('before photo 1')).toBeInTheDocument();
        expect(screen.getAllByText('needed')).toHaveLength(1);
    });

    it('reports which task and which half a photo belongs to', async () => {
        const onAdd = vi.fn();
        render(<TaskPhotoCards tasks={TASKS} photos={{}} uploading={null} onAdd={onAdd} onRemove={vi.fn()} />);
        const file = new File(['x'], 'after.jpg', { type: 'image/jpeg' });
        await userEvent.upload(screen.getByLabelText('Add after photo'), file);
        expect(onAdd).toHaveBeenCalledWith('card_1', 'after', expect.anything());
    });

    it('removes the right photo', async () => {
        const onRemove = vi.fn();
        render(<TaskPhotoCards tasks={TASKS} photos={{ card_1: { after: ['/a1.jpg', '/a2.jpg'] } }} uploading={null} onAdd={vi.fn()} onRemove={onRemove} />);
        await userEvent.click(screen.getByLabelText('Remove after photo 2'));
        expect(onRemove).toHaveBeenCalledWith('card_1', 'after', 1);
    });

    it('renders nothing at all when the job has no pack', () => {
        const { container } = render(<TaskPhotoCards tasks={[]} photos={{}} uploading={null} onAdd={vi.fn()} onRemove={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('MaterialsClaimStep: only if he spent money', () => {
    const draft = { total: '', receiptUrls: [], note: '' };

    it('shows what the pack told him to buy and what was allowed for it', () => {
        render(
            <MaterialsClaimStep
                draft={draft} onChange={vi.fn()} uploading={false} onReceipt={vi.fn()} onRemoveReceipt={vi.fn()}
                expectedPence={2000} items={[{ name: 'Sash AC kit panel', qty: 2 }]}
            />,
        );
        expect(screen.getByText('Sash AC kit panel')).toBeInTheDocument();
        expect(screen.getByText('×2')).toBeInTheDocument();
        expect(screen.getByText('Allowed for: £20.00')).toBeInTheDocument();
        expect(screen.getByText('Leave it blank if you bought nothing.')).toBeInTheDocument();
    });

    it('takes a total and keeps it numeric', async () => {
        const onChange = vi.fn();
        render(
            <MaterialsClaimStep
                draft={draft} onChange={onChange} uploading={false} onReceipt={vi.fn()} onRemoveReceipt={vi.fn()}
                expectedPence={0} items={[]}
            />,
        );
        await userEvent.type(screen.getByLabelText('Total spent on materials'), '2');
        expect(onChange).toHaveBeenCalledWith({ ...draft, total: '2' });
    });
});

describe('SignOffStep: happy or not happy', () => {
    it('asks the question and records happy', async () => {
        const onChange = vi.fn();
        render(<SignOffStep value={{ verdict: null }} onChange={onChange} />);
        expect(screen.getByText('Is she happy with it?')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Happy/ }));
        expect(onChange).toHaveBeenCalledWith({ verdict: 'happy' });
    });

    it('asks for her words only once not happy is chosen', async () => {
        const value: SignOff = { verdict: null };
        const { rerender } = render(<SignOffStep value={value} onChange={vi.fn()} />);
        expect(screen.queryByLabelText('What is not right, in her words')).not.toBeInTheDocument();
        rerender(<SignOffStep value={{ verdict: 'not_happy' }} onChange={vi.fn()} />);
        expect(screen.getByLabelText('What is not right, in her words')).toBeInTheDocument();
        expect(screen.getByText('The office sees this straight away. Say what she said.')).toBeInTheDocument();
    });
});

describe('LeftoverStep: snags, spotted work, access for next time', () => {
    it('offers the three boxes and the explicit nothing', () => {
        render(<LeftoverStep value={{}} onChange={vi.fn()} />);
        expect(screen.getByLabelText('Snags')).toBeInTheDocument();
        expect(screen.getByLabelText('Extras spotted')).toBeInTheDocument();
        expect(screen.getByLabelText('Access notes for next time')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Nothing to report' })).toBeInTheDocument();
    });

    it('answering "nothing to report" clears the boxes and marks the answer', async () => {
        const onChange = vi.fn();
        render(<LeftoverStep value={{ snags: 'typed then changed his mind' }} onChange={onChange} />);
        await userEvent.click(screen.getByRole('button', { name: 'Nothing to report' }));
        expect(onChange).toHaveBeenCalledWith({ snags: '', extras: '', accessNotes: '', nothingToReport: true });
    });

    it('typing an access note un-answers "nothing" so the two can never both be true', async () => {
        const onChange = vi.fn();
        render(<LeftoverStep value={{ nothingToReport: false }} onChange={onChange} />);
        await userEvent.type(screen.getByLabelText('Access notes for next time'), 'K');
        expect(onChange).toHaveBeenCalledWith({ nothingToReport: false, accessNotes: 'K' });
    });

    it('the boxes are disabled once he has said there is nothing', () => {
        render(<LeftoverStep value={{ nothingToReport: true }} onChange={vi.fn()} />);
        expect(screen.getByLabelText('Snags')).toBeDisabled();
        expect(screen.getByRole('button', { name: /Nothing to report/ })).toHaveAttribute('aria-pressed', 'true');
    });
});
