import { motion } from "framer-motion";

export function CardSkeleton() {
    return (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 animate-pulse relative overflow-hidden">
            {/* Confidence badge skeleton */}
            <div className="w-24 h-5 bg-slate-700/50 rounded mb-3" />

            {/* Description skeleton */}
            <div className="space-y-2 mb-4">
                <div className="h-4 bg-slate-700/50 rounded w-full" />
                <div className="h-4 bg-slate-700/50 rounded w-3/4" />
            </div>

            {/* Hours skeleton */}
            <div className="h-3 bg-slate-700/50 rounded w-20" />

            {/* Shimmer effect */}
            <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-600/10 to-transparent"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                />
            </div>
        </div>
    );
}
