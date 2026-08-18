// ---------------------------------------------------------------------------
// LineAssumptionsEditor — per-line quote assumptions ("cover-your-back"
// caveats the line price is based on). Extracted from the contextual quote
// builder so the comms quote-prep panel edits the exact same thing.
//
// Suggestion chips come from the category library; ✨ drafts job-specific ones
// with AI. The parent owns the value — either supply your own onDraft pipeline
// (the builder does, so its auto-draft-on-polish path shares state) or omit it
// and the built-in fetch to /api/pricing/draft-line-assumptions is used.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wand2, X, Plus } from 'lucide-react';
import { getSuggestedAssumptions } from '@shared/assumptions-library';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Merge new assumptions onto existing ones, deduped case-insensitively. */
export function mergeAssumptions(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map((a) => a.trim().toLowerCase()));
  const merged = [...current];
  for (const a of incoming) {
    const key = a.trim().toLowerCase();
    if (a.trim() && !seen.has(key)) {
      merged.push(a.trim());
      seen.add(key);
    }
  }
  return merged;
}

export function LineAssumptionsEditor({
  assumptions,
  category,
  description,
  originalDescription,
  vaContext,
  onChange,
  onDraft,
  drafting,
}: {
  assumptions: string[];
  category?: string | null;
  description: string;
  /** Pre-polish description, when the parent tracks one — improves the AI draft. */
  originalDescription?: string;
  vaContext?: string;
  onChange: (next: string[]) => void;
  /** External draft pipeline (builder). Omitted = built-in fetch + merge. */
  onDraft?: () => void;
  /** External drafting flag, paired with onDraft. */
  drafting?: boolean;
}) {
  const [internalDrafting, setInternalDrafting] = useState(false);
  const isDrafting = drafting ?? internalDrafting;

  const suggestions = getSuggestedAssumptions(category).filter(
    (s) => !assumptions.some((a) => a.trim().toLowerCase() === s.trim().toLowerCase()),
  );

  const builtInDraft = async () => {
    setInternalDrafting(true);
    try {
      const res = await fetch('/api/pricing/draft-line-assumptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          lineDescription: description,
          originalDescription: originalDescription || undefined,
          category,
          vaContext: vaContext || undefined,
        }),
      });
      const { assumptions: drafted } = await res.json();
      if (Array.isArray(drafted) && drafted.length > 0) {
        onChange(mergeAssumptions(assumptions, drafted as string[]));
      }
    } catch {
      // Non-blocking — the operator can still add assumptions manually.
    } finally {
      setInternalDrafting(false);
    }
  };

  const addAssumption = (text: string) => {
    if (assumptions.some((a) => a.trim().toLowerCase() === text.trim().toLowerCase())) return;
    onChange([...assumptions, text]);
  };

  return (
    <div className="space-y-1 mt-2 pt-2 border-t border-dashed border-handy-grid">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-amber-600/90">
          Assumptions <span className="text-muted-foreground/50 font-normal">— protects your price</span>
        </Label>
        <button
          type="button"
          title="Draft assumptions from the line"
          aria-label="Draft assumptions"
          disabled={isDrafting || !description?.trim()}
          onClick={() => (onDraft ? onDraft() : void builtInDraft())}
          className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 hover:text-amber-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Wand2 className={`w-3 h-3 ${isDrafting ? 'animate-pulse' : ''}`} />
          {isDrafting ? 'drafting…' : 'Draft'}
        </button>
      </div>
      {assumptions.map((a, idx) => (
        <div key={idx} className="flex items-center gap-1">
          <Input
            value={a}
            placeholder="e.g. existing pipework is accessible and sound"
            onChange={(e) => {
              const next = [...assumptions];
              next[idx] = e.target.value;
              onChange(next);
            }}
            className="h-7 text-xs bg-transparent border-handy-grid focus:border-amber-400 transition-colors"
          />
          <button
            type="button"
            aria-label="Remove assumption"
            onClick={() => onChange(assumptions.filter((_, i) => i !== idx))}
            className="shrink-0 text-muted-foreground/50 hover:text-red-500 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              title={s}
              onClick={() => addAssumption(s)}
              className="text-[10px] px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors"
            >
              + {s.length > 44 ? s.slice(0, 42) + '…' : s}
            </button>
          ))}
        </div>
      )}
      {assumptions.length < 6 && (
        <button
          type="button"
          onClick={() => onChange([...assumptions, ''])}
          className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-handy-navy transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add assumption
        </button>
      )}
    </div>
  );
}

export default LineAssumptionsEditor;
