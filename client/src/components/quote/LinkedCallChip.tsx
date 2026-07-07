/**
 * LinkedCallChip — small attribution chip shown next to the phone field on the
 * contextual quote generator when the quote is linked to an originating call.
 *
 * Clicking the chip body opens a switcher listing all recent calls returned
 * for the customer's number (so the admin can re-point the link at an earlier
 * call); clicking the [×] unlinks entirely.
 *
 * Styled for the generator's forced-LIGHT shadcn token scope.
 */
import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Link2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shape of GET /api/calls/recent-by-phone results (and the chip's own state). */
export interface LinkedCallSummary {
  id: string;
  startTime?: string | null;
  durationSeconds?: number | null;
  customerName?: string | null;
  handledBy?: 'va' | 'ai_agent' | string | null;
  jobSummary?: string | null;
  overallScore?: number | null;
}

function formatCallTime(startTime?: string | null): string | null {
  if (!startTime) return null;
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, 'EEE d MMM HH:mm');
}

function formatCallDuration(seconds?: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

interface LinkedCallChipProps {
  call: LinkedCallSummary;
  /** All recent calls for this number — chip click opens a switcher when present. */
  matches?: LinkedCallSummary[];
  onSelect: (call: LinkedCallSummary) => void;
  onUnlink: () => void;
}

export function LinkedCallChip({ call, matches = [], onSelect, onUnlink }: LinkedCallChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the switcher on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const time = formatCallTime(call.startTime);
  const duration = formatCallDuration(call.durationSeconds);

  return (
    <div ref={rootRef} className="relative mt-1.5">
      <div className="inline-flex items-center gap-1 max-w-full rounded-full border border-blue-200 bg-blue-50 pl-2.5 pr-1 py-1 text-[11px] text-blue-800">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 min-w-0 hover:text-blue-950"
          title={matches.length > 1 ? 'Switch linked call' : call.jobSummary || 'Linked call'}
        >
          <Link2 className="w-3 h-3 shrink-0" />
          <span className="font-semibold whitespace-nowrap">{time ? 'Linked call' : 'Linked to call'}</span>
          {time && <span className="whitespace-nowrap text-blue-700/80">· {time}</span>}
          {duration && <span className="whitespace-nowrap text-blue-700/80">· {duration}</span>}
          {call.overallScore != null && (
            <span className="shrink-0 px-1 rounded bg-blue-100 border border-blue-200 font-mono font-bold text-[10px]">
              {call.overallScore}
            </span>
          )}
          {call.jobSummary && (
            <span className="truncate max-w-[220px] text-blue-700/80">· {call.jobSummary}</span>
          )}
        </button>
        <button
          type="button"
          onClick={onUnlink}
          className="p-0.5 rounded-full text-blue-500 hover:text-blue-900 hover:bg-blue-100 transition-colors"
          title="Unlink call"
          aria-label="Unlink call"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-72 max-w-[85vw] rounded-md border border-handy-grid bg-white shadow-lg py-1">
          {matches.map((m) => {
            const mTime = formatCallTime(m.startTime);
            const mDuration = formatCallDuration(m.durationSeconds);
            const isLinked = m.id === call.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m);
                  setOpen(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors',
                  isLinked && 'bg-blue-50/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-handy-navy">{mTime || 'Unknown time'}</span>
                  {mDuration && <span className="text-muted-foreground">{mDuration}</span>}
                  {isLinked && (
                    <span className="ml-auto text-[10px] font-semibold text-blue-600">LINKED</span>
                  )}
                </div>
                <div className="text-muted-foreground truncate">
                  {[m.customerName, m.jobSummary].filter(Boolean).join(' · ') || 'No summary'}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
