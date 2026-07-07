/**
 * PRICING-MODEL PROTOTYPE  (sandbox — NOT wired to production)
 * ------------------------------------------------------------
 * Validates the "two-rail" idea before we build it for real:
 *   ONE classification per task  →  PRICE rail (customer £)  +  TIME rail (dispatch hrs)
 * The two rails are computed from SEPARATE columns of a rate-card, so price can never
 * inflate time and time can never inflate price.
 *
 * WHERE THE NUMBERS COME FROM (the calibration finding):
 *   • PRICE rail = seeded from our sent-quote history. Those points are already validated —
 *     customers paid them. Tune against win-rate, NOT against time.
 *   • TIME rail  = AUTHORED here from trade norms, because history CANNOT give it: implied
 *     £/hr across past quotes spans £0–£150, i.e. price ≠ time × rate, so no single factor
 *     recovers a realistic time from a past price. These are honest on-site minutes; the
 *     scheduling BUFFER is added separately (BUFFER_PCT), never baked into the task time.
 *     Refine each task with contractor ACTUALS over time — set `actualPerUnit` once measured
 *     and it overrides the estimate. That is the only real source of truth for time.
 *   • Two categories are genuinely time/area-sold (hedge per metre, flooring & jetwash per
 *     m²). There the two rails legitimately move together — that's correct, not a leak.
 *
 * Run:   npx tsx scripts/pricing-prototype.ts
 * Edit:  the RATE_CARD (price + time per task type) and TEST_JOBS below, then re-run.
 *
 * The rate-card + rails are exported so other scripts (e.g. real-job back-tests) reuse
 * the exact same card; the demo run at the bottom only fires when this file is run directly.
 */
import { fileURLToPath } from 'node:url';

// ── Tunables ────────────────────────────────────────────────────────────────────
export const BUFFER_PCT = 0.25;   // scheduling buffer on top of realistic time (travel/setup/overrun)
export const DAY_MINUTES = 480;   // a contractor's bookable on-site day (matches the dispatch model)

