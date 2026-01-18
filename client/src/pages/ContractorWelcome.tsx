
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Calendar, CreditCard, TrendingUp, ArrowRight, Star, Smartphone, FileText, ChevronRight } from "lucide-react";

const slides = [
    {
        id: 1,
        title: "Run your business from your pocket",
        desc: "Manage jobs, schedule visits, and track your team in one simple app.",
        component: <SlideOneAnimation />
    },
    {
        id: 2,
        title: "Get paid instantly",
        desc: "Send professional invoices and take card payments on the job. No more chasing.",
        component: <SlideTwoAnimation />
    },
    {
        id: 3,
        title: "Professionalize your trade",
        desc: "Your own website, booking link, and automated reminders. Look like a pro.",
        component: <SlideThreeAnimation />
    }
];

export default function ContractorWelcome() {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [, setLocation] = useLocation();

    const nextSlide = () => {
        if (currentSlide < slides.length - 1) {
            setCurrentSlide(curr => curr + 1);
        } else {
            setLocation("/contractor/register");
        }
    };

    return (
        <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans">
            {/* Top Bar */}
            <div className="h-16 flex items-center justify-center border-b border-slate-100 sticky top-0 bg-white z-50">
                <div className="flex items-center gap-3">
                    <img
                        src="/logo.png"
                        alt="Handy"
                        className="w-8 h-8 object-contain"
                    />
                    <div className="flex flex-col leading-none">
                        <span className="font-bold text-lg text-slate-900">Handy</span>
                        <span className="font-normal text-[10px] text-slate-500 uppercase tracking-wider">Services</span>
                    </div>
                </div>
            </div>

            {/* Main Carousel Area */}
            <div className="flex-1 flex flex-col relative overflow-hidden">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentSlide}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.3 }}
                        className="flex-1 flex flex-col"
                    >
                        {/* Animation Container - 50% height */}
                        <div className="h-[50vh] w-full relative bg-slate-50 flex items-center justify-center overflow-hidden">
                            {slides[currentSlide].component}
                        </div>

                        {/* Text Area */}
                        <div className="flex-1 px-8 pt-8 pb-4 flex flex-col items-center text-center max-w-md mx-auto">
                            <motion.h2
                                key={`t-${currentSlide}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                className="text-3xl font-bold text-slate-900 mb-4 leading-tight"
                            >
                                {slides[currentSlide].title}
                            </motion.h2>
                            <motion.p
                                key={`d-${currentSlide}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                className="text-slate-500 text-lg leading-relaxed"
                            >
                                {slides[currentSlide].desc}
                            </motion.p>
                        </div>
                    </motion.div>
                </AnimatePresence>

                {/* Indicators */}
                <div className="flex justify-center gap-2 mb-8">
                    {slides.map((_, idx) => (
                        <div
                            key={idx}
                            className={`h-2 rounded-full transition-all duration-300 ${idx === currentSlide ? "w-8 bg-[#6C6CFF]" : "w-2 bg-slate-200"
                                }`}
                        />
                    ))}
                </div>

                {/* Action Button */}
                <div className="px-6 pb-10 w-full max-w-md mx-auto relative z-20">
                    <button
                        onClick={nextSlide}
                        className="w-full bg-[#6C6CFF] hover:bg-[#5858E0] active:scale-95 transition-all text-white font-bold text-lg py-4 rounded-2xl shadow-xl shadow-blue-500/20 flex items-center justify-center gap-2"
                    >
                        {currentSlide === slides.length - 1 ? "Get Started" : "Next"}
                        <ArrowRight size={20} className="opacity-80" />
                    </button>
                    {currentSlide !== slides.length - 1 && (
                        <div className="mt-4 text-center">
                            <button
                                onClick={() => setLocation("/contractor/register")}
                                className="text-slate-400 font-medium text-sm hover:text-[#6C6CFF] transition-colors"
                            >
                                Skip intro
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// --- Animation Components ---

function SlideOneAnimation() {
    return (
        <div className="relative w-full h-full flex items-center justify-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.1),transparent_70%)]" />

            {/* Phone Mockup */}
            <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="w-48 h-80 bg-white rounded-3xl border-4 border-slate-200 shadow-2xl relative z-10 overflow-hidden flex flex-col"
            >
                <div className="h-6 bg-slate-50 border-b border-slate-100 flex justify-center pt-2">
                    <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
                </div>

                {/* App Content */}
                <div className="p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div className="w-8 h-8 rounded-full bg-slate-100" />
                        <div className="w-20 h-3 bg-slate-100 rounded" />
                    </div>

                    {/* Jobs List - Staggered Entry */}
                    {[1, 2, 3].map((i) => (
                        <motion.div
                            key={i}
                            initial={{ x: -50, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: 0.4 + (i * 0.15) }}
                            className="p-3 rounded-xl bg-blue-50 border border-blue-100 flex items-center gap-3"
                        >
                            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white">
                                <FileText size={14} />
                            </div>
                            <div className="space-y-1.5 flex-1">
                                <div className="w-20 h-2 bg-blue-200 rounded" />
                                <div className="w-12 h-1.5 bg-blue-100 rounded" />
                            </div>
                            <CheckCircle2 size={14} className="text-blue-400" />
                        </motion.div>
                    ))}
                </div>
            </motion.div>

            {/* Floating Elements */}
            <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1, type: "spring" }}
                className="absolute top-1/4 right-8 bg-white p-3 rounded-2xl shadow-lg border border-slate-100 z-20"
            >
                <Calendar className="text-orange-500 w-6 h-6" />
            </motion.div>
            <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1.2, type: "spring" }}
                className="absolute bottom-1/3 left-8 bg-white p-3 rounded-2xl shadow-lg border border-slate-100 z-20"
            >
                <Smartphone className="text-blue-500 w-6 h-6" />
            </motion.div>
        </div>
    );
}

