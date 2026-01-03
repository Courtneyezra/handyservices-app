/**
 * Eleven Labs Register Call API
 * Using direct HTTP API calls (SDK doesn't support registerCall yet)
 */

export interface RegisterCallParams {
    agentId: string;
    apiKey: string;
    fromNumber: string;
    toNumber: string;
    context: string;
    contextMessage: string;
}

/**
 * Register a Twilio call with Eleven Labs and get TwiML response
 */
export async function registerElevenLabsCall(params: RegisterCallParams): Promise<string> {
    console.log(`[ElevenLabs-RegisterCall] Registering call with context: ${params.context}`);

    const requestBody = {
        agent_id: params.agentId,
        from_number: params.fromNumber,
        to_number: params.toNumber,
        direction: 'inbound',
        // TEMPORARILY DISABLED - testing if dynamic variables cause connection drop
        // conversation_initiation_client_data: {
        //     dynamic_variables: {
        //         context_message: params.contextMessage,
        //         context_type: params.context,
        //     },
        // },
    };

    const response = await fetch(
        'https://api.elevenlabs.io/v1/convai/twilio/register-call',
        {
            method: 'POST',
            headers: {
                'xi-api-key': params.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ElevenLabs-RegisterCall] API error: ${response.status}`, errorText);
        throw new Error(`Eleven Labs API error: ${response.status} - ${errorText}`);
    }

    const twiml = await response.text();
    console.log(`[ElevenLabs-RegisterCall] Successfully registered, TwiML preview:`, twiml.substring(0, 200));

    return twiml;
}
