/**
 * Handy Desk T2 - the ask bar: suggestion chips, then the mic, the pill input, the dark "Ask" pill
 * and "Context · <name>". Typed asks go as `typed`, a chip as `tap`. The mic is shown as the design
 * has it but not wired: voice input is T6.
 */
import { useState, type FormEvent, type RefObject } from 'react';
import { Loader2, Mic } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AskVia } from '@shared/ops-types';
import { MAX_ASK_CHARS, suggestions } from '@/lib/handy-desk-ask';
import type { DeskSelection } from '@/lib/handy-desk-queue';

export function AskBar({ selection, ready, busy, error, disabledReason, onAsk, text, onText, inputRef }: {
    selection: DeskSelection | null;
    /** Today's session is open. */
    ready: boolean;
    busy: boolean;
    error: string | null;
    /** Why asking is not possible right now (e.g. the session could not open). */
    disabledReason: string | null;
    onAsk: (text: string, via: AskVia) => Promise<boolean>;
    text: string;
    onText: (text: string) => void;
    /** So the page can hand the focus back to the ask bar, e.g. on leaving the phone's thread sheet. */
    inputRef?: RefObject<HTMLInputElement>;
}) {
    const [submitting, setSubmitting] = useState(false);
    const blocked = !ready || busy || submitting || !!disabledReason;

    const send = async (words: string, via: AskVia) => {
        if (!words.trim() || blocked) return;
        setSubmitting(true);
        const ok = await onAsk(words, via);
        setSubmitting(false);
        if (ok && via === 'typed') onText('');
    };

    const submit = (e: FormEvent) => {
        e.preventDefault();
        void send(text, 'typed');
    };

    return (
        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-8">
            <div className="mb-3 flex flex-wrap gap-2">
                {suggestions(selection).map((s) => (
                    <button
                        key={s}
                        type="button"
                        disabled={blocked}
                        onClick={() => void send(s, 'tap')}
                        className="min-h-11 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition-colors duration-200 ease-[var(--ease-out)] hover:text-amber-600 disabled:opacity-50"
                    >
                        {s}
                    </button>
                ))}
            </div>
            <form onSubmit={submit} className="flex items-center gap-2">
                <button
                    type="button"
                    disabled
                    aria-label="Voice input (coming soon)"
                    title="Voice input is not wired yet"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-900 disabled:opacity-40"
                >
                    <Mic className="h-5 w-5" />
                </button>
                <label htmlFor="handy-desk-ask" className="sr-only">Ask the desk</label>
                <Input
                    ref={inputRef}
                    id="handy-desk-ask"
                    data-testid="handy-desk-ask-input"
                    value={text}
                    onChange={(e) => onText(e.target.value)}
                    maxLength={MAX_ASK_CHARS}
                    placeholder={selection ? `Ask about ${selection.name}, or anything` : 'Ask the desk anything'}
                    className="h-12 flex-1 rounded-full border-slate-200 bg-slate-50 px-5 text-sm"
                />
                <button
                    type="submit"
                    disabled={blocked || !text.trim()}
                    className={cn('inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white transition-colors duration-200 ease-[var(--ease-out)] hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50')}
                >
                    {(busy || submitting) && <Loader2 className="h-4 w-4 animate-spin" />}
                    Ask
                </button>
            </form>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span data-testid="handy-desk-context" className="text-slate-500">Context · {selection ? selection.name : 'nothing selected'}</span>
                {(error || disabledReason) && <span role="alert" data-testid="handy-desk-ask-error" className="text-red-600">{error || disabledReason}</span>}
            </div>
        </footer>
    );
}
