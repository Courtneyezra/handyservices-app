import React, { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, ChevronRight, Loader2, CheckCircle, Edit2, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedThumbnail } from "@/components/video-review/AnimatedThumbnail";
import { VerificationQuestions } from "@/components/video-review/VerificationQuestions";
import { CorrectionModal } from "@/components/video-review/CorrectionModal";
import { UploadingAnimation } from "@/components/video-review/UploadingAnimation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import TaskReviewCard from "@/components/TaskReviewCard";
import { CardSkeleton } from "@/components/video-review/CardSkeleton";
import { LeadCaptureSection } from "@/components/video-review/LeadCaptureSection";
import { QuoteDisplaySection } from "@/components/video-review/QuoteDisplaySection";
import { ProgressIndicator } from "@/components/video-review/ProgressIndicator";
import { ErrorBanner, type ErrorState } from "@/components/video-review/ErrorBanner";
import { getVideoBlob, getVideoAnalysis, setVideoAnalysis, setVideoUrl, getDraftLeadId, setDraftLeadId, getIntakeData } from "@/lib/videoStore";
import { isTestMode, getTestModeConfig, MOCK_VIDEO_ANALYSIS } from "@/lib/testHelpers";

export default function VideoReview() {
    const [location, setLocation] = useLocation();
    const [analysis, setAnalysis] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [videoUrl, setVideoUrlState] = useState<string | null>(null);

    // Processing animation states
    const [processingState, setProcessingState] = useState<'uploading' | 'processing' | 'analyzing' | 'complete' | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [skeletonCount, setSkeletonCount] = useState(2);
    const prefersReducedMotion = useReducedMotion();

    // Flow State
    type FlowSection = 'review' | 'details' | 'quote';
    const [currentSection, setCurrentSection] = useState<FlowSection>('review');
    const [leadData, setLeadData] = useState({ name: '', phone: '' });
    const [quoteData, setQuoteData] = useState<any>(null);
    const [isSubmittingLead, setIsSubmittingLead] = useState(false);
    const [error, setError] = useState<ErrorState | null>(null);

    // Form State (kept for analysis enrichment)
    const [verified, setVerified] = useState<'yes' | 'no' | 'more' | null>(null);
    const [jobLocation, setJobLocation] = useState('');
    const [urgency, setUrgency] = useState('');
    const [notes, setNotes] = useState('');
    const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
    const [corrections, setCorrections] = useState<any>(null);

    // Set up video URL from blob for display
    useEffect(() => {
        const blob = getVideoBlob();
        if (blob) {
            const url = URL.createObjectURL(blob);
            setVideoUrlState(url);
            return () => URL.revokeObjectURL(url);
        }
    }, []);

    // Session Persistence - Only restore to quote if we have quote data
    useEffect(() => {
        const savedQuoteData = sessionStorage.getItem('quote_data');
        if (savedQuoteData) {
            setQuoteData(JSON.parse(savedQuoteData));
            // Only restore to 'quote' section if we have completed quote data
            setCurrentSection('quote');
        }
        // Always start at 'review' for fresh sessions or if only partial data exists
    }, []);

    useEffect(() => {
        if (currentSection) {
            sessionStorage.setItem('flow_section', currentSection);
        }
    }, [currentSection]);

    useEffect(() => {
        const processVideoIfNeeded = async () => {
            // TEST MODE: Skip video processing and use mock data
            const testConfig = getTestModeConfig();
            if (testConfig?.skipVideoUpload) {
                console.log('[TEST MODE] Using mock analysis data');
                setAnalysis(testConfig.mockAnalysis);
                setVideoAnalysis(testConfig.mockAnalysis);
                setProcessingState('complete');
                setLoading(false);
                return;
            }

            // First check if we already have processed analysis
            const storedAnalysis = getVideoAnalysis();
            if (storedAnalysis) {
                setAnalysis(storedAnalysis);
                setLoading(false);
                return;
            }

            // If no analysis but we have a video blob, process it
            const videoBlob = getVideoBlob();
            if (videoBlob) {
                await processVideo();
            } else {
                setLoading(false);
            }
        };

        processVideoIfNeeded();
    }, []);

    // Helper to scroll to sections
    const scrollToSection = (sectionId: string) => {
        setTimeout(() => {
            const element = document.getElementById(sectionId);
            if (element) {
                const headerOffset = 80;
                const elementPosition = element.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.scrollY - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        }, 100);
    };

    // Video process function (same as before but protected)
    const processVideo = async () => {
        try {
            const videoBlob = getVideoBlob();
            if (!videoBlob) {
                setLoading(false);
                return;
            }

            setLoading(true);
            setProcessingState('uploading');
            setUploadProgress(0);

            const progressInterval = setInterval(() => {
                setUploadProgress(prev => Math.min(prev + 5, 90));
            }, 200);

            try {
                // ... (Keep existing upload/process logic, simplified for brevity in this replacement)
                // Direct upload stub for now since we are modifying structure
                // Assuming exact same logic as before for video processing

                // For this task, I will reuse the exact logic from the previous file content
                // to avoid regressing the video upload functionality.
                // RE-INSERTING THE ORIGINAL UPLOAD LOGIC:

                const urlResponse = await fetch('/api/video-upload/direct-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: 'recording.webm',
                        mimeType: videoBlob.type || 'video/webm'
                    }),
                    credentials: 'include'
                });

                if (!urlResponse.ok) throw new Error(`Failed to get upload URL: ${urlResponse.status}`);
                const uploadData = await urlResponse.json();
                setUploadProgress(30);

                const uploadResponse = await fetch(uploadData.uploadUrl, { method: 'PUT', body: videoBlob });
                if (!uploadResponse.ok) throw new Error(`Cloud upload failed: ${uploadResponse.status}`);

                setUploadProgress(50);
                setProcessingState('processing');

                const processResponse = await fetch('/api/video-upload/process-direct', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        storagePath: uploadData.storagePath,
                        filename: 'recording.webm',
                        mimeType: videoBlob.type || 'video/webm',
                        storageProvider: uploadData.storageProvider,
                        publicUrl: uploadData.publicUrl
                    }),
                    credentials: 'include'
                });

                setUploadProgress(70);
                setProcessingState('analyzing');

                if (!processResponse.ok) throw new Error(`Processing failed`);
                const result = await processResponse.json();

                clearInterval(progressInterval);
                setUploadProgress(100);
                await new Promise(resolve => setTimeout(resolve, 300));

                setProcessingState('complete');
                handleVideoProcessingResult(result);

            } catch (error: any) {
                clearInterval(progressInterval);
                console.error('[VIDEO] Processing error:', error);
                setLoading(false);
                setProcessingState(null);
                setAnalysis({
                    sessionId: 'error-fallback',
                    thumbnailUrl: 'https://placehold.co/600x400/1a2332/white?text=Processing+Error',
                    videoUrl: '#',
                    jobs: [],
                    summary: 'Video processing failed - please try again',
                    totalEstimatedHours: 0
                });
            }
        } catch (error: any) {
            console.error('[VIDEO] Error:', error);
            setLoading(false);
            setProcessingState(null);
            if (!analysis) {
                setAnalysis({
                    sessionId: 'error-fallback',
                    jobs: [],
                    summary: 'An error occurred',
                    totalEstimatedHours: 0
                });
            }
        }
    };

    const handleVideoProcessingResult = async (result: any) => {
        const analysisData = {
            sessionId: result.sessionId || Date.now().toString(),
            summary: result.summary || 'Job analysis complete',
            visionInsights: result.visionInsights || '',
            jobs: result.jobs || [],
            tasks: result.tasks || [],
            estimatedRange: result.estimatedRange || { low: 79, high: 159 },
            totalEstimatedHours: result.totalEstimatedHours || 2,
            framesAnalyzed: result.framesAnalyzed || 0,
            analysisMethod: result.analysisMethod || 'unknown',
            videoUrl: result.videoUrl || '#',
            thumbnailUrl: result.thumbnailUrl || 'https://placehold.co/600x400/1a2332/white?text=Video'
        };

        setAnalysis(analysisData);
        setVideoAnalysis(analysisData);
        setLoading(false);
        if (result.videoUrl) setVideoUrl(result.videoUrl);
    };

    const handleCorrection = (data: any) => {
        setCorrections(data);
        setVerified('no');
    };

    const handleVerify = (val: 'yes' | 'no' | 'more') => {
        setVerified(val);
        if (val === 'no') {
            setCorrectionModalOpen(true);
        }
    };

    // Flow Handlers
    const handleLooksGood = () => {
        setCurrentSection('details');
        setVerified('yes'); // Auto-confirm
        // Small delay to allow DOM to update before scrolling
        setTimeout(() => {
            scrollToSection('lead-capture');
        }, 100);
    };

    const handleLeadSubmit = async (data: { name: string; phone: string }) => {
        setLeadData(data);
        setIsSubmittingLead(true);
        setError(null);

        try {
            // Get session ID (optional)
            const videoBlob = await getVideoBlob(); // Check if video exists to get sessionId context if needed

            // Note: We're not uploading the video here, just linking to the session/lead
            // In a real flow, you might want to ensure the lead is linked to the video analysis
            // ideally we pass the leadId if we have one
            // Include verification details in the analysis we send
            const enhancedAnalysis = {
                ...analysis,
                userVerified: verified,
                userNotes: notes,
                corrections: corrections
            };

            const payload = {
                name: data.name,
                phone: data.phone,
                // F6: Ensure sessionId exists, explicitly fallback if somehow missing from analysis
                sessionId: analysis.sessionId || `gen_${Date.now()}`,
                videoAnalysis: enhancedAnalysis // Pass analysis context so backend can generate quote
            };

            const response = await fetch('/api/leads/quick-capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                // Handle standardized error
                if (result.error === 'ValidationError') {
                    throw new Error(result.message);
                }
                throw new Error(result.message || 'Failed to submit details');
            }

            if (result.success) {
                // If we got a lead ID back, save it
                if (result.leadId) {
                    setDraftLeadId(result.leadId);
                }

                // Save quote data including breakdown
                setQuoteData(result);
                sessionStorage.setItem('quote_data', JSON.stringify(result));

                // Move to next step
                setCurrentSection('quote');
                scrollToSection('quote-display');
            }
        } catch (err: any) {
            console.error("Lead submission error:", err);
            setError({
                message: err.message || "Something went wrong. Please try again.",
                details: "We couldn't save your details.",
                retry: () => handleLeadSubmit(data)
            });
        } finally {
            setIsSubmittingLead(false);
        }
    };

    if (!analysis && !loading && !processingState) {
        return (
            <div className="min-h-screen bg-[#1a2332] p-6 flex flex-col items-center justify-center text-center">
                <h2 className="text-xl font-bold mb-2 text-white">No Analysis Found</h2>
                <p className="text-gray-400 mb-4">Please upload a video first.</p>
                <Button onClick={() => setLocation('/landing')} className="bg-emerald-500 hover:bg-emerald-600">Go Home</Button>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="min-h-screen bg-[#1a2332] pb-8 relative" // Added relative for absolute positioning of toast if needed
        >
            <ErrorBanner error={error} onDismiss={() => setError(null)} />

            {/* Header */}
            <div className="bg-[#1a2332] border-b border-gray-700/50 sticky top-0 z-50 backdrop-blur-md bg-opacity-90">
                <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLocation('/landing')}
                        className="text-white hover:bg-white/10 -ml-2"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        Back
                    </Button>
                    <span className="text-sm font-medium text-slate-300">
                        {processingState ? 'Analyzing...' : 'Review & Quote'}
                    </span>
                    <div className="w-10"></div>
                </div>

                {/* UX IMPROVEMENT: Progress Indicator */}
                <ProgressIndicator currentSection={currentSection} />
            </div>

            {/* TEST MODE: Debug Controls */}
            {isTestMode() && (
                <div className="bg-yellow-500/10 border-b border-yellow-500/30 sticky top-14 z-40">
                    <div className="max-w-md mx-auto px-4 py-2">
                        <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-yellow-400">🧪 TEST MODE</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs text-yellow-300 hover:text-yellow-100 hover:bg-yellow-500/20"
                                onClick={() => {
                                    setCurrentSection('review');
                                    setQuoteData(null);
                                }}
                            >
                                →Review
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs text-yellow-300 hover:text-yellow-100 hover:bg-yellow-500/20"
                                onClick={() => {
                                    setCurrentSection('details');
                                    setVerified('yes');
                                    scrollToSection('lead-capture');
                                }}
                            >
                                →Lead
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs text-yellow-300 hover:text-yellow-100 hover:bg-yellow-500/20"
                                onClick={() => {
                                    setQuoteData({
                                        leadId: 'test-lead-123',
                                        quoteRange: { low: 89, high: 179 },
                                        estimatedResponseTime: '2 hours'
                                    });
                                    setCurrentSection('quote');
                                    scrollToSection('quote-display');
                                }}
                            >
                                →Quote
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-md mx-auto py-6 space-y-8">

                {/* SECTION 1: Video & Review */}
                <div id="review-section" className="px-4 space-y-6">
                    {/* Video Thumbnail */}
                    <div className="space-y-4">
                        {processingState && processingState !== 'complete' ? (
                            <UploadingAnimation
                                state={processingState}
                                progress={uploadProgress}
                            />
                        ) : analysis ? (
                            <AnimatedThumbnail
                                thumbnailUrl={analysis?.thumbnailUrl}
                                videoUrl={videoUrl || analysis?.videoUrl}
                            />
                        ) : null}
                    </div>

                    {/* Task Cards */}
                    <div className="space-y-3">
                        <AnimatePresence mode="wait">
                            {processingState === 'complete' && analysis ? (
                                <motion.div
                                    key="real-cards"
                                    layout
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
                                    className="space-y-6"
                                >
                                    <TaskReviewCard
                                        tasks={analysis.jobs || []}
                                        hideConfirmButton={true}
                                        theme="dark"
                                        onTasksConfirmed={(confirmedTasks: any[]) => {
                                            const updatedAnalysis = { ...analysis, jobs: confirmedTasks };
                                            setAnalysis(updatedAnalysis);
                                        }}
                                        onTaskEdit={(index: number, newDescription: string) => {
                                            const updatedJobs = [...(analysis.jobs || [])];
                                            if (updatedJobs[index]) {
                                                updatedJobs[index].description = newDescription;
                                                setAnalysis({ ...analysis, jobs: updatedJobs });
                                            }
                                        }}
                                        onTaskRemove={(index: number) => {
                                            const updatedJobs = [...(analysis.jobs || [])].filter((_, i) => i !== index);
                                            setAnalysis({ ...analysis, jobs: updatedJobs });
                                        }}
                                        onTaskAdd={(newTaskDesc: string) => {
                                            const newTask = {
                                                description: newTaskDesc,
                                                estimatedHours: 1,
                                                confidence: 'medium'
                                            };
                                            const updatedJobs = [...(analysis.jobs || []), newTask];
                                            setAnalysis({ ...analysis, jobs: updatedJobs });
                                        }}
                                    />

                                    {/* Primary Action Button */}
                                    {currentSection === 'review' && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.5 }}
                                        >
                                            <Button
                                                className="w-full h-14 text-lg font-bold rounded-xl shadow-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white transform hover:scale-[1.02] transition-all"
                                                onClick={handleLooksGood}
                                            >
                                                Yes, this looks right
                                                <ChevronRight className="w-5 h-5 ml-2" />
                                            </Button>
                                            <p className="text-center text-xs text-slate-500 mt-3">
                                                No payment required to see your quote
                                            </p>
                                        </motion.div>
                                    )}
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="skeleton-cards"
                                    layout
                                    initial={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
                                    className="space-y-3"
                                >
                                    {Array.from({ length: skeletonCount }).map((_, i) => (
                                        <motion.div
                                            key={`skeleton-${i}`}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: prefersReducedMotion ? 0 : i * 0.1 }}
                                        >
                                            <CardSkeleton />
                                        </motion.div>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* SECTION 2: Lead Capture */}
                <div id="lead-capture">
                    <LeadCaptureSection
                        isVisible={currentSection === 'details' || currentSection === 'quote'}
                        onSubmit={handleLeadSubmit}
                        isSubmitting={isSubmittingLead}
                    />
                </div>

                {/* SECTION 3: Quote Display */}
                <div id="quote-display">
                    <QuoteDisplaySection
                        isVisible={currentSection === 'quote'}
                        quoteRange={quoteData?.quoteRange || analysis?.estimatedRange || { low: 0, high: 0 }}
                        quoteData={quoteData}
                        tasks={analysis?.jobs || []}
                        handymanStatus={{
                            name: 'Tom', // This could come from API in future
                            message: "I'll have a detailed quote in about 2 hours",
                            isLive: true,
                            estimatedTime: quoteData?.estimatedResponseTime || '2 hours'
                        }}
                    />
                </div>
            </div>

            {/* ARIA Live Region */}
            <div role="status" aria-live="polite" className="sr-only">
                {processingState === 'uploading' && 'Securing your video...'}
                {processingState === 'processing' && 'Analyzing your job...'}
                {processingState === 'analyzing' && 'Calculating your quote...'}
                {processingState === 'complete' && 'Quote Ready!'}
            </div>

            <CorrectionModal
                isOpen={correctionModalOpen}
                onClose={() => setCorrectionModalOpen(false)}
                onSubmit={handleCorrection}
            />
        </motion.div>
    );
}
