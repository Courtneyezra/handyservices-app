import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, User, MapPin, Clock } from 'lucide-react';

interface ExpertSpecSheetProps {
    text: string;
    customerName?: string;
    address?: string | null;
    mikePhotoUrl?: string;
    className?: string;
    children?: React.ReactNode;
}

export function ExpertSpecSheet({
    text,
    customerName,
    address,
    mikePhotoUrl,
    className = '',
    children
}: ExpertSpecSheetProps) {

    // Format text into bullet points if it looks like a list, otherwise paragraphs
    const formatContent = (content: string) => {
        return content.split('\n').map((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) return <div key={i} className="h-2" />;

            // Check if line starts with a bullet indicator
            if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.match(/^\d+\./)) {
                return (
                    <div key={i} className="flex items-start gap-2 mb-1.5 pl-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#7DB00E] mt-2 shrink-0 opacity-60" />
                        <p className="text-slate-700 font-bold leading-relaxed">{trimmed.replace(/^[•\-\d\.]+\s*/, '')}</p>
                    </div>
                );
            }

            return <p key={i} className="text-slate-700 font-bold leading-relaxed mb-3">{trimmed}</p>;
        });
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`w-full ${className}`}
        >
            {/* Main Card */}
            <div className="bg-white rounded-r-xl border-l-4 border-[#7DB00E] shadow-xl overflow-hidden mx-2 md:mx-0">
                {/* Header Bar */}
                <div className="bg-slate-50 border-b border-slate-100 flex justify-between items-center px-3 md:px-5 py-2">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#7DB00E] animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Specification Sheet</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-green-100/50 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-green-200/50">
                        <CheckCircle2 className="w-3 h-3" />
                        Verified Plan
                    </div>
                </div>

                <div className="p-3 md:py-6 md:px-5">
                    {/* Client & Site Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 pb-4 border-b border-slate-100 border-dashed">
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7DB00E] mb-1 block">Client</label>
                            <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
                                <User className="w-4 h-4 text-slate-400" />
                                {customerName || 'Valued Customer'}
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7DB00E] mb-1 block">Site Location</label>
                            <div className="flex items-center gap-2 text-slate-700 text-sm">
                                <MapPin className="w-4 h-4 text-slate-400" />
                                {address || 'Remote Assessment'}
                            </div>
                        </div>
                    </div>

                    {/* Main Works Description */}
                    <div className="mb-6">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#7DB00E] mb-2 block">Scope of Works</label>
                        <div className="bg-slate-50/50 rounded-lg p-3 md:p-4 border border-slate-100 text-sm md:text-base">
                            {formatContent(text)}
                        </div>
                    </div>

                    {/* Integrated Content (Tiers/Toggle) */}
                    {children && (
                        <div className="pt-4 border-t border-slate-100 border-dashed">
                            {children}
                        </div>
                    )}

                    {/* Footer / Sign-off */}
                    <div className="flex items-end justify-between pt-4 mt-4 border-t border-slate-100">
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                48h valid
                            </span>
                            <span className="hidden md:inline text-slate-300">|</span>
                            <span className="hidden md:inline text-[10px]">#{Math.floor(Math.random() * 90000) + 10000}</span>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="text-right">
                                <div className="text-sm font-bold text-slate-900">Mike</div>
                                <div className="text-[9px] font-bold uppercase text-[#7DB00E] tracking-wider">Estimator</div>
                            </div>
                            {mikePhotoUrl && (
                                <div className="w-9 h-9 rounded-full border-2 border-slate-100 overflow-hidden shadow-sm">
                                    <img src={mikePhotoUrl} alt="Mike" className="w-full h-full object-cover" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
