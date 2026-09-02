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
import { realNameOrNull } from '@shared/contact-name';
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

/** Can we price this from the thread, do we need an answer first, do we need eyes on it —
 *  or is the whole job outside our scope (certified trade), proposing a polite no?
 *  quote_pending = agent has enough info, speculative research running in the background */
export type IntakeReadiness = 'quote_ready' | 'quote_pending' | 'needs_info' | 'visit_first' | 'decline';

/**
 * The only four grounds for a proposed decline, per docs/DECLINE_CRITERIA.md (29 Aug 2026).
 * The clerk APPLIES these; it never invents its own. Distance, job size, customer behaviour,
 * urgency, botched prior work, tenants and big jobs are all explicitly NOT decline grounds.
 */
export type DeclineReason = 'gas_work' | 'roofing_height' | 'structural' | 'major_electrical';

/** A no-go piece of work inside an otherwise quotable job (mixed job). Line-level note for
 *  Ben — the rest of the job still gets quoted; this never declines the whole thread. */
export interface IntakeExclusion {
    /** What the excluded work is, in the customer's terms ("service the boiler"). */
    work: string;
    reason: DeclineReason;
}

/** Human-readable labels for the reason codes (portal + alerts). */
export const DECLINE_LABELS: Record<DeclineReason, string> = {
    gas_work: 'gas work',
    roofing_height: 'roofing & work at height',
    structural: 'structural alterations',
    major_electrical: 'notifiable electrical',
};

/**
 * Fixed polite-no templates per reason code — point them right + invite back. Sent ONLY after
 * Ben approves the proposal in the portal; never composed per thread, never a named referral.
 */
export const DECLINE_TEMPLATES: Record<DeclineReason, string> = {
    gas_work:
        'Thanks for sending that over. That one needs a Gas Safe engineer so it\'s not something we can take on — but for any handyman jobs in future we\'d love to help.',
    roofing_height:
        'Thanks for sending that over. That one needs a roofing specialist with the right access equipment, so it\'s not something we can take on — but for any handyman jobs in future we\'d love to help.',
    structural:
        'Thanks for sending that over. That one is structural work that needs a structural engineer and building control involved, so it\'s not something we can take on — but for any handyman jobs in future we\'d love to help.',
    major_electrical:
        'Thanks for sending that over. That one needs a registered electrician as it\'s notifiable electrical work, so it\'s not something we can take on — but for any handyman jobs in future we\'d love to help.',
};

/**
 * Evidence patterns per reason code. A proposed decline (or a mixed-job exclusion) is rejected
 * unless the thread summary the clerk itself extracted actually evidences the trigger — this is
 * the validator's guard against a hallucinated no.
 */
const DECLINE_EVIDENCE: Record<DeclineReason, RegExp> = {
    gas_work: /\b(gas|boiler|flue|central heating|combi|gas safe|gas hob)\b/i,
    roofing_height: /\b(roof|roofing|chimney|scaffold|ridge|fascia|soffit)\b/i,
    structural: /\b(structural|load[ -]bearing|lintel|underpin|knock[ -]?through|wall removal|remove.{0,20}wall|rsj|steel beam)\b/i,
    major_electrical: /\b(consumer unit|fuse ?(box|board)|rewir|new circuit|part p|notifiable|new ring main)\b/i,
};

const DECLINE_REASONS = ['gas_work', 'roofing_height', 'structural', 'major_electrical'] as const;

/** How much the answer to a gap could change the WORK (never expressed in money — the clerk
 *  does not price; code converts these to £ using the engine's own line prices). */
export type GapImpact = 'none' | 'small' | 'large' | 'forks_job';

/** One unanswered question standing between this thread and a sendable quote. */
export interface IntakeGap {
    /** Customer-friendly wording — it may be sent to the customer nearly verbatim. */
    question: string;
    /** Who can answer it: the customer, or Ben from trade knowledge / his own records. */
    audience: 'customer' | 'ben';
    /** 1-based job line the answer belongs to; null when it applies to the whole quote. */
    lineIndex: number | null;
    /** How much the answer could change the scope of the work. Drives the ask-vs-assume dial. */
    impact: GapImpact;
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
    /** Required (and only allowed) when readiness is 'decline': WHY the whole job is a no-go. */
    declineReason: DeclineReason | null;
    /** Mixed jobs: no-go work excluded from an otherwise quotable intake. Line-level notes. */
    excluded: IntakeExclusion[];
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
    // Observed failure mode (29 Aug 2026 eval): the model occasionally serialises lines as a
    // JSON STRING and, told only "at least one job line", re-sends the same string until the
    // turn cap. Name the actual mistake so the retry can fix it.
    if (typeof input?.lines === 'string') {
        throw new Error('lines arrived as a string. Send lines as a real JSON array of {title, detail, assumptions} objects, not a stringified one.');
    }
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

