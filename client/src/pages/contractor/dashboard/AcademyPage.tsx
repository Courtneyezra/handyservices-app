import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { GraduationCap, CheckCircle2, Lock, PlayCircle, AlertTriangle, ChevronRight } from 'lucide-react';
import { fetchAcademy, type AcademyModule } from './academy-api';

function StatusBadge({ m }: { m: AcademyModule }) {
    const p = m.progress;
    if (p.current) {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                <CheckCircle2 size={14} /> Passed
            </span>
        );
    }
    if (p.status === 'passed' && !p.current) {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
                <AlertTriangle size={14} /> Re-cert due
            </span>
        );
    }
    if (p.status === 'failed') {
        return <span className="text-xs font-semibold text-rose-400">Not passed · retry</span>;
    }
    return <span className="text-xs font-semibold text-slate-400">Not started</span>;
}

export default function AcademyPage() {
    const { data, isLoading, error } = useQuery({
        queryKey: ['/api/contractor/academy'],
        queryFn: fetchAcademy,
    });

    return (
        <div className="max-w-lg mx-auto px-4 pt-6">
            <div className="flex items-center gap-3 mb-1">
                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-500">
                    <GraduationCap size={22} />
                </div>
                <h1 className="text-xl font-bold text-slate-100">Handy Academy</h1>
            </div>
            <p className="text-sm text-slate-400 mb-5">
                Complete each module and pass its quiz. Your scores count towards moving from ad-hoc to Core.
            </p>

            {data && !data.certsCurrent && (
                <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
                    <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-200">
                        You have required certification outstanding. Complete it to stay eligible for jobs.
                    </p>
                </div>
            )}

            {isLoading && <p className="text-slate-400 text-sm">Loading…</p>}
            {error && <p className="text-rose-400 text-sm">Couldn't load the academy. Pull to refresh.</p>}

            <div className="space-y-3">
                {data?.modules.map((m) => (
                    <Link key={m.id} href={`/contractor/dashboard/academy/${m.id}`}>
                        <button className="w-full text-left rounded-2xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="shrink-0 h-10 w-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-300">
                                    {m.progress.current ? (
                                        <CheckCircle2 size={20} className="text-emerald-400" />
                                    ) : m.required ? (
                                        <Lock size={18} className="text-amber-500" />
                                    ) : (
                                        <PlayCircle size={20} className="text-slate-400" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                            Module {m.order}
                                        </span>
                                        {m.required && (
                                            <span className="text-[10px] font-bold uppercase text-amber-500/90">Required</span>
                                        )}
                                    </div>
                                    <h2 className="text-base font-semibold text-slate-100 truncate">{m.title}</h2>
                                    <p className="text-xs text-slate-400 truncate">{m.subtitle}</p>
                                    <div className="mt-1.5 flex items-center gap-3">
                                        <StatusBadge m={m} />
                                        {m.progress.attempts > 0 && (
                                            <span className="text-[11px] text-slate-500">
                                                {m.progress.attempts} attempt{m.progress.attempts === 1 ? '' : 's'}
                                                {m.progress.bestScore != null && ` · best ${m.progress.bestScore}%`}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <ChevronRight size={18} className="text-slate-600 shrink-0" />
                            </div>
                        </button>
                    </Link>
                ))}
            </div>
        </div>
    );
}
