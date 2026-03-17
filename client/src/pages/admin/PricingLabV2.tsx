import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  ShieldCheck,
  ShieldAlert,
  Brain,
  Layers,
  ChevronDown,
  ChevronUp,
  Gauge,
  Sparkles,
  Quote,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  List,
  Percent,
  Wand2,
  MessageSquareText,
  HelpCircle,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  MultiLineRequest,
  MultiLineResult,
  MultiLineTestScenario,
  ContextualSignals,
  JobLine,
  LineItemResult,
  BatchDiscount,
  PricingAdjustmentFactor,
  JobCategory,
  GuardrailResult,
  ParsedJobResult,
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

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
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

const DEFAULT_LINE: () => JobLine = () => ({
  id: generateId(),
  description: '',
  category: 'general_fixing' as JobCategory,
  timeEstimateMinutes: 60,
});

const DEFAULT_SIGNALS: ContextualSignals = {
  urgency: 'standard',
  materialsSupply: 'labor_only',
  timeOfService: 'standard',
  isReturningCustomer: false,
  previousJobCount: 0,
  previousAvgPricePence: 0,
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function PricingLabV2() {
  const [lines, setLines] = useState<JobLine[]>([DEFAULT_LINE()]);
  const [signals, setSignals] = useState<ContextualSignals>({ ...DEFAULT_SIGNALS });
  const [result, setResult] = useState<MultiLineResult | null>(null);
  const [scenarios, setScenarios] = useState<MultiLineTestScenario[]>([]);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [rawDescription, setRawDescription] = useState('');
  const [showTips, setShowTips] = useState(false);

  // Fetch scenarios on mount
  useEffect(() => {
    fetch('/api/pricing/multi-scenarios')
      .then((r) => r.json())
      .then(setScenarios)
      .catch(() => {});
  }, []);

  const quoteMutation = useMutation({
    mutationFn: async (req: MultiLineRequest) => {
      const res = await fetch('/api/pricing/multi-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Quote generation failed');
      }
      return res.json() as Promise<MultiLineResult>;
    },
    onSuccess: (data) => {
      setResult(data);
    },
  });

  const parseMutation = useMutation({
    mutationFn: async (description: string) => {
      const res = await fetch('/api/pricing/parse-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Parse failed');
      }
      return res.json() as Promise<ParsedJobResult>;
    },
    onSuccess: (data) => {
      // Set parsed lines
      if (data.lines.length > 0) {
        setLines(data.lines.map((l) => ({ ...l, id: l.id || generateId() })));
      }
      // Apply detected signals to the form
      const ds = data.detectedSignals;
      setSignals((prev) => ({
        ...prev,
        ...(ds.urgency && { urgency: ds.urgency }),
        ...(ds.materialsSupply && { materialsSupply: ds.materialsSupply }),
        ...(ds.timeOfService && { timeOfService: ds.timeOfService }),
      }));
      setResult(null);
    },
  });

  const runParse = () => {
    if (rawDescription.trim()) {
      parseMutation.mutate(rawDescription.trim());
    }
  };

  const updateSignal = <K extends keyof ContextualSignals>(
    key: K,
    value: ContextualSignals[K],
  ) => {
    setSignals((prev) => ({ ...prev, [key]: value }));
  };

  const updateLine = (id: string, updates: Partial<JobLine>) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    );
  };

  const addLine = () => {
    if (lines.length >= 10) return;
    setLines((prev) => [...prev, DEFAULT_LINE()]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const loadScenario = (scenario: MultiLineTestScenario) => {
    setLines([...scenario.request.lines]);
    setSignals({ ...scenario.request.signals });
    setResult(null);
  };

  const reset = () => {
    setLines([DEFAULT_LINE()]);
    setSignals({ ...DEFAULT_SIGNALS });
    setResult(null);
  };

  const runQuote = () => {
    quoteMutation.mutate({ lines, signals });
  };

  const hasDescription = lines.some((l) => l.description.trim());

  // Previous avg price displayed in pounds for UX
  const prevAvgPounds =
    signals.previousAvgPricePence > 0
      ? (signals.previousAvgPricePence / 100).toFixed(2)
      : '';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800/60 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Pricing Lab v2
              </h1>
              <p className="text-xs text-gray-500">
                Multi-line contextual pricing
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
              onClick={runQuote}
              disabled={quoteMutation.isPending || !hasDescription}
              className="bg-amber-500 hover:bg-amber-400 text-black font-medium"
            >
              {quoteMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <FlaskConical className="w-4 h-4 mr-1" />
              )}
              Generate Quote
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
            {/* Quick Scenarios */}
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

            {/* AI Job Parser */}
            <Card className="bg-gray-900/50 border-gray-800/60 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 to-blue-500" />
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquareText className="w-3.5 h-3.5" />
                  Describe the Job
                  <button
                    onClick={() => setShowTips(!showTips)}
                    className="ml-auto text-gray-600 hover:text-purple-400 transition-colors"
                    title="Tips for better results"
                  >
                    {showTips ? (
                      <X className="w-3.5 h-3.5" />
                    ) : (
                      <HelpCircle className="w-3.5 h-3.5" />
                    )}
                  </button>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {showTips && (
                  <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-2.5 text-[11px]">
                    <p className="text-purple-300 font-medium text-xs">Tips for better parsing</p>
                    <div className="space-y-2 text-gray-400">
                      <div>
                        <p className="text-gray-300 font-medium mb-0.5">Mention the specific job:</p>
                        <p className="text-gray-500 italic">"Kitchen tap dripping" not "something wrong in the kitchen"</p>
                      </div>
                      <div>
                        <p className="text-gray-300 font-medium mb-0.5">Include property context:</p>
                        <p className="text-gray-500 italic">"It's my rental property" / "our shop" / "my house"</p>
                      </div>
                      <div>
                        <p className="text-gray-300 font-medium mb-0.5">Mention who's there:</p>
                        <p className="text-gray-500 italic">"Tenant will let you in" / "I won't be there" / "I'll be home"</p>
                      </div>
                      <div>
                        <p className="text-gray-300 font-medium mb-0.5">State urgency if relevant:</p>
                        <p className="text-gray-500 italic">"Need it ASAP" / "this week" / "whenever you're free"</p>
                      </div>
                      <div>
                        <p className="text-gray-300 font-medium mb-0.5">List multiple jobs clearly:</p>
                        <p className="text-gray-500 italic">"Also need..." / "While you're there..." / "And the back door needs..."</p>
                      </div>
                      <div>
                        <p className="text-gray-300 font-medium mb-0.5">Mention materials:</p>
                        <p className="text-gray-500 italic">"I've got the tap already" / "can you supply everything?"</p>
                      </div>
                    </div>
                    <div className="pt-1.5 border-t border-purple-500/10">
                      <p className="text-purple-400/70 text-[10px]">The more context you include, the more accurate the pricing signals will be.</p>
                    </div>
                  </div>
                )}
                <Textarea
                  value={rawDescription}
                  onChange={(e) => setRawDescription(e.target.value)}
                  placeholder="Paste the full job description here, e.g. &#10;&#10;&quot;Kitchen tap is dripping, also need 3 shelves put up in the living room and the back gate re-hung. It's my rental property, tenant is there. Would like photos when done.&quot;"
                  className="bg-gray-800/60 border-gray-700/50 text-sm min-h-[90px] resize-none placeholder:text-gray-600"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runParse}
                  disabled={parseMutation.isPending || !rawDescription.trim()}
                  className="w-full border-purple-500/30 text-purple-300 hover:bg-purple-500/10 hover:text-purple-200"
                >
                  {parseMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Wand2 className="w-4 h-4 mr-2" />
                  )}
                  {parseMutation.isPending ? 'Parsing...' : 'Parse into Line Items'}
                </Button>
                {parseMutation.isError && (
                  <p className="text-xs text-red-400">
                    {parseMutation.error?.message || 'Parse failed'}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Job Lines */}
            <Card className="bg-gray-900/50 border-gray-800/60">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <List className="w-3.5 h-3.5" />
                  Job Lines
                  <Badge
                    variant="outline"
                    className="text-[10px] border-gray-700 text-gray-500 ml-auto"
                  >
                    {lines.length}/10
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {lines.map((line, idx) => (
                  <div
                    key={line.id}
                    className="p-3 rounded-lg bg-gray-800/40 border border-gray-700/30 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                        Line {idx + 1}
                      </span>
                      <button
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length <= 1}
                        className={cn(
                          'p-1 rounded transition-colors',
                          lines.length <= 1
                            ? 'text-gray-700 cursor-not-allowed'
                            : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10',
                        )}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div>
                      <Input
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.id, { description: e.target.value })
                        }
                        placeholder="e.g. Hang 3 shelves in living room"
                        className="bg-gray-800/60 border-gray-700/50 text-sm h-9"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px] text-gray-500 mb-0.5 block">
                          Category
                        </Label>
                        <Select
                          value={line.category}
                          onValueChange={(v) =>
                            updateLine(line.id, {
                              category: v as JobCategory,
                            })
                          }
                        >
                          <SelectTrigger className="bg-gray-800/60 border-gray-700/50 text-xs h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[10px] text-gray-500 mb-0.5 block">
                          Time{' '}
                          <span className="text-gray-600">
                            ({formatMinutes(line.timeEstimateMinutes)})
                          </span>
                        </Label>
                        <Input
                          type="number"
                          min={15}
                          max={480}
                          step={15}
                          value={line.timeEstimateMinutes}
                          onChange={(e) =>
                            updateLine(line.id, {
                              timeEstimateMinutes:
                                parseInt(e.target.value) || 60,
                            })
                          }
                          className="bg-gray-800/60 border-gray-700/50 text-xs h-8"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addLine}
                  disabled={lines.length >= 10}
                  className="w-full text-gray-400 hover:text-white border border-dashed border-gray-700/50 hover:border-gray-600"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Line
                </Button>
              </CardContent>
            </Card>

            {/* Context Signals */}
            <Card className="bg-gray-900/50 border-gray-800/60">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Context Signals
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div>
                  <Label className="text-xs text-gray-400 mb-1 block">
                    Urgency
                  </Label>
                  <Select
                    value={signals.urgency}
                    onValueChange={(v) =>
                      updateSignal(
                        'urgency',
                        v as ContextualSignals['urgency'],
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">
                      Materials
                    </Label>
                    <Select
                      value={signals.materialsSupply}
                      onValueChange={(v) =>
                        updateSignal(
                          'materialsSupply',
                          v as ContextualSignals['materialsSupply'],
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
                      value={signals.timeOfService}
                      onValueChange={(v) =>
                        updateSignal(
                          'timeOfService',
                          v as ContextualSignals['timeOfService'],
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
              </CardContent>
            </Card>

            {/* Customer History */}
            <Card className="bg-gray-900/50 border-gray-800/60">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5" />
                  Customer History
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-400">
                    Returning Customer
                  </Label>
                  <Switch
                    checked={signals.isReturningCustomer}
                    onCheckedChange={(v) =>
                      updateSignal('isReturningCustomer', v)
                    }
                  />
                </div>
                {signals.isReturningCustomer && (
                  <div className="grid grid-cols-2 gap-3 pl-1 border-l-2 border-amber-500/30">
                    <div>
                      <Label className="text-xs text-gray-400 mb-1 block">
                        Prev. Jobs
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={signals.previousJobCount}
                        onChange={(e) =>
                          updateSignal(
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
                          updateSignal(
                            'previousAvgPricePence',
                            e.target.value
                              ? Math.round(parseFloat(e.target.value) * 100)
                              : 0,
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

          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* RIGHT: Results Panel                                          */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <div className="xl:col-span-8">
            {!result && !quoteMutation.isPending && !quoteMutation.isError && (
              <div className="flex flex-col items-center justify-center h-96 text-gray-600">
                <FlaskConical className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-sm">
                  Add job lines, set context signals, and hit{' '}
                  <span className="text-amber-400">Generate Quote</span>
                </p>
                <p className="text-xs text-gray-700 mt-1">
                  Or pick a quick scenario to get started
                </p>
              </div>
            )}

            {quoteMutation.isPending && (
              <div className="flex flex-col items-center justify-center h-96 text-gray-500">
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-amber-400" />
                <p className="text-sm">Generating multi-line quote...</p>
                <p className="text-xs text-gray-600 mt-1">
                  LLM is reasoning about {lines.length} line
                  {lines.length > 1 ? 's' : ''}
                </p>
              </div>
            )}

            {quoteMutation.isError && (
              <div className="flex flex-col items-center justify-center h-96 text-red-400">
                <AlertTriangle className="w-10 h-10 mb-4" />
                <p className="text-sm">
                  {quoteMutation.error?.message || 'Something went wrong'}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={runQuote}
                  className="mt-3 text-red-400"
                >
                  Try Again
                </Button>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Total Price */}
                <TotalPriceCard result={result} />

                {/* Line Items Breakdown */}
                <LineItemsBreakdown lineItems={result.lineItems} subtotalPence={result.subtotalPence} />

                {/* Batch Discount */}
                {result.batchDiscount.applied && (
                  <BatchDiscountCard discount={result.batchDiscount} />
                )}

                {/* Layer Breakdown */}
                <LayerBreakdown breakdown={result.layerBreakdown} />

                {/* Guardrails */}
                <GuardrailsPanel guardrails={result.guardrails} />

                {/* Full Reasoning */}
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
                        {result.reasoning}
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

function TotalPriceCard({ result }: { result: MultiLineResult }) {
  const confidenceColor =
    result.confidence === 'high'
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      : result.confidence === 'medium'
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
        : 'bg-red-500/15 text-red-400 border-red-500/30';

  return (
    <Card className="bg-gray-900/50 border-gray-800/60 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-500" />
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-amber-400/80 uppercase tracking-wider">
            Total Price
          </CardTitle>
          <Badge
            variant="outline"
            className={cn('text-[10px]', confidenceColor)}
          >
            {result.confidence} confidence
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-3xl font-bold text-white tracking-tight">
          {formatPence(result.finalPricePence)}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {result.lineItems.length} line item
          {result.lineItems.length > 1 ? 's' : ''}
          {result.batchDiscount.applied && (
            <span className="text-emerald-400 ml-2">
              incl. {result.batchDiscount.discountPercent}% batch discount
            </span>
          )}
        </div>

        {/* Contextual messaging preview */}
        {result.contextualHeadline && (
          <div className="mt-3 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/10">
            <div className="flex items-start gap-2">
              <Quote className="w-3 h-3 text-amber-500/40 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-amber-300">
                  {result.contextualHeadline}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                  {result.contextualMessage}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LineItemsBreakdown({
  lineItems,
  subtotalPence,
}: {
  lineItems: LineItemResult[];
  subtotalPence: number;
}) {
  return (
    <Card className="bg-gray-900/50 border-gray-800/60">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          <List className="w-3.5 h-3.5" />
          Line Items Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {/* Header row */}
        <div className="grid grid-cols-12 gap-2 px-2 py-1.5 text-[10px] text-gray-600 uppercase tracking-wider font-medium border-b border-gray-800/60">
          <div className="col-span-3">Description</div>
          <div className="col-span-2">Category</div>
          <div className="col-span-1 text-right">Time</div>
          <div className="col-span-2 text-right">Reference</div>
          <div className="col-span-2 text-right">LLM</div>
          <div className="col-span-2 text-right">Final</div>
        </div>

        {/* Line rows */}
        {lineItems.map((item) => (
          <div
            key={item.lineId}
            className="grid grid-cols-12 gap-2 px-2 py-2.5 text-xs border-b border-gray-800/30 hover:bg-gray-800/20 transition-colors"
          >
            <div className="col-span-3 text-gray-300 truncate" title={item.description}>
              {item.description}
            </div>
            <div className="col-span-2 text-gray-500">
              {CATEGORY_LABELS[item.category] || item.category}
            </div>
            <div className="col-span-1 text-right text-gray-500 font-mono">
              {formatMinutes(item.timeEstimateMinutes)}
            </div>
            <div className="col-span-2 text-right text-gray-400 font-mono">
              {formatPence(item.referencePricePence)}
            </div>
            <div className="col-span-2 text-right text-blue-400 font-mono">
              {formatPence(item.llmSuggestedPricePence)}
            </div>
            <div className="col-span-2 text-right text-amber-400 font-mono font-medium">
              {formatPence(item.guardedPricePence)}
            </div>
          </div>
        ))}

        {/* Subtotal row */}
        <div className="grid grid-cols-12 gap-2 px-2 py-2.5 text-xs font-medium border-t border-gray-700/50 mt-1">
          <div className="col-span-3 text-gray-400">Subtotal</div>
          <div className="col-span-2" />
          <div className="col-span-1" />
          <div className="col-span-2 text-right text-gray-400 font-mono">
            {formatPence(
              lineItems.reduce((sum, li) => sum + li.referencePricePence, 0),
            )}
          </div>
          <div className="col-span-2 text-right text-blue-400 font-mono">
            {formatPence(
              lineItems.reduce(
                (sum, li) => sum + li.llmSuggestedPricePence,
                0,
              ),
            )}
          </div>
          <div className="col-span-2 text-right text-amber-400 font-mono font-semibold">
            {formatPence(subtotalPence)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BatchDiscountCard({ discount }: { discount: BatchDiscount }) {
  return (
    <Card className="bg-emerald-500/5 border-emerald-500/20">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-emerald-400/80 uppercase tracking-wider flex items-center gap-1.5">
          <Percent className="w-3.5 h-3.5" />
          Batch Discount Applied
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-2xl font-bold text-emerald-400 tracking-tight">
              {discount.discountPercent}% off
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Saving {formatPence(discount.savingsPence)}
            </div>
          </div>
          <div className="flex-1 text-xs text-gray-400 leading-relaxed">
            {discount.reasoning}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LayerBreakdown({
  breakdown,
}: {
  breakdown: MultiLineResult['layerBreakdown'];
}) {
  const layers = [
    {
      label: 'L1: Reference',
      value: breakdown.layer1ReferencePence,
      desc: 'Market rate total',
      color: 'text-gray-400',
      bg: 'bg-gray-800/60',
    },
    {
      label: 'L3: LLM',
      value: breakdown.layer3LLMSuggestedPence,
      desc: 'AI adjusted total',
      color: 'text-blue-400',
      bg: 'bg-blue-500/8',
    },
    {
      label: 'L4: Final',
      value: breakdown.layer4FinalPence,
      desc: 'After guardrails + discount',
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
                <div
                  className={cn('text-lg font-bold font-mono', layer.color)}
                >
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

function GuardrailsPanel({
  guardrails,
}: {
  guardrails: GuardrailResult;
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
