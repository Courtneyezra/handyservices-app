import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
    Building2,
    MessageSquare,
    Wrench,
    Shield,
    Clock,
    CheckCircle,
    ArrowRight,
    Phone,
    Mail,
    User,
    Home,
    Loader2,
    Zap,
    Eye,
    PoundSterling,
    Star,
    CalendarCheck,
    Camera,
    Gift,
    PhoneOff,
    Users,
    TrendingDown,
    Minus,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { HandLogo, GoogleReviewsBadge } from "@/components/LandingShared";
import heroImage from "@assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp";
import videoQuoteImage from "@assets/123d3462-a11d-42b8-9fad-fdb2d6f29b11_1764600237774.webp";
import beforeImage from "@assets/74cb4082-17d2-48b1-bd98-bf51f85bc7a5_(1)_1764694445995.webp";
import afterImage from "@assets/cb5e8951-9d46-4023-9909-510a89d3da60_1764693845208.webp";
import realJobToilet from "@assets/c33e343a-3b9d-4d85-97cb-a0752ea3e80d_1764687156907.webp";
import realJobSink from "@assets/cf7cd976-8854-4abb-a7dd-391a08c63978_1764687156908.webp";
import realJobKitchen from "@assets/4cc2f0fa-125e-412b-9929-4e03a055b760_1764687156909.webp";

