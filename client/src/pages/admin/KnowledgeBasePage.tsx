/**
 * /admin/knowledge — the knowledge base (build plan v2, item 3.4).
 *
 * This is where Ben writes what is true about the business. It matters more than it looks: a later
 * item makes a factual answer to a customer BE the approved words of one of these entries, chosen
 * word for word, because nothing in the system can check whether a claim about the business is
 * true. So the page is built around one fact and one action.
 *
 *   THE FACT: an entry is either reviewed or it is invisible. The status is the loudest thing on
 *   every card, and an unreviewed entry says so in plain English rather than with a colour.
 *   THE ACTION: reviewing is one tap, on the card, and it records who and when.
 *
 * Four cards are QUESTIONS, not entries: the website says things the desk's rules forbid it from
 * saying, and rather than inherit the conflict we ask him to settle it. A question can never be
 * sent, and the page never lets one be reviewed as an answer.
 *
 * Phone first, one column, plain language: Ben is not a developer. No jargon on the page, no ids,
 * no status vocabulary except the two words that matter.
 */
import { useMemo, useState } from 'react';
import { Loader2, RefreshCw, Check, Pencil, Archive, HelpCircle, Plus, X, AlertTriangle, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    useKnowledgeBase, useKnowledgeBaseWrites, reviewOrder, reviewedLabel, whyNotReviewable,
    type KbEntry, type KbDraftInput,
} from '@/hooks/useKnowledgeBase';

// ---------------------------------------------------------------------------- the editor

const FIELD = 'w-full rounded-xl border-2 border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none';

