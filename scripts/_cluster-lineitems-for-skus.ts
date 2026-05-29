/**
 * Agent 25a STEP 2-4 — Cluster the extracted line items into ~50 SKU candidates
 * and compute per-cluster shape (Type A/B/C) + canonical price + scheduleMinutes.
 *
 * Reads /tmp/agent25a-lineitems.json (from _extract-lineitems-for-skus.ts).
 * Writes /tmp/agent25a-clusters.json — the SKU candidate set for the seed.
 *
 * Approach: Both LLM (Claude) and embedding (OpenAI) credits are exhausted,
 * so we use a deterministic curated-keyword clustering scheme. The 50 SKU
 * candidates are defined as keyword groups, drawn directly from the patterns
 * visible in the production line-item corpus. Each line item is assigned to
 * its best-matching cluster; unassigned items become "novel work" (discarded
 * from SKUs but counted toward coverage).
 *
 * The keyword rules below were hand-derived after inspecting the full corpus
 * (526 line items from 200 verified-viewed quotes) — see the agent report.
 */

import 'dotenv/config';
import fs from "fs";
import { clampLineItemMinutes } from "../shared/scheduling-caps";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function median(nums: number[]): number {
    const f = nums.filter(n => Number.isFinite(n) && n > 0).slice().sort((a, b) => a - b);
    if (f.length === 0) return 0;
    const mid = Math.floor(f.length / 2);
    return f.length % 2 === 0 ? Math.round((f[mid - 1] + f[mid]) / 2) : f[mid];
}

function stdev(nums: number[]): number {
    const f = nums.filter(n => Number.isFinite(n) && n > 0);
    if (f.length < 2) return 0;
    const mean = f.reduce((s, n) => s + n, 0) / f.length;
    return Math.sqrt(f.reduce((s, n) => s + (n - mean) ** 2, 0) / f.length);
}

// ---------------------------------------------------------------------------
// CURATED CLUSTER DEFINITIONS
//
// Each rule = a candidate SKU. Order matters: first match wins. Specific
// rules come before catch-alls. We prefer many-keyword OR matches so we
// catch phrasing variants.
//
// shape:
//   "fixed"    — single canonical scope (Type A)
//   "per_unit" — scales by count (Type B); requires unitLabel
//   "tiered"   — scope varies widely (Type C); 3 tiers
//
// `must` — at least one of these tokens must appear (whole-word, case-insensitive)
// `mustNot` — none of these may appear (used to disambiguate from sibling rules)
// `categoryHint` — if present, prefer this rule when item.category matches
// ---------------------------------------------------------------------------
type ClusterRule = {
    name: string;
    skuCodePrefix: string;
    shape: "fixed" | "per_unit" | "tiered";
    category: string;
    must: string[];          // any-of
    mustAll?: string[];      // all-of
    mustNot?: string[];      // none-of
    unitLabel?: string;      // Type B only
    /** Description used as the customer-facing string */
    customerLine: string;
    /** Description used as the admin helper */
    adminLine: string;
};

