import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  RotateCcw,
  FileText,
  Video,
  MapPin,
  Check,
  AlertTriangle,
  Zap,
  Loader2,
  ChevronRight,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

interface MatchedService {
  task: { description: string; quantity: number; originalIndex: number };
  sku: {
    id: string;
    skuCode: string;
    name: string;
    pricePence: number;
    timeEstimateMinutes: number;
    category: string;
  };
  confidence: number;
  personalizedName?: string;
}

interface UnmatchedTask {
  description: string;
  quantity: number;
  originalIndex: number;
}

interface DetectionResult {
  originalText: string;
  tasks: { description: string; quantity: number; originalIndex: number }[];
  matchedServices: MatchedService[];
  unmatchedTasks: UnmatchedTask[];
  totalMatchedPrice: number;
  hasMatches: boolean;
  hasUnmatched: boolean;
  isMixed: boolean;
  nextRoute: 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'SITE_VISIT' | 'MIXED_QUOTE';
  overallTrafficLight: 'GREEN' | 'AMBER' | 'RED';
}

interface ActionLog {
  id: string;
  timestamp: Date;
  action: 'QUOTE' | 'VIDEO' | 'VISIT';
  details: string;
  success: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SCENARIOS
// ════════════════════════════════════════════════════════════════════════════

const TEST_SCENARIOS = [
  {
    name: 'Simple - Single Job',
    description: 'My kitchen tap is dripping',
    segment: 'LANDLORD',
  },
  {
    name: 'Multiple Jobs',
    description: 'I need a TV mounted on the wall and also my toilet keeps running',
    segment: 'BUSY_PRO',
  },
  {
    name: 'Mixed (Matched + Unmatched)',
    description: 'Can you fix my leaking tap and also service my boiler?',
    segment: 'HOMEOWNER',
  },
  {
    name: 'Flatpack',
    description: 'I have a PAX wardrobe from IKEA that needs assembling',
    segment: 'BUSY_PRO',
  },
  {
    name: 'Multiple Small Jobs',
    description: 'I need 3 shelves put up, a curtain pole fitted, and a baby gate installed',
    segment: 'BUSY_PRO',
  },
  {
    name: 'Property Manager',
    description: 'I manage 5 flats and need someone to fix a blocked sink and reseal a bath',
    segment: 'PROP_MGR',
  },
  {
    name: 'Unmatched - Complex',
    description: 'My roof is leaking and the chimney needs repointing',
    segment: 'HOMEOWNER',
  },
];

// ════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════════════

export default function SKUSimulatorPage() {
  // Input state
  const [jobDescription, setJobDescription] = useState('');
  const [customerName, setCustomerName] = useState('Test Customer');
  const [customerPhone, setCustomerPhone] = useState('+44 7700 900123');
  const [customerAddress, setCustomerAddress] = useState('123 Test Street, London, SW1A 1AA');

  // Result state
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);

