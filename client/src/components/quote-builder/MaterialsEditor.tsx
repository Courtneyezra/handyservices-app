/**
 * MaterialsEditor — editable materials list for quote builder.
 *
 * Displays materials as an editable list with inline quantity editing,
 * confidence badges, and add material functionality. Uses the existing
 * materials catalog/Screwfix search endpoint.
 */
import { useEffect, useRef, useState } from 'react';
import {
    Plus, Trash2, Search, ExternalLink, Loader2, AlertTriangle, CheckCircle2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EstimatedMaterial } from '@shared/quote-build';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface MaterialsEditorProps {
    materials: EstimatedMaterial[];
    onChange?: (materials: EstimatedMaterial[]) => void;
    readOnly?: boolean;
}

interface MaterialSearchResult {
    name: string;
    pricePenceExVat?: number;
    pricePenceIncVat?: number;
    imageUrl?: string;
    supplier: string;
    supplierItemNumber?: string;
    supplierUrl?: string;
    catalogId?: string;
}

/** Supplier badge styles. */
const SUPPLIER_STYLES: Record<string, { bg: string; text: string }> = {
    catalog: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    screwfix: { bg: 'bg-orange-100', text: 'text-orange-700' },
    web: { bg: 'bg-amber-100', text: 'text-amber-700' },
    model: { bg: 'bg-red-100', text: 'text-red-700' },
    manual: { bg: 'bg-slate-100', text: 'text-slate-600' },
};

