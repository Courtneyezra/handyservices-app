import { useMemo, useState } from "react";
import { useRoute } from "wouter";
import handyLogo from "@/assets/handy-logo-transparent.png";
import aliciaPhoto from "@/assets/alicia.jpg";
import { PLAN_ITEMS, computePlan, type PlanItem, type PlanOption, type Selection } from "@shared/plan-pricing";

/**
 * Public customer project page — the full story + additional-works choices.
 * Bespoke for the Sidney Road project. Public, no auth — the slug is the capability.
 * Route: /plan/:slug
 */

type StageState = "done" | "current" | "upcoming";
const STAGES: { n: number; title: string; sub: string; state: StageState; pay?: boolean }[] = [
  { n: 1, title: "Quote agreed", sub: "Original works · £4,281", state: "done" },
  { n: 2, title: "Deposit paid", sub: "£1,760", state: "done", pay: true },
  { n: 3, title: "Works underway", sub: "Extra repairs £910 + new hard-wired lighting", state: "done" },
  { n: 4, title: "Milestone paid", sub: "£1,500", state: "done", pay: true },
  { n: 5, title: "Finishing stage", sub: "You are here", state: "current" },
  { n: 6, title: "Completion", sub: "Balance £3,146 — when you’re happy", state: "upcoming" },
];

// Value-weighted completion of the original agreed job (painting all done bar the back room).
const PROGRESS = 97;

// Per-line progress for every original + additional work item (from the itemised quote).
type Work = { label: string; amt: string; pct: number };
const WORKS: { group: string; items: Work[] }[] = [
  { group: "Original works", items: [
    { label: "Repair internal wall cracks", amt: "£179", pct: 100 },
    { label: "Replace 10 ceiling & wall lights", amt: "£202", pct: 100 },
    { label: "Fit 2 carpets", amt: "£430", pct: 100 },
    { label: "Re-plaster below the bay windows", amt: "£586", pct: 100 },
    { label: "Prepare walls for painting", amt: "£268", pct: 100 },
    { label: "Repaint shed exterior", amt: "£174", pct: 100 },
    { label: "Repaint 4 fence panels", amt: "£161", pct: 90 },
    { label: "Repaint full house interior", amt: "£1,786", pct: 98 },
    { label: "Front repointing", amt: "re-quoting", pct: 10 },
  ] },
  { group: "Additional works", items: [
    { label: "Sand & paint fascia to apex", amt: "£365", pct: 100 },
    { label: "Bonding — top of stairs", amt: "£185", pct: 100 },
    { label: "Bonding — bay-window bedroom", amt: "£145", pct: 100 },
    { label: "Remove old sink light & make safe", amt: "£75", pct: 100 },
    { label: "Remove splashback & skim", amt: "£140", pct: 100 },
    { label: "Bay-window wall light + make good", amt: "£700", pct: 100 },
    { label: "Back-room two-gang switch", amt: "£120", pct: 100 },
    { label: "Front-bedroom pendant feed", amt: "£235", pct: 100 },
    { label: "Lining paper — last room", amt: "£160", pct: 100 },
  ] },
];

const TODO: { t: string; ours?: boolean }[] = [
  { t: "Downstairs back room — final paint, between Wed–Fri next week (better access while you’re out)" },
  { t: "Front repointing — re-quoted for the larger sections (a proper colour match), priced separately below" },
  { t: "Curtains — professionally cleaned, replaced if needed", ours: true },
  { t: "Full professional clean at the end", ours: true },
];

// Adaptive rough-effort label: half-day → days → working weeks (5 working days/week).
function fmtDays(d: number): string {
  if (d <= 0) return "—";
  if (d <= 0.5) return "half a day";
  const half = Math.round(d * 2) / 2;
  if (half >= 10) {
    const weeks = Math.round((half / 5) * 2) / 2; // working weeks, nearest half
    const ws = weeks % 1 === 0 ? String(weeks) : `${Math.floor(weeks)}½`;
    return `${ws} ${weeks <= 1 ? "week" : "weeks"}`;
  }
  const s = half % 1 === 0 ? String(half) : `${Math.floor(half)}½`;
  return `${s} ${half <= 1 ? "day" : "days"}`;
}

