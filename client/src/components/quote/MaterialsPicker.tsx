// ---------------------------------------------------------------------------
// MaterialsPicker — per-line structured "shopping list" editor for the admin
// quote builder. Search the materials catalog + live Screwfix, pick items, and
// tune quantities. The picked list (QuoteMaterial[]) rides the quote → booking
// → job-sheet rails so a contractor knows exactly WHAT to buy, not just a lump
// materials cost.
//
// Cost basis: unit prices are in PENCE. `unitPricePence` is the TRADE (ex-VAT)
// price — the quote's cost basis. The parent keeps the line's materials cost in
// sync via `materialsCostPence(materials)` whenever this fires `onChange`.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Trash2, Search, ExternalLink, X } from 'lucide-react';
import {
  type QuoteMaterial,
  type MaterialSearchResult,
  materialsCostPence,
} from '@shared/materials';

// Auth header shape mirrors the parent builder (Bearer adminToken from storage).
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function poundsFromPence(pence: number | undefined | null): string {
  return `£${((pence ?? 0) / 100).toFixed(2)}`;
}

/** Normalise a supplier search hit into an attachable QuoteMaterial. */
function resultToMaterial(
  r: MaterialSearchResult,
  catalogId?: string,
): QuoteMaterial {
  const exVat = r.pricePenceExVat ?? r.pricePenceIncVat ?? 0;
  return {
    catalogId: catalogId ?? r.catalogId,
    name: r.name,
    qty: 1,
    unitPricePence: exVat,
    unitPriceIncVatPence: r.pricePenceIncVat,
    imageUrl: r.imageUrl,
    supplier: r.supplier,
    supplierItemNumber: r.supplierItemNumber,
    supplierUrl: r.supplierUrl,
  };
}

