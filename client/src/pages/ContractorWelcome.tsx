
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, PoundSterling, Clock, Wrench, Droplets, Zap, PaintBucket, Hammer, Grid3X3 } from "lucide-react";

// --- Animation Components ---

function CalendarFillAnimation() {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const filledDays = [0, 2, 3, 4]; // Mon, Wed, Thu, Fri get filled
    const amounts = ["£140", "£160", "£180", "£150"];

    return (
        <div className="relative w-full h-full flex items-center justify-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.08),transparent_70%)]" />

            {/* Calendar Grid */}
            <motion.div
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-xs bg-slate-900 rounded-2xl shadow-xl border border-slate-700 p-5 relative z-10"
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="text-sm font-bold text-slate-300">This Week</div>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 2.2 }}
                        className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full"
                    >
                        4 days booked
                    </motion.div>
                </div>

                {/* Day Grid */}
                <div className="grid grid-cols-7 gap-1.5">
                    {/* Day Labels */}
                    {days.map((day) => (
                        <div key={day} className="text-[10px] font-medium text-slate-400 text-center pb-1">
                            {day}
                        </div>
                    ))}

                    {/* Day Blocks */}
                    {days.map((day, idx) => {
                        const fillIndex = filledDays.indexOf(idx);
                        const isFilled = fillIndex !== -1;

                        return (
                            <motion.div
                                key={`block-${day}`}
                                initial={{ backgroundColor: "rgb(241, 245, 249)", scale: 1 }}
                                animate={isFilled ? {
                                    backgroundColor: "rgb(16, 185, 129)",
                                    scale: [1, 1.15, 1],
                                } : {}}
                                transition={{
                                    delay: isFilled ? 0.6 + (fillIndex * 0.35) : 0,
                                    duration: 0.4,
                                }}
                                className="aspect-square rounded-lg flex items-center justify-center relative"
                            >
                                {isFilled && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: 0.8 + (fillIndex * 0.35), type: "spring" }}
                                        className="text-white"
                                    >
                                        <PoundSterling size={14} />
                                    </motion.div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>

                {/* Earnings Row */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 2.4 }}
                    className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between"
                >
                    <span className="text-xs text-slate-400">This week</span>
                    <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 2.6 }}
                        className="text-lg font-black text-white"
                    >
                        £630
                    </motion.span>
                </motion.div>
            </motion.div>

            {/* Floating "Job Added" toast */}
            <motion.div
                initial={{ x: 80, opacity: 0 }}
                animate={{ x: 0, opacity: [0, 1, 1, 0] }}
                transition={{ delay: 1.0, duration: 2, times: [0, 0.1, 0.7, 1] }}
                className="absolute top-16 right-4 bg-emerald-500 text-white px-3 py-2 rounded-xl shadow-lg text-xs font-semibold z-20 flex items-center gap-1.5"
            >
                <Check size={12} /> Job added
            </motion.div>
        </div>
    );
}