// ─── Savings Calculator ────────────────────────────────────────────────
function SavingsCalculator() {
    const [properties, setProperties] = useState(3);

    // Calculations based on documented value analysis
    const agentMonthlyFee = 100; // avg £50-150, use £100 midpoint
    const agentMarkupPerJob = 70; // avg £40-100 markup
    const avgJobsPerPropertyPerYear = 3;
    const aiResolutionRate = 0.30; // 25-35%, use 30%
    const avgCalloutCost = 100; // £50-150, midpoint

    const totalJobsPerYear = properties * avgJobsPerPropertyPerYear;
    const aiResolvedJobs = Math.round(totalJobsPerYear * aiResolutionRate);
    const paidJobsPerYear = totalJobsPerYear - aiResolvedJobs;

    // Estate agent costs
    const agentFeeAnnual = properties * agentMonthlyFee * 12;
    const agentMarkupAnnual = totalJobsPerYear * agentMarkupPerJob;
    const agentTotalAnnual = agentFeeAnnual + agentMarkupAnnual;

    // Handy Services costs (trade prices, no markup, AI resolves some for free)
    const aiSavings = aiResolvedJobs * avgCalloutCost;

    // Total savings
    const totalSavingsAnnual = agentFeeAnnual + agentMarkupAnnual + aiSavings;
    const totalSavingsMonthly = Math.round(totalSavingsAnnual / 12);

    return (
        <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-12">
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 mb-4">
                        How Much Could{" "}
                        <span className="text-amber-500">You Save?</span>
                    </h2>
                    <p className="text-slate-500 text-lg font-medium max-w-2xl mx-auto">
                        See what you're spending on estate agent maintenance management — and what you'd save with us.
                    </p>
                </div>

                <div className="bg-slate-900 rounded-3xl p-6 sm:p-10 border border-slate-800">
                    {/* Slider */}
                    <div className="mb-10">
                        <div className="flex items-center justify-between mb-4">
                            <label className="text-white font-bold text-lg">How many properties?</label>
                            <div className="bg-amber-400 text-slate-900 font-bold text-2xl px-5 py-2 rounded-2xl min-w-[80px] text-center">
                                {properties}
                            </div>
                        </div>
                        <input
                            type="range"
                            min={1}
                            max={20}
                            value={properties}
                            onChange={(e) => setProperties(Number(e.target.value))}
                            className="w-full h-3 rounded-full appearance-none cursor-pointer bg-slate-700 accent-amber-400"
                            style={{
                                background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${((properties - 1) / 19) * 100}%, #334155 ${((properties - 1) / 19) * 100}%, #334155 100%)`,
                            }}
                        />
                        <div className="flex justify-between text-slate-500 text-xs mt-2">
                            <span>1</span>
                            <span>5</span>
                            <span>10</span>
                            <span>15</span>
                            <span>20</span>
                        </div>
                    </div>

                    {/* Comparison */}
                    <div className="grid md:grid-cols-2 gap-6 mb-8">
                        {/* Estate Agent */}
                        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-3 h-3 rounded-full bg-red-400" />
                                <h3 className="text-red-400 font-bold text-sm uppercase tracking-wide">With Estate Agent</h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Management fee ({properties} x £{agentMonthlyFee}/mo)</span>
                                    <span className="text-white font-semibold">£{agentFeeAnnual.toLocaleString()}/yr</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Job markups ({totalJobsPerYear} jobs x £{agentMarkupPerJob})</span>
                                    <span className="text-white font-semibold">£{agentMarkupAnnual.toLocaleString()}/yr</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">AI-resolved fixes</span>
                                    <span className="text-red-400 font-semibold">None — all callouts</span>
                                </div>
                                <div className="border-t border-slate-700 pt-3 flex justify-between">
                                    <span className="text-slate-300 font-bold">Total annual cost</span>
                                    <span className="text-red-400 font-bold text-xl">£{agentTotalAnnual.toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        {/* Handy Services */}
                        <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-3 h-3 rounded-full bg-green-400" />
                                <h3 className="text-green-400 font-bold text-sm uppercase tracking-wide">With Handy Services</h3>
                            </div>
                            <div className="space-y-3">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Platform fee</span>
                                    <span className="text-green-400 font-semibold">FREE</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Job markup</span>
                                    <span className="text-green-400 font-semibold">£0 — trade prices</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">AI-resolved fixes ({aiResolvedJobs} of {totalJobsPerYear} issues)</span>
                                    <span className="text-green-400 font-semibold">£{aiSavings.toLocaleString()} saved</span>
                                </div>
                                <div className="border-t border-slate-700 pt-3 flex justify-between">
                                    <span className="text-slate-300 font-bold">You only pay for</span>
                                    <span className="text-green-400 font-bold text-xl">{paidJobsPerYear} actual jobs</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Total savings */}
                    <div className="bg-amber-400 rounded-2xl p-6 sm:p-8 text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                            <TrendingDown className="w-6 h-6 text-slate-800" />
                            <span className="text-slate-700 font-bold text-sm uppercase tracking-wide">Your estimated annual savings</span>
                        </div>
                        <div className="text-4xl sm:text-5xl font-bold text-slate-900 mb-1">
                            £{totalSavingsAnnual.toLocaleString()}
                        </div>
                        <p className="text-slate-700 font-medium">
                            That's <span className="font-bold">£{totalSavingsMonthly}/month</span> back in your pocket
                        </p>
                    </div>

                    <div className="mt-6 text-center">
                        <a
                            href="#signup"
                            className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-500 text-slate-900 px-8 py-4 rounded-full font-bold text-sm transition-all"
                        >
                            Start Saving Now
                            <ArrowRight className="w-4 h-4" />
                        </a>
                        <p className="text-slate-500 text-xs mt-3">
                            Based on avg estate agent maintenance fee of £{agentMonthlyFee}/property/month and avg £{agentMarkupPerJob} markup per job
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}

// ─── Signup Form (reused in hero + final CTA) ─────────────────────────
function SignupForm({ dark = false }: { dark?: boolean }) {
    const [, setLocation] = useLocation();
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        phone: "",
        propertyCount: "1-3",
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const signupMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            const res = await fetch("/api/landlord/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || "Signup failed");
            }
            return res.json();
        },
        onSuccess: (data) => {
            setLocation(`/landlord/${data.token}/properties`);
        },
    });

    const validateForm = () => {
        const newErrors: Record<string, string> = {};
        if (!formData.name.trim()) newErrors.name = "Name is required";
        if (!formData.email.trim()) {
            newErrors.email = "Email is required";
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = "Invalid email address";
        }
        if (!formData.phone.trim()) {
            newErrors.phone = "Phone is required";
        } else if (!/^[\d\s+()-]{10,}$/.test(formData.phone)) {
            newErrors.phone = "Invalid phone number";
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validateForm()) signupMutation.mutate(formData);
    };

    const inputBase = dark
        ? "bg-slate-700 border-slate-600 text-white placeholder:text-slate-400 focus:ring-amber-400 focus:border-amber-400"
        : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-amber-400 focus:border-amber-400";
    const iconColor = dark ? "text-slate-400" : "text-slate-400";

    const inputClass = (field: string) =>
        `w-full pl-10 pr-4 py-3.5 border rounded-full text-sm focus:ring-2 outline-none transition-all ${inputBase} ${
            errors[field] ? "border-red-400 bg-red-50/10" : ""
        }`;

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div>
                <div className="relative">
                    <User className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${iconColor}`} />
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={inputClass("name")}
                        placeholder="Full name"
                    />
                </div>
                {errors.name && <p className="text-red-400 text-xs mt-1 pl-4">{errors.name}</p>}
            </div>

            <div>
                <div className="relative">
                    <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${iconColor}`} />
                    <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className={inputClass("email")}
                        placeholder="Email address"
                    />
                </div>
                {errors.email && <p className="text-red-400 text-xs mt-1 pl-4">{errors.email}</p>}
            </div>

            <div>
                <div className="relative">
                    <Phone className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${iconColor}`} />
                    <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className={inputClass("phone")}
                        placeholder="+44 7XXX XXXXXX"
                    />
                </div>
                {errors.phone && <p className="text-red-400 text-xs mt-1 pl-4">{errors.phone}</p>}
            </div>

            <div>
                <div className="relative">
                    <Home className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${iconColor}`} />
                    <select
                        value={formData.propertyCount}
                        onChange={(e) => setFormData({ ...formData, propertyCount: e.target.value })}
                        className={`w-full pl-10 pr-4 py-3.5 border rounded-full text-sm focus:ring-2 outline-none appearance-none ${inputBase}`}
                    >
                        <option value="1-3">1-3 properties</option>
                        <option value="4-10">4-10 properties</option>
                        <option value="11-25">11-25 properties</option>
                        <option value="25+">25+ properties</option>
                    </select>
                </div>
            </div>

            {signupMutation.isError && (
                <div className="bg-red-500/10 text-red-400 p-3 rounded-xl text-sm">
                    {signupMutation.error?.message || "Something went wrong. Please try again."}
                </div>
            )}

            <button
                type="submit"
                disabled={signupMutation.isPending}
                className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 py-4 rounded-full font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {signupMutation.isPending ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Creating Account...
                    </>
                ) : (
                    <>
                        Get Started Free
                        <ArrowRight className="w-4 h-4" />
                    </>
                )}
            </button>

            <p className={`text-center text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
                No credit card required. Set up in 2 minutes.
            </p>
        </form>
    );
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function LandlordOnboardingPage() {
    return (
        <div className="min-h-screen" style={{ fontFamily: "'Poppins', sans-serif" }}>
            {/* ── NAV BAR ───────────────────────────────────────── */}
            <nav className="bg-slate-900 px-4 lg:px-8 py-4">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <HandLogo className="w-10 h-10 md:w-12 md:h-12" />
                        <div>
                            <span className="text-white font-bold text-lg md:text-xl">Handy Services</span>
                            <span className="hidden md:block text-amber-400 text-xs font-medium">Landlord Platform</span>
                        </div>
                    </div>
                    <a
                        href="#signup"
                        className="bg-amber-400 hover:bg-amber-500 text-slate-900 px-5 py-2.5 rounded-full font-bold text-sm transition-all"
                    >
                        Get Started
                    </a>
                </div>
            </nav>

            {/* ── HERO ────────────────────────────────────────── */}
            <section className="bg-slate-900 px-4 lg:px-8 py-16 lg:py-24 relative overflow-hidden">
                {/* Subtle gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 opacity-50" />

                <div className="relative max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
                        {/* Left: Copy */}
                        <div>
                            <div className="inline-flex items-center gap-2 bg-amber-400/10 text-amber-400 px-4 py-2 rounded-full text-sm font-bold mb-8">
                                <Zap className="w-4 h-4" />
                                For Landlords Who Want Less Hassle
                            </div>

                            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.1]">
                                Stop Paying Estate Agents to{" "}
                                <span className="text-amber-400">Answer a Phone</span>
                            </h1>

                            <p className="mt-6 text-lg sm:text-xl text-white/60 leading-relaxed max-w-lg font-medium">
                                Your own maintenance platform. Tenants report via WhatsApp.
                                AI handles the simple stuff. You only pay when a real tradesperson is needed.
                            </p>

                            <div className="mt-8 grid grid-cols-2 gap-4 max-w-md">
                                {[
                                    { icon: <PhoneOff className="w-4 h-4" />, text: "No phone tag" },
                                    { icon: <PoundSterling className="w-4 h-4" />, text: "No agent markups" },
                                    { icon: <Zap className="w-4 h-4" />, text: "AI-resolved fixes" },
                                    { icon: <Shield className="w-4 h-4" />, text: "£2M fully insured" },
                                ].map((item, idx) => (
                                    <span key={idx} className="flex items-center gap-2 text-white/80 text-sm">
                                        <span className="text-amber-400">{item.icon}</span>
                                        {item.text}
                                    </span>
                                ))}
                            </div>

                            {/* Mobile: CTA button */}
                            <div className="mt-8 lg:hidden">
                                <a
                                    href="#signup"
                                    className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-500 text-slate-900 px-8 py-4 rounded-full font-bold text-sm transition-all"
                                >
                                    Get Started Free
                                    <ArrowRight className="w-4 h-4" />
                                </a>
                            </div>

                            <div className="mt-8 hidden lg:flex items-center gap-3">
                                <GoogleReviewsBadge />
                            </div>
                        </div>

                        {/* Right: Signup Form */}
                        <div id="signup" className="bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700">
                            <div className="text-center mb-6">
                                <h2 className="text-xl font-bold text-white">
                                    Set up your platform
                                </h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    Free account. No card needed. 2 minutes.
                                </p>
                            </div>
                            <SignupForm dark />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── TRUST BAR ───────────────────────────────────── */}
            <section className="bg-amber-400 px-4 lg:px-8 py-5">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-slate-800 font-medium">
                        <span className="flex items-center gap-2">
                            <Shield className="w-4 h-4" />
                            £2M Insured
                        </span>
                        <span className="flex items-center gap-2">
                            <Star className="w-4 h-4 fill-slate-800" />
                            4.9/5 Google (127 reviews)
                        </span>
                        <span className="flex items-center gap-2">
                            <Building2 className="w-4 h-4" />
                            180+ Landlords Trust Us
                        </span>
                        <span className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            48-72hr Response
                        </span>
                    </div>
                </div>
            </section>

            {/* ── PAIN POINTS ─────────────────────────────────── */}
            <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-12 lg:mb-16">
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 mb-4">
                            Sound <span className="text-amber-500">Familiar?</span>
                        </h2>
                        <p className="text-slate-500 text-lg font-medium max-w-2xl mx-auto">
                            Managing rental properties shouldn't feel like a second job.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                        {[
                            {
                                icon: <Phone className="w-6 h-6" />,
                                title: "Endless phone tag with tenants",
                                desc: "Missed calls, voicemails, texts at 11pm about a dripping tap. You're not a 24/7 call centre.",
                                accent: "bg-red-50 text-red-500 border-red-100",
                            },
                            {
                                icon: <PoundSterling className="w-6 h-6" />,
                                title: "Estate agent markups on repairs",
                                desc: "Your agent charges £150+ for a job that costs £69. You're paying their margin on top of the work.",
                                accent: "bg-red-50 text-red-500 border-red-100",
                            },
                            {
                                icon: <Clock className="w-6 h-6" />,
                                title: "Weeks waiting for a simple fix",
                                desc: "Tenant reports a leaky tap. Agent logs it. Finds a contractor. Schedules. 2 weeks later, still dripping.",
                                accent: "bg-red-50 text-red-500 border-red-100",
                            },
                            {
                                icon: <Eye className="w-6 h-6" />,
                                title: "No visibility on what's happening",
                                desc: "Was the job done? How much did it cost? Where's the invoice? You're chasing your agent for updates.",
                                accent: "bg-red-50 text-red-500 border-red-100",
                            },
                            {
                                icon: <Users className="w-6 h-6" />,
                                title: "Random contractors every time",
                                desc: "Different tradesperson each visit. No accountability. No relationship with your property.",
                                accent: "bg-red-50 text-red-500 border-red-100",
                            },
                            {
                                icon: <CalendarCheck className="w-6 h-6" />,
                                title: "Reactive, never proactive",
                                desc: "Small issues become big problems. Nobody checks gutters, bleeds radiators, or tests smoke alarms until it's too late.",
                                accent: "bg-red-50 text-red-500 border-red-100",
                            },
                        ].map((item, idx) => (
                            <div
                                key={idx}
                                className={`rounded-2xl border p-6 lg:p-8 ${item.accent}`}
                            >
                                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center mb-4 shadow-sm">
                                    {item.icon}
                                </div>
                                <h3 className="text-lg font-bold text-slate-800 mb-2">{item.title}</h3>
                                <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── HOW IT WORKS ────────────────────────────────── */}
            <section className="bg-slate-700 px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-12 lg:mb-16">
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                            <span className="text-amber-400">How It Works</span>{" "}
                            <span className="text-white">— 3 Simple Steps</span>
                        </h2>
                        <p className="text-white/60 text-lg font-medium">
                            From tenant report to resolved issue — without you lifting a finger.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
                        {[
                            {
                                step: "1",
                                title: "Tenant texts WhatsApp",
                                desc: "Your tenant messages a single WhatsApp number. Describes the problem. Takes 30 seconds. No app to download.",
                                highlight: true,
                            },
                            {
                                step: "2",
                                title: "AI triages the issue",
                                desc: "Our AI suggests one quick check. Dripping tap? Try closing it firmly. Cold radiator? Bleed it. Simple issues resolved for free.",
                                highlight: false,
                            },
                            {
                                step: "3",
                                title: "Handyman dispatched",
                                desc: "If DIY doesn't fix it, we book a handyman automatically. You get notified. One-tap approval from your phone.",
                                highlight: false,
                            },
                        ].map((item, idx) => (
                            <div
                                key={idx}
                                className={`relative p-8 lg:p-10 rounded-3xl text-center ${
                                    item.highlight ? "bg-amber-400 text-slate-900" : "bg-white text-slate-800"
                                }`}
                            >
                                <div
                                    className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl font-bold ${
                                        item.highlight ? "bg-slate-800 text-amber-400" : "bg-slate-100 text-slate-800"
                                    }`}
                                >
                                    {item.step}
                                </div>
                                <h3 className="text-xl lg:text-2xl font-bold mb-3">{item.title}</h3>
                                <p className={`${item.highlight ? "text-slate-700" : "text-slate-500"} leading-relaxed`}>
                                    {item.desc}
                                </p>

                                {idx < 2 && (
                                    <div className="hidden md:block absolute top-1/2 -right-4 lg:-right-6 transform -translate-y-1/2">
                                        <ArrowRight className="w-8 h-8 text-white/30" />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── WHATSAPP DEMO ───────────────────────────────── */}
            <section className="bg-slate-900 px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-12 items-center">
                        {/* Left: Phone mockup */}
                        <div className="flex justify-center order-2 lg:order-1">
                            <div className="relative">
                                <div className="w-72 sm:w-80 bg-slate-700 rounded-[2.5rem] p-3 shadow-2xl">
                                    <div className="w-full bg-white rounded-[2rem] overflow-hidden">
                                        {/* WhatsApp Header */}
                                        <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-3">
                                            <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center">
                                                <Wrench className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-sm">Handy Services</p>
                                                <p className="text-[10px] text-white/70">Online</p>
                                            </div>
                                        </div>

                                        {/* Chat */}
                                        <div className="p-3 space-y-2.5 bg-[#ECE5DD] min-h-[340px]">
                                            <div className="bg-white rounded-lg p-2.5 max-w-[80%] shadow-sm">
                                                <p className="text-xs text-stone-700">Kitchen tap won't stop dripping</p>
                                                <p className="text-[9px] text-stone-400 text-right mt-1">10:30</p>
                                            </div>

                                            <div className="bg-[#DCF8C6] rounded-lg p-2.5 max-w-[80%] ml-auto shadow-sm">
                                                <p className="text-xs text-stone-700">
                                                    Let's sort that out! Try turning the tap firmly to fully closed — don't force it. Did that stop the drip?
                                                </p>
                                                <p className="text-[9px] text-stone-400 text-right mt-1">10:31</p>
                                            </div>

                                            <div className="bg-white rounded-lg p-2.5 max-w-[80%] shadow-sm">
                                                <p className="text-xs text-stone-700">No still dripping</p>
                                                <p className="text-[9px] text-stone-400 text-right mt-1">10:32</p>
                                            </div>

                                            <div className="bg-[#DCF8C6] rounded-lg p-2.5 max-w-[80%] ml-auto shadow-sm">
                                                <p className="text-xs text-stone-700">
                                                    No problem — I'll get a handyman booked for you. Can you snap a quick photo of the tap? Your landlord has been notified.
                                                </p>
                                                <p className="text-[9px] text-stone-400 text-right mt-1">10:32</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Floating badge */}
                                <div className="absolute -top-3 -right-3 bg-amber-400 text-slate-900 px-4 py-2 rounded-full text-xs font-bold shadow-lg">
                                    Light-Touch AI
                                </div>
                            </div>
                        </div>

                        {/* Right: Copy */}
                        <div className="order-1 lg:order-2">
                            <div className="inline-flex items-center gap-2 bg-green-500/10 text-green-400 px-4 py-2 rounded-full text-sm font-bold mb-6">
                                <SiWhatsapp className="w-4 h-4" />
                                WhatsApp Powered
                            </div>

                            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
                                Your Tenant Texts.{" "}
                                <span className="text-amber-400">We Handle It.</span>
                            </h2>

                            <p className="text-white/60 text-lg mb-8 max-w-lg font-medium leading-relaxed">
                                No app for tenants to download. No portal to learn. Just WhatsApp — the app they already use every day.
                            </p>

                            <div className="space-y-4">
                                {[
                                    { icon: <MessageSquare className="w-5 h-5" />, text: "Tenant describes the issue in plain English" },
                                    { icon: <Zap className="w-5 h-5" />, text: "AI suggests one quick DIY check first" },
                                    { icon: <Wrench className="w-5 h-5" />, text: "If it's not fixed, handyman booked same day" },
                                    { icon: <Camera className="w-5 h-5" />, text: "Photo requested so we come prepared" },
                                ].map((step, idx) => (
                                    <div key={idx} className="flex items-start gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-amber-400/10 text-amber-400 flex items-center justify-center flex-shrink-0">
                                            {step.icon}
                                        </div>
                                        <span className="text-white/80 text-sm pt-2">{step.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── YOUR PLATFORM ────────────────────────────────── */}
            <section className="bg-white px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-12 lg:mb-16">
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-800 mb-4">
                            Your Own <span className="text-amber-500">Landlord Dashboard</span>
                        </h2>
                        <p className="text-slate-500 text-lg font-medium max-w-2xl mx-auto">
                            Everything you need to manage your properties — no estate agent required.
                        </p>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[
                            {
                                icon: <Building2 className="w-8 h-8" />,
                                title: "Onboard Properties",
                                desc: "Add your properties and register tenants in minutes.",
                                bg: "bg-slate-800",
                            },
                            {
                                icon: <Eye className="w-8 h-8" />,
                                title: "Track Every Issue",
                                desc: "See what's reported, what's in progress, and what's resolved.",
                                bg: "bg-slate-800",
                            },
                            {
                                icon: <PoundSterling className="w-8 h-8" />,
                                title: "Transparent Pricing",
                                desc: "Fixed prices. No hidden fees. Tax-ready invoices after every job.",
                                bg: "bg-slate-800",
                            },
                            {
                                icon: <Camera className="w-8 h-8" />,
                                title: "Photo Reports",
                                desc: "Before and after photos for every job. Full accountability.",
                                bg: "bg-slate-800",
                            },
                        ].map((item, idx) => (
                            <div
                                key={idx}
                                className={`${item.bg} rounded-3xl p-8 text-center group hover:transform hover:scale-105 transition-all duration-300`}
                            >
                                <div className="w-16 h-16 bg-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-5 text-slate-900">
                                    {item.icon}
                                </div>
                                <h3 className="text-white font-bold text-lg mb-2">{item.title}</h3>
                                <p className="text-white/60 text-sm leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── SAVINGS SECTION ─────────────────────────────── */}
            <section className="bg-amber-400 px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-7xl mx-auto">
                    <div className="grid lg:grid-cols-2 gap-12 items-center">
                        <div>
                            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 mb-6 leading-tight">
                                Save Money on Every Repair
                            </h2>
                            <p className="text-slate-700 text-lg mb-8 max-w-lg font-medium">
                                Cut out the middleman. Deal directly with us. Our AI resolves simple issues for free — and when a pro is needed, you pay trade prices, not estate agent prices.
                            </p>

                            <div className="grid sm:grid-cols-2 gap-4 mb-8">
                                <div className="bg-white rounded-2xl p-5 text-center">
                                    <p className="text-3xl font-bold text-slate-800 mb-1">25-35%</p>
                                    <p className="text-slate-500 text-sm">Fewer callouts with AI</p>
                                </div>
                                <div className="bg-white rounded-2xl p-5 text-center">
                                    <p className="text-3xl font-bold text-slate-800 mb-1">£50-150</p>
                                    <p className="text-slate-500 text-sm">Saved per deflected issue</p>
                                </div>
                                <div className="bg-white rounded-2xl p-5 text-center">
                                    <p className="text-3xl font-bold text-slate-800 mb-1">0%</p>
                                    <p className="text-slate-500 text-sm">Estate agent markup</p>
                                </div>
                                <div className="bg-white rounded-2xl p-5 text-center">
                                    <p className="text-3xl font-bold text-slate-800 mb-1">Free</p>
                                    <p className="text-slate-500 text-sm">Landlord platform access</p>
                                </div>
                            </div>

                            <a
                                href="#signup"
                                className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-8 py-4 rounded-full font-bold text-sm transition-all"
                            >
                                Start Saving Now
                                <ArrowRight className="w-4 h-4" />
                            </a>
                        </div>

                        <div className="relative rounded-3xl overflow-hidden max-w-xl shadow-2xl">
                            <img
                                src={videoQuoteImage}
                                alt="Handy Services technician"
                                className="w-full h-auto object-contain"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* ── SAVINGS CALCULATOR ─────────────────────────── */}
            <SavingsCalculator />

            {/* ── QUARTERLY MAINTENANCE ────────────────────────── */}
            <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-12 lg:mb-16">
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
                            Prevent Problems{" "}
                            <span className="text-amber-400">Before They Start</span>
                        </h2>
                        <p className="text-white/60 text-lg font-medium max-w-2xl mx-auto">
                            Tenants opt in for quarterly maintenance tasks — and earn rewards for keeping your property in shape.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
                        {[
                            {
                                icon: <CalendarCheck className="w-6 h-6" />,
                                title: "Quarterly Check-ups",
                                desc: "Bleed radiators, test smoke alarms, check gutters. Small tasks that prevent big problems.",
                            },
                            {
                                icon: <Gift className="w-6 h-6" />,
                                title: "Tenant Rewards",
                                desc: "Tenants earn points for completing tasks. Redeemable for vouchers and perks. They're incentivised to care.",
                            },
                            {
                                icon: <Shield className="w-6 h-6" />,
                                title: "Protect Your Investment",
                                desc: "Proactive maintenance means fewer emergency callouts, lower costs, and happier tenants who stay longer.",
                            },
                        ].map((item, idx) => (
                            <div key={idx} className="bg-slate-700/50 rounded-2xl p-8 hover:bg-slate-700 transition-colors">
                                <div className="w-12 h-12 rounded-xl bg-amber-400/10 text-amber-400 flex items-center justify-center mb-5">
                                    {item.icon}
                                </div>
                                <h3 className="text-white font-bold text-lg mb-2">{item.title}</h3>
                                <p className="text-white/60 text-sm leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── BEFORE / AFTER ───────────────────────────────── */}
            <section className="bg-amber-500 px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-12 lg:mb-16">
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-slate-900 mb-4">
                            Before & After
                        </h2>
                        <p className="text-slate-700 text-lg font-medium">Real jobs. Real results. Photo proof included with every visit.</p>
                    </div>

                    <div className="grid lg:grid-cols-2 gap-8">
                        <div className="bg-white rounded-3xl overflow-hidden shadow-xl">
                            <div className="p-6">
                                <span className="inline-block bg-slate-200 text-slate-700 font-bold px-4 py-1 rounded-full text-sm mb-4">Before</span>
                                <div className="aspect-video bg-slate-100 rounded-2xl overflow-hidden">
                                    <img src={beforeImage} alt="Before — maintenance issue" className="w-full h-full object-contain" />
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-3xl overflow-hidden shadow-xl">
                            <div className="p-6">
                                <span className="inline-block bg-amber-400 text-slate-900 font-bold px-4 py-1 rounded-full text-sm mb-4">After</span>
                                <div className="aspect-video bg-slate-100 rounded-2xl overflow-hidden">
                                    <img src={afterImage} alt="After — job completed" className="w-full h-full object-contain" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── REAL JOBS ────────────────────────────────────── */}
            <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-12 lg:mb-16">
                        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
                            Real Jobs. <span className="text-amber-400">Real Properties.</span>
                        </h2>
                        <p className="text-white/60 text-lg font-medium">Work we've completed for landlords across Nottingham & Derby</p>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-6">
                        {[
                            { image: realJobToilet, job: "Bathroom plumbing repair" },
                            { image: realJobSink, job: "Sink installation" },
                            { image: realJobKitchen, job: "Kitchen cabinet fitting" },
                        ].map((item, idx) => (
                            <div key={idx} className="bg-slate-700 rounded-2xl overflow-hidden group hover:bg-slate-600 transition-colors">
                                <div className="aspect-video bg-slate-600 overflow-hidden">
                                    <img
                                        src={item.image}
                                        alt={item.job}
                                        loading="lazy"
                                        className="w-full h-full object-contain bg-slate-700"
                                    />
                                </div>
                                <div className="p-5">
                                    <p className="text-white font-bold">{item.job}</p>
                                    <p className="text-amber-400 text-sm mt-1">Rental property</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── TESTIMONIAL ─────────────────────────────────── */}
            <section className="bg-white px-4 lg:px-8 py-16 lg:py-20">
                <div className="max-w-3xl mx-auto text-center">
                    <div className="flex justify-center gap-1 mb-6">
                        {[...Array(5)].map((_, i) => (
                            <Star key={i} className="w-6 h-6 fill-amber-400 text-amber-400" />
                        ))}
                    </div>
                    <blockquote className="text-xl sm:text-2xl font-medium text-slate-800 leading-relaxed italic">
                        "I live 2 hours away from my rental. They coordinated with my tenant, sent photos, and the invoice was in my email by 5pm. Exactly what I needed."
                    </blockquote>
                    <div className="mt-6">
                        <span className="font-bold text-slate-800">Sarah T.</span>
                        <span className="text-slate-500 ml-2">— Landlord, 2 properties in Derby</span>
                    </div>
                </div>
            </section>

            {/* ── GUARANTEES ──────────────────────────────────── */}
            <section className="bg-slate-700 px-4 lg:px-8 py-16 lg:py-20">
                <div className="max-w-7xl mx-auto">
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[
                            { icon: <Clock className="w-6 h-6" />, title: "48-72hr response", sub: "Every time, guaranteed" },
                            { icon: <CheckCircle className="w-6 h-6" />, title: "Fixed prices", sub: "No hidden fees, ever" },
                            { icon: <Shield className="w-6 h-6" />, title: "£2M insured", sub: "Full peace of mind" },
                            { icon: <Star className="w-6 h-6" />, title: "Not right? We fix it free", sub: "No questions asked" },
                        ].map((item, idx) => (
                            <div key={idx} className="text-center">
                                <div className="w-14 h-14 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center mx-auto mb-4">
                                    {item.icon}
                                </div>
                                <h3 className="text-white font-bold mb-1">{item.title}</h3>
                                <p className="text-white/50 text-sm">{item.sub}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── FINAL CTA ───────────────────────────────────── */}
            <section className="bg-slate-900 px-4 lg:px-8 py-16 lg:py-24">
                <div className="max-w-xl mx-auto text-center">
                    <HandLogo className="w-16 h-16 mx-auto mb-6" />
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight">
                        Ready to Ditch the{" "}
                        <span className="text-amber-400">Middleman?</span>
                    </h2>
                    <p className="mt-4 text-white/60 text-lg font-medium">
                        Join 180+ landlords who manage maintenance the smart way. Direct. Transparent. Affordable.
                    </p>

                    <div className="mt-8 bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700 text-left">
                        <SignupForm dark />
                    </div>

                    <p className="mt-6 text-slate-500 text-xs">
                        By signing up, you agree to our{" "}
                        <a href="/terms" className="underline hover:text-slate-300">Terms of Service</a>
                        {" "}and{" "}
                        <a href="/privacy" className="underline hover:text-slate-300">Privacy Policy</a>
                    </p>
                </div>
            </section>

            {/* ── FOOTER ──────────────────────────────────────── */}
            <footer className="bg-slate-950 px-4 lg:px-8 py-8">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <HandLogo className="w-8 h-8" />
                        <span className="text-white/60 text-sm">Handy Services Ltd</span>
                    </div>
                    <p className="text-white/40 text-xs">
                        Nottingham & Derby • £2M insured • DBS checked
                    </p>
                </div>
            </footer>
        </div>
    );
}