export function MaterialsPicker({
  materials,
  onChange,
}: {
  materials: QuoteMaterial[];
  onChange: (materials: QuoteMaterial[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MaterialSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const list = materials ?? [];
  const totalPence = useMemo(() => materialsCostPence(list), [list]);

  // Debounced catalog + Screwfix search — only fires for queries ≥ 2 chars.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(
          `/api/materials/search?q=${encodeURIComponent(q)}`,
          { headers: { ...getAuthHeaders() }, signal: ctrl.signal },
        );
        if (!res.ok) throw new Error('search failed');
        const data = await res.json();
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  // Add a picked search result. Live Screwfix hits (no catalogId) are cached
  // via POST /api/materials/catalog first so they gain a stable catalogId;
  // best-effort — a failed cache still attaches the item (without catalogId).
  const addResult = async (r: MaterialSearchResult, key: string) => {
    setAddingKey(key);
    let catalogId = r.catalogId;
    if (!catalogId) {
      try {
        const res = await fetch('/api/materials/catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify(r),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.catalogId) catalogId = data.catalogId;
        }
      } catch {
        // best-effort: fall through and add without a catalogId
      }
    }
    onChange([...list, resultToMaterial(r, catalogId)]);
    setAddingKey(null);
    // The search UI is scaffolding: once the choice is made it gets out of the
    // way — the picked item shows as a chip below, "search again" to reopen.
    setQuery('');
    setResults([]);
  };

  const setQty = (index: number, qty: number) => {
    const next = list.map((m, i) =>
      i === index ? { ...m, qty: Math.max(1, Math.floor(qty || 1)) } : m,
    );
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(list.filter((_, i) => i !== index));
  };

  const addManual = () => {
    const name = manualName.trim();
    const pounds = parseFloat(manualPrice);
    if (!name) return;
    const unitPricePence = Number.isFinite(pounds) && pounds >= 0
      ? Math.round(pounds * 100)
      : 0;
    onChange([
      ...list,
      { name, qty: 1, unitPricePence, supplier: 'manual' as const },
    ]);
    setManualName('');
    setManualPrice('');
    setManualOpen(false);
  };

  return (
    <div className="w-full rounded-lg border border-handy-grid bg-handy-cream/40 p-2.5 space-y-2.5">
      {/* ── Current materials ─────────────────────────────────────────── */}
      {list.length > 0 && (
        <div className="space-y-1.5">
          {list.map((m, i) => {
            const subtotal = Math.max(0, Math.round(m.unitPricePence ?? 0)) *
              Math.max(0, Math.floor(m.qty ?? 0));
            return (
              <div
                key={`${m.catalogId ?? m.supplierItemNumber ?? m.name}-${i}`}
                className="flex items-center gap-2 rounded-md border border-handy-grid bg-white px-2 py-1.5"
              >
                {m.imageUrl ? (
                  <img
                    src={m.imageUrl}
                    alt=""
                    className="h-9 w-9 rounded object-contain bg-white border border-handy-grid shrink-0"
                  />
                ) : (
                  <div className="h-9 w-9 rounded bg-handy-cream border border-handy-grid shrink-0 flex items-center justify-center text-xs">
                    🧱
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-handy-navy">
                      {m.name}
                    </span>
                    {m.supplier === 'manual' && (
                      <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-handy-navy/40">
                        manual
                      </span>
                    )}
                    {m.supplierUrl && (
                      <a
                        href={m.supplierUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-handy-navy/40 hover:text-handy-navy"
                        title="Open product page"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {poundsFromPence(m.unitPricePence)} ex-VAT
                    {m.unitPriceIncVatPence
                      ? ` · ${poundsFromPence(m.unitPriceIncVatPence)} inc`
                      : ''}
                    {' · '}
                    <span className="font-semibold text-handy-navy">
                      {poundsFromPence(subtotal)}
                    </span>
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={m.qty}
                  onChange={(e) => setQty(i, parseInt(e.target.value, 10))}
                  className="w-12 h-8 text-center text-sm rounded-md border border-handy-grid bg-white tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  aria-label="Quantity"
                />
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="shrink-0 text-muted-foreground/40 hover:text-red-500 transition-colors p-1"
                  aria-label="Remove material"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-1 pt-0.5 text-xs">
            <span className="text-muted-foreground">
              Materials: <span className="font-bold text-handy-navy tabular-nums">{poundsFromPence(totalPence)}</span>
              <span className="text-muted-foreground/70"> ({list.length} item{list.length === 1 ? '' : 's'})</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Search ────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
        <Input
          type="text"
          value={query}
          placeholder="Search Screwfix / catalog…"
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 pl-8 pr-8 text-sm bg-white border-handy-grid"
        />
        {searching ? (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
        ) : query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-handy-navy"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>

      {/* Results */}
      {query.trim().length >= 2 && (
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-md">
          {results.length === 0 && !searching && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              No matches. Add it manually below.
            </p>
          )}
          {results.map((r, i) => {
            const key = `${r.catalogId ?? r.supplierItemNumber ?? r.name}-${i}`;
            const price = r.pricePenceExVat ?? r.pricePenceIncVat ?? 0;
            return (
              <button
                key={key}
                type="button"
                disabled={addingKey === key}
                onClick={() => addResult(r, key)}
                className="w-full flex items-center gap-2 rounded-md border border-handy-grid bg-white px-2 py-1.5 text-left hover:border-handy-navy/40 hover:bg-handy-cream/50 transition-colors disabled:opacity-50"
              >
                {r.imageUrl ? (
                  <img
                    src={r.imageUrl}
                    alt=""
                    className="h-9 w-9 rounded object-contain bg-white border border-handy-grid shrink-0"
                  />
                ) : (
                  <div className="h-9 w-9 rounded bg-handy-cream border border-handy-grid shrink-0 flex items-center justify-center text-xs">
                    🧱
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-handy-navy">
                      {r.name}
                    </span>
                    {r.fromCatalog && (
                      <span className="shrink-0 rounded bg-green-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-green-700">
                        saved
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {r.brand ? `${r.brand} · ` : ''}
                    <span className="font-semibold text-handy-navy tabular-nums">
                      {poundsFromPence(price)}
                    </span>{' '}
                    ex-VAT
                    {!r.fromCatalog && (
                      <span className="text-muted-foreground/60"> · Screwfix</span>
                    )}
                  </div>
                </div>
                {addingKey === key ? (
                  <Loader2 className="w-4 h-4 text-handy-navy animate-spin shrink-0" />
                ) : (
                  <Plus className="w-4 h-4 text-handy-navy/60 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Manual add fallback ───────────────────────────────────────── */}
      {manualOpen ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="text"
            value={manualName}
            placeholder="Item name"
            onChange={(e) => setManualName(e.target.value)}
            className="h-8 flex-1 text-sm bg-white border-handy-grid"
          />
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-sm text-muted-foreground">£</span>
            <Input
              type="text"
              inputMode="decimal"
              value={manualPrice}
              placeholder="0"
              onChange={(e) =>
                setManualPrice(e.target.value.replace(/[^0-9.]/g, ''))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') addManual();
              }}
              className="h-8 w-20 text-center text-sm bg-white border-handy-grid"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={addManual}
            disabled={!manualName.trim()}
            className="h-8 shrink-0"
          >
            Add
          </Button>
          <button
            type="button"
            onClick={() => setManualOpen(false)}
            className="shrink-0 text-muted-foreground/50 hover:text-handy-navy p-1"
            aria-label="Cancel manual add"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="text-xs text-muted-foreground hover:text-handy-navy transition-colors"
        >
          + Add material manually
        </button>
      )}
    </div>
  );
}

export default MaterialsPicker;
