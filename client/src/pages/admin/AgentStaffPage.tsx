/**
 * /admin/staff — the AI staff directory.
 *
 * Roster view: a grid of compact staff badges — who's on shift, their live status switches,
 * and whatever they're carrying right now (warn/bad stats surface on the badge itself, so the
 * grid doubles as a "what needs Ben" board). Clicking a badge opens the full dossier in a
 * slide-over: mission, the autonomy ladder, tool belt, all stats, and the agent's actual
 * standing orders (the verbatim system prompt). All content comes from the agent modules
 * themselves via /api/agents/staff — this page displays, it never describes.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Loader2, Bot, ShieldCheck, Hand, Ban, Eye, PenLine, Lock,
    ChevronDown, ChevronUp, Cpu, CalendarClock, MessageSquare, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import AgentOutcomesPanel from '@/components/AgentOutcomesPanel';

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

/** Stats the badge leads with: anything warn/bad first (the agent is carrying something), max two. */
function headlineStats(stats: StaffStat[]): StaffStat[] {
    const hot = stats.filter((s) => s.tone === 'warn' || s.tone === 'bad');
    return [...hot, ...stats.filter((s) => !hot.includes(s))].slice(0, 2);
}

function StaffBadge({ member, onOpen }: { member: StaffMember; onOpen: () => void }) {
    const a = ACCENT[member.accent] ?? ACCENT.sky;
    const carrying = member.stats.some((s) => s.tone === 'warn' || s.tone === 'bad');
    const headline = headlineStats(member.stats);

    return (
        <button
            onClick={onOpen}
            className={cn(
                'group flex flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition',
                'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900',
                carrying ? 'border-amber-400 ring-2 ring-amber-400/60' : 'border-slate-200'
            )}
        >
            {/* ID-card header: solid accent block. */}
            <div className={cn('relative flex items-center gap-3 p-4 text-white', a.block)}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <Bot className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                    <div className="text-lg font-black leading-tight">{member.name}</div>
                    <div className="truncate text-xs font-semibold opacity-90">{member.roleTitle}</div>
                </div>
                {carrying && (
                    <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-white/70" />
                )}
            </div>

            <div className="flex flex-1 flex-col gap-3 p-4">
                {/* Live switches */}
                <div className="flex flex-wrap gap-1.5">
                    {member.statusChips.map((c) => (
                        <span key={c.label} className={cn(
                            'rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide',
                            c.on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                        )}>
                            {c.label}
                        </span>
                    ))}
                </div>

                {/* What it's carrying right now */}
                {headline.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                        {headline.map((s) => (
                            <div key={s.label} className="rounded-lg bg-slate-50 p-2.5 text-center">
                                <div className={cn('text-xl font-black tabular-nums', STAT_TONE[s.tone ?? 'plain'])}>{s.value}</div>
                                <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="inline-flex min-w-0 items-center gap-1"><Cpu className="h-3 w-3 shrink-0" /> <span className="truncate">{member.model}</span></span>
                    <span className="shrink-0 font-bold uppercase tracking-wide text-slate-400 group-hover:text-slate-600">Dossier →</span>
                </div>
            </div>
        </button>
    );
}

function AutonomyBlock({ icon: Icon, title, items, tone }: {
    icon: typeof ShieldCheck; title: string; items: readonly string[]; tone: 'green' | 'amber' | 'red';
}) {
    const tones = {
        green: 'border-emerald-600 bg-emerald-50 text-emerald-900',
        amber: 'border-amber-500 bg-amber-50 text-amber-900',
        red: 'border-red-600 bg-red-50 text-red-900',
    };
    const heads = { green: 'text-emerald-800', amber: 'text-amber-800', red: 'text-red-800' };
    return (
        <div className={cn('rounded-lg border-l-4 p-3', tones[tone])}>
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

/** The full dossier, rendered inside the slide-over. */
function StaffDossier({ member }: { member: StaffMember }) {
    const [showOrders, setShowOrders] = useState(false);
    const a = ACCENT[member.accent] ?? ACCENT.sky;

    return (
        <div className="flex h-full flex-col">
            <header className={cn('flex items-center gap-4 p-5 pr-12 text-white', a.block)}>
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <Bot className="h-8 w-8" />
                </div>
                <div className="min-w-0 flex-1">
                    <SheetTitle className="text-xl font-black leading-tight text-white">{member.name}</SheetTitle>
                    <SheetDescription className="text-sm font-semibold text-white/90">{member.roleTitle}</SheetDescription>
                </div>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
                <div className="flex flex-wrap gap-1.5">
                    {member.statusChips.map((c) => (
                        <span key={c.label} className={cn(
                            'rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide',
                            c.on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                        )}>
                            {c.label}
                        </span>
                    ))}
                </div>

                <p className="text-sm leading-relaxed text-slate-700">{member.mission}</p>

                <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Cpu className="h-3.5 w-3.5" /> {member.model}</span>
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {member.cadence}</span>
                </div>

                {/* The autonomy ladder — the most important thing in the dossier. */}
                <div className="space-y-2">
                    <AutonomyBlock icon={ShieldCheck} title="Does freely" items={member.autonomy.freely} tone="green" />
                    <AutonomyBlock icon={Hand} title="Needs approval" items={member.autonomy.approval} tone="amber" />
                    <AutonomyBlock icon={Ban} title="Never" items={member.autonomy.never} tone="red" />
                </div>

                {/* Live workload */}
                {member.stats.length > 0 && (
                    <div>
                        <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Live workload</h3>
                        <div className="grid grid-cols-2 gap-2">
                            {member.stats.map((s) => (
                                <div key={s.label} className="rounded-lg bg-slate-50 p-3 text-center">
                                    <div className={cn('text-2xl font-black tabular-nums', STAT_TONE[s.tone ?? 'plain'])}>{s.value}</div>
                                    <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Tool belt */}
                <div>
                    <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Tool belt</h3>
                    <div className="grid gap-1.5">
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
        </div>
    );
}

interface CachedTemplate {
    contentSid: string;
    name: string;
    status: string;
    category: string | null;
    body: string | null;
    rejectionReason: string | null;
    lastCheckedAt: string | null;
    approvedAt: string | null;
}

const TEMPLATE_STATUS_STYLE: Record<string, string> = {
    approved: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    received: 'bg-amber-100 text-amber-700',
    rejected: 'bg-red-100 text-red-700',
    unsubmitted: 'bg-slate-100 text-slate-500',
};

/**
 * WhatsApp template approval status.
 *
 * Meta approves templates hours-to-days after submission and Twilio pushes NOTHING when it does,
 * so this used to be invisible until someone went digging. The hourly poll writes the cache and
 * alerts on movement; this panel is the "where does everything stand" view, and the Refresh
 * button forces a poll for when you have just submitted something.
 */
function TemplateStatusPanel() {
    const queryClient = useQueryClient();
    const [syncing, setSyncing] = useState(false);

    const { data, isLoading } = useQuery<{ templates: CachedTemplate[]; counts: Record<string, number>; lastCheckedAt: string | null }>({
        queryKey: ['whatsapp-templates'],
        queryFn: async () => {
            const res = await fetch('/api/whatsapp-templates', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load templates');
            return res.json();
        },
        refetchInterval: 5 * 60_000,
    });

    const sync = async () => {
        setSyncing(true);
        try {
            await fetch('/api/whatsapp-templates/sync', { method: 'POST', headers: getAuthHeaders() });
            await queryClient.invalidateQueries({ queryKey: ['whatsapp-templates'] });
        } finally {
            setSyncing(false);
        }
    };

    const templates = data?.templates ?? [];
    const counts = data?.counts ?? {};

    return (
        <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">
                        <MessageSquare className="h-4 w-4" /> WhatsApp templates
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                        Only approved templates can reach someone outside the 24 hour window. Meta sends no notification
                        when it decides, so this is polled hourly and alerts on Pushover when one moves.
                        {data?.lastCheckedAt && ` Last checked ${new Date(data.lastCheckedAt).toLocaleString('en-GB')}.`}
                    </p>
                </div>
                <button
                    onClick={sync}
                    disabled={syncing}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} /> Check now
                </button>
            </div>

            <div className="flex gap-3 border-b border-slate-100 px-4 py-2 text-xs">
                {['approved', 'pending', 'rejected'].map((s) => (
                    <span key={s} className="text-slate-500">
                        <strong className="text-slate-900">{(counts[s] ?? 0) + (s === 'pending' ? (counts.received ?? 0) : 0)}</strong> {s}
                    </span>
                ))}
            </div>

            {isLoading ? (
                <p className="p-4 text-xs text-slate-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading…</p>
            ) : templates.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">Nothing cached yet. Hit "Check now" to poll Twilio.</p>
            ) : (
                <div className="divide-y divide-slate-100">
                    {templates.map((t) => (
                        <div key={t.contentSid} className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                                <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', TEMPLATE_STATUS_STYLE[t.status] ?? 'bg-slate-100 text-slate-500')}>
                                    {t.status}
                                </span>
                                <span className="text-xs font-semibold text-slate-900">{t.name}</span>
                                {t.category && <span className="text-[10px] uppercase text-slate-400">{t.category}</span>}
                            </div>
                            {t.body && <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{t.body}</p>}
                            {t.rejectionReason && (
                                <p className="mt-1 text-[11px] font-semibold text-red-600">Meta said: {t.rejectionReason}</p>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function AgentStaffPage() {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const { data, isLoading, error } = useQuery<{ staff: StaffMember[] }>({
        queryKey: ['agent-staff'],
        queryFn: async () => {
            const res = await fetch('/api/agents/staff', { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
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
    if ((error as Error)?.message === 'AUTH') {
        return <div className="m-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your admin session has expired. <a href="/admin/login" className="font-bold underline">Log in again</a> to view the staff directory.
        </div>;
    }
    if (error || !data) {
        return <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Couldn't load the staff directory. {(error as Error)?.message}
        </div>;
    }

    // Derive the open dossier from live data so drawer stats stay fresh across refetches.
    const selected = data.staff.find((m) => m.id === selectedId) ?? null;

    return (
        <div className="mx-auto max-w-6xl space-y-6 p-5">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900">
                    <Bot className="h-6 w-6" /> AI Staff
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                    The agent fleet: who's on shift and what they're carrying. Tap a badge for the full dossier —
                    every word of it is generated from the agent's own code, nothing is hand-written copy.
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.staff.map((m) => (
                    <StaffBadge key={m.id} member={m} onOpen={() => setSelectedId(m.id)} />
                ))}
            </div>

            {/* The closed loop: proposal → verdict → what the customer did. Directly under the
                roster because the badges say what each agent is carrying, and this says whether
                anyone should trust it with more. */}
            <AgentOutcomesPanel />

            <TemplateStatusPanel />

            <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
                <SheetContent side="right" className="w-full overflow-hidden p-0 sm:max-w-xl [&>button]:text-white">
                    {selected && <StaffDossier member={selected} />}
                </SheetContent>
            </Sheet>
        </div>
    );
}
