import React from 'react';
import { motion } from 'framer-motion';
import { Tv, Drill, Paintbrush, Hammer, Wrench, Zap, Droplet, Search, Ruler, Home, Clock, CheckCircle2, MessageCircle } from 'lucide-react';

interface ExpertStickyNoteProps {
    text: string;
    customerName?: string;
    phone?: string;
    address?: string | null;
    mikePhotoUrl?: string; // Optional, can fallback or be omitted
    className?: string;
    showExperienceStats?: boolean;
    showDirectContact?: boolean;
    availabilityHint?: string;
}

// Simple keyword matcher for doodles
const getDoodleIcon = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes('tv') || lower.includes('mount') || lower.includes('screen')) return Tv;
    if (lower.includes('drill') || lower.includes('shelf') || lower.includes('shelves') || lower.includes('blind')) return Drill;
    if (lower.includes('paint') || lower.includes('wall') || lower.includes('decor')) return Paintbrush;
    if (lower.includes('assembl') || lower.includes('flatpack')) return Hammer;
    if (lower.includes('leak') || lower.includes('plumb') || lower.includes('tap') || lower.includes('sink')) return Droplet;
    if (lower.includes('electric') || lower.includes('light') || lower.includes('switch') || lower.includes('outlets')) return Zap;
    if (lower.includes('measure') || lower.includes('size')) return Ruler;
    if (lower.includes('inspect') || lower.includes('assess')) return Search;

    return Wrench; // Default
};

