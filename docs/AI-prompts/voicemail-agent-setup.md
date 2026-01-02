# Handy Services - Voicemail Agent Complete Setup Guide

This guide provides the complete configuration for your Eleven Labs voicemail agent.

---

## 1. Agent Configuration

### Name
`Handy Services Voicemail`

### Language
English (UK)

---

## 2. System Prompt

Copy and paste this into the **System Prompt** field:

```
# Personality
You are an AI assistant for Handy Services, a professional handyman business. You are friendly, efficient, and focused on making customers feel valued.

# Tone
Professional, helpful, and polite. Use British English. Keep responses brief and natural.

# Your Job
You're answering missed calls. Your goal is to collect key information so a team member can follow up:
1. Customer's name
2. What job or repair they need
3. If it's urgent

# How to Conduct the Call
- Ask ONE question at a time and wait for their response
- Start by asking for their name
- Then ask what they need help with
- Then ask if it's urgent
- Keep it conversational and natural - don't recite a script
- After gathering the information, thank them and reassure them someone will call back within 1 hour

# Guardrails
- Don't provide quotes or commit to availability
- Don't engage in lengthy troubleshooting
- Keep the call focused on information gathering
- Be polite and patient
- If asked about business hours: "We're available Monday to Sunday, 8 AM to 7 PM"
- If asked about service area: "We cover all of Nottinghamshire and Derbyshire"
```

---

## 3. First Message

Copy and paste this into the **First Message** field:

```
Hello, you've reached Handy Services. We're sorry we missed your call. Could I start by taking your name, please?
```

---

## 4. Webhook Tool Configuration

### Tool Settings

**Name:** `capture_lead`

**Description:** `Post the gathered customer information to the CRM.`

**URL:** `https://unlexicographically-exosporal-jaydon.ngrok-free.dev/api/eleven-labs/lead`

**Method:** `POST`

**Response timeout (seconds):** `30`

### Body Parameters

Add these 4 parameters by clicking "Add parameter":

#### Parameter 1: Name
- **Data type:** String
- **Identifier:** `name`
- **Required:** ✅ Checked
- **Value Type:** LLM Prompt
- **Description:** `Extract the customer's full name from the conversation`

#### Parameter 2: Phone
- **Data type:** String
- **Identifier:** `phone`
- **Required:** ✅ Checked
- **Value Type:** Dynamic Variable
- **Dynamic Variable:** Select `system__caller_id`

#### Parameter 3: Job Description
- **Data type:** String
- **Identifier:** `job_description`
- **Required:** ✅ Checked
- **Value Type:** LLM Prompt
- **Description:** `Extract a brief description of what repair or handyman service the customer needs from the conversation`

#### Parameter 4: Urgency
- **Data type:** String
- **Identifier:** `urgency`
- **Required:** ❌ Unchecked
- **Value Type:** LLM Prompt
- **Description:** `Extract the urgency level from the conversation. The customer will indicate if the job needs immediate attention.`
- **Enum Values (optional):** 
  - `Critical`
  - `High`
  - `Standard`
  - `Low`

---

## 5. Knowledge Base

Upload the knowledge base file from: `/Users/courtneebonnick/v6-switchboard/docs/AI-prompts/knowledge-base.md`

OR copy and paste the content directly into the Knowledge Base section.

---

## 6. Advanced Settings (Optional)

### Conversation Settings
- **Pre-tool speech:** Auto
- **Execution mode:** Immediate
- **Disable interruptions:** Leave unchecked (allow natural conversation)

### Voice Settings
- **Voice:** Select a British English voice (e.g., "Charlotte" or "George")
- **Stability:** 0.5-0.7 (natural variation)
- **Similarity:** 0.7-0.8 (consistent character)
- **Speed:** 1.0 (normal pace)

---

## 7. Testing Checklist

Before going live, test these scenarios:

- [ ] Agent greets caller and asks for name
- [ ] Agent asks about the job after receiving name
- [ ] Agent asks about urgency
- [ ] Agent confirms information and reassures about callback
- [ ] Data appears in the leads database at `/api/leads`
- [ ] Phone number is correctly captured from caller ID
- [ ] Agent handles interruptions gracefully
- [ ] Agent stays on topic and doesn't provide quotes

---

## 8. Integration with Twilio

To connect this agent to your Twilio missed call flow:

1. In your Twilio settings (`/Users/courtneebonnick/v6-switchboard/server/settings.ts`), set:
   - `twilio.fallback_action` = `'eleven-labs'`
   - `twilio.fallback_agent_url` = `'YOUR_ELEVEN_LABS_AGENT_PHONE_NUMBER'`

2. When an agent misses a call, Twilio will automatically redirect to this Eleven Labs agent

---

## Quick Reference

**Agent Purpose:** Capture lead information from missed calls  
**Response Time Promise:** Within 1 hour  
**Service Area:** Nottinghamshire & Derbyshire  
**Business Hours:** 8 AM - 7 PM, 7 days a week  
**CRM Endpoint:** `POST https://unlexicographically-exosporal-jaydon.ngrok-free.dev/api/eleven-labs/lead`

---

## Troubleshooting

**Problem:** Agent doesn't wait for responses  
**Solution:** Make sure "Disable interruptions" is unchecked

**Problem:** Data not appearing in CRM  
**Solution:** Check ngrok is running and URL is correct in webhook settings

**Problem:** Agent provides incorrect information  
**Solution:** Review and update the knowledge base document

**Problem:** Agent sounds robotic  
**Solution:** Adjust voice stability and similarity settings

---

## Support

For questions or issues, refer to:
- Main documentation: `/Users/courtneebonnick/v6-switchboard/docs/AI-prompts/`
- Backend endpoint: `/Users/courtneebonnick/v6-switchboard/server/leads.ts`
- Webhook configuration: Lines 87-125 in leads.ts
