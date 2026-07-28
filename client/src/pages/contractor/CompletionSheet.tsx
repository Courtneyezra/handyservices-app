/**
 * Job completion — the field close. Three steps:
 *  1) Capture proof: photos + notes + customer signature (photo & signature required).
 *  2) On complete: invoice fires, then a prize wheel — the customer always wins a
 *     slice (rewards completing the job, NOT reviewing — kept separate for policy).
 *  3) Two QR codes — Take payment + Leave a review (the review ask is unconditional).
 */
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'framer-motion';
import { X, Camera, Check, Trash2, CreditCard, Star, Loader2, Gift, Receipt, Clock } from 'lucide-react';
import PrizeWheel from './PrizeWheel';
import { slicesForSegment, type PrizeSlice } from './prize-wheel-config';

interface Props {
  token: string;
  bookingId: string;
  customerName: string;
  payoutPence?: number | null;
  onClose: () => void;
  onCompleted: () => void;
}

const gbp = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

interface CompleteResult {
  paymentUrl: string | null;
  balanceDuePence: number;
  reviewUrl: string | null;
  segment: string | null;
}

// Downscale a captured photo to keep the upload small.
async function resizePhoto(file: File, max = 1600, quality = 0.85): Promise<string> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(src);
  }
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr; c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f172a';
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    const ctx = ref.current!.getContext('2d')!;
    const p = point(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const moveTo = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const p = point(e); ctx.lineTo(p.x, p.y); ctx.stroke();
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) onChange(ref.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current!; const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width / dpr, c.height / dpr);
    dirty.current = false; onChange(null);
  };

  return (
    <div>
      <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-white">
        <canvas
          ref={ref}
          className="w-full h-36 touch-none block"
          onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerLeave={up}
        />
        <button onClick={clear} className="absolute top-2 right-2 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded px-2 py-0.5">Clear</button>
      </div>
      <p className="text-[10px] text-slate-500 mt-1.5 text-center">Customer signs above to confirm the work is done</p>
    </div>
  );
}

