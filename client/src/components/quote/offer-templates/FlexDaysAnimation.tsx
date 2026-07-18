/**
 * FlexDaysAnimation — a compact, looping "how flex works" visual for the offer
 * screen: a mini week strip where two days get a red pencil-cross drawn through
 * them ("cross off days that don't work") and one turns green ("we book you
 * here"). Pure CSS keyframes, no JS timers — matches the light offer template.
 *
 * The whole cycle loops on one shared 6s clock; per-element delays are just
 * percentages of that cycle so the beats stay in sync.
 */

const DAYS = [
  { d: 'Mon', n: 20 },
  { d: 'Tue', n: 21, cross: true },
  { d: 'Wed', n: 22 },
  { d: 'Thu', n: 23, book: true },
  { d: 'Fri', n: 24, cross: true },
  { d: 'Sat', n: 25 },
];

export function FlexDaysAnimation() {
  return (
    <div className="fda-wrap">
      <style>{`
        .fda-wrap { --cyc: 6s; }
        /* Red pencil cross: draw the two strokes on, hold, fade out before loop. */
        @keyframes fda-draw {
          0%, 14%   { stroke-dashoffset: 120; opacity: 0; }
          16%       { opacity: 1; }
          30%, 84%  { stroke-dashoffset: 0; opacity: 1; }
          92%, 100% { stroke-dashoffset: 0; opacity: 0; }
        }
        .fda-x path { stroke-dasharray: 120; animation: fda-draw var(--cyc) ease-in-out infinite; }
        .fda-x .fda-p2 { animation-delay: calc(var(--cyc) * 0.05); }
        /* Green "booked" cell: fill + check fade in after the crosses, hold, reset. */
        @keyframes fda-book {
          0%, 40%   { background-color: transparent; border-color: rgba(15,23,42,0.10); }
          50%, 84%  { background-color: #7DB00E; border-color: #7DB00E; }
          92%, 100% { background-color: transparent; border-color: rgba(15,23,42,0.10); }
        }
        @keyframes fda-check {
          0%, 44%   { opacity: 0; transform: scale(0.4); }
          54%, 84%  { opacity: 1; transform: scale(1); }
          92%, 100% { opacity: 0; transform: scale(0.4); }
        }
        @keyframes fda-booktext {
          0%, 44%, 92%, 100% { color: rgba(15,23,42,0.55); }
          54%, 84%           { color: #ffffff; }
        }
        .fda-cell.fda-book-cell { animation: fda-book var(--cyc) ease-in-out infinite; }
        .fda-cell.fda-book-cell .fda-daynum, .fda-cell.fda-book-cell .fda-dayname { animation: fda-booktext var(--cyc) ease-in-out infinite; }
        .fda-check { opacity: 0; animation: fda-check var(--cyc) ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .fda-x path { animation: none; stroke-dashoffset: 0; opacity: 1; }
          .fda-cell.fda-book-cell { animation: none; background-color: #7DB00E; border-color: #7DB00E; }
          .fda-cell.fda-book-cell .fda-daynum, .fda-cell.fda-book-cell .fda-dayname { color: #fff; }
          .fda-check { opacity: 1; transform: none; animation: none; }
        }
      `}</style>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-4 sm:p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-3 text-center">
          Cross off days that don't work — we book the rest
        </p>
        <div className="grid grid-cols-6 gap-1.5">
          {DAYS.map((day) => (
            <div
              key={day.n}
              className={`fda-cell relative rounded-lg border text-center py-2 ${
                day.book ? 'fda-book-cell' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="fda-dayname text-[9px] font-semibold uppercase text-slate-400 leading-none">{day.d}</div>
              <div className="fda-daynum text-base font-bold text-slate-700 leading-tight mt-0.5">{day.n}</div>

              {day.cross && (
                <svg className="fda-x absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <path className="fda-p1" d="M14 16 Q50 44 86 88" stroke="#ef4444" strokeWidth="8" strokeLinecap="round" fill="none" />
                  <path className="fda-p2" d="M87 14 Q54 48 13 88" stroke="#ef4444" strokeWidth="8" strokeLinecap="round" fill="none" />
                </svg>
              )}
              {day.book && (
                <svg className="fda-check absolute top-1 right-1 w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
