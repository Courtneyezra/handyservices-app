import { useEffect, useState } from 'react';

// Admin OS v1 — one-page shell (5 workspaces, drawer pattern). Contractor Hub,
// Pipeline and Send are live; Dashboard/Settings are stubs. See docs/contractor-platform.

type DeliveryTier = 'partner' | 'core' | 'adhoc';

interface HubContractor {
  id: string; name: string; tier: DeliveryTier; priority: number | null; skills: string[];
  bookedDaysThisWeek: number; committedDaysPerWeek: number | null; pipelineCount: number; fillPercent: number;
}
interface HubBand { tier: DeliveryTier; label: string; contractors: HubContractor[] }
interface CapacityGap { quoteId: string; slug: string | null; postcode: string | null; uncoveredCategories: string[] }
interface ContractorHub { bands: HubBand[]; capacityGaps: CapacityGap[] }

interface OsItem { id: string; title: string; subtitle: string }
interface PipelineStage { key: string; label: string; count: number; items: OsItem[] }
interface OsPipeline { stages: PipelineStage[] }
interface OsSend { readyToSend: OsItem[]; threads: OsItem[] }

interface DrawerData { title: string; subtitle?: string; avatar?: string; skills?: string[]; rows?: { k: string; v: string }[]; actions?: string[]; contractorId?: string; contractorName?: string }

const NAV = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'hub', label: 'Contractor hub' },
  { key: 'send', label: 'Send' },
  { key: 'settings', label: 'Settings' },
] as const;

const TIER_CHIP: Record<DeliveryTier, string> = {
  partner: 'bg-violet-100 text-violet-700',
  core: 'bg-blue-600 text-white',
  adhoc: 'bg-gray-200 text-gray-600',
};

const token = () => localStorage.getItem('adminToken') || '';
async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function sendJSON<T>(url: string, method: string, body?: any): Promise<T> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
  return r.json();
}

type SlotState = 'off' | 'open' | 'booked';
interface DayAvailability { date: string; dayOfWeek: number; am: SlotState; pm: SlotState }
interface PatternDay { dayOfWeek: number; am: boolean; pm: boolean }
interface WeekResp { weekStart: string; days: DayAvailability[]; pattern: PatternDay[] }
interface FlexJob { quoteId: string; slug: string | null; customerName: string; jobDescription: string | null; withinDays: number | null; deadline: string | null }

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const patternToWindow = (am: boolean, pm: boolean) =>
  am && pm ? { startTime: '09:00', endTime: '18:00' } : am ? { startTime: '09:00', endTime: '13:00' } : { startTime: '14:00', endTime: '18:00' };

