/**
 * Ben's own reply from the board, through the one sender (human-reply.ts): his words go out as
 * written with him as approver and a fresh run id, land on the file as his turn, clear the hold
 * with his words recorded as the release, and leave the thread to automation (checklist 7.4). The
 * guards never run over them (behaviour.md answer 43): a figure, a date or a commitment Ben types
 * goes as he wrote it, under his own human approver. What his words are still recorded in is the
 * bookkeeping of what the business has said: the ask ledger and the call offer. What still refuses
 * him is what the sender owns: a shut window, a wall of bubbles, a hold that is someone else's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendTurn, everAsked, open, recordFact, hold as setHold, type ApproverSlot, type CaseFile, type Party, type TurnMedia } from './case-file';
import { truncateWords } from '../channels/envelope';
import { BEN } from './guards';
import { humanReply, previewWindowTemplate, replyRouteOf, sendHeldDraft, sendWindowTemplate } from './human-reply';
import { DESK_APPROVER, send, type TemplateStatusSource } from './sender';
import { DEFAULT_FIXED_LINES, heldAckLine } from './fixed-lines';
import type { HoldException } from './router';

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

/** The desk's own reply to that turn: the money line that promises he will come back, and the hold behind it. */
function deskRepliedAndHeld(file: CaseFile): void {
    setHold(file, { approver: BEN, reason: 'money: How much', exception: 'money' }, { now: now('2026-09-11T10:00:01.000Z') });
    const t = appendTurn(file, { at: '2026-09-11T10:00:02.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'Let me check on the price and come straight back to you.', media: [], runId: 'run_desk', approver: DESK_APPROVER }, { now: now('2026-09-11T10:00:02.000Z') });
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

    it('renders the draft as the desk renders its own replies: bubbles of about 160 characters, not one wall (answer 93)', async () => {
        const { file } = fixture();
        const draft = 'Thanks Sam, that helps a lot. A standard mixer tap swap is usually straightforward if the isolation valves under the sink are working. Could you send a photo of the pipework under the sink so I can check what fittings are there? Once I have that I can put the price together for you.';
        setHold(file, { approver: BEN, reason: 'a figure appears that no tool returned', exception: null, draft }, { now: now('2026-09-11T10:00:01.000Z') });

        const out = await sendHeldDraft({ file, approver: BEN, person: BEN_PERSON }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        const texts = out.result.bubbles.map((b) => b.text);
        expect(texts.length).toBeGreaterThan(1);
        expect(texts.length).toBeLessThanOrEqual(3);
        for (const t of texts) expect(t.length).toBeLessThanOrEqual(200);
        // Split, never rewritten: the words are the draft's own.
        expect(texts.join(' ')).toBe(draft);
    });

    it('a draft held for staying over the bubble ceiling still goes as it stands, split only at its blank lines', async () => {
        const { file } = fixture();
        const first = 'Thanks Sam, that helps a lot. A standard mixer tap swap is usually straightforward if the isolation valves under the sink are working, and most of the time the old tap comes off without any trouble at all, although older fittings can sometimes be seized and need a bit more work to free up before the new one goes on.';
        const second = 'Could you send a photo of the pipework under the sink so I can check what fittings are there, and one of the tap itself from above so I can see the size of the hole in the worktop? Once I have those I can put the price together for you and let you know when we could come round to do it.';
        const draft = `${first}\n\n${second}`;
        setHold(file, { approver: BEN, reason: 'the reply stayed over the bubble ceiling', exception: null, draft }, { now: now('2026-09-11T10:00:01.000Z') });

        const out = await sendHeldDraft({ file, approver: BEN, person: BEN_PERSON }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles.map((b) => b.text)).toEqual([first, second]);
    });

    it('an email draft goes as the desk\'s own letter would, with the greeting and sign-off around it', async () => {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'email:sam@example.invalid', propertyId: null, landlordId: null, name: 'Sam Jones' },
            channel: 'email', address: 'sam@example.invalid',
            firstTurn: { at: AT, channel: 'email', kind: 'text', body: 'How much would a new tap be?', media: [] },
        }, { now: now(AT) });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        setHold(file, { approver: BEN, reason: 'a figure appears that no tool returned', exception: null, draft: 'Thanks for getting in touch. Could you send a photo of the tap?' }, { now: now('2026-09-11T10:00:01.000Z') });

        const out = await sendHeldDraft({ file, approver: BEN, person: BEN_PERSON }, { now: now() });

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles[0].text).toMatch(/^Hi Sam,\n\nThanks for getting in touch\. Could you send a photo of the tap\?\n\n/);
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

    it('an unanswered question with no recorded job type: the template names "your enquiry", never the customer\'s own words', async () => {
        const longBody = 'Hi, I was wondering if you could possibly tell me roughly how much it would cost to replace a broken window pane in the back bedroom?';
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'whatsapp', address: '+447700900942',
            firstTurn: { at: AT, channel: 'whatsapp', kind: 'text', body: longBody, media: [] },
        }, { now: now(AT) });
        if (!r.ok) throw new Error(r.reason);
        const { file } = { file: r.value };
        const party = file.parties[0];
        setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: now('2026-09-11T10:00:01.000Z') });
        const ch = party.channels.find((c) => c.kind === 'whatsapp')!;
        ch.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles[0].text).toBe('Hi Sam, you asked us about your enquiry and we have an answer for you. Reply to this message and we will send it straight over.');
        expect(out.result.bubbles[0].text).not.toContain(truncateWords(longBody, 20));
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

    /** The desk's held acknowledgement after the customer's question, as the desk writes it for a turn carrying `media`. */
    function deskHeldAck(file: CaseFile, media: TurnMedia[] = [], at = '2026-09-11T10:00:02.000Z', hold: { reason: string; exception: HoldException | null } = { reason: 'composer fallback', exception: null }): string {
        setHold(file, { approver: BEN, ...hold }, { now: now('2026-09-11T10:00:01.000Z') });
        const line = heldAckLine({ media }, file).text;
        const t = appendTurn(file, { at, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: line, media: [], runId: 'run_held_ack', approver: DESK_APPROVER }, { now: now(at) });
        if (!t.ok) throw new Error(t.reason);
        return line;
    }

    it('a question followed only by the desk\'s holding line: the holding line is no answer, so answer_ready_reopen_v1 is offered and sent', async () => {
        const { file, party } = fixture(); // "How much would a new tap be?"
        const line = deskHeldAck(file);
        expect(line).toBe("Thanks, leave it with me and I'll come back to you.");
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles[0].text).toContain('we have an answer');
        expect(file.hold).toBeNull();
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: BEN_APPROVER, templateId: 'answer_ready_reopen_v1' });
    });

    it('a question followed only by the holding line naming the photo it brought: answer_ready_reopen_v1 is still offered and sent', async () => {
        const { file, party } = fixture();
        const photo: TurnMedia[] = [{ id: 'm1', kind: 'image', mime: 'image/jpeg', path: null, url: null, description: null }];
        const line = deskHeldAck(file, photo);
        expect(line).toBe("Thanks for the photo, leave it with me and I'll come back to you.");
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: BEN_APPROVER, templateId: 'answer_ready_reopen_v1' });
    });

    it('a question hold on a recorded job, answered only by the holding line: the template names the job, not the customer\'s words', async () => {
        const { file, party } = fixture();
        const f = recordFact(file, { key: 'job_type', value: 'new kitchen tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' }, { now: now(AT) });
        if (!f.ok) throw new Error(f.reason);
        deskHeldAck(file, [], undefined, { reason: 'no_source: How much would a new tap be?', exception: 'no_source' });
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles[0].text).toBe('Hi Sam, you asked us about new kitchen tap and we have an answer for you. Reply to this message and we will send it straight over.');
        expect(file.hold).toBeNull();
    });

    /**
     * The desk's other holding line: on a `no_source` hold the fixed line goes out woven into a
     * composed reply, so its wording is not fixed. The hold itself records that nothing on file
     * answered the question, which is what this reads.
     */
    function deskComposedNoSourceHold(file: CaseFile, at = '2026-09-11T10:00:02.000Z'): string {
        setHold(file, { approver: BEN, reason: 'no_source: How much would a new tap be?', exception: 'no_source' }, { now: now('2026-09-11T10:00:01.000Z') });
        const body = `Hi Sam, thanks for asking.\n${DEFAULT_FIXED_LINES.no_source}`;
        const t = appendTurn(file, { at, channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body, media: [], runId: 'run_no_source', approver: DESK_APPROVER }, { now: now(at) });
        if (!t.ok) throw new Error(t.reason);
        return body;
    }

    it('a no_source hold answered only by the composed holding line: the holding line is no answer, so answer_ready_reopen_v1 is offered', async () => {
        const { file, party } = fixture(); // "How much would a new tap be?"
        const body = deskComposedNoSourceHold(file);
        expect(body).toContain('Let me check on that one and come straight back to you.');
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);

        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.result.bubbles[0].text).toContain('we have an answer');
        expect(file.hold).toBeNull();
        expect(file.sends[file.sends.length - 1]).toMatchObject({ approver: BEN_APPROVER, templateId: 'answer_ready_reopen_v1' });
    });

    it('the same composed reply with no no_source hold standing: it answered the question, so no template is offered', async () => {
        const { file, party } = fixture();
        deskComposedNoSourceHold(file);
        file.hold = null; // Ben released it; the desk's send is the answer it looks like
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/no template is true for this thread/);
        expect(file.sends.filter((x) => x.templateId)).toHaveLength(0);
    });

    it('a complaint hold answered only by the holding line: no template is offered and the hold stands', async () => {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'whatsapp', address: '+447700900942',
            firstTurn: { at: AT, channel: 'whatsapp', kind: 'text', body: 'hello?? anyone there? when will someone come and fix it?', media: [] },
        }, { now: now(AT) });
        if (!r.ok) throw new Error(r.reason);
        const file = r.value;
        deskHeldAck(file, [], undefined, { reason: 'complaint: nobody came', exception: 'complaint' });
        file.parties[0].channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);

        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/no template is true for this thread/);
        expect(file.hold).toMatchObject({ exception: 'complaint' });
        expect(file.sends.filter((s) => s.templateId)).toHaveLength(0);
    });

    it('a question, the holding line, then a real reply: the question is answered and no template is offered', async () => {
        const { file, party } = fixture();
        deskHeldAck(file);
        const t = appendTurn(file, { at: '2026-09-11T10:00:03.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: 'A new mixer tap fitted is usually around £120.', media: [], runId: 'run_reply', approver: DESK_APPROVER }, { now: now('2026-09-11T10:00:03.000Z') });
        if (!t.ok) throw new Error(t.reason);
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/no template is true for this thread/);
        expect(file.sends).toHaveLength(0);
    });

    it('the holding line\'s words written by a person are that person\'s answer, not the desk\'s holding line: no template is offered', async () => {
        const { file, party } = fixture();
        const t = appendTurn(file, { at: '2026-09-11T10:00:02.000Z', channel: 'whatsapp', direction: 'outbound', partyId: 'p1', kind: 'text', body: "Thanks, leave it with me and I'll come back to you.", media: [], runId: 'run_ben', approver: BEN_APPROVER }, { now: now('2026-09-11T10:00:02.000Z') });
        if (!t.ok) throw new Error(t.reason);
        party.channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z';

        const out = await sendWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toMatch(/no template is true for this thread/);
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

    it('the customer\'s last word merely contains an asking word without being a question: no template is offered', async () => {
        const r = open({
            identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
            channel: 'whatsapp', address: '+447700900942',
            firstTurn: { at: AT, channel: 'whatsapp', kind: 'text', body: "I don't know how you found us but thanks anyway", media: [] },
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

describe('the template offer: a dry run of the shut-window send that can never disagree with it', () => {
    const shut = (file: CaseFile) => { file.parties[0].channels.find((c) => c.kind === 'whatsapp')!.lastInboundAt = '2026-09-09T10:00:00.000Z'; };

    /** Each case builds a fresh file, so the preview and the send each see the same state. */
    const cases: Array<{ name: string; build: () => Promise<CaseFile> | CaseFile; approver?: ApproverSlot; templates: TemplateStatusSource; offered: boolean }> = [
        { name: 'an unanswered question', offered: true, templates: reopenApproved, build: () => { const { file } = fixture(); setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: now(AT) }); shut(file); return file; } },
        { name: 'a quote link already sent', offered: true, templates: quoteApproved, build: async () => {
            const { file, party } = fixture();
            file.job.quoteRef = 'q123';
            const sent = await send({ file, partyId: party.personId, channel: 'whatsapp', window: { state: 'open', reason: 'just written', opensUntil: null }, bubbles: [{ text: 'Your quote: https://handyservices.app/quote/q123', gapMs: 0 }], template: null, runId: 'run_q', approver: BEN_APPROVER, guards: null, factIds: [], kbIds: [], fixedLines: [], calls: [], mode: 'dry_run' }, { now: now('2026-09-11T09:00:00.000Z') });
            if (!sent.ok) throw new Error(sent.reason);
            shut(file);
            return file;
        } },
        { name: 'a question already answered', offered: false, templates: reopenApproved, build: () => { const { file } = fixture(); deskRepliedAndHeld(file); shut(file); return file; } },
        { name: 'an open window', offered: false, templates: reopenApproved, build: () => { const { file } = fixture(); deskRepliedAndHeld(file); return file; } },
        { name: 'no rung approved', offered: false, templates: { async approved() { return null; } }, build: () => { const { file } = fixture(); setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: now(AT) }); shut(file); return file; } },
        { name: 'another slot', offered: false, templates: reopenApproved, approver: { kind: 'human', id: 'landlord' }, build: () => { const { file } = fixture(); setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: now(AT) }); shut(file); return file; } },
        { name: 'a rule-based approver', offered: false, templates: reopenApproved, approver: { kind: 'rules', id: 'landlord_rules', then: BEN }, build: () => { const { file } = fixture(); shut(file); return file; } },
    ];

    for (const c of cases) {
        it(`${c.name}: the preview names what the send then does, and sends and records nothing itself`, async () => {
            const approver = c.approver ?? BEN;
            const previewed = await c.build();
            const before = JSON.stringify(previewed);
            const offer = await previewWindowTemplate({ file: previewed, approver, person: BEN_PERSON }, { now: now() }, c.templates);
            expect(JSON.stringify(previewed)).toBe(before);

            const sentFile = await c.build();
            const out = await sendWindowTemplate({ file: sentFile, approver, person: BEN_PERSON }, { now: now() }, c.templates);
            expect(offer.ok).toBe(c.offered);
            expect(out.ok).toBe(c.offered);
            if (offer.ok && out.ok) {
                expect(out.result.bubbles.map((b) => b.text)).toEqual([offer.body]);
                expect(sentFile.sends.at(-1)?.templateId).toBe(offer.template);
                expect(offer.channel).toBe(out.result.channel);
            } else if (!offer.ok && !out.ok) {
                expect(offer.reason).toBe(out.reason);
            }
        });
    }

    it('names the template and its filled wording for an unanswered question', async () => {
        const { file } = fixture();
        setHold(file, { approver: BEN, reason: 'a complaint', exception: null }, { now: now(AT) });
        shut(file);
        const offer = await previewWindowTemplate({ file, approver: BEN, person: BEN_PERSON }, { now: now() }, reopenApproved);
        expect(offer).toMatchObject({ ok: true, template: 'answer_ready_reopen_v1', channel: 'whatsapp' });
        if (offer.ok) expect(offer.body).toContain('we have an answer');
        expect(file.hold).not.toBeNull();
        expect(file.sends).toHaveLength(0);
    });
});

describe('the reply route a thread shows', () => {
    it('an open WhatsApp window names its closing time, 24 hours after the customer last wrote', () => {
        const { file } = fixture();
        const route = replyRouteOf(file, new Date('2026-09-11T10:05:00.000Z'));
        expect(route).toMatchObject({ ok: true, channel: 'whatsapp', window: { state: 'open', opensUntil: '2026-09-12T10:00:00.000Z' } });
    });

    it('a shut window has no closing time and gives the reason the send gives', () => {
        const { file } = fixture();
        const route = replyRouteOf(file, new Date('2026-09-13T10:00:00.000Z'));
        expect(route.ok && route.window).toMatchObject({ state: 'shut', opensUntil: null });
        expect(route.ok && route.window.reason).toMatch(/more than 24 hours ago/);
    });

    it('a file with no customer turn refuses with the send\'s own words', async () => {
        const { file } = fixture();
        file.turns = [];
        expect(replyRouteOf(file, new Date())).toEqual({ ok: false, reason: 'no customer turn to answer' });
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'hello' }, { now: now() });
        expect(out).toEqual({ ok: false, reason: 'no customer turn to answer' });
    });
});

