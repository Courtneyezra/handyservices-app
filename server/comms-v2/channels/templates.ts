/**
 * Which reply purpose a turn takes when the WhatsApp window is shut, and the ledger subject the
 * missed-call acknowledgement is recorded under.
 *
 * Every template this goal's channels send has its row in the one registry
 * (server/window-templates.ts) and its live status from the sync
 * (server/whatsapp-template-sync.ts); the sender's `pickTemplate` branches on purpose, never on a
 * name (Contract 5). There is no second list here: a row that sends unattended, which the
 * missed-call acknowledgement does, has to be visible on the go-live surface like every other.
 *
 * Off WhatsApp there is no approval to wait for: the same words go as the one SMS or the one
 * email, so a call follow-up and a missed-call text are never freeform (behaviour.md answers 20
 * and 34; the brief's rule that a post-call or missed-call follow-up is a template send).
 */
import { partyOf, type CaseFile, type Turn } from '../desk/case-file';
import { offerCall } from '../desk/scoping-tools';
import { CALL_OUTCOME_KEY, callOutcomeOnFile } from './call-adapter';
import { truncateWords } from './envelope';

/**
 * The ledger subject the missed-call acknowledgement is recorded under. It is not a question, so it
 * is not one of the case file's ASK_SUBJECTS; it is in the ledger because the ledger is the one
 * place a thing the desk does once per thread is written down, and a second missed call must not
 * put a second identical text out (checklist 3.5).
 */
export const MISSED_CALL_ACK_SUBJECT = 'missed_call_ack';

/** The reply purposes the four channels add to the sender's `service_reply`. */
export type ChannelReplyPurpose = 'web_form_ack' | 'web_form_ack_no_call' | 'post_call_followup' | 'missed_call';

/** Which purpose a turn's shut-window template carries, and the topic its second variable takes. */
export function templateChoiceFor(file: CaseFile, turn: Turn): { purpose: 'service_reply' | ChannelReplyPurpose; topic: string } {
    if (turn.kind === 'form') {
        // The web form acknowledgement quotes the enquiry back: the words they typed, cut on a word boundary.
        const enquiry = truncateWords(turn.body, 60);
        // The approved acknowledgement offers a call. A customer who has already rung us, who
        // prefers text, or who has been offered a call once is never asked again (checklist 1.5),
        // so that party takes the row with the offer taken out; unapproved, that holds the
        // acknowledgement for Ben with its words as the draft, which is the rule when no template
        // of the purpose is approved, never the asking one instead.
        const party = partyOf(file, turn.partyId);
        const purpose = party && !offerCall(party) ? 'web_form_ack_no_call' : 'web_form_ack';
        return { purpose, topic: enquiry || file.job.type || 'your enquiry' };
    }
    if (turn.kind === 'call_transcript') {
        const outcome = callOutcomeOnFile(file, turn);
        return { purpose: outcome === 'missed' ? 'missed_call' : 'post_call_followup', topic: file.job.type ?? 'your job' };
    }
    return { purpose: 'service_reply', topic: file.job.type ?? truncateWords(turn.body, 60) };
}

/** The `call_outcome` key, re-exported so a reader of the file need not import the adapter. */
export const CALL_OUTCOME_FACT = CALL_OUTCOME_KEY;
