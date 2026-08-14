import { useMemo, useState } from "react";
import handyLogo from "@/assets/handy-logo-transparent.png";

/**
 * Public customer project page — the full story + additional-works choices.
 * Bespoke for the Sidney Road project. Public, no auth — the slug is the capability.
 * Route: /plan/:slug
 */

// ---- Timeline stages ------------------------------------------------------
type StageState = "done" | "current" | "upcoming";
const STAGES: { n: number; title: string; sub: string; state: StageState; pay?: boolean }[] = [
  { n: 1, title: "Quote agreed", sub: "Original works · £4,281", state: "done" },
  { n: 2, title: "Deposit paid", sub: "£1,760", state: "done", pay: true },
  { n: 3, title: "Works underway", sub: "Extra repairs & new lighting · +£910", state: "done" },
  { n: 4, title: "Milestone paid", sub: "£1,500", state: "done", pay: true },
  { n: 5, title: "Finishing stage", sub: "You are here", state: "current" },
  { n: 6, title: "Completion", sub: "Balance £3,146 — when you’re happy", state: "upcoming" },
];

const DONE = [
  "Internal wall cracks repaired",
  "Two new carpets fitted",
  "Re-plastering under the bay windows",
  "Front fascia & masonry painted",
  "Wall & stair repairs, splashback removed & skimmed",
  "New wall light, two-gang switch & new pendant feed fitted",
  "Lining paper to the last room",
];

const TODO = [
  { t: "Final paint finishing — caulking, touch-ups and tidy" },
  { t: "The last few light fittings" },
  { t: "Shed & fence — final coats" },
  { t: "Front repointing — being re-quoted as larger sections for a proper colour match" },
  { t: "Curtains — professionally cleaned, replaced if needed", ours: true },
  { t: "Full professional clean at the end", ours: true },
];

// ---- Additional-works choices --------------------------------------------
type Opt = { label: string; price: number };
type Item =
  | { id: string; kind: "add"; title: string; desc: string; price: number }
  | { id: string; kind: "opt"; title: string; desc: string; opts: Opt[] };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Upstairs",
    items: [
      { id: "bay-walls", kind: "opt", title: "Front bay bedroom — walls", desc: "Take down the old mirror and light, make good, and re-paper. The room’s already painted; this sorts the wallpaper. Your new carpet is fully protected throughout.", opts: [{ label: "One wall re-papered", price: 295 }, { label: "Whole room re-papered — fixes the mismatch", price: 750 }, { label: "Not now", price: 0 }] },
      { id: "bay-ceiling", kind: "add", title: "Front bay bedroom — ceiling repair", desc: "Repair the missing woodchip section where the old strip-light was and fill the hole in the plaster, then strip, re-paper and paint.", price: 320 },
      { id: "small-room", kind: "opt", title: "Small front room — one wall", desc: "Strip the one wall back and finish it. The ceiling’s fine. Choose the finish once the paper’s off:", opts: [{ label: "Lining paper", price: 260 }, { label: "Skim (smoother finish)", price: 330 }, { label: "Not now", price: 0 }] },
      { id: "hall-ceiling", kind: "add", title: "Upstairs hallway ceiling", desc: "Strip and re-finish the hallway ceiling — worked safely on a proper platform over the staircase.", price: 650 },
      { id: "top-stairs", kind: "add", title: "Top of the stairs — wall", desc: "Plaster the wall on the right as you reach the top of the stairs, then paper it.", price: 320 },
      { id: "up-bathroom", kind: "add", title: "Upstairs bathroom", desc: "Re-grout, fill the cracks, repair the ceiling and walls, then decorate throughout.", price: 870 },
      { id: "bath-cupboard", kind: "add", title: "Bathroom cupboard", desc: "Prep, prime and gloss the cupboard front and shelves.", price: 150 },
      { id: "bay-sections", kind: "add", title: "The two re-plastered bay sections", desc: "Paper over the two freshly-plastered sections under the bay windows to finish them off.", price: 200 },
    ],
  },
  {
    label: "Downstairs",
    items: [
      { id: "entrance-wall", kind: "add", title: "Entrance wall — as you come in", desc: "Skim the wall on the right as you come through the front door, and make good.", price: 350 },
      { id: "halls-stairs", kind: "add", title: "Halls & stairs", desc: "The whole downstairs hallway, the landing and the stairwell — fresh lining paper and decorated so it all ties together.", price: 1450 },
      { id: "back-ceiling", kind: "add", title: "Back room ceiling", desc: "Repair the downstairs back-room ceiling.", price: 280 },
      { id: "kitchen-paint", kind: "add", title: "Kitchen — cracks & repaint", desc: "Fill all the cracks and repaint the kitchen ceiling and walls.", price: 460 },
      { id: "kitchen-grout", kind: "add", title: "Kitchen — re-grout tiles", desc: "Rake out and re-grout the kitchen tiling for a clean, fresh finish.", price: 220 },
      { id: "kitchen-check", kind: "add", title: "Kitchen — check the damp behind the corner unit", desc: "We won’t guess at the mould. We’ll take out the corner unit to see the actual wall, find the real cause, then price the fix properly — so you never pay for work you don’t need.", price: 150 },
    ],
  },
  {
    label: "Doors, banister & archway",
    items: [
      { id: "doors", kind: "add", title: "5 internal doors", desc: "Prep, prime and paint all five doors.", price: 360 },
      { id: "banister", kind: "add", title: "Staircase banister", desc: "Sand, prime and gloss the banister.", price: 190 },
      { id: "archway", kind: "add", title: "Archway", desc: "Re-form the archway above the door.", price: 220 },
      { id: "waste", kind: "add", title: "Waste removal", desc: "Clear away all the strip-out and plaster waste from the works above.", price: 250 },
    ],
  },
];

