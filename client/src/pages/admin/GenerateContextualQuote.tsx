import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { trackEvent } from '@/lib/posthog';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Phone,
  Clock,
  Plus,
  Trash2,
  Wand2,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Info,
  Eye,
  Users,
  Calendar,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { format as formatDate, getDaysInMonth, getDay, startOfMonth } from 'date-fns';
import { QuotePreviewModal } from '@/components/quote/QuotePreviewModal';
import type { PreviewQuote } from '@/components/quote/QuotePreviewModal';
import { FaWhatsapp } from 'react-icons/fa';
import { formatDistanceToNow } from 'date-fns';
import { buildContextualQuoteWhatsAppMessage } from '@/lib/whatsapp-quote-message';
import { AddressInput, type AddressDetails } from '@/components/live-call/AddressInput';
import Autocomplete from 'react-google-autocomplete';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  SkuSlabSummary,
  InlineSkuAutocomplete,
  getEffectiveSkuPriceAndMinutes,
  type CatalogSku,
  type SkuPickResult,
} from '@/components/admin/SkuPicker';
import type {
  JobCategory,
  ParsedJobResult,
  LineItemResult,
  BatchDiscount,
  LayoutTier,
  BookingMode,
  MultiLineResult,
  MarginPreview,
} from '@shared/contextual-pricing-types';
import { getCategoryLabel } from '@shared/categories';
import { getPricingConfig } from '@shared/pricing-models';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RecentCaller {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  postcode: string;
  jobSummary: string;
  calledAt: string | null;
}

interface ContractorOption {
  id: string;
  name: string;
  profileImageUrl: string | null;
  availabilityStatus: string | null;
  city: string | null;
  postcode: string | null;
  categorySlugs: string[];
}

