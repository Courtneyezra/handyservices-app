import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    Phone,
    Video,
    MapPin,
    Plus,
    Trash2,
    CreditCard,
    AlertCircle,
    CheckCircle2,
    Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLiveCall, LiveAnalysisJson } from "@/contexts/LiveCallContext";
import { SkuSelectorDropdown } from "./SkuSelectorDropdown";
import { BookNowModal } from "./BookNowModal";
import { RequestVideoModal } from "./RequestVideoModal";
import { SiteVisitModal } from "./SiteVisitModal";

interface DetectedSku {
    id?: string;
    name: string;
    pricePence: number;
    confidence?: number;
    category?: string;
    source: 'detected' | 'manual';
}

interface LiveCallActionPanelProps {
    callId?: string;
    className?: string;
}

export function LiveCallActionPanel({ callId, className }: LiveCallActionPanelProps) {
    const { liveCallData, isLive } = useLiveCall();
    const [manualSkus, setManualSkus] = useState<DetectedSku[]>([]);
    const [bookNowOpen, setBookNowOpen] = useState(false);
    const [requestVideoOpen, setRequestVideoOpen] = useState(false);
    const [siteVisitOpen, setSiteVisitOpen] = useState(false);

    // Combine detected and manual SKUs
    const allSkus = useMemo(() => {
        const detected: DetectedSku[] = [];
        if (liveCallData?.detection?.matched && liveCallData.detection.sku) {
            detected.push({
                name: liveCallData.detection.sku.name,
                pricePence: liveCallData.detection.sku.pricePence,
                confidence: liveCallData.detection.confidence,
                category: liveCallData.detection.sku.category,
                source: 'detected',
            });
        }
        return [...detected, ...manualSkus];
    }, [liveCallData?.detection, manualSkus]);

    // Calculate total
    const totalPricePence = useMemo(() => {
        return allSkus.reduce((sum, sku) => sum + sku.pricePence, 0);
    }, [allSkus]);

    // Get outcome prediction
    const outcome = liveCallData?.detection?.nextRoute || 'UNKNOWN';
    const confidence = liveCallData?.detection?.confidence || 0;
    const isHighConfidence = confidence >= 80;

    // Add manual SKU
    const handleAddSku = (sku: { id: string; name: string; pricePence: number; category: string | null }) => {
        setManualSkus(prev => [
            ...prev,
            {
                id: sku.id,
                name: sku.name,
                pricePence: sku.pricePence,
                category: sku.category || undefined,
                source: 'manual',
            },
        ]);
    };

    // Remove manual SKU
    const handleRemoveSku = (index: number) => {
        setManualSkus(prev => prev.filter((_, i) => i !== index));
    };

    // Get outcome styling
    const getOutcomeStyles = () => {
        switch (outcome) {
            case 'INSTANT_PRICE':
                return {
                    color: 'text-green-400',
                    bg: 'bg-green-500/10',
                    border: 'border-green-500/30',
                    glow: 'shadow-green-500/20',
                };
            case 'VIDEO_QUOTE':
                return {
                    color: 'text-blue-400',
                    bg: 'bg-blue-500/10',
                    border: 'border-blue-500/30',
                    glow: 'shadow-blue-500/20',
                };
            case 'SITE_VISIT':
                return {
                    color: 'text-purple-400',
                    bg: 'bg-purple-500/10',
                    border: 'border-purple-500/30',
                    glow: 'shadow-purple-500/20',
                };
            default:
                return {
                    color: 'text-slate-400',
                    bg: 'bg-slate-500/10',
                    border: 'border-slate-500/30',
                    glow: 'shadow-slate-500/20',
                };
        }
    };

    const styles = getOutcomeStyles();

    if (!isLive) {
        return null;
    }

    const customerName = liveCallData?.metadata?.customerName || 'Customer';
    const customerPhone = liveCallData?.metadata?.phoneNumber || '';
    const customerAddress = liveCallData?.metadata?.address || '';
    const transcription = liveCallData?.transcription || '';

    return (
        <>
            <Card className={cn("bg-slate-900 border-slate-800", className)}>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center justify-between">
                        <span>Live Call Actions</span>
                        {isHighConfidence && (
                            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                High Confidence
                            </Badge>
                        )}
                    </CardTitle>
                </CardHeader>

                <CardContent className="space-y-4">
                    {/* Detected Services */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400 font-medium">Detected Services</span>
                            <span className="text-slate-500">{allSkus.length} item(s)</span>
                        </div>

                        {allSkus.length > 0 ? (
                            <div className="space-y-2">
                                {allSkus.map((sku, index) => (
                                    <div
                                        key={`${sku.name}-${index}`}
                                        className={cn(
                                            "flex items-center justify-between p-2 rounded-lg border",
                                            sku.source === 'detected'
                                                ? "bg-purple-500/10 border-purple-500/30"
                                                : "bg-blue-500/10 border-blue-500/30"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="text-sm font-medium">{sku.name}</div>
                                            {sku.source === 'detected' && sku.confidence && (
                                                <Badge variant="secondary" className="text-[10px] h-5">
                                                    AI {sku.confidence}%
                                                </Badge>
                                            )}
                                            {sku.source === 'manual' && (
                                                <Badge variant="outline" className="text-[10px] h-5">
                                                    Manual
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold">
                                                £{(sku.pricePence / 100).toFixed(2)}
                                            </span>
                                            {sku.source === 'manual' && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-slate-400 hover:text-red-400"
                                                    onClick={() => handleRemoveSku(index - (allSkus.length - manualSkus.length))}
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-4 text-slate-500 text-sm border border-dashed border-slate-700 rounded-lg">
                                Listening for services...
                            </div>
                        )}

                        {/* Add SKU dropdown */}
                        <div className="pt-2">
                            <SkuSelectorDropdown onSkuSelected={handleAddSku} />
                        </div>
                    </div>

                    {/* Total */}
                    {allSkus.length > 0 && (
                        <>
                            <Separator className="bg-slate-700" />
                            <div className="flex items-center justify-between text-lg font-bold">
                                <span>Total</span>
                                <span className="text-green-400">
                                    £{(totalPricePence / 100).toFixed(2)}
                                </span>
                            </div>
                        </>
                    )}

                    {/* AI Recommendation */}
                    <div className={cn(
                        "p-3 rounded-lg border",
                        styles.bg,
                        styles.border
                    )}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-slate-400">AI Recommendation</span>
                            <span className={cn("text-sm font-semibold", styles.color)}>
                                {outcome === 'INSTANT_PRICE' && 'Instant Price'}
                                {outcome === 'VIDEO_QUOTE' && 'Video Quote'}
                                {outcome === 'SITE_VISIT' && 'Site Visit'}
                                {outcome === 'UNKNOWN' && 'Analyzing...'}
                            </span>
                        </div>
                        <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className={cn(
                                    "h-full transition-all duration-500",
                                    outcome === 'INSTANT_PRICE' ? "bg-green-500" :
                                    outcome === 'VIDEO_QUOTE' ? "bg-blue-500" :
                                    outcome === 'SITE_VISIT' ? "bg-purple-500" : "bg-slate-500"
                                )}
                                style={{ width: `${confidence}%` }}
                            />
                        </div>
                        <div className="text-right text-xs text-slate-500 mt-1">
                            {confidence}% confidence
                        </div>
                    </div>

                    {/* Suggested Script */}
                    {liveCallData?.detection?.suggestedScript && (
                        <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700 italic text-sm text-slate-300">
                            "{liveCallData.detection.suggestedScript}"
                        </div>
                    )}

                    <Separator className="bg-slate-700" />

                    {/* Action Buttons */}
                    <div className="space-y-2">
                        <Button
                            onClick={() => setBookNowOpen(true)}
                            disabled={allSkus.length === 0}
                            className={cn(
                                "w-full py-6 text-lg font-bold transition-all",
                                outcome === 'INSTANT_PRICE'
                                    ? "bg-green-500 hover:bg-green-600 text-black shadow-lg shadow-green-500/25"
                                    : "bg-slate-700 hover:bg-slate-600"
                            )}
                        >
                            <CreditCard className="h-5 w-5 mr-2" />
                            Book Now £{(totalPricePence / 100).toFixed(2)}
                        </Button>

                        <Button
                            onClick={() => setRequestVideoOpen(true)}
                            variant="outline"
                            className={cn(
                                "w-full py-5 font-semibold transition-all",
                                outcome === 'VIDEO_QUOTE'
                                    ? "border-blue-500 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                                    : "border-slate-600 hover:bg-slate-800"
                            )}
                        >
                            <Video className="h-5 w-5 mr-2" />
                            Request Video
                        </Button>

                        <Button
                            onClick={() => setSiteVisitOpen(true)}
                            variant="outline"
                            className={cn(
                                "w-full py-5 font-semibold transition-all",
                                outcome === 'SITE_VISIT'
                                    ? "border-purple-500 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                                    : "border-slate-600 hover:bg-slate-800"
                            )}
                        >
                            <MapPin className="h-5 w-5 mr-2" />
                            Site Visit
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Modals */}
            <BookNowModal
                open={bookNowOpen}
                onClose={() => setBookNowOpen(false)}
                customerName={customerName}
                customerPhone={customerPhone}
                customerAddress={customerAddress}
                skus={allSkus}
                totalPricePence={totalPricePence}
                callId={callId}
                onSuccess={() => {
                    setBookNowOpen(false);
                    setManualSkus([]);
                }}
            />

            <RequestVideoModal
                open={requestVideoOpen}
                onClose={() => setRequestVideoOpen(false)}
                customerName={customerName}
                customerPhone={customerPhone}
                detectedContext={transcription.substring(0, 200)}
                callId={callId}
                onSuccess={() => setRequestVideoOpen(false)}
            />

            <SiteVisitModal
                open={siteVisitOpen}
                onClose={() => setSiteVisitOpen(false)}
                customerName={customerName}
                customerPhone={customerPhone}
                customerAddress={customerAddress}
                callId={callId}
                onSuccess={() => setSiteVisitOpen(false)}
            />
        </>
    );
}