// The live refusal of 16 Sep 2026: every person's send through the real live deliverer was held
// with "spine.senders.null.enabled is not true", because a `human:*` row has no switch key and the
// deliverer read it as the switch. Only faked deliverers had carried a human send live before.
describe('a person\'s live send goes through the real live deliverer', () => {
    // An empty opt-out ledger: nobody on these threads has opted out.
    beforeEach(() => { vi.doMock('../../opt-out', () => ({ blockedByOptOut: async () => null, optOutRefusalMessage: () => '' })); });
    afterEach(() => { vi.doUnmock('../../spine/config'); vi.doUnmock('../../outbound'); vi.doUnmock('../../opt-out'); vi.resetModules(); });
    function live(on: boolean): Array<{ approver: string; body: string }> {
        const outbox: Array<{ approver: string; body: string }> = [];
        vi.doMock('../../spine/config', () => ({ getSpineConfig: async () => ({ senders: on ? { comms_v2: { enabled: true } } : {} }) }));
        vi.doMock('../../outbound', () => ({ sendCustomerMessage: async (i: { approver: string; body: string }) => { outbox.push(i); return { ok: true, sid: `SM${outbox.length}`, attempts: [], fellBack: false }; } }));
        return outbox;
    }

    it('Ben\'s own answer from the card is delivered under his approver while the desk\'s switch is on', async () => {
        const outbox = live(true);
        const { file } = fixture();
        deskRepliedAndHeld(file);
        const out = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'It is £85 fitted, Sam.', mode: 'live' }, { now: now() });
        expect(out).toMatchObject({ ok: true });
        expect(outbox).toEqual([expect.objectContaining({ approver: BEN_APPROVER, body: 'It is £85 fitted, Sam.' })]);
        expect(file.hold).toBeNull();
    });

    it('the held draft he sends with one tap is delivered under his approver while the desk\'s switch is on', async () => {
        const outbox = live(true);
        const { file } = fixture();
        setHold(file, { approver: BEN, reason: 'money: How much', exception: 'money', draft: 'A new tap is £85 fitted.' }, { now: now('2026-09-11T10:00:01.000Z') });
        const out = await sendHeldDraft({ file, approver: BEN, person: BEN_PERSON, mode: 'live' }, { now: now() });
        expect(out).toMatchObject({ ok: true });
        expect(outbox).toEqual([expect.objectContaining({ approver: BEN_APPROVER, body: 'A new tap is £85 fitted.' })]);
    });

    it('both still refuse, naming the desk\'s own switch, while it is off', async () => {
        const outbox = live(false);
        const { file } = fixture();
        setHold(file, { approver: BEN, reason: 'money: How much', exception: 'money', draft: 'A new tap is £85 fitted.' }, { now: now('2026-09-11T10:00:01.000Z') });
        const answer = await humanReply({ file, approver: BEN, person: BEN_PERSON, words: 'It is £85 fitted, Sam.', mode: 'live' }, { now: now() });
        const draft = await sendHeldDraft({ file, approver: BEN, person: BEN_PERSON, mode: 'live' }, { now: now() });
        for (const out of [answer, draft]) {
            expect(out.ok).toBe(false);
            if (!out.ok) expect(out.reason).toContain('spine.senders.comms_v2.enabled is not true');
        }
        expect(outbox).toEqual([]);
    });
});
