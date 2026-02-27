import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Copy, Check, Loader2, Sparkles } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';

import { QuoteBuilder } from '@/components/quote/QuoteBuilder';
import type { TaskItem, Segment, AnalyzedJobData } from '@/types/quote-builder';
import { poundsToPence } from '@/lib/quote-price-calculator';

// Interface for detected jobs passed from CallReviewPage
interface DetectedJob {
  id: string;
  description: string;
  matched: boolean;
  quantity?: number;
  sku?: {
    id: string;
    name: string;
    pricePence: number;
    category?: string;
  };
  trafficLight?: 'green' | 'amber' | 'red';
}

// Convert detected jobs to TaskItem format for QuoteBuilder
function convertJobsToTasks(jobs: DetectedJob[]): TaskItem[] {
  return jobs.map((job, index) => ({
    id: job.id || `job-${index}`,
    description: job.sku?.name || job.description,
    quantity: job.quantity || 1,
    hours: job.sku ? Math.max(0.5, (job.sku.pricePence / 100) / 45) : 1, // Estimate hours from price (approx £45/hr)
    materialCost: 0,
    complexity: job.trafficLight === 'red' ? 'high' : job.trafficLight === 'amber' ? 'medium' : 'low',
  }));
}

// Calculate base price from detected jobs
function calculateBasePriceFromJobs(jobs: DetectedJob[]): number {
  return jobs.reduce((total, job) => {
    if (job.matched && job.sku) {
      return total + (job.sku.pricePence / 100) * (job.quantity || 1);
    }
    return total;
  }, 0);
}

