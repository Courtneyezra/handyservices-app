import { motion } from "framer-motion";
import { Mic, CheckCircle2, FileText, ArrowRight } from "lucide-react";

export function HeroQuoteAnimation() {
    return (
        <div className="relative w-full max-w-md mx-auto h-[400px] bg-slate-900/50 rounded-2xl border border-white/10 overflow-hidden shadow-2xl backdrop-blur-sm flex flex-col items-center justify-center p-6">
            {/* Background Grids/Glows */}
            <div className="absolute inset-0 bg-grid-white/[0.02] -z-10" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-amber-500/20 rounded-full blur-[50px] animate-pulse" />

            {/* Animation Sequence container */}
            <div className="relative w-full h-full flex flex-col items-center justify-center">

                {/* STAGE 1: VOICE INPUT */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{
                        opacity: [0, 1, 1, 0],
                        scale: [0.8, 1, 1, 1.1],
                        y: [0, 0, 0, -20]
                    }}
                    transition={{
                        duration: 4,
                        times: [0, 0.1, 0.8, 1],
                        repeat: Infinity,
                        repeatDelay: 4 // Wait for other stages
                    }}
                    className="absolute inset-0 flex flex-col items-center justify-center"
                >
                    <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center mb-4 relative">
                        <div className="absolute inset-0 rounded-full border border-amber-500/50 animate-ping opacity-75" />
                        <Mic className="w-8 h-8 text-amber-500" />
                    </div>
                    <div className="flex gap-1 h-8 items-center">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <motion.div
                                key={i}
                                animate={{ height: [10, 24, 10] }}
                                transition={{
                                    duration: 0.5,
                                    repeat: Infinity,
                                    delay: i * 0.1,
                                    ease: "easeInOut"
                                }}
                                className="w-1.5 bg-slate-400 rounded-full"
                            />
                        ))}
                    </div>
                    <p className="text-slate-400 text-sm mt-4 font-mono">"Boiler service for Mrs. Smith..."</p>
                </motion.div>


                {/* STAGE 2: PROCESSING / GENERATING */}
                {/* (Optional: could just be a transition, but keeping it simple for now) */}


                {/* STAGE 3: QUOTE CARD APPEARS */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{
                        opacity: [0, 0, 1, 1, 0],
                        y: [20, 20, 0, 0, -20]
                    }}
                    transition={{
                        duration: 4,
                        times: [0, 0.4, 0.5, 0.9, 1], // Start appearing after voice fades
                        repeat: Infinity,
                        repeatDelay: 4,
                        delay: 3.5 // Offset start time
                    }}
                    className="absolute w-full max-w-sm bg-slate-800 rounded-xl border border-white/10 shadow-xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="bg-slate-900/50 p-4 border-b border-white/5 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-amber-500" />
                            <span className="text-white font-bold text-sm">Quote #1024</span>
                        </div>
                        <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">Draft</span>
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-3">
                        <div className="flex justify-between items-start">
                            <div>
                                <div className="h-4 w-32 bg-slate-700 rounded animate-pulse mb-2" />
                                <div className="h-3 w-20 bg-slate-700/50 rounded" />
                            </div>
                            <div className="h-4 w-12 bg-slate-700 rounded" />
                        </div>

                        <div className="space-y-2 pt-2 border-t border-white/5">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-400">Boiler Service</span>
                                <span className="text-white">£80.00</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-400">Parts</span>
                                <span className="text-white">£45.00</span>
                            </div>
                        </div>

                        <div className="pt-3 border-t border-white/5 flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-300">Total</span>
                            <span className="text-xl font-bold text-white">£125.00</span>
                        </div>
                    </div>

                    {/* Action */}
                    <motion.div
                        className="p-3 bg-amber-500 flex items-center justify-center gap-2 cursor-pointer"
                        whileHover={{ scale: 1.02 }}
                    >
                        <span className="text-slate-900 font-bold text-sm">Send Quote</span>
                        <ArrowRight className="w-4 h-4 text-slate-900" />
                    </motion.div>
                </motion.div>


                {/* STAGE 4: SUCCESS */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{
                        opacity: [0, 0, 1, 0],
                        scale: [0.5, 0.5, 1, 1.2],
                    }}
                    transition={{
                        duration: 4,
                        times: [0, 0.85, 0.9, 1], // Appear at the very end
                        repeat: Infinity,
                        repeatDelay: 4,
                        delay: 3.5
                    }}
                    className="absolute inset-0 flex items-center justify-center z-10"
                >
                    <div className="w-24 h-24 rounded-full bg-emerald-500 flex items-center justify-center shadow-2xl shadow-emerald-500/40">
                        <CheckCircle2 className="w-12 h-12 text-white" />
                    </div>
                </motion.div>

            </div>
        </div>
    );
}
