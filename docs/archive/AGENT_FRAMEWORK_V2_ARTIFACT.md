> **ARCHIVED (3 Sep 2026).** Superseded by `docs/COMMS_AGENTS_V3_DESIGN.md`; the V2 pipeline it describes was deleted in Phase 5. Kept for history only.

# Agent Framework V2 - Implementation Artifact

> Built August 2026 | Replaces linear comms agent with specialist workers + shared memory

## Executive Summary

Agent Framework V2 replaces the single-model linear comms agent with **orchestrated specialist workers** sharing a **unified conversation memory**. Each worker uses the optimal LLM for its task via **OpenRouter multi-model routing**.

### Key Metrics (from comparison test)

| Metric | OLD Pipeline | NEW Pipeline (V2) |
|--------|-------------|-------------------|
| Architecture | Single GPT-4o call | 4 specialist workers |
| Duration | ~2.7s | ~24s |
| Token usage | ~350 | ~3,000 |
| Structured output | Reply only | Scope + Research + Pricing + Reply |
| Pricing capability | None | Full breakdown (labour, materials, VAT) |

**Trade-off**: V2 uses more tokens but produces structured data (job lines, gaps, materials, pricing) that enables downstream automation and Ben's review workflow.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CONVERSATION MEMORY (PostgreSQL)                │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬────────┐ │
│  │ messages │  media   │  scope   │ research │  pricing │  draft │ │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴────────┘ │
└─────────────────────────────────────────────────────────────────────┘
        ▲            ▲          ▲          ▲          ▲          ▲
        │            │          │          │          │          │
   ┌────┴────┐  ┌────┴────┐ ┌───┴───┐ ┌────┴────┐ ┌───┴───┐ ┌────┴────┐
   │ Inbound │  │ Vision  │ │Scoping│ │Research │ │Pricing│ │  Reply  │
   │ Handler │  │ Worker  │ │Worker │ │ Worker  │ │Worker │ │ Worker  │
   └─────────┘  └─────────┘ └───────┘ └─────────┘ └───────┘ └─────────┘
                     │           │          │                     │
                     ▼           ▼          ▼                     ▼
              Gemini Flash  Claude Sonnet  Claude Sonnet      GPT-4o
              (vision)      (extraction)   (extraction)   (conversation)
```

### Model Routing Strategy

| Role | Model | Use Case | Rationale |
|------|-------|----------|-----------|
| `vision` | google/gemini-flash-1.5 | Photo analysis | Best price/quality for images |
| `conversation` | openai/gpt-4o | Customer replies | Natural, human-like tone |
| `extraction` | anthropic/claude-sonnet-4 | Scope & research | Low hallucination, structured output |
| `validation` | anthropic/claude-opus-4 | Complex edge cases | Best reasoning capability |

---

## Worker Pipeline

### 1. Vision Worker (`server/workers/vision.ts`)

**Trigger**: Customer sends photo
**Model**: Gemini Flash via `callLLM('vision', ...)`
**Input**: Base64-encoded image (resized to 1024px max)
**Output**: `MediaExtraction` with items, defects, text found

```typescript
interface MediaExtraction {
  mediaId: string;
  model: string;
  extractedAt: string;
  items: ExtractedItem[];      // type, material, condition, location
  defects: ExtractedDefect[];  // type, severity, description
  textFound: string[];         // brands, model numbers, OCR
  confidence: number;          // 0-1
  raw: string;                 // original LLM response
}
```

### 2. Scoping Worker (`server/workers/scoping.ts`)

**Trigger**: Message received, media extracted, gap answered
**Model**: Claude Sonnet via `callLLM('extraction', ...)`
**Input**: Conversation messages + photo extractions
**Output**: `ConversationScope` with customer info, job lines, gaps

```typescript
interface ConversationScope {
  customerName: string | null;
  phone: string;
  postcode: string | null;
  customerType: 'homeowner' | 'landlord' | 'letting_agent' | 'business';
  tone: 'urgent' | 'anxious' | 'relaxed' | 'price_sensitive' | 'detailed' | 'terse';
  lines: ScopeLine[];          // job items with assumptions
  assumptions: ScopeAssumption[];
  gaps: ScopeGap[];            // questions to ask (customer or Ben)
  lastScopedAt: string;
}
```

### 3. Research Worker (`server/workers/research.ts`)

**Trigger**: Scope complete
**Model**: Claude Sonnet via `callLLM('extraction', ...)`
**Input**: Scope lines + photo extractions
**Output**: `ConversationResearch` with materials, time estimates, procedures

```typescript
interface ResearchedLine {
  lineId: string;
  materials: Array<{
    name: string;
    quantity: number;
    unitPricePence: number;
    supplier: 'catalog' | 'screwfix' | 'toolstation' | 'web' | 'estimated';
    confidence: 'high' | 'medium' | 'low';
    needsReview: boolean;
  }>;
  timeEstimate: {
    minutes: number;
    confidence: 'high' | 'medium' | 'low';
    basis: 'historical' | 'estimated' | 'standard';
    reasoning: string;
  };
  procedure: string[];
}
```

### 4. Pricing Worker (`server/workers/pricing.ts`)

**Trigger**: Research complete
**Model**: None (rules-based calculation)
**Input**: Research results
**Output**: `ConversationPricing` with labour, materials, VAT, total

```typescript
// Constants
const LABOUR_RATE_PENCE_PER_HOUR = 4500;  // £45/hour
const MIN_CALL_OUT_PENCE = 7500;           // £75 minimum
const VAT_RATE = 0.2;

