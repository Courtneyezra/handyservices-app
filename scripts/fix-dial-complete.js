#!/usr/bin/env node

// Quick script to fix the dial-complete handler
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server/index.ts');
let content = fs.readFileSync(serverPath, 'utf8');

// Replace the activeRedirects check with DialCallDuration check
const oldCode = `    // Check if this call was marked as VA-missed by outbound-status handler
    // (activeRedirects set is set when VA doesn't answer)
    const vaMissedCall = activeRedirects.has(CallSid);
    console.log(\`[Dial-Complete] VA Missed: \${vaMissedCall}, redirecting: \${vaMissedCall}\`);
    
    // If VA didn't miss the call (they actually answered and talked), just end
    if (!vaMissedCall) {
        console.log(\`[Dial-Complete] VA answered, ending normally\`);
        return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }`;

const newCode = `    // Use DialCallDuration to check if VA actually answered
    // If duration < 3 seconds, VA didn't really answer - just conference setup
    const dialDuration = parseInt(DialCallDuration) || 0;
    const vaActuallyAnswered = dialDuration >= 3;
    
    console.log(\`[Dial-Complete] Duration: \${dialDuration}s, VA answered: \${vaActuallyAnswered}\`);
    
    // If VA actually answered and had a conversation, just end
    if (vaActuallyAnswered) {
        console.log(\`[Dial-Complete] VA had real conversation (\${dialDuration}s), ending\`);
        return res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }`;

content = content.replace(oldCode, newCode);
fs.writeFileSync(serverPath, content, 'utf8');
console.log('Fixed dial-complete handler to use DialCallDuration');
