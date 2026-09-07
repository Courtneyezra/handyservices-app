/**
 * T5 vitest (client): the sandbox page's pure parts and the one thing on the screen that must be
 * impossible to misread — the "NOT SENT — dry run" state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch } from '@test-utils';

vi.mock('@/hooks/useCommsEvents', () => ({ useCommsEvents: () => undefined }));

import SandboxPage, { RunDetail, MediaSeen, EntryDetail, BenNoticeBox, DoorPicker, WindowStrip, FunnelStrip, CallStrip, CallDetail, callVerdictLabel, CALL_DEFAULT_TRANSCRIPT, CALL_MIN_TRANSCRIPT_CHARS, decisionLabel, pounds, mediaStatusLabel, videoWarning, attachmentsOverBound, funnelStep, doorGateNote, outboundLabel, WRONG_MOVE_SHAPES, MAX_ATTACHMENTS, ACCEPT_MEDIA, SANDBOX_DOORS, FUNNEL_STEPS, type SandboxRun, type SandboxState, type SandboxMediaReport, type SandboxVideoStatus, type SandboxGates, type EntryReport, type BenNotice, type WindowReport, type SandboxCallReport } from '@/pages/admin/SandboxPage';

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
        expect(post?.body).toEqual({ text: "That's a lot more than I was expecting", channel: 'whatsapp' });
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
    it('T14 videoWarning: a failing describer names the reason, says it will not clear on its own, and a healthy one is quiet', () => {
        const health = { status: 'failing' as const, failing: true, permanent: true, reason: 'config: gemini 404: This model models/gemini-2.5-flash is no longer available to new users.', since: '2026-09-06T17:02:00.000Z', lastAt: '2026-09-07T21:10:00.000Z', window: { runs: 20, failed: 20, described: 0 } };
        const w = videoWarning({ ...VIDEO_ON, health });
        expect(w).toMatch(/Every description is FAILING since/);
        expect(w).toMatch(/configuration failure that will not clear on its own/);
        expect(w).toMatch(/gemini 404: This model models\/gemini-2\.5-flash/);
        const transient = videoWarning({ ...VIDEO_ON, health: { ...health, permanent: false, reason: 'transient: timed out after 60000 ms', window: { runs: 3, failed: 3, described: 0 } } });
        expect(transient).toMatch(/3 of the last 3 vision runs failed/);
        expect(videoWarning({ ...VIDEO_ON, health: { ...health, status: 'ok', failing: false, permanent: false, reason: null, since: null } })).toBeNull();
        expect(videoWarning({ ...VIDEO_ON, health: null })).toBeNull();
        // The switch and the key still come first: a failing describer on a keyless server is the key's line.
        expect(videoWarning({ ...VIDEO_ON, keyPresent: false, health })).toMatch(/GEMINI_API_KEY/);
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
        expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({ text: 'just words', channel: 'whatsapp' });
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

// ---------------------------------------------------------------- T16: the four doors, the window, the funnel

const GATES_ON: SandboxGates = {
    firstContactAck: { enabled: true, channels: ['whatsapp', 'sms', 'webform', 'post_call'], askForMedia: false },
    postCallContinuation: { enabled: true }, spineEnabled: true, smsSenderConfigured: true,
    templates: [{ name: 'web_enquiry_ack_context', status: 'approved' }, { name: 'post_call_continuation', status: 'approved' }, { name: 'post_call_continuation_generic', status: 'approved' }, { name: 'quote_ready_link', status: 'pending' }],
};
const GATES_OFF: SandboxGates = { firstContactAck: { enabled: false, channels: [], askForMedia: false }, postCallContinuation: { enabled: false }, spineEnabled: false, smsSenderConfigured: false, templates: [] };
const WINDOW_OPEN: WindowReport = { canFreeform: true, lastWhatsAppInboundAt: '2026-09-07T10:00:00Z', hoursSince: 0.2, channelLastUsed: 'whatsapp', summary: 'OPEN — last customer WhatsApp 12 min ago; shuts 23.8 h from now', permits: 'We may write freely on WhatsApp.' };
const WINDOW_SHUT: WindowReport = { canFreeform: false, lastWhatsAppInboundAt: null, hoursSince: null, channelLastUsed: 'webchat', summary: 'SHUT — last customer WhatsApp never', permits: 'Only an approved Meta template may go on WhatsApp; a freeform draft would be refused (63016). SMS has no window.' };
const NOTICE: BenNotice = { event: 'quote_prep_ready', title: '💷 Quote ready to price: Priya Shah', message: 'Priya Shah · NG7 2AB\n• Replace bathroom extractor fan\nSuggested total £480 (yours to change).\nNothing has been sent. Open, check, price, send.', link: 'https://handyservices.app/admin/price/abc12345' };
const webformEntry: EntryReport = {
    door: 'webform', meaning: { label: 'Webform', window: 'A form opens no WhatsApp window. It is SHUT until the customer writes on WhatsApp.', firstReply: 'The first-contact ack goes as the first approved template on the ladder.' },
    ack: { door: 'webform', intent: 'ack_enquiry', mode: 'template', channel: 'whatsapp', body: 'Hi Priya, we got your message: "the extractor fan…". Is it OK if we give you a quick call shortly?', templateName: 'web_enquiry_ack_context', rungs: [{ name: 'web_enquiry_ack_context', status: 'approved', picked: true, note: 'approved and fillable: this is what the customer would receive' }, { name: 'call_request', status: 'approved', picked: false, note: 'approved, but a higher rung was picked' }], outOfHours: false, gate: { enabled: true, channelOn: true, askForMedia: false, liveWouldSend: true }, reason: 'window shut: the first approved template on the ladder carries the ack (web_enquiry_ack_context), in Meta\'s approved wording', holdSeconds: [60, 150] },
    postCall: null, mirrored: { messageId: 'm_ack', channel: 'whatsapp', body: 'Hi Priya, we got your message…', sender: 'Sandbox (rules layer ack · template web_enquiry_ack_context · mirrored, never sent)' }, firstRunTrigger: 'inbound_message',
};

describe('T16 pure helpers', () => {
    it('funnelStep reads the state: accepted > quote sent > priced draft > clerk ran > stage', () => {
        const base = { conversation: { id: 'c', stage: 'enquiry', tags: [], contactName: null, createdAt: null, hasTrigger: false }, funnel: { stage: 'enquiry', draft: null, quote: null }, runs: [] } as any;
        expect(funnelStep(base)).toBe('enquiry');
        expect(funnelStep({ ...base, conversation: { ...base.conversation, stage: 'scoping' } })).toBe('scoping');
        expect(funnelStep({ ...base, runs: [{ id: 'r', agent: 'quote_clerk', lane: 'quote_clerk' }] })).toBe('clerk');
        expect(funnelStep({ ...base, funnel: { stage: 'scoping', draft: { id: 'q', slug: 's', lines: [], suggestedTotalPence: 1, checkThis: 0, createdAt: null, customerName: null }, quote: null } })).toBe('priced_draft');
        expect(funnelStep({ ...base, funnel: { stage: 'quote_sent', draft: null, quote: { slug: 's', basePrice: 1, delivered: true, accepted: false, expiresAt: null } } })).toBe('quote_sent');
        expect(funnelStep({ ...base, funnel: { stage: 'won', draft: null, quote: { slug: 's', basePrice: 1, delivered: true, accepted: true, expiresAt: null } } })).toBe('accepted');
        expect(funnelStep(null)).toBe('enquiry');
        expect(FUNNEL_STEPS).toEqual(['enquiry', 'scoping', 'clerk', 'priced_draft', 'quote_sent', 'accepted']);
    });
    it('doorGateNote says what THIS server would do live, per door', () => {
        expect(doorGateNote('whatsapp', GATES_ON)).toMatchObject({ tone: 'ok' });
        expect(doorGateNote('whatsapp', GATES_OFF).text).toMatch(/OFF/);
        expect(doorGateNote('webform', GATES_ON)).toMatchObject({ tone: 'ok' });
        expect(doorGateNote('webform', { ...GATES_ON, templates: [{ name: 'web_enquiry_ack_context', status: 'pending' }] }).text).toMatch(/pending → falls to the next rung, then SMS/);
        expect(doorGateNote('post_call', GATES_ON).text).toMatch(/spine on: the clerk reads the transcript/);
        expect(doorGateNote('post_call', GATES_OFF).text).toMatch(/NO_APPROVED_TEMPLATE/);
        expect(doorGateNote('sms', GATES_OFF).text).toMatch(/NOT configured/);
        expect(doorGateNote('sms', null).tone).toBe('warn');
        expect(SANDBOX_DOORS).toHaveLength(4);
    });
    it('outboundLabel: the mirror\'s own sender name, dotted; the T5/T6 labels otherwise', () => {
        expect(outboundLabel({ senderName: 'Sandbox (rules layer ack, mirrored, never sent)' })).toBe('rules layer ack · mirrored · never sent');
        expect(outboundLabel({ senderName: 'Sandbox (post-call continuation · template post_call_continuation · mirrored, never sent)' })).toBe('post-call continuation · template post_call_continuation · mirrored · never sent');
        expect(outboundLabel({ senderName: "Sandbox (Ben's send · freeform · mirrored, never sent)" })).toMatch(/^Ben's send · freeform/);
        expect(outboundLabel({ senderName: 'Sandbox (synthetic, never sent)' })).toBe('synthetic · never sent');
        expect(outboundLabel({ senderName: null })).toBe('synthetic · never sent');
    });
});

describe('<EntryDetail> and <BenNoticeBox>', () => {
    it('a webform entry shows the door, the ladder with the picked rung, the gate, and what was placed', () => {
        render(<EntryDetail entry={webformEntry} />);
        const box = screen.getByTestId('sandbox-entry');
        expect(box.textContent).toContain('Door: Webform');
        expect(box.textContent).toContain('SHUT');
        expect(screen.getByTestId('sandbox-ladder').textContent).toContain('web_enquiry_ack_context');
        expect(screen.getByTestId('sandbox-ladder').textContent).toContain('✓ approved and fillable');
        expect(screen.getByTestId('sandbox-entry-gate').textContent).toContain('production sends exactly this, 60 to 150 s after the message');
        expect(box.textContent).toContain('trigger inbound_message');
    });
    it('T19: a whatsapp entry says the customer\'s message opened the window, shows the FREEFORM ack plan and what was placed', () => {
        const entry: EntryReport = {
            door: 'whatsapp', meaning: { label: 'Inbound WhatsApp', window: 'Every customer WhatsApp opens the 24-hour window.', firstReply: 'Their opening message is the event.' },
            firstMessage: 'Hi, my extractor fan has died, NG7 2AB', openedWindow: true, firstRunTrigger: 'inbound_message',
            ack: { door: 'whatsapp', intent: 'ack_enquiry', mode: 'freeform', channel: 'whatsapp', body: 'Hi Sam, thanks for getting in touch.', templateName: null, rungs: [], outOfHours: false, gate: { enabled: true, channelOn: true, askForMedia: false, liveWouldSend: true }, reason: 'window open: the composed ack goes freeform on WhatsApp', holdSeconds: [60, 150] },
            postCall: null, mirrored: { messageId: 'm2', channel: 'whatsapp', body: 'Hi Sam, thanks for getting in touch.', sender: 'Sandbox (rules layer ack, mirrored, never sent)' },
        };
        render(<EntryDetail entry={entry} />);
        const box = screen.getByTestId('sandbox-entry');
        expect(box.textContent).toContain('Door: Inbound WhatsApp');
        const win = screen.getByTestId('sandbox-entry-window');
        expect(win.textContent).toContain('opened the 24 h window');
        expect(win.textContent).toContain('Hi, my extractor fan has died, NG7 2AB');
        expect(win.className).toContain('emerald');
        expect(screen.getByTestId('sandbox-entry-ack').textContent).toContain('FREEFORM by whatsapp');
        expect(screen.queryByTestId('sandbox-ladder')).toBeNull();
        expect(screen.getByTestId('sandbox-entry-gate').textContent).toContain('ON for whatsapp');
        expect(box.textContent).toContain('Placed on the thread as');
        expect(screen.queryByTestId('sandbox-entry-nothing')).toBeNull();
        expect(box.textContent).toContain('trigger inbound_message');
    });
    it('T19: a whatsapp entry whose pass did not reach first contact says nothing was placed, and why to read the run', () => {
        render(<EntryDetail entry={{ door: 'whatsapp', meaning: { label: 'Inbound WhatsApp', window: 'w', firstReply: 'f' }, firstMessage: 'BUY CHEAP WATCHES', openedWindow: true, firstRunTrigger: 'inbound_message', ack: null, postCall: null, mirrored: null }} />);
        expect(screen.getByTestId('sandbox-entry-nothing').textContent).toMatch(/did not land on the rules layer's first contact/);
        expect(screen.queryByTestId('sandbox-entry-ack')).toBeNull();
    });
    it('a post-call entry with no approved template says NOTHING can send, and the gate says so', () => {
        const entry: EntryReport = {
            door: 'post_call', meaning: { label: 'Post-call, WhatsApp agreed on the phone', window: 'A phone call never opens the WhatsApp window.', firstReply: 'x' }, ack: null, mirrored: null, firstRunTrigger: 'call_ended',
            postCall: { route: { send: true, reason: 'AGREED_ON_CALL', callbackDue: false, tagNoAutoMessages: false, complaintAlert: false }, body: null, templateName: null, variables: {}, rungs: [{ name: 'post_call_continuation', status: 'pending', picked: false, note: 'pending with Meta: cannot send' }, { name: 'post_call_continuation_generic', status: 'missing', picked: false, note: 'not in the template cache' }], outcome: 'no_approved_template', reason: 'NO_APPROVED_TEMPLATE: nothing sends; the thread waits for Ben.', approval: 'auto_first_contact', gate: { continuationEnabled: true, ackEnabled: true, ackChannelOn: true, liveWouldSend: false }, spineRun: 'call_ended', spineRunReason: 'answered call with a transcript: the ladder asks the spine for a call_ended run', call: { id: 'c1', preview: 'Inbound call (4m 10s), job enquiry: the fan; WhatsApp agreed', durationSeconds: 250, transcriptChars: 420 } },
        };
        render(<EntryDetail entry={entry} />);
        expect(screen.getByTestId('sandbox-entry-call').textContent).toContain('NO APPROVED TEMPLATE — nothing can send');
        expect(screen.getByTestId('sandbox-entry-nothing').textContent).toContain('the customer would have received nothing');
        expect(screen.getByTestId('sandbox-entry-gate').textContent).toContain('nothing would go live');
    });
    it('the Ben notice is red, says NOT sent, and carries the title, the lines and the link', () => {
        render(<BenNoticeBox notice={NOTICE} when="Route A, after the clerk" />);
        const box = screen.getByTestId('sandbox-ben-notice');
        expect(box.className).toContain('rose');
        expect(box.textContent).toContain("Ben's phone would have buzzed — NOT sent");
        expect(box.textContent).toContain('💷 Quote ready to price: Priya Shah');
        expect(box.textContent).toContain('Suggested total £480');
        expect(box.textContent).toContain('/admin/price/abc12345');
    });
    it('<RunDetail> says which tags the pass put on the thread and that the clerk runs next', () => {
        render(<RunDetail run={run({ tagsAdded: ['needs_quote'] })} />);
        expect(screen.getByTestId('sandbox-tags-added').textContent).toContain('needs_quote');
        expect(screen.getByTestId('sandbox-tags-added').textContent).toContain('Run a clock pass');
    });
    it('<RunDetail> with a sandbox Route A outcome shows the notice and the draft, and the job pack as recorded', () => {
        render(<RunDetail run={run({ routeA: { ran: true, draftSlug: 'abc12345', estimateId: 'est_1', checkThis: 1, sandbox: { benNotice: NOTICE, jobPack: { lines: 2, estimateLines: 2, quoteId: 'quote_1' }, logs: ['Route A: draft abc12345 from estimate est_1 (2 lines, 1 check_this)'] } } })} />);
        expect(screen.getByTestId('sandbox-ben-notice')).toBeTruthy();
        const ra = screen.getByTestId('sandbox-route-a');
        expect(ra.textContent).toContain('abc12345');
        expect(ra.textContent).toContain('recorded, not written');
        expect(ra.textContent).toContain('Ben prices and sends');
    });
});

describe('<DoorPicker>, <WindowStrip>, <FunnelStrip>', () => {
    it('picking a door and opening it posts the door, name and text to the parameterless /start', async () => {
        const onStart = vi.fn();
        render(<DoorPicker gates={GATES_ON} busy={false} hasThread={false} onStart={onStart} />);
        await userEvent.click(screen.getByTestId('sandbox-door-webform'));
        expect(screen.getByTestId('sandbox-door-gate').textContent).toContain('Ack ON for webform');
        expect((screen.getByTestId('sandbox-start-name') as HTMLInputElement).value).toBe('Priya Shah');
        await userEvent.clear(screen.getByTestId('sandbox-start-text'));
        await userEvent.type(screen.getByTestId('sandbox-start-text'), 'My gate has come off its hinge');
        await userEvent.click(screen.getByTestId('sandbox-start'));
        expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ door: 'webform', name: 'Priya Shah', text: 'My gate has come off its hinge' }));
    });
    it('the post-call door exposes the job phrase, the consent and a transcript', async () => {
        const onStart = vi.fn();
        render(<DoorPicker gates={GATES_ON} busy={false} hasThread={false} onStart={onStart} />);
        await userEvent.click(screen.getByTestId('sandbox-door-post_call'));
        expect(screen.getByTestId('sandbox-start-jobphrase')).toBeTruthy();
        await userEvent.selectOptions(screen.getByTestId('sandbox-start-agreed'), 'declined');
        await userEvent.click(screen.getByTestId('sandbox-start'));
        expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ door: 'post_call', whatsappAgreed: 'declined', jobPhrase: 'the bathroom extractor fan' }));
    });
    it('T19: the whatsapp door asks for the customer\'s opening message, empty by default, and cannot open without it', async () => {
        const onStart = vi.fn();
        render(<DoorPicker gates={GATES_ON} busy={false} hasThread={false} onStart={onStart} />);
        // whatsapp is the default door: the box is there, empty, and Open is disabled.
        const box = screen.getByTestId('sandbox-start-text') as HTMLTextAreaElement;
        expect(box.value).toBe('');
        expect(box.placeholder).toMatch(/What would the customer send first/);
        expect(screen.getByText(/Their opening WhatsApp message, in your own words/)).toBeTruthy();
        expect(screen.queryByText(/A clean thread/)).toBeNull();
        expect((screen.getByTestId('sandbox-start') as HTMLButtonElement).disabled).toBe(true);
        await userEvent.type(box, 'Hi, my extractor fan has died, NG7 2AB');
        expect((screen.getByTestId('sandbox-start') as HTMLButtonElement).disabled).toBe(false);
        await userEvent.click(screen.getByTestId('sandbox-start'));
        expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ door: 'whatsapp', name: 'Sam', text: 'Hi, my extractor fan has died, NG7 2AB' }));
        // Switching to the webform door keeps its seeded enquiry; switching back to whatsapp does not invent one.
        await userEvent.click(screen.getByTestId('sandbox-door-webform'));
        expect((screen.getByTestId('sandbox-start-text') as HTMLTextAreaElement).value).toMatch(/extractor fan in our bathroom/);
        await userEvent.click(screen.getByTestId('sandbox-door-whatsapp'));
        expect((screen.getByTestId('sandbox-start-text') as HTMLTextAreaElement).value).toBe('');
    });
    it('the window strip reads open/shut in the case file\'s words and offers the two honest controls', async () => {
        const onAge = vi.fn(); const onClock = vi.fn();
        const { unmount } = render(<WindowStrip window={WINDOW_SHUT} busy={false} onAge={onAge} onClock={onClock} />);
        expect(screen.getByTestId('sandbox-window').textContent).toContain('SHUT — last customer WhatsApp never');
        expect(screen.getByTestId('sandbox-window').textContent).toContain('Only an approved Meta template');
        expect(screen.getByTestId('sandbox-window').className).toContain('amber');
        await userEvent.click(screen.getByTestId('sandbox-age'));
        expect(onAge).toHaveBeenCalledWith(25);
        await userEvent.click(screen.getByTestId('sandbox-clock'));
        expect(onClock).toHaveBeenCalled();
        unmount();
        render(<WindowStrip window={WINDOW_OPEN} busy={false} onAge={onAge} onClock={onClock} />);
        expect(screen.getByTestId('sandbox-window').className).toContain('emerald');
        expect(screen.getByTestId('sandbox-window').textContent).toContain('OPEN');
    });
    it('the funnel strip highlights the step and enables Ben\'s send only with a draft, the acceptance only with a delivered quote', async () => {
        const onPrice = vi.fn(); const onAccept = vi.fn();
        const withDraft = { conversation: { id: 'c', stage: 'scoping', tags: [], contactName: 'Priya', createdAt: null, hasTrigger: false }, runs: [], funnel: { stage: 'scoping', draft: { id: 'q', slug: 'abc12345', lines: ['Replace fan'], suggestedTotalPence: 48_000, checkThis: 1, createdAt: null, customerName: 'Priya' }, quote: null } } as any;
        const { unmount } = render(<FunnelStrip state={withDraft} busy={false} onPrice={onPrice} onAccept={onAccept} amount="" setAmount={() => {}} />);
        expect(screen.getByTestId('sandbox-funnel-priced_draft').getAttribute('aria-current')).toBe('step');
        expect(screen.getByTestId('sandbox-funnel-draft').textContent).toContain('NOT in Ben\'s price queue');
        expect((screen.getByTestId('sandbox-price') as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByTestId('sandbox-accept') as HTMLButtonElement).disabled).toBe(true);
        await userEvent.click(screen.getByTestId('sandbox-price'));
        expect(onPrice).toHaveBeenCalled();
        unmount();
        const sent = { ...withDraft, funnel: { stage: 'quote_sent', draft: null, quote: { slug: 'abc12345', basePrice: 48_000, delivered: true, accepted: false, expiresAt: null } } };
        render(<FunnelStrip state={sent} busy={false} onPrice={onPrice} onAccept={onAccept} amount="" setAmount={() => {}} />);
        expect(screen.getByTestId('sandbox-funnel-quote_sent').getAttribute('aria-current')).toBe('step');
        expect((screen.getByTestId('sandbox-price') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('sandbox-accept') as HTMLButtonElement).disabled).toBe(false);
    });
    it('a priced-but-undelivered quote says the window was shut and how to reopen it', () => {
        const undelivered = { conversation: { id: 'c', stage: 'scoping', tags: [], contactName: null, createdAt: null, hasTrigger: false }, runs: [], funnel: { stage: 'scoping', draft: null, quote: { slug: 'abc12345', basePrice: 48_000, delivered: false, accepted: false, expiresAt: null } } } as any;
        render(<FunnelStrip state={undelivered} busy={false} onPrice={() => {}} onAccept={() => {}} amount="" setAmount={() => {}} />);
        expect(screen.getByTestId('sandbox-funnel-undelivered').textContent).toContain('NOT with the customer');
        expect((screen.getByTestId('sandbox-price') as HTMLButtonElement).disabled).toBe(false);
    });
});

describe('<SandboxPage> T16 wiring', () => {
    const started: SandboxState = {
        phone: { e164: '+447700900942', wa: '447700900942@c.us' }, quote: null, runs: [], messages: [], video: VIDEO_ON,
        conversation: { id: 'sbx-1', stage: 'enquiry', tags: ['sandbox'], contactName: 'Priya Shah', createdAt: '2026-09-07T10:00:00Z', hasTrigger: false },
        door: 'webform', entry: webformEntry, events: [{ at: '2026-09-07T10:00:01Z', kind: 'entry', summary: 'Opened through Webform: ack template (web_enquiry_ack_context) by whatsapp' }], window: WINDOW_SHUT, gates: GATES_ON, funnel: { stage: 'enquiry', draft: null, quote: null },
    };
    it('with no thread the doors are offered; opening one posts to /start and paints the entry, the window and the first pass', async () => {
        const empty: SandboxState = { phone: started.phone, conversation: null, messages: [], quote: null, runs: [], gates: GATES_ON };
        const { calls } = mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: empty }) },
            { method: 'POST', url: '/api/comms-sandbox/start', reply: () => ({ json: { ok: true, door: 'webform', entry: webformEntry, run: run({ agent: 'scoper', pack: { id: 'customer.default', version: 1 }, triage: { lane: 'scoper', intent: 'unknown', exceptions: [], tags: [], reasons: ['no rule fired: scoper'], source: 'rules' }, caseFile: { stage: 'enquiry', tags: ['sandbox'], quote: null, window: { canFreeform: false, templateRequired: true } } }), state: started } }) },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect(screen.getByTestId('sandbox-doors')).toBeTruthy());
        await userEvent.click(screen.getByTestId('sandbox-door-webform'));
        await userEvent.click(screen.getByTestId('sandbox-start'));
        await waitFor(() => expect(screen.getByTestId('sandbox-entry')).toBeTruthy());
        const post = calls.find((c) => c.method === 'POST');
        expect(post?.url).toBe('/api/comms-sandbox/start');
        expect(post?.body).toMatchObject({ door: 'webform', name: 'Priya Shah' });
        expect(screen.getByTestId('sandbox-window').textContent).toContain('SHUT');
        expect(screen.getByTestId('sandbox-door-pill').textContent).toBe('Webform');
        expect(screen.getByTestId('sandbox-run-detail')).toBeTruthy();
        expect(screen.getByTestId('sandbox-events').textContent).toContain('Opened through Webform');
        expect(screen.queryByTestId('sandbox-doors')).toBeNull();
    });
    it('the SMS channel posts channel sms, disables Attach, and Fast-forward posts hours to /age', async () => {
        const { calls } = mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: started }) },
            { method: 'POST', url: '/api/comms-sandbox/message', reply: () => ({ json: { ok: true, messageId: 'm1', run: run(), state: started } }) },
            { method: 'POST', url: '/api/comms-sandbox/age', reply: () => ({ json: { ok: true, hours: 25, window: WINDOW_SHUT, state: started } }) },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-input') as HTMLTextAreaElement).disabled).toBe(false));
        await userEvent.click(screen.getByTestId('sandbox-channel-sms'));
        expect((screen.getByTestId('sandbox-attach') as HTMLButtonElement).disabled).toBe(true);
        await userEvent.type(screen.getByTestId('sandbox-input'), 'its the back gutter');
        await userEvent.click(screen.getByTestId('sandbox-send'));
        await waitFor(() => expect(calls.some((c) => c.url.endsWith('/message'))).toBe(true));
        expect(calls.find((c) => c.url.endsWith('/message'))?.body).toEqual({ text: 'its the back gutter', channel: 'sms' });
        await userEvent.click(screen.getByTestId('sandbox-age'));
        await waitFor(() => expect(calls.some((c) => c.url.endsWith('/age'))).toBe(true));
        expect(calls.find((c) => c.url.endsWith('/age'))?.body).toEqual({ hours: 25 });
        await waitFor(() => expect(screen.getByTestId('sandbox-last-action').textContent).toContain('Moved the thread back 25 h'));
    });
    it('Ben prices and sends, then the customer accepts: both parameterless, the acceptance paints the red notice', async () => {
        const withDraft: SandboxState = { ...started, funnel: { stage: 'scoping', draft: { id: 'q1', slug: 'abc12345', lines: ['Replace fan'], suggestedTotalPence: 48_000, checkThis: 0, createdAt: null, customerName: 'Priya' }, quote: null } };
        const sent: SandboxState = { ...started, funnel: { stage: 'quote_sent', draft: null, quote: { slug: 'abc12345', basePrice: 48_000, delivered: true, accepted: false, expiresAt: null } } };
        const accepted: SandboxState = { ...started, funnel: { stage: 'won', draft: null, quote: { slug: 'abc12345', basePrice: 48_000, delivered: true, accepted: true, expiresAt: null } } };
        const { calls } = mockFetch([
            { method: 'GET', url: '/api/comms-sandbox', reply: () => ({ json: withDraft }) },
            { method: 'POST', url: '/api/comms-sandbox/price', reply: () => ({ json: { ok: true, slug: 'abc12345', totalPence: 48_000, source: 'suggested', delivery: { mode: 'freeform', body: 'Hi Priya! Here\'s your quote', templateName: null, reason: 'window open' }, state: sent } }) },
            { method: 'POST', url: '/api/comms-sandbox/accept', reply: () => ({ json: { ok: true, slug: 'abc12345', depositPence: 12_000, notice: { event: 'quote_accepted', title: '🎉 Quote accepted', message: 'Priya Shah — +447700900942\n💷 £120.00 paid (deposit)', link: null }, next: 'Live, the Stripe webhook does exactly this.', state: accepted } }) },
        ]);
        renderWithQuery(<SandboxPage />);
        await waitFor(() => expect((screen.getByTestId('sandbox-price') as HTMLButtonElement).disabled).toBe(false));
        await userEvent.click(screen.getByTestId('sandbox-price'));
        await waitFor(() => expect(screen.getByTestId('sandbox-last-action').textContent).toContain('Ben priced abc12345 at £480.00'));
        expect(calls.find((c) => c.url.endsWith('/price'))?.url).not.toMatch(/q1|sbx-1/);
        await waitFor(() => expect((screen.getByTestId('sandbox-accept') as HTMLButtonElement).disabled).toBe(false));
        await userEvent.click(screen.getByTestId('sandbox-accept'));
        await waitFor(() => expect(screen.getByTestId('sandbox-ben-notice')).toBeTruthy());
        expect(screen.getByTestId('sandbox-ben-notice').textContent).toContain('🎉 Quote accepted');
        expect(screen.getByTestId('sandbox-ben-notice').textContent).toContain('NOT sent');
        expect(screen.getByTestId('sandbox-funnel-accepted').getAttribute('aria-current')).toBe('step');
    });
});

describe('T21: Ben rings them', () => {
    const callReport = (over: Partial<SandboxCallReport> = {}): SandboxCallReport => ({
        callId: 'sbx_call_1', preview: 'Outbound call (2m 5s): Rang the customer back about their enquiry; asked for photos or a video on WhatsApp.',
        durationSeconds: 125, transcriptChars: 520, startedAt: '2026-09-08T10:00:00Z',
        ladder: { kind: 'outbound_answered', ack: null, ackReason: 'outbound call: no customer ack', continuation: false, spineRun: 'call_ended', spineRunReason: 'OUTBOUND_ANSWERED: Ben\'s call has a transcript and clears every outreach rail; the desk resumes from it (call_ended)', record: true, tagNoAutoMessages: false, settleCallback: true },
        liveWouldRun: true, callbackSettled: { tagsCleared: ['callback_requested'], released: false, flagsDismissed: 0 }, tagsBefore: ['sandbox', 'callback_requested'], tagsAfter: ['sandbox'],
        window: { canFreeform: true, lastWhatsAppInboundAt: '2026-09-08T09:40:00Z', hoursSince: 0.4, channelLastUsed: 'whatsapp', summary: 'OPEN — last customer WhatsApp 24 min ago; shuts 23.6 h from now.', permits: 'We may write freely on WhatsApp.' },
        ...over,
    });
    it('callVerdictLabel: handed over in green, refused in amber with the rail named', () => {
        expect(callVerdictLabel(callReport())).toMatchObject({ tone: 'ok' });
        expect(callVerdictLabel(callReport()).text).toContain('handed the thread');
        const refused = callVerdictLabel(callReport({ liveWouldRun: false, ladder: { ...callReport().ladder!, spineRun: null, spineRunReason: 'QUIET_HOURS:22h: inside 21:00 to 8:00 UK' } }));
        expect(refused.tone).toBe('warn');
        expect(refused.text).toContain('NOT handed the thread: QUIET_HOURS:22h');
        expect(callVerdictLabel(callReport({ liveWouldRun: false, ladder: null })).text).toContain('no ladder plan was recorded');
    });
    it('<CallDetail> shows the card line, the verdict, the callback settled, the window still open, and that the pass waits for Ben', () => {
        render(<CallDetail call={callReport()} />);
        expect(screen.getByTestId('sandbox-call-detail').textContent).toContain('Outbound call (2m 5s)');
        expect(screen.getByTestId('sandbox-call-verdict').textContent).toContain('handed the thread');
        expect(screen.getByTestId('sandbox-call-callback').textContent).toContain('callback_requested');
        expect(screen.getByTestId('sandbox-call-callback').textContent).toContain('cleared');
        expect(screen.getByTestId('sandbox-call-window').textContent).toContain('OPEN');
        expect(screen.getByTestId('sandbox-call-detail').textContent).toContain('ours_is_newest');
    });
    it('<CallDetail> on a thread that was not waiting for a call says nothing was settled', () => {
        render(<CallDetail call={callReport({ callbackSettled: null, tagsAfter: [] })} />);
        expect(screen.getByTestId('sandbox-call-callback').textContent).toContain('was not waiting for a call');
    });
    it('<CallStrip> carries the default transcript, disables the button under the ladder\'s bar and without a thread, and posts the transcript', async () => {
        const onCall = vi.fn();
        const { rerender } = render(<CallStrip defaultTranscript={null} busy={false} hasThread={true} onCall={onCall} />);
        const box = screen.getByTestId('sandbox-call-transcript') as HTMLTextAreaElement;
        expect(box.value).toBe(CALL_DEFAULT_TRANSCRIPT);
        expect(CALL_DEFAULT_TRANSCRIPT.length).toBeGreaterThanOrEqual(CALL_MIN_TRANSCRIPT_CHARS);
        const button = screen.getByTestId('sandbox-call-button') as HTMLButtonElement;
        expect(button.disabled).toBe(false);
        fireEvent.click(button);
        expect(onCall).toHaveBeenCalledWith(CALL_DEFAULT_TRANSCRIPT);
        fireEvent.change(box, { target: { value: 'Agent: hi. Customer: hi.' } });
        expect((screen.getByTestId('sandbox-call-button') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('sandbox-call').textContent).toContain(`at least ${CALL_MIN_TRANSCRIPT_CHARS} needed`);
        rerender(<CallStrip defaultTranscript={null} busy={false} hasThread={false} onCall={onCall} />);
        expect((screen.getByTestId('sandbox-call-button') as HTMLButtonElement).disabled).toBe(true);
    });
    it('<CallStrip> prefers the server\'s default transcript when the state carries one', () => {
        render(<CallStrip defaultTranscript="Agent: the server's own default transcript, long enough to clear the bar. Customer: yes." busy={false} hasThread={true} onCall={() => undefined} />);
        expect((screen.getByTestId('sandbox-call-transcript') as HTMLTextAreaElement).value).toContain("the server's own default");
    });
});
