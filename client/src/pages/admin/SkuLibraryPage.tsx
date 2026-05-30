/**
 * Phase 28 — SKU Library.
 *
 * The admin home for the service_catalog (the 161-SKU catalog the contextual
 * pricing engine resolves against). Browse/search every SKU, edit the
 * customer-facing description, pick an icon, adjust price (shape-aware), and
 * toggle active — all persisted via PATCH /api/admin/sku-catalog/:skuCode,
 * which invalidates the resolver cache so the next quote prices off the edit.
 *
 * NB: distinct from the legacy "SKU Manager" (/admin/skus → /api/skus), which
 * manages the old productized_services table the engine no longer uses.
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Search,
  Loader2,
  Save,
  Check,
  Library as LibraryIcon,
  PoundSterling,
  Clock,
  Plus,
  Trash2,
  ChevronDown,
  X,
} from 'lucide-react';
import { SkuIcon, SKU_ICON_NAMES, resolveSkuIconName } from '@/lib/sku-icons';
import { JobCategoryValues } from '@shared/contextual-pricing-types';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface Tier { label: string; pricePence: number; scheduleMinutes: number }
interface Sku {
  skuCode: string;
  name: string;
  category: string;
  shape: 'fixed' | 'per_unit' | 'tiered';
  pricePence: number | null;
  scheduleMinutes: number | null;
  pricePerUnitPence: number | null;
  unitLabel: string | null;
  minimumUnits: number | null;
  minutesPerUnit: number | null;
  setupMinutes: number | null;
  tiers: Tier[] | null;
  customerDescription: string;
  adminDescription: string | null;
  icon: string | null;
  isActive: boolean;
  flexEligible: boolean;
  offPeakWeekendPremiumPence: number;
  pickCount: number;
}

const prettyCategory = (c: string) =>
  c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

const gbp = (pence: number | null | undefined) =>
  pence == null ? '' : (pence / 100).toFixed(0);
const toPence = (gbpStr: string): number => {
  const n = parseFloat(gbpStr);
  return isNaN(n) ? 0 : Math.round(n * 100);
};

const SHAPE_LABEL: Record<Sku['shape'], string> = {
  fixed: 'Fixed',
  per_unit: 'Per unit',
  tiered: 'Tiered',
};

const SHAPE_OPTIONS: Sku['shape'][] = ['fixed', 'per_unit', 'tiered'];

/** A fresh, fixed-shape draft for the "New SKU" panel. */
function blankSku(): Sku {
  return {
    skuCode: '',
    name: '',
    category: 'general_fixing',
    shape: 'fixed',
    pricePence: 0,
    scheduleMinutes: 60,
    pricePerUnitPence: null,
    unitLabel: null,
    minimumUnits: null,
    minutesPerUnit: null,
    setupMinutes: null,
    tiers: null,
    customerDescription: '',
    adminDescription: null,
    icon: null,
    isActive: true,
    flexEligible: true,
    offPeakWeekendPremiumPence: 0,
    pickCount: 0,
  };
}

/** Seed sensible defaults when a SKU switches shape so the editor isn't blank. */
function applyShapeDefaults(d: Sku, shape: Sku['shape']): Sku {
  const next: Sku = { ...d, shape };
  if (shape === 'fixed' && next.pricePence == null) {
    next.pricePence = 0;
    next.scheduleMinutes = next.scheduleMinutes ?? 60;
  }
  if (shape === 'per_unit' && next.pricePerUnitPence == null) {
    next.pricePerUnitPence = 0;
    next.unitLabel = next.unitLabel || 'unit';
    next.minimumUnits = next.minimumUnits ?? 1;
    next.minutesPerUnit = next.minutesPerUnit ?? 30;
    next.setupMinutes = next.setupMinutes ?? 0;
  }
  if (shape === 'tiered' && (!next.tiers || next.tiers.length === 0)) {
    next.tiers = [{ label: 'Standard', pricePence: d.pricePence ?? 0, scheduleMinutes: d.scheduleMinutes ?? 60 }];
  }
  return next;
}

