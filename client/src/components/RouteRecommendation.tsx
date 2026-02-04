import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Zap, Layers, FileText, AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RouteAnalysis {
    classification: {
        clientType: 'residential' | 'commercial';
        jobClarity: 'clear' | 'vague';
        jobType: 'standard' | 'complex' | 'emergency';
        urgency: 'low' | 'medium' | 'high';
        segment?: 'BUSY_PRO' | 'PROP_MGR' | 'LANDLORD' | 'SMALL_BIZ' | 'DIY_DEFERRER' | 'BUDGET' | 'UNKNOWN';
        reasoning: string;
    };
    recommendedRoute: 'instant' | 'tiers' | 'assessment';
    reasoning: string;
    confidence: 'high' | 'medium' | 'low';
}

interface RouteRecommendationProps {
    analysisResult?: RouteAnalysis | null;
    onSelectRoute: (route: 'instant' | 'tiers' | 'assessment') => void;
    selectedRoute?: 'instant' | 'tiers' | 'assessment';
    isAnalyzing?: boolean;
}

export function RouteRecommendation({
    analysisResult,
    onSelectRoute,
    selectedRoute,
    isAnalyzing = false
}: RouteRecommendationProps) {

    // If no analysis yet, show nothing or placeholder
    if (!analysisResult && !isAnalyzing) return null;

    return (
        <div className="space-y-6">
            {/* Route Selection Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Instant Action Route */}
                <RouteCard
                    title="Instant Action"
                    icon={<Zap className="w-5 h-5 text-yellow-500" />}
                    description="Specific, single-task jobs with clear pricing."
                    recommended={analysisResult?.recommendedRoute === 'instant'}
                    selected={selectedRoute === 'instant'}
                    onClick={() => onSelectRoute('instant')}
                    features={['Single Price', 'Immediate Booking', 'Simple Scope']}
                />

                {/* Service Tiers Route */}
                <RouteCard
                    title="Service Tiers"
                    icon={<Layers className="w-5 h-5 text-blue-500" />}
                    description="Packages offering different levels of value."
                    recommended={analysisResult?.recommendedRoute === 'tiers'}
                    selected={selectedRoute === 'tiers'}
                    onClick={() => onSelectRoute('tiers')}
                    features={['Good/Better/Best', 'Upsell Potential', 'Standard Tasks']}
                />

                {/* Expert Assessment Route */}
                <RouteCard
                    title="Expert Assessment"
                    icon={<FileText className="w-5 h-5 text-purple-500" />}
                    description="Complex jobs requiring consultation."
                    recommended={analysisResult?.recommendedRoute === 'assessment'}
                    selected={selectedRoute === 'assessment'}
                    onClick={() => onSelectRoute('assessment')}
                    features={['Custom Quote', 'Site Visit', 'Complex Scope']}
                />
            </div>

            {/* AI Reasoning Display */}
            {analysisResult && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium text-slate-900 mb-1">AI Recommendation Insight</p>
                        <p>{analysisResult.reasoning}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

function RouteCard({
    title,
    icon,
    description,
    recommended,
    selected,
    onClick,
    features
}: {
    title: string;
    icon: React.ReactNode;
    description: string;
    recommended: boolean;
    selected: boolean;
    onClick: () => void;
    features: string[];
}) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "relative cursor-pointer transition-all duration-200 border-2 rounded-xl p-5 hover:border-primary/50",
                selected ? "border-primary bg-primary/5" : "border-slate-200 bg-white",
                recommended && !selected && "border-indigo-300 bg-indigo-50/30"
            )}
        >
            {recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Recommended
                </div>
            )}

            {selected && (
                <div className="absolute top-3 right-3 text-primary">
                    <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center text-white">
                        <Check className="w-3 h-3" />
                    </div>
                </div>
            )}

            <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 mb-3">
                    <div className={cn(
                        "p-2 rounded-lg",
                        selected ? "bg-primary/10" : "bg-slate-100"
                    )}>
                        {icon}
                    </div>
                    <h3 className="font-bold text-lg">{title}</h3>
                </div>

                <p className="text-sm text-slate-500 mb-4 flex-grow">{description}</p>

                <div className="space-y-2 mt-auto">
                    {features.map((feature, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                            <div className="w-1 h-1 rounded-full bg-slate-400" />
                            {feature}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
