import { LucideIcon } from 'lucide-react';

interface NeonBadgeProps {
    text: string;
    color: 'pink' | 'blue' | 'green' | 'amber';
    icon?: LucideIcon;
}

export function NeonBadge({ text, color, icon: Icon }: NeonBadgeProps) {
    const styles = {
        pink: "border-pink-500 text-pink-400 shadow-[0_0_10px_rgba(236,72,153,0.3)] drop-shadow-[0_0_2px_rgba(236,72,153,0.5)]",
        blue: "border-cyan-500 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)] drop-shadow-[0_0_2px_rgba(6,182,212,0.5)]",
        // Updated green to match brand lime green #7DB00E and increased glow
        green: "border-[#7DB00E] text-[#7DB00E] bg-[#7DB00E]/10 shadow-[0_0_15px_rgba(125,176,14,0.4)] drop-shadow-[0_0_5px_rgba(125,176,14,0.6)] relative overflow-hidden",
        amber: "border-amber-500 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)] drop-shadow-[0_0_2px_rgba(245,158,11,0.5)]",
    };

    return (
        <div className={`
      inline-flex items-center gap-1.5 px-3 py-1 rounded-full border 
      bg-black/40 backdrop-blur-sm 
      text-xs font-bold uppercase tracking-wider
      ${styles[color]}
      animate-pulse-slow
    `}>
            {Icon && <Icon className="w-3 h-3" />}
            <span>{text}</span>
        </div>
    );
}