    const readiness: IntakeReadiness = (['quote_ready', 'quote_pending', 'needs_info', 'visit_first', 'decline'] as const)
        .includes(input?.readiness) ? input.readiness : 'needs_info';

    const declineReason: DeclineReason | null =
        DECLINE_REASONS.includes(input?.declineReason) ? input.declineReason : null;

    const excluded: IntakeExclusion[] = (Array.isArray(input?.excluded) ? input.excluded : [])
        .slice(0, 4)
        .map((x: any, i: number) => {
            const work = String(x?.work ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
            if (!work) throw new Error(`excluded entry ${i + 1} has no work description. Say what the no-go work is, in the customer's terms.`);
            if (!DECLINE_REASONS.includes(x?.reason)) {
                throw new Error(
                    `excluded entry ${i + 1} needs a valid reason code (${DECLINE_REASONS.join(', ')}). `
                    + 'If the work does not match one of the four no-go trades, it is not excluded — quote it or gap it.',
                );
            }
            const reason: DeclineReason = x.reason;
            if (!DECLINE_EVIDENCE[reason].test(work)) {
                throw new Error(
                    `excluded entry ${i + 1} ("${work}") does not evidence ${reason}. `
                    + 'The work description must show the trigger itself (e.g. boiler/gas for gas_work). If the evidence is not there, do not exclude it.',
                );
            }
            return { work, reason };
        });

    const gaps: IntakeGap[] = (Array.isArray(input?.gaps) ? input.gaps : [])
        .slice(0, 8)
        .map((g: any) => {
            const idx = Number(g?.lineIndex);
            return {
                question: String(g?.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
                audience: g?.audience === 'customer' ? 'customer' as const : 'ben' as const,
                lineIndex: Number.isInteger(idx) && idx >= 1 && idx <= lines.length ? idx : null,
                // Degrade additively: an older-model submission without impact reads as 'large'
                // (cautious default — an unlabelled gap should count against readiness, not for it).
                impact: (['none', 'small', 'large', 'forks_job'] as const).includes(g?.impact)
                    ? g.impact as GapImpact : 'large' as const,
            };
        })
        .filter((g: IntakeGap) => !!g.question);

    if (readiness === 'quote_ready' && gaps.some((g) => g.audience === 'customer')) {
        throw new Error('readiness quote_ready cannot carry customer-audience gaps. Either the question does not actually change the price (drop it) or this is needs_info.');
    }
    if (readiness === 'needs_info' && gaps.length === 0) {
        throw new Error('readiness needs_info requires at least one gap. Name what is missing, or this is quote_ready.');
    }
    if (readiness === 'decline') {
        if (!declineReason) {
            throw new Error(
                `readiness decline requires declineReason, one of: ${DECLINE_REASONS.join(', ')}. `
                + 'If the job does not match one of those four no-go trades, it is not a decline — pick the honest lane instead.',
            );
        }
        const evidenceText = lines.map((l) => `${l.title} ${l.detail}`).join(' ');
        if (!DECLINE_EVIDENCE[declineReason].test(evidenceText)) {
            throw new Error(
                `declineReason ${declineReason} is not evidenced in your job lines. `
                + 'The line titles/details must show the trigger itself (what the customer actually asked for). If the evidence is not there, this is not a decline.',
            );
        }
        if (gaps.some((g) => g.audience === 'customer')) {
            throw new Error('readiness decline cannot carry customer-audience gaps. A decline proposal asks the customer nothing — Ben reviews it and the polite no (or a rethink) follows.');
        }
        if (excluded.length > 0) {
            throw new Error('readiness decline means the WHOLE job is a no-go, so excluded[] must be empty. A mixed job is not a decline: pick the honest lane for the in-scope work and put the no-go part in excluded[].');
        }
    } else if (declineReason) {
        throw new Error('declineReason is only valid with readiness decline. For a mixed job, keep the reason on the excluded[] entry instead and pick the honest lane for the in-scope work.');
    }

    return {
        // Both candidates pass the placeholder gate: the stored contactName starts life as the
        // WhatsApp pushname ("Just Me", an emoji, a business in caps) and the model occasionally
        // echoes it back despite the "real name only" instruction. Junk never reaches a quote —
        // a null here is what makes the comms agent ask the customer for their name.
        customerName: realNameOrNull(input?.customerName) ?? realNameOrNull(ctx.contactName),
        phone: ctx.phone,
        postcode: input?.postcode ?? null,
        customerType: (['homeowner', 'landlord', 'letting_agent', 'business'] as const)
            .includes(input?.customerType) ? input.customerType : 'homeowner',
        lines,
        assumptions: (input?.assumptions ?? []).slice(0, 8).map((s: any) => String(s).trim().slice(0, 200)).filter(Boolean),
        readiness,
        declineReason: readiness === 'decline' ? declineReason : null,
        excluded,
        gaps,
        urgency: ['low', 'med', 'high'].includes(input?.urgency) ? input.urgency : 'med',
    };
}

export async function runQuotePrep(
    conversationId: string,
    runOpts: { runId?: string; trigger?: string; parentRunId?: string | null } = {},
): Promise<{ intake: QuoteIntake | null; summary: string; turns: number; runId: string }> {
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

                // Pre-gated: a pushname placeholder ("Just Me", an emoji, a business in caps)
                // reads as null here, so the clerk cannot mistake it for a name the customer gave.
                const data = { contactName: realNameOrNull(conv.contactName), phone: e164, timeline };
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
                        enum: ['quote_ready', 'needs_info', 'visit_first', 'decline'],
                        description: 'quote_ready = everything needed to price it is here. needs_info = one or more answers would change the price or the scope. visit_first = it cannot honestly be priced remotely (hidden/unknown extent, suspected damp or leak behind fabric, or the customer wants work we can only scope on site). decline = the WHOLE job is one of the four no-go certified trades (see system prompt) — a proposal for Ben, never sent directly.',
                    },
                    declineReason: {
                        type: ['string', 'null'],
                        description: 'ONLY with readiness decline, one of: gas_work, roofing_height, structural, major_electrical. null for every other readiness.',
                    },
                    excluded: {
                        type: 'array',
                        description: 'MIXED JOBS ONLY: no-go work excluded from an otherwise quotable job. Each entry is {work, reason}. Do NOT also list the excluded work as a job line. Empty for single-scope jobs and for whole-job declines.',
                        items: {
                            type: 'object',
                            properties: {
                                work: { type: 'string', description: 'The excluded work in the customer\'s terms, e.g. "service the boiler". Must itself show the no-go trigger.' },
                                reason: { type: 'string', enum: ['gas_work', 'roofing_height', 'structural', 'major_electrical'] },
                            },
                            required: ['work', 'reason'],
                        },
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
                                impact: {
                                    type: 'string',
                                    enum: ['none', 'small', 'large', 'forks_job'],
                                    description: 'How much the ANSWER could change the work. none = curiosity, not price-relevant (should not be a gap at all). small = minor scope tweak (a fitting spec, exact colour). large = meaningful chunk of labour or materials swings on it (how many, how big, what condition). forks_job = the answer changes WHICH job this is (repair vs replace, kitchen vs bathroom). Judge the WORK, never money.',
                                },
                            },
                            required: ['question', 'audience', 'lineIndex', 'impact'],
                        },
                    },
                    urgency: { type: 'string', enum: ['low', 'med', 'high'] },
                },
                required: ['customerName', 'postcode', 'customerType', 'lines', 'assumptions', 'readiness', 'declineReason', 'excluded', 'gaps', 'urgency'],
            },
            run: async (input: any) => {
                intake = normalizeIntake(input, { phone: e164, contactName: conv.contactName ?? null });
                return {
                    accepted: true,
                    lines: intake.lines.length,
                    readiness: intake.readiness,
                    declineReason: intake.declineReason,
                    excluded: intake.excluded.length,
                    gaps: intake.gaps.length,
                };
            },
        },
    ];

    const result = await runAgent({
        name: 'quote-prep',
        runId: runOpts.runId, trigger: runOpts.trigger ?? 'manual', conversationId: conv.id, phone: e164,
        // The comms run that handed off, when there was one — kept in the transcript ref for now
        // (agent_runs has no parent column in Phase 1).
        transcriptRef: runOpts.parentRunId ? `parent:${runOpts.parentRunId}` : undefined,
        system: SYSTEM,
        goal: `Prepare the quote intake for conversation ${conv.id} (customer: ${realNameOrNull(conv.contactName) || e164}).`,
        tools,
        model: 'claude-sonnet-5',
        maxTurns: 6,
        // Raised from 3,000 on 20 Aug 2026: a five-job verbal list (bath reseal, two wall lights,
        // extractor, TV mount, shed) truncated the intake mid-write — five titled lines with
        // evidence and assumptions each simply cost more output than one. Per response, so a small
        // job still spends only what it needs.
        maxTokens: 8000,
    });

    return { intake, summary: result.finalText, turns: result.turns, runId: result.runId };
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
- visit_first — it cannot be priced remotely at all: hidden extent, suspected movement or
  subsidence, a leak or damp behind fabric, or work only a site visit can scope. Say so early
  rather than quoting a guess.
