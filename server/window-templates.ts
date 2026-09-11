/**
 * The Meta templates for a SHUT WhatsApp window: build plan v2 item 4.1's five, and the two the
 * clean-sheet desk's other channels need (server/comms-v2/channels/templates.ts). There is one
 * registry, so a template that sends unattended is visible on the go-live surface; a second list
 * somewhere else would hide a live send from it.
 *
 * WhatsApp only carries free text for 24 hours after the customer's own last message. Outside that
 * window nothing but a template Meta approved in advance may leave, and approval takes days to
 * weeks — which is why these are defined and submitted before anything reads them. Nothing in this
 * file sends, wires or gates: item 4.2 maps each trigger to a pack intent and gives template sends
 * their own rule. Here there is only the DEFINITION: the name, Meta's category, the trigger it is
 * for, the variables, and the exact wording that goes to review.
 *
 * WHERE THIS SITS IN THE EXISTING SHAPE, because there must not be a second registry:
 *   · `server/template-status.ts` EXPECTED_TEMPLATES is the list of names the code expects, and it
 *     now derives its five window-shut rows from `WINDOW_TEMPLATES` below (`expectedFromWindowTemplates`).
 *     That is still the one registry; this file is where its rows get their category and wording.
 *   · `server/whatsapp-template-sync.ts` polls Twilio hourly and caches the live status; every read
 *     ("is it approved yet?") goes through `findApprovedTemplate` against that cache, never here.
 *   · `docs/comms-build/TEMPLATES-JOB-PACK.md` set the convention for the human-readable half; the
 *     window-shut equivalent is `docs/comms-build/TEMPLATES-WINDOW-SHUT.md`, and the submission
 *     steps are `docs/META-TEMPLATE-RUNBOOK.md`.
 *
 * NAMES ARE A PREFERENCE LIST, best first, exactly as FIRST_CONTACT_TEMPLATE_PREFERENCE and
 * READY_TEMPLATE_NAMES already are: approval status is Meta's to change and a name that is pending
 * today is approved tomorrow with no deploy. Two of the five reuse a name the account already has,
 * because Meta rejects a near-duplicate of a template it already approved (that is what killed
 * `first_contact_generic`), and the reused name is already the one the code reads.
 *
 * CATEGORY IS NOT DECORATION. Meta categorises every template and re-categorises on review; a
 * re-engagement message to a customer who went quiet is the shape it treats as MARKETING, which is
 * priced differently and needs recorded consent and a way to stop. The four service templates are
 * UTILITY. `purpose` carries the same fact into this codebase's own vocabulary
 * (`OutboundPurpose`), so the send gate can refuse the marketing one for a customer who wrote STOP
 * while a service reply still reaches them — a plain STOP blocks 'marketing' only
 * (server/opt-out.ts blockedByOptOut).
 */
import type { OutboundPurpose } from './opt-out';

/** Meta's own categories, as the Content API's ApprovalRequests endpoint spells them. */
export type MetaTemplateCategory = 'UTILITY' | 'MARKETING';

/** The named thing that fires a template send. 4.2 wires these; nothing here does. */
export interface WindowTemplateTrigger {
    /** Stable id, so 4.2's send rule and the checklist can name the same thing. */
    id: 'quote_ready' | 'question_unanswered' | 'webform_first_contact' | 'webform_first_contact_no_call' | 'post_call_followup' | 'missed_call' | 'enquiry_chase';
    /** When it fires, in one sentence a person can check against a thread. */
    when: string;
    /** The code that fires it (or, when `wired` is false, the code 4.2 will fire it from). */
    source: string;
    /** True when something in the repo already reaches this template today. */
    wired: boolean;
}

export interface WindowTemplate {
    /**
     * Twilio `friendly_name` / Meta template name, best first. Lowercase, digits and underscores
     * only. A second name is a fallback rung for when Meta rejects or has not yet approved the
     * first, never a second template for the same purpose.
     */
    names: [string, ...string[]];
    category: MetaTemplateCategory;
    /**
     * How the send gate must treat it. 'marketing' is the field that distinguishes the chase from
     * the four service templates — not its name, and not a reading of its wording.
     */
    purpose: OutboundPurpose;
    /** Twilio's `language` on the Content resource. Matches what each name was submitted under. */
    language: 'en' | 'en_GB';
    /** The exact body that goes to Meta. `{{n}}` placeholders, positional. */
    body: string;
    /** Sample values Meta reviews the body against, positional, as the Content API wants them. */
    variables: Record<string, string>;
    /** What each `{{n}}` is filled from at send time. */
    variableMeanings: Record<string, string>;
    trigger: WindowTemplateTrigger;
    /**
     * 'existing' — the first name is already a Content resource on the account, so the submission
     * script skips it and the runbook only checks its status. 'new' — never submitted from here.
     */
    submission: 'new' | 'existing';
    /** Why this wording, and what to do if Meta argues with it. */
    notes: string;
}

