/**
 * Verifies the Meta Cloud API transport WITHOUT sending anything.
 *
 * Checks the two things most likely to be wrong when the coexistence number goes live:
 *   1. number resolution — a `...@c.us` key must not be run through UK normalization
 *      (that bug turned +84357691573 into +4484357691573 on the Twilio path)
 *   2. transport routing — via:'meta' must fail clearly when no sender is onboarded, rather than
 *      silently falling through to Twilio and sending from the wrong number
 *
 *   npx tsx scripts/_wa-transport-verify.ts
 */
import { sendWhatsAppMessage, sendViaMetaCloudApi } from '../server/meta-whatsapp';
import { getCoexistenceSender } from '../server/whatsapp-onboarding';

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`);
};

async function main() {
    const sender = await getCoexistenceSender();
    console.log('coexistence sender:', sender ? `${sender.displayPhoneNumber} (${sender.phoneNumberId})` : 'NOT ONBOARDED');
    console.log();

    // --- 1. Number resolution. Uses a bogus phoneNumberId/token so it can never reach Meta;
    //        we only care that the wrong-number error is thrown BEFORE any network call.
    console.log('=== recipient resolution (no network) ===');
    const cases: Array<[string, string | 'THROWS']> = [
        ['84357691573@c.us', '+84357691573'],   // non-UK via conversation key — the regression case
        ['447552217846@c.us', '+447552217846'], // UK via conversation key
        ['+84357691573', '+84357691573'],       // already E.164
        ['nonsense', 'THROWS'],
    ];

    for (const [input, expected] of cases) {
        let resolved = 'THROWS';
        try {
            await sendViaMetaCloudApi('000000000000000', 'invalid-token', input, 'x');
        } catch (e: any) {
            // Order matters: our own validation error means the number was REJECTED. Only an
            // auth/network error means resolution succeeded and it actually attempted a send.
            if (/Invalid phone number for Meta send/.test(e.message)) {
                resolved = 'THROWS';
            } else if (/Meta send failed|fetch failed|Invalid OAuth|access token/i.test(e.message)) {
                resolved = 'REACHED_SEND';
            }
        }
        const ok = expected === 'THROWS' ? resolved === 'THROWS' : resolved === 'REACHED_SEND';
        check(
            `${input} -> ${expected === 'THROWS' ? 'rejected' : expected}`,
            ok,
            expected === 'THROWS'
                ? `rejected as expected (${resolved})`
                : `resolution passed, proceeded to send (${resolved})`
        );
    }

    // --- 2. Routing guard: via:'meta' with nothing onboarded must fail loudly.
    console.log('\n=== transport routing ===');
    if (!sender) {
        let msg = '';
        try {
            await sendWhatsAppMessage('447552217846@c.us', 'should not send', { via: 'meta' });
        } catch (e: any) { msg = e.message; }
        check(
            "via:'meta' refuses when no coexistence sender exists",
            /No coexistence sender onboarded/.test(msg),
            msg || '(no error thrown — it may have fallen through to Twilio!)'
        );
    } else {
        console.log('  sender onboarded — skipping the not-onboarded guard');
    }

    console.log(failures === 0 ? '\nAll transport checks passed. Nothing was sent.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
