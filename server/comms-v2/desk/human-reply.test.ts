/**
 * Ben's own reply from the board, through the one sender (human-reply.ts): his words go out as
 * written with him as approver and a fresh run id, land on the file as his turn, clear the hold
 * with his words recorded as the release, and leave the thread to automation (checklist 7.4). The
 * guards never run over them (behaviour.md answer 43): a figure, a date or a commitment Ben types
 * goes as he wrote it, under his own human approver. What his words are still recorded in is the
 * bookkeeping of what the business has said: the ask ledger and the call offer. What still refuses
 * him is what the sender owns: a shut window, a wall of bubbles, a hold that is someone else's.
 */
import { describe, expect, it } from 'vitest';
import { appendTurn, everAsked, open, hold as setHold, type ApproverSlot, type CaseFile, type Party } from './case-file';
import { BEN } from './guards';
import { humanReply, sendHeldDraft, sendWindowTemplate } from './human-reply';
import { DESK_APPROVER, send, type TemplateStatusSource } from './sender';

/** answer_ready_reopen_v1 approved, nothing else. */
const reopenApproved: TemplateStatusSource = { async approved(name) { return name === 'answer_ready_reopen_v1' ? { contentSid: 'HX_reopen' } : null; } };
/** quote_ready_link approved, nothing else. */
const quoteApproved: TemplateStatusSource = { async approved(name) { return name === 'quote_ready_link' ? { contentSid: 'HX_quote' } : null; } };

const AT = '2026-09-11T10:00:00.000Z';
/** Who the signed-in session is, which is what the send records: the person, not the slot they hold. */
const BEN_PERSON = 'ben.real@handyservices.app';
const BEN_APPROVER = `human:${BEN_PERSON}`;
const now = (iso = '2026-09-11T10:05:00.000Z') => () => new Date(iso);

function fixture(): { file: CaseFile; party: Party } {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: AT, channel: 'whatsapp', kind: 'text', body: 'How much would a new tap be?', media: [] },
    }, { now: now(AT) });
    if (!r.ok) throw new Error(r.reason);
    return { file: r.value, party: r.value.parties[0] };
}

