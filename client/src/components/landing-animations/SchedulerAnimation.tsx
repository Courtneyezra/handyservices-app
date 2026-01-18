import { motion } from "framer-motion";
import { User, Bell, Clock, Calendar as CalendarIcon } from "lucide-react";
import { useState, useEffect } from "react";

export function SchedulerAnimation() {
    const [step, setStep] = useState(0);
    // 0: Empty slot
    // 1: Notification appears
    // 2: Booking confirmed

    useEffect(() => {
        const interval = setInterval(() => {
            setStep((s) => (s + 1) % 4); // 4 steps for a pause at the end
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    // Step Logic:
    // 0: Initial State
    // 1: Notification Pulse
    // 2: Slot fills
    // 3: Pause/Reset

    // Normalized for simpler rendering:
    const showNotification = step === 1 || step === 2;
    const isBooked = step >= 2 && step !== 3;

    return (
        <div className="w-full max-w-sm bg-slate-900 rounded-2xl border border-white/10 overflow-hidden shadow-2xl p-4">
            {/* Calendar Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5 text-indigo-400" />
                    <span className="text-white font-bold">Wed, 12th</span>
                </div>
                <span className="text-xs bg-indigo-500/10 text-indigo-400 px-2 py-1 rounded border border-indigo-500/20">Today</span>
            </div>

            {/* Time Slots Grid */}
            <div className="space-y-2">
                {/* 9:00 AM - Booked */}
                <div className="flex gap-3 items-stretch h-14">
                    <div className="w-16 flex items-center justify-end text-sm text-slate-500 font-mono">09:00</div>
                    <div className="flex-1 bg-slate-800 rounded-lg border border-white/5 p-2 flex items-center gap-3 opacity-50">
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                            <span className="text-xs font-bold text-slate-400">JD</span>
                        </div>
                        <div className="h-2 w-20 bg-slate-700 rounded" />
                    </div>
                </div>

                {/* 11:00 AM - Target Slot */}
                <div className="flex gap-3 items-stretch h-14 relative">
                    <div className="w-16 flex items-center justify-end text-sm text-slate-500 font-mono">11:00</div>
                    <div className="flex-1 rounded-lg border border-dashed border-slate-700 bg-slate-900/50 flex items-center justify-center relative overflow-hidden">

                        {/* Empty State Text */}
                        {!isBooked && (
                            <span className="text-xs text-slate-600 font-medium tracking-wide">AVAILABLE</span>
                        )}

                        {/* Notification / Incoming Request */}
                        <motion.div
                            initial={{ x: 50, opacity: 0 }}
                            animate={{
                                x: showNotification && !isBooked ? 0 : 50,
                                opacity: showNotification && !isBooked ? 1 : 0
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-indigo-500 text-white px-3 py-1.5 rounded-full shadow-lg z-20"
                        >
                            <Bell className="w-3 h-3" />
                            <span className="text-xs font-bold">New Req</span>
                        </motion.div>

                        {/* Booked State - Fills in */}
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: isBooked ? "100%" : "0%" }}
                            className="absolute left-0 top-0 bottom-0 bg-indigo-600 z-10"
                        />

                        {/* Content inside booked state */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: isBooked ? 1 : 0 }}
                            className="relative z-20 flex items-center gap-3 w-full p-2"
                        >
                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                                <User className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-white">New Customer</span>
                                <span className="text-[10px] text-indigo-200">Quote Accepted</span>
                            </div>
                        </motion.div>

                    </div>
                </div>

                {/* 13:00 PM - Booked */}
                <div className="flex gap-3 items-stretch h-14">
                    <div className="w-16 flex items-center justify-end text-sm text-slate-500 font-mono">13:00</div>
                    <div className="flex-1 bg-slate-800 rounded-lg border border-white/5 p-2 flex items-center gap-3 opacity-50">
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                            <span className="text-xs font-bold text-slate-400">AS</span>
                        </div>
                        <div className="h-2 w-24 bg-slate-700 rounded" />
                    </div>
                </div>
            </div>
        </div>
    );
}
