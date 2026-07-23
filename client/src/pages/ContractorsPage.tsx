import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ChevronDown, MapPin, Minus, Phone, Plus, Star } from 'lucide-react';

// ─── /contractors — recruiting landing, Solo ↔ Crew pill ────────────────────
// Mobile-first (~90% of traffic). Universal hero (crew image above headline,
// no ticker); the pill sits at the fork where content actually differs.
// Money-first calculator card. Pinned modern phone showing THEIR job offer
// (demo dispatch, excluded from escalation + analytics).
// Old URLs redirect here: /empty-days → ?type=solo, /crews → ?type=crew.

// Hand-set roster cap — mirrors the REAL supply cap (locked: max 2–3 solos +
// 1 team until sold volume grows). Edit as slots fill/open. Never show a
// number that isn't true — fake scarcity is Aspect territory.
const SLOTS = {
  solo: { open: 2, total: 3 },
  crew: { open: 1, total: 1 },
} as const;

// The gate: the CTA is an application, not a chat. The prefill asks for their
// details up front so Ben replies as a reviewer, not a salesman.
const APPLY_MSG = {
  solo: 'Hi Ben — applying for a solo slot.\nTrade:\nArea / postcode:\nPublic liability insurance: yes / no\nFree days this week:',
  crew: "Hi Ben — applying for the crew slot.\nCrew size:\nTrades covered:\nPL + employers' liability: yes / no\nA recent comparable job:",
} as const;
const WAITLIST_MSG = {
  solo: 'Hi Ben — solo roster is full, add me to the waitlist.\nTrade:\nArea / postcode:',
  crew: 'Hi Ben — the crew slot is taken, add my crew to the waitlist.\nCrew size:\nTrades covered:',
} as const;
const waLink = (msg: string) => 'https://wa.me/447449501762?text=' + encodeURIComponent(msg);
const DEMO_OFFER_URL = '/dispatch-link/xTCTrbw7yemBYI3RovIseDK2zIw';

// Phone mock geometry: render the offer at real phone width, scaled to fit.
const PHONE_CONTENT_W = 375;
const PHONE_VIEW_W = 290;
const PHONE_VIEW_H = 560;
const PHONE_SCALE = PHONE_VIEW_W / PHONE_CONTENT_W;

interface Tier {
  key: 'general' | 'skilled' | 'specialist' | 'outdoor';
  label: string; share: number; floorHourly: number; visitMin: number;
}
const TIERS: Tier[] = [
  { key: 'general', label: 'General handyman', share: 45, floorHourly: 18, visitMin: 40 },
  { key: 'skilled', label: 'Carpentry & tiling', share: 50, floorHourly: 22, visitMin: 50 },
  { key: 'specialist', label: 'Electrics & plumbing', share: 55, floorHourly: 28, visitMin: 60 },
  { key: 'outdoor', label: 'Garden & outdoor', share: 45, floorHourly: 16, visitMin: 40 },
];
const WORKING_WEEKS = 46;

// Job Pay Checker presets — every figure is a REAL PAID JOB run through the
// live pay engine (scripts/_job-pay-presets.ts · 126 paid quotes · Jul 2026).
// Regenerate after any tier/pricing move. rule = which pay rule won:
// pay = MAX(share% × labour, floor £/hr × hours, visit minimum).
type JobSize = 'quick' | 'half' | 'full';
interface JobPreset { pay: number; hours: string; example: string; rule: 'share' | 'floor' | 'visit' }
const JOB_PRESETS: Record<Tier['key'], Record<JobSize, JobPreset>> = {
  general: {
    quick: { pay: 40, hours: '~1 hr', example: 'Fit a curtain pole', rule: 'visit' },
    half: { pay: 54, hours: '~3 hrs', example: 'Fix shelving brackets to a wall', rule: 'floor' },
    full: { pay: 144, hours: '~8 hrs', example: 'Repoint a house frontage', rule: 'floor' },
  },
  skilled: {
    quick: { pay: 50, hours: '~1 hr', example: 'Adjust a door lock mechanism', rule: 'visit' },
    half: { pay: 78, hours: '~3 hrs', example: 'Patch a hole in a kitchen floor', rule: 'share' },
    full: { pay: 176, hours: '~8 hrs', example: 'Supply & fit a loft hatch and ladder', rule: 'floor' },
  },
  specialist: {
    quick: { pay: 60, hours: '~1 hr', example: 'Supply & fit a new tap cartridge', rule: 'visit' },
    half: { pay: 84, hours: '~3 hrs', example: 'Wall socket behind the TV, cables hidden', rule: 'floor' },
    full: { pay: 224, hours: '~8 hrs', example: 'Supply & fit bathroom shower panelling', rule: 'floor' },
  },
  outdoor: {
    quick: { pay: 40, hours: '~1.5 hrs', example: 'Replace a rotten garden sleeper', rule: 'visit' },
    half: { pay: 64, hours: '~4 hrs', example: 'Backfill a border with topsoil', rule: 'floor' },
    full: { pay: 128, hours: '~8 hrs', example: 'Build a concrete shed base', rule: 'floor' },
  },
};
const SIZE_LABELS: Record<JobSize, string> = { quick: 'Quick visit', half: 'Half day', full: 'Full day' };
const easeOutExpo = [0.16, 1, 0.3, 1] as const;