function SlideTwoAnimation() {
    return (
        <div className="relative w-full h-full flex items-center justify-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.1),transparent_70%)]" />

            {/* Invoice Card */}
            <motion.div
                initial={{ scale: 0.8, opacity: 0, rotate: -5 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ duration: 0.5 }}
                className="w-64 h-40 bg-white rounded-2xl shadow-xl border border-slate-100 p-5 flex flex-col justify-between relative z-10"
            >
                <div className="space-y-2">
                    <div className="flex justify-between">
                        <div className="w-20 h-3 bg-slate-100 rounded" />
                        <div className="w-8 h-8 rounded-full bg-slate-50" />
                    </div>
                    <div className="w-32 h-2 bg-slate-100 rounded" />
                    <div className="w-24 h-2 bg-slate-100 rounded" />
                </div>

                <div className="flex justify-between items-end border-t border-slate-50 pt-3">
                    <div className="text-xs text-slate-400">Total</div>
                    <div className="text-xl font-bold text-slate-800">£1,250.00</div>
                </div>
            </motion.div>

            {/* Credit Card Wipe Effect */}
            <motion.div
                initial={{ x: 200, y: 100, opacity: 0 }}
                animate={{ x: 60, y: 40, opacity: 1 }}
                transition={{ delay: 0.5, type: "spring" }}
                className="absolute z-20 bg-slate-900 w-40 h-24 rounded-xl shadow-2xl p-4 flex flex-col justify-between"
            >
                <div className="flex justify-end">
                    <div className="w-8 h-5 bg-white/20 rounded-md" />
                </div>
                <div className="space-y-2">
                    <div className="w-full h-2 bg-white/20 rounded" />
                    <div className="w-16 h-2 bg-white/20 rounded" />
                </div>
            </motion.div>

            {/* PAID Stamp */}
            <motion.div
                initial={{ scale: 2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1.2, type: "spring", stiffness: 300 }}
                className="absolute z-30 bg-emerald-500 text-white px-6 py-2 rounded-xl shadow-lg shadow-emerald-500/30 transform -rotate-12 border-2 border-white"
            >
                <span className="font-black text-xl tracking-widest">PAID</span>
            </motion.div>
        </div>
    );
}

function SlideThreeAnimation() {
    return (
        <div className="relative w-full h-full flex items-center justify-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.1),transparent_70%)]" />

            {/* Profile Card */}
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="w-64 bg-white rounded-2xl shadow-xl border border-purple-100 p-6 flex flex-col items-center text-center relative z-10"
            >
                {/* Avatar Transformation */}
                <div className="relative mb-4">
                    <motion.div
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 0 }}
                        transition={{ delay: 0.8, duration: 0.2 }}
                        className="w-20 h-20 rounded-full bg-slate-200 border-4 border-white shadow-sm flex items-center justify-center"
                    >
                        <TrendingUp className="text-slate-400" />
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.9, type: "spring" }}
                        className="absolute inset-0 w-20 h-20 rounded-full bg-gradient-to-tr from-[#6C6CFF] to-purple-500 border-4 border-white shadow-lg flex items-center justify-center text-white"
                    >
                        <Star className="fill-current w-10 h-10" />
                    </motion.div>

                    {/* Badge Popup */}
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 1.4, type: "spring" }}
                        className="absolute -right-2 -bottom-2 w-8 h-8 bg-amber-400 text-white rounded-full flex items-center justify-center font-bold text-xs shadow-md border-2 border-white"
                    >
                        5.0
                    </motion.div>
                </div>

                {/* Name & Title */}
                <div className="w-full space-y-2 mb-4">
                    <div className="h-4 bg-slate-800 rounded-full w-3/4 mx-auto" />
                    <div className="h-2 bg-slate-200 rounded-full w-1/2 mx-auto" />
                </div>

                {/* Website Link Animation */}
                <motion.div
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: "100%", opacity: 1 }}
                    transition={{ delay: 1.8, duration: 0.5 }}
                    className="h-8 bg-purple-50 rounded-lg flex items-center px-3 gap-2 overflow-hidden"
                >
                    <div className="w-4 h-4 rounded-full bg-purple-200 flex-shrink-0" />
                    <div className="h-2 bg-purple-200 rounded-full flex-1" />
                </motion.div>
            </motion.div>
        </div>
    );
}

