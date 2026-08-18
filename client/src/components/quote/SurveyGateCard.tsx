// ---------------------------------------------------------------------------
// SurveyGateCard — the "survey required before booking" gate + scope-risk
// auto-suggestion. Extracted from the contextual quote builder so the comms
// quote-prep panel carries the exact same control (Alicia fix).
//
// The suggestion banner never flips the gate on by itself: the operator
// confirms with one click (which also prefills the suggested fee).
// ---------------------------------------------------------------------------

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, Ruler } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScopeRiskResult } from '@/lib/scope-risk';

export function SurveyGateCard({
  surveyRequired,
  onSurveyRequiredChange,
  feePounds,
  onFeeChange,
  scopeRisk,
  switchId = 'survey-required',
}: {
  surveyRequired: boolean;
  onSurveyRequiredChange: (v: boolean) => void;
  feePounds: string;
  onFeeChange: (v: string) => void;
  /** Derived from the entered line items; omit to hide the suggestion banner. */
  scopeRisk?: ScopeRiskResult;
  /** Unique id when two instances could mount on one page. */
  switchId?: string;
}) {
  return (
    <div className={cn(
      'rounded-lg border-2 px-4 py-3 shadow-sm transition-colors',
      surveyRequired ? 'border-[#7DB00E] bg-[#7DB00E]/5' : 'border-handy-grid bg-white',
    )}>
      {/* Auto-suggest — fires when the entered work looks like scope could
          change on-site. Confirmed with one click (prefills the fee); it
          never flips the gate on by itself. */}
      {!surveyRequired && scopeRisk && scopeRisk.level !== 'none' && (
        <div className={cn(
          'mb-3 rounded-lg border-2 px-3 py-2.5',
          scopeRisk.level === 'likely'
            ? 'border-amber-500 bg-amber-50'
            : 'border-amber-300 bg-amber-50/60',
        )}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-handy-navy">
                {scopeRisk.level === 'likely'
                  ? 'Scope likely to change on-site'
                  : 'Scope could change on-site'}
                {' — survey first?'}
              </div>
              <ul className="mt-1 space-y-0.5">
                {scopeRisk.reasons.map((r) => (
                  <li key={r} className="text-xs text-handy-navy/75 flex gap-1.5">
                    <span className="text-amber-600">•</span>{r}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => {
                onSurveyRequiredChange(true);
                onFeeChange(String(Math.round(scopeRisk.suggestedFeePence / 100)));
              }}
              className="shrink-0 rounded-md bg-handy-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-handy-navy/90 active:scale-[0.98] transition-transform whitespace-nowrap"
            >
              Require survey (£{Math.round(scopeRisk.suggestedFeePence / 100)})
            </button>
          </div>
        </div>
      )}
      <Label htmlFor={switchId} className="flex items-start gap-3 cursor-pointer select-none">
        <Ruler className={cn('w-5 h-5 shrink-0 mt-0.5', surveyRequired ? 'text-[#7DB00E]' : 'text-handy-navy/50')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-handy-navy text-sm">Survey required before booking</span>
            <Switch id={switchId} checked={surveyRequired} onCheckedChange={onSurveyRequiredChange} />
          </div>
          <div className="text-xs text-handy-navy/70 mt-0.5">
            Customer can't book the job (no flexible slot, no date-pick). They book &amp; pay a site survey first — the job is quoted properly on the day. Use when the scope can't be trusted sight-unseen.
          </div>
        </div>
      </Label>
      {surveyRequired && (
        <div className="mt-3 pl-8 flex items-center gap-3">
          <Label htmlFor={`${switchId}-fee`} className="text-xs font-semibold text-handy-navy whitespace-nowrap">
            Survey fee (£)
          </Label>
          <div className="relative w-32">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-handy-navy/60 text-sm">£</span>
            <Input
              id={`${switchId}-fee`}
              type="number"
              min={0}
              step={5}
              inputMode="numeric"
              value={feePounds}
              onChange={(e) => onFeeChange(e.target.value)}
              placeholder="49"
              className="pl-6 h-9"
            />
          </div>
          <span className="text-[11px] text-handy-navy/60 leading-tight">
            Credited to the job. Required — must be more than £0.
          </span>
        </div>
      )}
    </div>
  );
}

export default SurveyGateCard;
