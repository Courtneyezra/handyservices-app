/**
 * P15 part 1 jsdom: the customer's quote line renders "Not included" in plain words under the
 * line, as Ben sent it, and stays silent when the line has none.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuoteLineRow } from '@/components/quote/UnifiedQuoteCard';

const line = (over: Record<string, unknown> = {}) => ({
    description: 'Supply and hang 8 oak panelled doors', category: 'door_fitting', guardedPricePence: 72480, materialsWithMarginPence: 121920,
    customerDescription: 'Eight oak doors to match the three done in June', assumptions: ['Frames are sound'], ...over,
}) as any;

describe('QuoteLineRow: not included', () => {
    it('lists what is not included under the line, after the assumptions', () => {
        render(<QuoteLineRow item={line({ notIncluded: ['decorating the frames not included', 'frames reused'] })} isDarkTheme={false} />);
        const block = screen.getByTestId('line-not-included');
        expect(block).toHaveTextContent('Not included');
        expect(block.querySelectorAll('li')).toHaveLength(2);
        expect(block).toHaveTextContent('frames reused');
        expect(screen.getByText('Priced assuming').compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    it('renders nothing for an empty or absent list', () => {
        render(<QuoteLineRow item={line({ notIncluded: [] })} isDarkTheme={true} />);
        expect(screen.queryByTestId('line-not-included')).toBeNull();
    });
});
