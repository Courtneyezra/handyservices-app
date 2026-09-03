/**
 * P13 part 3 jsdom: the job pack on the contractor's page — per task (her words, the photo for
 * that task, how, not included, bring / buy with where to buy, hazards), per job (access, contact,
 * parking, pets, prep, delivery) with codes and the contact locked before acceptance, the
 * "changed since you accepted" strip, and the list chip.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobPackTask, JobPackJob, ChangedSinceStrip, PackChip, valueText, type PackTaskView, type PackJobView } from '@/components/contractor/JobPackSection';

const doors: PackTaskView = {
    lineId: 'card_1',
    customerWords: ["I'm looking for all 9 doors to be replaced", 'oak to match the ones you did'],
    mediaUrls: ['/signed/p1.jpg', '/signed/p2.jpg'],
    procedure: ['Remove old doors', 'Trim and hang', 'Fit ironmongery', 'Adjust and finish'],
    assumptions: ['Frames are sound'],
    exclusions: ['Decorating the frames'],
    sizes: '762 × 1981 mm', spec: 'oak veneer, 4 panel', supplyBy: 'us',
    materials: [{ name: 'Oak panelled door', qty: 8, supplier: 'screwfix', sku: '8842K', size: '762 × 1981', unitPricePence: 12000 }, { name: 'Coniston handle set', qty: 8, supplier: 'model', sku: null, size: null, unitPricePence: 1800 }],
    hazards: ['ladder', 'unknown substrate'], disposal: 'We take the old doors', leadTime: '5 working days',
    minutes: { low: 640, point: 880, high: 1120 },
};

const job = (over: Partial<PackJobView> = {}): PackJobView => ({
    accessMethod: 'Key safe by the porch', accessCodes: '4471', onSiteContact: { name: 'Sarah', phone: '07811346936', role: 'customer' }, locked: false,
    floor: 1, hasLift: null, parkingDistance: 'on_drive', parkingPermit: null, occupied: true, pets: 'One cat, keep the front door shut',
    prep: null, utilities: null, deliverySlot: 'Any morning, side passage', doneLooksLike: 'Nine matching oak doors closing cleanly', accessNotes: ['first floor'], ...over,
});

describe('JobPackTask', () => {
    it("shows her words, the photo for that task, how, priced on the basis that, not included, bring / buy with where to buy, hazards and waste", async () => {
        const onPhoto = vi.fn();
        render(<JobPackTask task={doors} onPhoto={onPhoto} />);
        const t = screen.getByTestId('pack-task-card_1');
        expect(within(t).getByTestId('pack-words-card_1')).toHaveTextContent("I'm looking for all 9 doors to be replaced");
        expect(within(t).getByTestId('pack-photos-card_1').querySelectorAll('img')).toHaveLength(2);
        await userEvent.click(within(t).getAllByLabelText('Photo for this task')[0]);
        expect(onPhoto).toHaveBeenCalledWith('/signed/p1.jpg');
        expect(within(t).getByTestId('pack-spec-card_1')).toHaveTextContent('Sizes: 762 × 1981 mm');
        expect(within(t).getByTestId('pack-spec-card_1')).toHaveTextContent('We supply the materials');
        expect(within(t).getByTestId('pack-spec-card_1')).toHaveTextContent('Lead time: 5 working days');
        expect(within(t).getByTestId('pack-procedure-card_1').querySelectorAll('li')).toHaveLength(4);
        expect(within(t).getByTestId('pack-assumptions-card_1')).toHaveTextContent('Frames are sound');
        expect(within(t).getByTestId('pack-exclusions-card_1')).toHaveTextContent('Decorating the frames');
        const mats = within(t).getByTestId('pack-materials-card_1');
        expect(mats).toHaveTextContent('8× Oak panelled door');
        expect(mats).toHaveTextContent('Screwfix · 8842K');
        expect(mats).toHaveTextContent('Any merchant');
        expect(within(t).getByTestId('pack-hazards-card_1')).toHaveTextContent('Watch for: ladder, unknown substrate');
        expect(within(t).getByTestId('pack-hazards-card_1')).toHaveTextContent('Waste: We take the old doors');
    });
    it('a bare task renders nothing it does not have', () => {
        render(<JobPackTask task={{ ...doors, customerWords: [], mediaUrls: [], procedure: [], assumptions: [], exclusions: [], materials: [], hazards: [], disposal: null, sizes: null, spec: null, supplyBy: null, leadTime: null }} />);
        const t = screen.getByTestId('pack-task-card_1');
        expect(within(t).queryByTestId('pack-words-card_1')).toBeNull();
        expect(within(t).queryByTestId('pack-materials-card_1')).toBeNull();
        expect(within(t).queryByTestId('pack-spec-card_1')).toBeNull();
    });
});

describe('JobPackJob', () => {
    it('after acceptance: access with the code, the contact with a tel link, parking in words, pets, delivery, done looks like', () => {
        render(<JobPackJob job={job()} missingLabels={['what the customer prepares']} />);
        expect(screen.getByTestId('pack-access')).toHaveTextContent('Key safe by the porch');
        expect(screen.getByTestId('pack-codes')).toHaveTextContent('4471');
        expect(screen.getByTestId('pack-contact')).toHaveTextContent('Sarah · customer');
        expect(screen.getByTestId('pack-contact').querySelector('a')).toHaveAttribute('href', 'tel:07811346936');
        expect(screen.getByTestId('pack-contact')).toHaveTextContent('Property occupied');
        expect(screen.getByTestId('pack-parking')).toHaveTextContent('On the drive');
        expect(screen.getByTestId('pack-parking')).toHaveTextContent('Floor 1');
        expect(screen.getByTestId('pack-pets')).toHaveTextContent('One cat');
        expect(screen.getByTestId('pack-prep')).toHaveTextContent('not yet known');
        expect(screen.getByTestId('pack-delivery')).toHaveTextContent('Any morning, side passage');
        expect(screen.getByTestId('pack-done')).toHaveTextContent('Nine matching oak doors');
        expect(screen.getByTestId('pack-missing')).toHaveTextContent('Still being confirmed: what the customer prepares.');
    });
    it('before acceptance: no code, no contact, and it says why', () => {
        render(<JobPackJob job={job({ locked: true, accessCodes: null, onSiteContact: null })} />);
        expect(screen.queryByTestId('pack-codes')).toBeNull();
        expect(screen.getByTestId('pack-access')).toHaveTextContent('Codes and the contact unlock on accept');
        expect(screen.getByTestId('pack-contact')).toHaveTextContent('unlocks on accept');
        expect(screen.queryByTestId('pack-missing')).toBeNull();
    });
});

describe('ChangedSinceStrip / PackChip / valueText', () => {
    it('lists day-relevant changes in words with the new value; nothing when there are none', () => {
        const { rerender } = render(<ChangedSinceStrip changes={[{ at: '2026-09-07T09:00:00.000Z', field: 'job.parkingDistance', label: 'parking', to: 'street_outside' }, { at: '2026-09-07T08:00:00.000Z', field: 'job.onSiteContact', label: 'who is on site', to: { name: 'Dave', phone: '07700900123', role: null } }]} />);
        expect(screen.getByTestId('pack-changed')).toHaveTextContent('Changed since you accepted');
        expect(screen.getByTestId('pack-change-0')).toHaveTextContent('parking: On the street outside');
        expect(screen.getByTestId('pack-change-1')).toHaveTextContent('who is on site: Dave · 07700900123');
        rerender(<ChangedSinceStrip changes={[]} />);
        expect(screen.queryByTestId('pack-changed')).toBeNull();
        expect(valueText(true)).toBe('yes');
        expect(valueText(null)).toBe('cleared');
        expect(valueText(['a', { name: 'b' }])).toBe('a, b');
    });
    it('the chip says complete or how many are missing', () => {
        const { rerender } = render(<PackChip pack={{ complete: true, missing: 0, label: 'Pack complete' }} />);
        expect(screen.getByTestId('pack-chip')).toHaveTextContent('Pack complete');
        rerender(<PackChip pack={{ complete: false, missing: 3, label: '3 missing' }} />);
        expect(screen.getByTestId('pack-chip')).toHaveTextContent('3 missing');
        rerender(<PackChip pack={null} />);
        expect(screen.queryByTestId('pack-chip')).toBeNull();
    });
});

describe('P15 part 1: "Not included" beside the customer\'s words', () => {
    it('renders the customer-facing list right under her words and drops the raw exclusions block', () => {
        render(<JobPackTask task={{ ...doors, notIncluded: ['decorating the frames not included', 'frames reused'] }} />);
        const t = screen.getByTestId('pack-task-card_1');
        const strip = within(t).getByTestId('pack-not-included-card_1');
        expect(strip).toHaveTextContent('Not included: decorating the frames not included, frames reused');
        expect(within(t).queryByTestId('pack-exclusions-card_1')).toBeNull();
        // Beside her words: the strip follows the words block in document order.
        const words = within(t).getByTestId('pack-words-card_1');
        expect(words.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    it('without a list the raw exclusions still show, as before', () => {
        render(<JobPackTask task={{ ...doors, notIncluded: [] }} />);
        expect(screen.queryByTestId('pack-not-included-card_1')).toBeNull();
        expect(screen.getByTestId('pack-exclusions-card_1')).toHaveTextContent('Decorating the frames');
    });
});
