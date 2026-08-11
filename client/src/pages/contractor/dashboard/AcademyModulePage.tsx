import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useLocation, Link } from 'wouter';
import { ArrowLeft, PlayCircle, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { fetchAcademy, submitQuiz, type QuizResult } from './academy-api';

export default function AcademyModulePage() {
    const { moduleId } = useParams();
    const [, navigate] = useLocation();
    const queryClient = useQueryClient();

    const { data, isLoading } = useQuery({ queryKey: ['/api/contractor/academy'], queryFn: fetchAcademy });
    const mod = data?.modules.find((m) => m.id === moduleId);

    const [answers, setAnswers] = useState<(number | null)[]>([]);
    const [result, setResult] = useState<QuizResult | null>(null);
    const [started, setStarted] = useState(false);

    const mutation = useMutation({
        mutationFn: (a: (number | null)[]) => submitQuiz(moduleId!, a),
        onSuccess: (r) => {
            setResult(r);
            queryClient.invalidateQueries({ queryKey: ['/api/contractor/academy'] });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },
    });

    if (isLoading) return <div className="max-w-lg mx-auto px-4 pt-6 text-slate-400">Loading…</div>;
    if (!mod) return <div className="max-w-lg mx-auto px-4 pt-6 text-slate-400">Module not found.</div>;

    const total = mod.questions.length;
    const answered = answers.filter((a) => a != null).length;
    const allAnswered = answered === total && total > 0;

    function reset() {
        setAnswers([]);
        setResult(null);
        setStarted(false);
        window.scrollTo({ top: 0 });
    }

    return (
        <div className="max-w-lg mx-auto px-4 pt-4 pb-8">
            <Link href="/contractor/dashboard/academy">
                <button className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 mb-3">
                    <ArrowLeft size={16} /> Academy
                </button>
            </Link>

            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Module {mod.order}</span>
            <h1 className="text-xl font-bold text-slate-100">{mod.title}</h1>
            <p className="text-sm text-slate-400 mb-4">{mod.subtitle}</p>

            {/* Video slot (placeholder until the real video is produced) */}
            <div className="aspect-video rounded-2xl border border-slate-800 bg-slate-900 flex flex-col items-center justify-center text-slate-500 mb-5">
                {mod.videoUrl ? (
                    <video src={mod.videoUrl} controls className="w-full h-full rounded-2xl" />
                ) : (
                    <>
                        <PlayCircle size={40} className="mb-2 opacity-60" />
                        <span className="text-xs">Training video coming soon</span>
                    </>
                )}
            </div>

            {/* Result banner */}
            {result && (
                <div
                    className={`mb-5 rounded-2xl p-4 border ${
                        result.passed
                            ? 'border-emerald-500/40 bg-emerald-500/10'
                            : 'border-rose-500/40 bg-rose-500/10'
                    }`}
                >
                    <div className="flex items-center gap-2">
                        {result.passed ? (
                            <CheckCircle2 className="text-emerald-400" size={22} />
                        ) : (
                            <XCircle className="text-rose-400" size={22} />
                        )}
                        <span className={`font-bold ${result.passed ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {result.passed ? 'Passed' : 'Not passed'} · {result.score}%
                        </span>
                    </div>
                    <p className="text-sm text-slate-300 mt-1">
                        {result.correctCount}/{result.total} correct. Pass mark is {result.passThreshold}%.
                        {!result.passed && ' Review the module and try again.'}
                    </p>
                    <button
                        onClick={reset}
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-400"
                    >
                        <RotateCcw size={15} /> {result.passed ? 'Review quiz' : 'Retake quiz'}
                    </button>
                </div>
            )}

            {/* Quiz */}
            {!result && !started && (
                <button
                    onClick={() => {
                        setAnswers(new Array(total).fill(null));
                        setStarted(true);
                    }}
                    className="w-full rounded-xl bg-amber-500 text-slate-950 font-bold py-3"
                >
                    {mod.progress.status === 'passed' ? 'Retake quiz' : 'Start quiz'} · {total} questions
                </button>
            )}

            {!result && started && (
                <div className="space-y-5">
                    {mod.questions.map((q, qi) => (
                        <div key={q.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                            <p className="text-sm font-semibold text-slate-100 mb-3">
                                {qi + 1}. {q.prompt}
                            </p>
                            <div className="space-y-2">
                                {q.options.map((opt, oi) => {
                                    const selected = answers[qi] === oi;
                                    return (
                                        <button
                                            key={oi}
                                            onClick={() =>
                                                setAnswers((prev) => {
                                                    const next = [...prev];
                                                    next[qi] = oi;
                                                    return next;
                                                })
                                            }
                                            className={`w-full text-left text-sm rounded-xl border px-3 py-2.5 transition-colors ${
                                                selected
                                                    ? 'border-amber-500 bg-amber-500/15 text-amber-100'
                                                    : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-600'
                                            }`}
                                        >
                                            {opt}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    <div className="sticky bottom-20 pt-1">
                        <button
                            disabled={!allAnswered || mutation.isPending}
                            onClick={() => mutation.mutate(answers)}
                            className={`w-full rounded-xl font-bold py-3 ${
                                allAnswered && !mutation.isPending
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'bg-slate-800 text-slate-500'
                            }`}
                        >
                            {mutation.isPending
                                ? 'Submitting…'
                                : allAnswered
                                ? 'Submit answers'
                                : `Answer all questions (${answered}/${total})`}
                        </button>
                        {mutation.isError && (
                            <p className="text-rose-400 text-sm text-center mt-2">Submit failed. Try again.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
