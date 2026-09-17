/**
 * Rewriting one value: the shape the product parses is kept, a thread stays followable across
 * tables, the free text is invented rather than blanked, and a second pass writes nothing.
 */
import { describe, it, expect } from 'vitest';
import { scrubScalar, UNUSABLE_PASSWORD_HASH, type ValueContext } from '../values';
import { Substitutions, residualsIn, isSweepableName } from '../detect';
import { fakeProse, isSyntheticProse, fakePreview } from '../prose';
import { scrubJson, toSnake, phoneLeavesIn } from '../json-walk';
import { isSyntheticEmail, isSyntheticName, isSyntheticPhone, isSyntheticPostcode } from '../synthetic';

const SEED = 'test-seed';

function ctx(over: Partial<ValueContext> = {}): ValueContext {
    return {
        seed: SEED, table: 'leads', column: 'customer_name', rowKey: 'lead-1',
        subs: new Substitutions(),
        phoneFor: (real) => (real === '07812345678' ? '07700900123' : null),
        force: true,
        ...over,
    };
}

/** Scrub a value, then scrub the result with the checks switched back on, as a second run does. */
function twice(treatment: Parameters<typeof scrubScalar>[0], value: string, over: Partial<ValueContext> = {}) {
    const first = scrubScalar(treatment, value, ctx({ ...over, force: true }));
    const second = scrubScalar(treatment, first, ctx({ ...over, force: false }));
    return { first, second };
}

describe('shape is preserved, because the product parses these', () => {
    it('a UK mobile stays a UK mobile', () => {
        const out = scrubScalar('phone', '07812345678', ctx({ column: 'phone' }));
        expect(out).toBe('07700900123');
        expect(isSyntheticPhone(out!)).toBe(true);
    });

    it('an E.164 number stays E.164', () => {
        expect(scrubScalar('phone', '+447812345678', ctx({ column: 'phone' }))).toBe('+447700900123');
        expect(scrubScalar('phone_e164', '07812345678', ctx({ column: 'e164' }))).toBe('+447700900123');
    });

    it('a phone key keeps its prefix, which is how threads are looked up', () => {
        expect(scrubScalar('phone_key', 'phone:07812345678', ctx({ column: 'phone_key' })))
            .toBe('phone:07700900123');
    });

    it('a postcode stays a Nottingham or Derby postcode', () => {
        const out = scrubScalar('postcode', 'NG7 2QX', ctx({ column: 'postcode' }))!;
        expect(out).toMatch(/^(NG|DE)\d{1,2} \d[A-Z]{2}$/);
        expect(isSyntheticPostcode(out)).toBe(true);
    });

    it('an address stays one line of street, town and postcode', () => {
        const out = scrubScalar('address', '14 Beechdale Road, Aspley, NG8 3EY', ctx({ column: 'address' }))!;
        expect(out.split(', ')).toHaveLength(3);
        expect(isSyntheticPostcode(out.split(', ')[2])).toBe(true);
    });

    it('an address and the row postcode agree when the real ones did', () => {
        const address = scrubScalar('address', '14 Beechdale Road, Aspley, NG8 3EY', ctx({ column: 'address' }))!;
        const postcode = scrubScalar('postcode', 'NG8 3EY', ctx({ column: 'postcode' }))!;
        expect(address.endsWith(postcode)).toBe(true);
    });

    it('a null stays null and a blank stays blank, so row shape never moves', () => {
        expect(scrubScalar('person_name', null, ctx())).toBeNull();
        expect(scrubScalar('person_name', '   ', ctx())).toBe('   ');
    });

    it('a password becomes a well-formed bcrypt hash nobody can satisfy', () => {
        const out = scrubScalar('password', '$2b$10$realhash', ctx({ column: 'password' }));
        expect(out).toBe(UNUSABLE_PASSWORD_HASH);
        expect(out).toMatch(/^\$2b\$10\$[./A-Za-z0-9]{53}$/);
    });
});

describe('a thread stays followable', () => {
    it('the same real customer becomes the same fake customer in every table', () => {
        const inLeads = scrubScalar('person_name', 'Margaret Wilkinson',
            ctx({ table: 'leads', column: 'customer_name', rowKey: 'lead-1' }));
        const inInvoices = scrubScalar('person_name', 'Margaret Wilkinson',
            ctx({ table: 'invoices', column: 'customer_name', rowKey: 'inv-9' }));
        expect(inLeads).toBe(inInvoices);
        expect(isSyntheticName(inLeads!)).toBe(true);
    });

    it('two different real customers do not collapse into one fake customer', () => {
        expect(scrubScalar('person_name', 'Margaret Wilkinson', ctx()))
            .not.toBe(scrubScalar('person_name', 'Anthony Radcliffe', ctx()));
    });
});

