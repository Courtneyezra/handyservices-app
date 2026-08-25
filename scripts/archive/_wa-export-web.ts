/**
 * Export WhatsApp chats (Apr–Jun 2026) via whatsapp-web.js → whatsapp-export/wa-dump.json
 * READ-ONLY on the account: only getChats() + fetchMessages(). No sends, no sendSeen().
 *
 * Auth: reuses .wwebjs_auth/session-client-one if still valid; otherwise a Chromium
 * window opens showing the WhatsApp Web QR — scan it on the BUSINESS phone
 * (WhatsApp → Settings → Linked Devices → Link a Device). Session then persists.
 */
import wweb from "whatsapp-web.js";
import fs from "fs";
import path from "path";
import os from "os";

const { Client, LocalAuth } = wweb as any;

const CHROME = path.join(
  os.homedir(),
  ".cache/puppeteer/chrome/mac_arm-143.0.7499.169/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
);

const OUT = path.join(process.cwd(), "whatsapp-export");
const FROM = Date.parse("2026-04-01T00:00:00Z") / 1000; // wweb timestamps are unix seconds
const TO = Date.parse("2026-07-01T00:00:00Z") / 1000;
const PER_CHAT_LIMIT = 800;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "client-one" }),
  puppeteer: { headless: false, executablePath: CHROME, args: ["--no-sandbox"] },
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1041284155-alpha.html",
  },
});

client.on("loading_screen", (percent: any, message: any) => console.log("[loading]", percent, message));
client.on("change_state", (s: any) => console.log("[state]", s));

// Watchdog: if not ready 150s after launch, bail with a clear message instead of hanging.
let ready = false;
setTimeout(() => {
  if (!ready) {
    console.error("[watchdog] not 'ready' after 150s — likely a wweb version/sync issue. Exiting.");
    process.exit(2);
  }
}, 150000);

client.on("qr", () => {
  console.log("\n[QR] A Chromium window is open showing WhatsApp Web.");
  console.log("    On the BUSINESS phone: WhatsApp → Settings → Linked Devices → Link a Device → scan it.\n");
});
client.on("authenticated", () => console.log("[auth] session OK"));
client.on("auth_failure", (m) => console.error("[auth_failure]", m));
client.on("disconnected", (r) => console.error("[disconnected]", r));

client.on("ready", async () => {
  ready = true;
  console.log("[ready] connected. Fetching chat list…");
  const chats = await client.getChats();
  const oneToOne = chats.filter((c: any) => !c.isGroup);
  console.log(`[chats] ${oneToOne.length} one-to-one chats; scanning for Apr–Jun messages…`);

  const dump: any[] = [];
  const truncated: string[] = [];
  let i = 0;
  for (const chat of oneToOne as any[]) {
    i++;
    let msgs: any[] = [];
    try {
      msgs = await chat.fetchMessages({ limit: PER_CHAT_LIMIT });
    } catch (e: any) {
      console.error(`  ! fetch failed: ${chat.name || chat.id?._serialized}: ${e?.message}`);
      continue;
    }
    const win = msgs.filter((m) => m.timestamp >= FROM && m.timestamp < TO);
    if (!win.length) continue;
    const oldest = msgs.length ? Math.min(...msgs.map((m) => m.timestamp)) : TO;
    if (msgs.length >= PER_CHAT_LIMIT && oldest > FROM) truncated.push(chat.name || chat.id?._serialized);

    const phone = String(chat.id?._serialized || "").replace("@c.us", "");
    for (const m of win) {
      dump.push({
        chatName: chat.name || null,
        phone,
        ts: new Date(m.timestamp * 1000).toISOString(),
        fromMe: m.fromMe, // true = sent by the business (outbound)
        type: m.type,
        body: m.body || "",
      });
    }
    console.log(`  [${i}/${oneToOne.length}] ${chat.name || phone}: ${win.length} msg in window`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, "wa-dump.json");
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`\n[done] ${dump.length} messages → ${file}`);
  if (truncated.length)
    console.log(`[warn] ${truncated.length} chats may have history older than the ${PER_CHAT_LIMIT}-msg limit: ${truncated.slice(0, 10).join(", ")}${truncated.length > 10 ? "…" : ""}`);
  await client.destroy();
  process.exit(0);
});

console.log("Launching WhatsApp Web (reusing .wwebjs_auth/session-client-one if valid)…");
client.initialize();
