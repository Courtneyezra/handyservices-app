/**
 * The call reader returns facts with no field a sentence for the customer could travel in; its
 * facts land with the call turn as their source; Ben's asks go on the ledger after the follow-up
 * so the desk never asks again; a reader that tries to return prose has it dropped.
 */
import { describe, expect, it } from 'vitest';
import { open, type CaseFile, ask, ledgerEntry } from '../desk/case-file';
import { FakeModelClient } from '../desk/models';
import { ASKED_MAX, benAskedSubjects, CALL_READ_LIMITS, callReadSchema, clipCallRead, ledgerAfterCall, readCall, recordCallFacts } from './call-reader';

function fixture(body = '[call: Ben rang them and they answered]\nAgent: Hi, Ben here. Customer: hi.'): CaseFile {
    const r = open({ identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: null }, channel: 'call', address: '+447700900942', firstTurn: { at: '2026-09-11T10:00:00.000Z', channel: 'call', kind: 'call_transcript', body, media: [] } });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

describe('the call reader', () => {
    it('has no prose field: every key is a fact, and a reply the model tries to return is not in the output', async () => {
        expect(Object.keys(callReadSchema.shape).sort()).toEqual(['benAskedFor', 'callbackAgreed', 'customerName', 'jobPhrase', 'jobType', 'location', 'prefersText']);
        expect(callReadSchema.safeParse({ jobPhrase: 'the fan', jobType: 'extractor fan', location: null, benAskedFor: [], callbackAgreed: false, customerName: null, prefersText: false, reply: 'Hi Sam, thanks for the chat!' }).data).not.toHaveProperty('reply');
        const client = new FakeModelClient({ specialist: ({ user, system }) => { expect(system).toMatch(/never write to the customer/i); expect(user).toContain('Ben here'); return { jobPhrase: 'the bathroom fan', jobType: 'bathroom extractor fan dead', location: 'NG9 2AB', benAskedFor: [{ subject: 'media', detail: 'photos of the fan and the switch' }, { subject: 'access', detail: 'whether someone is in' }], callbackAgreed: false, customerName: 'Sam', prefersText: false }; } });
        const file = fixture();
        const read = await readCall(file, file.turns[0], client);
        expect(read.output?.jobPhrase).toBe('the bathroom fan');
        expect(read.record.model).toBe('claude-sonnet-5');
        expect(read.record.role).toBe('specialist');
        const ids = recordCallFacts(file, file.turns[0], read.output!);
        expect(ids).toHaveLength(5);
        expect(file.facts.map((f) => [f.key, f.value])).toEqual([['job_type', 'bathroom extractor fan dead'], ['job_phrase', 'the bathroom fan'], ['location', 'NG9 2AB'], ['ben_asked_for', 'photos of the fan and the switch; whether someone is in'], ['customer_name', 'Sam']]);
        expect(file.facts.every((f) => f.source.kind === 'thread' && f.source.turnId === file.turns[0].id && f.by === 'call_reader')).toBe(true);
        expect(file.job.type).toBe('bathroom extractor fan dead');
        expect(file.job.location).toBe('NG9 2AB');
        expect(benAskedSubjects(file, read.output!)).toEqual(['media', 'access']);
    });
    it('reads a long call rather than losing it: a detail, a job type and a seventh ask all fit the schema, and the file gets them at the length it wants', async () => {
        // The live shape this came from: a 3,500-character call listing six jobs, where the reader's
        // first `detail` came back at 90 characters. The old ceilings were 80 and 120 with an array
        // of 6, the SDK's parse threw, and the whole read was lost: no job, no location, and none of
        // what Ben asked for on the phone on the ledger, so the desk asked for it all again.
        const detail = 'photos of the fan, the two fence panels and the post that wobbles, and the alcove in your mum\'s room';
        const jobType = 'cloakroom door easing and lock replacement; bathroom extractor fan repair and bath resealing; back gate drop repair; two fence panels; grab rails and alcove shelves';
        const benAskedFor = [
            { subject: 'media' as const, detail },
            { subject: 'measurements' as const, detail: 'the alcove width and height' },
            { subject: 'access' as const, detail: 'whether anyone is in during the day' },
            { subject: 'other' as const, detail: 'the wall type in the bedroom' },
            { subject: 'other' as const, detail: 'who supplies the grab rails' },
            { subject: 'other' as const, detail: 'whether the posts are timber or concrete' },
            { subject: 'postcode' as const, detail: 'the house number as well as the postcode' },
        ];
        const answer = { jobPhrase: 'a list of jobs round the house before the winter, inside and out', jobType, location: 'NG9 3TR', benAskedFor, callbackAgreed: false, customerName: 'Rhian', prefersText: false };
        // The schema takes it: without this the parse throws and readCall returns nothing at all.
        expect(callReadSchema.safeParse(answer).success).toBe(true);
        const client = new FakeModelClient({ specialist: () => answer });
        const file = fixture();
        const read = await readCall(file, file.turns[0], client);
        expect(read.error).toBeNull();
        expect(read.output).not.toBeNull();
        // What lands is the length the file wants, never the model's own run-on.
        expect(read.output!.benAskedFor).toHaveLength(ASKED_MAX);
        expect(read.output!.benAskedFor[0].detail).toBe(detail.slice(0, CALL_READ_LIMITS.detail));
        expect(read.output!.jobType).toBe(jobType.slice(0, CALL_READ_LIMITS.jobType));
        expect(read.output!.jobPhrase!.length).toBeLessThanOrEqual(CALL_READ_LIMITS.jobPhrase);
        recordCallFacts(file, file.turns[0], read.output!);
        expect(file.job.location).toBe('NG9 3TR');
        expect(file.job.type).toBe(jobType.slice(0, CALL_READ_LIMITS.jobType));
        // Ben asked for photos, a postcode and access on the phone: all three reach the ledger.
        expect(benAskedSubjects(file, read.output!)).toEqual(['media', 'access']);
    });
    it('clips every free-text field and leaves a short answer untouched', () => {
        const long = (n: number) => 'x'.repeat(n);
        const clipped = clipCallRead({ jobPhrase: long(200), jobType: long(300), location: long(150), customerName: long(150), benAskedFor: Array.from({ length: 9 }, () => ({ subject: 'other' as const, detail: long(200) })), callbackAgreed: true, prefersText: false });
        expect(clipped.jobPhrase).toHaveLength(CALL_READ_LIMITS.jobPhrase);
        expect(clipped.jobType).toHaveLength(CALL_READ_LIMITS.jobType);
        expect(clipped.location).toHaveLength(CALL_READ_LIMITS.location);
        expect(clipped.customerName).toHaveLength(CALL_READ_LIMITS.customerName);
        expect(clipped.benAskedFor).toHaveLength(ASKED_MAX);
        expect(clipped.benAskedFor[0].detail).toHaveLength(CALL_READ_LIMITS.detail);
        const short = { jobPhrase: 'the bathroom fan', jobType: 'extractor fan dead', location: 'NG9 2AB', customerName: 'Sam', benAskedFor: [{ subject: 'media' as const, detail: 'photos of the fan' }], callbackAgreed: false, prefersText: true };
        expect(clipCallRead(short)).toEqual(short);
    });
    it('puts Ben\'s asks on the ledger after the follow-up, answering a pending ask first, and settles the handoff', () => {
        const file = fixture();
        ask(file, 'media');
        ask(file, 'handoff');
        ledgerAfterCall(file, ['media', 'postcode']);
        // The pending ask is answered (Ben asked again and they agreed), then the follow-up's ask stands: count two, unanswered.
        expect(ledgerEntry(file, 'media')).toMatchObject({ askCount: 2, answeredAt: null });
        expect(ledgerEntry(file, 'media')!.askedAt).toBeTruthy();
        expect(ledgerEntry(file, 'postcode')).toMatchObject({ askCount: 1, answeredAt: null });
        expect(ledgerEntry(file, 'handoff')!.answeredAt).toBeTruthy();
    });
    it('records only what the transcript supports: a second job type becomes a detail, a bare location is dropped, a name fills an unnamed party', () => {
        const file = fixture();
        file.job.type = 'leaking tap';
        recordCallFacts(file, file.turns[0], { jobPhrase: null, jobType: 'leaking tap', location: '12345', benAskedFor: [], callbackAgreed: true, customerName: 'Priya', prefersText: true });
        expect(file.facts.map((f) => f.key)).toEqual(['callback_agreed', 'prefers_text', 'customer_name']);
        expect(file.parties[0].prefersText).toBe(true);
        expect(file.parties[0].name).toBe('Priya');
        recordCallFacts(file, file.turns[0], { jobPhrase: null, jobType: 'and a sticking door', location: 'Beeston', benAskedFor: [], callbackAgreed: false, customerName: 'Someone Else', prefersText: false });
        expect(file.facts.map((f) => f.key)).toContain('job_detail');
        expect(file.job.location).toBe('Beeston');
        // A name already on the file is never overwritten by a later reading of a call.
        expect(file.facts.filter((f) => f.key === 'customer_name')).toHaveLength(1);
        expect(file.parties[0].name).toBe('Priya');
    });
});
