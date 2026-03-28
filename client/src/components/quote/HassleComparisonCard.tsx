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

      {/* Desktop: 2-column grid */}
      <div className="hidden md:block divide-y divide-slate-100">
        {comparisons.map((item) => (
          <div key={item.id} className="grid grid-cols-2 divide-x divide-slate-100">
            <div className="px-4 py-3 flex items-start gap-2.5 bg-red-50/50">
              <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <X className="w-3 h-3 text-red-400" />
              </div>
              <span className="text-slate-500 text-xs leading-relaxed">{item.withoutUs}</span>
            </div>
            <div className="px-4 py-3 flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#7DB00E]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Check className="w-3 h-3 text-[#7DB00E]" />
              </div>
              <span className="text-slate-700 text-xs font-medium leading-relaxed">{item.withUs}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: stacked cards */}
      <div className="md:hidden divide-y divide-slate-100">
        {comparisons.map((item) => (
          <div key={item.id}>
            <div className="px-4 py-2.5 flex items-start gap-2.5 bg-red-50/40">
              <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <span className="text-slate-400 text-sm line-through decoration-red-300/60">{item.withoutUs}</span>
            </div>
            <div className="px-4 py-2.5 flex items-start gap-2.5">
              <Check className="w-3.5 h-3.5 text-[#7DB00E] flex-shrink-0 mt-0.5" />
              <span className="text-slate-700 text-sm font-medium">{item.withUs}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
