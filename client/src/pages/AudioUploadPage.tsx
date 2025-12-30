
import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { RotateCcw, Loader2, Mic, Play, MapPin, User, AlertTriangle, Building, Home, Key, Video, DollarSign, UploadCloud, X, MessageSquare } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useLiveCall } from '@/contexts/LiveCallContext';
import { useEffect } from 'react';
import { OutcomeGauge } from '@/components/ui/OutcomeGauge';
import { useToast } from '@/hooks/use-toast';
import { PostcodeSelector } from '@/components/PostcodeSelector'; // F4
import { DuplicateLeadWarning } from '@/components/DuplicateLeadWarning'; // F6
import { AddressValidator } from '@/components/AddressValidator'; // AI-First validation
import { AddressOption } from '@/hooks/useRecentAddresses';

interface SkuDetectionResult {
    matched: boolean;
    sku: {
        id: string;
        skuCode: string;
        name: string;
        category: string;
        pricePence: number;
        description: string;
    } | null;
    confidence: number;
    method: 'keyword' | 'embedding' | 'gpt' | 'hybrid' | 'cached' | 'realtime' | 'none';
    rationale: string;
    nextRoute: string; // Note: simplified string type here vs specific union in context
    suggestedScript?: string;

    // Performance & UI Optimizations
    isPreliminaryResult?: boolean;
    detectionTime?: number;
    cacheHit?: boolean;

    // Multi-SKU fields
    matchedServices?: Array<{
        sku: {
            id: string;
            skuCode: string;
            name: string;
            category: string;
            pricePence: number;
            description: string;
        };
        confidence: number;
        task: { description: string; quantity: number };
    }>;
    unmatchedTasks?: Array<{ description: string; quantity: number }>;
    totalMatchedPrice?: number;
    hasMultiple?: boolean;
}

interface CallMetadata {
    customerName: string | null;
    address: string | null;
    urgency: "Critical" | "High" | "Standard" | "Low";
    leadType: "Homeowner" | "Landlord" | "Property Manager" | "Tenant" | "Unknown";
    phoneNumber?: string;
    roleMapping?: Record<number, "VA" | "Customer">;
}

interface Segment {
    speaker: number;
    text: string;
    start: number;
    end: number;
}

interface UploadResponse {
    transcription: string; // Full text fallback
    segments: Segment[];
    detection: SkuDetectionResult;
    metadata: CallMetadata;
}

