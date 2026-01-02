// Direct Eleven Labs Test - bypasses all VA logic
app.all('/api/twilio/test-eleven-labs', async (req, res) => {
    console.log(`[TEST-EL] Direct Eleven Labs test starting...`);

    try {
        const settings = await getTwilioSettings();
        const leadNumber = req.query.leadNumber || '+447963111491';

        console.log(`[TEST-EL] Agent ID: ${settings.elevenLabsAgentId}`);
        console.log(`[TEST-EL] Has API Key: ${!!settings.elevenLabsApiKey}`);

        // Get signed URL
        const signedUrlResponse = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${settings.elevenLabsAgentId}`, {
            method: 'GET',
            headers: {
                'xi-api-key': settings.elevenLabsApiKey,
            }
        });

        if (!signedUrlResponse.ok) {
            const errorText = await signedUrlResponse.text();
            console.error(`[TEST-EL] ❌ Signed URL failed: ${signedUrlResponse.status}`, errorText);
            return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Eleven Labs API error</Say><Hangup/></Response>');
        }

        const { signed_url } = await signedUrlResponse.json();
        const url = new URL(signed_url);
        const token = url.searchParams.get('token');

        console.log(`[TEST-EL] ✅ Token obtained successfully`);

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Connecting you to Eleven Labs agent</Say>
    <Connect>
        <Stream url="wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${settings.elevenLabsAgentId}&amp;token=${token}" />
    </Connect>
    <Pause length="600"/>
</Response>`;

        console.log(`[TEST-EL] ✅ Returning TwiML`);
        return res.type('text/xml').send(twiml);

    } catch (error) {
        console.error('[TEST-EL] ❌ Error:', error);
        return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Test failed</Say><Hangup/></Response>');
    }
});
