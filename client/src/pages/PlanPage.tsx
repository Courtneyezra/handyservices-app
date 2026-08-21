import { useMemo, useState } from "react";
import { useRoute } from "wouter";
import handyLogo from "@/assets/handy-logo-transparent.png";
import aliciaPhoto from "@/assets/alicia.jpg";
import { PLAN_ITEMS, computePlan, completedBookedRemaining, SIGNED_OFF_BALANCE, COMPLETED_BOOKED_IDS, type PlanItem, type PlanOption, type PlanCallout, type Selection } from "@shared/plan-pricing";

/**
 * Public customer project page — the full story + additional-works choices.
 * Bespoke for the Sidney Road project. Public, no auth — the slug is the capability.
 * Route: /plan/:slug
 */

type StageState = "done" | "current" | "upcoming";
const STAGES: { n: number; title: string; sub: string; state: StageState; pay?: boolean; next?: boolean }[] = [
  { n: 1, title: "Quote agreed", sub: "Original works · £4,281", state: "done" },
  { n: 2, title: "Deposit paid", sub: "£1,760", state: "done", pay: true },
  { n: 3, title: "Works underway", sub: "Extra repairs £910 + new hard-wired lighting", state: "done" },
  { n: 4, title: "Milestone paid", sub: "£1,500", state: "done", pay: true },
  { n: 5, title: "Finished & walked through", sub: "You’ve signed the works off — thank you", state: "done" },
  { n: 6, title: "Settle the final balance", sub: "£2,653 — ready to pay now", state: "current", next: true },
];

// Original agreed job is complete and signed off.
const PROGRESS = 100;

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
    { label: "Repaint 4 fence panels", amt: "£161", pct: 100 },
    { label: "Repaint full house interior", amt: "£1,786", pct: 100 },
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

// The 14 items Alicia booked + paid the deposit on (15 Aug). Everything NOT in
// here is still available to add below. Kept as a set so the two lists can never
// drift: booked shows up top, the rest render as choices.
const BOOKED_IDS = new Set<string>([
  "bathroom-damp", "hall-ceiling", "up-bathroom", "halls-stairs", "kitchen-paint",
  "kitchen-grout", "kitchen-check", "doors", "banister", "archway",
  "gloss-woodwork", "window-sills", "attic-hatch", "skirting-section",
]);
const BOOKED_SELECTION: Selection[] = Array.from(BOOKED_IDS, (id) => ({ id }));
const BOOKED_DEPOSIT_PAID = 2924; // actually paid (Stripe, 15 Aug)