- decline — the WHOLE job is one of the four no-go trades below. A PROPOSAL for Ben, nothing more.

DECLINE — only these four, ever (they need certification or specialist access we don't have):
- gas_work: boiler repair/service, gas hob install, flue work — anything Gas Safe.
- roofing_height: full roof work, chimneys, anything needing scaffold beyond a standard ladder job.
- structural: alterations — wall removal, lintels, underpinning; needs calcs / building control.
  (Investigating cracks or suspected movement is NOT this — that is visit_first.)
- major_electrical: consumer units, rewires, new circuits — Part P notifiable. Swaps of
  existing fittings, sockets and switches are normal handyman work, NOT this.
Set readiness decline with declineReason, still write the job lines (they are Ben's evidence),
and ask the customer nothing. Ben approves before any polite no goes out.
NEVER decline for: distance (note travel as a ben-audience gap if worth flagging), job size
(no minimum — small jobs feed reviews), customer behaviour (surface flags to Ben as ben-audience
gaps with the evidence; the decision is his), urgency we can't meet (that is Ben's diary, not
your call), another trade's botched work (a normal job), a tenant messaging directly (quote them
like any customer), or large/multi-trade renovation-scale work (visit_first, never decline).
MIXED JOBS: if a job mixes no-go and in-scope work ("fix the fence and service the boiler"),
that is NOT a decline. Quote the in-scope work in lines[] as normal, put the no-go part in
excluded[] as {work, reason} — not as a job line — and judge readiness on the in-scope work only.

