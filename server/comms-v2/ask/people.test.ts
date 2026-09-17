/**
 * Who Ben means (N2), when he must pick (A4), and what a session has settled: the ranking over the
 * CRM rows and the board's case files, the company word matched as whole words (A7), and the pick
 * rule. Pure: no database.
 */
import { describe, expect, it } from 'vitest';
import type { AskMessageDTO } from '@shared/ops-types';
import {
    companyWords, outwardPostcode, parsePersonRef, parseQuery, pickDecision, rankPeople, searchTerms, type PersonRow,
} from './people';
import { sessionPeople } from './session-people';
import { personRow as row, whatsappFile } from './ask-fixtures';

const tagged = (name: string, tag: string) => [{ field: 'name' as const, text: name, shown: null }, { field: 'tags' as const, text: tag, shown: tag }];

describe('reading the ask', () => {
    it('splits "Sarah from Tena Properties" into a name and a company word', () => {
        expect(parseQuery('Sarah from Tena Properties')).toEqual({ name: ['sarah'], hint: 'Tena Properties', digits: null });
        expect(parseQuery('Sarah', 'Tena Properties')).toEqual({ name: ['sarah'], hint: 'Tena Properties', digits: null });
        expect(parseQuery('07700 900123')).toEqual({ name: [], hint: null, digits: '7700900123' });
        expect(parseQuery('Alan Smith in NG5')).toMatchObject({ name: ['alan', 'smith'], hint: 'NG5' });
    });

    it('keeps the distinctive company word and drops the generic ones', () => {
        expect(companyWords('Tena Properties Ltd')).toEqual(['tena']);
        expect(companyWords('The Property Group')).toEqual(['the', 'property', 'group']);
        expect(searchTerms(parseQuery('Sarah from Tena Properties'))).toEqual({ words: ['sarah', 'tena'], digits: null });
    });

    it('reads a person ref and an outward postcode', () => {
        expect(parsePersonRef('client:abc')).toEqual({ kind: 'client', id: 'abc' });
        expect(parsePersonRef('phone:07700900123')).toBeNull();
        expect(parsePersonRef('client:')).toBeNull();
        expect(outwardPostcode('ng5 1ab')).toBe('NG5');
        expect(outwardPostcode('DE1')).toBe('DE1');
        expect(outwardPostcode('12 High Street')).toBeNull();
    });
});

