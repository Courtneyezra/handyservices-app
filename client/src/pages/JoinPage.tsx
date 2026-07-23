import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowRight,
  Calendar,
  Check,
  CheckCircle,
  Clock,
  FileX2,
  Loader2,
  MessageSquare,
  Phone,
  PoundSterling,
  Shield,
  ShieldX,
  Star,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { SiGoogle } from 'react-icons/si';

// ─── Design language: matches HandymanLanding (slate + amber, Poppins,
//     rounded-3xl cards, rounded-full pill CTAs, amber-eyebrow headers). ──────

const TRADES = [
  'Carpentry & Joinery',
  'Painting & Decorating',
  'Plumbing',
  'Tiling',
  'Minor Electrical',
  'Plastering',
  'Fencing & Outdoor',
  'General Repairs',
];

const DAYS_OPTIONS = ['1 day', '2–3 days', '4–5 days', 'Flexible'];

// ─── Pain Points ────────────────────────────────────────────────────────────

const PAIN_POINTS = [
  {
    icon: Calendar,
    stat: '53%',
    statLabel: 'of UK contractors worry about finding work',
    headline: 'The feast-or-famine cycle',
    quote:
      "Over 5 years in the industry and still struggling to get a regular income. Some weeks I'm turning work down, others I'm desperately looking for jobs.",
    source: 'UK tiler, Facebook trades group, 2024',
  },
  {
    icon: FileX2,
    stat: '50%',
    statLabel: 'of working hours lost to non-billable admin',
    headline: 'The admin drain',
    quote:
      "Follow-ups and chasing unpaid invoices are the worst. I hate having to send 'just checking in' messages, but if I don't, a lot of jobs just disappear.",
    source: 'r/handyman, Reddit, 2025',
  },
  {
    icon: ShieldX,
    stat: '£200+',
    statLabel: '/mo on Checkatrade — before any leads arrive',
    headline: 'The platform problem',
    quote:
      "I was on Checkatrade for 6 years. Hundreds of 10/10 reviews — still got hardly any leads.",
    source: 'r/DIYUK, Reddit, 2025',
  },
];

// ─── Benefits ────────────────────────────────────────────────────────────────

const BENEFITS = [
  {
    icon: Calendar,
    title: 'A full, predictable calendar',
    desc: "We have more jobs than we can fill. You tell us which days you're available — we fill them. No cold weeks.",
  },
  {
    icon: Wrench,
    title: 'Zero admin — just do the work',
    desc: 'No quoting. No invoicing. No chasing. Show up, do the job, get paid. We handle everything before and after.',
  },
  {
    icon: Zap,
    title: 'Fast pay — within 24 hours',
    desc: "We pay within 24 hours of job sign-off. No 30-day invoices. No chasing. Your bank balance goes up the day after you work.",
  },
  {
    icon: Shield,
    title: 'No-show protection',
    desc: 'Every booking has a customer deposit. If they cancel inside 24 hours, you still get paid a portion. We take the hit — not you.',
  },
  {
    icon: Users,
    title: 'Jobs assigned — not bid on',
    desc: "We're not Checkatrade. You don't compete with anyone. The job is yours — no bidding, no price-cutting, no racing to respond.",
  },
];

// ─── Form types ────────────────────────────────────────────────────────────

interface FormData {
  name: string;
  phone: string;
  trades: string[];
  area: string;
  daysPerWeek: string;
  referredBy: string;
  message: string;
}

const INITIAL_FORM: FormData = {
  name: '',
  phone: '',
  trades: [],
  area: '',
  daysPerWeek: '',
  referredBy: '',
  message: '',
};

// ─── Section header (amber eyebrow + bold headline) — landing pattern ────────

