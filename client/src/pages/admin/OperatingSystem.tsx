import { useEffect, useState } from 'react';

// Admin OS v1 — one-page shell (5 workspaces, drawer pattern) with the
// Contractor Hub as the first live workspace. See docs/contractor-platform.

type DeliveryTier = 'partner' | 'core' | 'adhoc';

interface HubContractor {
  id: string;
  name: string;
  tier: DeliveryTier;
  priority: number | null;
  skills: string[];
  bookedDaysThisWeek: number;
  committedDaysPerWeek: number | null;
  pipelineCount: number;
  fillPercent: number;
}
interface HubBand { tier: DeliveryTier; label: string; contractors: HubContractor[] }
interface CapacityGap { quoteId: string; slug: string | null; postcode: string | null; uncoveredCategories: string[] }
interface ContractorHub { bands: HubBand[]; capacityGaps: CapacityGap[] }

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

export default function OperatingSystem() {
  const [ws, setWs] = useState<(typeof NAV)[number]['key']>('hub');
  const [hub, setHub] = useState<ContractorHub | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HubContractor | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('adminToken') || '';
    fetch('/api/admin/contractor-hub', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ContractorHub) => setHub(d))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const title = NAV.find((n) => n.key === ws)?.label ?? '';

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Rail — 5 workspaces, no CRM sidebar sprawl */}
      <nav className="w-44 shrink-0 border-r border-gray-200 bg-white p-3 flex flex-col gap-1">
        <div className="flex items-center gap-2 px-2 py-2 mb-2 font-medium">
          <span className="w-6 h-6 rounded-md bg-orange-600 text-white grid place-items-center text-sm">H</span>
          Handy OS
        </div>
        {NAV.map((n) => (
          <button
            key={n.key}
            onClick={() => { setWs(n.key); setSelected(null); }}
            className={`text-left px-3 py-2 rounded-lg text-sm ${ws === n.key ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {n.label}
          </button>
        ))}
      </nav>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
          <h1 className="text-lg font-medium">{title}</h1>
          <button className="ml-auto rounded-md bg-orange-600 text-white text-sm font-medium px-3 py-1.5">Send quote</button>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {ws === 'hub' && (
            <>
              {loading && <p className="text-sm text-gray-500">Loading the hub…</p>}
              {err && <p className="text-sm text-red-600">Couldn't load the hub: {err}</p>}
              {hub && (
                <>
                  {hub.bands.map((band) => (
                    <section key={band.tier} className="mb-6">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${TIER_CHIP[band.tier]}`}>{band.label}</span>
                        {band.tier === 'core' && <span className="text-xs text-gray-500">book first · Craig → Bezent → Joe</span>}
                        {band.tier === 'adhoc' && <span className="text-xs text-gray-500">gap-filler · offered on WhatsApp</span>}
                        {band.tier === 'partner' && <span className="text-xs text-gray-500">future seat</span>}
                      </div>
                      {band.contractors.length === 0 ? (
                        <p className="text-sm text-gray-400 italic px-1">None yet.</p>
                      ) : (
                        band.contractors.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setSelected(c)}
                            className="w-full flex items-center gap-3 p-3 mb-1.5 rounded-xl border border-gray-200 bg-white hover:border-gray-300 text-left"
                          >
                            <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 grid place-items-center text-xs font-medium shrink-0">
                              {c.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-medium">{c.name}</span>
                              <span className="block text-xs text-gray-500 truncate">{c.skills.slice(0, 4).join(' · ') || 'No skills tagged'}</span>
                            </span>
                            <span className="w-32 shrink-0">
                              <span className="flex justify-between text-[10px] text-gray-400 mb-1">
                                <span>fill</span><span>{c.fillPercent}%</span>
                              </span>
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
                        ))
                      )}
                    </section>
                  ))}

                  <section className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3">
                    <div className="text-sm font-medium text-amber-800 mb-1">Capacity gaps — quotes nobody covers</div>
                    {hub.capacityGaps.length === 0 ? (
                      <p className="text-xs text-amber-700">None right now.</p>
                    ) : (
                      hub.capacityGaps.map((g) => (
                        <div key={g.quoteId} className="text-xs text-amber-900 mt-1">
                          {g.slug ?? g.quoteId} · <b>{g.uncoveredCategories.join(', ') || 'unknown trade'}</b>{g.postcode ? ` · ${g.postcode}` : ''} — no supply → recruit
                        </div>
                      ))
                    )}
                  </section>
                </>
              )}
            </>
          )}

          {ws === 'dashboard' && <Stub name="Dashboard" desc="Command center: KPIs, today's jobs, alerts. Panels expand into the workspaces." />}
          {ws === 'pipeline' && <Stub name="Pipeline" desc="Lead → quote → job → invoice. Each record opens in a drawer." />}
          {ws === 'send' && <Stub name="Send" desc="Build + send a contextual quote (skills + time + manual contractor/team pick), plus the comms inbox." />}
          {ws === 'settings' && <Stub name="Settings" desc="Pricing config, landing + content, VA console, team, integrations." />}
        </div>
      </main>

      {/* Drawer — detail slides over, never a new page */}
      <div
        className={`fixed inset-0 bg-black/40 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setSelected(null)}
      />
      <aside
        className={`fixed top-0 right-0 h-full w-80 max-w-[85%] bg-white border-l border-gray-200 shadow-xl transition-transform ${selected ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {selected && (
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-200">
              <span className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 grid place-items-center font-medium">{selected.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <div className="text-sm font-medium">{selected.name}</div>
                <div className="text-xs text-gray-500 capitalize">{selected.tier}{selected.priority ? ` · priority ${selected.priority}` : ''}</div>
              </div>
              <button className="ml-auto text-gray-400 hover:text-gray-700 text-xl leading-none" onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>
            <div className="p-4 overflow-auto text-sm">
              <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">Skills</div>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {selected.skills.length ? selected.skills.map((s) => <span key={s} className="text-xs border border-gray-200 rounded px-2 py-0.5">{s}</span>) : <span className="text-xs text-gray-400">None tagged</span>}
              </div>
              <Row k="Fill this week" v={`${selected.fillPercent}%${selected.committedDaysPerWeek ? ` of ${selected.committedDaysPerWeek}d` : ''}`} />
              <Row k="Booked (days)" v={String(selected.bookedDaysThisWeek)} />
              <Row k="Pipeline (soft quotes)" v={String(selected.pipelineCount)} />
              <Row k="Weekly retainer" v={selected.committedDaysPerWeek ? `${selected.committedDaysPerWeek} days` : 'Not agreed'} />
              <div className="flex gap-2 mt-4 flex-wrap">
                <button className="text-xs border border-gray-300 rounded-md px-3 py-1.5">Edit availability</button>
                <button className="text-xs border border-gray-300 rounded-md px-3 py-1.5">Reassign a job</button>
                <button className="text-xs border border-gray-300 rounded-md px-3 py-1.5">Adjust tier</button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-100 text-xs">
      <span className="text-gray-500">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function Stub({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="text-sm text-gray-500 leading-relaxed max-w-lg">
      <span className="font-medium text-gray-800">{name}</span> — {desc}
      <div className="mt-2 text-xs text-gray-400">Wired next. The Contractor Hub is the first live workspace.</div>
    </div>
  );
}
