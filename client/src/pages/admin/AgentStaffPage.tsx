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
    ChevronDown, ChevronUp, Cpu, CalendarClock, MessageSquare, RefreshCw, HeartPulse, ThumbsUp,
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

/** Phase 1: one agent's slice of Ben's verdicts (server/agent-staff.ts verdictSummaryFor). */
interface StaffVerdicts {
    days: number;
    approve: number; edit: number; reject: number;
    sampleFine: number; sampleNotFine: number;
    human: number; total: number;
    uneditedApprovalRate: number | null;
    unsafe: number;
    rejectReasons: Record<string, number>;
    editReasons: Record<string, number>;
    topRejectReason: { reason: string; n: number } | null;
    topEditReason: { reason: string; n: number } | null;
}

/** Phase 5: the spine's switches as /api/agents/staff reports them (app_settings.spine, no secrets). */
interface SpineSwitches {
    mode: 'off' | 'shadow' | 'live';
    enabled: boolean; shadow: boolean; explicitMode: string | null;
    agents: Partial<Record<string, { enabled: boolean }>>;
    asks: { enabled: boolean };
    autonomy: { enabled: boolean };
    sampler: { enabled: boolean; rate: number; min: number; max: number };
    video: { enabled: boolean; images: boolean; maxPerRun: number };
    sweepLimit: number; debounceMinutes: number; triageModel: string; city: string;
}
interface LegacySwitches { enabled: boolean; onInbound: boolean; autosend: boolean; firstContactAck: boolean; quotePrep: boolean }

/** Phase 0 heartbeat, same shape as GET /api/health/comms-worker. Every field optional: an older
 *  server answers without it and the strip simply says so. */
interface WorkerHeartbeat {
    ok?: boolean;
    ageSeconds?: number | null;
    stale?: boolean;
    at?: string | null;
    host?: string | null;
    pid?: number | null;
    version?: string | null;
    staleAfterSeconds?: number;
    error?: string;
    thisProcess?: { role: 'worker' | 'passive'; pid: number; host: string; version: string | null };
}
/** Phase 3: one (pack, intent) row of the autonomy ladder with its promotion evidence (server/spine/autonomy.ts). */
interface PackTierRow {
    packId: string;
    intent: string;
    tier: 'READ' | 'PROPOSE' | 'DRAFT' | 'SEND';
    tierSource: 'db' | 'static';
    verdicts30: number;
    uneditedPct: number | null;
    rejects30: number;
    unsafeEver: number;
    escalations14: number;
    samples30: number;
    sampleApprovalPct: number | null;
    evalFamily: 'pass' | 'fail' | 'skipped' | 'missing';
    evalCases: number;
    evalPassed: number;
    packVerdicts30: number;
    packUneditedPct: number | null;
    lastChange: { tier: string; at: string; by: string; reason: string | null } | null;
}

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
    verdicts?: StaffVerdicts | null;
    packTiers?: PackTierRow[] | null;
    /** P6: judge vs Ben on the sampled sends (verifier card only; server/verdict-stats.ts samplerAgreement). */
    sampler?: SamplerAgreement | null;
}

/** P6: how often Ben agreed with the judge on yesterday's sampled sends. */
interface SamplerAgreement {
    judged: number;
    humanReviewed: number;
    agreement: number | null;
    disagreements: { judgeFineHumanNot: number; judgeNotHumanFine: number };
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
function ageText(seconds: number | null | undefined): string {
    if (seconds == null) return 'never';
    if (seconds < 90) return `${Math.round(seconds)}s ago`;
    const m = Math.round(seconds / 60);
    if (m < 120) return `${m} min ago`;
    return `${Math.round(m / 60)}h ago`;
}

/**
 * The comms worker's dead-man heartbeat (Phase 0). Green = the one process allowed to run
 * customer-facing loops stamped the DB within the stale window; red = it did not, and every
 * sweep, tick and morning release is silently off. That silence was the 31 Aug incident.
 */
function WorkerHeartbeatStrip({ hb }: { hb: WorkerHeartbeat | null | undefined }) {
    if (!hb) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <HeartPulse className="h-4 w-4" /> Worker heartbeat not reported by this server.
            </div>
        );
    }
    const stale = hb.stale ?? !hb.ok;
    const never = hb.ageSeconds == null;
    const tone = stale ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-900';
    const staleMin = hb.staleAfterSeconds ? Math.round(hb.staleAfterSeconds / 60) : null;
    return (
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs', tone)} data-testid="worker-heartbeat">
            <span className="inline-flex items-center gap-1.5 font-black uppercase tracking-wide">
                <HeartPulse className={cn('h-4 w-4', !stale && 'animate-pulse')} />
                {stale ? (never ? 'Comms worker: no heartbeat' : 'Comms worker STALE') : 'Comms worker alive'}
            </span>
            <span>last beat <b>{ageText(hb.ageSeconds)}</b>{hb.host ? ` on ${hb.host}` : ''}{hb.version ? ` · build ${hb.version}` : ''}</span>
            {stale && staleMin != null && <span>(stale after {staleMin} min — sweeps, ticks and releases are OFF)</span>}
            {hb.error && <span className="italic">{hb.error}</span>}
            {hb.thisProcess && (
                <span className="ml-auto text-[11px] opacity-70">
                    this page is served by a <b>{hb.thisProcess.role}</b> process{hb.thisProcess.version ? ` · ${hb.thisProcess.version}` : ''}
                </span>
            )}
        </div>
    );
}

const REASON_LABEL: Record<string, string> = { fine: 'fine', tone: 'tone', wrong_move: 'wrong move', unsafe: 'unsafe', missing_info: 'missing info', unspecified: 'no reason' };

