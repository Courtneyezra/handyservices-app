// Bespoke pricing for the Sidney Road customer plan page (/plan/:slug).
// SINGLE SOURCE OF TRUTH: the client renders from this and shows the live deposit
// + rough time; the server recomputes the deposit from the same table before
// creating a Stripe Checkout session (never trust a client-sent amount).
//
// Deposit model (agreed): 30% of labour + 100% of materials, per selected line.
// `days` = rough working-days of effort for that line (a guide, not a hard date).

export type PlanOption = { label: string; price: number; labour: number; materials: number; days: number };

export type PlanItem =
  | { id: string; kind: "add"; group: string; title: string; desc: string; price: number; labour: number; materials: number; days: number }
  | { id: string; kind: "opt"; group: string; title: string; desc: string; options: PlanOption[] };

export const DEPOSIT_LABOUR_RATE = 0.30; // 30% of labour taken up front

export const PLAN_ITEMS: PlanItem[] = [
  // ---- Upstairs ----
  { id: "bay-walls", kind: "opt", group: "Upstairs", title: "Front bay bedroom — walls",
    desc: "Take down the old mirror and light, make good, and re-paper in thick, textured (paintable) paper that hides imperfections. The room’s already painted; this sorts the wallpaper. Your new carpet is fully protected throughout.",
    options: [
      { label: "One wall re-papered", price: 295, labour: 250, materials: 45, days: 0.5 },
      { label: "Whole room re-papered — fixes the mismatch", price: 750, labour: 610, materials: 140, days: 1.5 },
      { label: "Not now", price: 0, labour: 0, materials: 0, days: 0 },
    ] },
  { id: "bay-ceiling", kind: "add", group: "Upstairs", title: "Front bay bedroom — ceiling repair",
    desc: "Repair the missing woodchip section where the old strip-light was and fill the hole in the plaster, then strip, re-paper and paint.", price: 320, labour: 265, materials: 55, days: 1 },
  { id: "small-room", kind: "opt", group: "Upstairs", title: "Small front room — one wall",
    desc: "Strip the one wall back and finish it. The ceiling’s fine. Choose the finish once the paper’s off:",
    options: [
      { label: "Lining paper", price: 260, labour: 220, materials: 40, days: 0.5 },
      { label: "Skim (smoother finish)", price: 330, labour: 285, materials: 45, days: 1 },
      { label: "Not now", price: 0, labour: 0, materials: 0, days: 0 },
    ] },
  { id: "hall-ceiling", kind: "add", group: "Upstairs", title: "Upstairs hallway ceiling",
    desc: "Strip and re-finish the hallway ceiling — worked safely on a proper platform over the staircase.", price: 650, labour: 560, materials: 90, days: 1.5 },
  { id: "up-bathroom", kind: "add", group: "Upstairs", title: "Upstairs bathroom",
    desc: "Re-grout, fill the cracks, repair the ceiling and walls, then decorate throughout.", price: 870, labour: 720, materials: 150, days: 2 },
  { id: "bath-cupboard", kind: "add", group: "Upstairs", title: "Bathroom cupboard",
    desc: "Prep, prime and gloss the cupboard front and shelves.", price: 150, labour: 125, materials: 25, days: 0.5 },
  { id: "bay-sections", kind: "add", group: "Upstairs", title: "The two re-plastered bay sections",
    desc: "Paper over the two freshly-plastered bay-window sections to finish them off — labour only (you supply the paper).", price: 200, labour: 200, materials: 0, days: 0.5 },

  // ---- Downstairs ----
  { id: "entrance-wall", kind: "add", group: "Downstairs", title: "Entrance wall — as you come in",
    desc: "Skim the wall on the right as you come through the front door, and make good.", price: 350, labour: 295, materials: 55, days: 0.5 },
  { id: "halls-stairs", kind: "add", group: "Downstairs", title: "Halls & stairs",
    desc: "The whole downstairs hallway, the landing and the stairwell — thick, textured (paintable) paper and decorated so it all ties together and hides any wall imperfections.", price: 1650, labour: 1420, materials: 230, days: 3 },
  { id: "kitchen-paint", kind: "add", group: "Downstairs", title: "Kitchen — cracks & repaint",
    desc: "Fill all the cracks and repaint the kitchen ceiling and walls.", price: 460, labour: 380, materials: 80, days: 1.5 },
  { id: "kitchen-grout", kind: "add", group: "Downstairs", title: "Kitchen — re-grout tiles",
    desc: "Rake out and re-grout the kitchen tiling for a clean, fresh finish.", price: 220, labour: 170, materials: 50, days: 0.5 },
  { id: "kitchen-check", kind: "add", group: "Downstairs", title: "Kitchen — check the damp behind the corner unit",
    desc: "We won’t guess at the mould. We’ll take out the corner unit to see the actual wall, find the real cause, then price the fix properly — so you never pay for work you don’t need.", price: 150, labour: 140, materials: 10, days: 0.5 },

  // ---- Doors, banister & archway ----
  { id: "doors", kind: "add", group: "Doors, banister & archway", title: "5 internal doors",
    desc: "Prep, prime and paint all five doors.", price: 360, labour: 300, materials: 60, days: 1.5 },
  { id: "banister", kind: "add", group: "Doors, banister & archway", title: "Staircase banister",
    desc: "Sand, prime and gloss the banister.", price: 290, labour: 255, materials: 35, days: 1 },
  { id: "archway", kind: "add", group: "Doors, banister & archway", title: "Archway",
    desc: "Re-form the archway above the door.", price: 325, labour: 280, materials: 45, days: 0.5 },

  // ---- Finishing — throughout the house ----
  { id: "gloss-woodwork", kind: "add", group: "Finishing — throughout the house", title: "Gloss all woodwork throughout",
    desc: "Prep, prime and gloss every door frame, skirting board and radiator pipe across the whole house for a clean, consistent finish.", price: 780, labour: 680, materials: 100, days: 3 },
  { id: "window-sills", kind: "add", group: "Finishing — throughout the house", title: "Window sills glossed (×8)",
    desc: "Sand, prime and gloss all eight internal window sills.", price: 240, labour: 210, materials: 30, days: 1 },
  { id: "attic-hatch", kind: "add", group: "Finishing — throughout the house", title: "Attic hatch glossed",
    desc: "Prep and gloss the loft/attic hatch to match.", price: 45, labour: 38, materials: 7, days: 0.15 },
  { id: "light-switches", kind: "add", group: "Finishing — throughout the house", title: "Light switches replaced (×9)",
    desc: "Swap out nine tired light switches for fresh standard white switches — safely isolated, fitted and tested. Switches supplied.", price: 200, labour: 155, materials: 45, days: 0.5 },
  { id: "door-handles", kind: "add", group: "Finishing — throughout the house", title: "Internal door handles changed (×8)",
    desc: "Replace eight internal door handles with fresh standard chrome handles. Handles supplied.", price: 220, labour: 140, materials: 80, days: 0.5 },
  { id: "skirting-section", kind: "add", group: "Finishing — throughout the house", title: "Skirting board — supply & fit (1.5m)",
    desc: "Supply and fit a ~1.5m run of skirting board, filled and ready to gloss.", price: 100, labour: 75, materials: 25, days: 0.25 },
];

