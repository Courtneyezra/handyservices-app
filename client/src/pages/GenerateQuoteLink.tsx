import { useState, useEffect, useMemo } from 'react';
import { useLocation, Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Copy, Check, Loader2, LinkIcon, Send, X, Plus, Shield, ArrowRight, Search, Eye, Edit, Trash2, RefreshCw, Phone, CreditCard, Calendar, Settings, FileText, Receipt, DollarSign, Wrench, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FaWhatsapp } from 'react-icons/fa';
import Autocomplete from "react-google-autocomplete";
import { format } from 'date-fns';
import {
  urgencyReasonEnum,
  ownershipContextEnum,
  desiredTimeframeEnum,
} from '@shared/schema';

// Task item interface for editable tasks
interface TaskItem {
  id: string;
  description: string;
  quantity: number;
  hours: number;
  materialCost: number;
  complexity: 'low' | 'medium' | 'high';
}

interface PersonalizedQuote {
  id: string;
  shortSlug: string;
  customerName: string;
  phone: string;
  email: string | null;
  postcode: string | null;
  jobDescription: string;
  completionDate: string;
  quoteMode: 'simple' | 'hhh' | 'pick_and_mix' | 'consultation';
  essentialPrice: number | null;
  enhancedPrice: number | null;
  elitePrice: number | null;
  basePrice: number | null;
  materialsCostWithMarkupPence: number | null;
  viewedAt: string | null;
  assessmentReason: string | null;
  selectedPackage: string | null;
  selectedAt: string | null;
  bookedAt: string | null;
  expiresAt: string | null;
  regeneratedFromId: string | null;
  regenerationCount: number | null;
  paymentType: string | null;
  depositPaidAt: string | null;
  leadId: string | null;
  createdAt: string;
  visitTierMode?: 'tiers' | 'fixed' | null;
}

