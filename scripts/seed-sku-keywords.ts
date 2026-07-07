/**
 * Seed keywords + negative_keywords + ai_prompt_hint onto service_catalog rows.
 *
 * Run:  npx tsx scripts/seed-sku-keywords.ts
 *       DRY_RUN=1 npx tsx scripts/seed-sku-keywords.ts
 */

import { db } from "../server/db";
import { serviceCatalog } from "../shared/schema";
import { eq } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN === "1";

// ── per-SKU keyword definitions ──────────────────────────────────────────────
// Format: { sku_code: { keywords: string[], negativeKeywords?: string[], aiPromptHint?: string } }
// Keywords are lowercased tokens/phrases the detector will match against.

const SKU_KEYWORDS: Record<string, { keywords: string[]; negativeKeywords?: string[]; aiPromptHint?: string }> = {
  // ── Plumbing minor ────────────────────────────────────────────────────────
  "TAP-KIT-01": {
    keywords: ["kitchen tap", "tap", "faucet", "mixer tap", "hot tap", "cold tap", "dripping tap", "leaking tap", "tap replacement", "new tap", "fit tap", "install tap", "mono tap", "kitchen faucet"],
    negativeKeywords: ["bath tap", "bathroom tap", "outside tap", "garden tap"],
    aiPromptHint: "Customer wants a kitchen tap replaced or installed.",
  },
  "TAP-BATH-01": {
    keywords: ["bathroom tap", "bath tap", "basin tap", "sink tap", "hot and cold tap", "pillar tap", "bath mixer", "basin mixer"],
    negativeKeywords: ["kitchen tap", "outside tap"],
    aiPromptHint: "Customer wants a bathroom or bath tap replaced.",
  },
  "TAP-REPAIR-01": {
    keywords: ["dripping tap", "leaking tap", "tap drip", "tap leak", "fix tap", "repair tap", "tap washer", "tap cartridge"],
    aiPromptHint: "Tap is dripping or leaking and needs repair rather than full replacement.",
  },
  "TAP-OUT-01": {
    keywords: ["outside tap", "garden tap", "external tap", "outdoor tap", "hosepipe tap", "hose tap"],
    aiPromptHint: "Customer wants an outside tap fitted to an external wall.",
  },
  "TAP-CART-01": {
    keywords: ["tap cartridge", "cartridge replacement", "tap washer", "dripping tap internal", "tap not stopping"],
    aiPromptHint: "Tap cartridge or washer needs replacing — tap drips when fully closed.",
  },
  "TOI-REPAIR-01": {
    keywords: ["toilet repair", "toilet fix", "toilet flush", "cistern", "toilet running", "toilet not flushing", "toilet handle", "toilet mechanism", "toilet internals", "filling valve", "toilet float"],
    negativeKeywords: ["toilet unblock", "blocked toilet", "toilet replacement"],
    aiPromptHint: "Toilet mechanism (cistern, flush, fill valve) needs repair.",
  },
  "TOI-SWAP-01": {
    keywords: ["toilet replacement", "new toilet", "replace toilet", "toilet installation", "fit toilet", "wc replacement"],
    aiPromptHint: "Customer wants an entire toilet unit replaced.",
  },
  "TOI-SEAT-01": {
    keywords: ["toilet seat", "loo seat", "seat replacement", "new toilet seat", "fit toilet seat"],
    aiPromptHint: "Toilet seat only needs replacing — not the full toilet.",
  },
  "TOI-UNBLK-01": {
    keywords: ["blocked toilet", "toilet blocked", "toilet unblock", "toilet clog", "overflow toilet", "toilet not draining", "toilet overflowing", "unblock toilet", "clear toilet"],
    aiPromptHint: "Toilet is completely blocked and needs clearing.",
  },
  "DRAIN-UNBLK-01": {
    keywords: ["blocked drain", "drain unblock", "blocked sink", "blocked shower", "slow drain", "draining slow", "not draining", "shower drain", "sink drain", "drain clog", "unblock drain", "clear drain"],
    negativeKeywords: ["toilet"],
    aiPromptHint: "Sink, shower, or bath drain is slow or blocked.",
  },
  "LEAK-FIND-01": {
    keywords: ["leak", "leaking", "water leak", "leak find", "trace leak", "damp", "wet patch", "pipe leak", "water damage", "leak detection", "leak fix", "find leak"],
    aiPromptHint: "Customer has a water leak that needs locating and fixing.",
  },
  "SHWR-FIX-01": {
    keywords: ["shower repair", "shower broken", "shower not working", "shower fix", "electric shower", "shower unit", "power shower", "shower fault"],
    negativeKeywords: ["shower screen", "shower hose", "bar mixer"],
    aiPromptHint: "Shower unit is faulty and needs repair or swap.",
  },
  "SHWR-BAR-01": {
    keywords: ["bar mixer shower", "riser rail", "shower bar", "thermostatic bar", "shower riser", "fit shower"],
    aiPromptHint: "Customer wants a bar mixer shower and riser rail installed.",
  },
  "SHWR-HOSE-01": {
    keywords: ["shower hose", "shower head", "handset", "shower handset", "hose replacement", "shower head blocked", "shower head dripping"],
    aiPromptHint: "Shower hose or head only needs swapping — not the full unit.",
  },
  "RAD-SWAP-01": {
    keywords: ["radiator", "radiator replacement", "new radiator", "fit radiator", "rad swap", "radiator installation", "remove radiator"],
    negativeKeywords: ["towel rail", "bleed"],
    aiPromptHint: "A radiator needs replacing or a new one fitting.",
  },
  "RAD-TOWEL-01": {
    keywords: ["towel radiator", "heated towel rail", "towel rail", "chrome rail", "bathroom radiator", "fit towel rail"],
    aiPromptHint: "Customer wants a heated towel rail fitted.",
  },
  "RAD-BLEED-01": {
    keywords: ["bleed radiator", "radiator cold", "cold top", "air in radiator", "balance radiator", "radiator not heating", "bleed rads", "cold spots"],
    aiPromptHint: "Radiator has cold spots or air trapped — needs bleeding and balancing.",
  },
  "BALLV-01": {
    keywords: ["stopcock", "stop valve", "isolating valve", "isolator", "ball valve", "gate valve", "water main valve"],
    aiPromptHint: "A stopcock, isolation valve, or ball valve needs replacing.",
  },
  "WHEAT-01": {
    keywords: ["water heater", "immersion heater", "hot water tank", "unvented cylinder", "combi alternative", "water heater swap"],
    aiPromptHint: "Standalone water heater or immersion heater needs replacing.",
  },
  "WASH-PLUMB-01": {
    keywords: ["washing machine plumb", "dishwasher plumb", "plumb in washing machine", "appliance install", "washer connection", "dishwasher connection", "waste connection", "supply connection"],
    aiPromptHint: "Washing machine or dishwasher needs plumbing in (waste + supply).",
  },

  // ── Silicone sealant ──────────────────────────────────────────────────────
  "SIL-BATH-01": {
    keywords: ["reseal bath", "bath seal", "bath silicone", "re-seal bath", "bath sealant", "mastic bath", "bath caulk", "black mould seal", "gap round bath"],
    aiPromptHint: "The silicone sealant around a bath needs replacing.",
  },
  "SIL-SHWR-01": {
    keywords: ["reseal shower", "shower seal", "shower silicone", "shower sealant", "shower tray seal", "mastic shower"],
    aiPromptHint: "The silicone around a shower enclosure or tray needs replacing.",
  },
  "SIL-SINK-01": {
    keywords: ["reseal sink", "sink seal", "worktop seal", "kitchen seal", "sink silicone"],
    aiPromptHint: "Silicone around a sink or kitchen worktop needs replacing.",
  },
  "SIL-WIN-01": {
    keywords: ["reseal window", "window seal", "window draught", "draught proofing window", "window silicone", "window mastic"],
    aiPromptHint: "Silicone or draught-proofing around a window needs replacing.",
  },
  "CAULK-01": {
    keywords: ["caulk", "caulking", "fill gaps", "gap fill", "coving gap", "skirting gap", "trim gap", "mastic", "seal gaps"],
    aiPromptHint: "General caulking or gap-filling around trims, coving, or joints.",
  },

  // ── General fixing ────────────────────────────────────────────────────────
  "HANG-PIC-01": {
    keywords: ["hang picture", "hang pictures", "picture hanging", "hang frame", "frames", "hang art", "hang artwork", "picture rail", "put up pictures", "hang canvas"],
    aiPromptHint: "Customer wants pictures, frames, or artwork hung on walls.",
  },
  "HANG-MIR-01": {
    keywords: ["hang mirror", "mirror hanging", "wall mirror", "fit mirror", "mount mirror", "heavy mirror"],
    aiPromptHint: "A mirror needs hanging on a wall.",
  },
  "HANG-CLK-01": {
    keywords: ["hang clock", "clock", "hang sign", "hooks", "coat hooks", "key hooks", "hang hooks", "put up hooks"],
    aiPromptHint: "Clocks, signs, or hooks need mounting on a wall.",
  },
  "FILL-HOLE-01": {
    keywords: ["fill hole", "fill holes", "fill crack", "wall repair", "plaster hole", "patch wall", "fix hole", "small holes", "filler", "polyfilla", "nail holes"],
    aiPromptHint: "Small holes or cracks in walls need filling and making good.",
  },
  "KEYSAFE-01": {
    keywords: ["key safe", "key box", "combination lock box", "keysafe", "key lock box", "fit key safe", "install key safe"],
    aiPromptHint: "Customer wants a key safe or combination lock box fitted externally.",
  },
  "FLYSCRN-01": {
    keywords: ["fly screen", "insect screen", "window screen", "bug screen", "mosquito net", "fit fly screen"],
    aiPromptHint: "Fly or insect screens need fitting to windows or doors.",
  },
  "DRSTOP-01": {
    keywords: ["door stop", "doorstop", "door stopper", "fit door stop", "door holder"],
    aiPromptHint: "Door stops need fitting to protect walls from door handles.",
  },
  "TOWRAIL-01": {
    keywords: ["towel rail", "towel ring", "towel holder", "robe hook", "bathroom hook", "fit towel rail", "towel bar"],
    negativeKeywords: ["heated", "electric"],
    aiPromptHint: "Unheated towel rail, ring, or bathroom accessory needs fitting.",
  },
  "BATHACC-01": {
    keywords: ["bathroom accessories", "toilet roll holder", "soap dish", "soap dispenser", "bathroom fittings", "fit accessories", "grab rail", "assist rail"],
    aiPromptHint: "Bathroom accessories (soap dish, TP holder, grab rail, etc.) need fitting.",
  },
  "BABYGATE-01": {
    keywords: ["baby gate", "stair gate", "safety gate", "child gate", "fit stair gate", "child safety"],
    aiPromptHint: "A stair gate or baby gate needs fitting.",
  },
  "CATFLAP-01": {
    keywords: ["cat flap", "dog flap", "pet flap", "fit cat flap", "remove cat flap", "install cat flap"],
    aiPromptHint: "Cat or dog flap needs fitting into or removing from a door.",
  },
  "MISC-SMALL-01": {
    keywords: ["small jobs", "handful of jobs", "few things", "odd jobs", "odd job", "various jobs", "multiple small", "small tasks", "general handyman"],
    aiPromptHint: "Customer has a handful of small unrelated jobs — no single dominant task.",
  },
  "EXTFIX-01": {
    keywords: ["external fixture", "outdoor fitting", "outside fitting", "house number", "exterior fitting", "external sign"],
    aiPromptHint: "Fixtures need fitting to an external wall (house numbers, signs, outdoor items).",
  },

  // ── Shelving ──────────────────────────────────────────────────────────────
  "SHELF-FLOAT-01": {
    keywords: ["floating shelf", "shelf", "shelves", "floating shelves", "hang shelf", "put up shelf", "wall shelf", "fit shelf"],
    negativeKeywords: ["bracket shelf", "shelving unit"],
    aiPromptHint: "Customer wants floating shelves hung on walls.",
  },
  "SHELF-BRKT-01": {
    keywords: ["bracket shelf", "shelf brackets", "put up shelves", "shelving brackets", "adjustable shelves"],
    aiPromptHint: "Shelves with visible brackets need putting up.",
  },
  "SHELF-UNIT-01": {
    keywords: ["shelving unit", "fix unit to wall", "bookcase", "wall unit", "secure bookcase", "anchor bookcase", "anti-tip"],
    aiPromptHint: "A freestanding shelving unit or bookcase needs securing to the wall.",
  },

  // ── TV mounting ───────────────────────────────────────────────────────────
  "TV-PLBD-01": {
    keywords: ["tv wall mount", "mount tv", "hang tv", "tv plasterboard", "mount television", "tv bracket", "tv on wall", "wall mount tv", "flat screen mount", "tv stud wall"],
    negativeKeywords: ["brick", "concrete", "solid wall"],
    aiPromptHint: "Customer wants TV mounted on a plasterboard (stud/drywall) wall.",
  },
  "TV-BRICK-01": {
    keywords: ["tv brick wall", "tv solid wall", "mount tv brick", "tv concrete", "tv stone wall", "tv on solid wall"],
    negativeKeywords: ["plasterboard", "stud wall", "drywall"],
    aiPromptHint: "Customer wants TV mounted on a solid/brick/concrete wall.",
  },
  "TV-CABLE-01": {
    keywords: ["hide tv cables", "conceal cables", "cable trunking", "tv wires", "hide wires", "cable management", "tv cable", "chase cables", "in-wall cables"],
    aiPromptHint: "TV cables need concealing in trunking or chased into the wall.",
  },
  "SBAR-01": {
    keywords: ["soundbar", "sound bar", "mount soundbar", "fit soundbar", "speaker bar", "tv soundbar"],
    aiPromptHint: "A soundbar needs mounting (on wall or below TV).",
  },
  "DOORBELL-01": {
    keywords: ["smart doorbell", "ring doorbell", "nest doorbell", "video doorbell", "fit doorbell", "wireless doorbell", "doorbell camera", "video doorbell install"],
    aiPromptHint: "A smart/video doorbell needs installing.",
  },
  "CAM-01": {
    keywords: ["security camera", "cctv", "outdoor camera", "ring camera", "nest cam", "fit camera", "mount camera", "security cam", "surveillance camera"],
    aiPromptHint: "A security camera needs mounting externally or internally.",
  },

  // ── Electrical minor ──────────────────────────────────────────────────────
  "SCKT-SWAP-01": {
    keywords: ["socket swap", "replace socket", "new socket face", "socket replacement", "plug socket", "power socket", "socket faulty", "usb socket", "double socket"],
    negativeKeywords: ["add socket", "new socket", "extra socket"],
    aiPromptHint: "An existing socket needs swapping for a like-for-like replacement.",
  },
  "SCKT-NEW-01": {
    keywords: ["add socket", "extra socket", "new socket", "additional socket", "another socket", "more sockets", "socket extension"],
    aiPromptHint: "Customer wants an additional socket added where there isn't one.",
  },
  "SWCH-01": {
    keywords: ["light switch", "switch swap", "dimmer switch", "dimmer", "replace switch", "switch not working", "smart switch"],
    aiPromptHint: "A light switch or dimmer needs swapping.",
  },
  "LIGHT-SWAP-01": {
    keywords: ["light fitting", "ceiling light", "replace light", "light swap", "fit light", "new light", "pendant", "flush fitting", "semi-flush", "light shade"],
    aiPromptHint: "A ceiling or wall light fitting needs swapping for a new one.",
  },
  "PENDANT-01": {
    keywords: ["pendant light", "hanging light", "chandelier", "pendant fitting", "drop light", "over table light", "pendant installation"],
    aiPromptHint: "A pendant or hanging light fixture needs installing.",
  },
  "DLIGHT-01": {
    keywords: ["downlight", "spotlight", "recessed light", "led downlight", "replace spotlight", "fire-rated downlight", "kitchen spotlights"],
    aiPromptHint: "Downlights or spotlights need replacing.",
  },
  "FAN-01": {
    keywords: ["extractor fan", "bathroom fan", "kitchen fan", "fan installation", "fit fan", "ventilation fan", "exhaust fan"],
    aiPromptHint: "An extractor fan needs fitting in bathroom or kitchen.",
  },
  "FAN-CORD-01": {
    keywords: ["fan pull cord", "pull cord", "bathroom pull cord", "fan cord broken", "light pull cord"],
    aiPromptHint: "A pull cord for a fan or light needs replacing.",
  },
  "SMOKE-01": {
    keywords: ["smoke alarm", "smoke detector", "fire alarm", "carbon monoxide alarm", "co alarm", "fit smoke alarm", "replace smoke alarm", "heat alarm"],
    aiPromptHint: "Smoke, heat, or CO alarms need fitting or replacing.",
  },
  "SPUR-01": {
    keywords: ["fused spur", "spur", "spur outlet", "cooker switch", "fcu", "fused connection unit", "fit spur"],
    aiPromptHint: "A fused spur or FCU needs fitting or repairing.",
  },
  "FLOOD-01": {
    keywords: ["outdoor floodlight", "security light", "pir light", "flood light", "motion sensor light", "external light", "outside light"],
    aiPromptHint: "An outdoor floodlight or security light needs fitting.",
  },
  "ELEC-DIAG-01": {
    keywords: ["electrical fault", "electrics not working", "tripping fuse", "fuse keeps tripping", "rcd trip", "no power", "electrical problem", "circuit fault", "fuse box", "consumer unit"],
    aiPromptHint: "Customer has an electrical fault to diagnose — circuit tripping, loss of power, etc.",
  },

  // ── Curtains & blinds ─────────────────────────────────────────────────────
  "BLIND-01": {
    keywords: ["blind", "blinds", "roller blind", "venetian blind", "roman blind", "fit blind", "install blind", "hang blind", "window blind"],
    negativeKeywords: ["bay window", "curtain pole", "curtain rail"],
    aiPromptHint: "One or more blinds need fitting to standard windows.",
  },
  "BLIND-BAY-01": {
    keywords: ["bay window blind", "bay blind", "blinds bay", "fit blinds bay"],
    aiPromptHint: "Blinds need fitting across a bay window (requires angled brackets).",
  },
  "CURT-RAIL-01": {
    keywords: ["curtain pole", "curtain rail", "fit curtain", "hang curtain", "pole fitting", "curtain track", "eyelet curtain", "ring top curtain"],
    negativeKeywords: ["bendable", "curved", "bay"],
    aiPromptHint: "A straight curtain pole or rod needs fitting.",
  },
  "CURT-TRACK-01": {
    keywords: ["curtain track", "bendable track", "flexible track", "curved track", "bay window curtain", "corded track", "ceiling track"],
    aiPromptHint: "A flexible or bendable curtain track (usually for bay windows) needs fitting.",
  },
  "CURT-REFIX-01": {
    keywords: ["curtain fell", "curtain pole came down", "refix curtain", "bracket fell", "pole fallen", "curtain repair", "re-fix curtain rail"],
    aiPromptHint: "An existing curtain pole or rail has come away from the wall and needs re-fixing.",
  },

  // ── Painting ──────────────────────────────────────────────────────────────
  "PAINT-ROOM-01": {
    keywords: ["paint room", "repaint room", "decorate room", "bedroom paint", "living room paint", "paint walls", "paint and decorate", "redecorate", "room decoration"],
    negativeKeywords: ["ceiling only", "one wall", "woodwork only"],
    aiPromptHint: "A whole room needs repainting — walls and possibly ceiling.",
  },
  "PAINT-WALL-01": {
    keywords: ["paint wall", "feature wall", "accent wall", "single wall", "one wall", "paint one wall"],
    aiPromptHint: "A single wall or feature wall needs painting.",
  },
  "PAINT-CEIL-01": {
    keywords: ["paint ceiling", "ceiling paint", "ceiling damp patch", "ceiling decoration", "repaint ceiling"],
    aiPromptHint: "A ceiling needs painting or repainting.",
  },
  "PAINT-WOOD-01": {
    keywords: ["paint woodwork", "skirting board paint", "paint skirting", "paint doors", "gloss", "paint architrave", "wood paint", "satinwood"],
    aiPromptHint: "Woodwork (skirting, architrave, doors) needs painting.",
  },
  "PAINT-DOOR-01": {
    keywords: ["paint door", "paint internal door", "door repaint", "paint bedroom door", "interior door paint"],
    negativeKeywords: ["front door", "external door"],
    aiPromptHint: "An internal door needs painting.",
  },
  "PAINT-FRDOOR-01": {
    keywords: ["paint front door", "front door paint", "external door paint", "kerb appeal", "door colour"],
    aiPromptHint: "A front or external door needs painting.",
  },
  "FILL-HOLE-01": {
    keywords: ["fill hole", "fill crack", "filler", "polyfilla", "patch wall", "nail holes", "screw holes"],
    aiPromptHint: "Small holes or cracks in walls need filling — often before painting.",
  },
  "STAINBLK-01": {
    keywords: ["stain block", "stain blocker", "nicotine stain", "water stain", "stain ceiling", "damp stain", "bleed through paint"],
    aiPromptHint: "Stains (nicotine, water, damp) need sealing before repainting.",
  },
  "MOULD-PAINT-01": {
    keywords: ["mould", "mold", "bathroom mould", "mould ceiling", "black mould", "damp mould", "treat mould", "anti-mould paint"],
    aiPromptHint: "Mould on ceiling or walls needs treating and repainting.",
  },
  "PAINT-TOUCH-01": {
    keywords: ["touch up", "patch paint", "small area paint", "minor paint repair", "scuff", "mark on wall", "paint damage"],
    aiPromptHint: "Small areas of paint damage or scuffing need touching up.",
  },
  "PAINT-EXT-01": {
    keywords: ["exterior paint", "external paint", "render paint", "masonry paint", "outside wall paint", "facade paint", "weatherproof paint"],
    aiPromptHint: "External render, masonry, or facade needs painting.",
  },
  "WALLPAPER-STRIP-01": {
    keywords: ["strip wallpaper", "remove wallpaper", "wallpaper removal", "take off wallpaper", "peel wallpaper"],
    aiPromptHint: "Existing wallpaper needs stripping before redecorating.",
  },
  "WALLPAPER-HANG-01": {
    keywords: ["hang wallpaper", "wallpaper", "put up wallpaper", "wallpaper feature wall", "paste wallpaper", "install wallpaper"],
    aiPromptHint: "Wallpaper needs hanging on a wall or alcove.",
  },
  "PAINT-FENCE-01": {
    keywords: ["paint fence", "fence paint", "shed paint", "stain fence", "treat fence", "wood stain fence"],
    aiPromptHint: "A fence or shed needs painting or staining.",
  },
  "PAINT-METAL-01": {
    keywords: ["paint metal", "paint pipes", "paint radiator", "metal paint", "railings paint", "primer metal"],
    aiPromptHint: "Metal items (pipes, radiators, railings) need painting.",
  },

  // ── Carpentry ─────────────────────────────────────────────────────────────
  "SKIRT-01": {
    keywords: ["skirting board", "skirting", "fit skirting", "skirting repair", "skirting replace", "mdf skirting"],
    aiPromptHint: "Skirting boards need fitting, replacing, or repairing.",
  },
  "PANEL-01": {
    keywords: ["wall panelling", "panel", "tongue and groove", "shiplap", "wall panel", "accent panel", "mdf panelling"],
    aiPromptHint: "Wall panelling (tongue-and-groove, shiplap, or MDF) needs installing.",
  },
  "PLINTH-01": {
    keywords: ["kitchen plinth", "plinth", "kickboard", "toe kick", "fit plinth"],
    aiPromptHint: "Kitchen plinths or kickboards need fitting under units.",
  },
  "BTHPNL-01": {
    keywords: ["bath panel", "side panel", "bath fascia", "fit bath panel", "replace bath panel"],
    aiPromptHint: "A bath side or front panel needs fitting or replacing.",
  },
  "SASH-01": {
    keywords: ["sash window", "sash repair", "sash cord", "window cord", "window weight", "sash balance"],
    aiPromptHint: "A sash window needs repairing — cord replacement or balance adjustment.",
  },
  "BOXIN-01": {
    keywords: ["box in pipes", "pipe boxing", "hide pipes", "conceal pipes", "boxing pipes", "boiler boxing", "pipework boxing"],
    aiPromptHint: "Exposed pipes or a boiler need boxing in with timber/MDF.",
  },
  "BEAM-01": {
    keywords: ["timber beam", "wooden beam", "mantel", "mantelpiece", "fireplace beam", "false beam"],
    aiPromptHint: "A decorative timber beam or mantelpiece needs fitting.",
  },
  "HANDRAIL-01": {
    keywords: ["handrail", "stair handrail", "balustrade", "bannister", "fit handrail", "grip rail"],
    aiPromptHint: "A handrail or balustrade needs fitting on stairs or a ramp.",
  },
  "CARP-MISC-01": {
    keywords: ["carpentry repair", "woodwork repair", "timber fix", "wood fix", "general carpentry", "joinery repair"],
    aiPromptHint: "General carpentry or woodwork repair that doesn't fit other specific SKUs.",
  },
  "DECK-01": {
    keywords: ["decking", "deck", "garden decking", "lay decking", "deck boards", "decking repair", "deck install"],
    aiPromptHint: "Garden decking needs installing or repairing.",
  },
  "VANITY-TOP-01": {
    keywords: ["vanity top", "worktop bathroom", "basin worktop", "vanity unit top", "fit vanity"],
    aiPromptHint: "A vanity top or bathroom worktop needs fitting.",
  },
  "WINBOARD-01": {
    keywords: ["window board", "window sill", "windowsill", "window cill", "fit window board"],
    aiPromptHint: "A window board or interior window sill needs fitting.",
  },
  "CEILTILE-01": {
    keywords: ["ceiling tile", "artex ceiling", "coving", "cornice", "ceiling rose", "replace ceiling tile", "fit coving"],
    aiPromptHint: "Ceiling tiles, coving, or cornice needs replacing or fitting.",
  },
  "GATE-WOOD-01": {
    keywords: ["wooden gate", "garden gate", "gate repair", "gate hinge", "gate post", "fix gate"],
    aiPromptHint: "A wooden garden gate needs repairing or a hinge replacing.",
  },

  // ── Door fitting ──────────────────────────────────────────────────────────
  "DOOR-INT-01": {
    keywords: ["hang door", "internal door", "door hanging", "new door", "fit door", "door installation", "door lining"],
    negativeKeywords: ["external", "front door", "garage"],
    aiPromptHint: "An internal door needs hanging in an existing or new frame.",
  },
  "DOOR-EXT-01": {
    keywords: ["external door", "back door", "side door", "composite door", "uPVC door", "fit external door", "front door hanging"],
    aiPromptHint: "An external door needs fitting — composite, uPVC, or timber.",
  },
  "DOOR-FRAME-01": {
    keywords: ["door frame", "frame repair", "door lining repair", "broken door frame", "door jamb"],
    aiPromptHint: "A door frame or lining needs repairing — often after a break-in or impact.",
  },
  "DOOR-ADJ-01": {
    keywords: ["sticking door", "door sticking", "door won't close", "door not closing", "ease door", "door swollen", "shave door", "plane door"],
    aiPromptHint: "A door sticks or won't close properly — needs planing or adjusting.",
  },
  "DOOR-HW-01": {
    keywords: ["door handle", "door knob", "door lever", "handle replacement", "latch", "door latch", "fit handle"],
    aiPromptHint: "A door handle, knob, or latch needs replacing.",
  },
  "DOOR-HINGE-01": {
    keywords: ["door hinge", "cupboard hinge", "cabinet hinge", "hinge repair", "hinge replacement", "broken hinge", "fit hinge"],
    aiPromptHint: "A door or cupboard hinge needs replacing or adjusting.",
  },
  "LETTERBOX-01": {
    keywords: ["letterbox", "letter box", "letter plate", "fit letterbox", "replace letterbox", "door letterbox"],
    aiPromptHint: "A letterbox or letter plate needs fitting or replacing in a door.",
  },
  "FIREDOOR-SEAL-01": {
    keywords: ["fire door seal", "intumescent strip", "fire seal", "smoke seal", "fire door strip", "flat fire door"],
    aiPromptHint: "A fire door needs intumescent or smoke seals fitting.",
  },
  "GARAGE-DOOR-01": {
    keywords: ["garage door", "up and over door", "roller garage", "garage door repair", "garage door spring"],
    aiPromptHint: "A garage door needs repairing or adjusting.",
  },

  // ── Flat pack ─────────────────────────────────────────────────────────────
  "FP-WARDROBE-01": {
    keywords: ["wardrobe assembly", "ikea wardrobe", "pax wardrobe", "build wardrobe", "assemble wardrobe", "wardrobe build"],
    aiPromptHint: "Flat-pack wardrobe (IKEA PAX or similar) needs assembling.",
  },
  "FP-BED-01": {
    keywords: ["bed assembly", "build bed", "assemble bed", "ikea bed", "malm bed", "flat pack bed", "bed frame build"],
    aiPromptHint: "A flat-pack bed frame needs assembling.",
  },
  "FP-DESK-01": {
    keywords: ["desk assembly", "table assembly", "assemble desk", "build desk", "flat pack desk", "ikea desk", "office desk build"],
    aiPromptHint: "A flat-pack desk or table needs assembling.",
  },
  "FP-DRAWERS-01": {
    keywords: ["drawers assembly", "chest of drawers", "cabinet assembly", "storage build", "bedside table build", "flat pack drawers", "ikea drawers"],
    aiPromptHint: "Flat-pack drawers or a storage cabinet needs assembling.",
  },
  "FP-SOFA-01": {
    keywords: ["sofa assembly", "corner sofa build", "sectional sofa", "sofa build", "large furniture build"],
    aiPromptHint: "A large sofa or sectional furniture item needs assembling.",
  },
  "FP-MISC-01": {
    keywords: ["flat pack", "flatpack", "flat-pack", "assemble furniture", "furniture assembly", "build furniture", "put together furniture"],
    aiPromptHint: "General flat-pack furniture assembly not covered by specific wardrobe/bed/desk SKUs.",
  },

  // ── Furniture repair ──────────────────────────────────────────────────────
  "FURN-FIX-01": {
    keywords: ["furniture repair", "fix furniture", "wobbly chair", "broken drawer", "loose leg", "furniture fix"],
    aiPromptHint: "Existing furniture needs repair — loose joints, broken drawer, wobbly leg.",
  },
  "FURN-MOVE-01": {
    keywords: ["move furniture", "dismantle furniture", "take apart furniture", "move wardrobe", "heavy furniture", "disassemble furniture"],
    aiPromptHint: "Furniture needs dismantling and moving (not reassembly).",
  },

  // ── Tiling ────────────────────────────────────────────────────────────────
  "TILE-01": {
    keywords: ["tiling", "tiles", "fit tiles", "tile bathroom", "tile kitchen", "lay tiles", "wall tiles", "floor tiles", "tiler", "ceramic tiles", "porcelain tiles"],
    negativeKeywords: ["regrout", "splashback"],
    aiPromptHint: "New tiles need laying on walls or floors.",
  },
  "REGROUT-01": {
    keywords: ["regrout", "re-grout", "grout", "grouting", "replace grout", "clean grout", "black grout", "mouldy grout"],
    aiPromptHint: "Old grout needs replacing — tiles are sound but grout is discoloured or falling out.",
  },
  "SPLASH-01": {
    keywords: ["splashback", "kitchen splashback", "glass splashback", "tile splashback", "fit splashback"],
    aiPromptHint: "A splashback needs fitting behind a sink or hob.",
  },
  "TILE-REMOVE-01": {
    keywords: ["remove tiles", "tile removal", "strip tiles", "take off tiles", "hack off tiles"],
    aiPromptHint: "Old tiles need removing before retiling or replastering.",
  },

  // ── Kitchen fitting ───────────────────────────────────────────────────────
  "KIT-UNIT-01": {
    keywords: ["kitchen unit", "fit kitchen", "kitchen cabinet", "kitchen installation", "base unit", "wall unit", "kitchen fitting"],
    aiPromptHint: "Kitchen units or cabinets need fitting or replacing.",
  },
  "KIT-WORKTOP-01": {
    keywords: ["worktop", "fit worktop", "kitchen worktop", "countertop", "laminate worktop", "solid worktop", "worktop replacement"],
    aiPromptHint: "A kitchen worktop needs fitting or replacing.",
  },
  "KIT-DOOR-01": {
    keywords: ["cupboard door", "kitchen door", "cabinet door", "door hinge kitchen", "door not closing kitchen", "kitchen door repair"],
    aiPromptHint: "Kitchen cupboard doors need adjusting, fixing, or replacing.",
  },
  "KIT-DRILL-01": {
    keywords: ["drill kitchen unit", "cut out appliance", "integrated appliance", "appliance cutout", "drill unit"],
    aiPromptHint: "A kitchen unit needs drilling or cut out for an integrated appliance.",
  },

  // ── Bathroom fitting ──────────────────────────────────────────────────────
  "BATH-SUITE-01": {
    keywords: ["bathroom suite", "full bathroom", "bathroom installation", "new bathroom", "bathroom fit", "suite installation", "bathroom renovation"],
    aiPromptHint: "A full bathroom suite (toilet, basin, bath/shower) needs installing.",
  },
  "BATH-BASIN-01": {
    keywords: ["basin", "sink basin", "vanity unit", "bathroom sink", "fit basin", "basin installation", "pedestal basin", "wall hung basin"],
    aiPromptHint: "A bathroom basin or vanity unit needs fitting.",
  },
  "BATH-SHWRPNL-01": {
    keywords: ["shower wall panel", "shower panelling", "wet wall", "shower board", "fit shower panels", "wetroom panelling"],
    aiPromptHint: "Shower wall panels or wet wall boards need fitting.",
  },
  "SHWR-SCRN-01": {
    keywords: ["shower screen", "shower door", "shower enclosure", "bath screen", "fit shower screen", "shower cubicle", "shower tray"],
    aiPromptHint: "A shower screen, enclosure, or cubicle needs fitting.",
  },

  // ── Flooring ──────────────────────────────────────────────────────────────
  "FLOOR-LAM-01": {
    keywords: ["laminate", "lvt", "vinyl flooring", "laminate flooring", "lay laminate", "click flooring", "engineered vinyl", "luxury vinyl tile"],
    aiPromptHint: "Laminate, LVT, or vinyl click flooring needs laying.",
  },
  "FLOOR-WOOD-01": {
    keywords: ["wood floor", "wooden floor", "engineered wood", "solid wood", "hardwood floor", "lay wood floor", "parquet"],
    aiPromptHint: "Engineered or solid wood flooring needs laying.",
  },
  "FLOOR-CARPET-01": {
    keywords: ["carpet", "carpet fitting", "lay carpet", "carpet installation", "carpet replacement"],
    aiPromptHint: "Carpet needs fitting.",
  },
  "FLOOR-LIFT-01": {
    keywords: ["lift flooring", "remove flooring", "take up flooring", "rip up carpet", "remove laminate", "lift tiles", "floor removal"],
    aiPromptHint: "Existing flooring needs lifting and removing.",
  },

  // ── Plastering ────────────────────────────────────────────────────────────
  "PLAST-01": {
    keywords: ["plaster", "plastering", "plaster patch", "skim", "patch plaster", "crack plaster", "plaster repair", "render"],
    negativeKeywords: ["plasterboard"],
    aiPromptHint: "A plaster patch or skim coat needs applying to repair damaged walls.",
  },
  "PLASTERBOARD-01": {
    keywords: ["plasterboard", "dry lining", "stud wall", "board wall", "plasterboard ceiling", "fix plasterboard"],
    aiPromptHint: "Plasterboard needs fitting to a wall or ceiling (not just patching).",
  },
  "PLAST-SAND-01": {
    keywords: ["sand walls", "make good", "prepare walls", "key walls", "sugar soap", "smooth walls", "sand and fill"],
    aiPromptHint: "Walls need sanding down and making good before painting.",
  },

  // ── Garden ────────────────────────────────────────────────────────────────
  "GARDEN-TIDY-01": {
    keywords: ["garden tidy", "garden clearance", "weed garden", "tidy garden", "overgrown garden", "garden clear up"],
    aiPromptHint: "Garden needs tidying — weeding, clearing, general tidy-up.",
  },
  "LAWN-MOW-01": {
    keywords: ["mow lawn", "mow grass", "cut grass", "lawn mowing", "lawn cut", "grass cut", "lawn edge"],
    aiPromptHint: "Lawn needs mowing and edging.",
  },
  "HEDGE-01": {
    keywords: ["trim hedge", "hedge cutting", "hedge trim", "privet hedge", "cut back hedge", "shape hedge"],
    aiPromptHint: "A hedge needs trimming or cutting back.",
  },
  "TURF-01": {
    keywords: ["lay turf", "new lawn", "turf laying", "topsoil", "re-turf", "lawn repair turf", "turf installation"],
    aiPromptHint: "New turf and topsoil need laying for a new or repaired lawn.",
  },
  "WEED-TREAT-01": {
    keywords: ["weed treatment", "weed killer", "kill weeds", "weed control", "herbicide", "spray weeds"],
    aiPromptHint: "Weeds need chemical treatment — path, patio, or border.",
  },
  "WEED-MEMBRANE-01": {
    keywords: ["weed membrane", "weed barrier", "landscape fabric", "lay membrane", "weed control fabric"],
    aiPromptHint: "Weed-control membrane needs laying under bark chip or gravel.",
  },
  "WASHLINE-01": {
    keywords: ["washing line", "rotary line", "clothesline", "fit washing line", "rotary dryer", "install washing line"],
    aiPromptHint: "A rotary washing line or clothesline needs fitting in the garden.",
  },
  "SHED-INSTALL-01": {
    keywords: ["shed assembly", "build shed", "assemble shed", "shed install", "garden shed", "shed erection"],
    aiPromptHint: "A flat-pack or panel garden shed needs assembling.",
  },
  "SHED-BASE-01": {
    keywords: ["shed base", "concrete base", "slab base", "garden base", "lay shed base", "paving base"],
    aiPromptHint: "A concrete or paving slab base needs laying for a shed or garden structure.",
  },

  // ── Fencing ───────────────────────────────────────────────────────────────
  "FENCE-PANEL-01": {
    keywords: ["fence panel", "fence", "fencing", "fence repair", "new fence", "replace fence", "fence installation"],
    negativeKeywords: ["fence post"],
    aiPromptHint: "A fence panel needs installing or replacing.",
  },
  "FENCE-POST-01": {
    keywords: ["fence post", "replace post", "new post", "post repair", "rotten post", "fence post concrete"],
    aiPromptHint: "A fence post needs replacing — often after storm damage or rot.",
  },
  "TRELLIS-01": {
    keywords: ["trellis", "screening", "garden screen", "privacy screen", "fit trellis", "install trellis", "bamboo screen"],
    aiPromptHint: "Trellis or garden screening needs fitting.",
  },

  // ── Guttering ─────────────────────────────────────────────────────────────
  "GUTTER-CLEAR-01": {
    keywords: ["gutter clearing", "clean gutters", "blocked gutters", "clear gutters", "leaf guard", "gutters overflowing", "gutter cleaning"],
    aiPromptHint: "Gutters need clearing of debris — overflowing or blocked.",
  },
  "GUTTER-REPAIR-01": {
    keywords: ["gutter repair", "downpipe", "gutter leak", "gutter replacement", "fix gutter", "sagging gutter", "gutter bracket"],
    aiPromptHint: "Gutters or downpipes need repairing — leaking joints, sagging, or broken sections.",
  },

  // ── Pressure washing ──────────────────────────────────────────────────────
  "JETWASH-01": {
    keywords: ["jet wash", "jetwash", "pressure wash", "patio clean", "driveway clean", "high pressure wash", "power wash", "path clean"],
    negativeKeywords: ["roof", "decking"],
    aiPromptHint: "Patio, driveway, or path needs jet-washing.",
  },
  "JETWASH-ROOF-01": {
    keywords: ["jet wash roof", "roof cleaning", "moss roof", "algae roof", "clean roof tiles"],
    aiPromptHint: "Roof tiles need jet-washing to remove moss or algae.",
  },
  "JETWASH-DECK-01": {
    keywords: ["jet wash decking", "clean decking", "pressure wash deck", "decking clean", "algae decking"],
    aiPromptHint: "Decking needs jet-washing to remove algae or dirt.",
  },

  // ── Waste removal ─────────────────────────────────────────────────────────
  "WASTE-01": {
    keywords: ["rubbish removal", "junk removal", "clear rubbish", "waste removal", "skip alternative", "clutter clear", "garden waste"],
    aiPromptHint: "Rubbish, junk, or garden waste needs collecting and disposing of.",
  },
  "WASTE-APPLI-01": {
    keywords: ["remove appliance", "dispose fridge", "old washing machine", "appliance removal", "take away fridge", "old appliance"],
    aiPromptHint: "An old appliance (fridge, washing machine, etc.) needs removing.",
  },
  "WASTE-FURN-01": {
    keywords: ["remove furniture", "old sofa", "old bed", "furniture disposal", "take away furniture", "old wardrobe"],
    aiPromptHint: "Old furniture needs removing and disposing of.",
  },
  "SHED-REMOVE-01": {
    keywords: ["remove shed", "dismantle shed", "take down shed", "old shed removal", "shed demolition"],
    aiPromptHint: "An old shed needs dismantling and removing.",
  },

  // ── Lock change ───────────────────────────────────────────────────────────
  "LOCK-01": {
    keywords: ["change lock", "new lock", "replace lock", "lock replacement", "fit lock", "deadbolt", "cylinder lock", "euro cylinder", "yale lock", "nightlatch"],
    negativeKeywords: ["multiple locks", "cabinet lock"],
    aiPromptHint: "A single door lock needs replacing — after a break-in, key loss, or for security upgrade.",
  },
  "LOCK-MULTI-01": {
    keywords: ["multiple locks", "several locks", "all locks", "house locks", "all doors locks", "rekey", "change all locks"],
    aiPromptHint: "Multiple locks across multiple doors need changing.",
  },
  "LOCK-CABINET-01": {
    keywords: ["cabinet lock", "desk lock", "coded lock", "combination lock", "filing cabinet lock", "cupboard lock"],
    aiPromptHint: "A cabinet, desk, or coded lock needs fitting.",
  },
  "LOCK-DIAG-01": {
    keywords: ["lock stuck", "lock jammed", "door won't lock", "lock broken", "key stuck", "lock fault", "lock not working"],
    aiPromptHint: "A faulty lock needs diagnosing and repairing.",
  },

  // ── Other ─────────────────────────────────────────────────────────────────
  "PAVE-01": {
    keywords: ["paving", "path", "slabs", "lay slabs", "garden path", "patio slabs", "block paving", "brickwork path"],
    aiPromptHint: "Paving, path slabs, or block paving needs laying or repairing.",
  },
  "DEEPCLEAN-01": {
    keywords: ["deep clean", "house clean", "end of tenancy clean", "property clean", "move out clean", "thorough clean"],
    aiPromptHint: "A deep clean of a room or property is needed.",
  },
  "OVEN-CLEAN-01": {
    keywords: ["oven clean", "clean oven", "oven cleaning", "extractor hood clean", "cooker clean"],
    aiPromptHint: "An oven and/or extractor hood needs a professional deep clean.",
  },
  "AC-CLEAN-01": {
    keywords: ["air conditioning", "ac clean", "aircon service", "air con filter", "split unit clean", "hvac clean"],
    aiPromptHint: "An air-conditioning unit needs cleaning and filter checking.",
  },
  "VISIT-01": {
    keywords: ["site visit", "assessment", "survey", "come and look", "estimate", "come round", "have a look"],
    aiPromptHint: "Customer wants someone to come and assess the job before committing — site visit.",
  },
  "POINTING-01": {
    keywords: ["repointing", "pointing", "brickwork", "mortar", "repoint bricks", "mortar repair", "brick repoint"],
    aiPromptHint: "Brickwork mortar joints need repointing.",
  },
  "ROOF-MINOR-01": {
    keywords: ["roof repair", "minor roof", "ridge tile", "slipped tile", "roof tile", "felt repair", "flat roof patch"],
    aiPromptHint: "Minor roof repair needed — slipped tile, ridge tile, small felt patch.",
  },
};

async function main() {
  console.log(`[seed-sku-keywords] DRY_RUN=${DRY_RUN}`);
  let updated = 0;
  let skipped = 0;

  for (const [skuCode, def] of Object.entries(SKU_KEYWORDS)) {
    if (DRY_RUN) {
      console.log(`  ${skuCode}: ${def.keywords.length} keywords, ${def.negativeKeywords?.length ?? 0} negatives`);
      continue;
    }
    const result = await db
      .update(serviceCatalog)
      .set({
        keywords: def.keywords,
        negativeKeywords: def.negativeKeywords ?? [],
        aiPromptHint: def.aiPromptHint ?? null,
      })
      .where(eq(serviceCatalog.skuCode, skuCode))
      .returning({ skuCode: serviceCatalog.skuCode });

    if (result.length > 0) {
      updated++;
    } else {
      console.warn(`  WARN: no row found for ${skuCode}`);
      skipped++;
    }
  }

  console.log(`\n✓ done — updated=${updated} skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