// ── RATE-CARD ───────────────────────────────────────────────────────────────────
// Two INDEPENDENT columns per task type:
//   price = priceSetup + pricePerUnit × qty   (history-seeded; margin baked in)
//   time  = timeSetup  + timePerUnit  × qty   (AUTHORED honest on-site minutes — red-pen me)
// Optional:
//   actualPerUnit  = measured contractor minutes/unit; once set it OVERRIDES timePerUnit.
//   contingencyPct = explicit risk band for genuinely variable tasks — the "don't lose"
//                    buffer living in the PRICE, not in padded hours.
export type Task = {
  label: string; category: string; unit: string;
  priceSetup: number; pricePerUnit: number;   // £
  timeSetup: number;  timePerUnit: number;     // authored minutes
  actualPerUnit?: number;                       // measured minutes/unit (overrides timePerUnit)
  contingencyPct?: number;
  needsQty?: boolean;                           // area/length tasks (m², m, load): no qty in text ⇒ "measure on site"
};
export const RATE_CARD: Record<string, Task> = {
  // DOOR FITTING (own category in the data — 37 lines)
  plane_door:       { label: 'Plane internal door',   category: 'door_fitting',     unit: 'door',  priceSetup: 20, pricePerUnit: 30,  timeSetup: 10, timePerUnit: 35 },
  hang_door:        { label: 'Fit new internal door', category: 'door_fitting',     unit: 'door',  priceSetup: 30, pricePerUnit: 75,  timeSetup: 15, timePerUnit: 90 }, // 2h if new latch+handle
  adjust_door:      { label: 'Adjust door / hinges',  category: 'door_fitting',     unit: 'door',  priceSetup: 30, pricePerUnit: 20,  timeSetup: 10, timePerUnit: 25 },

  // CARPENTRY
  fit_skirting:     { label: 'Fit skirting / trim',   category: 'carpentry',        unit: 'm',     priceSetup: 30, pricePerUnit: 12,  timeSetup: 20, timePerUnit: 8, needsQty: true },
  shelf:            { label: 'Put up shelf',          category: 'shelving',         unit: 'shelf', priceSetup: 25, pricePerUnit: 30,  timeSetup: 10, timePerUnit: 30 },
  flatpack:         { label: 'Flat-pack assembly',    category: 'flat_pack',        unit: 'item',  priceSetup: 25, pricePerUnit: 45,  timeSetup: 10, timePerUnit: 60 }, // wardrobe ~2–3× an item

  // PAINTING (volume #2 — where inflation concentrates)
  paint_wall:       { label: 'Paint wall',            category: 'painting',         unit: 'wall',  priceSetup: 25, pricePerUnit: 45,  timeSetup: 15, timePerUnit: 60 },
  paint_room:       { label: 'Paint room',            category: 'painting',         unit: 'room',  priceSetup: 40, pricePerUnit: 110, timeSetup: 20, timePerUnit: 210 }, // ⚠ least certain — prime actuals candidate
  paint_woodwork:   { label: 'Paint woodwork',        category: 'painting',         unit: 'room',  priceSetup: 30, pricePerUnit: 60,  timeSetup: 15, timePerUnit: 90 },  // skirting+frames+doors, per room

  // GENERAL FIXING (volume #1 — the call-out tier)
  mount_fixture:    { label: 'Mount fixture',         category: 'general_fixing',   unit: 'item',  priceSetup: 30, pricePerUnit: 12,  timeSetup: 8,  timePerUnit: 12 }, // towel/roll holder, coat hook, grab rail
  fit_letterbox:    { label: 'Fit letterbox',         category: 'general_fixing',   unit: 'item',  priceSetup: 45, pricePerUnit: 0,   timeSetup: 10, timePerUnit: 35 },
  fit_handle:       { label: 'Fit handle / lock',     category: 'general_fixing',   unit: 'item',  priceSetup: 30, pricePerUnit: 15,  timeSetup: 10, timePerUnit: 20 },
  hang_mirror:      { label: 'Hang mirror / picture', category: 'general_fixing',   unit: 'item',  priceSetup: 30, pricePerUnit: 20,  timeSetup: 10, timePerUnit: 20 },
  small_fix:        { label: 'Minor repair',          category: 'general_fixing',   unit: 'job',   priceSetup: 35, pricePerUnit: 0,   timeSetup: 15, timePerUnit: 25 },

  // PLUMBING (GAP #1 — 57 lines, two whole trades the card missed)
  fix_tap:          { label: 'Fix / replace tap',     category: 'plumbing_minor',   unit: 'tap',   priceSetup: 45, pricePerUnit: 45,  timeSetup: 10, timePerUnit: 40 },
  fix_toilet:       { label: 'Fix toilet / cistern',  category: 'plumbing_minor',   unit: 'item',  priceSetup: 40, pricePerUnit: 50,  timeSetup: 10, timePerUnit: 45 },
  fit_toilet_seat:  { label: 'Fit toilet seat',       category: 'plumbing_minor',   unit: 'item',  priceSetup: 30, pricePerUnit: 20,  timeSetup: 10, timePerUnit: 20 },
  appliance_install:{ label: 'Install appliance',     category: 'plumbing_minor',   unit: 'item',  priceSetup: 50, pricePerUnit: 45,  timeSetup: 15, timePerUnit: 55 }, // dishwasher/washing machine — water-connected

  // ELECTRICAL (GAP #2 — 37 lines)
  change_light:     { label: 'Change light fitting',  category: 'electrical_minor', unit: 'light', priceSetup: 20, pricePerUnit: 30,  timeSetup: 15, timePerUnit: 25 },
  fit_socket:       { label: 'Fit socket / switch',   category: 'electrical_minor', unit: 'point', priceSetup: 25, pricePerUnit: 40,  timeSetup: 15, timePerUnit: 35 },
  fix_extractor:    { label: 'Fix extractor fan',     category: 'electrical_minor', unit: 'item',  priceSetup: 35, pricePerUnit: 55,  timeSetup: 15, timePerUnit: 50, contingencyPct: 0.15 }, // diagnostic risk

  // CURTAINS / BLINDS
  fit_curtain_pole: { label: 'Fit curtain pole',      category: 'curtain_blinds',   unit: 'pole',  priceSetup: 25, pricePerUnit: 30,  timeSetup: 15, timePerUnit: 30 },
  fit_blind:        { label: 'Fit blind',             category: 'curtain_blinds',   unit: 'blind', priceSetup: 25, pricePerUnit: 30,  timeSetup: 10, timePerUnit: 30 },

  // TV
  tv_mount:         { label: 'TV mount',              category: 'tv_mounting',      unit: 'item',  priceSetup: 30, pricePerUnit: 60,  timeSetup: 10, timePerUnit: 60 }, // +30min if cables concealed

  // KITCHEN
  fit_kitchen_unit: { label: 'Fit kitchen unit',      category: 'kitchen_fitting',  unit: 'unit',  priceSetup: 40, pricePerUnit: 40,  timeSetup: 20, timePerUnit: 45 },

  // SILICONE
  reseal:           { label: 'Re-seal silicone',      category: 'silicone_sealant', unit: 'run',   priceSetup: 25, pricePerUnit: 35,  timeSetup: 10, timePerUnit: 40 },

  // PLASTERING (GAP — 15 lines; the back-test "patch wall/ceiling" bespokes)
  patch_plaster:    { label: 'Patch / fill / make good', category: 'plastering',    unit: 'patch', priceSetup: 45, pricePerUnit: 25,  timeSetup: 15, timePerUnit: 45 },
  skim_wall:        { label: 'Skim plaster',          category: 'plastering',       unit: 'm²',    priceSetup: 50, pricePerUnit: 18,  timeSetup: 30, timePerUnit: 20, needsQty: true },

  // TILING (GAP — 18 lines)
  regrout:          { label: 'Re-grout tiles',        category: 'tiling',           unit: 'm²',    priceSetup: 50, pricePerUnit: 15,  timeSetup: 30, timePerUnit: 12, needsQty: true },
  retile:           { label: 'Tile area',             category: 'tiling',           unit: 'm²',    priceSetup: 60, pricePerUnit: 45,  timeSetup: 30, timePerUnit: 35, needsQty: true },

  // WASTE REMOVAL (GAP — 14 lines)
  clearance:        { label: 'Clearance / disposal',  category: 'waste_removal',    unit: 'load',  priceSetup: 40, pricePerUnit: 80,  timeSetup: 20, timePerUnit: 90 }, // per van load incl. tip run

  // TIME / AREA-SOLD (rails legitimately track each other here)
  jetwash:          { label: 'Pressure wash',         category: 'pressure_washing', unit: 'm²',    priceSetup: 25, pricePerUnit: 5,   timeSetup: 20, timePerUnit: 6,  needsQty: true },
  hedge_trim:       { label: 'Trim hedge',            category: 'garden_maintenance', unit: 'm',   priceSetup: 30, pricePerUnit: 8,   timeSetup: 20, timePerUnit: 15, needsQty: true },
  lay_laminate:     { label: 'Lay laminate floor',    category: 'flooring',         unit: 'm²',    priceSetup: 40, pricePerUnit: 12,  timeSetup: 30, timePerUnit: 18, needsQty: true }, // faster per m² on big rooms
};

