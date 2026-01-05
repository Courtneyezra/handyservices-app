# Data Flow

## 1. Incoming Call Flow (Standard/VA)

This flow describes what happens when a user calls the switchboard number and is routed to a human Virtual Assistant (VA).

1.  **Entry**: Twilio sends a POST request to `[server/index.ts](/server/index.ts)`.
    *   **Route**: `POST /api/twilio/voice`
2.  **Routing Decision**:
    *   Server calls `determineCallRouting` in `[server/call-routing-engine.ts](/server/call-routing-engine.ts)`.
    *   **Inputs**: Business Hours, Agent Mode (Auto/Override), Active Call Count.
    *   **Logic**:
        *   If `mode == 'manual-va'`, route to VA.
        *   If `mode == 'auto'` AND `in_hours` AND `!busy`, route to VA.
3.  **Twilio Response (TwiML)**:
    *   The server responds with XML instructing Twilio to:
        *   **Fork Stream**: `<Start><Stream url="wss://.../api/twilio/realtime" /></Start>` (Starts Flow #3).
        *   **Dial**: `<Dial><Number>+1234567890</Number></Dial>` (Connects to VA).
    *   **Code Reference**: `[server/index.ts](/server/index.ts)` (Lines 366-495).

## 2. AI Agent Flow (Eleven Labs)

This flow occurs when the routing engine decides to send the caller to the AI Voice Agent (e.g., out of hours, or busy).

1.  **Entry & Decision**: Same as above (Steps 1-2).
    *   **Decision**: `determineCallRouting` returns `destination: 'eleven-labs'` or `'busy-agent'`.
2.  **Twilio Response (TwiML)**:
    *   The server responds with XML instructing Twilio to **Redirect**.
    *   **Instruction**: `<Redirect>/api/twilio/eleven-labs-register</Redirect>`
    *   **Why**: We need to register the call ID with ElevenLabs *before* connecting.
3.  **Registration**:
    *   Twilio hits `POST /api/twilio/eleven-labs-register`.
    *   Server calls `registerElevenLabsCall` in `[server/eleven-labs/register-call.ts]` (inferred path, verified import in `index.ts`).
    *   **Action**: Calls ElevenLabs API to create a conversational session.
    *   **Return**: Returns TwiML provided by ElevenLabs SDK to connect the call (Sip/WebSocket).

## 3. Realtime Transcription & SKU Detection

This flow runs in parallel with Flow #1 (Incoming Call) when the `<Stream>` instruction is executed.

1.  **Connection**:
    *   Twilio connects to `wss://.../api/twilio/realtime`.
    *   Handled by `setupTwilioSocket` in `[server/twilio-realtime.ts](/server/twilio-realtime.ts)`.
2.  **Instantiation**:
    *   A `MediaStreamTranscriber` instance is created for the call.
3.  **Audio Pipeline**:
    *   **Input**: Raw audio (mulaw/8000) from Twilio WebSocket.
    *   **Process**: Buffers sent to Deepgram (`this.dgLive.send(buffer)`).
4.  **Text Processing**:
    *   **Event**: `LiveTranscriptionEvents.Transcript` fires on Deepgram result.
    *   **Broadcast**: Transcript sent to Frontend Client via WebSocket (`voice:live_segment`).
5.  **Intelligence (Debounced)**:
    *   **Trigger**: `analyzeSegment` is called (debounced 300ms).
    *   **Action**: Calls `detectMultipleTasks(text)` in `[server/skuDetector.ts](/server/skuDetector.ts)`.
    *   **LLM**: Sends transcript to OpenAI to extract intents/SKUs.
    *   **Result**: Returns `matchedServices` (SKUs).
6.  **Update**:
    *   **Broadcast**: `voice:analysis_update` sent to Frontend.
    *   **Persist**: `updateCall` in `[server/call-logger.ts](/server/call-logger.ts)` saves JSON to DB.

## 4. Quote Generation Flow

This flow describes how a Job Description is turned into a verified Quote Type recommendation.

1.  **Input**:
    *   User provides `Job Description`, `Customer Type`, `Job Scope`, and `Urgency`.
    *   Called via `QuoteEngine.determineQuoteType(input)`.
2.  **Analysis (GPT-4o)**:
    *   System sends prompt to OpenAI to analyze "Complexity" (0.0 - 1.0) and "Visual Aid Need" (Boolean).
    *   **Code Reference**: `[server/quote-engine.ts](/server/quote-engine.ts)` (Lines 105-143).
3.  **Scoring**:
    *   System calculates a weighted sum:
        `Score = (Customer * W) + (Scope * W) + (Urgency * W) + (Complexity * W) + (Visual * W)`
4.  **Thresholding**:
    *   The final score is compared against thresholds:
        *   `< 0.2` -> **Instant Quote**
        *   `< 0.67` -> **Video Quote**
        *   `>= 0.67` -> **Site Visit**
    *   **Overrides**: Needs Visual + Low Score -> Video Quote. Commercial Multi-Job -> Site Visit.

## 5. Contractor Job Acceptance

Describes the lifecycle of a job offer to a contractor.

1.  **Job Creation**: Admin creates a job (e.g., from a Lead). Status: `pending`.
2.  **Assignment**: Job is assigned to a specific `contractorId`.
3.  **View**:
    *   Contractor logs in (via `contractor-auth` session).
    *   GET `/api/contractor/jobs` lists pending jobs.
4.  **Decision**:
    *   **Accept**: `POST /api/contractor/jobs/:id/accept`
        *   Updates status to `accepted`.
        *   Records `acceptedAt`.
    *   **Decline**: `POST /api/contractor/jobs/:id/decline`
        *   Updates status to `declined`.
        *   Requires `reason`.
5.  **Execution**:
    *   Contractor marks `in_progress` -> `completed`.
    *   System records earnings for financial stats.

## 6. WhatsApp Inbound (Meta API)

1.  **Webhook**: Meta sends `POST /api/whatsapp/webhook`.
2.  **Handler**: `metaWhatsAppRouter` verifies payload.
3.  **Logic**:
    *   Extracts message type (Text, Image, Location).
    *   **Upsert Conversation**: Finds existing convo by phone or creates new one.
    *   **Store Message**: Inserts into `messages` table.
4.  **Broadcast**:
    *   Emits `inbox:message` via WebSocket to CRM UI for real-time display.

## Verification

The following assumptions were made:

1.  **Assumption**: The ElevenLabs registration flow uses the official SDK's `register` method which returns TwiML.
    *   *Verify in*: [server/index.ts](file:///Users/courtneebonnick/v6-switchboard/server/index.ts) (Line 524 `registerElevenLabsCall`).
2.  **Assumption**: Frontend receives WebSocket events directly.
    *   *Verify in*: [server/twilio-realtime.ts](file:///Users/courtneebonnick/v6-switchboard/server/twilio-realtime.ts) (Line 556, `setupTwilioSocket` takes a `broadcast` function).
    *   *Verify in*: [server/index.ts](file:///Users/courtneebonnick/v6-switchboard/server/index.ts) (Need to verify where `setupTwilioSocket` is called and what `broadcast` implementation is passed).
