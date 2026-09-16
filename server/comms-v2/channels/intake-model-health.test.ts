/**
 * The intake's desk and the model alarm: only the live desk, which answers customers, records a
 * turn's model verdict, pages and moves the health read; a sandbox desk does none of the three.
 */
import { APIError } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { intakeModelHealth } from './intake';
import { Desk } from '../desk/desk';
import { noFixedLineSource } from '../desk/fixed-lines';
import { Gateway } from '../desk/gateway';
import { deskModelHealth, type ModelHealthRecord, type ModelHealthStore } from '../desk/model-health';
import { AnthropicModelClient } from '../desk/models';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';

const CREDIT = 'Your credit balance is too low to access the Anthropic API.';

async function failedTurnOn(purpose: 'live' | 'sandbox') {
    const store = { row: null as ModelHealthRecord | null, writes: 0 };
    const health: ModelHealthStore = {
        read: async () => store.row,
        update: async (next) => { const r = next(store.row); if (r) { store.row = r; store.writes++; } },
    };
    const pages: string[] = [];
    const client = new AnthropicModelClient();
    (client as any).client = { messages: { parse: async () => { throw APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: CREDIT } }, undefined, new Headers()); } } };
    const modelHealth = await intakeModelHealth(purpose, { store: health, pageable: true, notify: async (_title, message) => { pages.push(message); } });
    const quotes = new MemoryQuoteStore();
    const now = () => new Date('2026-09-16T05:41:16.000Z');
    const desk = new Desk({
        client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, now,
        scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) },
        quoting: { store: quotes, drafter: new FakeDrafter(quotes), notifier: recordingNotifier },
        ...(modelHealth ? { modelHealth } : {}),
    });
    const out = await new Gateway({ desk, now }).inbound({ channel: 'whatsapp', address: '+447700900942', name: 'Sam', text: 'My tap is leaking', media: [], at: now().toISOString(), providerMessageId: null, via: 'door', mediaFailures: [] });
    if (out.kind !== 'handled') throw new Error(out.kind);
    return { store, pages, result: out.result, health: await deskModelHealth(health.read) };
}

describe('the intake desk model health', () => {
    it('a live desk turn that cannot reach the model pages, writes the row and reads cannot answer', async () => {
        const live = await failedTurnOn('live');
        expect(live.result.decision).toBe('hold');
        expect(live.pages).toHaveLength(1);
        expect(live.pages[0]).toContain(CREDIT);
        expect(live.store.writes).toBe(1);
        expect(live.health).toMatchObject({ status: 'failing', canAnswer: false });
    });

    it('a sandbox desk turn that cannot reach the model does not page, write the row or move the health read', async () => {
        const sandbox = await failedTurnOn('sandbox');
        expect(sandbox.result.decision).toBe('hold');
        expect(sandbox.pages).toEqual([]);
        expect(sandbox.store.writes).toBe(0);
        expect(sandbox.health).toMatchObject({ status: 'idle', canAnswer: null });
    });
});
