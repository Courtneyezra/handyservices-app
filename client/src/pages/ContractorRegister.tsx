
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Eye, EyeOff, Loader2, Globe, CheckCircle2, AlertCircle, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import SkillSelector from '../components/contractor/SkillSelector';
import { LocationRadiusSelector } from '../components/contractor/LocationRadiusSelector';
import { ConfettiTools } from '@/components/dashboard/ConfettiTools';
import {
    BROAD_TRADES, TRADE_CATEGORIES, CATEGORY_LABELS, CATEGORY_RATE_RANGES,
    type BroadTradeId, type JobCategory
} from '@shared/categories';

// Derive rate config from shared categories (convert pence to pounds for UI)
function getCategoryRateConfig(slug: string) {
    const range = (CATEGORY_RATE_RANGES as Record<string, { hourly: number; low: number; high: number }>)[slug] || CATEGORY_RATE_RANGES.other;
    const hourlySweet = Math.round(range.hourly / 100);
    const hourlyLow = Math.round(range.low / 100);
    const hourlyHigh = Math.round(range.high / 100);
    return {
        min: hourlyLow,
        max: hourlyHigh,
        sweet: hourlySweet,
        dayMin: hourlyLow * 8,
        dayMax: hourlyHigh * 8,
        daySweet: hourlySweet * 8,
    };
}

