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
import { ASK_SUBJECTS, customerVisibleFacts, isSupersededFigure, type CaseFile, type Party, type ReplyChannel, type Turn, isTurnOf, mediaFailedNote, type TurnMedia, mediaCountLabel } from './case-file';
import type { FixedLine } from './fixed-lines';
import type { SpecialistReturn } from './desk-types';
import { COMPOSER_MODEL, type ModelClient, type StructuredResult } from './models';
import type { Route } from './router';
import { composerChannelLines } from '../channels/composer-lines';
import { GSM7_MULTI } from '../channels/sms-adapter';
import { BUBBLE_CEILING, BUBBLE_MAX_CHARS, type ShortenBrief } from './sender';
import { withoutDashPunctuation } from './dashes';

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
    /**
     * What the router made of the turn. Only the three fields the prompt shows, so a send with no
     * router call behind it - Ben's priced quote leaving the price screen - can name what it is
     * without a fabricated call record.
     */
    route: Pick<Route, 'turnKind' | 'subjects' | 'exceptions'>;
    specialists: SpecialistReturn[];
    /** Fixed lines the reply must carry, in Ben's words. */
    fixedLines: FixedLine[];
    /**
     * The late thanks for a photo or video that came in well before this turn. The desk adds it as a
     * bubble after the reply, so the composer is told to leave that media alone and keep a bubble free.
     */
    lateAck?: FixedLine | null;
    /** Second attempt only: the guard failures, named. */
    failures?: string[];
    /** Second attempt only: the reply was too long for the channel it is going out on. */
    shorten?: ShortenBrief | null;
    /** The desk's clock. The channel lines re-run chooseChannel, whose WhatsApp window depends on it. */
    now?: Date;
    /**
     * The channel the send actually goes out on, when the caller has already resolved it. The quote
     * delivery does, and may have resolved one chooseChannel would not, so the composer is told
     * rather than left to work it out and be shaped for the wrong channel.
     */
    channel?: ReplyChannel;
    /** Characters the caller is putting in the send ahead of this reply: the budget it is told is what is left. */
    reserved?: number;
}