/** The desk's own reply to that turn: the money line that promises Ben will come back, and the hold behind it. */
function deskRepliedAndHeld(file: CaseFile): void {
    setHold(file, { approver: BEN, reason: 'money: How much', exception: 'money' }, { now: now('2026-09-11T10:00:01.000Z') });
    const t = appendTurn(file, { at: '2026-09-11T10:00:02.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'Ben will come back to you on the price.', media: [], runId: 'run_desk', approver: DESK_APPROVER }, { now: now('2026-09-11T10:00:02.000Z') });
    if (!t.ok) throw new Error(t.reason);
}

describe('a person answers from the board', () => {
    it('sends Ben\'s words as written through the one sender, records his turn, clears the hold with his words and hands the thread back', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam, spoke to my fitter.\n\nI will pop round and look at it properly.' }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        // The sender rendered it: a blank line is a bubble break, and nothing was rewritten.
        expect(out.result.bubbles.map((b) => b.text)).toEqual([
            'Morning Sam, spoke to my fitter.',
            'I will pop round and look at it properly.',
        ]);
        expect(out.result.approver).toBe(BEN_APPROVER);
        expect(out.result.runId).toMatch(/^run_/);
        expect(out.result.turnId).toBe(file.turns[file.turns.length - 1].id);

        // Ben's turn is on the file, carrying him as approver.
        const last = file.turns[file.turns.length - 1];
        expect(last.direction).toBe('outbound');
        expect(last.approver).toBe(BEN_APPROVER);
        expect(last.body).toContain('spoke to my fitter');
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: BEN_APPROVER, channel: 'whatsapp', mode: 'dry_run' });

        // The hold is cleared, with his words as the release, and the file still holds.
        expect(file.hold).toBeNull();
        expect(out.release).toMatchObject({ approver: { kind: 'human', id: 'ben' }, reason: 'money: How much' });
        expect(out.release?.words).toContain('spoke to my fitter');
        expect(file.releases).toHaveLength(1);
    });

    it('a letter he writes goes as he typed it: his line breaks kept and no greeting or sign-off put around his words', async () => {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'email:sam@example.invalid', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'email', address: 'sam@example.invalid',
            firstTurn: { at: AT, channel: 'email', kind: 'text', body: 'Morning,\n\nThe extractor fan has stopped turning. What would a new one be?\n\nRegards, Sam', media: [] },
        }, { now: now(AT) });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        const words = 'Sam,\nThe part is \u00a340 plus fitting.\nI can do Thursday.';

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.channel).toBe('email');
        expect(out.result.bubbles).toEqual([{ text: words, gapMs: 0 }]);
        expect(file.turns[file.turns.length - 1].body).toBe(words);
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: BEN_APPROVER, channel: 'email' });
    });

    it('refuses an over-long SMS in the SMS measure: the segments it came to, not bubbles it does not have', async () => {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'sms', address: '+447700900942',
            firstTurn: { at: AT, channel: 'sms', kind: 'text', body: 'What would a new kitchen tap come to?', media: [] },
        }, { now: now(AT) });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        // His own words keep their typographic punctuation, which costs UCS-2 and halves what two segments hold.
        const words = 'That’s £40 for the tap itself plus an hour of labour, so £85 all in. I can pick the part up in the morning and fit it the same afternoon if that suits, otherwise Thursday is clear for me as well.';

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words }, { now: now() });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/comes to \d+ segments, over the 2 one text message may use/);
        expect(out.reason).toMatch(/about 134 characters fit/);
        expect(out.reason).not.toMatch(/bubble/);
        expect(file.sends).toHaveLength(0);
        expect(file.turns).toHaveLength(1);
    });

    it('answers again after the customer writes back, the hold still cleared', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam, I will take a look.' }, { now: now() });
        expect(file.hold).toBeNull();

        const next = appendTurn(file, { at: '2026-09-11T10:10:00.000Z', channel: 'whatsapp', direction: 'inbound', partyId: 'p1', kind: 'text', body: 'Great, thanks', media: [], runId: null, approver: null }, { now: now('2026-09-11T10:10:00.000Z') });
        expect(next.ok).toBe(true);
        const again = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'No problem.' }, { now: now('2026-09-11T10:11:00.000Z') });
        expect(again.ok).toBe(true);
    });

    it('sends a figure Ben types as he wrote it: the guards gate the composer, not him', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'A new tap is about £120 fitted.' }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles.map((b) => b.text)).toEqual(['A new tap is about £120 fitted.']);
        expect(file.turns[file.turns.length - 1].body).toContain('£120');
        expect(file.facts).toHaveLength(0);
        expect(file.sends).toHaveLength(1);
    });

    it('sends a date Ben types with no diary fact behind it: the guards are the composer\'s, not his', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'I can pop round Friday to look at it properly.' }, { now: now() });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(file.turns[file.turns.length - 1].body).toContain('Friday');
        expect(file.sends).toHaveLength(1);
    });

    it('sends a second reply from the same person: the one-reply guard paces the desk, not Ben', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const first = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'I will take a look today.' }, { now: now() });
        expect(first.ok).toBe(true);

        const second = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'One more thing.' }, { now: now('2026-09-11T10:06:00.000Z') });
        expect(second.ok).toBe(true);
        expect(file.sends).toHaveLength(2);
    });

    it('refuses no words, a rule-based approver, and a hold named for someone else', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const rules: ApproverSlot = { kind: 'rules', id: 'landlord_1', then: { kind: 'human', id: 'landlord_1' } };
        const other: ApproverSlot = { kind: 'human', id: 'someone_else' };

        expect(await humanReply({ file, approver: BEN, person: BEN_PERSON, words: '   ' }, { now: now() })).toMatchObject({ ok: false, reason: 'a reply needs words' });
        expect(await humanReply({ file, approver: rules, person: BEN_PERSON, words: 'hello' }, { now: now() })).toMatchObject({ ok: false });
        const wrong = await humanReply({ file, approver: other, person: BEN_PERSON, words: 'hello' }, { now: now() });
        expect(wrong.ok).toBe(false);
        if (wrong.ok) return;
        expect(wrong.reason).toMatch(/only ben may answer/);
        expect(file.turns).toHaveLength(2);
    });

    it('keeps the line breaks Ben types inside a bubble; a blank line still starts a new one', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const words = 'Morning Sam, two things I would do:\n- replace the washer\n- check the isolator valve\n\nI will bring both.';

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles.map((b) => b.text)).toEqual([
            'Morning Sam, two things I would do:\n- replace the washer\n- check the isolator valve',
            'I will bring both.',
        ]);
        expect(file.turns[file.turns.length - 1].body).toContain('\n- replace the washer');
    });

    it('refuses a slot that is not the one this file answers to, with no hold standing either', async () => {
        const { file } = fixture();
        const landlord: ApproverSlot = { kind: 'human', id: 'landlord_1' };

        const out = await humanReply({ file, approver: landlord, person: BEN_PERSON, words: 'Morning Sam, I can look at that.' }, { now: now() });

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/only ben may answer/);
        expect(file.sends).toHaveLength(0);
        expect(file.turns).toHaveLength(1);
    });

    it('refuses a shut window: a shut window never carries freeform words', async () => {
        const { file, party } = fixture();
        deskRepliedAndHeld(file);
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam.' }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/window is shut/);
        expect(file.sends).toHaveLength(0);
    });

    it('refuses a reply over the bubble ceiling rather than sending a wall', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const words = ['one', 'two', 'three', 'four', 'five'].join('\n\n');
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/over the ceiling/);
    });

    it('records what Ben asked for and promised, so the desk does not ask the customer twice', async () => {
        const { file, party } = fixture();
        deskRepliedAndHeld(file);

        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam, can you send me a photo of the tap?\n\nI will give you a quick call this afternoon.' }, { now: now() });

        expect(out.ok).toBe(true);
        expect(everAsked(file, 'media')).toBe(true);
        expect(party.callOffered).toBe(true);
        expect(everAsked(file, 'postcode')).toBe(false);
    });

    it('records nothing from prose that only reads like an ask, so the desk still asks', async () => {
        for (const words of ['I will be in touch later today, what is the best number for you?', 'I have seen the picture, what time works?']) {
            const { file, party } = fixture();
            deskRepliedAndHeld(file);
            const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words }, { now: now() });
            expect(out.ok).toBe(true);
            expect(everAsked(file, 'access')).toBe(false);
            expect(everAsked(file, 'media')).toBe(false);
            expect(everAsked(file, 'postcode')).toBe(false);
            expect(party.callOffered).toBe(false);
        }
    });

    it('records the person who typed the words, not the slot two of them share', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);

        const first = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Morning Sam, I will take a look.' }, { now: now() });
        const second = await humanReply({ file, approver: BEN, person: 'jo.office@handyservices.app', words: 'Ben is on his way.' }, { now: now('2026-09-11T10:06:00.000Z') });

        expect(first.ok && second.ok).toBe(true);
        expect(file.sends.map((s) => s.approver)).toEqual([BEN_APPROVER, 'human:jo.office@handyservices.app']);
        expect(file.turns.slice(-2).map((t) => t.approver)).toEqual([BEN_APPROVER, 'human:jo.office@handyservices.app']);
    });

    it('answers a file with no hold, and the file stays unheld', async () => {
        const { file } = fixture();
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Hi Sam, let me take a look and come back to you.' }, { now: now() });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.release).toBeNull();
        expect(file.hold).toBeNull();
        expect(file.turns[file.turns.length - 1].approver).toBe(BEN_APPROVER);
    });

    it('chooses the channel by the desk\'s own clock, so a window open to it is not read as shut', async () => {
        const { file } = fixture();
        // The customer wrote on WhatsApp at 10:00 and by text before that; the newest turn is the
        // acceptance on the quote page, which carries no reply of its own.
        file.parties[0].channels = [
            { kind: 'sms', address: '+447700900942', lastInboundAt: '2026-09-11T09:00:00.000Z' },
            { kind: 'whatsapp', address: '+447700900942', lastInboundAt: AT },
        ];
        const portal = appendTurn(file, { at: '2026-09-11T10:04:00.000Z', channel: 'form', direction: 'inbound', partyId: 'p1', kind: 'portal_action', body: 'Accepted quote abc12345 on the quote page.', media: [], runId: null, approver: null }, { now: now('2026-09-11T10:04:00.000Z') });
        if (!portal.ok) throw new Error(portal.reason);
        setHold(file, { approver: BEN, reason: 'acceptance in chat', exception: null }, { now: now() });

        // The desk's clock reads five minutes after the customer wrote, so that window is open; the
        // wall clock is long past it, and only one of the two is the file's.
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'Thanks Sam, booked in.' }, { now: now() });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.channel).toBe('whatsapp');
        expect(file.turns[file.turns.length - 1].channel).toBe('whatsapp');
    });
});

