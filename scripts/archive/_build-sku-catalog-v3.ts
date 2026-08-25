/**
 * SKU Catalog v3 — PROPOSAL BUILDER (no DB writes).
 *
 * Holds the human-designed ~150 SKU catalog as structured data, then emits:
 *   - scripts/data/sku-catalog-v3.json   (machine-readable, for a later seed)
 *   - docs/sku-catalog-v3-proposal.md     (human review document)
 *
 * Naming + clustering + pricing were done by Claude's own reasoning, anchored
 * to historical medians from /tmp/agent25a-lineitems.json where data exists,
 * and UK-market estimates otherwise. UK English throughout.
 *
 * READ-ONLY against prod: only reads the cached line-item snapshot for the
 * coverage estimate. Writes nothing to the database.
 */

import fs from "fs";
import path from "path";

type Shape = "fixed" | "per_unit" | "tiered";
type Conf = "high" | "medium" | "low";
type Tier = { label: string; pricePence: number; scheduleMinutes: number };

interface Sku {
  sku_code: string;
  name: string;
  category: string;
  shape: Shape;
  // fixed
  price_pence?: number | null;
  schedule_minutes?: number | null;
  // per_unit
  price_per_unit_pence?: number | null;
  unit_label?: string | null;
  minimum_units?: number | null;
  minutes_per_unit?: number | null;
  setup_minutes?: number | null;
  // tiered
  tiers?: Tier[] | null;
  // common
  customer_description: string;
  admin_description: string;
  flex_eligible: boolean;
  off_peak_weekend_premium_pence: number;
  // proposal-only meta (stripped is fine for the seed)
  _confidence: Conf;
  _priceBasis: string;
  _origin: "carryover-renamed" | "split" | "new" | "carryover";
}

const P = (pounds: number) => Math.round(pounds) * 100; // pounds -> pence

// Helper builders to keep the list readable
function fixed(o: {
  code: string; name: string; cat: string; price: number; mins: number;
  cust: string; admin: string; conf: Conf; basis: string; origin: Sku["_origin"];
  flex?: boolean; premium?: number;
}): Sku {
  return {
    sku_code: o.code, name: o.name, category: o.cat, shape: "fixed",
    price_pence: P(o.price), schedule_minutes: o.mins,
    price_per_unit_pence: null, unit_label: null, minimum_units: null,
    minutes_per_unit: null, setup_minutes: null, tiers: null,
    customer_description: o.cust, admin_description: o.admin,
    flex_eligible: o.flex ?? true, off_peak_weekend_premium_pence: o.premium ?? 4000,
    _confidence: o.conf, _priceBasis: o.basis, _origin: o.origin,
  };
}
function unit(o: {
  code: string; name: string; cat: string; perUnit: number; label: string;
  minUnits: number; minsPer: number; setup: number;
  cust: string; admin: string; conf: Conf; basis: string; origin: Sku["_origin"];
  flex?: boolean; premium?: number;
}): Sku {
  return {
    sku_code: o.code, name: o.name, category: o.cat, shape: "per_unit",
    price_pence: null, schedule_minutes: null,
    price_per_unit_pence: P(o.perUnit), unit_label: o.label,
    minimum_units: o.minUnits, minutes_per_unit: o.minsPer, setup_minutes: o.setup,
    tiers: null,
    customer_description: o.cust, admin_description: o.admin,
    flex_eligible: o.flex ?? true, off_peak_weekend_premium_pence: o.premium ?? 2000,
    _confidence: o.conf, _priceBasis: o.basis, _origin: o.origin,
  };
}
function tiered(o: {
  code: string; name: string; cat: string;
  tiers: [string, number, number][]; // [label, pounds, mins]
  cust: string; admin: string; conf: Conf; basis: string; origin: Sku["_origin"];
  flex?: boolean; premium?: number;
}): Sku {
  return {
    sku_code: o.code, name: o.name, category: o.cat, shape: "tiered",
    price_pence: null, schedule_minutes: null,
    price_per_unit_pence: null, unit_label: null, minimum_units: null,
    minutes_per_unit: null, setup_minutes: null,
    tiers: o.tiers.map(([label, pounds, mins]) => ({ label, pricePence: P(pounds), scheduleMinutes: mins })),
    customer_description: o.cust, admin_description: o.admin,
    flex_eligible: o.flex ?? true, off_peak_weekend_premium_pence: o.premium ?? 4000,
    _confidence: o.conf, _priceBasis: o.basis, _origin: o.origin,
  };
}

const catalog: Sku[] = [];

// ===========================================================================
// PLUMBING (minor) — historical n=50, median £85
// ===========================================================================
catalog.push(
  fixed({ code: "TAP-KIT-01", name: "Kitchen tap swap", cat: "plumbing_minor", price: 85, mins: 60,
    cust: "We swap your kitchen tap for a new one — isolated, fitted and leak-tested, with the old one taken away.",
    admin: "Pick for a kitchen mixer/tap replacement. Customer or we-supply tap.",
    conf: "high", basis: "median of ~12 historical tap swaps", origin: "split" }),
  fixed({ code: "TAP-BATH-01", name: "Bathroom tap swap", cat: "plumbing_minor", price: 80, mins: 50,
    cust: "We replace a basin or bath tap with a new one, fully fitted and tested for a clean, drip-free finish.",
    admin: "Basin/bath tap swap. For both taps on a basin, set unit count or add a second line.",
    conf: "high", basis: "median historical tap swaps", origin: "split" }),
  fixed({ code: "TAP-REPAIR-01", name: "Dripping tap repair", cat: "plumbing_minor", price: 72, mins: 45,
    cust: "We stop the drip — new washer, cartridge or ceramic barrel — so your tap works like new.",
    admin: "Repair (not replace) a leaking tap: cartridge/washer/barrel. Historical £72-85.",
    conf: "high", basis: "median of historical tap repairs (£72-85)", origin: "split" }),
  fixed({ code: "TAP-OUT-01", name: "Outside tap fit", cat: "plumbing_minor", price: 120, mins: 90,
    cust: "We fit a new outdoor tap, neatly plumbed from your supply and ready for the hose.",
    admin: "New external tap incl. short pipe run. Historical £117-205 for bigger runs.",
    conf: "high", basis: "historical outside tap £117", origin: "split" }),
  fixed({ code: "TAP-CART-01", name: "Tap cartridge replacement", cat: "plumbing_minor", price: 85, mins: 45,
    cust: "We replace the worn cartridge inside your mixer tap to bring back smooth control and stop leaks.",
    admin: "Ceramic cartridge swap on a mixer. Use when only the cartridge is the issue.",
    conf: "medium", basis: "historical cartridge £85-102", origin: "split" }),
  fixed({ code: "TOI-REPAIR-01", name: "Toilet repair", cat: "plumbing_minor", price: 85, mins: 60,
    cust: "We fix a running, leaking or weak-flushing toilet — fill valve, flush mechanism or syphon sorted.",
    admin: "Mechanism repairs: fill valve, flush, syphon. Not a pan swap (use TOI-SWAP).",
    conf: "high", basis: "median historical toilet repair £85", origin: "split" }),
  fixed({ code: "TOI-SWAP-01", name: "Toilet replacement", cat: "plumbing_minor", price: 135, mins: 120,
    cust: "We remove your old toilet and fit a new one — connected, sealed and leak-tested.",
    admin: "Full pan/cistern swap. Like-for-like. Historical £135.",
    conf: "high", basis: "historical new toilet £135", origin: "split" }),
  fixed({ code: "TOI-SEAT-01", name: "Toilet seat fit", cat: "plumbing_minor", price: 55, mins: 30,
    cust: "We fit a new toilet seat securely, with no wobble.",
    admin: "Toilet seat + bracket. Quick job. Historical £55-85.",
    conf: "high", basis: "historical seat fit £55-85", origin: "new", premium: 0 }),
  fixed({ code: "TOI-UNBLK-01", name: "Toilet unblocking", cat: "plumbing_minor", price: 90, mins: 60,
    cust: "We clear the blockage and get your toilet flushing freely again.",
    admin: "Toilet blockage clear. Not for soil-stack/drainage faults.",
    conf: "medium", basis: "historical unblock £90", origin: "new", flex: false, premium: 0 }),
  fixed({ code: "DRAIN-UNBLK-01", name: "Sink or shower drain unblock", cat: "plumbing_minor", price: 75, mins: 50,
    cust: "We clear a slow or blocked sink, basin or shower drain so water runs away properly.",
    admin: "Trap/waste blockage on sink/basin/shower. Historical unblock shower drain £68.",
    conf: "medium", basis: "historical drain unblock £68", origin: "new", premium: 0 }),
  fixed({ code: "LEAK-FIND-01", name: "Leak find & fix", cat: "plumbing_minor", price: 75, mins: 75,
    cust: "We track down where the water's coming from, fix it where we can, and tell you plainly what's next.",
    admin: "Visible leak not tied to a specific fixture. Carry-over of LEAK-07.",
    conf: "high", basis: "median historical leak £68-90", origin: "carryover-renamed" }),
  fixed({ code: "SHWR-FIX-01", name: "Shower unit repair or swap", cat: "plumbing_minor", price: 90, mins: 75,
    cust: "We repair or replace your shower so it runs at a safe temperature with a strong, steady flow.",
    admin: "Shower MECHANISM (mixer/electric unit), not the enclosure or tiling. Carry-over SHWR-04.",
    conf: "high", basis: "historical shower unit £90-176", origin: "carryover-renamed" }),
  fixed({ code: "SHWR-BAR-01", name: "Bar mixer & riser fit", cat: "plumbing_minor", price: 175, mins: 120,
    cust: "We supply or fit a bar mixer shower with riser rail and head, leak-tested and ready to use.",
    admin: "Bar mixer + riser + head. Historical £176-198.",
    conf: "medium", basis: "historical bar mixer £176-198", origin: "split" }),
  fixed({ code: "SHWR-HOSE-01", name: "Shower hose or head swap", cat: "plumbing_minor", price: 45, mins: 30,
    cust: "We replace a perished shower hose or worn head for a fresh, leak-free fit.",
    admin: "Hose/head only. Historical £23-95 (often paired). Small job.",
    conf: "medium", basis: "historical hose/head £45-95", origin: "new", premium: 0 }),
  fixed({ code: "RAD-SWAP-01", name: "Radiator swap", cat: "plumbing_minor", price: 110, mins: 90,
    cust: "We remove your old radiator and fit a new one — drained down, refitted, bled and balanced.",
    admin: "Like-for-like rad swap. Historical remove+refit rads £113. Carry-over RAD-06 split.",
    conf: "high", basis: "historical rad swap £105-113", origin: "split" }),
  fixed({ code: "RAD-TOWEL-01", name: "Heated towel rail fit", cat: "plumbing_minor", price: 105, mins: 90,
    cust: "We fit a heated towel rail, plumbed in and tested, for a warm bathroom finish.",
    admin: "New/replacement towel rail. Historical £105.",
    conf: "high", basis: "historical towel rail £105", origin: "split" }),
  fixed({ code: "RAD-BLEED-01", name: "Radiator bleed & balance", cat: "plumbing_minor", price: 55, mins: 45,
    cust: "We bleed your radiators and balance the system so every room heats evenly.",
    admin: "Cold-at-top rads, uneven heating. Small visit. No historical exact match.",
    conf: "medium", basis: "UK market estimate", origin: "new", premium: 0 }),
  fixed({ code: "BALLV-01", name: "Stopcock or valve swap", cat: "plumbing_minor", price: 95, mins: 75,
    cust: "We replace a seized or leaking stopcock or isolation valve so you can shut water off with confidence.",
    admin: "Stopcock/isolation valve. Historical remove+fit stopcock £117.",
    conf: "medium", basis: "historical stopcock £117", origin: "new" }),
  fixed({ code: "WHEAT-01", name: "Water heater swap", cat: "plumbing_minor", price: 185, mins: 150,
    cust: "We replace an under-sink or point-of-use water heater, connected and tested.",
    admin: "Point-of-use heater swap. Historical £185. Not full boiler (out of scope).",
    conf: "low", basis: "single historical £185 — verify scope", origin: "new" }),
  fixed({ code: "WASH-PLUMB-01", name: "Washer/dishwasher plumb-in", cat: "plumbing_minor", price: 80, mins: 60,
    cust: "We plumb in your washing machine or dishwasher — water, waste and a leak check before we leave.",
    admin: "Appliance plumb-in on existing supply. Drilling cupboard inlet £113 historical.",
    conf: "medium", basis: "historical inlet drill £113; UK estimate", origin: "new" }),
);

