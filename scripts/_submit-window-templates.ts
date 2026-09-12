/**
 * Submit build plan v2 item 4.1's window-shut Meta templates, as code.
 *
 *   npx tsx scripts/_submit-window-templates.ts             # prints exactly what would be submitted, exits
 *   npx tsx scripts/_submit-window-templates.ts --submit    # creates the Content resources and requests approval
 *   npx tsx scripts/_submit-window-templates.ts --submit --only answer_ready_reopen_v1   # one of them
 *
 * THIS SCRIPT HAS NEVER BEEN RUN. It was written without credentials and without a database, and
 * the dry run is the only path anyone has exercised. Read what the dry run prints before adding
 * --submit; a submission is an external, owner-only act and it cannot be taken back (a Content
 * resource with the wrong name has to be deleted in the Twilio console).
 *
 * Definitions come from server/window-templates.ts — the name, Meta's category, the body and the
 * sample values, all in one place, so this script chooses nothing. The two calls per template are
 * the same pair scripts/_submit-holding-template.ts makes: create the Content resource, then ask
 * for WhatsApp approval with the category. Everything after that is Meta's, and the hourly poll
 * (server/whatsapp-template-sync.ts) is what reports the verdict.
 *
 * Three refusals, all before anything leaves the machine:
 *   · a name already on the account is SKIPPED (Meta rejects a repeat, and two of the five are
 *     names the account already has);
 *   · a body that breaks the house voice rules stops the run (shared/chat-voice.ts);
 *   · a body that trips the draft guards with its own sample values stops the run, because the
 *     post-call template sends unattended and a guard hit on it would only be found in a customer's
 *     chat (server/agents/draft-guards.ts).
 *
 * Status afterwards: docs/META-TEMPLATE-RUNBOOK.md, or /admin/staff → Templates.
 */
import 'dotenv/config';
import { WINDOW_TEMPLATES, renderSample, type WindowTemplate } from '../server/window-templates';
import { chatVoiceViolations } from '@shared/chat-voice';
import { checkDraft } from '../server/agents/draft-guards';

const CONTENT_API = 'https://content.twilio.com/v1';

function auth(): string {
    const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing');
    return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

/** The Content resource body, exactly as the Content API wants it. Only the first rung is ever submitted: a fallback rung is a name the account already has. */
function contentPayload(t: WindowTemplate) {
    return {
        friendly_name: t.rungs[0].name,
        language: t.language,
        variables: t.rungs[0].variables,
        types: { 'twilio/text': { body: t.rungs[0].body } },
    };
}

/** The approval request. The category is the whole point of it. */
function approvalPayload(t: WindowTemplate) {
    return { name: t.rungs[0].name, category: t.category };
}

/** Every reason not to submit this one, in the order a person would want to hear them. */
function refusals(t: WindowTemplate): string[] {
    const out: string[] = [];
    const voice = chatVoiceViolations(t.rungs[0].body);
    if (voice.length) out.push(`chat voice: ${voice.join(', ')}`);
    const guard = checkDraft({ body: renderSample(t.rungs[0]), intent: 'ack_enquiry', quoteSeen: false, customerText: null });
    if (guard) out.push(`draft guard: ${guard.code}`);
    return out;
}

async function main() {
    const submit = process.argv.includes('--submit');
    const onlyIdx = process.argv.indexOf('--only');
    const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

    const chosen = WINDOW_TEMPLATES.filter((t) => !only || t.rungs[0].name === only || t.trigger.id === only);
    if (!chosen.length) {
        console.error(`No template matches --only ${only}. Names: ${WINDOW_TEMPLATES.map((t) => t.rungs[0].name).join(', ')}`);
        process.exit(2);
    }

    console.log('Window-shut template submission (build plan 4.1)\n');
    let blocked = 0;
    for (const t of chosen) {
        const bad = refusals(t);
        console.log(`${t.rungs[0].name}  [${t.category}]  trigger: ${t.trigger.id}  (${t.submission})`);
        console.log(`   ${t.rungs[0].body}`);
        console.log(`   sample: ${renderSample(t.rungs[0])}`);
        console.log(`   POST ${CONTENT_API}/Content  ${JSON.stringify(contentPayload(t))}`);
        console.log(`   POST ${CONTENT_API}/Content/<sid>/ApprovalRequests/whatsapp  ${JSON.stringify(approvalPayload(t))}`);
        console.log(`   checks: ${bad.length ? 'BLOCKED — ' + bad.join('; ') : 'clean'}\n`);
        if (bad.length) blocked++;
    }
    if (blocked) { console.error(`Refusing: ${blocked} template(s) failed a pre-send check. Fix the body in server/window-templates.ts.`); process.exit(2); }
    if (!submit) { console.log('Dry run. Nothing was sent. Re-run with --submit when the owner decides to submit (owner-only).'); process.exit(0); }

    const Authorization = auth();
    // The live list is the duplicate check: Meta rejects a repeated name, and reading it costs one
    // call. Uses the sync module's own fetcher so "what exists" means the same thing here and on
    // /admin/staff. This is a READ; the writes are below.
    const { fetchTwilioTemplates } = await import('../server/whatsapp-template-sync');
    const existing = await fetchTwilioTemplates();

    for (const t of chosen) {
        const name = t.rungs[0].name;
        const dup = existing.find((e) => e.name === name);
        if (dup) { console.log(`SKIP  ${name} — already on the account (${dup.contentSid}, ${dup.status}). Nothing submitted.`); continue; }

        const createRes = await fetch(`${CONTENT_API}/Content`, {
            method: 'POST', headers: { Authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify(contentPayload(t)),
        });
        const created: any = await createRes.json();
        if (!createRes.ok) { console.error(`FAIL  ${name} create ${createRes.status}: ${JSON.stringify(created).slice(0, 300)}`); continue; }
        console.log(`ok    ${name} created ${created.sid}`);

        const approvalRes = await fetch(`${CONTENT_API}/Content/${created.sid}/ApprovalRequests/whatsapp`, {
            method: 'POST', headers: { Authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify(approvalPayload(t)),
        });
        const approval: any = await approvalRes.json();
        if (!approvalRes.ok) { console.error(`FAIL  ${name} submit ${approvalRes.status}: ${JSON.stringify(approval).slice(0, 300)}`); continue; }
        console.log(`ok    ${name} submitted as ${t.category} → status ${approval.status ?? approval.whatsapp?.status ?? 'unknown'}`);
    }
    console.log('\nMeta reviews next. Check with: npx tsx scripts/archive/_wa-templates-status.ts, or /admin/staff → Templates → Sync now.');
    console.log('Nothing to deploy on approval: the hourly sync flips the cached status and the name lookups start finding it.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
