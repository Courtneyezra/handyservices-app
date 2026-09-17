/**
 * Handy Desk B4 - the thread a card tap opens. It reads one case file, shows each turn as a bubble,
 * a media row, a call row or a system rule, and shows the held draft block. "Send this" sends only the
 * draft on screen, as `expectedDraft`. Ben's own words go to answer and release. A shut window
 * previews and sends the template. Every refusal is shown as the desk worded it, with the words kept.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery, mockFetch, type Route } from '@test-utils';
import { ThreadSheet, ThreadView, type ThreadViewProps } from '@/components/comms-v2/ThreadView';
import type { CaseFileDetail } from '@/pages/admin/CommsV2BoardPage';
import { HELD_DRAFT_CHANGED } from '@shared/ops-types';

const FILE = '/api/comms-v2/case-files/case_p';
const NOW = Date.now();
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

function detail(over: Partial<CaseFileDetail> = {}): CaseFileDetail {
    return {
        id: 'case_p', stage: 'scoping', mode: 'sandbox',
        party: { name: 'Priya Raval', role: 'homeowner', address: 'phone:07700900123' },
        job: { type: 'Kitchen tap', location: 'NG2', quoteRef: null, bookingRef: null },
        turns: [
            { id: 't1', at: iso(30), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'The kitchen tap is dripping again.', media: [] },
            { id: 't2', at: iso(29), channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Is it the same tap as August?', media: [], approver: 'agent.comms_v2' },
        ],
        facts: [],
        hold: {
            approver: { kind: 'human', id: 'ben' }, reason: 'composer stated a duration', since: iso(80),
            draft: 'Usually around 2 hours for that, Priya.', exception: null, failures: ['stated a duration', 'no source'], notedOn: false,
        },
        holdApproverAssigned: true,
        replyChannel: 'whatsapp',
        replyWindow: { state: 'open', reason: 'the customer wrote 30 minutes ago', closesAt: iso(-60 * 23) },
        replyRefusal: null,
        speakerNames: {},
        ...over,
    };
}

function mount(routes: Route[], props: Partial<ThreadViewProps> = {}) {
    const onClose = vi.fn();
    const onChanged = vi.fn();
    const fetchMock = mockFetch(routes);
    const utils = renderWithQuery(<ThreadView fileId="case_p" layout="panel" onClose={onClose} onChanged={onChanged} viewerApprover="ben" {...props} />);
    return { ...fetchMock, ...utils, onClose, onChanged };
}

const FILE_ONLY = /\/api\/comms-v2\/case-files\/case_p$/;
const fileRoute = (d: CaseFileDetail | (() => CaseFileDetail)): Route => ({ url: FILE_ONLY, reply: () => ({ json: typeof d === 'function' ? d() : d }) });
const words = () => screen.getByLabelText('Your reply to the customer') as HTMLTextAreaElement;
/** The loading skeleton has its own name line and box; wait for the file itself. */
const ready = async () => { await screen.findByTestId('thread-turns'); return words(); };
const SHUT = 'the whatsapp window is shut (the customer last wrote 26 hours ago); a shut window never carries freeform words, so this reply cannot go until the customer writes again';

