/**
 * T16: the sandbox's four front doors and the messaging window, as PURE plans.
 *
 * A real lead arrives one of four ways, and each way leaves a different thread shape with
 * different rules about what may be said next:
 *
 *   whatsapp   an inbound WhatsApp (server/conversation-engine.ts). Opens the 24 h window.
 *              First contact: the rules layer's ack, freeform.
 *   post_call  an answered call where WhatsApp was agreed (server/call-thread.ts →
 *              post-call-ladder.ts → post-call-outreach.ts). A call NEVER opens the window, so the
 *              first WhatsApp is ALWAYS an approved template (post_call_continuation, one slot),
 *              or nothing at all when none is approved (fail closed, no legacy fallback).
 *   webform    a form submission (server/leads.ts). No window either: the ack goes as the first
 *              approved template on the first-contact ladder (web_enquiry_ack_context with the
 *              customer's own words in {{2}}), else by SMS, else it waits for Ben.
 *   sms        an inbound SMS (conversation-engine, bare From). SMS has no window and no
 *              templates; the ack and every reply go back by SMS, and the desk may invite a
 *              switch to WhatsApp once (prompts/scoper.core.md).
 *
 * Everything here is a plan computed from data the route hands in (the template cache as rows,
 * the config objects, the clock), never a send: the route mirrors the plan's outcome onto the
 * sandbox thread as a synthetic outbound and reports the plan. The decision functions are the live
 * ones wherever they are exported and pure (composeFirstContactAck, templatePreferenceFor,
 * mediaAskSentence, decideOutreach, pickContinuationTemplate, checkDraft, describeCall). The two
 * live helpers that are NOT exported (the enquiry snippet and the template-variable walk) are
 * mirrored here line for line and say so; T16-DONE lists them as the drift risk.
 */
import { composeFirstContactAck, templatePreferenceFor, mediaAskSentence, isPlaceholderName, looksLikeSpam, type FirstContactAckConfig, type FirstContactAckIntent } from '../first-contact-ack';
import { decideOutreach, pickContinuationTemplate, CONTINUATION_TEMPLATE, CONTINUATION_GENERIC_TEMPLATE, type PostCallContinuationConfig, type OutreachRoute } from '../post-call-outreach';
import { MIN_TRANSCRIPT_CHARS } from '../post-call-ladder';
import { checkDraft } from '../agents/draft-guards';
import { isOutOfHours, ukHourNow } from '../working-hours';
import { isLikelyRealName } from '@shared/contact-name';
import type { CallClassification } from '../call-classifier';

// ---------------------------------------------------------------- the doors

export type SandboxDoor = 'whatsapp' | 'post_call' | 'webform' | 'sms';
export const SANDBOX_DOORS: readonly SandboxDoor[] = ['whatsapp', 'post_call', 'webform', 'sms'];

/** One line per door for the page: which door, what it means for what may be said. */
export const DOOR_MEANING: Record<SandboxDoor, { label: string; window: string; firstReply: string }> = {
    whatsapp: {
        label: 'Inbound WhatsApp',
        window: 'Every customer WhatsApp opens the 24-hour window. While it is open we may write freely.',
        firstReply: 'The rules layer acknowledges first contact in its own words (freeform, held 60 to 150 seconds so it does not read as a bot). The desk answers from the next message.',
    },
    post_call: {
        label: 'Post-call, WhatsApp agreed on the phone',
        window: 'A phone call never opens the WhatsApp window. It stays SHUT until the customer writes on WhatsApp.',
        firstReply: 'The only lawful first WhatsApp is an approved Meta template: post_call_continuation ("good to speak just now about {{2}}") with the job from the call, or the generic one. No approved template means nothing can send. The call transcript also goes to the Quote clerk.',
    },
    webform: {
        label: 'Webform',
        window: 'A form opens no WhatsApp window. It is SHUT until the customer writes on WhatsApp.',
        firstReply: 'The first-contact ack goes as the first approved template on the ladder (web_enquiry_ack_context quotes the enquiry back), failing that by SMS in our own words, failing that it waits for Ben.',
    },
    sms: {
        label: 'Inbound SMS',
        window: 'SMS has no window and no templates. The WhatsApp window stays SHUT (an SMS does not open it).',
        firstReply: 'The ack and every reply go back by SMS. A UK long code cannot receive a photo, so the desk asks them to describe the job, and may invite a switch to WhatsApp once.',
    },
};

