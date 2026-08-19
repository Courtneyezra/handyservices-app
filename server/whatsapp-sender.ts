/**
 * Canonical WhatsApp sender resolution.
 *
 * Every outbound WhatsApp message must resolve its `From` through here.
 *
 * History: two send paths each had their own `process.env.TWILIO_WHATSAPP_NUMBER || '<hardcoded>'`
 * fallback pointing at +15558874602, a number that is not a WhatsApp sender on this account. When
 * the env var was unset in production, sends silently went out from the dead number and failed with
 * Twilio error 63007 — or from the sandbox +14155238886 with 63015 — for months without anyone
 * noticing, because the failure looked like a delivery problem rather than a config problem.
 *
 * The two paths also disagreed about the `whatsapp:` prefix: meta-whatsapp.ts prepended it, while
 * twilio-client.ts baked it into the fallback string but not the env value, so conversation-engine.ts
 * sent a bare `+44...` as `From` against a `whatsapp:` `To` and got error 21910 (channel mismatch).
 *
 * So: no fallback, and the prefix is normalized in exactly one place.
 */

const RAW_SENDER = process.env.TWILIO_WHATSAPP_NUMBER;

/** Strips any `whatsapp:` prefix and surrounding whitespace, returning a bare E.164 candidate. */
function stripChannelPrefix(value: string): string {
    return value.trim().replace(/^whatsapp:/i, '').trim();
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * The configured sender in bare E.164 form (`+447449501762`), or null when unset/malformed.
 * Prefer `getWhatsAppSender()` at send time so misconfiguration surfaces as a clear error.
 */
export function getWhatsAppSenderE164(): string | null {
    if (!RAW_SENDER) return null;
    const bare = stripChannelPrefix(RAW_SENDER);
    return E164.test(bare) ? bare : null;
}

/**
 * The sender formatted for Twilio's WhatsApp channel (`whatsapp:+447449501762`).
 * Throws when unset or malformed — a loud failure at send time beats a silent one at Meta.
 */
export function getWhatsAppSender(): string {
    const bare = getWhatsAppSenderE164();
    if (!bare) {
        throw new Error(
            RAW_SENDER
                ? `TWILIO_WHATSAPP_NUMBER is set to "${RAW_SENDER}" which is not valid E.164. ` +
                  `Expected something like "+447449501762" (a leading "whatsapp:" prefix is allowed and stripped).`
                : `TWILIO_WHATSAPP_NUMBER is not set. Outbound WhatsApp is disabled until it is configured ` +
                  `to the account's registered WhatsApp sender (e.g. "+447449501762").`
        );
    }
    return `whatsapp:${bare}`;
}

/** True when outbound WhatsApp is configured. Use to gate features rather than letting sends throw. */
export function isWhatsAppSenderConfigured(): boolean {
    return getWhatsAppSenderE164() !== null;
}

/** Formats an arbitrary E.164 recipient for the Twilio WhatsApp channel. */
export function toWhatsAppChannel(e164: string): string {
    return `whatsapp:${stripChannelPrefix(e164)}`;
}

// ---------------------------------------------------------------- SMS
//
// SMS resolution lives here rather than in its own module on purpose: on this account the SMS
// sender and the WhatsApp sender are THE SAME PHYSICAL NUMBER (+447449501762 is sms=true,
// voice=true, and is the registered WhatsApp sender), and the failure this file exists to prevent
// — two modules each inventing their own fallback number — is exactly what a second sender module
// would reintroduce. One file, one resolution order, one place to look when a send comes from the
// wrong number.
//
// Resolution order, most specific first:
//   1. TWILIO_SMS_NUMBER   — set this the day SMS moves to a different number
//   2. TWILIO_PHONE_NUMBER — the account's voice/SMS number (what is set today)
//   3. the WhatsApp sender — same number here, and provably a real number on the account
//
// Read lazily rather than captured at import, so a process that loads dotenv after this module
// (scripts do) still resolves correctly.

/**
 * The SMS sender in bare E.164 form, or null when nothing usable is configured.
 *
 * Note there is no `sms:` channel prefix in Twilio's API — an SMS send is just a bare E.164 `From`,
 * which is why this returns the same shape as `getWhatsAppSenderE164()` and there is no
 * `getSmsChannel()` counterpart.
 */
export function getSmsSenderE164(): string | null {
    for (const raw of [process.env.TWILIO_SMS_NUMBER, process.env.TWILIO_PHONE_NUMBER]) {
        if (!raw) continue;
        const bare = stripChannelPrefix(raw);
        if (E164.test(bare)) return bare;
    }
    return getWhatsAppSenderE164();
}

/**
 * The SMS sender, or a loud throw. Same reasoning as `getWhatsAppSender()`: a clear error at send
 * time beats a message that leaves from a number the account does not own and dies at the carrier.
 */
export function getSmsSender(): string {
    const bare = getSmsSenderE164();
    if (!bare) {
        throw new Error(
            'No SMS sender is configured. Set TWILIO_SMS_NUMBER (or TWILIO_PHONE_NUMBER) to a ' +
            'sms-capable number on the Twilio account, e.g. "+447449501762".'
        );
    }
    return bare;
}

/** True when outbound SMS is configured. Use to gate features rather than letting sends throw. */
export function isSmsSenderConfigured(): boolean {
    return getSmsSenderE164() !== null;
}

// Surface misconfiguration at boot rather than on the first customer message.
if (!isWhatsAppSenderConfigured()) {
    console.warn(
        '[WhatsApp] TWILIO_WHATSAPP_NUMBER is missing or invalid — outbound WhatsApp will fail. ' +
        `Raw value: ${RAW_SENDER === undefined ? '(unset)' : JSON.stringify(RAW_SENDER)}`
    );
} else {
    console.log(`[WhatsApp] Outbound sender: ${getWhatsAppSender()}`);
}
