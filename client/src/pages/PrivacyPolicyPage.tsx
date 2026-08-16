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
 */
const UPDATED = '16 August 2026';

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
                    <li>reply to your enquiry and prepare a quote</li>
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
                    stored in our internal system so any member of our team can pick up the conversation and reply.
                    WhatsApp is operated by Meta and messages are also processed under{' '}
                    <a className="text-blue-700 underline" href="https://www.whatsapp.com/legal/privacy-policy" target="_blank" rel="noreferrer">
                        WhatsApp's own privacy policy
                    </a>.
                </p>
                <p>You can ask us to stop messaging you at any time by replying to any message.</p>
            </Section>

            <Section title="Who we share it with">
                <p>
                    We do not sell your information. We share it only with the service providers we need to run the
                    business, and only so far as they need it:
                </p>
                <ul className="list-disc space-y-1 pl-5">
                    <li><strong>Twilio and Meta</strong> — to deliver WhatsApp, SMS and calls</li>
                    <li><strong>Stripe</strong> — to take card payments (we never see or store your full card details)</li>
                    <li><strong>Our tradespeople</strong> — the name, address and job details needed to carry out your work</li>
                    <li><strong>Our accountants and HMRC</strong> — where required for tax and accounting</li>
                </ul>
            </Section>

            <Section title="How long we keep it">
                <p>
                    Job, quote and invoice records are kept for six years, as required for tax purposes. Messages and
                    call recordings are kept for up to two years, then deleted. If you ask us to delete your
                    information sooner, we will do so unless we are legally required to keep it.
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