export default function ContractorRegister() {
    const [, setLocation] = useLocation();

    // Steps: 1=Identity, 2=Security, 3=Business, 4=Location, 5=Trades, 6=Rates
    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Slug verification state
    const [isCheckingSlug, setIsCheckingSlug] = useState(false);
    const [slugAvailable, setSlugAvailable] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);

    // Form Data
    const [formData, setFormData] = useState({
        // Identity
        firstName: '',
        lastName: '',
        email: '',
        phone: '', // Optional for now

        // Security
        password: '',

        // Business
        businessName: '',
        slug: '',

        // Location (Step 4)
        address: '',
        city: '',
        postcode: '',
        latitude: 0,
        longitude: 0,
        radiusMiles: 10,
    });

    const [selectedSkills, setSelectedSkills] = useState<Array<{ skuId: string; proficiency: 'basic' | 'competent' | 'expert' }>>([]);

    // Two-tier trade/category selection state
    const [expandedTrades, setExpandedTrades] = useState<string[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]); // granular slugs
    const [selectedTrades, setSelectedTrades] = useState<string[]>([]); // kept for backward compat in validation
    const [tradeRates, setTradeRates] = useState<Record<string, { hourly: string, day: string }>>({}); // keyed by category slug

    // Sync selectedTrades from selectedCategories (for validation compat)
    useEffect(() => {
        const tradeIds = new Set<string>();
        for (const cat of selectedCategories) {
            for (const [tradeId, cats] of Object.entries(TRADE_CATEGORIES)) {
                if ((cats as readonly string[]).includes(cat)) tradeIds.add(tradeId);
            }
        }
        setSelectedTrades(Array.from(tradeIds));
    }, [selectedCategories]);

    const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (field === 'businessName') {
            const newSlug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            setFormData(prev => ({ ...prev, businessName: val, slug: newSlug }));
        } else {
            setFormData(prev => ({ ...prev, [field]: val }));
        }
        setError('');
    };

    // Check slug availability debounce
    useEffect(() => {
        const checkSlug = async () => {
            if (!formData.slug || formData.slug.length < 3) return;
            setIsCheckingSlug(true);
            try {
                const res = await fetch(`/api/contractor/check-slug?slug=${formData.slug}`);
                if (res.ok) {
                    const data = await res.json();
                    setSlugAvailable(data.available);
                } else {
                    setSlugAvailable(false);
                }
            } catch (err) {
                setSlugAvailable(false);
            } finally {
                setIsCheckingSlug(false);
            }
        };

        const timeout = setTimeout(checkSlug, 500);
        return () => clearTimeout(timeout);
    }, [formData.slug]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (step === 1) {
            if (!formData.firstName || !formData.lastName || !formData.email) {
                setError('Please fill in all details');
                return;
            }
            setStep(2);
            return;
        }

        if (step === 2) {
            if (formData.password.length < 8) {
                setError('Password must be at least 8 characters');
                return;
            }
            setStep(3);
            return;
        }

        if (step === 3) {
            if (!formData.businessName) {
                setError('Please enter a business name');
                return;
            }
            // Proceed to Location Step
            setStep(4);
            return;
        }

        if (step === 4) {
            if (!formData.address || !formData.latitude) {
                setError('Please select a valid address from the dropdown');
                return;
            }

            setIsLoading(true);
            try {
                const payload = {
                    firstName: formData.firstName,
                    lastName: formData.lastName,
                    email: formData.email,
                    password: formData.password,
                    businessName: formData.businessName,
                    slug: formData.slug,

                    // Location Data
                    postcode: formData.postcode || "SW1A 1AA",
                    city: formData.city,
                    phone: formData.phone || "00000000000",
                    radiusMiles: formData.radiusMiles,
                    latitude: formData.latitude,
                    longitude: formData.longitude,

                    bio: "New Contractor",
                    services: [] // No services initially, handled in next step
                };

                const registerRes = await fetch('/api/contractor/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!registerRes.ok) {
                    const errData = await registerRes.json();
                    throw new Error(errData.error || 'Registration failed');
                }

                const data = await registerRes.json();
                if (data.token) {
                    localStorage.setItem('contractorToken', data.token);
                    if (data.user) localStorage.setItem('contractorUser', JSON.stringify(data.user));
                    if (data.profileId) localStorage.setItem('contractorProfileId', data.profileId);
                }

                // Move to Skills Step instead of immediate redirect
                setIsLoading(false);
                setStep(5);

            } catch (err: any) {
                console.error(err);
                setError(err.message || 'Registration failed');
                setIsLoading(false);
            }
        }

        if (step === 5) {
            if (selectedCategories.length === 0) {
                setError('Please select at least one category.');
                return;
            }
            setStep(6);
            return;
        }

        if (step === 6) {
            // Validate rates
            const missingRates = selectedCategories.some(cat =>
                !tradeRates[cat]?.hourly || !tradeRates[cat]?.day
            );

            if (missingRates) {
                setError('Please enter both hourly and day rates for all selected categories.');
                return;
            }

            setIsLoading(true);
            try {
                const token = localStorage.getItem('contractorToken');
                const payload = {
                    trades: selectedCategories.map(cat => ({
                        category: cat,
                        categorySlug: cat,
                        hourlyRatePence: parseFloat(tradeRates[cat].hourly) * 100,
                        dayRatePence: parseFloat(tradeRates[cat].day) * 100
                    }))
                };

                const res = await fetch('/api/contractor/onboarding/trade-rates', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    console.error("Server Error Details:", errorData);
                    throw new Error(errorData.details || errorData.error || 'Failed to save rates');
                }

                // Success! Show Confetti
                setShowConfetti(true);

                // Short delay for confetti before redirect
                setTimeout(() => {
                    setLocation('/contractor/dashboard?welcome=true');
                }, 2500);

            } catch (err: any) {
                console.error(err);
                setError(err.message || 'Failed to save rates');
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="min-h-screen bg-[#0F172A] text-white font-sans flex flex-col">
            {showConfetti && <ConfettiTools />}
            {/* Minimal Header */}
            <div className="h-14 flex items-center justify-center border-b border-white/5 bg-[#0F172A]/95 backdrop-blur-sm">
                <div className="flex items-center gap-2.5">
                    <img src="/logo.png" alt="Handy" className="w-7 h-7 object-contain" />
                    <div className="flex flex-col leading-none">
                        <span className="font-bold text-base text-white">Handy</span>
                        <span className="font-normal text-[9px] text-slate-400 uppercase tracking-wider">Services</span>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col items-center pt-12 px-6 pb-20">
                <div className="w-full max-w-2xl space-y-8">

                    {/* Header Text */}
                    <div className="text-center space-y-2">
                        <h1 className="text-2xl font-bold tracking-tight text-white">
                            {step === 1 && "First, tell us about you"}
                            {step === 2 && "Secure your account"}
                            {step === 3 && "Name your workspace"}
                            {step === 4 && "Where are you based?"}
                            {step === 5 && "What do you do?"}
                            {step === 6 && "Set your fill-up rates"}
                        </h1>
                        <p className="text-slate-500">
                            {step === 1 && "We need these details to create your profile."}
                            {step === 2 && "Choose a strong password to keep your data safe."}
                            {step === 3 && "This will be the name of your digital office."}
                            {step === 4 && "We'll show you jobs within your service radius."}
                            {step === 5 && "Pick your trades, then select the specific jobs you handle."}
                            {step === 6 && "Set your fill-up rate per category. This is what you earn on spare days."}
                        </p>
                    </div>

                    {/* Progress Bar */}
                    <div className="flex gap-2 max-w-md mx-auto w-full">
                        {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-[#6C6CFF]" : "bg-slate-800"}`} />
                        ))}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-8 max-w-md mx-auto w-full">

                        {/* STEP 1: IDENTITY */}
                        {step === 1 && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-300 mb-1.5">First Name</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={formData.firstName}
                                        onChange={handleChange('firstName')}
                                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder:text-slate-500 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                        placeholder="e.g. John"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-300 mb-1.5">Last Name</label>
                                    <input
                                        type="text"
                                        value={formData.lastName}
                                        onChange={handleChange('lastName')}
                                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder:text-slate-500 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                        placeholder="e.g. Smith"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-300 mb-1.5">Email Address</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={handleChange('email')}
                                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder:text-slate-500 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                        placeholder="john@example.com"
                                    />
                                </div>
                            </div>
                        )}

                        {/* STEP 2: SECURITY */}
                        {step === 2 && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-300 mb-1.5">Password</label>
                                    <div className="relative">
                                        <input
                                            autoFocus
                                            type={showPassword ? "text" : "password"}
                                            value={formData.password}
                                            onChange={handleChange('password')}
                                            className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder:text-slate-500 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                            placeholder="Min. 8 characters"
                                        />
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STEP 3: BUSINESS */}
                        {step === 3 && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-300 mb-1.5">Business Name</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={formData.businessName}
                                        onChange={handleChange('businessName')}
                                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder:text-slate-500 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                        placeholder="e.g. Smith & Sons"
                                    />
                                </div>

                                {/* URL Preview */}
                                <div className="p-4 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-between">
                                    <div className="flex items-center text-sm text-slate-500 overflow-hidden">
                                        <Globe size={16} className="mr-2 text-slate-400 flex-shrink-0" />
                                        <span className="truncate">
                                            handy.com/
                                            <span className="text-white font-medium">
                                                {formData.slug || 'your-business'}
                                            </span>
                                        </span>
                                    </div>
                                    {/* Availability */}
                                    {formData.slug && (
                                        <div className="flex-shrink-0 ml-4">
                                            {isCheckingSlug ? (
                                                <Loader2 className="w-4 h-4 text-[#6C6CFF] animate-spin" />
                                            ) : slugAvailable ? (
                                                <span className="text-emerald-600 flex items-center gap-1 text-xs font-bold bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
                                                    <CheckCircle2 size={12} /> Available
                                                </span>
                                            ) : (
                                                <span className="text-red-600 flex items-center gap-1 text-xs font-bold bg-red-50 px-2 py-1 rounded-full border border-red-100">
                                                    <AlertCircle size={12} /> Taken
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* STEP 4: LOCATION */}
                        {step === 4 && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                                <LocationRadiusSelector
                                    value={{
                                        address: formData.address,
                                        city: formData.city,
                                        postcode: formData.postcode,
                                        latitude: formData.latitude,
                                        longitude: formData.longitude,
                                        radiusMiles: formData.radiusMiles
                                    }}
                                    onChange={(data) => setFormData(prev => ({ ...prev, ...data }))}
                                />
                            </div>
                        )}

                        {/* STEP 5: TWO-TIER TRADE & CATEGORY PICKER */}
                        {step === 5 && (
                            <div className="space-y-3 animate-in fade-in slide-in-from-right-8 duration-500">
                                {BROAD_TRADES.map(trade => {
                                    const isExpanded = expandedTrades.includes(trade.id);
                                    const categories = TRADE_CATEGORIES[trade.id] || [];
                                    const selectedCount = categories.filter(c => selectedCategories.includes(c)).length;

                                    return (
                                        <div key={trade.id} className="rounded-xl border border-slate-700 overflow-hidden">
                                            {/* Trade Header */}
                                            <button
                                                type="button"
                                                onClick={() => setExpandedTrades(prev =>
                                                    prev.includes(trade.id)
                                                        ? prev.filter(t => t !== trade.id)
                                                        : [...prev, trade.id]
                                                )}
                                                className={`w-full p-4 flex items-center justify-between text-left transition-colors ${
                                                    selectedCount > 0 ? 'bg-[#6C6CFF]/5' : 'bg-slate-900 hover:bg-slate-800'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xl">{trade.icon}</span>
                                                    <span className="font-semibold text-white">{trade.label}</span>
                                                    {selectedCount > 0 && (
                                                        <span className="text-xs font-medium text-[#6C6CFF] bg-[#6C6CFF]/10 px-2 py-0.5 rounded-full">
                                                            {selectedCount} selected
                                                        </span>
                                                    )}
                                                </div>
                                                {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                                            </button>

                                            {/* Sub-categories */}
                                            {isExpanded && (
                                                <div className="px-4 pb-4 pt-2 border-t border-slate-700 space-y-2">
                                                    {categories.map(catSlug => {
                                                        const isSelected = selectedCategories.includes(catSlug);
                                                        const label = CATEGORY_LABELS[catSlug] || catSlug;
                                                        return (
                                                            <button
                                                                key={catSlug}
                                                                type="button"
                                                                onClick={() => {
                                                                    if (isSelected) {
                                                                        setSelectedCategories(prev => prev.filter(c => c !== catSlug));
                                                                        setTradeRates(prev => {
                                                                            const next = { ...prev };
                                                                            delete next[catSlug];
                                                                            return next;
                                                                        });
                                                                    } else {
                                                                        const config = getCategoryRateConfig(catSlug);
                                                                        setSelectedCategories(prev => [...prev, catSlug]);
                                                                        setTradeRates(prev => ({
                                                                            ...prev,
                                                                            [catSlug]: {
                                                                                hourly: config.sweet.toString(),
                                                                                day: config.daySweet.toString(),
                                                                            }
                                                                        }));
                                                                    }
                                                                }}
                                                                className={`w-full p-3 rounded-lg border text-left text-sm transition-all flex items-center justify-between ${
                                                                    isSelected
                                                                        ? 'border-[#6C6CFF] bg-[#6C6CFF]/5 text-[#6C6CFF] font-medium'
                                                                        : 'border-slate-700 text-slate-600 hover:border-slate-700'
                                                                }`}
                                                            >
                                                                <span>{label}</span>
                                                                {isSelected && <CheckCircle2 size={16} />}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {selectedCategories.length > 0 && (
                                    <p className="text-xs text-slate-400 text-center mt-2">
                                        {selectedCategories.length} categor{selectedCategories.length === 1 ? 'y' : 'ies'} selected across {selectedTrades.length} trade{selectedTrades.length === 1 ? '' : 's'}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* STEP 6: RATES WITH WARM SPOT */}
                        {step === 6 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
                                {selectedCategories.map(trade => {
                                    const config = getCategoryRateConfig(trade);
                                    const hourlyVal = parseFloat(tradeRates[trade]?.hourly || '0');
                                    const dayVal = parseFloat(tradeRates[trade]?.day || '0');
                                    const hourlyPercent = Math.max(0, Math.min(100, ((hourlyVal - config.min) / (config.max - config.min)) * 100));
                                    const sweetPercent = ((config.sweet - config.min) / (config.max - config.min)) * 100;
                                    const daySweetPercent = ((config.daySweet - config.dayMin) / (config.dayMax - config.dayMin)) * 100;
                                    const dayPercent = Math.max(0, Math.min(100, ((dayVal - config.dayMin) / (config.dayMax - config.dayMin)) * 100));
                                    const isNearSweet = Math.abs(hourlyVal - config.sweet) <= 5;

                                    return (
                                        <div key={trade} className="p-4 rounded-xl border border-slate-700 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-semibold text-white">{(CATEGORY_LABELS as Record<string, string>)[trade] || trade}</h3>
                                                {isNearSweet && (
                                                    <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                        <CheckCircle2 size={10} /> Popular rate
                                                    </span>
                                                )}
                                            </div>

                                            {/* Hourly Rate */}
                                            <div>
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <label className="text-xs font-medium text-slate-500">Hourly Rate</label>
                                                    <div className="text-lg font-bold text-white">£{tradeRates[trade]?.hourly || '0'}<span className="text-xs font-normal text-slate-400">/hr</span></div>
                                                </div>

                                                {/* Slider with warm zone */}
                                                <div className="relative">
                                                    {/* Warm zone background */}
                                                    <div
                                                        className="absolute top-[9px] h-2 bg-emerald-100 rounded-full pointer-events-none z-0"
                                                        style={{
                                                            left: `${Math.max(0, sweetPercent - 10)}%`,
                                                            width: '20%',
                                                        }}
                                                    />
                                                    {/* Sweet spot tick */}
                                                    <div
                                                        className="absolute top-[7px] h-3 w-0.5 bg-emerald-400 rounded-full pointer-events-none z-10"
                                                        style={{ left: `${sweetPercent}%` }}
                                                    />
                                                    <input
                                                        type="range"
                                                        min={config.min}
                                                        max={config.max}
                                                        step={1}
                                                        value={hourlyVal || config.sweet}
                                                        onChange={e => setTradeRates(prev => ({
                                                            ...prev,
                                                            [trade]: { ...prev[trade], hourly: e.target.value }
                                                        }))}
                                                        className="w-full h-5 appearance-none bg-transparent relative z-20 cursor-pointer [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-800 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6C6CFF] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:-mt-1.5"
                                                    />
                                                </div>
                                                <div className="flex justify-between text-[10px] text-slate-300 mt-0.5">
                                                    <span>£{config.min}</span>
                                                    <span className="text-emerald-500 font-medium">Most choose ~£{config.sweet}</span>
                                                    <span>£{config.max}</span>
                                                </div>
                                            </div>

                                            {/* Day Rate */}
                                            <div>
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <label className="text-xs font-medium text-slate-500">Day Rate</label>
                                                    <div className="text-lg font-bold text-white">£{tradeRates[trade]?.day || '0'}<span className="text-xs font-normal text-slate-400">/day</span></div>
                                                </div>

                                                {/* Slider with warm zone */}
                                                <div className="relative">
                                                    <div
                                                        className="absolute top-[9px] h-2 bg-emerald-100 rounded-full pointer-events-none z-0"
                                                        style={{
                                                            left: `${Math.max(0, daySweetPercent - 10)}%`,
                                                            width: '20%',
                                                        }}
                                                    />
                                                    <div
                                                        className="absolute top-[7px] h-3 w-0.5 bg-emerald-400 rounded-full pointer-events-none z-10"
                                                        style={{ left: `${daySweetPercent}%` }}
                                                    />
                                                    <input
                                                        type="range"
                                                        min={config.dayMin}
                                                        max={config.dayMax}
                                                        step={5}
                                                        value={dayVal || config.daySweet}
                                                        onChange={e => setTradeRates(prev => ({
                                                            ...prev,
                                                            [trade]: { ...prev[trade], day: e.target.value }
                                                        }))}
                                                        className="w-full h-5 appearance-none bg-transparent relative z-20 cursor-pointer [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-800 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#6C6CFF] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:-mt-1.5"
                                                    />
                                                </div>
                                                <div className="flex justify-between text-[10px] text-slate-300 mt-0.5">
                                                    <span>£{config.dayMin}</span>
                                                    <span className="text-emerald-500 font-medium">Most choose ~£{config.daySweet}</span>
                                                    <span>£{config.dayMax}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Error Message */}
                        {error && (
                            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm flex items-center gap-2">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        {/* Submit Button */}
                        <div className="pt-4">
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full py-4 bg-[#6C6CFF] hover:bg-[#5858E0] active:scale-[0.98] transition-all text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                            >
                                {isLoading ? (
                                    <Loader2 className="animate-spin" />
                                ) : (
                                    <>
                                        {step === 6 ? "Finish Setup" : "Continue"}
                                        <ArrowRight size={20} className="opacity-80" />
                                    </>
                                )}
                            </button>
                        </div>

                    </form>
                </div>

                {/* Footer Link */}
                <div className="mt-auto py-8">
                    <button onClick={() => setLocation('/contractor/login')} className="text-slate-400 font-medium text-sm hover:text-[#6C6CFF] transition-colors">
                        Already have an account? Log in
                    </button>
                </div>
            </div>
        </div>
    );
}
