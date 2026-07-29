/**
 * Partner showcase — the recruitment + sign-in surface at /partner.
 *
 * Sells the Handy partner offering to a skilled tradesperson deciding whether
 * to come aboard: the revenue-share pay model, 48-hour payout, materials on a
 * Handy card (no cash fronted), and route-optimised days. Login lives here too
 * (top-right + closing CTA) → /partner/login → their my-week app.
 *
 * Dark, money-forward, phone-first — coherent with the my-week app they enter.
 */
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight, Banknote, CalendarClock, CreditCard, Route, ShieldCheck, Megaphone, Star, Sparkles, MapPin } from 'lucide-react';

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] } }),
};

const TIERS = [
  { tier: 'Specialist', dayMin: 200, work: 'Electrics · plumbing · kitchens · bathrooms' },
  { tier: 'Skilled', dayMin: 160, work: 'Carpentry · tiling · plastering · doors · locks' },
  { tier: 'General', dayMin: 130, work: 'Fixing · flat-pack · painting · mounting · shelving' },
  { tier: 'Outdoor', dayMin: 120, work: 'Fencing · guttering · pressure-washing · waste' },
];

const PILLARS = [
  {
    icon: CalendarClock,
    kicker: 'Paid in 48 hours',
    title: 'Finish the job Monday, paid by Wednesday.',
    body: 'No 30-day invoices, no chasing. The moment a job is signed off, your share is queued and lands in your account within two working days.',
    img: '/assets/quote-images/plumber-smile.webp',
    alt: 'A Handy partner on site, job done',
  },
  {
    icon: CreditCard,
    kicker: 'Materials, our card',
    title: 'Never front your own cash again.',
    body: 'Materials, plant hire, even vetted extra labour go on a Handy expense card. You buy what the job needs within budget. We keep the receipts. Your money stays yours.',
    img: '/assets/quote-images/flatpack-assembly.webp',
    alt: 'Materials and parts laid out for a job',
  },
  {
    icon: Route,
    kicker: 'Route-optimised days',
    title: 'We plan the day so the van does less.',
    body: 'Jobs are grouped by area and slotted into your open days, so you spend the day earning, not driving across the county. You set the days. We fill them well.',
    img: '/assets/quote-images/craig-fence.webp',
    alt: 'A partner working an outdoor job',
  },
];

const HANDLES = [
  { icon: Megaphone, label: 'Leads, brought to you', sub: 'SEO, ads and a quoting engine feed you real jobs from day one.' },
  { icon: ShieldCheck, label: '£2M insured, one brand', sub: "You work under Handy's cover, brand and 4.9★ reputation." },
  { icon: Banknote, label: 'Quoting done for you', sub: 'Every job priced before you arrive. You do the work, not the paperwork.' },
];

// The jobs Handy groups into one well-paid, low-travel day.
const DAY_JOBS = [
  { time: '9:00', title: 'Bathroom seal & repair', area: 'DE24', hop: 'start', earn: 220 },
  { time: '12:30', title: 'Fence panels + gate', area: 'DE24', hop: '6 min away', earn: 140 },
  { time: '15:00', title: 'Flat-pack + TV mount', area: 'DE23', hop: '9 min away', earn: 110 },
];

/** Animated "we group well-paying jobs into your day" visual. On scroll, jobs
 *  drop into an ordered day, a route line draws down the side, total reveals. */
