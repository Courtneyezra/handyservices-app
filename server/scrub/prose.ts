/**
 * Synthetic free text for the database scrub.
 *
 * Conversation and message bodies are the hardest part of the scrub and the most important: a
 * customer's name, street, gate code and job history live in them as prose, where no column name
 * hints at it. Blanking them would be safe but would leave the desk's own scenarios with nothing
 * to read, so every body is replaced by invented text of a similar shape instead — same rough
 * length, same register, same channel voice, and the row's own synthetic customer and town woven
 * through it so a reader can still follow one thread across tables.
 *
 * Every generator is keyed on the row's identity (table, primary key, column), never on the text
 * it replaces. That is what makes the scrub idempotent: a second run regenerates exactly the
 * same body from the same key and writes nothing.
 */
import { digest } from './synthetic';

export type ProseKind =
    /** One customer or operator message in a thread: a WhatsApp or SMS bubble. */
    | 'message'
    /** What the job is: a job description, summary or proposal. */
    | 'narrative'
    /** An internal one-liner: a note, a reason, an instruction. */
    | 'note'
    /** A two-party call transcript, several turns long. */
    | 'transcript';

const JOBS = [
    'a dripping mixer tap in the kitchen',
    'a bathroom extractor fan that has stopped spinning',
    'two internal doors that catch on the frame',
    'a fence panel blown out in the wind',
    'a radiator that stays cold at the bottom',
    'a cracked toilet cistern',
    'shelving to go up in the back bedroom',
    'a garden gate that will not latch',
    'a kitchen cupboard door off its hinge',
    'an outside light that trips the breaker',
    'skirting board to replace after a leak',
    'a loft hatch that has dropped',
    'guttering overflowing at the front',
    'a bedroom window handle that has snapped',
    'flat-pack wardrobes to assemble',
    'a shower door seal letting water out',
];

const CUSTOMER_LINES = [
    'Hi, are you able to take a look at {job}?',
    'Morning. I have {job} and could do with a hand.',
    'Hello, someone recommended you. It is {job}.',
    'Hi there, wondering what you would charge for {job}.',
    'Hi, no rush on this one, but {job} needs sorting.',
    'Thanks for getting back to me. The address is {address}.',
    'I am usually in after four, if that helps.',
    'Yes that works for me. See you then.',
    'Sent a couple of photos over just now.',
    'That price is fine, please go ahead.',
    'Could we push it to the following week instead?',
    'Do you need me to be in for the whole visit?',
];

const OPERATOR_LINES = [
    'Thanks for getting in touch. Could you send a photo of it so I can see the size of the job?',
    'That is one we do a lot of. Can I take the postcode so I can check the diary?',
    'I can get someone to you later this week. Would a morning or an afternoon suit better?',
    'Booked in. You will get a reminder the day before.',
    'On the way now, about twenty minutes out.',
    'All done. Anything else you want looking at while we are local?',
    'The quote is on its way over to you now.',
    'No problem at all, I have moved it in the diary.',
    'Just to confirm, that is the {town} address.',
];

const NARRATIVE_LINES = [
    'Customer reports {job}.',
    'Access is through the side passage; the customer will be in.',
    'Single visit, materials carried on the van.',
    'Half day allowed for the work plus making good.',
    'Job is at the {town} property; parking on the street outside.',
    'Photos on file show the fault clearly.',
    'Customer would prefer an afternoon slot.',
    'Second item to look at while on site if time allows.',
];

const NOTE_LINES = [
    'Called, no answer, left a voicemail.',
    'Customer happy with the date offered.',
    'Waiting on a photo before pricing.',
    'Parts ordered, due in on Thursday.',
    'Rescheduled at the customer request.',
    'Nothing outstanding on this one.',
    'Needs a second visit to finish off.',
    'Left a card through the door.',
];

/** Fill the `{job}`, `{town}` and `{address}` slots deterministically. */
function fill(line: string, seed: string, parts: string[]): string {
    return line
        .replace('{job}', JOBS[digest(seed, 'job', ...parts) % JOBS.length])
        .replace('{town}', parts[parts.length - 1] || 'Nottingham')
        .replace('{address}', `${1 + (digest(seed, 'no', ...parts) % 180)} Sherbrook Road`);
}

export interface ProseContext {
    /** The synthetic customer name for this row, woven in where a greeting expects one. */
    name?: string | null;
    /** The synthetic town for this row. */
    town?: string | null;
    /** Roughly how long the original was, so the replacement occupies the same space. */
    targetLength?: number;
}

/**
 * Invent a body of the given kind. `parts` must key the row (table, primary key, column) and
 * never the text being replaced, so that running the scrub twice regenerates the same string.
 */
