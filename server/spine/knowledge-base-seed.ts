/**
 * Build plan v2, item 3.4: the seed — a FIRST DRAFT of the knowledge base, for Ben to correct.
 *
 * Every row here lands UNREVIEWED, which means no customer can ever see a word of it until Ben has
 * read it and pressed one button. That is the whole safety story of this item, so the seed is kept
 * short on purpose: review s29 finding 1.19 asked for "what he will actually read", not everything
 * the repository says about the business.
 *
 * WHERE THE WORDS COME FROM. The facts are drawn from the sources that are already authoritative
 * in the code: `brand-voice/whatsapp-comms.md` (the house rules and Ben's own vocabulary, from
 * 10,267 of his real messages), `docs/DECLINE_CRITERIA.md` as narrowed by T18 (gas only),
 * `server/spine/prompts/scoper.core.md`, the quote page's own payment line, and the service area
 * the auto-ack already assumes. They are written in Ben's voice: short, plain, UK English, no em
 * dashes, no figures, no dates, no credentials we do not hold.
 *
 * WHAT IS DELIBERATELY NOT HERE. The business's public website says four things the desk's own
 * rules forbid it from saying: a free quote, no call-out charge, Gas Safe registered engineers,
 * and a fix at no charge. Importing those as facts would put the desk's first invented claim in
 * Ben's mouth on day one. They are seeded as QUESTIONS instead (kind 'question'), each naming what
 * the website claims and what the rules say, so Ben resolves the conflict rather than inheriting
 * it. A question is never sendable, by CHECK as well as by accessor.
 *
 * Nothing in this file is wired into a reply path. It is data.
 */
import type { KbDraft } from './knowledge-base';
import { FIXED_LINE_IDS } from './knowledge-base';

export type KbSeed = KbDraft & { id: string; topic: string };

