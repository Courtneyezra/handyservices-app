/**
 * T5 vitest: the sandbox route's pure parts and its shape. No database (mocked at import).
 *
 * The refusal that matters most is structural, so it is pinned structurally: the router has NO
 * route with a parameter and NO route that reads a conversation id — every action is "the sandbox
 * thread", found by number. An arbitrary conversation id cannot be named, so it cannot be mutated.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, pool: {} }));
vi.mock('./index', () => ({ runOnce: vi.fn() }));
vi.mock('../media-store', () => ({ MEDIA_DIR: '/nonexistent/sandbox-media-test', mirrorMediaToS3: vi.fn(async () => false) }));

import {
    commsSandboxRouter, validateCustomerText, validateQuoteSeed, sandboxSlug, summariseRun,
    MAX_MESSAGE_CHARS, SANDBOX_DEFAULT_TOTAL_PENCE, SANDBOX_QUOTE_MARK, firstContactMirrorFor, SANDBOX_RULES_ACK_SENDER, MIRROR_NOTE,
    validateCustomerMessage, validateSandboxMediaType, sandboxMediaId, sandboxMediaFileName, sandboxMediaIdOf, describeUploadError,
    mediaReportFor, geminiKeyPresent, MEDIA_STATUS_NOTE, SANDBOX_MAX_FILES, SANDBOX_MAX_FILE_BYTES, SANDBOX_MEDIA_TYPES,
    validateInboundChannel, validatePriceTotal, mirrorSender, appendEvent, ackGateNote, entrySummary, SANDBOX_EVENTS_MAX,
    MIRRORED_PROPOSAL_TAGS, proposalTagsToMirror,
} from './sandbox-routes';
import type { RunOnceResult } from './index';
import type { MediaItem } from './types';

describe('router shape', () => {
    const routes = (commsSandboxRouter as any).stack
        .filter((l: any) => l.route)
        .map((l: any) => ({ path: l.route.path as string, methods: Object.keys(l.route.methods) }));

    it('exposes exactly the sandbox actions: T5\'s four, T16\'s five', () => {
        expect(routes.map((r: any) => `${r.methods.join(',')} ${r.path}`).sort()).toEqual([
            'get /', 'post /accept', 'post /age', 'post /message', 'post /price', 'post /quote', 'post /reset', 'post /run', 'post /start',
        ]);
    });
    it('no route takes a parameter — nothing can name a conversation id', () => {
        for (const r of routes) expect(r.path).not.toMatch(/:/);
    });
});

describe('validateCustomerText', () => {
    it('trims, normalises line endings, refuses empty and over-long', () => {
        expect(validateCustomerText('  hi\r\nthere  ')).toEqual({ ok: true, text: 'hi\nthere' });
        expect(validateCustomerText('   ')).toMatchObject({ ok: false });
        expect(validateCustomerText(42)).toMatchObject({ ok: false });
        expect(validateCustomerText('x'.repeat(MAX_MESSAGE_CHARS + 1))).toMatchObject({ ok: false });
        expect(validateCustomerText('x'.repeat(MAX_MESSAGE_CHARS))).toMatchObject({ ok: true });
    });
});

describe('validateQuoteSeed', () => {
    it('defaults to the house amount and a title; refuses non-integers and silly amounts', () => {
        expect(validateQuoteSeed(undefined)).toMatchObject({ ok: true, totalPence: SANDBOX_DEFAULT_TOTAL_PENCE });
        expect(validateQuoteSeed({ totalPence: 12345, title: '  Fix the gate ' })).toEqual({ ok: true, totalPence: 12345, title: 'Fix the gate' });
        expect(validateQuoteSeed({ totalPence: 12.5 })).toMatchObject({ ok: false });
        expect(validateQuoteSeed({ totalPence: 0 })).toMatchObject({ ok: false });
        expect(validateQuoteSeed({ totalPence: 5_000_000 })).toMatchObject({ ok: false });
        expect(validateQuoteSeed({ totalPence: '480' })).toMatchObject({ ok: true, totalPence: 480 });
    });
    it('the seeded quote is marked SANDBOX in words', () => {
        expect(SANDBOX_QUOTE_MARK).toMatch(/SANDBOX/);
    });
});

describe('T6: firstContactMirrorFor — the rules layer answers first contact, the sandbox mirrors it', () => {
    const tri = (over: Record<string, unknown> = {}) => ({ audience: 'customer', intent: 'ack_enquiry', lane: 'rules', exceptions: [], stage: 'enquiry', tags: [], reasons: [], source: 'rules', ...over }) as any;
    const none = { kind: 'none', reason: 'no proposal' } as any;
    const firstContact = { id: 'rules.first_contact', version: 1 };
    it('a rules-lane first-contact none mirrors the ack, with the intent triage chose', () => {
        expect(firstContactMirrorFor({ triage: tri(), pack: firstContact, decision: none })).toEqual({ intent: 'ack_enquiry' });
        expect(firstContactMirrorFor({ triage: tri({ intent: 'ack_photos' }), pack: firstContact, decision: none })).toEqual({ intent: 'ack_photos' });
    });
    it('anything the desk (or Ben) handles is never mirrored', () => {
        expect(firstContactMirrorFor({ triage: tri({ lane: 'scoper', intent: 'unknown' }), pack: { id: 'customer.pre_quote', version: 1 }, decision: none })).toBeNull();
        expect(firstContactMirrorFor({ triage: tri({ lane: 'post_quote', intent: 'unknown' }), pack: { id: 'customer.post_quote', version: 1 }, decision: none })).toBeNull();
        expect(firstContactMirrorFor({ triage: tri({ lane: 'ben', intent: 'unknown', exceptions: ['money_question'] }), pack: { id: 'customer.exception', version: 1 }, decision: { kind: 'flag', exception: 'money_question' } as any })).toBeNull();
        // Rules lane but not the first-contact pack, or not a quiet decision: leave it alone.
        expect(firstContactMirrorFor({ triage: tri(), pack: { id: 'rules.followup', version: 1 }, decision: none })).toBeNull();
        expect(firstContactMirrorFor({ triage: tri(), pack: firstContact, decision: { kind: 'drop', reason: 'spam' } as any })).toBeNull();
        expect(firstContactMirrorFor({ triage: tri({ intent: 'holding' }), pack: firstContact, decision: none })).toBeNull();
    });
    it('the mirrored bubble is named so the page can label it, and the note says who answers', () => {
        expect(SANDBOX_RULES_ACK_SENDER.toLowerCase()).toContain('rules layer ack');
        expect(SANDBOX_RULES_ACK_SENDER.toLowerCase()).toContain('never sent');
        expect(MIRROR_NOTE).toMatch(/rules layer/);
        expect(MIRROR_NOTE).toMatch(/next message reaches the desk/);
    });
});

describe('sandboxSlug', () => {
    it('fits the 8-char column and is recognisable', () => {
        for (let i = 0; i < 20; i++) {
            const s = sandboxSlug();
            expect(s.length).toBeLessThanOrEqual(8);
            expect(s.startsWith('sbx')).toBe(true);
        }
    });
});

describe('summariseRun', () => {
    it('keeps the decisions, drops the case file bulk, carries the cost', () => {
        const run = {
            runId: 'run_1', agent: 'scoper', trigger: 'inbound_message', pack: { id: 'customer.post_quote', version: 3 },
            caseFile: {
                conversationId: 'c', phone: '+447700900942', audience: 'customer', stage: 'quote_sent', timeline: [{}, {}, {}], media: [],
                window: { canFreeform: true, templateRequired: false, channelLastUsed: 'whatsapp' }, quote: { slug: 'sbx1', paid: false, lines: 1 },
                openPromises: [], openFlags: [], tags: ['sandbox'], hash: 'h', builtAt: 'b',
            },
            triage: { audience: 'customer', intent: 'unknown', lane: 'post_quote', exceptions: [], stage: 'quote_sent', tags: [], reasons: ['r'], source: 'rules' },
            proposal: { intent: 'ask_gap', body: ['?'], reasons: ['still scoping'] },
            guards: { ok: true, guardsHit: [], escalate: false, notes: [] },
            decision: { kind: 'pending', dueAt: 'd', reason: 'tier DRAFT' },
            durationMs: 1200, dryRun: true, sandbox: true, exitNote: 'DRY RUN — …', skipped: ['job pack filing'], error: null,
        } as unknown as RunOnceResult;
        const s = summariseRun(run, { costPence: 3, model: 'claude-sonnet-5', turns: null });
        expect(s).toMatchObject({ runId: 'run_1', dryRun: true, sandbox: true, costPence: 3, model: 'claude-sonnet-5', exitNote: 'DRY RUN — …' });
        expect(s.caseFile).toEqual({
            stage: 'quote_sent', tags: ['sandbox'], quote: { slug: 'sbx1', paid: false, lines: 1 },
            window: { canFreeform: true, templateRequired: false, channelLastUsed: 'whatsapp' }, openFlags: [], openPromises: [], timelineItems: 3,
        });
        expect((s as any).caseFile.timeline).toBeUndefined();
        expect(s.proposal?.body).toEqual(['?']);
    });
    it('a run with no cost row reads as not recorded, and dry-run defaults to true', () => {
        const s = summariseRun({ runId: 'r', agent: 'scoper', trigger: 'manual', pack: { id: 'p', version: 1 }, caseFile: { stage: 'enquiry', tags: [], timeline: [], window: {}, openFlags: [], openPromises: [] }, triage: {}, decision: { kind: 'none', reason: 'x' } } as any, null);
        expect(s.costPence).toBeNull();
        expect(s.dryRun).toBe(true);
        expect(s.skipped).toEqual([]);
    });
});

// ---------------------------------------------------------------- T11: media on the sandbox

describe('T11: the upload is bounded, and the stored name is ours', () => {
    it('accepts photos and videos by declared type, refuses everything else before a byte is written', () => {
        for (const mime of Object.keys(SANDBOX_MEDIA_TYPES)) expect(validateSandboxMediaType(mime)).toMatchObject({ ok: true });
        expect(validateSandboxMediaType('image/jpeg')).toEqual({ ok: true, ext: 'jpg', kind: 'image' });
        expect(validateSandboxMediaType('video/quicktime')).toEqual({ ok: true, ext: 'mov', kind: 'video' });
        expect(validateSandboxMediaType('IMAGE/PNG ')).toMatchObject({ ok: true, kind: 'image' });
        for (const bad of ['application/pdf', 'audio/ogg', 'text/html', 'image/svg+xml', 'application/x-sh', '', undefined, 42]) {
            expect(validateSandboxMediaType(bad)).toMatchObject({ ok: false });
        }
    });
    it('the bounds are WhatsApp\'s cap and a count above the per-pass bound (so over-bound is reachable)', () => {
        expect(SANDBOX_MAX_FILE_BYTES).toBe(16 * 1024 * 1024);
        expect(SANDBOX_MAX_FILES).toBe(8);
        expect(SANDBOX_MAX_FILES).toBeGreaterThan(6);
    });
    it('the stored file is <message id>.<ext>: never the browser\'s name, never a path', () => {
        const id = sandboxMediaId();
        expect(id).toMatch(/^msg_sbx_[a-f0-9]{13}$/);
        expect(sandboxMediaFileName(id, 'image/jpeg')).toBe(`${id}.jpg`);
        expect(() => sandboxMediaFileName('../../etc/passwd', 'image/jpeg')).toThrow();
        expect(() => sandboxMediaFileName(id, 'application/pdf')).toThrow();
        expect(sandboxMediaIdOf(`${id}.jpg`)).toBe(id);
        expect(sandboxMediaIdOf('MM1234567890abcdef.jpeg')).toBeNull();   // a real Twilio inbound's file: never ours to delete
        expect(sandboxMediaIdOf(`../${id}.jpg`)).toBeNull();
        expect(sandboxMediaIdOf('rec_1.webm')).toBeNull();
    });
    it('validateCustomerMessage: text may be empty only when files came with it', () => {
        expect(validateCustomerMessage('', 0)).toMatchObject({ ok: false });
        expect(validateCustomerMessage(undefined, 0)).toMatchObject({ ok: false });
        expect(validateCustomerMessage('', 1)).toEqual({ ok: true, text: '' });
        expect(validateCustomerMessage(undefined, 2)).toEqual({ ok: true, text: '' });
        expect(validateCustomerMessage('  the fan  ', 1)).toEqual({ ok: true, text: 'the fan' });
        expect(validateCustomerMessage('x'.repeat(MAX_MESSAGE_CHARS + 1), 1)).toMatchObject({ ok: false });
        expect(validateCustomerMessage('hi', SANDBOX_MAX_FILES + 1)).toMatchObject({ ok: false });
    });
    it('multer refusals are said in words', () => {
        expect(describeUploadError({ code: 'LIMIT_FILE_SIZE' })).toMatch(/16 MB/);
        expect(describeUploadError({ code: 'LIMIT_FILE_COUNT' })).toMatch(/8 files/);
        expect(describeUploadError({ code: 'LIMIT_UNEXPECTED_FILE' })).toMatch(/media/);
        expect(describeUploadError(new Error('application/pdf is not accepted'))).toMatch(/not accepted/);
    });
    it('the router still exposes only parameterless actions with media on (re-pinned)', () => {
        const routes = (commsSandboxRouter as any).stack.filter((l: any) => l.route).map((l: any) => l.route.path as string);
        expect(routes.sort()).toEqual(['/', '/accept', '/age', '/message', '/price', '/quote', '/reset', '/run', '/start']);
        for (const r of routes) expect(r).not.toMatch(/:/);
    });
    it('geminiKeyPresent reads either key name, and nothing else', () => {
        expect(geminiKeyPresent({} as NodeJS.ProcessEnv)).toBe(false);
        expect(geminiKeyPresent({ GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(true);
        expect(geminiKeyPresent({ GOOGLE_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(true);
        expect(geminiKeyPresent({ OPENAI_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(false);
    });
});

describe('T11: mediaReportFor — what the desk saw, or why it saw nothing', () => {
    const on = { enabled: true, images: true, maxPerRun: 6, keyPresent: true };
    const m = (id: string, kind: MediaItem['kind'], description?: string): MediaItem => ({ id, kind, url: `/api/media/${id}.jpg`, description });
    const row = (mediaId: string, decision: 'described' | 'failed', error: string | null = null) => ({ id: `vis_${mediaId}`, mediaId, decision, error, costPence: decision === 'described' ? 1 : null });

    it('described on this pass vs from the cache: both carry the description verbatim', () => {
        const r = mediaReportFor([m('a', 'image', 'A cracked tile.'), m('b', 'video', 'Water dripping from a tap.')], on, [row('a', 'described')]);
        expect(r[0]).toMatchObject({ id: 'a', status: 'described', description: 'A cracked tile.', vision: { runId: 'vis_a', costPence: 1, error: null } });
        expect(r[1]).toMatchObject({ id: 'b', status: 'cached', description: 'Water dripping from a tap.', vision: null });
        expect(r[0].note).toContain('first 160 characters');
    });
    it('a failed description says FAILED and carries the vision row\'s error', () => {
        const r = mediaReportFor([m('a', 'image')], on, [row('a', 'failed', 'no description (see describe_video log)')]);
        expect(r[0].status).toBe('failed');
        expect(r[0].description).toBeNull();
        expect(r[0].note).toContain('FAILED');
        expect(r[0].note).toContain('no description (see describe_video log)');
    });
    it('over the bound: the EARLIER items are the ones dropped, matching the case file\'s own selection', () => {
        const media = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => m(id, 'image', i >= 2 ? `desc ${id}` : undefined));
        const r = mediaReportFor(media, on, media.slice(2).map((x) => row(x.id, 'described')));
        expect(r.map((x) => x.status)).toEqual(['over_bound', 'over_bound', 'described', 'described', 'described', 'described', 'described', 'described']);
        expect(r[0].note).toContain('per-pass bound');
    });
    it('off, images off, no key, unsupported: each named, none silent', () => {
        expect(mediaReportFor([m('a', 'image')], { ...on, enabled: false }, [])[0].status).toBe('off');
        expect(mediaReportFor([m('a', 'image')], { ...on, images: false }, [])[0].status).toBe('images_off');
        expect(mediaReportFor([m('v', 'video')], { ...on, images: false }, [])[0].status).toBe('missing'); // videos still eligible; nothing came back
        expect(mediaReportFor([m('a', 'image')], { ...on, keyPresent: false }, [row('a', 'failed', 'no description (see describe_video log)')])[0].status).toBe('no_key');
        expect(mediaReportFor([m('a', 'audio')], on, [])[0].status).toBe('unsupported');
        expect(mediaReportFor([m('a', 'document')], on, [])[0].status).toBe('unsupported');
        for (const status of Object.keys(MEDIA_STATUS_NOTE)) {
            if (status === 'described' || status === 'cached') continue;
            expect(MEDIA_STATUS_NOTE[status as keyof typeof MEDIA_STATUS_NOTE]).toMatch(/NOT described|FAILED/);
        }
    });
    it('a description that exists is never reported as missing, whatever the switches say now', () => {
        // The switch was flipped between passes: the cache still holds the text, and the Scoper read it.
        expect(mediaReportFor([m('a', 'image', 'A door.')], { ...on, enabled: false }, [])[0]).toMatchObject({ status: 'cached', description: 'A door.' });
    });
    it('the report has one entry per media item, in case-file order, with the url the page renders', () => {
        const r = mediaReportFor([m('b', 'video'), m('a', 'image')], on, []);
        expect(r.map((x) => x.id)).toEqual(['b', 'a']);
        expect(r[0].url).toBe('/api/media/b.jpg');
        expect(r[0].kind).toBe('video');
    });
});

// ---------------------------------------------------------------- T16: the doors, the window, the funnel — the route's pure parts

describe('T16: the route never takes an id, and every new action is keyed on the number', () => {
    it('the source names no conversation id, quote id or call id from the request', () => {
        const fs = require('node:fs'); const path = require('node:path');
        // Code only: the header comment names the forbidden senders on purpose (it says they are never called).
        const src: string = (fs.readFileSync(path.join(__dirname, 'sandbox-routes.ts'), 'utf8') as string).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        // The only reads of the request body are the validated fields; nothing named *Id comes off req.
        expect(src).not.toMatch(/req\.(body|query|params)\??\.\w*[iI]d\b/);
        expect(src).not.toMatch(/req\.params/);
        // Nothing here sends: the exit, the drafts pipe, the outbound gate, the ack lane, the outreach, Pushover.
        for (const forbidden of ['approveAndSendDraft', 'queueDraft(', 'sendCustomerMessage', 'sendWhatsAppMessage', 'sendSmsMessage', 'maybeAutoAckFirstContact', 'maybeSendPostCallContinuation', 'maybeSendPostCallVideoRequest', 'notifyQuoteReadyToPrice', 'notifyQuoteAccepted', 'notifyEscalation', "from '../pushover'", 'runExit', "from './exit'"]) {
            expect(src.includes(forbidden), forbidden).toBe(false);
        }
        // The one thing that runs the desk passes sandbox: true, always.
        for (const m of src.matchAll(/runOnce\(([^)]*)\)/g)) expect(m[1]).toMatch(/sandbox: true/);
    });
    it('validateInboundChannel: whatsapp by default, sms allowed, a photo on SMS refused in words', () => {
        expect(validateInboundChannel(undefined, 0)).toEqual({ ok: true, channel: 'whatsapp' });
        expect(validateInboundChannel('sms', 0)).toEqual({ ok: true, channel: 'sms' });
        expect(validateInboundChannel('sms', 1)).toMatchObject({ ok: false, error: expect.stringMatching(/MMS/) });
        expect(validateInboundChannel('email', 0)).toMatchObject({ ok: false });
        expect(validateInboundChannel('whatsapp', 3)).toEqual({ ok: true, channel: 'whatsapp' });
    });
    it('validatePriceTotal: Ben\'s number wins, else the engine\'s suggestion, else a refusal', () => {
        expect(validatePriceTotal({ totalPence: 52000 }, 48000)).toEqual({ ok: true, totalPence: 52000, source: 'ben' });
        expect(validatePriceTotal({}, 48000)).toEqual({ ok: true, totalPence: 48000, source: 'suggested' });
        expect(validatePriceTotal({ totalPence: '' }, 48000)).toEqual({ ok: true, totalPence: 48000, source: 'suggested' });
        expect(validatePriceTotal({}, null)).toMatchObject({ ok: false });
        expect(validatePriceTotal({ totalPence: 12.5 }, 48000)).toMatchObject({ ok: false });
        expect(validatePriceTotal({ totalPence: 5_000_000 }, 48000)).toMatchObject({ ok: false });
    });
    it('mirrorSender names the live path and the pipe, and always says never sent', () => {
        expect(mirrorSender('rules layer ack', { mode: 'template', templateName: 'web_enquiry_ack_context' })).toBe('Sandbox (rules layer ack · template web_enquiry_ack_context · mirrored, never sent)');
        expect(mirrorSender('rules layer ack', { mode: 'sms', channel: 'sms' })).toBe('Sandbox (rules layer ack · by SMS · mirrored, never sent)');
        expect(mirrorSender('post-call continuation', { mode: 'template', templateName: 'post_call_continuation' })).toContain('post-call continuation · template post_call_continuation');
        expect(mirrorSender("Ben's send", { mode: 'freeform' })).toBe("Sandbox (Ben's send · freeform · mirrored, never sent)");
    });
    it('appendEvent keeps the newest, bounded', () => {
        let events = appendEvent(null, { at: '1', kind: 'entry', summary: 'a' });
        for (let i = 0; i < SANDBOX_EVENTS_MAX + 10; i++) events = appendEvent(events, { at: String(i), kind: 'clock', summary: 'x' });
        expect(events).toHaveLength(SANDBOX_EVENTS_MAX);
        expect(events.at(-1)?.at).toBe(String(SANDBOX_EVENTS_MAX + 9));
    });
    it('ackGateNote says what production would do on THIS server', () => {
        const base = { mode: 'freeform' as const, holdSeconds: [60, 150] as [number, number], door: 'whatsapp' as const };
        expect(ackGateNote({ ...base, gate: { enabled: true, channelOn: true, askForMedia: false, liveWouldSend: true } })).toMatch(/ON for whatsapp.*60 to 150 seconds/);
        expect(ackGateNote({ ...base, gate: { enabled: false, channelOn: false, askForMedia: false, liveWouldSend: false } })).toMatch(/OFF.*send NOTHING/);
        expect(ackGateNote({ ...base, door: 'sms', gate: { enabled: true, channelOn: false, askForMedia: false, liveWouldSend: false } })).toMatch(/not for this door/);
    });
    it('entrySummary reads per door', () => {
        const meaning = { label: 'x', window: 'y', firstReply: 'z' };
        // T19: the WhatsApp door's event is the customer's own message, and it opens the window.
        const wa = entrySummary({ door: 'whatsapp', meaning, ack: null, postCall: null, mirrored: null, firstRunTrigger: 'inbound_message', firstMessage: 'Hi, my extractor fan has died, NG7 2AB', openedWindow: true });
        expect(wa).toMatch(/customer's message "my extractor fan has died, NG7 2AB" created the thread and opened the 24 h window/); // enquirySnippet drops the greeting, as live does
        expect(wa).not.toMatch(/clean thread/);
        expect(entrySummary({ door: 'webform', meaning, ack: { mode: 'template', templateName: 'web_enquiry_ack_context', channel: 'whatsapp', reason: 'r' } as any, postCall: null, mirrored: null, firstRunTrigger: 'inbound_message' })).toMatch(/ack template \(web_enquiry_ack_context\) by whatsapp/);
        expect(entrySummary({ door: 'post_call', meaning, ack: null, postCall: { outcome: 'no_approved_template', reason: 'NO_APPROVED_TEMPLATE', call: { preview: 'Inbound call (4m)' } } as any, mirrored: null, firstRunTrigger: 'call_ended' })).toMatch(/Inbound call \(4m\); continuation NO_APPROVED_TEMPLATE/);
    });
});

describe('T16: the exit\'s tag bookkeeping is the one exit step the sandbox mirrors', () => {
    it('the mirrored list is exactly exit.ts PROPOSAL_TAG_ALLOWLIST (read from the source, so it cannot drift)', () => {
        const fs = require('node:fs'); const path = require('node:path');
        const src: string = fs.readFileSync(path.join(__dirname, 'exit.ts'), 'utf8');
        const m = /export const PROPOSAL_TAG_ALLOWLIST: readonly string\[\] = \[([^\]]+)\]/.exec(src);
        expect(m).toBeTruthy();
        const live = m![1].split(',').map((t) => t.trim().replace(/^'|'$/g, '')).filter(Boolean);
        expect([...MIRRORED_PROPOSAL_TAGS].sort()).toEqual([...live].sort());
    });
    it('proposalTagsToMirror: allowlisted, lower-cased, never on a drop, never a tag outside the list', () => {
        expect(proposalTagsToMirror({ proposal: { intent: 'ask_gap', body: [], reasons: [], tags: ['needs_quote', 'Rescope', 'photos_received', 'needs_ben'] }, decision: { kind: 'pending', dueAt: 'd', reason: 'r' } } as any)).toEqual(['needs_quote', 'rescope']);
        expect(proposalTagsToMirror({ proposal: { intent: 'ask_gap', body: [], reasons: [], tags: ['needs_quote'] }, decision: { kind: 'drop', reason: 'spam' } } as any)).toEqual([]);
        expect(proposalTagsToMirror({ proposal: null, decision: { kind: 'none', reason: 'x' } } as any)).toEqual([]);
    });
});
