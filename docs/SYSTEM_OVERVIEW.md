# System Overview

## High-Level Architecture

The v6-switchboard is a **real-time voice operations platform** designed to bridge traditional telephony (Twilio) with modern AI capabilities (Deepgram, OpenAI, ElevenLabs) and dynamic frontend interfaces (React).

At its core, it functions as an intelligent interceptor for incoming calls, performing three simultaneous actions:
1.  **Call Routing**: Deciding dynamically whether a call goes to a human VA, an AI Agent, or Voicemail.
2.  **Live Intelligence**: extracting intent, customer metadata, and SKU matches in real-time from audio.
3.  **Visualization**: Broadcasting live call states to a dashboard for human oversight.

### Architecture Diagram (Conceptual)

```mermaid
graph TD
    User[Caller] -->|PSTN| Twilio
    
    subgraph "Server (Node/Express)"
        direction TB
        Webhook[Webhook Handler] -->|Logic| Router[Call Routing Engine]
        Router -->|Decision| TwiML[TwiML Generator]
        
        Twilio -->|Audio Stream (WS)| Transcriber[Media Stream Transcriber]
        Transcriber -->|Stream| Deepgram[Deepgram STT]
        Deepgram -->|Transcript| Transcriber
        
        Transcriber -->|Text| Analyzer[SKU Detector & Metadata]
        Analyzer -->|Context| OpenAI
        
        Transcriber -->|Events| WS_Server[WebSocket Broadcaster]
    end
    
    subgraph "External AI"
        ElevenLabs[ElevenLabs Agent]
    end
    
    subgraph "Client (React)"
        WS_Client[WebSocket Client] -->|Events| LiveCallContext
        LiveCallContext --> Dashboard
    end
    
    Router -.->|Redirect| ElevenLabs
    WS_Server --> WS_Client
```

## Tech Stack

| Layer | Technology | Key Usage |
|-------|------------|-----------|
| **Runtime** | Node.js (v20+) | Core server execution |
| **Server Framework** | Express.js | HTTP API & Webhook handling |
| **Language** | TypeScript | Strict typing across stack |
| **Database** | PostgreSQL (Neon) | Data persistence via Drizzle ORM |
| **Realtime** | `ws` (WebSocket) | Twilio audio streaming & Client broadcasting |
| **Frontend** | React + Vite | Dashboard UI |
| **Styling** | Tailwind CSS | UI components (shadcn/ui based) |

## Core Modules & Entry Points

### 1. Server Application
*   **Entry Point**: [server/index.ts](file:///Users/courtneebonnick/v6-switchboard/server/index.ts)
*   **Key Responsibilities**:
    *   Initialize Express app and HTTP middleware.
    *   Set up WebSocket servers for Twilio (`setupTwilioSocket`) and Client.
    *   Register API routes (`callsRouter`, `settingsRouter`, etc.).

### 2. Call Routing Engine
*   **Location**: [server/call-routing-engine.ts](file:///Users/courtneebonnick/v6-switchboard/server/call-routing-engine.ts)
*   **Function**: `determineCallRouting`
*   **Logic**: Evaluates Business Hours, Agent Availability (Active Calls), and Global Settings (Agent Mode) to determine the next step (Forward, AI, Voicemail).

### 3. Realtime Switchboard (Voice)
*   **Location**: [server/twilio-realtime.ts](file:///Users/courtneebonnick/v6-switchboard/server/twilio-realtime.ts)
*   **Class**: `MediaStreamTranscriber`
*   **Logic**:
    *   Accepts raw audio buffer from Twilio.
    *   Sends to Deepgram for transcription.
    *   Debounces results to `skuDetector` for logic extraction.
    *   Broadcasts updates to connected clients.

### 4. SKU & Intent Detection
*   **Location**: [server/skuDetector.ts](file:///Users/courtneebonnick/v6-switchboard/server/skuDetector.ts)
*   **Logic**: Uses OpenAI/LLMs to map unstructured transcripts to defined "Productized Services" (SKUs) in the database.

### 5. Contractor Portal
*   **Entry Points**: 
    *   [server/contractor-auth.ts](file:///Users/courtneebonnick/v6-switchboard/server/contractor-auth.ts) (Auth)
    *   [server/job-routes.ts](file:///Users/courtneebonnick/v6-switchboard/server/job-routes.ts) (Job Management)
*   **Logic**:
    *   Custom session-based authentication for contractors.
    *   Job lifecycle management (Pending -> Accepted -> In Progress -> Completed).
    *   Financial tracking (Earnings, Payouts).

### 6. Quote Engine
*   **Location**: [server/quote-engine.ts](file:///Users/courtneebonnick/v6-switchboard/server/quote-engine.ts)
*   **Logic**:
    *   Analyzes job descriptions using GPT-4o.
    *   Calculates a weighted score based on Urgency, Customer Type, Job Scope, and Complexity.
    *   Determines if a job needs an `instant_quote`, `video_quote`, or `site_visit`.

### 7. WhatsApp CRM (Meta Cloud API)
*   **Location**: [server/meta-whatsapp.ts](file:///Users/courtneebonnick/v6-switchboard/server/meta-whatsapp.ts)
*   **Logic**:
    *   Direct integration with Meta Graph API (bypassing Twilio for WhatsApp).
    *   Two-way message syncing (Webhooks for inbound, API for outbound).
    *   Real-time WebSocket broadcasting to the CRM UI (`inbox:message`).

## External Integrations

*   **Twilio**: Voice provider, manages numbers and streams audio.
*   **Deepgram**: Real-time speech-to-text (Nova-2 model).
*   **ElevenLabs**: Conversational AI for autonomous call handling.
*   **OpenAI**: Intelligence layer for metadata extraction and SKU matching.
*   **Google Places**: Address validation and autocomplete.

## Verification

The following assumptions were made during the drafting of this overview:

1.  **Assumption**: The WebSocket server for the client UI is hosted on the same port/instance as the Express server.
    *   *Verify in*: [server/index.ts](file:///Users/courtneebonnick/v6-switchboard/server/index.ts) (Look for `attached_assets` or shared `server` object).
2.  **Assumption**: `server/skuDetector.ts` is called directly by the realtime stream, effectively putting LLM calls in the hot path of the call loop (albeit debounced).
    *   *Verify in*: [server/twilio-realtime.ts](file:///Users/courtneebonnick/v6-switchboard/server/twilio-realtime.ts) (Search for `analyzeSegment` calling `detectMultipleTasks`).
