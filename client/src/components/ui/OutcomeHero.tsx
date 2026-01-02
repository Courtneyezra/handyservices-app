import React from 'react';
import { Card } from './card';
import { Button } from './button';
import { CheckCircle2, AlertCircle, Video, CreditCard, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OutcomeHeroProps {
    outcome: 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'SITE_VISIT' | 'UNKNOWN';
    confidence: number;
    pricePence?: number;
    suggestedScript?: string;
    onAction: () => void;
    isLoading?: boolean;
}

export const OutcomeHero: React.FC<OutcomeHeroProps> = ({
    outcome,
    confidence,
    pricePence,
    suggestedScript,
    onAction,
    isLoading = false
}) => {
    const isHighConfidence = confidence >= 80;
    const isMediumConfidence = confidence >= 50 && confidence < 80;

    const getColors = () => {
        if (!isHighConfidence && !isMediumConfidence) return 'glow-purple border-purple-500/20';
        switch (outcome) {
            case 'INSTANT_PRICE': return 'glow-green border-green-500/20';
            case 'VIDEO_QUOTE': return 'glow-blue border-blue-500/20';
            case 'SITE_VISIT': return 'glow-purple border-purple-500/20';
            default: return 'glow-purple border-purple-500/20';
        }
    };

    const getIcon = () => {
        if (isLoading) return <Loader2 className="w-12 h-12 animate-spin text-white/50" />;
        switch (outcome) {
            case 'INSTANT_PRICE': return <CreditCard className="w-12 h-12 text-green-400" />;
            case 'VIDEO_QUOTE': return <Video className="w-12 h-12 text-blue-400" />;
            case 'SITE_VISIT': return <AlertCircle className="w-12 h-12 text-purple-400" />;
            default: return <Loader2 className="w-12 h-12 animate-spin text-white/50" />;
        }
    };

    const getLabel = () => {
        if (isLoading) return "Analyzing Call...";
        switch (outcome) {
            case 'INSTANT_PRICE': return "INSTANT PRICE AVAILABLE";
            case 'VIDEO_QUOTE': return "VIDEO REQUIRED";
            case 'SITE_VISIT': return "SITE VISIT RECOMMENDED";
            default: return "LISTENING...";
        }
    };

    const getSecondaryText = () => {
        if (outcome === 'INSTANT_PRICE' && pricePence) {
            return `Total Estimate: £${(pricePence / 100).toFixed(2)}`;
        }
        if (outcome === 'VIDEO_QUOTE') {
            return "Visual assessment needed for accurate pricing.";
        }
        return "Waiting for more details...";
    };

    return (
        <Card
            key={`${outcome}-${isHighConfidence}`}
            className={cn(
                "bento-card p-4 lg:p-8 flex flex-col items-center justify-center text-center space-y-6 min-h-[350px] lg:min-h-[400px] animate-in fade-in zoom-in-95 duration-500",
                getColors(),
                isHighConfidence && "ring-2 ring-white/10"
            )}
        >
            <div className="relative">
                {isHighConfidence && (
                    <div className="absolute -top-1 -right-1">
                        <CheckCircle2 className="w-6 h-6 text-green-400 fill-black" />
                    </div>
                )}
                <div className="p-4 lg:p-6 rounded-full bg-white/5 backdrop-blur-xl">
                    {getIcon()}
                </div>
            </div>

            <div className="space-y-2">
                <h2 className={cn(
                    "text-2xl lg:text-3xl font-black tracking-tighter italic",
                    outcome === 'INSTANT_PRICE' && isHighConfidence ? "text-green-400" : "text-white"
                )}>
                    {getLabel()}
                </h2>
                <p className="text-lg lg:text-xl font-medium text-white/70">
                    {getSecondaryText()}
                </p>
            </div>

            {suggestedScript && (
                <div className="max-w-md p-3 lg:p-4 bg-white/5 rounded-xl border border-white/10 italic text-sm lg:text-base text-white/90">
                    "{suggestedScript}"
                </div>
            )}

            <div className="w-full pt-4">
                <Button
                    onClick={onAction}
                    disabled={isLoading || outcome === 'UNKNOWN'}
                    className={cn(
                        "w-full py-6 lg:py-8 text-lg lg:text-xl font-bold rounded-2xl transition-all hover:scale-[1.02]",
                        outcome === 'INSTANT_PRICE' ? "bg-green-500 hover:bg-green-600 text-black" :
                            outcome === 'VIDEO_QUOTE' ? "bg-blue-500 hover:bg-blue-600 text-white" :
                                "bg-white/10 hover:bg-white/20 text-white"
                    )}
                >
                    {outcome === 'INSTANT_PRICE' ? 'BOOK JOB & COLLECT DEPOSIT' :
                        outcome === 'VIDEO_QUOTE' ? 'SEND WHATSAPP VIDEO LINK' :
                            'AWAITING OUTCOME'}
                </Button>
            </div>

            <div className="flex items-center space-x-2 text-sm font-medium text-white/40 uppercase tracking-widest">
                <span>AI Confidence</span>
                <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                        className={cn(
                            "h-full transition-all duration-1000",
                            isHighConfidence ? "bg-green-500" : "bg-blue-500"
                        )}
                        style={{ width: `${confidence}%` }}
                    />
                </div>
                <span>{confidence}%</span>
            </div>
        </Card>
    );
};
