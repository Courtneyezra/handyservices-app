/**
 * View or change the comms agent's config (appSettings key 'comms_agent').
 *
 *   npx tsx scripts/_comms-agent-config.ts                       # show
 *   npx tsx scripts/_comms-agent-config.ts --enable              # cron sweep ON
 *   npx tsx scripts/_comms-agent-config.ts --disable             # cron sweep OFF
 *   npx tsx scripts/_comms-agent-config.ts --autosend ack_photos,ack_enquiry   # autosend ON for intents
 *   npx tsx scripts/_comms-agent-config.ts --no-autosend         # autosend OFF
 *   npx tsx scripts/_comms-agent-config.ts --sweep-limit 10
 *
 * First-contact auto-acknowledgement (the one sanctioned exception to draft-and-approve — a
 * number we have NEVER messaged gets an instant content-free ack, 24/7):
 *
 *   npx tsx scripts/_comms-agent-config.ts --first-contact-ack       # ON
 *   npx tsx scripts/_comms-agent-config.ts --no-first-contact-ack    # OFF (ships off)
 *   npx tsx scripts/_comms-agent-config.ts --first-contact-channels whatsapp,sms
 *   npx tsx scripts/_comms-agent-config.ts --returning-after-days 60
 *
 * These same first-contact settings now have a UI: /admin/comms → "Auto-reply". Both read and
 * write the one appSettings row, so they cannot disagree. The panel also carries the audit log
 * (first_contact_ack_log), which this script cannot show.
 */
import 'dotenv/config';
import { getCommsAgentConfig, setCommsAgentConfig, DRAFT_INTENTS } from '../server/agents/comms';
import { FIRST_CONTACT_CHANNELS, type FirstContactChannel } from '../server/first-contact-ack';

async function main() {
    const args = process.argv.slice(2);
    let patch: any = null;

    if (args.includes('--enable')) patch = { ...patch, enabled: true };
    if (args.includes('--disable')) patch = { ...patch, enabled: false };
    if (args.includes('--no-autosend')) patch = { ...patch, autosend: { enabled: false } };

    const autosendIdx = args.indexOf('--autosend');
    if (autosendIdx >= 0) {
        const intents = (args[autosendIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
        const invalid = intents.filter((i) => !DRAFT_INTENTS.includes(i as any) || i === 'other');
        if (invalid.length || intents.length === 0) {
            console.error(`Invalid intents: ${invalid.join(', ') || '(none given)'}. Whitelistable: ${DRAFT_INTENTS.filter((i) => i !== 'other').join(', ')}`);
            process.exit(1);
        }
        patch = { ...patch, autosend: { enabled: true, intents } };
    }

    if (args.includes('--first-contact-ack')) patch = { ...patch, firstContactAutoAck: { ...patch?.firstContactAutoAck, enabled: true } };
    if (args.includes('--no-first-contact-ack')) patch = { ...patch, firstContactAutoAck: { ...patch?.firstContactAutoAck, enabled: false } };

    const channelsIdx = args.indexOf('--first-contact-channels');
    if (channelsIdx >= 0) {
        const channels = (args[channelsIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
        const invalid = channels.filter((c) => !FIRST_CONTACT_CHANNELS.includes(c as FirstContactChannel));
        if (invalid.length || channels.length === 0) {
            console.error(`Invalid channels: ${invalid.join(', ') || '(none given)'}. Allowed: ${FIRST_CONTACT_CHANNELS.join(', ')}`);
            process.exit(1);
        }
        patch = { ...patch, firstContactAutoAck: { ...patch?.firstContactAutoAck, channels: channels as FirstContactChannel[] } };
    }

    const returningIdx = args.indexOf('--returning-after-days');
    if (returningIdx >= 0) {
        const n = Number(args[returningIdx + 1]);
        if (!Number.isInteger(n) || n < 1 || n > 3650) {
            console.error('returning-after-days must be a whole number of days between 1 and 3650');
            process.exit(1);
        }
        patch = { ...patch, firstContactAutoAck: { ...patch?.firstContactAutoAck, returningAfterDays: n } };
    }

    const limitIdx = args.indexOf('--sweep-limit');
    if (limitIdx >= 0) {
        const n = Number(args[limitIdx + 1]);
        if (!Number.isInteger(n) || n < 1 || n > 50) { console.error('sweep-limit must be 1-50'); process.exit(1); }
        patch = { ...patch, sweepLimit: n };
    }

    const config = patch ? await setCommsAgentConfig(patch) : await getCommsAgentConfig();
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
