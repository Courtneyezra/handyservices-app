/**
 * /privacy — public privacy policy.
 *
 * Required by Meta App Review (a reviewer opens the app's privacy_policy_url and checks it is a
 * real policy). It was previously pointed at /admin, which serves a login screen — an easy
 * rejection, and the SPA catch-all meant the URL returned 200 rather than 404, so nothing flagged
 * it as missing.
 *
 * Content is drafted from what the system actually processes: WhatsApp and SMS messages, call
 * recordings and transcripts, customer-supplied photos and video, quotes, and Stripe payments.
 * It is a starting point drafted by an engineer, not legal advice — it should be reviewed before
 * being relied on.
 *
 * 8 Sep 2026 (plan v2 item 0.8, from review finding s30 F7): the recipient list named only
 * Twilio/Meta, Stripe, tradespeople and accountants/HMRC. It did not name the processors that
 * actually read customer content — Anthropic (every message read for triage and every reply
 * drafted: server/llm.ts, server/spine/*), Google (photo and video description via Gemini:
 * server/spine/tools/describe-video.ts; Maps/Places for addresses), Deepgram (call transcripts:
 * server/deepgram.ts), OpenAI (legacy drafting and voice-note transcription: server/openai.ts,
 * server/voice.ts, server/quotes.ts), AWS S3 (recordings and media: server/storage.ts,
 * server/s3-media.ts), Neon (database), Railway (hosting), Resend (email), Pushover (staff
 * alerts) and PostHog (analytics on the quote/booking pages) — and it did not say that replies
 * may be drafted and sent by an automated assistant. That becomes a transparency problem under
 * UK GDPR Articles 13/22 at the moment the desk stops holding every reply for a person.
 *
 * The corresponding internal record is docs/COMMS_RECORD_OF_PROCESSING.md. Retention: the
 * periods stated below are the business's stated policy; NOTHING IN THE CODE ENFORCES THEM
 * (there is no deletion job — see that document, §6). Do not add a stricter period here until
 * a job exists that carries it out.
 *
 * There is deliberately NO bot-disclosure line in the chat itself (owner decision, 7 Sep,
 * restated 8 Sep as answer 24). The transparency lives on this page.
 */
const UPDATED = '8 September 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mt-8">
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
        </section>
    );
}