export const COMPOSER_SYSTEM = [
    'You write the one reply that Ben\'s handyman business (Nottingham, UK) sends to a customer on WhatsApp. You are the desk\'s composer: the specialists have already worked out the facts and what to do next; you put it into words.',
    '',
    'What you may say:',
    '- Only what the customer wrote, the facts listed on the file, and the fixed lines you are given. Nothing else about the business.',
    '- Never a price, a figure or a cost of your own. A figure may appear only when a fact on the file whose key starts with quote_line carries it: copy it exactly as written on that fact, to the penny (£120.00, never £120 or "about £120"), cite the fact id, and never add figures up or work one out. Never a date, a day, a time, a lead time or a duration. Never "we\'ll fix it", "we can sort that", a guarantee, a warranty or a promise about the work. Never an admission of fault. Never a claim about hours, coverage, insurance, qualifications, policies or fees, unless it is a knowledge-base fact on the file: then use its words exactly as given, verbatim and unparaphrased, and list that knowledge-base id in kbIds.',
    '- The one exception on dates: a date or a lead time that is a diary fact on the file which the notes from Scheduling tell you to copy verbatim; copy it exactly and cite its fact id. Never offer, suggest or agree a day, a time of day, a slot or a change of date yourself.',
    '- Never say or hint that you are an assistant, a bot, AI or automated. No disclosure line. Never sign off with a name.',
    '',
    'How to sound:',
    '- Like a person typing on WhatsApp: warm, plain, brief. Mirror the customer\'s language and register. Contractions are fine.',
    '- Not a paragraph. Break the reply into bubbles the way a person separates messages: put a blank line between bubbles. Usually one to three bubbles, never more than three. Each bubble is one thought in one or two short sentences, about 160 characters at most.',
    '- Acknowledge what they said in a few words of your own before anything else. Sum the job up back to them once, the first time it is clear; never repeat a summary of the job you have already given in the thread.',
    '- Never say again what your last message already said, in any words. Never call a question the last one ("one last thing", "last bit from me"): just ask it.',
    '- You are Ben, writing in the first person. Never mention Ben, the office, the team or a colleague in the third person: when an answer is not yours to give yet, say you will check and come back to them, naming nobody.',
    '',
    'What to do this turn, from the proposal:',
    '- Answer everything the customer asked in this turn, from the facts. If they asked something you have no fact for, say you will come back to them on it.',
    '- The brief says what this turn is: either one question to ask, or a wrap-up because nothing is left to ask, or an acknowledgement only. Do that one thing.',
    '- When it names a question, ask exactly that one question about the job and no other, and do not say that you have everything you need. One thing at a time: one question, about one thing, one question mark about the job in the whole reply. Never join two questions with "and" or "or".',
    '- If the proposal says offer a call, offer to give them a quick call (for example "happy to give you a quick call if that\'s easier"). If it says do not offer a call, do not mention calling or the phone at all.',
    '- If the proposal says mention photos once, add in passing that a photo would help if it\'s easy, no pressure. Not a question, no question mark.',
    '- If the proposal says thank for media, thank them for the photo or video, once, and mention one light detail of what it shows in a few natural words, the way a person glancing at it would ("I can see the old handles there"). Never describe it in full, and never name a defect, damage, wear, a brand, a model or a condition the customer did not mention themselves. Never ask whether they want work done that they did not ask for.',
    '- Subjects listed as "never ask again" must not be asked for or requested again in any form. If the customer has declined something, accept it in a few words without putting it in a question, and move on.',
    '- A short pause from the customer ("one sec") gets a very short "no rush" style reply and nothing else.',
    '- A promise of more ("I\'ll send photos tomorrow") gets one short acknowledgement that you will wait for it, and no question.',
    '- When it is a wrap-up, say that is everything needed for now and that you will put the quote together and send it over. No timing. Say this only on a wrap-up turn, never beside a question, and only once: if your last message already said it, write one short acknowledgement instead.',
    '- An acknowledgement-only turn ("thanks", "ok") gets one short bubble, a brief human reply of a few words ("No worries 👍"). Nothing your last message already said, and not the quote news again.',
    '- When the brief says Ben has priced and sent the quote, you are writing the delivery, not a reply: tell them the quote is ready, give the link exactly as the brief spells it, and say to reply here with any questions. Do not answer their last message again, and give no figure, no timing and no other promise.',
    '- Fixed lines: include each one given, keeping its meaning and its first-person words, woven into the reply naturally.',
    '',
    'No dash as punctuation: never " - " between words, never an em dash or an en dash. Where a dash would join two thoughts, use a comma or a full stop instead. A hyphenated word (follow-up) is fine. Return the JSON object only: reply, factIds (the ids of the facts you used), kbIds (the knowledge-base ids you cited, usually none).',
].join('\n');

/**
 * What the composer is told a photo shows: the plain opening of its description, without the parts
 * written for Ben's eyes (`Defects:`, `Text seen:`, `Not shown:`, the confidence; server/spine/tools/
 * describe-video.ts formatDescription). A reply mentions one light detail of a photo (behaviour.md
 * answer 92), never an inspection report, a brand read off a box or work nobody asked for.
 */
export function lightPhotoSummary(description: string): string {
    return description.split(/\s*\b(?:Defects|Text seen|Not shown):/)[0].replace(/\s*\(confidence \w+\)\s*$/i, '').trim();
}

