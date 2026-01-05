import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Check, Coins, Wrench, Loader2, Sparkles } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

export default function ContractorOnboarding() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const [step, setStep] = useState(1);

    // Form State
    const [rates, setRates] = useState<Record<string, { hourly: string, day: string }>>({});
    const [selectedTrades, setSelectedTrades] = useState<string[]>([]);

    const tradesList = [
        { id: 'plumbing', label: 'Plumbing', icon: '💧' },
        { id: 'electrical', label: 'Electrical', icon: '⚡' },
        { id: 'handyman', label: 'Handyman', icon: '🔧' },
        { id: 'painting', label: 'Painting', icon: '🎨' },
        { id: 'carpentry', label: 'Carpentry', icon: '🪚' }
    ];

    const toggleTrade = (id: string) => {
        if (selectedTrades.includes(id)) {
            setSelectedTrades(prev => prev.filter(t => t !== id));
        } else {
            setSelectedTrades(prev => [...prev, id]);
        }
    };

    const finishMutation = useMutation({
        mutationFn: async () => {
            console.log("[Onboarding] Starting submission...");
            const token = localStorage.getItem('contractorToken');

            if (!token) {
                throw new Error("Authentication missing. Please log in again.");
            }

            // Clean token of ANY non-printable or weird characters
            const cleanToken = token.trim().replace(/[^a-zA-Z0-9._-]/g, '');
            console.log("[Onboarding] Cleaned token:", cleanToken.substring(0, 10) + "...");

            const servicesData = selectedTrades.map(tradeId => {
                const r = rates[tradeId] || { hourly: '60', day: '400' };
                return {
                    trade: tradeId,
                    hourlyRatePence: (parseFloat(r.hourly) || 60) * 100,
                    dayRatePence: (parseFloat(r.day) || 400) * 100
                };
            });

            console.log("[Onboarding] Sending payload:", JSON.stringify({ services: servicesData }));

            try {
                // Use absolute path just in case
                const res = await fetch('/api/contractor/onboarding/complete', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${cleanToken}`
                    },
                    body: JSON.stringify({ services: servicesData })
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    console.error("[Onboarding] Server error message:", errorText);
                    let errMsg = 'Failed to complete setup';
                    try {
                        const errJson = JSON.parse(errorText);
                        errMsg = errJson.error || errJson.details || errMsg;
                    } catch (e) {
                        errMsg = errorText || errMsg;
                    }
                    throw new Error(errMsg);
                }

                const data = await res.json();
                console.log("[Onboarding] Success response:", data);
                return data;
            } catch (err: any) {
                console.error("[Onboarding] Detailed Fetch Error:", {
                    name: err.name,
                    message: err.message,
                    code: err.code,
                    stack: err.stack
                });
                throw err;
            }
        },
        onSuccess: () => {
            toast({
                title: "Setup Complete!",
                description: "Your services have been created.",
            });
            setLocation('/contractor');
        },
        onError: (error: Error) => {
            console.error('[Onboarding] Caught Error in onError:', error);

            if (error.message.includes('Authentication') || error.message.includes('log in')) {
                toast({
                    title: "Session Expired",
                    description: "Please log in again to continue.",
                    variant: 'destructive'
                });
                setTimeout(() => setLocation('/contractor/login'), 2000);
            } else {
                toast({
                    title: "Something Went Wrong",
                    description: error.message || "The string did not match the expected pattern.",
                    variant: 'destructive'
                });
            }
        }
    });

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            {/* Progress */}
            <div className="w-full max-w-2xl mb-8">
                <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${step >= 1 ? 'text-amber-400' : 'text-slate-600'}`}>Services</span>
                    <span className={`text-sm font-medium ${step >= 2 ? 'text-amber-400' : 'text-slate-600'}`}>Rates</span>
                    <span className={`text-sm font-medium ${step >= 3 ? 'text-amber-400' : 'text-slate-600'}`}>Review</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-amber-500 transition-all duration-500 ease-out"
                        style={{ width: `${(step / 3) * 100}%` }}
                    />
                </div>
            </div>

            <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl p-8 shadow-2xl relative overflow-hidden">

                {/* Background Decor */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                {/* STEP 1: SERVICES */}
                {step === 1 && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Wrench className="w-8 h-8 text-emerald-400" />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">What services do you offer?</h1>
                            <p className="text-slate-400">Select all that apply.</p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
                            {tradesList.map(trade => (
                                <button
                                    key={trade.id}
                                    onClick={() => toggleTrade(trade.id)}
                                    className={`p-4 rounded-xl border transition-all text-left group relative overflow-hidden ${selectedTrades.includes(trade.id)
                                        ? 'bg-amber-500 border-amber-500 text-slate-900 shadow-lg shadow-amber-500/20'
                                        : 'bg-slate-900/50 border-white/10 text-slate-400 hover:bg-slate-800'
                                        }`}
                                >
                                    <span className="text-2xl mb-2 block">{trade.icon}</span>
                                    <span className={`font-bold block ${selectedTrades.includes(trade.id) ? 'text-slate-900' : 'text-white'}`}>
                                        {trade.label}
                                    </span>
                                    {selectedTrades.includes(trade.id) && (
                                        <div className="absolute top-2 right-2">
                                            <div className="w-5 h-5 bg-slate-900/20 rounded-full flex items-center justify-center">
                                                <Check className="w-3 h-3 text-slate-900" />
                                            </div>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>

                        <div className="flex justify-center">
                            <button
                                onClick={() => setStep(2)}
                                disabled={selectedTrades.length === 0}
                                className="px-8 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            >
                                Next: Set Rates <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 2: RATES */}
                {step === 2 && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Coins className="w-8 h-8 text-amber-400" />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Set your rates</h1>
                            <p className="text-slate-400">Configure pricing for each service.</p>
                        </div>

                        <div className="space-y-6 mb-8 max-h-[50vh] overflow-y-auto pr-2">
                            {selectedTrades.map(tradeId => {
                                const trade = tradesList.find(t => t.id === tradeId);
                                const rate = rates[tradeId] || { hourly: '60', day: '400' };

                                return (
                                    <div key={tradeId} className="bg-slate-900/80 rounded-xl border border-white/10 p-5">
                                        <h3 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                                            {trade?.icon} {trade?.label}
                                        </h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">Hourly</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">£</span>
                                                    <input
                                                        type="number"
                                                        value={rate.hourly}
                                                        onChange={(e) => setRates(prev => ({
                                                            ...prev,
                                                            [tradeId]: { ...rate, hourly: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-800 rounded-lg py-2 pl-7 pr-3 text-white font-bold focus:outline-none focus:ring-1 focus:ring-amber-500"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">Day Rate</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">£</span>
                                                    <input
                                                        type="number"
                                                        value={rate.day}
                                                        onChange={(e) => setRates(prev => ({
                                                            ...prev,
                                                            [tradeId]: { ...rate, day: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-800 rounded-lg py-2 pl-7 pr-3 text-white font-bold focus:outline-none focus:ring-1 focus:ring-amber-500"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex justify-between items-center">
                            <button onClick={() => setStep(1)} className="text-slate-400 hover:text-white px-4">Back</button>
                            <button
                                onClick={() => setStep(3)}
                                className="px-8 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
                            >
                                Review <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: REVIEW */}
                {step === 3 && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500 text-center">
                        <div className="inline-flex w-16 h-16 bg-amber-500/20 rounded-2xl items-center justify-center mb-4">
                            <Sparkles className="w-8 h-8 text-amber-400" />
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">Ready to launch?</h1>
                        <p className="text-slate-400 mb-8">We'll generate your services and open your dashboard.</p>

                        <div className="bg-slate-900/50 rounded-xl border border-white/5 p-6 mb-8 text-left max-h-[300px] overflow-y-auto">
                            <h3 className="text-white font-bold uppercase text-xs tracking-widest mb-4 opacity-50">Summary</h3>
                            <div className="space-y-3">
                                {selectedTrades.map(tId => {
                                    const t = tradesList.find(x => x.id === tId);
                                    const r = rates[tId] || { hourly: '60', day: '400' };
                                    return (
                                        <div key={tId} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
                                            <span className="text-slate-300">{t?.label} Services</span>
                                            <div className="text-right">
                                                <div className="text-white font-bold">£{r.hourly}/hr</div>
                                                {parseInt(r.day) > 0 && (
                                                    <div className="text-slate-500 text-xs">or £{r.day}/day</div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="flex justify-between items-center">
                            <button onClick={() => setStep(2)} className="text-slate-400 hover:text-white px-4 shrink-0" disabled={finishMutation.isPending}>Back</button>
                            <button
                                onClick={() => finishMutation.mutate()}
                                disabled={finishMutation.isPending}
                                className="w-full ml-4 py-3 bg-amber-500 text-slate-950 font-bold rounded-xl hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                            >
                                {finishMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Creating SKUs...
                                    </>
                                ) : (
                                    <>Launch Dashboard <ArrowRight className="w-4 h-4" /></>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Debug / Reset Option */}
            <div className="mt-12 text-center">
                <button
                    onClick={() => {
                        if (confirm("This will clear your session and take you back to the start. Are you sure?")) {
                            localStorage.removeItem('contractorToken');
                            localStorage.removeItem('contractorUser');
                            localStorage.removeItem('contractorProfileId');
                            setLocation('/contractor');
                        }
                    }}
                    className="text-xs text-slate-600 hover:text-white underline transition-colors"
                >
                    Having trouble? Clear session and start over
                </button>
            </div>
        </div>
    );
}
