import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { ArrowRight, Check, Coins, Wrench, Loader2, Sparkles, MapPin, Upload, FileText, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import {
    BROAD_TRADES, TRADE_CATEGORIES, CATEGORY_LABELS, CATEGORY_RATE_RANGES,
    type BroadTradeId,
} from '@shared/categories';
import { useToast } from "@/hooks/use-toast";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIconRetina from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIconRetina,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

export default function ContractorOnboarding() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const [step, setStep] = useState(1);
    const [city, setCity] = useState('');
    const [radius, setRadius] = useState(10);

    // Fetch user profile for location
    const { data: profile } = useQuery({
        queryKey: ['/api/contractor/me'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            if (!token) throw new Error("No token");
            const cleanToken = token.trim().replace(/[^a-zA-Z0-9._-]/g, '');
            const res = await fetch('/api/contractor/me', {
                headers: { 'Authorization': `Bearer ${cleanToken}` }
            });
            if (!res.ok) throw new Error("Failed to fetch profile");
            return res.json();
        }
    });

    // Auto-set initial values from profile
    useEffect(() => {
        if (profile?.profile) {
            if (profile.profile.radiusMiles) setRadius(profile.profile.radiusMiles);
            if (profile.profile.city) setCity(profile.profile.city);
        }
    }, [profile]);

    // Form State
    const [rates, setRates] = useState<Record<string, { hourly: string, day: string }>>({});
    const [selectedTrades, setSelectedTrades] = useState<string[]>([]);

    // Verification State
    const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
    const [insuranceExpiry, setInsuranceExpiry] = useState('');
    const [dbsFile, setDbsFile] = useState<File | null>(null);
    const [idFile, setIdFile] = useState<File | null>(null);
    const [verificationSkipped, setVerificationSkipped] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // Two-tier category state
    const [expandedTrades, setExpandedTrades] = useState<string[]>([]);

    const getRecommendedRate = (categorySlug: string) => {
        const range = (CATEGORY_RATE_RANGES as Record<string, { hourly: number; low: number; high: number }>)[categorySlug] || CATEGORY_RATE_RANGES.other;
        const hourly = Math.round(range.hourly / 100);
        return { hourly: hourly.toString(), day: (hourly * 8).toString() };
    };

    // Auto-populate rates when city changes or trades selected if not set
    useEffect(() => {
        if (city) {
            const newRates = { ...rates };
            let changed = false;

            selectedTrades.forEach(t => {
                if (!newRates[t]) {
                    newRates[t] = getRecommendedRate(t);
                    changed = true;
                }
            });

            if (changed) {
                setRates(newRates);
            }
        }
    }, [city, selectedTrades]);

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

            // First update profile location
            await fetch('/api/contractor/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${cleanToken}`
                },
                body: JSON.stringify({ city, radiusMiles: radius })
            });

            const servicesData = selectedTrades.map(tradeId => {
                const r = rates[tradeId] || getRecommendedRate(tradeId);
                return {
                    trade: tradeId,
                    hourlyRatePence: (parseFloat(r.hourly) || 0) * 100,
                    dayRatePence: (parseFloat(r.day) || 0) * 100
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

                // Upload verification docs if present
                if ((insuranceFile || dbsFile || idFile) && !verificationSkipped) {
                    try {
                        const uploadDoc = async (file: File, type: string) => {
                            const formData = new FormData();
                            formData.append('document', file);
                            const uploadRes = await fetch('/api/contractor/media/verification-upload', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${cleanToken}` },
                                body: formData
                            });
                            if (!uploadRes.ok) throw new Error(`Failed to upload ${type}`);
                            return (await uploadRes.json()).url;
                        };

                        const updates: any = {};
                        if (insuranceFile) {
                            updates.publicLiabilityInsuranceUrl = await uploadDoc(insuranceFile, 'insurance');
                            if (insuranceExpiry) updates.publicLiabilityExpiryDate = new Date(insuranceExpiry).toISOString();
                        }
                        if (dbsFile) updates.dbsCertificateUrl = await uploadDoc(dbsFile, 'DBS');
                        if (idFile) updates.identityDocumentUrl = await uploadDoc(idFile, 'ID');

                        updates.verificationStatus = (insuranceFile && dbsFile && idFile) ? 'pending' : 'unverified';

                        // Save document URLs to profile
                        await fetch('/api/contractor/profile', {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${cleanToken}`
                            },
                            body: JSON.stringify(updates)
                        });

                    } catch (uploadError) {
                        console.error("[Onboarding] Document upload failed:", uploadError);
                        // Don't block success, just log error - user can retry in dashboard
                        toast({
                            title: "Document Upload Failed",
                            description: "Your account is created but some documents failed to upload. Please try again in your dashboard.",
                            variant: "destructive"
                        });
                    }
                }

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

            setLocation('/contractor/dashboard?welcome=true');
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
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-5 pointer-events-none">
                <div className="absolute inset-0" style={{
                    backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                    backgroundSize: '40px 40px'
                }} />
            </div>

            {/* Progress */}
            <div className="w-full max-w-2xl mb-8 relative z-10">
                <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${step >= 1 ? 'text-amber-400' : 'text-slate-600'}`}>Location</span>
                    <span className={`text-sm font-medium ${step >= 2 ? 'text-amber-400' : 'text-slate-600'}`}>Services</span>
                    <span className={`text-sm font-medium ${step >= 3 ? 'text-amber-400' : 'text-slate-600'}`}>Rates</span>
                    <span className={`text-sm font-medium ${step >= 4 ? 'text-amber-400' : 'text-slate-600'}`}>Verify</span>
                    <span className={`text-sm font-medium ${step >= 5 ? 'text-amber-400' : 'text-slate-600'}`}>Review</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-amber-500 transition-all duration-500 ease-out"
                        style={{ width: `${(step / 5) * 100}%` }}
                    />
                </div>
            </div>

            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-2xl p-8 shadow-2xl relative overflow-hidden z-10">

                {/* Background Decor */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

                {/* STEP 1: LOCATION */}
                {step === 1 && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <MapPin className="w-8 h-8 text-blue-400" />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Where are you based?</h1>
                            <p className="text-slate-400">We'll recommend rates based on your area.</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                            {['Derby', 'Leicester', 'Nottingham'].map(c => (
                                <button
                                    key={c}
                                    onClick={() => setCity(c)}
                                    className={`p-4 rounded-xl border transition-all text-center group relative overflow-hidden ${city === c
                                        ? 'bg-amber-500 border-amber-500 text-slate-900 shadow-lg shadow-amber-500/20'
                                        : 'bg-slate-900/50 border-white/10 text-slate-400 hover:bg-slate-800/50 hover:border-white/20'
                                        }`}
                                >
                                    <span className="font-bold text-sm block">{c}</span>
                                    {city === c && (
                                        <div className="absolute top-2 right-2">
                                            <div className="w-4 h-4 bg-slate-900/20 rounded-full flex items-center justify-center">
                                                <Check className="w-2.5 h-2.5 text-slate-900" />
                                            </div>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Map & Radius Control */}
                        <div className="bg-slate-900/50 rounded-xl border border-white/10 overflow-hidden mb-6 relative">
                            <div className="h-64 w-full relative z-0">
                                {profile?.profile?.latitude && profile?.profile?.longitude ? (
                                    <MapContainer
                                        center={[parseFloat(profile.profile.latitude), parseFloat(profile.profile.longitude)]}
                                        zoom={9}
                                        style={{ height: "100%", width: "100%" }}
                                        zoomControl={false}
                                        dragging={false} // Keep it simple for now, or true if we want them to pan
                                    >
                                        <TileLayer
                                            attribution='&copy; OpenStreetMap'
                                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        />
                                        <Marker position={[parseFloat(profile.profile.latitude), parseFloat(profile.profile.longitude)]} />
                                        <Circle
                                            center={[parseFloat(profile.profile.latitude), parseFloat(profile.profile.longitude)]}
                                            radius={radius * 1609.34}
                                            pathOptions={{ fillColor: '#f59e0b', color: '#f59e0b', fillOpacity: 0.2, weight: 1 }}
                                        />
                                    </MapContainer>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                                        Map unavailable (Location not set)
                                    </div>
                                )}

                                {/* Overlay Radius Control */}
                                <div className="absolute bottom-4 left-4 right-4 bg-slate-900/90 backdrop-blur-md border border-white/10 p-4 rounded-xl z-[400]">
                                    <label className="text-white text-sm font-medium flex items-center justify-between mb-3">
                                        <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-amber-500" /> Service Radius</span>
                                        <span className="text-amber-400 font-bold">{radius} miles</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="1"
                                        max="50"
                                        value={radius}
                                        onChange={(e) => setRadius(parseInt(e.target.value))}
                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                    />
                                </div>
                            </div>
                        </div>



                        <div className="flex justify-center">
                            <button
                                onClick={() => setStep(2)}
                                disabled={!city}
                                className="px-8 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            >
                                Next: Select Services <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
                {/* STEP 2: SERVICES */}
                {step === 2 && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Wrench className="w-8 h-8 text-emerald-400" />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">What services do you offer?</h1>
                            <p className="text-slate-400">Select all that apply.</p>
                        </div>

                        <div className="space-y-3 mb-8">
                            {BROAD_TRADES.map(trade => {
                                const isExpanded = expandedTrades.includes(trade.id);
                                const categories = TRADE_CATEGORIES[trade.id] || [];
                                const selectedCount = categories.filter(c => selectedTrades.includes(c)).length;

                                return (
                                    <div key={trade.id} className="rounded-xl border border-white/10 overflow-hidden">
                                        <button
                                            onClick={() => setExpandedTrades(prev =>
                                                prev.includes(trade.id) ? prev.filter(t => t !== trade.id) : [...prev, trade.id]
                                            )}
                                            className={`w-full p-4 flex items-center justify-between text-left transition-colors ${
                                                selectedCount > 0 ? 'bg-amber-500/10' : 'bg-slate-900/50 hover:bg-slate-800/50'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-xl">{trade.icon}</span>
                                                <span className="font-bold text-white">{trade.label}</span>
                                                {selectedCount > 0 && (
                                                    <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-full">
                                                        {selectedCount}
                                                    </span>
                                                )}
                                            </div>
                                            {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                                        </button>

                                        {isExpanded && (
                                            <div className="px-4 pb-4 pt-2 border-t border-white/5 space-y-2">
                                                {categories.map(catSlug => {
                                                    const isSelected = selectedTrades.includes(catSlug);
                                                    const label = (CATEGORY_LABELS as Record<string, string>)[catSlug] || catSlug;
                                                    return (
                                                        <button
                                                            key={catSlug}
                                                            onClick={() => {
                                                                if (isSelected) {
                                                                    setSelectedTrades(prev => prev.filter(t => t !== catSlug));
                                                                } else {
                                                                    const rec = getRecommendedRate(catSlug);
                                                                    setRates(prev => ({ ...prev, [catSlug]: rec }));
                                                                    setSelectedTrades(prev => [...prev, catSlug]);
                                                                }
                                                            }}
                                                            className={`w-full p-3 rounded-lg border text-left text-sm transition-all flex items-center justify-between ${
                                                                isSelected
                                                                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                                                                    : 'border-white/5 text-slate-400 hover:border-white/10'
                                                            }`}
                                                        >
                                                            <span>{label}</span>
                                                            {isSelected && <Check className="w-4 h-4" />}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex justify-between items-center">
                            <button onClick={() => setStep(1)} className="text-slate-400 hover:text-white px-4">Back</button>
                            <button
                                onClick={() => setStep(3)}
                                disabled={selectedTrades.length === 0}
                                className="px-8 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            >
                                Next: Set Rates <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: RATES */}
                {step === 3 && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <Coins className="w-8 h-8 text-amber-400" />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Set your rates</h1>
                            <p className="text-slate-400 mb-4">Configure pricing for each service.</p>
                            <div className="flex justify-center">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-medium text-blue-300">
                                    <Sparkles className="w-3 h-3" />
                                    Market rates recommended by Perplexity
                                </span>
                            </div>
                        </div>

                        <div className="space-y-6 mb-8 max-h-[50vh] overflow-y-auto pr-2">
                            {selectedTrades.map(tradeId => {
                                const trade = tradesList.find(t => t.id === tradeId);
                                const rate = rates[tradeId] || { hourly: '60', day: '400' };

                                return (
                                    <div key={tradeId} className="bg-slate-900/50 rounded-xl border border-white/10 p-5">
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
                                                        placeholder={getRecommendedRate(tradeId).hourly}
                                                        onChange={(e) => setRates(prev => ({
                                                            ...prev,
                                                            [tradeId]: { ...rate, hourly: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-800 rounded-lg py-2 pl-7 pr-3 text-white font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                                                        placeholder={getRecommendedRate(tradeId).day}
                                                        onChange={(e) => setRates(prev => ({
                                                            ...prev,
                                                            [tradeId]: { ...rate, day: e.target.value }
                                                        }))}
                                                        className="w-full bg-slate-800 rounded-lg py-2 pl-7 pr-3 text-white font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex justify-between items-center">
                            <button onClick={() => setStep(2)} className="text-slate-400 hover:text-white px-4">Back</button>
                            <button
                                onClick={() => setStep(4)}
                                className="px-8 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
                            >
                                Review <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 4: VERIFICATION */}
                {step === 4 && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <ShieldCheck className="w-8 h-8 text-blue-400" />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Get Verified</h1>
                            <p className="text-slate-400 mb-4">Upload your documents to get the "Handy Verified" badge.</p>
                            <div className="flex justify-center">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs font-medium text-amber-300">
                                    <Sparkles className="w-3 h-3" />
                                    Verified pros get 3x more jobs
                                </span>
                            </div>
                        </div>

                        <div className="space-y-6 mb-8 max-h-[50vh] overflow-y-auto pr-2">
                            {/* Public Liability Insurance */}
                            <div className="bg-slate-900/50 rounded-xl border border-white/10 p-5">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-white font-bold text-lg flex items-center gap-2">
                                            Public Liability Insurance
                                        </h3>
                                        <p className="text-xs text-slate-400">Required: Certificate of Insurance</p>
                                    </div>
                                    {insuranceFile && <Check className="w-5 h-5 text-green-500" />}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">Expiry Date</label>
                                        <input
                                            type="date"
                                            value={insuranceExpiry}
                                            onChange={(e) => setInsuranceExpiry(e.target.value)}
                                            className="w-full bg-slate-800 rounded-lg py-2 px-3 text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">Upload Document</label>
                                        <div className="relative">
                                            <input
                                                type="file"
                                                accept=".pdf,.jpg,.jpeg,.png"
                                                onChange={(e) => setInsuranceFile(e.target.files?.[0] || null)}
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            />
                                            <div className="w-full bg-slate-800 rounded-lg py-2 px-3 text-white flex items-center justify-between border border-dashed border-slate-600 hover:border-amber-500 transition-colors">
                                                <span className="truncate text-sm">{insuranceFile ? insuranceFile.name : "Select PDF or Image..."}</span>
                                                <Upload className="w-4 h-4 text-slate-400" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* DBS & ID */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-slate-900/50 rounded-xl border border-white/10 p-5">
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="text-white font-bold">DBS Check</h3>
                                        {dbsFile && <Check className="w-4 h-4 text-green-500" />}
                                    </div>
                                    <div className="relative mt-4">
                                        <input
                                            type="file"
                                            accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setDbsFile(e.target.files?.[0] || null)}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        <div className="w-full bg-slate-800 rounded-lg py-3 px-3 text-white flex items-center justify-center gap-2 border border-dashed border-slate-600 hover:border-amber-500 transition-colors cursor-pointer">
                                            <FileText className="w-4 h-4 text-slate-400" />
                                            <span className="truncate text-sm font-medium">{dbsFile ? "Change File" : "Upload Check"}</span>
                                        </div>
                                        {dbsFile && <p className="text-center text-xs text-slate-400 mt-2 truncate">{dbsFile.name}</p>}
                                    </div>
                                </div>

                                <div className="bg-slate-900/50 rounded-xl border border-white/10 p-5">
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="text-white font-bold">Photo ID</h3>
                                        {idFile && <Check className="w-4 h-4 text-green-500" />}
                                    </div>
                                    <div className="relative mt-4">
                                        <input
                                            type="file"
                                            accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setIdFile(e.target.files?.[0] || null)}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        <div className="w-full bg-slate-800 rounded-lg py-3 px-3 text-white flex items-center justify-center gap-2 border border-dashed border-slate-600 hover:border-amber-500 transition-colors cursor-pointer">
                                            <FileText className="w-4 h-4 text-slate-400" />
                                            <span className="truncate text-sm font-medium">{idFile ? "Change File" : "Upload ID"}</span>
                                        </div>
                                        {idFile && <p className="text-center text-xs text-slate-400 mt-2 truncate">{idFile.name}</p>}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center">
                            <button onClick={() => setStep(3)} className="text-slate-400 hover:text-white px-4">Back</button>
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => {
                                        setVerificationSkipped(true);
                                        setStep(5);
                                    }}
                                    className="text-slate-400 hover:text-white text-sm"
                                >
                                    Skip for now
                                </button>
                                <button
                                    onClick={() => {
                                        setVerificationSkipped(false);
                                        setStep(5);
                                    }}
                                    className="px-8 py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-2"
                                >
                                    Review <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}


                {/* STEP 5: REVIEW */}
                {step === 5 && (
                    <div className="animate-in fade-in slide-in-from-right-8 duration-500 text-center">
                        <div className="inline-flex w-16 h-16 bg-amber-500/20 rounded-2xl items-center justify-center mb-4">
                            <Sparkles className="w-8 h-8 text-amber-400" />
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">Ready to launch?</h1>
                        <p className="text-slate-400 mb-8">We'll generate your services and open your dashboard.</p>

                        {/* Toolbox Animation Reinstated */}
                        <div className="w-48 h-32 mx-auto mb-6 bg-slate-800 rounded-lg flex items-center justify-center relative shadow-lg overflow-hidden border border-slate-700">
                            <div className="absolute inset-0 bg-gradient-to-tr from-slate-900 via-slate-800 to-amber-900/20" />
                            <Wrench className="w-12 h-12 text-amber-500 animate-bounce relative z-10" />
                            <div className="absolute bottom-2 left-2 right-2 h-1 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500 animate-accordion-up w-full" />
                            </div>
                        </div>

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
                            <button onClick={() => setStep(4)} className="text-slate-400 hover:text-white px-4 shrink-0" disabled={finishMutation.isPending}>Back</button>
                            <button
                                onClick={() => finishMutation.mutate()}
                                disabled={finishMutation.isPending}
                                className="w-full ml-4 py-3 bg-amber-500 text-slate-950 font-bold rounded-xl hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                            >
                                {finishMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Preparing your dashboard...
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
                            setLocation('/contractor/login');
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
