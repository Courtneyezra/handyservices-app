import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Phone,
    PhoneOff,
    User,
    MapPin,
    Clock,
    AlertCircle,
    Play,
    Wifi,
    WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLiveCall } from "@/contexts/LiveCallContext";
import { LiveCallActionPanel } from "@/components/calls/LiveCallActionPanel";
import { OutcomeGauge } from "@/components/ui/OutcomeGauge";
import { OutcomeHero } from "@/components/ui/OutcomeHero";
import { format } from "date-fns";

export default function LiveCallPage() {
    const {
        isLive,
        liveCallData,
        interimTranscript,
        isSimulating,
        startSimulation,
        clearCall,
        audioQuality,
        detectedPostcode,
        duplicateWarning,
    } = useLiveCall();

    // Extract data from context
    const transcription = liveCallData?.transcription || "";
    const segments = liveCallData?.segments || [];
    const detection = liveCallData?.detection;
    const metadata = liveCallData?.metadata;
    const outcome = (detection?.nextRoute || 'UNKNOWN') as 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'SITE_VISIT' | 'UNKNOWN';
    const confidence = detection?.confidence || 0;

    // Format duration
    const [callDuration, setCallDuration] = React.useState(0);
    React.useEffect(() => {
        if (!isLive) {
            setCallDuration(0);
            return;
        }
        const interval = setInterval(() => {
            setCallDuration(d => d + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [isLive]);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            {/* Header */}
            <div className="border-b border-slate-800 bg-slate-900/50 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className={cn(
                            "p-2 rounded-full",
                            isLive
                                ? "bg-green-500/20 animate-pulse"
                                : "bg-slate-700"
                        )}>
                            {isLive ? (
                                <Phone className="h-5 w-5 text-green-400" />
                            ) : (
                                <PhoneOff className="h-5 w-5 text-slate-400" />
                            )}
                        </div>
                        <div>
                            <h1 className="text-xl font-bold">
                                {isLive ? 'Live Call Active' : 'No Active Call'}
                            </h1>
                            <p className="text-sm text-slate-400">
                                {isLive
                                    ? `Duration: ${formatDuration(callDuration)}`
                                    : 'Waiting for incoming call...'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Audio Quality Indicator */}
                        {isLive && (
                            <Badge
                                variant="outline"
                                className={cn(
                                    audioQuality === 'GOOD' && "border-green-500 text-green-400",
                                    audioQuality === 'POOR' && "border-yellow-500 text-yellow-400",
                                    audioQuality === 'DROPOUT' && "border-red-500 text-red-400"
                                )}
                            >
                                {audioQuality === 'GOOD' ? (
                                    <Wifi className="h-3 w-3 mr-1" />
                                ) : (
                                    <WifiOff className="h-3 w-3 mr-1" />
                                )}
                                {audioQuality}
                            </Badge>
                        )}

                        {/* Simulation Button (Dev Only) */}
                        {!isLive && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => startSimulation({ complexity: 'SIMPLE' })}
                                disabled={isSimulating}
                            >
                                <Play className="h-4 w-4 mr-2" />
                                Simulate Call
                            </Button>
                        )}

                        {isLive && (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={clearCall}
                            >
                                <PhoneOff className="h-4 w-4 mr-2" />
                                End Call
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto p-4">
                {!isLive ? (
                    /* No Active Call State */
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="p-6 bg-slate-800/50 rounded-full mb-6">
                            <PhoneOff className="h-12 w-12 text-slate-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-300 mb-2">
                            No Active Call
                        </h2>
                        <p className="text-slate-500 mb-6 text-center max-w-md">
                            When a call comes in, the live transcript, SKU detection, and action panel will appear here.
                        </p>
                        <Button
                            variant="outline"
                            onClick={() => startSimulation({ complexity: 'RANDOM' })}
                        >
                            <Play className="h-4 w-4 mr-2" />
                            Run Training Simulation
                        </Button>
                    </div>
                ) : (
                    /* Live Call View */
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left Column: Transcript + Metadata */}
                        <div className="lg:col-span-2 space-y-4">
                            {/* Customer Metadata Card */}
                            <Card className="bg-slate-900 border-slate-800">
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 bg-slate-800 rounded-full">
                                                <User className="h-5 w-5 text-slate-400" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">
                                                    {metadata?.customerName || 'Unknown Caller'}
                                                </div>
                                                <div className="text-sm text-slate-400 flex items-center gap-2">
                                                    <Phone className="h-3 w-3" />
                                                    {metadata?.phoneNumber || 'No number'}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            {metadata?.address && (
                                                <div className="text-sm text-slate-400 flex items-center gap-1">
                                                    <MapPin className="h-3 w-3" />
                                                    {metadata.address}
                                                </div>
                                            )}
                                            {detectedPostcode && (
                                                <Badge variant="outline" className="border-blue-500 text-blue-400">
                                                    {detectedPostcode}
                                                </Badge>
                                            )}
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    metadata?.urgency === 'Critical' && "border-red-500 text-red-400",
                                                    metadata?.urgency === 'High' && "border-orange-500 text-orange-400",
                                                    metadata?.urgency === 'Standard' && "border-slate-500 text-slate-400",
                                                    metadata?.urgency === 'Low' && "border-slate-600 text-slate-500"
                                                )}
                                            >
                                                {metadata?.urgency || 'Standard'}
                                            </Badge>
                                            <Badge variant="secondary">
                                                {metadata?.leadType || 'Unknown'}
                                            </Badge>
                                        </div>
                                    </div>

                                    {/* Duplicate Warning */}
                                    {duplicateWarning && (
                                        <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-center gap-2 text-yellow-400 text-sm">
                                            <AlertCircle className="h-4 w-4" />
                                            {duplicateWarning}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Live Transcript */}
                            <Card className="bg-slate-900 border-slate-800">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                                        Live Transcript
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <ScrollArea className="h-[400px] pr-4">
                                        <div className="space-y-3">
                                            {segments.map((segment, index) => (
                                                <div
                                                    key={index}
                                                    className={cn(
                                                        "p-3 rounded-lg",
                                                        segment.speaker === 0
                                                            ? "bg-blue-500/10 border border-blue-500/20 ml-0 mr-12"
                                                            : "bg-purple-500/10 border border-purple-500/20 ml-12 mr-0"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={cn(
                                                            "text-xs font-medium",
                                                            segment.speaker === 0 ? "text-blue-400" : "text-purple-400"
                                                        )}>
                                                            {segment.speaker === 0 ? 'Customer' : 'Agent'}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-slate-200">{segment.text}</p>
                                                </div>
                                            ))}

                                            {/* Interim (currently typing) */}
                                            {interimTranscript && (
                                                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700 border-dashed">
                                                    <p className="text-sm text-slate-400 italic">
                                                        {interimTranscript}...
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </ScrollArea>
                                </CardContent>
                            </Card>

                            {/* Outcome Gauge */}
                            <Card className="bg-slate-900 border-slate-800">
                                <CardContent className="p-6 flex items-center justify-center">
                                    <OutcomeGauge
                                        outcome={outcome}
                                        value={confidence}
                                        size={280}
                                    />
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right Column: Action Panel */}
                        <div className="space-y-4">
                            <LiveCallActionPanel />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
