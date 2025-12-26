# Twilio Real-Time API Testing Setup Guide

## Quick Setup (5 minutes)

### Step 1: Configure ngrok Authentication

ngrok requires a free account. Set it up:

```bash
# 1. Sign up for ngrok (free): https://dashboard.ngrok.com/signup  
# 2. Get your authtoken: https://dashboard.ngrok.com/get-started/your-authtoken
# 3. Configure ngrok with your token:
ngrok config add-authtoken YOUR_TOKEN_HERE
```

### Step 2: Start ngrok Tunnel

```bash
# In a new terminal window (keep this running):
ngrok http 5001
```

You'll see output like:
```
Forwarding   https://abc123.ngrok-free.app -> http://localhost:5001
```

**Copy the HTTPS URL** (e.g., `https://abc123.ngrok-free.app`)

### Step 3: Update Twilio Webhook

1. Go to [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Click on your phone number
3. Under **Voice Configuration**:
   - **Configure with:** Webhooks
   - **A CALL COMES IN:** Webhook
   - **URL:** `https://YOUR-NGROK-URL/api/twilio/voice`
   - **HTTP:** POST
4. Click **Save**

### Step 4: Test the Call!

1. Make sure your dev server is running:
   ```bash
   npm run dev  # Already running on port 5001
   ```

2. Open your dashboard:
   ```
   http://localhost:5001
   ```

3. **Call your Twilio number from your phone** 📞

4. Watch the magic happen:
   - ✅ Real-time transcription in the dashboard
   - ✅ Live SKU detection as you speak
   - ✅ AI-generated WhatsApp message
   - ✅ Full call analysis

---

## What You'll See

### In Your Terminal:
```
[Twilio] Stream started: streamXXX
[Deepgram] Live connection opened for callXXX
[Deepgram] Final Segment: "Hello? I have a broken pipe..."
[Switchboard] Real-time detection: Plumbing Emergency (95%)
```

### In Your Dashboard:
- Live transcript appearing as you speak
- Real-time SKU detection gauge
- Suggested VA response script
- Customer metadata extraction
- WhatsApp message preview

---

## Testing Different Scenarios

Try saying different things to test SKU detection:

### ✅ Clear Matches (Should get instant SKU):
- "I need to mount a TV on the wall"
- "My ceiling light bulb is stuck"
- "I have a fence panel that needs replacing"

### ✅ Ambiguous Cases (Should extract job summary):
- "I have some general handyman work"
- "Need help with a few things around the house"

### ✅ Urgent Cases (Should detect urgency):
- "I have a major leak in the kitchen!"
- "Emergency - water everywhere!"

---

## Troubleshooting

### ngrok Issues:

**Problem:** "authentication failed"
```bash
# Solution: Add your authtoken
ngrok config add-authtoken YOUR_TOKEN_HERE
```

**Problem:** "tunnel session failed"
```bash
# Solution: ngrok might have expired, restart it
# Press Ctrl+C to stop, then run again:
ngrok http 5001
# Copy the NEW URL and update Twilio
```

### Twilio Issues:

**Problem:** Call doesn't connect to your app
- ✅ Check ngrok is running
- ✅ Verify Twilio webhook URL is correct (with /api/twilio/voice)
- ✅ Make sure you're using the HTTPS URL from ngrok, not HTTP

**Problem:** No transcription appearing
- ✅ Check DEEPGRAM_API_KEY is set in .env
- ✅ Look for errors in terminal
- ✅ Verify websocket connection (you should see "Deepgram live connection opened")

### Dashboard Issues:

**Problem:** Not seeing live updates
- ✅ Check browser console for WebSocket errors
- ✅ Refresh the page
- ✅ Verify you're on http://localhost:5001 (not 5000 or another port)

---

## After Testing

When you're done testing:

1. **Stop ngrok:** Press Ctrl+C in the ngrok terminal
2. **(Optional) Revert Twilio webhook:** Change it back to your production URL if needed

---

## Alternative: Test Without Phone Call

If you don't want to use a real phone call yet, use the built-in simulation:

1. Go to `http://localhost:5001`
2. Navigate to "Active Calls" page
3. Enter a job description (e.g., "broken pipe")
4. Click **"Simulate Live Call"**
5. Watch the simulated transcript appear

This tests everything except the actual Twilio/Deepgram integration.

---

## Next Steps

Once you've successfully tested:

1. ✅ Verify WhatsApp messages look good
2. ✅ Test with 3-5 different job types
3. ✅ Check both casual and professional tones
4. ✅ Confirm SKU detection is accurate
5. 🚀 Go live with real calls!

---

## Quick Reference

| What | Command/URL |
|------|-------------|
| Start ngrok | `ngrok http 5001` |
| Your app | `http://localhost:5001` |
| Twilio Console | https://console.twilio.com |
| ngrok Dashboard | `http://localhost:4040` (shows request logs) |
| Stop ngrok | Ctrl+C |

---

## Pro Tips

**Use ngrok Web Interface:**
- While ngrok is running, go to `http://localhost:4040`
- You'll see all requests to your webhook
- Great for debugging!

**Save Your ngrok URL:**
- ngrok URLs change each time you restart
- Consider getting a permanent ngrok URL (paid plan) for consistent testing
- Or use ngrok's reserved domains feature

**Test Multiple Scenarios:**
- Have a list of test scripts ready
- Try different accents/speeds
- Test background noise scenarios
