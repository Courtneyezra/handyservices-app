/**
 * P15 part 2 jsdom: "Message the customer" on the contractor's job. The three presets post the
 * right thing, a free-text message posts his words, a held message reads as "it is with the office"
 * rather than an error, the five-a-day limit disables the controls, and nothing on his screen
 * carries the customer's number.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageCustomerPanel, sendPayload, clampMinutes, relayTime, type RelayThread } from '@/components/contractor/MessageCustomerPanel';

const TOKEN = 'tok_abcdefghijklmnop';
const BOOKING = '2d21da09-6fc4-42b6-b036-ea013bb654c6';

const thread = (over: Partial<RelayThread> = {}): RelayThread => ({
    messages: [
        { id: 'm1', at: '2026-09-05T09:00:00.000Z', direction: 'out', body: "Craig here, I'm outside. Which door?" },
        { id: 'm2', at: '2026-09-05T09:05:00.000Z', direction: 'in', body: 'Side door, the blue one' },
    ],
    presets: [{ id: 'arrived', label: "I've arrived" }, { id: 'running_late', label: 'Running late' }, { id: 'access', label: 'Which door / parking?' }],
    remaining: 4,
    dailyLimit: 5,
    ...over,
});

function mockFetch(getBody: RelayThread, postBody: Record<string, unknown> = { ok: true, sent: true }, postStatus = 200) {
    const calls: Array<{ method: string; url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
        const json = method === 'POST' ? postBody : getBody;
        return { ok: method === 'POST' ? postStatus < 400 : true, status: method === 'POST' ? postStatus : 200, json: async () => json } as any;
    }));
    return calls;
}

afterEach(() => vi.unstubAllGlobals());

async function openPanel() {
    render(<MessageCustomerPanel token={TOKEN} bookingId={BOOKING} accepted />);
    await userEvent.click(screen.getByTestId('message-customer-toggle'));
    await waitFor(() => expect(screen.getByTestId('relay-presets')).toBeInTheDocument());
}

describe('MessageCustomerPanel', () => {
    it('is not rendered at all until the job is accepted', () => {
        mockFetch(thread());
        render(<MessageCustomerPanel token={TOKEN} bookingId={BOOKING} accepted={false} />);
        expect(screen.queryByTestId('message-customer')).toBeNull();
    });

    it('the three presets post their id, and running late carries the minutes', async () => {
        const calls = mockFetch(thread());
        await openPanel();
        await userEvent.click(screen.getByTestId('relay-preset-arrived'));
        await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
        expect(calls.find((c) => c.method === 'POST')!.url).toBe(`/api/contractor-app/${TOKEN}/jobs/${BOOKING}/message`);
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ preset: 'arrived' });

        const minutes = screen.getByLabelText('Minutes late');
        await userEvent.clear(minutes); await userEvent.type(minutes, '30');
        await userEvent.click(screen.getByTestId('relay-preset-running_late'));
        await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
        expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({ preset: 'running_late', minutes: 30 });
    });

    it('free text posts his words and clears the box on a send', async () => {
        const calls = mockFetch(thread());
        await openPanel();
        expect(screen.getByTestId('relay-send')).toBeDisabled();
        await userEvent.type(screen.getByTestId('relay-text'), '  the gate is locked  ');
        await userEvent.click(screen.getByTestId('relay-send'));
        await waitFor(() => expect(screen.getByTestId('relay-note-sent')).toBeInTheDocument());
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ text: 'the gate is locked' });
        expect(screen.getByTestId('relay-text')).toHaveValue('');
    });

    it('a held message reads as "it is with the office", not as a failure', async () => {
        mockFetch(thread(), { ok: true, sent: false, held: true, message: 'That mentions money, and prices are the office\'s to give. It has gone to Ben.' });
        await openPanel();
        await userEvent.type(screen.getByTestId('relay-text'), 'I can do it for £40');
        await userEvent.click(screen.getByTestId('relay-send'));
        const note = await screen.findByTestId('relay-note-held');
        expect(note).toHaveTextContent('gone to Ben');
        expect(screen.queryByTestId('relay-note-error')).toBeNull();
    });

    it('a refusal shows the server\'s words', async () => {
        mockFetch(thread(), { error: 'That is 5 messages on this job today. Give the office a ring for anything else.' }, 429);
        await openPanel();
        await userEvent.type(screen.getByTestId('relay-text'), 'hello');
        await userEvent.click(screen.getByTestId('relay-send'));
        expect(await screen.findByTestId('relay-note-error')).toHaveTextContent('Give the office a ring');
    });

    it('with none left today the controls are dead and say why', async () => {
        mockFetch(thread({ remaining: 0 }));
        await openPanel();
        expect(screen.getByTestId('relay-remaining')).toHaveTextContent("today's five");
        expect(screen.getByTestId('relay-preset-arrived')).toBeDisabled();
        expect(screen.getByTestId('relay-text')).toBeDisabled();
    });

    it('shows the exchange with no customer number anywhere on his screen', async () => {
        mockFetch(thread());
        await openPanel();
        const t = screen.getByTestId('relay-thread');
        expect(within(t).getByTestId('relay-message-m1')).toHaveTextContent("Craig here, I'm outside. Which door?");
        expect(within(t).getByTestId('relay-message-m1')).toHaveTextContent('You');
        expect(within(t).getByTestId('relay-message-m2')).toHaveTextContent('Customer');
        expect(screen.getByTestId('message-customer').textContent).not.toMatch(/\+?44\d|07\d{3}/);
    });
});

describe('sendPayload', () => {
    it('a preset beats the box, running late carries the minutes, and an empty box sends nothing', () => {
        expect(sendPayload({ preset: 'arrived', minutes: 15, text: 'ignored' })).toEqual({ preset: 'arrived' });
        expect(sendPayload({ preset: 'running_late', minutes: '25', text: '' })).toEqual({ preset: 'running_late', minutes: 25 });
        expect(sendPayload({ preset: 'running_late', minutes: '999', text: '' })).toEqual({ preset: 'running_late', minutes: 120 });
        expect(sendPayload({ preset: 'running_late', minutes: '', text: '' })).toEqual({ preset: 'running_late', minutes: 15 });
        expect(sendPayload({ preset: null, minutes: 15, text: '  the gate is locked ' })).toEqual({ text: 'the gate is locked' });
        expect(sendPayload({ preset: null, minutes: 15, text: '   ' })).toBeNull();
    });
    it('relayTime is a clock, not a date', () => {
        expect(relayTime('2026-09-05T09:05:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
        expect(relayTime('nonsense')).toBe('');
        expect(clampMinutes('7')).toBe(7);
        expect(clampMinutes('0')).toBe(15);
    });
});
