/**
 * Phase 28 — SKU iconography.
 *
 * Each SKU gets a Lucide icon for its "shelf item" card on the customer quote
 * and the admin SKU Library. The DB stores a PascalCase Lucide name in
 * service_catalog.icon (nullable); when null we fall back to a per-category
 * default. Everything resolves through SKU_ICON_REGISTRY so an unknown/empty
 * name degrades gracefully to a wrench rather than crashing.
 *
 * Only icons present in this registry can be picked in the library — that
 * keeps the stored value guaranteed-renderable and the palette curated.
 */
import {
  Hammer, Package, Tv, Ruler, Wrench, Plug, Zap, Paintbrush, PaintBucket,
  PaintRoller, Grid3X3, BrickWall, Lock, Droplet, Droplets, Fence, Sprout,
  Bath, CookingPot, DoorOpen, Layers, Blinds, Library, Armchair, Trash2,
  Drill, Lightbulb, Thermometer, Wind, Home, Truck, Square, Star, Sparkles,
  PenTool, ShowerHead, type LucideIcon,
} from 'lucide-react';

/** PascalCase Lucide name → component. The only names a SKU may store. */
export const SKU_ICON_REGISTRY: Record<string, LucideIcon> = {
  Hammer, Package, Tv, Ruler, Wrench, Plug, Zap, Paintbrush, PaintBucket,
  PaintRoller, Grid3X3, BrickWall, Lock, Droplet, Droplets, Fence, Sprout,
  Bath, CookingPot, DoorOpen, Layers, Blinds, Library, Armchair, Trash2,
  Drill, Lightbulb, Thermometer, Wind, Home, Truck, Square, Star, Sparkles,
  PenTool, ShowerHead,
};

/** The palette shown in the library's icon picker (insertion order). */
export const SKU_ICON_NAMES: string[] = Object.keys(SKU_ICON_REGISTRY);

/** Default icon per JobCategory slug. Used when a SKU has no explicit icon. */
export const CATEGORY_DEFAULT_ICON: Record<string, string> = {
  general_fixing: 'Hammer',
  flat_pack: 'Package',
  tv_mounting: 'Tv',
  carpentry: 'Ruler',
  plumbing_minor: 'Wrench',
  electrical_minor: 'Plug',
  painting: 'Paintbrush',
  tiling: 'Grid3X3',
  plastering: 'BrickWall',
  lock_change: 'Lock',
  guttering: 'Droplets',
  pressure_washing: 'Droplet',
  fencing: 'Fence',
  garden_maintenance: 'Sprout',
  bathroom_fitting: 'Bath',
  kitchen_fitting: 'CookingPot',
  door_fitting: 'DoorOpen',
  flooring: 'Layers',
  curtain_blinds: 'Blinds',
  silicone_sealant: 'ShowerHead',
  shelving: 'Library',
  furniture_repair: 'Armchair',
  waste_removal: 'Trash2',
  other: 'Wrench',
};

const FALLBACK_ICON = 'Wrench';

/** Resolve the effective icon name: explicit SKU icon → category default → wrench. */
export function resolveSkuIconName(sku: { icon?: string | null; category?: string | null }): string {
  if (sku.icon && SKU_ICON_REGISTRY[sku.icon]) return sku.icon;
  const byCat = sku.category ? CATEGORY_DEFAULT_ICON[sku.category] : undefined;
  if (byCat && SKU_ICON_REGISTRY[byCat]) return byCat;
  return FALLBACK_ICON;
}

/** Render a SKU icon by stored name (or resolve from a SKU-like object). */
export function SkuIcon({
  name,
  sku,
  className,
}: {
  name?: string | null;
  sku?: { icon?: string | null; category?: string | null };
  className?: string;
}) {
  const resolved = name && SKU_ICON_REGISTRY[name] ? name : sku ? resolveSkuIconName(sku) : FALLBACK_ICON;
  const Icon = SKU_ICON_REGISTRY[resolved] || Wrench;
  return <Icon className={className} />;
}
