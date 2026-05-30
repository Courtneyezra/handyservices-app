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
import { Search, Loader2, Save, Check, Library as LibraryIcon, PoundSterling, Clock } from 'lucide-react';
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

export default function SkuLibraryPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(true);

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
        </div>

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
  const [pickerOpen, setPickerOpen] = useState(false);

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
  const setTier = (idx: number, field: 'pricePence' | 'scheduleMinutes', value: number) => {
    setDraft((d) => {
      const tiers = (d.tiers || []).map((t, i) => (i === idx ? { ...t, [field]: value } : t));
      return { ...d, tiers };
    });
    setDirty(true);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const patch: Record<string, any> = {
        name: draft.name,
        customerDescription: draft.customerDescription,
        icon: draft.icon,
        isActive: draft.isActive,
      };
      if (draft.shape === 'fixed') {
        patch.pricePence = draft.pricePence;
        patch.scheduleMinutes = draft.scheduleMinutes;
      } else if (draft.shape === 'per_unit') {
        patch.pricePerUnitPence = draft.pricePerUnitPence;
        patch.unitLabel = draft.unitLabel;
        patch.minimumUnits = draft.minimumUnits;
        patch.minutesPerUnit = draft.minutesPerUnit;
        patch.setupMinutes = draft.setupMinutes;
      } else if (draft.shape === 'tiered') {
        patch.tiers = draft.tiers;
      }
      const res = await fetch(`/api/admin/sku-catalog/${encodeURIComponent(sku.skuCode)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(patch),
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

  const effectiveIcon = resolveSkuIconName(draft);

  return (
    <div
      className={`rounded-xl border-2 bg-white p-3 sm:p-4 transition-[border-color] ${
        dirty ? 'border-handy-yellow' : 'border-handy-grid'
      } ${!draft.isActive ? 'opacity-60' : ''}`}
    >
      <div className="flex gap-3">
        {/* Icon + picker */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            title="Change icon"
            className="w-12 h-12 rounded-lg bg-handy-cream border border-handy-grid flex items-center justify-center text-handy-navy hover:border-handy-yellow transition-colors active:scale-95"
          >
            <SkuIcon name={effectiveIcon} className="w-5 h-5" />
          </button>
          {pickerOpen && (
            <div className="absolute z-30 mt-1 left-0 w-64 max-h-56 overflow-y-auto rounded-lg border border-handy-grid bg-white shadow-lg p-2 grid grid-cols-7 gap-1">
              {SKU_ICON_NAMES.map((n) => (
                <button
                  key={n}
                  type="button"
                  title={n}
                  onClick={() => {
                    set('icon', n);
                    setPickerOpen(false);
                  }}
                  className={`w-8 h-8 rounded flex items-center justify-center hover:bg-handy-navy/5 ${
                    effectiveIcon === n ? 'bg-handy-navy text-white' : 'text-handy-navy'
                  }`}
                >
                  <SkuIcon name={n} className="w-4 h-4" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  set('icon', null);
                  setPickerOpen(false);
                }}
                className="col-span-7 mt-1 text-[11px] text-handy-muted hover:text-handy-navy py-1"
              >
                Reset to category default
              </button>
            </div>
          )}
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              className="h-8 text-sm font-bold text-handy-navy border-transparent hover:border-handy-grid focus:border-handy-yellow px-1.5 max-w-xs"
            />
            <Badge variant="outline" className="text-[10px] bg-handy-cream text-handy-navy/80 border-handy-grid">
              {SHAPE_LABEL[draft.shape]}
            </Badge>
            <span className="text-[11px] font-mono text-handy-muted">{sku.skuCode}</span>
            {sku.pickCount > 0 && <span className="text-[11px] text-handy-muted">· picked {sku.pickCount}×</span>}
          </div>

          <Textarea
            value={draft.customerDescription}
            onChange={(e) => set('customerDescription', e.target.value)}
            rows={2}
            placeholder="Customer-facing description (shown on the quote)"
            className="text-sm text-handy-navy/90 border-handy-grid focus:border-handy-yellow resize-none"
          />

          {/* Shape-aware pricing */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {draft.shape === 'fixed' && (
              <>
                <PriceInput label="Price" value={gbp(draft.pricePence)} onChange={(v) => set('pricePence', toPence(v))} />
                <MinsInput label="On-site" value={draft.scheduleMinutes ?? 0} onChange={(v) => set('scheduleMinutes', v)} />
              </>
            )}
            {draft.shape === 'per_unit' && (
              <>
                <PriceInput
                  label={`Per ${draft.unitLabel || 'unit'}`}
                  value={gbp(draft.pricePerUnitPence)}
                  onChange={(v) => set('pricePerUnitPence', toPence(v))}
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-handy-muted">Unit label</span>
                  <Input
                    value={draft.unitLabel || ''}
                    onChange={(e) => set('unitLabel', e.target.value)}
                    className="h-8 w-24 text-sm border-handy-grid focus:border-handy-yellow"
                  />
                </div>
                <MinsInput label="Per unit" value={draft.minutesPerUnit ?? 0} onChange={(v) => set('minutesPerUnit', v)} />
                <MinsInput label="Setup" value={draft.setupMinutes ?? 0} onChange={(v) => set('setupMinutes', v)} />
              </>
            )}
            {draft.shape === 'tiered' && (
              <div className="flex flex-wrap gap-3">
                {(draft.tiers || []).map((t, i) => (
                  <div key={t.label} className="flex items-center gap-1.5 rounded-lg bg-handy-cream/60 border border-handy-grid px-2 py-1">
                    <span className="text-xs font-semibold text-handy-navy">{t.label}</span>
                    <div className="relative">
                      <PoundSterling className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-handy-muted" />
                      <Input
                        value={gbp(t.pricePence)}
                        onChange={(e) => setTier(i, 'pricePence', toPence(e.target.value))}
                        className="h-7 w-16 pl-5 text-sm border-handy-grid focus:border-handy-yellow"
                      />
                    </div>
                    <div className="relative">
                      <Clock className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-handy-muted" />
                      <Input
                        value={String(t.scheduleMinutes)}
                        onChange={(e) => setTier(i, 'scheduleMinutes', parseInt(e.target.value) || 0)}
                        className="h-7 w-16 pl-5 text-sm border-handy-grid focus:border-handy-yellow"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right rail: active + save */}
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
