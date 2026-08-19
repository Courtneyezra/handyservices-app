/**
 * The post-quote lever list — what Ben actually does when a customer pushes back on a price,
 * and which band of quote it suits.
 *
 * EVIDENCE: docs/WHATSAPP-CONVERSATION-ANALYSIS.md (19 Aug 2026), drawn from 10,267 real
 * messages. Two findings from that document drive this entire file, and both of them contradict
 * the obvious design:
 *
 *   1. Nothing Ben SAYS separates a sale from a loss once you control for thread length. Every
 *      behavioural lever we looked for died under a confound check. What survives is the PRICE
 *      ON THE QUOTE: 59% conversion at £100-200, 15% at £1,000+. So a post-quote reply is routed
 *      by BAND FIRST, wording second. A warmer paragraph does not move a £1,400 quote.
 *   2. Of the 19 threads with both a quote link and an objection, the commonest move was a
 *      graceful exit ("No problem.") — 8 threads, 1 sale, 13%. It is his single worst performing
 *      response. Amending or re-quoting was the best: 3 threads, 2 sales, 67%.
 *
 * Sample sizes on the objection table are small (n=19) and the analysis labels them directional.
 * They are directional in the SAME direction as the price-band table (n=215) and
 * docs/PRICE-BARRIER-ANALYSIS-2026-07-02.md, which is why they are encoded rather than ignored.
 *
 * Nothing in this file authorises the agent to move money. The levers that change what a customer
 * pays are all marked authority:'ask_ben'; the ones the agent may use alone change only what it
 * SAYS. server/agents/draft-guards.ts enforces that separation at the tool boundary.
 */

// ---------------------------------------------------------------- price bands

export type PriceBandId = 'micro' | 'sweet' | 'plateau' | 'wall';

export interface PriceBand {
    id: PriceBandId;
    label: string;
    /** Inclusive lower bound in pence. */
    minPence: number;
    /** Exclusive upper bound in pence, or null for the top band. */
    maxPence: number | null;
    /** Observed conversion in the corpus, quoted so the agent can see why the posture differs. */
    conversion: string;
    /** How hard to work this quote, in one line. */
    posture: string;
    /** What the agent is allowed to reach for in this band. */
    playbook: string;
}

/**
 * Bands and conversion rates from the corpus (n=215 quotes). Independently replicated by
 * docs/PRICE-BARRIER-ANALYSIS-2026-07-02.md from a separate data source, which is the reason
 * these are treated as solid while the objection table is treated as directional.
 */
export const PRICE_BANDS: readonly PriceBand[] = [
    {
        id: 'micro',
        label: 'under £100',
        minPence: 0,
        maxPence: 10_000,
        conversion: '35% (12 paid / 34 quoted)',
        posture: 'Light touch. The reply costs more attention than the job is worth.',
        playbook: 'Answer the question, one lever at most, sign off. Do not build a case.',
    },
    {
        id: 'sweet',
        label: '£100 to £200',
        minPence: 10_000,
        maxPence: 20_000,
        conversion: '59% (35 paid / 59 quoted) — the best band we have',
        posture: 'Light touch. This band already converts; do not over-work it.',
        playbook: 'Name what the money buys in one line, invite the comparison, sign off. Nothing structural.',
    },
    {
        id: 'plateau',
        label: '£200 to £1,000',
        minPence: 20_000,
        maxPence: 100_000,
        conversion: '33-38%, flat across the whole range',
        posture: 'Flat plateau. Conversion does not improve as the price falls inside it, so shaving money off buys nothing.',
        playbook: 'Hold the price with a reason, invite the comparison, and offer to RE-SCOPE. Never propose a reduction: the price-barrier work shows discounting inside this band is pure margin given away.',
    },
    {
        id: 'wall',
        label: '£1,000 and above',
        minPence: 100_000,
        maxPence: null,
        conversion: '15% (5 paid / 34 quoted) — 85% of these die',
        posture: 'Structural, not conversational. A better paragraph does not fix this number.',
        playbook: 'The answer is a different SHAPE of job: split it across visits, defer lines to a second visit, de-scope to the urgent part, or a paid survey first. ask_ben is MANDATORY here with those options named, and a draft never replaces it. Do not improvise a restructure at the customer.',
    },
] as const;

