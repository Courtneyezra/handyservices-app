/**
 * Quote-Prep Agent — the extraction clerk between a comms thread and Ben's contextual quote
 * builder. It reads everything the customer gave us (messages, call transcripts, photos, video
 * keyframes) and produces a QUOTE-READY intake: who, where, and the work as real quote lines
 * (short customer-facing title, the evidence behind it, the caveats its price rests on), plus a
 * conversation-level verdict — can we quote this, do we need an answer first, or does it need a
 * visit — with the still-open questions named and addressed to whoever can answer them.
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

/** Hard cap on a line title. A quote line item is a label, not a paragraph. */
export const LINE_TITLE_MAX = 60;

/**
 * One job line, already split the way the quote needs it: a customer-facing title, the
 * internal evidence behind it, and the caveats its price depends on. The old single
 * jobSummary string forced the panel to guess where the title ended — it doesn't guess now.
 */
export interface IntakeLine {
    /** Customer-facing quote line: imperative, specific, <= LINE_TITLE_MAX chars. */
    title: string;
    /** Internal only: what the photo/thread actually shows, for Ben and the pricing analysis. */
    detail: string;
    /** Caveats THIS line's price is based on (customer-visible on the quote page). */
    assumptions: string[];
}

/** Can we price this from the thread, do we need an answer first, or do we need eyes on it? */
export type IntakeReadiness = 'quote_ready' | 'needs_info' | 'visit_first';

/** One unanswered question standing between this thread and a sendable quote. */
export interface IntakeGap {
    /** Customer-friendly wording — it may be sent to the customer nearly verbatim. */
    question: string;
    /** Who can answer it: the customer, or Ben from trade knowledge / his own records. */
    audience: 'customer' | 'ben';
    /** 1-based job line the answer belongs to; null when it applies to the whole quote. */
    lineIndex: number | null;
}

export interface QuoteIntake {
    customerName: string | null;
    phone: string;
    postcode: string | null;
    /** Inferred from how the customer talks about the property; homeowner unless signalled. */
    customerType: IntakeCustomerType;
    /** The job, line by line, quote-ready. */
    lines: IntakeLine[];
    /** Caveats that apply to the whole quote rather than one line. */
    assumptions: string[];
    /** The conversation-level verdict Ben acts on before he prices anything. */
    readiness: IntakeReadiness;
    /** What's still unanswered, and who can answer it. Empty when quote_ready. */
    gaps: IntakeGap[];
    urgency: 'low' | 'med' | 'high';
}

/**
 * Validates and normalises what the agent submitted. Every throw here is a message the agent
 * reads and retries from, so each one says what is wrong AND what to do instead.
 *
 * Two rules do the real work:
 *  - a title is a quote line item, not the evidence — over LINE_TITLE_MAX characters is rejected
 *    outright rather than silently truncated by the panel (the old failure mode was a whole
 *    paragraph sitting in the line title);
 *  - the verdict has to agree with the gaps: "quote ready" with an open customer question is the
 *    contradiction that would let a half-scoped quote go out.
 */