export type Selection = { id: string; opt?: number };

function partsFor(item: PlanItem, optIdx?: number): { price: number; labour: number; materials: number; days: number; label?: string } | null {
  if (item.kind === "add") return { price: item.price, labour: item.labour, materials: item.materials, days: item.days };
  const o = item.options[optIdx ?? -1];
  if (!o || o.price <= 0) return null;
  return { price: o.price, labour: o.labour, materials: o.materials, days: o.days, label: o.label };
}

export function computePlan(selection: Selection[]) {
  const byId = new Map(PLAN_ITEMS.map((i) => [i.id, i]));
  let total = 0, labour = 0, materials = 0, days = 0;
  const lines: { id: string; title: string; price: number; deposit: number }[] = [];
  for (const sel of selection) {
    const item = byId.get(sel.id);
    if (!item) continue;
    const p = partsFor(item, sel.opt);
    if (!p) continue;
    const dep = Math.round(p.labour * DEPOSIT_LABOUR_RATE + p.materials);
    total += p.price; labour += p.labour; materials += p.materials; days += p.days;
    lines.push({ id: item.id, title: item.title + (p.label ? ` — ${p.label}` : ""), price: p.price, deposit: dep });
  }
  const deposit = Math.round(labour * DEPOSIT_LABOUR_RATE + materials);
  return { total, labour, materials, deposit, days, lines };
}
