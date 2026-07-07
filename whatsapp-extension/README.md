# Handy Services — WhatsApp Sync Extension

A Chrome extension that sits on top of **web.whatsapp.com** and syncs every message Ben sees (inbound + outbound) to the V6 Switchboard backend.

**What it does:**
- Captures new messages as they arrive on WhatsApp Web.
- POSTs them to `/api/whatsapp/ext-ingest`.
- Backend upserts the conversation, stores the message, and **auto-creates a lead on first inbound from an unknown phone** — so leads stop going missing from the Kanban.

**What it does NOT do (yet):**
- No sidebar UI — Ben just uses WhatsApp Web as normal.
- No outbound from the extension — he replies in WhatsApp Web directly, and we capture it passively.
- No media (photos, voice notes) — text only in v1.
- No group messages.
- No historical backfill — only captures new activity from install time forward.

---

## For Courtnee (Mac) — build and distribute

### 1. Install + build

```bash
cd whatsapp-extension
npm install
npm run build
```

This produces `whatsapp-extension/dist/` which contains the loadable extension.

### 2. Set up the backend token

On the production host (wherever `handyservices.app` runs), add to the environment:

```
WA_EXT_INGEST_TOKEN=<a-long-random-string>
```

Generate one with:
```bash
openssl rand -hex 32
```

Restart the backend. Verify it's live:

```bash
curl https://handyservices.app/api/whatsapp/ext-ping \
  -H "Authorization: Bearer $WA_EXT_INGEST_TOKEN"
# → {"ok":true,"ts":"2026-04-23T..."}
```

### 3. Send to Ben

Zip the `dist/` folder and the same token:

```bash
cd whatsapp-extension
zip -r handy-wa-ext.zip dist/
```

Send `handy-wa-ext.zip` + the ingest token to Ben via a secure channel (not WhatsApp).

---

## For Ben (Windows) — install

1. Unzip `handy-wa-ext.zip` to a folder you'll leave alone, e.g. `C:\Users\Ben\handy-wa-ext\`. You should see files including `manifest.json` inside.
2. Open Chrome → type `chrome://extensions` in the address bar → press Enter.
3. Top right: toggle **Developer mode** ON.
4. Click **Load unpacked** (top left) → select the `handy-wa-ext\dist\` folder.
5. You should see **Handy Services — WhatsApp Sync** appear in the list with a toggle ON.
6. Pin it to the toolbar: click the puzzle-piece icon (top right of Chrome) → pin icon next to "Handy Services — WhatsApp Sync".
7. Click the extension's icon in the toolbar — a small popup opens.
8. **Backend URL**: paste `https://handyservices.app`
9. **Ingest Token**: paste the token Courtnee sent you.
10. Click **Save & Test Connection**. You should see a green "Connected ✓".
11. Open a new tab: `https://web.whatsapp.com`. Scan the QR code with the business WhatsApp phone.
12. Done. Every message you see from now on will sync to the Kanban at `https://handyservices.app/admin/pipeline`.

### Day-to-day

- Leave Chrome open during working hours. When you close Chrome, capture pauses — the extension starts again when you reopen WhatsApp Web.
- You can click the extension icon any time to see status: when it last synced, how many messages (if any) are queued waiting for the backend.
- If the backend is briefly down, the extension queues messages locally and retries every 30 seconds.

---

## Troubleshooting

**"Not connected yet" after Save?**
- Check the URL is correct (no trailing slash — the extension strips it anyway, but still).
- Check the token matches what Courtnee set in `WA_EXT_INGEST_TOKEN` exactly.
- Open DevTools (F12) on the popup (right-click popup → Inspect) to see errors.

**Chrome keeps warning "Disable developer mode extensions"**
- This is normal for unpacked extensions. Just click "x" to dismiss. Doesn't affect functionality.

**Messages aren't appearing on the Kanban**
- Click the extension icon — if it says "Error", read the error message.
- Open DevTools on the WhatsApp Web tab (F12 → Console). Look for `[handy-wa-ext]` log lines.
- Check the Network tab — filter for `ext-ingest`. You should see POSTs returning 200.

**Chrome updated and the extension broke**
- Re-open `chrome://extensions` and click the refresh icon on our extension card.
- If that doesn't work, tell Courtnee — we may need to update selectors when WhatsApp redesigns.

---

## How it works (for curious developers)

```
web.whatsapp.com  ←— content.js runs here
   │                  ├─ MutationObserver watches for new message rows
   │                  ├─ parser.ts extracts phone, direction, text, timestamp
   │                  └─ chrome.runtime.sendMessage → background worker
   │
   ↓ chrome.runtime.sendMessage
   │
background.js  ←— service worker
   ├─ POST https://handyservices.app/api/whatsapp/ext-ingest
   │        Authorization: Bearer <token>
   └─ On failure: persist to chrome.storage.local, retry every 30s via alarms

handyservices.app (Express)
   └─ /api/whatsapp/ext-ingest  (auth: bearer token)
        └─ ingestWhatsAppMessage()  (shared helper)
              ├─ Upsert conversations
              ├─ Insert messages (dedup on external ID)
              ├─ INSERT leads if inbound from new phone  ← THE FIX
              └─ WebSocket broadcast to admin UI
```

**Deduplication**: each message row carries WhatsApp's internal `data-id`. We pass it through as the `messages.id` primary key. If Ben scrolls back and re-triggers the observer, the backend sees a duplicate PK and quietly drops it.

**No ban risk**: the extension does nothing but read DOM events and POST JSON to our own server. No automation, no scripted sending, no modified requests to WhatsApp. From WhatsApp's perspective, Ben is just using WhatsApp Web normally in his own Chrome.