// ===========================================================================
// SILICONE / SEALANT — historical n=39, median £62 (most repeated SKU family)
// ===========================================================================
catalog.push(
  fixed({ code: "SIL-BATH-01", name: "Re-seal a bath", cat: "silicone_sealant", price: 55, mins: 60,
    cust: "We strip the old sealant around your bath, treat the mould, and lay a fresh mould-resistant bead for a clean, watertight finish.",
    admin: "Single bath perimeter re-seal. The single most repeated job. Historical £38-88.",
    conf: "high", basis: "median historical bath re-seal £55", origin: "split", premium: 2000 }),
  fixed({ code: "SIL-SHWR-01", name: "Re-seal a shower", cat: "silicone_sealant", price: 60, mins: 65,
    cust: "We cut out the failed sealant in your shower, kill any mould, and re-seal to stop leaks and keep it looking fresh.",
    admin: "Shower tray/screen re-seal. Historical £55-108.",
    conf: "high", basis: "median historical shower re-seal £55-95", origin: "split", premium: 2000 }),
  fixed({ code: "SIL-SINK-01", name: "Re-seal a sink or worktop", cat: "silicone_sealant", price: 55, mins: 50,
    cust: "We re-seal around your sink or where the worktop meets the tiles, for a tidy, water-tight join.",
    admin: "Kitchen sink/worktop junction re-seal. Historical £38-72.",
    conf: "high", basis: "median historical sink re-seal £55", origin: "split", premium: 2000 }),
  fixed({ code: "SIL-WIN-01", name: "Re-seal a window", cat: "silicone_sealant", price: 60, mins: 50,
    cust: "We remove tired sealant around a window and re-seal it cleanly to keep draughts and damp out.",
    admin: "Window perimeter re-seal/caulk. Historical £55-83.",
    conf: "medium", basis: "historical window re-seal £55-83", origin: "split", premium: 2000 }),
  fixed({ code: "CAULK-01", name: "Caulk gaps & trims", cat: "silicone_sealant", price: 65, mins: 60,
    cust: "We fill and smooth gaps around trims, skirting or splashbacks for a crisp, finished look.",
    admin: "Decorator's caulk on gaps/trim edges. Historical caulk tile trim £98.",
    conf: "medium", basis: "historical caulk £55-98", origin: "new", premium: 2000 }),
);

// ===========================================================================
// GENERAL FIXING — historical n=61, median £65 (big mixed bucket)
// ===========================================================================
catalog.push(
  unit({ code: "HANG-PIC-01", name: "Hang pictures & frames", cat: "general_fixing", perUnit: 25, label: "item",
    minUnits: 1, minsPer: 25, setup: 20,
    cust: "We hang your pictures, frames or canvases level and secure, with the right fixings for your wall.",
    admin: "Per item. Light frames/canvas/art. Heavy mirrors use HANG-MIR.",
    conf: "high", basis: "split from PIC-25 (per-item £83 was over-broad)", origin: "split", premium: 2000 }),
  unit({ code: "HANG-MIR-01", name: "Hang a mirror", cat: "general_fixing", perUnit: 55, label: "mirror",
    minUnits: 1, minsPer: 50, setup: 20,
    cust: "We mount your mirror securely and perfectly level, with fixings suited to the weight and wall.",
    admin: "Per mirror. Historical install wall mirror £55-72. Heavy (>20kg) flag.",
    conf: "high", basis: "historical mirror £55-72", origin: "split", premium: 2000 }),
  unit({ code: "HANG-CLK-01", name: "Hang clocks, signs & hooks", cat: "general_fixing", perUnit: 45, label: "item",
    minUnits: 1, minsPer: 30, setup: 20,
    cust: "We fix clocks, signs, hooks or small wall items neatly and securely where you want them.",
    admin: "Per small wall item. Historical hooks/clocks/signs £45-55. Min call-out applies.",
    conf: "high", basis: "historical small hang £45-55", origin: "new", premium: 0 }),
  fixed({ code: "FILL-HOLE-01", name: "Fill holes & cracks", cat: "general_fixing", price: 65, mins: 60,
    cust: "We fill holes and cracks, sand them back and leave the wall smooth and ready to paint.",
    admin: "Filler work. Carry-over FILL-55. If paired with paint prefer touch-up.",
    conf: "high", basis: "median historical fill £45-75", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "KEYSAFE-01", name: "Key safe fit", cat: "general_fixing", price: 75, mins: 60,
    cust: "We fit a secure key safe to your wall so trusted people can get in without a spare key floating about.",
    admin: "Wall-mounted key safe. Historical install key safe + cut key £85.",
    conf: "high", basis: "historical key safe £85", origin: "new", premium: 0 }),
  unit({ code: "FLYSCRN-01", name: "Fit fly screens", cat: "general_fixing", perUnit: 35, label: "window",
    minUnits: 1, minsPer: 50, setup: 20,
    cust: "We fit insect screens to your windows so you can let air in and keep the bugs out.",
    admin: "Per window. Historical fly screens 3 windows £105 (£35 each).",
    conf: "medium", basis: "historical fly screens £35/window", origin: "new", premium: 0 }),
  unit({ code: "DRSTOP-01", name: "Fit door stops", cat: "general_fixing", perUnit: 9, label: "stop",
    minUnits: 4, minsPer: 12, setup: 20,
    cust: "We fit door stops to protect your walls and handles from knocks.",
    admin: "Per stop, min 4. Historical 12 doorstops £105.",
    conf: "medium", basis: "historical 12 doorstops £105", origin: "new", premium: 0 }),
  fixed({ code: "TOWRAIL-01", name: "Fit towel rail or holder", cat: "general_fixing", price: 45, mins: 35,
    cust: "We fix a towel rail, ring or holder firmly to the wall, no wobble.",
    admin: "Non-heated towel holder/ring/rail. Historical £45.",
    conf: "high", basis: "historical towel holder £45", origin: "new", premium: 0 }),
  fixed({ code: "BATHACC-01", name: "Fit bathroom accessories", cat: "general_fixing", price: 55, mins: 45,
    cust: "We fit your bathroom accessories — soap dishes, toilet-roll holders, robe hooks — securely and level.",
    admin: "Bundle of small bathroom fixtures. Use unit count for many.",
    conf: "medium", basis: "UK market estimate", origin: "new", premium: 0 }),
  fixed({ code: "BABYGATE-01", name: "Fit a baby gate", cat: "general_fixing", price: 55, mins: 45,
    cust: "We fit a stair or doorway safety gate securely so it's safe and easy to use.",
    admin: "Per gate or refit. Historical refit 2 gates £72.",
    conf: "medium", basis: "historical baby gates £72/2", origin: "new", premium: 0 }),
  fixed({ code: "CATFLAP-01", name: "Fit or remove a cat flap", cat: "general_fixing", price: 95, mins: 90,
    cust: "We fit a cat flap into a door or panel — or remove an old one and make good — for a neat finish.",
    admin: "Cat flap fit (incl. door adjust) or removal+make-good. Historical £45-95.",
    conf: "medium", basis: "historical cat flap £95", origin: "new" }),
  fixed({ code: "MISC-SMALL-01", name: "Handful of small jobs", cat: "general_fixing", price: 95, mins: 120,
    cust: "A visit to knock out a list of small odd jobs around the home in one go.",
    admin: "Catch-all 'misc fixes' line. Historical 'misc fixes' appears often. Default 2h.",
    conf: "medium", basis: "historical misc fixes line", origin: "new" }),
);

// ===========================================================================
// SHELVING — historical n=6 + many in general/none. median £68
// ===========================================================================
catalog.push(
  unit({ code: "SHELF-FLOAT-01", name: "Hang floating shelves", cat: "shelving", perUnit: 45, label: "shelf",
    minUnits: 1, minsPer: 50, setup: 20,
    cust: "We mount floating shelves level and solid, with concealed fixings sized to the load and wall.",
    admin: "Per floating shelf. Historical 6 oak floating £90, hang 2-3 £55-90. Carry-over SHELF-21 split.",
    conf: "high", basis: "historical floating shelves", origin: "split", premium: 2000 }),
  unit({ code: "SHELF-BRKT-01", name: "Put up bracket shelves", cat: "shelving", perUnit: 45, label: "shelf",
    minUnits: 1, minsPer: 50, setup: 20,
    cust: "We fit your shelves on brackets — found studs, level, and screwed in solid.",
    admin: "Per bracketed shelf. Historical install 3 shelves £65-78.",
    conf: "high", basis: "historical bracket shelves £45-95", origin: "split", premium: 2000 }),
  fixed({ code: "SHELF-UNIT-01", name: "Fix a shelving unit to wall", cat: "shelving", price: 90, mins: 75,
    cust: "We assemble (if needed) and secure your shelving unit or bookcase to the wall so it's safe and stable.",
    admin: "Bookcase/Billy-style unit fix-to-wall. Historical IKEA shelving unit £95.",
    conf: "high", basis: "historical shelving unit £95", origin: "new", premium: 2000 }),
);

// ===========================================================================
// TV MOUNTING / SMART HOME — historical n=11, median £75
// ===========================================================================
catalog.push(
  fixed({ code: "TV-PLBD-01", name: "TV wall mount (plasterboard)", cat: "tv_mounting", price: 75, mins: 90,
    cust: "We mount your TV on a plasterboard wall — bracket fixed solid, cables tidied, and tested before we go.",
    admin: "Up to 65\". Plasterboard needs proper fixings. Carry-over TVMT-24 split.",
    conf: "high", basis: "median historical TV mount £65-91", origin: "split" }),
  fixed({ code: "TV-BRICK-01", name: "TV wall mount (brick/solid)", cat: "tv_mounting", price: 85, mins: 90,
    cust: "We mount your TV on a solid or brick wall, with cables run neatly and a tested, secure finish.",
    admin: "Up to 65\" on masonry. Historical solid-wall £91.",
    conf: "high", basis: "historical solid wall TV £91", origin: "split" }),
  fixed({ code: "TV-CABLE-01", name: "Conceal TV cables", cat: "tv_mounting", price: 60, mins: 60,
    cust: "We hide your TV cables in trunking or behind the wall for a clean, clutter-free look.",
    admin: "Add-on to a mount or standalone trunking. Historical trunking add £65.",
    conf: "medium", basis: "historical trunking £65", origin: "new" }),
  fixed({ code: "SBAR-01", name: "Mount a soundbar", cat: "tv_mounting", price: 55, mins: 45,
    cust: "We mount your soundbar neatly under the TV, level and cable-tidied.",
    admin: "Soundbar bracket. Often paired with TV mount.",
    conf: "medium", basis: "UK market estimate", origin: "new" }),
  fixed({ code: "DOORBELL-01", name: "Smart doorbell fit", cat: "tv_mounting", price: 75, mins: 60,
    cust: "We fit and set up your video doorbell so you can see who's at the door from your phone.",
    admin: "Ring/Nest doorbell on existing chime or battery. Historical Ring on brick £75.",
    conf: "high", basis: "historical Ring doorbell £75", origin: "new", premium: 2000 }),
  fixed({ code: "CAM-01", name: "Security camera fit", cat: "tv_mounting", price: 85, mins: 75,
    cust: "We mount and set up a wireless security camera, positioned for the view you want.",
    admin: "Single wireless cam fit + app pairing. Per-camera; add lines for more.",
    conf: "medium", basis: "UK market estimate", origin: "new", premium: 2000 }),
);

