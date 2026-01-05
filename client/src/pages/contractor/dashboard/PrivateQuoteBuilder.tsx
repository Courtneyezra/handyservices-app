import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Sparkles, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import ContractorDashboardLayout from "@/pages/contractor/ContractorDashboardLayout";
import { apiRequest } from "@/lib/queryClient";

export default function PrivateQuoteBuilder() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const [customerName, setCustomerName] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [jobDescription, setJobDescription] = useState("");

    const createQuoteMutation = useMutation({
        mutationFn: async (data: { customerName: string; customerPhone: string; jobDescription: string }) => {
            const res = await apiRequest("POST", "/api/contractor/quotes/create", data);
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Quote Generated!",
                description: "Your AI-powered quote is ready to share.",
            });
            // Redirect to the public quote view (or a success page with the link)
            // For now, let's go to a "Share" page or just show the link.
            // Actually, we can redirect directly to the quote page to preview it.
            // But we might want a middle step. Let's redirect to dashboard for now or a success view.
            // Better: Redirect to the Quote Page so they can see what the client sees.
            setLocation(`/quote-link/${data.shortSlug}`);
        },
        onError: (error) => {
            toast({
                title: "Error creating quote",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        createQuoteMutation.mutate({ customerName, customerPhone, jobDescription });
    };

    return (
        <ContractorDashboardLayout>
            <div className="max-w-2xl mx-auto space-y-6">
                <Button variant="ghost" className="pl-0 gap-2 text-slate-400 hover:text-white" onClick={() => setLocation("/contractor/dashboard")}>
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </Button>

                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Create New Quote</h1>
                    <p className="text-slate-400">
                        Use our AI to instantly generate a professional "Good / Better / Best" quote for your client.
                    </p>
                </div>

                <Card className="bg-slate-900 border-slate-800">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-amber-400" />
                            Job Details
                        </CardTitle>
                        <CardDescription>
                            Enter the basics. We'll utilize your rates to calculate the price.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Client Name</Label>
                                    <Input
                                        id="name"
                                        placeholder="e.g. John Smith"
                                        value={customerName}
                                        onChange={(e) => setCustomerName(e.target.value)}
                                        required
                                        className="bg-slate-950 border-slate-800"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="phone">Client Phone</Label>
                                    <Input
                                        id="phone"
                                        type="tel"
                                        placeholder="e.g. 07700 900000"
                                        value={customerPhone}
                                        onChange={(e) => setCustomerPhone(e.target.value)}
                                        required
                                        className="bg-slate-950 border-slate-800"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="description">Job Description & Notes</Label>
                                <Textarea
                                    id="description"
                                    placeholder="Describe the job. Include details like 'Install new sink in kitchen, pipes are old Copper'. The more detail, the better the AI can estimate."
                                    value={jobDescription}
                                    onChange={(e) => setJobDescription(e.target.value)}
                                    required
                                    className="min-h-[150px] bg-slate-950 border-slate-800"
                                />
                                <p className="text-xs text-slate-500">
                                    Our AI assumes standard complexity unless you specify otherwise.
                                </p>
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold py-6"
                                disabled={createQuoteMutation.isPending}
                            >
                                {createQuoteMutation.isPending ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        Generating Magic Quote...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-5 h-5 mr-2" />
                                        Generate Instant Quote
                                    </>
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </ContractorDashboardLayout>
    );
}
