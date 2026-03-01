# External Integrations

**Status:** LIVING DOCUMENT
**Last Updated:** 2025-02-26
**Scope:** All third-party service integrations

---

## Integration Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         V6 SWITCHBOARD                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TELEPHONY                           PAYMENTS                        │
│  ├── Twilio (Calls)                  └── Stripe                      │
│  └── Twilio (SMS)                        ├── Checkout                │
│                                          ├── Webhooks                │
│  MESSAGING                               └── Invoicing               │
│  ├── WhatsApp Business API                                          │
│  └── Meta Webhooks                   STORAGE                         │
│                                      └── AWS S3                      │
│  AI/ML                                   ├── Recordings              │
│  ├── OpenAI (GPT-4o-mini)                ├── Photos                  │
│  ├── Deepgram (Transcription)            └── Documents               │
│  ├── WisprFlow (Real-time)                                          │
│  └── ElevenLabs (Voice)              DATABASE                        │
│                                      └── Neon PostgreSQL             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Twilio

### Purpose
Telephony backbone for calls and SMS

### Files
- `server/twilio-client.ts` - Client initialization
- `server/twilio-realtime.ts` - WebSocket media streams
- `server/routes/twilio.ts` - Webhook handlers

### Webhooks
| Endpoint | Purpose |
|----------|---------|
| `/api/twilio/voice` | Incoming call handling |
| `/api/twilio/status` | Call status updates |
| `/api/twilio/media-stream` | WebSocket audio stream |

### Features
- Incoming call routing
- Real-time audio streaming
- SMS notifications
- Call recordings

### Environment Variables
```bash
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+44xxx
```

---

## 2. Stripe

### Purpose
Payment processing and invoicing

### Files
- `server/stripe-routes.ts` - API routes
- `client/src/pages/PersonalizedQuotePage.tsx` - Checkout integration

### Endpoints
| Endpoint | Purpose |
|----------|---------|
| `POST /api/stripe/create-checkout` | Create checkout session |
| `POST /api/stripe/webhook` | Handle payment events |
| `GET /api/stripe/session/:id` | Get session details |

### Webhook Events
- `checkout.session.completed` - Payment successful
- `payment_intent.succeeded` - Payment confirmed
- `invoice.paid` - Invoice paid

### Environment Variables
```bash
STRIPE_SECRET_KEY=sk_xxx
STRIPE_PUBLISHABLE_KEY=pk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

---

## 3. WhatsApp Business API

### Purpose
Tenant communication and video request delivery

### Files
- `server/whatsapp-api.ts` - API client
- `server/meta-whatsapp.ts` - Meta webhook handlers

### Features
- Send template messages
- Receive text/voice/image messages
- Voice note transcription (via Whisper)
- Video quote delivery

### Message Types
| Type | Handler |
|------|---------|
| Text | Direct processing |
| Voice | Transcribe → Process |
| Image | Store → Attach to issue |
| Video | Store → Attach to issue |

### Environment Variables
```bash
WHATSAPP_ACCESS_TOKEN=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_VERIFY_TOKEN=xxx
WHATSAPP_BUSINESS_ACCOUNT_ID=xxx
```

---

## 4. OpenAI

### Purpose
AI analysis and extraction

### Files
- `server/openai.ts` - All OpenAI functions

### Models Used
| Model | Purpose |
|-------|---------|
| gpt-4o-mini | Metadata extraction, classification |
| whisper-1 | Voice note transcription |

### Functions
```typescript
extractCallMetadata()     // Name, address, urgency
classifyLead()            // Segment detection
transcribeAudioFromUrl()  // Voice notes
```

### Environment Variables
```bash
OPENAI_API_KEY=sk-xxx
```

---

## 5. Deepgram

### Purpose
Real-time call transcription (fallback)

### Files
- `server/twilio-realtime.ts` - Integration

### Configuration
```typescript
{
  model: "nova-2-phonecall",
  punctuate: true,
  smart_format: true,
  diarize: true,
  utterance_end_ms: 1500
}
```

### Environment Variables
```bash
DEEPGRAM_API_KEY=xxx
```

---

## 6. WisprFlow

### Purpose
Primary real-time transcription

### Files
- `server/wisprflow.ts` - Client
- `server/audio-converter.ts` - Audio format conversion

### Features
- Dual-track transcription (inbound/outbound)
- Speaker diarization
- Ultra-low latency

### Environment Variables
```bash
WISPRFLOW_API_KEY=xxx
```

---

## 7. ElevenLabs

### Purpose
AI voice agent for outbound calls

### Files
- `server/elevenlabs.ts` - Voice synthesis

### Environment Variables
```bash
ELEVENLABS_API_KEY=xxx
ELEVENLABS_VOICE_ID=xxx
```

---

## 8. AWS S3

### Purpose
File storage for recordings, photos, documents

### Files
- `server/storage.ts` - Storage service

### Buckets/Prefixes
| Prefix | Content |
|--------|---------|
| `recordings/` | Call recordings |
| `photos/` | Job photos |
| `documents/` | Invoices, quotes |
| `tenant-media/` | Tenant submissions |

### Environment Variables
```bash
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=eu-west-2
AWS_S3_BUCKET=xxx
```

---

## 9. Neon (PostgreSQL)

### Purpose
Primary database

### Files
- `server/db.ts` - Connection
- `shared/schema.ts` - Drizzle schema

### Connection
Uses serverless driver with connection pooling

### Environment Variables
```bash
DATABASE_URL=postgres://xxx
```

---

## Integration Health Checks

### Startup Validation
```typescript
// Each integration validates on startup
console.log("[Twilio] Connected");
console.log("[Stripe] Webhook verified");
console.log("[OpenAI] API key valid");
```

### Runtime Monitoring
- Failed API calls logged with error context
- Retry logic for transient failures
- Fallback services (WisprFlow → Deepgram)

---

## Security Notes

1. **API Keys:** Never commit to git, use environment variables
2. **Webhooks:** Always validate signatures
3. **HTTPS:** All external calls use TLS
4. **Rate Limiting:** Respect provider limits

---

## Related Documentation

- `docs/S3_SETUP_GUIDE.md` - AWS configuration
- `docs/twilio-testing-guide.md` - Twilio testing
- `docs/DEPENDENCIES.md` - Package versions
