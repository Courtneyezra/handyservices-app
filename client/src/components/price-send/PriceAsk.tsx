/**
 * B9: voice and typed line edits on Price and Send ("tap's one-sixty-one"), through the Handy Desk's
 * ask agent and nothing else: the same session (useAskSession, POST /sessions/today), the ask posted
 * with `context.priceSlug`, and the agent's one change here, `quote.set_line`, confirmed through the
 * existing POST /api/comms-v2/ask/actions/:id/confirm. The confirm writes nothing on the server; its
 * result (the line and the figure) is handed to the page, which puts it in the line's boxes. The
 * quote only goes out when Ben presses Send. Mounted on the first mic tap or typed ask, so a screen
 * nobody speaks to opens no ask session.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { AskActionDTO } from '@shared/ops-types';
import { useAskSession } from '@/hooks/useAskSession';
import { ASK_BASE } from '@/lib/handy-desk-ask';
import { cn } from '@/lib/utils';

export interface PriceAskRequest { id: number; via: 'voice' | 'typed'; text?: string }
export interface SetLineResult { lineId: string; linePence: number; title?: string }
export type PriceAskPhase = 'listening' | 'hearing' | 'thinking' | 'answered' | 'idle';

function authHeaders(): Record<string, string> {
    try {
        const token = localStorage.getItem('adminToken');
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch { return {}; }
}

async function askAction(method: 'GET' | 'POST', path: string): Promise<{ ok: boolean; status: number; json: any }> {
    const res = await fetch(`${ASK_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() } });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

/** The spoken words, through the app's one transcription route (server/voice.ts). */
async function transcribe(blob: Blob): Promise<string> {
    const form = new FormData();
    form.append('file', blob, 'ask.webm');
    const res = await fetch('/api/transcribe', { method: 'POST', headers: authHeaders(), body: form });
    if (!res.ok) throw new Error(`Could not hear that (${res.status}).`);
    const data = await res.json();
    return String(data?.text ?? '').trim();
}