function SkillsMatchAnimation() {
    const skills = [
        { id: "plumbing", label: "Plumbing", icon: <Droplets size={14} />, color: "bg-blue-500" },
        { id: "electrical", label: "Electrical", icon: <Zap size={14} />, color: "bg-amber-500" },
        { id: "joinery", label: "Joinery", icon: <Hammer size={14} />, color: "bg-orange-600" },
        { id: "tiling", label: "Tiling", icon: <Grid3X3 size={14} />, color: "bg-cyan-500" },
        { id: "decorating", label: "Decorating", icon: <PaintBucket size={14} />, color: "bg-pink-500" },
        { id: "handyman", label: "Handyman", icon: <Wrench size={14} />, color: "bg-violet-500" },
    ];

    const matchedJobs = [
        { skill: "plumbing", title: "Leaky tap repair", area: "NG5", pay: "£85" },
        { skill: "electrical", title: "Socket replacement", area: "NG3", pay: "£120" },
        { skill: "handyman", title: "Flatpack assembly", area: "NG7", pay: "£95" },
    ];

    return (
        <div className="relative w-full h-full flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(108,108,255,0.08),transparent_70%)]" />

            <div className="flex gap-4 items-center relative z-10">
                {/* Skills Column */}
                <div className="flex flex-col gap-2">
                    {skills.map((skill, idx) => (
                        <motion.div
                            key={skill.id}
                            initial={{ x: -40, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: 0.2 + (idx * 0.1) }}
                            className="flex items-center gap-2 bg-slate-800 rounded-xl px-3 py-2 shadow-sm border border-slate-700"
                        >
                            <div className={`w-6 h-6 rounded-full ${skill.color} flex items-center justify-center text-white`}>
                                {skill.icon}
                            </div>
                            <span className="text-xs font-medium text-slate-300 whitespace-nowrap">{skill.label}</span>
                        </motion.div>
                    ))}
                </div>

                {/* Arrow connector */}
                <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1.0 }}
                    className="text-[#6C6CFF]"
                >
                    <ArrowRight size={24} />
                </motion.div>

                {/* Matched Jobs */}
                <div className="flex flex-col gap-2">
                    {matchedJobs.map((job, idx) => (
                        <motion.div
                            key={job.title}
                            initial={{ x: 40, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: 1.2 + (idx * 0.25) }}
                            className="bg-slate-800 rounded-xl p-3 shadow-sm border border-slate-700 w-40"
                        >
                            <div className="text-xs font-semibold text-white">{job.title}</div>
                            <div className="flex items-center justify-between mt-1.5">
                                <span className="text-[10px] text-slate-400">{job.area}</span>
                                <span className="text-xs font-bold text-emerald-600">{job.pay}</span>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Shared trade rate config — single source of truth for ranges & sweet spots
const TRADE_RATES = [
    { id: "plumbing", label: "Plumbing", icon: <Droplets size={14} />, color: "bg-blue-500", min: 40, max: 80, sweet: 60 },
    { id: "electrical", label: "Electrical", icon: <Zap size={14} />, color: "bg-amber-500", min: 45, max: 85, sweet: 65 },
    { id: "joinery", label: "Joinery", icon: <Hammer size={14} />, color: "bg-orange-600", min: 35, max: 75, sweet: 55 },
    { id: "tiling", label: "Tiling", icon: <Grid3X3 size={14} />, color: "bg-cyan-500", min: 30, max: 70, sweet: 50 },
    { id: "decorating", label: "Decorating", icon: <PaintBucket size={14} />, color: "bg-pink-500", min: 25, max: 65, sweet: 45 },
    { id: "handyman", label: "Handyman", icon: <Wrench size={14} />, color: "bg-violet-500", min: 25, max: 55, sweet: 40 },
] as const;

function RateAnimation() {
    const [tradeIndex, setTradeIndex] = useState(0);
    const [animatedRate, setAnimatedRate] = useState(TRADE_RATES[0].min);
    const [settling, setSettling] = useState(false);

    const trade = TRADE_RATES[tradeIndex];

    // Animate rate climbing from min → sweet spot, then cycle to next trade
    useEffect(() => {
        let step = 0;
        const stepsToSweet = 12;
        const rateRange = trade.sweet - trade.min;
        setAnimatedRate(trade.min);
        setSettling(false);

        const climbInterval = setInterval(() => {
            step++;
            if (step <= stepsToSweet) {
                // Ease-out curve: fast start, slow finish
                const progress = 1 - Math.pow(1 - (step / stepsToSweet), 2);
                setAnimatedRate(Math.round(trade.min + rateRange * progress));
            } else if (step === stepsToSweet + 1) {
                setSettling(true);
            } else if (step > stepsToSweet + 12) {
                // Move to next trade after a pause
                clearInterval(climbInterval);
                setTradeIndex(prev => (prev + 1) % TRADE_RATES.length);
            }
        }, 120);

        return () => clearInterval(climbInterval);
    }, [tradeIndex]);

    const dailyEarnings = animatedRate * 4; // Half-day slot (AM or PM = 4 hours)
    const sliderPercent = ((animatedRate - trade.min) / (trade.max - trade.min)) * 100;
    const sweetPercent = ((trade.sweet - trade.min) / (trade.max - trade.min)) * 100;

    return (
        <div className="relative w-full h-full flex items-center justify-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.08),transparent_70%)]" />

            <motion.div
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-xs bg-slate-900 rounded-2xl shadow-xl border border-slate-700 p-5 relative z-10 text-center"
            >
                {/* Trade chip */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={trade.id}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.2 }}
                        className="inline-flex items-center gap-2 bg-slate-800 rounded-full px-3 py-1.5 mb-3"
                    >
                        <div className={`w-5 h-5 rounded-full ${trade.color} flex items-center justify-center text-white`}>
                            {trade.icon}
                        </div>
                        <span className="text-xs font-semibold text-slate-300">{trade.label}</span>
                    </motion.div>
                </AnimatePresence>

                {/* Rate Display */}
                <div className="text-4xl font-black text-white mb-0.5 tabular-nums">
                    £{animatedRate}
                </div>
                <div className="text-slate-400 text-sm mb-5">/hour</div>

                {/* Slider Track with warm zone */}
                <div className="relative h-2.5 bg-slate-100 rounded-full mb-1.5">
                    {/* Warm zone highlight */}
                    <div
                        className="absolute top-0 h-2.5 bg-emerald-100 rounded-full"
                        style={{
                            left: `${sweetPercent - 12}%`,
                            width: "24%",
                        }}
                    />
                    {/* Sweet spot marker */}
                    <div
                        className="absolute top-0 h-2.5 w-1 bg-emerald-400 rounded-full"
                        style={{ left: `${sweetPercent}%` }}
                    />
                    {/* Fill */}
                    <motion.div
                        className="absolute top-0 left-0 h-2.5 bg-[#6C6CFF] rounded-full"
                        animate={{ width: `${sliderPercent}%` }}
                        transition={{ duration: 0.1 }}
                    />
                    {/* Thumb */}
                    <motion.div
                        className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-[#6C6CFF] rounded-full border-2 border-white shadow-md"
                        animate={{ left: `${sliderPercent}%` }}
                        transition={{ duration: 0.1 }}
                        style={{ marginLeft: "-10px" }}
                    />
                </div>
                {/* Range labels */}
                <div className="flex justify-between text-[10px] text-slate-300 mb-4 px-0.5">
                    <span>£{trade.min}</span>
                    <span>£{trade.max}</span>
                </div>

                {/* Sweet spot label */}
                <AnimatePresence>
                    {settling && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-[10px] text-emerald-600 font-semibold mb-3 flex items-center justify-center gap-1"
                        >
                            <Check size={10} /> Recommended fill-up rate: £{trade.sweet}/hr
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Daily Earnings */}
                <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                    <div className="text-emerald-600 text-xs font-medium mb-0.5">Per half-day slot</div>
                    <div className="text-2xl font-black text-emerald-700 tabular-nums">
                        £{dailyEarnings}
                    </div>
                    <div className="text-emerald-500 text-xs">instead of £0</div>
                </div>

                {/* Paid Badge */}
                <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 2.0, type: "spring", stiffness: 300 }}
                    className="absolute -top-3 -right-3 bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md flex items-center gap-1"
                >
                    <Clock size={10} /> Paid in 48hrs
                </motion.div>
            </motion.div>
        </div>
    );
}

function ChecklistAnimation() {
    const steps = [
        { label: "Pick your trades", emoji: "🔧" },
        { label: "Set your fill-up rate", emoji: "💰" },
        { label: "Mark your free days", emoji: "📅" },
    ];

    return (
        <div className="relative w-full h-full flex items-center justify-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(108,108,255,0.08),transparent_70%)]" />

            <motion.div
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-xs bg-slate-900 rounded-2xl shadow-xl border border-slate-700 p-6 relative z-10"
            >
                {/* Timer badge */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="text-center mb-5"
                >
                    <span className="text-xs font-semibold text-[#6C6CFF] bg-indigo-50 px-3 py-1 rounded-full">
                        Takes 2 minutes
                    </span>
                </motion.div>

                {/* Checklist */}
                <div className="space-y-3">
                    {steps.map((step, idx) => (
                        <motion.div
                            key={step.label}
                            initial={{ x: -20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: 0.5 + (idx * 0.15) }}
                            className="flex items-center gap-3"
                        >
                            {/* Checkbox */}
                            <motion.div
                                initial={{ backgroundColor: "rgb(241, 245, 249)", borderColor: "rgb(203, 213, 225)" }}
                                animate={{
                                    backgroundColor: "rgb(16, 185, 129)",
                                    borderColor: "rgb(16, 185, 129)",
                                }}
                                transition={{ delay: 1.0 + (idx * 0.4) }}
                                className="w-7 h-7 rounded-lg border-2 flex items-center justify-center flex-shrink-0"
                            >
                                <motion.div
                                    initial={{ opacity: 0, scale: 0 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 1.1 + (idx * 0.4), type: "spring" }}
                                >
                                    <Check size={14} className="text-white" />
                                </motion.div>
                            </motion.div>

                            {/* Label */}
                            <div className="flex items-center gap-2">
                                <span className="text-base">{step.emoji}</span>
                                <span className="text-sm font-medium text-slate-300">{step.label}</span>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {/* Done banner */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 2.6 }}
                    className="mt-5 pt-4 border-t border-slate-100 text-center"
                >
                    <div className="text-sm font-bold text-white">That's it. Jobs start coming in.</div>
                </motion.div>
            </motion.div>

            {/* Floating confetti-like dots */}
            {[
                { x: -100, y: -80, color: "bg-emerald-400", delay: 2.8 },
                { x: 110, y: -60, color: "bg-[#6C6CFF]", delay: 2.9 },
                { x: -80, y: 60, color: "bg-amber-400", delay: 3.0 },
                { x: 100, y: 70, color: "bg-pink-400", delay: 3.1 },
                { x: -40, y: -100, color: "bg-cyan-400", delay: 2.85 },
                { x: 60, y: 90, color: "bg-emerald-300", delay: 3.05 },
            ].map((dot, idx) => (
                <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0.8] }}
                    transition={{ delay: dot.delay, duration: 1.5 }}
                    className={`absolute w-3 h-3 ${dot.color} rounded-full z-20`}
                    style={{
                        left: `calc(50% + ${dot.x}px)`,
                        top: `calc(50% + ${dot.y}px)`,
                    }}
                />
            ))}
        </div>
    );
}

// --- Slide Definitions ---

const slides = [
    {
        id: 1,
        title: "Got Spare Days? We'll Fill Them.",
        desc: "Jobs ready to go. You pick the days. We handle the rest.",
        component: <CalendarFillAnimation />,
    },
    {
        id: 2,
        title: "We Match Jobs to What You Do",
        desc: "Tell us your skills. We send you work that fits.",
        component: <SkillsMatchAnimation />,
    },
    {
        id: 3,
        title: "Fill Your Spare Days. Get Paid.",
        desc: "Set your fill-up rate — what you earn when we fill days you'd otherwise have free.",
        component: <RateAnimation />,
    },
    {
        id: 4,
        title: "Set Up in 2 Minutes. Jobs This Week.",
        desc: "Pick your skills. Set your fill-up rate. Plot your free days. Done.",
        component: <ChecklistAnimation />,
    },
];

// --- Main Component ---

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

    const isLastSlide = currentSlide === slides.length - 1;

    return (
        <div className="h-[100dvh] bg-[#0F172A] text-white flex flex-col font-sans overflow-hidden">
            {/* Top Bar */}
            <div className="h-14 flex items-center justify-center border-b border-white/5 sticky top-0 bg-[#0F172A]/95 backdrop-blur-sm z-50">
                <div className="flex items-center gap-2.5">
                    <img
                        src="/logo.png"
                        alt="Handy"
                        className="w-7 h-7 object-contain"
                    />
                    <div className="flex flex-col leading-none">
                        <span className="font-bold text-base text-white">Handy</span>
                        <span className="font-normal text-[9px] text-slate-400 uppercase tracking-wider">Services</span>
                    </div>
                </div>
            </div>

            {/* Main Carousel Area — everything stacks, button pinned to bottom */}
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
                        {/* Content group — text + animation centered together */}
                        <div className="flex-1 flex flex-col items-center justify-center px-4">
                            {/* Text */}
                            <div className="pb-4 flex flex-col items-center text-center max-w-md">
                                <motion.h2
                                    key={`t-${currentSlide}`}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.1 }}
                                    className="text-xl sm:text-2xl font-bold text-white mb-1.5 leading-tight"
                                >
                                    {slides[currentSlide].title}
                                </motion.h2>
                                <motion.p
                                    key={`d-${currentSlide}`}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.2 }}
                                    className="text-slate-400 text-sm leading-relaxed"
                                >
                                    {slides[currentSlide].desc}
                                </motion.p>
                            </div>

                            {/* Animation */}
                            <div className="w-full h-[280px] relative flex items-center justify-center overflow-hidden">
                            {slides[currentSlide].component}
                            </div>
                        </div>
                    </motion.div>
                </AnimatePresence>

                {/* Bottom section — pinned to bottom */}
                <div className="mt-auto flex-shrink-0 pb-6 pt-4">
                    {/* Indicators */}
                    <div className="flex justify-center gap-2 mb-4">
                        {slides.map((_, idx) => (
                            <button
                                key={idx}
                                onClick={() => setCurrentSlide(idx)}
                                className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentSlide ? "w-7 bg-[#6C6CFF]" : "w-1.5 bg-slate-600 hover:bg-slate-500"
                                    }`}
                            />
                        ))}
                    </div>

                    {/* Action Button */}
                    <div className="px-6 w-full max-w-md mx-auto relative z-20">
                        <button
                            onClick={nextSlide}
                            className="w-full bg-[#6C6CFF] hover:bg-[#5858E0] active:scale-[0.98] transition-all text-white font-bold text-base py-3.5 rounded-2xl shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-2"
                        >
                            {isLastSlide ? "Let's Go" : "Next"}
                            <ArrowRight size={18} className="opacity-80" />
                        </button>
                        {!isLastSlide && (
                            <div className="mt-2 text-center">
                                <button
                                    onClick={() => setLocation("/contractor/register")}
                                    className="text-slate-500 font-medium text-xs hover:text-[#6C6CFF] transition-colors"
                                >
                                    Skip intro
                                </button>
                            </div>
                        )}
                        {isLastSlide && (
                            <div className="mt-2 text-center">
                                <button
                                    onClick={() => setLocation("/contractor/login")}
                                    className="text-slate-500 font-medium text-xs hover:text-[#6C6CFF] transition-colors"
                                >
                                    Already have an account? Sign in
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
