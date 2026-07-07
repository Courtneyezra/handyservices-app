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
  Undo2,
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
  Camera,
  X,
} from 'lucide-react';
import { format as formatDate, getDaysInMonth, getDay, startOfMonth } from 'date-fns';
import { QuotePreviewModal } from '@/components/quote/QuotePreviewModal';
import type { PreviewQuote } from '@/components/quote/QuotePreviewModal';
import { LinkedCallChip, type LinkedCallSummary } from '@/components/quote/LinkedCallChip';
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
  PriceBuckets,
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
  /** Customer-page checklist per line — each string follows "Head — detail" (em dash). Takes precedence over `details` on the customer page. */
  scopeSteps?: string[];
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
  /**
   * Track B — advisory SKU suggestion from the keyword matcher, carried from
   * the parse-job response. Surfaced as a one-tap "Accept" chip on a custom
   * line; accepting flips the line to a priced SKU line exactly like a manual
   * pick (via handleAcceptSuggestion → handlePickSkuForLine). Pricing never
   * reads these — only a confirmed skuCode — so a surfaced-but-unaccepted
   * suggestion can't change a price.
   */
  suggestedSkuCode?: string;
  suggestedSkuConfidence?: 'high' | 'medium' | 'low';
  /** Full catalog row backing the suggestion, so Accept needs no extra fetch. */
  suggestedSku?: CatalogSku;
  /**
   * Two-rail split — explicit per-line overrides that WIN downstream over the
   * source default (SKU catalog value or reference-rate derivation). The rails
   * stay independent: setting a price never touches the time, setting a time
   * never touches the price.
   *
   *  - SKU line:  price/time inputs pre-fill from the catalog; typing sets the
   *    matching override (the other rail keeps its catalog value). A one-tap
   *    reset clears that rail's override back to the catalog default.
   *  - Custom line: the time input writes BOTH estimatedMinutes and
   *    timeOverrideMinutes (so the shown time always wins); the price input is
   *    empty ("auto") and only sets priceOverridePence once typed.
   *
   * Sent on each request line iff defined (omitted when unset).
   */
  priceOverridePence?: number;
  timeOverrideMinutes?: number;
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
    priceBuckets?: PriceBuckets | null;
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
// TwoRailEditor — per-line independent PRICE (£) + TIME (min) rails
//
// Two rails that never move each other: editing the price never changes the
// time and vice-versa. Used on every line row.
//
//  - SKU line:  both rails pre-fill from the catalog. Typing sets that rail's
//    override; a subtle "edited" pill + one-tap reset clears it back to catalog.
//  - Custom line: TIME shows the live estimate; PRICE starts empty ("auto") and
//    only carries a value once typed.
//
// Bold + high-contrast by design — the owner wants the two rails legible per
// line, not hidden behind subtle tints.
// ---------------------------------------------------------------------------

// Materials £ input holding the raw typed string locally. Round-tripping every
// keystroke through parseFloat snaps the field back mid-edit (clearing it, or
// typing "12." on a phone, re-renders as 0/"") — the draft only syncs back to
// the committed number when the field isn't focused.
function MaterialsCostInput({
  value,
  onCommit,
  onFocus,
  autoFocus,
}: {
  value: number;
  onCommit: (pounds: number) => void;
  onFocus?: () => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState<string>(value > 0 ? String(value) : '');
  const focusedRef = useRef(false);

  // Sync external changes (draft restore, SKU pick, toggle-off) while idle.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value > 0 ? String(value) : '');
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      placeholder="0"
      autoFocus={autoFocus}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
        onFocus?.();
      }}
      onBlur={() => {
        focusedRef.current = false;
        setDraft(value > 0 ? String(value) : '');
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.]/g, '');
        setDraft(raw);
        const parsed = parseFloat(raw);
        onCommit(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
      }}
      className="w-24 sm:w-20 h-10 sm:h-8 text-center text-base sm:text-sm bg-transparent border-handy-grid"
    />
  );
}

