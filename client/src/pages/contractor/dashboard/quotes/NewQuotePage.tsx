import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, ArrowRight, ArrowLeft, Check, Loader2, AlertCircle, Info, Quote } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useContractorAuth } from '@/hooks/use-contractor-auth';
import { motion, AnimatePresence } from 'framer-motion';

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
            // Use specific skill rate, or fallback to profile rate
            const rate = skill.hourlyRate || contractor.profile.hourlyRate || 50;
            // Normalize category key
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
                    hourlyRate: contractor?.profile?.hourlyRate || 50, // Default fallback
                    rateCard // Pass specific rates
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
            // Fallback mock data structure
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
            console.log('Creating quote with contractor:', contractor);
            if (!contractor?.user?.id) {
                console.error('Missing Contractor ID before creating quote! Contractor object:', contractor);
                throw new Error("Contractor ID missing - please refresh");
            }

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
                        description: t.description, // Use description as label for tasks
                        priceInPence: Math.round(t.estimatedHours * (t.appliedRate || 50) * 100),
                        estimatedHours: t.estimatedHours,
                        isRecommended: true
                    })),
                    ...(analysis.optionalExtras || []).map(e => ({ ...e, priceInPence: Math.round(e.pricePence) })) // Ensure format matches
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
            // Success Animation Step
            setStep(4);
            // Redirect after delay
            setTimeout(() => {
                setLocation(`/contractor/dashboard/quotes/${data.shortSlug}`);
            }, 2000);
        },
        onError: (err) => {
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

    if (isAuthLoading) return <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400"><Loader2 className="animate-spin mr-2" /> Loading...</div>;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-safe">
            {/* Header */}
            <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md px-4 py-4 flex items-center gap-3 border-b border-slate-800">
                <button onClick={() => step > 1 ? setStep(step - 1) : setLocation('/contractor/dashboard')} className="p-2 rounded-full hover:bg-slate-800">
                    <ArrowLeft className="w-5 h-5 text-slate-400" />
                </button>
                <div className="flex-1">
                    <h1 className="font-bold text-lg">
                        {quoteMode === 'hhh' ? 'Magic Quote' :
                            quoteMode === 'pick_and_mix' ? 'Pick & Mix Quote' :
                                'Standard Quote'}
                    </h1>
                    <div className="flex gap-1 mt-1">
                        {[1, 2, 3].map(s => (
                            <div key={s} className={cn("h-1 flex-1 rounded-full bg-slate-800 overflow-hidden", step >= s && "bg-slate-800")}>
                                <div className={cn("h-full w-full bg-amber-500 transition-transform duration-500 ease-out origin-left", step >= s ? "scale-x-100" : "scale-x-0")} />
                            </div>
                        ))}
                    </div>
                </div>
                {/* Mode Toggle */}
                <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                    <button
                        onClick={() => setQuoteMode('simple')}
                        className={cn("px-3 py-1 text-xs font-bold rounded-md transition-all", quoteMode === 'simple' ? "bg-slate-700 text-white" : "text-slate-500")}
                    >Raw</button>
                    <button
                        onClick={() => setQuoteMode('hhh')}
                        className={cn("px-3 py-1 text-xs font-bold rounded-md transition-all", quoteMode === 'hhh' ? "bg-amber-500 text-slate-900" : "text-slate-500")}
                    >Magic</button>
                    <button
                        onClick={() => setQuoteMode('pick_and_mix')}
                        className={cn("px-3 py-1 text-xs font-bold rounded-md transition-all", quoteMode === 'pick_and_mix' ? "bg-emerald-500 text-white" : "text-slate-500")}
                    >Pick & Mix</button>
                </div>
            </div>

            <div className="max-w-md mx-auto px-4 py-6 space-y-6">

                {/* STEP 1: JOB DESCRIPTION (Input) */}
                {step === 1 && (
                    <div className="space-y-6 animate-in slide-in-from-right-8 fade-in duration-500">
                        <div>
                            <h2 className="text-3xl font-bold mb-2 text-white tracking-tight">What's the job?</h2>
                            <p className="text-slate-400 text-base leading-relaxed">
                                {quoteMode === 'hhh'
                                    ? "Describe the work directly. Our AI will break it down and price it."
                                    : quoteMode === 'pick_and_mix'
                                        ? "List the tasks you want the customer to choose from. We'll price them individually."
                                        : "Describe the work. You'll set the price manually in the next step."}
                            </p>
                        </div>



                        <div className="space-y-4">
                            <div className="relative">
                                <label className="text-xs font-bold text-slate-500 mb-1 block uppercase">Description</label>
                                <textarea
                                    value={jobDescription}
                                    onChange={e => setJobDescription(e.target.value)}
                                    placeholder="e.g. Paint the living room walls and fix the dripping tap in the kitchen."
                                    className="w-full h-32 bg-slate-900 border border-slate-800 rounded-xl p-4 text-white placeholder:text-slate-600 focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none text-base"
                                />
                            </div>

                            <div className="relative">
                                <label className="text-xs font-bold text-slate-500 mb-1 block uppercase">Optional Extras (Optional)</label>
                                <textarea
                                    value={optionalExtrasRaw}
                                    onChange={e => setOptionalExtrasRaw(e.target.value)}
                                    placeholder="e.g. Include rubbish removal, replace isolation valves..."
                                    className="w-full h-24 bg-slate-900 border border-slate-800 rounded-xl p-4 text-white placeholder:text-slate-600 focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none text-base"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleAnalyze}
                            disabled={isAnalyzing}
                            className={cn(
                                "w-full py-4 text-white font-bold rounded-2xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-80 disabled:cursor-not-allowed overflow-hidden relative",
                                quoteMode === 'hhh'
                                    ? "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-amber-900/20"
                                    : quoteMode === 'pick_and_mix'
                                        ? "bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 shadow-emerald-900/20"
                                        : "bg-slate-800 hover:bg-slate-700 border border-slate-700"
                            )}
                        >
                            {isAnalyzing ? (
                                <div className="flex items-center gap-3">
                                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                                    <span className="animate-pulse">Analyzing Scope...</span>
                                </div>
                            ) : (
                                <>
                                    {quoteMode === 'hhh' ? <Sparkles className="w-5 h-5 animate-pulse" /> : <ArrowRight className="w-5 h-5" />}
                                    {quoteMode === 'hhh' ? "Analyze with AI" : "Continue to Pricing"}
                                </>
                            )}
                            {/* Shiny Effect for Magic Mode */}
                            {quoteMode === 'hhh' && !isAnalyzing && (
                                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                            )}
                        </button>
                    </div>
                )}

                {/* STEP 2: VERIFICATION & ADJUSTMENTS (Review AI) */}
                {step === 2 && analysis && (
                    <div className="space-y-6 animate-in slide-in-from-right duration-300">
                        <div>
                            <h2 className="text-2xl font-bold mb-2 text-white">We found this...</h2>
                            <p className="text-slate-400 text-sm">Review the estimated scope. You can adjust the complexity.</p>
                        </div>

                        {/* AI Summary Card */}
                        <div className="bg-slate-900 border border-indigo-500/30 rounded-xl p-4 shadow-lg shadow-indigo-900/10">
                            <div className="flex items-start gap-3">
                                <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-1" />
                                <div>
                                    <h3 className="font-bold text-indigo-100">AI Summary</h3>
                                    <p className="text-indigo-200/70 text-sm mt-1 leading-relaxed">{analysis.summary}</p>
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Est. Hours</label>
                                    <p className="text-xl font-bold text-white">{analysis.totalEstimatedHours} hrs</p>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Base Price</label>
                                    <p className="text-xl font-bold text-white">£{analysis.basePricePounds}</p>
                                </div>
                            </div>
                        </div>

                        {/* Complexity Slider */}
                        <div className="space-y-3">
                            <label className="text-sm font-semibold text-slate-300">Job Complexity</label>
                            <div className="grid grid-cols-4 gap-2">
                                {(['trivial', 'low', 'medium', 'high'] as Complexity[]).map(comp => (
                                    <button
                                        key={comp}
                                        onClick={() => setComplexity(comp)}
                                        className={cn(
                                            "py-2 rounded-lg text-xs font-bold capitalize border transition-all",
                                            complexity === comp
                                                ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/50"
                                                : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                                        )}
                                    >
                                        {comp}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Analysis List */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Detected Tasks</h4>
                            <ul className="space-y-3">
                                {analysis.tasks.map((task, i) => (
                                    <li key={i} className="flex gap-3 text-sm text-slate-300">
                                        <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                            <div>{task.description}</div>
                                            {task.category && (
                                                <div className="text-xs text-slate-500 mt-1 flex gap-2">
                                                    <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{task.category}</span>
                                                    {task.appliedRate && <span>@ £{task.appliedRate}/hr</span>}
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Optional Extras List */}
                        {analysis.optionalExtras && analysis.optionalExtras.length > 0 && (
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                                <h4 className="text-xs font-bold text-amber-500 uppercase mb-3">Optional Extras</h4>
                                <ul className="space-y-3">
                                    {analysis.optionalExtras.map((extra, i) => (
                                        <li key={i} className="flex justify-between items-center text-sm text-slate-300">
                                            <div className="flex gap-2">
                                                <div className="w-4 h-4 rounded-full border border-amber-500/50 mt-0.5" />
                                                <span>{extra.label}</span>
                                            </div>
                                            <span className="font-bold text-white">£{(extra.pricePence / 100).toFixed(0)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <button
                            onClick={() => setStep(3)}
                            className="w-full py-4 bg-slate-100 hover:bg-white text-slate-950 font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            Looks Good
                            <ArrowRight className="w-5 h-5" />
                        </button>
                    </div>
                )}

                {/* STEP 3: VALUE CONTEXT (The Sell) */}
                {step === 3 && (
                    <div className="space-y-6 animate-in slide-in-from-right duration-300">
                        <div>
                            <h2 className="text-2xl font-bold mb-2 text-white">Almost done.</h2>
                            <p className="text-slate-400 text-sm">A few details to help us price it perfectly (Value Pricing).</p>
                        </div>

                        {/* Customer Details */}
                        <div className="space-y-4 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500">Customer Name</label>
                                <input
                                    value={customerName}
                                    onChange={e => setCustomerName(e.target.value)}
                                    className="w-full bg-slate-800 border-slate-700 rounded-lg p-2.5 text-white"
                                    placeholder="e.g. Sarah Jones"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500">Phone</label>
                                    <input
                                        value={phoneNumber}
                                        onChange={e => setPhoneNumber(e.target.value)}
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg p-2.5 text-white"
                                        placeholder="Mobile"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500">Postcode</label>
                                    <input
                                        value={postcode}
                                        onChange={e => setPostcode(e.target.value)}
                                        className="w-full bg-slate-800 border-slate-700 rounded-lg p-2.5 text-white"
                                        placeholder="SW1A 1AA"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Value Questions */}
                        <div className="space-y-4">
                            <label className="text-sm font-semibold text-slate-300">Who is paying?</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(['homeowner', 'landlord', 'commercial'] as ClientType[]).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setClientType(type)}
                                        className={cn(
                                            "py-3 px-2 rounded-lg text-xs font-bold capitalize border transition-all text-center",
                                            clientType === type
                                                ? "bg-amber-500 border-amber-400 text-white shadow-lg shadow-amber-900/50"
                                                : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                                        )}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>

                            <label className="text-sm font-semibold text-slate-300 block mt-4">How urgent / annoying is it?</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(['low', 'med', 'high'] as Urgency[]).map(lvl => (
                                    <button
                                        key={lvl}
                                        onClick={() => setUrgency(lvl)}
                                        className={cn(
                                            "py-3 px-2 rounded-lg text-xs font-bold capitalize border transition-all text-center",
                                            urgency === lvl
                                                ? "bg-red-500 border-red-400 text-white shadow-lg shadow-red-900/50"
                                                : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
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
                            className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold rounded-xl shadow-lg shadow-amber-900/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-8"
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
                                className="absolute inset-0 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full blur-xl opacity-50"
                            />
                            <div className="relative bg-slate-900 p-6 rounded-full border border-amber-500/50 shadow-2xl shadow-amber-900/50">
                                <Sparkles className="w-12 h-12 text-amber-500" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-3xl font-bold text-white">Magic Quote Ready!</h2>
                            <p className="text-slate-400">Redirecting you to the preview details...</p>
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
