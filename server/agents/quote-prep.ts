/**
 * Quote-Prep Agent — the extraction clerk between a comms thread and Ben's contextual quote
 * builder. It reads everything the customer gave us (messages, call transcripts, photos, video
 * keyframes) and produces a structured intake: who, where, and exactly what work, line by line,
 * with honest assumptions and an explicit missing-info list.
 *
 * It NEVER prices anything and never talks to the customer — pricing stays with Ben and the
 * pricing engine; contact stays with the comms agent. Output lands in the builder prefilled,
 * so Ben's job collapses from "transcribe the thread" to "check, price, send".
 */
import { db } from '../db';
import { conversations, messages, calls, personalizedQuotes } from '@shared/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { runAgent, type AgentTool } from './runner';
import { buildMediaBlocks } from './media-context';

export type IntakeCustomerType = 'homeowner' | 'landlord' | 'letting_agent' | 'business';

export interface QuoteIntake {
    customerName: string | null;
    phone: string;
    postcode: string | null;
    /** Inferred from how the customer talks about the property; homeowner unless signalled. */
    customerType: IntakeCustomerType;
    /** Builder-ready job description: numbered job lines with the detail the pricing analysis needs. */
    jobSummary: string;
    /** Cover-your-back caveats the quote should carry, from what the media can't confirm. */
    assumptions: string[];
    /** What we still don't know — Ben sees this before pricing. */
    missing: string[];
    urgency: 'low' | 'med' | 'high';
}

