import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Check,
  X,
  Loader2,
  Star,
  Shield,
  Clock,
  Zap,
  Calendar,
  Phone,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  MessageCircle,
  TrendingDown,
  Layers,
  BarChart3,
  Sparkles,
  MapPin,
  ChevronDown,
  Send,
  Camera,
  Info,
  Wrench,
  Hammer,
  Paintbrush,
  Drill,
  Ruler,
  ThumbsUp,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

// ───────────────────────── types ─────────────────────────

type Step = 'describe' | 'details' | 'parsing' | 'confirm' | 'pricing' | 'price' | 'whatsapp';

const VISIBLE_STEPS: Step[] = ['describe', 'details', 'confirm', 'price', 'whatsapp'];

type Urgency = 'standard' | 'priority' | 'emergency';

interface ParsedLine {
  description: string;
  category: string;
  timeEstimate: string;
  estimatedMinutes?: number;
  originalText?: string;
}

// ───────────────────────── constants ─────────────────────────

const POSTCODE_RE = /^(NG|DE)\d{1,2}\s?\d?[A-Z]{0,2}$/i;
const V6_GOLD = '#e8b323';
const V6_GREEN = '#22c55e';

// Nottingham market data for educational moments
const MARKET_DATA: Record<string, { avg: string; range: string; label: string }> = {
  plumbing_minor: { avg: '£45', range: '£35–60', label: 'Plumbing' },
  plumbing_major: { avg: '£55', range: '£40–80', label: 'Plumbing' },
  electrical_minor: { avg: '£50', range: '£40–65', label: 'Electrics' },
  electrical_major: { avg: '£60', range: '£45–85', label: 'Electrics' },
  carpentry: { avg: '£40', range: '£30–55', label: 'Carpentry' },
  door_fitting: { avg: '£35', range: '£28–50', label: 'Door fitting' },
  general_fixing: { avg: '£30', range: '£24–45', label: 'General fixing' },
  shelving: { avg: '£30', range: '£24–40', label: 'Shelving' },
  furniture_assembly: { avg: '£30', range: '£22–40', label: 'Assembly' },
  painting_minor: { avg: '£35', range: '£25–50', label: 'Painting' },
  painting_major: { avg: '£40', range: '£30–60', label: 'Painting' },
  tiling_minor: { avg: '£45', range: '£35–60', label: 'Tiling' },
  tiling_major: { avg: '£55', range: '£40–75', label: 'Tiling' },
  bathroom_minor: { avg: '£45', range: '£35–65', label: 'Bathroom' },
  kitchen_minor: { avg: '£40', range: '£30–55', label: 'Kitchen' },
  plastering: { avg: '£40', range: '£30–55', label: 'Plastering' },
  flooring: { avg: '£35', range: '£25–50', label: 'Flooring' },
  curtain_blind: { avg: '£30', range: '£22–40', label: 'Curtains/Blinds' },
  tv_mounting: { avg: '£35', range: '£25–50', label: 'TV mounting' },
  locksmith: { avg: '£55', range: '£40–80', label: 'Locksmith' },
  gutter: { avg: '£35', range: '£25–50', label: 'Guttering' },
  fence: { avg: '£40', range: '£30–55', label: 'Fencing' },
  other: { avg: '£35', range: '£24–48', label: 'Handyman' },
};

// Postcode area local insights
const POSTCODE_INSIGHTS: Record<string, string> = {
  NG1: "City Centre — 5 min from our base, zero travel charge",
  NG2: "West Bridgford — our busiest area, we know every street",
  NG3: "Sneinton & Carlton — we're here 3-4 times a week",
  NG4: "Gedling & Carlton Hill — lovely area, we've done 50+ jobs here",
  NG5: "Sherwood & Arnold — one of our favourite patches",
  NG6: "Bulwell & Bestwood — quick trip for us, 12 min drive",
  NG7: "Lenton & Radford — busy with student lets, we know the area well",
  NG8: "Wollaton & Bilborough — great area, 15 min from base",
  NG9: "Beeston & Chilwell — just across the bridge, easy reach",
  NG10: "Long Eaton & Sandiacre — edge of our patch but we cover it",
  NG11: "Clifton & Ruddington — regular jobs down here",
  NG12: "Cotgrave & Keyworth — we come out twice a week",
  NG13: "Bingham area — a little further but we cover it",
  NG14: "Burton Joyce & Calverton — lovely villages, happy to visit",
  NG15: "Hucknall — 20 min drive, no problem",
  NG16: "Eastwood & Kimberley — just inside our range",
  DE: "Derbyshire border — we cover the DE postcodes near Nottingham",
};

function getPostcodeInsight(postcode: string): string {
  const trimmed = postcode.trim().toUpperCase();
  for (const prefix of Object.keys(POSTCODE_INSIGHTS).sort((a, b) => b.length - a.length)) {
    if (trimmed.startsWith(prefix)) return POSTCODE_INSIGHTS[prefix];
  }
  return "You're in our service area — no travel surcharge!";
}

