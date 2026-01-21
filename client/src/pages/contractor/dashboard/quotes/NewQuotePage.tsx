import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, ArrowRight, ArrowLeft, Check, Loader2, Quote } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useContractorAuth } from '@/hooks/use-contractor-auth';
import { VoiceDictation } from '@/components/VoiceDictation';
import { motion } from 'framer-motion';
import ContractorAppShell from '@/components/layout/ContractorAppShell';

type Complexity = 'trivial' | 'low' | 'medium' | 'high';
type ClientType = 'homeowner' | 'landlord' | 'commercial';
type Urgency = 'low' | 'med' | 'high';

interface JobAnalysis {
    summary: string;
    totalEstimatedHours: number;
    basePricePounds: number;
    tasks: { description: string, estimatedHours: number, category?: string, appliedRate?: number }[];
    optionalExtras: { label: string, pricePence: number, description: string, isRecommended: boolean }[];
}

export default function NewQuotePage() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const { contractor, isLoading: isAuthLoading } = useContractorAuth();

    // Parse Query Params for Initial Mode
    const searchParams = new URLSearchParams(window.location.search);
    const initialModeParam = searchParams.get('mode');
    const initialMode: 'hhh' | 'simple' | 'pick_and_mix' =
        initialModeParam === 'simple' ? 'simple' :
            initialModeParam === 'pick_and_mix' ? 'pick_and_mix' :
                'hhh';

    const [step, setStep] = useState(1);
    const [quoteMode, setQuoteMode] = useState<'hhh' | 'simple' | 'pick_and_mix'>(initialMode);
    const [jobDescription, setJobDescription] = useState('');
    const [optionalExtrasRaw, setOptionalExtrasRaw] = useState('');

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);

    // Form State
    const [customerName, setCustomerName] = useState('');
    const [postcode, setPostcode] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [clientType, setClientType] = useState<ClientType>('homeowner');
    const [urgency, setUrgency] = useState<Urgency>('med');
    const [complexity, setComplexity] = useState<Complexity>('low');

    // Calculate Rate Card from Skills
    const rateCard = useMemo(() => {
        if (!contractor?.profile?.skills) return {};
        const card: Record<string, number> = {};
        contractor.profile.skills.forEach((skill: any) => {
            const cat = skill.service?.category || skill.service?.name || 'General';
            const rate = skill.hourlyRate || contractor.profile.hourlyRate || 50;
            card[cat] = rate;
        });
        return card;
    }, [contractor]);

    // AI Analysis Mutation
    const analyzeMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/analyze-job', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobDescription,
                    optionalExtrasRaw,
                    hourlyRate: contractor?.profile?.hourlyRate || 50,
                    rateCard
                })
            });
            if (!res.ok) throw new Error('Failed to analyze');
            return res.json();
        },
        onMutate: () => setIsAnalyzing(true),
        onSuccess: (data) => {
            setAnalysis(data);
            setIsAnalyzing(false);
            setStep(2); // Auto-advance
        },
        onError: (error) => {
            console.warn("Analysis failed API call, falling back to client-side mock.", error);
            const mockAnalysis: JobAnalysis = {
                summary: "Standard job estimate (AI Unavailable)",
                totalEstimatedHours: 2,
                basePricePounds: 140,
                tasks: [{
                    description: jobDescription || "General task",
                    estimatedHours: 2,
                    category: 'General',
                    appliedRate: contractor?.profile?.hourlyRate || 50
                }],
                optionalExtras: []
            };
            setAnalysis(mockAnalysis);
            setIsAnalyzing(false);
            setStep(2);
            toast({ title: "AI Analysis Unavailable", description: "Using standard defaults instead.", variant: "default" });
        }
    });

    // Create Quote Mutation
    const createQuoteMutation = useMutation({
        mutationFn: async () => {
            if (!contractor?.user?.id) throw new Error("Contractor ID missing - please refresh");

            const payload = {
                contractorId: contractor.user.id,
                customerName: customerName || 'Valued Customer',
                postcode: postcode || 'UK',
                phone: phoneNumber || '00000000000',
                jobDescription,
                baseJobPrice: quoteMode === 'pick_and_mix' ? 0 : (analysis?.basePricePounds || 85) * 100,
                optionalExtras: quoteMode === 'pick_and_mix' && analysis ? [
                    ...analysis.tasks.map(t => ({
                        label: t.description,
                        description: t.description,
                        priceInPence: Math.round(t.estimatedHours * (t.appliedRate || 50) * 100),
                        estimatedHours: t.estimatedHours,
                        isRecommended: true
                    })),
                    ...(analysis.optionalExtras || []).map(e => ({ ...e, priceInPence: Math.round(e.pricePence) }))
                ] : (analysis?.optionalExtras || []),
                clientType,
                urgencyReason: urgency,
                ownershipContext: clientType === 'landlord' ? 'landlord' : 'homeowner',
                desiredTimeframe: urgency === 'high' ? 'asap' : 'week',
                jobComplexity: complexity,
                quoteMode: quoteMode,
                analyzedJobData: analysis,
            };

            const res = await fetch('/api/personalized-quotes/value', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Failed to create quote');
            return res.json();
        },
        onSuccess: (data) => {
            setStep(4);
            setTimeout(() => {
                setLocation(`/contractor/dashboard/quotes/${data.shortSlug}`);
            }, 2000);
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to generate quote.", variant: "destructive" });
        }
    });

    const handleAnalyze = () => {
        if (jobDescription.length < 10) {
            toast({ title: "Too short", description: "Please describe the job in more detail." });
            return;
        }
        analyzeMutation.mutate();
    };

    if (isAuthLoading) return <div className="flex h-screen items-center justify-center bg-[#F5F6F8] text-slate-400"><Loader2 className="animate-spin mr-2" /> Loading...</div>;

    return (
        <ContractorAppShell>
            <div className="max-w-md mx-auto px-4 py-6 space-y-6">

                {/* Header with Navigation */}
                <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => step > 1 ? setStep(step - 1) : setLocation('/contractor/dashboard')} className="p-2 rounded-full hover:bg-slate-200 transition-colors">
                        <ArrowLeft className="w-5 h-5 text-slate-600" />
                    </button>
                    <div className="flex-1">
                        <h1 className="font-bold text-lg text-slate-900">
                            {quoteMode === 'hhh' ? 'Magic Quote' :
                                quoteMode === 'pick_and_mix' ? 'Pick & Mix Quote' :
                                    'Standard Quote'}
                        </h1>
                        <div className="flex gap-1 mt-1.5">
                            {[1, 2, 3].map(s => (
                                <div key={s} className={cn("h-1 flex-1 rounded-full bg-slate-200 overflow-hidden", step >= s && "bg-slate-200")}>
                                    <div className={cn("h-full w-full bg-amber-500 transition-transform duration-500 ease-out origin-left", step >= s ? "scale-x-100" : "scale-x-0")} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Mode Toggle */}
                <div className="flex bg-white rounded-lg p-1 border border-slate-200 shadow-sm">
                    <button
                        onClick={() => setQuoteMode('simple')}
                        className={cn("px-3 py-1 text-xs font-bold rounded-md transition-all flex-1", quoteMode === 'simple' ? "bg-slate-100 text-slate-900 shadow-sm border border-slate-200" : "text-slate-500 hover:text-slate-700")}
                    >Raw</button>
                    <button
                        onClick={() => setQuoteMode('hhh')}
                        className={cn("px-3 py-1 text-xs font-bold rounded-md transition-all flex-1", quoteMode === 'hhh' ? "bg-amber-100 text-amber-800 shadow-sm border border-amber-200" : "text-slate-500 hover:text-slate-700")}
                    >Magic</button>
                    <button
                        onClick={() => setQuoteMode('pick_and_mix')}
                        className={cn("px-3 py-1 text-xs font-bold rounded-md transition-all flex-1", quoteMode === 'pick_and_mix' ? "bg-emerald-100 text-emerald-800 shadow-sm border border-emerald-200" : "text-slate-500 hover:text-slate-700")}
                    >Pick & Mix</button>
                </div>

                {/* STEP 1: JOB DESCRIPTION */}
                {step === 1 && (
                    <div className="space-y-6 animate-in slide-in-from-right-8 fade-in duration-500">
                        <div>
                            <h2 className="text-3xl font-bold mb-2 text-slate-900 tracking-tight">What's the job?</h2>
                            <p className="text-slate-500 text-base leading-relaxed">
                                {quoteMode === 'hhh'
                                    ? "Describe the work directly. Our AI will break it down and price it."
                                    : quoteMode === 'pick_and_mix'
                                        ? "List the tasks you want the customer to choose from. We'll price them individually."
                                        : "Describe the work. You'll set the price manually in the next step."}
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div className="relative">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Description</label>
                                    <VoiceDictation
                                        theme="light"
                                        className="scale-75 origin-right"
                                        onTranscriptionComplete={(text) => setJobDescription(prev => prev + (prev ? " " : "") + text)}
                                    />
                                </div>
                                <textarea
                                    value={jobDescription}
                                    onChange={e => setJobDescription(e.target.value)}
                                    placeholder="e.g. Paint the living room walls and fix the dripping tap in the kitchen."
                                    className="w-full h-32 bg-white border border-slate-200 rounded-xl p-4 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none text-base shadow-sm font-medium"
                                />
                            </div>

                            <div className="relative">
                                <label className="text-xs font-bold text-slate-500 mb-2 block uppercase tracking-wider">Optional Extras (Optional)</label>
                                <textarea
                                    value={optionalExtrasRaw}
                                    onChange={e => setOptionalExtrasRaw(e.target.value)}
                                    placeholder="e.g. Include rubbish removal, replace isolation valves..."
                                    className="w-full h-24 bg-white border border-slate-200 rounded-xl p-4 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none text-base shadow-sm font-medium"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleAnalyze}
                            disabled={isAnalyzing}
                            className={cn(
                                "w-full py-4 text-white font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-80 disabled:cursor-not-allowed overflow-hidden relative",
                                quoteMode === 'hhh'
                                    ? "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-amber-500/30"
                                    : quoteMode === 'pick_and_mix'
                                        ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/30"
                                        : "bg-slate-900 hover:bg-slate-800"
                            )}
                        >
                            {isAnalyzing ? (
                                <div className="flex items-center gap-3">
                                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                                    <span className="animate-pulse">Analyzing Scope...</span>
                                </div>
                            ) : (
                                <>
                                    {quoteMode === 'hhh' ? <Sparkles className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                                    {quoteMode === 'hhh' ? "Analyze with AI" : "Continue to Pricing"}
                                </>
                            )}
                            {quoteMode === 'hhh' && !isAnalyzing && (
                                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                            )}
                        </button>
                    </div>
                )}

                {/* STEP 2: VERIFICATION & ADJUSTMENTS */}
                {step === 2 && analysis && (
                    <div className="space-y-6 animate-in slide-in-from-right duration-300">
                        <div>
                            <h2 className="text-2xl font-bold mb-2 text-slate-900">We found this...</h2>
                            <p className="text-slate-500 text-sm">Review the estimated scope. You can adjust the complexity.</p>
                        </div>

                        {/* AI Summary Card */}
                        <div className="bg-white border border-indigo-100 rounded-xl p-5 shadow-lg shadow-indigo-100/50">
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-indigo-50 rounded-lg shrink-0">
                                    <Sparkles className="w-5 h-5 text-indigo-500" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900">Job Scope</h3>
                                    <p className="text-slate-600 text-sm mt-1 leading-relaxed">{analysis.summary}</p>
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Est. Hours</label>
                                    <p className="text-xl font-bold text-slate-900">{analysis.totalEstimatedHours} hrs</p>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Base Price</label>
                                    <p className="text-xl font-bold text-slate-900">£{analysis.basePricePounds}</p>
                                </div>
                            </div>
                        </div>

                        {/* Complexity Slider */}
                        <div className="space-y-3">
                            <label className="text-sm font-semibold text-slate-700">Job Complexity</label>
                            <div className="grid grid-cols-4 gap-2">
                                {(['trivial', 'low', 'medium', 'high'] as Complexity[]).map(comp => (
                                    <button
                                        key={comp}
                                        onClick={() => setComplexity(comp)}
                                        className={cn(
                                            "py-2 rounded-lg text-xs font-bold capitalize border transition-all",
                                            complexity === comp
                                                ? "bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-200"
                                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                                        )}
                                    >
                                        {comp}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Analysis List */}
                        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                            <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 tracking-wider">Detected Tasks</h4>
                            <ul className="space-y-3">
                                {analysis.tasks.map((task, i) => (
                                    <li key={i} className="flex gap-3 text-sm text-slate-700">
                                        <div className="mt-0.5"><Check className="w-4 h-4 text-emerald-500" /></div>
                                        <div className="flex-1">
                                            <div className="font-medium">{task.description}</div>
                                            {task.category && (
                                                <div className="text-xs text-slate-400 mt-1 flex gap-2 items-center">
                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 border border-slate-200">{task.category}</span>
                                                    {task.appliedRate ? (
                                                        <span>@ £{task.appliedRate}/hr</span>
                                                    ) : (
                                                        <div className="flex items-center gap-1">
                                                            <span className="text-amber-600 font-bold bg-amber-50 px-1 rounded">Set Rate: £</span>
                                                            <input
                                                                type="number"
                                                                className="w-16 p-1 text-xs border border-amber-300 rounded focus:border-amber-500 focus:outline-none"
                                                                placeholder="50"
                                                                onChange={(e) => {
                                                                    const newRate = parseInt(e.target.value) || 0;
                                                                    const newTasks = [...analysis.tasks];
                                                                    newTasks[i].appliedRate = newRate;

                                                                    // Recalculate total
                                                                    const newBasePrice = newTasks.reduce((acc, t) => acc + (t.estimatedHours * (t.appliedRate || 0)), 0) + 40; // + Callout
                                                                    setAnalysis({ ...analysis, tasks: newTasks, basePricePounds: newBasePrice });
                                                                }}
                                                            />
                                                            <span className="text-slate-400">/hr</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Optional Extras List */}
                        {analysis.optionalExtras && analysis.optionalExtras.length > 0 && (
                            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                                <h4 className="text-xs font-bold text-amber-500 uppercase mb-3 tracking-wider">Optional Extras</h4>
                                <ul className="space-y-3">
                                    {analysis.optionalExtras.map((extra, i) => (
                                        <li key={i} className="flex justify-between items-center text-sm text-slate-700">
                                            <div className="flex gap-2">
                                                <div className="w-4 h-4 rounded-full border border-amber-500/50 mt-0.5" />
                                                <span>{extra.label}</span>
                                            </div>
                                            <span className="font-bold text-slate-900">£{(extra.pricePence / 100).toFixed(0)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <button
                            onClick={() => setStep(3)}
                            className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            Looks Good
                            <ArrowRight className="w-5 h-5" />
                        </button>
                    </div>
                )}

                {/* STEP 3: VALUE CONTEXT */}
                {step === 3 && (
                    <div className="space-y-6 animate-in slide-in-from-right duration-300">
                        <div>
                            <h2 className="text-2xl font-bold mb-2 text-slate-900">Almost done.</h2>
                            <p className="text-slate-500 text-sm">A few details to help us price it perfectly (Value Pricing).</p>
                        </div>

                        {/* Customer Details */}
                        <div className="space-y-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500">Customer Name</label>
                                <input
                                    value={customerName}
                                    onChange={e => setCustomerName(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none transition-all placeholder:text-slate-400"
                                    placeholder="e.g. Sarah Jones"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500">Phone</label>
                                    <input
                                        value={phoneNumber}
                                        onChange={e => setPhoneNumber(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none transition-all placeholder:text-slate-400"
                                        placeholder="Mobile"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500">Postcode</label>
                                    <input
                                        value={postcode}
                                        onChange={e => setPostcode(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none transition-all placeholder:text-slate-400"
                                        placeholder="SW1A 1AA"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Value Questions */}
                        <div className="space-y-4">
                            <label className="text-sm font-semibold text-slate-700">Who is paying?</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(['homeowner', 'landlord', 'commercial'] as ClientType[]).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setClientType(type)}
                                        className={cn(
                                            "py-3 px-2 rounded-lg text-xs font-bold capitalize border transition-all text-center",
                                            clientType === type
                                                ? "bg-amber-500 border-amber-500 text-white shadow-md shadow-amber-200"
                                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                        )}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>

                            <label className="text-sm font-semibold text-slate-700 block mt-4">How urgent / annoying is it?</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(['low', 'med', 'high'] as Urgency[]).map(lvl => (
                                    <button
                                        key={lvl}
                                        onClick={() => setUrgency(lvl)}
                                        className={cn(
                                            "py-3 px-2 rounded-lg text-xs font-bold capitalize border transition-all text-center",
                                            urgency === lvl
                                                ? "bg-red-500 border-red-500 text-white shadow-md shadow-red-200"
                                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                        )}
                                    >
                                        {lvl === 'high' ? 'High / Emergency' : lvl === 'med' ? 'Standard' : 'Low / Flexible'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={() => createQuoteMutation.mutate()}
                            disabled={createQuoteMutation.isPending}
                            className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold rounded-xl shadow-lg shadow-amber-500/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-8"
                        >
                            {createQuoteMutation.isPending ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    Generate Magic Quote
                                    <Sparkles className="w-5 h-5 fill-white/20" />
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* STEP 4: SUCCESS ANIMATION */}
                {step === 4 && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col items-center justify-center py-20 text-center space-y-6"
                    >
                        <div className="relative">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                className="absolute inset-0 bg-gradient-to-r from-amber-400 to-orange-400 rounded-full blur-xl opacity-30"
                            />
                            <div className="relative bg-white p-6 rounded-full border border-amber-100 shadow-xl shadow-amber-100/50">
                                <Sparkles className="w-12 h-12 text-amber-500" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-3xl font-bold text-slate-900">Magic Quote Ready!</h2>
                            <p className="text-slate-500">Redirecting you to the preview details...</p>
                        </div>
                    </motion.div>
                )}
            </div>
        </ContractorAppShell>
    );
}
