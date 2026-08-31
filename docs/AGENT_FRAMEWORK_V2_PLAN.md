# Agent Framework V2: Implementation Plan

## Executive Summary

Rebuild the quote pipeline from role-based sequential agents to a **shared memory + specialist workers** architecture, with **multi-model routing via OpenRouter** for optimal accuracy and human-like experience.

**Goals (in priority order):**
1. Accuracy — right quotes, low hallucination
2. Human-like experience — customer feels heard
3. Gradual autonomy — observe Ben's edits, learn, reduce Ben's involvement over time

**Non-goals:**
- Speed optimization (same-day is fine)
- Full automation (Ben stays in loop until confidence is high)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONVERSATION MEMORY                          │
│  { messages, media, scope, research, pricing, draft, audit }   │
└─────────────────────────────────────────────────────────────────┘
         │
         │ Events trigger workers
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MODEL ROUTER                                │
│            (OpenRouter — unified API)                           │
│                                                                 │
│   Vision ──► Gemini Flash    Conversation ──► GPT-4o           │
│   Extraction ──► Claude Sonnet    Validation ──► Claude Opus   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SPECIALIST WORKERS                           │
│                                                                 │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│   │  Vision  │ │ Scoping  │ │ Research │ │ Pricing  │          │
│   │  Worker  │ │  Worker  │ │  Worker  │ │  Worker  │          │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│   ┌──────────┐ ┌──────────┐                                    │
│   │  Reply   │ │ Message  │                                    │
│   │  Worker  │ │  Worker  │                                    │
│   └──────────┘ └──────────┘                                    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BEN'S UNIFIED UI                             │
│        Single view: scope + research + pricing + draft          │
│        Edit tracking: every change logged for learning          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Workstreams (Parallelizable)

### WS1: Data Model & Memory Object
**Owner:** Agent Pane 1
**Dependencies:** None
**Output:** `shared/conversation-memory.ts`, migration scripts

### WS2: OpenRouter Integration
**Owner:** Agent Pane 2
**Dependencies:** None
**Output:** `server/llm/openrouter.ts`, model router

### WS3: Vision Worker (Gemini)
**Owner:** Agent Pane 3
**Dependencies:** WS2 (OpenRouter)
**Output:** `server/workers/vision.ts`, structured extraction

### WS4: Conversation Worker (GPT-4o)
**Owner:** Agent Pane 4
**Dependencies:** WS1, WS2
**Output:** `server/workers/reply.ts`, tone-aware replies

### WS5: Scoping & Extraction Worker
**Owner:** Agent Pane 1 (after WS1)
**Dependencies:** WS1, WS3
**Output:** `server/workers/scoping.ts`

### WS6: Research & Pricing Workers
**Owner:** Agent Pane 2 (after WS2)
**Dependencies:** WS1, WS5
**Output:** `server/workers/research.ts`, `server/workers/pricing.ts`

### WS7: Ben's Unified UI
**Owner:** Agent Pane 3 (after WS3)
**Dependencies:** WS1
**Output:** `client/src/components/memory/MemoryPanel.tsx`

### WS8: Edit Tracking & Learning
**Owner:** Agent Pane 4 (after WS4)
**Dependencies:** WS7
**Output:** `server/learning/edit-tracker.ts`, analytics

---

## Detailed Implementation

---

## WORKSTREAM 1: Data Model & Memory Object

### Task 1.1: Define ConversationMemory Schema

**File:** `shared/conversation-memory.ts`

```typescript
// Types for the shared memory object

export interface ConversationMemory {
  id: string;
  conversationId: string;
  version: number;  // Optimistic locking

  // === RAW INPUTS ===
  messages: MemoryMessage[];
  media: MemoryMedia[];
  calls: MemoryCall[];

  // === EXTRACTED (Vision Worker) ===
  mediaExtractions: MediaExtraction[];

  // === SCOPE (Scoping Worker) ===
  scope: ConversationScope | null;

  // === RESEARCH (Research Worker) ===
  research: ConversationResearch | null;

  // === PRICING (Pricing Worker) ===
  pricing: ConversationPricing | null;

  // === DRAFT (Message Worker) ===
  draft: QuoteDraft | null;

  // === STATE ===
  readiness: MemoryReadiness;
  blockers: Blocker[];

  // === AUDIT ===
  workerRuns: WorkerRun[];
  benEdits: BenEdit[];

  createdAt: string;
  updatedAt: string;
}

export type MemoryReadiness =
  | 'new'
  | 'extracting_media'
  | 'gathering'
  | 'scoped'
  | 'researching'
  | 'researched'
  | 'pricing'
  | 'priced'
  | 'drafting'
  | 'ready_for_ben'
  | 'sent'
  | 'needs_human';

export interface MediaExtraction {
  mediaId: string;
  model: 'gemini-flash';
  extractedAt: string;
  items: ExtractedItem[];
  defects: ExtractedDefect[];
  textFound: string[];  // OCR results
  confidence: number;   // 0-1
  raw: string;          // Original model output for debugging
}

export interface ExtractedItem {
  type: string;           // e.g., 'tap', 'pipe', 'fence_panel'
  material?: string;      // e.g., 'chrome', 'copper', 'wood'
  condition?: string;     // e.g., 'corroded', 'leaking', 'broken'
  location?: string;      // e.g., 'kitchen sink', 'garden boundary'
  confidence: 'high' | 'medium' | 'low';
}

export interface ExtractedDefect {
  type: 'leak' | 'crack' | 'corrosion' | 'rot' | 'missing' | 'broken' | 'worn' | 'other';
  severity: 'minor' | 'moderate' | 'major';
  description: string;
  itemRef?: string;       // Links to ExtractedItem
}

export interface ConversationScope {
  customerName: string | null;
  phone: string;
  postcode: string | null;
  customerType: 'homeowner' | 'landlord' | 'letting_agent' | 'business';
  tone: 'urgent' | 'anxious' | 'relaxed' | 'price_sensitive' | 'detailed' | 'terse';
  lines: ScopeLine[];
  assumptions: ScopeAssumption[];
  gaps: ScopeGap[];
  lastScopedAt: string;
}

export interface ScopeLine {
  id: string;
  title: string;              // Customer-facing, max 60 chars
  detail: string;             // Internal evidence
  customerWords: string;      // What customer actually said (for human-like replies)
  assumptions: ScopeAssumption[];
  evidence: {
    messageIds: string[];
    mediaIds: string[];
    callIds: string[];
  };
}

export interface ScopeAssumption {
  text: string;
  confidence: 'observed' | 'inferred' | 'assumed';
  source: 'photo' | 'customer_said' | 'typical_for_job';
}

export interface ScopeGap {
  id: string;
  question: string;
  audience: 'customer' | 'ben';
  lineId: string | null;
  impact: 'none' | 'small' | 'large' | 'forks_job';
  asked: boolean;
  askedAt: string | null;
  answered: boolean;
  answeredAt: string | null;
  answer: string | null;
}

export interface ConversationResearch {
  lines: ResearchedLine[];
  historicalMatches: HistoricalMatch[];
  lastResearchedAt: string;
}

export interface ResearchedLine {
  lineId: string;
  materials: ResearchedMaterial[];
  timeEstimate: TimeEstimate;
  procedure: string[];
}

export interface ResearchedMaterial {
  name: string;
  quantity: number;
  unitPricePence: number;
  supplier: 'catalog' | 'screwfix' | 'web' | 'estimated';
  confidence: 'high' | 'medium' | 'low';
  needsReview: boolean;
}

export interface TimeEstimate {
  minutes: number;
  confidence: 'high' | 'medium' | 'low';
  basis: 'historical' | 'estimated' | 'standard';
  reasoning: string;
}

export interface ConversationPricing {
  lines: PricedLine[];
  labourPence: number;
  materialsPence: number;
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  margin: number;
  lastPricedAt: string;
}

export interface PricedLine {
  lineId: string;
  labourPence: number;
  materialsPence: number;
  totalPence: number;
}

export interface QuoteDraft {
  message: string;
  quoteLink: string;
  tone: 'warm' | 'professional' | 'urgent';
  lastDraftedAt: string;
}

export interface WorkerRun {
  id: string;
  worker: 'vision' | 'scoping' | 'reply' | 'research' | 'pricing' | 'message';
  model: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  changes: string[];     // Fields modified
  error: string | null;
  tokenUsage: { input: number; output: number } | null;
}

export interface BenEdit {
  id: string;
  field: string;         // JSON path, e.g., "scope.lines[0].title"
  before: any;
  after: any;
  editedAt: string;
  quoteId: string | null;
}

export interface Blocker {
  type: 'decline_trade' | 'needs_visit' | 'needs_ben_decision' | 'customer_unresponsive';
  reason: string;
  createdAt: string;
}
```

