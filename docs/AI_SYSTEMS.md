# AI Systems Overview

**Status:** LIVING DOCUMENT
**Last Updated:** 2025-02-26
**Scope:** All AI/ML components in V6 Switchboard

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AI SYSTEMS                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TRANSCRIPTION LAYER                                                │
│  ├── WisprFlow (Primary) - Real-time dual-track transcription       │
│  └── Deepgram (Fallback) - Live transcription with diarization      │
│                                                                      │
│  ANALYSIS LAYER                                                      │
│  ├── GPT-4o-mini - Call metadata extraction                         │
│  ├── GPT-4o-mini - Lead classification & segmentation               │
│  └── GPT-4o-mini - Job complexity classification                    │
│                                                                      │
│  DETECTION LAYER                                                     │
│  ├── SKU Detector - Match jobs to productized services              │
│  ├── Segment Detector - WTP-based customer segmentation             │
│  └── Route Recommender - instant/tiers/assessment routing           │
│                                                                      │
│  VOICE LAYER                                                         │
│  ├── Whisper - Voice note transcription (WhatsApp)                  │
│  └── ElevenLabs - AI voice agent (outbound)                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Transcription Services

### WisprFlow (Primary)
- **File:** `server/wisprflow.ts`
- **Purpose:** Real-time dual-track transcription during live calls
- **Features:**
  - Separate inbound/outbound audio streams
  - Speaker diarization
  - Ultra-low latency (<100ms)

### Deepgram (Fallback)
- **File:** `server/twilio-realtime.ts`
- **Purpose:** Fallback when WisprFlow unavailable
- **Model:** `nova-2-phonecall`
- **Features:**
  - Speaker diarization
  - Smart formatting
  - Utterance end detection

### Whisper (Voice Notes)
- **File:** `server/openai.ts` → `transcribeAudioFromUrl()`
- **Purpose:** Transcribe WhatsApp voice notes from tenants
- **Model:** `whisper-1`

---

## 2. Call Analysis (The Brain)

### Metadata Extraction
- **File:** `server/openai.ts` → `extractCallMetadata()`
- **Model:** GPT-4o-mini
- **Extracts:**
  - Customer name (with confidence scoring)
  - Company name
  - Address & postcode
  - Urgency level (Critical/High/Standard/Low)
  - Lead type (Homeowner/Landlord/Property Manager/Tenant)

### Lead Classification
- **File:** `server/openai.ts` → `classifyLead()`
- **Model:** GPT-4o-mini
- **Classifies:**
  - Client type (homeowner/landlord/tenant/commercial)
  - Job clarity (known/vague/complex)
  - Job type (commodity/subjective/fault/project)
  - Urgency (asap/normal/flexible)
  - Segment (EMERGENCY/BUSY_PRO/PROP_MGR/LANDLORD/etc.)

### Job Complexity Classification
- **File:** `server/services/job-complexity-classifier.ts`
- **Two-Tier System:**
  - **Tier 1:** Instant keyword matching (<50ms) - Real-time UI
  - **Tier 2:** LLM classification (<400ms) - Refined routing

```typescript
type TrafficLight = 'green' | 'amber' | 'red';
// GREEN = SKU matched (instant price)
// AMBER = Needs video/visit assessment
// RED = Specialist work, refer out
```

---

## 3. SKU Detection

### SKU Detector
- **File:** `server/skuDetector.ts`
- **Functions:**
  - `detectSku()` - Single job matching
  - `detectMultipleTasks()` - Multi-job detection
  - `detectWithContext()` - Context-aware detection

### Detection Flow
```
Transcript → Keyword Matching → SKU Lookup → Price Calculation
                    ↓
            Traffic Light Assignment
                    ↓
            Route Recommendation
```

---

## 4. Customer Segmentation

### Segment Detection
- **File:** `server/segmentation/config.ts`
- **Framework:** Madhavan Ramanujam (WTP-based)

### Segments (8 Total)
| Segment | WTP Driver | Priority |
|---------|------------|----------|
| EMERGENCY | Urgency | 1 (check first) |
| BUSY_PRO | Time | 2 |
| PROP_MGR | Scale + SLA | 3 |
| LANDLORD | Zero Hassle | 4 |
| SMALL_BIZ | Zero Disruption | 5 |
| TRUST_SEEKER | Safety + Trust | 6 |
| DIY_DEFERRER | Finally Done | 7 (default) |
| RENTER | Approval + Budget | 8 |

### Signal Weighting
```typescript
Segment Score = Σ (Signal Weight × Confidence)
// First segment above threshold wins
```

---

## 5. Route Recommendation

### Quote Routes
- **File:** `server/services/job-complexity-classifier.ts`

| Route | When | Output |
|-------|------|--------|
| `instant` | Green light, SKU matched | Fixed price quote |
| `tiers` | Amber light, needs options | Good/Better/Best tiers |
| `assessment` | Red light, complex | Assessment visit required |

---

## 6. Call Script AI (Tube Map)

### Purpose
Real-time guidance for VAs during calls

### Components
- **File:** `server/call-script.ts`
- Session management per call
- Real-time transcript analysis
- Dynamic prompt suggestions

---

## 7. AI Video Generation

### Purpose
Generate personalized video quotes for leads

### Integration
- Uses AI-generated content
- Personalized to segment
- Sent via WhatsApp/SMS

---

## Environment Variables

```bash
# Transcription
WISPRFLOW_API_KEY=xxx       # Primary transcription
DEEPGRAM_API_KEY=xxx        # Fallback transcription

# OpenAI
OPENAI_API_KEY=xxx          # GPT-4o-mini for analysis

# Voice
ELEVENLABS_API_KEY=xxx      # AI voice agent
```

---

## Performance Targets

| Operation | Target | Actual |
|-----------|--------|--------|
| Transcription latency | <100ms | ~80ms |
| Metadata extraction | <500ms | ~400ms |
| SKU detection | <50ms | ~30ms |
| Segment classification | <400ms | ~350ms |

---

## Related Files

- `server/openai.ts` - Core OpenAI functions
- `server/twilio-realtime.ts` - Live call transcription
- `server/skuDetector.ts` - SKU matching
- `server/segmentation/config.ts` - Segment definitions
- `server/services/job-complexity-classifier.ts` - Traffic light system
- `server/services/call-analyzer.ts` - Call analysis
- `server/call-script.ts` - Tube Map AI guidance