  // Detection mutation
  const detectMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch('/api/intake/sku-detect-multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('Detection failed');
      return res.json();
    },
    onSuccess: (data) => {
      // Calculate overall traffic light based on route and matches
      const hasUnmatched = data.unmatchedTasks?.length > 0;
      const isMixed = data.isMixed;
      const route = data.nextRoute;

      let overallLight: 'GREEN' | 'AMBER' | 'RED' = 'GREEN';
      if (route === 'SITE_VISIT' || route === 'MIXED_QUOTE') {
        overallLight = hasUnmatched ? 'RED' : 'AMBER';
      } else if (route === 'VIDEO_QUOTE' || hasUnmatched) {
        overallLight = 'AMBER';
      }

      setResult({
        ...data,
        overallTrafficLight: overallLight,
      });
    },
  });

  // Action handlers
  const handleAction = (action: 'QUOTE' | 'VIDEO' | 'VISIT') => {
    const log: ActionLog = {
      id: Date.now().toString(),
      timestamp: new Date(),
      action,
      details: '',
      success: true,
    };

    const matchedJobNames = result?.matchedServices?.map(s => s.sku.name).join(', ') || 'None';
    const unmatchedJobNames = result?.unmatchedTasks?.map(t => t.description).join(', ') || 'None';
    const totalPrice = ((result?.totalMatchedPrice || 0) / 100).toFixed(2);

    switch (action) {
      case 'QUOTE':
        log.details = `📱 SENDING INSTANT QUOTE\n\n` +
          `Customer: ${customerName}\n` +
          `WhatsApp: ${customerPhone}\n` +
          `────────────────────────\n` +
          `Jobs: ${matchedJobNames}\n` +
          `Total: £${totalPrice}\n` +
          `────────────────────────\n` +
          `✓ Quote link generated\n` +
          `✓ WhatsApp message sent`;
        break;
      case 'VIDEO':
        log.details = `📹 REQUESTING VIDEO ASSESSMENT\n\n` +
          `Customer: ${customerName}\n` +
          `WhatsApp: ${customerPhone}\n` +
          `────────────────────────\n` +
          `Need video for: ${unmatchedJobNames}\n` +
          `────────────────────────\n` +
          `✓ Video request template sent\n` +
          `✓ Awaiting customer upload`;
        break;
      case 'VISIT':
        log.details = `📍 BOOKING SITE VISIT\n\n` +
          `Customer: ${customerName}\n` +
          `Phone: ${customerPhone}\n` +
          `Address: ${customerAddress}\n` +
          `────────────────────────\n` +
          `Reason: Job requires on-site assessment\n` +
          `────────────────────────\n` +
          `✓ Lead created\n` +
          `✓ Scheduling options sent`;
        break;
    }

    setActionLogs((prev) => [log, ...prev]);
  };

  // Load scenario
  const loadScenario = (scenario: typeof TEST_SCENARIOS[0]) => {
    setJobDescription(scenario.description);
    setResult(null);
    setActionLogs([]);
  };

  // Reset
  const reset = () => {
    setJobDescription('');
    setResult(null);
    setActionLogs([]);
  };

  // Traffic light colors
  const getTrafficLightColor = (light: string) => {
    switch (light) {
      case 'GREEN': return 'bg-green-500';
      case 'AMBER': return 'bg-amber-500';
      case 'RED': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getRouteInfo = (route: string) => {
    switch (route) {
      case 'INSTANT_PRICE':
        return { label: 'Instant Quote', color: 'text-green-600', icon: FileText, action: 'QUOTE' as const };
      case 'VIDEO_QUOTE':
        return { label: 'Video Assessment', color: 'text-amber-600', icon: Video, action: 'VIDEO' as const };
      case 'SITE_VISIT':
        return { label: 'Site Visit Required', color: 'text-red-600', icon: MapPin, action: 'VISIT' as const };
      case 'MIXED_QUOTE':
        return { label: 'Mixed - Partial Quote', color: 'text-blue-600', icon: FileText, action: 'QUOTE' as const };
      default:
        return { label: route, color: 'text-gray-600', icon: FileText, action: 'QUOTE' as const };
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-6 h-6 text-yellow-400" />
            SKU Detection Simulator
          </h1>
          <p className="text-gray-400 mt-1">
            Test the full flow: Job description → SKU detection → Action buttons
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Input Panel */}
          <div className="space-y-4">
            {/* Test Scenarios */}
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-400">
                  Test Scenarios
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {TEST_SCENARIOS.map((scenario, i) => (
                  <button
                    key={i}
                    onClick={() => loadScenario(scenario)}
                    className="w-full text-left px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-sm"
                  >
                    <div className="font-medium">{scenario.name}</div>
                    <div className="text-gray-400 text-xs truncate">{scenario.description}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Customer Info */}
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Customer Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="Name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="bg-gray-800 border-gray-700"
                />
                <Input
                  placeholder="Phone / WhatsApp"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="bg-gray-800 border-gray-700"
                />
                <Input
                  placeholder="Address"
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="bg-gray-800 border-gray-700"
                />
              </CardContent>
            </Card>
          </div>

          {/* CENTER: Detection */}
          <div className="space-y-4">
            {/* Job Input */}
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-400">
                  Job Description
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Describe the job(s)... e.g., 'I need a TV mounted and my tap is dripping'"
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  className="bg-gray-800 border-gray-700 min-h-[120px]"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => detectMutation.mutate(jobDescription)}
                    disabled={!jobDescription.trim() || detectMutation.isPending}
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                  >
                    {detectMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    Detect SKUs
                  </Button>
                  <Button onClick={reset} variant="outline" className="border-gray-700">
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Detection Results */}
            {result && (
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-gray-400">
                      Detection Results
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        'w-3 h-3 rounded-full',
                        getTrafficLightColor(result.overallTrafficLight)
                      )} />
                      <span className="text-xs font-medium">
                        {result.overallTrafficLight}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Matched Services */}
                  {result.matchedServices?.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-500 mb-2">MATCHED SERVICES</div>
                      <div className="space-y-2">
                        {result.matchedServices.map((match, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-3 rounded-lg bg-gray-800"
                          >
                            <div className="flex items-center gap-3">
                              <Check className="w-4 h-4 text-green-500" />
                              <div>
                                <div className="font-medium text-sm">
                                  {match.sku.name}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {match.sku.skuCode} · {match.sku.category} · {match.confidence}% confidence
                                </div>
                                <div className="text-xs text-gray-500">
                                  "{match.task.description}"
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-green-400">
                                £{(match.sku.pricePence / 100).toFixed(0)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {match.sku.timeEstimateMinutes}m
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Unmatched Tasks */}
                  {result.unmatchedTasks?.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-500 mb-2">UNMATCHED (Need Assessment)</div>
                      <div className="space-y-2">
                        {result.unmatchedTasks.map((task, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 p-3 rounded-lg bg-gray-800 border border-amber-500/30"
                          >
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            <span className="text-sm">{task.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Total & Route */}
                  <div className="pt-3 border-t border-gray-700">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-gray-400">Matched Total:</span>
                      <span className="text-xl font-bold text-green-400">
                        £{(result.totalMatchedPrice / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-gray-800">
                      {(() => {
                        const route = getRouteInfo(result.nextRoute);
                        return (
                          <>
                            <route.icon className={cn('w-5 h-5', route.color)} />
                            <span className={cn('font-medium', route.color)}>
                              {route.label}
                            </span>
                            <ChevronRight className="w-4 h-4 text-gray-500 ml-auto" />
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT: Actions */}
          <div className="space-y-4">
            {/* Action Buttons */}
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-400">
                  Actions
                </CardTitle>
                {result && (
                  <div className="mt-2 text-xs">
                    <span className="text-gray-500">Recommended: </span>
                    <span className={cn(
                      'font-medium',
                      result.nextRoute === 'INSTANT_PRICE' && 'text-green-400',
                      result.nextRoute === 'VIDEO_QUOTE' && 'text-amber-400',
                      result.nextRoute === 'MIXED_QUOTE' && 'text-blue-400',
                      result.nextRoute === 'SITE_VISIT' && 'text-red-400'
                    )}>
                      {result.nextRoute === 'INSTANT_PRICE' && '→ SEND QUOTE'}
                      {result.nextRoute === 'VIDEO_QUOTE' && '→ GET VIDEO'}
                      {result.nextRoute === 'MIXED_QUOTE' && '→ SEND QUOTE (partial) + GET VIDEO'}
                      {result.nextRoute === 'SITE_VISIT' && '→ BOOK VISIT'}
                    </span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={() => handleAction('QUOTE')}
                  disabled={!result || result.matchedServices?.length === 0}
                  className={cn(
                    "w-full h-14 text-lg transition-all",
                    result?.nextRoute === 'INSTANT_PRICE' || result?.nextRoute === 'MIXED_QUOTE'
                      ? "bg-green-600 hover:bg-green-700 ring-2 ring-green-400 ring-offset-2 ring-offset-gray-900"
                      : "bg-green-600/50 hover:bg-green-700"
                  )}
                >
                  <FileText className="w-5 h-5 mr-2" />
                  SEND QUOTE
                  {result && result.totalMatchedPrice > 0 && (
                    <Badge className="ml-2 bg-green-800">
                      £{(result.totalMatchedPrice / 100).toFixed(0)}
                    </Badge>
                  )}
                </Button>

                <Button
                  onClick={() => handleAction('VIDEO')}
                  disabled={!result}
                  className={cn(
                    "w-full h-14 text-lg transition-all",
                    result?.nextRoute === 'VIDEO_QUOTE' || (result?.nextRoute === 'MIXED_QUOTE' && result?.unmatchedTasks?.length > 0)
                      ? "bg-amber-600 hover:bg-amber-700 ring-2 ring-amber-400 ring-offset-2 ring-offset-gray-900"
                      : "bg-amber-600/50 hover:bg-amber-700"
                  )}
                >
                  <Video className="w-5 h-5 mr-2" />
                  GET VIDEO
                  {result?.unmatchedTasks && result.unmatchedTasks.length > 0 && (
                    <Badge className="ml-2 bg-amber-800">
                      {result.unmatchedTasks.length} unmatched
                    </Badge>
                  )}
                </Button>

                <Button
                  onClick={() => handleAction('VISIT')}
                  disabled={!result}
                  className={cn(
                    "w-full h-14 text-lg transition-all",
                    result?.nextRoute === 'SITE_VISIT'
                      ? "bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900"
                      : "bg-blue-600/50 hover:bg-blue-700"
                  )}
                >
                  <MapPin className="w-5 h-5 mr-2" />
                  BOOK VISIT
                </Button>
              </CardContent>
            </Card>

            {/* Action Log */}
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-400">
                  Action Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                {actionLogs.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-4">
                    No actions yet. Run detection and click an action button.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {actionLogs.map((log) => (
                      <div
                        key={log.id}
                        className={cn(
                          'p-3 rounded-lg border',
                          log.action === 'QUOTE' && 'bg-green-900/20 border-green-800',
                          log.action === 'VIDEO' && 'bg-amber-900/20 border-amber-800',
                          log.action === 'VISIT' && 'bg-blue-900/20 border-blue-800'
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Badge
                            className={cn(
                              log.action === 'QUOTE' && 'bg-green-600',
                              log.action === 'VIDEO' && 'bg-amber-600',
                              log.action === 'VISIT' && 'bg-blue-600'
                            )}
                          >
                            {log.action}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {log.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                          {log.details}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
