/**
 * Contract 4: every guard in the table, deterministic, checked against the file. The approver
 * slot returns Ben for a homeowner and a rule-based approver for a tenant issue; release needs
 * the named approver and words.
 */
import { describe, expect, it } from 'vitest';
import { ask, hold, open, recordFact, thanked, appendTurn, type CaseFile, type Party, type Turn } from './case-file';
import { approverFor, release, runGuards, type GuardInput } from './guards';
import { fixedLine, noFixedLineSource } from './fixed-lines';

function fixture(text = 'Hi, leaking tap in NG9 2AB'): { file: CaseFile; party: Party; turn: Turn } {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'whatsapp', kind: 'text', body: text, media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    return { file: r.value, party: r.value.parties[0], turn: r.value.turns[0] };
}

function input(reply: string, over: Partial<GuardInput> = {}, text?: string): GuardInput {
    const f = fixture(text);
    return { file: f.file, party: f.party, turn: f.turn, reply, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, liveQuoteRefs: new Set(['q1']), ...over };
}

describe('guards', () => {
    it('pass a plain scoping reply', () => {
        const g = runGuards(input('Thanks Sam, a leaking tap, no problem.\n\nWhereabouts are you?\n\nHappy to give you a quick call if easier.'));
        expect(g.ok).toBe(true);
        expect(Object.keys(g.guards)).toHaveLength(8);
    });
    it('figure: any amount not equal to a cited quote line or customer record fails', () => {
        expect(runGuards(input('That would be around £120.')).guards.figure.result).toBe('fail');
        expect(runGuards(input('roughly 80 quid')).guards.figure.result).toBe('fail');
        const f = fixture();
        const fact = recordFact(f.file, { key: 'labour', value: '£120.00', source: { kind: 'quote_line', quoteRef: 'q1', line: 'labour' }, by: 'quoting' });
        const base = { file: f.file, party: f.party, turn: f.turn, reply: 'The labour line on your quote is £120.00.', kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null };
        const cited = runGuards({ ...base, factIds: fact.ok ? [fact.value.id] : [], liveQuoteRefs: new Set(['q1']) });
        expect(cited.guards.figure.result).toBe('pass');
        const uncited = runGuards({ ...base, factIds: [], liveQuoteRefs: new Set(['q1']) });
        expect(uncited.guards.figure.result).toBe('fail');
        // The same cited line, once its quote is no longer live: the amount is refused all the same.
        const stale = runGuards({ ...base, factIds: fact.ok ? [fact.value.id] : [], liveQuoteRefs: new Set() });
        expect(stale.guards.figure.result).toBe('fail');
    });
    it('date, time, duration: fails unless a diary fact', () => {
        expect(runGuards(input('We could be there on Tuesday.')).guards.date_time_duration.result).toBe('fail');
        expect(runGuards(input('Usually within a few days.')).guards.date_time_duration.result).toBe('fail');
        expect(runGuards(input('Dates come with your quote.')).guards.date_time_duration.result).toBe('pass');
        const f = fixture();
        const fact = recordFact(f.file, { key: 'booked_date', value: 'Tuesday 15 September', source: { kind: 'diary', rowId: 'b1' }, by: 'scheduling' });
        const looked = fact.ok ? [fact.value.id] : [];
        expect(runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'You are booked in for Tuesday.', factIds: looked, kbIds: [], kbRows: [], fixedLines: [], lookedUp: looked, proposedSubject: null }).guards.date_time_duration.result).toBe('pass');
        // The same fact, not looked up on this run: it was true when it was written and the diary may have moved since.
        const stale = runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'You are booked in for Tuesday.', factIds: looked, kbIds: [], kbRows: [], fixedLines: [], lookedUp: [], proposedSubject: null }).guards.date_time_duration;
        expect(stale.result).toBe('fail');
        expect(stale.note).toContain('did not look up');
        // Every date in the reply is checked, not just the first: once a diary date can legitimately pass, a second one must not ride in behind it.
        const second = runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'You are booked in for Tuesday. If Thursday suits better I can do that instead.', factIds: looked, kbIds: [], kbRows: [], fixedLines: [], lookedUp: looked, proposedSubject: null }).guards.date_time_duration;
        expect(second.result).toBe('fail');
        expect(second.note).toContain('Thursday');
        expect(second.note).not.toContain('"Tuesday"');
        // A fragment of a diary date is not that date: "the 5 September" must not ride in on "25 September 2026".
        const g = fixture();
        const booked = recordFact(g.file, { key: 'booked_date', value: '25 September 2026', source: { kind: 'diary', rowId: 'b2' }, by: 'scheduling' });
        const ids = booked.ok ? [booked.value.id] : [];
        const dated = (reply: string) => runGuards({ file: g.file, party: g.party, turn: g.turn, reply, factIds: ids, kbIds: [], kbRows: [], fixedLines: [], lookedUp: ids, proposedSubject: null }).guards.date_time_duration;
        expect(dated('You are booked in for 25 September 2026.').result).toBe('pass');
        expect(dated('You are booked in for 25 September.').result).toBe('pass');
        const fragment = dated('We can do the 5 September if that suits.');
        expect(fragment.result).toBe('fail');
        expect(fragment.note).toContain('5 September');
        // A year the diary did not give is a different date: the year is read, not skipped over.
        const wrongYear = dated('You are booked in for 25 September 2025.');
        expect(wrongYear.result).toBe('fail');
        expect(wrongYear.note).toContain('25 September 2025');
        // A bare ordinal is how a date is said out loud, so it is a date the guard reads: nothing about "25 September 2026" licenses "the 2nd".
        const ordinal = dated('Ben will look at moving you to the 2nd.');
        expect(ordinal.result).toBe('fail');
        expect(ordinal.note).toContain('2nd');
        // A written-out ordinal date is still read whole, not as a bare ordinal with the month left behind.
        const ordinalDate = dated('We could do 26th September 2026.');
        expect(ordinalDate.result).toBe('fail');
        expect(ordinalDate.note).toContain('26th September 2026');
        // An ordinal is read on its own words, not on the rest of the reply: what it counts straight after it makes it
        // not a date, so "the 1st floor bathroom" and "2nd fix" beside the looked-up date pass first time, even in the
        // same sentence as the date, while "the 2nd" beside them is still a day the diary did not give.
        expect(dated('Thanks Sam, the 1st floor bathroom leak is on the list. Ben can come on 25 September 2026.').result).toBe('pass');
        expect(dated('Ben can look at the 1st floor bathroom on 25 September 2026, and the 2nd fix carpentry after it.').result).toBe('pass');
        expect(dated('The 2nd-fix and the 3rd bedroom can both be done on 25 September 2026.').result).toBe('pass');
        const beside = dated('Ben can look at the 1st floor bathroom on the 2nd.');
        expect(beside.result).toBe('fail');
        expect(beside.note).toContain('"2nd"');
        expect(beside.note).not.toContain('1st');
        // Any other word after an ordinal leaves it a day: a word is only a thing counted if it is listed as one.
        expect(dated('The 2nd works for Ben, or 25 September 2026.').result).toBe('fail');
        expect(dated('Ben can do Tuesday the 2nd.').result).toBe('fail');
        expect(dated('Ben can do the 2nd week of the month.').result).toBe('fail');
        // With no date looked up at all, a bare ordinal is still a day nobody looked up, not a floor.
        const unlooked = runGuards(input('Ben can come on the 2nd.')).guards.date_time_duration;
        expect(unlooked.result).toBe('fail');
        expect(unlooked.note).toContain('2nd');
        // And with no date anywhere, what the trade counts stays out of the guard's way.
        expect(runGuards(input('There is no charge for the 1st visit.')).guards.date_time_duration.result).toBe('pass');
        expect(runGuards(input('Is that the 1st floor bathroom, or the 3rd bedroom?')).guards.date_time_duration.result).toBe('pass');
        // A lead time is a diary fact but not a date, so it does not turn the ordinal reading on either: the customer's
        // own words about their bathroom come back beside "about 3 days" without the reply being sent round again.
        const h = fixture();
        const lead = recordFact(h.file, { key: 'lead_time', value: 'about 3 days', source: { kind: 'diary', rowId: 'lead-time:x' }, by: 'scheduling' });
        const leadIds = lead.ok ? [lead.value.id] : [];
        const withLead = runGuards({ file: h.file, party: h.party, turn: h.turn, reply: "Thanks Sam, a dripping tap in the 1st floor bathroom. We're usually booking in about 3 days.", factIds: leadIds, kbIds: [], kbRows: [], fixedLines: [], lookedUp: leadIds, proposedSubject: null }).guards.date_time_duration;
        expect(withLead.result).toBe('pass');
    });
    it('commitment and fault: fails closed', () => {
        expect(runGuards(input("We'll fix that no problem.")).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('That was our fault, sorry.')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('We guarantee the work.')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('Ben will put your quote together.')).guards.commitment_fault.result).toBe('pass');
        // A change of details is Ben's to make: the reply may pass it on, never say it is done.
        expect(runGuards(input("Thanks, I've updated your address for you.")).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('Your details have been updated.')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input("Thanks, I've noted that and I'll update your details.")).guards.commitment_fault.result).toBe('pass');
    });
    it('commitment: a promise that Ben will come back on a move nothing holds for him fails; with the hold on the file it passes', () => {
        const unheld = runGuards(input('No problem - Ben will come back to you on moving it to the week after.', {}, 'Can we move it to the week after?'));
        expect(unheld.guards.commitment_fault.result).toBe('fail');
        expect(unheld.guards.commitment_fault.note).toMatch(/no hold reaching Ben/);
        expect(runGuards(input('Ben’ll get back to you on the date.', {}, 'Could we move my booking?')).guards.commitment_fault.result).toBe('fail');
        // Paraphrases of the same promise, with no literal "come back" or the word "ben", still fail on an unheld move.
        expect(runGuards(input('Ben can let you know once we hear back.', {}, 'Can we move it to the week after?')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('No worries, someone will get back to you on that.', {}, 'Can we move it to the week after?')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input("Thanks, we'll be in touch about the new date.", {}, 'Can we move it to the week after?')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('Ben will confirm that for you.', {}, 'Can we move it to the week after?')).guards.commitment_fault.result).toBe('fail');
        // The desk speaks as Ben, so the same promise in his first person is the same promise.
        expect(runGuards(input('Let me check on the date and come straight back to you.', {}, 'Can we move it to the week after?')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input("No problem, I'll come back to you on moving it.", {}, 'Can we move it to the week after?')).guards.commitment_fault.result).toBe('fail');
        expect(runGuards(input('Let me check on that one and come straight back to you.', {}, 'Do you do guttering?')).guards.commitment_fault.result).toBe('pass');
        // Not a move request: the promise is the composer's ordinary answer to a question it has no fact for.
        expect(runGuards(input('Ben will come back to you on that.', {}, 'Do you do guttering?')).guards.commitment_fault.result).toBe('pass');
        expect(runGuards(input('Someone will get back to you on that.', {}, 'Do you do guttering?')).guards.commitment_fault.result).toBe('pass');
        const f = fixture('Can we move it to the week after?');
        expect(hold(f.file, { approver: { kind: 'human', id: 'ben' }, reason: 'date_change: move it', exception: 'date_change' }).ok).toBe(true);
        expect(runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'Let me check on the date and come straight back to you.', factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, liveQuoteRefs: new Set() }).guards.commitment_fault.result).toBe('pass');
        expect(runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'Ben will confirm the date once we hear back.', factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, liveQuoteRefs: new Set() }).guards.commitment_fault.result).toBe('pass');
    });
    it('business claim: fails without a reviewed knowledge-base citation whose body supports it', () => {
        expect(runGuards(input("We're fully insured.")).guards.business_claim.result).toBe('fail');
        expect(runGuards(input('We cover the whole of Nottingham.')).guards.business_claim.result).toBe('fail');
        const cited = runGuards(input("We're fully insured.", { kbIds: ['kb-insured'], kbRows: [{ id: 'kb-insured', approvedWords: "We're fully insured.", reviewed: true }] }));
        expect(cited.guards.business_claim.result).toBe('pass');
        const wrongRow = runGuards(input("We're fully insured.", { kbIds: ['kb-hours'], kbRows: [{ id: 'kb-hours', approvedWords: 'We work weekdays.', reviewed: true }] }));
        expect(wrongRow.guards.business_claim.result).toBe('fail');
    });
    it('disclosure: any line describing the sender as automated or an assistant', () => {
        expect(runGuards(input("I'm an AI assistant helping Ben.")).guards.disclosure.result).toBe('fail');
        expect(runGuards(input('This is an automated reply.')).guards.disclosure.result).toBe('fail');
        expect(runGuards(input('Ben will be in touch.')).guards.disclosure.result).toBe('pass');
    });
    it('one reply: a second reply with no customer turn in between fails', () => {
        const f = fixture();
        appendTurn(f.file, { at: '2026-09-11T10:01:00.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'first reply', media: [], runId: 'r1', approver: 'agent.comms_v2' });
        expect(runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'second', factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null }).guards.one_reply.result).toBe('fail');
        appendTurn(f.file, { at: '2026-09-11T10:02:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'ok', media: [], runId: null, approver: null });
        expect(runGuards({ file: f.file, party: f.party, turn: f.turn, reply: 'now fine', factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null }).guards.one_reply.result).toBe('pass');
    });
    it('one reply: a message that landed while the last reply was being written, and that reply did not answer, is a turn in between', () => {
        const f = fixture();
        const oneReply = (turn: typeof f.turn) => runGuards({ file: f.file, party: f.party, turn, reply: 'Thanks, that video shows it well.', factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null }).guards.one_reply.result;
        const video = appendTurn(f.file, { at: '2026-09-11T10:00:43.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'media', body: '', media: [], runId: null, approver: null });
        if (!video.ok) throw new Error(video.reason);
        appendTurn(f.file, { at: '2026-09-11T10:01:19.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'I\'ll keep an eye out for it', media: [], runId: 'r1', approver: 'agent.comms_v2', answers: [f.turn.id] });
        expect(oneReply(video.value)).toBe('pass');
        appendTurn(f.file, { at: '2026-09-11T10:01:48.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'got the video', media: [], runId: 'r2', approver: 'agent.comms_v2', answers: [video.value.id] });
        expect(oneReply(video.value)).toBe('fail');
        expect(oneReply(f.turn)).toBe('fail');
    });
    it('ask ledger: asks a subject already asked and unanswered, a photo twice, or thanks twice', () => {
        const f = fixture();
        ask(f.file, 'postcode');
        const base = { file: f.file, party: f.party, turn: f.turn, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null };
        expect(runGuards({ ...base, reply: 'What is your postcode?' }).guards.ask_ledger.result).toBe('fail');
        expect(runGuards({ ...base, reply: 'What is your postcode?', proposedSubject: 'postcode' }).guards.ask_ledger.result).toBe('pass');
        ask(f.file, 'media');
        expect(runGuards({ ...base, reply: 'Could you send a photo?' }).guards.ask_ledger.result).toBe('fail');
        expect(runGuards({ ...base, reply: 'No worries about photos, what size is the tile?' }).guards.ask_ledger.result).toBe('pass');
        thanked(f.file, 'media');
        expect(runGuards({ ...base, reply: 'Thanks for the photo!' }).guards.ask_ledger.result).toBe('fail');
    });
    it('ask ledger: thanking for a video while asking about the job is not asking for a photo again (live sweep)', () => {
        const f = fixture();
        ask(f.file, 'media');
        const base = { file: f.file, party: f.party, turn: f.turn, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null };
        expect(runGuards({ ...base, reply: 'Thanks for sending the video, what size is the gap?' }).guards.ask_ledger.result).toBe('pass');
        expect(runGuards({ ...base, reply: 'Thanks for the photo, could you send one of the whole door too?' }).guards.ask_ledger.result).toBe('fail');
    });
    it('ask ledger: reciting a quote assumption about access is not asking about it', () => {
        const f = fixture();
        ask(f.file, 'access');
        const base = { file: f.file, party: f.party, turn: f.turn, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null };
        const answer = 'The "Replace kitchen mixer tap" line is £136.00. It assumes you\'re supplying the new tap unless we agree otherwise, that the standard under-sink isolation valves are there and working, and that access to the under-sink pipework is clear.';
        expect(runGuards({ ...base, reply: answer }).guards.ask_ledger.result).toBe('pass');
        expect(runGuards({ ...base, reply: 'Is there access round the back.' }).guards.ask_ledger.result).toBe('fail');
        expect(runGuards({ ...base, reply: 'A dripping tap, got it, and is there access under the sink.' }).guards.ask_ledger.result).toBe('fail');
    });
    it('regulated: a gas turn answered without the fixed line fails; with it passes; plumbing is ours', async () => {
        const gas = input('Sure, whereabouts are you?', {}, 'My gas boiler is leaking');
        expect(runGuards(gas).guards.regulated.result).toBe('fail');
        const line = await fixedLine('gas', noFixedLineSource);
        expect(runGuards(input(line.text, { fixedLines: [line] }, 'My gas boiler is leaking')).guards.regulated.result).toBe('pass');
        expect(runGuards(input('Whereabouts are you?', {}, 'Leaking pipe under the sink, and a roof tile slipped')).guards.regulated.result).toBe('pass');
    });
    it('names every failure for the composer', () => {
        const g = runGuards(input("We'll fix it for £50 on Tuesday, I'm an AI."));
        expect(g.ok).toBe(false);
        expect(g.failures.length).toBeGreaterThanOrEqual(4);
        expect(g.failures.every((f) => /^[a-z_]+: /.test(f))).toBe(true);
    });
});

describe('the approver slot', () => {
    it('is Ben for a homeowner and a rule-based approver for a tenant issue; release only by the named approver with words', () => {
        const f = fixture();
        expect(approverFor(f.file, 'money')).toEqual({ kind: 'human', id: 'ben' });
        hold(f.file, { approver: approverFor(f.file, 'money'), reason: 'money' });
        expect(release(f.file, { kind: 'human', id: 'someone' }, 'ok').ok).toBe(false);
        expect(release(f.file, { kind: 'human', id: 'ben' }, '').ok).toBe(false);
        expect(release(f.file, { kind: 'human', id: 'ben' }, 'send it').ok).toBe(true);
        f.file.parties = [
            { ...f.party, role: 'tenant' },
            { personId: 'l1', role: 'landlord', name: 'L', canonical: 'email:l@x.co', channels: [{ kind: 'email', address: 'l@x.co', lastInboundAt: null }], prefersText: false, alreadyRung: false, callOffered: false },
        ];
        const slot = approverFor(f.file, 'money');
        expect(slot.kind).toBe('rules');
        if (slot.kind === 'rules') expect(slot.then).toEqual({ kind: 'human', id: 'l1' });
    });
});
