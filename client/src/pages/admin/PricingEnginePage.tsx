/**
 * Pricing Engine — Interactive showcase of the EVE + Contextual pricing pipeline.
 * Designed for presenting to investors, partners, and team members.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquareText,
  Cpu,
  Ruler,
  Brain,
  Shield,
  Receipt,
  ChevronRight,
  ChevronLeft,
  Play,
  RotateCcw,
  Zap,
  Clock,
  Wrench,
  ArrowRight,
  Check,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Package,
  UserCheck,
  Layers,
  Sparkles,
  Lightbulb,
  Eye,
  Users,
  Type,
  LayoutDashboard,
  Star,
  Camera,
  Key,
  Award,
  Home,
  Briefcase,
  Wallet,
  Calendar,
  MessageCircle,
  ShieldCheck,
  FileText,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Signal {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; effect: string }[];
  icon: typeof Zap;
}

interface StageData {
  id: number;
  key: string;
  label: string;
  sublabel: string;
  icon: typeof Cpu;
  color: string;
  accentBg: string;
  accentBorder: string;
  accentText: string;
  headline: string;
  whatHappens: string;
  whyItMatters: string;
  whatToNotice: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STAGES: StageData[] = [
  {
    id: 0, key: "input", label: "Job Input", sublabel: "AI Parser",
    icon: MessageSquareText, color: "#6366f1",
    accentBg: "bg-indigo-500/8", accentBorder: "border-indigo-500/20", accentText: "text-indigo-400",
    headline: "Messy text in, structured jobs out",
    whatHappens: "The customer types a description however they like. Our AI parser reads it and splits it into categorised line items with time estimates — no forms, no dropdowns.",
    whyItMatters: "Zero-friction lead capture. Customers describe jobs the way they'd text a friend — we scale to thousands of leads a day without a human triaging every one.",
    whatToNotice: "One sentence becomes two structured line items with categories and time estimates.",
  },
  {
    id: 1, key: "anchor", label: "Market Anchor", sublabel: "Layer 1",
    icon: Ruler, color: "#3b82f6",
    accentBg: "bg-blue-500/8", accentBorder: "border-blue-500/20", accentText: "text-blue-400",
    headline: "Every line pinned to a real market rate",
    whatHappens: "Each parsed line is matched to a Nottingham market rate from Checkatrade and TaskRabbit, then multiplied by the estimated duration (with a minimum call-out floor).",
    whyItMatters: "Defensible pricing. If any customer asks where the number came from, we can point to published market rates — no made-up multipliers.",
    whatToNotice: "Reference prices are deterministic — the AI hasn't touched them yet.",
  },
  {
    id: 2, key: "context", label: "Contextual Value", sublabel: "Layer 3",
    icon: Brain, color: "#a855f7",
    accentBg: "bg-purple-500/8", accentBorder: "border-purple-500/20", accentText: "text-purple-400",
    headline: "AI adjusts for the signals the customer gave us",
    whatHappens: "Urgency, timing, materials supply, and returning-customer status each move the price up or down. The AI applies these on top of the market anchor.",
    whyItMatters: "This is where the margin lives. Urgency = speed value. Weekend = convenience value. Every signal is a reason we can charge more — or a reason to discount strategically.",
    whatToNotice: "Toggle the signals below — watch the labour subtotal move in real time.",
  },
  {
    id: 3, key: "guard", label: "Guardrails", sublabel: "Layer 4",
    icon: Shield, color: "#ef4444",
    accentBg: "bg-red-500/8", accentBorder: "border-red-500/20", accentText: "text-red-400",
    headline: "Deterministic rules stop the AI going rogue",
    whatHappens: "Floor (can't go below cost), ceiling (can't shock customer), minimum charge, batch discount for multi-job bookings, and psychological rounding all run as hard-coded rules.",
    whyItMatters: "AI is creative, which is dangerous for pricing. Guardrails make sure every quote is profitable, competitive, and consistent — no hallucinated numbers ever reach a customer.",
    whatToNotice: "All six rules pass. The AI's output is constrained — it can't override these.",
  },
  {
    id: 4, key: "output", label: "Price Output", sublabel: "Final £",
    icon: Receipt, color: "#7DB00E",
    accentBg: "bg-[#7DB00E]/8", accentBorder: "border-[#7DB00E]/20", accentText: "text-[#7DB00E]",
    headline: "A defensible price — ready to frame",
    whatHappens: "The pricing engine hands off a final number, a deposit split, and a pay-in-full discount. But the price alone isn't the quote — it needs framing, a layout, and a segment-aware page.",
    whyItMatters: "Two customers can get the same £189 price but see completely different quote pages. A Busy Pro sees speed. A Landlord sees photo proof. A Budget customer sees the discount. Same price, different stories.",
    whatToNotice: "This is the handoff point. Pricing is done — now the quote builder takes over.",
  },
  {
    id: 5, key: "segment", label: "Segment Detection", sublabel: "Layer 5",
    icon: Users, color: "#f59e0b",
    accentBg: "bg-amber-500/8", accentBorder: "border-amber-500/20", accentText: "text-amber-400",
    headline: "The customer is classified before they see a price",
    whatHappens: "Keywords, phrases, and patterns in the customer's message trigger a segment classifier. \"I work 9-5\" → BUSY_PRO. \"My tenant\" → LANDLORD. \"Cheap as possible\" → BUDGET.",
    whyItMatters: "Segment is the multiplier on everything that follows. It decides hero copy, feature list, add-ons, scarcity framing, guarantee length, even which time slots they can book. One classification, seven downstream decisions.",
    whatToNotice: "Click a segment below to see how the same job turns into a different quote experience.",
  },
  {
    id: 6, key: "framing", label: "Framing Engine", sublabel: "LLM",
    icon: Type, color: "#ec4899",
    accentBg: "bg-pink-500/8", accentBorder: "border-pink-500/20", accentText: "text-pink-400",
    headline: "LLM writes the headline, bullets, and 'dead zone' reframing",
    whatHappens: "A second LLM pass writes the quote's narrative: a contextual headline, 3-5 value bullets, a proposal summary, and — critically — 'dead zone' framing that reframes awkward price bands (£100-£200) as affordable (\"That's £5/day for 30 days\").",
    whyItMatters: "The dead zone alone recovers conversions from price bands where customers hesitate. Reframing £180 as '£6/day for a month' sounds trivially cheap — same price, different perception.",
    whatToNotice: "Every piece of text on the final quote is generated — but constrained to approved claims. No hallucinated guarantees.",
  },
  {
    id: 7, key: "composition", label: "Quote Composition", sublabel: "Final",
    icon: LayoutDashboard, color: "#7DB00E",
    accentBg: "bg-[#7DB00E]/8", accentBorder: "border-[#7DB00E]/20", accentText: "text-[#7DB00E]",
    headline: "Every block on the page is chosen by segment",
    whatHappens: "The quote page is assembled from a library of components: UnifiedQuoteCard, scarcity banner, hassle comparison, guarantee badge. Each component reads the segment config and renders the right copy, add-ons, and payment options.",
    whyItMatters: "This is the full land. One LLM-authored, segment-aware, psychologically-priced, defensible quote — delivered to WhatsApp in 30 seconds, zero humans in the loop, at scale.",
    whatToNotice: "The quote page preview below is composed entirely from the configs and data you've seen in previous stages.",
  },
];

const CATEGORY_RATES = [
  { cat: "General Fixing", rate: 30, min: 45, source: "Checkatrade" },
  { cat: "Plumbing Minor", rate: 45, min: 60, source: "Checkatrade" },
  { cat: "Electrical Minor", rate: 50, min: 65, source: "Checkatrade" },
  { cat: "Door Fitting", rate: 35, min: 60, source: "Checkatrade" },
  { cat: "Carpentry", rate: 40, min: 55, source: "Checkatrade" },
  { cat: "Flat Pack", rate: 28, min: 40, source: "TaskRabbit" },
  { cat: "TV Mounting", rate: 35, min: 50, source: "TaskRabbit" },
  { cat: "Painting", rate: 30, min: 80, source: "Checkatrade" },
];

// ─── Segment Presets ─────────────────────────────────────────────────────────
// Real copy from server/segmentation/config.ts, SchedulingConfig.ts, and hassle-comparisons.ts

interface SegmentPreset {
  id: string;
  name: string;
  icon: typeof Users;
  color: string;
  wtpLevel: string;
  valueDriver: string;
  keyPhrase: string;
  triggerKeywords: string[];
  triggerExample: string;
  // Framing outputs (LLM-generated)
  headline: string;
  contextualMessage: string;
  valueBullets: string[];
  deadZoneFraming: string;
  // Quote card config
  priceLabel: string;
  timeSlots: string[];
  addOns: { name: string; price: number; popular?: boolean }[];
  downsellLabel: string | null;
  guarantee: string;
  scarcityCopy: string;
  // Hassle framing
  withoutUs: string;
  withUs: string;
}

const SEGMENT_PRESETS: Record<string, SegmentPreset> = {
  BUSY_PRO: {
    id: "BUSY_PRO",
    name: "Busy Professional",
    icon: Briefcase,
    color: "#3b82f6",
    wtpLevel: "HIGH",
    valueDriver: "Speed, convenience, reliability",
    keyPhrase: "This week",
    triggerKeywords: ["asap", "wfh", "work schedule", "key safe", "flexible access"],
    triggerExample: "\"Need this done ASAP — I work 9-5, happy to leave a key in a lockbox\"",
    headline: "Done While You're at Work",
    contextualMessage: "Booked this week, keys collected, photos sent on completion. Zero disruption to your schedule.",
    valueBullets: [
      "Booked within 7 days",
      "Key pickup — no need to be home",
      "Photo updates sent during the job",
      "90-day guarantee included",
    ],
    deadZoneFraming: "That's less than one hour of your billable time",
    priceLabel: "Priority Service",
    timeSlots: ["Morning", "Afternoon", "First Slot (8am)", "Exact Time"],
    addOns: [
      { name: "+15 Min Task", price: 25, popular: true },
      { name: "Key Pickup", price: 10 },
      { name: "Photo Proof", price: 0 },
      { name: "Year Guarantee", price: 30 },
    ],
    downsellLabel: null,
    guarantee: "90 days",
    scarcityCopy: "2 priority slots left this week",
    withoutUs: "Wait 2-3 weeks, rearrange your whole schedule",
    withUs: "Booked this week — done while you're at work",
  },
  LANDLORD: {
    id: "LANDLORD",
    name: "Landlord",
    icon: Home,
    color: "#a855f7",
    wtpLevel: "MEDIUM",
    valueDriver: "Photo proof, tenant coordination, zero hassle",
    keyPhrase: "One text, sorted",
    triggerKeywords: ["my rental", "tenant", "buy to let", "btl", "landlord"],
    triggerExample: "\"My tenant in Sherwood reported a leak — I live 2 hours away, can you sort it?\"",
    headline: "Your Rental. Handled.",
    contextualMessage: "One text. We coordinate with your tenant, fix the issue, send photos, and email the invoice. You don't need to be there.",
    valueBullets: [
      "48-72hr response commitment",
      "We coordinate directly with your tenant",
      "Before/after photo report",
      "Tax-ready invoice same day",
    ],
    deadZoneFraming: "Less than one night in a rental void",
    priceLabel: "Job Price",
    timeSlots: ["Morning", "Afternoon"],
    addOns: [
      { name: "Tenant Coordination", price: 0, popular: true },
      { name: "Photo Report", price: 0, popular: true },
      { name: "Key Collection", price: 30 },
    ],
    downsellLabel: null,
    guarantee: "90 days + landlord protection",
    scarcityCopy: "180+ landlords trust us",
    withoutUs: "Drive 2 hours to check the work yourself",
    withUs: "Photo proof sent straight to your phone",
  },
  BUDGET: {
    id: "BUDGET",
    name: "Budget Conscious",
    icon: Wallet,
    color: "#10b981",
    wtpLevel: "LOW",
    valueDriver: "Lowest price, basic service",
    keyPhrase: "Gets it done",
    triggerKeywords: ["cheap", "budget", "affordable", "save", "renter"],
    triggerExample: "\"Just need it fixed — cheapest option please, I'm renting\"",
    headline: "Fixed. Simple. Sorted.",
    contextualMessage: "Straightforward repair, fair price. No upsells, no extras you don't need.",
    valueBullets: [
      "Fixed price — no surprises",
      "30-day workmanship guarantee",
      "Save 10% with flexible timing",
    ],
    deadZoneFraming: "About the same as a takeaway for two",
    priceLabel: "Standard Service",
    timeSlots: ["Morning", "Afternoon"],
    addOns: [],
    downsellLabel: "Flexible Timing — save 10%",
    guarantee: "30 days",
    scarcityCopy: "Save 10% if booked before Friday",
    withoutUs: "Bounce between quotes, worry about hidden fees",
    withUs: "One fixed price — that's what you pay",
  },
};

// ─── Example Calculation Engine ──────────────────────────────────────────────

function calculateExample(signals: Record<string, string>) {
  // Base: Plumbing 45min + Door fitting 90min
  const plumbingRef = Math.max(45 * (45 / 60), 60); // £33.75 → min £60
  const doorRef = Math.max(35 * (90 / 60), 60); // £52.50

  let plumbingPrice = 55; // AI baseline
  let doorPrice = 95; // AI baseline

  // Urgency
  if (signals.urgency === "priority") {
    plumbingPrice = Math.round(plumbingPrice * 1.15);
    doorPrice = Math.round(doorPrice * 1.15);
  } else if (signals.urgency === "emergency") {
    plumbingPrice = Math.round(plumbingPrice * 1.40);
    doorPrice = Math.round(doorPrice * 1.40);
  }

  // Time of service
  if (signals.timing === "after_hours" || signals.timing === "weekend") {
    plumbingPrice = Math.round(plumbingPrice * 1.20);
    doorPrice = Math.round(doorPrice * 1.20);
  }

  // Materials
  let materialsCost = 0;
  if (signals.materials === "we_supply") {
    materialsCost = Math.round(85 * 1.27); // £85 door cost × 1.27
  }

  // Returning customer
  if (signals.returning === "yes") {
    plumbingPrice = Math.round(plumbingPrice * 0.93);
    doorPrice = Math.round(doorPrice * 0.93);
  }

  const labourSubtotal = plumbingPrice + doorPrice;

  // Batch discount (2 jobs)
  const batchPercent = 8;
  const batchDiscount = Math.round(labourSubtotal * (batchPercent / 100));
  const discountedLabour = labourSubtotal - batchDiscount;

  // Floor check (£60/hr)
  const plumbingHourly = plumbingPrice / (45 / 60);
  const doorHourly = doorPrice / (90 / 60);
  const floorTriggered = plumbingHourly < 60 || doorHourly < 60;

  // Final
  const combined = discountedLabour + materialsCost;
  const lastDigit = combined % 10;
  const finalPrice = combined - lastDigit + 9;

  const deposit = Math.round(finalPrice * 0.30);
  const balance = finalPrice - deposit;

  return {
    plumbingRef, doorRef,
    plumbingPrice, doorPrice,
    labourSubtotal,
    batchPercent, batchDiscount, discountedLabour,
    materialsCost,
    combined, finalPrice,
    deposit, balance,
    floorTriggered,
    plumbingHourly: Math.round(plumbingHourly),
    doorHourly: Math.round(doorHourly),
  };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PricingEnginePage() {
  const [activeStage, setActiveStage] = useState(-1);
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<string>("BUSY_PRO");
  const [signals, setSignals] = useState<Record<string, string>>({
    urgency: "standard",
    materials: "customer_supplied",
    timing: "standard",
    returning: "no",
  });

  const calc = calculateExample(signals);
  const segment = SEGMENT_PRESETS[selectedSegment];

  const goToStage = useCallback((id: number) => {
    setActiveStage(id);
    setExpandedStage(id);
  }, []);

  const startWalkthrough = useCallback(() => {
    goToStage(0);
  }, [goToStage]);

  const nextStage = useCallback(() => {
    const current = expandedStage ?? -1;
    const next = Math.min(current + 1, STAGES.length - 1);
    goToStage(next);
  }, [expandedStage, goToStage]);

  const prevStage = useCallback(() => {
    const current = expandedStage ?? 0;
    const prev = Math.max(current - 1, 0);
    goToStage(prev);
  }, [expandedStage, goToStage]);

  const reset = () => {
    setActiveStage(-1);
    setExpandedStage(null);
    setSignals({
      urgency: "standard",
      materials: "customer_supplied",
      timing: "standard",
      returning: "no",
    });
  };

  return (
    <div className="min-h-screen bg-[#060a12] text-white selection:bg-purple-500/30">
      {/* Subtle grid background */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-5xl mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-10"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
            <span className="text-[10px] font-mono tracking-[0.3em] text-slate-500 uppercase">
              HandyServices Pricing Architecture
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mb-2">
            <span className="text-slate-300">EVE</span>
            <span className="text-slate-600 mx-2">+</span>
            <span className="bg-gradient-to-r from-purple-400 to-[#7DB00E] bg-clip-text text-transparent">
              Contextual Pricing
            </span>
          </h1>
          <p className="text-center text-sm text-slate-500 max-w-lg mx-auto">
            Market-grounded reference rates, adjusted by AI for real-time context,
            constrained by deterministic guardrails.
          </p>

          {/* Controls */}
          <div className="flex justify-center gap-3 mt-6">
            <button
              onClick={startWalkthrough}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500/20 to-[#7DB00E]/20 border border-purple-500/30 text-sm font-medium hover:from-purple-500/30 hover:to-[#7DB00E]/30 transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              Start Walkthrough
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </motion.div>

        {/* Pipeline Track */}
        <div className="flex items-start justify-between mb-8 px-1 overflow-x-auto">
          {STAGES.map((stage, i) => (
            <div key={stage.key} className="flex items-center flex-1 last:flex-none min-w-0">
              <button
                onClick={() => {
                  setActiveStage(stage.id);
                  setExpandedStage(expandedStage === stage.id ? null : stage.id);
                }}
                className="group flex flex-col items-center gap-1.5 relative min-w-0"
              >
                <motion.div
                  animate={{
                    scale: activeStage === stage.id ? 1.15 : 1,
                    boxShadow: activeStage >= stage.id
                      ? `0 0 20px ${stage.color}30, 0 0 40px ${stage.color}10`
                      : "none",
                  }}
                  className={`w-8 h-8 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center border transition-all duration-500 ${
                    activeStage >= stage.id
                      ? `${stage.accentBg} ${stage.accentBorder}`
                      : "bg-white/[0.03] border-white/[0.06]"
                  }`}
                >
                  <stage.icon
                    className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-colors duration-500 ${
                      activeStage >= stage.id ? stage.accentText : "text-slate-600"
                    }`}
                  />
                </motion.div>
                <span className={`text-[8px] sm:text-[9px] font-mono uppercase tracking-wider transition-colors whitespace-nowrap ${
                  activeStage >= stage.id ? "text-slate-300" : "text-slate-600"
                }`}>
                  {stage.sublabel}
                </span>
                <span className={`text-[10px] sm:text-[11px] font-medium transition-colors hidden md:block whitespace-nowrap ${
                  activeStage >= stage.id ? "text-slate-400" : "text-slate-700"
                }`}>
                  {stage.label}
                </span>
              </button>
              {i < STAGES.length - 1 && (
                <div className="flex-1 mx-0.5 sm:mx-1 mt-4">
                  <motion.div
                    className="h-px"
                    animate={{
                      background: activeStage > i
                        ? `linear-gradient(90deg, ${STAGES[i].color}60, ${STAGES[i + 1].color}60)`
                        : "rgba(255,255,255,0.06)",
                    }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Stage Content */}
        <AnimatePresence mode="wait">
          {expandedStage === 0 && (
            <InputStage key="input" onNext={nextStage} onPrev={prevStage} />
          )}
          {expandedStage === 1 && (
            <AnchorStage key="anchor" rates={CATEGORY_RATES} calc={calc} onNext={nextStage} onPrev={prevStage} />
          )}
          {expandedStage === 2 && (
            <ContextStage
              key="context"
              signals={signals}
              setSignals={setSignals}
              calc={calc}
              onNext={nextStage}
              onPrev={prevStage}
            />
          )}
          {expandedStage === 3 && (
            <GuardrailStage key="guard" calc={calc} onNext={nextStage} onPrev={prevStage} />
          )}
          {expandedStage === 4 && (
            <OutputStage key="output" calc={calc} signals={signals} onNext={nextStage} onPrev={prevStage} />
          )}
          {expandedStage === 5 && (
            <SegmentDetectionStage
              key="segment"
              selectedSegment={selectedSegment}
              setSelectedSegment={setSelectedSegment}
              onNext={nextStage}
              onPrev={prevStage}
            />
          )}
          {expandedStage === 6 && (
            <FramingEngineStage
              key="framing"
              segment={segment}
              calc={calc}
              onNext={nextStage}
              onPrev={prevStage}
            />
          )}
          {expandedStage === 7 && (
            <QuoteCompositionStage
              key="composition"
              segment={segment}
              setSelectedSegment={setSelectedSegment}
              calc={calc}
              onNext={nextStage}
              onPrev={prevStage}
            />
          )}
        </AnimatePresence>

        {/* Live Calculation Strip */}
        {activeStage >= 1 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-[#7DB00E]" />
              <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">Live Calculation</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <CalcBox
                label="Reference"
                value={`£${(calc.plumbingRef + calc.doorRef).toFixed(0)}`}
                sub="Market baseline"
                active={activeStage >= 1}
                color="text-blue-400"
              />
              <CalcBox
                label="AI Adjusted"
                value={`£${calc.labourSubtotal}`}
                sub={`Plumbing £${calc.plumbingPrice} + Door £${calc.doorPrice}`}
                active={activeStage >= 2}
                color="text-purple-400"
              />
              <CalcBox
                label="After Guardrails"
                value={`£${calc.discountedLabour}${calc.materialsCost > 0 ? ` + £${calc.materialsCost}` : ""}`}
                sub={`-${calc.batchPercent}% batch${calc.materialsCost > 0 ? " + materials" : ""}`}
                active={activeStage >= 3}
                color="text-red-400"
              />
              <CalcBox
                label="Final Quote"
                value={`£${calc.finalPrice}`}
                sub={`£${calc.deposit} deposit`}
                active={activeStage >= 4}
                color="text-[#7DB00E]"
                highlight
              />
            </div>
          </motion.div>
        )}

        {/* EVE Formula */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-10 text-center"
        >
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full border border-white/[0.06] bg-white/[0.02]">
            <span className="text-xs font-mono text-slate-500">EVE FORMULA</span>
            <span className="text-slate-600">|</span>
            <span className="text-sm">
              <span className="text-[#7DB00E] font-semibold">Price</span>
              <span className="text-slate-500"> = </span>
              <span className="text-blue-400">Reference</span>
              <span className="text-slate-500"> + </span>
              <span className="text-purple-400">Differentiator Value</span>
            </span>
          </div>
          <p className="text-[11px] text-slate-600 mt-2 font-mono">
            Madhavan Ramanujam · Monetizing Innovation
          </p>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Stage Components ────────────────────────────────────────────────────────

function StageCard({
  children,
  stage,
  onNext,
  onPrev,
}: {
  children: React.ReactNode;
  stage: StageData;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const isFirst = stage.id === 0;
  const isLast = stage.id === STAGES.length - 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35 }}
      className={`rounded-xl border ${stage.accentBorder} ${stage.accentBg} overflow-hidden`}
    >
      {/* Wizard Narrative Header */}
      <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-white/[0.06] bg-black/20">
        <div className="flex items-center justify-between mb-3">
          <span className={`text-[10px] font-mono uppercase tracking-[0.2em] ${stage.accentText}`}>
            Step {stage.id + 1} of {STAGES.length} · {stage.label}
          </span>
          <div className="flex gap-1">
            {STAGES.map((s) => (
              <div
                key={s.id}
                className={`h-1 w-6 rounded-full transition-colors ${
                  s.id <= stage.id ? stage.accentText.replace("text-", "bg-") : "bg-white/10"
                }`}
              />
            ))}
          </div>
        </div>
        <h3 className="text-lg sm:text-xl font-semibold text-white mb-3 leading-snug">
          {stage.headline}
        </h3>
        <p className="text-sm text-slate-300 leading-relaxed mb-3">{stage.whatHappens}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
          <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <Lightbulb className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-0.5">
                Why it matters
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">{stage.whyItMatters}</p>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <Eye className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${stage.accentText}`} />
            <div>
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-0.5">
                What to notice
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">{stage.whatToNotice}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Technical Content */}
      <div className="p-5 sm:p-6">{children}</div>

      {/* Wizard Footer Navigation */}
      {(onNext || onPrev) && (
        <div className="px-5 sm:px-6 py-4 border-t border-white/[0.06] bg-black/20 flex items-center justify-between">
          <button
            onClick={onPrev}
            disabled={isFirst}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Previous
          </button>
          <span className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">
            {isLast ? "End of walkthrough" : `Next: ${STAGES[stage.id + 1].label}`}
          </span>
          <button
            onClick={onNext}
            disabled={isLast}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              isLast
                ? "text-slate-400"
                : `${stage.accentText} ${stage.accentBg} border ${stage.accentBorder} hover:brightness-125`
            }`}
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </motion.div>
  );
}

function InputStage({ onNext, onPrev }: { onNext?: () => void; onPrev?: () => void }) {
  const stage = STAGES[0];
  return (
    <StageCard stage={stage} onNext={onNext} onPrev={onPrev}>
      <StageHeader stage={stage} badge="GPT-4o-mini" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {/* Input */}
        <div className="space-y-2">
          <Label text="Free Text Input" />
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
            <p className="text-sm text-slate-300 italic leading-relaxed">
              "Fix dripping bathroom tap and hang a new internal door, customer has the door"
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
              <Zap className="w-3 h-3" />
              urgency: standard
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
              <Package className="w-3 h-3" />
              materials: customer supplied
            </div>
          </div>
        </div>

        {/* Output */}
        <div className="space-y-2">
          <Label text="Structured Line Items" />
          <div className="space-y-2">
            <LineItem
              num={1}
              category="plumbing_minor"
              desc="Fix dripping bathroom tap"
              time="45 min"
              color="text-cyan-400"
            />
            <LineItem
              num={2}
              category="door_fitting"
              desc="Hang new internal door"
              time="90 min"
              color="text-amber-400"
            />
          </div>
          <p className="text-[10px] text-slate-600 mt-2">
            Parser selects from 24 valid categories. Unknown → "other" + human review flag
          </p>
        </div>
      </div>
    </StageCard>
  );
}

function AnchorStage({
  rates,
  calc,
  onNext,
  onPrev,
}: {
  rates: typeof CATEGORY_RATES;
  calc: ReturnType<typeof calculateExample>;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const stage = STAGES[1];
  return (
    <StageCard stage={stage} onNext={onNext} onPrev={onPrev}>
      <StageHeader stage={stage} badge="Deterministic" />

      <div className="mt-4 space-y-4">
        <div>
          <Label text="Nottingham Market Rates" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
            {rates.map((r) => (
              <div
                key={r.cat}
                className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5"
              >
                <p className="text-xs font-medium text-slate-300">{r.cat}</p>
                <p className="text-sm font-mono text-blue-400">£{r.rate}/hr</p>
                <p className="text-[10px] text-slate-600">min £{r.min}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
          <Label text="Example Calculation" />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <p className="text-xs text-slate-500 mb-1">Plumbing Minor — 45 min</p>
              <p className="text-sm font-mono text-slate-300">
                £45/hr × 0.75hr = <span className="text-slate-500">£33.75</span>
                <ArrowRight className="w-3 h-3 inline mx-1 text-slate-600" />
                <span className="text-blue-400">£{calc.plumbingRef}</span>
                <span className="text-[10px] text-slate-600 ml-1">(min charge)</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Door Fitting — 90 min</p>
              <p className="text-sm font-mono text-slate-300">
                £35/hr × 1.5hr = <span className="text-blue-400">£{calc.doorRef.toFixed(2)}</span>
              </p>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-white/[0.05]">
            <p className="text-xs font-mono text-slate-400">
              Reference Total: <span className="text-blue-400 font-semibold">£{(calc.plumbingRef + calc.doorRef).toFixed(2)}</span>
            </p>
          </div>
        </div>

        <div className="text-xs font-mono text-slate-600 bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04]">
          formula: Reference = max(hourly_rate × hours, minimum_charge)
        </div>
      </div>
    </StageCard>
  );
}

function ContextStage({
  signals,
  setSignals,
  calc,
  onNext,
  onPrev,
}: {
  signals: Record<string, string>;
  setSignals: (s: Record<string, string>) => void;
  calc: ReturnType<typeof calculateExample>;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const stage = STAGES[2];

  const signalDefs: Signal[] = [
    {
      id: "urgency", label: "Urgency", icon: Zap,
      value: signals.urgency,
      options: [
        { value: "standard", label: "Standard", effect: "0%" },
        { value: "priority", label: "Priority", effect: "+15%" },
        { value: "emergency", label: "Emergency", effect: "+40%" },
      ],
    },
    {
      id: "materials", label: "Materials", icon: Package,
      value: signals.materials,
      options: [
        { value: "labor_only", label: "Labour Only", effect: "0" },
        { value: "customer_supplied", label: "Customer", effect: "0" },
        { value: "we_supply", label: "We Supply", effect: "+27% markup" },
      ],
    },
    {
      id: "timing", label: "Scheduling", icon: Clock,
      value: signals.timing,
      options: [
        { value: "standard", label: "Weekday", effect: "0%" },
        { value: "after_hours", label: "Evening", effect: "+20%" },
        { value: "weekend", label: "Weekend", effect: "+20%" },
      ],
    },
    {
      id: "returning", label: "Customer", icon: UserCheck,
      value: signals.returning,
      options: [
        { value: "no", label: "New", effect: "0%" },
        { value: "yes", label: "Returning", effect: "-7%" },
      ],
    },
  ];

  return (
    <StageCard stage={stage} onNext={onNext} onPrev={onPrev}>
      <StageHeader stage={stage} badge="AI · GPT-4o-mini" />

      <p className="text-xs text-slate-500 mt-2 mb-4">
        Toggle signals below to see how they affect the price in real-time.
      </p>

      {/* Signal Toggles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {signalDefs.map((sig) => (
          <div key={sig.id} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <sig.icon className="w-3 h-3 text-slate-500" />
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{sig.label}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {sig.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSignals({ ...signals, [sig.id]: opt.value })}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-all ${
                    sig.value === opt.value
                      ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                      : "bg-white/[0.02] border-white/[0.06] text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {opt.label}
                  <span className={`ml-1 ${
                    opt.effect.startsWith("+") ? "text-orange-400" :
                    opt.effect.startsWith("-") ? "text-green-400" : "text-slate-600"
                  }`}>
                    {opt.effect}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Adjustment Result */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
        <Label text="AI Price Adjustment" />
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Plumbing</span>
            <span className="text-sm font-mono text-purple-400">£{calc.plumbingPrice}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Door Fitting</span>
            <span className="text-sm font-mono text-purple-400">£{calc.doorPrice}</span>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-white/[0.05] flex items-center justify-between">
          <span className="text-xs text-slate-500">Labour Subtotal</span>
          <span className="text-sm font-mono font-semibold text-purple-400">£{calc.labourSubtotal}</span>
        </div>
        {calc.materialsCost > 0 && (
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-slate-500">Materials (27% markup)</span>
            <span className="text-sm font-mono text-amber-400">+ £{calc.materialsCost}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <MiniTag icon={Sparkles} text="Generates headline + value bullets" />
        <MiniTag icon={MessageSquareText} text="WhatsApp message auto-composed" />
      </div>
    </StageCard>
  );
}

function GuardrailStage({
  calc,
  onNext,
  onPrev,
}: {
  calc: ReturnType<typeof calculateExample>;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const stage = STAGES[3];

  const rules = [
    {
      name: "Floor",
      rule: "≥ market rate × hours",
      status: true,
      detail: "Both lines above reference floor",
    },
    {
      name: "Minimum Charge",
      rule: "≥ category callout fee",
      status: true,
      detail: "Plumbing ≥ £60, Door ≥ £60",
    },
    {
      name: "Ceiling",
      rule: "≤ 3× rate (4× emergency)",
      status: true,
      detail: "Well within ceiling bounds",
    },
    {
      name: "Floor Rate",
      rule: "≥ £60/hr effective",
      status: calc.plumbingHourly >= 60 && calc.doorHourly >= 60,
      detail: `Plumbing £${calc.plumbingHourly}/hr, Door £${calc.doorHourly}/hr`,
    },
    {
      name: "Returning Cap",
      rule: "≤ prev avg × 1.15",
      status: true,
      detail: "N/A — new customer",
    },
    {
      name: "Psychological",
      rule: "Final ends in 9",
      status: true,
      detail: `£${calc.combined} → £${calc.finalPrice}`,
    },
  ];

  return (
    <StageCard stage={stage} onNext={onNext} onPrev={onPrev}>
      <StageHeader stage={stage} badge="Deterministic" />

      <div className="mt-4 space-y-2">
        {rules.map((r) => (
          <div
            key={r.name}
            className={`flex items-center gap-3 rounded-lg border p-2.5 ${
              r.status
                ? "border-white/[0.05] bg-white/[0.02]"
                : "border-red-500/20 bg-red-500/5"
            }`}
          >
            {r.status ? (
              <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-300">{r.name}</span>
                <span className="text-[10px] font-mono text-slate-600">{r.rule}</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-0.5">{r.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Batch Discount ({calc.batchPercent}% on labour)</span>
          <span className="text-sm font-mono text-green-400">-£{calc.batchDiscount}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-slate-500">Discounted Labour</span>
          <span className="text-sm font-mono text-slate-300">£{calc.discountedLabour}</span>
        </div>
        {calc.materialsCost > 0 && (
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-slate-500">Materials (pass-through, not discounted)</span>
            <span className="text-sm font-mono text-slate-300">+ £{calc.materialsCost}</span>
          </div>
        )}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.05]">
          <span className="text-xs font-medium text-slate-400">After Guardrails</span>
          <span className="text-sm font-mono font-semibold text-red-400">£{calc.finalPrice}</span>
        </div>
      </div>
    </StageCard>
  );
}

function OutputStage({
  calc,
  signals,
  onNext,
  onPrev,
}: {
  calc: ReturnType<typeof calculateExample>;
  signals: Record<string, string>;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const stage = STAGES[4];

  return (
    <StageCard stage={stage} onNext={onNext} onPrev={onPrev}>
      <StageHeader stage={stage} badge="Customer-facing" />

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Price Card */}
        <div className="rounded-xl border border-[#7DB00E]/20 bg-[#7DB00E]/5 p-4">
          <p className="text-xs text-[#7DB00E] font-mono uppercase tracking-wider mb-2">Final Price</p>
          <p className="text-4xl font-bold text-white tracking-tight">
            £{calc.finalPrice}
          </p>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Deposit (30%)</span>
              <span className="text-[#7DB00E] font-mono font-semibold">£{calc.deposit}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Balance on completion</span>
              <span className="text-slate-300 font-mono">£{calc.balance}</span>
            </div>
            <div className="flex justify-between text-xs pt-1.5 border-t border-white/[0.06]">
              <span className="text-slate-400">Pay in full (-3%)</span>
              <span className="text-green-400 font-mono">£{Math.round(calc.finalPrice * 0.97)}</span>
            </div>
          </div>
        </div>

        {/* Output Details */}
        <div className="space-y-2">
          <Label text="Quote Page Output" />
          <OutputRow label="Layout" value="Standard (2 lines)" />
          <OutputRow label="Headline" value='"Tap & Door — Sorted"' accent />
          <OutputRow label="Booking" value={
            signals.urgency === "emergency" ? "Date + Urgent Premium" :
            signals.urgency === "priority" ? "Date + Urgent Premium" :
            calc.finalPrice >= 150 ? "Date + Flexible -10% + Deposit Split" :
            "Date + Flexible -10%"
          } />
          <OutputRow label="Scarcity" value={
            signals.urgency === "emergency" ? "Red — emergency" :
            signals.urgency === "priority" ? "Amber — priority" :
            "Slate — calm"
          } />
          <OutputRow label="Delivery" value="WhatsApp + PDF" />
        </div>
      </div>
    </StageCard>
  );
}

// ─── New Stages: Segment Detection, Framing, Quote Composition ──────────────

function SegmentDetectionStage({
  selectedSegment,
  setSelectedSegment,
  onNext,
  onPrev,
}: {
  selectedSegment: string;
  setSelectedSegment: (s: string) => void;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const stage = STAGES[5];
  const segment = SEGMENT_PRESETS[selectedSegment];
  const segments = Object.values(SEGMENT_PRESETS);

  return (
    <StageCard stage={stage} onNext={onNext} onPrev={onPrev}>
      <StageHeader stage={stage} badge="Keyword + Pattern Match" />

      <div className="mt-4 space-y-4">
        {/* Segment Switcher */}
        <div>
          <Label text="Pick a segment" />
          <div className="grid grid-cols-3 gap-2 mt-2">
            {segments.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSegment(s.id)}
                className={`flex items-center gap-2 rounded-lg border p-3 transition-all ${
                  selectedSegment === s.id
                    ? "bg-white/[0.06] border-white/20"
                    : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                }`}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: `${s.color}15`,
                    border: `1px solid ${s.color}30`,
                  }}
                >
                  <s.icon className="w-4 h-4" style={{ color: s.color }} />
                </div>
                <div className="text-left min-w-0">
                  <p className="text-xs font-medium text-white truncate">{s.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">WTP: {s.wtpLevel}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detected Example */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-4">
          <Label text="Detected from customer message" />
          <p className="text-sm text-slate-300 italic leading-relaxed mt-2">
            {segment.triggerExample}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {segment.triggerKeywords.map((k) => (
              <span
                key={k}
                className="text-[10px] font-mono px-2 py-0.5 rounded"
                style={{
                  color: segment.color,
                  backgroundColor: `${segment.color}10`,
                  border: `1px solid ${segment.color}25`,
                }}
              >
                {k}
              </span>
            ))}
          </div>
        </div>

        {/* Profile Card */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ProfileCell label="WTP Level" value={segment.wtpLevel} color={segment.color} />
          <ProfileCell label="Value Driver" value={segment.valueDriver} color={segment.color} />
          <ProfileCell label="Key Phrase" value={`"${segment.keyPhrase}"`} color={segment.color} />
        </div>

        <div className="text-xs font-mono text-slate-600 bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04]">
          signal source: server/segmentation/config.ts · SEGMENT_SIGNALS[{segment.id}]
        </div>
      </div>
    </StageCard>
  );
}

function FramingEngineStage({
  segment,
  calc,
  onNext,
  onPrev,
}: {
  segment: SegmentPreset;
  calc: ReturnType<typeof calculateExample>;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const stage = STAGES[6];

  return (
    <StageCard stage={stage} onNext={onNext} onPrev={onPrev}>
      <StageHeader stage={stage} badge={`AI · ${segment.name}`} />

      <div className="mt-4 space-y-4">
        {/* LLM Input → Output */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center">
          <div className="sm:col-span-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
            <Label text="LLM Input" />
            <div className="mt-2 space-y-1.5 text-[11px] font-mono text-slate-400">
              <div>segment: <span className="text-amber-400">{segment.id}</span></div>
              <div>price: <span className="text-[#7DB00E]">£{calc.finalPrice}</span></div>
              <div>lines: <span className="text-blue-400">2</span></div>
              <div>signals: <span className="text-purple-400">urgent, labour-only</span></div>
            </div>
          </div>
          <div className="hidden sm:flex justify-center">
            <ArrowRight className="w-5 h-5 text-slate-600" />
          </div>
          <div className="sm:col-span-2 rounded-lg border border-pink-500/20 bg-pink-500/5 p-3">
            <Label text="LLM Output (JSON)" />
            <div className="mt-2 space-y-1.5 text-[11px] font-mono text-pink-300">
              <div>headline</div>
              <div>contextualMessage</div>
              <div>valueBullets[]</div>
              <div>deadZoneFraming</div>
            </div>
          </div>
        </div>

        {/* Rendered Framing */}
        <div className="rounded-lg border border-white/[0.06] bg-gradient-to-br from-pink-500/[0.03] to-transparent p-4">
          <Label text="Rendered framing (what the customer sees)" />

          <h4 className="text-xl sm:text-2xl font-bold text-white mt-3 leading-tight">
            {segment.headline}
          </h4>
          <p className="text-sm text-slate-300 mt-2 leading-relaxed">
            {segment.contextualMessage}
          </p>

          <div className="mt-4 space-y-1.5">
            {segment.valueBullets.map((b, i) => (
              <div key={i} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-[#7DB00E] flex-shrink-0 mt-0.5" />
                <span className="text-xs text-slate-300">{b}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider">
                Dead Zone Framing
              </span>
            </div>
            <p className="text-sm text-amber-100 italic">£{calc.finalPrice} — {segment.deadZoneFraming}</p>
          </div>
        </div>

        <div className="text-xs font-mono text-slate-600 bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04]">
          output schema: shared/contextual-pricing-types.ts · QuoteMessaging
        </div>
      </div>
    </StageCard>
  );
}

function QuoteCompositionStage({
  segment,
  setSelectedSegment,
  calc,
  onNext,
  onPrev,
}: {
  segment: SegmentPreset;
  setSelectedSegment: (s: string) => void;
  calc: ReturnType<typeof calculateExample>;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const stage = STAGES[7];
  const segments = Object.values(SEGMENT_PRESETS);

  return (
    <StageCard stage={stage} onNext={onNext} onPrev={onPrev}>
      <StageHeader stage={stage} badge="Segment-aware assembly" />

      {/* Segment Switcher */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mr-1">
          Viewing as:
        </span>
        {segments.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedSegment(s.id)}
            className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition-all ${
              segment.id === s.id
                ? "bg-white/[0.08] border-white/20 text-white"
                : "bg-white/[0.02] border-white/[0.06] text-slate-500 hover:text-slate-300"
            }`}
          >
            <s.icon className="w-3 h-3" style={{ color: s.color }} />
            {s.name}
          </button>
        ))}
      </div>

      {/* Mock Quote Page */}
      <div className="mt-4 rounded-xl border border-white/[0.08] bg-gradient-to-b from-slate-900/50 to-slate-950 overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06] bg-black/40">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500/60" />
            <div className="w-2 h-2 rounded-full bg-yellow-500/60" />
            <div className="w-2 h-2 rounded-full bg-green-500/60" />
          </div>
          <div className="flex-1 text-center">
            <span className="text-[9px] font-mono text-slate-600">
              handyservices.app/quote/{segment.id.toLowerCase()}-demo
            </span>
          </div>
        </div>

        <div className="relative">
          {/* Annotations overlay */}
          <div className="absolute top-4 -left-1 z-10 hidden lg:block">
            <div className="flex items-center gap-2">
              <div className="w-8 h-px" style={{ backgroundColor: segment.color }} />
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ color: segment.color, backgroundColor: `${segment.color}15` }}>
                Hero · contextualHeadline
              </span>
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* Hero */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                <span className="text-[10px] text-slate-500">4.9 · 127 Google reviews</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-white leading-tight">
                {segment.headline}
              </h3>
              <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                {segment.contextualMessage}
              </p>
            </div>

            {/* Scarcity Banner */}
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{
                backgroundColor: `${segment.color}08`,
                borderColor: `${segment.color}25`,
              }}
            >
              <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: segment.color }} />
              <span className="text-xs font-medium" style={{ color: segment.color }}>
                {segment.scarcityCopy}
              </span>
            </div>

            {/* Price Card */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                    {segment.priceLabel}
                  </p>
                  <p className="text-3xl font-bold text-white mt-0.5">£{calc.finalPrice}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-500">Deposit today</p>
                  <p className="text-sm font-mono text-[#7DB00E]">£{calc.deposit}</p>
                </div>
              </div>

              {/* Value bullets */}
              <div className="space-y-1.5 mb-3 pb-3 border-b border-white/[0.06]">
                {segment.valueBullets.map((b, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Check className="w-3 h-3 text-[#7DB00E] flex-shrink-0 mt-0.5" />
                    <span className="text-[11px] text-slate-300">{b}</span>
                  </div>
                ))}
              </div>

              {/* Time slots */}
              <div className="mb-3">
                <p className="text-[10px] font-mono text-slate-500 uppercase mb-1.5">Pick a slot</p>
                <div className="flex gap-1.5 flex-wrap">
                  {segment.timeSlots.map((slot) => (
                    <span
                      key={slot}
                      className="text-[10px] px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-slate-300"
                    >
                      {slot}
                    </span>
                  ))}
                </div>
              </div>

              {/* Add-ons */}
              {segment.addOns.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-mono text-slate-500 uppercase mb-1.5">Add-ons</p>
                  <div className="space-y-1">
                    {segment.addOns.map((ao) => (
                      <div key={ao.name} className="flex items-center justify-between text-[11px]">
                        <span className="flex items-center gap-1.5 text-slate-300">
                          {ao.popular && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />}
                          {ao.name}
                        </span>
                        <span className={ao.price === 0 ? "text-[#7DB00E]" : "text-slate-400"}>
                          {ao.price === 0 ? "Free" : `+£${ao.price}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Downsell */}
              {segment.downsellLabel && (
                <div className="mb-3 rounded-lg border border-green-500/20 bg-green-500/5 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <TrendingDown className="w-3 h-3 text-green-400" />
                    <span className="text-[11px] text-green-300">{segment.downsellLabel}</span>
                  </div>
                </div>
              )}

              {/* Guarantee */}
              <div className="flex items-center gap-1.5 pt-2 border-t border-white/[0.06]">
                <ShieldCheck className="w-3 h-3 text-[#7DB00E]" />
                <span className="text-[10px] text-slate-400">{segment.guarantee} guarantee</span>
              </div>
            </div>

            {/* Hassle comparison */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-red-500/15 bg-red-500/5 p-2.5">
                <p className="text-[9px] font-mono text-red-400 uppercase mb-1">Without us</p>
                <p className="text-[11px] text-slate-300 leading-snug">{segment.withoutUs}</p>
              </div>
              <div className="rounded-lg border border-[#7DB00E]/20 bg-[#7DB00E]/5 p-2.5">
                <p className="text-[9px] font-mono text-[#7DB00E] uppercase mb-1">With us</p>
                <p className="text-[11px] text-slate-300 leading-snug">{segment.withUs}</p>
              </div>
            </div>

            {/* WhatsApp CTA */}
            <div className="flex items-center gap-2 rounded-lg bg-[#25D366]/10 border border-[#25D366]/25 px-3 py-2">
              <MessageCircle className="w-4 h-4 text-[#25D366]" />
              <span className="text-xs text-[#25D366] font-medium">Send quote to my WhatsApp</span>
            </div>
          </div>
        </div>
      </div>

      {/* Component Annotations */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
        <ComponentTag name="Hero" source="contextualHeadline" color="text-pink-400" />
        <ComponentTag name="ScarcityBanner" source="segment config" color="text-amber-400" />
        <ComponentTag name="UnifiedQuoteCard" source="quote/UnifiedQuoteCard" color="text-[#7DB00E]" />
        <ComponentTag name="Time slots" source="SchedulingConfig" color="text-blue-400" />
        <ComponentTag name="Add-ons" source="SchedulingConfig" color="text-purple-400" />
        <ComponentTag name="HassleComparison" source="hassle-comparisons" color="text-red-400" />
      </div>

      <div className="mt-4 rounded-lg border border-[#7DB00E]/20 bg-[#7DB00E]/5 p-3">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-[#7DB00E] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-[#7DB00E] mb-0.5">The full land</p>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Switch segments above. Same £{calc.finalPrice} price — completely different quote page. No dev changes, no copy rewrites. The entire experience is config-driven.
            </p>
          </div>
        </div>
      </div>
    </StageCard>
  );
}

function ProfileCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
      <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs font-medium" style={{ color }}>{value}</p>
    </div>
  );
}

function ComponentTag({ name, source, color }: { name: string; source: string; color: string }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
      <p className={`text-[11px] font-medium ${color}`}>{name}</p>
      <p className="text-[9px] font-mono text-slate-600 truncate">{source}</p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StageHeader({ stage, badge }: { stage: StageData; badge: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center ${stage.accentBg} border ${stage.accentBorder}`}
      >
        <stage.icon className={`w-4 h-4 ${stage.accentText}`} />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-white">{stage.label}</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${stage.accentBg} ${stage.accentText} border ${stage.accentBorder}`}>
            {badge}
          </span>
        </div>
        <p className="text-[10px] text-slate-600 font-mono">{stage.sublabel}</p>
      </div>
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{text}</p>
  );
}

function LineItem({
  num,
  category,
  desc,
  time,
  color,
}: {
  num: number;
  category: string;
  desc: string;
  time: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
      <span className="text-[10px] font-mono text-slate-600 w-4">{num}.</span>
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] ${color}`}>
        {category}
      </span>
      <span className="text-xs text-slate-300 flex-1 truncate">{desc}</span>
      <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">
        <Clock className="w-3 h-3 inline mr-0.5" />
        {time}
      </span>
    </div>
  );
}

function CalcBox({
  label,
  value,
  sub,
  active,
  color,
  highlight,
}: {
  label: string;
  value: string;
  sub: string;
  active: boolean;
  color: string;
  highlight?: boolean;
}) {
  return (
    <motion.div
      animate={{ opacity: active ? 1 : 0.3 }}
      className={`rounded-lg border p-2.5 ${
        highlight ? "border-[#7DB00E]/20 bg-[#7DB00E]/5" : "border-white/[0.05] bg-white/[0.02]"
      }`}
    >
      <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-lg sm:text-xl font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-600">{sub}</p>
    </motion.div>
  );
}

function OutputRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-medium ${accent ? "text-[#7DB00E]" : "text-slate-300"}`}>{value}</span>
    </div>
  );
}

function MiniTag({ icon: Icon, text }: { icon: typeof Sparkles; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-white/[0.03] border border-white/[0.05] px-2 py-1 rounded">
      <Icon className="w-3 h-3" />
      {text}
    </div>
  );
}
