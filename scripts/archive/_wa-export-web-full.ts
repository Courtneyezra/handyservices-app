/**
 * FULL-HISTORY WhatsApp export via whatsapp-web.js → whatsapp-export/wa-dump-full.json
 * READ-ONLY on the account: only getChats() + fetchMessages(). No sends, no sendSeen().
 *
 * Uses its OWN session (export-full) so it never touches session-client-one.
 * A Chromium window opens showing the WhatsApp Web QR — scan it on the phone
 * that holds the target number (WhatsApp → Settings → Linked Devices → Link a Device).
 *
 * Unlike _wa-export-web.ts: no date window, higher per-chat cap, checkpoint
 * writes every 25 chats so a crash keeps partial progress.
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
const FILE = path.join(OUT, "wa-dump-full.json");
const PER_CHAT_LIMIT = 3000;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "export-full" }),
  puppeteer: { headless: false, executablePath: CHROME, args: ["--no-sandbox"] },
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1045702548-alpha.html",
  },
});

client.on("loading_screen", (percent: any, message: any) => console.log("[loading]", percent, message));
client.on("change_state", (s: any) => console.log("[state]", s));

// Watchdog: generous window because the QR scan is manual.
let ready = false;
setTimeout(() => {
  if (!ready) {
    console.error("[watchdog] not 'ready' after 6 min — QR not scanned or a wweb version/sync issue. Exiting.");
    process.exit(2);
  }
}, 360000);

client.on("qr", () => {
  console.log("\n[QR] A Chromium window is open showing WhatsApp Web.");
  console.log("    On the phone with the target number: WhatsApp → Settings → Linked Devices → Link a Device → scan it.\n");
});
client.on("authenticated", () => console.log("[auth] session OK"));
client.on("auth_failure", (m) => console.error("[auth_failure]", m));
client.on("disconnected", (r) => console.error("[disconnected]", r));

client.on("ready", async () => {
  ready = true;
  console.log("[ready] connected. Waiting for chat collection to finish syncing…");
  // The Chat collection fills as WA Web syncs; sample until the count is
  // stable for 3 consecutive checks (or 3 min cap) before sweeping.
  let last = -1;
  let stable = 0;
  for (let t = 0; t < 36 && stable < 3; t++) {
    const n: number = await client.pupPage.evaluate(
      () => (window as any).require("WAWebCollections").Chat.getModelsArray().length
    );
    stable = n === last ? stable + 1 : 0;
    last = n;
    console.log(`[sync] ${n} chats loaded`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("[ready] chat list settled. Fetching via page require() …");
  // wweb's own injection half-fails on this account (window.Store never set),
  // so go straight to WhatsApp Web's module loader instead of wweb's API.
  const rawChats: { id: string; name: string | null; phone: string | null }[] =
    await client.pupPage.evaluate(() => {
      const w = window as any;
      const coll = w.require("WAWebCollections");
      let contactApi: any = null;
      try {
        contactApi = w.require("WAWebApiContact");
      } catch {}
      // Newer WA accounts address 1:1 chats as @lid, not @c.us; accept both
      // and map lid → phone number via the contact API where possible.
      return coll.Chat.getModelsArray()
        .filter((c: any) => c?.id?.server === "c.us" || c?.id?.server === "lid")
        .map((c: any) => {
          let phone: string | null = c.id.server === "c.us" ? c.id.user : null;
          if (!phone && contactApi?.getPhoneNumber) {
            try {
              const pn = contactApi.getPhoneNumber(c.id);
              phone = pn?.user || (typeof pn === "string" ? pn.replace(/@.*/, "") : null);
            } catch {}
          }
          return {
            id: c.id._serialized,
            name: c.formattedTitle || c.name || null,
            phone,
          };
        });
    });
  console.log(`[chats] ${rawChats.length} one-to-one chats; exporting full history…`);

  const dump: any[] = [];
  const truncated: string[] = [];
  const failed: string[] = [];
  fs.mkdirSync(OUT, { recursive: true });
  let i = 0;
  for (const rc of rawChats) {
    i++;
    let msgs: any[] = [];
    try {
      msgs = await client.pupPage.evaluate(
        async (chatId: string, limit: number) => {
          const w = window as any;
          const coll = w.require("WAWebCollections");
          const chat = coll.Chat.get(chatId);
          if (!chat) return [];
          let loadEarlier: any = null;
          try {
            loadEarlier = w.require("WAWebChatLoadMessages")?.loadEarlierMsgs;
          } catch {}
          let arr = chat.msgs.getModelsArray();
          if (loadEarlier) {
            for (let guard = 0; arr.length < limit && guard < 60; guard++) {
              let older: any = null;
              try {
                older = await loadEarlier(chat);
              } catch {
                break;
              }
              if (!older || !older.length) break;
              arr = chat.msgs.getModelsArray();
            }
          }
          return arr.slice(-limit).map((m: any) => ({
            timestamp: m.t,
            fromMe: !!m.id?.fromMe,
            type: m.type,
            body: m.body || "",
          }));
        },
        rc.id,
        PER_CHAT_LIMIT
      );
    } catch (e: any) {
      failed.push(rc.name || rc.id);
      console.error(`  ! fetch failed: ${rc.name || rc.id}: ${e?.message}`);
      continue;
    }
    if (!msgs.length) continue;
    if (msgs.length >= PER_CHAT_LIMIT) truncated.push(rc.name || rc.id);

    const phone = rc.phone || rc.id; // lid ids without a resolvable phone keep the raw @lid id
    for (const m of msgs) {
      dump.push({
        chatName: rc.name,
        phone,
        ts: new Date(m.timestamp * 1000).toISOString(),
        fromMe: m.fromMe, // true = outbound from this account
        type: m.type,
        hasMedia: m.type !== "chat",
        body: m.body || "",
      });
    }
    console.log(`  [${i}/${rawChats.length}] ${rc.name || phone}: ${msgs.length} msg`);
    if (i % 25 === 0) fs.writeFileSync(FILE, JSON.stringify(dump, null, 2));
  }
  if (failed.length)
    console.log(`[warn] ${failed.length} chats failed to fetch: ${failed.slice(0, 10).join(", ")}${failed.length > 10 ? "…" : ""}`);

  fs.writeFileSync(FILE, JSON.stringify(dump, null, 2));
  console.log(`\n[done] ${dump.length} messages → ${FILE}`);
  if (truncated.length)
    console.log(`[warn] ${truncated.length} chats hit the ${PER_CHAT_LIMIT}-msg cap and may have older history: ${truncated.slice(0, 10).join(", ")}${truncated.length > 10 ? "…" : ""}`);
  await client.destroy();
  process.exit(0);
});

console.log("Launching WhatsApp Web (fresh session: export-full)…");
client.initialize();
