/**
 * Submit the `missed_call_ack` WhatsApp template to Meta via Twilio's Content API.
 *
 * Why: a phone call does not open the WhatsApp 24h window, so the missed-call text-back
 * (Switchboard Atlas step 2, 24 Aug 2026) is a template send nearly every time. Until this
 * template is approved the ladder falls through to SMS; once approved,
 * MISSED_CALL_TEMPLATE_PREFERENCE in server/first-contact-ack.ts picks it up automatically —
 * no code change needed.
 *
 * Idempotent: skips creation if a content item named `missed_call_ack` already exists.
 * Approval status is polled by the hourly template sync (server/whatsapp-template-sync.ts),
 * which Pushovers on approved/rejected.
 *
 * Run: npx tsx scripts/_submit-missed-call-ack-template.ts
 */
import 'dotenv/config';

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
if (!SID || !TOKEN) { console.error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set'); process.exit(1); }

const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');
const NAME = 'missed_call_ack';

// {{1}} = first name (or "there") — the only variable, so the ack lane's empty enquiry
// snippet on a call can never leave a hole in the render. Brand voice: no em dashes.
const BODY = "Hi {{1}}, sorry we missed your call. We're on another job right now. We'll ring you back shortly, or reply here if a message is easier.";

async function main() {
    // 1. Already exists? Don't create a duplicate (Meta rejects near-duplicates anyway).
    const listRes = await fetch('https://content.twilio.com/v1/Content?PageSize=200', { headers: { Authorization: auth } });
    if (!listRes.ok) { console.error('List failed:', listRes.status, await listRes.text()); process.exit(1); }
    const list = await listRes.json();
    let content = (list.contents ?? []).find((c: any) => c.friendly_name === NAME);

    if (content) {
        console.log(`Content '${NAME}' already exists: ${content.sid}`);
    } else {
        const createRes = await fetch('https://content.twilio.com/v1/Content', {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                friendly_name: NAME,
                language: 'en',
                variables: { '1': 'there' },
                types: { 'twilio/text': { body: BODY } },
            }),
        });
        content = await createRes.json();
        if (!createRes.ok) { console.error('Create failed:', createRes.status, JSON.stringify(content)); process.exit(1); }
        console.log(`Created content '${NAME}': ${content.sid}`);
    }

    // 2. Submit for WhatsApp approval as UTILITY (skip if a request is already in flight/decided).
    const apprGet = await fetch(`https://content.twilio.com/v1/Content/${content.sid}/ApprovalRequests`, { headers: { Authorization: auth } });
    const appr = apprGet.ok ? await apprGet.json() : null;
    const status = appr?.whatsapp?.status;
    if (status && status !== 'unsubmitted') {
        console.log(`Approval already ${status} — nothing to submit.`);
        return;
    }

    const submitRes = await fetch(`https://content.twilio.com/v1/Content/${content.sid}/ApprovalRequests/whatsapp`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: NAME, category: 'UTILITY' }),
    });
    const submitted = await submitRes.json();
    if (!submitRes.ok) { console.error('Submit failed:', submitRes.status, JSON.stringify(submitted)); process.exit(1); }
    console.log(`Submitted for WhatsApp approval:`, JSON.stringify(submitted, null, 2));
    console.log('The hourly template sync will Pushover when Meta approves/rejects.');
}

main().catch((e) => { console.error(e); process.exit(1); });
