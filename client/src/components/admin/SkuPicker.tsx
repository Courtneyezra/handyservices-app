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
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, Clock, Tag, Package, Layers, X, Star, PencilRuler } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { searchSkus } from '@/lib/sku-search';

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
  /** Curated match phrases (enriched in the catalog rebuild). Powers searchSkus so the
   * per-line autocomplete matches wording the SKU name doesn't contain. */
  keywords: string[] | null;
  negativeKeywords: string[] | null;
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

/**
 * Phase 33 — load the whole active catalog once and cache it. The catalog is
 * only ~161 rows, so the inline autocomplete searches it in-memory rather than
 * round-tripping per keystroke. Shared cache key so every inline field reuses
 * the same fetched list.
 */
export function useActiveSkuCatalog() {
  return useQuery({
    queryKey: ['sku-catalog-active'],
    queryFn: async (): Promise<CatalogSku[]> => {
      const res = await fetch('/api/admin/sku-catalog/search?limit=500', { headers: { ...getAuthHeaders() } });
      if (!res.ok) throw new Error('catalog load failed');
      const j = await res.json();
      return (j.results as CatalogSku[]) || [];
    },
    staleTime: 5 * 60 * 1000,
  });
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
  /** Fired after a settled search: true when the typed text (≥3 chars) found NO
   *  catalog match, so the parent can reveal the custom Category/Time/Materials. */
  onCustomChange?: (isCustom: boolean) => void;
  /** Fired when the admin explicitly chooses "Create custom" from the dropdown. */
  onCreateCustom?: () => void;
}