function GroupedDay() {
  const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.22, delayChildren: 0.15 } } };
  const job = { hidden: { opacity: 0, x: 24 }, show: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } } };
  return (
    <motion.div
      initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }} variants={stagger}
      className="relative bg-[#1D2D3D] rounded-2xl border border-white/10 p-5 shadow-2xl"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-white">Your Tuesday, grouped</div>
        <motion.div
          className="text-[11px] text-amber-400 font-semibold inline-flex items-center gap-1"
          animate={{ opacity: [0.55, 1, 0.55] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles size={12} /> smart routing
        </motion.div>
      </div>

      <div className="relative">
        {/* route line the jobs hang off */}
        <motion.div
          className="absolute left-[7px] top-2 w-px bg-amber-400/40"
          variants={{ hidden: { height: 0 }, show: { height: '100%', transition: { duration: 1, ease: 'easeInOut' } } }}
        />
        <div className="space-y-2.5">
          {DAY_JOBS.map((j, i) => (
            <motion.div key={i} variants={job} className="relative flex items-center gap-3 pl-5">
              <span className="absolute left-0 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-[#1D2D3D]" />
              <div className="flex-1 min-w-0 bg-slate-900/60 rounded-xl p-3 border border-white/5 flex items-center gap-3">
                <div className="text-xs font-mono text-slate-500 w-11 shrink-0">{j.time}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{j.title}</div>
                  <div className="text-[11px] text-slate-400 inline-flex items-center gap-1"><MapPin size={10} />{j.area} · {j.hop}</div>
                </div>
                <div className="text-sm font-black text-amber-400 shrink-0">£{j.earn}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <motion.div variants={job} className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
        <div className="text-xs text-slate-400 max-w-[9rem] leading-tight">One area, one route, less driving.</div>
        <div className="text-right">
          <div className="text-[11px] text-slate-400">You earn that day</div>
          <div className="text-2xl font-black text-white">£470</div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function PartnerShowcase() {
  const [, go] = useLocation();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 antialiased selection:bg-amber-400/30">
      {/* Nav */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-slate-900/80 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Handy Services" className="w-9 h-9 object-contain" />
            <span className="font-bold tracking-tight text-[15px]">Handy <span className="text-slate-400 font-medium">Partners</span></span>
          </div>
          <button
            onClick={() => go('/partner/login')}
            className="text-sm font-semibold text-slate-200 hover:text-white px-4 py-2 rounded-lg border border-white/15 hover:border-white/30 transition-colors"
          >
            Partner login
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <img src="/assets/quote-images/craig-banner.webp" alt="" className="w-full h-full object-cover opacity-[0.18]" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/70 via-slate-900/85 to-slate-900" />
        </div>
        <div className="max-w-6xl mx-auto px-5 pt-20 pb-16 md:pt-28 md:pb-24">
          <motion.p variants={rise} initial="hidden" animate="show" className="text-amber-400 font-semibold text-sm tracking-wide mb-5">
            For skilled trades in the East Midlands
          </motion.p>
          <motion.h1
            variants={rise} initial="hidden" animate="show" custom={1}
            className="font-black tracking-tight leading-[0.95] text-[clamp(2.6rem,8vw,5.5rem)] max-w-4xl"
          >
            Keep the work.<br />
            <span className="text-amber-400">Lose the admin.</span>
          </motion.h1>
          <motion.p
            variants={rise} initial="hidden" animate="show" custom={2}
            className="mt-7 text-slate-300 text-lg md:text-xl leading-relaxed max-w-2xl"
          >
            Earn well on every job, <span className="text-white font-semibold">paid within 48 hours</span>, with materials on our card and your days planned around your van. You bring the craft. Handy brings the rest.
          </motion.p>
          <motion.div variants={rise} initial="hidden" animate="show" custom={3} className="mt-9 flex flex-wrap items-center gap-3">
            <button
              onClick={() => go('/join')}
              className="group inline-flex items-center gap-2 bg-amber-400 text-slate-900 font-bold px-6 py-3.5 rounded-xl hover:bg-amber-300 transition-colors"
            >
              Become a partner
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              onClick={() => go('/partner/login')}
              className="inline-flex items-center gap-2 font-semibold px-6 py-3.5 rounded-xl border border-white/15 hover:border-white/35 transition-colors"
            >
              I&apos;m already a partner
            </button>
          </motion.div>
          <motion.div variants={rise} initial="hidden" animate="show" custom={4} className="mt-12 flex items-center gap-4 text-sm text-slate-400">
            <div className="flex -space-x-2.5">
              {['craig', 'bezent', 'emile', 'neil'].map((n) => (
                <img key={n} src={`/assets/avatars/${n}-avatar-1.webp`} alt="" className="w-9 h-9 rounded-full object-cover border-2 border-slate-900" />
              ))}
            </div>
            <span>Trusted by the core team already earning on the platform</span>
          </motion.div>
        </div>
      </section>

      {/* Pay model */}
      <section className="max-w-6xl mx-auto px-5 py-20 md:py-28">
        <div className="grid md:grid-cols-2 gap-10 lg:gap-14 items-center mb-14">
          <motion.div variants={rise} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}>
            <p className="text-amber-400 font-semibold text-sm mb-3">The pay model</p>
            <h2 className="font-black tracking-tight text-[clamp(2rem,5vw,3.25rem)] leading-tight">We pay by the job. We build the day.</h2>
            <p className="mt-5 text-slate-300 text-lg leading-relaxed">
              You&apos;re paid per job, not by the clock. Then trade know-how and smart routing group well-paying jobs near you into a full day, so you earn more and drive less. Every day still carries a guaranteed minimum.
            </p>
          </motion.div>
          <GroupedDay />
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-white/5 rounded-2xl overflow-hidden border border-white/5">
          {TIERS.map((t, i) => (
            <motion.div
              key={t.tier}
              variants={rise} initial="hidden" whileInView="show" viewport={{ once: true }} custom={i}
              className="bg-[#1D2D3D] p-6 flex flex-col"
            >
              <div className="text-slate-400 text-sm font-semibold">{t.tier}</div>
              <div className="mt-3 flex items-baseline gap-0.5">
                <span className="text-2xl font-black text-amber-400">£</span>
                <span className="text-5xl font-black text-white tracking-tight">{t.dayMin}</span>
                <span className="text-lg font-semibold text-slate-400 ml-1">a day</span>
              </div>
              <div className="mt-1 text-xl font-black uppercase tracking-wider text-amber-400">Minimum</div>
              <div className="mt-5 pt-5 border-t border-white/5 text-[13px] text-slate-400 leading-relaxed">{t.work}</div>
            </motion.div>
          ))}
        </div>

        <motion.div
          variants={rise} initial="hidden" whileInView="show" viewport={{ once: true }}
          className="mt-8 flex flex-col md:flex-row md:items-center gap-6 md:gap-10 bg-amber-400/10 border border-amber-400/20 rounded-2xl p-7"
        >
          <div>
            <div className="text-sm font-semibold text-amber-300 mb-1">Worked example</div>
            <p className="text-slate-200 text-lg leading-snug max-w-md">A full bathroom day, priced and booked before you arrive.</p>
          </div>
          <div className="flex items-center gap-3 md:ml-auto">
            <div className="text-right">
              <div className="text-4xl font-black text-white tracking-tight">£495</div>
              <div className="text-sm text-slate-400">take-home, in 48 hours</div>
            </div>
            <div className="text-slate-500 text-sm max-w-[9rem] leading-tight">plus materials on your Handy card</div>
          </div>
        </motion.div>
      </section>

      {/* Pillars — alternating rows */}
      <section className="border-y border-white/5 bg-slate-950">
        <div className="max-w-6xl mx-auto px-5 divide-y divide-white/5">
          {PILLARS.map((p, i) => (
            <motion.div
              key={p.kicker}
              variants={rise} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}
              className={`grid md:grid-cols-2 gap-8 md:gap-14 items-center py-16 md:py-20 ${i % 2 ? 'md:[&>*:first-child]:order-2' : ''}`}
            >
              <div>
                <div className="inline-flex items-center gap-2 text-amber-400 font-semibold text-sm mb-4">
                  <p.icon size={17} />
                  {p.kicker}
                </div>
                <h3 className="font-black tracking-tight text-[clamp(1.6rem,4vw,2.6rem)] leading-[1.05]">{p.title}</h3>
                <p className="mt-5 text-slate-300 text-lg leading-relaxed max-w-lg">{p.body}</p>
              </div>
              <div className="relative rounded-2xl overflow-hidden aspect-[4/3] border border-white/10">
                <img src={p.img} alt={p.alt} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 ring-1 ring-inset ring-white/5 rounded-2xl" />
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Everything else handled */}
      <section className="max-w-6xl mx-auto px-5 py-20 md:py-28">
        <motion.h2 variants={rise} initial="hidden" whileInView="show" viewport={{ once: true }} className="font-black tracking-tight text-[clamp(1.8rem,4.5vw,3rem)] leading-tight max-w-2xl mb-12">
          The bits you hate, gone.
        </motion.h2>
        <div className="grid md:grid-cols-3 gap-8">
          {HANDLES.map((h, i) => (
            <motion.div key={h.label} variants={rise} initial="hidden" whileInView="show" viewport={{ once: true }} custom={i} className="flex gap-4">
              <div className="shrink-0 w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-amber-400">
                <h.icon size={20} />
              </div>
              <div>
                <div className="font-bold text-[17px] mb-1">{h.label}</div>
                <p className="text-slate-400 leading-relaxed">{h.sub}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Closing CTA + login */}
      <section className="relative overflow-hidden border-t border-white/5">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-amber-400/[0.07] to-transparent" />
        <div className="max-w-3xl mx-auto px-5 py-24 md:py-32 text-center">
          <motion.div variants={rise} initial="hidden" whileInView="show" viewport={{ once: true }} className="flex items-center justify-center gap-1.5 text-amber-300 mb-6">
            {[0, 1, 2, 3, 4].map((s) => <Star key={s} size={16} className="fill-amber-300" />)}
            <span className="ml-2 text-sm text-slate-400">4.9 average across 230+ jobs</span>
          </motion.div>
          <motion.h2 variants={rise} initial="hidden" whileInView="show" viewport={{ once: true }} custom={1} className="font-black tracking-tight text-[clamp(2.2rem,6vw,4rem)] leading-[0.98]">
            Ready to own your patch?
          </motion.h2>
          <motion.p variants={rise} initial="hidden" whileInView="show" viewport={{ once: true }} custom={2} className="mt-6 text-slate-300 text-lg leading-relaxed">
            Apply in minutes. Already partnered? Sign in and set your week.
          </motion.p>
          <motion.div variants={rise} initial="hidden" whileInView="show" viewport={{ once: true }} custom={3} className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <button onClick={() => go('/join')} className="group inline-flex items-center gap-2 bg-amber-400 text-slate-900 font-bold px-7 py-4 rounded-xl hover:bg-amber-300 transition-colors">
              Apply to partner
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button onClick={() => go('/partner/login')} className="inline-flex items-center gap-2 font-semibold px-7 py-4 rounded-xl border border-white/15 hover:border-white/35 transition-colors">
              Partner login
            </button>
          </motion.div>
        </div>
      </section>

      <footer className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500">
          <span>© Handy Services · Partner programme</span>
          <button onClick={() => go('/partner/login')} className="hover:text-slate-300 transition-colors">Partner login →</button>
        </div>
      </footer>
    </div>
  );
}