export function priceBandFor(pence: number | null | undefined): PriceBand {
    const p = Math.max(0, Math.round(Number(pence) || 0));
    for (const band of PRICE_BANDS) {
        if (p >= band.minPence && (band.maxPence === null || p < band.maxPence)) return band;
    }
    return PRICE_BANDS[PRICE_BANDS.length - 1];
}

/** True when a quote is over the wall and needs a structural answer rather than a written one. */
export function needsStructuralResponse(pence: number | null | undefined): boolean {
    return priceBandFor(pence).id === 'wall';
}

// ---------------------------------------------------------------- levers

/**
 * 'agent'   — the agent may use this alone in a draft. It changes what we SAY, not what they pay.
 * 'ask_ben' — it changes what the customer pays (or restructures the job). Ben decides, always.
 */
export type LeverAuthority = 'agent' | 'ask_ben';

export interface ObjectionLever {
    id: string;
    name: string;
    /** The customer moment that triggers it. */
    whenItApplies: string;
    /** Bands this lever suits. A lever offered in the wrong band is the wrong lever. */
    bands: readonly PriceBandId[];
    authority: LeverAuthority;
    /** Ben's own words, verbatim from the corpus. Riff on these; do not recite them. */
    bensWords: readonly string[];
    /**
     * For an 'ask_ben' lever: the half of the move the agent may still make ALONE, in the same
     * turn it asks.
     *
     * An authority of 'ask_ben' used to mean the whole lever was unreachable, and the agent read
     * that as "say nothing" — it escalated and the customer got silence while Ben's real reply had
     * done BOTH things at once. Every ask_ben lever that has a content-free half says so here, and
     * the standing orders permit a draft carrying that half alongside the question.
     */
    agentMayAlone?: string;
    /** Ben's own words for that half specifically, so the safe sentence is as concrete as the unsafe one. */
    agentWords?: readonly string[];
    /** Why we believe it, in one line. */
    evidence: string;
    /** The thing that most easily goes wrong with it. */
    guardrail: string;
}

