import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import {
    ArrowLeft, Loader2, MapPin, Phone, Calendar,
    CreditCard, FileText,
    Navigation, ExternalLink, Download, Coins
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function JobDetailsPage() {
    const [, params] = useRoute("/contractor/dashboard/jobs/:id");
    const [location, setLocation] = useLocation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const jobId = params?.id;

    // We can reuse the quotes endpoint if it returns job data, or use our manual fetching logic.
    // Ideally we'd have GET /api/contractor/jobs/:id.
    // For v1, the quotes endpoint returns quote+job info combined usually.
    // Let's assume we can fetch the specific job via the quotes list endpoint filtering or a new endpoint.
    // Actually, `QuotesListPage` fetches all.
    // Let's create a quick specific fetch or reuse the list.
    // Since we didn't make GET /jobs/:id, let's just fetch all and find (inefficient but safe for v1).
    const { data: quotes, isLoading } = useQuery<any[]>({
        queryKey: ['contractor-quotes'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/quotes', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch jobs');
            return res.json();
        }
    });

    const job = quotes?.find(q => q.id === jobId || q.shortSlug === jobId);
    // Note: The previous page links to `quotes/:slug` but arguably this should be `jobs/:id`.
    // If we are redirecting from JobsPage, we might be using the quote ID or shortSlug.
    // Let's assume we are fixing the route in App.tsx to point here for jobs.

    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [amount, setAmount] = useState("");

    const payMutation = useMutation({
        mutationFn: async ({ method, amountPence }: { method: string, amountPence: number }) => {
            const token = localStorage.getItem('contractorToken');
            if (!job) throw new Error("No job loaded");

            // Try to use contractorJobId if available, else job.id
            const targetId = job.contractorJobId || job.id;

            const res = await fetch(`/api/contractor/jobs/${targetId}/payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ amountPence, method })
            });
            if (!res.ok) throw new Error("Payment failed");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contractor-quotes'] });
            toast({ title: "Payment Recorded", description: "Job marked as paid." });
            setIsPaymentModalOpen(false);
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to record payment.", variant: "destructive" });
        }
    });

    const handlePayment = (method: 'cash' | 'transfer') => {
        if (!job) return;
        // Default to full price if not set, or parse input
        // For MVP, we assume full payment.
        const payAmount = job.pricePence || 0; // The job price
        payMutation.mutate({ method, amountPence: payAmount });
    };

    if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-amber-500" /></div>;
    if (!job) return <div className="p-10 text-center text-slate-500">Job not found</div>;

    const isPaid = job.paymentStatus === 'paid'; // We need to expose this in GET /quotes too

    return (
        <div className="min-h-screen bg-slate-950 pb-20">
            {/* Header */}
            <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 p-4 flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => setLocation("/contractor/dashboard/jobs")}>
                    <ArrowLeft className="w-5 h-5 text-slate-400" />
                </Button>
                <h1 className="font-bold text-white text-lg">Job Details</h1>
            </div>

            <div className="p-4 space-y-6">
                {/* Status Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-bold text-white mb-1">{job.customerName}</h2>
                            <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                                <MapPin className="w-3.5 h-3.5" />
                                {job.postcode || "Location pending"}
                            </div>
                        </div>
                        <Badge className={`${isPaid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                            {isPaid ? 'PAID' : 'DUE'}
                        </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <Button className="bg-emerald-600 hover:bg-emerald-500 text-white w-full">
                            <Phone className="w-4 h-4 mr-2" /> Call
                        </Button>
                        <Button variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 w-full">
                            <Navigation className="w-4 h-4 mr-2" /> Directions
                        </Button>
                    </div>
                </div>

                {/* Actions */}
                <div className="space-y-3">
                    <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Management</h3>

                    {!isPaid && (
                        <Dialog open={isPaymentModalOpen} onOpenChange={setIsPaymentModalOpen}>
                            <DialogTrigger asChild>
                                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden cursor-pointer active:scale-[0.99] transition-transform">
                                    <div className="w-full p-4 flex items-center justify-between hover:bg-slate-800 transition-colors text-left">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                                <CreditCard className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="font-medium text-white">Mark as Paid</div>
                                                <div className="text-xs text-slate-500">Record cash or transfer</div>
                                            </div>
                                        </div>
                                        <ArrowLeft className="w-5 h-5 rotate-180 text-slate-600" />
                                    </div>
                                </div>
                            </DialogTrigger>
                            <DialogContent className="bg-slate-900 border-slate-800 text-white">
                                <DialogHeader>
                                    <DialogTitle>Record Payment</DialogTitle>
                                    <DialogDescription className="text-slate-400">
                                        Confirm that you have received payment for this job.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="bg-slate-950 p-4 rounded-lg flex justify-between items-center border border-slate-800">
                                        <span className="text-slate-400">Amount Due</span>
                                        <span className="text-xl font-bold text-white">£{((job.pricePence || 0) / 100).toFixed(2)}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Button
                                            onClick={() => handlePayment('cash')}
                                            disabled={payMutation.isPending}
                                            className="bg-emerald-600 hover:bg-emerald-500 h-20 flex flex-col gap-2"
                                        >
                                            <Coins className="w-6 h-6" />
                                            <span>Cash Received</span>
                                        </Button>
                                        <Button
                                            onClick={() => handlePayment('transfer')}
                                            disabled={payMutation.isPending}
                                            variant="outline"
                                            className="border-slate-700 hover:bg-slate-800 h-20 flex flex-col gap-2 text-slate-300"
                                        >
                                            <CreditCard className="w-6 h-6" />
                                            <span>Bank Transfer</span>
                                        </Button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}

                    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                        <a
                            href={`/api/contractor/jobs/${job.contractorJobId || job.id}/invoice`}
                            target="_blank"
                            className="w-full p-4 flex items-center justify-between hover:bg-slate-800 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="font-medium text-white">Download Invoice</div>
                                    <div className="text-xs text-slate-500">PDF / Print View</div>
                                </div>
                            </div>
                            <ExternalLink className="w-5 h-5 text-slate-600" />
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