// Keyword → task-type matchers (prototype heuristic; order matters, first match wins).
export const MATCHERS: { rx: RegExp; type: keyof typeof RATE_CARD }[] = [
  { rx: /handle|door knob/,                     type: 'fit_handle' },        // before door, so "door handle" ≠ hang_door
  { rx: /plane|planing/,                        type: 'plane_door' },
  { rx: /(hang|fit|install|new|supply).*\bdoors?\b|\bdoors?\b.*(hang|fit|install|supply)/, type: 'hang_door' },
  { rx: /(adjust|align|ease|re-?hang|stick).*(door|hinge)|(door|cupboard|wardrobe).*(hinge|adjust|align)|\bhinges?\b/, type: 'adjust_door' },
  { rx: /paint.*(room|ceiling)/,                type: 'paint_room' },
  { rx: /paint.*(skirting|woodwork|frame|gloss)/, type: 'paint_woodwork' },
  { rx: /paint.*wall|wall.*paint/,              type: 'paint_wall' },
  { rx: /skirting|architrave|coving|\bdado\b/,  type: 'fit_skirting' },      // after paint.*skirting
  { rx: /letterbox/,                            type: 'fit_letterbox' },
  { rx: /toilet seat|loo seat/,                 type: 'fit_toilet_seat' },   // before toilet-roll (fixture) and toilet (plumbing)
  { rx: /curtain (pole|rail|track)/,            type: 'fit_curtain_pole' },  // before fixture (claims "rail")
  { rx: /\bblinds?\b/,                          type: 'fit_blind' },
  { rx: /towel (rail|holder|ring|hook)|toilet roll|roll holder|coat hook|grab rail|robe hook|\bhooks?\b|\brail\b/, type: 'mount_fixture' },
  { rx: /mirror|picture|\bart\b/,               type: 'hang_mirror' },
  { rx: /\b(tvs?|telly|televisions?)\b.{0,15}(mount|wall|bracket)|(mount|wall|bracket).{0,15}\b(tvs?|telly|televisions?)\b/, type: 'tv_mount' }, // needs mount/wall/bracket near "tv" → "TV unit" ≠ mount; handles plural
  { rx: /light fitting|ceiling light|wall light|light fixture|pendant|chandelier|spotlight|downlight|led light|\blights?\b.*(change|fit|replace|install)|(change|fit|replace|install).*\blights?\b/, type: 'change_light' },
  { rx: /socket|\bswitch(es)?\b|fused? spur|\bspur\b|plug point/, type: 'fit_socket' },
  { rx: /extractor|cooker hood|\bfan\b/,        type: 'fix_extractor' },     // "fan" not bare "vent" (passive vent = builder, not electrical)
  { rx: /dishwasher|washing machine|tumble dryer|washer.?dryer|\bappliance\b|(install|fit|plumb).*(oven|hob|fridge|freezer|cooker)/, type: 'appliance_install' },
  { rx: /kitchen (unit|cabinet|cupboard)|base unit|wall unit|plinth|kickboard/, type: 'fit_kitchen_unit' },
  { rx: /flat ?pack|assemble|wardrobe|chest of|bookcase|\bdrawers?\b/, type: 'flatpack' },
  { rx: /re-?grout|grout/,                      type: 'regrout' },           // before generic tile
  { rx: /re-?tile|\btil(e|es|ing)\b/,           type: 'retile' },
  { rx: /patch|fill.*(hole|crack|gap)|fill hole|make good|\bfiller\b/, type: 'patch_plaster' }, // before tap (fill hole around tap)
  { rx: /skim|re-?plaster|plaster(ing)?\b/,     type: 'skim_wall' },
  { rx: /shelf|shelves|shelving/,               type: 'shelf' },
  { rx: /re-?seal|silicone|caulk|sealant/,      type: 'reseal' },
  { rx: /jet ?wash|pressure ?wash/,             type: 'jetwash' },
  { rx: /hedge|prune|trim.*(hedge|bush|shrub|tree)/, type: 'hedge_trim' },
  { rx: /laminate|\blvt\b|vinyl (plank|floor|tile)|lay.*floor|floor.*lay|flooring/, type: 'lay_laminate' },
  { rx: /\btap\b|mixer tap/,                    type: 'fix_tap' },
  { rx: /toilet|cistern|\bflush\b|\bwc\b/,      type: 'fix_toilet' },
  { rx: /clear(ance|ing)?|rubbish|\bwaste\b|dispos(e|al)|\bskip\b|tip run|\bjunk\b|debris/, type: 'clearance' },
  { rx: /odd job|small repair|minor|tighten|re-?fix/, type: 'small_fix' },  // generic fallback
];

