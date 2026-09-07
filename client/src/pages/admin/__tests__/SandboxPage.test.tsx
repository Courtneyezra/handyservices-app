/**
 * T5 vitest (client): the sandbox page's pure parts and the one thing on the screen that must be
 * impossible to misread — the "NOT SENT — dry run" state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';

vi.mock('@/hooks/useCommsEvents', () => ({ useCommsEvents: () => undefined }));

import SandboxPage, { RunDetail, MediaSeen, decisionLabel, pounds, mediaStatusLabel, videoWarning, attachmentsOverBound, WRONG_MOVE_SHAPES, MAX_ATTACHMENTS, ACCEPT_MEDIA, type SandboxRun, type SandboxState, type SandboxMediaReport, type SandboxVideoStatus } from '@/pages/admin/SandboxPage';

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
        // The GET keeps answering with the EMPTY thread: the page must paint the POST's own
        // `state` (the thread as it now stands) rather than wait for a refetch.
        mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: started }) },
            { method: 'POST', url: '/api/comms-sandbox/message', reply: () => ({ json: { ok: true, messageId: 'm1', run: rulesRun, mirrored: { kind: 'first_contact_ack', intent: 'ack_enquiry', body: ackBody, messageId: 'm_ack', note: 'First contact is answered by the rules layer.' }, state: withAck } }) },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        await userEvent.type(screen.getByTestId('sandbox-input'), 'Hi, do you fit extractor fans?');
        await userEvent.click(screen.getByTestId('sandbox-send'));
        await waitFor(() => expect(screen.getByTestId('sandbox-mirrored')).toBeTruthy());
        expect(screen.getByText('Hi, do you fit extractor fans?', { selector: 'div' })).toBeTruthy();
        expect(screen.getByTestId('sandbox-mirrored').textContent).toContain(ackBody);
        await waitFor(() => expect(screen.getByText(/rules layer ack · mirrored · never sent/i)).toBeTruthy());
        expect(screen.getByTestId('sandbox-proposed-bubble').textContent).toContain('first contact');
        expect(screen.getByTestId('sandbox-proposed-bubble').textContent).not.toContain('no reply proposed');
    });
});

// ---------------------------------------------------------------- T11: media in the sandbox

const VIDEO_ON: SandboxVideoStatus = { enabled: true, images: true, maxPerRun: 6, keyPresent: true };
function mediaItem(over: Partial<SandboxMediaReport> = {}): SandboxMediaReport {
    return {
        id: 'msg_sbx_aaaaaaaaaaaaa', kind: 'image', url: '/api/media/msg_sbx_aaaaaaaaaaaaa.jpg',
        description: 'A ceiling extractor fan with a yellowed grille in a tiled bathroom. Defects: fan (moderate: not spinning). (confidence high)',
        status: 'described', note: 'Described on this pass by Gemini. This is the description on the case file; the Scoper\'s case-file summary carries its first 160 characters.',
        vision: { runId: 'run_vis_1', costPence: 1, error: null }, ...over,
    };
}

describe('T11 pure helpers', () => {
    it('mediaStatusLabel: only described/cached are ok; everything else says NOT described or FAILED', () => {
        expect(mediaStatusLabel('described').tone).toBe('ok');
        expect(mediaStatusLabel('cached').tone).toBe('ok');
        for (const s of ['failed', 'off', 'images_off', 'no_key', 'missing'] as const) {
            expect(mediaStatusLabel(s).tone).toBe('bad');
            expect(mediaStatusLabel(s).text).toMatch(/NOT described|FAILED/);
        }
        expect(mediaStatusLabel('over_bound', 6)).toEqual({ text: 'NOT described — over the per-pass bound (only the last 6 are described)', tone: 'warn' });
        expect(mediaStatusLabel('unsupported').tone).toBe('warn');
    });
    it('videoWarning: quiet when on with a key; loud when off, keyless, or photos off', () => {
        expect(videoWarning(VIDEO_ON)).toBeNull();
        expect(videoWarning(undefined)).toBeNull();
        expect(videoWarning({ ...VIDEO_ON, enabled: false })).toMatch(/OFF/);
        expect(videoWarning({ ...VIDEO_ON, keyPresent: false })).toMatch(/GEMINI_API_KEY/);
        expect(videoWarning({ ...VIDEO_ON, images: false })).toMatch(/Photos are not described/);
    });
    it('attachmentsOverBound: the count above maxPerRun, none when description is off', () => {
        expect(attachmentsOverBound(8, VIDEO_ON)).toBe(2);
        expect(attachmentsOverBound(6, VIDEO_ON)).toBe(0);
        expect(attachmentsOverBound(8, { ...VIDEO_ON, enabled: false })).toBe(0);
        expect(attachmentsOverBound(8, null)).toBe(0);
    });
    it('the picker mirrors the server bounds: 8 files, photos and videos only', () => {
        expect(MAX_ATTACHMENTS).toBe(8);
        expect(ACCEPT_MEDIA.split(',')).toContain('image/jpeg');
        expect(ACCEPT_MEDIA.split(',')).toContain('video/mp4');
        expect(ACCEPT_MEDIA).not.toMatch(/pdf|audio/);
    });
});

describe('<MediaSeen> — the description is shown next to the reply, and its absence is loud', () => {
    it('a described item shows the text the Scoper read, the pill, the vision cost', () => {
        render(<MediaSeen media={[mediaItem()]} video={VIDEO_ON} />);
        expect(screen.getByTestId('sandbox-media-seen').textContent).toContain('1 of 1 described');
        expect(screen.getByTestId('sandbox-media-description').textContent).toContain('ceiling extractor fan');
        expect(screen.getByText(/Described — on the case file the Scoper read/)).toBeTruthy();
        expect(screen.getByText(/run_vis_1/).parentElement?.textContent).toContain('£0.01');
        expect(screen.queryByTestId('sandbox-media-missing')).toBeNull();
        expect(document.querySelector('img[src="/api/media/msg_sbx_aaaaaaaaaaaaa.jpg"]')).toBeTruthy();
    });
    it('a failed item is red, says FAILED, and carries the error — never silently blank', () => {
        render(<MediaSeen media={[mediaItem({ description: null, status: 'failed', note: 'Description FAILED on this pass. Error: no description (see describe_video log)', vision: { runId: 'run_vis_2', costPence: null, error: 'no description (see describe_video log)' } })]} video={VIDEO_ON} />);
        const missing = screen.getByTestId('sandbox-media-missing');
        expect(missing.textContent).toContain('No description.');
        expect(missing.textContent).toContain('FAILED');
        expect(missing.className).toContain('red');
        expect(screen.getByText(/DESCRIPTION FAILED/)).toBeTruthy();
        expect(screen.getByTestId('sandbox-media-seen').textContent).toContain('0 of 1 described');
    });
    it('over the bound: the earlier item says which bound dropped it, the later one is described', () => {
        render(<MediaSeen media={[
            mediaItem({ id: 'msg_sbx_0000000000000', description: null, status: 'over_bound', note: 'NOT described: outside the per-pass bound.', vision: null }),
            mediaItem(),
        ]} video={VIDEO_ON} />);
        const items = screen.getAllByTestId('sandbox-media-item');
        expect(items).toHaveLength(2);
        expect(items[0].getAttribute('data-status')).toBe('over_bound');
        expect(items[0].textContent).toContain('only the last 6 are described');
        expect(items[1].getAttribute('data-status')).toBe('described');
        expect(screen.getByTestId('sandbox-media-seen').textContent).toContain('1 of 2 described');
    });
    it('off and no key are named as such', () => {
        render(<MediaSeen media={[mediaItem({ description: null, status: 'off', note: 'NOT described: spine.video.enabled is off.', vision: null })]} video={{ ...VIDEO_ON, enabled: false }} />);
        expect(screen.getByText(/description is OFF on this server/)).toBeTruthy();
    });
    it('a video renders as a video element', () => {
        render(<MediaSeen media={[mediaItem({ kind: 'video', url: '/api/media/msg_sbx_bbbbbbbbbbbbb.mp4' })]} video={VIDEO_ON} />);
        expect(document.querySelector('video[src="/api/media/msg_sbx_bbbbbbbbbbbbb.mp4"]')).toBeTruthy();
    });
});

describe('<RunDetail> with media', () => {
    it('shows What the desk saw between the reply and the triage fields; nothing when the pass had no media', () => {
        render(<RunDetail run={run({ media: [mediaItem()], video: VIDEO_ON })} />);
        expect(screen.getByTestId('sandbox-media-seen')).toBeTruthy();
        expect(screen.getByTestId('sandbox-media-description').textContent).toContain('extractor fan');
    });
    it('no media on the pass: no section', () => {
        render(<RunDetail run={run({ media: [] })} />);
        expect(screen.queryByTestId('sandbox-media-seen')).toBeNull();
    });
});

describe('<SandboxPage> with attachments', () => {
    const started: SandboxState = {
        phone: { e164: '+447700900942', wa: '447700900942@c.us' }, quote: null, runs: [], messages: [],
        conversation: { id: 'sbx-1', stage: 'enquiry', tags: ['sandbox'], contactName: 'Sandbox customer (not real)', createdAt: '2026-09-06T10:00:00Z', hasTrigger: false },
        video: VIDEO_ON,
    };
    const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3])], 'fan.jpg', { type: 'image/jpeg' });

    it('attaching a photo posts multipart to the same parameterless url, with the text as the caption; the sent bubble shows it', async () => {
        const withMedia: SandboxState = {
            ...started,
            messages: [{ id: 'msg_sbx_aaaaaaaaaaaaa', direction: 'inbound', content: 'The fan has died', createdAt: '2026-09-06T10:00:01Z', senderName: 'Sandbox customer (not real)', type: 'image', mediaUrl: '/api/media/msg_sbx_aaaaaaaaaaaaa.jpg', mediaType: 'image/jpeg' }],
        };
        const { fn, calls } = mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: started }) },
            { method: 'POST', url: '/api/comms-sandbox/message', reply: () => ({ json: { ok: true, messageId: 'msg_sbx_aaaaaaaaaaaaa', run: run(), media: [mediaItem()], video: VIDEO_ON, state: withMedia } }) },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        await userEvent.upload(screen.getByTestId('sandbox-file-input'), photo());
        await waitFor(() => expect(screen.getAllByTestId('sandbox-attachment')).toHaveLength(1));
        expect(screen.getByTestId('sandbox-attachments').textContent).toContain('fan.jpg');
        await userEvent.type(screen.getByTestId('sandbox-input'), 'The fan has died');
        await userEvent.click(screen.getByTestId('sandbox-send'));
        await waitFor(() => expect(screen.getByTestId('sandbox-run-detail')).toBeTruthy());

        const post = calls.find((c) => c.method === 'POST');
        expect(post?.url).toBe('/api/comms-sandbox/message');
        expect(post?.url).not.toMatch(/sbx-1/);
        const init = fn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')?.[1] as RequestInit;
        expect(init.body).toBeInstanceOf(FormData);
        const form = init.body as FormData;
        expect(form.get('text')).toBe('The fan has died');
        expect(form.getAll('media')).toHaveLength(1);
        expect((form.get('media') as File).name).toBe('fan.jpg');
        expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();

        // The sent bubble carries the stored photo; the detail carries what the desk saw; the picker is clear.
        await waitFor(() => expect(screen.getByTestId('sandbox-bubble-media')).toBeTruthy());
        expect(screen.getByTestId('sandbox-media-seen')).toBeTruthy();
        expect(screen.getByTestId('sandbox-media-description').textContent).toContain('extractor fan');
        expect(screen.queryByTestId('sandbox-attachments')).toBeNull();
    });

    it('a photo alone can be sent; text alone still goes as JSON', async () => {
        const { fn, calls } = mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: started }) },
            { method: 'POST', url: '/api/comms-sandbox/message', reply: () => ({ json: { ok: true, messageId: 'm1', run: run(), state: started } }) },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        expect((screen.getByTestId('sandbox-send') as HTMLButtonElement).disabled).toBe(true);
        await userEvent.upload(screen.getByTestId('sandbox-file-input'), photo());
        await waitFor(() => expect((screen.getByTestId('sandbox-send') as HTMLButtonElement).disabled).toBe(false));
        await userEvent.click(screen.getByTestId('sandbox-send'));
        await waitFor(() => expect(screen.getByTestId('sandbox-run-detail')).toBeTruthy());
        const first = fn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')?.[1] as RequestInit;
        expect(first.body).toBeInstanceOf(FormData);
        expect((first.body as FormData).get('text')).toBe('');

        await userEvent.type(screen.getByTestId('sandbox-input'), 'just words');
        await userEvent.click(screen.getByTestId('sandbox-send'));
        await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
        expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({ text: 'just words' });
    });

    it('more than maxPerRun attached: says which will not be described; removing one clears it', async () => {
        mockFetch([{ method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: { ...started, video: { ...VIDEO_ON, maxPerRun: 2 } } }) }]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        await userEvent.upload(screen.getByTestId('sandbox-file-input'), [photo(), photo(), photo()]);
        await waitFor(() => expect(screen.getAllByTestId('sandbox-attachment')).toHaveLength(3));
        expect(screen.getByTestId('sandbox-over-bound').textContent).toContain('Only the last 2 will be described');
        expect(screen.getByTestId('sandbox-over-bound').textContent).toContain('the first 1 will reach the desk as bare media');
        await userEvent.click(screen.getAllByLabelText(/remove fan.jpg/)[0]);
        await waitFor(() => expect(screen.getAllByTestId('sandbox-attachment')).toHaveLength(2));
        expect(screen.queryByTestId('sandbox-over-bound')).toBeNull();
    });

    it('description off, or no key: the composer warns before anything is sent', async () => {
        mockFetch([{ method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: { ...started, video: { ...VIDEO_ON, keyPresent: false } } }) }]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect(screen.getByTestId('sandbox-video-warning')).toBeTruthy());
        expect(screen.getByTestId('sandbox-video-warning').textContent).toContain('GEMINI_API_KEY');
    });

    it('reset clears the pending attachments', async () => {
        mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: started }) },
            { method: 'POST', url: '/api/comms-sandbox/reset', reply: () => ({ json: { ok: true, state: started } }) },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        await userEvent.upload(screen.getByTestId('sandbox-file-input'), photo());
        await waitFor(() => expect(screen.getAllByTestId('sandbox-attachment')).toHaveLength(1));
        await userEvent.click(screen.getByTestId('sandbox-reset'));
        await waitFor(() => expect(screen.queryByTestId('sandbox-attachments')).toBeNull());
    });

    // T13: the owner's browser. Chrome's file input hands React a LIVE FileList, and `addFiles`
    // clears the input's value straight after enqueuing the state update so the same photo can be
    // picked again — which empties that list (measured in Chrome: length 1 → 0). React runs a
    // state updater lazily whenever the component has any other update pending (the sandbox page
    // nearly always does: the events stream, the query polling), so an updater that reads the
    // list at run time read [] and nothing was attached. The typed character below stands in for
    // that pending update and makes the deferral deterministic; the value setter is Chrome's.
    it('T13: the picked file survives the input being cleared, even when React defers the updater', async () => {
        mockFetch([{ method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: started }) }]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        const input = screen.getByTestId('sandbox-file-input') as HTMLInputElement;
        const live: { length: number; 0?: File; item: (i: number) => File | null } = { length: 1, 0: photo(), item: (i) => (i === 0 ? live[0] ?? null : null) };
        Object.defineProperty(input, 'files', { configurable: true, get: () => live });
        Object.defineProperty(input, 'value', {
            configurable: true,
            get: () => (live.length ? 'C:\\fakepath\\fan.jpg' : ''),
            set: (v: string) => { if (v === '') { live.length = 0; delete live[0]; } },
        });
        await act(async () => {
            fireEvent.input(screen.getByTestId('sandbox-input'), { target: { value: 'H' } });
            fireEvent.change(input);
        });
        await waitFor(() => expect(screen.getAllByTestId('sandbox-attachment')).toHaveLength(1));
        expect(screen.getByTestId('sandbox-attachments').textContent).toContain('fan.jpg');
        expect(input.value).toBe(''); // still cleared, so the same photo can be picked twice in a row
        expect((screen.getByTestId('sandbox-send') as HTMLButtonElement).disabled).toBe(false);
    });
});
