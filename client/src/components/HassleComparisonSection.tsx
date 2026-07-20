import { X, Check } from "lucide-react";
import { getHassleComparisons, HASSLE_SECTION_HEADLINES } from "@shared/hassle-comparisons";

interface HassleComparisonSectionProps {
  segment: string;
  maxItems?: number;
}

/**
 * Landing "No waiting. No chasing. No mess." — the Us/Them comparison in the
 * same bold, bright style as the contextual quote page: a muted "Without us"
 * column against solid bright-green "With Handy Services" blocks, so the whole
 * right side reads as one confident green band. High-contrast solid colour,
 * not subtle tints.
 */
export function HassleComparisonSection({ segment, maxItems = 4 }: HassleComparisonSectionProps) {
  const comparisons = getHassleComparisons(segment, maxItems);
  const headlines = HASSLE_SECTION_HEADLINES[segment] || HASSLE_SECTION_HEADLINES['UNKNOWN'];

  return (
    <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10 lg:mb-14">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 mb-4">
            {headlines.title}
          </h2>
          <p className="text-slate-500 text-lg">{headlines.subtitle}</p>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-2 gap-2.5 md:gap-4 mb-3">
          <div className="text-center text-[11px] md:text-sm font-bold uppercase tracking-wider text-slate-400">
            The usual handyman
          </div>
          <div className="text-center text-[11px] md:text-sm font-bold uppercase tracking-wider text-[#5f8209]">
            With Handy Services
          </div>
        </div>

        <div className="space-y-2.5 md:space-y-3">
          {comparisons.map((item) => (
            <div key={item.id} className="grid grid-cols-2 gap-2.5 md:gap-4 items-stretch">
              {/* Without us — muted block */}
              <div className="bg-slate-100 rounded-2xl p-4 md:p-5 flex items-start gap-2.5 md:gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-300/80 flex items-center justify-center shrink-0 mt-0.5">
                  <X className="w-3.5 h-3.5 text-slate-500" strokeWidth={3} />
                </span>
                <span className="text-slate-500 text-[13px] md:text-base leading-snug">{item.withoutUs}</span>
              </div>

              {/* With us — solid bright-green block */}
              <div className="bg-gradient-to-br from-[#7DB00E] to-[#6a9a0c] rounded-2xl p-4 md:p-5 flex items-start gap-2.5 md:gap-3 shadow-lg shadow-[#7DB00E]/25">
                <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center shrink-0 mt-0.5">
                  <Check className="w-3.5 h-3.5 text-[#5f8209]" strokeWidth={3.5} />
                </span>
                <span className="text-white font-semibold text-[13px] md:text-base leading-snug">{item.withUs}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
