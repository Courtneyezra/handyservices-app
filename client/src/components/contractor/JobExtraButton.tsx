/**
 * P15 part 3: "Customer wants something extra", in the job drawer.
 *
 * The contractor describes what he found and photographs it. He never types a price and is never
 * shown one back, because a number he can see at the door is a number he can say out loud. The
 * office prices it through Route A and messages the customer; his job here is the report and the
 * word "wait".
 *
 * Its own file with a one-line mount, so the three P15 panes never edit the same drawer block.
 */
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Check, Plus, X } from 'lucide-react';

interface Props {
    token: string;
    bookingId: string;
    /** Hidden entirely on a read-only preview (the owner's My Week preview). */
    readOnly?: boolean;
}

type Phase = 'closed' | 'form' | 'sending' | 'done';

export function JobExtraButton({ token, bookingId, readOnly }: Props) {
    const [phase, setPhase] = useState<Phase>('closed');
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    const [photoUrls, setPhotoUrls] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);

    if (readOnly) return null;

    const close = () => { setPhase('closed'); setTitle(''); setNotes(''); setPhotoUrls([]); setErrors([]); };

    async function addPhoto(file: File) {
        setUploading(true);
        setErrors([]);
        try {
            const dataUrl: string = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result));
                r.onerror = () => reject(new Error('Could not read that photo'));
                r.readAsDataURL(file);
            });
            const res = await fetch(`/api/contractor-app/${token}/jobs/${bookingId}/photo`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.url) throw new Error(json?.error || 'Upload failed');
            setPhotoUrls((p) => [...p, json.url].slice(0, 4));
        } catch (e: any) {
            setErrors([e?.message || 'Could not add that photo']);
        } finally {
            setUploading(false);
        }
    }

    async function send() {
        setPhase('sending');
        setErrors([]);
        try {
            const res = await fetch(`/api/contractor-app/${token}/jobs/${bookingId}/variation`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim(), notes: notes.trim() || null, photoUrls }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErrors(Array.isArray(json?.errors) ? json.errors : [json?.error || 'Could not send that to the office']);
                setPhase('form');
                return;
            }
            setPhase('done');
        } catch {
            setErrors(['Could not reach the office. Try again in a moment.']);
            setPhase('form');
        }
    }

    return (
        <>
            <button
                onClick={() => setPhase('form')}
                data-testid="extra-open"
                className="w-full py-3 rounded-2xl bg-slate-800 border border-slate-700 text-slate-200 font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
            >
                <Plus size={16} /> Customer wants something extra
            </button>

            <AnimatePresence>
                {phase !== 'closed' && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
                        onClick={close}
                    >
                        <motion.div
                            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-3xl p-5 max-h-[88vh] overflow-y-auto"
                        >
                            {phase === 'done' ? (
                                <div className="text-center py-4">
                                    <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
                                        <Check size={22} className="text-emerald-400" strokeWidth={3} />
                                    </div>
                                    <div className="text-base font-bold text-slate-100">Sent to the office</div>
                                    <p className="mt-2 text-sm text-slate-400 leading-snug">
                                        They will price it and message the customer. Do not start it until she says yes.
                                    </p>
                                    <button onClick={close} className="mt-5 w-full py-3 rounded-2xl bg-slate-800 border border-slate-700 text-slate-200 font-bold">
                                        Close
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-start justify-between gap-3 mb-4">
                                        <div>
                                            <div className="text-base font-bold text-slate-100">Something extra</div>
                                            <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                                                Describe it and photograph it. The office prices it and asks her. Never quote a price yourself.
                                            </p>
                                        </div>
                                        <button onClick={close} aria-label="Close" className="shrink-0 p-1.5 rounded-lg bg-slate-800 text-slate-400"><X size={16} /></button>
                                    </div>

                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">What is it</label>
                                    <input
                                        value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
                                        data-testid="extra-title"
                                        placeholder="Second window kit"
                                        className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-600"
                                    />

                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-3 mb-1.5">What you can see</label>
                                    <textarea
                                        value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={800} rows={3}
                                        data-testid="extra-notes"
                                        placeholder="Same as the one on the quote, front bedroom, sill is sound"
                                        className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-600 resize-none"
                                    />

                                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                                        {photoUrls.map((u) => (
                                            <img key={u} src={u} alt="" className="w-16 h-16 rounded-xl object-cover border border-slate-700" />
                                        ))}
                                        {photoUrls.length < 4 && (
                                            <button
                                                onClick={() => fileRef.current?.click()} disabled={uploading}
                                                className="w-16 h-16 rounded-xl bg-slate-800 border border-dashed border-slate-600 flex items-center justify-center text-slate-400"
                                                aria-label="Add a photo"
                                            >
                                                <Camera size={18} />
                                            </button>
                                        )}
                                        <input
                                            ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(f); e.currentTarget.value = ''; }}
                                        />
                                    </div>
                                    {uploading && <div className="mt-2 text-[11px] text-slate-500">Adding the photo…</div>}

                                    {errors.length > 0 && (
                                        <div className="mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30">
                                            {errors.map((e) => <div key={e} className="text-[11px] text-rose-300 leading-snug">{e}</div>)}
                                        </div>
                                    )}

                                    <button
                                        onClick={() => void send()}
                                        disabled={phase === 'sending' || uploading || title.trim().length < 3}
                                        data-testid="extra-send"
                                        className="mt-5 w-full py-3.5 rounded-2xl bg-amber-500 text-slate-950 font-bold disabled:opacity-40 active:scale-[0.99] transition-transform"
                                    >
                                        {phase === 'sending' ? 'Sending…' : 'Send to the office'}
                                    </button>
                                </>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}

export default JobExtraButton;