### Task 1.2: Database Migration

**File:** `migrations/XXXX_conversation_memory.ts`

```typescript
import { pgTable, text, jsonb, integer, timestamp, index } from 'drizzle-orm/pg-core';

export const conversationMemory = pgTable('conversation_memory', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().unique(),
  version: integer('version').notNull().default(1),

  messages: jsonb('messages').notNull().default([]),
  media: jsonb('media').notNull().default([]),
  calls: jsonb('calls').notNull().default([]),

  mediaExtractions: jsonb('media_extractions').notNull().default([]),
  scope: jsonb('scope'),
  research: jsonb('research'),
  pricing: jsonb('pricing'),
  draft: jsonb('draft'),

  readiness: text('readiness').notNull().default('new'),
  blockers: jsonb('blockers').notNull().default([]),

  workerRuns: jsonb('worker_runs').notNull().default([]),
  benEdits: jsonb('ben_edits').notNull().default([]),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  conversationIdx: index('memory_conversation_idx').on(table.conversationId),
  readinessIdx: index('memory_readiness_idx').on(table.readiness),
}));
```

### Task 1.3: Memory Access Functions

**File:** `server/memory/index.ts`

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { conversationMemory } from '@shared/schema';
import type { ConversationMemory, WorkerRun, BenEdit } from '@shared/conversation-memory';

export async function getOrCreateMemory(conversationId: string): Promise<ConversationMemory> {
  const [existing] = await db.select()
    .from(conversationMemory)
    .where(eq(conversationMemory.conversationId, conversationId));

  if (existing) {
    return existing as ConversationMemory;
  }

  const id = crypto.randomUUID();
  const [created] = await db.insert(conversationMemory)
    .values({ id, conversationId })
    .returning();

  return created as ConversationMemory;
}

export async function updateMemory(
  conversationId: string,
  updates: Partial<ConversationMemory>,
  expectedVersion: number
): Promise<ConversationMemory> {
  const [updated] = await db.update(conversationMemory)
    .set({
      ...updates,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(conversationMemory.conversationId, conversationId))
    .returning();

  if (!updated) {
    throw new Error('Memory not found or version conflict');
  }

  return updated as ConversationMemory;
}

export async function appendWorkerRun(
  conversationId: string,
  run: WorkerRun
): Promise<void> {
  const memory = await getOrCreateMemory(conversationId);
  await updateMemory(conversationId, {
    workerRuns: [...memory.workerRuns, run],
  }, memory.version);
}

export async function appendBenEdit(
  conversationId: string,
  edit: BenEdit
): Promise<void> {
  const memory = await getOrCreateMemory(conversationId);
  await updateMemory(conversationId, {
    benEdits: [...memory.benEdits, edit],
  }, memory.version);
}
```

---

## WORKSTREAM 2: OpenRouter Integration

### Task 2.1: OpenRouter Client

**File:** `server/llm/openrouter.ts`

```typescript
import OpenAI from 'openai';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY is required');
}

export const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    'X-Title': 'V6-Switchboard',
    'HTTP-Referer': 'https://handyservices.app',
  },
});

// Model identifiers
export const MODELS = {
  // Vision — best accuracy on photos
  vision: 'google/gemini-flash-1.5',

  // Conversation — natural, human-like tone
  conversation: 'openai/gpt-4o',

  // Extraction — structured output, low hallucination
  extraction: 'anthropic/claude-sonnet-4',

  // Validation — complex reasoning, edge cases
  validation: 'anthropic/claude-opus-4',

  // Fallbacks
  fallback_vision: 'openai/gpt-4o',
  fallback_conversation: 'anthropic/claude-sonnet-4',
} as const;

export type ModelRole = keyof typeof MODELS;

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
}

export async function callLLM(
  role: ModelRole,
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  }
): Promise<LLMResponse> {
  const model = MODELS[role];
  const start = Date.now();

  try {
    const response = await openrouter.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      response_format: options?.jsonMode ? { type: 'json_object' } : undefined,
    });

    return {
      content: response.choices[0]?.message?.content ?? '',
      model: response.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      durationMs: Date.now() - start,
    };
  } catch (error) {
    // Try fallback for critical roles
    if (role === 'vision' && MODELS.fallback_vision) {
      console.warn(`[LLM] ${model} failed, trying fallback`);
      return callLLM('fallback_vision' as ModelRole, messages, options);
    }
    throw error;
  }
}

