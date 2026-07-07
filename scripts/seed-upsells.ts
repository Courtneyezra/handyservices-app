/**
 * Seed upsell_sku_codes on service_catalog.
 * Upsells = "while we're there..." suggestions shown post-commitment, max 3.
 *
 * Run:  npx tsx scripts/seed-upsells.ts
 *       DRY_RUN=1 npx tsx scripts/seed-upsells.ts
 */

import { db } from "../server/db";
import { serviceCatalog } from "../shared/schema";
import { eq } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN === "1";

// ── Upsell map ───────────────────────────────────────────────────────────────
// Keep max 3 per SKU — only the first 3 are shown in the UI.
// Order by relevance (most natural cross-sell first).

const UPSELLS: Record<string, string[]> = {
  // ── Plumbing minor ────────────────────────────────────────────────────────
  "TAP-KIT-01":      ["WASH-PLUMB-01", "TAP-OUT-01", "DRAIN-UNBLK-01"],
  "TAP-BATH-01":     ["SIL-BATH-01", "TOI-SEAT-01", "SHWR-HOSE-01"],
  "TAP-REPAIR-01":   ["TAP-CART-01", "LEAK-FIND-01", "DRAIN-UNBLK-01"],
  "TOI-REPAIR-01":   ["TOI-SEAT-01", "DRAIN-UNBLK-01", "RAD-BLEED-01"],
  "TOI-SWAP-01":     ["TOI-SEAT-01", "SIL-BATH-01", "BATHACC-01"],
  "TOI-SEAT-01":     ["BATHACC-01", "TOI-REPAIR-01"],
  "TOI-UNBLK-01":    ["DRAIN-UNBLK-01", "TOI-SEAT-01", "LEAK-FIND-01"],
  "DRAIN-UNBLK-01":  ["TOI-UNBLK-01", "SHWR-HOSE-01", "LEAK-FIND-01"],
  "LEAK-FIND-01":    ["BALLV-01", "TAP-REPAIR-01", "PLAST-SAND-01"],
  "SHWR-FIX-01":     ["SIL-SHWR-01", "SHWR-HOSE-01", "SHWR-SCRN-01"],
  "SHWR-BAR-01":     ["SIL-SHWR-01", "SHWR-SCRN-01", "BATHACC-01"],
  "SHWR-HOSE-01":    ["SIL-SHWR-01", "BATHACC-01"],
  "RAD-SWAP-01":     ["RAD-BLEED-01", "RAD-TOWEL-01", "BALLV-01"],
  "RAD-BLEED-01":    ["RAD-SWAP-01", "RAD-TOWEL-01"],
  "WASH-PLUMB-01":   ["DRAIN-UNBLK-01", "SPUR-01"],

  // ── Silicone sealant ──────────────────────────────────────────────────────
  "SIL-BATH-01":     ["SIL-SHWR-01", "CAULK-01", "REGROUT-01"],
  "SIL-SHWR-01":     ["SIL-BATH-01", "REGROUT-01", "CAULK-01"],
  "SIL-SINK-01":     ["CAULK-01", "SIL-WIN-01"],
  "SIL-WIN-01":      ["CAULK-01", "SIL-SINK-01"],
  "CAULK-01":        ["FILL-HOLE-01", "SIL-BATH-01"],

  // ── General fixing ────────────────────────────────────────────────────────
  "HANG-PIC-01":     ["HANG-MIR-01", "SHELF-FLOAT-01", "FILL-HOLE-01"],
  "HANG-MIR-01":     ["HANG-PIC-01", "SHELF-FLOAT-01"],
  "HANG-CLK-01":     ["HANG-PIC-01", "HANG-MIR-01"],
  "FILL-HOLE-01":    ["PAINT-TOUCH-01", "PLAST-SAND-01"],
  "KEYSAFE-01":      ["LOCK-01", "LOCK-DIAG-01"],
  "DRSTOP-01":       ["DOOR-HW-01", "BATHACC-01"],
  "TOWRAIL-01":      ["BATHACC-01", "TOWRAIL-01"],
  "MISC-SMALL-01":   ["FILL-HOLE-01", "HANG-PIC-01"],

  // ── Shelving ──────────────────────────────────────────────────────────────
  "SHELF-FLOAT-01":  ["SHELF-BRKT-01", "HANG-PIC-01", "HANG-MIR-01"],
  "SHELF-BRKT-01":   ["SHELF-FLOAT-01", "SHELF-UNIT-01"],
  "SHELF-UNIT-01":   ["SHELF-FLOAT-01", "HANG-PIC-01"],

  // ── TV mounting ───────────────────────────────────────────────────────────
  "TV-PLBD-01":      ["TV-CABLE-01", "SBAR-01", "DOORBELL-01"],
  "TV-BRICK-01":     ["TV-CABLE-01", "SBAR-01", "CAM-01"],
  "TV-CABLE-01":     ["SBAR-01", "SCKT-NEW-01"],
  "SBAR-01":         ["TV-CABLE-01", "SCKT-NEW-01"],
  "DOORBELL-01":     ["CAM-01", "KEYSAFE-01", "SCKT-SWAP-01"],
  "CAM-01":          ["DOORBELL-01", "FLOOD-01", "SCKT-NEW-01"],

  // ── Electrical minor ──────────────────────────────────────────────────────
  "SCKT-SWAP-01":    ["SCKT-NEW-01", "SWCH-01"],
  "SCKT-NEW-01":     ["SPUR-01", "SCKT-SWAP-01"],
  "SWCH-01":         ["LIGHT-SWAP-01", "SCKT-SWAP-01"],
  "LIGHT-SWAP-01":   ["DLIGHT-01", "PENDANT-01", "SWCH-01"],
  "PENDANT-01":      ["LIGHT-SWAP-01", "SWCH-01"],
  "DLIGHT-01":       ["LIGHT-SWAP-01", "SWCH-01", "FAN-01"],
  "FAN-01":          ["SMOKE-01", "SWCH-01"],
  "SMOKE-01":        ["FAN-01", "ELEC-DIAG-01"],
  "FLOOD-01":        ["CAM-01", "SCKT-NEW-01"],

  // ── Curtains & blinds ─────────────────────────────────────────────────────
  "BLIND-01":        ["CURT-RAIL-01", "TOWRAIL-01"],
  "BLIND-BAY-01":    ["CURT-TRACK-01", "BLIND-01"],
  "CURT-RAIL-01":    ["BLIND-01", "CURT-REFIX-01"],
  "CURT-TRACK-01":   ["CURT-RAIL-01", "BLIND-BAY-01"],
  "CURT-REFIX-01":   ["CURT-RAIL-01", "BLIND-01"],

  // ── Painting ──────────────────────────────────────────────────────────────
  "PAINT-ROOM-01":   ["FILL-HOLE-01", "PAINT-WOOD-01", "PAINT-CEIL-01"],
  "PAINT-WALL-01":   ["FILL-HOLE-01", "PAINT-TOUCH-01"],
  "PAINT-CEIL-01":   ["PAINT-WALL-01", "MOULD-PAINT-01"],
  "PAINT-WOOD-01":   ["SKIRT-01", "PAINT-DOOR-01"],
  "PAINT-DOOR-01":   ["PAINT-WOOD-01", "DOOR-HW-01"],
  "PAINT-FRDOOR-01": ["LOCK-01", "LETTERBOX-01"],
  "WALLPAPER-STRIP-01": ["WALLPAPER-HANG-01", "FILL-HOLE-01"],
  "WALLPAPER-HANG-01":  ["WALLPAPER-STRIP-01", "FILL-HOLE-01", "PAINT-TOUCH-01"],
  "MOULD-PAINT-01":  ["PAINT-CEIL-01", "SIL-BATH-01"],
  "PAINT-TOUCH-01":  ["FILL-HOLE-01"],
  "STAINBLK-01":     ["PAINT-CEIL-01", "MOULD-PAINT-01"],

  // ── Carpentry ─────────────────────────────────────────────────────────────
  "SKIRT-01":        ["PANEL-01", "PAINT-WOOD-01"],
  "PANEL-01":        ["SKIRT-01", "PAINT-WOOD-01"],
  "BTHPNL-01":       ["SIL-BATH-01", "BATHACC-01"],
  "BOXIN-01":        ["PLAST-01", "PAINT-WALL-01"],
  "HANDRAIL-01":     ["DRSTOP-01", "FILL-HOLE-01"],

  // ── Door fitting ──────────────────────────────────────────────────────────
  "DOOR-INT-01":     ["DOOR-HW-01", "DOOR-HINGE-01"],
  "DOOR-EXT-01":     ["LOCK-01", "DOOR-FRAME-01", "LETTERBOX-01"],
  "DOOR-FRAME-01":   ["LOCK-01", "FILL-HOLE-01"],
  "DOOR-ADJ-01":     ["DOOR-HW-01", "DOOR-HINGE-01"],
  "DOOR-HW-01":      ["DOOR-HINGE-01", "LOCK-01"],
  "DOOR-HINGE-01":   ["DOOR-HW-01", "DOOR-ADJ-01"],
  "LETTERBOX-01":    ["LOCK-01", "DOOR-HW-01"],

  // ── Flat pack ─────────────────────────────────────────────────────────────
  "FP-WARDROBE-01":  ["FP-BED-01", "FP-DRAWERS-01", "SHELF-FLOAT-01"],
  "FP-BED-01":       ["FP-DRAWERS-01", "SHELF-FLOAT-01"],
  "FP-DESK-01":      ["SCKT-NEW-01", "SHELF-FLOAT-01"],
  "FP-DRAWERS-01":   ["FP-BED-01", "FURN-FIX-01"],
  "FP-MISC-01":      ["FP-WARDROBE-01", "FP-BED-01"],

  // ── Tiling ────────────────────────────────────────────────────────────────
  "TILE-01":         ["REGROUT-01", "SIL-BATH-01", "SIL-SHWR-01"],
  "REGROUT-01":      ["SIL-BATH-01", "SIL-SHWR-01", "TILE-01"],
  "SPLASH-01":       ["SIL-SINK-01", "TILE-01"],

  // ── Bathroom fitting ──────────────────────────────────────────────────────
  "BATH-SUITE-01":   ["SIL-BATH-01", "REGROUT-01", "BATHACC-01"],
  "BATH-BASIN-01":   ["SIL-SINK-01", "BATHACC-01"],
  "SHWR-SCRN-01":    ["SIL-SHWR-01", "BATHACC-01"],

  // ── Lock change ───────────────────────────────────────────────────────────
  "LOCK-01":         ["LOCK-MULTI-01", "KEYSAFE-01", "DOOR-HW-01"],
  "LOCK-MULTI-01":   ["LOCK-01", "KEYSAFE-01"],
  "LOCK-DIAG-01":    ["LOCK-01", "DOOR-HW-01"],

  // ── Fencing ───────────────────────────────────────────────────────────────
  "FENCE-PANEL-01":  ["FENCE-POST-01", "TRELLIS-01"],
  "FENCE-POST-01":   ["FENCE-PANEL-01"],

  // ── Guttering ─────────────────────────────────────────────────────────────
  "GUTTER-CLEAR-01": ["GUTTER-REPAIR-01", "JETWASH-01"],
  "GUTTER-REPAIR-01":["GUTTER-CLEAR-01"],

  // ── Pressure washing ──────────────────────────────────────────────────────
  "JETWASH-01":      ["JETWASH-DECK-01", "GUTTER-CLEAR-01", "WEED-TREAT-01"],
  "JETWASH-DECK-01": ["JETWASH-01", "DECK-01"],

  // ── Garden ────────────────────────────────────────────────────────────────
  "GARDEN-TIDY-01":  ["LAWN-MOW-01", "HEDGE-01", "WEED-TREAT-01"],
  "LAWN-MOW-01":     ["HEDGE-01", "GARDEN-TIDY-01"],
  "HEDGE-01":        ["LAWN-MOW-01", "GARDEN-TIDY-01"],

  // ── Flooring ──────────────────────────────────────────────────────────────
  "FLOOR-LAM-01":    ["SKIRT-01", "FLOOR-LIFT-01"],
  "FLOOR-WOOD-01":   ["SKIRT-01", "FLOOR-LIFT-01"],

  // ── Plastering ────────────────────────────────────────────────────────────
  "PLAST-01":        ["PLAST-SAND-01", "PAINT-WALL-01"],
  "PLAST-SAND-01":   ["PAINT-WALL-01", "FILL-HOLE-01"],
  "PLASTERBOARD-01": ["PLAST-01", "PLAST-SAND-01", "PAINT-WALL-01"],

  // ── Plumbing minor (missing) ──────────────────────────────────────────────
  "TAP-OUT-01":      ["KEYSAFE-01", "EXTFIX-01", "DRAIN-UNBLK-01"],
  "TAP-CART-01":     ["TAP-REPAIR-01", "LEAK-FIND-01"],
  "RAD-TOWEL-01":    ["RAD-BLEED-01", "BATHACC-01", "SIL-BATH-01"],
  "BALLV-01":        ["LEAK-FIND-01", "TAP-REPAIR-01", "BOXIN-01"],
  "WHEAT-01":        ["BALLV-01", "BOXIN-01", "RAD-BLEED-01"],

  // ── General fixing (missing) ──────────────────────────────────────────────
  "BABYGATE-01":     ["DRSTOP-01", "BATHACC-01"],
  "BATHACC-01":      ["TOWRAIL-01", "SIL-BATH-01", "REGROUT-01"],
  "CATFLAP-01":      ["DRSTOP-01", "LOCK-01"],
  "EXTFIX-01":       ["CAM-01", "FLOOD-01", "DOORBELL-01"],
  "FLYSCRN-01":      ["DRSTOP-01", "SIL-WIN-01"],

  // ── Carpentry (missing) ───────────────────────────────────────────────────
  "BEAM-01":         ["PAINT-WOOD-01", "CAULK-01", "FILL-HOLE-01"],
  "CARP-MISC-01":    ["FILL-HOLE-01", "PAINT-TOUCH-01"],
  "CEILTILE-01":     ["PAINT-CEIL-01", "CAULK-01", "FILL-HOLE-01"],
  "DECK-01":         ["JETWASH-DECK-01", "FENCE-PANEL-01", "PAINT-FENCE-01"],
  "GATE-WOOD-01":    ["FENCE-PANEL-01", "PAINT-FENCE-01"],
  "PLINTH-01":       ["KIT-DOOR-01", "SIL-SINK-01"],
  "SASH-01":         ["SIL-WIN-01", "PAINT-WOOD-01"],
  "VANITY-TOP-01":   ["SIL-SINK-01", "BATHACC-01", "BATH-BASIN-01"],
  "WINBOARD-01":     ["PAINT-WOOD-01", "SIL-WIN-01", "CAULK-01"],

  // ── Door fitting (missing) ────────────────────────────────────────────────
  "FIREDOOR-SEAL-01":["SMOKE-01", "DOOR-HINGE-01"],
  "GARAGE-DOOR-01":  ["LOCK-01", "KEYSAFE-01"],

  // ── Electrical minor (missing) ────────────────────────────────────────────
  "ELEC-DIAG-01":    ["SCKT-SWAP-01", "SMOKE-01", "FAN-01"],
  "FAN-CORD-01":     ["FAN-01", "SWCH-01"],
  "SPUR-01":         ["SCKT-NEW-01", "SCKT-SWAP-01"],

  // ── Fencing (missing) ─────────────────────────────────────────────────────
  "TRELLIS-01":      ["FENCE-PANEL-01", "PAINT-FENCE-01"],

  // ── Flat pack (missing) ───────────────────────────────────────────────────
  "FP-SOFA-01":      ["FP-BED-01", "FURN-FIX-01"],

  // ── Flooring (missing) ────────────────────────────────────────────────────
  "FLOOR-CARPET-01": ["SKIRT-01", "FLOOR-LIFT-01"],
  "FLOOR-LIFT-01":   ["FLOOR-LAM-01", "FLOOR-WOOD-01", "FLOOR-CARPET-01"],

  // ── Furniture repair (missing) ────────────────────────────────────────────
  "FURN-FIX-01":     ["FURN-MOVE-01", "FILL-HOLE-01"],
  "FURN-MOVE-01":    ["FURN-FIX-01", "WASTE-FURN-01"],

  // ── Garden maintenance (missing) ──────────────────────────────────────────
  "SHED-BASE-01":    ["SHED-INSTALL-01", "DECK-01"],
  "SHED-INSTALL-01": ["SHED-BASE-01", "PAINT-FENCE-01", "WASHLINE-01"],
  "TURF-01":         ["LAWN-MOW-01", "WEED-TREAT-01", "GARDEN-TIDY-01"],
  "WASHLINE-01":     ["SHED-INSTALL-01", "GARDEN-TIDY-01"],
  "WEED-MEMBRANE-01":["WEED-TREAT-01", "GARDEN-TIDY-01"],
  "WEED-TREAT-01":   ["WEED-MEMBRANE-01", "GARDEN-TIDY-01"],

  // ── Kitchen fitting (missing) ─────────────────────────────────────────────
  "KIT-DOOR-01":     ["KIT-UNIT-01", "PLINTH-01", "KIT-WORKTOP-01"],
  "KIT-DRILL-01":    ["KIT-UNIT-01", "SPUR-01"],
  "KIT-UNIT-01":     ["KIT-WORKTOP-01", "PLINTH-01", "KIT-DOOR-01"],
  "KIT-WORKTOP-01":  ["SIL-SINK-01", "SPLASH-01", "KIT-DOOR-01"],

  // ── Lock change (missing) ─────────────────────────────────────────────────
  "LOCK-CABINET-01": ["LOCK-01", "KEYSAFE-01"],

  // ── Painting (missing) ────────────────────────────────────────────────────
  "PAINT-EXT-01":    ["POINTING-01", "PAINT-FRDOOR-01"],
  "PAINT-FENCE-01":  ["PAINT-EXT-01", "DECK-01", "GATE-WOOD-01"],
  "PAINT-METAL-01":  ["PAINT-WOOD-01", "PAINT-TOUCH-01"],
  "PAINT-SILL-01":   ["SIL-WIN-01", "PAINT-WOOD-01"],

  // ── Pressure washing (missing) ────────────────────────────────────────────
  "JETWASH-ROOF-01": ["GUTTER-CLEAR-01", "POINTING-01"],

  // ── Tiling (missing) ──────────────────────────────────────────────────────
  "TILE-REMOVE-01":  ["PLAST-01", "TILE-01", "PLASTERBOARD-01"],

  // ── Bathroom fitting (missing) ────────────────────────────────────────────
  "BATH-SHWRPNL-01": ["SIL-SHWR-01", "REGROUT-01", "SHWR-SCRN-01"],

  // ── Waste removal (missing) ───────────────────────────────────────────────
  "SHED-REMOVE-01":  ["SHED-BASE-01", "GARDEN-TIDY-01"],
  "WASTE-01":        ["GARDEN-TIDY-01", "DEEPCLEAN-01"],
  "WASTE-APPLI-01":  ["WASH-PLUMB-01", "KIT-UNIT-01"],
  "WASTE-FURN-01":   ["DEEPCLEAN-01", "FLOOR-LIFT-01"],

  // ── Other (missing) ───────────────────────────────────────────────────────
  "AC-CLEAN-01":     ["FAN-01", "SMOKE-01"],
  "DEEPCLEAN-01":    ["OVEN-CLEAN-01", "AC-CLEAN-01"],
  "OVEN-CLEAN-01":   ["DEEPCLEAN-01", "SPLASH-01"],
  "PAVE-01":         ["JETWASH-01", "WEED-TREAT-01", "FENCE-PANEL-01"],
  "POINTING-01":     ["PAINT-EXT-01", "JETWASH-01"],
  "ROOF-MINOR-01":   ["GUTTER-CLEAR-01", "JETWASH-ROOF-01"],
  "VISIT-01":        ["MISC-SMALL-01", "FILL-HOLE-01"],
};

async function main() {
  console.log(`[seed-upsells] DRY_RUN=${DRY_RUN}`);
  let updated = 0;
  let skipped = 0;

  for (const [skuCode, upsells] of Object.entries(UPSELLS)) {
    if (DRY_RUN) {
      console.log(`  ${skuCode} → [${upsells.join(", ")}]`);
      continue;
    }
    const result = await db
      .update(serviceCatalog)
      .set({ upsellSkuCodes: upsells.slice(0, 3) })
      .where(eq(serviceCatalog.skuCode, skuCode))
      .returning({ skuCode: serviceCatalog.skuCode });

    if (result.length > 0) {
      updated++;
    } else {
      console.warn(`  WARN: no row for ${skuCode}`);
      skipped++;
    }
  }

  console.log(`\n✓ done — updated=${updated} skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
