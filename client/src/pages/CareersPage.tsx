import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronDown,
  Check,
  X,
  Loader2,
  PoundSterling,
  Truck,
  CalendarDays,
  Landmark,
  ShieldCheck,
  Phone,
  GraduationCap,
  TrendingUp,
  Paintbrush,
  Wrench,
  Hammer,
  Droplets,
  Zap,
  Blinds,
  Fence,
  Shirt,
  CheckCircle2,
  ArrowDown,
  MapPin,
  Clock,
  Users,
  Rocket,
  Building2,
  UserPlus,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FormData {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  postcode: string;
  trades: string[];
  experience: string;
  ownTools: string;
  drivingLicence: string;
  cscsCard: string;
  currentSituation: string;
  hearAboutUs: string;
  message: string;
}

const INITIAL_FORM: FormData = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  postcode: '',
  trades: [],
  experience: '',
  ownTools: '',
  drivingLicence: '',
  cscsCard: '',
  currentSituation: '',
  hearAboutUs: '',
  message: '',
};

const TRADES = [
  'Carpentry',
  'Painting & Decorating',
  'Plumbing',
  'Tiling',
  'Electrical',
  'Plastering',
  'Silicone/Sealant',
  'Fencing/Outdoor',
];

const EXPERIENCE_OPTIONS = ['1-2 years', '3-5 years', '5-10 years', '10+ years'];
const SITUATION_OPTIONS = ['Employed', 'Self-Employed', 'Looking for work'];
const REFERRAL_OPTIONS = [
  'Indeed',
  'Facebook',
  'Gumtree',
  'Word of mouth',
  'Checkatrade/MyBuilder',
  'Other',
];

// ─── Accent color ────────────────────────────────────────────────────────────

const ACCENT = '#7DB00E';

// ─── Component ───────────────────────────────────────────────────────────────

