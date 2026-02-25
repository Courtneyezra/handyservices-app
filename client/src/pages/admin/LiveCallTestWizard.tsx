import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  Pause,
  RotateCcw,
  FileText,
  Video,
  MapPin,
  Check,
  AlertTriangle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  User,
  Phone,
  Home,
  MessageSquare,
  Sparkles,
  CircleDot,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

interface TranscriptLine {
  speaker: 'VA' | 'CUSTOMER';
  text: string;
  delay?: number; // ms before showing next line
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  segment: string;
  transcript: TranscriptLine[];
  expectedJobs: string[];
}

interface DetectedJob {
  id: string;
  description: string;
  matched: boolean;
  pricePence?: number;
  sku?: {
    id: string;
    skuCode: string;
    name: string;
    pricePence: number;
    timeEstimateMinutes: number;
    category: string;
  };
}

interface CustomerInfo {
  name: string;
  phone: string;
  address: string;
  postcode: string;
}

interface ActionResult {
  success: boolean;
  quoteId?: string;
  quoteUrl?: string;
  leadId?: string;
  message?: string;
  error?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// PRE-BUILT SCENARIOS
// ════════════════════════════════════════════════════════════════════════════

const SCENARIOS: Scenario[] = [
  {
    id: 'landlord-tap',
    name: 'Landlord - Dripping Tap',
    description: 'Remote landlord with tenant coordination needed',
    segment: 'LANDLORD',
    transcript: [
      { speaker: 'VA', text: "Good morning, V6 Handyman, how can I help?" },
      { speaker: 'CUSTOMER', text: "Hi, I'm a landlord and my tenant called about a dripping tap in the kitchen." },
      { speaker: 'VA', text: "No problem at all. Is this a rental property you manage?" },
      { speaker: 'CUSTOMER', text: "Yes, I've got a flat in Clapham. I can't be there myself, I'm based in Manchester." },
      { speaker: 'VA', text: "That's fine - we handle that all the time. We can coordinate directly with your tenant. What's the address?" },
      { speaker: 'CUSTOMER', text: "It's 45 Acre Lane, Clapham, SW2 5TN" },
      { speaker: 'VA', text: "Perfect. And your name and best contact number?" },
      { speaker: 'CUSTOMER', text: "James Wilson, 07700 900456" },
    ],
    expectedJobs: ['Tap repair'],
  },
  {
    id: 'busy-pro-tv',
    name: 'Busy Professional - TV Mount',
    description: 'Time-poor professional, wants it done fast',
    segment: 'BUSY_PRO',
    transcript: [
      { speaker: 'VA', text: "Good afternoon, V6 Handyman, how can I help?" },
      { speaker: 'CUSTOMER', text: "Hi, I need a TV mounted. I just bought a 55 inch Samsung and need it on the wall." },
      { speaker: 'VA', text: "Sure, we can help with that. Is this a plasterboard or solid brick wall?" },
      { speaker: 'CUSTOMER', text: "I think it's plasterboard. Look, I'm really busy at work - can you just give me a price and sort it?" },
      { speaker: 'VA', text: "Absolutely. I can send you a quote link right now. What's your name and number?" },
      { speaker: 'CUSTOMER', text: "Sarah Chen, 07700 900789. I'm in Canary Wharf, E14 5AB, flat 23" },
    ],
    expectedJobs: ['TV mounting (44-65")'],
  },
  {
    id: 'multi-job',
    name: 'Multiple Jobs - Shelves + Blind',
    description: 'Customer with several small tasks',
    segment: 'BUSY_PRO',
    transcript: [
      { speaker: 'VA', text: "Hello, V6 Handyman, how can I help?" },
      { speaker: 'CUSTOMER', text: "Hi, I've got a few things I need done. Can you put up 3 floating shelves and also fit a roller blind?" },
      { speaker: 'VA', text: "Yes, no problem. Are these standard floating shelves you've already bought?" },
      { speaker: 'CUSTOMER', text: "Yes, got them from IKEA. And the blind is from John Lewis." },
      { speaker: 'VA', text: "Great. And where are you based?" },
      { speaker: 'CUSTOMER', text: "I'm in Fulham, SW6 1AA. Name's Tom Richards, 07700 900321" },
    ],
    expectedJobs: ['Shelf installation (2-4)', 'Blind installation'],
  },
  {
    id: 'mixed-unmatched',
    name: 'Mixed - Tap + Boiler (Unmatched)',
    description: 'One matched job, one needs assessment',
    segment: 'HOMEOWNER',
    transcript: [
      { speaker: 'VA', text: "Good morning, V6 Handyman, how can I help?" },
      { speaker: 'CUSTOMER', text: "Hi, two things - my bathroom tap is leaking badly, and also my boiler is making a weird banging noise." },
      { speaker: 'VA', text: "Okay, the tap we can definitely help with. The boiler noise - that would need a Gas Safe engineer to look at. We can fix the tap and arrange for a heating specialist for the boiler." },
      { speaker: 'CUSTOMER', text: "Fine, let's start with the tap then. I'm at 12 Richmond Road, Twickenham, TW1 3BB" },
      { speaker: 'VA', text: "And your name and contact number?" },
      { speaker: 'CUSTOMER', text: "Mike Thompson, 07700 900654" },
    ],
    expectedJobs: ['Tap repair', 'Boiler service (unmatched)'],
  },
  {
    id: 'flatpack-large',
    name: 'Flatpack - PAX Wardrobe',
    description: 'Large IKEA wardrobe assembly',
    segment: 'BUSY_PRO',
    transcript: [
      { speaker: 'VA', text: "Hello, V6 Handyman, how can I help?" },
      { speaker: 'CUSTOMER', text: "Hi, I need someone to build a PAX wardrobe from IKEA. It's a big one with sliding doors." },
      { speaker: 'VA', text: "No problem. Is this a full-height wardrobe? And do you have the boxes delivered already?" },
      { speaker: 'CUSTOMER', text: "Yes, it's about 2 metres tall with sliding mirror doors. All the boxes are here, there's about 8 of them!" },
      { speaker: 'VA', text: "That's fine, we do these regularly. Where are you based?" },
      { speaker: 'CUSTOMER', text: "Wimbledon, SW19 4AA. I'm Emma Davis, 07700 900987" },
    ],
    expectedJobs: ['Large wardrobe assembly'],
  },
  {
    id: 'property-manager',
    name: 'Property Manager - Multiple Units',
    description: 'Portfolio manager with recurring needs',
    segment: 'PROP_MGR',
    transcript: [
      { speaker: 'VA', text: "Good afternoon, V6 Handyman, how can I help?" },
      { speaker: 'CUSTOMER', text: "Hi, I manage about 20 properties in south London. I've got a blocked sink in one unit and need a bath resealed in another." },
      { speaker: 'VA', text: "Sure, we work with a lot of property managers. Are these in the same building or different locations?" },
      { speaker: 'CUSTOMER', text: "Different - one's in Brixton, one's in Peckham. We usually need work done across our portfolio regularly." },
      { speaker: 'VA', text: "Perfect. Let me get your details and we can discuss our property management rates." },
      { speaker: 'CUSTOMER', text: "It's Greenfield Property Management, contact is Rachel Green, 07700 900111" },
    ],
    expectedJobs: ['Blockage clearance', 'Bath/shower reseal'],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════════════

export default function LiveCallTestWizard() {
  const { toast } = useToast();

  // Wizard state
  const [step, setStep] = useState(1);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);

  // Transcript playback state
  const [transcriptIndex, setTranscriptIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playedLines, setPlayedLines] = useState<TranscriptLine[]>([]);

  // Detection state
  const [detectedJobs, setDetectedJobs] = useState<DetectedJob[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionRoute, setDetectionRoute] = useState<string | null>(null);

  // Customer info state
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: '',
    phone: '',
    address: '',
    postcode: '',
  });

