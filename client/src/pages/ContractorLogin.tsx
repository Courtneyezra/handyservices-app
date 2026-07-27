/**
 * Partner login — a single keypad. Tap your code, you're in.
 * The code alone resolves to your my-week app_token → /my-week/:token.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Delete, Check } from 'lucide-react';

interface Success { firstName: string; imageUrl: string | null; token: string; }

export default function ContractorLogin() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);

  const submit = async (pin: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/contractor/code-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Wrong code');

      const token = data.appToken as string;
      // Warm the app's data WHILE the welcome splash shows, so my-week renders
      // fully populated instead of flashing its own "Loading…".
      queryClient.prefetchQuery({
        queryKey: ['contractor-app', token],
        queryFn: () => fetch(`/api/contractor-app/${token}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      }).catch(() => {});

      setSuccess({ firstName: data.firstName ?? 'there', imageUrl: data.imageUrl ?? null, token });
      // Give the confirm + splash a beat, then hand off into the app.
      setTimeout(() => setLocation('/my-week/' + token), 1100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrong code');
      setCode('');
      setShake(true);
      setTimeout(() => setShake(false), 450);
      setBusy(false);
    }
  };

  const press = (d: string) => { if (!busy) { setError(''); setCode((c) => (c.length >= 8 ? c : c + d)); } };
  const del = () => { setError(''); setCode((c) => c.slice(0, -1)); };
  const confirm = () => { if (code.length >= 3) submit(code); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') del();
      else if (e.key === 'Enter') confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, busy]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Handy Services" className="w-16 h-16 mb-4 object-contain mx-auto" />
          <h1 className="text-2xl font-bold text-white">Partner Login</h1>
        </div>

        <div className="bg-white/[0.07] backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl p-6 min-h-[27rem] flex flex-col justify-center overflow-hidden">
          <AnimatePresence mode="wait">
          {success ? (
            /* Welcome splash — plays while the app data prefetches */
            <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center text-center py-4">
              {success.imageUrl ? (
                <motion.img
                  initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                  src={success.imageUrl} alt="" className="w-24 h-24 rounded-full object-cover border-2 border-white/20"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-slate-700 flex items-center justify-center text-3xl font-bold text-slate-200">{success.firstName.slice(0, 1).toUpperCase()}</div>
              )}
              <p className="mt-4 text-xl font-bold text-white">Welcome back, {success.firstName}</p>
              <div className="mt-4 flex items-center gap-2 text-slate-400 text-sm">
                <span className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                Loading your week…
              </div>
            </motion.div>
          ) : (
          <motion.div key="pad" exit={{ opacity: 0 }}>
          <p className="text-center text-slate-300 font-medium">Enter your code</p>

          {/* PIN dots */}
          <motion.div animate={shake ? { x: [0, -8, 8, -6, 6, 0] } : {}} transition={{ duration: 0.4 }} className="flex items-center justify-center gap-3 h-8 my-5">
            {code.length === 0 ? (
              <span className="text-slate-600 text-lg tracking-[0.4em]">••••</span>
            ) : (
              Array.from({ length: code.length }).map((_, i) => (
                <span key={i} className={`w-3.5 h-3.5 rounded-full ${error ? 'bg-red-400' : 'bg-amber-400'}`} />
              ))
            )}
          </motion.div>

          <div className="h-4 text-center mb-2">
            {error && <span className="text-red-400 text-xs">{error}</span>}
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2.5">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} onClick={() => press(d)} disabled={busy}
                className="h-16 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-95 text-2xl font-semibold text-white transition-all disabled:opacity-50">
                {d}
              </button>
            ))}
            <button onClick={del} disabled={busy} aria-label="Delete"
              className="h-16 rounded-2xl hover:bg-white/5 active:scale-95 text-slate-300 flex items-center justify-center transition-all disabled:opacity-50">
              <Delete size={24} />
            </button>
            <button onClick={() => press('0')} disabled={busy}
              className="h-16 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-95 text-2xl font-semibold text-white transition-all disabled:opacity-50">
              0
            </button>
            <button onClick={confirm} disabled={busy || code.length < 3} aria-label="Sign in"
              className="h-16 rounded-2xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-900 flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? <span className="w-5 h-5 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" /> : <Check size={26} strokeWidth={3} />}
            </button>
          </div>
          </motion.div>
          )}
          </AnimatePresence>
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">© {new Date().getFullYear()} Handy Services</p>
      </div>
    </div>
  );
}
