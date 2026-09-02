/**
 * Submit the holding-line Meta template as CODE (Phase 3 / C, design §4 "template holding line").
 *
 *   npx tsx scripts/_submit-holding-template.ts            # prints exactly what would be submitted, exits
 *   npx tsx scripts/_submit-holding-template.ts --submit   # creates the Content resource and requests WhatsApp approval
 *
 * Name `holding_line_v1`, UTILITY, en_GB, one variable (first name; 'there' when unknown, see
 * rules-layer templateNameSlot). The body is HOLDING_TEMPLATE_BODY from server/rules-layer.ts,
 * where HOLDING_TEMPLATE_PREFERENCE already prefers this name, so approval is the only step left.
 * Same Twilio Content API calls as scripts/archive/_wa-templates-submit.ts; the duplicate check
 * uses the live template list (fetchTwilioTemplates) because Meta rejects a repeated name.
 * External submission is the owner's call: nothing leaves this machine without --submit.
 */
import 'dotenv/config';
import { HOLDING_TEMPLATE_NAME, HOLDING_TEMPLATE_BODY } from '../server/rules-layer';
import { chatVoiceViolations } from '@shared/chat-voice';

const CONTENT_API = 'https://content.twilio.com/v1';
const SUBMISSION = {
    friendly_name: HOLDING_TEMPLATE_NAME,
    language: 'en_GB',
    variables: { '1': 'Sam' },
    types: { 'twilio/text': { body: HOLDING_TEMPLATE_BODY } },
};
const APPROVAL = { name: HOLDING_TEMPLATE_NAME, category: 'UTILITY' as const };

function auth(): string {
    const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing');
    return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

async function main() {
    const submit = process.argv.includes('--submit');
    const violations = chatVoiceViolations(HOLDING_TEMPLATE_BODY);
    console.log('Holding-line template submission\n');
    console.log(`POST ${CONTENT_API}/Content`);
    console.log(JSON.stringify(SUBMISSION, null, 2));
    console.log(`\nPOST ${CONTENT_API}/Content/<sid>/ApprovalRequests/whatsapp`);
    console.log(JSON.stringify(APPROVAL, null, 2));
    console.log(`\nchat-voice check: ${violations.length ? 'VIOLATIONS ' + violations.join(', ') : 'clean'}`);
    if (violations.length) { console.error('Refusing: the body breaks the house voice rules.'); process.exit(2); }
    if (!submit) { console.log('\nDry run. Re-run with --submit to send this to Twilio/Meta (owner decision).'); process.exit(0); }

    const Authorization = auth();
    const { fetchTwilioTemplates } = await import('../server/whatsapp-template-sync');
    const existing = await fetchTwilioTemplates();
    const dup = existing.find((t) => t.name === HOLDING_TEMPLATE_NAME);
    if (dup) { console.log(`\nAlready exists: ${dup.name} (${dup.contentSid}) status ${dup.status}. Nothing submitted.`); process.exit(0); }

    const createRes = await fetch(`${CONTENT_API}/Content`, { method: 'POST', headers: { Authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(SUBMISSION) });
    const created: any = await createRes.json();
    if (!createRes.ok) { console.error(`CREATE FAILED ${createRes.status}: ${JSON.stringify(created).slice(0, 300)}`); process.exit(1); }
    console.log(`\ncreated ${created.sid}`);
    const approvalRes = await fetch(`${CONTENT_API}/Content/${created.sid}/ApprovalRequests/whatsapp`, { method: 'POST', headers: { Authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(APPROVAL) });
    const approval: any = await approvalRes.json();
    if (!approvalRes.ok) { console.error(`SUBMIT FAILED ${approvalRes.status}: ${JSON.stringify(approval).slice(0, 300)}`); process.exit(1); }
    console.log(`submitted for review → status ${approval.status ?? approval.whatsapp?.status ?? 'unknown'}`);
    console.log('The hourly template sync (server/whatsapp-template-sync.ts) picks up approval; the rules layer starts using it automatically.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
