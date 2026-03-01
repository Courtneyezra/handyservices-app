# Live Call System (The Monitor)

**Status:** LIVING DOCUMENT
**Last Updated:** 2025-02-26
**Scope:** Real-time call transcription and analysis

---

## Overview

The Monitor is the real-time component that:
1. Receives live audio from Twilio
2. Transcribes using WisprFlow/Deepgram
3. Extracts metadata (name, address, urgency)
4. Detects SKUs and classifies jobs
5. Broadcasts to admin dashboard

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         THE MONITOR                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TWILIO                                                              │
│    │                                                                 │
│    ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  MediaStreamTranscriber                                      │    │
│  │  ├── WebSocket Connection (Twilio → Server)                  │    │
│  │  ├── Dual-Track Audio (Inbound/Outbound)                     │    │
│  │  └── Local Recording (mulaw files)                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                        │                                             │
│                        ▼                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Transcription Service                                       │    │
│  │  ├── WisprFlow (Primary)                                     │    │
│  │  └── Deepgram (Fallback)                                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                        │                                             │
│                        ▼                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Analysis Pipeline                                           │    │
│  │  ├── SKU Detection (real-time)                               │    │
│  │  ├── Metadata Extraction (debounced)                         │    │
│  │  ├── Segment Classification                                  │    │
│  │  └── Traffic Light Assignment                                │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                        │                                             │
│                        ▼                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  WebSocket Broadcast                                         │    │
│  │  └── Admin Dashboard (HUD)                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. MediaStreamTranscriber
**File:** `server/twilio-realtime.ts`

Main class handling per-call transcription:

```typescript
class MediaStreamTranscriber {
  // Connection state
  private ws: WebSocket;           // Twilio connection
  private callSid: string;         // Twilio call ID
  private streamSid: string;       // Media stream ID

  // Transcription
  private wisprInbound: WisprFlowClient;   // Caller audio
  private wisprOutbound: WisprFlowClient;  // Agent audio

  // Analysis state
  private fullTranscript: string;
  private segments: Segment[];
  private metadata: CallMetadata;

  // Recording
  private inboundRecordingStream: fs.WriteStream;
  private outboundRecordingStream: fs.WriteStream;
}
```

### 2. Debouncing System
Prevents excessive API calls during rapid speech:

```typescript
// Configurable via admin settings
private debounceMs: number = 300;
private metadataChunkInterval: number = 5;
private metadataCharThreshold: number = 150;
```

### 3. Dual-Track Recording
Separate audio files for caller and agent:

```
storage/recordings/
├── {callSid}_inbound.mulaw    # Caller audio
├── {callSid}_outbound.mulaw   # Agent audio
└── {callSid}_combined.mp3     # Post-processed stereo
```

---

## Message Flow

### Incoming from Twilio
```typescript
// Media message (audio chunk)
{
  event: "media",
  streamSid: "xxx",
  media: {
    track: "inbound" | "outbound",
    payload: "base64_audio"
  }
}

// Call events
{ event: "start", start: { callSid, streamSid } }
{ event: "stop" }
```

### Outgoing to Dashboard
```typescript
// Transcript update
{
  type: "transcript",
  callSid: "xxx",
  transcript: "Hello, I need help with...",
  speaker: 0,
  isFinal: true
}

// SKU detection
{
  type: "sku_detected",
  callSid: "xxx",
  skus: [{ name: "Tap Repair", price: 85, confidence: 0.9 }]
}

// Metadata update
{
  type: "metadata",
  callSid: "xxx",
  customerName: "John Smith",
  address: "123 Main St",
  postcode: "SW1A 1AA",
  urgency: "High"
}
```

---

## Call Lifecycle

### 1. Call Start
```typescript
// Twilio sends "start" event
1. Create MediaStreamTranscriber instance
2. Initialize transcription clients (WisprFlow/Deepgram)
3. Set up recording streams
4. Create call record in database
5. Broadcast "call_started" to dashboard
```

### 2. During Call
```typescript
// For each audio chunk:
1. Route to correct track (inbound/outbound)
2. Send to transcription service
3. On transcript received:
   - Update fullTranscript
   - Run SKU detection
   - Run metadata extraction (debounced)
   - Broadcast updates to dashboard
```

### 3. Call End
```typescript
// Twilio sends "stop" event
1. Close transcription connections
2. Finalize recordings
3. Extract final metadata
4. Create/update lead record
5. Upload recordings to S3
6. Broadcast "call_ended" to dashboard
```

---

## Admin Dashboard Integration

### HUD (Heads-Up Display)
**File:** `client/src/pages/admin/HudPage.tsx`

Real-time display showing:
- Active calls with live transcripts
- Detected SKUs with traffic lights
- Customer metadata
- Segment classification
- Route recommendation

### WebSocket Events
```typescript
// Dashboard connects
ws.send({ type: "subscribe", channel: "calls" });

// Server broadcasts
broadcast({ type: "call_started", callSid, phoneNumber });
broadcast({ type: "transcript", ... });
broadcast({ type: "sku_detected", ... });
broadcast({ type: "call_ended", callSid });
```

---

## Configuration

### Timing Settings
**File:** `server/settings.ts`

```typescript
interface CallTimingSettings {
  debounceMs: number;          // Transcript debounce
  metadataChunkInterval: number;
  metadataCharThreshold: number;
}
```

### Transcription Service Selection
```typescript
// Automatic fallback
const USE_WISPRFLOW = !!process.env.WISPRFLOW_API_KEY;
if (!USE_WISPRFLOW && process.env.DEEPGRAM_API_KEY) {
  // Use Deepgram
}
```

---

## Tube Map Integration

### Call Script AI
**File:** `server/call-script.ts`

During calls, the system can provide real-time guidance:

```typescript
// Initialize session at call start
initializeCallScriptForCall(callSid);

// Process each transcript chunk
handleCallScriptTranscript(callSid, transcript);

// End session at call end
endCallScriptSession(callSid);
```

---

## Error Handling

### Connection Failures
```typescript
// WisprFlow disconnection
ws.on('close', () => {
  // Attempt reconnect or fallback to Deepgram
});

// Deepgram error
dgLive.on('error', (err) => {
  console.error('[Deepgram] Error:', err);
});
```

### Recording Failures
```typescript
try {
  await storageService.upload(recordingPath, s3Key);
} catch (err) {
  // Keep local file, retry later
  console.error('[Recording] Upload failed:', err);
}
```

---

## Performance Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Transcription latency | <100ms | Time to first word |
| SKU detection | <50ms | Keyword matching |
| Metadata extraction | <500ms | GPT-4o-mini call |
| Dashboard update | <200ms | WebSocket round-trip |

---

## Related Files

- `server/twilio-realtime.ts` - Main transcriber
- `server/wisprflow.ts` - WisprFlow client
- `server/call-logger.ts` - Database logging
- `server/call-script.ts` - Tube Map AI
- `client/src/pages/admin/HudPage.tsx` - Dashboard
- `docs/live-transcription-setup.md` - Setup guide
- `docs/transcription-speed-guide.md` - Optimization
