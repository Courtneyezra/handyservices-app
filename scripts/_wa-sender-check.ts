/**
 * Verifies canonical WhatsApp sender resolution across env-value shapes.
 * Each case re-imports the module with a fresh env so the module-level RAW_SENDER is re-read.
 */
const cases: Array<{ label: string; value: string | undefined; expect: string }> = [
    { label: 'bare E.164 (the correct prod value)', value: '+447449501762', expect: 'whatsapp:+447449501762' },
    { label: 'already prefixed', value: 'whatsapp:+447449501762', expect: 'whatsapp:+447449501762' },
    { label: 'prefixed, mixed case + whitespace', value: '  WhatsApp:+447449501762 ', expect: 'whatsapp:+447449501762' },
    { label: 'unset', value: undefined, expect: 'THROWS' },
    { label: 'missing + (malformed)', value: '447449501762', expect: 'THROWS' },
    { label: 'empty string', value: '', expect: 'THROWS' },
];

async function main() {
    let failures = 0;
    for (const [i, c] of cases.entries()) {
        if (c.value === undefined) delete process.env.TWILIO_WHATSAPP_NUMBER;
        else process.env.TWILIO_WHATSAPP_NUMBER = c.value;

        // Cache-bust so the module re-evaluates against the new env.
        const mod = await import(`../server/whatsapp-sender?case=${i}`);

        let actual: string;
        try {
            actual = mod.getWhatsAppSender();
        } catch {
            actual = 'THROWS';
        }

        const ok = actual === c.expect;
        if (!ok) failures++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}\n      in=${JSON.stringify(c.value)} -> ${actual} (expected ${c.expect})`);
    }
    console.log(failures === 0 ? '\nAll sender cases passed.' : `\n${failures} case(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}
main();
