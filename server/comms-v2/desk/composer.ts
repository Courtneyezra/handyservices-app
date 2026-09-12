/**
 * Contract 3, the composer: Fable 5.1 at medium effort, the only thing that ever writes to a
 * customer. One reply per customer turn that answers everything the turn asked, written from
 * facts on the file only. No figure, date, duration or commitment unless it is a sourced fact.
 * No disclosure line. Mirrors the customer's language and register. Returns the reply, the ids
 * of the facts it was written from, and the knowledge-base rows it cites. Structured output.
 *
 * The reply is one text with a blank line where a person would start a new bubble; the sender
 * splits it (Contract 5). The composer is called once per customer turn; a guard failure sends
 * it back once with the failures named, and a reply too long for its channel comes back once to
 * shorten, told in that channel's own measure: bubbles on WhatsApp, segments on SMS.
 * On a refusal or a transport failure the desk takes the fixed line, never a silent empty reply.
 */
import { z } from 'zod/v4';
import { ASK_SUBJECTS, type CaseFile, type Party, type Turn } from './case-file';
import type { FixedLine } from './fixed-lines';
import type { SpecialistReturn } from './desk-types';
import { COMPOSER_MODEL, type ModelClient, type StructuredResult } from './models';
import type { Route } from './router';
import { composerChannelLines } from '../channels/composer-lines';
import type { ShortenBrief } from './sender';

export const composerOutputSchema = z.object({
    /** The one reply. A blank line separates bubbles. */
    reply: z.string().min(1).max(2000),
    /** Ids of the facts on the file the reply was written from. */
    factIds: z.array(z.string()).max(40),
    /** Knowledge-base row ids cited for any business claim. */
    kbIds: z.array(z.string()).max(10),
});
export type ComposerOutput = z.infer<typeof composerOutputSchema>;

export interface ComposeInput {
    file: CaseFile;
    party: Party;
    turn: Turn;
    route: Route;
    specialists: SpecialistReturn[];
    /** Fixed lines the reply must carry, in Ben's words. */
    fixedLines: FixedLine[];
    /** Second attempt only: the guard failures, named. */
    failures?: string[];
    /** Second attempt only: the reply was too long for the channel it is going out on. */
    shorten?: ShortenBrief | null;
    /** The desk's clock. The channel lines re-run chooseChannel, whose WhatsApp window depends on it. */
    now?: Date;
}

export const COMPOSER_SYSTEM = [
    'You write the one reply that Ben\'s handyman business (Nottingham, UK) sends to a customer on WhatsApp. You are the desk\'s composer: the specialists have already worked out the facts and what to do next; you put it into words.',
    '',
    'What you may say:',
    '- Only what the customer wrote, the facts listed on the file, and the fixed lines you are given. Nothing else about the business.',
    '- Never a price, a figure, a cost, a date, a day, a time, a lead time or a duration. Never "we\'ll fix it", "we can sort that", a guarantee, a warranty or a promise about the work. Never an admission of fault. Never a claim about hours, coverage, insurance, qualifications, policies or fees.',
    '- The one exception: a date, a slot or a lead time that is a diary fact on the file which the notes from Scheduling tell you to copy verbatim; copy it exactly and cite its fact id. Never offer, suggest or agree a day, a slot or a change of date yourself.',
    '- Never say or hint that you are an assistant, a bot, AI or automated. No disclosure line. Never sign off with a name.',
    '',
    'How to sound:',
    '- Like a person typing on WhatsApp: warm, plain, brief. Mirror the customer\'s language and register. Contractions are fine.',
    '- Not a paragraph. Break the reply into bubbles the way a person separates messages: put a blank line between bubbles. Usually two or three bubbles, never more than four, each well under 300 characters. Each bubble is one thought.',
    '- Acknowledge what they said in your own words before anything else (quote their job back to them naturally).',
    '',
    'What to do this turn, from the proposal:',
    '- Answer everything the customer asked in this turn, from the facts. If they asked something you have no fact for, say Ben will come back to them on it.',
    '- The brief says what this turn is: either one question to ask, or a wrap-up because nothing is left to ask, or an acknowledgement only. Do that one thing.',
    '- When it names a question, ask exactly that one question about the job and no other, and do not say that you have everything you need. One thing at a time: one question, about one thing, one question mark about the job in the whole reply. Never join two questions with "and" or "or".',
    '- If the proposal says offer a call, offer to give them a quick call (for example "happy to give you a quick call if that\'s easier"). If it says do not offer a call, do not mention calling or the phone at all.',
    '- If the proposal says mention photos once, add in passing that a photo would help if it\'s easy, no pressure. Not a question, no question mark.',
    '- If the proposal says thank for media, thank them for the photo or video, once, and say what it shows in a few words if a description is on the file.',
    '- Subjects listed as "never ask again" must not be asked for or requested again in any form. If the customer has declined something, accept it in a few words without putting it in a question, and move on.',
    '- A short pause from the customer ("one sec") gets a very short "no rush" style reply and nothing else.',
    '- A promise of more ("I\'ll send photos tomorrow") gets one short acknowledgement that you will wait for it, and no question.',
    '- When it is a wrap-up, say that is everything needed for now and that Ben will put the quote together and send it over. No timing. Say this only on a wrap-up turn, never beside a question.',
    '- Fixed lines: include each one given, keeping its meaning and the words Ben will come back to them, woven into the reply naturally.',
    '',
    'Plain hyphens only; never an em dash. Return the JSON object only: reply, factIds (the ids of the facts you used), kbIds (the knowledge-base ids you cited, usually none).',
].join('\n');