function TwoRailEditor({
  /** £ shown in the price field. For "auto" (custom, unset) pass null. */
  priceValuePence,
  pricePlaceholder = 'auto',
  /** Live engine-derived "auto" price. When no manual price is set this is shown
   *  as a muted ghost in the Price box and tracks the time rail in real time.
   *  Display-only — it never becomes the input value, so a typed price still wins
   *  and the two-rail contract (price edit ⇎ time edit) is preserved. */
  ghostPricePence = null,
  priceEdited = false,
  onPriceChange,
  onPriceReset,
  /** Minutes shown in the time field. */
  timeValueMinutes,
  timeEdited = false,
  onTimeChange,
  onTimeReset,
}: {
  priceValuePence: number | null;
  pricePlaceholder?: string;
  ghostPricePence?: number | null;
  priceEdited?: boolean;
  onPriceChange: (poundsStr: string) => void;
  onPriceReset?: () => void;
  timeValueMinutes: number;
  timeEdited?: boolean;
  onTimeChange: (minutes: number) => void;
  onTimeReset?: () => void;
}) {
  const step = getStep(timeValueMinutes);
  const priceStr = priceValuePence != null ? String(Math.round(priceValuePence / 100)) : '';
  // Ghost = the live "auto" price (engine-derived), shown only while the quoter
  // hasn't typed a manual price. It updates as the time rail moves so the price
  // box reacts to time live — but it stays a placeholder, never the value.
  const showGhost = priceValuePence == null && ghostPricePence != null && ghostPricePence > 0;
  const effectivePlaceholder = showGhost
    ? String(Math.round(ghostPricePence / 100))
    : pricePlaceholder;

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* ── PRICE rail ────────────────────────────────────────────────── */}
      <div className="rounded-lg border-2 border-handy-navy/15 bg-white px-2.5 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-handy-navy/60">
            Price
          </span>
          {priceEdited ? (
            <button
              type="button"
              onClick={onPriceReset}
              title="Reset to catalog price"
              className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-handy-yellow hover:text-handy-navy transition-colors"
            >
              <RefreshCw className="w-2.5 h-2.5" /> edited
            </button>
          ) : showGhost ? (
            <span
              title="Auto-calculated from the time estimate — updates live as you change the time. Type to override."
              className="text-[9px] font-bold uppercase tracking-wide text-handy-navy/35"
            >
              auto
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-lg font-bold text-handy-navy leading-none">£</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={priceStr}
            placeholder={effectivePlaceholder}
            onChange={(e) => onPriceChange(e.target.value)}
            className="w-full bg-transparent border-0 p-0 text-lg font-bold text-handy-navy tabular-nums leading-none focus:outline-none focus:ring-0 placeholder:text-handy-muted/50 placeholder:font-medium placeholder:text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="Line price in pounds"
          />
        </div>
      </div>

      {/* ── TIME rail ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border-2 border-handy-navy/15 bg-white px-2.5 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-handy-navy/60 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Time
          </span>
          {timeEdited && (
            <button
              type="button"
              onClick={onTimeReset}
              title="Reset to catalog time"
              className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-handy-yellow hover:text-handy-navy transition-colors"
            >
              <RefreshCw className="w-2.5 h-2.5" /> edited
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <button
            type="button"
            onClick={() => onTimeChange(Math.max(15, timeValueMinutes - step))}
            className="h-7 w-7 rounded-md border border-handy-grid bg-white text-sm font-bold text-handy-navy hover:bg-handy-navy/5 active:scale-95 transition-transform flex items-center justify-center shrink-0"
            aria-label="Decrease time"
          >
            −
          </button>
          <div className="flex-1 text-center text-base font-bold text-handy-navy tabular-nums leading-none whitespace-nowrap">
            {formatTimeLabel(timeValueMinutes)}
          </div>
          <button
            type="button"
            onClick={() => onTimeChange(timeValueMinutes + step)}
            className="h-7 w-7 rounded-md border border-handy-grid bg-white text-sm font-bold text-handy-navy hover:bg-handy-navy/5 active:scale-95 transition-transform flex items-center justify-center shrink-0"
            aria-label="Increase time"
          >
            +
          </button>
        </div>
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

// Labour-only estimate (reference rate × time, floored at the category minimum).
// Mirrors the engine's guardedPricePence semantics — what a manual price override
// would replace — so it's the right instant fallback for the per-line "auto" ghost
// before the first live preview resolves. (Excludes contingency, which the client
// can't see; the buffered engine number replaces it the moment the preview lands.)
function estimateLineLabourPence(item: LineItem): number {
  const rate = CATEGORY_RATES[item.category] || CATEGORY_RATES.other;
  const timeBased = Math.round((rate.hourly / 60) * item.estimatedMinutes);
  return Math.max(timeBased, rate.min);
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

// Normalize a phone number for storage. Numbers copy-pasted from iOS arrive
// wrapped in invisible Unicode direction marks (U+202A…U+202C) with non-breaking
// spaces — they look fine on screen but break SMS/WhatsApp matching downstream.
// Strips all invisible characters and whitespace, then converts UK national
// format (07…) to E.164 (+447…).
function normalizePhoneInput(raw: string): string {
  let cleaned = raw
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  if (/^07\d{9}$/.test(cleaned)) cleaned = `+44${cleaned.slice(1)}`;
  if (/^447\d{9}$/.test(cleaned)) cleaned = `+${cleaned}`;
  // "+44 (0)7878…" — UK numbers never carry the trunk 0 after the country code.
  cleaned = cleaned.replace(/^\+440/, '+44');
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight checks — guardrails that intercept Generate when the quote has
// quality gaps Ben would otherwise have to remember to check. High-ticket
// quotes close at a fraction of the rate of small ones; thin line items are a
// known driver, so the system catches them at the moment of generation.
// ─────────────────────────────────────────────────────────────────────────────

/** A line at/above this (labour + materials) should carry a customer-facing detail. */
const HIGH_TICKET_LINE_PENCE = 25_000;
/** A quote at/above this is high-ticket: all lines should carry details + photos expected. */
const HIGH_TICKET_TOTAL_PENCE = 50_000;
/** Effective labour rate sanity band. Below floor = likely mispriced time/price rail. */
const RATE_FLOOR_PENCE_PER_HOUR = 3_500;
const RATE_CEILING_PENCE_PER_HOUR = 12_000;

interface DuplicateQuoteSummary {
  shortSlug: string;
  customerName: string;
  basePricePence: number | null;
  createdAt: string | null;
  viewed: boolean;
}

type PreflightIssue =
  | { kind: 'details'; lineIds: string[] }
  | { kind: 'photos' }
  | { kind: 'rate'; lines: { lineId: string; description: string; ratePerHourPence: number; direction: 'low' | 'high' }[] }
  | { kind: 'duplicate'; duplicates: DuplicateQuoteSummary[] };

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
  { value: 'oap_homeowner', label: 'OAP Homeowner (Elderly)', emoji: '👴' },
  { value: 'landlord', label: 'Landlord', emoji: '🔑' },
  { value: 'property_manager', label: 'Property Manager', emoji: '🏢' },
  { value: 'tenant', label: 'Tenant', emoji: '👤' },
  { value: 'business', label: 'Business / Commercial', emoji: '💼' },
  { value: 'letting_agent', label: 'Letting Agent', emoji: '🗂️' },
] as const;
type CustomerType = (typeof CUSTOMER_TYPES)[number]['value'];

// WhatsApp message tone options (mirror server quote-message.ts). Default is derived from
// customer type; the operator can override per quote. 'delay' opens with an apology.
const MESSAGE_STYLE_OPTIONS = [
  { value: 'friendly', label: 'Friendly — warm & casual' },
  { value: 'professional', label: 'Professional — businesslike' },
  { value: 'efficient', label: 'Hands-off — landlords/agents' },
  { value: 'reassuring', label: 'Reassuring — no surprises' },
  { value: 'delay', label: 'Apology for delay' },
] as const;
function defaultMessageStyle(ct: string): string {
  if (ct === 'business') return 'professional';
  if (ct === 'landlord' || ct === 'property_manager' || ct === 'letting_agent') return 'efficient';
  if (ct === 'tenant' || ct === 'oap_homeowner') return 'reassuring';
  return 'friendly';
}

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
  // WhatsApp message tone. '' = auto (derive from customer type server-side). 'delay' reveals a reason field.
  const [messageStyle, setMessageStyle] = useState<string>('');
  const [delayReason, setDelayReason] = useState('');

  // ── Property context (Phase 4b — drives scheduling math, not pricing) ──
  const [floorNumber, setFloorNumber] = useState<number | null>(null);
  const [hasLift, setHasLift] = useState<boolean | null>(null);
  const [parkingDistance, setParkingDistance] = useState<'on_drive' | 'street_outside' | 'street_within_50m' | '50m_plus' | null>(null);
  const [customerPresent, setCustomerPresent] = useState<boolean | null>(null);

  // ── Customer-supplied job photos (shown on the customer quote page) ──
  const [customerPhotos, setCustomerPhotos] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

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

  // ── Source-call linking (quote → originating call attribution) ──
  // linkedCall drives the chip next to the phone field and the sourceCallId
  // sent on create. Set three ways: ?fromCallId= handoff from CallReviewPage,
  // recent-caller card click, or the phone-number auto-match below.
  const [linkedCall, setLinkedCall] = useState<LinkedCallSummary | null>(null);
  // Normalized phone the admin explicitly unlinked via the chip's [×] —
  // suppresses auto-match for that number and marks the quote as
  // sourceChannel='whatsapp' on submit (no call behind it).
  const [unlinkedPhone, setUnlinkedPhone] = useState<string | null>(null);
  // Phone field debounced 600ms for the recent-calls lookup.
  const [debouncedPhone, setDebouncedPhone] = useState('');

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
  // Lines whose materials £ field is open. Visibility used to be inferred from
  // cost > 0, which unmounted the input (and dismissed the mobile keyboard)
  // the instant the admin cleared the field to type a multi-digit amount.
  const [materialsOpenIds, setMaterialsOpenIds] = useState<Set<string>>(new Set());
  const categoryGuessedIds = useRef<Set<string>>(new Set());

  // ── Decomposed pricing (admin eval/preview) ──
  // Per-quote switch to compute the structural cost buckets (attendance / travel
  // / collection) even while the global setting is off. Does NOT change live
  // customer pricing — only this one generated quote.
  const [previewDecomposed, setPreviewDecomposed] = useState(false);
  const [previewTravelMiles, setPreviewTravelMiles] = useState('');

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

  // Live engine labour price per line, keyed by lineId — feeds the per-line "auto"
  // ghost in each Price box so it tracks the time rail in real time. We key on
  // guardedPricePence (labour) because that's exactly what a manual price override
  // replaces, so the ghost shows the apples-to-apples auto price the customer would
  // pay for that line's labour (already includes any reference contingency).
  const livePriceByLineId = useMemo(() => {
    const m = new Map<string, number>();
    for (const li of livePreview?.lineItems ?? []) {
      if (typeof li.guardedPricePence === 'number') m.set(li.lineId, li.guardedPricePence);
    }
    return m;
  }, [livePreview]);
  const livePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLivePreview = useCallback(async (items: LineItem[], sigs: ContextSignals, enrichedContext?: string, decomposed?: boolean, travelMiles?: number) => {
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
            // Two-rail overrides — only when set; each wins independently.
            ...(li.priceOverridePence !== undefined ? { priceOverridePence: li.priceOverridePence } : {}),
            ...(li.timeOverrideMinutes !== undefined ? { timeOverrideMinutes: li.timeOverrideMinutes } : {}),
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
          // Decomposed-pricing draft preview (admin eval) — mirrors the toggle.
          ...(decomposed
            ? {
                previewDecomposed: true,
                ...(travelMiles && travelMiles > 0 ? { travelDistanceMiles: travelMiles } : {}),
              }
            : {}),
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
      fetchLivePreview(lineItems, signals, buildStructuredVaContext(), previewDecomposed, Number(previewTravelMiles) || 0);
    }, 600);
    return () => {
      if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    };
  }, [lineItems, signals, buildStructuredVaContext, fetchLivePreview, previewDecomposed, previewTravelMiles]);

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
  // Source-call linking — prefill handoff + phone auto-match
  // ═══════════════════════════════════════════════════════════════════════════

  // Prefill from query params (CallReviewPage / Call Performance "Build quote"
  // handoff): ?fromCallId=<id>&phone=<raw>&name=<name>&job=<summary>. Runs once
  // on mount; the chip is enriched with time/duration by the lookup below.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromCallId = params.get('fromCallId');
    const qpPhone = params.get('phone');
    const qpName = params.get('name');
    const qpJob = params.get('job');
    if (qpName) setCustomerName(qpName);
    if (qpPhone) setPhone(normalizePhoneInput(qpPhone));
    if (qpJob) {
      setJobDescription(qpJob);
      // Mirror the recent-caller card flow: parse the call's job summary into
      // line items so the handoff lands ready to price, not just annotated.
      if (qpJob.trim().length > 5) parseJobMutation.mutate(qpJob.trim());
    }
    if (fromCallId) {
      setLinkedCall({ id: fromCallId, customerName: qpName, jobSummary: qpJob });
    }
  }, []);

  // Debounce the phone field 600ms before hitting the recent-calls lookup.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPhone(normalizePhoneInput(phone)), 600);
    return () => clearTimeout(t);
  }, [phone]);

  // Recent calls for this number (14-day window, newest first). Enabled for
  // any plausible number — even when already linked — so the chip's switcher
  // can list alternative calls.
  const debouncedPhoneDigits = debouncedPhone.replace(/\D/g, '');
  const { data: recentCallMatches } = useQuery<LinkedCallSummary[]>({
    queryKey: ['recent-calls-by-phone', debouncedPhone],
    queryFn: async () => {
      const res = await fetch(
        `/api/calls/recent-by-phone?phone=${encodeURIComponent(debouncedPhone)}&days=14`,
        { headers: getAuthHeaders() },
      );
      if (!res.ok) throw new Error('Failed to fetch recent calls');
      const data = await res.json();
      return data?.calls ?? [];
    },
    enabled: debouncedPhoneDigits.length >= 10,
    staleTime: 30_000,
  });

  // Auto-link the newest matching call (WhatsApp-lead safety net) — unless a
  // call is already linked or the admin explicitly unlinked this number.
  useEffect(() => {
    if (!recentCallMatches || recentCallMatches.length === 0) return;
    if (linkedCall) {
      // Linked via ?fromCallId= (no startTime yet) — enrich from the lookup.
      if (!linkedCall.startTime) {
        const found = recentCallMatches.find((c) => c.id === linkedCall.id);
        if (found) setLinkedCall(found);
      }
      return;
    }
    if (unlinkedPhone === debouncedPhone) return;
    setLinkedCall(recentCallMatches[0]);
  }, [recentCallMatches, linkedCall, unlinkedPhone, debouncedPhone]);

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
        // Track B — carry the advisory SKU suggestion through so the line's
        // review row can offer one-tap Accept. The full row arrives as the
        // server's catalog shape; the client reads only CatalogSku fields.
        suggestedSkuCode: line.suggestedSkuCode,
        suggestedSkuConfidence: line.suggestedSkuConfidence,
        suggestedSku: line.suggestedSku as CatalogSku | undefined,
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
    // items is passed explicitly (not read from state) so the pre-flight modal
    // can generate with just-approved line details without a stale-closure race.
    mutationFn: async ({ enrichedVaContext, items }: { enrichedVaContext?: string; items: LineItem[] }): Promise<QuoteResult> => {
      const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
      const res = await fetch('/api/pricing/create-contextual-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          customerName,
          phone: normalizePhoneInput(phone),
          email: email || undefined,
          address: address || undefined,
          postcode: postcode || undefined,
          coordinates: coordinates || undefined,
          jobDescription: jobDescription || items.map(li => li.description).filter(Boolean).join(', ') || undefined,
          lines: items.map((li) => ({
            id: li.id,
            description: li.description,
            category: li.category,
            estimatedMinutes: li.estimatedMinutes,
            materialsCostPence: Math.round(li.materialsCostPounds * 100) || 0,
            details: li.details ?? null,
            scopeSteps: (li.scopeSteps && li.scopeSteps.filter(s => s.trim()).length > 0) ? li.scopeSteps.filter(s => s.trim()) : null,
            fixedTier: li.fixedTier ?? null,
            requiresMaterialCollection: !!li.requiresMaterialCollection,
            // Phase 25c — SKU fields persist through to the server's
            // catalog short-circuit path.
            source: li.source,
            ...(li.skuCode ? { skuCode: li.skuCode } : {}),
            ...(li.unitCount !== undefined ? { unitCount: li.unitCount } : {}),
            ...(li.selectedTier ? { selectedTier: li.selectedTier } : {}),
            // Two-rail overrides — only when set; each wins independently over
            // the catalog/reference default downstream.
            ...(li.priceOverridePence !== undefined ? { priceOverridePence: li.priceOverridePence } : {}),
            ...(li.timeOverrideMinutes !== undefined ? { timeOverrideMinutes: li.timeOverrideMinutes } : {}),
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
          messageStyle: messageStyle || undefined,
          delayReason: messageStyle === 'delay' ? (delayReason.trim() || undefined) : undefined,
          sourceCallId: linkedCall?.id || selectedCallerId || undefined,
          // Only claim 'whatsapp' when the admin explicitly unlinked a matched
          // call — otherwise omit and let the server/backfill decide.
          ...(!linkedCall && !selectedCallerId && unlinkedPhone
            ? { sourceChannel: 'whatsapp' as const }
            : {}),
          contractorId: selectedContractorId || undefined,
          createdBy: adminUser?.id || undefined,
          createdByName: adminUser?.name || adminUser?.email || undefined,
          availableDates,
          customerPhotoUrls: customerPhotos.length > 0 ? customerPhotos : undefined,
          // Decomposed-pricing preview (admin eval) — only when toggled on.
          ...(previewDecomposed
            ? {
                previewDecomposed: true,
                ...(previewTravelMiles && Number(previewTravelMiles) > 0
                  ? { travelDistanceMiles: Number(previewTravelMiles) }
                  : {}),
              }
            : {}),
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

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = 10 - customerPhotos.length;
    if (remaining <= 0) {
      toast({ title: 'Photo limit reached', description: 'Max 10 photos per quote.', variant: 'destructive' });
      return;
    }
    const selected = Array.from(files).slice(0, remaining);
    setUploadingPhotos(true);
    try {
      const formData = new FormData();
      selected.forEach((f) => formData.append('files', f));
      const res = await fetch('/api/pricing/quote-photos', {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
      }
      const data = await res.json();
      setCustomerPhotos((prev) => [...prev, ...data.urls]);
    } catch (e) {
      toast({ title: 'Photo upload failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' });
    } finally {
      setUploadingPhotos(false);
    }
  };

  const handleSelectCaller = (caller: RecentCaller, mode: 'all' | 'customer') => {
    setSelectedCallerId(caller.id);
    // Picking a caller card IS an explicit link — sync the chip and clear any
    // earlier unlink so the auto-match doesn't fight the selection.
    setLinkedCall({
      id: caller.id,
      startTime: caller.calledAt,
      customerName: caller.customerName,
      jobSummary: caller.jobSummary,
    });
    setUnlinkedPhone(null);
    setCustomerName(caller.customerName || '');
    setPhone(normalizePhoneInput(caller.phone || ''));
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

  // Scope steps are a string[] so they don't fit handleUpdateLineItem's
  // string|number signature — dedicated setter keeps the call sites tidy.
  const handleUpdateLineScopeSteps = (id: string, steps: string[]) => {
    setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, scopeSteps: steps } : li)));
  };

  // Track which items are being polished + their original text (before polish)
  const [polishingIds, setPolishingIds] = useState<Set<string>>(new Set());
  // Override for aggressive polish: when a polish rewrites a title we keep the
  // admin's original so a one-tap "Keep what I typed" can restore it. `kept`
  // flips after restore so the row offers re-polish instead.
  const [polishReverts, setPolishReverts] = useState<Record<string, { original: string; polished: string; kept: boolean }>>({});
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
          // The raw pre-polish input is the scope source of truth — the drafter
          // grounds the steps in it so condensed titles don't lose scope facts.
          originalDescription: originalDescriptions.current.get(id) || undefined,
          category,
          vaContext: currentVaContext || undefined,
        }),
      });
      if (!res.ok) return;
      const { detail, steps } = await res.json();
      const draftedSteps: string[] = Array.isArray(steps)
        ? steps.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 6)
        : [];
      // Only populate if the user hasn't typed anything in the meantime —
      // never overwrite existing steps or manually-typed details.
      setLineItems((prev) =>
        prev.map((li) => {
          if (li.id !== id) return li;
          if (li.scopeSteps?.some((s) => s.trim())) return li;
          if (li.details && li.details.trim().length > 0) return li;
          if (draftedSteps.length > 0) return { ...li, scopeSteps: draftedSteps };
          // Fallback — endpoint may return steps: [] on failure; keep the old
          // single-detail behaviour so the line still gets something.
          if (typeof detail === 'string' && detail.trim().length > 0) return { ...li, details: detail };
          return li;
        }),
      );
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

  const handlePolishDescription = useCallback(async (id: string, description: string, force = false) => {
    const trimmed = description.trim();
    if (trimmed.length < 5) return; // Too short to polish

    // Polish ONCE per line automatically. After that, whatever the admin types
    // is authoritative — silently rewriting a deliberate edit was losing scope
    // detail. A manual "polish" action passes force=true to re-run on demand.
    if (!force && originalDescriptions.current.has(id)) return;

    // Don't re-polish if text hasn't changed since last blur (unless forced —
    // the manual "Polish title" action re-runs on the restored original).
    const lastOriginal = originalDescriptions.current.get(id);
    if (!force && lastOriginal === trimmed) return;

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
        setPolishReverts((prev) => ({ ...prev, [id]: { original: trimmed, polished, kept: false } }));
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
      const hasManualDetail =
        (line?.details && line.details.trim().length > 0) ||
        line?.scopeSteps?.some((s) => s.trim());
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

  // ── Per-line scope-steps editor ──
  // Shared between the SKU-line and custom-line render sites. One <Input> per
  // step (raw "Head — detail" string), ✕ to remove, "+ Add step" (max 6), and
  // a ✨ Draft button that fills steps from the drafter ONLY when empty.
  // Legacy `details` text (no steps yet) keeps its textarea below so nothing
  // is lost — steps take precedence on the customer page.
  const renderScopeStepsEditor = (item: LineItem) => {
    const steps = item.scopeSteps ?? [];
    const hasSteps = steps.some((s) => s.trim());
    const isBusy = draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id);
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-muted-foreground/70">Scope steps</Label>
          <div className="flex items-center gap-2">
            {isBusy && (
              <span className="flex items-center gap-1 text-[10px] text-handy-yellow animate-pulse">
                <Wand2 className="w-2.5 h-2.5" />
                {draftingDetailIds.has(item.id) ? 'drafting...' : 'polishing...'}
              </span>
            )}
            <button
              type="button"
              title="Draft scope steps from the title"
              aria-label="Draft scope steps"
              disabled={isBusy || hasSteps || !item.description?.trim()}
              onClick={() => {
                draftedDetailIds.current.delete(item.id);
                autoDraftLineDetail(item.id, item.description, item.category, buildStructuredVaContext());
              }}
              className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 hover:text-handy-yellow disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Wand2 className={`w-3 h-3 ${draftingDetailIds.has(item.id) ? 'animate-pulse' : ''}`} />
              Draft
            </button>
          </div>
        </div>
        <div className="space-y-1">
          {steps.map((step, stepIdx) => (
            <div key={stepIdx} className="flex items-center gap-1">
              <Input
                value={step}
                placeholder="Head — short detail"
                onChange={(e) => {
                  const next = [...steps];
                  next[stepIdx] = e.target.value;
                  handleUpdateLineScopeSteps(item.id, next);
                }}
                className={`h-7 text-xs bg-transparent border-handy-grid focus:border-handy-yellow transition-colors ${isBusy ? 'opacity-60' : ''}`}
              />
              <button
                type="button"
                aria-label="Remove step"
                onClick={() => handleUpdateLineScopeSteps(item.id, steps.filter((_, i) => i !== stepIdx))}
                className="shrink-0 text-muted-foreground/50 hover:text-red-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {steps.length < 6 && (
            <button
              type="button"
              onClick={() => handleUpdateLineScopeSteps(item.id, [...steps, ''])}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-handy-navy transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add step
            </button>
          )}
        </div>
        {!hasSteps && item.details?.trim() ? (
          <Textarea
            id={`line-detail-${item.id}`}
            placeholder="What's included in this line — auto-drafted, edit if needed."
            value={item.details ?? ''}
            onChange={(e) => handleUpdateLineItem(item.id, 'details', e.target.value)}
            onBlur={() => handlePolishDetail(item.id, item.details ?? '')}
            rows={3}
            className={`text-xs bg-transparent border-handy-grid focus:border-handy-yellow resize-none transition-colors ${isBusy ? 'opacity-60' : ''}`}
          />
        ) : null}
      </div>
    );
  };

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

  // ── Pre-flight modal state ──
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([]);
  const [preflightChecking, setPreflightChecking] = useState(false);
  // AI-drafted scope steps awaiting Ben's approval, keyed by line id. Never applied
  // to the quote until he clicks "Approve & generate" — the human stays in the loop.
  const [preflightDrafts, setPreflightDrafts] = useState<Record<string, string[]>>({});
  const [preflightDrafting, setPreflightDrafting] = useState(false);

  // The actual create call — everything upstream of this is guardrails.
  const proceedGenerate = useCallback((items?: LineItem[]) => {
    const finalItems = items ?? lineItems;
    // Auto-set materialsSupply when any line has materials
    const hasMaterials = finalItems.some((li) => li.materialsCostPounds > 0);
    if (hasMaterials && signals.materialsSupply === 'labor_only') {
      setSignals((prev) => ({ ...prev, materialsSupply: 'we_supply' }));
    }
    // Phase 20 — vaContext is now built deterministically from structured fields.
    createQuoteMutation.mutate({ enrichedVaContext: buildStructuredVaContext(), items: finalItems });
  }, [lineItems, signals.materialsSupply, createQuoteMutation, buildStructuredVaContext]);

  const runPreflightChecks = useCallback(async (): Promise<PreflightIssue[]> => {
    const issues: PreflightIssue[] = [];

    // Customer-facing price per line from the live engine preview (labour +
    // materials-with-margin). No preview yet → thresholds simply don't fire.
    const priceByLine = new Map<string, number>();
    for (const li of livePreview?.lineItems ?? []) {
      priceByLine.set(li.lineId, (li.guardedPricePence || 0) + (li.materialsWithMarginPence || 0));
    }
    const totalPence = livePreview
      ? (livePreview.subtotalPence || 0)
        + (livePreview.totalMaterialsWithMarginPence || 0)
        + (livePreview.priceBuckets?.totalBucketsPence || 0)
      : 0;
    const highTicketQuote = totalPence >= HIGH_TICKET_TOTAL_PENCE;

    // 1. High-ticket lines with no customer-facing scope steps (and no legacy
    //    details). On a high-ticket quote every line should justify itself; on
    //    a smaller quote only individually expensive lines are flagged.
    const missingDetailIds = lineItems
      .filter((li) => {
        if (!li.description.trim()) return false;
        if (li.scopeSteps?.some((s) => s.trim()) || li.details?.trim()) return false;
        return highTicketQuote || (priceByLine.get(li.id) ?? 0) >= HIGH_TICKET_LINE_PENCE;
      })
      .map((li) => li.id);
    if (missingDetailIds.length > 0) {
      issues.push({ kind: 'details', lineIds: missingDetailIds });
    }

    // 2. No photos on a high-ticket quote — photos of the actual job prove we
    //    understood the scope, exactly where trust matters most.
    const anyHighTicketLine = lineItems.some((li) => (priceByLine.get(li.id) ?? 0) >= HIGH_TICKET_LINE_PENCE);
    if ((highTicketQuote || anyHighTicketLine) && customerPhotos.length === 0) {
      issues.push({ kind: 'photos' });
    }

    // 3. Price sanity — effective labour £/hr per line. Catches a wrong time
    //    estimate or price rail before the customer anchors on it. Lines under
    //    an hour skew silly rates, so skip them.
    const rateLines: Extract<PreflightIssue, { kind: 'rate' }>['lines'] = [];
    for (const li of livePreview?.lineItems ?? []) {
      const mins = li.timeEstimateMinutes || 0;
      if (mins < 60) continue;
      const ratePerHour = Math.round((li.guardedPricePence / mins) * 60);
      if (ratePerHour < RATE_FLOOR_PENCE_PER_HOUR) {
        rateLines.push({ lineId: li.lineId, description: li.description, ratePerHourPence: ratePerHour, direction: 'low' });
      } else if (ratePerHour > RATE_CEILING_PENCE_PER_HOUR) {
        rateLines.push({ lineId: li.lineId, description: li.description, ratePerHourPence: ratePerHour, direction: 'high' });
      }
    }
    if (rateLines.length > 0) {
      issues.push({ kind: 'rate', lines: rateLines });
    }

    // 4. A live (unpaid, recent) quote already exists for this phone number.
    try {
      const res = await fetch(`/api/pricing/duplicate-quote-check?phone=${encodeURIComponent(normalizePhoneInput(phone))}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const { duplicates } = await res.json();
        if (Array.isArray(duplicates) && duplicates.length > 0) {
          issues.push({ kind: 'duplicate', duplicates });
        }
      }
    } catch {
      // Check is best-effort — a failed lookup never blocks quote generation.
    }

    return issues;
  }, [lineItems, livePreview, customerPhotos.length, phone]);

  // Draft customer-facing scope steps for the flagged lines, in parallel. Drafts
  // land in the modal's step inputs for Ben to edit/approve — never straight onto
  // the quote. Won't overwrite anything he has already typed in the modal.
  const draftPreflightDetails = useCallback(async (lineIds: string[]) => {
    setPreflightDrafting(true);
    try {
      await Promise.all(lineIds.map(async (id) => {
        const line = lineItems.find((li) => li.id === id);
        if (!line) return;
        try {
          const res = await fetch('/api/pricing/draft-line-detail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({
              lineDescription: line.description,
              originalDescription: originalDescriptions.current.get(id) || undefined,
              category: line.category,
              vaContext: buildStructuredVaContext(),
            }),
          });
          if (!res.ok) return;
          const { steps } = await res.json();
          const draftedSteps: string[] = Array.isArray(steps)
            ? steps.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 6)
            : [];
          if (draftedSteps.length > 0) {
            // Don't overwrite steps Ben has already typed into the modal.
            setPreflightDrafts((prev) => (prev[id]?.some((s) => s.trim()) ? prev : { ...prev, [id]: draftedSteps }));
          }
        } catch {
          // Non-critical — Ben can type the steps himself in the modal.
        }
      }));
    } finally {
      setPreflightDrafting(false);
    }
  }, [lineItems, buildStructuredVaContext]);

  const handleGenerate = async () => {
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

    // Soft guardrails — quality gaps open the pre-flight modal instead of generating.
    setPreflightChecking(true);
    let issues: PreflightIssue[] = [];
    try {
      issues = await runPreflightChecks();
    } finally {
      setPreflightChecking(false);
    }
    if (issues.length > 0) {
      setPreflightIssues(issues);
      setPreflightDrafts({});
      setPreflightOpen(true);
      trackEvent('cq_preflight_flagged', { kinds: issues.map((i) => i.kind) });
      const detailsIssue = issues.find((i): i is Extract<PreflightIssue, { kind: 'details' }> => i.kind === 'details');
      if (detailsIssue) void draftPreflightDetails(detailsIssue.lineIds);
      return;
    }

    proceedGenerate();
  };

  // Modal: apply approved/edited drafted steps onto the flagged lines, then generate.
  const handlePreflightApprove = () => {
    const updated = lineItems.map((li) => {
      const draftSteps = (preflightDrafts[li.id] ?? []).map((s) => s.trim()).filter(Boolean);
      const hasSteps = li.scopeSteps?.some((s) => s.trim());
      return draftSteps.length > 0 && !hasSteps ? { ...li, scopeSteps: draftSteps } : li;
    });
    setLineItems(updated);
    setPreflightOpen(false);
    trackEvent('cq_preflight_approved', { kinds: preflightIssues.map((i) => i.kind) });
    proceedGenerate(updated);
  };

  // Modal: Ben consciously ships it as-is. Logged so we can measure whether
  // overridden quotes convert worse.
  const handlePreflightOverride = () => {
    trackEvent('cq_preflight_overridden', { kinds: preflightIssues.map((i) => i.kind) });
    setPreflightOpen(false);
    proceedGenerate();
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
    setLinkedCall(null);
    setUnlinkedPhone(null);
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
          // Drop any two-rail overrides — the line is back to a blank custom row.
          priceOverridePence: undefined,
          timeOverrideMinutes: undefined,
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
          // A fresh pick starts at the catalog default — no overrides yet. The
          // two-rail inputs show the catalog price/time until nudged.
          priceOverridePence: undefined,
          timeOverrideMinutes: undefined,
        };
      }),
    );
  }, []);

  /**
   * Track B — accept the advisory SKU suggestion on a custom line. Builds the
   * same `SkuPickResult` the inline autocomplete / modal would emit on a fresh
   * pick (default unit count = minimumUnits, default tier = first tier) and
   * routes it through `handlePickSkuForLine`, so the resulting line is
   * indistinguishable from a manual pick — the Phase 25 catalog pricing/time
   * engages identically. No-op if the suggestion has no resolved row.
   */
  const handleAcceptSuggestion = useCallback(
    (lineId: string) => {
      const line = lineItems.find((li) => li.id === lineId);
      const sku = line?.suggestedSku;
      if (!sku) return;
      // Mirror SkuPicker.commitPick's defaulting for the shape inputs.
      const unitCount =
        sku.shape === 'per_unit' ? Math.max(1, sku.minimumUnits ?? 1) : undefined;
      const selectedTier =
        sku.shape === 'tiered' ? sku.tiers?.[0]?.label : undefined;
      const derived = getEffectiveSkuPriceAndMinutes(sku, unitCount, selectedTier);
      // Same fire-and-forget pick telemetry a manual pick records.
      void fetch(`/api/admin/sku-catalog/${encodeURIComponent(sku.skuCode)}/pick`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
      }).catch(() => {
        /* telemetry is non-critical */
      });
      handlePickSkuForLine(lineId, {
        sku,
        derivedPricePence: derived.pricePence,
        derivedScheduleMinutes: derived.scheduleMinutes,
        unitCount,
        selectedTier,
      });
    },
    [lineItems, handlePickSkuForLine],
  );

  /**
   * Update the per-unit count for a SKU line; recompute derived schedule.
   * Changing the count re-bases the line to a fresh catalog default, so any
   * two-rail overrides (price/time) are cleared — the inputs re-sync to the
   * new catalog price/minutes for the new count.
   */
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
          priceOverridePence: undefined,
          timeOverrideMinutes: undefined,
        };
      }),
    );
  }, []);

  /**
   * Update the tier for a tiered SKU line; recompute derived schedule.
   * Same re-base rule as unit-count: clears two-rail overrides so the inputs
   * follow the newly-selected tier's catalog price/minutes.
   */
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
          priceOverridePence: undefined,
          timeOverrideMinutes: undefined,
        };
      }),
    );
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Two-rail (price + time) per-line override handlers
  //
  // Independence is the contract: a price edit never moves the time rail, a
  // time edit never moves the price rail.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set/clear the PRICE rail override from a £ string.
   *  - Empty/blank/≤0 → clears priceOverridePence (custom: reverts to "auto";
   *    SKU: reverts to the catalog price).
   *  - Otherwise → priceOverridePence = round(£ × 100).
   * Never touches the time rail.
   */
  const handleSetPriceOverride = useCallback((lineId: string, poundsStr: string) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineId) return li;
        const pounds = parseFloat(poundsStr);
        if (!poundsStr.trim() || !Number.isFinite(pounds) || pounds <= 0) {
          return { ...li, priceOverridePence: undefined };
        }
        return { ...li, priceOverridePence: Math.round(pounds * 100) };
      }),
    );
  }, []);

  /**
   * Set the TIME rail override (minutes).
   *  - mirrorEstimate=true (custom lines): also write estimatedMinutes so the
   *    shown duration stays the single source the preview/validation read.
   *  - mirrorEstimate=false (SKU lines): only timeOverrideMinutes changes; the
   *    catalog-derived estimatedMinutes is left intact for the price rail.
   * Never touches the price rail.
   */
  const handleSetTimeOverride = useCallback(
    (lineId: string, minutes: number, opts?: { mirrorEstimate?: boolean }) => {
      setLineItems((prev) =>
        prev.map((li) => {
          if (li.id !== lineId) return li;
          const next: LineItem = { ...li, timeOverrideMinutes: minutes };
          if (opts?.mirrorEstimate) next.estimatedMinutes = minutes;
          return next;
        }),
      );
    },
    [],
  );

  /**
   * Reset one rail of a SKU line back to its catalog default by clearing that
   * rail's override. Only the named rail is cleared — the other rail keeps its
   * own override.
   */
  const handleResetSkuRail = useCallback((lineId: string, rail: 'price' | 'time') => {
    setLineItems((prev) =>
      prev.map((li) =>
        li.id === lineId
          ? rail === 'price'
            ? { ...li, priceOverridePence: undefined }
            : { ...li, timeOverrideMinutes: undefined }
          : li,
      ),
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
                      onBlur={() => setPhone((p) => normalizePhoneInput(p))}
                      className="mt-1"
                    />
                    {/* Source-call attribution chip — click body to switch call, [×] to unlink */}
                    {linkedCall && (
                      <LinkedCallChip
                        call={linkedCall}
                        matches={recentCallMatches ?? []}
                        onSelect={(c) => {
                          setLinkedCall(c);
                          setUnlinkedPhone(null);
                        }}
                        onUnlink={() => {
                          setLinkedCall(null);
                          setSelectedCallerId(null);
                          setUnlinkedPhone(normalizePhoneInput(phone));
                        }}
                      />
                    )}
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
                    <Label className="text-xs text-muted-foreground">Message style</Label>
                    <Select value={messageStyle || '__auto__'} onValueChange={(v) => setMessageStyle(v === '__auto__' ? '' : v)}>
                      <SelectTrigger className="mt-1 h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__auto__" className="text-sm">
                          Auto{customerType ? ` — ${MESSAGE_STYLE_OPTIONS.find((o) => o.value === defaultMessageStyle(customerType))?.label.split(' — ')[0]}` : ' (from customer type)'}
                        </SelectItem>
                        {MESSAGE_STYLE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-sm">{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {messageStyle === 'delay' && (
                      <Input
                        className="mt-2 h-9 text-sm"
                        placeholder="Reason for the delay (optional — woven in)"
                        value={delayReason}
                        onChange={(e) => setDelayReason(e.target.value)}
                      />
                    )}
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
                      Line scope steps
                      <Switch
                        id="show-line-details"
                        checked={showLineDetails}
                        onCheckedChange={(checked) => {
                          setShowLineDetails(checked);
                          if (checked) {
                            // Auto-draft scope steps for every existing line that doesn't have any yet.
                            // Clear the once-per-line guard so re-toggling triggers fresh drafts.
                            for (const li of lineItems) {
                              if (!li.details && !li.scopeSteps?.some((s) => s.trim()) && li.description.trim().length >= 5) {
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
                      const materialsOpen = materialsOpenIds.has(item.id) || item.materialsCostPounds > 0;
                      const isPolishing = polishingIds.has(item.id);
                      // Phase 25d — a line is a SKU line iff it was picked from
                      // the inline autocomplete (source==='sku' && skuCode).
                      // Everything else renders the inline autocomplete and is
                      // treated as custom on generate.
                      const isPickedSku = item.source === 'sku' && !!item.skuCode && !!item.skuMeta;
                      // Reveal Category/Time/Materials only once the line is known custom
                      // (typed, no catalog match). A picked SKU drives its own slab.
                      const showCustomConfig = !isPickedSku && customLineIds.has(item.id);

                      // Two-rail defaults for a picked SKU: the catalog price +
                      // minutes for the current unit/tier selection. The rail
                      // inputs show the override when set, else these. "edited"
                      // is true when an override diverges from the catalog.
                      const skuRail = isPickedSku
                        ? getEffectiveSkuPriceAndMinutes(item.skuMeta!, item.unitCount, item.selectedTier)
                        : null;

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

                              {/* Two-rail price + time — pre-filled from the
                                  catalog; nudge either independently per job. */}
                              {skuRail && (
                                <TwoRailEditor
                                  priceValuePence={item.priceOverridePence ?? skuRail.pricePence}
                                  priceEdited={item.priceOverridePence !== undefined}
                                  onPriceChange={(s) => handleSetPriceOverride(item.id, s)}
                                  onPriceReset={() => handleResetSkuRail(item.id, 'price')}
                                  timeValueMinutes={item.timeOverrideMinutes ?? skuRail.scheduleMinutes}
                                  timeEdited={item.timeOverrideMinutes !== undefined}
                                  onTimeChange={(m) => handleSetTimeOverride(item.id, m)}
                                  onTimeReset={() => handleResetSkuRail(item.id, 'time')}
                                />
                              )}

                              {/* Scope-steps editor — still applies to SKU lines so admin
                                  can override the customer-facing checklist. */}
                              {showLineDetails && item.skuCode && renderScopeStepsEditor(item)}
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

                              {/* Polish override — the AI tidy can strip scope detail the
                                  admin typed on purpose. After a rewrite, offer a one-tap
                                  restore of the original; after restoring, offer re-polish.
                                  Row hides once the title is edited to anything else. */}
                              {(() => {
                                const rev = polishReverts[item.id];
                                if (!rev) return null;
                                if (!rev.kept && item.description === rev.polished) {
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleUpdateLineItem(item.id, 'description', rev.original);
                                        setPolishReverts((prev) => ({ ...prev, [item.id]: { ...rev, kept: true } }));
                                      }}
                                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-handy-navy transition-colors max-w-full"
                                    >
                                      <Undo2 className="w-3 h-3 shrink-0" />
                                      <span className="truncate">Keep what I typed: “{rev.original}”</span>
                                    </button>
                                  );
                                }
                                if (rev.kept && item.description === rev.original) {
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => handlePolishDescription(item.id, item.description, true)}
                                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-handy-navy transition-colors"
                                    >
                                      <Wand2 className="w-3 h-3 shrink-0" />
                                      Polish title
                                    </button>
                                  );
                                }
                                return null;
                              })()}

                              {/* Track B — suggest-and-confirm SKU chip. Shows on a
                                  CUSTOM line when the parser advised a catalog SKU.
                                  Human taps Accept (the safety gate) → the line flips
                                  to a priced SKU line exactly like a manual pick, the
                                  chip vanishes (the SKU slab renders instead). `low`
                                  confidence is hidden (too weak to surface). */}
                              {item.source === 'custom' &&
                                item.suggestedSkuCode &&
                                item.suggestedSku &&
                                item.suggestedSkuConfidence !== 'low' && (() => {
                                  const isHigh = item.suggestedSkuConfidence === 'high';
                                  return (
                                    <div
                                      className={`flex items-center gap-2 rounded-lg px-3 py-2 border-2 ${
                                        isHigh
                                          ? 'bg-emerald-600 border-emerald-700 text-white'
                                          : 'bg-amber-400 border-amber-500 text-handy-navy'
                                      }`}
                                    >
                                      <Wand2 className="w-4 h-4 shrink-0" />
                                      <div className="flex-1 min-w-0 leading-tight">
                                        <span
                                          className={`block text-[10px] font-bold uppercase tracking-wider ${
                                            isHigh ? 'text-white/80' : 'text-handy-navy/70'
                                          }`}
                                        >
                                          Suggested · {item.suggestedSkuConfidence}
                                        </span>
                                        <span className="block text-sm font-bold truncate">
                                          {item.suggestedSku.name}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleAcceptSuggestion(item.id)}
                                        className={`shrink-0 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-bold transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95 ${
                                          isHigh
                                            ? 'bg-white text-emerald-700 hover:bg-white/90'
                                            : 'bg-handy-navy text-white hover:bg-handy-navy/90'
                                        }`}
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                        Accept
                                      </button>
                                    </div>
                                  );
                                })()}

                              {/* Scope-steps editor — only once the line is custom, then gated on the global "Line scope steps" toggle */}
                              {showCustomConfig && showLineDetails && renderScopeStepsEditor(item)}

                              {/* Category + Price/Time — revealed once the line is custom (no SKU match) */}
                              {showCustomConfig && (() => {
                                // Phase 4d — fixed-tier categories (e.g. waste_removal)
                                // price + time from the chosen tier, so they keep the
                                // tier picker and skip the free-form two-rail editor.
                                const cfg = getPricingConfig(item.category);
                                const isFixedTier =
                                  cfg.model === 'fixed' && !!cfg.fixedTiers && cfg.fixedTiers.length > 0;
                                return (
                                  <div className="space-y-2">
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
                                      {isFixedTier && (
                                        <div className="w-full sm:w-auto sm:shrink-0">
                                          <Select
                                            value={(item as any).fixedTier || ''}
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
                                              {cfg.fixedTiers!.map((t) => (
                                                <SelectItem key={t.id} value={t.id} className="text-xs">
                                                  {t.label} · £{(t.pricePence / 100).toFixed(0)} · {t.scheduleMinutes}min
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      )}
                                    </div>

                                    {/* Two-rail price + time for free-form custom work.
                                        Time edits estimatedMinutes AND mirrors into
                                        timeOverrideMinutes so the shown time always wins
                                        downstream. Price starts "auto" (engine prices it)
                                        until typed. Skipped for fixed-tier lines. */}
                                    {!isFixedTier && (
                                      <TwoRailEditor
                                        priceValuePence={item.priceOverridePence ?? null}
                                        pricePlaceholder="auto"
                                        ghostPricePence={livePriceByLineId.get(item.id) ?? estimateLineLabourPence(item)}
                                        priceEdited={false}
                                        onPriceChange={(s) => handleSetPriceOverride(item.id, s)}
                                        timeValueMinutes={item.estimatedMinutes}
                                        timeEdited={false}
                                        onTimeChange={(m) =>
                                          handleSetTimeOverride(item.id, m, { mirrorEstimate: true })
                                        }
                                      />
                                    )}
                                  </div>
                                );
                              })()}
                            </>
                          )}

                          {/* Materials — shown for SKU lines; for custom lines only once revealed */}
                          {(isPickedSku || showCustomConfig) && (
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                if (materialsOpen) {
                                  setMaterialsOpenIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(item.id);
                                    return next;
                                  });
                                  handleUpdateLineItem(item.id, 'materialsCostPounds', 0);
                                } else {
                                  setMaterialsOpenIds((prev) => new Set(prev).add(item.id));
                                }
                              }}
                              className={`text-sm sm:text-xs px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full border transition-colors ${
                                materialsOpen
                                  ? 'border-handy-yellow bg-handy-yellow/15 text-handy-navy font-semibold'
                                  : 'border-handy-grid text-muted-foreground/50 hover:border-handy-navy/30'
                              }`}
                            >
                              {materialsOpen ? '🧱 Materials' : '+ Materials'}
                            </button>
                            {materialsOpen && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm sm:text-xs text-muted-foreground">£</span>
                                <MaterialsCostInput
                                  value={item.materialsCostPounds || 0}
                                  autoFocus={item.materialsCostPounds === 0}
                                  onFocus={() => setMaterialsOpenIds((prev) => (prev.has(item.id) ? prev : new Set(prev).add(item.id)))}
                                  onCommit={(pounds) => handleUpdateLineItem(item.id, 'materialsCostPounds', pounds)}
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
                          {/* Decomposed pricing — structural buckets (call-out × visits
                              + travel + collection). Shown as its own admin subtotal so
                              this engine-diagnostic itemisation reconciles to the
                              Engine Total below; on the CUSTOMER quote the same total is
                              folded silently into each line's price. No-op when off. */}
                          {livePreview.priceBuckets && livePreview.priceBuckets.totalBucketsPence > 0 && (
                            <div className="flex items-center justify-between text-muted-foreground">
                              <span>
                                Structural (call-out{livePreview.priceBuckets.visitCount > 1 ? ` ×${livePreview.priceBuckets.visitCount}` : ''}
                                {livePreview.priceBuckets.travelPence > 0 ? ' + travel' : ''}
                                {livePreview.priceBuckets.materialCollectionPence > 0 ? ' + collection' : ''})
                              </span>
                              <span className="tabular-nums">£{(livePreview.priceBuckets.totalBucketsPence / 100).toFixed(0)}</span>
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


            {/* ─── Section 4d: Customer Photos (shown on the quote page under the price card) ─── */}
            <Card id="cq-photos-section" className="overflow-hidden border-handy-grid shadow-sm">
              <CardHeader className="bg-handy-navy text-white px-4 sm:px-6 py-3 border-b-4 border-handy-yellow mb-3">
                <CardTitle className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <Camera className="w-4 h-4 text-handy-yellow" />
                  Customer Photos
                </CardTitle>
                <p className="text-xs text-white/70 mt-1">
                  Photos the customer sent of the job (WhatsApp/SMS). Shown on their quote page — "your job, as you sent it".
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {customerPhotos.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {customerPhotos.map((url, i) => (
                      <div key={url} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                        <img src={url} alt={`Customer photo ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          aria-label="Remove photo"
                          onClick={() => setCustomerPhotos((prev) => prev.filter((u) => u !== url))}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-handy-navy/25 py-4 text-sm font-medium text-handy-navy/80 hover:border-handy-yellow hover:bg-handy-cream cursor-pointer transition-colors ${uploadingPhotos ? 'opacity-60 pointer-events-none' : ''}`}>
                  {uploadingPhotos ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      {customerPhotos.length > 0 ? 'Add more photos' : 'Add photos'}
                      <span className="text-xs text-muted-foreground font-normal">(max 10)</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void handlePhotoUpload(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              </CardContent>
            </Card>

            {/* ─── Section 5a: Contractor fit (informational only — system auto-assigns at reserve time) ─── */}
            <ContractorFitPanel
              categorySlugs={lineItems.map(li => li.category)}
              coordinates={coordinates}
              requiredDays={liveRequiredDays}
            />


            {/* ─── Decomposed pricing (admin eval) — per-quote only, never live ─── */}
            <div className="rounded-lg border border-dashed border-amber-400/60 bg-amber-50/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="preview-decomposed" className="text-sm font-semibold text-amber-900 cursor-pointer">
                    Apply decomposed pricing (preview)
                  </Label>
                  <p className="text-xs text-amber-800/80 mt-0.5">
                    Adds £25 call-out + travel + collection to this quote only. Live pricing unchanged.
                  </p>
                </div>
                <Switch
                  id="preview-decomposed"
                  checked={previewDecomposed}
                  onCheckedChange={setPreviewDecomposed}
                />
              </div>
              {previewDecomposed && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-amber-300/50">
                  <Label htmlFor="preview-travel-miles" className="text-xs text-amber-900 whitespace-nowrap">
                    Travel distance (mi)
                  </Label>
                  <Input
                    id="preview-travel-miles"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="0"
                    value={previewTravelMiles}
                    onChange={(e) => setPreviewTravelMiles(e.target.value)}
                    className="h-8 w-24 bg-white"
                  />
                  <span className="text-xs text-amber-800/70">free under 8mi · £20 per 6mi band</span>
                </div>
              )}
            </div>

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
                disabled={!canGenerate || createQuoteMutation.isPending || preflightChecking}
              >
                {createQuoteMutation.isPending || preflightChecking ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    {preflightChecking ? 'Checking quote…' : 'Generating Quote...'}
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
            pricingLayerBreakdown: quoteResult.pricing.priceBuckets
              ? { priceBuckets: quoteResult.pricing.priceBuckets }
              : null,
          } satisfies PreviewQuote}
        />
      )}

      {/* Pre-flight check modal — soft guardrails that intercept Generate.
          Clean quotes never see this; flagged quotes show each issue with an
          inline fix. AI-drafted details are editable here and only land on the
          quote when Ben approves — the human stays in the loop. "Generate
          anyway" is always available (never block mid-call) but is tracked. */}
      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-handy-yellow" />
              Before this quote goes out
            </DialogTitle>
            <DialogDescription>
              A few things worth fixing — high-ticket quotes convert far better with them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {preflightIssues.map((issue) => {
              if (issue.kind === 'details') {
                return (
                  <div key="details" className="rounded-lg border border-border p-3 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">Line items missing scope steps</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {issue.lineIds.length} line{issue.lineIds.length > 1 ? 's' : ''} on this quote {issue.lineIds.length > 1 ? 'have' : 'has'} no
                        customer-facing scope steps. {preflightDrafting ? 'Drafting suggestions…' : 'Review the drafted steps below — edit anything, then approve.'}
                      </p>
                    </div>
                    {issue.lineIds.map((id) => {
                      const line = lineItems.find((li) => li.id === id);
                      if (!line) return null;
                      const draftSteps = preflightDrafts[id] ?? [];
                      // Always show at least one input so Ben can type steps
                      // himself if the drafter returned nothing.
                      const rows = draftSteps.length > 0 ? draftSteps : [''];
                      return (
                        <div key={id} className="space-y-1">
                          <p className="text-xs font-medium truncate">{line.description}</p>
                          {preflightDrafting && draftSteps.length === 0 ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Drafting…
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {rows.map((step, stepIdx) => (
                                <div key={stepIdx} className="flex items-center gap-1">
                                  <Input
                                    value={step}
                                    placeholder="Head — short detail"
                                    onChange={(e) => {
                                      const next = [...rows];
                                      next[stepIdx] = e.target.value;
                                      setPreflightDrafts((prev) => ({ ...prev, [id]: next }));
                                    }}
                                    className="h-7 text-xs"
                                  />
                                  <button
                                    type="button"
                                    aria-label="Remove step"
                                    onClick={() => setPreflightDrafts((prev) => ({ ...prev, [id]: rows.filter((_, i) => i !== stepIdx) }))}
                                    className="shrink-0 text-muted-foreground/50 hover:text-red-500 transition-colors"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                              {rows.length < 6 && (
                                <button
                                  type="button"
                                  onClick={() => setPreflightDrafts((prev) => ({ ...prev, [id]: [...rows, ''] }))}
                                  className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-handy-navy transition-colors"
                                >
                                  <Plus className="w-3 h-3" />
                                  Add step
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              }
              if (issue.kind === 'photos') {
                return (
                  <div key="photos" className="rounded-lg border border-border p-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">No job photos attached</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        On a big job, photos of the actual work build trust and prove we understood the scope.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        setPreflightOpen(false);
                        document.getElementById('cq-photos-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >
                      <Camera className="w-3.5 h-3.5 mr-1.5" /> Add photos
                    </Button>
                  </div>
                );
              }
              if (issue.kind === 'rate') {
                return (
                  <div key="rate" className="rounded-lg border border-border p-3 space-y-2">
                    <p className="text-sm font-semibold">Price sanity check</p>
                    {issue.lines.map((l) => (
                      <p key={l.lineId} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{l.description}</span>{' '}
                        works out at <span className={`font-semibold ${l.direction === 'low' ? 'text-red-600' : 'text-amber-600'}`}>£{Math.round(l.ratePerHourPence / 100)}/hr</span>{' '}
                        labour — {l.direction === 'low' ? 'below the usual floor. Is the time estimate or price wrong?' : 'unusually high. Double-check before sending.'}
                      </p>
                    ))}
                  </div>
                );
              }
              // duplicate
              return (
                <div key="duplicate" className="rounded-lg border border-border p-3 space-y-2">
                  <p className="text-sm font-semibold">This customer already has a live quote</p>
                  {issue.duplicates.map((d) => (
                    <div key={d.shortSlug} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground truncate">
                        {d.customerName} · {typeof d.basePricePence === 'number' ? `£${Math.round(d.basePricePence / 100)}` : '—'} ·{' '}
                        {d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-GB') : ''} {d.viewed ? '· viewed' : '· not viewed'}
                      </span>
                      <a
                        href={`/quote-link/${d.shortSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 inline-flex items-center gap-1 text-handy-navy underline"
                      >
                        Open <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Two competing links confuse customers — consider editing the existing quote instead.
                  </p>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={handlePreflightOverride}
              disabled={createQuoteMutation.isPending}
            >
              Generate anyway
            </Button>
            {preflightIssues.some((i) => i.kind === 'details') ? (
              <Button
                type="button"
                className="bg-handy-navy hover:bg-handy-navy/90 text-white"
                onClick={handlePreflightApprove}
                disabled={preflightDrafting || createQuoteMutation.isPending}
              >
                {preflightDrafting ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Drafting…</span>
                ) : (
                  'Approve steps & generate'
                )}
              </Button>
            ) : (
              <Button
                type="button"
                className="bg-handy-navy hover:bg-handy-navy/90 text-white"
                onClick={() => setPreflightOpen(false)}
              >
                Go back & fix
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
                        £{((li.guardedPricePence + (li.materialsWithMarginPence || 0) + (li.structuralSharePence || 0)) / 100).toFixed(0)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Decomposed structural buckets are FOLDED into the per-line prices
                  above (so this preview matches exactly what the customer sees — no
                  separate fee section). This single dashed caption is ADMIN-ONLY: it
                  states how much structural cost was folded in, for transparency to
                  whoever is generating the quote. The job-whole inputs (visits /
                  travel / collection) live in the form controls, not here. */}
              {livePreview.priceBuckets &&
                livePreview.priceBuckets.totalBucketsPence > 0 && (
                  <div className="rounded-lg border border-dashed border-amber-400/60 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900">
                    <span className="font-semibold">Admin note:</span> includes £
                    {(livePreview.priceBuckets.totalBucketsPence / 100).toFixed(0)} structural
                    cost folded into line prices — call-out covers setup &amp; the first hour
                    {livePreview.priceBuckets.visitCount > 1 ? ` ×${livePreview.priceBuckets.visitCount} visits` : ''}
                    {livePreview.priceBuckets.travelPence > 0 ? ` · travel £${(livePreview.priceBuckets.travelPence / 100).toFixed(0)}` : ''}
                    {livePreview.priceBuckets.materialCollectionPence > 0 ? ' · materials collection' : ''}
                    . This first-hour buffer absorbs minor extras without a re-quote; customer sees one blended price per line.
                  </div>
                )}

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
