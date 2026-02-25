import { useState } from "react";
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
    Loader2
} from "lucide-react";

interface SlideContent {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    features: string[];
    image?: string;
}

const slides: SlideContent[] = [
    {
        title: "Property Maintenance Made Easy",
        subtitle: "Let AI handle tenant issues before they become expensive jobs",
        icon: <Building2 className="w-16 h-16 text-primary" />,
        features: [
            "Tenants report issues via WhatsApp",
            "AI tries DIY fixes first - saving you money",
            "Only escalates when professional help needed",
            "You stay in control with approval rules"
        ]
    },
    {
        title: "Save Money on Simple Fixes",
        subtitle: "15-25% of issues resolved without a callout",
        icon: <Wrench className="w-16 h-16 text-primary" />,
        features: [
            "Dripping tap? AI guides tenant to fix it",
            "Blocked drain? Step-by-step plunger instructions",
            "Cold radiator? Bleeding guide sent instantly",
            "No callout fee for DIY-resolved issues"
        ]
    },
    {
        title: "Stay Informed, Stay in Control",
        subtitle: "Real-time updates and approval workflows",
        icon: <MessageSquare className="w-16 h-16 text-primary" />,
        features: [
            "WhatsApp notifications for new issues",
            "Set auto-approval thresholds (e.g., under £150)",
            "Photo evidence from tenants",
            "One-click quote approval"
        ]
    },
    {
        title: "Professional When You Need It",
        subtitle: "Vetted handymen, transparent pricing",
        icon: <Shield className="w-16 h-16 text-primary" />,
        features: [
            "£2M public liability insurance",
            "Background-checked tradespeople",
            "Fixed prices, no surprises",
            "Photo report after every job"
        ]
    }
];

