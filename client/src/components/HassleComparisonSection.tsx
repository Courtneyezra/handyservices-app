import { X, Check } from "lucide-react";
import { getHassleComparisons, HASSLE_SECTION_HEADLINES } from "@shared/hassle-comparisons";

interface HassleComparisonSectionProps {
  segment: string;
  maxItems?: number;
}

export function HassleComparisonSection({ segment, maxItems = 4 }: HassleComparisonSectionProps) {
  const comparisons = getHassleComparisons(segment, maxItems);
  const headlines = HASSLE_SECTION_HEADLINES[segment] || HASSLE_SECTION_HEADLINES['UNKNOWN'];

  return (
    <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12 lg:mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 mb-4">
            {headlines.title}
          </h2>
          <p className="text-slate-500 text-lg">{headlines.subtitle}</p>
        </div>

        {/* Desktop: 2-column grid */}
        <div className="hidden md:block">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="text-center text-sm font-semibold text-slate-400 uppercase tracking-wider pb-2">
              Without us
            </div>
            <div className="text-center text-sm font-semibold text-[#7DB00E] uppercase tracking-wider pb-2">
              With Handy Services
            </div>
          </div>
          <div className="space-y-3">
            {comparisons.map((item) => (
              <div key={item.id} className="grid grid-cols-2 gap-4">
                <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <X className="w-4 h-4 text-red-400" />
                  </div>
                  <span className="text-slate-600 text-sm leading-relaxed">{item.withoutUs}</span>
                </div>
                <div className="bg-[#7DB00E]/5 border border-[#7DB00E]/20 rounded-2xl p-5 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#7DB00E]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="w-4 h-4 text-[#7DB00E]" />
                  </div>
                  <span className="text-slate-800 font-medium text-sm leading-relaxed">{item.withUs}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile: stacked cards */}
        <div className="md:hidden space-y-4">
          {comparisons.map((item) => (
            <div key={item.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-red-50 px-4 py-3 flex items-start gap-3 border-b border-red-100">
                <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-500 text-sm line-through decoration-red-300">{item.withoutUs}</span>
              </div>
              <div className="bg-[#7DB00E]/5 px-4 py-3 flex items-start gap-3">
                <Check className="w-4 h-4 text-[#7DB00E] flex-shrink-0 mt-0.5" />
                <span className="text-slate-800 font-medium text-sm">{item.withUs}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