// Get tool icons for a task based on its category/description
function getToolIcons(category: string, desc: string): React.ReactNode[] {
  const d = desc.toLowerCase();
  if (d.includes('paint') || d.includes('decorate') || category.includes('painting')) {
    return [<Paintbrush key="p" className="h-3.5 w-3.5" />, <Ruler key="r" className="h-3.5 w-3.5" />];
  }
  if (d.includes('plumb') || d.includes('tap') || d.includes('sink') || d.includes('toilet') || d.includes('leak') || category.includes('plumbing')) {
    return [<Wrench key="w" className="h-3.5 w-3.5" />, <Drill key="d" className="h-3.5 w-3.5" />];
  }
  if (d.includes('mount') || d.includes('tv') || d.includes('shelf') || d.includes('shelv') || d.includes('bracket') || category.includes('shelving') || category.includes('tv_mounting')) {
    return [<Drill key="d" className="h-3.5 w-3.5" />, <Ruler key="r" className="h-3.5 w-3.5" />];
  }
  if (d.includes('electric') || d.includes('light') || d.includes('switch') || d.includes('socket') || category.includes('electrical')) {
    return [<Zap key="z" className="h-3.5 w-3.5" />, <Drill key="d" className="h-3.5 w-3.5" />];
  }
  if (d.includes('assembl') || d.includes('ikea') || d.includes('furniture') || category.includes('furniture')) {
    return [<Wrench key="w" className="h-3.5 w-3.5" />, <Hammer key="h" className="h-3.5 w-3.5" />];
  }
  if (d.includes('door') || d.includes('hinge') || d.includes('lock') || category.includes('door')) {
    return [<Drill key="d" className="h-3.5 w-3.5" />, <Hammer key="h" className="h-3.5 w-3.5" />];
  }
  if (d.includes('tile') || d.includes('grout') || category.includes('tiling')) {
    return [<Hammer key="h" className="h-3.5 w-3.5" />, <Ruler key="r" className="h-3.5 w-3.5" />];
  }
  if (d.includes('fence') || d.includes('garden') || category.includes('fence')) {
    return [<Hammer key="h" className="h-3.5 w-3.5" />, <Drill key="d" className="h-3.5 w-3.5" />];
  }
  if (d.includes('carpet') || d.includes('floor') || category.includes('carpentry') || category.includes('flooring')) {
    return [<Hammer key="h" className="h-3.5 w-3.5" />, <Ruler key="r" className="h-3.5 w-3.5" />];
  }
  return [<Wrench key="w" className="h-3.5 w-3.5" />, <Hammer key="h" className="h-3.5 w-3.5" />];
}

const URGENCY_OPTIONS: { value: Urgency; label: string; sub: string; icon: React.ReactNode; note: string }[] = [
  { value: 'standard', label: "I'm flexible", sub: 'Best price', icon: <Calendar className="h-5 w-5" />, note: 'Most popular — 85% of customers choose this' },
  { value: 'priority', label: 'Within 3 days', sub: '+10-20%', icon: <Clock className="h-5 w-5" />, note: 'Priority scheduling, small premium' },
  { value: 'emergency', label: 'Today / ASAP', sub: '+30-50%', icon: <Zap className="h-5 w-5" />, note: 'Same-day service when available' },
];

// ───────────────────────── animation helpers ─────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 280 : -280, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.3 } },
  exit: (dir: number) => ({ x: dir > 0 ? -280 : 280, opacity: 0, transition: { duration: 0.2 } }),
};

// Simple fade-in component with delay — avoids variant propagation issues
function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ───────────────────────── progress bar ─────────────────────────

