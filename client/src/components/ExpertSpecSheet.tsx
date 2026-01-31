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
                        <p className="text-slate-700 leading-relaxed">{trimmed.replace(/^[•\-\d\.]+\s*/, '')}</p>
                    </div>
                );
            }

            return <p key={i} className="text-slate-700 leading-relaxed mb-3">{trimmed}</p>;
        });
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`w-full px-4 md:px-8 lg:px-12 ${className}`}
        >
            {/* Main Card */}
            <div className="bg-white rounded-r-xl border-l-4 border-[#7DB00E] shadow-xl overflow-hidden">
                {/* Header Bar */}
                <div className="bg-slate-50 border-b border-slate-100 flex justify-between items-center px-4 md:px-6 py-3">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#7DB00E] animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Specification Sheet</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-green-100/50 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-green-200/50">
                        <CheckCircle2 className="w-3 h-3" />
                        Verified Plan
                    </div>
                </div>

                <div className="p-4 md:p-8">
                    {/* Client & Site Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 pb-6 border-b border-slate-100 border-dashed">
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7DB00E] mb-1.5 block">Client</label>
                            <div className="flex items-center gap-2 text-slate-900 font-bold text-lg">
                                <User className="w-4 h-4 text-slate-400" />
                                {customerName || 'Valued Customer'}
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7DB00E] mb-1.5 block">Site Location</label>
                            <div className="flex items-center gap-2 text-slate-900 font-medium text-lg">
                                <MapPin className="w-4 h-4 text-slate-400" />
                                {address || 'Remote Assessment'}
                            </div>
                        </div>
                    </div>

                    {/* Main Works Description */}
                    <div className="mb-8">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#7DB00E] mb-3 block">Scope of Works</label>
                        <div className="bg-slate-50/50 rounded-lg p-5 border border-slate-100 text-sm md:text-base">
                            {formatContent(text)}
                        </div>
                    </div>

                    {/* Integrated Content (Tiers/Toggle) */}
                    {children && (
                        <div className="mb-8 pt-6 border-t border-slate-100 border-dashed">
                            {children}
                        </div>
                    )}

                    {/* Footer / Sign-off */}
                    <div className="flex items-end justify-between pt-2">
                        <div className="flex items-center gap-4 text-xs text-slate-400">
                            <span className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" />
                                Valid for 48 Hours
                            </span>
                            <span className="hidden md:inline text-slate-300">|</span>
                            <span className="hidden md:inline">Ref: #{Math.floor(Math.random() * 90000) + 10000}</span>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="text-right">
                                <div className="text-sm font-bold text-slate-900">Mike</div>
                                <div className="text-[9px] font-bold uppercase text-[#7DB00E] tracking-wider">Senior Estimator</div>
                            </div>
                            {mikePhotoUrl && (
                                <div className="w-10 h-10 rounded-full border-2 border-slate-100 overflow-hidden shadow-sm">
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
