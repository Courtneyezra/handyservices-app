
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Eye, EyeOff, Loader2, Globe, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import SkillSelector from '../components/contractor/SkillSelector';
import { LocationRadiusSelector } from '../components/contractor/LocationRadiusSelector';
import { ConfettiTools } from '@/components/dashboard/ConfettiTools';

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

    // New Simplified Flow State
    const [availableCategories, setAvailableCategories] = useState<string[]>([]);
    const [selectedTrades, setSelectedTrades] = useState<string[]>([]);
    const [tradeRates, setTradeRates] = useState<Record<string, { hourly: string, day: string }>>({});

    // Fetch categories when reaching step 5
    useEffect(() => {
        if (step === 5 && availableCategories.length === 0) {
            const token = localStorage.getItem('contractorToken');

            fetch('/api/contractor/onboarding/capabilities', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
                .then(res => {
                    if (!res.ok) throw new Error("Failed to load trade categories");
                    return res.json();
                })
                .then(data => setAvailableCategories(Object.keys(data)))
                .catch(err => {
                    console.error("Failed to fetch categories", err);
                    setError("Could not load trade categories. Please refresh or try again.");
                });
        }
    }, [step]);

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
            if (selectedTrades.length === 0) {
                setError('Please select at least one trade.');
                return;
            }
            setStep(6);
            return;
        }

        if (step === 6) {
            // Validate rates
            const missingRates = selectedTrades.some(trade =>
                !tradeRates[trade]?.hourly || !tradeRates[trade]?.day
            );

            if (missingRates) {
                setError('Please enter both hourly and day rates for all selected trades.');
                return;
            }

            setIsLoading(true);
            try {
                const token = localStorage.getItem('contractorToken');
                const payload = {
                    trades: selectedTrades.map(trade => ({
                        category: trade,
                        hourlyRatePence: parseFloat(tradeRates[trade].hourly) * 100,
                        dayRatePence: parseFloat(tradeRates[trade].day) * 100
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
        <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col">
            {showConfetti && <ConfettiTools />}
            {/* Minimal Header */}
            <div className="h-16 flex items-center px-6 border-b border-slate-100">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#6C6CFF] flex items-center justify-center text-white font-bold text-lg">H</div>
                    <span className="font-bold text-xl tracking-tight">Handy</span>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col items-center pt-12 px-6 pb-20">
                <div className="w-full max-w-2xl space-y-8">

                    {/* Header Text */}
                    <div className="text-center space-y-2">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                            {step === 1 && "First, tell us about you"}
                            {step === 2 && "Secure your account"}
                            {step === 3 && "Name your workspace"}
                            {step === 4 && "Where are you based?"}
                            {step === 5 && "Select your trades"}
                            {step === 6 && "Set your standard rates"}
                        </h1>
                        <p className="text-slate-500">
                            {step === 1 && "We need these details to create your profile."}
                            {step === 2 && "Choose a strong password to keep your data safe."}
                            {step === 3 && "This will be the name of your digital office."}
                            {step === 4 && "We'll show you jobs within your service radius."}
                            {step === 5 && "Select all the trades you provide services for."}
                            {step === 6 && "You can adjust these later for specific jobs."}
                        </p>
                    </div>

                    {/* Progress Bar */}
                    <div className="flex gap-2 max-w-md mx-auto w-full">
                        {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-[#6C6CFF]" : "bg-slate-100"}`} />
                        ))}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-8 max-w-md mx-auto w-full">

                        {/* STEP 1: IDENTITY */}
                        {step === 1 && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">First Name</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={formData.firstName}
                                        onChange={handleChange('firstName')}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                        placeholder="e.g. John"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Last Name</label>
                                    <input
                                        type="text"
                                        value={formData.lastName}
                                        onChange={handleChange('lastName')}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                        placeholder="e.g. Smith"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email Address</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={handleChange('email')}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                        placeholder="john@example.com"
                                    />
                                </div>
                            </div>
                        )}

                        {/* STEP 2: SECURITY */}
                        {step === 2 && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
                                    <div className="relative">
                                        <input
                                            autoFocus
                                            type={showPassword ? "text" : "password"}
                                            value={formData.password}
                                            onChange={handleChange('password')}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
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
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Business Name</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={formData.businessName}
                                        onChange={handleChange('businessName')}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[#6C6CFF] focus:ring-4 focus:ring-[#6C6CFF]/10 outline-none transition-all"
                                        placeholder="e.g. Smith & Sons"
                                    />
                                </div>

                                {/* URL Preview */}
                                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                                    <div className="flex items-center text-sm text-slate-500 overflow-hidden">
                                        <Globe size={16} className="mr-2 text-slate-400 flex-shrink-0" />
                                        <span className="truncate">
                                            handy.com/
                                            <span className="text-slate-900 font-medium">
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
                                                <span className="text-emerald-600 flex items-center gap-1 text-xs font-bold bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">
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

                        {/* STEP 5: TRADES */}
                        {step === 5 && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                                <div className="grid grid-cols-2 gap-3">
                                    {availableCategories.map(appCat => (
                                        <button
                                            key={appCat}
                                            type="button"
                                            onClick={() => {
                                                setSelectedTrades(prev => {
                                                    const isSelected = prev.includes(appCat);
                                                    if (isSelected) {
                                                        return prev.filter(c => c !== appCat);
                                                    } else {
                                                        // Tiered Random Rates
                                                        let minH = 30, maxH = 45;
                                                        let minD = 190, maxD = 230;

                                                        const cat = appCat.toLowerCase();
                                                        if (cat.includes('plumb') || cat.includes('elec') || cat.includes('gas')) {
                                                            // High Tier: Plumbing, Electrical
                                                            minH = 55; maxH = 75;
                                                            minD = 350; maxD = 450;
                                                        } else if (cat.includes('join') || cat.includes('carp') || cat.includes('til') || cat.includes('brick')) {
                                                            // Mid Tier: Joinery, Tiling
                                                            minH = 40; maxH = 60;
                                                            minD = 250; maxD = 350;
                                                        } else {
                                                            // Base Tier: Handyman, Decorating, Flatpack
                                                            minH = 30; maxH = 45;
                                                            minD = 190; maxD = 250;
                                                        }

                                                        const randomHourly = Math.floor(Math.random() * (maxH - minH + 1)) + minH;
                                                        const randomDay = Math.floor(Math.random() * (maxD - minD + 1)) + minD;

                                                        setTradeRates(rates => ({
                                                            ...rates,
                                                            [appCat]: {
                                                                hourly: randomHourly.toString(),
                                                                day: randomDay.toString()
                                                            }
                                                        }));

                                                        return [...prev, appCat];
                                                    }
                                                });
                                            }}
                                            className={`p-4 rounded-xl border-2 text-left transition-all ${selectedTrades.includes(appCat)
                                                ? 'border-[#6C6CFF] bg-[#6C6CFF]/5'
                                                : 'border-slate-100 hover:border-slate-200'
                                                }`}
                                        >
                                            <span className={`font-semibold ${selectedTrades.includes(appCat) ? 'text-[#6C6CFF]' : 'text-slate-700'}`}>
                                                {appCat}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* STEP 6: RATES */}
                        {step === 6 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500">
                                {selectedTrades.map(trade => (
                                    <div key={trade} className="p-4 rounded-xl border border-slate-200 space-y-3">
                                        <h3 className="font-semibold text-slate-800">{trade} Rates</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 mb-1">Hourly (£)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={tradeRates[trade]?.hourly || ''}
                                                    onChange={e => setTradeRates(prev => ({
                                                        ...prev,
                                                        [trade]: { ...prev[trade], hourly: e.target.value }
                                                    }))}
                                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-[#6C6CFF] outline-none"
                                                    placeholder="50"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 mb-1">Day Rate (£)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={tradeRates[trade]?.day || ''}
                                                    onChange={e => setTradeRates(prev => ({
                                                        ...prev,
                                                        [trade]: { ...prev[trade], day: e.target.value }
                                                    }))}
                                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-[#6C6CFF] outline-none"
                                                    placeholder="350"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
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