export async function callLLMWithImages(
  role: ModelRole,
  systemPrompt: string,
  images: Array<{ base64: string; mediaType: string }>,
  userPrompt: string,
  options?: { jsonMode?: boolean }
): Promise<LLMResponse> {
  const imageContent: OpenAI.ChatCompletionContentPart[] = images.map(img => ({
    type: 'image_url',
    image_url: {
      url: `data:${img.mediaType};base64,${img.base64}`,
      detail: 'high',
    },
  }));

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        ...imageContent,
        { type: 'text', text: userPrompt },
      ],
    },
  ];

  return callLLM(role, messages, options);
}
```

### Task 2.2: Model Router

**File:** `server/llm/router.ts`

```typescript
import { MODELS, callLLM, callLLMWithImages, type ModelRole, type LLMResponse } from './openrouter';
import type { ConversationMemory } from '@shared/conversation-memory';

export interface RoutingContext {
  memory: ConversationMemory;
  task: 'vision' | 'reply' | 'scope' | 'research' | 'pricing' | 'message' | 'validation';
  complexity?: 'simple' | 'complex';
}

export function selectModel(context: RoutingContext): ModelRole {
  const { task, complexity, memory } = context;

  switch (task) {
    case 'vision':
      return 'vision';

    case 'reply':
      return 'conversation';

    case 'scope':
    case 'research':
    case 'pricing':
    case 'message':
      return 'extraction';

    case 'validation':
      // Use Opus for complex jobs
      if (complexity === 'complex') return 'validation';
      if ((memory.scope?.lines.length ?? 0) > 3) return 'validation';
      if ((memory.pricing?.totalPence ?? 0) > 50000) return 'validation'; // > £500
      return 'extraction';

    default:
      return 'extraction';
  }
}

export async function routedLLMCall(
  context: RoutingContext,
  messages: any[],
  options?: any
): Promise<LLMResponse> {
  const role = selectModel(context);
  console.log(`[Router] Task: ${context.task}, Model: ${MODELS[role]}`);
  return callLLM(role, messages, options);
}
```

---

## WORKSTREAM 3: Vision Worker (Gemini)

### Task 3.1: Structured Extraction Prompt

**File:** `server/workers/vision.ts`

```typescript
import { callLLMWithImages } from '../llm/openrouter';
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type { MediaExtraction, ExtractedItem, ExtractedDefect } from '@shared/conversation-memory';
import { toBase64Image } from '../agents/media-context';

const VISION_SYSTEM_PROMPT = `You are a trade expert analyzing photos for a handyman quoting system.

Extract STRUCTURED information from the image. Be specific and accurate.

OUTPUT FORMAT (JSON):
{
  "items": [
    {
      "type": "tap | pipe | sink | toilet | door | fence | wall | floor | ceiling | other",
      "material": "chrome | brass | copper | plastic | wood | metal | other",
      "condition": "good | worn | damaged | leaking | corroded | broken",
      "location": "where in the property",
      "confidence": "high | medium | low"
    }
  ],
  "defects": [
    {
      "type": "leak | crack | corrosion | rot | missing | broken | worn | other",
      "severity": "minor | moderate | major",
      "description": "specific description of the defect",
      "itemRef": "which item this affects"
    }
  ],
  "textFound": ["any visible text, brand names, model numbers"],
  "whatIsShown": "one sentence describing what's actually in the photo",
  "whatIsMissing": "if customer asked about X but photo shows Y, note what's missing"
}

CRITICAL RULES:
1. Only describe what you ACTUALLY SEE, not what you assume
2. If the photo doesn't show what was requested, say so in "whatIsMissing"
3. Brand names and model numbers are valuable — always extract them
4. Note access issues (tight spaces, heights, obstructions)
5. Confidence should be "low" if image is blurry or item is partially visible`;

export interface VisionWorkerInput {
  conversationId: string;
  mediaId: string;
  mediaPath: string;
  mediaType: 'image/jpeg' | 'image/png' | 'video/mp4';
  customerContext?: string;  // What did customer say about this photo?
}

export interface VisionWorkerOutput {
  extraction: MediaExtraction;
  workerRun: {
    durationMs: number;
    tokenUsage: { input: number; output: number };
  };
}

export async function runVisionWorker(input: VisionWorkerInput): Promise<VisionWorkerOutput> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  // Load image as base64
  const imageData = await toBase64Image(input.mediaPath);
  if (!imageData) {
    throw new Error(`Failed to load image: ${input.mediaPath}`);
  }

  const userPrompt = input.customerContext
    ? `Customer said: "${input.customerContext}"\n\nAnalyze this photo and extract structured information.`
    : 'Analyze this photo and extract structured information for a handyman quote.';

  const response = await callLLMWithImages(
    'vision',
    VISION_SYSTEM_PROMPT,
    [{ base64: imageData.base64, mediaType: imageData.mediaType }],
    userPrompt,
    { jsonMode: true }
  );

  const parsed = JSON.parse(response.content);

  const extraction: MediaExtraction = {
    mediaId: input.mediaId,
    model: 'gemini-flash',
    extractedAt: new Date().toISOString(),
    items: parsed.items ?? [],
    defects: parsed.defects ?? [],
    textFound: parsed.textFound ?? [],
    confidence: calculateConfidence(parsed),
    raw: response.content,
  };

  // Update memory
  const memory = await getOrCreateMemory(input.conversationId);
  const existingExtractions = memory.mediaExtractions.filter(e => e.mediaId !== input.mediaId);

  await updateMemory(input.conversationId, {
    mediaExtractions: [...existingExtractions, extraction],
    readiness: memory.readiness === 'new' ? 'extracting_media' : memory.readiness,
  }, memory.version);

  // Log worker run
  await appendWorkerRun(input.conversationId, {
    id: runId,
    worker: 'vision',
    model: response.model,
    trigger: 'media_received',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: response.durationMs,
    changes: [`mediaExtractions[${input.mediaId}]`],
    error: null,
    tokenUsage: response.usage,
  });

  return {
    extraction,
    workerRun: {
      durationMs: response.durationMs,
      tokenUsage: response.usage,
    },
  };
}

function calculateConfidence(parsed: any): number {
  const items = parsed.items ?? [];
  if (items.length === 0) return 0.3;

  const highConfidence = items.filter((i: any) => i.confidence === 'high').length;
  return 0.3 + (0.7 * (highConfidence / items.length));
}
```

---

## WORKSTREAM 4: Conversation Worker (GPT-4o)

### Task 4.1: Tone-Aware Reply Worker

**File:** `server/workers/reply.ts`

```typescript
import { callLLM } from '../llm/openrouter';
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type { ConversationMemory, ScopeGap } from '@shared/conversation-memory';

