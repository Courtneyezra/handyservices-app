import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
    Phone, Star, Wrench, Calendar, FileText, Smartphone,
    CheckCircle2, ArrowRight, Shield, Zap, TrendingUp, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

// Assets
import handyLogo from "@assets/Copy of Copy of Add a heading-3_1764600628729.webp";

// Components
// Components
import { HeroQuoteAnimation } from "@/components/landing-animations/HeroQuoteAnimation";
import { UpsellAnimation } from "@/components/landing-animations/UpsellAnimation";
import { SchedulerAnimation } from "@/components/landing-animations/SchedulerAnimation";

function Navbar() {
    return (
        <nav className="fixed top-0 left-0 right-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-white/5">
            <div className="max-w-7xl mx-auto px-4 md:px-8 h-20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <img src={handyLogo} alt="Handy" className="w-10 h-10 object-contain" />
                    <span className="text-white font-bold text-xl">Handy</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-bold uppercase tracking-wider">
                        Partner
                    </span>
                </div>
                <div className="hidden md:flex items-center gap-8">
                    <a href="#features" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Features</a>
                    <a href="#leads" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Leads</a>
                    <a href="/contractor/login" className="text-white hover:text-amber-400 transition-colors text-sm font-medium">Login</a>
                </div>
            </div>
        </nav>
    );
}

