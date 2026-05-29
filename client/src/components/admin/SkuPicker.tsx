/**
 * SkuPicker — Phase 25c
 *
 * Catalog-driven SKU picker for the admin contextual quote builder. Replaces
 * free-text description + category + time inputs with a single deterministic
 * pick when the line came from the SKU catalog.
 *
 * Shapes supported (mirrors `serviceCatalog` schema):
 *   - 'fixed'    → flat pricePence + scheduleMinutes
 *   - 'per_unit' → priceBuilds from unitCount × pricePerUnitPence (+ setup)
 *   - 'tiered'   → choose one of tiers[]; price + minutes follow that pick
 *
 * Surface consists of:
 *   1. <SkuSlabSummary />   — what shows on a picked line in the parent slab
 *   2. <SkuSearchModal />   — typeahead modal that fires when admin clicks Edit
 *
 * Pick telemetry is fire-and-forget: POST /api/admin/sku-catalog/:sku/pick.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Loader2, Search, Clock, Tag, Package, Layers, X, Star, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ──────────────────────────────────────────────────────────────────────────
// Types — mirror server `serviceCatalog` shape, kept loose because rows are
// dynamic JSONB-bearing values from a raw GET; we trust the server schema.
// ──────────────────────────────────────────────────────────────────────────

export interface CatalogSkuTier {
  label: string;
  pricePence: number;
  scheduleMinutes: number;
}

export interface CatalogSku {
  id: number;
  skuCode: string;
  name: string;
  category: string;
  shape: 'fixed' | 'per_unit' | 'tiered';
  pricePence: number | null;
  scheduleMinutes: number | null;
  unitLabel: string | null;
  pricePerUnitPence: number | null;
  minimumUnits: number | null;
  minutesPerUnit: number | null;
  setupMinutes: number | null;
  tiers: CatalogSkuTier[] | null;
  customerDescription: string;
  adminDescription: string | null;
  flexEligible: boolean;
  offPeakWeekendPremiumPence: number;
  pickCount: number;
  isActive: boolean;
}

/** Outcome the parent receives when admin picks a SKU. */
export interface SkuPickResult {
  sku: CatalogSku;
  /** Derived price for the *currently selected* shape inputs. */
  derivedPricePence: number;
  /** Derived schedule minutes for the *currently selected* shape inputs. */
  derivedScheduleMinutes: number;
  /** For per_unit: chosen count (default = minimumUnits). */
  unitCount?: number;
  /** For tiered: tier label (default = first tier). */
  selectedTier?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatMinutes(min: number): string {
  if (min >= 60) {
    const hrs = min / 60;
    const rounded = Math.round(hrs * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded}h`;
  }
  return `${min}m`;
}

function formatPounds(pence: number): string {
  return `£${Math.round(pence / 100)}`;
}

/**
 * Derive a representative price + minutes for the SKU as currently displayed
 * in the picker results (before the admin commits). For tiered/per-unit we
 * use the minimum / first tier so the result rows show *something*.
 */
function previewSkuPriceAndMinutes(sku: CatalogSku): { price: number; minutes: number } {
  if (sku.shape === 'fixed') {
    return { price: sku.pricePence ?? 0, minutes: sku.scheduleMinutes ?? 0 };
  }
  if (sku.shape === 'per_unit') {
    const count = Math.max(1, sku.minimumUnits ?? 1);
    const price = (sku.pricePerUnitPence ?? 0) * count;
    const minutes = (sku.minutesPerUnit ?? 0) * count + (sku.setupMinutes ?? 0);
    return { price, minutes };
  }
  // tiered
  const first = sku.tiers?.[0];
  if (first) return { price: first.pricePence, minutes: first.scheduleMinutes };
  return { price: 0, minutes: 0 };
}

function shapeMeta(shape: CatalogSku['shape']): { label: string; Icon: typeof Tag } {
  switch (shape) {
    case 'fixed':
      return { label: 'Fixed', Icon: Tag };
    case 'per_unit':
      return { label: 'Per unit', Icon: Package };
    case 'tiered':
      return { label: 'Tiered', Icon: Layers };
  }
}

/** Fire-and-forget pick telemetry. */
function recordPick(skuCode: string): void {
  void fetch(`/api/admin/sku-catalog/${encodeURIComponent(skuCode)}/pick`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
  }).catch(() => {
    // Silently swallow — telemetry is non-critical.
  });
}

// ──────────────────────────────────────────────────────────────────────────
// SkuSearchModal — typeahead search with debounce, server-driven results
// ──────────────────────────────────────────────────────────────────────────

interface SkuSearchModalProps {
  open: boolean;
  onClose: () => void;
  onPick: (result: SkuPickResult) => void;
  /** Optional initial query to seed the input (e.g. existing description) */
  initialQuery?: string;
}

export function SkuSearchModal({ open, onClose, onPick, initialQuery = '' }: SkuSearchModalProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<CatalogSku[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reseed query when modal reopens with a different initial value
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      // Autofocus the input after the dialog finishes opening
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialQuery]);

  // Debounced search — 200ms after last keystroke
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      runSearch(query);
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  async function runSearch(q: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/admin/sku-catalog/search?${params.toString()}`, {
        headers: { ...getAuthHeaders() },
        signal: controller.signal,
      });
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data = await res.json();
      setResults(Array.isArray(data?.results) ? data.results : []);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setResults([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function handlePick(sku: CatalogSku) {
    const preview = previewSkuPriceAndMinutes(sku);
    const unitCount = sku.shape === 'per_unit' ? Math.max(1, sku.minimumUnits ?? 1) : undefined;
    const selectedTier = sku.shape === 'tiered' ? sku.tiers?.[0]?.label : undefined;
    recordPick(sku.skuCode);
    onPick({
      sku,
      derivedPricePence: preview.price,
      derivedScheduleMinutes: preview.minutes,
      unitCount,
      selectedTier,
    });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden bg-white border-handy-grid">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b border-handy-grid">
          <DialogTitle className="text-handy-navy text-base font-bold tracking-tight">
            Pick a SKU from the catalog
          </DialogTitle>
          <DialogDescription className="text-handy-muted text-xs">
            Search by name, code, or what the customer said — most-picked SKUs first.
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="px-4 sm:px-6 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-handy-muted" />
            <Input
              ref={inputRef}
              placeholder="e.g. mixer tap, tv mount, flat pack…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-10 text-sm bg-white border-handy-grid focus:border-handy-yellow"
            />
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto px-2 sm:px-3 pb-3">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-handy-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching catalog…
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-sm text-handy-muted">
              {query.trim()
                ? 'No matching SKUs — try a different word, or use Custom for novel work.'
                : 'No SKUs to show.'}
            </div>
          ) : (
            <div className="space-y-1 py-1">
              {results.map((sku) => {
                const { price, minutes } = previewSkuPriceAndMinutes(sku);
                const { label: shapeLabel, Icon: ShapeIcon } = shapeMeta(sku.shape);
                return (
                  <button
                    key={sku.skuCode}
                    type="button"
                    onClick={() => handlePick(sku)}
                    className="w-full text-left rounded-lg border border-handy-grid bg-white hover:bg-handy-navy/5 hover:border-handy-navy/40 px-3 py-2.5 transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99] group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-handy-navy truncate">
                            {sku.name}
                          </span>
                          <span className="text-[10px] font-mono text-handy-muted/70 truncate">
                            {sku.skuCode}
                          </span>
                        </div>
                        {sku.customerDescription && (
                          <p className="text-[11px] text-handy-muted mt-0.5 line-clamp-2">
                            {sku.customerDescription}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <Badge
                            variant="outline"
                            className="text-[9px] h-4 px-1.5 border-handy-grid bg-handy-cream text-handy-navy gap-1"
                          >
                            <ShapeIcon className="w-2.5 h-2.5" />
                            {shapeLabel}
                          </Badge>
                          {sku.pickCount > 0 && (
                            <span className="text-[9px] text-handy-muted flex items-center gap-0.5">
                              <Star className="w-2.5 h-2.5 text-handy-yellow fill-handy-yellow" />
                              {sku.pickCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-bold text-handy-navy tabular-nums">
                          {formatPounds(price)}
                        </div>
                        <div className="text-[10px] text-handy-muted flex items-center justify-end gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {formatMinutes(minutes)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SkuSlabSummary — visible state on the parent line slab once a SKU is picked
// ──────────────────────────────────────────────────────────────────────────

interface SkuSlabSummaryProps {
  /** SKU details — passed in by the parent (kept in slab-local state). */
  sku: CatalogSku;
  unitCount?: number;
  selectedTier?: string;
  onChangeUnitCount: (next: number) => void;
  onChangeSelectedTier: (next: string) => void;
  onEdit: () => void;
  onClear: () => void;
}

export function SkuSlabSummary({
  sku,
  unitCount,
  selectedTier,
  onChangeUnitCount,
  onChangeSelectedTier,
  onEdit,
  onClear,
}: SkuSlabSummaryProps) {
  const { label: shapeLabel, Icon: ShapeIcon } = shapeMeta(sku.shape);

  // Compute the effective price + minutes for the current selection so the
  // slab always shows the *real* numbers the engine will use server-side.
  const effective = useMemo(() => {
    if (sku.shape === 'fixed') {
      return { price: sku.pricePence ?? 0, minutes: sku.scheduleMinutes ?? 0 };
    }
    if (sku.shape === 'per_unit') {
      const count = Math.max(1, unitCount ?? sku.minimumUnits ?? 1);
      const price = (sku.pricePerUnitPence ?? 0) * count;
      const minutes = (sku.minutesPerUnit ?? 0) * count + (sku.setupMinutes ?? 0);
      return { price, minutes };
    }
    // tiered
    const t = sku.tiers?.find((x) => x.label === selectedTier) || sku.tiers?.[0];
    return { price: t?.pricePence ?? 0, minutes: t?.scheduleMinutes ?? 0 };
  }, [sku, unitCount, selectedTier]);

  return (
    <div className="rounded-lg border-2 border-handy-navy/15 bg-handy-cream/40 px-3 py-2.5 space-y-2">
      {/* Header — name + price + duration */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-handy-navy truncate">{sku.name}</span>
            <Badge
              variant="outline"
              className="text-[9px] h-4 px-1.5 border-handy-navy/30 bg-white text-handy-navy/80 gap-1 shrink-0"
            >
              <ShapeIcon className="w-2.5 h-2.5" />
              {shapeLabel}
            </Badge>
          </div>
          {sku.customerDescription && (
            <p className="text-[11px] text-handy-muted mt-0.5 line-clamp-2">
              {sku.customerDescription}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-handy-navy tabular-nums leading-none">
            {formatPounds(effective.price)}
          </div>
          <div className="text-[10px] text-handy-muted flex items-center justify-end gap-0.5 mt-0.5">
            <Clock className="w-2.5 h-2.5" />
            {formatMinutes(effective.minutes)}
          </div>
        </div>
      </div>

      {/* Per-unit count stepper */}
      {sku.shape === 'per_unit' && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-handy-muted">
            {sku.unitLabel ? sku.unitLabel : 'count'}:
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() =>
                onChangeUnitCount(
                  Math.max(sku.minimumUnits ?? 1, (unitCount ?? sku.minimumUnits ?? 1) - 1),
                )
              }
              className="h-8 w-8 rounded-md border border-handy-grid bg-white text-sm font-bold text-handy-navy hover:bg-handy-navy/5 active:scale-95 transition-transform flex items-center justify-center"
              aria-label="Decrease count"
            >
              −
            </button>
            <div className="h-8 min-w-[2.5rem] px-2 rounded-md border border-handy-grid bg-white flex items-center justify-center text-sm font-semibold text-handy-navy tabular-nums">
              {unitCount ?? sku.minimumUnits ?? 1}
            </div>
            <button
              type="button"
              onClick={() => onChangeUnitCount((unitCount ?? sku.minimumUnits ?? 1) + 1)}
              className="h-8 w-8 rounded-md border border-handy-grid bg-white text-sm font-bold text-handy-navy hover:bg-handy-navy/5 active:scale-95 transition-transform flex items-center justify-center"
              aria-label="Increase count"
            >
              +
            </button>
          </div>
          {sku.minimumUnits && sku.minimumUnits > 1 && (
            <span className="text-[10px] text-handy-muted/70">min {sku.minimumUnits}</span>
          )}
        </div>
      )}

      {/* Tiered tier picker */}
      {sku.shape === 'tiered' && sku.tiers && sku.tiers.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          {sku.tiers.map((t) => {
            const isSelected = (selectedTier ?? sku.tiers?.[0]?.label) === t.label;
            return (
              <button
                key={t.label}
                type="button"
                onClick={() => onChangeSelectedTier(t.label)}
                className={`h-8 px-2.5 rounded-md text-[11px] font-semibold border transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
                  isSelected
                    ? 'bg-handy-yellow text-handy-navy border-handy-yellow shadow-sm'
                    : 'bg-white text-handy-navy/70 border-handy-grid hover:border-handy-navy/40'
                }`}
              >
                <span>{t.label}</span>
                <span className="ml-1 text-[9px] opacity-70 tabular-nums">
                  {formatPounds(t.pricePence)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-1.5 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] text-handy-navy hover:text-handy-navy hover:bg-handy-navy/5 px-2"
          onClick={onEdit}
        >
          <Search className="w-3 h-3 mr-1" /> Edit SKU
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-[11px] text-handy-muted hover:text-red-500 hover:bg-red-500/5 px-2 ml-auto"
          onClick={onClear}
        >
          <X className="w-3 h-3 mr-1" /> Clear
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SkuEmptyPickButton — shown when source==='sku' but nothing picked yet
// ──────────────────────────────────────────────────────────────────────────

interface SkuEmptyPickButtonProps {
  onClick: () => void;
}

export function SkuEmptyPickButton({ onClick }: SkuEmptyPickButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border-2 border-dashed border-handy-yellow/60 bg-handy-cream hover:border-handy-yellow hover:bg-handy-cream/80 px-3 py-3 flex items-center justify-center gap-2 transition-[transform,background-color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]"
    >
      <Search className="w-4 h-4 text-handy-yellow" />
      <span className="text-sm font-semibold text-handy-navy">Pick a SKU from the catalog</span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// InlineSkuAutocomplete — Phase 25d
//
// Replaces the SKU↔Custom toggle. The line's *description* field doubles as a
// catalog search box: as the admin types, matching SKUs drop in beneath the
// input. Pick one → the line becomes a SKU line (parent flips it via
// onPickSku). Type and walk away without picking → the text simply stays as a
// custom description (parent already treats source!=='sku' as custom).
//
// The component is intentionally controlled on `value` so the parent owns the
// description string; everything else (results, dropdown open/highlight) is
// local.
// ──────────────────────────────────────────────────────────────────────────

interface InlineSkuAutocompleteProps {
  /** Controlled line description — doubles as the search query. */
  value: string;
  /** Write the typed text back to the parent line. */
  onChangeText: (next: string) => void;
  /** Fired when the admin commits a suggestion. Same shape the modal emits. */
  onPickSku: (result: SkuPickResult) => void;
  /** Optional onBlur passthrough (parent uses this to polish the description). */
  onBlur?: () => void;
  placeholder?: string;
  /** Focus the input on mount (used for freshly-added lines). */
  autoFocus?: boolean;
  /** Visual dim while a parent-driven polish is in flight. */
  dimmed?: boolean;
}

export function InlineSkuAutocomplete({
  value,
  onChangeText,
  onPickSku,
  onBlur,
  placeholder = 'e.g. Fix leaking tap, Mount TV…',
  autoFocus = false,
  dimmed = false,
}: InlineSkuAutocompleteProps) {
  const [results, setResults] = useState<CatalogSku[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** Set true once a SKU is picked from this field so the "no match" hint and
   *  the dropdown both stand down even if `value` still holds query text. */
  const [picked, setPicked] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autofocus a freshly-added line's input.
  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  // Debounced search — 200ms after last keystroke; min 2 chars. We only search
  // while the field is in "typing" mode (not just picked) to avoid a flash of
  // results the instant a pick rewrites `value` to the SKU name.
  useEffect(() => {
    if (picked) return;
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      runSearch(q);
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, picked]);

  async function runSearch(q: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const params = new URLSearchParams({ q, limit: '8' });
      const res = await fetch(`/api/admin/sku-catalog/search?${params.toString()}`, {
        headers: { ...getAuthHeaders() },
        signal: controller.signal,
      });
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data = await res.json();
      const rows = Array.isArray(data?.results) ? data.results : [];
      setResults(rows);
      setHighlight(0);
      setOpen(rows.length > 0);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setResults([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function commitPick(sku: CatalogSku) {
    const preview = previewSkuPriceAndMinutes(sku);
    const unitCount = sku.shape === 'per_unit' ? Math.max(1, sku.minimumUnits ?? 1) : undefined;
    const selectedTier = sku.shape === 'tiered' ? sku.tiers?.[0]?.label : undefined;
    recordPick(sku.skuCode);
    setPicked(true);
    setOpen(false);
    setResults([]);
    onPickSku({
      sku,
      derivedPricePence: preview.price,
      derivedScheduleMinutes: preview.minutes,
      unitCount,
      selectedTier,
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      // Esc still closes a stale-open dropdown
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      // Only swallow Enter when a suggestion is highlighted; otherwise let the
      // keystroke fall through (the text stays as a custom description).
      const sku = results[highlight];
      if (sku) {
        e.preventDefault();
        commitPick(sku);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  const showHint = !picked && !open && !loading && value.trim().length >= 2 && results.length === 0;

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          // Any keystroke re-arms search mode; a previously-picked field is now
          // being re-typed (the parent's Clear path resets value to '').
          setPicked(false);
          onChangeText(e.target.value);
        }}
        onFocus={() => {
          if (results.length > 0 && !picked) setOpen(true);
        }}
        onBlur={() => {
          // Defer close so an in-flight mousedown on a row still registers.
          blurTimer.current = setTimeout(() => setOpen(false), 120);
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className={`text-sm font-medium bg-transparent border-handy-grid focus:border-handy-yellow h-11 sm:h-10 transition-colors ${
          dimmed ? 'opacity-60' : ''
        }`}
      />

      {/* Loading spinner pinned right while the debounce resolves */}
      {loading && !open && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-handy-muted animate-spin" />
      )}

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-handy-grid bg-white shadow-lg overflow-hidden max-h-[18rem] overflow-y-auto"
          // Keep focus on the input so blur-close doesn't fire mid-pick.
          onMouseDown={(e) => e.preventDefault()}
        >
          {results.map((sku, idx) => {
            const { price, minutes } = previewSkuPriceAndMinutes(sku);
            const { label: shapeLabel, Icon: ShapeIcon } = shapeMeta(sku.shape);
            const isActive = idx === highlight;
            const blurb = (sku.customerDescription || '').slice(0, 50);
            return (
              <button
                key={sku.skuCode}
                type="button"
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => commitPick(sku)}
                className={`w-full text-left px-3 py-2 border-b border-handy-grid/60 last:border-b-0 transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99] ${
                  isActive ? 'bg-handy-navy text-white' : 'hover:bg-handy-navy/5'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-sm font-bold truncate ${isActive ? 'text-white' : 'text-handy-navy'}`}>
                        {sku.name}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 text-[9px] font-semibold rounded px-1 py-0.5 ${
                          isActive
                            ? 'bg-white/15 text-white'
                            : 'bg-handy-cream text-handy-navy/80 border border-handy-grid'
                        }`}
                      >
                        <ShapeIcon className="w-2.5 h-2.5" />
                        {shapeLabel}
                      </span>
                    </div>
                    {blurb && (
                      <p className={`text-[11px] mt-0.5 truncate ${isActive ? 'text-white/70' : 'text-handy-muted'}`}>
                        {blurb}
                        {sku.customerDescription.length > 50 ? '…' : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold tabular-nums leading-none ${isActive ? 'text-white' : 'text-handy-navy'}`}>
                      {formatPounds(price)}
                    </div>
                    <div className={`text-[10px] flex items-center justify-end gap-0.5 mt-0.5 ${isActive ? 'text-white/70' : 'text-handy-muted'}`}>
                      <Clock className="w-2.5 h-2.5" />
                      {formatMinutes(minutes)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* No-match hint — the line will be quoted as custom work */}
      {showHint && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-handy-muted">
          <Info className="w-3 h-3 shrink-0" />
          No catalog match — will be quoted as a custom job.
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Effective price/minutes helper exposed for parent live preview wiring
// ──────────────────────────────────────────────────────────────────────────

/**
 * Same math as `SkuSlabSummary.effective` — exposed so the parent component
 * can mirror the SKU's price + on-site minutes into `LineItem.estimatedMinutes`
 * + materials math without duplicating shape handling.
 */
export function getEffectiveSkuPriceAndMinutes(
  sku: CatalogSku,
  unitCount?: number,
  selectedTier?: string,
): { pricePence: number; scheduleMinutes: number } {
  if (sku.shape === 'fixed') {
    return {
      pricePence: sku.pricePence ?? 0,
      scheduleMinutes: sku.scheduleMinutes ?? 0,
    };
  }
  if (sku.shape === 'per_unit') {
    const count = Math.max(1, unitCount ?? sku.minimumUnits ?? 1);
    return {
      pricePence: (sku.pricePerUnitPence ?? 0) * count,
      scheduleMinutes: (sku.minutesPerUnit ?? 0) * count + (sku.setupMinutes ?? 0),
    };
  }
  const t = sku.tiers?.find((x) => x.label === selectedTier) || sku.tiers?.[0];
  return {
    pricePence: t?.pricePence ?? 0,
    scheduleMinutes: t?.scheduleMinutes ?? 0,
  };
}