const REPLY_SYSTEM_PROMPT = `You are a friendly, professional handyman service representative.

Your job is to write warm, human replies that:
1. Show you've understood what the customer needs
2. Reference their specific situation (use their words)
3. Ask ONE question if needed (never more)
4. Match their energy/tone

TONE ADAPTATION:
- urgent: Be reassuring, move fast, acknowledge urgency
- anxious: Be patient, explain what happens next
- relaxed: Be friendly, conversational
- price_sensitive: Lead with value, explain what's included
- detailed: Match their detail level
- terse: Keep it short, no fluff

RULES:
- NEVER mention prices, costs, or money
- NEVER commit to dates or times
- NEVER make promises you can't keep
- DO reflect back what they said to show understanding
- DO ask smart, job-specific questions (not generic)

OUTPUT FORMAT (JSON):
{
  "reply": "the message to send",
  "reasoning": "why this reply works for this customer",
  "questionsAsked": ["list of questions in this reply"]
}`;

export interface ReplyWorkerInput {
  conversationId: string;
  trigger: 'inbound_message' | 'gaps_identified' | 'sla_chase';
  gapsToAsk?: ScopeGap[];
}

export interface ReplyWorkerOutput {
  reply: string;
  questionsAsked: string[];
}

export async function runReplyWorker(input: ReplyWorkerInput): Promise<ReplyWorkerOutput> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  const memory = await getOrCreateMemory(input.conversationId);

  // Build context from memory
  const context = buildReplyContext(memory, input);

  const response = await callLLM('conversation', [
    { role: 'system', content: REPLY_SYSTEM_PROMPT },
    { role: 'user', content: context },
  ], { jsonMode: true });

  const parsed = JSON.parse(response.content);

  // Mark gaps as asked
  if (input.gapsToAsk?.length) {
    const updatedGaps = memory.scope?.gaps.map(gap => {
      const wasAsked = input.gapsToAsk?.some(g => g.id === gap.id);
      return wasAsked ? { ...gap, asked: true, askedAt: new Date().toISOString() } : gap;
    });

    if (memory.scope && updatedGaps) {
      await updateMemory(input.conversationId, {
        scope: { ...memory.scope, gaps: updatedGaps },
      }, memory.version);
    }
  }

  // Log worker run
  await appendWorkerRun(input.conversationId, {
    id: runId,
    worker: 'reply',
    model: response.model,
    trigger: input.trigger,
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: response.durationMs,
    changes: input.gapsToAsk?.length ? ['scope.gaps[].asked'] : [],
    error: null,
    tokenUsage: response.usage,
  });

  return {
    reply: parsed.reply,
    questionsAsked: parsed.questionsAsked ?? [],
  };
}

function buildReplyContext(memory: ConversationMemory, input: ReplyWorkerInput): string {
  const parts: string[] = [];

  // Customer info
  if (memory.scope) {
    parts.push(`CUSTOMER: ${memory.scope.customerName ?? 'Unknown'}`);
    parts.push(`TONE: ${memory.scope.tone}`);
    parts.push(`TYPE: ${memory.scope.customerType}`);
  }

  // Recent messages
  const recentMessages = memory.messages.slice(-10);
  parts.push('\nRECENT CONVERSATION:');
  recentMessages.forEach(m => {
    const direction = m.direction === 'inbound' ? 'CUSTOMER' : 'US';
    parts.push(`${direction}: ${m.content}`);
  });

  // What we know from photos
  if (memory.mediaExtractions.length > 0) {
    parts.push('\nFROM PHOTOS:');
    memory.mediaExtractions.forEach(ext => {
      ext.items.forEach(item => {
        parts.push(`- ${item.type} (${item.material}, ${item.condition}) at ${item.location}`);
      });
      ext.defects.forEach(def => {
        parts.push(`- DEFECT: ${def.severity} ${def.type} — ${def.description}`);
      });
    });
  }

  // Gaps to ask
  if (input.gapsToAsk?.length) {
    parts.push('\nQUESTIONS TO ASK (work these in naturally):');
    input.gapsToAsk.forEach(gap => {
      parts.push(`- ${gap.question} (impact: ${gap.impact})`);
    });
  }

  // Job lines if we have them
  if (memory.scope?.lines.length) {
    parts.push('\nJOB LINES WE\'VE IDENTIFIED:');
    memory.scope.lines.forEach((line, i) => {
      parts.push(`${i + 1}. ${line.title}`);
      parts.push(`   Customer said: "${line.customerWords}"`);
    });
  }

  parts.push('\nWrite a reply that shows understanding and moves the conversation forward.');

  return parts.join('\n');
}
```

---

## WORKSTREAM 5: Scoping Worker

### Task 5.1: Scoping Worker (Claude Sonnet)

**File:** `server/workers/scoping.ts`

```typescript
import { callLLM } from '../llm/openrouter';
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type { ConversationMemory, ConversationScope, ScopeLine, ScopeGap } from '@shared/conversation-memory';

const SCOPING_SYSTEM_PROMPT = `You are a quote intake clerk for a handyman service.

Analyze the conversation and photos to extract:
1. What job(s) the customer needs
2. Key details from photos (use the structured extractions provided)
3. What assumptions we're making
4. What questions we still need answered

CRITICAL: Use the customer's own words in your output. This helps us write human-like replies.

RULES:
- Max 60 characters for line titles
- Split multi-part jobs into separate lines
- Note assumptions with confidence level
- Only flag gaps that would meaningfully change the price
- Detect customer tone from their message style

OUTPUT FORMAT (JSON):
{
  "customerName": "string or null",
  "customerType": "homeowner | landlord | letting_agent | business",
  "tone": "urgent | anxious | relaxed | price_sensitive | detailed | terse",
  "lines": [
    {
      "id": "uuid",
      "title": "customer-facing title, max 60 chars",
      "detail": "internal notes with evidence",
      "customerWords": "exact quote from customer about this",
      "assumptions": [
        { "text": "assumption", "confidence": "observed | inferred | assumed", "source": "photo | customer_said | typical_for_job" }
      ]
    }
  ],
  "gaps": [
    {
      "id": "uuid",
      "question": "what to ask, ending in ?",
      "audience": "customer | ben",
      "lineId": "which line this relates to, or null",
      "impact": "none | small | large | forks_job"
    }
  ],
  "readiness": "quote_ready | needs_info | visit_first | decline",
  "declineReason": "gas_work | roofing_height | structural | major_electrical | null"
}`;

export interface ScopingWorkerInput {
  conversationId: string;
  trigger: 'message_received' | 'media_extracted' | 'gap_answered';
}

