/** Proof for the submit_intake guard rails. Run: npx tsx <this file> */
import { normalizeIntake, LINE_TITLE_MAX } from '/Users/courtneebonnick/v6-switchboard/server/agents/quote-prep';

const ctx = { phone: '+84357691573', contactName: 'Courtnee' };
const ok = (label: string, cond: boolean, extra = '') =>
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);

function expectThrow(label: string, input: any) {
    try {
        normalizeIntake(input, ctx);
        ok(label, false, 'no error thrown');
    } catch (e: any) {
        ok(label, true, e.message.slice(0, 120));
    }
}

const longTitle = 'Customer sent a photo showing water pooling in the cupboard under the sink where the trap has failed';
console.log(`LINE_TITLE_MAX = ${LINE_TITLE_MAX}; test title length = ${longTitle.length}\n`);

expectThrow('paragraph title rejected', {
    lines: [{ title: longTitle, detail: 'x', assumptions: [] }],
    readiness: 'quote_ready', gaps: [], assumptions: [], urgency: 'med',
});
expectThrow('price in title rejected', {
    lines: [{ title: 'Repair sink trap for £80', detail: '', assumptions: [] }],
    readiness: 'quote_ready', gaps: [], assumptions: [], urgency: 'med',
});
expectThrow('quote_ready + customer gap rejected', {
    lines: [{ title: 'Repair leaking waste pipework under kitchen sink', detail: '', assumptions: [] }],
    readiness: 'quote_ready',
    gaps: [{ question: 'Whats the postcode?', audience: 'customer', lineIndex: null }],
    assumptions: [], urgency: 'med',
});
expectThrow('needs_info with no gaps rejected', {
    lines: [{ title: 'Repair leaking waste pipework under kitchen sink', detail: '', assumptions: [] }],
    readiness: 'needs_info', gaps: [], assumptions: [], urgency: 'med',
});
expectThrow('empty lines rejected', { lines: [], readiness: 'quote_ready', gaps: [], urgency: 'med' });

const good = normalizeIntake({
    customerName: 'Courtnee', postcode: null, customerType: 'homeowner',
    lines: [{
        title: 'Repair leaking waste pipework under kitchen sink',
        detail: 'Photo shows a push-fit trap under a double-bowl sink.',
        assumptions: ['Assumes standard push-fit fittings'],
    }],
    assumptions: ['Assumes clear access to the cupboard'],
    readiness: 'needs_info',
    gaps: [
        { question: 'What is your postcode?', audience: 'customer', lineIndex: null },
        { question: 'Do we carry a spare trap on the van?', audience: 'ben', lineIndex: 1 },
        { question: 'ignored, out of range line', audience: 'ben', lineIndex: 9 },
    ],
    urgency: 'med',
}, ctx);
ok('valid intake accepted', good.lines.length === 1 && good.gaps.length === 3);
ok('title within cap', good.lines[0].title.length <= LINE_TITLE_MAX, `${good.lines[0].title.length} chars`);
ok('out-of-range lineIndex nulled', good.gaps[2].lineIndex === null);
ok('in-range lineIndex kept', good.gaps[1].lineIndex === 1);

process.exit(0);