export async function runQuotePrep(conversationId: string): Promise<{ intake: QuoteIntake | null; summary: string; turns: number }> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) throw new Error(`Conversation ${conversationId} not found`);
    const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
    if (!digits) throw new Error('Conversation has no usable phone');
    const e164 = `+${digits}`;

    let intake: QuoteIntake | null = null;

    const tools: AgentTool[] = [
        {
            name: 'get_thread',
            description: 'The full conversation: messages, call transcripts, and the customer\'s actual photos and video keyframes. The media usually specifies the job better than the words. Call FIRST.',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
            run: async () => {
                const recent = await db.select().from(messages)
                    .where(eq(messages.conversationId, conv.id))
                    .orderBy(desc(messages.createdAt)).limit(40);
                const callRows = await db.select().from(calls)
                    .where(sql`regexp_replace(${calls.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`)
                    .orderBy(desc(calls.startTime)).limit(5);

                const timeline = [
                    ...recent.map((m) => ({
                        kind: 'message', at: m.createdAt?.toISOString(), direction: m.direction,
                        content: (m.content ?? '').slice(0, 400), hasMedia: !!m.mediaUrl,
                    })),
                    ...callRows.map((c) => ({
                        kind: 'call', at: c.startTime?.toISOString(),
                        summary: c.jobSummary ?? null,
                        transcriptExcerpt: c.transcription ? c.transcription.slice(0, 1200) : null,
                    })),
                ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

                const data = { contactName: conv.contactName, phone: e164, timeline };
                const mediaBlocks = await buildMediaBlocks(
                    recent.filter((m) => m.mediaUrl).reverse().map((m) => ({
                        mediaUrl: m.mediaUrl!, mediaType: m.mediaType,
                        direction: m.direction, createdAt: m.createdAt as any, content: m.content,
                    })),
                );
                return mediaBlocks.length ? { data, mediaBlocks } : data;
            },
        },
        {
            name: 'get_prior_quotes',
            description: 'Any quotes this customer already has, so a re-quote builds on what was already scoped.',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
            run: async () => db.select({
                slug: personalizedQuotes.shortSlug,
                job: personalizedQuotes.jobDescription,
                createdAt: personalizedQuotes.createdAt,
                depositPaidAt: personalizedQuotes.depositPaidAt,
            }).from(personalizedQuotes)
                .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${digits}`)
                .orderBy(desc(personalizedQuotes.createdAt)).limit(3),
        },
        {
            name: 'submit_intake',
            description: 'Submit the structured intake for Ben\'s builder. Call exactly once, when you have extracted everything extractable. jobSummary must be numbered job lines ("1. Replace bathroom light fitting (existing fitting old and broken, see photo)..."), concrete enough to price from.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    customerName: { type: ['string', 'null'], description: 'Real name only; null if unknown or a placeholder.' },
                    postcode: { type: ['string', 'null'], description: 'UK postcode if given anywhere in the thread; null otherwise. Never invent.' },
                    customerType: {
                        type: 'string',
                        enum: ['homeowner', 'landlord', 'letting_agent', 'business'],
                        description: 'Inferred from the messaging: "my tenant"/"my rental"/BTL → landlord; managing on behalf of a landlord/portfolio/agency → letting_agent; shop/office/company premises → business. Default homeowner when nothing signals otherwise.',
                    },
                    jobSummary: { type: 'string', description: 'Numbered job lines with the concrete detail visible in text/photos/video. No prices.' },
                    assumptions: { type: 'array', items: { type: 'string' }, description: 'What the price will have to assume because the thread/media cannot confirm it.' },
                    missing: { type: 'array', items: { type: 'string' }, description: 'What we still need before/at booking (e.g. postcode, exact leak source).' },
                    urgency: { type: 'string', enum: ['low', 'med', 'high'] },
                },
                required: ['customerName', 'postcode', 'customerType', 'jobSummary', 'assumptions', 'missing', 'urgency'],
            },
            run: async (input: any) => {
                if (/£\s*\d/.test(input.jobSummary ?? '')) {
                    throw new Error('jobSummary must not contain prices. Describe the work; pricing is not your job.');
                }
                intake = {
                    customerName: input.customerName ?? conv.contactName ?? null,
                    phone: e164,
                    postcode: input.postcode ?? null,
                    customerType: (['homeowner', 'landlord', 'letting_agent', 'business'] as const)
                        .includes(input.customerType) ? input.customerType : 'homeowner',
                    jobSummary: String(input.jobSummary).slice(0, 4000),
                    assumptions: (input.assumptions ?? []).slice(0, 8).map((s: any) => String(s).slice(0, 200)),
                    missing: (input.missing ?? []).slice(0, 8).map((s: any) => String(s).slice(0, 200)),
                    urgency: ['low', 'med', 'high'].includes(input.urgency) ? input.urgency : 'med',
                };
                return { accepted: true };
            },
        },
    ];

    const result = await runAgent({
        name: 'quote-prep',
        system: SYSTEM,
        goal: `Prepare the quote intake for conversation ${conv.id} (customer: ${conv.contactName || e164}).`,
        tools,
        model: 'claude-sonnet-5',
        maxTurns: 6,
        maxTokens: 3000,
    });

    return { intake, summary: result.finalText, turns: result.turns };
}

export const SYSTEM = `You are the quote-prep clerk for Handy Services, a Nottingham handyman company.
Your ONLY job: turn a customer conversation into a structured job intake for the human quote
builder. You never price anything, never message anyone, never guess.

Method:
1. get_thread and STUDY the photos/video frames — they define the actual scope. get_prior_quotes.
2. Extract every distinct piece of work as its own numbered line, with the concrete details a
   tradesperson needs (what, where, what's visibly wrong, sizes/materials when visible).
3. Be honest at the edges: what a photo cannot confirm goes in assumptions; what we simply were
   not told goes in missing. Never pad either.
4. submit_intake exactly once.

Rules: no prices anywhere. Names: real names only, never placeholders. Postcode only if stated
somewhere; never inferred. UK English, plain trade language (silicone/reseal, trap, architrave).
customerType: read HOW they talk about the property — "my tenant"/"my rental"/buy-to-let means
landlord; acting for a landlord, portfolio or agency means letting_agent; shop/office/company
premises means business; homeowner otherwise. This one field IS an inference — but from real
signals in the thread, never a guess dressed as one.`;

/** Staff-directory card — lives beside the agent so /admin/staff can't drift from reality. */
export const STAFF = {
    id: 'quote-prep',
    name: 'Quote Prep',
    roleTitle: 'Intake & Scoping Clerk',
    mission: 'Turns a comms thread (messages, calls, photos, video) into a structured job intake, line by line with honest assumptions and a missing-info list, prefilled into Ben\'s contextual quote builder. Ben checks, prices and sends.',
    model: 'claude-sonnet-5',
    cadence: 'On demand, from the "Prep quote" button in a comms thread',
    autonomy: {
        freely: ['Read the thread, media, call transcripts and prior quotes', 'Extract job lines, assumptions and missing info'],
        approval: ['Everything — its output only prefills the builder; Ben prices and sends the quote'],
        never: ['Put a price on anything', 'Message a customer', 'Invent a postcode, name or scope detail not in the thread'],
    },
    tools: [
        { name: 'get_thread', blurb: 'Full conversation incl. photos + video keyframes', kind: 'read' },
        { name: 'get_prior_quotes', blurb: 'Existing quotes for this customer', kind: 'read' },
        { name: 'submit_intake', blurb: 'The structured intake (price-free, validated)', kind: 'write' },
    ],
} as const;
