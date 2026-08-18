// ---------------------------------------------------------------------------
// ExtrasEditor — optional extras for a quote: catalog-driven suggestions
// (scored by the line categories), the selected list, and a custom one-off
// form. Extracted from the contextual quote builder so the comms quote-prep
// panel offers the same extras. Self-contained: it fetches its own
// suggestions from /api/admin/extras-catalog/suggested; the parent owns only
// the selected OptionalExtra[] value.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, RefreshCw, Wand2 } from 'lucide-react';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface OptionalExtra {
  label: string;
  description: string;
  priceInPence: number;
  badge?: string;
  /** Tracks whether this came from the library (id) or is a custom one. */
  catalogId?: string;
}

/** Catalog suggestion — carries reasoning and is keyed by label until ticked. */
interface SuggestedExtra {
  label: string;
  description: string;
  priceInPence: number;
  badge?: string | null;
  reasoning?: string | null;
  catalogId?: string;
}

export function ExtrasEditor({
  categories,
  value,
  onChange,
}: {
  /** Line categories driving the suggestions; empty = no suggestions fetched. */
  categories: string[];
  value: OptionalExtra[];
  onChange: (next: OptionalExtra[]) => void;
}) {
  const [suggested, setSuggested] = useState<SuggestedExtra[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customDraft, setCustomDraft] = useState({ label: '', description: '', pricePounds: '', badge: '' });
  const [customError, setCustomError] = useState<string | null>(null);
  const lastKeyRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  const fetchSuggestions = useCallback(async (force = false) => {
    const cats = Array.from(new Set(categories.filter(Boolean))).sort();
    if (cats.length === 0) {
      setSuggested([]);
      lastKeyRef.current = '';
      return;
    }
    const key = cats.join(',');
    if (!force && key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ categories: cats.join(','), limit: '6' });
      const res = await fetch(`/api/admin/extras-catalog/suggested?${params.toString()}`, {
        headers: { ...getAuthHeaders() },
        signal: controller.signal,
      });
      if (!res.ok) {
        setSuggested([]);
        return;
      }
      const data = await res.json();
      const mapped: SuggestedExtra[] = (Array.isArray(data?.extras) ? data.extras : []).map((e: any) => ({
        label: e.label,
        description: e.description,
        priceInPence: e.priceInPence,
        badge: e.badge ?? undefined,
        catalogId: e.id,
      }));
      setSuggested(mapped);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setSuggested([]);
    } finally {
      setLoading(false);
    }
  }, [categories]);

  // Debounced trigger — wait for the categories to stabilise before suggesting.
  useEffect(() => {
    const t = setTimeout(() => { void fetchSuggestions(false); }, 1200);
    return () => clearTimeout(t);
  }, [fetchSuggestions]);

  const addCustom = () => {
    const label = customDraft.label.trim();
    const priceNum = parseFloat(customDraft.pricePounds);
    if (!label) {
      setCustomError('Give the extra a label.');
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setCustomError('Enter a valid £ amount.');
      return;
    }
    setCustomError(null);
    onChange([
      ...value,
      {
        label,
        description: customDraft.description.trim(),
        priceInPence: Math.round(priceNum * 100),
        badge: customDraft.badge.trim() || undefined,
      },
    ]);
    setCustomDraft({ label: '', description: '', pricePounds: '', badge: '' });
    setShowCustomForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Suggestions — catalog-driven, scored by category relevance */}
      {(suggested.length > 0 || loading) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-handy-yellow flex items-center gap-1.5">
              <Wand2 className="w-3 h-3" />
              AI suggestions
              {loading && <span className="text-[10px] text-muted-foreground/60 animate-pulse ml-1">thinking...</span>}
            </Label>
            <button
              type="button"
              onClick={() => void fetchSuggestions(true)}
              disabled={loading || categories.length === 0}
              title="Re-suggest from current context"
              aria-label="Refresh suggestions"
              className="text-muted-foreground/50 hover:text-handy-yellow disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {suggested.length === 0 && loading && (
            <div className="text-[11px] text-muted-foreground/50 italic px-1">
              Reading context + jobs...
            </div>
          )}
          <div className="space-y-1.5">
            {suggested.map((sug, idx) => {
              const checked = value.some(
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
                        onChange([
                          ...value,
                          {
                            label: sug.label,
                            description: sug.description,
                            priceInPence: sug.priceInPence,
                            badge: sug.badge ?? undefined,
                          },
                        ]);
                      } else {
                        onChange(value.filter(
                          (x) => !(!x.catalogId && x.label.toLowerCase() === sug.label.toLowerCase()),
                        ));
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
      {value.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <Label className="text-xs text-muted-foreground">Selected for this quote ({value.length})</Label>
          <div className="space-y-1.5">
            {value.map((extra, idx) => (
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
                  onClick={() => onChange(value.filter((_, i) => i !== idx))}
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
        {!showCustomForm ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCustomForm(true)}
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
                value={customDraft.label}
                onChange={(e) => setCustomDraft((d) => ({ ...d, label: e.target.value }))}
                className="mt-1 h-10 text-base sm:h-8 sm:text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Description</Label>
              <Textarea
                placeholder="What's included…"
                value={customDraft.description}
                onChange={(e) => setCustomDraft((d) => ({ ...d, description: e.target.value }))}
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
                  value={customDraft.pricePounds}
                  onChange={(e) => setCustomDraft((d) => ({ ...d, pricePounds: e.target.value }))}
                  className="mt-1 h-10 text-base sm:h-8 sm:text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Badge (optional)</Label>
                <Input
                  placeholder="Popular"
                  value={customDraft.badge}
                  onChange={(e) => setCustomDraft((d) => ({ ...d, badge: e.target.value }))}
                  className="mt-1 h-10 text-base sm:h-8 sm:text-xs"
                />
              </div>
            </div>
            {customError && <p className="text-xs text-red-600">{customError}</p>}
            <div className="flex gap-2 pt-1">
              <Button type="button" size="sm" className="text-xs h-8" onClick={addCustom}>
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => {
                  setShowCustomForm(false);
                  setCustomDraft({ label: '', description: '', pricePounds: '', badge: '' });
                  setCustomError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExtrasEditor;