  // Action result state
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);

  // Auto-play transcript
  useEffect(() => {
    if (!isPlaying || !selectedScenario) return;

    if (transcriptIndex >= selectedScenario.transcript.length) {
      setIsPlaying(false);
      // Run detection when transcript finishes
      runDetection();
      return;
    }

    const line = selectedScenario.transcript[transcriptIndex];
    const timer = setTimeout(() => {
      setPlayedLines(prev => [...prev, line]);
      setTranscriptIndex(prev => prev + 1);
    }, line.delay || 1500);

    return () => clearTimeout(timer);
  }, [isPlaying, transcriptIndex, selectedScenario]);

  // Extract customer info from transcript
  useEffect(() => {
    if (!selectedScenario || playedLines.length === 0) return;

    const fullText = playedLines
      .filter(l => l.speaker === 'CUSTOMER')
      .map(l => l.text)
      .join(' ');

    // Simple extraction patterns
    const phoneMatch = fullText.match(/07\d{3}\s?\d{6}/);
    const postcodeMatch = fullText.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}/i);

    // Extract name (look for "I'm X" or "Name's X" patterns)
    const nameMatch = fullText.match(/(?:I'm|name's?|it's|contact is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);

    if (phoneMatch && !customerInfo.phone) {
      setCustomerInfo(prev => ({ ...prev, phone: phoneMatch[0].replace(/\s/g, '') }));
    }
    if (postcodeMatch && !customerInfo.postcode) {
      setCustomerInfo(prev => ({ ...prev, postcode: postcodeMatch[0].toUpperCase() }));
    }
    if (nameMatch && !customerInfo.name) {
      setCustomerInfo(prev => ({ ...prev, name: nameMatch[1] }));
    }

    // Extract address (look for street patterns)
    const addressMatch = fullText.match(/\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Road|Street|Lane|Avenue|Close|Way|Drive|Gardens|Place))/i);
    if (addressMatch && !customerInfo.address) {
      setCustomerInfo(prev => ({ ...prev, address: addressMatch[0] }));
    }
  }, [playedLines]);

  // Run SKU detection
  const runDetection = async () => {
    if (!selectedScenario) return;

    setIsDetecting(true);

    const customerText = playedLines
      .filter(l => l.speaker === 'CUSTOMER')
      .map(l => l.text)
      .join(' ');

    try {
      const res = await fetch('/api/intake/sku-detect-multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: customerText }),
      });

      if (!res.ok) throw new Error('Detection failed');

      const data = await res.json();

      // Convert to DetectedJob format
      const jobs: DetectedJob[] = [];

      data.matchedServices?.forEach((match: any, i: number) => {
        jobs.push({
          id: `matched-${i}`,
          description: match.task?.description || match.sku?.name,
          matched: true,
          pricePence: match.sku?.pricePence,
          sku: match.sku,
        });
      });

      data.unmatchedTasks?.forEach((task: any, i: number) => {
        jobs.push({
          id: `unmatched-${i}`,
          description: task.description,
          matched: false,
        });
      });

      setDetectedJobs(jobs);
      setDetectionRoute(data.nextRoute);

      // Auto-advance to customer info step
      setTimeout(() => setStep(3), 500);
    } catch (error) {
      console.error('Detection error:', error);
      toast({
        title: 'Detection Failed',
        description: 'Could not detect SKUs from transcript',
        variant: 'destructive',
      });
    } finally {
      setIsDetecting(false);
    }
  };

  // Action mutations
  const sendQuoteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/live-call/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerInfo: {
            name: customerInfo.name,
            phone: customerInfo.phone,
            address: customerInfo.address,
            postcode: customerInfo.postcode,
          },
          jobs: detectedJobs.map(j => ({
            id: j.id,
            description: j.description,
            matched: j.matched,
            pricePence: j.pricePence,
            sku: j.sku ? {
              id: j.sku.id,
              name: j.sku.name,
              pricePence: j.sku.pricePence,
              category: j.sku.category,
            } : undefined,
          })),
          segment: selectedScenario?.segment,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send quote');
      }

      return res.json();
    },
    onSuccess: (data) => {
      setActionResult({
        success: true,
        quoteId: data.quoteId,
        quoteUrl: data.quoteUrl,
        leadId: data.leadId,
        message: 'Quote created and WhatsApp sent!',
      });
      setStep(5);
      toast({
        title: 'Quote Sent!',
        description: `Quote link sent to ${customerInfo.phone}`,
      });
    },
    onError: (error: Error) => {
      setActionResult({
        success: false,
        error: error.message,
      });
      toast({
        title: 'Failed to Send Quote',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const getVideoMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/live-call/get-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerInfo: {
            name: customerInfo.name,
            phone: customerInfo.phone,
            address: customerInfo.address,
            postcode: customerInfo.postcode,
          },
          jobs: detectedJobs.map(j => ({
            id: j.id,
            description: j.description,
            matched: j.matched,
          })),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to request video');
      }

      return res.json();
    },
    onSuccess: (data) => {
      setActionResult({
        success: true,
        leadId: data.leadId,
        message: 'Video request sent via WhatsApp!',
      });
      setStep(5);
      toast({
        title: 'Video Request Sent!',
        description: `WhatsApp sent to ${customerInfo.phone}`,
      });
    },
    onError: (error: Error) => {
      setActionResult({
        success: false,
        error: error.message,
      });
      toast({
        title: 'Failed to Request Video',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const bookVisitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/live-call/book-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerInfo: {
            name: customerInfo.name,
            phone: customerInfo.phone,
            address: customerInfo.address,
            postcode: customerInfo.postcode,
          },
          jobs: detectedJobs.map(j => ({
            id: j.id,
            description: j.description,
            matched: j.matched,
          })),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to book visit');
      }

      return res.json();
    },
    onSuccess: (data) => {
      setActionResult({
        success: true,
        leadId: data.leadId,
        message: 'Site visit booked!',
      });
      setStep(5);
      toast({
        title: 'Visit Booked!',
        description: `Booking confirmation sent to ${customerInfo.phone}`,
      });
    },
    onError: (error: Error) => {
      setActionResult({
        success: false,
        error: error.message,
      });
      toast({
        title: 'Failed to Book Visit',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Reset wizard
  const reset = () => {
    setStep(1);
    setSelectedScenario(null);
    setTranscriptIndex(0);
    setIsPlaying(false);
    setPlayedLines([]);
    setDetectedJobs([]);
    setDetectionRoute(null);
    setCustomerInfo({ name: '', phone: '', address: '', postcode: '' });
    setActionResult(null);
  };

  // Calculate totals
  const matchedJobs = detectedJobs.filter(j => j.matched);
  const unmatchedJobs = detectedJobs.filter(j => !j.matched);
  const totalPrice = matchedJobs.reduce((sum, j) => sum + (j.pricePence || 0), 0);

  // Check if customer info is valid
  const isCustomerInfoValid = customerInfo.name.length > 0 && customerInfo.phone.length >= 10;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Phone className="w-5 h-5 text-green-400" />
              Live Call Test Wizard
            </h1>
            <p className="text-sm text-gray-400">End-to-end test with real actions</p>
          </div>
          <Button onClick={reset} variant="outline" size="sm" className="border-gray-700">
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="bg-gray-900/50 border-b border-gray-800 px-6 py-3">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between">
            {['Select Scenario', 'Play Transcript', 'Customer Info', 'Take Action', 'Result'].map((label, i) => (
              <div key={i} className="flex items-center">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  step > i + 1 ? 'bg-green-600' : step === i + 1 ? 'bg-blue-600' : 'bg-gray-700'
                )}>
                  {step > i + 1 ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={cn(
                  'ml-2 text-sm hidden sm:inline',
                  step === i + 1 ? 'text-white' : 'text-gray-500'
                )}>
                  {label}
                </span>
                {i < 4 && <ChevronRight className="w-4 h-4 mx-4 text-gray-600" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto p-6">
        {/* Step 1: Select Scenario */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Choose a Test Scenario</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SCENARIOS.map((scenario) => (
                <Card
                  key={scenario.id}
                  className={cn(
                    'bg-gray-900 border-gray-800 cursor-pointer transition-all hover:border-blue-500',
                    selectedScenario?.id === scenario.id && 'border-blue-500 ring-2 ring-blue-500/20'
                  )}
                  onClick={() => setSelectedScenario(scenario)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{scenario.name}</CardTitle>
                      <Badge variant="outline" className="text-xs">
                        {scenario.segment}
                      </Badge>
                    </div>
                    <CardDescription>{scenario.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-gray-500">
                      Expected: {scenario.expectedJobs.join(', ')}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!selectedScenario}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Transcript Playback */}
        {step === 2 && selectedScenario && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Call Transcript</h2>
              <div className="flex gap-2">
                <Button
                  onClick={() => setIsPlaying(!isPlaying)}
                  variant="outline"
                  className="border-gray-700"
                >
                  {isPlaying ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </Button>
                {playedLines.length === selectedScenario.transcript.length && !isDetecting && (
                  <Button onClick={() => setStep(3)} className="bg-blue-600 hover:bg-blue-700">
                    Continue
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                )}
              </div>
            </div>

            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
                {playedLines.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex gap-3 p-3 rounded-lg animate-in fade-in slide-in-from-bottom-2',
                      line.speaker === 'VA' ? 'bg-blue-900/30' : 'bg-gray-800'
                    )}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0',
                      line.speaker === 'VA' ? 'bg-blue-600' : 'bg-green-600'
                    )}>
                      {line.speaker === 'VA' ? 'VA' : 'C'}
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">
                        {line.speaker === 'VA' ? 'Virtual Assistant' : 'Customer'}
                      </div>
                      <div className="text-sm">{line.text}</div>
                    </div>
                  </div>
                ))}

                {isDetecting && (
                  <div className="flex items-center justify-center p-4 gap-2 text-blue-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Detecting SKUs...</span>
                  </div>
                )}

                {playedLines.length === 0 && !isPlaying && (
                  <div className="text-center py-8 text-gray-500">
                    Click Play to start the call simulation
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Detection Results Preview */}
            {detectedJobs.length > 0 && (
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-yellow-400" />
                    Detected Jobs
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {detectedJobs.map((job) => (
                    <div
                      key={job.id}
                      className={cn(
                        'flex items-center justify-between p-2 rounded',
                        job.matched ? 'bg-green-900/30' : 'bg-amber-900/30'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {job.matched ? (
                          <Check className="w-4 h-4 text-green-400" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                        )}
                        <span className="text-sm">{job.sku?.name || job.description}</span>
                      </div>
                      {job.pricePence && (
                        <span className="text-green-400 font-medium">
                          £{(job.pricePence / 100).toFixed(0)}
                        </span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Step 3: Customer Info */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Confirm Customer Details</h2>
            <p className="text-sm text-gray-400">Auto-extracted from transcript. Edit if needed.</p>

            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Name *</label>
                    <Input
                      value={customerInfo.name}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Customer name"
                      className="bg-gray-800 border-gray-700"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Phone *</label>
                    <Input
                      value={customerInfo.phone}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="07xxx xxxxxx"
                      className="bg-gray-800 border-gray-700"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Address</label>
                    <Input
                      value={customerInfo.address}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, address: e.target.value }))}
                      placeholder="Street address"
                      className="bg-gray-800 border-gray-700"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 mb-1 block">Postcode</label>
                    <Input
                      value={customerInfo.postcode}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, postcode: e.target.value }))}
                      placeholder="SW1A 1AA"
                      className="bg-gray-800 border-gray-700"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button onClick={() => setStep(2)} variant="outline" className="border-gray-700">
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={() => setStep(4)}
                disabled={!isCustomerInfoValid}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Take Action */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Choose Action</h2>

            {/* Summary */}
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-green-400">{matchedJobs.length}</div>
                    <div className="text-xs text-gray-500">Matched Jobs</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-amber-400">{unmatchedJobs.length}</div>
                    <div className="text-xs text-gray-500">Unmatched</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">£{(totalPrice / 100).toFixed(0)}</div>
                    <div className="text-xs text-gray-500">Total Quote</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-blue-400">{detectionRoute}</div>
                    <div className="text-xs text-gray-500">Recommended</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Button
                onClick={() => sendQuoteMutation.mutate()}
                disabled={matchedJobs.length === 0 || sendQuoteMutation.isPending}
                className={cn(
                  'h-24 flex-col gap-2',
                  detectionRoute === 'INSTANT_PRICE'
                    ? 'bg-green-600 hover:bg-green-700 ring-2 ring-green-400'
                    : 'bg-green-600/50 hover:bg-green-700'
                )}
              >
                {sendQuoteMutation.isPending ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <FileText className="w-6 h-6" />
                )}
                <span>SEND QUOTE</span>
                <span className="text-xs opacity-75">£{(totalPrice / 100).toFixed(0)}</span>
              </Button>

              <Button
                onClick={() => getVideoMutation.mutate()}
                disabled={getVideoMutation.isPending}
                className={cn(
                  'h-24 flex-col gap-2',
                  detectionRoute === 'VIDEO_QUOTE'
                    ? 'bg-amber-600 hover:bg-amber-700 ring-2 ring-amber-400'
                    : 'bg-amber-600/50 hover:bg-amber-700'
                )}
              >
                {getVideoMutation.isPending ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Video className="w-6 h-6" />
                )}
                <span>GET VIDEO</span>
                <span className="text-xs opacity-75">Request assessment</span>
              </Button>

              <Button
                onClick={() => bookVisitMutation.mutate()}
                disabled={bookVisitMutation.isPending}
                className={cn(
                  'h-24 flex-col gap-2',
                  detectionRoute === 'SITE_VISIT' || detectionRoute === 'MIXED_QUOTE'
                    ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400'
                    : 'bg-blue-600/50 hover:bg-blue-700'
                )}
              >
                {bookVisitMutation.isPending ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <MapPin className="w-6 h-6" />
                )}
                <span>BOOK VISIT</span>
                <span className="text-xs opacity-75">Schedule on-site</span>
              </Button>
            </div>

            <div className="flex justify-start">
              <Button onClick={() => setStep(3)} variant="outline" className="border-gray-700">
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </div>
          </div>
        )}

        {/* Step 5: Result */}
        {step === 5 && actionResult && (
          <div className="space-y-4">
            <Card className={cn(
              'border-2',
              actionResult.success ? 'bg-green-900/20 border-green-600' : 'bg-red-900/20 border-red-600'
            )}>
              <CardContent className="p-8 text-center">
                {actionResult.success ? (
                  <>
                    <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Check className="w-8 h-8" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Success!</h2>
                    <p className="text-gray-400 mb-4">{actionResult.message}</p>

                    {actionResult.quoteUrl && (
                      <a
                        href={actionResult.quoteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300"
                      >
                        <ExternalLink className="w-4 h-4" />
                        View Quote
                      </a>
                    )}

                    {actionResult.leadId && (
                      <div className="mt-4 text-sm text-gray-500">
                        Lead ID: {actionResult.leadId}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Error</h2>
                    <p className="text-red-400">{actionResult.error}</p>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-center">
              <Button onClick={reset} className="bg-blue-600 hover:bg-blue-700">
                <RotateCcw className="w-4 h-4 mr-2" />
                Run Another Test
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
