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
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STAGES: StageData[] = [
  {
    id: 0, key: "input", label: "Job Input", sublabel: "AI Parser",
    icon: MessageSquareText, color: "#6366f1",
    accentBg: "bg-indigo-500/8", accentBorder: "border-indigo-500/20", accentText: "text-indigo-400",
  },
  {
    id: 1, key: "anchor", label: "Market Anchor", sublabel: "Layer 1",
    icon: Ruler, color: "#3b82f6",
    accentBg: "bg-blue-500/8", accentBorder: "border-blue-500/20", accentText: "text-blue-400",
  },
  {
    id: 2, key: "context", label: "Contextual Value", sublabel: "Layer 3",
    icon: Brain, color: "#a855f7",
    accentBg: "bg-purple-500/8", accentBorder: "border-purple-500/20", accentText: "text-purple-400",
  },
  {
    id: 3, key: "guard", label: "Guardrails", sublabel: "Layer 4",
    icon: Shield, color: "#ef4444",
    accentBg: "bg-red-500/8", accentBorder: "border-red-500/20", accentText: "text-red-400",
  },
  {
    id: 4, key: "output", label: "Quote Output", sublabel: "Final",
    icon: Receipt, color: "#7DB00E",
    accentBg: "bg-[#7DB00E]/8", accentBorder: "border-[#7DB00E]/20", accentText: "text-[#7DB00E]",
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [signals, setSignals] = useState<Record<string, string>>({
    urgency: "standard",
    materials: "customer_supplied",
    timing: "standard",
    returning: "no",
  });

  const calc = calculateExample(signals);

  const playSequence = useCallback(() => {
    setIsPlaying(true);
    setActiveStage(-1);
    setExpandedStage(null);

    STAGES.forEach((stage, i) => {
      setTimeout(() => {
        setActiveStage(stage.id);
        setExpandedStage(stage.id);
      }, (i + 1) * 1200);
    });

    setTimeout(() => {
      setIsPlaying(false);
    }, (STAGES.length + 1) * 1200);
  }, []);

  const reset = () => {
    setActiveStage(-1);
    setExpandedStage(null);
    setIsPlaying(false);
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
              onClick={playSequence}
              disabled={isPlaying}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5" />
              {isPlaying ? "Playing..." : "Play Sequence"}
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
        <div className="flex items-center justify-between mb-8 px-2">
          {STAGES.map((stage, i) => (
            <div key={stage.key} className="flex items-center flex-1 last:flex-none">
              <button
                onClick={() => {
                  setActiveStage(stage.id);
                  setExpandedStage(expandedStage === stage.id ? null : stage.id);
                }}
                className="group flex flex-col items-center gap-1.5 relative"
              >
                <motion.div
                  animate={{
                    scale: activeStage === stage.id ? 1.15 : 1,
                    boxShadow: activeStage >= stage.id
                      ? `0 0 20px ${stage.color}30, 0 0 40px ${stage.color}10`
                      : "none",
                  }}
                  className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center border transition-all duration-500 ${
                    activeStage >= stage.id
                      ? `${stage.accentBg} ${stage.accentBorder}`
                      : "bg-white/[0.03] border-white/[0.06]"
                  }`}
                >
                  <stage.icon
                    className={`w-4 h-4 sm:w-5 sm:h-5 transition-colors duration-500 ${
                      activeStage >= stage.id ? stage.accentText : "text-slate-600"
                    }`}
                  />
                </motion.div>
                <span className={`text-[9px] sm:text-[10px] font-mono uppercase tracking-wider transition-colors ${
                  activeStage >= stage.id ? "text-slate-300" : "text-slate-600"
                }`}>
                  {stage.sublabel}
                </span>
                <span className={`text-[10px] sm:text-xs font-medium transition-colors hidden sm:block ${
                  activeStage >= stage.id ? "text-slate-400" : "text-slate-700"
                }`}>
                  {stage.label}
                </span>
              </button>
              {i < STAGES.length - 1 && (
                <div className="flex-1 mx-1 sm:mx-2">
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
          {expandedStage === 0 && <InputStage key="input" />}
          {expandedStage === 1 && <AnchorStage key="anchor" rates={CATEGORY_RATES} calc={calc} />}
          {expandedStage === 2 && (
            <ContextStage key="context" signals={signals} setSignals={setSignals} calc={calc} />
          )}
          {expandedStage === 3 && <GuardrailStage key="guard" calc={calc} />}
          {expandedStage === 4 && <OutputStage key="output" calc={calc} signals={signals} />}
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
}: {
  children: React.ReactNode;
  stage: StageData;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35 }}
      className={`rounded-xl border ${stage.accentBorder} ${stage.accentBg} overflow-hidden`}
    >
      <div className="p-5 sm:p-6">{children}</div>
    </motion.div>
  );
}

function InputStage() {
  const stage = STAGES[0];
  return (
    <StageCard stage={stage}>
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
}: {
  rates: typeof CATEGORY_RATES;
  calc: ReturnType<typeof calculateExample>;
}) {
  const stage = STAGES[1];
  return (
    <StageCard stage={stage}>
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
}: {
  signals: Record<string, string>;
  setSignals: (s: Record<string, string>) => void;
  calc: ReturnType<typeof calculateExample>;
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
    <StageCard stage={stage}>
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

function GuardrailStage({ calc }: { calc: ReturnType<typeof calculateExample> }) {
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
    <StageCard stage={stage}>
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
}: {
  calc: ReturnType<typeof calculateExample>;
  signals: Record<string, string>;
}) {
  const stage = STAGES[4];

  return (
    <StageCard stage={stage}>
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