describe('<ThreadView>', () => {
    it('shows the header with the reply channel and window, and closes on × and on Esc', async () => {
        const { onClose } = mount([fileRoute(detail())]);
        await ready();
        expect(screen.getByTestId('thread-name')).toHaveTextContent('Priya Raval');
        expect(screen.getByText('homeowner')).toBeInTheDocument();
        expect(screen.getByText('Scoping')).toBeInTheDocument();
        expect(screen.getByTestId('thread-line').textContent).toMatch(/^Kitchen tap · NG2 · 07700900123 · reply via WhatsApp · window open until \d\d:\d\d$/);

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('Esc leaves the panel open while focus is in a field, and closes it once focus is elsewhere', async () => {
        const { onClose } = mount([fileRoute(detail())]);
        const box = await ready();
        box.focus();
        fireEvent.keyDown(box, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();

        await userEvent.type(box, 'half a reply');
        fireEvent.keyDown(box, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        expect(words().value).toBe('half a reply');

        box.blur();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Esc leaves the sheet open while the focused box holds words, and closes it with an empty box', async () => {
        const onClose = vi.fn();
        mockFetch([fileRoute(detail())]);
        renderWithQuery(<ThreadSheet fileId="case_p" onClose={onClose} onChanged={vi.fn()} viewerApprover="ben" />);
        const box = await ready();
        await userEvent.type(box, 'half a reply');
        expect(box).toHaveFocus();
        fireEvent.keyDown(box, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        expect(words().value).toBe('half a reply');

        await userEvent.clear(box);
        fireEvent.keyDown(box, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Esc leaves the sheet open while the Close-file box holds words', async () => {
        const onClose = vi.fn();
        mockFetch([fileRoute(detail())]);
        renderWithQuery(<ThreadSheet fileId="case_p" onClose={onClose} onChanged={vi.fn()} viewerApprover="ben" />);
        await ready();
        await userEvent.click(screen.getByTestId('close-file'));
        const why = screen.getByPlaceholderText('Why it is closed');
        await userEvent.type(why, 'done on site');
        fireEvent.keyDown(why, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        expect((why as HTMLTextAreaElement).value).toBe('done on site');
    });

    it('as a sheet, closes with the back button named for where it returns', async () => {
        const { onClose } = mount([fileRoute(detail())], { layout: 'sheet', backTo: 'Queue' });
        await ready();
        expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Queue' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('thread-line')).toHaveTextContent('Scoping · Kitchen tap · NG2');
    });

    it("carries View customer, Call and the keep-with-Ben slot; Latest quote only with a quote on file", async () => {
        mount([fileRoute(detail({ job: { type: 'Kitchen tap', location: 'NG2', quoteRef: 'q-9f3a', bookingRef: null } }))]);
        await ready();
        const actions = within(screen.getByTestId('thread-actions'));
        expect(actions.getByRole('link', { name: 'View customer' })).toHaveAttribute('href', '/admin/clients/phone%3A07700900123');
        expect(actions.getByRole('link', { name: 'Latest quote' })).toHaveAttribute('href', '/admin/price/q-9f3a');
        expect(actions.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+447700900123');
        // The keep-with-a-person switch is its own task: the slot is there, and does nothing yet.
        const keep = actions.getByRole('button', { name: /Keep with Ben/ });
        expect(keep).toBeDisabled();
        expect(keep).toHaveAttribute('title', 'Coming soon');
    });

    it('hides Latest quote with no quote on file, and Call for a customer known only by email', async () => {
        mount([fileRoute(detail({ party: { name: 'Priya Raval', role: 'homeowner', address: 'email:priya@example.com' } }))]);
        await ready();
        const actions = within(screen.getByTestId('thread-actions'));
        expect(actions.queryByRole('link', { name: 'Latest quote' })).toBeNull();
        expect(actions.queryByRole('link', { name: 'Call' })).toBeNull();
        expect(actions.getByRole('link', { name: 'View customer' })).toHaveAttribute('href', '/admin/clients/email%3Apriya%40example.com');
    });

    it('carries the same buttons on the sheet, and none of them while the file is still loading', async () => {
        mount([fileRoute(detail())], { layout: 'sheet' });
        await ready();
        expect(within(screen.getByTestId('thread-actions')).getByRole('link', { name: 'View customer' })).toBeInTheDocument();
    });

    it('shows no buttons while the file is still loading', async () => {
        mount([{ url: FILE_ONLY, reply: () => new Promise(() => undefined) as never }]);
        await screen.findByTestId('thread-loading');
        expect(screen.queryByTestId('thread-actions')).toBeNull();
    });

    it('names each speaker without a raw approver, and shows media descriptions, system rules and call rows', async () => {
        mount([fileRoute(detail({
            hold: null,
            speakerNames: { 'ben@handyservices.app': 'Ben Real' },
            turns: [
                { id: 't1', at: iso(30), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Hello', media: [] },
                { id: 't2', at: iso(29), channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Desk words', media: [], approver: 'agent.comms_v2' },
                { id: 't3', at: iso(28), channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Ben words', media: [], approver: 'human:ben@handyservices.app' },
                { id: 't4', at: iso(27), channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Cover words', media: [], approver: 'human:unknown-cover@handyservices.app' },
                {
                    id: 't5', at: iso(26), channel: 'whatsapp', direction: 'inbound', kind: 'media', body: '', media: [
                        { id: 'm1', kind: 'image', mime: 'image/jpeg', url: null, description: { description: 'A chrome mixer tap dripping at the base', confidence: 'high' } },
                        { id: 'm2', kind: 'image', mime: 'image/jpeg', url: null, description: null },
                    ],
                },
                { id: 't6', at: iso(25), channel: 'whatsapp', direction: 'outbound', kind: 'system', body: 'Hold released by Ben', media: [] },
                { id: 'c1', at: iso(20), channel: 'call', direction: 'inbound', kind: 'call_transcript', body: '', media: [], call: { outcome: 'answered_inbound', headline: 'Same tap, wants someone today', summary: 'Confirmed the August mixer.', transcript: '[Caller]: it is dripping' } },
                { id: 'c2', at: iso(10), channel: 'call', direction: 'inbound', kind: 'call_transcript', body: '', media: [], call: { outcome: 'answered_inbound', headline: 'call, 1 min', summary: null, transcript: null } },
                { id: 'c3', at: iso(5), channel: 'call', direction: 'inbound', kind: 'call_transcript', body: '', media: [], call: { outcome: 'missed', headline: 'missed call, rang 20 s', summary: null, transcript: null } },
            ],
        }))]);

        await screen.findByTestId('turn-meta-t1');
        expect(screen.getByTestId('turn-meta-t1').textContent).toMatch(/^Priya Raval · WhatsApp · /);
        expect(screen.getByTestId('turn-meta-t2').textContent).toMatch(/^Desk · WhatsApp · /);
        expect(screen.getByTestId('turn-meta-t3').textContent).toMatch(/^Ben Real · /);
        expect(screen.getByTestId('turn-meta-t4').textContent).toMatch(/^unknown-cover · /);
        expect(screen.getByTestId('thread-turns').textContent).not.toMatch(/agent\.comms_v2|human:/);

        expect(screen.getByTestId('media-description-m1')).toHaveTextContent('A chrome mixer tap dripping at the base · high confidence');
        expect(screen.getByTestId('media-description-m2')).toHaveTextContent('Not described yet');
        expect(screen.getByTestId('turn-system-t6')).toHaveTextContent('Hold released by Ben');

        expect(screen.getByTestId('call-summary-c1')).toHaveTextContent('Confirmed the August mixer.');
        expect(screen.getByTestId('call-turn-c1')).toHaveTextContent('inbound call');
        expect(screen.queryByTestId('call-transcript-c1')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Show transcript' }));
        expect(screen.getByTestId('call-transcript-c1')).toHaveTextContent('[Caller]: it is dripping');
        await userEvent.click(screen.getByRole('button', { name: 'Hide transcript' }));
        expect(screen.queryByTestId('call-transcript-c1')).toBeNull();

        expect(screen.getByTestId('call-pending-c2')).toHaveTextContent('Transcribing…');
        expect(screen.queryByTestId('call-pending-c3')).toBeNull();
        expect(screen.getByTestId('call-turn-c3')).toHaveTextContent('missed');
    });

    it('shows the held block in amber with its age, reason, failures, exception, noted-on and draft', async () => {
        mount([fileRoute(detail({ hold: { ...detail().hold!, exception: 'date_change', notedOn: true } }))]);
        const block = await screen.findByTestId('held-block');
        expect(block.className).toContain('amber');
        expect(block).toHaveTextContent('Held 1h 20m · for Ben');
        expect(screen.getByTestId('held-reason')).toHaveTextContent('composer stated a duration');
        expect(screen.getByTestId('held-detail')).toHaveTextContent('Failures: stated a duration, no source · Exception: date change · Noted on: yes');
        expect(screen.getByTestId('hold-draft')).toHaveTextContent('Usually around 2 hours for that, Priya.');
    });

    it('Send this posts send-held-draft with the draft on screen as expectedDraft, and shows the sent reply', async () => {
        const { calls, onChanged } = mount([
            fileRoute(detail()),
            { method: 'POST', url: `${FILE}/send-held-draft`, reply: () => ({ json: { ok: true, sent: { approver: 'human:ben@x', runId: 'r1', bubbles: ['Usually around 2 hours for that, Priya.'], turnId: 't9' } } }) },
        ]);
        await userEvent.click(await screen.findByRole('button', { name: 'Send this' }));

        const pending = await screen.findByTestId('thread-pending');
        await waitFor(() => expect(pending).toHaveTextContent('✓ Sent · Ben · WhatsApp · just now'));
        expect(pending).toHaveTextContent('Usually around 2 hours for that, Priya.');
        const post = calls.filter((c) => c.method === 'POST');
        expect(post).toHaveLength(1);
        expect(post[0].body).toEqual({ expectedDraft: 'Usually around 2 hours for that, Priya.' });
        expect(onChanged).toHaveBeenCalled();
    });

    it('a 409 "the held draft changed since you saw it" re-reads the file, shows the new draft and asks again', async () => {
        let reads = 0;
        const changed = detail({ hold: { ...detail().hold!, draft: 'Around two hours, I will confirm on the quote.' } });
        const { calls } = mount([
            fileRoute(() => (reads++ === 0 ? detail() : changed)),
            {
                method: 'POST', url: `${FILE}/send-held-draft`,
                reply: (c) => ((c.body as { expectedDraft?: string })?.expectedDraft === changed.hold!.draft
                    ? { json: { ok: true, sent: { bubbles: [changed.hold!.draft], turnId: 't9' } } }
                    : { status: 409, json: { error: HELD_DRAFT_CHANGED } }),
            },
        ]);
        await userEvent.click(await screen.findByRole('button', { name: 'Send this' }));

        expect(await screen.findByTestId('draft-changed')).toHaveTextContent('The held draft changed since you saw it');
        await waitFor(() => expect(screen.getByTestId('hold-draft')).toHaveTextContent('Around two hours, I will confirm on the quote.'));
        expect(screen.queryByTestId('thread-pending')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Send this' }));
        expect(await screen.findByTestId('thread-pending')).toHaveTextContent('Around two hours, I will confirm on the quote.');
        const posts = calls.filter((c) => c.method === 'POST');
        expect(posts.map((c) => c.body)).toEqual([
            { expectedDraft: 'Usually around 2 hours for that, Priya.' },
            { expectedDraft: 'Around two hours, I will confirm on the quote.' },
        ]);
    });

    it('a 409 "there is no held draft to send" hides Send this, keeps the composer, and re-reads the file', async () => {
        const { calls } = mount([
            fileRoute(detail()),
            { method: 'POST', url: `${FILE}/send-held-draft`, reply: () => ({ status: 409, json: { error: 'there is no held draft to send' } }) },
        ]);
        await userEvent.type(await ready(), 'kept');
        await userEvent.click(screen.getByRole('button', { name: 'Send this' }));
        expect(await screen.findByTestId('thread-refusal')).toHaveTextContent('Nothing to send. there is no held draft to send');
        expect(screen.queryByRole('button', { name: 'Send this' })).toBeNull();
        expect(words().value).toBe('kept');
        await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url === FILE).length).toBeGreaterThanOrEqual(2));
    });

    it('Send reply posts his words, shows a sending bubble at once, then the bubbles that went, and empties the box', async () => {
        let answer!: (v: { json: unknown }) => void;
        const { calls, onChanged } = mount([
            fileRoute(detail()),
            { method: 'POST', url: `${FILE}/answer`, reply: () => new Promise((r) => { answer = r; }) },
        ]);
        await userEvent.type(await ready(), 'Yes Priya, Marek 2-6 today.');
        await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));

        const pending = await screen.findByTestId('thread-pending');
        expect(pending).toHaveTextContent('Yes Priya, Marek 2-6 today.');
        expect(pending).toHaveTextContent('Sending as Ben…');
        expect(pending.className).toContain('opacity-60');
        expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
        expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ words: 'Yes Priya, Marek 2-6 today.' });

        answer({ json: { ok: true, sent: { approver: 'human:ben@x', runId: 'r', bubbles: ['Yes Priya, Marek 2-6 today.'], turnId: 't9' } } });
        await waitFor(() => expect(screen.getByTestId('thread-pending')).toHaveTextContent('✓ Sent · Ben · WhatsApp · just now'));
        expect(words().value).toBe('');
        expect(onChanged).toHaveBeenCalled();
    });

    it('the sent bubble gives way to the turn once a read carries it', async () => {
        let sent = false;
        const withTurn = () => detail({ hold: null, turns: [...detail().turns, { id: 't9', at: iso(0), channel: 'whatsapp', direction: 'outbound', kind: 'text', body: 'Done and dusted.', media: [], approver: 'human:ben@x' }] });
        const { client } = mount([
            fileRoute(() => (sent ? withTurn() : detail())),
            { method: 'POST', url: `${FILE}/answer`, reply: () => { sent = true; return { json: { ok: true, sent: { bubbles: ['Done and dusted.'], turnId: 't9' } } }; } },
        ]);
        await userEvent.type(await ready(), 'Done and dusted.');
        await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
        await client.refetchQueries({ queryKey: ['comms-v2-case-file', 'case_p'] });
        await waitFor(() => expect(screen.getByTestId('turn-bubble-t9')).toBeInTheDocument());
        expect(screen.queryByTestId('thread-pending')).toBeNull();
    });

    it('a refused answer shows the desk\'s reason verbatim, drops the sending bubble and keeps the words', async () => {
        mount([
            fileRoute(detail()),
            { method: 'POST', url: `${FILE}/answer`, reply: () => ({ status: 409, json: { error: 'only Ben may answer this file' } }) },
        ]);
        await userEvent.type(await ready(), 'My words');
        await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
        expect(await screen.findByTestId('thread-refusal')).toHaveTextContent('Not sent. only Ben may answer this file');
        expect(screen.queryByTestId('thread-pending')).toBeNull();
        expect(words().value).toBe('My words');
    });

    it('a session with no approver slot is told so, not to retry', async () => {
        mount([
            fileRoute(detail()),
            { method: 'POST', url: `${FILE}/answer`, reply: () => ({ status: 403, json: { error: 'no approver slot is assigned to this user' } }) },
        ]);
        await userEvent.type(await ready(), 'x');
        await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
        expect(await screen.findByTestId('thread-refusal')).toHaveTextContent("Not sent. You can't act on this desk: no approver slot is assigned to you.");
    });

    it('a shut-window refusal shows the reason verbatim and a template card with the wording the send would carry; Send template sends it', async () => {
        const { calls } = mount([
            fileRoute(detail()),
            { method: 'POST', url: `${FILE}/answer`, reply: () => ({ status: 409, json: { error: SHUT } }) },
            { url: `${FILE}/template-offer`, reply: () => ({ json: { ok: true, template: 'answer_ready_reopen_v1', language: 'en_GB', channel: 'whatsapp', body: 'Hi Priya, we have an answer to your question. Reply and we will send it.' } }) },
            { method: 'POST', url: `${FILE}/send-template`, reply: () => ({ json: { ok: true, sent: { bubbles: ['Hi Priya, we have an answer to your question. Reply and we will send it.'], turnId: 't9' } } }) },
        ]);
        await userEvent.type(await ready(), 'Marek can come at 2.');
        await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));

        expect(await screen.findByTestId('thread-refusal')).toHaveTextContent(`Can't send freeform words. ${SHUT}`);
        expect(await screen.findByTestId('template-offer-name')).toHaveTextContent('answer_ready_reopen_v1');
        expect(screen.getByTestId('template-offer-body')).toHaveTextContent('Hi Priya, we have an answer to your question.');
        expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: 'Send template' }));
        await waitFor(() => expect(screen.getByTestId('thread-pending')).toHaveTextContent('✓ Sent'));
        expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/send-template'))[0].body).toBeNull();
        expect(words().value).toBe('Marek can come at 2.');
    });

    it('a refused template send is shown verbatim on the card', async () => {
        mount([
            fileRoute(detail({ replyWindow: { state: 'shut', reason: 'the customer last wrote 26 hours ago', closesAt: null } })),
            { url: `${FILE}/template-offer`, reply: () => ({ json: { ok: true, template: 'quote_ready_link', language: 'en_GB', channel: 'whatsapp', body: 'Your quote is ready.' } }) },
            { method: 'POST', url: `${FILE}/send-template`, reply: () => ({ status: 409, json: { error: 'window shut and no approved rung for that purpose' } }) },
        ]);
        await userEvent.click(await screen.findByRole('button', { name: 'Send template' }));
        expect(await screen.findByTestId('template-send-refused')).toHaveTextContent('Template refused: window shut and no approved rung for that purpose');
    });

    it('a window already shut says so up front, disables the freeform sends and shows a template refusal instead of a button', async () => {
        mount([
            fileRoute(detail({ replyWindow: { state: 'shut', reason: 'the customer last wrote 26 hours ago', closesAt: null } })),
            { url: `${FILE}/template-offer`, reply: () => ({ json: { ok: false, reason: 'no template is true for this thread: the customer needs to write again before a reply can go' } }) },
        ]);
        expect(await screen.findByTestId('thread-window-shut')).toHaveTextContent("Can't send freeform words. The WhatsApp window is shut (the customer last wrote 26 hours ago)");
        expect(screen.getByTestId('thread-line')).toHaveTextContent('reply via WhatsApp · window shut');
        expect(screen.getByRole('button', { name: 'Send this' })).toBeDisabled();
        await userEvent.type(words(), 'still typing');
        expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
        expect(await screen.findByTestId('template-offer-refused')).toHaveTextContent('Template refused: no template is true for this thread: the customer needs to write again before a reply can go');
        expect(screen.queryByRole('button', { name: 'Send template' })).toBeNull();
    });

    it('a fresh customer message arriving on the refresh clears a stale shut-window refusal', async () => {
        let reads = 0;
        const { client } = mount([
            fileRoute(() => (reads++ === 0 ? detail() : detail({ turns: [...detail().turns, { id: 't5', at: iso(0), channel: 'whatsapp', direction: 'inbound', kind: 'text', body: 'Still there?', media: [] }] }))),
            { method: 'POST', url: `${FILE}/answer`, reply: () => ({ status: 409, json: { error: SHUT } }) },
            { url: `${FILE}/template-offer`, reply: () => ({ json: { ok: false, reason: 'the whatsapp window is open; send a freeform reply instead of a template' } }) },
        ]);
        await userEvent.type(await ready(), 'Hi');
        await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
        await screen.findByTestId('template-card');

        await client.refetchQueries({ queryKey: ['comms-v2-case-file', 'case_p'] });
        await screen.findByTestId('turn-bubble-t5');
        expect(screen.queryByTestId('thread-refusal')).toBeNull();
        expect(screen.queryByTestId('template-card')).toBeNull();
    });

    it('Release hold only posts his words for the file; a refusal is shown verbatim with the words kept', async () => {
        let refuse = false;
        const { calls } = mount([
            fileRoute(detail()),
            { method: 'POST', url: `${FILE}/release`, reply: () => (refuse ? { status: 409, json: { error: 'only Ben may release this hold' } } : { json: { ok: true } }) },
        ]);
        const release = await screen.findByRole('button', { name: 'Release hold only' });
        expect(release).toBeDisabled();
        await userEvent.type(words(), 'Checked with Marek, fine to leave.');
        await userEvent.click(release);
        expect(await screen.findByTestId('thread-released')).toBeInTheDocument();
        expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ words: 'Checked with Marek, fine to leave.' });
        expect(words().value).toBe('');

        refuse = true;
        await userEvent.type(words(), 'again');
        await userEvent.click(screen.getByRole('button', { name: 'Release hold only' }));
        expect(await screen.findByTestId('thread-refusal')).toHaveTextContent('Not released. only Ben may release this hold');
        expect(words().value).toBe('again');
    });

    it('an unassigned slot says nobody can act and disables Send this and Release', async () => {
        mount([fileRoute(detail({ holdApproverAssigned: false }))]);
        expect(await screen.findByTestId('held-unassigned')).toHaveTextContent('No one is assigned to the Ben slot');
        expect(screen.getByRole('button', { name: 'Send this' })).toBeDisabled();
        await userEvent.type(words(), 'x');
        expect(screen.getByRole('button', { name: 'Release hold only' })).toBeDisabled();
    });

    it('with no customer turn there is nothing to answer: the box is disabled and says why', async () => {
        mount([fileRoute(detail({ hold: null, turns: [], replyChannel: null, replyWindow: null, replyRefusal: 'no customer turn to answer' }))]);
        expect(await screen.findByTestId('thread-empty')).toHaveTextContent('Nothing to answer until they write.');
        expect(words()).toBeDisabled();
        expect(words().placeholder).toBe('Needs a customer turn to answer');
        expect(screen.queryByTestId('thread-unroutable')).toBeNull();
    });

    it('a held file with no customer turn keeps the box open for Release hold only, with Send reply disabled', async () => {
        const call = { id: 'c1', at: iso(10), channel: 'phone', direction: 'outbound', kind: 'text', body: 'Called Priya', media: [], approver: 'human:ben' } as CaseFileDetail['turns'][number];
        const { calls } = mount([
            fileRoute(detail({ turns: [call], hold: { ...detail().hold!, draft: null }, replyChannel: null, replyWindow: null, replyRefusal: 'no customer turn to answer' })),
            { method: 'POST', url: `${FILE}/release`, reply: () => ({ json: { ok: true } }) },
        ]);
        expect(await screen.findByTestId('thread-empty')).toBeInTheDocument();
        expect(words()).toBeEnabled();
        await userEvent.type(words(), 'Spoke to her on the phone.');
        expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
        await userEvent.click(screen.getByRole('button', { name: 'Release hold only' }));
        expect(await screen.findByTestId('thread-released')).toBeInTheDocument();
        expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ words: 'Spoke to her on the phone.' });
    });

    it('a session the server says holds no slot sees the thread and the held draft with every action hidden', async () => {
        mount([fileRoute(detail())], { canAct: false });
        expect(await screen.findByTestId('hold-draft')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send this' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Release hold only' })).toBeNull();
        expect(screen.queryByLabelText('Your reply to the customer')).toBeNull();
    });

    it('while loading the composer is disabled; a failed read offers Retry and a way back', async () => {
        let fail = true;
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const { onClose } = mount([{ url: FILE_ONLY, reply: async () => { await gate; return fail ? { status: 500, json: {} } : { json: detail() }; } }], { backTo: 'Board' });
        expect(screen.getByTestId('thread-loading')).toBeInTheDocument();
        expect(words()).toBeDisabled();
        release();

        const alert = await screen.findByTestId('thread-error');
        expect(alert).toHaveTextContent("Couldn't open this thread");
        expect(alert).toHaveTextContent('The card is still on the board.');
        await userEvent.click(within(alert).getByRole('button', { name: 'Back to board' }));
        expect(onClose).toHaveBeenCalled();

        fail = false;
        await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
        expect(await screen.findByTestId('hold-draft')).toBeInTheDocument();
    });

    it('keeps the facts behind a toggle', async () => {
        mount([fileRoute(detail({ facts: [{ id: 'f1', key: 'postcode', value: 'NG2 1AA', at: iso(5), source: { kind: 'thread' } }] }))]);
        await userEvent.click(await screen.findByRole('button', { name: /Facts \(1\)/ }));
        expect(screen.getByTestId('thread-facts')).toHaveTextContent('postcodeNG2 1AA');
    });
});