// ===========================================================================
// ELECTRICAL (minor) — historical n=33, median £75
// ===========================================================================
catalog.push(
  unit({ code: "SCKT-SWAP-01", name: "Socket swap", cat: "electrical_minor", perUnit: 68, label: "socket",
    minUnits: 1, minsPer: 45, setup: 20,
    cust: "We replace a worn, loose or damaged socket with a fresh one — isolated, fitted and safety-tested.",
    admin: "Per socket, like-for-like. Historical fix/replace socket £68-75. Carry-over SCKT-09 split.",
    conf: "high", basis: "historical socket £68-75", origin: "split", premium: 2000 }),
  unit({ code: "SCKT-NEW-01", name: "Add a new socket", cat: "electrical_minor", perUnit: 90, label: "socket",
    minUnits: 1, minsPer: 90, setup: 20,
    cust: "We add a new socket where you need one, neatly run from an existing supply and fully tested.",
    admin: "New spur/socket (single feed). Historical add socket £45-100; IP66 outdoor £45.",
    conf: "medium", basis: "historical new socket £45-100", origin: "split", premium: 2000 }),
  unit({ code: "SWCH-01", name: "Light switch swap", cat: "electrical_minor", perUnit: 65, label: "switch",
    minUnits: 1, minsPer: 35, setup: 20,
    cust: "We swap your light switch — including dimmers — for a clean, safe, working fit.",
    admin: "Per switch, like-for-like incl. dimmers. Historical £65-98. Carry-over SWCH-54.",
    conf: "high", basis: "historical switch £65-98", origin: "carryover-renamed", premium: 2000 }),
  unit({ code: "LIGHT-SWAP-01", name: "Light fitting swap", cat: "electrical_minor", perUnit: 75, label: "light",
    minUnits: 1, minsPer: 75, setup: 20,
    cust: "We replace a ceiling or wall light fitting on your existing wiring — mounted, wired and tested.",
    admin: "Per fitting, existing supply, no new cable. Historical £45-145. Carry-over LIGHT-10 split.",
    conf: "high", basis: "historical light swap £65-75", origin: "split", premium: 2000 }),
  unit({ code: "PENDANT-01", name: "Pendant light swap", cat: "electrical_minor", perUnit: 65, label: "pendant",
    minUnits: 1, minsPer: 50, setup: 20,
    cust: "We swap a pendant or hanging light for a new one, level and tested.",
    admin: "Per pendant. Historical pendant £45-125.",
    conf: "high", basis: "historical pendant £45-75", origin: "split", premium: 2000 }),
  unit({ code: "DLIGHT-01", name: "Downlight or spotlight swap", cat: "electrical_minor", perUnit: 22, label: "light",
    minUnits: 2, minsPer: 20, setup: 25,
    cust: "We replace failed downlights or spotlights with fresh units for even, working lighting.",
    admin: "Per downlight/spot, min 2. Historical replace downlight lamps £65 (batch).",
    conf: "medium", basis: "historical downlight batch £65", origin: "new", premium: 2000 }),
  fixed({ code: "FAN-01", name: "Extractor fan fit", cat: "electrical_minor", price: 75, mins: 90,
    cust: "We repair or replace a bathroom or kitchen extractor fan and check it's venting properly.",
    admin: "Fan repair/swap incl. humidity-sensing. Historical £75-120. Carry-over FAN-12.",
    conf: "high", basis: "historical fan £75-120", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "FAN-CORD-01", name: "Fan pull-cord swap", cat: "electrical_minor", price: 50, mins: 35,
    cust: "We replace a snapped or sticking extractor fan pull-cord switch.",
    admin: "Pull-cord only. Historical £50.",
    conf: "high", basis: "historical pull-cord £50", origin: "new", premium: 0 }),
  unit({ code: "SMOKE-01", name: "Smoke or CO alarm fit", cat: "electrical_minor", perUnit: 55, label: "alarm",
    minUnits: 1, minsPer: 40, setup: 20,
    cust: "We fit smoke or carbon-monoxide alarms in the right spots and test them so your home's protected.",
    admin: "Per alarm, battery or mains. Historical 2 smoke alarms £115 (£57 each).",
    conf: "high", basis: "historical smoke alarms £57/unit", origin: "new", premium: 2000 }),
  fixed({ code: "SPUR-01", name: "Fused spur fit or repair", cat: "electrical_minor", price: 68, mins: 60,
    cust: "We fit or repair a fused spur for appliances like cookers, heaters or boilers, safely tested.",
    admin: "Switched fuse spur. Historical £68-75.",
    conf: "medium", basis: "historical spur £68-75", origin: "new", premium: 2000 }),
  fixed({ code: "FLOOD-01", name: "Outdoor floodlight fit", cat: "electrical_minor", price: 120, mins: 90,
    cust: "We fit an outdoor floodlight or PIR security light, wired from a suitable supply and tested.",
    admin: "External flood/PIR. Historical floodlight w/ supply £200; solar lights £50-65.",
    conf: "medium", basis: "historical floodlight £200 (w/ supply)", origin: "new", premium: 2000 }),
  fixed({ code: "ELEC-DIAG-01", name: "Electrical fault find", cat: "electrical_minor", price: 75, mins: 60,
    cust: "We diagnose a non-working circuit, light or socket and tell you clearly what's needed to fix it.",
    admin: "Fault diagnosis visit. Historical diagnose inline fan £75; inspect spur £75.",
    conf: "medium", basis: "historical diagnosis £75", origin: "new", premium: 2000 }),
);

// ===========================================================================
// CURTAINS & BLINDS — historical n=23, median £68
// ===========================================================================
catalog.push(
  unit({ code: "BLIND-01", name: "Fit a blind", cat: "curtain_blinds", perUnit: 50, label: "blind",
    minUnits: 1, minsPer: 50, setup: 20,
    cust: "We fit your blinds — brackets up, hung, levelled and cords tidied for a neat finish.",
    admin: "Per blind, standard window. Historical £45-55 each. Bay = multiple. Carry-over BLND-27.",
    conf: "high", basis: "historical blind £45-55/unit", origin: "carryover-renamed", premium: 2000 }),
  unit({ code: "BLIND-BAY-01", name: "Fit blinds in a bay", cat: "curtain_blinds", perUnit: 50, label: "blind",
    minUnits: 3, minsPer: 55, setup: 20,
    cust: "We fit blinds across a bay window, each levelled and aligned for a clean, matching look.",
    admin: "Per blind in a bay, min 3. Historical bay window blinds £105.",
    conf: "medium", basis: "historical bay £105", origin: "split", premium: 2000 }),
  unit({ code: "CURT-RAIL-01", name: "Fit a curtain pole or rail", cat: "curtain_blinds", perUnit: 55, label: "window",
    minUnits: 1, minsPer: 55, setup: 20,
    cust: "We put up your curtain pole or rail — marked, levelled and fixed solid to take the weight.",
    admin: "Per window. Historical £45-95. Carry-over CURT-26.",
    conf: "high", basis: "historical curtain rail £45-95", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "CURT-TRACK-01", name: "Fit a bendable curtain track", cat: "curtain_blinds", price: 150, mins: 120,
    cust: "We fit a flexible PVC curtain track — ideal for bay or curved windows — for smooth, quiet draw.",
    admin: "Bendable/PVC track. Historical £165-175.",
    conf: "medium", basis: "historical PVC track £165-175", origin: "split", premium: 2000 }),
  fixed({ code: "CURT-REFIX-01", name: "Re-fix a fallen curtain rail", cat: "curtain_blinds", price: 55, mins: 45,
    cust: "We re-fix a curtain rail that's pulled away, with proper fixings, then fill and make good the holes.",
    admin: "Refix + make-good. Historical £45-56. Often + small paint touch-up.",
    conf: "high", basis: "historical refix £45-56", origin: "new", premium: 0 }),
);

// ===========================================================================
// PAINTING & DECORATING — historical n=56, median £109
// ===========================================================================
catalog.push(
  tiered({ code: "PAINT-ROOM-01", name: "Repaint a room", cat: "painting",
    tiers: [["Small", 110, 150], ["Medium", 150, 240], ["Large", 240, 420]],
    cust: "We repaint your room — walls prepped, filled where needed, and finished in two neat coats. Choose the size that fits.",
    admin: "Small (box/single room), Medium (lounge/bedroom + ceiling), Large (open-plan/through-lounge). Carry-over RPNT-28.",
    conf: "high", basis: "historical room paint £110-150", origin: "carryover-renamed" }),
  fixed({ code: "PAINT-WALL-01", name: "Paint a single wall", cat: "painting", price: 90, mins: 120,
    cust: "We prep and repaint a single wall in two coats for a fresh, even finish.",
    admin: "One feature/marked wall. Historical £80-120.",
    conf: "high", basis: "historical single wall £80-120", origin: "split" }),
  fixed({ code: "PAINT-CEIL-01", name: "Paint a ceiling", cat: "painting", price: 104, mins: 150,
    cust: "We paint your ceiling in two coats of emulsion for a clean, bright finish.",
    admin: "Single ceiling, 2 coats. Historical £104.",
    conf: "high", basis: "historical ceiling £104", origin: "split" }),
  fixed({ code: "PAINT-WOOD-01", name: "Paint woodwork & skirting", cat: "painting", price: 120, mins: 180,
    cust: "We rub down and repaint your skirting, architraves and woodwork for a crisp, hard-wearing finish.",
    admin: "Skirting/woodwork gloss/satin. Historical £68-273 by run. Default room-sized run.",
    conf: "high", basis: "historical woodwork £68-273", origin: "split" }),
  fixed({ code: "PAINT-DOOR-01", name: "Paint a door", cat: "painting", price: 68, mins: 90,
    cust: "We prep and repaint a door — including the frame — for a smooth, even coat.",
    admin: "Single internal door + frame. Historical repaint door £60-68.",
    conf: "high", basis: "historical door paint £60-68", origin: "split" }),
  fixed({ code: "PAINT-FRDOOR-01", name: "Paint a front door", cat: "painting", price: 90, mins: 120,
    cust: "We rub down and repaint your front door in an exterior finish for a fresh kerb-side look.",
    admin: "External front door, weather-grade paint. Historical paint front door £80.",
    conf: "high", basis: "historical front door £80", origin: "split" }),
  fixed({ code: "PAINT-SILL-01", name: "Repaint window sills", cat: "painting", price: 90, mins: 120,
    cust: "We scrape, sand and repaint your window sills — treating any mould — for a clean, protected finish.",
    admin: "Per sill/run. Historical £80-220 (multi-sill). Treat mould.",
    conf: "medium", basis: "historical sills £80-220", origin: "split" }),
  fixed({ code: "STAINBLK-01", name: "Stain-block & repaint", cat: "painting", price: 80, mins: 90,
    cust: "We treat the stain or mark, seal it with stain-block primer, and repaint so it doesn't bleed back through.",
    admin: "Water/damp/nicotine marks. Damp source must be fixed first. Carry-over STAIN-33.",
    conf: "high", basis: "historical stain-block £68-111", origin: "carryover-renamed" }),
  fixed({ code: "MOULD-PAINT-01", name: "Mould treat & repaint ceiling", cat: "painting", price: 90, mins: 120,
    cust: "We kill the mould, seal the area and repaint your ceiling for a clean, fresh finish.",
    admin: "Bathroom/kitchen ceiling mould. Damp cause must be resolved. Historical £80-111.",
    conf: "high", basis: "historical mould ceiling £80-111", origin: "split" }),
  fixed({ code: "PAINT-TOUCH-01", name: "Touch-up & patch paint", cat: "painting", price: 68, mins: 60,
    cust: "We sand, fill and blend small patches into your existing paint for a seamless touch-up.",
    admin: "Small areas blended to existing. Carry-over TUCH-32 (repriced — £180 was wrong).",
    conf: "high", basis: "historical touch-up £45-68 (corrects old £180)", origin: "carryover-renamed" }),
  fixed({ code: "PAINT-EXT-01", name: "Paint exterior render or facade", cat: "painting", price: 280, mins: 480,
    cust: "We prep and paint your rendered walls or facade in a weather-grade masonry finish.",
    admin: "Masonry/render facade. Historical £280. Larger = site visit.",
    conf: "medium", basis: "historical render facade £280", origin: "new" }),
  tiered({ code: "WALLPAPER-STRIP-01", name: "Strip wallpaper", cat: "painting",
    tiers: [["Small", 150, 240], ["Medium", 280, 360], ["Large", 480, 480]],
    cust: "We score, steam and strip old wallpaper, then fill and sand so walls are ready to paint or paper. Choose by area.",
    admin: "Small (1-2 walls), Medium (room), Large (multi-room). Historical £150-840. Carry-over WPSTR-34.",
    conf: "high", basis: "historical wallpaper strip £150-840", origin: "carryover-renamed" }),
  fixed({ code: "WALLPAPER-HANG-01", name: "Hang wallpaper", cat: "painting", price: 210, mins: 240,
    cust: "We hang your wallpaper with crisp, matched seams and a smooth, bubble-free finish.",
    admin: "Per 1-2 walls/feature wall. Historical install wallpaper 2 walls £210.",
    conf: "medium", basis: "historical hang wallpaper £210", origin: "new" }),
  fixed({ code: "PAINT-FENCE-01", name: "Paint a fence or shed", cat: "painting", price: 210, mins: 240,
    cust: "We treat and paint your fence or shed in a protective outdoor finish for a fresh, lasting look.",
    admin: "Fence/shed/timber. Historical paint fence £210-240. Tier later if needed.",
    conf: "high", basis: "historical fence paint £210-240", origin: "split" }),
  fixed({ code: "PAINT-METAL-01", name: "Paint metalwork or pipework", cat: "painting", price: 100, mins: 120,
    cust: "We prep and paint radiators, pipework, railings or garage doors in a hard-wearing finish.",
    admin: "Metalwork/pipework/garage door. Historical pipework £104, garage door £108.",
    conf: "medium", basis: "historical metalwork £104-108", origin: "new" }),
);

