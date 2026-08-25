/**
 * Proves the comms system will actually USE a coexistence sender, without needing Meta onboarding.
 *
 * The Meta-side onboarding needs an authenticated browser and the physical handset. Everything
 * AFTER that is ours, and this verifies it: temporarily writes a stub coexistence sender, checks
 * that the senders endpoint exposes it and that sends route to the Meta transport rather than
 * silently falling back to Twilio, then removes the stub.
 *
 * Nothing is sent — the stub token is invalid, so a Meta send fails at the API with an auth error,
 * which is itself the proof that routing reached Meta and not Twilio.
 *
 *   npx tsx scripts/_wa-coexistence-dryrun.ts <port>
 */
import { db } from '../server/db';
import { appSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { sendWhatsAppMessage } from '../server/meta-whatsapp';

const PORT = process.argv[2] || '62654';
const KEY = 'whatsapp_coexistence_sender';
const STUB = {
    phoneNumberId: '000000000000000',
    wabaId: '1538004761222206',
    displayPhoneNumber: '+44 7508 744402',
    accessToken: 'stub-token-not-valid',
    onboardedAt: new Date().toISOString(),
};

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`);
};

async function removeStub() {
    await db.delete(appSettings).where(eq(appSettings.key, KEY));
}

async function main() {
    const existing = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
    if (existing.length) {
        console.log('A real coexistence sender is already stored — refusing to overwrite it.');
        console.log(JSON.stringify(existing[0].value));
        process.exit(0);
    }

    console.log('Installing stub coexistence sender…\n');
    await db.insert(appSettings).values({
        id: KEY, key: KEY, value: STUB,
        description: 'TEMPORARY stub written by _wa-coexistence-dryrun.ts — should be removed automatically',
        updatedAt: new Date(),
    });

    try {
        const token = process.env.DRYRUN_ADMIN_TOKEN;
        if (token) {
            const r = await fetch(`http://localhost:${PORT}/api/inbox/senders`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const body: any = await r.json();
            const meta = body.senders?.find((s: any) => s.id === 'meta');
            check('senders endpoint exposes the coexistence sender', !!meta,
                meta ? `${meta.displayPhone} — ${meta.label}` : JSON.stringify(body));
            check('it is flagged as onboarded', body.coexistenceOnboarded === true,
                `coexistenceOnboarded=${body.coexistenceOnboarded}`);
        } else {
            console.log('(no DRYRUN_ADMIN_TOKEN — skipping the HTTP checks)');
        }

        // Routing: via:'meta' must reach the Meta API. An auth failure from Meta proves it routed
        // there; a Twilio error or a success would mean it went to the wrong transport.
        let err = '';
        try {
            await sendWhatsAppMessage('447508744402@c.us', 'routing probe', { via: 'meta' });
        } catch (e: any) { err = e.message; }

        check(
            "via:'meta' routes to Meta Cloud API, not Twilio",
            /OAuth|access token|Meta send failed/i.test(err),
            err || '(no error — it may have gone to Twilio!)'
        );
        check(
            'it did NOT fall back to the Twilio sender',
            !/twilio/i.test(err) && !/whatsapp:\+447449501762/.test(err),
            err
        );
    } finally {
        await removeStub();
        const after = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
        console.log(`\nStub removed: ${after.length === 0 ? 'yes' : 'NO — clean up manually!'}`);
    }

    console.log(failures === 0
        ? '\nDownstream verified: once the number is onboarded, the comms system will use it.'
        : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await removeStub().catch(() => {}); process.exit(1); });
