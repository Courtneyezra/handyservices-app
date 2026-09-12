/**
 * The Scheduling specialist (Goal 5), on Sonnet 5 at medium effort. Subject: dates and lead
 * time. It states typical lead time and confirms a date that is already booked. It never offers
 * a slot and never books one; booking stays on the quote's picker. Returns facts with their
 * source and a proposal; never a sentence for the customer.
 *
 * Two halves, on the Scoping pattern. The model reads the thread and returns what the newest
 * turn asks about dates (lead time, availability, the booked date, a change to it) and, for a
 * change, the words they used. The tool server (scheduling-tools.ts) then decides everything
 * deterministically from the diary: a lead time when the diary has one, "dates come with your
 * quote" when it has none and the customer has no quote yet, whether none is on the file or the one
 * on it is still a draft, the picker once a quote has been sent, the booked date once one exists,
 * and a hold for Ben whenever there is nothing to say about dates, on a date change while the file is
 * still answered on everything else. A date change is the one ask that looks nothing else up: the job is already in the
 * diary, so a lead time and the picker would answer a question they did not ask.
 * The specialist never sees the customer and holds no send tool.
 *
 * Its return carries no prose: facts by id, the fixed lines to include by kind, and a brief for
 * the composer that names which fact to copy verbatim. The composer voices it.
 */
