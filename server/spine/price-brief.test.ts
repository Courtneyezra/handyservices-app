/**
 * P12 vitest: the briefing behind the price-and-send screen, pure — the thread window, which of
 * her messages a line came from (with the photos), the assumption-versus-materials contradiction
 * on Sarah's doors, the desk's customer message (no price, no date, no dash), the send body with
 * materials / assumptions / message / resolutions, the verdict meta, next steps. No database.
 */
import { describe, it, expect } from 'vitest';
import {
    buildThread, evidenceForLine, evidenceForLines, findContradictions, reusedNouns, mainClause, draftCustomerMessage, messageViolations, jobPhrase, withQuoteLink,
    nextStepsAfterSend, holdOf, cleanQuestion, keywordsOf, sentenceWith, type ThreadMessage,
} from './price-brief';
import { buildPricePayload, buildScreenLine, flatBandFromMinutes, validateSendBody, verdictRowsFor, confirmedLineItems, materialsPenceFor, e164, type DraftRowShape, type EstimateRowShape } from './price-screen';

const T = (h: number, m = 0, d = 4) => `2026-09-0${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const msg = (over: Partial<ThreadMessage> & { id: string; at: string; direction: 'in' | 'out' }): ThreadMessage => ({ channel: 'whatsapp', body: '', media: null, by: null, ...over });

/** Sarah's thread, in short: invoice reminders in May, the doors in September, six photos. */
const sarah: ThreadMessage[] = [
    msg({ id: 'r1', at: '2026-05-12T09:00:00.000Z', direction: 'out', body: 'Reminder: invoice INV-0142 is due.' }),
    msg({ id: 'r2', at: '2026-06-02T09:00:00.000Z', direction: 'out', body: 'Reminder: invoice INV-0142 is overdue.' }),
    msg({ id: 's1', at: T(17, 40), direction: 'in', body: 'Hi, you quoted 3 doors in June. Can you do all 9 doors now, oak to match the ones you did?' }),
    msg({ id: 's2', at: T(17, 53), direction: 'in', body: '', media: { url: '/api/media/p1', kind: 'image' } }),
    msg({ id: 's3', at: T(17, 53), direction: 'in', body: '', media: { url: '/api/media/p2', kind: 'image' } }),
    msg({ id: 's4', at: T(17, 55), direction: 'in', body: 'The airing cupboard door is a different size, photo attached', media: { url: '/api/media/p3', kind: 'image' } }),
    msg({ id: 'o1', at: T(18, 19), direction: 'out', body: 'Got it, back to you shortly.' }),
    msg({ id: 's5', at: T(18, 30), direction: 'in', body: 'Handles can stay as they are, we like them.' }),
];

describe('buildThread', () => {
    it('keeps the whole thread (the May and June reminders included), in time order, and windows the last 24 h before her latest', () => {
        const t = buildThread([...sarah].reverse());
        expect(t.messages.map((m) => m.id)).toEqual(['r1', 'r2', 's1', 's2', 's3', 's4', 'o1', 's5']);
        expect(t.firstInboundAt).toBe(T(17, 40));
        expect(t.latestInboundId).toBe('s5');
        expect(t.recentSince).toBe('2026-09-03T18:30:00.000Z');
        expect(t.count).toBe(8);
    });
    it('a thread with no inbound keeps what it has; an empty thread is empty', () => {
        expect(buildThread([sarah[0]]).messages).toHaveLength(1);
        expect(buildThread([])).toEqual({ messages: [], recentSince: null, firstInboundAt: null, latestInboundId: null, count: 0 });
    });
});

describe('evidenceForLine', () => {
    const thread = buildThread(sarah);
    it('the doors line quotes her doors message and carries the photos sent within fifteen minutes of it', () => {
        const e = evidenceForLine({ title: '8 oak panelled doors, hung and finished', notes: 'oak to match' }, thread);
        expect(e.basedOnInboundId).toBe('s1');
        expect(e.quotes[0]).toMatchObject({ messageId: 's1', text: 'Can you do all 9 doors now, oak to match the ones you did?' });
        expect(e.media.map((m) => m.url)).toEqual(['/api/media/p1', '/api/media/p2', '/api/media/p3']);
    });
    it('the cupboard line quotes the cupboard message and its own captioned photo', () => {
        const e = evidenceForLine({ title: 'Airing cupboard door' }, thread);
        expect(e.basedOnInboundId).toBe('s4');
        expect(e.quotes.map((q) => q.messageId)).toEqual(['s4']);
        expect(e.media.map((m) => m.url)).toContain('/api/media/p3');
    });
    it('a line nothing matches is based on the latest inbound with no quotes and no photos', () => {
        const e = evidenceForLine({ title: 'Gutter clean' }, thread);
        expect(e).toEqual({ basedOnInboundId: 's5', quotes: [], media: [] });
    });
    it('keywordsOf / sentenceWith', () => {
        expect(keywordsOf('All 9 doors, oak to match the ones you did')).toEqual(['door', 'oak', 'match', 'one', 'did']);
        expect(sentenceWith('Hi there. The doors are oak. Thanks', ['door'])).toBe('The doors are oak.');
        expect(sentenceWith('x'.repeat(300), ['nope'], 20)).toHaveLength(20);
    });
});

describe('findContradictions (Sarah: handles reused AND seven new handle sets)', () => {
    const doors = { lineId: 'card_1', title: '8 oak panelled doors', assumptions: ['Existing handles reused on all doors', 'Frames sound'], materials: [{ name: 'Oak panelled door', qty: 8 }, { name: 'Handle set, brushed', qty: 7 }] };
    it('names the clash in one sentence with a tap to drop or keep', () => {
        const c = findContradictions([doors]);
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ id: 'card_1:a0', lineId: 'card_1', kind: 'assumption_vs_materials', assumptionIndex: 0, materialIndexes: [1], materialNames: ['7× Handle set, brushed'] });
        expect(c[0].sentence).toBe('The estimate assumes "Existing handles reused on all doors" but lists 7× Handle set, brushed as materials.');
        expect(c[0].options.map((o) => o.id)).toEqual(['drop_materials', 'keep_materials']);
    });
    it('no reuse word, or no matching material, is not a contradiction', () => {
        expect(findContradictions([{ ...doors, assumptions: ['New handles throughout'] }])).toEqual([]);
        expect(findContradictions([{ ...doors, materials: [{ name: 'Oak panelled door', qty: 8 }] }])).toEqual([]);
        expect(findContradictions([{ ...doors, assumptions: ['Existing frames kept'] }])).toEqual([]);
        // the reuse word beside a noun that IS listed, whatever else the sentence mentions
        expect(findContradictions([{ ...doors, assumptions: ['We keep the handles and hang new doors'] }])).toHaveLength(1);
    });
});

describe('the desk\'s customer message', () => {
    it('references what she asked, thanks her for the photos, no price, no date, no dash, no link', () => {
        const body = draftCustomerMessage({ firstName: 'Sarah', lines: [{ title: 'Oak panelled doors, hung and finished', qty: 8 }, { title: 'Airing cupboard door', qty: 1 }], sentPhotos: true });
        expect(body).toContain('Hi Sarah, thanks for the photos and the details.');
        expect(body).toContain('Your quote for the 8 oak panelled doors, hung and finished and the airing cupboard door is ready');
        expect(body).toContain('Any questions, just reply here.');
        expect(messageViolations(body)).toEqual([]);
        expect(body).not.toMatch(/https?:/);
    });
    it('messageViolations catches money, dates and dashes', () => {
        expect(messageViolations('That will be £120 on Tuesday — ok?')).toEqual(expect.arrayContaining([expect.stringMatching(/money/), expect.stringMatching(/date/)]));
        expect(messageViolations('Can do it on the 14th')).toEqual([expect.stringMatching(/date/)]);
        expect(messageViolations('Thanks for the photos.')).toEqual([]);
    });
    it('jobPhrase: one, two, many; a title that already starts with a count is left alone', () => {
        expect(jobPhrase([{ title: 'Gutter clean' }])).toBe('the gutter clean');
        expect(jobPhrase([{ title: 'Gutter clean' }, { title: 'Fence panel', qty: 3 }])).toBe('the gutter clean and the 3 fence panel');
        expect(jobPhrase([{ title: '8 oak doors', qty: 8 }, { title: 'B' }, { title: 'C' }])).toBe('the 8 oak doors, the b and the c');
        expect(jobPhrase([])).toBe('the work');
    });
    it("P12b: Sarah's real titles lose the clerk's verbs and filler and join naturally", () => {
        const sarah = [{ title: 'Supply and hang 8 internal oak panelled doors', qty: 8 }, { title: 'Supply and hang airing cupboard storage door', qty: 1 }];
        expect(jobPhrase(sarah)).toBe('the 8 oak panelled doors and the airing cupboard door');
        expect(draftCustomerMessage({ firstName: 'Sarah', lines: sarah, sentPhotos: true })).toContain('Your quote for the 8 oak panelled doors and the airing cupboard door is ready');
        expect(jobPhrase([{ title: 'Replace the kitchen mixer tap' }])).toBe('the kitchen mixer tap');
        expect(jobPhrase([{ title: 'Fit & finish skirting, hallway', qty: 1 }])).toBe('the skirting, hallway');
        expect(jobPhrase([{ title: 'Supply and hang', qty: 2 }])).toBe('the work');
    });
    it('withQuoteLink appends the link once, as the last line', () => {
        expect(withQuoteLink('Hi there.', 'https://x/quote/ab')).toBe('Hi there.\n\nhttps://x/quote/ab');
        expect(withQuoteLink('Hi https://x/quote/ab there', 'https://x/quote/ab')).toBe('Hi https://x/quote/ab there');
    });
});

describe('after send / hold / question', () => {
    it('nextStepsAfterSend says who, the deposit, and when the desk chases', () => {
        expect(nextStepsAfterSend({ firstName: 'Sarah', depositPence: 63000, mode: 'sent' })).toBe('Sent to Sarah. Deposit £630. Follow-up in 2 days if unviewed.');
        expect(nextStepsAfterSend({ firstName: 'Sarah', depositPence: 63050, mode: 'queued', followUpDays: 1 })).toBe('Queued for Sarah, it goes when the window reopens. Deposit £630.50. Follow-up in 1 day if unviewed.');
    });
    it('holdOf reads a valid hold and ignores junk', () => {
        expect(holdOf({ hold: { reason: 'ask_first', at: 'x', by: 'human:ben', question: 'Which handles?' } })).toEqual({ reason: 'ask_first', at: 'x', by: 'human:ben', question: 'Which handles?', draftId: null });
        expect(holdOf({ hold: { reason: 'nope' } })).toBeNull();
        expect(holdOf(null)).toBeNull();
    });
    it('cleanQuestion: one question, house voice, no money', () => {
        expect(cleanQuestion('  Are the handles staying — or new ones?  ')).toEqual({ ok: true, question: 'Are the handles staying, or new ones?' });
        expect(cleanQuestion('')).toMatchObject({ ok: false });
        expect(cleanQuestion('Is £200 ok?')).toMatchObject({ ok: false, error: expect.stringMatching(/No prices/) });
        expect(cleanQuestion('x'.repeat(241))).toMatchObject({ ok: false });
    });
    it('e164', () => {
        expect(e164('07811 346936')).toBe('+447811346936');
        expect(e164('+447811346936')).toBe('+447811346936');
        expect(e164('447811346936@c.us')).toBe('+447811346936');
        expect(e164('')).toBeNull();
    });
});

describe("P12b: Sarah's REAL payload", () => {
    // The clerk's assumption on line 1, verbatim from production, beside the materials it listed.
    const doorsAssumption = 'Assumes new handles/hinges supplied to match existing style unless customer wants existing ironmongery reused';
    const doorsMaterials = [{ name: 'oak door', qty: 7 }, { name: 'Coniston handle, latch & hinge set', qty: 8 }];
    it('the real line-1 assumption says NEW handles are supplied: no contradiction (reuse is the unless clause)', () => {
        expect(mainClause(doorsAssumption)).toBe('Assumes new handles/hinges supplied to match existing style');
        expect(reusedNouns(doorsAssumption)).toEqual([]);
        expect(findContradictions([{ lineId: 'card_1', title: 'Supply and hang 8 internal oak panelled doors', assumptions: [doorsAssumption], materials: doorsMaterials }])).toEqual([]);
    });
    it('line 2 checked the same way: reuse behind an "unless" / "if" / "or" is never the default, and the doors never match "handles"', () => {
        const cupboard = 'Standard size assumed; existing frame retained unless it is found to be damaged, or a new frame supplied if the customer prefers';
        expect(findContradictions([{ lineId: 'card_2', title: 'Supply and hang airing cupboard storage door', assumptions: [cupboard], materials: [{ name: 'oak door, cut to size', qty: 1 }, { name: 'Coniston handle, latch & hinge set', qty: 1 }] }])).toEqual([]);
        expect(findContradictions([{ lineId: 'x', title: 'Doors', assumptions: ['New ironmongery throughout, or reuse existing handles if the customer prefers'], materials: doorsMaterials }])).toEqual([]);
        expect(findContradictions([{ lineId: 'x', title: 'Doors', assumptions: ['If the customer prefers to keep the existing handles we will refit them'], materials: doorsMaterials }])).toEqual([]);
        // the reused noun must be in the material's own name: doors carry no "handle"
        expect(findContradictions([{ lineId: 'x', title: 'Doors', assumptions: ['Existing handles reused on all doors'], materials: [{ name: 'oak door', qty: 7 }] }])).toEqual([]);
    });
    it('the true positive still fires: "Existing handles reused on all doors" beside a handle set', () => {
        const c = findContradictions([{ lineId: 'card_1', title: 'Doors', assumptions: ['Existing handles reused on all doors'], materials: doorsMaterials }]);
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ id: 'card_1:a0', materialIndexes: [1], materialNames: ['8× Coniston handle, latch & hinge set'] });
        expect(findContradictions([{ lineId: 'x', title: 'Doors', assumptions: ['Keep the existing handles'], materials: doorsMaterials }])).toHaveLength(1);
    });

    /** Her six inbound messages (2 Sep), from the owner's interview note. */
    const real: ThreadMessage[] = [
        msg({ id: 'm1', at: '2026-09-02T11:49:00.000Z', direction: 'in', body: 'Hi, please can I go ahead with the doors' }),
        msg({ id: 'o1', at: '2026-09-02T11:52:00.000Z', direction: 'out', body: 'Great, shall we give you a quick call?' }),
        msg({ id: 'm2', at: '2026-09-02T11:55:00.000Z', direction: 'in', body: "I'm free for a call" }),
        msg({ id: 'm3', at: '2026-09-02T12:03:00.000Z', direction: 'in', body: "I'm looking for all 9 doors to be replaced, you originally quoted me just 3 downstairs" }),
        msg({ id: 'o2', at: '2026-09-02T15:01:00.000Z', direction: 'out', body: 'Could you send photos of the other six?' }),
        msg({ id: 'm4', at: '2026-09-02T17:53:00.000Z', direction: 'in', body: '', media: { url: '/api/media/s1', kind: 'image' } }),
        msg({ id: 'm5', at: '2026-09-02T17:53:00.000Z', direction: 'in', body: '', media: { url: '/api/media/s2', kind: 'image' } }),
        msg({ id: 'm6', at: '2026-09-02T17:53:30.000Z', direction: 'in', body: "The door without the panelling stores a few towels… won't be able to do anything with the small door at the top. Please quote for 9 off." }),
    ];
    const titles = [
        { title: 'Supply and hang 8 internal oak panelled doors', notes: 'All 9 doors replaced in oak to match the three done in June' },
        { title: 'Supply and hang airing cupboard storage door', notes: 'The door without panelling that stores towels; the small door at the top is left as it is' },
    ];
    it('line 1 leads with "all 9 doors to be replaced", line 2 with the towels sentence; never the same top quote twice', () => {
        const [doors, cupboard] = evidenceForLines(titles, buildThread(real));
        expect(doors.quotes[0]).toMatchObject({ messageId: 'm3', text: "I'm looking for all 9 doors to be replaced, you originally quoted me just 3 downstairs" });
        expect(cupboard.quotes[0]).toMatchObject({ messageId: 'm6', text: 'The door without the panelling stores a few towels' });
        expect(doors.basedOnInboundId).toBe('m3');
        expect(cupboard.basedOnInboundId).toBe('m6');
        expect(doors.quotes[0].messageId).not.toBe(cupboard.quotes[0].messageId);
        // the photos came with the towels message: under the cupboard line
        expect(cupboard.media.map((m) => m.url)).toEqual(['/api/media/s1', '/api/media/s2']);
    });
    it('with titles alone (no clerk notes) the tie on "door" is broken so the two lines still lead with different messages', () => {
        const [doors, cupboard] = evidenceForLines(titles.map((t) => ({ title: t.title })), buildThread(real));
        expect(cupboard.quotes[0].messageId).toBe('m6');
        expect(doors.quotes[0].messageId).toBe('m3');
    });
    it("the clerk's stored evidence wins over inference (CLERK-EVIDENCE.md shape)", () => {
        const [doors] = evidenceForLines([{ title: 'Supply and hang 8 internal oak panelled doors', evidence: [{ messageId: 'm1', text: 'please can I go ahead with the doors' }], mediaIds: ['m4'] }], buildThread(real));
        expect(doors).toEqual({ basedOnInboundId: 'm1', quotes: [{ messageId: 'm1', at: '2026-09-02T11:49:00.000Z', text: 'please can I go ahead with the doors' }], media: [{ messageId: 'm4', url: '/api/media/s1', kind: 'image' }] });
    });

    it("a pre-fix draft's flat band (194,400 / 194,400 over 640–1,120 min) is recomputed on read, the row untouched", () => {
        const sug = { lineId: 'card_1', suggestedPence: 194400, bandLowPence: 194400, bandHighPence: 194400, confidence: 'medium' as const, basis: { minutes: 910, minutesLow: 640, minutesHigh: 1120, allowanceMinutes: 30, labourPence: 70000, materialsPence: 97953, materialsWithMarginPence: 124400, ratePencePerHour: 3500, marginPct: 27 } };
        const est = { lineId: 'card_1', minutesPoint: 880, minutesLow: 640, minutesHigh: 1120, materials: [], confidence: 'medium' as const, timeSource: 'history' as const };
        const line = buildScreenLine({ index: 0, line: { lineId: 'card_1', title: 'Supply and hang 8 internal oak panelled doors', qty: 8 }, estimateLine: est, suggestion: sug, materialsMarginPercent: 27 });
        expect(line.bandRecomputed).toBe(true);
        expect(line.bandLowPence).toBe(Math.round((70000 * 670) / 910) + 124400);
        expect(line.bandHighPence).toBe(Math.round((70000 * 1150) / 910) + 124400);
        expect(line.suggestedPence).toBe(194400);
        // without the stored basis the estimate row's minutes and the suggestion less materials do the same job
        const bare = flatBandFromMinutes({ suggested: 194400, band: { low: 194400, high: 194400 }, estimateLine: est, suggestion: { ...sug, basis: null } });
        expect(bare).toEqual({ low: Math.min(194400, Math.round((194400 * 640) / 880)), high: Math.round((194400 * 1120) / 880) });
        // a real band is left alone; a flat band with no minutes range stays flat
        expect(flatBandFromMinutes({ suggested: 194400, band: { low: 180000, high: 205000 }, estimateLine: est, suggestion: sug })).toBeNull();
        expect(flatBandFromMinutes({ suggested: 194400, band: { low: 194400, high: 194400 }, estimateLine: { ...est, minutesLow: 880, minutesHigh: 880 }, suggestion: { ...sug, basis: null } })).toBeNull();
    });
});

describe('the payload with the briefing', () => {
    const row: DraftRowShape = {
        id: 'quote_s', short_slug: 'z4p6t9mw', customer_name: 'Sarah Bell', phone: '+447811346936', postcode: 'NG2 7QP', customer_type: 'homeowner', is_draft: true,
        pricing_line_items: [
            { lineId: 'card_1', title: '8 oak panelled doors, hung and finished', category: 'joinery', qty: 8, assumptions: ['Existing handles reused on all doors'] },
            { lineId: 'card_2', title: 'Airing cupboard door', category: 'joinery', qty: 1, assumptions: [] },
        ],
        pricing_suggestions: { estimateId: 'est_s', at: T(19, 26), lines: [
            { lineId: 'card_1', suggestedPence: 180000, bandLowPence: 160000, bandHighPence: 205000, confidence: 'medium', basis: { minutes: 910, ratePencePerHour: 3000, materialsPence: 128000, marginPct: 27 } },
            { lineId: 'card_2', suggestedPence: 30000, bandLowPence: 27000, bandHighPence: 34000, confidence: 'low', checkThis: true, checkReason: 'low confidence: unusual size' },
        ], hold: { reason: 'call', at: T(20), by: 'human:ben' } } as any,
    };
    const estimate: EstimateRowShape = { id: 'est_s', status: 'complete', lines: [
        { lineId: 'card_1', minutesPoint: 880, minutesLow: 640, minutesHigh: 1120, materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' }, { name: 'Handle set, brushed', qty: 7, unitCostPence: 1800, source: 'screwfix' }], confidence: 'medium', timeSource: 'history' },
        { lineId: 'card_2', minutesPoint: 120, minutesLow: 90, minutesHigh: 180, materials: [{ name: 'Oak door, cut to size', qty: 1, unitCostPence: 15000, source: 'web' }], confidence: 'low', timeSource: 'model' },
    ] };
    const settings = { materialsMarginPercent: 27, depositPercent: 30 };
    const p = buildPricePayload({ row, estimate, conversationId: 'conv_s', readiness: 'quote_ready', settings, thread: buildThread(sarah), nextWaiting: { slug: 'c1u0wkt8', firstName: 'Gemma' }, businessNumber: '+441150000000' });

    it('per line: materials with index, evidence from her words, contradiction on the doors, hold, next waiting, call numbers', () => {
        expect(p.lines[0].materials).toEqual([
            { lineId: 'card_1', index: 0, name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' },
            { lineId: 'card_1', index: 1, name: 'Handle set, brushed', qty: 7, unitCostPence: 1800, source: 'screwfix' },
        ]);
        expect(p.lines[0].evidence.basedOnInboundId).toBe('s1');
        expect(p.lines[0].evidence.media).toHaveLength(3);
        expect(p.lines[1].evidence.quotes[0].messageId).toBe('s4');
        expect(p.contradictions).toHaveLength(1);
        expect(p.contradictions[0]).toMatchObject({ lineId: 'card_1', materialIndexes: [1] });
        expect(p.hold).toEqual({ reason: 'call', at: T(20), by: 'human:ben', question: null, draftId: null });
        expect(p.nextWaiting).toEqual({ slug: 'c1u0wkt8', firstName: 'Gemma' });
        expect(p.call).toEqual({ customerPhone: '+447811346936', businessNumber: '+441150000000' });
        expect(p.customer.phone).toBe('+447811346936');
        expect(p.thread.count).toBe(8);
        expect(p.message.body).toContain('Hi Sarah, thanks for the photos and the details.');
        expect(messageViolations(p.message.body)).toEqual([]);
        expect(p.followUpDays).toBe(2);
    });

    it('validateSendBody accepts materials, assumptions, the message and resolutions; refuses a bad material', () => {
        const v = validateSendBody({
            version: p.version, message: 'Hi Sarah, here it is.', messageEdited: true,
            resolutions: [{ contradictionId: 'card_1:a0', choice: 'drop_materials' }, { contradictionId: 'x', choice: 'nope' }],
            lines: [
                { lineId: 'card_1', finalPence: 210000, materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' }], assumptions: ['Existing handles reused on all doors'] },
                { lineId: 'card_2', finalPence: 30000 },
            ],
        }, ['card_1', 'card_2']);
        expect(v.ok).toBe(true);
        if (!v.ok) return;
        expect(v.input.message).toBe('Hi Sarah, here it is.');
        expect(v.input.messageEdited).toBe(true);
        expect(v.input.resolutions).toEqual([{ contradictionId: 'card_1:a0', choice: 'drop_materials' }]);
        expect(v.input.lines[0].materials).toHaveLength(1);
        expect(v.input.lines[1].materials).toBeUndefined();
        const bad = validateSendBody({ version: 'v', lines: [{ lineId: 'card_1', finalPence: 1, materials: [{ name: '', qty: 1, unitCostPence: 1 }, { name: 'x', qty: 0, unitCostPence: 1 }] }, { lineId: 'card_2', finalPence: 1 }] }, ['card_1', 'card_2']);
        expect(bad.ok).toBe(false);
        if (bad.ok) return;
        expect(bad.errors).toEqual([expect.stringMatching(/no name/), expect.stringMatching(/quantity/)]);
    });

    it('dropping the handles lowers the line\'s materials at the live margin; the confirmed line carries the list Ben sent', () => {
        const sent = { lineId: 'card_1', finalPence: 210000, materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' }], assumptions: ['Existing handles reused on all doors'] };
        expect(materialsPenceFor(p.lines[0], sent, 27)).toBe(Math.round(96000 * 1.27));
        expect(materialsPenceFor(p.lines[0], { lineId: 'card_1', finalPence: 1 }, 27)).toBe(p.lines[0].materialsPence);
        const items = confirmedLineItems([{ lineId: 'card_1', materials: [{ name: 'old' }] }, {}], p, [sent, { lineId: 'card_2', finalPence: 30000 }]);
        expect(items[0].materials).toEqual([{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, unitPricePence: 12000, source: 'screwfix', supplier: 'screwfix' }]);
        expect(items[0].assumptions).toEqual(['Existing handles reused on all doors']);
        expect(items[0].materialsWithMarginPence).toBe(Math.round(96000 * 1.27));
        expect(items[0].pricePence).toBe(210000);
        expect(items[1].materials).toBeUndefined();
    });

    it('verdict meta: the resolution lands on its line, message edited on every row, materials / assumptions changed per line', () => {
        const rows = verdictRowsFor(p, [
            { lineId: 'card_1', finalPence: 180000, materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' }] },
            { lineId: 'card_2', finalPence: 30000, assumptions: ['Frame checked on the day'] },
        ], 'human:ben', new Date(T(20)), { messageEdited: true, resolutions: [{ contradictionId: 'card_1:a0', choice: 'drop_materials' }] });
        expect(rows[0].meta).toEqual({ resolutions: [{ contradictionId: 'card_1:a0', choice: 'drop_materials' }], messageEdited: true, materialsChanged: true, assumptionsChanged: false, contradictionsOnLine: 1 });
        expect(rows[1].meta).toEqual({ resolutions: [], messageEdited: true, materialsChanged: false, assumptionsChanged: true, contradictionsOnLine: 0 });
        expect(rows[0].edited).toBe(false);
        expect(rows[0].inBand).toBe(true);
    });
});

describe('reusedNouns: causal and descriptive "existing" (P12b real-data follow-up, Sarah line 2)', () => {
    const SARAH_LINE_2 = 'Assumes a flush oak-effect door (no panelling) supplied to match the informal storage-cupboard look, since the existing door has no panel detailing';
    it('a causal tail describing the existing door is not a reuse claim', () => {
        expect(reusedNouns(SARAH_LINE_2)).toEqual([]);
        expect(findContradictions([{ lineId: 'card_2', title: 'Supply and hang airing cupboard storage door', assumptions: [SARAH_LINE_2], materials: [{ name: 'Wickes Flush Primed Paint Grade Internal Door 1981x762mm', qty: 1 }, { name: 'Smith & Locke 2000 Series Latch Door Handle Set Pair', qty: 1 }] } as any])).toEqual([]);
    });
    it('"existing door has no panelling" in the main clause is description, not reuse', () => {
        expect(reusedNouns('The existing door has no panelling and looks tired')).toEqual([]);
    });
    it('a bare "existing handles" still counts, and "existing handles reused" still fires', () => {
        expect(reusedNouns('Existing handles throughout')).toEqual(['handle']);
        expect(reusedNouns('Existing handles reused on all doors')).toEqual(['handle']);
    });
});