export async function runScopingWorker(input: ScopingWorkerInput): Promise<ConversationScope> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  const memory = await getOrCreateMemory(input.conversationId);

  // Build context
  const context = buildScopingContext(memory);

  const response = await callLLM('extraction', [
    { role: 'system', content: SCOPING_SYSTEM_PROMPT },
    { role: 'user', content: context },
  ], { jsonMode: true });

  const parsed = JSON.parse(response.content);

  const scope: ConversationScope = {
    customerName: parsed.customerName,
    phone: memory.messages[0]?.phone ?? '',
    postcode: extractPostcode(memory.messages),
    customerType: parsed.customerType,
    tone: parsed.tone,
    lines: parsed.lines.map((line: any) => ({
      ...line,
      id: line.id ?? crypto.randomUUID(),
      evidence: {
        messageIds: [],
        mediaIds: memory.mediaExtractions.map(e => e.mediaId),
        callIds: [],
      },
    })),
    assumptions: parsed.lines.flatMap((l: any) => l.assumptions ?? []),
    gaps: parsed.gaps.map((gap: any) => ({
      ...gap,
      id: gap.id ?? crypto.randomUUID(),
      asked: false,
      askedAt: null,
      answered: false,
      answeredAt: null,
      answer: null,
    })),
    lastScopedAt: new Date().toISOString(),
  };

  // Determine readiness
  const customerGaps = scope.gaps.filter(g => g.audience === 'customer' && !g.answered);
  const readiness = customerGaps.length > 0 ? 'gathering' :
                    parsed.readiness === 'decline' ? 'needs_human' :
                    parsed.readiness === 'visit_first' ? 'needs_human' :
                    'scoped';

  await updateMemory(input.conversationId, {
    scope,
    readiness,
    blockers: parsed.declineReason ? [{
      type: 'decline_trade',
      reason: parsed.declineReason,
      createdAt: new Date().toISOString(),
    }] : memory.blockers,
  }, memory.version);

  // Log worker run
  await appendWorkerRun(input.conversationId, {
    id: runId,
    worker: 'scoping',
    model: response.model,
    trigger: input.trigger,
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: response.durationMs,
    changes: ['scope', 'readiness'],
    error: null,
    tokenUsage: response.usage,
  });

  return scope;
}

function buildScopingContext(memory: ConversationMemory): string {
  const parts: string[] = [];

  // All messages
  parts.push('CONVERSATION:');
  memory.messages.forEach(m => {
    const direction = m.direction === 'inbound' ? 'CUSTOMER' : 'US';
    parts.push(`[${m.createdAt}] ${direction}: ${m.content}`);
  });

  // Photo extractions
  if (memory.mediaExtractions.length > 0) {
    parts.push('\nPHOTO ANALYSIS (from vision model):');
    memory.mediaExtractions.forEach((ext, i) => {
      parts.push(`\nPhoto ${i + 1}:`);
      parts.push(`Items: ${JSON.stringify(ext.items)}`);
      parts.push(`Defects: ${JSON.stringify(ext.defects)}`);
      if (ext.textFound.length) {
        parts.push(`Text found: ${ext.textFound.join(', ')}`);
      }
    });
  }

  // Previous scope if exists
  if (memory.scope) {
    parts.push('\nPREVIOUS SCOPE (update if new info):');
    parts.push(JSON.stringify(memory.scope, null, 2));
  }

  parts.push('\nExtract the job scope from this conversation.');

  return parts.join('\n');
}

function extractPostcode(messages: any[]): string | null {
  const postcodeRegex = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
  for (const msg of messages) {
    const match = msg.content?.match(postcodeRegex);
    if (match) return match[1].toUpperCase();
  }
  return null;
}
```

---

## WORKSTREAM 6: Research & Pricing Workers

### Task 6.1: Research Worker

**File:** `server/workers/research.ts`

```typescript
import { callLLM } from '../llm/openrouter';
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type { ConversationResearch, ResearchedLine } from '@shared/conversation-memory';

const RESEARCH_SYSTEM_PROMPT = `You are a materials and time estimation expert for a handyman service.

For each job line, research:
1. Materials needed (name, quantity, approximate price)
2. Time estimate (minutes, with reasoning)
3. Procedure (step-by-step work breakdown)

Use realistic UK prices. When uncertain, note "needs review".

OUTPUT FORMAT (JSON):
{
  "lines": [
    {
      "lineId": "matches input line ID",
      "materials": [
        { "name": "15mm compression fitting", "quantity": 2, "unitPricePence": 350, "supplier": "screwfix", "confidence": "high", "needsReview": false }
      ],
      "timeEstimate": { "minutes": 45, "confidence": "medium", "basis": "standard tap replacement", "reasoning": "Standard mono mixer, good access" },
      "procedure": ["Isolate water supply", "Disconnect old tap", "Clean connections", "Fit new tap", "Test for leaks"]
    }
  ],
  "historicalMatches": [
    { "jobId": "if we have similar past jobs", "similarity": 0.85, "price": 12500, "notes": "similar tap replacement in kitchen" }
  ]
}`;

export async function runResearchWorker(conversationId: string): Promise<ConversationResearch> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  const memory = await getOrCreateMemory(conversationId);

  if (!memory.scope?.lines.length) {
    throw new Error('No scope lines to research');
  }

  // Update readiness
  await updateMemory(conversationId, { readiness: 'researching' }, memory.version);

  const context = buildResearchContext(memory);

  const response = await callLLM('extraction', [
    { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
    { role: 'user', content: context },
  ], { jsonMode: true });

  const parsed = JSON.parse(response.content);

  const research: ConversationResearch = {
    lines: parsed.lines,
    historicalMatches: parsed.historicalMatches ?? [],
    lastResearchedAt: new Date().toISOString(),
  };

  const updatedMemory = await getOrCreateMemory(conversationId);
  await updateMemory(conversationId, {
    research,
    readiness: 'researched',
  }, updatedMemory.version);

  await appendWorkerRun(conversationId, {
    id: runId,
    worker: 'research',
    model: response.model,
    trigger: 'scope_complete',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: response.durationMs,
    changes: ['research', 'readiness'],
    error: null,
    tokenUsage: response.usage,
  });

  return research;
}

function buildResearchContext(memory: ConversationMemory): string {
  const parts: string[] = [];

  parts.push('JOB LINES TO RESEARCH:');
  memory.scope!.lines.forEach((line, i) => {
    parts.push(`\n${i + 1}. ${line.title}`);
    parts.push(`   Detail: ${line.detail}`);
    parts.push(`   Assumptions: ${line.assumptions.map(a => a.text).join('; ')}`);
  });

  // Include photo extractions for material identification
  if (memory.mediaExtractions.length > 0) {
    parts.push('\nFROM PHOTOS:');
    memory.mediaExtractions.forEach(ext => {
      ext.items.forEach(item => {
        parts.push(`- ${item.type}: ${item.material}, ${item.condition}`);
      });
    });
  }

  parts.push('\nResearch materials, time, and procedure for each line.');

  return parts.join('\n');
}
```

### Task 6.2: Pricing Worker

**File:** `server/workers/pricing.ts`

```typescript
import { getOrCreateMemory, updateMemory, appendWorkerRun } from '../memory';
import type { ConversationPricing, PricedLine } from '@shared/conversation-memory';

