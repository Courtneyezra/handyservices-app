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

// Surface misconfiguration at boot rather than on the first customer message.
if (!isWhatsAppSenderConfigured()) {
    console.warn(
        '[WhatsApp] TWILIO_WHATSAPP_NUMBER is missing or invalid — outbound WhatsApp will fail. ' +
        `Raw value: ${RAW_SENDER === undefined ? '(unset)' : JSON.stringify(RAW_SENDER)}`
    );
} else {
    console.log(`[WhatsApp] Outbound sender: ${getWhatsAppSender()}`);
}
