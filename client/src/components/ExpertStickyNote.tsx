import React from 'react';
import { motion } from 'framer-motion';
import { Tv, Drill, Paintbrush, Hammer, Wrench, Zap, Droplet, Search, Ruler, Home } from 'lucide-react';

interface ExpertStickyNoteProps {
    text: string;
    customerName?: string;
    phone?: string;
    address?: string | null;
    mikePhotoUrl?: string; // Optional, can fallback or be omitted
    className?: string;
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

export function ExpertStickyNote({ text, customerName, phone, address, mikePhotoUrl, className = '' }: ExpertStickyNoteProps) {
    const DoodleIcon = getDoodleIcon(text);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20, rotate: -2, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, rotate: -1, scale: 1 }}
            className={`relative mx-auto max-w-lg cursor-pointer group ${className}`}
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
            <div className="relative bg-[#fef9c3] p-8 shadow-[2px_4px_12px_rgba(0,0,0,0.1)] transform rotate-1 transition-all group-hover:rotate-0 group-hover:scale-[1.02] duration-300 font-['Kalam'] overflow-hidden min-h-[320px]">

                {/* Background Doodle Watermark - Multi-Stroke Sketch Effect */}
                {/* Moved to bottom-left to avoid text overlapping signature/photo */}
                <div className="absolute bottom-4 left-4 pointer-events-none z-0 mix-blend-multiply opacity-60 select-none">
                    {/* Layer 1: Base - Faint & Wobbly */}
                    <DoodleIcon
                        className="absolute w-40 h-40 text-slate-800"
                        strokeWidth={1}
                        style={{ filter: 'url(#doodle-filter)', transform: 'rotate(-12deg) translate(0px, 0px)', opacity: 0.1 }}
                    />
                    {/* Layer 2: Offset Sketch - Slightly darker, different wobble */}
                    <DoodleIcon
                        className="absolute w-40 h-40 text-slate-900"
                        strokeWidth={1.2}
                        style={{ filter: 'url(#doodle-filter)', transform: 'rotate(-10deg) translate(3px, -2px)', opacity: 0.08 }}
                    />
                    {/* Layer 3: Messy Details - Thinner, more offset */}
                    <DoodleIcon
                        className="w-40 h-40 text-slate-700"
                        strokeWidth={0.8}
                        style={{ filter: 'url(#doodle-filter)', transform: 'rotate(-14deg) translate(-2px, 4px)', opacity: 0.05 }}
                    />
                </div>

                {/* DETAILS HEADER: Replaces standard cards */}
                <div className="relative z-10 mb-6 flex flex-col items-start gap-4 border-b-2 border-slate-800/10 pb-4 w-full">
                    {(customerName || phone) && (
                        <div className="flex flex-col w-full">
                            <span className="text-xs uppercase tracking-widest text-slate-500 font-sans font-bold mb-1">Client Details</span>
                            <div className="flex flex-wrap items-baseline gap-x-2">
                                {customerName && <span className="text-2xl font-bold text-slate-900 leading-none">{customerName}</span>}
                                {phone && <span className="text-slate-600 text-lg font-semibold font-sans">{phone}</span>}
                            </div>
                        </div>
                    )}
                    {address && (
                        <div className="flex flex-col w-full">
                            <span className="text-xs uppercase tracking-widest text-slate-500 font-sans font-bold mb-1">Site Location</span>
                            <span className="text-lg font-bold text-slate-800 leading-tight">{address}</span>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="relative z-10 text-xl md:text-2xl leading-relaxed text-slate-800/90 space-y-4">
                    {text.split('\n').map((line, i) => (
                        line.trim() && <p key={i}>{line}</p>
                    ))}
                </div>

                {/* Footer: Signature & Photo */}
                <div className="relative z-10 mt-12 flex items-end justify-end gap-4 translate-x-1">
                    {/* Signature Block */}
                    <div className="flex flex-col items-end transform -rotate-2">
                        <div className="font-['Kalam'] text-3xl text-slate-800 font-bold leading-none mb-1">
                            - Mike
                        </div>
                        <div className="text-[10px] font-sans text-slate-500 uppercase tracking-widest font-bold">
                            Verified Handyman
                        </div>
                    </div>

                    {/* Mike's Photo - Circle matching signature flow */}
                    {mikePhotoUrl && (
                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-slate-800/10 shadow-sm opacity-95 sepia-[0.1]">
                            <img
                                src={mikePhotoUrl}
                                alt="Mike"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