// Labour rates
const LABOUR_RATE_PENCE_PER_HOUR = 4500;  // £45/hour
const MIN_CALL_OUT_PENCE = 7500;           // £75 minimum
const VAT_RATE = 0.2;
const TARGET_MARGIN = 0.35;

export async function runPricingWorker(conversationId: string): Promise<ConversationPricing> {
  const start = Date.now();
  const runId = crypto.randomUUID();

  const memory = await getOrCreateMemory(conversationId);

  if (!memory.research?.lines.length) {
    throw new Error('No research to price');
  }

  // Update readiness
  await updateMemory(conversationId, { readiness: 'pricing' }, memory.version);

  const pricedLines: PricedLine[] = memory.research.lines.map(researchLine => {
    const labourPence = Math.round((researchLine.timeEstimate.minutes / 60) * LABOUR_RATE_PENCE_PER_HOUR);
    const materialsPence = researchLine.materials.reduce((sum, m) => sum + (m.unitPricePence * m.quantity), 0);

    return {
      lineId: researchLine.lineId,
      labourPence,
      materialsPence,
      totalPence: labourPence + materialsPence,
    };
  });

  const labourPence = pricedLines.reduce((sum, l) => sum + l.labourPence, 0);
  const materialsPence = pricedLines.reduce((sum, l) => sum + l.materialsPence, 0);
  const subtotalPence = Math.max(labourPence + materialsPence, MIN_CALL_OUT_PENCE);
  const vatPence = Math.round(subtotalPence * VAT_RATE);
  const totalPence = subtotalPence + vatPence;
  const margin = subtotalPence > 0 ? (labourPence / subtotalPence) : 0;

  const pricing: ConversationPricing = {
    lines: pricedLines,
    labourPence,
    materialsPence,
    subtotalPence,
    vatPence,
    totalPence,
    margin,
    lastPricedAt: new Date().toISOString(),
  };

  const updatedMemory = await getOrCreateMemory(conversationId);
  await updateMemory(conversationId, {
    pricing,
    readiness: 'priced',
  }, updatedMemory.version);

  await appendWorkerRun(conversationId, {
    id: runId,
    worker: 'pricing',
    model: 'rules-based',
    trigger: 'research_complete',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    changes: ['pricing', 'readiness'],
    error: null,
    tokenUsage: null,
  });

  return pricing;
}
```

---

## WORKSTREAM 7: Ben's Unified UI

### Task 7.1: Memory Panel Component

**File:** `client/src/components/memory/MemoryPanel.tsx`

```typescript
// Unified view of ConversationMemory for Ben
// Shows: scope + research + pricing + draft in one panel
// Tracks all edits for learning

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ConversationMemory, BenEdit } from '@shared/conversation-memory';

interface MemoryPanelProps {
  conversationId: string;
  onSend: () => void;
}