export const OBJECTION_LEVERS: readonly ObjectionLever[] = [
    {
        id: 'name_what_the_money_buys',
        name: 'Name what the money buys',
        whenItApplies: '"too expensive", "a bit much", any flat reaction to the number with no counter-offer.',
        bands: ['sweet', 'plateau', 'wall'],
        authority: 'agent',
        bensWords: [
            'Understand it may seem abit high but ensuring tiles are not broken in the process is paramount to us. Also achieving a clean finish means the job wouldn\'t be rushed.',
        ],
        evidence: 'Holding the price with a reason converted 2 of 6; capitulating converted 1 of 8.',
        guardrail: 'The reason must come from the quote\'s own scope or assumptions. Never invent a justification, never claim a credential we do not hold, and never say "fixed price" as a slogan.',
    },
    {
        id: 'invite_the_comparison',
        name: 'Invite the comparison',
        whenItApplies: 'They are shopping around, or they have gone quiet after saying it is too much. Pairs with the lever above.',
        bands: ['micro', 'sweet', 'plateau', 'wall'],
        authority: 'agent',
        bensWords: [
            'Get a few more quotes and happy to book you in if you come back.',
        ],
        evidence: 'The best line in the corpus. It is the refusal that leaves the door open, against Pattern D (a flat "that is as low as we can go") which closes it.',
        guardrail: 'This ENDS a reply warmly, it does not end the relationship. Never pair it with a goodbye.',
    },
    {
        id: 'name_the_resourcing',
        name: 'Name the resourcing',
        whenItApplies: 'They are comparing us against a one-man price, or against what they paid someone else.',
        bands: ['sweet', 'plateau'],
        authority: 'agent',
        bensWords: [
            'Unfortunately this is the price that we would charge for 2 people to come and install it.',
        ],
        evidence: 'Converted a flat "wow is a bit expensive" into a booking at £182.',
        guardrail: 'ONLY when the quote itself proves the resourcing — a team plan, a multi-day span, a line whose scope needs two pairs of hands. If the quote does not show it, you are inventing it. Ask Ben instead.',
    },
    {
        id: 'rescope_not_discount',
        name: 'Re-scope, do not discount',
        whenItApplies: 'Any objection where some of the work is optional, deferrable, or on the wrong customer segment. This is the discount-free discount.',
        bands: ['sweet', 'plateau', 'wall'],
        authority: 'agent',
        bensWords: [
            'Yeah no problem let us edit it for you.',
            'I will amend the quote to add one more window and take out the other jobs.',
            // His line, minus the half he is allowed to say and you are not. The original went on
            // "then Thats will bring the price down", which commits to a direction on price and is
            // refused by the discount guard, correctly and by this lever's own guardrail.
            'We just noticed you quote is set to home owner not property manager. Let me edit and do that and then you can view it again.',
        ],
        evidence: 'Amending or re-quoting converted 2 of 3, the best of any response. All 9 threads carrying more than one quote version paid, 6 of them re-quoted before the deposit.',
        guardrail: 'You may OFFER the edit and ask which parts matter most. You may NEVER state what the edited price would be, and you may never edit the quote yourself. The new number is Ben\'s to set. That includes the third line above: Ben may tell a customer a segment change "will bring the price down", and you may not, because it commits to a direction on price. Say you have spotted the quote is on the wrong customer type and that you will get it corrected.',
    },
    {
        id: 'structural_split',
        name: 'Change the shape of the job',
        whenItApplies: 'A quote at £1,000 or more meets any hesitation at all. 85% of these die and prose will not save them.',
        bands: ['wall'],
        authority: 'ask_ben',
        bensWords: [
            'I will amend the quote to add one more window and take out the other jobs.',
        ],
        evidence: '15% conversion above £1,000 against 59% at £100-200. The size of the number is the objection.',
        guardrail: 'You MUST call ask_ben, every time, with concrete options drawn from the quote\'s own line items (which line defers, what the urgent half is, whether a paid survey should come first). Naming the options is the work; a question with none is not this lever. You may draft a holding reply alongside it, but never present a restructure to the customer before Ben has picked one, and never let the draft stand in for the question.',
    },
    {
        id: 'volume_discount',
        name: 'Volume discount, and only volume',
        whenItApplies: 'THEY propose bundling more work in, e.g. "if we did both sheds would it be cheaper".',
        bands: ['micro', 'sweet', 'plateau', 'wall'],
        authority: 'ask_ben',
        bensWords: [
            // BEN'S HALF. He may say this; you may not, and the discount guard will refuse it.
            'Yeah we can definitely offer some discount if we do it together.',
        ],
        agentMayAlone: 'Get what a combined quote would NEED. That is a scope question, it carries no figure, and it is the half of his reply that moves the job forward: a photo of the second job, what else is in scope, which one they want doing first. Draft that AND ask Ben for the figure in the same turn.',
        agentWords: [
            // His own second message on the same thread, the half with no money in it.
            'If you get me a picture of the other one also I can happily amend the quote for you to include both sheds.',
        ],
        evidence: 'The only discount that appears in the corpus, and it is always customer-initiated. Ben discounts for volume, never for pressure. His winning reply to the £984 shed thread (which PAID) did both halves at once: the discount sentence and the photo ask.',
        guardrail: 'The FIGURE is Ben\'s, always: no number, no percentage, no word implying a reduction, and never "yes we can discount that". The SCOPE half is yours and you should send it, because an escalation on its own leaves the customer with silence while Ben reads his queue.',
    },
    {
        id: 'deposit_is_policy',
        name: 'Hold the deposit, explain it once',
        whenItApplies: '"can I pay cash on the day", "do I have to pay upfront". The single largest objection category.',
        bands: ['micro', 'sweet', 'plateau', 'wall'],
        authority: 'agent',
        bensWords: [
            'Hi unfortunately we do have to take a deposit up front. And that is our fixed price on a tap swap. Any other questions let us know.',
        ],
        evidence: '58 instances, 43 of them in threads that went on to pay. It is a question, not usually a dealbreaker.',
        guardrail: 'State the policy, do not argue it, do not offer an exception. Any deposit AMOUNT you quote must be the one on their quote.',
    },
    {
        id: 'timing_is_a_scheduling_state',
        name: '"Not right now" is a date, not a no',
        whenItApplies: 'Waiting on a dispute, on parts, on payday, on being back from holiday.',
        bands: ['micro', 'sweet', 'plateau', 'wall'],
        authority: 'agent',
        bensWords: [
            'No problem, I will check back in with you then.',
        ],
        evidence: 'One "not right now" thread went on to pay £984, another £479 after nothing more than "Ok no problem". An agent that reads these as rejections destroys value.',
        guardrail: 'Agree a date to COME BACK TO THEM, then actually record it with schedule_recontact so the thread does not die here. A re-contact date is not a booking and must never be written as one. Do not send a rescue message and do not re-pitch.',
    },
    {
        id: 'expiry_is_not_a_weapon',
        name: 'Never lean on the expiry timer',
        whenItApplies: 'The quote is near or past its expiry date.',
        bands: ['micro', 'sweet', 'plateau', 'wall'],
        authority: 'agent',
        bensWords: [
            'No problem, I can get that refreshed for you.',
        ],
        evidence: 'Median time from quote link to deposit is 39 hours and the upper quartile is five days. Nobody in the corpus paid inside the first hour. A countdown is manufactured urgency against a decision that genuinely takes days, and one customer said so out loud before paying anyway.',
        guardrail: 'Offer to refresh it. Never use it as pressure, and never imply the price will rise.',
    },
];