export function ExpertStickyNote({
    text,
    customerName,
    phone,
    address,
    mikePhotoUrl,
    className = '',
    showExperienceStats = true,
    showDirectContact = true,
    availabilityHint
}: ExpertStickyNoteProps) {
    const DoodleIcon = getDoodleIcon(text);
    const [isExpanded, setIsExpanded] = React.useState(false);

    // Generate a dynamic availability hint if not provided
    const getAvailabilityHint = () => {
        if (availabilityHint) return availabilityHint;
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const today = new Date().getDay();
        const nextAvailable = days[(today + 1) % 5] || 'Monday';
        return `I've got a slot on ${nextAvailable} if that works for you`;
    };

    // Thresholds for truncation
    const CHAR_LIMIT = 100;
    const LINE_LIMIT = 3;

    // Check if text is long by chars or lines
    const isLongText = text.length > CHAR_LIMIT || text.split('\n').length > LINE_LIMIT;

    let displayedText = text;
    if (!isExpanded && isLongText) {
        if (text.length > CHAR_LIMIT) {
            displayedText = text.slice(0, CHAR_LIMIT) + '...';
        } else {
            // Truncate by lines
            const lines = text.split('\n');
            displayedText = lines.slice(0, LINE_LIMIT).join('\n') + '...';
        }
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20, rotate: -2, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, rotate: -1, scale: 1 }}
            className={`relative mx-auto max-w-lg cursor-pointer group ${className}`}
            onClick={() => !isExpanded && isLongText && setIsExpanded(true)}
        >
            {/* Hand-drawn SVG Filter for Doodles */}
            <svg width="0" height="0" className="absolute block w-0 h-0 overflow-hidden">
                <filter id="doodle-filter">
                    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" result="noise" />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" />
                </filter>
            </svg>

            {/* Realistic Tape Effect */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-32 h-8 bg-white/30 rotate-1 backdrop-blur-sm shadow-sm z-20 pointer-events-none transform -skew-y-1 rounded-sm border-l border-r border-white/40"></div>

            {/* Main Sticky Note */}
            <motion.div
                layout
                transition={{ layout: { duration: 0.4, type: "spring", bounce: 0.2 } }}
                className={`relative bg-[#fef9c3] p-6 md:p-8 shadow-[2px_4px_12px_rgba(0,0,0,0.1)] transform rotate-1 transition-all group-hover:rotate-0 group-hover:scale-[1.02] duration-300 font-['Kalam'] overflow-hidden flex flex-col ${isExpanded ? '' : 'min-h-[200px] md:min-h-[240px]'}`}
            >

                {/* Background Doodle Watermark - Multi-Stroke Sketch Effect */}
                {/* Moved to bottom-left to avoid text overlapping signature/photo */}
                <div className="absolute bottom-4 left-4 pointer-events-none z-0 mix-blend-multiply opacity-60 select-none">
                    {/* Layer 1: Base - Faint & Wobbly */}
                    <DoodleIcon
                        className="absolute w-32 h-32 md:w-40 md:h-40 text-slate-800"
                        strokeWidth={1}
                        style={{ filter: 'url(#doodle-filter)', transform: 'rotate(-12deg) translate(0px, 0px)', opacity: 0.1 }}
                    />
                    {/* Layer 2: Offset Sketch - Slightly darker, different wobble */}
                    <DoodleIcon
                        className="absolute w-32 h-32 md:w-40 md:h-40 text-slate-900"
                        strokeWidth={1.2}
                        style={{ filter: 'url(#doodle-filter)', transform: 'rotate(-10deg) translate(3px, -2px)', opacity: 0.08 }}
                    />
                    {/* Layer 3: Messy Details - Thinner, more offset */}
                    <DoodleIcon
                        className="w-32 h-32 md:w-40 md:h-40 text-slate-700"
                        strokeWidth={0.8}
                        style={{ filter: 'url(#doodle-filter)', transform: 'rotate(-14deg) translate(-2px, 4px)', opacity: 0.05 }}
                    />
                </div>

                {/* DETAILS HEADER: Replaces standard cards */}
                <div className="relative z-10 mb-4 md:mb-6 flex flex-col items-start gap-3 md:gap-4 border-b-2 border-slate-800/10 pb-3 md:pb-4 w-full">
                    {(customerName || phone) && (
                        <div className="flex flex-col w-full">
                            <span className="text-[10px] md:text-xs uppercase tracking-widest text-slate-500 font-sans font-bold mb-1">Client Details</span>
                            <div className="flex flex-wrap items-baseline gap-x-2">
                                {customerName && <span className="text-xl md:text-2xl font-bold text-slate-900 leading-none">{customerName}</span>}
                                {phone && <span className="text-slate-600 text-base md:text-lg font-semibold font-sans">{phone}</span>}
                            </div>
                        </div>
                    )}
                    {address && (
                        <div className="flex flex-col w-full">
                            <span className="text-[10px] md:text-xs uppercase tracking-widest text-slate-500 font-sans font-bold mb-1">Site Location</span>
                            <span className="text-base md:text-lg font-bold text-slate-800 leading-tight">{address}</span>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="relative z-10 text-lg md:text-2xl leading-relaxed text-slate-800/90 space-y-4 flex-grow">
                    {displayedText.split('\n').map((line, i) => (
                        line.trim() && <p key={i}>{line}</p>
                    ))}

                    {/* See More / See Less Toggle */}
                    {isLongText && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded(!isExpanded);
                            }}
                            className="text-amber-700/80 hover:text-amber-800 font-bold text-base md:text-lg italic mt-2 flex items-center gap-1 focus:outline-none"
                        >
                            {isExpanded ? 'Show Less' : '(Read Note ...)'}
                        </button>
                    )}
                </div>

                {/* Experience Stats & Direct Contact */}
                {(showExperienceStats || showDirectContact) && (
                    <div className="relative z-10 mt-6 pt-4 border-t-2 border-slate-800/10 space-y-3">
                        {showExperienceStats && (
                            <div className="flex flex-wrap items-center gap-3 text-[11px] md:text-xs font-sans text-slate-600">
                                <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    12 years experience
                                </span>
                                <span className="text-slate-300">|</span>
                                <span className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    2,400+ jobs completed
                                </span>
                            </div>
                        )}
                        {showDirectContact && (
                            <div className="flex items-center gap-2 text-[11px] md:text-xs font-sans">
                                <MessageCircle className="w-3 h-3 text-green-600" />
                                <span className="text-slate-600">Text me direct on </span>
                                <a href="tel:+447449501762" className="text-slate-800 font-bold underline">07449 501762</a>
                                <span className="text-slate-600">if you have questions</span>
                            </div>
                        )}

                    </div>
                )}

                {/* Footer: Signature & Photo */}
                <div className="relative z-10 mt-6 md:mt-8 flex items-end justify-end gap-3 md:gap-4 translate-x-1">
                    {/* Signature Block */}
                    <div className="flex flex-col items-end transform -rotate-2">
                        <div className="font-['Kalam'] text-2xl md:text-3xl text-slate-800 font-bold leading-none mb-1">
                            - Mike
                        </div>
                        <div className="text-[8px] md:text-[10px] font-sans text-slate-500 uppercase tracking-widest font-bold">
                            Verified Handyman
                        </div>
                    </div>

                    {/* Mike's Photo - Circle matching signature flow */}
                    {mikePhotoUrl && (
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full overflow-hidden border-2 border-slate-800/10 shadow-sm opacity-95 sepia-[0.1]">
                            <img
                                src={mikePhotoUrl}
                                alt="Mike"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}
