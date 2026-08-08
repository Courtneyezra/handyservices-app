/**
 * Admin: prize-wheel odds. Edit the weight of each slice per customer-type group,
 * see the live odds %, and spin a preview to test the feel. Saves to app_settings
 * (DDL-free); the invoice pay page + contractor completion wheel read it live.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save, Check } from 'lucide-react';
import PrizeWheel from '@/pages/contractor/PrizeWheel';
import {
  WHEEL_GROUPS, WHEEL_GROUP_LABELS,
  type WheelGroup, type WheelWeightOverrides, type PrizeSlice,
} from '@/pages/contractor/prize-wheel-config';

const GROUPS = Object.keys(WHEEL_GROUPS) as WheelGroup[];

export default function PrizeWheelPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ weights: WheelWeightOverrides }>({
    queryKey: ['prize-wheel-weights'],
    queryFn: () => fetch('/api/prize-wheel-weights').then((r) => r.json()),
  });

  const [weights, setWeights] = useState<WheelWeightOverrides>({});
  const [group, setGroup] = useState<WheelGroup>('homeowner');
  const [spinKey, setSpinKey] = useState(0);
  const [landed, setLanded] = useState<PrizeSlice | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Seed the editor from defaults, overlaid with any saved overrides.
  useEffect(() => {
    if (!data) return;
    const init: WheelWeightOverrides = {};
    for (const g of GROUPS) {
      init[g] = {};
      for (const s of WHEEL_GROUPS[g]) init[g]![s.id] = data.weights?.[g]?.[s.id] ?? s.weight;
    }
    setWeights(init);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/admin/prize-wheel-weights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights }),
      }).then((r) => { if (!r.ok) throw new Error('save failed'); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prize-wheel-weights'] });
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800);
    },
  });

  const slices = WHEEL_GROUPS[group];
  const gw = weights[group] || {};
  const weightOf = (s: PrizeSlice) => gw[s.id] ?? s.weight;
  const total = useMemo(() => slices.reduce((sum, s) => sum + weightOf(s), 0) || 1, [slices, gw]);

  // Slices with the edited weights, for the live preview.
  const previewSlices: PrizeSlice[] = slices.map((s) => ({ ...s, weight: weightOf(s) }));

  const setWeight = (id: string, v: number) =>
    setWeights((w) => ({ ...w, [group]: { ...(w[group] || {}), [id]: Math.max(0, Math.round(v || 0)) } }));

  const resetGroup = () =>
    setWeights((w) => ({ ...w, [group]: Object.fromEntries(WHEEL_GROUPS[group].map((s) => [s.id, s.weight])) }));

  if (isLoading) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">Prize wheel — odds</h1>
          <p className="text-slate-400 text-sm mt-1">Set how likely each prize is, per customer type. Every customer still wins a slice — these are just the weights. Saved live to the pay page and completion wheel.</p>
        </header>

        {/* group tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {GROUPS.map((g) => (
            <button key={g} onClick={() => { setGroup(g); setLanded(null); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${group === g ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
              {WHEEL_GROUP_LABELS[g]}
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* editor */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Slices &amp; odds</h2>
              <button onClick={resetGroup} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
                <RotateCcw size={13} /> Reset to defaults
              </button>
            </div>
            <div className="space-y-2.5">
              {slices.map((s) => {
                const w = weightOf(s);
                const pct = (w / total) * 100;
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-100 truncate">{s.reveal.title}{s.golden ? ' 🌟' : ''}</div>
                      <div className="h-1.5 mt-1 rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                      </div>
                    </div>
                    <input type="number" min={0} value={w} onChange={(e) => setWeight(s.id, Number(e.target.value))}
                      className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                    <span className="w-12 text-right text-sm tabular-nums text-emerald-400 font-semibold">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-3">
              <button onClick={() => save.mutate()} disabled={save.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold disabled:opacity-50">
                {save.isPending ? <Loader2 size={16} className="animate-spin" /> : savedFlash ? <Check size={16} /> : <Save size={16} />}
                {savedFlash ? 'Saved' : 'Save odds'}
              </button>
              <span className="text-xs text-slate-500">Applies to all three groups.</span>
            </div>
          </div>

          {/* live preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center">
            <h2 className="font-semibold self-start mb-4">Preview — {WHEEL_GROUP_LABELS[group]}</h2>
            <PrizeWheel key={spinKey} slices={previewSlices} onResult={(s) => setLanded(s)} />
            <div className="mt-4 h-10 text-center">
              {landed ? (
                <div className="text-sm"><span className="text-slate-400">Landed on</span> <span className="font-bold text-amber-400">{landed.reveal.title}</span></div>
              ) : (
                <div className="text-xs text-slate-500">Spin to test the weighting</div>
              )}
            </div>
            <button onClick={() => { setLanded(null); setSpinKey((k) => k + 1); }}
              className="mt-1 text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5">
              <RotateCcw size={12} /> Reset wheel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
