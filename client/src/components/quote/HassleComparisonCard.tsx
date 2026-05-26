import { Fragment } from "react";
import { X, Check } from "lucide-react";
import { getHassleComparisons, HASSLE_SECTION_HEADLINES, type HassleComparison } from "@shared/hassle-comparisons";

const GENERIC_COMPARISONS: HassleComparison[] = [
  {
    id: 'generic-search',
    withoutUs: 'Searching Google for hours',
    withUs: 'One message, we handle everything',
    whatsappLine: '📱 One message, we handle everything — no searching around',
    vaScript: 'One message and we handle everything — no searching around',
  },
  {
    id: 'generic-pricing',
    withoutUs: 'No fixed price — hourly surprises',
    withUs: 'Fixed price — no surprises',
    whatsappLine: '💰 Fixed price upfront — no hourly surprises',
    vaScript: 'Fixed price — no surprises, you know exactly what you\'re paying',
  },
  {
    id: 'generic-proof',
    withoutUs: 'No photos, no proof of work',
    withUs: 'Photo report on completion',
    whatsappLine: '📸 Photo report on completion — proof of work included',
    vaScript: 'We send you a photo report when it\'s done',
  },
  {
    id: 'generic-updates',
    withoutUs: 'Chase for updates yourself',
    withUs: 'Updates at every stage',
    whatsappLine: '📋 Updates at every stage — no chasing needed',
    vaScript: 'We keep you updated at every stage — no chasing',
  },
  {
    id: 'generic-guarantee',
    withoutUs: 'No guarantee if it goes wrong',
    withUs: 'Not right? We return and fix it free',
    whatsappLine: '🛡️ Not right? We return and fix it free',
    vaScript: 'If anything\'s not right, we come back and fix it free',
  },
];

interface HassleComparisonCardProps {
  segment?: string;
  maxItems?: number;
  hideTitle?: boolean;
  contextualItems?: {
    withoutUs: string[];
    withUs: string[];
  };
}

export function HassleComparisonCard({ segment, maxItems = 4, hideTitle = false, contextualItems }: HassleComparisonCardProps) {
  let comparisons: HassleComparison[];

  if (contextualItems) {
    // Build comparisons from contextual data, pairing withoutUs[i] with withUs[i]
    const length = Math.min(contextualItems.withoutUs.length, contextualItems.withUs.length);
    comparisons = Array.from({ length }, (_, i) => ({
      id: `contextual-${i}`,
      withoutUs: contextualItems.withoutUs[i],
      withUs: contextualItems.withUs[i],
      whatsappLine: '',
      vaScript: '',
    }));
    if (maxItems) {
      comparisons = comparisons.slice(0, maxItems);
    }
  } else if (segment) {
    comparisons = getHassleComparisons(segment, maxItems);
  } else {
    comparisons = maxItems ? GENERIC_COMPARISONS.slice(0, maxItems) : GENERIC_COMPARISONS;
  }

  const headlines = segment
    ? (HASSLE_SECTION_HEADLINES[segment] || HASSLE_SECTION_HEADLINES['UNKNOWN'])
    : HASSLE_SECTION_HEADLINES['UNKNOWN'];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {!hideTitle && (
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-lg">{headlines.title}</h3>
          <p className="text-slate-500 text-sm mt-0.5">{headlines.subtitle}</p>
        </div>
      )}

      {/* Feature-comparison table: each row is a benefit, with a muted "Others" column
          (✗) and a highlighted "Us" column (✓ on a green band). Columns are continuous
          vertical bands behind a grid, so all ✗ line up and all ✓ line up. */}
      <div className="p-4 sm:p-6">
        <div className="relative">
          {/* Continuous column bands */}
          <div className="pointer-events-none absolute inset-y-0 right-16 w-16 rounded-xl bg-slate-100" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 rounded-xl bg-gradient-to-b from-[#7DB00E] to-[#6a9a0c] shadow-lg shadow-[#7DB00E]/25" aria-hidden="true" />

          <div className="relative grid grid-cols-[1fr_4rem_4rem] items-stretch">
            {/* Header row */}
            <div />
            <div className="flex items-center justify-center py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Others</div>
            <div className="flex items-center justify-center py-2.5 text-[11px] font-bold uppercase tracking-wide text-white">Us</div>

            {/* Feature rows */}
            {comparisons.map((item) => (
              <Fragment key={item.id}>
                <div className="flex items-center py-3 pr-3 text-sm font-semibold text-slate-800 leading-tight">
                  {item.label || item.withUs.split(/\s+—\s+/)[0]}
                </div>
                <div className="flex items-center justify-center py-3">
                  <X className="w-4 h-4 text-slate-300" strokeWidth={2.5} />
                </div>
                <div className="flex items-center justify-center py-3">
                  <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center shadow-sm">
                    <Check className="w-3 h-3 text-[#5f8209]" strokeWidth={3.5} />
                  </span>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