const RULES: ClusterRule[] = [
    // -------- Plumbing — taps, toilets, showers, leaks, blockages --------
    {
        name: "Tap repair or replacement",
        skuCodePrefix: "TAP",
        shape: "fixed",
        category: "plumbing_minor",
        must: ["tap", "taps", "stopcock"],
        mustNot: ["fence", "shower mixer"],
        customerLine: "Tap repair or replacement. Includes labour and standard fittings; isolate, swap, test, tidy.",
        adminLine: "Use for any kitchen/basin tap fix or swap. Per-tap pricing only when 2+ taps in same visit.",
    },
    {
        name: "Toilet repair or replacement",
        skuCodePrefix: "TOI",
        shape: "fixed",
        category: "plumbing_minor",
        must: ["toilet", "wc", "cistern", "flush", "syphon"],
        mustNot: ["unblock", "clear", "blocked"],
        customerLine: "Toilet repair or like-for-like replacement. Includes isolation, fit, leak-test.",
        adminLine: "Mechanism repairs, flush valve, syphon, full pan swap. Not for blockages.",
    },
    {
        name: "Unblock toilet or drain",
        skuCodePrefix: "UNBLK",
        shape: "fixed",
        category: "plumbing_minor",
        must: ["unblock", "blocked", "clogged", "blockage", "drain clear"],
        customerLine: "Unblock toilet, sink or drain. Plunger/auger as needed; flush-test before we leave.",
        adminLine: "For any internal blockage. Excludes mains drain CCTV work.",
    },
    {
        name: "Shower repair or replacement",
        skuCodePrefix: "SHWR",
        shape: "fixed",
        category: "plumbing_minor",
        must: ["shower"],
        mustNot: ["screen", "cubicle", "tray", "tile"],
        customerLine: "Shower mixer or unit repair/replacement. Includes labour, test for safe temperature and flow.",
        adminLine: "Use when the *shower mechanism* is the work, not the enclosure or tiling.",
    },
    {
        name: "Shower screen or cubicle install",
        skuCodePrefix: "SCRN",
        shape: "fixed",
        category: "general_fixing",
        must: ["shower screen", "shower cubicle", "shower tray", "bath screen"],
        customerLine: "Shower screen or cubicle install. Fit, seal, level and finish-check.",
        adminLine: "Enclosure work only — not the mixer/unit.",
    },
    {
        name: "Radiator or towel-rail install",
        skuCodePrefix: "RAD",
        shape: "fixed",
        category: "plumbing_minor",
        must: ["radiator", "towel rail", "towel-rail", "towel rad"],
        customerLine: "Radiator or heated towel-rail install or refit. Includes isolation, bleed, balance.",
        adminLine: "For rad swaps, refits, and new towel rails. Heating system mods need a separate quote.",
    },
    {
        name: "Leak diagnosis and repair",
        skuCodePrefix: "LEAK",
        shape: "fixed",
        category: "plumbing_minor",
        must: ["leak", "leaking", "leaks", "dripping"],
        mustNot: ["tap", "taps", "toilet"],
        customerLine: "Leak diagnosis and repair. We find the source, fix where possible, advise on next steps.",
        adminLine: "Use for visible leaks not tied to a specific tap/toilet rule.",
    },
    {
        name: "Outside tap or garden plumbing",
        skuCodePrefix: "OTAP",
        shape: "fixed",
        category: "plumbing_minor",
        must: ["external water tap", "outside tap", "garden tap", "external tap"],
        customerLine: "Outside tap install. Drill through, fit valve, test for leaks.",
        adminLine: "Garden taps; not internal sinks.",
    },

    // -------- Electrical — sockets, lights, alarms, fans --------
    {
        name: "Socket install or replacement",
        skuCodePrefix: "SCKT",
        shape: "per_unit",
        category: "electrical_minor",
        must: ["socket", "sockets", "outlet", "outlets"],
        unitLabel: "socket",
        customerLine: "Socket install or replacement. Per socket — labour, faceplate, safety-test.",
        adminLine: "Per-socket pricing. Like-for-like swaps and new spurs (single feed).",
    },
    {
        name: "Light fitting install or swap",
        skuCodePrefix: "LIGHT",
        shape: "per_unit",
        category: "electrical_minor",
        must: ["light fitting", "downlight", "downlights", "pendant", "ceiling light", "spotlight", "spotlights"],
        mustNot: ["floodlight"],
        unitLabel: "light",
        customerLine: "Light fitting install or swap. Per fitting — wire, mount, test.",
        adminLine: "Per-light pricing. Like-for-like and straightforward new fittings on existing supply.",
    },
    {
        name: "Smoke or CO alarm install",
        skuCodePrefix: "ALRM",
        shape: "per_unit",
        category: "electrical_minor",
        must: ["smoke alarm", "smoke alarms", "co alarm", "carbon monoxide", "heat alarm"],
        unitLabel: "alarm",
        customerLine: "Smoke or CO alarm install. Per alarm — mount, link if applicable, test.",
        adminLine: "Per-alarm pricing. Battery and mains-powered both supported.",
    },
    {
        name: "Extractor fan repair or install",
        skuCodePrefix: "FAN",
        shape: "fixed",
        category: "electrical_minor",
        must: ["extractor fan", "extractor", "bathroom fan", "kitchen fan", "exhaust fan"],
        customerLine: "Extractor fan repair or like-for-like replacement. Includes test, vent check.",
        adminLine: "Bathroom/kitchen fans. Includes inline diagnosis.",
    },
    {
        name: "Doorbell or video doorbell install",
        skuCodePrefix: "BELL",
        shape: "fixed",
        category: "electrical_minor",
        must: ["doorbell", "ring doorbell", "video doorbell"],
        customerLine: "Doorbell install. Mount, wire (or pair to chime), test.",
        adminLine: "Smart and conventional doorbells. Power must be available.",
    },
    {
        name: "Outdoor lighting or floodlight install",
        skuCodePrefix: "FLOOD",
        shape: "fixed",
        category: "electrical_minor",
        must: ["floodlight", "outdoor light", "external light", "external floodlight", "garden light", "porch light"],
        customerLine: "Outdoor light or floodlight install. Mount, wire, test, weather-seal.",
        adminLine: "Externally-mounted lights. Power supply must already be near.",
    },

    // -------- Carpentry / doors / skirting / panelling --------
    {
        name: "Internal door hang or fit",
        skuCodePrefix: "DOOR",
        shape: "per_unit",
        category: "door_fitting",
        must: ["door"],
        mustNot: ["doorbell", "cabinet door", "cupboard door", "garage", "external door"],
        unitLabel: "door",
        customerLine: "Internal door fit. Per door — hang, plane, fit hinges and latch, hardware on.",
        adminLine: "Internal doors only. External doors quoted separately due to weather-seal time.",
    },
    {
        name: "External door fit",
        skuCodePrefix: "XDOOR",
        shape: "fixed",
        category: "door_fitting",
        must: ["external door", "front door", "back door", "patio door"],
        mustNot: ["paint", "repaint"],
        customerLine: "External door fit. Hang, weather-seal, fit furniture, test for full latch.",
        adminLine: "External doors only — different cost band to internal.",
    },
    {
        name: "Lock change or upgrade",
        skuCodePrefix: "LOCK",
        shape: "fixed",
        category: "lock_change",
        must: ["lock", "locks", "lock change", "key safe", "barrel"],
        mustNot: ["block", "blocked"],
        customerLine: "Lock change or upgrade. Like-for-like or anti-snap upgrade, test.",
        adminLine: "Residential locks; key safes are also here.",
    },
    {
        name: "Skirting board fit or repair",
        skuCodePrefix: "SKIRT",
        shape: "tiered",
        category: "carpentry",
        must: ["skirting", "skirting board"],
        customerLine: "Skirting board fit or repair. Includes measure, cut, fix and join, ready to caulk and paint.",
        adminLine: "Scope varies wildly by run length — pick Small (one room), Medium (downstairs), Large (full home).",
    },
    {
        name: "Wall panelling or beading install",
        skuCodePrefix: "PNL",
        shape: "tiered",
        category: "carpentry",
        must: ["panelling", "paneling", "beading", "panel", "panels"],
        mustNot: ["bath panel", "fence panel", "ceiling panel", "shower screen", "shower panel"],
        customerLine: "Wall panelling or beading install. Scope varies — choose the tier that matches your wall area.",
        adminLine: "MDF, V-groove, beading. Tier by linear metres.",
    },
    {
        name: "Bath panel fit",
        skuCodePrefix: "BTHPNL",
        shape: "fixed",
        category: "carpentry",
        must: ["bath panel", "bath pannels", "bath panels"],
        customerLine: "Bath panel fit. Includes trim to size, fix and seal.",
        adminLine: "Pre-formed or MDF bath panels.",
    },
    {
        name: "Shelving install",
        skuCodePrefix: "SHELF",
        shape: "per_unit",
        category: "shelving",
        must: ["shelf", "shelves", "shelving", "floating shelf"],
        unitLabel: "shelf",
        customerLine: "Shelving install. Per shelf — locate studs, drill, fix brackets, mount, level.",
        adminLine: "Per-shelf pricing. Heavy load shelves quoted separately.",
    },
    {
        name: "Handrail or staircase work",
        skuCodePrefix: "RAIL",
        shape: "fixed",
        category: "carpentry",
        must: ["handrail", "stair rail", "banister", "balustrade"],
        customerLine: "Handrail or staircase joinery. Includes measure, cut, fix, finish-ready.",
        adminLine: "New rails, repairs, replacement spindles.",
    },
    {
        name: "Window or sash repair",
        skuCodePrefix: "WIN",
        shape: "fixed",
        category: "carpentry",
        must: ["window", "sash cord", "sash window", "window hinge"],
        mustNot: ["bay window blind"],
        customerLine: "Window repair or sash cord replacement. Includes labour and standard fittings.",
        adminLine: "Sash repairs and window hinge work. Glazing is excluded.",
    },

    // -------- TV mounting / fixings on wall --------
    {
        name: "TV wall mount",
        skuCodePrefix: "TVMT",
        shape: "fixed",
        category: "tv_mounting",
        must: ["tv", "television", "mount tv", "wall mount"],
        mustNot: ["furniture", "stand"],
        customerLine: "TV wall mount. Includes locate, fix bracket, mount, cable tidy, test.",
        adminLine: "Up to 65″ TV on plasterboard or brick. Soundbars are separate.",
    },
    {
        name: "Picture, mirror or art hanging",
        skuCodePrefix: "PIC",
        shape: "per_unit",
        category: "general_fixing",
        must: ["picture", "pictures", "mirror", "mirrors", "art", "artwork", "frame", "frames", "clock", "clocks", "canvas"],
        mustNot: ["bathroom mirror cabinet"],
        unitLabel: "item",
        customerLine: "Picture, mirror or art hanging. Per item — fixings appropriate to wall, level, tidy.",
        adminLine: "Per-item pricing. Heavy mirrors (>20kg) quoted separately.",
    },
    {
        name: "Curtain pole or rail fit",
        skuCodePrefix: "CURT",
        shape: "per_unit",
        category: "curtain_blinds",
        must: ["curtain pole", "curtain rail", "curtain rails", "curtain pole", "curtains"],
        unitLabel: "pole",
        customerLine: "Curtain pole or rail fit. Per window — mark, fix, level, test.",
        adminLine: "Per pole/rail. Includes refits.",
    },
    {
        name: "Blind install",
        skuCodePrefix: "BLND",
        shape: "per_unit",
        category: "curtain_blinds",
        must: ["blind", "blinds", "roller blind"],
        unitLabel: "blind",
        customerLine: "Blind install. Per blind — fit brackets, hang, level, cord tidy.",
        adminLine: "Customer-supplied blinds in standard window sizes. Bay windows charged as multiple.",
    },

    // -------- Painting & decorating --------
    {
        name: "Room repaint",
        skuCodePrefix: "RPNT",
        shape: "tiered",
        category: "painting",
        must: ["paint", "repaint", "painting"],
        mustNot: ["touch up", "touch-up", "skirting", "door", "fence", "facade", "rendered", "front", "front door", "ac", "boxing", "stain block only", "stainblock only", "make good only"],
        customerLine: "Interior room repaint. Includes prep, two coats and protect surfaces. Choose tier by room size.",
        adminLine: "Choose Small (single small room), Medium (lounge/bedroom), Large (open plan / multiple rooms).",
    },
    {
        name: "Skirting and trim paint",
        skuCodePrefix: "PSKT",
        shape: "tiered",
        category: "painting",
        must: ["paint skirting", "skirting board", "skirting boards"],
        mustAll: ["paint"],
        customerLine: "Skirting and trim paint. Includes sand, caulk, undercoat and finish coat.",
        adminLine: "Often combined with skirting fit. Tier by linear metres.",
    },
    {
        name: "Door painting",
        skuCodePrefix: "PDOOR",
        shape: "fixed",
        category: "painting",
        must: ["paint door", "front door", "door paint", "repaint door"],
        mustNot: ["fit", "hang", "install"],
        customerLine: "Door painting. Prep, prime if needed, two coats with the customer's chosen finish.",
        adminLine: "Internal or external doors. External adds weather-resistant primer.",
    },
    {
        name: "External façade or render paint",
        skuCodePrefix: "PEXT",
        shape: "tiered",
        category: "painting",
        must: ["facade", "façade", "rendered", "render paint", "external paint", "exterior paint"],
        customerLine: "External façade or render paint. Includes prep, mask, two coats with masonry paint.",
        adminLine: "Outside walls. Tier by elevation surface area.",
    },
    {
        name: "Touch-up and patch paint",
        skuCodePrefix: "TUCH",
        shape: "fixed",
        category: "painting",
        must: ["touch up", "touch-up", "patch paint", "make good", "fill holes", "repair patch"],
        customerLine: "Touch-up and patch paint. Sand, fill, prime if needed, blend in to existing finish.",
        adminLine: "Small areas. Not full-room work.",
    },
    {
        name: "Stain-block or mould paint",
        skuCodePrefix: "STAIN",
        shape: "fixed",
        category: "painting",
        must: ["stain block", "stain-block", "stainblock", "mould", "mold"],
        mustNot: ["silicone"],
        customerLine: "Stain-block or mould-treat and repaint. Clean, treat, stain-block primer and finish coat.",
        adminLine: "Ceilings/walls with damp or stain marks. Damp source must be resolved first.",
    },
    {
        name: "Wallpaper stripping and prep",
        skuCodePrefix: "WPSTR",
        shape: "tiered",
        category: "painting",
        must: ["wallpaper", "strip wallpaper"],
        customerLine: "Wallpaper stripping and prep. Score, steam, strip, fill, sand — walls ready for paint or paper.",
        adminLine: "Prep only — paint or paper booked separately.",
    },

    // -------- Silicone / sealant work --------
    {
        name: "Silicone re-seal",
        skuCodePrefix: "SILR",
        shape: "fixed",
        category: "silicone_sealant",
        must: ["silicone", "sealant", "re-seal", "reseal", "caulk", "caulking"],
        customerLine: "Silicone re-seal. Cut out old sealant, clean, treat with mould-killer, lay fresh mould-resistant silicone.",
        adminLine: "Bath/shower/sink/kitchen. The single most repeated SKU — keep prep time honest.",
    },

    // -------- Tiling --------
    {
        name: "Tiling install",
        skuCodePrefix: "TILE",
        shape: "tiered",
        category: "tiling",
        must: ["tile", "tiles", "tiling", "retile", "re-tile"],
        mustNot: ["floor tile only"],
        customerLine: "Tiling install or re-tile. Includes prep, fix, grout and seal. Choose tier by area.",
        adminLine: "Walls or floors. Tier by m² covered.",
    },

    // -------- Plastering --------
    {
        name: "Plaster patch or skim",
        skuCodePrefix: "PLST",
        shape: "tiered",
        category: "plastering",
        must: ["plaster", "skim", "skim coat", "patch plaster", "expandable filler"],
        mustNot: ["paint"],
        customerLine: "Plaster patch or skim. Includes prep, plaster, sand-ready for paint.",
        adminLine: "Choose Small (single patch), Medium (one wall), Large (full room skim).",
    },

    // -------- Flooring --------
    {
        name: "Flooring install",
        skuCodePrefix: "FLR",
        shape: "tiered",
        category: "flooring",
        must: ["flooring", "laminate", "vinyl floor", "engineered wood", "lvt", "lay floor", "floorboard"],
        customerLine: "Flooring install. Includes underlay if applicable, fit, trim, finish at edges.",
        adminLine: "Laminate, LVT, engineered wood. Tier by m².",
    },

    // -------- Kitchen / bathroom fitting --------
    {
        name: "Flat-pack assembly",
        skuCodePrefix: "FLAT",
        shape: "fixed",
        category: "flat_pack",
        must: ["flat pack", "flat-pack", "assemble", "assembly"],
        mustNot: ["kitchen"],
        customerLine: "Flat-pack furniture assembly. Includes unbox, build, level, dispose of packaging.",
        adminLine: "Wardrobes, beds, bikes, desks. Kitchen units in their own SKU.",
    },
    {
        name: "Kitchen unit install or worktop fit",
        skuCodePrefix: "KIT",
        shape: "tiered",
        category: "kitchen_fitting",
        must: ["kitchen unit", "kitchen units", "worktop", "kitchen fit", "kitchen install", "plinth", "kitchen plinths"],
        customerLine: "Kitchen unit install or worktop fit. Includes measure, fit, scribe, finish.",
        adminLine: "Full or partial kitchen fits. Tier by linear metres of units.",
    },
    {
        name: "Bathroom suite install",
        skuCodePrefix: "BATH",
        shape: "tiered",
        category: "bathroom_fitting",
        must: ["bathroom suite", "bathroom install", "bathroom refresh", "bathroom fit", "vanity unit", "basin and vanity"],
        customerLine: "Bathroom suite install or refresh. Includes strip-out (where needed), fit and connect.",
        adminLine: "Tier by what's being replaced — Small (basin only), Medium (basin + WC), Large (full suite).",
    },
    {
        name: "Cabinet or cupboard repair",
        skuCodePrefix: "CAB",
        shape: "fixed",
        category: "furniture_repair",
        must: ["cupboard", "cabinet", "drawer", "hinge repair", "cabinet door", "cupboard door", "cupboard handles"],
        mustNot: ["bathroom mirror cabinet"],
        customerLine: "Cabinet or cupboard repair. Realign, replace runners/hinges/handles, test.",
        adminLine: "Hinges, runners, handles, dropped doors. Single-cabinet work.",
    },

    // -------- Garden / external --------
    {
        name: "Fence panel install or repair",
        skuCodePrefix: "FNC",
        shape: "per_unit",
        category: "fencing",
        must: ["fence", "fence panel", "fence post"],
        unitLabel: "panel",
        customerLine: "Fence panel install or repair. Per panel — remove old, level posts, fit new.",
        adminLine: "Per-panel pricing. Post replacement adds to the line.",
    },
    {
        name: "Pressure wash patio or driveway",
        skuCodePrefix: "PWSH",
        shape: "tiered",
        category: "pressure_washing",
        must: ["pressure wash", "pressure-wash", "jet wash", "patio wash", "driveway wash"],
        customerLine: "Pressure wash patio, path or driveway. Includes pre-treatment and rinse. Tier by area.",
        adminLine: "Tier by m² of hard surface.",
    },
    {
        name: "Garden tidy and weed",
        skuCodePrefix: "GRDN",
        shape: "tiered",
        category: "garden_maintenance",
        must: ["weed", "weedkiller", "garden", "cut grass", "grass cut", "lawn", "tidy garden", "garden tidy"],
        customerLine: "Garden tidy, weed and lawn cut. Includes light pruning, weed treatment, green-waste removal.",
        adminLine: "Tier by garden size. Hedges quoted separately.",
    },
    {
        name: "Gutter clear or repair",
        skuCodePrefix: "GUTT",
        shape: "fixed",
        category: "guttering",
        must: ["gutter", "guttering", "downpipe"],
        customerLine: "Gutter clear or repair. Includes ladder work, clear debris, flush downpipes.",
        adminLine: "Up to 2-storey. Roof-edge work separately.",
    },
    {
        name: "Shed dismantle or assembly",
        skuCodePrefix: "SHED",
        shape: "fixed",
        category: "garden_maintenance",
        must: ["shed"],
        customerLine: "Shed assembly or dismantle. Includes labour and disposal of waste if dismantling.",
        adminLine: "Pre-built shed kits or removal of old shed.",
    },

    // -------- Waste, clean, ad-hoc --------
    {
        name: "Waste removal",
        skuCodePrefix: "WSTE",
        shape: "tiered",
        category: "waste_removal",
        must: ["waste", "rubbish", "disposal", "clearance", "site clean", "remove and dispose"],
        customerLine: "Waste removal. We load, take and dispose responsibly. Choose by van load.",
        adminLine: "Tier by van load: Small (¼ van), Medium (½ van), Large (full van).",
    },
    {
        name: "Deep clean (single room)",
        skuCodePrefix: "CLN",
        shape: "fixed",
        category: "other",
        must: ["deep clean", "clean refrigerator", "clean ac", "clean a/c", "clean filters"],
        customerLine: "Deep clean of a single room or appliance. Includes labour and supplies for standard finish.",
        adminLine: "Targeted clean (e.g. fridge, AC unit, bathroom). Not a full-home clean.",
    },

    // -------- Hardware on the wall — generic --------
    {
        name: "Wall-mount hardware fit",
        skuCodePrefix: "WMNT",
        shape: "per_unit",
        category: "general_fixing",
        must: ["towel holder", "towel rail", "toilet roll holder", "soap dispenser", "key safe", "bracket", "holder"],
        mustNot: ["radiator", "towel-rail"],
        unitLabel: "item",
        customerLine: "Wall-mount hardware fit. Per item — fix to wall, level, tidy.",
        adminLine: "Per-item pricing for accessories on the wall.",
    },
    {
        name: "Drill through wall or unit",
        skuCodePrefix: "DRL",
        shape: "fixed",
        category: "general_fixing",
        must: ["drill", "drill hole", "drill through"],
        customerLine: "Drill through wall or unit for pipework or cabling. Includes core/jigsaw work as needed.",
        adminLine: "Boilers, washers, range hoods — anywhere a hole's needed in a clean spot.",
    },

    // -------- Site visits & misc --------
    {
        name: "Site visit or assessment",
        skuCodePrefix: "VIS",
        shape: "fixed",
        category: "other",
        must: ["site visit", "assessment", "initial inspection", "consult", "consultation", "gas safe certificate", "inspect"],
        mustNot: ["leak"],
        customerLine: "On-site assessment. We visit, scope the work, give a written plan and quote.",
        adminLine: "Used for complex jobs that need an in-person visit before quoting.",
    },

    // -------- Boiler --------
    {
        name: "Boiler swap or service",
        skuCodePrefix: "BOIL",
        shape: "fixed",
        category: "plumbing_minor",
        must: ["boiler"],
        customerLine: "Boiler swap or service. Includes isolation, swap or service, commissioning.",
        adminLine: "Like-for-like boiler swap or annual service. Notifies Gas Safe partner.",
    },

    // -------- Light switch swap (separate from lights) --------
    {
        name: "Light switch replacement",
        skuCodePrefix: "SWCH",
        shape: "per_unit",
        category: "electrical_minor",
        must: ["light switch", "light switches", "1-gang", "2-gang", "consumer unit", "fuse spur", "rcbo"],
        mustNot: ["downlight"],
        unitLabel: "switch",
        customerLine: "Light switch or small electrical accessory replacement. Per item — isolate, swap, test.",
        adminLine: "Per-switch pricing. Consumer-unit swaps are larger jobs — flag for senior estimate.",
    },

    // -------- Wall hole / crack fill --------
    {
        name: "Wall hole or crack fill",
        skuCodePrefix: "FILL",
        shape: "fixed",
        category: "general_fixing",
        must: ["fill hole", "fill holes", "fill 2 holes", "fill around", "fix crack", "crack fill", "fill and patch", "fill and make good"],
        mustNot: ["paint"],
        customerLine: "Wall hole or crack fill. Includes prep, filler, sand back, paint-ready finish.",
        adminLine: "Small filler work — typically alongside a repaint. If joined with paint, prefer Touch-up SKU.",
    },

    // -------- Hedge trim --------
    {
        name: "Hedge trim and prune",
        skuCodePrefix: "HEDG",
        shape: "fixed",
        category: "garden_maintenance",
        must: ["hedge", "hedges", "prune", "hedge trim", "trim hedge", "trim back"],
        customerLine: "Hedge trim and light prune. Includes labour and disposal of green waste.",
        adminLine: "Up to ~3m linear hedge. Larger jobs need a separate garden quote.",
    },

    // -------- Paving / path / slab work --------
    {
        name: "Paving, path or slab work",
        skuCodePrefix: "PAVE",
        shape: "tiered",
        category: "other",
        must: ["paving", "pavement slab", "slab", "slabs", "sub base", "re lay slabs", "re-lay slabs", "concrete slab"],
        mustNot: ["splashback"],
        customerLine: "Paving, path or slab work. Includes prep, lay, level. Choose tier by area.",
        adminLine: "Outside ground-level work. Small (single path), Medium (driveway corner), Large (full drive).",
    },

    // -------- Decking / outdoor timber --------
    {
        name: "Decking or outdoor timber",
        skuCodePrefix: "DECK",
        shape: "fixed",
        category: "carpentry",
        must: ["decking", "deck board", "feather board", "feather-board", "trellis"],
        customerLine: "Decking or outdoor timber install or repair. Includes labour and standard fixings.",
        adminLine: "Outdoor timber work. Larger structures separately scoped.",
    },

    // -------- Customer signage / brackets / external fixtures --------
    {
        name: "External fixture or signage install",
        skuCodePrefix: "EXTFX",
        shape: "fixed",
        category: "general_fixing",
        must: ["parking sign", "street sign", "washing line", "washing line pole", "sign on wall", "manhole cover", "hooks for", "hang sign", "cat flap", "baby gate", "baby gates", "phone charger"],
        customerLine: "External fixture or signage install. Includes drill, fix, level, weather-seal where needed.",
        adminLine: "Catch-all for small-but-real outdoor/external fixtures. Use the more specific SKU if available.",
    },

    // -------- Bathroom regrout --------
    {
        name: "Regrout or tile refresh",
        skuCodePrefix: "GROUT",
        shape: "fixed",
        category: "tiling",
        must: ["regrout", "re-grout", "re grout"],
        customerLine: "Regrout or refresh existing tiles. Rake out old grout, clean, regrout, polish.",
        adminLine: "Bathroom/kitchen tile refresh. Not a full re-tile.",
    },

    // -------- Hardware swap (hinges, latches) --------
    {
        name: "Door hardware swap",
        skuCodePrefix: "HW",
        shape: "fixed",
        category: "carpentry",
        must: ["hinge", "hinges", "latch", "door handle", "supply new hinges"],
        mustNot: ["cupboard"],
        customerLine: "Door hardware swap. Hinges, latches and handles — fitted and adjusted.",
        adminLine: "On-door hardware only. Cabinet hardware sits under Cabinet repair.",
    },
];