describe('one tap: sending the reply the desk held back as-is', () => {
    it('sends the hold\'s draft through the same pipeline as a typed answer, and clears the hold', async () => {
        const { file } = fixture();
        setHold(file, { approver: BEN, reason: 'money: How much', exception: 'money', draft: 'Hi Sam, that one is usually around £80 fitted.' }, { now: now('2026-09-11T10:00:01.000Z') });

        const out = await sendHeldDraft({ file, approver: BEN, person: BEN_PERSON }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles.map((b) => b.text)).toEqual(['Hi Sam, that one is usually around £80 fitted.']);
        expect(out.result.approver).toBe(BEN_APPROVER);
        expect(file.hold).toBeNull();
        expect(file.turns[file.turns.length - 1]).toMatchObject({ approver: BEN_APPROVER, body: 'Hi Sam, that one is usually around £80 fitted.' });
    });

    it('refuses when the hold carries no draft', async () => {
        const { file } = fixture();
        setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: now('2026-09-11T10:00:01.000Z') });

        const out = await sendHeldDraft({ file, approver: BEN, person: BEN_PERSON }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/no held draft/);
        expect(file.sends).toHaveLength(0);
    });

    it('refuses a slot that is not the file\'s owner, same as answering', async () => {
        const { file } = fixture();
        const landlord: ApproverSlot = { kind: 'human', id: 'landlord' };
        setHold(file, { approver: BEN, reason: 'money: How much', exception: 'money', draft: 'Hi Sam, around £80.' }, { now: now('2026-09-11T10:00:01.000Z') });

        const out = await sendHeldDraft({ file, approver: landlord, person: BEN_PERSON }, { now: now() });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/only ben may answer/);
    });
});

