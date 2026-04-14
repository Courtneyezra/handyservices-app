import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  PoundSterling,
  Briefcase,
  TrendingUp,
  Clock,
  Users,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Calculator,
  BarChart3,
  Package,
  Wrench,
  Info,
  Target,
  Repeat,
  CalendarDays,
  ArrowRightLeft,
  Gauge,
  Snowflake,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CategoryDetail {
  revenue: number;
  labour: number;
  materials: number;
  hours: number;
  count: number;
  revenuePerHour: number;
}

interface BusinessMetrics {
  totalJobs: number;
  totalQuotes: number;
  totalQuotesUnfiltered: number;
  totalRealAll: number;
  conversionRate: number;
  quotesWithLineItems: number;
  quotesWithoutLineItems: number;
  totalRevenue: number;
  totalLabour: number;
  totalMaterialsSell: number;
  totalMaterialsCost: number;
  materialsMargin: number;
  materialsMarkupPercent: number;
  totalHours: number;
  avgJobValue: number;
  avgHourlyRate: number;
  categoryDetail: Record<string, CategoryDetail>;
  segmentCount: Record<string, number>;
  monthlyTrend: { month: string; jobs: number; revenue: number }[];
  actualMonthlyRunRate: { jobs: number; revenue: number };
  avgQuotedValue: number;
  avgBookedValue: number;
  avgDiscount: number;
  discountPercent: number;
  uniqueCustomers: number;
  repeatCustomers: number;
  repeatRate: number;
  firstBookedAt: string | null;
  lastBookedAt: string | null;
  sweetSpots: {
    priceBands: DimBucket[];
    viewBands: DimBucket[];
    layoutTiers: DimBucket[];
    categoryConversion: DimBucket[];
    timeToBook: { name: string; hours: number; price: number }[];
  };
  period: string;
  periodStart: string | null;
  periodEnd: string | null;
}