const gbp = (n: number) => "£" + n.toLocaleString("en-GB");
const WA = "447449501762";

export default function PlanPage() {
  // selection state: for "add" -> boolean; for "opt" -> chosen index (or -1)
  const [adds, setAdds] = useState<Record<string, boolean>>({});
  const [opts, setOpts] = useState<Record<string, number>>({});

  const { total, picks } = useMemo(() => {
    let total = 0;
    const picks: { t: string; p: number }[] = [];
    for (const g of GROUPS) {
      for (const it of g.items) {
        if (it.kind === "add") {
          if (adds[it.id]) { total += it.price; picks.push({ t: it.title, p: it.price }); }
        } else {
          const idx = opts[it.id];
          if (idx != null && it.opts[idx] && it.opts[idx].price > 0) {
            total += it.opts[idx].price;
            picks.push({ t: it.title + " — " + it.opts[idx].label, p: it.opts[idx].price });
          }
        }
      }
    }
    return { total, picks };
  }, [adds, opts]);

  const waHref = useMemo(() => {
    const lines = ["Hi Handy Services — here are the extra works I'd like for 30 Sidney Road:", ""];
    picks.forEach((x) => lines.push("• " + x.t + " — " + gbp(x.p)));
    lines.push("", "Extras total: " + gbp(total), "(Sent from my online project plan)");
    return `https://wa.me/${WA}?text=` + encodeURIComponent(lines.join("\n"));
  }, [picks, total]);

  return (
    <div className="min-h-screen font-sans pb-28" style={{ background: "#FBF8F3", color: "#1B2A4A" }}>
      {/* Header — matches the public site */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center gap-3">
          <img src={handyLogo} alt="Handy Services" className="w-9 h-9 object-contain" />
          <div className="leading-none">
            <div className="text-white font-extrabold tracking-tight text-lg">
              Handy<span style={{ color: "#F5A623" }}>Services</span>
            </div>
            <div className="text-slate-400 text-[10px] font-semibold tracking-[0.16em] uppercase mt-1">Your project</div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4">
        {/* Intro */}
        <section className="mt-5 rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-6">
          <h1 className="text-[27px] leading-tight font-bold tracking-tight text-balance">
            Everything so far — and your choices for what’s next.
          </h1>
          <p className="text-[#5A6474] text-sm mt-2">30 Sidney Road, Beeston NG9 1AN · prepared for Alicia</p>
          <p className="text-[17px] mt-4">
            This is the full picture: what we agreed, what’s been done, what you’ve paid, where we are now — and then the
            extra work the house could have, entirely your choice.
          </p>
          <p className="text-[#5A6474] text-[15px] mt-3">
            No pressure on any of it, and nothing new starts until you say so.<br />
            <span className="font-semibold text-[#1B2A4A]">Courtnee — Handy Services</span>
          </p>
        </section>

        {/* FLOWCHART TIMELINE */}
        <SectionLabel>The story so far</SectionLabel>
        <ol className="relative pl-9">
          <span className="absolute left-[15px] top-2 bottom-3 w-[2px] bg-[#E4DFD2]" aria-hidden />
          {STAGES.map((s) => (
            <li key={s.n} className="relative pb-6 last:pb-0">
              <span
                className="absolute -left-9 top-1 grid place-items-center rounded-full text-[13px] font-bold"
                style={{
                  width: 32, height: 32,
                  background: s.state === "done" ? "#2F7A3D" : s.state === "current" ? "#F5A623" : "#FFFFFF",
                  color: s.state === "upcoming" ? "#9AA1AC" : "#FFFFFF",
                  border: s.state === "upcoming" ? "2px solid #D8D3C6" : "none",
                  boxShadow: s.state === "current" ? "0 0 0 5px rgba(245,166,35,.22)" : "none",
                }}
                aria-hidden
              >
                {s.state === "done" ? "✓" : s.n}
              </span>
              <div
                className="rounded-xl border p-4 shadow-sm"
                style={{
                  background: s.state === "current" ? "#FFF8EC" : "#FFFFFF",
                  borderColor: s.state === "current" ? "#F3D9A6" : "#E7E2D6",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-[17px]">{s.title}</div>
                  {s.pay && (
                    <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full"
                      style={{ background: "#EAF4EC", color: "#2F7A3D" }}>
                      Paid
                    </span>
                  )}
                  {s.state === "current" && (
                    <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full"
                      style={{ background: "#F5A623", color: "#1B2A4A" }}>
                      Now
                    </span>
                  )}
                </div>
                <div className="text-[#5A6474] text-[14px] mt-0.5">{s.sub}</div>
              </div>
            </li>
          ))}
        </ol>

        {/* DONE */}
        <SectionLabel muted>What’s done</SectionLabel>
        <div className="rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <ul className="flex flex-col gap-2.5">
            {DONE.map((d) => (
              <li key={d} className="flex gap-3 items-start text-[16px]">
                <span className="text-[#2F7A3D] font-bold mt-[1px]">✓</span><span>{d}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* PAYMENTS */}
        <SectionLabel muted>Your payments</SectionLabel>
        <div className="rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <PayRow label="Deposit · 14 Jul" value="£1,760.00" paid />
          <PayRow label="Milestone · 31 Jul" value="£1,500.00" paid />
          <PayRow label="Paid so far" value="£3,260.00" />
          <div className="flex justify-between items-baseline mt-2 pt-3 border-t-2 border-[#1B2A4A]">
            <span className="text-[17px] font-bold">Balance on completion</span>
            <span className="text-[20px] font-bold tabular-nums" style={{ color: "#F5A623" }}>£3,146.00</span>
          </div>
          <p className="text-[#5A6474] text-[13.5px] mt-3">
            The balance is due only when the agreed works are finished and you’re happy — not before.
          </p>
        </div>

        {/* STILL TO FINISH */}
        <SectionLabel muted>Still to finish — included in the above</SectionLabel>
        <div className="rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <ul className="flex flex-col gap-2.5">
            {TODO.map((d) => (
              <li key={d.t} className="flex gap-3 items-start text-[16px]">
                <span className="text-[#F5A623] font-bold mt-[2px] text-[10px]">●</span>
                <span>{d.t}{d.ours && <b className="text-[#2F7A3D]"> (our cost)</b>}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* CHOICES */}
        <SectionLabel>Your choices — additional work</SectionLabel>
        <p className="rounded-xl bg-[#F5F1E9] text-[#5A6474] text-[15px] p-4 mb-4">
          These are <b>extra</b> and completely separate from everything above. Add anything you’d like, skip the rest —
          your total builds as you go, and nothing is booked until you confirm.
        </p>

        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="text-[#5A6474] text-[12.5px] font-bold tracking-[0.14em] uppercase mt-6 mb-3 px-1">{g.label}</div>
            {g.items.map((it) =>
              it.kind === "add" ? (
                <AddCard key={it.id} title={it.title} desc={it.desc} price={it.price}
                  on={!!adds[it.id]} onToggle={() => setAdds((s) => ({ ...s, [it.id]: !s[it.id] }))} />
              ) : (
                <OptCard key={it.id} title={it.title} desc={it.desc} opts={it.opts}
                  chosen={opts[it.id] ?? -1} onChoose={(i) => setOpts((s) => ({ ...s, [it.id]: i }))} />
              )
            )}
          </div>
        ))}

        {/* included / info */}
        <div className="rounded-2xl p-5 mb-3.5 border" style={{ background: "#EAF4EC", borderColor: "#BFE0C6" }}>
          <div className="font-bold text-[17px]" style={{ color: "#2F7A3D" }}>✓ Protection & full clean — included, no charge</div>
          <p className="text-[#5A6474] text-[15px] mt-1">Proper dust-sheeting, floor protection over your new carpets, rooms sealed off, a tidy-up every day, and a full clean at the end. On us.</p>
        </div>
        <InfoCard title="Repointing — the two bays & above the front door"
          body="Done as full sections so the new mortar blends and there’s no patchy colour. We’ll measure and confirm the price with you first."
          note="Guide only: £1,800–£2,950 · not in your total yet" />
        <InfoCard title="Kitchen damp / mould treatment"
          body="Priced once we’ve taken the corner unit out and seen the wall — no guesswork."
          note="Priced after the check above · not in your total yet" />

        {/* SUMMARY */}
        <section className="mt-6 rounded-2xl bg-white border border-[#E7E2D6] shadow-sm p-5">
          <h2 className="text-[21px] font-bold mb-3">Your chosen extras</h2>
          {picks.length === 0 ? (
            <p className="text-[#5A6474] text-[15px]">Nothing chosen yet — tap <b>Add</b> on anything above to start.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {picks.map((x, i) => (
                <li key={i} className="flex justify-between gap-3 text-[15px] pb-2 border-b border-[#E7E2D6]">
                  <span>{x.t}</span><span className="font-bold tabular-nums whitespace-nowrap">{gbp(x.p)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between items-baseline mt-3.5 pt-3.5 border-t-2 border-[#1B2A4A]">
            <span className="text-[17px] font-bold">Extras total</span>
            <span className="text-[26px] font-bold tabular-nums" style={{ color: "#F5A623" }}>{gbp(total)}</span>
          </div>
          <div className="flex flex-col gap-2.5 mt-4">
            <a href={waHref} className="h-14 rounded-2xl font-bold text-[17px] grid place-items-center"
              style={{ background: "#F5A623", color: "#1B2A4A" }}>Send my choices to Handy</a>
            <a href="tel:+447449501762" className="h-14 rounded-2xl font-bold text-[17px] grid place-items-center border-2 border-[#E7E2D6]">
              Prefer to talk it through? Call Courtnee
            </a>
          </div>
          <p className="text-[#5A6474] text-[13px] mt-4 leading-relaxed">
            Prices are fixed and include all materials. This is on top of your existing project — not part of the £3,146 balance.
            Nothing is booked until you confirm and we agree a start date together.
          </p>
        </section>
      </main>

      {/* sticky total bar */}
      {total > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50">
          <div className="max-w-2xl mx-auto px-3">
            <div className="mb-0 rounded-t-2xl bg-slate-900 text-white shadow-2xl px-4 py-3 flex items-center justify-between gap-3"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Extras so far</div>
                <div className="text-[22px] font-bold tabular-nums" style={{ color: "#F5A623" }}>{gbp(total)}</div>
              </div>
              <a href={waHref} className="rounded-xl font-bold text-[15px] px-4 py-3 whitespace-nowrap"
                style={{ background: "#F5A623", color: "#1B2A4A" }}>Send choices</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div className="text-[12.5px] font-bold tracking-[0.15em] uppercase mt-8 mb-3.5 px-1"
      style={{ color: muted ? "#5A6474" : "#F5A623" }}>{children}</div>
  );
}

function PayRow({ label, value, paid }: { label: string; value: string; paid?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-2.5 border-b border-[#E7E2D6] text-[16px]">
      <span>{label}</span>
      <span className="font-bold tabular-nums whitespace-nowrap" style={{ color: paid ? "#2F7A3D" : undefined }}>{value}</span>
    </div>
  );
}

function AddCard({ title, desc, price, on, onToggle }: { title: string; desc: string; price: number; on: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl border shadow-sm p-[18px] mb-3.5 transition-colors"
      style={{ background: on ? "#EAF4EC" : "#FFFFFF", borderColor: on ? "#BFE0C6" : "#E7E2D6" }}>
      <h3 className="text-[19px] font-bold leading-snug">{title}</h3>
      <p className="text-[#5A6474] text-[15.5px] mt-1">{desc}</p>
      <div className="flex items-center justify-between gap-3.5 mt-3.5">
        <span className="text-[20px] font-bold tabular-nums">{gbp(price)}</span>
        <button onClick={onToggle} aria-pressed={on}
          className="min-h-12 px-5 rounded-full font-bold text-[15.5px] border-2 inline-flex items-center gap-2 transition-colors"
          style={on
            ? { background: "#2F7A3D", borderColor: "#2F7A3D", color: "#fff" }
            : { background: "transparent", borderColor: "#1B2A4A", color: "#1B2A4A" }}>
          {on ? "✓ Added" : "＋ Add"}
        </button>
      </div>
    </div>
  );
}

function OptCard({ title, desc, opts, chosen, onChoose }: { title: string; desc: string; opts: Opt[]; chosen: number; onChoose: (i: number) => void }) {
  const on = chosen >= 0 && opts[chosen] && opts[chosen].price > 0;
  return (
    <div className="rounded-2xl border shadow-sm p-[18px] mb-3.5 transition-colors"
      style={{ background: on ? "#EAF4EC" : "#FFFFFF", borderColor: on ? "#BFE0C6" : "#E7E2D6" }}>
      <h3 className="text-[19px] font-bold leading-snug">{title}</h3>
      <p className="text-[#5A6474] text-[15.5px] mt-1">{desc}</p>
      <div className="flex flex-col gap-2.5 mt-3.5">
        {opts.map((o, i) => {
          const active = chosen === i;
          return (
            <button key={i} onClick={() => onChoose(i)} aria-pressed={active}
              className="min-h-[52px] px-4 rounded-xl border-2 text-left flex items-center justify-between gap-3 text-[15.5px] transition-colors"
              style={active
                ? { background: "#EAF4EC", borderColor: "#2F7A3D" }
                : { background: "#F5F1E9", borderColor: "#E7E2D6" }}>
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
