import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
    Building2,
    MessageSquare,
    Wrench,
    Shield,
    Clock,
    CheckCircle2,
    ArrowRight,
    ArrowLeft,
    Phone,
    Mail,
    User,
    Home,
    Loader2,
    XCircle,
    BellRing,
    Moon,
    PoundSterling,
    Camera,
    Calendar,
    Brain,
    Zap,
    TrendingDown,
    Coffee
} from "lucide-react";

interface SlideContent {
    id: string;
    painPoint: string;
    dream: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    features: { text: string; icon: React.ReactNode }[];
    animation: "phone-buzz" | "money-drain" | "peace" | "autopilot";
    bgGradient: string;
}

const slides: SlideContent[] = [
    {
        id: "pain-1",
        painPoint: "The 11pm Text",
        dream: "Sleep Through The Night",
        title: "\"My tap won't stop dripping\"",
        subtitle: "Sound familiar? Tenants text you about everything. You've become an unpaid 24/7 helpdesk.",
        icon: <Moon className="w-12 h-12" />,
        features: [
            { text: "Tenants report issues to AI, not you", icon: <MessageSquare className="w-5 h-5" /> },
            { text: "AI handles it while you sleep", icon: <Moon className="w-5 h-5" /> },
            { text: "Only notified when you need to act", icon: <BellRing className="w-5 h-5" /> },
            { text: "Your phone stays quiet", icon: <Phone className="w-5 h-5" /> }
        ],
        animation: "phone-buzz",
        bgGradient: "from-slate-900 via-indigo-950 to-slate-900"
    },
    {
        id: "pain-2",
        painPoint: "£80 Callout For Nothing",
        dream: "Save Money on Simple Fixes",
        title: "\"That'll be £80 just to look at it\"",
        subtitle: "Paying callout fees for things your tenant could fix in 5 minutes with the right guidance.",
        icon: <PoundSterling className="w-12 h-12" />,
        features: [
            { text: "AI guides tenants through simple fixes", icon: <Brain className="w-5 h-5" /> },
            { text: "Dripping tap? Turn off the stopcock", icon: <Wrench className="w-5 h-5" /> },
            { text: "15-25% of issues resolved without callout", icon: <TrendingDown className="w-5 h-5" /> },
            { text: "Only pay when you actually need someone", icon: <PoundSterling className="w-5 h-5" /> }
        ],
        animation: "money-drain",
        bgGradient: "from-slate-900 via-emerald-950 to-slate-900"
    },
    {
        id: "pain-3",
        painPoint: "The Coordination Nightmare",
        dream: "It Just Happens",
        title: "\"When can you let the plumber in?\"",
        subtitle: "Days of back-and-forth messages. Tenant's busy. Contractor's busy. You're stuck in the middle.",
        icon: <Calendar className="w-12 h-12" />,
        features: [
            { text: "AI coordinates tenant availability", icon: <Calendar className="w-5 h-5" /> },
            { text: "Auto-books within your rules", icon: <Zap className="w-5 h-5" /> },
            { text: "Photo report sent after every job", icon: <Camera className="w-5 h-5" /> },
            { text: "You just get a \"Job Complete\" notification", icon: <CheckCircle2 className="w-5 h-5" /> }
        ],
        animation: "autopilot",
        bgGradient: "from-slate-900 via-blue-950 to-slate-900"
    },
    {
        id: "dream",
        painPoint: "The Mental Load",
        dream: "Passive Income, Actually Passive",
        title: "\"I collect rent. Everything else is handled.\"",
        subtitle: "Like having a property manager, without the 10% fee.",
        icon: <Coffee className="w-12 h-12" />,
        features: [
            { text: "Set your rules once, system follows them", icon: <Shield className="w-5 h-5" /> },
            { text: "Auto-approve jobs under your threshold", icon: <CheckCircle2 className="w-5 h-5" /> },
            { text: "Tax-ready invoices in your inbox", icon: <Mail className="w-5 h-5" /> },
            { text: "Sleep knowing emergencies are handled", icon: <Moon className="w-5 h-5" /> }
        ],
        animation: "peace",
        bgGradient: "from-slate-900 via-amber-950 to-slate-900"
    }
];

