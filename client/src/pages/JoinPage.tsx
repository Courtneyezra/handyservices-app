import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowDown,
  Calendar,
  Check,
  CheckCircle2,
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

// ─── Brand Constants (Handy Services) ──────────────────────────────────────

const NAVY = '#1B2A4A';
const YELLOW = '#F5A623';
const LIGHT_BG = '#F7F8FC';
const DARK_TEXT = '#111827';
const MUTED = '#6B7280';
const BORDER = '#D0D5E3';

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


// ─── Pain Points (from pitch doc) ──────────────────────────────────────────

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

// ─── Benefits (5 pitch arguments) ──────────────────────────────────────────

const BENEFITS = [
  {
    icon: Calendar,
    title: 'A full, predictable calendar',
    desc: "We have more jobs than we can fill. You tell us which days you're available — we fill them. No cold weeks.",
    colour: YELLOW,
  },
  {
    icon: Wrench,
    title: 'Zero admin — just do the work',
    desc: 'No quoting. No invoicing. No chasing. Show up, do the job, get paid. We handle everything before and after.',
    colour: YELLOW,
  },
  {
    icon: Zap,
    title: 'Fast pay — within 24 hours',
    desc: "We pay within 24 hours of job sign-off. No 30-day invoices. No chasing. Your bank balance goes up the day after you work.",
    colour: YELLOW,
  },
  {
    icon: Shield,
    title: 'No-show protection',
    desc: 'Every booking has a customer deposit. If they cancel inside 24 hours, you still get paid a portion. We take the hit — not you.',
    colour: YELLOW,
  },
  {
    icon: Users,
    title: 'Jobs assigned — not bid on',
    desc: "We're not Checkatrade. You don't compete with anyone. The job is yours — no bidding, no price-cutting, no racing to respond.",
    colour: YELLOW,
  },
];

// ─── Form types ────────────────────────────────────────────────────────────

interface FormData {
  name: string;
  phone: string;
  trades: string[];
  area: string;
  daysPerWeek: string;
  message: string;
}

