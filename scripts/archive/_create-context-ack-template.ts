/**
 * Create + submit the context-aware webform ack template (web_enquiry_ack_context).
 *
 * Body quotes the customer's own enquiry back and times the call offer:
 *   {{1}} first name (or 'there')
 *   {{2}} the customer's enquiry, verbatim, word-boundary truncated to ~60 chars
 *   {{3}} 'shortly' | 'in the morning'  (filled by UK hour at send time)
 *
 * One template per purpose: once Meta approves this, it sits ABOVE call_request in
 * FIRST_CONTACT_TEMPLATE_PREFERENCE and takes over webform acks with no deploy
 * (the hourly sync flips its cached status). Until then call_request carries on.
 *
 * Run once:  npx tsx scripts/_create-context-ack-template.ts
 * Idempotent-ish: checks for an existing content item with the same friendly name first.
 */
import 'dotenv/config';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const NAME = 'web_enquiry_ack_context';
const BODY = 'Hi {{1}}, thanks for getting in touch. We got your message: "{{2}}". Is it OK if we give you a quick call {{3}} to run through it? Or just reply here with the details and we will price it up.';

const auth = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

async function main() {
    if (!ACCOUNT_SID || !AUTH_TOKEN) throw new Error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');

    // Already created? (paginate first page is enough at current volume)
    const list = await fetch('https://content.twilio.com/v1/Content?PageSize=100', { headers: { Authorization: auth } });
    const listJson: any = await list.json();
    let existing = (listJson.contents ?? []).find((c: any) => c.friendly_name === NAME);
    if (existing) {
        console.log(`Content item already exists: ${existing.sid}`);
    } else {
        const create = await fetch('https://content.twilio.com/v1/Content', {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                friendly_name: NAME,
                language: 'en',
                variables: { '1': 'there', '2': 'need a new bathroom tap fitted', '3': 'shortly' },
                types: { 'twilio/text': { body: BODY } },
            }),
        });
        existing = await create.json();
        if (!create.ok) throw new Error(`Create failed: ${JSON.stringify(existing)}`);
        console.log(`Created content item: ${existing.sid}`);
    }

    // Submit for WhatsApp approval (UTILITY). 409/duplicate means already submitted — fine.
    const approval = await fetch(`https://content.twilio.com/v1/Content/${existing.sid}/ApprovalRequests/whatsapp`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: NAME, category: 'UTILITY' }),
    });
    const approvalJson: any = await approval.json();
    console.log(`Approval request: HTTP ${approval.status}`, JSON.stringify(approvalJson).slice(0, 400));
    console.log('\nDone. Meta review typically minutes-to-hours; the hourly template sync picks up the status change automatically.');
}

main().catch((e) => { console.error(e); process.exit(1); });
