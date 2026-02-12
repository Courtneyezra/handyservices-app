import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Check, Clock, Wrench, Trash2, Plus, Users, FileText, PoundSterling, Sparkles, Send } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import Autocomplete from "react-google-autocomplete";

import type { TaskItem, Segment, QuoteBuilderMode, AnalyzedJobData, SEGMENT_OPTIONS as SegmentOptionsType } from '@/types/quote-builder';
import { SEGMENT_OPTIONS } from '@/types/quote-builder';
import {
  calculateTotals,
  getEffectivePrice,
  mapApiTasksToTaskItems,
  calculateBasePriceFromAnalysis,
  createEmptyTask
} from '@/lib/quote-price-calculator';

export interface QuoteBuilderProps {
  mode: QuoteBuilderMode;
  initialData?: {
    customerName?: string;
    phone?: string;
    email?: string;
    address?: string;
    postcode?: string;
    jobDescription?: string;
    segment?: Segment;
    tasks?: TaskItem[];
    analyzedJob?: {
      summary: string;
      tasks: TaskItem[];
      totalHours: number;
      basePricePounds: number;
    } | null;
    priceOverride?: string;
    conversationContext?: string;
  };
  onSubmit: (data: {
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
  }) => Promise<void>;
  isSubmitting: boolean;
  submitLabel?: string;
  showWhatsAppContext?: boolean;
}

export function QuoteBuilder({
  mode,
  initialData,
  onSubmit,
  isSubmitting,
  submitLabel = mode === 'create' ? 'Generate Quote Link' : 'Save Changes',
  showWhatsAppContext = mode === 'create',
}: QuoteBuilderProps) {
  const { toast } = useToast();

  // Customer fields
  const [customerName, setCustomerName] = useState(initialData?.customerName || '');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [address, setAddress] = useState(initialData?.address || '');
  const [postcode, setPostcode] = useState(initialData?.postcode || '');

  // Job fields
  const [jobDescription, setJobDescription] = useState(initialData?.jobDescription || '');
  const [segment, setSegment] = useState<Segment>(initialData?.segment || 'BUSY_PRO');

  // AI Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzedJob, setAnalyzedJob] = useState<{
    summary: string;
    tasks: TaskItem[];
    totalHours: number;
    basePricePounds: number;
  } | null>(initialData?.analyzedJob || null);

  // Editable tasks (from analysis)
  const [tasks, setTasks] = useState<TaskItem[]>(initialData?.tasks || []);

  // Price override
  const [priceOverride, setPriceOverride] = useState(initialData?.priceOverride || '');

  // WhatsApp conversation context (for create mode)
  const [conversationContext, setConversationContext] = useState(initialData?.conversationContext || '');

  // Calculate totals
  const totals = calculateTotals(tasks);
  const effectivePrice = getEffectivePrice(priceOverride, totals.totalPrice);

  // Sync with initialData when it changes (for edit mode)
  useEffect(() => {
    if (initialData) {
      if (initialData.customerName !== undefined) setCustomerName(initialData.customerName);
      if (initialData.phone !== undefined) setPhone(initialData.phone);
      if (initialData.email !== undefined) setEmail(initialData.email || '');
      if (initialData.address !== undefined) setAddress(initialData.address || '');
      if (initialData.postcode !== undefined) setPostcode(initialData.postcode || '');
      if (initialData.jobDescription !== undefined) setJobDescription(initialData.jobDescription);
      if (initialData.segment !== undefined) setSegment(initialData.segment);
      if (initialData.tasks !== undefined) setTasks(initialData.tasks);
      if (initialData.analyzedJob !== undefined) setAnalyzedJob(initialData.analyzedJob);
      if (initialData.priceOverride !== undefined) setPriceOverride(initialData.priceOverride);
      if (initialData.conversationContext !== undefined) setConversationContext(initialData.conversationContext || '');
    }
  }, [initialData]);

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
      const mappedTasks = mapApiTasksToTaskItems(data.tasks);
      const basePricePounds = calculateBasePriceFromAnalysis(data);

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

  // Task handlers - clear price override when tasks change so calculated price is used
  const updateTask = (id: string, field: keyof TaskItem, value: any) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
    setPriceOverride(''); // Clear override to use calculated price
  };

  const removeTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    setPriceOverride(''); // Clear override to use calculated price
  };

  const addTask = () => {
    setTasks(prev => [...prev, createEmptyTask()]);
    setPriceOverride(''); // Clear override to use calculated price
  };

  // Form validation
  const validateForm = (): boolean => {
    if (!customerName.trim()) {
      toast({ title: 'Missing Name', description: 'Please enter customer name.', variant: 'destructive' });
      return false;
    }
    if (!phone.trim()) {
      toast({ title: 'Missing Phone', description: 'Please enter phone number.', variant: 'destructive' });
      return false;
    }
    if (!postcode.trim()) {
      toast({ title: 'Missing Postcode', description: 'Please enter postcode.', variant: 'destructive' });
      return false;
    }
    if (!jobDescription.trim()) {
      toast({ title: 'Missing Job', description: 'Please describe the job.', variant: 'destructive' });
      return false;
    }
    if (effectivePrice <= 0) {
      toast({ title: 'Missing Price', description: 'Please analyze the job or enter a price.', variant: 'destructive' });
      return false;
    }
    return true;
  };

  // Handle form submit
  const handleSubmit = async () => {
    if (!validateForm()) return;

    await onSubmit({
      customerName,
      phone,
      email: email || undefined,
      address: address || undefined,
      postcode,
      jobDescription,
      segment,
      tasks,
      analyzedJobData: analyzedJob ? {
        tasks,
        summary: analyzedJob.summary,
        totalEstimatedHours: totals.totalHours,
        basePricePounds: effectivePrice,
      } : null,
      effectivePrice,
      conversationContext: conversationContext || undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* WhatsApp Conversation Context - Only in create mode */}
      {showWhatsAppContext && (
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
              onChange={(e) => setConversationContext(e.target.value)}
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
      )}

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
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" />
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
              <><Sparkles className="w-4 h-4 mr-2" /> {analyzedJob ? 'Re-analyze Job' : 'Analyze Job & Calculate Price'}</>
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
                      <Label className="text-xs text-slate-500">Materials {"\u00A3"}</Label>
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
                <span>{"\u00A3"}{totals.totalLabor.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Materials (inc. 30% markup)</span>
                <span>{"\u00A3"}{totals.materialsWithMarkup.toFixed(0)}</span>
              </div>
              <div className="flex justify-between font-bold border-t pt-2">
                <span>Calculated Total</span>
                <span>{"\u00A3"}{totals.totalPrice}</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Base Job Price ({"\u00A3"}) {tasks.length > 0 ? '(Override)' : '*'}</Label>
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
            <div className="text-2xl font-bold text-green-800">{"\u00A3"}{effectivePrice || 0}</div>
          </div>
        </CardContent>
      </Card>

      {/* Submit Button */}
      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || effectivePrice <= 0}
        className="w-full h-14 text-lg font-semibold bg-green-600 hover:bg-green-700"
      >
        {isSubmitting ? (
          <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {mode === 'create' ? 'Generating...' : 'Saving...'}</>
        ) : (
          <><Send className="w-5 h-5 mr-2" /> {submitLabel}</>
        )}
      </Button>
    </div>
  );
}

export default QuoteBuilder;
