/**
 * The templates the other four channels need, and which reply purpose a turn takes when the
 * WhatsApp window is shut.
 *
 * Templates are named by the one registry (server/window-templates.ts) and approved by the live
 * sync (server/whatsapp-template-sync.ts); the sender's pick_template branches on purpose, never
 * on a name (Contract 5). Two of this goal's purposes have their row in that registry already
 * (`webform_first_contact`, `post_call_followup`). The missed-call acknowledgement has none: the
 * old comms kept it as a bare name in server/first-contact-ack.ts, and the old comms is deleted
 * whole later, so its definition lives here in the registry's own row shape until the registry
 * takes it at cutover. Its wording is the approved body on the account, one variable, the name.
 *
 * Off WhatsApp there is no approval to wait for: the same words go as the one SMS or the one
 * email, so a call follow-up and a missed-call text are never freeform (behaviour.md answers 20
 * and 34; the brief's rule that a post-call or missed-call follow-up is a template send).
 */
import type { WindowTemplate } from '../../window-templates';
import type { CaseFile, Turn } from '../desk/case-file';
import { CALL_OUTCOME_KEY, callOutcomeOnFile } from './call-adapter';
import { truncateWords } from './envelope';

/**
 * The ledger subject the missed-call acknowledgement is recorded under. It is not a question, so it
 * is not one of the case file's ASK_SUBJECTS; it is in the ledger because the ledger is the one
 * place a thing the desk does once per thread is written down, and a second missed call must not
 * put a second identical text out (checklist 3.5).
 */
export const MISSED_CALL_ACK_SUBJECT = 'missed_call_ack';

/** A registry row for a purpose the five-row registry does not carry yet. Same shape, its own trigger id. */
export type ChannelTemplate = Omit<WindowTemplate, 'trigger'> & { trigger: { id: 'missed_call'; when: string; source: string; wired: boolean } };

export const CHANNEL_TEMPLATES: ChannelTemplate[] = [
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
        notes: 'The name the account already has approved (server/first-contact-ack.ts MISSED_CALL_TEMPLATE_PREFERENCE). '
            + 'It never asks whether we may call: they just rang us (checklist 1.5).',
    },
];

/** The reply purposes the four channels add to the sender's `service_reply`. */
export type ChannelReplyPurpose = 'web_form_ack' | 'post_call_followup' | 'missed_call';

/** Which purpose a turn's shut-window template carries, and the topic its second variable takes. */
export function templateChoiceFor(file: CaseFile, turn: Turn): { purpose: 'service_reply' | ChannelReplyPurpose; topic: string } {
    if (turn.kind === 'form') {
        // The web form acknowledgement quotes the enquiry back: the words they typed, cut on a word boundary.
        const enquiry = truncateWords(turn.body, 60);
        return { purpose: 'web_form_ack', topic: enquiry || file.job.type || 'your enquiry' };
    }
    if (turn.kind === 'call_transcript') {
        const outcome = callOutcomeOnFile(file, turn);
        return { purpose: outcome === 'missed' ? 'missed_call' : 'post_call_followup', topic: file.job.type ?? 'your job' };
    }
    return { purpose: 'service_reply', topic: file.job.type ?? truncateWords(turn.body, 60) };
}

/** The `call_outcome` key, re-exported so a reader of the file need not import the adapter. */
export const CALL_OUTCOME_FACT = CALL_OUTCOME_KEY;
