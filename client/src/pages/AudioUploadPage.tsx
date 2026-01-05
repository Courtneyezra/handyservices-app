import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import {
    X, Phone, MessageSquare,
    User, Activity
} from 'lucide-react';
import { useLiveCall } from '@/contexts/LiveCallContext';
import { OutcomeHero } from '@/components/ui/OutcomeHero';
import { LingoCoPilot } from '@/components/ui/LingoCoPilot';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function AudioUploadPage() {
    const {
        isLive, liveCallData, interimTranscript, startSimulation, clearCall, audioQuality
    } = useLiveCall();

    const { toast } = useToast();
    const [, setLocation] = useLocation();
    const [simPrompt, setSimPrompt] = useState("");
    const [benchmarkIndex, setBenchmarkIndex] = useState(-1);

    const benchmarkScenarios = [
        { label: "Emergency Leak", job: "Burst pipe under kitchen sink, water spraying everywhere!" },
        { label: "TV Mount", job: "Hang a 65 inch TV on a plasterboard wall in the clinic." },
        { label: "Messy Call", job: "Well I have a dog barking but I also need my gutters cleared and maybe my tap fixed." },
        { label: "Landlord Pro", job: "I am a property manager with 50 units, looking for reactive maintenance partner." },
        { label: "Electric Hazard", job: "Burning smell from fuse box and kitchen lights flickering." }
    ];

    const runBenchmark = (idx: number) => {
        setBenchmarkIndex(idx);
        startSimulation({
            complexity: idx === 2 ? 'MESSY' : (idx === 0 || idx === 4 ? 'EMERGENCY' : 'SIMPLE'),
            jobDescription: benchmarkScenarios[idx].job
        });
    };

    const lingoTerms = useMemo(() => {
        if (!liveCallData?.detection?.matched) return [];
        return [
            {
                jargon: 'The plastic box is making a clicking sound',
                term: 'Consumer Unit / RCD Trip',
                definition: 'Main electrical distribution board safety switch activation.'
            },
            {
                jargon: 'The spinny thing on the roof is full of leaves',
                term: 'Gutter Guard / Downpipe',
                definition: 'Debris blockage in the roof drainage system.'
            },
            {
                jargon: 'Water is just dribbling out of the tap',
                term: 'Low Flow / Aerator Blockage',
                definition: 'Internal obstruction in the faucet outlet.'
            }
        ];
    }, [liveCallData]);

    const handlePrimaryAction = () => {
        if (!liveCallData) return;
        const outcome = liveCallData.detection.nextRoute;
        const phone = liveCallData.metadata.phoneNumber;

        if (outcome === 'VIDEO_QUOTE') {
            setLocation(`/admin/whatsapp-intake?phone=${encodeURIComponent(phone || '')}`);
        } else if (outcome === 'INSTANT_PRICE') {
            toast({ title: "Booking Job", description: "Navigating to checkout..." });
        }
    };

    const isActionIsolated = (liveCallData?.detection.confidence ?? 0) >= 90;

    return (
        <div className="flex-1 flex flex-col min-h-screen lg:h-screen overflow-y-auto lg:overflow-hidden pb-20 lg:pb-0">

            <header className="flex h-16 items-center px-4 sticky top-0 bg-background/80 backdrop-blur-lg z-20 border-b border-white/5 space-x-4">
                <div className="flex items-center space-x-2 mr-auto">
                    <div className={cn("w-2.5 h-2.5 rounded-full", isLive ? "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]" : "bg-white/20")} />
                    <span className="text-[10px] uppercase font-black text-white/40 tracking-widest hidden sm:block">
                        {isLive ? 'Active Call Sessions' : 'Standby Mode'}
                    </span>
                </div>


                {isLive && (
                    <Button variant="ghost" size="sm" onClick={clearCall} className="bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20">
                        End All
                    </Button>
                )}
            </header>

            <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 p-4 lg:p-6 overflow-visible lg:overflow-hidden">
                {/* Context Column */}
                <div className={cn("col-span-1 lg:col-span-3 flex flex-col space-y-4 lg:space-y-6 transition-all duration-1000", isActionIsolated ? "opacity-20 pointer-events-none" : "opacity-100")}>
                    <article className="bento-card p-4 lg:p-6 flex flex-col space-y-4">
                        <span className="text-[10px] font-black uppercase text-white/20 tracking-widest px-1">Identity Card</span>
                        <div className="space-y-1">
                            <h3 className="text-2xl font-black truncate">{liveCallData?.metadata.customerName || 'Waiting...'}</h3>
                            <p className="text-xs font-medium text-white/40 truncate italic">{liveCallData?.metadata.address || 'Capturing Address...'}</p>
                        </div>
                    </article>
                    <div className="flex-1">
                        <LingoCoPilot terms={lingoTerms} isLoading={isLive && !liveCallData} />
                    </div>
                </div>

                {/* Primary Action Hero */}
                <div className="col-span-1 lg:col-span-6 flex flex-col space-y-4 lg:space-y-6 order-first lg:order-none">
                    <OutcomeHero
                        outcome={(liveCallData?.detection.nextRoute || 'UNKNOWN') as any}
                        confidence={liveCallData?.detection.confidence || 0}
                        suggestedScript={liveCallData?.detection.suggestedScript}
                        onAction={handlePrimaryAction}
                        isLoading={isLive && !liveCallData?.detection.matched}
                    />

                    <article className={cn("bento-card flex-1 p-4 lg:p-6 flex flex-col min-h-[300px] lg:min-h-0 transition-opacity duration-1000", isActionIsolated ? "opacity-20" : "opacity-100")}>
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-[10px] font-black uppercase text-white/20 tracking-widest px-1">Transcription</h4>
                            <div className={cn("px-2 py-0.5 rounded text-[8px] font-black uppercase", audioQuality === 'GOOD' ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500")}>{audioQuality}</div>
                        </div>
                        <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar">
                            {liveCallData?.segments.slice(-4).map((seg, i) => (
                                <div key={i} className={cn("flex items-start space-x-3", seg.speaker === 0 ? "text-white/90" : "text-handy-gold/80")}>
                                    <span className="text-[10px] font-black uppercase mt-1 opacity-20">{seg.speaker === 0 ? 'CX' : 'VA'}</span>
                                    <p className="text-sm font-medium italic">"{seg.text}"</p>
                                </div>
                            ))}
                            {interimTranscript && (
                                <div className="flex items-start space-x-3 opacity-50 animate-pulse">
                                    <span className="text-[10px] font-black uppercase mt-1 opacity-20">CX</span>
                                    <p className="text-sm font-medium italic">"{interimTranscript}..."</p>
                                </div>
                            )}
                        </div>
                    </article>
                </div>

                {/* Training & Control */}
                <div className="col-span-1 lg:col-span-3 flex flex-col space-y-4 lg:space-y-6">
                    {!isLive ? (
                        <div className="flex-1 flex flex-col space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-white/20 tracking-widest px-2">Simulation Tools</h4>
                            <div className="grid grid-cols-2 gap-2 p-1">
                                <button onClick={() => startSimulation({ complexity: 'MESSY' })} className="p-3 lg:p-4 rounded-xl bento-card border-white/10 hover:bg-white/5 text-[9px] lg:text-[10px] font-black uppercase transition-colors">🌪️ Messy</button>
                                <button onClick={() => startSimulation({ complexity: 'EMERGENCY' })} className="p-3 lg:p-4 rounded-xl bento-card border-red-500/20 hover:bg-red-500/5 text-[9px] lg:text-[10px] font-black uppercase text-red-400 transition-colors">🚨 Emergency</button>
                                <button onClick={() => startSimulation({ complexity: 'RANDOM' })} className="p-3 lg:p-4 rounded-xl bento-card border-amber-500/20 hover:bg-amber-500/5 text-[9px] lg:text-[10px] font-black uppercase text-amber-500 transition-colors">🎲 Surprise</button>
                                <button onClick={() => startSimulation({ complexity: 'LANDLORD' })} className="p-3 lg:p-4 rounded-xl bento-card border-blue-500/20 hover:bg-blue-500/5 text-[9px] lg:text-[10px] font-black uppercase text-blue-400 transition-colors">🏢 Landlord</button>
                            </div>
                            <div className="flex flex-col space-y-0.5 p-1">
                                {benchmarkScenarios.map((s, i) => (
                                    <button key={i} onClick={() => runBenchmark(i)} className="text-[7px] text-left p-1.5 rounded hover:bg-white/5 text-white/30 uppercase font-bold transition-colors">{s.label}</button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className={cn("bento-card p-4 lg:p-6 space-y-4 transition-all duration-1000", isActionIsolated ? "scale-[1.02] lg:scale-110 shadow-[0_0_30px_rgba(251,191,36,0.2)]" : "opacity-40")}>
                            <h4 className="text-[10px] font-black uppercase text-white/20 tracking-widest px-1">Confidence</h4>
                            <div className="text-4xl lg:text-5xl font-black text-handy-gold">{liveCallData?.detection.confidence ?? 0}%</div>
                            <p className="text-[10px] font-medium text-white/40 uppercase leading-relaxed italic">AI decision strength.</p>
                        </div>
                    )}
                </div>
            </main>

            <footer className="fixed bottom-0 left-0 right-0 h-14 bg-background/80 backdrop-blur-lg border-t border-white/5 flex items-center px-4 lg:px-8 justify-between z-20">
                <div className="flex items-center space-x-4 lg:space-x-8">
                    <div className="flex items-center space-x-2"><MessageSquare className="w-4 h-4" /><span className="text-[8px] lg:text-[10px] font-black uppercase tracking-widest">Digital Twin Active</span></div>
                </div>
                <div className="flex items-center space-x-2"><span className="text-[8px] lg:text-[10px] font-black uppercase tracking-widest text-handy-gold">Performance VA Mode</span></div>
            </footer>
        </div>
    );
}
