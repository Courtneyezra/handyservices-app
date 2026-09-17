/**
 * Handy Desk - the words of a draft the ask agent holds for Ben, written by the desk's writing
 * model (desk/models.ts COMPOSER_MODEL: "the strongest model writes"). The reasoning model decides
 * that a draft is wanted and what it should say; this call turns that brief into the customer's
 * reply, over the thread as the case file holds it. The words then go through hold-draft.ts, which
 * decides whether they may be held at all.
 */
import { z } from 'zod/v4';
import { customerVisibleFacts, type CaseFile, type ModelCallRecord } from '../desk/case-file';
import { COMPOSER_MODEL, type ModelClient } from '../desk/models';
import { replyChannelOf } from '../api/board';
import { customerOf } from './surface';

const DraftSchema = z.object({
    words: z.string().describe('The reply to the customer, exactly as it would be sent. A blank line starts a new message bubble.'),
});

/** Turns the writer reads, most recent last. */
const THREAD_CAP = 20;
const BODY_CAP = 600;

export const ASK_COMPOSER_SYSTEM = `You write one reply to a customer of Handy Services, a small handyman business run by Ben, for Ben to read and send himself. You write as the business, in Ben's plain, friendly voice. UK English.

Hard rules. A draft that breaks one is refused before Ben ever sees it:
- No money: no price, figure, deposit or amount of any kind.
- No dates, days, times or durations, and no promise of when anything will happen.
- No commitments on the business's behalf and no admission of fault.
- No claims about the business (insurance, guarantees, experience, what it always or never does).
- Never say or hint that the message was written by software, a bot or an assistant.
- Do not ask for a photo, a postcode or access details if the thread shows they were already asked for.
- Nothing about gas or asbestos work.
- Plain punctuation. No dashes used as punctuation.

Shape: short, like a text message. At most three short paragraphs, separated by a blank line; one or two is usual. No greeting line on its own and no sign-off. Say what the brief asks and nothing more. If the brief cannot be met within these rules, write the nearest reply that keeps them.`;

function threadFor(file: CaseFile): string {
    return file.turns.slice(-THREAD_CAP).map((t) => {
        const who = t.direction === 'inbound' ? 'Customer' : t.approver?.startsWith('human:') ? 'Ben' : 'Business';
        const body = t.body.length > BODY_CAP ? `${t.body.slice(0, BODY_CAP)}...` : t.body;
        return `[${t.at} ${t.channel}] ${who}: ${body}`;
    }).join('\n');
}

export interface ComposeInput {
    file: CaseFile;
    brief: string;
    /** Why the last attempt was refused, for a second try. */
    failures?: string[];
    previous?: string | null;
}

export interface ComposeResult {
    words: string | null;
    record: ModelCallRecord;
    error: string | null;
}

export async function composeDraft(client: ModelClient, input: ComposeInput): Promise<ComposeResult> {
    const party = customerOf(input.file);
    const facts = customerVisibleFacts(input.file).map((f) => `- ${f.key}: ${f.value}`).join('\n') || '(none)';
    const retry = input.failures?.length
        ? `\n\nYour previous draft was refused. Previous draft:\n${input.previous ?? ''}\nWhy:\n${input.failures.map((f) => `- ${f}`).join('\n')}\nWrite it again without those problems.`
        : '';
    const user = `Customer: ${party?.name ?? 'unknown name'}
Reply channel: ${replyChannelOf(input.file) ?? 'unknown'}
Job: ${input.file.job.type ?? 'not yet known'}${input.file.job.location ? `, ${input.file.job.location}` : ''}
What the file records:
${facts}

The thread, oldest first:
${threadFor(input.file)}

What Ben wants the reply to say:
${input.brief.trim()}${retry}`;
    const res = await client.structured({ role: 'composer', model: COMPOSER_MODEL, effort: 'medium', system: ASK_COMPOSER_SYSTEM, user, schema: DraftSchema, maxTokens: 1200 });
    if (res.refused) return { words: null, record: res.record, error: 'the writing model declined the request' };
    return { words: res.output?.words ?? null, record: res.record, error: res.error };
}

export const ASK_MESSAGE_SYSTEM = `You write one message to a customer of Handy Services, a small handyman business run by Ben. Ben asked for it and reads it before it goes. You write as the business, in Ben's plain, friendly voice. UK English.

Hard rules. A message that breaks one is refused before Ben ever sees it:
- No money: no price, figure, deposit or amount of any kind, even if Ben mentions one.
- A day, a time, a duration or a promise of what the business will do only when Ben's instruction below says it, and then in his words ("this afternoon", "we will call you"). Never add one he did not give, and never make his more exact.
- No admission of fault.
- No claims about the business (insurance, guarantees, experience, what it always or never does).
- Never say or hint that the message was written by software, a bot or an assistant.
- Do not ask for a photo, a postcode or access details if the thread shows they were already asked for.
- Nothing about gas or asbestos work.
- Plain punctuation. No dashes used as punctuation.

Shape: short, like a text message. One or two short paragraphs, separated by a blank line. No greeting line on its own and no sign-off. Say what Ben asked and nothing more. If his ask cannot be met within these rules, write the nearest message that keeps them.`;

export interface ComposeMessageInput {
    /** The file the message goes on, when there is one: its thread is read. */
    file: CaseFile | null;
    name: string | null;
    channel: string | null;
    brief: string;
    /** Ben's own words the message relays, verbatim; null when he gave none. */
    instruction: string | null;
    failures?: string[];
    previous?: string | null;
}

/** A message Ben asked for, on the writing model. The words then go through the message.send preview (kinds/message-send.ts), which decides whether they may go. */
export async function composeMessage(client: ModelClient, input: ComposeMessageInput): Promise<ComposeResult> {
    const retry = input.failures?.length
        ? `\n\nYour previous message was refused. Previous message:\n${input.previous ?? ''}\nWhy:\n${input.failures.map((f) => `- ${f}`).join('\n')}\nWrite it again without those problems.`
        : '';
    const thread = input.file ? threadFor(input.file) : '';
    const facts = input.file ? customerVisibleFacts(input.file).map((f) => `- ${f.key}: ${f.value}`).join('\n') || '(none)' : '(no case file yet)';
    const user = `Customer: ${input.name ?? 'unknown name'}
Channel: ${input.channel ?? 'their usual one'}
${input.file ? `Job: ${input.file.job.type ?? 'not yet known'}${input.file.job.location ? `, ${input.file.job.location}` : ''}\n` : ''}What the file records:
${facts}

The thread, oldest first:
${thread || '(the customer has not written yet; this message is the first)'}

Ben's instruction, his exact words:
${input.instruction?.trim() || '(none: no day, time or promise may be written)'}

What Ben wants the message to say:
${input.brief.trim()}${retry}`;
    const res = await client.structured({ role: 'composer', model: COMPOSER_MODEL, effort: 'medium', system: ASK_MESSAGE_SYSTEM, user, schema: DraftSchema, maxTokens: 1200 });
    if (res.refused) return { words: null, record: res.record, error: 'the writing model declined the request' };
    return { words: res.output?.words ?? null, record: res.record, error: res.error };
}