/** The move that must never appear in a draft, kept beside the levers so it reads as policy. */
export const BANNED_MOVE = {
    id: 'capitulate',
    name: 'The graceful exit',
    why: 'A bare "No problem" to a price objection appears 8 times in the corpus and converted once (13%). It is Ben\'s commonest response and his worst. The customer has told you the number is wrong and agreeing to end the conversation changes nothing about the offer.',
    examples: [
        'Customer: "Hi sorry the price is too much thankyou tho" → Ben: "No problem"',
        'Customer: "that\'s far too expensive" → Ben: "Ok no problem at all. Thanks, Ben"',
    ],
} as const;

export function leversForBand(band: PriceBandId): ObjectionLever[] {
    return OBJECTION_LEVERS.filter((l) => l.bands.includes(band));
}

// ---------------------------------------------------------------- standing orders

function renderLever(l: ObjectionLever): string {
    const words = l.bensWords.map((w) => `      "${w}"`).join('\n');
    const authority = l.authority === 'agent'
        ? 'you may use this alone'
        : l.agentMayAlone
            ? 'the FIGURE is BEN\'S — but draft the half below in the same turn'
            : 'ASK BEN, always';
    return [
        `  - ${l.name} [${authority}]`,
        `    when: ${l.whenItApplies}`,
        `    bands: ${l.bands.join(', ')}`,
        `    ${l.authority === 'ask_ben' && l.agentMayAlone ? 'HIS words, not yours' : 'his words'}:`,
        words,
        ...(l.agentMayAlone ? [
            `    YOUR half, draft this while you ask him: ${l.agentMayAlone}`,
            ...(l.agentWords?.length ? [`    in his words:`, l.agentWords.map((w) => `      "${w}"`).join('\n')] : []),
        ] : []),
        `    watch out: ${l.guardrail}`,
    ].join('\n');
}

/**
 * The post-quote block of the comms agent's system prompt. Built from the structures above so
 * there is exactly one copy of this policy and the staff page, the prompt and the guards cannot
 * drift apart.
 */