export const SANDBOX_START_TEXT_MAX = 2_000;
export const SANDBOX_NAME_MAX = 60;
export const SANDBOX_JOB_PHRASE_MAX = 60;
export const SANDBOX_TRANSCRIPT_MAX = 8_000;

/** Plausible defaults per door so one click opens a thread that reads like a real one. */
export const DOOR_DEFAULTS: Record<SandboxDoor, { name: string; text: string; jobPhrase: string; transcript: string }> = {
    whatsapp: { name: 'Sam', text: '', jobPhrase: '', transcript: '' },
    webform: { name: 'Priya Shah', text: 'Hi, the extractor fan in our bathroom has stopped working and the ceiling is getting damp. Can you replace it? We are in NG7.', jobPhrase: '', transcript: '' },
    sms: { name: 'Dave', text: 'Hi do you do gutters? Mine is overflowing at the back, Beeston', jobPhrase: '', transcript: '' },
    post_call: {
        name: 'Alex Morgan',
        text: '',
        jobPhrase: 'the bathroom extractor fan',
        transcript: 'Customer: Hi, I am ringing about a bathroom extractor fan that has packed in. It is in the ceiling, about four inch. Agent: No problem, is it just not spinning or making a noise? Customer: Nothing at all, the light works but the fan is dead. Agent: OK. If you can WhatsApp us a quick photo of the fan and the switch we can price it up today. Customer: Yes that is fine, do that. Agent: Great, I will send you a message on this number now so you can reply with the photos.',
    },
};

export interface StartInput {
    door: SandboxDoor;
    /** The customer's name as the door would know it (pushname, form field, the call's customer_name). Null = unknown. */
    name: string | null;
    /** The enquiry (webform), the first text (sms), or nothing (whatsapp: the owner types; post_call: the transcript speaks). */
    text: string;
    /** post_call: the classifier's customer-facing job phrase ({{2}} on the continuation template). */
    jobPhrase: string | null;
    /** post_call: what the classifier heard about WhatsApp. */
    whatsappAgreed: CallClassification['whatsappAgreed'];
    /** post_call: the transcript the clerk will read. */
    transcript: string;
}

export function validateStart(body: unknown): { ok: true; input: StartInput } | { ok: false; error: string } {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const door = typeof b.door === 'string' ? b.door : 'whatsapp';
    if (!(SANDBOX_DOORS as readonly string[]).includes(door)) return { ok: false, error: `door must be one of ${SANDBOX_DOORS.join(', ')}` };
    const d = door as SandboxDoor;
    const defaults = DOOR_DEFAULTS[d];
    const rawName = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : defaults.name;
    if (rawName.length > SANDBOX_NAME_MAX) return { ok: false, error: `name is over ${SANDBOX_NAME_MAX} characters` };
    const name = rawName || null;
    const text = (typeof b.text === 'string' ? b.text : defaults.text).replace(/\r\n/g, '\n').trim();
    if (text.length > SANDBOX_START_TEXT_MAX) return { ok: false, error: `text is over ${SANDBOX_START_TEXT_MAX} characters` };
    if ((d === 'webform' || d === 'sms') && !text) return { ok: false, error: `${d} needs the customer's words` };
    const jobPhrase = (typeof b.jobPhrase === 'string' ? b.jobPhrase : defaults.jobPhrase).replace(/\s+/g, ' ').trim();
    if (jobPhrase.length > SANDBOX_JOB_PHRASE_MAX * 2) return { ok: false, error: `jobPhrase is over ${SANDBOX_JOB_PHRASE_MAX * 2} characters` };
    const agreedRaw = typeof b.whatsappAgreed === 'string' ? b.whatsappAgreed : 'agreed';
    if (!['agreed', 'declined', 'not_discussed'].includes(agreedRaw)) return { ok: false, error: 'whatsappAgreed must be agreed, declined or not_discussed' };
    const transcript = (typeof b.transcript === 'string' ? b.transcript : defaults.transcript).trim();
    if (transcript.length > SANDBOX_TRANSCRIPT_MAX) return { ok: false, error: `transcript is over ${SANDBOX_TRANSCRIPT_MAX} characters` };
    if (d === 'post_call' && transcript.length < MIN_TRANSCRIPT_CHARS) return { ok: false, error: `post_call needs a transcript of at least ${MIN_TRANSCRIPT_CHARS} characters (the ladder's own bar)` };
    return { ok: true, input: { door: d, name, text, jobPhrase: jobPhrase || null, whatsappAgreed: agreedRaw as StartInput['whatsappAgreed'], transcript } };
}

