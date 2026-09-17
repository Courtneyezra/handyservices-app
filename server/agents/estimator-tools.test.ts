/**
 * The estimator's `search_web` reader (round 11, 17 Sep 2026).
 *
 * Live on the comms-v2 door, pricing a four-job enquiry, the third search came back
 * "Web search failed: results is not iterable": one result block carried Anthropic's
 * `web_search_tool_result_error` object in `content` rather than an array of results, the `for
 * ... of` over it threw, and the catch around the whole request replaced the model's own answer,
 * material prices included, with that message. The quote estimator then priced the job with no
 * web evidence at all and said nothing about why.
 */
import { describe, it, expect } from 'vitest';
import { webSearchAnswer } from './estimator-tools';

describe('webSearchAnswer', () => {
    it('keeps the answer and names the error when a result block carries an error object instead of results', () => {
        const answer = webSearchAnswer([
            { type: 'text', text: 'Screwfix list a shelf board at £8.99 and brackets at £4.49 a pair.' },
            { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
        ]);
        expect(answer.summary).toContain('£8.99');
        expect(answer.errors).toEqual(['max_uses_exceeded']);
        expect(answer.sources).toEqual([]);
    });

    it('reads the sources of a search that worked, and both when one block errored and another did not', () => {
        const answer = webSearchAnswer([
            { type: 'web_search_tool_result', content: [{ type: 'web_search_result', title: 'Ceramic tap cartridge', url: 'https://www.screwfix.com/p/1' }] },
            { type: 'text', text: 'About £7.50 for a universal cartridge.' },
            { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } },
        ]);
        expect(answer.sources).toEqual([{ title: 'Ceramic tap cartridge', url: 'https://www.screwfix.com/p/1' }]);
        expect(answer.summary).toBe('About £7.50 for a universal cartridge.');
        expect(answer.errors).toEqual(['too_many_requests']);
    });

    it('an error inside the results array is named too, and a plain answer carries no error', () => {
        expect(webSearchAnswer([
            { type: 'web_search_tool_result', content: [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }] },
        ]).errors).toEqual(['unavailable']);
        const plain = webSearchAnswer([{ type: 'text', text: 'Nothing useful found.' }]);
        expect(plain).toEqual({ summary: 'Nothing useful found.', sources: [], errors: [] });
    });
});