export function postQuoteStandingOrders(): string {
    const bands = PRICE_BANDS.map((b) =>
        `  - ${b.label} — ${b.conversion}. ${b.posture}\n    ${b.playbook}`,
    ).join('\n');

    return `POST-QUOTE: when a live quote is out, the thread changes shape but your job does not.
You still read what they said, draft a reply, and escalate what you cannot answer. What changes is
that get_thread now hands you the quote itself, and the quote decides how you answer.

WHAT THE 10,267-MESSAGE CORPUS PROVES (docs/WHATSAPP-CONVERSATION-ANALYSIS.md). Do not write
against these, they cost real money to learn:
  - Nothing you SAY separates a sale from a loss once thread length is controlled for. The quote
    VALUE decides. Route by band first, wording second.
  - 102 of 104 quiet customers had already OPENED their quote, 69 of them three or more times.
    NEVER imply they have not seen it. No "did you get a chance to look", no "just checking it
    came through", no re-sending the link as if it went missing. It did not.
  - Median time to deposit is 39 hours, the upper quartile is five days, and nobody paid inside
    the first hour. Silence after a quote is NORMAL. Do not treat a two-day gap as a problem, and
    never manufacture urgency to close one.
  - The commonest reply to a price objection is a polite exit and it is the worst performing one.

PRICE-BAND ROUTING — read the total on their quote, then pick your posture:
${bands}

THE LEVERS, in his words:
${OBJECTION_LEVERS.map(renderLever).join('\n')}

NEVER: ${BANNED_MOVE.why}
  ${BANNED_MOVE.examples.join('\n  ')}
If you find yourself drafting agreement with the customer's decision to stop, you have picked the
losing move. Use a lever, or ask Ben.

DRAFT *AND* ASK — the escalation that leaves them with silence is its own losing move.
A lever marked ask_ben means the FIGURE is Ben's. It does not mean the customer hears nothing until
he gets to his queue. When the only thing you cannot answer is money (or something else only he can
decide), do BOTH in the same turn: queue_draft the content-free half, and ask_ben the rest.
  - The £984 shed thread PAID, and his reply was exactly this shape: the discount sentence (his) and
    "if you get me a picture of the other one I can happily amend the quote" (yours). The agent that
    only escalated left a paying customer waiting.
  - The draft must NOT pre-empt his answer. No figure, no percentage, no "yes we can do that", no
    hint of the direction he will land on. If you cannot write the half you own without leaning on
    the half you do not, then ask alone.
  - Say in your ask_ben context that a draft is already queued, so he reads them together.
  - This runs BOTH ways, and the second way matters just as much: a draft never SUBSTITUTES for the
    question. If the decision is his, ask him, whether or not you also wrote something. Answering
    around a decision you do not own is worse than escalating without a draft, because now nobody
    knows the decision was ever needed. Above £1,000 in particular the structural call is always
    his: draft the holding half if you have one, but the ask_ben is not optional.

MONEY, POST-QUOTE (the guard is absolute and it is enforced in the tool, not on trust):
  - You may repeat a figure that is ALREADY on their quote, and you must cite quote_slug when you
    do. The guard checks the figure against the quote's real numbers, so a figure that is not on
    it will be refused however you label it.
  - You may OFFER a re-scope: "happy to edit it for you, which bits matter most?" That is a
    question about scope, not a price.
  - You may NEVER invent a figure, offer a discount, offer a percentage off, hint that there is
    room to move, or say what an edited quote would come to. Anything that changes what the
    customer pays goes to ask_ben with concrete options.

SCHEDULING, POST-QUOTE:
  - "Can you come Tuesday" is not a yes/no you are allowed to give. Use check_date: it tells you
    only whether that date is already offered on their own quote. It is read-only and it never
    books anything.
  - If the date IS on their quote, point them at the quote's date picker; the booking happens
    there, with the deposit. Do not confirm it yourself.
  - If it is NOT on their quote, ask Ben. Never promise a date the thread or the quote does not
    already confirm.

"NOT RIGHT NOW" IS THE ONE THAT COSTS MOST, because doing nothing looks correct:
  - It is a scheduling state, not a rejection. One of these paid £984 and another paid £479 after
    Ben said nothing more than "Ok no problem".
  - The move is two parts and you own both. Reply warmly, name the thing they are waiting on, and
    say you will check back. Then call schedule_recontact with the date, which writes a PROPOSED
    follow-up for Ben to approve later. It sends nothing and it books nothing.
  - NO_ACTION on a timing hold is how a live lead becomes a dead one. If you cannot work out a
    sensible date, ask them when to check back, or ask Ben. Do not just leave it.`;
}