// ---------------------------------------------------------------- the template cache, as data

/** One cached Meta template, as whatsapp_templates holds it (server/whatsapp-template-sync.ts). */
export interface TemplateRow { name: string; status: string; body: string | null; contentSid: string }

export interface LadderRung { name: string; status: string; picked: boolean; note: string }

/** Mirror of whatsapp-template-sync placeholderIndexes: the {{n}} the body actually uses. */
export function placeholderIndexes(body: string | null | undefined): string[] {
    if (!body) return [];
    const found = new Set<string>();
    for (const m of Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g))) found.add(m[1]);
    return Array.from(found).sort((a, b) => Number(a) - Number(b));
}

/** Mirror of whatsapp-template-sync renderTemplateBody. */
export function renderTemplateBody(body: string | null, vars: Record<string, string>): string {
    if (!body) return '';
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, k) => vars[k] ?? `{{${k}}}`);
}

/** Prefer an approved row when a name exists twice (a resubmission next to the old one) — template-status.ts's rule. */
export function templateByName(rows: readonly TemplateRow[]): Map<string, TemplateRow> {
    const byName = new Map<string, TemplateRow>();
    for (const r of rows) {
        const prior = byName.get(r.name);
        if (!prior || (prior.status !== 'approved' && r.status === 'approved')) byName.set(r.name, r);
    }
    return byName;
}

/**
 * Mirror of findApprovedTemplateWithValues (server/whatsapp-template-sync.ts): the first name on
 * the list that is APPROVED and whose placeholders can all be filled from `values`, positionally.
 * Every rung is reported so the page can say "web_enquiry_ack_context pending, call_request
 * approved: picked".
 */
export function walkTemplateLadder(names: readonly string[], values: readonly string[], rows: readonly TemplateRow[]): { picked: { name: string; contentSid: string; body: string; variables: Record<string, string> } | null; rungs: LadderRung[] } {
    const byName = templateByName(rows);
    const rungs: LadderRung[] = [];
    let picked: { name: string; contentSid: string; body: string; variables: Record<string, string> } | null = null;
    for (const name of names) {
        const row = byName.get(name);
        if (!row) { rungs.push({ name, status: 'missing', picked: false, note: 'not in the template cache' }); continue; }
        if (row.status !== 'approved') { rungs.push({ name, status: row.status, picked: false, note: `${row.status} with Meta: skipped` }); continue; }
        if (picked) { rungs.push({ name, status: row.status, picked: false, note: 'approved, but a higher rung was picked' }); continue; }
        const indexes = placeholderIndexes(row.body);
        if (indexes.length > values.length) { rungs.push({ name, status: row.status, picked: false, note: `needs ${indexes.length} variables, only ${values.length} available: skipped` }); continue; }
        const variables: Record<string, string> = {};
        for (let i = 0; i < indexes.length; i++) variables[String(i + 1)] = values[i];
        picked = { name: row.name, contentSid: row.contentSid, body: renderTemplateBody(row.body, variables), variables };
        rungs.push({ name, status: row.status, picked: true, note: 'approved and fillable: this is what the customer would receive' });
    }
    return { picked, rungs };
}

