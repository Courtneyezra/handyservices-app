/**
 * The spin-the-wheel theatre. Equal-sized wedges for looks; the winner is picked
 * by weight (see prize-wheel-config). Customer taps SPIN, the wheel decelerates
 * onto the chosen wedge, then the parent reveals the prize.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { PrizeSlice } from './prize-wheel-config';
import { pickWinner } from './prize-wheel-config';

const R = 100;                 // wheel radius in svg units
const CX = 110, CY = 110;      // centre (10px padding for the rim)

// Point on the rim, `a` degrees clockwise from the top (12 o'clock).
function rim(a: number) {
  const t = ((-90 + a) * Math.PI) / 180;
  return { x: CX + R * Math.cos(t), y: CY + R * Math.sin(t) };
}

function wedgePath(a0: number, a1: number) {
  const p0 = rim(a0), p1 = rim(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z`;
}

export default function PrizeWheel({ slices, onResult }: { slices: PrizeSlice[]; onResult: (s: PrizeSlice) => void }) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const n = slices.length;
  const span = 360 / n;

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    const win = pickWinner(slices);
    // Wedge `win` mid-angle (clockwise from top). Rotate the wheel so that mid
    // sits under the pointer at the top: bring it to 0 → rotate by -mid.
    const mid = win * span + span / 2;
    const jitter = (Math.random() - 0.5) * (span * 0.6); // land off-centre for realism
    const target = 360 * 6 + (360 - mid) - jitter;       // 6 full turns, then home
    setRotation(target);
    setTimeout(() => onResult(slices[win]), 4400);        // matches transition
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: 240, height: 240 }}>
        {/* Pointer */}
        <div className="absolute left-1/2 -translate-x-1/2 z-10" style={{ top: -2 }}>
          <div style={{ width: 0, height: 0, borderLeft: '13px solid transparent', borderRight: '13px solid transparent', borderTop: '20px solid #f8fafc', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.4))' }} />
        </div>

        <motion.svg
          width={240} height={240} viewBox="0 0 220 220"
          animate={{ rotate: rotation }}
          transition={{ duration: 4.4, ease: [0.16, 1, 0.3, 1] }}
          style={{ originX: '50%', originY: '50%' }}
        >
          {/* rim */}
          <circle cx={CX} cy={CY} r={R + 7} fill="#0f172a" stroke="#1e293b" strokeWidth={2} />
          {slices.map((s, i) => {
            const a0 = i * span, a1 = (i + 1) * span, mid = a0 + span / 2;
            const lp = rim(mid);
            // Label sits ~70% out (where the wedge is wide) and reads tangentially.
            const lr = 0.7;
            const lx = CX + (lp.x - CX) * lr, ly = CY + (lp.y - CY) * lr;
            // Flip labels on the lower half so they stay upright (not mirrored).
            const flip = mid > 90 && mid < 270;
            const rot = mid + (flip ? 180 : 0);
            const lines = s.label.split('\n');
            const fs = s.golden ? 9 : 8.3;      // smaller → fits within the wedge
            const lh = fs + 1.5;
            return (
              <g key={s.id}>
                <path d={wedgePath(a0, a1)} fill={s.color} stroke="#0f172a" strokeWidth={1.5} />
                <g transform={`translate(${lx.toFixed(2)} ${ly.toFixed(2)}) rotate(${rot.toFixed(1)})`}>
                  {lines.map((ln, j) => (
                    <text key={j} x={0} y={(j - (lines.length - 1) / 2) * lh + fs * 0.34}
                      textAnchor="middle" fontSize={fs} fontWeight={800}
                      fill={s.golden ? '#0f172a' : '#ffffff'} style={{ letterSpacing: 0.1 }}>
                      {ln}
                    </text>
                  ))}
                </g>
              </g>
            );
          })}
          {/* hub */}
          <circle cx={CX} cy={CY} r={16} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={2} />
          <circle cx={CX} cy={CY} r={5} fill="#0f172a" />
        </motion.svg>
      </div>

      <button
        onClick={spin}
        disabled={spinning}
        className="mt-6 px-10 py-3.5 rounded-2xl bg-emerald-500 text-slate-950 font-extrabold text-lg tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {spinning ? 'Spinning…' : 'SPIN'}
      </button>
    </div>
  );
}