// ── Parse a free-text job item → { type, qty } ───────────────────────────────────
export function parseItem(text: string): { type: keyof typeof RATE_CARD | null; qty: number; qtyExplicit: boolean } {
  const t = text.toLowerCase();
  const qtyMatch = t.match(/(\d+)\s*x?\b/);            // "3x", "3 " → 3
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1; // no number ⇒ 1 ("fit new letterbox")
  const m = MATCHERS.find((x) => x.rx.test(t));
  return { type: m ? m.type : null, qty, qtyExplicit: !!qtyMatch };
}

// ── The two rails ────────────────────────────────────────────────────────────────
export function priceOf(task: Task, qty: number): number {
  const base = task.priceSetup + task.pricePerUnit * qty;
  return Math.round(base * (1 + (task.contingencyPct ?? 0)));
}
export function timeMinOf(task: Task, qty: number): number {
  const perUnit = task.actualPerUnit ?? task.timePerUnit; // contractor actuals override the estimate
  const base = task.timeSetup + perUnit * qty;
  return Math.round(base * (1 + BUFFER_PCT));
}

// ── TEST JOBS — edit / add your own. Each job is a list of item strings. ──────────
const TEST_JOBS: { name: string; items: string[] }[] = [
  {
    name: 'Sample job',
    items: [
      'plane 3x internal doors',
      'paint 2x walls',
      'fit new letterbox',
      'fit 3x curtain poles',
    ],
  },
  {
    name: 'Mixed handyman day',
    items: [
      'hang 2x internal doors',
      'paint 1x room',
      'fit door handle',
      'put up 3x shelves',
      'reseal bath',
    ],
  },
  {
    name: 'Outdoor + floors',
    items: [
      'jetwash 40 m² patio',
      'trim 12 m hedge',
      'lay 18 m² laminate',
    ],
  },
  {
    name: 'Plumbing + electrical call-out',
    items: [
      'replace kitchen tap',
      'change 4 ceiling lights',
      'fix extractor fan',
      'mount 3 towel holders',
      'patch wall',
    ],
  },
];

