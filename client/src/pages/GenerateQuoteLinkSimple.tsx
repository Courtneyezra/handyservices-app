import { useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Copy, Check, Loader2, Send, Users, FileText, PoundSterling, Sparkles, Clock, Wrench, Trash2, Plus } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import Autocomplete from "react-google-autocomplete";

type Segment = 'BUSY_PRO' | 'PROP_MGR' | 'SMALL_BIZ' | 'DIY_DEFERRER' | 'BUDGET' | 'OLDER_WOMAN';

interface TaskItem {
  id: string;
  description: string;
  quantity: number;
  hours: number;
  materialCost: number;
  complexity: 'low' | 'medium' | 'high';
}

// Segment descriptions for selection
const SEGMENT_OPTIONS: { value: Segment; label: string; description: string }[] = [
  { value: 'BUSY_PRO', label: 'Busy Professional', description: 'Time-poor, values speed & convenience' },
  { value: 'OLDER_WOMAN', label: 'Older Customer', description: 'Values trust, safety & reliability' },
  { value: 'PROP_MGR', label: 'Property Manager', description: 'Manages multiple properties, needs fast response' },
  { value: 'SMALL_BIZ', label: 'Small Business', description: 'Needs after-hours, minimal disruption' },
  { value: 'DIY_DEFERRER', label: 'DIY Deferrer', description: 'Has a list of jobs, price-conscious' },
  { value: 'BUDGET', label: 'Budget Customer', description: 'Most price-sensitive, single tier only' },
];

