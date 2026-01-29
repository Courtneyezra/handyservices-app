import { Home, Building2, Store } from "lucide-react";

interface SegmentSwitcherProps {
    activeSegment: 'residential' | 'property-manager' | 'business';
    onSegmentChange: (segment: 'residential' | 'property-manager' | 'business') => void;
}

export function SegmentSwitcher({ activeSegment, onSegmentChange }: SegmentSwitcherProps) {
    const segments = [
        {
            id: 'residential',
            label: 'My Home',
            shortLabel: 'My Home',
            icon: Home
        },
        {
            id: 'property-manager',
            label: 'Rental Properties',
            shortLabel: 'Rentals',
            icon: Building2
        },
        {
            id: 'business',
            label: 'My Business',
            shortLabel: 'Business',
            icon: Store
        }
    ] as const;

    return (
        <div className="w-full flex flex-col items-center justify-center py-6 md:py-8 relative z-20 -mt-6 md:-mt-8 mb-6 md:mb-8 px-4">
            <span className="text-slate-200 text-xs md:text-sm font-medium mb-3 tracking-wide uppercase opacity-80 shadow-sm">I need help with...</span>

            <div className="relative w-full max-w-full flex justify-center">
                {/* Scroll container with improved mobile handling */}
                <div className="inline-flex bg-slate-800/80 backdrop-blur-md p-1.5 rounded-full border border-slate-700/50 shadow-xl overflow-x-auto max-w-full scrollbar-none overscroll-x-contain touch-pan-x snap-x snap-mandatory">
                    {segments.map((segment) => {
                        const isActive = activeSegment === segment.id;
                        const Icon = segment.icon;

                        return (
                            <div
                                key={segment.id}
                                onClick={() => onSegmentChange(segment.id)}
                                className={`
                                    snap-center flex items-center gap-1.5 md:gap-2 px-4 md:px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 cursor-pointer whitespace-nowrap
                                    flex-shrink-0
                                    ${isActive
                                        ? 'bg-amber-400 text-slate-900 shadow-lg scale-100 md:scale-105 font-bold'
                                        : 'text-slate-300 hover:text-white hover:bg-white/10'
                                    }
                                `}
                            >
                                <Icon className={`w-4 h-4 ${isActive ? 'text-slate-900' : 'text-slate-400 group-hover:text-white'}`} />
                                <span className="hidden md:inline">{segment.label}</span>
                                <span className="md:hidden">{segment.shortLabel}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Visual hint for scrollable content on very small screens if needed - though the centered layout usually handles this well */}
        </div>
    );
}
