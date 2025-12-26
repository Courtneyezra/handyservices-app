# Live Call Transcription - Working Setup Guide

**Last Updated:** December 26, 2025  
**Status:** ✅ WORKING

This document captures the exact working configuration for live call transcription with Twilio, Deepgram, and real-time WhatsApp message generation.

---

## System Overview

```
┌─────────────┐
│ Twilio Call │
└──────┬──────┘
       │ Audio Stream
       ▼
┌─────────────────┐
│ ngrok Tunnel    │ → Port 5001
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Express Server  │
│ - Webhook       │
│ - WebSocket     │
└──────┬──────────┘
       │
       ├──→ ┌──────────────┐
       │    │ Deepgram API │ → Transcription
       │    └──────────────┘
       │
       └──→ ┌──────────────┐
            │ Frontend WS  │ → Live Display
            └──────────────┘
```

---

## Critical Configuration Files

### 1. Environment Variables (`.env`)

```bash
# Deepgram - MUST be valid and have credits
DEEPGRAM_API_KEY=e404e4c129e7a9da8c96db04a26963f78cc86fbb

# Deepgram Transcription Speed (optional, default: 1000)
# Lower = faster but choppier (e.g., 500)
# Higher = smoother but delayed (e.g., 1500)
DEEPGRAM_UTTERANCE_MS=1000

# OpenAI for message generation
OPENAI_API_KEY=your_openai_key_here

# Database
DATABASE_URL=your_database_url_here
```

**⚠️ CRITICAL:** Deepgram API key must:
- Be from an active account with credits
- Not be expired or revoked
- Have permissions for live transcription

---

### 2. Server Configuration

**File:** `server/index.ts`

**Critical Settings (Lines 28-30):**

```typescript
const app = express();
app.use(express.json({ limit: '10mb' })); // Increased limit for large transcriptions
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

**⚠️ CRITICAL:** Without increased payload limit, WhatsApp message generation fails with **413 Payload Too Large** error when transcription is long.

---

**File:** `server/twilio-realtime.ts`

**Critical Settings:**

```typescript
// Line 47-53: Deepgram configuration
const dgLive = deepgram.listen.live({
    model: "nova-2",
    language: "en-GB",
    smart_format: true,
    interim_results: true,
    utterance_end_ms: 1000,  // Reduced from default for faster response
    vad_events: true,
    encoding: "mulaw",
    sample_rate: 8000,
});

// Line 167: Database fix - MUST include startTime
await db.insert(calls).values({
    id: crypto.randomUUID(),
    callId: this.callSid,
    phoneNumber: "Unknown",
    startTime: new Date(), // ← CRITICAL: Prevents null constraint error
    direction: "inbound",
    status: "completed",
    transcription: finalText,
    leadId: leadId
});
```

---

### 3. Twilio Webhook Configuration

**Twilio Console → Phone Number → Voice Configuration:**

```
When a call comes in: Webhook
URL: https://unlexicographically-exosporal-jaydon.ngrok-free.dev/api/twilio/voice
HTTP: POST
```

**⚠️ IMPORTANT:** ngrok URL changes each restart unless using paid plan with static domain.

---

### 4. Frontend WebSocket Connection

**File:** `client/src/contexts/LiveCallContext.tsx`

**Lines 182-196:**

```typescript
useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws/client`;
    console.log('[LiveCall] Connecting to WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
        console.log('[LiveCall] WebSocket CONNECTED');
    };
    
    ws.onerror = (error) => {
        console.error('[LiveCall] WebSocket ERROR:', error);
    };
    // ... message handlers
});
```

---

## Startup Procedure

### 1. Start ngrok

```bash
cd /Users/courtneebonnick/v6-switchboard
ngrok http 5001
```

**Copy the ngrok URL** (e.g., `https://xxx.ngrok-free.dev`)

### 2. Update Twilio Webhook

Go to Twilio Console and update the voice webhook to:
```
https://YOUR_NGROK_URL/api/twilio/voice
```

### 3. Start Development Server

```bash
npm run dev
```

**Wait for:**
```
[V6 Switchboard] Listening on port 5001
[V6 Switchboard] WebSocket at ws://localhost:5001/api/twilio/realtime
```

### 4. Open Frontend (BEFORE making call)

```bash
open http://localhost:5001/live-call
```

**Verify in console (F12):**
```
[LiveCall] Connecting to WebSocket: ws://localhost:5001/api/ws/client
[LiveCall] WebSocket CONNECTED
```

### 5. Make Test Call

Call your Twilio number. You should see:

**In terminal:**
```
[Twilio] Incoming call from +44XXXXXXXXX  
[Deepgram] Live connection opened for CA...
[Deepgram] Final Segment: "your speech here"
[Broadcast] Sending voice:live_segment to 1 client(s)
```

**In browser:**
- Live transcript appearing
- SKU detection working
- Speakers marked (VA/Customer)

---

## Troubleshooting Guide

### Issue: No transcript appears

**Check in order:**

1. **Is Deepgram connected?**
   ```
   Look for: [Deepgram] Live connection opened
   If missing: Authentication failed
   ```

2. **Is frontend connected BEFORE call?**
   ```
   Look for: [Client WS] Frontend client connected
   Should show: Total clients: 1
   If 0 clients: No one listening to broadcasts
   ```

