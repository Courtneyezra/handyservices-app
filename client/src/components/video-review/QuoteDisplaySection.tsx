import { motion, AnimatePresence } from 'framer-motion';
import { Check, MessageSquare, Clock } from 'lucide-react';
import { PriceBreakdown } from './PriceBreakdown';

interface QuoteDisplaySectionProps {
    quoteData?: any; // Accepting full quote object
    quoteRange: { low: number; high: number };
    tasks: Array<{ description: string }>;
    handymanStatus?: {
        name: string;
        avatar?: string;
        message: string;
        isLive: boolean;
        estimatedTime: string;
    };
    isVisible: boolean;
}

export function QuoteDisplaySection({
    quoteData,
    quoteRange,
    tasks,
    handymanStatus,
    isVisible
}: QuoteDisplaySectionProps) {
    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="overflow-hidden"
                >
                    <div className="px-4 pb-32 pt-4"> {/* Extra padding bottom for scrolling */}
                        {/* Quote Card */}
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border border-emerald-500/30 shadow-2xl overflow-hidden mb-6"
                        >
                            <div className="p-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500 bg-[length:200%_100%] animate-shimmer" />

                            <div className="p-6 text-center">
                                <h2 className="text-xl text-slate-300 font-medium mb-4">✨ Your Instant Quote</h2>

                                <div className="flex flex-col items-center justify-center p-6 bg-slate-950/50 rounded-xl border border-slate-800/50 mb-6">
                                    <div className="text-3xl sm:text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-teal-300 mb-2 whitespace-nowrap">
                                        £{quoteRange.low} - £{quoteRange.high}
                                    </div>
                                    <p className="text-slate-400 text-sm">Estimated total (Labour + Materials)</p>

                                    <div className="w-full h-2 bg-slate-800 rounded-full mt-6 overflow-hidden max-w-[240px]">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: '60%' }}
                                            transition={{ duration: 1, delay: 0.5 }}
                                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                                        />
                                    </div>

                                    {/* UX IMPROVEMENT: Detailed Price Breakdown */}
                                    {quoteData?.breakdown && (
                                        <PriceBreakdown
                                            breakdown={quoteData.breakdown}
                                            quoteRange={quoteRange}
                                            confidence={quoteData.confidence}
                                        />
                                    )}
                                </div>
                            </div>

                            <div className="text-left space-y-3 px-6 pb-6">
                                <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
                                    <Check className="w-4 h-4 text-emerald-500" />
                                    What's included in this price:
                                </h3>
                                <ul className="space-y-3 pl-1">
                                    {tasks.map((task, i) => (
                                        <li key={i} className="flex items-start gap-4 text-slate-200 text-sm leading-relaxed">
                                            <div className="w-1.5 h-1.5 rounded-full bg-slate-500 mt-2 shrink-0 shadow-[0_0_8px_rgba(100,116,139,0.5)]" />
                                            <span>{task.description}</span>
                                        </li>
                                    ))}
                                    <li className="flex items-start gap-4 text-emerald-400 text-sm font-medium leading-relaxed pt-2 border-t border-slate-800/50 mt-2">
                                        <Check className="w-4 h-4 mt-0.5 shrink-0" />
                                        Professional labour & standard materials
                                    </li>
                                </ul>
                            </div>

                        </motion.div>

                        {/* Live Handyman Status */}
                        {handymanStatus && (
                            <motion.div
                                initial={{ scale: 0.95, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ delay: 0.8 }}
                                className="bg-slate-800 rounded-xl p-5 border border-slate-700/50 relative overflow-hidden"
                            >
                                <div className="absolute top-0 right-0 p-3">
                                    <div className="flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-xs font-bold text-emerald-400">LIVE</span>
                                    </div>
                                </div>

                                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Handyman Status</h3>

                                <div className="flex items-start gap-4">
                                    <div className="relative">
                                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white text-xl font-bold border-2 border-slate-900 shadow-xl z-10 relative">
                                            {handymanStatus.name[0]} {handymanStatus.name.split(' ')[1]?.[0]}
                                        </div>
                                        {handymanStatus.isLive && (
                                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-4 border-slate-800 z-20 flex items-center justify-center">
                                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                                            </div>
                                        )}
                                        {/* Pulse effect rings */}
                                        <div className="absolute inset-0 rounded-full border border-indigo-500/50 animate-ping opacity-75" style={{ animationDuration: '2s' }} />
                                    </div>

                                    <div className="flex-1 space-y-2">
                                        <div>
                                            <p className="text-white font-medium text-lg">{handymanStatus.name} is reviewing now</p>
                                            <div className="flex items-center gap-1 text-slate-400 text-xs mt-0.5">
                                                <Clock className="w-3 h-3" />
                                                <span>Estimated response: 2 hours</span>
                                            </div>
                                        </div>

                                        <div className="bg-slate-700/50 rounded-lg p-3 rounded-tl-none border border-slate-600/50 mt-2 relative">
                                            <div className="absolute -top-1.5 left-0 w-3 h-3 bg-slate-700/50 rotate-45 border-l border-t border-slate-600/50" />
                                            <div className="flex items-start gap-2">
                                                <MessageSquare className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                                                <p className="text-sm text-slate-200 italic">"{handymanStatus.message}"</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        <div className="mt-8 text-center bg-emerald-950/30 p-4 rounded-xl border border-emerald-900/50">
                            <p className="text-emerald-400 text-sm font-medium">📱 We've texted you these details</p>
                            <p className="text-emerald-500/60 text-xs mt-1">Check your phone used: {sessionStorage.getItem('lead_data') ? JSON.parse(sessionStorage.getItem('lead_data')!).phone : '***'}</p>
                        </div>
                    </div>
                </motion.div >
            )
            }
        </AnimatePresence >
    );
}
