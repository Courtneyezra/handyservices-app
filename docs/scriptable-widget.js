// V6 Switchboard home-screen widget for the Scriptable app (iOS).
// Shows a role-scoped ops summary from GET /api/widget/summary as a grid of
// stat cards. Setup: paste your values into the two constants below (see
// install steps at the bottom).
const TOKEN = "PASTE_TOKEN";
const BASE = "https://www.handyservices.app";

const CACHE = FileManager.local();
const CACHE_PATH = CACHE.joinPath(CACHE.documentsDirectory(), "v6-widget-cache.json");
const LOGO_PATH = CACHE.joinPath(CACHE.documentsDirectory(), "v6-widget-logo.png");

// Site logo for the header; fetched once, then served from the local cache so
// it still renders offline. Returns null on first run without network.
async function loadLogo() {
  try {
    if (CACHE.fileExists(LOGO_PATH)) return CACHE.readImage(LOGO_PATH);
    const img = await new Request(`${BASE}/logo.png`).loadImage();
    CACHE.writeImage(LOGO_PATH, img);
    return img;
  } catch (e) {
    return null;
  }
}

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
const bg = new LinearGradient();
bg.colors = [new Color("#0f172a"), new Color("#1c2740")];
bg.locations = [0, 1];
widget.backgroundGradient = bg;
widget.setPadding(12, 12, 12, 12);
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

const accent = new Color("#e8b323");
const muted = new Color("#64748b"); // slate-500
const TONES = { alert: new Color("#f87171"), ok: new Color("#4ade80") }; // server-driven indicators
const CELL_BG = new Color("#1e293b", 0.6); // slate-800, translucent
const CELL_BG_ALERT = new Color("#f87171", 0.16); // red tint when tone = alert

// One rounded stat card: icon + label on top, bold value, small detail.
// The server picks the icon (SF Symbol name) and tone; old script versions
// simply ignore those fields.
function addCell(parent, line) {
  const cell = parent.addStack();
  cell.layoutVertically();
  cell.setPadding(7, 8, 7, 8);
  cell.cornerRadius = 10;
  cell.backgroundColor = line.tone === "alert" ? CELL_BG_ALERT : CELL_BG;
  const tint = TONES[line.tone] || accent;

  const top = cell.addStack();
  top.centerAlignContent();
  const sym = SFSymbol.named(line.icon || "circle.fill");
  sym.applyFont(Font.systemFont(10));
  const icon = top.addImage(sym.image);
  icon.imageSize = new Size(10, 10);
  icon.tintColor = tint;
  top.addSpacer(3);
  const label = top.addText(line.label.toUpperCase());
  label.textColor = muted;
  label.font = Font.mediumSystemFont(7);
  label.lineLimit = 1;
  top.addSpacer(); // greedy spacer → cells in a row share the width evenly

  cell.addSpacer(3);
  const value = cell.addText(line.value);
  value.textColor = tint;
  value.font = Font.boldSystemFont(15);
  value.lineLimit = 1;
  value.minimumScaleFactor = 0.6;

  const detail = cell.addText(line.detail || " "); // keep cell heights equal
  detail.textColor = new Color("#94a3b8"); // slate-400
  detail.font = Font.systemFont(8);
  detail.lineLimit = 1;
}

if (!data) {
  const err = widget.addText("Widget error — check token");
  err.textColor = Color.red();
  err.font = Font.mediumSystemFont(12);
  const detail = widget.addText(error || "");
  detail.textColor = Color.gray();
  detail.font = Font.systemFont(9);
} else {
  // Slim header: logo · HANDYSERVICES · updated time (amber ⚠︎ when offline).
  const when = new Date(data.generatedAt);
  const hhmm = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const header = widget.addStack();
  header.centerAlignContent();
  const logo = await loadLogo();
  if (logo) {
    const mark = header.addImage(logo);
    mark.imageSize = new Size(14, 12); // logo.png is 940x788
    mark.cornerRadius = 6;
  } else {
    const dot = header.addText("●");
    dot.textColor = accent;
    dot.font = Font.systemFont(7);
  }
  header.addSpacer(4);
  const title = header.addText("HANDYSERVICES");
  title.textColor = muted;
  title.font = Font.semiboldSystemFont(8);
  header.addSpacer();
  const clock = header.addText(stale ? `⚠︎ ${hhmm}` : hhmm);
  clock.textColor = stale ? accent : muted;
  clock.font = Font.systemFont(8);
  widget.addSpacer(6);

  if (config.widgetFamily === "small") {
    // Small: first two lines as stacked full-width cards.
    for (const line of data.lines.slice(0, 2)) {
      addCell(widget, line);
      widget.addSpacer(6);
    }
  } else {
    // Medium: grid, two cards per row (a lone last card spans the row).
    for (let i = 0; i < data.lines.length; i += 2) {
      const row = widget.addStack();
      row.layoutHorizontally();
      addCell(row, data.lines[i]);
      if (data.lines[i + 1]) {
        row.addSpacer(6);
        addCell(row, data.lines[i + 1]);
      }
      widget.addSpacer(6);
    }
  }
  widget.addSpacer();
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
