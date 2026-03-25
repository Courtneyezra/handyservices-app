
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

        </div>
    );
}

function SkillsMatchAnimation() {
    const skills = [
        { id: "plumbing", label: "Plumbing", icon: <Droplets size={14} />, color: "bg-blue-500" },
        { id: "electrical", label: "Electrical", icon: <Zap size={14} />, color: "bg-amber-500" },
        { id: "joinery", label: "Joinery", icon: <Hammer size={14} />, color: "bg-orange-600" },
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

function PaymentNotificationsAnimation() {
    const payments = [
        { job: "Tap repair", area: "NG5", amount: "85.00", time: "Today, 2:34pm" },
        { job: "TV mounting", area: "NG3", amount: "65.00", time: "Yesterday, 4:12pm" },
        { job: "Flat pack assembly", area: "NG7", amount: "70.00", time: "Mon, 11:45am" },
    ];

    const [runningTotal, setRunningTotal] = useState(0);
    const targetTotal = 220;

    // Animate running total after all cards land
    useEffect(() => {
        const startDelay = setTimeout(() => {
            let current = 0;
            const steps = 20;
            const increment = targetTotal / steps;
            const interval = setInterval(() => {
                current += increment;
                if (current >= targetTotal) {
                    setRunningTotal(targetTotal);
                    clearInterval(interval);
                } else {
                    setRunningTotal(Math.round(current));
                }
            }, 40);
            return () => clearInterval(interval);
        }, 2200);
        return () => clearTimeout(startDelay);
    }, []);

    return (
        <div className="relative w-full h-full flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.08),transparent_70%)]" />

            <div className="w-full max-w-xs relative z-10 space-y-2.5">
                {/* Payment cards — Monzo style */}
                {payments.map((payment, idx) => (
                    <motion.div
                        key={payment.job}
                        initial={{ y: -30, opacity: 0, scale: 0.95 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        transition={{
                            delay: 0.4 + (idx * 0.5),
                            type: "spring",
                            stiffness: 300,
                            damping: 24,
                        }}
                        className="bg-white rounded-2xl p-3.5 shadow-lg border-l-4 border-emerald-500 flex items-center gap-3"
                    >
                        {/* Green circle icon */}
                        <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                            <ArrowRight size={16} className="text-white rotate-[-135deg]" />
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-900">{payment.job}</div>
                            <div className="text-[11px] text-slate-400">{payment.area} · {payment.time}</div>
                        </div>

                        {/* Amount */}
                        <div className="text-right flex-shrink-0">
                            <div className="text-base font-black text-emerald-600 tabular-nums">
                                +£{payment.amount}
                            </div>
                        </div>
                    </motion.div>
                ))}

                {/* Running total */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 2.2 }}
                    className="flex items-center justify-between pt-2 px-1"
                >
                    <span className="text-xs font-medium text-slate-400">This week</span>
                    <span className="text-xl font-black text-white tabular-nums">
                        £{runningTotal}
                    </span>
                </motion.div>
            </div>

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
        title: "PROFIT FROM YOUR SPARE DAYS",
        highlight: "SPARE DAYS",
        desc: "We connect you with ready-to-go jobs in your area. You pick the days. We handle the rest.",
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
        component: <PaymentNotificationsAnimation />,
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
                                    className={`font-bold text-white mb-1.5 leading-tight ${
                                        currentSlide === 0
                                            ? 'text-3xl sm:text-4xl font-black tracking-tight'
                                            : 'text-xl sm:text-2xl'
                                    }`}
                                >
                                    {slides[currentSlide].highlight
                                        ? <>
                                            {slides[currentSlide].title.split(slides[currentSlide].highlight!)[0]}
                                            <span className="text-[#6C6CFF]">{slides[currentSlide].highlight}</span>
                                            {slides[currentSlide].title.split(slides[currentSlide].highlight!)[1]}
                                          </>
                                        : slides[currentSlide].title
                                    }
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