export default function GenerateQuoteLinkSimple() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Essential state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Customer fields
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');

  // Job fields
  const [jobDescription, setJobDescription] = useState('');
  const [segment, setSegment] = useState<Segment>('BUSY_PRO');

  // AI Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzedJob, setAnalyzedJob] = useState<{
    summary: string;
    tasks: TaskItem[];
    totalHours: number;
    basePricePounds: number;
  } | null>(null);

  // Editable tasks (from analysis)
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  // Price override
  const [priceOverride, setPriceOverride] = useState('');

  // Generated pricing display
  const [generatedPricing, setGeneratedPricing] = useState<{
    essential: number;
    enhanced: number;
    elite: number;
  } | null>(null);

  // WhatsApp conversation context for contextual messaging
  const [conversationContext, setConversationContext] = useState('');
  const [aiGeneratedMessage, setAiGeneratedMessage] = useState<string | null>(null);
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);

  // Calculate totals from tasks
  const calculateTotals = () => {
    const hourlyRate = 50; // Base hourly rate
    const complexityMultipliers = { low: 0.85, medium: 1.0, high: 1.25 };

    let totalHours = 0;
    let totalMaterials = 0;
    let totalLabor = 0;

    tasks.forEach(task => {
      const hours = (task.hours || 0) * (task.quantity || 1);
      const multiplier = complexityMultipliers[task.complexity] || 1.0;
      totalHours += hours;
      totalMaterials += (task.materialCost || 0) * (task.quantity || 1);
      totalLabor += hours * hourlyRate * multiplier;
    });

    const materialsWithMarkup = totalMaterials * 1.3; // 30% markup
    const totalPrice = Math.round(totalLabor + materialsWithMarkup);

    return { totalHours, totalMaterials, materialsWithMarkup, totalLabor, totalPrice };
  };

  const totals = calculateTotals();
  const effectivePrice = priceOverride ? parseFloat(priceOverride) : totals.totalPrice;

  // AI Job Analysis
  const handleAnalyze = async () => {
    if (!jobDescription || jobDescription.trim().length < 10) {
      toast({ title: 'Too Short', description: 'Please provide more details about the job.', variant: 'destructive' });
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await fetch('/api/analyze-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription }),
      });

      if (!response.ok) throw new Error('Analysis failed');

      const data = await response.json();

      // Map API tasks to our format
      const mappedTasks: TaskItem[] = (data.tasks || []).map((t: any, idx: number) => ({
        id: `task-${idx}`,
        description: t.description || t.task || 'Task',
        quantity: t.quantity || 1,
        hours: t.estimatedHours || t.hours || 1,
        materialCost: t.materialCost || t.materials || 0,
        complexity: t.complexity || 'medium',
      }));

      // Calculate base price
      let basePricePounds = 0;
      if (data.estimatedRange?.low && data.estimatedRange?.high) {
        basePricePounds = Math.round((data.estimatedRange.low + data.estimatedRange.high) / 2);
      } else if (data.basePricePounds) {
        basePricePounds = Math.round(data.basePricePounds);
      } else if (data.totalEstimatedHours) {
        basePricePounds = Math.round(data.totalEstimatedHours * 50);
      }

      setAnalyzedJob({
        summary: data.summary || '',
        tasks: mappedTasks,
        totalHours: data.totalEstimatedHours || 0,
        basePricePounds,
      });

      setTasks(mappedTasks);
      setPriceOverride(''); // Reset override

      toast({ title: 'Analysis Complete', description: `${mappedTasks.length} tasks identified` });

    } catch (error: any) {
      toast({ title: 'Analysis Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Task handlers
  const updateTask = (id: string, field: keyof TaskItem, value: any) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const removeTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const addTask = () => {
    setTasks(prev => [...prev, {
      id: `task-${Date.now()}`,
      description: 'New task',
      quantity: 1,
      hours: 1,
      materialCost: 0,
      complexity: 'medium',
    }]);
  };

  // Generate quote
  const handleGenerate = async () => {
    if (!customerName.trim()) {
      toast({ title: 'Missing Name', description: 'Please enter customer name.', variant: 'destructive' });
      return;
    }
    if (!phone.trim()) {
      toast({ title: 'Missing Phone', description: 'Please enter phone number.', variant: 'destructive' });
      return;
    }
    if (!postcode.trim()) {
      toast({ title: 'Missing Postcode', description: 'Please enter postcode.', variant: 'destructive' });
      return;
    }
    if (!jobDescription.trim()) {
      toast({ title: 'Missing Job', description: 'Please describe the job.', variant: 'destructive' });
      return;
    }
    if (effectivePrice <= 0) {
      toast({ title: 'Missing Price', description: 'Please analyze the job or enter a price.', variant: 'destructive' });
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch('/api/personalized-quotes/value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          phone,
          postcode,
          address: address || undefined,
          jobDescription,
          baseJobPrice: Math.round(effectivePrice * 100),
          manualSegment: segment,
          quoteMode: 'hhh',
          urgencyReason: 'med',
          ownershipContext: 'homeowner',
          desiredTimeframe: 'week',
          clientType: segment === 'PROP_MGR' || segment === 'SMALL_BIZ' ? 'commercial' : 'residential',
          analyzedJobData: analyzedJob ? {
            tasks: tasks,
            totalEstimatedHours: totals.totalHours,
            basePricePounds: effectivePrice,
            summary: analyzedJob.summary,
          } : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to create quote' }));
        throw new Error(error.message);
      }

      const data = await response.json();
      const url = `${window.location.origin}/quote-link/${data.shortSlug}`;
      setGeneratedUrl(url);

      if (data.essential?.price) {
        setGeneratedPricing({
          essential: data.essential.price / 100,
          enhanced: data.hassleFree?.price / 100 || 0,
          elite: data.highStandard?.price / 100 || 0,
        });
      }

      // Auto-generate AI message if conversation context is provided
      if (conversationContext.trim()) {
        setIsGeneratingMessage(true);
        try {
          const msgResponse = await fetch('/api/generate-quote-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversationContext,
              customerName,
              jobDescription,
              segment,
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
    // Use AI-generated message if available, otherwise use default
    const message = aiGeneratedMessage || `Hi ${customerName.split(' ')[0]}, here's your personalised quote: ${generatedUrl}`;
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleReset = () => {
    setCustomerName('');
    setPhone('');
    setAddress('');
    setPostcode('');
    setJobDescription('');
    setSegment('BUSY_PRO');
    setAnalyzedJob(null);
    setTasks([]);
    setPriceOverride('');
    setGeneratedUrl('');
    setGeneratedPricing(null);
    setConversationContext('');
    setAiGeneratedMessage(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Generate Quote</h1>
          <p className="text-slate-600 mt-2">Create a personalised quote link in seconds</p>
        </div>

        {/* WhatsApp Conversation Context */}
        <Card className="border-2 border-green-200 bg-green-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-green-800">
              <FaWhatsapp className="w-6 h-6 text-green-600" />
              Paste WhatsApp Conversation
            </CardTitle>
            <p className="text-sm text-green-700 mt-1">
              Paste the last few messages to generate a contextual, segment-styled reply
            </p>
          </CardHeader>
          <CardContent>
            <textarea
              value={conversationContext}
              onChange={(e) => {
                setConversationContext(e.target.value);
                setAiGeneratedMessage(null);
              }}
              placeholder="Paste your WhatsApp conversation here...

Example:
[Customer]: Hi, can you help with a dripping tap?
[You]: Hi! Yes absolutely. Which tap is it?
[Customer]: Kitchen sink, it's been getting worse
[You]: No problem, I'll get you a quote now"
              className="w-full h-32 px-4 py-3 text-sm bg-white border-2 border-green-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
            />
          </CardContent>
        </Card>

        {/* Customer Info */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5 text-blue-600" />
              Customer Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="John Smith" />
              </div>
              <div className="space-y-2">
                <Label>Phone *</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07700 900000" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Autocomplete
                apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                onPlaceSelected={(place) => {
                  setAddress(place.formatted_address || '');
                  const postcodeComponent = place.address_components?.find((c: any) => c.types.includes('postal_code'));
                  if (postcodeComponent) setPostcode(postcodeComponent.long_name);
                }}
                options={{ types: ['address'], componentRestrictions: { country: 'gb' } }}
                defaultValue={address}
                className="w-full px-3 py-2 border border-input rounded-md bg-background"
                placeholder="Start typing address..."
              />
            </div>
            <div className="space-y-2">
              <Label>Postcode *</Label>
              <Input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="NG1 1AA" />
            </div>
          </CardContent>
        </Card>

        {/* Job Details + Analysis */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="w-5 h-5 text-green-600" />
              Job Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>What needs doing? *</Label>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Describe the job in detail..."
                className="w-full min-h-[100px] px-3 py-2 border border-input rounded-md bg-background resize-none"
              />
            </div>

            {/* Analyze Button */}
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !jobDescription.trim()}
              variant="outline"
              className="w-full"
            >
              {isAnalyzing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Analyze Job & Calculate Price</>
              )}
            </Button>

            {/* Analysis Summary */}
            {analyzedJob && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-green-700 font-medium">
                  <Check className="w-4 h-4" />
                  Analysis Complete
                </div>
                {analyzedJob.summary && (
                  <p className="text-sm text-slate-600">{analyzedJob.summary}</p>
                )}
                <div className="flex gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {totals.totalHours.toFixed(1)}h estimated
                  </span>
                  <span className="flex items-center gap-1">
                    <Wrench className="w-4 h-4 text-slate-400" />
                    {tasks.length} tasks
                  </span>
                </div>
              </div>
            )}

            {/* Editable Tasks */}
            {tasks.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Task Breakdown</Label>
                  <Button variant="ghost" size="sm" onClick={addTask}>
                    <Plus className="w-4 h-4 mr-1" /> Add Task
                  </Button>
                </div>

                {tasks.map((task) => (
                  <div key={task.id} className="bg-slate-50 border rounded-lg p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Input
                        value={task.description}
                        onChange={(e) => updateTask(task.id, 'description', e.target.value)}
                        className="flex-1 text-sm"
                        placeholder="Task description"
                      />
                      <Button variant="ghost" size="sm" onClick={() => removeTask(task.id)}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <Label className="text-xs text-slate-500">Qty</Label>
                        <Input
                          type="number"
                          value={task.quantity}
                          onChange={(e) => updateTask(task.id, 'quantity', parseInt(e.target.value) || 1)}
                          min="1"
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Hours</Label>
                        <Input
                          type="number"
                          value={task.hours}
                          onChange={(e) => updateTask(task.id, 'hours', parseFloat(e.target.value) || 0)}
                          min="0"
                          step="0.5"
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Materials £</Label>
                        <Input
                          type="number"
                          value={task.materialCost}
                          onChange={(e) => updateTask(task.id, 'materialCost', parseFloat(e.target.value) || 0)}
                          min="0"
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500">Complexity</Label>
                        <Select value={task.complexity} onValueChange={(v: any) => updateTask(task.id, 'complexity', v)}>
                          <SelectTrigger className="text-sm h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Segment & Price */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <PoundSterling className="w-5 h-5 text-amber-600" />
              Pricing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Customer Segment *</Label>
              <Select value={segment} onValueChange={(v: Segment) => setSegment(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEGMENT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">- {opt.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Calculated Price Summary */}
            {tasks.length > 0 && (
              <div className="bg-slate-100 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Labor ({totals.totalHours.toFixed(1)}h)</span>
                  <span>£{totals.totalLabor.toFixed(0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Materials (inc. 30% markup)</span>
                  <span>£{totals.materialsWithMarkup.toFixed(0)}</span>
                </div>
                <div className="flex justify-between font-bold border-t pt-2">
                  <span>Calculated Total</span>
                  <span>£{totals.totalPrice}</span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Base Job Price (£) {tasks.length > 0 ? '(Override)' : '*'}</Label>
              <Input
                type="number"
                value={priceOverride || (tasks.length === 0 ? '' : '')}
                onChange={(e) => setPriceOverride(e.target.value)}
                placeholder={tasks.length > 0 ? `${totals.totalPrice} (calculated)` : '150'}
                min="0"
                step="10"
              />
              {tasks.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Analyze the job above or enter a manual price
                </p>
              )}
            </div>

            {/* Effective Price Display */}
            <div className="bg-green-100 border border-green-300 rounded-lg p-3 text-center">
              <div className="text-sm text-green-700">Base Price for Quote</div>
              <div className="text-2xl font-bold text-green-800">£{effectivePrice || 0}</div>
            </div>
          </CardContent>
        </Card>

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || effectivePrice <= 0}
          className="w-full h-14 text-lg font-semibold bg-green-600 hover:bg-green-700"
        >
          {isGenerating ? (
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Generating...</>
          ) : (
            <><Send className="w-5 h-5 mr-2" /> Generate Quote Link</>
          )}
        </Button>

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
                    <div className="text-xl font-bold text-slate-900">£{Math.round(generatedPricing.essential)}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 text-center border-2 border-green-500">
                    <div className="text-xs text-green-600 uppercase font-semibold">Priority</div>
                    <div className="text-xl font-bold text-green-700">£{Math.round(generatedPricing.enhanced)}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 text-center border">
                    <div className="text-xs text-slate-500 uppercase">Premium</div>
                    <div className="text-xl font-bold text-slate-900">£{Math.round(generatedPricing.elite)}</div>
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
                        onClick={async () => {
                          if (!conversationContext.trim()) return;
                          setIsGeneratingMessage(true);
                          try {
                            const response = await fetch('/api/generate-quote-message', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                conversationContext,
                                customerName,
                                jobDescription,
                                segment,
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
                        }}
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