export default function ContractorAppLanding() {
    const [, setLocation] = useLocation();

    return (
        <div className="min-h-screen bg-slate-950 font-sans selection:bg-amber-500/30 selection:text-amber-200">
            <Navbar />

            {/* HERO SECTION */}
            <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-4 overflow-hidden">
                {/* Background Glows */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 rounded-full pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2 rounded-full pointer-events-none" />

                <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative z-10">
                    <div className="space-y-8 text-center lg:text-left">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 text-sm font-medium animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <Smartphone className="w-4 h-4 text-amber-400" />
                            <span>The OS for modern tradespeople</span>
                        </div>

                        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.1] animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
                            Run Your Trade <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">
                                From Your Pocket
                            </span>
                        </h1>

                        <p className="text-xl text-slate-400 max-w-xl mx-auto lg:mx-0 leading-relaxed animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200">
                            Create quotes in 60s, win 20% more work, and get your evenings back.
                            <span className="text-white font-medium"> Built for the trade, by the trade.</span>
                        </p>

                        <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300">
                            <Button
                                onClick={() => setLocation("/contractor/register")}
                                className="w-full sm:w-auto px-8 py-6 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-lg shadow-lg shadow-amber-500/20 transition-all hover:scale-105"
                            >
                                Start Free Profile
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full sm:w-auto px-8 py-6 bg-transparent border-white/10 hover:bg-white/5 text-white font-semibold rounded-xl text-lg backdrop-blur-sm"
                            >
                                View Demo
                            </Button>
                        </div>

                        <div className="pt-4 flex items-center justify-center lg:justify-start gap-4 text-sm text-slate-500 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-400">
                            <div className="flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                <span>No credit card required</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                <span>Free forever plan</span>
                            </div>
                        </div>
                    </div>

                    {/* HERO ANIMATION */}
                    <div className="relative flex justify-center lg:justify-end animate-in fade-in slide-in-from-right-10 duration-1000 delay-300">
                        <HeroQuoteAnimation />
                    </div>
                </div>
            </section>

            {/* PAIN POINTS SECTION */}
            <section className="py-20 bg-slate-900 border-y border-white/5">
                <div className="max-w-7xl mx-auto px-4 md:px-8">
                    <div className="grid md:grid-cols-3 gap-8">
                        {[
                            {
                                icon: <FileText className="w-8 h-8 text-red-400" />,
                                title: "Chasing Payments?",
                                desc: "Stop awkward money chats. Send professional invoices that get paid instantly via card."
                            },
                            {
                                icon: <Calendar className="w-8 h-8 text-blue-400" />,
                                title: "Empty Diary?",
                                desc: "Fill the gaps in your schedule. We can send you verified local jobs when you need them."
                            },
                            {
                                icon: <Zap className="w-8 h-8 text-amber-400" />,
                                title: "Late Night Admin?",
                                desc: "Reclaim your evenings. Quotes, invoices, and receipts handled in seconds on the job."
                            }
                        ].map((item, i) => (
                            <div key={i} className="bg-slate-950 p-8 rounded-2xl border border-white/5 hover:border-amber-500/30 transition-colors group">
                                <div className="w-14 h-14 bg-slate-900 rounded-xl flex items-center justify-center mb-6 border border-white/5 group-hover:scale-110 transition-transform">
                                    {item.icon}
                                </div>
                                <h3 className="text-xl font-bold text-white mb-3">{item.title}</h3>
                                <p className="text-slate-400 leading-relaxed">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* FEATURES SHOWCASE */}
            <section id="features" className="py-24 px-4 overflow-hidden">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center mb-20">
                        <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                            Everything You Need to <br />
                            <span className="text-amber-500">Scale Your Business</span>
                        </h2>
                        <p className="text-xl text-slate-400">One app to replace them all.</p>
                    </div>

                    <div className="space-y-32">
                        {/* FEATURE 1: UPSELL MENU */}
                        <div className="grid lg:grid-cols-2 gap-16 items-center">
                            <div className="order-2 lg:order-1 flex justify-center">
                                <UpsellAnimation />
                            </div>
                            <div className="order-1 lg:order-2 space-y-6">
                                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                    <TrendingUp className="w-6 h-6 text-emerald-500" />
                                </div>
                                <div>
                                    <h3 className="text-3xl font-bold text-white mb-2">The Upsell Menu</h3>
                                    <span className="text-xs uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                        +20% Revenue
                                    </span>
                                </div>
                                <p className="text-lg text-slate-400 leading-relaxed">
                                    Don't just send a price. Send a Menu. Let customers tick 'Optional Extras' themselves.
                                    It’s not selling—it’s letting them buy.
                                </p>
                                <Button onClick={() => setLocation("/contractor/register")} variant="link" className="text-emerald-400 p-0 h-auto font-semibold group">
                                    Start Upselling <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                                </Button>
                            </div>
                        </div>

                        {/* FEATURE 2: SILENT SCHEDULER */}
                        <div className="grid lg:grid-cols-2 gap-16 items-center">
                            <div className="space-y-6">
                                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                    <Calendar className="w-6 h-6 text-blue-500" />
                                </div>
                                <div>
                                    <h3 className="text-3xl font-bold text-white mb-2">The Silent Scheduler</h3>
                                    <span className="text-xs uppercase font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                        Gap Filler
                                    </span>
                                </div>
                                <p className="text-lg text-slate-400 leading-relaxed">
                                    Share your profile link. Customers see exactly when you’re free (AM/PM) and request a slot.
                                    No back-and-forth texts.
                                </p>
                                <Button onClick={() => setLocation("/contractor/register")} variant="link" className="text-blue-400 p-0 h-auto font-semibold group">
                                    Try It Free <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                                </Button>
                            </div>
                            <div className="flex justify-center">
                                <SchedulerAnimation />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* LEADS ADD-ON SECTION */}
            <section id="leads" className="py-24 bg-gradient-to-b from-slate-900 to-slate-950 border-t border-white/5">
                <div className="max-w-4xl mx-auto text-center px-4">
                    <div className="inline-block px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 font-bold text-sm mb-6">
                        OPTIONAL ADD-ON
                    </div>
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                        Need More Work? <br />
                        <span className="text-white">Get</span> <span className="text-emerald-400">Verified Leads</span>
                    </h2>
                    <p className="text-xl text-slate-400 mb-12 max-w-2xl mx-auto">
                        Become a Handy Accredited Partner and we'll fill the gaps in your diary with high-quality, video-verified local jobs.
                    </p>

                    <div className="grid md:grid-cols-3 gap-6 text-left max-w-3xl mx-auto mb-12">
                        <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/5">
                            <h3 className="text-white font-bold mb-2">Video Verified</h3>
                            <p className="text-sm text-slate-400">See exactly what the job is before you accept. No wasted trips.</p>
                        </div>
                        <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/5">
                            <h3 className="text-white font-bold mb-2">Zero Lead Fees</h3>
                            <p className="text-sm text-slate-400">We don't charge for leads. We take a small commission on completed jobs only.</p>
                        </div>
                        <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/5">
                            <h3 className="text-white font-bold mb-2">Guaranteed Payment</h3>
                            <p className="text-sm text-slate-400">Customers pay via the app. Get money in your bank instantly.</p>
                        </div>
                    </div>

                    <Button
                        onClick={() => setLocation("/contractor/register")}
                        className="px-10 py-6 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold rounded-full text-lg shadow-lg shadow-amber-500/20"
                    >
                        Apply for Accreditation
                    </Button>
                </div>
            </section>

            {/* POP-OUT ONBOARDING MODAL REMOVED - Using direct navigation to /contractor/register */}
        </div>
    );
}