// ===========================================================================
// CARPENTRY — historical n=42, median £179
// ===========================================================================
catalog.push(
  tiered({ code: "SKIRT-01", name: "Skirting board fitting", cat: "carpentry",
    tiers: [["Small", 70, 60], ["Medium", 150, 150], ["Large", 320, 300]],
    cust: "We measure, cut and fit your skirting boards with neat joins, ready to caulk and paint. Choose by run length.",
    admin: "Small (one room/short run), Medium (downstairs), Large (full home/25m). Historical £58-320. Carry-over SKIRT-18.",
    conf: "high", basis: "historical skirting £58-320", origin: "carryover-renamed" }),
  tiered({ code: "PANEL-01", name: "Wall panelling install", cat: "carpentry",
    tiers: [["Small", 290, 240], ["Medium", 350, 360], ["Large", 700, 600]],
    cust: "We fit decorative wall panelling or beading for a smart, finished feature, ready to paint.",
    admin: "MDF/V-groove/beading. Historical £288-700. Tier by wall area. Carry-over PNL-19.",
    conf: "high", basis: "historical panelling £288-700", origin: "carryover-renamed" }),
  unit({ code: "PLINTH-01", name: "Kitchen plinth fit", cat: "carpentry", perUnit: 100, label: "run",
    minUnits: 1, minsPer: 90, setup: 30,
    cust: "We cut and fit kitchen plinths with neat corners for a tidy, finished base to your units.",
    admin: "Kitchen kickboard/plinth. Historical £85-260. Refix or new.",
    conf: "medium", basis: "historical plinths £85-260", origin: "split" }),
  fixed({ code: "BTHPNL-01", name: "Bath panel fit", cat: "carpentry", price: 150, mins: 120,
    cust: "We cut, fit and seal a bath panel for a clean, watertight finish.",
    admin: "Pre-formed or MDF bath panel. Historical £150-195. Carry-over BTHPNL-20 (repriced up).",
    conf: "high", basis: "historical bath panel £150-195", origin: "carryover-renamed" }),
  unit({ code: "CEILTILE-01", name: "Replace ceiling tiles", cat: "carpentry", perUnit: 30, label: "tile",
    minUnits: 1, minsPer: 25, setup: 25,
    cust: "We swap damaged ceiling tiles for fresh ones for a clean, even ceiling.",
    admin: "Per tile. Historical 3 tiles £55-121.",
    conf: "medium", basis: "historical ceiling tiles £55-121/3", origin: "new" }),
  fixed({ code: "WINBOARD-01", name: "Fit window boards", cat: "carpentry", price: 160, mins: 180,
    cust: "We fit internal window boards (sills), cut and finished for a tidy interior edge.",
    admin: "Internal window boards. Historical 2 boards £160.",
    conf: "medium", basis: "historical window boards £160", origin: "new" }),
  fixed({ code: "SASH-01", name: "Sash window repair", cat: "carpentry", price: 160, mins: 210,
    cust: "We repair sash windows — cords, beads and balance — so they slide smoothly and stay put.",
    admin: "Sash cord/bead repair. Historical £160-260. Carry-over WIN-23 split.",
    conf: "medium", basis: "historical sash £160-260", origin: "carryover-renamed" }),
  fixed({ code: "BOXIN-01", name: "Box in pipes or boiler", cat: "carpentry", price: 120, mins: 180,
    cust: "We box in pipework, a boiler or meter neatly in timber or MDF, ready to paint.",
    admin: "Boxing/cladding. Historical boiler boxing+doors £210; extractor boxing £80.",
    conf: "medium", basis: "historical boxing £80-210", origin: "new" }),
  fixed({ code: "BEAM-01", name: "Fit a timber beam or mantel", cat: "carpentry", price: 120, mins: 150,
    cust: "We fix a timber beam or mantel above your fireplace, level and solid.",
    admin: "Decorative beam/mantel. Historical beam above fireplace £120.",
    conf: "low", basis: "single historical £120 — verify fixing", origin: "new" }),
  fixed({ code: "GATE-WOOD-01", name: "Wooden gate repair", cat: "carpentry", price: 90, mins: 120,
    cust: "We repair a dropped or sticking wooden gate so it swings and latches properly.",
    admin: "Timber gate repair. Historical £80.",
    conf: "medium", basis: "historical gate £80", origin: "new", premium: 2000 }),
  fixed({ code: "VANITY-TOP-01", name: "Fit a vanity top", cat: "carpentry", price: 90, mins: 90,
    cust: "We cut and fit a timber vanity or worktop over your unit for a neat, sealed finish.",
    admin: "Timber vanity top. Historical £85.",
    conf: "low", basis: "single historical £85", origin: "new" }),
  fixed({ code: "HANDRAIL-01", name: "Fit a handrail", cat: "carpentry", price: 120, mins: 120,
    cust: "We fit a staircase or wall handrail, fixed solid for safe, confident support.",
    admin: "Stair/wall handrail. Historical staircase handrail £120.",
    conf: "medium", basis: "historical handrail £120", origin: "new" }),
  fixed({ code: "CARP-MISC-01", name: "General carpentry repair", cat: "carpentry", price: 120, mins: 180,
    cust: "We handle bespoke timber repairs and small joinery jobs around your home.",
    admin: "Catch-all for one-off timber work that doesn't fit a specific SKU.",
    conf: "low", basis: "category median £120 — bespoke, confirm scope", origin: "new" }),
);

// ===========================================================================
// DOOR FITTING — historical n=32, median £93
// ===========================================================================
catalog.push(
  unit({ code: "DOOR-INT-01", name: "Internal door hanging", cat: "door_fitting", perUnit: 85, label: "door",
    minUnits: 1, minsPer: 100, setup: 20,
    cust: "We hang your internal door — planed to fit, hinges and latch set, handles on and swinging true.",
    admin: "Per internal door. Historical £72-91 each. Carry-over DOOR-15.",
    conf: "high", basis: "historical internal door £72-91", origin: "carryover-renamed" }),
  unit({ code: "DOOR-EXT-01", name: "External door fitting", cat: "door_fitting", perUnit: 240, label: "door",
    minUnits: 1, minsPer: 180, setup: 30,
    cust: "We fit your external door — hung, weather-sealed, furniture on and tested for a full, secure latch.",
    admin: "Per external door + frame. Historical 3 doors+frames £728 (£243 each). Carry-over XDOOR-16 (repriced up).",
    conf: "high", basis: "historical external door £243/unit", origin: "carryover-renamed" }),
  fixed({ code: "DOOR-FRAME-01", name: "Door frame repair", cat: "door_fitting", price: 175, mins: 180,
    cust: "We repair or rebuild a damaged door frame and rehang the door so it closes cleanly and securely.",
    admin: "Frame repair/rebuild + rehang. Historical £125-275.",
    conf: "medium", basis: "historical frame £125-275", origin: "new" }),
  fixed({ code: "DOOR-ADJ-01", name: "Ease a sticking door", cat: "door_fitting", price: 80, mins: 75,
    cust: "We plane and adjust a sticking or dropped door so it opens and closes smoothly.",
    admin: "Plane/adjust existing door. Historical £80-118.",
    conf: "high", basis: "historical adjust door £80-118", origin: "split", premium: 0 }),
  unit({ code: "DOOR-HW-01", name: "Door handle or latch swap", cat: "door_fitting", perUnit: 65, label: "door",
    minUnits: 1, minsPer: 50, setup: 20,
    cust: "We replace door handles, latches or hinges for smooth, secure operation.",
    admin: "On-door hardware. Historical handle/latch £63-78. Carry-over HW-61.",
    conf: "high", basis: "historical door hardware £63-78", origin: "carryover-renamed", premium: 2000 }),
  unit({ code: "DOOR-HINGE-01", name: "Cupboard door hinge fix", cat: "door_fitting", perUnit: 55, label: "door",
    minUnits: 1, minsPer: 40, setup: 20,
    cust: "We realign or replace cupboard and wardrobe door hinges so doors hang straight and close softly.",
    admin: "Cupboard/wardrobe hinge realign/replace. Historical £53-70.",
    conf: "high", basis: "historical hinge fix £53-70", origin: "split", premium: 0 }),
  fixed({ code: "LETTERBOX-01", name: "Fit a letterbox", cat: "door_fitting", price: 90, mins: 75,
    cust: "We cut and fit a letterbox into your door for a neat, draught-sealed finish.",
    admin: "Cut + fit letterbox. Historical cut door + letterbox £98.",
    conf: "medium", basis: "historical letterbox £98", origin: "new" }),
  unit({ code: "FIREDOOR-SEAL-01", name: "Fit fire door seals", cat: "door_fitting", perUnit: 38, label: "door",
    minUnits: 1, minsPer: 45, setup: 20,
    cust: "We fit intumescent smoke seals and closers to fire doors to meet safety requirements.",
    admin: "Per fire door: smoke seal strips / self-closer. Historical 3 closers £132, 4 seals £76.",
    conf: "medium", basis: "historical fire door seals £19-44/door", origin: "new" }),
  fixed({ code: "GARAGE-DOOR-01", name: "Garage door repair", cat: "door_fitting", price: 120, mins: 120,
    cust: "We realign or repair your garage door mechanism or frame so it runs smoothly.",
    admin: "Up-and-over/mechanism realign or frame. Historical £112-125.",
    conf: "medium", basis: "historical garage door £112-125", origin: "new" }),
);

// ===========================================================================
// FLAT-PACK & FURNITURE — historical flat_pack n=11, median £98
// ===========================================================================
catalog.push(
  fixed({ code: "FP-WARDROBE-01", name: "Wardrobe assembly", cat: "flat_pack", price: 120, mins: 180,
    cust: "We build your flat-pack wardrobe — assembled, levelled, doors aligned and packaging cleared away.",
    admin: "Single wardrobe. Historical flat-pack wardrobe £126. Carry-over FLAT-39 split.",
    conf: "high", basis: "historical wardrobe £126", origin: "split", premium: 2000 }),
  fixed({ code: "FP-BED-01", name: "Bed assembly", cat: "flat_pack", price: 90, mins: 120,
    cust: "We assemble your bed frame — including ottoman or storage beds — solid and ready to sleep in.",
    admin: "Bed/ottoman frame. Historical £90-98.",
    conf: "high", basis: "historical bed £90-98", origin: "split", premium: 2000 }),
  fixed({ code: "FP-DESK-01", name: "Desk or table assembly", cat: "flat_pack", price: 84, mins: 90,
    cust: "We assemble your desk, table or chair — sturdy, level and ready to use.",
    admin: "Desk/table/chair. Historical gaming desk/chair £84.",
    conf: "high", basis: "historical desk £84", origin: "split", premium: 2000 }),
  fixed({ code: "FP-DRAWERS-01", name: "Drawers or cabinet assembly", cat: "flat_pack", price: 90, mins: 120,
    cust: "We build your chest of drawers, sideboard or cabinet, with smooth-running drawers and doors.",
    admin: "Drawers/sideboard/bookcase. Historical drawers £112.",
    conf: "high", basis: "historical drawers £112", origin: "split", premium: 2000 }),
  fixed({ code: "FP-SOFA-01", name: "Sofa or large furniture build", cat: "flat_pack", price: 90, mins: 120,
    cust: "We assemble your sofa, corner unit or large furniture, levelled and ready to use.",
    admin: "Sofa/corner unit. Historical sofa set £63; varies by size.",
    conf: "medium", basis: "historical sofa £63", origin: "split", premium: 2000 }),
  fixed({ code: "FP-MISC-01", name: "Flat-pack assembly", cat: "flat_pack", price: 90, mins: 120,
    cust: "We build your flat-pack furniture — unboxed, assembled, levelled and packaging taken away.",
    admin: "Generic flat-pack fallback. Historical bike £127, ottoman £98. Carry-over FLAT-39.",
    conf: "high", basis: "median historical flat-pack £90-98", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "FURN-FIX-01", name: "Furniture repair", cat: "furniture_repair", price: 90, mins: 90,
    cust: "We repair wobbly, broken or stuck furniture — drawer runners, hinges, joints — back to solid.",
    admin: "Runners/hinges/joints. Historical cabinet repair £75-135. Carry-over CAB-42.",
    conf: "high", basis: "historical furniture repair £75-135", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "FURN-MOVE-01", name: "Dismantle & move furniture", cat: "furniture_repair", price: 100, mins: 120,
    cust: "We carefully dismantle, move and (if needed) rebuild bulky furniture within your home.",
    admin: "Dismantle/move (e.g. ottoman to garage). Historical £112-135.",
    conf: "medium", basis: "historical dismantle/move £112-135", origin: "new", premium: 2000 }),
);