// Valid segments for type checking (matches Segment type)
const VALID_SEGMENTS: Segment[] = ['EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'TRUST_SEEKER', 'RENTER', 'DIY_DEFERRER'];

export default function GenerateQuoteLinkSimple() {
  const { toast } = useToast();

  // Parse URL params for pre-filling (from Leads/Calls pages)
  const initialData = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const segmentParam = params.get('segment');
    const segment = segmentParam && VALID_SEGMENTS.includes(segmentParam as Segment)
      ? (segmentParam as Segment)
      : undefined;

    // Parse jobs from URL params (passed from CallReviewPage)
    let detectedJobs: DetectedJob[] = [];
    const jobsParam = params.get('jobs');
    if (jobsParam) {
      try {
        detectedJobs = JSON.parse(jobsParam);
      } catch (e) {
        console.error('[GenerateQuoteLinkSimple] Failed to parse jobs from URL:', e);
      }
    }

    // Convert detected jobs to tasks and calculate price
    const tasks = detectedJobs.length > 0 ? convertJobsToTasks(detectedJobs) : undefined;
    const basePrice = detectedJobs.length > 0 ? calculateBasePriceFromJobs(detectedJobs) : 0;

    // Build job description from detected jobs if not provided
    let jobDescription = params.get('description') || params.get('jobDescription') || undefined;
    if (!jobDescription && detectedJobs.length > 0) {
      jobDescription = detectedJobs
        .map(job => {
          const qty = job.quantity && job.quantity > 1 ? `${job.quantity}x ` : '';
          return qty + (job.sku?.name || job.description);
        })
        .join(', ');
    }

    // Create analyzedJob data if we have detected jobs
    const analyzedJob = tasks && tasks.length > 0 ? {
      summary: `${detectedJobs.length} job${detectedJobs.length > 1 ? 's' : ''} detected from call`,
      tasks,
      totalHours: tasks.reduce((sum, t) => sum + t.hours * t.quantity, 0),
      basePricePounds: basePrice,
    } : undefined;

    return {
      customerName: params.get('name') || params.get('customerName') || undefined,
      phone: params.get('phone') || undefined,
      email: params.get('email') || undefined,
      address: params.get('address') || undefined,
      postcode: params.get('postcode') || undefined,
      jobDescription,
      segment,
      tasks,
      analyzedJob,
      priceOverride: basePrice > 0 ? String(Math.round(basePrice)) : undefined,
    };
  }, []);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Generated pricing display
  const [generatedPricing, setGeneratedPricing] = useState<{
    essential: number;
    enhanced: number;
    elite: number;
  } | null>(null);

  // WhatsApp message state
  const [aiGeneratedMessage, setAiGeneratedMessage] = useState<string | null>(null);
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const [lastSubmitData, setLastSubmitData] = useState<{
    customerName: string;
    jobDescription: string;
    segment: Segment;
    conversationContext?: string;
  } | null>(null);

  // Handle quote generation
  const handleSubmit = async (data: {
    customerName: string;
    phone: string;
    email?: string;
    address?: string;
    postcode: string;
    jobDescription: string;
    segment: Segment;
    tasks: TaskItem[];
    analyzedJobData: AnalyzedJobData | null;
    effectivePrice: number;
    conversationContext?: string;
  }) => {
    setIsGenerating(true);

    try {
      const response = await fetch('/api/personalized-quotes/value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: data.customerName,
          phone: data.phone,
          postcode: data.postcode,
          address: data.address || undefined,
          email: data.email || undefined,
          jobDescription: data.jobDescription,
          baseJobPrice: poundsToPence(data.effectivePrice),
          manualSegment: data.segment,
          quoteMode: 'hhh',
          urgencyReason: 'med',
          ownershipContext: 'homeowner',
          desiredTimeframe: 'week',
          clientType: data.segment === 'PROP_MGR' || data.segment === 'SMALL_BIZ' ? 'commercial' : 'residential',
          analyzedJobData: data.analyzedJobData || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to create quote' }));
        throw new Error(error.message);
      }

      const result = await response.json();
      const url = `${window.location.origin}/quote/${result.shortSlug}`;
      setGeneratedUrl(url);

      if (result.essential?.price) {
        setGeneratedPricing({
          essential: result.essential.price / 100,
          enhanced: result.hassleFree?.price / 100 || 0,
          elite: result.highStandard?.price / 100 || 0,
        });
      }

      // Store data for message regeneration
      setLastSubmitData({
        customerName: data.customerName,
        jobDescription: data.jobDescription,
        segment: data.segment,
        conversationContext: data.conversationContext,
      });

      // Auto-generate AI message if conversation context is provided
      if (data.conversationContext?.trim()) {
        setIsGeneratingMessage(true);
        try {
          const msgResponse = await fetch('/api/generate-quote-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversationContext: data.conversationContext,
              customerName: data.customerName,
              jobDescription: data.jobDescription,
              segment: data.segment,
              quoteUrl: url,
            }),
          });

          if (msgResponse.ok) {
            const msgData = await msgResponse.json();
            setAiGeneratedMessage(msgData.message);
          }
        } catch (msgError) {
          console.error('Error generating AI message:', msgError);
        } finally {
          setIsGeneratingMessage(false);
        }
      }

      toast({ title: 'Quote Created!', description: 'Link is ready to share.' });

    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    toast({ title: 'Copied!' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    const message = aiGeneratedMessage || `Hi ${lastSubmitData?.customerName?.split(' ')[0] || 'there'}, here's your personalised quote: ${generatedUrl}`;
    const phone = ''; // Phone would need to be passed through - for now use empty
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleRegenerateMessage = async () => {
    if (!lastSubmitData?.conversationContext?.trim() || !generatedUrl) return;

    setIsGeneratingMessage(true);
    try {
      const response = await fetch('/api/generate-quote-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationContext: lastSubmitData.conversationContext,
          customerName: lastSubmitData.customerName,
          jobDescription: lastSubmitData.jobDescription,
          segment: lastSubmitData.segment,
          quoteUrl: generatedUrl,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        setAiGeneratedMessage(data.message);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  const handleReset = () => {
    setGeneratedUrl('');
    setGeneratedPricing(null);
    setAiGeneratedMessage(null);
    setLastSubmitData(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Generate Quote</h1>
          <p className="text-slate-600 mt-2">Create a personalised quote link in seconds</p>
        </div>

        {/* Quote Builder */}
        {!generatedUrl && (
          <QuoteBuilder
            mode="create"
            initialData={initialData}
            onSubmit={handleSubmit}
            isSubmitting={isGenerating}
            submitLabel="Generate Quote Link"
            showWhatsAppContext={true}
          />
        )}

        {/* Generated Result */}
        {generatedUrl && (
          <Card className="border-2 border-green-500 bg-green-50">
            <CardHeader className="pb-4">
              <CardTitle className="text-green-700">Quote Ready!</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Pricing Display */}
              {generatedPricing && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-white rounded-lg p-3 text-center border">
                    <div className="text-xs text-slate-500 uppercase">Standard</div>
                    <div className="text-xl font-bold text-slate-900">{"\u00A3"}{Math.round(generatedPricing.essential)}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 text-center border-2 border-green-500">
                    <div className="text-xs text-green-600 uppercase font-semibold">Priority</div>
                    <div className="text-xl font-bold text-green-700">{"\u00A3"}{Math.round(generatedPricing.enhanced)}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 text-center border">
                    <div className="text-xs text-slate-500 uppercase">Premium</div>
                    <div className="text-xl font-bold text-slate-900">{"\u00A3"}{Math.round(generatedPricing.elite)}</div>
                  </div>
                </div>
              )}

              {/* URL */}
              <div className="flex items-center gap-2 bg-white rounded-lg p-3 border">
                <input type="text" value={generatedUrl} readOnly className="flex-1 bg-transparent text-sm font-mono truncate" />
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>

              {/* AI-Generated Message Preview */}
              {(aiGeneratedMessage || isGeneratingMessage) && (
                <div className="bg-white rounded-lg p-4 border-2 border-green-300">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
                      <FaWhatsapp className="w-4 h-4" />
                      Message Preview
                    </div>
                    {aiGeneratedMessage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRegenerateMessage}
                        className="text-green-600 hover:text-green-700"
                      >
                        <Sparkles className="w-4 h-4 mr-1" />
                        Regenerate
                      </Button>
                    )}
                  </div>
                  {isGeneratingMessage ? (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Generating message...</span>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-700 whitespace-pre-wrap bg-green-50 rounded-lg p-3">
                      {aiGeneratedMessage}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <Button onClick={handleWhatsApp} className="flex-1 bg-green-600 hover:bg-green-700">
                  <FaWhatsapp className="w-5 h-5 mr-2" /> Send via WhatsApp
                </Button>
                <Button variant="outline" onClick={() => window.open(generatedUrl, '_blank')} className="flex-1">
                  Preview Quote
                </Button>
              </div>

              <Button variant="ghost" onClick={handleReset} className="w-full mt-2">
                Create Another Quote
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
