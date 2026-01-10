import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Mail, Lock, Eye, EyeOff, ArrowRight, User, Phone, MapPin, Globe, Upload, Check, Loader2, X, Sparkles, FileText, CalendarClock, Smartphone, Monitor, Star, CheckCircle } from 'lucide-react';
import Autocomplete from 'react-google-autocomplete';


export default function ContractorRegister() {
    const [, setLocation] = useLocation();


    // Steps: 0=Intro, 1=Claim URL, 2=Account Detail, 3=Branding
    const [step, setStep] = useState(0); // Start at 0 now
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isMobileView, setIsMobileView] = useState(false);

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
        profileImage: null as File | null,
        profileImageUrl: '', // For preview
        website: '',

        // Step 4: Skills & Value
        skills: [] as string[],
        valueTags: [] as string[],

        // Step 5: Rates
        skillRates: {} as Record<string, string>,
        calloutFee: '',
        dayRate: ''
    });

    const SERVICES = [
        "Plumbing", "Electrical", "Carpentry", "Painting",
        "General Handyman", "Locksmith", "Cleaning", "Gardening"
    ];

    const VALUE_TAGS = [
        "Instant Response", "Weekend Availability", "Emergency Callouts",
        "Free Estimates", "Verified Pro", "Eco-Friendly products"
    ];

    const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [field]: e.target.value });
        setError('');
    };

    const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        setFormData({ ...formData, slug: val });
        setError('');
    };

    const handleFileChange = (field: 'heroImage' | 'profileImage') => (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            // Create preview URL
            const previewUrl = URL.createObjectURL(file);
            const urlField = field === 'heroImage' ? 'heroImageUrl' : 'profileImageUrl';

            setFormData({
                ...formData,
                [field]: file,
                [urlField]: previewUrl
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
        if (!formData.firstName || !formData.lastName || !formData.email || !formData.password || !formData.postcode) {
            setError('Please fill in all required fields including Postcode');
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

    const validateStep3 = () => {
        // Branding is semi-optional but let's encourage at least a bio? 
        // For now, let it be optional to reduce friction.
        return true;
    };

    const validateStep4 = () => {
        if (formData.skills.length === 0) {
            setError('Please select at least one service/skill');
            return false;
        }
        return true;
    };

    const validateStep5 = () => {
        // Ensure every selected skill has a rate
        for (const skill of formData.skills) {
            if (!formData.skillRates[skill] || parseFloat(formData.skillRates[skill]) <= 0) {
                setError(`Please set a valid hourly rate for ${skill}`);
                return false;
            }
        }
        if (!formData.calloutFee) {
            setError('Please set a call-out fee');
            return false;
        }
        return true;
    };

    // Final Submission
    const handleFinalSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!validateStep5()) return;

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
                    // Pass extra data if API supports it, or update profile later
                }),
            });

            const authData = await registerRes.json();
            if (!registerRes.ok) throw new Error(authData.error || 'Registration failed');

            // Store Auth
            const token = authData.token;
            localStorage.setItem('contractorToken', token);
            localStorage.setItem('contractorUser', JSON.stringify(authData.user));
            localStorage.setItem('contractorProfileId', authData.profileId);

            // 2. Upload Images (if exists)
            let uploadedHeroUrl = '';
            let uploadedProfileUrl = '';

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
                    uploadedHeroUrl = uploadData.url;
                }
            }

            if (formData.profileImage) {
                const imageFormData = new FormData();
                imageFormData.append('profileImage', formData.profileImage);

                const uploadRes = await fetch('/api/contractor/media/profile-upload', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: imageFormData,
                });

                if (uploadRes.ok) {
                    const uploadData = await uploadRes.json();
                    uploadedProfileUrl = uploadData.url;
                }
            }

            // 3. Update Profile (Slug, Bio, Skills, Rates, Public=true)
            const updateRes = await fetch('/api/contractor/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    slug: formData.slug,
                    bio: formData.bio,
                    heroImageUrl: uploadedHeroUrl || undefined,
                    profileImageUrl: uploadedProfileUrl || undefined,
                    publicProfileEnabled: true,
                    postcode: formData.postcode || undefined,
                    socialLinks: formData.website ? { website: formData.website } : undefined,
                    // Todo: Ensure backend accepts these new fields
                    // For now assuming we might need to store them or the backend ignores them if schema not updated.
                    // But we are focusing on frontend flow first. 
                    skills: formData.skills,
                    valueTags: formData.valueTags,
                    skillRates: formData.skillRates, // Send the per-skill rates
                    calloutFee: formData.calloutFee,
                    dayRate: formData.dayRate
                }),
            });

            if (!updateRes.ok) throw new Error('Failed to set up profile');

            // Success! Redirect
            setLocation('/contractor/onboarding');

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Something went wrong');
            if (localStorage.getItem('contractorToken')) {
                setLocation('/contractor/onboarding');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const nextStep = () => {
        setError('');
        if (step === 1 && validateStep1()) {
            setError('');
            setStep(2);
        }
        else if (step === 2 && validateStep2()) {
            setError('');
            setStep(3);
        }
        else if (step === 3 && validateStep3()) {
            setError('');
            setStep(4);
        }
        else if (step === 4 && validateStep4()) {
            setError('');
            setStep(5);
        }
    };

    // Helper to change step and clear error (for Back buttons)
    const goToStep = (s: number) => {
        setError('');
        setStep(s);
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

            <div className="relative w-full max-w-5xl md:grid md:grid-cols-2 gap-8 items-center h-screen md:h-auto overflow-hidden md:overflow-visible">

                {/* Left Side (Desktop) / Top Background (Mobile) - VISUAL NARRATIVE */}
                {/* On Step 0 (Landing), we hide this section completely to focus on the centered content. */}
                {step > 0 && (
                    <div className={`
                        fixed md:relative top-0 left-0 right-0 
                        h-[40vh] md:h-auto 
                        bg-slate-950 
                        transition-all duration-500 ease-in-out
                        flex items-center justify-center
                        overflow-hidden
                        z-0
                        ${step === 0 ? "scale-100" : "scale-100"} 
                    `}>
                        {/* Background Effects */}
                        <div className="absolute inset-0 opacity-20 pointer-events-none">
                            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-soft-light"></div>
                            <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl"></div>
                            <div className="absolute bottom-0 left-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl"></div>
                        </div>

                        {/* DASHBOARD PREVIEW MOCKUP */}
                        <div className="relative w-full max-w-4xl mx-auto px-4 perspective-1000 transform transition-all duration-700">
                            <div className={`
                                    bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden
                                    transition-all duration-500
                                    ${step === 0 ? 'opacity-80 scale-95 blur-sm translate-y-4' : 'opacity-100 scale-100 translate-y-0 blur-0'}
                                `}>
                                {/* Dashboard Header */}
                                <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center font-bold text-slate-900">
                                            {formData.slug ? formData.slug.charAt(0).toUpperCase() : 'H'}
                                        </div>
                                        <span className="text-white font-medium hidden md:block">
                                            {formData.slug ? formData.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Your Business'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="h-2 w-20 bg-slate-800 rounded-full hidden md:block"></div>
                                        <div className="w-8 h-8 bg-slate-800 rounded-full"></div>
                                    </div>
                                </div>

                                {/* Dashboard Content */}
                                <div className="flex h-[300px] md:h-[500px]">
                                    {/* Sidebar */}
                                    <div className="w-48 bg-slate-900 border-r border-slate-800 p-4 hidden md:flex flex-col gap-2">
                                        {['Dashboard', 'Jobs', 'Message', 'Calendar', 'Profile'].map(item => (
                                            <div key={item} className={`p-2 rounded-lg text-sm font-medium ${item === 'Profile' ? 'bg-amber-500/10 text-amber-500' : 'text-slate-400'}`}>
                                                {item}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Main Area */}
                                    <div className="flex-1 p-4 md:p-6 bg-slate-900/50 relative overflow-y-auto">
                                        {/* Intro Overlay (Step 0) */}
                                        {step === 0 && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm z-10">
                                                <div className="text-center">
                                                    <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg shadow-amber-500/20">
                                                        <Sparkles className="w-8 h-8 text-white" />
                                                    </div>
                                                    <h3 className="text-xl font-bold text-white mb-1">Your Command Center</h3>
                                                    <p className="text-slate-400 text-sm">Everything you need to run your business.</p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Grid Layout */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* Profile Card */}
                                            <div className={`bg-slate-800/50 p-4 rounded-xl border border-white/5 transition-all duration-500 ${step >= 2 ? 'opacity-100' : 'opacity-50 grayscale'}`}>
                                                <div className="flex items-start gap-3">
                                                    <div className="w-12 h-12 rounded-full bg-slate-700 overflow-hidden flex-shrink-0">
                                                        {formData.profileImageUrl ? (
                                                            <img src={formData.profileImageUrl} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-slate-500"><User className="w-6 h-6" /></div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-white font-medium">
                                                            {formData.firstName || formData.lastName ? `${formData.firstName} ${formData.lastName}` : 'Providing Name...'}
                                                        </h4>
                                                        <p className="text-slate-400 text-xs line-clamp-2 mt-1">
                                                            {formData.bio || "Bio will appear here..."}
                                                        </p>
                                                        {formData.postcode && (
                                                            <div className="flex items-center gap-1 mt-2 text-emerald-400 text-xs">
                                                                <MapPin className="w-3 h-3" />
                                                                <span>{formData.postcode}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Stats Card */}
                                            <div className="bg-slate-800/50 p-4 rounded-xl border border-white/5">
                                                <h5 className="text-slate-400 text-xs uppercase font-bold mb-3">Performance</h5>
                                                <div className="flex items-end gap-2 mb-2">
                                                    <span className="text-2xl font-bold text-white">0</span>
                                                    <span className="text-slate-400 text-sm mb-1">jobs completed</span>
                                                </div>
                                                <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                                                    <div className="h-full bg-emerald-500 w-0"></div>
                                                </div>
                                            </div>

                                            {/* Services (Step 4) */}
                                            <div className={`bg-slate-800/50 p-4 rounded-xl border border-white/5 md:col-span-2 transition-all duration-500 ${step >= 4 ? 'ring-2 ring-amber-500/50 bg-slate-800' : ''}`}>
                                                <h5 className="text-slate-400 text-xs uppercase font-bold mb-3 flex justify-between">
                                                    <span>Services & Skills</span>
                                                    {step === 4 && <span className="text-amber-500 text-[10px] animate-pulse">EDITING</span>}
                                                </h5>
                                                <div className="flex flex-wrap gap-2">
                                                    {formData.skills.length > 0 ? (
                                                        formData.skills.map(skill => (
                                                            <span key={skill} className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-md border border-amber-500/20">
                                                                {skill}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-slate-600 text-sm italic">No services added yet...</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Rates (Step 5) */}
                                            <div className={`bg-slate-800/50 p-4 rounded-xl border border-white/5 md:col-span-2 transition-all duration-500 ${step >= 5 ? 'ring-2 ring-emerald-500/50 bg-slate-800' : ''}`}>
                                                <h5 className="text-slate-400 text-xs uppercase font-bold mb-3 flex justify-between">
                                                    <span>Standard Rates</span>
                                                    {step === 5 && <span className="text-emerald-500 text-[10px] animate-pulse">EDITING</span>}
                                                </h5>
                                                <div className="space-y-3">
                                                    {formData.skills.length > 0 ? (
                                                        formData.skills.map(skill => (
                                                            <div key={skill} className="flex items-center justify-between border-b border-white/5 pb-2 last:border-0 last:pb-0">
                                                                <span className="text-slate-300 text-sm">{skill}</span>
                                                                <span className="text-white font-mono font-medium">
                                                                    {formData.skillRates[skill] ? `£${formData.skillRates[skill]}/hr` : 'Not set'}
                                                                </span>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <span className="text-slate-600 text-sm italic">Select skills to set rates...</span>
                                                    )}
                                                    <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
                                                        <span className="text-slate-400 text-xs">Call-out Fee</span>
                                                        <span className="text-slate-300 font-mono text-xs">
                                                            {formData.calloutFee ? `£${formData.calloutFee}` : '£0'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Right Side (Form) / Main Center (Step 0) */}
                <div className={`
                    fixed md:relative bottom-0 left-0 right-0 z-10 
                    bg-slate-900 md:bg-white/5 backdrop-blur-xl md:backdrop-filter-none
                    border-t border-white/10 md:border md:rounded-2xl
                    rounded-t-[2rem] md:rounded-t-2xl
                    shadow-[0_-10px_40px_rgba(0,0,0,0.5)] md:shadow-2xl
                    transition-all duration-500 ease-out
                    flex flex-col
                    max-h-[85vh] md:max-h-none
                    ${step === 0 ? 'relative !fixed-none !bottom-auto md:w-full md:max-w-4xl md:mx-auto md:!border-0 md:!bg-transparent md:!shadow-none items-center h-auto min-h-screen justify-center' : 'h-auto md:h-auto p-6 md:p-8 overflow-y-auto md:overflow-visible'}
                `}>

                    {/* Mobile Drag Handle */}
                    <div className="md:hidden w-full flex justify-center mb-4 shrink-0">
                        <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                    </div>

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

                                </div>

                                <div className="grid md:grid-cols-3 gap-6">
                                    {/* Feature 1 */}
                                    <div className="p-6 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group text-center md:text-left">
                                        <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center mb-4 mx-auto md:mx-0 group-hover:scale-110 transition-transform">
                                            <Globe className="w-6 h-6 text-blue-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-lg mb-2">Your Own Booking Website</h3>
                                            <p className="text-slate-400 text-sm leading-relaxed">
                                                Get a professional <span className="text-amber-400 font-mono">handy.com/you</span> link. Clients see your real-time availability and book slots instantly.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Feature 2 */}
                                    <div className="p-6 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group text-center md:text-left">
                                        <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center mb-4 mx-auto md:mx-0 group-hover:scale-110 transition-transform">
                                            <FileText className="w-6 h-6 text-purple-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-lg mb-2">Smart Quotes & Estimates</h3>
                                            <p className="text-slate-400 text-sm leading-relaxed">
                                                Send fast day-rate offers or build detailed project quotes. We track who's viewed and accepted them.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Feature 3 */}
                                    <div className="p-6 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group text-center md:text-left">
                                        <div className="w-12 h-12 bg-emerald-500/20 rounded-lg flex items-center justify-center mb-4 mx-auto md:mx-0 group-hover:scale-110 transition-transform">
                                            <CalendarClock className="w-6 h-6 text-emerald-400" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-lg mb-2">Zero-Admin Scheduling</h3>
                                            <p className="text-slate-400 text-sm leading-relaxed">
                                                Connect your calendar. We handle reminders, confirmations, and payments so you never double-book.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-4">
                                    <button
                                        type="button"
                                        onClick={() => goToStep(1)}
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
                                        onClick={() => goToStep(0)}
                                        className="py-3 px-4 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl border border-white/10 transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        onClick={nextStep}
                                        className="py-3 px-4 bg-amber-500 hover:bg-amber-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                                    >
                                        Continue <ArrowRight className="w-4 h-4" />
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
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Postcode <span className="text-slate-500 text-xs">(Required for Fleet Map)</span></label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                            <Autocomplete
                                                apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                                                onPlaceSelected={(place) => {
                                                    let postcode = "";
                                                    if (place.address_components) {
                                                        for (const component of place.address_components) {
                                                            if (component.types.includes("postal_code")) {
                                                                postcode = component.long_name;
                                                                break;
                                                            }
                                                        }
                                                    }
                                                    // If we found a postcode, use it. Otherwise use the formatted address or name as fallback if needed, 
                                                    // but for "Postcode" field we prefer the actual postcode. 
                                                    // Some users might select an address that doesn't resolve a postcode immediately (rare in UK).
                                                    // If no postcode found, we'll keep the text they typed or possibly the formatted address
                                                    // but let's stick to trying to update with the refined postcode.
                                                    if (postcode) {
                                                        setFormData(prev => ({ ...prev, postcode }));
                                                        setError('');
                                                    } else if (place.formatted_address) {
                                                        // Fallback to address if they selected something without a clear postal code component (unlikely for UK address)
                                                        // or maybe they just typed a postcode and hit enter?
                                                        // use formatted address might be too long for "postcode" field but let's use it for now
                                                        // tailored to user behavior.
                                                        // actually, sticking to just updating if postcode is found is safer to avoid putting "London, UK" in a postcode field.
                                                    }
                                                }}
                                                options={{
                                                    types: ['geocode'],
                                                    componentRestrictions: { country: "uk" },
                                                }}
                                                value={formData.postcode}
                                                onChange={(e: any) => handleChange('postcode')(e)}
                                                className="w-full pl-10 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                                placeholder="e.g. SW1A 1AA"
                                            />
                                        </div>
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
                                        onClick={() => goToStep(1)}
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
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Profile Picture</label>
                                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/10 rounded-xl hover:border-amber-500/50 hover:bg-white/5 transition-all cursor-pointer group">
                                        {formData.profileImageUrl ? (
                                            <div className="flex items-center gap-2">
                                                <img src={formData.profileImageUrl} className="w-12 h-12 rounded-full object-cover" />
                                                <span className="text-emerald-400 text-sm font-medium">Image Selected</span>
                                            </div>
                                        ) : (
                                            <>
                                                <User className="w-8 h-8 text-slate-500 group-hover:text-amber-500 mb-2 transition-colors" />
                                                <p className="text-sm text-slate-400">Click to upload profile picture</p>
                                            </>
                                        )}
                                        <input type="file" className="hidden" accept="image/*" onChange={handleFileChange('profileImage')} />
                                    </label>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Cover Image</label>
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
                                        <input type="file" className="hidden" accept="image/*" onChange={handleFileChange('heroImage')} />
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
                                        onClick={() => goToStep(2)}
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

                        {/* STEP 4: Skills & Value */}
                        {step === 4 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2">What do you do?</h2>
                                    <p className="text-slate-400">Select your core services to get matched with jobs.</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-3">Core Services</label>
                                    <div className="flex flex-wrap gap-2">
                                        {SERVICES.map(service => (
                                            <button
                                                key={service}
                                                type="button"
                                                onClick={() => {
                                                    const newSkills = formData.skills.includes(service)
                                                        ? formData.skills.filter(s => s !== service)
                                                        : [...formData.skills, service];
                                                    setFormData({ ...formData, skills: newSkills });
                                                }}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${formData.skills.includes(service)
                                                    ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                                                    : 'bg-slate-900/50 text-slate-400 border border-white/10 hover:border-white/20'
                                                    }`}
                                            >
                                                {service}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-3">What sets you apart?</label>
                                    <div className="flex flex-wrap gap-2">
                                        {VALUE_TAGS.map(tag => (
                                            <button
                                                key={tag}
                                                type="button"
                                                onClick={() => {
                                                    const newTags = formData.valueTags.includes(tag)
                                                        ? formData.valueTags.filter(t => t !== tag)
                                                        : [...formData.valueTags, tag];
                                                    setFormData({ ...formData, valueTags: newTags });
                                                }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${formData.valueTags.includes(tag)
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-slate-900/30 text-slate-500 border border-white/5 hover:border-white/10'
                                                    }`}
                                            >
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => goToStep(3)}
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

                        {/* STEP 5: Rates */}
                        {step === 5 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Set your rates</h2>
                                    <p className="text-slate-400">You can change these anytime in your dashboard.</p>
                                </div>

                                <div className="space-y-4">
                                    <div className="bg-slate-900/50 rounded-xl p-4 border border-white/5 space-y-3">
                                        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Hourly Rates per Trade</h3>
                                        {formData.skills.length > 0 ? (
                                            formData.skills.map(skill => (
                                                <div key={skill}>
                                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">{skill} Rate (£/hr)</label>
                                                    <div className="relative">
                                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">£</span>
                                                        <input
                                                            type="number"
                                                            value={formData.skillRates[skill] || ''}
                                                            onChange={(e) => {
                                                                setFormData({
                                                                    ...formData,
                                                                    skillRates: {
                                                                        ...formData.skillRates,
                                                                        [skill]: e.target.value
                                                                    }
                                                                });
                                                            }}
                                                            className="w-full pl-8 pr-4 py-3 bg-slate-950 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                                            placeholder="e.g. 60"
                                                        />
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-center py-4 text-slate-500 italic">
                                                Go back and select services first.
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1.5">Call-out Fee (£)</label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">£</span>
                                                <input
                                                    type="number"
                                                    value={formData.calloutFee}
                                                    onChange={handleChange('calloutFee')}
                                                    className="w-full pl-8 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                                    placeholder="80"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1.5">Day Rate (Optional)</label>
                                            <div className="relative">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">£</span>
                                                <input
                                                    type="number"
                                                    value={formData.dayRate}
                                                    onChange={handleChange('dayRate')}
                                                    className="w-full pl-8 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                                    placeholder="350"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => goToStep(4)}
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
            </div >
        </div >
    );
}
