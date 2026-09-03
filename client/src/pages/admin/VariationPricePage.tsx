/**
 * P15 part 3: Ben's one-line price screen for an extra found at the door — /admin/price/variation/:id
 *
 * The quote price screen in one line. His words, the photos, Route A's suggestion with its band, and
 * one box: accept the number or type another, then send. Sending prices the line on the quote,
 * locks it onto the job pack, moves the contractor's pay and messages the customer with the link she
 * already has. Nothing on this page sends anything until he taps.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Suggestion {
    lineId: string; title: string; category: string;
    suggestedPence: number; bandLowPence: number; bandHighPence: number;
    checkThis: boolean; reason: string | null;
    minutes: number; materialsPence: number; materialsWithMarginPence: number; labourPence: number;
}

interface Screen {
    available: true;
    id: string;
    stage: 'to_price' | 'sent';
    contractor: { id: string; name: string | null };
    customer: { firstName: string; phone: string | null };
    jobTitle: string | null;
    title: string;
    notes: string | null;
    photoUrls: string[];
    reportedAt: string;
    suggestion: Suggestion | null;
    estimatorFailed: string | null;
    defaultPence: number | null;
    sent: { at: string; by: string | null; pricePence: number; payDeltaPence: number | null } | null;
    messagePreview: string;
    quoteUrl: string | null;
}

const pounds = (p: number) => (p % 100 === 0 ? `£${(p / 100).toLocaleString('en-GB')}` : `£${(p / 100).toFixed(2)}`);

export default function VariationPricePage() {
    const { id } = useParams<{ id: string }>();
    const qc = useQueryClient();
    const [pounds_, setPounds] = useState('');
    const [errors, setErrors] = useState<string[]>([]);

    const { data, isLoading, error } = useQuery<Screen>({
        queryKey: ['variation', id],
        queryFn: async () => {
            const res = await fetch(`/api/admin/variations/${id}`);
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error || 'Could not load the extra');
            return json;
        },
    });

    useEffect(() => {
        if (data?.defaultPence != null && pounds_ === '') setPounds((data.defaultPence / 100).toFixed(2).replace(/\.00$/, ''));
    }, [data?.defaultPence]); // eslint-disable-line react-hooks/exhaustive-deps

    const finalPence = useMemo(() => {
        const n = Number(String(pounds_).replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
    }, [pounds_]);

    const send = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/admin/variations/${id}/send`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ finalPence }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(Array.isArray(json?.errors) ? json.errors.join(' ') : (json?.error || 'Could not send the extra'));
            return json;
        },
        onSuccess: (json) => { setErrors(Array.isArray(json?.errors) ? json.errors : []); void qc.invalidateQueries({ queryKey: ['variation', id] }); },
        onError: (e: any) => setErrors([e?.message || 'Could not send the extra']),
    });

    if (isLoading) return <div className="min-h-screen bg-slate-950 text-slate-400 p-6 text-sm">Loading the extra…</div>;
    if (error || !data) return <div className="min-h-screen bg-slate-950 text-rose-300 p-6 text-sm">{(error as any)?.message || 'No such extra.'}</div>;

    const sent = data.stage === 'sent';
    const s = data.suggestion;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6 max-w-lg mx-auto">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Variation to price</div>
            <h1 className="mt-1 text-xl font-black leading-tight" data-testid="variation-title">{data.title}</h1>
            <p className="mt-1 text-xs text-slate-500">
                {data.contractor.name ?? 'A contractor'} on site
                {data.jobTitle ? ` · ${data.jobTitle}` : ''}
                {data.customer.firstName ? ` · ${data.customer.firstName}` : ''}
            </p>

            {data.notes && <p className="mt-3 p-3 rounded-2xl bg-slate-900 border border-slate-800 text-sm text-slate-300 leading-snug">{data.notes}</p>}

            {data.photoUrls.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {data.photoUrls.map((u) => <img key={u} src={u} alt="" className="w-24 h-24 rounded-xl object-cover border border-slate-800 shrink-0" />)}
                </div>
            )}

            {/* Route A's answer: measured, then priced by the engine. Advice, not the decision. */}
            <div className="mt-5 p-4 rounded-2xl bg-slate-900 border border-slate-800">
                {s ? (
                    <>
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Suggested</span>
                            <span className="text-2xl font-black text-emerald-300 tabular-nums" data-testid="variation-suggested">{pounds(s.suggestedPence)}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                            Band {pounds(s.bandLowPence)} to {pounds(s.bandHighPence)} · {s.minutes} min
                            {s.materialsWithMarginPence > 0 ? ` · materials ${pounds(s.materialsWithMarginPence)}` : ' · labour only'}
                        </div>
                        {(s.checkThis || s.reason) && (
                            <div className="mt-2 text-[11px] text-amber-300 leading-snug">⚠️ {s.reason || 'Marked check this.'}</div>
                        )}
                    </>
                ) : (
                    <div className="text-sm text-amber-300">Route A did not price this one. Set the price yourself.</div>
                )}
                {data.estimatorFailed && (
                    <div className="mt-2 text-[11px] text-amber-300 leading-snug">Priced from reference rates, the estimator failed ({data.estimatorFailed}).</div>
                )}
            </div>

            {sent ? (
                <div className="mt-5 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30" data-testid="variation-sent">
                    <div className="text-sm font-bold text-emerald-300">Sent at {pounds(data.sent!.pricePence)}</div>
                    <div className="mt-1 text-[11px] text-slate-400">
                        {new Date(data.sent!.at).toLocaleString('en-GB')} by {data.sent!.by ?? 'admin'}
                        {data.sent!.payDeltaPence ? ` · contractor +${pounds(data.sent!.payDeltaPence)}` : ''}
                    </div>
                    {data.quoteUrl && <a href={data.quoteUrl} className="mt-2 inline-block text-[11px] text-sky-400 underline">Her quote</a>}
                </div>
            ) : (
                <>
                    <label className="block mt-5 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Charge her</label>
                    <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-slate-500">£</span>
                        <input
                            value={pounds_} onChange={(e) => setPounds(e.target.value)} inputMode="decimal"
                            data-testid="variation-price"
                            className="flex-1 px-3 py-3 rounded-2xl bg-slate-900 border border-slate-700 text-2xl font-black tabular-nums text-slate-100"
                        />
                    </div>

                    <div className="mt-4 p-3 rounded-2xl bg-slate-900/60 border border-slate-800">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">She reads</div>
                        <p className="text-[13px] text-slate-300 leading-snug whitespace-pre-wrap">{data.messagePreview}</p>
                        {data.quoteUrl && <p className="mt-1.5 text-[11px] text-sky-400 break-all">{data.quoteUrl}</p>}
                    </div>

                    {errors.length > 0 && (
                        <div className="mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30">
                            {errors.map((e) => <div key={e} className="text-[11px] text-rose-300 leading-snug">{e}</div>)}
                        </div>
                    )}

                    <button
                        onClick={() => send.mutate()}
                        disabled={send.isPending || finalPence == null}
                        data-testid="variation-send"
                        className="mt-5 w-full py-4 rounded-2xl bg-emerald-500 text-slate-950 font-black text-base disabled:opacity-40 active:scale-[0.99] transition-transform"
                    >
                        {send.isPending ? 'Sending…' : `Send${finalPence != null ? ` ${pounds(finalPence)}` : ''} to ${data.customer.firstName}`}
                    </button>
                    <p className="mt-2 text-center text-[11px] text-slate-500">
                        Adds the line to her quote, locks it onto the job pack, and moves his pay.
                    </p>
                </>
            )}
        </div>
    );
}
