import { useQuery } from '@tanstack/react-query';
import { PoundSterling, Clock, TrendingUp, Download, Loader2, ArrowLeft, CalendarDays, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import ContractorAppShell from '@/components/layout/ContractorAppShell';
import { useLocation } from 'wouter';

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
    paid: { label: 'Paid', className: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' },
    pending: { label: 'Pending', className: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30' },
    processing: { label: 'Processing', className: 'bg-blue-600/20 text-blue-400 border-blue-600/30' },
    failed: { label: 'Failed', className: 'bg-red-600/20 text-red-400 border-red-600/30' },
    held: { label: 'Held', className: 'bg-orange-600/20 text-orange-400 border-orange-600/30' },
    reversed: { label: 'Reversed', className: 'bg-gray-600/20 text-gray-400 border-gray-600/30' },
};

function formatPence(pence: number): string {
    return `\u00a3${(pence / 100).toFixed(2)}`;
}

function fetchWithAuth(url: string) {
    const token = localStorage.getItem('contractorToken');
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch');
            return res.json();
        });
}

interface EarningsSummary {
    thisMonth: { totalPence: number; jobCount: number };
    lastMonth: { totalPence: number; jobCount: number };
    pending: { totalPence: number; count: number; nextScheduledAt: string | null };
}

interface Payout {
    id: number;
    jobId: number | null;
    quoteId: string | null;
    grossAmountPence: number;
    platformFeePence: number;
    netPayoutPence: number;
    variationAmountPence: number | null;
    status: string;
    failureReason: string | null;
    heldReason: string | null;
    scheduledPayoutAt: string | null;
    paidAt: string | null;
    createdAt: string;
    jobDescription: string | null;
    jobDate: string | null;
    customerName: string | null;
}

interface TaxSummary {
    years: Array<{
        taxYear: string;
        totalGrossPence: number;
        totalPlatformFeePence: number;
        totalNetPayoutPence: number;
        totalJobs: number;
    }>;
}