export default function AudioUploadPage() {
    const [file, setFile] = useState<File | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [showNumberSelectionModal, setShowNumberSelectionModal] = useState(false);
    const [simPrompt, setSimPrompt] = useState("");
    const [aiMessage, setAiMessage] = useState<string>("");
    const [isGeneratingAiMessage, setIsGeneratingAiMessage] = useState(false);
    const [aiTone, setAiTone] = useState<'casual' | 'professional'>('casual');
    const [showTranscript, setShowTranscript] = useState(false); // Clean Mode: hidden by default
    const {
        isLive, liveCallData, isSimulating, startSimulation, clearCall,
        detectedPostcode, setDetectedPostcode,
        duplicateWarning, setDuplicateWarning,
        addressValidation, setAddressValidation,  // AI-First validation
        updateMetadata
    } = useLiveCall();
    const { toast } = useToast();
    const [, setLocation] = useLocation();

    const uploadMutation = useMutation({
        mutationFn: async (audioFile: File): Promise<UploadResponse> => {
            const response = await fetch('/api/upload-audio', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream'
                },
                body: audioFile
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }
            return response.json();
        },
        onError: () => {
            setErrorMsg("Failed to upload and analyze audio.");
        },
        onSuccess: () => {
            setErrorMsg(null);
        }
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setErrorMsg(null);
            // Auto upload for smoother UX
            uploadMutation.mutate(e.target.files[0]);
        }
    };

    const result = isLive ? liveCallData : (uploadMutation.data || liveCallData);

    const fetchAiMessage = async (toneOverride?: 'casual' | 'professional') => {
        const data = liveCallData || uploadMutation.data;
        if (!data) {
            console.warn("[AI Message] No call data available, skipping generation");
            return;
        }

        console.log("[AI Message] Starting generation with data:", {
            hasTranscription: !!data.transcription,
            segmentCount: data.segments.length,
            customerName: data.metadata.customerName,
            tone: toneOverride || aiTone
        });

        setIsGeneratingAiMessage(true);
        setAiMessage(""); // Clear old message while generating
        const tone = toneOverride || aiTone;

        const payload = {
            transcription: data.transcription || data.segments.map(s => s.text).join(' '),
            customerName: data.metadata.customerName,
            tone: tone,
            detection: data.detection
        };

        console.log("[Frontend] Sending AI message request with payload:", {
            transcriptionLength: payload.transcription.length,
            transcriptionPreview: payload.transcription.substring(0, 150),
            customerName: payload.customerName,
            tone: payload.tone,
            detectionSku: payload.detection?.sku?.name,
            detectionRationale: payload.detection?.rationale
        });

        try {
            const res = await fetch('/api/whatsapp/ai-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error("API failed");
            const responseData = await res.json();
            if (responseData.message) {
                console.log("[AI Message] Generated successfully:", responseData.message);
                setAiMessage(responseData.message);
            }
        } catch (e) {
            console.error("Failed to generate AI message", e);
            // Fallback: Human-sounding backup
            const cleanName = (data.metadata.customerName && !data.metadata.customerName.includes("Incoming"))
                ? data.metadata.customerName.split(' ')[0]
                : "there";
            setAiMessage(`Hi ${cleanName}! We just spoke about the job you need - could you send us a quick video so we can take a look and get a price back to you? ${tone === 'professional' ? '🔧' : '🛠️'}`);
        } finally {
            setIsGeneratingAiMessage(false);
        }
    };

    const requestVideo = () => {
        setShowNumberSelectionModal(true);
        fetchAiMessage();
    };

    const handleUseCallerNumber = () => {
        const phone = result?.metadata?.phoneNumber;
        if (!phone || phone === 'Unknown' || phone === 'UNKNOWN_SIM') {
            toast({ title: "No Phone Number", description: "Cannot send WhatsApp message without a caller ID.", variant: "destructive" });
            setShowNumberSelectionModal(false);
            return;
        }

        // Navigate to WhatsApp CRM with pre-filled message via URL params
        const message = encodeURIComponent(aiMessage);
        const phoneParam = encodeURIComponent(phone);
        setLocation(`/admin/whatsapp-intake?phone=${phoneParam}&message=${message}`);
        setShowNumberSelectionModal(false);
    };

    const handleUseNewNumber = () => {
        const newNumber = prompt("Enter the phone number (with country code, e.g., +447508744402):");
        if (!newNumber) {
            setShowNumberSelectionModal(false);
            return;
        }

        // Navigate to WhatsApp CRM with the new number and pre-filled message via URL params
        const message = encodeURIComponent(aiMessage);
        const phoneParam = encodeURIComponent(newNumber);
        setLocation(`/admin/whatsapp-intake?phone=${phoneParam}&message=${message}`);
        setShowNumberSelectionModal(false);
    };

    // Helper for Urgency Badge
    const getUrgencyBadge = (urgency: string) => {
        const styles = {
            'Critical': 'bg-red-100 text-red-700 border-red-200',
            'High': 'bg-orange-100 text-orange-700 border-orange-200',
            'Standard': 'bg-blue-100 text-blue-700 border-blue-200',
            'Low': 'bg-gray-100 text-gray-700 border-gray-200',
        }[urgency] || 'bg-gray-100 text-gray-700 border-gray-200';

        return (
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${styles} flex items-center gap-1.5`}>
                <div className={`w-1.5 h-1.5 rounded-full ${urgency === 'Critical' ? 'bg-red-500 animate-pulse' : 'bg-current'}`} />
                {urgency}
            </span>
        );
    };

    // Helper for Lead Type Badge
    const getLeadTypeBadge = (type: string) => {
        return (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1.5">
                {type === 'Landlord' && <Building className="w-3 h-3" />}
                {type === 'Property Manager' && <Key className="w-3 h-3" />}
                {type === 'Homeowner' && <Home className="w-3 h-3" />}
                {type}
            </span>
        );
    };

    const handleAddressSelect = (address: AddressOption) => {
        updateMetadata({
            address: address.formattedAddress,
            postcode: address.streetAddress
        });
        setDetectedPostcode(null);
        toast({
            title: "Address Updated",
            description: `Location set to: ${address.streetAddress}`
        });
    };

    const handleAddressConfirm = (address: string, placeId?: string) => {
        updateMetadata({
            address: address,
            // Store placeId if available for future reference
        });
        setAddressValidation(null); // Dismiss validator
        toast({
            title: "Address Confirmed",
            description: address
        });
    };

    const handleAddressEdit = () => {
        // Show manual edit form or reset validation
        setAddressValidation(null);
        toast({
            title: "Edit Address",
            description: "Please update the address manually"
        });
    };

    return (
        <div className="h-screen flex flex-col bg-slate-900 text-white overflow-hidden">
            <DuplicateLeadWarning
                isOpen={!!duplicateWarning}
                confidence={duplicateWarning?.confidence || 0}
                matchReason={duplicateWarning?.matchReason || ''}
                existingLead={{
                    id: duplicateWarning?.existingLeadId || '',
                    customerName: result?.metadata?.customerName || 'Unknown',
                    phone: result?.metadata?.phoneNumber || 'Unknown'
                }}
                onUpdateExisting={() => {
                    // In a real app we'd confirm the update api call here
                    // verifying the backend logic (which handles it at close())
                    setDuplicateWarning(null);
                    toast({ title: "Lead Merged", description: "Updating existing lead record." });
                }}
                onCreateNew={() => {
                    setDuplicateWarning(null);
                }}
            />

            {/* Top Action Bar */}
            <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight">Active Calls</h1>
                    <p className="text-sm text-slate-400 mt-1">Real-time triage and routing</p>
                </div>

                <div className="flex items-center gap-3">
                    {isLive && (
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 bg-red-50 text-red-600 px-3 py-1.5 rounded-full border border-red-100 shadow-sm animate-pulse">
                                <Mic className="w-3 h-3" />
                                <span className="text-[10px] font-black uppercase tracking-widest">{isSimulating ? 'Simulating Call' : 'Live Call'}</span>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearCall}
                                className="h-6 w-6 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                                title="Clear live call state"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    )}
                    {!isLive && (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                placeholder="Enter job context (e.g. Broken pipe)"
                                className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-white placeholder-slate-400 w-48 focus:ring-2 focus:ring-green-500/20 outline-none transition-all"
                                value={simPrompt}
                                onChange={(e) => setSimPrompt(e.target.value)}
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    startSimulation({ jobDescription: simPrompt });
                                    setSimPrompt(""); // Clear after starting
                                }}
                                className="text-white border-slate-600 bg-slate-800 shadow-sm hover:shadow-md hover:bg-slate-700 transition-all active:scale-95"
                            >
                                Simulate Live Call
                            </Button>
                        </div>
                    )}
                    <div className="relative group">
                        <input
                            type="file"
                            accept="audio/*"
                            onChange={handleFileChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            disabled={uploadMutation.isPending}
                        />
                        <Button variant="outline" className={`shadow-sm transition-all ${uploadMutation.isPending ? 'opacity-80' : 'hover:shadow-md'}`}>
                            {uploadMutation.isPending ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
                            ) : (
                                <><UploadCloud className="w-4 h-4 mr-2" /> Upload Recording</>
                            )}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Error State */}
            {errorMsg && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm flex items-center gap-2 mb-6 border border-red-100">
                    <AlertTriangle className="w-4 h-4" />
                    {errorMsg}
                </div>
            )}

            {/* Empty State */}
            {!result && !uploadMutation.isPending && (
                <div className="border-2 border-dashed border-slate-600 rounded-xl p-12 text-center h-64 flex flex-col items-center justify-center text-slate-400 m-6">
                    < UploadCloud className="w-12 h-12 mb-4 opacity-50" />
                    <p className="font-medium">No active call analysis</p>
                    <p className="text-sm mt-1">Upload an audio booking to see the dashboard.</p>
                </div>
            )}

            {/* Results: The "Call Card" */}
            <div className="flex-1 overflow-auto p-6">
                {result && (
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">

                        {/* Card Header: Critical Info */}
                        <div className="p-6 border-b border-slate-700 flex flex-col md:flex-row md:items-start justify-between gap-4">
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    {getUrgencyBadge(result.metadata.urgency)}
                                    {getLeadTypeBadge(result.metadata.leadType)}
                                </div>

                                <div className="space-y-1">
                                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                        {result.metadata.customerName || "Unknown Caller"}
                                        <span className="text-slate-500 font-normal">|</span>
                                        <span className="text-sm font-normal text-slate-400 font-mono">ID: #{Math.floor(Math.random() * 10000)}</span>
                                    </h2>
                                    <div className="flex items-center gap-2 text-slate-400 relative">
                                        <MapPin className="w-4 h-4 text-slate-400" />
                                        <span className="text-sm">{result.metadata.address || "Address not captured"}</span>

                                        {/* F4: Postcode Selector - DISABLED (unreliable auto-capture, use post-call WhatsApp confirmation) */}
                                        {/* {!addressValidation && (
                                        <PostcodeSelector
                                            detectedPostcode={detectedPostcode}
                                            onAddressSelect={handleAddressSelect}
                                            onDismiss={() => setDetectedPostcode(null)}
                                        />
                                    )} */}

                                        {result.metadata.phoneNumber && (
                                            <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">{result.metadata.phoneNumber}</span>
                                        )}
                                    </div>
                                </div>

                                {/* AI-First Address Validation - DISABLED (unreliable auto-capture, use post-call WhatsApp confirmation) */}
                                {/* {addressValidation && (
                                <div className="mt-4">
                                    <AddressValidator
                                        detectedAddress={addressValidation.raw}
                                        validation={addressValidation}
                                        onAddressConfirm={handleAddressConfirm}
                                        onAddressEdit={handleAddressEdit}
                                    />
                                </div>
                            )} */}
                            </div>
                        </div>

                        {/* Action Decision Cards (3-Card Workflow) */}
                        <div className="flex flex-col sm:flex-row gap-2 min-w-[320px]">
                            {/* 1. Instant Quote */}
                            <button
                                className={`flex-1 p-3 rounded-lg border-2 text-center transition-all ${result.detection?.nextRoute === 'INSTANT_PRICE'
                                    ? 'border-green-500 bg-green-900/30 shadow-sm ring-2 ring-green-500/30 scale-105 z-10'
                                    : 'border-slate-600 bg-slate-700 hover:border-slate-500 opacity-60 hover:opacity-100'
                                    }`}
                            >
                                <div className="flex flex-col items-center gap-1.5">
                                    <div className={`p-1.5 rounded-full ${result.detection?.nextRoute === 'INSTANT_PRICE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                        <DollarSign className="w-4 h-4" />
                                    </div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Instant Estimate</div>
                                    {result.detection?.nextRoute === 'INSTANT_PRICE' && (
                                        <div className="text-xs font-bold text-green-700">Recommended</div>
                                    )}
                                </div>
                            </button>

                            {/* 2. Video Quote (Golden Path) */}
                            <button
                                onClick={requestVideo}
                                className={`flex-1 p-3 rounded-lg border-2 text-center transition-all ${result.detection?.nextRoute === 'VIDEO_QUOTE'
                                    ? 'border-blue-500 bg-blue-900/30 shadow-sm ring-2 ring-blue-500/30 scale-105 z-10'
                                    : 'border-slate-600 bg-slate-700 hover:border-slate-500 opacity-60 hover:opacity-100'
                                    }`}
                            >
                                <div className="flex flex-col items-center gap-1.5">
                                    <div className={`p-1.5 rounded-full ${result.detection?.nextRoute === 'VIDEO_QUOTE' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                        <Video className="w-4 h-4" />
                                    </div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Request Video</div>
                                    {result.detection?.nextRoute === 'VIDEO_QUOTE' && (
                                        <div className="text-xs font-bold text-blue-700">Recommended</div>
                                    )}
                                </div>
                            </button>

                            {/* 3. Paid Visit */}
                            <button
                                className={`flex-1 p-3 rounded-lg border-2 text-center transition-all ${result.detection?.nextRoute === 'SITE_VISIT'
                                    ? 'border-purple-500 bg-purple-900/30 shadow-sm ring-2 ring-purple-500/30 scale-105 z-10'
                                    : 'border-slate-600 bg-slate-700 hover:border-slate-500 opacity-60 hover:opacity-100'
                                    }`}
                            >
                                <div className="flex flex-col items-center gap-1.5">
                                    <div className={`p-1.5 rounded-full ${result.detection?.nextRoute === 'SITE_VISIT' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'}`}>
                                        <MapPin className="w-4 h-4" />
                                    </div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Paid Visit</div>
                                    {result.detection?.nextRoute === 'SITE_VISIT' && (
                                        <div className="text-xs font-bold text-purple-700">Recommended</div>
                                    )}
                                </div>
                            </button>

                            {/* 4. General Push to WhatsApp */}
                            <button
                                onClick={() => {
                                    const phone = result?.metadata?.phoneNumber;
                                    if (!phone || phone === 'Unknown' || phone === 'UNKNOWN_SIM') {
                                        toast({ title: "No Phone Number", description: "Cannot send WhatsApp message without a caller ID.", variant: "destructive" });
                                        return;
                                    }
                                    const phoneParam = encodeURIComponent(phone);
                                    setLocation(`/admin/whatsapp-intake?phone=${phoneParam}`);
                                }}
                                className="flex-1 p-3 rounded-lg border-2 border-slate-600 bg-slate-700 hover:border-slate-500 text-center transition-all opacity-60 hover:opacity-100 group"
                            >
                                <div className="flex flex-col items-center gap-1.5">
                                    <div className="p-1.5 rounded-full bg-slate-600 text-slate-400 group-hover:bg-green-900/50 group-hover:text-green-400 transition-colors">
                                        <MessageSquare className="w-4 h-4" />
                                    </div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Push to WhatsApp</div>
                                </div>
                            </button>
                        </div>

                        {/* Bad Audio Warning - Proactive Guidance */}
                        {result.detection?.confidence === 0 && (result.detection?.nextRoute === 'VIDEO_QUOTE' || result.detection?.nextRoute === 'UNKNOWN') && (
                            <div className="mx-4 mb-2 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-medium text-amber-800">Audio unclear or no service detected</p>
                                    <p className="text-xs text-amber-700 mt-1">
                                        Suggest: <span className="italic">"Could you send us a quick video via WhatsApp so we can see the issue?"</span>
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Transcript Toggle */}
                        <div className="px-6 py-2 border-b border-slate-700 flex items-center justify-between bg-slate-800/50">
                            <button
                                onClick={() => setShowTranscript(!showTranscript)}
                                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1.5 transition-colors"
                            >
                                {showTranscript ? (
                                    <><span className="text-[10px]">▲</span> Hide Transcript</>
                                ) : (
                                    <><span className="text-[10px]">▼</span> Show Transcript (Debug)</>
                                )}
                            </button>
                            {!showTranscript && result.detection?.matchedServices && result.detection?.matchedServices.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400">Detected:</span>
                                    {result.detection?.matchedServices.slice(0, 2).map((s, i) => (
                                        <span key={i} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                                            {s.sku.name}
                                        </span>
                                    ))}
                                    {result.detection?.matchedServices.length > 2 && (
                                        <span className="text-xs text-slate-400">+{result.detection?.matchedServices.length - 2} more</span>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Card Body: Split View */}
                        <div className={`grid grid-cols-1 ${showTranscript ? 'lg:grid-cols-3' : 'lg:grid-cols-1'} divide-y lg:divide-y-0 lg:divide-x divide-slate-100`}>

                            {/* Left: Transcription / Chat - Conditionally shown */}
                            {showTranscript && (
                                <div className="lg:col-span-2 p-0 flex flex-col max-h-[500px]">
                                    <div className="px-6 py-3 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                            <Mic className="w-3 h-3" /> Live Transcript
                                        </h3>
                                        {/* Simple Audio Controls Stub */}
                                        <div className="flex items-center gap-2">
                                            <button className="p-1 rounded-full hover:bg-slate-200 text-slate-500 transition-colors"><Play className="w-3 h-3 block" fill="currentColor" /></button>
                                            <div className="h-1 w-24 bg-slate-200 rounded-full overflow-hidden">
                                                <div className="h-full w-1/3 bg-slate-400 rounded-full"></div>
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-mono">00:12 / 01:45</span>
                                        </div>
                                    </div>

                                    <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-white custom-scrollbar">
                                        {result.segments && result.segments.length > 0 ? (
                                            result.segments.map((seg, idx) => {
                                                // Determine role dynamically
                                                const role = (result.metadata as any).roleMapping
                                                    ? (result.metadata as any).roleMapping[seg.speaker]
                                                    : (seg.speaker === 0 ? 'Customer' : 'VA');

                                                const isCustomer = role?.toLowerCase() === 'customer';

                                                return (
                                                    <div key={idx} className={`flex gap-3 max-w-3xl ${isCustomer ? 'justify-end ml-12' : 'justify-start mr-12'}`}>
                                                        {/* VA Avatar */}
                                                        {!isCustomer && (
                                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200 mt-1">
                                                                <span className="text-[10px] font-bold text-indigo-700">VA</span>
                                                            </div>
                                                        )}

                                                        <div className={`flex flex-col ${isCustomer ? 'items-end' : 'items-start'}`}>
                                                            <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm max-w-full ${isCustomer
                                                                ? 'bg-slate-900 text-white rounded-br-none'
                                                                : 'bg-white border border-slate-200 text-slate-700 rounded-bl-none'
                                                                }`}>
                                                                {seg.text}
                                                            </div>
                                                            <span className="text-[10px] text-slate-400 mt-1.5 px-1 font-medium select-none">
                                                                {isCustomer ? 'Customer' : 'Virtual Assistant'}
                                                            </span>
                                                        </div>

                                                        {/* Customer Avatar */}
                                                        {isCustomer && (
                                                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 mt-1">
                                                                <User className="w-4 h-4 text-slate-500" />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <p className="text-slate-500 italic text-sm">{result.transcription}</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Right: Context & Intelligence */}
                            <div className="p-6 bg-slate-800/50 space-y-6">

                                {/* Outcome Gauge */}
                                <div>
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Live Outcome Forecast</h3>
                                    <div className="bg-slate-700 border border-slate-600 rounded-xl p-4 shadow-sm flex flex-col items-center">
                                        <OutcomeGauge
                                            value={result.detection?.confidence || 0}
                                            outcome={(result.detection?.nextRoute || 'UNKNOWN') as any}
                                            size={220}
                                        />
                                    </div>
                                </div>

                                {/* Suggested Script for VA */}
                                <div className="bg-indigo-900/30 border border-indigo-700/50 rounded-xl p-4 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-2 opacity-5">
                                        <Mic className="w-12 h-12" />
                                    </div>
                                    <div className="flex justify-between items-start mb-2">
                                        <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
                                            <Mic className="w-3 h-3" /> Suggested Response
                                        </h3>

                                        {/* F2 & F4: Performance Badge */}
                                        {result.detection?.method && (
                                            <div className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${result.detection?.method === 'cached' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                                                result.detection?.method === 'keyword' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                                                    'bg-purple-100 text-purple-800 border-purple-200'
                                                }`}>
                                                {result.detection?.method === 'cached' && '⚡ CACHED'}
                                                {result.detection?.method === 'keyword' && '⚡ FAST MATCH'}
                                                {result.detection?.method === 'embedding' && '🔍 VECTOR'}
                                                {result.detection?.method === 'gpt' && '🤖 AI'}
                                                {result.detection?.method === 'hybrid' && '🤖 HYBRID'}
                                                {result.detection?.detectionTime && ` • ${result.detection?.detectionTime}ms`}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-sm font-medium text-indigo-200 leading-relaxed italic relative z-10">
                                        "{result.detection?.suggestedScript || "Listening for details..."}"
                                        {result.detection?.isPreliminaryResult && (
                                            <span className="inline-flex items-center ml-2 text-indigo-400">
                                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                                (Refining...)
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* SKU Detection (Stacked) */}
                                <div>
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                                        Detected Services ({result.detection?.matchedServices?.length || (result.detection?.sku ? 1 : 0)})
                                    </h3>

                                    {result.detection?.matchedServices && result.detection?.matchedServices.length > 0 ? (
                                        <div className="space-y-4">

                                            {/* Services Table */}
                                            <div className="overflow-hidden border border-slate-600 rounded-lg shadow-sm">
                                                <table className="min-w-full divide-y divide-slate-600">
                                                    <thead className="bg-slate-700">
                                                        <tr>
                                                            <th scope="col" className="px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Service</th>
                                                            <th scope="col" className="px-3 py-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">Conf</th>
                                                            <th scope="col" className="px-3 py-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">Qty</th>
                                                            <th scope="col" className="px-3 py-2 text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider">Price</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-slate-800 divide-y divide-slate-600">
                                                        {result.detection?.matchedServices.map((service, idx) => (
                                                            <tr key={idx} className={`hover:bg-slate-700 transition-colors ${idx === 0 ? 'bg-indigo-900/20' : ''}`}>
                                                                <td className="px-3 py-3 whitespace-nowrap">
                                                                    <div className="flex items-center">
                                                                        <div className="flex-shrink-0 h-8 w-8 rounded bg-indigo-100 flex items-center justify-center text-indigo-600">
                                                                            {/* Simple initial icon */}
                                                                            <span className="font-bold text-xs">{service.sku.skuCode.substring(0, 2)}</span>
                                                                        </div>
                                                                        <div className="ml-2">
                                                                            <div className="text-sm font-medium text-white">{service.sku.name}</div>
                                                                            <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{service.task.description}</div>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-3 whitespace-nowrap text-center">
                                                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${service.confidence > 85 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                                        {service.confidence}%
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-3 whitespace-nowrap text-center text-xs text-slate-300">
                                                                    {service.task.quantity}
                                                                </td>
                                                                <td className="px-3 py-3 whitespace-nowrap text-right text-sm font-bold text-white">
                                                                    £{((service.sku.pricePence * service.task.quantity) / 100).toFixed(2)}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot className="bg-slate-700">
                                                        <tr>
                                                            <td colSpan={3} className="px-3 py-2 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Total Estimate</td>
                                                            <td className="px-3 py-2 text-right text-sm font-black text-indigo-400">
                                                                £{(result.detection?.totalMatchedPrice ? (result.detection?.totalMatchedPrice / 100).toFixed(2) : '0.00')}
                                                            </td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>

                                            {/* Unmatched Tasks Alert */}
                                            {result.detection?.unmatchedTasks && result.detection?.unmatchedTasks.length > 0 && (
                                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                                    <h4 className="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                        <AlertTriangle className="w-3 h-3" /> Unmatched Items (Requires Review)
                                                    </h4>
                                                    <ul className="space-y-1">
                                                        {result.detection?.unmatchedTasks.map((task, idx) => (
                                                            <li key={idx} className="text-xs text-amber-900 flex items-start gap-1.5">
                                                                <span className="mt-0.5 text-amber-500">•</span>
                                                                "{task.description}"
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    ) : result.detection?.matched && result.detection?.sku ? (
                                        // Fallback for single SKU legacy
                                        <div className="bg-slate-700 border border-slate-600 rounded-lg p-4 shadow-sm">
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="font-semibold text-white">{result.detection?.sku.name}</div>
                                                <div className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded font-bold">{result.detection?.confidence}% Match</div>
                                            </div>
                                            <p className="text-xs text-slate-400 line-clamp-2">{result.detection?.sku.description}</p>
                                            <div className="mt-3 pt-3 border-t border-slate-600 flex items-center justify-between">
                                                <span className="text-xs text-slate-400">Est. Price</span>
                                                <span className="text-sm font-bold text-white">£{(result.detection?.sku.pricePence / 100).toFixed(2)}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-slate-700 border border-slate-600 rounded-lg p-8 text-center">
                                            <p className="text-sm text-slate-400 italic">Listening for service requests...</p>
                                        </div>
                                    )}
                                </div>

                                {/* Reasoning */}
                                <div>
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">AI Rationale</h3>
                                    <div className="text-xs text-slate-300 leading-relaxed bg-slate-700 border border-slate-600 p-3 rounded-lg">
                                        {result.detection?.rationale}
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>
                )}



                {/* Number Selection Modal */}
                {
                    showNumberSelectionModal && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in zoom-in duration-200">
                                {/* Modal Header */}
                                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">Request Video</h3>
                                        <p className="text-sm text-slate-500 mt-1">Choose how to send the video request</p>
                                    </div>
                                    <button
                                        onClick={() => setShowNumberSelectionModal(false)}
                                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                    >
                                        <X className="w-5 h-5 text-slate-400" />
                                    </button>
                                </div>

                                {/* Modal Body */}
                                <div className="p-6 space-y-3">
                                    {/* Use Caller's Number */}
                                    <button
                                        onClick={handleUseCallerNumber}
                                        className="w-full p-4 bg-blue-50 border-2 border-blue-200 rounded-xl hover:bg-blue-100 hover:border-blue-300 transition-all group"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                                                <User className="w-6 h-6 text-blue-600" />
                                            </div>
                                            <div className="flex-1 text-left">
                                                <div className="font-bold text-slate-900">Use Caller's Number</div>
                                                <div className="text-sm text-slate-600 mt-0.5">
                                                    {result?.metadata?.phoneNumber || 'Unknown'}
                                                </div>
                                            </div>
                                        </div>
                                    </button>

                                    {/* Enter New Number */}
                                    <button
                                        onClick={handleUseNewNumber}
                                        className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-xl hover:bg-slate-100 hover:border-slate-300 transition-all group"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                                                <MapPin className="w-6 h-6 text-slate-600" />
                                            </div>
                                            <div className="flex-1 text-left">
                                                <div className="font-bold text-slate-900">Enter New Number</div>
                                                <div className="text-sm text-slate-600 mt-0.5">
                                                    Send to a different WhatsApp number
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                </div>

                                {/* Modal Footer */}
                                <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <span className={`text-[10px] font-bold uppercase tracking-widest ${aiTone === 'professional' ? 'text-indigo-600' : 'text-blue-600'}`}>
                                            {aiTone} Tone
                                        </span>
                                        <button
                                            onClick={() => {
                                                const nextTone = aiTone === 'casual' ? 'professional' : 'casual';
                                                setAiTone(nextTone);
                                                fetchAiMessage(nextTone);
                                            }}
                                            disabled={isGeneratingAiMessage}
                                            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-blue-500 disabled:opacity-50 transition-colors"
                                        >
                                            <RotateCcw className={`w-3.5 h-3.5 ${isGeneratingAiMessage ? 'animate-spin' : ''}`} />
                                            Switch to {aiTone === 'casual' ? 'Professional' : 'Casual'}
                                        </button>
                                    </div>
                                    <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm relative group">
                                        {isGeneratingAiMessage ? (
                                            <div className="flex items-center justify-center gap-2 py-4">
                                                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                                                <span className="text-xs text-slate-400 italic">Summarizing call...</span>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-600 leading-relaxed italic">
                                                "{aiMessage}"
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }
            </div>
        </div>
    );
}
