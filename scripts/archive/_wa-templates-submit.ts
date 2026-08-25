/**
 * Creates the re-engagement WhatsApp templates in Twilio and submits them to Meta for review.
 *
 * Templates are the only way to reach someone once the 24-hour window has shut, and the account
 * had none for quotes or revival (see docs/WHATSAPP_TEMPLATES_FOR_REVIEW.md). Bodies are the
 * house voice: no em dashes, no full-address asks, one question, approved claims only.
 *
 * ONE template per purpose — Meta rejects near-duplicates (that's what killed
 * first_contact_generic while its twin was approved).
 *
 *   npx tsx scripts/_wa-templates-submit.ts --dry-run   # show what would be sent
 *   npx tsx scripts/_wa-templates-submit.ts             # create + submit for review
 */
import 'dotenv/config';

const SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH = 'Basic ' + Buffer.from(`${SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

/** WhatsApp template names: lowercase, digits and underscores only. */
type Tpl = {
    name: string;
    category: 'UTILITY' | 'MARKETING';
    body: string;
    /** Sample values Meta reviews against, positional. */
    variables: Record<string, string>;
    purpose: string;
};

const TEMPLATES: Tpl[] = [
    {
        name: 'quote_ready_link',
        category: 'UTILITY',
        purpose: 'Send a finished quote when the 24h window has shut (today this queues instead of sending)',
        body: 'Hi {{1}}, your quote is ready. Everything is on the link, the itemised price and the booking: {{2}}. Any questions, just reply here.',
        variables: { '1': 'Courtnee', '2': 'https://handyservices.app/quote/ab12cd34' },
    },
    {
        name: 'missed_enquiry_revival',
        category: 'MARKETING',
        purpose: 'Restart a dead enquiry we never replied to (the 25 revival candidates)',
        body: 'Hi {{1}}, you messaged us about a job a while back and never heard anything back. Sorry about that. Still need it doing? Reply here and we will sort you a fixed price. Reply STOP to opt out.',
        variables: { '1': 'Ava' },
    },
    {
        name: 'quote_followup_link',
        category: 'UTILITY',
        purpose: 'Follow up a live quote that has gone quiet',
        body: 'Hi {{1}}, your quote for {{2}} is still live. Everything is on the link, itemised price and booking: {{3}}. Any questions, just reply here.',
        variables: { '1': 'Roshan', '2': 'the grab rails and bathroom light', '3': 'https://handyservices.app/quote/ab12cd34' },
    },
    {
        name: 'call_request',
        category: 'UTILITY',
        purpose: 'First reply to an enquiry that arrived with the WhatsApp window shut (SMS, webform). Voice warms a lead faster than text ping-pong',
        body: 'Hi {{1}}, thanks for getting in touch. Is it OK if we give you a quick call to run through what you need? Or just reply here with the details and we will price it up.',
        variables: { '1': 'Sarah' },
    },
    {
        name: 'missed_call_ack',
        category: 'UTILITY',
        purpose: 'Answer a missed call. A call does NOT open the freeform window, so calls almost always need a template',
        body: 'Hi {{1}}, sorry we missed your call. Tell us what needs doing and we will price it up for you, or we will try you again shortly.',
        variables: { '1': 'Marc' },
    },
    {
        name: 'postcode_request',
        category: 'UTILITY',
        purpose: 'Ask for the postcode when it is the last thing blocking a quote (postcode only, never the address)',
        body: 'Hi {{1}}, we are nearly ready to price your job. What is the postcode? Just so we can quote it properly and get the right person out.',
        variables: { '1': 'Marc' },
    },
];

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    if (!SID || !process.env.TWILIO_AUTH_TOKEN) throw new Error('Missing Twilio credentials');

    // Refuse to re-create a name that already exists — duplicates are exactly what Meta rejects.
    const listRes = await fetch('https://content.twilio.com/v1/Content?PageSize=100', { headers: { Authorization: AUTH } });
    const existing: string[] = ((await listRes.json()) as any).contents?.map((c: any) => c.friendly_name) ?? [];

    for (const t of TEMPLATES) {
        if (existing.includes(t.name)) {
            console.log(`SKIP  ${t.name} — already exists in the account`);
            continue;
        }
        console.log(`\n${t.name}  [${t.category}]  ${t.purpose}`);
        console.log(`      ${t.body}`);
        if (dryRun) { console.log('      (dry run, nothing sent)'); continue; }

        const createRes = await fetch('https://content.twilio.com/v1/Content', {
            method: 'POST',
            headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                friendly_name: t.name,
                language: 'en_GB',
                variables: t.variables,
                types: { 'twilio/text': { body: t.body } },
            }),
        });
        const created: any = await createRes.json();
        if (!createRes.ok) { console.log(`      CREATE FAILED ${createRes.status}: ${JSON.stringify(created).slice(0, 200)}`); continue; }
        console.log(`      created ${created.sid}`);

        const approvalRes = await fetch(`https://content.twilio.com/v1/Content/${created.sid}/ApprovalRequests/whatsapp`, {
            method: 'POST',
            headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: t.name, category: t.category }),
        });
        const approval: any = await approvalRes.json();
        if (!approvalRes.ok) { console.log(`      SUBMIT FAILED ${approvalRes.status}: ${JSON.stringify(approval).slice(0, 200)}`); continue; }
        console.log(`      submitted for review → status ${approval.status ?? approval.whatsapp?.status ?? 'unknown'}`);
    }
    console.log('\nCheck status any time: npx tsx scripts/_wa-templates-status.ts');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