/** What the desk can say about the business, once Ben has said yes to the words. */
export const SEED_ANSWERS: KbSeed[] = [
    {
        id: 'areas-covered',
        topic: 'Which areas do you cover?',
        approvedWords: 'We are Nottingham based and cover Nottingham, Derby and the villages around them. Send me your postcode and I will tell you straight away if we can get to you.',
        bannedWords: ['all areas', 'anywhere', 'nationwide', 'no limit', 'we cover everywhere'],
        benNote: 'Four places in the system say four different things about how far we go: Nottingham and Derby (the auto acknowledgement), "Nottinghamshire and Derbyshire, all areas" (an old voicemail script), Nottingham alone (the policy pack), and "no fixed limit, you weigh travel per job" (the decline criteria). Please write the one you actually mean. If there is a distance you turn down, say it here.',
        sourceNote: 'server/first-contact-ack.ts (Nottingham and Derby); docs/DECLINE_CRITERIA.md (no fixed limit, travel weighed per job).',
    },
    {
        id: 'how-quoting-works',
        topic: 'How does the quote work?',
        approvedWords: 'Send me a photo or a quick video of the job and your postcode, and I will get a written quote over to you. It is itemised, so you can see exactly what you are paying for before you decide anything.',
        bannedWords: ['free quote', 'instant price', 'no obligation', 'same day', 'we will price it up'],
        benNote: 'This says nothing about whether the quote costs anything, because the website and the house rules disagree. See the open question "Is the quote free?".',
        sourceNote: 'server/spine/prompts/scoper.core.md; brand-voice/whatsapp-comms.md ("I will send your quote over shortly").',
    },
    {
        id: 'deposit-and-payment',
        topic: 'How do I pay, and when?',
        approvedWords: 'You pay a deposit on your quote page to get the job booked in, then the rest once the work is done. The deposit amount is on your quote.',
        bannedWords: ['cash only', 'pay up front', 'full payment before', 'no deposit'],
        benNote: 'The deposit is a percentage set in the admin and it can be changed, so this entry never says a figure. The quote page carries the number. Tell me if that is wrong.',
        sourceNote: 'client/src/components/quote/AdmiralQuoteChrome.tsx ("deposit today, pay the rest after"); depositPercent in the pricing settings.',
    },
    {
        id: 'guarantee',
        topic: 'Is the work guaranteed?',
        approvedWords: 'We stand behind our work. If something is not right after we have been, message me on here and I will get it looked at.',
        bannedWords: ['at no charge', 'we come back and fix it free', 'free of charge', '12 month guarantee', 'guaranteed for a year', 'lifetime'],
        benNote: 'Deliberately does not say the fix is free or how long the guarantee lasts, because the website says one thing, the call scripts say another, and the house rules say do not say either. See the open questions "Do we put it right at no charge?" and answer them, then this entry can say what is true.',
        sourceNote: 'brand-voice/whatsapp-comms.md (the "we come back and fix it free" line is on the do-not-say list, observed twice in 10,267 messages).',
    },
    {
        id: 'insurance-and-who-turns-up',
        topic: 'Are you insured? Who actually turns up?',
        approvedWords: 'Yes, we are fully insured for public liability, and everyone who comes out is DBS checked. You will know who is coming before the day.',
        bannedWords: ['certified', 'Gas Safe', 'qualified', 'accredited', 'vetted by', 'best in'],
        benNote: 'The insurance figure and the underwriter are on the website. The desk is not allowed to send a money figure at all, so this entry states the fact without the number. Please confirm the cover is current and that DBS checking is still true of everyone.',
        sourceNote: 'client/src/components/AxaInsuredBadge.tsx; client/src/config/va-scripts.ts (DBS checked); brand-voice/whatsapp-comms.md bans credentials we do not hold.',
    },
    {
        id: 'what-we-do-not-do',
        topic: 'Is there anything you will not take on?',
        approvedWords: 'The only things we do not take on are gas work, anything that needs a Gas Safe engineer, and asbestos removal. Plumbing, leaks, water heaters, electrics, roofing and the rest are all ours.',
        bannedWords: ['out of scope', 'we do not do plumbing', 'we do not do electrics', 'our Gas Safe engineers'],
        benNote: 'This is the boundary as you narrowed it on 7 September: gas only, the rest is ours. Asbestos is in because nobody asked you about it. Say if that is wrong.',
        sourceNote: 'docs/DECLINE_CRITERIA.md as narrowed by T18; server/spine/triage.ts RE_REGULATED.',
    },
    {
        id: 'what-happens-on-the-day',
        topic: 'What happens on the day?',
        approvedWords: 'We will have your full address and a contact for the day before we come. We turn up with what the job needs, get it done, clear up after ourselves, and you pay the rest once you are happy with it.',
        bannedWords: ['all done in one visit', 'in and out', 'we will be there at', 'first thing', 'same day'],
        benNote: 'Written without a time, a duration or a number of visits, because the desk is not allowed to promise any of those. If there is something you always do on the day that customers ask about (parking, keys, taking the old one away), add it here in your words.',
        sourceNote: 'brand-voice/whatsapp-comms.md (full address and site contact after the deposit); server/spine/job-pack.ts (access, parking, what done looks like).',
    },
    {
        id: 'how-soon-can-you-come',
        topic: 'How soon can you come?',
        approvedWords: '',
        bannedWords: ['same day', '24/7', 'tomorrow', 'this week', 'next week', 'straight away', 'immediately'],
        benNote: 'YOUR WORDS NEEDED. This is the one entry we could not draft, because nothing in the system knows the honest answer. Write the typical wait for a normal job, in your words, with no promise in it. It is used only until there are enough finished jobs to compute a real lead time, and the desk will never name a date: booking stays on the picker.',
        sourceNote: 'Build plan v2 item 8.2: below the data floor the desk uses this entry.',
    },
    {
        id: 'photos-why-we-ask',
        topic: 'Why do you need a photo?',
        approvedWords: 'A photo or a quick video saves you a visit and gets you a proper price rather than a guess. If you cannot get one, tell me what you can see and we will work from that.',
        bannedWords: ['we cannot quote without', 'you must send', 'required'],
        benNote: 'Matches the rule that we ask once and never insist. Change the wording if it is not how you would say it.',
        sourceNote: 'brand-voice/whatsapp-comms.md (photo or video first, 69% of threads); server/spine/media-ask.ts (ask once).',
    },
    {
        id: 'survey-visit',
        topic: 'Can you come and look at it first?',
        approvedWords: 'For a job that cannot be priced from photos we can come out and look properly. That is a paid survey visit, and the fee comes off the job when you go ahead.',
        bannedWords: ['free visit', 'pop round', 'no charge', 'free survey', 'come and take a look for you'],
        benNote: 'This is the house rule as it stands: visits are never free and only you book one. The website says the opposite. See the open questions.',
        sourceNote: 'brand-voice/whatsapp-comms.md HOUSE RULE ("visits are never free, a look round is a paid survey with the fee off the job").',
    },
];

/**
 * The four threads the desk does not scope (the captain's answer 21). Item 1.4 sends one of these
 * instead of a Scoper reply and hands the thread to Ben. Drafted here so that item has only to read
 * them; each commits us to nothing, admits nothing, and names nobody in the third person.
 */