const INITIAL_FORM: FormData = {
  name: '',
  phone: '',
  trades: [],
  area: '',
  daysPerWeek: '',
  message: '',
};

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
    <div className="min-h-screen antialiased" style={{ backgroundColor: LIGHT_BG, fontFamily: "'Poppins', sans-serif" }}>
      {/* ════════════════════════════════════════════════════════════════════
          NAV BAR
      ════════════════════════════════════════════════════════════════════ */}
      <nav
        className="w-full px-4 sm:px-6"
        style={{ backgroundColor: NAVY }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Handy Services" className="w-9 h-9 rounded-full" />
            <span className="text-white font-bold text-base tracking-tight">Handy Services</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 text-sm">
              <Star className="w-3.5 h-3.5" style={{ color: YELLOW }} />
              <Star className="w-3.5 h-3.5" style={{ color: YELLOW }} />
              <Star className="w-3.5 h-3.5" style={{ color: YELLOW }} />
              <Star className="w-3.5 h-3.5" style={{ color: YELLOW }} />
              <Star className="w-3.5 h-3.5" style={{ color: YELLOW }} />
              <span className="text-white/70 text-xs ml-1">4.9 from 300+ Reviews</span>
            </div>
            <a
              href="tel:07449501762"
              className="flex items-center gap-1.5 text-white font-bold text-sm"
            >
              <Phone className="w-4 h-4" />
              <span className="hidden sm:inline">07449 501 762</span>
            </a>
          </div>
        </div>
      </nav>

      {/* Yellow accent strip */}
      <div className="w-full py-2 text-center" style={{ backgroundColor: YELLOW }}>
        <p className="text-xs sm:text-sm font-bold" style={{ color: NAVY }}>
          Now Onboarding Contractors in Greater Nottingham & Derby
        </p>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          HERO
      ════════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden" style={{ backgroundColor: NAVY }}>
        {/* Subtle diagonal lines */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 20px,
              #fff 20px,
              #fff 21px
            )`,
          }}
        />

        {/* Yellow glow */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full blur-[180px] opacity-[0.06]"
          style={{ backgroundColor: YELLOW }}
        />

        <div className="relative max-w-5xl mx-auto px-4 pt-16 pb-14 sm:pt-24 sm:pb-20 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.08] text-white">
            Full Calendar.{' '}
            <span style={{ color: YELLOW }}>Zero Admin.</span>
            <br />
            Next-Day Pay.
          </h1>

          <p className="mt-5 text-lg sm:text-xl text-white/50 max-w-2xl mx-auto font-medium leading-relaxed">
            Stop chasing work. Stop chasing invoices.{' '}
            <span className="text-white/80">
              We send the jobs to you — you do what you're good at.
            </span>
          </p>

          {/* Trust badges */}
          <div className="mt-8 flex flex-wrap justify-center gap-3 sm:gap-4">
            {[
              'Fully booked schedules',
              'Assigned jobs — no bidding',
              '24-hr payment',
              'No-show deposit protection',
            ].map((badge) => (
              <div
                key={badge}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: `${YELLOW}15`, color: YELLOW }}
              >
                <Check className="w-3.5 h-3.5" />
                {badge}
              </div>
            ))}
          </div>

          <Button
            size="lg"
            onClick={scrollToForm}
            className="mt-10 text-base px-8 py-6 rounded-xl font-bold shadow-lg transition-all hover:opacity-90"
            style={{ backgroundColor: YELLOW, color: NAVY }}
          >
            Apply to Join <ArrowDown className="ml-2 w-5 h-5" />
          </Button>

          <p className="mt-4 text-xs text-white/30">
            Takes 2 minutes. No CV needed. We'll ring you within 48 hours.
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          PROBLEM SECTION — "Sound familiar?"
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 sm:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2" style={{ color: NAVY }}>
            Sound familiar?
          </h2>
          <p className="text-center mb-12 text-sm" style={{ color: MUTED }}>
            You're good at the work. You shouldn't have to be good at running a business too.
          </p>

          <div className="grid md:grid-cols-3 gap-5">
            {PAIN_POINTS.map((pain) => {
              const Icon = pain.icon;
              return (
                <div
                  key={pain.headline}
                  className="rounded-xl border p-6 bg-white"
                  style={{ borderColor: BORDER }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${NAVY}08` }}
                    >
                      <Icon className="w-5 h-5" style={{ color: NAVY }} />
                    </div>
                    <div>
                      <p className="text-2xl font-black" style={{ color: YELLOW }}>
                        {pain.stat}
                      </p>
                      <p className="text-[10px] leading-tight" style={{ color: MUTED }}>
                        {pain.statLabel}
                      </p>
                    </div>
                  </div>

                  <h3 className="font-bold text-sm mb-3" style={{ color: NAVY }}>
                    {pain.headline}
                  </h3>

                  <blockquote
                    className="text-sm italic leading-relaxed mb-2 pl-3"
                    style={{ color: DARK_TEXT, borderLeft: `3px solid ${YELLOW}` }}
                  >
                    "{pain.quote}"
                  </blockquote>
                  <p className="text-[10px]" style={{ color: MUTED }}>
                    — {pain.source}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          HOW IT WORKS — 3 steps
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 sm:py-20 px-4" style={{ backgroundColor: NAVY }}>
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            How it works
          </h2>
          <p className="text-white/40 mb-12 text-sm">
            No bidding. No quoting. No admin. Just work.
          </p>

          <div className="grid sm:grid-cols-3 gap-6 sm:gap-8">
            {[
              {
                step: '1',
                icon: MessageSquare,
                title: 'Tell us your availability',
                desc: 'AM, PM, or full day — tell us when you\'re free and we slot jobs around your existing work.',
              },
              {
                step: '2',
                icon: Wrench,
                title: 'We send you booked jobs',
                desc: 'Job card with address, job type, duration, and your rate. Accept or decline — your choice.',
              },
              {
                step: '3',
                icon: PoundSterling,
                title: 'Complete & get paid',
                desc: 'Finish the job, send a photo. Money in your account within 24 hours.',
              },
            ].map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.step} className="text-center">
                  <div className="flex flex-col items-center gap-2 mb-4">
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-black"
                      style={{ backgroundColor: YELLOW, color: NAVY }}
                    >
                      {step.step}
                    </span>
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center"
                      style={{ backgroundColor: `${YELLOW}15` }}
                    >
                      <Icon className="w-6 h-6" style={{ color: YELLOW }} />
                    </div>
                  </div>
                  <h3 className="font-bold text-white text-sm mb-1.5">{step.title}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{step.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          HOW YOU GET PAID — AM/PM + per-job rates
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 sm:py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2" style={{ color: NAVY }}>
            How you get paid
          </h2>
          <p className="text-center mb-10 text-sm" style={{ color: MUTED }}>
            Tell us when you're free. We send you jobs with the rate attached.
          </p>

          {/* AM / PM / Full Day visual */}
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            {[
              {
                slot: 'AM',
                time: '8am – 1pm',
                example: '2–3 jobs routed in your area',
                icon: '☀️',
              },
              {
                slot: 'PM',
                time: '1pm – 6pm',
                example: '2–3 jobs routed in your area',
                icon: '🌤️',
              },
              {
                slot: 'Full Day',
                time: '8am – 6pm',
                example: '4–6 jobs, full route planned',
                icon: '⚡',
              },
            ].map((s) => (
              <div
                key={s.slot}
                className="rounded-xl border bg-white p-5 text-center"
                style={{ borderColor: BORDER }}
              >
                <p className="text-2xl mb-2">{s.icon}</p>
                <p className="font-black text-lg" style={{ color: NAVY }}>{s.slot}</p>
                <p className="text-xs font-medium mb-3" style={{ color: MUTED }}>{s.time}</p>
                <p className="text-xs" style={{ color: MUTED }}>{s.example}</p>
              </div>
            ))}
          </div>

          {/* Per-job rate explanation */}
          <div
            className="rounded-xl border-2 p-6"
            style={{ borderColor: YELLOW, backgroundColor: '#FFF8EC' }}
          >
            <div className="flex items-start gap-4">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${YELLOW}25` }}
              >
                <PoundSterling className="w-5 h-5" style={{ color: NAVY }} />
              </div>
              <div>
                <h3 className="font-bold text-sm mb-2" style={{ color: NAVY }}>
                  Per-job rate card — not hourly, not day rate
                </h3>
                <p className="text-sm leading-relaxed mb-3" style={{ color: MUTED }}>
                  Every job comes with the rate attached before you accept it. Tap repair: you know what you'll earn.
                  Door hang: you know what you'll earn. No clock-watching, no surprises.
                </p>
                <div className="grid sm:grid-cols-2 gap-3 text-xs" style={{ color: DARK_TEXT }}>
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: YELLOW }} />
                    <span><strong>Faster = more jobs = more money.</strong> Efficient tradesmen earn more, not the same.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: YELLOW }} />
                    <span><strong>See the rate before you say yes.</strong> No job is ever a surprise.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: YELLOW }} />
                    <span><strong>Multiple jobs per slot.</strong> We route 2–3 jobs into an AM so you stay busy and earning.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: YELLOW }} />
                    <span><strong>Your skill is rewarded.</strong> Diagnose it in 5 minutes? You still earn the full job rate.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          5 BENEFITS — pitch arguments
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-16 sm:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2" style={{ color: NAVY }}>
            What you get
          </h2>
          <p className="text-center mb-12 text-sm" style={{ color: MUTED }}>
            Every contractor gets all of this. No tiers, no hidden games.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <div
                  key={benefit.title}
                  className="rounded-xl border bg-white p-5 hover:shadow-md transition-shadow"
                  style={{ borderColor: BORDER }}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                    style={{ backgroundColor: `${YELLOW}15` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: YELLOW }} />
                  </div>
                  <h3 className="font-bold text-sm mb-1.5" style={{ color: NAVY }}>
                    {benefit.title}
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
                    {benefit.desc}
                  </p>
                </div>
              );
            })}

            {/* The "real maths" card — standout */}
            <div
              className="rounded-xl border-2 p-5 sm:col-span-2 lg:col-span-1"
              style={{
                borderColor: YELLOW,
                backgroundColor: '#FFF8EC',
              }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                style={{ backgroundColor: `${YELLOW}25` }}
              >
                <Zap className="w-5 h-5" style={{ color: NAVY }} />
              </div>
              <h3 className="font-bold text-sm mb-1.5" style={{ color: NAVY }}>
                The real maths
              </h3>
              <p className="text-xs leading-relaxed mb-3" style={{ color: MUTED }}>
                Solo at £60/hr but only 4 billable hours = £240/day.
              </p>
              <p className="text-xs leading-relaxed" style={{ color: NAVY }}>
                <strong>With us</strong> at sub-rate, billing 6–7 hours with zero admin, no no-shows, and next-day payment — you earn more, with less stress.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SOCIAL PROOF — real quotes
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-14 px-4" style={{ backgroundColor: `${NAVY}06` }}>
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm leading-relaxed max-w-2xl mx-auto" style={{ color: MUTED }}>
            "Most handymen tell us the same things: work is either too much or nothing, admin takes half the day,
            and platforms like Checkatrade take money without delivering results.{' '}
            <strong style={{ color: NAVY }}>We built this to fix all three.</strong>"
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          WHAT THIS ISN'T / IS
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-14 sm:py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-5">
            {/* Not this */}
            <div className="rounded-xl border bg-white p-5 sm:p-6" style={{ borderColor: '#FCA5A5' }}>
              <h3 className="text-base font-bold text-red-600 mb-4">This is NOT</h3>
              <ul className="space-y-2.5">
                {[
                  'An employment contract or zero-hours scheme',
                  'Exclusive — you keep your own clients',
                  'A franchise or territory buy-in',
                  'Checkatrade, Airtasker, or any lead platform',
                  'Going to charge you a monthly subscription',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <X className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <span style={{ color: MUTED }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* This is */}
            <div
              className="rounded-xl border-2 p-5 sm:p-6"
              style={{ borderColor: YELLOW, backgroundColor: '#FFF8EC' }}
            >
              <h3 className="text-base font-bold mb-4" style={{ color: NAVY }}>
                This IS
              </h3>
              <ul className="space-y-2.5">
                {[
                  'A genuine B2B partnership — you invoice us',
                  'Work when you want, decline when you don\'t',
                  'Your van, your tools, your insurance, your business',
                  'A pipeline of paid work to fill your quiet days',
                  'Next-day payment. Every time.',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: YELLOW }} />
                    <span style={{ color: DARK_TEXT }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          FAQ — from objection handling
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-14 sm:py-16 px-4" style={{ backgroundColor: `${NAVY}04` }}>
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8" style={{ color: NAVY }}>
            Questions you'll have
          </h2>

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
              <details
                key={q}
                className="group rounded-xl border bg-white overflow-hidden"
                style={{ borderColor: BORDER }}
              >
                <summary
                  className="flex items-center justify-between p-4 cursor-pointer font-bold text-sm select-none"
                  style={{ color: NAVY }}
                >
                  {q}
                  <ChevronIcon />
                </summary>
                <div className="px-4 pb-4">
                  <p className="text-sm leading-relaxed" style={{ color: MUTED }}>
                    {a}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          APPLICATION FORM
      ════════════════════════════════════════════════════════════════════ */}
      <section
        className="py-16 sm:py-20 px-4"
        style={{ backgroundColor: NAVY }}
        id="apply-form"
        ref={formRef}
      >
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-white mb-2">
            Ready to work smarter?
          </h2>
          <p className="text-white/40 text-center mb-8 text-sm">
            Takes 2 minutes. No CV. We'll ring you within 48 hours for a no-pressure chat.
          </p>

          {submitted ? (
            <Card className="border-0 bg-white/10 backdrop-blur">
              <CardContent className="p-8 sm:p-10 text-center">
                <div
                  className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center"
                  style={{ backgroundColor: `${YELLOW}25` }}
                >
                  <CheckCircle2 className="w-7 h-7" style={{ color: YELLOW }} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Nice one.</h3>
                <p className="text-white/50 text-sm">
                  We'll give you a ring within 48 hours for a no-pressure chat.
                  <br />
                  No interviews. No assessments. Just a conversation over a brew.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-0 bg-white/[0.06] backdrop-blur">
              <CardContent className="p-5 sm:p-6 space-y-5">
                {/* Name + Phone side by side */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/60 mb-1.5 block text-sm">
                      Your name <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={form.name}
                      onChange={(e) => set('name', e.target.value)}
                      placeholder="e.g. Richard"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-[#F5A623] focus:ring-[#F5A623]"
                    />
                    {errors.name && (
                      <p className="text-red-400 text-xs mt-1">{errors.name}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-white/60 mb-1.5 block text-sm">
                      Phone <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="07xxx xxxxxx"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-[#F5A623] focus:ring-[#F5A623]"
                    />
                    {errors.phone && (
                      <p className="text-red-400 text-xs mt-1">{errors.phone}</p>
                    )}
                  </div>
                </div>

                {/* Area */}
                <div>
                  <Label className="text-white/60 mb-1.5 block text-sm">
                    Where are you based?
                  </Label>
                  <Input
                    value={form.area}
                    onChange={(e) => set('area', e.target.value)}
                    placeholder="e.g. Beeston, NG9"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-[#F5A623] focus:ring-[#F5A623]"
                  />
                </div>

                {/* Trades */}
                <div>
                  <Label className="text-white/60 mb-2.5 block text-sm">
                    What trades do you cover?
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {TRADES.map((trade) => (
                      <label
                        key={trade}
                        className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 cursor-pointer hover:border-white/20 transition-colors text-sm"
                      >
                        <Checkbox
                          checked={form.trades.includes(trade)}
                          onCheckedChange={() => toggleTrade(trade)}
                          className="border-white/20 data-[state=checked]:bg-[#F5A623] data-[state=checked]:border-[#F5A623]"
                        />
                        <span className="text-white/60 text-xs">{trade}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Days per week */}
                <div>
                  <Label className="text-white/60 mb-2.5 block text-sm">
                    How many days/week are you looking for?
                  </Label>
                  <div className="grid grid-cols-4 gap-2">
                    {DAYS_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set('daysPerWeek', opt)}
                        className={`rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${
                          form.daysPerWeek === opt
                            ? ''
                            : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20'
                        }`}
                        style={
                          form.daysPerWeek === opt
                            ? {
                                borderColor: YELLOW,
                                backgroundColor: `${YELLOW}15`,
                                color: YELLOW,
                              }
                            : undefined
                        }
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Free text */}
                <div>
                  <Label className="text-white/60 mb-1.5 block text-sm">
                    Anything else? <span className="text-white/30">(optional)</span>
                  </Label>
                  <textarea
                    value={form.message}
                    onChange={(e) => set('message', e.target.value)}
                    rows={3}
                    placeholder="e.g. I've got my own landlord clients but want 2 steady days a week..."
                    className="w-full rounded-lg border border-white/10 bg-white/5 text-white placeholder:text-white/15 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#F5A623] focus:border-[#F5A623]"
                  />
                </div>

                {/* Submit */}
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full py-5 text-base font-bold rounded-xl shadow-lg transition-all hover:opacity-90"
                  style={{ backgroundColor: YELLOW, color: NAVY }}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending...
                    </>
                  ) : (
                    "Apply Now — Let's Talk"
                  )}
                </Button>

                <p className="text-[11px] text-white/25 text-center leading-relaxed">
                  No commitment. We'll ring you for a quick chat to see if it's a fit.
                  <br />
                  Your details stay private — we don't share them with anyone.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════════════════════ */}
      <footer className="py-8 px-4" style={{ backgroundColor: NAVY }}>
        <div className="max-w-5xl mx-auto">
          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Handy Services" className="w-8 h-8 rounded-full" />
              <div>
                <p className="text-white font-bold text-sm">Handy Services</p>
                <p className="text-white/30 text-xs">
                  Next-day slots · Fast & reliable · Fully insured
                </p>
              </div>
            </div>
            <div className="text-right">
              <a href="tel:07449501762" className="text-white font-bold text-sm">
                07449 501 762
              </a>
              <p className="text-white/30 text-xs">info@handyservices.co.uk</p>
            </div>
          </div>
          <p className="text-center text-white/15 text-[10px] mt-6">
            All contractor partnerships are genuine self-employed B2B relationships. We do not offer employment, zero-hours contracts, or franchises.
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
      className="w-5 h-5 transition-transform group-open:rotate-180"
      style={{ color: MUTED }}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
