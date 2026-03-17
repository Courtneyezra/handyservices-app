/**
 * Quote Flow Diagram — Visual representation of the contextual quoting pipeline
 * Shows inputs → engine → deterministic rules → quote page output
 */

export default function QuoteFlowDiagram() {
  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 overflow-auto">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Contextual Quote Flow</h1>
        <p className="text-slate-400 mb-8">How inputs flow through the engine to produce a unique quote page</p>

        {/* ── INTAKE SOURCES ── */}
        <div className="mb-2">
          <SectionLabel>1. INTAKE SOURCE</SectionLabel>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <FlowBox color="blue" title="📞 Phone Call" items={[
            "VA takes call → call recorded",
            "Transcript auto-generated",
            "Call card appears in system",
            "Click 'Use All' or 'Customer Only'"
          ]} />
          <FlowBox color="blue" title="💬 WhatsApp Message" items={[
            "Customer sends message/videos",
            "VA reads & interprets",
            "Types job description manually",
            "May wait for videos before describing"
          ]} />
        </div>
        <Arrow />

        {/* ── DATA CAPTURED ── */}
        <div className="mb-2">
          <SectionLabel>2. DATA CAPTURED</SectionLabel>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <FlowBox color="green" title="Customer Details" subtitle="Auto-filled from call card or manual" items={[
            "Name",
            "Phone",
            "Address / Postcode",
          ]} />
          <FlowBox color="green" title="Job Description" subtitle="Free text — AI does the work" items={[
            "Written by VA or from transcript",
            "Can be brief or detailed",
            "Optional (VA may await videos)",
          ]} />
          <FlowBox color="amber" title="4 Manual Signals" subtitle="Only these — nothing else" items={[
            "Urgency: standard / priority / emergency",
            "Materials: we supply / customer / labour only",
            "Scheduling: weekday / evening / weekend",
            "Returning customer: yes / no",
          ]} />
        </div>
        <Arrow />

        {/* ── AI PARSER ── */}
        <div className="mb-2">
          <SectionLabel>3. AI JOB PARSER (GPT-4o-mini)</SectionLabel>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <FlowBox color="purple" title="Input: Free Text" subtitle="What the VA wrote" items={[
            '"Fix leaking kitchen tap, assemble IKEA wardrobe in bedroom, hang 3 floating shelves in living room"',
          ]} />
          <FlowBox color="purple" title="Output: Structured Line Items" subtitle="What the engine receives" items={[
            "Line 1: plumbing_minor — Fix leaking tap — 45min",
            "Line 2: flat_pack — Assemble IKEA wardrobe — 120min",
            "Line 3: shelving — Hang 3 floating shelves — 45min",
          ]} />
        </div>
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-4 text-sm text-purple-300">
          <strong>Guardrail:</strong> Parser must pick from 24 valid categories. Unknown → "other" + <span className="text-red-400 font-bold">requiresHumanReview = true</span>
        </div>
        <Arrow />

        {/* ── PRICING ENGINE ── */}
        <div className="mb-2">
          <SectionLabel>4. PRICING ENGINE (3 Layers)</SectionLabel>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <FlowBox color="cyan" title="L1: Reference Rates" subtitle="Deterministic" items={[
            "plumbing_minor → £42/hr",
            "flat_pack → £30/hr",
            "shelving → £32/hr",
            "Per-line: rate × time",
            "Minimum charge enforced",
          ]} />
          <FlowBox color="cyan" title="L3: LLM Pricing" subtitle="GPT-4o-mini adjusts" items={[
            "Sees all lines + signals",
            "Owner's experience in prompt",
            "Adjusts per-line prices",
            "Suggests batch discount %",
            "Single API call for all lines",
          ]} />
          <FlowBox color="cyan" title="L4: Guardrails" subtitle="Deterministic overrides" items={[
            "Floor: ≥ reference × 0.8",
            "Ceiling: ≤ reference × 2.0",
            "Min charge per category",
            "Margin ≥ 25%",
            "Batch discount ≤ 15%",
            "Returning customer ≤ 10%",
            "Psychological pricing (end in 9)",
          ]} />
        </div>
        <Arrow />

        {/* ── DETERMINISTIC DECISIONS ── */}
        <div className="mb-2">
          <SectionLabel>5. DETERMINISTIC DECISIONS (No LLM — Pure Code)</SectionLabel>
        </div>

        {/* Layout Tier */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-4">
          <h3 className="text-lg font-bold text-amber-400 mb-3">Layout Tier</h3>
          <div className="grid grid-cols-3 gap-3">
            <DecisionBox
              condition="1 line item"
              result="QUICK"
              details="Hero + single price + bullets + book"
              color="blue"
            />
            <DecisionBox
              condition="2-3 line items"
              result="STANDARD"
              details="Hero + job summary + line breakdown table + total + book"
              color="green"
            />
            <DecisionBox
              condition="4+ line items"
              result="COMPLEX"
              details="Hero + job summary + categorised sections + subtotals + batch discount + total + book"
              color="purple"
            />
          </div>
        </div>

        {/* Booking Modes */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-4">
          <h3 className="text-lg font-bold text-amber-400 mb-3">Booking Modes Shown</h3>
          <div className="grid grid-cols-2 gap-3">
            <DecisionBox
              condition="ALWAYS"
              result="📅 Standard Date"
              details="Customer picks a date — shown on every quote"
              color="green"
            />
            <DecisionBox
              condition="urgency=standard AND scheduling=weekday"
              result="💰 Flexible -10%"
              details="'Any date' discount to fill schedule gaps"
              color="amber"
            />
            <DecisionBox
              condition="urgency=priority OR emergency"
              result="⚡ Urgent Premium"
              details="Next-day / same-day priority slots"
              color="red"
            />
            <DecisionBox
              condition="total ≥ £150"
              result="💳 Deposit Split"
              details="Pay in instalments for bigger jobs"
              color="purple"
            />
          </div>
        </div>

        {/* Scarcity Banner */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-4">
          <h3 className="text-lg font-bold text-amber-400 mb-3">Scarcity Banner</h3>
          <div className="grid grid-cols-3 gap-3">
            <DecisionBox
              condition="urgency=standard"
              result="📅 Slate/calm"
              details="'12 slots left this week in NG5' — no pulse"
              color="slate"
            />
            <DecisionBox
              condition="urgency=priority"
              result="⚡ Amber/warm"
              details="'Priority slots filling fast' — pulsing dot"
              color="amber"
            />
            <DecisionBox
              condition="urgency=emergency"
              result="🚨 Red/urgent"
              details="'Emergency — booking you in today' — pulsing dot"
              color="red"
            />
          </div>
        </div>
        <Arrow />

        {/* ── LLM-GENERATED CONTENT ── */}
        <div className="mb-2">
          <SectionLabel>6. LLM-GENERATED CONTENT (From Approved Claims Only)</SectionLabel>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <FlowBox color="amber" title="Quote Page Content" subtitle="Selected from whitelist based on context" items={[
            'Headline: "Your Home Setup" / "Quick Tap Repair"',
            'Message: contextual 1-2 sentences',
            'Value bullets: 3-5 from ~20 approved claims',
            'Hassle comparison: with/without us pairs',
          ]} />
          <FlowBox color="amber" title="WhatsApp Message" subtitle="Pre-built, ready to send" items={[
            'Greeting: "Hi {name},"',
            'Context line from LLM',
            '2 value lines (from approved claims)',
            'Quote link',
            'Closing line',
          ]} />
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-sm text-amber-300">
          <strong>Guardrails:</strong> Banned phrases filter • Max bullet length 60 chars • No exclamation marks • Schema validation • Fallback to defaults if validation fails
        </div>
        <Arrow />

        {/* ── FINAL OUTPUT ── */}
        <div className="mb-2">
          <SectionLabel>7. QUOTE PAGE — THE CUSTOMER SEES</SectionLabel>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-8">
          <div className="grid grid-cols-1 gap-1 text-sm">
            <PageSection name="Scarcity Banner" source="Deterministic" desc="Based on urgency signal" />
            <PageSection name="Hero + Customer Name" source="Deterministic + LLM" desc="Layout from tier, headline/message from LLM" />
            <PageSection name="Job Summary Card" source="AI Parser" desc="Natural language summary of line items" />
            <PageSection name="Social Proof" source="Static" desc="Google rating, insurance badge, review count" />
            <PageSection name="Hassle Comparison" source="LLM" desc="With/without us from approved claims, or generic defaults" />
            <PageSection name="Price Breakdown" source="Pricing Engine" desc="Per-line or single price based on layout tier" />
            <PageSection name="Value Bullets" source="LLM" desc="3-5 claims selected from whitelist" />
            <PageSection name="Guarantee" source="Static" desc="'Not right? We return and fix it free'" />
            <PageSection name="Booking Widget" source="Deterministic" desc="Date picker + conditional: flexible/-10%, urgent, deposit split" />
            <PageSection name="Trust Strip" source="Static" desc="£2M Insured • 4.9★ Google • Fixed Price" />
          </div>
        </div>

        {/* ── COMBINATION MATRIX ── */}
        <div className="mb-2">
          <SectionLabel>COMBINATION EXAMPLES</SectionLabel>
        </div>
        <div className="grid grid-cols-1 gap-4 mb-8">
          <CombinationExample
            title="Emergency Plumbing — Single Job"
            inputs="1 line • emergency • we supply • weekday • new customer"
            layout="QUICK"
            banner="🚨 Red — emergency"
            booking={["📅 Standard date", "⚡ Urgent premium"]}
            notShown={["💰 Flexible -10%", "💳 Deposit split"]}
            headline="Quick Tap Repair"
          />
          <CombinationExample
            title="3 Mixed Jobs — Standard"
            inputs="3 lines • standard • labour only • weekday • new customer"
            layout="STANDARD"
            banner="📅 Slate — calm"
            booking={["📅 Standard date", "💰 Flexible -10%"]}
            notShown={["⚡ Urgent premium", "💳 Deposit split"]}
            headline="Your Home Setup"
          />
          <CombinationExample
            title="5 Jobs — Weekend — Big Spend"
            inputs="5 lines • standard • we supply • weekend • new customer • £456"
            layout="COMPLEX"
            banner="📅 Slate — calm"
            booking={["📅 Standard date", "💳 Deposit split"]}
            notShown={["💰 Flexible -10% (weekend selected)", "⚡ Urgent premium"]}
            headline="Home Improvements Made Easy"
          />
          <CombinationExample
            title="Returning Customer — Priority"
            inputs="2 lines • priority • customer supplies • weekday • returning (10 prev jobs)"
            layout="STANDARD"
            banner="⚡ Amber — priority"
            booking={["📅 Standard date", "⚡ Urgent premium"]}
            notShown={["💰 Flexible -10% (priority urgency)", "💳 Deposit split (< £150)"]}
            headline="Welcome Back — Shelves & Sealant"
          />
        </div>

        {/* ── KEY PRINCIPLE ── */}
        <div className="bg-gradient-to-r from-amber-500/20 to-green-500/20 border border-amber-500/30 rounded-xl p-6 mb-8 text-center">
          <p className="text-2xl font-bold text-white mb-2">1 adaptive template, infinite combinations</p>
          <p className="text-slate-300">
            LLM picks <span className="text-amber-400 font-semibold">content</span> (from approved lists).
            Code picks <span className="text-green-400 font-semibold">structure</span> (layout, booking, banner).
            Neither can override the other.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Helper Components ──

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block bg-slate-800 text-xs font-bold tracking-widest text-slate-400 px-3 py-1 rounded-full uppercase">
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center my-3">
      <div className="w-0.5 h-8 bg-slate-600 relative">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-transparent border-t-slate-600" />
      </div>
    </div>
  );
}

const colorMap: Record<string, { bg: string; border: string; title: string }> = {
  blue: { bg: 'bg-blue-500/5', border: 'border-blue-500/30', title: 'text-blue-400' },
  green: { bg: 'bg-green-500/5', border: 'border-green-500/30', title: 'text-green-400' },
  amber: { bg: 'bg-amber-500/5', border: 'border-amber-500/30', title: 'text-amber-400' },
  purple: { bg: 'bg-purple-500/5', border: 'border-purple-500/30', title: 'text-purple-400' },
  cyan: { bg: 'bg-cyan-500/5', border: 'border-cyan-500/30', title: 'text-cyan-400' },
  red: { bg: 'bg-red-500/5', border: 'border-red-500/30', title: 'text-red-400' },
  slate: { bg: 'bg-slate-500/5', border: 'border-slate-500/30', title: 'text-slate-400' },
};

function FlowBox({ color, title, subtitle, items }: { color: string; title: string; subtitle?: string; items: string[] }) {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4`}>
      <h3 className={`font-bold ${c.title} mb-1`}>{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mb-2">{subtitle}</p>}
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
            <span className="text-slate-600 mt-0.5">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionBox({ condition, result, details, color }: { condition: string; result: string; details: string; color: string }) {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className={`${c.bg} border ${c.border} rounded-lg p-3`}>
      <p className="text-xs text-slate-500 mb-1 font-mono">IF {condition}</p>
      <p className={`font-bold ${c.title} text-sm mb-1`}>{result}</p>
      <p className="text-xs text-slate-400">{details}</p>
    </div>
  );
}

function PageSection({ name, source, desc }: { name: string; source: string; desc: string }) {
  const sourceColor = source === 'Deterministic' ? 'text-green-400'
    : source === 'LLM' ? 'text-amber-400'
    : source === 'Static' ? 'text-slate-400'
    : source === 'AI Parser' ? 'text-purple-400'
    : source === 'Pricing Engine' ? 'text-cyan-400'
    : 'text-slate-300';

  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-700/50 last:border-0">
      <div className="w-48 font-medium text-white">{name}</div>
      <div className={`w-36 text-xs font-mono ${sourceColor}`}>{source}</div>
      <div className="flex-1 text-slate-400 text-xs">{desc}</div>
    </div>
  );
}

function CombinationExample({ title, inputs, layout, banner, booking, notShown, headline }: {
  title: string;
  inputs: string;
  layout: string;
  banner: string;
  booking: string[];
  notShown: string[];
  headline: string;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-bold text-white text-lg">{title}</h3>
          <p className="text-xs text-slate-500 font-mono">{inputs}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded ${
          layout === 'QUICK' ? 'bg-blue-500/20 text-blue-400' :
          layout === 'STANDARD' ? 'bg-green-500/20 text-green-400' :
          'bg-purple-500/20 text-purple-400'
        }`}>{layout}</span>
      </div>
      <div className="grid grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs text-slate-500 mb-1">Banner</p>
          <p className="text-slate-300">{banner}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Headline</p>
          <p className="text-amber-400 font-medium">{headline}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Booking Shown</p>
          {booking.map((b, i) => <p key={i} className="text-green-400">{b}</p>)}
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Not Shown</p>
          {notShown.map((b, i) => <p key={i} className="text-red-400/60 line-through">{b}</p>)}
        </div>
      </div>
    </div>
  );
}
