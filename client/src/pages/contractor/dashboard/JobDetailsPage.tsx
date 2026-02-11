import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import ContractorAppShell from "@/components/layout/ContractorAppShell";
import { Loader2, ArrowLeft, MapPin, Calendar, Clock, CheckCircle2, XCircle, Upload, Camera, ImageIcon, AlertCircle, PenTool, Play, Pause, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { useState, useCallback, useEffect, useRef } from "react";
import { format, formatDuration, intervalToDuration } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import SignatureCapture from "@/components/SignatureCapture";

interface Job {
    id: number;
    customerName: string;
    customerPhone: string;
    jobDescription: string;
    location: string;
    assignmentStatus: string;
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    createdAt: string;
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

    // Signature state
    const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

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

    const acceptMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch(`/api/jobs/${id}/accept`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
            });
            if (!res.ok) throw new Error("Failed to accept");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["job", id] });
            toast({ title: "Job Accepted", description: "This job is now in your schedule." });
        },
        onError: () => toast({ title: "Error", description: "Could not accept job.", variant: "destructive" })
    });

    const rejectMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch(`/api/jobs/${id}/reject`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({ reason: "Contractor declined" })
            });
            if (!res.ok) throw new Error("Failed to reject");
            return res.json();
        },
        onSuccess: () => {
            setLocation("/contractor/dashboard");
            toast({ title: "Job Rejected", description: "You have declined this job." });
        },
        onError: () => toast({ title: "Error", description: "Failed to reject.", variant: "destructive" })
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
            if (uploadedUrls.length > 0) details.push(`${uploadedUrls.length} photo(s)`);
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

    if (isLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
    if (!job) return <div className="p-8 text-center">Job not found</div>;

    return (
        <ContractorAppShell>
            {/* Header */}
            <div className="bg-white p-4 items-center flex gap-4 border-b sticky top-0 z-10">
                <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
                    <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                    <h1 className="font-bold text-lg">Job #{job.id}</h1>
                    <Badge variant={job.assignmentStatus === 'assigned' ? 'secondary' : 'default'} className="uppercase text-[10px]">
                        {job.assignmentStatus}
                    </Badge>
                </div>
            </div>

            <div className="p-5 space-y-6 pb-24">
                {/* Map Placeholder */}
                <div className="rounded-2xl bg-slate-100 h-48 flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-blue-500/10" />
                    <MapPin className="w-8 h-8 text-slate-400 mb-2" />
                    <span className="text-xs text-slate-500 absolute bottom-4 bg-white/80 px-2 py-1 rounded backdrop-blur">
                        {job.location}
                    </span>
                </div>

                {/* Info */}
                <div className="space-y-4">
                    <h2 className="text-2xl font-bold">{job.customerName}</h2>

                    <div className="grid grid-cols-2 gap-4">
                        <Card className="bg-blue-50 border-none shadow-none">
                            <CardContent className="p-4 flex flex-col items-center text-center">
                                <Calendar className="w-5 h-5 text-blue-600 mb-2" />
                                <span className="text-xs font-bold text-blue-800">
                                    {job.scheduledDate ? format(new Date(job.scheduledDate), "MMM d") : "TBD"}
                                </span>
                            </CardContent>
                        </Card>
                        <Card className="bg-purple-50 border-none shadow-none">
                            <CardContent className="p-4 flex flex-col items-center text-center">
                                <Clock className="w-5 h-5 text-purple-600 mb-2" />
                                <span className="text-xs font-bold text-purple-800">{job.scheduledStartTime || "--:--"}</span>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-xl">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Instructions</h3>
                        <p className="text-sm leading-relaxed text-slate-700">{job.jobDescription}</p>
                    </div>
                </div>

                {/* Actions */}
                {job.assignmentStatus === 'assigned' && (
                    <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t flex gap-3 z-20 pb-8">
                        <Button variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50 h-12 rounded-xl" onClick={() => rejectMutation.mutate()}>
                            <XCircle className="w-4 h-4 mr-2" /> Decline
                        </Button>
                        <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white h-12 rounded-xl" onClick={() => acceptMutation.mutate()}>
                            <CheckCircle2 className="w-4 h-4 mr-2" /> Accept Job
                        </Button>
                    </div>
                )}

                {['accepted', 'in_progress'].includes(job.assignmentStatus) && completionStep === 'idle' && (
                    <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t z-20 pb-8 space-y-3">
                        {/* Time tracking button when not running */}
                        {!isTimerRunning && elapsedSeconds === 0 && (
                            <Button
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 rounded-xl font-bold"
                                onClick={startTimer}
                            >
                                <Play className="w-5 h-5 mr-2" /> Start Timer
                            </Button>
                        )}

                        {/* Timer display when running */}
                        {isTimerRunning && (
                            <div className="bg-blue-50 rounded-xl p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center animate-pulse">
                                        <Timer className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-blue-600 font-medium">Time on job</p>
                                        <p className="text-2xl font-bold text-blue-800 font-mono">{formatElapsedTime(elapsedSeconds)}</p>
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-blue-300 text-blue-600"
                                    onClick={stopTimer}
                                >
                                    <Pause className="w-4 h-4 mr-1" /> Pause
                                </Button>
                            </div>
                        )}

                        {/* Timer display when paused */}
                        {!isTimerRunning && elapsedSeconds > 0 && (
                            <div className="bg-slate-50 rounded-xl p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-400 flex items-center justify-center">
                                        <Timer className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 font-medium">Time on job (paused)</p>
                                        <p className="text-2xl font-bold text-slate-700 font-mono">{formatElapsedTime(elapsedSeconds)}</p>
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={startTimer}
                                >
                                    <Play className="w-4 h-4 mr-1" /> Resume
                                </Button>
                            </div>
                        )}

                        <Button
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-14 rounded-xl text-lg font-bold shadow-lg shadow-emerald-500/30"
                            onClick={() => {
                                if (isTimerRunning) stopTimer();
                                setCompletionStep('upload');
                            }}
                        >
                            Complete Job
                        </Button>
                    </div>
                )}

                {/* Completion Wizard - Step 1: Photo Upload */}
                {completionStep === 'upload' && (
                    <div className="fixed inset-0 bg-white z-50 flex flex-col">
                        <div className="p-4 border-b flex items-center justify-between">
                            <Button variant="ghost" onClick={() => setCompletionStep('idle')} disabled={isUploading}>
                                Cancel
                            </Button>
                            <h2 className="font-bold">Step 1 of 2 - Photos</h2>
                            <div className="w-16" /> {/* Spacer */}
                        </div>

                        {/* Time summary if tracked */}
                        {elapsedSeconds > 0 && (
                            <div className="mx-4 mt-4 p-3 bg-blue-50 rounded-lg flex items-center gap-2">
                                <Timer className="w-4 h-4 text-blue-600" />
                                <span className="text-sm text-blue-700">Time tracked: <strong>{formatElapsedTime(elapsedSeconds)}</strong></span>
                            </div>
                        )}

                        <div className="p-8 flex-1 flex flex-col items-center justify-center text-center space-y-6 overflow-y-auto">
                            <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center">
                                <Camera className="w-10 h-10 text-blue-500" />
                            </div>
                            <h3 className="text-2xl font-bold">Upload Evidence</h3>
                            <p className="text-slate-500">Please upload photo(s) of the completed work</p>

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
                                    className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                />
                            </div>

                            {/* Selected photos preview */}
                            {photos.length > 0 && (
                                <div className="w-full max-w-sm">
                                    <p className="text-sm font-medium text-slate-600 mb-2">
                                        {photos.length} photo(s) selected:
                                    </p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {photos.map((photo, index) => (
                                            <div key={index} className="relative aspect-square bg-slate-100 rounded-lg overflow-hidden">
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

                            {/* Upload progress */}
                            {isUploading && (
                                <div className="w-full max-w-sm space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-slate-600">Uploading...</span>
                                        <span className="font-medium">{uploadProgress}%</span>
                                    </div>
                                    <Progress value={uploadProgress} className="h-2" />
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t pb-8 space-y-3">
                            <Button
                                className="w-full h-12 text-lg rounded-xl"
                                disabled={photos.length === 0 || isUploading}
                                onClick={async () => {
                                    if (photos.length > 0) {
                                        try {
                                            const urls = await uploadPhotos(photos);
                                            setUploadedUrls(urls);
                                            setCompletionStep('signature');
                                        } catch (error) {
                                            toast({
                                                title: "Upload Failed",
                                                description: error instanceof Error ? error.message : "Please try again",
                                                variant: "destructive"
                                            });
                                        }
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
                                className="w-full text-slate-500"
                                onClick={() => setCompletionStep('signature')}
                            >
                                Skip photos
                            </Button>
                        </div>
                    </div>
                )}

                {/* Completion Wizard - Step 2: Signature */}
                {completionStep === 'signature' && (
                    <div className="fixed inset-0 bg-white z-50 flex flex-col">
                        <div className="p-4 border-b flex items-center justify-between">
                            <Button variant="ghost" onClick={() => setCompletionStep('upload')}>
                                Back
                            </Button>
                            <h2 className="font-bold">Step 2 of 2 - Signature</h2>
                            <div className="w-16" />
                        </div>

                        {/* Summary */}
                        <div className="mx-4 mt-4 space-y-2">
                            {elapsedSeconds > 0 && (
                                <div className="p-3 bg-blue-50 rounded-lg flex items-center gap-2">
                                    <Timer className="w-4 h-4 text-blue-600" />
                                    <span className="text-sm text-blue-700">Time: <strong>{formatElapsedTime(elapsedSeconds)}</strong></span>
                                </div>
                            )}
                            {uploadedUrls.length > 0 && (
                                <div className="p-3 bg-green-50 rounded-lg flex items-center gap-2">
                                    <ImageIcon className="w-4 h-4 text-green-600" />
                                    <span className="text-sm text-green-700">{uploadedUrls.length} photo(s) uploaded</span>
                                </div>
                            )}
                        </div>

                        <div className="p-8 flex-1 flex flex-col items-center justify-center text-center space-y-6 overflow-y-auto">
                            <div className="w-20 h-20 rounded-full bg-purple-50 flex items-center justify-center">
                                <PenTool className="w-10 h-10 text-purple-500" />
                            </div>
                            <h3 className="text-2xl font-bold">Customer Signature</h3>
                            <p className="text-slate-500">Get the customer to sign below to confirm completion</p>

                            <div className="w-full max-w-sm">
                                <SignatureCapture
                                    onSignatureComplete={(dataUrl) => setSignatureDataUrl(dataUrl)}
                                    onClear={() => setSignatureDataUrl(null)}
                                />
                            </div>

                            {signatureDataUrl && (
                                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                    <span className="text-sm text-green-700">Signature captured</span>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t pb-8 space-y-3">
                            <Button
                                className="w-full h-12 text-lg rounded-xl bg-emerald-600 hover:bg-emerald-700"
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
                                    className="w-full text-slate-500"
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
        </ContractorAppShell>
    );
}