const RE_TEXT_SEEN = /\bText seen:\s*(.*?)\.?(?=\s*(?:Not shown:|\(confidence\b|$))/;
const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/**
 * The words a photo showed that nobody on the thread wrote: what the photo model read off a box or a
 * label (`Text seen:`), less every word a customer typed. A brand is only ever one of these, and it
 * also rides into the opening sentence and into a job detail the specialist took from the photo, so
 * the composer is shown neither (answer 92: never a brand the customer did not mention).
 */
export function unmentionedPhotoText(file: CaseFile): Set<string> {
    const descriptions = [
        ...file.turns.flatMap((t) => t.media.map((m) => m.description?.description ?? '')),
        ...file.facts.filter((f) => f.source.kind === 'media_description').map((f) => f.value),
    ];
    const read = descriptions.flatMap((d) => words(RE_TEXT_SEEN.exec(d)?.[1] ?? ''));
    const typed = new Set(file.turns.filter((t) => t.direction === 'inbound').flatMap((t) => words(t.body ?? '')));
    return new Set(read.filter((w) => !typed.has(w)));
}

function withoutWords(text: string, drop: Set<string>): string {
    if (!drop.size) return text;
    return text.split(/(\s+)/).filter((piece) => {
        const w = words(piece);
        return !(w.length && w.every((x) => drop.has(x)));
    }).join('').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?)])/g, '$1').trim();
}

/** Said of a photo or video no description came back for, so the composer does not invent what it shows. */
const NOT_SEEN = 'not seen by you';

/**
 * A turn's media as the thread shows it: "[1 photo and 1 video: photo, <what it shows>; video, <what it shows>]".
 * One the vision model could not describe is marked as not seen ("[1 video, not seen by you]").
 */
function mediaFor(media: TurnMedia[], unmentioned: Set<string>): string {
    const mixed = new Set(media.map((m) => m.kind)).size > 1;
    const shown = media.filter((m) => m.description).map((m) => `${mixed ? `${m.kind === 'image' ? 'photo' : 'video'}, ` : ''}${withoutWords(lightPhotoSummary(m.description!.description), unmentioned).replace(/\.$/, '')}`);
    const unseen = media.filter((m) => !m.description);
    if (!shown.length) return ` [${mediaCountLabel(media)}, ${NOT_SEEN}]`;
    if (unseen.length) shown.push(`${mediaCountLabel(unseen)} ${NOT_SEEN}`);
    return ` [${mediaCountLabel(media)}: ${shown.join('; ')}]`;
}