// ===========================================================================
// TILING — historical n=12, median £152
// ===========================================================================
catalog.push(
  tiered({ code: "TILE-01", name: "Tiling install", cat: "tiling",
    tiers: [["Small", 100, 120], ["Medium", 220, 300], ["Large", 480, 480]],
    cust: "We tile your walls or floor — prepped, fixed straight, grouted and sealed. Choose by area.",
    admin: "Walls/floor. Small (splashback ~2m²), Medium (1 wall), Large (room). Historical £85-1600. Carry-over TILE-36.",
    conf: "medium", basis: "historical tiling £85-1600 (wide)", origin: "carryover-renamed" }),
  tiered({ code: "REGROUT-01", name: "Re-grout tiles", cat: "tiling",
    tiers: [["Small", 90, 120], ["Medium", 190, 240], ["Large", 380, 420]],
    cust: "We rake out tired or missing grout, clean up, re-grout and polish for a fresh-looking finish.",
    admin: "Small (one area/splashback), Medium (one room), Large (all bathroom). Historical £60-380. Carry-over GROUT-60.",
    conf: "high", basis: "historical regrout £60-380", origin: "carryover-renamed" }),
  fixed({ code: "SPLASH-01", name: "Fit a splashback", cat: "tiling", price: 120, mins: 150,
    cust: "We fit your splashback — tiled, glass or acrylic — cut to size, sealed and tidy.",
    admin: "Single splashback. Historical bathroom splashback £120.",
    conf: "medium", basis: "historical splashback £120", origin: "new" }),
  fixed({ code: "TILE-REMOVE-01", name: "Remove old tiles", cat: "tiling", price: 120, mins: 150,
    cust: "We strip out old tiles and prep the surface, ready for re-tiling or finishing.",
    admin: "Tile strip-out only. Historical remove tiling £120.",
    conf: "medium", basis: "historical tile removal £120", origin: "new" }),
);

// ===========================================================================
// KITCHEN FITTING — historical n=14, median £113
// ===========================================================================
catalog.push(
  tiered({ code: "KIT-UNIT-01", name: "Kitchen unit fitting", cat: "kitchen_fitting",
    tiers: [["Small", 113, 90], ["Medium", 200, 180], ["Large", 280, 300]],
    cust: "We fit kitchen units and cupboards — levelled, secured and doors aligned. Choose by how many.",
    admin: "Small (1 unit), Medium (2-3), Large (run). Historical £113-280. Carry-over KIT-40.",
    conf: "high", basis: "historical kitchen units £113-280", origin: "carryover-renamed" }),
  fixed({ code: "KIT-WORKTOP-01", name: "Fit a worktop", cat: "kitchen_fitting", price: 200, mins: 240,
    cust: "We measure, cut, scribe and fit your worktop for a snug, sealed finish.",
    admin: "Laminate/solid worktop fit. Split from KIT-40. Larger spans = site visit.",
    conf: "medium", basis: "UK market estimate (split from KIT-40)", origin: "split" }),
  fixed({ code: "KIT-DOOR-01", name: "Kitchen cupboard door fix", cat: "kitchen_fitting", price: 75, mins: 60,
    cust: "We refit, realign or replace a kitchen cupboard door so it sits square and closes softly.",
    admin: "Single cupboard door/hinge. Historical £75-150.",
    conf: "medium", basis: "historical cupboard door £75-150", origin: "new", premium: 2000 }),
  fixed({ code: "KIT-DRILL-01", name: "Drill unit for appliance", cat: "kitchen_fitting", price: 90, mins: 75,
    cust: "We drill neat pipework or cable holes through your kitchen units for an appliance install.",
    admin: "Inlet/pipe holes for washer/dishwasher. Historical £113.",
    conf: "medium", basis: "historical drill holes £113", origin: "new" }),
);

// ===========================================================================
// BATHROOM FITTING — historical n=9, median £195
// ===========================================================================
catalog.push(
  tiered({ code: "BATH-SUITE-01", name: "Bathroom suite install", cat: "bathroom_fitting",
    tiers: [["Small", 200, 240], ["Medium", 360, 480], ["Large", 600, 960]],
    cust: "We install or refresh your bathroom suite — strip out where needed, fit and connect for a clean finish. Choose by scope.",
    admin: "Small (basin only), Medium (basin+WC), Large (full suite). Historical £200-420. Carry-over BATH-41.",
    conf: "medium", basis: "historical bathroom fitting £200-420", origin: "carryover-renamed" }),
  fixed({ code: "BATH-BASIN-01", name: "Basin & vanity fit", cat: "bathroom_fitting", price: 200, mins: 180,
    cust: "We fit your basin and vanity unit — plumbed, sealed and leak-tested for a tidy finish.",
    admin: "Basin + vanity. Historical install basin+vanity £200.",
    conf: "medium", basis: "historical basin+vanity £200", origin: "split" }),
  fixed({ code: "BATH-SHWRPNL-01", name: "Shower wall panelling", cat: "bathroom_fitting", price: 350, mins: 360,
    cust: "We fit waterproof shower wall panels for a sleek, easy-clean, fully sealed finish.",
    admin: "PVC/acrylic shower panelling. Historical £280-420.",
    conf: "medium", basis: "historical shower panelling £280-420", origin: "new" }),
  fixed({ code: "SHWR-SCRN-01", name: "Shower screen or enclosure fit", cat: "bathroom_fitting", price: 110, mins: 120,
    cust: "We fit your shower screen or enclosure — levelled, sealed and finished for a watertight result.",
    admin: "Enclosure/screen only (not the mixer). Historical £108-146. Carry-over SCRN-05.",
    conf: "high", basis: "historical screen £108-146", origin: "carryover-renamed" }),
);

// ===========================================================================
// FLOORING — historical n=7, median £480
// ===========================================================================
catalog.push(
  tiered({ code: "FLOOR-LAM-01", name: "Lay laminate or LVT flooring", cat: "flooring",
    tiers: [["Small", 240, 240], ["Medium", 390, 360], ["Large", 540, 480]],
    cust: "We lay your laminate, vinyl or LVT flooring — underlay down, boards fitted, trimmed and finished at the edges. Choose by area.",
    admin: "Small (1 room), Medium (15-20m²), Large (30m²+). Historical £390-540. Carry-over FLR-38 (fixed Large outlier).",
    conf: "high", basis: "historical flooring £390-540", origin: "carryover-renamed" }),
  fixed({ code: "FLOOR-WOOD-01", name: "Lay engineered or solid wood", cat: "flooring", price: 600, mins: 600,
    cust: "We lay engineered or solid wood flooring — including herringbone — for a premium, lasting finish.",
    admin: "Wood/herringbone. Historical herringbone £3840 (large). Default 1 room; large = site visit.",
    conf: "low", basis: "historical wood £3840 was whole-house — confirm per-room", origin: "split" }),
  fixed({ code: "FLOOR-CARPET-01", name: "Fit carpet", cat: "flooring", price: 390, mins: 300,
    cust: "We fit your carpet — gripper, underlay and a neat, stretched finish to the edges.",
    admin: "Carpet incl. stairs. Historical fit carpet upstairs+stairs £390.",
    conf: "medium", basis: "historical carpet £390", origin: "new" }),
  fixed({ code: "FLOOR-LIFT-01", name: "Lift & remove old flooring", cat: "flooring", price: 240, mins: 240,
    cust: "We lift and dispose of old flooring and prep the subfloor, ready for the new finish.",
    admin: "Strip-out + dispose. Historical remove laminate £480, carpet tiles £400.",
    conf: "medium", basis: "historical floor removal £400-480", origin: "new" }),
);

// ===========================================================================
// PLASTERING — historical n=8, median £115
// ===========================================================================
catalog.push(
  tiered({ code: "PLAST-01", name: "Plaster patch or skim", cat: "plastering",
    tiers: [["Small", 105, 150], ["Medium", 260, 300], ["Large", 700, 480]],
    cust: "We patch, fill or skim your walls to a smooth, paint-ready finish. Choose by area.",
    admin: "Small (patch), Medium (one wall), Large (full room skim). Historical £60-960. Carry-over PLST-37.",
    conf: "high", basis: "historical plaster £60-960", origin: "carryover-renamed" }),
  fixed({ code: "PLASTERBOARD-01", name: "Plasterboard a wall or ceiling", cat: "plastering", price: 260, mins: 300,
    cust: "We fit new plasterboard to walls or ceilings, taped and ready for skim or finishing.",
    admin: "Board out (dot-and-dab/joists). Historical £125-704.",
    conf: "medium", basis: "historical plasterboard £125-704", origin: "new" }),
  fixed({ code: "PLAST-SAND-01", name: "Sand & make good walls", cat: "plastering", price: 105, mins: 180,
    cust: "We sand back, fill imperfections and prep walls to a smooth, even surface ready for paint.",
    admin: "Sanding/filling prep (not full skim). Historical sand+fill walls £105-150.",
    conf: "medium", basis: "historical sand/fill £105-150", origin: "split" }),
);

// ===========================================================================
// GARDEN MAINTENANCE — historical n=15, median £105
// ===========================================================================
catalog.push(
  tiered({ code: "GARDEN-TIDY-01", name: "Garden tidy & weed", cat: "garden_maintenance",
    tiers: [["Small", 75, 150], ["Medium", 125, 240], ["Large", 240, 360]],
    cust: "We tidy your garden — weed, prune, cut back and clear the green waste — for a fresh, cared-for look. Choose by size.",
    admin: "Tier by garden size. Historical £55-150. Carry-over GRDN-45.",
    conf: "high", basis: "historical garden tidy £55-150", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "LAWN-MOW-01", name: "Mow & edge the lawn", cat: "garden_maintenance", price: 75, mins: 90,
    cust: "We mow your lawn and trim the edges for a clean, neat finish.",
    admin: "Mow + edge. Historical mow lawn £100; mow+tidy £100.",
    conf: "high", basis: "historical mow £75-100", origin: "new", premium: 2000 }),
  fixed({ code: "HEDGE-01", name: "Trim a hedge", cat: "garden_maintenance", price: 90, mins: 120,
    cust: "We cut and shape your hedge and clear the clippings for a tidy boundary.",
    admin: "Hedge trim + clear. Historical trim hedge £80.",
    conf: "medium", basis: "historical hedge £80", origin: "new", premium: 2000 }),
  tiered({ code: "TURF-01", name: "Lay turf & topsoil", cat: "garden_maintenance",
    tiers: [["Small", 260, 300], ["Medium", 400, 420], ["Large", 520, 480]],
    cust: "We prep the bed, lay topsoil and roll out fresh turf for an instant new lawn. Choose by area.",
    admin: "Turf + topsoil. Historical £260-520.",
    conf: "medium", basis: "historical turf £260-520", origin: "new", premium: 2000 }),
  fixed({ code: "WEED-TREAT-01", name: "Weed treatment", cat: "garden_maintenance", price: 90, mins: 90,
    cust: "We treat weeds and overgrowth with herbicide for a clear, low-maintenance finish.",
    admin: "Herbicide application. Historical £125-160 (multi-visit). Per visit.",
    conf: "medium", basis: "historical weed treat £125-160", origin: "new", premium: 2000 }),
  fixed({ code: "WEED-MEMBRANE-01", name: "Lay weed membrane", cat: "garden_maintenance", price: 90, mins: 120,
    cust: "We lay weed-control membrane and finish with bark or stone for a tidy, low-upkeep bed.",
    admin: "Membrane + optional decorative cover. Historical membrane £69; stones £132.",
    conf: "low", basis: "historical membrane £69 — confirm area/cover", origin: "new", premium: 2000 }),
  fixed({ code: "WASHLINE-01", name: "Fit a rotary or washing line", cat: "garden_maintenance", price: 90, mins: 120,
    cust: "We fit a rotary dryer or washing line pole, set solid in concrete.",
    admin: "Washing line pole + concrete base. Historical £90-135.",
    conf: "medium", basis: "historical washing line £90-135", origin: "new", premium: 2000 }),
);