describe('free text is invented, not blanked', () => {
    it('a message body comes back as a message of a similar length', () => {
        const real = "Hello, I'm Margaret Wilkinson at 14 Beechdale Road. My mobile is 07812345678.";
        const out = scrubScalar('message_body', real, ctx({ table: 'messages', column: 'content' }))!;
        expect(out.length).toBeGreaterThan(20);
        expect(out).not.toContain('Margaret');
        expect(out).not.toContain('07812345678');
        expect(residualsIn(out)).toEqual([]);
    });

    it('a transcript comes back as a two-party transcript', () => {
        const out = scrubScalar('transcript', 'Agent: hello\nCaller: hi there, this is real\n'.repeat(4),
            ctx({ table: 'calls', column: 'transcription' }))!;
        expect(out).toMatch(/^Agent: /);
        expect(out).toContain('\nCaller: ');
    });

    it('invented prose is recognised as invented, which is what makes a second run a no-op', () => {
        for (const kind of ['message', 'narrative', 'note', 'transcript'] as const) {
            for (let i = 0; i < 40; i += 1) {
                const text = fakeProse(SEED, kind, ['t', `row-${i}`, 'c'],
                    { name: 'Dilys Hallam', town: 'Beeston', targetLength: 40 + i * 37 });
                expect(isSyntheticProse(text)).toBe(true);
            }
        }
    });

    it('a truncated preview is still recognised', () => {
        for (let i = 0; i < 30; i += 1) {
            expect(isSyntheticProse(fakePreview(SEED, ['conversations', `c-${i}`, 'p'],
                { name: 'Dilys Hallam', town: 'Derby' }))).toBe(true);
        }
    });

    it('real prose is not mistaken for invented prose', () => {
        expect(isSyntheticProse("Hello, I'm Margaret at 14 Beechdale Road, please ring me back."))
            .toBe(false);
    });
});

describe('running the scrub twice changes nothing the second time', () => {
    it.each([
        ['person_name', 'Margaret Wilkinson', 'customer_name'],
        ['first_name', 'Margaret', 'first_name'],
        ['business_name', 'Radcliffe & Sons Handyman', 'business_name'],
        ['email', 'm.wilkinson@gmail.com', 'email'],
        ['postcode', 'NG7 2QX', 'postcode'],
        ['town', 'Aspley', 'town'],
        ['address', '14 Beechdale Road, Aspley, NG8 3EY', 'address'],
        ['address_line', '14 Beechdale Road', 'address_line_1'],
        ['url', 'https://api.twilio.com/recordings/Wilkinson.wav', 'recording_url'],
        ['token', 'realSessionToken12345', 'widget_token'],
        ['external_id', 'pi_realPaymentIntent', 'stripe_payment_intent_id'],
        ['password', '$2b$10$realhash', 'password'],
        ['message_body', 'Hello, this is Margaret at 14 Beechdale Road.', 'content'],
        ['narrative', 'Replace the extractor fan at 14 Beechdale Road for Margaret.', 'job_description'],
        ['note', 'Rang back on 07812345678, no answer.', 'notes'],
        ['transcript', 'Agent: hello\nCaller: it is Margaret here', 'transcription'],
        ['preview', 'Hi, it is Margaret at 14 Beechdale Road', 'last_message_preview'],
        ['phone', '07812345678', 'phone'],
    ] as const)('%s is a fixed point after the first rewrite', (treatment, value, column) => {
        const { first, second } = twice(treatment, value, { column });
        expect(first).not.toBe(value);
        expect(second).toBe(first);
    });
});

describe('contact values, a telephone number or an e-mail address', () => {
    it('keeps a phone key a phone key and a channel address E.164', () => {
        expect(scrubScalar('contact', 'phone:07812345678', ctx({ column: 'canonical' }))).toBe('phone:07700900123');
        expect(scrubScalar('contact', '+447812345678', ctx({ column: 'address' }))).toBe('+447700900123');
    });

    it('keeps an e-mail key an e-mail key, and the same person as the e-mail columns', () => {
        const key = scrubScalar('contact', 'email:m.wilkinson@gmail.com', ctx({ column: 'canonical' }))!;
        const bare = scrubScalar('contact', 'm.wilkinson@gmail.com', ctx({ column: 'address' }))!;
        expect(key.startsWith('email:')).toBe(true);
        expect(isSyntheticEmail(bare)).toBe(true);
        expect(key).toBe(`email:${bare}`);
        expect(bare).toBe(scrubScalar('email', 'm.wilkinson@gmail.com', ctx({ column: 'email' })));
    });

    it.each(['phone:07812345678', '+447812345678', 'email:m.wilkinson@gmail.com'])(
        '%s is a fixed point after the first rewrite',
        (value) => {
            const { first, second } = twice('contact', value, { column: 'canonical' });
            expect(first).not.toBe(value);
            expect(second).toBe(first);
        },
    );

    it('finds the telephone numbers held only inside json, and leaves e-mail addresses out', () => {
        const file = {
            parties: [{
                personId: 'person_1', name: 'Margaret Wilkinson', canonical: 'phone:07812345678',
                channels: [
                    { kind: 'whatsapp', address: '+447812345678' },
                    { kind: 'email', address: 'm.wilkinson@gmail.com' },
                ],
            }],
            turns: [{ body: 'ring me on 07934567123', partyId: 'person_1' }],
        };
        expect(phoneLeavesIn('comms_v2_case_files', file).sort())
            .toEqual(['+447812345678', 'phone:07812345678']);
    });
});

