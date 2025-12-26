import React from 'react';

interface OutcomeGaugeProps {
    value: number; // 0 to 100 confidence
    outcome: 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'SITE_VISIT' | 'UNKNOWN';
    size?: number;
}

export const OutcomeGauge: React.FC<OutcomeGaugeProps> = ({
    value,
    outcome = 'UNKNOWN',
    size = 220
}) => {
    // Map outcome to angle (approximate centers of 3 zones)
    // 180 degree arc: 
    // Zone 1 (Site Visit): 10-60 deg
    // Zone 2 (Video Quote): 65-115 deg
    // Zone 3 (Instant Price): 120-170 deg

    let targetAngle = 0;
    let label = "Analyzing...";
    let color = "text-slate-400";

    switch (outcome) {
        case 'SITE_VISIT':
            targetAngle = 35;
            label = "Site Visit";
            color = "text-orange-500";
            break;
        case 'VIDEO_QUOTE':
            targetAngle = 90;
            label = "Video Quote";
            color = "text-blue-500";
            break;
        case 'INSTANT_PRICE':
            targetAngle = 145;
            label = "Instant Price";
            color = "text-green-500";
            break;
        default:
            targetAngle = 0; // Resting/Start
    }

    // If confidence is low, needle might wobble or stay low, 
    // but for this visualization we point to the best guess.
    // We can convert angle to rotation: -90 (left) to 90 (right)
    // Mapping 0-180 scale to -90 to 90 css rotation
    const rotation = targetAngle - 90;

    return (
        <div className="relative flex flex-col items-center justify-center p-2">
            {/* Gauge Container */}
            <div className="relative overflow-visible" style={{ width: size, height: size / 1.8 }}>
                <svg
                    className="w-full h-full overflow-visible"
                    viewBox="0 0 200 110"
                >
                    {/* Zone 1: Site Visit (Left) */}
                    <path
                        d="M 20 100 A 80 80 0 0 1 65 35"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="12"
                        className="text-orange-100"
                        strokeLinecap="butt"
                    />
                    {/* Zone 2: Video Quote (Middle) */}
                    <path
                        d="M 70 30 A 80 80 0 0 1 130 30"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="12"
                        className="text-blue-100"
                        strokeLinecap="butt"
                    />
                    {/* Zone 3: Instant Price (Right) */}
                    <path
                        d="M 135 35 A 80 80 0 0 1 180 100"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="12"
                        className="text-green-100"
                        strokeLinecap="butt"
                    />

                    {/* Labels for Zones (Small) */}
                    <text x="35" y="80" className="text-[8px] fill-slate-400 font-bold uppercase" transform="rotate(-30 35,80)">Visit</text>
                    <text x="100" y="20" className="text-[8px] fill-slate-400 font-bold uppercase" textAnchor="middle">Video</text>
                    <text x="165" y="80" className="text-[8px] fill-slate-400 font-bold uppercase" transform="rotate(30 165,80)">Price</text>

                    {/* Needle Pivot */}
                    <circle cx="100" cy="100" r="6" className="fill-slate-800" />

                    {/* The Needle */}
                    {/* We rotate a simple line/triangle group around 100,100 */}
                    <g
                        className="transition-transform duration-1000 cubic-bezier(0.4, 0, 0.2, 1)"
                        style={{ transform: `rotate(${rotation}deg)`, transformOrigin: '100px 100px' }}
                    >
                        <path
                            d="M 100 100 L 100 25"
                            stroke="currentColor"
                            strokeWidth="4"
                            className="text-slate-800"
                            strokeLinecap="round"
                        />
                    </g>
                </svg>

                {/* Current Outcome Label */}
                <div className="absolute inset-x-0 bottom-0 text-center flex flex-col items-center justify-end -mb-4">
                    <span className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Forecast Outcome</span>
                    <span className={`text-xl font-bold tracking-tight ${color} transition-colors duration-500`}>
                        {label}
                    </span>
                    <span className="text-[10px] font-mono text-slate-300 mt-1">
                        Confidence: {Math.round(value)}%
                    </span>
                </div>
            </div>
        </div>
    );
};