interface ConversationPricing {
  labourPence: number;
  materialsPence: number;
  vatPence: number;
  totalPence: number;
  breakdownByLine: Array<{
    lineId: string;
    labourPence: number;
    materialsPence: number;
  }>;
  lastPricedAt: string;
}
```

### 5. Reply Worker (`server/workers/reply.ts`)

**Trigger**: Inbound message, after scoping/pricing
**Model**: GPT-4o via `callLLM('conversation', ...)`
**Input**: Memory context, gaps to ask, pricing (if ready)
**Output**: Human-like reply matching customer tone

**Reply rules**:
- Never mention specific prices unless quote is ready
- Never commit to specific dates
- Ask max 1 clarifying question per reply
- Match customer's tone (urgent → reassuring, terse → brief)
- Reference what customer actually said

---

## Shared Memory

### Database Schema

```sql
CREATE TABLE conversation_memory (
  id VARCHAR PRIMARY KEY,
  conversation_id VARCHAR NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,  -- Optimistic locking

  -- Raw inputs
  messages JSONB,
  media JSONB,
  calls JSONB,

  -- Worker outputs
  media_extractions JSONB,
  scope JSONB,
  research JSONB,
  pricing JSONB,
  draft JSONB,

  -- State
  readiness memory_readiness NOT NULL DEFAULT 'new',
  blockers JSONB,

  -- Audit
  worker_runs JSONB,
  ben_edits JSONB,

  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TYPE memory_readiness AS ENUM (
  'new', 'extracting_media', 'gathering', 'scoped',
  'researching', 'researched', 'priced', 'drafting',
  'needs_human', 'approved', 'sent'
);
```

### Memory API

```typescript
// Get or create memory for a conversation
getOrCreateMemory(conversationId: string): Promise<ConversationMemory>

// Update memory with optimistic locking
updateMemory(
  conversationId: string,
  updates: MemoryUpdate,
  expectedVersion: number
): Promise<ConversationMemory>

// Append worker run to audit trail
appendWorkerRun(
  conversationId: string,
  run: WorkerRun
): Promise<void>
```

---

## OpenRouter Integration

### Client Setup (`server/llm/openrouter.ts`)

```typescript
import OpenAI from 'openai';

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  timeout: 2 * 60 * 1000,  // 2 min for vision tasks
  defaultHeaders: {
    'X-Title': 'V6-Switchboard',
    'HTTP-Referer': 'https://handyservices.app',
  },
});
```

### Calling LLMs

```typescript
// Text-only call
const response = await callLLM('extraction', [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: context },
], { jsonMode: true, maxTokens: 2048 });

// Vision call with images
const response = await callLLMWithImages(
  'vision',
  VISION_SYSTEM_PROMPT,
  [{ base64: imageData, mediaType: 'image/jpeg' }],
  userPrompt,
  { jsonMode: true }
);
```

### Response Format

```typescript
interface LLMResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
}
```

---

## Key Implementation Details

### JSON Parsing (handles markdown code blocks)

All workers strip markdown code blocks before parsing:

```typescript
const raw = response.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
const parsed = JSON.parse(raw);
```

### Worker Run Audit Trail

Every LLM call is logged:

```typescript
interface WorkerRun {
  id: string;
  worker: 'vision' | 'scoping' | 'research' | 'reply';
  model: string;
  trigger: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  changes: string[];      // Which memory fields changed
  error: string | null;
  tokenUsage: { input: number; output: number } | null;
}
```

### Image Processing

Vision worker resizes images before sending:

```typescript
import sharp from 'sharp';

const buffer = await sharp(filePath)
  .rotate()              // Honour EXIF orientation
  .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 80 })
  .toBuffer();
```

---

## File Reference

| File | Purpose |
|------|---------|
| `shared/conversation-memory.ts` | Type definitions for all memory structures |
| `server/memory/index.ts` | Memory CRUD with optimistic locking |
| `server/llm/openrouter.ts` | Multi-model API client |
| `server/workers/vision.ts` | Photo extraction with Gemini |
| `server/workers/scoping.ts` | Job scope extraction with Claude |
| `server/workers/research.ts` | Materials/time estimation |
| `server/workers/pricing.ts` | Rules-based pricing calculation |
| `server/workers/reply.ts` | Customer reply generation |

---

## Test Scripts

```bash
# Quick smoke test - validates imports, memory, LLM connectivity
npx tsx scripts/_smoke-agent-v2.ts

# Full E2E pipeline test with mock photo
npx tsx scripts/_e2e-agent-pipeline.ts [--skip-vision] [--verbose]

# Side-by-side comparison: OLD vs NEW pipeline
npx tsx scripts/_compare-pipelines.ts [--skip-old] [--skip-new] [--verbose]
```

---

## Cost Optimization (Future)

Current: All extraction tasks use Claude Sonnet (expensive but accurate)

Potential optimization - add `extraction_lite` role:

```typescript
MODELS = {
  extraction: 'anthropic/claude-sonnet-4',      // Complex extraction
  extraction_lite: 'openai/gpt-4o-mini',        // Simple extraction - NEW
}
```

Use `extraction_lite` for scoping/research (70% cost reduction) while keeping `extraction` for validation and edge cases.

---

## Design Principles

1. **Accuracy over cost** - Claude Sonnet for extraction tasks (low hallucination)
2. **Human-like experience** - GPT-4o for customer replies (natural tone)
3. **Structured data** - Every worker outputs typed JSON for downstream automation
4. **Audit trail** - Every LLM call logged with tokens, duration, changes
5. **Gradual autonomy** - Ben can edit quotes, system learns from his patterns