// Phone Buzzing Animation Component
function PhoneBuzzAnimation() {
    return (
        <div className="relative w-64 h-[420px]">
            {/* Phone */}
            <div className="absolute inset-0 bg-slate-800 rounded-[2.5rem] p-2 shadow-2xl animate-[buzz_0.5s_ease-in-out_infinite]">
                <div className="w-full h-full bg-slate-900 rounded-[2rem] overflow-hidden">
                    {/* Notifications */}
                    <div className="p-4 space-y-3 pt-12">
                        {[
                            { time: "23:47", msg: "The heating isn't working" },
                            { time: "22:15", msg: "There's a weird smell" },
                            { time: "21:30", msg: "Tap is dripping again" },
                            { time: "20:45", msg: "Can you call me?" },
                            { time: "19:20", msg: "Door handle is loose" },
                        ].map((notif, i) => (
                            <div
                                key={i}
                                className="bg-slate-800 rounded-xl p-3 flex items-start gap-3 animate-[slideIn_0.3s_ease-out_forwards] opacity-0"
                                style={{ animationDelay: `${i * 0.2}s` }}
                            >
                                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                                    <MessageSquare className="w-4 h-4 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-slate-400">{notif.time}</p>
                                    <p className="text-sm text-white truncate">{notif.msg}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            {/* Stress indicator */}
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-full text-sm font-bold animate-pulse">
                Your phone right now
            </div>
        </div>
    );
}

// Money Drain Animation Component
function MoneyDrainAnimation() {
    return (
        <div className="relative w-72 h-[420px] flex items-center justify-center">
            <div className="relative">
                {/* Drain */}
                <div className="w-48 h-48 rounded-full bg-slate-800 border-4 border-slate-700 flex items-center justify-center relative overflow-hidden">
                    {/* Money symbols falling */}
                    {[...Array(8)].map((_, i) => (
                        <div
                            key={i}
                            className="absolute text-2xl animate-[fall_2s_linear_infinite]"
                            style={{
                                left: `${20 + (i * 10)}%`,
                                animationDelay: `${i * 0.25}s`,
                            }}
                        >
                            💷
                        </div>
                    ))}
                    {/* Center text */}
                    <div className="text-center z-10 bg-slate-800 rounded-full w-24 h-24 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold text-red-400">£80</span>
                        <span className="text-xs text-slate-400">callout</span>
                    </div>
                </div>
                {/* Labels */}
                <div className="absolute -left-20 top-1/2 -translate-y-1/2 text-right">
                    <p className="text-red-400 text-sm font-medium">Dripping tap</p>
                    <p className="text-slate-500 text-xs">5 min fix</p>
                </div>
                <div className="absolute -right-20 top-1/2 -translate-y-1/2">
                    <p className="text-red-400 text-sm font-medium">Blocked drain</p>
                    <p className="text-slate-500 text-xs">Plunger needed</p>
                </div>
            </div>
            {/* After state */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 px-4 py-2 rounded-full text-sm font-medium">
                Save £960/year on callouts
            </div>
        </div>
    );
}

// Autopilot Animation Component
function AutopilotAnimation() {
    const [step, setStep] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setStep(s => (s + 1) % 4);
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    const steps = [
        { icon: <MessageSquare className="w-6 h-6" />, label: "Tenant reports issue", color: "bg-blue-500" },
        { icon: <Brain className="w-6 h-6" />, label: "AI assesses & quotes", color: "bg-purple-500" },
        { icon: <Calendar className="w-6 h-6" />, label: "Auto-books engineer", color: "bg-amber-500" },
        { icon: <CheckCircle2 className="w-6 h-6" />, label: "Job complete + photos", color: "bg-emerald-500" },
    ];

    return (
        <div className="relative w-72 h-[420px] flex items-center justify-center">
            <div className="space-y-6">
                {steps.map((s, i) => (
                    <div
                        key={i}
                        className={`flex items-center gap-4 transition-all duration-500 ${
                            i === step ? "scale-110 opacity-100" : "scale-100 opacity-40"
                        }`}
                    >
                        <div className={`w-12 h-12 rounded-full ${s.color} flex items-center justify-center text-white shadow-lg ${
                            i === step ? "animate-pulse" : ""
                        }`}>
                            {s.icon}
                        </div>
                        <div>
                            <p className={`text-sm font-medium ${i === step ? "text-white" : "text-slate-500"}`}>
                                {s.label}
                            </p>
                            {i === step && (
                                <p className="text-xs text-slate-400 animate-[fadeIn_0.3s_ease-out]">
                                    {i === 0 && "\"Boiler making weird noise\""}
                                    {i === 1 && "Category: Heating • Est: £120"}
                                    {i === 2 && "Tomorrow 2pm confirmed"}
                                    {i === 3 && "Photo report sent to you"}
                                </p>
                            )}
                        </div>
                    </div>
                ))}
                {/* Connection lines */}
                <div className="absolute left-6 top-24 w-0.5 h-48 bg-gradient-to-b from-blue-500 via-purple-500 to-emerald-500 opacity-30" />
            </div>
            {/* You badge */}
            <div className="absolute bottom-4 right-4 bg-slate-800 border border-slate-700 rounded-xl p-3 flex items-center gap-2">
                <Coffee className="w-5 h-5 text-amber-400" />
                <span className="text-sm text-slate-300">You: Relaxing</span>
            </div>
        </div>
    );
}

// Peace Animation Component
function PeaceAnimation() {
    return (
        <div className="relative w-72 h-[420px] flex items-center justify-center">
            {/* Central peaceful state */}
            <div className="relative">
                {/* Glowing orb */}
                <div className="w-48 h-48 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center animate-[pulse_3s_ease-in-out_infinite]">
                    <div className="w-36 h-36 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center">
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-500/50 to-orange-500/50 flex items-center justify-center">
                            <Coffee className="w-10 h-10 text-amber-300" />
                        </div>
                    </div>
                </div>

                {/* Floating benefits */}
                {[
                    { icon: "💰", label: "Rent collected", pos: "-top-8 -left-8" },
                    { icon: "😴", label: "Full night's sleep", pos: "-top-8 -right-8" },
                    { icon: "📱", label: "Phone silent", pos: "-bottom-8 -left-8" },
                    { icon: "✅", label: "Issues handled", pos: "-bottom-8 -right-8" },
                ].map((item, i) => (
                    <div
                        key={i}
                        className={`absolute ${item.pos} bg-slate-800/80 backdrop-blur rounded-xl px-3 py-2 flex items-center gap-2 animate-[float_3s_ease-in-out_infinite]`}
                        style={{ animationDelay: `${i * 0.5}s` }}
                    >
                        <span className="text-xl">{item.icon}</span>
                        <span className="text-xs text-slate-300">{item.label}</span>
                    </div>
                ))}
            </div>

            {/* Bottom message */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center">
                <p className="text-amber-400 font-semibold">The Dream</p>
                <p className="text-slate-400 text-sm">Passive income, actually passive</p>
            </div>
        </div>
    );
}

export default function LandlordOnboardingPage() {
    const [, setLocation] = useLocation();
    const [currentSlide, setCurrentSlide] = useState(0);
    const [showSignup, setShowSignup] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        phone: "",
        propertyCount: "1-3"
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const signupMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            const res = await fetch("/api/landlord/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || "Signup failed");
            }
            return res.json();
        },
        onSuccess: (data) => {
            setLocation(`/landlord/${data.token}/properties`);
        }
    });

    const validateForm = () => {
        const newErrors: Record<string, string> = {};
        if (!formData.name.trim()) newErrors.name = "Name is required";
        if (!formData.email.trim()) newErrors.email = "Email is required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = "Invalid email";
        if (!formData.phone.trim()) newErrors.phone = "Phone is required";
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validateForm()) signupMutation.mutate(formData);
    };

    const goToSlide = (index: number) => {
        if (isAnimating) return;
        setIsAnimating(true);
        setCurrentSlide(index);
        setTimeout(() => setIsAnimating(false), 500);
    };

    const nextSlide = () => {
        if (currentSlide < slides.length - 1) {
            goToSlide(currentSlide + 1);
        } else {
            setShowSignup(true);
        }
    };

    const prevSlide = () => {
        if (showSignup) {
            setShowSignup(false);
        } else if (currentSlide > 0) {
            goToSlide(currentSlide - 1);
        }
    };

    const slide = slides[currentSlide];

    // Signup Form
    if (showSignup) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <style>{`
                    @keyframes slideUp {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                `}</style>
                <div className="w-full max-w-md" style={{ animation: "slideUp 0.5s ease-out" }}>
                    <button
                        onClick={prevSlide}
                        className="mb-6 flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>

                    <div className="bg-white rounded-2xl shadow-2xl p-8">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Coffee className="w-8 h-8 text-amber-600" />
                            </div>
                            <h1 className="text-2xl font-bold text-slate-900">Start Your Peaceful Landlord Life</h1>
                            <p className="text-slate-600 mt-2">2 minutes to set up. Years of peace.</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${errors.name ? "border-red-500" : "border-slate-300"}`}
                                        placeholder="John Smith"
                                    />
                                </div>
                                {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${errors.email ? "border-red-500" : "border-slate-300"}`}
                                        placeholder="john@example.com"
                                    />
                                </div>
                                {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Phone (for WhatsApp updates)</label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 ${errors.phone ? "border-red-500" : "border-slate-300"}`}
                                        placeholder="+44 7XXX XXXXXX"
                                    />
                                </div>
                                {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Properties</label>
                                <div className="relative">
                                    <Home className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <select
                                        value={formData.propertyCount}
                                        onChange={(e) => setFormData({ ...formData, propertyCount: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 appearance-none bg-white"
                                    >
                                        <option value="1-3">1-3 properties</option>
                                        <option value="4-10">4-10 properties</option>
                                        <option value="11-25">11-25 properties</option>
                                        <option value="25+">25+ properties</option>
                                    </select>
                                </div>
                            </div>

                            {signupMutation.isError && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                                    {signupMutation.error?.message || "Something went wrong"}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={signupMutation.isPending}
                                className="w-full bg-amber-500 text-white py-3 rounded-lg font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {signupMutation.isPending ? (
                                    <><Loader2 className="w-5 h-5 animate-spin" /> Creating Account...</>
                                ) : (
                                    <>Get Started <ArrowRight className="w-5 h-5" /></>
                                )}
                            </button>
                        </form>

                        <p className="text-center text-sm text-slate-500 mt-6">
                            No credit card required. Cancel anytime.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen bg-gradient-to-br ${slide.bgGradient} transition-all duration-700`}>
            <style>{`
                @keyframes buzz {
                    0%, 100% { transform: translateX(0) rotate(0); }
                    25% { transform: translateX(-2px) rotate(-1deg); }
                    75% { transform: translateX(2px) rotate(1deg); }
                }
                @keyframes slideIn {
                    from { opacity: 0; transform: translateX(-20px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes fall {
                    0% { transform: translateY(-100%) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(200%) rotate(360deg); opacity: 0; }
                }
                @keyframes float {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideRight {
                    from { opacity: 0; transform: translateX(-30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
            `}</style>

            <div className="min-h-screen flex flex-col">
                {/* Header */}
                <header className="p-6 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Wrench className="w-6 h-6 text-white" />
                        <span className="text-white font-bold">Handy Services</span>
                    </div>
                    <button
                        onClick={() => setShowSignup(true)}
                        className="text-white/70 hover:text-white text-sm transition-colors"
                    >
                        Skip to signup →
                    </button>
                </header>

                {/* Main Content */}
                <main className="flex-1 flex items-center justify-center p-6">
                    <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-12 items-center">
                        {/* Left: Content */}
                        <div
                            key={currentSlide}
                            className="text-white"
                            style={{ animation: "slideRight 0.5s ease-out" }}
                        >
                            {/* Pain Point Badge */}
                            <div className="inline-flex items-center gap-2 bg-red-500/20 border border-red-500/30 text-red-300 px-4 py-2 rounded-full text-sm mb-6">
                                <XCircle className="w-4 h-4" />
                                {slide.painPoint}
                            </div>

                            <h1 className="text-4xl lg:text-5xl font-bold mb-4 leading-tight">
                                {slide.title}
                            </h1>

                            <p className="text-xl text-white/70 mb-8">
                                {slide.subtitle}
                            </p>

                            {/* Dream Badge */}
                            <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 px-4 py-2 rounded-full text-sm mb-6">
                                <CheckCircle2 className="w-4 h-4" />
                                The Solution: {slide.dream}
                            </div>

                            {/* Features */}
                            <ul className="space-y-4">
                                {slide.features.map((feature, idx) => (
                                    <li
                                        key={idx}
                                        className="flex items-center gap-4 text-white/90"
                                        style={{
                                            animation: "slideRight 0.5s ease-out",
                                            animationDelay: `${idx * 0.1}s`,
                                            animationFillMode: "both"
                                        }}
                                    >
                                        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                                            {feature.icon}
                                        </div>
                                        <span>{feature.text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Right: Animation */}
                        <div className="flex justify-center">
                            {slide.animation === "phone-buzz" && <PhoneBuzzAnimation />}
                            {slide.animation === "money-drain" && <MoneyDrainAnimation />}
                            {slide.animation === "autopilot" && <AutopilotAnimation />}
                            {slide.animation === "peace" && <PeaceAnimation />}
                        </div>
                    </div>
                </main>

                {/* Footer Navigation */}
                <footer className="p-6">
                    <div className="max-w-6xl mx-auto flex items-center justify-between">
                        {/* Progress Dots */}
                        <div className="flex gap-2">
                            {slides.map((_, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => goToSlide(idx)}
                                    className={`h-2 rounded-full transition-all duration-300 ${
                                        idx === currentSlide
                                            ? "bg-white w-8"
                                            : "bg-white/30 w-2 hover:bg-white/50"
                                    }`}
                                />
                            ))}
                        </div>

                        {/* Navigation Buttons */}
                        <div className="flex gap-4">
                            <button
                                onClick={prevSlide}
                                disabled={currentSlide === 0}
                                className="flex items-center gap-2 text-white/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5" />
                                Back
                            </button>

                            <button
                                onClick={nextSlide}
                                className="flex items-center gap-2 bg-white text-slate-900 px-6 py-3 rounded-full font-semibold hover:bg-white/90 transition-colors"
                            >
                                {currentSlide === slides.length - 1 ? "Get Started" : "Next"}
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
}
