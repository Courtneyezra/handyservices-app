/**
 * Shared fixtures for the ask agent's tests: a WhatsApp case file with an open window, a memory
 * store behind the BoardSource shape the board reads, a scripted reasoner loop that calls the
 * agent's own tools in the order a test gives, and CRM people and dossiers for the clients group.
 */
import type { AgentTool, AgentTranscriptEvent } from '../../agents/runner';
import { open, type CaseFile } from '../desk/case-file';
import { MemoryCaseFileStore } from '../desk/store';
import type { BoardSource } from '../api/store';
import type { AskLoop } from './agent';
import type { PersonRow } from './people';
import type { CustomerDossier } from '../../customer-dossier';

export const AT = '2026-09-17T09:00:00.000Z';
export const NOW = '2026-09-17T09:10:00.000Z';
export const now = (iso = NOW) => () => new Date(iso);
export const BEN_PERSON = 'ben.real@handyservices.app';

let n = 0;
export function whatsappFile(opts: { name?: string; body?: string; at?: string } = {}): CaseFile {
    n += 1;
    const r = open({
        identity: { ok: true, personId: `p${n}`, customerId: null, role: 'homeowner', isNew: true, canonical: `phone:07700900${String(100 + n).slice(-3)}`, propertyId: null, landlordId: null, name: opts.name ?? 'Sam' },
        channel: 'whatsapp', address: `+447700900${String(100 + n).slice(-3)}`,
        firstTurn: { at: opts.at ?? AT, channel: 'whatsapp', kind: 'text', body: opts.body ?? 'Hi, my kitchen tap is dripping. Can someone have a look?', media: [] },
    }, { now: now(opts.at ?? AT) });
    if (!r.ok) throw new Error(r.reason);
    return r.value;
}

export function memorySource(files: CaseFile[] = [], mode: BoardSource['mode'] = 'dry_run'): { store: MemoryCaseFileStore; source: () => Promise<BoardSource> } {
    const store = new MemoryCaseFileStore();
    for (const f of files) store.put(f);
    return { store, source: async () => ({ store, live: mode === 'live', mode }) };
}

export type ScriptStep = { tool: string; input: unknown };

/** A reasoner that calls the given tools in order, records what each returned, then closes with a line. */
export function scriptedLoop(steps: ScriptStep[] | ((tools: AgentTool[]) => ScriptStep[]), seen: { opts?: Parameters<AskLoop>[0]; results: unknown[] } = { results: [] }): AskLoop {
    return async (opts) => {
        seen.opts = opts;
        const plan = typeof steps === 'function' ? steps(opts.tools) : steps;
        for (const step of plan) {
            const tool = opts.tools.find((t) => t.name === step.tool);
            if (!tool) throw new Error(`no tool ${step.tool}`);
            const at = new Date().toISOString();
            opts.onEvent({ at, type: 'tool_call', detail: { tool: step.tool, input: step.input } } as AgentTranscriptEvent);
            const result = await tool.run(step.input);
            seen.results.push(result);
            opts.onEvent({ at, type: 'tool_result', detail: { tool: step.tool, result } } as AgentTranscriptEvent);
        }
        return { finalText: 'Done.', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } as never };
    };
}

/** A CRM person row for the people directory (people.ts); its name is its only company field unless given. */
export function personRow(over: Partial<PersonRow> & Pick<PersonRow, 'kind' | 'id' | 'name'>): PersonRow {
    return {
        phone: null, clientId: over.kind === 'client' ? over.id : null, companyFields: over.name ? [{ field: 'name', text: over.name, shown: null }] : [],
        company: null, outwardPostcodes: [], emailOnFile: false, addressOnFile: false, lastActivity: '2026-09-01T10:00:00.000Z', ...over,
    };
}

/** An empty dossier for a phone, with any lists a test gives. */
export function dossierOf(over: Partial<CustomerDossier> = {}): CustomerDossier {
    return {
        phoneKey: '', name: null,
        summary: { jobs: 0, openBalancePence: 0, liveQuotes: 0, counts: { leads: 0, quotes: 0, jobs: 0, invoices: 0, conversations: 0, calls: 0 } },
        leads: [], quotes: [], jobs: [], invoices: [], conversations: [], calls: [], ...over,
    };
}
