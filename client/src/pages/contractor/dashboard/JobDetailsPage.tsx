import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import ContractorAppShell from "@/components/layout/ContractorAppShell";
import { Loader2, ArrowLeft, MapPin, Calendar, Clock, CheckCircle2, XCircle, Upload, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

    // Wizard State
    const [completionStep, setCompletionStep] = useState<"idle" | "upload" | "confirm">("idle");
    const [photos, setPhotos] = useState<File[]>([]);

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
            // Need to get contractor ID from profile or passing it? 
            // Logic in server requires contractorId in body usually, or token.
            // Server endpoint: jobAssignmentRouter.post('/api/jobs/:id/accept', ... req.body.contractorId
            // I need to fetch profile to get ID, or rely on server using token.
            // The current server implementation (Step 854) lines 142-143 says: 
            // const contractorId = req.body.contractorId; // Temporary

            // So I must provide contractorId.
            const profileRes = await fetch('/api/contractor/me', { headers: { Authorization: `Bearer ${token}` } });
            const profileData = await profileRes.json();
            const contractorId = profileData.profile.id;

            const res = await fetch(`/api/jobs/${id}/accept`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contractorId })
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
            const profileRes = await fetch('/api/contractor/me', { headers: { Authorization: `Bearer ${token}` } });
            const profileData = await profileRes.json();
            const contractorId = profileData.profile.id;

            const res = await fetch(`/api/jobs/${id}/reject`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contractorId, reason: "Contractor declined" })
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

    const completeMutation = useMutation({
        mutationFn: async () => {
            // Here we would upload photos first in a real app
            const res = await fetch(`/api/jobs/${id}/complete`, { method: "POST" });
            if (!res.ok) throw new Error("Failed to complete");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["job", id] });
            setCompletionStep("idle");
            toast({ title: "Job Completed!", description: "Great work. Proceeding to invoice...", className: "bg-green-600 text-white" });
            // Maybe redirect to invoice?
        },
        onError: () => toast({ title: "Error", description: "Failed to complete job.", variant: "destructive" })
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
                    <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t z-20 pb-8">
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-14 rounded-xl text-lg font-bold shadow-lg shadow-emerald-500/30" onClick={() => setCompletionStep('upload')}>
                            Complete Job
                        </Button>
                    </div>
                )}

                {/* Completion Wizard */}
                {completionStep === 'upload' && (
                    <div className="fixed inset-0 bg-white z-50 flex flex-col">
                        <div className="p-4 border-b flex items-center">
                            <Button variant="ghost" onClick={() => setCompletionStep('idle')}>Cancel</Button>
                            <h2 className="ml-auto font-bold">Step 1 of 2</h2>
                        </div>
                        <div className="p-8 flex-1 flex flex-col items-center justify-center text-center space-y-6">
                            <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center">
                                <Camera className="w-10 h-10 text-blue-500" />
                            </div>
                            <h3 className="text-2xl font-bold">Upload Evidence</h3>
                            <p className="text-slate-500">Please upload a photo of the completed work</p>

                            <div className="w-full max-w-xs">
                                <Label htmlFor="photo" className="sr-only">Photo</Label>
                                <Input id="photo" type="file" accept="image/*" onChange={handleFileChange} className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                            </div>
                        </div>
                        <div className="p-4 border-t pb-8">
                            <Button className="w-full h-12 text-lg rounded-xl" disabled={photos.length === 0} onClick={() => completeMutation.mutate()}>
                                Finish & Complete
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </ContractorAppShell>
    );
}
