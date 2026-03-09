import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import {
  Phone, Package, Monitor, Zap, Rocket,
  CheckCircle2, Lock, ChevronDown, RotateCcw,
  ClipboardCheck, ArrowRight, Video, MapPin,
  FileText, Circle, AlertTriangle, MessageSquare
} from "lucide-react";

// ─── Design tokens ───────────────────────────────────────────
const AMBER = "#e8b323";
const AMBER_DIM = "rgba(232,179,35,0.12)";
const GREEN = "#22c55e";
const GREEN_DIM = "rgba(34,197,94,0.12)";
const BLUE = "#3b82f6";
const BLUE_DIM = "rgba(59,130,246,0.12)";
const RED = "#ef4444";
const RED_DIM = "rgba(239,68,68,0.12)";
const ORANGE = "#f59e0b";
const ORANGE_DIM = "rgba(245,158,11,0.12)";

// ─── Animation ───────────────────────────────────────────────
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};
const stagger: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

// ─── Types ───────────────────────────────────────────────────
interface TrainingProgress {
  tasks: Record<string, boolean>;
  quizCorrect: Record<string, boolean>;
  modulesCompleted: boolean[];
}

interface QuizItem {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface TaskItem {
  id: string;
  label: string;
}

interface ModuleData {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  iconColor: string;
  tasks: TaskItem[];
  quizzes: QuizItem[];
  content: React.ReactNode;
}

// ─── Storage ─────────────────────────────────────────────────
const STORAGE_KEY = "va-training-progress";

function loadProgress(): TrainingProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { tasks: {}, quizCorrect: {}, modulesCompleted: [false, false, false, false, false] };
}

