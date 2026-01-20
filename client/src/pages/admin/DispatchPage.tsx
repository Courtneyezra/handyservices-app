import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, User, Calendar, Clock, MapPin, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Job {
    id: number;
    customerName: string;
    customerPhone: string;
    jobDescription: string;
    urgency: string;
    location: string;
    assignmentStatus: string; // unassigned, assigned, accepted, in_progress, completed, rejected
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    assignedContractorId: string | null;
    createdAt: string;
}

interface Contractor {
    id: string;
    name: string;
    skills: string[];
    serviceArea: string;
}

export default function DispatchPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [selectedJob, setSelectedJob] = useState<Job | null>(null);
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);

    // Form State
    const [selectedContractor, setSelectedContractor] = useState<string>("");
    const [scheduledDate, setScheduledDate] = useState<string>("");
    const [scheduledStartTime, setScheduledStartTime] = useState<string>("");
    const [scheduledEndTime, setScheduledEndTime] = useState<string>("");

    const generateInvoiceMutation = useMutation({
        mutationFn: async (jobId: number) => {
            const res = await fetch("/api/invoices/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId }),
            });
            if (!res.ok) throw new Error("Failed to generate invoice");
            return res.json();
        },
        onSuccess: () => {
            toast({ title: "Invoice Generated", description: "Draft invoice created successfully." });
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to generate invoice.", variant: "destructive" });
        }
    });

    const { data: jobs, isLoading: jobsLoading } = useQuery<Job[]>({
        queryKey: ["admin-jobs"],
        queryFn: async () => {
            const res = await fetch("/api/admin/jobs");
            if (!res.ok) throw new Error("Failed to fetch jobs");
            return res.json();
        },
    });

    const { data: contractors, isLoading: contractorsLoading } = useQuery<Contractor[]>({
        queryKey: ["handymen"],
        queryFn: async () => {
            const res = await fetch("/api/handymen");
            if (!res.ok) throw new Error("Failed to fetch contractors");
            return res.json();
        },
    });

    const assignMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob || !selectedContractor || !scheduledDate) return;

            const payload = {
                contractorId: selectedContractor,
                scheduledDate,
                scheduledStartTime,
                scheduledEndTime: scheduledEndTime || null,
            };

            const res = await fetch(`/api/jobs/${selectedJob.id}/assign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to assign job");
            }
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-jobs"] });
            setAssignDialogOpen(false);
            resetForm();
            toast({
                title: "Job Assigned",
                description: "The contractor has been notified.",
            });
        },
        onError: (error: Error) => {
            toast({
                title: "Assignment Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const resetForm = () => {
        setSelectedContractor("");
        setScheduledDate("");
        setScheduledStartTime("");
        setScheduledEndTime("");
        setSelectedJob(null);
    };

    const openAssignModal = (job: Job) => {
        setSelectedJob(job);
        setAssignDialogOpen(true);
    };

    const unassignedJobs = jobs?.filter(j => j.assignmentStatus === "unassigned" || !j.assignmentStatus) || [];
    const activeJobs = jobs?.filter(j => ["assigned", "accepted", "in_progress"].includes(j.assignmentStatus)) || [];

    if (jobsLoading || contractorsLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Dispatch Board</h1>
                    <p className="text-muted-foreground mt-1">Assign and manage job schedules</p>
                </div>
            </div>

            <Dialog open={assignDialogOpen} onOpenChange={(open) => {
                setAssignDialogOpen(open);
                if (!open) resetForm();
            }}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Assign Job</DialogTitle>
                        <DialogDescription>
                            Select a contractor and time for this job.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <Label>Required Service</Label>
                            <div className="text-sm font-medium p-2 bg-muted rounded-md">
                                {selectedJob?.jobDescription}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="contractor">Contractor</Label>
                            <Select onValueChange={setSelectedContractor} value={selectedContractor}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select contractor..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {contractors?.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="date">Date</Label>
                            <Input
                                id="date"
                                type="date"
                                value={scheduledDate}
                                onChange={(e) => setScheduledDate(e.target.value)}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="start">Start Time</Label>
                                <Input
                                    id="start"
                                    type="time"
                                    value={scheduledStartTime}
                                    onChange={(e) => setScheduledStartTime(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="end">End Time</Label>
                                <Input
                                    id="end"
                                    type="time"
                                    value={scheduledEndTime}
                                    onChange={(e) => setScheduledEndTime(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
                        <Button onClick={() => assignMutation.mutate()} disabled={assignMutation.isPending}>
                            {assignMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirm Assignment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Tabs defaultValue="unassigned">
                <TabsList>
                    <TabsTrigger value="unassigned" className="relative">
                        Unassigned
                        {unassignedJobs.length > 0 && (
                            <span className="ml-2 bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full text-xs font-bold">
                                {unassignedJobs.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="active">Active Schedule</TabsTrigger>
                </TabsList>

                <TabsContent value="unassigned" className="mt-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {unassignedJobs.length === 0 && (
                            <div className="col-span-full text-center py-10 text-muted-foreground">
                                No unassigned jobs pending. Good job!
                            </div>
                        )}
                        {unassignedJobs.map((job) => (
                            <Card key={job.id} className="border-l-4 border-l-amber-500">
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <Badge variant="outline" className="text-amber-600 bg-amber-50 border-amber-200">New Request</Badge>
                                        <span className="text-xs text-muted-foreground">{format(new Date(job.createdAt), "MMM d, h:mm a")}</span>
                                    </div>
                                    <CardTitle className="text-lg mt-2">{job.customerName}</CardTitle>
                                    <CardDescription className="flex items-center gap-1">
                                        <MapPin className="h-3 w-3" /> {job.location || "No location"}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-foreground/80 line-clamp-3 mb-4">
                                        {job.jobDescription}
                                    </p>
                                    <Button className="w-full" onClick={() => openAssignModal(job)}>
                                        <Calendar className="mr-2 h-4 w-4" /> Assign Job
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="active" className="mt-4">
                    <div className="rounded-md border bg-card">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground">
                                <tr>
                                    <th className="p-4 font-medium">Job ID</th>
                                    <th className="p-4 font-medium">Customer</th>
                                    <th className="p-4 font-medium">Contractor</th>
                                    <th className="p-4 font-medium">Scheduled</th>
                                    <th className="p-4 font-medium">Status</th>
                                    <th className="p-4 font-medium text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {activeJobs.map((job) => {
                                    const contractor = contractors?.find(c => c.id === job.assignedContractorId);
                                    return (
                                        <tr key={job.id} className="hover:bg-muted/50 transition-colors">
                                            <td className="p-4 font-mono text-xs">#{job.id}</td>
                                            <td className="p-4">
                                                <div className="font-medium">{job.customerName}</div>
                                                <div className="text-xs text-muted-foreground">{job.jobDescription.substring(0, 30)}...</div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-6 w-6 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold">
                                                        {contractor?.name?.charAt(0) || "?"}
                                                    </div>
                                                    {contractor?.name || "Unknown"}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                {job.scheduledDate && (
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{format(new Date(job.scheduledDate), "MMM d, yyyy")}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {job.scheduledStartTime} - {job.scheduledEndTime}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <Badge variant="outline" className={
                                                    job.assignmentStatus === 'accepted' ? 'bg-green-100 text-green-800' :
                                                        job.assignmentStatus === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                                                            'bg-gray-100 text-gray-800'
                                                }>
                                                    {job.assignmentStatus}
                                                </Badge>
                                            </td>
                                            <td className="p-4 text-right">
                                                <Button size="sm" variant="outline" className="mr-2" onClick={() => generateInvoiceMutation.mutate(job.id)}>
                                                    Invoice
                                                </Button>
                                                <Button size="sm" variant="ghost">View</Button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
