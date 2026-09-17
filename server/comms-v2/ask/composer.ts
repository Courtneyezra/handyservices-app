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