3. **Are broadcasts being sent?**
   ```
   Look for: [Broadcast] Sending voice:live_segment to X client(s)
   If X = 0: Frontend not connected when call started
   ```

4. **Database errors?**
   ```
   Look for: null value in column "start_time"
   Fix: Ensure line 167 in twilio-realtime.ts has startTime: new Date()
   ```

---

### Issue: Deepgram authentication fails

**Symptoms:**
```
Received network error or non-101 status code
[Deepgram] Live connection closed
```

**Solutions:**

1. **Check API key is valid:**
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://api.deepgram.com/v1/projects
   ```
   Should NOT return: `"UNAUTHORIZED"`

2. **Check Deepgram console:**
   - Credits available?
   - Account active?
   - API key not revoked?

3. **Create new API key:**
   - Go to https://console.deepgram.com/
   - Navigate to API Keys
   - Create new key
   - Update `.env` file
   - Restart server

---

### Issue: WhatsApp message uses fallback instead of transcript

**Symptoms:**
- Message says generic "we just spoke about the work you need"
- Doesn't include specific job details

**Causes:**

1. **Transcript not saved** - Database error prevented saving
2. **Frontend doesn't have transcript** - `liveCallData.transcription` is empty
3. **AI generation called too early** - Before call ended

**Solutions:**

1. **Check browser console:**
   ```javascript
   console.log(liveCallData?.transcription)
   // Should show actual speech
   ```

2. **Wait for call to end** before clicking "Request Video"

3. **Check server logs** for AI message generation:
   ```
   [AI Message] Final job phrase: the TV mounting
   ```

---

### Issue: 413 Payload Too Large when clicking "Request Video"

**Symptoms:**
```
Failed to load resource: the server responded with a status of 413 (Payload Too Large)
```

**Cause:** Default Express JSON limit (100kb) is too small for long transcriptions

**Solution:**

Check `server/index.ts` lines 29-30:
```typescript
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

If missing the `{ limit: '10mb' }` parameter, add it and restart server.

---

## Hard Reset Procedure

If things stop working, perform a complete reset:

```bash
# 1. Kill all processes
killall node tsx 2>/dev/null
lsof -ti:5001 | xargs kill -9 2>/dev/null

# 2. Clear caches
rm -rf node_modules/.vite

# 3. Restart everything
npm run dev
```

Then restart ngrok and update Twilio webhook.

---

## Adaptive WhatsApp Message Generation

**File:** `server/openai.ts`

The system uses `extractAdaptiveJobPhrase()` to intelligently handle:

- **Single job:** "the TV mounting"
- **Two jobs:** "the TV mounting and fence repair"  
- **Three jobs:** "the TV mounting, fence repair, and door installation"
- **Multiple (4+):** "the multiple repairs"
- **Vague:** "the work you need"

**Example output:**
```
Hi John! We just spoke about the TV mounting. Please send us a video so we can take a look and get a price back to you! 📹
```

---

## Key Changes Made

### What Changed from Non-Working to Working

1. **Added `startTime` field** to database insert (line 167 in twilio-realtime.ts)
2. **Increased Express payload limit** to 10mb (line 29 in index.ts) - prevents 413 errors
3. **Valid Deepgram API key** with active credits
4. **Ensured frontend connects BEFORE call** starts
5. **Added comprehensive logging** to track message flow
6. **Implemented adaptive job extraction** for better context

### Files Modified

- ✅ `server/index.ts` - Increased JSON payload limit to 10mb
- ✅ `server/twilio-realtime.ts` - Added startTime, improved logging
- ✅ `server/openai.ts` - Added extractAdaptiveJobPhrase()
- ✅ `client/src/contexts/LiveCallContext.tsx` - Added WebSocket logging

---

## Environment Requirements

- **Node.js:** v24.2.0+
- **ngrok:** Authenticated account
- **Deepgram:** Active account with credits
- **Twilio:** Account with phone number
- **OpenAI:** API key for message generation

---

## Success Indicators

When everything is working correctly, you should see:

✅ **Server startup:**
```
[V6 Switchboard] Listening on port 5001
[WhatsApp] Loaded 50 messages
```

✅ **Frontend connection:**
```
[LiveCall] WebSocket CONNECTED
[Client WS] Total clients: 1
```

✅ **During call:**
```
[Deepgram] Live connection opened
[Deepgram] Final Segment: "customer speech"
[Broadcast] Sending voice:live_segment to 1 client(s)
```

✅ **In UI:**
- Live transcript visible
- Speaker attribution (VA/Customer)
- SKU detection showing
- Outcome recommendation

---

## Backup & Recovery

**To create a backup of working state:**

```bash
# Create snapshot
tar -czf switchboard-working-$(date +%Y%m%d).tar.gz \
    server/twilio-realtime.ts \
    server/openai.ts \
    server/index.ts \
    client/src/contexts/LiveCallContext.tsx \
    .env
```

**To restore:**

```bash
# Extract backup
tar -xzf switchboard-working-YYYYMMDD.tar.gz

# Restart server
npm run dev
```

---

## Contact & Support

- **Deepgram Issues:** https://developers.deepgram.com/
- **Twilio Support:** https://www.twilio.com/docs
- **ngrok Docs:** https://ngrok.com/docs

---

**Document Version:** 1.0  
**Last Verified:** December 26, 2025