export function fakeProse(seed: string, kind: ProseKind, parts: string[], ctx: ProseContext = {}): string {
    const key = [...parts, ctx.town ?? ''];
    const target = Math.max(24, Math.min(ctx.targetLength ?? 120, 2000));

    if (kind === 'transcript') return fakeTranscript(seed, key, ctx, target);

    const pool = kind === 'message' ? [...CUSTOMER_LINES, ...OPERATOR_LINES]
        : kind === 'narrative' ? NARRATIVE_LINES
            : NOTE_LINES;

    const out: string[] = [];
    let n = 0;
    while (out.join(' ').length < target && n < 12) {
        const line = pool[digest(seed, 'line', String(n), ...key) % pool.length];
        out.push(fill(line, seed, key));
        n += 1;
    }
    let text = out.join(' ');
    if (kind === 'message' && ctx.name) {
        // One greeting at the front keeps a thread readable without repeating the name everywhere.
        const first = ctx.name.trim().split(/\s+/)[0];
        if (first && digest(seed, 'greet', ...key) % 2 === 0) text = `Hi ${first}, ${text[0].toLowerCase()}${text.slice(1)}`;
    }
    return text;
}

function fakeTranscript(seed: string, key: string[], ctx: ProseContext, target: number): string {
    const turns: string[] = [];
    let n = 0;
    while (turns.join('\n').length < target && n < 16) {
        const operator = n % 2 === 0;
        const pool = operator ? OPERATOR_LINES : CUSTOMER_LINES;
        const line = fill(pool[digest(seed, 'turn', String(n), ...key) % pool.length], seed, key);
        turns.push(`${operator ? 'Agent' : 'Caller'}: ${line}`);
        n += 1;
    }
    return turns.join('\n');
}

/**
 * Is this text something `fakeProse` wrote?
 *
 * Needed because invented prose is deliberately shaped like the text it replaces — same rough
 * length — which means the generator's output is not a fixed point of the generator: feeding it
 * back gives a different length target and therefore a different number of sentences. So
 * recognition cannot be "regenerate and compare"; it has to be structural. Every sentence a
 * generator can write comes from the pools above, so a body is synthetic when each of its
 * sentences matches one of those templates with the variable slots wildcarded.
 *
 * The test only has to be right for text this file wrote. A first scrub rewrites everything
 * regardless (see `force` in values.ts), so a real message can never be spared by a false match
 * here unless it is word for word one of the templates.
 */
export function isSyntheticProse(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    for (const line of trimmed.split('\n')) {
        const body = line.replace(/^(Agent|Caller):\s*/, '').trim();
        if (!body) continue;
        if (!sentencesAreOurs(body)) return false;
    }
    return true;
}

/**
 * Templates as regular expressions, built once: `{job}`, `{town}` and `{address}` are wildcards.
 *
 * Several templates are two sentences long ("Booked in. You will get a reminder the day before."),
 * and the recogniser works one sentence at a time, so each template contributes its own sentences
 * as well as itself.
 */
const TEMPLATE_RES: RegExp[] = [...CUSTOMER_LINES, ...OPERATOR_LINES, ...NARRATIVE_LINES, ...NOTE_LINES]
    .flatMap((line) => [line, ...(line.match(/[^.?!]+[.?!]/g) ?? [])].map((s) => s.trim()))
    .filter((s, i, all) => s.length > 0 && all.indexOf(s) === i)
    .map((line) => new RegExp('^' + line
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\{job\\\}/g, '.+')
        .replace(/\\\{town\\\}/g, '.+')
        .replace(/\\\{address\\\}/g, '.+') + '$'));

function sentencesAreOurs(body: string): boolean {
    // `fakeProse` joins whole sentences with a single space, and may prefix one greeting.
    const withoutGreeting = body.replace(/^Hi [A-Z][a-zà-ÿ'’-]*, /, '');
    const sentences = withoutGreeting.match(/[^.?!]+[.?!]/g);
    if (!sentences) return false;
    // A truncated preview ends in an ellipsis, so allow a trailing fragment there.
    const joined = sentences.join(' ').trim();
    const remainder = withoutGreeting.slice(joined.length).trim();
    if (remainder && remainder !== '...') return false;
    return sentences.every((s) => {
        const t = s.trim();
        const capitalised = t.charAt(0).toUpperCase() + t.slice(1);
        return TEMPLATE_RES.some((re) => re.test(t) || re.test(capitalised));
    });
}

/** A short thread preview, the shape `conversations.last_message_preview` holds. */
export function fakePreview(seed: string, parts: string[], ctx: ProseContext = {}): string {
    const body = fakeProse(seed, 'message', parts, { ...ctx, targetLength: 90 });
    return body.length > 120 ? body.slice(0, 117) + '...' : body;
}