export function normalizeIntake(input: any, ctx: { phone: string; contactName: string | null }): QuoteIntake {
    const rawLines: any[] = Array.isArray(input?.lines) ? input.lines : [];
    if (rawLines.length === 0) throw new Error('lines must contain at least one job line.');

    const lines: IntakeLine[] = rawLines.slice(0, 12).map((l: any, i: number) => {
        const title = String(l?.title ?? '').replace(/\s+/g, ' ').trim();
        if (!title) throw new Error(`Line ${i + 1} has no title.`);
        if (title.length > LINE_TITLE_MAX) {
            throw new Error(
                `Line ${i + 1} title is ${title.length} characters ("${title.slice(0, 70)}…"), over the ${LINE_TITLE_MAX} limit. `
                + 'A title is a quote line item, not the evidence. Cut it to the work itself ("Repair leaking waste pipework under kitchen sink") and move everything else into detail.',
            );
        }
        if (/£\s*\d/.test(title)) throw new Error(`Line ${i + 1} title contains a price. Pricing is not your job.`);
        const detail = String(l?.detail ?? '').trim().slice(0, 1200);
        if (/£\s*\d/.test(detail)) throw new Error(`Line ${i + 1} detail contains a price. Pricing is not your job.`);
        return {
            title,
            detail,
            assumptions: (Array.isArray(l?.assumptions) ? l.assumptions : [])
                .slice(0, 6).map((s: any) => String(s).trim().slice(0, 200)).filter(Boolean),
        };
    });

    const readiness: IntakeReadiness = (['quote_ready', 'needs_info', 'visit_first'] as const)
        .includes(input?.readiness) ? input.readiness : 'needs_info';

    const gaps: IntakeGap[] = (Array.isArray(input?.gaps) ? input.gaps : [])
        .slice(0, 8)
        .map((g: any) => {
            const idx = Number(g?.lineIndex);
            return {
                question: String(g?.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
                audience: g?.audience === 'customer' ? 'customer' as const : 'ben' as const,
                lineIndex: Number.isInteger(idx) && idx >= 1 && idx <= lines.length ? idx : null,
            };
        })
        .filter((g: IntakeGap) => !!g.question);

    if (readiness === 'quote_ready' && gaps.some((g) => g.audience === 'customer')) {
        throw new Error('readiness quote_ready cannot carry customer-audience gaps. Either the question does not actually change the price (drop it) or this is needs_info.');
    }
    if (readiness === 'needs_info' && gaps.length === 0) {
        throw new Error('readiness needs_info requires at least one gap. Name what is missing, or this is quote_ready.');
    }

    return {
        customerName: input?.customerName ?? ctx.contactName ?? null,
        phone: ctx.phone,
        postcode: input?.postcode ?? null,
        customerType: (['homeowner', 'landlord', 'letting_agent', 'business'] as const)
            .includes(input?.customerType) ? input.customerType : 'homeowner',
        lines,
        assumptions: (input?.assumptions ?? []).slice(0, 8).map((s: any) => String(s).trim().slice(0, 200)).filter(Boolean),
        readiness,
        gaps,
        urgency: ['low', 'med', 'high'].includes(input?.urgency) ? input.urgency : 'med',
    };
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
            description: `Submit the structured intake for Ben's builder. Call exactly once, when you have extracted everything extractable. Each line is {title, detail, assumptions}: the title is the customer-facing quote line (imperative, max ${LINE_TITLE_MAX} characters, REJECTED if longer), the evidence goes in detail.`,
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
                    lines: {
                        type: 'array',
                        description: 'One entry per distinct piece of work, in the order it should appear on the quote.',
                        items: {
                            type: 'object',
                            properties: {
                                title: {
                                    type: 'string',
                                    description: `The quote line the CUSTOMER reads. Starts with a verb, names the work and where it is, max ${LINE_TITLE_MAX} characters. Good: "Repair leaking waste pipework under kitchen sink". Bad: anything describing a photo, or a sentence with a comma-spliced explanation.`,
                                },
                                detail: {
                                    type: 'string',
                                    description: 'INTERNAL evidence for Ben and the pricing analysis: what the photo/video/messages actually show (visible damage, materials, sizes, access). Never seen by the customer as-is. Prices are still banned.',
                                },
                                assumptions: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Caveats THIS line\'s price depends on, from what the media cannot confirm (e.g. "assumes the existing isolation valve still works").',
                                },
                            },
                            required: ['title', 'detail', 'assumptions'],
                        },
                    },
                    assumptions: { type: 'array', items: { type: 'string' }, description: 'Caveats that apply to the WHOLE quote rather than one line (access, parking, power). Line-specific ones belong on the line.' },
                    readiness: {
                        type: 'string',
                        enum: ['quote_ready', 'needs_info', 'visit_first'],
                        description: 'quote_ready = everything needed to price it is here. needs_info = one or more answers would change the price or the scope. visit_first = it cannot honestly be priced remotely (hidden/unknown extent, structural, suspected damp or leak behind fabric, or the customer wants work we can only scope on site).',
                    },
                    gaps: {
                        type: 'array',
                        description: 'Every unanswered question standing between this thread and a sendable quote. MUST be empty when readiness is quote_ready.',
                        items: {
                            type: 'object',
                            properties: {
                                question: {
                                    type: 'string',
                                    description: 'Customer-friendly wording, one question, ends in a question mark. It may be sent to the customer nearly verbatim, so: plain English, no jargon, no em dashes, never ask for a full address (postcode only).',
                                },
                                audience: {
                                    type: 'string',
                                    enum: ['customer', 'ben'],
                                    description: 'customer = only they can answer (what is behind it, which room, do they have the part). ben = trade judgement or our own records (which contractor, do we carry the fitting, previous job history).',
                                },
                                lineIndex: {
                                    type: ['integer', 'null'],
                                    description: '1-based index into lines[] this question is about; null when it applies to the whole job.',
                                },
                            },
                            required: ['question', 'audience', 'lineIndex'],
                        },
                    },
                    urgency: { type: 'string', enum: ['low', 'med', 'high'] },
                },
                required: ['customerName', 'postcode', 'customerType', 'lines', 'assumptions', 'readiness', 'gaps', 'urgency'],
            },
            run: async (input: any) => {
                intake = normalizeIntake(input, { phone: e164, contactName: conv.contactName ?? null });
                return {
                    accepted: true,
                    lines: intake.lines.length,
                    readiness: intake.readiness,
                    gaps: intake.gaps.length,
                };
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
2. Split the work into lines: one line per distinct piece of work.
3. Judge readiness for the conversation as a whole, and list the gaps behind that judgement.
4. submit_intake exactly once.

THE LINE SPLIT (this is the part that goes wrong):
- title = what the CUSTOMER reads on their quote. Start with a verb, name the work and where it
  is, stop. Max ${LINE_TITLE_MAX} characters, and the tool REJECTS anything longer.
    good: "Repair leaking waste pipework under kitchen sink"
    good: "Replace broken bathroom light fitting"
    bad:  "Customer sent a photo showing water pooling in the cupboard under the sink where the
           trap appears to have failed, needs the pipework repaired" (that is evidence, not a line)
- detail = the evidence, and only Ben sees it. What the photo/video/messages actually show:
  visible damage, materials, sizes, access, what they said in their own words. Be specific here;
  this is where the length belongs.
- assumptions = what THIS line's price has to take on trust because the media cannot confirm it.
- Quote-level assumptions (the top-level field) are for things that span the job: access,
  parking, power, someone being in.

READINESS, judged for the whole conversation:
- quote_ready — everything needed to price it honestly is in the thread. No customer gaps allowed.
- needs_info — at least one answer would change the price or the scope. List every one as a gap.
- visit_first — it cannot be priced remotely at all: hidden extent, structural, a leak or damp
  behind fabric, or work only a site visit can scope. Say so early rather than quoting a guess.

GAPS: one question each, in customer-friendly words, ending in a question mark, because a
customer gap may be sent to them nearly verbatim. audience 'customer' when only they can answer;
audience 'ben' when it is trade judgement or our own records. lineIndex points at the line it
belongs to (1-based) or null for the whole job. Never ask for a full address — postcode only.
No em dashes in gap questions. Do not pad the list: a gap that would not change the price or the
scope is not a gap.

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
    mission: 'Turns a comms thread (messages, calls, photos, video) into a quote-ready intake: customer-facing job lines with the evidence and caveats behind each, plus a readiness verdict (quote ready / needs info / visit first) and the exact questions still open. Prefilled into Ben\'s builder. Ben checks, prices and sends.',
    model: 'claude-sonnet-5',
    cadence: 'On demand, from the "Prep quote" button in a comms thread',
    autonomy: {
        freely: ['Read the thread, media, call transcripts and prior quotes', 'Extract job lines, assumptions, the readiness verdict and the open questions'],
        approval: ['Everything — its output only prefills the builder; Ben prices and sends the quote'],
        never: ['Put a price on anything', 'Message a customer', 'Invent a postcode, name or scope detail not in the thread'],
    },
    tools: [
        { name: 'get_thread', blurb: 'Full conversation incl. photos + video keyframes', kind: 'read' },
        { name: 'get_prior_quotes', blurb: 'Existing quotes for this customer', kind: 'read' },
        { name: 'submit_intake', blurb: `The structured intake, validated: price-free, titles capped at ${LINE_TITLE_MAX} chars, verdict consistent with the gaps`, kind: 'write' },
    ],
} as const;
