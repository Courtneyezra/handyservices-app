import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Wrench, Hammer, Zap, BrickWall, Paintbrush, CheckCircle2 } from "lucide-react";

export function ConfettiTools({ onComplete }: { onComplete?: () => void }) {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsVisible(false);
            onComplete?.();
        }, 3500);
        return () => clearTimeout(timer);
    }, [onComplete]);

    const tools = [
        { Icon: Wrench, color: "text-slate-300", delay: 0 },
        { Icon: Hammer, color: "text-amber-500", delay: 0.1 },
        { Icon: Zap, color: "text-yellow-400", delay: 0.2 },
        { Icon: BrickWall, color: "text-orange-600", delay: 0.05 },
        { Icon: Paintbrush, color: "text-blue-400", delay: 0.15 },
        { Icon: Wrench, color: "text-slate-400", delay: 0.25 }, // Duplicate for density
        { Icon: Hammer, color: "text-amber-600", delay: 0.12 },
    ];

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm pointer-events-none"
                >
                    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">

                        {/* Flying Tools */}
                        {tools.map((tool, index) => (
                            <motion.div
                                key={index}
                                initial={{
                                    opacity: 0,
                                    scale: 0,
                                    x: 0,
                                    y: 0
                                }}
                                animate={{
                                    opacity: [0, 1, 1, 0],
                                    scale: [0.5, 1.5, 1.2, 0.5],
                                    x: (Math.random() - 0.5) * 600, // Random spread X
                                    y: (Math.random() - 0.5) * 600, // Random spread Y
                                    rotate: Math.random() * 720 - 360 // Random spin
                                }}
                                transition={{
                                    duration: 2.5,
                                    ease: "easeOut",
                                    delay: tool.delay
                                }}
                                className={`absolute ${tool.color}`}
                            >
                                <tool.Icon className="w-12 h-12 md:w-16 md:h-16 drop-shadow-lg" />
                            </motion.div>
                        ))}

                        {/* "JOB DONE" RUBBER STAMP EFFECT */}
                        <motion.div
                            initial={{ scale: 2, opacity: 0, rotate: -15 }}
                            animate={{ scale: 1, opacity: 1, rotate: -5 }}
                            transition={{
                                type: "spring",
                                stiffness: 300,
                                damping: 15,
                                delay: 0.4
                            }}
                            className="relative border-4 border-emerald-500 p-4 md:p-8 rounded-xl bg-emerald-500/10 backdrop-blur-md transform -rotate-6 shadow-[0_0_50px_rgba(16,185,129,0.3)]"
                        >
                            <div className="flex items-center gap-3 md:gap-4">
                                <CheckCircle2 className="w-10 h-10 md:w-16 md:h-16 text-emerald-500" />
                                <div className="flex flex-col">
                                    <span className="text-3xl md:text-6xl font-black text-emerald-500 uppercase tracking-tighter leading-none">
                                        JOB DONE!
                                    </span>
                                    <span className="text-emerald-400 font-bold uppercase tracking-widest text-xs md:text-sm mt-1 md:mt-2 text-center">
                                        Setup Complete
                                    </span>
                                </div>
                            </div>
                        </motion.div>

                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