const gbp = (n: number) => "£" + n.toLocaleString("en-GB");
const WA = "447449501762";

export default function PlanPage() {
  const [, params] = useRoute("/plan/:slug");
  const slug = params?.slug ?? "";

  const [adds, setAdds] = useState<Record<string, boolean>>({});
  const [opts, setOpts] = useState<Record<string, number>>({});
  const [booking, setBooking] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of PLAN_ITEMS) { if (!m.has(it.group)) m.set(it.group, []); m.get(it.group)!.push(it); }
    return Array.from(m.entries());
  }, []);

  const selection: Selection[] = useMemo(() => {
    const s: Selection[] = [];
    for (const it of PLAN_ITEMS) {
      if (it.kind === "add") { if (adds[it.id]) s.push({ id: it.id }); }
      else { const o = opts[it.id]; if (o != null && it.options[o] && it.options[o].price > 0) s.push({ id: it.id, opt: o }); }
    }
    return s;
  }, [adds, opts]);

  const { total, deposit, days, lines } = useMemo(() => computePlan(selection), [selection]);

  const waHref = useMemo(() => {
    const t = ["Hi Handy Services — here are the extra works I'd like for 30 Sidney Road:", ""];
    lines.forEach((x) => t.push("• " + x.title + " — " + gbp(x.price)));
    t.push("", "Extras total: " + gbp(total), "Deposit to start: " + gbp(deposit), "(Sent from my online project plan)");
    return `https://wa.me/${WA}?text=` + encodeURIComponent(t.join("\n"));
  }, [lines, total, deposit]);

  async function payDeposit() {
    if (!selection.length || booking) return;
    setBooking(true);
    try {
      const res = await fetch(`/api/plan/${slug}/deposit-checkout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection }),
      });
      const data = await res.json();
      if (data?.url) { window.location.href = data.url; return; }
      throw new Error(data?.error || "no url");
    } catch {
      setBooking(false);
      alert("Sorry — we couldn’t start the payment just now. Please call us on 07449 501 762 and we’ll sort it.");
    }
  }

  return (
    <div className="min-h-screen font-sans pb-28" style={{ background: "#FBF8F3", color: "#1B2A4A" }}>
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center gap-3">
          <img src={handyLogo} alt="Handy Services" className="w-9 h-9 object-contain" />
          <div className="leading-none">
            <div className="text-white font-extrabold tracking-tight text-lg">Handy<span style={{ color: "#F5A623" }}>Services</span></div>
            <div className="text-slate-400 text-[10px] font-semibold tracking-[0.16em] uppercase mt-1">Your project</div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4">
        <section className="mt-5 rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-6">
          <h1 className="text-[27px] leading-tight font-bold tracking-tight text-balance">Everything so far — and your choices for what’s next.</h1>
          <div className="flex items-center gap-3 mt-3">
            <img src={aliciaPhoto} alt="Alicia" className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow" />
            <p className="text-[#5A6474] text-sm">30 Sidney Road, Beeston NG9 1AN<br />prepared for <span className="font-semibold text-[#1B2A4A]">Alicia</span></p>
          </div>
          <p className="text-[17px] mt-4">This is the full picture: what we agreed, what’s been done, what you’ve paid, where we are now — and then the extra work the house could have, entirely your choice.</p>
          <p className="text-[#5A6474] text-[15px] mt-3">No pressure on any of it, and nothing new starts until you say so.<br /><span className="font-semibold text-[#1B2A4A]">Courtnee — Handy Services</span></p>
        </section>

        {/* PROGRESS BAR — original agreed job */}
        <div className="mt-4 rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-bold text-[16px]">Your project — completion</span>
            <span className="font-bold text-[18px] tabular-nums" style={{ color: "#2F7A3D" }}>{PROGRESS}%</span>
          </div>
          <div className="h-3.5 rounded-full overflow-hidden" style={{ background: "#EDE8DC" }} role="progressbar" aria-valuenow={PROGRESS} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all" style={{ width: `${PROGRESS}%`, background: "linear-gradient(90deg,#2F7A3D,#4F9E5B)" }} />
          </div>
          <p className="text-[#5A6474] text-[14px] mt-2.5">On the home straight — most of the agreed works are complete, with the finishing items below still to wrap up.</p>
        </div>

        <SectionLabel>The story so far</SectionLabel>
        <ol className="relative pl-9">
          <span className="absolute left-[15px] top-2 bottom-3 w-[2px] bg-[#E4DFD2]" aria-hidden />
          {STAGES.map((s) => (
            <li key={s.n} className="relative pb-6 last:pb-0">
              <span className="absolute -left-9 top-1 grid place-items-center rounded-full text-[13px] font-bold"
                style={{ width: 32, height: 32,
                  background: s.state === "done" ? "#2F7A3D" : s.state === "current" ? "#F5A623" : "#FFFFFF",
                  color: s.state === "upcoming" ? "#9AA1AC" : "#FFFFFF",
                  border: s.state === "upcoming" ? "2px solid #D8D3C6" : "none",
                  boxShadow: s.state === "current" ? "0 0 0 5px rgba(245,166,35,.22)" : "none" }} aria-hidden>
                {s.state === "done" ? "✓" : s.n}
              </span>
              <div className="rounded-xl border p-4 shadow-sm"
                style={{ background: s.state === "current" ? "#FFF8EC" : "#FFFFFF", borderColor: s.state === "current" ? "#F3D9A6" : "#E7E2D6" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-[17px]">{s.title}</div>
                  {s.pay && <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full" style={{ background: "#EAF4EC", color: "#2F7A3D" }}>Paid</span>}
                  {s.state === "current" && <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full" style={{ background: "#F5A623", color: "#1B2A4A" }}>Now</span>}
                </div>
                <div className="text-[#5A6474] text-[14px] mt-0.5">{s.sub}</div>
              </div>
            </li>
          ))}
        </ol>

        <SectionLabel muted>Work tracker — every item</SectionLabel>
        <div className="rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          {WORKS.map((g) => (
            <div key={g.group} className="mb-5 last:mb-0">
              <div className="text-[#5A6474] text-[12px] font-bold tracking-[0.12em] uppercase mb-3">{g.group}</div>
              <div className="flex flex-col gap-3.5">
                {g.items.map((w) => (
                  <div key={w.label}>
                    <div className="flex justify-between items-baseline gap-3 text-[15px]">
                      <span className="flex-1">{w.label}</span>
                      <span className="tabular-nums whitespace-nowrap text-[#5A6474] text-[14px]">{w.amt}</span>
                    </div>
                    <div className="flex items-center gap-2.5 mt-1.5">
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "#EDE8DC" }}>
                        <div className="h-full rounded-full" style={{ width: `${w.pct}%`, background: w.pct === 100 ? "#2F7A3D" : "#F5A623" }} />
                      </div>
                      <span className="text-[12px] font-bold whitespace-nowrap" style={{ color: w.pct === 100 ? "#2F7A3D" : "#B4791F", minWidth: 44, textAlign: "right" }}>
                        {w.pct === 100 ? "Done" : w.pct <= 10 ? "Re-quote" : `${w.pct}%`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <SectionLabel muted>Your payments</SectionLabel>
        <div className="rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <PayRow label="Deposit · 14 Jul" value="£1,760.00" paid />
          <PayRow label="Milestone · 31 Jul" value="£1,500.00" paid />
          <PayRow label="Paid so far" value="£3,260.00" />
          <div className="flex justify-between items-baseline mt-2 pt-3 border-t-2 border-[#1B2A4A]">
            <span className="text-[17px] font-bold">Balance on completion</span>
            <span className="text-[20px] font-bold tabular-nums" style={{ color: "#F5A623" }}>£3,146.00</span>
          </div>
          <p className="text-[#5A6474] text-[13.5px] mt-3">The balance is due only when the agreed works are finished and you’re happy — not before.</p>
        </div>

        <SectionLabel muted>Still to finish — included in the above</SectionLabel>
        <div className="rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <ul className="flex flex-col gap-2.5">
            {TODO.map((d) => (<li key={d.t} className="flex gap-3 items-start text-[16px]"><span className="text-[#F5A623] font-bold mt-[2px] text-[10px]">●</span><span>{d.t}{d.ours && <b className="text-[#2F7A3D]"> (our cost)</b>}</span></li>))}
          </ul>
        </div>

        <SectionLabel>Your choices — additional work</SectionLabel>
        <p className="rounded-xl bg-[#F5F1E9] text-[#5A6474] text-[15px] p-4 mb-4">These are <b>extra</b> and completely separate from everything above. Add anything you’d like, skip the rest — your total builds as you go, and nothing is booked until you confirm.</p>
        <p className="rounded-xl text-[14px] p-3.5 mb-4 flex gap-2.5 items-start" style={{ background: "#FFF8EC", border: "1px solid #F3D9A6" }}>
          <span aria-hidden>✓</span>
          <span>All new wallpaper is <b>thick, textured (paintable) paper</b> — chosen to hide any imperfections in the old walls for a smooth, even finish.</span>
        </p>

        {groups.map(([label, items]) => {
          const suggested = label.startsWith("Finishing");
          return (
            <div key={label}>
              {suggested ? (
                <div className="mt-8 mb-3 rounded-xl px-4 py-3" style={{ background: "#EEF3FA", border: "1px solid #C3D0E6" }}>
                  <div className="text-[13px] font-bold tracking-[0.10em] uppercase" style={{ color: "#3B5BA5" }}>✦ Things we spotted — our suggestions</div>
                  <p className="text-[#5A6474] text-[14px] mt-0.5">Not on your original list — bits we noticed that would tidy the house up. Entirely optional.</p>
                </div>
              ) : (
                <div className="text-[#5A6474] text-[12.5px] font-bold tracking-[0.14em] uppercase mt-6 mb-3 px-1">{label}</div>
              )}
              {items.map((it) => it.kind === "add"
                ? <AddCard key={it.id} title={it.title} desc={it.desc} price={it.price} suggested={suggested} on={!!adds[it.id]} onToggle={() => setAdds((s) => ({ ...s, [it.id]: !s[it.id] }))} />
                : <OptCard key={it.id} title={it.title} desc={it.desc} options={it.options} chosen={opts[it.id] ?? -1} onChoose={(i) => setOpts((s) => ({ ...s, [it.id]: i }))} />
              )}
            </div>
          );
        })}

        <div className="rounded-2xl p-5 mb-3.5 border" style={{ background: "#EAF4EC", borderColor: "#BFE0C6" }}>
          <div className="font-bold text-[17px]" style={{ color: "#2F7A3D" }}>✓ Protection & full clean — included, no charge</div>
          <p className="text-[#5A6474] text-[15px] mt-1">Proper dust-sheeting, floor protection over your new carpets, rooms sealed off, a tidy-up every day, and a full clean at the end. On us.</p>
        </div>
        <div className="rounded-2xl p-5 mb-3.5 border" style={{ background: "#EAF4EC", borderColor: "#BFE0C6" }}>
          <div className="font-bold text-[17px]" style={{ color: "#2F7A3D" }}>✓ Downstairs back room ceiling — repaired, no charge</div>
          <p className="text-[#5A6474] text-[15px] mt-1">We’ll repair the back-room ceiling as part of putting things right. On us.</p>
        </div>
        <InfoCard title="Repointing — the two bays & above the front door — £2,450" body="Re-quoted as full sections — the whole of both bays plus the panel above the front door, so the new mortar blends and there’s no patchy colour. This replaces the smaller repointing in your original works. Tower access is included (no extra)." note="£2,450 · tower access included · confirmed on final measure · separate from your balance" />
        <InfoCard title="Kitchen damp / mould treatment" body="Priced once we’ve taken the corner unit out and seen the wall — no guesswork." note="Priced after the check above · not in your total yet" />

        <section className="mt-6 rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <h2 className="text-[21px] font-bold mb-3">Your chosen extras</h2>
          {lines.length === 0 ? (
            <p className="text-[#5A6474] text-[15px]">Nothing chosen yet — tap <b>Add</b> on anything above to start.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((x) => (<li key={x.id} className="flex justify-between gap-3 text-[15px] pb-2 border-b border-[#E7E2D6]"><span>{x.title}</span><span className="font-bold tabular-nums whitespace-nowrap">{gbp(x.price)}</span></li>))}
            </ul>
          )}
          <div className="flex justify-between items-baseline mt-3.5 pt-3.5 border-t-2 border-[#1B2A4A]">
            <span className="text-[17px] font-bold">Extras total</span>
            <span className="text-[26px] font-bold tabular-nums" style={{ color: "#F5A623" }}>{gbp(total)}</span>
          </div>
          {total > 0 && (
            <div className="mt-3 rounded-xl p-4" style={{ background: "#FFF8EC", border: "1px solid #F3D9A6" }}>
              <div className="flex justify-between items-baseline">
                <span className="text-[15px] font-semibold">Deposit to get started</span>
                <span className="text-[20px] font-bold tabular-nums" style={{ color: "#1B2A4A" }}>{gbp(deposit)}</span>
              </div>
              <p className="text-[#5A6474] text-[13px] mt-1">30% of labour + materials up front. The rest is due once the work’s done and you’re happy.</p>
              <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-[#F3D9A6]">
                <span className="text-[15px] font-semibold">Rough time on site</span>
                <span className="text-[16px] font-bold" style={{ color: "#1B2A4A" }}>≈ {fmtDays(days)}</span>
              </div>
              <p className="text-[#5A6474] text-[13px] mt-1">A guide to the work involved — we’ll agree exact dates with you, never leave you guessing.</p>
            </div>
          )}
          <div className="flex flex-col gap-2.5 mt-4">
            <button onClick={payDeposit} disabled={total === 0 || booking}
              className="h-14 rounded-2xl font-bold text-[17px] grid place-items-center disabled:opacity-50"
              style={{ background: "#F5A623", color: "#1B2A4A" }}>
              {booking ? "Starting secure payment…" : total > 0 ? `Pay ${gbp(deposit)} deposit to book` : "Choose your extras to book"}
            </button>
            <a href={waHref} className="h-14 rounded-2xl font-bold text-[16px] grid place-items-center border-2 border-[#E7E2D6]">Send my choices instead (no payment)</a>
            <a href="tel:+447449501762" className="h-12 rounded-2xl font-semibold text-[15px] grid place-items-center text-[#5A6474]">Prefer to talk it through? Call Courtnee</a>
          </div>
          <p className="text-[#5A6474] text-[13px] mt-4 leading-relaxed">Prices are fixed and include all materials. This is on top of your existing project — not part of the £3,146 balance. Paying the deposit books the work; we’ll then agree a start date together.</p>
        </section>
      </main>

      {total > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50">
          <div className="max-w-2xl mx-auto px-3">
            <div className="rounded-t-2xl bg-slate-900 text-white shadow-2xl px-4 py-3 flex items-center justify-between gap-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Deposit · {gbp(total)} total · ≈ {fmtDays(days)}</div>
                <div className="text-[22px] font-bold tabular-nums" style={{ color: "#F5A623" }}>{gbp(deposit)}</div>
              </div>
              <button onClick={payDeposit} disabled={booking} className="rounded-xl font-bold text-[15px] px-4 py-3 whitespace-nowrap disabled:opacity-60" style={{ background: "#F5A623", color: "#1B2A4A" }}>
                {booking ? "Starting…" : "Pay & book"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <div className="text-[12.5px] font-bold tracking-[0.15em] uppercase mt-8 mb-3.5 px-1" style={{ color: muted ? "#5A6474" : "#F5A623" }}>{children}</div>;
}

function PayRow({ label, value, paid }: { label: string; value: string; paid?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-2.5 border-b border-[#E7E2D6] text-[16px]">
      <span>{label}</span>
      <span className="font-bold tabular-nums whitespace-nowrap" style={{ color: paid ? "#2F7A3D" : undefined }}>{value}</span>
    </div>
  );
}

function AddCard({ title, desc, price, on, onToggle, suggested }: { title: string; desc: string; price: number; on: boolean; onToggle: () => void; suggested?: boolean }) {
  const restBg = suggested ? "#EEF3FA" : "#FFFFFF";
  const restBorder = suggested ? "#C3D0E6" : "#E7E2D6";
  return (
    <div className="rounded-2xl border shadow-sm p-[18px] mb-3.5 transition-colors" style={{ background: on ? "#EAF4EC" : restBg, borderColor: on ? "#BFE0C6" : restBorder }}>
      <h3 className="text-[19px] font-bold leading-snug">{title}</h3>
      <p className="text-[#5A6474] text-[15.5px] mt-1">{desc}</p>
      <div className="flex items-center justify-between gap-3.5 mt-3.5">
        <span className="text-[20px] font-bold tabular-nums">{gbp(price)}</span>
        <button onClick={onToggle} aria-pressed={on} className="min-h-12 px-5 rounded-full font-bold text-[15.5px] border-2 inline-flex items-center gap-2 transition-colors"
          style={on ? { background: "#2F7A3D", borderColor: "#2F7A3D", color: "#fff" } : { background: "transparent", borderColor: "#1B2A4A", color: "#1B2A4A" }}>
          {on ? "✓ Added" : "＋ Add"}
        </button>
      </div>
    </div>
  );
}

function OptCard({ title, desc, options, chosen, onChoose }: { title: string; desc: string; options: PlanOption[]; chosen: number; onChoose: (i: number) => void }) {
  const on = chosen >= 0 && options[chosen] && options[chosen].price > 0;
  return (
    <div className="rounded-2xl border shadow-sm p-[18px] mb-3.5 transition-colors" style={{ background: on ? "#EAF4EC" : "#FFFFFF", borderColor: on ? "#BFE0C6" : "#E7E2D6" }}>
      <h3 className="text-[19px] font-bold leading-snug">{title}</h3>
      <p className="text-[#5A6474] text-[15.5px] mt-1">{desc}</p>
      <div className="flex flex-col gap-2.5 mt-3.5">
        {options.map((o, i) => {
          const active = chosen === i;
          return (
            <button key={i} onClick={() => onChoose(i)} aria-pressed={active}
              className="min-h-[52px] px-4 rounded-xl border-2 text-left flex items-center justify-between gap-3 text-[15.5px] transition-colors"
              style={active ? { background: "#EAF4EC", borderColor: "#2F7A3D" } : { background: "#F5F1E9", borderColor: "#E7E2D6" }}>
              <span className="font-medium">{active ? "✓ " : ""}{o.label}</span>
              <span className="font-bold tabular-nums">{o.price ? gbp(o.price) : "—"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InfoCard({ title, body, note }: { title: string; body: string; note: string }) {
  return (
    <div className="rounded-2xl p-5 mb-3.5 border border-dashed" style={{ background: "#F1EFE9", borderColor: "#D8D3C6" }}>
      <div className="font-bold text-[17px]">{title}</div>
      <p className="text-[#5A6474] text-[15px] mt-1">{body}</p>
      <span className="block mt-1.5 text-[13.5px] text-[#8A8578]">{note}</span>
    </div>
  );
}