/**
 * The rows. Order is the plan's order (4.1) and then the clean-sheet desk's two, not a priority.
 *
 * Every body is written to the house voice rules in `shared/chat-voice.ts` (no em dash, no spaced
 * hyphen, no scheduling ping-pong closer) and to pass `checkDraft` with its sample values filled
 * in: no money figure, no date, no duration, no credential, no commitment. `window-templates.test.ts`
 * asserts both, because a template body is Meta's once approved and the only lever left is to
 * decline to send it.
 */
export const WINDOW_TEMPLATES: WindowTemplate[] = [
    {
        names: ['quote_ready_link'],
        category: 'UTILITY',
        purpose: 'service_reply',
        language: 'en_GB',
        body: 'Hi {{1}}, your quote is ready. Everything is on the link, the itemised price and the booking: {{2}}. Any questions, just reply here.',
        variables: { '1': 'Courtnee', '2': 'https://handyservices.app/quote/ab12cd34' },
        variableMeanings: { '1': "the customer's first name, or 'there'", '2': 'the quote link, https://handyservices.app/quote/<slug>' },
        trigger: {
            id: 'quote_ready',
            when: 'Ben sends the finished quote from the price screen and the WhatsApp window is shut.',
            source: 'server/agent-staff.ts deliverQuoteLink (QUOTE_LINK_TEMPLATE / QUOTE_LINK_TEMPLATE_NAME)',
            wired: true,
        },
        submission: 'existing',
        notes: 'Already the name the price screen reads, and already a Content resource on the account '
            + '(scripts/archive/_wa-templates-submit.ts submitted it). Submitting a second "your quote is ready" '
            + 'template would be the near-duplicate Meta rejects, so this definition records the existing name '
            + 'rather than inventing one. Nothing to deploy on approval: deliverQuoteLink resolves it by name '
            + 'against the cache. The body here is what was submitted; the live body is whatever Meta approved, '
            + 'shown on /admin/staff.',
    },
    {
        names: ['answer_ready_reopen_v1'],
        category: 'UTILITY',
        purpose: 'service_reply',
        language: 'en_GB',
        body: 'Hi {{1}}, you asked us about {{2}} and we have an answer for you. Reply to this message and we will send it straight over.',
        variables: { '1': 'Priya', '2': 'the extractor fan' },
        variableMeanings: { '1': "the customer's first name, or 'there'", '2': 'a short noun phrase for what they asked about, from their own message' },
        trigger: {
            id: 'question_unanswered',
            when: 'The customer asked something and the 24-hour window shut before the desk answered.',
            source: 'the spine exit, once 4.2 gives a template intent its own send rule (server/spine/exit.ts)',
            wired: false,
        },
        submission: 'new',
        notes: 'A RE-OPEN NUDGE, NOT THE ANSWER. It cannot carry the answer: a template body is fixed at '
            + 'approval and {{2}} is a subject, not a sentence. The real answer follows freeform on the pass '
            + 'after the customer replies, because their reply re-opens the window and the exit re-runs the '
            + 'stale check. Anyone wiring this must not treat the nudge as the reply.',
    },
    {
        names: ['web_enquiry_ack_context'],
        category: 'UTILITY',
        purpose: 'service_reply',
        language: 'en',
        body: 'Hi {{1}}, thanks for getting in touch. We got your message: "{{2}}". Is it OK if we give you a quick call {{3}} to run through it? Or just reply here with the details and we will price it up.',
        variables: { '1': 'there', '2': 'need a new bathroom tap fitted', '3': 'shortly' },
        variableMeanings: {
            '1': "the customer's first name, or 'there'",
            '2': 'their enquiry, verbatim, truncated on a word boundary to about 60 characters',
            '3': "'shortly' or 'in the morning', by the UK hour at send time",
        },
        trigger: {
            id: 'webform_first_contact',
            when: 'A webform enquiry arrives. A webform submission never opens the WhatsApp window, so without a template the desk cannot say anything at all on that door.',
            source: 'server/first-contact-ack.ts FIRST_CONTACT_TEMPLATE_PREFERENCE, via server/spine/packs/rules-first-contact.ts (ack_enquiry)',
            wired: true,
        },
        submission: 'existing',
        notes: 'REUSED, not replaced. The plan allows either a new first-contact carrier or the existing '
            + 'enquiry acknowledgement; this one already does the whole job the plan asks of the fourth '
            + 'template — it quotes the enquiry back and offers a call, which is answer 10 in the captain\'s '
            + 'own words — and it already sits top of the first-contact ladder, so a new name would compete '
            + 'with it for the same purpose and be rejected as a duplicate. Submitted 22 Aug 2026 under '
            + "language 'en', not 'en_GB'; keep that or the lookup finds nothing.",
    },
    {
        names: ['post_call_followup_v1', 'post_call_continuation_generic'],
        category: 'UTILITY',
        purpose: 'service_reply',
        language: 'en_GB',
        body: 'Hi {{1}}, good to speak just now about {{2}}. Whenever you get a chance, send over the photos we talked about and we will get your price to you. Just reply to this message.',
        variables: { '1': 'Marc', '2': 'the kitchen door' },
        variableMeanings: {
            '1': "the customer's first name, or 'there'",
            '2': "the job phrase from the call classification (calls.classification.jobPhrase); no phrase means the second name instead",
        },
        trigger: {
            id: 'post_call_followup',
            when: "Ben's own outbound call was answered and left a transcript, and the follow-up collects what he asked for on the phone. A call never opens the WhatsApp window.",
            source: 'server/post-call-ladder.ts → the spine as call_ended (T21); the template send itself is 4.2',
            wired: false,
        },
        submission: 'new',
        notes: 'SENDS UNATTENDED (the captain\'s answer 20), so the wording has to stand alone with nobody '
            + 'reading it: it states only what is true of every answered call Ben makes, asks for the one '
            + 'thing he asks for on the phone, and commits to nothing. {{2}} is the same classifier phrase '
            + 'post_call_continuation already fills unattended today; when there is no phrase, fall to the '
            + 'second name, which is the shape pickContinuationTemplate already has '
            + '(server/post-call-outreach.ts). DUPLICATE RISK: post_call_continuation is close enough that '
            + 'Meta may reject this as a near-duplicate. That is survivable rather than blocking, because '
            + 'post_call_continuation_generic is the second rung; if it is rejected, do not resubmit a reworded '
            + 'twin, use the generic and say so in the runbook\'s log.',
    },
    {
        names: ['web_enquiry_ack_no_call_v1'],
        category: 'UTILITY',
        purpose: 'service_reply',
        language: 'en_GB',
        body: 'Hi {{1}}, thanks for getting in touch. We got your message: "{{2}}". Reply here with anything else that helps and we will price it up for you.',
        variables: { '1': 'there', '2': 'need a new bathroom tap fitted' },
        variableMeanings: {
            '1': "the customer's first name, or 'there'",
            '2': 'their enquiry, verbatim, truncated on a word boundary to about 60 characters',
        },
        trigger: {
            id: 'webform_first_contact_no_call',
            when: 'A webform enquiry arrives from someone who has already rung us, or who prefers text, or who has been offered a call once already. Same acknowledgement, with the call offer taken out.',
            source: 'server/comms-v2/channels/templates.ts templateChoiceFor, via the desk\'s shut-window path',
            wired: true,
        },
        submission: 'new',
        notes: 'THE SAME ACKNOWLEDGEMENT WITHOUT THE ASK. web_enquiry_ack_context offers a call, and '
            + 'asking someone who just rang us whether we may ring them is the confidence leak checklist 1.5 '
            + 'names; the same rule already governs every composed reply through offerCall. Until Meta approves '
            + 'this name the shut-window pick finds nothing for the purpose and the acknowledgement is held for '
            + 'Ben with its words as the draft, which is the contract\'s rule for no approved template, never a '
            + 'freeform fallback. Wording is deliberately close to the approved one minus the offer; if Meta '
            + 'rejects it as a near-duplicate, the hold for Ben stands rather than a reworded twin.',
    },
    {
        names: ['missed_call_ack'],
        category: 'UTILITY',
        purpose: 'service_reply',
        language: 'en_GB',
        body: 'Hi {{1}}, sorry we missed your call. Tell us what needs doing and we will price it up for you, or we will try you again shortly.',
        variables: { '1': 'Sam' },
        variableMeanings: { '1': "the customer's first name, or 'there'" },
        trigger: {
            id: 'missed_call',
            when: 'The customer rang and nobody spoke to them. One text back per thread, never a second however many times they ring (checklist 3.5); the ask ledger holds the record. A call never opens the WhatsApp window.',
            source: 'server/comms-v2/channels/channel-desk.ts, on a call turn whose outcome is missed',
            wired: true,
        },
        submission: 'existing',
        notes: 'ALREADY APPROVED on the account, and already the name the old desk reads '
            + '(server/first-contact-ack.ts MISSED_CALL_TEMPLATE_PREFERENCE records the wording and its sid). '
            + 'It is here because the clean-sheet desk sends it unattended on a missed call, and an unattended '
            + 'send has to be visible on the go-live surface like every other. It never asks whether we may '
            + 'call: they just rang us (checklist 1.5). It folds into the live missed-call ack row in '
            + 'server/template-status.ts rather than adding a second row for the same name.',
    },
    {
        names: ['enquiry_followup_optin_v1'],
        category: 'MARKETING',
        purpose: 'marketing',
        language: 'en_GB',
        body: "Hi {{1}}, it's Handy Services. You got in touch about {{2}} and we have not heard back since. If you still want it doing, reply here and we will pick it up where we left off. If not, no problem at all. Reply STOP and we will not message you again.",
        variables: { '1': 'Ava', '2': 'the grab rails' },
        variableMeanings: { '1': "the customer's first name, or 'there'", '2': 'a short noun phrase for the job they enquired about' },
        trigger: {
            id: 'enquiry_chase',
            when: 'The chase ladder reaches its customer-facing rung on an enquiry that went quiet. Never on a customer who said they were not ready: that thread gets one acknowledgement and then silence (answers 8 and 19).',
            source: 'server/agents/sla-sweep.ts is the chase ladder today, and every rung of it pings Ben, not the customer. No customer-facing rung exists yet; 4.2 names it and owns the wiring.',
            wired: false,
        },
        submission: 'new',
        notes: 'THE ONLY MARKETING ONE. Meta treats re-engagement after silence as marketing whatever it is '
            + 'called, so it is submitted as MARKETING from the start rather than submitted as utility and '
            + 're-categorised later. It therefore needs consent-appropriate wording and a way out, which is '
            + 'the closing line, and `purpose: marketing` so a plain STOP recorded from any source blocks it '
            + 'while service replies still reach that customer. It names the business because a marketing '
            + 'message to someone who has not written for weeks has to say who is messaging them.',
    },
];

