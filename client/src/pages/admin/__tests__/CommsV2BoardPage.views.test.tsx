/**
 * B3 - the comms board recreated from the design export: the Kanban / Floor toggle over one /board
 * response, the stripped-back card (scanning information only) with its amber hold chip, wait and
 * "Draft ready" dot, the header controls, every board
 * state (first-fetch skeleton, empty, empty held filter, failed fetch keeping the last good copy,
 * read-only for a session with no approver slot), and the phone's one column at a time with no Floor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';
import CommsV2BoardPage, { type Board, type BoardCard, type CaseFileDetail, STAGES } from '@/pages/admin/CommsV2BoardPage';

function stubViewport(wide: boolean) {
    const mq = (query: string) => ({ matches: wide && query.includes('min-width'), media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false });
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn(mq) });
}

afterEach(() => {
    delete (window as any).matchMedia;
});

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function card(over: Partial<BoardCard> = {}): BoardCard {
    return {
        id: 'case_x', stage: 'first_contact', mode: 'sandbox', held: false, holdReason: null, holdApprover: null,
        holdApproverAssigned: false, holdSince: null, holdException: null, hasDraft: false,
        customerName: 'Sam Carter', customerAddress: 'phone:07700900942', role: 'homeowner', jobType: 'Leaking tap', location: 'NG5',
        lastCustomerMessage: 'Hi, can I get a quote?', lastCustomerMessageAt: minsAgo(3), replyChannel: 'whatsapp',
        openedAt: minsAgo(30), benToRequest: [],
        ...over,
    };
}

function boardOf(cards: BoardCard[], over: Partial<Board> = {}): Board {
    const columns = Object.fromEntries(STAGES.map((s) => [s, cards.filter((c) => c.stage === s)])) as Board['columns'];
    return { stages: STAGES, columns, sandboxAvailable: false, viewer: { approver: 'ben', canAct: true }, ...over };
}

const GEMMA = card({
    id: 'case_gemma', stage: 'scoping', customerName: 'Gemma Hallam', jobType: 'Bath reseal', location: 'NG2',
    held: true, holdReason: 'Asked for a discount', holdApprover: 'ben', holdApproverAssigned: true,
    holdSince: minsAgo(12), holdException: 'money', hasDraft: true, waitingWorkingHours: 2, benToRequest: ['photo'],
});
const ROB = card({
    id: 'case_rob', stage: 'scoping', customerName: 'Rob Farooq', held: true, holdReason: 'Guard: a duration',
    holdApprover: 'ben', holdApproverAssigned: true, holdSince: minsAgo(80), holdException: null, hasDraft: false,
});
const TOM = card({ id: 'case_tom', stage: 'quoted', customerName: 'Tom Ashworth', replyChannel: 'sms' });

function detail(id: string, name: string, held: boolean): CaseFileDetail {
    return {
        id, stage: 'scoping', mode: 'sandbox',
        party: { name, role: 'homeowner', address: 'phone:07700900942' },
        job: { type: null, location: null, quoteRef: null, bookingRef: null },
        turns: [{ id: `${id}_t1`, at: minsAgo(5), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: `${name} wrote in`, media: [] }],
        facts: [],
        hold: held ? { approver: { kind: 'human', id: 'ben' }, reason: 'Asked for a discount', since: minsAgo(12), draft: 'The held draft' } : null,
        holdApproverAssigned: held,
    };
}

describe('comms board views (B3)', () => {
    it('strips a card to its name, channel, hold chip, wait and Draft ready dot: no message, job line, needs or reissue', async () => {
        stubViewport(true);
        const reissued = card({
            id: 'case_reissued', stage: 'quoted', customerName: 'Priya Shah', replyChannel: 'email',
            quoteReissue: { amount: '£105.00', previous: '£100.00', automatic: true, sentAt: minsAgo(5), notSent: null, at: minsAgo(5) },
        });
        mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ json: boardOf([GEMMA, ROB, TOM, reissued]) }) }]);
        renderWithQuery(<CommsV2BoardPage />);

        const gemma = await screen.findByTestId('board-card-case_gemma');
        expect(gemma.getAttribute('data-held')).toBe('true');
        expect(gemma.className.split(' ')).toContain('border-amber-400');
        expect(within(gemma).getByText('Gemma Hallam')).toBeTruthy();
        expect(within(gemma).getByRole('img', { name: 'WhatsApp' })).toBeTruthy();
        expect(screen.getByTestId('board-card-hold-case_gemma').textContent).toBe('money');
        expect(screen.getByTestId('board-card-hold-case_gemma').getAttribute('title')).toBe('Asked for a discount');
        expect(screen.getByTestId('board-card-wait-case_gemma').textContent).toBe('2 h');
        expect(within(gemma).getByRole('img', { name: 'Draft ready' })).toBe(screen.getByTestId('board-card-draft-case_gemma'));
        expect(gemma.textContent).toBe('Gemma Hallam2 hmoney');

        // A hold no exception raised shows its reason as worded; no working-hours wait from the server falls back to the hold's age.
        expect(screen.getByTestId('board-card-hold-case_rob').textContent).toBe('Guard: a duration');
        expect(screen.getByTestId('board-card-wait-case_rob').textContent).toBe('1h 20m');
        expect(screen.queryByTestId('board-card-draft-case_rob')).toBeNull();

        const tom = screen.getByTestId('board-card-case_tom');
        expect(tom.getAttribute('data-held')).toBeNull();
        expect(tom.className.split(' ')).not.toContain('border-amber-400');
        expect(screen.queryByTestId('board-card-hold-case_tom')).toBeNull();
        expect(within(tom).getByRole('img', { name: 'SMS' })).toBeTruthy();
        expect(tom.textContent).toBe('Tom Ashworth3m ago');

        const priya = screen.getByTestId('board-card-case_reissued');
        expect(within(priya).getByRole('img', { name: 'Email' })).toBeTruthy();
        expect(priya.textContent).toBe('Priya Shah3m ago');

        const board = screen.getByTestId('board-kanban').textContent ?? '';
        for (const hidden of ['Hi, can I get a quote?', 'Bath reseal', 'NG2', 'need photo', 'reissued', 'no session slot']) expect(board).not.toContain(hidden);

        expect(screen.getByTestId('board-counts').textContent).toBe('4 open files · 2 held');
        expect(screen.getByTestId('board-column-quoted').textContent).toContain('Quoted2');
        expect(screen.getByTestId('board-column-done').textContent).toContain('Nothing in Done');
    });

    it('renders full screen under the slim header: the logo, the quick links and the view toggle', async () => {
        stubViewport(true);
        mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ json: boardOf([TOM]) }) }]);
        renderWithQuery(<CommsV2BoardPage />);
        await screen.findByTestId('board-card-case_tom');

        expect(screen.getByTestId('comms-board').className.split(' ')).toContain('h-dvh');
        const header = within(screen.getByRole('banner'));
        expect(header.getByTestId('comms-board-logo')).toHaveAttribute('alt', 'Handy Services');
        expect(header.getByRole('heading', { name: 'Comms board' })).toBeTruthy();
        expect(header.getByTestId('topbar-link-handy-desk-desk')).toHaveAttribute('href', '/admin/handy-desk');
        expect(header.getByTestId('topbar-link-diary-desk')).toHaveAttribute('aria-disabled', 'true');
        expect(header.getByTestId('topbar-link-comms-board-desk')).toHaveAttribute('href', '/admin/comms-v2');
        expect(header.getByTestId('board-view-toggle')).toBeTruthy();
    });

    it('toggles Kanban to Floor over the same response: one token per file in seven bays, held ones ringed with their age, a token opening the thread', async () => {
        stubViewport(true);
        const user = userEvent.setup();
        const fetchMock = mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: boardOf([GEMMA, ROB, TOM]) }) },
            { url: '/api/comms-v2/case-files/case_gemma', reply: () => ({ json: detail('case_gemma', 'Gemma Hallam', true) }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await screen.findByTestId('board-kanban');
        const boardReads = fetchMock.of('GET', '/api/comms-v2/board').length;

        await user.click(within(screen.getByTestId('board-view-toggle')).getByRole('button', { name: 'Floor' }));
        expect(screen.queryByTestId('board-kanban')).toBeNull();
        expect(screen.getByTestId('board-floor')).toBeTruthy();
        for (const stage of STAGES) expect(screen.getByTestId(`floor-bay-${stage}`)).toBeTruthy();
        expect(screen.getByTestId('floor-bay-scoping').textContent).toContain('Scoping · 2');
        expect(within(screen.getByTestId('floor-bay-quoted')).getByTestId('floor-token-case_tom').textContent).toContain('Tom A.');

        const gemmaToken = screen.getByTestId('floor-token-case_gemma');
        expect(gemmaToken.getAttribute('data-held')).toBe('true');
        expect(gemmaToken.textContent).toContain('GH');
        expect(gemmaToken.textContent).toContain('held 2 h');
        expect(within(gemmaToken).getByRole('img', { name: 'Draft ready' })).toBeTruthy();
        expect(gemmaToken.getAttribute('title')).toBe('Gemma Hallam');
        expect(screen.getByTestId('floor-token-case_tom').getAttribute('data-held')).toBeNull();
        // The Floor is a re-render, not a second read.
        expect(fetchMock.of('GET', '/api/comms-v2/board').length).toBe(boardReads);

        await user.click(gemmaToken);
        await screen.findByText('Gemma Hallam wrote in');
        expect(within(screen.getByTestId('thread-panel')).getByLabelText('Your reply to the customer')).toBeTruthy();

        await user.click(within(screen.getByTestId('board-view-toggle')).getByRole('button', { name: 'Kanban' }));
        expect(screen.getByTestId('board-kanban')).toBeTruthy();
        expect(screen.queryByTestId('board-floor')).toBeNull();
    });

    it('Held only asks the server for held files, and with none held offers to show all files again', async () => {
        stubViewport(true);
        const user = userEvent.setup();
        const fetchMock = mockFetch([
            { url: '/api/comms-v2/board?held=true', reply: () => ({ json: boardOf([]) }) },
            { url: '/api/comms-v2/board', reply: () => ({ json: boardOf([TOM]) }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await screen.findByTestId('board-card-case_tom');

        await user.click(screen.getByRole('button', { name: /held only/i }));
        const empty = await screen.findByTestId('board-empty-held');
        expect(empty.textContent).toContain('Nothing is waiting on you');
        expect(fetchMock.of('GET', '/api/comms-v2/board?held=true').length).toBe(1);
        expect(screen.getByRole('button', { name: /held only/i }).getAttribute('aria-pressed')).toBe('true');

        await user.click(within(empty).getByRole('button', { name: 'Show all files' }));
        await screen.findByTestId('board-card-case_tom');
        expect(screen.getByRole('button', { name: /held only/i }).getAttribute('aria-pressed')).toBe('false');
    });

    it('a filter change dims the previous board while it loads, and a failed fetch never shows the previous filter\'s cards', async () => {
        stubViewport(true);
        const user = userEvent.setup();
        let fail!: () => void;
        const gate = new Promise<void>((r) => { fail = r; });
        mockFetch([
            { url: '/api/comms-v2/board?held=true', reply: async () => { await gate; return { status: 500, json: { error: 'boom' } }; } },
            { url: '/api/comms-v2/board', reply: () => ({ json: boardOf([TOM]) }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        await screen.findByTestId('board-card-case_tom');
        expect(screen.getByTestId('board-body').getAttribute('aria-busy')).toBeNull();

        await user.click(screen.getByRole('button', { name: /held only/i }));
        // While the held board loads, the unfiltered one stays but reads as stale.
        await waitFor(() => expect(screen.getByTestId('board-body').getAttribute('aria-busy')).toBe('true'));
        expect(screen.getByTestId('board-body').className).toContain('opacity-60');

        fail();
        const banner = await screen.findByTestId('board-error');
        expect(screen.getByTestId('board-body').getAttribute('aria-busy')).toBeNull();
        expect(screen.queryByTestId('board-card-case_tom')).toBeNull();
        expect(banner.textContent).not.toContain('last good copy');
        expect(screen.getByTestId('board-counts').textContent).toBe('…');
        expect(screen.getByRole('button', { name: /held only/i }).getAttribute('aria-pressed')).toBe('true');
    });

    it('an empty board says no open files, not the held-filter message', async () => {
        stubViewport(true);
        mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ json: boardOf([]) }) }]);
        renderWithQuery(<CommsV2BoardPage />);
        expect((await screen.findByTestId('board-empty')).textContent).toContain('No open files');
        expect(screen.queryByTestId('board-empty-held')).toBeNull();
        expect(screen.getByTestId('board-counts').textContent).toBe('0 open files · 0 held');
    });

    it('shows the skeleton only while the first fetch is out', async () => {
        stubViewport(true);
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        mockFetch([{ url: '/api/comms-v2/board', reply: async () => { await gate; return { json: boardOf([TOM]) }; } }]);
        renderWithQuery(<CommsV2BoardPage />);
        expect(screen.getByTestId('board-loading')).toBeTruthy();
        release();
        await screen.findByTestId('board-card-case_tom');
        expect(screen.queryByTestId('board-loading')).toBeNull();
    });

    it('a failed refresh keeps the last good copy on screen and Retry now fetches again', async () => {
        stubViewport(true);
        const user = userEvent.setup();
        let fail = false;
        const fetchMock = mockFetch([{ url: '/api/comms-v2/board', reply: () => (fail ? { status: 500, json: { error: 'boom' } } : { json: boardOf([TOM]) }) }]);
        const { client } = renderWithQuery(<CommsV2BoardPage />);
        await screen.findByTestId('board-card-case_tom');

        fail = true;
        await act(async () => { await client.refetchQueries({ queryKey: ['comms-v2-board'] }); });
        const banner = await screen.findByTestId('board-error');
        expect(banner.textContent).toContain("Couldn't load the board");
        expect(banner.textContent).toContain('Showing the last good copy from');
        expect(screen.getByTestId('board-card-case_tom')).toBeTruthy();

        fail = false;
        const before = fetchMock.of('GET', '/api/comms-v2/board').length;
        await user.click(within(banner).getByRole('button', { name: 'Retry now' }));
        await waitFor(() => expect(screen.queryByTestId('board-error')).toBeNull());
        expect(fetchMock.of('GET', '/api/comms-v2/board').length).toBe(before + 1);
    });

    it('a first fetch that fails says so without claiming a last good copy', async () => {
        stubViewport(true);
        mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ status: 500, json: {} }) }]);
        renderWithQuery(<CommsV2BoardPage />);
        const banner = await screen.findByTestId('board-error');
        expect(banner.textContent).not.toContain('last good copy');
        expect(screen.queryByTestId('board-loading')).toBeNull();
    });

    it('with no approver slot the board reads, and an opened file hides Send, Release and Answer', async () => {
        stubViewport(true);
        const user = userEvent.setup();
        mockFetch([
            { url: '/api/comms-v2/board', reply: () => ({ json: boardOf([GEMMA], { viewer: { approver: null, canAct: false } }) }) },
            { url: '/api/comms-v2/case-files/case_gemma', reply: () => ({ json: detail('case_gemma', 'Gemma Hallam', true) }) },
        ]);
        renderWithQuery(<CommsV2BoardPage />);
        expect((await screen.findByTestId('board-read-only')).textContent).toContain('You can read this board but not act on it');

        await user.click(screen.getByTestId('board-card-case_gemma'));
        await screen.findByText('Gemma Hallam wrote in');
        expect(screen.getByTestId('held-reason').textContent).toContain('Asked for a discount');
        expect(screen.getByTestId('hold-draft').textContent).toBe('The held draft');
        expect(screen.queryByLabelText('Your reply to the customer')).toBeNull();
        expect(screen.queryByRole('button', { name: /release hold/i })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send this' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
    });

    it('a session that holds a slot, or a server that does not say, gets no read-only notice', async () => {
        stubViewport(true);
        mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ json: boardOf([TOM], { viewer: undefined }) }) }]);
        renderWithQuery(<CommsV2BoardPage />);
        await screen.findByTestId('board-card-case_tom');
        expect(screen.queryByTestId('board-read-only')).toBeNull();
    });

    it('the mode switch appears only where the sandbox works, and filters the board by mode', async () => {
        stubViewport(true);
        const user = userEvent.setup();
        const fetchMock = mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ json: boardOf([TOM], { sandboxAvailable: true }) }) }]);
        renderWithQuery(<CommsV2BoardPage />);
        const modes = await screen.findByTestId('board-mode-switch');
        expect(within(modes).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');

        await user.click(within(modes).getByRole('button', { name: 'Live' }));
        await waitFor(() => expect(fetchMock.of('GET', '/api/comms-v2/board?mode=live').length).toBe(1));
        await user.click(within(modes).getByRole('button', { name: 'Sandbox' }));
        await waitFor(() => expect(fetchMock.of('GET', '/api/comms-v2/board?mode=sandbox').length).toBe(1));
    });

    describe('on a phone', () => {
        it('has no Floor and no Held only button, opens on Held across stages, and shows one stage at a time', async () => {
            stubViewport(false);
            const user = userEvent.setup();
            const fetchMock = mockFetch([
                { url: '/api/comms-v2/board', reply: () => ({ json: boardOf([GEMMA, ROB, TOM, card({ id: 'case_done', stage: 'booked', held: true, holdSince: minsAgo(2), holdApprover: 'ben', holdApproverAssigned: true, customerName: 'Marcus Dell' })]) }) },
                { url: '/api/comms-v2/case-files/case_tom', reply: () => ({ json: detail('case_tom', 'Tom Ashworth', false) }) },
            ]);
            renderWithQuery(<CommsV2BoardPage />);
            await screen.findByTestId('board-phone');

            expect(screen.queryByTestId('board-view-toggle')).toBeNull();
            expect(screen.queryByRole('button', { name: /floor/i })).toBeNull();
            expect(screen.queryByTestId('board-floor')).toBeNull();
            expect(screen.queryByTestId('board-kanban')).toBeNull();
            expect(screen.queryByRole('button', { name: /held only/i })).toBeNull();

            const heldChip = screen.getByTestId('phone-chip-held');
            expect(heldChip.textContent).toBe('Held · 3');
            expect(heldChip.getAttribute('aria-selected')).toBe('true');
            const chips = screen.getAllByRole('tab').map((t) => t.getAttribute('data-testid'));
            expect(chips).toEqual(['phone-chip-held', ...STAGES.map((s) => `phone-chip-${s}`)]);

            const heldColumn = screen.getByTestId('phone-column-held');
            expect(screen.getByTestId('board-card-stage-case_gemma').textContent).toBe('Scoping');
            expect(screen.getByTestId('board-card-stage-case_done').textContent).toBe('Booked');
            expect(within(heldColumn).getByTestId('board-card-case_gemma').textContent).not.toContain('Hi, can I get a quote?');
            expect(within(heldColumn).queryByTestId('board-card-case_tom')).toBeNull();

            await user.click(screen.getByTestId('phone-chip-quoted'));
            const quoted = screen.getByTestId('phone-column-quoted');
            expect(within(quoted).getByTestId('board-card-case_tom')).toBeTruthy();
            expect(within(quoted).queryByTestId('board-card-case_gemma')).toBeNull();

            await user.click(screen.getByTestId('phone-chip-done'));
            expect(screen.getByTestId('phone-column-done').textContent).toContain('Nothing in Done');

            await user.click(screen.getByTestId('phone-chip-quoted'));
            await user.click(screen.getByTestId('board-card-case_tom'));
            // A full-screen sheet, not a panel, below 1024px.
            const sheet = await screen.findByRole('dialog');
            expect(sheet.className.split(' ')).toContain('h-dvh');
            await screen.findByText('Tom Ashworth wrote in');
            expect(within(sheet).getByTestId('thread-view-customer')).toHaveAttribute('href', '/admin/clients/phone%3A07700900942');
            expect(screen.queryByTestId('thread-panel')).toBeNull();

            expect(fetchMock.calls.every((c) => !c.url.includes('held=true'))).toBe(true);
        });

        it('opens on the first stage with a file when nothing is held', async () => {
            stubViewport(false);
            mockFetch([{ url: '/api/comms-v2/board', reply: () => ({ json: boardOf([TOM]) }) }]);
            renderWithQuery(<CommsV2BoardPage />);
            await screen.findByTestId('board-phone');
            expect(screen.getByTestId('phone-chip-quoted').getAttribute('aria-selected')).toBe('true');
            expect(screen.getByTestId('phone-chip-held').textContent).toBe('Held · 0');
            expect(within(screen.getByTestId('phone-column-quoted')).getByTestId('board-card-case_tom')).toBeTruthy();
        });
    });
});
