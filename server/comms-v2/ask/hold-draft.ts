/**
 * Handy Desk - the ask agent's one customer-message write: a draft on the case file's hold.
 *
 * Nothing here sends. The draft lands where the desk puts a reply it held back (`Hold.draft`,
 * desk/case-file.ts), so the only way it reaches the customer is a person pressing send on it:
 * POST /api/comms-v2/case-files/:id/send-held-draft, desk/human-reply.ts `sendHeldDraft`, which runs
 * the approver check, the window rule, the bubble ceiling and, live, the opt-out ledger in
 * server/outbound.ts, exactly as for any held draft. It never writes a message_drafts row.
 *
 * The draft is composed words, so before it is held it must pass what the desk's own composed
 * replies pass (desk/guards.ts `runGuards`, as a person's action, the way quoting/deliver-quote.ts
 * checks a reply Ben licensed) with nothing cited: no figure, no date, no commitment, no business
 * claim, no disclosure, no repeated ask, no regulated work without its fixed line. It must also
 * render within the channel's ceiling as typed, since that is how the human path will send it. A
 * shut window does not stop the draft being held (the customer may write again first); it comes
 * back as a warning, and the send path refuses it until then.
 *
 * The hold: a file with no hold is held for its approver (`approverFor`, Ben for a homeowner) with
 * a reason that says who asked; a file already held without a draft gets the draft and the reason
 * noted on the standing hold (`noteOnHold`), which marks the card so nothing clears it
 * automatically; a file already holding a draft is refused, so the agent never overwrites a draft
 * the desk or an earlier ask put there.
 */
import {
    hold as raiseHold, noteOnHold, type CaseFile, type CaseFileDeps, type Hold, type ReplyChannel, type Turn,
} from '../desk/case-file';
import { approverFor, runGuards } from '../desk/guards';
import { withoutDashPunctuation } from '../desk/dashes';
import { chooseChannel, render, shortenBriefFor, windowOf } from '../desk/sender';
import { customerOf } from './surface';

/** The opening of every hold reason the ask agent writes. */
export const ASK_HOLD_MARK = 'Asked on the Handy Desk';

export type DraftCheck =
    | { ok: true; words: string; channel: ReplyChannel; windowState: 'open' | 'shut'; windowReason: string }
    | { ok: false; reason: string; failures: string[] };

function lastCustomerTurn(file: CaseFile, partyId: string): Turn | null {
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.partyId === partyId && t.direction === 'inbound') return t;
    }
    return null;
}

/** The words as they would be held, and whether they may be: the guards, the channel and the render, as the human send path will meet them. */
export function checkDraft(file: CaseFile, rawWords: string, now: Date): DraftCheck {
    const refuse = (reason: string, failures: string[] = []): DraftCheck => ({ ok: false, reason, failures });
    const words = withoutDashPunctuation(rawWords.replace(/\r\n/g, '\n')).trim();
    if (!words) return refuse('a draft needs words');
    const party = customerOf(file);
    if (!party) return refuse('the file has no customer to answer');
    const turn = lastCustomerTurn(file, party.personId);
    if (!turn) return refuse('no customer turn to answer');

    const choice = chooseChannel(party, turn.channel, now);
    if (!choice.ok) return refuse(choice.reason);
    const rendered = render(choice.channel, words, { asTyped: true });
    if (!rendered.ok) {
        if (rendered.reason === 'empty') return refuse('the draft rendered to nothing');
        const over = shortenBriefFor(choice.channel, words, rendered.bubbles);
        return refuse(over.channel === 'sms'
            ? `the draft comes to ${over.measured} text segments, over the ${over.ceiling} allowed; about ${over.charBudget} characters fit`
            : `the draft renders to ${over.measured} bubbles, over the ceiling of ${over.ceiling}; shorten it or use fewer blank lines`);
    }

    const guards = runGuards({ file, party, turn, reply: words, factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, prompted: 'human_action', liveQuoteRefs: new Set<string>() });
    if (!guards.ok) return refuse('the draft did not pass the desk\'s guards', guards.failures);

    const window = windowOf(party, choice.channel, now);
    return { ok: true, words, channel: choice.channel, windowState: window.state, windowReason: window.reason };
}

export interface HoldDraftInput {
    file: CaseFile;
    words: string;
    /** Who asked for the draft: the signed-in person's email or user id. */
    requestedBy: string;
    /** What the draft is for, in a few words, for the card. */
    why: string;
}

export type HoldDraftOutcome =
    | { ok: true; hold: Hold; draft: string; channel: ReplyChannel; warnings: string[] }
    | { ok: false; reason: string; failures: string[] };

/** Checks the words and puts them on the file's hold. Changes the file in place; the caller puts it back to its store. */
export function holdDraft(input: HoldDraftInput, deps: CaseFileDeps = {}): HoldDraftOutcome {
    const now = deps.now ?? (() => new Date());
    const { file } = input;
    if (file.hold?.draft) return { ok: false, reason: 'the file already holds a draft: send it, answer in your own words, or release the hold before drafting another', failures: [] };
    if (file.stage === 'done') return { ok: false, reason: 'the file is done; there is no thread to reply on', failures: [] };

    const check = checkDraft(file, input.words, now());
    if (!check.ok) return check;

    const why = input.why.replace(/\s+/g, ' ').trim().slice(0, 140);
    const reason = `${ASK_HOLD_MARK}: ${input.requestedBy} asked for a reply to be drafted${why ? ` (${why})` : ''}`;
    const held = file.hold
        ? noteOnHold(file, { reason, draft: check.words })
        : raiseHold(file, { approver: approverFor(file, null), reason, draft: check.words }, deps);
    if (!held.ok) return { ok: false, reason: held.reason, failures: [] };

    const warnings = check.windowState === 'shut'
        ? [`the ${check.channel} window is shut (${check.windowReason}); the draft cannot be sent until the customer writes again`]
        : [];
    return { ok: true, hold: held.value, draft: check.words, channel: check.channel, warnings };
}