function threadFor(file: CaseFile, turn: Turn): string {
    return file.turns.slice(-16).map((t) => {
        const media = t.media.length ? ` [${t.media.length} ${t.media[0].kind}${t.media.length > 1 ? 's' : ''}${t.media.map((m) => m.description ? `: ${m.description.description}` : '').join('')}]` : '';
        return `${t.id === turn.id ? '>> ' : ''}${t.direction === 'inbound' ? (file.parties.find((p) => p.personId === t.partyId)?.name ?? 'customer') : 'you'}: ${t.body}${media}`;
    }).join('\n');
}

export function buildComposerUser(input: ComposeInput): string {
    const { file, party, turn, route, specialists, fixedLines } = input;
    const proposal = specialists.find((s) => s.specialist === 'scoping')?.proposal ?? null;
    // Question subjects only: the ledger also carries markers for things done once per thread, which are nothing to ask about.
    const neverAsk = file.ledger.filter((l) => l.askedAt && (ASK_SUBJECTS as readonly string[]).includes(l.subject) && !(proposal?.nextQuestion?.subject === l.subject)).map((l) => l.subject);
    const declined = file.facts.filter((f) => f.key === 'media_declined' && /true/i.test(f.value)).length ? ['media'] : [];
    const lines: string[] = [];
    lines.push(`Customer: ${party.name ?? 'unknown name'}. Stage: ${file.stage}. Prefers text only: ${party.prefersText ? 'yes' : 'no'}.`);
    lines.push(...composerChannelLines(party, turn, input.now ?? new Date()));
    lines.push('Thread, oldest first (the turn to reply to is marked >>):');
    lines.push(threadFor(file, turn));
    lines.push('');
    lines.push('Facts on the file (id: key = value):');
    lines.push(file.facts.length ? file.facts.map((f) => `${f.id}: ${f.key} = ${f.value}`).join('\n') : '(none yet)');
    lines.push('');
    lines.push(`Turn kind: ${route.turnKind}. Subjects: ${route.subjects.join(', ')}. Exception: ${route.exception ?? 'none'}.`);
    if (proposal) {
        lines.push('Proposal from Scoping:');
        const q = proposal.nextQuestion;
        const question = q ? (q.subject === 'postcode' ? 'their location (postcode)' : q.subject === 'media' ? 'a photo, if easy, once' : q.subject === 'access' ? 'access (parking, someone in)' : `the job: ${q.unknowns.join(', ') || 'more detail'}`) : null;
        if (question) lines.push(`- this turn: ask one question about ${question}`);
        else if (proposal.ready && !['short_pause', 'promise_of_more', 'not_ready', 'acknowledgement'].includes(route.turnKind)) lines.push('- this turn: wrap up, nothing is left to ask; the job and the location are known, so say Ben will put the quote together and send it over');
        else lines.push('- this turn: an acknowledgement only, no question');
        lines.push(`- offer a call: ${proposal.offerCall ? 'yes' : 'no, do not mention calling'}`);
        lines.push(`- mention photos once: ${proposal.mentionPhotos ? 'yes, say a photo would help if easy, not as a question' : 'no'}`);
        lines.push(`- thank for media: ${proposal.thankForMedia ? 'yes' : 'no'}`);
    }
    const never = Array.from(new Set([...neverAsk, ...declined]));
    if (never.length) lines.push(`Never ask again (already asked or declined): ${never.map((s) => s === 'media' ? 'photos or video' : s).join(', ')}.`);
    for (const s of specialists) if (s.specialist !== 'scoping' && s.brief?.length) { lines.push(`Notes from ${s.specialist} (facts to copy verbatim, what not to say):`); for (const b of s.brief) lines.push(`- ${b}`); }
    if (fixedLines.length) {
        lines.push('Fixed lines to include, in Ben\'s words:');
        for (const f of fixedLines) lines.push(`- ${f.text}`);
    }
    if (input.failures?.length) {
        lines.push('');
        lines.push('Your previous draft failed these checks; write it again without them:');
        for (const f of input.failures) lines.push(`- ${f}`);
    }
    const shorten = input.shorten;
    if (shorten) {
        lines.push('');
        lines.push(shorten.channel === 'sms'
            ? `Your previous reply came to ${shorten.measured} SMS segments, over the ${shorten.ceiling} one text message may use. Say the same in one text message under ${shorten.charBudget} characters. Previous reply:`
            : `Your previous reply came to ${shorten.measured} bubbles, over the ceiling of ${shorten.ceiling}. Say the same in at most ${shorten.ceiling} short bubbles. Previous reply:`);
        lines.push(shorten.previous);
    }
    lines.push('');
    lines.push('Write the reply now.');
    return lines.join('\n');
}

export async function compose(input: ComposeInput, client: ModelClient): Promise<StructuredResult<ComposerOutput>> {
    const user = buildComposerUser(input);
    const res = await client.structured({ role: 'composer', model: COMPOSER_MODEL, effort: 'medium', system: COMPOSER_SYSTEM, user, schema: composerOutputSchema, maxTokens: 2000 });
    if (res.output) {
        // Only facts that are on the file count as cited; a made-up id is dropped, never recorded.
        const known = new Set(input.file.facts.map((f) => f.id));
        res.output.factIds = Array.from(new Set(res.output.factIds.filter((id) => known.has(id))));
        res.output.reply = res.output.reply.replace(/\u2014|\u2013/g, '-').trim();
    }
    return res;
}
