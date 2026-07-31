/**
 * Public reward T&Cs — linked from the prize reveal + prize email. Keeps the
 * "free"/promo claims clear and bounded (UK ASA/CAP compliance).
 */
import { STANDARD_TERMS } from "@/pages/contractor/prize-wheel-config";

export default function RewardsTermsPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <header className="border-b border-gray-800 bg-slate-900/90">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          <img src="/logo.png" alt="Handy" className="w-9 h-9 object-contain" />
          <div className="leading-tight">
            <div className="font-bold">Handy</div>
            <div className="text-xs text-gray-400">Services</div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        <h1 className="text-2xl font-bold mb-1">Reward terms &amp; conditions</h1>
        <p className="text-gray-400 text-sm mb-6">The terms for prizes won on the Handy reward wheel.</p>

        <section className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#e8b323] mb-3">The essentials</h2>
          <ul className="space-y-2.5">
            {STANDARD_TERMS.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-200">
                <span className="text-[#e8b323] shrink-0">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-gray-800/50 border border-gray-700/50 rounded-2xl p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#e8b323] mb-3">Your specific prize</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Each prize also has its own conditions and cap — shown on your prize and in your reward email
            (for example, a free job covers labour only up to a stated amount, with materials charged
            separately). Quote your reward code when you book and we'll apply it.
          </p>
        </section>

        <p className="text-xs text-gray-500 mt-6 leading-relaxed">
          Rewards have no cash value and cannot be exchanged for cash. Handy Services reserves the right to
          amend these terms or withdraw the reward wheel at any time. These terms don't affect your statutory
          rights. Handy Services · handyservices.app
        </p>
      </main>
    </div>
  );
}