// ── Run (demo — only when this file is executed directly) ────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

for (const job of TEST_JOBS) {
  console.log(`\n══ ${job.name} ══════════════════════════════════════════════════════`);
  console.log(`  ${pad('ITEM', 28)}${pad('CLASSIFIED', 26)}${padL('PRICE', 8)}${padL('TIME', 9)}`);
  console.log('  ' + '─'.repeat(69));
  let totalPrice = 0, totalMin = 0;
  const bespoke: string[] = [];
  for (const text of job.items) {
    const { type, qty, qtyExplicit } = parseItem(text);
    if (!type) { bespoke.push(text); console.log(`  ${pad(text, 28)}${pad('⚠ no rate-card match', 26)}${padL('—', 8)}${padL('assess', 9)}`); continue; }
    const task = RATE_CARD[type];
    if (task.needsQty && !qtyExplicit) { console.log(`  ${pad(text, 28)}${pad(`${task.category} · needs ${task.unit}`, 26)}${padL('measure', 8)}${padL('on-site', 9)}`); continue; }
    const price = priceOf(task, qty);
    const min = timeMinOf(task, qty);
    totalPrice += price; totalMin += min;
    console.log(`  ${pad(text, 28)}${pad(`${task.category} · ${task.unit}×${qty}`, 26)}${padL('£' + price, 8)}${padL((min / 60).toFixed(1) + 'h', 9)}`);
  }
  console.log('  ' + '─'.repeat(69));
  const days = Math.max(1, Math.round(totalMin / DAY_MINUTES));
  console.log(`  ${pad('TOTAL', 54)}${padL('£' + totalPrice, 8)}${padL((totalMin / 60).toFixed(1) + 'h', 9)}`);
  console.log(`  ${pad('', 54)}${padL('', 8)}${padL('→ ~' + days + ' day' + (days === 1 ? '' : 's'), 12)}`);
  if (bespoke.length) console.log(`  bespoke (assess on site): ${bespoke.join('; ')}`);
}

console.log(`\n  PRICE rail = customer £ (history-seeded, margin-in-price).  TIME rail = authored ` +
  `dispatch hours (+${Math.round(BUFFER_PCT * 100)}% buffer), refined by contractor actuals.  ` +
  `Computed independently — neither inflates the other.`);
console.log(`  Tune: edit RATE_CARD (price = history, time = trade norms → actuals) + TEST_JOBS, then re-run.\n`);
}