export default function PlanPage() {
  const [, params] = useRoute("/plan/:slug");
  const slug = params?.slug ?? "";

  const [adds, setAdds] = useState<Record<string, boolean>>({});
  const [opts, setOpts] = useState<Record<string, number>>({});
  const [booking, setBooking] = useState(false);

  // What she's already booked (shown up top), computed from the same table.
  const booked = useMemo(() => computePlan(BOOKED_SELECTION), []);
  const bookedBalance = booked.total - BOOKED_DEPOSIT_PAID;
  // Two booked items are now complete — their remaining balance settles now.
  const completed = useMemo(() => completedBookedRemaining(), []);
  const isComplete = (id: string) => COMPLETED_BOOKED_IDS.includes(id);

  // Only the not-yet-booked items are offered as choices below.
  const groups = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of PLAN_ITEMS) { if (BOOKED_IDS.has(it.id)) continue; if (!m.has(it.group)) m.set(it.group, []); m.get(it.group)!.push(it); }
    return Array.from(m.entries());
  }, []);

  const selection: Selection[] = useMemo(() => {
    const s: Selection[] = [];
    for (const it of PLAN_ITEMS) {
      if (BOOKED_IDS.has(it.id)) continue;
      if (it.kind === "add") { if (adds[it.id]) s.push({ id: it.id }); }
      else { const o = opts[it.id]; if (o != null && it.options[o] && it.options[o].price > 0) s.push({ id: it.id, opt: o }); }
    }
    return s;
  }, [adds, opts]);

  const { total, deposit, days, lines } = useMemo(() => computePlan(selection), [selection]);

  // One payment now = signed-off original balance + the two completed items + any new-works deposit.
  const payNowTotal = SIGNED_OFF_BALANCE + completed.remaining + deposit;

  async function startCheckout() {
    if (booking) return;
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
        <section className="mt-5 rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5 sm:p-6">
          <h1 className="text-[22px] sm:text-[27px] leading-[1.15] font-bold tracking-tight text-balance">Everything so far — and your choices for what’s next.</h1>
          <div className="flex items-center gap-3 mt-3">
            <img src={aliciaPhoto} alt="Alicia" className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow flex-none" />
            <p className="text-[#5A6474] text-sm">30 Sidney Road, Beeston NG9 1AN<br />prepared for <span className="font-semibold text-[#1B2A4A]">Alicia</span></p>
          </div>
          <p className="text-[15.5px] sm:text-[17px] mt-4">The full picture — what’s done, what you’ve paid, where we’re up to, and any extras you could add.</p>
          <p className="text-[#5A6474] text-[14.5px] sm:text-[15px] mt-3">No pressure — nothing new starts until you say so.<br /><span className="font-semibold text-[#1B2A4A]">Courtnee — Handy Services</span></p>
        </section>

        {/* WHAT YOU'VE BOOKED — confirmation, up top */}
        <section className="mt-5 rounded-2xl border-2 shadow-sm p-5 sm:p-6" style={{ background: "#EAF4EC", borderColor: "#2F7A3D" }}>
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] px-2.5 py-1 rounded-full" style={{ background: "#2F7A3D", color: "#fff" }}>✓ Booked</span>
            <span className="text-[13px] font-semibold" style={{ color: "#2F7A3D" }}>Deposit received — thank you</span>
          </div>
          <h2 className="text-[20px] sm:text-[24px] font-bold leading-tight">The work you’ve booked in</h2>
          <p className="text-[#5A6474] text-[14.5px] sm:text-[15px] mt-1">{booked.lines.length} items confirmed — here’s everything, with what’s paid and what’s left.</p>
          <ul className="flex flex-col mt-4">
            {booked.lines.map((x) => (
              <li key={x.id} className="flex justify-between items-baseline gap-3 py-2 border-b text-[14.5px] sm:text-[15px]" style={{ borderColor: "#CFE6D4" }}>
                <span className="flex items-start gap-2">
                  <span className="font-bold mt-[1px]" style={{ color: "#2F7A3D" }}>✓</span>
                  <span>{x.title}{isComplete(x.id) && <span className="ml-2 inline-block text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full align-middle" style={{ background: "#2F7A3D", color: "#fff" }}>Complete</span>}</span>
                </span>
                <span className="font-bold tabular-nums whitespace-nowrap">{gbp(x.price)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl bg-white p-4" style={{ border: "1px solid #CFE6D4" }}>
            <div className="flex justify-between items-baseline py-1 text-[15px]"><span>Booked total</span><span className="font-bold tabular-nums">{gbp(booked.total)}</span></div>
            <div className="flex justify-between items-baseline py-1 text-[15px]"><span>Deposit paid · 15 Aug</span><span className="font-bold tabular-nums" style={{ color: "#2F7A3D" }}>−{gbp(BOOKED_DEPOSIT_PAID)}</span></div>
            <div className="flex justify-between items-baseline mt-1 pt-2 border-t-2 border-[#1B2A4A]"><span className="text-[16px] font-bold">Balance to complete</span><span className="text-[20px] font-bold tabular-nums" style={{ color: "#F5A623" }}>{gbp(bookedBalance)}</span></div>
          </div>
          <p className="text-[#5A6474] text-[13px] mt-3"><b>Two items are now finished</b> — the upstairs bathroom and the hallway ceiling. Their balance of <b>{gbp(completed.remaining)}</b> is in your payment below; the rest is due as each remaining item is completed.</p>
        </section>

        {/* PROGRESS BAR — original agreed job */}
        <div className="mt-6 mb-1 flex items-center gap-2.5 px-1">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] px-2.5 py-1 rounded-full" style={{ background: "#1B2A4A", color: "#fff" }}>Part 1</span>
          <span className="text-[16px] font-extrabold" style={{ color: "#1B2A4A" }}>Your project so far</span>
        </div>

        <div className="mt-3 rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-bold text-[16px]">Your original project</span>
            <span className="font-bold text-[18px] tabular-nums" style={{ color: "#2F7A3D" }}>Signed off ✓</span>
          </div>
          <div className="h-3.5 rounded-full overflow-hidden" style={{ background: "#EDE8DC" }} role="progressbar" aria-valuenow={PROGRESS} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all" style={{ width: `${PROGRESS}%`, background: "linear-gradient(90deg,#2F7A3D,#4F9E5B)" }} />
          </div>
          <p className="text-[#5A6474] text-[14px] mt-2.5">The work you originally agreed is <b>complete and signed off</b> — thank you. The final balance is ready to settle below. Any <b>extra work further down is separate</b>, and entirely your choice.</p>
        </div>

        <SectionLabel>The story so far</SectionLabel>
        <ol className="relative pl-9">
          <span className="absolute left-[15px] top-2 bottom-3 w-[2px] bg-[#E4DFD2]" aria-hidden />
          {STAGES.map((s) => (
            <li key={s.n} className="relative pb-6 last:pb-0">
              <span className="absolute -left-9 top-1 grid place-items-center rounded-full text-[13px] font-bold"
                style={{ width: 32, height: 32,
                  background: s.state === "done" ? "#2F7A3D" : s.state === "current" ? "#F5A623" : "#FFFFFF",
                  color: s.state === "done" || s.state === "current" ? "#FFFFFF" : s.next ? "#B4791F" : "#9AA1AC",
                  border: s.next ? "2px dashed #F5A623" : s.state === "upcoming" ? "2px solid #D8D3C6" : "none",
                  boxShadow: s.state === "current" ? "0 0 0 5px rgba(245,166,35,.22)" : "none" }} aria-hidden>
                {s.state === "done" ? "✓" : s.n}
              </span>
              <div className="rounded-xl p-4 shadow-sm"
                style={{
                  background: s.state === "current" ? "#FFF8EC" : s.next ? "#FFFDF6" : "#FFFFFF",
                  border: s.next ? "1.5px dashed #E9B44C" : "1px solid " + (s.state === "current" ? "#F3D9A6" : "#E7E2D6"),
                }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="font-bold text-[17px]">{s.title}</div>
                  {s.pay && <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full whitespace-nowrap shrink-0" style={{ background: "#EAF4EC", color: "#2F7A3D" }}>Paid</span>}
                  {s.state === "current" && <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full whitespace-nowrap shrink-0" style={{ background: "#F5A623", color: "#1B2A4A" }}>Now</span>}
                  {s.next && <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full whitespace-nowrap shrink-0" style={{ background: "#FFF1D6", color: "#B4791F", border: "1px solid #E9B44C" }}>Next ▸</span>}
                </div>
                <div className="text-[#5A6474] text-[14px] mt-0.5">{s.sub}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-1 rounded-2xl p-5" style={{ background: "#FFF8EC", border: "1px solid #F3D9A6" }}>
          <div className="font-bold text-[16px] mb-2.5">What happens next</div>
          <ul className="flex flex-col gap-2 text-[15px]">
            <li className="flex gap-2.5"><span className="font-bold" style={{ color: "#F5A623" }}>1</span><span><b>Settle</b> — the <b>£2,653</b> is signed off and ready to pay, all in one place below.</span></li>
            <li className="flex gap-2.5"><span className="font-bold" style={{ color: "#F5A623" }}>2</span><span><b>The two rooms</b> you asked about are ready to add — pay their deposit at the same time if you’d like them booked.</span></li>
            <li className="flex gap-2.5"><span className="font-bold" style={{ color: "#F5A623" }}>3</span><span><b>Anything else below</b> — separate and optional, whenever suits.</span></li>
          </ul>
        </div>

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
            <span className="text-[17px] font-bold">Signed off — ready to settle</span>
            <span className="text-[20px] font-bold tabular-nums" style={{ color: "#F5A623" }}>£2,653.00</span>
          </div>
          <p className="text-[#5A6474] text-[13.5px] mt-3">You’ve signed these works off — thank you. The balance is ready to settle now, and you can pay it in one go with anything new below. Repointing is quoted separately (below).</p>
        </div>

        <div className="rounded-2xl p-5 mt-8 border-2" style={{ background: "#EAF4EC", borderColor: "#2F7A3D" }}>
          <div className="font-extrabold text-[20px] mb-3" style={{ color: "#2F7A3D" }}>Putting it right — on us, no charge</div>
          <ul className="flex flex-col gap-3.5">
            <li className="flex gap-3 items-start text-[18px] font-bold leading-snug"><span style={{ color: "#2F7A3D" }}>✓</span><span>Your <b>curtains</b> — professionally cleaned, and <b>replaced in full</b> if they don’t come back right.</span></li>
            <li className="flex gap-3 items-start text-[18px] font-bold leading-snug"><span style={{ color: "#2F7A3D" }}>✓</span><span>A <b>full professional clean</b> of the whole house at the end.</span></li>
          </ul>
        </div>

        <div className="mt-10 mb-4 rounded-2xl p-6 text-center" style={{ background: "#1B2A4A" }}>
          <div className="text-[11px] font-extrabold uppercase tracking-[0.2em]" style={{ color: "#F5A623" }}>Part 2</div>
          <div className="text-[23px] font-extrabold text-white mt-1.5 leading-tight">Add more — still available</div>
          <p className="text-slate-300 text-[14.5px] mt-2 leading-snug">The items you <b className="text-white">haven’t booked yet</b> — add any whenever suits, skip the rest.</p>
        </div>
        <p className="rounded-xl text-[14px] p-3.5 mb-4 flex gap-2.5 items-start" style={{ background: "#FFF8EC", border: "1px solid #F3D9A6" }}>
          <span aria-hidden>✓</span>
          <span>All new wallpaper is <b>thick, textured (paintable) paper</b> — chosen to hide any imperfections in the old walls for a smooth, even finish.</span>
        </p>

        {groups.map(([label, items]) => {
          const suggested = label.startsWith("Finishing");
          return (
            <div key={label}>
              {suggested ? (
                <div className="mt-8 mb-3 rounded-xl px-4 py-3.5" style={{ background: "#EEF3FA", border: "1px solid #C3D0E6" }}>
                  <div className="text-[18px] font-extrabold tracking-tight" style={{ color: "#3B5BA5" }}>✦ Things we spotted — our suggestions</div>
                  <p className="text-[#5A6474] text-[14.5px] mt-1">Bits we noticed that’d tidy the house up — optional.</p>
                </div>
              ) : (
                <div className="text-[#5A6474] text-[12.5px] font-bold tracking-[0.14em] uppercase mt-6 mb-3 px-1">{label}</div>
              )}
              {items.map((it) => it.kind === "add"
                ? <AddCard key={it.id} title={it.title} desc={it.desc} price={it.price} callout={it.callout} suggested={suggested} on={!!adds[it.id]} onToggle={() => setAdds((s) => ({ ...s, [it.id]: !s[it.id] }))} />
                : <OptCard key={it.id} title={it.title} desc={it.desc} callout={it.callout} options={it.options} chosen={opts[it.id] ?? -1} onChoose={(i) => setOpts((s) => ({ ...s, [it.id]: i }))} />
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
          <p className="text-[#5A6474] text-[15px] mt-1">We repaired the back-room ceiling as part of putting things right. On us.</p>
        </div>
        <InfoCard title="Repointing — the two bays & above the front door — £2,450" body="Re-quoted as full sections — the whole of both bays plus the panel above the front door, so the new mortar blends and there’s no patchy colour. This replaces the smaller repointing in your original works. Tower access is included (no extra)." note="£2,450 · tower access included · confirmed on final measure · separate from your balance" />
        <InfoCard title="Kitchen damp / mould treatment" body="Priced once we’ve taken the corner unit out and seen the wall — no guesswork." note="Priced after the check above · not in your total yet" />

        <section className="mt-8 rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <h2 className="text-[21px] font-bold mb-1">Settle up — one payment</h2>
          <p className="text-[#5A6474] text-[14.5px] mb-4">Your signed-off balance and the finished items, plus a deposit on anything new you add. All in one secure card payment.</p>

          {lines.length > 0 && (
            <div className="mb-4">
              <div className="text-[#5A6474] text-[12px] font-bold tracking-[0.12em] uppercase mb-2">New works you’ve added</div>
              <ul className="flex flex-col gap-2">
                {lines.map((x) => (<li key={x.id} className="flex justify-between gap-3 text-[15px] pb-2 border-b border-[#E7E2D6]"><span>{x.title}</span><span className="font-bold tabular-nums whitespace-nowrap">{gbp(x.price)}</span></li>))}
              </ul>
              <p className="text-[#5A6474] text-[13px] mt-2">New works total {gbp(total)} · deposit {gbp(deposit)} now, the rest as it’s finished · ≈ {fmtDays(days)} on site.</p>
            </div>
          )}

          <div className="rounded-xl overflow-hidden border" style={{ borderColor: "#E7E2D6" }}>
            <div className="px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-[#5A6474]" style={{ background: "#F5F1E9" }}>What you’re paying now</div>
            <SettleRow title="Original works — signed off" sub="You’ve approved these" amt={gbp(SIGNED_OFF_BALANCE)} />
            <SettleRow title="Upstairs bathroom + hallway ceiling" sub="Now complete · balance after deposit" amt={gbp(completed.remaining)} />
            {deposit > 0 && <SettleRow title="Deposit — the new works above" sub={`30% of labour + materials · ≈ ${fmtDays(days)} on site`} amt={gbp(deposit)} />}
            <div className="px-4 py-3.5 flex justify-between items-baseline" style={{ background: "#1B2A4A" }}>
              <span className="text-white text-[16px] font-bold">Total to pay now</span>
              <span className="text-[24px] font-extrabold tabular-nums" style={{ color: "#F5A623" }}>{gbp(payNowTotal)}</span>
            </div>
          </div>

          <p className="text-[#5A6474] text-[13px] mt-3">After this, what’s left is the balance on your other booked items ({gbp(bookedBalance - completed.remaining)}){deposit > 0 ? `, plus the balance on the new works (${gbp(total - deposit)})` : ""} — each due only as the work is finished and you’re happy.</p>

          <div className="flex flex-col gap-2.5 mt-4">
            <button onClick={startCheckout} disabled={booking}
              className="h-14 rounded-2xl font-bold text-[17px] grid place-items-center disabled:opacity-50"
              style={{ background: "#F5A623", color: "#1B2A4A" }}>
              {booking ? "Starting secure payment…" : `Pay ${gbp(payNowTotal)} now`}
            </button>
            <a href="tel:+447449501762" className="h-12 rounded-2xl font-semibold text-[15px] grid place-items-center text-[#5A6474]">Prefer to talk it through? Call Courtnee</a>
          </div>
          <p className="text-[#5A6474] text-[13px] mt-4 leading-relaxed">Secure card payment. Prices are fixed and include all materials. Adding a room simply adds its deposit to the total above.</p>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-50">
        <div className="max-w-2xl mx-auto px-3">
          <div className="rounded-t-2xl bg-slate-900 text-white shadow-2xl px-4 py-3 flex items-center justify-between gap-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Pay now{deposit > 0 ? ` · incl. ${gbp(deposit)} new deposit` : ""}</div>
              <div className="text-[22px] font-bold tabular-nums" style={{ color: "#F5A623" }}>{gbp(payNowTotal)}</div>
            </div>
            <button onClick={startCheckout} disabled={booking} className="rounded-xl font-bold text-[15px] px-4 py-3 whitespace-nowrap disabled:opacity-60" style={{ background: "#F5A623", color: "#1B2A4A" }}>
              {booking ? "Starting…" : "Pay now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettleRow({ title, sub, amt }: { title: string; sub: string; amt: string }) {
  return (
    <div className="px-4 py-3 flex justify-between items-start gap-3 border-b border-[#E7E2D6]">
      <div>
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="text-[#5A6474] text-[13px] mt-0.5">{sub}</div>
      </div>
      <span className="text-[17px] font-bold tabular-nums whitespace-nowrap" style={{ color: "#1B2A4A" }}>{amt}</span>
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

function Callout({ callout }: { callout: PlanCallout }) {
  if (callout.kind === "goodwill") {
    return (
      <div className="mt-3 rounded-xl p-3.5 border-2" style={{ background: "#EAF4EC", borderColor: "#2F7A3D" }}>
        <p className="text-[15px] font-bold leading-snug" style={{ color: "#1B2A4A" }}>{callout.text}</p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-xl p-3.5 flex gap-2.5 items-start" style={{ background: "#EEF3FA", border: "1px solid #C3D0E6" }}>
      <span className="text-[18px] leading-none mt-0.5" aria-hidden>💡</span>
      <p className="text-[#3B4A63] text-[14px] leading-snug">{callout.text}</p>
    </div>
  );
}

function AddCard({ title, desc, price, on, onToggle, suggested, callout, accepted }: { title: string; desc: string; price: number; on: boolean; onToggle: () => void; suggested?: boolean; callout?: PlanCallout; accepted?: boolean }) {
  const restBg = suggested ? "#EEF3FA" : "#FFFFFF";
  const restBorder = suggested ? "#C3D0E6" : "#E7E2D6";
  const active = on || accepted;
  return (
    <div className="rounded-2xl border shadow-sm p-4 sm:p-[18px] mb-3 sm:mb-3.5 transition-colors" style={{ background: active ? "#EAF4EC" : restBg, borderColor: active ? "#BFE0C6" : restBorder }}>
      <h3 className="text-[17px] sm:text-[19px] font-bold leading-snug">{title}</h3>
      <p className="text-[#5A6474] text-[14.5px] sm:text-[15.5px] mt-1">{desc}</p>
      {callout && <Callout callout={callout} />}
      <div className="flex items-center justify-between gap-3 mt-3.5">
        <span className="text-[19px] sm:text-[20px] font-bold tabular-nums">{gbp(price)}</span>
        {accepted ? (
          <span className="min-h-12 px-5 rounded-full font-bold text-[15.5px] inline-flex items-center gap-2" style={{ background: "#2F7A3D", color: "#fff" }}>✓ Accepted</span>
        ) : (
          <button onClick={onToggle} aria-pressed={on} className="min-h-12 px-5 rounded-full font-bold text-[15.5px] border-2 inline-flex items-center gap-2 transition-colors"
            style={on ? { background: "#2F7A3D", borderColor: "#2F7A3D", color: "#fff" } : { background: "transparent", borderColor: "#1B2A4A", color: "#1B2A4A" }}>
            {on ? "✓ Added" : "＋ Add"}
          </button>
        )}
      </div>
    </div>
  );
}

function OptCard({ title, desc, options, chosen, onChoose, callout }: { title: string; desc: string; options: PlanOption[]; chosen: number; onChoose: (i: number) => void; callout?: PlanCallout }) {
  const on = chosen >= 0 && options[chosen] && options[chosen].price > 0;
  return (
    <div className="rounded-2xl border shadow-sm p-4 sm:p-[18px] mb-3 sm:mb-3.5 transition-colors" style={{ background: on ? "#EAF4EC" : "#FFFFFF", borderColor: on ? "#BFE0C6" : "#E7E2D6" }}>
      <h3 className="text-[17px] sm:text-[19px] font-bold leading-snug">{title}</h3>
      <p className="text-[#5A6474] text-[14.5px] sm:text-[15.5px] mt-1">{desc}</p>
      {callout && <Callout callout={callout} />}
      <div className="flex flex-col gap-2.5 mt-3.5">
        {options.map((o, i) => {
          const active = chosen === i;
          return (
            <button key={i} onClick={() => onChoose(i)} aria-pressed={active}
              className="min-h-[52px] px-4 rounded-xl border-2 text-left flex items-center justify-between gap-3 text-[15px] sm:text-[15.5px] transition-colors"
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