// ---------------------------------------------------------------- the first-contact ack ladder

/** first-contact-ack greetingFor's slot value: the first name, or "there". */
export function nameSlot(name: string | null | undefined): string {
    return isPlaceholderName(name) ? 'there' : String(name).trim().split(/\s+/)[0];
}

/**
 * Mirror of the enquiry snippet in runFirstContactAck ({{2}} on web_enquiry_ack_context): the
 * customer's own words, salutations stripped, cut at a word boundary near 60 characters.
 */
export function enquirySnippet(text: string | null | undefined): string {
    let raw = (text ?? '').replace(/\s+/g, ' ').trim();
    raw = raw.replace(/^(hi|hiya|hello|hey|good (morning|afternoon|evening))[\s,.!-]+/i, '')
        .replace(/^(i have rang earlier[\s,.!-]+|i called earlier[\s,.!-]+)/i, '')
        .trim();
    if (!raw) return 'your job';
    if (raw.length <= 60) return raw;
    const cut = raw.slice(0, 60);
    return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

export type AckMode = 'freeform' | 'template' | 'sms' | 'queued' | 'refused';

export interface AckPlan {
    door: SandboxDoor;
    intent: FirstContactAckIntent;
    mode: AckMode;
    /** The pipe the ack rides (null when nothing goes). */
    channel: 'whatsapp' | 'sms' | null;
    /** What the customer would read (the composed ack, or the approved template rendered). Null when nothing goes. */
    body: string | null;
    templateName: string | null;
    rungs: LadderRung[];
    outOfHours: boolean;
    /** The switches that gate the live send. The sandbox mirrors regardless and says so. */
    gate: { enabled: boolean; channelOn: boolean; askForMedia: boolean; liveWouldSend: boolean };
    /** Why nothing goes (spam screen), or why it goes the way it does. */
    reason: string;
    /** The realism hold: live, the ack lands 60 to 150 seconds after the message. */
    holdSeconds: [number, number];
}

export interface AckPlanInput {
    door: SandboxDoor;
    intent?: FirstContactAckIntent;
    name: string | null;
    text: string | null;
    hasMedia?: boolean;
    /** The 24 h window as the case file reads it for this thread (canSendFreeform). */
    windowOpen: boolean;
    config: FirstContactAckConfig;
    templates: readonly TemplateRow[];
    smsSenderConfigured: boolean;
    hour?: number;
}

/**
 * Mirror of runFirstContactAck's decision AFTER the history gate (a clean sandbox thread is by
 * construction first contact): screen → intent → compose → pipe → ladder → media ask.
 * Never sends; the route mirrors `body` onto the thread as a synthetic outbound on `channel`.
 */
export function planFirstContactAck(input: AckPlanInput): AckPlan {
    const hour = input.hour ?? ukHourNow();
    const outOfHours = isOutOfHours(hour);
    const liveChannel = input.door === 'post_call' ? 'post_call' : input.door;
    const gate = {
        enabled: !!input.config.enabled,
        channelOn: (input.config.channels ?? []).includes(liveChannel),
        askForMedia: !!input.config.askForMedia,
        liveWouldSend: false,
    };
    const intent: FirstContactAckIntent = input.intent ?? (input.hasMedia ? 'ack_photos' : 'ack_enquiry');
    const base = { door: input.door, intent, outOfHours, gate, holdSeconds: [60, 150] as [number, number] };

    const spam = looksLikeSpam(input.text);
    if (!spam.ok) {
        return { ...base, mode: 'refused', channel: null, body: null, templateName: null, rungs: [], reason: `LOOKS_LIKE_SPAM (${spam.detail}): the screen refuses to auto-ack; the message still lands on the board for a human` };
    }

    const composed = composeFirstContactAck({ intent, contactName: input.name, hour, prefersText: false });
    const smsOnly = input.door === 'sms';
    let body = composed.body;
    let mode: AckMode = 'freeform';
    let templateName: string | null = null;
    let rungs: LadderRung[] = [];
    let reason = 'window open: the composed ack goes freeform on WhatsApp';
    let contentSid: string | null = null;

    if (smsOnly) {
        mode = 'sms';
        reason = 'an SMS-first contact is answered by SMS (the number may not be on WhatsApp at all)';
    } else if (!input.windowOpen) {
        const walk = walkTemplateLadder(
            templatePreferenceFor(intent, false),
            [nameSlot(input.name), enquirySnippet(input.text), outOfHours ? 'in the morning' : 'shortly'],
            input.templates,
        );
        rungs = walk.rungs;
        if (walk.picked) {
            mode = 'template';
            body = walk.picked.body;
            templateName = walk.picked.name;
            contentSid = walk.picked.contentSid;
            reason = `window shut: the first approved template on the ladder carries the ack (${templateName}), in Meta's approved wording`;
        } else if (input.smsSenderConfigured) {
            mode = 'sms';
            reason = 'window shut and no approved template on the ladder: the composed ack goes by SMS instead (no window, no template needed)';
        } else {
            mode = 'queued';
            reason = 'window shut, no approved template, no SMS sender: queued for Ben, nothing to the customer';
        }
    }

    const channel: 'whatsapp' | 'sms' | null = mode === 'queued' ? null : (smsOnly || mode === 'sms') ? 'sms' : 'whatsapp';
    // T1: the media ask rides only a freeform or SMS body, never a template's, and only on these intents.
    if (gate.askForMedia && !contentSid && mode !== 'queued' && (intent === 'ack_enquiry' || intent === 'ack_returning')) {
        const ask = mediaAskSentence({ channel: channel === 'sms' ? 'sms' : 'whatsapp', outOfHours, prefersText: false });
        if (ask) body = `${body} ${ask}`;
    }
    gate.liveWouldSend = gate.enabled && gate.channelOn && mode !== 'queued';
    return { ...base, mode, channel, body: mode === 'queued' ? null : body, templateName, rungs, reason };
}

// ---------------------------------------------------------------- the post-call continuation

export interface PostCallPlanInput {
    classification: CallClassification;
    customerName: string | null;
    transcript: string;
    templates: readonly TemplateRow[];
    continuation: Pick<PostCallContinuationConfig, 'enabled'>;
    ack: Pick<FirstContactAckConfig, 'enabled' | 'channels'>;
    spineEnabled: boolean;
}

export interface PostCallPlan {
    route: OutreachRoute;
    /** What the customer would receive on WhatsApp, or null when nothing can send. */
    body: string | null;
    templateName: string | null;
    variables: Record<string, string>;
    rungs: LadderRung[];
    outcome: 'template' | 'no_approved_template' | 'not_agreed';
    /** The live reason string, in post-call-outreach's own words. */
    reason: string;
    /** Sent under the first-contact exception, or queued for Ben's approval. */
    approval: 'auto_first_contact' | 'queued_for_approval';
    gate: { continuationEnabled: boolean; ackEnabled: boolean; ackChannelOn: boolean; liveWouldSend: boolean };
    /** The ladder asks the spine for a `call_ended` run (transcript ≥ 40 chars, spine on). */
    spineRun: 'call_ended' | null;
    spineRunReason: string;
}

/** post-call-outreach's own greeting rule (not first-contact-ack's): a name unless it is a system label. */
export function postCallGreetName(customerName: string | null | undefined): string {
    const name = (customerName || '').trim();
    return name && !/^(unknown|customer|caller)/i.test(name) ? name.split(/\s+/)[0] : 'there';
}

/**
 * Mirror of maybeSendPostCallContinuation from the consent check onward (the mechanical rails —
 * fresh call, mobile number, not suppressed, nothing already on the thread — are true of a clean
 * sandbox thread by construction). Every decision here is the live function itself.
 */
export function planPostCallContinuation(input: PostCallPlanInput): PostCallPlan {
    const route = decideOutreach(input.classification, { allowUndiscussed: false });
    const gate = {
        continuationEnabled: !!input.continuation.enabled,
        ackEnabled: !!input.ack.enabled,
        ackChannelOn: (input.ack.channels ?? []).includes('post_call'),
        liveWouldSend: false,
    };
    const transcriptOk = input.transcript.trim().length >= MIN_TRANSCRIPT_CHARS;
    const spineRun: 'call_ended' | null = input.spineEnabled && transcriptOk ? 'call_ended' : null;
    const spineRunReason = !transcriptOk
        ? `transcript under ${MIN_TRANSCRIPT_CHARS} characters: the ladder asks the spine for nothing`
        : input.spineEnabled
            ? 'answered call with a transcript: the ladder asks the spine for a call_ended run (the Quote clerk reads the transcript)'
            : 'answered call with a transcript, but the spine is off on this server: live, no call_ended run would be asked for';
    const approval: PostCallPlan['approval'] = gate.ackEnabled && gate.ackChannelOn ? 'auto_first_contact' : 'queued_for_approval';
    const base = { route, approval, gate, spineRun, spineRunReason };

    if (route.reason !== 'AGREED_ON_CALL') {
        return { ...base, body: null, templateName: null, variables: {}, rungs: [], outcome: 'not_agreed', reason: `NOT_AGREED:${route.reason}${route.callbackDue ? ' — the thread parks on Ben\'s desk as callback_due' : ''}${route.tagNoAutoMessages ? ' — tagged no_auto_messages, nothing automated ever fires at it' : ''}` };
    }

    const greet = postCallGreetName(input.customerName);
    const byName = templateByName(input.templates);
    const rungs: LadderRung[] = [];
    const resolve = (choice: { name: string; variables: Record<string, string> }) => {
        const row = byName.get(choice.name);
        if (!row) { rungs.push({ name: choice.name, status: 'missing', picked: false, note: 'not in the template cache' }); return null; }
        if (row.status !== 'approved') { rungs.push({ name: choice.name, status: row.status, picked: false, note: `${row.status} with Meta: cannot send` }); return null; }
        const variables = { '1': greet, ...choice.variables };
        return { row, variables, body: renderTemplateBody(row.body, variables) };
    };

    let choice = pickContinuationTemplate(input.classification);
    let resolved = resolve(choice);
    if (resolved && choice.name === CONTINUATION_TEMPLATE) {
        const violation = checkDraft({ body: resolved.body, intent: 'post_call_continuation', quoteSeen: false, customerText: null });
        if (violation) {
            rungs.push({ name: CONTINUATION_TEMPLATE, status: resolved.row.status, picked: false, note: `approved, but the slotted body failed the draft guard (${violation.code}): the generic wording is used instead` });
            choice = { name: CONTINUATION_GENERIC_TEMPLATE, variables: {} };
            resolved = null;
        }
    }
    if (!resolved && choice.name !== CONTINUATION_GENERIC_TEMPLATE) choice = { name: CONTINUATION_GENERIC_TEMPLATE, variables: {} };
    if (!resolved) resolved = resolve(choice);
    if (!resolved) {
        return { ...base, body: null, templateName: null, variables: {}, rungs, outcome: 'no_approved_template', reason: 'NO_APPROVED_TEMPLATE: the window is shut (a call never opens it) and neither continuation template is approved by Meta, so there is no lawful way to deliver this. Nothing sends; the thread waits for Ben.' };
    }
    rungs.push({ name: resolved.row.name, status: resolved.row.status, picked: true, note: 'approved: this is what the customer would receive' });
    gate.liveWouldSend = gate.continuationEnabled;
    return {
        ...base, body: resolved.body, templateName: resolved.row.name, variables: resolved.variables, rungs, outcome: 'template',
        reason: gate.continuationEnabled
            ? `AGREED_ON_CALL: ${resolved.row.name} ${approval === 'auto_first_contact' ? 'auto-sends under the first-contact exception (held 60 to 150 seconds)' : 'is queued for Ben to approve (first-contact auto-send is off for post_call)'}`
            : `AGREED_ON_CALL, but post_call_continuation.enabled is off on this server: live, nothing would go (DISABLED)`,
    };
}

/** The classifier's verdict the sandbox seeds for a post-call door: what the model would have written for this call. */
export function sandboxClassification(input: Pick<StartInput, 'jobPhrase' | 'whatsappAgreed' | 'transcript'>, now: Date = new Date()): CallClassification {
    const phrase = (input.jobPhrase ?? '').trim();
    return {
        kind: 'job_enquiry',
        whatsappAgreed: input.whatsappAgreed,
        messagingObjection: input.whatsappAgreed === 'declined',
        jobSummary: phrase ? `Customer rang about ${phrase}; ${input.whatsappAgreed === 'agreed' ? 'agreed to send photos on WhatsApp' : 'WhatsApp ' + input.whatsappAgreed.replace('_', ' ')}.` : 'Customer rang about a job.',
        jobPhrase: phrase,
        urgency: 'normal',
        callbackPromised: false,
        callIncomplete: false,
        bullets: [phrase ? `Job: ${phrase}` : 'Job discussed on the call', `WhatsApp ${input.whatsappAgreed.replace('_', ' ')}`],
        classifiedAt: now.toISOString(),
    } as CallClassification;
}

// ---------------------------------------------------------------- the window

export const WINDOW_HOURS = 24;

export interface WindowReport {
    /** As canSendFreeform reads it: a customer WhatsApp within 24 h. */
    canFreeform: boolean;
    /** The last customer WhatsApp (NOT an SMS, NOT a call), or null when there has never been one. */
    lastWhatsAppInboundAt: string | null;
    hoursSince: number | null;
    channelLastUsed: 'whatsapp' | 'sms' | 'webchat' | 'email' | 'call' | null;
    /** One line for the header. */
    summary: string;
    /** What may be said, in words. */
    permits: string;
}

export function windowReport(input: { lastWhatsAppInboundAt: Date | string | null; channelLastUsed: WindowReport['channelLastUsed']; now?: Date }): WindowReport {
    const now = input.now ?? new Date();
    const at = input.lastWhatsAppInboundAt ? new Date(input.lastWhatsAppInboundAt) : null;
    const hoursSince = at && Number.isFinite(at.getTime()) ? Math.max(0, (now.getTime() - at.getTime()) / 3_600_000) : null;
    const canFreeform = hoursSince != null && hoursSince < WINDOW_HOURS;
    const sms = input.channelLastUsed === 'sms';
    const since = hoursSince == null ? 'never' : hoursSince < 1 ? `${Math.round(hoursSince * 60)} min ago` : `${hoursSince.toFixed(hoursSince < 48 ? 1 : 0)} h ago`;
    const summary = canFreeform
        ? `OPEN — last customer WhatsApp ${since}; shuts ${(WINDOW_HOURS - hoursSince!).toFixed(1)} h from now`
        : `SHUT — last customer WhatsApp ${since}`;
    const permits = sms
        ? 'The customer last wrote by SMS: replies go by SMS (no window, no template). The WhatsApp window is what it says on the left.'
        : canFreeform
            ? 'We may write freely on WhatsApp.'
            : 'Only an approved Meta template may go on WhatsApp; a freeform draft would be refused (63016). SMS has no window.';
    return { canFreeform, lastWhatsAppInboundAt: at ? at.toISOString() : null, hoursSince: hoursSince == null ? null : Math.round(hoursSince * 10) / 10, channelLastUsed: input.channelLastUsed, summary, permits };
}

export const AGE_MAX_HOURS = 24 * 30;

/** Hours to move the thread back by: a positive number of hours up to 30 days. */
export function validateAge(body: unknown): { ok: true; hours: number } | { ok: false; error: string } {
    const b = (body && typeof body === 'object' ? body : {}) as { hours?: unknown };
    const hours = Number(b.hours ?? 25);
    if (!Number.isFinite(hours) || hours <= 0 || hours > AGE_MAX_HOURS) return { ok: false, error: `hours must be between 0 and ${AGE_MAX_HOURS}` };
    return { ok: true, hours: Math.round(hours * 100) / 100 };
}

/** A clock pass: what a sweep does — a run with no new customer message. Only the two non-inbound triggers a clock can hold. */
export const CLOCK_TRIGGERS = ['cadence', 'manual'] as const;
export type ClockTrigger = (typeof CLOCK_TRIGGERS)[number];
export function validateClockTrigger(body: unknown): { ok: true; trigger: ClockTrigger } | { ok: false; error: string } {
    const b = (body && typeof body === 'object' ? body : {}) as { trigger?: unknown };
    const t = typeof b.trigger === 'string' ? b.trigger : 'cadence';
    if (!(CLOCK_TRIGGERS as readonly string[]).includes(t)) return { ok: false, error: `trigger must be one of ${CLOCK_TRIGGERS.join(', ')}` };
    return { ok: true, trigger: t as ClockTrigger };
}

// ---------------------------------------------------------------- the funnel's mirrors of Ben's phone
// quoteReadyNotice / quoteAcceptedNotice live in sandbox.ts (dependency-light, read by runOnce) and
// are re-exported here so the route and the tests read them from one place.
export { quoteReadyNotice, quoteAcceptedNotice, type SandboxBenNotice as BenNotice } from './sandbox';

// ---------------------------------------------------------------- the quote link's delivery

export type QuoteLinkMode = 'freeform' | 'template' | 'queued';

export interface QuoteLinkPlan { mode: QuoteLinkMode; body: string | null; templateName: string | null; reason: string }

/** The quotes.ts wording, the line the customer reads when Ben sends. */
export function quoteLinkMessage(input: { firstName: string | null; totalPence: number; quoteUrl: string }): string {
    return `Hi ${input.firstName || 'there'}! Here's your quote for £${(input.totalPence / 100).toFixed(2)}.\nClick to view and book: ${input.quoteUrl}`;
}

/**
 * Mirror of deliverQuoteLink (server/agent-staff.ts): window open → the message goes freeform;
 * shut → the dedicated approved template (quote_ready_link) if Meta has approved it; else the
 * message is queued for the window to reopen and the customer has nothing yet. (Live there is a
 * further quick-reply-template fallback the sandbox does not model; T16-DONE says so.)
 */
export function planQuoteLinkDelivery(input: { windowOpen: boolean; firstName: string | null; totalPence: number; quoteUrl: string; templates: readonly TemplateRow[]; templateName?: string }): QuoteLinkPlan {
    const message = quoteLinkMessage(input);
    if (input.windowOpen) return { mode: 'freeform', body: message, templateName: null, reason: 'window open: the quote message goes freeform on WhatsApp' };
    const name = input.templateName ?? 'quote_ready_link';
    const row = templateByName(input.templates).get(name);
    if (row && row.status === 'approved') {
        const idx = placeholderIndexes(row.body);
        // Hint-driven live (buildTemplateVariables); here: the first slot is the name, the last the link.
        const variables: Record<string, string> = {};
        for (const k of idx) variables[k] = k === idx[idx.length - 1] && idx.length > 1 ? input.quoteUrl : (idx.length === 1 ? input.quoteUrl : (input.firstName || 'there'));
        const body = renderTemplateBody(row.body, variables);
        if (!body.includes(input.quoteUrl)) return { mode: 'queued', body: null, templateName: name, reason: `${name} is approved but its body has nowhere to put the link: queued for the window to reopen` };
        return { mode: 'template', body, templateName: name, reason: `window shut: ${name} (approved) carries the link` };
    }
    return { mode: 'queued', body: null, templateName: null, reason: `window shut and ${name} is ${row ? row.status : 'not in the cache'}: queued until the customer writes on WhatsApp again. The quote is priced, but the customer has nothing yet.` };
}

/** True when the given name reads as a person (the sandbox's default label does not). */
export function looksLikeAName(name: string | null | undefined): boolean {
    return !!name && isLikelyRealName(name) && !isPlaceholderName(name);
}