describe('a template send on a shut window: only when the wording is true for the thread', () => {
    /** The customer's only word is still unanswered, and it reads as a question ("How much..."). */
    function heldOnUnansweredQuestion(file: CaseFile): void {
        setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: now('2026-09-11T10:00:01.000Z') });
    }

    /** A quote link already went out on the thread, freeform, while the window was still open. */
    async function withSentQuoteLink(): Promise<{ file: CaseFile; party: Party }> {
        const { file, party } = fixture();
        file.job.quoteRef = 'q123';
        const openWindow = { state: 'open' as const, reason: 'just written', opensUntil: null };
        const sent = await send({
            file, partyId: party.personId, channel: 'whatsapp', window: openWindow,
            bubbles: [{ text: 'Hi Sam, your quote is ready. Everything is on the link, the itemised price and the booking: https://handyservices.app/quote/q123. Any questions, just reply here.', gapMs: 0 }],
            template: null, runId: 'run_quote_sent', approver: BEN_APPROVER, guards: null, factIds: [], kbIds: [], fixedLines: [], calls: [], mode: 'dry_run',
        }, { now: now('2026-09-11T09:00:00.000Z') });
        if (!sent.ok) throw new Error(sent.reason);
        return { file, party };
    }

    it('a quote sent on the thread: offers quote_ready_link with the exact link the file shows was sent', async () => {
        const { file, party } = await withSentQuoteLink();
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, quoteApproved);

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles).toHaveLength(1);
        expect(out.result.bubbles[0].text).toContain('https://handyservices.app/quote/q123');
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: BEN_APPROVER, templateId: 'quote_ready_link' });
    });

    it('an unanswered customer question: offers answer_ready_reopen_v1 and clears the hold', async () => {
        const { file, party } = fixture(); // firstTurn: "How much would a new tap be?" - unanswered
        heldOnUnansweredQuestion(file);
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles[0].text).toContain('we have an answer');
        expect(file.hold).toBeNull();
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: BEN_APPROVER, templateId: 'answer_ready_reopen_v1' });
    });

    it('a question the desk has already answered: no template is offered, even though the row exists', async () => {
        const { file, party } = fixture();
        deskRepliedAndHeld(file); // appends an outbound turn after the customer's question
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/no template is true for this thread/);
        expect(file.sends).toHaveLength(0);
    });

    it('no quote sent and the customer\'s last word is not a question: no template is offered', async () => {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'whatsapp', address: '+447700900942',
            firstTurn: { at: AT, channel: 'whatsapp', kind: 'text', body: 'Thanks, that all sounds great.', media: [] },
        }, { now: now(AT) });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: now('2026-09-11T10:00:01.000Z') });
        const ch = file.parties[0].channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/no template is true for this thread/);
        expect(file.sends).toHaveLength(0);
    });

    it('never reaches quote_accepted_ack_v1, enquiry_followup_optin_v1 or a marketing row: only the two service_reply purposes are ever picked', async () => {
        const everythingApproved: TemplateStatusSource = { async approved() { return { contentSid: 'HX_any' }; } };
        const { file: quoteFile } = await withSentQuoteLink();
        quoteFile.parties[0].channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';
        const quoteOut = await sendWindowTemplate({ file: quoteFile, approver: BEN, person: BEN_PERSON }, { now: now() }, everythingApproved);
        expect(quoteOut.ok && quoteOut.result.bubbles[0].text).not.toMatch(/accepting your quote|reply here with anything|Reply STOP/);

        const { file: qFile, party } = fixture();
        heldOnUnansweredQuestion(qFile);
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';
        const qOut = await sendWindowTemplate({ file: qFile, approver: BEN, person: BEN_PERSON }, { now: now() }, everythingApproved);
        expect(qOut.ok && qOut.result.bubbles[0].text).not.toMatch(/accepting your quote|reply here with anything|Reply STOP/);
    });

    it('refuses when the window is open: a template is not what applies there', async () => {
        const { file } = fixture();
        deskRepliedAndHeld(file);

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/window is open/);
        expect(file.sends).toHaveLength(0);
    });

    it('refuses when the true template\'s rung is not approved yet, and sends nothing', async () => {
        const { file, party } = fixture();
        heldOnUnansweredQuestion(file);
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, { async approved() { return null; } });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/no approved template/);
        expect(file.sends).toHaveLength(0);
        expect(file.hold).not.toBeNull();
    });

    it('refuses a slot that is not the file\'s owner, same as answering', async () => {
        const { file, party } = fixture();
        heldOnUnansweredQuestion(file);
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';
        const landlord: ApproverSlot = { kind: 'human', id: 'landlord' };

        const out = await sendWindowTemplate({ file, approver: landlord, person: BEN_PERSON }, { now: now() }, reopenApproved);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/only ben may answer/);
    });
});
