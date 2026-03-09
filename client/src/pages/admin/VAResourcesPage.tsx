import { useState, useEffect } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import {
  BookOpen, MessageSquare, PoundSterling, CheckSquare, GitBranch,
  HelpCircle, Copy, Check, ChevronDown, ChevronRight,
  Phone, Clock, MapPin, Wrench, AlertTriangle, Camera,
  Users, Headphones, Navigation, FileText, ArrowRight,
  Home, Building2, Briefcase, Wallet, Heart, Store, HardHat, Key,
  Zap, Shield, Search, RotateCcw, ClipboardCheck
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

// ─── Design tokens ───────────────────────────────────────────
const AMBER = "#e8b323";
const AMBER_DIM = "rgba(232,179,35,0.12)";
const GREEN = "#22c55e";
const BLUE = "#3b82f6";
const RED = "#ef4444";
const ORANGE = "#f59e0b";

// ─── Animation ───────────────────────────────────────────────
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};
const stagger: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

// ─── Tabs ────────────────────────────────────────────────────
const TABS = [
  { id: "sops", label: "SOPs", icon: BookOpen },
  { id: "scripts", label: "WhatsApp Scripts", icon: MessageSquare },
  { id: "pricing", label: "Pricing", icon: PoundSterling },
  { id: "checklists", label: "Checklists", icon: CheckSquare },
  { id: "flows", label: "Flow Diagrams", icon: GitBranch },
  { id: "faq", label: "FAQ", icon: HelpCircle },
] as const;

type TabId = typeof TABS[number]["id"];