function SectionHeader({
  eyebrow,
  children,
  sub,
  light = false,
}: {
  eyebrow: string;
  children: React.ReactNode;
  sub?: string;
  light?: boolean;
}) {
  return (
    <div className="text-center mb-10 lg:mb-14 max-w-2xl mx-auto">
      <p className="text-amber-500 font-bold uppercase tracking-[0.14em] text-xs md:text-sm mb-3">
        {eyebrow}
      </p>
      <h2
        className={`text-3xl md:text-4xl lg:text-5xl font-bold leading-[1.1] mb-4 ${
          light ? 'text-white' : 'text-slate-900'
        }`}
      >
        {children}
      </h2>
      {sub && (
        <p className={`text-lg font-medium ${light ? 'text-white/60' : 'text-slate-600'}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function JoinPage() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const set = (key: keyof FormData, value: string | string[]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleTrade = (trade: string) =>
    setForm((prev) => ({
      ...prev,
      trades: prev.trades.includes(trade)
        ? prev.trades.filter((t) => t !== trade)
        : [...prev.trades, trade],
    }));

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/join/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          trades: form.trades,
          area: form.area,
          daysPerWeek: form.daysPerWeek,
          referredBy: form.referredBy,
          message: form.message,
        }),
      });
      if (!res.ok) throw new Error('Submission failed');
      setSubmitted(true);
    } catch {
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-poppins text-slate-900 font-medium antialiased">
      {/* ════ NAV BAR ════ */}
      <nav className="w-full bg-slate-900 px-4 lg:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between py-3.5">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Handy Services" className="w-9 h-9 rounded-full" />
            <span className="text-white font-bold text-base tracking-tight">Handy Services</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              ))}
              <span className="text-white/70 text-xs ml-1">4.9 · 300+ reviews</span>
            </div>
            <a href="tel:07449501762" className="flex items-center gap-1.5 text-white font-bold text-sm">
              <Phone className="w-4 h-4" />
              <span className="hidden sm:inline">07449 501 762</span>
            </a>
          </div>
        </div>
      </nav>

      {/* Amber announcement strip */}
      <div className="w-full bg-amber-400 py-2 text-center">
        <p className="text-xs sm:text-sm font-bold text-slate-900">
          Now onboarding contractors in Greater Nottingham &amp; Derby
        </p>
      </div>

      {/* ════ HERO ════ */}
      <section className="relative overflow-hidden bg-slate-900 px-4 lg:px-8">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, transparent, transparent 22px, #fff 22px, #fff 23px)',
          }}
        />
        <div className="relative max-w-5xl mx-auto pt-16 pb-16 sm:pt-24 sm:pb-20 text-center">
          <p className="text-amber-400 font-bold uppercase tracking-[0.14em] text-xs md:text-sm mb-4">
            For Nottingham tradespeople
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] text-white">
            Full calendar. <span className="text-amber-400">Zero admin.</span>
            <br />
            Next-day pay.
          </h1>
          <p className="mt-5 text-lg sm:text-xl text-white/60 max-w-2xl mx-auto font-medium leading-relaxed">
            Stop chasing work. Stop chasing invoices. We send the jobs to you — you do what
            you're good at.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-2.5 sm:gap-3">
            {['Fully booked schedules', 'Assigned jobs — no bidding', '24-hr payment', 'No-show protection'].map(
              (badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3.5 py-1.5 text-sm font-medium text-white/90"
                >
                  <Check className="w-4 h-4 text-amber-400" /> {badge}
                </span>
              ),
            )}
          </div>

          <Button
            size="lg"
            onClick={scrollToForm}
            className="mt-10 px-9 py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full text-lg"
          >
            Apply to join <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <p className="mt-4 text-sm text-white/40">
            Takes 2 minutes. No CV needed. We'll ring you within 48 hours.
          </p>
        </div>
      </section>

      {/* ════ PROBLEM — "Sound familiar?" ════ */}
      <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            eyebrow="The daily grind"
            sub="You're good at the work. You shouldn't have to be good at running a business too."
          >
            Sound <span className="text-amber-500">familiar?</span>
          </SectionHeader>

          <div className="grid md:grid-cols-3 gap-5 lg:gap-6">
            {PAIN_POINTS.map((pain) => {
              const Icon = pain.icon;
              return (
                <div key={pain.headline} className="rounded-3xl border border-slate-200 bg-white p-6 lg:p-7 shadow-xl">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-slate-800" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-amber-500">{pain.stat}</p>
                      <p className="text-[10px] leading-tight text-slate-500">{pain.statLabel}</p>
                    </div>
                  </div>
                  <h3 className="font-bold text-base mb-3 text-slate-900">{pain.headline}</h3>
                  <blockquote className="text-sm italic leading-relaxed mb-2 pl-3 border-l-[3px] border-amber-400 text-slate-700">
                    "{pain.quote}"
                  </blockquote>
                  <p className="text-[10px] text-slate-500">— {pain.source}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ════ HOW IT WORKS ════ */}
      <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
        <div className="max-w-5xl mx-auto">
          <SectionHeader eyebrow="How it works" light sub="No bidding. No quoting. No admin. Just work.">
            Three steps, <span className="text-amber-400">that's it.</span>
          </SectionHeader>

          <div className="grid sm:grid-cols-3 gap-6 lg:gap-8">
            {[
              {
                icon: MessageSquare,
                title: 'Tell us your availability',
                desc: "AM, PM, or full day — tell us when you're free and we slot jobs around your existing work.",
              },
              {
                icon: Wrench,
                title: 'We send you booked jobs',
                desc: 'Job card with address, job type, duration, and your rate. Accept or decline — your choice.',
              },
              {
                icon: PoundSterling,
                title: 'Complete & get paid',
                desc: 'Finish the job, send a photo. Money in your account within 24 hours.',
              },
            ].map((step, idx) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="text-center">
                  <div className="flex flex-col items-center gap-3 mb-5">
                    <span className="w-10 h-10 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center text-lg font-bold">
                      {idx + 1}
                    </span>
                    <div className="w-16 h-16 rounded-3xl bg-white/10 flex items-center justify-center">
                      <Icon className="w-7 h-7 text-amber-400" />
                    </div>
                  </div>
                  <h3 className="font-bold text-white text-lg mb-2">{step.title}</h3>
                  <p className="text-white/60 text-sm leading-relaxed">{step.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ════ HOW YOU GET PAID ════ */}
      <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
        <div className="max-w-5xl mx-auto">
          <SectionHeader eyebrow="The money" sub="Tell us when you're free. We send you jobs with the rate attached.">
            How you <span className="text-amber-500">get paid</span>
          </SectionHeader>

          <div className="grid sm:grid-cols-3 gap-5 mb-8">
            {[
              { slot: 'AM', time: '8am – 1pm', example: '2–3 jobs routed in your area', icon: '☀️' },
              { slot: 'PM', time: '1pm – 6pm', example: '2–3 jobs routed in your area', icon: '🌤️' },
              { slot: 'Full day', time: '8am – 6pm', example: '4–6 jobs, full route planned', icon: '⚡' },
            ].map((s) => (
              <div key={s.slot} className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xl">
                <p className="text-3xl mb-2">{s.icon}</p>
                <p className="font-bold text-xl text-slate-900">{s.slot}</p>
                <p className="text-xs font-medium text-slate-500 mb-3">{s.time}</p>
                <p className="text-xs text-slate-600">{s.example}</p>
              </div>
            ))}
          </div>

          <div className="rounded-3xl bg-amber-500 p-7 lg:p-8 shadow-xl">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-2xl bg-slate-900/15 flex items-center justify-center shrink-0">
                <PoundSterling className="w-5 h-5 text-slate-900" />
              </div>
              <div>
                <h3 className="font-bold text-lg mb-2 text-slate-900">
                  Per-job rate card — not hourly, not day rate
                </h3>
                <p className="text-sm leading-relaxed mb-4 text-slate-800">
                  Every job comes with the rate attached before you accept it. Tap repair: you know
                  what you'll earn. Door hang: you know what you'll earn. No clock-watching, no surprises.
                </p>
                <div className="grid sm:grid-cols-2 gap-3 text-sm text-slate-900">
                  {[
                    ['Faster = more jobs = more money.', 'Efficient tradesmen earn more, not the same.'],
                    ['See the rate before you say yes.', 'No job is ever a surprise.'],
                    ['Multiple jobs per slot.', 'We route 2–3 jobs into an AM so you stay busy and earning.'],
                    ['Your skill is rewarded.', 'Diagnose it in 5 minutes? You still earn the full job rate.'],
                  ].map(([bold, rest]) => (
                    <div key={bold} className="flex items-start gap-2">
                      <Check className="w-4 h-4 shrink-0 mt-0.5 text-slate-900" />
                      <span>
                        <strong>{bold}</strong> {rest}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════ WHAT YOU GET ════ */}
      <section className="bg-slate-50 px-4 lg:px-8 py-16 lg:py-24">
        <div className="max-w-6xl mx-auto">
          <SectionHeader
            eyebrow="What you get"
            sub="Every contractor gets all of this from day one — no bidding, no subscriptions."
          >
            The <span className="text-amber-500">deal</span>
          </SectionHeader>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <div key={benefit.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
                  <div className="w-11 h-11 rounded-2xl bg-amber-100 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-amber-600" />
                  </div>
                  <h3 className="font-bold text-base mb-1.5 text-slate-900">{benefit.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{benefit.desc}</p>
                </div>
              );
            })}

            {/* The "real maths" card — standout */}
            <div className="rounded-3xl bg-slate-900 p-6 shadow-xl sm:col-span-2 lg:col-span-1">
              <div className="w-11 h-11 rounded-2xl bg-amber-400/20 flex items-center justify-center mb-4">
                <Zap className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="font-bold text-base mb-1.5 text-white">The real maths</h3>
              <p className="text-sm leading-relaxed mb-3 text-white/60">
                Solo at £60/hr but only 4 billable hours = £240/day.
              </p>
              <p className="text-sm leading-relaxed text-white">
                <strong className="text-amber-400">With us</strong> at sub-rate, billing 6–7 hours
                with zero admin, no no-shows, and next-day payment — you earn more, with less stress.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════ THE LADDER — slot in and work your way up ════ */}
      <section className="bg-slate-900 px-4 lg:px-8 py-16 lg:py-24">
        <div className="max-w-6xl mx-auto">
          <SectionHeader eyebrow="Where this goes" light sub="Everyone starts the same way — proving the work. Turn up, do it right, and you climb: first pick of jobs, priority routing, and a path to guaranteed weeks.">
            Start on jobs. <span className="text-amber-400">Work your way up.</span>
          </SectionHeader>

          <div className="grid md:grid-cols-3 gap-5 items-stretch">
            {[
              {
                badge: 'START HERE',
                tier: 'Ad-hoc',
                desc: 'Overflow jobs offered to you as they come in.',
                points: ['Paid per job, through the app', 'Accept or decline — your call', 'Prove yourself on a handful of jobs'],
                highlight: false,
              },
              {
                badge: 'EARN YOUR WAY',
                tier: 'Core',
                desc: 'The trades we reach for first.',
                points: ['Priority in the routing — first pick of jobs', 'Steady, filled days — not scraps', 'Path to guaranteed weekly work'],
                highlight: true,
              },
              {
                badge: 'THE GOAL',
                tier: 'Partner',
                desc: 'Our most trusted, long-term trades.',
                points: ['Guaranteed weeks booked ahead', 'Top rates and first refusal', 'A real seat as we grow the patch'],
                highlight: false,
              },
            ].map((rung) => (
              <div
                key={rung.tier}
                className={`rounded-3xl p-6 lg:p-7 flex flex-col ${
                  rung.highlight ? 'bg-amber-400' : 'bg-white/5 border border-white/10'
                }`}
              >
                <span
                  className={`inline-block self-start text-[10px] font-bold tracking-widest px-3 py-1 rounded-full mb-4 ${
                    rung.highlight ? 'bg-slate-900 text-amber-400' : 'bg-amber-400/15 text-amber-400'
                  }`}
                >
                  {rung.badge}
                </span>
                <h3 className={`text-2xl font-bold mb-1 ${rung.highlight ? 'text-slate-900' : 'text-white'}`}>
                  {rung.tier}
                </h3>
                <p className={`text-sm mb-5 ${rung.highlight ? 'text-slate-900/80' : 'text-white/50'}`}>
                  {rung.desc}
                </p>
                <ul className="space-y-2.5 mt-auto">
                  {rung.points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm">
                      <Check className={`w-4 h-4 shrink-0 mt-0.5 ${rung.highlight ? 'text-slate-900' : 'text-amber-400'}`} />
                      <span className={rung.highlight ? 'text-slate-900' : 'text-white/75'}>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Self-scored promotion gate — you tick it, not us */}
          <div className="mt-10 rounded-3xl bg-white/5 border border-white/10 p-6 sm:p-7">
            <div className="text-center mb-5">
              <h3 className="text-lg font-bold text-white">
                How you move up — <span className="text-amber-400">you tick it, not us</span>
              </h3>
              <p className="text-white/50 text-sm mt-1">
                A clear rule you can see — never a judgement call. Hit these and we lock in your guaranteed days.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {['5 jobs completed', 'On time, every time', 'On quote — no callbacks', 'Finish photo each job'].map((item) => (
                <div key={item} className="flex items-center gap-2.5 rounded-2xl bg-amber-400/10 px-4 py-3">
                  <Check className="w-4 h-4 shrink-0 text-amber-400" />
                  <span className="text-sm text-white/80">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-center mt-8 text-sm text-white/40">
            No buy-in, no exclusivity — you keep your own clients the whole way up.
          </p>
        </div>
      </section>

      {/* ════ SOCIAL PROOF ════ */}
      <section className="bg-amber-500 px-4 lg:px-8 py-14 lg:py-16">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-lg leading-relaxed text-slate-900 font-medium">
            "Most handymen tell us the same things: work is either too much or nothing, admin takes
            half the day, and platforms like Checkatrade take money without delivering results.{' '}
            <strong>We built this to fix all three.</strong>"
          </p>
        </div>
      </section>

      {/* ════ WHAT THIS IS / ISN'T ════ */}
      <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-5 lg:gap-6">
            <div className="rounded-3xl border border-red-200 bg-white p-6 sm:p-8 shadow-xl">
              <h3 className="text-lg font-bold text-red-600 mb-4">This is NOT</h3>
              <ul className="space-y-3">
                {[
                  'An employment contract or zero-hours scheme',
                  'Exclusive — you keep your own clients',
                  'A franchise or territory buy-in',
                  'Checkatrade, Airtasker, or any lead platform',
                  'Going to charge you a monthly subscription',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <X className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <span className="text-slate-600">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl bg-slate-900 p-6 sm:p-8 shadow-xl">
              <h3 className="text-lg font-bold text-amber-400 mb-4">This IS</h3>
              <ul className="space-y-3">
                {[
                  'A genuine B2B partnership — you invoice us',
                  "Work when you want, decline when you don't",
                  'Your van, your tools, your insurance, your business',
                  'A pipeline of paid work to fill your quiet days',
                  'Next-day payment. Every time.',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <span className="text-white/85">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ════ FAQ ════ */}
      <section className="bg-slate-50 px-4 lg:px-8 py-16 lg:py-24">
        <div className="max-w-3xl mx-auto">
          <SectionHeader eyebrow="Straight answers">
            Questions you'll <span className="text-amber-500">have</span>
          </SectionHeader>

          <div className="space-y-3">
            {[
              {
                q: 'Can I still take my own customers?',
                a: "Yes — and it's legally important that you can. For IR35, you must be able to work for your own clients. We get your available days, not your entire working life.",
              },
              {
                q: 'Do I compete with other contractors for jobs?',
                a: "No. Jobs are assigned, not bid on. When you're available and a job is in your area and skill set — it's yours.",
              },
              {
                q: 'Why would I take a lower rate if I earn more solo?',
                a: "Run the real maths: solo at £60/hr but only 4–5 billable hours = £240–£300. With us, billing 6–7 hours with zero admin and next-day payment — your effective earnings are higher.",
              },
              {
                q: 'What if a customer complains?',
                a: "We handle all customer complaints. You complete the job to standard and move on. You never face an angry customer alone.",
              },
              {
                q: 'What about IR35 / tax?',
                a: "We structure as a genuine B2B subcontract — you work elsewhere, control your methods, supply your own tools. We recommend you speak to your accountant.",
              },
              {
                q: 'Do I need a uniform or branded van?',
                a: "A branded polo is provided free — it builds customer trust and gets you tips. Your van stays yours, no livery required.",
              },
            ].map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <summary className="flex items-center justify-between p-5 cursor-pointer font-bold text-base text-slate-900 select-none">
                  {q}
                  <ChevronIcon />
                </summary>
                <div className="px-5 pb-5">
                  <p className="text-sm leading-relaxed text-slate-600">{a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ════ APPLICATION FORM ════ */}
      <section ref={formRef} id="apply-form" className="bg-slate-900 px-4 lg:px-8 py-16 lg:py-24">
        <div className="max-w-xl mx-auto">
          <SectionHeader eyebrow="Apply" light sub="Takes 2 minutes. No CV. We'll ring you within 48 hours for a no-pressure chat.">
            Ready to work <span className="text-amber-400">smarter?</span>
          </SectionHeader>

          {submitted ? (
            <Card className="border-0 bg-white/10 backdrop-blur rounded-3xl">
              <CardContent className="p-8 sm:p-10 text-center">
                <div className="w-14 h-14 rounded-full mx-auto mb-5 bg-amber-400/20 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-amber-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Nice one.</h3>
                <p className="text-white/60 text-sm">
                  We'll give you a ring within 48 hours for a no-pressure chat.
                  <br />
                  No interviews. No assessments. Just a conversation over a brew.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-0 bg-white/[0.06] backdrop-blur rounded-3xl">
              <CardContent className="p-5 sm:p-7 space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/70 mb-1.5 block text-sm">
                      Your name <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={form.name}
                      onChange={(e) => set('name', e.target.value)}
                      placeholder="e.g. Richard"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl focus:border-amber-400 focus:ring-amber-400"
                    />
                    {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
                  </div>
                  <div>
                    <Label className="text-white/70 mb-1.5 block text-sm">
                      Phone <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="07xxx xxxxxx"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl focus:border-amber-400 focus:ring-amber-400"
                    />
                    {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
                  </div>
                </div>

                <div>
                  <Label className="text-white/70 mb-1.5 block text-sm">Where are you based?</Label>
                  <Input
                    value={form.area}
                    onChange={(e) => set('area', e.target.value)}
                    placeholder="e.g. Beeston, NG9"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl focus:border-amber-400 focus:ring-amber-400"
                  />
                </div>

                <div>
                  <Label className="text-white/70 mb-1.5 block text-sm">
                    Who told you about us? <span className="text-white/30">(optional)</span>
                  </Label>
                  <Input
                    value={form.referredBy}
                    onChange={(e) => set('referredBy', e.target.value)}
                    placeholder="e.g. Craig — one of our tradesmen"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl focus:border-amber-400 focus:ring-amber-400"
                  />
                  <p className="text-[11px] text-white/30 mt-1.5">
                    Referred by someone on the team? Drop their name — it moves you up the queue.
                  </p>
                </div>

                <div>
                  <Label className="text-white/70 mb-2.5 block text-sm">What trades do you cover?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {TRADES.map((trade) => (
                      <label
                        key={trade}
                        className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 cursor-pointer hover:border-white/20 transition-colors"
                      >
                        <Checkbox
                          checked={form.trades.includes(trade)}
                          onCheckedChange={() => toggleTrade(trade)}
                          className="border-white/20 data-[state=checked]:bg-amber-400 data-[state=checked]:border-amber-400"
                        />
                        <span className="text-white/70 text-xs">{trade}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-white/70 mb-2.5 block text-sm">
                    How many days/week are you looking for?
                  </Label>
                  <div className="grid grid-cols-4 gap-2">
                    {DAYS_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set('daysPerWeek', opt)}
                        className={`rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors ${
                          form.daysPerWeek === opt
                            ? 'border-amber-400 bg-amber-400/15 text-amber-400'
                            : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-white/70 mb-1.5 block text-sm">
                    Anything else? <span className="text-white/30">(optional)</span>
                  </Label>
                  <textarea
                    value={form.message}
                    onChange={(e) => set('message', e.target.value)}
                    rows={3}
                    placeholder="e.g. I've got my own landlord clients but want 2 steady days a week..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/20 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                  />
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full py-6 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-full text-lg"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending...
                    </>
                  ) : (
                    <>
                      Apply now — let's talk <ArrowRight className="w-5 h-5 ml-2" />
                    </>
                  )}
                </Button>

                <p className="text-[11px] text-white/30 text-center leading-relaxed">
                  No commitment. We'll ring you for a quick chat to see if it's a fit.
                  <br />
                  Your details stay private — we don't share them with anyone.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* ════ FOOTER ════ */}
      <footer className="bg-slate-800 px-4 lg:px-8 py-10">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-8">
            <SiGoogle className="w-5 h-5 text-white" />
            <div className="flex items-center gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <span className="text-white font-medium text-sm">4.9 · 300+ homeowners served</span>
          </div>
          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Handy Services" className="w-8 h-8 rounded-full" />
              <div>
                <p className="text-white font-bold text-sm">Handy Services</p>
                <p className="text-white/40 text-xs">Next-day slots · Fast &amp; reliable · Fully insured</p>
              </div>
            </div>
            <div className="text-center sm:text-right">
              <a href="tel:07449501762" className="text-white font-bold text-sm">
                07449 501 762
              </a>
              <p className="text-white/40 text-xs">info@handyservices.co.uk</p>
            </div>
          </div>
          <p className="text-center text-white/20 text-[10px] mt-6">
            All contractor partnerships are genuine self-employed B2B relationships. We do not offer
            employment, zero-hours contracts, or franchises.
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Tiny helper ───────────────────────────────────────────────────────────

function ChevronIcon() {
  return (
    <svg
      className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
