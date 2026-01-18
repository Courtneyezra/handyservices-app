import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Eye, EyeOff, Loader2, Globe, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

export default function ContractorRegister() {
    const [, setLocation] = useLocation();

    // Steps: 1=Identity, 2=Security, 3=Business
    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Slug verification state
    const [isCheckingSlug, setIsCheckingSlug] = useState(false);
    const [slugAvailable, setSlugAvailable] = useState(false);

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
    });

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
                // Simulate API call delay
                setTimeout(() => {
                    setSlugAvailable(true); // Mock success
                    setIsCheckingSlug(false);
                }, 500);
            } catch (err) {
                setSlugAvailable(false);
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

            setIsLoading(true);
            try {
                const payload = {
                    firstName: formData.firstName,
                    lastName: formData.lastName,
                    email: formData.email,
                    password: formData.password,
                    businessName: formData.businessName,
                    slug: formData.slug,
                    // Defaults for "Software Only" mode
                    postcode: "SW1A 1AA", // Default until profile completion
                    phone: formData.phone || "00000000000",
                    radiusMiles: 10,
                    bio: "New Contractor",
                    services: [] // No services initially
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

                setTimeout(() => {
                    setIsLoading(false);
                    setLocation('/contractor/dashboard?welcome=true');
                }, 1000);

            } catch (err: any) {
                console.error(err);
                setError(err.message || 'Registration failed');
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col">
            {/* Minimal Header */}
            <div className="h-16 flex items-center px-6 border-b border-slate-100">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#6C6CFF] flex items-center justify-center text-white font-bold text-lg">H</div>
                    <span className="font-bold text-xl tracking-tight">Handy</span>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col items-center pt-12 px-6">
                <div className="w-full max-w-md space-y-8">

                    {/* Header Text */}
                    <div className="text-center space-y-2">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                            {step === 1 && "First, tell us about you"}
                            {step === 2 && "Secure your account"}
                            {step === 3 && "Name your workspace"}
                        </h1>
                        <p className="text-slate-500">
                            {step === 1 && "We need these details to create your profile."}
                            {step === 2 && "Choose a strong password to keep your data safe."}
                            {step === 3 && "This will be the name of your digital office."}
                        </p>
                    </div>

                    {/* Progress Bar */}
                    <div className="flex gap-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-[#6C6CFF]" : "bg-slate-100"}`} />
                        ))}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">

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

                        {/* Error Message */}
                        {error && (
                            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm flex items-center gap-2">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-4 bg-[#6C6CFF] hover:bg-[#5858E0] active:scale-[0.98] transition-all text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <Loader2 className="animate-spin" />
                            ) : (
                                <>
                                    {step < 3 ? "Continue" : "Create Account"}
                                    <ArrowRight size={20} className="opacity-80" />
                                </>
                            )}
                        </button>

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