// ===========================================================================
// FENCING — historical n=2, median £113
// ===========================================================================
catalog.push(
  unit({ code: "FENCE-PANEL-01", name: "Fence panel install or repair", cat: "fencing", perUnit: 90, label: "panel",
    minUnits: 1, minsPer: 90, setup: 30,
    cust: "We replace or repair fence panels — old ones out, posts checked, new panels fitted square and solid.",
    admin: "Per panel. Historical fence panel £85-140 (with posts higher). Carry-over FNC-43 (repriced).",
    conf: "high", basis: "historical fence panel £85-140", origin: "carryover-renamed", premium: 2000 }),
  unit({ code: "FENCE-POST-01", name: "Replace a fence post", cat: "fencing", perUnit: 90, label: "post",
    minUnits: 1, minsPer: 90, setup: 30,
    cust: "We dig out and replace a rotten or broken fence post, set firm in concrete.",
    admin: "Per post, concreted. Split from FNC-43. Often paired with panels.",
    conf: "medium", basis: "UK market estimate (split)", origin: "split", premium: 2000 }),
  fixed({ code: "TRELLIS-01", name: "Fit trellis or screening", cat: "fencing", price: 90, mins: 120,
    cust: "We fit trellis or garden screening to your fence or posts, secure and level.",
    admin: "Trellis/screening. Historical cement pole for trellis £60.",
    conf: "low", basis: "UK market estimate", origin: "new", premium: 2000 }),
);

// ===========================================================================
// GUTTERING — historical n=2
// ===========================================================================
catalog.push(
  fixed({ code: "GUTTER-CLEAR-01", name: "Gutter clearing", cat: "guttering", price: 80, mins: 120,
    cust: "We clear leaves and debris from your gutters and flush the downpipes so rainwater drains freely.",
    admin: "Clear up to 2-storey. Historical £79-88. Carry-over GUTT-46 split.",
    conf: "high", basis: "historical gutter clear £79-88", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "GUTTER-REPAIR-01", name: "Gutter or downpipe repair", cat: "guttering", price: 90, mins: 120,
    cust: "We fix leaking joints, replace brackets or swap a damaged section so your guttering works again.",
    admin: "Joint/bracket/section repair. Historical replace corner £70. Carry-over GUTT-46 split.",
    conf: "medium", basis: "historical gutter repair £70", origin: "split", premium: 2000 }),
);

// ===========================================================================
// PRESSURE WASHING — historical n=3
// ===========================================================================
catalog.push(
  tiered({ code: "JETWASH-01", name: "Jet-wash patio or driveway", cat: "pressure_washing",
    tiers: [["Small", 90, 120], ["Medium", 120, 180], ["Large", 180, 240]],
    cust: "We jet-wash your patio, path or driveway — pre-treated and rinsed — to lift dirt, moss and grime. Choose by area.",
    admin: "Tier by m². Historical £120-180. Carry-over PWSH-44.",
    conf: "high", basis: "historical jet-wash £120-180", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "JETWASH-ROOF-01", name: "Jet-wash a roof", cat: "pressure_washing", price: 180, mins: 180,
    cust: "We clean moss and grime off your roof for a fresher look and clearer drainage.",
    admin: "Roof soft/jet wash. Historical £180. Access dependent.",
    conf: "low", basis: "single historical £180 — access varies", origin: "new", premium: 2000 }),
  fixed({ code: "JETWASH-DECK-01", name: "Jet-wash decking", cat: "pressure_washing", price: 90, mins: 120,
    cust: "We jet-wash your decking to strip off algae and grime, ready to enjoy or re-oil.",
    admin: "Decking clean. UK estimate.",
    conf: "low", basis: "UK market estimate", origin: "new", premium: 2000 }),
);

// ===========================================================================
// WASTE REMOVAL — historical n=9, median £150
// ===========================================================================
catalog.push(
  tiered({ code: "WASTE-01", name: "Waste & rubbish removal", cat: "waste_removal",
    tiers: [["Small", 60, 90], ["Medium", 150, 120], ["Large", 260, 180]],
    cust: "We load, take away and dispose of your waste responsibly. Choose by how much there is.",
    admin: "Small (¼ van), Medium (½ van), Large (full van). Historical £55-400. Carry-over WSTE-48.",
    conf: "high", basis: "historical waste £55-400", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "WASTE-APPLI-01", name: "Remove an appliance", cat: "waste_removal", price: 90, mins: 60,
    cust: "We disconnect, remove and dispose of a bulky appliance like a fridge, freezer or washer.",
    admin: "Single appliance incl. fridge/freezer (WEEE). Historical fridge+freezer £120.",
    conf: "medium", basis: "historical appliance £120/2", origin: "new", premium: 2000 }),
  fixed({ code: "WASTE-FURN-01", name: "Remove old furniture", cat: "waste_removal", price: 90, mins: 75,
    cust: "We take away and dispose of unwanted furniture so your space is clear.",
    admin: "Bulky furniture item(s). UK estimate; tier via WASTE-01 for volume.",
    conf: "medium", basis: "UK market estimate", origin: "new", premium: 2000 }),
);

// ===========================================================================
// LOCKS & SECURITY — historical n=3
// ===========================================================================
catalog.push(
  fixed({ code: "LOCK-01", name: "Change a lock", cat: "lock_change", price: 95, mins: 60,
    cust: "We change your lock — like-for-like or an anti-snap upgrade — and test it for smooth, secure operation.",
    admin: "Single barrel/cylinder. Historical £95-150. Carry-over LOCK-17.",
    conf: "high", basis: "historical lock £95-150", origin: "carryover-renamed", premium: 0 }),
  fixed({ code: "LOCK-MULTI-01", name: "Fit multiple locks", cat: "lock_change", price: 150, mins: 120,
    cust: "We fit or upgrade several locks across your doors for full, consistent security.",
    admin: "2+ locks in one visit. Historical 2 locks front door £150.",
    conf: "medium", basis: "historical 2 locks £150", origin: "split", premium: 0 }),
  fixed({ code: "LOCK-CABINET-01", name: "Fit a cabinet or coded lock", cat: "lock_change", price: 95, mins: 75,
    cust: "We fit a cabinet, gate or keypad lock for controlled, keyless access.",
    admin: "Cupboard/coded/keypad lock. Historical coded lock £98, cabinet lock £95.",
    conf: "medium", basis: "historical cabinet/coded £95-98", origin: "new", premium: 0 }),
  fixed({ code: "LOCK-DIAG-01", name: "Fix a faulty lock", cat: "lock_change", price: 55, mins: 45,
    cust: "We free up a sticking, jammed or misaligned lock so it works smoothly again.",
    admin: "Repair/adjust existing lock; stuck-key removal. Historical investigate+repair £45-53.",
    conf: "medium", basis: "historical lock fix £45-53", origin: "new", premium: 0 }),
);

// ===========================================================================
// OUTDOOR / OTHER — sheds, decking, paving, cleaning, assessment
// ===========================================================================
catalog.push(
  fixed({ code: "SHED-INSTALL-01", name: "Shed assembly", cat: "garden_maintenance", price: 320, mins: 240,
    cust: "We build your shed from a flat-pack kit — levelled base, assembled and weather-checked.",
    admin: "Pre-built shed kit. Historical £286-380 (6x4). Larger = site visit. Carry-over SHED-47.",
    conf: "high", basis: "historical shed £286-380", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "SHED-REMOVE-01", name: "Dismantle & remove a shed", cat: "waste_removal", price: 160, mins: 240,
    cust: "We dismantle your old shed and clear the waste, leaving the spot ready for what's next.",
    admin: "Dismantle + dispose. Historical £150-169. Split from SHED-47.",
    conf: "high", basis: "historical shed removal £150-169", origin: "split", premium: 2000 }),
  fixed({ code: "SHED-BASE-01", name: "Lay a shed or garden base", cat: "garden_maintenance", price: 280, mins: 360,
    cust: "We lay a level, solid base in slabs or concrete, ready for your shed, summerhouse or store.",
    admin: "Concrete/slab base. Historical concrete shed base £280.",
    conf: "medium", basis: "historical shed base £280", origin: "new", premium: 2000 }),
  fixed({ code: "DECK-01", name: "Decking install or repair", cat: "carpentry", price: 240, mins: 300,
    cust: "We install or repair garden decking — boards cut, fixed and finished for a solid, even surface.",
    admin: "Decking boards/repair. Historical £177-240. Larger = site visit. Carry-over DECK-58.",
    conf: "medium", basis: "historical decking £177-240", origin: "carryover-renamed", premium: 2000 }),
  tiered({ code: "PAVE-01", name: "Paving, path or slab work", cat: "other",
    tiers: [["Small", 140, 150], ["Medium", 350, 240], ["Large", 720, 480]],
    cust: "We lay or repair paving, paths and slabs — prepped, levelled and finished. Choose by area.",
    admin: "Small (single path), Medium (corner/area), Large (full drive). Historical £140-720. Carry-over PAVE-57.",
    conf: "medium", basis: "historical paving £140-720", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "DEEPCLEAN-01", name: "Deep clean (single room)", cat: "other", price: 90, mins: 150,
    cust: "We deep-clean a single room or appliance to a sparkling, refreshed finish.",
    admin: "Targeted clean (oven, bathroom, fridge, AC). Historical £35-135. Carry-over CLN-49.",
    conf: "medium", basis: "historical deep clean £35-135", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "OVEN-CLEAN-01", name: "Oven & hood deep clean", cat: "other", price: 80, mins: 120,
    cust: "We deep-clean your oven and extractor hood inside and out for a grease-free finish.",
    admin: "Oven + hood. Historical deep clean oven+hood £80.",
    conf: "medium", basis: "historical oven clean £80", origin: "new", premium: 2000 }),
  fixed({ code: "AC-CLEAN-01", name: "Air-con clean & filter check", cat: "other", price: 50, mins: 60,
    cust: "We clean your air-conditioning unit and check the filters so it runs clean and efficient.",
    admin: "Split/wall AC clean + filter. Historical £50.",
    conf: "medium", basis: "historical AC clean £50", origin: "new", premium: 2000 }),
  fixed({ code: "VISIT-01", name: "Site visit & assessment", cat: "other", price: 75, mins: 90,
    cust: "We visit, scope the work in person, and give you a clear written plan and quote.",
    admin: "For complex jobs needing in-person scope before quoting. Carry-over VIS-52.",
    conf: "high", basis: "carry-over VIS-52", origin: "carryover-renamed", premium: 2000 }),
  fixed({ code: "POINTING-01", name: "Repointing & brickwork", cat: "other", price: 88, mins: 120,
    cust: "We rake out and repoint loose or crumbling mortar joints for a tidy, weatherproof finish.",
    admin: "Small repointing/brick repair. Historical pointing £88.",
    conf: "medium", basis: "historical pointing £88", origin: "new", premium: 2000 }),
  fixed({ code: "ROOF-MINOR-01", name: "Minor roof repair", cat: "other", price: 100, mins: 120,
    cust: "We carry out small roof repairs — tiles, ventilation or sealing — to keep the weather out.",
    admin: "Vent tiles, reseal, small repairs. Historical vent tiles £100, debris reseal £40. Access dependent.",
    conf: "low", basis: "historical roof minor £40-100 — access varies", origin: "new", premium: 2000 }),
  fixed({ code: "EXTFIX-01", name: "External fixture fitting", cat: "general_fixing", price: 55, mins: 45,
    cust: "We fix outdoor fittings — signs, brackets, house numbers, hose reels — securely and weather-sealed.",
    admin: "Small outdoor fixtures. Use a specific SKU if one fits. Carry-over EXTFX-59.",
    conf: "medium", basis: "historical external fixture £45-60", origin: "carryover-renamed", premium: 2000 }),
);