export default function PrivacyPolicyPage() {
    return (
        <main className="mx-auto max-w-3xl px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
            <p className="mt-2 text-sm text-slate-500">Last updated {UPDATED}</p>

            <p className="mt-6 text-sm leading-relaxed text-slate-700">
                This policy explains what personal information Handy Services collects when you contact us or book
                work, why we hold it, and what rights you have over it. We are the data controller for that
                information under UK GDPR.
            </p>

            <Section title="Who we are">
                <p>
                    Handy Services is a home repair and maintenance company operating in Nottingham and the
                    surrounding area. If you have any question about this policy or your information, email{' '}
                    <a className="text-blue-700 underline" href="mailto:bookings@handyservices.app">
                        bookings@handyservices.app
                    </a>.
                </p>
            </Section>

            <Section title="What we collect">
                <ul className="list-disc space-y-1 pl-5">
                    <li><strong>Contact details</strong> — your name, phone number, email address and the address where work is needed.</li>
                    <li><strong>Messages</strong> — WhatsApp and SMS conversations between you and us, including any photos or videos you send of the job.</li>
                    <li><strong>Calls</strong> — if you phone us, we may record the call and generate a written transcript so we can quote accurately and check the service you received.</li>
                    <li><strong>Enquiries</strong> — anything you submit through a form on our website.</li>
                    <li><strong>Job and payment records</strong> — quotes, bookings, invoices, and payment confirmations.</li>
                </ul>
            </Section>

            <Section title="Why we hold it">
                <p>We use your information to:</p>
                <ul className="list-disc space-y-1 pl-5">
                    <li>reply to your enquiry and prepare a quote, including by having our automated assistant read the conversation and draft the reply (see <em>Our automated assistant</em> below)</li>
                    <li>schedule work and send you updates about your booking</li>
                    <li>send an invoice and take payment</li>
                    <li>keep a record of work carried out, including before-and-after photos, in case of a warranty claim</li>
                    <li>improve how we answer calls and messages</li>
                </ul>
                <p>
                    Our lawful bases are <strong>contract</strong> (arranging and carrying out work you have asked for)
                    and <strong>legitimate interests</strong> (running the business, keeping records, and improving
                    our service). Where we rely on consent — for example call recording — you can withdraw it at any time.
                </p>
            </Section>

            <Section title="WhatsApp and SMS">
                <p>
                    We use the WhatsApp Business Platform and SMS to talk to customers. Messages you send us are
                    stored in our internal system so any member of our team — or our automated assistant — can pick up the
                    conversation and reply.
                    WhatsApp is operated by Meta and messages are also processed under{' '}
                    <a className="text-blue-700 underline" href="https://www.whatsapp.com/legal/privacy-policy" target="_blank" rel="noreferrer">
                        WhatsApp's own privacy policy
                    </a>.
                </p>
                <p>You can ask us to stop messaging you at any time by replying to any message.</p>
            </Section>

            <Section title="Who we share it with">
                <p>
                    We do not sell your information, and none of the providers below is allowed to use it for their
                    own purposes. We share it only with the service providers we need to run the business, and only
                    so far as they need it:
                </p>
                <ul className="list-disc space-y-1 pl-5">
                    <li><strong>Twilio and Meta</strong> — to deliver WhatsApp, SMS and calls</li>
                    <li><strong>Anthropic</strong> — the assistant that reads our messages and drafts replies runs on Anthropic's Claude models. Your messages, your name and phone number, the job details, a summary of any call, and the description of any photo or video you send are sent to Anthropic so it can understand your enquiry and write a reply</li>
                    <li><strong>Google</strong> — photos and videos you send are sent to Google's Gemini service, which writes a short description of what they show so we can quote from them. Google Maps also powers address look-up on our forms and the map on your quote page</li>
                    <li><strong>Deepgram</strong> — to turn a recorded call into a written transcript</li>
                    <li><strong>OpenAI</strong> — used by some older parts of our system to draft the wording of a quote message, and to transcribe voice notes recorded by our own team</li>
                    <li><strong>Amazon Web Services</strong> — stores call recordings and the photos and videos you send (S3, London region)</li>
                    <li><strong>Neon and Railway</strong> — host our database and our servers, where your record and your messages are kept</li>
                    <li><strong>Resend</strong> — to send you email (booking confirmations, invoices and reminders)</li>
                    <li><strong>Stripe</strong> — to take card payments (we never see or store your full card details)</li>
                    <li><strong>Pushover</strong> — sends alerts to our own phones so we notice your message; an alert can contain your name and a line of what you wrote</li>
                    <li><strong>PostHog</strong> — measures how our quote and booking pages are used, including a recording of the page you are on with text fields hidden</li>
                    <li><strong>Our tradespeople</strong> — the name, address and job details needed to carry out your work</li>
                    <li><strong>Our accountants and HMRC</strong> — where required for tax and accounting</li>
                </ul>
                <p>
                    Some of these providers are based outside the UK. Where information leaves the UK we rely on the
                    provider's standard data-protection terms and the safeguards approved for international
                    transfers.
                </p>
            </Section>

            <Section title="Our automated assistant">
                <p>
                    We use an automated assistant to help us keep up with messages. It reads the conversation on a
                    thread — your messages, any photos or video you send, and a summary of any call — and it may
                    draft and send a reply on our behalf, so you are not left waiting. Anything unusual is held for
                    a person to look at before it goes out, and a person sets every price and confirms every
                    booking.
                </p>
                <p>
                    You can ask for a person at any time. Say so in your reply — asking us to call you or ring
                    you back is the surest way — and we will pick the conversation up ourselves. The assistant is
                    not used to make decisions about you that have a legal or similarly significant effect.
                </p>
            </Section>

            <Section title="How long we keep it">
                <ul className="list-disc space-y-1 pl-5">
                    <li><strong>Job, quote and invoice records</strong> — six years, as required for tax purposes.</li>
                    <li><strong>WhatsApp and SMS conversations</strong> — up to two years, then deleted.</li>
                    <li><strong>Photos and videos you send</strong> — kept with the conversation and the job record they belong to, for up to two years, or six years where they are the evidence behind a job we carried out.</li>
                    <li><strong>Call recordings and their written transcripts</strong> — up to two years, then deleted.</li>
                </ul>
                <p>
                    The providers listed above hold their own short-lived copies of whatever passes through them —
                    for example a message in transit, or a photo while it is being described. They keep those under
                    their own terms and are not permitted to use them for anything else.
                </p>
                <p>
                    If you ask us to delete your information sooner, we will do so unless we are legally required to
                    keep it.
                </p>
            </Section>

            <Section title="Your rights">
                <p>Under UK GDPR you can ask us to:</p>
                <ul className="list-disc space-y-1 pl-5">
                    <li>give you a copy of the information we hold about you</li>
                    <li>correct anything that is wrong</li>
                    <li>delete your information</li>
                    <li>stop using it for a particular purpose</li>
                </ul>
                <p>
                    Email{' '}
                    <a className="text-blue-700 underline" href="mailto:bookings@handyservices.app">
                        bookings@handyservices.app
                    </a>{' '}
                    and we will respond within one month. If you are unhappy with how we have handled your
                    information you can complain to the Information Commissioner's Office at{' '}
                    <a className="text-blue-700 underline" href="https://ico.org.uk" target="_blank" rel="noreferrer">ico.org.uk</a>.
                </p>
            </Section>

            <Section title="Changes to this policy">
                <p>
                    If we change how we handle your information we will update this page and change the date at the
                    top.
                </p>
            </Section>

            <p className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-400">
                Handy Services · Nottingham · bookings@handyservices.app
            </p>
        </main>
    );
}
