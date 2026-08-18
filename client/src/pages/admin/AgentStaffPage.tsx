/**
 * /admin/staff — the AI staff directory.
 *
 * Each agent rendered as a staff member: who they are, what they're allowed to do (the autonomy
 * ladder is the heart of the card), their tool belt, live workload stats, and their actual
 * standing orders (the verbatim system prompt). All content comes from the agent modules
 * themselves via /api/agents/staff — this page displays, it never describes.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Loader2, Bot, ShieldCheck, Hand, Ban, Eye, PenLine, Lock,
    ChevronDown, ChevronUp, Cpu, CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface StaffTool { name: string; blurb: string; kind: 'read' | 'write' | 'gated' }
interface StaffStat { label: string; value: number | string; tone?: 'good' | 'warn' | 'bad' | 'plain' }
interface StaffMember {
    id: string;
    name: string;
    roleTitle: string;
    mission: string;
    model: string;
    cadence: string;
    accent: 'emerald' | 'amber' | 'sky';
    autonomy: { freely: string[]; approval: string[]; never: string[] };
    tools: StaffTool[];
    stats: StaffStat[];
    statusChips: { label: string; on: boolean }[];
    system: string;
}

const ACCENT: Record<string, { block: string; chip: string; ring: string }> = {
    emerald: { block: 'bg-emerald-600', chip: 'bg-emerald-100 text-emerald-800', ring: 'border-emerald-600' },
    amber: { block: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800', ring: 'border-amber-500' },
    sky: { block: 'bg-sky-600', chip: 'bg-sky-100 text-sky-800', ring: 'border-sky-600' },
};

const TOOL_KIND: Record<StaffTool['kind'], { icon: typeof Eye; label: string; cls: string }> = {
    read: { icon: Eye, label: 'read', cls: 'bg-slate-100 text-slate-700' },
    write: { icon: PenLine, label: 'write', cls: 'bg-blue-100 text-blue-800' },
    gated: { icon: Lock, label: 'gated', cls: 'bg-purple-100 text-purple-800' },
};

const STAT_TONE: Record<string, string> = {
    good: 'text-emerald-700', warn: 'text-amber-600', bad: 'text-red-600', plain: 'text-slate-900',
};

function AutonomyColumn({ icon: Icon, title, items, tone }: {
    icon: typeof ShieldCheck; title: string; items: readonly string[]; tone: 'green' | 'amber' | 'red';
}) {
    const tones = {
        green: 'border-emerald-600 bg-emerald-50 text-emerald-900',
        amber: 'border-amber-500 bg-amber-50 text-amber-900',
        red: 'border-red-600 bg-red-50 text-red-900',
    };
    const heads = { green: 'text-emerald-800', amber: 'text-amber-800', red: 'text-red-800' };
    return (
        <div className={cn('flex-1 rounded-lg border-l-4 p-3', tones[tone])}>
            <div className={cn('mb-1.5 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide', heads[tone])}>
                <Icon className="h-3.5 w-3.5" /> {title}
            </div>
            {items.length === 0 ? (
                <p className="text-xs opacity-60">—</p>
            ) : (
                <ul className="space-y-1 text-xs leading-snug">
                    {items.map((it) => <li key={it}>• {it}</li>)}
                </ul>
            )}
        </div>
    );
}

function StaffCard({ member }: { member: StaffMember }) {
    const [showOrders, setShowOrders] = useState(false);
    const a = ACCENT[member.accent] ?? ACCENT.sky;

    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Header: bold solid block, like a staff badge. */}
            <header className={cn('flex items-center gap-4 p-5 text-white', a.block)}>
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <Bot className="h-8 w-8" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-black leading-tight">{member.name}</h2>
                    <p className="text-sm font-semibold opacity-90">{member.roleTitle}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    {member.statusChips.map((c) => (
                        <span key={c.label} className={cn(
                            'rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide',
                            c.on ? 'bg-white text-slate-900' : 'bg-black/30 text-white/80'
                        )}>
                            {c.label}
                        </span>
                    ))}
                </div>
            </header>

            <div className="space-y-4 p-5">
                <p className="text-sm leading-relaxed text-slate-700">{member.mission}</p>

                <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Cpu className="h-3.5 w-3.5" /> {member.model}</span>
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {member.cadence}</span>
                </div>

                {/* The autonomy ladder — the most important thing on the card. */}
                <div className="flex flex-col gap-2 sm:flex-row">
                    <AutonomyColumn icon={ShieldCheck} title="Does freely" items={member.autonomy.freely} tone="green" />
                    <AutonomyColumn icon={Hand} title="Needs approval" items={member.autonomy.approval} tone="amber" />
                    <AutonomyColumn icon={Ban} title="Never" items={member.autonomy.never} tone="red" />
                </div>

                {/* Tool belt */}
                <div>
                    <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Tool belt</h3>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                        {member.tools.map((t) => {
                            const k = TOOL_KIND[t.kind];
                            const Icon = k.icon;
                            return (
                                <div key={t.name} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2">
                                    <span className={cn('mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', k.cls)}>
                                        <Icon className="h-3 w-3" /> {k.label}
                                    </span>
                                    <div className="min-w-0">
                                        <code className="text-xs font-bold text-slate-900">{t.name}</code>
                                        <p className="text-[11px] leading-snug text-slate-500">{t.blurb}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Live workload */}
                {member.stats.length > 0 && (
                    <div>
                        <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Live workload</h3>
                        <div className="flex flex-wrap gap-2">
                            {member.stats.map((s) => (
                                <div key={s.label} className="min-w-[120px] flex-1 rounded-lg bg-slate-50 p-3 text-center">
                                    <div className={cn('text-2xl font-black tabular-nums', STAT_TONE[s.tone ?? 'plain'])}>{s.value}</div>
                                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Standing orders — the verbatim system prompt. */}
                <div className={cn('rounded-lg border-l-4 bg-slate-50', a.ring)}>
                    <button
                        onClick={() => setShowOrders((v) => !v)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-700 hover:text-slate-900"
                    >
                        Standing orders (verbatim system prompt)
                        {showOrders ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {showOrders && (
                        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap border-t border-slate-200 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
                            {member.system}
                        </pre>
                    )}
                </div>
            </div>
        </section>
    );
}

export default function AgentStaffPage() {
    const { data, isLoading, error } = useQuery<{ staff: StaffMember[] }>({
        queryKey: ['agent-staff'],
        queryFn: async () => {
            const res = await fetch('/api/agents/staff', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load staff directory');
            return res.json();
        },
        refetchInterval: 60_000,
    });

    if (isLoading) {
        return <div className="flex h-64 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading AI staff…
        </div>;
    }
    if (error || !data) {
        return <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Couldn't load the staff directory. {(error as Error)?.message}
        </div>;
    }

    return (
        <div className="mx-auto max-w-5xl space-y-6 p-5">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900">
                    <Bot className="h-6 w-6" /> AI Staff
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                    The agent fleet: what each one does, what it's allowed to do, and what it's carrying right now.
                    Every card is generated from the agent's own code — nothing here is hand-written copy.
                </p>
            </div>
            {data.staff.map((m) => <StaffCard key={m.id} member={m} />)}
        </div>
    );
}