const RECENT_JOBS = [
  { pay: '£2,221', title: 'Painting, repairs, plastering', area: 'Beeston NG9', size: '10 tasks · crew block' },
  { pay: '£772', title: 'Electrics, carpentry, flat pack', area: 'Lowdham NG14', size: '9 tasks · media wall' },
  { pay: '£320', title: 'Herringbone flooring', area: 'Derby DE73', size: 'solo · 2 rooms' },
];

const MIND_READS = [
  { pain: 'Some weeks you turn work down. Others you beg for it.', fix: 'We fill the famine.' },
  { pain: 'Half your week is quoting, invoicing, chasing.', fix: 'You never write a quote again.' },
  { pain: '£200 a month to Checkatrade. For ghosts.', fix: 'We pay you. Never the other way round.' },
];

const FAQS = [
  { q: 'Why is the roster capped?', a: "We only take on trades against work we've already sold — that's the only way “we fill your days” stays true. When slots are full we waitlist, and open the next slot as sold volume grows." },
  { q: "What's the paid trial?", a: 'Your first job, at full rate. We check it against the photo standard like every job after it. Pass and the slot is yours; if not, you still get paid and we part as friends.' },
  { q: 'Is it a day rate?', a: "No — every job is priced individually and you see the money before you accept. Stack jobs to fill a day; the checker above shows what real jobs actually paid. Whatever the job, you never earn under your tier's hourly floor or per-visit minimum." },
  { q: 'Can I still take my own customers?', a: 'Yes — and legally you must be able to. We fill your spare days, not your working life.' },
  { q: 'Do I compete for jobs?', a: 'No bidding. A job that fits your area and skills is offered to you. Take it or leave it.' },
  { q: 'Why take your rate when I charge more solo?', a: 'Solo £60/hr × 4 billable hours = £240, and the quoting, driving and chasing pay £0. Our jobs land priced, stack into full days, and never pay under your hourly floor or visit minimum.' },
  { q: 'What if a customer complains?', a: 'We handle every customer conversation. You fix what needs fixing, to the photo standard. Never alone.' },
  { q: 'What about IR35 / tax?', a: "Genuine B2B subcontract: your clients, your methods, your tools, you invoice us. Ask your accountant — we'll walk them through it." },
  { q: 'Who checks my crew?', a: "You do — you're the boss. We check you: references, public liability, employers' liability for crews." },
];

function MoneyTicker({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (reduced || from === value) { setDisplay(value); return; }
    const t0 = performance.now();
    const dur = 900;
    const easeOut = (t: number) => 1 - Math.pow(2, -10 * t);
    let raf = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - t0) / dur);
      setDisplay(p < 1 ? Math.round(from + (value - from) * easeOut(p)) : value);
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    // rAF is throttled to zero in hidden/backgrounded tabs — never let the
    // displayed number depend on the animation finishing.
    const snap = setTimeout(() => setDisplay(value), dur + 150);
    return () => { cancelAnimationFrame(raf); clearTimeout(snap); };
  }, [value, reduced]);
  return <span className={className}>£{display.toLocaleString('en-GB')}</span>;
}

type Mode = 'solo' | 'crew';

