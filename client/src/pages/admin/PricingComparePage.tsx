import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FlaskConical,
  Loader2,
  RotateCcw,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
  ShieldCheck,
  ShieldAlert,
  Brain,
  Layers,
  ChevronDown,
  ChevronUp,
  Gauge,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Equal,
  Quote,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Beaker,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  PricingContext,
  PricingComparisonResult,
  TestScenario,
  PricingAdjustmentFactor,
  JobCategory,
} from '../../../../shared/contextual-pricing-types';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatPence(pence: number): string {
  return `\u00A3${(pence / 100).toFixed(2)}`;
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}hr`;
  return `${h}hr ${m}min`;
}

const CATEGORY_LABELS: Record<string, string> = {
  general_fixing: 'General Fixing',
  flat_pack: 'Flat Pack Assembly',
  tv_mounting: 'TV Mounting',
  carpentry: 'Carpentry',
  plumbing_minor: 'Plumbing (Minor)',
  electrical_minor: 'Electrical (Minor)',
  painting: 'Painting',
  tiling: 'Tiling',
  plastering: 'Plastering',
  lock_change: 'Lock Change',
  guttering: 'Guttering',
  pressure_washing: 'Pressure Washing',
  fencing: 'Fencing',
  garden_maintenance: 'Garden Maintenance',
  bathroom_fitting: 'Bathroom Fitting',
  kitchen_fitting: 'Kitchen Fitting',
  other: 'Other',
};

const SEGMENT_OPTIONS = [
  'BUSY_PRO',
  'PROP_MGR',
  'LANDLORD',
  'SMALL_BIZ',
  'DIY_DEFERRER',
  'BUDGET',
  'UNKNOWN',
];

const DEFAULT_CONTEXT: PricingContext = {
  jobDescription: '',
  jobCategory: 'general_fixing',
  timeEstimateMinutes: 60,
  jobCountInBatch: 1,
  segment: 'UNKNOWN',
  isReturningCustomer: false,
  previousJobCount: 0,
  previousAvgPricePence: null,
  urgency: 'standard',
  accessDifficulty: 'standard',
  materialsSupply: 'labor_only',
  timeOfService: 'standard',
  travelDistanceMiles: 5,
  currentCapacityPercent: 50,
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function PricingComparePage() {
  const [context, setContext] = useState<PricingContext>({ ...DEFAULT_CONTEXT });
  const [result, setResult] = useState<PricingComparisonResult | null>(null);
  const [scenarios, setScenarios] = useState<TestScenario[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  // Fetch scenarios + categories on mount
  useEffect(() => {
    fetch('/api/pricing/scenarios')
      .then((r) => r.json())
      .then(setScenarios)
      .catch(() => {});
    fetch('/api/pricing/categories')
      .then((r) => r.json())
      .then(setCategories)
      .catch(() => {});
  }, []);

  const compareMutation = useMutation({
    mutationFn: async (ctx: PricingContext) => {
      const res = await fetch('/api/pricing/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ctx),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Comparison failed');
      }
      return res.json() as Promise<PricingComparisonResult>;
    },
    onSuccess: (data) => {
      setResult(data);
    },
  });

  const updateContext = <K extends keyof PricingContext>(
    key: K,
    value: PricingContext[K],
  ) => {
    setContext((prev) => ({ ...prev, [key]: value }));
  };

  const loadScenario = (scenario: TestScenario) => {
    setContext({ ...scenario.context });
    setResult(null);
  };

  const reset = () => {
    setContext({ ...DEFAULT_CONTEXT });
    setResult(null);
  };

  const runComparison = () => {
    compareMutation.mutate(context);
  };

  // Previous avg price displayed in pounds for UX
  const prevAvgPounds =
    context.previousAvgPricePence !== null
      ? (context.previousAvgPricePence / 100).toFixed(2)
      : '';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ─── Header ─── */}
      <div className="border-b border-gray-800/60 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Pricing Lab
              </h1>
              <p className="text-xs text-gray-500">
                EVE vs Contextual engine comparison
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              className="text-gray-400 hover:text-white"
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={runComparison}
              disabled={
                compareMutation.isPending || !context.jobDescription.trim()
              }
              className="bg-amber-500 hover:bg-amber-400 text-black font-medium"
            >
              {compareMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <FlaskConical className="w-4 h-4 mr-1" />
              )}
              Compare Prices
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* LEFT: Input Panel                                             */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="xl:col-span-4 space-y-4">
            {/* Scenarios */}
            {scenarios.length > 0 && (
              <Card className="bg-gray-900/50 border-gray-800/60">
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quick Scenarios
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {scenarios.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => loadScenario(s)}
                        className="px-2.5 py-1 rounded-md bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700/50 hover:border-gray-600 text-xs text-gray-300 hover:text-white transition-all"
                        title={s.description}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Job Signals */}
            <Card className="bg-gray-900/50 border-gray-800/60">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  Job Signals
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">
                    Job Description
                  </Label>
                  <Textarea
                    value={context.jobDescription}
                    onChange={(e) =>
                      updateContext('jobDescription', e.target.value)
                    }
                    placeholder="e.g. Kitchen tap leaking badly, tenant says water pooling..."
                    className="bg-gray-800/60 border-gray-700/50 text-sm min-h-[72px] resize-none placeholder:text-gray-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">
                      Category
                    </Label>
                    <Select
                      value={context.jobCategory}
                      onValueChange={(v) =>
                        updateContext('jobCategory', v as JobCategory)
                      }
                    >
                      <SelectTrigger className="bg-gray-800/60 border-gray-700/50 text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(categories.length > 0
                          ? categories
                          : Object.keys(CATEGORY_LABELS)
                        ).map((c) => (
                          <SelectItem key={c} value={c}>
                            {CATEGORY_LABELS[c] || c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">
                      Time Est.{' '}
                      <span className="text-gray-600">
                        ({formatMinutes(context.timeEstimateMinutes)})
                      </span>
                    </Label>
                    <Input
                      type="number"
                      min={15}
                      max={480}
                      step={15}
                      value={context.timeEstimateMinutes}
                      onChange={(e) =>
                        updateContext(
                          'timeEstimateMinutes',
                          parseInt(e.target.value) || 60,
                        )
                      }
                      className="bg-gray-800/60 border-gray-700/50 text-sm h-9"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">
                    Jobs in Batch
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={context.jobCountInBatch}
                    onChange={(e) =>
                      updateContext(
                        'jobCountInBatch',
                        parseInt(e.target.value) || 1,
                      )
                    }
                    className="bg-gray-800/60 border-gray-700/50 text-sm h-9 w-24"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Customer Signals */}
            <Card className="bg-gray-900/50 border-gray-800/60">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5" />
                  Customer Signals
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">
                    Segment
                  </Label>
                  <Select
                    value={context.segment}
                    onValueChange={(v) => updateContext('segment', v)}
                  >
                    <SelectTrigger className="bg-gray-800/60 border-gray-700/50 text-sm h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEGMENT_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-400">
                    Returning Customer
                  </Label>
                  <Switch
                    checked={context.isReturningCustomer}
                    onCheckedChange={(v) =>
                      updateContext('isReturningCustomer', v)
                    }
                  />
                </div>
                {context.isReturningCustomer && (
                  <div className="grid grid-cols-2 gap-3 pl-1 border-l-2 border-amber-500/30">
                    <div>
                      <Label className="text-xs text-gray-400 mb-1 block">
                        Prev. Jobs
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={context.previousJobCount}
                        onChange={(e) =>
                          updateContext(
                            'previousJobCount',
                            parseInt(e.target.value) || 0,
                          )
                        }
                        className="bg-gray-800/60 border-gray-700/50 text-sm h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-400 mb-1 block">
                        Avg Price (&pound;)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step={5}
                        value={prevAvgPounds}
                        onChange={(e) =>
                          updateContext(
                            'previousAvgPricePence',
                            e.target.value
                              ? Math.round(parseFloat(e.target.value) * 100)
                              : null,
                          )
                        }
                        placeholder="e.g. 75"
                        className="bg-gray-800/60 border-gray-700/50 text-sm h-9"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Situational Signals */}
            <Card className="bg-gray-900/50 border-gray-800/60">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Situational Signals
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">
                      Urgency
                    </Label>
                    <Select
                      value={context.urgency}
                      onValueChange={(v) =>
                        updateContext(
                          'urgency',
                          v as PricingContext['urgency'],
                        )
                      }
                    >
                      <SelectTrigger className="bg-gray-800/60 border-gray-700/50 text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="priority">Priority</SelectItem>
                        <SelectItem value="emergency">Emergency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">
                      Access
                    </Label>
                    <Select
                      value={context.accessDifficulty}
                      onValueChange={(v) =>
                        updateContext(
                          'accessDifficulty',
                          v as PricingContext['accessDifficulty'],
                        )
                      }
                    >
                      <SelectTrigger className="bg-gray-800/60 border-gray-700/50 text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="loft">Loft</SelectItem>
                        <SelectItem value="high_ceiling">
                          High Ceiling
                        </SelectItem>
                        <SelectItem value="crawlspace">Crawlspace</SelectItem>
                        <SelectItem value="no_parking">No Parking</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">
                      Materials
                    </Label>
                    <Select
                      value={context.materialsSupply}
                      onValueChange={(v) =>
                        updateContext(
                          'materialsSupply',
                          v as PricingContext['materialsSupply'],
                        )
                      }
                    >
                      <SelectTrigger className="bg-gray-800/60 border-gray-700/50 text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="labor_only">Labour Only</SelectItem>
                        <SelectItem value="customer_supplied">
                          Customer Supplied
                        </SelectItem>
                        <SelectItem value="we_supply">We Supply</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">
                      Time of Service
                    </Label>
                    <Select
                      value={context.timeOfService}
                      onValueChange={(v) =>
                        updateContext(
                          'timeOfService',
                          v as PricingContext['timeOfService'],
                        )
                      }
                    >
                      <SelectTrigger className="bg-gray-800/60 border-gray-700/50 text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="after_hours">
                          After Hours
                        </SelectItem>
                        <SelectItem value="weekend">Weekend</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">
                    Travel Distance{' '}
                    <span className="text-gray-600">
                      ({context.travelDistanceMiles} miles)
                    </span>
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={context.travelDistanceMiles}
                    onChange={(e) =>
                      updateContext(
                        'travelDistanceMiles',
                        parseInt(e.target.value) || 0,
                      )
                    }
                    className="bg-gray-800/60 border-gray-700/50 text-sm h-9 w-24"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Business Signals */}
            <Card className="bg-gray-900/50 border-gray-800/60">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Business Signals
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <Label className="text-xs text-gray-400 mb-2 block">
                  Current Capacity{' '}
                  <span
                    className={cn(
                      'font-mono',
                      context.currentCapacityPercent > 80
                        ? 'text-red-400'
                        : context.currentCapacityPercent > 50
                          ? 'text-amber-400'
                          : 'text-green-400',
                    )}
                  >
                    {context.currentCapacityPercent}%
                  </span>
                </Label>
                <Slider
                  value={[context.currentCapacityPercent]}
                  onValueChange={([v]) =>
                    updateContext('currentCapacityPercent', v)
                  }
                  min={0}
                  max={100}
                  step={5}
                  className="mt-1"
                />
                <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                  <span>Quiet</span>
                  <span>Busy</span>
                  <span>Slammed</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* RIGHT: Results Panel                                          */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="xl:col-span-8">
            {!result && !compareMutation.isPending && (
              <div className="flex flex-col items-center justify-center h-96 text-gray-600">
                <FlaskConical className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-sm">
                  Fill in the context and hit{' '}
                  <span className="text-amber-400">Compare Prices</span>
                </p>
                <p className="text-xs text-gray-700 mt-1">
                  Or pick a quick scenario to get started
                </p>
              </div>
            )}

            {compareMutation.isPending && (
              <div className="flex flex-col items-center justify-center h-96 text-gray-500">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-amber-400" />
                <p className="text-sm">
                  Running both engines...
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  LLM is reasoning about price
                </p>
              </div>
            )}

            {compareMutation.isError && (
              <div className="flex flex-col items-center justify-center h-96 text-red-400">
                <AlertTriangle className="w-10 h-10 mb-4" />
                <p className="text-sm">
                  {compareMutation.error?.message || 'Something went wrong'}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={runComparison}
                  className="mt-3 text-red-400"
                >
                  Try Again
                </Button>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* ── Delta Banner ── */}
                <DeltaBanner delta={result.delta} />

                {/* ── Price Cards ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <EVECard eve={result.eve} />
                  <ContextualCard contextual={result.contextual} />
                </div>

                {/* ── Layer Flow ── */}
                <LayerBreakdown
                  breakdown={result.contextual.layerBreakdown}
                />

                {/* ── Adjustment Factors ── */}
                {result.contextual.adjustmentFactors.length > 0 && (
                  <AdjustmentFactors
                    factors={result.contextual.adjustmentFactors}
                  />
                )}

                {/* ── Guardrails ── */}
                <GuardrailsPanel guardrails={result.contextual.guardrails} />

                {/* ── Full Reasoning ── */}
                <Card className="bg-gray-900/50 border-gray-800/60">
                  <button
                    onClick={() => setReasoningExpanded(!reasoningExpanded)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/30 transition-colors rounded-t-lg"
                  >
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5" />
                      Full Reasoning Chain
                    </span>
                    {reasoningExpanded ? (
                      <ChevronUp className="w-4 h-4 text-gray-600" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-600" />
                    )}
                  </button>
                  {reasoningExpanded && (
                    <CardContent className="px-4 pb-4 pt-0">
                      <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed bg-gray-800/40 rounded-md p-3 border border-gray-700/30">
                        {result.contextual.reasoning}
                      </pre>
                    </CardContent>
                  )}
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function DeltaBanner({
  delta,
}: {
  delta: PricingComparisonResult['delta'];
}) {
  const absPence = Math.abs(delta.pence);
  const absPercent = Math.abs(delta.percent);

  let bg = 'bg-blue-500/8 border-blue-500/20';
  let textColor = 'text-blue-300';
  let Icon = Equal;
  let label = 'Same';

  if (delta.direction === 'higher') {
    bg = 'bg-amber-500/8 border-amber-500/20';
    textColor = 'text-amber-300';
    Icon = TrendingUp;
    label = 'higher';
  } else if (delta.direction === 'lower') {
    bg = 'bg-emerald-500/8 border-emerald-500/20';
    textColor = 'text-emerald-300';
    Icon = TrendingDown;
    label = 'lower';
  }

  return (
    <div
      className={cn(
        'rounded-lg border px-5 py-3 flex items-center justify-between',
        bg,
      )}
    >
      <div className="flex items-center gap-3">
        <Icon className={cn('w-5 h-5', textColor)} />
        <div>
          <span className={cn('text-sm font-semibold', textColor)}>
            Contextual is {formatPence(absPence)} ({absPercent.toFixed(1)}%){' '}
            {label}
          </span>
          <span className="text-xs text-gray-500 ml-2">than EVE</span>
        </div>
      </div>
      <div className="text-xs text-gray-500">
        {delta.direction === 'higher'
          ? 'EVE may be undercharging'
          : delta.direction === 'lower'
            ? 'EVE may be overcharging'
            : 'Engines agree'}
      </div>
    </div>
  );
}

function EVECard({ eve }: { eve: PricingComparisonResult['eve'] }) {
  return (
    <Card className="bg-gray-900/50 border-gray-800/60 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gray-600" />
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            EVE (Current)
          </CardTitle>
          <Badge
            variant="outline"
            className="text-[10px] border-gray-700 text-gray-500"
          >
            Segment-only
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-3xl font-bold text-gray-300 tracking-tight">
          {formatPence(eve.pricePence)}
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Segment</span>
            <span className="text-gray-300 font-mono">{eve.segment}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Hourly Rate</span>
            <span className="text-gray-300 font-mono">
              {formatPence(eve.hourlyRatePence)}/hr
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Multiplier</span>
            <span className="text-gray-300 font-mono">
              {eve.valueMultiplier}x
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ContextualCard({
  contextual,
}: {
  contextual: PricingComparisonResult['contextual'];
}) {
  const confidenceColor =
    contextual.confidence === 'high'
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      : contextual.confidence === 'medium'
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
        : 'bg-red-500/15 text-red-400 border-red-500/30';

  return (
    <Card className="bg-gray-900/50 border-gray-800/60 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-500" />
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-amber-400/80 uppercase tracking-wider">
            Contextual (New)
          </CardTitle>
          <Badge
            variant="outline"
            className={cn('text-[10px]', confidenceColor)}
          >
            {contextual.confidence} confidence
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-3xl font-bold text-white tracking-tight">
          {formatPence(contextual.finalPricePence)}
        </div>

        {/* Contextual messaging preview */}
        {contextual.contextualHeadline && (
          <div className="mt-3 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/10">
            <div className="flex items-start gap-2">
              <Quote className="w-3 h-3 text-amber-500/40 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-amber-300">
                  {contextual.contextualHeadline}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                  {contextual.contextualMessage}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LayerBreakdown({
  breakdown,
}: {
  breakdown: PricingComparisonResult['contextual']['layerBreakdown'];
}) {
  const layers = [
    {
      label: 'L1: Reference',
      value: breakdown.layer1ReferencePence,
      desc: 'Market rate',
      color: 'text-gray-400',
      bg: 'bg-gray-800/60',
    },
    {
      label: 'L3: LLM',
      value: breakdown.layer3LLMSuggestedPence,
      desc: 'AI adjusted',
      color: 'text-blue-400',
      bg: 'bg-blue-500/8',
    },
    {
      label: 'L4: Final',
      value: breakdown.layer4FinalPence,
      desc: 'After guardrails',
      color: 'text-amber-400',
      bg: 'bg-amber-500/8',
    },
  ];

  return (
    <Card className="bg-gray-900/50 border-gray-800/60">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />
          Layer Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex items-center gap-2">
          {layers.map((layer, i) => (
            <React.Fragment key={layer.label}>
              <div
                className={cn(
                  'flex-1 rounded-lg border border-gray-700/30 p-3',
                  layer.bg,
                )}
              >
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  {layer.label}
                </div>
                <div className={cn('text-lg font-bold font-mono', layer.color)}>
                  {formatPence(layer.value)}
                </div>
                <div className="text-[10px] text-gray-600 mt-0.5">
                  {layer.desc}
                </div>
              </div>
              {i < layers.length - 1 && (
                <ArrowRight className="w-4 h-4 text-gray-700 shrink-0" />
              )}
            </React.Fragment>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AdjustmentFactors({
  factors,
}: {
  factors: PricingAdjustmentFactor[];
}) {
  return (
    <Card className="bg-gray-900/50 border-gray-800/60">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          Adjustment Factors ({factors.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-2">
          {factors.map((f, i) => (
            <div
              key={i}
              className="flex items-start gap-3 py-2 px-3 rounded-md bg-gray-800/40 border border-gray-700/20"
            >
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                  f.direction === 'up'
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-400',
                )}
              >
                {f.direction === 'up' ? (
                  <ArrowUp className="w-3 h-3" />
                ) : (
                  <ArrowDown className="w-3 h-3" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-200">
                    {f.factor.replace(/_/g, ' ')}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] px-1.5 py-0',
                      f.magnitude === 'large'
                        ? 'border-red-500/30 text-red-400'
                        : f.magnitude === 'medium'
                          ? 'border-amber-500/30 text-amber-400'
                          : 'border-gray-600 text-gray-500',
                    )}
                  >
                    {f.magnitude}
                  </Badge>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {f.reasoning}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GuardrailsPanel({
  guardrails,
}: {
  guardrails: PricingComparisonResult['contextual']['guardrails'];
}) {
  const checks = [
    {
      label: 'Floor',
      triggered: guardrails.floorTriggered,
      desc: 'Below market reference',
    },
    {
      label: 'Ceiling',
      triggered: guardrails.ceilingTriggered,
      desc: 'Above max allowed',
    },
    {
      label: 'Margin',
      passed: guardrails.marginCheckPassed,
      desc: 'Min \u00A325/hr met',
    },
  ];

  const anyTriggered =
    guardrails.floorTriggered ||
    guardrails.ceilingTriggered ||
    !guardrails.marginCheckPassed;

  return (
    <Card className="bg-gray-900/50 border-gray-800/60">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          {anyTriggered ? (
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          )}
          Guardrails
          {!anyTriggered && (
            <span className="text-emerald-500 normal-case tracking-normal font-normal">
              &mdash; all clear
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex gap-3 mb-3">
          {checks.map((c) => {
            const isOk = 'passed' in c ? c.passed : !c.triggered;
            return (
              <div
                key={c.label}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs',
                  isOk
                    ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400'
                    : 'bg-red-500/8 border-red-500/20 text-red-400',
                )}
              >
                {isOk ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <XCircle className="w-3 h-3" />
                )}
                <span className="font-medium">{c.label}</span>
                <span className="text-gray-500 hidden sm:inline">
                  {c.desc}
                </span>
              </div>
            );
          })}
        </div>

        {guardrails.adjustments.length > 0 && (
          <div className="space-y-1 mt-2">
            {guardrails.adjustments.map((adj, i) => (
              <div
                key={i}
                className="text-xs text-gray-400 py-1 px-2 bg-gray-800/30 rounded font-mono"
              >
                {adj}
              </div>
            ))}
          </div>
        )}

        {guardrails.originalPricePence !== guardrails.adjustedPricePence && (
          <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
            <span className="line-through">
              {formatPence(guardrails.originalPricePence)}
            </span>
            <ArrowRight className="w-3 h-3" />
            <span className="text-amber-400 font-medium">
              {formatPence(guardrails.adjustedPricePence)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
