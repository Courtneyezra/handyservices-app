// V6 Switchboard home-screen widget for the Scriptable app (iOS).
// Shows a role-scoped ops summary from GET /api/widget/summary.
// Setup: paste your values into the two constants below (see install steps at the bottom).
const TOKEN = "PASTE_TOKEN";
const BASE = "https://www.handyservices.app";

const CACHE = FileManager.local();
const CACHE_PATH = CACHE.joinPath(CACHE.documentsDirectory(), "v6-widget-cache.json");

async function loadSummary() {
  try {
    const data = await new Request(`${BASE}/api/widget/summary?token=${TOKEN}`).loadJSON();
    if (!Array.isArray(data.lines)) throw new Error(data.error || "bad response");
    CACHE.writeString(CACHE_PATH, JSON.stringify(data));
    return { data, stale: false };
  } catch (e) {
    if (CACHE.fileExists(CACHE_PATH)) {
      return { data: JSON.parse(CACHE.readString(CACHE_PATH)), stale: true };
    }
    return { data: null, stale: false, error: String(e) };
  }
}

const { data, stale, error } = await loadSummary();
const widget = new ListWidget();
widget.backgroundColor = new Color("#0f172a"); // slate-900, matches the app
widget.setPadding(14, 14, 12, 14);
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
const accent = new Color("#e8b323");

if (!data) {
  const err = widget.addText("Widget error — check token");
  err.textColor = Color.red();
  err.font = Font.mediumSystemFont(12);
  const detail = widget.addText(error || "");
  detail.textColor = Color.gray();
  detail.font = Font.systemFont(9);
} else {
  const maxLines = config.widgetFamily === "small" ? 2 : data.lines.length;
  for (const line of data.lines.slice(0, maxLines)) {
    const label = widget.addText(line.label.toUpperCase());
    label.textColor = Color.gray();
    label.font = Font.mediumSystemFont(9);
    const row = widget.addStack();
    row.centerAlignContent();
    const value = row.addText(line.value);
    value.textColor = accent;
    value.font = Font.boldSystemFont(16);
    value.lineLimit = 1;
    if (line.detail && config.widgetFamily !== "small") {
      row.addSpacer(6);
      const detail = row.addText(line.detail);
      detail.textColor = new Color("#94a3b8"); // slate-400
      detail.font = Font.systemFont(10);
      detail.lineLimit = 1;
    }
    widget.addSpacer(5);
  }
  const when = new Date(data.generatedAt);
  const hhmm = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const foot = widget.addText(stale ? `⚠︎ offline — data from ${hhmm}` : `updated ${hhmm}`);
  foot.textColor = stale ? accent : Color.gray();
  foot.font = Font.systemFont(8);
}

Script.setWidget(widget);
if (config.runsInApp) await widget.presentMedium();
Script.complete();

// ── Install ──────────────────────────────────────────────────────────────────
// 1. Get your widget token: admin/VA → /admin/notifications → "iPhone widget"
//    → Generate widget token. Contractors → Profile → "Phone Widget".
// 2. Install "Scriptable" (free) from the App Store.
// 3. Open Scriptable → + → paste this whole file → name it e.g. "Switchboard".
// 4. Replace PASTE_TOKEN above with your token (and BASE if not production).
// 5. Long-press the home screen → + → Scriptable → small or medium widget →
//    add, then long-press the widget → Edit Widget → Script: "Switchboard".
// iOS refreshes it periodically (we hint every 15 min). If offline, the last
// good data is shown with an ⚠︎ offline marker.
