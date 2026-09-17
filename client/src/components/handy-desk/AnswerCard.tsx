/**
 * Handy Desk T2 - the answer surface's top half for one ask: "You said · typed|voice|tap" and the
 * quote, then the reply card. While the run is going the reply card is the thinking state: the
 * run's steps as they stream (tool name in mono, earlier steps green, the newest amber). Once the
 * answer lands it shows the reply line, with the steps folded behind a toggle, and hands the answer
 * to AnswerSurfaceBody (T3, ./AnswerSurface.tsx): the typed surface, what goes out when Ben
 * confirms, the confirm and its done state. This is the Handy Desk's one answer card.
 */
import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { thinkingLines, type AskExchange } from '@/lib/handy-desk-ask';
import { AnswerSurfaceBody } from './AnswerSurface';

const EYEBROW = 'text-[10px] font-bold uppercase tracking-[0.1em]';

function Steps({ exchange }: { exchange: AskExchange }) {
    const lines = thinkingLines(exchange.steps, exchange.live);
    if (lines.length === 0) {
        return exchange.live ? <p className="text-[13px] text-slate-500">Thinking…</p> : null;
    }
    return (
        <ol data-testid="handy-desk-steps" className="space-y-1.5">
            {lines.map((l) => (
                <li key={l.key} data-state={l.state} className="flex items-start gap-2 text-[13px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-[220ms]">
                    <span aria-hidden className="mt-0.5 shrink-0">
                        {l.state === 'current' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                            : l.state === 'failed' ? <CircleAlert className="h-3.5 w-3.5 text-amber-700" />
                                : <Check className="h-3.5 w-3.5 text-green-600" />}
                    </span>
                    <span className="min-w-0">
                        <span className={cn(l.state === 'current' ? 'font-semibold text-amber-700' : 'text-slate-700')}>{l.label}</span>
                        {l.tool && <code className="ml-2 font-mono text-[11px] text-slate-400">{l.tool}</code>}
                        {l.detail && <span className="block text-xs text-amber-700">{l.detail}</span>}
                    </span>
                </li>
            ))}
        </ol>
    );
}

export function AnswerCard({ exchange, onClose, speakerNames, onChange, onConfirmed }: {
    exchange: AskExchange;
    onClose: () => void;
    speakerNames?: Record<string, string>;
    /** "Change something": hands the sentence back to the ask bar. */
    onChange?: (text: string) => void;
    /** A confirm on the answer went through. */
    onConfirmed?: (note: string) => void;
}) {
    const [showSteps, setShowSteps] = useState(false);
    const answer = exchange.answer?.answer ?? null;
    const reply = answer?.finalText ?? exchange.answer?.content ?? null;

    return (
        <section data-testid="handy-desk-answer" aria-live="polite" className="space-y-4">
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    {exchange.ask.text && (
                        <>
                            <p className={cn(EYEBROW, 'text-slate-500')}>You said · {exchange.ask.via}</p>
                            <p data-testid="handy-desk-said" className="mt-1 text-lg font-semibold text-slate-900">&ldquo;{exchange.ask.text}&rdquo;</p>
                        </>
                    )}
                </div>
                {!exchange.live && (
                    <button type="button" onClick={onClose} aria-label="Back to the conversation" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            <div className="rounded-3xl bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.08)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-[240ms]">
                <div className="flex items-start gap-3">
                    <span aria-hidden className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-amber-400">AI</span>
                    <div className="min-w-0 flex-1">
                        {exchange.live ? (
                            <div data-testid="handy-desk-thinking" className="space-y-3">
                                <p className="text-[15px] font-semibold text-slate-900">On it…</p>
                                <Steps exchange={exchange} />
                            </div>
                        ) : exchange.failed ? (
                            <p data-testid="handy-desk-reply" className="text-[15px] font-semibold text-slate-900">The desk stopped without an answer. Try asking again.</p>
                        ) : reply === null ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        ) : (
                            <>
                                <p data-testid="handy-desk-reply" className="whitespace-pre-wrap text-[15px] font-semibold text-slate-900">{reply}</p>
                                {exchange.steps.length > 0 && (
                                    <div className="mt-3">
                                        <button type="button" onClick={() => setShowSteps((s) => !s)} aria-expanded={showSteps} className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
                                            {showSteps ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                            What the desk did
                                        </button>
                                        {showSteps && <div className="mt-2"><Steps exchange={exchange} /></div>}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {answer && exchange.answer && (
                <AnswerSurfaceBody
                    key={exchange.answer.id}
                    answer={answer}
                    answeredAt={exchange.answer.createdAt}
                    speakerNames={speakerNames}
                    onChange={onChange ? () => onChange(exchange.ask.text) : undefined}
                    onConfirmed={onConfirmed}
                />
            )}
        </section>
    );
}
