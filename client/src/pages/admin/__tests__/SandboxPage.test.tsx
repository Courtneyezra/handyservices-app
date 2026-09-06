/**
 * T5 vitest (client): the sandbox page's pure parts and the one thing on the screen that must be
 * impossible to misread — the "NOT SENT — dry run" state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';

vi.mock('@/hooks/useCommsEvents', () => ({ useCommsEvents: () => undefined }));

import SandboxPage, { RunDetail, decisionLabel, pounds, WRONG_MOVE_SHAPES, type SandboxRun, type SandboxState } from '@/pages/admin/SandboxPage';

function run(over: Partial<SandboxRun> = {}): SandboxRun {
    return {
        runId: 'run_1', agent: 'scoper', pack: { id: 'customer.post_quote', version: 3 },
        triage: { lane: 'post_quote', intent: 'unknown', exceptions: [], tags: [], reasons: ['customer replied after the quote'], source: 'rules' },
        proposal: { intent: 'ask_gap', body: ['Which room is the fan in?', 'A photo would help.'], reasons: ['still scoping'] },
        guards: { ok: true, guardsHit: [], escalate: false, notes: [] },
        decision: { kind: 'pending', dueAt: '2026-09-06T12:00:00Z', reason: 'intent ask_gap is at tier DRAFT' },
        dryRun: true, sandbox: true,
        exitNote: 'DRY RUN — nothing sent, nothing queued, nobody pinged. Live, this would have: queued as a DRAFT for Ben to approve',
        skipped: ['job pack filing (writes job packs; skipped in the sandbox)'], error: null, durationMs: 4200, costPence: 3, model: 'claude-sonnet-5',
        caseFile: { stage: 'quote_sent', tags: ['sandbox'], quote: { slug: 'sbxabcde', total: 480, paid: false }, window: { canFreeform: true, templateRequired: false } },
        benLaneClerk: null, routeA: null, ...over,
    };
}

describe('pure helpers', () => {
    it('pounds formats pence and tolerates no cost', () => {
        expect(pounds(3)).toBe('£0.03');
        expect(pounds(48000)).toBe('£480.00');
        expect(pounds(null)).toBeNull();
    });
    it('decisionLabel never softens send', () => {
        expect(decisionLabel({ kind: 'send', approver: 'agent.scoper' })).toEqual({ text: 'SEND — would go to the customer with no approval (agent.scoper)', tone: 'send' });
        expect(decisionLabel({ kind: 'pending', reason: 'r' }).tone).toBe('draft');
        expect(decisionLabel({ kind: 'flag', exception: 'money_question' }).text).toContain('FLAG for Ben — money_question');
        expect(decisionLabel({ kind: 'none', reason: 'no proposal' }).text).toBe('NOTHING — no proposal');
    });
    it('the five wrong-move shapes are customer lines, four of which need a quote out', () => {
        expect(WRONG_MOVE_SHAPES).toHaveLength(5);
        expect(WRONG_MOVE_SHAPES.filter((s) => s.needsQuote)).toHaveLength(4);
        for (const s of WRONG_MOVE_SHAPES) expect(s.text.length).toBeGreaterThan(20);
    });
});

describe('<RunDetail>', () => {
    it('leads with NOT SENT, shows the exit line, the decision, the bubbles, the cost', () => {
        render(<RunDetail run={run()} />);
        expect(screen.getByTestId('sandbox-exit-note').textContent).toContain('NOT SENT — dry run');
        expect(screen.getByTestId('sandbox-exit-note').textContent).toContain('Live, this would have: queued as a DRAFT');
        expect(screen.getByTestId('sandbox-decision').textContent).toContain('DRAFT for Ben');
        expect(screen.getByText('Which room is the fan in?')).toBeTruthy();
        expect(screen.getByText('A photo would help.')).toBeTruthy();
        expect(screen.getByText('£0.03')).toBeTruthy();
        expect(screen.getByText(/lane/).textContent).toContain('post_quote');
        expect(screen.getByText(/job pack filing/)).toBeTruthy();
    });
    it('a send decision reads as SEND in red, still inside the NOT SENT frame', () => {
        render(<RunDetail run={run({ decision: { kind: 'send', approver: 'agent.scoper' } })} />);
        const d = screen.getByTestId('sandbox-decision');
        expect(d.textContent).toContain('SEND — would go to the customer with no approval');
        expect(d.className).toContain('red');
        expect(screen.getByTestId('sandbox-exit-note')).toBeTruthy();
    });
    it('no proposal: says so, no bubbles', () => {
        render(<RunDetail run={run({ proposal: null, decision: { kind: 'none', reason: 'no proposal' } })} />);
        expect(screen.getByText(/No proposal: the agent chose to say nothing/)).toBeTruthy();
        expect(screen.queryByText('Which room is the fan in?')).toBeNull();
    });
    it('T6: a failed agent is never painted as choosing silence', () => {
        render(<RunDetail run={run({ proposal: null, decision: { kind: 'none', reason: 'no proposal' }, error: 'agent scoper failed: 400 credit balance is too low' })} />);
        const box = screen.getByTestId('sandbox-no-proposal');
        expect(box.textContent).toContain('the agent failed');
        expect(box.textContent).toContain('credit balance is too low');
        expect(box.textContent).not.toContain('chose to say nothing');
    });
    it('T6: a rules-lane pass explains that no agent runs there, and shows the mirrored ack', () => {
        const rules = run({
            agent: 'rules', pack: { id: 'rules.first_contact', version: 1 },
            triage: { lane: 'rules', intent: 'ack_enquiry', exceptions: [], tags: [], reasons: ['no outbound on the thread: first contact'], source: 'rules' },
            proposal: null, decision: { kind: 'none', reason: 'no proposal' },
            mirrored: { kind: 'first_contact_ack', intent: 'ack_enquiry', body: 'Hi, thanks for getting in touch. Someone will be with you shortly.', messageId: 'm_ack', note: 'First contact is answered by the rules layer. The sandbox has placed it on the thread so your next message reaches the desk.' },
        });
        render(<RunDetail run={rules} />);
        expect(screen.getByTestId('sandbox-no-proposal').textContent).toContain('rules lane, which runs no agent');
        const mirrored = screen.getByTestId('sandbox-mirrored');
        expect(mirrored.textContent).toContain('the rules layer answers, not the desk');
        expect(mirrored.textContent).toContain('Hi, thanks for getting in touch.');
        expect(mirrored.textContent).toContain('next message reaches the desk');
    });
});

describe('<SandboxPage>', () => {
    const empty: SandboxState = { phone: { e164: '+447700900942', wa: '447700900942@c.us' }, conversation: null, messages: [], quote: null, runs: [] };
    const started: SandboxState = {
        ...empty,
        conversation: { id: 'sbx-1', stage: 'enquiry', tags: ['sandbox'], contactName: 'Sandbox customer (not real)', createdAt: '2026-09-06T10:00:00Z', hasTrigger: false },
    };

    it('with no thread: the banner, a Start button, and a disabled composer', async () => {
        mockFetch([{ method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: empty }) }]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect(screen.getByText(/No sandbox thread yet/)).toBeTruthy());
        expect(screen.getByTestId('sandbox-banner').textContent).toContain('Dry run only');
        expect(screen.getByTestId('sandbox-banner').textContent).toContain('+447700900942');
        expect(screen.getByTestId('sandbox-reset').textContent).toContain('Start a clean thread');
        expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(true);
        expect((screen.getByTestId('sandbox-send') as HTMLButtonElement).disabled).toBe(true);
    });

    it('sending as the customer posts the text and shows the pass as NOT SENT', async () => {
        const { calls } = mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: started }) },
            { method: 'POST', url: '/api/comms-sandbox/message', reply: () => ({ json: { ok: true, messageId: 'm1', run: run(), state: started } }) },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        await userEvent.type(screen.getByTestId('sandbox-input'), "That's a lot more than I was expecting");
        await userEvent.click(screen.getByTestId('sandbox-send'));
        await waitFor(() => expect(screen.getByTestId('sandbox-run-detail')).toBeTruthy());
        const post = calls.find((c) => c.method === 'POST');
        expect(post?.body).toEqual({ text: "That's a lot more than I was expecting" });
        expect(post?.url).not.toMatch(/sbx-1/);
        expect(screen.getByTestId('sandbox-proposed-bubble').textContent).toContain('NOT SENT');
        expect(screen.getByTestId('sandbox-exit-note').textContent).toContain('NOT SENT — dry run');
    });

    it('T6: a first-contact pass shows the mirrored ack in the thread, labelled, and in the detail', async () => {
        const ackBody = 'Hi, thanks for getting in touch. Someone will be with you shortly.';
        const withAck: SandboxState = {
            ...started,
            messages: [
                { id: 'm1', direction: 'inbound', content: 'Hi, do you fit extractor fans?', createdAt: '2026-09-06T10:00:01Z', senderName: 'Sandbox customer (not real)' },
                { id: 'm_ack', direction: 'outbound', content: ackBody, createdAt: '2026-09-06T10:00:05Z', senderName: 'Sandbox (rules layer ack, mirrored, never sent)' },
            ],
        };
        const rulesRun = run({
            agent: 'rules', pack: { id: 'rules.first_contact', version: 1 },
            triage: { lane: 'rules', intent: 'ack_enquiry', exceptions: [], tags: [], reasons: ['no outbound on the thread: first contact'], source: 'rules' },
            proposal: null, decision: { kind: 'none', reason: 'no proposal' },
        });
        let posted = false;
        mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: posted ? withAck : started }) },
            { method: 'POST', url: '/api/comms-sandbox/message', reply: () => { posted = true; return { json: { ok: true, messageId: 'm1', run: rulesRun, mirrored: { kind: 'first_contact_ack', intent: 'ack_enquiry', body: ackBody, messageId: 'm_ack', note: 'First contact is answered by the rules layer.' }, state: withAck } }; } },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        await userEvent.type(screen.getByTestId('sandbox-input'), 'Hi, do you fit extractor fans?');
        await userEvent.click(screen.getByTestId('sandbox-send'));
        await waitFor(() => expect(screen.getByTestId('sandbox-mirrored')).toBeTruthy());
        expect(screen.getByTestId('sandbox-mirrored').textContent).toContain(ackBody);
        await waitFor(() => expect(screen.getByText(/rules layer ack · mirrored · never sent/i)).toBeTruthy());
        expect(screen.getByTestId('sandbox-proposed-bubble').textContent).toContain('first contact');
        expect(screen.getByTestId('sandbox-proposed-bubble').textContent).not.toContain('no reply proposed');
    });
});