/** Look one up by trigger id. Returns undefined rather than throwing: callers choose the fallback. */
export function windowTemplateFor(trigger: WindowTemplateTrigger['id']): WindowTemplate | undefined {
    return WINDOW_TEMPLATES.find((t) => t.trigger.id === trigger);
}

/**
 * Every `{{n}}` the body actually uses, ascending and de-duplicated. Mirrors `placeholderIndexes`
 * in server/whatsapp-template-sync.ts, which is the reader that decides at send time how many
 * variables a template needs; this file cannot import it, because that module opens the DB pool.
 * Written as an exec loop rather than matchAll + Set: the project's tsc target refuses to iterate
 * either without --downlevelIteration.
 */
export function templatePlaceholders(body: string): string[] {
    const re = /\{\{\s*(\d+)\s*\}\}/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        if (!found.includes(m[1])) found.push(m[1]);
    }
    return found.sort((a, b) => Number(a) - Number(b));
}

/** The body with its sample values filled in — what Meta reviews, and what the guards check. */
export function renderSample(t: WindowTemplate): string {
    return t.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, k) => t.variables[k] ?? `{{${k}}}`);
}

/**
 * The five as EXPECTED_TEMPLATES rows, so `/admin/staff` and the go-live check see them through the
 * one registry they already read. `required: false` on all five on purpose: nothing reads them until
 * 4.2, and a name Meta has not approved yet must not turn the go-live check to NO-GO.
 */
export function expectedFromWindowTemplates() {
    return WINDOW_TEMPLATES.map((t) => ({
        purpose: `window shut: ${t.trigger.id.replace(/_/g, ' ')} (${t.category.toLowerCase()})`,
        usedBy: t.trigger.wired ? t.trigger.source : `4.1 definition only, wired by 4.2 — ${t.trigger.source}`,
        names: [...t.names],
        required: false,
    }));
}
