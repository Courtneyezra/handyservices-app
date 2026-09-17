/**
 * Handy Desk - the ask agent's `clients` tool group (ask-agent specification N2, N3, N4).
 *
 *   find_people     who Ben means, ranked (people.ts). Several matches, or a single match the first
 *                   time that person comes up in the session, is a pick (answer A4): the run saves the
 *                   pick card and the model is told to stop and answer with it. A found person is
 *                   settled for this run.
 *   client_record   a settled person's full record, read only (client-record.ts, answer 115).
 *   properties_of   a settled person's properties, by outward postcode.
 *
 * Every tool reads. A person the run has not settled (picked by Ben, shown on a client card, found
 * without a pick, or the selected card) is refused by id, so an id the model made up or a candidate
 * Ben has not picked reads nothing, and `proposeInRun` (tools.ts) proposes nothing while a pick waits.
 * The other ask tasks gate on the same set through `settledRefusal`.
 */
import type { AgentTool } from '../../agents/runner';
import type { PickCandidate, PickSurface } from '@shared/ops-types';
import type { AskRunState, AskToolDeps } from './tools';
import {
    CANDIDATE_CAP, databasePeopleDirectory, parsePersonRef, pickDecision, rankPeople, parseQuery, searchTerms,
    type PersonCandidate,
} from './people';
import { clientRecord, databaseDossier } from './client-record';

export const CLIENT_TOOL_NAMES = ['find_people', 'client_record', 'properties_of'] as const;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The pick card's row for a candidate, with what a tap posts. */
export function pickRowOf(c: PersonCandidate): PickCandidate {
    const name = c.name ?? 'No name on file';
    return {
        id: c.id,
        name,
        kind: c.kind,
        company: c.company,
        phoneTail: c.phoneTail,
        outwardPostcode: c.outwardPostcode,
        lastActivity: c.lastActivity,
        caseFileId: c.caseFileId,
        stage: c.stage,
        held: c.held,
        choose: { text: c.company ? `${name}, ${c.company}` : name, context: { personId: c.id, caseFileId: c.caseFileId } },
    };
}

/** Settles a found person under every ref they carry, and drops any pick waiting on them. */
export function settle(state: AskRunState, c: PersonCandidate): void {
    for (const ref of [c.id, ...c.alsoAs]) state.people.settled.add(ref);
    state.people.picks = state.people.picks.filter((p) => !p.candidates.some((x) => x.id === c.id || c.alsoAs.includes(x.id)));
}

/**
 * Null when a tool may act on this person ref; otherwise why not. Every ask tool that takes a
 * person ref asks this first.
 */
export function settledRefusal(state: AskRunState, ref: string): string | null {
    if (!parsePersonRef(ref)) return 'that is not a person id: use an id find_people returned';
    if (state.people.picks.some((p) => p.candidates.some((c) => c.id === ref))) return 'Ben has not picked this person yet: answer with the pick card and wait for his tap';
    if (!state.people.settled.has(ref)) return 'this person has not been found in this ask: call find_people first and use the id it returns';
    return null;
}