export default function SkuLibraryPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sku-library'],
    queryFn: async () => {
      const res = await fetch('/api/admin/sku-catalog/search?includeInactive=1&limit=500', {
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error('Failed to load catalog');
      const json = await res.json();
      return (json.results as Sku[]) || [];
    },
  });

  const all = data || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((s) => {
      if (!showInactive && !s.isActive) return false;
      if (category !== 'all' && s.category !== category) return false;
      if (!q) return true;
      return (
        s.skuCode.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.customerDescription || '').toLowerCase().includes(q) ||
        (s.adminDescription || '').toLowerCase().includes(q)
      );
    });
  }, [all, search, category, showInactive]);

  const grouped = useMemo(() => {
    const map = new Map<string, Sku[]>();
    for (const s of filtered) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)!.push(s);
    }
    return Array.from(map.entries())
      .map(([cat, skus]) => [cat, skus.sort((a, b) => a.name.localeCompare(b.name))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const activeCount = all.filter((s) => s.isActive).length;

  return (
    <div className="min-h-screen bg-handy-bg" style={{ colorScheme: 'light' }}>
      {/* Brand hero */}
      <div className="bg-handy-navy border-b-4 border-handy-yellow">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-handy-yellow/15 flex items-center justify-center">
            <LibraryIcon className="w-5 h-5 text-handy-yellow" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">SKU Library</h1>
            <p className="text-xs text-white/60">
              The service catalogue your quotes price against — edit descriptions, icons & prices live.
            </p>
          </div>
          <Badge variant="outline" className="bg-handy-yellow/15 text-handy-yellow border-handy-yellow/50 whitespace-nowrap">
            {activeCount} active · {all.length} total
          </Badge>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-handy-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, code or description…"
              className="pl-9 bg-white border-handy-grid focus:border-handy-yellow"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 rounded-md border border-handy-grid bg-white px-3 text-sm text-handy-navy focus:border-handy-yellow focus:outline-none"
          >
            <option value="all">All categories</option>
            {JobCategoryValues.map((c) => (
              <option key={c} value={c}>
                {prettyCategory(c)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-handy-navy whitespace-nowrap cursor-pointer select-none">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Show inactive
          </label>
          <Button
            onClick={() => setShowNew((v) => !v)}
            className="bg-handy-navy hover:bg-handy-navy/90 text-white whitespace-nowrap"
          >
            {showNew ? <X className="w-4 h-4 mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
            {showNew ? 'Cancel' : 'New SKU'}
          </Button>
        </div>

        {showNew && <NewSkuCard onClose={() => setShowNew(false)} />}

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-handy-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading catalogue…
          </div>
        )}
        {isError && (
          <div className="text-center py-20 text-red-600 text-sm">Failed to load the catalogue. Try refreshing.</div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="text-center py-20 text-handy-muted text-sm">No SKUs match your filters.</div>
        )}

        {grouped.map(([cat, skus]) => (
          <section key={cat} className="space-y-2">
            <div className="flex items-center gap-2 pt-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-handy-navy">{prettyCategory(cat)}</h2>
              <span className="h-px flex-1 bg-handy-grid" />
              <span className="text-xs text-handy-muted">{skus.length}</span>
            </div>
            <div className="space-y-2">
              {skus.map((sku) => (
                <SkuRow key={sku.skuCode} sku={sku} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Editable row ──────────────────────────────────────────────────────────
function SkuRow({ sku }: { sku: Sku }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Sku>(sku);
  const [dirty, setDirty] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Resync from server only while the row is clean (avoids clobbering an edit
  // in progress when the list refetches after a sibling save).
  useEffect(() => {
    if (!dirty) setDraft(sku);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku]);

  const set = <K extends keyof Sku>(key: K, value: Sku[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const patchDraft = (p: Partial<Sku>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };
  const changeShape = (shape: Sku['shape']) => {
    setDraft((d) => applyShapeDefaults(d, shape));
    setDirty(true);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/sku-catalog/${encodeURIComponent(sku.skuCode)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(buildSkuPatch(draft)),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Save failed');
      }
      return res.json();
    },
    onSuccess: () => {
      setDirty(false);
      toast({ title: 'Saved', description: `${sku.skuCode} updated.` });
      queryClient.invalidateQueries({ queryKey: ['sku-library'] });
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err?.message || 'Try again.', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/sku-catalog/${encodeURIComponent(sku.skuCode)}`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Delete failed');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Deleted', description: `${sku.skuCode} removed from the catalogue.` });
      queryClient.invalidateQueries({ queryKey: ['sku-library'] });
    },
    onError: (err: any) => {
      setConfirmingDelete(false);
      toast({ title: 'Delete failed', description: err?.message || 'Try again.', variant: 'destructive' });
    },
  });

  const effectiveIcon = resolveSkuIconName(draft);

  return (
    <div
      className={`rounded-xl border-2 bg-white p-3 sm:p-4 transition-[border-color] ${
        dirty ? 'border-handy-yellow' : 'border-handy-grid'
      } ${!draft.isActive ? 'opacity-60' : ''}`}
    >
      <div className="flex gap-3">
        <IconPickerButton icon={effectiveIcon} onPick={(n) => set('icon', n)} />

        {/* Main */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              className="h-8 text-sm font-bold text-handy-navy border-transparent hover:border-handy-grid focus:border-handy-yellow px-1.5 max-w-xs"
            />
            <span className="text-[11px] font-mono text-handy-muted">{sku.skuCode}</span>
            {sku.pickCount > 0 && <span className="text-[11px] text-handy-muted">· picked {sku.pickCount}×</span>}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <MetaSelect
              label="Category"
              value={draft.category}
              onChange={(v) => set('category', v)}
              options={JobCategoryValues.map((c) => ({ value: c, label: prettyCategory(c) }))}
            />
            <MetaSelect
              label="Shape"
              value={draft.shape}
              onChange={(v) => changeShape(v as Sku['shape'])}
              options={SHAPE_OPTIONS.map((s) => ({ value: s, label: SHAPE_LABEL[s] }))}
            />
          </div>

          <Textarea
            value={draft.customerDescription}
            onChange={(e) => set('customerDescription', e.target.value)}
            rows={2}
            placeholder="Customer-facing description (shown on the quote)"
            className="text-sm text-handy-navy/90 border-handy-grid focus:border-handy-yellow resize-none"
          />

          <ShapeFields draft={draft} onField={patchDraft} />

          {/* Advanced — admin notes & yield rules, tucked away to keep rows tidy */}
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex items-center gap-1 text-[11px] font-medium text-handy-muted hover:text-handy-navy"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            Advanced
          </button>
          {advancedOpen && (
            <div className="space-y-2.5 rounded-lg bg-handy-bg/70 border border-handy-grid p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-handy-muted">
                  Admin notes / trigger words
                </span>
                <Textarea
                  value={draft.adminDescription || ''}
                  onChange={(e) => set('adminDescription', e.target.value || null)}
                  rows={2}
                  placeholder="Synonyms & 'pick this when…' words that help search surface this SKU"
                  className="text-sm text-handy-navy/90 border-handy-grid focus:border-handy-yellow resize-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <label className="flex items-center gap-1.5 text-[11px] text-handy-muted cursor-pointer select-none">
                  <Switch checked={draft.flexEligible} onCheckedChange={(v) => set('flexEligible', v)} />
                  Flex-eligible
                </label>
                <PriceInput
                  label="Weekend premium"
                  value={gbp(draft.offPeakWeekendPremiumPence)}
                  onChange={(v) => set('offPeakWeekendPremiumPence', toPence(v))}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right rail: active + save + delete */}
        <div className="flex flex-col items-end justify-between shrink-0 gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-handy-muted cursor-pointer select-none">
            <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} />
            {draft.isActive ? 'Active' : 'Hidden'}
          </label>
          <Button
            size="sm"
            disabled={!dirty || mutation.isPending}
            onClick={() => mutation.mutate()}
            className={dirty ? 'bg-handy-navy hover:bg-handy-navy/90 text-white' : ''}
            variant={dirty ? 'default' : 'outline'}
          >
            {mutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : dirty ? (
              <>
                <Save className="w-3.5 h-3.5 mr-1" /> Save
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 mr-1" /> Saved
              </>
            )}
          </Button>
          {confirmingDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-[11px] text-handy-muted hover:text-handy-navy px-1.5 py-1"
              >
                Cancel
              </button>
              <Button
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="h-7 px-2 text-[11px] bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Delete'}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="flex items-center gap-1 text-[11px] text-handy-muted hover:text-red-600"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-handy-muted">{label}</span>
      <div className="relative">
        <PoundSterling className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-handy-muted" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="numeric"
          className="h-8 w-24 pl-6 text-sm font-semibold text-handy-navy border-handy-grid focus:border-handy-yellow"
        />
      </div>
    </div>
  );
}

function MinsInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-handy-muted">{label} (min)</span>
      <div className="relative">
        <Clock className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-handy-muted" />
        <Input
          value={String(value)}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          inputMode="numeric"
          className="h-8 w-20 pl-6 text-sm border-handy-grid focus:border-handy-yellow"
        />
      </div>
    </div>
  );
}

function NumInput({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-handy-muted">{label}</span>
      <Input
        value={String(value)}
        onChange={(e) => onChange(Math.max(min, parseInt(e.target.value) || 0))}
        inputMode="numeric"
        className="h-8 w-20 text-sm border-handy-grid focus:border-handy-yellow"
      />
    </div>
  );
}

// ── Shared editors ────────────────────────────────────────────────────────

/** Icon button + popover picker, shared by the row and the New SKU panel. */
function IconPickerButton({ icon, onPick }: { icon: string; onPick: (name: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Change icon"
        className="w-12 h-12 rounded-lg bg-handy-cream border border-handy-grid flex items-center justify-center text-handy-navy hover:border-handy-yellow transition-colors active:scale-95"
      >
        <SkuIcon name={icon} className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 w-64 max-h-56 overflow-y-auto rounded-lg border border-handy-grid bg-white shadow-lg p-2 grid grid-cols-7 gap-1">
          {SKU_ICON_NAMES.map((n) => (
            <button
              key={n}
              type="button"
              title={n}
              onClick={() => {
                onPick(n);
                setOpen(false);
              }}
              className={`w-8 h-8 rounded flex items-center justify-center hover:bg-handy-navy/5 ${
                icon === n ? 'bg-handy-navy text-white' : 'text-handy-navy'
              }`}
            >
              <SkuIcon name={n} className="w-4 h-4" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="col-span-7 mt-1 text-[11px] text-handy-muted hover:text-handy-navy py-1"
          >
            Reset to category default
          </button>
        </div>
      )}
    </div>
  );
}

/** Compact labelled <select> for category / shape. */
function MetaSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-handy-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-handy-grid bg-white px-2 text-xs text-handy-navy focus:border-handy-yellow focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Shape-aware pricing editor: fixed / per-unit / tiered (add & remove tiers). */
function ShapeFields({ draft, onField }: { draft: Sku; onField: (p: Partial<Sku>) => void }) {
  const setTier = (idx: number, partial: Partial<Tier>) => {
    const tiers = (draft.tiers || []).map((t, i) => (i === idx ? { ...t, ...partial } : t));
    onField({ tiers });
  };
  const addTier = () =>
    onField({ tiers: [...(draft.tiers || []), { label: 'New tier', pricePence: 0, scheduleMinutes: 60 }] });
  const removeTier = (idx: number) => onField({ tiers: (draft.tiers || []).filter((_, i) => i !== idx) });

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      {draft.shape === 'fixed' && (
        <>
          <PriceInput label="Price" value={gbp(draft.pricePence)} onChange={(v) => onField({ pricePence: toPence(v) })} />
          <MinsInput label="On-site" value={draft.scheduleMinutes ?? 0} onChange={(v) => onField({ scheduleMinutes: v })} />
        </>
      )}
      {draft.shape === 'per_unit' && (
        <>
          <PriceInput
            label={`Per ${draft.unitLabel || 'unit'}`}
            value={gbp(draft.pricePerUnitPence)}
            onChange={(v) => onField({ pricePerUnitPence: toPence(v) })}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-handy-muted">Unit label</span>
            <Input
              value={draft.unitLabel || ''}
              onChange={(e) => onField({ unitLabel: e.target.value })}
              className="h-8 w-24 text-sm border-handy-grid focus:border-handy-yellow"
            />
          </div>
          <NumInput label="Min units" value={draft.minimumUnits ?? 1} min={1} onChange={(v) => onField({ minimumUnits: v })} />
          <MinsInput label="Per unit" value={draft.minutesPerUnit ?? 0} onChange={(v) => onField({ minutesPerUnit: v })} />
          <MinsInput label="Setup" value={draft.setupMinutes ?? 0} onChange={(v) => onField({ setupMinutes: v })} />
        </>
      )}
      {draft.shape === 'tiered' && (
        <div className="flex flex-wrap items-center gap-2">
          {(draft.tiers || []).map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg bg-handy-cream/60 border border-handy-grid px-2 py-1.5"
            >
              <Input
                value={t.label}
                onChange={(e) => setTier(i, { label: e.target.value })}
                placeholder="Tier"
                className="h-7 w-20 text-xs font-semibold text-handy-navy border-handy-grid focus:border-handy-yellow px-1.5"
              />
              <div className="relative">
                <PoundSterling className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-handy-muted" />
                <Input
                  value={gbp(t.pricePence)}
                  onChange={(e) => setTier(i, { pricePence: toPence(e.target.value) })}
                  className="h-7 w-16 pl-5 text-sm border-handy-grid focus:border-handy-yellow"
                />
              </div>
              <div className="relative">
                <Clock className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-handy-muted" />
                <Input
                  value={String(t.scheduleMinutes)}
                  onChange={(e) => setTier(i, { scheduleMinutes: parseInt(e.target.value) || 0 })}
                  className="h-7 w-16 pl-5 text-sm border-handy-grid focus:border-handy-yellow"
                />
              </div>
              <button
                type="button"
                onClick={() => removeTier(i)}
                title="Remove tier"
                className="text-handy-muted hover:text-red-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addTier}
            className="flex items-center gap-1 text-xs text-handy-navy hover:text-handy-yellow border border-dashed border-handy-grid rounded-lg px-2 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add tier
          </button>
        </div>
      )}
    </div>
  );
}

/** Build a PATCH/POST body from a draft: reset every shape column then fill only
 *  the active shape's, so switching shape clears the stale price columns. */
function buildSkuPatch(d: Sku): Record<string, any> {
  const patch: Record<string, any> = {
    name: d.name,
    category: d.category,
    shape: d.shape,
    customerDescription: d.customerDescription,
    adminDescription: d.adminDescription ?? null,
    icon: d.icon,
    isActive: d.isActive,
    flexEligible: d.flexEligible,
    offPeakWeekendPremiumPence: d.offPeakWeekendPremiumPence ?? 0,
    pricePence: null,
    scheduleMinutes: null,
    pricePerUnitPence: null,
    unitLabel: null,
    minimumUnits: null,
    minutesPerUnit: null,
    setupMinutes: null,
    tiers: null,
  };
  if (d.shape === 'fixed') {
    patch.pricePence = d.pricePence;
    patch.scheduleMinutes = d.scheduleMinutes;
  } else if (d.shape === 'per_unit') {
    patch.pricePerUnitPence = d.pricePerUnitPence;
    patch.unitLabel = d.unitLabel;
    patch.minimumUnits = d.minimumUnits;
    patch.minutesPerUnit = d.minutesPerUnit;
    patch.setupMinutes = d.setupMinutes;
  } else if (d.shape === 'tiered') {
    patch.tiers = d.tiers;
  }
  return patch;
}

// ── New SKU panel ─────────────────────────────────────────────────────────
function NewSkuCard({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Sku>(blankSku);

  const set = <K extends keyof Sku>(key: K, value: Sku[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const patchDraft = (p: Partial<Sku>) => setDraft((d) => ({ ...d, ...p }));
  const changeShape = (shape: Sku['shape']) => setDraft((d) => applyShapeDefaults(d, shape));

  const codeValid = /^[A-Za-z0-9_-]{2,40}$/.test(draft.skuCode.trim());
  const valid = codeValid && draft.name.trim().length > 0 && draft.customerDescription.trim().length > 0;

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = { ...buildSkuPatch(draft), skuCode: draft.skuCode.trim().toUpperCase() };
      const res = await fetch('/api/admin/sku-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Create failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: 'SKU created', description: `${data?.sku?.skuCode || draft.skuCode} added to the catalogue.` });
      queryClient.invalidateQueries({ queryKey: ['sku-library'] });
      onClose();
    },
    onError: (err: any) =>
      toast({ title: 'Create failed', description: err?.message || 'Try again.', variant: 'destructive' }),
  });

  const effectiveIcon = resolveSkuIconName(draft);

  return (
    <div className="rounded-xl border-2 border-handy-yellow bg-handy-cream/40 p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Plus className="w-4 h-4 text-handy-navy" />
        <h3 className="text-sm font-bold text-handy-navy">New SKU</h3>
      </div>
      <div className="flex gap-3">
        <IconPickerButton icon={effectiveIcon} onPick={(n) => set('icon', n)} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wide text-handy-muted">SKU code</span>
              <Input
                value={draft.skuCode}
                onChange={(e) => set('skuCode', e.target.value.toUpperCase())}
                placeholder="MIX-TAP-01"
                className={`h-8 w-40 font-mono text-sm border-handy-grid focus:border-handy-yellow ${
                  draft.skuCode && !codeValid ? 'border-red-400' : ''
                }`}
              />
            </div>
            <div className="flex flex-col gap-0.5 flex-1 min-w-[12rem]">
              <span className="text-[10px] uppercase tracking-wide text-handy-muted">Name</span>
              <Input
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Mixer tap replacement"
                className="h-8 text-sm font-bold text-handy-navy border-handy-grid focus:border-handy-yellow"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <MetaSelect
              label="Category"
              value={draft.category}
              onChange={(v) => set('category', v)}
              options={JobCategoryValues.map((c) => ({ value: c, label: prettyCategory(c) }))}
            />
            <MetaSelect
              label="Shape"
              value={draft.shape}
              onChange={(v) => changeShape(v as Sku['shape'])}
              options={SHAPE_OPTIONS.map((s) => ({ value: s, label: SHAPE_LABEL[s] }))}
            />
          </div>

          <Textarea
            value={draft.customerDescription}
            onChange={(e) => set('customerDescription', e.target.value)}
            rows={2}
            placeholder="Customer-facing description (shown on the quote)"
            className="text-sm text-handy-navy/90 border-handy-grid focus:border-handy-yellow resize-none"
          />

          <ShapeFields draft={draft} onField={patchDraft} />

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-handy-muted">Admin notes / trigger words</span>
            <Textarea
              value={draft.adminDescription || ''}
              onChange={(e) => set('adminDescription', e.target.value || null)}
              rows={2}
              placeholder="Synonyms & 'pick this when…' words that help search surface this SKU"
              className="text-sm text-handy-navy/90 border-handy-grid focus:border-handy-yellow resize-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-1.5 text-[11px] text-handy-muted cursor-pointer select-none">
              <Switch checked={draft.flexEligible} onCheckedChange={(v) => set('flexEligible', v)} />
              Flex-eligible
            </label>
            <PriceInput
              label="Weekend premium"
              value={gbp(draft.offPeakWeekendPremiumPence)}
              onChange={(v) => set('offPeakWeekendPremiumPence', toPence(v))}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-handy-muted cursor-pointer select-none">
              <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} />
              {draft.isActive ? 'Active' : 'Hidden'}
            </label>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onClose} className="border-handy-grid text-handy-navy">
          Cancel
        </Button>
        <Button
          disabled={!valid || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="bg-handy-navy hover:bg-handy-navy/90 text-white"
        >
          {createMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
          ) : (
            <Plus className="w-4 h-4 mr-1.5" />
          )}
          Create SKU
        </Button>
      </div>
    </div>
  );
}
