/**
 * P15 part 4 — the four blocks the completion sheet grew: the per-task before/after photo cards,
 * the materials claim, the customer's sign-off and the leftover report.
 *
 * They live here rather than inside CompletionSheet so the other P15 panes can add to the job
 * drawer without ever meeting this code in a merge. Pure rendering plus local input state: the
 * sheet owns the values, the gate and every network call.
 *
 * The wording is the contractor's, not the office's — "photo before you start", "is she happy?",
 * "anything left over?" — because this is read one-handed in somebody's hallway.
 */
import { Camera, Check, Loader2, Trash2, Receipt, ThumbsUp, ThumbsDown, ClipboardList } from 'lucide-react';
import type { LeftoverReport, PhotoTask, SignOff, SignOffVerdict, TaskPhotos } from '@shared/completion-gate';
import { taskPhotosMissing } from '@shared/completion-gate';

const LABEL = 'text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2';

// ---------------------------------------------------------------- photos, per pack task

function PhotoRow({
    which, urls, busy, onAdd, onRemove,
}: {
    which: 'before' | 'after';
    urls: string[];
    busy: boolean;
    onAdd: (files: FileList | null) => void;
    onRemove: (index: number) => void;
}) {
    const done = urls.length > 0;
    return (
        <div>
            <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${done ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {which === 'before' ? 'Before' : 'After'}
                </span>
                {done ? <Check size={11} className="text-emerald-400" strokeWidth={3} /> : <span className="text-[10px] text-slate-500">needed</span>}
            </div>
            <div className="flex flex-wrap gap-2">
                {urls.map((url, i) => (
                    <div key={`${url}-${i}`} className="relative w-16 h-16">
                        <img src={url} alt={`${which} photo ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-slate-700" />
                        <button
                            onClick={() => onRemove(i)}
                            aria-label={`Remove ${which} photo ${i + 1}`}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-slate-300"
                        >
                            <Trash2 size={10} />
                        </button>
                    </div>
                ))}
                <label className={`w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-transform ${done ? 'border-slate-700 text-slate-600' : 'border-amber-500/50 text-amber-400'}`}>
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                    <span className="text-[9px] mt-0.5 font-semibold">{which}</span>
                    <input
                        type="file" accept="image/*" capture="environment" multiple className="hidden"
                        aria-label={`Add ${which} photo`}
                        onChange={(e) => onAdd(e.target.files)}
                    />
                </label>
            </div>
        </div>
    );
}

export function TaskPhotoCards({
    tasks, photos, uploading, onAdd, onRemove,
}: {
    tasks: PhotoTask[];
    photos: Record<string, Partial<TaskPhotos>>;
    uploading: string | null;
    onAdd: (lineId: string, which: 'before' | 'after', files: FileList | null) => void;
    onRemove: (lineId: string, which: 'before' | 'after', index: number) => void;
}) {
    if (tasks.length === 0) return null;
    return (
        <div data-testid="completion-task-photos">
            <div className={LABEL}>Photograph each job · before and after</div>
            <div className="space-y-3">
                {tasks.map((task) => {
                    const mine = photos[task.lineId] ?? {};
                    const missing = taskPhotosMissing(mine);
                    return (
                        <div key={task.lineId} className={`p-3 rounded-2xl border ${missing.length === 0 ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-white/5 border-white/10'}`}>
                            <div className="flex items-start gap-2 mb-2.5">
                                {missing.length === 0
                                    ? <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" strokeWidth={3} />
                                    : <Camera size={14} className="text-amber-400 mt-0.5 shrink-0" />}
                                <div className="text-sm font-semibold text-white leading-snug">{task.title}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <PhotoRow
                                    which="before" urls={mine.before ?? []} busy={uploading === `${task.lineId}:before`}
                                    onAdd={(f) => onAdd(task.lineId, 'before', f)} onRemove={(i) => onRemove(task.lineId, 'before', i)}
                                />
                                <PhotoRow
                                    which="after" urls={mine.after ?? []} busy={uploading === `${task.lineId}:after`}
                                    onAdd={(f) => onAdd(task.lineId, 'after', f)} onRemove={(i) => onRemove(task.lineId, 'after', i)}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- the materials claim

export interface MaterialsDraft {
    total: string;
    receiptUrls: string[];
    note: string;
}

export function MaterialsClaimStep({
    draft, onChange, uploading, onReceipt, onRemoveReceipt, expectedPence, items,
}: {
    draft: MaterialsDraft;
    onChange: (next: MaterialsDraft) => void;
    uploading: boolean;
    onReceipt: (files: FileList | null) => void;
    onRemoveReceipt: (index: number) => void;
    expectedPence: number;
    items: Array<{ name: string; qty: number }>;
}) {
    return (
        <div data-testid="completion-materials">
            <div className={LABEL}>
                Materials you bought <span className="text-slate-600 font-medium normal-case">(only if you spent money)</span>
            </div>
            {items.length > 0 && (
                <div className="mb-2 p-3 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">On the pack</div>
                    <ul className="space-y-0.5">
                        {items.slice(0, 8).map((m, i) => (
                            <li key={i} className="text-xs text-slate-300 flex items-center justify-between gap-2">
                                <span className="truncate">{m.name}</span>
                                <span className="text-slate-500 tabular-nums shrink-0">×{m.qty}</span>
                            </li>
                        ))}
                    </ul>
                    {expectedPence > 0 && (
                        <div className="text-[11px] text-slate-500 mt-2">Allowed for: £{(expectedPence / 100).toFixed(2)}</div>
                    )}
                </div>
            )}
            <div className="flex gap-2 items-start">
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">£</span>
                    <input
                        type="text" inputMode="decimal" value={draft.total}
                        aria-label="Total spent on materials"
                        onChange={(e) => onChange({ ...draft, total: e.target.value.replace(/[^\d.]/g, '') })}
                        placeholder="0.00"
                        className="w-28 pl-6 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    {draft.receiptUrls.map((url, i) => (
                        <div key={i} className="relative w-11 h-11">
                            <img src={url} alt={`Receipt ${i + 1}`} className="w-11 h-11 rounded-lg object-cover border border-slate-700" />
                            <button onClick={() => onRemoveReceipt(i)} aria-label={`Remove receipt ${i + 1}`} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-slate-300"><Trash2 size={10} /></button>
                        </div>
                    ))}
                    <label className="w-11 h-11 rounded-lg border-2 border-dashed border-slate-700 flex items-center justify-center text-slate-500 cursor-pointer active:scale-95 transition-transform">
                        {uploading ? <Loader2 size={15} className="animate-spin" /> : <Receipt size={15} />}
                        <input type="file" accept="image/*" capture="environment" multiple className="hidden" aria-label="Add receipt photo" onChange={(e) => onReceipt(e.target.files)} />
                    </label>
                </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">Leave it blank if you bought nothing.</p>
        </div>
    );
}

// ---------------------------------------------------------------- the sign-off

export function SignOffStep({ value, onChange }: { value: SignOff; onChange: (next: SignOff) => void }) {
    const pick = (verdict: SignOffVerdict) => onChange({ ...value, verdict });
    return (
        <div data-testid="completion-signoff">
            <div className={LABEL}>Is she happy with it?</div>
            <div className="grid grid-cols-2 gap-2">
                <button
                    onClick={() => pick('happy')}
                    aria-pressed={value.verdict === 'happy'}
                    className={`py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 border transition-colors ${value.verdict === 'happy' ? 'bg-emerald-500 text-slate-950 border-emerald-400' : 'bg-white/5 text-slate-300 border-white/10'}`}
                >
                    <ThumbsUp size={16} /> Happy
                </button>
                <button
                    onClick={() => pick('not_happy')}
                    aria-pressed={value.verdict === 'not_happy'}
                    className={`py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 border transition-colors ${value.verdict === 'not_happy' ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-white/5 text-slate-300 border-white/10'}`}
                >
                    <ThumbsDown size={16} /> Not happy
                </button>
            </div>
            {value.verdict === 'not_happy' && (
                <div className="mt-2">
                    <textarea
                        value={value.reason ?? ''}
                        onChange={(e) => onChange({ ...value, reason: e.target.value })}
                        rows={2}
                        aria-label="What is not right, in her words"
                        placeholder="What is not right, in her words…"
                        className="w-full p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-sm text-white placeholder-amber-200/40 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-none"
                    />
                    <p className="text-[10px] text-amber-300/80 mt-1">The office sees this straight away. Say what she said.</p>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- the leftover report

export function LeftoverStep({ value, onChange }: { value: LeftoverReport; onChange: (next: LeftoverReport) => void }) {
    const set = (patch: Partial<LeftoverReport>) => onChange({ ...value, ...patch, nothingToReport: false });
    const nothing = value.nothingToReport === true;
    return (
        <div data-testid="completion-leftover">
            <div className={LABEL}>
                <span className="inline-flex items-center gap-1.5"><ClipboardList size={12} className="text-amber-300" /> Anything left over?</span>
            </div>
            <div className="space-y-2">
                <textarea
                    value={value.snags ?? ''} onChange={(e) => set({ snags: e.target.value })} rows={2}
                    aria-label="Snags" placeholder="Snags — anything not finished or needing a return"
                    disabled={nothing}
                    className="w-full p-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none disabled:opacity-40"
                />
                <textarea
                    value={value.extras ?? ''} onChange={(e) => set({ extras: e.target.value })} rows={2}
                    aria-label="Extras spotted" placeholder="Spotted — work she might want doing (we price it later)"
                    disabled={nothing}
                    className="w-full p-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none disabled:opacity-40"
                />
                <textarea
                    value={value.accessNotes ?? ''} onChange={(e) => set({ accessNotes: e.target.value })} rows={2}
                    aria-label="Access notes for next time" placeholder="Access for next time — parking, key safe, the dog"
                    disabled={nothing}
                    className="w-full p-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none disabled:opacity-40"
                />
                <button
                    onClick={() => onChange(nothing ? { ...value, nothingToReport: false } : { snags: '', extras: '', accessNotes: '', nothingToReport: true })}
                    aria-pressed={nothing}
                    className={`w-full py-2.5 rounded-xl text-sm font-bold border transition-colors ${nothing ? 'bg-emerald-500 text-slate-950 border-emerald-400' : 'bg-white/5 text-slate-300 border-white/10'}`}
                >
                    {nothing ? <span className="inline-flex items-center gap-1.5"><Check size={14} strokeWidth={3} /> Nothing to report</span> : 'Nothing to report'}
                </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">Access notes go on the address, so whoever comes next already knows.</p>
        </div>
    );
}