export default function ContractorsPage() {
  const initialMode: Mode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('type') === 'crew'
      ? 'crew' : 'solo';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [tier, setTier] = useState<Tier>(TIERS[0]);
  const [jobSize, setJobSize] = useState<JobSize>('half');
  const [jobsPerWeek, setJobsPerWeek] = useState(4);
  const [showSticky, setShowSticky] = useState(false);

  const phoneWrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    document.title = 'Trades: we fill your diary | Handy Services';
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setShowSticky(window.scrollY > 560);
      const wrap = phoneWrapRef.current, frame = iframeRef.current;
      if (!wrap || !frame) return;
      const rect = wrap.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      if (scrollable <= 0) return;
      const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
      try {
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        if (doc && win) {
          const max = doc.documentElement.scrollHeight - frame.clientHeight;
          if (max > 0) win.scrollTo(0, progress * max);
        }
      } catch { /* same-origin, but never let it throw */ }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const preset = JOB_PRESETS[tier.key][jobSize];
  const weekPay = preset.pay * jobsPerWeek;
  const yearPay = weekPay * WORKING_WEEKS;
  const ruleLine =
    preset.rule === 'visit' ? `The £${tier.visitMin} visit minimum won — small jobs never pay small.`
    : preset.rule === 'floor' ? `The £${tier.floorHourly}/hr floor won — it beat the ${tier.share}% share.`
    : `The ${tier.share}% labour share won — it beat the £${tier.floorHourly}/hr floor.`;

  const slots = SLOTS[mode];
  const rosterFull = slots.open === 0;
  const applyHref = waLink(rosterFull ? WAITLIST_MSG[mode] : APPLY_MSG[mode]);
  const applyLabel = rosterFull
    ? 'Join the waitlist'
    : mode === 'solo' ? 'Apply for a solo slot' : 'Apply for the crew slot';
  const slotWord = slots.total === 1 ? 'slot' : 'slots';
  const slotsLine = rosterFull
    ? `${mode === 'solo' ? 'Solo' : 'Crew'} roster full — waitlist open`
    : `${slots.open} of ${slots.total} ${mode} ${slotWord} open`;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 font-medium antialiased">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="w-full bg-slate-950 px-4 lg:px-8">
        <div className="max-w-5xl mx-auto py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/logo.png" alt="" className="w-8 h-8 rounded-full shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            <span className="text-white font-extrabold whitespace-nowrap">Handy<span className="text-amber-400">Services</span></span>
            <span className="hidden sm:flex items-center gap-1 text-white/60 text-xs font-semibold ml-1">
              {[...Array(5)].map((_, i) => <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />)}
              4.9 · 300+ jobs
            </span>
          </div>
          <a
            href={applyHref} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 text-slate-900 font-extrabold text-sm px-4 py-2 hover:bg-amber-300 transition-colors shrink-0"
          >
            Apply <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </nav>

      {/* ── Hero: image first, one universal headline, no clutter ──────── */}
      <section className="bg-slate-950 text-white px-4 pt-4 pb-8 sm:pt-8 sm:pb-12">
        <div className="max-w-3xl mx-auto">
          <img
            src="/assets/quote-images/contractor-crew.webp"
            alt="A two-man crew mid-renovation: one cutting in a ceiling, one fitting skirting"
            className="rounded-3xl w-full h-52 sm:h-80 object-cover shadow-2xl shadow-black/40"
            width={1200} height={896} loading="eager" {...{ fetchpriority: 'high' }}
          />
          <h1 className="mt-5 font-extrabold leading-[1.06] text-[clamp(2rem,7vw,3.6rem)]">
            An empty diary still<br />costs you <span className="text-rose-400">money.</span>
          </h1>
          <p className="mt-3 text-slate-300 text-lg font-normal">
            Solo or crew — we fill it. Priced. Paid. Yours to decline.
          </p>
          <div className="mt-4 inline-flex items-center gap-2.5 rounded-full bg-slate-800/90 ring-1 ring-amber-400/40 pl-3.5 pr-4 py-2.5 shadow-lg shadow-black/30">
            <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-[13px] font-bold text-slate-200">
              Nottingham — <span className="whitespace-nowrap"><span className="text-amber-400">{SLOTS.solo.open} of {SLOTS.solo.total}</span> solo spots</span> · <span className="whitespace-nowrap"><span className="text-amber-400">{SLOTS.crew.open}</span> crew spot left</span>
            </p>
          </div>
        </div>
      </section>

      {/* ── The fork: pill where the content actually differs ───────────── */}
      <section className="bg-slate-950 px-4 pb-10 sm:pb-14">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-center">
            <div className="inline-flex rounded-full bg-slate-800 p-1">
              {([['solo', 'I work solo'], ['crew', 'I run a crew']] as [Mode, string][]).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-6 py-3 rounded-full text-[15px] font-bold transition-colors ${
                    mode === m ? 'bg-amber-400 text-slate-900' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'solo' ? (
            /* Job Pay Checker: real paid jobs, run through the real pay engine */
            <div className="mt-6 rounded-3xl bg-slate-900 p-5 sm:p-8 shadow-2xl shadow-black/50">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">What a real job pays you</p>
              <MoneyTicker
                value={preset.pay}
                className="block mt-1 font-extrabold text-amber-400 tabular-nums leading-none text-[clamp(3.2rem,13vw,5rem)]"
              />
              <p className="mt-2 text-slate-300 font-semibold text-[15px] leading-snug">
                "{preset.example}" <span className="text-slate-500 whitespace-nowrap">· {preset.hours}</span>
              </p>
              <p className="mt-1.5 text-[13px] font-bold text-[#7DB00E]">{ruleLine}</p>

              <div className="mt-6 grid grid-cols-2 gap-2">
                {TIERS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTier(t)}
                    className={`rounded-xl px-3 py-3 text-[13px] font-bold transition-colors text-left leading-tight ${
                      tier.key === t.key ? 'bg-amber-400 text-slate-900' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                {(Object.keys(SIZE_LABELS) as JobSize[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setJobSize(s)}
                    className={`rounded-xl px-2 py-3 text-[13px] font-bold transition-colors leading-tight ${
                      jobSize === s ? 'bg-amber-400 text-slate-900' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {SIZE_LABELS[s]}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-800 px-4 py-3">
                <p className="text-sm font-bold text-slate-300">Jobs like this a week</p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setJobsPerWeek((n) => Math.max(1, n - 1))}
                    aria-label="Fewer jobs a week"
                    className="w-11 h-11 rounded-full bg-slate-700 text-white flex items-center justify-center active:scale-95 transition-transform"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <span className="text-2xl font-extrabold tabular-nums w-6 text-center text-white">{jobsPerWeek}</span>
                  <button
                    onClick={() => setJobsPerWeek((n) => Math.min(10, n + 1))}
                    aria-label="More jobs a week"
                    className="w-11 h-11 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center active:scale-95 transition-transform"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-2xl bg-slate-800/60 px-4 py-3.5 flex items-baseline justify-center gap-5">
                <p className="text-sm font-bold text-slate-400">
                  <MoneyTicker value={weekPay} className="text-white text-xl tabular-nums" /> a week
                </p>
                <p className="text-sm font-bold text-slate-400">
                  <MoneyTicker value={yearPay} className="text-amber-400 text-xl tabular-nums" /> a year
                </p>
              </div>

              <p className="mt-5 text-[13px] text-slate-400 font-normal">
                Every figure is a real paid job through our pay engine — you always get the
                highest of share, hourly floor or visit minimum. Never under £{tier.floorHourly}/hr
                or £{tier.visitMin} a visit.
              </p>
              <a
                href={applyHref} target="_blank" rel="noopener noreferrer"
                className="mt-4 flex items-center justify-center gap-2.5 rounded-full bg-amber-400 text-slate-900 font-extrabold text-lg px-8 py-4 active:scale-[0.98] transition-transform"
              >
                {applyLabel} <ArrowRight className="w-5 h-5" />
              </a>
              <p className="mt-2.5 text-center text-xs font-bold text-slate-500">
                {slotsLine} · application, docs, paid trial
              </p>
            </div>
          ) : (
            <div className="mt-6 grid lg:grid-cols-2 gap-4 items-stretch">
              <div className="rounded-3xl overflow-hidden shadow-2xl shadow-black/50 bg-slate-900">
                <div className="px-5 pt-5 pb-4">
                  <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-white/50">A real block from this week</p>
                  <p className="mt-2 text-4xl font-extrabold text-amber-400 tabular-nums leading-none">£2,221</p>
                  <p className="text-[12px] uppercase tracking-[0.08em] text-white/60 mt-1.5 font-medium">crew pay · 10 tasks</p>
                  <p className="mt-3 font-bold text-lg leading-snug text-white">Painting, general repairs, plastering</p>
                  <p className="mt-2 text-[13px] font-bold text-[#7DB00E]">£535 materials on our card</p>
                </div>
                <div className="border-t border-slate-700/60 px-5 py-3.5 grid grid-cols-3 gap-2 text-center text-white">
                  <div><p className="text-sm font-extrabold">~40%</p><p className="text-[10px] text-slate-400 font-semibold leading-tight">at week one</p></div>
                  <div><p className="text-sm font-extrabold">Next-day</p><p className="text-[10px] text-slate-400 font-semibold leading-tight">pay on sign-off</p></div>
                  <div><p className="text-sm font-extrabold">Deposit</p><p className="text-[10px] text-slate-400 font-semibold leading-tight">already paid</p></div>
                </div>
              </div>
              <div className="rounded-3xl bg-slate-900 p-5 sm:p-8 flex flex-col justify-center">
                <ul className="space-y-3 text-[16px] text-white font-bold">
                  <li>See every task priced before you commit.</li>
                  <li>+10% launch bonus, first 10 jobs.</li>
                  <li>Keep your own clients. No fees.</li>
                  <li>Unclaimed blocks bump +5% every 48h.</li>
                </ul>
                <a
                  href={applyHref} target="_blank" rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center justify-center gap-2.5 rounded-full bg-amber-400 text-slate-900 font-extrabold text-lg px-8 py-4 active:scale-[0.98] transition-transform"
                >
                  {applyLabel} <ArrowRight className="w-5 h-5" />
                </a>
                <p className="mt-2.5 text-center text-xs font-bold text-slate-500">
                  {slotsLine} · references + insurance checked
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Mind reads ──────────────────────────────────────────────────── */}
      <section className="bg-slate-900 px-4 py-14 sm:py-20 border-t border-slate-800">
        <div className="max-w-4xl mx-auto space-y-10 sm:space-y-14">
          {MIND_READS.map(({ pain, fix }, i) => (
            <motion.div
              key={pain}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-70px' }}
              transition={{ duration: 0.55, ease: easeOutExpo, delay: i * 0.04 }}
            >
              <p className="text-white font-extrabold leading-[1.12] text-[clamp(1.5rem,5.5vw,2.6rem)] max-w-2xl">
                {pain}
              </p>
              <p className="mt-2 text-amber-400 font-extrabold text-[clamp(1.2rem,4vw,1.8rem)]">
                {fix}
              </p>
            </motion.div>
          ))}
          <a href={applyHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-amber-400 font-bold text-sm">
            Fix all three — apply <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* ── Pinned modern phone: THEIR job offer ────────────────────────── */}
      <div ref={phoneWrapRef} className="relative bg-slate-950" style={{ height: '280vh' }}>
        <div className="sticky top-0 h-screen flex flex-col items-center justify-center px-4 overflow-hidden">
          <p className="text-amber-400 font-bold uppercase tracking-[0.14em] text-xs text-center">
            This is a job landing
          </p>
          <h2 className="mt-1.5 font-extrabold text-white leading-tight text-[clamp(1.4rem,5vw,2.2rem)] text-center max-w-md">
            You see the £ <span className="text-amber-400">before</span> you say yes.
          </h2>

          {/* Modern phone: thin bezel, dynamic island, side keys, scaled content */}
          <div className="mt-4 relative" style={{ width: PHONE_VIEW_W + 12 }}>
            {/* side keys */}
            <div className="absolute -left-[2px] top-[110px] w-[3px] h-8 rounded-l bg-slate-700" />
            <div className="absolute -left-[2px] top-[150px] w-[3px] h-12 rounded-l bg-slate-700" />
            <div className="absolute -right-[2px] top-[130px] w-[3px] h-16 rounded-r bg-slate-700" />
            <div className="rounded-[2.8rem] bg-slate-900 p-[6px] ring-1 ring-slate-700/70 shadow-2xl shadow-black/70">
              <div className="relative rounded-[2.45rem] overflow-hidden bg-black">
                {/* dynamic island */}
                <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[86px] h-[24px] bg-black rounded-full z-10 ring-1 ring-black" />
                <div style={{ width: PHONE_VIEW_W, height: PHONE_VIEW_H, overflow: 'hidden' }}>
                  <iframe
                    ref={iframeRef}
                    src={DEMO_OFFER_URL}
                    title="A real Handy job offer"
                    scrolling="no"
                    loading="lazy"
                    tabIndex={-1}
                    className="pointer-events-none origin-top-left"
                    style={{
                      width: PHONE_CONTENT_W,
                      height: Math.round(PHONE_VIEW_H / PHONE_SCALE),
                      transform: `scale(${PHONE_SCALE})`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">
            Keep scrolling — every task, priced
          </p>
        </div>
      </div>

      {/* ── Craig, short ────────────────────────────────────────────────── */}
      <section className="bg-slate-950 px-4 pb-14 sm:pb-20">
        <div className="max-w-2xl mx-auto text-center">
          {/* Drafted, pending Craig's sign-off (user chose ship-now) */}
          <blockquote className="text-white font-extrabold leading-snug text-[clamp(1.3rem,4.5vw,1.9rem)]">
            "Jobs land priced. Materials sorted. Money next day.<br />
            <span className="text-amber-400">Best move I've made in years."</span>
          </blockquote>
          <p className="mt-3 text-slate-400 text-sm font-bold">Craig · Core tradesman · 4.9★</p>
        </div>
      </section>

      {/* ── Recent jobs ─────────────────────────────────────────────────── */}
      <section className="bg-slate-900 text-white px-4 py-12 sm:py-16 border-t border-slate-800">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-extrabold leading-tight text-[clamp(1.6rem,4.5vw,2.4rem)]">
            Dispatched <span className="text-amber-400">this month.</span>
          </h2>
          <div className="mt-6 grid sm:grid-cols-3 gap-4">
            {RECENT_JOBS.map(j => (
              <div key={j.title} className="rounded-3xl bg-slate-800/70 border border-slate-700/60 p-5">
                <p className="text-3xl font-extrabold text-amber-400 tabular-nums">{j.pay}</p>
                <p className="mt-1.5 font-bold leading-snug">{j.title}</p>
                <p className="mt-1 text-sm text-slate-400 font-semibold">{j.area} · {j.size}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-slate-500 font-semibold">Contractor pay. Not projections.</p>
            <a href={applyHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-amber-400 font-bold text-sm shrink-0">
              Want the next one? <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Three steps ─────────────────────────────────────────────────── */}
      <section className="px-4 py-12 sm:py-16">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-extrabold leading-tight text-[clamp(1.6rem,4.5vw,2.4rem)] text-center">
            Three steps. <span className="text-amber-500">Zero admin.</span>
          </h2>
          <div className="mt-8 grid md:grid-cols-3 gap-4">
            {(mode === 'solo' ? [
              ['Tell us your free days', 'Two-minute form.'],
              ['Jobs arrive, priced', 'Say yes or no. Your call.'],
              ['Paid next day', 'Photos in. Money in.'],
            ] : [
              ['Show us the crew', 'One call. References. Insurance.'],
              ['Take a block', 'Every task priced. No bidding.'],
              ['Deliver, get paid', 'Staged pay. Next-day transfer.'],
            ]).map(([title, body], i) => (
              <div
                key={`${mode}-${title}`}
                className={`rounded-3xl p-6 ${i === 0 ? 'bg-amber-400 text-slate-900' : 'bg-white border border-slate-200'}`}
              >
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xl font-extrabold mb-3 ${i === 0 ? 'bg-slate-900 text-amber-400' : 'bg-slate-100 text-slate-800'}`}>
                  {i + 1}
                </div>
                <h3 className="font-extrabold text-lg">{title}</h3>
                <p className={`mt-1 text-sm font-semibold ${i === 0 ? 'text-slate-800' : 'text-slate-500'}`}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Ladder ──────────────────────────────────────────────────────── */}
      <section className="bg-amber-400 px-4 py-10 sm:py-12">
        <div className="max-w-5xl mx-auto">
          <p className="font-extrabold text-slate-900 leading-snug text-[clamp(1.3rem,4.5vw,2rem)]">
            Spare days today. First pick after 5 clean jobs.<br className="hidden sm:block" />
            A permanent seat when <span className="underline decoration-4">you</span> want it.
          </p>
        </div>
      </section>

      {/* ── What you need (Uber pattern: de-risk the ask, filter early) ─── */}
      <section className="bg-slate-900 text-white px-4 py-12 sm:py-16">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-extrabold leading-tight text-[clamp(1.6rem,4.5vw,2.4rem)]">
            What you <span className="text-amber-400">need.</span>
          </h2>
          <div className="mt-7 grid sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Requirements</p>
              <ul className="mt-3 space-y-2.5">
                {(mode === 'solo'
                  ? ['Public liability insurance', 'Right to work in the UK', 'Own tools and transport']
                  : ['Public liability + employers\u2019 liability', 'References on comparable jobs', 'Own tools and transport']
                ).map(r => (
                  <li key={r} className="flex items-center gap-2.5 font-bold text-[15px]">
                    <span className="w-6 h-6 rounded-full bg-[#7DB00E]/20 text-[#7DB00E] flex items-center justify-center text-sm shrink-0">{'\u2713'}</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">How selection works</p>
              <ol className="mt-3 space-y-2.5">
                {['Apply on WhatsApp', 'Docs + reference check', 'Paid trial job', 'On the roster'].map((step, i) => (
                  <li key={step} className="flex items-center gap-2.5 font-bold text-[15px]">
                    <span className="w-6 h-6 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center text-sm font-extrabold shrink-0 tabular-nums">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[13px] text-slate-400 font-semibold">
                Job 1 is a paid trial. Hit the photo standard, keep the slot.
              </p>
              <a href={applyHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-amber-400 font-bold text-sm">
                Start your application <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="px-4 py-12 sm:py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-extrabold leading-tight text-[clamp(1.6rem,4.5vw,2.4rem)] text-center">
            Straight answers.
          </h2>
          <div className="mt-7 space-y-3">
            {FAQS.map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <summary className="flex items-center justify-between gap-3 p-5 cursor-pointer font-bold text-[15px] text-slate-900 select-none list-none">
                  {q}
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-5 pb-5">
                  <p className="text-sm leading-relaxed text-slate-600 font-normal">{a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="bg-slate-950 text-white px-4 pt-14 pb-24 sm:py-20">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="font-extrabold leading-[1.05] text-[clamp(1.9rem,5.5vw,3.4rem)]">
            {mode === 'solo'
              ? <>Your empty days.<br /><span className="text-amber-400">Our problem now.</span></>
              : <>Blocks are live <span className="text-amber-400">now.</span></>}
          </h2>
          <p className="mt-4 text-amber-400 font-bold text-sm uppercase tracking-[0.12em]">
            {slotsLine} · Nottingham
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              href={applyHref} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded-full bg-amber-400 text-slate-900 font-extrabold text-xl px-9 py-4 active:scale-[0.98] transition-transform"
            >
              <Phone className="w-6 h-6" /> {applyLabel}
            </a>
            <Link
              href="/join"
              className="inline-flex items-center gap-2 rounded-full border-2 border-slate-700 text-slate-200 font-bold text-xl px-8 py-4 hover:border-slate-500 transition-colors"
            >
              Apply online <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <p className="mt-8 text-xs text-slate-500 font-semibold max-w-lg mx-auto">
            Handy Services · real July figures · you stay a self-employed business — we're a
            client of yours, not your employer.
          </p>
        </div>
      </section>

      {/* ── Sticky bottom CTA (mobile) ──────────────────────────────────── */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md transition-transform duration-300 sm:hidden ${
          showSticky ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-slate-500 leading-none">
              {slotsLine}
            </p>
            <p className="text-lg font-extrabold tabular-nums leading-tight mt-0.5">
              {mode === 'solo' ? `£${weekPay} a week in jobs` : '£2,221 block open'}
            </p>
          </div>
          <a
            href={applyHref} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-amber-400 text-slate-900 font-extrabold text-[15px] px-5 py-3 active:scale-[0.97] transition-transform"
          >
            {rosterFull ? 'Waitlist' : 'Apply'} <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
