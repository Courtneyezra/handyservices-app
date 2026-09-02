/**
 * AgentRunsDrawer — "What the agent did" on a thread (reads GET /api/agent-runs?conversationId=).
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderWithQuery } from '@test-utils';
import { AgentRunsDrawer, type AgentRun } from '@/components/comms/AgentRunsDrawer';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const runs: AgentRun[] = [
    {
        id: 'r3', agent: 'scoper', trigger: 'inbound', decision: 'DRAFT', lane: 'customer.default', guardsHit: ['no_price', 'no_promise'],
        proposal: { intent: 'ask_gap', body: ['Hi Sam, thanks for the photos.', 'Can you send your postcode?'], flag: null },
        usage: { input_tokens: 1200, output_tokens: 80 }, costPence: 3, durationMs: 2100, model: 'claude-haiku-4-5', error: null,
        startedAt: ago(2), finishedAt: ago(2),
    },
    { id: 'r2', agent: 'triage', trigger: 'inbound', decision: 'none', lane: 'first_contact', guardsHit: [], proposal: null, usage: null, costPence: 0, durationMs: 300, model: null, error: null, startedAt: ago(5), finishedAt: ago(5) },
    { id: 'r1', agent: 'quote_clerk', trigger: 'call_ended', decision: null, lane: null, guardsHit: [], proposal: null, usage: null, costPence: null, durationMs: null, model: null, error: 'model timeout', startedAt: ago(90), finishedAt: ago(90) },
];

const drawer = (json: unknown) => mockFetch([{ url: '/api/agent-runs?conversationId=c1', reply: () => ({ json }) }]);

describe('AgentRunsDrawer', () => {
    it('empty thread: collapsed count 0, opening shows the empty state', async () => {
        drawer({ runs: [], available: true });
        renderWithQuery(<AgentRunsDrawer conversationId="c1" />);
        const header = screen.getByRole('button', { name: /What the agent did/ });
        expect(await within(header).findByText('0')).toBeInTheDocument();
        expect(screen.queryByText(/No agent runs/)).toBeNull();
        await userEvent.click(header);
        expect(screen.getByText('No agent runs on this thread yet.')).toBeInTheDocument();
    });

    it('server without the table: says run history is not switched on', async () => {
        drawer({ runs: [], available: false });
        renderWithQuery(<AgentRunsDrawer conversationId="c1" />);
        await userEvent.click(screen.getByRole('button', { name: /What the agent did/ }));
        expect(await screen.findByText(/Run history isn't switched on for this server yet/)).toBeInTheDocument();
        expect(screen.queryByText(/No agent runs/)).toBeNull();
    });

    it('three runs: one summary line each, expand shows proposal, guards, usage, cost and the run id', async () => {
        drawer({ runs, available: true });
        renderWithQuery(<AgentRunsDrawer conversationId="c1" />);
        const header = screen.getByRole('button', { name: /What the agent did/ });
        expect(await within(header).findByText('3')).toBeInTheDocument();
        await userEvent.click(header);
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(items[0]).toHaveTextContent('scoper');
        expect(items[0]).toHaveTextContent('DRAFT');
        expect(items[0]).toHaveTextContent('2 guards');
        expect(items[0]).toHaveTextContent('3p');
        expect(items[1]).toHaveTextContent('triage');
        expect(items[2]).toHaveTextContent('quote_clerk');
        expect(items[2]).toHaveTextContent('failed');
        expect(screen.queryByText('Proposal')).toBeNull();

        await userEvent.click(within(items[0]).getByRole('button'));
        expect(within(items[0]).getByText('Proposal')).toBeInTheDocument();
        expect(within(items[0]).getByText(/Hi Sam, thanks for the photos\. --- Can you send your postcode\?/)).toBeInTheDocument();
        expect(within(items[0]).getByText('no_price')).toBeInTheDocument();
        expect(within(items[0]).getByText('no_promise')).toBeInTheDocument();
        expect(within(items[0]).getByText('1200 in · 80 out tokens')).toBeInTheDocument();
        expect(within(items[0]).getByText('claude-haiku-4-5')).toBeInTheDocument();
        expect(within(items[0]).getByText('run r3')).toBeInTheDocument();
        expect(within(items[0]).getByText(/"intent": "ask_gap"/)).toBeInTheDocument();

        await userEvent.click(within(items[2]).getByRole('button'));
        expect(within(items[2]).getByText('model timeout')).toBeInTheDocument();

        // Collapse the first again
        await userEvent.click(within(items[0]).getByRole('button'));
        expect(within(items[0]).queryByText('Proposal')).toBeNull();
    });

    it('a failed load says so inside the drawer', async () => {
        mockFetch([{ url: '/api/agent-runs', reply: () => ({ status: 500, json: { error: 'boom' } }) }]);
        renderWithQuery(<AgentRunsDrawer conversationId="c1" />);
        await userEvent.click(screen.getByRole('button', { name: /What the agent did/ }));
        await waitFor(() => expect(screen.getByText(/Couldn't load runs\. agent runs 500/)).toBeInTheDocument());
    });
});
