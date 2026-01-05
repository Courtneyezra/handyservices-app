# Dependencies

## Core Runtime & Frameworks

| Package | Version | Usage |
|---------|---------|-------|
| **[express](https://www.npmjs.com/package/express)** | ^4.21.2 | The web server handling all HTTP routes and webhooks. Entry point found in `[server/index.ts](/server/index.ts)`. |
| **[ws](https://www.npmjs.com/package/ws)** | ^8.18.3 | WebSocket implementation. Used for both the Twilio Media Stream and the Realtime Client updates. Used in `[server/twilio-realtime.ts](/server/twilio-realtime.ts)`. |
| **[react](https://www.npmjs.com/package/react)** | ^18.3.1 | Frontend UI library. |
| **[vite](https://www.npmjs.com/package/vite)** | ^5.4.14 | Build tool and dev server. Handles HMR for the client. |

## AI & Third-Party Services

| Package | Version | Usage |
|---------|---------|-------|
| **[twilio](https://www.npmjs.com/package/twilio)** | ^5.4.5 | Twilio helper library. Used for TwiML constructs, call status checks, and SMS. |
| **[@deepgram/sdk](https://www.npmjs.com/package/@deepgram/sdk)** | ^4.11.3 | Deepgram client. Used in `[server/twilio-realtime.ts](/server/twilio-realtime.ts)` for live audio transcription (Nova-2). |
| **[@elevenlabs/elevenlabs-js](https://www.npmjs.com/package/@elevenlabs/elevenlabs-js)** | ^2.28.0 | Eleven Labs client. Used implicitly via custom modules in `server/eleven-labs` for registering calls. |
| **[openai](https://www.npmjs.com/package/openai)** | ^4.86.1 | OpenAI API client. Used in `[server/skuDetector.ts](/server/skuDetector.ts)` for text classification and SKU extraction. |
| **[stripe](https://www.npmjs.com/package/stripe)** | ^20.1.0 | Payment processing. Used in `[server/stripe-routes.ts](/server/stripe-routes.ts)`. |

## Auth & Security

| Package | Version | Usage |
|---------|---------|-------|
| **[bcrypt](https://www.npmjs.com/package/bcrypt)** | ^6.0.0 | Password hashing for contractor authentication. |
| **[uuid](https://www.npmjs.com/package/uuid)** | ^13.0.0 | Generates unique IDs for calls, leads, and SKUs. |
| **[fuzzball](https://www.npmjs.com/package/fuzzball)** | ^2.2.3 | Fuzzy string matching, likely used for fallback logic or duplicate detection. |

## Database & ORM

| Package | Version | Usage |
|---------|---------|-------|
| **[drizzle-orm](https://www.npmjs.com/package/drizzle-orm)** | ^0.39.1 | Type-safe ORM for PostgreSQL. Schema defined in `[shared/schema.ts](/shared/schema.ts)` (Inferred path). |
| **[@neondatabase/serverless](https://www.npmjs.com/package/@neondatabase/serverless)** | ^0.10.4 | Driver for Neon Serverless Postgres. |

## Utilities

| Package | Version | Usage |
|---------|---------|-------|
| **[zod](https://www.npmjs.com/package/zod)** | ^3.24.2 | Schema validation, primarily for API inputs and Drizzle schemas. |
| **[uuid](https://www.npmjs.com/package/uuid)** | ^13.0.0 | Generates unique IDs for calls, leads, and SKUs. |
| **[fuzzball](https://www.npmjs.com/package/fuzzball)** | ^2.2.3 | Fuzzy string matching, likely used for fallback logic or duplicate detection. |

## Verification

The following assumptions were made:

1.  **Assumption**: `shared/schema.ts` exists and holds the database schema.
    *   *Verify via*: File system check (Imported in `server/index.ts` line 11).
2.  **Assumption**: `server/stripe-routes.ts` handles the billing logic.
    *   *Verify in*: [server/index.ts](file:///Users/courtneebonnick/v6-switchboard/server/index.ts) (Line 35).
