import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Mail, Lock, Eye, EyeOff, ArrowRight, User, Phone, MapPin, Globe, Upload, Check, Loader2, X, Sparkles, FileText, CalendarClock } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

export default function ContractorRegister() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();

    // Steps: 0=Intro, 1=Claim URL, 2=Account Detail, 3=Branding
    const [step, setStep] = useState(0); // Start at 0 now
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // Form Data
    const [formData, setFormData] = useState({
        // Step 1: Claim
        slug: '',

        // Step 2: Account
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',

        // Step 3: Branding
        bio: '',
        postcode: '',
        heroImage: null as File | null,
        heroImageUrl: '', // For preview
        website: ''
    });

    const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [field]: e.target.value });
        setError('');
    };

    const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        setFormData({ ...formData, slug: val });
        setError('');
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            // Create preview URL
            const previewUrl = URL.createObjectURL(file);
            setFormData({
                ...formData,
                heroImage: file,
                heroImageUrl: previewUrl
            });
        }
    };

    // Validation
    const validateStep1 = () => {
        if (!formData.slug.trim()) {
            setError('Please choose a handle for your URL');
            return false;
        }
        if (formData.slug.length < 3) {
            setError('Handle must be at least 3 characters');
            return false;
        }
        return true;
    };

    const validateStep2 = () => {
        if (!formData.firstName || !formData.lastName || !formData.email || !formData.password) {
            setError('Please fill in all required fields');
            return false;
        }
        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return false;
        }
        if (formData.password.length < 8) {
            setError('Password must be at least 8 characters');
            return false;
        }
        return true;
    };

    // Final Submission
    const handleFinalSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            // 1. Register User
            const registerRes = await fetch('/api/contractor/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    firstName: formData.firstName,
                    lastName: formData.lastName,
                    email: formData.email,
                    phone: formData.phone,
                    postcode: formData.postcode, // Optional at this stage
                    password: formData.password,
                }),
            });

            const authData = await registerRes.json();
            if (!registerRes.ok) throw new Error(authData.error || 'Registration failed');

            // Store Auth
            const token = authData.token;
            localStorage.setItem('contractorToken', token);
            localStorage.setItem('contractorUser', JSON.stringify(authData.user));
            localStorage.setItem('contractorProfileId', authData.profileId);

            // 2. Upload Image (if exists)
            let uploadedImageUrl = '';
            if (formData.heroImage) {
                const imageFormData = new FormData();
                imageFormData.append('heroImage', formData.heroImage);

                const uploadRes = await fetch('/api/contractor/media/hero-upload', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: imageFormData,
                });

                if (uploadRes.ok) {
                    const uploadData = await uploadRes.json();
                    uploadedImageUrl = uploadData.url;
                }
            }

            // 3. Update Profile (Slug, Bio, Public=true, Image)
            const updateRes = await fetch('/api/contractor/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    slug: formData.slug,
                    bio: formData.bio,
                    heroImageUrl: uploadedImageUrl || undefined,
                    publicProfileEnabled: true, // Enable automatically!
                    postcode: formData.postcode || undefined,
                    socialLinks: formData.website ? { website: formData.website } : undefined
                }),
            });

            if (!updateRes.ok) throw new Error('Failed to set up profile');

            // Success! Redirect to onboarding wizard
            toast({
                title: "Welcome aboard!",
                description: "Let's set up your services.",
            });
            setLocation('/contractor/onboarding');

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Something went wrong');
            // If registered but failed later, they might still be able to login, but let's just show error.
            if (localStorage.getItem('contractorToken')) {
                // Determine recovery? For now just stay here.
                // Or redirect to dashboard anyway if registration worked?
                // Let's redirect to dashboard if registration succeeded so they aren't stuck.
                if (err.message !== 'Registration failed') {
                    setLocation('/contractor/onboarding');
                }
            }
        } finally {
            setIsLoading(false);
        }
    };

    const nextStep = () => {
        if (step === 1 && validateStep1()) setStep(2);
        else if (step === 2 && validateStep2()) setStep(3);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-5 pointer-events-none">
                <div className="absolute inset-0" style={{
                    backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                    backgroundSize: '40px 40px'
                }} />
            </div>

            <div className="relative w-full max-w-5xl grid md:grid-cols-2 gap-8 items-center">

                {/* Left Side: The "Product" Preview */}
                <div className="hidden md:block">
                    <div className="relative">
                        {/* Blob */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/20 rounded-full blur-3xl" />

                        {/* Mockup Card */}
                        <div className={`relative bg-slate-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all duration-700 ${step === 0 ? 'scale-100 rotate-0' : 'scale-95 rotate-[-2deg]'}`}>
                            {/* Fake Browser Header */}
                            <div className="bg-slate-800 p-3 border-b border-white/5 flex items-center gap-2">
                                <div className="flex gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
                                </div>
                                <div className="flex-1 text-center">
                                    <div className="bg-slate-900/50 rounded-md px-3 py-1 text-[10px] text-slate-400 font-mono inline-block">
                                        handy.com/handy/<span className="text-amber-400">{formData.slug || 'your-name'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Hero Image Area */}
                            <div className="h-40 bg-slate-800/50 relative">
                                {formData.heroImageUrl ? (
                                    <img src={formData.heroImageUrl} className="w-full h-full object-cover" alt="Cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                                        {step === 0 ? (
                                            <div className="text-center">
                                                <Globe className="w-12 h-12 mx-auto mb-2 text-amber-500/50" />
                                            </div>
                                        ) : (
                                            <Upload className="w-8 h-8 opacity-50" />
                                        )}
                                    </div>
                                )}
                                <div className="absolute -bottom-10 left-6">
                                    <div className="w-20 h-20 rounded-xl bg-slate-800 border-4 border-slate-900 flex items-center justify-center text-slate-500">
                                        <User className="w-10 h-10" />
                                    </div>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="pt-12 px-6 pb-6">
                                <h1 className="text-xl font-bold text-white mb-1">
                                    {formData.firstName || 'Your Name'} {formData.lastName || ''}
                                </h1>
                                <p className="text-slate-400 text-sm mb-4">
                                    {formData.bio || (step === 0 ? 'Accept bookings, manage quotes, and grow your skilled trade business automatically.' : 'Your professional bio will appear here to attract new clients.')}
                                </p>
                                <div className="flex gap-2">
                                    <div className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-lg border border-emerald-500/20">
                                        Verified Pro
                                    </div>
                                    <div className="px-3 py-1.5 bg-amber-500/10 text-amber-400 text-xs rounded-lg border border-amber-500/20">
                                        Available Today
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Caption */}
                        <div className="text-center mt-8">
                            <h2 className="text-2xl font-bold text-white mb-2">
                                {step === 0 ? "Everything you need to grow" : "Build your digital presence"}
                            </h2>
                            <p className="text-slate-400">
                                {step === 0 ? "Stop chasing invoices and missed calls." : "Claim your professional URL and start accepting bookings today."}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Right Side: The Form */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl min-h-[500px] flex flex-col justify-center">

                    {step > 0 && (
                        <div className="flex items-center gap-2 mb-8">
                            {[1, 2, 3].map((s) => (
                                <div key={s} className={`h-1.5 rounded-full flex-1 transition-all ${s <= step ? 'bg-amber-500' : 'bg-white/10'
                                    }`} />
                            ))}
                        </div>
                    )}

                    <form onSubmit={handleFinalSubmit}>
                        {error && (
                            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
                                <span className="bg-red-500/20 p-1 rounded-full"><X className="w-3 h-3" /></span>
                                {error}
                            </div>
                        )}

                        {/* STEP 0: Rich Benefits Landing */}
                        {step === 0 && (
                            <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
                                <div className="text-center md:text-left">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-4">
                                        <Sparkles className="w-3 h-3" /> New for 2024
                                    </div>
                                    <h2 className="text-4xl font-bold text-white mb-4 tracking-tight">
                                        Run your business <br />
                                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-200">on Autopilot.</span>
                                    </h2>
                                    <p className="text-slate-400 text-lg leading-relaxed">
                                        The complete operating system for modern independent contractors. Stop playing phone tag and start getting booked.
                                    </p>
                                </div>

                                <div className="space-y-6">
                                    {/* Feature 1 */}
                                    <div className="flex gap-4 p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group">
                                        <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                                            <Globe className="w-6 h-6 text-blue-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-lg mb-1">Your Own Booking Website</h3>
                                            <p className="text-slate-400 text-sm leading-relaxed">
                                                Get a professional <span className="text-amber-400 font-mono">handy.com/you</span> link. Clients see your real-time availability and book slots instantly.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Feature 2 */}
                                    <div className="flex gap-4 p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group">
                                        <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                                            <FileText className="w-6 h-6 text-purple-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-lg mb-1">Smart Quotes & Estimates</h3>
                                            <p className="text-slate-400 text-sm leading-relaxed">
                                                Send fast day-rate offers or build detailed project quotes. We track who's viewed and accepted them.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Feature 3 */}
                                    <div className="flex gap-4 p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group">
                                        <div className="w-12 h-12 bg-emerald-500/20 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                                            <CalendarClock className="w-6 h-6 text-emerald-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-lg mb-1">Zero-Admin Scheduling</h3>
                                            <p className="text-slate-400 text-sm leading-relaxed">
                                                Connect your calendar. We handle reminders, confirmations, and payments so you never double-book.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setStep(1)}
                                        className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 text-lg group"
                                    >
                                        Start Your Free Profile <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                    </button>
                                    <p className="text-center text-xs text-slate-500 mt-4">
                                        Join 2,000+ verified pros • No credit card required
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* STEP 1: Claim URL */}
                        {step === 1 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2">What should we call you?</h2>
                                    <p className="text-slate-400">This will be the name displayed to your clients.</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Business or Display Name</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={formData.slug}
                                            onChange={handleSlugChange}
                                            placeholder="e.g. Joe's Plumbing or Joe Smith"
                                            className="w-full px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-medium"
                                            autoFocus
                                        />
                                        {formData.slug.length >= 3 && (
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-400">
                                                <Check className="w-5 h-5" />
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-500 mt-2">
                                        If you don't have a business name, just use your full name.
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setStep(0)}
                                        className="py-3 px-4 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl border border-white/10 transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        onClick={nextStep}
                                        className="py-3 px-4 bg-amber-500 hover:bg-amber-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                                    >
                                        Claim & Continue <ArrowRight className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* STEP 2: Secure Account */}
                        {step === 2 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Secure your page</h2>
                                    <p className="text-slate-400">Create an account to manage your profile.</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-1.5">First Name</label>
                                        <input
                                            type="text"
                                            value={formData.firstName}
                                            onChange={handleChange('firstName')}
                                            className="w-full px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                            placeholder="John"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Last Name</label>
                                        <input
                                            type="text"
                                            value={formData.lastName}
                                            onChange={handleChange('lastName')}
                                            className="w-full px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                            placeholder="Doe"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={handleChange('email')}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                            placeholder="john@example.com"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            value={formData.password}
                                            onChange={handleChange('password')}
                                            className="w-full pl-10 pr-10 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                            placeholder="Min 8 chars"
                                        />
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm Password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                        <input
                                            type={showConfirmPassword ? "text" : "password"}
                                            value={formData.confirmPassword}
                                            onChange={handleChange('confirmPassword')}
                                            className="w-full pl-10 pr-10 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                            placeholder="Re-enter password"
                                        />
                                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                                            {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setStep(1)}
                                        className="py-3 px-4 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl border border-white/10 transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        onClick={nextStep}
                                        className="py-3 px-4 bg-amber-500 hover:bg-amber-400 text-white font-medium rounded-xl shadow-lg shadow-amber-500/20 transition-colors"
                                    >
                                        Next Step
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* STEP 3: Account Branding */}
                        {step === 3 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Customize your look</h2>
                                    <p className="text-slate-400">Make a great first impression.</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Hero Image</label>
                                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/10 rounded-xl hover:border-amber-500/50 hover:bg-white/5 transition-all cursor-pointer group">
                                        {formData.heroImageUrl ? (
                                            <div className="flex items-center gap-2">
                                                <img src={formData.heroImageUrl} className="w-12 h-12 rounded-lg object-cover" />
                                                <span className="text-emerald-400 text-sm font-medium">Image Selected</span>
                                            </div>
                                        ) : (
                                            <>
                                                <Upload className="w-8 h-8 text-slate-500 group-hover:text-amber-500 mb-2 transition-colors" />
                                                <p className="text-sm text-slate-400">Click to upload cover photo</p>
                                            </>
                                        )}
                                        <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                                    </label>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Short Bio</label>
                                    <textarea
                                        value={formData.bio}
                                        onChange={handleChange('bio')}
                                        rows={3}
                                        className="w-full px-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none"
                                        placeholder="E.g. Professional plumber with 10 years experience serving London..."
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setStep(2)}
                                        className="py-3 px-4 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl border border-white/10 transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
                                    >
                                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Launch Profile'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Login Link */}
                        <div className="mt-8 text-center">
                            <button
                                type="button"
                                onClick={() => setLocation('/contractor/login')}
                                className="text-slate-500 hover:text-white text-sm transition-colors"
                            >
                                Already have an account? Sign in
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