// ---------------------------------------------------------------------------
// Match a line item against the rules
// ---------------------------------------------------------------------------
function matchRule(it: { desc: string; category: string }): number {
    const d = ` ${it.desc.toLowerCase()} `;
    const cat = it.category.toLowerCase();

    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < RULES.length; i++) {
        const rule = RULES[i];

        // mustNot — disqualify
        if (rule.mustNot) {
            let blocked = false;
            for (const mn of rule.mustNot) {
                if (d.includes(` ${mn} `) || d.includes(mn)) {
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;
        }

        // mustAll — every term must appear
        if (rule.mustAll) {
            let allHit = true;
            for (const t of rule.mustAll) {
                if (!d.includes(t)) { allHit = false; break; }
            }
            if (!allHit) continue;
        }

        // must — at least one
        let hits = 0;
        let weight = 0;
        for (const t of rule.must) {
            if (d.includes(t)) {
                hits++;
                weight += t.length;
            }
        }
        if (hits === 0) continue;

        // Score: keyword hits + bonus for category match
        let score = weight + hits * 2;
        if (rule.category === cat) score += 10;
        // Earlier rules win on tiebreak (more specific)
        score += (RULES.length - i) * 0.01;

        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// ---------------------------------------------------------------------------
// Per-unit signal: detect average quantity per line
// ---------------------------------------------------------------------------
function quantityFromDesc(desc: string, unitLabel: string | undefined): number {
    if (!unitLabel) return 1;
    const d = desc.toLowerCase();
    // Look for "N unitLabel" or "N units" near the start
    const patterns = [
        new RegExp(`\\b(\\d{1,2})\\s+(?:${unitLabel}s?|${unitLabel}es)\\b`, "i"),
        new RegExp(`\\b(\\d{1,2})\\s+(?:double|single)?\\s*(?:roller|venetian|wooden|floating|oak|white|tilting)?\\s*(?:${unitLabel}s?)\\b`, "i"),
        /\b(\d{1,2})\s+(blinds|shelves|frames|pictures|mirrors|sockets|lights|doors|panels|curtains|alarms|taps|locks|brackets)\b/i,
    ];
    for (const re of patterns) {
        const m = d.match(re);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n >= 1 && n <= 30) return n;
        }
    }
    // Fallback: leading number
    const m = d.match(/^\D{0,30}(\d{1,2})\D/);
    if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 20) return n;
    }
    return 1;
}

