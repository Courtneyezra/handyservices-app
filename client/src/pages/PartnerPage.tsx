import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  ArrowDown,
  BarChart3,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Globe,
  Handshake,
  Headphones,
  Loader2,
  Lock,
  MapPin,
  Megaphone,
  Phone,
  PoundSterling,
  Rocket,
  Shield,
  Star,
  TrendingUp,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';

// ─── Accent color ─────────────────────────────────────────────────────────────

const ACCENT = '#7DB00E';

// ─── Territory data ───────────────────────────────────────────────────────────

const TERRITORIES = [
  { name: 'Nottingham / Derby', status: 'ACTIVE', color: ACCENT, bgColor: `${ACCENT}20`, borderColor: `${ACCENT}40` },
  { name: 'Leicester', status: 'AVAILABLE', color: '#f59e0b', bgColor: '#f59e0b20', borderColor: '#f59e0b60', highlight: true },
  { name: 'Northampton', status: 'COMING SOON', color: '#6b7280', bgColor: '#6b728015', borderColor: '#6b728040' },
  { name: 'Lincoln', status: 'COMING SOON', color: '#6b7280', bgColor: '#6b728015', borderColor: '#6b728040' },
  { name: 'Mansfield', status: 'COMING SOON', color: '#6b7280', bgColor: '#6b728015', borderColor: '#6b728040' },
  { name: 'Loughborough', status: 'COMING SOON', color: '#6b7280', bgColor: '#6b728015', borderColor: '#6b728040' },
];

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQS = [
  {
    q: 'Do I need trade experience?',
    a: "No. You're the operator, not the tradesperson. We help you hire skilled handymen through our proven recruitment and assessment process. Your job is to manage the territory, build relationships, and grow the business.",
  },
  {
    q: "What's the total investment?",
    a: "From \u00a325k covers initial setup, your first hire, van lease deposit, tools and equipment, and working capital to cover the first 3 months while revenue ramps up.",
  },
  {
    q: 'How do you make money?',
    a: "A small monthly platform fee plus a percentage of territory revenue. Our incentives are fully aligned \u2014 we only succeed when you succeed.",
  },
  {
    q: 'What territory exclusivity do I get?',
    a: "Full exclusivity within your agreed postcode areas. No other HandyServices partner will operate in your territory. You own it.",
  },
  {
    q: 'How long to break even?',
    a: "Most territories are projected to break even within 4\u20136 months, based on our Nottingham performance data. Your discovery call will include territory-specific projections.",
  },
  {
    q: 'Can I run this part-time?',
    a: "Initially yes \u2014 especially if you're transitioning from employment. But successful partners typically go full-time within 3\u20136 months as the territory grows.",
  },
];

// ─── Form types ───────────────────────────────────────────────────────────────

interface FormData {
  fullName: string;
  email: string;
  phone: string;
  territoryInterest: string;
  investmentBudget: string;
  currentSituation: string;
  message: string;
}