export default function EarningsPage() {
    const [, setLocation] = useLocation();

    const { data: summary, isLoading: summaryLoading } = useQuery<EarningsSummary>({
        queryKey: ['/api/contractor/earnings-summary'],
        queryFn: () => fetchWithAuth('/api/contractor/earnings-summary'),
    });

    const { data: payouts, isLoading: payoutsLoading } = useQuery<Payout[]>({
        queryKey: ['/api/contractor/payouts'],
        queryFn: () => fetchWithAuth('/api/contractor/payouts'),
    });

    const { data: taxData } = useQuery<TaxSummary>({
        queryKey: ['/api/contractor/tax-summary'],
        queryFn: () => fetchWithAuth('/api/contractor/tax-summary'),
    });

    const handleDownloadTaxSummary = () => {
        if (!taxData?.years?.length) return;
        const lines = [
            'Tax Year,Gross,Platform Fee,Net Payout,Total Jobs',
            ...taxData.years.map(y =>
                `${y.taxYear},${(y.totalGrossPence / 100).toFixed(2)},${(y.totalPlatformFeePence / 100).toFixed(2)},${(y.totalNetPayoutPence / 100).toFixed(2)},${y.totalJobs}`
            ),
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tax-summary-${new Date().getFullYear()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const isLoading = summaryLoading || payoutsLoading;

    return (
        <ContractorAppShell>
            <div className="p-4 pb-24 max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                    <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white" onClick={() => setLocation('/contractor/dashboard')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <h1 className="text-2xl font-bold text-white">Earnings</h1>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-[#e8b323]" />
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                            <Card className="bg-[#0f1b2d] border-[#1e3a5f]">
                                <CardHeader className="pb-2 pt-4 px-4">
                                    <CardTitle className="text-xs uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                                        <TrendingUp className="h-3.5 w-3.5" /> This Month
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 pb-4">
                                    <p className="text-2xl font-bold text-white">{formatPence(summary?.thisMonth.totalPence || 0)}</p>
                                    <p className="text-xs text-gray-500 mt-1">{summary?.thisMonth.jobCount || 0} job{(summary?.thisMonth.jobCount || 0) !== 1 ? 's' : ''}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-[#0f1b2d] border-[#1e3a5f]">
                                <CardHeader className="pb-2 pt-4 px-4">
                                    <CardTitle className="text-xs uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                                        <Clock className="h-3.5 w-3.5" /> Pending
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 pb-4">
                                    <p className="text-2xl font-bold text-[#e8b323]">{formatPence(summary?.pending.totalPence || 0)}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {summary?.pending.nextScheduledAt
                                            ? `Next: ${format(new Date(summary.pending.nextScheduledAt), 'dd MMM, HH:mm')}`
                                            : `${summary?.pending.count || 0} payout${(summary?.pending.count || 0) !== 1 ? 's' : ''} queued`}
                                    </p>
                                </CardContent>
                            </Card>
                            <Card className="bg-[#0f1b2d] border-[#1e3a5f]">
                                <CardHeader className="pb-2 pt-4 px-4">
                                    <CardTitle className="text-xs uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                                        <CalendarDays className="h-3.5 w-3.5" /> Last Month
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-4 pb-4">
                                    <p className="text-2xl font-bold text-white">{formatPence(summary?.lastMonth.totalPence || 0)}</p>
                                    <p className="text-xs text-gray-500 mt-1">{summary?.lastMonth.jobCount || 0} job{(summary?.lastMonth.jobCount || 0) !== 1 ? 's' : ''}</p>
                                </CardContent>
                            </Card>
                        </div>

                        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Payout History</h2>
                        {(!payouts || payouts.length === 0) ? (
                            <Card className="bg-[#0f1b2d] border-[#1e3a5f]">
                                <CardContent className="py-10 text-center">
                                    <PoundSterling className="h-10 w-10 mx-auto text-gray-600 mb-3" />
                                    <p className="text-gray-400">No payouts yet</p>
                                    <p className="text-xs text-gray-600 mt-1">Complete jobs to start earning</p>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="space-y-2">
                                {payouts.map(payout => {
                                    const badge = STATUS_BADGES[payout.status] || STATUS_BADGES.pending;
                                    return (
                                        <Card key={payout.id} className="bg-[#0f1b2d] border-[#1e3a5f] hover:border-[#2a4a6f] transition-colors">
                                            <CardContent className="p-4">
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-white truncate">
                                                            {payout.jobDescription || payout.customerName || `Job #${payout.jobId || payout.id}`}
                                                        </p>
                                                        <p className="text-xs text-gray-500 mt-0.5">
                                                            {payout.paidAt ? format(new Date(payout.paidAt), 'dd MMM yyyy')
                                                                : payout.jobDate ? format(new Date(payout.jobDate), 'dd MMM yyyy')
                                                                : format(new Date(payout.createdAt), 'dd MMM yyyy')}
                                                        </p>
                                                        {payout.status === 'held' && payout.heldReason && (
                                                            <p className="text-xs text-orange-400 mt-1 flex items-center gap-1">
                                                                <AlertCircle className="h-3 w-3" />
                                                                {payout.heldReason === 'stripe_not_active' ? 'Connect your Stripe account'
                                                                    : payout.heldReason === 'dispute_open' ? 'Dispute under review'
                                                                    : payout.heldReason}
                                                            </p>
                                                        )}
                                                        {payout.status === 'failed' && payout.failureReason && (
                                                            <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                                                                <AlertCircle className="h-3 w-3" /> Payment failed — will retry
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="text-right ml-3 flex-shrink-0">
                                                        <p className="text-sm font-semibold text-white">{formatPence(payout.netPayoutPence)}</p>
                                                        <div className="mt-1">
                                                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badge.className}`}>
                                                                {badge.label}
                                                            </Badge>
                                                        </div>
                                                        {payout.grossAmountPence !== payout.netPayoutPence && (
                                                            <p className="text-[10px] text-gray-600 mt-0.5">Gross: {formatPence(payout.grossAmountPence)}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        )}

                        {taxData && taxData.years.length > 0 && (
                            <div className="mt-6">
                                <Button variant="outline" className="w-full border-[#1e3a5f] text-gray-300 hover:bg-[#1e3a5f]/30 hover:text-white" onClick={handleDownloadTaxSummary}>
                                    <Download className="h-4 w-4 mr-2" /> Download Tax Summary (CSV)
                                </Button>
                                <p className="text-[10px] text-gray-600 text-center mt-2">UK tax year breakdown (6 Apr - 5 Apr) for your self-assessment</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </ContractorAppShell>
    );
}
