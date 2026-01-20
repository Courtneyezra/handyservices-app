import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, ExternalLink, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function StripeConnectStatus() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isRedirecting, setIsRedirecting] = useState(false);

    // 1. Fetch Status
    const { data: status, isLoading } = useQuery({
        queryKey: ['stripe-connect-status'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/stripe/connect/status', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch stripe status');
            return res.json();
        }
    });

    // 2. Create Account Mutation
    const createAccountMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/stripe/connect/account', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to create account');
            return res.json();
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    // 3. Get Onboarding Link Mutation
    const getLinkMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/stripe/connect/account-link', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to get onboarding link');
            return res.json();
        },
        onSuccess: (data) => {
            if (data.url) {
                setIsRedirecting(true);
                window.location.href = data.url;
            }
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    // 4. Get Dashboard Link Mutation
    const getDashboardLinkMutation = useMutation({
        mutationFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/stripe/connect/login-link', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to get dashboard link');
            return res.json();
        },
        onSuccess: (data) => {
            if (data.url) {
                window.open(data.url, '_blank');
            }
        },
        onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    // Handler: Start Onboarding (Create -> Link)
    const handleStartOnboarding = async () => {
        try {
            // Check if we need to create account first
            if (!status?.accountId) {
                await createAccountMutation.mutateAsync();
                // Status query will be invalidated eventually, but simpler to just chain
            }
            // Add slight delay or just proceed to get link (backend handles existing checking)
            await getLinkMutation.mutateAsync();
        } catch (e) {
            console.error(e);
        }
    };

    if (isLoading) {
        return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Checking account status...</div>;
    }

    if (isRedirecting) {
        return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Stripe...</div>;
    }

    // Case 1: Fully Active
    if (status?.connected && status?.chargesEnabled && status?.payoutsEnabled) {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Payouts Active</span>
                </div>

                <Button
                    variant="outline"
                    onClick={() => getDashboardLinkMutation.mutate()}
                    disabled={getDashboardLinkMutation.isPending}
                    className="w-full sm:w-auto flex items-center gap-2"
                >
                    {getDashboardLinkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    View Stripe Dashboard
                </Button>
            </div>
        );
    }

    // Case 2: Connected but Pending (Needs info)
    if (status?.connected) {
        return (
            <div className="space-y-4">
                <div className="flex items-start gap-2 text-amber-600 font-medium text-sm bg-amber-50 px-3 py-2 rounded-lg border border-amber-100">
                    <AlertCircle className="w-4 h-4 mt-0.5" />
                    <div>
                        <p>Action Required</p>
                        <p className="font-normal text-xs mt-1">Stripe needs more information to enable payouts.</p>
                    </div>
                </div>

                <Button
                    onClick={() => getLinkMutation.mutate()}
                    disabled={getLinkMutation.isPending}
                    className="w-full sm:w-auto bg-slate-900 text-white hover:bg-slate-800"
                >
                    {getLinkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />}
                    Continue Setup
                </Button>
            </div>
        );
    }

    // Case 3: Not Connected
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-500 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                <span>No payout account linked</span>
            </div>

            <Button
                onClick={handleStartOnboarding}
                disabled={createAccountMutation.isPending || getLinkMutation.isPending}
                className="w-full sm:w-auto bg-slate-900 text-white hover:bg-slate-800"
            >
                {(createAccountMutation.isPending || getLinkMutation.isPending) ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                    <CreditCard className="w-4 h-4 mr-2" />
                )}
                Set up Payouts
            </Button>
        </div>
    );
}
