import { RotateCcw, Wallet, type LucideIcon } from 'lucide-react';
import { AxaLogo } from '@/components/AxaInsuredBadge';
import { verticalConfig } from '@shared/verticals';

type Accountability = { icon?: LucideIcon; axa?: boolean; title: string; sub: string };

/**
 * Price-objection killer, shown right after the booking card where the objection
 * fires. Our conversion data shows the wall on bigger quotes is a decision-process
 * problem, not the number — customers compare our price to a cheaper quote that
 * ISN'T a like-for-like. The reframe: the cheap lone trader has nothing at stake,
 * so the price gap is really an accountability gap. The header carries the
 * contrast; the three cards are the accountabilities we're genuinely on the hook
 * for that a cheap quote can't match.
 */

const PUNCHLINE = "With us, it's not a gamble.";

const ACCOUNTABILITIES: Accountability[] = [
  {
    icon: RotateCcw,
    title: 'We come back free',
    sub: 'Not right? We return and fix it — guaranteed, in writing.',
  },
  {
    axa: true,
    title: "You're covered for £2M",
    sub: 'Any damage is on us, underwritten by AXA — never your bill.',
  },
  {
    icon: Wallet,
    title: "You pay when it's done",
    sub: "Balance only when you're happy — we don't get paid until you are.",
  },
];

export function WhyNotCheaperSection({ vertical }: { vertical?: string } = {}) {
  const title = verticalConfig(vertical).copy.cheapGamble;
  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-slate-900 leading-[1.1] tracking-tight max-w-2xl mx-auto">
          {title}
        </h2>
      </div>

      <div className="grid md:grid-cols-3 gap-3 md:gap-4 max-w-3xl mx-auto">
        {ACCOUNTABILITIES.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="rounded-2xl border-2 border-[#7DB00E]/60 bg-white p-5 text-center shadow-lg shadow-[#7DB00E]/10"
            >
              <div className="w-12 h-12 rounded-full bg-[#7DB00E]/10 text-[#5a8a00] flex items-center justify-center mx-auto mb-3">
                {item.axa ? (
                  <AxaLogo className="w-7 h-7 rounded-[3px]" title="Underwritten by AXA" />
                ) : (
                  Icon && <Icon className="w-6 h-6" strokeWidth={2.4} />
                )}
              </div>
              <div className="font-bold text-slate-900 text-[16px]">{item.title}</div>
              <div className="text-slate-600 text-[13.5px] mt-1.5 leading-snug">{item.sub}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl bg-[#0b2a52] text-white text-center font-bold text-[15px] md:text-base py-3.5 px-4 max-w-3xl mx-auto">
        {PUNCHLINE}
      </div>
    </div>
  );
}
