/**
 * P13c jsdom: the job pack inside My Week's job drawer — the task's quotes and photos, the missing
 * list, the chip in the panel header, the "changed since you accepted" strip; nothing without a pack.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobPackPanel } from '@/components/contractor/JobPackPanel';
import type { ContractorPackView } from '@/components/contractor/JobPackSection';

const TITLE = 'Supply and fit bespoke portable AC window kit to TWO sash windows';

const mj = (over: Partial<ContractorPackView> = {}): ContractorPackView => ({
    quoteId: 'quote_mj',
    tasks: [{
        lineId: 'card_1',
        customerWords: ['I need a portable AC window kit fitting to two sash windows'],
        mediaUrls: ['/api/media/m2.jpg', '/api/media/m3.jpg'],
        procedure: [], assumptions: ['Kit sized to the sash opening on the day'], exclusions: [],
        sizes: null, spec: null, supplyBy: 'us',
        materials: [{ name: 'Sash AC kit panel', qty: 2, supplier: 'screwfix', sku: '55501', size: '600 × 400 mm', unitPricePence: 1000 }],
        hazards: [], disposal: null, leadTime: null,
        minutes: { low: null, point: 150, high: null },
    }],
    job: { accessMethod: "We'll be in all day", accessCodes: null, onSiteContact: null, locked: false, floor: null, hasLift: null, parkingDistance: 'street_outside', parkingPermit: null, occupied: null, pets: null, prep: null, utilities: null, deliverySlot: null, doneLooksLike: null, accessNotes: [] },
    changes: [],
    missing: ['job.onSiteContact', 'job.pets', 'job.prep', 'job.deliverySlot', 'line:card_1.sizes', 'line:card_1.spec', 'line:card_1.leadTime'],
    missingLabels: ['who is on site', 'pets', 'what the customer prepares', 'delivery slot', `sizes for "${TITLE}"`, `spec for "${TITLE}"`, `lead time for "${TITLE}"`],
    lockedAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z',
    ...over,
});

describe('JobPackPanel', () => {
    it('renders the task with her words and both photos, the job fields with the missing ones marked, and the chip', async () => {
        const onPhoto = vi.fn();
        render(<JobPackPanel pack={mj()} onPhoto={onPhoto} />);
        const panel = screen.getByTestId('my-week-job-pack');
        expect(within(panel).getByText(/Job pack · 1 task/)).toBeInTheDocument();
        expect(within(panel).getByTestId('pack-chip')).toHaveTextContent('7 missing');
        const words = within(panel).getByTestId('pack-words-card_1');
        expect(words).toHaveTextContent('I need a portable AC window kit fitting to two sash windows');
        const photos = within(within(panel).getByTestId('pack-photos-card_1')).getAllByRole('button', { name: 'Photo for this task' });
        expect(photos).toHaveLength(2);
        await userEvent.click(photos[1]);
        expect(onPhoto).toHaveBeenCalledWith('/api/media/m3.jpg');
        expect(within(panel).getByTestId('pack-materials-card_1')).toHaveTextContent('2× Sash AC kit panel');
        expect(within(panel).getByTestId('pack-materials-card_1')).toHaveTextContent('Screwfix · 55501');
        expect(within(panel).getByTestId('pack-access')).toHaveTextContent("We'll be in all day");
        expect(within(panel).getByTestId('pack-parking')).toHaveTextContent('On the street outside');
        expect(within(panel).getByTestId('unknown-pets')).toBeInTheDocument();
        expect(within(panel).getByTestId('pack-missing')).toHaveTextContent(`Still being confirmed: who is on site; pets; what the customer prepares; delivery slot; sizes for "${TITLE}"`);
        expect(within(panel).queryByTestId('pack-changed')).toBeNull();
    });
    it('shows "Pack complete" when nothing is missing and the changed-since strip when the log has rows after acceptance', () => {
        render(<JobPackPanel pack={mj({ missing: [], missingLabels: [], changes: [{ at: '2026-09-06T09:00:00.000Z', field: 'job.pets', label: 'pets', to: 'One small dog' }] })} />);
        expect(screen.getByTestId('pack-chip')).toHaveTextContent('Pack complete');
        expect(screen.getByTestId('pack-changed')).toHaveTextContent('pets: One small dog');
        expect(screen.queryByTestId('pack-missing')).toBeNull();
    });
    it('renders nothing without a pack', () => {
        const { container } = render(<JobPackPanel pack={null} />);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId('my-week-job-pack')).toBeNull();
    });
});
