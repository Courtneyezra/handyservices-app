import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Coins, Wrench, Loader2, Sparkles, MapPin, Upload, FileText, ShieldCheck, X, Globe } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import Autocomplete from 'react-google-autocomplete';

export default function PartnerOnboarding() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const [step, setStep] = useState(1);
    const [city, setCity] = useState('');
    const [radius, setRadius] = useState(10);
    const [verificationSkipped, setVerificationSkipped] = useState(false);

    // Existing Data
    const [rates, setRates] = useState<Record<string, { hourly: string, day: string }>>({});
    const [selectedTrades, setSelectedTrades] = useState<string[]>([]);

    // Files
    const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
    const [insuranceExpiry, setInsuranceExpiry] = useState('');
    const [dbsFile, setDbsFile] = useState<File | null>(null);
    const [idFile, setIdFile] = useState<File | null>(null);

    const tradesList = [
        { id: 'plumbing', label: 'Plumbing', icon: '💧' },
        { id: 'electrical', label: 'Electrical', icon: '⚡' },
        { id: 'handyman', label: 'Handyman', icon: '🔧' },
        { id: 'painting', label: 'Painting', icon: '🎨' },
        { id: 'carpentry', label: 'Carpentry', icon: '🪚' }
    ];

    const DEFAULT_RATES = { hourly: '50', day: '350' };

    const toggleTrade = (id: string) => {
        if (selectedTrades.includes(id)) {
            setSelectedTrades(prev => prev.filter(t => t !== id));
        } else {
            setSelectedTrades(prev => [...prev, id]);
        }
    };

    const finishMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            if (!token) throw new Error("No token");
            // Mock submission for now as logic is same as before
            await new Promise(resolve => setTimeout(resolve, 1500));
            return true;
        },
        onSuccess: () => {
            toast({ title: "Application Received", description: "You are now a pending partner!" });
            setLocation('/contractor/dashboard');
        }
    });

    return (
        <div className="fixed inset-0 bg-white/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white text-slate-900 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden">

                {/* Header */}
                <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight">Partner Application</h2>
                        <div className="flex gap-2 text-xs font-medium text-slate-400 mt-1">
                            <span className={step >= 1 ? "text-[#6C6CFF]" : ""}>1. Location</span>
                            <span>•</span>
                            <span className={step >= 2 ? "text-[#6C6CFF]" : ""}>2. Skills</span>
                            <span>•</span>
                            <span className={step >= 3 ? "text-[#6C6CFF]" : ""}>3. Rates</span>
                            <span>•</span>
                            <span className={step >= 4 ? "text-[#6C6CFF]" : ""}>4. Verify</span>
                        </div>
                    </div>
                    <button onClick={() => setLocation('/contractor/dashboard')} className="p-2 hover:bg-slate-50 rounded-full text-slate-400">
                        <X size={20} />
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">

                    {/* STEP 1: Location */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2 mb-8">
                                <MapPin size={48} className="mx-auto text-[#6C6CFF] mb-2" />
                                <h3 className="text-2xl font-bold">Where do you work?</h3>
                                <p className="text-slate-500">We'll match you with jobs in this area.</p>
                            </div>

                            <div className="space-y-4">
                                <label className="block text-sm font-semibold text-slate-700">Service Radius ({radius} miles)</label>
                                <input
                                    type="range"
                                    min="5" max="50"
                                    value={radius}
                                    onChange={(e) => setRadius(parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#6C6CFF]"
                                />
                                <div className="flex justify-between text-xs text-slate-400 font-medium">
                                    <span>5 miles</span>
                                    <span>50 miles</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Trades */}
                    {step === 2 && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2 mb-8">
                                <Wrench size={48} className="mx-auto text-[#6C6CFF] mb-2" />
                                <h3 className="text-2xl font-bold">What is your trade?</h3>
                                <p className="text-slate-500">Select all services you offer.</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {tradesList.map(trade => (
                                    <button
                                        key={trade.id}
                                        onClick={() => toggleTrade(trade.id)}
                                        className={`p-4 rounded-xl border-2 text-left transition-all ${selectedTrades.includes(trade.id)
                                                ? 'border-[#6C6CFF] bg-[#6C6CFF]/5'
                                                : 'border-slate-100 hover:border-slate-200'
                                            }`}
                                    >
                                        <div className="text-2xl mb-1">{trade.icon}</div>
                                        <div className={`font-bold ${selectedTrades.includes(trade.id) ? 'text-[#6C6CFF]' : 'text-slate-700'}`}>{trade.label}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 3: Rates */}
                    {step === 3 && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2 mb-8">
                                <Coins size={48} className="mx-auto text-[#6C6CFF] mb-2" />
                                <h3 className="text-2xl font-bold">Set your rates</h3>
                                <p className="text-slate-500">You can change these later.</p>
                            </div>
                            <div className="space-y-4">
                                {selectedTrades.map(t => (
                                    <div key={t} className="flex items-center justify-between p-4 rounded-xl border border-slate-100">
                                        <span className="font-medium capitalize">{t}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400 text-sm">£</span>
                                            <input
                                                className="w-20 p-2 bg-slate-50 rounded-lg font-bold text-center outline-none focus:ring-2 focus:ring-[#6C6CFF]/20"
                                                placeholder="50"
                                            />
                                            <span className="text-slate-400 text-sm">/hr</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 4: Verify */}
                    {step === 4 && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2 mb-8">
                                <ShieldCheck size={48} className="mx-auto text-[#6C6CFF] mb-2" />
                                <h3 className="text-2xl font-bold">Verification</h3>
                                <p className="text-slate-500">Upload your insurance to get approved.</p>
                            </div>

                            <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-slate-50 transition-colors cursor-pointer">
                                <Upload className="text-slate-400 mb-2" />
                                <span className="text-sm font-semibold text-[#6C6CFF]">Upload Insurance PDF</span>
                                <span className="text-xs text-slate-400 mt-1">or drag and drop</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
                    {step > 1 && (
                        <button
                            onClick={() => setStep(s => s - 1)}
                            className="px-6 py-3 font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                        >
                            Back
                        </button>
                    )}
                    <button
                        onClick={() => step < 4 ? setStep(s => s + 1) : finishMutation.mutate()}
                        className="px-8 py-3 bg-[#6C6CFF] hover:bg-[#5858E0] text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all active:scale-95"
                    >
                        {step === 4 ? (
                            finishMutation.isPending ? <Loader2 className="animate-spin" /> : "Submit Application"
                        ) : (
                            <>Next <ArrowRight size={18} /></>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