export const SEED_FIXED_LINES: KbSeed[] = [
    {
        id: FIXED_LINE_IDS.gas,
        topic: 'FIXED LINE: gas work',
        approvedWords: 'That one needs a Gas Safe engineer, so it is not something we can take on ourselves.\n\nIf there is anything else on the list that is handyman work, I would be glad to help with that.\n\nThanks\nBen',
        bannedWords: ['our Gas Safe engineers', 'we can sort the gas', 'I know someone'],
        benNote: 'Sent whole, on its own, whenever gas work comes up, and then the thread is yours. It does not refer anyone on, because there is no partner list. Add one line if you would rather point them somewhere.',
        sourceNote: 'docs/DECLINE_CRITERIA.md polite no; build plan v2 item 1.4.',
    },
    {
        id: FIXED_LINE_IDS.complaint,
        topic: 'FIXED LINE: an unhappy customer',
        approvedWords: 'Really sorry about that.\n\nI am finding out where we are up to with it now and I will come straight back to you today.',
        bannedWords: ['we will put it right free', 'that was our fault', 'we will refund', 'no charge', 'I will be there'],
        benNote: 'Deliberately admits nothing, promises no money and no date, and says only that someone is on it. It is what buys you the time to answer properly. Change the words, not the shape.',
        sourceNote: 'server/spine/prompts/scoper.core.md (complaints: acknowledge, commit to nothing); build plan v2 item 1.4.',
    },
    {
        id: FIXED_LINE_IDS.refund,
        topic: 'FIXED LINE: a customer asking for money back',
        approvedWords: 'Understood, and thanks for saying so straight.\n\nI want to look at this properly rather than answer off the top of my head, so give me a bit and I will come back to you on it today.',
        bannedWords: ['we will refund', 'you will get your money back', 'no refunds', 'our policy is'],
        benNote: 'Money is always yours to decide, so this says nothing about the money. It buys the time and keeps them from being ignored.',
        sourceNote: 'brand-voice/whatsapp-comms.md (no figures unless you supplied them); build plan v2 item 1.4.',
    },
    {
        id: FIXED_LINE_IDS.trust,
        topic: 'FIXED LINE: a customer who is unsure we are genuine',
        approvedWords: 'Completely fair to ask, and I would rather you did.\n\nWe are a Nottingham handyman business, we are insured, and nothing gets paid until you have a written quote in front of you with everything itemised.\n\nAnything you are unsure about, ask me straight and I will answer it.',
        bannedWords: ['we are not a scam', 'trust me', '100%', 'thousands of customers', 'best reviewed'],
        benNote: 'The rule is that once someone doubts the channel, every reply on that thread waits for a person. This is the one line that goes first so they are not left in silence. Say it how you would say it.',
        sourceNote: 'server/spine/prompts/scoper.core.md (trust_concern); build plan v2 item 1.4.',
    },
];

/**
 * The website says these four things. The desk's own rules forbid all four. They are questions for
 * Ben, not entries: an entry asserting any of them would be the desk's first invented claim, and
 * he is the only person who can say which side is true (review s29 finding 1.19; s10 §4).
 */
export const SEED_QUESTIONS: KbSeed[] = [
    {
        id: 'question-is-the-quote-free',
        kind: 'question',
        topic: 'Is the quote free?',
        benNote: 'THE WEBSITE SAYS: "Quotes are free with no obligation." THE DESK\'S RULES SAY: visits are never free, and a look round is a paid survey with the fee off the job. Those can both be true if you mean a written quote from photos is free and a visit is not, but nobody has said so. Which is it, and may the desk use the word "free" about a quote at all?',
        sourceNote: 'server/seo/render.ts universal FAQ; brand-voice/whatsapp-comms.md HOUSE RULE on free visits.',
    },
    {
        id: 'question-call-out-charge',
        kind: 'question',
        topic: 'Is there a call-out charge?',
        benNote: 'THE WEBSITE SAYS: "no call-out charge", in three places, including on every service page. THE DESK\'S RULES SAY: the only visit we sell is a paid survey, and it may never offer to come out for nothing. Do we ever attend without charging, and if so when? Until you answer, the desk says nothing about call-out charges either way.',
        sourceNote: 'server/seo/render.ts; brand-voice/whatsapp-comms.md.',
    },
    {
        id: 'question-gas-safe-engineers',
        kind: 'question',
        topic: 'Do we have Gas Safe engineers we pass gas work to?',
        benNote: 'THE WEBSITE SAYS, on the plumbing page: "notifiable gas work is handled separately by our Gas Safe registered engineers." THE DESK\'S RULES SAY: gas work is the one thing we turn down, and "Gas Safe" is on the list of credentials we must never claim. If there is genuinely someone we hand gas work to, say who, and whether the desk may mention them. If not, the website line needs taking down.',
        sourceNote: 'server/seo/content/services.ts plumbing FAQ; docs/DECLINE_CRITERIA.md; brand-voice/whatsapp-comms.md banned credentials.',
    },
    {
        id: 'question-put-it-right-at-no-charge',
        kind: 'question',
        topic: 'If something is not right, do we put it right at no charge? And for how long?',
        benNote: 'THE WEBSITE SAYS: "all workmanship is guaranteed. If something is not right, we come back and put it right at no charge." THE CALL SCRIPTS SAY: a 12 month guarantee. THE DESK\'S RULES SAY: do not say either, because in 10,267 real messages that line appears twice and neither was yours. What is the guarantee actually, how long does it run, and what does it not cover? Until you answer, the desk only says we stand behind our work and will look at it.',
        sourceNote: 'server/seo/content/services.ts; client/src/config/va-scripts.ts; brand-voice/whatsapp-comms.md do-not-say list.',
    },
];

/** Everything the seed writes, in the order the admin page reads best. */
export const KB_SEED: KbSeed[] = [...SEED_QUESTIONS, ...SEED_ANSWERS, ...SEED_FIXED_LINES];