// ===========================================================================
// VALIDATION + EMIT
// ===========================================================================

const VALID_CATEGORIES = new Set([
  "general_fixing", "plumbing_minor", "electrical_minor", "tv_mounting", "carpentry",
  "painting", "tiling", "flooring", "flat_pack", "door_fitting", "lock_change",
  "curtain_blinds", "shelving", "silicone_sealant", "plastering", "guttering",
  "pressure_washing", "fencing", "garden_maintenance", "furniture_repair",
  "waste_removal", "bathroom_fitting", "kitchen_fitting", "other",
]);

function validate(c: Sku[]) {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const s of c) {
    if (!s.sku_code || s.sku_code.length > 20) errs.push(`${s.sku_code}: code missing or >20 chars`);
    if (seen.has(s.sku_code)) errs.push(`${s.sku_code}: DUPLICATE code`);
    seen.add(s.sku_code);
    if (!VALID_CATEGORIES.has(s.category)) errs.push(`${s.sku_code}: invalid category '${s.category}'`);
    if (!s.name) errs.push(`${s.sku_code}: missing name`);
    if (!s.customer_description) errs.push(`${s.sku_code}: missing customer_description`);
    if (/\b(hour|hours|hr|minute|minutes|min)\b/i.test(s.customer_description))
      errs.push(`${s.sku_code}: customer_description mentions time`);
    if (s.shape === "fixed" && (s.price_pence == null || s.schedule_minutes == null))
      errs.push(`${s.sku_code}: fixed missing price/schedule`);
    if (s.shape === "per_unit" && (s.price_per_unit_pence == null || !s.unit_label || s.minimum_units == null))
      errs.push(`${s.sku_code}: per_unit missing fields`);
    if (s.shape === "tiered" && (!s.tiers || s.tiers.length < 1))
      errs.push(`${s.sku_code}: tiered missing tiers`);
  }
  return errs;
}

const errs = validate(catalog);
if (errs.length) {
  console.error("[build] VALIDATION FAILED:");
  errs.forEach(e => console.error("  - " + e));
  process.exit(1);
}

// Representative price for a SKU (for display / coverage banding).
function repPence(s: Sku): number {
  if (s.shape === "fixed") return s.price_pence!;
  if (s.shape === "per_unit") return (s.price_per_unit_pence! * (s.minimum_units || 1));
  const t = s.tiers!;
  return t[Math.floor(t.length / 2)].pricePence; // median tier
}
function priceDisplay(s: Sku): string {
  if (s.shape === "fixed") return `£${(s.price_pence! / 100).toFixed(0)}`;
  if (s.shape === "per_unit") return `£${(s.price_per_unit_pence! / 100).toFixed(0)}/${s.unit_label}`;
  const t = s.tiers!;
  return `£${(t[0].pricePence / 100).toFixed(0)}–£${(t[t.length - 1].pricePence / 100).toFixed(0)}`;
}
function scheduleDisplay(s: Sku): string {
  if (s.shape === "fixed") return `${s.schedule_minutes}m`;
  if (s.shape === "per_unit") return `${s.setup_minutes}+${s.minutes_per_unit}m/${s.unit_label}`;
  const t = s.tiers!;
  return `${t[0].scheduleMinutes}–${t[t.length - 1].scheduleMinutes}m`;
}

// ---- Coverage estimate against historical line items ----------------------
// Keyword map: SKU code -> trigger terms found in historical descriptions.
const COVERAGE_KEYWORDS: Record<string, string[]> = {
  "TAP-KIT-01": ["kitchen tap"], "TAP-BATH-01": ["bathroom tap", "basin tap"],
  "TAP-REPAIR-01": ["leaking tap", "faulty tap", "tap barrel", "dripping tap"],
  "TAP-OUT-01": ["external tap", "outside tap", "external water tap"],
  "TAP-CART-01": ["cartridge", "tap barrel"], "TOI-REPAIR-01": ["leaking toilet", "toilet flush", "fill valve", "flush mechanism", "syphon", "toilet pan"],
  "TOI-SWAP-01": ["new toilet", "install toilet", "replace toilet"], "TOI-SEAT-01": ["toilet seat"],
  "TOI-UNBLK-01": ["unblock toilet"], "DRAIN-UNBLK-01": ["unblock shower", "blocked drain", "waste pipe"],
  "LEAK-FIND-01": ["leak", "investigate leak", "identify leak"], "SHWR-FIX-01": ["shower unit", "shower mixer", "replace shower", "install shower", "electric shower", "supplied shower", "inspect shower"],
  "SHWR-BAR-01": ["bar mixer", "riser rail"], "SHWR-HOSE-01": ["shower hose", "shower head", "shower holder"],
  "RAD-SWAP-01": ["radiator"], "RAD-TOWEL-01": ["towel rail"], "BALLV-01": ["stopcock", "isolation valve"],
  "WHEAT-01": ["water heater"], "WASH-PLUMB-01": ["washing machine", "dishwasher", "inlet hole"],
  "SIL-BATH-01": ["reseal bath", "re-seal bath", "bath silicone", "seal bath", "silicone", "re-silicone", "sanitary silicone", "anti-mould", "anti mould", "aunti mould"], "SIL-SHWR-01": ["reseal shower", "shower silicone", "seal shower tray", "shower seal", "shower cubicle silicone"],
  "SIL-SINK-01": ["reseal sink", "sink silicone", "seal behind sink", "worktop junction", "splashback", "sink back and re seal", "re-silicone"],
  "SIL-WIN-01": ["window sealant", "reseal window", "caulk", "window-to-sill"], "CAULK-01": ["caulk", "tile trim"],
  "HANG-PIC-01": ["hang picture", "install picture", "hang canvas"], "HANG-MIR-01": ["mirror"],
  "HANG-CLK-01": ["clock", "hang sign", "hooks", "notice board", "phone charger", "sign on wall"], "FILL-HOLE-01": ["fill hole", "fill 2 holes", "fill holes", "expanding foam", "crack", "filler", "make good", "damaged walls with filler"],
  "KEYSAFE-01": ["key safe"], "FLYSCRN-01": ["fly screen"], "DRSTOP-01": ["doorstop"],
  "TOWRAIL-01": ["towel holder", "towel ring"], "BATHACC-01": ["soap dish", "roll holder", "robe hook"],
  "BABYGATE-01": ["baby gate", "safety gate"], "CATFLAP-01": ["cat flap"], "MISC-SMALL-01": ["misc fix", "small bits", "handful of small"],
  "SHELF-FLOAT-01": ["floating shelf", "floating shelves"], "SHELF-BRKT-01": ["shelf", "shelves", "shelving"],
  "SHELF-UNIT-01": ["shelving unit", "bookshelf", "bookcase"], "TV-PLBD-01": ["tv", "tv bracket", "tv wall", "mount tv"],
  "TV-BRICK-01": ["tv solid", "tv brick"], "TV-CABLE-01": ["trunking", "conceal cable"], "SBAR-01": ["soundbar"],
  "DOORBELL-01": ["doorbell", "ring doorbell"], "CAM-01": ["security camera", "cctv"],
  "SCKT-SWAP-01": ["socket"], "SCKT-NEW-01": ["new socket", "add socket"], "SWCH-01": ["light switch", "switch"],
  "LIGHT-SWAP-01": ["light fitting", "ceiling light", "wall light", "led light", "bathroom light"],
  "PENDANT-01": ["pendant"], "DLIGHT-01": ["downlight", "spotlight", "down lights"], "FAN-01": ["extractor fan", "extractor"],
  "FAN-CORD-01": ["pull cord", "pull-cord"], "SMOKE-01": ["smoke alarm", "co alarm", "carbon monoxide"],
  "SPUR-01": ["fuse spur", "fused spur"], "FLOOD-01": ["floodlight", "flood light", "solar light", "external floodlight"],
  "ELEC-DIAG-01": ["diagnose", "inspect and repair fused"], "BLIND-01": ["blind"], "BLIND-BAY-01": ["bay window"],
  "CURT-RAIL-01": ["curtain rail", "curtain pole"], "CURT-TRACK-01": ["curtain track", "pvc track", "bendable"],
  "CURT-REFIX-01": ["refix curtain", "reffix curtain", "curtain rail came down", "loose curtain"],
  "PAINT-ROOM-01": ["paint", "repaint", "rooms", "bedroom", "living room and kitchen", "hallway"], "PAINT-WALL-01": ["paint wall", "paint one bedroom wall", "repaint marked wall", "paint walls", "wall white", "wall grey"],
  "PAINT-CEIL-01": ["ceiling", "paint ceiling"], "PAINT-WOOD-01": ["skirting", "gloss skirting", "woodwork"],
  "PAINT-DOOR-01": ["paint door", "bathroom door", "repaint living room door"], "PAINT-FRDOOR-01": ["front door"],
  "PAINT-SILL-01": ["window sill", "sill"], "STAINBLK-01": ["stain block", "stain-block", "stainblock"],
  "MOULD-PAINT-01": ["mould", "mould treat"], "PAINT-TOUCH-01": ["touch-up", "touch up", "patch hole"],
  "PAINT-EXT-01": ["render", "facade", "rendered"], "WALLPAPER-STRIP-01": ["strip wallpaper", "remove wallpaper", "wallpaper from"],
  "WALLPAPER-HANG-01": ["install wallpaper", "hang wallpaper"], "PAINT-FENCE-01": ["paint fence", "paint garden fence", "fence", "pagoda"],
  "PAINT-METAL-01": ["pipework", "garage door black", "meter cupboard", "boiler pipework"],
  "SKIRT-01": ["skirting"], "PANEL-01": ["panelling", "paneling", "beading"], "PLINTH-01": ["plinth"],
  "BTHPNL-01": ["bath panel", "bath pannel"], "CEILTILE-01": ["ceiling tile"], "WINBOARD-01": ["window board"],
  "SASH-01": ["sash", "sash cord", "sash window"], "BOXIN-01": ["boxing", "box in", "boxing in"], "BEAM-01": ["beam", "mantel"],
  "GATE-WOOD-01": ["wooden gate", "repair gate"], "VANITY-TOP-01": ["vanity top"], "CARP-MISC-01": ["timber", "battens", "feather board"],
  "DOOR-INT-01": ["internal door", "hang door", "bedroom door", "oak door", "hang new internal"], "DOOR-EXT-01": ["external door", "external doors"],
  "DOOR-FRAME-01": ["door frame", "build door frame", "rehang door"], "DOOR-ADJ-01": ["adjust door", "plane", "sticking door", "plane back", "close correctly"],
  "DOOR-HW-01": ["door handle", "handle, lock", "replace handle"], "DOOR-HINGE-01": ["cupboard door hinge", "wardrobe hinge", "cupboard door", "hinge"],
  "LETTERBOX-01": ["letterbox"], "FIREDOOR-SEAL-01": ["fire door", "smoke seal", "self closure", "intumescent"],
  "GARAGE-DOOR-01": ["garage door"], "FP-WARDROBE-01": ["wardrobe"], "FP-BED-01": ["bed", "headboard", "ottoman bed"],
  "FP-DESK-01": ["desk", "table", "chair"], "FP-DRAWERS-01": ["drawers", "drawer"], "FP-SOFA-01": ["sofa"],
  "FP-MISC-01": ["flat pack", "flat-pack", "assemble", "bicycle"], "FURN-FIX-01": ["drawer runner", "cabinet", "cupboard repair", "hinge replacement"],
  "FURN-MOVE-01": ["dismantle and move", "move ottoman", "move to garage"], "TILE-01": ["tile", "tiling", "retile", "re-tile"],
  "REGROUT-01": ["regrout", "re-grout", "grout"], "SPLASH-01": ["splashback"], "TILE-REMOVE-01": ["remove tiling", "remove tile"],
  "KIT-UNIT-01": ["kitchen unit", "kitchen cupboard", "base unit"], "KIT-WORKTOP-01": ["worktop"], "KIT-DOOR-01": ["cupboard door", "dishwasher front"],
  "KIT-DRILL-01": ["drill", "inlet hole", "drill holes"], "BATH-SUITE-01": ["bathroom suite", "bathroom refresh", "remove bathroom suite"],
  "BATH-BASIN-01": ["basin", "vanity unit"], "BATH-SHWRPNL-01": ["shower panelling", "shower panel", "bath panelling"],
  "SHWR-SCRN-01": ["shower screen", "shower cubicle", "shower tray and cubicle", "glass shower screen"],
  "FLOOR-LAM-01": ["laminate", "vinyl", "lvt", "vinyl flooring"], "FLOOR-WOOD-01": ["engineered wood", "herringbone", "solid wood"],
  "FLOOR-CARPET-01": ["carpet"], "FLOOR-LIFT-01": ["remove and dispose of laminate", "remove carpet", "remove flooring"],
  "PLAST-01": ["plaster", "skim", "replaster"], "PLASTERBOARD-01": ["plasterboard"], "PLAST-SAND-01": ["sand back wall", "sand walls", "fill imperfections"],
  "GARDEN-TIDY-01": ["weed and tidy", "tidy garden", "garden area", "overgrown", "cut back weeds", "remove weeds", "remove garden bush"],
  "LAWN-MOW-01": ["mow", "lawn"], "HEDGE-01": ["hedge"], "TURF-01": ["turf", "topsoil"], "WEED-TREAT-01": ["herbicide", "weedkiller", "weed treatment"],
  "WEED-MEMBRANE-01": ["weed membrane", "membrane"], "WASHLINE-01": ["washing line"], "FENCE-PANEL-01": ["fence panel", "broken panel", "arden gate"],
  "FENCE-POST-01": ["fence post"], "TRELLIS-01": ["trellis"], "GUTTER-CLEAR-01": ["clear gutter", "gutters and downpipe"], "GUTTER-REPAIR-01": ["gutter corner", "downpipe repair", "gutter"],
  "JETWASH-01": ["jet wash", "jet-wash", "pressure-wash", "pressure wash", "patio"], "JETWASH-ROOF-01": ["jet wash roof", "clean and jet wash roof"], "JETWASH-DECK-01": ["jet wash deck"],
  "WASTE-01": ["waste", "rubbish", "clear garden", "site clean"], "WASTE-APPLI-01": ["dispose of fridge", "remove fridge", "fridge and freezer"],
  "WASTE-FURN-01": ["remove furniture", "dispose furniture"], "SHED-INSTALL-01": ["install shed", "shed kit", "forest blackwood shed", "plastic shed", "summer house"],
  "SHED-REMOVE-01": ["dismantle shed", "remove shed", "old wooden shed"], "SHED-BASE-01": ["shed base", "concrete shed base"],
  "DECK-01": ["decking", "deck board"], "PAVE-01": ["paving", "slab", "pavement slab", "lay slab", "concrete slab", "path"],
  "DEEPCLEAN-01": ["deep clean", "clean refrigerator", "defrost"], "OVEN-CLEAN-01": ["clean oven", "oven and extractor"], "AC-CLEAN-01": ["ac unit", "air con", "clean ac"],
  "VISIT-01": ["site visit", "assessment", "quote on the day"], "POINTING-01": ["pointing", "repoint"],
  "ROOF-MINOR-01": ["roof tile", "ventilation roof", "vent tile", "ply roof", "reseal", "polycarbonate roof"],
  "EXTFIX-01": ["parking sign", "street sign", "external fixture", "house number", "signage", "hose pipe", "hose reel", "solar lights to posts"],
  "LOCK-01": ["lock change", "anti-snap", "change lock", "front door lock"],
  "LOCK-MULTI-01": ["2 locks", "two locks", "multiple locks", "locks on front door"],
  "LOCK-CABINET-01": ["cabinet lock", "coded lock", "keypad lock", "gate lock", "cupboard lock"],
  "LOCK-DIAG-01": ["repair front door lock", "stuck key", "sticking lock", "fix coded lock"],
  "HANDRAIL-01": ["handrail", "hand rail", "stair rail"],
  "CURT-REFIX-01b": [], // placeholder, merged below
};
// Augment a few existing keyword sets for phrasing variants seen in data.
COVERAGE_KEYWORDS["CURT-REFIX-01"].push("curtain holder", "curtain rail with correct fixings");
COVERAGE_KEYWORDS["SHED-INSTALL-01"].push("6' x 3'", "6x4 shed", "6' x 4'", "new shed");
COVERAGE_KEYWORDS["SHED-REMOVE-01"].push("dismantle", "second old shed");
COVERAGE_KEYWORDS["DEEPCLEAN-01"].push("toilet bowl", "disinfect toilet", "clean toilet", "deep clean toilet");
COVERAGE_KEYWORDS["ROOF-MINOR-01"].push("polycarbonate", "roof sheet");
delete (COVERAGE_KEYWORDS as any)["CURT-REFIX-01b"];

