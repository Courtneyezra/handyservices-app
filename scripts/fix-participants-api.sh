#!/bin/bash

# Backup
cp server/index.ts server/index.ts.backup2

# Create the replacement text
cat > /tmp/replacement.txt << 'EOF'
            const routing = determineCallRouting(routingSettings, true); // isVAMissedCall = true
            console.log(`[Twilio-Bridge] ⚡ Routing decision: ${routing.reason}`);

            // Determine redirect URL
            let redirectUrl = `${httpProtocol}://${host}/api/twilio/voicemail`;
            
            if (routing.destination === 'eleven-labs' && routing.elevenLabsContext) {
                redirectUrl = `${httpProtocol}://${host}/api/twilio/eleven-labs-personal?agentId=${settings.elevenLabsAgentId}&leadPhoneNumber=${encodeURIComponent(actualLeadNumber)}&context=${routing.elevenLabsContext}`;
                console.log(`[Twilio-Bridge] ⚡ Will redirect to Eleven Labs: ${routing.elevenLabsContext}`);
            }
            
            // CRITICAL: Use Conference Participants API (not Calls API)
            const conferenceSid = activeConferences.get(ParentCallSid);
            
            if (!conferenceSid) {
                console.error(`[Twilio-Bridge] ❌ No ConferenceSid for ${ParentCallSid}`);
                return;
            }
            
            console.log(`[Twilio-Bridge] ⚡ ConferenceSid: ${conferenceSid}`);
            console.log(`[Twilio-Bridge] ⚡ Redirecting to: ${redirectUrl}`);
            
            try {
                await twilioClient.conferences(conferenceSid)
                    .participants(ParentCallSid)
                    .update({ url: redirectUrl });
                
                console.log(`[Twilio-Bridge] ✅ Participant redirected successfully`);
                activeRedirects.add(ParentCallSid);
                setTimeout(() => {
                    activeRedirects.delete(ParentCallSid);
                    activeConferences.delete(ParentCallSid);
                }, 30000);
            } catch (error) {
                console.error(`[Twilio-Bridge] ❌ Redirect failed:`, error);
            }
EOF

# Use awk to replace lines 658-668
awk -v start=658 -v end=668 '
NR < start || NR > end { print; next }
NR == start {
    while ((getline line < "/tmp/replacement.txt") > 0) {
        print line
    }
    close("/tmp/replacement.txt")
    # Skip to line end+1
    while (NR < end) { NR++; getline }
}
' server/index.ts > server/index.ts.new

mv server/index.ts.new server/index.ts
echo "✅ Updated server/index.ts with Participants API"