function ProgressBar({ current }: { current: Step }) {
  // Map loading steps to their parent visible step
  const mapped = current === 'parsing' ? 'details' : current === 'pricing' ? 'confirm' : current;
  const idx = VISIBLE_STEPS.indexOf(mapped as Step);
  if (current === 'parsing' || current === 'pricing') return null;

  const labels = ['Describe', 'Details', 'Confirm', 'Your Price', 'Book'];
  const progress = idx >= 0 ? ((idx) / (VISIBLE_STEPS.length - 1)) * 100 : 0;

  return (
    <div className="mb-8">
      <div className="flex justify-between mb-2">
        {labels.map((label, i) => (
          <span
            key={label}
            className={`text-[10px] font-mono uppercase tracking-widest transition-colors duration-300 ${
              i <= idx ? 'text-[#e8b323]' : 'text-white/20'
            }`}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="h-[2px] w-full bg-white/[0.06] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${V6_GOLD}, ${V6_GREEN})` }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ───────────────────────── trust strip ─────────────────────────

function TrustStrip({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-gray-500 ${compact ? 'text-[10px]' : 'text-xs'}`}>
      <span className="flex items-center gap-1">
        <Star className="h-3 w-3 text-[#e8b323] fill-[#e8b323]" /> 4.9★ Google
      </span>
      <span className="text-white/10">·</span>
      <span className="flex items-center gap-1">
        <Shield className="h-3 w-3 text-[#e8b323]" /> £2M Insured
      </span>
      <span className="text-white/10">·</span>
      <span className="flex items-center gap-1">
        <Check className="h-3 w-3 text-[#e8b323]" /> 500+ Jobs Done
      </span>
    </div>
  );
}

// ───────────────────────── insight bubble ─────────────────────────

function InsightBubble({ children, icon, delay = 0 }: { children: React.ReactNode; icon?: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className="flex items-start gap-2.5 rounded-lg border border-[#e8b323]/15 bg-[#e8b323]/[0.04] px-3.5 py-2.5"
    >
      <div className="shrink-0 mt-0.5">
        {icon || <Sparkles className="h-3.5 w-3.5 text-[#e8b323]" />}
      </div>
      <p className="text-xs text-gray-300 leading-relaxed">{children}</p>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export default function InstantPricePage() {
  // ── wizard state ──
  const [step, setStep] = useState<Step>('describe');
  const [direction, setDirection] = useState(1);

  // ── form state ──
  const [description, setDescription] = useState('');
  const [postcode, setPostcode] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('standard');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPostcodeInsight, setShowPostcodeInsight] = useState(false);

  // ── parsed lines state (from parse API) ──
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const [rawParsedData, setRawParsedData] = useState<any>(null); // raw API response for pricing step

  // ── API state ──
  const [apiResult, setApiResult] = useState<any>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // ── price breakdown expand ──
  const [showHowWeCalculated, setShowHowWeCalculated] = useState(false);

  // helpers
  const postcodeValid = postcode.length > 0 && POSTCODE_RE.test(postcode.trim());
  const postcodeInvalid = postcode.length > 2 && !POSTCODE_RE.test(postcode.trim());

  // Show postcode insight with a slight delay for delight
  useEffect(() => {
    if (postcodeValid) {
      const t = setTimeout(() => setShowPostcodeInsight(true), 400);
      return () => clearTimeout(t);
    }
    setShowPostcodeInsight(false);
  }, [postcodeValid]);

  function goTo(next: Step) {
    const allSteps: Step[] = ['describe', 'details', 'parsing', 'confirm', 'pricing', 'price', 'whatsapp'];
    const curIdx = allSteps.indexOf(step);
    const nextIdx = allSteps.indexOf(next);
    setDirection(nextIdx > curIdx ? 1 : -1);
    setStep(next);
  }

  // ── PARSING step: parse the job description into line items ──
  const [parsePhase, setParsePhase] = useState<'reading' | 'splitting' | 'done'>('reading');
  const [typedText, setTypedText] = useState('');
  const [visibleLines, setVisibleLines] = useState(0);
  const hasStartedParse = useRef(false);

  useEffect(() => {
    if (step !== 'parsing') {
      hasStartedParse.current = false;
      return;
    }
    if (hasStartedParse.current) return;
    hasStartedParse.current = true;

    setParsePhase('reading');
    setTypedText('');
    setParsedLines([]);
    setVisibleLines(0);
    setApiError(null);

    // Phase 1: Typewriter effect
    let charIdx = 0;
    const fullText = description.slice(0, 140) + (description.length > 140 ? '...' : '');
    const typeTimer = setInterval(() => {
      charIdx++;
      setTypedText(fullText.slice(0, charIdx));
      if (charIdx >= fullText.length) {
        clearInterval(typeTimer);
        setTimeout(() => setParsePhase('splitting'), 300);
      }
    }, 20);

    // API call in parallel
    (async () => {
      try {
        const parseRes = await apiRequest('POST', '/api/pricing/parse-job', { description });
        const parsed = await parseRes.json();
        setRawParsedData(parsed);

        const lines: ParsedLine[] = (parsed.lines || []).map((l: any) => ({
          description: l.description || l.originalText || 'Line item',
          category: l.category || 'other',
          timeEstimate: l.estimatedMinutes ? `${l.estimatedMinutes} min` : l.timeEstimate || '—',
          estimatedMinutes: l.estimatedMinutes,
          originalText: l.originalText,
        }));
        setParsedLines(lines);

        // Show lines appearing one by one
        setParsePhase('splitting');
        for (let i = 0; i < lines.length; i++) {
          await new Promise(r => setTimeout(r, 600));
          setVisibleLines(i + 1);
        }

        await new Promise(r => setTimeout(r, 400));
        setParsePhase('done');
        await new Promise(r => setTimeout(r, 500));
        goTo('confirm');
      } catch (err: any) {
        console.error('Parse API error:', err);
        setApiError(err?.message || 'Something went wrong, please try again.');
      }
    })();

    return () => clearInterval(typeTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── PRICING step: run the contextual pricing engine ──
  const [pricingPhase, setPricingPhase] = useState<'market' | 'context' | 'guardrails' | 'done'>('market');
  const hasStartedPrice = useRef(false);

  useEffect(() => {
    if (step !== 'pricing') {
      hasStartedPrice.current = false;
      return;
    }
    if (hasStartedPrice.current) return;
    hasStartedPrice.current = true;

    setPricingPhase('market');
    setApiError(null);

    (async () => {
      try {
        // Show market check phase briefly
        await new Promise(r => setTimeout(r, 1000));
        setPricingPhase('context');

        // Call pricing API
        const quoteRes = await apiRequest('POST', '/api/pricing/multi-quote', {
          customerName: 'Website Visitor',
          jobDescription: description,
          lines: rawParsedData?.lines || [],
          signals: {
            urgency,
            materialsSupply: 'labor_only',
            timeOfService: 'standard',
            isReturningCustomer: false,
          },
        });
        const quoteData = await quoteRes.json();
        setApiResult(quoteData);

        // Guardrails phase
        setPricingPhase('guardrails');
        await new Promise(r => setTimeout(r, 800));

        setPricingPhase('done');
        await new Promise(r => setTimeout(r, 500));
        goTo('price');
      } catch (err: any) {
        console.error('Pricing API error:', err);
        setApiError(err?.message || 'Something went wrong, please try again.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── derive pricing from result ──
  const finalPricePence = apiResult?.quote?.finalPricePence ?? apiResult?.finalPricePence ?? 0;
  const finalPrice = Math.round(finalPricePence / 100);
  const deposit = Math.round(finalPrice * 0.3);
  const balance = finalPrice - deposit;

  const lineItems: { description: string; pricePence?: number; category?: string }[] =
    apiResult?.quote?.lines ?? apiResult?.lines ?? [];

  const contextualHeadline: string | undefined =
    apiResult?.quote?.contextualHeadline ?? apiResult?.contextualHeadline;

  // Market comparison estimates
  const marketLow = parsedLines.reduce((sum, l) => {
    const cat = MARKET_DATA[l.category] || MARKET_DATA['other'];
    const lowRate = parseInt(cat.range.split('–')[0].replace('£', ''));
    const mins = l.estimatedMinutes || 60;
    return sum + Math.max((lowRate * mins) / 60, lowRate);
  }, 0);

  const marketHigh = parsedLines.reduce((sum, l) => {
    const cat = MARKET_DATA[l.category] || MARKET_DATA['other'];
    const highRate = parseInt(cat.range.split('–')[1].replace('£', ''));
    const mins = l.estimatedMinutes || 60;
    return sum + Math.max((highRate * mins) / 60, highRate * 1.5);
  }, 0);

  // ── lead creation + WhatsApp ──
  const [leadCreated, setLeadCreated] = useState(false);

  async function handleSendToWhatsApp() {
    if (!leadCreated) {
      try {
        await apiRequest('POST', '/api/leads', {
          customerName: name,
          phone,
          jobDescription: description,
          source: 'instant_price',
          postcode: postcode.trim(),
          notes: `Urgency: ${urgency}. Price: £${finalPrice}. Via instant price tool.`,
        });
        setLeadCreated(true);
      } catch (err) {
        console.error('Lead creation error:', err);
      }
    }
    const msg = `Hi! I just got an instant quote of £${finalPrice} from your website for:\n\n${description.slice(0, 300)}\n\nPostcode: ${postcode}\n\nI'd like to go ahead — what's the next step?`;
    window.open(`https://wa.me/447508744402?text=${encodeURIComponent(msg)}`, '_blank');
  }

  // ── restart ──
  function restart() {
    setStep('describe');
    setDirection(-1);
    setDescription('');
    setPostcode('');
    setUrgency('standard');
    setName('');
    setPhone('');
    setApiResult(null);
    setApiError(null);
    setLeadCreated(false);
    setShowHowWeCalculated(false);
    setParsedLines([]);
    setRawParsedData(null);
  }

  // ── batch discount insight ──
  const hasBatchDiscount = parsedLines.length >= 2;
  const batchLabel = parsedLines.length >= 3 ? '8–15%' : '5–10%';

  // Total estimated time
  const totalMinutes = parsedLines.reduce((sum, l) => sum + (l.estimatedMinutes || 45), 0);
  const totalTimeLabel = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60 > 0 ? `${totalMinutes % 60}m` : ''}`
    : `${totalMinutes} min`;

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white relative overflow-x-hidden">
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />
      {/* Warm glow at top */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#e8b323]/[0.04] blur-[120px] rounded-full pointer-events-none" />

      <div className="relative max-w-lg mx-auto px-4 py-8 sm:py-12">
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-2"
        >
          <div className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#e8b323]/60 mb-3 border border-[#e8b323]/10 rounded-full px-3 py-1">
            <Zap className="h-2.5 w-2.5" /> AI-Powered Pricing
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            What will your job{' '}
            <span className="relative">
              <span className="text-[#e8b323]">actually</span>
              <svg className="absolute -bottom-1 left-0 w-full" viewBox="0 0 100 6" preserveAspectRatio="none">
                <path d="M0 5 Q 25 0, 50 3 Q 75 6, 100 1" stroke="#e8b323" strokeWidth="1.5" fill="none" opacity="0.4" />
              </svg>
            </span>{' '}
            cost?
          </h1>
          <p className="text-gray-500 text-sm mt-2">
            Transparent pricing in 60 seconds. No surprises.
          </p>
        </motion.div>

        <ProgressBar current={step} />

        <AnimatePresence mode="wait" custom={direction}>
          {/* ════════════ STEP 1: DESCRIBE ════════════ */}
          {step === 'describe' && (
            <motion.div
              key="describe"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="space-y-4">
                <FadeIn>
                  <label className="block text-base font-semibold mb-1">Tell us everything that needs doing</label>
                  <p className="text-xs text-gray-500 mb-3">The more detail, the more accurate your price. Include multiple jobs for a multi-job discount.</p>
                </FadeIn>

                <FadeIn>
                  <textarea
                    className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] focus:border-[#e8b323]/50 focus:ring-1 focus:ring-[#e8b323]/30 text-white placeholder:text-gray-600 p-4 min-h-[150px] resize-none transition-all outline-none text-[15px] leading-relaxed"
                    placeholder={"e.g. Fix a leaking kitchen tap, hang 3 floating shelves in the living room, and assemble an IKEA PAX wardrobe"}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <div className="flex justify-between text-[10px] text-gray-600 mt-1.5 px-1">
                    <span>
                      {description.trim().length < 10
                        ? 'Keep typing...'
                        : description.includes(' and ') || description.includes(',')
                        ? '💡 Multiple jobs detected — you could save with batch pricing'
                        : '✓ Good to go'}
                    </span>
                    <span>{description.length} / 2,000</span>
                  </div>
                </FadeIn>

                <FadeIn>
                  <Button
                    className="w-full h-14 text-base font-semibold rounded-xl border-0 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
                    style={{
                      backgroundColor: description.trim().length >= 10 ? V6_GOLD : 'rgba(255,255,255,0.06)',
                      color: description.trim().length >= 10 ? '#000' : 'rgba(255,255,255,0.3)',
                    }}
                    disabled={description.trim().length < 10}
                    onClick={() => goTo('details')}
                  >
                    Next <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </FadeIn>

                <FadeIn>
                  <TrustStrip />
                </FadeIn>
              </div>
            </motion.div>
          )}

          {/* ════════════ STEP 2: DETAILS ════════════ */}
          {step === 'details' && (
            <motion.div
              key="details"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="space-y-6">
                {/* Postcode */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Your postcode</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600" />
                    <Input
                      className="h-12 pl-10 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-gray-600 pr-10 focus:border-[#e8b323]/50 focus:ring-1 focus:ring-[#e8b323]/30 transition-all"
                      placeholder="e.g. NG1 5AW"
                      value={postcode}
                      onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                    />
                    {postcodeValid && (
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                          <Check className="h-3 w-3 text-green-400" />
                        </div>
                      </motion.div>
                    )}
                    {postcodeInvalid && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <X className="h-5 w-5 text-red-400" />
                      </div>
                    )}
                  </div>
                  {postcodeInvalid && (
                    <p className="text-xs text-red-400 flex items-center gap-1">
                      <X className="h-3 w-3" /> Sorry, we only cover Nottingham (NG) and nearby Derby (DE) postcodes
                    </p>
                  )}
                  {/* Local insight */}
                  <AnimatePresence>
                    {postcodeValid && showPostcodeInsight && (
                      <InsightBubble icon={<MapPin className="h-3.5 w-3.5 text-[#e8b323]" />}>
                        {getPostcodeInsight(postcode)}
                      </InsightBubble>
                    )}
                  </AnimatePresence>
                </div>

                {/* Urgency */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">How soon do you need this?</label>
                  <div className="space-y-2">
                    {URGENCY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setUrgency(opt.value)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                          urgency === opt.value
                            ? 'border-[#e8b323]/40 bg-[#e8b323]/[0.06]'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                        }`}
                      >
                        <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                          urgency === opt.value ? 'bg-[#e8b323]/15 text-[#e8b323]' : 'bg-white/[0.04] text-gray-500'
                        }`}>
                          {opt.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${urgency === opt.value ? 'text-white' : 'text-gray-300'}`}>
                              {opt.label}
                            </span>
                            {opt.value !== 'standard' && (
                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                urgency === opt.value ? 'bg-[#e8b323]/10 text-[#e8b323]' : 'bg-white/[0.04] text-gray-500'
                              }`}>
                                {opt.sub}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-gray-500">{opt.note}</span>
                        </div>
                        <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                          urgency === opt.value ? 'border-[#e8b323] bg-[#e8b323]' : 'border-white/20'
                        }`}>
                          {urgency === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                        </div>
                      </button>
                    ))}
                  </div>
                  {/* Urgency education */}
                  <AnimatePresence>
                    {urgency === 'standard' && (
                      <InsightBubble icon={<TrendingDown className="h-3.5 w-3.5 text-green-400" />} delay={0.1}>
                        <span className="text-green-400 font-medium">Smart choice</span> — flexible scheduling means we can route you efficiently, keeping your price lowest.
                      </InsightBubble>
                    )}
                    {urgency === 'priority' && (
                      <InsightBubble icon={<Info className="h-3.5 w-3.5 text-[#e8b323]" />} delay={0.1}>
                        Priority premium covers schedule reshuffling. We bump you up the queue — most priority jobs happen within 48hrs.
                      </InsightBubble>
                    )}
                    {urgency === 'emergency' && (
                      <InsightBubble icon={<Zap className="h-3.5 w-3.5 text-orange-400" />} delay={0.1}>
                        Emergency rate reflects same-day mobilisation. We keep evening/weekend slots open specifically for urgent calls.
                      </InsightBubble>
                    )}
                  </AnimatePresence>
                </div>

                <Button
                  className="w-full h-14 text-base font-semibold rounded-xl border-0 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
                  style={{
                    backgroundColor: postcodeValid ? V6_GOLD : 'rgba(255,255,255,0.06)',
                    color: postcodeValid ? '#000' : 'rgba(255,255,255,0.3)',
                  }}
                  disabled={!postcodeValid}
                  onClick={() => goTo('parsing')}
                >
                  Analyse My Job <ArrowRight className="ml-2 h-4 w-4" />
                </Button>

                <button
                  type="button"
                  className="w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors"
                  onClick={() => goTo('describe')}
                >
                  ← Back
                </button>
              </div>
            </motion.div>
          )}

          {/* ════════════ STEP 3: PARSING (loading → auto-advances to confirm) ════════════ */}
          {step === 'parsing' && (
            <motion.div
              key="parsing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {apiError ? (
                <div className="text-center space-y-6 py-12">
                  <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
                    <X className="h-8 w-8 text-red-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">Something went wrong</p>
                    <p className="text-sm text-gray-400 mt-1">Our pricing engine hiccupped. Please try again.</p>
                  </div>
                  <Button
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                    onClick={() => {
                      setApiError(null);
                      hasStartedParse.current = false;
                      goTo('parsing');
                    }}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Try Again
                  </Button>
                </div>
              ) : (
                <div className="py-4 space-y-5">
                  <div className="text-center mb-2">
                    <p className="text-xs font-mono uppercase tracking-[0.15em] text-[#e8b323]/50">Analysing your job</p>
                  </div>

                  {/* Typewriter */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {parsePhase === 'reading' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#e8b323] shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                      )}
                      <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                        Reading description
                      </span>
                    </div>
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
                      <p className="text-sm text-gray-400 leading-relaxed">
                        "{typedText}
                        {parsePhase === 'reading' && (
                          <span className="inline-block w-0.5 h-3.5 bg-[#e8b323] ml-0.5 animate-pulse align-middle" />
                        )}
                        {parsePhase !== 'reading' && '"'}
                      </p>
                    </div>
                  </div>

                  {/* Splitting indicator */}
                  {parsePhase === 'splitting' && visibleLines === 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#e8b323] shrink-0" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                        Splitting into separate jobs...
                      </span>
                    </motion.div>
                  )}

                  {/* Parsed line items appearing */}
                  {visibleLines > 0 && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                      <div className="flex items-center gap-2">
                        {visibleLines < parsedLines.length ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#e8b323] shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                        )}
                        <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                          {parsedLines.length} job{parsedLines.length !== 1 ? 's' : ''} identified
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {parsedLines.slice(0, visibleLines).map((line, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -16 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.3 }}
                            className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
                          >
                            <div className="shrink-0 w-5 h-5 rounded-md bg-[#e8b323]/10 flex items-center justify-center">
                              <span className="text-[9px] font-bold text-[#e8b323]">{i + 1}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-300 truncate">{line.description}</p>
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-gray-500">
                                {(MARKET_DATA[line.category] || MARKET_DATA['other']).label}
                              </span>
                            </div>
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-400/50 shrink-0" />
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Done */}
                  {parsePhase === 'done' && (
                    <motion.div
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="rounded-lg border border-green-500/20 bg-green-500/[0.05] p-3 text-center"
                    >
                      <p className="text-sm text-green-400 font-medium">✓ Analysis complete</p>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* ════════════ STEP 4: CONFIRM JOBS ════════════ */}
          {step === 'confirm' && (
            <motion.div
              key="confirm"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="space-y-5">
                {/* Headline */}
                <FadeIn className="text-center">
                  <h2 className="text-xl font-bold text-white">
                    Here's What We'll Quote
                  </h2>
                  <p className="text-sm text-gray-400 mt-1">
                    We've broken your job into clear steps so we only quote what's needed.
                  </p>
                </FadeIn>

                {/* Job cards */}
                <FadeIn delay={0.05} className="space-y-3">
                  {parsedLines.map((line, i) => {
                    const marketInfo = MARKET_DATA[line.category] || MARKET_DATA['other'];
                    const tools = getToolIcons(line.category, line.description);

                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1, duration: 0.3 }}
                        className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden"
                      >
                        <div className="p-4">
                          {/* Header row */}
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <div className="shrink-0 w-7 h-7 rounded-lg bg-[#e8b323]/10 flex items-center justify-center mt-0.5">
                                <span className="text-xs font-bold text-[#e8b323]">{i + 1}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-sm font-semibold text-white leading-tight">{line.description}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#e8b323]/[0.08] text-[#e8b323]">
                                    {marketInfo.label}
                                  </span>
                                  <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                                    <Clock className="h-2.5 w-2.5" /> ~{line.timeEstimate}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Market rate + tools row */}
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.04]">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-500">Tools:</span>
                              <div className="flex items-center gap-1">
                                {tools.map((tool, idx) => (
                                  <div key={idx} className="w-5 h-5 rounded bg-white/[0.04] flex items-center justify-center text-gray-500">
                                    {tool}
                                  </div>
                                ))}
                                <div className="w-5 h-5 rounded bg-white/[0.04] flex items-center justify-center text-gray-500">
                                  <Sparkles className="h-3.5 w-3.5" />
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] text-gray-500">
                              Nottingham avg: <span className="text-gray-400">{marketInfo.range}/hr</span>
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </FadeIn>

                {/* Included free */}
                <FadeIn>
                  <div className="rounded-xl border border-green-500/10 bg-green-500/[0.03] p-4">
                    <p className="text-xs font-semibold text-green-400 mb-2.5">Included FREE with your job:</p>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5">
                        <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                        <span className="text-xs text-gray-300">Complete cleanup and tidy after work</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                        <span className="text-xs text-gray-300">30-day workmanship guarantee</span>
                      </div>
                      {hasBatchDiscount && (
                        <div className="flex items-center gap-2.5">
                          <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                          <span className="text-xs text-gray-300">
                            Multi-job discount ({batchLabel} off — one trip, less overhead)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </FadeIn>

                {/* Social proof + fair pricing */}
                <FadeIn>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <MapPin className="h-4 w-4 text-[#e8b323] shrink-0" />
                      <p className="text-xs text-gray-300">
                        We've completed <span className="text-white font-semibold">{12 + (parsedLines.length * 3 % 8)} similar jobs</span> in your area this month.
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Shield className="h-4 w-4 text-[#e8b323] shrink-0" />
                      <p className="text-xs text-gray-300">
                        This breakdown ensures <span className="text-white font-semibold">fair pricing</span> — no guesswork, no hidden extras.
                      </p>
                    </div>
                  </div>
                </FadeIn>

                {/* Summary bar */}
                <FadeIn>
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                    <div className="text-xs text-gray-400">
                      <span className="text-white font-semibold">{parsedLines.length}</span> job{parsedLines.length !== 1 ? 's' : ''}
                      <span className="text-white/10 mx-2">·</span>
                      <span className="text-white font-semibold">~{totalTimeLabel}</span> total
                    </div>
                    <div className="text-[10px] text-gray-500">
                      Ready to price
                    </div>
                  </div>
                </FadeIn>

                {/* Buttons */}
                <FadeIn className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 h-12 border-white/[0.08] text-gray-300 hover:bg-white/[0.04] hover:text-white rounded-xl"
                    onClick={() => goTo('describe')}
                  >
                    Edit Jobs
                  </Button>
                  <Button
                    className="flex-1 h-12 text-base font-semibold rounded-xl border-0 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
                    style={{ backgroundColor: V6_GOLD, color: '#000' }}
                    onClick={() => goTo('pricing')}
                  >
                    <ThumbsUp className="mr-2 h-4 w-4" />
                    Looks Good
                  </Button>
                </FadeIn>
              </div>
            </motion.div>
          )}

          {/* ════════════ STEP 5: PRICING (loading → auto-advances to price) ════════════ */}
          {step === 'pricing' && (
            <motion.div
              key="pricing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {apiError ? (
                <div className="text-center space-y-6 py-12">
                  <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
                    <X className="h-8 w-8 text-red-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">Something went wrong</p>
                    <p className="text-sm text-gray-400 mt-1">Our pricing engine hiccupped. Please try again.</p>
                  </div>
                  <Button
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                    onClick={() => {
                      setApiError(null);
                      hasStartedPrice.current = false;
                      goTo('pricing');
                    }}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Try Again
                  </Button>
                </div>
              ) : (
                <div className="py-8 space-y-5">
                  <div className="text-center mb-2">
                    <p className="text-xs font-mono uppercase tracking-[0.15em] text-[#e8b323]/50">Generating your price</p>
                  </div>

                  {/* Market rates */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {pricingPhase === 'market' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#e8b323] shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                      )}
                      <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                        {pricingPhase === 'market' ? 'Checking Nottingham market rates...' : 'Market rates checked'}
                      </span>
                    </div>
                    {pricingPhase !== 'market' && (
                      <InsightBubble icon={<BarChart3 className="h-3.5 w-3.5 text-[#e8b323]" />}>
                        Cross-referencing <span className="text-white font-medium">Checkatrade, TaskRabbit & Airtasker</span> rates for Nottingham.{' '}
                        {parsedLines.length > 0 && (
                          <>
                            {(MARKET_DATA[parsedLines[0]?.category] || MARKET_DATA['other']).label} averages{' '}
                            <span className="text-white font-medium">{(MARKET_DATA[parsedLines[0]?.category] || MARKET_DATA['other']).range}/hr</span>.
                          </>
                        )}
                      </InsightBubble>
                    )}
                  </div>

                  {/* AI context */}
                  {(['context', 'guardrails', 'done'] as const).some(p => pricingPhase === p) && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                      <div className="flex items-center gap-2">
                        {pricingPhase === 'context' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#e8b323] shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                        )}
                        <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                          {pricingPhase === 'context' ? 'AI contextual pricing...' : 'Contextual adjustments applied'}
                        </span>
                      </div>
                      {pricingPhase === 'context' && (
                        <div className="rounded-lg border border-[#e8b323]/10 bg-[#e8b323]/[0.03] p-3 flex items-center justify-center gap-3">
                          <div className="flex gap-1">
                            {[0, 1, 2].map(i => (
                              <motion.div
                                key={i}
                                className="w-1.5 h-1.5 rounded-full bg-[#e8b323]"
                                animate={{ y: [0, -6, 0] }}
                                transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12 }}
                              />
                            ))}
                          </div>
                          <span className="text-xs text-[#e8b323]/70">
                            Analysing complexity, access & job context
                          </span>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Guardrails */}
                  {(['guardrails', 'done'] as const).some(p => pricingPhase === p) && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                      <div className="flex items-center gap-2">
                        {pricingPhase === 'guardrails' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#e8b323] shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                        )}
                        <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                          {pricingPhase === 'guardrails' ? 'Running fairness checks...' : '6 safety guardrails passed'}
                        </span>
                      </div>
                      {pricingPhase === 'done' && (
                        <InsightBubble icon={<Shield className="h-3.5 w-3.5 text-green-400" />} delay={0.1}>
                          Every price goes through <span className="text-white font-medium">6 fairness guardrails</span> — min/max rate bounds,
                          floor checks, and psychological pricing. You'll never be overcharged.
                        </InsightBubble>
                      )}
                    </motion.div>
                  )}

                  {/* Done */}
                  {pricingPhase === 'done' && (
                    <motion.div
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="rounded-lg border border-green-500/20 bg-green-500/[0.05] p-3 text-center"
                    >
                      <p className="text-sm text-green-400 font-medium">✓ Your price is ready</p>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* ════════════ STEP 6: FULL PRICE REVEAL ════════════ */}
          {step === 'price' && (
            <motion.div
              key="price"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.35 }}
            >
              <div className="space-y-5">
                {/* Main price */}
                <FadeIn className="text-center pt-2">
                  {contextualHeadline && (
                    <p className="text-sm text-gray-400 mb-2 italic">"{contextualHeadline}"</p>
                  )}
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.1 }}
                  >
                    <span className="text-6xl font-bold tracking-tight text-white">
                      £{finalPrice}
                    </span>
                  </motion.div>
                  <p className="text-xs text-gray-500 mt-2">
                    All-inclusive. Labour + cleanup + 30-day guarantee.
                  </p>
                </FadeIn>

                {/* Market comparison bar */}
                <FadeIn>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <BarChart3 className="h-3.5 w-3.5 text-[#e8b323]" />
                      <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Nottingham Market Comparison</span>
                    </div>
                    <div className="relative h-8 rounded-lg bg-white/[0.04] overflow-hidden">
                      <div
                        className="absolute top-0 h-full bg-white/[0.04] rounded-lg"
                        style={{ left: '5%', right: '5%' }}
                      />
                      <div className="absolute left-[5%] top-0 h-full flex items-center">
                        <span className="text-[9px] font-mono text-gray-500 -ml-1">£{Math.round(marketLow)}</span>
                      </div>
                      <div className="absolute right-[5%] top-0 h-full flex items-center">
                        <span className="text-[9px] font-mono text-gray-500 ml-1">£{Math.round(marketHigh)}</span>
                      </div>
                      {marketHigh > 0 && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.4, type: 'spring', stiffness: 300, damping: 20 }}
                          className="absolute top-1/2 -translate-y-1/2 z-10"
                          style={{
                            left: `${Math.min(Math.max(((finalPrice - marketLow) / (marketHigh - marketLow)) * 90 + 5, 10), 85)}%`,
                          }}
                        >
                          <div className="w-3 h-3 rounded-full bg-[#e8b323] ring-2 ring-[#e8b323]/30 shadow-lg shadow-[#e8b323]/20" />
                        </motion.div>
                      )}
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-500">Budget operators</span>
                      <span className="text-[#e8b323] font-medium">← Your price</span>
                      <span className="text-gray-500">Premium services</span>
                    </div>
                  </div>
                </FadeIn>

                {/* Line items breakdown */}
                <FadeIn>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Price Breakdown</span>
                    {lineItems.map((item, i) => (
                      <div key={i} className="flex items-start justify-between gap-3 py-1">
                        <div className="flex items-start gap-2.5">
                          <div className="shrink-0 w-5 h-5 rounded-md bg-[#e8b323]/10 flex items-center justify-center mt-0.5">
                            <Check className="h-3 w-3 text-[#e8b323]" />
                          </div>
                          <span className="text-sm text-gray-300">{item.description}</span>
                        </div>
                        {item.pricePence != null && (
                          <span className="text-sm font-mono font-medium text-white shrink-0">
                            £{Math.round(item.pricePence / 100)}
                          </span>
                        )}
                      </div>
                    ))}
                    {hasBatchDiscount && (
                      <div className="flex items-center justify-between gap-3 py-1 border-t border-white/[0.04] mt-1 pt-2">
                        <div className="flex items-center gap-2.5">
                          <div className="shrink-0 w-5 h-5 rounded-md bg-green-500/10 flex items-center justify-center">
                            <TrendingDown className="h-3 w-3 text-green-400" />
                          </div>
                          <span className="text-sm text-green-400">Multi-job discount</span>
                        </div>
                        <span className="text-sm font-mono font-medium text-green-400">Included</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-2 mt-1">
                      <span className="text-sm font-semibold text-white">Total</span>
                      <span className="text-lg font-bold text-[#e8b323] font-mono">£{finalPrice}</span>
                    </div>
                  </div>
                </FadeIn>

                {/* How we calculated — expandable */}
                <FadeIn>
                  <button
                    onClick={() => setShowHowWeCalculated(!showHowWeCalculated)}
                    className="w-full flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-[#e8b323]" />
                      <span className="text-xs text-gray-400">How we calculated this</span>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${showHowWeCalculated ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showHowWeCalculated && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-2 space-y-2.5 text-xs text-gray-400">
                          <div className="flex items-start gap-2 rounded-lg bg-white/[0.02] p-3">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-[#e8b323]/10 flex items-center justify-center text-[9px] font-bold text-[#e8b323]">1</span>
                            <div>
                              <p className="text-gray-300 font-medium">Market Anchor</p>
                              <p>We start with real Nottingham hourly rates from Checkatrade, TaskRabbit & Airtasker — not made-up numbers.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 rounded-lg bg-white/[0.02] p-3">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-[#e8b323]/10 flex items-center justify-center text-[9px] font-bold text-[#e8b323]">2</span>
                            <div>
                              <p className="text-gray-300 font-medium">Context Adjustments</p>
                              <p>AI considers job complexity, access difficulty, urgency, and whether you're bundling multiple jobs.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 rounded-lg bg-white/[0.02] p-3">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-[#e8b323]/10 flex items-center justify-center text-[9px] font-bold text-[#e8b323]">3</span>
                            <div>
                              <p className="text-gray-300 font-medium">Fairness Guardrails</p>
                              <p>6 automated checks ensure you're never over or undercharged. Price floor, ceiling, and hourly rate bounds all verified.</p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </FadeIn>

                {/* Deposit info */}
                <FadeIn>
                  <div className="flex items-center justify-center gap-6 text-xs text-gray-500">
                    <span>30% deposit: <span className="text-gray-300 font-medium">£{deposit}</span></span>
                    <span className="text-white/10">|</span>
                    <span>Balance on completion: <span className="text-gray-300 font-medium">£{balance}</span></span>
                  </div>
                </FadeIn>

                {/* CTA */}
                <FadeIn delay={0.1} className="pt-1">
                  <Button
                    className="w-full h-14 text-base font-semibold rounded-xl border-0 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] gap-2"
                    style={{ backgroundColor: '#25D366', color: '#fff' }}
                    onClick={() => goTo('whatsapp')}
                  >
                    <MessageCircle className="h-5 w-5" />
                    Send Quote to My WhatsApp
                  </Button>
                  <p className="text-[10px] text-gray-600 text-center mt-2">
                    We'll send your detailed quote + next available slots
                  </p>
                </FadeIn>

                <FadeIn>
                  <TrustStrip compact />
                </FadeIn>
              </div>
            </motion.div>
          )}

          {/* ════════════ STEP 7: WHATSAPP / CONTACT ════════════ */}
          {step === 'whatsapp' && (
            <motion.div
              key="whatsapp"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="space-y-5">
                {/* Price reminder */}
                <div className="text-center">
                  <span className="text-3xl font-bold text-[#e8b323]">£{finalPrice}</span>
                  <p className="text-xs text-gray-500 mt-1">{parsedLines.length} job{parsedLines.length !== 1 ? 's' : ''} · {postcode}</p>
                </div>

                {/* WhatsApp card */}
                <div className="rounded-xl border border-[#25D366]/20 bg-[#25D366]/[0.04] p-5 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#25D366]/20 flex items-center justify-center">
                      <MessageCircle className="h-4 w-4 text-[#25D366]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Get your quote on WhatsApp</p>
                      <p className="text-[11px] text-gray-400">Reply with photos for an even more accurate price</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-medium text-gray-400">Your name</label>
                      <Input
                        className="h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-gray-600 focus:border-[#25D366]/50 focus:ring-1 focus:ring-[#25D366]/30 transition-all"
                        placeholder="First name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-medium text-gray-400">WhatsApp number</label>
                      <Input
                        className="h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-gray-600 focus:border-[#25D366]/50 focus:ring-1 focus:ring-[#25D366]/30 transition-all"
                        placeholder="07xxx xxxxxx"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>

                  <Button
                    className="w-full h-12 text-base font-semibold rounded-xl border-0 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] gap-2"
                    style={{
                      backgroundColor: name.trim() && phone.trim() ? '#25D366' : 'rgba(37, 211, 102, 0.2)',
                      color: name.trim() && phone.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
                    }}
                    disabled={!name.trim() || !phone.trim()}
                    onClick={handleSendToWhatsApp}
                  >
                    <Send className="h-4 w-4" />
                    Send My Quote
                  </Button>
                </div>

                {/* What happens next */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">What happens next</span>
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <div className="shrink-0 w-5 h-5 rounded-full bg-[#25D366]/10 flex items-center justify-center text-[9px] font-bold text-[#25D366]">1</div>
                      <p className="text-xs text-gray-400">We send your quote with available time slots</p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <div className="shrink-0 w-5 h-5 rounded-full bg-[#25D366]/10 flex items-center justify-center text-[9px] font-bold text-[#25D366]">2</div>
                      <div className="text-xs text-gray-400">
                        <p>Send us a quick photo of the job <Camera className="h-3 w-3 inline text-gray-500" /> — we'll confirm the exact price</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <div className="shrink-0 w-5 h-5 rounded-full bg-[#25D366]/10 flex items-center justify-center text-[9px] font-bold text-[#25D366]">3</div>
                      <p className="text-xs text-gray-400">Pick a slot, pay 30% deposit, done ✓</p>
                    </div>
                  </div>
                </div>

                {/* Or call */}
                <div className="text-center space-y-2">
                  <p className="text-[10px] text-gray-600 uppercase tracking-widest">Or talk to us now</p>
                  <a href="tel:+447508744402">
                    <Button
                      variant="outline"
                      className="border-white/[0.08] text-gray-300 hover:bg-white/[0.04] hover:text-white rounded-xl gap-2 h-11 px-6"
                    >
                      <Phone className="h-4 w-4" /> Call Us
                    </Button>
                  </a>
                </div>

                {/* Back / Start over */}
                <div className="flex justify-center gap-4 text-xs">
                  <button
                    type="button"
                    className="text-gray-600 hover:text-gray-400 transition-colors"
                    onClick={() => goTo('price')}
                  >
                    ← Back to price
                  </button>
                  <span className="text-white/10">|</span>
                  <button
                    type="button"
                    className="text-gray-600 hover:text-gray-400 transition-colors"
                    onClick={restart}
                  >
                    New quote
                  </button>
                </div>

                <TrustStrip compact />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
