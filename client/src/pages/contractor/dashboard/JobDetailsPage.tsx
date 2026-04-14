import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2, ArrowLeft, MapPin, Calendar, Clock, CheckCircle2, Upload, Camera, ImageIcon, PenTool, Play, Pause, Timer, PoundSterling, XCircle, ThumbsUp, Video, Square, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { useState, useCallback, useEffect, useRef } from "react";
import { format, formatDuration, intervalToDuration } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import SignatureCapture from "@/components/SignatureCapture";

interface Job {
    id: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    jobDescription: string;
    description: string | null;
    location: string;
    address: string | null;
    postcode: string | null;
    assignmentStatus: string;
    status: string;
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    requestedSlot: string | null;
    scheduledSlot: string | null;
    createdAt: string;
    acceptedAt: string | null;
    rejectedAt: string | null;
    declineReason: string | null;
    declineNotes: string | null;
    payoutPence?: number | null;
    estimatedDurationMinutes?: number | null;
}

function formatSlot(job: Job): string {
    if (job.scheduledStartTime) return job.scheduledStartTime;
    const slot = job.scheduledSlot || job.requestedSlot;
    if (slot === 'am') return 'Morning (8am–12pm)';
    if (slot === 'pm') return 'Afternoon (12–5pm)';
    if (slot === 'full_day' || slot === 'full') return 'Full Day (8am–5pm)';
    return 'TBD';
}

function shortId(id: string): string {
    return id.substring(0, 8).toUpperCase();
}

