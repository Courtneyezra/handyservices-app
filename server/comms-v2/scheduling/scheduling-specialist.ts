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
 * quote" when it does not, the picker once a quote has been sent, the booked date once one
 * exists, and a hold for Ben on a date change to a booked job while the file is still answered
 * on everything else. The specialist never sees the customer and holds no send tool.
 *
 * Its return carries no prose: facts by id, the fixed lines to include by kind, and a brief for
 * the composer that names which fact to copy verbatim. The composer voices it.
 */
import { z } from 'zod/v4';
import { recordFact, type CaseFile, type ModelCallRecord, type Party, type Turn } from '../desk/case-file';
import type { Proposal, SpecialistReturn } from '../desk/desk-types';
import type { FixedLineKind } from '../desk/fixed-lines';
import { SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import { bookedDateOf, dateChangeMatch, dateQuestionMatch, pickerLink, standingBooking, typicalLeadTime, type BookedDate, type LeadTimeResult, type PickerLink, type SchedulingDeps } from './scheduling-tools';

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
    /** The belt's match on the turn, when the job is booked and the turn asks to move it. */
    dateChange: string | null;
    /** The fixed lines the reply must carry, by kind. */
    fixedLines: FixedLineKind[];
}

export interface SchedulingReturn extends SpecialistReturn {
    specialist: 'scheduling';
    brief: string[];
    scheduling: SchedulingFindings;
}

const NO_QUESTION: Proposal = { nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: false, hold: null };

