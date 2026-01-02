import { twilioClient } from "./twilio-client";
import { getTwilioSettings } from "./settings";
import fs from "fs";
import path from "path";

const LOG_FILE = path.join(process.cwd(), "debug_conference.log");

function logToFile(message: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

/**
 * Initiates an outbound call to the agent (forwarding number) 
 * and instructs it to join the specified conference upon answer.
 */
export async function initiateOutboundCall(
    callerCallSid: string,
    forwardNumber: string,
    conferenceName: string,
    host: string,
    protocol: string,
    leadNumber?: string
): Promise<string | undefined> {
    logToFile(`Initiating outbound call to ${forwardNumber} (Conf: ${conferenceName}) via ${host}`);
    try {
        const settings = await getTwilioSettings();
        const callerId = settings.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER;

        if (!callerId) {
            const msg = "[Conference] No Twilio caller ID configured.";
            console.error(msg);
            logToFile(msg);
            return;
        }

        const callbackUrl = `${protocol}://${host}/api/twilio/agent-join?conference=${encodeURIComponent(conferenceName)}${leadNumber ? `&leadNumber=${encodeURIComponent(leadNumber)}` : ''}`;
        const statusCallbackUrl = `${protocol}://${host}/api/twilio/outbound-status?parentCallSid=${callerCallSid}`;

        console.log(`[Conference] Dialing agent ${forwardNumber} for conference ${conferenceName}`);

        const call = await twilioClient.calls.create({
            to: forwardNumber,
            from: callerId, // We must use our Twilio number as caller ID
            url: callbackUrl,
            statusCallback: statusCallbackUrl,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            timeout: settings.maxWaitSeconds || 30,
        });

        logToFile(`Call initiated successfully. SID: ${call.sid} | Callback: ${callbackUrl}`);
        return call.sid;

    } catch (error: any) {
        console.error("[Conference] Failed to initiate outbound call:", error);
        logToFile(`ERROR: ${error.message} - ${JSON.stringify(error)}`);
    }
}
