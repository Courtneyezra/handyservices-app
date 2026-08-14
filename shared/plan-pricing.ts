// Bespoke pricing for the Sidney Road customer plan page (/plan/:slug).
// SINGLE SOURCE OF TRUTH: the client renders from this and shows the live deposit;
// the server recomputes the deposit from the same table before creating a Stripe
// Checkout session (never trust a client-sent amount).
//
// Deposit model (agreed): 30% of labour + 100% of materials, per selected line.
// Materials = paper / paint / plaster / grout / skip etc.; the rest is labour.

export type PlanOption = { label: string; price: number; labour: number; materials: number };

export type PlanItem =
  | { id: string; kind: "add"; group: string; title: string; desc: string; price: number; labour: number; materials: number }
  | { id: string; kind: "opt"; group: string; title: string; desc: string; options: PlanOption[] };

export const DEPOSIT_LABOUR_RATE = 0.30; // 30% of labour taken up front

export const PLAN_ITEMS: PlanItem[] = [
  // ---- Upstairs ----
  { id: "bay-walls", kind: "opt", group: "Upstairs", title: "Front bay bedroom — walls",
    desc: "Take down the old mirror and light, make good, and re-paper. The room’s already painted; this sorts the wallpaper. Your new carpet is fully protected throughout.",
    options: [
      { label: "One wall re-papered", price: 295, labour: 250, materials: 45 },
      { label: "Whole room re-papered — fixes the mismatch", price: 750, labour: 610, materials: 140 },
      { label: "Not now", price: 0, labour: 0, materials: 0 },
    ] },
  { id: "bay-ceiling", kind: "add", group: "Upstairs", title: "Front bay bedroom — ceiling repair",
    desc: "Repair the missing woodchip section where the old strip-light was and fill the hole in the plaster, then strip, re-paper and paint.", price: 320, labour: 265, materials: 55 },
  { id: "small-room", kind: "opt", group: "Upstairs", title: "Small front room — one wall",
    desc: "Strip the one wall back and finish it. The ceiling’s fine. Choose the finish once the paper’s off:",
    options: [
      { label: "Lining paper", price: 260, labour: 220, materials: 40 },
      { label: "Skim (smoother finish)", price: 330, labour: 285, materials: 45 },
      { label: "Not now", price: 0, labour: 0, materials: 0 },
    ] },
  { id: "hall-ceiling", kind: "add", group: "Upstairs", title: "Upstairs hallway ceiling",
    desc: "Strip and re-finish the hallway ceiling — worked safely on a proper platform over the staircase.", price: 650, labour: 560, materials: 90 },
  { id: "top-stairs", kind: "add", group: "Upstairs", title: "Top of the stairs — wall",
    desc: "Plaster the wall on the right as you reach the top of the stairs, then paper it.", price: 320, labour: 260, materials: 60 },
  { id: "up-bathroom", kind: "add", group: "Upstairs", title: "Upstairs bathroom",
    desc: "Re-grout, fill the cracks, repair the ceiling and walls, then decorate throughout.", price: 870, labour: 720, materials: 150 },
  { id: "bath-cupboard", kind: "add", group: "Upstairs", title: "Bathroom cupboard",
    desc: "Prep, prime and gloss the cupboard front and shelves.", price: 150, labour: 125, materials: 25 },
  { id: "bay-sections", kind: "add", group: "Upstairs", title: "The two re-plastered bay sections",
    desc: "Paper over the two freshly-plastered sections under the bay windows to finish them off.", price: 200, labour: 165, materials: 35 },

  // ---- Downstairs ----
  { id: "entrance-wall", kind: "add", group: "Downstairs", title: "Entrance wall — as you come in",
    desc: "Skim the wall on the right as you come through the front door, and make good.", price: 350, labour: 295, materials: 55 },
  { id: "halls-stairs", kind: "add", group: "Downstairs", title: "Halls & stairs",
    desc: "The whole downstairs hallway, the landing and the stairwell — fresh lining paper and decorated so it all ties together.", price: 1450, labour: 1230, materials: 220 },
  { id: "back-ceiling", kind: "add", group: "Downstairs", title: "Back room ceiling",
    desc: "Repair the downstairs back-room ceiling.", price: 280, labour: 235, materials: 45 },
  { id: "kitchen-paint", kind: "add", group: "Downstairs", title: "Kitchen — cracks & repaint",
    desc: "Fill all the cracks and repaint the kitchen ceiling and walls.", price: 460, labour: 380, materials: 80 },
  { id: "kitchen-grout", kind: "add", group: "Downstairs", title: "Kitchen — re-grout tiles",
    desc: "Rake out and re-grout the kitchen tiling for a clean, fresh finish.", price: 220, labour: 170, materials: 50 },
  { id: "kitchen-check", kind: "add", group: "Downstairs", title: "Kitchen — check the damp behind the corner unit",
    desc: "We won’t guess at the mould. We’ll take out the corner unit to see the actual wall, find the real cause, then price the fix properly — so you never pay for work you don’t need.", price: 150, labour: 140, materials: 10 },

  // ---- Doors, banister & archway ----
  { id: "doors", kind: "add", group: "Doors, banister & archway", title: "5 internal doors",
    desc: "Prep, prime and paint all five doors.", price: 360, labour: 300, materials: 60 },
  { id: "banister", kind: "add", group: "Doors, banister & archway", title: "Staircase banister",
    desc: "Sand, prime and gloss the banister.", price: 190, labour: 160, materials: 30 },
  { id: "archway", kind: "add", group: "Doors, banister & archway", title: "Archway",
    desc: "Re-form the archway above the door.", price: 220, labour: 180, materials: 40 },
  { id: "waste", kind: "add", group: "Doors, banister & archway", title: "Waste removal",
    desc: "Clear away all the strip-out and plaster waste from the works above.", price: 250, labour: 0, materials: 250 },
];

export type Selection = { id: string; opt?: number };

function partsFor(item: PlanItem, optIdx?: number): { price: number; labour: number; materials: number; label?: string } | null {
  if (item.kind === "add") return { price: item.price, labour: item.labour, materials: item.materials };
  const o = item.options[optIdx ?? -1];
  if (!o || o.price <= 0) return null;
  return { price: o.price, labour: o.labour, materials: o.materials, label: o.label };
}

export function computePlan(selection: Selection[]) {
  const byId = new Map(PLAN_ITEMS.map((i) => [i.id, i]));
  let total = 0, labour = 0, materials = 0;
  const lines: { id: string; title: string; price: number; deposit: number }[] = [];
  for (const sel of selection) {
    const item = byId.get(sel.id);
    if (!item) continue;
    const p = partsFor(item, sel.opt);
    if (!p) continue;
    const dep = Math.round(p.labour * DEPOSIT_LABOUR_RATE + p.materials);
    total += p.price; labour += p.labour; materials += p.materials;
    lines.push({ id: item.id, title: item.title + (p.label ? ` — ${p.label}` : ""), price: p.price, deposit: dep });
  }
  const deposit = Math.round(labour * DEPOSIT_LABOUR_RATE + materials);
  return { total, labour, materials, deposit, lines };
}