// Coverage: for each historical item, does ANY SKU's keyword match its desc?
const snap = JSON.parse(fs.readFileSync("/tmp/agent25a-lineitems.json", "utf8"));
const histItems: { desc: string; pricePence: number }[] = snap.items;
let matched = 0;
const codeHits: Record<string, number> = {};
for (const it of histItems) {
  const d = it.desc.toLowerCase();
  let hit = false;
  for (const [code, kws] of Object.entries(COVERAGE_KEYWORDS)) {
    if (kws.some(k => d.includes(k))) { hit = true; codeHits[code] = (codeHits[code] || 0) + 1; }
  }
  if (hit) matched++;
}
const coveragePct = ((matched / histItems.length) * 100).toFixed(1);

// ---- Stats ----------------------------------------------------------------
const byShape: Record<string, number> = {};
const byCat: Record<string, number> = {};
const byOrigin: Record<string, number> = {};
for (const s of catalog) {
  byShape[s.shape] = (byShape[s.shape] || 0) + 1;
  byCat[s.category] = (byCat[s.category] || 0) + 1;
  byOrigin[s._origin] = (byOrigin[s._origin] || 0) + 1;
}
const lowConf = catalog.filter(s => s._confidence === "low");

// ---- Write JSON -----------------------------------------------------------
const dataDir = path.join(process.cwd(), "scripts", "data");
fs.mkdirSync(dataDir, { recursive: true });
const jsonPath = path.join(dataDir, "sku-catalog-v3.json");
fs.writeFileSync(jsonPath, JSON.stringify(catalog, null, 2));
console.log(`[build] Wrote ${catalog.length} SKUs to ${jsonPath}`);

// ---- Write Markdown proposal ----------------------------------------------
const md: string[] = [];
md.push("# SKU Catalog v3 — Proposal (for review)\n");
md.push(`> **Status:** PROPOSAL ONLY. Nothing has been written to the database. ` +
  `Review and approve before the seed phase.\n`);
md.push(`Generated by \`scripts/_build-sku-catalog-v3.ts\` on ${new Date().toISOString().slice(0, 10)}. ` +
  `Naming, clustering and pricing were done by Claude's own reasoning, anchored to historical medians ` +
  `from the last 200 verified-viewed quotes (${histItems.length} line items) where data exists, and ` +
  `UK-market (Nottingham) estimates otherwise.\n`);

md.push("## Summary\n");
md.push(`- **Total SKUs proposed: ${catalog.length}** (up from 49)`);
md.push(`- **By shape:** ` + Object.entries(byShape).sort().map(([k, v]) => `${v} ${k}`).join(" · "));
md.push(`- **By origin:** ` +
  `${byOrigin["carryover-renamed"] || 0} carried-over & renamed · ` +
  `${byOrigin["split"] || 0} split into variants · ` +
  `${byOrigin["new"] || 0} brand-new` +
  (byOrigin["carryover"] ? ` · ${byOrigin["carryover"]} carried-over unchanged` : ""));
md.push(`- **Estimated historical coverage:** ~${coveragePct}% of ${histItems.length} line items match at ` +
  `least one SKU by keyword (the original 49 covered 87.6%).`);
md.push(`- **Low-confidence rows needing price review:** ${lowConf.length}\n`);

md.push("### SKUs by category\n");
md.push("| Category | Count |");
md.push("|---|---:|");
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) md.push(`| ${c} | ${n} |`);
md.push("");

md.push("## Naming: before → after (sample)\n");
const renameSamples: [string, string][] = [
  ["Tap repair or replacement", "Kitchen tap swap / Bathroom tap swap / Dripping tap repair (split into 3)"],
  ["Internal door hang or fit", "Internal door hanging"],
  ["Wall-mount hardware fit", "Hang pictures & frames / Hang a mirror / Hang clocks, signs & hooks (split)"],
  ["Site visit or assessment", "Site visit & assessment"],
  ["Light fitting install or swap", "Light fitting swap / Pendant light swap / Downlight or spotlight swap (split)"],
  ["Socket install or replacement", "Socket swap / Add a new socket (split)"],
  ["Gutter clear or repair", "Gutter clearing / Gutter or downpipe repair (split)"],
  ["Flat-pack assembly", "Wardrobe assembly / Bed assembly / Desk or table assembly / Drawers or cabinet assembly (split)"],
  ["Touch-up and patch paint", "Touch-up & patch paint (repriced — old £180 was wrong, now £68)"],
  ["Pressure wash patio or driveway", "Jet-wash patio or driveway"],
];
md.push("| Before (v1) | After (v3) |");
md.push("|---|---|");
for (const [a, b] of renameSamples) md.push(`| ${a} | ${b} |`);
md.push("");

md.push("## Low-confidence rows — review these first\n");
md.push("These have weak or single-point historical data, or scope that genuinely varies. " +
  "Confirm the price/scope before seeding.\n");
md.push("| Code | Name | Category | Price | Why low confidence |");
md.push("|---|---|---|---|---|");
for (const s of lowConf) md.push(`| ${s.sku_code} | ${s.name} | ${s.category} | ${priceDisplay(s)} | ${s._priceBasis} |`);
md.push("");

md.push("## Full catalog\n");
md.push("| Code | Name | Category | Shape | Price | Schedule | Conf | Price basis |");
md.push("|---|---|---|---|---|---|---|---|");
const sorted = [...catalog].sort((a, b) => a.category.localeCompare(b.category) || a.sku_code.localeCompare(b.sku_code));
for (const s of sorted) {
  md.push(`| ${s.sku_code} | ${s.name} | ${s.category} | ${s.shape} | ${priceDisplay(s)} | ${scheduleDisplay(s)} | ${s._confidence} | ${s._priceBasis} |`);
}
md.push("");

md.push("## Customer & admin descriptions\n");
md.push("<details><summary>Expand full descriptions</summary>\n");
for (const s of sorted) {
  md.push(`**${s.sku_code} — ${s.name}**  `);
  md.push(`_Customer:_ ${s.customer_description}  `);
  md.push(`_Admin:_ ${s.admin_description}\n`);
}
md.push("</details>\n");

const docPath = path.join(process.cwd(), "docs", "sku-catalog-v3-proposal.md");
fs.writeFileSync(docPath, md.join("\n"));
console.log(`[build] Wrote proposal to ${docPath}`);

// ---- Console summary ------------------------------------------------------
console.log("\n===== BUILD SUMMARY =====");
console.log(`Total SKUs: ${catalog.length}`);
console.log(`By shape: ${JSON.stringify(byShape)}`);
console.log(`By origin: ${JSON.stringify(byOrigin)}`);
console.log(`Coverage: ~${coveragePct}% of ${histItems.length} historical line items`);
console.log(`Low-confidence: ${lowConf.length} (${lowConf.map(s => s.sku_code).join(", ")})`);
// Surface uncovered historical descriptions (sample) to gauge honesty of estimate
const uncovered = histItems.filter(it => {
  const d = it.desc.toLowerCase();
  return !Object.values(COVERAGE_KEYWORDS).some(kws => kws.some(k => d.includes(k)));
});
console.log(`Uncovered historical lines: ${uncovered.length}. Sample:`);
uncovered.slice(0, 60).forEach(u => console.log("   · " + u.desc.slice(0, 75)));

export default catalog;