export function InlineSkuAutocomplete({
  value,
  onChangeText,
  onPickSku,
  onBlur,
  placeholder = 'e.g. Fix leaking tap, Mount TV…',
  autoFocus = false,
  dimmed = false,
  onCustomChange,
  onCreateCustom,
}: InlineSkuAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** Set true once a SKU is picked from this field so the dropdown stands down
   *  even if `value` still holds the (rewritten) SKU-name text. */
  const [picked, setPicked] = useState(false);
  /** Set true once the admin explicitly committed to a custom line via the
   *  "Create custom" row, so the dropdown stops re-offering it. */
  const [committedCustom, setCommittedCustom] = useState(false);

  // Phase 33 — the whole active catalog, cached + searched in-memory.
  const { data: catalog = [], isLoading: catalogLoading } = useActiveSkuCatalog();

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

  // In-memory matches. No matches once the line is picked or the admin has
  // committed to custom, and not until there's ≥2 chars to search on.
  const results = useMemo(
    () => (picked || committedCustom || value.trim().length < 2 ? [] : searchSkus(catalog, value, 8)),
    [catalog, value, picked, committedCustom],
  );

  // Clearing the field (back below 2 chars) re-arms search mode: drop both the
  // picked + custom-committed latches so typing again searches afresh.
  useEffect(() => {
    if (value.trim().length < 2) {
      setPicked(false);
      setCommittedCustom(false);
    }
  }, [value]);

  // Keep highlight in range as results change; reset to the top on each new set.
  useEffect(() => {
    setHighlight(0);
  }, [results]);

  // A custom line is offered whenever there's real text and we're neither picked
  // nor already committed to custom.
  const canCreateCustom = value.trim().length >= 2 && !picked && !committedCustom;

  // Settled in-memory search with real text (≥3 chars) but zero hits ⇒ the
  // parent should treat this line as custom (reveal Category/Time/Materials).
  // Below 2 chars we explicitly clear the custom flag.
  useEffect(() => {
    if (value.trim().length < 2) {
      onCustomChange?.(false);
      return;
    }
    onCustomChange?.(value.trim().length >= 3 && results.length === 0 && !catalogLoading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, value, catalogLoading]);

  function commitPick(sku: CatalogSku) {
    const preview = previewSkuPriceAndMinutes(sku);
    const unitCount = sku.shape === 'per_unit' ? Math.max(1, sku.minimumUnits ?? 1) : undefined;
    const selectedTier = sku.shape === 'tiered' ? sku.tiers?.[0]?.label : undefined;
    recordPick(sku.skuCode);
    setPicked(true);
    setOpen(false);
    onCustomChange?.(false);
    onPickSku({
      sku,
      derivedPricePence: preview.price,
      derivedScheduleMinutes: preview.minutes,
      unitCount,
      selectedTier,
    });
  }

  // Admin explicitly chose the "Create custom" row. Latch custom so the dropdown
  // stops re-offering it; leave `value` untouched (the typed text is the line
  // description). The parent reveal is driven via onCreateCustom.
  function commitCustom() {
    setCommittedCustom(true);
    setOpen(false);
    onCreateCustom?.();
  }

  // The custom row sits at index === results.length, so keyboard nav cycles
  // through [...results, custom]. When there are zero results but custom is
  // available, that single row is index 0.
  const navCount = results.length + (canCreateCustom ? 1 : 0);
  // The dropdown only renders when focused/active AND there's something to show.
  const showDropdown = open && (results.length > 0 || canCreateCustom);
  const customIndex = results.length; // index of the custom row when present

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || navCount === 0) {
      // Esc still closes a stale-open dropdown.
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % navCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + navCount) % navCount);
    } else if (e.key === 'Enter') {
      // Custom row highlighted → create custom; a SKU row highlighted → pick it.
      // Otherwise let Enter fall through (text stays as a custom description).
      if (canCreateCustom && highlight === customIndex) {
        e.preventDefault();
        commitCustom();
      } else {
        const sku = results[highlight];
        if (sku) {
          e.preventDefault();
          commitPick(sku);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          // Any keystroke re-arms search mode; a previously-picked or
          // custom-committed field is now being re-typed.
          setPicked(false);
          setCommittedCustom(false);
          setOpen(true);
          onChangeText(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Defer close so an in-flight mousedown on a row still registers.
          blurTimer.current = setTimeout(() => setOpen(false), 120);
          onBlur?.();
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className={`text-base sm:text-sm font-medium bg-transparent border-handy-grid focus:border-handy-yellow h-11 sm:h-10 transition-colors ${
          dimmed ? 'opacity-60' : ''
        }`}
      />

      {/* Initial catalog load spinner (only while the cache is empty) */}
      {catalogLoading && catalog.length === 0 && value.trim().length >= 2 && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-handy-muted animate-spin" />
      )}

      {/* Dropdown — SKU results plus an always-available "Create custom" row */}
      {showDropdown && (
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

          {/* Create-custom row — always last; the only/primary row when no SKU
              matches. Styled as a distinct make-to-order action. */}
          {canCreateCustom && (() => {
            const isActive = highlight === customIndex;
            const trimmed = value.trim();
            const shown = trimmed.length > 38 ? `${trimmed.slice(0, 38)}…` : trimmed;
            return (
              <button
                type="button"
                onMouseEnter={() => setHighlight(customIndex)}
                onClick={commitCustom}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99] ${
                  results.length > 0 ? 'border-t border-dashed border-handy-grid' : ''
                } ${isActive ? 'bg-handy-navy text-white' : 'bg-handy-cream/40 hover:bg-handy-navy/5'}`}
              >
                <PencilRuler className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-handy-muted'}`} />
                <span className={`text-xs font-semibold truncate ${isActive ? 'text-white' : 'text-handy-navy'}`}>
                  Create custom:{' '}
                  <span className={`font-normal ${isActive ? 'text-white/80' : 'text-handy-muted'}`}>
                    “{shown}”
                  </span>
                </span>
                <span className={`ml-auto shrink-0 text-[9px] uppercase tracking-wider font-semibold ${isActive ? 'text-white/70' : 'text-handy-muted/70'}`}>
                  make-to-order
                </span>
              </button>
            );
          })()}
        </div>
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