export default function GenerateQuoteLink() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Login state
  // Login state removed
  // const [email, setEmail] = useState('');
  // const [password, setPassword] = useState('');
  // const [showPassword, setShowPassword] = useState(false);
  // const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<'generate' | 'sent' | 'settings'>('generate');
  const [generatorTab, setGeneratorTab] = useState<'estimator' | 'diagnostic'>('estimator');
  const [searchQuery, setSearchQuery] = useState('');

  // Invoice modal state
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceData, setInvoiceData] = useState<any>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  // Form state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Value pricing inputs
  const [jobDescription, setJobDescription] = useState('');
  const [quoteMode, setQuoteMode] = useState<'hhh' | 'simple' | 'pick_and_mix' | 'consultation'>('hhh'); // Quote mode toggle
  const [urgencyReason, setUrgencyReason] = useState<'low' | 'med' | 'high'>('med');
  const [ownershipContext, setOwnershipContext] = useState<'tenant' | 'homeowner' | 'landlord' | 'airbnb' | 'selling'>('homeowner');
  const [desiredTimeframe, setDesiredTimeframe] = useState<'flex' | 'week' | 'asap'>('flex');
  const [additionalNotes, setAdditionalNotes] = useState('');

  // AI job analysis state
  const [analyzedJob, setAnalyzedJob] = useState<{
    tasks: any[];
    totalEstimatedHours: number;
    basePricePounds: number;
    summary?: string;
  } | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [overridePrice, setOverridePrice] = useState<string>('');
  // TIER PRICING STATE
  const [tierStandardPrice, setTierStandardPrice] = useState<string>('49');
  const [tierPriorityPrice, setTierPriorityPrice] = useState<string>('99');
  const [tierEmergencyPrice, setTierEmergencyPrice] = useState<string>('175');

  // Load saved pricing configuration on mount
  useEffect(() => {
    const savedStandard = localStorage.getItem('tierStandardPrice');
    const savedPriority = localStorage.getItem('tierPriorityPrice');
    const savedEmergency = localStorage.getItem('tierEmergencyPrice');

    if (savedStandard) setTierStandardPrice(savedStandard);
    if (savedPriority) setTierPriorityPrice(savedPriority);
    if (savedEmergency) setTierEmergencyPrice(savedEmergency);
  }, []);

  // Persist pricing configuration when changed
  useEffect(() => {
    localStorage.setItem('tierStandardPrice', tierStandardPrice);
    localStorage.setItem('tierPriorityPrice', tierPriorityPrice);
    localStorage.setItem('tierEmergencyPrice', tierEmergencyPrice);
  }, [tierStandardPrice, tierPriorityPrice, tierEmergencyPrice]);
  const [showPriceOverride, setShowPriceOverride] = useState(false);
  const [showTaskEditor, setShowTaskEditor] = useState(false);
  const [editableTasks, setEditableTasks] = useState<any[]>([]);

  // Effective base price (override or AI-calculated)
  const effectiveBasePrice = overridePrice
    ? parseFloat(overridePrice)
    : (analyzedJob?.basePricePounds || 0);

  // Customer info
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [postcode, setPostcode] = useState('');

  // Generated pricing (from backend response)
  const [generatedPricing, setGeneratedPricing] = useState<{
    essential: number;
    hassleFree: number;
    highStandard: number;
    valueMultiplier: number;
    recommendedTier: string;
  } | null>(null);
  const [generatedQuoteMode, setGeneratedQuoteMode] = useState<'hhh' | 'simple' | 'pick_and_mix' | 'consultation'>('hhh'); // Actual mode from response

  // Optional extras state (typed for validation)
  const [optionalExtras, setOptionalExtras] = useState<Array<{
    id: string;
    label: string;
    description: string;
    serviceType?: string;
    complexity?: string;
    estimatedHours?: number;
    materialsCost?: number; // Materials in pounds
    priceInPence: number;
    materialsCostInPence: number;
    laborCostInPence?: number;
    calloutFeeInPence?: number;
    isRecommended?: boolean;
  }>>([]);

  const [extraInputText, setExtraInputText] = useState('');
  const [visitTierMode, setVisitTierMode] = useState<'standard' | 'tiers'>('standard');
  const [clientType, setClientType] = useState<'residential' | 'commercial'>('residential');
  const [assessmentReason, setAssessmentReason] = useState("");
  const [isPolishingReason, setIsPolishingReason] = useState(false);
  const [isParsingExtra, setIsParsingExtra] = useState(false);
  const [whatsappSummary, setWhatsappSummary] = useState('');
  const [address, setAddress] = useState("");
  const [coordinates, setCoordinates] = useState<{ lat: number, lng: number } | null>(null);

  // AI Strategy Director State
  const [aiStrategy, setAiStrategy] = useState<{
    strategy: 'consultation' | 'hhh' | 'simple' | 'pick_and_mix';
    reasoning: string;
  } | null>(null);

  // WhatsApp message customization
  const [excuseToggles, setExcuseToggles] = useState({
    christmasRush: false,
    weekendDelay: false,
    highDemand: false,
    staffHoliday: false,
  });



  // Auto-calculated priming price range using behavioral economics
  // Low: round DOWN to nearest £10 (accessible entry point)
  // High: round UP to nearest £50 (anchoring effect)
  const primingPriceRange = useMemo(() => {
    if (!generatedPricing) return null;
    const lowPrice = generatedPricing.essential; // Already in pounds
    const highPrice = generatedPricing.highStandard; // Already in pounds

    // Round low DOWN to nearest £10
    const primingLow = Math.floor(lowPrice / 10) * 10;
    // Round high UP to nearest £50
    const primingHigh = Math.ceil(highPrice / 50) * 50;

    return { low: primingLow, high: primingHigh };
  }, [generatedPricing]);

  // Check authentication
  // Check authentication REMOVED
  // const { data: user, isLoading: isCheckingAuth, refetch: refetchUser } = useQuery({
  //   queryKey: ['/api/user'],
  // });

  // Fetch personalized quotes for Sent Quotes tab
  const { data: quotes = [], isLoading: isLoadingQuotes, error: quotesError, refetch: refetchQuotes } = useQuery<PersonalizedQuote[]>({
    queryKey: ['/api/personalized-quotes'],
    queryFn: async () => {
      const res = await fetch('/api/personalized-quotes');
      if (!res.ok) throw new Error('Failed to fetch quotes');
      return res.json();
    },
    enabled: activeTab === 'sent',
  });
  // Fetch Twilio settings for Settings tab
  interface ForwardingAgentInfo {
    id: string;
    name: string;
    phoneNumber: string;
    isActive: boolean;
    answeredCalls: number;
    totalCalls: number;
  }

  interface TwilioSettingsData {
    availableFromNumbers: string[];
    activeFromNumber: string | null;
    forwardingNumbers: string[];
    ringTimeout: number;
    simultaneousRingEnabled: boolean;
    envFromNumber?: string | null;
    envForwardNumber?: string | null;
    activeForwardingNumbers?: string[];
    activeAgents?: ForwardingAgentInfo[];
  }

  const { data: twilioSettings } = useQuery<TwilioSettingsData>({
    queryKey: ['/api/admin/twilio-settings'],
    queryFn: async () => {
      const res = await fetch('/api/admin/twilio-settings');
      if (!res.ok) throw new Error('Failed to fetch twilio settings');
      return res.json();
    },
    enabled: activeTab === 'settings',
  });

  // Normalize tasks from AI analysis into editable format
  const normalizeTask = (task: any, index: number): TaskItem => {
    const parseHours = (duration: string): number => {
      const match = duration?.match(/(\d+\.?\d*)\s*h/i);
      return match ? parseFloat(match[1]) : 1;
    };

    return {
      id: `task-${Date.now()}-${index}`,
      description: task.deliverable || task.description || 'Unnamed task',
      quantity: task.quantity || 1, // Extract quantity from AI response, default to 1
      hours: task.estimatedHours || parseHours(task.estimatedDuration) || 1,
      materialCost: 0, // Default to 0, user can edit
      complexity: task.complexity?.toLowerCase() || 'medium',
    };
  };

  // Populate editable tasks when AI analysis completes
  useEffect(() => {
    if (analyzedJob && analyzedJob.tasks.length > 0) {
      const normalized = analyzedJob.tasks.map((task, idx) => normalizeTask(task, idx));
      setEditableTasks(normalized);
      setShowTaskEditor(true);
    }
  }, [analyzedJob]);

  // Recalculate totals from editable tasks
  const recalculatedTotals = useMemo(() => {
    if (editableTasks.length === 0) {
      return {
        totalHours: 0,
        totalMaterialCost: 0,
        materialCostWithMarkup: 0,
        laborCost: 0,
        totalPrice: 0,
      };
    }

    // Complexity multipliers
    const complexityMultipliers = {
      low: 0.85,
      medium: 1.0,
      high: 1.2,
    };

    // Calculate total hours with complexity adjustments and quantity
    const totalHours = editableTasks.reduce((sum, task) => {
      const baseHours = task.hours || 0;
      const quantity = task.quantity || 1;
      const multiplier = complexityMultipliers[task.complexity as keyof typeof complexityMultipliers] || 1.0;
      return sum + (baseHours * quantity * multiplier);
    }, 0);

    // Calculate raw materials cost with quantity
    const totalMaterialCost = editableTasks.reduce((sum, task) => {
      const quantity = task.quantity || 1;
      return sum + ((task.materialCost || 0) * quantity);
    }, 0);

    // Apply 30% markup to materials
    const materialCostWithMarkup = totalMaterialCost * 1.3;

    // Calculate hourly rate from original analyzed job
    const baseHourlyRate = (analyzedJob && analyzedJob.totalEstimatedHours > 0)
      ? (analyzedJob.basePricePounds / analyzedJob.totalEstimatedHours)
      : 50; // Fallback to £50/hour

    const laborCost = totalHours * baseHourlyRate;
    const totalPrice = Math.round(laborCost + materialCostWithMarkup);

    return {
      totalHours: Math.round(totalHours * 10) / 10, // Round to 1 decimal
      totalMaterialCost: Math.round(totalMaterialCost),
      materialCostWithMarkup: Math.round(materialCostWithMarkup),
      laborCost: Math.round(laborCost),
      totalPrice,
    };
  }, [editableTasks, analyzedJob]);

  // Update effective base price calculation to use recalculated price
  const finalEffectivePrice = overridePrice
    ? parseFloat(overridePrice)
    : (recalculatedTotals.totalPrice > 0 ? recalculatedTotals.totalPrice : (analyzedJob?.basePricePounds || 0));

  // Task manipulation handlers
  const handleTaskUpdate = (id: string, field: keyof TaskItem, value: any) => {
    setEditableTasks(tasks =>
      tasks.map(task =>
        task.id === id ? { ...task, [field]: value } : task
      )
    );
  };

  const handleAddTask = () => {
    const newTask: TaskItem = {
      id: `task-${Date.now()}`,
      description: 'New task',
      quantity: 1,
      hours: 1,
      materialCost: 0,
      complexity: 'medium',
    };
    setEditableTasks(tasks => [...tasks, newTask]);
  };

  const handleRemoveTask = (id: string) => {
    setEditableTasks(tasks => tasks.filter(task => task.id !== id));
  };

  // Login handler
  // Login handler removed

  // AI job analysis function
  // Recalculate optional extra price when admin edits values
  const recalculateExtraPrice = async (idx: number, extra: any) => {
    try {
      const response = await fetch('/api/recalculate-optional-extra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: extra.serviceType || 'general',
          complexity: extra.complexity || 'moderate',
          estimatedHours: extra.estimatedHours || 0,
          materialsCost: extra.materialsCost || 0,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to recalculate price');
      }

      const pricing = await response.json();

      // Update the extra with validated inputs + new calculated pricing
      setOptionalExtras(prev => prev.map((item, i) =>
        i === idx ? {
          ...item,
          // Validated inputs (backend may have corrected invalid values)
          serviceType: pricing.serviceType,
          complexity: pricing.complexity,
          estimatedHours: pricing.estimatedHours,
          materialsCost: pricing.materialsCost,
          // Calculated pricing breakdown
          priceInPence: pricing.priceInPence,
          materialsCostInPence: pricing.materialsCostInPence,
          laborCostInPence: pricing.laborCostInPence,
          calloutFeeInPence: pricing.calloutFeeInPence,
        } : item
      ));
    } catch (error) {
      console.error('Error recalculating price:', error);
      // Silent fail - admin can still manually adjust if needed
    }
  };

  // Parse optional extra with AI
  const handleParseExtra = async () => {
    if (!extraInputText || extraInputText.trim().length < 3) {
      toast({
        title: 'Description Too Short',
        description: 'Please provide more details about the optional extra.',
        variant: 'destructive',
      });
      return;
    }

    setIsParsingExtra(true);

    try {
      const response = await fetch('/api/parse-optional-extra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extraDescription: extraInputText }),
      });

      if (!response.ok) {
        throw new Error('Failed to parse optional extra');
      }

      const parsed = await response.json();

      // Add to list of extras
      setOptionalExtras(prev => [...prev, parsed]);
      setExtraInputText('');

      toast({
        title: 'Extra Added',
        description: `"${parsed.label}" added successfully`,
      });
    } catch (error) {
      console.error('Error parsing extra:', error);
      toast({
        title: 'Parse Failed',
        description: 'Unable to parse the extra. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsParsingExtra(false);
    }
  };

  const runJobAnalysis = async () => {
    if (!jobDescription || jobDescription.trim().length < 10) {
      toast({
        title: 'Job Description Too Short',
        description: 'Please provide more details about the job for accurate analysis.',
        variant: 'destructive',
      });
      return;
    }

    setAnalysisStatus('loading');
    setAnalysisError(null);

    try {
      const response = await fetch('/api/analyze-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze job');
      }

      const data = await response.json();

      // Calculate base price from multiple fallback sources
      let basePricePounds = 0;

      if (data.estimatedRange?.low && data.estimatedRange?.high) {
        // Use midpoint of estimated range
        basePricePounds = (data.estimatedRange.low + data.estimatedRange.high) / 2;
      } else if (data.basePricePounds) {
        // Direct base price from API
        basePricePounds = data.basePricePounds;
      } else if (data.basePrice) {
        // Alternative field name
        basePricePounds = data.basePrice;
      } else if (data.totalEstimatedHours && data.totalEstimatedHours > 0) {
        // Fallback: estimate from hours (£50/hour baseline)
        basePricePounds = data.totalEstimatedHours * 50;
      }

      // Validate numeric result
      if (!basePricePounds || isNaN(basePricePounds) || basePricePounds <= 0) {
        throw new Error('Unable to calculate valid price from AI analysis. Please try again or enter price manually.');
      }

      const roundedPrice = Math.round(basePricePounds);

      setAnalyzedJob({
        tasks: data.tasks || [],
        totalEstimatedHours: data.totalEstimatedHours || 0,
        basePricePounds: roundedPrice,
        summary: data.summary,
      });
      setAnalysisStatus('success');
      setOverridePrice(''); // Reset override when new analysis succeeds
      setShowPriceOverride(false);

      // --- NEW: AI Strategy Director ---
      // Run in parallel to not block the main price display
      fetch('/api/quote-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription }),
      })
        .then(res => res.json())
        .then(strategyData => {
          if (strategyData.strategy) {
            setAiStrategy(strategyData);
          }
        })
        .catch(err => console.error("Strategy fetch failed", err));

      toast({
        title: 'Job Analyzed',
        description: `Estimated price: £${roundedPrice} (${data.tasks?.length || 0} tasks)`,
      });
    } catch (error) {
      console.error('Job analysis error:', error);
      setAnalysisStatus('error');
      setAnalysisError('Unable to analyze job. Please try again or enter price manually.');

      toast({
        title: 'Analysis Failed',
        description: 'Unable to analyze the job. You can retry or enter the price manually.',
        variant: 'destructive',
      });
    }
  };

  // Generate quote link
  const handleGenerateLink = async () => {
    // Validation
    if (!jobDescription.trim() || jobDescription.trim().length < 10) {
      toast({
        title: 'Invalid Description',
        description: 'Job description must be at least 10 characters.',
        variant: 'destructive',
      });
      return;
    }

    // Diagnostic Mode specific validation and setup
    let finalQuoteMode = quoteMode;
    let finalBasePrice = finalEffectivePrice;
    let finalAnalyzedJob = analyzedJob;
    let finalUrgency = urgencyReason;
    let finalOwnership = ownershipContext;
    let finalTimeframe = desiredTimeframe;

    if (generatorTab === 'diagnostic') {
      finalQuoteMode = 'consultation';
      // Default to £85 if not overridden
      const parsedOverride = parseFloat(overridePrice);
      finalBasePrice = !isNaN(parsedOverride) && parsedOverride > 0 ? parsedOverride : 85;
      finalAnalyzedJob = null; // No analysis for consultation

      // Set defaults for irrelevant fields to satisfy schema
      finalUrgency = 'med';
      finalOwnership = 'homeowner';
      finalTimeframe = 'flex';
    } else {
      // Estimator Mode Validation
      if (!finalBasePrice || finalBasePrice <= 0) {
        toast({
          title: 'Invalid Price',
          description: 'Please analyze the job first or enter a valid base price.',
          variant: 'destructive',
        });
        return;
      }
    }

    if (!customerName || !phone || !postcode) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required customer fields.',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);
    try {
      // Convert effective base price to pence
      const baseJobPricePence = Math.round(finalBasePrice * 100);

      const requestBody = {
        jobDescription,
        baseJobPrice: baseJobPricePence,
        urgencyReason: finalUrgency,
        ownershipContext: finalOwnership,
        desiredTimeframe: finalTimeframe,
        additionalNotes: additionalNotes || undefined,
        customerName,
        phone,
        email: customerEmail || undefined,
        postcode,
        address: address || undefined,
        coordinates: coordinates || undefined,
        quoteMode: finalQuoteMode,
        visitTierMode: finalQuoteMode === 'consultation' ? visitTierMode : 'standard', // Pass the tier preference
        clientType,
        assessmentReason: assessmentReason || undefined,
        tierStandardPrice: tierStandardPrice ? Math.round(parseFloat(tierStandardPrice) * 100) : undefined,
        tierPriorityPrice: tierPriorityPrice ? Math.round(parseFloat(tierPriorityPrice) * 100) : undefined,
        tierEmergencyPrice: tierEmergencyPrice ? Math.round(parseFloat(tierEmergencyPrice) * 100) : undefined,
        analyzedJobData: finalAnalyzedJob,
        materialsCostWithMarkupPence: recalculatedTotals.materialCostWithMarkup, // Materials cost with 30% markup applied
        optionalExtras: finalQuoteMode === 'pick_and_mix'
          ? editableTasks.map(task => {
            // Calculate individual task price
            const complexityMultipliers = { low: 0.85, medium: 1.0, high: 1.2 };
            const multiplier = complexityMultipliers[task.complexity as keyof typeof complexityMultipliers] || 1.0;

            // Base hourly rate calculation (same as useMemo)
            const baseHourlyRate = (analyzedJob && analyzedJob.totalEstimatedHours > 0)
              ? (analyzedJob.basePricePounds / analyzedJob.totalEstimatedHours)
              : 50;

            const taskLabor = (task.hours || 0) * (task.quantity || 1) * multiplier * baseHourlyRate;
            const taskMaterialsRaw = (task.materialCost || 0) * (task.quantity || 1);
            const taskMaterialsMarkup = taskMaterialsRaw * 1.3;
            const taskTotal = Math.round(taskLabor + taskMaterialsMarkup);

            return {
              label: task.description,
              description: `${task.quantity > 1 ? `${task.quantity}x ` : ''}${task.hours}h est. • ${task.complexity} complexity`,
              priceInPence: taskTotal * 100, // Convert to pence
              materialsCostInPence: Math.round(taskMaterialsMarkup * 100),
              estimatedHours: task.hours,
              isRecommended: true // Default to checked/recommended? Maybe true for anchoring.
            };
          })
          : (optionalExtras.length > 0 ? optionalExtras : undefined), // Optional upsells for customer selection
      };

      const fetchResponse = await fetch('/api/personalized-quotes/value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!fetchResponse.ok) {
        const errorData = await fetchResponse.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || 'Failed to create quote');
      }

      const response: any = await fetchResponse.json();

      // Save generated pricing for display (handle both modes)
      setGeneratedQuoteMode(response.quoteMode || 'hhh'); // Store actual mode from response

      if (response.quoteMode === 'hhh' && response.essential) {
        // Three-tier packages mode
        setGeneratedPricing({
          essential: response.essential.price / 100,
          hassleFree: response.hassleFree.price / 100,
          highStandard: response.highStandard.price / 100,
          valueMultiplier: response.valueMultiplier,
          recommendedTier: response.recommendedTier,
        });
      } else if (response.basePrice !== undefined) {
        // Simple, Pick & Mix, or Consultation mode
        setGeneratedPricing({
          essential: response.basePrice / 100, // Use basePrice for display
          hassleFree: 0,
          highStandard: 0,
          valueMultiplier: response.valueMultiplier || 1.0,
          recommendedTier: 'essential',
        });
      } else if (response.quoteMode === 'pick_and_mix') {
        // Pick & Mix mode might have 0 base price but we want to show something?
        // Actually the backend might set basePrice if provided.
        // If basePrice is null/0, we can sum the optionalExtras for a "Total Potential Value" or just show 0.
        // Let's rely on standard response parsing.
        setGeneratedPricing({
          essential: (response.basePrice || 0) / 100,
          hassleFree: 0,
          highStandard: 0,
          valueMultiplier: response.valueMultiplier || 1.0,
          recommendedTier: 'essential',
        });
      } else {
        throw new Error('Invalid response format: missing pricing data');
      }

      const baseUrl = window.location.origin;
      // Construct URL based on mode (Diagnostic vs Standard)
      const isConsultation = response.quoteMode === 'consultation';
      const url = isConsultation
        ? `${baseUrl}/visit-link/${response.shortSlug}`
        : `${baseUrl}/quote-link/${response.shortSlug}`;

      setGeneratedUrl(url);

      toast({
        title: 'Link Generated!',
        description: isConsultation ? 'Diagnostic visit link created.' : 'Quote link created successfully.',
      });
    } catch (error) {
      console.error('Error generating quote link:', error);
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Failed to generate quote link. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      toast({
        title: 'Copied!',
        description: 'Quote link copied to clipboard.',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  };

  const handlePolishReason = async () => {
    if (!assessmentReason) return;
    if (!customerName || !postcode) {
      toast({ title: "Missing Info", description: "Please enter Customer Name and Postcode first.", variant: "destructive" });
      return;
    }
    setIsPolishingReason(true);
    try {
      const res = await fetch('/api/generate-personalized-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: assessmentReason, customerName, postcode, address: address || undefined })
      });
      const data = await res.json();
      if (data.note) {
        setAssessmentReason(data.note);
        setWhatsappSummary(data.summary || '');
        toast({ title: "Reason Personalised", description: "AI has created an expert note and summary." });
      }
    } catch (e) {
      toast({ title: "Error", description: "Failed to generate note", variant: "destructive" });
    } finally {
      setIsPolishingReason(false);
    }
  };

  // Generate WhatsApp message based on inputs
  const generateWhatsAppMessage = () => {
    let message = `Thanks ${customerName}!\n\n`;

    // 1. Excuses (Universal - applied to all modes)
    if (excuseToggles.christmasRush) {
      message += `Sorry for the delay — everyone's trying to get their jobs done before Christmas! 🎄\n\n`;
    } else if (excuseToggles.weekendDelay) {
      message += `Sorry for the delay over the weekend — we're back on it now!\n\n`;
    } else if (excuseToggles.highDemand) {
      message += `Apologies for the wait — we've been busier than usual this week!\n\n`;
    } else if (excuseToggles.staffHoliday) {
      message += `Sorry for the delay — one of our team is on holiday so we're catching up!\n\n`;
    }

    // --- DIAGNOSTIC MODE: Anti-Cowboy / Deposit Script ---
    if (visitTierMode === 'tiers' || quoteMode === 'consultation') {
      const reasonAction = whatsappSummary ? ` to ${whatsappSummary}` : '';

      message += `I've had a look at the job${reasonAction}. To give you a *Fixed Price* we can legally stand by, I need a Top Rated Handyman to assess the site first.\n\n`;
      message += `I've put together a personalised expert plan for you here (includes my full assessment):\n${generatedUrl}\n\n`;
      message += `To secure the slot, we ask for a *Refundable Diagnostic Deposit*.\n`;
      message += `🟢 *100% Refundable*: Credited back to your final quote.\n`;
      message += `🛡️ *Expert Assessment*: You get a vetted pro, not a "cowboy" or salesperson.`;
      return message;
    }

    // --- STANDARD MODE: Prime Pricing & Pay-in-3 ---

    // Add priming price range (auto-calculated from HHH pricing)
    if (primingPriceRange) {
      message += `For this type of job, the price normally falls in the £${primingPriceRange.low}–£${primingPriceRange.high} range, depending on the specifics.\n\n`;
    }

    // Pay-in-3 with WhatsApp bold formatting (*bold*, not **bold**)
    message += `*We also offer a Pay-in-3 option if you prefer to split the cost.*\n\n`;

    // Quote link intro with 15-minute expiry
    message += `I'll send the quote link now — it's held for 15 minutes so you can pick whichever option suits you best 😊\n\n`;

    // Quote link
    message += `Here's your quote:\n\n${generatedUrl}`;

    return message;
  };



  const handleSendWhatsApp = () => {
    if (!phone || !generatedUrl) return;

    let phoneNumber = phone.replace(/\s/g, '');
    if (phoneNumber.startsWith('0')) {
      phoneNumber = '44' + phoneNumber.substring(1);
    }

    // Use refined message if available, otherwise raw
    const message = generateWhatsAppMessage();

    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');


    toast({
      title: 'Opening WhatsApp',
      description: 'WhatsApp will open with your message ready to send.',
    });
  };

  const handleReset = () => {
    setJobDescription('');
    setQuoteMode('hhh'); // Reset to default mode
    setUrgencyReason('med');
    setOwnershipContext('homeowner');
    setDesiredTimeframe('flex');
    setAdditionalNotes('');
    setAnalyzedJob(null);
    setAnalysisStatus('idle');
    setAnalysisError(null);
    setOverridePrice('');
    setShowPriceOverride(false);
    setCustomerName('');
    setPhone('');
    setCustomerEmail('');
    setPostcode('');
    setGeneratedUrl('');
    setGeneratedPricing(null);
    setGeneratedQuoteMode('hhh'); // Reset to default mode
    // Reset WhatsApp message customization
    setExcuseToggles({
      christmasRush: false,
      weekendDelay: false,
      highDemand: false,
      staffHoliday: false,
    });
  };

  const formatPrice = (priceInPounds: number) => {
    return `£${priceInPounds.toFixed(2)}`;
  };

  // Filter quotes based on search
  const allFilteredQuotes = quotes?.filter(quote =>
    quote.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    quote.phone.includes(searchQuery) ||
    quote.shortSlug.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const visitQuotes = allFilteredQuotes.filter(q => q.quoteMode === 'consultation');
  const generatedQuotes = allFilteredQuotes.filter(q => q.quoteMode !== 'consultation');

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden transition-colors duration-300">
      <div className="p-4 lg:p-6 border-b border-border text-center bg-muted/30">
        <h1 className="text-2xl lg:text-4xl font-bold text-secondary mb-1 lg:mb-2 italic tracking-tighter uppercase">Quote Master</h1>
        <p className="text-[10px] lg:text-sm text-muted-foreground uppercase font-black tracking-widest opacity-50">Value-Based Pricing Engine</p>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto">

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'generate' | 'sent' | 'settings')} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4 lg:mb-6">
              <TabsTrigger value="generate" data-testid="tab-generate" className="text-[10px] lg:text-sm">Create</TabsTrigger>
              <TabsTrigger value="sent" data-testid="tab-sent" className="text-[10px] lg:text-sm">History</TabsTrigger>
              <TabsTrigger value="settings" data-testid="tab-settings" className="text-[10px] lg:text-sm">Config</TabsTrigger>
            </TabsList>

            <TabsContent value="generate" className="space-y-6">

              {/* Tool Mode Switcher */}
              <div className="grid grid-cols-2 gap-2 bg-muted/50 p-1 rounded-lg mb-4">
                <button
                  onClick={() => {
                    setGeneratorTab('estimator');
                    setQuoteMode('hhh'); // Reset to standard
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-bold transition-all ${generatorTab === 'estimator'
                    ? 'bg-white shadow-sm text-primary'
                    : 'text-muted-foreground hover:bg-white/50'
                    }`}
                >
                  <DollarSign className="w-4 h-4" />
                  Quote Estimator
                </button>
                <button
                  onClick={() => {
                    setGeneratorTab('diagnostic');
                    setQuoteMode('consultation'); // Force consultation
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-bold transition-all relative ${generatorTab === 'diagnostic'
                    ? 'bg-blue-600 shadow-sm text-white'
                    : 'text-muted-foreground hover:bg-white/50'
                    } ${aiStrategy?.strategy === 'consultation' ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}
                >
                  {aiStrategy?.strategy === 'consultation' && generatorTab !== 'diagnostic' && (
                    <div className="absolute -top-2 -right-2 z-10">
                      <span className="bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 font-bold animate-pulse">
                        <Sparkles className="w-2.5 h-2.5" />
                        AI Recommends
                      </span>
                    </div>
                  )}
                  <Wrench className="w-4 h-4" />
                  Book Site Visit
                </button>
              </div>

              {/* Value Pricing Card (Estimator Only) */}
              {generatorTab === 'estimator' && (
                <Card className="jobber-card shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg lg:text-xl text-secondary">
                      <ArrowRight className="h-5 w-5 text-primary" />
                      Job & Pricing
                    </CardTitle>
                    <p className="text-[10px] lg:text-sm text-muted-foreground">
                      Tier pricing logic
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Job Description */}
                    <div className="space-y-2">
                      <Label htmlFor="jobDescription" className="text-base font-semibold text-foreground">What needs doing? *</Label>
                      <textarea
                        id="jobDescription"
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        placeholder="e.g., Mount 65-inch TV on living room wall"
                        className="w-full min-h-[80px] px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        data-testid="input-job-description"
                      />
                    </div>

                    {/* Quote Mode Toggle */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold">Quote Type</Label>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                        <Button
                          type="button"
                          variant={quoteMode === 'hhh' ? 'default' : 'outline'}
                          onClick={() => setQuoteMode('hhh')}
                          className={`h-auto py-2 flex flex-col gap-1 relative ${aiStrategy?.strategy === 'hhh' ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}
                        >
                          {aiStrategy?.strategy === 'hhh' && (
                            <div className="absolute -top-3 -right-2 z-10">
                              <span className="bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 font-bold animate-pulse">
                                <Sparkles className="w-2.5 h-2.5" />
                                AI Pick
                              </span>
                            </div>
                          )}
                          <span className="font-bold">Packages</span>
                          <span className="text-[10px] opacity-70">Good/Better/Best</span>
                        </Button>
                        <Button
                          type="button"
                          variant={quoteMode === 'simple' ? 'default' : 'outline'}
                          onClick={() => setQuoteMode('simple')}
                          className={`h-auto py-2 flex flex-col gap-1 relative ${aiStrategy?.strategy === 'simple' ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}
                        >
                          {aiStrategy?.strategy === 'simple' && (
                            <div className="absolute -top-3 -right-2 z-10">
                              <span className="bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 font-bold animate-pulse">
                                <Sparkles className="w-2.5 h-2.5" />
                                AI Pick
                              </span>
                            </div>
                          )}
                          <span className="font-bold">Simple</span>
                          <span className="text-[10px] opacity-70">Single Price</span>
                        </Button>
                        <Button
                          type="button"
                          variant={quoteMode === 'pick_and_mix' ? 'default' : 'outline'}
                          onClick={() => setQuoteMode('pick_and_mix')}
                          className={`h-auto py-2 flex flex-col gap-1 relative ${aiStrategy?.strategy === 'pick_and_mix' ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}
                        >
                          {aiStrategy?.strategy === 'pick_and_mix' && (
                            <div className="absolute -top-3 -right-2 z-10">
                              <span className="bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1 font-bold animate-pulse">
                                <Sparkles className="w-2.5 h-2.5" />
                                AI Pick
                              </span>
                            </div>
                          )}
                          <span className="font-bold">Pick & Mix</span>
                          <span className="text-[10px] opacity-70">Itemized List</span>
                        </Button>
                      </div>
                      {aiStrategy && (
                        <div className="mt-2 p-2 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/50 rounded text-[11px] text-muted-foreground flex items-start gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                          <span><strong>AI Insight:</strong> {aiStrategy.reasoning}</span>
                        </div>
                      )}
                    </div>


                    {/* AI Job Analysis & Pricing */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-base font-semibold text-foreground">AI Job Analysis *</Label>
                          <p className="text-sm text-muted-foreground">Analyze the job to calculate base pricing</p>
                        </div>
                        <Button
                          type="button"
                          onClick={runJobAnalysis}
                          disabled={analysisStatus === 'loading' || !jobDescription || jobDescription.length < 10}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground"
                          data-testid="button-analyze-job"
                        >
                          {analysisStatus === 'loading' ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <Search className="h-4 w-4 mr-2" />
                              Analyze Job
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Analysis Results */}
                      {analysisStatus === 'success' && analyzedJob && (
                        <Card className="bg-primary/10 border-primary/20">
                          <CardContent className="pt-4 space-y-3">
                            {/* Calculated Price Display */}
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-semibold text-foreground">Calculated Base Price</p>
                                <p className="text-2xl font-bold text-primary">£{analyzedJob.basePricePounds}</p>
                                <p className="text-xs text-muted-foreground">{analyzedJob.totalEstimatedHours}h estimated • {analyzedJob.tasks.length} tasks</p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowPriceOverride(!showPriceOverride)}
                                data-testid="button-override-price"
                              >
                                {showPriceOverride ? 'Cancel Override' : 'Override Price'}
                              </Button>
                            </div>

                            {/* Price Override Input */}
                            {showPriceOverride && (
                              <div className="space-y-2 pt-2 border-t border-border">
                                <Label htmlFor="overridePrice" className="text-sm text-orange-600 font-semibold">
                                  ⚠️ Manual Price Override
                                </Label>
                                <Input
                                  id="overridePrice"
                                  type="number"
                                  value={overridePrice}
                                  onChange={(e) => setOverridePrice(e.target.value)}
                                  placeholder={String(analyzedJob.basePricePounds)}
                                  min="1"
                                  step="1"
                                  className="border-orange-300 bg-background"
                                  data-testid="input-override-price"
                                />
                                <p className="text-xs text-orange-600">Use with caution - overrides AI calculation</p>
                              </div>
                            )}

                            {/* Editable Task Breakdown */}
                            {showTaskEditor && editableTasks.length > 0 && (
                              <div className="mt-4 pt-4 border-t border-border">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    <Edit className="h-4 w-4 text-foreground" />
                                    <Label className="text-sm font-semibold text-foreground">Edit Task Breakdown</Label>
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={handleAddTask}
                                    className="text-primary border-primary/30 hover:bg-primary/10"
                                    data-testid="button-add-task"
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Add Task
                                  </Button>
                                </div>

                                {/* Task List */}
                                {/* Task List */}
                                <div className="space-y-3 max-h-96 overflow-y-auto">
                                  {editableTasks.map((task, idx) => (
                                    <Card key={task.id} className="bg-muted/30 border-border" data-testid={`editable-task-${idx}`}>
                                      <CardContent className="p-3 space-y-2">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex-1 space-y-2">
                                            {/* Description */}
                                            <div>
                                              <Label className="text-xs text-muted-foreground font-medium">Task Description</Label>
                                              <Input
                                                value={task.description}
                                                onChange={(e) => handleTaskUpdate(task.id, 'description', e.target.value)}
                                                className="text-sm bg-background border-input"
                                                data-testid={`input-task-description-${idx}`}
                                              />
                                            </div>

                                            {/* Quantity, Hours, Material Cost, Complexity Grid */}
                                            <div className="grid grid-cols-4 gap-2">
                                              {/* Quantity */}
                                              <div>
                                                <Label className="text-xs text-muted-foreground font-medium">Qty</Label>
                                                <Input
                                                  type="number"
                                                  step="1"
                                                  min="1"
                                                  value={task.quantity}
                                                  onChange={(e) => handleTaskUpdate(task.id, 'quantity', parseFloat(e.target.value) || 1)}
                                                  className="text-sm bg-background border-input"
                                                  data-testid={`input-task-quantity-${idx}`}
                                                />
                                              </div>

                                              {/* Hours */}
                                              <div>
                                                <Label className="text-xs text-muted-foreground font-medium">Hours</Label>
                                                <Input
                                                  type="number"
                                                  step="0.5"
                                                  min="0.5"
                                                  value={task.hours}
                                                  onChange={(e) => handleTaskUpdate(task.id, 'hours', parseFloat(e.target.value) || 0)}
                                                  className="text-sm bg-background border-input"
                                                  data-testid={`input-task-hours-${idx}`}
                                                />
                                              </div>

                                              {/* Material Cost */}
                                              <div>
                                                <Label className="text-xs text-muted-foreground font-medium">Materials £</Label>
                                                <Input
                                                  type="number"
                                                  step="1"
                                                  min="0"
                                                  value={task.materialCost}
                                                  onChange={(e) => handleTaskUpdate(task.id, 'materialCost', parseFloat(e.target.value) || 0)}
                                                  className="text-sm bg-background border-input"
                                                  data-testid={`input-task-materials-${idx}`}
                                                />
                                              </div>

                                              {/* Complexity */}
                                              <div>
                                                <Label className="text-xs text-muted-foreground font-medium">Complexity</Label>
                                                <Select
                                                  value={task.complexity}
                                                  onValueChange={(v: any) => handleTaskUpdate(task.id, 'complexity', v)}
                                                >
                                                  <SelectTrigger className="text-sm bg-background border-input" data-testid={`select-task-complexity-${idx}`}>
                                                    <SelectValue />
                                                  </SelectTrigger>
                                                  <SelectContent className="bg-background border-border">
                                                    <SelectItem value="low">Low</SelectItem>
                                                    <SelectItem value="medium">Medium</SelectItem>
                                                    <SelectItem value="high">High</SelectItem>
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                            </div>
                                          </div>

                                          {/* Delete Button */}
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleRemoveTask(task.id)}
                                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                            disabled={editableTasks.length === 1}
                                            data-testid={`button-remove-task-${idx}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                                </div>

                                {/* Recalculated Totals */}
                                <Card className="bg-secondary/10 border-border mt-3">
                                  <CardContent className="p-3">
                                    <div className="space-y-1.5 text-sm">
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Total Hours (with complexity):</span>
                                        <span className="font-semibold">{recalculatedTotals.totalHours.toFixed(1)}h</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Labor Cost:</span>
                                        <span className="font-semibold">£{recalculatedTotals.laborCost}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Materials Cost (raw):</span>
                                        <span className="font-semibold">£{recalculatedTotals.totalMaterialCost}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Materials + 30% Markup:</span>
                                        <span className="font-semibold text-primary">£{recalculatedTotals.materialCostWithMarkup}</span>
                                      </div>
                                      <div className="flex justify-between pt-2 border-t border-border">
                                        <span className="text-foreground font-bold">Recalculated Total:</span>
                                        <span className="text-primary font-bold text-lg">£{recalculatedTotals.totalPrice}</span>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )}

                      {/* Analysis Error */}
                      {analysisStatus === 'error' && (
                        <Card className="bg-red-900/20 border-red-800">
                          <CardContent className="pt-4">
                            <p className="text-sm text-red-300">{analysisError}</p>
                            <div className="flex gap-2 mt-3">
                              <Button
                                type="button"
                                size="sm"
                                onClick={runJobAnalysis}
                                variant="outline"
                                className="text-red-300 border-red-800 hover:bg-red-900/40"
                                data-testid="button-retry-analysis"
                              >
                                Retry Analysis
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => setShowPriceOverride(true)}
                                variant="outline"
                                className="text-red-300 border-red-800 hover:bg-red-900/40"
                                data-testid="button-manual-entry"
                              >
                                Enter Price Manually
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Loading State */}
                      {analysisStatus === 'loading' && (
                        <Card className="bg-blue-50 border-blue-200">
                          <CardContent className="pt-4">
                            <div className="flex items-center gap-3">
                              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                              <p className="text-sm text-blue-700">Analyzing job description and calculating pricing...</p>
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>

                    {/* Quote Mode Toggle */}
                    <Card className="border-border bg-muted/20">
                      <CardContent className="pt-4">
                        <div className="space-y-2">
                          <Label htmlFor="quoteMode" className="text-foreground font-semibold flex items-center gap-2">
                            <Shield className="h-4 w-4 text-primary" />
                            Quote Presentation Mode
                          </Label>
                          <Select value={quoteMode} onValueChange={(v: 'hhh' | 'simple') => setQuoteMode(v)}>
                            <SelectTrigger id="quoteMode" data-testid="select-quote-mode" className="bg-background text-foreground border-input">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-background border-border">
                              <SelectItem value="hhh" className="text-foreground focus:bg-muted focus:text-foreground">
                                <div className="flex flex-col">
                                  <span className="font-medium">Three-Tier Packages (Essential/Enhanced/Elite)</span>
                                  <span className="text-xs text-muted-foreground">Best for jobs with multiple value levels</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="simple" className="text-foreground focus:bg-muted focus:text-foreground">
                                <div className="flex flex-col">
                                  <span className="font-medium">Simple Quote with Optional Extras</span>
                                  <span className="text-xs text-muted-foreground">Best for straightforward jobs with add-ons</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="pick_and_mix" className="text-foreground focus:bg-muted focus:text-foreground">
                                <div className="flex flex-col">
                                  <span className="font-medium">Pick & Mix (A La Carte)</span>
                                  <span className="text-xs text-muted-foreground">Customer builds their own quote from line items</span>
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {quoteMode === 'hhh'
                              ? 'Customer will see three pricing tiers with different value levels and comparison grid.'
                              : quoteMode === 'simple'
                                ? 'Customer will see a single base price with optional extras they can add at checkout.'
                                : 'Customer will see a list of individual items and can choose which ones to include.'
                            }
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 3 Value Questions */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Urgency Reason */}
                      <div className="space-y-2">
                        <Label htmlFor="urgencyReason" className="text-foreground font-medium">How urgent is it? *</Label>
                        <Select value={urgencyReason} onValueChange={(v: any) => setUrgencyReason(v)}>
                          <SelectTrigger id="urgencyReason" data-testid="select-urgency-reason" className="bg-background text-foreground border-input">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-background border-border">
                            <SelectItem value="low">Low (can wait)</SelectItem>
                            <SelectItem value="med">Medium (soon)</SelectItem>
                            <SelectItem value="high">High (urgent)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Ownership Context */}
                      <div className="space-y-2">
                        <Label htmlFor="ownershipContext" className="text-foreground font-medium">Property situation? *</Label>
                        <Select value={ownershipContext} onValueChange={(v: any) => setOwnershipContext(v)}>
                          <SelectTrigger id="ownershipContext" data-testid="select-ownership-context" className="bg-background text-foreground border-input">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-background border-border">
                            <SelectItem value="tenant">Tenant</SelectItem>
                            <SelectItem value="homeowner">Homeowner</SelectItem>
                            <SelectItem value="landlord">Landlord</SelectItem>
                            <SelectItem value="airbnb">Airbnb Host</SelectItem>
                            <SelectItem value="selling">Preparing to Sell</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Desired Timeframe */}
                      <div className="space-y-2">
                        <Label htmlFor="desiredTimeframe" className="text-foreground font-medium">When needed by? *</Label>
                        <Select value={desiredTimeframe} onValueChange={(v: any) => setDesiredTimeframe(v)}>
                          <SelectTrigger id="desiredTimeframe" data-testid="select-desired-timeframe" className="bg-background text-foreground border-input">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-background border-border">
                            <SelectItem value="flex">Flexible</SelectItem>
                            <SelectItem value="week">Within a week</SelectItem>
                            <SelectItem value="asap">ASAP / Next day</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Additional Notes */}
                    <div className="space-y-2">
                      <Label htmlFor="additionalNotes" className="text-foreground font-medium">Additional Notes (Optional)</Label>
                      <textarea
                        id="additionalNotes"
                        value={additionalNotes}
                        onChange={(e) => setAdditionalNotes(e.target.value)}
                        placeholder="Any special requirements or context..."
                        className="w-full min-h-[60px] px-3 py-2 rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        data-testid="input-additional-notes"
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 1. CUSTOMER INFORMATION - MOVED TO TOP */}
              <Card className="jobber-card shadow-sm border-l-4 border-l-blue-500">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-secondary">
                    <div className="bg-blue-100 p-1.5 rounded-full">
                      <LinkIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    1. Customer Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="customerName">Customer Name *</Label>
                      <Input id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="John Smith" className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address">Full Address (Derby/Notts) *</Label>
                      <Autocomplete
                        apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                        onPlaceSelected={(place) => {
                          if (place.formatted_address) {
                            setAddress(place.formatted_address);
                            // Extract postcode
                            const postcodeComp = place.address_components?.find((c: any) => c.types.includes('postal_code'));
                            if (postcodeComp) setPostcode(postcodeComp.long_name);

                            // Extract coordinates
                            if (place.geometry?.location) {
                              setCoordinates({
                                lat: place.geometry.location.lat(),
                                lng: place.geometry.location.lng()
                              });
                            }
                          }
                        }}
                        onChange={(e: any) => setAddress(e.target.value)}
                        options={{
                          componentRestrictions: { country: "gb" },
                          types: ["address"],
                        }}
                        defaultValue={address || postcode}
                        placeholder="Search Google Maps..."
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      {/* Hidden Postcode fallback just in case or for manual override if needed? 
                           For now, we trust the autocomplete or manual typing in the same box if it allows free text.
                           React-google-autocomplete allows typing, but onPlaceSelected only fires on selection.
                           We should also handle 'onChange' to allow manual entry if not selected.
                        */}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number *</Label>
                      <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07123456789" className="bg-background" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email (Optional)</Label>
                      <Input id="email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="john@example.com" className="bg-background" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* DIAGNOSTIC MODE: Simple Card */}
              {generatorTab === 'diagnostic' && (
                <Card className="jobber-card shadow-sm border-2 border-blue-500/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg lg:text-xl text-secondary">
                      <Wrench className="h-5 w-5 text-blue-500" />
                      Book Diagnostic Site Visit
                    </CardTitle>
                    <p className="text-[10px] lg:text-sm text-muted-foreground">
                      Create a link for a paid diagnostic assessment.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Diagnostic Reason - Removed in favor of Consolidated Input below */}

                    {/* Consultation Fee */}
                    <div className="space-y-2">
                      <Label htmlFor="consultationFee" className="text-base font-semibold text-foreground">Diagnostic Fee (£)</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">£</span>
                        <Input
                          id="consultationFee"
                          type="number"
                          value={overridePrice || '85'}
                          onChange={(e) => setOverridePrice(e.target.value)}
                          className="pl-7 font-mono font-bold text-lg bg-blue-50 dark:bg-blue-900/20"
                          placeholder="85"
                          data-testid="input-consultation-fee"
                        />
                      </div>

                      {/* Custom Tier Pricing Inputs */}
                      <div className="bg-muted/30 p-4 rounded-lg border border-border space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-foreground">Custom Tier Pricing</label>
                          <span className="text-[10px] text-emerald-600 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 opacity-80">
                            <Check className="w-3 h-3" /> Auto-saved
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Standard</label>
                            <div className="relative">
                              <span className="absolute left-2 top-2 text-muted-foreground text-xs">£</span>
                              <Input
                                type="number"
                                value={tierStandardPrice}
                                onChange={(e) => setTierStandardPrice(e.target.value)}
                                className="pl-5 text-center text-xs bg-background border-input"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-amber-600 font-medium">Priority</label>
                            <div className="relative">
                              <span className="absolute left-2 top-2 text-muted-foreground text-xs">£</span>
                              <Input
                                type="number"
                                value={tierPriorityPrice}
                                onChange={(e) => setTierPriorityPrice(e.target.value)}
                                className="pl-5 text-center text-xs bg-background border-input"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-red-600 font-medium">Emergency</label>
                            <div className="relative">
                              <span className="absolute left-2 top-2 text-muted-foreground text-xs">£</span>
                              <Input
                                type="number"
                                value={tierEmergencyPrice}
                                onChange={(e) => setTierEmergencyPrice(e.target.value)}
                                className="pl-5 text-center text-xs bg-background border-input"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground">Standard fee is £85. Fully deductible from main job if accepted.</p>
                    </div>

                    <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded-md text-sm border border-blue-200 dark:border-blue-800">
                      <strong>Note:</strong> This will generate a "Book Consultation" link where the customer pays the fee upfront to secure the slot.
                    </div>

                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border">
                      <div className="space-y-0.5">
                        <Label className="text-base font-medium">Enable Priority Tiers</Label>
                        <p className="text-xs text-muted-foreground">Allows customers to choose Standard, Priority, or Emergency visits.</p>
                      </div>
                      <Switch
                        checked={visitTierMode === 'tiers'}
                        onCheckedChange={(checked) => setVisitTierMode(checked ? 'tiers' : 'standard')}
                      />
                    </div>

                    {/* Client Type Toggle */}
                    <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border">
                      <div className="space-y-0.5">
                        <Label className="text-base font-medium">Commercial Job</Label>
                        <p className="text-xs text-muted-foreground">Applies Commercial pricing rates (£85/£150/£250).</p>
                      </div>
                      <Switch
                        checked={clientType === 'commercial'}
                        onCheckedChange={(checked) => setClientType(checked ? 'commercial' : 'residential')}
                      />
                    </div>

                    {/* Consolidated Reason for Visit Input */}
                    <div className="space-y-2 pt-2 border-t border-border mt-4">
                      <Label className="text-base font-medium">Reason for Visit</Label>
                      <div className="flex gap-2">
                        <Input
                          value={assessmentReason}
                          onChange={(e) => {
                            setAssessmentReason(e.target.value);
                            setJobDescription(e.target.value); // Sync to satisfy schema
                          }}
                          placeholder="e.g. walls look uneven, need to check for damp..."
                          className="bg-background"
                          onBlur={handlePolishReason}
                        />
                        <Button
                          onClick={handlePolishReason}
                          disabled={!assessmentReason || isPolishingReason}
                          variant="outline"
                          className="shrink-0"
                        >
                          {isPolishingReason ? <Loader2 className="w-4 h-4 animate-spin" /> : "✨ AI Polish"}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        AI Polish will format this for the customer message.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}



              {/* Optional Extras Card (Estimator Only) */}
              {generatorTab === 'estimator' && (
                <Card className="jobber-card shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-secondary">
                      <Plus className="h-5 w-5 text-primary" />
                      Optional Extras (Upsells)
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      Add optional extras that customers can select at checkout. These appear after they click "Reserve".
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Input for adding new extra */}
                    <div className="space-y-2">
                      <Label className="text-foreground font-medium">
                        Describe the optional extra
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          value={extraInputText}
                          onChange={(e) => setExtraInputText(e.target.value)}
                          placeholder="E.g., Paint skirting boards white, 12-month warranty, Same-day service"
                          className="flex-1 bg-background text-foreground border-input"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter' && !isParsingExtra) {
                              handleParseExtra();
                            }
                          }}
                          data-testid="input-extra-description"
                        />
                        <Button
                          onClick={handleParseExtra}
                          disabled={isParsingExtra || !extraInputText.trim()}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground"
                          data-testid="button-parse-extra"
                        >
                          {isParsingExtra ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4" />
                            </>
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500">
                        AI will analyze your text and extract pricing, materials cost, and complexity.
                      </p>
                    </div>

                    {/* List of added extras */}
                    {optionalExtras.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-foreground font-medium">
                          Added Extras ({optionalExtras.length})
                        </Label>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {optionalExtras.map((extra, idx) => (
                            <Card key={extra.id} className="bg-primary/5 border-primary/20" data-testid={`extra-item-${idx}`}>
                              <CardContent className="p-4">
                                <div className="space-y-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <div className="font-semibold text-gray-900 dark:text-white">
                                        {extra.label}
                                      </div>
                                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                        {extra.description}
                                      </p>
                                      <div className="text-sm text-gray-700 dark:text-gray-300 font-medium mt-2">
                                        Price: £{(extra.priceInPence / 100).toFixed(2)}
                                      </div>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setOptionalExtras(prev => prev.filter((_, i) => i !== idx))}
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                      data-testid={`button-remove-extra-${idx}`}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>

                                  {/* Editable fields for service type, materials, hours, complexity */}
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-purple-200">
                                    <div>
                                      <Label htmlFor={`service-type-${idx}`} className="text-xs text-gray-600 dark:text-gray-400">
                                        Service Type
                                      </Label>
                                      <Select
                                        value={extra.serviceType || 'general'}
                                        onValueChange={(value) => {
                                          const updatedExtra = { ...extra, serviceType: value };
                                          setOptionalExtras(prev => prev.map((item, i) =>
                                            i === idx ? updatedExtra : item
                                          ));
                                          // Recalculate price with new service type
                                          recalculateExtraPrice(idx, updatedExtra);
                                        }}
                                      >
                                        <SelectTrigger className="h-8 bg-slate-800 text-white border-slate-600" data-testid={`select-service-type-${idx}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-slate-800 border-slate-600">
                                          <SelectItem value="general">General</SelectItem>
                                          <SelectItem value="carpentry">Carpentry</SelectItem>
                                          <SelectItem value="painting">Painting</SelectItem>
                                          <SelectItem value="plumbing">Plumbing</SelectItem>
                                          <SelectItem value="electrical">Electrical</SelectItem>
                                          <SelectItem value="mounting">Mounting</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    <div>
                                      <Label htmlFor={`complexity-${idx}`} className="text-xs text-gray-600 dark:text-gray-400">
                                        Complexity
                                      </Label>
                                      <Select
                                        value={extra.complexity || 'moderate'}
                                        onValueChange={(value) => {
                                          const updatedExtra = { ...extra, complexity: value };
                                          setOptionalExtras(prev => prev.map((item, i) =>
                                            i === idx ? updatedExtra : item
                                          ));
                                          // Recalculate price with new complexity
                                          recalculateExtraPrice(idx, updatedExtra);
                                        }}
                                      >
                                        <SelectTrigger className="h-8 bg-slate-800 text-white border-slate-600" data-testid={`select-complexity-${idx}`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-slate-800 border-slate-600">
                                          <SelectItem value="simple">Simple</SelectItem>
                                          <SelectItem value="moderate">Moderate</SelectItem>
                                          <SelectItem value="complex">Complex</SelectItem>
                                          <SelectItem value="very_complex">Very Complex</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    <div>
                                      <Label htmlFor={`hours-${idx}`} className="text-xs text-gray-600 dark:text-gray-400">
                                        Estimated Hours
                                      </Label>
                                      <Input
                                        id={`hours-${idx}`}
                                        type="number"
                                        min="0"
                                        step="0.5"
                                        value={extra.estimatedHours || 0}
                                        onChange={(e) => {
                                          const rawValue = e.target.value;
                                          const parsedValue = parseFloat(rawValue);
                                          const newValue = isNaN(parsedValue) || parsedValue < 0
                                            ? 0
                                            : parsedValue;
                                          const updatedExtra = { ...extra, estimatedHours: newValue };
                                          setOptionalExtras(prev => prev.map((item, i) =>
                                            i === idx ? updatedExtra : item
                                          ));
                                          // Debounce recalculation for text input
                                          setTimeout(() => recalculateExtraPrice(idx, updatedExtra), 500);
                                        }}
                                        className="h-8 bg-white dark:bg-gray-800"
                                        data-testid={`input-hours-${idx}`}
                                      />
                                    </div>

                                    <div>
                                      <Label htmlFor={`materials-${idx}`} className="text-xs text-gray-600 dark:text-gray-400">
                                        Materials Cost (£)
                                      </Label>
                                      <Input
                                        id={`materials-${idx}`}
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={(extra.materialsCost || extra.materialsCostInPence / 100).toFixed(2)}
                                        onChange={(e) => {
                                          const rawValue = e.target.value;
                                          const parsedValue = parseFloat(rawValue);
                                          const newValue = isNaN(parsedValue) || parsedValue < 0
                                            ? 0
                                            : parsedValue;
                                          const updatedExtra = {
                                            ...extra,
                                            materialsCost: newValue,
                                            materialsCostInPence: Math.round(newValue * 100)
                                          };
                                          setOptionalExtras(prev => prev.map((item, i) =>
                                            i === idx ? updatedExtra : item
                                          ));
                                          // Debounce recalculation for text input
                                          setTimeout(() => recalculateExtraPrice(idx, updatedExtra), 500);
                                        }}
                                        className="h-8 bg-white dark:bg-gray-800"
                                        data-testid={`input-materials-${idx}`}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  onClick={handleGenerateLink}
                  disabled={isGenerating}
                  className="w-full lg:flex-1 bg-primary hover:bg-primary/90 py-6 lg:py-4 font-bold uppercase tracking-widest text-primary-foreground"
                  size="lg"
                  data-testid="button-generate-link"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <LinkIcon className="mr-2 h-5 w-5" />
                      Generate Quote Link
                    </>
                  )}
                </Button>

                {/* Reset Button */}
                <Button
                  onClick={handleReset}
                  variant="outline"
                  size="lg"
                  className="w-full lg:w-auto py-6 lg:py-4 font-bold uppercase tracking-widest opacity-50"
                  data-testid="button-reset"
                >
                  Reset Form
                </Button>
              </div>

              {/* Validation Helper Text */}
              {(!finalEffectivePrice || finalEffectivePrice <= 0) && jobDescription.length > 0 && (
                <div className="text-center p-2 bg-yellow-50 text-yellow-800 text-sm rounded-md border border-yellow-200">
                  ⚠️ Please <strong>Analyze Job</strong> or enter a <strong>Manual Price</strong> before generating the link.
                </div>
              )}


              {/* Generated Quote Preview */}
              {generatedUrl && (
                <Card className="border-2 border-primary/50 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-primary">
                      <Check className="h-5 w-5" />
                      Quote Link Generated Successfully!
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Pricing Preview */}
                    {generatedPricing && (
                      <div className="bg-card rounded-lg p-4 space-y-3 border border-border">
                        {generatedQuoteMode === 'hhh' ? (
                          <>
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold text-foreground">Value-Based Tier Pricing:</h3>
                              <Badge variant="outline" className="text-muted-foreground border-border">
                                Multiplier: {generatedPricing.valueMultiplier.toFixed(2)}x
                              </Badge>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className={`text-center p-3 rounded ${generatedPricing.recommendedTier === 'essential' ? 'bg-primary/10 border-2 border-primary' : 'bg-muted/50'}`}>
                                <div className="text-sm text-slate-400 mb-1">
                                  Essential
                                  {generatedPricing.recommendedTier === 'essential' && ' ⭐'}
                                </div>
                                <div className="text-2xl font-bold text-white">{formatPrice(generatedPricing.essential)}</div>
                              </div>
                              <div className={`text-center p-3 rounded ${generatedPricing.recommendedTier === 'hassleFree' ? 'bg-blue-900/30 border-2 border-blue-500' : 'bg-slate-800'}`}>
                                <div className="text-sm text-slate-400 mb-1">
                                  Hassle-Free
                                  {generatedPricing.recommendedTier === 'hassleFree' && ' ⭐'}
                                </div>
                                <div className="text-2xl font-bold text-white">{formatPrice(generatedPricing.hassleFree)}</div>
                              </div>
                              <div className={`text-center p-3 rounded ${generatedPricing.recommendedTier === 'highStandard' ? 'bg-blue-900/30 border-2 border-blue-500' : 'bg-slate-800'}`}>
                                <div className="text-sm text-slate-400 mb-1">
                                  High Standard
                                  {generatedPricing.recommendedTier === 'highStandard' && ' ⭐'}
                                </div>
                                <div className="text-2xl font-bold text-white">{formatPrice(generatedPricing.highStandard)}</div>
                              </div>
                            </div>
                          </>
                        ) : generatedQuoteMode === 'pick_and_mix' ? (
                          <>
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold text-white">Pick & Mix Quote:</h3>
                              <Badge variant="outline" className="bg-blue-900/30 text-blue-300 border-blue-700">
                                A La Carte
                              </Badge>
                            </div>
                            <div className="text-center p-4 bg-gradient-to-br from-blue-900/40 to-blue-900/20 rounded-lg border-2 border-blue-500/30">
                              <div className="text-sm text-slate-300 mb-2">Total Potential Value</div>
                              {/* Calculate sum of extras for display since base price might be 0 */}
                              <div className="text-4xl font-bold text-blue-100">
                                {/* We don't have the extras list in generatedPricing, so just show what we have or a specific message */}
                                View Link for Details
                              </div>
                              <div className="text-xs text-slate-400 mt-2">Customer builds their own package</div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold text-white">Simple Quote Pricing:</h3>
                              <Badge variant="outline" className="bg-purple-900/30 text-purple-300 border-purple-700">
                                Base Price
                              </Badge>
                            </div>
                            <div className="text-center p-4 bg-gradient-to-br from-purple-900/40 to-purple-900/20 rounded-lg border-2 border-purple-500/30">
                              <div className="text-sm text-slate-300 mb-2">Quote Price</div>
                              <div className="text-4xl font-bold text-purple-100">{formatPrice(generatedPricing.essential)}</div>
                              {optionalExtras.length > 0 && (
                                <div className="text-xs text-slate-400 mt-2">+ Optional extras available</div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Customer Info Summary */}
                    <div className="bg-muted/50 rounded-lg p-4">
                      <h3 className="font-semibold text-foreground mb-2">Quote Details:</h3>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p><span className="font-medium text-foreground">Customer:</span> {customerName}</p>
                        <p><span className="font-medium text-foreground">Phone:</span> {phone}</p>
                        {customerEmail && <p><span className="font-medium text-foreground">Email:</span> {customerEmail}</p>}
                        <p><span className="font-medium text-foreground">Postcode:</span> {postcode}</p>
                      </div>
                    </div>

                    {/* Share Link */}
                    <div className="flex gap-2">
                      <Input
                        value={generatedUrl}
                        readOnly
                        className="flex-1 bg-background text-foreground border-input"
                        data-testid="input-generated-url"
                      />
                      <Button
                        onClick={handleCopyLink}
                        variant="outline"
                        className="border-slate-700 hover:bg-slate-800 text-slate-300"
                        data-testid="button-copy-link"
                      >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>

                    {/* WhatsApp Message Customization */}
                    <div className="bg-slate-900 rounded-lg p-4 space-y-4">
                      <h3 className="font-semibold text-white flex items-center gap-2">
                        <FaWhatsapp className="h-5 w-5 text-green-500" />
                        WhatsApp Message Settings
                      </h3>

                      {/* Priming Price Range (Auto-calculated) */}
                      {primingPriceRange && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-slate-300">Priming Price Range</Label>
                          <div className="flex items-center gap-3 p-3 bg-blue-900/20 rounded-lg border border-blue-800">
                            <div className="text-2xl font-bold text-blue-100">
                              £{primingPriceRange.low}–£{primingPriceRange.high}
                            </div>
                            <Badge variant="outline" className="text-blue-300 border-blue-700 text-xs">
                              Auto-calculated
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-500">Based on HHH pricing with behavioral economics (low ↓£10, high ↑£50)</p>
                        </div>
                      )}

                      {/* Excuse Toggles */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-slate-300">Delay Apology (optional)</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex items-center justify-between p-2 bg-slate-800 rounded border border-slate-700">
                            <Label htmlFor="christmas-rush" className="text-xs cursor-pointer text-slate-300">Christmas Rush 🎄</Label>
                            <Switch
                              id="christmas-rush"
                              checked={excuseToggles.christmasRush}
                              onCheckedChange={(checked) => setExcuseToggles(prev => ({
                                ...prev,
                                christmasRush: checked,
                                weekendDelay: checked ? false : prev.weekendDelay,
                                highDemand: checked ? false : prev.highDemand,
                                staffHoliday: checked ? false : prev.staffHoliday
                              }))}
                              data-testid="switch-christmas-rush"
                            />
                          </div>
                          <div className="flex items-center justify-between p-2 bg-slate-800 rounded border border-slate-700">
                            <Label htmlFor="weekend-delay" className="text-xs cursor-pointer text-slate-300">Weekend Delay</Label>
                            <Switch
                              id="weekend-delay"
                              checked={excuseToggles.weekendDelay}
                              onCheckedChange={(checked) => setExcuseToggles(prev => ({
                                ...prev,
                                weekendDelay: checked,
                                christmasRush: checked ? false : prev.christmasRush,
                                highDemand: checked ? false : prev.highDemand,
                                staffHoliday: checked ? false : prev.staffHoliday
                              }))}
                              data-testid="switch-weekend-delay"
                            />
                          </div>
                          <div className="flex items-center justify-between p-2 bg-slate-800 rounded border border-slate-700">
                            <Label htmlFor="high-demand" className="text-xs cursor-pointer text-slate-300">High Demand</Label>
                            <Switch
                              id="high-demand"
                              checked={excuseToggles.highDemand}
                              onCheckedChange={(checked) => setExcuseToggles(prev => ({
                                ...prev,
                                highDemand: checked,
                                christmasRush: checked ? false : prev.christmasRush,
                                weekendDelay: checked ? false : prev.weekendDelay,
                                staffHoliday: checked ? false : prev.staffHoliday
                              }))}
                              data-testid="switch-high-demand"
                            />
                          </div>
                          <div className="flex items-center justify-between p-2 bg-slate-800 rounded border border-slate-700">
                            <Label htmlFor="staff-holiday" className="text-xs cursor-pointer text-slate-300">Staff Holiday</Label>
                            <Switch
                              id="staff-holiday"
                              checked={excuseToggles.staffHoliday}
                              onCheckedChange={(checked) => setExcuseToggles(prev => ({
                                ...prev,
                                staffHoliday: checked,
                                christmasRush: checked ? false : prev.christmasRush,
                                weekendDelay: checked ? false : prev.weekendDelay,
                                highDemand: checked ? false : prev.highDemand
                              }))}
                              data-testid="switch-staff-holiday"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Message Preview */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-slate-300">Message Preview</Label>
                        <div className="bg-green-900/20 text-green-100 rounded-lg p-3 text-sm whitespace-pre-wrap border border-green-800/50 max-h-60 overflow-y-auto">
                          {generateWhatsAppMessage()}
                        </div>
                      </div>
                    </div>

                    {/* Send Options */}
                    <div className="flex gap-2">

                      <Button
                        onClick={handleSendWhatsApp}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        data-testid="button-send-whatsapp"
                      >
                        <FaWhatsapp className="mr-2 h-5 w-5" />
                        Send via WhatsApp
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="sent" className="space-y-6">
              {/* Search */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by name, phone, or quote ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-slate-800 text-white border-slate-600"
                    data-testid="input-search-quotes"
                  />
                </div>
              </div>

              {/* Quotes List */}
              <div className="space-y-8">
                {/* Booking Visits Section */}
                <div>
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-blue-500" />
                    Booking Visits
                    <Badge variant="secondary" className="bg-blue-900/50 text-blue-300 ml-2">
                      {visitQuotes.length}
                    </Badge>
                  </h3>

                  {isLoadingQuotes ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : visitQuotes.length === 0 ? (
                    <Card className="bg-slate-900/50 border-slate-800 border-dashed">
                      <CardContent className="py-8 text-center text-slate-500 text-sm">
                        {searchQuery ? 'No visits found.' : 'No diagnostic visits scheduled yet.'}
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {visitQuotes.map((quote) => {
                        const datePrefs = (quote as any).datePreferences || [];
                        // Logic for deposit display (Diagnostic fees are usually fixed)
                        const depositAmount = quote.basePrice || 8500; // Default or saved

                        return (
                          <Card key={quote.id} className={`hover:shadow-md transition-shadow border-l-4 border-l-blue-500`}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <h3 className="font-semibold text-lg text-white truncate">{quote.customerName}</h3>
                                    <Badge variant="secondary" className="text-xs bg-blue-900/30 text-blue-400 border border-blue-800">Diagnostic</Badge>
                                    {quote.viewedAt && (
                                      <Badge variant="outline" className="text-green-600 border-green-600 text-xs" title={`Opened: ${format(new Date(quote.viewedAt), 'dd MMM yyyy, HH:mm')}`}>
                                        <Eye className="h-3 w-3 mr-1" />
                                        Opened
                                      </Badge>
                                    )}
                                    {quote.bookedAt && (
                                      <Badge className="bg-green-600 text-xs">Booked</Badge>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 max-w-full">
                                    <div className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-400 font-mono truncate select-all">
                                      {`${window.location.origin}/visit-link/${quote.shortSlug}`}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-slate-400 hover:text-white"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(`${window.location.origin}/visit-link/${quote.shortSlug}`);
                                        toast({ title: 'Copied', description: 'Link copied to clipboard' });
                                      }}
                                    >
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-500 hover:text-red-400 hover:bg-red-900/20 -mt-1 -mr-2"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm('Are you sure you want to delete this visit link?')) {
                                      try {
                                        const res = await fetch(`/api/personalized-quotes/${quote.id}`, { method: 'DELETE' });
                                        if (res.ok) {
                                          await queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
                                          refetchQuotes();
                                          toast({ title: 'Deleted', description: 'Visit link removed.' });
                                        }
                                      } catch (err) { console.error(err); }
                                    }
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-slate-300 mb-3">
                                <p className="flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  <a href={`tel:${quote.phone}`} className="text-blue-400 hover:underline">{quote.phone}</a>
                                </p>
                                <p><span className="font-medium">Postcode:</span> {quote.postcode}</p>
                              </div>

                              {quote.assessmentReason && (
                                <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-2 mb-3">
                                  <p className="text-xs text-blue-200"><strong>Reason:</strong> {quote.assessmentReason}</p>
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open(`/visit-link/${quote.shortSlug}`, '_blank')}
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  View Visit Link
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Generated Quotes Section */}
                <div>
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-emerald-500" />
                    Generated Quotes
                    <Badge variant="secondary" className="bg-emerald-900/50 text-emerald-300 ml-2">
                      {generatedQuotes.length}
                    </Badge>
                  </h3>

                  {isLoadingQuotes ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : generatedQuotes.length === 0 ? (
                    <Card className="bg-slate-900/50 border-slate-800">
                      <CardContent className="py-12 text-center text-slate-400">
                        {searchQuery ? 'No quotes found matching your search.' : 'No quotes sent yet.'}
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {generatedQuotes.map((quote) => {
                        const datePrefs = (quote as any).datePreferences || [];

                        // Handle both old (handyFix/hassleFree/highStandard) and new (essential/enhanced/elite) package names
                        const pkg = quote.selectedPackage;
                        const isEssentialTier = pkg === 'essential' || pkg === 'handyFix';
                        const isEnhancedTier = pkg === 'enhanced' || pkg === 'hassleFree';
                        const isEliteTier = pkg === 'elite' || pkg === 'highStandard';

                        const selectedPrice = isEssentialTier
                          ? quote.essentialPrice
                          : isEnhancedTier
                            ? quote.enhancedPrice
                            : isEliteTier
                              ? quote.elitePrice
                              : null;

                        const packageLabel = isEssentialTier ? 'Handy Fix'
                          : isEnhancedTier ? 'Hassle-Free'
                            : isEliteTier ? 'High Standard'
                              : null;

                        const tierBadgeClass = isEssentialTier ? 'bg-slate-600'
                          : isEnhancedTier ? 'bg-green-600'
                            : isEliteTier ? 'bg-rose-600'
                              : 'bg-gray-600';

                        // Calculate deposit: 100% materials + 30% labor
                        const materialsCost = quote.materialsCostWithMarkupPence || 0;
                        const laborCost = selectedPrice ? Math.max(0, selectedPrice - materialsCost) : 0;
                        const depositAmount = materialsCost + Math.round(laborCost * 0.30);

                        return (
                          <Card key={quote.id} className={`hover:shadow-md transition-shadow ${quote.bookedAt ? 'border-l-4 border-l-green-500' : ''}`}>
                            <CardContent className="p-4">
                              {/* Header - Name, Status Badges, URL, Delete */}
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <h3 className="font-semibold text-lg text-white truncate">{quote.customerName}</h3>
                                    <Badge variant="secondary" className="text-xs">{quote.shortSlug}</Badge>
                                    {quote.viewedAt && (
                                      <Badge variant="outline" className="text-green-600 border-green-600 text-xs" title={`Opened: ${format(new Date(quote.viewedAt), 'dd MMM yyyy, HH:mm')}`}>
                                        <Eye className="h-3 w-3 mr-1" />
                                        Opened {format(new Date(quote.viewedAt), 'dd MMM, HH:mm')}
                                      </Badge>
                                    )}
                                    {(() => {
                                      if (!quote.expiresAt) return null;
                                      const isExpired = new Date() > new Date(quote.expiresAt);
                                      if (isExpired && !quote.bookedAt) {
                                        return (
                                          <Badge variant="outline" className="text-red-600 border-red-600 text-xs">
                                            Expired
                                          </Badge>
                                        );
                                      }
                                      return null;
                                    })()}
                                    {quote.bookedAt && (
                                      <Badge className="bg-green-600 text-xs">
                                        Booked
                                      </Badge>
                                    )}
                                    {quote.regenerationCount && quote.regenerationCount > 0 && (
                                      <Badge variant="outline" className="text-orange-600 border-orange-600 text-xs">
                                        Regen ×{quote.regenerationCount}
                                      </Badge>
                                    )}
                                  </div>

                                  {/* Persistent URL Display */}
                                  <div className="flex items-center gap-2 max-w-full">
                                    <div className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-400 font-mono truncate select-all">
                                      {`${window.location.origin}/quote-link/${quote.shortSlug}`}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-slate-400 hover:text-white"
                                      title="Copy Link"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(`${window.location.origin}/quote-link/${quote.shortSlug}`);
                                        toast({ title: 'Copied', description: 'Link copied to clipboard' });
                                      }}
                                    >
                                      <Copy className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>

                                {/* Delete Button */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-500 hover:text-red-400 hover:bg-red-900/20 -mt-1 -mr-2"
                                  title="Delete Quote"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (confirm('Are you sure you want to delete this quote?')) {
                                      try {
                                        console.log('Deleting quote:', quote.id);
                                        const res = await fetch(`/api/personalized-quotes/${quote.id}`, { method: 'DELETE' });
                                        if (res.ok) {
                                          console.log('Delete successful, invalidating queries');
                                          toast({ title: 'Quote Deleted', description: 'The quote has been removed.' });
                                          // Force a hard refetch by invalidating the query
                                          await queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
                                          refetchQuotes();
                                        } else {
                                          throw new Error('Failed to delete');
                                        }
                                      } catch (err) {
                                        console.error('Delete failed:', err);
                                        toast({ title: 'Error', description: 'Failed to delete quote', variant: 'destructive' });
                                      }
                                    }
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>

                              {/* Contact Info - Mobile Stacked */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-slate-300 mb-3">
                                <p className="flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  <a href={`tel:${quote.phone}`} className="text-blue-400 hover:underline">{quote.phone}</a>
                                </p>
                                {quote.email && (
                                  <p className="truncate">
                                    <span className="font-medium">Email:</span> {quote.email}
                                  </p>
                                )}
                                {quote.postcode && (
                                  <p><span className="font-medium">Postcode:</span> {quote.postcode}</p>
                                )}
                                <p className="text-xs text-gray-400">
                                  Created: {format(new Date(quote.createdAt), 'dd MMM, HH:mm')}
                                </p>
                              </div>

                              {/* Job Description */}
                              {quote.jobDescription && (
                                <div className="bg-slate-800 rounded-lg p-3 mb-3">
                                  <p className="text-sm text-slate-300 line-clamp-2">{quote.jobDescription}</p>
                                </div>
                              )}

                              {/* Booking Details - Only show if booked */}
                              {quote.bookedAt && (
                                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2 text-sm">
                                    {packageLabel && (
                                      <div className="flex items-center gap-1">
                                        <span className="font-medium text-green-800">Package:</span>
                                        <Badge className={tierBadgeClass}>
                                          {packageLabel}
                                        </Badge>
                                      </div>
                                    )}
                                    {selectedPrice && (
                                      <span className="text-green-800 font-semibold">
                                        £{Math.round(selectedPrice / 100)}
                                      </span>
                                    )}
                                  </div>

                                  {/* Payment Info */}
                                  <div className="flex flex-wrap items-center gap-3 text-sm">
                                    {quote.paymentType && (
                                      <div className="flex items-center gap-1">
                                        <CreditCard className="h-4 w-4 text-green-600" />
                                        <span className="font-medium text-green-800">
                                          {quote.paymentType === 'installments' ? 'Pay in 3' : 'Pay in Full'}
                                        </span>
                                      </div>
                                    )}
                                    {quote.depositPaidAt && depositAmount > 0 && (
                                      <div className="flex items-center gap-1">
                                        <Check className="h-4 w-4 text-green-600" />
                                        <span className="text-green-700">
                                          Deposit paid: £{Math.round(depositAmount / 100)}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Selected Dates */}
                                  {datePrefs.length > 0 && (
                                    <div className="pt-2 border-t border-green-200">
                                      <p className="text-xs font-medium text-green-800 mb-1">Preferred Dates:</p>
                                      <div className="flex flex-wrap gap-2">
                                        {datePrefs.map((pref: any, idx: number) => (
                                          <span key={idx} className="inline-flex items-center gap-1 bg-white border border-green-300 rounded px-2 py-1 text-xs">
                                            <Calendar className="h-3 w-3 text-green-600" />
                                            {format(new Date(pref.preferredDate), 'EEE, d MMM')} ({pref.timeSlot})
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Pricing Tiers - Show only if not booked */}
                              {!quote.bookedAt && quote.essentialPrice && (
                                <div className="flex flex-wrap gap-2 text-xs mb-3">
                                  <span className="bg-slate-700 text-slate-200 px-2 py-1 rounded">H: £{Math.round(quote.essentialPrice / 100)}</span>
                                  <span className="bg-green-900/50 text-green-300 px-2 py-1 rounded">HH: £{Math.round((quote.enhancedPrice || 0) / 100)}</span>
                                  <span className="bg-rose-900/50 text-rose-300 px-2 py-1 rounded">HHH: £{Math.round((quote.elitePrice || 0) / 100)}</span>
                                </div>
                              )}

                              {/* Action Buttons */}
                              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open(`/quote-link/${quote.shortSlug}?t=${Date.now()}`, '_blank')}
                                  data-testid={`button-view-quote-${quote.shortSlug}`}
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  View
                                </Button>
                                {/* Invoice button for booked quotes */}
                                {quote.bookedAt && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={async () => {
                                      setLoadingInvoice(true);
                                      try {
                                        const response = await fetch(`/api/personalized-quotes/${quote.id}/invoice-data`, {
                                          credentials: 'include',
                                        });
                                        if (!response.ok) throw new Error('Failed to fetch invoice data');
                                        const data = await response.json();
                                        setInvoiceData(data);
                                        setInvoiceModalOpen(true);
                                      } catch (error) {
                                        toast({
                                          title: 'Error',
                                          description: 'Failed to load invoice data. Please try again.',
                                          variant: 'destructive',
                                        });
                                      } finally {
                                        setLoadingInvoice(false);
                                      }
                                    }}
                                    disabled={loadingInvoice}
                                    data-testid={`button-invoice-${quote.shortSlug}`}
                                  >
                                    <Receipt className="h-4 w-4 mr-1" />
                                    Invoice
                                  </Button>
                                )}
                                {(() => {
                                  if (quote.bookedAt) return null;
                                  const isExpired = quote.expiresAt && new Date() > new Date(quote.expiresAt);
                                  if (!isExpired) {
                                    return (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                        onClick={async () => {
                                          if (!confirm(`Are you sure you want to expire the quote for ${quote.customerName}?`)) {
                                            return;
                                          }
                                          try {
                                            const response = await fetch(`/api/admin/personalized-quotes/${quote.id}/expire`, {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' }
                                            });
                                            if (!response.ok) throw new Error('Failed to expire quote');
                                            toast({
                                              title: 'Quote expired',
                                              description: `The quote for ${quote.customerName} has been expired.`,
                                            });
                                            refetchQuotes();
                                          } catch (error) {
                                            toast({
                                              title: 'Error',
                                              description: 'Failed to expire quote. Please try again.',
                                              variant: 'destructive',
                                            });
                                          }
                                        }}
                                        data-testid={`button-expire-quote-${quote.shortSlug}`}
                                      >
                                        <X className="h-4 w-4 mr-1" />
                                        Expire
                                      </Button>
                                    );
                                  } else {
                                    // Quote is expired - show regenerate dropdown
                                    return (
                                      <div className="flex gap-1">
                                        <select
                                          id={`regenerate-percent-${quote.id}`}
                                          defaultValue="5"
                                          className="h-8 px-2 text-xs border rounded-md bg-white"
                                          data-testid={`select-regenerate-percent-${quote.shortSlug}`}
                                        >
                                          <option value="0">0%</option>
                                          <option value="2.5">+2.5%</option>
                                          <option value="5">+5%</option>
                                          <option value="7.5">+7.5%</option>
                                          <option value="10">+10%</option>
                                        </select>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                          onClick={async () => {
                                            const selectEl = document.getElementById(`regenerate-percent-${quote.id}`) as HTMLSelectElement;
                                            const percentageIncrease = parseFloat(selectEl?.value || '5');

                                            if (!confirm(`Regenerate quote for ${quote.customerName} with ${percentageIncrease}% increase?`)) {
                                              return;
                                            }
                                            try {
                                              const response = await fetch(`/api/admin/personalized-quotes/${quote.id}/regenerate`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ percentageIncrease })
                                              });
                                              if (!response.ok) throw new Error('Failed to regenerate quote');
                                              const data = await response.json();
                                              toast({
                                                title: 'Quote Regenerated!',
                                                description: `Quote for ${quote.customerName} regenerated with ${percentageIncrease}% increase. New timer: 15 mins.`,
                                              });
                                              // Invalidate cache and refetch to update UI immediately
                                              queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
                                              refetchQuotes();
                                            } catch (error) {
                                              toast({
                                                title: 'Error',
                                                description: 'Failed to regenerate quote. Please try again.',
                                                variant: 'destructive',
                                              });
                                            }
                                          }}
                                          data-testid={`button-regenerate-quote-${quote.shortSlug}`}
                                        >
                                          <RefreshCw className="h-4 w-4 mr-1" />
                                          Regenerate
                                        </Button>
                                      </div>
                                    );
                                  }
                                })()}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Twilio Settings Tab */}
            <TabsContent value="settings" className="space-y-6">
              {/* Active Call Forwarding Status Card */}
              <Card className={twilioSettings?.activeAgents && twilioSettings.activeAgents.length > 0
                ? "border-green-200 bg-green-50"
                : "border-amber-200 bg-amber-50"
              }>
                <CardHeader className="pb-2">
                  <CardTitle className={`text-base flex items-center gap-2 ${twilioSettings?.activeAgents && twilioSettings.activeAgents.length > 0
                    ? "text-green-800"
                    : "text-amber-800"
                    }`}>
                    <Phone className="h-4 w-4" />
                    Active Call Forwarding Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-4">
                    {twilioSettings?.activeAgents && twilioSettings.activeAgents.length > 0 ? (
                      <div>
                        <p className="text-sm text-green-700 font-medium mb-3">
                          When someone calls your Twilio number, {twilioSettings.activeAgents.length} agent{twilioSettings.activeAgents.length > 1 ? 's' : ''} will be called simultaneously:
                        </p>
                        <div className="space-y-2">
                          {twilioSettings.activeAgents.map((agent) => (
                            <div key={agent.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-green-200 shadow-sm">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                                  <span className="text-green-700 font-semibold text-sm">
                                    {agent.name.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">{agent.name}</p>
                                  <p className="text-sm text-gray-500 font-mono">{agent.phoneNumber}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                  {agent.answeredCalls}/{agent.totalCalls} calls
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <Phone className="h-10 w-10 mx-auto text-amber-400 mb-2" />
                        <p className="text-amber-800 font-medium mb-1">No Forwarding Agents Configured</p>
                        <p className="text-sm text-amber-700">
                          Add agents to receive incoming calls when customers ring your Twilio number.
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Call Forwarding Management Card */}
              <Card className="bg-slate-900/50 border-slate-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Phone className="h-5 w-5 text-blue-600" />
                    Call Forwarding Management
                  </CardTitle>
                  <p className="text-sm text-gray-600">
                    Manage forwarding agents, track call performance, and access recordings
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Settings className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-blue-900 mb-1">Forwarding Agents Dashboard</h4>
                        <p className="text-sm text-blue-700 mb-3">
                          Add, edit, or remove call forwarding agents. View detailed call statistics,
                          listen to recordings, and track earnings per agent.
                        </p>
                        <Link href="/admin/forwarding-agents">
                          <Button className="bg-blue-600 hover:bg-blue-700" data-testid="button-manage-agents">
                            <ArrowRight className="h-4 w-4 mr-2" />
                            Manage Forwarding Agents
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>

                  {twilioSettings?.activeAgents && twilioSettings.activeAgents.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Check className="h-4 w-4 text-green-500" />
                      <span>
                        {twilioSettings.activeAgents.length} active agent{twilioSettings.activeAgents.length > 1 ? 's' : ''} receiving calls
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Invoice Modal */}
          <Dialog open={invoiceModalOpen} onOpenChange={setInvoiceModalOpen}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-blue-600" />
                  Invoice Summary
                </DialogTitle>
                <DialogDescription>
                  Complete booking details for final invoice
                </DialogDescription>
              </DialogHeader>

              {invoiceData && (
                <div className="space-y-4">
                  {/* Customer Details */}
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <h4 className="font-semibold text-gray-900">Customer</h4>
                    <p className="text-sm"><span className="font-medium">Name:</span> {invoiceData.customerName}</p>
                    <p className="text-sm"><span className="font-medium">Phone:</span> {invoiceData.phone}</p>
                    {invoiceData.email && (
                      <p className="text-sm"><span className="font-medium">Email:</span> {invoiceData.email}</p>
                    )}
                    {invoiceData.postcode && (
                      <p className="text-sm"><span className="font-medium">Postcode:</span> {invoiceData.postcode}</p>
                    )}
                  </div>

                  {/* Job Description */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="font-semibold text-gray-900 mb-2">Job Description</h4>
                    <p className="text-sm text-gray-700">{invoiceData.jobDescription}</p>
                  </div>

                  {/* Selection Details */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                    <h4 className="font-semibold text-blue-900">What Customer Selected</h4>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Package:</span>
                      <Badge className={
                        invoiceData.selectedPackage === 'essential' ? 'bg-slate-600' :
                          invoiceData.selectedPackage === 'enhanced' ? 'bg-green-600' :
                            invoiceData.selectedPackage === 'elite' ? 'bg-rose-600' : 'bg-gray-600'
                      }>
                        {invoiceData.selectedPackage === 'essential' ? 'Handy Fix (H)' :
                          invoiceData.selectedPackage === 'enhanced' ? 'Hassle-Free (HH)' :
                            invoiceData.selectedPackage === 'elite' ? 'High Standard (HHH)' :
                              invoiceData.selectedPackage || 'N/A'}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Package Price:</span>
                      <span className="font-semibold">£{((invoiceData.selectedTierPricePence || 0) / 100).toFixed(2)}</span>
                    </div>

                    {/* Selected Extras */}
                    {invoiceData.selectedExtras && Array.isArray(invoiceData.selectedExtras) && invoiceData.selectedExtras.length > 0 && (
                      <div className="pt-2 border-t border-blue-200">
                        <p className="text-sm font-medium mb-2">Selected Extras:</p>
                        <div className="space-y-1">
                          {invoiceData.selectedExtras.map((extra: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-sm">
                              <span className="text-gray-700">
                                {typeof extra === 'string' ? extra : extra.label}
                              </span>
                              {typeof extra === 'object' && extra.priceInPence && (
                                <span className="text-gray-600">£{(extra.priceInPence / 100).toFixed(2)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Pricing Breakdown */}
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                    <h4 className="font-semibold text-green-900">Pricing Breakdown</h4>

                    <div className="flex items-center justify-between text-sm">
                      <span>Total Job Price:</span>
                      <span className="font-semibold">£{((invoiceData.totalJobPricePence || 0) / 100).toFixed(2)}</span>
                    </div>

                    <div className="flex items-center justify-between text-sm text-green-700">
                      <span>Deposit Paid:</span>
                      <span className="font-semibold">- £{((invoiceData.depositAmountPence || 0) / 100).toFixed(2)}</span>
                    </div>

                    <div className="flex items-center justify-between text-sm pt-2 border-t border-green-300">
                      <span className="font-bold text-lg">Remaining Balance:</span>
                      <span className="font-bold text-lg text-green-800">£{((invoiceData.remainingBalancePence || 0) / 100).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Payment Details */}
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                    <h4 className="font-semibold text-gray-900">Payment Info</h4>

                    <div className="flex items-center justify-between">
                      <span>Payment Type:</span>
                      <Badge variant="outline">
                        {invoiceData.paymentType === 'installments' ? 'Pay in 3' : 'Paid in Full'}
                      </Badge>
                    </div>

                    {invoiceData.depositPaidAt && (
                      <div className="flex items-center justify-between">
                        <span>Deposit Paid:</span>
                        <span>{format(new Date(invoiceData.depositPaidAt), 'dd MMM yyyy, HH:mm')}</span>
                      </div>
                    )}

                    {invoiceData.stripePaymentIntentId && (
                      <div className="flex items-center justify-between">
                        <span>Stripe ID:</span>
                        <code className="text-xs bg-gray-200 px-2 py-1 rounded">{invoiceData.stripePaymentIntentId}</code>
                      </div>
                    )}

                    {invoiceData.paymentType === 'installments' && (
                      <>
                        <div className="pt-2 border-t border-gray-200 mt-2">
                          <p className="font-medium mb-1">Installment Details:</p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <span>Status: {invoiceData.installmentStatus || 'N/A'}</span>
                            <span>Amount: £{((invoiceData.installmentAmountPence || 0) / 100).toFixed(2)}</span>
                            <span>Completed: {invoiceData.completedInstallments || 0}/{invoiceData.totalInstallments || 3}</span>
                            {invoiceData.nextInstallmentDate && (
                              <span>Next: {format(new Date(invoiceData.nextInstallmentDate), 'dd MMM')}</span>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Copy to clipboard button */}
                  <Button
                    className="w-full"
                    onClick={() => {
                      const text = `Invoice for ${invoiceData.customerName}
---
Package: ${invoiceData.selectedPackage === 'essential' ? 'Handy Fix (H)' : invoiceData.selectedPackage === 'enhanced' ? 'Hassle-Free (HH)' : invoiceData.selectedPackage === 'elite' ? 'High Standard (HHH)' : invoiceData.selectedPackage || 'N/A'}
Package Price: £${((invoiceData.selectedTierPricePence || 0) / 100).toFixed(2)}
Total Job: £${((invoiceData.totalJobPricePence || 0) / 100).toFixed(2)}
Deposit Paid: £${((invoiceData.depositAmountPence || 0) / 100).toFixed(2)}
Remaining Balance: £${((invoiceData.remainingBalancePence || 0) / 100).toFixed(2)}
---
Stripe ID: ${invoiceData.stripePaymentIntentId || 'N/A'}`;
                      navigator.clipboard.writeText(text);
                      toast({
                        title: 'Copied!',
                        description: 'Invoice summary copied to clipboard',
                      });
                    }}
                    data-testid="button-copy-invoice"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Invoice Summary
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div >
    </div >
  );
}
