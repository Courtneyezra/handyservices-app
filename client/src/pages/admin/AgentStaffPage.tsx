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
export interface SpineSwitches {
    mode: 'off' | 'shadow' | 'live';
    enabled: boolean; shadow: boolean; explicitMode: string | null;
    agents: Partial<Record<string, { enabled: boolean }>>;
    asks: { enabled: boolean };
    autonomy: { enabled: boolean };
    sampler: { enabled: boolean; rate: number; min: number; max: number };
    video: { enabled: boolean; images: boolean; maxPerRun: number };
    sweepLimit: number; debounceMinutes: number; triageModel: string; city: string;
}
export interface LegacySwitches { enabled: boolean; onInbound: boolean; autosend: boolean; firstContactAck: boolean; quotePrep: boolean }

/** Phase 0 heartbeat, same shape as GET /api/health/comms-worker. Every field optional: an older
 *  server answers without it and the strip simply says so. */
export interface WorkerHeartbeat {
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
export interface PackTierRow {
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
export function WorkerHeartbeatStrip({ hb }: { hb: WorkerHeartbeat | null | undefined }) {
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

/** Phase 3: the ladder — intent · tier · verdicts/30d · unedited % · unsafe · eval family · last change. */
export function PackTiersBlock({ rows }: { rows: PackTierRow[] }) {
    const packs = Array.from(new Set(rows.map((r) => r.packId)));
    const tierCls: Record<PackTierRow['tier'], string> = {
        SEND: 'bg-emerald-100 text-emerald-800', DRAFT: 'bg-amber-100 text-amber-800', PROPOSE: 'bg-sky-100 text-sky-800', READ: 'bg-slate-100 text-slate-600',
    };
    const evalCls: Record<PackTierRow['evalFamily'], string> = { pass: 'text-emerald-700', fail: 'text-red-700', skipped: 'text-slate-400', missing: 'text-slate-400' };
    const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return (
        <div data-testid="pack-tiers">
            <h3 className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Autonomy ladder (earned per intent)</h3>
            <p className="mb-2 text-[11px] text-slate-500">
                SEND is earned: eval family pass³, ≥ 30 pack verdicts in 30d at ≥ 90% unedited, zero unsafe ever, zero escalations in 14d.
                ask_gap / confirm_received fast-track after 14 days, 20 verdicts, 0 rejects. Any unsafe, incident or sampled approval under 80% drops it back to DRAFT.
            </p>
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
                                    <th className="px-2 py-1 text-right">Unedited</th><th className="px-2 py-1 text-right">Unsafe</th><th className="px-2 py-1">Eval family</th><th className="px-2 py-1">Last change</th>
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
export function SpineSwitchStrip({ spine, legacy }: { spine: SpineSwitches | null | undefined; legacy: LegacySwitches | null | undefined }) {
    if (!spine) {
        return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">Spine switches not reported by this server.</div>;
    }
    const modeTone = spine.mode === 'live' ? 'bg-emerald-600 text-white' : spine.mode === 'shadow' ? 'bg-amber-500 text-white' : 'bg-slate-700 text-white';
    const modeText = spine.mode === 'live' ? 'LIVE — the spine answers customers; legacy off'
        : spine.mode === 'shadow' ? 'SHADOW — the spine runs dry and records; legacy still drafts'
        : 'OFF — legacy only';
    const chip = (label: string, on: boolean, title: string) => (
        <span key={label} title={title} className={cn('rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide', on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{label}</span>
    );
    const agentChips = Object.entries(spine.agents ?? {}).map(([k, v]) => chip(`${k} ${v?.enabled ? 'on' : 'off'}`, !!v?.enabled, `spine.agents.${k}.enabled`));
    return (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="spine-switches">
            <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded px-2 py-1 text-[11px] font-black uppercase tracking-wide', modeTone)}>spine {spine.mode}</span>
                <span className="text-xs text-slate-600">{modeText}</span>
                <span className="ml-auto text-[10px] text-slate-400">flip with scripts/_spine-mode.ts · rollback in CUTOVER.md §4</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {chip('enabled', spine.enabled, 'spine.enabled — master; off = nothing in server/spine runs')}
                {chip('shadow', spine.shadow, 'spine.shadow — compute and record, never exit')}
                {chip(`asks ${spine.asks.enabled ? 'on' : 'off'}`, spine.asks.enabled, 'spine.asks.enabled — rules-layer media/postcode asks from the exit')}
                {chip(`autonomy ${spine.autonomy.enabled ? 'on' : 'off'}`, spine.autonomy.enabled, 'spine.autonomy.enabled — the 07:30 promotion/demotion job')}
                {chip(`sampler ${spine.sampler.enabled ? `on · ${Math.round(spine.sampler.rate * 100)}%` : 'off'}`, spine.sampler.enabled, 'spine.sampler — the 08:30 sample of yesterday\'s automatic sends')}
                {chip(`video ${spine.video.enabled ? `on · ${spine.video.maxPerRun}/run${spine.video.images ? ' +photos' : ''}` : 'off'}`, spine.video.enabled, 'spine.video — describe_video on the case file (Gemini)')}
                {agentChips}
                <span className="text-[10px] text-slate-400">debounce {spine.debounceMinutes} min · sweep {spine.sweepLimit}/tick · triage {spine.triageModel} · {spine.city}</span>
            </div>
            {legacy && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">legacy comms_agent</span>
                    {chip(`sweep ${legacy.enabled ? 'on' : 'off'}`, legacy.enabled, 'comms_agent.enabled — the legacy SLA sweep')}
                    {chip(`on inbound ${legacy.onInbound ? 'on' : 'off'}`, legacy.onInbound, 'comms_agent.onInbound — legacy drafts on new messages (off once the spine is live)')}
                    {chip(`autosend ${legacy.autosend ? 'ON' : 'off'}`, legacy.autosend, 'comms_agent.autosend.enabled — legacy direct send; OFF since the 2 Sep hotfix')}
                    {chip(`first-contact ack ${legacy.firstContactAck ? 'on' : 'off'}`, legacy.firstContactAck, 'comms_agent.firstContactAutoAck.enabled')}
                    {chip(`auto quote-prep ${legacy.quotePrep ? 'on' : 'off'}`, legacy.quotePrep, 'comms_agent.quotePrep.enabled')}
                </div>
            )}
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
            {/* Phase 5: the spine's mode and every switch, read-only. */}
            <SpineSwitchStrip spine={data.spine} legacy={data.legacy} />

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
