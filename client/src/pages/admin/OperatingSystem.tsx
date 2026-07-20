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

interface DrawerData { title: string; subtitle?: string; avatar?: string; skills?: string[]; rows?: { k: string; v: string }[]; actions?: string[] }

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

export default function OperatingSystem() {
  const [ws, setWs] = useState<(typeof NAV)[number]['key']>('hub');
  const [hub, setHub] = useState<ContractorHub | null>(null);
  const [pipeline, setPipeline] = useState<OsPipeline | null>(null);
  const [send, setSend] = useState<OsSend | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerData | null>(null);

  useEffect(() => { getJSON<ContractorHub>('/api/admin/contractor-hub').then(setHub).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (ws === 'pipeline' && !pipeline) getJSON<OsPipeline>('/api/admin/os/pipeline').then(setPipeline).catch((e) => setErr(e.message));
    if (ws === 'send' && !send) getJSON<OsSend>('/api/admin/os/send').then(setSend).catch((e) => setErr(e.message));
  }, [ws, pipeline, send]);

  const title = NAV.find((n) => n.key === ws)?.label ?? '';
  const openItem = (i: OsItem, kind: string) => setDrawer({ title: i.title, subtitle: `${kind} · ${i.subtitle}` });
  const openContractor = (c: HubContractor) => setDrawer({
    title: c.name, subtitle: `${c.tier}${c.priority ? ` · priority ${c.priority}` : ''}`, avatar: c.name.slice(0, 2).toUpperCase(), skills: c.skills,
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

          {ws === 'hub' && (hub ? (
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

          {ws === 'dashboard' && <Stub name="Dashboard" desc="Command center: KPIs, today's jobs, alerts. Panels expand into the workspaces." />}
          {ws === 'settings' && <Stub name="Settings" desc="Pricing config, landing + content, VA console, team, integrations." />}
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

function Stub({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="text-sm text-gray-500 leading-relaxed max-w-lg">
      <span className="font-medium text-gray-800">{name}</span> — {desc}
      <div className="mt-2 text-xs text-gray-400">Wired next.</div>
    </div>
  );
}