// ─── Copy button helper ─────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast({ title: "Copied to clipboard" });
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-zinc-700 hover:border-zinc-500 bg-zinc-800/60 hover:bg-zinc-700/60 transition-all"
      style={{ color: copied ? GREEN : "#a1a1aa" }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Accordion ───────────────────────────────────────────────
function Accordion({ title, children, defaultOpen = false, badge }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
        <span className="text-white font-semibold text-sm flex-1">{title}</span>
        {badge && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{badge}</span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 pt-1 border-t border-zinc-800/60">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── SOP Step ────────────────────────────────────────────────
function SopStep({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center text-zinc-950" style={{ background: AMBER }}>{num}</span>
      <span className="text-zinc-300 text-sm leading-relaxed">{text}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB: SOPs
// ═══════════════════════════════════════════════════════════════
function TabSOPs() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-3">
      <Accordion title="Incoming Call — Full Procedure" badge="Core" defaultOpen>
        <div className="space-y-0.5">
          <SopStep num={1} text='Answer within 3 rings: "Handy Services, how can I help?"' />
          <SopStep num={2} text="Open LiveCallHUD on your phone immediately (handyservices.app/admin/live-call)" />
          <SopStep num={3} text="LISTEN — Let the customer describe the problem. Don't interrupt. AI will detect job types on screen." />
          <SopStep num={4} text="SEGMENT — Pick up clues: are they a landlord? Busy professional? Business? AI suggests a segment — confirm or override." />
          <SopStep num={5} text="QUALIFY — Can we do this job? Decision maker on the call? Can we access the property? Green / Amber / Red." />
          <SopStep num={6} text="DESTINATION — Based on qualification: send instant quote link, request a video, or book a site visit." />
          <SopStep num={7} text="Collect: Name, phone, postcode, job description, urgency." />
          <SopStep num={8} text="If quoting: generate quote in CRM, copy link, send via WhatsApp." />
          <SopStep num={9} text={`Close: "I'll send that quote right over. Any questions, just reply on WhatsApp."`} />
        </div>
      </Accordion>

      <Accordion title="WhatsApp Lead — Full Procedure" badge="Core">
        <div className="space-y-0.5">
          <SopStep num={1} text="Reply within 2 minutes. Speed wins here — they're messaging competitors too." />
          <SopStep num={2} text="Be conversational, not robotic. Use their name if they give it." />
          <SopStep num={3} text="Gather the 5 essentials naturally: What (job), Where (postcode), Who (name), When (urgency), Type (homeowner/landlord/tenant/biz)." />
          <SopStep num={4} text="Don't ask these as a checklist — weave them into natural conversation." />
          <SopStep num={5} text="Once you have enough info, say you'll put a quote together." />
          <SopStep num={6} text="Generate quote in CRM → Copy link → Paste into WhatsApp." />
          <SopStep num={7} text="Follow up if no response within 4 hours: 'Hi [name], just checking you got the quote I sent — any questions?'" />
        </div>
      </Accordion>

      <Accordion title="Generating & Sending a Quote" badge="Core">
        <div className="space-y-0.5">
          <SopStep num={1} text="Open CRM dashboard (handyservices.app/admin)" />
          <SopStep num={2} text="Go to Quote Generator (sidebar or /admin/quotes)" />
          <SopStep num={3} text="Fill in: Customer name, phone, job description, postcode, segment" />
          <SopStep num={4} text="If unsure of segment, pick DEFAULT — the system handles pricing" />
          <SopStep num={5} text="Click 'Generate Quote' — system creates a personalised quote page" />
          <SopStep num={6} text="Copy the quote link" />
          <SopStep num={7} text="Paste into WhatsApp and send to customer" />
          <SopStep num={8} text="Quote is now tracked — you'll see when they view it, select a package, or pay" />
        </div>
      </Accordion>

      <Accordion title="Qualifying a Job (Traffic Light System)">
        <div className="space-y-3">
          {[
            { color: GREEN, label: "GREEN — Good to go", items: ["Standard handyman work (plumbing, electrical, assembly, repairs)", "Customer is the decision maker", "Property access confirmed", "→ Send instant quote"] },
            { color: ORANGE, label: "AMBER — Need more info", items: ["Complex or multi-trade job", "Can't assess without seeing it", "Unclear scope", "→ Request video or book site visit"] },
            { color: RED, label: "RED — Refer out", items: ["Gas work (MUST be Gas Safe registered)", "Structural changes (load-bearing walls)", "Asbestos risk (pre-2000 buildings)", "Full rewires or consumer unit replacements", "→ Politely explain and suggest a specialist"] },
          ].map(({ color, label, items }) => (
            <div key={label} className="rounded-lg border border-zinc-800 p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                <span className="text-sm font-semibold" style={{ color }}>{label}</span>
              </div>
              <ul className="space-y-1 pl-5">
                {items.map(item => (
                  <li key={item} className="text-zinc-400 text-xs leading-relaxed list-disc">{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Accordion>

      <Accordion title="Escalation — When to Contact the Boss">
        <div className="space-y-2">
          {[
            { trigger: "Customer complaint or dispute", action: "Message owner immediately with context" },
            { trigger: "Emergency job (flooding, no heating, security)", action: "Quote immediately, escalate if >£500" },
            { trigger: "Job over £500", action: "Send quote but flag to owner for review" },
            { trigger: "Customer asks for discount", action: "Don't discount. Say: 'Let me check what we can do' and message owner" },
            { trigger: "Unsure if we can do a job", action: "Ask owner before committing — better to check than promise wrong" },
            { trigger: "Customer abusive or aggressive", action: "Stay calm, end call politely, report to owner" },
          ].map(({ trigger, action }) => (
            <div key={trigger} className="flex gap-3 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
              <div>
                <span className="text-white font-medium">{trigger}</span>
                <span className="text-zinc-500"> → </span>
                <span className="text-zinc-400">{action}</span>
              </div>
            </div>
          ))}
        </div>
      </Accordion>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB: WhatsApp Scripts
// ═══════════════════════════════════════════════════════════════
const SCRIPTS = [
  {
    title: "First Response (New Lead)",
    scenario: "Customer messages in with a job enquiry",
    template: `Hi [name]! 👋 Thanks for getting in touch with Handy Services.

I can definitely help with that. Could I grab your postcode so I can put together an accurate quote for you?`,
  },
  {
    title: "Sending a Quote",
    scenario: "After generating the quote, sending the link",
    template: `Hi [name], here's your personalised quote for the [job description]:

[QUOTE LINK]

You can view the details, choose a package, and book a time that works for you — all on that page. Let me know if you've got any questions! 👍`,
  },
  {
    title: "Follow-Up (4 Hours, No Response)",
    scenario: "Customer hasn't responded to quote",
    template: `Hi [name], just checking you received the quote I sent earlier for the [job]. Happy to answer any questions if you need! 😊`,
  },
  {
    title: "Follow-Up (24 Hours, No Response)",
    scenario: "Still no response after a day",
    template: `Hi [name], hope you're well! Just a quick follow-up on the [job] quote. We've got some availability this week if you'd like to get it sorted. No pressure at all — just let me know! 🙂`,
  },
  {
    title: "Follow-Up (Viewed but Not Booked)",
    scenario: "Customer opened the quote but didn't book",
    template: `Hi [name], I noticed you had a look at the quote — hope it all makes sense! If you've got any questions or want to adjust anything, just give me a shout. Happy to help 👍`,
  },
  {
    title: "Requesting a Video",
    scenario: "Need to see the job before quoting accurately",
    template: `Hi [name], to make sure I give you the most accurate quote, could you send me a quick video of the [job]? Just 30 seconds showing the area would be perfect. I can then get a quote right over to you! 📹`,
  },
  {
    title: "Rescheduling",
    scenario: "Customer needs to change booking date",
    template: `No problem at all, [name]! Let me check our availability. What day works best for you? We've usually got slots within the next few days.`,
  },
  {
    title: "Job Complete — Requesting Review",
    scenario: "After a job is finished",
    template: `Hi [name], glad we could get that sorted for you! If you've got 30 seconds, we'd really appreciate a quick Google review — it helps other people find us:

[REVIEW LINK]

Thanks so much, and don't hesitate to reach out if you need anything else! ⭐`,
  },
];

function TabScripts() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-3">
      {SCRIPTS.map(({ title, scenario, template }) => (
        <motion.div key={title} variants={fadeUp} className="border border-zinc-800 rounded-xl bg-zinc-900/50 overflow-hidden">
          <div className="px-5 py-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-white font-semibold text-sm">{title}</h3>
              <p className="text-zinc-500 text-xs mt-0.5">{scenario}</p>
            </div>
            <CopyButton text={template} />
          </div>
          <div className="px-5 pb-4">
            <pre className="text-zinc-300 text-xs leading-relaxed whitespace-pre-wrap font-sans bg-zinc-800/40 rounded-lg p-3 border border-zinc-800">{template}</pre>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB: Pricing Quick-Ref
// ═══════════════════════════════════════════════════════════════
const PRICING_DATA = [
  { job: "Tap Repair / Replacement", price: "£95", time: "60 min", range: "£45–90 market" },
  { job: "Toilet Repair", price: "£95", time: "60 min", range: "£45–90 market" },
  { job: "Blockage Clearance", price: "£120", time: "60 min", range: "£60–100 market" },
  { job: "Shower Repair", price: "£110", time: "90 min", range: "£60–120 market" },
  { job: "Light Fitting Replacement", price: "£85", time: "45 min", range: "£45–90 market" },
  { job: "Socket / Switch Replace", price: "£75", time: "30 min", range: "£45–90 market" },
  { job: "Flatpack Assembly", price: "£60+", time: "60 min+", range: "£50–112 market" },
  { job: "TV Wall Mounting", price: "£85", time: "60 min", range: "£60–110 market" },
  { job: "Shelf Installation", price: "£80+", time: "60 min+", range: "£50–112 market" },
  { job: "Resealing Bath / Shower", price: "£90", time: "90 min", range: "£60–100 market" },
  { job: "Door Hanging / Adjustment", price: "£80+", time: "60 min+", range: "£60–112 market" },
  { job: "Curtain Rail / Blinds", price: "£65", time: "45 min", range: "£30–65 market" },
  { job: "Picture / Mirror Hanging", price: "£50", time: "30 min", range: "£30–60 market" },
  { job: "Ceiling / Mould Repair", price: "£90+", time: "90 min+", range: "£60–112 market" },
  { job: "General Repair (misc)", price: "£85+", time: "60 min+", range: "£67–112 market" },
];

const SEGMENT_PREMIUMS = [
  { segment: "BUSY_PRO", icon: Briefcase, premium: "+£50", note: "Speed, convenience, direct contact" },
  { segment: "LANDLORD", icon: Home, premium: "+£45", note: "Photo proof, tenant coord, tax invoice" },
  { segment: "PROP_MGR", icon: Building2, premium: "+£45", note: "Reliability, photo report, scheduling" },
  { segment: "SMALL_BIZ", icon: Store, premium: "+£50–85", note: "After-hours, emergency, business invoice" },
  { segment: "DIY_DEFERRER", icon: HardHat, premium: "+£20", note: "Batch efficiency, cleanup, guarantee" },
  { segment: "BUDGET", icon: Wallet, premium: "+£5", note: "Vetted professional, minimal extras" },
];

function TabPricing() {
  const [search, setSearch] = useState("");
  const filtered = PRICING_DATA.filter(p => p.job.toLowerCase().includes(search.toLowerCase()));

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Search */}
      <motion.div variants={fadeUp} className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search jobs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
        />
      </motion.div>

      {/* Pricing table */}
      <motion.div variants={fadeUp} className="border border-zinc-800 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_80px_120px] gap-0 text-xs font-semibold text-zinc-500 uppercase tracking-wider px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800">
          <span>Job</span>
          <span>Our Price</span>
          <span>Time</span>
          <span>Market Range</span>
        </div>
        <div className="divide-y divide-zinc-800/60">
          {filtered.map(({ job, price, time, range }) => (
            <div key={job} className="grid grid-cols-[1fr_80px_80px_120px] gap-0 px-4 py-2.5 hover:bg-zinc-800/30 transition-colors">
              <span className="text-white text-sm font-medium">{job}</span>
              <span className="text-sm font-bold" style={{ color: AMBER }}>{price}</span>
              <span className="text-zinc-400 text-sm">{time}</span>
              <span className="text-zinc-500 text-xs">{range}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-600 text-sm">No matching jobs found</div>
          )}
        </div>
      </motion.div>

      {/* Segment premiums */}
      <motion.div variants={fadeUp}>
        <h3 className="text-white font-semibold text-sm mb-2 flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: AMBER }} />
          Segment Price Premiums
        </h3>
        <p className="text-zinc-500 text-xs mb-3">Our price = Market reference + these extras based on customer type</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {SEGMENT_PREMIUMS.map(({ segment, icon: Icon, premium, note }) => (
            <div key={segment} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
              <Icon className="w-4 h-4 flex-shrink-0" style={{ color: AMBER }} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white text-xs font-semibold">{segment}</span>
                  <span className="text-xs font-bold" style={{ color: GREEN }}>{premium}</span>
                </div>
                <span className="text-zinc-500 text-[11px]">{note}</span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Quick note */}
      <motion.div variants={fadeUp} className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/30 px-4 py-3">
        <p className="text-zinc-500 text-xs leading-relaxed">
          <span className="text-zinc-300 font-medium">Don't stress about exact prices.</span> The quote generator calculates pricing automatically based on the segment. These are ballpark figures so you know what to expect — not something you quote verbally on a call.
        </p>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB: Checklists
// ═══════════════════════════════════════════════════════════════
const DAILY_ITEMS = [
  "Check WhatsApp for overnight messages — reply to all",
  "Review CRM pipeline — any quotes expiring today?",
  "Follow up on yesterday's unanswered quotes (4hr+ no response)",
  "Check missed calls log and return calls",
  "Ensure LiveCallHUD shortcut is bookmarked and ready",
];

const WEEKLY_ITEMS = [
  "Review pipeline — chase all quotes older than 48 hours",
  "Count quotes sent this week (for commission tracking)",
  "Count accepted quotes this week",
  "Flag any stuck leads to owner",
  "Check if any repeat customers have new enquiries",
];

const PER_LEAD_ITEMS = [
  "Replied within 2 minutes (WhatsApp) or 3 rings (call)?",
  "Collected: name, phone, postcode, job description?",
  "Identified segment (or used DEFAULT)?",
  "Qualified: Green / Amber / Red?",
  "Quote generated and link sent?",
  "Follow-up scheduled if no response?",
];

function ChecklistSection({ title, items, storageKey }: { title: string; items: string[]; storageKey: string }) {
  const [checked, setChecked] = useState<boolean[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return items.map(() => false);
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(checked));
  }, [checked, storageKey]);

  const toggle = (i: number) => setChecked(prev => prev.map((v, idx) => idx === i ? !v : v));
  const resetAll = () => setChecked(items.map(() => false));
  const doneCount = checked.filter(Boolean).length;

  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-semibold text-sm">{title}</h3>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full" style={{
            background: doneCount === items.length ? "rgba(34,197,94,0.15)" : "rgba(161,161,170,0.1)",
            color: doneCount === items.length ? GREEN : "#71717a"
          }}>
            {doneCount}/{items.length}
          </span>
        </div>
        <button onClick={resetAll} className="text-zinc-600 hover:text-zinc-400 transition-colors" title="Reset">
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => toggle(i)}
            className="w-full flex items-start gap-3 py-1.5 px-1 rounded-md text-left hover:bg-zinc-800/30 transition-colors group"
          >
            <div
              className="flex-shrink-0 w-4 h-4 mt-0.5 rounded border flex items-center justify-center transition-all"
              style={{
                borderColor: checked[i] ? GREEN : "#3f3f46",
                background: checked[i] ? GREEN : "transparent",
              }}
            >
              {checked[i] && <Check className="w-3 h-3 text-zinc-950" />}
            </div>
            <span className={`text-sm leading-relaxed transition-colors ${checked[i] ? "text-zinc-600 line-through" : "text-zinc-300"}`}>
              {item}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TabChecklists() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={fadeUp}>
        <ChecklistSection title="Daily — Start of Shift" items={DAILY_ITEMS} storageKey="va-checklist-daily" />
      </motion.div>
      <motion.div variants={fadeUp}>
        <ChecklistSection title="Weekly — Every Monday" items={WEEKLY_ITEMS} storageKey="va-checklist-weekly" />
      </motion.div>
      <motion.div variants={fadeUp}>
        <ChecklistSection title="Per Lead — Every Enquiry" items={PER_LEAD_ITEMS} storageKey="va-checklist-per-lead" />
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB: Flow Diagrams
// ═══════════════════════════════════════════════════════════════
function FlowNode({ label, color, icon: Icon, sub }: { label: string; color: string; icon: any; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0" style={{ borderColor: color, background: `${color}15` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div>
        <span className="text-white text-sm font-medium">{label}</span>
        {sub && <p className="text-zinc-500 text-[11px]">{sub}</p>}
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center py-1 pl-4">
      <div className="w-0.5 h-5 rounded-full" style={{ background: `linear-gradient(to bottom, ${AMBER}40, ${AMBER}10)` }} />
    </div>
  );
}

function TabFlows() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Call Flow */}
      <motion.div variants={fadeUp} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-5">
        <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
          <Phone className="w-4 h-4" style={{ color: AMBER }} />
          Incoming Call Flow
        </h3>
        <div className="space-y-0">
          <FlowNode label="Call comes in" color="#71717a" icon={Phone} sub="Phone rings → answer within 3 rings" />
          <FlowArrow />
          <FlowNode label="LISTEN" color={GREEN} icon={Headphones} sub="Open LiveCallHUD, let customer talk" />
          <FlowArrow />
          <FlowNode label="SEGMENT" color={BLUE} icon={Users} sub="Who are they? AI suggests, you confirm" />
          <FlowArrow />
          <FlowNode label="QUALIFY" color={ORANGE} icon={CheckSquare} sub="Can we do this? Green / Amber / Red" />
          <FlowArrow />
          <FlowNode label="DESTINATION" color={RED} icon={Navigation} />
          {/* Branches */}
          <div className="ml-12 mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { label: "Instant Quote", color: GREEN, desc: "Standard job → generate & send" },
              { label: "Video Request", color: ORANGE, desc: "Need to see it → ask for video" },
              { label: "Site Visit", color: BLUE, desc: "Complex job → book a visit" },
            ].map(({ label, color, desc }) => (
              <div key={label} className="rounded-lg border px-3 py-2" style={{ borderColor: `${color}40` }}>
                <span className="text-xs font-semibold" style={{ color }}>{label}</span>
                <p className="text-zinc-500 text-[11px] mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Quote Flow */}
      <motion.div variants={fadeUp} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-5">
        <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4" style={{ color: AMBER }} />
          Quote-to-Booking Flow
        </h3>
        <div className="space-y-0">
          <FlowNode label="You generate quote" color={AMBER} icon={FileText} sub="CRM → Quote Generator → fill details" />
          <FlowArrow />
          <FlowNode label="Send link via WhatsApp" color={GREEN} icon={MessageSquare} sub="Copy link → paste in chat" />
          <FlowArrow />
          <FlowNode label="Customer views quote" color={BLUE} icon={Users} sub="Tracked automatically — you see this in Pipeline" />
          <FlowArrow />
          <FlowNode label="Customer selects package" color={ORANGE} icon={CheckSquare} sub="They choose tier & add-ons on the quote page" />
          <FlowArrow />
          <FlowNode label="Customer pays deposit" color={GREEN} icon={PoundSterling} sub="Stripe payment → booking confirmed" />
          <FlowArrow />
          <FlowNode label="Job gets dispatched" color="#71717a" icon={Wrench} sub="Contractor assigned, customer notified" />
        </div>
      </motion.div>

      {/* Lead Pipeline */}
      <motion.div variants={fadeUp} className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-5">
        <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
          <GitBranch className="w-4 h-4" style={{ color: AMBER }} />
          Lead Pipeline Stages
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "New Lead", color: "#71717a" },
            { label: "Contacted", color: BLUE },
            { label: "Qualifying", color: ORANGE },
            { label: "Quote Sent", color: AMBER },
            { label: "Quote Viewed", color: "#8b5cf6" },
            { label: "Booked", color: GREEN },
            { label: "Job Complete", color: GREEN },
          ].map(({ label, color }, i, arr) => (
            <div key={label} className="flex items-center gap-2">
              <div className="rounded-lg border px-3 py-2 text-xs font-semibold" style={{ borderColor: `${color}50`, color, background: `${color}10` }}>
                {label}
              </div>
              {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-zinc-700" />}
            </div>
          ))}
        </div>
        <p className="text-zinc-500 text-xs mt-3">
          Your job is to move leads from <span className="text-white font-medium">New Lead</span> to <span className="font-medium" style={{ color: AMBER }}>Quote Sent</span> as fast as possible. The system handles the rest.
        </p>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB: FAQ
// ═══════════════════════════════════════════════════════════════
const FAQS = [
  { q: "What if I don't know what segment to pick?", a: "Just use DEFAULT. The system will apply standard pricing. If the AI suggests a segment during a call, go with that. You'll get better at recognising them over time." },
  { q: "What if a customer asks for a price on the phone?", a: "Never give a price verbally. Say: 'I'll put together an accurate quote and send it right over — that way you've got everything in writing.' Then generate it in the CRM." },
  { q: "What if the customer is outside Nottingham?", a: "We cover Nottingham and surrounding areas (about 15-mile radius). If they're further out, check with the owner before quoting — there may be a travel surcharge." },
  { q: "What if I miss a call?", a: "Check the missed calls log in the CRM. Return the call within 30 minutes if possible. If it's been longer, send a WhatsApp: 'Hi, sorry I missed your call! How can I help?'" },
  { q: "What if a customer wants to negotiate the price?", a: "Don't discount on the spot. Say: 'Let me check what we can do and get back to you.' Then message the owner for guidance." },
  { q: "What if a customer sends photos instead of a video?", a: "Photos are fine for simple jobs. For complex work, ask for a quick video if the photos aren't clear enough to quote accurately." },
  { q: "How do I know if a quote has been accepted?", a: "Check the Pipeline in the CRM. Accepted quotes will have a 'deposit paid' status. You'll also see it in the quote detail page." },
  { q: "What if the customer asks about availability?", a: "Say: 'We usually have availability within the next few days — once you confirm the booking through the quote link, we'll get a time sorted that works for you.'" },
  { q: "What counts as a 'qualified quote' for my commission?", a: "A real customer with real details. Quote must be generated in CRM with genuine customer info and the link sent to the customer. Test quotes and duplicates don't count." },
  { q: "When do I get paid?", a: "Weekly, every Monday. Commission is calculated for the previous week based on quotes sent and quotes accepted (deposit paid)." },
  { q: "What's the difference between LANDLORD and PROP_MGR?", a: "LANDLORD = individual with 1-3 rental properties. PROP_MGR = manages a portfolio (5+ properties, often on behalf of others). Prop managers care about reliability and volume; landlords care about not having to be there." },
  { q: "Can I work from my phone?", a: "Yes! LiveCallHUD works in your phone browser. WhatsApp is on your phone. You can access the CRM from your phone browser too. You don't need a laptop for day-to-day work." },
];

function TabFAQ() {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-2">
      {FAQS.map(({ q, a }) => (
        <motion.div key={q} variants={fadeUp}>
          <Accordion title={q}>
            <p className="text-zinc-400 text-sm leading-relaxed">{a}</p>
          </Accordion>
        </motion.div>
      ))}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════
export default function VAResourcesPage() {
  const [tab, setTab] = useState<TabId>("sops");

  return (
    <div className="min-h-screen space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">VA Resources</h1>
        <p className="text-zinc-500 text-sm mt-1">Your field manual — SOPs, scripts, pricing, and everything you need on the job.</p>
      </div>

      {/* Training Center CTA */}
      <Link href="/admin/training-center">
        <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-zinc-600 hover:bg-zinc-800/60 transition-all cursor-pointer group">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: AMBER_DIM }}>
            <ClipboardCheck className="w-5 h-5" style={{ color: AMBER }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold text-sm">Training Center</div>
            <p className="text-zinc-500 text-xs">Interactive modules, quizzes, and practice scenarios</p>
          </div>
          <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors flex-shrink-0" />
        </div>
      </Link>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-zinc-900/60 border border-zinc-800 rounded-xl">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              tab === id
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
            }`}
          >
            <Icon className="w-3.5 h-3.5" style={{ color: tab === id ? AMBER : undefined }} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {tab === "sops" && <TabSOPs />}
          {tab === "scripts" && <TabScripts />}
          {tab === "pricing" && <TabPricing />}
          {tab === "checklists" && <TabChecklists />}
          {tab === "flows" && <TabFlows />}
          {tab === "faq" && <TabFAQ />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