describe('Sarah from Tena Properties (A7: match the word now)', () => {
    const rows: PersonRow[] = [
        row({ kind: 'client', id: 'c-ellis', name: 'Sarah Ellis', phone: '+447700900111', companyFields: tagged('Sarah Ellis', 'Tena Properties') }),
        row({ kind: 'client', id: 'c-brown', name: 'Sarah Brown', phone: '+447700900222' }),
        // "tena" is a word; "tenant" and "Tenacre" are not it.
        row({ kind: 'client', id: 'c-green', name: 'Sarah Green', phone: '+447700900333', companyFields: [{ field: 'name', text: 'Sarah Green', shown: null }, { field: 'notes', text: 'Tenant at Tenacre Road', shown: null }] }),
        row({ kind: 'client', id: 'c-tom', name: 'Tom Tena', phone: '+447700900444', companyFields: tagged('Tom Tena', 'Tena Properties') }),
    ];

    it('finds the one Sarah the company word names, and shows the tag as her company', () => {
        const out = rankPeople({ query: 'Sarah from Tena Properties', rows, files: [] });
        expect(out.candidates).toHaveLength(1);
        expect(out.candidates[0]).toMatchObject({ id: 'client:c-ellis', name: 'Sarah Ellis', company: 'Tena Properties', phoneTail: '111', matched: ['name', 'company word in tags'] });
        expect(out.nameOnly).toBe(2);
    });

    it('matches the word in a client\'s notes without ever returning the note', () => {
        const noted = [row({ kind: 'client', id: 'c-cole', name: 'Sarah Cole', companyFields: [{ field: 'name', text: 'Sarah Cole', shown: null }, { field: 'notes', text: 'Works for Tena Properties, gate code 4411', shown: null }] })];
        const out = rankPeople({ query: 'Sarah', hint: 'Tena Properties', rows: noted, files: [] });
        expect(out.candidates[0]).toMatchObject({ id: 'client:c-cole', company: 'Tena Properties', matched: ['name', 'company word in notes'] });
        expect(JSON.stringify(out)).not.toContain('4411');
        expect(JSON.stringify(out)).not.toContain('Works for');
    });

    it('matches a tenant on their landlord\'s name, and a landlord on their own', () => {
        const people = [
            row({ kind: 'tenant', id: 't-moss', name: 'Sarah Moss', phone: '07700900555', company: 'Tena Properties Ltd', companyFields: [{ field: 'name', text: 'Sarah Moss', shown: null }, { field: 'landlord', text: 'Tena Properties Ltd', shown: 'Tena Properties Ltd' }] }),
            row({ kind: 'landlord', id: 'l-tena', name: 'Tena Properties Ltd', phone: '07700900666' }),
        ];
        const sarah = rankPeople({ query: 'Sarah from Tena Properties', rows: people, files: [] });
        expect(sarah.candidates.map((c) => [c.id, c.company, c.matched])).toEqual([['tenant:t-moss', 'Tena Properties Ltd', ['name', 'company word in landlord']]]);
        // Asked for the company alone, the landlord named for it stands; with no such row, whoever carries the word does.
        const company = rankPeople({ query: 'Tena Properties', rows: people, files: [] });
        expect(company.candidates.map((c) => c.id)).toEqual(['landlord:l-tena']);
        const carried = rankPeople({ query: 'Tena Properties', rows: [people[0]], files: [] });
        expect(carried.candidates.map((c) => [c.id, c.matched])).toEqual([['tenant:t-moss', ['company word in landlord']]]);
    });

    it('matches a case file on the board by the name on it', () => {
        const file = whatsappFile({ name: 'Sarah Tena' });
        const out = rankPeople({ query: 'Sarah', hint: 'Tena', rows: [], files: [file] });
        expect(out.candidates).toEqual([expect.objectContaining({ id: `case_file:${file.id}`, kind: 'case_file', caseFileId: file.id, stage: file.stage })]);
    });
});

describe('several Alan Smiths', () => {
    const file = whatsappFile({ name: 'Alan Smith' });
    const filePhone = file.parties[0].channels[0].address;
    const rows: PersonRow[] = [
        row({ kind: 'client', id: 'c-ng5', name: 'Alan Smith', phone: filePhone, outwardPostcodes: ['NG5'], lastActivity: '2026-09-02T10:00:00.000Z' }),
        row({ kind: 'lead', id: 'l-ng5', name: 'Alan Smith', phone: filePhone.replace('+44', '0'), lastActivity: '2026-09-10T10:00:00.000Z' }),
        row({ kind: 'lead', id: 'l-de1', name: 'alan smith', phone: '07700900999', outwardPostcodes: ['DE1'] }),
        row({ kind: 'client', id: 'c-smithers', name: 'Alana Smithers', phone: '07700900888' }),
    ];

    it('lists each Alan Smith once, merges the lead and case file with the same phone into the client, and leaves out the near name', () => {
        const out = rankPeople({ query: 'Alan Smith', rows, files: [file] });
        expect(out.candidates.map((c) => c.id)).toEqual(['client:c-ng5', 'lead:l-de1']);
        expect(out.candidates[0]).toMatchObject({ outwardPostcode: 'NG5', caseFileId: file.id, alsoAs: ['lead:l-ng5', `case_file:${file.id}`], lastActivity: file.turns[0].at });
        expect(out.total).toBe(2);
        expect(pickDecision(out, { settled: new Set(), selectedCaseFileId: null })).toEqual({ status: 'pick', question: '2 matches for Alan Smith. Which one?' });
    });

    it('narrows to one by postcode', () => {
        const out = rankPeople({ query: 'Alan Smith', hint: 'DE1', rows, files: [] });
        expect(out.candidates.map((c) => [c.id, c.matched])).toEqual([['lead:l-de1', ['name', 'company word in postcode']]]);
    });

    it('finds by phone number whatever form it was stored in', () => {
        const out = rankPeople({ query: '07700 900999', rows, files: [] });
        expect(out.candidates.map((c) => c.id)).toEqual(['lead:l-de1']);
    });

    it('takes the one on the selected card as meant, and asks when none of them is on it', () => {
        const out = rankPeople({ query: 'Alan Smith', rows, files: [file] });
        expect(pickDecision(out, { settled: new Set(), selectedCaseFileId: file.id })).toMatchObject({ status: 'found', why: 'selected card', person: { id: 'client:c-ng5' } });
        expect(pickDecision(out, { settled: new Set(), selectedCaseFileId: 'another-file' })).toMatchObject({ status: 'pick' });
    });
});