export function PriceAsk({ slug, request, stopSignal, onPhase, onApply, onClose }: {
    slug: string;
    request: PriceAskRequest;
    /** Bumped by the bar's mic while listening: stop and send what was said. */
    stopSignal: number;
    onPhase: (p: PriceAskPhase) => void;
    onApply: (result: SetLineResult) => string | null;
    onClose: () => void;
}) {
    const session = useAskSession();
    const [phase, setPhase] = useState<PriceAskPhase>('idle');
    const [said, setSaid] = useState<{ text: string; via: 'voice' | 'typed' } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [settling, setSettling] = useState(false);
    const [done, setDone] = useState<string | null>(null);
    const recorder = useRef<MediaRecorder | null>(null);
    const chunks = useRef<Blob[]>([]);

    const setP = (p: PriceAskPhase) => { setPhase(p); onPhase(p); };

    // The ask waits here until today's session is open (the first ask on a screen opens it).
    const [queued, setQueued] = useState<{ text: string; via: 'voice' | 'typed' } | null>(null);
    const sendAsk = async (text: string, via: 'voice' | 'typed') => {
        setSaid({ text, via }); setPreview(null); setDone(null); setError(null);
        if (!text) { setError('I did not catch anything. Tap the mic and try again.'); setP('answered'); return; }
        setP('thinking');
        setQueued({ text, via });
    };
    useEffect(() => {
        if (!queued) return;
        if (session.sessionError) { setQueued(null); setError(session.sessionError); setP('answered'); return; }
        if (!session.sessionId) return;
        const q = queued;
        setQueued(null);
        void session.ask(q.text, q.via, null, { priceSlug: slug }).then((ok) => {
            if (!ok) { setError('The desk could not take that ask. Try again.'); setP('answered'); }
        });
    }, [queued, session.sessionId, session.sessionError]); // eslint-disable-line react-hooks/exhaustive-deps

    // A new request: record, or ask what was typed.
    useEffect(() => {
        let cancelled = false;
        setError(null); setDone(null); setPreview(null);
        if (request.via === 'typed') { void sendAsk((request.text ?? '').trim(), 'typed'); return; }
        (async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record. Type the change instead.');
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
                const rec = new MediaRecorder(stream);
                chunks.current = [];
                rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
                rec.onstop = async () => {
                    stream.getTracks().forEach((t) => t.stop());
                    setP('hearing');
                    try { await sendAsk(await transcribe(new Blob(chunks.current, { type: 'audio/webm' })), 'voice'); }
                    catch (e: any) { setError(e?.message ?? 'Could not hear that.'); setP('answered'); }
                };
                recorder.current = rec;
                rec.start();
                setP('listening');
            } catch (e: any) {
                setError(e?.name === 'NotAllowedError' ? 'The microphone is blocked for this page. Allow it, or type the change.' : e?.message ?? 'Could not start the microphone.');
                setP('answered');
            }
        })();
        return () => { cancelled = true; };
    }, [request.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (stopSignal && recorder.current?.state === 'recording') recorder.current.stop();
    }, [stopSignal]);
    useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.stop(); }, []);

    // The answer to this ask, once its run has settled.
    const exchange = session.exchange;
    const answerRow = exchange && !exchange.live && said && exchange.ask?.text === said.text ? exchange.answer : null;
    const answer = answerRow?.answer ?? null;
    const confirm = answer?.confirm?.kind === 'quote.set_line' ? answer.confirm : null;
    useEffect(() => {
        if (phase !== 'thinking') return;
        if (exchange?.failed && said && exchange.ask?.text === said.text) { setError('The desk could not finish that. Try again.'); setP('answered'); return; }
        if (!answerRow) return;
        setP('answered');
        if (confirm) void askAction('GET', `/actions/${confirm.actionId}`).then((r) => { if (r.ok) setPreview((r.json as AskActionDTO).previewText); });
    }, [answerRow?.id, exchange?.failed]); // eslint-disable-line react-hooks/exhaustive-deps

    const settle = async (how: 'confirm' | 'cancel') => {
        if (!confirm) return;
        setSettling(true); setError(null);
        try {
            const r = await askAction('POST', `/actions/${confirm.actionId}/${how}`);
            if (!r.ok) { setError(r.json?.error ?? `That could not be ${how === 'confirm' ? 'confirmed' : 'cancelled'}.`); return; }
            if (how === 'cancel') { onClose(); return; }
            const result = (r.json?.action as AskActionDTO | undefined)?.result as SetLineResult | null;
            if (!result || typeof result.lineId !== 'string' || !Number.isInteger(result.linePence)) { setError('The change came back without a line.'); return; }
            const refused = onApply(result);
            if (refused) setError(refused); else setDone('Changed on your screen. Nothing is sent until you press Send.');
        } finally { setSettling(false); }
    };

    const busy = phase === 'listening' || phase === 'hearing' || phase === 'thinking';
    return (
        <div className="rounded-[20px] border border-amber-400 bg-white px-3.5 py-3 shadow-sm" data-testid="price-ask" data-phase={phase} aria-live="polite">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-500">You {said?.via === 'typed' || request.via === 'typed' ? 'asked' : 'said'} · {said?.via ?? request.via}</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900" data-testid="price-ask-said">
                        {phase === 'listening' ? 'Listening… tap the mic when you have said it.' : phase === 'hearing' ? 'Hearing you…' : said ? `“${said.text}”` : ''}
                    </div>
                </div>
                {!busy && (
                    <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid="price-ask-close">
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>
            {phase === 'thinking' && <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> The desk is reading the quote…</div>}
            {answer && !done && (
                <div className="mt-2 flex items-start gap-2">
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-slate-900 text-[8px] font-extrabold text-amber-400" aria-hidden>AI</span>
                    <span className="text-xs leading-relaxed text-slate-700" data-testid="price-ask-answer">{answer.finalText}</span>
                </div>
            )}
            {confirm && !done && (
                <>
                    {preview && <p className="mt-2 rounded-[14px] bg-slate-50 px-3 py-2 text-xs text-slate-700" data-testid="price-ask-preview">{preview}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" disabled={settling} onClick={() => void settle('confirm')}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-[13px] font-bold text-white disabled:opacity-50" data-testid="price-ask-confirm">
                            {settling && <Loader2 className="h-4 w-4 animate-spin" />}{confirm.label}
                        </button>
                        <button type="button" disabled={settling} onClick={() => void settle('cancel')}
                            className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-4 text-[13px] font-bold text-slate-700 disabled:opacity-50" data-testid="price-ask-cancel">
                            Not this
                        </button>
                    </div>
                </>
            )}
            {done && <p className="mt-2 text-xs font-semibold text-green-700" data-testid="price-ask-done">{done}</p>}
            {error && <p role="alert" className={cn('mt-2 text-xs font-semibold text-red-600')} data-testid="price-ask-error">{error}</p>}
        </div>
    );
}