function statusBadgeClass(status: string): string {
    switch (status) {
        case 'accepted': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
        case 'assigned': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
        case 'in_progress': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
        case 'completed': return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
        case 'rejected': return 'bg-red-500/20 text-red-400 border-red-500/30';
        default: return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
}

export default function JobDetailsPage() {
    const [match, params] = useRoute("/contractor/dashboard/jobs/:id");
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const id = params?.id;

    // Wizard State - Multi-step completion flow
    const [completionStep, setCompletionStep] = useState<"idle" | "time" | "upload" | "signature" | "confirm">("idle");
    const [photos, setPhotos] = useState<File[]>([]);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    // Time tracking state
    const [isTimerRunning, setIsTimerRunning] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [startTime, setStartTime] = useState<Date | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Video recording state
    const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const videoStreamRef = useRef<MediaStream | null>(null);
    const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
    const videoPlaybackRef = useRef<HTMLVideoElement | null>(null);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [evidenceTab, setEvidenceTab] = useState<"photo" | "video">("photo");

    // Signature state
    const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

    // Accept/Decline state
    const [showDeclineDialog, setShowDeclineDialog] = useState(false);
    const [declineReason, setDeclineReason] = useState<string>("");
    const [declineNotes, setDeclineNotes] = useState("");

    // Accept booking mutation
    const acceptMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch(`/api/jobs/${id}/accept`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || "Failed to accept job");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["job", id] });
            toast({ title: "Job Accepted", description: "You've accepted this job. It's now on your schedule.", className: "bg-green-600 text-white" });
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    // Decline booking mutation
    const declineMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch(`/api/jobs/${id}/reject`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                body: JSON.stringify({ declineReason: declineReason || 'other', declineNotes }),
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || "Failed to decline job");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["job", id] });
            setShowDeclineDialog(false);
            setDeclineReason("");
            setDeclineNotes("");
            toast({ title: "Job Declined", description: "The ops team will reassign this job." });
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    // Timer effect
    useEffect(() => {
        if (isTimerRunning) {
            timerRef.current = setInterval(() => {
                setElapsedSeconds(prev => prev + 1);
            }, 1000);
        } else if (timerRef.current) {
            clearInterval(timerRef.current);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isTimerRunning]);

    // Format elapsed time
    const formatElapsedTime = (seconds: number) => {
        const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
        return formatDuration(duration, { format: ['hours', 'minutes', 'seconds'], zero: true, delimiter: ':' })
            .replace(' hours', 'h')
            .replace(' minutes', 'm')
            .replace(' seconds', 's')
            .replace(' hour', 'h')
            .replace(' minute', 'm')
            .replace(' second', 's');
    };

    const startTimer = () => {
        setStartTime(new Date());
        setIsTimerRunning(true);
    };

    const stopTimer = () => {
        setIsTimerRunning(false);
    };

    const { data: job, isLoading } = useQuery<Job>({
        queryKey: ["job", id],
        queryFn: async () => {
            const res = await fetch(`/api/jobs/${id}`);
            if (!res.ok) throw new Error("Failed to load job");
            return res.json();
        },
        enabled: !!id,
    });

    // Upload photos with progress tracking
    const uploadPhotos = useCallback(async (files: File[]): Promise<string[]> => {
        if (files.length === 0) return [];

        setIsUploading(true);
        setUploadProgress(0);

        const formData = new FormData();
        files.forEach((file) => {
            formData.append("files", file);
        });

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    setUploadProgress(percentComplete);
                }
            });

            xhr.addEventListener("load", () => {
                setIsUploading(false);
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response.success && response.urls) {
                            resolve(response.urls);
                        } else {
                            reject(new Error(response.error || "Upload failed"));
                        }
                    } catch {
                        reject(new Error("Invalid server response"));
                    }
                } else {
                    try {
                        const errorResponse = JSON.parse(xhr.responseText);
                        reject(new Error(errorResponse.error || `Upload failed with status ${xhr.status}`));
                    } catch {
                        reject(new Error(`Upload failed with status ${xhr.status}`));
                    }
                }
            });

            xhr.addEventListener("error", () => {
                setIsUploading(false);
                reject(new Error("Network error during upload"));
            });

            xhr.addEventListener("abort", () => {
                setIsUploading(false);
                reject(new Error("Upload cancelled"));
            });

            xhr.open("POST", `/api/jobs/${id}/evidence`);
            xhr.send(formData);
        });
    }, [id]);

    const completeMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');

            // Step 1: Upload photos if any are selected (and not already uploaded)
            let evidenceUrls = uploadedUrls;
            if (photos.length > 0 && uploadedUrls.length === 0) {
                evidenceUrls = await uploadPhotos(photos);
                setUploadedUrls(evidenceUrls);
            }

            // Step 2: Complete the job with signature and time data
            const res = await fetch(`/api/jobs/${id}/complete`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({
                    signatureDataUrl: signatureDataUrl || undefined,
                    timeOnJobSeconds: elapsedSeconds || undefined,
                    evidenceUrls: evidenceUrls.length > 0 ? evidenceUrls : undefined,
                })
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || "Failed to complete job");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["job", id] });
            setCompletionStep("idle");
            setPhotos([]);
            setSignatureDataUrl(null);
            setElapsedSeconds(0);
            setUploadedUrls([]);

            const details: string[] = [];
            if (uploadedUrls.length > 0) details.push(`${uploadedUrls.length} file(s)${videoBlob ? ' incl. video' : ''}`);
            if (signatureDataUrl) details.push("signature captured");
            if (elapsedSeconds > 0) details.push(`${formatElapsedTime(elapsedSeconds)} tracked`);

            toast({
                title: "Job Completed!",
                description: details.length > 0
                    ? `Great work. ${details.join(", ")}.`
                    : "Great work. Proceeding to invoice...",
                className: "bg-green-600 text-white"
            });
        },
        onError: (error: Error) => {
            setIsUploading(false);
            setUploadProgress(0);
            toast({
                title: "Error",
                description: error.message || "Failed to complete job.",
                variant: "destructive"
            });
        }
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setPhotos(Array.from(e.target.files));
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: true,
            });
            videoStreamRef.current = stream;
            if (videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = stream;
                videoPreviewRef.current.play();
            }

            const recorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm",
            });
            const chunks: Blob[] = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: recorder.mimeType });
                setVideoBlob(blob);
                // Clean up stream
                stream.getTracks().forEach((t) => t.stop());
                videoStreamRef.current = null;
            };

            mediaRecorderRef.current = recorder;
            recorder.start(1000); // collect data every second
            setIsRecording(true);
            setRecordingSeconds(0);
            recordingTimerRef.current = setInterval(() => {
                setRecordingSeconds((s) => s + 1);
            }, 1000);
        } catch (err) {
            toast({ title: "Camera Error", description: "Could not access camera. Please check permissions.", variant: "destructive" });
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        setIsRecording(false);
    };

    const discardVideo = () => {
        setVideoBlob(null);
        setRecordingSeconds(0);
        if (videoStreamRef.current) {
            videoStreamRef.current.getTracks().forEach((t) => t.stop());
            videoStreamRef.current = null;
        }
    };

    // Clean up video stream on unmount
    useEffect(() => {
        return () => {
            if (videoStreamRef.current) {
                videoStreamRef.current.getTracks().forEach((t) => t.stop());
            }
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        };
    }, []);

    const uploadEvidence = useCallback(async (files: File[], video?: Blob): Promise<string[]> => {
        const allFiles = [...files];
        if (video) {
            const ext = video.type.includes("mp4") ? "mp4" : "webm";
            allFiles.push(new File([video], `walkthrough.${ext}`, { type: video.type }));
        }
        if (allFiles.length === 0) return [];
        return uploadPhotos(allFiles);
    }, [uploadPhotos]);

    if (isLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
    if (!job) return <div className="p-8 text-center">Job not found</div>;

    return (
        <>
            {/* Header */}
            <div className="bg-slate-950 p-4 items-center flex gap-4 border-b border-slate-800 sticky top-0 z-10">
                <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white hover:bg-slate-800" onClick={() => setLocation('/contractor/dashboard/jobs')}>
                    <ArrowLeft className="w-5 h-5" />
                </Button>
                <div className="flex-1">
                    <h1 className="font-bold text-lg text-white">Job #{shortId(job.id)}</h1>
                </div>
                <span className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide border ${statusBadgeClass(job.assignmentStatus)}`}>
                    {job.assignmentStatus.replace(/_/g, ' ')}
                </span>
            </div>

            <div className="p-5 space-y-4 pb-52">
                {/* Date & Time Strip */}
                <div className="flex gap-3">
                    <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-blue-400 shrink-0" />
                        <div>
                            <p className="text-[10px] font-medium text-slate-500 uppercase">Date</p>
                            <p className="text-sm font-bold text-white">
                                {job.scheduledDate ? format(new Date(job.scheduledDate), "EEE, MMM d") : "TBD"}
                            </p>
                        </div>
                    </div>
                    <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
                        <Clock className="w-5 h-5 text-purple-400 shrink-0" />
                        <div>
                            <p className="text-[10px] font-medium text-slate-500 uppercase">Time</p>
                            <p className="text-sm font-bold text-white">{formatSlot(job)}</p>
                        </div>
                    </div>
                </div>

                {/* Customer Card */}
                <Card className="bg-slate-900 border-slate-800">
                    <CardContent className="p-4 space-y-3">
                        <h2 className="text-xl font-bold text-white">{job.customerName}</h2>
                        {(job.location || job.address) && (
                            <div className="flex items-start gap-2 text-sm text-slate-400">
                                <MapPin className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                                <span>{job.address || job.location}{job.postcode ? `, ${job.postcode}` : ''}</span>
                            </div>
                        )}
                        {job.customerPhone && (
                            <a href={`tel:${job.customerPhone}`} className="flex items-center gap-2 text-sm text-blue-400 font-medium">
                                <span className="w-4 h-4 text-center">📞</span>
                                {job.customerPhone}
                            </a>
                        )}
                    </CardContent>
                </Card>

                {/* Payout Section */}
                {job.payoutPence != null && job.payoutPence > 0 && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                <PoundSterling className="w-5 h-5 text-emerald-400" />
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-emerald-500 uppercase">Your Payout</p>
                                <p className="text-xl font-bold text-emerald-400">£{(job.payoutPence / 100).toFixed(2)}</p>
                            </div>
                        </div>
                        {job.estimatedDurationMinutes != null && job.estimatedDurationMinutes > 0 && (
                            <p className="text-xs text-emerald-500 text-right">
                                £{((job.payoutPence / job.estimatedDurationMinutes) * 60 / 100).toFixed(2)}/hr<br />
                                {(job.estimatedDurationMinutes / 60).toFixed(1)} hrs est.
                            </p>
                        )}
                    </div>
                )}

                {/* Accept/Decline Buttons - shown when job is pending response */}
                {job.assignmentStatus === 'assigned' && !job.acceptedAt && !job.rejectedAt && (
                    <div className="flex gap-3">
                        <Button
                            className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white h-12 rounded-xl font-bold"
                            onClick={() => acceptMutation.mutate()}
                            disabled={acceptMutation.isPending || declineMutation.isPending}
                        >
                            {acceptMutation.isPending ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <ThumbsUp className="w-4 h-4 mr-2" />
                            )}
                            Accept Job
                        </Button>
                        <Button
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-red-400 border border-red-500/30 h-12 rounded-xl font-bold"
                            onClick={() => setShowDeclineDialog(true)}
                            disabled={acceptMutation.isPending || declineMutation.isPending}
                        >
                            <XCircle className="w-4 h-4 mr-2" />
                            Decline
                        </Button>
                    </div>
                )}

                {/* Accepted Banner */}
                {job.acceptedAt && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        <div>
                            <p className="text-sm font-bold text-emerald-400">Confirmed</p>
                            <p className="text-xs text-emerald-500/70">
                                {format(new Date(job.acceptedAt), "MMM d, yyyy 'at' h:mm a")}
                            </p>
                        </div>
                    </div>
                )}

                {/* Declined Banner */}
                {job.rejectedAt && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-3">
                        <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                        <div>
                            <p className="text-sm font-bold text-red-400">Declined</p>
                            <p className="text-xs text-red-500/70">
                                {job.declineReason && <span className="capitalize">{job.declineReason.replace(/_/g, ' ')}</span>}
                                {job.declineNotes && <span> — {job.declineNotes}</span>}
                            </p>
                        </div>
                    </div>
                )}

                {/* Job Description */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Job Details</h3>
                    <p className="text-sm leading-relaxed text-slate-300">{job.jobDescription || job.description || 'No description provided'}</p>
                </div>

                {['accepted', 'in_progress', 'assigned'].includes(job.assignmentStatus) && completionStep === 'idle' && (
                    <div className="fixed bottom-16 left-0 right-0 p-4 bg-slate-950 border-t border-slate-800 z-20 pb-5 space-y-3">
                        {/* Time tracking button when not running */}
                        {!isTimerRunning && elapsedSeconds === 0 && (
                            <Button
                                className="w-full bg-slate-800 hover:bg-slate-700 text-white h-12 rounded-xl font-bold border border-slate-700"
                                onClick={startTimer}
                            >
                                <Play className="w-5 h-5 mr-2" /> Start Timer
                            </Button>
                        )}

                        {/* Timer display when running */}
                        {isTimerRunning && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center animate-pulse">
                                        <Timer className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-amber-400 font-medium">Time on job</p>
                                        <p className="text-2xl font-bold text-white font-mono">{formatElapsedTime(elapsedSeconds)}</p>
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    className="bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700"
                                    onClick={stopTimer}
                                >
                                    <Pause className="w-4 h-4 mr-1" /> Pause
                                </Button>
                            </div>
                        )}

                        {/* Timer display when paused */}
                        {!isTimerRunning && elapsedSeconds > 0 && (
                            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                                        <Timer className="w-5 h-5 text-slate-300" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-400 font-medium">Time on job (paused)</p>
                                        <p className="text-2xl font-bold text-slate-200 font-mono">{formatElapsedTime(elapsedSeconds)}</p>
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700"
                                    onClick={startTimer}
                                >
                                    <Play className="w-4 h-4 mr-1" /> Resume
                                </Button>
                            </div>
                        )}

                        <Button
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white h-14 rounded-xl text-lg font-bold shadow-lg shadow-emerald-500/20"
                            onClick={() => {
                                if (isTimerRunning) stopTimer();
                                setCompletionStep('upload');
                            }}
                        >
                            <CheckCircle2 className="w-5 h-5 mr-2" />
                            Complete Job
                        </Button>
                    </div>
                )}

                {/* Completion Wizard - Step 1: Evidence (Photos + Video) */}
                {completionStep === 'upload' && (
                    <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col">
                        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                            <Button variant="ghost" className="text-slate-400 hover:text-white hover:bg-slate-800" onClick={() => { if (!isRecording) setCompletionStep('idle'); }} disabled={isUploading || isRecording}>
                                Cancel
                            </Button>
                            <h2 className="font-bold text-white">Step 1 of 2 - Evidence</h2>
                            <div className="w-16" />
                        </div>

                        {/* Time summary if tracked */}
                        {elapsedSeconds > 0 && (
                            <div className="mx-4 mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                                <Timer className="w-4 h-4 text-amber-400" />
                                <span className="text-sm text-amber-300">Time tracked: <strong>{formatElapsedTime(elapsedSeconds)}</strong></span>
                            </div>
                        )}

                        {/* Tab switcher */}
                        <div className="flex mx-4 mt-4 bg-slate-900 rounded-lg p-1 border border-slate-800">
                            <button
                                onClick={() => { if (!isRecording) setEvidenceTab("photo"); }}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-all ${evidenceTab === "photo" ? "bg-slate-800 text-white" : "text-slate-500"}`}
                            >
                                <Camera className="w-4 h-4" /> Photos
                            </button>
                            <button
                                onClick={() => { if (!isUploading) setEvidenceTab("video"); }}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-all ${evidenceTab === "video" ? "bg-slate-800 text-white" : "text-slate-500"}`}
                            >
                                <Video className="w-4 h-4" /> Video
                            </button>
                        </div>

                        {/* Photo tab */}
                        {evidenceTab === "photo" && (
                            <div className="p-8 flex-1 flex flex-col items-center justify-center text-center space-y-6 overflow-y-auto">
                                <div className="w-20 h-20 rounded-full bg-blue-500/10 flex items-center justify-center">
                                    <Camera className="w-10 h-10 text-blue-400" />
                                </div>
                                <h3 className="text-2xl font-bold text-white">Upload Photos</h3>
                                <p className="text-slate-400">Take or upload photo(s) of the completed work</p>

                                <div className="w-full max-w-xs">
                                    <Label htmlFor="photo" className="sr-only">Photo</Label>
                                    <Input
                                        id="photo"
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        capture="environment"
                                        onChange={handleFileChange}
                                        disabled={isUploading}
                                        className="bg-slate-900 border-slate-700 text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-slate-800 file:text-white hover:file:bg-slate-700"
                                    />
                                </div>

                                {photos.length > 0 && (
                                    <div className="w-full max-w-sm">
                                        <p className="text-sm font-medium text-slate-400 mb-2">
                                            {photos.length} photo(s) selected:
                                        </p>
                                        <div className="grid grid-cols-3 gap-2">
                                            {photos.map((photo, index) => (
                                                <div key={index} className="relative aspect-square bg-slate-800 rounded-lg overflow-hidden">
                                                    <img
                                                        src={URL.createObjectURL(photo)}
                                                        alt={`Preview ${index + 1}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {isUploading && (
                                    <div className="w-full max-w-sm space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-slate-400">Uploading...</span>
                                            <span className="font-medium text-white">{uploadProgress}%</span>
                                        </div>
                                        <Progress value={uploadProgress} className="h-2" />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Video tab */}
                        {evidenceTab === "video" && (
                            <div className="p-6 flex-1 flex flex-col items-center justify-center text-center space-y-4 overflow-y-auto">
                                {!isRecording && !videoBlob && (
                                    <>
                                        <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
                                            <Video className="w-10 h-10 text-red-400" />
                                        </div>
                                        <h3 className="text-2xl font-bold text-white">Record Walkthrough</h3>
                                        <p className="text-slate-400 text-sm">Record a short video walkthrough of the completed job</p>
                                        <Button
                                            className="h-14 px-8 text-lg rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold"
                                            onClick={startRecording}
                                        >
                                            <CircleDot className="w-5 h-5 mr-2" />
                                            Start Recording
                                        </Button>
                                        <p className="text-slate-600 text-xs">Or upload an existing video</p>
                                        <Input
                                            type="file"
                                            accept="video/*"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) setVideoBlob(file);
                                            }}
                                            className="max-w-xs bg-slate-900 border-slate-700 text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-slate-800 file:text-white hover:file:bg-slate-700"
                                        />
                                    </>
                                )}

                                {isRecording && (
                                    <>
                                        <div className="w-full max-w-sm relative rounded-xl overflow-hidden bg-black">
                                            <video ref={videoPreviewRef} className="w-full aspect-video object-cover" muted playsInline />
                                            <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-600 px-3 py-1 rounded-full">
                                                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                                                <span className="text-xs font-bold text-white">
                                                    {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                                                </span>
                                            </div>
                                        </div>
                                        <Button
                                            className="h-14 px-8 text-lg rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold"
                                            onClick={stopRecording}
                                        >
                                            <Square className="w-5 h-5 mr-2" />
                                            Stop Recording
                                        </Button>
                                    </>
                                )}

                                {videoBlob && !isRecording && (
                                    <>
                                        <div className="w-full max-w-sm rounded-xl overflow-hidden bg-black">
                                            <video
                                                ref={videoPlaybackRef}
                                                src={URL.createObjectURL(videoBlob)}
                                                className="w-full aspect-video object-cover"
                                                controls
                                                playsInline
                                            />
                                        </div>
                                        <div className="flex items-center gap-2 text-sm">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                            <span className="text-emerald-400 font-medium">
                                                Video ready ({(videoBlob.size / (1024 * 1024)).toFixed(1)} MB)
                                            </span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            className="text-slate-500 hover:text-red-400 hover:bg-slate-800 text-sm"
                                            onClick={discardVideo}
                                        >
                                            <XCircle className="w-4 h-4 mr-1" /> Discard & re-record
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="p-4 border-t border-slate-800 pb-8 space-y-3">
                            <Button
                                className="w-full h-12 text-lg rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold"
                                disabled={(photos.length === 0 && !videoBlob) || isUploading || isRecording}
                                onClick={async () => {
                                    try {
                                        const urls = await uploadEvidence(photos, videoBlob || undefined);
                                        setUploadedUrls(urls);
                                        setCompletionStep('signature');
                                    } catch (error) {
                                        toast({
                                            title: "Upload Failed",
                                            description: error instanceof Error ? error.message : "Please try again",
                                            variant: "destructive"
                                        });
                                    }
                                }}
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        Uploading... {uploadProgress}%
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-5 h-5 mr-2" />
                                        Upload & Continue
                                    </>
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                className="w-full text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                                disabled={isRecording}
                                onClick={() => setCompletionStep('signature')}
                            >
                                Skip evidence
                            </Button>
                        </div>
                    </div>
                )}

                {/* Completion Wizard - Step 2: Signature */}
                {completionStep === 'signature' && (
                    <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col">
                        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                            <Button variant="ghost" className="text-slate-400 hover:text-white hover:bg-slate-800" onClick={() => setCompletionStep('upload')}>
                                Back
                            </Button>
                            <h2 className="font-bold text-white">Step 2 of 2 - Signature</h2>
                            <div className="w-16" />
                        </div>

                        {/* Summary */}
                        <div className="mx-4 mt-4 space-y-2">
                            {elapsedSeconds > 0 && (
                                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2">
                                    <Timer className="w-4 h-4 text-amber-400" />
                                    <span className="text-sm text-amber-300">Time: <strong>{formatElapsedTime(elapsedSeconds)}</strong></span>
                                </div>
                            )}
                            {uploadedUrls.length > 0 && (
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2">
                                    <ImageIcon className="w-4 h-4 text-emerald-400" />
                                    <span className="text-sm text-emerald-300">
                                        {uploadedUrls.length} file(s) uploaded
                                        {videoBlob ? ' (incl. video)' : ''}
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="p-8 flex-1 flex flex-col items-center justify-center text-center space-y-6 overflow-y-auto">
                            <div className="w-20 h-20 rounded-full bg-purple-500/10 flex items-center justify-center">
                                <PenTool className="w-10 h-10 text-purple-400" />
                            </div>
                            <h3 className="text-2xl font-bold text-white">Customer Signature</h3>
                            <p className="text-slate-400">Get the customer to sign below to confirm completion</p>

                            <div className="w-full max-w-sm">
                                <SignatureCapture
                                    onSignatureComplete={(dataUrl) => setSignatureDataUrl(dataUrl)}
                                    onClear={() => setSignatureDataUrl(null)}
                                />
                            </div>

                            {signatureDataUrl && (
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                    <span className="text-sm text-emerald-300">Signature captured</span>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-800 pb-8 space-y-3">
                            <Button
                                className="w-full h-12 text-lg rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold"
                                disabled={completeMutation.isPending}
                                onClick={() => completeMutation.mutate()}
                            >
                                {completeMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        Completing...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="w-5 h-5 mr-2" />
                                        Complete Job
                                    </>
                                )}
                            </Button>
                            {!signatureDataUrl && (
                                <Button
                                    variant="ghost"
                                    className="w-full text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                                    onClick={() => completeMutation.mutate()}
                                    disabled={completeMutation.isPending}
                                >
                                    Complete without signature
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Decline Dialog */}
            <Dialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Decline Job</DialogTitle>
                        <DialogDescription>
                            Let the ops team know why you can't take this job so they can reassign it.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Reason</Label>
                            <Select value={declineReason} onValueChange={setDeclineReason}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a reason" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="schedule_conflict">Schedule Conflict</SelectItem>
                                    <SelectItem value="too_far">Too Far Away</SelectItem>
                                    <SelectItem value="not_my_skill">Not My Skill Set</SelectItem>
                                    <SelectItem value="pay_too_low">Pay Too Low</SelectItem>
                                    <SelectItem value="personal">Personal Reasons</SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Notes (optional)</Label>
                            <Textarea
                                placeholder="Any additional details..."
                                value={declineNotes}
                                onChange={(e) => setDeclineNotes(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDeclineDialog(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => declineMutation.mutate()}
                            disabled={!declineReason || declineMutation.isPending}
                        >
                            {declineMutation.isPending ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Declining...</>
                            ) : (
                                "Confirm Decline"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
