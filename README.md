# V6 Switchboard ("The Monitor")

The streamlined backend and frontend for the V6 Handyman Operations system.

## 🚀 Overview

This project isolates the "High IQ" components from the V5 legacy system:
1.  **The Monitor**: A Twilio Realtime WebSocket server that listens to calls, transcribes them using OpenAI Whisper, and logs them.
2.  **The Brain**: The `skuDetector` that analyzes transcripts to suggest "Tap Repair" or "TV Mounting" SKUs.
3.  **The Face**: The `HandymanLanding` page optimized for conversion.

## 📂 Project Structure

*   `client/`: React Frontend (Vite)
    *   `src/pages/HandymanLanding.tsx`: The main entry point.
*   `server/`: Node.js Express Backend
    *   `twilio-realtime.ts`: Handles WebSocket audio streams.
    *   `skuDetector.ts`: AI logic for pricing.
*   `shared/`: Shared Types & Schema
    *   `schema.ts`: Drizzle ORM definitions (Pruned to essentials).

## 🛠️ Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Create a `.env` file with the following:
```env
DATABASE_URL=postgres://... (Neon DB)
OPENAI_API_KEY=sk-...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
```

### 3. Database Migration
```bash
npm run db:push
npm run seed  # Populates the SKU table
```

### 4. Run Development Server
```bash
npm run dev
```

## 🔌 Twilio Configuration

To connect "The Monitor" to real calls:
1.  Go to Twilio Console > Voice > TwiML Apps.
2.  Create a new App (or update existing).
3.  Set the **Voice Configuration Request URL** to your backend URL (e.g., `https://your-app.replit.app/api/twilio/voice`).
4.  The backend will return TwiML to `<Connect><Stream url="wss://your-app.replit.app/api/twilio/realtime" /></Connect>`.

## 🧠 SKU Logic
The system uses a hybrid approach:
1.  **Keyword Match**: Fast lookups for "tap", "mount".
2.  **Embedding Match**: Vector search for "fix the dripping thing in kitchen".
3.  **GPT Validation**: Final check to ensure high confidence.