function threadFor(file: CaseFile, turn: Turn, unmentioned: Set<string>): string {
    return file.turns.slice(-16).map((t) => {
        const media = t.media.length ? mediaFor(t.media, unmentioned) : '';
        const said = [`${t.body}${media}`.trim(), mediaFailedNote(t)].filter(Boolean).join(' ');
        return `${isTurnOf(t, turn) ? '>> ' : ''}${t.direction === 'inbound' ? (file.parties.find((p) => p.personId === t.partyId)?.name ?? 'customer') : 'you'}: ${said}`;
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
    lines.push(...composerChannelLines(file, party, turn, input.now ?? new Date(), input.channel, input.reserved));
    lines.push('Thread, oldest first (the turn to reply to is marked >>):');
    const unmentioned = unmentionedPhotoText(file);
    lines.push(threadFor(file, turn, unmentioned));
    lines.push('');
    // Ben's own facts carry the admin price screen and internal notes: they never reach the composer.
    // A diary fact is only citable while this run looked it up: an older booked date was true when it was
    // written and the diary may have moved since, so it is left off the list rather than dangled and refused.
    const lookedUp = new Set(specialists.flatMap((s) => s.factIds));
    // A quote figure the quote has moved on from (a price before a reissue) is left off too.
    const citable = customerVisibleFacts(file).filter((f) => (f.source.kind !== 'diary' || lookedUp.has(f.id)) && !isSupersededFigure(file, f));
    lines.push('Facts on the file (id: key = value):');
    lines.push(citable.length ? citable.map((f) => `${f.id}: ${f.key} = ${f.source.kind === 'media_description' ? withoutWords(lightPhotoSummary(f.value), unmentioned) : f.source.kind === 'thread' ? withoutWords(f.value, unmentioned) : f.value}`).join('\n') : '(none yet)');
    lines.push('');
    lines.push(`Turn kind: ${route.turnKind}. Subjects: ${route.subjects.join(', ')}. Exceptions: ${route.exceptions.join(', ') || 'none'}.`);
    if (proposal) {
        lines.push('Proposal from Scoping:');
        const q = proposal.nextQuestion;
        const question = q ? (q.subject === 'postcode' ? 'their location (postcode)' : q.subject === 'media' ? 'a photo, if easy, once' : q.subject === 'access' ? 'access (parking, someone in)' : `the job: ${q.unknowns.join(', ') || 'more detail'}`) : null;
        if (question) lines.push(`- this turn: ask one question about ${question}`);
        else if (proposal.ready && !['short_pause', 'promise_of_more', 'not_ready', 'acknowledgement'].includes(route.turnKind)) lines.push('- this turn: wrap up, nothing is left to ask; the job and the location are known, so say you will put the quote together and send it over');
        else lines.push('- this turn: an acknowledgement only, no question: one short bubble of a few words, and nothing your last message already said');
        lines.push(`- offer a call: ${proposal.offerCall ? 'yes' : 'no, do not mention calling'}`);
        lines.push(`- mention photos once: ${proposal.mentionPhotos ? 'yes, say a photo would help if easy, not as a question' : 'no'}`);
        // With nothing described there is no light detail to mention (answer 92), and any detail would be made up.
        const inboundMedia = file.turns.filter((t) => t.direction === 'inbound').flatMap((t) => t.media);
        const seen = inboundMedia.some((m) => m.description);
        lines.push(`- thank for media: ${!proposal.thankForMedia ? 'no' : seen ? 'yes' : `yes, but it is ${NOT_SEEN} (no description came back): thank for it plainly and do not say what it shows`}`);
    }
    const never = Array.from(new Set([...neverAsk, ...declined]));
    if (never.length) lines.push(`Never ask again (already asked or declined): ${never.map((s) => s === 'media' ? 'photos or video' : s).join(', ')}.`);
    for (const s of specialists) if (s.specialist !== 'scoping' && s.brief?.length) { lines.push(s.specialist === 'service' ? 'Proposal from Service:' : `Notes from ${s.specialist} (facts to copy verbatim, what not to say):`); for (const b of s.brief) lines.push(`- ${b}`); }
    if (input.lateAck) lines.push(`The last photo or video in the thread came in earlier and this reply is late for it: a bubble is added after your reply saying "${input.lateAck.text}". Do not thank for it or mention it yourself, answer the turn marked >> first, and use at most ${BUBBLE_CEILING - 1} bubbles.`);
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
            ? shorten.wideChars.length
                ? `Your previous reply came to ${shorten.measured} SMS segments, over the ${shorten.ceiling} one text message may use, because it carries ${shorten.wideChars.join(' ')}: one character like that halves what a text message holds. Say the same in one text message without ${shorten.wideChars.length > 1 ? 'those characters' : 'that character'} (no emoji or symbols), under ${GSM7_MULTI * shorten.ceiling} characters. Previous reply:`
                : `Your previous reply came to ${shorten.measured} SMS segments, over the ${shorten.ceiling} one text message may use. Say the same in one text message under ${shorten.charBudget} characters. Previous reply:`
            : `Your previous reply came to ${shorten.measured} bubbles, over the ceiling of ${shorten.ceiling}. Say the same in at most ${shorten.ceiling} short bubbles, a blank line between them, each one or two sentences of at most ${BUBBLE_MAX_CHARS} characters: a longer one is split in two and counts as two. Previous reply:`);
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
        // Only facts the composer was shown count as cited; a made-up id, or one of Ben's own, is dropped.
        const known = new Set(customerVisibleFacts(input.file).map((f) => f.id));
        res.output.factIds = Array.from(new Set(res.output.factIds.filter((id) => known.has(id))));
        // The house rule holds whatever the model wrote: a dash used as punctuation becomes a comma.
        res.output.reply = withoutDashPunctuation(res.output.reply).trim();
    }
    return res;
}