// ---------------------------------------------------------------------------
// Off-peak weekend uplift
// ---------------------------------------------------------------------------
function offPeakUplift(category: string): number {
    const premium = new Set([
        "painting", "tiling", "kitchen_fitting", "bathroom_fitting",
        "door_fitting", "flooring", "tv_mounting", "carpentry",
    ]);
    const emergency = new Set(["lock_change"]);
    if (emergency.has(category)) return 0;
    if (premium.has(category)) return 4000;
    return 2000;
}

// ---------------------------------------------------------------------------
// SKU code generator
// ---------------------------------------------------------------------------
function makeCode(prefix: string, idx: number): string {
    return `${prefix}-${String(idx).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const snap = JSON.parse(fs.readFileSync("/tmp/agent25a-lineitems.json", "utf8"));
    const items: Array<{
        quoteId: string;
        quoteIdx: number;
        liIdx: number;
        desc: string;
        category: string;
        pricePence: number;
        minutes: number;
        materialsCostPence: number;
        actualMinutes: number | null;
        segment: string | null;
        jobDescription: string;
        createdAt: string | null;
    }> = snap.items;

    console.log(`[cluster] Loaded ${items.length} line items.`);
    console.log(`[cluster] Curated keyword cluster scheme: ${RULES.length} candidate SKUs.`);

    // Assign each item to a rule
    const buckets: Array<typeof items> = RULES.map(() => []);
    const unassigned: typeof items = [];
    for (const it of items) {
        const idx = matchRule(it);
        if (idx < 0) unassigned.push(it);
        else buckets[idx].push(it);
    }

    // Stats
    const assigned = items.length - unassigned.length;
    console.log(`[cluster] Assigned ${assigned}/${items.length} = ${((assigned / items.length) * 100).toFixed(1)}% of items.`);
    console.log(`[cluster] ${unassigned.length} items unassigned (will be flagged as 'novel work').`);

    // ------------------------------------------------------------
    // Build SKUs
    // ------------------------------------------------------------
    type SKURow = {
        skuCode: string;
        name: string;
        category: string;
        shape: "fixed" | "per_unit" | "tiered";
        pricePence: number | null;
        scheduleMinutes: number | null;
        pricePerUnitPence: number | null;
        unitLabel: string | null;
        minimumUnits: number | null;
        minutesPerUnit: number | null;
        setupMinutes: number | null;
        tiers: Array<{ label: string; pricePence: number; scheduleMinutes: number }> | null;
        customerDescription: string;
        adminDescription: string;
        flexEligible: boolean;
        offPeakWeekendPremiumPence: number;
        _historicalSize: number;
        _examples: string[];
        _confidence: "high" | "medium" | "low";
        _confidenceReason: string;
    };

    const skuRows: SKURow[] = [];
    for (let i = 0; i < RULES.length; i++) {
        const rule = RULES[i];
        const its = buckets[i];
        if (its.length < 3) continue; // need at least 3 historicals to seed an SKU

        const code = makeCode(rule.skuCodePrefix, i + 1);
        const prices = its.map(it => it.pricePence);
        const mins = its.map(it => it.minutes);
        const medianP = median(prices);
        const medianM = median(mins);
        const pStd = stdev(prices);
        const mStd = stdev(mins);
        const clampedM = clampLineItemMinutes(rule.category, medianM);
        const examples = its.slice(0, 3).map(it => it.desc.slice(0, 100));

        // Confidence
        let conf: "high" | "medium" | "low" = "high";
        const reasons: string[] = [];
        if (its.length < 5) {
            conf = "medium";
            reasons.push(`only ${its.length} historical items`);
        }
        if (medianP > 0 && pStd / medianP > 0.5) {
            conf = "low";
            reasons.push(`price stdev ${Math.round((pStd / medianP) * 100)}% of median`);
        }
        if (clampedM > 0 && mStd / clampedM > 0.6 && rule.shape === "fixed") {
            conf = conf === "low" ? "low" : "medium";
            reasons.push("scope variance high (consider tiered)");
        }
        if (reasons.length === 0) reasons.push("low variance, sufficient sample");

        if (rule.shape === "fixed") {
            skuRows.push({
                skuCode: code,
                name: rule.name,
                category: rule.category,
                shape: "fixed",
                pricePence: medianP,
                scheduleMinutes: Math.max(30, clampedM),
                pricePerUnitPence: null,
                unitLabel: null,
                minimumUnits: null,
                minutesPerUnit: null,
                setupMinutes: null,
                tiers: null,
                customerDescription: rule.customerLine,
                adminDescription: rule.adminLine,
                flexEligible: true,
                offPeakWeekendPremiumPence: offPeakUplift(rule.category),
                _historicalSize: its.length,
                _examples: examples,
                _confidence: conf,
                _confidenceReason: reasons.join("; "),
            });
        } else if (rule.shape === "per_unit") {
            // Derive per-unit price/time from historical quantities
            let totPerUnitPrice = 0;
            let totPerUnitMin = 0;
            let counts = 0;
            for (const it of its) {
                const q = quantityFromDesc(it.desc, rule.unitLabel);
                if (q >= 1 && q <= 30 && it.pricePence > 0) {
                    totPerUnitPrice += it.pricePence / q;
                    totPerUnitMin += it.minutes / q;
                    counts++;
                }
            }
            const pricePer = counts > 0 ? Math.round(totPerUnitPrice / counts) : Math.round(medianP / 2);
            const minPer = counts > 0 ? Math.max(15, Math.round(totPerUnitMin / counts)) : 25;
            const setup = 20;

            skuRows.push({
                skuCode: code,
                name: rule.name,
                category: rule.category,
                shape: "per_unit",
                pricePence: null,
                scheduleMinutes: null,
                pricePerUnitPence: pricePer,
                unitLabel: rule.unitLabel || "item",
                minimumUnits: 1,
                minutesPerUnit: minPer,
                setupMinutes: setup,
                tiers: null,
                customerDescription: rule.customerLine,
                adminDescription: rule.adminLine,
                flexEligible: true,
                offPeakWeekendPremiumPence: offPeakUplift(rule.category),
                _historicalSize: its.length,
                _examples: examples,
                _confidence: conf,
                _confidenceReason: reasons.join("; "),
            });
        } else {
            // tiered
            const sortedP = prices.filter(p => p > 0).slice().sort((a, b) => a - b);
            const sortedM = mins.filter(m => m > 0).slice().sort((a, b) => a - b);
            const q1P = sortedP[Math.floor(sortedP.length * 0.25)] || medianP;
            const q2P = sortedP[Math.floor(sortedP.length * 0.5)] || medianP;
            const q3P = sortedP[Math.floor(sortedP.length * 0.75)] || medianP;
            const q1M = clampLineItemMinutes(rule.category, sortedM[Math.floor(sortedM.length * 0.25)] || clampedM);
            const q2M = clampLineItemMinutes(rule.category, sortedM[Math.floor(sortedM.length * 0.5)] || clampedM);
            const q3M = clampLineItemMinutes(rule.category, sortedM[Math.floor(sortedM.length * 0.75)] || clampedM);

            skuRows.push({
                skuCode: code,
                name: rule.name,
                category: rule.category,
                shape: "tiered",
                pricePence: null,
                scheduleMinutes: null,
                pricePerUnitPence: null,
                unitLabel: null,
                minimumUnits: null,
                minutesPerUnit: null,
                setupMinutes: null,
                tiers: [
                    { label: "Small", pricePence: q1P, scheduleMinutes: Math.max(60, q1M) },
                    { label: "Medium", pricePence: q2P, scheduleMinutes: Math.max(90, q2M) },
                    { label: "Large", pricePence: q3P, scheduleMinutes: Math.max(120, q3M) },
                ],
                customerDescription: rule.customerLine,
                adminDescription: rule.adminLine,
                flexEligible: true,
                offPeakWeekendPremiumPence: offPeakUplift(rule.category),
                _historicalSize: its.length,
                _examples: examples,
                _confidence: conf,
                _confidenceReason: reasons.join("; "),
            });
        }
    }

    // ------------------------------------------------------------
    // Coverage
    // ------------------------------------------------------------
    const usedItems = skuRows.reduce((s, r) => s + r._historicalSize, 0);
    const totalItems = items.length;
    const skuRevenue = skuRows.reduce((s, r, i) => {
        // Find the bucket for this rule and sum its revenue
        const ruleIdx = RULES.findIndex(ru => ru.skuCodePrefix === r.skuCode.split("-")[0]);
        if (ruleIdx < 0) return s;
        const its = buckets[ruleIdx];
        return s + its.reduce((ss, it) => ss + it.pricePence, 0);
    }, 0);
    const totalRev = items.reduce((s, it) => s + it.pricePence, 0);

    console.log(`\n[cluster] Built ${skuRows.length} SKUs from ${RULES.length} candidate rules.`);
    console.log(`[cluster] Item coverage: ${usedItems}/${totalItems} = ${((usedItems / totalItems) * 100).toFixed(1)}%`);
    console.log(`[cluster] Revenue coverage: £${(skuRevenue / 100).toFixed(0)} / £${(totalRev / 100).toFixed(0)} = ${((skuRevenue / Math.max(totalRev, 1)) * 100).toFixed(1)}%`);

    const shapeBreakdown = {
        fixed: skuRows.filter(s => s.shape === "fixed").length,
        per_unit: skuRows.filter(s => s.shape === "per_unit").length,
        tiered: skuRows.filter(s => s.shape === "tiered").length,
    };
    console.log(`[cluster] Shape: fixed=${shapeBreakdown.fixed}, per_unit=${shapeBreakdown.per_unit}, tiered=${shapeBreakdown.tiered}`);
    const skippedRules = RULES.length - skuRows.length;
    console.log(`[cluster] Skipped ${skippedRules} candidate rules with <3 historical items.`);

    fs.writeFileSync("/tmp/agent25a-clusters.json", JSON.stringify({
        builtAt: new Date().toISOString(),
        sourceItemCount: items.length,
        skuCount: skuRows.length,
        coveragePct: (usedItems / totalItems) * 100,
        coverageRevenuePence: skuRevenue,
        totalRevenuePence: totalRev,
        coverageRevenuePct: (skuRevenue / Math.max(totalRev, 1)) * 100,
        shapeBreakdown,
        unassignedCount: unassigned.length,
        unassignedSamples: unassigned.map(it => ({ desc: it.desc, pricePence: it.pricePence, category: it.category, minutes: it.minutes })),
        skippedRuleNames: RULES.filter((r, i) => buckets[i].length < 3).map((r, i) => ({ name: r.name, count: buckets[RULES.indexOf(r)].length })),
        skus: skuRows,
    }, null, 2));

    console.log(`\n[cluster] Wrote /tmp/agent25a-clusters.json`);
    console.log("\n[cluster] --- ALL SKUS ---");
    console.log("  N    code            shape       £             min       cat                       name");
    skuRows.forEach(s => {
        const priceStr = s.pricePence != null ? `£${Math.round(s.pricePence / 100)}` : (s.pricePerUnitPence != null ? `£${Math.round(s.pricePerUnitPence / 100)}/${s.unitLabel}` : "tiered");
        const minStr = s.scheduleMinutes != null ? `${s.scheduleMinutes}m` : (s.minutesPerUnit != null ? `${s.minutesPerUnit}m+${s.setupMinutes}` : "tiered");
        console.log(`  ${String(s._historicalSize).padStart(3)}  ${s.skuCode.padEnd(15)} ${s.shape.padEnd(10)} ${priceStr.padStart(11)} ${minStr.padStart(9)}  ${s.category.padEnd(22)}  ${s.name}`);
    });

    console.log("\n[cluster] --- 15 SAMPLE UNASSIGNED ITEMS (novel work) ---");
    unassigned.slice(0, 15).forEach((it, i) => {
        console.log(`  [${i + 1}] £${(it.pricePence / 100).toFixed(0)} ${it.minutes}m  (${it.category})  ${it.desc.slice(0, 100)}`);
    });

    process.exit(0);
}

main().catch(e => {
    console.error("[cluster] FATAL:", e);
    process.exit(1);
});