function Editor({ entry, onCancel, onSave, saving, error }: {
    entry: KbEntry | null;
    onCancel: () => void;
    onSave: (draft: KbDraftInput) => void;
    saving: boolean;
    error: string | null;
}) {
    const [topic, setTopic] = useState(entry?.topic ?? '');
    const [words, setWords] = useState(entry?.approvedWords ?? '');
    const [banned, setBanned] = useState((entry?.bannedWords ?? []).join('\n'));
    const [note, setNote] = useState(entry?.benNote ?? '');
    const isQuestion = entry?.kind === 'question';
    const willUnmake = entry?.status === 'reviewed' && words.trim() !== (entry?.approvedWords ?? '').trim();

    return (
        <div className="mt-3 rounded-xl border-2 border-slate-900 bg-slate-50 p-3" data-testid="kb-editor">
            <label className="block text-[11px] font-black uppercase tracking-wide text-slate-500">The question a customer asks</label>
            <input className={cn(FIELD, 'mt-1')} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Which areas do you cover?" data-testid="kb-editor-topic" />

            {!isQuestion && (
                <>
                    <label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-slate-500">Your answer, word for word</label>
                    <p className="mb-1 text-xs text-slate-600">This is sent exactly as you type it. Write it the way you would text it.</p>
                    <textarea className={cn(FIELD, 'min-h-[120px]')} value={words} onChange={(e) => setWords(e.target.value)} data-testid="kb-editor-words" />
                    {willUnmake && (
                        <p className="mt-1 flex items-start gap-1 text-xs font-bold text-amber-800" data-testid="kb-editor-unmake">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            Changing the words takes this back off. Review it again when you are happy.
                        </p>
                    )}
                </>
            )}

            <label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-slate-500">Never say these, on this topic</label>
            <p className="mb-1 text-xs text-slate-600">One per line.</p>
            <textarea className={cn(FIELD, 'min-h-[64px] font-mono text-xs')} value={banned} onChange={(e) => setBanned(e.target.value)} data-testid="kb-editor-banned" />

            <label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-slate-500">{isQuestion ? 'The question for you' : 'A note to yourself'}</label>
            <textarea className={cn(FIELD, 'min-h-[64px]')} value={note} onChange={(e) => setNote(e.target.value)} data-testid="kb-editor-note" />

            {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700" data-testid="kb-editor-error">{error}</p>}

            <div className="mt-3 flex gap-2">
                <button
                    type="button"
                    disabled={saving || !topic.trim()}
                    onClick={() => onSave({
                        kind: entry?.kind ?? 'answer',
                        topic: topic.trim(),
                        approvedWords: isQuestion ? '' : words,
                        bannedWords: banned.split('\n').map((w) => w.trim()).filter(Boolean),
                        benNote: note.trim() || null,
                        sourceNote: entry?.sourceNote ?? null,
                    })}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"
                    data-testid="kb-editor-save"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
                </button>
                <button type="button" onClick={onCancel} className="inline-flex items-center justify-center gap-1 rounded-xl border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700" data-testid="kb-editor-cancel">
                    <X className="h-4 w-4" /> Cancel
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------- one card

export function EntryCard({ entry, now, busy, onEdit, onReview, onRetire, onUnreview, editing, editor }: {
    entry: KbEntry;
    now?: Date;
    busy: boolean;
    editing: boolean;
    editor: React.ReactNode;
    onEdit: () => void;
    onReview: () => void;
    onRetire: () => void;
    onUnreview: () => void;
}) {
    const isQuestion = entry.kind === 'question';
    const retired = entry.status === 'retired';
    const reviewed = entry.status === 'reviewed';
    const blocked = whyNotReviewable(entry);

    return (
        <div
            className={cn(
                'rounded-2xl border-2 p-3',
                retired ? 'border-slate-200 bg-slate-100 opacity-70'
                    : isQuestion ? 'border-amber-400 bg-amber-50'
                        : reviewed ? 'border-emerald-300 bg-white' : 'border-slate-300 bg-white',
            )}
            data-testid={`kb-card-${entry.id}`}
            data-status={entry.status}
            data-kind={entry.kind}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    {isQuestion && (
                        <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-900" data-testid="kb-question-chip">
                            <HelpCircle className="h-3 w-3" /> A question for you
                        </div>
                    )}
                    <h2 className="text-base font-black leading-snug text-slate-900" data-testid="kb-topic">{entry.topic}</h2>
                </div>
                {!isQuestion && !retired && (
                    <span
                        className={cn('shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide',
                            reviewed ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white')}
                        data-testid="kb-status"
                    >
                        {reviewed ? 'In use' : 'Not in use yet'}
                    </span>
                )}
                {retired && <span className="shrink-0 rounded-full bg-slate-400 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white" data-testid="kb-status">Retired</span>}
            </div>

            {isQuestion ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900" data-testid="kb-ben-note">{entry.benNote}</p>
            ) : (
                <>
                    {entry.approvedWords.trim()
                        ? <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-2.5 text-sm leading-relaxed text-slate-900" data-testid="kb-words">{entry.approvedWords}</p>
                        : <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-2.5 text-sm italic text-slate-500" data-testid="kb-words-empty">Nothing written yet.</p>}
                    {entry.benNote && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600" data-testid="kb-ben-note">{entry.benNote}</p>}
                </>
            )}

            {entry.bannedWords.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1" data-testid="kb-banned">
                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Never say</span>
                    {entry.bannedWords.map((w) => <span key={w} className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">{w}</span>)}
                </div>
            )}

            <p className="mt-2 text-[11px] font-bold text-slate-500" data-testid="kb-reviewed-label">
                {isQuestion ? 'Nothing is sent from a question.' : reviewedLabel(entry, now)}
                {reviewed && entry.reviewedBy ? ` · ${entry.reviewedBy.replace(/^human:/, '')}` : ''}
            </p>

            {editing ? editor : (
                <div className="mt-3 flex flex-wrap gap-2">
                    {!reviewed && !retired && (
                        <button
                            type="button"
                            disabled={busy || !!blocked}
                            title={blocked ?? undefined}
                            onClick={onReview}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-black text-white disabled:bg-slate-300 disabled:text-slate-600"
                            data-testid="kb-review"
                        >
                            <Check className="h-4 w-4" /> Yes, use these words
                        </button>
                    )}
                    {reviewed && (
                        <button type="button" disabled={busy} onClick={onUnreview} className="inline-flex items-center gap-1.5 rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700" data-testid="kb-unreview">
                            <Undo2 className="h-4 w-4" /> Take it back off
                        </button>
                    )}
                    <button type="button" disabled={busy} onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700" data-testid="kb-edit">
                        <Pencil className="h-4 w-4" /> {isQuestion ? 'Answer it' : 'Edit'}
                    </button>
                    {!retired && (
                        <button type="button" disabled={busy} onClick={onRetire} className="inline-flex items-center gap-1.5 rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-500" data-testid="kb-retire">
                            <Archive className="h-4 w-4" /> Retire
                        </button>
                    )}
                </div>
            )}
            {blocked && !reviewed && !retired && !editing && (
                <p className="mt-2 text-[11px] font-bold text-amber-800" data-testid="kb-blocked">{blocked}</p>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------- the page

export default function KnowledgeBasePage() {
    const { data, isLoading, error, refetch, isFetching } = useKnowledgeBase();
    const writes = useKnowledgeBaseWrites();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const entries = useMemo(() => reviewOrder(data?.entries ?? []), [data]);
    const counts = data?.counts;
    const busy = writes.create.isPending || writes.edit.isPending || writes.review.isPending || writes.retire.isPending || writes.unreview.isPending;

    const run = (p: Promise<unknown>) => { setFailure(null); p.then(() => { setEditingId(null); setCreating(false); }).catch((e: Error) => setFailure(e.message)); };

    if (isLoading) return <div className="flex h-64 items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading what you have written…</div>;
    if ((error as Error)?.message === 'AUTH') {
        return <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" data-testid="kb-auth">
            Your admin session has expired. <a href={`/admin/login?next=${encodeURIComponent('/admin/knowledge')}`} className="font-bold underline">Log in again</a>.
        </div>;
    }
    if (error || !data) return <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="kb-error">Couldn't load it. {(error as Error)?.message}</div>;

    return (
        <div className="mx-auto max-w-md md:max-w-2xl" data-testid="knowledge-base">
            <div className="flex items-start justify-between gap-2 px-1 pb-2">
                <div>
                    <h1 className="text-xl font-black text-slate-900">What we tell customers</h1>
                    <p className="mt-0.5 text-sm font-bold text-slate-600" data-testid="kb-count">
                        {counts?.reviewed ?? 0} in use · {counts?.unreviewed ?? 0} waiting for you
                    </p>
                </div>
                <button type="button" onClick={() => void refetch()} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600" aria-label="Refresh" data-testid="kb-refresh">
                    <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
                </button>
            </div>

            <p className="mx-1 mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700" data-testid="kb-explainer">
                These are the only answers about the business a customer can ever be sent, and they go out
                exactly as you write them. Nothing on this page is used until you tap <strong>Yes, use these
                words</strong>. The amber cards are questions only you can settle, and nothing is ever sent
                from one.
            </p>

            {failure && <p className="mx-1 mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700" data-testid="kb-failure">{failure}</p>}

            {creating ? (
                <div className="mb-3 rounded-2xl border-2 border-slate-900 bg-white p-3">
                    <h2 className="text-base font-black text-slate-900">A new answer</h2>
                    <Editor
                        entry={null}
                        saving={writes.create.isPending}
                        error={null}
                        onCancel={() => setCreating(false)}
                        onSave={(draft) => run(writes.create.mutateAsync(draft))}
                    />
                </div>
            ) : (
                <button type="button" onClick={() => { setCreating(true); setEditingId(null); }} className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700" data-testid="kb-new">
                    <Plus className="h-4 w-4" /> Write a new answer
                </button>
            )}

            <div className="grid gap-3" data-testid="kb-list">
                {entries.map((entry) => (
                    <EntryCard
                        key={entry.id}
                        entry={entry}
                        busy={busy}
                        editing={editingId === entry.id}
                        editor={
                            <Editor
                                entry={entry}
                                saving={writes.edit.isPending}
                                error={null}
                                onCancel={() => setEditingId(null)}
                                onSave={(draft) => run(writes.edit.mutateAsync({ id: entry.id, draft }))}
                            />
                        }
                        onEdit={() => { setEditingId(entry.id); setCreating(false); }}
                        onReview={() => run(writes.review.mutateAsync(entry.id))}
                        onRetire={() => run(writes.retire.mutateAsync(entry.id))}
                        onUnreview={() => run(writes.unreview.mutateAsync(entry.id))}
                    />
                ))}
                {entries.length === 0 && (
                    <div className="rounded-2xl border border-slate-300 bg-white p-6 text-center text-sm font-bold text-slate-600" data-testid="kb-empty">
                        Nothing written yet.
                    </div>
                )}
            </div>
        </div>
    );
}
