/**
 * Updates the public WhatsApp Business profile on the Twilio sender.
 *
 * This is what a customer sees when they tap your name in WhatsApp. It is CUSTOMER-FACING and takes
 * effect immediately — there is no Meta review on profile fields, unlike the display name. So it is
 * dry-run by default and requires --apply.
 *
 *   npx tsx scripts/_wa-profile-update.ts            # show the diff, change nothing
 *   npx tsx scripts/_wa-profile-update.ts --apply
 *
 * Copy uses ONLY claims from brand-voice/vocabulary.md's approved list. Do not add numbers,
 * credentials or availability promises that are not on that list.
 */
const SENDER_SID = 'XEb02bdf0a75e8fba70cabc984fdb91115';

// Field limits enforced by WhatsApp.
const LIMITS = { about: 139, description: 512, address: 256, email: 128, website: 256 };

const PROFILE = {
    about: 'Handyman work across Nottingham. Fixed price agreed up front, no call-out fee, 90-day guarantee.',

    description: `Something needs doing and you'd rather it was done properly?

Flat-pack, silicone and reseal, guttering, skirting, architrave, ironmongery, doors and small repairs.

Fixed price agreed up front. No call-out fee. £2M insured, DBS-checked and vetted. Before-and-after photos on completion, tax-ready invoice emailed same day.

Not right? We come back and fix it free within 90 days.

Nottingham — West Bridgford, Beeston, Arnold, Sherwood, Mapperley, Wollaton.

Send a photo of the job and we'll price it up.`,

    // Left deliberately empty: there is no verified street address, and a vague one on a trades
    // profile invites doubt. Blank beats wrong.
    address: '',

    vertical: 'PROF_SERVICES',
    emails: [{ email: 'bookings@handyservices.app', label: 'Email' }],
    websites: [{ website: 'https://www.handyservices.app', label: 'Website' }],
    logo_url: 'https://www.handyservices.app/assets/whatsapp-profile.jpg',
};

async function main() {
    const apply = process.argv.includes('--apply');
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) { console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN'); process.exit(1); }

    const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
    const url = `https://messaging.twilio.com/v2/Channels/Senders/${SENDER_SID}`;

    // --- validate before touching anything ---
    let bad = 0;
    for (const [field, limit] of Object.entries(LIMITS)) {
        const value =
            field === 'email' ? PROFILE.emails[0].email
            : field === 'website' ? PROFILE.websites[0].website
            : (PROFILE as any)[field];
        if (typeof value !== 'string') continue;
        const over = value.length > limit;
        if (over) bad++;
        console.log(`  ${field.padEnd(12)} ${String(value.length).padStart(4)}/${limit}  ${over ? 'OVER LIMIT' : 'ok'}`);
    }
    if (bad) { console.error('\nRefusing to send: field(s) over limit.'); process.exit(1); }

    // Meta FETCHES logo_url from the public site. This app serves a SPA catch-all, so a missing
    // asset returns 200 with text/html rather than 404 — the same trap that silently broke Apple
    // Pay verification (see CLAUDE.md). A 200 is therefore NOT proof the image exists; the
    // content-type is. Without this guard we would happily set an HTML page as the logo.
    if (PROFILE.logo_url) {
        const probe = await fetch(PROFILE.logo_url, { redirect: 'follow' }).catch(() => null);
        const ct = probe?.headers.get('content-type') ?? '';
        const ok = !!probe?.ok && ct.startsWith('image/');
        console.log(`\nlogo_url check: ${PROFILE.logo_url}`);
        console.log(`  -> ${probe?.status ?? 'unreachable'} ${ct || '(no content-type)'}  ${ok ? 'OK' : 'NOT AN IMAGE'}`);
        if (!ok) {
            console.error(
                '\nRefusing to send: logo_url does not serve an image.\n' +
                'The file exists locally but is not deployed yet — commit and deploy\n' +
                'client/public/assets/whatsapp-profile.jpg first, or run with --skip-logo\n' +
                'to publish the text fields now and add the picture after the next deploy.'
            );
            if (!process.argv.includes('--skip-logo')) process.exit(1);
            console.warn('  --skip-logo set: publishing text fields only, leaving logo_url unchanged.');
            delete (PROFILE as any).logo_url;
        }
    }

    // --- show current state so the change is reviewable ---
    const before = await fetch(url, { headers: { Authorization: auth } }).then((r) => r.json());
    console.log('\n=== CURRENT (live) ===');
    console.log(JSON.stringify(before.profile, null, 1));
    console.log('\n=== PROPOSED ===');
    console.log(JSON.stringify({ ...before.profile, ...PROFILE }, null, 1));

    if (!apply) {
        console.log('\nDry run. Nothing changed. Re-run with --apply to publish.');
        process.exit(0);
    }

    // Twilio's Senders v2 update takes the full profile object; merge so unrelated fields survive.
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { ...before.profile, ...PROFILE } }),
    });
    const body = await res.json();

    if (!res.ok) {
        console.error(`\nFAILED (${res.status}):`, JSON.stringify(body, null, 1));
        process.exit(1);
    }
    console.log('\n=== UPDATED ===');
    console.log(JSON.stringify(body.profile, null, 1));
    console.log('\nLive. Check it on a handset — tap the business name in a chat.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