/** The `clients` group. */
export function clientTools(deps: AskToolDeps, state: AskRunState): AgentTool[] {
    const people = deps.people ?? databasePeopleDirectory;
    const dossier = deps.dossier ?? databaseDossier;
    const now = deps.now ?? (() => new Date());

    return [
        {
            name: 'find_people',
            description: 'Find who Ben means: customers, landlords, tenants, leads and case files, by name, phone number or company. Put a company or postcode in hint ("Sarah" with hint "Tena Properties", "Alan Smith" with hint "NG5"). Returns status "found" with one person and their personId; "pick" when Ben must choose (several matches, or the first time someone comes up today), in which case stop and answer with surface "pick"; or "none".',
            input_schema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'A name or a phone number, as Ben said it.' },
                    hint: { type: 'string', description: 'A company word or postcode Ben gave, e.g. "Tena Properties".' },
                },
                required: ['query'],
            },
            run: async (input: { query?: string; hint?: string }) => {
                const query = str(input?.query).trim().slice(0, 200);
                const hint = str(input?.hint).trim().slice(0, 200) || null;
                if (!query && !hint) return { status: 'refused', reason: 'a search needs a name, a phone number or a company' };
                const src = await deps.source();
                const files = src.store.all();
                const rows = await people.search(searchTerms(parseQuery(query || hint!, query ? hint : null)));
                const outcome = rankPeople({ query: query || hint!, hint: query ? hint : null, rows, files });
                const decision = pickDecision(outcome, { settled: state.people.settled, selectedCaseFileId: deps.selectedCaseFileId ?? null });
                const view = (c: PersonCandidate) => ({
                    personId: c.id, kind: c.kind, name: c.name, company: c.company, phoneTail: c.phoneTail, outwardPostcode: c.outwardPostcode,
                    caseFileId: c.caseFileId, stage: c.stage, held: c.held, lastActivity: c.lastActivity, matched: c.matched,
                });
                const asked = { query, hint: outcome.parsed.hint };
                if (decision.status === 'none') {
                    return {
                        status: 'none', ...asked,
                        note: outcome.nameOnly
                            ? `${outcome.nameOnly} ${outcome.nameOnly === 1 ? 'person matches' : 'people match'} the name, but not "${outcome.parsed.hint}". Tell Ben, and offer to search by phone number.`
                            : 'Nobody matches. Tell Ben, and offer to search by phone number.',
                    };
                }
                if (decision.status === 'found') {
                    settle(state, decision.person);
                    return { status: 'found', ...asked, person: view(decision.person), note: `Found (${decision.why}). Use this personId for client_record and anything else about them.` };
                }
                const card: PickSurface = {
                    type: 'pick',
                    question: decision.question,
                    candidates: outcome.candidates.slice(0, CANDIDATE_CAP).map(pickRowOf),
                    query: query || hint!,
                    hint: outcome.parsed.hint,
                    total: outcome.total,
                };
                const key = card.candidates.map((c) => c.id).join('|');
                if (!state.people.picks.some((p) => p.candidates.map((c) => c.id).join('|') === key)) state.people.picks.push(card);
                return {
                    status: 'pick', ...asked, question: card.question, total: outcome.total,
                    candidates: outcome.candidates.map(view),
                    note: 'Ben must pick first. Read nothing more about these people and propose nothing: call give_answer now with surface "pick". His tap comes back to you as a new ask.',
                };
            },
        },
        {
            name: 'client_record',
            description: 'One person\'s full record, read only: name, company, whether an email and an address are on file (never the values), properties by postcode, their open case file, last quote, next booking, what they owe, and their recent quotes, jobs, invoices, calls and enquiries. Give a personId from find_people (status "found") or the selected person. Show it with surface "client".',
            input_schema: {
                type: 'object',
                properties: { personId: { type: 'string' } },
                required: ['personId'],
            },
            run: async (input: { personId?: string }) => {
                const ref = str(input?.personId).trim();
                const refusal = settledRefusal(state, ref);
                if (refusal) return { status: 'refused', reason: refusal };
                const src = await deps.source();
                const out = await clientRecord(ref, { people, dossier, files: src.store.all(), now: now() });
                if (!out.ok) return { status: 'refused', reason: out.reason };
                state.people.cards.set(ref, out.card);
                if (out.card.id && out.card.id !== ref) {
                    // A case file whose customer the CRM knows reads as that client.
                    state.people.cards.set(out.card.id, out.card);
                    state.people.settled.add(out.card.id);
                }
                state.people.lastCard = ref;
                const { type: _type, ...record } = out.card;
                return { status: 'ok', record };
            },
        },
        {
            name: 'properties_of',
            description: 'The properties a settled person owns, rents or is billed for, by outward postcode only (never the address). Give a personId from find_people or the selected person.',
            input_schema: {
                type: 'object',
                properties: { personId: { type: 'string' } },
                required: ['personId'],
            },
            run: async (input: { personId?: string }) => {
                const ref = str(input?.personId).trim();
                const refusal = settledRefusal(state, ref);
                if (refusal) return { status: 'refused', reason: refusal };
                const parsed = parsePersonRef(ref)!;
                if (parsed.kind === 'case_file') return { status: 'ok', properties: [], note: 'A case file on its own holds no property record; find the person in the CRM for theirs.' };
                const props = await people.properties(parsed.kind, parsed.id);
                return { status: 'ok', properties: props.map((p) => ({ id: p.id, outwardPostcode: p.outwardPostcode, role: p.role, active: p.active })) };
            },
        },
    ];
}
