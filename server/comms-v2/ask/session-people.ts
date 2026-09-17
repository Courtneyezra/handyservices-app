/**
 * Handy Desk - who a session has already settled (answer A4's "first time"), and what a pick tap
 * answers, read from the session's own messages.
 *
 * A person ref is shown when an answer in the session carried it: a pick card's row, or a client
 * card. It is settled when Ben tapped it (a later ask whose `context.personId` names it) or a client
 * card showed it. A `context.personId` the session never showed is dropped, so a client cannot settle
 * a person by posting an id. A tap on a pick row carries the question it answered and the ask that
 * led to it, so the next run carries on with that ask for the person Ben chose.
 */
import type { AskContext, AskMessageDTO } from '@shared/ops-types';

export interface PickedPerson {
    personId: string;
    name: string | null;
    /** The pick card's question. */
    question: string;
    /** The ask that led to the pick, verbatim; null when none is found. */
    ask: string | null;
}

export interface SessionPeople {
    /** Refs settled before this ask, and the one it names. */
    settled: string[];
    /** The ask's `context.personId` when the session showed it; null otherwise. */
    personId: string | null;
    /** When the ask names a person from a pick card: what the pick was about. */
    picked: PickedPerson | null;
}

function shownIn(message: AskMessageDTO): string[] {
    const s = message.answer?.surface;
    if (s?.type === 'pick') return s.candidates.map((c) => c.id);
    if (s?.type === 'client' && s.id) return [s.id];
    return [];
}

export function sessionPeople(prior: AskMessageDTO[], context: AskContext | null): SessionPeople {
    const shown = new Set<string>();
    const settled = new Set<string>();
    for (const m of prior) {
        if (m.role === 'user') {
            const id = m.context?.personId;
            if (id && shown.has(id)) settled.add(id);
            continue;
        }
        for (const id of shownIn(m)) shown.add(id);
        const s = m.answer?.surface;
        if (s?.type === 'client' && s.id) settled.add(s.id);
    }

    const wanted = context?.personId?.trim() || null;
    const personId = wanted && shown.has(wanted) ? wanted : null;
    if (personId) settled.add(personId);

    let picked: PickedPerson | null = null;
    if (personId) {
        for (let i = prior.length - 1; i >= 0; i--) {
            const s = prior[i].answer?.surface;
            if (prior[i].role !== 'assistant' || s?.type !== 'pick') continue;
            const row = s.candidates.find((c) => c.id === personId);
            if (!row) continue;
            const before = prior.slice(0, i).reverse().find((m) => m.role === 'user');
            picked = { personId, name: row.name ?? null, question: s.question, ask: before?.content ?? null };
            break;
        }
    }
    return { settled: Array.from(settled), personId, picked };
}