/** Ben's verdicts on this agent's drafts over the window — the promotion evidence (§4). */
function VerdictBlock({ v }: { v: StaffVerdicts }) {
    const rate = v.uneditedApprovalRate;
    const rateTone = rate == null ? 'text-slate-400' : rate >= 90 ? 'text-emerald-700' : rate >= 80 ? 'text-slate-900' : 'text-amber-600';
    const reasons = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${REASON_LABEL[k] ?? k} ×${n}`).join(', ');
    return (
        <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500">
                <ThumbsUp className="h-3.5 w-3.5" /> Ben's verdicts ({v.days}d)
            </h3>
            {v.human === 0 && v.total === 0 ? (
                <p className="text-xs text-slate-500">No verdicts yet. Approve, edit or reject a draft on /admin/comms and it lands here.</p>
            ) : (
                <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className={cn('text-xl font-black tabular-nums', rateTone)}>{rate == null ? '—' : `${rate}%`}</div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">unedited</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className="text-xl font-black tabular-nums text-emerald-700">{v.approve}</div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">approved</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className="text-xl font-black tabular-nums text-slate-900">{v.edit}</div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">edited</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className={cn('text-xl font-black tabular-nums', v.reject > 0 ? 'text-red-600' : 'text-slate-900')}>{v.reject}</div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">rejected</div>
                        </div>
                    </div>
                    <div className="space-y-0.5 text-[11px] text-slate-600">
                        {v.unsafe > 0 && <p className="font-bold text-red-700">{v.unsafe} marked unsafe — an unsafe verdict demotes the intent to DRAFT.</p>}
                        {Object.keys(v.rejectReasons).length > 0 && <p>Reject reasons: {reasons(v.rejectReasons)}</p>}
                        {Object.keys(v.editReasons).length > 0 && <p>Edit reasons: {reasons(v.editReasons)}</p>}
                        {(v.sampleFine + v.sampleNotFine) > 0 && <p>Sampled sends: {v.sampleFine} fine · {v.sampleNotFine} not fine</p>}
                        <p className="text-slate-400">Gate to SEND: ≥ 30 verdicts across the pack, ≥ 90% unedited, zero unsafe.</p>
                    </div>
                </div>
            )}
        </div>
    );
}

/** P6: the verifier's honesty number — judge vs Ben on the sampled sends (design §9: ≥ 85% before the judge counts). */
function SamplerBlock({ s }: { s: SamplerAgreement }) {
    const tone = s.agreement === null ? 'text-slate-400' : s.agreement >= 85 ? 'text-emerald-700' : 'text-amber-600';
    return (
        <div data-testid="sampler-agreement">
            <h3 className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">Judge vs Ben (30d)</h3>
            {s.judged === 0 ? (
                <p className="text-xs text-slate-500">No sampled sends judged yet. The 08:30 sampler fills this once something is at SEND.</p>
            ) : (
                <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className="text-xl font-black tabular-nums text-slate-900">{s.judged}</div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">judged</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className="text-xl font-black tabular-nums text-slate-900">{s.humanReviewed}</div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Ben reviewed</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className={cn('text-xl font-black tabular-nums', tone)}>{s.agreement === null ? '—' : `${s.agreement}%`}</div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">agreement</div>
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-600">
                        {s.disagreements.judgeFineHumanNot > 0 && <>{s.disagreements.judgeFineHumanNot} the judge passed and Ben did not. </>}
                        {s.disagreements.judgeNotHumanFine > 0 && <>{s.disagreements.judgeNotHumanFine} the judge failed and Ben passed. </>}
                        <span className="text-slate-400">The judge is advisory until agreement is ≥ 85% (scripts/_judge-agreement.ts).</span>
                    </p>
                </div>
            )}
        </div>
    );
}

/** Phase 3: the ladder — intent · tier · verdicts/30d · unedited % · unsafe · eval family · last change. P6: a person can move a row. */
function PackTiersBlock({ rows }: { rows: PackTierRow[] }) {
    const queryClient = useQueryClient();
    const packs = Array.from(new Set(rows.map((r) => r.packId)));
    const tierCls: Record<PackTierRow['tier'], string> = {
        SEND: 'bg-emerald-100 text-emerald-800', DRAFT: 'bg-amber-100 text-amber-800', PROPOSE: 'bg-sky-100 text-sky-800', READ: 'bg-slate-100 text-slate-600',
    };
    const evalCls: Record<PackTierRow['evalFamily'], string> = { pass: 'text-emerald-700', fail: 'text-red-700', skipped: 'text-slate-400', missing: 'text-slate-400' };
    const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    // P6: one row at a time — pick a direction, type the why, confirm. POST /api/spine/tiers writes
    // pack_intent_tiers + pack_tier_events as human:<you>; the server refuses SEND outside the pack
    // or on any money/date name, so the button can only ask.
    const [editing, setEditing] = useState<{ packId: string; intent: string; to: 'SEND' | 'DRAFT' } | null>(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = async () => {
        if (!editing || !reason.trim()) return;
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/spine/tiers', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ packId: editing.packId, intent: editing.intent, tier: editing.to, reason: reason.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) throw new Error((data.errors ?? [`HTTP ${res.status}`]).join('; '));
            setEditing(null); setReason('');
            await queryClient.invalidateQueries({ queryKey: ['agent-staff'] });
        } catch (e: any) {
            setError(e?.message ?? 'Could not change the tier');
        } finally {
            setBusy(false);
        }
    };
    const ladderButton = (r: PackTierRow) => {
        if (r.tier !== 'DRAFT' && r.tier !== 'SEND') return null;
        const to = r.tier === 'DRAFT' ? 'SEND' : 'DRAFT';
        const active = editing?.packId === r.packId && editing.intent === r.intent;
        return (
            <button
                type="button"
                onClick={() => { setEditing(active ? null : { packId: r.packId, intent: r.intent, to }); setReason(''); setError(null); }}
                className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                    to === 'SEND' ? 'border-emerald-600 text-emerald-700 hover:bg-emerald-50' : 'border-amber-500 text-amber-700 hover:bg-amber-50',
                    active && 'bg-slate-900 text-white hover:bg-slate-900',
                )}
                title={to === 'SEND' ? 'Promote this intent to SEND by hand (the job can still demote it)' : 'Demote this intent to DRAFT by hand'}
                data-testid={`tier-${to.toLowerCase()}-${r.intent}`}
            >
                {to === 'SEND' ? '↑ send' : '↓ draft'}
            </button>
        );
    };
    return (
        <div data-testid="pack-tiers">
            <h3 className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Autonomy ladder (earned per intent)</h3>
            <p className="mb-2 text-[11px] text-slate-500">
                SEND is earned: eval family pass³, ≥ 30 pack verdicts in 30d at ≥ 90% unedited, zero unsafe ever, zero escalations in 14d.
                ask_gap / confirm_received fast-track after 14 days, 20 verdicts, 0 rejects. Any unsafe, incident or sampled approval under 80% drops it back to DRAFT.
                A person can move a row with the buttons; every move is logged with your name and a reason.
            </p>
            {editing && (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 p-2 text-xs" data-testid="tier-reason">
                    <span className="font-bold text-slate-800">{editing.intent} → {editing.to}</span>
                    <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setEditing(null); }}
                        placeholder="Why? (required, goes on the event log)"
                        className="min-w-[14rem] flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                        maxLength={1000}
                    />
                    <button type="button" disabled={busy || !reason.trim()} onClick={() => void submit()} className="rounded bg-slate-900 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white disabled:opacity-40">
                        {busy ? 'Saving…' : 'Confirm'}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cancel</button>
                    {error && <span className="w-full text-red-700">{error}</span>}
                </div>
            )}
            {packs.map((packId) => {
                const pr = rows.filter((r) => r.packId === packId);
                const head = pr[0];
                return (
                    <div key={packId} className="mb-3 overflow-x-auto rounded-lg border border-slate-200">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 bg-slate-50 px-3 py-1.5 text-[11px]">
                            <span className="font-black text-slate-800">{packId}</span>
                            <span className="text-slate-500">{head.packVerdicts30} pack verdicts / 30d · {head.packUneditedPct ?? '–'}% unedited</span>
                        </div>
                        <table className="w-full text-left text-[11px]">
                            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                                <tr>
                                    <th className="px-3 py-1">Intent</th><th className="px-2 py-1">Tier</th><th className="px-2 py-1 text-right">Verdicts/30d</th>
                                    <th className="px-2 py-1 text-right">Unedited</th><th className="px-2 py-1 text-right">Unsafe</th><th className="px-2 py-1">Eval family</th><th className="px-2 py-1">Last change</th><th className="px-2 py-1"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {pr.map((r) => (
                                    <tr key={r.intent} className="border-t border-slate-100">
                                        <td className="px-3 py-1 font-semibold text-slate-800">{r.intent}</td>
                                        <td className="px-2 py-1"><span className={cn('rounded px-1.5 py-0.5 text-[10px] font-black', tierCls[r.tier])}>{r.tier}</span>{r.tierSource === 'db' && <span className="ml-1 text-[9px] uppercase text-slate-400">earned</span>}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{r.verdicts30}{r.rejects30 > 0 && <span className="text-red-600"> ({r.rejects30} rej)</span>}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{r.uneditedPct === null ? '–' : `${r.uneditedPct}%`}</td>
                                        <td className={cn('px-2 py-1 text-right tabular-nums', r.unsafeEver > 0 && 'font-bold text-red-700')}>{r.unsafeEver}{r.escalations14 > 0 && <span className="text-amber-700"> · {r.escalations14} esc</span>}</td>
                                        <td className={cn('px-2 py-1', evalCls[r.evalFamily])}>{r.evalFamily}{r.evalCases > 0 && ` ${r.evalPassed}/${r.evalCases}`}</td>
                                        <td className="px-2 py-1 text-slate-500">{r.lastChange ? `${r.lastChange.tier} · ${when(r.lastChange.at)} · ${r.lastChange.by.replace(/^(system|human):/, '')}` : 'launch default'}</td>
                                        <td className="px-2 py-1 text-right">{ladderButton(r)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * The spine's switches in one strip (Phase 5): which mode we are in and what each flag does.
 * Flips happen on scripts/_spine-mode.ts or the app_settings row (docs/comms-build/CUTOVER.md);
 * this strip only reads.
 */
// ---------------------------------------------------------------- P6 / A2: switch controls

interface LastChange { at: string; by: string; summary: string }
interface GoLiveCheckRow { id: string; label: string; status: 'GO' | 'NO-GO' | 'WARN' | 'SKIP' | 'INFO'; detail: string }
interface GoLiveReport { at: string; ok: boolean; noGo: number; warn: number; checks: GoLiveCheckRow[] }
interface SpineControls {
    spine: SpineSwitches;
    legacy: LegacySwitches | null;
    lastChanges: Partial<Record<string, LastChange>>;
    viewer: { isOwner: boolean; email: string | null; role: string | null };
    captions: Record<'off' | 'shadow' | 'live', string>;
    confirmWord: string;
}

function whoWhen(c: LastChange | undefined): string {
    if (!c) return 'never changed here';
    const who = c.by.replace(/^(human|script|system):/, '');
    return `${who} · ${new Date(c.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

async function postJson(url: string, body: unknown): Promise<any> {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
        const err: any = new Error((data.errors ?? [data.error ?? `HTTP ${res.status}`]).join('; '));
        err.golive = data.golive ?? null;
        throw err;
    }
    return data;
}

/**
 * The spine's switches in one strip (Phase 5 read-only; P6 flippable — design §3.9 "visible and
 * flippable on /admin/staff, every flip logged"). Each chip is a toggle: optimistic, then a refetch
 * of /api/spine/controls and /api/agents/staff. Mode and autonomy and legacy autosend are
 * owner-only; going live runs the go-live check (CUTOVER §0, evals skipped for speed) and refuses
 * on any NO-GO, then asks for the word LIVE typed. "Rollback to off" is always one click.
 */
function SpineSwitchStrip({ fallbackSpine, fallbackLegacy }: { fallbackSpine: SpineSwitches | null | undefined; fallbackLegacy: LegacySwitches | null | undefined }) {
    const queryClient = useQueryClient();
    const { data, error } = useQuery<SpineControls>({
        queryKey: ['spine-controls'],
        queryFn: async () => {
            const res = await fetch('/api/spine/controls', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`controls ${res.status}`);
            return res.json();
        },
        refetchInterval: 30_000,
    });
    const [pending, setPending] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [modeOpen, setModeOpen] = useState(false);
    const [target, setTarget] = useState<'off' | 'shadow' | 'live' | null>(null);
    const [golive, setGolive] = useState<GoLiveReport | null>(null);
    const [checking, setChecking] = useState(false);
    const [typed, setTyped] = useState('');
    const [legacyConfirm, setLegacyConfirm] = useState<string | null>(null);

    const spine = data?.spine ?? fallbackSpine;
    const legacy = data?.legacy ?? fallbackLegacy;
    const last = data?.lastChanges ?? {};
    const isOwner = data?.viewer.isOwner ?? false;
    const word = data?.confirmWord ?? 'LIVE';
    if (!spine) {
        return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">Spine switches not reported by this server.{error ? ` ${(error as Error).message}` : ''}</div>;
    }

    const refetch = async () => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['spine-controls'] }), queryClient.invalidateQueries({ queryKey: ['agent-staff'] })]);
    };
    const flipSpine = async (key: string, body: Record<string, unknown>) => {
        setPending(key); setErr(null);
        try {
            await postJson('/api/spine/config', body);
            await refetch();
        } catch (e: any) {
            setErr(e?.message ?? 'Could not save');
        } finally {
            setPending(null);
        }
    };
    const flipLegacy = async (key: string, body: Record<string, unknown>) => {
        setPending(key); setErr(null);
        try {
            await postJson('/api/comms-agent/config', body);
            await refetch();
            setLegacyConfirm(null); setTyped('');
        } catch (e: any) {
            setErr(e?.message ?? 'Could not save');
        } finally {
            setPending(null);
        }
    };
    const pickMode = async (m: 'off' | 'shadow' | 'live') => {
        setTarget(m); setGolive(null); setTyped(''); setErr(null);
        if (m === 'live') {
            setChecking(true);
            try {
                const res = await fetch('/api/spine/golive-check?skipEvals=1', { headers: getAuthHeaders() });
                setGolive(await res.json());
            } catch (e: any) {
                setErr(e?.message ?? 'Go-live check failed');
            } finally {
                setChecking(false);
            }
        }
    };
    const applyMode = async () => {
        if (!target) return;
        setPending('mode'); setErr(null);
        try {
            await postJson('/api/spine/config', target === 'live' ? { mode: 'live', confirm: typed } : { mode: target });
            await refetch();
            setModeOpen(false); setTarget(null); setGolive(null); setTyped('');
        } catch (e: any) {
            setErr(e?.message ?? 'Could not change the mode');
            if (e?.golive) setGolive(e.golive);
        } finally {
            setPending(null);
        }
    };

    const modeTone = spine.mode === 'live' ? 'bg-emerald-600 text-white' : spine.mode === 'shadow' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-white';
    const modeText = spine.mode === 'live' ? 'LIVE — the spine answers customers; legacy off'
        : spine.mode === 'shadow' ? 'SHADOW — the spine runs dry and records; legacy still drafts'
        : 'OFF — legacy only';
    const toggle = (key: string, label: string, on: boolean, title: string, onClick: () => void, opts: { ownerOnly?: boolean; danger?: boolean } = {}) => {
        const locked = !!opts.ownerOnly && !isOwner;
        return (
            <button
                key={key} type="button" title={`${title}\nlast change: ${whoWhen(last[key])}${locked ? '\nowner-only' : ''}`}
                disabled={locked || pending === key}
                onClick={onClick}
                data-testid={`switch-${key}`}
                className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide transition',
                    on ? (opts.danger ? 'bg-red-600 text-white' : 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-500',
                    locked ? 'cursor-not-allowed opacity-60' : 'hover:ring-2 hover:ring-slate-400',
                    pending === key && 'animate-pulse',
                )}
            >
                {label}{locked ? ' 🔒' : ''}
            </button>
        );
    };
    const info = (label: string, title: string) => (
        <span key={label} title={title} className="rounded bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</span>
    );
    const agentToggles = Object.entries(spine.agents ?? {}).map(([k, v]) =>
        toggle(`agents.${k}`, `${k} ${v?.enabled ? 'on' : 'off'}`, !!v?.enabled, `spine.agents.${k}.enabled — per-agent kill switch`, () => flipSpine(`agents.${k}`, { agents: { [k]: { enabled: !v?.enabled } } })));
    const statusCls: Record<GoLiveCheckRow['status'], string> = { GO: 'bg-emerald-100 text-emerald-800', 'NO-GO': 'bg-red-100 text-red-800', WARN: 'bg-amber-100 text-amber-800', SKIP: 'bg-slate-100 text-slate-500', INFO: 'bg-sky-100 text-sky-800' };

    return (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="spine-switches">
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button" onClick={() => { setModeOpen((v) => !v); setTarget(null); setGolive(null); setErr(null); }}
                    disabled={!isOwner}
                    title={`spine mode · last change: ${whoWhen(last.mode)}${isOwner ? '' : ' · owner-only'}`}
                    className={cn('rounded px-2 py-1 text-[11px] font-black uppercase tracking-wide', modeTone, isOwner ? 'hover:ring-2 hover:ring-slate-400' : 'cursor-not-allowed opacity-70')}
                    data-testid="spine-mode"
                >
                    spine {spine.mode}{isOwner ? ' ▾' : ' 🔒'}
                </button>
                <span className="text-xs text-slate-600">{modeText}</span>
                <span className="text-[10px] text-slate-400">last: {whoWhen(last.mode)}</span>
                {spine.mode !== 'off' && isOwner && (
                    <button type="button" onClick={() => { setModeOpen(true); void pickMode('off'); }} disabled={pending === 'mode'}
                        className="rounded border border-red-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-red-700 hover:bg-red-50" data-testid="rollback-off">
                        Rollback to off
                    </button>
                )}
                <span className="ml-auto text-[10px] text-slate-400">every flip is logged · scripts/_spine-mode.ts still works · CUTOVER.md §2–4</span>
            </div>

            {modeOpen && isOwner && (
                <div className="space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs" data-testid="mode-picker">
                    <div className="flex flex-wrap gap-1.5">
                        {(['off', 'shadow', 'live'] as const).map((m) => (
                            <button key={m} type="button" onClick={() => void pickMode(m)}
                                className={cn('rounded px-3 py-1 text-[11px] font-black uppercase tracking-wide',
                                    target === m ? (m === 'live' ? 'bg-emerald-600 text-white' : m === 'shadow' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-white') : 'bg-white text-slate-700 ring-1 ring-slate-300')}>
                                {m}{spine.mode === m ? ' (now)' : ''}
                            </button>
                        ))}
                    </div>
                    {target && <p className="text-slate-600">{data?.captions?.[target]}</p>}
                    {target === 'live' && (
                        <div className="space-y-2">
                            {checking && <p className="text-slate-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Running the go-live check (CUTOVER §0, evals skipped)…</p>}
                            {golive && (
                                <div className="overflow-x-auto rounded border border-slate-200 bg-white" data-testid="golive-check">
                                    <table className="w-full text-left text-[11px]">
                                        <tbody>
                                            {golive.checks.map((c) => (
                                                <tr key={c.id} className="border-t border-slate-100 first:border-t-0">
                                                    <td className="px-2 py-1"><span className={cn('rounded px-1.5 py-0.5 text-[10px] font-black', statusCls[c.status])}>{c.status}</span></td>
                                                    <td className="px-2 py-1 font-semibold text-slate-800">{c.label}</td>
                                                    <td className="px-2 py-1 text-slate-600">{c.detail}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <p className={cn('px-2 py-1 text-[11px] font-bold', golive.ok ? 'text-emerald-700' : 'text-red-700')}>
                                        {golive.ok ? `No NO-GO${golive.warn ? ` (${golive.warn} warning${golive.warn === 1 ? '' : 's'})` : ''}. Type ${word} to confirm.` : `${golive.noGo} NO-GO item(s): the flip is refused until they are fixed.`}
                                    </p>
                                </div>
                            )}
                            {golive?.ok && (
                                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`type ${word}`} autoFocus
                                    className="rounded border border-slate-300 px-2 py-1 font-mono text-xs" data-testid="live-confirm" />
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <button type="button" disabled={!target || target === spine.mode || pending === 'mode' || checking || (target === 'live' && (!golive?.ok || typed !== word))}
                            onClick={() => void applyMode()}
                            className="rounded bg-slate-900 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white disabled:opacity-40" data-testid="mode-apply">
                            {pending === 'mode' ? 'Saving…' : target ? `Switch to ${target}` : 'Pick a mode'}
                        </button>
                        <button type="button" onClick={() => { setModeOpen(false); setTarget(null); setGolive(null); }} className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cancel</button>
                    </div>
                </div>
            )}

            <div className="flex flex-wrap gap-1.5">
                {info('enabled ' + (spine.enabled ? 'on' : 'off'), 'spine.enabled — master; follows the mode')}
                {info('shadow ' + (spine.shadow ? 'on' : 'off'), 'spine.shadow — follows the mode')}
                {toggle('asks', `asks ${spine.asks.enabled ? 'on' : 'off'}`, spine.asks.enabled, 'spine.asks.enabled — rules-layer media/postcode asks from the exit', () => flipSpine('asks', { asks: { enabled: !spine.asks.enabled } }))}
                {toggle('autonomy', `autonomy ${spine.autonomy.enabled ? 'on' : 'off'}`, spine.autonomy.enabled, 'spine.autonomy.enabled — the 07:30 promotion/demotion job (owner-only)', () => flipSpine('autonomy', { autonomy: { enabled: !spine.autonomy.enabled } }), { ownerOnly: true })}
                {toggle('sampler', `sampler ${spine.sampler.enabled ? `on · ${Math.round(spine.sampler.rate * 100)}%` : 'off'}`, spine.sampler.enabled, 'spine.sampler — the 08:30 sample of yesterday\'s automatic sends', () => flipSpine('sampler', { sampler: { enabled: !spine.sampler.enabled } }))}
                {toggle('video', `video ${spine.video.enabled ? `on · ${spine.video.maxPerRun}/run${spine.video.images ? ' +photos' : ''}` : 'off'}`, spine.video.enabled, 'spine.video — describe_video on the case file (Gemini)', () => flipSpine('video', { video: { enabled: !spine.video.enabled } }))}
                {agentToggles}
                <span className="text-[10px] text-slate-400">debounce {spine.debounceMinutes} min · sweep {spine.sweepLimit}/tick · triage {spine.triageModel} · {spine.city}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                {(['asks', 'autonomy', 'sampler', 'video'] as const).map((k) => <span key={k}>{k}: {whoWhen(last[k])}</span>)}
            </div>

            {legacy && (
                <div className="space-y-1 border-t border-slate-100 pt-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">legacy comms_agent</span>
                        {info(`sweep ${legacy.enabled ? 'on' : 'off'}`, 'comms_agent.enabled — the legacy SLA sweep (script-set)')}
                        {toggle('onInbound', `on inbound ${legacy.onInbound ? 'on' : 'off'}`, legacy.onInbound, 'comms_agent.onInbound — legacy drafts on new messages (off once the spine is live)', () => flipLegacy('onInbound', { onInbound: !legacy.onInbound }))}
                        {toggle('autosend', `autosend ${legacy.autosend ? 'ON' : 'off'}`, legacy.autosend, 'comms_agent.autosend.enabled — legacy direct send; OFF since the 2 Sep hotfix (owner-only; ON needs the typed word)',
                            () => (legacy.autosend ? flipLegacy('autosend', { autosend: { enabled: false } }) : setLegacyConfirm('autosend')), { ownerOnly: true, danger: true })}
                        {info(`first-contact ack ${legacy.firstContactAck ? 'on' : 'off'}`, 'comms_agent.firstContactAutoAck.enabled — on /admin/comms')}
                        {info(`auto quote-prep ${legacy.quotePrep ? 'on' : 'off'}`, 'comms_agent.quotePrep.enabled')}
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-[10px] text-slate-400">
                        <span>on inbound: {whoWhen(last.onInbound)}</span><span>autosend: {whoWhen(last.autosend)}</span>
                    </div>
                    {legacyConfirm === 'autosend' && (
                        <div className="flex flex-wrap items-center gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs" data-testid="autosend-confirm">
                            <span className="font-bold text-red-800">Turning legacy autosend ON lets the legacy agent send without Ben. Type {word} to confirm.</span>
                            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`type ${word}`} className="rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
                            <button type="button" disabled={typed !== word || pending === 'autosend'} onClick={() => void flipLegacy('autosend', { autosend: { enabled: true }, confirm: typed })}
                                className="rounded bg-red-700 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white disabled:opacity-40">Turn ON</button>
                            <button type="button" onClick={() => { setLegacyConfirm(null); setTyped(''); }} className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cancel</button>
                        </div>
                    )}
                </div>
            )}
            {err && <p className="text-xs font-semibold text-red-700" data-testid="switch-error">{err}</p>}
            {!isOwner && <p className="text-[10px] text-slate-400">🔒 mode, autonomy and legacy autosend are owner-only; asks, sampler, video and per-agent switches are yours.</p>}
        </div>
    );
}

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

                {/* Phase 1: the verdict record — what Ben did with this agent's drafts. */}
                {member.verdicts && <VerdictBlock v={member.verdicts} />}

                {/* Phase 3: the autonomy ladder — which intents have earned SEND, and the evidence. */}
                {member.packTiers && member.packTiers.length > 0 && <PackTiersBlock rows={member.packTiers} />}

                {/* P6: the verifier's honesty number — judge vs Ben on the sampled sends. */}
                {member.sampler && <SamplerBlock s={member.sampler} />}

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

interface TemplateStatusRow {
    contentSid: string; name: string; status: string; category: string | null; language: string | null;
    lastCheckedAt: string | null; approvedAt: string | null; rejectionReason: string | null;
}
interface ExpectedTemplateRow {
    purpose: string; usedBy: string; names: string[]; required: boolean;
    state: 'approved' | 'present' | 'missing'; resolvedName: string | null; byName: Record<string, string>;
}
interface TemplateStatusPayload {
    templates: TemplateStatusRow[]; counts: Record<string, number>; lastSyncedAt: string | null;
    expected: ExpectedTemplateRow[]; requiredApproved: boolean;
}

const TEMPLATE_STATUS_STYLE: Record<string, string> = {
    approved: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    received: 'bg-amber-100 text-amber-700',
    rejected: 'bg-red-100 text-red-700',
    unsubmitted: 'bg-slate-100 text-slate-500',
    missing: 'bg-red-100 text-red-700',
    present: 'bg-amber-100 text-amber-700',
};

/**
 * WhatsApp template status (P6 / A2: CUTOVER §0 "check templates on /admin/staff"). Two tables:
 * what the code EXPECTS by name (holding line, missed-call ack, the asks, call request), each
 * approved / present / missing, and the full cache below. Read-only apart from "Sync now", which
 * is a Twilio read; nothing here submits a template (scripts/_submit-holding-template.ts does).
 */
function TemplateStatusPanel() {
    const queryClient = useQueryClient();
    const [syncing, setSyncing] = useState(false);
    const [showAll, setShowAll] = useState(false);

    const { data, isLoading, error } = useQuery<TemplateStatusPayload>({
        queryKey: ['whatsapp-templates', 'status'],
        queryFn: async () => {
            const res = await fetch('/api/whatsapp-templates/status', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Failed to load template status');
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
    const expected = data?.expected ?? [];

    return (
        <div className="rounded-xl border border-slate-200 bg-white" data-testid="template-status">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">
                        <MessageSquare className="h-4 w-4" /> WhatsApp templates
                        {data && (
                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-black uppercase', data.requiredApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}>
                                {data.requiredApproved ? 'all required approved' : 'required template missing'}
                            </span>
                        )}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                        Only approved templates can reach someone outside the 24 hour window. Meta sends no notification
                        when it decides, so this is polled hourly and alerts on Pushover when one moves.
                        {data?.lastSyncedAt && ` Last synced ${new Date(data.lastSyncedAt).toLocaleString('en-GB')}.`}
                    </p>
                </div>
                <button
                    onClick={sync}
                    disabled={syncing}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    data-testid="template-sync"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} /> Sync now
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
            ) : error ? (
                <p className="p-4 text-xs text-red-700">{(error as Error).message}</p>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-[11px]">
                            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                                <tr><th className="px-4 py-1">Needed for</th><th className="px-2 py-1">Names the code tries</th><th className="px-2 py-1">State</th></tr>
                            </thead>
                            <tbody>
                                {expected.map((e) => (
                                    <tr key={e.purpose} className="border-t border-slate-100">
                                        <td className="px-4 py-1.5">
                                            <div className="font-semibold text-slate-800">{e.purpose}{e.required ? '' : <span className="ml-1 text-[9px] uppercase text-slate-400">optional</span>}</div>
                                            <div className="text-[10px] text-slate-400">{e.usedBy}</div>
                                        </td>
                                        <td className="px-2 py-1.5">
                                            {e.names.map((n) => (
                                                <span key={n} className="mr-1 inline-flex items-center gap-1 font-mono text-[10px] text-slate-700">
                                                    {n}<span className={cn('rounded px-1 text-[9px] font-bold uppercase', TEMPLATE_STATUS_STYLE[e.byName[n]] ?? 'bg-slate-100 text-slate-500')}>{e.byName[n]}</span>
                                                </span>
                                            ))}
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-black uppercase', TEMPLATE_STATUS_STYLE[e.state])}>{e.state}</span>
                                            {e.state !== 'approved' && e.required && <span className="ml-1 text-[10px] text-red-700">NO-GO for live</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="flex w-full items-center justify-between border-t border-slate-100 px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-800">
                        Every cached template ({templates.length}) {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {showAll && (
                        templates.length === 0 ? (
                            <p className="p-4 text-xs text-slate-500">Nothing cached yet. Hit "Sync now" to poll Twilio.</p>
                        ) : (
                            <div className="divide-y divide-slate-100 border-t border-slate-100">
                                {templates.map((t) => (
                                    <div key={t.contentSid} className="flex flex-wrap items-center gap-2 px-4 py-1.5">
                                        <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', TEMPLATE_STATUS_STYLE[t.status] ?? 'bg-slate-100 text-slate-500')}>{t.status}</span>
                                        <span className="text-xs font-semibold text-slate-900">{t.name}</span>
                                        {t.category && <span className="text-[10px] uppercase text-slate-400">{t.category}</span>}
                                        {t.language && <span className="text-[10px] text-slate-400">{t.language}</span>}
                                        {t.approvedAt && <span className="text-[10px] text-slate-400">approved {new Date(t.approvedAt).toLocaleDateString('en-GB')}</span>}
                                        {t.rejectionReason && <span className="text-[11px] font-semibold text-red-600">Meta said: {t.rejectionReason}</span>}
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- P6 / A2: shadow panel

interface ShadowPair {
    conversationId: string; spineRunId: string; legacyRunId: string | null; minutesApart: number | null; lane: string | null;
    spineDecision: string; legacyDecision: string | null; spineIntent: string | null; legacyIntent: string | null; legacyIntentMapped: string | null;
    spineGuards: string[]; legacyGuards: string[]; decisionAgree: boolean | null; intentAgree: boolean | null; guardAgree: boolean | null; at: string | null;
}
interface ShadowReportPayload {
    days: number; at: string; spineRuns: number; unpairedSpine: number;
    counts: { paired: number; decisionAgree: number; intentAgree: number; guardAgree: number };
    agreement: { decision: number | null; intent: number | null; guard: number | null };
    byDecision: Record<string, Record<string, number>>;
    recent: ShadowPair[];
}

/**
 * The go-live evidence (P6 / A2): what the spine WOULD have done in shadow against what the legacy
 * agent DID on the same threads (server/spine/shadow-report.ts compareShadow). 7 days by default,
 * 1-day toggle. Pairs link into /admin/comms.
 */
function ShadowPanel() {
    const [days, setDays] = useState<1 | 7>(7);
    const { data, isLoading, error } = useQuery<ShadowReportPayload>({
        queryKey: ['spine-shadow-report', days],
        queryFn: async () => {
            const res = await fetch(`/api/spine/shadow-report?days=${days}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error(`shadow report ${res.status}`);
            return res.json();
        },
        refetchInterval: 5 * 60_000,
    });
    const pctCls = (p: number | null) => p == null ? 'text-slate-400' : p >= 85 ? 'text-emerald-700' : p >= 70 ? 'text-slate-900' : 'text-amber-600';
    const decisions = data ? Object.keys(data.byDecision).sort() : [];
    const legacyKinds = data ? Array.from(new Set(decisions.flatMap((d) => Object.keys(data.byDecision[d])))).sort() : [];
    const agreeFlags = (p: ShadowPair) => p.legacyRunId ? [p.decisionAgree ? 'D' : 'd', p.intentAgree ? 'I' : 'i', p.guardAgree ? 'G' : 'g'].join('') : 'unpaired';

    return (
        <div className="rounded-xl border border-slate-200 bg-white" data-testid="shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                <div>
                    <h2 className="text-sm font-black text-slate-900">Shadow report — spine vs legacy</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                        What the spine would have done (shadow runs) against what the legacy agent did on the same thread within 15 minutes.
                        This is the evidence to read before flipping live (CUTOVER §2). Full table: scripts/_shadow-report.ts.
                    </p>
                </div>
                <div className="flex gap-1 rounded-lg border border-slate-300 p-0.5 text-[11px] font-bold">
                    {([1, 7] as const).map((d) => (
                        <button key={d} type="button" onClick={() => setDays(d)} data-testid={`shadow-days-${d}`}
                            className={cn('rounded px-2 py-1', days === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')}>
                            {d === 1 ? '1 day' : '7 days'}
                        </button>
                    ))}
                </div>
            </div>
            {isLoading ? (
                <p className="p-4 text-xs text-slate-500"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Comparing…</p>
            ) : error || !data ? (
                <p className="p-4 text-xs text-red-700">{(error as Error)?.message ?? 'No report'}</p>
            ) : data.spineRuns === 0 ? (
                <p className="p-4 text-xs text-slate-500">No shadow runs in the last {data.days} day{data.days === 1 ? '' : 's'}. The spine records one when it is in shadow mode and a thread falls due.</p>
            ) : (
                <div className="space-y-4 p-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className="text-xl font-black tabular-nums text-slate-900">{data.spineRuns}</div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">shadow runs</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2 text-center">
                            <div className="text-xl font-black tabular-nums text-slate-900">{data.counts.paired}<span className="text-xs text-slate-400"> / {data.unpairedSpine} unpaired</span></div>
                            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">paired with legacy</div>
                        </div>
                        {(['decision', 'intent', 'guard'] as const).map((k) => (
                            <div key={k} className="rounded-lg bg-slate-50 p-2 text-center">
                                <div className={cn('text-xl font-black tabular-nums', pctCls(data.agreement[k]))}>{data.agreement[k] == null ? '—' : `${data.agreement[k]}%`}</div>
                                <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">{k} agree · {data.counts[`${k}Agree`]}/{data.counts.paired}</div>
                            </div>
                        ))}
                    </div>
                    {decisions.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full text-left text-[11px]">
                                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                                    <tr><th className="px-2 py-1">spine would ↓ / legacy did →</th>{legacyKinds.map((k) => <th key={k} className="px-2 py-1 text-right">{k}</th>)}</tr>
                                </thead>
                                <tbody>
                                    {decisions.map((d) => (
                                        <tr key={d} className="border-t border-slate-100">
                                            <td className="px-2 py-1 font-semibold text-slate-800">{d}</td>
                                            {legacyKinds.map((k) => <td key={k} className={cn('px-2 py-1 text-right tabular-nums', d === k ? 'font-bold text-emerald-700' : 'text-slate-700')}>{data.byDecision[d][k] ?? 0}</td>)}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left text-[11px]">
                            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                                <tr><th className="px-2 py-1">when</th><th className="px-2 py-1">thread</th><th className="px-2 py-1">lane</th><th className="px-2 py-1">spine</th><th className="px-2 py-1">legacy</th><th className="px-2 py-1">spine intent</th><th className="px-2 py-1">legacy intent</th><th className="px-2 py-1">guards</th><th className="px-2 py-1">agree</th></tr>
                            </thead>
                            <tbody>
                                {data.recent.map((p) => (
                                    <tr key={p.spineRunId} className="border-t border-slate-100">
                                        <td className="px-2 py-1 text-slate-500">{p.at ? new Date(p.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</td>
                                        <td className="px-2 py-1"><a href={`/admin/comms?conversation=${encodeURIComponent(p.conversationId)}`} className="font-mono text-sky-700 underline">{p.conversationId.slice(0, 8)}</a></td>
                                        <td className="px-2 py-1 text-slate-600">{p.lane ?? ''}</td>
                                        <td className="px-2 py-1 font-semibold text-slate-800">{p.spineDecision}</td>
                                        <td className="px-2 py-1 text-slate-700">{p.legacyDecision ?? '—'}{p.minutesApart != null && <span className="text-slate-400"> ·{p.minutesApart}m</span>}</td>
                                        <td className="px-2 py-1 text-slate-700">{p.spineIntent ?? ''}</td>
                                        <td className="px-2 py-1 text-slate-700">{p.legacyIntent ?? ''}{p.legacyIntentMapped && p.legacyIntentMapped !== p.legacyIntent ? <span className="text-slate-400"> ({p.legacyIntentMapped})</span> : null}</td>
                                        <td className="px-2 py-1 text-slate-500">{p.spineGuards.join(',') || '-'} / {p.legacyGuards.join(',') || '-'}</td>
                                        <td className="px-2 py-1 font-mono">{agreeFlags(p)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="px-2 py-1 text-[10px] text-slate-400">Last {data.recent.length} pairs. Agree: uppercase = agrees (D decision, I intent, G guard).</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function AgentStaffPage() {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const { data, isLoading, error } = useQuery<{ staff: StaffMember[]; workerHeartbeat?: WorkerHeartbeat | null; spine?: SpineSwitches | null; legacy?: LegacySwitches | null }>({
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

            {/* Phase 0/1: is the one process that runs the fleet's loops alive? */}
            <WorkerHeartbeatStrip hb={data.workerHeartbeat} />
            {/* Phase 5 / P6: the spine's mode and every switch — flippable, every flip logged. */}
            <SpineSwitchStrip fallbackSpine={data.spine} fallbackLegacy={data.legacy} />
            {/* P6: CUTOVER §0 — templates by expected name, right under the switches they gate. */}
            <TemplateStatusPanel />
            {/* P6: the go-live evidence — spine shadow decisions vs what legacy did. */}
            <ShadowPanel />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.staff.map((m) => (
                    <StaffBadge key={m.id} member={m} onOpen={() => setSelectedId(m.id)} />
                ))}
            </div>

            {/* The closed loop: proposal → verdict → what the customer did. Directly under the
                roster because the badges say what each agent is carrying, and this says whether
                anyone should trust it with more. */}
            <AgentOutcomesPanel />

            <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
                <SheetContent side="right" className="w-full overflow-hidden p-0 sm:max-w-xl [&>button]:text-white">
                    {selected && <StaffDossier member={selected} />}
                </SheetContent>
            </Sheet>
        </div>
    );
}