import { z } from 'zod/v4';
import { recordFact, type CaseFile, type ModelCallRecord, type Party, type Turn } from '../desk/case-file';
import type { Proposal, SpecialistReturn } from '../desk/desk-types';
import type { FixedLineKind } from '../desk/fixed-lines';
import { SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import { confirmBookedDate, dateChangeMatch, dateQuestionMatch, isTheirBooking, pickerLink, typicalLeadTime, type BookedDate, type LeadTimeResult, type PickerLink, type SchedulingDeps } from './scheduling-tools';

/**
 * What the turn asks, and every value is load-bearing: `date_change` holds for Ben, `booked_date`
 * confirms the day they already have, and `lead_time` or `availability` reads the diary's lead time,
 * which answers whatever job they are asking about. Somebody with a visit booked who asks how soon a
 * new job could be done is asking about the new one, so the lead time answers it, and the day they
 * already have is confirmed beside it rather than instead of it: they booked on this quote's picker
 * already, so no link goes with it. The grid in contracts.md holds the cell for every ask against
 * every state the diary read can return, and this branching reads from it.
 */
export const SCHEDULING_ASKS = ['lead_time', 'availability', 'booked_date', 'date_change'] as const;
export type SchedulingAsk = (typeof SCHEDULING_ASKS)[number];

export const schedulingOutputSchema = z.object({
    /** What the newest turn asks about dates. Empty when the turn touches dates without asking anything. */
    asks: z.array(z.enum(SCHEDULING_ASKS)).max(4),
    /** For a date change only: the day or time they want instead, in their words. Never a date the desk invents. */
    requestedChange: z.string().min(1).max(120).nullable(),
});
export type SchedulingOutput = z.infer<typeof schedulingOutputSchema>;

const SYSTEM = [
    'You are the Scheduling specialist for a small handyman business\'s desk. You never write to the customer. You read the thread and classify what the newest turn asks about dates, with no prose.',
    'asks: lead_time (how soon, how long until, when could you come, roughly when), availability (what dates or days do you have, any slots, can you do a given week), booked_date (what day is it booked for, when are you coming, confirming the date they have), date_change (move, change, push back, bring forward, reschedule, a different day for a booking they already have). A turn can ask more than one. A turn that only mentions timing in passing asks nothing: empty list.',
    'requestedChange: only for date_change, the day or time they want instead, in their own words ("the week after", "a Friday", "the 3rd"). Otherwise null. Never invent one.',
    'Never propose a date, a time, a slot or a lead time. You classify only.',
    'Reply with the JSON object only.',
].join('\n');

function threadFor(file: CaseFile, turn: Turn): string {
    return file.turns.slice(-12).map((t) => `${t.id === turn.id ? '>> ' : ''}${t.direction === 'inbound' ? 'customer' : 'desk'}: ${t.body}`).join('\n');
}

export interface SchedulingFindings {
    asks: SchedulingAsk[];
    leadTime: LeadTimeResult | null;
    bookedDate: BookedDate | null;
    picker: PickerLink | null;
    /** The words the turn asked to move the date in, when it did. */
    dateChange: string | null;
    /** The fixed lines the reply must carry, by kind. */
    fixedLines: FixedLineKind[];
}

export interface SchedulingReturn extends SpecialistReturn {
    specialist: 'scheduling';
    brief: string[];
    scheduling: SchedulingFindings;
}

/** What the desk already decided about this turn before the specialist ran. */
export interface SchedulingContext {
    /** The router's date_change exception: the desk reads this turn as a request to move a job the customer already has. */
    dateChange: boolean;
    /** The router's scheduling subject: it read the turn as about dates, whatever wording it used to ask. */
    scheduling?: boolean;
}

const NO_QUESTION: Proposal = { nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null };

export async function schedule(file: CaseFile, turn: Turn, _party: Party, client: ModelClient, deps: SchedulingDeps = {}, routed: SchedulingContext = { dateChange: false }): Promise<SchedulingReturn> {
    const calls: ModelCallRecord[] = [];
    const factIds: string[] = [];
    const brief: string[] = [];
    const details: string[] = [];
    let error: string | null = null;
    const by = 'scheduling';
    const fileDeps = { now: deps.now };
    // What went wrong reads the same to Ben and the logs as it does to the composer, except that the
    // machine text of a failed read stays here: a prompt only ever sees the category.
    const erroring = () => [error, ...details].filter(Boolean).join('; ') || null;

    const standing = await confirmBookedDate(file, deps);
    // The same filing as the picker's: a state the diary gave plainly is the right answer, and every
    // other refusal reaches the log and the run summary, because a file pointing at a booking the
    // diary does not hold is a defect nobody else will find.
    if (!standing.ok && !standing.expected) details.push(standing.detail ? `${standing.reason}: ${standing.detail}` : standing.reason);
    // Something may stand: the fail-closed reading, which a request to move a date is answered on.
    const couldStand = standing.state !== 'none';
    // The one reading of the booking this file says the customer has (scheduling-tools.ts): theirs from
    // the quote the file carries, or a read that could not say on a file that names a booking. The picker
    // refuses on it, the confirmation runs on it and a classification that never came back falls back on
    // it, so one file in one state can never get two answers.
    const theirs = isTheirBooking(file, standing);
    // The other half of that reading: a read that could not say where nothing on the file says there is a
    // booking is nothing known rather than a booking, and the picker answers what dates we have.
    const nothingKnown = standing.state === 'unknown' && !theirs;

    // The model classifies the ask.
    let asks: SchedulingAsk[] = [];
    let requestedChange: string | null = null;
    if (turn.body.trim()) {
        const user = [
            `Stage now: ${file.stage}. Quote sent: ${file.job.quoteRef ? 'yes' : 'no'}. Booked: ${standing.ok ? 'yes' : standing.state === 'none' ? 'no' : 'not certain'}.`,
            'Thread, oldest first (the newest turn is marked >>):',
            threadFor(file, turn),
        ].join('\n');
        const res = await client.structured({ role: 'specialist', model: SPECIALIST_MODEL, effort: 'medium', system: SYSTEM, user, schema: schedulingOutputSchema, maxTokens: 300 });
        calls.push(res.record);
        if (res.output) { asks = Array.from(new Set(res.output.asks)); requestedChange = res.output.requestedChange; }
        else error = res.error;
    }

    // A date change is live when the diary shows a booking, and when the router called the turn one:
    // nothing outside the door's fixture writes a booking onto a case file yet, so the exception stands in
    // for a booking the desk cannot see. Only then is a change request not an availability question.
    const changePossible = couldStand || routed.dateChange;
    // The belt: a date change is a hold whatever the model read.
    const belt = changePossible ? dateChangeMatch(turn.body) : null;
    if ((belt || routed.dateChange) && !asks.includes('date_change')) asks.push('date_change');
    if (!changePossible) asks = asks.filter((a) => a !== 'date_change').concat(asks.includes('date_change') && !asks.includes('availability') ? ['availability'] : []);
    // A classification that never came back is not a turn that asked nothing: a date question the belt matched is still answered, because an unanswered date question is the one thing the desk may not do. A model that read no ask is taken at its word.
    if (!asks.length && error && (dateQuestionMatch(turn.body) || routed.scheduling)) asks = [couldStand && !nothingKnown ? 'booked_date' : 'availability'];

    // The tools, from the diary.
    const findings: SchedulingFindings = { asks, leadTime: null, bookedDate: null, picker: null, dateChange: null, fixedLines: [] };
    const proposal: Proposal = { ...NO_QUESTION };

    // The turn asks nothing about dates: nothing is looked up and nothing is said about timing.
    if (!asks.length) return { specialist: 'scheduling', factIds, proposal, brief, calls, error: erroring(), scheduling: findings };

    /** What the diary says stands right now, or why it can say nothing. Never a date the diary did not give. */
    const confirmWhatStands = (changing: boolean) => {
        findings.bookedDate = standing;
        if (standing.ok) {
            const bd = standing;
            const f = recordFact(file, { key: 'booked_date', value: bd.words, source: { kind: 'diary', rowId: bd.rowId }, by }, fileDeps);
            if (f.ok) { factIds.push(f.value.id); brief.push(`Booked date from the diary: say exactly "${bd.words}" and cite fact ${f.value.id}. Write the date in those words only: no weekday, no "this" or "next" before it, and nothing about the time of day or how many days it takes: the diary gave the date and nothing else.`); }
            return;
        }
        if (!changing) {
            // Asked what day we are coming and the diary gave no date: a job nobody has taken on, one taken
            // off them, or a diary that could not say. The reply promises that Ben will come back on it, so
            // Ben is told; the hold's reason names which, since an unreadable diary may only need a retry.
            // What it forbids is a day of the desk's own: a typical lead time this turn looked up for a
            // second question they asked is the shelf's to give, and sits beside this without contradicting it.
            findings.fixedLines.push('date_change_to_ben');
            proposal.hold = { reason: 'date_unconfirmed', match: standing.reason };
            brief.push('There is no date to confirm and they may be expecting one: include the fixed line that Ben will come back on the date, never say they are booked in, say nothing about why, and never name a day or a time of your own. Answer anything else they asked.');
            return;
        }
        // Why there is no date is Ben's to give, in his own words: a cancellation a customer reads from the desk is how a thread becomes a complaint.
        brief.push('The diary has no booked date to confirm: say Ben will confirm the date, say nothing about why, and give no day, time or lead time.');
    };

    // A date change is Ben's, and nothing about how soon we could come belongs beside it: the job they
    // are asking about is already in the diary, so a typical lead time and the quote's picker would both
    // answer a question they did not ask. Neither is looked up on this path.
    if (asks.includes('date_change')) {
        confirmWhatStands(true);
        findings.dateChange = belt ?? requestedChange ?? turn.body.slice(0, 80);
        if (requestedChange) {
            const c = recordFact(file, { key: 'date_change_requested', value: requestedChange, source: { kind: 'thread', turnId: turn.id }, by }, fileDeps);
            if (c.ok) factIds.push(c.value.id);
        }
        findings.fixedLines.push('date_change_to_ben');
        proposal.hold = { reason: 'date_change', match: findings.dateChange };
        brief.push('They want to change the date of a job they already have: that is Ben\'s to do. Include the fixed line that Ben will come back on the date, confirm what is booked now if the diary gave it, and never offer, agree or suggest a new day, time or slot. Say nothing about how soon we could come, no typical lead time, and give no link for picking a date. Answer anything else they asked.');
    } else {
        // The confirmation decides first, and everything else reads from it. It runs when they asked for
        // the day, and whenever the picker would otherwise have gone to somebody who booked on it already:
        // a reply that withholds the link and says nothing about their day reads as not knowing they booked.
        const confirming = couldStand && (asks.includes('booked_date') || theirs);
        if (confirming) confirmWhatStands(false);
        // A day of theirs the reply states, which is an answer about dates in itself.
        const dateSaid = confirming && standing.ok;
        // A turn can ask more than one thing and each is answered: the shelf runs beside a confirmation
        // when they also asked how soon or what dates, and on its own when there was no date to confirm.
        if (confirming && !asks.some((a) => a === 'lead_time' || a === 'availability')) return { specialist: 'scheduling', factIds, proposal, brief, calls, error: erroring(), scheduling: findings };
        findings.leadTime = await typicalLeadTime(deps);
        if (!findings.leadTime.ok && findings.leadTime.detail) details.push(`${findings.leadTime.reason}: ${findings.leadTime.detail}`);
        // No link while the date is Ben's: one reply must not say he will come back on it and then send
        // them to the page where dates are picked.
        if (file.job.quoteRef && !proposal.hold) findings.picker = await pickerLink(file, deps, standing);
        // A refusal the desk meant is not an error; every other one reaches the log and the run summary,
        // because an expired or missing quote nobody is told about is one nobody fixes.
        if (findings.picker && !findings.picker.ok && !findings.picker.expected) details.push(findings.picker.detail ? `${findings.picker.reason}: ${findings.picker.detail}` : findings.picker.reason);
        if (findings.picker?.ok) {
            const p = findings.picker;
            const f = recordFact(file, { key: 'picker_link', value: p.url, source: { kind: 'quote_line', quoteRef: p.quoteRef, line: 'picker' }, by }, fileDeps);
            if (f.ok) { factIds.push(f.value.id); brief.push(`Dates are picked on the quote page: give this link exactly, ${p.url} (fact ${f.value.id}). Booking happens there; never offer a day or a slot yourself.`); }
        }
        if (findings.leadTime.ok) {
            const lt = findings.leadTime;
            const f = recordFact(file, { key: 'lead_time', value: lt.phrase, source: { kind: 'diary', rowId: lt.rowId }, by }, fileDeps);
            if (f.ok) { factIds.push(f.value.id); brief.push(`Typical lead time from the diary: say exactly "${lt.phrase}" and cite fact ${f.value.id} (for example "we're usually booking in ${lt.phrase}"). Do not write the words "lead time". Not a promise of a day: never a specific day, date or time.`); }
        } else if (!file.job.quoteRef || (!!findings.picker && !findings.picker.ok && !!findings.picker.unsent)) {
            // The one cell that line belongs to: no quote the customer has been sent, whether none is on
            // the file at all or the one on it is still a draft, which the picker refuses as `unsent` for
            // this reason. Somebody holding a quote, and a booking made from it, reads "dates come with
            // your quote" as the desk not knowing who they are.
            findings.fixedLines.push('dates_with_quote');
            brief.push('The diary has no typical lead time to give and the customer has no quote yet: include the fixed line that dates come with the quote, and never guess a day, a time or a lead time.');
        } else if (dateSaid || findings.picker?.ok || proposal.hold) {
            brief.push('The diary has no typical lead time to give: say nothing about how soon, and never guess a day, a time or a lead time.');
        } else {
            // Nothing left to say about dates at all: no day of theirs, no lead time, no page to pick on.
            // A date question answered with silence is the one thing the desk may not do, so Ben answers it.
            findings.fixedLines.push('date_change_to_ben');
            proposal.hold = { reason: 'date_unconfirmed', match: findings.picker && !findings.picker.ok ? findings.picker.reason : 'nothing to say about dates' };
            brief.push('There is nothing to say about dates: include the fixed line that Ben will come back on the date, say nothing about why, and never name a day, a time or a lead time of your own. Answer anything else they asked.');
        }
        if (!findings.picker?.ok && file.job.quoteRef && findings.picker) brief.push('There is no link to give for picking a date: give none, and say nothing about why.');
    }

    return { specialist: 'scheduling', factIds, proposal, brief, calls, error: erroring(), scheduling: findings };
}