export function MemoryPanel({ conversationId, onSend }: MemoryPanelProps) {
  const { data: memory, refetch } = useQuery<ConversationMemory>({
    queryKey: ['memory', conversationId],
    queryFn: () => fetch(`/api/memory/${conversationId}`).then(r => r.json()),
  });

  const trackEdit = useMutation({
    mutationFn: (edit: Omit<BenEdit, 'id' | 'editedAt'>) =>
      fetch(`/api/memory/${conversationId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      }),
  });

  const handleFieldEdit = useCallback((field: string, before: any, after: any) => {
    trackEdit.mutate({ field, before, after, quoteId: null });
  }, [trackEdit]);

  if (!memory) return <div>Loading...</div>;

  return (
    <div className="space-y-4 p-4">
      {/* Readiness Badge */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Quote Builder</h2>
        <Badge variant={memory.readiness === 'ready_for_ben' ? 'default' : 'secondary'}>
          {memory.readiness}
        </Badge>
      </div>

      {/* Customer Info */}
      <Card>
        <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
        <CardContent>
          <p><strong>Name:</strong> {memory.scope?.customerName ?? 'Unknown'}</p>
          <p><strong>Type:</strong> {memory.scope?.customerType}</p>
          <p><strong>Tone:</strong> {memory.scope?.tone}</p>
          <p><strong>Postcode:</strong> {memory.scope?.postcode ?? 'Not provided'}</p>
        </CardContent>
      </Card>

      {/* Photo Extractions */}
      {memory.mediaExtractions.length > 0 && (
        <Card>
          <CardHeader><CardTitle>From Photos</CardTitle></CardHeader>
          <CardContent>
            {memory.mediaExtractions.map((ext, i) => (
              <div key={ext.mediaId} className="mb-2">
                <p className="font-medium">Photo {i + 1}</p>
                <ul className="list-disc ml-4 text-sm">
                  {ext.items.map((item, j) => (
                    <li key={j}>
                      {item.type} ({item.material}, {item.condition}) — {item.location}
                      <Badge variant="outline" className="ml-2">{item.confidence}</Badge>
                    </li>
                  ))}
                  {ext.defects.map((def, j) => (
                    <li key={`d${j}`} className="text-red-600">
                      {def.severity} {def.type}: {def.description}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Job Lines with Research & Pricing */}
      <Card>
        <CardHeader><CardTitle>Job Lines</CardTitle></CardHeader>
        <CardContent>
          {memory.scope?.lines.map((line, i) => {
            const research = memory.research?.lines.find(r => r.lineId === line.id);
            const pricing = memory.pricing?.lines.find(p => p.lineId === line.id);

            return (
              <div key={line.id} className="border-b pb-4 mb-4">
                <div className="flex justify-between">
                  <EditableField
                    value={line.title}
                    field={`scope.lines[${i}].title`}
                    onEdit={handleFieldEdit}
                  />
                  {pricing && (
                    <span className="font-bold">£{(pricing.totalPence / 100).toFixed(2)}</span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  Customer said: "{line.customerWords}"
                </p>
                <div className="text-sm mt-2">
                  <strong>Assumptions:</strong>
                  <ul className="list-disc ml-4">
                    {line.assumptions.map((a, j) => (
                      <li key={j}>
                        {a.text}
                        <Badge variant="outline" className="ml-1">{a.confidence}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
                {research && (
                  <div className="text-sm mt-2">
                    <strong>Materials:</strong>
                    <ul className="list-disc ml-4">
                      {research.materials.map((m, j) => (
                        <li key={j}>
                          {m.name} × {m.quantity} @ £{(m.unitPricePence / 100).toFixed(2)}
                          {m.needsReview && <Badge variant="destructive" className="ml-1">Review</Badge>}
                        </li>
                      ))}
                    </ul>
                    <strong>Time:</strong> {research.timeEstimate.minutes} mins ({research.timeEstimate.reasoning})
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Pricing Summary */}
      {memory.pricing && (
        <Card>
          <CardHeader><CardTitle>Pricing</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <span>Labour:</span>
              <span className="text-right">£{(memory.pricing.labourPence / 100).toFixed(2)}</span>
              <span>Materials:</span>
              <span className="text-right">£{(memory.pricing.materialsPence / 100).toFixed(2)}</span>
              <span>Subtotal:</span>
              <span className="text-right">£{(memory.pricing.subtotalPence / 100).toFixed(2)}</span>
              <span>VAT:</span>
              <span className="text-right">£{(memory.pricing.vatPence / 100).toFixed(2)}</span>
              <span className="font-bold">Total:</span>
              <span className="text-right font-bold">£{(memory.pricing.totalPence / 100).toFixed(2)}</span>
              <span>Margin:</span>
              <span className="text-right">{(memory.pricing.margin * 100).toFixed(0)}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Draft Message */}
      {memory.draft && (
        <Card>
          <CardHeader><CardTitle>Message to Customer</CardTitle></CardHeader>
          <CardContent>
            <EditableTextarea
              value={memory.draft.message}
              field="draft.message"
              onEdit={handleFieldEdit}
            />
          </CardContent>
        </Card>
      )}

      {/* Worker Audit Trail */}
      <Card>
        <CardHeader><CardTitle>Processing History</CardTitle></CardHeader>
        <CardContent>
          <div className="text-xs space-y-1">
            {memory.workerRuns.map(run => (
              <div key={run.id} className="flex justify-between">
                <span>
                  {run.worker} ({run.model})
                </span>
                <span>
                  {run.durationMs}ms • {run.tokenUsage?.input ?? 0}+{run.tokenUsage?.output ?? 0} tokens
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
        <Button onClick={onSend} disabled={memory.readiness !== 'ready_for_ben'}>
          Send Quote
        </Button>
      </div>
    </div>
  );
}

// Helper components
function EditableField({ value, field, onEdit }: { value: string; field: string; onEdit: (field: string, before: any, after: any) => void }) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  const save = () => {
    if (localValue !== value) {
      onEdit(field, value, localValue);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => e.key === 'Enter' && save()}
        className="border px-2 py-1 rounded"
        autoFocus
      />
    );
  }

  return (
    <span onClick={() => setEditing(true)} className="cursor-pointer hover:bg-gray-100 px-1 rounded">
      {value}
    </span>
  );
}

function EditableTextarea({ value, field, onEdit }: { value: string; field: string; onEdit: (field: string, before: any, after: any) => void }) {
  const [localValue, setLocalValue] = useState(value);

  const handleBlur = () => {
    if (localValue !== value) {
      onEdit(field, value, localValue);
    }
  };

  return (
    <textarea
      value={localValue}
      onChange={e => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      className="w-full h-32 border rounded p-2"
    />
  );
}
```

---

## WORKSTREAM 8: Edit Tracking & Learning

### Task 8.1: Edit Tracker

**File:** `server/learning/edit-tracker.ts`

```typescript
import { db } from '../db';
import { eq, desc, sql } from 'drizzle-orm';
import { conversationMemory } from '@shared/schema';
import type { BenEdit } from '@shared/conversation-memory';

export interface EditPattern {
  field: string;
  beforePattern: string;
  afterPattern: string;
  frequency: number;
  lastSeen: string;
}

export async function getEditPatterns(minFrequency = 3): Promise<EditPattern[]> {
  // Query all memories and aggregate edit patterns
  const memories = await db.select({
    benEdits: conversationMemory.benEdits,
  }).from(conversationMemory);

  const patternMap = new Map<string, EditPattern>();

  memories.forEach(m => {
    const edits = m.benEdits as BenEdit[];
    edits.forEach(edit => {
      const key = `${edit.field}:${JSON.stringify(edit.before)}:${JSON.stringify(edit.after)}`;
      const existing = patternMap.get(key);

      if (existing) {
        existing.frequency++;
        existing.lastSeen = edit.editedAt;
      } else {
        patternMap.set(key, {
          field: edit.field,
          beforePattern: JSON.stringify(edit.before),
          afterPattern: JSON.stringify(edit.after),
          frequency: 1,
          lastSeen: edit.editedAt,
        });
      }
    });
  });

  return Array.from(patternMap.values())
    .filter(p => p.frequency >= minFrequency)
    .sort((a, b) => b.frequency - a.frequency);
}

export async function getFieldEditRate(): Promise<Record<string, number>> {
  const memories = await db.select({
    benEdits: conversationMemory.benEdits,
  }).from(conversationMemory);

  const fieldCounts: Record<string, number> = {};
  let totalMemories = 0;

  memories.forEach(m => {
    totalMemories++;
    const edits = m.benEdits as BenEdit[];
    const fieldsEdited = new Set(edits.map(e => e.field.split('[')[0])); // Group by base field

    fieldsEdited.forEach(field => {
      fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
    });
  });

  // Convert to rates
  const rates: Record<string, number> = {};
  Object.entries(fieldCounts).forEach(([field, count]) => {
    rates[field] = count / totalMemories;
  });

  return rates;
}

export async function suggestAutoCorrections(memory: any): Promise<Array<{ field: string; suggested: any; reason: string }>> {
  const patterns = await getEditPatterns(5); // Only high-frequency patterns
  const suggestions: Array<{ field: string; suggested: any; reason: string }> = [];

  // Check if any patterns match current memory state
  patterns.forEach(pattern => {
    const currentValue = getFieldValue(memory, pattern.field);
    if (JSON.stringify(currentValue) === pattern.beforePattern) {
      suggestions.push({
        field: pattern.field,
        suggested: JSON.parse(pattern.afterPattern),
        reason: `Ben changed this ${pattern.frequency} times before`,
      });
    }
  });

  return suggestions;
}

function getFieldValue(obj: any, path: string): any {
  const parts = path.split(/[.\[\]]/).filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}
```

### Task 8.2: Learning Analytics Dashboard

**File:** `server/learning/analytics.ts`

```typescript
import { getEditPatterns, getFieldEditRate } from './edit-tracker';

export interface LearningReport {
  totalQuotes: number;
  editRate: number;  // % of quotes Ben edited
  topEditedFields: Array<{ field: string; rate: number }>;
  autoCorrectCandidates: Array<{ pattern: string; frequency: number; confidence: number }>;
  recommendations: string[];
}

export async function generateLearningReport(): Promise<LearningReport> {
  const fieldRates = await getFieldEditRate();
  const patterns = await getEditPatterns(3);

  const topEditedFields = Object.entries(fieldRates)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([field, rate]) => ({ field, rate }));

  const autoCorrectCandidates = patterns
    .filter(p => p.frequency >= 5)
    .map(p => ({
      pattern: `${p.field}: ${p.beforePattern} → ${p.afterPattern}`,
      frequency: p.frequency,
      confidence: Math.min(p.frequency / 20, 1), // Max confidence at 20 occurrences
    }));

  const recommendations: string[] = [];

  // Generate recommendations
  topEditedFields.forEach(({ field, rate }) => {
    if (rate > 0.5) {
      recommendations.push(`Field "${field}" is edited ${(rate * 100).toFixed(0)}% of time — consider improving extraction prompt`);
    }
  });

  autoCorrectCandidates.forEach(c => {
    if (c.confidence > 0.8) {
      recommendations.push(`Pattern "${c.pattern}" has high confidence (${(c.confidence * 100).toFixed(0)}%) — candidate for auto-correction`);
    }
  });

  return {
    totalQuotes: Object.keys(fieldRates).length > 0 ? 1 : 0, // Placeholder
    editRate: topEditedFields.reduce((sum, f) => sum + f.rate, 0) / Math.max(topEditedFields.length, 1),
    topEditedFields,
    autoCorrectCandidates,
    recommendations,
  };
}
```

---

## Parallel Execution Plan (cmux)

### Pane Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                         PANE 1                                  │
│              WS1: Data Model & Memory                           │
│              WS5: Scoping Worker (after WS1)                    │
├────────────────────────────┬────────────────────────────────────┤
│          PANE 2            │            PANE 3                  │
│   WS2: OpenRouter          │    WS3: Vision Worker              │
│   WS6: Research/Pricing    │    WS7: Ben's UI                   │
├────────────────────────────┼────────────────────────────────────┤
│          PANE 4            │            PANE 5                  │
│   WS4: Conversation        │    COORDINATOR                     │
│   WS8: Edit Tracking       │    (this pane)                     │
└────────────────────────────┴────────────────────────────────────┘
```

### Execution Order

**Phase 1 (Parallel — no dependencies):**
- Pane 1: Start WS1 (Data Model)
- Pane 2: Start WS2 (OpenRouter)

**Phase 2 (Parallel — after Phase 1):**
- Pane 1: Start WS5 (Scoping Worker)
- Pane 2: Start WS6 (Research/Pricing)
- Pane 3: Start WS3 (Vision Worker)
- Pane 4: Start WS4 (Conversation Worker)

**Phase 3 (Parallel — after Phase 2):**
- Pane 3: Start WS7 (Ben's UI)
- Pane 4: Start WS8 (Edit Tracking)

**Phase 4 (Integration):**
- All panes: Integration testing
- Coordinator: End-to-end flow verification

---

## Task Prompts for Delegation

### Pane 1 Prompt
```
You are implementing WS1 (Data Model) and WS5 (Scoping Worker).

Read /docs/AGENT_FRAMEWORK_V2_PLAN.md for full context.

Tasks:
1. Create shared/conversation-memory.ts with all types
2. Create migration for conversation_memory table
3. Create server/memory/index.ts with access functions
4. After WS1 complete: Create server/workers/scoping.ts

Test each component before moving on.
```

### Pane 2 Prompt
```
You are implementing WS2 (OpenRouter) and WS6 (Research/Pricing Workers).

Read /docs/AGENT_FRAMEWORK_V2_PLAN.md for full context.

Tasks:
1. Create server/llm/openrouter.ts with unified client
2. Create server/llm/router.ts with model selection logic
3. After WS2 complete: Create server/workers/research.ts
4. After research: Create server/workers/pricing.ts

Test each component before moving on.
```

### Pane 3 Prompt
```
You are implementing WS3 (Vision Worker) and WS7 (Ben's UI).

Read /docs/AGENT_FRAMEWORK_V2_PLAN.md for full context.

Tasks:
1. Create server/workers/vision.ts with Gemini integration
2. Test vision extraction on sample photos
3. After WS3 complete: Create client/src/components/memory/MemoryPanel.tsx
4. Add edit tracking to all editable fields

Test each component before moving on.
```

### Pane 4 Prompt
```
You are implementing WS4 (Conversation Worker) and WS8 (Edit Tracking).

Read /docs/AGENT_FRAMEWORK_V2_PLAN.md for full context.

Tasks:
1. Create server/workers/reply.ts with GPT-4o integration
2. Implement tone detection and adaptation
3. After WS4 complete: Create server/learning/edit-tracker.ts
4. Create server/learning/analytics.ts

Test each component before moving on.
```

---

## Success Criteria

### Phase 1: Foundation
- [ ] ConversationMemory schema defined
- [ ] Database migration runs successfully
- [ ] OpenRouter client connects and routes correctly
- [ ] All models accessible via unified API

### Phase 2: Workers
- [ ] Vision worker extracts structured data from photos
- [ ] Scoping worker produces valid ConversationScope
- [ ] Reply worker generates tone-appropriate messages
- [ ] Research worker produces materials and time estimates
- [ ] Pricing worker calculates correct totals

### Phase 3: UI & Learning
- [ ] Ben can view unified memory panel
- [ ] All edits are tracked
- [ ] Edit patterns are aggregated
- [ ] Learning report generates recommendations

### Phase 4: Integration
- [ ] End-to-end flow: message → vision → scope → research → pricing → draft → send
- [ ] Ben's edits improve future suggestions
- [ ] System matches current accuracy with better UX

---

## Rollback Plan

If issues arise:
1. Memory table is additive — existing system unaffected
2. OpenRouter can be swapped back to direct APIs
3. Workers can be disabled individually
4. UI can fall back to existing QuotePrepPanel

---

## Timeline Estimate

| Phase | Duration | Parallel Agents |
|-------|----------|-----------------|
| Phase 1: Foundation | 1-2 days | 2 |
| Phase 2: Workers | 2-3 days | 4 |
| Phase 3: UI & Learning | 1-2 days | 2 |
| Phase 4: Integration | 1-2 days | All |
| **Total** | **5-9 days** | — |

---

*Plan created: August 2026*
*Version: 1.0*