export function MaterialsEditor({ materials, onChange, readOnly = false }: MaterialsEditorProps) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MaterialSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [editingQty, setEditingQty] = useState<number | null>(null);
    const [qtyValue, setQtyValue] = useState('');
    const abortRef = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const list = materials ?? [];

    // Debounced search
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
                    { headers: getAuthHeaders(), signal: ctrl.signal }
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

    // Focus search input when opening
    useEffect(() => {
        if (searchOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [searchOpen]);

    const addMaterial = (r: MaterialSearchResult) => {
        const newMaterial: EstimatedMaterial = {
            name: r.name,
            qty: 1,
            unitPricePence: r.pricePenceExVat ?? r.pricePenceIncVat ?? 0,
            unitPriceIncVatPence: r.pricePenceIncVat,
            imageUrl: r.imageUrl,
            supplier: (r.supplier as EstimatedMaterial['supplier']) ?? 'web',
            supplierItemNumber: r.supplierItemNumber,
            supplierUrl: r.supplierUrl,
            catalogId: r.catalogId,
            needsReview: !r.catalogId && r.supplier !== 'screwfix',
        };
        onChange?.([...list, newMaterial]);
        setSearchOpen(false);
        setQuery('');
        setResults([]);
    };

    const updateQty = (index: number, qty: number) => {
        const next = list.map((m, i) =>
            i === index ? { ...m, qty: Math.max(1, Math.floor(qty || 1)) } : m
        );
        onChange?.(next);
    };

    const removeMaterial = (index: number) => {
        onChange?.(list.filter((_, i) => i !== index));
    };

    const startEditQty = (index: number) => {
        setEditingQty(index);
        setQtyValue(String(list[index].qty));
    };

    const commitQtyEdit = () => {
        if (editingQty !== null) {
            const qty = parseInt(qtyValue, 10);
            if (!isNaN(qty) && qty >= 1) {
                updateQty(editingQty, qty);
            }
            setEditingQty(null);
        }
    };

    if (list.length === 0 && readOnly) {
        return (
            <p className="text-xs text-slate-500 italic">No materials specified</p>
        );
    }

    return (
        <div className="space-y-2">
            {/* Material list */}
            {list.length > 0 && (
                <div className="space-y-1.5">
                    {list.map((m, i) => {
                        const subtotal = Math.max(0, Math.round(m.unitPricePence ?? 0)) * Math.max(0, Math.floor(m.qty ?? 0));
                        const supplierStyle = SUPPLIER_STYLES[m.supplier] ?? SUPPLIER_STYLES.web;

                        return (
                            <div
                                key={`${m.catalogId ?? m.supplierItemNumber ?? m.name}-${i}`}
                                className={cn(
                                    'flex items-center gap-2 rounded-md border bg-white px-2 py-1.5',
                                    m.needsReview ? 'border-amber-300' : 'border-slate-200'
                                )}
                            >
                                {/* Thumbnail */}
                                {m.imageUrl ? (
                                    <img
                                        src={m.imageUrl}
                                        alt=""
                                        className="h-8 w-8 rounded object-contain bg-white border border-slate-200 shrink-0"
                                    />
                                ) : (
                                    <div className="h-8 w-8 rounded bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center text-xs text-slate-400">
                                        ?
                                    </div>
                                )}

                                {/* Details */}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="truncate text-xs font-medium text-slate-800">
                                            {m.name}
                                        </span>
                                        {m.needsReview && (
                                            <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" title="Needs price review" />
                                        )}
                                        {m.supplierUrl && (
                                            <a
                                                href={m.supplierUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="shrink-0 text-slate-400 hover:text-slate-600"
                                                title="Open product page"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                        <span className={cn('rounded px-1 py-px font-medium uppercase', supplierStyle.bg, supplierStyle.text)}>
                                            {m.supplier}
                                        </span>
                                        <span>{'\u00A3'}{((m.unitPricePence ?? 0) / 100).toFixed(2)} ea</span>
                                    </div>
                                </div>

                                {/* Quantity */}
                                {!readOnly && editingQty === i ? (
                                    <input
                                        type="number"
                                        min={1}
                                        value={qtyValue}
                                        onChange={(e) => setQtyValue(e.target.value)}
                                        onBlur={commitQtyEdit}
                                        onKeyDown={(e) => e.key === 'Enter' && commitQtyEdit()}
                                        className="w-12 rounded border border-slate-300 px-1.5 py-0.5 text-center text-xs focus:border-slate-500 focus:outline-none"
                                        autoFocus
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => !readOnly && startEditQty(i)}
                                        disabled={readOnly}
                                        className={cn(
                                            'w-12 rounded border px-1.5 py-0.5 text-center text-xs font-medium',
                                            readOnly
                                                ? 'border-slate-200 bg-slate-50 text-slate-600'
                                                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                                        )}
                                        title="Click to edit quantity"
                                    >
                                        x{m.qty}
                                    </button>
                                )}

                                {/* Subtotal */}
                                <span className="w-14 text-right text-xs font-medium text-slate-700">
                                    {'\u00A3'}{(subtotal / 100).toFixed(2)}
                                </span>

                                {/* Remove */}
                                {!readOnly && (
                                    <button
                                        type="button"
                                        onClick={() => removeMaterial(i)}
                                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                        title="Remove material"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add material */}
            {!readOnly && (
                searchOpen ? (
                    <div className="rounded-md border border-slate-300 bg-white p-2">
                        <div className="flex items-center gap-2">
                            <Search className="h-4 w-4 shrink-0 text-slate-400" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search materials..."
                                className="flex-1 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                            />
                            {searching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                            <button
                                type="button"
                                onClick={() => { setSearchOpen(false); setQuery(''); setResults([]); }}
                                className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        {results.length > 0 && (
                            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                                {results.map((r, i) => (
                                    <button
                                        key={`${r.catalogId ?? r.supplierItemNumber ?? r.name}-${i}`}
                                        type="button"
                                        onClick={() => addMaterial(r)}
                                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                                    >
                                        {r.imageUrl ? (
                                            <img src={r.imageUrl} alt="" className="h-6 w-6 rounded object-contain" />
                                        ) : (
                                            <div className="h-6 w-6 rounded bg-slate-100 flex items-center justify-center text-[10px] text-slate-400">?</div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-xs font-medium text-slate-800">{r.name}</p>
                                            <p className="text-[10px] text-slate-500">
                                                {r.supplier} - {'\u00A3'}{((r.pricePenceExVat ?? r.pricePenceIncVat ?? 0) / 100).toFixed(2)}
                                            </p>
                                        </div>
                                        <Plus className="h-4 w-4 shrink-0 text-slate-400" />
                                    </button>
                                ))}
                            </div>
                        )}
                        {query.length >= 2 && !searching && results.length === 0 && (
                            <p className="mt-2 text-center text-xs text-slate-500">No materials found</p>
                        )}
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setSearchOpen(true)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 py-1.5 text-xs text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add material
                    </button>
                )
            )}
        </div>
    );
}