ONE ROUND OF QUESTIONS, THEN PRICE IT. If the thread shows we already asked the customer scoping
questions and they answered, do not open a second round — every round costs a day at customer
reply speed, and 20 Aug 2026 proved a thread can stall on its own diligence. Whatever is still
unknown but would not swing the price wildly goes into the line's ASSUMPTIONS instead (that is
what they exist for — they are printed on the quote): "assumes a standard mono mixer tap",
"assumes working isolation valves; if seized, isolating the supply is a small extra". Verdict
quote_ready. Reserve a second needs_info for an answer that genuinely forks the JOB (kitchen vs
bathroom changes the work; mixer vs pillar taps changes a part number, which is an assumption).
visit_first remains the honest verdict for the genuinely unpriceable.

GAPS: one question each, in customer-friendly words, ending in a question mark, because a
customer gap may be sent to them nearly verbatim. audience 'customer' when only they can answer;
audience 'ben' when it is trade judgement or our own records. lineIndex points at the line it
belongs to (1-based) or null for the whole job. Never ask for a full address — postcode only.
No em dashes in gap questions. Do not pad the list: a gap that would not change the price or the
scope is not a gap.

IMPACT, on every gap — how much the ANSWER could change the WORK (judge the work, never money):
- forks_job: the answer decides WHICH job this is. Repair vs replace. Kitchen vs bathroom.
- large: a real chunk of labour or materials swings on it. How many metres of fence. Whether the
  carcass behind the hinges is sound.
- small: a detail that tweaks the spec, not the scope. Exact colour, brand preference, which of
  two standard fittings.
- none: does not move price or scope — which means it should not be a gap; drop it instead.
This label is what decides whether the question is ASKED or the uncertainty rides as a printed
assumption, so an inflated label costs the customer a question and a deflated one costs us a
misquote. Be honest, per gap.

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
    mission: 'Turns a comms thread (messages, calls, photos, video) into a quote-ready intake: customer-facing job lines with the evidence and caveats behind each, plus a readiness verdict (quote ready / needs info / visit first / decline proposed for the four no-go trades) and the exact questions still open. Prefilled into Ben\'s builder. Ben checks, prices and sends — including approving any polite no before it goes out.',
    model: 'claude-sonnet-5',
    cadence: 'On demand, from the "Prep quote" button in a comms thread',
    autonomy: {
        freely: ['Read the thread, media, call transcripts and prior quotes', 'Extract job lines, assumptions, the readiness verdict and the open questions'],
        approval: ['Everything — its output only prefills the builder; Ben prices and sends the quote'],
        never: ['Put a price on anything', 'Message a customer', 'Invent a postcode, name or scope detail not in the thread', 'Decline for distance, job size, behaviour, urgency or scale — only the four no-go trades, and only as a proposal'],
    },
    tools: [
        { name: 'get_thread', blurb: 'Full conversation incl. photos + video keyframes', kind: 'read' },
        { name: 'get_prior_quotes', blurb: 'Existing quotes for this customer', kind: 'read' },
        { name: 'submit_intake', blurb: `The structured intake, validated: price-free, titles capped at ${LINE_TITLE_MAX} chars, verdict consistent with the gaps`, kind: 'write' },
    ],
} as const;
