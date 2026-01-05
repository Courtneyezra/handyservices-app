# Runbook

## Development Setup

### Prerequisites
*   Node.js (v20+)
*   Deepgram API Key
*   OpenAI API Key
*   ElevenLabs API Key
*   Twilio Account (SID/Token)
*   PostgreSQL Database (Neon URL)
*   **ngrok** (Required for local Twilio webhooks)

### Environment Variables
Create a `.env` file in the root directory. Ensure the following keys are present (Reference: `[server/index.ts](/server/index.ts)` Diagnostics check):

```env
DATABASE_URL=postgres://...
DEEPGRAM_API_KEY=...
OPENAI_API_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
ELEVEN_LABS_API_KEY=...
# Optional but recommended for customization
DEEPGRAM_UTTERANCE_MS=700
```

### Installation
```bash
npm install
```

### Running Locally
1.  **Start the Server**:
    ```bash
    npm run dev
    ```
    This command runs `tsx server/index.ts` and likely starts the Vite dev server for the client concurrently (or requires a separate terminal? *Verification needed*).
    
    *Note: `package.json` script "dev" runs `tsx server/index.ts`. If this doesn't start the client, you may need to run `vite` separately or check if the server serves the client build.*

2.  **Start Ngrok**:
    Publicly expose port 5000 (or default port):
    ```bash
    ngrok http 5000
    ```
    *   **Action**: Copy the https URL (e.g., `https://abcdef.ngrok-free.app`).
    *   **Configure Twilio**: Set the Voice Webhook to `https://abcdef.ngrok-free.app/api/twilio/voice`.

## Deployment

### Build
To build for production:
```bash
npm run build
```
*   Compiles Client via Vite to `dist/`.
*   Bundles Server via esbuild to `dist/index.js`.

### Start Production
```bash
npm start
```
*   Runs `node dist/index.js`.
*   Server is configured to serve static files from `../client/dist` (See `[server/index.ts](/server/index.ts)` line 136).

## Troubleshooting

### Common Issues

**1. No Audio / "Quiet" Calls**
*   **Cause**: Twilio Media Stream failed to connect.
*   **Check**:
    *   Is ngrok running?
    *   Is the Webhook URL up to date in Twilio Console?
    *   Check Server logs for `[Twilio] Stream started`.

**2. SKU Detection Failing**
*   **Cause**: OpenAI API error or empty transcript.
*   **Check**:
    *   Check `OPENAI_API_KEY` validity.
    *   Check Server logs for `[SkuDetector]`.

**3. Database Connection Errors**
*   **Cause**: Neon connection string invalid or timed out.
*   **Check**:
    *   Verify `DATABASE_URL` in `.env`.
    *   Run `npm run db:push` to ensure schema sync.

## Verification

The following assumptions were made:

1.  **Assumption**: The dev script `tsx server/index.ts` is the primary entry point.
    *   *Verify*: [package.json](file:///Users/courtneebonnick/v6-switchboard/package.json).
2.  **Assumption**: The server port is standard (5000 or 3000).
    *   *Verify*: Check logic in `server/index.ts` for `app.listen`. (Not visible in previous snippet, usually at bottom).