interface LineItem {
  id: string;
  description: string;
  category: JobCategory;
  estimatedMinutes: number;
  materialsCostPounds: number; // in pounds for easier input, converted to pence on submit
  details?: string;
  /** Phase 4d — for fixed-fee categories with tiers (e.g. waste_removal: small/medium/full van load) */
  fixedTier?: string | null;
  /** Phase 11 — line needs a materials collection trip. Composer dedupes across all lines; +30min ONCE per quote when any line is flagged. */
  requiresMaterialCollection?: boolean;
  /**
   * Phase 25c/25d — distinguishes catalog pick from free-text custom work.
   * A line is a SKU line iff source==='sku' && skuCode is set (picked from
   * the inline autocomplete). Otherwise it's custom — the typed description
   * goes through the LLM/reference pricing on generate. New lines default to
   * 'custom' (the inline autocomplete state), flipping to 'sku' on pick.
   */
  source: 'sku' | 'custom';
  /** Phase 25c — when set, the engine resolves price + schedule from service_catalog. */
  skuCode?: string;
  /** Phase 25c — count for per_unit SKUs (defaults to sku.minimumUnits on pick). */
  unitCount?: number;
  /** Phase 25c — chosen tier label for tiered SKUs. */
  selectedTier?: string;
  /**
   * Phase 25c — cached SKU row at pick-time so we can re-render the slab
   * without round-tripping to the server. Kept local; the engine resolves
   * fresh from the catalog when the quote actually generates.
   */
  skuMeta?: CatalogSku;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional Extras types
// ─────────────────────────────────────────────────────────────────────────────

interface ExtrasCatalogEntry {
  id: string;
  label: string;
  description: string;
  priceInPence: number;
  badge?: string | null;
  isActive: boolean;
}

interface OptionalExtra {
  label: string;
  description: string;
  priceInPence: number;
  badge?: string;
  // Tracks whether this came from the library (id) or is a custom one
  catalogId?: string;
}

/** AI-generated extra suggestion — distinct from the saved OptionalExtra type
 *  because it carries a "reasoning" field and is keyed by label until ticked. */
interface AiSuggestedExtra {
  label: string;
  description: string;
  priceInPence: number;
  badge?: string | null;
  reasoning?: string | null;
}

interface ContextSignals {
  urgency: 'standard' | 'priority' | 'emergency';
  materialsSupply: 'customer_supplied' | 'we_supply' | 'labor_only';
  timeOfService: 'standard' | 'after_hours' | 'weekend';
  isReturningCustomer: boolean;
  previousJobCount: number;
  previousAvgPricePence: number;
}

interface QuoteResult {
  success: boolean;
  quoteId: string;
  shortSlug: string;
  quoteUrl: string;
  whatsappMessage: string;
  whatsappSendUrl: string;
  directPriceMessage: string | null;
  directPriceSendUrl: string | null;
  pricing: {
    totalPence: number;
    totalFormatted: string;
    lineItems: LineItemResult[];
    batchDiscount: BatchDiscount;
  };
  messaging: {
    headline: string;
    layoutTier: LayoutTier;
    bookingModes: BookingMode[];
    requiresHumanReview: boolean;
    reviewReason?: string;
  };
  marginPreview?: MarginPreview;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  general_fixing: 'General Fixing',
  flat_pack: 'Flat Pack Assembly',
  tv_mounting: 'TV Mounting',
  carpentry: 'Carpentry',
  plumbing_minor: 'Plumbing (Minor)',
  electrical_minor: 'Electrical (Minor)',
  painting: 'Painting',
  tiling: 'Tiling',
  plastering: 'Plastering',
  lock_change: 'Lock Change',
  guttering: 'Guttering',
  pressure_washing: 'Pressure Washing',
  fencing: 'Fencing',
  garden_maintenance: 'Garden Maintenance',
  bathroom_fitting: 'Bathroom Fitting',
  kitchen_fitting: 'Kitchen Fitting',
  door_fitting: 'Door Fitting',
  flooring: 'Flooring',
  curtain_blinds: 'Curtain & Blinds',
  silicone_sealant: 'Silicone / Sealant',
  shelving: 'Shelving',
  furniture_repair: 'Furniture Repair',
  waste_removal: 'Waste Removal',
  other: 'Other',
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// Category icons for slab display
const CATEGORY_ICONS: Record<string, string> = {
  plumbing_minor: '🔧',
  electrical_minor: '⚡',
  tv_mounting: '📺',
  painting: '🎨',
  carpentry: '🪚',
  flat_pack: '📦',
  tiling: '🧱',
  plastering: '🏗️',
  lock_change: '🔒',
  guttering: '🏠',
  pressure_washing: '💦',
  fencing: '🪵',
  garden_maintenance: '🌿',
  bathroom_fitting: '🚿',
  kitchen_fitting: '🍳',
  door_fitting: '🚪',
  flooring: '🪵',
  curtain_blinds: '🪟',
  silicone_sealant: '🧴',
  shelving: '📐',
  furniture_repair: '🪑',
  waste_removal: '🗑️',
  general_fixing: '🔨',
  other: '📋',
};

/**
 * Auto-detect job category from description text.
 * Returns the best matching category or null if uncertain.
 */
function autoDetectCategory(description: string): string | null {
  const d = description.toLowerCase();
  const rules: [RegExp, string][] = [
    [/\b(tap|leak|pipe|drain|toilet|shower|boiler|plumb|cistern|radiator|stopcock)\b/, 'plumbing_minor'],
    [/\b(tv|television|mount|bracket|wall.?mount)\b/, 'tv_mounting'],
    [/\b(switch|socket|light|dimmer|spotlight|downlight|electric|fuse|circuit)\b/, 'electrical_minor'],
    [/\b(paint|emulsion|gloss|primer|decor|wall.?paper)\b/, 'painting'],
    [/\b(tile|tiling|grout|splash.?back|mosaic)\b/, 'tiling'],
    [/\b(plaster|skim|render|patch|artex)\b/, 'plastering'],
    [/\b(flat.?pack|ikea|assembly|assemble|wardrobe|desk|bookcase)\b/, 'flat_pack'],
    [/\b(shelf|shelves|shelving|floating)\b/, 'shelving'],
    [/\b(lock|yale|deadbolt|cylinder|door.?lock)\b/, 'lock_change'],
    [/\b(gutter|fascia|soffit|downpipe)\b/, 'guttering'],
    [/\b(pressure.?wash|jet.?wash|patio.?clean|driveway.?clean)\b/, 'pressure_washing'],
    [/\b(fence|fencing|panel|post|gate)\b/, 'fencing'],
    [/\b(garden|hedge|lawn|prune|tree|stump)\b/, 'garden_maintenance'],
    [/\b(bathroom|bath|vanity|basin)\b/, 'bathroom_fitting'],
    [/\b(kitchen|worktop|hob|oven|unit)\b/, 'kitchen_fitting'],
    [/\b(door|hinge|handle|door.?fit)\b/, 'door_fitting'],
    [/\b(floor|laminate|vinyl|carpet|lino)\b/, 'flooring'],
    [/\b(curtain|blind|rail|track|roller)\b/, 'curtain_blinds'],
    [/\b(silicone|seal|sealant|caulk|mould)\b/, 'silicone_sealant'],
    [/\b(furniture|chair|table|drawer|cabinet)\b/, 'furniture_repair'],
    [/\b(waste|rubbish|skip|clear|removal|dispose)\b/, 'waste_removal'],
    [/\b(carpent|wood|timber|stud|batten|frame|joist|board)\b/, 'carpentry'],
  ];

  for (const [pattern, category] of rules) {
    if (pattern.test(d)) return category;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Time unit helpers — stores everything as minutes internally
// ---------------------------------------------------------------------------

type TimeUnit = 'min' | 'hr' | 'day';

const TIME_UNITS: { value: TimeUnit; label: string; minutes: number }[] = [
  { value: 'min', label: 'min', minutes: 1 },
  { value: 'hr', label: 'hr', minutes: 60 },
  { value: 'day', label: 'day', minutes: 480 }, // 8-hr working day
];

/** Pick the best display unit for a given minute value */
function bestUnit(totalMinutes: number): { amount: number; unit: TimeUnit } {
  if (totalMinutes >= 480 && totalMinutes % 480 === 0) {
    return { amount: totalMinutes / 480, unit: 'day' };
  }
  if (totalMinutes >= 60 && totalMinutes % 30 === 0) {
    return { amount: parseFloat((totalMinutes / 60).toFixed(1)), unit: 'hr' };
  }
  return { amount: totalMinutes, unit: 'min' };
}

/** Convert amount + unit back to total minutes */
function toMinutes(amount: number, unit: TimeUnit): number {
  const unitDef = TIME_UNITS.find((u) => u.value === unit);
  return Math.max(1, Math.round(amount * (unitDef?.minutes ?? 1)));
}

/** Compact time display for badges / summaries */
function formatTime(totalMinutes: number): string {
  const { amount, unit } = bestUnit(totalMinutes);
  if (unit === 'day') return `${amount}d`;
  if (unit === 'hr') return `${amount}h`;
  return `${amount}m`;
}

/** Quick-pick presets for common job durations */
const TIME_PRESETS = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
  { label: '1d', minutes: 480 },
  { label: '2d', minutes: 960 },
];

/** Step sizes: how much ± buttons add/subtract depending on current value */
function getStep(currentMinutes: number): number {
  if (currentMinutes < 60) return 15;       // under 1h → ±15min
  if (currentMinutes < 480) return 30;      // under 1d → ±30min
  return 480;                                // 1d+ → ±1 day
}

/** Format minutes into human-friendly label */
function formatTimeLabel(totalMinutes: number): string {
  if (totalMinutes >= 480 && totalMinutes % 480 === 0) {
    const days = totalMinutes / 480;
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
  if (totalMinutes >= 60) {
    const hrs = totalMinutes / 60;
    return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hr${hrs !== 1 ? 's' : ''}`;
  }
  return `${totalMinutes} min`;
}

/**
 * TimeInput — mobile-optimised stepper with quick-pick presets
 *
 * Desktop: compact [ - ] 1.5 hrs [ + ] inline
 * Mobile:  [ - ] 1.5 hrs [ + ] row, then quick-pick chips below
 */
function TimeInput({
  minutes,
  onChange,
  compact = false,
}: {
  minutes: number;
  onChange: (newMinutes: number) => void;
  compact?: boolean;
}) {
  const step = getStep(minutes);
  const label = formatTimeLabel(minutes);
  const isPreset = TIME_PRESETS.some((p) => p.minutes === minutes);

  const decrement = () => onChange(Math.max(15, minutes - step));
  const increment = () => onChange(minutes + step);

  // Compact: stepper row — full-width on mobile, inline on sm+
  if (compact) {
    return (
      <div className="flex items-center gap-0.5 w-full sm:w-auto">
        <button
          type="button"
          onClick={decrement}
          className="h-10 sm:h-9 w-10 sm:w-8 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent active:scale-95 transition-transform flex items-center justify-center shrink-0"
        >
          −
        </button>
        <div className="h-10 sm:h-9 flex-1 sm:flex-none sm:min-w-[70px] px-1 rounded-md border border-input bg-background flex items-center justify-center text-sm sm:text-xs font-medium whitespace-nowrap">
          {label}
        </div>
        <button
          type="button"
          onClick={increment}
          className="h-10 sm:h-9 w-10 sm:w-8 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent active:scale-95 transition-transform flex items-center justify-center shrink-0"
        >
          +
        </button>
      </div>
    );
  }

  // Mobile: stepper + quick-pick chips
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={decrement}
          className="h-10 w-10 rounded-lg border border-input bg-background text-lg font-bold hover:bg-accent active:scale-95 transition-transform flex items-center justify-center shrink-0"
        >
          −
        </button>
        <div className="h-10 flex-1 rounded-lg border border-input bg-background flex items-center justify-center text-sm font-semibold">
          {label}
        </div>
        <button
          type="button"
          onClick={increment}
          className="h-10 w-10 rounded-lg border border-input bg-background text-lg font-bold hover:bg-accent active:scale-95 transition-transform flex items-center justify-center shrink-0"
        >
          +
        </button>
      </div>
      <div className="flex gap-1 flex-wrap">
        {TIME_PRESETS.map((p) => (
          <button
            key={p.minutes}
            type="button"
            onClick={() => onChange(p.minutes)}
            className={`h-7 px-2.5 rounded-full text-xs font-medium transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
              minutes === p.minutes
                ? 'bg-primary text-primary-foreground ring-1 ring-primary'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Margin Preview Panel — admin-only per-line margin breakdown
// ---------------------------------------------------------------------------

function getMarginColor(percent: number): string {
  if (percent >= 40) return 'text-green-400';
  if (percent >= 30) return 'text-yellow-400';
  if (percent >= 20) return 'text-orange-400';
  return 'text-red-400';
}

function getMarginBgColor(percent: number): string {
  if (percent >= 40) return 'bg-green-500/10 border-green-500/20';
  if (percent >= 30) return 'bg-yellow-500/10 border-yellow-500/20';
  if (percent >= 20) return 'bg-orange-500/10 border-orange-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

const TIER_LABELS: Record<string, string> = {
  specialist: 'Specialist',
  skilled: 'Skilled',
  general: 'General',
  outdoor: 'Outdoor',
};

const TIER_COLORS: Record<string, string> = {
  specialist: 'text-purple-400',
  skilled: 'text-blue-400',
  general: 'text-slate-400',
  outdoor: 'text-emerald-400',
};

const TIER_BG_COLORS: Record<string, string> = {
  specialist: 'bg-purple-500/15 border-purple-500/30 text-purple-300',
  skilled: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
  general: 'bg-slate-500/15 border-slate-500/30 text-slate-300',
  outdoor: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
};

function MarginPreviewPanel({ data }: { data: MarginPreview }) {
  // Whole-pound formatting throughout — customers don't pay pence
  const p2p = (p: number) => `£${Math.round(p / 100)}`;
  const hasRevShare = data.perLineMargin.some(l => l.tier);

  const totalCustomerPrice = data.perLineMargin.reduce((s, l) => s + l.customerPricePence, 0);
  const totalContractorPay = data.totalCostPence;
  const totalHours = data.perLineMargin.reduce((s, l) => s + l.hours, 0);
  const effectiveAvgHourly = totalHours > 0 ? Math.round(totalContractorPay / totalHours) : 0;
  const hasFloor = data.perLineMargin.some(l => l.payMethod === 'floor');

  // Per-tier rollup for the chip strip
  const tierGroups: Record<string, { pay: number; hours: number; lines: number }> = {};
  data.perLineMargin.forEach(line => {
    const t = line.tier || 'general';
    if (!tierGroups[t]) tierGroups[t] = { pay: 0, hours: 0, lines: 0 };
    tierGroups[t].pay += line.contractorCostPence;
    tierGroups[t].hours += line.hours;
    tierGroups[t].lines += 1;
  });

  // Short category labels for mobile
  const shortCat = (slug: string) => {
    const full = CATEGORY_LABELS[slug] || slug;
    return full.replace(' (Minor)', '').replace(' & ', '/').replace('Flat Pack Assembly', 'Flat Pack').replace('General Fixing', 'Fixing').replace('Garden Maintenance', 'Garden');
  };

  return (
    <Card className="overflow-hidden border-handy-grid shadow-sm">
      <CardHeader className="bg-handy-navy text-white px-4 sm:px-6 py-3 border-b-4 border-handy-yellow mb-3">
        <CardTitle className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5 min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 text-handy-yellow shrink-0" />
          <span className="truncate">{hasRevShare ? 'Rev Share — contractor & platform' : 'Margin'}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-3 sm:px-6">
        {/* Per-line breakdown only when there's more than one line — for a
            single-line quote the per-line numbers ARE the totals so showing
            both is redundant. */}
        {data.perLineMargin.length > 1 && (
        <>
        {/* Single combined table — desktop */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 pr-2 font-medium">Category</th>
                {hasRevShare && <th className="text-right py-1.5 px-1 font-medium">Tier</th>}
                <th className="text-right py-1.5 px-1 font-medium">Hrs</th>
                <th className="text-right py-1.5 px-1 font-medium">Customer</th>
                <th className="text-right py-1.5 px-1 font-medium text-handy-yellow">Contractor</th>
                <th className="text-right py-1.5 px-1 font-medium text-handy-navy/80">Platform</th>
                <th className="text-right py-1.5 pl-1 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {data.perLineMargin.map((line, idx) => {
                const effHourly = line.hours > 0 ? Math.round(line.contractorCostPence / line.hours) : 0;
                const tierColor = line.tier ? TIER_COLORS[line.tier] : 'text-muted-foreground';
                return (
                  <tr key={idx} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 text-foreground">{CATEGORY_LABELS[line.categorySlug] || line.categorySlug}</td>
                    {hasRevShare && (
                      <td className={`text-right py-1.5 px-1 ${tierColor}`}>
                        {line.tier ? (
                          <>
                            {TIER_LABELS[line.tier]} {line.revenueSharePercent}%
                            {line.payMethod === 'floor' && <span className="text-orange-400 ml-0.5" title="Hourly floor exceeded share">↑</span>}
                          </>
                        ) : '—'}
                      </td>
                    )}
                    <td className="text-right py-1.5 px-1 text-muted-foreground">{parseFloat(line.hours.toFixed(2))}</td>
                    <td className="text-right py-1.5 px-1 text-foreground">{p2p(line.customerPricePence)}</td>
                    <td className="text-right py-1.5 px-1 text-handy-yellow font-medium">
                      {p2p(line.contractorCostPence)}
                      <span className="text-muted-foreground/60 text-[10px] ml-1">({p2p(effHourly)}/hr)</span>
                    </td>
                    <td className={`text-right py-1.5 px-1 ${getMarginColor(line.marginPercent)}`}>{p2p(line.marginPence)}</td>
                    <td className={`text-right py-1.5 pl-1 font-medium ${getMarginColor(line.marginPercent)}`}>{line.marginPercent}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="py-2 pr-2 text-foreground">Total</td>
                {hasRevShare && <td className="py-2 px-1" />}
                <td className="text-right py-2 px-1 text-muted-foreground">{parseFloat(totalHours.toFixed(1))}</td>
                <td className="text-right py-2 px-1 text-foreground">{p2p(totalCustomerPrice)}</td>
                <td className="text-right py-2 px-1 text-handy-yellow font-bold">
                  {p2p(totalContractorPay)}
                  <span className="text-muted-foreground/60 text-[10px] ml-1">({p2p(effectiveAvgHourly)}/hr)</span>
                </td>
                <td className={`text-right py-2 px-1 ${getMarginColor(data.totalMarginPercent)}`}>{p2p(data.totalMarginPence)}</td>
                <td className={`text-right py-2 pl-1 font-bold ${getMarginColor(data.totalMarginPercent)}`}>{data.totalMarginPercent}%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile: stacked rows showing both contractor + platform per line */}
        <div className="sm:hidden space-y-2">
          {data.perLineMargin.map((line, idx) => {
            const effHourly = line.hours > 0 ? Math.round(line.contractorCostPence / line.hours) : 0;
            const tierColor = line.tier ? TIER_COLORS[line.tier] : 'text-muted-foreground';
            return (
              <div key={idx} className="rounded-lg border border-border/50 px-3 py-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{shortCat(line.categorySlug)}</span>
                  {hasRevShare && line.tier && (
                    <span className={`text-[10px] font-medium ${tierColor}`}>
                      {TIER_LABELS[line.tier]} {line.revenueSharePercent}%
                      {line.payMethod === 'floor' && <span className="text-orange-400 ml-0.5">↑</span>}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded bg-handy-yellow/10 border border-handy-yellow/30 px-2 py-1">
                    <div className="text-handy-navy/60 text-[9px] uppercase tracking-wider font-semibold">Contractor</div>
                    <div className="text-handy-yellow font-bold">{p2p(line.contractorCostPence)}</div>
                    <div className="text-handy-navy/50 text-[9px]">{parseFloat(line.hours.toFixed(1))}h · {p2p(effHourly)}/hr</div>
                  </div>
                  <div className={`rounded border px-2 py-1 ${getMarginBgColor(line.marginPercent)}`}>
                    <div className="text-muted-foreground/70 text-[9px] uppercase tracking-wider">Platform</div>
                    <div className={`font-semibold ${getMarginColor(line.marginPercent)}`}>{p2p(line.marginPence)}</div>
                    <div className={`text-[9px] ${getMarginColor(line.marginPercent)}`}>{line.marginPercent}% margin</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </>
        )}

        {/* Combined summary — Contractor + Platform side by side */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md px-3 py-2.5 border bg-handy-yellow/10 border-handy-yellow/40">
            <div className="text-[10px] uppercase tracking-wider text-handy-navy/70 mb-0.5 font-semibold">Contractor Payout</div>
            <div className="text-base font-bold text-handy-yellow tabular-nums">{p2p(totalContractorPay)}</div>
            <div className="text-[10px] text-handy-navy/60">
              {p2p(effectiveAvgHourly)}/hr · {parseFloat(totalHours.toFixed(1))}h
            </div>
          </div>
          <div className={`rounded-md px-3 py-2.5 border ${getMarginBgColor(data.totalMarginPercent)}`}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Platform Margin</div>
            <div className={`text-base font-bold tabular-nums ${getMarginColor(data.totalMarginPercent)}`}>{p2p(data.totalMarginPence)}</div>
            <div className={`text-[10px] ${getMarginColor(data.totalMarginPercent)}`}>
              {data.totalMarginPercent}% of {p2p(totalCustomerPrice)}
            </div>
          </div>
        </div>

        {/* Per-tier rollup chips (only when rev share has multiple tiers in play) */}
        {hasRevShare && Object.keys(tierGroups).length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(tierGroups).map(([tier, g]) => (
              <div key={tier} className={`rounded-lg px-2 py-1 border text-[10px] ${TIER_BG_COLORS[tier] || TIER_BG_COLORS.general}`}>
                <span className="font-semibold">{TIER_LABELS[tier] || tier}</span>
                <span className="opacity-70 ml-1">
                  {g.lines}× · {p2p(g.pay)} · {p2p(g.hours > 0 ? Math.round(g.pay / g.hours) : 0)}/hr
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Floor explanation */}
        {hasFloor && (
          <div className="rounded-md px-3 py-2 border bg-orange-500/10 border-orange-500/20">
            <p className="text-[11px] text-orange-300">
              <span className="font-medium">Floor active</span> — min hourly exceeded share on some lines, contractor pay raised to floor.
            </p>
          </div>
        )}

        {/* Revenue share legend */}
        {hasRevShare && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
            <span className={`${TIER_COLORS.specialist}`}>Spec 55%</span>
            <span className={`${TIER_COLORS.skilled}`}>Skill 50%</span>
            <span className={`${TIER_COLORS.general}`}>Gen 45%</span>
            <span className={`${TIER_COLORS.outdoor}`}>Out 45%</span>
            <span className="text-orange-400">↑ floor</span>
          </div>
        )}

        {/* Flags */}
        {data.flags.length > 0 && (
          <div className="space-y-1">
            {data.flags.map((flag, idx) => (
              <div key={idx} className="flex items-start gap-1.5 text-[11px] text-yellow-400">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>{flag}</span>
              </div>
            ))}
          </div>
        )}

        {/* Info text */}
        <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
          <Info className="w-3 h-3 shrink-0" />
          {hasRevShare
            ? 'Contractor pay = MAX(% of price, hourly floor). Platform = customer price − contractor pay.'
            : 'Warning only — does not block sending'}
        </p>
      </CardContent>
    </Card>
  );
}

// Reference hourly rates (pence) and minimums for live estimate — mirrors server/contextual-pricing/reference-rates.ts
const CATEGORY_RATES: Record<string, { hourly: number; min: number }> = {
  general_fixing: { hourly: 3000, min: 4500 },
  flat_pack: { hourly: 2800, min: 4000 },
  tv_mounting: { hourly: 3500, min: 5000 },
  carpentry: { hourly: 4000, min: 5500 },
  curtain_blinds: { hourly: 3000, min: 4000 },
  door_fitting: { hourly: 3500, min: 6000 },
  plumbing_minor: { hourly: 4500, min: 6000 },
  electrical_minor: { hourly: 5000, min: 6500 },
  painting: { hourly: 3000, min: 8000 },
  tiling: { hourly: 4000, min: 6000 },
  waste_removal: { hourly: 2500, min: 4000 },
  plastering: { hourly: 4000, min: 6000 },
  lock_change: { hourly: 5000, min: 7000 },
  guttering: { hourly: 3500, min: 5000 },
  pressure_washing: { hourly: 3000, min: 5000 },
  shelving: { hourly: 3000, min: 4500 },
  silicone_sealant: { hourly: 2500, min: 3500 },
  fencing: { hourly: 3500, min: 5000 },
  flooring: { hourly: 3000, min: 8000 },
  furniture_repair: { hourly: 3000, min: 4500 },
  garden_maintenance: { hourly: 2500, min: 4000 },
  bathroom_fitting: { hourly: 5000, min: 15000 },
  kitchen_fitting: { hourly: 5000, min: 20000 },
  other: { hourly: 3500, min: 5000 },
};

function estimateLineItemPence(item: LineItem): number {
  const rate = CATEGORY_RATES[item.category] || CATEGORY_RATES.other;
  const timeBased = Math.round((rate.hourly / 60) * item.estimatedMinutes);
  const labour = Math.max(timeBased, rate.min);
  const materials = Math.round((item.materialsCostPounds || 0) * 100);
  return labour + materials;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPhoneForWhatsApp(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  cleaned = cleaned.replace(/^\+/, '');
  if (cleaned.startsWith('0')) {
    cleaned = '44' + cleaned.substring(1);
  }
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Contractor Fit Panel — INFORM mode: which contractors fit (skill + location)
// for the quote's categories, and their available days. Read-only; reuses the
// /api/admin/availability/fit endpoint. Does NOT drive the customer's dates.
// ─────────────────────────────────────────────────────────────────────────────

interface FitCandidate {
  contractorId: string;
  name: string;
  distanceMiles: number | null;
  coveragePercent: number;
  coveredCategories: string[];
  availableDays: { date: string; slot: string }[];
}

interface FitResponse {
  candidates: FitCandidate[];
  fullCoverageCandidates: number;
  partialCoverageCandidates: number;
  uncoveredCategories: string[];
  from: string;
  days: number;
  /** Phase 24b — echoed back so the UI can show "Start a 3-day job on…" */
  requiredDays?: number;
}

function ContractorFitPanel({
  categorySlugs,
  coordinates,
  requiredDays = 1,
}: {
  categorySlugs: string[];
  coordinates: { lat: number; lng: number } | null;
  /** Phase 24b — multi-day jobs need N consecutive days. Default 1 = legacy. */
  requiredDays?: number;
}) {
  const catKey = [...categorySlugs].sort().join(',');
  const { data, isLoading, isError, refetch, isFetching } = useQuery<FitResponse>({
    queryKey: ['contractor-fit', catKey, coordinates?.lat, coordinates?.lng, requiredDays],
    enabled: categorySlugs.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ categories: categorySlugs.join(','), days: '14' });
      if (coordinates) {
        params.set('lat', String(coordinates.lat));
        params.set('lng', String(coordinates.lng));
      }
      if (requiredDays > 1) params.set('requiredDays', String(requiredDays));
      const res = await fetch(`/api/admin/availability/fit?${params.toString()}`, { headers: { ...getAuthHeaders() } });
      if (!res.ok) throw new Error('Failed to load contractor fit');
      return res.json();
    },
  });

  if (categorySlugs.length === 0) return null;

  return (
    <Card className="overflow-hidden border-handy-grid shadow-sm">
      <CardHeader className="bg-handy-navy text-white px-4 sm:px-6 py-3 border-b-4 border-handy-yellow mb-3">
        <CardTitle className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <Users className="w-4 h-4 text-handy-yellow" />
          Who fits this job
          {requiredDays > 1 && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-handy-yellow text-handy-navy px-1.5 py-0.5 rounded">
              {requiredDays}-day
            </span>
          )}
          {data && (
            <span className="text-xs font-normal text-white/70">
              · {data.candidates.length} contractor{data.candidates.length === 1 ? '' : 's'}
            </span>
          )}
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 text-xs text-white/70 hover:text-handy-yellow hover:bg-white/5" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-handy-muted py-4"><Loader2 className="w-4 h-4 animate-spin" /> Finding contractors…</div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-xs text-red-400 py-2"><AlertTriangle className="w-4 h-4" /> Couldn't load fit. <button type="button" onClick={() => refetch()} className="underline">Retry</button></div>
        ) : !data || data.candidates.length === 0 ? (
          // Phase 22b — server now filters to 100% coverage, so an empty list
          // means either no one covers the full skill mix OR no one is in
          // range. Spell out the actionable consequence either way.
          <div className="rounded-lg border-2 border-red-500/60 bg-red-50 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-700">
              <div className="font-bold mb-0.5">No single contractor can do this whole job{coordinates ? ' within range' : ''}.</div>
              {data && data.uncoveredCategories.length > 0 && (
                <div>Uncovered: <span className="font-semibold">{data.uncoveredCategories.map(c => getCategoryLabel(c as any)).join(', ')}</span>. Split the quote or assign manually.</div>
              )}
            </div>
          </div>
        ) : (
          <>
            {data.candidates.map((c) => {
              return (
                <div key={c.contractorId} className="rounded-lg border p-3 border-handy-grid bg-white hover:border-handy-yellow/60 transition-[border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-handy-navy">{c.name}</span>
                    {/* Every candidate is 100% coverage (filtered server-side); badge stays as
                        a positive confirmation that they can do the whole job. */}
                    <Badge className="bg-handy-yellow text-handy-navy border-handy-yellow/80 text-[10px] font-bold">Full match</Badge>
                    {c.distanceMiles != null && <span className="text-[11px] text-handy-muted font-medium">{c.distanceMiles} mi</span>}
                  </div>
                  <div className="mt-2">
                    {c.availableDays.length === 0 ? (
                      <span className="text-[11px] text-handy-muted">
                        {requiredDays > 1
                          ? `No ${requiredDays}-day window available in the next 14 days`
                          : 'No availability set in the next 14 days'}
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {c.availableDays.slice(0, 8).map((d) => {
                          // Phase 24b — for multi-day jobs each chip is a START date.
                          // Show "Wed 4 → Fri 6" so the span is visible.
                          const startD = new Date(d.date);
                          let label = formatDate(startD, 'EEE d');
                          if (requiredDays > 1) {
                            const endD = new Date(startD);
                            endD.setDate(startD.getDate() + (requiredDays - 1));
                            label = `${formatDate(startD, 'EEE d')} → ${formatDate(endD, 'EEE d')}`;
                          } else if (d.slot !== 'full') {
                            label += ` ${d.slot.toUpperCase()}`;
                          }
                          return (
                            <span key={d.date} className="text-[10px] px-1.5 py-0.5 rounded bg-white text-handy-navy border border-handy-grid">
                              {label}
                            </span>
                          );
                        })}
                        {c.availableDays.length > 8 && <span className="text-[10px] text-handy-muted">+{c.availableDays.length - 8} more</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 20 — structured Customer Context
// Replaces the freeform `vaContext` textarea + recording with a small set of
// dropdowns/chips. `buildStructuredVaContext` (inside the component) composes
// the legacy vaContext string from these fields so the LLM keeps the same
// signal shape it always had.
// ─────────────────────────────────────────────────────────────────────────────

const CUSTOMER_TYPES = [
  { value: 'homeowner', label: 'Homeowner', emoji: '🏠' },
  { value: 'landlord', label: 'Landlord', emoji: '🔑' },
  { value: 'property_manager', label: 'Property Manager', emoji: '🏢' },
  { value: 'tenant', label: 'Tenant', emoji: '👤' },
  { value: 'business', label: 'Business / Commercial', emoji: '💼' },
  { value: 'letting_agent', label: 'Letting Agent', emoji: '🗂️' },
] as const;
type CustomerType = (typeof CUSTOMER_TYPES)[number]['value'];

const URGENCY_OPTIONS = [
  { value: 'standard' as const, label: 'Standard', helper: 'This week' },
  { value: 'priority' as const, label: 'Priority', helper: 'Next 48h' },
  { value: 'emergency' as const, label: 'Emergency', helper: 'Today' },
];

// Nottingham postcode prefix → human area label. The local business serves
// these postcodes most often; outside the NG range we fall back to the raw
// prefix so the LLM still gets a meaningful hint.
const POSTCODE_AREA: Record<string, string> = {
  NG1: 'Nottingham city centre',
  NG2: 'West Bridgford / The Meadows',
  NG3: 'Mapperley / Sneinton',
  NG4: 'Carlton / Gedling',
  NG5: 'Sherwood / Bestwood',
  NG6: 'Bulwell / Bestwood Village',
  NG7: 'Lenton / Radford / Hyson Green',
  NG8: 'Aspley / Bilborough / Wollaton',
  NG9: 'Beeston / Chilwell / Stapleford',
  NG10: 'Long Eaton / Sandiacre',
  NG11: 'Clifton / Ruddington',
  NG12: 'Cotgrave / Keyworth / Radcliffe',
  NG13: 'Bingham',
  NG14: 'Calverton / Lowdham',
  NG15: 'Hucknall',
  NG16: 'Eastwood / Kimberley',
  NG17: 'Sutton-in-Ashfield / Kirkby',
  NG18: 'Mansfield',
  NG19: 'Mansfield Woodhouse',
  NG20: 'Warsop / Cuckney',
  NG21: 'Rainworth / Edwinstowe',
  NG22: 'Tuxford / Ollerton',
  NG23: 'Newark area',
  NG24: 'Newark',
  NG25: 'Southwell',
};

function postcodeToArea(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const trimmed = postcode.trim().toUpperCase();
  if (!trimmed) return null;
  const prefix = trimmed.match(/^[A-Z]{1,2}\d{1,2}/)?.[0] || null;
  if (!prefix) return null;
  return POSTCODE_AREA[prefix] || `${prefix} area`;
}

// Best-effort category inference for a custom (no-SKU-match) line, from its typed
// text — mirrors how catalog SKUs map words → category so a custom line lands in
// the right trade. Returns null when nothing obvious matches (keep the current
// default). Always editable via the now-visible Category dropdown.
const CUSTOM_CATEGORY_GUESS: Array<[RegExp, string]> = [
  [/\b(tap|leak|toilet|cistern|drain|radiator|plumb|basin|sink|shower|waste\s?pipe|stopcock|ballcock)\b/i, 'plumbing_minor'],
  [/\b(socket|sockets|light|lights|lighting|fan|extractor|electric|wiring|fuse|consumer\s?unit|switch|downlight|spotlight)\b/i, 'electrical_minor'],
  [/\b(tv|television|soundbar|bracket|wall\s?mount)\b/i, 'tv_mounting'],
  [/\b(paint|painting|emulsion|undercoat|gloss|decorat)\b/i, 'painting'],
  [/\b(tile|tiles|tiling|grout|re-?grout)\b/i, 'tiling'],
  [/\b(silicone|sealant|re-?seal|caulk|mould)\b/i, 'silicone_sealant'],
  [/\b(door|doors|hinge|latch|handle|lock|deadbolt)\b/i, 'door_fitting'],
  [/\b(floor|flooring|laminate|vinyl|lvt|skirting)\b/i, 'flooring'],
  [/\b(shelf|shelves|shelving|bracket|curtain|blind|blinds|rail|mirror|picture|frame)\b/i, 'shelving'],
  [/\b(flat\s?pack|assemble|assembly|wardrobe|ikea|furniture|drawer)\b/i, 'flat_pack'],
  [/\b(gutter|guttering|downpipe|fascia)\b/i, 'guttering'],
  [/\b(jet\s?wash|pressure\s?wash|driveway\s?clean|patio\s?clean)\b/i, 'pressure_washing'],
  [/\b(fence|fencing|gate|gatepost|post)\b/i, 'fencing'],
  [/\b(garden|hedge|lawn|shed|patio|decking|weed)\b/i, 'garden_maintenance'],
  [/\b(plaster|plastering|skim|render|patch)\b/i, 'plastering'],
  [/\b(carpentry|joinery|architrave|worktop|stud\s?wall)\b/i, 'carpentry'],
];
function guessCategoryFromText(text: string): string | null {
  const t = (text || '').toLowerCase();
  for (const [re, cat] of CUSTOM_CATEGORY_GUESS) if (re.test(t)) return cat;
  return null;
}

export default function GenerateContextualQuote() {
  const { toast } = useToast();

  // ── Customer fields ──
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [addressValidated, setAddressValidated] = useState(false);

  // ── Job description ──
  const [jobDescription, setJobDescription] = useState('');

  // ── Line items ──
  const [lineItems, setLineItems] = useState<LineItem[]>(() => [
    // Job 1 is present by default — no "Add first job" click needed. Starts as a
    // blank custom line (inline autocomplete); not auto-focused so the admin can
    // fill Customer Details first.
    { id: generateId(), description: '', category: 'general_fixing' as JobCategory, estimatedMinutes: 30, materialsCostPounds: 0, source: 'custom' },
  ]);

  // ── Pricing signals ──
  const [signals, setSignals] = useState<ContextSignals>({
    urgency: 'standard',
    materialsSupply: 'labor_only',
    timeOfService: 'standard',
    isReturningCustomer: false,
    previousJobCount: 0,
    previousAvgPricePence: 0,
  });

  // ── VA Context ──
  // Phase 20 — structured customer context replaces the freeform vaContext
  // textarea + recording. The LLM still receives a vaContext string at
  // submit time, but it's composed deterministically from these fields
  // (see `buildStructuredVaContext` below) so similar customers across
  // similar jobs produce comparable AI output.
  const [customerType, setCustomerType] = useState<CustomerType | ''>('');

  // ── Property context (Phase 4b — drives scheduling math, not pricing) ──
  const [floorNumber, setFloorNumber] = useState<number | null>(null);
  const [hasLift, setHasLift] = useState<boolean | null>(null);
  const [parkingDistance, setParkingDistance] = useState<'on_drive' | 'street_outside' | 'street_within_50m' | '50m_plus' | null>(null);
  const [customerPresent, setCustomerPresent] = useState<boolean | null>(null);

  // ── Manual available dates (admin-picked whitelist for customer date picker) ──
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [datePickerMonth, setDatePickerMonth] = useState(new Date());

  // ── Optional extras (library + custom) attached to this quote ──
  const [optionalExtras, setOptionalExtras] = useState<OptionalExtra[]>([]);
  const [showCustomExtraForm, setShowCustomExtraForm] = useState(false);
  const [customExtraDraft, setCustomExtraDraft] = useState<{ label: string; description: string; pricePounds: string; badge: string }>({
    label: '',
    description: '',
    pricePounds: '',
    badge: '',
  });

  // ── AI-suggested extras (context + jobs driven) ──
  const [aiSuggestedExtras, setAiSuggestedExtras] = useState<AiSuggestedExtra[]>([]);
  const [aiSuggestionsLoading, setAiSuggestionsLoading] = useState(false);
  const aiSuggestionsAbortRef = useRef<AbortController | null>(null);
  const aiSuggestionsLastKeyRef = useRef<string>('');

  // ── Contractor assignment ──
  const [selectedContractorId, setSelectedContractorId] = useState<string | null>(null);

  // ── Call card selection ──
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(null);

  // ── Phase 25d — inline SKU autocomplete ──
  // The line description doubles as a catalog search box. We only track the
  // most-recently-added line id so its inline input autofocuses; there is no
  // modal any more — picks happen inline from the dropdown.
  const [newLineId, setNewLineId] = useState<string | null>(null);

  // Progressive disclosure: a not-yet-picked line stays a single input until the
  // catalog finds no SKU match for the typed text; then it's "custom" and reveals
  // Category / Time / Materials. Tracked per line id; the ref guards one-time
  // category inference so we never clobber an admin's manual category choice.
  const [customLineIds, setCustomLineIds] = useState<Set<string>>(new Set());
  const categoryGuessedIds = useRef<Set<string>>(new Set());

  // ── Result ──
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Phase 15 — draft preview before quote is persisted
  const [draftPreviewOpen, setDraftPreviewOpen] = useState(false);

  // ── Send mode: always 'full' (link-based quote message) ──
  const [sendMode, setSendMode] = useState<'full' | 'direct'>('full');

  // ── Clipboard state ──
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // ── Live pricing preview (calls the real engine) ──
  const [livePreview, setLivePreview] = useState<MultiLineResult | null>(null);
  const [liveMarginPreview, setLiveMarginPreview] = useState<MarginPreview | null>(null);
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);
  const livePreviewAbortRef = useRef<AbortController | null>(null);

  // Phase 24b — required days derived from the sum of line item minutes.
  // Used by the fit panel to slide an N-day window; matches the server
  // `computeRequiredDays` helper (480-min working day).
  const liveRequiredDays = useMemo(() => {
    const totalMin = lineItems.reduce((sum, li) => sum + (li.estimatedMinutes || 0), 0);
    if (totalMin <= 0) return 1;
    return Math.max(1, Math.ceil(totalMin / 480));
  }, [lineItems]);
  const livePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLivePreview = useCallback(async (items: LineItem[], sigs: ContextSignals, enrichedContext?: string) => {
    // Cancel any in-flight request
    livePreviewAbortRef.current?.abort();

    // Need at least one valid line item. SKU-picked lines that haven't had
    // a SKU selected yet (description still empty) are skipped — they're
    // half-finished and would just error.
    const validItems = items.filter((li) => li.description.trim() && li.estimatedMinutes > 0);
    if (validItems.length === 0) {
      setLivePreview(null);
      setLiveMarginPreview(null);
      setLivePreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    livePreviewAbortRef.current = controller;
    setLivePreviewLoading(true);

    try {
      const res = await fetch('/api/pricing/multi-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          lines: validItems.map((li) => ({
            id: li.id,
            description: li.description,
            category: li.category,
            timeEstimateMinutes: li.estimatedMinutes,
            materialsCostPence: Math.round((li.materialsCostPounds || 0) * 100),
            // Phase 25c — pass SKU fields through so the server engine
            // short-circuits the LLM for catalog-picked lines.
            source: li.source,
            ...(li.skuCode ? { skuCode: li.skuCode } : {}),
            ...(li.unitCount !== undefined ? { unitCount: li.unitCount } : {}),
            ...(li.selectedTier ? { selectedTier: li.selectedTier } : {}),
          })),
          signals: {
            urgency: sigs.urgency,
            materialsSupply: sigs.materialsSupply,
            timeOfService: sigs.timeOfService,
            isReturningCustomer: sigs.isReturningCustomer,
            previousJobCount: sigs.previousJobCount,
            previousAvgPricePence: sigs.previousAvgPricePence,
          },
          vaContext: enrichedContext,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Preview failed');
      const data = await res.json() as MultiLineResult & { marginPreview?: MarginPreview };
      const { marginPreview: mp, ...pricingData } = data;
      setLivePreview(pricingData);
      setLiveMarginPreview(mp ?? null);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // Silently fall back — preview is non-critical
        setLivePreview(null);
        setLiveMarginPreview(null);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLivePreviewLoading(false);
      }
    }
  }, []);

  // Phase 20 — derive the legacy `vaContext` string from structured fields.
  // The contextual-pricing engine + AI-polish endpoints still expect a single
  // string; this is the only place that string gets assembled now.
  const buildStructuredVaContext = useCallback((): string | undefined => {
    const ct = CUSTOMER_TYPES.find((t) => t.value === customerType);
    const area = postcodeToArea(postcode);
    const parts: string[] = [];
    if (ct) parts.push(`Customer type: ${ct.label}`);
    if (area) parts.push(`Area: ${area}`);
    if (signals.urgency !== 'standard') parts.push(`Urgency: ${signals.urgency}`);
    return parts.length ? parts.join('. ') + '.' : undefined;
  }, [customerType, postcode, signals.urgency]);

  // Debounced effect: re-fetch live preview when line items, signals, or
  // structured context change.
  useEffect(() => {
    if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    livePreviewTimerRef.current = setTimeout(() => {
      fetchLivePreview(lineItems, signals, buildStructuredVaContext());
    }, 600);
    return () => {
      if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    };
  }, [lineItems, signals, buildStructuredVaContext, fetchLivePreview]);

  // ── AI extras suggestions: fired when lineItems / vaContext stabilise ──
  // Phase 16 — catalog-driven suggested extras (replaces the LLM call).
  // Fetches from /api/admin/extras-catalog/suggested with the current line
  // categories. Cheap (no LLM), curated, scored by category relevance.
  const fetchAiSuggestedExtras = useCallback(async (force = false) => {
    const validLines = lineItems.filter((li) => li.description.trim().length >= 1);
    if (validLines.length === 0) {
      setAiSuggestedExtras([]);
      aiSuggestionsLastKeyRef.current = '';
      return;
    }
    const cats = Array.from(new Set(validLines.map((l) => l.category))).sort();
    const key = cats.join(',');
    if (!force && key === aiSuggestionsLastKeyRef.current) return;
    aiSuggestionsLastKeyRef.current = key;

    aiSuggestionsAbortRef.current?.abort();
    const controller = new AbortController();
    aiSuggestionsAbortRef.current = controller;

    setAiSuggestionsLoading(true);
    try {
      const params = new URLSearchParams({ categories: cats.join(','), limit: '6' });
      const res = await fetch(`/api/admin/extras-catalog/suggested?${params.toString()}`, {
        headers: { ...getAuthHeaders() },
        signal: controller.signal,
      });
      if (!res.ok) {
        setAiSuggestedExtras([]);
        return;
      }
      const data = await res.json();
      // Map catalog shape → AiSuggestedExtra shape consumed by the UI
      const mapped = (Array.isArray(data?.extras) ? data.extras : []).map((e: any) => ({
        label: e.label,
        description: e.description,
        priceInPence: e.priceInPence,
        badge: e.badge ?? undefined,
        catalogId: e.id,
      }));
      setAiSuggestedExtras(mapped);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setAiSuggestedExtras([]);
    } finally {
      setAiSuggestionsLoading(false);
    }
  }, [lineItems]);

  // Debounced trigger — wait 1.2s after last edit before suggesting, so we
  // don't burn LLM calls during typing.
  useEffect(() => {
    const t = setTimeout(() => {
      fetchAiSuggestedExtras(false);
    }, 1200);
    return () => clearTimeout(t);
  }, [fetchAiSuggestedExtras]);

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Fetch recent callers
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: callers, isLoading: callersLoading } = useQuery<RecentCaller[]>({
    queryKey: ['recent-callers'],
    queryFn: async () => {
      const res = await fetch('/api/calls/recent-callers', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch recent callers');
      return res.json();
    },
    staleTime: 30_000,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Fetch contractors for assignment dropdown
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: contractors } = useQuery<ContractorOption[]>({
    queryKey: ['pricing-contractors'],
    queryFn: async () => {
      const res = await fetch('/api/pricing/contractors', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch contractors');
      return res.json();
    },
    staleTime: 60_000,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Fetch optional extras catalog (library)
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: extrasCatalog } = useQuery<ExtrasCatalogEntry[]>({
    queryKey: ['admin-extras-catalog'],
    queryFn: async () => {
      const res = await fetch('/api/admin/extras-catalog', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch extras catalog');
      const data = await res.json();
      // Backend wraps the array as { extras: [...] }
      return Array.isArray(data) ? data : (data?.extras ?? []);
    },
    staleTime: 60_000,
  });

  const activeExtrasCatalog = useMemo(
    () => (Array.isArray(extrasCatalog) ? extrasCatalog : []).filter((e) => e.isActive),
    [extrasCatalog],
  );

  // Auto-suggest best contractor based on line item categories
  const suggestedContractor = useMemo(() => {
    if (!contractors || contractors.length === 0 || lineItems.length === 0) return null;
    const jobCategories = lineItems.map(li => li.category);

    // Score each contractor: how many of the job categories they cover
    const scored = contractors.map(c => {
      const matchCount = jobCategories.filter(cat => c.categorySlugs.includes(cat)).length;
      const isAvailable = c.availabilityStatus === 'available';
      return {
        ...c,
        matchCount,
        matchPercent: Math.round((matchCount / jobCategories.length) * 100),
        score: matchCount * 10 + (isAvailable ? 5 : 0),
      };
    }).filter(c => c.matchCount > 0);

    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }, [contractors, lineItems]);

  // ═══════════════════════════════════════════════════════════════════════════
  // API: AI job parser
  // ═══════════════════════════════════════════════════════════════════════════

  const parseJobMutation = useMutation({
    mutationFn: async (description: string): Promise<ParsedJobResult> => {
      const res = await fetch('/api/pricing/parse-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to parse job' }));
        throw new Error(err.error || 'Failed to parse job');
      }
      return res.json();
    },
    onSuccess: (result) => {
      // Map parsed lines to our LineItem format — accepts any minute value.
      // AI-parsed lines arrive as free-text so they default to source='custom'
      // (admin can flip to SKU per line if they recognise a catalog match).
      const newItems: LineItem[] = result.lines.map((line) => ({
        id: line.id || generateId(),
        description: line.description,
        category: line.category,
        estimatedMinutes: line.timeEstimateMinutes,
        materialsCostPounds: 0,
        source: 'custom' as const,
      }));
      setLineItems(newItems);

      // Apply detected signals
      if (result.detectedSignals) {
        const ds = result.detectedSignals;
        setSignals((prev) => ({
          ...prev,
          ...(ds.urgency ? { urgency: ds.urgency } : {}),
          ...(ds.materialsSupply ? { materialsSupply: ds.materialsSupply } : {}),
          ...(ds.timeOfService ? { timeOfService: ds.timeOfService } : {}),
        }));
      }

      toast({ title: 'Parsed!', description: `${newItems.length} line item${newItems.length > 1 ? 's' : ''} detected.` });
    },
    onError: (error: Error) => {
      toast({ title: 'Parse Failed', description: error.message, variant: 'destructive' });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Create contextual quote
  // ═══════════════════════════════════════════════════════════════════════════

  const createQuoteMutation = useMutation({
    mutationFn: async (enrichedVaContext?: string): Promise<QuoteResult> => {
      const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
      const res = await fetch('/api/pricing/create-contextual-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          customerName,
          phone,
          email: email || undefined,
          address: address || undefined,
          postcode: postcode || undefined,
          coordinates: coordinates || undefined,
          jobDescription: jobDescription || lineItems.map(li => li.description).filter(Boolean).join(', ') || undefined,
          lines: lineItems.map((li) => ({
            id: li.id,
            description: li.description,
            category: li.category,
            estimatedMinutes: li.estimatedMinutes,
            materialsCostPence: Math.round(li.materialsCostPounds * 100) || 0,
            details: li.details ?? null,
            fixedTier: li.fixedTier ?? null,
            requiresMaterialCollection: !!li.requiresMaterialCollection,
            // Phase 25c — SKU fields persist through to the server's
            // catalog short-circuit path.
            source: li.source,
            ...(li.skuCode ? { skuCode: li.skuCode } : {}),
            ...(li.unitCount !== undefined ? { unitCount: li.unitCount } : {}),
            ...(li.selectedTier ? { selectedTier: li.selectedTier } : {}),
          })),
          signals: {
            urgency: signals.urgency,
            materialsSupply: signals.materialsSupply,
            timeOfService: signals.timeOfService,
            isReturningCustomer: signals.isReturningCustomer,
            previousJobCount: signals.previousJobCount,
            previousAvgPricePence: signals.previousAvgPricePence,
          },
          // Phase 4b property context — drives scheduling, not pricing
          floorNumber: floorNumber ?? undefined,
          hasLift: hasLift ?? undefined,
          parkingDistanceCategory: parkingDistance ?? undefined,
          customerPresent: customerPresent ?? undefined,
          vaContext: enrichedVaContext,
          // Phase 21 — structured customer type drives downstream conditional
          // UI (landlord banner, tenant consent disclaimer, trade-quote variant)
          // and auto-pick of relevant extras. Persisted into contextSignals.
          customerType: customerType || undefined,
          sourceCallId: selectedCallerId || undefined,
          contractorId: selectedContractorId || undefined,
          createdBy: adminUser?.id || undefined,
          createdByName: adminUser?.name || adminUser?.email || undefined,
          availableDates,
          optionalExtras: optionalExtras.length
            ? optionalExtras.map((e) => ({
                label: e.label,
                description: e.description,
                priceInPence: e.priceInPence,
                ...(e.badge ? { badge: e.badge } : {}),
              }))
            : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create quote' }));
        throw new Error(err.error || err.message || 'Failed to create quote');
      }
      return res.json();
    },
    onSuccess: (result) => {
      setQuoteResult(result);
      setSendMode('full');
      toast({ title: 'Quote Created!', description: 'Ready to send via WhatsApp.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSelectCaller = (caller: RecentCaller, mode: 'all' | 'customer') => {
    setSelectedCallerId(caller.id);
    setCustomerName(caller.customerName || '');
    setPhone(caller.phone || '');
    setAddress(caller.address || '');
    setPostcode(caller.postcode || '');
    setCoordinates(null);
    setAddressValidated(false);

    if (mode === 'all') {
      setJobDescription(caller.jobSummary || '');
      // Auto-parse the job description if present
      if (caller.jobSummary && caller.jobSummary.trim().length > 5) {
        parseJobMutation.mutate(caller.jobSummary);
      }
    } else {
      setJobDescription('');
      setLineItems([]);
    }
  };

  const handleAddLineItem = () => {
    const newId = generateId();
    setLineItems((prev) => [
      ...prev,
      {
        id: newId,
        description: '',
        category: 'general_fixing' as JobCategory,
        estimatedMinutes: 30,
        materialsCostPounds: 0,
        // Phase 25d — new lines start as the inline-autocomplete (custom)
        // state with the description field focused. Typing searches the
        // catalog; picking a suggestion flips the line to a SKU line.
        source: 'custom',
      },
    ]);
    // Mark this line so its inline description input autofocuses.
    setNewLineId(newId);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  };

  const handleUpdateLineItem = (id: string, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== id) return li;
        const updated = { ...li, [field]: value };
        // Auto-detect category when description changes (only if user hasn't manually picked)
        if (field === 'description' && typeof value === 'string' && value.length >= 3) {
          const detected = autoDetectCategory(value);
          if (detected && li.category === 'general_fixing') {
            updated.category = detected as JobCategory;
          }
        }
        return updated;
      }),
    );
  };

  // Track which items are being polished + their original text (before polish)
  const [polishingIds, setPolishingIds] = useState<Set<string>>(new Set());
  const [polishingDetailIds, setPolishingDetailIds] = useState<Set<string>>(new Set());
  const [draftingDetailIds, setDraftingDetailIds] = useState<Set<string>>(new Set());
  // Global toggle: when on, every line shows a detail textarea that auto-drafts
  // a customer-facing description after the title polishes. Off by default so
  // simple quotes stay tidy; admin opts in for high-ticket / multi-line jobs.
  const [showLineDetails, setShowLineDetails] = useState(false);
  const originalDescriptions = useRef<Map<string, string>>(new Map());
  const originalDetails = useRef<Map<string, string>>(new Map());
  // Track which line ids have already had a detail draft attempted, so we don't
  // repeatedly call the auto-draft endpoint on every polish.
  const draftedDetailIds = useRef<Set<string>>(new Set());

  // Auto-draft a "what's included" detail for a line — called after polish succeeds.
  // Only runs if the line's `details` field is currently empty (so we don't
  // overwrite anything the user typed manually).
  const autoDraftLineDetail = useCallback(async (id: string, polishedTitle: string, category: JobCategory, currentVaContext?: string) => {
    // Skip if we've already attempted a draft for this line
    if (draftedDetailIds.current.has(id)) return;
    draftedDetailIds.current.add(id);

    setDraftingDetailIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch('/api/pricing/draft-line-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          lineDescription: polishedTitle,
          category,
          vaContext: currentVaContext || undefined,
        }),
      });
      if (!res.ok) return;
      const { detail } = await res.json();
      if (typeof detail === 'string' && detail.trim().length > 0) {
        // Only populate if the user hasn't typed anything in the meantime
        setLineItems((prev) =>
          prev.map((li) => {
            if (li.id !== id) return li;
            if (li.details && li.details.trim().length > 0) return li;
            return { ...li, details: detail };
          }),
        );
      }
    } catch {
      // Silently fail — auto-draft is non-critical
    } finally {
      setDraftingDetailIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const handlePolishDescription = useCallback(async (id: string, description: string) => {
    const trimmed = description.trim();
    if (trimmed.length < 5) return; // Too short to polish

    // Don't re-polish if text hasn't changed since last blur
    const lastOriginal = originalDescriptions.current.get(id);
    if (lastOriginal === trimmed) return;

    setPolishingIds((prev) => new Set(prev).add(id));
    let polishedFinal: string | null = null;
    let suggestedCategoryFromLLM: string | null = null;
    let suggestedMinutesFromLLM: number | null = null;
    try {
      const res = await fetch('/api/pricing/polish-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: trimmed }),
      });
      if (!res.ok) return;
      const { polished, estimatedMinutes, suggestedCategory } = await res.json();
      if (polished && polished !== trimmed) {
        originalDescriptions.current.set(id, trimmed);
        handleUpdateLineItem(id, 'description', polished);
        polishedFinal = polished;
      } else {
        // Even if unchanged, record it so we don't re-call
        originalDescriptions.current.set(id, trimmed);
        polishedFinal = trimmed;
      }
      if (typeof estimatedMinutes === 'number' && estimatedMinutes > 0) {
        suggestedMinutesFromLLM = estimatedMinutes;
      }
      if (typeof suggestedCategory === 'string' && suggestedCategory) {
        suggestedCategoryFromLLM = suggestedCategory;
      }
    } catch {
      // Silently fail — don't interrupt the user
    } finally {
      setPolishingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }

    // Apply LLM-suggested time + category ONLY if the line is still on its
    // defaults — never overwrite an admin-set value.
    if (suggestedMinutesFromLLM != null || suggestedCategoryFromLLM != null) {
      const line = lineItems.find((li) => li.id === id);
      if (line) {
        if (suggestedMinutesFromLLM != null && line.estimatedMinutes === 30) {
          handleUpdateLineItem(id, 'estimatedMinutes', suggestedMinutesFromLLM);
        }
        if (suggestedCategoryFromLLM != null && line.category === 'general_fixing') {
          handleUpdateLineItem(id, 'category', suggestedCategoryFromLLM as any);
        }
      }
    }

    // Follow-up: auto-draft the "details" field if empty AND the global toggle is on.
    // Look up the most recent line state so we don't draft over user-typed details.
    // We clear the once-per-line guard before calling so a title edit re-drafts.
    if (polishedFinal && showLineDetails) {
      const line = lineItems.find((li) => li.id === id);
      const hasManualDetail = line?.details && line.details.trim().length > 0;
      if (!hasManualDetail) {
        const currentCategory = (line?.category ?? 'general_fixing') as JobCategory;
        draftedDetailIds.current.delete(id);
        autoDraftLineDetail(id, polishedFinal, currentCategory, buildStructuredVaContext());
      }
    }
  }, [handleUpdateLineItem, autoDraftLineDetail, lineItems, buildStructuredVaContext, showLineDetails]);

  // Polish a manually-edited detail textarea on blur (mirrors title polish behaviour).
  const handlePolishDetail = useCallback(async (id: string, detail: string) => {
    const trimmed = detail.trim();
    if (trimmed.length < 5) return;

    const lastOriginal = originalDetails.current.get(id);
    if (lastOriginal === trimmed) return;

    setPolishingDetailIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch('/api/pricing/polish-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: trimmed }),
      });
      if (!res.ok) return;
      const { polished } = await res.json();
      if (polished && polished !== trimmed) {
        originalDetails.current.set(id, trimmed);
        handleUpdateLineItem(id, 'details', polished);
      } else {
        originalDetails.current.set(id, trimmed);
      }
    } catch {
      // Silently fail
    } finally {
      setPolishingDetailIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [handleUpdateLineItem]);

  const handleParseJob = () => {
    if (!jobDescription.trim()) {
      toast({ title: 'No description', description: 'Enter a job description first.', variant: 'destructive' });
      return;
    }
    parseJobMutation.mutate(jobDescription.trim());
  };

  // Phase 20 — voice recording removed. Customer context is now structured
  // (customerType + auto-derived area + urgency), so there's no freeform
  // textarea to transcribe into. The /api/transcribe endpoint still exists
  // but is no longer called from this page.

  const handleGenerate = () => {
    if (!customerName.trim()) {
      toast({ title: 'Missing name', description: 'Customer name is required.', variant: 'destructive' });
      return;
    }
    if (!phone.trim()) {
      toast({ title: 'Missing phone', description: 'Phone number is required.', variant: 'destructive' });
      return;
    }
    if (lineItems.length === 0) {
      toast({ title: 'No line items', description: 'Add at least one line item.', variant: 'destructive' });
      return;
    }
    // Validate line items have descriptions
    const emptyLines = lineItems.filter((li) => !li.description.trim());
    if (emptyLines.length > 0) {
      toast({ title: 'Incomplete items', description: 'All line items need a description.', variant: 'destructive' });
      return;
    }
    // Phase 12 — availableDates whitelist no longer required (live contractor availability
    // drives the customer's date picker). System auto-assigns contractor at reserve time.
    // Auto-set materialsSupply when any line has materials
    const hasMaterials = lineItems.some((li) => li.materialsCostPounds > 0);
    if (hasMaterials && signals.materialsSupply === 'labor_only') {
      setSignals((prev) => ({ ...prev, materialsSupply: 'we_supply' }));
    }

    // Phase 20 — vaContext is now built deterministically from structured fields.
    createQuoteMutation.mutate(buildStructuredVaContext());
  };

  const handleCopyMessage = () => {
    if (!quoteResult) return;
    navigator.clipboard.writeText(quoteResult.whatsappMessage);
    setCopiedMessage(true);
    toast({ title: 'Copied!' });
    setTimeout(() => setCopiedMessage(false), 2000);
  };

  const handleCopyLink = () => {
    if (!quoteResult) return;
    trackEvent('cq_link_copied', {
      quote_id: quoteResult.quoteId,
      short_slug: quoteResult.shortSlug,
      total_price_pence: quoteResult.pricing.totalPence,
      copied_by: 'admin',
    });
    navigator.clipboard.writeText(quoteResult.quoteUrl);
    setCopiedLink(true);
    toast({ title: 'Link Copied!' });
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSendWhatsApp = () => {
    if (!quoteResult) return;
    trackEvent('cq_whatsapp_sent', {
      quote_id: quoteResult.quoteId,
      short_slug: quoteResult.shortSlug,
      total_price_pence: quoteResult.pricing.totalPence,
      total_price_pounds: quoteResult.pricing.totalFormatted,
      line_item_count: quoteResult.pricing.lineItems.length,
      batch_discount_applied: quoteResult.pricing.batchDiscount.applied,
      layout_tier: quoteResult.messaging.layoutTier,
      send_mode: 'full',
      sent_by: 'admin', // VA sent from admin panel
    });
    window.open(quoteResult.whatsappSendUrl, '_blank');
  };


  const handleReset = () => {
    setQuoteResult(null);
    setLiveMarginPreview(null);
    setSendMode('full');
    setCustomerName('');
    setPhone('');
    setEmail('');
    setAddress('');
    setPostcode('');
    setJobDescription('');
    setLineItems([]);
    setSelectedCallerId(null);
    setSelectedContractorId(null);
    setCustomerType('');
    setAvailableDates([]);
    setDatePickerMonth(new Date());
    setOptionalExtras([]);
    setShowCustomExtraForm(false);
    setCustomExtraDraft({ label: '', description: '', pricePounds: '', badge: '' });
    setSignals({
      urgency: 'standard',
      materialsSupply: 'labor_only',
      timeOfService: 'standard',
      isReturningCustomer: false,
      previousJobCount: 0,
      previousAvgPricePence: 0,
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 25c — SKU line item handlers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clear a picked SKU, returning the line to the empty inline-autocomplete
   * (custom) state. Wipes the SKU references AND the description so the input
   * comes back blank and ready to re-search.
   */
  const handleClearSkuLine = useCallback((lineId: string) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineId) return li;
        return {
          ...li,
          source: 'custom',
          skuCode: undefined,
          unitCount: undefined,
          selectedTier: undefined,
          skuMeta: undefined,
          description: '',
          estimatedMinutes: 30,
        };
      }),
    );
    // Refocus the now-empty inline input.
    setNewLineId(lineId);
  }, []);

  /** Apply a picked SKU to the named line. */
  // A line flips to "custom" when the inline autocomplete settles with no catalog
  // match. We reveal Category/Time/Materials and, once per line, infer a starting
  // category from the typed text (never overriding a category the admin set).
  const handleLineCustomChange = useCallback((lineId: string, isCustom: boolean) => {
    setCustomLineIds((prev) => {
      if (isCustom === prev.has(lineId)) return prev;
      const next = new Set(prev);
      if (isCustom) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
    if (isCustom && !categoryGuessedIds.current.has(lineId)) {
      categoryGuessedIds.current.add(lineId);
      setLineItems((prev) =>
        prev.map((li) => {
          if (li.id !== lineId) return li;
          // Only fill when still on the creation default — respect a manual pick.
          if (li.category && li.category !== 'general_fixing') return li;
          const guess = guessCategoryFromText(li.description || '');
          return guess ? { ...li, category: guess } : li;
        }),
      );
    }
  }, []);

  const handlePickSkuForLine = useCallback((lineId: string, result: SkuPickResult) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineId) return li;
        return {
          ...li,
          source: 'sku',
          skuCode: result.sku.skuCode,
          skuMeta: result.sku,
          unitCount: result.unitCount,
          selectedTier: result.selectedTier,
          // Mirror the SKU's name into description so the LLM messaging
          // pass + downstream readers (invoices, dispatch sheet) see the
          // human-readable label. The server engine still resolves price
          // from the catalog, not from this description.
          description: result.sku.name,
          category: (result.sku.category as JobCategory) || li.category,
          estimatedMinutes: result.derivedScheduleMinutes,
        };
      }),
    );
  }, []);

  /** Update the per-unit count for a SKU line; recompute derived schedule. */
  const handleUpdateSkuUnitCount = useCallback((lineId: string, nextCount: number) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineId) return li;
        if (!li.skuMeta) return li;
        const derived = getEffectiveSkuPriceAndMinutes(li.skuMeta, nextCount, li.selectedTier);
        return {
          ...li,
          unitCount: nextCount,
          estimatedMinutes: derived.scheduleMinutes,
        };
      }),
    );
  }, []);

  /** Update the tier for a tiered SKU line; recompute derived schedule. */
  const handleUpdateSkuTier = useCallback((lineId: string, nextTier: string) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineId) return li;
        if (!li.skuMeta) return li;
        const derived = getEffectiveSkuPriceAndMinutes(li.skuMeta, li.unitCount, nextTier);
        return {
          ...li,
          selectedTier: nextTier,
          estimatedMinutes: derived.scheduleMinutes,
        };
      }),
    );
  }, []);

  // Validate form completeness for button state. SKU lines without a skuCode
  // also count as incomplete even if estimatedMinutes is non-zero.
  const canGenerate =
    customerName.trim() &&
    phone.trim() &&
    lineItems.length > 0 &&
    lineItems.every((li) => {
      if (li.source === 'sku') return !!li.skuCode && li.description.trim();
      return li.description.trim();
    });

  // The "Detail" toggle only matters for custom lines (SKU lines carry their own
  // customer description), so it's only surfaced once a line is in custom state.
  const hasCustomLine = lineItems.some(
    (li) => li.source !== 'sku' && customLineIds.has(li.id),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div
      className="p-4 md:p-8 bg-handy-bg min-h-screen"
      style={{
        // Force LIGHT shadcn tokens locally — the admin shell sets `.dark` on
        // <html>, which makes Card / Input / Select default to a near-black
        // surface and washes the handy-navy brand text out. Re-declaring the
        // CSS vars here re-skins every nested shadcn primitive without
        // touching the global theme.
        ['--background' as any]: '0 0% 100%',
        ['--foreground' as any]: '210 36% 18%',
        ['--card' as any]: '0 0% 100%',
        ['--card-foreground' as any]: '210 36% 18%',
        ['--popover' as any]: '0 0% 100%',
        ['--popover-foreground' as any]: '210 36% 18%',
        ['--muted' as any]: '210 40% 96.1%',
        ['--muted-foreground' as any]: '215 16% 46%',
        ['--accent' as any]: '210 40% 96.1%',
        ['--accent-foreground' as any]: '210 36% 18%',
        ['--border' as any]: '218 25% 86%',
        ['--input' as any]: '218 25% 86%',
        ['--ring' as any]: '37 91% 55%',
      }}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Only show form when no result yet */}
        {!quoteResult && (
          <>

            {/* ─── Section 2: Customer Details ─── */}
            <Card className="overflow-hidden border-handy-grid shadow-sm">
              <CardHeader className="bg-handy-navy text-white px-4 sm:px-6 py-3 border-b-4 border-handy-yellow mb-3">
                <CardTitle className="text-base font-bold text-white tracking-tight">Customer Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="cx-name" className="text-xs text-muted-foreground">Name *</Label>
                    <Input
                      id="cx-name"
                      placeholder="John Smith"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cx-phone" className="text-xs text-muted-foreground">Phone *</Label>
                    <Input
                      id="cx-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="07700 900123"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Postcode</Label>
                    <Autocomplete
                      apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                      onPlaceSelected={(place: any) => {
                        const postcodeComponent = place?.address_components?.find((c: any) => c.types.includes('postal_code'));
                        if (postcodeComponent) setPostcode(postcodeComponent.long_name);
                        if (place?.geometry?.location) {
                          const lat = typeof place.geometry.location.lat === 'function' ? place.geometry.location.lat() : place.geometry.location.lat;
                          const lng = typeof place.geometry.location.lng === 'function' ? place.geometry.location.lng() : place.geometry.location.lng;
                          if (typeof lat === 'number' && typeof lng === 'number') {
                            setCoordinates({ lat, lng });
                          }
                        }
                      }}
                      options={{
                        types: ['postal_code'],
                        componentRestrictions: { country: 'gb' },
                      }}
                      defaultValue={postcode}
                      onChange={(e: any) => setPostcode(e.target.value)}
                      placeholder="NG1 1AA"
                      className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    {/* Auto-derived area pill — drives the LLM context without manual entry. */}
                    {postcodeToArea(postcode) && (
                      <p className="text-handy-yellow text-[10px] mt-1 font-semibold">
                        📍 {postcodeToArea(postcode)}
                      </p>
                    )}
                  </div>
                </div>

                {/* ── Phase 20 — Structured Customer Context ── */}
                <div className="space-y-3 pt-2 border-t border-handy-grid/60">
                  <div>
                    <Label className="text-xs text-muted-foreground">Customer type *</Label>
                    <Select value={customerType} onValueChange={(v) => setCustomerType(v as CustomerType)}>
                      <SelectTrigger className="mt-1 h-10">
                        <SelectValue placeholder="Pick one…" />
                      </SelectTrigger>
                      <SelectContent>
                        {CUSTOMER_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value} className="text-sm">
                            <span className="flex items-center gap-2"><span>{t.emoji}</span>{t.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Urgency</Label>
                    <div className="mt-1 grid grid-cols-3 gap-1.5">
                      {URGENCY_OPTIONS.map((opt) => (
                        <button
                          type="button"
                          key={opt.value}
                          onClick={() => setSignals((prev) => ({ ...prev, urgency: opt.value }))}
                          className={`h-12 px-2 rounded-md border text-xs font-semibold transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
                            signals.urgency === opt.value
                              ? 'bg-handy-navy text-white border-handy-navy shadow-sm'
                              : 'bg-white text-handy-navy/70 border-handy-grid hover:border-handy-navy/40 hover:text-handy-navy'
                          }`}
                        >
                          <div>{opt.label}</div>
                          <div className={`text-[9px] font-normal mt-0.5 ${signals.urgency === opt.value ? 'text-handy-yellow' : 'text-handy-muted/70'}`}>{opt.helper}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ─── Phase 21 — context-driven warnings ─── */}
            {customerType === 'tenant' && (
              <div className="rounded-lg border-2 border-handy-yellow bg-handy-cream px-4 py-3 flex items-start gap-3 shadow-sm">
                <AlertTriangle className="w-5 h-5 text-handy-yellow shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-bold text-handy-navy text-sm">Verify landlord consent</div>
                  <div className="text-xs text-handy-navy/80 mt-0.5">
                    Tenant-initiated work needs the landlord's OK — especially anything affecting fixtures (locks, plumbing, electrical, structural). Confirm before booking or we'll have an awkward conversation later.
                  </div>
                </div>
              </div>
            )}
            {customerType === 'business' && (
              <div className="rounded-lg border-2 border-handy-navy bg-handy-navy/5 px-4 py-3 flex items-center gap-3 shadow-sm">
                <span className="px-2 py-0.5 rounded bg-handy-navy text-white text-[10px] font-bold tracking-widest uppercase shrink-0">Trade</span>
                <div className="min-w-0 text-xs text-handy-navy/80">
                  This quote will be tagged <span className="font-semibold">Trade</span> on the customer page (simpler CTA, no consumer-guarantee copy). VAT handling stays on the invoice, not the quote.
                </div>
              </div>
            )}

            {/* ─── Section 3: Jobs (structured line-item slabs) ─── */}
            <Card className="overflow-hidden border-handy-grid shadow-sm">
              <CardHeader className="bg-handy-navy text-white px-4 sm:px-6 py-3 border-b-4 border-handy-yellow mb-3">
                <CardTitle className="text-base font-bold text-white tracking-tight flex items-center justify-between gap-3">
                  <span>Jobs</span>
                  <div className="flex items-center gap-3">
                    {/* Detail toggle — only for custom lines (SKU lines carry their own description) */}
                    {hasCustomLine && (
                    <Label
                      htmlFor="show-line-details"
                      className="flex items-center gap-2 text-[11px] font-normal text-white/70 cursor-pointer select-none"
                    >
                      <Wand2 className="w-3 h-3 text-handy-yellow" />
                      Detail
                      <Switch
                        id="show-line-details"
                        checked={showLineDetails}
                        onCheckedChange={(checked) => {
                          setShowLineDetails(checked);
                          if (checked) {
                            // Auto-draft details for every existing line that doesn't have one yet.
                            // Clear the once-per-line guard so re-toggling triggers fresh drafts.
                            for (const li of lineItems) {
                              if (!li.details && li.description.trim().length >= 5) {
                                draftedDetailIds.current.delete(li.id);
                                autoDraftLineDetail(li.id, li.description, li.category, buildStructuredVaContext());
                              }
                            }
                          }
                        }}
                      />
                    </Label>
                    )}
                    {lineItems.length > 0 && (
                      <Badge variant="outline" className="text-xs bg-handy-yellow/15 text-handy-yellow border-handy-yellow/60">
                        {lineItems.length} job{lineItems.length !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Job slabs */}
                {lineItems.length === 0 ? (
                  <div
                    className="text-center py-8 border-2 border-dashed border-handy-yellow/50 bg-handy-cream/50 rounded-xl cursor-pointer hover:border-handy-yellow hover:bg-handy-cream transition-[background-color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]"
                    onClick={handleAddLineItem}
                  >
                    <Plus className="w-6 h-6 mx-auto mb-2 text-handy-yellow" />
                    <p className="text-sm text-handy-navy font-semibold">Add first job</p>
                    <p className="text-xs text-handy-muted mt-1">One box per job — you decide the scope</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lineItems.map((item, index) => {
                      const icon = CATEGORY_ICONS[item.category] || '🔨';
                      const categoryLabel = CATEGORY_LABELS[item.category] || 'General';
                      const hasMaterials = item.materialsCostPounds > 0;
                      const isPolishing = polishingIds.has(item.id);
                      // Phase 25d — a line is a SKU line iff it was picked from
                      // the inline autocomplete (source==='sku' && skuCode).
                      // Everything else renders the inline autocomplete and is
                      // treated as custom on generate.
                      const isPickedSku = item.source === 'sku' && !!item.skuCode && !!item.skuMeta;
                      // Reveal Category/Time/Materials only once the line is known custom
                      // (typed, no catalog match). A picked SKU drives its own slab.
                      const showCustomConfig = !isPickedSku && customLineIds.has(item.id);

                      return (
                        <div
                          key={item.id}
                          className={`rounded-xl border-2 bg-white shadow-sm p-3 sm:p-4 space-y-3 relative group transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                            isPolishing ? 'border-handy-yellow shadow-handy-yellow/20' : 'border-handy-grid hover:border-handy-navy/30'
                          }`}
                        >
                          {/* Brand left edge */}
                          <div className="absolute left-0 top-3 bottom-3 w-1 bg-handy-yellow rounded-r" aria-hidden />
                          {/* Header: Job number + delete */}
                          <div className="flex items-center justify-between pl-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-handy-navy bg-handy-cream px-2 py-0.5 rounded">
                                Job {index + 1}
                              </span>
                              {isPolishing && (
                                <span className="flex items-center gap-1 text-[10px] text-handy-yellow animate-pulse">
                                  <Wand2 className="w-2.5 h-2.5" />
                                  polishing...
                                </span>
                              )}
                            </div>
                            {lineItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveLineItem(item.id)}
                                className="text-muted-foreground/40 hover:text-red-400 transition-colors p-1 -m-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          {/* Phase 25d — line body. A picked SKU shows the
                              deterministic SKU slab; anything else shows the
                              inline autocomplete (the description field that
                              searches the catalog as you type). No toggle —
                              picking a suggestion is what makes it a SKU line. */}
                          {isPickedSku ? (
                            <>
                              <SkuSlabSummary
                                sku={item.skuMeta!}
                                unitCount={item.unitCount}
                                selectedTier={item.selectedTier}
                                onChangeUnitCount={(next) => handleUpdateSkuUnitCount(item.id, next)}
                                onChangeSelectedTier={(next) => handleUpdateSkuTier(item.id, next)}
                                onEdit={() => handleClearSkuLine(item.id)}
                                onClear={() => handleClearSkuLine(item.id)}
                              />

                              {/* Detail textarea — still applies to SKU lines so admin
                                  can override the customer-facing description. */}
                              {showLineDetails && item.skuCode && (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <Label htmlFor={`line-detail-${item.id}`} className="text-[10px] text-muted-foreground/70">
                                      Detail
                                    </Label>
                                    <div className="flex items-center gap-2">
                                      {(draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id)) && (
                                        <span className="flex items-center gap-1 text-[10px] text-handy-yellow animate-pulse">
                                          <Wand2 className="w-2.5 h-2.5" />
                                          {draftingDetailIds.has(item.id) ? 'drafting...' : 'polishing...'}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        title="Regenerate detail from the SKU"
                                        aria-label="Regenerate detail"
                                        disabled={draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id) || !item.description?.trim()}
                                        onClick={() => {
                                          draftedDetailIds.current.delete(item.id);
                                          handleUpdateLineItem(item.id, 'details', '');
                                          autoDraftLineDetail(item.id, item.description, item.category, buildStructuredVaContext());
                                        }}
                                        className="text-muted-foreground/60 hover:text-handy-yellow disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                      >
                                        <RefreshCw className={`w-3 h-3 ${draftingDetailIds.has(item.id) ? 'animate-spin' : ''}`} />
                                      </button>
                                    </div>
                                  </div>
                                  <Textarea
                                    id={`line-detail-${item.id}`}
                                    placeholder="What's included in this line — auto-drafted from SKU, edit if needed."
                                    value={item.details ?? ''}
                                    onChange={(e) => handleUpdateLineItem(item.id, 'details', e.target.value)}
                                    onBlur={() => handlePolishDetail(item.id, item.details ?? '')}
                                    rows={3}
                                    className={`text-xs bg-transparent border-handy-grid focus:border-handy-yellow resize-none transition-colors ${
                                      draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id) ? 'opacity-60' : ''
                                    }`}
                                  />
                                </div>
                              )}
                            </>
                          ) : (
                            // ─── Inline autocomplete (custom / not-yet-picked) ───
                            // The description field searches the catalog as you
                            // type. Pick a suggestion → the line flips to a SKU
                            // line. Type and don't pick → it stays custom and is
                            // priced via the LLM/reference path on generate.
                            <>
                              <InlineSkuAutocomplete
                                value={item.description}
                                autoFocus={item.id === newLineId}
                                dimmed={isPolishing}
                                onChangeText={(next) => handleUpdateLineItem(item.id, 'description', next)}
                                onPickSku={(result) => handlePickSkuForLine(item.id, result)}
                                onBlur={() => handlePolishDescription(item.id, item.description)}
                                onCustomChange={(c) => handleLineCustomChange(item.id, c)}
                                onCreateCustom={() => handleLineCustomChange(item.id, true)}
                              />

                              {/* Detail textarea — only once the line is custom, then gated on the global "Detail" toggle */}
                              {showCustomConfig && showLineDetails && (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between">
                                    <Label htmlFor={`line-detail-${item.id}`} className="text-[10px] text-muted-foreground/70">
                                      Detail
                                    </Label>
                                    <div className="flex items-center gap-2">
                                      {(draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id)) && (
                                        <span className="flex items-center gap-1 text-[10px] text-handy-yellow animate-pulse">
                                          <Wand2 className="w-2.5 h-2.5" />
                                          {draftingDetailIds.has(item.id) ? 'drafting...' : 'polishing...'}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        title="Regenerate detail from the title"
                                        aria-label="Regenerate detail"
                                        disabled={draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id) || !item.description?.trim()}
                                        onClick={() => {
                                          // Clear the once-per-line guard + the current detail, then re-draft
                                          draftedDetailIds.current.delete(item.id);
                                          handleUpdateLineItem(item.id, 'details', '');
                                          autoDraftLineDetail(item.id, item.description, item.category, buildStructuredVaContext());
                                        }}
                                        className="text-muted-foreground/60 hover:text-handy-yellow disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                      >
                                        <RefreshCw className={`w-3 h-3 ${draftingDetailIds.has(item.id) ? 'animate-spin' : ''}`} />
                                      </button>
                                    </div>
                                  </div>
                                  <Textarea
                                    id={`line-detail-${item.id}`}
                                    placeholder="What's included in this line — auto-drafted, edit if needed."
                                    value={item.details ?? ''}
                                    onChange={(e) => handleUpdateLineItem(item.id, 'details', e.target.value)}
                                    onBlur={() => handlePolishDetail(item.id, item.details ?? '')}
                                    rows={3}
                                    className={`text-xs bg-transparent border-handy-grid focus:border-handy-yellow resize-none transition-colors ${
                                      draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id) ? 'opacity-60' : ''
                                    }`}
                                  />
                                </div>
                              )}

                              {/* Category + Time — revealed once the line is custom (no SKU match) */}
                              {showCustomConfig && (
                              <div className="flex flex-col sm:flex-row gap-2">
                                <Select
                                  value={item.category}
                                  onValueChange={(val) => handleUpdateLineItem(item.id, 'category', val)}
                                >
                                  <SelectTrigger className="h-10 sm:h-9 text-sm sm:text-xs bg-transparent border-handy-grid w-full sm:flex-1">
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className="shrink-0">{icon}</span>
                                      <span className="truncate">{categoryLabel}</span>
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {CATEGORY_OPTIONS.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                        <span className="flex items-center gap-1.5">
                                          <span>{CATEGORY_ICONS[opt.value] || '📋'}</span>
                                          {opt.label}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div className="w-full sm:w-auto sm:shrink-0">
                                  {(() => {
                                    // Phase 4d — fixed-tier categories show a tier picker
                                    // instead of free-form minutes (e.g. waste_removal: van load size).
                                    const cfg = getPricingConfig(item.category);
                                    if (cfg.model === 'fixed' && cfg.fixedTiers && cfg.fixedTiers.length > 0) {
                                      const currentTier = (item as any).fixedTier || '';
                                      return (
                                        <Select
                                          value={currentTier}
                                          onValueChange={(tierId) => {
                                            const t = cfg.fixedTiers!.find((tt) => tt.id === tierId);
                                            if (!t) return;
                                            setLineItems((prev) =>
                                              prev.map((li) =>
                                                li.id === item.id
                                                  ? { ...li, fixedTier: tierId, estimatedMinutes: t.scheduleMinutes }
                                                  : li
                                              )
                                            );
                                          }}
                                        >
                                          <SelectTrigger className="h-10 sm:h-9 text-sm sm:text-xs bg-transparent border-handy-grid w-full sm:w-44">
                                            <SelectValue placeholder={`Pick ${cfg.unitLabel}…`} />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {cfg.fixedTiers.map((t) => (
                                              <SelectItem key={t.id} value={t.id} className="text-xs">
                                                {t.label} · £{(t.pricePence / 100).toFixed(0)} · {t.scheduleMinutes}min
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      );
                                    }
                                    return (
                                      <TimeInput
                                        minutes={item.estimatedMinutes}
                                        onChange={(val) => handleUpdateLineItem(item.id, 'estimatedMinutes', val)}
                                        compact
                                      />
                                    );
                                  })()}
                                </div>
                              </div>
                              )}
                            </>
                          )}

                          {/* Materials — shown for SKU lines; for custom lines only once revealed */}
                          {(isPickedSku || showCustomConfig) && (
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => handleUpdateLineItem(item.id, 'materialsCostPounds', hasMaterials ? 0 : 1)}
                              className={`text-sm sm:text-xs px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full border transition-colors ${
                                hasMaterials
                                  ? 'border-handy-yellow bg-handy-yellow/15 text-handy-navy font-semibold'
                                  : 'border-handy-grid text-muted-foreground/50 hover:border-handy-navy/30'
                              }`}
                            >
                              {hasMaterials ? '🧱 Materials' : '+ Materials'}
                            </button>
                            {hasMaterials && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm sm:text-xs text-muted-foreground">£</span>
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  placeholder="0"
                                  value={item.materialsCostPounds || ''}
                                  onChange={(e) => handleUpdateLineItem(item.id, 'materialsCostPounds', parseFloat(e.target.value) || 0)}
                                  className="w-24 sm:w-20 h-10 sm:h-8 text-center text-base sm:text-sm bg-transparent border-handy-grid"
                                />
                              </div>
                            )}
                            {/* Phase 11 — collection toggle (schedule-only, no customer-facing charge) */}
                            <button
                              type="button"
                              title="Adds +30 min to the contractor's day. Customer doesn't see this — covered by materials markup."
                              onClick={() => setLineItems((prev) => prev.map((li) => li.id === item.id ? { ...li, requiresMaterialCollection: !li.requiresMaterialCollection } : li))}
                              className={`text-sm sm:text-xs px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full border transition-colors ${
                                item.requiresMaterialCollection
                                  ? 'border-handy-navy bg-handy-navy/10 text-handy-navy font-semibold'
                                  : 'border-handy-grid text-muted-foreground/60 hover:border-handy-navy/40'
                              }`}
                            >
                              {item.requiresMaterialCollection ? '🚐 Collection' : '+ Collection'}
                            </button>
                          </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add another job */}
                {lineItems.length > 0 && (
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-handy-grid text-sm text-muted-foreground hover:border-handy-yellow hover:text-handy-navy hover:bg-handy-cream transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add another job
                  </button>
                )}

                {/* Job description is auto-derived from line items in the submit handler */}

                {/* Live Engine Price Preview */}
                {lineItems.length > 0 && (
                  <>
                    <Separator />
                    {livePreviewLoading && !livePreview ? (
                      <div className="flex items-center justify-center gap-2 py-3">
                        <Loader2 className="w-4 h-4 animate-spin text-handy-yellow" />
                        <span className="text-sm text-muted-foreground">Calculating price...</span>
                      </div>
                    ) : livePreview ? (
                      <div className="space-y-2">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-handy-navy bg-handy-cream px-2 py-0.5 rounded">
                            Engine Breakdown
                          </span>
                          {livePreview.confidence && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${
                                livePreview.confidence === 'high'
                                  ? 'border-green-500/40 text-green-400'
                                  : livePreview.confidence === 'medium'
                                    ? 'border-handy-yellow text-handy-yellow'
                                    : 'border-red-500/40 text-red-400'
                              }`}
                            >
                              {livePreview.confidence} confidence
                            </Badge>
                          )}
                        </div>

                        {/* Per-line breakdown — always shown so the admin sees every line's number */}
                        <div className="space-y-1.5">
                          {livePreview.lineItems.map((li) => {
                            const lineTotal = li.guardedPricePence + (li.materialsWithMarginPence || 0);
                            return (
                              <div key={li.lineId} className="text-xs space-y-0.5">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-foreground/90 leading-snug flex-1 min-w-0">
                                    {li.description}
                                  </span>
                                  <span className="text-foreground font-semibold shrink-0 tabular-nums">
                                    £{(lineTotal / 100).toFixed(0)}
                                  </span>
                                </div>
                                {li.materialsWithMarginPence > 0 && (
                                  <div className="flex items-center justify-between gap-2 text-muted-foreground/60 text-[10px] pl-3">
                                    <span>labour £{(li.guardedPricePence / 100).toFixed(0)} · materials £{(li.materialsWithMarginPence / 100).toFixed(0)}</span>
                                  </div>
                                )}
                                {li.reasoning && (
                                  <p className="text-[10px] text-muted-foreground/60 leading-snug pl-3 italic">
                                    {li.reasoning}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <Separator className="my-2" />

                        {/* Subtotals */}
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center justify-between text-muted-foreground">
                            <span>Labour subtotal</span>
                            <span className="tabular-nums">£{(livePreview.subtotalPence / 100).toFixed(0)}</span>
                          </div>
                          {livePreview.totalMaterialsWithMarginPence > 0 && (
                            <div className="flex items-center justify-between text-muted-foreground">
                              <span>Materials (incl. 27% margin)</span>
                              <span className="tabular-nums">£{(livePreview.totalMaterialsWithMarginPence / 100).toFixed(0)}</span>
                            </div>
                          )}
                          {livePreview.batchDiscount.applied && (
                            <div className="flex items-start justify-between text-green-400">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium">Multi-job discount ({livePreview.batchDiscount.discountPercent}%)</div>
                                {livePreview.batchDiscount.reasoning && (
                                  <p className="text-[10px] text-green-400/70 italic leading-snug mt-0.5">
                                    {livePreview.batchDiscount.reasoning}
                                  </p>
                                )}
                              </div>
                              <span className="tabular-nums shrink-0 ml-2">−£{(livePreview.batchDiscount.savingsPence / 100).toFixed(0)}</span>
                            </div>
                          )}
                        </div>

                        {/* Final total — navy hero block (matches PDF brand) */}
                        <div className="flex items-center justify-between py-2.5 px-3 rounded-md bg-handy-navy mt-2 shadow-inner">
                          <span className="text-sm font-bold text-white">
                            Engine Total
                            {livePreviewLoading && <Loader2 className="w-3 h-3 animate-spin inline ml-1.5 text-handy-yellow" />}
                          </span>
                          <span className="text-2xl font-bold text-handy-yellow tabular-nums tracking-tight">
                            £{(livePreview.finalPricePence / 100).toFixed(0)}
                          </span>
                        </div>

                        {/* Guardrail flags */}
                        {(livePreview.guardrails?.floorTriggered || livePreview.guardrails?.ceilingTriggered || (livePreview.guardrails?.adjustments?.length ?? 0) > 0) && (
                          <div className="space-y-0.5 pt-1">
                            {livePreview.guardrails.floorTriggered && (
                              <p className="text-[10px] text-handy-yellow">⚠ Floor triggered on at least one line — price raised to margin floor.</p>
                            )}
                            {livePreview.guardrails.ceilingTriggered && (
                              <p className="text-[10px] text-handy-yellow">⚠ Ceiling triggered on at least one line — capped at 3× reference.</p>
                            )}
                          </div>
                        )}

                        <p className="text-[10px] text-muted-foreground/60 italic">
                          Live from contextual pricing engine — Layer 1 reference + Layer 3 LLM + Layer 4 guardrails.
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
            {/* ─── Section 5a: Optional Extras (AI suggestions + library + custom) ─── */}
            <Card className="overflow-hidden border-handy-grid shadow-sm">
              <CardHeader className="bg-handy-navy text-white px-4 sm:px-6 py-3 border-b-4 border-handy-yellow mb-3">
                <CardTitle className="text-base font-bold text-white tracking-tight flex items-center justify-between gap-2">
                  <span>Optional Extras</span>
                  <button
                    type="button"
                    onClick={() => fetchAiSuggestedExtras(true)}
                    disabled={aiSuggestionsLoading || lineItems.length === 0}
                    title="Re-suggest from current context"
                    aria-label="Refresh AI suggestions"
                    className="text-white/60 hover:text-handy-yellow disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${aiSuggestionsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </CardTitle>
                <p className="text-xs text-white/70 mt-1">
                  AI suggests context-relevant extras; you can also add a custom one-off below.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* AI Suggestions — context-driven, contextual to vaContext + jobs */}
                {(aiSuggestedExtras.length > 0 || aiSuggestionsLoading) && (
                  <div className="space-y-2">
                    <Label className="text-xs text-handy-yellow flex items-center gap-1.5">
                      <Wand2 className="w-3 h-3" />
                      AI suggestions
                      {aiSuggestionsLoading && <span className="text-[10px] text-muted-foreground/60 animate-pulse ml-1">thinking...</span>}
                    </Label>
                    {aiSuggestedExtras.length === 0 && aiSuggestionsLoading && (
                      <div className="text-[11px] text-muted-foreground/50 italic px-1">
                        Reading context + jobs...
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {aiSuggestedExtras.map((sug, idx) => {
                        const checked = optionalExtras.some(
                          (e) => !e.catalogId && e.label.toLowerCase() === sug.label.toLowerCase(),
                        );
                        return (
                          <label
                            key={`ai-${idx}`}
                            className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
                              checked
                                ? 'border-handy-yellow bg-handy-yellow/15'
                                : 'border-handy-yellow/30 bg-handy-cream hover:border-handy-yellow hover:bg-handy-yellow/15'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setOptionalExtras((prev) => [
                                    ...prev,
                                    {
                                      label: sug.label,
                                      description: sug.description,
                                      priceInPence: sug.priceInPence,
                                      badge: sug.badge ?? undefined,
                                    },
                                  ]);
                                } else {
                                  setOptionalExtras((prev) =>
                                    prev.filter(
                                      (x) => !(!x.catalogId && x.label.toLowerCase() === sug.label.toLowerCase()),
                                    ),
                                  );
                                }
                              }}
                              className="mt-0.5 w-4 h-4 rounded border-handy-grid bg-handy-bg accent-handy-yellow shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-foreground">{sug.label}</span>
                                {sug.badge && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-handy-yellow text-handy-yellow">
                                    {sug.badge}
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                                  £{Math.round(sug.priceInPence / 100)}
                                </span>
                              </div>
                              {sug.description && (
                                <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sug.description}</p>
                              )}
                              {sug.reasoning && (
                                <p className="text-[10px] text-handy-yellow/60 italic mt-0.5 flex items-start gap-1">
                                  <Wand2 className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                                  <span>{sug.reasoning}</span>
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Selected list (custom + picked) */}
                {optionalExtras.length > 0 && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <Label className="text-xs text-muted-foreground">Selected for this quote ({optionalExtras.length})</Label>
                    <div className="space-y-1.5">
                      {optionalExtras.map((extra, idx) => (
                        <div
                          key={`${extra.catalogId ?? 'custom'}-${idx}`}
                          className="flex items-start gap-2 rounded-lg border border-handy-grid bg-handy-bg/50 px-2.5 py-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">{extra.label}</span>
                              {extra.badge && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-handy-yellow text-handy-yellow">
                                  {extra.badge}
                                </Badge>
                              )}
                              {!extra.catalogId && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-handy-grid text-handy-muted">
                                  custom
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                                £{(extra.priceInPence / 100).toFixed(0)}
                              </span>
                            </div>
                            {extra.description && (
                              <p className="text-[11px] text-muted-foreground/70 mt-0.5">{extra.description}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setOptionalExtras((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-muted-foreground/40 hover:text-red-400 transition-colors p-1 -m-1 shrink-0"
                            aria-label="Remove extra"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add custom extra */}
                <div className="border-t border-border pt-3">
                  {!showCustomExtraForm ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCustomExtraForm(true)}
                      className="text-xs"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add custom extra
                    </Button>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-handy-yellow/40 bg-handy-cream p-3">
                      <Label className="text-xs text-handy-navy">New custom extra</Label>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Label</Label>
                        <Input
                          placeholder="e.g. Hallway clean-up"
                          value={customExtraDraft.label}
                          onChange={(e) => setCustomExtraDraft((d) => ({ ...d, label: e.target.value }))}
                          className="mt-1 h-10 text-base sm:h-8 sm:text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Description</Label>
                        <Textarea
                          placeholder="What's included…"
                          value={customExtraDraft.description}
                          onChange={(e) => setCustomExtraDraft((d) => ({ ...d, description: e.target.value }))}
                          rows={2}
                          className="mt-1 text-base sm:text-xs resize-none"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Price (£)</Label>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            placeholder="25"
                            value={customExtraDraft.pricePounds}
                            onChange={(e) => setCustomExtraDraft((d) => ({ ...d, pricePounds: e.target.value }))}
                            className="mt-1 h-10 text-base sm:h-8 sm:text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Badge (optional)</Label>
                          <Input
                            placeholder="Popular"
                            value={customExtraDraft.badge}
                            onChange={(e) => setCustomExtraDraft((d) => ({ ...d, badge: e.target.value }))}
                            className="mt-1 h-10 text-base sm:h-8 sm:text-xs"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => {
                            const label = customExtraDraft.label.trim();
                            const priceNum = parseFloat(customExtraDraft.pricePounds);
                            if (!label) {
                              toast({ title: 'Label required', description: 'Give the extra a label.', variant: 'destructive' });
                              return;
                            }
                            if (!Number.isFinite(priceNum) || priceNum < 0) {
                              toast({ title: 'Invalid price', description: 'Enter a valid £ amount.', variant: 'destructive' });
                              return;
                            }
                            setOptionalExtras((prev) => [
                              ...prev,
                              {
                                label,
                                description: customExtraDraft.description.trim(),
                                priceInPence: Math.round(priceNum * 100),
                                badge: customExtraDraft.badge.trim() || undefined,
                              },
                            ]);
                            setCustomExtraDraft({ label: '', description: '', pricePounds: '', badge: '' });
                            setShowCustomExtraForm(false);
                          }}
                        >
                          Add
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => {
                            setShowCustomExtraForm(false);
                            setCustomExtraDraft({ label: '', description: '', pricePounds: '', badge: '' });
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>


            {/* Old Section 4 removed — line items now in unified Jobs section above */}

            {/* Phase 20 — Customer Context card removed. Structured signals
                (customer type / area / urgency) now live inside Customer
                Details above; the legacy vaContext string is composed
                deterministically at submit time. */}

            {/* ─── Section 4c: Property Context (Phase 4b — drives scheduling, not pricing) ─── */}
            <Card className="overflow-hidden border-handy-grid shadow-sm">
              <CardHeader className="bg-handy-navy text-white px-4 sm:px-6 py-3 border-b-4 border-handy-yellow mb-3">
                <CardTitle className="text-base font-bold text-white tracking-tight">Property Context</CardTitle>
                <p className="text-xs text-white/70 mt-1">
                  Drives scheduling math — adds floor/parking/presence overhead. Doesn't change price.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Floor number</Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      placeholder="0 = ground"
                      value={floorNumber ?? ''}
                      onChange={(e) => setFloorNumber(e.target.value === '' ? null : parseInt(e.target.value) || 0)}
                      className="mt-1 h-10 text-base sm:h-8 sm:text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Lift in building?</Label>
                    <Select value={hasLift === null ? '__unset' : hasLift ? 'yes' : 'no'} onValueChange={(v) => setHasLift(v === '__unset' ? null : v === 'yes')}>
                      <SelectTrigger className="mt-1 h-10 text-base sm:h-8 sm:text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset">— unknown —</SelectItem>
                        <SelectItem value="yes">Yes (lift)</SelectItem>
                        <SelectItem value="no">No lift</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Parking</Label>
                    <Select value={parkingDistance ?? '__unset'} onValueChange={(v) => setParkingDistance(v === '__unset' ? null : v as any)}>
                      <SelectTrigger className="mt-1 h-10 text-base sm:h-8 sm:text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset">— unknown —</SelectItem>
                        <SelectItem value="on_drive">On their drive</SelectItem>
                        <SelectItem value="street_outside">Street, just outside</SelectItem>
                        <SelectItem value="street_within_50m">Street, within 50m</SelectItem>
                        <SelectItem value="50m_plus">Further than 50m</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Customer present?</Label>
                    <Select value={customerPresent === null ? '__unset' : customerPresent ? 'yes' : 'no'} onValueChange={(v) => setCustomerPresent(v === '__unset' ? null : v === 'yes')}>
                      <SelectTrigger className="mt-1 h-10 text-base sm:h-8 sm:text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset">— unknown —</SelectItem>
                        <SelectItem value="yes">Will be on site</SelectItem>
                        <SelectItem value="no">Won't be present</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>


            {/* ─── Section 5a: Contractor fit (informational only — system auto-assigns at reserve time) ─── */}
            <ContractorFitPanel
              categorySlugs={lineItems.map(li => li.category)}
              coordinates={coordinates}
              requiredDays={liveRequiredDays}
            />


            {/* ─── Section 6: Preview + Generate (brand CTAs — preview outline-navy, generate navy-primary) ─── */}
            {/* Stack full-width on mobile (the two labels can't fit one row < 380px); side-by-side on sm+. */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:flex-1 h-12 text-base font-semibold border-handy-navy/30 text-handy-navy hover:bg-handy-navy/5"
                onClick={() => setDraftPreviewOpen(true)}
                disabled={!canGenerate || !livePreview}
                title={!livePreview ? 'Wait for live pricing to compute' : 'Preview without saving'}
              >
                <Eye className="w-5 h-5 mr-2" />
                Preview
              </Button>
              <Button
                size="lg"
                className="w-full sm:flex-1 h-12 text-base font-semibold bg-handy-navy hover:bg-handy-navy/90 text-white shadow-sm hover:shadow disabled:bg-handy-navy/40"
                onClick={handleGenerate}
                disabled={!canGenerate || createQuoteMutation.isPending}
              >
                {createQuoteMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating Quote...
                  </>
                ) : (
                  <>
                    Generate Quote
                    <span className="ml-2 inline-block h-2 w-2 rounded-full bg-handy-yellow" aria-hidden />
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {/* ─── Section 7: Results ─── */}
        {quoteResult && (
          <div className="space-y-4">
            {/* Human Review Banner */}
            {quoteResult.messaging.requiresHumanReview && (
              <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4">
                <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-yellow-400">AI couldn't fully parse this job. Please review details before sending.</p>
                  {quoteResult.messaging.reviewReason && (
                    <p className="text-xs text-yellow-400/80 mt-1">Reason: {quoteResult.messaging.reviewReason}</p>
                  )}
                </div>
              </div>
            )}

            {/* \u2500\u2500\u2500 Quote Summary (handy-services-pdf "Recommended Box" pattern: cream bg + thick yellow left edge) \u2500\u2500\u2500 */}
            <Card className="relative border border-handy-yellow/60 bg-handy-cream overflow-hidden shadow-sm">
              {/* 4px yellow left edge \u2014 mirrors PDF skill recommended-box LINEAFTER style */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-handy-yellow" aria-hidden />
              <CardContent className="pt-6 space-y-4 pl-5">
                {/* Headline */}
                <div className="text-center">
                  <h2 className="text-xl font-bold text-handy-navy tracking-tight">{quoteResult.messaging.headline}</h2>
                  <div className="mt-2">
                    <Badge
                      variant="outline"
                      className={
                        quoteResult.messaging.layoutTier === 'quick'
                          ? 'border-handy-navy/40 text-handy-navy bg-white'
                          : quoteResult.messaging.layoutTier === 'standard'
                          ? 'border-handy-yellow/60 text-handy-navy bg-white'
                          : 'border-handy-navy text-white bg-handy-navy'
                      }
                    >
                      {quoteResult.messaging.layoutTier.charAt(0).toUpperCase() + quoteResult.messaging.layoutTier.slice(1)} Quote
                    </Badge>
                  </div>
                </div>

                {/* Total Price \u2014 navy hero block (mirrors PDF hero) */}
                <div className="bg-handy-navy rounded-lg p-4 text-center shadow-inner">
                  <div className="text-[10px] text-handy-yellow uppercase font-bold tracking-widest mb-1">Total Price</div>
                  <div className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                    {quoteResult.pricing.totalFormatted}
                  </div>
                </div>

                {/* Line Item Breakdown */}
                {quoteResult.pricing.lineItems.length > 1 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-handy-navy font-bold uppercase tracking-widest">Breakdown</div>
                    {quoteResult.pricing.lineItems.map((li) => (
                      <div key={li.lineId} className="flex items-center justify-between text-sm bg-white/70 border border-handy-grid/60 rounded px-3 py-1.5">
                        <span className="text-handy-navy truncate mr-3">{li.description}</span>
                        <span className="text-handy-navy font-semibold shrink-0">
                          {"\u00A3"}{(li.guardedPricePence / 100).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Batch Discount */}
                {quoteResult.pricing.batchDiscount.applied && (
                  <div className="flex items-center justify-between text-sm bg-green-500/10 rounded px-3 py-1.5 border border-green-500/30">
                    <span className="text-green-700 font-medium">
                      Batch discount ({quoteResult.pricing.batchDiscount.discountPercent}%)
                    </span>
                    <span className="text-green-700 font-semibold">
                      -{"\u00A3"}{(quoteResult.pricing.batchDiscount.savingsPence / 100).toFixed(0)}
                    </span>
                  </div>
                )}

                {/* Booking Modes */}
                <div className="flex flex-wrap gap-1.5">
                  {quoteResult.messaging.bookingModes.map((mode) => (
                    <Badge key={mode} variant="secondary" className="text-xs bg-white text-handy-navy border border-handy-grid">
                      {mode.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* WhatsApp Send Section */}
            <Card className="overflow-hidden border-handy-grid shadow-sm">
              <CardHeader className="bg-handy-navy text-white px-4 sm:px-6 py-3 border-b-4 border-handy-yellow mb-3">
                <CardTitle className="text-base font-bold text-handy-navy tracking-tight flex items-center gap-2">
                  <FaWhatsapp className="w-4 h-4 text-green-500" />
                  WhatsApp Message
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">

                {/* Message Preview (WhatsApp bubble style) */}
                <div className="bg-[#1a2e1a] rounded-lg p-3 sm:p-4 border border-green-800/30">
                  <div className="text-sm text-green-100/90 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                    {quoteResult.whatsappMessage}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    onClick={handleSendWhatsApp}
                    className="w-full sm:flex-1 bg-green-600 hover:bg-green-700 h-11 text-sm font-semibold"
                  >
                    <FaWhatsapp className="w-4 h-4 mr-2" />
                    Send via WhatsApp
                  </Button>
                  <Button variant="outline" onClick={handleCopyMessage} className="sm:flex-1 h-10">
                    {copiedMessage ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                    Copy Message
                  </Button>
                  <Button variant="outline" onClick={handleCopyLink} className="sm:flex-1 h-10">
                    {copiedLink ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                    Copy Quote Link
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Quote Link */}
            <div className="flex items-center gap-2 bg-muted rounded-lg p-2.5 border border-border">
              <input
                type="text"
                value={quoteResult.quoteUrl}
                readOnly
                className="flex-1 bg-transparent text-xs sm:text-sm font-mono truncate text-foreground min-w-0"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="shrink-0"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(quoteResult.quoteUrl, '_blank')}
                className="shrink-0"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>

            {/* Preview + Reset buttons */}
            <div className="flex gap-2 mt-1">
              <Button
                variant="outline"
                onClick={() => setPreviewOpen(true)}
                className="flex-1 h-9 text-sm border-handy-navy/30 text-handy-navy hover:bg-handy-navy/5"
              >
                <Eye className="w-4 h-4 mr-1.5" />Preview & Edit
              </Button>
              <Button variant="ghost" onClick={handleReset} className="flex-1 h-9 text-sm text-handy-muted hover:text-handy-navy hover:bg-handy-navy/5">
                New Quote
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Quote Preview Modal */}
      {quoteResult && (
        <QuotePreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          quote={{
            quoteId: quoteResult.quoteId,
            shortSlug: quoteResult.shortSlug,
            customerName: customerName,
            phone: phone,
            email: null,
            address: null,
            postcode: postcode || null,
            basePrice: quoteResult.pricing.totalPence,
            pricingLineItems: quoteResult.pricing.lineItems as any,
            availableDates: availableDates.length > 0 ? availableDates : null,
          } satisfies PreviewQuote}
        />
      )}

      {/* Phase 15 — Draft Preview Dialog (renders from live pricing — no DB write) */}
      <Dialog open={draftPreviewOpen} onOpenChange={setDraftPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Quote Preview (draft)</DialogTitle>
            <DialogDescription>
              Customer-facing summary based on the current builder state. Not saved yet — click "Generate Quote" to commit.
            </DialogDescription>
          </DialogHeader>
          {livePreview ? (
            <div className="space-y-4">
              {/* Customer */}
              <div className="rounded-lg border border-handy-grid bg-handy-bg/60 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Customer</div>
                <div className="text-sm">{customerName || '—'}</div>
                <div className="text-xs text-muted-foreground">{phone} · {postcode || 'no postcode'}</div>
              </div>

              {/* Headline — handy-services-pdf recommended-box pattern */}
              {livePreview.messaging?.contextualHeadline && (
                <div className="relative rounded-lg border border-handy-yellow/60 bg-handy-cream p-3 pl-4 overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-handy-yellow" aria-hidden />
                  <div className="text-[10px] uppercase tracking-widest text-handy-navy font-bold mb-1">Headline</div>
                  <div className="text-lg font-bold text-handy-navy">{livePreview.messaging.contextualHeadline}</div>
                  {livePreview.messaging.contextualMessage && (
                    <div className="text-sm text-handy-muted mt-1">{livePreview.messaging.contextualMessage}</div>
                  )}
                </div>
              )}

              {/* Line items */}
              <div className="rounded-lg border border-handy-grid bg-handy-bg/60 overflow-hidden">
                <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b border-handy-grid">Line items</div>
                <div className="divide-y divide-handy-grid">
                  {livePreview.lineItems.map((li: any) => (
                    <div key={li.lineId} className="px-3 py-2 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{li.description}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {li.category} · {li.timeEstimateMinutes}min
                          {li.materialsWithMarginPence > 0 ? ` · +£${(li.materialsWithMarginPence / 100).toFixed(0)} materials` : ''}
                        </div>
                      </div>
                      <div className="text-sm font-semibold whitespace-nowrap">
                        £{((li.guardedPricePence + (li.materialsWithMarginPence || 0)) / 100).toFixed(0)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total — navy hero block */}
              <div className="rounded-lg bg-handy-navy p-3 flex items-center justify-between shadow-inner">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-handy-yellow font-bold">Total</div>
                  <div className="text-2xl font-bold text-white tracking-tight">£{(livePreview.finalPricePence / 100).toFixed(0)}</div>
                </div>
                {livePreview.batchDiscount?.discountPercent ? (
                  <div className="text-xs text-handy-yellow font-semibold">−{livePreview.batchDiscount.discountPercent}% batch discount</div>
                ) : null}
              </div>

              {/* Value bullets preview */}
              {Array.isArray(livePreview.messaging?.valueBullets) && livePreview.messaging.valueBullets.length > 0 && (
                <div className="rounded-lg border border-handy-grid bg-handy-bg/60 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Value bullets</div>
                  <ul className="space-y-1 text-sm">
                    {livePreview.messaging.valueBullets.map((b: string, i: number) => (
                      <li key={i} className="flex items-start gap-2"><span className="text-emerald-400">✓</span><span>{b}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="ghost" className="flex-1 text-handy-muted hover:text-handy-navy hover:bg-handy-navy/5" onClick={() => setDraftPreviewOpen(false)}>Close & Edit</Button>
                <Button className="flex-1 bg-handy-navy hover:bg-handy-navy/90 text-white shadow-sm" onClick={() => { setDraftPreviewOpen(false); handleGenerate(); }} disabled={createQuoteMutation.isPending}>
                  {createQuoteMutation.isPending ? 'Generating…' : (<>Generate Quote<span className="ml-2 inline-block h-2 w-2 rounded-full bg-handy-yellow" aria-hidden /></>)}
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-6 text-center">Live pricing not ready yet — wait a moment then reopen.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