describe('the first time, and after (A4)', () => {
    const one = [row({ kind: 'client', id: 'c-ellis', name: 'Sarah Ellis', companyFields: tagged('Sarah Ellis', 'Tena Properties') })];

    it('asks about a single match the first time and not once the session has settled that person', () => {
        const out = rankPeople({ query: 'Sarah Ellis', rows: one, files: [] });
        expect(pickDecision(out, { settled: new Set(), selectedCaseFileId: null })).toEqual({ status: 'pick', question: 'Did you mean Sarah Ellis?' });
        expect(pickDecision(out, { settled: new Set(['client:c-ellis']), selectedCaseFileId: null })).toMatchObject({ status: 'found', why: 'settled' });
    });

    it('says nobody when nobody matches', () => {
        const out = rankPeople({ query: 'Zed Nobody', rows: one, files: [] });
        expect(out.candidates).toEqual([]);
        expect(pickDecision(out, { settled: new Set(), selectedCaseFileId: null })).toEqual({ status: 'none' });
    });
});

describe('what a session has settled', () => {
    let n = 0;
    const msg = (m: Partial<AskMessageDTO> & Pick<AskMessageDTO, 'role'>): AskMessageDTO => ({ id: `m${++n}`, sessionId: 's', content: '', runId: null, transcript: null, createdAt: '2026-09-17T09:00:00.000Z', ...m });
    const pickAnswer = msg({
        role: 'assistant', content: 'Did you mean Sarah Ellis?',
        answer: { finalText: 'Did you mean Sarah Ellis?', surface: { type: 'pick', question: 'Did you mean Sarah Ellis at Tena Properties?', candidates: [{ id: 'client:c-ellis', name: 'Sarah Ellis' }] } },
    });
    const ask = msg({ role: 'user', content: 'send a whatsapp to sarah from tena properties telling her we will call this afternoon' });

    it('takes a tapped person the session showed, with the pick it answers and the ask behind it', () => {
        const out = sessionPeople([ask, pickAnswer], { personId: 'client:c-ellis', caseFileId: null });
        expect(out).toEqual({
            settled: ['client:c-ellis'],
            personId: 'client:c-ellis',
            picked: { personId: 'client:c-ellis', name: 'Sarah Ellis', question: 'Did you mean Sarah Ellis at Tena Properties?', ask: ask.content },
        });
    });

    it('drops a person id the session never showed', () => {
        expect(sessionPeople([ask, pickAnswer], { personId: 'client:someone-else' })).toEqual({ settled: [], personId: null, picked: null });
    });

    it('remembers a tap and a client card for the rest of the session, and a pick shown but not tapped settles nobody', () => {
        const tap = msg({ role: 'user', content: 'Sarah Ellis', via: 'tap', context: { personId: 'client:c-ellis' } });
        const card = msg({ role: 'assistant', answer: { finalText: 'Here is Alan.', surface: { type: 'client', name: 'Alan Smith', id: 'client:c-ng5' } } });
        expect(sessionPeople([ask, pickAnswer, tap, card], null).settled.sort()).toEqual(['client:c-ellis', 'client:c-ng5']);
        expect(sessionPeople([ask, pickAnswer], null).settled).toEqual([]);
    });
});