const INITIAL_FORM: FormData = {
  fullName: '',
  email: '',
  phone: '',
  territoryInterest: '',
  investmentBudget: '',
  currentSituation: '',
  message: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PartnerPage() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const set = (key: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.fullName.trim()) e.fullName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim()) e.phone = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/partner/enquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
    <div className="min-h-screen bg-gray-950 text-white antialiased">
      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — HERO
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden">
        {/* Background gradient + subtle pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
          }}
        />

        {/* Glow accents */}
        <div
          className="absolute top-1/4 -left-32 w-96 h-96 rounded-full blur-[128px] opacity-20"
          style={{ backgroundColor: ACCENT }}
        />
        <div
          className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full blur-[128px] opacity-10"
          style={{ backgroundColor: ACCENT }}
        />

        <div className="relative max-w-5xl mx-auto px-4 py-24 sm:py-32 lg:py-40 text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium mb-8"
            style={{ borderColor: `${ACCENT}50`, color: ACCENT }}
          >
            <Handshake className="w-4 h-4" /> Area Partnership
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1]">
            Own Your <span style={{ color: ACCENT }}>Territory</span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl lg:text-2xl font-medium text-white/70 max-w-3xl mx-auto">
            Run a tech-enabled handyman business in your area. We provide the platform, the brand, and the playbook. You build the team and own the market.
          </p>

          <p className="mt-4 text-base text-white/50 max-w-2xl mx-auto">
            Now expanding across the East Midlands — Leicester territory available
          </p>

          <Button
            size="lg"
            onClick={scrollToForm}
            className="mt-10 text-lg px-8 py-6 rounded-xl font-bold shadow-lg shadow-[#7DB00E]/20 hover:shadow-[#7DB00E]/40 transition-all"
            style={{ backgroundColor: ACCENT, color: '#111' }}
          >
            Express Interest <ArrowDown className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — THE OPPORTUNITY
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative py-20 sm:py-28 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            The <span style={{ color: ACCENT }}>Opportunity</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-2xl mx-auto">
            The UK handyman market is fragmented — dominated by sole traders, no dominant brand, no tech advantage. HandyServices has built the system and proven it in Nottingham. Now we're scaling territory by territory.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[
              {
                icon: PoundSterling,
                value: '\u00a3293',
                label: 'Avg Job Value',
                note: 'Proven in Nottingham',
              },
              {
                icon: TrendingUp,
                value: '14+',
                label: 'Jobs Per Month',
                note: 'Growing MoM',
              },
              {
                icon: Zap,
                value: '\u00a360/hr',
                label: 'Effective Rate',
                note: 'Before premium pricing',
              },
              {
                icon: Brain,
                value: 'AI-Powered',
                label: 'Tech Platform',
                note: 'Pricing, quoting, CRM',
              },
            ].map(({ icon: Icon, value, label, note }) => (
              <Card
                key={label}
                className="bg-gray-800/60 border-gray-700/50 hover:border-[#7DB00E]/40 transition-colors"
              >
                <CardContent className="p-6 text-center">
                  <div
                    className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
                    style={{ backgroundColor: `${ACCENT}15` }}
                  >
                    <Icon className="w-6 h-6" style={{ color: ACCENT }} />
                  </div>
                  <p className="text-2xl font-bold text-white">{value}</p>
                  <p className="text-white/70 text-sm font-medium mt-1">{label}</p>
                  <p className="text-white/40 text-xs mt-1">{note}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3 — WHAT YOU GET
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4 bg-gray-900/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            What You <span style={{ color: ACCENT }}>Get</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-xl mx-auto">
            Everything you need to launch and run a profitable handyman business.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[
              {
                icon: Brain,
                title: 'AI-Powered Platform',
                desc: 'Pricing engine, automated quoting, call transcription, and full CRM — all built and maintained for you.',
              },
              {
                icon: Megaphone,
                title: 'Marketing Engine',
                desc: 'SEO, Google Ads, and lead generation done centrally. You receive qualified leads from day one.',
              },
              {
                icon: BookOpen,
                title: 'Training & Playbooks',
                desc: 'Hiring assessments, operations manuals, customer service scripts — everything documented and refined.',
              },
              {
                icon: Star,
                title: 'Brand & Reputation',
                desc: '4.9\u2605 Google rating, \u00a32M insurance, professional branding — instant credibility in your territory.',
              },
              {
                icon: Headphones,
                title: 'Ongoing Support',
                desc: 'Regular check-ins, performance dashboards, and continuous platform improvements. We grow together.',
              },
              {
                icon: BarChart3,
                title: 'Revenue Streams',
                desc: 'Standard jobs, emergency/priority pricing (30-50% premium), landlord recurring contracts, and seasonal services.',
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex items-start gap-4 rounded-2xl border border-gray-800 bg-gray-800/40 p-6"
              >
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${ACCENT}15` }}
                >
                  <Icon className="w-5 h-5" style={{ color: ACCENT }} />
                </div>
                <div>
                  <p className="font-bold text-white text-sm">{title}</p>
                  <p className="text-white/50 text-sm leading-relaxed mt-1">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Service categories */}
          <div className="mt-12 text-center">
            <p className="text-white/40 text-sm mb-4">Service categories proven in market:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {['Painting', 'General Fixing', 'Carpentry', 'Silicone & Sealant', 'Electrical', 'Curtains & Blinds', 'Fencing'].map(
                (cat) => (
                  <span
                    key={cat}
                    className="rounded-full border border-gray-700 bg-gray-900/60 px-3 py-1 text-xs text-white/50"
                  >
                    {cat}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4 — TERRITORY MAP
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            Available <span style={{ color: ACCENT }}>Territories</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-xl mx-auto">
            We're expanding across the East Midlands. Secure your territory before someone else does.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TERRITORIES.map((t) => (
              <div
                key={t.name}
                className={`relative rounded-2xl border-2 p-6 transition-all ${
                  t.highlight
                    ? 'ring-2 ring-amber-500/30 scale-[1.02]'
                    : ''
                }`}
                style={{
                  backgroundColor: t.bgColor,
                  borderColor: t.borderColor,
                }}
              >
                {t.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-amber-500 text-gray-950 text-[10px] uppercase tracking-wider font-bold px-3 py-1">
                      Primary Opportunity
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MapPin className="w-5 h-5" style={{ color: t.color }} />
                    <span className="font-bold text-white">{t.name}</span>
                  </div>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider font-bold"
                    style={{ backgroundColor: `${t.color}20`, color: t.color }}
                  >
                    {t.status}
                  </span>
                </div>

                {t.highlight && (
                  <p className="text-amber-200/60 text-sm mt-3">
                    Strong demand signals. Ready for partner launch.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5 — THE NUMBERS (TEASER)
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4 bg-gray-900/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            The <span style={{ color: ACCENT }}>Numbers</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-xl mx-auto">
            A snapshot of the financial model. Request full access for detailed projections.
          </p>

          {/* Visible numbers */}
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            {[
              { value: 'From \u00a325k', label: 'Total Investment', sub: 'Setup, first hire, van, working capital' },
              { value: '4\u20136 Months', label: 'Projected Break-Even', sub: 'Based on Nottingham data' },
              { value: '\u00a370k+', label: 'Annual Revenue Per Territory', sub: 'At scale with 1 handyman' },
            ].map(({ value, label, sub }) => (
              <Card key={label} className="bg-gray-800/60 border-gray-700/50">
                <CardContent className="p-6 text-center">
                  <p className="text-2xl sm:text-3xl font-bold" style={{ color: ACCENT }}>
                    {value}
                  </p>
                  <p className="text-white/80 font-medium text-sm mt-2">{label}</p>
                  <p className="text-white/40 text-xs mt-1">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Blurred/locked section */}
          <div className="relative rounded-2xl border-2 border-dashed border-gray-700 overflow-hidden">
            {/* Blurred content behind */}
            <div className="p-8 blur-[6px] select-none pointer-events-none">
              <div className="grid sm:grid-cols-3 gap-6">
                <div className="text-center">
                  <p className="text-xl font-bold text-white/60">Detailed P&L</p>
                  <p className="text-sm text-white/30 mt-1">Month-by-month projections</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-white/60">ROI Projections</p>
                  <p className="text-sm text-white/30 mt-1">12/24/36 month returns</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-white/60">Territory Analysis</p>
                  <p className="text-sm text-white/30 mt-1">Demand data per postcode area</p>
                </div>
              </div>
              <div className="mt-6 space-y-2">
                <div className="h-4 bg-gray-700/40 rounded w-full" />
                <div className="h-4 bg-gray-700/40 rounded w-5/6" />
                <div className="h-4 bg-gray-700/40 rounded w-4/6" />
              </div>
            </div>

            {/* Overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/60 backdrop-blur-[2px]">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: `${ACCENT}20` }}
              >
                <Lock className="w-6 h-6" style={{ color: ACCENT }} />
              </div>
              <p className="text-white font-bold text-lg mb-1">Full Financial Model</p>
              <p className="text-white/50 text-sm mb-5 text-center max-w-sm px-4">
                Request access to see the full P&L breakdown, ROI projections, and territory-specific analysis.
              </p>
              <Button
                onClick={scrollToForm}
                className="rounded-xl font-bold shadow-lg shadow-[#7DB00E]/20 hover:shadow-[#7DB00E]/40 transition-all"
                style={{ backgroundColor: ACCENT, color: '#111' }}
              >
                Request Full Access
              </Button>
            </div>
          </div>

          {/* Employed model teaser */}
          <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-800/30 p-6">
            <div className="flex items-start gap-4">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${ACCENT}15` }}
              >
                <Users className="w-5 h-5" style={{ color: ACCENT }} />
              </div>
              <div>
                <p className="font-bold text-white text-sm">Employed Model Advantage</p>
                <p className="text-white/50 text-sm leading-relaxed mt-1">
                  Our handymen are employed, not subcontracted. £32k salary + van = £43.2k total cost per handyman, generating £70k+ revenue at scale. Quality control, brand consistency, and customer satisfaction built in.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 6 — HOW IT WORKS
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            How It <span style={{ color: ACCENT }}>Works</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-xl mx-auto">
            From first conversation to live territory in 8 weeks.
          </p>

          {/* Timeline / stepper */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: 1,
                icon: Phone,
                title: 'Express Interest',
                desc: 'Fill in the enquiry form below. We respond within 24 hours.',
              },
              {
                step: 2,
                icon: Globe,
                title: 'Discovery Call',
                desc: 'We share the full financial model, answer questions, and assess fit.',
              },
              {
                step: 3,
                icon: Handshake,
                title: 'Territory Agreement',
                desc: 'Agree terms, secure your exclusive postcode territory.',
              },
              {
                step: 4,
                icon: Rocket,
                title: 'Launch',
                desc: 'Hiring, training, and go-live. Your territory is operational in 8 weeks.',
              },
            ].map(({ step, icon: Icon, title, desc }, index) => (
              <div key={step} className="relative">
                {/* Connector line (hidden on mobile, visible on lg) */}
                {index < 3 && (
                  <div className="hidden lg:block absolute top-8 left-[calc(50%+24px)] right-[-24px] h-px border-t-2 border-dashed border-gray-700" />
                )}

                <div className="flex flex-col items-center text-center">
                  <div className="relative">
                    <div
                      className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                      style={{ backgroundColor: `${ACCENT}15` }}
                    >
                      <Icon className="w-7 h-7" style={{ color: ACCENT }} />
                    </div>
                    <span
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{ backgroundColor: ACCENT, color: '#111' }}
                    >
                      {step}
                    </span>
                  </div>
                  <p className="font-bold text-white text-sm mb-1">{title}</p>
                  <p className="text-white/50 text-xs leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 7 — ENQUIRY FORM
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4 bg-gray-900/50" ref={formRef} id="partner-form">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            <span style={{ color: ACCENT }}>Get Started</span>
          </h2>
          <p className="text-white/50 text-center mb-10">
            Tell us about yourself and we'll send you the full opportunity pack within 24 hours.
          </p>

          {submitted ? (
            <Card className="bg-gray-800/60 border-[#7DB00E]/30">
              <CardContent className="p-10 text-center">
                <div
                  className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
                  style={{ backgroundColor: `${ACCENT}20` }}
                >
                  <CheckCircle2 className="w-8 h-8" style={{ color: ACCENT }} />
                </div>
                <h3 className="text-2xl font-bold mb-2">Thanks for your interest!</h3>
                <p className="text-white/60">
                  We'll be in touch within 24 hours with the full opportunity pack, including detailed financials and territory analysis.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-gray-800/60 border-gray-700/50">
              <CardContent className="p-6 sm:p-8 space-y-6">
                {/* Full Name */}
                <div>
                  <Label className="text-white/70 mb-1.5 block">
                    Full Name <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    value={form.fullName}
                    onChange={(e) => set('fullName', e.target.value)}
                    placeholder="e.g. James Wilson"
                    className="bg-gray-900 border-gray-700 text-white placeholder:text-white/30"
                  />
                  {errors.fullName && (
                    <p className="text-red-400 text-xs mt-1">{errors.fullName}</p>
                  )}
                </div>

                {/* Email + Phone */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/70 mb-1.5 block">
                      Email <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="you@example.com"
                      className="bg-gray-900 border-gray-700 text-white placeholder:text-white/30"
                    />
                    {errors.email && (
                      <p className="text-red-400 text-xs mt-1">{errors.email}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-white/70 mb-1.5 block">
                      Phone <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="07xxx xxxxxx"
                      className="bg-gray-900 border-gray-700 text-white placeholder:text-white/30"
                    />
                    {errors.phone && (
                      <p className="text-red-400 text-xs mt-1">{errors.phone}</p>
                    )}
                  </div>
                </div>

                {/* Territory of Interest */}
                <div>
                  <Label className="text-white/70 mb-1.5 block">Territory of Interest</Label>
                  <Select
                    value={form.territoryInterest}
                    onValueChange={(v) => set('territoryInterest', v)}
                  >
                    <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                      <SelectValue placeholder="Select a territory..." />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-gray-700">
                      {['Leicester', 'Northampton', 'Lincoln', 'Other East Midlands', 'Other UK'].map(
                        (opt) => (
                          <SelectItem key={opt} value={opt} className="text-white/80">
                            {opt}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* Investment Budget */}
                <div>
                  <Label className="text-white/70 mb-1.5 block">Investment Budget</Label>
                  <Select
                    value={form.investmentBudget}
                    onValueChange={(v) => set('investmentBudget', v)}
                  >
                    <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                      <SelectValue placeholder="Select a range..." />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-gray-700">
                      {['\u00a325k\u2013\u00a350k', '\u00a350k\u2013\u00a3100k', '\u00a3100k+', 'Flexible'].map(
                        (opt) => (
                          <SelectItem key={opt} value={opt} className="text-white/80">
                            {opt}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* Current Situation */}
                <div>
                  <Label className="text-white/70 mb-1.5 block">Current Situation</Label>
                  <Select
                    value={form.currentSituation}
                    onValueChange={(v) => set('currentSituation', v)}
                  >
                    <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                      <SelectValue placeholder="Tell us about your background..." />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-gray-700">
                      {[
                        'Employed looking to invest',
                        'Business owner expanding',
                        'Investor / silent partner',
                        'Trade professional going into business',
                        'Other',
                      ].map((opt) => (
                        <SelectItem key={opt} value={opt} className="text-white/80">
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Message */}
                <div>
                  <Label className="text-white/70 mb-1.5 block">Message (optional)</Label>
                  <textarea
                    value={form.message}
                    onChange={(e) => set('message', e.target.value)}
                    rows={3}
                    placeholder="Tell us a bit about your interest and goals..."
                    className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#7DB00E]/50 focus:border-[#7DB00E] resize-none"
                  />
                </div>

                {/* Submit */}
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full text-base py-6 rounded-xl font-bold shadow-lg shadow-[#7DB00E]/20 hover:shadow-[#7DB00E]/40 transition-all"
                  style={{ backgroundColor: ACCENT, color: '#111' }}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Submitting...
                    </>
                  ) : (
                    <>
                      Submit Enquiry <ChevronRight className="ml-2 w-5 h-5" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 8 — FAQ
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            Frequently Asked <span style={{ color: ACCENT }}>Questions</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-xl mx-auto">
            Common questions from prospective partners.
          </p>

          <Accordion type="single" collapsible className="space-y-3">
            {FAQS.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="rounded-xl border border-gray-800 bg-gray-800/40 px-6 overflow-hidden"
              >
                <AccordionTrigger className="text-left text-white/90 font-medium text-sm hover:no-underline py-5">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-white/50 text-sm leading-relaxed pb-5">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="text-center mt-10">
            <p className="text-white/40 text-sm mb-4">Still have questions?</p>
            <Button
              variant="outline"
              onClick={scrollToForm}
              className="border-gray-700 text-white/70 hover:border-[#7DB00E]/40 hover:text-white"
            >
              Get in Touch <ChevronRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 9 — FOOTER
      ══════════════════════════════════════════════════════════════════════ */}
      <footer className="border-t border-gray-800 py-10 px-4">
        <div className="max-w-4xl mx-auto text-center space-y-3">
          <p className="text-white/70 font-semibold flex items-center justify-center gap-2">
            <Wrench className="w-4 h-4" style={{ color: ACCENT }} />
            HandyServices
          </p>
          <p className="text-white/40 text-sm">
            Tech-enabled property services across the East Midlands
          </p>
          <div className="flex items-center justify-center gap-4 pt-2">
            <a
              href="/landing"
              className="text-white/40 text-sm hover:text-white/70 transition-colors"
            >
              Main Site
            </a>
            <span className="text-white/20">|</span>
            <a
              href="/careers"
              className="text-white/40 text-sm hover:text-white/70 transition-colors"
            >
              Careers
            </a>
          </div>
          <p className="text-white/20 text-xs mt-4">&copy; 2024 HandyServices. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