export default function OperatingSystem() {
  const [ws, setWs] = useState<(typeof NAV)[number]['key']>('hub');
  const [hub, setHub] = useState<ContractorHub | null>(null);
  const [pipeline, setPipeline] = useState<OsPipeline | null>(null);
  const [send, setSend] = useState<OsSend | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerData | null>(null);

  useEffect(() => { getJSON<ContractorHub>('/api/admin/contractor-hub').then(setHub).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if ((ws === 'pipeline' || ws === 'dashboard') && !pipeline) getJSON<OsPipeline>('/api/admin/os/pipeline').then(setPipeline).catch((e) => setErr(e.message));
    if ((ws === 'send' || ws === 'dashboard') && !send) getJSON<OsSend>('/api/admin/os/send').then(setSend).catch((e) => setErr(e.message));
  }, [ws, pipeline, send]);

  const coreLead = hub?.bands.find((b) => b.tier === 'core')?.contractors[0] ?? null;
  const stageCount = (k: string) => pipeline?.stages.find((s) => s.key === k)?.count ?? 0;

  // Craig-first: per-contractor week + flex management.
  const [weekOf, setWeekOf] = useState<{ id: string; name: string } | null>(null);
  const [week, setWeek] = useState<WeekResp | null>(null);
  const [flex, setFlex] = useState<FlexJob[] | null>(null);
  const [patternEdit, setPatternEdit] = useState<PatternDay[]>([]);
  const [placing, setPlacing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadWeek = (id: string) => Promise.all([
    getJSON<WeekResp>(`/api/admin/contractor-hub/${id}/week`).then((w) => { setWeek(w); setPatternEdit(w.pattern); }),
    getJSON<{ jobs: FlexJob[] }>(`/api/admin/contractor-hub/${id}/flex`).then((f) => setFlex(f.jobs)),
  ]).catch((e) => setErr(e.message));

  const openWeek = (id: string, name: string) => { setDrawer(null); setWeekOf({ id, name }); setWeek(null); setFlex(null); setMsg(null); loadWeek(id); };
  const togglePattern = (dow: number, slot: 'am' | 'pm') =>
    setPatternEdit((prev) => prev.map((p) => (p.dayOfWeek === dow ? { ...p, [slot]: !p[slot] } : p)));
  const savePattern = async () => {
    if (!weekOf) return;
    const patterns = patternEdit.filter((p) => p.am || p.pm).map((p) => ({ dayOfWeek: p.dayOfWeek, ...patternToWindow(p.am, p.pm) }));
    try { setMsg('Saving…'); await sendJSON(`/api/admin/contractor-hub/${weekOf.id}/pattern`, 'PUT', { patterns }); await loadWeek(weekOf.id); setMsg('Weekly pattern saved.'); }
    catch (e: any) { setMsg(`Save failed: ${e.message}`); }
  };
  const placeFlex = async (date: string, slot: 'am' | 'pm') => {
    if (!weekOf || !placing) return;
    try { setMsg('Placing…'); await sendJSON(`/api/admin/contractor-hub/${weekOf.id}/flex/${placing}/place`, 'POST', { date, slot }); setPlacing(null); await loadWeek(weekOf.id); setMsg('Flex job placed as a booking.'); }
    catch (e: any) { setMsg(`Couldn't place: ${e.message}`); }
  };
  // Edit just THIS week: toggle a day's AM/PM as a date override (reuses the
  // existing per-date endpoint; a day carries one slot type Off/AM/PM/All-day).
  const editThisWeek = async (date: string, slot: 'am' | 'pm') => {
    if (!weekOf || !week) return;
    const d = week.days.find((x) => x.date === date);
    if (!d || d[slot] === 'booked') return; // can't edit a booked slot
    const isOn = (st: SlotState) => st === 'open' || st === 'booked';
    const amOn = slot === 'am' ? !isOn(d.am) : isOn(d.am);
    const pmOn = slot === 'pm' ? !isOn(d.pm) : isOn(d.pm);
    const slotType = amOn && pmOn ? 'full_day' : amOn ? 'am' : pmOn ? 'pm' : 'off';
    try { setMsg('Updating this week…'); await sendJSON(`/api/admin/contractors/${weekOf.id}/availability`, 'PUT', { dates: [{ date, slot: slotType, isAvailable: true }] }); await loadWeek(weekOf.id); setMsg('This week updated.'); }
    catch (e: any) { setMsg(`Update failed: ${e.message}`); }
  };

  const title = NAV.find((n) => n.key === ws)?.label ?? '';
  const openItem = (i: OsItem, kind: string) => setDrawer({ title: i.title, subtitle: `${kind} · ${i.subtitle}` });
  const openContractor = (c: HubContractor) => setDrawer({
    title: c.name, subtitle: `${c.tier}${c.priority ? ` · priority ${c.priority}` : ''}`, avatar: c.name.slice(0, 2).toUpperCase(), skills: c.skills,
    contractorId: c.id, contractorName: c.name,
    rows: [
      { k: 'Fill this week', v: `${c.fillPercent}%${c.committedDaysPerWeek ? ` of ${c.committedDaysPerWeek}d` : ''}` },
      { k: 'Booked (days)', v: String(c.bookedDaysThisWeek) },
      { k: 'Pipeline (soft quotes)', v: String(c.pipelineCount) },
      { k: 'Weekly retainer', v: c.committedDaysPerWeek ? `${c.committedDaysPerWeek} days` : 'Not agreed' },
    ],
    actions: ['Edit availability', 'Reassign a job', 'Adjust tier'],
  });

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      <nav className="w-44 shrink-0 border-r border-gray-200 bg-white p-3 flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2 py-2 mb-2 font-medium">
          <span className="w-6 h-6 rounded-md bg-orange-600 text-white grid place-items-center text-sm">H</span>Handy OS
        </div>
        {NAV.map((n) => (
          <button key={n.key} onClick={() => { setWs(n.key); setDrawer(null); }}
            className={`text-left px-3 py-2 rounded-lg text-sm ${ws === n.key ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500 hover:bg-gray-50'}`}>
            {n.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
          <h1 className="text-lg font-medium">{title}</h1>
          <button className="ml-auto rounded-md bg-orange-600 text-white text-sm font-medium px-3 py-1.5">Send quote</button>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {err && <p className="text-sm text-red-600 mb-3">Something didn't load: {err}</p>}

          {ws === 'hub' && weekOf && (
            <div>
              <button onClick={() => { setWeekOf(null); setPlacing(null); }} className="text-sm text-blue-600 mb-3">← Contractor hub</button>
              <h2 className="text-base font-medium mb-1">{weekOf.name} — this week</h2>
              {msg && <p className="text-xs text-gray-500 mb-2">{msg}</p>}
              {!week ? <p className="text-sm text-gray-500">Loading…</p> : (
                <>
                  <div className="rounded-xl border border-gray-200 bg-white p-3 mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Weekly recurring pattern</span>
                      <button onClick={savePattern} className="text-xs rounded-md bg-blue-600 text-white px-3 py-1.5">Save pattern</button>
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                        const p = patternEdit.find((x) => x.dayOfWeek === dow) || { dayOfWeek: dow, am: false, pm: false };
                        return (
                          <div key={dow} className="text-center">
                            <div className="text-xs text-gray-500 mb-1">{DOW[dow]}</div>
                            <button onClick={() => togglePattern(dow, 'am')} className={`w-full text-[11px] rounded mb-1 py-1 ${p.am ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>AM</button>
                            <button onClick={() => togglePattern(dow, 'pm')} className={`w-full text-[11px] rounded py-1 ${p.pm ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>PM</button>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-2">Tap AM/PM to set his standing days, then Save — this lights up the customer calendar.</p>
                  </div>

                  <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">This week{placing ? ' — tap an open slot to place the flex job' : ' — tap AM/PM to change just this week'}</div>
                  <div className="grid grid-cols-7 gap-2 mb-4">
                    {week.days.map((d) => (
                      <div key={d.date} className="border border-gray-200 rounded-lg p-2 text-center bg-white">
                        <div className="text-[10px] text-gray-500 font-medium">{DOW[d.dayOfWeek]}</div>
                        <div className="text-[10px] text-gray-400 mb-1">{d.date.slice(8)}</div>
                        {(['am', 'pm'] as const).map((s) => (
                          <SlotChip key={s} label={s.toUpperCase()} state={d[s]} placing={!!placing} onClick={() => { if (placing && d[s] === 'open') placeFlex(d.date, s); else editThisWeek(d.date, s); }} />
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Pending flex jobs</div>
                  {(!flex || flex.length === 0) ? <p className="text-sm text-gray-400 italic">None in his queue.</p> : flex.map((j) => (
                    <button key={j.quoteId} onClick={() => setPlacing(placing === j.quoteId ? null : j.quoteId)} className={`w-full text-left rounded-lg border px-3 py-2 mb-1.5 ${placing === j.quoteId ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                      <div className="flex justify-between"><span className="text-sm font-medium">{j.customerName}</span>{j.deadline && <span className="text-[11px] text-amber-700">by {j.deadline}</span>}</div>
                      <div className="text-xs text-gray-500 truncate">{j.jobDescription || j.slug}</div>
                      {placing === j.quoteId && <div className="text-[11px] text-amber-700 mt-1">Selected — tap an open AM/PM slot above to place.</div>}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {ws === 'hub' && !weekOf && (hub ? (
            <>
              {hub.bands.map((band) => (
                <section key={band.tier} className="mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${TIER_CHIP[band.tier]}`}>{band.label}</span>
                    {band.tier === 'core' && <span className="text-xs text-gray-500">book first · Craig → Bezent → Joe</span>}
                    {band.tier === 'adhoc' && <span className="text-xs text-gray-500">gap-filler · offered on WhatsApp</span>}
                    {band.tier === 'partner' && <span className="text-xs text-gray-500">future seat</span>}
                  </div>
                  {band.contractors.length === 0 ? <p className="text-sm text-gray-400 italic px-1">None yet.</p> : band.contractors.map((c) => (
                    <button key={c.id} onClick={() => openContractor(c)} className="w-full flex items-center gap-3 p-3 mb-1.5 rounded-xl border border-gray-200 bg-white hover:border-gray-300 text-left">
                      <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 grid place-items-center text-xs font-medium shrink-0">{c.name.slice(0, 2).toUpperCase()}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium">{c.name}</span>
                        <span className="block text-xs text-gray-500 truncate">{c.skills.slice(0, 4).join(' · ') || 'No skills tagged'}</span>
                      </span>
                      <span className="w-32 shrink-0">
                        <span className="flex justify-between text-[10px] text-gray-400 mb-1"><span>fill</span><span>{c.fillPercent}%</span></span>
                        <span className="block h-1.5 rounded-full bg-gray-100 relative overflow-hidden">
                          <span className="absolute inset-y-0 left-0 bg-blue-500 rounded-full" style={{ width: `${c.fillPercent}%` }} />
                          <span className="absolute inset-y-[-2px] w-0.5 bg-green-600" style={{ left: '85%' }} />
                        </span>
                      </span>
                      <span className="flex gap-1.5 shrink-0">
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-amber-700">pipeline {c.pipelineCount}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-green-700">booked {c.bookedDaysThisWeek}</span>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
              <section className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3">
                <div className="text-sm font-medium text-amber-800 mb-1">Capacity gaps — quotes nobody covers</div>
                {hub.capacityGaps.length === 0 ? <p className="text-xs text-amber-700">None right now.</p> : hub.capacityGaps.map((g) => (
                  <div key={g.quoteId} className="text-xs text-amber-900 mt-1">{g.slug ?? g.quoteId} · <b>{g.uncoveredCategories.join(', ') || 'unknown trade'}</b>{g.postcode ? ` · ${g.postcode}` : ''} — no supply → recruit</div>
                ))}
              </section>
            </>
          ) : <p className="text-sm text-gray-500">Loading the hub…</p>)}

          {ws === 'pipeline' && (pipeline ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {pipeline.stages.map((st) => (
                <div key={st.key} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex justify-between text-xs font-medium text-gray-600 mb-2"><span>{st.label}</span><span className="text-gray-400">{st.count}</span></div>
                  {st.items.length === 0 ? <p className="text-xs text-gray-400 italic">Empty</p> : st.items.map((it) => (
                    <button key={it.id} onClick={() => openItem(it, st.label)} className="w-full text-left rounded-lg border border-gray-100 hover:border-gray-300 px-2.5 py-2 mb-1.5">
                      <span className="block text-xs font-medium truncate">{it.title}</span>
                      <span className="block text-[11px] text-gray-400 truncate">{it.subtitle}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-500">Loading the pipeline…</p>)}

          {ws === 'send' && (send ? (
            <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Ready to send</div>
                {send.readyToSend.length === 0 ? <p className="text-sm text-gray-400 italic">Nothing waiting.</p> : send.readyToSend.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 mb-1.5">
                    <span className="flex-1 min-w-0"><span className="block text-sm font-medium truncate">{it.title}</span><span className="block text-xs text-gray-400 truncate">{it.subtitle}</span></span>
                    <button className="text-xs rounded-md bg-orange-600 text-white px-2.5 py-1">Send</button>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">Conversations</div>
                {send.threads.length === 0 ? <p className="text-sm text-gray-400 italic">No open threads.</p> : send.threads.map((it) => (
                  <button key={it.id} onClick={() => openItem(it, 'Lead')} className="w-full text-left flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 mb-1.5 hover:border-gray-300">
                    <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    <span className="flex-1 min-w-0"><span className="block text-sm font-medium truncate">{it.title}</span><span className="block text-xs text-gray-400 truncate">{it.subtitle}</span></span>
                  </button>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-500">Loading send…</p>)}

          {ws === 'dashboard' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <Kpi label="Craig fill" value={coreLead ? `${coreLead.fillPercent}%` : '—'} sub="target 85%" />
                <Kpi label="Open quotes" value={String(stageCount('quotes'))} />
                <Kpi label="Jobs booked" value={String(stageCount('jobs'))} />
                <Kpi label="Capacity gaps" value={String(hub?.capacityGaps.length ?? 0)} />
              </div>
              <p className="text-xs text-gray-400 mb-3">Live panels — click one to open its workspace.</p>
              <div className="grid md:grid-cols-2 gap-3">
                <Panel title="Contractor hub" onOpen={() => setWs('hub')}>
                  {(hub?.bands.find((b) => b.tier === 'core')?.contractors ?? []).slice(0, 3).map((c) => (
                    <div key={c.id} className="flex items-center gap-2 py-1 text-sm">
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="w-24 h-1.5 rounded-full bg-gray-100 relative overflow-hidden"><span className="absolute inset-y-0 left-0 bg-blue-500 rounded-full" style={{ width: `${c.fillPercent}%` }} /></span>
                      <span className="text-xs text-gray-400 w-9 text-right">{c.fillPercent}%</span>
                    </div>
                  ))}
                </Panel>
                <Panel title="Pipeline" onOpen={() => setWs('pipeline')}>
                  {(pipeline?.stages ?? []).map((s) => (
                    <div key={s.key} className="flex justify-between py-1 text-sm"><span className="text-gray-600">{s.label}</span><span className="font-medium">{s.count}</span></div>
                  ))}
                </Panel>
                <Panel title="Send" onOpen={() => setWs('send')}>
                  <div className="flex justify-between py-1 text-sm"><span className="text-gray-600">Ready to send</span><span className="font-medium">{send?.readyToSend.length ?? 0}</span></div>
                  <div className="flex justify-between py-1 text-sm"><span className="text-gray-600">Open conversations</span><span className="font-medium">{send?.threads.length ?? 0}</span></div>
                </Panel>
                <Panel title="Capacity gaps" onOpen={() => setWs('hub')}>
                  {(hub?.capacityGaps ?? []).length === 0 ? <p className="text-sm text-gray-400 py-1">None right now.</p> : (hub?.capacityGaps ?? []).slice(0, 4).map((g) => (
                    <div key={g.quoteId} className="text-xs text-amber-800 py-0.5">{g.uncoveredCategories.join(', ') || 'unknown'}{g.postcode ? ` · ${g.postcode}` : ''}</div>
                  ))}
                </Panel>
              </div>
            </>
          )}
          {ws === 'settings' && (
            <div className="grid md:grid-cols-2 gap-3 max-w-3xl">
              <SettingCard title="Pricing" desc="EVE reference prices, engine, rate cards" href="/admin/pricing-settings" />
              <SettingCard title="Landing & content" desc="Landing pages, banners, content library" href="/admin/landing-pages" />
              <SettingCard title="Contractors" desc="Profiles, skills, availability, tiers" href="/admin/contractors" />
              <SettingCard title="VA console" desc="Ben's stats, resources, training" href="/admin/va-stats" />
            </div>
          )}
        </div>
      </main>

      <div className={`fixed inset-0 bg-black/40 transition-opacity ${drawer ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setDrawer(null)} />
      <aside className={`fixed top-0 right-0 h-full w-80 max-w-[85%] bg-white border-l border-gray-200 shadow-xl transition-transform ${drawer ? 'translate-x-0' : 'translate-x-full'}`}>
        {drawer && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-200">
              {drawer.avatar && <span className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 grid place-items-center font-medium">{drawer.avatar}</span>}
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{drawer.title}</div>
                {drawer.subtitle && <div className="text-xs text-gray-500 capitalize truncate">{drawer.subtitle}</div>}
              </div>
              <button className="ml-auto text-gray-400 hover:text-gray-700 text-xl leading-none" onClick={() => setDrawer(null)} aria-label="Close">×</button>
            </div>
            <div className="p-4 overflow-auto text-sm">
              {drawer.skills && (
                <>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">Skills</div>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {drawer.skills.length ? drawer.skills.map((s) => <span key={s} className="text-xs border border-gray-200 rounded px-2 py-0.5">{s}</span>) : <span className="text-xs text-gray-400">None tagged</span>}
                  </div>
                </>
              )}
              {drawer.rows?.map((r) => (
                <div key={r.k} className="flex justify-between py-1.5 border-b border-gray-100 text-xs"><span className="text-gray-500">{r.k}</span><span>{r.v}</span></div>
              ))}
              {drawer.contractorId && (
                <button onClick={() => openWeek(drawer.contractorId!, drawer.contractorName || drawer.title)} className="mt-4 w-full text-sm rounded-md bg-blue-600 text-white px-3 py-2">Manage availability &amp; flex →</button>
              )}
              {drawer.actions && (
                <div className="flex gap-2 mt-4 flex-wrap">
                  {drawer.actions.map((a) => <button key={a} className="text-xs border border-gray-300 rounded-md px-3 py-1.5">{a}</button>)}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function SlotChip({ label, state, placing, onClick }: { label: string; state: SlotState; placing: boolean; onClick: () => void }) {
  const cls = state === 'booked'
    ? 'bg-blue-600 text-white'
    : state === 'open'
      ? (placing ? 'bg-green-100 text-green-700 ring-1 ring-green-400 cursor-pointer' : 'bg-green-50 text-green-700 cursor-pointer hover:bg-green-100')
      : 'bg-gray-50 text-gray-300 cursor-pointer hover:bg-gray-100';
  const title = state === 'booked' ? 'Booked' : state === 'open' ? 'Available — tap to turn off this week' : 'Off — tap to turn on this week';
  return <div onClick={state === 'booked' ? undefined : onClick} title={title} className={`text-[10px] rounded py-0.5 mb-0.5 ${cls}`}>{label}{state === 'booked' ? '·bk' : ''}</div>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-white border border-gray-200 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-medium mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

function Panel({ title, onOpen, children }: { title: string; onOpen: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{title}</span>
        <button onClick={onOpen} className="text-xs text-blue-600 hover:underline">Open</button>
      </div>
      {children}
    </div>
  );
}

function SettingCard({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <a href={href} className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-gray-500 mt-1">{desc}</div>
    </a>
  );
}
