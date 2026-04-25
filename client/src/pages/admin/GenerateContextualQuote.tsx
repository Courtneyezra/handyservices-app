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
            className={`h-7 px-2.5 rounded-full text-xs font-medium transition-all active:scale-95 ${
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
    <Card className="border border-border">
      <CardHeader className="pb-2 px-3 sm:px-6">
        <CardTitle className="text-sm flex items-center gap-1.5 min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{hasRevShare ? 'Rev Share — contractor & platform' : 'Margin'}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-3 sm:px-6">
        {/* Single combined table — desktop */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 pr-2 font-medium">Category</th>
                {hasRevShare && <th className="text-right py-1.5 px-1 font-medium">Tier</th>}
                <th className="text-right py-1.5 px-1 font-medium">Hrs</th>
                <th className="text-right py-1.5 px-1 font-medium">Customer</th>
                <th className="text-right py-1.5 px-1 font-medium text-amber-400/80">Contractor</th>
                <th className="text-right py-1.5 px-1 font-medium text-emerald-400/80">Platform</th>
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
                    <td className="text-right py-1.5 px-1 text-amber-400">
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
                <td className="text-right py-2 px-1 text-amber-400 font-bold">
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
                  <div className="rounded bg-amber-500/5 border border-amber-500/15 px-2 py-1">
                    <div className="text-muted-foreground/70 text-[9px] uppercase tracking-wider">Contractor</div>
                    <div className="text-amber-400 font-semibold">{p2p(line.contractorCostPence)}</div>
                    <div className="text-muted-foreground/60 text-[9px]">{parseFloat(line.hours.toFixed(1))}h · {p2p(effHourly)}/hr</div>
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

        {/* Combined summary — Contractor + Platform side by side */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md px-3 py-2.5 border bg-amber-500/10 border-amber-500/20">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Contractor Payout</div>
            <div className="text-base font-bold text-amber-400 tabular-nums">{p2p(totalContractorPay)}</div>
            <div className="text-[10px] text-muted-foreground">
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
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

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
  const [vaContext, setVaContext] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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

  // ── Behavioural signals ──
  const [behavioralSignals, setBehavioralSignals] = useState({
    isCommercialPremises: false,
    wontBePresent: false,
    priceConscious: false,
  });

  // ── Contractor assignment ──
  const [selectedContractorId, setSelectedContractorId] = useState<string | null>(null);

  // ── Call card selection ──
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(null);

  // ── Result ──
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

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
  const livePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLivePreview = useCallback(async (items: LineItem[], sigs: ContextSignals, enrichedContext?: string) => {
    // Cancel any in-flight request
    livePreviewAbortRef.current?.abort();

    // Need at least one valid line item
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

  // Debounced effect: re-fetch live preview when line items, signals, or context change
  useEffect(() => {
    if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    livePreviewTimerRef.current = setTimeout(() => {
      const behavioralNotes = [
        behavioralSignals.isCommercialPremises ? 'commercial premises' : '',
        behavioralSignals.wontBePresent ? "customer won't be present" : '',
        behavioralSignals.priceConscious ? 'customer seemed price-conscious' : '',
      ].filter(Boolean).join(', ');
      const enrichedVaContext = [
        vaContext.trim(),
        behavioralNotes ? `Additional notes: ${behavioralNotes}` : '',
      ].filter(Boolean).join('\n') || undefined;
      fetchLivePreview(lineItems, signals, enrichedVaContext);
    }, 600);
    return () => {
      if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    };
  }, [lineItems, signals, vaContext, behavioralSignals, fetchLivePreview]);

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
      // Map parsed lines to our LineItem format — accepts any minute value
      const newItems: LineItem[] = result.lines.map((line) => ({
        id: line.id || generateId(),
        description: line.description,
        category: line.category,
        estimatedMinutes: line.timeEstimateMinutes,
        materialsCostPounds: 0,
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
          })),
          signals: {
            urgency: signals.urgency,
            materialsSupply: signals.materialsSupply,
            timeOfService: signals.timeOfService,
            isReturningCustomer: signals.isReturningCustomer,
            previousJobCount: signals.previousJobCount,
            previousAvgPricePence: signals.previousAvgPricePence,
          },
          vaContext: enrichedVaContext,
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
    if (lineItems.length >= 10) return;
    setLineItems((prev) => [
      ...prev,
      { id: generateId(), description: '', category: 'general_fixing' as JobCategory, estimatedMinutes: 30, materialsCostPounds: 0 },
    ]);
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
  const autoDraftLineDetail = useCallback(async (id: string, polishedTitle: string, category: JobCategory, currentVaContext: string) => {
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
    try {
      const res = await fetch('/api/pricing/polish-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: trimmed }),
      });
      if (!res.ok) return;
      const { polished } = await res.json();
      if (polished && polished !== trimmed) {
        originalDescriptions.current.set(id, trimmed);
        handleUpdateLineItem(id, 'description', polished);
        polishedFinal = polished;
      } else {
        // Even if unchanged, record it so we don't re-call
        originalDescriptions.current.set(id, trimmed);
        polishedFinal = trimmed;
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

    // Follow-up: auto-draft the "details" field if empty AND the global toggle is on.
    // Look up the most recent line state so we don't draft over user-typed details.
    // We clear the once-per-line guard before calling so a title edit re-drafts.
    if (polishedFinal && showLineDetails) {
      const line = lineItems.find((li) => li.id === id);
      const hasManualDetail = line?.details && line.details.trim().length > 0;
      if (!hasManualDetail) {
        const currentCategory = (line?.category ?? 'general_fixing') as JobCategory;
        draftedDetailIds.current.delete(id);
        autoDraftLineDetail(id, polishedFinal, currentCategory, vaContext);
      }
    }
  }, [handleUpdateLineItem, autoDraftLineDetail, lineItems, vaContext, showLineDetails]);

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

  const handleToggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      setRecordingError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'context.webm');

        try {
          const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
          const data = await res.json();
          if (data.text) {
            setVaContext(prev => prev ? `${prev} ${data.text}` : data.text);
          }
        } catch {
          setRecordingError('Transcription failed — type it instead');
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setRecordingError('Microphone access needed — type it instead');
    }
  };

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
    if (availableDates.length === 0) {
      toast({ title: 'Pick available dates', description: 'Select at least one date the customer can book.', variant: 'destructive' });
      return;
    }
    // Auto-set materialsSupply when any line has materials
    const hasMaterials = lineItems.some((li) => li.materialsCostPounds > 0);
    if (hasMaterials && signals.materialsSupply === 'labor_only') {
      setSignals((prev) => ({ ...prev, materialsSupply: 'we_supply' }));
    }

    // Build enriched vaContext combining typed/spoken context with VA checkbox signals
    const behavioralNotes = [
      behavioralSignals.isCommercialPremises ? 'commercial premises' : '',
      behavioralSignals.wontBePresent ? "customer won't be present" : '',
      behavioralSignals.priceConscious ? 'customer seemed price-conscious' : '',
    ].filter(Boolean).join(', ');

    const enrichedVaContext = [
      vaContext.trim(),
      behavioralNotes ? `Additional notes: ${behavioralNotes}` : '',
    ].filter(Boolean).join('\n') || undefined;

    createQuoteMutation.mutate(enrichedVaContext);
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
    setVaContext('');
    setIsRecording(false);
    setRecordingError(null);
    setBehavioralSignals({ isCommercialPremises: false, wontBePresent: false, priceConscious: false });
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

  // Validate form completeness for button state
  const canGenerate = customerName.trim() && phone.trim() && lineItems.length > 0 && lineItems.every((li) => li.description.trim()) && availableDates.length > 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Generate Contextual Quote</h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-powered pricing with full context signals
          </p>
        </div>

        {/* Only show form when no result yet */}
        {!quoteResult && (
          <>
            {/* ─── Section 1: Recent Calls ─── */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Recent Calls</span>
              </div>

              {callersLoading ? (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 w-48 shrink-0 rounded-xl bg-muted animate-pulse" />
                  ))}
                </div>
              ) : callers && callers.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                  {callers.map((caller) => {
                    const isSelected = selectedCallerId === caller.id;
                    return (
                      <div
                        key={caller.id}
                        className={`shrink-0 rounded-xl border p-3 transition-all w-52 ${
                          isSelected
                            ? 'border-amber-500/50 bg-amber-500/10 ring-2 ring-amber-500/20'
                            : 'border-border bg-card hover:border-muted-foreground/30'
                        }`}
                      >
                        <div className="text-sm font-semibold text-foreground truncate">
                          {caller.customerName || 'Unknown'}
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {caller.phone}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <Clock className="w-3 h-3" />
                          {caller.calledAt
                            ? formatDistanceToNow(new Date(caller.calledAt), { addSuffix: true })
                            : 'Unknown'}
                        </div>
                        {caller.jobSummary && (
                          <div className="text-xs text-muted-foreground/70 truncate mt-1">
                            {caller.jobSummary.length > 50
                              ? caller.jobSummary.slice(0, 50) + '...'
                              : caller.jobSummary}
                          </div>
                        )}
                        <div className="flex gap-1.5 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 flex-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                            onClick={() => handleSelectCaller(caller, 'all')}
                          >
                            Use All
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 flex-1"
                            onClick={() => handleSelectCaller(caller, 'customer')}
                          >
                            Customer Only
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No recent calls found.</p>
              )}
            </div>

            <Separator />

            {/* ─── Section 2: Customer Details ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Customer Details</CardTitle>
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
                      placeholder="07700 900123"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cx-email" className="text-xs text-muted-foreground">Email</Label>
                    <Input
                      id="cx-email"
                      placeholder="john@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Postcode</Label>
                    <Input
                      placeholder="NG1 1AA"
                      value={postcode}
                      onChange={(e) => setPostcode(e.target.value)}
                      className="mt-1"
                      readOnly={addressValidated}
                    />
                    {addressValidated && (
                      <p className="text-green-500 text-[10px] mt-0.5">✓ From verified address</p>
                    )}
                  </div>
                </div>
                <div>
                  <AddressInput
                    value={address}
                    onChange={(value: string, details?: AddressDetails) => {
                      setAddress(value);
                      if (details) {
                        if (details.postcode) setPostcode(details.postcode);
                        if (details.lat && details.lng) {
                          setCoordinates({ lat: details.lat, lng: details.lng });
                        }
                        setAddressValidated(true);
                      }
                    }}
                    isValidated={addressValidated}
                    onValidationChange={setAddressValidated}
                    placeholder="Start typing address..."
                  />
                  {coordinates && (
                    <p className="text-muted-foreground text-[10px] mt-0.5">
                      📍 {coordinates.lat.toFixed(4)}, {coordinates.lng.toFixed(4)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ─── Section 3: Jobs (structured line-item slabs) ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-3">
                  <span>Jobs</span>
                  <div className="flex items-center gap-3">
                    {/* Detail toggle — when on, every line gets an auto-drafted "what's included" textarea */}
                    <Label
                      htmlFor="show-line-details"
                      className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground cursor-pointer select-none"
                    >
                      <Wand2 className="w-3 h-3 text-amber-400/70" />
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
                                autoDraftLineDetail(li.id, li.description, li.category, vaContext);
                              }
                            }
                          }
                        }}
                      />
                    </Label>
                    {lineItems.length > 0 && (
                      <Badge variant="outline" className="text-xs">
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
                    className="text-center py-8 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-amber-500/30 hover:bg-amber-500/5 transition-all"
                    onClick={handleAddLineItem}
                  >
                    <Plus className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Add first job</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">One box per job — you decide the scope</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lineItems.map((item, index) => {
                      const icon = CATEGORY_ICONS[item.category] || '🔨';
                      const categoryLabel = CATEGORY_LABELS[item.category] || 'General';
                      const hasMaterials = item.materialsCostPounds > 0;
                      const isPolishing = polishingIds.has(item.id);

                      return (
                        <div
                          key={item.id}
                          className={`rounded-xl border bg-white/[0.02] p-3 sm:p-4 space-y-3 relative group transition-colors ${
                            isPolishing ? 'border-amber-500/30' : 'border-white/10'
                          }`}
                        >
                          {/* Header: Job number + delete */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                                Job {index + 1}
                              </span>
                              {isPolishing && (
                                <span className="flex items-center gap-1 text-[10px] text-amber-400/70 animate-pulse">
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

                          {/* Description input — AI polishes on blur */}
                          <Input
                            placeholder="e.g. Fix leaking tap, Mount TV..."
                            value={item.description}
                            onChange={(e) => handleUpdateLineItem(item.id, 'description', e.target.value)}
                            onBlur={() => handlePolishDescription(item.id, item.description)}
                            className={`text-sm font-medium bg-transparent border-white/10 focus:border-amber-500/50 h-11 sm:h-10 transition-all ${
                              isPolishing ? 'opacity-60' : ''
                            }`}
                          />

                          {/* Detail textarea — gated on the global "Detail" toggle, auto-drafted after polish */}
                          {showLineDetails && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <Label htmlFor={`line-detail-${item.id}`} className="text-[10px] text-muted-foreground/70">
                                  Detail
                                </Label>
                                <div className="flex items-center gap-2">
                                  {(draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id)) && (
                                    <span className="flex items-center gap-1 text-[10px] text-amber-400/70 animate-pulse">
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
                                      autoDraftLineDetail(item.id, item.description, item.category, vaContext);
                                    }}
                                    className="text-muted-foreground/60 hover:text-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                                className={`text-xs bg-transparent border-white/10 focus:border-amber-500/50 resize-none transition-all ${
                                  draftingDetailIds.has(item.id) || polishingDetailIds.has(item.id) ? 'opacity-60' : ''
                                }`}
                              />
                            </div>
                          )}

                          {/* Category + Time — stacked on mobile, side-by-side on sm+ */}
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Select
                              value={item.category}
                              onValueChange={(val) => handleUpdateLineItem(item.id, 'category', val)}
                            >
                              <SelectTrigger className="h-10 sm:h-9 text-sm sm:text-xs bg-transparent border-white/10 w-full sm:flex-1">
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
                              <TimeInput
                                minutes={item.estimatedMinutes}
                                onChange={(val) => handleUpdateLineItem(item.id, 'estimatedMinutes', val)}
                                compact
                              />
                            </div>
                          </div>

                          {/* Materials toggle */}
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => handleUpdateLineItem(item.id, 'materialsCostPounds', hasMaterials ? 0 : 1)}
                              className={`text-sm sm:text-xs px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-full border transition-all ${
                                hasMaterials
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                                  : 'border-white/10 text-muted-foreground/50 hover:border-white/20'
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
                                  className="w-24 sm:w-20 h-10 sm:h-8 text-center text-sm bg-transparent border-white/10"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add another job */}
                {lineItems.length > 0 && lineItems.length < 10 && (
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-white/10 text-sm text-muted-foreground hover:border-amber-500/30 hover:text-amber-300 hover:bg-amber-500/5 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add another job
                  </button>
                )}

                {lineItems.length === 1 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <span className="text-amber-400 text-sm">💡</span>
                    <p className="text-xs text-amber-300/80">
                      Anything else to sort while we're there? Multi-job quotes convert 2× better.
                    </p>
                  </div>
                )}

                {/* Job description is auto-derived from line items in the submit handler */}

                {/* Live Engine Price Preview */}
                {lineItems.length > 0 && (
                  <>
                    <Separator />
                    {livePreviewLoading && !livePreview ? (
                      <div className="flex items-center justify-center gap-2 py-3">
                        <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                        <span className="text-sm text-muted-foreground">Calculating price...</span>
                      </div>
                    ) : livePreview ? (
                      <div className="space-y-2">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                            Engine Breakdown
                          </span>
                          {livePreview.confidence && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${
                                livePreview.confidence === 'high'
                                  ? 'border-green-500/40 text-green-400'
                                  : livePreview.confidence === 'medium'
                                    ? 'border-amber-500/40 text-amber-400'
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

                        {/* Final total */}
                        <div className="flex items-center justify-between py-2 border-t border-amber-500/20 mt-2">
                          <span className="text-sm font-semibold text-foreground">
                            Engine Total
                            {livePreviewLoading && <Loader2 className="w-3 h-3 animate-spin inline ml-1.5" />}
                          </span>
                          <span className="text-2xl font-bold text-amber-400 tabular-nums">
                            £{(livePreview.finalPricePence / 100).toFixed(0)}
                          </span>
                        </div>

                        {/* Guardrail flags */}
                        {(livePreview.guardrails?.floorTriggered || livePreview.guardrails?.ceilingTriggered || (livePreview.guardrails?.adjustments?.length ?? 0) > 0) && (
                          <div className="space-y-0.5 pt-1">
                            {livePreview.guardrails.floorTriggered && (
                              <p className="text-[10px] text-amber-400/80">⚠ Floor triggered on at least one line — price raised to margin floor.</p>
                            )}
                            {livePreview.guardrails.ceilingTriggered && (
                              <p className="text-[10px] text-amber-400/80">⚠ Ceiling triggered on at least one line — capped at 3× reference.</p>
                            )}
                          </div>
                        )}

                        <p className="text-[10px] text-muted-foreground/60 italic">
                          Live from contextual pricing engine — Layer 1 reference + Layer 3 LLM + Layer 4 guardrails.
                        </p>

                        {/* Live margin preview */}
                        {liveMarginPreview && (
                          <div className="mt-3">
                            <MarginPreviewPanel data={liveMarginPreview} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-sm text-muted-foreground text-amber-500/70">Engine price unavailable — add a description and time estimate to see live pricing</span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* ─── Section 3b: Assign Contractor ─── */}
            {contractors && contractors.length > 0 && (
              <Card>
                <CardHeader className="pb-2 px-3 sm:px-6">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Assign Handyman
                    {selectedContractorId && (
                      <button
                        type="button"
                        onClick={() => setSelectedContractorId(null)}
                        className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors font-normal"
                      >
                        × Remove
                      </button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 sm:px-6">
                  <div className="space-y-2">
                    {/* Auto-suggest banner — compact on mobile */}
                    {suggestedContractor && !selectedContractorId && (
                      <div
                        className="flex items-center gap-2 sm:gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 sm:px-3 py-1.5 sm:py-2 cursor-pointer hover:bg-amber-500/15 transition-colors"
                        onClick={() => setSelectedContractorId(suggestedContractor.id)}
                      >
                        {suggestedContractor.profileImageUrl ? (
                          <img
                            src={suggestedContractor.profileImageUrl}
                            alt=""
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover border-2 border-amber-500/40 shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
                            {suggestedContractor.name.charAt(0)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs sm:text-sm font-medium text-amber-300 truncate">
                            Suggested: {suggestedContractor.name}
                          </div>
                          <div className="text-[10px] sm:text-[11px] text-amber-400/70 truncate">
                            {suggestedContractor.matchPercent}% match
                            {suggestedContractor.availabilityStatus === 'available' && ' · Available'}
                          </div>
                        </div>
                        <span className="text-[10px] sm:text-xs text-amber-400 font-medium shrink-0">Assign →</span>
                      </div>
                    )}

                    {/* ── Mobile: horizontal compact rows ── */}
                    <div className="sm:hidden space-y-1.5">
                      {contractors.map((c) => {
                        const isSelected = selectedContractorId === c.id;
                        const isSuggested = suggestedContractor?.id === c.id;
                        const jobCategories = lineItems.map(li => li.category);
                        const matchCount = jobCategories.filter(cat => c.categorySlugs.includes(cat)).length;
                        const isAvailable = c.availabilityStatus === 'available';

                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedContractorId(isSelected ? null : c.id)}
                            className={`w-full flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all ${
                              isSelected
                                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                                : 'border-border hover:border-muted-foreground/50 hover:bg-muted/30'
                            }`}
                          >
                            {/* Avatar */}
                            <div className="relative shrink-0">
                              {c.profileImageUrl ? (
                                <img
                                  src={c.profileImageUrl}
                                  alt=""
                                  className={`w-8 h-8 rounded-full object-cover border-2 ${
                                    isSelected ? 'border-primary' : 'border-border'
                                  }`}
                                />
                              ) : (
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                                  isSelected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                                }`}>
                                  {c.name.charAt(0)}
                                </div>
                              )}
                              {isAvailable && (
                                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border border-background" />
                              )}
                            </div>
                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-foreground truncate block">{c.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {lineItems.length > 0 && matchCount > 0 ? `${matchCount}/${jobCategories.length} match` : isAvailable ? 'Available' : ''}
                              </span>
                            </div>
                            {/* Badges — right side */}
                            {isSuggested && !isSelected && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/40 text-amber-400 shrink-0">
                                Best
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge className="text-[9px] px-1.5 py-0 bg-primary/20 text-primary border-primary/30 shrink-0">
                                ✓
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* ── Desktop: card grid ── */}
                    <div className="hidden sm:grid sm:grid-cols-3 gap-2">
                      {contractors.map((c) => {
                        const isSelected = selectedContractorId === c.id;
                        const isSuggested = suggestedContractor?.id === c.id;
                        const jobCategories = lineItems.map(li => li.category);
                        const matchCount = jobCategories.filter(cat => c.categorySlugs.includes(cat)).length;
                        const isAvailable = c.availabilityStatus === 'available';

                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedContractorId(isSelected ? null : c.id)}
                            className={`relative flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-center transition-all ${
                              isSelected
                                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                                : 'border-border hover:border-muted-foreground/50 hover:bg-muted/30'
                            }`}
                          >
                            {isAvailable && (
                              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            )}
                            {c.profileImageUrl ? (
                              <img
                                src={c.profileImageUrl}
                                alt=""
                                className={`w-10 h-10 rounded-full object-cover border-2 ${
                                  isSelected ? 'border-primary' : 'border-border'
                                }`}
                              />
                            ) : (
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                                isSelected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                              }`}>
                                {c.name.charAt(0)}
                              </div>
                            )}
                            <span className="text-xs font-medium text-foreground truncate w-full">{c.name}</span>
                            {lineItems.length > 0 && matchCount > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {matchCount}/{jobCategories.length} skills match
                              </span>
                            )}
                            {isSuggested && !isSelected && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/40 text-amber-400">
                                Best match
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge className="text-[9px] px-1 py-0 bg-primary/20 text-primary border-primary/30">
                                Assigned
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <p className="text-[10px] sm:text-[11px] text-muted-foreground/60 flex items-center gap-1">
                      <Info className="w-3 h-3 shrink-0" />
                      Contractor appears on customer quote page
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Old Section 4 removed — line items now in unified Jobs section above */}

            {/* ─── Section 4b: VA Context ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Customer Context</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-zinc-300">
                      Customer Context
                    </label>
                    <span className="text-xs text-zinc-500">Speak or type — who are they, what's their situation</span>
                  </div>

                  {/* Record button */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleToggleRecording}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        isRecording
                          ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                          : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-500'
                      }`}
                    >
                      <span>{isRecording ? '⏹ Stop' : '🎙 Record'}</span>
                      {isRecording && <span className="text-xs">Recording...</span>}
                    </button>
                    {recordingError && (
                      <span className="text-xs text-red-400 self-center">{recordingError}</span>
                    )}
                  </div>

                  {/* Text area */}
                  <textarea
                    value={vaContext}
                    onChange={(e) => setVaContext(e.target.value)}
                    placeholder="e.g. Sarah's a landlord, rental in Beeston, tenant flagged a dripping tap. She won't be there, relaxed about timing, asked about price briefly but didn't push back."
                    className="w-full h-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
                  />

                  {/* Context quality indicator */}
                  {vaContext.trim().length > 0 && (
                    <div className={`flex items-center gap-2 text-xs ${
                      vaContext.trim().length < 50 ? 'text-amber-400' :
                      vaContext.trim().length < 120 ? 'text-lime-400' :
                      'text-emerald-400'
                    }`}>
                      <span>{
                        vaContext.trim().length < 50 ? '○ Thin context — add more if you can' :
                        vaContext.trim().length < 120 ? '◑ Good context' :
                        '● Rich context — great'
                      }</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ─── Section 5: Pricing Signals ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pricing Signals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 2x2 grid of signal fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Urgency</Label>
                    <Select value={signals.urgency} onValueChange={(v: ContextSignals['urgency']) => setSignals((s) => ({ ...s, urgency: v }))}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="priority">Priority</SelectItem>
                        <SelectItem value="emergency">Emergency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Materials</Label>
                    <Select value={signals.materialsSupply} onValueChange={(v: ContextSignals['materialsSupply']) => setSignals((s) => ({ ...s, materialsSupply: v }))}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="we_supply">We Supply</SelectItem>
                        <SelectItem value="customer_supplied">Customer Supplies</SelectItem>
                        <SelectItem value="labor_only">Labour Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Scheduling</Label>
                    <Select value={signals.timeOfService} onValueChange={(v: ContextSignals['timeOfService']) => setSignals((s) => ({ ...s, timeOfService: v }))}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Weekday</SelectItem>
                        <SelectItem value="after_hours">Evening</SelectItem>
                        <SelectItem value="weekend">Weekend</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end pb-0.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Switch
                        checked={signals.isReturningCustomer}
                        onCheckedChange={(c) =>
                          setSignals((s) => ({
                            ...s,
                            isReturningCustomer: c,
                            previousJobCount: c ? s.previousJobCount || 1 : 0,
                            previousAvgPricePence: c ? s.previousAvgPricePence || 0 : 0,
                          }))
                        }
                      />
                      <span>Returning Customer</span>
                    </label>
                  </div>
                </div>

                {/* Conditional returning customer sub-fields */}
                {signals.isReturningCustomer && (
                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Previous Jobs</Label>
                      <Input
                        type="number"
                        min={1}
                        value={signals.previousJobCount}
                        onChange={(e) => setSignals((s) => ({ ...s, previousJobCount: parseInt(e.target.value) || 1 }))}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Avg Previous Spend ({"\u00A3"})</Label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="75"
                        value={signals.previousAvgPricePence ? (signals.previousAvgPricePence / 100).toFixed(0) : ''}
                        onChange={(e) =>
                          setSignals((s) => ({
                            ...s,
                            previousAvgPricePence: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : 0,
                          }))
                        }
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* Behavioural signals — what the VA noticed on the call */}
                <div className="space-y-2 border-t border-border pt-3">
                  <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">What you noticed on the call</label>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { key: 'isCommercialPremises', label: 'Commercial premises' },
                      { key: 'wontBePresent', label: "Won't be present" },
                      { key: 'priceConscious', label: 'Price-conscious' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={behavioralSignals[key as keyof typeof behavioralSignals]}
                          onChange={(e) => setBehavioralSignals(prev => ({ ...prev, [key]: e.target.checked }))}
                          className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 accent-lime-500"
                        />
                        <span className="text-sm text-zinc-300 group-hover:text-zinc-100">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ─── Section 5a: Optional Extras (library + custom) ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Optional Extras</CardTitle>
                <p className="text-xs text-zinc-500">
                  Add-ons the customer can tick on their quote page. Pick from the library or add custom.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Library picker */}
                {activeExtrasCatalog.length > 0 ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">From the library</Label>
                    <div className="space-y-1.5">
                      {activeExtrasCatalog.map((entry) => {
                        const checked = optionalExtras.some((e) => e.catalogId === entry.id);
                        return (
                          <label
                            key={entry.id}
                            className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
                              checked
                                ? 'border-amber-500/40 bg-amber-500/10'
                                : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
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
                                      label: entry.label,
                                      description: entry.description,
                                      priceInPence: entry.priceInPence,
                                      badge: entry.badge ?? undefined,
                                      catalogId: entry.id,
                                    },
                                  ]);
                                } else {
                                  setOptionalExtras((prev) => prev.filter((x) => x.catalogId !== entry.id));
                                }
                              }}
                              className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-800 accent-amber-500 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-foreground">{entry.label}</span>
                                {entry.badge && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-400">
                                    {entry.badge}
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                                  £{(entry.priceInPence / 100).toFixed(0)}
                                </span>
                              </div>
                              {entry.description && (
                                <p className="text-[11px] text-muted-foreground/70 mt-0.5">{entry.description}</p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/60">No library extras yet — add a custom one below.</p>
                )}

                {/* Selected list (custom + picked) */}
                {optionalExtras.length > 0 && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <Label className="text-xs text-muted-foreground">Selected for this quote ({optionalExtras.length})</Label>
                    <div className="space-y-1.5">
                      {optionalExtras.map((extra, idx) => (
                        <div
                          key={`${extra.catalogId ?? 'custom'}-${idx}`}
                          className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">{extra.label}</span>
                              {extra.badge && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-400">
                                  {extra.badge}
                                </Badge>
                              )}
                              {!extra.catalogId && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-500/40 text-zinc-400">
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
                    <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                      <Label className="text-xs text-amber-300">New custom extra</Label>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Label</Label>
                        <Input
                          placeholder="e.g. Hallway clean-up"
                          value={customExtraDraft.label}
                          onChange={(e) => setCustomExtraDraft((d) => ({ ...d, label: e.target.value }))}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Description</Label>
                        <Textarea
                          placeholder="What's included…"
                          value={customExtraDraft.description}
                          onChange={(e) => setCustomExtraDraft((d) => ({ ...d, description: e.target.value }))}
                          rows={2}
                          className="mt-1 text-xs resize-none"
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
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Badge (optional)</Label>
                          <Input
                            placeholder="Popular"
                            value={customExtraDraft.badge}
                            onChange={(e) => setCustomExtraDraft((d) => ({ ...d, badge: e.target.value }))}
                            className="mt-1 h-8 text-xs"
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

            {/* ─── Section 5b: Available Dates (required) ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Available Dates <span className="text-red-500">*</span>
                </CardTitle>
                <p className="text-xs text-zinc-500">
                  Pick the dates the customer can book. Only selected dates will show as available on the quote.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Month nav */}
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDatePickerMonth(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() - 1);
                      return d;
                    })}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-medium">
                    {formatDate(datePickerMonth, 'MMMM yyyy')}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDatePickerMonth(prev => {
                      const d = new Date(prev);
                      d.setMonth(d.getMonth() + 1);
                      return d;
                    })}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                {/* Day headers */}
                <div className="grid grid-cols-7 gap-1">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} className="text-center text-[10px] font-medium text-zinc-500 uppercase py-1">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: getDay(startOfMonth(datePickerMonth)) }).map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square" />
                  ))}
                  {Array.from({ length: getDaysInMonth(datePickerMonth) }).map((_, i) => {
                    const day = i + 1;
                    const year = datePickerMonth.getFullYear();
                    const month = datePickerMonth.getMonth();
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const dateObj = new Date(year, month, day);
                    const isPast = dateObj < today;
                    const isToday = dateObj.getTime() === today.getTime();
                    const isSelected = availableDates.includes(dateStr);

                    return (
                      <button
                        key={day}
                        type="button"
                        disabled={isPast}
                        onClick={() => {
                          setAvailableDates(prev =>
                            prev.includes(dateStr)
                              ? prev.filter(d => d !== dateStr)
                              : [...prev, dateStr].sort()
                          );
                        }}
                        className={`
                          aspect-square rounded-md text-xs font-medium transition-all
                          ${isPast ? 'text-zinc-700 cursor-not-allowed' : 'cursor-pointer'}
                          ${isSelected
                            ? 'bg-lime-500/30 border-2 border-lime-400 text-lime-100'
                            : isPast
                              ? 'bg-transparent'
                              : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                          }
                          ${isToday ? 'ring-1 ring-blue-400' : ''}
                        `}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>

                {/* Selected summary */}
                <div className="text-xs text-zinc-500 flex items-center justify-between pt-1">
                  <span>
                    {availableDates.length === 0
                      ? <span className="text-amber-400">No dates selected — pick at least one</span>
                      : <>{availableDates.length} date{availableDates.length === 1 ? '' : 's'} selected</>
                    }
                  </span>
                  {availableDates.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-zinc-400"
                      onClick={() => setAvailableDates([])}
                    >
                      Clear all
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ─── Section 6: Generate Button ─── */}
            <Button
              size="lg"
              className="w-full h-12 text-base font-semibold bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleGenerate}
              disabled={!canGenerate || createQuoteMutation.isPending}
            >
              {createQuoteMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating Quote...
                </>
              ) : (
                'Generate Quote'
              )}
            </Button>
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

            {/* Quote Summary Card */}
            <Card className="border border-amber-500/30 bg-amber-500/5">
              <CardContent className="pt-6 space-y-4">
                {/* Headline */}
                <div className="text-center">
                  <h2 className="text-xl font-bold text-foreground">{quoteResult.messaging.headline}</h2>
                  <div className="mt-2">
                    <Badge
                      variant="outline"
                      className={
                        quoteResult.messaging.layoutTier === 'quick'
                          ? 'border-green-500/40 text-green-400'
                          : quoteResult.messaging.layoutTier === 'standard'
                          ? 'border-blue-500/40 text-blue-400'
                          : 'border-purple-500/40 text-purple-400'
                      }
                    >
                      {quoteResult.messaging.layoutTier.charAt(0).toUpperCase() + quoteResult.messaging.layoutTier.slice(1)} Quote
                    </Badge>
                  </div>
                </div>

                {/* Total Price */}
                <div className="bg-muted rounded-lg p-4 text-center border border-amber-500/30">
                  <div className="text-xs text-amber-400 uppercase font-semibold mb-1">Total Price</div>
                  <div className="text-3xl sm:text-4xl font-bold text-amber-400">
                    {quoteResult.pricing.totalFormatted}
                  </div>
                </div>

                {/* Line Item Breakdown */}
                {quoteResult.pricing.lineItems.length > 1 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground font-semibold uppercase">Breakdown</div>
                    {quoteResult.pricing.lineItems.map((li) => (
                      <div key={li.lineId} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-1.5">
                        <span className="text-foreground truncate mr-3">{li.description}</span>
                        <span className="text-foreground font-medium shrink-0">
                          {"\u00A3"}{(li.guardedPricePence / 100).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Batch Discount */}
                {quoteResult.pricing.batchDiscount.applied && (
                  <div className="flex items-center justify-between text-sm bg-green-500/10 rounded px-3 py-1.5 border border-green-500/20">
                    <span className="text-green-400">
                      Batch discount ({quoteResult.pricing.batchDiscount.discountPercent}%)
                    </span>
                    <span className="text-green-400 font-medium">
                      -{"\u00A3"}{(quoteResult.pricing.batchDiscount.savingsPence / 100).toFixed(0)}
                    </span>
                  </div>
                )}

                {/* Booking Modes */}
                <div className="flex flex-wrap gap-1.5">
                  {quoteResult.messaging.bookingModes.map((mode) => (
                    <Badge key={mode} variant="secondary" className="text-xs">
                      {mode.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Margin Preview (from created quote) */}
            {quoteResult.marginPreview && (
              <MarginPreviewPanel data={quoteResult.marginPreview} />
            )}

            {/* WhatsApp Send Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
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
                className="flex-1 h-9 text-sm border-[#7DB00E]/40 text-[#7DB00E] hover:bg-[#7DB00E]/10"
              >
                <Eye className="w-4 h-4 mr-1.5" />Preview & Edit
              </Button>
              <Button variant="ghost" onClick={handleReset} className="flex-1 h-9 text-sm">
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
    </div>
  );
}