interface DimBucket {
  label: string;
  total: number;
  booked: number;
  rate: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(value: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}
function fmtDec(value: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function pct(value: number): string { return `${Math.round(value)}%`; }

const BRAND_GREEN = "#7DB00E";

const CATEGORY_COLOURS: Record<string, string> = {
  painting: "#7DB00E", general_fixing: "#3B82F6", carpentry: "#F59E0B",
  silicone_sealant: "#8B5CF6", electrical_minor: "#EF4444", curtain_blinds: "#EC4899",
  fencing: "#14B8A6", plumbing: "#06B6D4", plumbing_minor: "#06B6D4",
  mounting: "#F97316", uncategorised: "#EF4444", other: "#6B7280",
};
function getCategoryColour(cat: string): string { return CATEGORY_COLOURS[cat] || "#6B7280"; }
function prettyCat(cat: string): string {
  if (cat === "uncategorised") return "⚠️ Uncategorised";
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function prettyMonth(m: string): string {
  const [y, mo] = m.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[parseInt(mo) - 1]} ${y.slice(2)}`;
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, sub, accent }: {
  label: string; value: string; icon: React.ElementType; sub?: string; accent?: string;
}) {
  const colour = accent || BRAND_GREEN;
  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg" style={{ backgroundColor: `${colour}20` }}>
            <Icon className="h-5 w-5" style={{ color: colour }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
            <p className="text-xl font-bold text-white truncate">{value}</p>
            {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Category Bar ────────────────────────────────────────────────────────────

function CategoryBar({ data }: {
  data: { label: string; revenue: number; labour: number; materials: number; hours: number; count: number; colour: string; revenuePerHour: number }[];
}) {
  const maxValue = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.label}>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 truncate text-right">{prettyCat(item.label)}</span>
            <div className="flex-1 bg-gray-800 rounded-full h-6 overflow-hidden relative">
              <div className="h-full rounded-full absolute left-0 top-0" style={{ width: `${(item.revenue / maxValue) * 100}%`, backgroundColor: item.colour, opacity: 0.9, minWidth: item.revenue > 0 ? "4px" : "0" }} />
            </div>
            <div className="text-right w-20">
              <span className="text-xs text-gray-300 font-mono font-semibold">{fmt(item.revenue)}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="w-32" />
            <div className="flex-1 flex flex-wrap gap-x-3 text-[10px] text-gray-500">
              <span>{item.count} job{item.count !== 1 ? "s" : ""}</span>
              <span>•</span>
              <span>{fmt(item.labour)} labour</span>
              {item.materials > 0 && <><span>•</span><span>{fmt(item.materials)} materials</span></>}
              {item.hours > 0 && <><span>•</span><span>{item.hours.toFixed(1)}hrs</span></>}
              {item.revenuePerHour > 0 && <><span>•</span><span className="text-green-400 font-semibold">{fmtDec(item.revenuePerHour)}/hr</span></>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Monthly Trend Bar ──────────────────────────────────────────────────────

function MonthlyTrendChart({ data }: { data: { month: string; jobs: number; revenue: number }[] }) {
  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.month} className="flex items-center gap-3">
          <span className="text-xs text-gray-400 w-16 text-right font-mono">{prettyMonth(item.month)}</span>
          <div className="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(item.revenue / maxRev) * 100}%`, backgroundColor: BRAND_GREEN, minWidth: item.revenue > 0 ? "4px" : "0" }} />
          </div>
          <span className="text-xs text-gray-300 font-mono w-16 text-right">{fmt(item.revenue)}</span>
          <span className="text-[10px] text-gray-500 w-14 text-right">{item.jobs} job{item.jobs !== 1 ? "s" : ""}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Profit Waterfall (SVG) ──────────────────────────────────────────────────

interface WaterfallData {
  revenue: number;
  materialsCost: number;
  contractorCost: number;
  benCost: number;
  ownerSalary: number;
  otherOverheads: number;
  netProfit: number;
}

function ProfitWaterfall({ data }: { data: WaterfallData }) {
  const W = 880, H = 400, PAD_L = 70, PAD_R = 30, PAD_T = 40, PAD_B = 100;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  type StepType = "start" | "cost" | "end";
  interface Step { label: string; amount: number; type: StepType; top: number; bottom: number; }
  const rawSteps: { label: string; amount: number; type: StepType }[] = [
    { label: "Revenue", amount: data.revenue, type: "start" },
    { label: "Materials Cost", amount: data.materialsCost, type: "cost" },
    { label: "Contractor", amount: data.contractorCost, type: "cost" },
    { label: "Ben", amount: data.benCost, type: "cost" },
    { label: "Your Salary", amount: data.ownerSalary, type: "cost" },
    { label: "Overheads", amount: data.otherOverheads, type: "cost" },
    { label: "Net Profit", amount: data.netProfit, type: "end" },
  ];

  let running = 0;
  const steps: Step[] = [];
  for (const s of rawSteps) {
    if (s.type === "start") {
      steps.push({ ...s, top: data.revenue, bottom: 0 });
      running = data.revenue;
    } else if (s.type === "cost") {
      const newRunning = running - s.amount;
      steps.push({ ...s, top: running, bottom: newRunning });
      running = newRunning;
    } else {
      steps.push({ ...s, top: Math.max(data.netProfit, 0), bottom: Math.min(data.netProfit, 0) });
    }
  }

  const maxVal = Math.max(data.revenue, 0);
  const minVal = Math.min(0, ...steps.map((s) => s.bottom));
  const range = (maxVal - minVal) || 1;
  const y = (v: number) => PAD_T + chartH - ((v - minVal) / range) * chartH;

  const slot = chartW / steps.length;
  const barW = slot * 0.58;
  const cx = (i: number) => PAD_L + slot * i + slot / 2;
  const barX = (i: number) => cx(i) - barW / 2;

  const yTicks = 5;
  const yStep = range / yTicks;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 700 }}>
        {/* Grid lines */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = minVal + yStep * i;
          const yPos = y(val);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={yPos} x2={W - PAD_R} y2={yPos} stroke="#374151" strokeWidth={0.5} />
              <text x={PAD_L - 8} y={yPos + 4} textAnchor="end" fill="#6B7280" fontSize={10} fontFamily="monospace">
                {val >= 1000 ? `£${(val / 1000).toFixed(1)}k` : `£${Math.round(val)}`}
              </text>
            </g>
          );
        })}

        {/* Zero line */}
        {minVal < 0 && (
          <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="3,3" />
        )}

        {/* Bars + connectors */}
        {steps.map((s, i) => {
          const top = Math.max(s.top, s.bottom);
          const bottom = Math.min(s.top, s.bottom);
          const barHeight = Math.max(y(bottom) - y(top), 2);
          const isProfitable = data.netProfit >= 0;
          const color = s.type === "start" ? BRAND_GREEN
            : s.type === "cost" ? "#EF4444"
            : (isProfitable ? "#10B981" : "#EF4444");
          const pctOfRev = data.revenue > 0 ? (s.amount / data.revenue) * 100 : 0;
          const signedAmount = s.type === "cost" ? -s.amount : s.amount;
          const connectorY = s.type === "start" ? y(s.top) : s.type === "cost" ? y(s.bottom) : y(0);

          return (
            <g key={s.label}>
              {i < steps.length - 1 && (
                <line x1={barX(i) + barW} y1={connectorY} x2={barX(i + 1)} y2={connectorY}
                  stroke="#6B7280" strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
              )}

              <rect x={barX(i)} y={y(top)} width={barW} height={barHeight}
                fill={color} opacity={0.85} rx={3} />

              {/* Value label above bar */}
              <text x={cx(i)} y={y(top) - 8} textAnchor="middle" fill="#fff"
                fontSize={12} fontFamily="monospace" fontWeight={600}>
                {signedAmount >= 0 ? fmt(signedAmount) : `−${fmt(Math.abs(signedAmount))}`}
              </text>

              {/* % inside bar */}
              {barHeight > 28 && (
                <text x={cx(i)} y={y(top) + barHeight / 2 + 4} textAnchor="middle"
                  fill="#fff" fontSize={11} fontFamily="monospace" opacity={0.8}>
                  {pctOfRev.toFixed(0)}%
                </text>
              )}

              {/* Label under axis */}
              <text x={cx(i)} y={H - PAD_B + 22} textAnchor="middle" fill="#D1D5DB" fontSize={11}>
                {s.label}
              </text>
              {s.type === "cost" && (
                <text x={cx(i)} y={H - PAD_B + 38} textAnchor="middle" fill="#6B7280" fontSize={9}>
                  {pctOfRev.toFixed(0)}% of rev
                </text>
              )}
              {s.type === "end" && (
                <text x={cx(i)} y={H - PAD_B + 38} textAnchor="middle"
                  fill={isProfitable ? "#10B981" : "#EF4444"} fontSize={9} fontWeight={600}>
                  {pctOfRev.toFixed(1)}% margin
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Sensitivity Tornado (SVG) ───────────────────────────────────────────────

interface TornadoVar {
  label: string;
  lowDelta: number;
  highDelta: number;
  maxAbs: number;
}

function SensitivityTornado({ data, baseProfit }: { data: TornadoVar[]; baseProfit: number }) {
  const W = 820, rowH = 48, PAD_L = 180, PAD_R = 120, PAD_TOP = 55, PAD_BOTTOM = 30;
  const H = PAD_TOP + PAD_BOTTOM + data.length * rowH;
  const chartW = W - PAD_L - PAD_R;
  const center = PAD_L + chartW / 2;
  const halfW = chartW / 2;

  const globalMax = Math.max(...data.map((d) => d.maxAbs), 1);
  const scale = (halfW - 30) / globalMax;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 650 }}>
        {/* Header */}
        <text x={center} y={22} textAnchor="middle" fill="#D1D5DB" fontSize={12} fontWeight={600}>
          Profit impact of ±20% movement · Base: {fmt(baseProfit)}/mo
        </text>
        <text x={PAD_L + 6} y={42} textAnchor="start" fill="#EF4444" fontSize={10} fontWeight={600}>
          ← worse
        </text>
        <text x={W - PAD_R - 6} y={42} textAnchor="end" fill="#10B981" fontSize={10} fontWeight={600}>
          better →
        </text>

        {/* Center line */}
        <line x1={center} y1={PAD_TOP - 6} x2={center} y2={H - PAD_BOTTOM + 4}
          stroke="#9CA3AF" strokeWidth={1.5} />

        {data.map((v, i) => {
          const y = PAD_TOP + i * rowH + rowH / 2;
          const barH = rowH * 0.5;

          const leftDelta = Math.min(v.lowDelta, v.highDelta);
          const rightDelta = Math.max(v.lowDelta, v.highDelta);
          const leftX = center + leftDelta * scale;
          const rightX = center + rightDelta * scale;
          const lowIsLeft = v.lowDelta < v.highDelta;

          return (
            <g key={v.label}>
              {/* Row label */}
              <text x={PAD_L - 12} y={y + 2} textAnchor="end" fill="#E5E7EB"
                fontSize={12} fontWeight={600}>
                {v.label}
              </text>
              <text x={PAD_L - 12} y={y + 16} textAnchor="end" fill="#6B7280" fontSize={9}>
                {lowIsLeft ? "−20% ← → +20%" : "+20% ← → −20%"}
              </text>

              {/* Red segment (negative impact) */}
              {leftDelta < 0 && (
                <rect x={leftX} y={y - barH / 2} width={Math.max(center - leftX, 1)} height={barH}
                  fill="#EF4444" opacity={0.85} rx={3} />
              )}
              {/* Green segment (positive impact) */}
              {rightDelta > 0 && (
                <rect x={center} y={y - barH / 2} width={Math.max(rightX - center, 1)} height={barH}
                  fill="#10B981" opacity={0.85} rx={3} />
              )}

              {/* Left value label */}
              {leftDelta < 0 && (
                <text x={leftX - 6} y={y + 4} textAnchor="end" fill="#F87171"
                  fontSize={10} fontFamily="monospace" fontWeight={600}>
                  {fmt(leftDelta)}
                </text>
              )}
              {/* Right value label */}
              {rightDelta > 0 && (
                <text x={rightX + 6} y={y + 4} textAnchor="start" fill="#34D399"
                  fontSize={10} fontFamily="monospace" fontWeight={600}>
                  +{fmt(rightDelta)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Labelled Slider ─────────────────────────────────────────────────────────

function LabelledSlider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-semibold">{format(value)}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)}
        className="[&_[role=slider]]:bg-[#7DB00E] [&_[role=slider]]:border-[#7DB00E] [&_.range]:bg-[#7DB00E]" />
    </div>
  );
}

// ─── Break-Even Curve (SVG) ──────────────────────────────────────────────────

function BreakEvenCurve({
  monthlyHoursPerPerson, contributionPerHour, businessOverheadsExOwner, handymanCost,
  currentUtilisation, currentTeamSize, currentOwnerDraw, fairMarketWage,
}: {
  monthlyHoursPerPerson: number;
  contributionPerHour: number;
  businessOverheadsExOwner: number;
  handymanCost: number;
  currentUtilisation: number;
  currentTeamSize: number;
  currentOwnerDraw: number;
  fairMarketWage: number;
}) {
  const W = 640, H = 340, PAD_L = 70, PAD_R = 20, PAD_T = 20, PAD_B = 50;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // Build 3 curves for 1/2/3 handymen, NET BEFORE OWNER DRAW as function of utilisation
  // Curve = gross contribution − (business overheads ex owner + handymen)
  // The two reference lines show what that net must exceed to pay the owner.
  const teamSizes = [1, 2, 3];
  const colours = ["#7DB00E", "#3B82F6", "#F59E0B"];

  const profitAt = (team: number, util: number) => {
    const hoursWorked = team * monthlyHoursPerPerson * (util / 100) * 12;
    const gross = hoursWorked * contributionPerHour;
    const fixed = businessOverheadsExOwner + (handymanCost * team);
    return gross - fixed; // net BEFORE owner draw
  };

  const curves = teamSizes.map((team, i) => {
    const points = [];
    for (let u = 0; u <= 120; u += 5) {
      points.push({ u, profit: profitAt(team, u) });
    }
    return { team, colour: colours[i], points };
  });

  const allProfits = curves.flatMap((c) => c.points.map((p) => p.profit));
  const maxProfit = Math.max(...allProfits, fairMarketWage, currentOwnerDraw, 50000);
  const minProfit = Math.min(...allProfits, -50000);
  const range = (maxProfit - minProfit) || 1;

  const x = (u: number) => PAD_L + (u / 120) * chartW;
  const y = (p: number) => PAD_T + chartH - ((p - minProfit) / range) * chartH;

  const yTicks = 5;
  const yStep = range / yTicks;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 500 }}>
        {/* Grid */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = minProfit + yStep * i;
          const yp = y(v);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={yp} x2={W - PAD_R} y2={yp} stroke="#374151" strokeWidth={0.5} />
              <text x={PAD_L - 8} y={yp + 4} textAnchor="end" fill="#6B7280" fontSize={9} fontFamily="monospace">
                {v >= 0 ? `£${Math.round(v / 1000)}k` : `-£${Math.round(Math.abs(v) / 1000)}k`}
              </text>
            </g>
          );
        })}

        {/* Zero line — business break-even (covers fixed floor, owner paid £0) */}
        <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="3,3" />
        <text x={W - PAD_R - 4} y={y(0) - 3} textAnchor="end" fill="#9CA3AF" fontSize={9}>business B/E (owner £0)</text>

        {/* Current owner draw line — solid purple */}
        {currentOwnerDraw > 0 && currentOwnerDraw >= minProfit && currentOwnerDraw <= maxProfit && (
          <>
            <line x1={PAD_L} y1={y(currentOwnerDraw)} x2={W - PAD_R} y2={y(currentOwnerDraw)} stroke="#A855F7" strokeWidth={1.5} opacity={0.85} />
            <text x={W - PAD_R - 4} y={y(currentOwnerDraw) - 3} textAnchor="end" fill="#A855F7" fontSize={9}>your draw ({fmt(currentOwnerDraw)})</text>
          </>
        )}

        {/* Fair market wage line — dashed amber */}
        {fairMarketWage > 0 && fairMarketWage >= minProfit && fairMarketWage <= maxProfit && (
          <>
            <line x1={PAD_L} y1={y(fairMarketWage)} x2={W - PAD_R} y2={y(fairMarketWage)} stroke="#F59E0B" strokeWidth={1} strokeDasharray="4,4" opacity={0.8} />
            <text x={W - PAD_R - 4} y={y(fairMarketWage) - 3} textAnchor="end" fill="#F59E0B" fontSize={9}>fair market ({fmt(fairMarketWage)})</text>
          </>
        )}

        {/* X axis ticks */}
        {[0, 25, 50, 75, 100, 120].map((u) => (
          <g key={u}>
            <line x1={x(u)} y1={PAD_T + chartH} x2={x(u)} y2={PAD_T + chartH + 4} stroke="#6B7280" strokeWidth={1} />
            <text x={x(u)} y={PAD_T + chartH + 16} textAnchor="middle" fill="#9CA3AF" fontSize={10} fontFamily="monospace">{u}%</text>
          </g>
        ))}
        <text x={PAD_L + chartW / 2} y={H - 8} textAnchor="middle" fill="#9CA3AF" fontSize={11}>Utilisation %</text>

        {/* Curves */}
        {curves.map((c) => {
          const path = c.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.u)} ${y(p.profit)}`).join(" ");
          return (
            <g key={c.team}>
              <path d={path} fill="none" stroke={c.colour} strokeWidth={2} />
              {/* End label */}
              <text
                x={x(120) + 4}
                y={y(c.points[c.points.length - 1].profit) + 4}
                fill={c.colour}
                fontSize={10}
                fontWeight="bold"
              >
                {c.team}H
              </text>
            </g>
          );
        })}

        {/* Current position marker */}
        {currentTeamSize >= 1 && currentTeamSize <= 3 && (
          <g>
            <circle
              cx={x(Math.min(120, currentUtilisation))}
              cy={y(profitAt(currentTeamSize, Math.min(120, currentUtilisation)))}
              r={6}
              fill="#FFFFFF"
              stroke={colours[currentTeamSize - 1]}
              strokeWidth={2}
            />
            <text
              x={x(Math.min(120, currentUtilisation))}
              y={y(profitAt(currentTeamSize, Math.min(120, currentUtilisation))) - 12}
              textAnchor="middle"
              fill="#FFFFFF"
              fontSize={10}
              fontWeight="bold"
            >
              YOU
            </text>
          </g>
        )}
      </svg>
      <div className="flex gap-4 justify-center mt-1 text-[10px] flex-wrap">
        {curves.map((c) => (
          <div key={c.team} className="flex items-center gap-1">
            <div className="w-3 h-0.5" style={{ backgroundColor: c.colour }} />
            <span className="text-gray-400">{c.team} handyman{c.team > 1 ? "men" : ""}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5" style={{ backgroundColor: "#9CA3AF" }} />
          <span className="text-gray-400">business B/E</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5" style={{ backgroundColor: "#A855F7" }} />
          <span className="text-gray-400">your draw</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5" style={{ backgroundColor: "#F59E0B" }} />
          <span className="text-gray-400">fair market £45k</span>
        </div>
      </div>
    </div>
  );
}

// ─── Verdict Row ─────────────────────────────────────────────────────────────

function VerdictRow({ label, status, detail }: {
  label: string;
  status: "green" | "amber" | "red";
  detail: string;
}) {
  const colour = status === "green" ? "text-green-400" : status === "amber" ? "text-amber-400" : "text-red-400";
  const bg = status === "green" ? "bg-green-500" : status === "amber" ? "bg-amber-500" : "bg-red-500";
  const icon = status === "green" ? "✓" : status === "amber" ? "⚠" : "✗";
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={`w-5 h-5 rounded-full ${bg}/20 flex items-center justify-center flex-shrink-0`}>
        <span className={colour}>{icon}</span>
      </div>
      <span className="text-gray-300 font-semibold flex-1">{label}</span>
      <span className={`font-mono ${colour}`}>{detail}</span>
    </div>
  );
}

// ─── Model Card ──────────────────────────────────────────────────────────────

interface ModelCapacity {
  capacity: number;        // realistic jobs/mo the team can deliver
  demand: number;          // current monthly job demand
  jobsByEmployee: number;  // min(demand, capacity)
  idleSlots: number;       // capacity - jobsByEmployee (0 if over)
  overflowJobs: number;    // demand - capacity (0 if under)
  utilisation: number;     // demandHours / productiveHours * 100
  costPerEmpJob: number;   // team cost / jobsByEmployee
  employedCostPerMonth: number;
  // Hours-based
  productiveHours: number;       // TEAM monthly workable hours (per-person × team size)
  productiveHoursPerPerson: number; // for labelling
  demandHours: number;           // from labour revenue ÷ customer charge rate
  hoursByEmployee: number;       // min(demand, capacity) hrs delivered
  idleHours: number;             // productive - worked
  overflowHours: number;         // demandHours - productive
  avgHoursPerJob: number;        // derived: avgLabourPerJob ÷ customer charge rate
  costPerHour: number;           // £/productive hour across team
  numHandymen: number;           // team size driving this capacity
  recommendedHandymen: number;   // what the model says you need
}

interface ModelResult {
  title: string; description: string; annualRevenue: number; contractorCost: number;
  estimatorCommission: number; materialsProfit: number; overheads: number;
  netProfit: number; profitMargin: number; recommended?: boolean;
  capacity?: ModelCapacity;
}

function ModelCard({ model }: { model: ModelResult }) {
  const positive = model.netProfit >= 0;
  const monthlyProfit = model.netProfit / 12;
  return (
    <Card className={`flex flex-col ${model.recommended ? "bg-green-950/20 border-green-800/50" : "bg-gray-900 border-gray-800"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base text-white">{model.title}</CardTitle>
          {model.recommended && <Badge className="bg-green-900/50 text-green-400 text-[10px]">BEST</Badge>}
        </div>
        <CardDescription className="text-xs">{model.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 flex-1">
        <Row label="Annual Revenue" value={fmt(model.annualRevenue)} />
        <Row label="Contractor/Labour Cost" value={fmt(model.contractorCost)} negative />
        <Row label={`Ben (estimator) — ${fmt(model.estimatorCommission / 12)}/mo`} value={fmt(model.estimatorCommission)} negative />
        <Row label="Overheads" value={fmt(model.overheads)} negative />
        <Row label="Materials Profit" value={`+ ${fmt(model.materialsProfit)}`} highlight="blue" />
        <div className="border-t border-gray-700 pt-3 mt-3">
          <Row label="Net Profit /year" value={fmt(model.netProfit)} bold highlight={positive ? "green" : "red"} />
          <Row label="Net Profit /month" value={fmt(monthlyProfit)} bold highlight={positive ? "green" : "red"} />
          <Row label="Profit Margin" value={pct(model.profitMargin)} bold highlight={positive ? "green" : "red"} />
        </div>

        {model.capacity && <CapacityBlock cap={model.capacity} />}
      </CardContent>
    </Card>
  );
}

function CapacityBlock({ cap }: { cap: ModelCapacity }) {
  const overCapacity = cap.utilisation > 100;
  const nearMax = cap.utilisation >= 90 && cap.utilisation <= 100;
  const healthy = cap.utilisation >= 60 && cap.utilisation < 90;
  const barColour = overCapacity ? "#EF4444" : nearMax ? "#F59E0B" : healthy ? BRAND_GREEN : "#6B7280";
  const utilColour = overCapacity ? "text-red-400" : nearMax ? "text-amber-400" : healthy ? "text-green-400" : "text-gray-400";
  const teamLabel = cap.numHandymen === 1 ? "1 handyman" : `${cap.numHandymen} handymen`;
  const needsMoreTeam = cap.recommendedHandymen > cap.numHandymen;
  const hasSpareTeam = cap.recommendedHandymen < cap.numHandymen;
  const idleCostBurn = cap.productiveHours > 0
    ? Math.round(cap.employedCostPerMonth - (Math.min(cap.demandHours, cap.productiveHours) * cap.costPerHour))
    : 0;

  return (
    <div className="border-t border-gray-700 pt-3 mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1.5">
          <Gauge className="h-3 w-3" />
          Capacity — {teamLabel}
        </p>
        <span className={`text-xs font-mono font-bold ${utilColour}`}>
          {pct(cap.utilisation)}
        </span>
      </div>

      {/* Utilisation bar */}
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, cap.utilisation)}%`,
            backgroundColor: barColour,
          }}
        />
        {overCapacity && (
          <div
            className="h-full absolute top-0 right-0 bg-red-500/40 animate-pulse"
            style={{ width: `${Math.min(100, cap.utilisation - 100)}%` }}
          />
        )}
      </div>

      {/* Team capacity derivation */}
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">Team hours</span>
        <span className="font-mono text-gray-300">
          {cap.numHandymen}
          <span className="text-gray-500"> × </span>
          {cap.productiveHoursPerPerson}h
          <span className="text-gray-500"> = </span>
          <span className="text-white">{cap.productiveHours}h</span>
        </span>
      </div>

      {/* HOURS — primary metric */}
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">Hours worked / available</span>
        <span className="font-mono text-white">
          {Math.round(Math.min(cap.demandHours, cap.productiveHours))}h / {cap.productiveHours}h
        </span>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">Equivalent jobs</span>
        <span className="font-mono text-gray-300">
          {cap.jobsByEmployee} / {cap.capacity} jobs
          <span className="text-gray-500"> (@ ~{cap.avgHoursPerJob.toFixed(1)}h/job)</span>
        </span>
      </div>

      {cap.idleHours > 0 && (
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Idle time</span>
          <span className="font-mono text-amber-400">
            {Math.round(cap.idleHours)}h/mo unused
          </span>
        </div>
      )}
      {cap.overflowHours > 0 && (
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Over capacity</span>
          <span className="font-mono text-red-400">
            +{Math.round(cap.overflowHours)}h/mo ({cap.overflowJobs} jobs)
          </span>
        </div>
      )}

      <div className="flex justify-between text-xs">
        <span className="text-gray-400">Cost /productive hour</span>
        <span className="font-mono text-gray-300">{fmtDec(cap.costPerHour)}</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">Team cost /mo</span>
        <span className="font-mono text-gray-300">{fmt(cap.employedCostPerMonth)}</span>
      </div>

      {/* Hiring recommendation */}
      {needsMoreTeam && (
        <div className="bg-red-950/30 border border-red-900/40 rounded px-2 py-1.5 text-[10px] text-red-300 flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>
            Need <b>{cap.recommendedHandymen} handymen</b> to cover {Math.round(cap.demandHours)}h demand.
            Add <b>{cap.recommendedHandymen - cap.numHandymen}</b> more.
          </span>
        </div>
      )}
      {hasSpareTeam && (
        <div className="bg-amber-950/30 border border-amber-900/40 rounded px-2 py-1.5 text-[10px] text-amber-300 flex items-start gap-1.5">
          <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>
            Overstaffed: {cap.recommendedHandymen} handymen would cover current demand.
            You're paying for {cap.numHandymen - cap.recommendedHandymen} extra.
          </span>
        </div>
      )}

      <p className="text-[10px] text-gray-500 leading-tight pt-1">
        {overCapacity
          ? `⚠ Demand ${Math.round(cap.demandHours)}h exceeds team capacity ${cap.productiveHours}h. ${Math.round(cap.overflowHours)}h/mo need overflow contractors.`
          : nearMax
          ? `✓ Near full team utilisation — sweet spot for ${teamLabel}.`
          : healthy
          ? `Good team utilisation. ${teamLabel} earning ${fmt(cap.employedCostPerMonth)}/mo.`
          : `⚠ Only ${Math.round(Math.min(cap.demandHours, cap.productiveHours))}h billable of ${cap.productiveHours}h paid. ~${fmt(Math.max(0, idleCostBurn))}/mo burnt on idle time.`}
      </p>
    </div>
  );
}

function Row({ label, value, bold, negative, highlight }: {
  label: string; value: string; bold?: boolean; negative?: boolean; highlight?: "green" | "red" | "blue";
}) {
  const colour = highlight === "green" ? "text-green-400" : highlight === "red" ? "text-red-400" : highlight === "blue" ? "text-blue-400" : negative ? "text-gray-400" : "text-gray-300";
  return (
    <div className="flex justify-between text-sm">
      <span className={bold ? "font-semibold text-gray-200" : "text-gray-400"}>{label}</span>
      <span className={`font-mono ${bold ? "font-bold" : ""} ${colour}`}>{negative && !value.startsWith("-") ? `- ${value}` : value}</span>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

const PERIODS = [
  { key: "all", label: "All Time" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "7d", label: "Last 7 Days" },
] as const;

export default function BusinessModelDashboard() {
  const [period, setPeriod] = useState<string>("all");

  const { data: metrics, isLoading, error } = useQuery<BusinessMetrics>({
    queryKey: ["business-model-metrics", period],
    queryFn: async () => {
      const token = localStorage.getItem("adminToken");
      const res = await fetch(`/api/admin/business-model/metrics?period=${period}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
  });

  // Sliders
  const [quotesPerMonth, setQuotesPerMonth] = useState(59);
  const [conversionPct, setConversionPct] = useState(metrics?.conversionRate || 24);
  const monthlyJobs = Math.round(quotesPerMonth * (conversionPct / 100));
  const [avgJobValue, setAvgJobValue] = useState(293);
  const [contractorSplit, setContractorSplit] = useState(50);
  const [benBase, setBenBase] = useState(500);
  const [benLabourPct, setBenLabourPct] = useState(5);
  const [ownerSalary, setOwnerSalary] = useState(2500);
  const [landlordProperties, setLandlordProperties] = useState(0);
  const [additionalTerritories, setAdditionalTerritories] = useState(0);
  const [territoryFixedCost, setTerritoryFixedCost] = useState(1500);
  const [marketingSpend, setMarketingSpend] = useState(0);
  const [softwareCost, setSoftwareCost] = useState(0);
  const [insuranceCost, setInsuranceCost] = useState(0);
  const [otherOverheads, setOtherOverheads] = useState(0);
  // ─── Hours-based capacity model ─────────────────────────────────────────────
  const [workingHoursPerWeek, setWorkingHoursPerWeek] = useState(40);
  const [workingWeeksPerYear, setWorkingWeeksPerYear] = useState(47); // 52 - 5 weeks (holiday/sick)
  const [productivePct, setProductivePct] = useState(70); // after travel/admin/breaks
  const [numHandymen, setNumHandymen] = useState(1); // team size for Employed model
  const [activeDimension, setActiveDimension] = useState<"price" | "views" | "layout" | "category" | "timeToBook">("price");
  const monthlyOverheads = ownerSalary + marketingSpend + softwareCost + insuranceCost + otherOverheads;

  const materialsMarginPercent = metrics?.materialsMarkupPercent || 27;
  const materialsPctOfRevenue = metrics ? (metrics.totalMaterialsSell / metrics.totalRevenue) * 100 : 16;

  // ── Per-handyman schedule (the honest unit)
  const monthlyContractedHours = Math.round((workingHoursPerWeek * workingWeeksPerYear) / 12);        // e.g. 40×47÷12 = 157
  const monthlyProductiveHoursPerPerson = Math.round(monthlyContractedHours * (productivePct / 100)); // after travel/admin = ~110

  // ── Employee cost (fixed) — DERIVED per hour, not a guess
  const EMP_ANNUAL_COST_PER_PERSON = 43200; // £32k + £6.4k NI/pension + £4.8k van
  const empMonthlyCostPerPerson = EMP_ANNUAL_COST_PER_PERSON / 12;
  const empCostPerHour = monthlyProductiveHoursPerPerson > 0
    ? empMonthlyCostPerPerson / monthlyProductiveHoursPerPerson
    : 0;

  // ── Customer charge rate (from REAL data, not a slider)
  const customerChargePerHour = metrics?.avgHourlyRate && metrics.avgHourlyRate > 0
    ? metrics.avgHourlyRate
    : 35;

  // ── Margin per productive hour (the number that matters)
  const marginPerHour = customerChargePerHour - empCostPerHour;

  // ── Demand hours — from labour revenue ÷ real charge rate (NO per-job estimation)
  const monthlyLabourRev = monthlyJobs * avgJobValue * (1 - materialsPctOfRevenue / 100);
  const demandHoursPerMonth = customerChargePerHour > 0
    ? monthlyLabourRev / customerChargePerHour
    : 0;

  // ── Team capacity scales with number of handymen
  const teamProductiveHours = monthlyProductiveHoursPerPerson * numHandymen;
  const recommendedHandymen = monthlyProductiveHoursPerPerson > 0
    ? Math.max(1, Math.ceil(demandHoursPerMonth / monthlyProductiveHoursPerPerson))
    : 1;

  // ── Jobs-equivalent (for downstream code — approximation only)
  // When demand hours = team capacity, jobs deliverable = labourRev / avgLabourPerJob
  const avgLabourPerJob = avgJobValue * (1 - materialsPctOfRevenue / 100);
  const maxJobsPerMonth = avgLabourPerJob > 0
    ? Math.floor((teamProductiveHours * customerChargePerHour) / avgLabourPerJob)
    : 1;

  // Alias for downstream code (backwards compat)
  const realisticCapacity = maxJobsPerMonth;

  // ─── Fair market owner wage benchmark (constant, for comparison only) ─────
  // This is the "fair pay for the risk/hours" reference line. The ACTUAL owner
  // draw comes from the main Owner Draw slider (ownerSalary × 12).
  const FAIR_MARKET_OWNER_WAGE = 45000;
  const annualOwnerDraw = ownerSalary * 12;

  // ─── UNIT ECONOMICS (per productive hour) ──────────────────────────────────
  // Blended revenue per hour comes from REAL data (weighted avg across categories)
  const blendedRevenuePerHour = customerChargePerHour; // already from metrics.avgHourlyRate

  // Labour's share of a billed £ (after materials carve-out)
  const labourShareOfRevenue = 1 - materialsPctOfRevenue / 100;

  // Per-productive-hour revenue breakdown
  const labourRevPerHour = blendedRevenuePerHour * labourShareOfRevenue;      // what the business keeps of customer £ after materials pass-through
  const materialsSellPerHour = blendedRevenuePerHour * (materialsPctOfRevenue / 100);
  const materialsCostPerHour = materialsSellPerHour / (1 + materialsMarginPercent / 100);

  // Variable costs per productive hour (only things that actually scale with hours)
  const benVariablePerHour = labourRevPerHour * (benLabourPct / 100);
  // NOTE: handyman cost is NOT here — they're fixed £43.2k/yr regardless of hours worked
  // (see Layer 3 · Fixed Cost Floor)

  // Contribution per productive hour = revenue − TRULY VARIABLE costs
  // Handyman is NOT deducted here — they're a fixed £43.2k/yr sunk cost (see Layer 3)
  const contributionPerHour =
    blendedRevenuePerHour        // customer pays
    - materialsCostPerHour       // pass-through materials (you keep the markup)
    - benVariablePerHour;        // Ben's variable commission

  const contributionMarginPct = blendedRevenuePerHour > 0
    ? (contributionPerHour / blendedRevenuePerHour) * 100
    : 0;

  // ── Fixed costs split into 3 buckets for clean reasoning ──────────────────
  // Bucket A: handymen (scales with team size, but fixed per head regardless of hours)
  const handymenAnnualCost = EMP_ANNUAL_COST_PER_PERSON * numHandymen;
  // Bucket B: business overheads EXCLUDING owner draw (Ben base + marketing + software + insurance + other)
  const overheadsExOwnerMonthly = Math.max(0, monthlyOverheads - ownerSalary);
  const overheadsExOwnerAnnual = overheadsExOwnerMonthly * 12;
  const businessOverheadsExOwner = (benBase * 12) + overheadsExOwnerAnnual;
  // Bucket C: owner draw (what you actually pay yourself right now)
  // already computed as annualOwnerDraw

  // TRUE fixed floor the business must cover BEFORE paying the owner anything
  const fixedFloorExOwner = handymenAnnualCost + businessOverheadsExOwner;
  // Fixed floor INCLUDING current owner draw
  const fixedFloorIncOwner = fixedFloorExOwner + annualOwnerDraw;
  // Fixed floor AT FAIR MARKET wage (benchmark)
  const fixedFloorAtFairMarket = fixedFloorExOwner + FAIR_MARKET_OWNER_WAGE;

  // Break-even productive hours to cover each floor
  const beHoursYear = (floor: number) => contributionPerHour > 0 ? floor / contributionPerHour : Infinity;
  const beUtil = (floor: number) => {
    if (teamProductiveHours <= 0 || contributionPerHour <= 0) return Infinity;
    return (beHoursYear(floor) / 12 / teamProductiveHours) * 100;
  };

  const breakEvenHoursPerYear = beHoursYear(fixedFloorExOwner);
  const breakEvenHoursPerMonth = breakEvenHoursPerYear / 12;
  const breakEvenUtilisation = beUtil(fixedFloorExOwner);
  const breakEvenUtilWithCurrentOwner = beUtil(fixedFloorIncOwner);
  const breakEvenUtilAtFairMarket = beUtil(fixedFloorAtFairMarket);

  // Honest profit: gross contribution − fixed floor (ex owner) − current owner draw
  const hoursWorkedPerMonth = Math.min(demandHoursPerMonth, teamProductiveHours);
  const grossContributionAnnual = contributionPerHour * hoursWorkedPerMonth * 12;
  const netBeforeOwnerWage = grossContributionAnnual - fixedFloorExOwner;
  const honestProfit = netBeforeOwnerWage - annualOwnerDraw;
  // Benchmark: what profit would be if you paid yourself fair market (£45k)
  const profitAtFairMarketWage = netBeforeOwnerWage - FAIR_MARKET_OWNER_WAGE;
  // Owner wage gap: negative = underpaying yourself vs fair market
  const ownerWageGap = annualOwnerDraw - FAIR_MARKET_OWNER_WAGE;

  // ── Category mix (real data) — what lifts vs drags the blended rate ───────
  const categoryMix = useMemo(() => {
    if (!metrics?.categoryDetail) return [];
    const totalHours = Object.values(metrics.categoryDetail).reduce((s, c) => s + c.hours, 0);
    return Object.entries(metrics.categoryDetail)
      .filter(([, d]) => d.hours > 0 && d.revenuePerHour > 0)
      .map(([label, d]) => ({
        label,
        hours: d.hours,
        revenuePerHour: d.revenuePerHour,
        share: totalHours > 0 ? (d.hours / totalHours) * 100 : 0,
        colour: getCategoryColour(label),
        vsBlended: d.revenuePerHour - blendedRevenuePerHour,
      }))
      .sort((a, b) => b.revenuePerHour - a.revenuePerHour);
  }, [metrics, blendedRevenuePerHour]);

  // ─── Ben's Pay (Base + % of Labour Charge) ──────────────────────────────────
  const calcBenAnnual = (annualLabourRev: number) => (benBase * 12) + (annualLabourRev * (benLabourPct / 100));

  // ─── Labour Models ──────────────────────────────────────────────────────────
  const models = useMemo<ModelResult[]>(() => {
    const annualRev = monthlyJobs * avgJobValue * 12;
    const annualMatSell = annualRev * (materialsPctOfRevenue / 100);
    const annualMatProfit = annualMatSell * (materialsMarginPercent / (100 + materialsMarginPercent));
    const annualLabourRev = annualRev - annualMatSell;
    const annualOverheads = monthlyOverheads * 12;

    const benTotal = calcBenAnnual(annualLabourRev);

    // Current contractor-only
    const subCost = annualLabourRev * (contractorSplit / 100);
    const subGP = (annualLabourRev - subCost) + annualMatProfit;
    const subProfit = subGP - annualOverheads - benTotal;

    // Employed team — scales with numHandymen
    const empCostPerPerson = EMP_ANNUAL_COST_PER_PERSON; // £43.2k/yr
    const empCost = empCostPerPerson * numHandymen;
    const empGP = (annualLabourRev - empCost) + annualMatProfit;
    const empProfit = empGP - annualOverheads - benTotal;

    // Hybrid: team handles what it can, contractors pick up the overflow
    const overflowJobs = Math.max(0, monthlyJobs - realisticCapacity);
    const overflowLabour = overflowJobs * avgJobValue * 12 * (1 - materialsPctOfRevenue / 100);
    const hybridCost = empCost + overflowLabour * (contractorSplit / 100);
    const hybridGP = (annualLabourRev - hybridCost) + annualMatProfit;
    const hybridProfit = hybridGP - annualOverheads - benTotal;

    // ─── Capacity blocks (hours-based, team-aware) ───
    const empMonthlyCost = empCost / 12;
    const teamCostPerHour = teamProductiveHours > 0 ? empMonthlyCost / teamProductiveHours : 0;
    // Hours per job is DERIVED locally just for labelling — no more guessing
    const avgHoursPerJob = customerChargePerHour > 0 ? avgLabourPerJob / customerChargePerHour : 0;

    // Employed model: hard cap at team capacity, no overflow absorbed
    const empJobsByEmployee = Math.min(monthlyJobs, realisticCapacity);
    const empCapacity: ModelCapacity = {
      capacity: realisticCapacity,
      demand: monthlyJobs,
      jobsByEmployee: empJobsByEmployee,
      idleSlots: Math.max(0, realisticCapacity - monthlyJobs),
      overflowJobs: Math.max(0, monthlyJobs - realisticCapacity),
      utilisation: teamProductiveHours > 0 ? (demandHoursPerMonth / teamProductiveHours) * 100 : 0,
      costPerEmpJob: empJobsByEmployee > 0 ? empMonthlyCost / empJobsByEmployee : 0,
      employedCostPerMonth: empMonthlyCost,
      productiveHours: teamProductiveHours,
      productiveHoursPerPerson: monthlyProductiveHoursPerPerson,
      demandHours: demandHoursPerMonth,
      hoursByEmployee: Math.min(demandHoursPerMonth, teamProductiveHours),
      idleHours: Math.max(0, teamProductiveHours - demandHoursPerMonth),
      overflowHours: Math.max(0, demandHoursPerMonth - teamProductiveHours),
      avgHoursPerJob,
      costPerHour: teamCostPerHour,
      numHandymen,
      recommendedHandymen,
    };

    // Hybrid model: team maxed, overflow handled by contractors
    const hybridJobsByEmployee = Math.min(monthlyJobs, realisticCapacity);
    const hybridCapacity: ModelCapacity = {
      capacity: realisticCapacity,
      demand: monthlyJobs,
      jobsByEmployee: hybridJobsByEmployee,
      idleSlots: Math.max(0, realisticCapacity - monthlyJobs),
      overflowJobs: Math.max(0, monthlyJobs - realisticCapacity),
      utilisation: teamProductiveHours > 0
        ? (Math.min(demandHoursPerMonth, teamProductiveHours) / teamProductiveHours) * 100
        : 0,
      costPerEmpJob: hybridJobsByEmployee > 0 ? empMonthlyCost / hybridJobsByEmployee : 0,
      employedCostPerMonth: empMonthlyCost,
      productiveHours: teamProductiveHours,
      productiveHoursPerPerson: monthlyProductiveHoursPerPerson,
      demandHours: demandHoursPerMonth,
      hoursByEmployee: Math.min(demandHoursPerMonth, teamProductiveHours),
      idleHours: Math.max(0, teamProductiveHours - demandHoursPerMonth),
      overflowHours: Math.max(0, demandHoursPerMonth - teamProductiveHours),
      avgHoursPerJob,
      costPerHour: teamCostPerHour,
      numHandymen,
      recommendedHandymen,
    };

    const best = Math.max(subProfit, empProfit, hybridProfit);
    const mk = (
      title: string, desc: string, cost: number, ben: number, profit: number, rec: boolean,
      capacity?: ModelCapacity,
    ): ModelResult => ({
      title, description: desc, annualRevenue: annualRev, contractorCost: cost,
      estimatorCommission: ben, materialsProfit: annualMatProfit, overheads: annualOverheads,
      netProfit: profit, profitMargin: annualRev > 0 ? (profit / annualRev) * 100 : 0,
      recommended: rec, capacity,
    });

    const teamLabel = numHandymen === 1 ? "1 handyman" : `${numHandymen} handymen`;
    return [
      mk(`Current: ${100 - contractorSplit}/${contractorSplit} Split`, `Contractor gets ${contractorSplit}% of labour`, subCost, benTotal, subProfit, subProfit === best),
      mk(
        `Employed Team (${teamLabel})`,
        `${teamLabel} × £43.2k/yr = ${fmt(empCost)}/yr · capacity ${realisticCapacity} jobs/mo`,
        empCost, benTotal, empProfit, empProfit === best, empCapacity,
      ),
      mk(
        "Hybrid Model",
        `${teamLabel} employed (${realisticCapacity} jobs/mo) + overflow at ${100 - contractorSplit}/${contractorSplit}`,
        hybridCost, benTotal, hybridProfit, hybridProfit === best, hybridCapacity,
      ),
    ];
  }, [monthlyJobs, avgJobValue, contractorSplit, benBase, benLabourPct, materialsPctOfRevenue,
      materialsMarginPercent, monthlyOverheads, realisticCapacity, teamProductiveHours,
      demandHoursPerMonth, numHandymen, recommendedHandymen, monthlyProductiveHoursPerPerson,
      customerChargePerHour, avgLabourPerJob]);

  // ─── Growth Forecast ────────────────────────────────────────────────────────
  const growthTable = useMemo(() => {
    return [1, 2, 4].map((scale) => {
      const jobs = monthlyJobs * scale;
      const baseMonthlyRev = jobs * avgJobValue;
      const emergencyUplift = baseMonthlyRev * 0.15 * 0.35;
      const landlordMRR = landlordProperties * 95;
      const monthlyRev = baseMonthlyRev + emergencyUplift + landlordMRR;
      const annualRev = monthlyRev * 12;
      const annualMatSell = (baseMonthlyRev + emergencyUplift) * 12 * (materialsPctOfRevenue / 100);
      const annualMatProfit = annualMatSell * (materialsMarginPercent / (100 + materialsMarginPercent));
      const annualLabourRev = annualRev - annualMatSell - landlordMRR * 12;
      const contractorCost = annualLabourRev * (contractorSplit / 100);
      const annualOverheads = monthlyOverheads * 12 + additionalTerritories * territoryFixedCost * 12;
      const landlordProfit = landlordMRR * 12 * 0.71;
      const grossProfit = (annualLabourRev - contractorCost) + annualMatProfit + landlordProfit;
      const benCost = calcBenAnnual(annualLabourRev);
      const netProfit = grossProfit - annualOverheads - benCost;

      return {
        scale: `${scale}X`, monthlyJobs: jobs, annualRevenue: annualRev, contractorCost,
        materialsProfit: annualMatProfit, landlordProfit, emergencyUplift: emergencyUplift * 12,
        overheads: annualOverheads, benCommission: benCost, netProfit,
        profitMargin: annualRev > 0 ? (netProfit / annualRev) * 100 : 0,
      };
    });
  }, [monthlyJobs, avgJobValue, contractorSplit, benBase, benLabourPct, materialsPctOfRevenue, materialsMarginPercent, landlordProperties, additionalTerritories, territoryFixedCost, monthlyOverheads]);

  // ─── Hiring Decision ────────────────────────────────────────────────────────
  // Break-even: employed cost is fixed £43.2k/yr. Contractor cost = labour × split%.
  // At what job count does contractor cost exceed employed cost?
  // Contractor cost/mo = jobs × labourPerJob × (contractorSplit / 100)
  // Employed cost/mo = 43200 / 12 = £3,600
  // Break-even: 3600 = jobs × labourPerJob × (contractorSplit / 100)
  const hiringDecision = useMemo(() => {
    const empMonthlyCost = 43200 / 12; // £3,600
    const labourPerJob = avgJobValue * (1 - materialsPctOfRevenue / 100);
    const savingsPerJob = labourPerJob * (contractorSplit / 100);
    const breakEvenJobs = savingsPerJob > 0 ? Math.ceil(empMonthlyCost / savingsPerJob) : 999;
    const breakEvenConversion = quotesPerMonth > 0 ? Math.ceil((breakEvenJobs / quotesPerMonth) * 100) : 999;
    return {
      breakEvenJobs, breakEvenConversion, monthlyBurn: empMonthlyCost,
      justifiesHiring: monthlyJobs >= breakEvenJobs, currentJobs: monthlyJobs,
      margin: monthlyJobs - breakEvenJobs, quotesPerMonth,
    };
  }, [monthlyJobs, avgJobValue, contractorSplit, materialsPctOfRevenue, quotesPerMonth]);

  // ─── Profit Waterfall Data (current sliders, monthly) ──────────────────────
  const waterfallData = useMemo<WaterfallData>(() => {
    const rev = monthlyJobs * avgJobValue;
    const matSell = rev * (materialsPctOfRevenue / 100);
    const matProfit = matSell * (materialsMarginPercent / (100 + materialsMarginPercent));
    const matCostOut = matSell - matProfit;
    const labourRev = rev - matSell;
    const contractorCost = labourRev * (contractorSplit / 100);
    const benCost = benBase + labourRev * (benLabourPct / 100);
    const otherOverheadsTotal = marketingSpend + softwareCost + insuranceCost + otherOverheads;
    const netProfit = rev - matCostOut - contractorCost - benCost - ownerSalary - otherOverheadsTotal;
    return {
      revenue: rev,
      materialsCost: matCostOut,
      contractorCost,
      benCost,
      ownerSalary,
      otherOverheads: otherOverheadsTotal,
      netProfit,
    };
  }, [monthlyJobs, avgJobValue, contractorSplit, benBase, benLabourPct, ownerSalary,
      marketingSpend, softwareCost, insuranceCost, otherOverheads,
      materialsPctOfRevenue, materialsMarginPercent]);

  // ─── Sensitivity Tornado Data (±20% movement per variable) ─────────────────
  const tornadoData = useMemo(() => {
    type OverrideKey =
      | "quotesPerMonth" | "conversionPct" | "avgJobValue" | "contractorSplit"
      | "benBase" | "benLabourPct" | "ownerSalary" | "marketingSpend";

    const calcProfit = (overrides: Partial<Record<OverrideKey, number>> = {}) => {
      const q = overrides.quotesPerMonth ?? quotesPerMonth;
      const c = overrides.conversionPct ?? conversionPct;
      const j = overrides.avgJobValue ?? avgJobValue;
      const cs = overrides.contractorSplit ?? contractorSplit;
      const bb = overrides.benBase ?? benBase;
      const bp = overrides.benLabourPct ?? benLabourPct;
      const os = overrides.ownerSalary ?? ownerSalary;
      const ms = overrides.marketingSpend ?? marketingSpend;

      const jobs = Math.round(q * (c / 100));
      const rev = jobs * j;
      const matSell = rev * (materialsPctOfRevenue / 100);
      const matProfit = matSell * (materialsMarginPercent / (100 + materialsMarginPercent));
      const matCostOut = matSell - matProfit;
      const labourRev = rev - matSell;
      const cc = labourRev * (cs / 100);
      const bc = bb + labourRev * (bp / 100);
      const oh = os + ms + softwareCost + insuranceCost + otherOverheads;
      return rev - matCostOut - cc - bc - oh;
    };

    const baseProfit = calcProfit();

    const variables: { label: string; current: number; key: OverrideKey }[] = [
      { label: "Quotes Sent /mo", current: quotesPerMonth, key: "quotesPerMonth" },
      { label: "Conversion Rate", current: conversionPct, key: "conversionPct" },
      { label: "Avg Job Value", current: avgJobValue, key: "avgJobValue" },
      { label: "Contractor Split", current: contractorSplit, key: "contractorSplit" },
      { label: "Ben Base Salary", current: benBase, key: "benBase" },
      { label: "Ben % of Labour", current: benLabourPct, key: "benLabourPct" },
      { label: "Your Salary", current: ownerSalary, key: "ownerSalary" },
      { label: "Marketing Spend", current: marketingSpend, key: "marketingSpend" },
    ];

    const results: TornadoVar[] = variables.map((v) => {
      const lowVal = v.current * 0.8;
      const highVal = v.current * 1.2;
      const lowDelta = calcProfit({ [v.key]: lowVal } as Partial<Record<OverrideKey, number>>) - baseProfit;
      const highDelta = calcProfit({ [v.key]: highVal } as Partial<Record<OverrideKey, number>>) - baseProfit;
      return {
        label: v.label,
        lowDelta,
        highDelta,
        maxAbs: Math.max(Math.abs(lowDelta), Math.abs(highDelta)),
      };
    }).sort((a, b) => b.maxAbs - a.maxAbs);

    return { results, baseProfit };
  }, [quotesPerMonth, conversionPct, avgJobValue, contractorSplit, benBase, benLabourPct,
      ownerSalary, marketingSpend, softwareCost, insuranceCost, otherOverheads,
      materialsPctOfRevenue, materialsMarginPercent]);

  // ─── Category chart data ──────────────────────────────────────────────────
  const categoryChartData = useMemo(() => {
    if (!metrics) return [];
    return Object.entries(metrics.categoryDetail)
      .map(([label, d]) => ({ label, ...d, colour: getCategoryColour(label) }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [metrics]);

  // Seasonality stats
  const seasonality = useMemo(() => {
    if (!metrics?.monthlyTrend?.length) return null;
    const revs = metrics.monthlyTrend.map((m) => m.revenue);
    const jobs = metrics.monthlyTrend.map((m) => m.jobs);
    const minRev = Math.min(...revs);
    const maxRev = Math.max(...revs);
    const minJobs = Math.min(...jobs);
    const maxJobs = Math.max(...jobs);
    const avgRev = revs.reduce((a, b) => a + b, 0) / revs.length;
    const variance = revs.reduce((s, r) => s + (r - avgRev) ** 2, 0) / revs.length;
    const stdDev = Math.sqrt(variance);
    const volatility = avgRev > 0 ? (stdDev / avgRev) * 100 : 0;
    return { minRev, maxRev, minJobs, maxJobs, volatility, months: metrics.monthlyTrend.length };
  }, [metrics]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-600 border-t-[#7DB00E]" />
    </div>
  );

  if (error) return (
    <div className="p-6 text-center text-red-400">
      <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
      <p>Failed to load business metrics. Please try again.</p>
    </div>
  );

  const uncatPct = metrics?.categoryDetail?.uncategorised ? Math.round((metrics.categoryDetail.uncategorised.revenue / metrics.totalRevenue) * 100) : 0;
  const otherPct = metrics?.categoryDetail?.other ? Math.round((metrics.categoryDetail.other.revenue / metrics.totalRevenue) * 100) : 0;
  const dataGapPct = uncatPct + otherPct;

  return (
    <div className="p-4 md:p-6 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <Calculator className="h-7 w-7" style={{ color: BRAND_GREEN }} />
            Business Model Forecast
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            {metrics?.totalJobs ?? 0} booked / {metrics?.totalQuotes ?? 0} real quotes
            {period !== "all" && <span className="ml-1 text-gray-500">({metrics?.totalQuotesUnfiltered ?? 0} total all-time)</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${period === p.key ? "text-black" : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"}`}
              style={period === p.key ? { backgroundColor: BRAND_GREEN } : undefined}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ================================================================== */}
      {/* SECTION A: Current Business Metrics                                */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5" style={{ color: BRAND_GREEN }} />
          Current Business Metrics
        </h2>

        {/* Row 1: Core stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <StatCard label="Total Revenue" value={fmtDec(metrics?.totalRevenue ?? 0)} icon={PoundSterling} sub={`${metrics?.totalJobs ?? 0} booked jobs`} />
          <StatCard label="Avg Job Value" value={fmtDec(metrics?.avgJobValue ?? 0)} icon={TrendingUp} />
          <StatCard label="Avg Charge Rate" value={metrics?.avgHourlyRate ? fmtDec(metrics.avgHourlyRate) : "N/A"} icon={Clock}
            sub={metrics?.totalHours ? `${metrics.totalHours}hrs tracked` : "No hour data"} />
          <StatCard label="Monthly Run Rate" value={fmt(metrics?.actualMonthlyRunRate?.revenue ?? 0)} icon={CalendarDays}
            sub={`${metrics?.actualMonthlyRunRate?.jobs ?? 0} jobs/mo avg`} />
        </div>

        {/* Row 2: Conversion, Repeat, Discount, Total Jobs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Conversion Rate" value={`${metrics?.conversionRate ?? 0}%`} icon={Target}
            sub={`${metrics?.totalQuotes ?? 0} contextual quotes → ${metrics?.totalJobs ?? 0} booked (${metrics?.totalRealAll ?? 0} real / ${metrics?.totalQuotesUnfiltered ?? 0} total)`}
            accent={(metrics?.conversionRate ?? 0) < 20 ? "#EF4444" : BRAND_GREEN} />
          <StatCard label="Repeat Customers" value={`${metrics?.repeatRate ?? 0}%`} icon={Repeat}
            sub={`${metrics?.repeatCustomers ?? 0} of ${metrics?.uniqueCustomers ?? 0} customers`}
            accent={(metrics?.repeatRate ?? 0) > 0 ? BRAND_GREEN : "#6B7280"} />
          <StatCard label="Avg Discount" value={`${metrics?.discountPercent ?? 0}%`} icon={ArrowRightLeft}
            sub={metrics?.avgQuotedValue ? `Quoted ${fmtDec(metrics.avgQuotedValue)} → Booked ${fmtDec(metrics.avgBookedValue)}` : "No data"}
            accent={(metrics?.discountPercent ?? 0) > 10 ? "#EF4444" : BRAND_GREEN} />
          <StatCard label="Total Jobs" value={String(metrics?.totalJobs ?? 0)} icon={Briefcase}
            sub={`${metrics?.quotesWithLineItems ?? 0} with line items, ${metrics?.quotesWithoutLineItems ?? 0} without`} />
        </div>

        {/* Materials & Revenue Split */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg" style={{ backgroundColor: "#3B82F620" }}>
                  <Package className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Materials (Customer-Funded)</p>
                  <p className="text-xl font-bold text-white">{fmtDec(metrics?.totalMaterialsSell ?? 0)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Cost: {fmtDec(metrics?.totalMaterialsCost ?? 0)} ·
                    <span className="text-blue-400"> You keep {fmtDec(metrics?.materialsMargin ?? 0)} ({metrics?.materialsMarkupPercent ?? 0}% markup)</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg" style={{ backgroundColor: `${BRAND_GREEN}20` }}>
                  <Wrench className="h-5 w-5" style={{ color: BRAND_GREEN }} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Labour Revenue</p>
                  <p className="text-xl font-bold text-white">{fmtDec(metrics?.totalLabour ?? 0)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {metrics ? pct((metrics.totalLabour / metrics.totalRevenue) * 100) : "0%"} of revenue · Split with contractor
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-amber-900/20"><Info className="h-5 w-5 text-amber-400" /></div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Revenue Model</p>
                  <p className="text-sm text-gray-300 mt-1">
                    Customer pays <span className="text-white font-semibold">labour + materials</span> upfront.
                    Materials margin is <span className="text-blue-400 font-semibold">pure profit</span>.
                    Labour split is the <span className="text-green-400 font-semibold">key variable</span>.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Data quality warning */}
        {dataGapPct > 20 && (
          <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-4 mb-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-300">{dataGapPct}% of revenue is uncategorised or "other"</p>
              <p className="text-xs text-amber-400/70 mt-1">
                {metrics?.quotesWithoutLineItems ?? 0} quotes have no line items. Ben should tag jobs with specific categories.
              </p>
            </div>
          </div>
        )}

        {/* Revenue by Category */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white">Revenue by Category</CardTitle>
            <CardDescription className="text-xs">
              Per-line-item breakdown · £/hr shows revenue per hour of labour by trade
            </CardDescription>
          </CardHeader>
          <CardContent>
            {categoryChartData.length > 0 ? <CategoryBar data={categoryChartData} /> : <p className="text-sm text-gray-500">No category data</p>}
          </CardContent>
        </Card>
      </section>

      {/* ================================================================== */}
      {/* SECTION SS: Sweet Spot Finder                                      */}
      {/* ================================================================== */}
      {metrics?.sweetSpots && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Target className="h-5 w-5" style={{ color: BRAND_GREEN }} />
            Sweet Spot Finder
          </h2>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="pt-6 space-y-6">
              {/* Dimension toggles */}
              <div className="flex flex-wrap gap-2">
                {([
                  ["price", "Price Band"],
                  ["views", "View Count"],
                  ["layout", "Layout Tier"],
                  ["category", "Category"],
                  ["timeToBook", "Time to Book"],
                ] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setActiveDimension(key)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeDimension === key ? "text-black" : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"}`}
                    style={activeDimension === key ? { backgroundColor: BRAND_GREEN } : undefined}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Conversion heatmap bars */}
              {activeDimension !== "timeToBook" ? (() => {
                const data = activeDimension === "price" ? metrics.sweetSpots.priceBands
                  : activeDimension === "views" ? metrics.sweetSpots.viewBands
                  : activeDimension === "layout" ? metrics.sweetSpots.layoutTiers
                  : metrics.sweetSpots.categoryConversion;
                const maxRate = Math.max(...data.map(d => d.rate), 1);

                // Sort: price/views by label order, others by rate desc
                const sorted = activeDimension === "price"
                  ? [...data].sort((a, b) => {
                      const order = ["£0-100", "£100-150", "£150-200", "£200-300", "£300-500", "£500+"];
                      return order.indexOf(a.label) - order.indexOf(b.label);
                    })
                  : activeDimension === "views"
                  ? [...data].sort((a, b) => {
                      const order = ["0 views", "1 view", "2-3 views", "4-10 views", "11+ views"];
                      return order.indexOf(a.label) - order.indexOf(b.label);
                    })
                  : [...data].sort((a, b) => b.rate - a.rate);

                return (
                  <div className="space-y-3">
                    {sorted.map((d) => {
                      const isHot = d.rate >= 30;
                      const isWarm = d.rate >= 15 && d.rate < 30;
                      const barColour = isHot ? BRAND_GREEN : isWarm ? "#F59E0B" : "#EF4444";
                      return (
                        <div key={d.label} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-300 font-medium">
                              {activeDimension === "category" ? prettyCat(d.label) : d.label}
                              {isHot && <Badge className="ml-2 bg-green-900 text-green-300 text-xs">SWEET SPOT</Badge>}
                            </span>
                            <span className="text-gray-400">
                              {d.booked}/{d.total} booked
                              <span className="ml-2 font-bold" style={{ color: barColour }}>{d.rate}%</span>
                            </span>
                          </div>
                          <div className="h-6 bg-gray-800 rounded-full overflow-hidden relative">
                            <div className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.max((d.rate / maxRate) * 100, 2)}%`, backgroundColor: barColour }} />
                            {d.total < 5 && (
                              <span className="absolute right-2 top-0.5 text-xs text-gray-500">low sample</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })() : (
                /* Time to Book scatter */
                <div className="space-y-3">
                  <p className="text-sm text-gray-400 mb-3">How quickly customers book after receiving the quote</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {metrics.sweetSpots.timeToBook.map((t, i) => {
                      const isQuick = t.hours < 2;
                      return (
                        <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${isQuick ? "bg-green-950/30 border-green-800" : "bg-gray-800/50 border-gray-700"}`}>
                          <div className="text-2xl">{isQuick ? "⚡" : t.hours < 24 ? "🕐" : "📅"}</div>
                          <div className="flex-1">
                            <p className="text-white font-medium">{t.name}</p>
                            <p className="text-sm text-gray-400">{fmt(t.price)}</p>
                          </div>
                          <div className="text-right">
                            <p className={`font-bold ${isQuick ? "text-green-400" : "text-gray-300"}`}>
                              {t.hours < 1 ? `${Math.round(t.hours * 60)}m` : t.hours < 24 ? `${t.hours}h` : `${Math.round(t.hours / 24)}d`}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                    <p className="text-sm text-gray-300">
                      <span className="font-bold" style={{ color: BRAND_GREEN }}>
                        {metrics.sweetSpots.timeToBook.filter(t => t.hours < 2).length}/{metrics.sweetSpots.timeToBook.length}
                      </span>
                      {" "}customers book within 2 hours. Average:{" "}
                      <span className="font-bold text-white">
                        {(() => {
                          const avg = metrics.sweetSpots.timeToBook.reduce((s, t) => s + t.hours, 0) / (metrics.sweetSpots.timeToBook.length || 1);
                          return avg < 1 ? `${Math.round(avg * 60)}m` : avg < 24 ? `${Math.round(avg * 10) / 10}h` : `${Math.round(avg / 24)}d`;
                        })()}
                      </span>
                    </p>
                  </div>
                </div>
              )}

              {/* Insight callout */}
              {activeDimension === "price" && (
                <div className="p-4 rounded-lg border border-green-800 bg-green-950/20">
                  <p className="text-sm text-green-300">
                    <span className="font-bold">Insight:</span> Your sweet spot is £150-500 — these quotes convert 2-4x better than sub-£100 or £500+ quotes. Consider anchoring more quotes into this range.
                  </p>
                </div>
              )}
              {activeDimension === "views" && (
                <div className="p-4 rounded-lg border border-green-800 bg-green-950/20">
                  <p className="text-sm text-green-300">
                    <span className="font-bold">Insight:</span> Customers who view 4+ times convert at 46%. Views 0-1 = 0% conversion. Follow-up nudges after 2-3 views could push people into the buying zone.
                  </p>
                </div>
              )}
              {activeDimension === "layout" && (
                <div className="p-4 rounded-lg border border-green-800 bg-green-950/20">
                  <p className="text-sm text-green-300">
                    <span className="font-bold">Insight:</span> Complex and standard layouts convert nearly 2x better than quick. The extra detail builds trust — don't oversimplify quotes to save time.
                  </p>
                </div>
              )}
              {activeDimension === "timeToBook" && (
                <div className="p-4 rounded-lg border border-green-800 bg-green-950/20">
                  <p className="text-sm text-green-300">
                    <span className="font-bold">Insight:</span> Most customers book within hours, not days. Speed to send the quote is critical — if they don't book same day, conversion drops significantly.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ================================================================== */}
      {/* SECTION A2: Monthly Revenue Trend                                  */}
      {/* ================================================================== */}
      {metrics?.monthlyTrend && metrics.monthlyTrend.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <CalendarDays className="h-5 w-5" style={{ color: BRAND_GREEN }} />
            Monthly Revenue Trend
          </h2>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="pt-6">
              <MonthlyTrendChart data={metrics.monthlyTrend} />
            </CardContent>
          </Card>
        </section>
      )}

      {/* ================================================================== */}
      {/* SECTION P: Profit Anatomy (Waterfall + Sensitivity Tornado)         */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <PoundSterling className="h-5 w-5" style={{ color: BRAND_GREEN }} />
          Profit Anatomy
        </h2>

        {/* Waterfall: where every £1 of revenue goes */}
        <Card className="bg-gray-900 border-gray-800 mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white">Where Every £1 Goes</CardTitle>
            <CardDescription className="text-xs text-gray-400">
              Monthly waterfall at {monthlyJobs} jobs × {fmt(avgJobValue)} = {fmt(waterfallData.revenue)} revenue · reacts to every slider above
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfitWaterfall data={waterfallData} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-xs">
              <div className="bg-gray-800/50 rounded p-2">
                <p className="text-gray-500 uppercase text-[10px]">Gross Profit</p>
                <p className="text-white font-mono font-bold">
                  {fmt(waterfallData.revenue - waterfallData.materialsCost - waterfallData.contractorCost)}
                </p>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <p className="text-gray-500 uppercase text-[10px]">People Cost</p>
                <p className="text-white font-mono font-bold">
                  {fmt(waterfallData.contractorCost + waterfallData.benCost + waterfallData.ownerSalary)}
                </p>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <p className="text-gray-500 uppercase text-[10px]">Net Profit /mo</p>
                <p className={`font-mono font-bold ${waterfallData.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {fmt(waterfallData.netProfit)}
                </p>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <p className="text-gray-500 uppercase text-[10px]">Net Margin</p>
                <p className={`font-mono font-bold ${waterfallData.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {waterfallData.revenue > 0 ? pct((waterfallData.netProfit / waterfallData.revenue) * 100) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tornado: which lever matters most */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-white">Which Lever Matters Most?</CardTitle>
            <CardDescription className="text-xs text-gray-400">
              Sensitivity analysis: move each variable ±20% and see the profit impact. Longest bar = highest leverage.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SensitivityTornado data={tornadoData.results} baseProfit={tornadoData.baseProfit} />
            {tornadoData.results.length > 0 && (
              <div className="mt-4 p-4 rounded-lg border border-green-800 bg-green-950/20">
                <p className="text-sm text-green-300">
                  <span className="font-bold">Biggest lever:</span> {tornadoData.results[0].label} — a 20% swing moves profit by{" "}
                  <span className="font-mono font-bold">{fmt(tornadoData.results[0].maxAbs)}/mo</span>.
                  Focus your energy here first.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ================================================================== */}
      {/* SECTION U: Unit Economics — Is This Business Scalable?             */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <Target className="h-5 w-5" style={{ color: BRAND_GREEN }} />
          Unit Economics — Is This Business Scalable?
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Before we add more handymen, we stress-test the unit. Working in <span className="text-green-400">£/productive hour</span> (the honest denomination) — not jobs, because jobs vary.
        </p>

        {/* Row 1 — Per-Hour Economics + Fixed Cost Floor */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Per-Hour Economics */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-400" />
                Layer 1 · Per Productive Hour
              </CardTitle>
              <CardDescription className="text-xs">
                Blended charge rate from <span className="text-green-400">real booking data</span> ({metrics?.totalJobs ?? 0} jobs, {metrics?.totalHours ?? 0}h tracked).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Customer pays</span>
                <span className="font-mono text-white">{fmtDec(blendedRevenuePerHour)}/h</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">&nbsp;&nbsp;└ Materials sold {Math.round(materialsPctOfRevenue)}%</span>
                <span className="font-mono text-gray-400">{fmtDec(materialsSellPerHour)}/h</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">&nbsp;&nbsp;└ Labour {Math.round(labourShareOfRevenue * 100)}%</span>
                <span className="font-mono text-gray-400">{fmtDec(labourRevPerHour)}/h</span>
              </div>
              <div className="border-t border-gray-800 my-2" />
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Truly variable costs (scale with hours)</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">− Materials cost</span>
                <span className="font-mono text-red-400">−{fmtDec(materialsCostPerHour)}/h</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">− Ben variable ({benLabourPct}% of labour)</span>
                <span className="font-mono text-red-400">−{fmtDec(benVariablePerHour)}/h</span>
              </div>
              <div className="border-t border-gray-700 pt-2 mt-2">
                <div className="flex justify-between text-base">
                  <span className="font-semibold text-gray-200">= Contribution /hr</span>
                  <span className={`font-mono font-bold ${contributionPerHour >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmtDec(contributionPerHour)}/h
                  </span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-gray-500">Contribution margin</span>
                  <span className={`font-mono ${contributionMarginPct >= 40 ? "text-green-400" : contributionMarginPct >= 25 ? "text-amber-400" : "text-red-400"}`}>
                    {pct(contributionMarginPct)}
                  </span>
                </div>
              </div>

              <div className="bg-amber-950/20 border border-amber-900/30 rounded p-2 mt-3">
                <p className="text-[10px] text-amber-300 uppercase tracking-wide mb-1">Why no handyman row?</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Your handyman is <b className="text-amber-300">fixed</b> at {fmt(EMP_ANNUAL_COST_PER_PERSON)}/yr ({fmtDec(empCostPerHour)}/h @ {monthlyProductiveHoursPerPerson}h/mo) — you pay them whether they work or not.
                  That belongs in <b>Layer 3 · Fixed Cost Floor</b>, not here. Deducting it per-hour double-counts and masks the real contribution.
                </p>
              </div>

              <div className="bg-gray-800/30 rounded p-2 mt-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Reading this</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Every productive hour throws off <b className={contributionPerHour >= 0 ? "text-green-400" : "text-red-400"}>{fmtDec(contributionPerHour)}</b> toward handymen, Ben base, overheads, and owner wage.
                  {contributionMarginPct >= 40
                    ? " Healthy — above the 40% threshold for service businesses."
                    : contributionMarginPct >= 25
                    ? " Thin — needs pricing discipline or cost cuts."
                    : " DANGER — job-level economics are broken. Don't scale this."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Fixed Cost Floor */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Building2 className="h-4 w-4 text-amber-400" />
                Layer 3 · Fixed Cost Floor
              </CardTitle>
              <CardDescription className="text-xs">
                The annual floor you must cover before a single £ of profit.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Bucket A · Team</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{numHandymen} × Handyman salary ({fmt(EMP_ANNUAL_COST_PER_PERSON)} ea)</span>
                <span className="font-mono text-red-400">−{fmt(handymenAnnualCost)}</span>
              </div>

              <p className="text-[10px] text-gray-500 uppercase tracking-wide pt-1">Bucket B · Business overheads (ex owner)</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Ben base ({fmt(benBase)}/mo)</span>
                <span className="font-mono text-red-400">−{fmt(benBase * 12)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Other overheads ({fmt(overheadsExOwnerMonthly)}/mo)</span>
                <span className="font-mono text-red-400">−{fmt(overheadsExOwnerAnnual)}</span>
              </div>

              <div className="border-t border-gray-700 pt-2 mt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-300">Fixed floor <span className="text-[10px] text-gray-500">(before owner draw)</span></span>
                  <span className="font-mono font-bold text-red-400">{fmt(fixedFloorExOwner)}</span>
                </div>
              </div>

              <p className="text-[10px] text-gray-500 uppercase tracking-wide pt-2">Bucket C · Owner draw (separate — Layer 4)</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Your current draw ({fmt(ownerSalary)}/mo)</span>
                <span className="font-mono text-purple-300">−{fmt(annualOwnerDraw)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Fair market benchmark</span>
                <span className="font-mono text-amber-300">−{fmt(FAIR_MARKET_OWNER_WAGE)}</span>
              </div>

              <div className="border-t border-gray-700 pt-2 mt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-300">Total incl your draw</span>
                  <span className="font-mono font-bold text-red-400">{fmt(fixedFloorIncOwner)}</span>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Break-even utilisation (by wage scenario)</p>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Owner £0 (business B/E only)</span>
                  <span className={`font-mono font-bold ${breakEvenUtilisation < 70 ? "text-green-400" : breakEvenUtilisation < 90 ? "text-amber-400" : "text-red-400"}`}>
                    {isFinite(breakEvenUtilisation) ? pct(breakEvenUtilisation) : "∞"}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">+ Your current draw</span>
                  <span className={`font-mono font-bold ${breakEvenUtilWithCurrentOwner < 95 ? "text-amber-400" : "text-red-400"}`}>
                    {isFinite(breakEvenUtilWithCurrentOwner) ? pct(breakEvenUtilWithCurrentOwner) : "∞"}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">+ Fair market £45k</span>
                  <span className={`font-mono font-bold ${breakEvenUtilAtFairMarket < 95 ? "text-amber-400" : "text-red-400"}`}>
                    {isFinite(breakEvenUtilAtFairMarket) ? pct(breakEvenUtilAtFairMarket) : "∞"}
                  </span>
                </div>
                <div className="flex justify-between text-xs pt-1">
                  <span className="text-gray-500">Hrs/yr to cover business floor</span>
                  <span className="font-mono text-gray-400">
                    {isFinite(breakEvenHoursPerYear) ? Math.round(breakEvenHoursPerYear) : "∞"}h ({isFinite(breakEvenHoursPerMonth) ? Math.round(breakEvenHoursPerMonth) : "∞"}h/mo)
                  </span>
                </div>
              </div>

              <div className="bg-gray-800/30 rounded p-2 mt-3">
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  {breakEvenUtilisation < 70
                    ? `✅ Business floor covered at ${Math.round(breakEvenUtilisation)}% util. Operating leverage gets stronger as you add handymen — the floor spreads across more hours.`
                    : breakEvenUtilisation < 100
                    ? `⚠ You need ${Math.round(breakEvenUtilisation)}% utilisation just to cover the business floor. Little room for quiet months.`
                    : `🔴 BROKEN: business floor requires ${Math.round(breakEvenUtilisation)}% utilisation — mathematically impossible. Cut fixed or raise contribution/hr.`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 2 — Owner Wage Break-Even + Category Mix */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Owner Wage Break-Even */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-400" />
                Layer 4 · Owner Wage Break-Even
              </CardTitle>
              <CardDescription className="text-xs">
                The HONEST metric: profit after paying yourself for the risk you carry.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Current draw vs fair market comparison header */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-purple-900/40 bg-purple-950/20 p-2">
                  <p className="text-[10px] uppercase tracking-wide text-purple-300">Your draw</p>
                  <p className="text-base font-mono font-bold text-purple-200">{fmt(annualOwnerDraw)}</p>
                  <p className="text-[10px] text-gray-500">{fmt(ownerSalary)}/mo · from main slider</p>
                </div>
                <div className="rounded border border-amber-900/40 bg-amber-950/20 p-2">
                  <p className="text-[10px] uppercase tracking-wide text-amber-300">Fair market</p>
                  <p className="text-base font-mono font-bold text-amber-200">{fmt(FAIR_MARKET_OWNER_WAGE)}</p>
                  <p className="text-[10px] text-gray-500">UK handyman business owner</p>
                </div>
              </div>

              {/* Gap indicator */}
              <div className={`rounded p-2 border ${ownerWageGap < 0 ? "bg-red-950/20 border-red-900/40" : "bg-green-950/20 border-green-900/40"}`}>
                <p className="text-[11px] leading-relaxed">
                  {ownerWageGap < 0
                    ? <span className="text-red-300"><b>⚠ Underpaying yourself by {fmt(Math.abs(Math.round(ownerWageGap)))}/yr</b> vs fair market. Any "profit" below your honest line is subsidised by your unpaid labour.</span>
                    : <span className="text-green-300"><b>✓ Paying yourself {fmt(Math.round(ownerWageGap))} above fair market.</b> If honest profit is positive at this level, the business is genuinely viable.</span>}
                </p>
              </div>

              {/* Match fair market button */}
              {ownerSalary !== Math.round(FAIR_MARKET_OWNER_WAGE / 12) && (
                <button
                  type="button"
                  onClick={() => setOwnerSalary(Math.round(FAIR_MARKET_OWNER_WAGE / 12))}
                  className="w-full text-[11px] py-1.5 rounded border border-amber-700/60 bg-amber-900/20 text-amber-200 hover:bg-amber-900/40 transition-colors"
                >
                  Match fair market wage ({fmt(Math.round(FAIR_MARKET_OWNER_WAGE / 12))}/mo) →
                </button>
              )}

              {/* Honest P&L — uses annualOwnerDraw (the ACTUAL current draw) */}
              <div className="space-y-1.5 pt-2 border-t border-gray-800">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Honest P&L (current draw)</p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Gross contribution /yr</span>
                  <span className="font-mono text-green-400">+{fmt(Math.round(grossContributionAnnual))}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">− Handymen ({numHandymen})</span>
                  <span className="font-mono text-red-400">−{fmt(handymenAnnualCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">− Business overheads (ex owner)</span>
                  <span className="font-mono text-red-400">−{fmt(businessOverheadsExOwner)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-gray-800 pt-1.5">
                  <span className="text-gray-300">Net before owner draw</span>
                  <span className={`font-mono font-semibold ${netBeforeOwnerWage >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmt(Math.round(netBeforeOwnerWage))}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">− Your owner draw</span>
                  <span className="font-mono text-purple-300">−{fmt(annualOwnerDraw)}</span>
                </div>
                <div className="flex justify-between text-base border-t border-gray-700 pt-2 mt-1">
                  <span className="font-bold text-gray-200">= HONEST PROFIT</span>
                  <span className={`font-mono font-bold ${honestProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmt(Math.round(honestProfit))}
                  </span>
                </div>
                <div className="flex justify-between text-xs pt-1">
                  <span className="text-gray-500">Benchmark · profit at £45k wage</span>
                  <span className={`font-mono ${profitAtFairMarketWage >= 0 ? "text-amber-300" : "text-red-400"}`}>
                    {fmt(Math.round(profitAtFairMarketWage))}
                  </span>
                </div>
              </div>

              <div className={`rounded p-2 mt-2 ${profitAtFairMarketWage >= 0 ? "bg-green-950/30 border border-green-900/40" : "bg-red-950/30 border border-red-900/40"}`}>
                <p className="text-[11px] leading-relaxed">
                  {profitAtFairMarketWage >= 0
                    ? <span className="text-green-300">✅ Viable at fair market: Even if you paid yourself {fmt(FAIR_MARKET_OWNER_WAGE)}/yr, the business still generates {fmt(Math.round(profitAtFairMarketWage))} profit. This is real.</span>
                    : <span className="text-red-300">🔴 BROKEN at fair market: At £45k owner wage, the business loses {fmt(Math.abs(Math.round(profitAtFairMarketWage)))}/yr. Your current "profit" is only real because you're underpaying yourself.</span>}
                </p>
              </div>

              <div className="bg-gray-800/30 rounded p-2 text-[11px] text-gray-400">
                <p className="font-semibold text-gray-300 text-[10px] uppercase tracking-wide mb-1">Break-even utilisation</p>
                <div className="flex justify-between">
                  <span>Business floor only</span>
                  <span className="font-mono">{isFinite(breakEvenUtilisation) ? pct(breakEvenUtilisation) : "∞"}</span>
                </div>
                <div className="flex justify-between">
                  <span>+ Your draw ({fmt(annualOwnerDraw)})</span>
                  <span className={`font-mono font-bold ${breakEvenUtilWithCurrentOwner < 95 ? "text-amber-400" : "text-red-400"}`}>
                    {isFinite(breakEvenUtilWithCurrentOwner) ? pct(breakEvenUtilWithCurrentOwner) : "∞"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>+ Fair market (£45k)</span>
                  <span className={`font-mono font-bold ${breakEvenUtilAtFairMarket < 95 ? "text-amber-400" : "text-red-400"}`}>
                    {isFinite(breakEvenUtilAtFairMarket) ? pct(breakEvenUtilAtFairMarket) : "∞"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Category Mix — the hidden pricing lever */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-green-400" />
                Category Mix — Hidden Pricing Lever
              </CardTitle>
              <CardDescription className="text-xs">
                Your blended rate is <span className="text-green-400">{fmtDec(blendedRevenuePerHour)}/h</span>. Shifting mix toward high-£/h categories raises it without raising prices.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {categoryMix.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4">No category data available.</p>
              ) : (
                <>
                  {categoryMix.map((c) => {
                    const lifts = c.vsBlended > 0;
                    const widthPct = Math.min(100, (c.revenuePerHour / Math.max(...categoryMix.map((x) => x.revenuePerHour))) * 100);
                    return (
                      <div key={c.label}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="text-gray-300 truncate flex-1">{prettyCat(c.label)}</span>
                          <span className="font-mono text-white ml-2">{fmtDec(c.revenuePerHour)}/h</span>
                          <span className={`ml-2 text-[10px] font-mono w-14 text-right ${lifts ? "text-green-400" : "text-red-400"}`}>
                            {lifts ? "+" : ""}{fmtDec(c.vsBlended)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundColor: c.colour, opacity: 0.85 }} />
                          </div>
                          <span className="text-[10px] text-gray-500 font-mono w-12 text-right">{c.share.toFixed(0)}% hrs</span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="bg-gray-800/30 rounded p-2 mt-3">
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      <b className="text-green-400">Green</b> categories lift your blended rate. <b className="text-red-400">Red</b> drag it down.
                      If you shift 10% of hours from the lowest-£/h to the highest-£/h category, you raise blended rate by ~
                      <span className="text-green-400 font-bold">
                        {categoryMix.length >= 2
                          ? fmtDec((categoryMix[0].revenuePerHour - categoryMix[categoryMix.length - 1].revenuePerHour) * 0.1)
                          : fmtDec(0)}/h
                      </span>{" "}
                      — pure margin, no price rises.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 3 — Break-Even Curve + Scalability Verdict */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* Break-Even Curve */}
          <Card className="bg-gray-900 border-gray-800 md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                Layer 2 · Profit vs Utilisation
              </CardTitle>
              <CardDescription className="text-xs">
                Where do 1/2/3 handymen break even? Where does each rung start making real money?
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BreakEvenCurve
                monthlyHoursPerPerson={monthlyProductiveHoursPerPerson}
                contributionPerHour={contributionPerHour}
                businessOverheadsExOwner={businessOverheadsExOwner}
                handymanCost={EMP_ANNUAL_COST_PER_PERSON}
                currentUtilisation={teamProductiveHours > 0 ? (demandHoursPerMonth / teamProductiveHours) * 100 : 0}
                currentTeamSize={numHandymen}
                currentOwnerDraw={annualOwnerDraw}
                fairMarketWage={FAIR_MARKET_OWNER_WAGE}
              />
            </CardContent>
          </Card>

          {/* Scalability Verdict */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" style={{ color: BRAND_GREEN }} />
                Scalability Verdict
              </CardTitle>
              <CardDescription className="text-xs">Go / no-go on scaling.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <VerdictRow
                label="Per-Hour"
                status={contributionMarginPct >= 40 ? "green" : contributionMarginPct >= 25 ? "amber" : "red"}
                detail={`${fmtDec(contributionPerHour)}/h · ${pct(contributionMarginPct)} margin`}
              />
              <VerdictRow
                label="Per-Handyman"
                status={breakEvenUtilisation < 70 ? "green" : breakEvenUtilisation < 95 ? "amber" : "red"}
                detail={`Business B/E at ${isFinite(breakEvenUtilisation) ? pct(breakEvenUtilisation) : "∞"} util`}
              />
              <VerdictRow
                label="Per-Business"
                status={netBeforeOwnerWage > 0 ? "green" : "red"}
                detail={`${fmt(Math.round(netBeforeOwnerWage))} before owner draw`}
              />
              <VerdictRow
                label="Per-Owner (current)"
                status={honestProfit > 0 ? "green" : honestProfit > -10000 ? "amber" : "red"}
                detail={`${fmt(Math.round(honestProfit))} after ${fmt(annualOwnerDraw)} draw`}
              />
              <VerdictRow
                label="Per-Owner (fair market)"
                status={profitAtFairMarketWage > 0 ? "green" : profitAtFairMarketWage > -10000 ? "amber" : "red"}
                detail={`${fmt(Math.round(profitAtFairMarketWage))} at £45k wage`}
              />

              <div className="border-t border-gray-800 pt-2 mt-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Stage 1 Verdict</p>
                <p className={`text-sm font-bold ${
                  contributionMarginPct >= 40 && netBeforeOwnerWage > 0 && profitAtFairMarketWage > 0
                    ? "text-green-400"
                    : contributionMarginPct >= 25 && netBeforeOwnerWage > 0
                    ? "text-amber-400"
                    : "text-red-400"
                }`}>
                  {contributionMarginPct < 25
                    ? "❌ Do not scale — unit economics broken"
                    : profitAtFairMarketWage > 0
                    ? "✅ Scalable — viable even at fair market wage"
                    : netBeforeOwnerWage > 0
                    ? "⚠ Underpaying yourself — scale past current team to reach fair market viability"
                    : "🔴 Fix unit before adding headcount"}
                </p>
                <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
                  {profitAtFairMarketWage > 0
                    ? `At ${numHandymen} handymen, the business pays a ${fmt(FAIR_MARKET_OWNER_WAGE)} fair market wage AND keeps ${fmt(Math.round(profitAtFairMarketWage))} profit.`
                    : contributionMarginPct >= 25
                    ? `Unit is sound but revenue is too thin for ${numHandymen} handymen + ${fmt(FAIR_MARKET_OWNER_WAGE)} fair market wage. Scale handymen or raise avg job value.`
                    : `Contribution per hour is only ${fmtDec(contributionPerHour)}. Adding handymen would multiply losses.`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ================================================================== */}
      {/* SECTION B: Labour Model Comparison                                 */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Users className="h-5 w-5" style={{ color: BRAND_GREEN }} />
          Labour Model Comparison
        </h2>

        <Card className="bg-gray-900 border-gray-800 mb-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-300">Adjust Assumptions</CardTitle>
            <CardDescription className="text-xs">Materials are customer-funded. These control labour split models.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <LabelledSlider label="Quotes Sent /mo" value={quotesPerMonth} min={10} max={150} step={5} onChange={setQuotesPerMonth} format={(v) => `${v} quotes/mo`} />
              <LabelledSlider label="Conversion Rate" value={conversionPct} min={5} max={100} step={1} onChange={setConversionPct}
                format={(v) => `${v}% → ${Math.round(quotesPerMonth * (v / 100))} jobs/mo`} />
              <LabelledSlider label="Average Job Value" value={avgJobValue} min={100} max={500} step={5} onChange={setAvgJobValue} format={fmt} />
              <LabelledSlider label="Contractor Gets (% of Labour)" value={contractorSplit} min={30} max={80} step={5} onChange={setContractorSplit}
                format={(v) => `${v}% to contractor · ${100 - v}% to you`} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 pt-4 border-t border-gray-800">
              <LabelledSlider label="Ben — Base Salary" value={benBase} min={0} max={1500} step={50}
                onChange={setBenBase} format={(v) => `${fmt(v)}/mo (${fmt(v * 12)}/yr)`} />
              <LabelledSlider label="Ben — % of Labour Charge" value={benLabourPct} min={0} max={15} step={1}
                onChange={setBenLabourPct} format={(v) => `${v}% of labour → ${fmt(Math.round(avgJobValue * (1 - (materialsPctOfRevenue / 100)) * (v / 100)))}/avg job`} />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Ben earns {fmt(benBase)}/mo base + {benLabourPct}% of labour charge.
              At {monthlyJobs} jobs/mo: <span className="font-semibold text-gray-300">{fmt(Math.round((benBase) + monthlyJobs * avgJobValue * (1 - materialsPctOfRevenue / 100) * (benLabourPct / 100)))}/mo</span>
            </p>

            <div className="mt-4 pt-4 border-t border-gray-800">
              <p className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wide">
                Monthly Overheads — {fmt(monthlyOverheads)}/mo ({fmt(monthlyOverheads * 12)}/yr)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <LabelledSlider label="Your Salary (Owner Draw)" value={ownerSalary} min={0} max={5000} step={100} onChange={setOwnerSalary} format={(v) => `${fmt(v)}/mo (${fmt(v * 12)}/yr)`} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <LabelledSlider label="Marketing" value={marketingSpend} min={0} max={2000} step={50} onChange={setMarketingSpend} format={(v) => `${fmt(v)}/mo`} />
                <LabelledSlider label="Software & Tools" value={softwareCost} min={0} max={500} step={10} onChange={setSoftwareCost} format={(v) => `${fmt(v)}/mo`} />
                <LabelledSlider label="Insurance" value={insuranceCost} min={0} max={500} step={10} onChange={setInsuranceCost} format={(v) => `${fmt(v)}/mo`} />
                <LabelledSlider label="Other (phone, fuel)" value={otherOverheads} min={0} max={1000} step={25} onChange={setOtherOverheads} format={(v) => `${fmt(v)}/mo`} />
              </div>
              <p className="text-xs text-gray-500 mt-2">Net profit below = true business profit after everyone (you, Ben, contractors) is paid.</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {models.map((m) => <ModelCard key={m.title} model={m} />)}
        </div>
      </section>

      {/* ================================================================== */}
      {/* SECTION C: Growth Forecast                                         */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5" style={{ color: BRAND_GREEN }} />
          Growth Forecast
        </h2>

        <Card className="bg-gray-900 border-gray-800 mb-5">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-300">Additional Revenue Streams</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <LabelledSlider label="Landlord Platform Properties" value={landlordProperties} min={0} max={50} step={1}
                onChange={setLandlordProperties} format={(v) => `${v} props @ ${fmt(95)}/mo = ${fmt(v * 95)}/mo`} />
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Emergency Premium (Built-In)</span>
                  <span className="text-white font-semibold">15% of jobs at +35% uplift</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Already in contextual pricing engine · ~{fmt(monthlyJobs * avgJobValue * 0.15 * 0.35)}/mo</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-800">
              <p className="text-xs text-gray-400 font-semibold mb-3 uppercase tracking-wide">Territory Expansion (Fixed Costs)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <LabelledSlider label="Additional Territories" value={additionalTerritories} min={0} max={5} step={1}
                  onChange={setAdditionalTerritories} format={(v) => v === 0 ? "Nottingham only" : `+${v} territor${v > 1 ? "ies" : "y"}`} />
                <LabelledSlider label="Fixed Cost Per Territory" value={territoryFixedCost} min={500} max={3000} step={100}
                  onChange={setTerritoryFixedCost} format={(v) => `${fmt(v)}/mo (marketing, van, insurance)`} />
              </div>
              {additionalTerritories > 0 && (
                <p className="text-xs text-gray-500 mt-2">{additionalTerritories} × {fmt(territoryFixedCost)}/mo = {fmt(additionalTerritories * territoryFixedCost)}/mo extra</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-800 overflow-x-auto">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {["Scale","Jobs/mo","Annual Rev","Contractor","Mat Profit","Landlord","Emergency","Ben","Net Profit","Margin"].map((h, i) => (
                    <th key={h} className={`text-${i === 0 ? "left" : "right"} text-gray-400 font-medium p-4 text-xs uppercase tracking-wide ${i >= 3 && i <= 6 ? "hidden md:table-cell" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {growthTable.map((row) => (
                  <tr key={row.scale} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="p-4"><Badge variant="outline" className="border-gray-600 text-white font-bold" style={row.scale === "1X" ? { borderColor: BRAND_GREEN, color: BRAND_GREEN } : {}}>{row.scale}</Badge></td>
                    <td className="p-4 text-right text-gray-300 font-mono">{row.monthlyJobs}</td>
                    <td className="p-4 text-right text-white font-mono font-semibold">{fmt(row.annualRevenue)}</td>
                    <td className="p-4 text-right text-gray-400 font-mono hidden md:table-cell">{fmt(row.contractorCost)}</td>
                    <td className="p-4 text-right text-blue-400 font-mono hidden md:table-cell">+{fmt(row.materialsProfit)}</td>
                    <td className="p-4 text-right text-purple-400 font-mono hidden md:table-cell">{row.landlordProfit > 0 ? `+${fmt(row.landlordProfit)}` : "—"}</td>
                    <td className="p-4 text-right text-amber-400 font-mono hidden md:table-cell">+{fmt(row.emergencyUplift)}</td>
                    <td className="p-4 text-right text-orange-400 font-mono">{fmt(row.benCommission)} <span className="text-[10px] text-gray-500">({fmt(row.benCommission / 12)}/mo)</span></td>
                    <td className={`p-4 text-right font-mono font-bold ${row.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(row.netProfit)}</td>
                    <td className={`p-4 text-right font-mono ${row.profitMargin >= 0 ? "text-green-400" : "text-red-400"}`}>{pct(row.profitMargin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* ================================================================== */}
      {/* SECTION D: Hiring Decision                                         */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Building2 className="h-5 w-5" style={{ color: BRAND_GREEN }} />
          Hiring Decision: Employed vs Subcontractor
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Break-Even (Employed)</p>
              <p className="text-4xl font-bold text-white">{hiringDecision.breakEvenJobs}</p>
              <p className="text-sm text-gray-400 mt-1">jobs/month</p>
              <p className="text-sm text-amber-400 mt-2 font-semibold">{hiringDecision.breakEvenConversion}% conversion</p>
              <p className="text-xs text-gray-500 mt-1">at {quotesPerMonth} quotes/mo, {fmt(avgJobValue)} avg, {contractorSplit}% split</p>
            </CardContent>
          </Card>
          <Card className={`border ${hiringDecision.justifiesHiring ? "bg-green-950/30 border-green-800" : "bg-red-950/30 border-red-800"}`}>
            <CardContent className="p-5 text-center">
              <div className="flex justify-center mb-3">
                {hiringDecision.justifiesHiring ? <CheckCircle2 className="h-10 w-10 text-green-400" /> : <AlertTriangle className="h-10 w-10 text-red-400" />}
              </div>
              <p className={`text-lg font-bold ${hiringDecision.justifiesHiring ? "text-green-400" : "text-red-400"}`}>
                {hiringDecision.justifiesHiring ? "Volume Justifies Hiring" : "Not Yet — Need More Volume"}
              </p>
              <p className="text-sm text-gray-400 mt-2">
                {hiringDecision.currentJobs} jobs/mo ({conversionPct}%) {hiringDecision.justifiesHiring ? ">" : "<"} {hiringDecision.breakEvenJobs} break-even ({hiringDecision.breakEvenConversion}%)
              </p>
              {hiringDecision.margin !== 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {hiringDecision.justifiesHiring
                    ? `${hiringDecision.margin} jobs above — you could hire now`
                    : `Need ${Math.abs(hiringDecision.margin)} more jobs or push conversion to ${hiringDecision.breakEvenConversion}%`}
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-5 text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Employed Monthly Cost</p>
              <p className="text-4xl font-bold text-white">{fmt(hiringDecision.monthlyBurn)}</p>
              <p className="text-sm text-gray-400 mt-1">per month fixed</p>
              <div className="mt-3 space-y-1 text-xs text-gray-500 text-left">
                <div className="flex justify-between"><span>Salary</span><span className="font-mono">{fmt(32000 / 12)}/mo</span></div>
                <div className="flex justify-between"><span>NI/Pension</span><span className="font-mono">{fmt(6400 / 12)}/mo</span></div>
                <div className="flex justify-between"><span>Van</span><span className="font-mono">{fmt(4800 / 12)}/mo</span></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ================================================================== */}
      {/* SECTION E: Cash Flow                                               */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5" style={{ color: BRAND_GREEN }} />
          Cash Flow Cycle
        </h2>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="p-6">
            {/* Timeline */}
            <div className="flex items-center justify-between mb-6 overflow-x-auto">
              {[
                { label: "Quote Accepted", sub: "Day 0", colour: "#3B82F6" },
                { label: "Deposit Paid", sub: "Day 0-1", colour: BRAND_GREEN },
                { label: "Materials Bought", sub: "Day 1-3", colour: "#F59E0B" },
                { label: "Job Completed", sub: "Day 3-7", colour: "#8B5CF6" },
                { label: "Contractor Paid", sub: "On completion", colour: "#EF4444" },
                { label: "Balance Collected", sub: "On completion", colour: BRAND_GREEN },
              ].map((step, i) => (
                <div key={step.label} className="flex items-center flex-shrink-0">
                  <div className="text-center">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm mx-auto" style={{ backgroundColor: step.colour }}>
                      {i + 1}
                    </div>
                    <p className="text-xs text-gray-300 mt-2 font-medium max-w-[80px]">{step.label}</p>
                    <p className="text-[10px] text-gray-500">{step.sub}</p>
                  </div>
                  {i < 5 && <div className="w-8 h-0.5 bg-gray-700 mx-1 flex-shrink-0" />}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-green-400 font-semibold text-xs uppercase mb-1">Cash In</p>
                <p className="text-gray-300">Deposit covers materials + partial labour upfront. Balance on completion. <span className="text-green-400">You're never out of pocket on materials.</span></p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-amber-400 font-semibold text-xs uppercase mb-1">Cash Out</p>
                <p className="text-gray-300">Materials bought from deposit funds. Contractor paid after completion. <span className="text-amber-400">Gap risk: if job overruns, labour cost hits before balance.</span></p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-4">
                <p className="text-blue-400 font-semibold text-xs uppercase mb-1">Key Risk</p>
                <p className="text-gray-300">Scaling to 4X means more cash tied up in in-progress jobs. <span className="text-blue-400">With employed model, salary is due regardless of job flow.</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ================================================================== */}
      {/* SECTION F: Seasonality & Capacity                                  */}
      {/* ================================================================== */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Gauge className="h-5 w-5" style={{ color: BRAND_GREEN }} />
          Capacity & Seasonality
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Capacity Planning — Hours-based, team-aware */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">Capacity Planning (Hours × Team)</CardTitle>
              <CardDescription className="text-xs">
                Capacity in hours on tools × team size. Charge rate comes from{" "}
                <span className="text-green-400">real booking data</span>
                {metrics?.avgHourlyRate ? ` (${fmtDec(metrics.avgHourlyRate)}/hr)` : " (default £35/hr)"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <LabelledSlider label="Working Hours /week" value={workingHoursPerWeek} min={20} max={60} step={1}
                  onChange={setWorkingHoursPerWeek} format={(v) => `${v} hrs/week`} />
                <LabelledSlider label="Working Weeks /year" value={workingWeeksPerYear} min={40} max={52} step={1}
                  onChange={setWorkingWeeksPerYear} format={(v) => `${v} wks (${52 - v} off for holiday/sick)`} />
                <LabelledSlider label="Productive %" value={productivePct} min={40} max={100} step={5}
                  onChange={setProductivePct} format={(v) => `${v}% on-tools (travel/admin drains the rest)`} />
                <div>
                  <LabelledSlider label="Team Size (Handymen)" value={numHandymen} min={1} max={6} step={1}
                    onChange={setNumHandymen}
                    format={(v) => v === 1 ? `1 handyman` : `${v} handymen`} />
                  {recommendedHandymen !== numHandymen && (
                    <button
                      type="button"
                      onClick={() => setNumHandymen(recommendedHandymen)}
                      className={`text-[10px] mt-1 ${recommendedHandymen > numHandymen ? "text-red-400 hover:text-red-300" : "text-amber-400 hover:text-amber-300"}`}
                    >
                      {recommendedHandymen > numHandymen
                        ? `⚠ Current demand needs ${recommendedHandymen} — click to hire up`
                        : `Current demand only needs ${recommendedHandymen} — click to right-size`}
                    </button>
                  )}
                </div>
              </div>

              {/* The derivation — transparent so it's not magic */}
              <div className="bg-gray-800/30 border border-gray-800 rounded-lg p-3 text-xs font-mono leading-relaxed">
                <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">Derivation</div>
                <div className="text-gray-400">
                  Paid hrs/mo /person <span className="text-gray-600">=</span>{" "}
                  <span className="text-white">{workingHoursPerWeek}</span>
                  <span className="text-gray-500">×</span>
                  <span className="text-white">{workingWeeksPerYear}</span>
                  <span className="text-gray-500">÷12 =</span>{" "}
                  <span className="text-white">{monthlyContractedHours}h</span>
                </div>
                <div className="text-gray-400">
                  On-tools hrs /person <span className="text-gray-600">=</span>{" "}
                  <span className="text-white">{monthlyContractedHours}</span>
                  <span className="text-gray-500">×</span>
                  <span className="text-white">{productivePct}%</span>
                  <span className="text-gray-500">=</span>{" "}
                  <span className="text-white">{monthlyProductiveHoursPerPerson}h</span>
                </div>
                <div className="text-gray-400">
                  <b className="text-gray-300">Team</b> on-tools hrs <span className="text-gray-600">=</span>{" "}
                  <span className="text-white">{monthlyProductiveHoursPerPerson}h</span>
                  <span className="text-gray-500">×</span>
                  <span className="text-white">{numHandymen}</span>
                  <span className="text-gray-500">=</span>{" "}
                  <span className="text-green-400 font-bold">{teamProductiveHours}h</span>
                </div>
                <div className="text-gray-400 pt-1 border-t border-gray-800 mt-1">
                  Charge rate /hr <span className="text-gray-600">=</span>{" "}
                  <span className="text-white">{fmtDec(customerChargePerHour)}</span>
                  <span className="text-gray-500 text-[9px]"> (from data)</span>
                </div>
                <div className="text-gray-400">
                  Emp cost /hr <span className="text-gray-600">=</span>{" "}
                  <span className="text-white">£3,600</span>
                  <span className="text-gray-500">÷</span>
                  <span className="text-white">{monthlyProductiveHoursPerPerson}h</span>
                  <span className="text-gray-500">=</span>{" "}
                  <span className="text-white">{fmtDec(empCostPerHour)}</span>
                </div>
                <div className="text-gray-400">
                  Margin /hr <span className="text-gray-600">=</span>{" "}
                  <span className="text-white">{fmtDec(customerChargePerHour)}</span>
                  <span className="text-gray-500">−</span>
                  <span className="text-white">{fmtDec(empCostPerHour)}</span>
                  <span className="text-gray-500">=</span>{" "}
                  <span className={`font-bold ${marginPerHour >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmtDec(marginPerHour)}/h
                  </span>
                </div>
                <div className="text-gray-400 pt-1 border-t border-gray-800 mt-1">
                  Demand hrs/mo <span className="text-gray-600">=</span>{" "}
                  <span className="text-white">{fmt(monthlyLabourRev)}</span>
                  <span className="text-gray-500">÷</span>
                  <span className="text-white">{fmtDec(customerChargePerHour)}/h</span>
                  <span className="text-gray-500">=</span>{" "}
                  <span className="text-amber-400 font-bold">{Math.round(demandHoursPerMonth)}h</span>
                </div>
                <div className="text-gray-400">
                  Max jobs/mo <span className="text-gray-600">=</span>{" "}
                  <span className="text-amber-400 font-bold">{maxJobsPerMonth} jobs</span>
                  <span className="text-gray-500"> @ team capacity</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-white">{teamProductiveHours}h</p>
                  <p className="text-[10px] text-gray-500 uppercase">
                    Team Hrs /mo ({numHandymen}×{monthlyProductiveHoursPerPerson}h)
                  </p>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold" style={{ color: BRAND_GREEN }}>{fmtDec(marginPerHour)}</p>
                  <p className="text-[10px] text-gray-500 uppercase">Margin /hr</p>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-400">{maxJobsPerMonth}</p>
                  <p className="text-[10px] text-gray-500 uppercase">Max Jobs /mo</p>
                </div>
              </div>

              {/* Current demand bar */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">Current demand</span>
                  <span className="font-mono text-white">
                    {Math.round(demandHoursPerMonth)}h / {teamProductiveHours}h
                    <span className="text-gray-500 ml-2">
                      ({teamProductiveHours > 0 ? Math.round((demandHoursPerMonth / teamProductiveHours) * 100) : 0}%)
                    </span>
                  </span>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden relative">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, teamProductiveHours > 0 ? (demandHoursPerMonth / teamProductiveHours) * 100 : 0)}%`,
                      backgroundColor: demandHoursPerMonth > teamProductiveHours
                        ? "#EF4444"
                        : demandHoursPerMonth > teamProductiveHours * 0.9
                        ? "#F59E0B"
                        : BRAND_GREEN,
                    }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  {fmt(monthlyLabourRev)} labour ÷ {fmtDec(customerChargePerHour)}/hr = {Math.round(demandHoursPerMonth)}h needed
                  {recommendedHandymen !== numHandymen && (
                    <span className={`ml-2 ${recommendedHandymen > numHandymen ? "text-red-400" : "text-amber-400"}`}>
                      → {recommendedHandymen} handymen recommended
                    </span>
                  )}
                </p>
              </div>

              {/* Hiring ladder visual */}
              <div className="bg-gray-800/30 border border-gray-800 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  Hiring Ladder
                </div>
                <div className="space-y-1.5">
                  {[1, 2, 3, 4].map((n) => {
                    const capHrs = monthlyProductiveHoursPerPerson * n;
                    const costMo = (EMP_ANNUAL_COST_PER_PERSON * n) / 12;
                    const covers = capHrs >= demandHoursPerMonth;
                    const isCurrent = n === numHandymen;
                    const isRecommended = n === recommendedHandymen;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setNumHandymen(n)}
                        className={`w-full flex items-center justify-between text-xs px-2 py-1.5 rounded transition-colors ${
                          isCurrent
                            ? "bg-green-900/30 border border-green-800/50"
                            : "bg-gray-800/50 hover:bg-gray-800 border border-transparent"
                        }`}
                      >
                        <span className="font-mono text-gray-300">
                          {n} {n === 1 ? "handyman" : "handymen"}
                        </span>
                        <span className="font-mono text-gray-400">
                          {capHrs}h · {fmt(costMo)}/mo
                        </span>
                        <span className={`text-[10px] ${covers ? "text-green-400" : "text-red-400"}`}>
                          {covers ? "✓ covers demand" : "✗ under"}
                        </span>
                        {isRecommended && !isCurrent && (
                          <Badge className="bg-amber-900/50 text-amber-300 text-[9px] h-4">REC</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Seasonality */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white flex items-center gap-2">
                <Snowflake className="h-4 w-4 text-blue-400" />
                Seasonality
              </CardTitle>
              <CardDescription className="text-xs">Flat "14 jobs/mo × 12" doesn't account for seasonal swings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {seasonality && seasonality.months >= 2 ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-800/50 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-1">Best Month</p>
                      <p className="text-lg font-bold text-green-400">{fmt(seasonality.maxRev)}</p>
                      <p className="text-[10px] text-gray-500">{seasonality.maxJobs} jobs</p>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-1">Worst Month</p>
                      <p className="text-lg font-bold text-red-400">{fmt(seasonality.minRev)}</p>
                      <p className="text-[10px] text-gray-500">{seasonality.minJobs} jobs</p>
                    </div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-400">Revenue Volatility</span>
                      <span className={`text-sm font-bold ${seasonality.volatility > 40 ? "text-red-400" : seasonality.volatility > 20 ? "text-amber-400" : "text-green-400"}`}>
                        {pct(seasonality.volatility)}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                      {seasonality.volatility > 40 ? "High variance — need cash reserves for quiet months"
                        : seasonality.volatility > 20 ? "Moderate — plan for 1-2 slow months per year"
                        : "Low variance — consistent demand"}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">
                    Based on {seasonality.months} months of data. Swing: {fmt(seasonality.minRev)} to {fmt(seasonality.maxRev)} ({fmt(seasonality.maxRev - seasonality.minRev)} spread).
                    {seasonality.volatility > 30 && " Consider building 2 months of overheads as cash reserve."}
                  </p>
                </>
              ) : (
                <div className="text-center py-6">
                  <Snowflake className="h-8 w-8 text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">Need 2+ months of booking data to show seasonal patterns.</p>
                  <p className="text-xs text-gray-600 mt-1">Typical UK handyman seasonality: busy Q1 (new year projects), Q4 (pre-Christmas). Quiet Aug, Dec.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