function saveProgress(p: TrainingProgress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

// ─── SKU Data ────────────────────────────────────────────────
const SKUS = [
  { name: "Tap Repair", code: "PLUMB-TAP-REPAIR", price: "£95", cat: "Plumbing", color: BLUE, keywords: "tap, faucet, dripping, leaking" },
  { name: "Toilet Repair", code: "PLUMB-TOILET-REPAIR", price: "£95", cat: "Plumbing", color: BLUE, keywords: "toilet, flush, cistern" },
  { name: "Blockage Clearance", code: "PLUMB-BLOCKAGE-CLEAR", price: "£120", cat: "Plumbing", color: BLUE, keywords: "blocked, clogged, won't drain" },
  { name: "Shower Repair", code: "PLUMB-SHOWER-REPAIR", price: "£110", cat: "Plumbing", color: BLUE, keywords: "shower, mixer, temperature" },
  { name: "Light Fitting", code: "ELEC-LIGHT-FITTING", price: "£85", cat: "Electrical", color: ORANGE, keywords: "light, fitting, chandelier, pendant" },
  { name: "Socket / Switch", code: "ELEC-SOCKET-REPLACE", price: "£75", cat: "Electrical", color: ORANGE, keywords: "socket, plug, switch, dimmer" },
  { name: "TV Mounting", code: "HANDY-TV-MOUNT", price: "£85", cat: "Handyman", color: AMBER, keywords: "tv, mount, bracket, wall hang" },
  { name: "Resealing", code: "HANDY-SILICONE-SEAL", price: "£90", cat: "Handyman", color: AMBER, keywords: "silicone, sealant, mouldy, seal bath" },
  { name: "Flatpack Assembly", code: "FLATPACK-GENERIC", price: "£60/hr", cat: "Handyman", color: AMBER, keywords: "ikea, wardrobe, assembly" },
];

// ─── Call Flow Steps ─────────────────────────────────────────
const CALL_STEPS = [
  { num: 1, label: "Greeting", script: '"Handy Services, how can I help?"', note: "Warm, branded opening" },
  { num: 2, label: "Listen", script: "Let the customer explain their problem", note: "AI detects jobs on your screen" },
  { num: 3, label: "Quoting Options", script: "Explain: WhatsApp video / instant price / book a visit", note: "Guide them to the best route" },
  { num: 4, label: "Ask Name", script: '"Can I just take your name?"', note: "AI auto-extracts from speech too" },
  { num: 5, label: "Ask Address", script: '"Thanks {{name}}, can I just take the property address?"', note: "Needed for instant quotes" },
  { num: 6, label: "Next Steps", script: "Repeat what happens next", note: "Confirm the plan before hanging up" },
];

// ─── Scenario Data ───────────────────────────────────────────
const SCENARIOS: { title: string; transcript: string[]; quiz: QuizItem }[] = [
  {
    title: "The Leaky Tap",
    transcript: [
      "Customer: Hi, my kitchen tap has been dripping for weeks, it's driving me mad.",
      "You: Handy Services, how can I help? ... (listen)",
      "Customer: I'm Sarah, at 14 Elm Street, NG5 2AB.",
      "🟢 System shows: PLUMB-TAP-REPAIR (GREEN, £95)",
    ],
    quiz: {
      id: "m5-q0",
      question: "Sarah's tap is dripping. SKU matched (green), you have name + phone + address. What do you do?",
      options: ["Ask for a video of the tap", "Book a diagnostic visit", "Hit SEND QUOTE — all info collected", "Tell her the price verbally"],
      correctIndex: 2,
      explanation: "Everything is green: SKU matched, name and address provided. Hit SEND QUOTE. Never quote prices verbally — always send the link.",
    },
  },
  {
    title: "The Mystery Smell",
    transcript: [
      "Customer: There's a weird damp smell coming from under my bathroom floor.",
      "Customer: Not sure what it is.",
      "🟡 System shows: No SKU match (AMBER). You have his name and phone.",
    ],
    quiz: {
      id: "m5-q1",
      question: "Dave describes a damp smell under the bathroom floor. No SKU match (amber). What do you do?",
      options: ["SEND QUOTE for blockage clearance", "BOOK VISIT immediately", "GET VIDEO — ask Dave to film the bathroom", "Quote £120 verbally"],
      correctIndex: 2,
      explanation: "No SKU match = amber. Don't guess the job type. Ask for a video first so you (and the team) can see what's going on before quoting.",
    },
  },
  {
    title: "The TV Mount",
    transcript: [
      "Customer: Need a 55-inch TV mounted on my living room wall. I've got the bracket.",
      "Customer: I'm Mike, in West Bridgford, NG2 6GR.",
      "🟢 System shows: HANDY-TV-MOUNT (GREEN, £85)",
    ],
    quiz: {
      id: "m5-q2",
      question: "Mike wants a TV mounted. SKU matched (green), has bracket, gave address. What do you do?",
      options: ["GET VIDEO to see the wall", "BOOK VISIT — TV mounting is complex", "SEND QUOTE — SKU matched, all info available", "Ask what brand the TV is"],
      correctIndex: 2,
      explanation: "HANDY-TV-MOUNT is a standard SKU at £85. He has the bracket, provided his address. Green across the board. Hit SEND QUOTE.",
    },
  },
  {
    title: "The Landlord Multi-Job",
    transcript: [
      "Customer: I'm a landlord. My tenant says the bathroom silicone is mouldy AND there's a socket that doesn't work.",
      "Customer: I'm Emma. I'm not local so I can't check myself.",
      "🟢 System: HANDY-SILICONE-SEAL (GREEN, £90) + ELEC-SOCKET-REPLACE (GREEN, £75)",
    ],
    quiz: {
      id: "m5-q3",
      question: "Emma is a landlord with two jobs — both SKUs matched green. What do you do?",
      options: ["GET VIDEO because it's two jobs", "SEND QUOTE — both SKUs matched", "BOOK VISIT because she's not local", "Tell her to ask the tenant to call"],
      correctIndex: 1,
      explanation: "Both jobs have matching SKUs (both green). She's a LANDLORD segment — mention tenant coordination. Collect property address, then SEND QUOTE.",
    },
  },
  {
    title: "The Gas Boiler",
    transcript: [
      "Customer: My boiler isn't firing up and there's no hot water. Can you fix it?",
      "🔴 System shows: RED — no SKU, specialist work flagged.",
    ],
    quiz: {
      id: "m5-q4",
      question: "Tom's boiler won't fire up. System shows RED — specialist work. What do you do?",
      options: ["SEND QUOTE for a general repair", "GET VIDEO to see the boiler", "Explain we don't do gas work — suggest a Gas Safe engineer", "BOOK VISIT for our handyman to look"],
      correctIndex: 2,
      explanation: "Gas work is RED — specialist only. We cannot quote or work on gas appliances. Say: 'That needs a Gas Safe registered engineer. I'd recommend checking the Gas Safe register.' Never send a quote for gas.",
    },
  },
];

// ─── Module Definitions ──────────────────────────────────────

function CallFlowContent() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400 mb-4">This is the exact framework you follow on every call. Learn it, own it.</p>
      {CALL_STEPS.map((step, i) => (
        <motion.div key={step.num} variants={fadeUp} className="relative">
          {i < CALL_STEPS.length - 1 && (
            <div className="absolute left-[19px] top-[44px] w-0.5 h-[calc(100%-16px)] bg-zinc-800" />
          )}
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-[38px] h-[38px] rounded-full border-2 flex items-center justify-center text-sm font-bold bg-zinc-950"
              style={{ borderColor: AMBER, color: AMBER }}>
              {step.num}
            </div>
            <div className="flex-1 min-w-0 pb-2">
              <div className="text-white font-semibold text-sm">{step.label}</div>
              <div className="text-zinc-300 text-sm mt-0.5 font-mono" style={{ color: AMBER }}>{step.script}</div>
              <div className="text-zinc-500 text-xs mt-1">{step.note}</div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function SKUContent() {
  const categories = ["Plumbing", "Electrical", "Handyman"];
  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-400">These are the 9 services we can price instantly. Learn how customers describe them.</p>
      {categories.map(cat => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{
                color: cat === "Plumbing" ? BLUE : cat === "Electrical" ? ORANGE : AMBER,
                background: cat === "Plumbing" ? BLUE_DIM : cat === "Electrical" ? ORANGE_DIM : AMBER_DIM,
              }}>
              {cat}
            </span>
          </div>
          <div className="grid gap-2">
            {SKUS.filter(s => s.cat === cat).map(sku => (
              <div key={sku.code} className="flex items-start gap-3 rounded-xl px-4 py-3 border border-zinc-800 bg-zinc-900/60">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-sm">{sku.name}</span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: GREEN, background: GREEN_DIM }}>{sku.price}</span>
                  </div>
                  <div className="text-zinc-500 text-xs font-mono mt-1">{sku.code}</div>
                  <div className="mt-1.5">
                    <span className="text-zinc-400 text-xs">Customers say: </span>
                    <span className="text-zinc-300 text-xs italic">{sku.keywords}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveScreenContent() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-400">When you're on a call, the Live Switchboard screen shows everything in real time.</p>

      {/* Traffic Light System */}
      <div>
        <div className="text-white font-semibold text-sm mb-3">Traffic Light System</div>
        <div className="space-y-2">
          {[
            { color: GREEN, bg: GREEN_DIM, label: "GREEN", desc: "SKU matched — price known, ready to quote instantly" },
            { color: ORANGE, bg: ORANGE_DIM, label: "AMBER", desc: "Job mentioned but no exact SKU — needs video to confirm" },
            { color: RED, bg: RED_DIM, label: "RED", desc: "Complex / specialist work — needs referral or site visit" },
          ].map(light => (
            <div key={light.label} className="flex items-center gap-3 rounded-xl px-4 py-3 border border-zinc-800" style={{ background: light.bg }}>
              <Circle className="w-4 h-4 flex-shrink-0 fill-current" style={{ color: light.color }} />
              <div>
                <span className="font-bold text-sm" style={{ color: light.color }}>{light.label}</span>
                <span className="text-zinc-300 text-sm ml-2">{light.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-populate */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="text-white font-semibold text-sm mb-2">How Auto-Populate Works</div>
        <p className="text-zinc-400 text-sm leading-relaxed">
          As the customer talks, the AI listens and fills in your screen automatically:
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
          <li className="flex items-start gap-2"><span style={{ color: AMBER }}>•</span> Detected jobs appear with traffic light ratings</li>
          <li className="flex items-start gap-2"><span style={{ color: AMBER }}>•</span> Customer segment is suggested (Landlord, Busy Pro, etc.)</li>
          <li className="flex items-start gap-2"><span style={{ color: AMBER }}>•</span> Name & address are extracted from speech when mentioned</li>
          <li className="flex items-start gap-2"><span style={{ color: AMBER }}>•</span> You can always edit any field if the AI gets it wrong</li>
        </ul>
      </div>
    </div>
  );
}

function ActionButtonsContent() {
  const buttons = [
    {
      name: "SEND QUOTE",
      icon: FileText,
      color: GREEN,
      bg: GREEN_DIM,
      when: "All jobs are GREEN (SKU matched)",
      needs: "Matched SKUs + Name + Phone + Address",
      does: "Creates a personalised quote link. You send it via WhatsApp.",
      tip: "This is the ideal outcome. Instant quotes convert best.",
    },
    {
      name: "GET VIDEO",
      icon: Video,
      color: ORANGE,
      bg: ORANGE_DIM,
      when: "One or more jobs are AMBER (no SKU match)",
      needs: "Name + Phone only",
      does: "Sends a WhatsApp message asking customer for a 30-second video of the job.",
      tip: "Use this when you need to see the problem before quoting.",
    },
    {
      name: "BOOK VISIT",
      icon: MapPin,
      color: BLUE,
      bg: BLUE_DIM,
      when: "Complex job (RED) or multiple unmatched jobs",
      needs: "Name + Phone only",
      does: "Books a diagnostic visit. A contractor visits to assess and quote on-site.",
      tip: "Last resort for jobs too complex to quote remotely.",
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400 mb-1">Three buttons. Know when to use each one.</p>
      {buttons.map(btn => (
        <div key={btn.name} className="rounded-xl border border-zinc-800 p-4" style={{ background: btn.bg }}>
          <div className="flex items-center gap-2 mb-2">
            <btn.icon className="w-5 h-5" style={{ color: btn.color }} />
            <span className="font-bold text-sm" style={{ color: btn.color }}>{btn.name}</span>
          </div>
          <div className="space-y-1.5 text-sm">
            <div><span className="text-zinc-500">When: </span><span className="text-zinc-300">{btn.when}</span></div>
            <div><span className="text-zinc-500">Needs: </span><span className="text-white font-medium">{btn.needs}</span></div>
            <div><span className="text-zinc-500">What happens: </span><span className="text-zinc-300">{btn.does}</span></div>
            <div className="mt-2 flex items-start gap-1.5">
              <span className="text-xs" style={{ color: btn.color }}>💡</span>
              <span className="text-xs" style={{ color: btn.color }}>{btn.tip}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScenariosContent() {
  return (
    <div className="space-y-1">
      <p className="text-sm text-zinc-400">5 realistic calls. Pick the right action for each one to graduate.</p>
    </div>
  );
}

// ─── Build Modules Array ─────────────────────────────────────
const MODULES: ModuleData[] = [
  {
    title: "Your Call Flow",
    subtitle: "The 6-step framework — what to say and what the system does",
    icon: Phone,
    iconColor: GREEN,
    tasks: [
      { id: "m1-task-0", label: "Read through all 6 steps of the call flow below" },
      { id: "m1-task-1", label: 'Practice saying the greeting aloud: "Handy Services, how can I help?"' },
      { id: "m1-task-2", label: "Open the Live Switchboard page on your phone (menu → Live)" },
    ],
    quizzes: [
      {
        id: "m1-q0",
        question: "What is the first thing you say when answering a call?",
        options: ['"Hello, who is this?"', '"Handy Services, how can I help?"', '"What do you need fixed?"', '"Can I have your name please?"'],
        correctIndex: 1,
        explanation: "Always open with a warm, branded greeting. It sets a professional tone and tells the customer they've reached the right place.",
      },
      {
        id: "m1-q1",
        question: "At which step do you ask for the customer's name?",
        options: ["Step 1 — right at the start", "Step 2 — while listening to the problem", "Step 4 — after explaining quoting options", "Step 6 — at the very end"],
        correctIndex: 2,
        explanation: "You ask for the name AFTER explaining the quoting options. Let them describe the problem first, then collect details.",
      },
      {
        id: "m1-q2",
        question: "What should you do while the customer describes their problem?",
        options: ["Interrupt with clarifying questions", "Start typing the quote immediately", "Listen and watch the AI detect jobs on screen", "Put them on hold and check pricing"],
        correctIndex: 2,
        explanation: "Let them talk. The AI on your Live Switchboard screen will automatically detect the job type. Your job is to listen and confirm.",
      },
    ],
    content: <CallFlowContent />,
  },
  {
    title: "Know Your SKUs",
    subtitle: "The 9 services, categories, prices, and how customers describe them",
    icon: Package,
    iconColor: BLUE,
    tasks: [
      { id: "m2-task-0", label: "Review the 9 SKUs below — know the categories and price ranges" },
      { id: "m2-task-1", label: 'Read the "Customers say" keywords — these are the words you\'ll hear on calls' },
    ],
    quizzes: [
      {
        id: "m2-q0",
        question: 'A customer says "my tap won\'t stop dripping." Which SKU matches?',
        options: ["PLUMB-BLOCKAGE-CLEAR", "PLUMB-SHOWER-REPAIR", "PLUMB-TAP-REPAIR", "HANDY-SILICONE-SEAL"],
        correctIndex: 2,
        explanation: 'Keywords like "tap", "dripping", and "leaking" map to PLUMB-TAP-REPAIR at £95.',
      },
      {
        id: "m2-q1",
        question: "How much does a blockage clearance cost?",
        options: ["£75", "£95", "£110", "£120"],
        correctIndex: 3,
        explanation: "PLUMB-BLOCKAGE-CLEAR is £120. It's the most expensive plumbing SKU because blockages often require specialist equipment.",
      },
      {
        id: "m2-q2",
        question: '"I need my IKEA wardrobe assembled." Which SKU?',
        options: ["HANDY-TV-MOUNT", "FLATPACK-GENERIC", "HANDY-SILICONE-SEAL", "ELEC-SOCKET-REPLACE"],
        correctIndex: 1,
        explanation: "FLATPACK-GENERIC at £60/hr covers all assembly work — IKEA, wardrobes, desks, etc.",
      },
      {
        id: "m2-q3",
        question: "Which SKU has the lowest starting price?",
        options: ["ELEC-LIGHT-FITTING (£85)", "FLATPACK-GENERIC (£60/hr)", "ELEC-SOCKET-REPLACE (£75)", "PLUMB-TAP-REPAIR (£95)"],
        correctIndex: 1,
        explanation: "FLATPACK-GENERIC starts at £60/hr, making it the lowest. ELEC-SOCKET-REPLACE at £75 is the cheapest fixed-price SKU.",
      },
    ],
    content: <SKUContent />,
  },
  {
    title: "The Live Call Screen",
    subtitle: "What you see during a call, auto-populate, and the traffic light system",
    icon: Monitor,
    iconColor: ORANGE,
    tasks: [
      { id: "m3-task-0", label: "Open the Live Switchboard page on your phone and look at the layout" },
      { id: "m3-task-1", label: "Understand the three traffic light colors and what each means" },
    ],
    quizzes: [
      {
        id: "m3-q0",
        question: "What does a GREEN traffic light next to a job mean?",
        options: ["The customer is happy", "The job has a matching SKU with a known price", "The job is urgent", "The contractor is available"],
        correctIndex: 1,
        explanation: "Green = the system found a matching SKU and can price it. You can send a quote for green jobs.",
      },
      {
        id: "m3-q1",
        question: "What does the AI do automatically while you're on a call?",
        options: ["Sends the quote for you", "Detects mentioned jobs and suggests customer segment", "Books the contractor", "Transfers the call"],
        correctIndex: 1,
        explanation: "The AI detects jobs (showing them with SKU matches) and suggests a customer segment. You confirm or override.",
      },
      {
        id: "m3-q2",
        question: "Where does the customer's name appear on the screen?",
        options: ["You must type it manually every time", "It's extracted automatically from the conversation", "It comes from the phone book", "The customer enters it on a web form"],
        correctIndex: 1,
        explanation: "The AI extracts the name from speech when the customer says it. It auto-fills on screen, but you can always edit it.",
      },
    ],
    content: <LiveScreenContent />,
  },
  {
    title: "Action Buttons",
    subtitle: "When to use SEND QUOTE vs GET VIDEO vs BOOK VISIT",
    icon: Zap,
    iconColor: AMBER,
    tasks: [
      { id: "m4-task-0", label: "Review the three action buttons and their requirements below" },
      { id: "m4-task-1", label: "Understand which button to use for each traffic light color" },
    ],
    quizzes: [
      {
        id: "m4-q0",
        question: "Customer calls about a dripping tap (SKU matched). You have name, phone, address. Which button?",
        options: ["GET VIDEO", "BOOK VISIT", "SEND QUOTE", "None — call the boss first"],
        correctIndex: 2,
        explanation: "All green: SKU matched, all info collected. Hit SEND QUOTE.",
      },
      {
        id: "m4-q1",
        question: '"Strange noise behind the wall when heating comes on." No SKU match. Which button?',
        options: ["SEND QUOTE", "GET VIDEO", "BOOK VISIT", "Hang up"],
        correctIndex: 1,
        explanation: "No SKU match (amber). Ask for a video first so you can assess the job before quoting.",
      },
      {
        id: "m4-q2",
        question: "What information does GET VIDEO need to work?",
        options: ["Name + Phone + Address + SKU match", "Name + Phone only", "Just the phone number", "All fields including postcode"],
        correctIndex: 1,
        explanation: "GET VIDEO only needs name and phone. The system sends a WhatsApp message asking for a video. Address isn't needed yet.",
      },
    ],
    content: <ActionButtonsContent />,
  },
  {
    title: "Practice Scenarios",
    subtitle: "5 realistic calls — pick the right action to graduate!",
    icon: Rocket,
    iconColor: RED,
    tasks: [
      { id: "m5-task-0", label: "Complete all 5 scenario quizzes below to graduate" },
    ],
    quizzes: SCENARIOS.map(s => s.quiz),
    content: <ScenariosContent />,
  },
];

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function ProgressHeader({ progress }: { progress: TrainingProgress }) {
  const completed = progress.modulesCompleted.filter(Boolean).length;
  const pct = Math.round((completed / 5) * 100);
  const allDone = completed === 5;

  return (
    <motion.div variants={fadeUp} className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Training Center</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            {allDone ? "🎉 All modules complete — you're ready to go live!" : `${completed} of 5 modules complete`}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black" style={{ color: allDone ? GREEN : AMBER }}>{pct}%</div>
        </div>
      </div>
      <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: allDone ? GREEN : AMBER }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      {/* Module dots */}
      <div className="flex items-center justify-between mt-3 px-1">
        {MODULES.map((mod, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300"
              style={{
                borderColor: progress.modulesCompleted[i] ? GREEN : i === 0 || progress.modulesCompleted[i - 1] ? AMBER : "#3f3f46",
                background: progress.modulesCompleted[i] ? GREEN_DIM : "transparent",
                color: progress.modulesCompleted[i] ? GREEN : i === 0 || progress.modulesCompleted[i - 1] ? AMBER : "#71717a",
              }}>
              {progress.modulesCompleted[i] ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function TaskCheckbox({ task, checked, onChange }: { task: TaskItem; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="flex items-start gap-3 w-full text-left rounded-lg px-3 py-2.5 hover:bg-zinc-800/40 transition-colors"
    >
      <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-200"
        style={{
          borderColor: checked ? GREEN : "#52525b",
          background: checked ? GREEN_DIM : "transparent",
        }}>
        {checked && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: GREEN }} />}
      </div>
      <span className={`text-sm leading-relaxed transition-all duration-200 ${checked ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
        {task.label}
      </span>
    </button>
  );
}

function QuizBlock({
  quiz,
  isCorrect,
  onAnswer,
}: {
  quiz: QuizItem;
  isCorrect: boolean | undefined;
  onAnswer: (correct: boolean) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState<"correct" | "incorrect" | null>(null);
  const [locked, setLocked] = useState(isCorrect === true);

  // Sync locked state when isCorrect changes (e.g. from localStorage load)
  useEffect(() => {
    if (isCorrect === true) setLocked(true);
  }, [isCorrect]);

  const handleSelect = (idx: number) => {
    if (locked) return;
    setSelected(idx);
    if (idx === quiz.correctIndex) {
      setShowResult("correct");
      setLocked(true);
      onAnswer(true);
    } else {
      setShowResult("incorrect");
      setTimeout(() => {
        setShowResult(null);
        setSelected(null);
      }, 1500);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-sm font-medium text-white mb-3">{quiz.question}</p>
      <div className="space-y-2">
        {quiz.options.map((opt, idx) => {
          let borderColor = "#3f3f46";
          let bg = "transparent";
          let textColor = "#d4d4d8";

          if (locked && idx === quiz.correctIndex) {
            borderColor = GREEN;
            bg = GREEN_DIM;
            textColor = GREEN;
          } else if (showResult === "incorrect" && idx === selected) {
            borderColor = RED;
            bg = RED_DIM;
            textColor = RED;
          } else if (selected === idx && showResult === "correct") {
            borderColor = GREEN;
            bg = GREEN_DIM;
            textColor = GREEN;
          }

          return (
            <motion.button
              key={idx}
              onClick={() => handleSelect(idx)}
              disabled={locked}
              className="w-full text-left rounded-lg px-4 py-3 border text-sm font-medium transition-colors"
              style={{ borderColor, background: bg, color: textColor }}
              animate={showResult === "incorrect" && idx === selected ? { x: [0, -3, 3, -3, 3, 0] } : {}}
              transition={{ duration: 0.35 }}
            >
              <span className="mr-2 text-zinc-500 font-mono text-xs">{String.fromCharCode(65 + idx)}.</span>
              {opt}
            </motion.button>
          );
        })}
      </div>
      {/* Explanation */}
      <AnimatePresence>
        {(showResult === "correct" || (locked && isCorrect)) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-lg px-3 py-2.5 border text-sm"
            style={{ borderColor: GREEN, background: GREEN_DIM, color: "#bbf7d0" }}
          >
            <span className="font-semibold">✓ Correct!</span> {quiz.explanation}
          </motion.div>
        )}
        {showResult === "incorrect" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 rounded-lg px-3 py-2.5 border text-sm"
            style={{ borderColor: RED, background: RED_DIM, color: "#fecaca" }}
          >
            <span className="font-semibold">✗ Not quite.</span> Try again!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ScenarioCard({ scenario, quizCorrect, onAnswer }: {
  scenario: typeof SCENARIOS[0];
  quizCorrect: boolean | undefined;
  onAnswer: (correct: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-white font-semibold text-sm" style={{ color: AMBER }}>{scenario.title}</div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 space-y-1.5">
        {scenario.transcript.map((line, i) => {
          const isSystem = line.startsWith("🟢") || line.startsWith("🟡") || line.startsWith("🔴");
          const isCustomer = line.startsWith("Customer:");
          return (
            <div key={i} className={`text-xs leading-relaxed ${isSystem ? "font-mono text-zinc-400 mt-2 pt-2 border-t border-zinc-800" : isCustomer ? "text-zinc-200" : "text-zinc-500"}`}>
              {isCustomer && <span className="font-semibold text-zinc-400">📞 </span>}
              {line.startsWith("You:") && <span className="font-semibold" style={{ color: AMBER }}>🎧 </span>}
              {line}
            </div>
          );
        })}
      </div>
      <QuizBlock quiz={scenario.quiz} isCorrect={quizCorrect} onAnswer={onAnswer} />
    </div>
  );
}

function ModuleAccordion({
  moduleIndex,
  module: mod,
  isLocked,
  isCompleted,
  progress,
  onTaskToggle,
  onQuizAnswer,
}: {
  moduleIndex: number;
  module: ModuleData;
  isLocked: boolean;
  isCompleted: boolean;
  progress: TrainingProgress;
  onTaskToggle: (taskId: string) => void;
  onQuizAnswer: (quizId: string, correct: boolean) => void;
}) {
  const [open, setOpen] = useState(!isLocked && !isCompleted);
  const ref = useRef<HTMLDivElement>(null);
  const Icon = mod.icon;

  // Auto-expand when unlocked
  useEffect(() => {
    if (!isLocked && !isCompleted) {
      setOpen(true);
      // Scroll into view with slight delay for animation
      setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, [isLocked, isCompleted]);

  const tasksComplete = mod.tasks.every(t => progress.tasks[t.id]);
  const quizzesComplete = mod.quizzes.every(q => progress.quizCorrect[q.id]);

  return (
    <motion.div
      ref={ref}
      variants={fadeUp}
      className={`rounded-xl border overflow-hidden transition-all duration-300 ${
        isLocked ? "border-zinc-800/50 opacity-60" :
        isCompleted ? "border-zinc-700" :
        "border-zinc-700"
      }`}
      style={isCompleted ? { borderColor: `${GREEN}40` } : undefined}
    >
      {/* Header */}
      <button
        onClick={() => !isLocked && setOpen(!open)}
        disabled={isLocked}
        className={`w-full flex items-center gap-3 px-4 py-4 text-left transition-colors ${
          isLocked ? "cursor-not-allowed" : "hover:bg-zinc-800/40 cursor-pointer"
        }`}
      >
        {/* Module icon */}
        <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: isLocked ? "#27272a" : isCompleted ? GREEN_DIM : `${mod.iconColor}18`,
          }}>
          {isLocked ? (
            <Lock className="w-5 h-5 text-zinc-600" />
          ) : isCompleted ? (
            <CheckCircle2 className="w-5 h-5" style={{ color: GREEN }} />
          ) : (
            <Icon className="w-5 h-5" style={{ color: mod.iconColor }} />
          )}
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-semibold text-sm ${isLocked ? "text-zinc-600" : "text-white"}`}>
              Module {moduleIndex + 1}: {mod.title}
            </span>
            {isCompleted && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: GREEN, background: GREEN_DIM }}>DONE</span>
            )}
          </div>
          <p className={`text-xs mt-0.5 ${isLocked ? "text-zinc-700" : "text-zinc-500"}`}>
            {isLocked ? `Complete Module ${moduleIndex} to unlock` : mod.subtitle}
          </p>
        </div>

        {/* Chevron */}
        {!isLocked && (
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform duration-200 flex-shrink-0 ${open ? "" : "-rotate-90"}`} />
        )}
      </button>

      {/* Expandable Content */}
      <AnimatePresence>
        {open && !isLocked && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-5 space-y-5">
              {/* Divider */}
              <div className="border-t border-zinc-800" />

              {/* Tasks */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ClipboardCheck className="w-4 h-4 text-zinc-500" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Tasks</span>
                  <span className="text-[10px] font-mono text-zinc-600">
                    {mod.tasks.filter(t => progress.tasks[t.id]).length}/{mod.tasks.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {mod.tasks.map(task => (
                    <TaskCheckbox
                      key={task.id}
                      task={task}
                      checked={!!progress.tasks[task.id]}
                      onChange={() => onTaskToggle(task.id)}
                    />
                  ))}
                </div>
              </div>

              {/* Content */}
              <motion.div variants={stagger} initial="hidden" animate="show">
                {mod.content}
              </motion.div>

              {/* Scenarios (Module 5 special) */}
              {moduleIndex === 4 && (
                <div className="space-y-6">
                  {SCENARIOS.map((scenario, i) => (
                    <ScenarioCard
                      key={i}
                      scenario={scenario}
                      quizCorrect={progress.quizCorrect[scenario.quiz.id]}
                      onAnswer={(correct) => onQuizAnswer(scenario.quiz.id, correct)}
                    />
                  ))}
                </div>
              )}

              {/* Quizzes (non-scenario modules) */}
              {moduleIndex !== 4 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-zinc-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Knowledge Check</span>
                    <span className="text-[10px] font-mono text-zinc-600">
                      {mod.quizzes.filter(q => progress.quizCorrect[q.id]).length}/{mod.quizzes.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {mod.quizzes.map(quiz => (
                      <QuizBlock
                        key={quiz.id}
                        quiz={quiz}
                        isCorrect={progress.quizCorrect[quiz.id]}
                        onAnswer={(correct) => onQuizAnswer(quiz.id, correct)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Module Complete Banner */}
              <AnimatePresence>
                {isCompleted && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-xl p-4 text-center border"
                    style={{ borderColor: GREEN, background: GREEN_DIM }}
                  >
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2" style={{ color: GREEN }} />
                    <div className="font-bold text-sm" style={{ color: GREEN }}>Module {moduleIndex + 1} Complete!</div>
                    {moduleIndex < 4 && (
                      <div className="text-xs text-zinc-400 mt-1">Module {moduleIndex + 2} is now unlocked</div>
                    )}
                    {moduleIndex === 4 && (
                      <div className="text-xs mt-1" style={{ color: GREEN }}>🎉 You've graduated — you're ready for live calls!</div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════

export default function VATrainingCenter() {
  const [progress, setProgress] = useState<TrainingProgress>(loadProgress);

  // Persist to localStorage on every change
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  // Check module completion whenever tasks/quizzes change
  const computeModulesCompleted = useCallback((p: TrainingProgress): boolean[] => {
    return MODULES.map((mod) => {
      const allTasks = mod.tasks.every(t => p.tasks[t.id]);
      const allQuizzes = mod.quizzes.every(q => p.quizCorrect[q.id]);
      return allTasks && allQuizzes;
    });
  }, []);

  const handleTaskToggle = useCallback((taskId: string) => {
    setProgress(prev => {
      const next = {
        ...prev,
        tasks: { ...prev.tasks, [taskId]: !prev.tasks[taskId] },
      };
      next.modulesCompleted = computeModulesCompleted(next);
      return next;
    });
  }, [computeModulesCompleted]);

  const handleQuizAnswer = useCallback((quizId: string, correct: boolean) => {
    if (!correct) return;
    setProgress(prev => {
      const next = {
        ...prev,
        quizCorrect: { ...prev.quizCorrect, [quizId]: true },
      };
      next.modulesCompleted = computeModulesCompleted(next);
      return next;
    });
  }, [computeModulesCompleted]);

  const handleReset = useCallback(() => {
    const blank: TrainingProgress = { tasks: {}, quizCorrect: {}, modulesCompleted: [false, false, false, false, false] };
    setProgress(blank);
    saveProgress(blank);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const isModuleLocked = (i: number) => i > 0 && !progress.modulesCompleted[i - 1];

  return (
    <div className="min-h-screen pb-24 max-w-4xl mx-auto">
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
        <ProgressHeader progress={progress} />

        {MODULES.map((mod, i) => (
          <ModuleAccordion
            key={i}
            moduleIndex={i}
            module={mod}
            isLocked={isModuleLocked(i)}
            isCompleted={progress.modulesCompleted[i]}
            progress={progress}
            onTaskToggle={handleTaskToggle}
            onQuizAnswer={handleQuizAnswer}
          />
        ))}

        {/* Reset button */}
        <motion.div variants={fadeUp} className="flex justify-center pt-4 pb-8">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset Progress
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
