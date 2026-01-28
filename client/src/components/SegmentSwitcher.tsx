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
            icon: Home
        },
        {
            id: 'property-manager',
            label: 'Rental Properties',
            icon: Building2
        },
        {
            id: 'business',
            label: 'My Business',
            icon: Store
        }
    ] as const;

    return (
        <div className="w-full flex flex-col items-center justify-center py-8 relative z-20 -mt-8 mb-8">
            <span className="text-slate-200 text-sm font-medium mb-3 tracking-wide uppercase opacity-80">I need help with...</span>

            <div className="inline-flex bg-slate-800/80 backdrop-blur-md p-1.5 rounded-full border border-slate-700/50 shadow-xl overflow-x-auto max-w-full">
                {segments.map((segment) => {
                    const isActive = activeSegment === segment.id;
                    const Icon = segment.icon;

                    return (
                        <div
                            key={segment.id}
                            onClick={() => onSegmentChange(segment.id)}
                            className={`
                                    flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300 cursor-pointer whitespace-nowrap
                                    ${isActive
                                    ? 'bg-amber-400 text-slate-900 shadow-lg scale-105 font-bold'
                                    : 'text-slate-300 hover:text-white hover:bg-white/10'
                                }
                                `}
                        >
                            <Icon className={`w-4 h-4 ${isActive ? 'text-slate-900' : 'text-slate-400 group-hover:text-white'}`} />
                            {segment.label}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
