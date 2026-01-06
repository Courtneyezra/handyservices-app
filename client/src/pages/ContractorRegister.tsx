import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Mail, Lock, Eye, EyeOff, ArrowRight, User, Phone, MapPin, Globe, Upload, Check, Loader2, X, Sparkles, FileText, CalendarClock, Smartphone, Monitor } from 'lucide-react';


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
                    heroImageUrl: uploadedHeroUrl || undefined,
                    profileImageUrl: uploadedProfileUrl || undefined,
                    publicProfileEnabled: true, // Enable automatically!
                    postcode: formData.postcode || undefined,
                    socialLinks: formData.website ? { website: formData.website } : undefined
                }),
            });

            if (!updateRes.ok) throw new Error('Failed to set up profile');

            // Success! Redirect to onboarding wizard

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
                <div className={step === 0 ? "hidden md:block" : "block"}>
                    <div className="relative">
                        {/* View Toggle */}
                        <div className="absolute -top-12 left-0 flex items-center gap-1 bg-slate-800/50 p-1 rounded-lg border border-white/10 backdrop-blur-sm z-10 transition-all duration-300">
                            <button
                                type="button"
                                onClick={() => setIsMobileView(false)}
                                className={`p-2 rounded-md transition-all ${!isMobileView ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                title="Desktop View"
                            >
                                <Monitor className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsMobileView(true)}
                                className={`p-2 rounded-md transition-all ${isMobileView ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                title="Mobile View"
                            >
                                <Smartphone className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Blob */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-amber-500/20 rounded-full blur-3xl" />

                        {/* DYNAMIC MOCKUP CARD */}
                        <div className={`relative bg-slate-900 border border-white/10 shadow-2xl overflow-hidden transition-all duration-700 ease-in-out
                            ${isMobileView ? 'w-[320px] mx-auto rounded-[2.5rem] border-[8px] border-slate-900 ring-1 ring-white/10' : 'w-full rounded-2xl'} 
                            ${step === 0 ? 'scale-100 rotate-0' : 'scale-95 rotate-[-1deg]'}
                        `}>
                            {/* --- STEP 0: HANDYMAN PROFILE (Original) --- */}
                            {(step === 0 || step === 1) && (
                                <div className="animate-in fade-in duration-700">
                                    <div className="bg-slate-800 p-3 border-b border-white/5 flex items-center gap-2">
                                        <div className="flex gap-1.5">
                                            <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
                                        </div>
                                        <div className="flex-1 text-center">
                                            <div className="bg-slate-900/50 rounded-md px-3 py-1 text-[10px] text-slate-400 font-mono inline-block">
                                                handy.com/handy/<span className="text-amber-400">james-handy</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="h-40 bg-slate-800/50 relative">
                                        <img src="/demo-cover.png" className="w-full h-full object-cover" alt="Cover" />
                                        <div className="absolute -bottom-10 left-6">
                                            <div className="w-20 h-20 rounded-xl bg-slate-800 border-4 border-slate-900 flex items-center justify-center text-slate-500 overflow-hidden">
                                                <img src="/demo-profile.png" className="w-full h-full object-cover" alt="Profile" />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="pt-12 px-6 pb-6">
                                        <h1 className="text-xl font-bold text-white mb-1">James Turner</h1>
                                        <p className="text-slate-400 text-sm mb-4">
                                            Professional handyman serving Greater London. Fully insured and experienced in plumbing, carpentry, and general repairs.
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
                            )}

                            {/* --- STEP 1: Using Step 0 Visual --- */}
                            {false && step === 1 && (
                                <div className="bg-white h-full min-h-[400px] animate-in slide-in-from-right-8 duration-500">
                                    <div className="bg-slate-50 p-6 border-b border-slate-100 flex justify-between items-center">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-green-500/30">
                                                <Check className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-900">Payment Received</h3>
                                                <p className="text-xs text-slate-500">Just now</p>
                                            </div>
                                        </div>
                                        <span className="text-lg font-bold text-green-600">+£150.00</span>
                                    </div>

                                    <div className="p-6 space-y-4">
                                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Recent Transactions</h4>
                                        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 font-bold">JD</div>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-900">John Doe</p>
                                                    <p className="text-xs text-slate-500">Tap Repair</p>
                                                </div>
                                            </div>
                                            <span className="text-sm font-bold text-slate-900">£85.00</span>
                                        </div>
                                        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600 font-bold">SM</div>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-900">Sarah M.</p>
                                                    <p className="text-xs text-slate-500">Shelf Installation</p>
                                                </div>
                                            </div>
                                            <span className="text-sm font-bold text-slate-900">£120.00</span>
                                        </div>
                                        <div className="mt-6 pt-6 border-t border-slate-100">
                                            <div className="flex justify-between items-end">
                                                <div>
                                                    <p className="text-sm text-slate-500 mb-1">Total Balance</p>
                                                    <h2 className="text-3xl font-bold text-slate-900">£2,450.50</h2>
                                                </div>
                                                <div className="w-24 h-12 bg-slate-100 rounded-lg relative overflow-hidden">
                                                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-green-500/20" />
                                                    <svg className="absolute bottom-0 left-0 right-0 text-green-500" viewBox="0 0 100 40" preserveAspectRatio="none">
                                                        <path d="M0 40 L0 25 L20 30 L40 15 L60 25 L80 10 L100 20 L100 40 Z" fill="currentColor" opacity="0.4" />
                                                        <path d="M0 40 L0 30 L20 35 L40 20 L60 30 L80 15 L100 25 L100 40 Z" fill="currentColor" opacity="0.3" />
                                                    </svg>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* --- STEP 2: QUOTE OPTIONS (HHH Style) --- */}
                            {step === 2 && (
                                <div className="bg-white h-full min-h-[400px] animate-in slide-in-from-right-8 duration-500 flex flex-col">
                                    <div className="bg-slate-50 p-6 border-b border-slate-100 mb-auto">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center text-white font-bold uppercase">JT</div>
                                            <span className="font-bold text-slate-900">James Turner</span>
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-900">Bathroom Renovation</h3>
                                        <p className="text-xs text-slate-500">Select an option to proceed</p>
                                    </div>

                                    <div className="p-6 space-y-3">
                                        {/* Option 1 */}
                                        <div className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm hover:border-amber-500/50 hover:bg-amber-50 transition-colors cursor-pointer group">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-slate-900 group-hover:text-amber-700">Basic Fix</span>
                                                <span className="font-bold text-slate-900">£1,200</span>
                                            </div>
                                            <p className="text-xs text-slate-500">Labor and basic materials only.</p>
                                        </div>

                                        {/* Option 2 (Selected) */}
                                        <div className="p-4 rounded-xl border-2 border-amber-500 bg-amber-50 shadow-md relative overflow-hidden cursor-pointer">
                                            <div className="absolute top-0 right-0 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">RECOMMENDED</div>
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-amber-900">Standard</span>
                                                <span className="font-bold text-amber-900">£1,800</span>
                                            </div>
                                            <p className="text-xs text-amber-800/80">Includes waste removal and premium adhesive.</p>
                                        </div>

                                        {/* Option 3 */}
                                        <div className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm hover:border-amber-500/50 hover:bg-amber-50 transition-colors cursor-pointer group">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-slate-900 group-hover:text-amber-700">Premium Finish</span>
                                                <span className="font-bold text-slate-900">£2,400</span>
                                            </div>
                                            <p className="text-xs text-slate-500">All inclusive + 2 year guarantee.</p>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-slate-50 border-t border-slate-100 mt-auto">
                                        <div className="w-full py-2 bg-slate-900 text-white text-xs font-bold rounded-lg text-center opacity-50">
                                            Select Package
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* --- STEP 3: CALENDAR (Run Business at Glance) --- */}
                            {step === 3 && (
                                <div className="bg-white h-full min-h-[400px] animate-in slide-in-from-right-8 duration-500 relative">
                                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                                        <h3 className="font-bold text-slate-900">October 2025</h3>
                                        <div className="flex gap-1">
                                            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600"><span className="sr-only">Prev</span>←</div>
                                            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600"><span className="sr-only">Next</span>→</div>
                                        </div>
                                    </div>
                                    <div className="p-4 grid grid-cols-7 gap-2 text-center text-sm mb-2">
                                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="text-slate-400 font-medium">{d}</div>)}
                                        {/* Fake Calendar Days */}
                                        {Array.from({ length: 14 }).map((_, i) => {
                                            const day = i + 12;
                                            const hasJob = [14, 15, 18, 20].includes(day);
                                            const isSelected = day === 15;
                                            return (
                                                <div key={i} className={`aspect-square rounded-lg flex items-center justify-center text-xs relative
                                                    ${isSelected ? 'bg-amber-500 text-white font-bold shadow-md' : 'text-slate-700 hover:bg-slate-50'}
                                                `}>
                                                    {day}
                                                    {hasJob && !isSelected && <div className="absolute bottom-1 w-1 h-1 bg-amber-500 rounded-full"></div>}
                                                </div>
                                            )
                                        })}
                                    </div>

                                    <div className="px-4 pb-4">
                                        <div className="text-xs font-bold text-slate-400 uppercase mb-3">Upcoming Jobs</div>

                                        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex gap-3 mb-2 animate-in slide-in-from-bottom-4 delay-100">
                                            <div className="w-12 h-12 bg-blue-100 rounded-lg flex flex-col items-center justify-center text-blue-700 shrink-0">
                                                <span className="text-xs font-bold">OCT</span>
                                                <span className="text-lg font-bold leading-none">15</span>
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-slate-900 text-sm">Kitchen Tiling</h4>
                                                <p className="text-xs text-slate-500">09:00 AM - 4:00 PM</p>
                                                <p className="text-xs text-blue-600 font-medium mt-0.5">88 Road, London</p>
                                            </div>
                                        </div>

                                        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex gap-3 animate-in slide-in-from-bottom-4 delay-200 opacity-50">
                                            <div className="w-12 h-12 bg-slate-200 rounded-lg flex flex-col items-center justify-center text-slate-500 shrink-0">
                                                <span className="text-xs font-bold">OCT</span>
                                                <span className="text-lg font-bold leading-none">16</span>
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-slate-900 text-sm">Radiator Fix</h4>
                                                <p className="text-xs text-slate-500">10:00 AM - 11:30 AM</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* CAPTION TEXT */}
                        <div className="text-center mt-8 px-4 transition-all duration-300">
                            {step === 0 && (
                                <>
                                    <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Everything you need to grow</h2>
                                    <p className="text-slate-400">Stop chasing invoices and missed calls.</p>
                                </>
                            )}
                            {step === 1 && (
                                <>
                                    <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Build your digital presence</h2>
                                    <p className="text-slate-400">Claim your professional URL and start accepting bookings today.</p>
                                </>
                            )}
                            {step === 2 && (
                                <>
                                    <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Give customers choice</h2>
                                    <p className="text-slate-400">Clients trust transparent, professional quotes.</p>
                                </>
                            )}
                            {step === 3 && (
                                <>
                                    <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Run your business at a glance</h2>
                                    <p className="text-slate-400">Manage availability and never miss a job.</p>
                                </>
                            )}
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