export async function schedule(file: CaseFile, turn: Turn, _party: Party, client: ModelClient, deps: SchedulingDeps = {}): Promise<SchedulingReturn> {
    const calls: ModelCallRecord[] = [];
    const factIds: string[] = [];
    const brief: string[] = [];
    let error: string | null = null;
    const by = 'scheduling';
    const fileDeps = { now: deps.now };

    const standing = await standingBooking(file, deps);
    const booked = standing.state !== 'none';

    // The model classifies the ask.
    let asks: SchedulingAsk[] = [];
    let requestedChange: string | null = null;
    if (turn.body.trim()) {
        const user = [
            `Stage now: ${file.stage}. Quote sent: ${file.job.quoteRef ? 'yes' : 'no'}. Booked: ${standing.state === 'standing' ? 'yes' : standing.state === 'none' ? 'no' : 'not certain'}.`,
            'Thread, oldest first (the newest turn is marked >>):',
            threadFor(file, turn),
        ].join('\n');
        const res = await client.structured({ role: 'specialist', model: SPECIALIST_MODEL, effort: 'medium', system: SYSTEM, user, schema: schedulingOutputSchema, maxTokens: 300 });
        calls.push(res.record);
        if (res.output) { asks = Array.from(new Set(res.output.asks)); requestedChange = res.output.requestedChange; }
        else error = res.error;
    }

    // The belt: a date change to a booked job is a hold whatever the model read.
    const belt = booked ? dateChangeMatch(turn.body) : null;
    if (belt && !asks.includes('date_change')) asks.push('date_change');
    if (!booked) asks = asks.filter((a) => a !== 'date_change').concat(asks.includes('date_change') && !asks.includes('availability') ? ['availability'] : []);
    // A date question the belt matched is answered whatever the model read, or failed to: an unanswered date question is the one thing the desk may not do.
    if (!asks.length && dateQuestionMatch(turn.body)) asks = [booked ? 'booked_date' : 'availability'];

    // The tools, from the diary.
    const findings: SchedulingFindings = { asks, leadTime: null, bookedDate: null, picker: null, dateChange: null, fixedLines: [] };
    const proposal: Proposal = { ...NO_QUESTION };

    // The turn asks nothing about dates: nothing is looked up and nothing is said about timing.
    if (!asks.length) return { specialist: 'scheduling', factIds, proposal, brief, calls, error, scheduling: findings };

    if (booked) {
        findings.bookedDate = bookedDateOf(standing);
        if (findings.bookedDate.ok) {
            const bd = findings.bookedDate;
            const f = recordFact(file, { key: 'booked_date', value: bd.words, source: { kind: 'diary', rowId: bd.rowId }, by }, fileDeps);
            if (f.ok) { factIds.push(f.value.id); brief.push(`Booked date from the diary: say exactly "${bd.words}" and cite fact ${f.value.id}. Write the date in those words only: no weekday, no "this" or "next" before it.`); }
            if (bd.slot) {
                const s = recordFact(file, { key: 'booked_slot', value: bd.slot, source: { kind: 'diary', rowId: bd.rowId }, by }, fileDeps);
                if (s.ok) { factIds.push(s.value.id); brief.push(`The booked slot from the diary: "${bd.slot}" (fact ${s.value.id}).`); }
            }
            if (bd.days > 1) {
                const d = recordFact(file, { key: 'booked_days', value: `${bd.days} days`, source: { kind: 'diary', rowId: bd.rowId }, by }, fileDeps);
                if (d.ok) { factIds.push(d.value.id); brief.push(`It is booked over "${bd.days} days" (fact ${d.value.id}).`); }
            }
        } else {
            brief.push(`The diary has no booked date to confirm (${findings.bookedDate.reason}): say Ben will confirm the date, and give no day, time or lead time.`);
        }
        if (asks.includes('date_change')) {
            findings.dateChange = belt ?? requestedChange ?? turn.body.slice(0, 80);
            if (requestedChange) {
                const c = recordFact(file, { key: 'date_change_requested', value: requestedChange, source: { kind: 'thread', turnId: turn.id }, by }, fileDeps);
                if (c.ok) factIds.push(c.value.id);
            }
            findings.fixedLines.push('date_change_to_ben');
            proposal.hold = { reason: 'date_change', match: findings.dateChange };
            brief.push('They want to change the booked date: that is Ben\'s to do. Include the fixed line that Ben will come back on the date, confirm what is booked now if the diary gave it, and never offer, agree or suggest a new day or time. Answer anything else they asked.');
        }
    } else {
        findings.leadTime = await typicalLeadTime(deps);
        if (file.job.quoteRef) findings.picker = await pickerLink(file, deps);
        if (findings.picker?.ok) {
            const p = findings.picker;
            const f = recordFact(file, { key: 'picker_link', value: p.url, source: { kind: 'quote_line', quoteRef: p.quoteRef, line: 'picker' }, by }, fileDeps);
            if (f.ok) { factIds.push(f.value.id); brief.push(`Dates are picked on the quote page: give this link exactly, ${p.url} (fact ${f.value.id}). Booking happens there; never offer a day or a slot yourself.`); }
        }
        if (findings.leadTime.ok) {
            const lt = findings.leadTime;
            const f = recordFact(file, { key: 'lead_time', value: lt.phrase, source: { kind: 'diary', rowId: lt.rowId }, by }, fileDeps);
            if (f.ok) { factIds.push(f.value.id); brief.push(`Typical lead time from the diary: say exactly "${lt.phrase}" and cite fact ${f.value.id} (for example "we're usually booking in ${lt.phrase}"). Do not write the words "lead time". Not a promise of a day: never a specific day, date or time.`); }
        } else if (!findings.picker?.ok) {
            findings.fixedLines.push('dates_with_quote');
            brief.push(`The diary has no typical lead time to give (${findings.leadTime.reason}): include the fixed line that dates come with the quote, and never guess a day, a time or a lead time.`);
        } else {
            brief.push(`The diary has no typical lead time to give (${findings.leadTime.reason}): say nothing about how soon; the picker shows the dates.`);
        }
        if (!findings.picker?.ok && file.job.quoteRef && findings.picker) brief.push(`The quote's picker is not available (${findings.picker.reason}); do not give a link.`);
    }

    return { specialist: 'scheduling', factIds, proposal, brief, calls, error, scheduling: findings };
}
