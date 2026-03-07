import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import {
  Phone, MessageSquare, Monitor, FileText, LayoutDashboard,
  Headphones, Users, CheckCircle2, Navigation, Zap,
  ArrowRight, ArrowLeft, ChevronRight,
  Clock, Camera, MapPin, Wrench, AlertTriangle,
  PoundSterling, TrendingUp, Rocket, Star,
  Home, Building2, Briefcase, Shield, Wallet,
  Heart, Store, HardHat, Key,
  KeyboardIcon
} from "lucide-react";

// ─── Design tokens ───────────────────────────────────────────
const AMBER = "#e8b323";
const AMBER_DIM = "rgba(232,179,35,0.15)";
const AMBER_GLOW = "rgba(232,179,35,0.4)";

// ─── Slide data ──────────────────────────────────────────────

const TOOLS = [
  { icon: Phone, name: "Your Phone", desc: "Calls forward to you from Twilio", where: "Your mobile" },
  { icon: Monitor, name: "LiveCallHUD", desc: "AI coaching screen — tells you what to say during a call", where: "handyservices.app/admin/live-call" },
  { icon: MessageSquare, name: "WhatsApp Business", desc: "Incoming leads message here, you reply directly", where: "WhatsApp app on your phone" },
  { icon: FileText, name: "Quote Generator", desc: "Create a personalised quote link to send", where: "CRM dashboard" },
  { icon: LayoutDashboard, name: "CRM Dashboard", desc: "See all leads, quotes, calls, pipeline", where: "handyservices.app/admin" },
];

const STATIONS = [
  { num: 1, name: "LISTEN", color: "#22c55e", icon: Headphones, tagline: "\"Handy Services, how can I help?\"", bullets: ["Be warm and friendly", "Let them talk — don't rush", "AI detects jobs on your screen"] },
  { num: 2, name: "SEGMENT", color: "#3b82f6", icon: Users, tagline: "Figure out WHO they are", bullets: ["Pick up clues from conversation", "AI suggests a segment", "Confirm or override"] },
  { num: 3, name: "QUALIFY", color: "#f59e0b", icon: CheckCircle2, tagline: "Can we do this job?", bullets: ["Decision maker?", "Can we access?", "Traffic light: green / amber / red"] },
  { num: 4, name: "DESTINATION", color: "#ef4444", icon: Navigation, tagline: "What happens next?", bullets: ["Instant Quote → send link", "Video Request → ask for video", "Site Visit → book it", "Emergency → escalate fast"] },
];

const SEGMENTS = [
  { key: "BUSY_PRO", label: "Busy Pro", icon: Briefcase, care: "Speed, convenience", approach: "\"We'll handle everything\"" },
  { key: "LANDLORD", label: "Landlord", icon: Home, care: "Photo proof, tenant coord", approach: "Mention reports & invoices" },
  { key: "PROP_MGR", label: "Property Mgr", icon: Building2, care: "Reliability, volume", approach: "Professional, portfolio focus" },
  { key: "EMERGENCY", label: "Emergency", icon: AlertTriangle, care: "Fix it NOW", approach: "Reassure, move fast" },
  { key: "BUDGET", label: "Budget", icon: Wallet, care: "Price", approach: "Be upfront about value" },
  { key: "OAP", label: "OAP", icon: Heart, care: "Trust, safety", approach: "Be patient, build trust" },
  { key: "SMALL_BIZ", label: "Small Biz", icon: Store, care: "Min disruption", approach: "Flexible scheduling" },
  { key: "DIY_DEFERRER", label: "DIY Deferrer", icon: HardHat, care: "Been putting it off", approach: "No judgement, make it easy" },
  { key: "RENTER", label: "Renter", icon: Key, care: "Landlord approval", approach: "Ask if landlord aware" },
];

const PAYMENT_TIERS = [
  { range: "First 20", rate: "£10", color: "#22c55e" },
  { range: "21 – 50", rate: "£7", color: "#3b82f6" },
  { range: "51 – 80", rate: "£5", color: "#f59e0b" },
  { range: "81 +", rate: "£3", color: "#ef4444" },
];

const SCENARIOS = [
  { label: "Ramp-up", quotes: 80, accepted: 40, ben: "£580", tag: "Month 1–2" },
  { label: "Conservative", quotes: 130, accepted: 65, ben: "£875", tag: "Steady" },
  { label: "Realistic", quotes: 155, accepted: 93, ben: "£1,064", tag: "Target" },
  { label: "Optimistic", quotes: 180, accepted: 126, ben: "£1,238", tag: "Crushing it" },
];