export default function LandlordOnboardingPage() {
    const [, setLocation] = useLocation();
    const [currentSlide, setCurrentSlide] = useState(0);
    const [showSignup, setShowSignup] = useState(false);
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
            // Redirect to landlord portal
            setLocation(`/landlord/${data.token}/properties`);
        }
    });

    const validateForm = () => {
        const newErrors: Record<string, string> = {};

        if (!formData.name.trim()) {
            newErrors.name = "Name is required";
        }

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
        if (validateForm()) {
            signupMutation.mutate(formData);
        }
    };

    const nextSlide = () => {
        if (currentSlide < slides.length - 1) {
            setCurrentSlide(currentSlide + 1);
        } else {
            setShowSignup(true);
        }
    };

    const prevSlide = () => {
        if (showSignup) {
            setShowSignup(false);
        } else if (currentSlide > 0) {
            setCurrentSlide(currentSlide - 1);
        }
    };

    if (showSignup) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    {/* Back Button */}
                    <button
                        onClick={prevSlide}
                        className="mb-6 flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>

                    {/* Signup Card */}
                    <div className="bg-white rounded-2xl shadow-2xl p-8">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Building2 className="w-8 h-8 text-primary" />
                            </div>
                            <h1 className="text-2xl font-bold text-slate-900">Create Your Account</h1>
                            <p className="text-slate-600 mt-2">Start managing your properties smarter</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* Name */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Full Name
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary ${
                                            errors.name ? "border-red-500" : "border-slate-300"
                                        }`}
                                        placeholder="John Smith"
                                    />
                                </div>
                                {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                            </div>

                            {/* Email */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Email Address
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary ${
                                            errors.email ? "border-red-500" : "border-slate-300"
                                        }`}
                                        placeholder="john@example.com"
                                    />
                                </div>
                                {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
                            </div>

                            {/* Phone */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Phone Number (for WhatsApp updates)
                                </label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary ${
                                            errors.phone ? "border-red-500" : "border-slate-300"
                                        }`}
                                        placeholder="+44 7XXX XXXXXX"
                                    />
                                </div>
                                {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
                            </div>

                            {/* Property Count */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    How many properties do you manage?
                                </label>
                                <div className="relative">
                                    <Home className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <select
                                        value={formData.propertyCount}
                                        onChange={(e) => setFormData({ ...formData, propertyCount: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary appearance-none bg-white"
                                    >
                                        <option value="1-3">1-3 properties</option>
                                        <option value="4-10">4-10 properties</option>
                                        <option value="11-25">11-25 properties</option>
                                        <option value="25+">25+ properties</option>
                                    </select>
                                </div>
                            </div>

                            {/* Error Message */}
                            {signupMutation.isError && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                                    {signupMutation.error?.message || "Something went wrong. Please try again."}
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={signupMutation.isPending}
                                className="w-full bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {signupMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Creating Account...
                                    </>
                                ) : (
                                    <>
                                        Get Started
                                        <ArrowRight className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </form>

                        <p className="text-center text-sm text-slate-500 mt-6">
                            By signing up, you agree to our{" "}
                            <a href="/terms" className="text-primary hover:underline">Terms of Service</a>
                            {" "}and{" "}
                            <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const slide = slides[currentSlide];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-4xl">
                {/* Progress Dots */}
                <div className="flex justify-center gap-2 mb-8">
                    {slides.map((_, idx) => (
                        <button
                            key={idx}
                            onClick={() => setCurrentSlide(idx)}
                            className={`w-2 h-2 rounded-full transition-all ${
                                idx === currentSlide
                                    ? "bg-primary w-8"
                                    : "bg-slate-600 hover:bg-slate-500"
                            }`}
                        />
                    ))}
                </div>

                {/* Slide Content */}
                <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
                    <div className="grid md:grid-cols-2">
                        {/* Left Side - Content */}
                        <div className="p-8 md:p-12">
                            <div className="mb-6">
                                {slide.icon}
                            </div>

                            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
                                {slide.title}
                            </h1>

                            <p className="text-lg text-slate-600 mb-8">
                                {slide.subtitle}
                            </p>

                            <ul className="space-y-4">
                                {slide.features.map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-3">
                                        <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                                        <span className="text-slate-700">{feature}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Right Side - Visual */}
                        <div className="bg-gradient-to-br from-primary/10 to-primary/5 p-8 md:p-12 flex items-center justify-center">
                            <div className="relative">
                                {/* Phone Mockup */}
                                <div className="w-64 h-[500px] bg-slate-900 rounded-[3rem] p-3 shadow-2xl">
                                    <div className="w-full h-full bg-white rounded-[2.5rem] overflow-hidden">
                                        {/* WhatsApp Header */}
                                        <div className="bg-[#075E54] text-white p-4 flex items-center gap-3">
                                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                                                <Wrench className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-sm">Handy Services</p>
                                                <p className="text-xs text-white/70">Online</p>
                                            </div>
                                        </div>

                                        {/* Chat Messages */}
                                        <div className="p-4 space-y-3 bg-[#ECE5DD] h-full">
                                            <div className="bg-white rounded-lg p-3 max-w-[80%] shadow-sm">
                                                <p className="text-sm text-slate-700">Hi, my kitchen tap is dripping constantly</p>
                                                <p className="text-[10px] text-slate-400 text-right mt-1">10:30</p>
                                            </div>

                                            <div className="bg-[#DCF8C6] rounded-lg p-3 max-w-[80%] ml-auto shadow-sm">
                                                <p className="text-sm text-slate-700">
                                                    No worries! Let's try a quick fix first.
                                                    Can you turn off the water under the sink and check if the washer looks worn?
                                                </p>
                                                <p className="text-[10px] text-slate-400 text-right mt-1">10:31</p>
                                            </div>

                                            <div className="bg-white rounded-lg p-3 max-w-[80%] shadow-sm">
                                                <p className="text-sm text-slate-700">That fixed it! Thanks!</p>
                                                <p className="text-[10px] text-slate-400 text-right mt-1">10:35</p>
                                            </div>

                                            <div className="bg-[#DCF8C6] rounded-lg p-3 max-w-[80%] ml-auto shadow-sm">
                                                <p className="text-sm text-slate-700">
                                                    Brilliant! Issue resolved - no callout needed. Your landlord has been notified.
                                                </p>
                                                <p className="text-[10px] text-slate-400 text-right mt-1">10:35</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Floating Badge */}
                                <div className="absolute -top-4 -right-4 bg-green-500 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg">
                                    No Callout Fee!
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Navigation */}
                    <div className="border-t border-slate-100 p-6 flex justify-between items-center">
                        <button
                            onClick={prevSlide}
                            disabled={currentSlide === 0}
                            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            Back
                        </button>

                        <button
                            onClick={() => setShowSignup(true)}
                            className="text-primary hover:underline text-sm"
                        >
                            Skip to signup
                        </button>

                        <button
                            onClick={nextSlide}
                            className="flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
                        >
                            {currentSlide === slides.length - 1 ? "Get Started" : "Next"}
                            <ArrowRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Trust Indicators */}
                <div className="flex justify-center items-center gap-8 mt-8 text-slate-400 text-sm">
                    <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        <span>£2M Insured</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        <span>24-48hr Response</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>180+ Landlords</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