describe('actor columns', () => {
    it('leaves a user id alone', () => {
        for (const id of ['human:u-123', 'system:autonomy', 'u-0', 'a1b2c3d4e5f6a7b8', 'rules']) {
            expect(scrubScalar('actor', id, ctx({ column: 'by' }))).toBe(id);
        }
    });

    it('replaces a person name typed into the same column', () => {
        const out = scrubScalar('actor', 'Margaret Wilkinson', ctx({ column: 'approved_by' }))!;
        expect(out).not.toContain('Margaret');
        expect(isSyntheticName(out)).toBe(true);
    });
});

describe('json', () => {
    it('classifies a leaf by the key above it, and keeps the shape exactly', () => {
        const before = {
            caller: 'Margaret Wilkinson',
            phone: '07812345678',
            postcode: 'NG7 2QX',
            lines: [{ description: 'Fan at 14 Beechdale Road', amount: 12000 }],
            lat: 52.9548,
            lng: -1.1581,
            nothing: null,
        };
        const after = scrubJson(before, ctx({ table: 'calls', column: 'metadata_json' })) as typeof before;
        expect(Object.keys(after)).toEqual(Object.keys(before));
        expect(after.phone).toBe('07700900123');
        expect(after.postcode).not.toBe('NG7 2QX');
        expect(isSyntheticPostcode(after.postcode)).toBe(true);
        expect(after.lines).toHaveLength(1);
        expect(after.lines[0].amount).toBe(12000);
        expect(after.lines[0].description).not.toContain('Beechdale');
        expect(after.lat).not.toBe(52.9548);
        expect(after.nothing).toBeNull();
    });

    it('reads camelCase keys as the same key', () => {
        expect(toSnake('customerName')).toBe('customer_name');
        expect(toSnake('phone_number')).toBe('phone_number');
        const after = scrubJson({ customerName: 'Margaret Wilkinson' },
            ctx({ table: 'conversations', column: 'metadata' })) as { customerName: string };
        expect(after.customerName).not.toContain('Margaret');
    });

    it('regenerates a refused draft the ask agent read back or wrote', () => {
        const before = { tool: 'draft_reply', result: {
            standingDraft: 'We can come to 14 Beechdale Road on Tuesday.',
            lastDraft: 'Could you send a photo of the tap at 14 Beechdale Road?',
        } };
        const after = scrubJson(before, ctx({ table: 'comms_v2_ask_messages', column: 'transcript' })) as typeof before;
        expect(isSyntheticProse(after.result.standingDraft)).toBe(true);
        expect(isSyntheticProse(after.result.lastDraft)).toBe(true);
        expect(JSON.stringify(after)).not.toContain('Beechdale');
    });
});

describe('the sweep', () => {
    it('matches a name on a word boundary, never as a bare substring', () => {
        // The bug this guards: "Ben" once matched inside "OriginalHashForBenAccount".
        const subs = new Substitutions();
        subs.addName('Jean Wilkinson', 'Dilys Hallam');
        expect(subs.apply('spoke to Jean Wilkinson today')).toBe('spoke to Dilys Hallam today');
        expect(subs.apply('Wilkinsons of Derby')).toBe('Wilkinsons of Derby');
        expect(subs.countIn('Wilkinsons of Derby')).toBe(0);
    });

    it('declines a name too common to match safely, and says so', () => {
        const subs = new Substitutions();
        subs.addName('Ben', 'Dilys');
        expect(subs.size).toBe(0);
        expect(subs.skipped.has('Ben')).toBe(true);
        expect(isSweepableName('Ben')).toBe(false);
        expect(isSweepableName('Wilkinson')).toBe(true);
    });

    it('declines a term the generators themselves write, so invented text is never corrupted', () => {
        const subs = new Substitutions();
        subs.add('Nottingham', 'Derby');
        expect(subs.size).toBe(0);
        expect(subs.skipped.has('Nottingham')).toBe(true);
    });

    it('catches a telephone number in every form it is written in', () => {
        const subs = new Substitutions();
        subs.addPhone('07812345678', '07700900123');
        expect(subs.apply('ring 07812345678')).toBe('ring 07700900123');
        expect(subs.apply('ring +447812345678')).toBe('ring +447700900123');
        expect(subs.apply('ring 07812 345678')).toBe('ring 07700 900123');
    });
});

describe('the residual detector', () => {
    it('finds a real telephone number, e-mail address and postcode', () => {
        const found = residualsIn('call 07812345678 or mail m.w@gmail.com about NG7 2QX');
        expect(found.map((r) => r.kind).sort()).toEqual(['email', 'phone', 'postcode']);
    });

    it('finds nothing in fully synthetic text', () => {
        expect(residualsIn('call 07700900123 or mail a.b001@example.invalid about NG7 4ZX')).toEqual([]);
    });
});