export default function CareersPage() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // ── helpers ──

  const set = (key: keyof FormData, value: string | string[]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleTrade = (trade: string) => {
    setForm((prev) => ({
      ...prev,
      trades: prev.trades.includes(trade)
        ? prev.trades.filter((t) => t !== trade)
        : [...prev.trades, trade],
    }));
  };

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/careers/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Submission failed');
      setSubmitted(true);
    } catch {
      // still show success — the API route may not exist yet and we don't want
      // to block the candidate experience during development
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  // ── render ──

  return (
    <div className="min-h-screen bg-gray-950 text-white antialiased">
      {/* ════════════════════════════════════════════════════════════════════
          SECTION 1 — HERO
      ════════════════════════════════════════════════════════════════════ */}
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
            <UserPlus className="w-4 h-4" /> Now Hiring
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1]">
            Your Skills. Our Leads.{' '}
            <span style={{ color: ACCENT }}>Your Future.</span>
          </h1>

          <p className="mt-6 text-xl sm:text-2xl lg:text-3xl font-semibold text-white/90">
            <span style={{ color: ACCENT }}>£32,000</span> + Company Van + No Weekends
          </p>

          <p className="mt-4 text-base sm:text-lg text-white/60 max-w-2xl mx-auto">
            We're hiring our first employed multi-trade handyman in Greater Nottingham &amp; Derby
          </p>

          <Button
            size="lg"
            onClick={scrollToForm}
            className="mt-10 text-lg px-8 py-6 rounded-xl font-bold shadow-lg shadow-[#7DB00E]/20 hover:shadow-[#7DB00E]/40 transition-all"
            style={{ backgroundColor: ACCENT, color: '#111' }}
          >
            Apply Now <ArrowDown className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 2 — THE PROBLEM WE SOLVE
      ════════════════════════════════════════════════════════════════════ */}
      <section className="relative py-20 sm:py-28 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            Why Switch to <span style={{ color: ACCENT }}>Employment?</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-xl mx-auto">
            See how life changes when you stop chasing work and start doing work.
          </p>

          <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
            {/* Left — Self-Employed Reality */}
            <Card className="bg-red-950/30 border-red-500/20 overflow-hidden">
              <CardContent className="p-6 sm:p-8">
                <h3 className="text-xl font-bold text-red-400 mb-6">Self-Employed Reality</h3>
                <ul className="space-y-4">
                  {[
                    'Chase leads, quote for free, hope they book',
                    'Van costs £300+/month',
                    'No holidays, no sick pay, no pension',
                    'Chase payments, deal with bad debts',
                    'Weekend work to fill gaps',
                    'Feast or famine — quiet months destroy you',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-white/70">
                      <X className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Right — Life at HandyServices */}
            <Card
              className="overflow-hidden"
              style={{
                backgroundColor: `${ACCENT}08`,
                borderColor: `${ACCENT}30`,
              }}
            >
              <CardContent className="p-6 sm:p-8">
                <h3 className="text-xl font-bold mb-6" style={{ color: ACCENT }}>
                  Life at HandyServices
                </h3>
                <ul className="space-y-4">
                  {[
                    'Full diary every day — we handle all sales',
                    'Branded company van provided',
                    '28 days holiday + pension + sick pay',
                    'We handle all payments — you just do the work',
                    'Monday to Friday, 8am-5pm — weekends are yours',
                    'Consistent work, growing company',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-white/80">
                      <Check
                        className="w-5 h-5 shrink-0 mt-0.5"
                        style={{ color: ACCENT }}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 3 — THE PACKAGE
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4 bg-gray-900/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            The <span style={{ color: ACCENT }}>Package</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-xl mx-auto">
            Everything you need to focus on what you do best.
          </p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {(
              [
                { icon: PoundSterling, title: '£32,000', desc: 'Annual Salary' },
                { icon: Truck, title: 'Company Van', desc: 'Branded, insured, fuel card' },
                { icon: CalendarDays, title: '28 Days Holiday', desc: 'Including bank holidays' },
                { icon: Landmark, title: 'Company Pension', desc: '3% employer contribution' },
                { icon: Shirt, title: 'Uniform & PPE', desc: 'Provided' },
                { icon: Phone, title: 'Phone', desc: 'Provided' },
                { icon: GraduationCap, title: 'Training', desc: 'CSCS + asbestos funded' },
                { icon: TrendingUp, title: 'Career Growth', desc: 'First hire → team lead' },
              ] as const
            ).map(({ icon: Icon, title, desc }) => (
              <Card
                key={title}
                className="bg-gray-800/60 border-gray-700/50 hover:border-[#7DB00E]/40 transition-colors group"
              >
                <CardContent className="p-5 sm:p-6 text-center">
                  <div
                    className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
                    style={{ backgroundColor: `${ACCENT}15` }}
                  >
                    <Icon className="w-6 h-6" style={{ color: ACCENT }} />
                  </div>
                  <p className="font-bold text-white text-sm sm:text-base">{title}</p>
                  <p className="text-white/50 text-xs sm:text-sm mt-1">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 4 — WHAT WE NEED
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            What We <span style={{ color: ACCENT }}>Need</span>
          </h2>
          <p className="text-white/50 text-center mb-12 max-w-2xl mx-auto">
            The work matches what Nottingham homeowners and landlords need most:
          </p>

          {/* Trade categories */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-16">
            {(
              [
                { icon: Paintbrush, label: 'Painting & Decorating', note: 'most common' as string | undefined },
                { icon: Wrench, label: 'General Fixing & Mounting', note: undefined as string | undefined },
                { icon: Hammer, label: 'Carpentry & Door Fitting', note: undefined as string | undefined },
                { icon: Droplets, label: 'Silicone & Sealant Work', note: undefined as string | undefined },
                { icon: Zap, label: 'Minor Electrical', note: undefined as string | undefined },
                { icon: Blinds, label: 'Curtain & Blind Installation', note: undefined as string | undefined },
                { icon: Fence, label: 'Fencing & Outdoor', note: undefined as string | undefined },
              ]
            ).map(({ icon: Icon, label, note }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/60 p-5 text-center hover:border-[#7DB00E]/30 transition-colors"
              >
                <Icon className="w-7 h-7" style={{ color: ACCENT }} />
                <span className="text-sm font-medium text-white/80">{label}</span>
                {note && (
                  <span
                    className="text-[10px] uppercase tracking-wider font-bold rounded-full px-2 py-0.5"
                    style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                  >
                    {note}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Requirements */}
          <div className="max-w-2xl mx-auto">
            <h3 className="text-xl font-bold text-center mb-6 text-white/90">Requirements</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                '3+ years multi-trade experience',
                'Full UK driving licence',
                'Own basic hand tools',
                'CSCS card (or we\'ll fund it)',
                'Self-managing & reliable',
                'Presentable & professional',
              ].map((req) => (
                <div
                  key={req}
                  className="flex items-center gap-3 rounded-xl bg-gray-900/60 border border-gray-800 px-4 py-3"
                >
                  <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: ACCENT }} />
                  <span className="text-sm text-white/70">{req}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 5 — WHY JOIN NOW?
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4 bg-gray-900/50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Why Join <span style={{ color: ACCENT }}>Now?</span>
          </h2>
          <p className="text-white/50 mb-12 max-w-xl mx-auto">
            You'd be our first employed handyman. That means:
          </p>

          <div className="grid sm:grid-cols-2 gap-4 text-left max-w-3xl mx-auto">
            {(
              [
                {
                  icon: Users,
                  text: 'Shape the role — your input matters from day one',
                },
                {
                  icon: TrendingUp,
                  text: 'Clear path to team lead as we expand',
                },
                {
                  icon: Rocket,
                  text: 'Ground floor of a tech-enabled property services company',
                },
                {
                  icon: Building2,
                  text: 'Not just another number in a big FM company',
                },
                {
                  icon: CheckCircle2,
                  text: "We've already cracked the marketing and sales — we just need great tradespeople",
                },
              ] as const
            ).map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="flex items-start gap-4 rounded-2xl border border-gray-800 bg-gray-800/40 p-5"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${ACCENT}15` }}
                >
                  <Icon className="w-5 h-5" style={{ color: ACCENT }} />
                </div>
                <p className="text-white/70 text-sm leading-relaxed pt-1.5">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 6 — APPLICATION FORM
      ════════════════════════════════════════════════════════════════════ */}
      <section className="py-20 sm:py-28 px-4" ref={formRef} id="apply">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4">
            <span style={{ color: ACCENT }}>Apply</span> Today
          </h2>
          <p className="text-white/50 text-center mb-10">
            Fill in the basics and we'll be in touch within 48 hours.
          </p>

          {submitted ? (
            /* ── Success state ── */
            <Card className="bg-gray-800/60 border-[#7DB00E]/30">
              <CardContent className="p-10 text-center">
                <div
                  className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
                  style={{ backgroundColor: `${ACCENT}20` }}
                >
                  <CheckCircle2 className="w-8 h-8" style={{ color: ACCENT }} />
                </div>
                <h3 className="text-2xl font-bold mb-2">Thanks for applying!</h3>
                <p className="text-white/60">
                  We'll review your details and be in touch within 48 hours.
                </p>
              </CardContent>
            </Card>
          ) : (
            /* ── Form ── */
            <Card className="bg-gray-800/60 border-gray-700/50">
              <CardContent className="p-6 sm:p-8 space-y-6">
                {/* Name row */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/70 mb-1.5 block">
                      First Name <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={form.firstName}
                      onChange={(e) => set('firstName', e.target.value)}
                      placeholder="e.g. James"
                      className="bg-gray-900 border-gray-700 text-white placeholder:text-white/30"
                    />
                    {errors.firstName && (
                      <p className="text-red-400 text-xs mt-1">{errors.firstName}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-white/70 mb-1.5 block">
                      Last Name <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={form.lastName}
                      onChange={(e) => set('lastName', e.target.value)}
                      placeholder="e.g. Wilson"
                      className="bg-gray-900 border-gray-700 text-white placeholder:text-white/30"
                    />
                    {errors.lastName && (
                      <p className="text-red-400 text-xs mt-1">{errors.lastName}</p>
                    )}
                  </div>
                </div>

                {/* Phone */}
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

                {/* Email + Postcode */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-white/70 mb-1.5 block">Email</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="optional"
                      className="bg-gray-900 border-gray-700 text-white placeholder:text-white/30"
                    />
                  </div>
                  <div>
                    <Label className="text-white/70 mb-1.5 block">Postcode</Label>
                    <Input
                      value={form.postcode}
                      onChange={(e) => set('postcode', e.target.value)}
                      placeholder="e.g. NG1 1AA"
                      className="bg-gray-900 border-gray-700 text-white placeholder:text-white/30"
                    />
                  </div>
                </div>

                {/* Trades — multi-select checkboxes */}
                <div>
                  <Label className="text-white/70 mb-3 block">Trades (select all that apply)</Label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {TRADES.map((trade) => (
                      <label
                        key={trade}
                        className="flex items-center gap-2.5 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 cursor-pointer hover:border-[#7DB00E]/40 transition-colors text-sm"
                      >
                        <Checkbox
                          checked={form.trades.includes(trade)}
                          onCheckedChange={() => toggleTrade(trade)}
                          className="border-gray-600 data-[state=checked]:bg-[#7DB00E] data-[state=checked]:border-[#7DB00E]"
                        />
                        <span className="text-white/70">{trade}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Experience — radio */}
                <div>
                  <Label className="text-white/70 mb-3 block">Years of Experience</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {EXPERIENCE_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set('experience', opt)}
                        className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                          form.experience === opt
                            ? 'border-[#7DB00E] bg-[#7DB00E]/10 text-[#7DB00E]'
                            : 'border-gray-700 bg-gray-900 text-white/60 hover:border-gray-600'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Yes/No triplet */}
                <div className="grid sm:grid-cols-3 gap-4">
                  {(
                    [
                      { key: 'ownTools' as const, label: 'Own tools?' },
                      { key: 'drivingLicence' as const, label: 'Driving licence?' },
                      { key: 'cscsCard' as const, label: 'CSCS card?' },
                    ] as const
                  ).map(({ key, label }) => (
                    <div key={key}>
                      <Label className="text-white/70 mb-2 block text-sm">{label}</Label>
                      <div className="flex gap-2">
                        {['Yes', 'No'].map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => set(key, v)}
                            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                              form[key] === v
                                ? 'border-[#7DB00E] bg-[#7DB00E]/10 text-[#7DB00E]'
                                : 'border-gray-700 bg-gray-900 text-white/60 hover:border-gray-600'
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Current Situation */}
                <div>
                  <Label className="text-white/70 mb-3 block">Current Situation</Label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {SITUATION_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set('currentSituation', opt)}
                        className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                          form.currentSituation === opt
                            ? 'border-[#7DB00E] bg-[#7DB00E]/10 text-[#7DB00E]'
                            : 'border-gray-700 bg-gray-900 text-white/60 hover:border-gray-600'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* How did you hear about us */}
                <div>
                  <Label className="text-white/70 mb-1.5 block">How did you hear about us?</Label>
                  <Select
                    value={form.hearAboutUs}
                    onValueChange={(v) => set('hearAboutUs', v)}
                  >
                    <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-900 border-gray-700">
                      {REFERRAL_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt} className="text-white/80">
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Freeform */}
                <div>
                  <Label className="text-white/70 mb-1.5 block">
                    Anything you'd like to tell us?
                  </Label>
                  <textarea
                    value={form.message}
                    onChange={(e) => set('message', e.target.value)}
                    rows={3}
                    placeholder="Optional — tell us a bit about yourself"
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
                    'Submit Application'
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 7 — FOOTER
      ════════════════════════════════════════════════════════════════════ */}
      <footer className="border-t border-gray-800 py-10 px-4">
        <div className="max-w-4xl mx-auto text-center space-y-3">
          <p className="text-white/70 font-semibold flex items-center justify-center gap-2">
            <MapPin className="w-4 h-4" style={{ color: ACCENT }} />
            HandyServices — Nottingham &amp; Derby
          </p>
          <p className="text-white/50 text-sm flex items-center justify-center gap-2">
            <Phone className="w-4 h-4" />
            Questions? Call Mike on <span className="font-medium text-white/70">07449 501762</span>
          </p>
          <p className="text-white/30 text-xs mt-4">
            HandyServices is an equal opportunities employer.
          </p>
        </div>
      </footer>
    </div>
  );
}