// ─── Animation variants ─────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 600 : -600, opacity: 0, scale: 0.95 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -600 : 600, opacity: 0, scale: 0.95 }),
};

const stagger: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4 } },
};

// ─── Slide Components ────────────────────────────────────────

function SlideWelcome() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col items-center justify-center h-full text-center px-6">
      <motion.div variants={fadeUp} className="mb-6">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full border-2 border-dashed" style={{ borderColor: AMBER }}>
          <Wrench className="w-12 h-12" style={{ color: AMBER }} />
        </div>
      </motion.div>
      <motion.h1 variants={fadeUp} className="text-5xl md:text-6xl font-black tracking-tight text-white mb-4">
        Welcome aboard, <span style={{ color: AMBER }}>Ben</span>
      </motion.h1>
      <motion.p variants={fadeUp} className="text-xl text-zinc-400 max-w-xl leading-relaxed mb-8">
        You're joining Handy Services as our Lead Handler &amp; Quote Generator. This is your mission briefing.
      </motion.p>
      <motion.div variants={fadeUp} className="flex items-center gap-2 text-sm text-zinc-500">
        <KeyboardIcon className="w-4 h-4" />
        <span>Use arrow keys or swipe to navigate</span>
      </motion.div>
    </motion.div>
  );
}

function SlideMission() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col items-center justify-center h-full text-center px-6">
      <motion.div variants={fadeUp} className="text-sm font-semibold uppercase tracking-[0.3em] mb-6" style={{ color: AMBER }}>
        Your Mission
      </motion.div>
      <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-bold text-white max-w-2xl leading-snug mb-8">
        When someone contacts Handy Services — by phone or WhatsApp — <span className="text-zinc-400">you're the first person they talk to.</span>
      </motion.h2>
      <motion.div variants={fadeUp} className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full">
        {[
          { icon: Phone, text: "Answer calls" },
          { icon: MessageSquare, text: "Reply on WhatsApp" },
          { icon: FileText, text: "Send quotes" },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-3 rounded-xl px-5 py-4" style={{ background: AMBER_DIM }}>
            <Icon className="w-5 h-5 flex-shrink-0" style={{ color: AMBER }} />
            <span className="text-white font-medium text-sm">{text}</span>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}

function SlideTools() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col h-full px-6 py-4 overflow-y-auto">
      <motion.div variants={fadeUp} className="text-center mb-6">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: AMBER }}>Your Toolkit</div>
        <h2 className="text-3xl font-bold text-white">5 tools. That's all you need.</h2>
      </motion.div>
      <motion.div variants={stagger} className="grid gap-3 max-w-2xl mx-auto w-full">
        {TOOLS.map(({ icon: Icon, name, desc, where }, i) => (
          <motion.div key={name} variants={fadeUp} className="group flex items-start gap-4 rounded-xl px-5 py-4 border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0" style={{ background: AMBER_DIM }}>
              <Icon className="w-5 h-5" style={{ color: AMBER }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-white font-semibold text-sm">{name}</span>
                <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{i + 1}</span>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">{desc}</p>
              <p className="text-zinc-600 text-xs font-mono mt-1">{where}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}

function SlideCallFlow() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col h-full px-6 py-4 overflow-y-auto">
      <motion.div variants={fadeUp} className="text-center mb-5">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: AMBER }}>The Call Flow</div>
        <h2 className="text-3xl font-bold text-white">4 stations. Like stops on a train.</h2>
      </motion.div>
      <motion.div variants={stagger} className="max-w-2xl mx-auto w-full space-y-2">
        {STATIONS.map(({ num, name, color, icon: Icon, tagline, bullets }, i) => (
          <motion.div key={name} variants={fadeUp} className="relative">
            {/* Connector line */}
            {i < STATIONS.length - 1 && (
              <div className="absolute left-[23px] top-[56px] w-0.5 h-[calc(100%-20px)]" style={{ background: `linear-gradient(to bottom, ${color}, ${STATIONS[i + 1].color})` }} />
            )}
            <div className="flex items-start gap-4">
              {/* Station dot */}
              <div className="relative flex-shrink-0 mt-1">
                <div className="w-[46px] h-[46px] rounded-full border-2 flex items-center justify-center bg-zinc-950" style={{ borderColor: color }}>
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <span className="absolute -top-1 -right-1 text-[10px] font-black text-zinc-950 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: color }}>{num}</span>
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-black text-sm tracking-wide" style={{ color }}>{name}</span>
                </div>
                <p className="text-zinc-300 text-sm italic mb-1.5">"{tagline}"</p>
                <div className="flex flex-wrap gap-1.5">
                  {bullets.map(b => (
                    <span key={b} className="text-xs text-zinc-400 bg-zinc-800/80 px-2 py-1 rounded-md">{b}</span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}

function SlideSegments() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col h-full px-6 py-4 overflow-y-auto">
      <motion.div variants={fadeUp} className="text-center mb-4">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: AMBER }}>Customer Segments</div>
        <h2 className="text-2xl font-bold text-white mb-1">Different people. Different approach.</h2>
        <p className="text-zinc-500 text-sm">Not sure? Just pick DEFAULT — the system handles it.</p>
      </motion.div>
      <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-w-4xl mx-auto w-full">
        {SEGMENTS.map(({ key, label, icon: Icon, care, approach }) => (
          <motion.div key={key} variants={fadeUp} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-zinc-700 transition-colors">
            <div className="flex items-center gap-2 mb-1.5">
              <Icon className="w-4 h-4" style={{ color: AMBER }} />
              <span className="text-white font-semibold text-sm">{label}</span>
              <span className="text-[10px] font-mono text-zinc-600 ml-auto">{key}</span>
            </div>
            <p className="text-zinc-400 text-xs leading-relaxed"><span className="text-zinc-500">Cares about:</span> {care}</p>
            <p className="text-zinc-500 text-xs mt-0.5 italic">{approach}</p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}

function SlideWhatsApp() {
  const messages = [
    { from: "customer", text: "Hi, I need someone to fix a leaking tap in my kitchen" },
    { from: "ben", text: "Hi! No problem, we can sort that out for you. Is this at your home or a rental property?" },
    { from: "customer", text: "It's my home, in Nottingham" },
    { from: "ben", text: "Great — could I grab your postcode for an accurate quote?" },
    { from: "customer", text: "NG1 5AW" },
    { from: "ben", text: "Perfect! Let me put a quote together now — I'll send it over in a couple of minutes 👍" },
  ];
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col h-full px-6 py-4 overflow-y-auto">
      <motion.div variants={fadeUp} className="text-center mb-4">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: AMBER }}>WhatsApp Game</div>
        <h2 className="text-3xl font-bold text-white mb-2">Be fast. Be human. Get the info.</h2>
      </motion.div>
      <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto w-full">
        {/* Chat mockup */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-zinc-800 bg-zinc-900/80 overflow-hidden">
          <div className="bg-[#075e54] px-4 py-2.5 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-zinc-600 flex items-center justify-center text-[10px] text-white font-bold">S</div>
            <span className="text-white text-sm font-medium">Sarah</span>
            <span className="text-emerald-200 text-xs ml-auto">online</span>
          </div>
          <div className="p-3 space-y-1.5 bg-[#0b141a] min-h-0" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.02\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}>
            {messages.map(({ from, text }, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.15, duration: 0.3 }}
                className={`flex ${from === "ben" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-3 py-1.5 rounded-lg text-xs leading-relaxed ${
                    from === "ben"
                      ? "bg-[#005c4b] text-emerald-50 rounded-tr-none"
                      : "bg-zinc-800 text-zinc-200 rounded-tl-none"
                  }`}
                >
                  {text}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
        {/* Checklist */}
        <motion.div variants={fadeUp} className="space-y-3">
          <h3 className="text-white font-semibold text-sm mb-3">Collect before quoting:</h3>
          {[
            { icon: Wrench, label: "What", detail: "What's the job?" },
            { icon: MapPin, label: "Where", detail: "Postcode or address" },
            { icon: Users, label: "Who", detail: "Their name" },
            { icon: Clock, label: "When", detail: "How urgent?" },
            { icon: Home, label: "Type", detail: "Homeowner, landlord, tenant, biz?" },
          ].map(({ icon: Icon, label, detail }) => (
            <div key={label} className="flex items-center gap-3 rounded-lg px-4 py-2.5 border border-zinc-800 bg-zinc-900/40">
              <Icon className="w-4 h-4 flex-shrink-0" style={{ color: AMBER }} />
              <span className="text-white font-semibold text-sm w-14">{label}</span>
              <span className="text-zinc-400 text-sm">{detail}</span>
            </div>
          ))}
          <div className="mt-3 rounded-lg px-4 py-3 border border-dashed border-zinc-700 bg-zinc-900/30">
            <p className="text-zinc-500 text-xs leading-relaxed">
              <span className="text-zinc-300 font-medium">Pro tip:</span> Don't ask these as a checklist. Have a natural conversation — just make sure you've covered them before quoting.
            </p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function SlideQuoting() {
  const steps = [
    { num: 1, text: "Open CRM dashboard" },
    { num: 2, text: "Go to Quote Generator" },
    { num: 3, text: "Fill in: name, phone, job, postcode, segment" },
    { num: 4, text: "Click Generate Quote" },
    { num: 5, text: "Copy the quote link" },
    { num: 6, text: "Paste into WhatsApp → Send" },
  ];
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col items-center justify-center h-full px-6">
      <motion.div variants={fadeUp} className="text-center mb-6">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: AMBER }}>Quote Machine</div>
        <h2 className="text-3xl font-bold text-white">6 steps to send a quote</h2>
      </motion.div>
      <motion.div variants={stagger} className="relative max-w-md w-full">
        {/* Vertical line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-px" style={{ background: `linear-gradient(to bottom, ${AMBER}, transparent)` }} />
        {steps.map(({ num, text }) => (
          <motion.div key={num} variants={fadeUp} className="flex items-center gap-4 mb-4 last:mb-0">
            <div className="relative z-10 w-[30px] h-[30px] rounded-full flex items-center justify-center text-xs font-black text-zinc-950 flex-shrink-0" style={{ background: AMBER }}>
              {num}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 flex-1">
              <span className="text-white text-sm">{text}</span>
            </div>
          </motion.div>
        ))}
      </motion.div>
      <motion.div variants={fadeUp} className="mt-6 max-w-md w-full rounded-xl px-5 py-4 border border-zinc-800 bg-zinc-900/40">
        <p className="text-sm text-zinc-400 leading-relaxed">
          <span className="text-white font-semibold">The system tracks everything:</span> when they view, select a package, or pay. You can see it all in the Pipeline.
        </p>
      </motion.div>
    </motion.div>
  );
}

function SlidePayment() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col h-full px-6 py-4 overflow-y-auto">
      <motion.div variants={fadeUp} className="text-center mb-5">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: AMBER }}>How You Get Paid</div>
        <h2 className="text-3xl font-bold text-white">Two ways to earn. Every week.</h2>
      </motion.div>
      <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto w-full">
        {/* Per quote sent */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: AMBER_DIM }}>
              <FileText className="w-4 h-4" style={{ color: AMBER }} />
            </div>
            <span className="text-white font-semibold">Per Quote Sent</span>
          </div>
          <div className="text-4xl font-black text-white mb-2">£3</div>
          <p className="text-zinc-400 text-sm leading-relaxed">
            For every qualified quote you send. You control this — the more you qualify and quote, the more you earn.
          </p>
        </motion.div>
        {/* Per accepted quote */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: AMBER_DIM }}>
              <PoundSterling className="w-4 h-4" style={{ color: AMBER }} />
            </div>
            <span className="text-white font-semibold">Per Accepted Quote</span>
          </div>
          <div className="space-y-1.5">
            {PAYMENT_TIERS.map(({ range, rate, color }) => (
              <div key={range} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-zinc-400 text-sm w-20">{range}</span>
                <span className="text-white font-bold text-lg">{rate}</span>
                <span className="text-zinc-600 text-xs">each</span>
              </div>
            ))}
          </div>
          <p className="text-zinc-500 text-xs mt-3 leading-relaxed">
            Degressive brackets — high rate early, rewarding your first wins each month.
          </p>
        </motion.div>
      </div>
      <motion.div variants={fadeUp} className="mt-4 text-center">
        <span className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-zinc-800 bg-zinc-900/40">
          <Clock className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-zinc-400">Paid <span className="text-white font-semibold">weekly</span> — every Monday</span>
        </span>
      </motion.div>
    </motion.div>
  );
}

function SlideEarnings() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col items-center justify-center h-full px-6">
      <motion.div variants={fadeUp} className="text-center mb-6">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: AMBER }}>Earnings Projection</div>
        <h2 className="text-3xl font-bold text-white">What you can expect</h2>
      </motion.div>
      <motion.div variants={stagger} className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl w-full">
        {SCENARIOS.map(({ label, quotes, accepted, ben, tag }) => (
          <motion.div key={label} variants={fadeUp} className={`rounded-xl border p-4 text-center ${
            label === "Realistic" ? "border-amber-500/50 bg-amber-500/5" : "border-zinc-800 bg-zinc-900/60"
          }`}>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">{label}</div>
            <div className="text-2xl font-black text-white mb-2">{ben}</div>
            <div className="text-xs text-zinc-400 space-y-0.5">
              <div>{quotes} quotes sent</div>
              <div>{accepted} accepted</div>
            </div>
            <div className="mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block" style={{
              color: label === "Realistic" ? AMBER : "#a1a1aa",
              background: label === "Realistic" ? AMBER_DIM : "rgba(161,161,170,0.1)",
            }}>{tag}</div>
          </motion.div>
        ))}
      </motion.div>
      <motion.div variants={fadeUp} className="mt-6 max-w-lg w-full rounded-xl px-5 py-4 border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-start gap-3">
          <TrendingUp className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: AMBER }} />
          <p className="text-sm text-zinc-400 leading-relaxed">
            <span className="text-white font-semibold">The better you follow up, the more that book, the more you earn.</span> With ~200 calls and ~60 WhatsApps a month, there's serious volume to work with.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SlideReference() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col h-full px-6 py-4 overflow-y-auto">
      <motion.div variants={fadeUp} className="text-center mb-4">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: AMBER }}>Quick Reference</div>
        <h2 className="text-3xl font-bold text-white">Your cheat sheet</h2>
      </motion.div>
      <div className="grid md:grid-cols-2 gap-4 max-w-3xl mx-auto w-full">
        {/* On a Call */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Phone className="w-4 h-4" style={{ color: AMBER }} />
            <span className="text-white font-semibold text-sm">On a Call</span>
          </div>
          <ol className="space-y-1.5 text-sm text-zinc-400">
            {[
              "Answer: \"Handy Services, how can I help?\"",
              "Open LiveCallHUD on your phone",
              "Listen → Segment → Qualify → Destination",
              "Follow AI coaching prompts",
              "After call: generate quote if needed",
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-zinc-600 font-mono text-xs mt-0.5">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </motion.div>
        {/* On WhatsApp */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4" style={{ color: AMBER }} />
            <span className="text-white font-semibold text-sm">On WhatsApp</span>
          </div>
          <ol className="space-y-1.5 text-sm text-zinc-400">
            {[
              "Reply fast — they're messaging others too",
              "Collect: what, where, who, when, type",
              "Generate quote in CRM",
              "Copy link → send in chat",
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-zinc-600 font-mono text-xs mt-0.5">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </motion.div>
        {/* Traffic Lights */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4" style={{ color: AMBER }} />
            <span className="text-white font-semibold text-sm">Traffic Lights</span>
          </div>
          <div className="space-y-2">
            {[
              { color: "#22c55e", label: "GREEN", desc: "We can do this → instant quote" },
              { color: "#f59e0b", label: "AMBER", desc: "Need video or site visit first" },
              { color: "#ef4444", label: "RED", desc: "Specialist work → refer out" },
            ].map(({ color, label, desc }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-xs font-bold w-14" style={{ color }}>{label}</span>
                <span className="text-zinc-400 text-sm">{desc}</span>
              </div>
            ))}
          </div>
        </motion.div>
        {/* Key URLs */}
        <motion.div variants={fadeUp} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <LayoutDashboard className="w-4 h-4" style={{ color: AMBER }} />
            <span className="text-white font-semibold text-sm">Key URLs</span>
          </div>
          <div className="space-y-2 text-sm">
            {[
              { label: "LiveCallHUD", url: "/admin/live-call" },
              { label: "CRM Dashboard", url: "/admin" },
              { label: "Quote Generator", url: "/admin/quotes" },
              { label: "Pipeline", url: "/admin/pipeline" },
            ].map(({ label, url }) => (
              <div key={url} className="flex items-center justify-between">
                <span className="text-zinc-400">{label}</span>
                <code className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">{url}</code>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function SlideLetsGo() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col items-center justify-center h-full text-center px-6">
      <motion.div variants={fadeUp} className="mb-6">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full" style={{ background: AMBER_DIM }}>
          <Rocket className="w-10 h-10" style={{ color: AMBER }} />
        </div>
      </motion.div>
      <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-black text-white mb-3">
        You're ready.
      </motion.h2>
      <motion.p variants={fadeUp} className="text-lg text-zinc-400 max-w-md mb-8">
        Log in, take your first call, send your first quote. Let's build this.
      </motion.p>
      <motion.div variants={fadeUp} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 max-w-sm w-full mb-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 mb-3">Your Login</div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Email</span>
            <code className="font-mono text-white bg-zinc-800 px-2 py-1 rounded text-xs">ben@handyservices.com</code>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">URL</span>
            <code className="font-mono text-white bg-zinc-800 px-2 py-1 rounded text-xs">/admin/login</code>
          </div>
        </div>
      </motion.div>
      <motion.div variants={fadeUp} className="flex items-center gap-2">
        <Star className="w-4 h-4" style={{ color: AMBER }} />
        <span className="text-zinc-500 text-sm">Welcome to the team, Ben.</span>
        <Star className="w-4 h-4" style={{ color: AMBER }} />
      </motion.div>
    </motion.div>
  );
}

// ─── Slide registry ──────────────────────────────────────────

const SLIDES: { id: string; label: string; component: () => JSX.Element }[] = [
  { id: "welcome", label: "Welcome", component: SlideWelcome },
  { id: "mission", label: "Mission", component: SlideMission },
  { id: "tools", label: "Toolkit", component: SlideTools },
  { id: "calls", label: "Call Flow", component: SlideCallFlow },
  { id: "segments", label: "Segments", component: SlideSegments },
  { id: "whatsapp", label: "WhatsApp", component: SlideWhatsApp },
  { id: "quoting", label: "Quoting", component: SlideQuoting },
  { id: "payment", label: "Payment", component: SlidePayment },
  { id: "earnings", label: "Earnings", component: SlideEarnings },
  { id: "reference", label: "Reference", component: SlideReference },
  { id: "go", label: "Let's Go", component: SlideLetsGo },
];

// ─── Main Component ──────────────────────────────────────────

export default function OnboardingSlideDeck() {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(0);

  const go = useCallback((dir: number) => {
    setDirection(dir);
    setCurrent(prev => Math.max(0, Math.min(SLIDES.length - 1, prev + dir)));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [go]);

  // Touch / swipe
  useEffect(() => {
    let startX = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    };
    window.addEventListener("touchstart", onStart);
    window.addEventListener("touchend", onEnd);
    return () => { window.removeEventListener("touchstart", onStart); window.removeEventListener("touchend", onEnd); };
  }, [go]);

  const SlideComponent = SLIDES[current].component;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden" style={{
      background: "radial-gradient(ellipse at 30% 20%, rgba(232,179,35,0.04) 0%, transparent 60%), #09090b",
    }}>
      {/* ─── Top bar: progress + slide dots ─── */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2">
        {/* Progress bar */}
        <div className="h-0.5 w-full rounded-full bg-zinc-800 mb-3 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: AMBER }}
            animate={{ width: `${((current + 1) / SLIDES.length) * 100}%` }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />
        </div>
        {/* Dot nav */}
        <div className="flex items-center justify-center gap-1 flex-wrap">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => { setDirection(i > current ? 1 : -1); setCurrent(i); }}
              className="group flex items-center gap-1 px-1 py-0.5 rounded-md transition-colors hover:bg-zinc-800/60"
            >
              <div
                className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                style={{
                  background: i === current ? AMBER : i < current ? AMBER_GLOW : "#3f3f46",
                  boxShadow: i === current ? `0 0 8px ${AMBER_GLOW}` : "none",
                  transform: i === current ? "scale(1.4)" : "scale(1)",
                }}
              />
              <span className={`text-[10px] font-medium transition-colors hidden sm:inline ${
                i === current ? "text-zinc-200" : "text-zinc-600 group-hover:text-zinc-400"
              }`}>
                {s.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Slide area ─── */}
      <div className="flex-1 relative min-h-0">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={SLIDES[current].id}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 flex flex-col"
          >
            <SlideComponent />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ─── Bottom nav ─── */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-t border-zinc-800/60">
        <button
          onClick={() => go(-1)}
          disabled={current === 0}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>
        <div className="text-xs text-zinc-600 font-mono">
          {current + 1} / {SLIDES.length}
        </div>
        <button
          onClick={() => go(1)}
          disabled={current === SLIDES.length - 1}
          className="flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          style={{ color: current < SLIDES.length - 1 ? AMBER : "#71717a" }}
        >
          <span className="hidden sm:inline">Next</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