export default function CompletionSheet({ token, bookingId, customerName, payoutPence, onClose, onCompleted }: Props) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CompleteResult | null>(null);
  // After complete fires: (1) an acknowledgement screen showing what just
  // happened with the money, then (2) the prize wheel, then (3) the QR screen.
  const [ackDone, setAckDone] = useState(false);
  const [prize, setPrize] = useState<PrizeSlice | null>(null);
  const [prizeDone, setPrizeDone] = useState(false);

  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true); setError('');
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await resizePhoto(file);
        const res = await fetch(`/api/contractor-app/${token}/jobs/${bookingId}/photo`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Upload failed');
        setPhotos((p) => [...p, d.url]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const canComplete = photos.length > 0 && !!signature && !busy && !uploading;

  const complete = async () => {
    if (!canComplete) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/contractor-app/${token}/jobs/${bookingId}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidenceUrls: photos, signatureDataUrl: signature, completionNotes: notes.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not complete');
      setResult({ paymentUrl: d.paymentUrl ?? null, balanceDuePence: d.balanceDuePence ?? 0, reviewUrl: d.reviewUrl ?? null, segment: d.segment ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete');
      setBusy(false);
    }
  };

  // Record the won prize so ops can honour it (best-effort — don't block the flow).
  const onWheelResult = (won: PrizeSlice) => {
    setPrize(won);
    fetch(`/api/contractor-app/${token}/jobs/${bookingId}/prize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prize: won.reveal.title }),
    }).catch(() => { /* non-blocking */ });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={result ? undefined : onClose}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-t-3xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {result && !ackDone ? (
          /* ── Step 2: complete fired — what just happened with the money ── */
          <div className="p-6 overflow-y-auto text-center">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 16, stiffness: 240 }}
              className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-4">
              <Check size={34} strokeWidth={3} className="text-white" />
            </motion.div>
            <h2 className="text-2xl font-extrabold text-white">Job complete</h2>
            <p className="text-sm text-slate-400 mt-1 mb-6">{customerName}'s job is signed off and logged.</p>

            <div className="space-y-3 text-left">
              {/* Customer receipt / balance */}
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0"><Receipt size={20} className="text-sky-400" /></div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white">Receipt sent to {customerName}</div>
                  <div className="text-xs text-slate-400">
                    {result.balanceDuePence > 0 ? `Balance ${gbp(result.balanceDuePence)} — they can pay on the spot` : 'Paid in full — nothing left to collect'}
                  </div>
                </div>
              </div>

              {/* His pay */}
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0"><Clock size={20} className="text-emerald-400" /></div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white">Your pay{payoutPence ? `: ${gbp(payoutPence)}` : ''} is queued</div>
                  <div className="text-xs text-slate-400">Released once the office checks your photos — usually same day.</div>
                </div>
              </div>
            </div>

            <button onClick={() => setAckDone(true)} className="mt-6 w-full py-3.5 rounded-2xl bg-emerald-500 text-slate-950 font-bold active:scale-[0.99] transition-transform">Continue</button>
          </div>
        ) : result && !prizeDone ? (
          /* ── Step 3: prize wheel (always wins; rewards the job, not a review) ── */
          <div className="p-6 overflow-y-auto text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-4">
              <Check size={30} strokeWidth={3} className="text-white" />
            </div>
            <h2 className="text-xl font-bold text-white">Job complete!</h2>
            <p className="text-sm text-slate-400 mt-1 mb-6">
              {prize ? `Nice one, ${customerName} 🎉` : `A little thank-you, ${customerName} — give it a spin.`}
            </p>

            {!prize ? (
              <PrizeWheel slices={slicesForSegment(result.segment)} onResult={onWheelResult} />
            ) : (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', damping: 18, stiffness: 220 }}>
                <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-400/15 flex items-center justify-center mb-4">
                  <Gift size={30} className="text-amber-400" />
                </div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-amber-400 mb-1">You won</div>
                <h3 className="text-2xl font-extrabold text-white leading-tight px-2">{prize.reveal.title}</h3>
                <p className="text-sm text-slate-400 mt-2 mb-6 px-2">{prize.reveal.message}</p>
                <p className="text-[11px] text-slate-500 mb-5">Saved against your name — just mention it next time.</p>
                <button onClick={() => setPrizeDone(true)} className="w-full py-3.5 rounded-2xl bg-emerald-500 text-slate-950 font-bold active:scale-[0.99] transition-transform">Continue</button>
              </motion.div>
            )}
          </div>
        ) : result ? (
          /* ── Step 3: paid + reviewed ── */
          <div className="p-6 overflow-y-auto text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-4">
              <Check size={30} strokeWidth={3} className="text-white" />
            </div>
            <h2 className="text-xl font-bold text-white">Job complete</h2>
            <p className="text-sm text-slate-400 mt-1 mb-6">Two more taps for {customerName} — get paid and get a review.</p>

            {result.paymentUrl && result.balanceDuePence > 0 && (
              <div className="mb-5 p-5 rounded-2xl bg-white">
                <div className="flex items-center justify-center gap-1.5 text-slate-900 font-bold text-sm mb-3"><CreditCard size={16} /> Take payment</div>
                <QRCodeSVG value={result.paymentUrl} size={168} className="mx-auto" />
                <p className="text-xs text-slate-500 mt-3">Customer scans to pay the balance now</p>
              </div>
            )}

            {result.reviewUrl && (
              <div className="mb-5 p-5 rounded-2xl bg-white">
                <div className="flex items-center justify-center gap-1.5 text-slate-900 font-bold text-sm mb-3"><Star size={16} className="fill-amber-400 text-amber-400" /> Leave a review</div>
                <QRCodeSVG value={result.reviewUrl} size={168} className="mx-auto" />
                <p className="text-xs text-slate-500 mt-3">Customer scans to review you on Google</p>
              </div>
            )}

            <button onClick={onCompleted} className="w-full py-3.5 rounded-2xl bg-emerald-500 text-slate-950 font-bold active:scale-[0.99] transition-transform">Done</button>
          </div>
        ) : (
          /* ── Step 1: capture proof ── */
          <>
            <div className="p-5 pb-3 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white">Complete job</h2>
                <p className="text-xs text-slate-400">{customerName}</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400" aria-label="Close"><X size={16} /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
              {/* Photos */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Photos of the finished work</div>
                <div className="flex flex-wrap gap-2">
                  {photos.map((url, i) => (
                    <div key={i} className="relative w-20 h-20">
                      <img src={url} alt="" className="w-20 h-20 rounded-xl object-cover border border-slate-700" />
                      <button onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-slate-300"><Trash2 size={11} /></button>
                    </div>
                  ))}
                  <label className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 cursor-pointer active:scale-95 transition-transform">
                    {uploading ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
                    <span className="text-[9px] mt-1 font-semibold">Add</span>
                    <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Notes <span className="text-slate-600 font-medium normal-case">(optional)</span></div>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything worth noting…" className="w-full p-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none" />
              </div>

              {/* Signature */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Customer sign-off</div>
                <SignaturePad onChange={setSignature} />
              </div>

              {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-xs">{error}</div>}
            </div>

            <div className="p-5 pt-3 border-t border-slate-800 shrink-0">
              <button
                onClick={complete}
                disabled={!canComplete}
                className="w-full py-3.5 rounded-2xl bg-emerald-500 text-slate-950 font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} strokeWidth={3} />}
                {busy ? 'Completing…' : 'Complete job'}
              </button>
              {!canComplete && !busy && (
                <p className="text-[10px] text-slate-500 text-center mt-2">{photos.length === 0 ? 'Add at least one photo' : !signature ? 'Get the customer to sign' : ''}</p>
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
