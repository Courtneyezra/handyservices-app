import { motion } from "framer-motion";
import { Check, Plus, ShoppingBag } from "lucide-react";
import { useState, useEffect } from "react";

export function UpsellAnimation() {
    const [isSelected, setIsSelected] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setIsSelected(prev => !prev);
        }, 3000); // Toggle every 3 seconds
        return () => clearInterval(interval);
    }, []);

    const basePrice = 120;
    const upsellPrice = 85;
    const total = isSelected ? basePrice + upsellPrice : basePrice;

    return (
        <div className="w-full max-w-sm bg-slate-900 rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="bg-slate-800/50 p-4 border-b border-white/5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <ShoppingBag className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                    <h3 className="text-white font-bold text-sm">Review & Accept</h3>
                    <p className="text-xs text-slate-400">Plumbing Services Ltd</p>
                </div>
            </div>

            <div className="p-5 space-y-6">
                {/* Core Service */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm font-medium">
                        <span className="text-white">Annual Boiler Service</span>
                        <span className="text-white">£{basePrice}</span>
                    </div>
                </div>

                {/* Upsell Block */}
                <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Recommended Extras</p>

                    <motion.div
                        className={`relative p-3 rounded-xl border transition-colors duration-300 cursor-pointer ${isSelected ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-slate-800 border-white/5'}`}
                        animate={{
                            scale: isSelected ? 1.02 : 1,
                        }}
                    >
                        <div className="flex items-start gap-3">
                            <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'}`}>
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-center mb-1">
                                    <span className={`text-sm font-medium ${isSelected ? 'text-emerald-400' : 'text-slate-300'}`}>Magnetic System Filter</span>
                                    <span className="text-sm font-bold text-white">+£{upsellPrice}</span>
                                </div>
                                <p className="text-xs text-slate-500 leading-relaxed">Protects your new boiler from debris and extends warranty.</p>
                            </div>
                        </div>

                        {/* Finger Click Animation */}
                        <motion.div
                            animate={{
                                opacity: [0, 1, 1, 0],
                                scale: [0.8, 1, 0.9, 1],
                                x: [20, 0, 0, 20],
                                y: [20, 0, 0, 20]
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                repeatDelay: 4, // Sync with the toggle loop roughly
                                times: [0, 0.2, 0.4, 1]
                            }}
                            className="absolute bottom-2 right-2 pointer-events-none"
                        >
                            {/* Simplified cursor visualization if needed, or just let the toggle speak for itself */}
                        </motion.div>
                    </motion.div>
                </div>

                {/* Total Bar */}
                <div className="pt-4 border-t border-white/10 flex justify-between items-end">
                    <span className="text-sm text-slate-400">Estimate Total</span>
                    <motion.div
                        key={total}
                        initial={{ scale: 0.8, color: "#94a3b8" }}
                        animate={{ scale: 1, color: "#ffffff" }}
                        className="text-2xl font-bold"
                    >
                        £{total}
                    </motion.div>
                </div>

                <div className="w-full py-3 bg-white hover:bg-slate-200 rounded-lg text-slate-900 font-bold text-center text-sm transition-colors">
                    Accept Quote
                </div>
            </div>
        </div>
    );
}
